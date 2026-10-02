/**
 * Extrato da conta corrente pela API de Extratos v2 do Banco do Brasil
 * (etapa 11). A v1 é desligada pelo BB em 20/11/2026; a v2 (documentação de
 * 02/10/2026, OpenAPI 2.0.1) mudou o seguinte:
 *
 *   endereços . https://extratos.mtls.api.hm.bb.com.br/v2 (homologação) e
 *               https://extratos.mtls.api.bb.com.br/v2 (produção), os dois
 *               com o certificado da empresa na conexão (mTLS);
 *   token ..... OAuth2 client_credentials (Basic client_id:client_secret),
 *               escopo "extrato-info", em oauth.hm.bb.com.br / oauth.bb.com.br;
 *   consulta .. GET {api}/conta-corrente/agencia/{agencia}/conta/{conta}
 *               ?gw-dev-app-key=  (o MESMO nome nos dois ambientes; a chave é
 *               a do ambiente) &numeroPaginaSolicitacao=
 *               &quantidadeRegistroPaginaSolicitacao= (50 a 120)
 *               &dataInicioSolicitacao=&dataFimSolicitacao= (DDMMAAAA sem o
 *               zero à esquerda do dia; até 31 dias por consulta);
 *   teste ..... na homologação, o cabeçalho x-br-com-bb-ipa-mciteste com o
 *               código da conta de teste (nunca em produção);
 *   resposta .. listaLancamento[] com indicadorTipoLancamento (1 contabilizado,
 *               2 futuro, 3 em processamento, SA/RA/LE/AP/SD/LD/LC/LU saldos e
 *               limites), indicadorSinalLancamento (C, D, * bloqueado),
 *               textoDescricaoSubHistorico (a documentação em tabela ainda diz
 *               textoDescricaoHistorico: aceito os dois), o CPF/CNPJ da
 *               contrapartida (podendo vir alfanumérico) e
 *               textoIdentificadorUnicoTransacao (gerado em D-1).
 *
 * Só o lançamento contabilizado entra no extrato; saldos, limites, futuros,
 * em processamento e bloqueados ficam em `fora` (aparecem no teste). As
 * linhas de saldo (histórico 0 e 999) dão o saldo do banco. Cada lançamento
 * vira o mesmo objeto que o leitor do OFX devolve, e a gravação é a do
 * extrato (extrato.js), sem repetir o que já entrou pelo OFX.
 *
 * Puro, com o transporte injetado (rede.js); nada aqui guarda segredo.
 */
const { mensagemDoBB } = require('../../cobranca/bbCliente');

const POR_PAGINA = 120;
const MAX_PAGINAS = 50;
/** O BB aceita até 31 dias entre a data inicial e a final. */
const MAX_DIAS_POR_CONSULTA = 31;
const FOLGA_TOKEN_MS = 60 * 1000;
const APP_KEY_EXTRATO = 'gw-dev-app-key';
const CABECALHO_TESTE = 'x-br-com-bb-ipa-mciteste';

function erro(mensagem, status = 502, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

const digitos = v => String(v ?? '').replace(/\D/g, '');

/** O primeiro campo preenchido entre os nomes (a v2 e a documentação em tabela usam grafias diferentes). Pura. */
function campo(l, ...nomes) {
  for (const n of nomes) {
    const v = l?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

/** 'YYYY-MM-DD' → DDMMAAAA sem o zero à esquerda do dia ("1092026"). Pura. */
function dataBB(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) throw erro('Data inválida para o extrato do BB.', 400);
  return `${Number(m[3])}${m[2]}${m[1]}`;
}

/** DDMMAAAA (número ou texto, com ou sem o zero do dia; ou já ISO) → 'YYYY-MM-DD', ou null. Pura. */
function lerDataBB(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(t);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const d = digitos(t);
  if (d.length < 7 || d.length > 8) return null;
  const s = d.padStart(8, '0');
  const dia = s.slice(0, 2);
  const mes = s.slice(2, 4);
  const ano = s.slice(4);
  if (Number(dia) < 1 || Number(dia) > 31 || Number(mes) < 1 || Number(mes) > 12) return null;
  return `${ano}-${mes}-${dia}`;
}

/** 'YYYY-MM-DD' + n dias. Pura. */
function somarDias(iso, n) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** O período em pedaços de até 31 dias (cada um vira uma consulta). Pura. */
function janelas(inicio, fim, maxDias = MAX_DIAS_POR_CONSULTA) {
  const saida = [];
  let de = inicio;
  while (de <= fim) {
    const limite = somarDias(de, maxDias - 1);
    const ate = limite < fim ? limite : fim;
    saida.push({ inicio: de, fim: ate });
    de = somarDias(ate, 1);
  }
  return saida;
}

/** O texto do histórico (v2: textoDescricaoSubHistorico). Pura. */
const textoHistorico = l => String(campo(l, 'textoDescricaoSubHistorico', 'textoDescricaoHistorico') ?? '').replace(/\s+/g, ' ').trim();

const SALDO = /^(saldo anterior|saldo do dia|saldo|s\s*a\s*l\s*d\s*o)\b/i;

/** É a linha de saldo (histórico 0 ou 999), e não um lançamento? Pura. */
function ehSaldo(l) {
  const codigo = Number(campo(l, 'codigoHistorico'));
  if (codigo === 999) return true;
  const documento = campo(l, 'numeroDocumento');
  return SALDO.test(textoHistorico(l)) && (codigo === 0 || !documento || Number(documento) === 0);
}

const TIPOS_FORA = {
  2: 'futuro', 3: 'em processamento',
  SA: 'saldo atual', RA: 'resgate automático', LE: 'limite extra do cartão', AP: 'aprovisionado',
  SD: 'saldo disponível', LD: 'limite disponível', LC: 'limite contratado', LU: 'limite utilizado'
};

/**
 * Por que a linha fica fora do extrato (null = é lançamento): futuro, em
 * processamento, saldo/limite ou valor bloqueado. Na v1 o indicador vinha
 * com C/D, que continuam valendo como lançamento. Pura.
 */
function foraDoExtrato(l) {
  const tipo = String(campo(l, 'indicadorTipoLancamento') ?? '').trim().toUpperCase();
  if (TIPOS_FORA[tipo]) return TIPOS_FORA[tipo];
  if (String(campo(l, 'indicadorSinalLancamento') ?? '').trim() === '*') return 'bloqueado';
  return null;
}

/** O sinal do lançamento: D/débito negativo, C/crédito positivo. Pura. */
function sinalDe(l) {
  for (const nome of ['indicadorSinalLancamento', 'indicadorTipoLancamento', 'indicadorCreditoDebito']) {
    const v = String(l?.[nome] ?? '').trim().toUpperCase();
    if (v === 'D' || v === 'DEBITO' || v === 'DÉBITO' || v === '-') return -1;
    if (v === 'C' || v === 'CREDITO' || v === 'CRÉDITO' || v === '+') return 1;
  }
  const bruto = Number(l?.valorLancamento);
  return Number.isFinite(bruto) && bruto < 0 ? -1 : 1;
}

/** O CPF/CNPJ da contrapartida: só dígitos (com os zeros) ou o CNPJ alfanumérico de 14 posições. Pura. */
function documentoContrapartida(v, tipoPessoa) {
  const s = String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) > 0 ? s.padStart(tipoPessoa === 'F' ? 11 : 14, '0').slice(-14) : null;
  return s.length === 14 ? s : null;
}

const textoCurto = (v, max) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

/** Um lançamento da API → o formato do leitor do OFX (+ os campos que só a API tem). Pura. */
function lancamentoDe(l) {
  const data = lerDataBB(l.dataLancamento) || lerDataBB(l.dataMovimento);
  const valorAbs = Math.abs(Number(String(l.valorLancamento ?? '').replace(',', '.')));
  if (!data || !Number.isFinite(valorAbs)) return null;
  const valor = Math.round(sinalDe(l) * valorAbs * 100) / 100;
  if (valor === 0) return { zerado: true };
  const documento = digitos(l.numeroDocumento).replace(/^0+(?=\d)/, '');
  const tipoPessoa = String(campo(l, 'indicadorTipoPessoaContrapartida') ?? '').trim().toUpperCase();
  const contrapartida = documentoContrapartida(campo(l, 'numeroCadastroPessoaFisicaCadastroNacPessoasJuridicasContrapartida', 'numeroCpfCnpjContrapartida'), tipoPessoa);
  const descricao = [textoHistorico(l), String(l.textoInformacaoComplementar ?? '').replace(/\s+/g, ' ').trim()].filter(Boolean);
  return {
    data, valor, tipo: valor > 0 ? 'credito' : 'debito',
    tipo_banco: 'API',
    identificador: textoCurto(campo(l, 'textoIdentificadorUnicoTransacao', 'TextoIdentificadorUnicoTransacao'), 120),
    // O identificador do BB só nasce em D-1: a identidade (hash) da linha não
    // pode depender dele, senão a busca de hoje e a de amanhã dariam duas.
    hash_por_documento: true,
    documento: documento && documento !== '0' ? documento : null,
    descricao: [...new Set(descricao)].join(' — ') || null,
    contrapartida_documento: contrapartida,
    contrapartida_tipo: ['F', 'J'].includes(tipoPessoa) ? tipoPessoa : null,
    codigo_historico: textoCurto(campo(l, 'codigoHistorico'), 10),
    codigo_sub_historico: textoCurto(campo(l, 'codigoSubHistorico', 'CodigoSubHistorico'), 10),
    sistema_pagamento: textoCurto(campo(l, 'numeroISPB', 'CodigoIdentificadorSistemaPagamento', 'codigoIdentificadorSistemaPagamento'), 20)
  };
}

/** Uma página da resposta: os lançamentos, o saldo (se veio), o que fica fora e a próxima página. Pura. */
function lerPagina(corpo) {
  const lista = Array.isArray(corpo?.listaLancamento) ? corpo.listaLancamento : (Array.isArray(corpo?.lancamentos) ? corpo.lancamentos : []);
  const lancamentos = [];
  const fora = [];
  let saldo = null;
  let zerados = 0;
  let invalidos = 0;
  for (const l of lista) {
    const data = lerDataBB(l.dataLancamento) || lerDataBB(l.dataMovimento);
    const v = Math.abs(Number(l.valorLancamento));
    if (ehSaldo(l)) {
      if (data && Number.isFinite(v)) saldo = { valor: Math.round(sinalDe(l) * v * 100) / 100, data };
      continue;
    }
    const motivo = foraDoExtrato(l);
    if (motivo) {
      fora.push({ tipo: motivo, descricao: textoHistorico(l) || null, valor: Number.isFinite(v) ? Math.round(sinalDe(l) * v * 100) / 100 : null, data });
      continue;
    }
    const x = lancamentoDe(l);
    if (!x) invalidos++;
    else if (x.zerado) zerados++;
    else lancamentos.push(x);
  }
  const atual = Number(corpo?.numeroPaginaAtual) || null;
  const proxima = Number(corpo?.numeroPaginaProximo) || 0;
  const total = Number(corpo?.quantidadeTotalPagina) || null;
  return {
    lancamentos, saldo, fora, zerados, invalidos,
    paginaAtual: atual, proximaPagina: proxima > 0 && (!atual || proxima > atual) ? proxima : (total && atual && atual < total ? atual + 1 : 0),
    totalRegistros: Number(corpo?.quantidadeTotalRegistro) || null
  };
}

/** O nome da app key nas APIs antigas do BB: gw-dev-app-key na homologação, gw-app-key em produção (a Extratos v2 usa gw-dev-app-key nos dois). */
const nomeDaAppKey = ambiente => (ambiente === 'producao' ? 'gw-app-key' : 'gw-dev-app-key');

/** O token OAuth (client_credentials). */
async function pedirToken({ transporte, urlOauth, clientId, clientSecret, escopo }) {
  if (!clientId || !clientSecret) throw erro('Faltam o client_id ou o client_secret do BB.', 409);
  const resposta = await transporte(urlOauth, {
    metodo: 'POST',
    cabecalhos: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'
    },
    corpo: `grant_type=client_credentials${escopo ? `&scope=${encodeURIComponent(escopo)}` : ''}`
  });
  const corpo = lerJson(resposta);
  if (resposta.status < 200 || resposta.status >= 300) {
    const detalhe = mensagemDoBB(corpo);
    if (resposta.status === 400 || resposta.status === 401) {
      throw erro(`O BB recusou as credenciais ou o escopo (${resposta.status})${detalhe ? `: ${detalhe}` : ''}. Confira client_id, client_secret e se a API está na aplicação do portal.`, 401, { http: resposta.status });
    }
    throw erro(`O OAuth do BB respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : ''}.`, 502, { http: resposta.status });
  }
  if (!corpo?.access_token) throw erro('O BB não devolveu o token de acesso.', 502);
  return { valor: corpo.access_token, tipo: corpo.token_type || 'Bearer', escopos: String(corpo.scope || escopo || '').split(/\s+/).filter(Boolean), expiraEmMs: Number(corpo.expires_in || 600) * 1000 - FOLGA_TOKEN_MS };
}

function lerJson(resposta) {
  const t = Buffer.isBuffer(resposta?.corpo) ? resposta.corpo.toString('utf8') : String(resposta?.corpo ?? '');
  if (!t.trim()) return null;
  try { return JSON.parse(t); } catch (_) { return { bruto: t.slice(0, 2000) }; }
}

/**
 * Um GET na API com o token e a app key; erro com a mensagem do BB.
 * `nomeAppKey` (padrão: o do ambiente) e `cabecalhos` extras são da v2.
 */
async function chamarApi({ transporte, url, token, appKey, ambiente, query = {}, nomeAppKey = null, cabecalhos = {} }) {
  if (!appKey) throw erro('Falta a app key do BB.', 409);
  const nome = nomeAppKey || nomeDaAppKey(ambiente);
  const params = new URLSearchParams();
  params.set(nome, appKey);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const resposta = await transporte(`${url}?${params.toString()}`, {
    metodo: 'GET',
    cabecalhos: { Authorization: `${token.tipo} ${token.valor}`, [nome]: appKey, Accept: 'application/json', ...cabecalhos }
  });
  const corpo = lerJson(resposta);
  if (resposta.status === 404) return { vazio: true, corpo };
  if (resposta.status < 200 || resposta.status >= 300) {
    const detalhe = mensagemDoBB(corpo);
    const dica = resposta.status === 403
      ? ` Confira se a cadeia do certificado foi enviada na aplicação do portal NESTE ambiente, se a API Extratos está nela${ambiente === 'producao' ? ' e se o envio para produção foi concluído' : ' e se a conta é uma das contas de teste do BB'}.`
      : '';
    throw erro(`O BB respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : ''}.${dica}`, resposta.status >= 500 ? 502 : 422, { http: resposta.status, bb: corpo });
  }
  return { vazio: false, corpo };
}

/** O endereço da consulta da conta. Pura. */
function urlDaConta(base, agencia, conta) {
  const ag = digitos(agencia).replace(/^0+(?=\d)/, '');
  const cc = digitos(conta).replace(/^0+(?=\d)/, '');
  if (!ag || !cc) throw erro('Informe agência e conta (sem o dígito) na configuração do extrato.', 409);
  return `${String(base).replace(/\/+$/, '')}/conta-corrente/agencia/${ag}/conta/${cc}`;
}

/**
 * Todos os lançamentos de um período (em consultas de até 31 dias, páginas
 * até acabar). Devolve o extrato no formato do leitor do OFX (`{ banco,
 * agencia, conta, inicio, fim, saldo, lancamentos, fora, zerados, invalidos
 * }`), as páginas brutas (a evidência) e `semLancamentos` quando o BB
 * respondeu 404 em todas as consultas. `mciTeste` vai só fora da produção.
 */
async function buscarPeriodo({ transporte, urlOauth, urlApi, credenciais, escopo, ambiente, agencia, conta, mciTeste = null, inicio, fim, porPagina = POR_PAGINA }) {
  if (!inicio || !fim || inicio > fim) throw erro('Período inválido para o extrato.', 400);
  const producao = ambiente === 'producao';
  if (!producao && !mciTeste) throw erro('Na homologação do BB a consulta precisa do código da conta de teste (x-br-com-bb-ipa-mciteste): use uma das contas de teste da documentação.', 409);
  const token = await pedirToken({ transporte, urlOauth, clientId: credenciais.clientId, clientSecret: credenciais.secret, escopo });
  const url = urlDaConta(urlApi, agencia, conta);
  const cabecalhos = { 'Content-Type': 'application/json', ...(producao ? {} : { [CABECALHO_TESTE]: String(mciTeste) }) };
  const extrato = { banco: '001', agencia: digitos(agencia), conta: digitos(conta), moeda: 'BRL', inicio, fim, saldo: null, lancamentos: [], fora: [], zerados: 0, invalidos: 0 };
  const paginas = [];
  let consultas = 0;
  let vazias = 0;
  for (const janela of janelas(inicio, fim)) {
    let pagina = 1;
    for (let i = 0; i < MAX_PAGINAS && pagina; i++) {
      consultas++;
      const r = await chamarApi({
        transporte, url, token, appKey: credenciais.appKey, ambiente, nomeAppKey: APP_KEY_EXTRATO, cabecalhos,
        query: { numeroPaginaSolicitacao: pagina, quantidadeRegistroPaginaSolicitacao: porPagina, dataInicioSolicitacao: dataBB(janela.inicio), dataFimSolicitacao: dataBB(janela.fim) }
      });
      if (r.vazio) { vazias++; break; }
      paginas.push(r.corpo);
      const lida = lerPagina(r.corpo);
      extrato.lancamentos.push(...lida.lancamentos);
      extrato.fora.push(...lida.fora);
      extrato.zerados += lida.zerados;
      extrato.invalidos += lida.invalidos;
      if (lida.saldo) extrato.saldo = lida.saldo;
      pagina = lida.proximaPagina;
    }
  }
  return { extrato, paginas, escopos: token.escopos, consultas, semLancamentos: consultas > 0 && vazias === consultas };
}

module.exports = {
  POR_PAGINA, MAX_PAGINAS, MAX_DIAS_POR_CONSULTA, APP_KEY_EXTRATO, CABECALHO_TESTE,
  dataBB, lerDataBB, janelas, ehSaldo, foraDoExtrato, sinalDe, documentoContrapartida, lancamentoDe, lerPagina,
  nomeDaAppKey, pedirToken, chamarApi, urlDaConta, buscarPeriodo
};
