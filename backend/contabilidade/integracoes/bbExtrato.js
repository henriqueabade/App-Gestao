/**
 * Extrato da conta corrente pela API de Extratos do Banco do Brasil (etapa
 * 11). O que o BB informou ao dono (plano, seção Q, item 5): cada lançamento
 * traz numeroDocumento, textoIdentificadorUnicoTransacao,
 * numeroCpfCnpjContrapartida / indicadorTipoPessoaContrapartida,
 * dataLancamento / dataMovimento / valorLancamento, indicadorTipoLancamento /
 * codigoHistorico / codigoSubHistorico / textoDescricaoHistorico e
 * codigoIdentificadorSistemaPagamento; não traz SISBB, EndToEndId nem dados
 * do boleto.
 *
 *   token ..... OAuth2 client_credentials (Basic client_id:client_secret),
 *               escopo "extrato-info" (trocável na tela);
 *   consulta .. GET {api}/conta-corrente/agencia/{agencia}/conta/{conta}
 *               ?numeroPaginaSolicitacao=&quantidadeRegistroPaginaSolicitacao=
 *               &dataInicioSolicitacao=&dataFimSolicitacao=  (datas DDMMAAAA,
 *               sem o zero à esquerda do dia), com a app key
 *               (gw-dev-app-key na homologação, gw-app-key em produção);
 *   mTLS ...... o certificado da empresa na conexão, quando o BB pedir.
 *
 * Cada lançamento vira o mesmo objeto que o leitor do OFX devolve, e a
 * gravação é a do extrato (extrato.js): mesma identidade, sem repetir o que
 * já entrou pelo OFX. As linhas de saldo ("Saldo Anterior", "S A L D O")
 * não são lançamentos: o último saldo vira o saldo do banco.
 *
 * Puro, com o transporte injetado (rede.js); nada aqui guarda segredo.
 */
const { mensagemDoBB } = require('../../cobranca/bbCliente');

const POR_PAGINA = 200;
const MAX_PAGINAS = 50;
const FOLGA_TOKEN_MS = 60 * 1000;

function erro(mensagem, status = 502, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

const digitos = v => String(v ?? '').replace(/\D/g, '');

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

const SALDO = /^(saldo anterior|saldo do dia|saldo|s\s*a\s*l\s*d\s*o)\b/i;

/** É a linha de saldo (e não um lançamento)? Pura. */
function ehSaldo(l) {
  const texto = String(l?.textoDescricaoHistorico || '').trim();
  const codigo = Number(l?.codigoHistorico);
  return SALDO.test(texto) && (codigo === 0 || codigo === 999 || !l?.numeroDocumento || Number(l.numeroDocumento) === 0);
}

/** O sinal do lançamento: D/débito negativo, C/crédito positivo. Pura. */
function sinalDe(l) {
  for (const campo of ['indicadorSinalLancamento', 'indicadorTipoLancamento', 'indicadorCreditoDebito']) {
    const v = String(l?.[campo] ?? '').trim().toUpperCase();
    if (v === 'D' || v === 'DEBITO' || v === 'DÉBITO' || v === '-') return -1;
    if (v === 'C' || v === 'CREDITO' || v === 'CRÉDITO' || v === '+') return 1;
  }
  const bruto = Number(l?.valorLancamento);
  return Number.isFinite(bruto) && bruto < 0 ? -1 : 1;
}

/** Um lançamento da API → o formato do leitor do OFX (+ os campos que só a API tem). Pura. */
function lancamentoDe(l) {
  const data = lerDataBB(l.dataLancamento) || lerDataBB(l.dataMovimento);
  const valorAbs = Math.abs(Number(String(l.valorLancamento ?? '').replace(',', '.')));
  if (!data || !Number.isFinite(valorAbs)) return null;
  const valor = Math.round(sinalDe(l) * valorAbs * 100) / 100;
  if (valor === 0) return { zerado: true };
  const documento = digitos(l.numeroDocumento).replace(/^0+(?=\d)/, '');
  const contrapartida = digitos(l.numeroCpfCnpjContrapartida);
  const tipoPessoa = String(l.indicadorTipoPessoaContrapartida || '').trim().toUpperCase();
  const descricao = [l.textoDescricaoHistorico, l.textoInformacaoComplementar].map(t => String(t ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return {
    data, valor, tipo: valor > 0 ? 'credito' : 'debito',
    tipo_banco: 'API',
    identificador: String(l.textoIdentificadorUnicoTransacao ?? '').trim() || null,
    documento: documento && documento !== '0' ? documento : null,
    descricao: [...new Set(descricao)].join(' — ') || null,
    contrapartida_documento: contrapartida && Number(contrapartida) > 0 ? contrapartida.padStart(tipoPessoa === 'F' ? 11 : 14, '0').slice(-14) : null,
    contrapartida_tipo: ['F', 'J'].includes(tipoPessoa) ? tipoPessoa : null,
    codigo_historico: l.codigoHistorico !== undefined && l.codigoHistorico !== null ? String(l.codigoHistorico).slice(0, 10) : null,
    codigo_sub_historico: l.codigoSubHistorico !== undefined && l.codigoSubHistorico !== null ? String(l.codigoSubHistorico).slice(0, 10) : null,
    sistema_pagamento: l.codigoIdentificadorSistemaPagamento !== undefined && l.codigoIdentificadorSistemaPagamento !== null ? String(l.codigoIdentificadorSistemaPagamento).slice(0, 20) : null
  };
}

/** Uma página da resposta: os lançamentos, o saldo (se veio) e a próxima página. Pura. */
function lerPagina(corpo) {
  const lista = Array.isArray(corpo?.listaLancamento) ? corpo.listaLancamento : (Array.isArray(corpo?.lancamentos) ? corpo.lancamentos : []);
  const lancamentos = [];
  let saldo = null;
  let zerados = 0;
  let invalidos = 0;
  for (const l of lista) {
    if (ehSaldo(l)) {
      const data = lerDataBB(l.dataLancamento) || lerDataBB(l.dataMovimento);
      const v = Math.abs(Number(l.valorLancamento));
      if (data && Number.isFinite(v)) saldo = { valor: Math.round(sinalDe(l) * v * 100) / 100, data };
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
    lancamentos, saldo, zerados, invalidos,
    paginaAtual: atual, proximaPagina: proxima > 0 && (!atual || proxima > atual) ? proxima : (total && atual && atual < total ? atual + 1 : 0),
    totalRegistros: Number(corpo?.quantidadeTotalRegistro) || null
  };
}

/** O cabeçalho da app key: gw-dev-app-key na homologação, gw-app-key em produção. */
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

/** Um GET na API com o token e a app key; erro com a mensagem do BB. */
async function chamarApi({ transporte, url, token, appKey, ambiente, query = {} }) {
  if (!appKey) throw erro('Falta a app key do BB.', 409);
  const params = new URLSearchParams();
  params.set(nomeDaAppKey(ambiente), appKey);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const resposta = await transporte(`${url}?${params.toString()}`, {
    metodo: 'GET',
    cabecalhos: { Authorization: `${token.tipo} ${token.valor}`, [nomeDaAppKey(ambiente)]: appKey, Accept: 'application/json' }
  });
  const corpo = lerJson(resposta);
  if (resposta.status === 404) return { vazio: true, corpo };
  if (resposta.status < 200 || resposta.status >= 300) {
    const detalhe = mensagemDoBB(corpo);
    throw erro(`O BB respondeu ${resposta.status}${detalhe ? `: ${detalhe}` : ''}.`, resposta.status >= 500 ? 502 : 422, { http: resposta.status, bb: corpo });
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
 * Todos os lançamentos de um período (páginas até acabar). Devolve o extrato
 * no formato do leitor do OFX (`{ banco, agencia, conta, inicio, fim, saldo,
 * lancamentos, zerados, invalidos }`) e as páginas brutas (a evidência).
 */
async function buscarPeriodo({ transporte, urlOauth, urlApi, credenciais, escopo, ambiente, agencia, conta, inicio, fim, porPagina = POR_PAGINA }) {
  if (!inicio || !fim || inicio > fim) throw erro('Período inválido para o extrato.', 400);
  const token = await pedirToken({ transporte, urlOauth, clientId: credenciais.clientId, clientSecret: credenciais.secret, escopo });
  const url = urlDaConta(urlApi, agencia, conta);
  const extrato = { banco: '001', agencia: digitos(agencia), conta: digitos(conta), moeda: 'BRL', inicio, fim, saldo: null, lancamentos: [], zerados: 0, invalidos: 0 };
  const paginas = [];
  let pagina = 1;
  for (let i = 0; i < MAX_PAGINAS && pagina; i++) {
    const r = await chamarApi({
      transporte, url, token, appKey: credenciais.appKey, ambiente,
      query: { numeroPaginaSolicitacao: pagina, quantidadeRegistroPaginaSolicitacao: porPagina, dataInicioSolicitacao: dataBB(inicio), dataFimSolicitacao: dataBB(fim) }
    });
    if (r.vazio) break;
    paginas.push(r.corpo);
    const lida = lerPagina(r.corpo);
    extrato.lancamentos.push(...lida.lancamentos);
    extrato.zerados += lida.zerados;
    extrato.invalidos += lida.invalidos;
    if (lida.saldo) extrato.saldo = lida.saldo;
    pagina = lida.proximaPagina;
  }
  return { extrato, paginas, escopos: token.escopos };
}

module.exports = { POR_PAGINA, MAX_PAGINAS, dataBB, lerDataBB, ehSaldo, sinalDe, lancamentoDe, lerPagina, nomeDaAppKey, pedirToken, chamarApi, urlDaConta, buscarPeriodo };
