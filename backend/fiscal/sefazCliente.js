/**
 * Cliente dos web services da NF-e (versão 4.00) — SEFAZ-MG.
 *
 * A conversa com a SEFAZ é SOAP 1.2 sobre HTTPS com certificado de cliente:
 * o mesmo A1 que assina o XML autentica a conexão. Cada serviço tem a sua
 * URL e o seu namespace de WSDL; o corpo é sempre `nfeDadosMsg` com o XML
 * da mensagem dentro (sem CDATA).
 *
 * Nada aqui monta a NF-e: este arquivo só sabe ENVIAR uma mensagem pronta e
 * LER a resposta. O primeiro serviço é o Status do Serviço — a prova de que
 * certificado, TLS e endereços estão certos antes de existir nota.
 *
 * A camada de rede (`transporte`) é injetável: os testes trocam por uma função
 * que devolve XML de mentira; o app usa https com o .pfx.
 */
const https = require('https');

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const NS_SOAP = 'http://www.w3.org/2003/05/soap-envelope';
const VERSAO = '4.00';

/** Só o que este app usa. cUF é o código IBGE do estado. */
const UFS = { MG: '31' };

/** Serviços 4.00 e o método SOAP de cada um (vai no header `action`). */
const SERVICOS = {
  statusServico: { nome: 'NFeStatusServico4', metodo: 'nfeStatusServicoNF' },
  autorizacao: { nome: 'NFeAutorizacao4', metodo: 'nfeAutorizacaoLote' },
  retAutorizacao: { nome: 'NFeRetAutorizacao4', metodo: 'nfeRetAutorizacaoLote' },
  consultaProtocolo: { nome: 'NFeConsultaProtocolo4', metodo: 'nfeConsultaNF' },
  recepcaoEvento: { nome: 'NFeRecepcaoEvento4', metodo: 'nfeRecepcaoEvento' },
  inutilizacao: { nome: 'NFeInutilizacao4', metodo: 'nfeInutilizacaoNF' }
};

/** Endereços por UF e ambiente (portalsped.fazenda.mg.gov.br/spedmg/nfe/webservices). */
const ENDERECOS = {
  MG: {
    homologacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/',
    producao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/'
  }
};

function tpAmb(ambiente) {
  return ambiente === 'producao' ? '1' : '2';
}

function urlDoServico(uf, ambiente, servico) {
  const base = ENDERECOS[String(uf || '').toUpperCase()]?.[ambiente === 'producao' ? 'producao' : 'homologacao'];
  const def = SERVICOS[servico];
  if (!base) throw erro(`Sem endereço da SEFAZ para a UF ${uf}.`);
  if (!def) throw erro(`Serviço desconhecido: ${servico}.`);
  return base + def.nome;
}

function montarEnvelope(servico, xmlDados) {
  const def = SERVICOS[servico];
  if (!def) throw erro(`Serviço desconhecido: ${servico}.`);
  const ns = `${NS_NFE}/wsdl/${def.nome}`;
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<soap12:Envelope xmlns:soap12="${NS_SOAP}"><soap12:Body>`
    + `<nfeDadosMsg xmlns="${ns}">${xmlDados}</nfeDadosMsg>`
    + `</soap12:Body></soap12:Envelope>`;
}

/** Mensagem do Status do Serviço. */
function xmlConsultaStatus(uf, ambiente) {
  const cUF = UFS[String(uf || '').toUpperCase()];
  if (!cUF) throw erro(`UF sem código IBGE conhecido: ${uf}.`);
  return `<consStatServ xmlns="${NS_NFE}" versao="${VERSAO}"><tpAmb>${tpAmb(ambiente)}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ></consStatServ>`;
}

/** Texto de um elemento simples (`<tag>valor</tag>`), ou null. Ignora prefixos de namespace. */
function campo(xml, tag) {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${tag}>`).exec(String(xml || ''));
  return m ? m[1].trim() : null;
}

/** O elemento inteiro (com filhos), ou null. */
function bloco(xml, tag) {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>[\\s\\S]*?</(?:[\\w-]+:)?${tag}>`).exec(String(xml || ''));
  return m ? m[0] : null;
}

/** Falha SOAP (`<Fault>`) vira erro com a mensagem da SEFAZ. */
function faltaSoap(xml) {
  const fault = bloco(xml, 'Fault');
  if (!fault) return null;
  return campo(fault, 'Text') || campo(fault, 'faultstring') || 'Falha SOAP sem descrição';
}

/**
 * Rede de verdade: POST com o certificado do emitente como certificado de
 * cliente. Recebe chave e certificado em PEM (extraídos do .pfx pelo
 * certificado.js), e NÃO o .pfx: o OpenSSL 3 do Node recusa ("unsupported")
 * arquivos .pfx gravados com as cifras antigas que as ACs ainda usam.
 */
function transporteHttps({ chavePrivadaPem, certificadoPem, cadeiaPem = [], timeoutMs = 30000, ca = null, verificarServidor = true }) {
  return (url, corpo, cabecalhos) => new Promise((resolve, reject) => {
    try {
      const agente = new https.Agent({
        key: chavePrivadaPem,
        cert: [certificadoPem, ...cadeiaPem].join('\n'),
        minVersion: 'TLSv1.2',
        ...(ca ? { ca } : {}),
        rejectUnauthorized: verificarServidor
      });
      const req = https.request(url, {
        method: 'POST',
        agent: agente,
        headers: { ...cabecalhos, 'Content-Length': Buffer.byteLength(corpo) },
        timeout: timeoutMs
      }, res => {
        const partes = [];
        res.on('data', p => partes.push(p));
        res.on('end', () => resolve({ status: res.statusCode, corpo: Buffer.concat(partes).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(erro('A SEFAZ não respondeu a tempo.', 504)));
      req.on('error', e => reject(traduzirErroDeRede(e)));
      req.end(corpo);
    } catch (e) {
      reject(traduzirErroDeRede(e));
    }
  });
}

/** Erros de rede/TLS em português, sem vazar detalhes internos. */
function traduzirErroDeRede(e) {
  const codigo = String(e?.code || '');
  const msg = String(e?.message || '');
  if (e?.status) return e;
  if (/mac verify failure|bad decrypt|PKCS12/i.test(msg)) return erro('A senha do certificado não abre o arquivo .pfx.', 400);
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|unable to get local issuer|CERT_/i.test(msg + codigo)) {
    return erro('O Node não confia no certificado do servidor da SEFAZ (cadeia ICP-Brasil). Configure NFE_CA_PATH com as raízes da ICP-Brasil.', 502);
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(codigo)) return erro('Não foi possível resolver o endereço da SEFAZ (sem internet?).', 502);
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT/.test(codigo)) return erro('A SEFAZ não aceitou a conexão agora. Tente de novo em instantes.', 502);
  return erro(`Falha de comunicação com a SEFAZ: ${msg || codigo || 'erro desconhecido'}`, 502);
}

/**
 * Envia uma mensagem a um serviço e devolve o XML de resposta (já sem o
 * envelope). Lança em falha SOAP, HTTP fora de 2xx ou corpo que não é XML.
 */
async function chamar({ uf, ambiente, servico, xmlDados, transporte }) {
  if (typeof transporte !== 'function') throw erro('Transporte não configurado.', 500);
  const def = SERVICOS[servico];
  const url = urlDoServico(uf, ambiente, servico);
  const corpo = montarEnvelope(servico, xmlDados);
  const cabecalhos = {
    'Content-Type': `application/soap+xml; charset=utf-8; action="${NS_NFE}/wsdl/${def.nome}/${def.metodo}"`,
    'User-Agent': 'SantissimoDecor-Fiscal/1.0'
  };
  const inicio = Date.now();
  const resposta = await transporte(url, corpo, cabecalhos);
  const tempoMs = Date.now() - inicio;
  const texto = String(resposta?.corpo || '');

  const falha = faltaSoap(texto);
  if (falha) throw erro(`A SEFAZ recusou a mensagem: ${falha}`, 502);
  if (resposta.status && (resposta.status < 200 || resposta.status >= 300)) {
    throw erro(`A SEFAZ respondeu HTTP ${resposta.status}.`, 502);
  }
  if (!/<[\w:]*Envelope/i.test(texto) && !/<\?xml|<ret/i.test(texto)) {
    throw erro('A SEFAZ devolveu uma resposta que não é XML.', 502);
  }
  const resultado = bloco(texto, 'nfeResultMsg');
  return { xml: resultado || texto, tempoMs, url };
}

/** Interpreta o `retConsStatServ`. cStat 107 = serviço em operação. */
function lerStatusServico(xml) {
  const ret = bloco(xml, 'retConsStatServ') || xml;
  const cStat = campo(ret, 'cStat');
  return {
    cStat,
    xMotivo: campo(ret, 'xMotivo'),
    emOperacao: cStat === '107',
    versaoAplicacao: campo(ret, 'verAplic'),
    recebidoEm: campo(ret, 'dhRecbto'),
    tempoMedioSegundos: campo(ret, 'tMed'),
    ambiente: campo(ret, 'tpAmb') === '1' ? 'producao' : 'homologacao',
    cUF: campo(ret, 'cUF')
  };
}

/** Status do Serviço: certificado + TLS + endereço, tudo num pedido só. */
async function statusServico({ uf, ambiente, transporte }) {
  const { xml, tempoMs, url } = await chamar({
    uf, ambiente, servico: 'statusServico', xmlDados: xmlConsultaStatus(uf, ambiente), transporte
  });
  const lido = lerStatusServico(xml);
  if (!lido.cStat) throw erro('A SEFAZ respondeu, mas sem o status do serviço.', 502);
  return { ...lido, tempoMs, url };
}

// ------------------------------------------------------------ autorização

/** Lote com uma NF-e assinada, processamento síncrono (indSinc=1). */
function xmlEnviNFe({ idLote, xmlNfe }) {
  const lote = String(idLote || '1').replace(/\D/g, '').slice(0, 15) || '1';
  if (!/^<NFe[\s>]/.test(String(xmlNfe || ''))) throw erro('O lote precisa de um <NFe> assinado.');
  return `<enviNFe xmlns="${NS_NFE}" versao="${VERSAO}"><idLote>${lote}</idLote><indSinc>1</indSinc>${xmlNfe}</enviNFe>`;
}

function xmlConsultaRecibo(ambiente, recibo) {
  const nRec = String(recibo || '').replace(/\D/g, '');
  if (!nRec) throw erro('Recibo ausente.');
  return `<consReciNFe xmlns="${NS_NFE}" versao="${VERSAO}"><tpAmb>${tpAmb(ambiente)}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`;
}

function xmlConsultaNfe(ambiente, chave) {
  const chNFe = String(chave || '').replace(/\D/g, '');
  if (chNFe.length !== 44) throw erro('Chave de acesso inválida.');
  return `<consSitNFe xmlns="${NS_NFE}" versao="${VERSAO}"><tpAmb>${tpAmb(ambiente)}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chNFe}</chNFe></consSitNFe>`;
}

/** Situação da nota pelo cStat do protocolo (ou da consulta). */
function situacaoDoProtocolo(cStat) {
  const c = String(cStat || '');
  if (c === '100' || c === '150') return 'autorizada';
  if (c === '101' || c === '151' || c === '155') return 'cancelada';
  if (['110', '301', '302', '303'].includes(c)) return 'denegada';
  return 'rejeitada';
}

/** `protNFe/infProt` da resposta (autorização, recibo ou consulta), ou null. */
function lerProtocolo(xml) {
  const prot = bloco(xml, 'protNFe');
  if (!prot) return null;
  const inf = bloco(prot, 'infProt') || prot;
  const cStat = campo(inf, 'cStat');
  return {
    cStat,
    xMotivo: campo(inf, 'xMotivo'),
    nProt: campo(inf, 'nProt'),
    dhRecbto: campo(inf, 'dhRecbto'),
    chNFe: campo(inf, 'chNFe'),
    digVal: campo(inf, 'digVal'),
    situacao: situacaoDoProtocolo(cStat),
    xml: prot
  };
}

/** Lê o `retEnviNFe`: 104 = lote processado (protocolo dentro), 103/105 = recibo para consultar depois. */
function lerRetornoEnvio(xml) {
  const ret = bloco(xml, 'retEnviNFe') || xml;
  const cStat = campo(ret, 'cStat');
  const recibo = bloco(ret, 'infRec');
  return {
    cStat,
    xMotivo: campo(ret, 'xMotivo'),
    dhRecbto: campo(ret, 'dhRecbto'),
    recibo: recibo ? campo(recibo, 'nRec') : null,
    tempoMedioSegundos: recibo ? Number(campo(recibo, 'tMed')) || null : null,
    protocolo: lerProtocolo(ret),
    ambiente: campo(ret, 'tpAmb') === '1' ? 'producao' : 'homologacao'
  };
}

/** Lê o `retConsReciNFe`: 104 processado (protocolo), 105 ainda em processamento. */
function lerRetornoRecibo(xml) {
  const ret = bloco(xml, 'retConsReciNFe') || xml;
  const cStat = campo(ret, 'cStat');
  return { cStat, xMotivo: campo(ret, 'xMotivo'), emProcessamento: cStat === '105', protocolo: lerProtocolo(ret) };
}

/** Lê o `retConsSitNFe`: 100 autorizada, 101 cancelada, 110 denegada, 217 não consta. */
function lerRetornoConsulta(xml) {
  const ret = bloco(xml, 'retConsSitNFe') || xml;
  const cStat = campo(ret, 'cStat');
  const protocolo = lerProtocolo(ret);
  return {
    cStat,
    xMotivo: campo(ret, 'xMotivo'),
    chNFe: campo(ret, 'chNFe'),
    naoConsta: cStat === '217',
    situacao: cStat === '217' ? null : situacaoDoProtocolo(cStat),
    protocolo,
    eventos: bloco(ret, 'procEventoNFe') ? [bloco(ret, 'procEventoNFe')] : []
  };
}

/** NF-e autorizada para guardar/distribuir: `nfeProc` = NFe assinada + protocolo. */
function montarNfeProc(xmlNfeAssinada, protNFeXml) {
  if (!/<Signature[\s>]/.test(String(xmlNfeAssinada || ''))) throw erro('A NF-e precisa estar assinada.');
  if (!/^<protNFe[\s>]/.test(String(protNFeXml || '').trim())) throw erro('Protocolo ausente.');
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NS_NFE}" versao="${VERSAO}">${xmlNfeAssinada}${String(protNFeXml).trim()}</nfeProc>`;
}

/** Envia a NF-e assinada (lote de uma, síncrono). */
async function autorizar({ uf, ambiente, transporte, xmlNfe, idLote }) {
  const { xml, tempoMs, url } = await chamar({
    uf, ambiente, servico: 'autorizacao', xmlDados: xmlEnviNFe({ idLote, xmlNfe }), transporte
  });
  const lido = lerRetornoEnvio(xml);
  if (!lido.cStat) throw erro('A SEFAZ respondeu ao envio sem cStat.', 502);
  return { ...lido, xmlResposta: xml, tempoMs, url };
}

async function consultarRecibo({ uf, ambiente, transporte, recibo }) {
  const { xml, tempoMs } = await chamar({
    uf, ambiente, servico: 'retAutorizacao', xmlDados: xmlConsultaRecibo(ambiente, recibo), transporte
  });
  const lido = lerRetornoRecibo(xml);
  if (!lido.cStat) throw erro('A SEFAZ respondeu à consulta do recibo sem cStat.', 502);
  return { ...lido, xmlResposta: xml, tempoMs };
}

async function consultarNfe({ uf, ambiente, transporte, chave }) {
  const { xml, tempoMs } = await chamar({
    uf, ambiente, servico: 'consultaProtocolo', xmlDados: xmlConsultaNfe(ambiente, chave), transporte
  });
  const lido = lerRetornoConsulta(xml);
  if (!lido.cStat) throw erro('A SEFAZ respondeu à consulta da NF-e sem cStat.', 502);
  return { ...lido, xmlResposta: xml, tempoMs };
}

// ----------------------------------------------------------------- eventos

const VERSAO_EVENTO = '1.00';
const TIPO_EVENTO = { cancelamento: '110111', cartaCorrecao: '110110' };

function escaparXml(texto) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

/**
 * Evento de cancelamento (110111), SEM assinatura (a assinatura.js assina o
 * `infEvento`). `dhEvento` já formatado ("2026-09-15T15:10:01-03:00").
 */
function xmlEventoCancelamento({ uf, ambiente, cnpj, chave, protocolo, justificativa, dhEvento, nSeqEvento = 1 }) {
  const cUF = UFS[String(uf || '').toUpperCase()];
  if (!cUF) throw erro(`UF sem código IBGE conhecido: ${uf}.`);
  const chNFe = String(chave || '').replace(/\D/g, '');
  if (chNFe.length !== 44) throw erro('Chave de acesso inválida.');
  const nProt = String(protocolo || '').replace(/\D/g, '');
  if (!nProt) throw erro('A nota não tem protocolo de autorização.');
  const xJust = String(justificativa || '').replace(/\s+/g, ' ').trim();
  if (xJust.length < 15 || xJust.length > 255) throw erro('A justificativa precisa ter entre 15 e 255 caracteres.');
  const seq = String(Number(nSeqEvento) || 1);
  const id = `ID${TIPO_EVENTO.cancelamento}${chNFe}${seq.padStart(2, '0')}`;
  return `<evento xmlns="${NS_NFE}" versao="${VERSAO_EVENTO}"><infEvento Id="${id}">`
    + `<cOrgao>${cUF}</cOrgao><tpAmb>${tpAmb(ambiente)}</tpAmb><CNPJ>${String(cnpj).replace(/\D/g, '')}</CNPJ><chNFe>${chNFe}</chNFe>`
    + `<dhEvento>${dhEvento}</dhEvento><tpEvento>${TIPO_EVENTO.cancelamento}</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>${VERSAO_EVENTO}</verEvento>`
    + `<detEvento versao="${VERSAO_EVENTO}"><descEvento>Cancelamento</descEvento><nProt>${nProt}</nProt><xJust>${escaparXml(xJust)}</xJust></detEvento>`
    + `</infEvento></evento>`;
}

/** Lote de um evento assinado. */
function xmlEnvEvento({ idLote, xmlEvento }) {
  const lote = String(idLote || '1').replace(/\D/g, '').slice(0, 15) || '1';
  if (!/<evento[\s>]/.test(String(xmlEvento || '')) || !/<Signature[\s>]/.test(String(xmlEvento || ''))) throw erro('O lote precisa de um <evento> assinado.');
  return `<envEvento xmlns="${NS_NFE}" versao="${VERSAO_EVENTO}"><idLote>${lote}</idLote>${xmlEvento}</envEvento>`;
}

/** Lê o `retEnvEvento`: 128 = lote processado; dentro, `retEvento/infEvento` com 135/155 = evento registrado. */
function lerRetornoEvento(xml) {
  const ret = bloco(xml, 'retEnvEvento') || xml;
  const retEvento = bloco(ret, 'retEvento');
  const inf = retEvento ? (bloco(retEvento, 'infEvento') || retEvento) : null;
  const cStatEvento = inf ? campo(inf, 'cStat') : null;
  return {
    cStat: campo(ret, 'cStat'),
    xMotivo: campo(ret, 'xMotivo'),
    evento: inf ? {
      cStat: cStatEvento, xMotivo: campo(inf, 'xMotivo'), nProt: campo(inf, 'nProt'), dhRegEvento: campo(inf, 'dhRegEvento'),
      chNFe: campo(inf, 'chNFe'), tpEvento: campo(inf, 'tpEvento'),
      registrado: cStatEvento === '135' || cStatEvento === '155' || cStatEvento === '136',
      xml: retEvento
    } : null
  };
}

/** Evento registrado para guardar/distribuir: `procEventoNFe` = evento assinado + retorno. */
function montarProcEvento(xmlEventoAssinado, retEventoXml) {
  if (!/<Signature[\s>]/.test(String(xmlEventoAssinado || ''))) throw erro('O evento precisa estar assinado.');
  if (!/^<retEvento[\s>]/.test(String(retEventoXml || '').trim())) throw erro('Retorno do evento ausente.');
  return `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NS_NFE}" versao="${VERSAO_EVENTO}">${xmlEventoAssinado}${String(retEventoXml).trim()}</procEventoNFe>`;
}

async function enviarEvento({ uf, ambiente, transporte, xmlEvento, idLote }) {
  const { xml, tempoMs } = await chamar({
    uf, ambiente, servico: 'recepcaoEvento', xmlDados: xmlEnvEvento({ idLote, xmlEvento }), transporte
  });
  const lido = lerRetornoEvento(xml);
  if (!lido.cStat) throw erro('A SEFAZ respondeu ao evento sem cStat.', 502);
  return { ...lido, xmlResposta: xml, tempoMs };
}

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

module.exports = {
  VERSAO_EVENTO, TIPO_EVENTO, escaparXml, xmlEventoCancelamento, xmlEnvEvento, lerRetornoEvento, montarProcEvento, enviarEvento,
  NS_NFE, VERSAO, UFS, SERVICOS, ENDERECOS,
  urlDoServico, montarEnvelope, xmlConsultaStatus, campo, bloco, faltaSoap,
  transporteHttps, traduzirErroDeRede, chamar, lerStatusServico, statusServico,
  xmlEnviNFe, xmlConsultaRecibo, xmlConsultaNfe, situacaoDoProtocolo, lerProtocolo,
  lerRetornoEnvio, lerRetornoRecibo, lerRetornoConsulta, montarNfeProc,
  autorizar, consultarRecibo, consultarNfe
};
