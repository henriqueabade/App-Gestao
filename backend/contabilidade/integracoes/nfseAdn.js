/**
 * NFS-e TOMADAS pelo Ambiente de Dados Nacional (etapa 13) — a API de
 * distribuição dos contribuintes do Sistema Nacional NFS-e:
 *
 *   GET {base}/DFe/{NSU}            (base = https://adn.nfse.gov.br/contribuintes;
 *                                    produção restrita: adn.producaorestrita…)
 *   autenticação: o e-CNPJ da empresa na conexão (mTLS) — o CNPJ vem do
 *   próprio certificado (o mesmo A1 da NF-e);
 *   resposta: StatusProcessamento + LoteDFe (até 50: NSU, ChaveAcesso,
 *   TipoDocumento, TipoEvento, ArquivoXml em gzip + base64, DataHoraGeracao)
 *   + Erros/Alertas (Manual dos Contribuintes — APIs do ADN, 12/02/2026).
 *
 * A empresa aparece como emitente, tomadora ou intermediária; aqui interessa
 * a tomadora (a nota de serviço que ela recebeu). O leitor aceita as chaves
 * do JSON com inicial maiúscula ou minúscula e trata "nenhum documento" com
 * HTTP 200 ou 404 — o formato exato se confirma no primeiro retorno real
 * (o teste de conexão mostra o bruto).
 *
 * Puro: quem chama passa o transporte com o certificado (rede.js).
 */
const zlib = require('zlib');

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

const digitos = v => String(v ?? '').replace(/\D/g, '');
const nsuTexto = v => digitos(v).replace(/^0+(?=\d)/, '') || '0';

/** Um campo do JSON pelo nome, com inicial maiúscula ou minúscula. */
function pegar(obj, nome) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj[nome] !== undefined) return obj[nome];
  const minusculo = nome.charAt(0).toLowerCase() + nome.slice(1);
  if (obj[minusculo] !== undefined) return obj[minusculo];
  const achado = Object.keys(obj).find(k => k.toLowerCase() === nome.toLowerCase());
  return achado ? obj[achado] : undefined;
}

/** O endereço da consulta a partir de um NSU. Pura. */
function urlDfe(base, nsu, { lote = true, cnpjConsulta = null } = {}) {
  const raiz = String(base || '').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(raiz)) throw erro('Endereço do ADN inválido.');
  const params = new URLSearchParams();
  if (lote) params.set('lote', 'true');
  if (cnpjConsulta) params.set('cnpjConsulta', digitos(cnpjConsulta));
  const q = params.toString();
  return `${raiz}/DFe/${nsuTexto(nsu)}${q ? `?${q}` : ''}`;
}

/** gzip + base64 → XML. */
function descompactar(base64) {
  const buffer = Buffer.from(String(base64 || '').replace(/\s+/g, ''), 'base64');
  try {
    return zlib.gunzipSync(buffer).toString('utf8');
  } catch (_) {
    // Há ambientes que mandam o XML só em base64 (sem gzip).
    const texto = buffer.toString('utf8');
    if (/^\s*</.test(texto)) return texto;
    throw erro('Um documento do ADN veio corrompido (não abre o gzip).', 502);
  }
}

/** Os erros/alertas do ADN como texto. */
function textoDosErros(lista) {
  return (Array.isArray(lista) ? lista : []).map(e => [pegar(e, 'Codigo'), pegar(e, 'Descricao'), pegar(e, 'Complemento')].filter(Boolean).join(' — ')).filter(Boolean).join(' | ');
}

/**
 * A resposta do ADN (HTTP + JSON) → `{ semDocumento, documentos, erros }`.
 * Recusa (400/401/403/5xx, StatusProcessamento REJEICAO) vira erro com o que
 * o ADN disse. Pura.
 */
function lerRetorno(status, corpo) {
  const dados = corpo && typeof corpo === 'object' ? corpo : {};
  const situacao = String(pegar(dados, 'StatusProcessamento') || '').toUpperCase();
  const erros = textoDosErros(pegar(dados, 'Erros'));
  const lote = pegar(dados, 'LoteDFe');
  const lista = Array.isArray(lote) ? lote : (Array.isArray(dados) ? dados : []);
  if (status === 404 || situacao.includes('NENHUM')) return { semDocumento: true, documentos: [], situacao: situacao || 'NENHUM_DOCUMENTO_LOCALIZADO', erros };
  if (status === 401 || status === 403) throw erro(`O ADN recusou o certificado (${status})${erros ? `: ${erros}` : ''}. Confira se o certificado é o e-CNPJ da empresa.`, 403, { http: status });
  if (status >= 400 || situacao.includes('REJEI')) {
    throw erro(`O ADN respondeu ${status}${situacao ? ` (${situacao})` : ''}${erros ? `: ${erros}` : (dados.bruto ? `: ${String(dados.bruto).slice(0, 200)}` : '')}.`, status >= 500 ? 502 : 422, { http: status });
  }
  const documentos = lista.map(item => ({
    nsu: nsuTexto(pegar(item, 'NSU')),
    chave: digitos(pegar(item, 'ChaveAcesso')) || null,
    tipoDocumento: String(pegar(item, 'TipoDocumento') || '').toUpperCase() || null,
    tipoEvento: pegar(item, 'TipoEvento') ? String(pegar(item, 'TipoEvento')) : null,
    dataHora: pegar(item, 'DataHoraGeracao') || null,
    xml: pegar(item, 'ArquivoXml') ? descompactar(pegar(item, 'ArquivoXml')) : null
  })).filter(d => d.nsu);
  return { semDocumento: documentos.length === 0, documentos, situacao: situacao || 'DOCUMENTOS_LOCALIZADOS', erros };
}

// ------------------------------------------------------------------ o XML da NFS-e

/** Texto de um elemento (ignora prefixo de namespace), ou null. */
function campo(xml, tag) {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${tag}>`).exec(String(xml || ''));
  return m ? m[1].trim() : null;
}

function bloco(xml, tag) {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>[\\s\\S]*?</(?:[\\w-]+:)?${tag}>`).exec(String(xml || ''));
  return m ? m[0] : null;
}

const numero = v => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const desescapar = t => String(t ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Um documento do ADN (NFS-e ou evento) lido. `cnpjEmpresa` diz o papel da empresa. Pura. */
function lerDocumento(xml, { cnpjEmpresa = null } = {}) {
  const texto = String(xml || '');
  const empresa = digitos(cnpjEmpresa);
  // Evento (cancelamento e101101, substituição e105102…): o que interessa é a nota que ele atinge.
  if (/<(?:[\w-]+:)?(evento|pedRegEvento)[\s>]/.test(texto) && !/<(?:[\w-]+:)?infNFSe[\s>]/.test(texto)) {
    const codigo = /<(?:[\w-]+:)?(e\d{6})[\s>]/.exec(texto)?.[1] || null;
    return {
      tipo: 'evento', chave: digitos(campo(texto, 'chNFSe')) || null, codigo_evento: codigo,
      descricao: desescapar(campo(texto, 'xDesc')) || (codigo ? `Evento ${codigo}` : 'Evento'),
      dhEvento: campo(texto, 'dhEvento') || campo(texto, 'dhProc'), cancela: ['e101101', 'e105102'].includes(codigo)
    };
  }
  const inf = bloco(texto, 'infNFSe');
  if (!inf) return { tipo: 'outro' };
  const id = /Id="NFS(\d{50})"/.exec(inf)?.[1] || null;
  const emit = bloco(inf, 'emit') || '';
  const dps = bloco(inf, 'infDPS') || '';
  const toma = bloco(dps, 'toma') || '';
  const interm = bloco(dps, 'interm') || '';
  const prest = bloco(dps, 'prest') || '';
  const valoresNota = bloco(inf.replace(dps, ''), 'valores') || '';
  const valoresDps = bloco(dps, 'valores') || '';
  const tribMun = bloco(valoresDps, 'tribMun') || '';
  const docEmitente = digitos(campo(emit, 'CNPJ') || campo(emit, 'CPF') || campo(prest, 'CNPJ') || campo(prest, 'CPF'));
  const docTomador = digitos(campo(toma, 'CNPJ') || campo(toma, 'CPF'));
  const docInterm = digitos(campo(interm, 'CNPJ') || campo(interm, 'CPF'));
  const tpRet = campo(tribMun, 'tpRetISSQN');
  const dhEmi = campo(dps, 'dhEmi') || campo(inf, 'dhProc');
  let papel = null;
  if (empresa) papel = docTomador === empresa ? 'tomador' : (docEmitente === empresa ? 'prestador' : (docInterm === empresa ? 'intermediario' : null));
  return {
    tipo: 'nfse', chave: id, numero: campo(inf, 'nNFSe'), codigo_verificacao: id ? id.slice(-9) : null,
    municipio: desescapar(campo(inf, 'xLocEmi') || campo(inf, 'xLocPrestacao')) || null, codigo_municipio: campo(inf, 'cLocIncid') || campo(dps, 'cLocEmi') || null,
    emitente_documento: docEmitente || null, emitente_nome: desescapar(campo(emit, 'xNome') || campo(prest, 'xNome')) || null,
    tomador_documento: docTomador || null, papel,
    data_emissao: String(dhEmi || '').slice(0, 10) || null, competencia_servico: String(campo(dps, 'dCompet') || '').slice(0, 7) || null,
    valor_servicos: numero(campo(bloco(valoresDps, 'vServPrest') || valoresDps, 'vServ')),
    valor_iss: numero(campo(valoresNota, 'vISSQN')), valor_retencoes: numero(campo(valoresNota, 'vTotalRet')),
    valor_liquido: numero(campo(valoresNota, 'vLiq')),
    iss_retido: tpRet === '2' || tpRet === '3',
    descricao: desescapar(campo(bloco(dps, 'cServ') || dps, 'xDescServ')) || null,
    situacao_nota: 'autorizada'
  };
}

/** Uma consulta ao ADN. */
async function consultar({ base, nsu, lote = true, transporte }) {
  if (typeof transporte !== 'function') throw erro('Transporte não configurado.', 500);
  const url = urlDfe(base, nsu, { lote });
  const inicio = Date.now();
  const resposta = await transporte(url, { metodo: 'GET', cabecalhos: { Accept: 'application/json', 'User-Agent': 'SantissimoDecor-Contabilidade/1.0' } });
  const texto = Buffer.isBuffer(resposta?.corpo) ? resposta.corpo.toString('utf8') : String(resposta?.corpo ?? '');
  let corpo = null;
  try { corpo = texto.trim() ? JSON.parse(texto) : null; } catch (_) { corpo = { bruto: texto.slice(0, 2000) }; }
  return { ...lerRetorno(resposta?.status || 0, corpo), url, tempoMs: Date.now() - inicio, bruto: corpo };
}

module.exports = { pegar, urlDfe, descompactar, textoDosErros, lerRetorno, lerDocumento, consultar, nsuTexto };
