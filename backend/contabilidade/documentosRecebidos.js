/**
 * Documentos fiscais RECEBIDOS (etapa 3): a NF-e de entrada (pelo XML ou só
 * pela chave), a NFS-e tomada (à mão, com o PDF) e os outros comprovantes de
 * despesa (recibo, guia de imposto, fatura).
 *
 * - O XML é lido por devolucoes/xmlDevolucao.lerNota (o mesmo leitor da nota
 *   de devolução e da NF-e de fora) e fica guardado como arquivo OFICIAL.
 * - O emitente vira CONTATO (fornecedor) quando ainda não existe: o cadastro
 *   de terceiros é o módulo Contatos. A NF-e cria "Fornecedor"; a NFS-e,
 *   "Prestador de serviço".
 * - Competência fiscal = mês da emissão. Competência fechada recusa.
 * - A nota pode gerar a conta a pagar junto (as duplicatas do XML viram as
 *   parcelas). A NFS-e de comissão/produção NÃO gera conta: ela se liga ao
 *   pagamento do fechamento (financeiro_pagamentos), que já é a saída.
 * - Excluir é marcar (com motivo); a conta a pagar ligada, sem pagamento, é
 *   cancelada junto.
 * - 5.4 do dono (fase A, 02/10/2026): antes de lançar conta nova, a nota
 *   procura a conta que já existe para ela (lançada à mão ou paga pelo
 *   extrato) ou o pagamento de comissão/produção — mesmo fornecedor (ou
 *   CNPJ/CPF), mesmo valor e data perto. Um só: liga. Mais de um: não lança
 *   nada e avisa (a escolha é na ficha).
 */
const c = require('../financeiro/comum');
const b = require('./base');
const eventos = require('./eventos');
const arquivos = require('./arquivos');
const titulos = require('./titulos');
const motor = require('./conciliacao/motor');
const { valorAPagar } = require('./conciliacao/liquidacoes');
// Aviso no sino de "algo seu" (01/10/2026).
const sino = require('../avisosEnvolvidos');
const regras = require('./classificacao/regras');
const xmlNota = require('../devolucoes/xmlDevolucao');
const externas = require('../fiscal/externas');
const { UFS } = require('../fiscal/municipios');

const TIPOS = { nfe: 'NF-e', nfse: 'NFS-e', outro: 'Outro documento' };
// sefaz/adn: registrados pela busca automática (etapas 10 e 13), com o XML oficial.
const ORIGENS = { xml: 'XML', chave: 'Chave de acesso', manual: 'Digitado', sefaz: 'SEFAZ (automático)', adn: 'ADN (automático)' };
const ESPECIES = { recibo: 'Recibo', guia: 'Guia de imposto', fatura: 'Fatura', contrato: 'Contrato', outro: 'Outro' };
/** Os municípios em que a empresa toma NFS-e (resposta do dono, 28/09/2026); outro é digitado. */
const MUNICIPIOS_NFSE = ['Contagem', 'Belo Horizonte'];
const TIPOS_FECHAMENTO = { comissao: 'Comissões', producao: 'Produção' };
const TIPOS_COMISSAO = { cms: 'CMS', royalty: 'Royalty' };

const num = v => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const vivo = d => d && !d.excluido_em;

/** A categoria do arquivo que prova cada tipo de documento. */
function categoriaDoArquivo(tipo, especie) {
  if (tipo === 'nfse') return 'nfse';
  if (tipo === 'nfe') return 'nota';
  return { recibo: 'recibo', guia: 'guia', contrato: 'contrato' }[especie] || 'outro';
}

// ------------------------------------------------------------------ leitura do XML

/**
 * A NF-e de ENTRADA lida do XML: o que `lerNota` já dá + endereço, IE,
 * telefone e fantasia do emitente, as duplicatas (cobr/dup) e os tributos
 * que a contabilidade olha. Pura.
 */
function lerNfeEntrada(xml) {
  const nota = xmlNota.lerNota(xml);
  const inf = xmlNota.bloco(xml, 'infNFe');
  const emit = xmlNota.bloco(inf, 'emit');
  const ender = xmlNota.bloco(emit, 'enderEmit');
  const tot = xmlNota.bloco(xmlNota.bloco(inf, 'total'), 'ICMSTot');
  const uf = xmlNota.campo(ender, 'UF');
  const cep = b.digitos(xmlNota.campo(ender, 'CEP'));
  const duplicatas = xmlNota.blocos(xmlNota.bloco(inf, 'cobr'), 'dup').map(d => ({
    numero: xmlNota.campo(d, 'nDup') || null,
    vencimento: String(xmlNota.campo(d, 'dVenc') || '').slice(0, 10) || null,
    valor: c.centavos(num(xmlNota.campo(d, 'vDup')))
  })).filter(d => d.valor > 0);
  return {
    ...nota,
    data_emissao: c.dia(nota.data_emissao),
    emitente_fantasia: xmlNota.campo(emit, 'xFant') || null,
    emitente_ie: xmlNota.campo(emit, 'IE') || null,
    emitente_telefone: xmlNota.campo(ender, 'fone') || null,
    emitente_endereco: {
      rua: xmlNota.campo(ender, 'xLgr') || null,
      numero: xmlNota.campo(ender, 'nro') || null,
      complemento: xmlNota.campo(ender, 'xCpl') || null,
      bairro: xmlNota.campo(ender, 'xBairro') || null,
      cidade: xmlNota.campo(ender, 'xMun') || null,
      codigo_municipio: xmlNota.campo(ender, 'cMun') || null,
      estado: UFS[uf] || uf || null,
      pais: xmlNota.campo(ender, 'xPais') ? (/brasil/i.test(xmlNota.campo(ender, 'xPais')) ? 'Brasil' : xmlNota.campo(ender, 'xPais')) : 'Brasil',
      cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : (cep || null)
    },
    duplicatas,
    valor_icms: c.centavos(num(xmlNota.campo(tot, 'vICMS'))),
    valor_ipi: c.centavos(num(xmlNota.campo(tot, 'vIPI'))),
    valor_frete: c.centavos(num(xmlNota.campo(tot, 'vFrete'))),
    valor_desconto: c.centavos(num(xmlNota.campo(tot, 'vDesc'))),
    cfops: [...new Set(nota.itens.map(i => i.cfop).filter(Boolean))]
  };
}

/**
 * O que impede ou chama atenção numa NF-e de entrada. `bloqueios` impedem o
 * registro; `avisos` só aparecem. Pura.
 */
function conferirNfeEntrada(nota, { cnpjEmpresa = null, chavesRegistradas = [] } = {}) {
  const bloqueios = [];
  const avisos = [];
  const empresa = b.digitos(cnpjEmpresa);
  if (nota.modelo && !['55', '65'].includes(String(nota.modelo))) bloqueios.push(`Modelo ${nota.modelo}: aqui entram NF-e (55) e NFC-e (65).`);
  if (String(nota.modelo) === '65') avisos.push('É uma NFC-e (cupom): confira se a contabilidade aceita como documento da compra.');
  if (!nota.data_emissao) bloqueios.push('A nota não traz a data de emissão.');
  if (empresa && nota.emitente_documento === empresa) bloqueios.push('Esta nota foi emitida pela própria empresa: é NF-e de saída, não de entrada.');
  if (empresa && nota.destinatario_documento && nota.destinatario_documento !== empresa) {
    bloqueios.push(`Esta nota não foi emitida para a empresa (o destinatário é ${b.documentoFormatado(nota.destinatario_documento)}).`);
  }
  if (!empresa) avisos.push('A configuração fiscal não tem o CNPJ da empresa: não deu para conferir o destinatário.');
  if (chavesRegistradas.includes(nota.chave_acesso)) bloqueios.push('Esta NF-e já foi registrada.');
  if (!nota.protocolo || String(nota.codigo_status) !== '100') avisos.push('O XML não traz o protocolo de autorização da SEFAZ (peça ao fornecedor o XML autorizado).');
  if (nota.finalidade === 4) avisos.push('A nota está marcada como devolução (finalidade 4): confira se é mesmo uma compra.');
  if (!nota.itens.length) avisos.push('A nota não tem itens.');
  if (nota.duplicatas.length) {
    const soma = c.centavos(nota.duplicatas.reduce((s, d) => s + d.valor, 0));
    if (Math.abs(soma - nota.valor_total) > 0.009) avisos.push(`As duplicatas somam ${c.reais(soma)} e a nota ${c.reais(nota.valor_total)}: as parcelas seguem as duplicatas.`);
  }
  return { bloqueios, avisos };
}

/**
 * As parcelas sugeridas para a conta: as duplicatas do XML (vencimento sem
 * data vira a emissão) ou uma parcela só no vencimento dado (ou na emissão).
 * Pura.
 */
function parcelasSugeridas({ duplicatas = [], valorTotal, emissao, vencimento = null }) {
  if (duplicatas.length) {
    return duplicatas.map((d, i) => ({ numero: i + 1, vencimento: c.dataValida(d.vencimento) ? d.vencimento : emissao, valor: d.valor, linha_digitavel: null }));
  }
  return [{ numero: 1, vencimento: c.dataValida(vencimento) ? vencimento : emissao, valor: c.centavos(valorTotal), linha_digitavel: null }];
}

// ------------------------------------------------------------------ entradas digitadas

function dataDaEntrada(v, rotulo = 'a data de emissão') {
  const d = String(v || '').slice(0, 10);
  if (!c.dataValida(d)) throw c.erro(`Informe ${rotulo}.`);
  return d;
}

function valorDaEntrada(v, rotulo = 'o valor total') {
  const n = b.valorDe(v);
  if (!(n > 0)) throw c.erro(`Informe ${rotulo}.`);
  return n;
}

function opcionalNaoNegativo(v, rotulo) {
  if (v === null || v === undefined || v === '') return null;
  const n = b.valorDe(v);
  if (n === null || n < 0) throw c.erro(`${rotulo} inválido.`);
  return n;
}

/** NF-e só pela chave: o que a chave diz + data e valor digitados. Pura. */
function nfeDaChave(entrada = {}) {
  const lida = externas.lerChave(entrada.chave);
  if (!['55', '65'].includes(lida.modelo)) throw c.erro(`A chave é de modelo ${lida.modelo}: aqui entram NF-e (55) e NFC-e (65).`);
  const data = dataDaEntrada(entrada.data_emissao);
  if (data.slice(0, 7) !== lida.mes_emissao) throw c.erro(`A chave diz que a nota é de ${c.rotuloCompetencia(lida.mes_emissao)}: confira a data de emissão.`);
  return {
    tipo: 'nfe', origem: 'chave', chave_acesso: lida.chave_acesso, modelo: lida.modelo, serie: String(lida.serie), numero: String(lida.numero),
    emitente_documento: lida.emitente_documento, emitente_nome: c.texto(entrada.emitente_nome, 200) || null,
    data_emissao: data, valor_total: valorDaEntrada(entrada.valor_total)
  };
}

/** NFS-e digitada (Contagem, Belo Horizonte…). Pura. */
function nfseDigitada(entrada = {}) {
  const numero = c.texto(entrada.numero, 20);
  if (!numero) throw c.erro('Informe o número da NFS-e.');
  const municipio = c.texto(entrada.municipio, 80);
  if (!municipio) throw c.erro('Informe o município da NFS-e.');
  return {
    tipo: 'nfse', origem: 'manual', numero, municipio, codigo_verificacao: c.texto(entrada.codigo_verificacao, 40) || null,
    emitente_documento: b.digitos(entrada.emitente_documento).slice(0, 14) || null, emitente_nome: c.texto(entrada.emitente_nome, 200) || null,
    data_emissao: dataDaEntrada(entrada.data_emissao), valor_total: valorDaEntrada(entrada.valor_total, 'o valor dos serviços'),
    valor_iss: opcionalNaoNegativo(entrada.valor_iss, 'ISS'), iss_retido: entrada.iss_retido === true || entrada.iss_retido === 'true',
    valor_retencoes: opcionalNaoNegativo(entrada.valor_retencoes, 'Retenções'), descricao: String(entrada.descricao ?? '').trim().slice(0, 2000) || null
  };
}

/** Recibo, guia, fatura… Pura. */
function outroDigitado(entrada = {}) {
  const especie = ESPECIES[entrada.especie] ? entrada.especie : 'recibo';
  const descricao = String(entrada.descricao ?? '').trim().slice(0, 2000);
  if (descricao.length < 3) throw c.erro('Diga do que se trata o documento.');
  return {
    tipo: 'outro', especie, origem: 'manual', numero: c.texto(entrada.numero, 20) || null,
    emitente_documento: b.digitos(entrada.emitente_documento).slice(0, 14) || null, emitente_nome: c.texto(entrada.emitente_nome, 200) || null,
    data_emissao: dataDaEntrada(entrada.data_emissao), valor_total: valorDaEntrada(entrada.valor_total), descricao
  };
}

// ------------------------------------------------------------------ o que a tela vê

function rotuloDoDocumento(d) {
  if (d.tipo === 'nfe') return `NF-e ${d.serie ? `${d.serie}/` : ''}${d.numero || '—'}`;
  if (d.tipo === 'nfse') return `NFS-e ${d.numero || '—'}`;
  return `${ESPECIES[d.especie] || 'Documento'}${d.numero ? ` ${d.numero}` : ''}`;
}

function rotuloDoPagamentoDeFechamento(p, fechamento) {
  const tipo = TIPOS_FECHAMENTO[fechamento?.tipo || p.tipo] || 'Fechamento';
  const quem = p.beneficiario ? ` — ${p.beneficiario}${p.tipo_comissao ? ` (${TIPOS_COMISSAO[p.tipo_comissao] || p.tipo_comissao})` : ''}` : (p.tipo_comissao ? ` — ${TIPOS_COMISSAO[p.tipo_comissao]}` : '');
  return `${tipo} de ${c.rotuloCompetencia(String(p.competencia || fechamento?.competencia || '').trim())}${quem}`;
}

/**
 * Uma linha da lista. `titulos` são as contas (cruas) ligadas; `arquivosMapa`
 * é o de arquivos.porAlvo; `noCartao` (fase G) os ids das notas de compras no
 * cartão (pagas pela fatura: não pedem conta a pagar). Pura.
 */
function linhaDoDocumento(d, { contatos = new Map(), titulosPorDocumento = new Map(), arquivosMapa = new Map(), pagamentosFechamento = new Map(), noCartao = new Set() } = {}) {
  const contato = d.contato_id !== null && d.contato_id !== undefined ? contatos.get(String(d.contato_id)) || null : null;
  const doArquivo = arquivosMapa.get(`documento_recebido:${d.id}`) || [];
  const conta = (titulosPorDocumento.get(String(d.id)) || []).find(t => t.status !== 'cancelado') || null;
  const pagFech = d.financeiro_pagamento_id ? pagamentosFechamento.get(String(d.financeiro_pagamento_id)) || null : null;
  const temXml = doArquivo.some(a => a.categoria === 'xml_nfe');
  return {
    id: d.id, tipo: d.tipo, tipo_rotulo: TIPOS[d.tipo] || d.tipo, especie: d.especie || null, origem: d.origem, origem_rotulo: ORIGENS[d.origem] || d.origem,
    rotulo: rotuloDoDocumento(d), chave_acesso: d.chave_acesso || null, numero: d.numero || null, serie: d.serie || null,
    municipio: d.municipio || null, codigo_verificacao: d.codigo_verificacao || null,
    emitente: contato?.nome || d.emitente_nome || null, emitente_documento: b.documentoFormatado(d.emitente_documento || contato?.cnpj || contato?.cpf),
    contato_id: d.contato_id ?? null, data_emissao: c.dia(d.data_emissao), competencia: d.competencia,
    valor_total: c.centavos(d.valor_total), valor_iss: d.valor_iss === null || d.valor_iss === undefined ? null : c.centavos(d.valor_iss),
    iss_retido: d.iss_retido === true || d.iss_retido === 'true', valor_retencoes: d.valor_retencoes === null || d.valor_retencoes === undefined ? null : c.centavos(d.valor_retencoes),
    descricao: d.descricao || null, cfops: d.cfops || null, protocolo: d.protocolo || null,
    sem_pagamento: d.sem_pagamento === true || d.sem_pagamento === 'true',
    titulo: conta ? { id: conta.id, descricao: conta.descricao, status: conta.status } : null,
    financeiro_pagamento: pagFech,
    arquivos: doArquivo.length, tem_xml: temXml,
    falta_xml: d.tipo === 'nfe' && !temXml,
    falta_arquivo: d.tipo !== 'nfe' && !doArquivo.length,
    sem_conta: !conta && !d.financeiro_pagamento_id && !(d.sem_pagamento === true || d.sem_pagamento === 'true') && !noCartao.has(String(d.id)),
    no_cartao: noCartao.has(String(d.id)),
    observacao: d.observacao || null,
    criado_em: b.instanteBR(d.criado_em)
  };
}

// ------------------------------------------------------------------ 5.4: a conta que já existe

/** Até quantos dias da emissão a conta (emissão ou vencimento) ou o pagamento podem estar. */
const DIAS_PAR = 30;

/**
 * Quem recebeu a comissão é o emitente da nota? A regra do nome da
 * conciliação, ou todas as palavras do nome curto ("Ana") no nome inteiro
 * ("Ana Souza"). Pura.
 */
function mesmaPessoa(curto, inteiro) {
  if (motor.nomeNaDescricao(curto, inteiro) || motor.nomeNaDescricao(inteiro, curto)) return true;
  const palavras = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(p => p.length >= 3);
  const doCurto = palavras(curto);
  const doInteiro = new Set(palavras(inteiro));
  return doCurto.length > 0 && doCurto.every(p => doInteiro.has(p));
}

/**
 * O que já existe e pode ser desta nota (5.4 do dono). `contas` = [{ t
 * (titulo cru), parcelas, contato, movimento }] — `movimento` é o lançamento
 * do banco conciliado com o pagamento dela, quando há (a conta lançada do
 * extrato não tem fornecedor: o CPF/CNPJ ou o nome vêm do banco).
 * `pagamentos` = os de comissão/produção ainda sem nota. Valor: o total ou o
 * líquido das retenções. Pura.
 */
function paresDaNota(doc, { contas = [], pagamentos = [] } = {}) {
  const cent = v => Math.round(Math.abs(Number(v) || 0) * 100);
  const valores = new Set([cent(doc.valor_total), cent(valorAPagar(doc))]);
  const emissao = c.dia(doc.data_emissao);
  const perto = d => Boolean(c.dia(d) && emissao) && Math.abs(motor.diasEntre(emissao, c.dia(d))) <= DIAS_PAR;
  const docDig = b.digitos(doc.emitente_documento);
  const nome = doc.emitente_nome || '';
  const pares = [];
  for (const { t, parcelas = [], contato = null, movimento = null } of contas) {
    if (!t || t.status === 'cancelado' || (t.documento_recebido_id !== null && t.documento_recebido_id !== undefined)) continue;
    if (!valores.has(cent(t.valor_total))) continue;
    if (!(perto(t.data_emissao) || parcelas.some(p => perto(p.vencimento)))) continue;
    const doContato = b.digitos(contato?.cnpj || contato?.cpf);
    const mesmo = (doc.contato_id !== null && doc.contato_id !== undefined && String(t.contato_id) === String(doc.contato_id))
      || (docDig && doContato === docDig)
      || (docDig && movimento && b.digitos(movimento.contrapartida_documento) === docDig)
      || ((t.contato_id === null || t.contato_id === undefined) && movimento && nome && motor.nomeNaDescricao(nome, movimento.descricao));
    if (mesmo) pares.push({ tipo: 'conta', id: t.id, rotulo: `a conta "${t.descricao}" (${c.reais(t.valor_total)})`, titulo: t });
  }
  for (const p of pagamentos) {
    if (!valores.has(cent(p.valor)) || !perto(p.data)) continue;
    if (p.beneficiario && nome && mesmaPessoa(p.beneficiario, nome)) {
      pares.push({ tipo: 'pagamento', id: p.id, rotulo: `o pagamento ${p.rotulo} (${c.reais(p.valor)})`, pagamento: p });
    }
  }
  return pares;
}

/** Lê o que `paresDaNota` precisa (sem o SQL de alguma parte, ela só não entra). */
async function lerParesDaNota(api, doc) {
  const [contasLidas, parcelas, pagamentos, vinculos, docs, contatos, fechamento] = await Promise.all([
    b.lerOpcional(api, 'titulos_pagar').then(x => x || []), b.lerOpcional(api, 'titulo_pagar_parcelas').then(x => x || []),
    b.lerOpcional(api, 'titulo_pagar_pagamentos').then(x => x || []), b.lerOpcional(api, 'conciliacao_vinculos').then(x => x || []),
    b.lerOpcional(api, 'documentos_recebidos').then(x => x || []), lerContatos(api), lerPagamentosDeFechamento(api)
  ]);
  const abertas = contasLidas.filter(t => t && t.status !== 'cancelado' && (t.documento_recebido_id === null || t.documento_recebido_id === undefined));
  const contas = [];
  for (const t of abertas) {
    const pags = pagamentos.filter(p => String(p.titulo_id) === String(t.id) && !p.estornado_em).map(p => String(p.id));
    const v = vinculos.find(x => !x.desfeito_em && x.alvo_tipo === 'titulo_pagamento' && pags.includes(String(x.alvo_id)));
    const movimento = v ? (await b.ler(api, 'movimentos_bancarios', { id: Number(v.movimento_id) }).catch(() => []))[0] || null : null;
    contas.push({ t, parcelas: parcelas.filter(p => String(p.titulo_id) === String(t.id)), contato: t.contato_id !== null && t.contato_id !== undefined ? contatos.get(String(t.contato_id)) || null : null, movimento });
  }
  const jaTemNota = new Set(docs.filter(d => vivo(d) && d.financeiro_pagamento_id && String(d.id) !== String(doc.id)).map(d => String(d.financeiro_pagamento_id)));
  return paresDaNota(doc, { contas, pagamentos: [...fechamento.values()].filter(p => !jaTemNota.has(String(p.id))) });
}

/** Liga a nota ao par achado. Mês fechado da conta: não liga (devolve o aviso). */
async function ligarPar(api, gravado, par, { contatoId = null, usuarioId = null, rotuloDoc }) {
  if (par.tipo === 'pagamento') {
    await b.atualizar(api, 'documentos_recebidos', gravado.id, { financeiro_pagamento_id: Number(par.id) });
    return { ligado: { tipo: 'pagamento', id: par.id, rotulo: par.rotulo }, aviso: null };
  }
  const t = par.titulo;
  try {
    await b.garantirAberta(api, t.competencia, 'ligar a nota à conta dela');
  } catch (e) {
    return { ligado: null, aviso: `${rotuloDoc} parece ser de ${par.rotulo}, mas ${e.message.charAt(0).toLowerCase()}${e.message.slice(1)}` };
  }
  await b.atualizar(api, 'titulos_pagar', t.id, {
    documento_recebido_id: Number(gravado.id), ...((t.contato_id === null || t.contato_id === undefined) && contatoId ? { contato_id: Number(contatoId) } : {}), atualizado_em: c.agora()
  });
  await eventos.registrar(api, {
    tipo: 'titulo_alterado', competencia: t.competencia, usuarioId, referenciaTipo: 'titulo', referenciaId: t.id,
    descricao: `${t.descricao}: ligada a ${rotuloDoc}, que chegou depois (a mesma conta, sem duplicar)`
  });
  return { ligado: { tipo: 'conta', id: t.id, rotulo: par.rotulo }, aviso: null };
}

// ------------------------------------------------------------------ leitura

/** O CNPJ da empresa, da configuração fiscal (a mesma da emissão de NF-e). */
async function cnpjDaEmpresa(api) {
  const cfg = await require('../fiscal/configuracaoFiscal').carregar(api).catch(() => null);
  return b.digitos(cfg?.cnpj) || null;
}

async function lerContatos(api) {
  return titulos.lerContatos(api);
}

/** Os pagamentos de comissão e produção (Financeiro) num Map id -> resumo; sem o SQL da fase G, vazio. */
async function lerPagamentosDeFechamento(api) {
  const [pagamentos, fechamentos] = await Promise.all([
    c.ler(api, 'financeiro_pagamentos').catch(() => []),
    c.ler(api, 'financeiro_fechamentos').catch(() => [])
  ]);
  const porId = new Map(fechamentos.map(f => [String(f.id), f]));
  return new Map(pagamentos.map(p => {
    const f = porId.get(String(p.fechamento_id)) || null;
    return [String(p.id), {
      id: p.id, tipo: p.tipo || f?.tipo || null, competencia: String(p.competencia || f?.competencia || '').trim(),
      beneficiario: p.beneficiario || null, tipo_comissao: p.tipo_comissao || null,
      valor: c.centavos(p.valor), data: c.dia(p.data_pagamento), forma: p.forma || null,
      rotulo: rotuloDoPagamentoDeFechamento(p, f)
    }];
  }));
}

async function lerTudo(api) {
  const [docs, contas, arquivosLista, vinculos, contatos, pagamentosFechamento, comprasCartao] = await Promise.all([
    b.ler(api, 'documentos_recebidos'), b.ler(api, 'titulos_pagar'), b.ler(api, 'contabil_arquivos'), b.ler(api, 'contabil_arquivo_vinculos'),
    lerContatos(api), lerPagamentosDeFechamento(api),
    // Fase G: as notas das compras no cartão (sem o SQL dela, nenhuma).
    b.lerOpcional(api, 'contabil_cartao_compras').then(x => x || []).catch(() => [])
  ]);
  const noCartao = new Set(comprasCartao.filter(x => x && x.documento_id !== null && x.documento_id !== undefined).map(x => String(x.documento_id)));
  const titulosPorDocumento = new Map();
  for (const t of contas) {
    if (t.documento_recebido_id === null || t.documento_recebido_id === undefined) continue;
    const k = String(t.documento_recebido_id);
    if (!titulosPorDocumento.has(k)) titulosPorDocumento.set(k, []);
    titulosPorDocumento.get(k).push(t);
  }
  return { docs, contatos, titulosPorDocumento, arquivosMapa: arquivos.porAlvo(arquivosLista, vinculos), pagamentosFechamento, noCartao };
}

async function listar(api, { competencia = null, tipo = null } = {}) {
  const tudo = await lerTudo(api);
  const comp = c.competenciaValida(competencia) ? String(competencia) : null;
  const linhas = tudo.docs.filter(vivo)
    .filter(d => (!comp || d.competencia === comp) && (!TIPOS[tipo] || d.tipo === tipo))
    .sort((x, y) => String(c.dia(y.data_emissao)).localeCompare(String(c.dia(x.data_emissao))) || Number(y.id) - Number(x.id))
    .map(d => linhaDoDocumento(d, tudo));
  const soma = l => c.centavos(l.reduce((s, d) => s + d.valor_total, 0));
  return {
    competencia: comp,
    linhas,
    totais: {
      nfe: { quantidade: linhas.filter(d => d.tipo === 'nfe').length, total: soma(linhas.filter(d => d.tipo === 'nfe')) },
      nfse: { quantidade: linhas.filter(d => d.tipo === 'nfse').length, total: soma(linhas.filter(d => d.tipo === 'nfse')) },
      outro: { quantidade: linhas.filter(d => d.tipo === 'outro').length, total: soma(linhas.filter(d => d.tipo === 'outro')) }
    }
  };
}

async function lerDocumento(api, id) {
  const d = (await b.ler(api, 'documentos_recebidos', { id: Number(id) }))[0] || null;
  if (!vivo(d)) throw c.erro('Documento não encontrado.', 404);
  return d;
}

async function detalhe(api, id) {
  const d = await lerDocumento(api, id);
  const tudo = await lerTudo(api);
  const [doArquivo, historico] = await Promise.all([
    arquivos.listar(api, { alvoTipo: 'documento_recebido', alvoId: d.id }),
    eventos.atividade({ api, referenciaTipo: 'documento_recebido', referenciaId: d.id, limite: 100 }).catch(() => [])
  ]);
  return { documento: { ...linhaDoDocumento(d, tudo), itens: c.jsonDe(d.itens, []) || [] }, arquivos: doArquivo, historico };
}

// ------------------------------------------------------------------ fornecedor

/**
 * O contato do emitente: o que já existe com o CNPJ/CPF, ou um novo
 * (Fornecedor para NF-e, Prestador de serviço para NFS-e) quando `criar`.
 * Sem o SQL dos Contatos, segue sem contato (com aviso).
 */
async function fornecedorDoEmitente(api, { documento, nome, fantasia = null, ie = null, telefone = null, endereco = null, tipoNome = 'Fornecedor', criar = true, usuarioId = null, origem = 'documento' }) {
  const d = b.digitos(documento);
  if (d.length !== 14 && d.length !== 11) return { contato: null, criado: false, aviso: null };
  const campo = d.length === 14 ? 'cnpj' : 'cpf';
  const achados = await api.get('/api/contatos', { query: { [campo]: d } }).then(c.lista).catch(() => null);
  if (achados === null) return { contato: null, criado: false, aviso: 'O módulo Contatos ainda não foi ativado no banco: o fornecedor não foi cadastrado.' };
  const achado = achados.find(x => x && x[campo] === d) || null;
  if (achado) return { contato: achado, criado: false, aviso: null };
  if (!criar || !c.texto(nome)) return { contato: null, criado: false, aviso: null };
  const contatos = require('../contatosController');
  const tipos = await api.get('/api/contato_tipos').then(c.lista).catch(() => []);
  const tipo = tipos.find(t => semAcento(t.nome) === semAcento(tipoNome)) || tipos.find(t => semAcento(t.nome) === 'outro') || tipos[0];
  if (!tipo) return { contato: null, criado: false, aviso: 'Não há tipos de contato cadastrados: o fornecedor não foi cadastrado.' };
  try {
    const payload = contatos.buildPayload({
      nome: c.texto(fantasia || nome, 150), razao_social: c.texto(nome, 200), tipo_id: tipo.id, tipo_pessoa: d.length === 11 ? 'PF' : 'PJ',
      [campo]: d, inscricao_estadual: ie, telefone_fixo: telefone, status: 'Ativo', endereco: endereco || undefined
    }, tipos);
    const id = await contatos.criarContato(api, payload, [], tipos, usuarioId, { observacao: `Cadastrado pela Contabilidade a partir de ${origem}` });
    return { contato: { id, nome: payload.nome, [campo]: d }, criado: true, aviso: null };
  } catch (e) {
    return { contato: null, criado: false, aviso: `O fornecedor não foi cadastrado automaticamente: ${e.message}` };
  }
}

/** Os contatos para escolher (fornecedor / prestador), com o tipo por extenso. */
async function fornecedores(api) {
  const [contatos, tipos] = await Promise.all([
    api.get('/api/contatos').then(c.lista).catch(() => null),
    api.get('/api/contato_tipos').then(c.lista).catch(() => [])
  ]);
  if (contatos === null) return { fornecedores: [], sql_pendente_contatos: true };
  const nomeDoTipo = new Map(tipos.map(t => [String(t.id), t.nome]));
  return {
    fornecedores: contatos.filter(Boolean)
      .map(x => ({
        id: x.id, nome: x.nome, razao_social: x.razao_social || null, documento: b.documentoFormatado(x.cnpj || x.cpf),
        tipo: nomeDoTipo.get(String(x.tipo_id)) || null, cidade: x.end_cidade || null, status: x.status || 'Ativo'
      }))
      .sort((x, y) => String(x.nome).localeCompare(String(y.nome), 'pt-BR')),
    sql_pendente_contatos: false
  };
}

/**
 * Os pagamentos de comissão e produção dos últimos meses, com quanto de
 * NFS-e já está ligado a cada um (para escolher a que a nota se refere).
 */
async function pagamentosDeFechamento(api, { hoje, meses = 6 } = {}) {
  const [mapa, docs] = await Promise.all([lerPagamentosDeFechamento(api), b.lerOpcional(api, 'documentos_recebidos')]);
  const desde = c.somarMeses(c.competenciaDe(hoje), -Math.max(1, Number(meses) || 6));
  const ligados = new Map();
  for (const d of (docs || []).filter(vivo)) {
    if (!d.financeiro_pagamento_id) continue;
    const k = String(d.financeiro_pagamento_id);
    ligados.set(k, c.centavos((ligados.get(k) || 0) + c.centavos(d.valor_total)));
  }
  return [...mapa.values()]
    .filter(p => p.data && p.data.slice(0, 7) >= desde)
    .map(p => ({ ...p, nfse_total: ligados.get(String(p.id)) || 0, falta: c.centavos(Math.max(0, p.valor - (ligados.get(String(p.id)) || 0))) }))
    .sort((x, y) => String(y.data).localeCompare(String(x.data)) || Number(y.id) - Number(x.id));
}

// ------------------------------------------------------------------ prévia e registro

/** A NF-e lida (XML ou chave) com o que a tela precisa para confirmar — nada é gravado. */
async function previa(api, { entrada = {}, hoje }) {
  const [empresa, docs] = await Promise.all([cnpjDaEmpresa(api), b.ler(api, 'documentos_recebidos')]);
  const chaves = docs.filter(vivo).map(d => d.chave_acesso).filter(Boolean);
  if (entrada.xml) {
    const nota = lerNfeEntrada(entrada.xml);
    const conferencia = conferirNfeEntrada(nota, { cnpjEmpresa: empresa, chavesRegistradas: chaves });
    const { contato } = await fornecedorDoEmitente(api, { documento: nota.emitente_documento, nome: nota.emitente_nome, criar: false });
    const competencia = String(nota.data_emissao || '').slice(0, 7);
    const fechada = await b.garantirAberta(api, competencia, 'registrar documentos nela').then(() => null).catch(e => e.message);
    if (fechada) conferencia.bloqueios.push(fechada);
    const categoriaSugerida = await regras.categoriaSugerida(api, { contato_id: contato?.id ?? null, cfops: nota.cfops }).catch(() => null);
    return {
      categoria_sugerida: categoriaSugerida,
      tipo: 'nfe', origem: 'xml', chave_acesso: nota.chave_acesso, modelo: nota.modelo, serie: nota.serie, numero: nota.numero,
      data_emissao: nota.data_emissao, competencia, natureza_operacao: nota.natureza_operacao,
      emitente: { documento: b.documentoFormatado(nota.emitente_documento), nome: nota.emitente_nome, fantasia: nota.emitente_fantasia, cidade: nota.emitente_endereco.cidade, estado: nota.emitente_endereco.estado },
      contato: contato ? { id: contato.id, nome: contato.nome } : null,
      valor_total: nota.valor_total, valor_produtos: nota.valor_produtos, valor_icms: nota.valor_icms, valor_ipi: nota.valor_ipi, valor_frete: nota.valor_frete,
      cfops: nota.cfops, protocolo: nota.protocolo,
      itens: nota.itens.slice(0, 200).map(i => ({ descricao: i.descricao, ncm: i.ncm, cfop: i.cfop, quantidade: i.quantidade, unidade: i.unidade, valor_total: i.valor_total })),
      duplicatas: nota.duplicatas,
      parcelas: parcelasSugeridas({ duplicatas: nota.duplicatas, valorTotal: nota.valor_total, emissao: nota.data_emissao }),
      ...conferencia
    };
  }
  const lida = nfeDaChave(entrada);
  const bloqueios = [];
  if (chaves.includes(lida.chave_acesso)) bloqueios.push('Esta NF-e já foi registrada.');
  if (empresa && lida.emitente_documento === empresa) bloqueios.push('Esta nota foi emitida pela própria empresa: é NF-e de saída, não de entrada.');
  const fechada = await b.garantirAberta(api, lida.data_emissao.slice(0, 7), 'registrar documentos nela').then(() => null).catch(e => e.message);
  if (fechada) bloqueios.push(fechada);
  const { contato } = await fornecedorDoEmitente(api, { documento: lida.emitente_documento, nome: lida.emitente_nome, criar: false });
  return {
    ...lida, competencia: lida.data_emissao.slice(0, 7),
    emitente: { documento: b.documentoFormatado(lida.emitente_documento), nome: contato?.nome || lida.emitente_nome || null },
    contato: contato ? { id: contato.id, nome: contato.nome } : null,
    itens: [], duplicatas: [], parcelas: parcelasSugeridas({ valorTotal: lida.valor_total, emissao: lida.data_emissao }),
    bloqueios, avisos: ['Sem o XML, a contabilidade fica sem o arquivo oficial da nota: anexe-o assim que tiver (fica como pendência documental).']
  };
}

/**
 * O documento a gravar (e o XML, quando há) a partir da entrada.
 * `automatico` ('sefaz' | 'adn') só vem do backend (a busca automática),
 * nunca da tela: marca a origem do documento.
 */
async function documentoDaEntrada(api, entrada, automatico = null) {
  const tipo = TIPOS[entrada.tipo] ? entrada.tipo : null;
  if (!tipo) throw c.erro('Escolha o tipo do documento (NF-e, NFS-e ou outro).');
  if (tipo === 'nfe' && entrada.xml) {
    const nota = lerNfeEntrada(entrada.xml);
    const [empresa, docs] = await Promise.all([cnpjDaEmpresa(api), b.ler(api, 'documentos_recebidos')]);
    const { bloqueios } = conferirNfeEntrada(nota, { cnpjEmpresa: empresa, chavesRegistradas: docs.filter(vivo).map(d => d.chave_acesso).filter(Boolean) });
    if (bloqueios.length) throw c.erro(bloqueios[0], 422, { bloqueios });
    return {
      nota,
      doc: {
        tipo: 'nfe', origem: automatico === 'sefaz' ? 'sefaz' : 'xml', chave_acesso: nota.chave_acesso, modelo: nota.modelo || null, serie: String(nota.serie ?? ''), numero: String(nota.numero ?? ''),
        emitente_documento: nota.emitente_documento || null, emitente_nome: nota.emitente_nome || null, data_emissao: nota.data_emissao,
        natureza_operacao: c.texto(nota.natureza_operacao, 120) || null, valor_total: nota.valor_total, valor_produtos: nota.valor_produtos,
        itens: JSON.stringify(nota.itens), cfops: nota.cfops.join(', ').slice(0, 120) || null, protocolo: nota.protocolo
      }
    };
  }
  if (tipo === 'nfe') {
    const lida = nfeDaChave(entrada);
    const empresa = await cnpjDaEmpresa(api);
    if (empresa && lida.emitente_documento === empresa) throw c.erro('Esta nota foi emitida pela própria empresa: é NF-e de saída, não de entrada.', 422);
    return { nota: null, doc: lida };
  }
  if (tipo === 'nfse') {
    const doc = nfseDigitada(entrada);
    if (automatico === 'adn') doc.origem = 'adn';
    return { nota: null, doc };
  }
  return { nota: null, doc: outroDigitado(entrada) };
}

/**
 * Registra o documento. Pode: cadastrar o fornecedor, guardar o XML/PDF,
 * gerar a conta a pagar (com `podeLancar`) e ligar a NFS-e ao pagamento de
 * um fechamento. O que falhar DEPOIS de o documento estar gravado vira aviso
 * (o documento fica; o resto se faz pela ficha dele).
 */
async function registrar(api, { entrada = {}, usuarioId = null, hoje, podeLancar = false, automatico = null }) {
  const { nota, doc } = await documentoDaEntrada(api, entrada, automatico);
  doc.competencia = String(doc.data_emissao).slice(0, 7);
  if (doc.data_emissao > c.dia(hoje)) throw c.erro('A data de emissão não pode ser futura.');
  await b.garantirAberta(api, doc.competencia, 'registrar documentos nela');

  // A NFS-e de comissão/produção: o pagamento do fechamento que ela documenta.
  let pagamentoFechamento = null;
  if (entrada.financeiro_pagamento_id !== undefined && entrada.financeiro_pagamento_id !== null && entrada.financeiro_pagamento_id !== '') {
    if (!/^\d+$/.test(String(entrada.financeiro_pagamento_id))) throw c.erro('Pagamento do fechamento inválido.');
    const mapa = await lerPagamentosDeFechamento(api);
    pagamentoFechamento = mapa.get(String(entrada.financeiro_pagamento_id)) || null;
    if (!pagamentoFechamento) throw c.erro('Pagamento de comissão/produção não encontrado.', 404);
  }
  const gerarTitulo = entrada.gerar_titulo === true && !pagamentoFechamento && !(entrada.sem_pagamento === true);
  if (gerarTitulo && !podeLancar) throw c.erro('Você não tem permissão para lançar contas a pagar.', 403);

  // O fornecedor: o escolhido na tela, o que já existe com o CNPJ ou um novo.
  const avisos = [];
  let contato = null;
  let contatoCriado = false;
  if (entrada.contato_id !== undefined && entrada.contato_id !== null && entrada.contato_id !== '') {
    contato = await api.get(`/api/contatos/${entrada.contato_id}`).catch(() => null);
    if (!contato || contato.error || String(contato.id) !== String(entrada.contato_id)) throw c.erro('Fornecedor não encontrado.', 404);
    doc.emitente_documento = doc.emitente_documento || b.digitos(contato.cnpj || contato.cpf) || null;
    doc.emitente_nome = doc.emitente_nome || contato.razao_social || contato.nome;
  } else if (doc.emitente_documento) {
    const r = await fornecedorDoEmitente(api, {
      documento: doc.emitente_documento, nome: doc.emitente_nome, fantasia: nota?.emitente_fantasia, ie: nota?.emitente_ie,
      telefone: nota?.emitente_telefone, endereco: nota?.emitente_endereco, tipoNome: doc.tipo === 'nfse' ? 'Prestador de serviço' : 'Fornecedor',
      criar: entrada.criar_fornecedor !== false, usuarioId, origem: rotuloDoDocumento(doc)
    });
    contato = r.contato;
    contatoCriado = r.criado;
    if (r.aviso) avisos.push(r.aviso);
  }

  let gravado;
  try {
    gravado = await b.inserir(api, 'documentos_recebidos', {
      ...doc, contato_id: contato?.id ?? null, financeiro_pagamento_id: pagamentoFechamento?.id ?? null,
      sem_pagamento: entrada.sem_pagamento === true, observacao: String(entrada.observacao ?? '').trim().slice(0, 1000) || null,
      criado_por: usuarioId, criado_em: c.agora()
    });
  } catch (e) {
    if (c.ehDuplicado(e)) throw c.erro(doc.tipo === 'nfe' ? 'Esta NF-e já foi registrada.' : 'Esta NFS-e (mesmo prestador, número e município) já foi registrada.', 409);
    throw e;
  }
  const ref = { alvo_tipo: 'documento_recebido', alvo_id: String(gravado.id) };

  // O XML (oficial quando tem o protocolo) e o arquivo enviado (PDF, foto).
  if (nota) {
    try {
      await arquivos.salvar(api, {
        nome: `${nota.chave_acesso}-procNFe.xml`, tipo: 'application/xml', base64: Buffer.from(String(entrada.xml), 'utf8').toString('base64'),
        categoria: 'xml_nfe', origem: nota.protocolo ? 'oficial' : 'fornecido', competencia: doc.competencia, vinculos: [ref], usuarioId, registrarEvento: false
      });
    } catch (e) {
      avisos.push(`O XML não foi guardado: ${e.message}. Anexe-o pela ficha do documento.`);
    }
  }
  if (entrada.arquivo?.base64) {
    try {
      // O XML que veio do ADN é o oficial; o que a pessoa anexa, fornecido.
      await arquivos.salvar(api, {
        nome: entrada.arquivo.nome, tipo: entrada.arquivo.tipo, base64: entrada.arquivo.base64, categoria: categoriaDoArquivo(doc.tipo, doc.especie),
        origem: automatico ? 'oficial' : 'fornecido', competencia: doc.competencia, vinculos: [ref], usuarioId, registrarEvento: false
      });
    } catch (e) {
      avisos.push(`O arquivo não foi guardado: ${e.message}. Anexe-o pela ficha do documento.`);
    }
  }

  // 5.4 (fase A): a conta ou o pagamento que já existe para esta nota — liga em vez de duplicar.
  let ligadoA = null;
  let duvida = false;
  if (!pagamentoFechamento && entrada.sem_pagamento !== true) {
    try {
      const pares = await lerParesDaNota(api, { ...doc, id: gravado.id, contato_id: contato?.id ?? null });
      if (pares.length === 1) {
        const r = await ligarPar(api, gravado, pares[0], { contatoId: contato?.id ?? null, usuarioId, rotuloDoc: rotuloDoDocumento(doc) });
        ligadoA = r.ligado;
        if (r.aviso) { avisos.push(r.aviso); duvida = true; }
      } else if (pares.length > 1) {
        duvida = true;
        avisos.push(`${rotuloDoDocumento(doc)} pode ser de ${pares.map(p => p.rotulo).join(' ou de ')}: nenhuma conta nova foi lançada. Confira qual é e ligue a nota à conta certa (ou lance a conta pela ficha do documento).`);
      }
    } catch (e) {
      avisos.push(`Não deu para procurar a conta que já existe para esta nota: ${e.message}`);
    }
  }

  // A conta a pagar, com as parcelas da tela (ou as duplicatas do XML).
  let tituloId = null;
  if (gerarTitulo && !ligadoA && !duvida) {
    const t = entrada.titulo || {};
    try {
      const parcelas = Array.isArray(t.parcelas) && t.parcelas.length ? t.parcelas
        : parcelasSugeridas({ duplicatas: nota?.duplicatas || [], valorTotal: doc.valor_total, emissao: doc.data_emissao, vencimento: t.primeiro_vencimento });
      const criado = await titulos.criar(api, {
        entrada: {
          descricao: c.texto(t.descricao, 200) || `${rotuloDoDocumento(doc)} — ${contato?.nome || doc.emitente_nome || 'fornecedor'}`,
          categoria: t.categoria, numero_documento: doc.numero || null, data_emissao: doc.data_emissao, competencia: doc.competencia,
          valor_total: c.centavos(parcelas.reduce((s, p) => s + (b.valorDe(p.valor) || 0), 0)), contato_id: contato?.id ?? null,
          documento_recebido_id: gravado.id, parcelas
        },
        usuarioId, hoje, origem: doc.tipo
      });
      tituloId = criado.id;
    } catch (e) {
      avisos.push(`O documento foi registrado, mas a conta a pagar não: ${e.message}`);
    }
  }

  if (contatoCriado) {
    await eventos.registrar(api, {
      tipo: 'fornecedor_cadastrado', competencia: doc.competencia, usuarioId, referenciaTipo: 'documento_recebido', referenciaId: gravado.id,
      descricao: `${contato.nome} (${b.documentoFormatado(doc.emitente_documento)}) cadastrado em Contatos a partir de ${rotuloDoDocumento(doc)}`
    });
  }
  await eventos.registrar(api, {
    tipo: 'documento_registrado', competencia: doc.competencia, usuarioId, referenciaTipo: 'documento_recebido', referenciaId: gravado.id,
    descricao: `${rotuloDoDocumento(doc)} de ${contato?.nome || doc.emitente_nome || 'emitente não informado'}: ${c.reais(doc.valor_total)} (${c.impressa(doc.data_emissao)})`
      + `${pagamentoFechamento ? ` — referente a ${pagamentoFechamento.rotulo}` : ''}${tituloId ? ' — com conta a pagar' : ''}`
      + `${ligadoA ? ` — ligada a ${ligadoA.rotulo}, que já existia` : ''}`
  });
  return {
    id: gravado.id, competencia: doc.competencia, contato_id: contato?.id ?? null, contato_criado: contatoCriado,
    titulo_id: tituloId ?? (ligadoA?.tipo === 'conta' ? ligadoA.id : null), ligado_a: ligadoA, avisos
  };
}

async function excluir(api, id, { motivo, usuarioId = null }) {
  const m = c.texto(motivo, 500);
  if (m.length < 5) throw c.erro('Diga por que o documento sai (ao menos 5 letras).');
  const d = await lerDocumento(api, id);
  await b.garantirAberta(api, d.competencia, 'excluir documentos dela');
  const contas = (await b.ler(api, 'titulos_pagar', { documento_recebido_id: Number(d.id) })).filter(t => t.status !== 'cancelado');
  for (const t of contas) {
    const pagos = (await b.ler(api, 'titulo_pagar_pagamentos', { titulo_id: Number(t.id) })).filter(p => !p.estornado_em);
    if (pagos.length) throw c.erro(`A conta "${t.descricao}" deste documento tem pagamento: estorne-o antes de excluir o documento.`, 409);
  }
  await b.atualizar(api, 'documentos_recebidos', d.id, { excluido_em: c.agora(), excluido_por: usuarioId, motivo_exclusao: m });
  // Quem lançou o documento recebe UM aviso (abaixo), com as contas que caíram junto.
  for (const t of contas) await titulos.cancelar(api, t.id, { motivo: `Documento excluído: ${m}`, usuarioId, avisar: String(t.criado_por) !== String(d.criado_por) });
  await eventos.registrar(api, {
    tipo: 'documento_excluido', competencia: d.competencia, usuarioId, referenciaTipo: 'documento_recebido', referenciaId: d.id,
    descricao: `${rotuloDoDocumento(d)} de ${d.emitente_nome || 'emitente'} (${c.reais(d.valor_total)}) excluído: ${m}${contas.length ? ` — ${c.plural(contas.length, 'conta cancelada', 'contas canceladas')} junto` : ''}`
  });
  await sino.avisarPessoa(api, {
    para: d.criado_por, usuarioId, origem: 'contabil', tipo: 'item_excluido', titulo: 'Um documento seu foi excluído',
    frase: autor => `${autor} excluiu ${rotuloDoDocumento(d)} de ${d.emitente_nome || 'emitente'} (${c.reais(d.valor_total)}) que você lançou na Contabilidade.`,
    mudancas: contas.map(t => `Conta cancelada junto: ${t.descricao}`),
    nota: `Motivo: ${m}`
  });
  return { id: d.id, excluido: true, contas_canceladas: contas.map(t => t.id) };
}

module.exports = {
  TIPOS, ORIGENS, ESPECIES, MUNICIPIOS_NFSE, TIPOS_FECHAMENTO,
  categoriaDoArquivo, lerNfeEntrada, conferirNfeEntrada, parcelasSugeridas, nfeDaChave, nfseDigitada, outroDigitado,
  rotuloDoDocumento, rotuloDoPagamentoDeFechamento, linhaDoDocumento, paresDaNota, lerParesDaNota,
  lerPagamentosDeFechamento, lerTudo, listar, detalhe, fornecedorDoEmitente, fornecedores, pagamentosDeFechamento, previa, registrar, excluir
};
