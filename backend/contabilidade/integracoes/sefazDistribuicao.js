/**
 * NF-e de ENTRADA pela SEFAZ (etapa 10): o web service NFeDistribuicaoDFe
 * do Ambiente Nacional e a manifestação do destinatário (eventos 2102xx na
 * Recepção de Evento do Ambiente Nacional, cOrgao 91).
 *
 * Distribuição (NT 2014.002): a empresa pede "o que há depois do NSU X" e
 * recebe até 50 documentos por vez, cada um compactado (gzip + base64):
 *   resNFe ........... o resumo de uma NF-e emitida contra o CNPJ (sem ciência
 *                      ainda — o XML completo só vem depois da manifestação);
 *   procNFe .......... a NF-e completa com o protocolo (depois da ciência);
 *   resEvento / procEventoNFe  os eventos das notas (cancelamento, CC-e…).
 * cStat 137 = nada novo; 138 = há documentos; 656 = consumo indevido. Sem
 * documento novo (137, ou ultNSU = maxNSU) a regra é esperar 1 hora.
 *
 * Este arquivo só monta as mensagens e lê as respostas (puro, testável);
 * quem chama passa o transporte com o certificado (rede.js). A assinatura
 * do evento é a do fiscal (assinatura.assinarEvento).
 */
const zlib = require('zlib');
const sefaz = require('../../fiscal/sefazCliente');

const NS_NFE = sefaz.NS_NFE;
const NS_DIST = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const VERSAO_DIST = '1.01';
const ESPERA_SEM_DOCUMENTO_MS = 60 * 60 * 1000;
/** cUF de quem pede (a UF da empresa). */
const CUF = { MG: '31', SP: '35', RJ: '33', ES: '32', PR: '41', SC: '42', RS: '43', GO: '52', DF: '53', BA: '29' };

/** A manifestação do destinatário (NT 2012.002): código, descrição exata (sem acento) e se pede justificativa. */
const MANIFESTACOES = {
  ciencia: { tpEvento: '210210', descEvento: 'Ciencia da Operacao', rotulo: 'Ciência da operação', justificativa: false },
  confirmacao: { tpEvento: '210200', descEvento: 'Confirmacao da Operacao', rotulo: 'Confirmação da operação', justificativa: false },
  desconhecimento: { tpEvento: '210220', descEvento: 'Desconhecimento da Operacao', rotulo: 'Desconhecimento da operação', justificativa: false },
  nao_realizada: { tpEvento: '210240', descEvento: 'Operacao nao Realizada', rotulo: 'Operação não realizada', justificativa: true }
};
/** Eventos que aparecem na distribuição e o que dizem da nota. */
const EVENTOS = {
  110111: 'Cancelamento', 110112: 'Cancelamento por substituição', 110110: 'Carta de correção',
  210210: 'Ciência da operação', 210200: 'Confirmação da operação', 210220: 'Desconhecimento da operação', 210240: 'Operação não realizada',
  610600: 'Registro de passagem (CT-e)', 610110: 'Prestação de serviço em desacordo (CT-e)'
};
const EVENTOS_CANCELAMENTO = new Set(['110111', '110112']);

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

const tpAmb = ambiente => (ambiente === 'producao' ? '1' : '2');
const nsu15 = n => String(n ?? '0').replace(/\D/g, '').slice(-15).padStart(15, '0');
const digitos = v => String(v ?? '').replace(/\D/g, '');

/**
 * A mensagem `distDFeInt`: por NSU (`ultNSU` — o que veio depois dele),
 * um NSU exato (`nsu`) ou uma chave (`chave` — a nota completa, depois da
 * ciência). Pura.
 */
function xmlDistribuicao({ ambiente, uf, cnpj, ultNSU = null, nsu = null, chave = null }) {
  const cUF = CUF[String(uf || '').toUpperCase()];
  if (!cUF) throw erro(`UF sem código IBGE conhecido: ${uf}.`);
  const doc = digitos(cnpj);
  if (doc.length !== 14) throw erro('CNPJ da empresa inválido na Configuração fiscal.');
  let pedido;
  if (chave) {
    const ch = digitos(chave);
    if (ch.length !== 44) throw erro('Chave de acesso inválida.');
    pedido = `<consChNFe><chNFe>${ch}</chNFe></consChNFe>`;
  } else if (nsu !== null && nsu !== undefined) {
    pedido = `<consNSU><NSU>${nsu15(nsu)}</NSU></consNSU>`;
  } else {
    pedido = `<distNSU><ultNSU>${nsu15(ultNSU)}</ultNSU></distNSU>`;
  }
  return `<distDFeInt xmlns="${NS_NFE}" versao="${VERSAO_DIST}"><tpAmb>${tpAmb(ambiente)}</tpAmb><cUFAutor>${cUF}</cUFAutor><CNPJ>${doc}</CNPJ>${pedido}</distDFeInt>`;
}

/** O envelope SOAP 1.2 da distribuição (o método é nfeDistDFeInteresse). Pura. */
function envelopeDistribuicao(xmlDados) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>'
    + `<nfeDistDFeInteresse xmlns="${NS_DIST}"><nfeDadosMsg>${xmlDados}</nfeDadosMsg></nfeDistDFeInteresse>`
    + '</soap12:Body></soap12:Envelope>';
}

const CABECALHOS_DISTRIBUICAO = {
  'Content-Type': `application/soap+xml; charset=utf-8; action="${NS_DIST}/nfeDistDFeInteresse"`,
  'User-Agent': 'SantissimoDecor-Contabilidade/1.0'
};

/** Um docZip → o XML (gzip + base64). */
function descompactar(base64) {
  const buffer = Buffer.from(String(base64 || '').replace(/\s+/g, ''), 'base64');
  try {
    return zlib.gunzipSync(buffer).toString('utf8');
  } catch (_) {
    throw erro('Um documento da SEFAZ veio corrompido (não abre o gzip).', 502);
  }
}

/** Lê o `retDistDFeInt`. Pura. */
function lerRetornoDistribuicao(xml) {
  const falha = sefaz.faltaSoap(xml);
  if (falha) throw erro(`A SEFAZ recusou a consulta: ${falha}`, 502);
  const ret = sefaz.bloco(xml, 'retDistDFeInt') || xml;
  const cStat = sefaz.campo(ret, 'cStat');
  if (!cStat) throw erro('A SEFAZ respondeu à distribuição sem cStat.', 502);
  const documentos = [];
  for (const m of String(ret).matchAll(/<(?:[\w-]+:)?docZip\b([^>]*)>([^<]*)<\/(?:[\w-]+:)?docZip>/g)) {
    const atributos = m[1];
    const nsu = /NSU="(\d+)"/.exec(atributos)?.[1] || null;
    const schema = /schema="([^"]+)"/.exec(atributos)?.[1] || '';
    documentos.push({ nsu: nsu ? nsu15(nsu) : null, schema, xml: descompactar(m[2]) });
  }
  return {
    cStat, xMotivo: sefaz.campo(ret, 'xMotivo'), dhResp: sefaz.campo(ret, 'dhResp'),
    ultNSU: sefaz.campo(ret, 'ultNSU') ? nsu15(sefaz.campo(ret, 'ultNSU')) : null,
    maxNSU: sefaz.campo(ret, 'maxNSU') ? nsu15(sefaz.campo(ret, 'maxNSU')) : null,
    ambiente: sefaz.campo(ret, 'tpAmb') === '1' ? 'producao' : 'homologacao',
    semDocumento: cStat === '137', comDocumento: cStat === '138', consumoIndevido: cStat === '656',
    documentos
  };
}

const SITUACAO_RESUMO = { 1: 'autorizada', 2: 'denegada', 3: 'cancelada' };

/**
 * Um documento distribuído → o que ele é. `tipo`: resumo_nfe | nfe | evento
 * | outro. Pura.
 */
function lerDocumento({ schema = '', xml = '' }) {
  const texto = String(xml);
  if (/^resNFe/i.test(schema) || /<resNFe[\s>]/.test(texto)) {
    const r = sefaz.bloco(texto, 'resNFe') || texto;
    return {
      tipo: 'resumo_nfe', chave: digitos(sefaz.campo(r, 'chNFe')),
      emitente_documento: digitos(sefaz.campo(r, 'CNPJ') || sefaz.campo(r, 'CPF')) || null, emitente_nome: sefaz.campo(r, 'xNome') || null,
      data_emissao: String(sefaz.campo(r, 'dhEmi') || '').slice(0, 10) || null, valor: Number(sefaz.campo(r, 'vNF')) || 0,
      tpNF: sefaz.campo(r, 'tpNF'), protocolo: sefaz.campo(r, 'nProt'),
      situacao_nota: SITUACAO_RESUMO[Number(sefaz.campo(r, 'cSitNFe'))] || 'autorizada'
    };
  }
  if (/^procNFe/i.test(schema) || /<nfeProc[\s>]/.test(texto)) {
    const infNFe = sefaz.bloco(texto, 'infNFe') || '';
    const id = /Id="NFe(\d{44})"/.exec(infNFe)?.[1] || digitos(sefaz.campo(sefaz.bloco(texto, 'infProt') || '', 'chNFe'));
    return { tipo: 'nfe', chave: id, xml: texto };
  }
  if (/^(resEvento|procEventoNFe)/i.test(schema) || /<(resEvento|procEventoNFe)[\s>]/.test(texto)) {
    const inf = sefaz.bloco(texto, 'infEvento') || sefaz.bloco(texto, 'resEvento') || texto;
    const tpEvento = sefaz.campo(inf, 'tpEvento');
    const retorno = sefaz.bloco(texto, 'retEvento');
    return {
      tipo: 'evento', chave: digitos(sefaz.campo(inf, 'chNFe')), tpEvento,
      descricao: EVENTOS[tpEvento] || sefaz.campo(inf, 'xEvento') || sefaz.campo(inf, 'descEvento') || `Evento ${tpEvento}`,
      dhEvento: sefaz.campo(inf, 'dhEvento'), protocolo: sefaz.campo(retorno || inf, 'nProt'),
      autor: digitos(sefaz.campo(inf, 'CNPJ') || sefaz.campo(inf, 'CPF')) || null,
      cancela: EVENTOS_CANCELAMENTO.has(String(tpEvento))
    };
  }
  return { tipo: 'outro', schema };
}

/**
 * O evento de manifestação SEM assinatura (quem assina é o fiscal). cOrgao
 * 91 = Ambiente Nacional. `dhEvento` já formatado. Pura.
 */
function xmlManifestacao({ ambiente, cnpj, chave, tipo, justificativa = null, dhEvento, nSeqEvento = 1 }) {
  const def = MANIFESTACOES[tipo];
  if (!def) throw erro('Manifestação inválida: ciência, confirmação, desconhecimento ou operação não realizada.');
  const chNFe = digitos(chave);
  if (chNFe.length !== 44) throw erro('Chave de acesso inválida.');
  const doc = digitos(cnpj);
  if (doc.length !== 14) throw erro('CNPJ da empresa inválido na Configuração fiscal.');
  let xJust = '';
  if (def.justificativa) {
    const t = String(justificativa || '').replace(/\s+/g, ' ').trim();
    if (t.length < 15 || t.length > 255) throw erro('Diga por que a operação não se realizou (de 15 a 255 letras).');
    xJust = `<xJust>${sefaz.escaparXml(t)}</xJust>`;
  }
  const seq = String(Number(nSeqEvento) || 1);
  const id = `ID${def.tpEvento}${chNFe}${seq.padStart(2, '0')}`;
  return `<evento xmlns="${NS_NFE}" versao="${sefaz.VERSAO_EVENTO}"><infEvento Id="${id}">`
    + `<cOrgao>91</cOrgao><tpAmb>${tpAmb(ambiente)}</tpAmb><CNPJ>${doc}</CNPJ><chNFe>${chNFe}</chNFe>`
    + `<dhEvento>${dhEvento}</dhEvento><tpEvento>${def.tpEvento}</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>${sefaz.VERSAO_EVENTO}</verEvento>`
    + `<detEvento versao="${sefaz.VERSAO_EVENTO}"><descEvento>${def.descEvento}</descEvento>${xJust}</detEvento>`
    + '</infEvento></evento>';
}

/** O retorno do evento: 135/136 registrado; 573 = já havia (duplicidade) — a manifestação já vale. Pura. */
function lerRetornoManifestacao(xml) {
  const lido = sefaz.lerRetornoEvento(xml);
  const cStat = lido.evento?.cStat || null;
  return {
    cStat: lido.cStat, xMotivo: lido.xMotivo, evento: lido.evento,
    registrado: Boolean(lido.evento?.registrado) || cStat === '573',
    duplicado: cStat === '573',
    mensagem: lido.evento ? `${lido.evento.cStat} — ${lido.evento.xMotivo}` : `${lido.cStat} — ${lido.xMotivo}`
  };
}

/** Uma chamada à distribuição (POST SOAP). */
async function consultar({ url, transporte, xmlDados }) {
  if (typeof transporte !== 'function') throw erro('Transporte não configurado.', 500);
  const inicio = Date.now();
  const resposta = await transporte(url, { metodo: 'POST', cabecalhos: CABECALHOS_DISTRIBUICAO, corpo: envelopeDistribuicao(xmlDados) });
  const texto = Buffer.isBuffer(resposta?.corpo) ? resposta.corpo.toString('utf8') : String(resposta?.corpo ?? '');
  if (resposta?.status && (resposta.status < 200 || resposta.status >= 300) && !/retDistDFeInt/.test(texto)) {
    throw erro(`A SEFAZ (Distribuição de DF-e) respondeu HTTP ${resposta.status}${sefaz.faltaSoap(texto) ? `: ${sefaz.faltaSoap(texto)}` : ''}.`, 502);
  }
  return { ...lerRetornoDistribuicao(texto), tempoMs: Date.now() - inicio };
}

/** Envia o evento de manifestação ASSINADO ao Ambiente Nacional. */
async function enviarManifestacao({ url, transporte, xmlEventoAssinado, idLote }) {
  if (typeof transporte !== 'function') throw erro('Transporte não configurado.', 500);
  const corpo = sefaz.montarEnvelope('recepcaoEvento', sefaz.xmlEnvEvento({ idLote, xmlEvento: xmlEventoAssinado }));
  const def = sefaz.SERVICOS.recepcaoEvento;
  const resposta = await transporte(url, {
    metodo: 'POST', corpo,
    cabecalhos: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${NS_NFE}/wsdl/${def.nome}/${def.metodo}"`, 'User-Agent': 'SantissimoDecor-Contabilidade/1.0' }
  });
  const texto = Buffer.isBuffer(resposta?.corpo) ? resposta.corpo.toString('utf8') : String(resposta?.corpo ?? '');
  const falha = sefaz.faltaSoap(texto);
  if (falha) throw erro(`A SEFAZ recusou a manifestação: ${falha}`, 502);
  if (resposta?.status && (resposta.status < 200 || resposta.status >= 300)) throw erro(`A SEFAZ (evento) respondeu HTTP ${resposta.status}.`, 502);
  const lido = lerRetornoManifestacao(sefaz.bloco(texto, 'nfeResultMsg') || texto);
  if (!lido.cStat) throw erro('A SEFAZ respondeu ao evento sem cStat.', 502);
  return { ...lido, xmlResposta: texto };
}

module.exports = {
  NS_DIST, VERSAO_DIST, ESPERA_SEM_DOCUMENTO_MS, CUF, MANIFESTACOES, EVENTOS, CABECALHOS_DISTRIBUICAO,
  nsu15, xmlDistribuicao, envelopeDistribuicao, descompactar, lerRetornoDistribuicao, lerDocumento,
  xmlManifestacao, lerRetornoManifestacao, consultar, enviarManifestacao
};
