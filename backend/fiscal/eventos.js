/**
 * Eventos da NF-e — por ora o cancelamento (110111).
 *
 * Cancelar exige nota autorizada, protocolo e uma justificativa de 15 a 255
 * caracteres; a SEFAZ registra o evento (cStat 135) ou o homologa fora do
 * prazo (155). O `procEventoNFe` fica em notas_fiscais.xml_cancelamento e a
 * nota passa a "cancelada". Rejeição volta como 422 com o motivo — a nota
 * continua autorizada.
 */
const configuracao = require('./configuracaoFiscal');
const assinatura = require('./assinatura');
const sefaz = require('./sefazCliente');
const xmlNfe = require('./xmlNfe');
const emissao = require('./emissao');

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

async function atualizarNota(api, nota, dados) {
  const payload = { ...dados, atualizado_em: new Date().toISOString() };
  await api.put(`/api/notas_fiscais/${nota.id}`, payload);
  return { ...nota, ...payload };
}

async function registrarEvento(api, notaId, dados) {
  try {
    await api.post('/api/notas_fiscais_eventos', { nota_fiscal_id: notaId, criado_em: new Date().toISOString(), ...dados });
  } catch (e) {
    console.error(`Evento fiscal não gravado (nota ${notaId}, ${dados.tipo}):`, e.message);
  }
}

/**
 * @param {object} p  { api, notaId, justificativa, certificado (PEM), transporte, usuarioId, agora }
 */
async function cancelar({ api, notaId, justificativa, certificado, transporte, usuarioId = null, agora = () => new Date() }) {
  const nota = await emissao.lerNota(api, notaId);
  if (nota.status_fiscal !== 'autorizada') throw erro(`Só uma nota autorizada pode ser cancelada (esta está "${nota.status_fiscal}").`, 409);
  if (!nota.protocolo || !nota.chave_acesso) throw erro('A nota não tem protocolo ou chave de acesso.', 409);
  if (!nota.xml_autorizado && !nota.xml_envio) throw erro('A nota não tem XML guardado.', 409);
  const xJust = String(justificativa || '').replace(/\s+/g, ' ').trim();
  if (xJust.length < 15 || xJust.length > 255) throw erro('A justificativa precisa ter entre 15 e 255 caracteres.', 400);

  const cfg = await configuracao.carregar(api);
  if (!cfg) throw erro('Configuração fiscal ausente.', 409);
  const ambiente = nota.ambiente === configuracao.PRODUCAO ? configuracao.PRODUCAO : configuracao.HOMOLOGACAO;
  const instante = agora();

  const xmlEvento = assinatura.assinarEvento(sefaz.xmlEventoCancelamento({
    uf: cfg.uf, ambiente, cnpj: cfg.cnpj, chave: nota.chave_acesso, protocolo: nota.protocolo,
    justificativa: xJust, dhEvento: xmlNfe.formatarDataHora(instante)
  }), certificado);

  let atual = await atualizarNota(api, nota, { status_fiscal: 'cancelamento_pendente', justificativa_cancelamento: xJust });
  await registrarEvento(api, nota.id, { tipo: 'cancelamento', status_anterior: 'autorizada', status_novo: 'cancelamento_pendente', mensagem: `Cancelamento enviado: ${xJust}`, usuario_id: usuarioId });

  let retorno;
  try {
    retorno = await sefaz.enviarEvento({ uf: cfg.uf, ambiente, transporte, xmlEvento, idLote: String(nota.id) });
  } catch (e) {
    // Sem resposta a nota continua autorizada para todos os efeitos: volta ao que era.
    atual = await atualizarNota(api, atual, { status_fiscal: 'autorizada' });
    await registrarEvento(api, nota.id, { tipo: 'erro', status_anterior: 'cancelamento_pendente', status_novo: 'autorizada', mensagem: e.message, usuario_id: usuarioId });
    throw erro(e.message, e.status || 502, { nota: emissao.semXml(atual) });
  }

  const ev = retorno.evento;
  if (ev?.registrado) {
    const proc = sefaz.montarProcEvento(xmlEvento, ev.xml);
    atual = await atualizarNota(api, atual, {
      status_fiscal: 'cancelada', xml_cancelamento: proc, cancelada_em: ev.dhRegEvento || instante.toISOString(),
      codigo_status_sefaz: ev.cStat, motivo_sefaz: ev.xMotivo
    });
    await registrarEvento(api, nota.id, { tipo: 'cancelada', status_anterior: 'cancelamento_pendente', status_novo: 'cancelada', codigo_sefaz: ev.cStat, mensagem: `${ev.xMotivo} — protocolo ${ev.nProt}`, usuario_id: usuarioId });
    return { nota: emissao.semXml(atual), sefaz: { cStat: ev.cStat, xMotivo: ev.xMotivo, protocolo: ev.nProt }, cancelada: true };
  }

  const cStat = ev?.cStat || retorno.cStat;
  const xMotivo = ev?.xMotivo || retorno.xMotivo;
  atual = await atualizarNota(api, atual, { status_fiscal: 'autorizada' });
  await registrarEvento(api, nota.id, { tipo: 'rejeitada', status_anterior: 'cancelamento_pendente', status_novo: 'autorizada', codigo_sefaz: cStat, mensagem: `Cancelamento recusado: ${xMotivo}`, usuario_id: usuarioId });
  throw erro(`SEFAZ ${cStat}: ${xMotivo}`, 422, { nota: emissao.semXml(atual), sefaz: { cStat, xMotivo } });
}

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));

/**
 * Carta de correção (110110). A nota continua autorizada; o evento registrado
 * fica em notas_fiscais_eventos (tipo "cce", com o procEventoNFe no detalhe).
 * A SEFAZ numera as cartas de uma nota (nSeqEvento): a última é a que vale.
 */
async function cartaCorrecao({ api, notaId, correcao, certificado, transporte, usuarioId = null, agora = () => new Date() }) {
  const nota = await emissao.lerNota(api, notaId);
  if (nota.status_fiscal !== 'autorizada') throw erro(`Só uma nota autorizada aceita carta de correção (esta está "${nota.status_fiscal}").`, 409);
  if (!nota.chave_acesso) throw erro('A nota não tem chave de acesso.', 409);
  const xCorrecao = String(correcao || '').replace(/\s+/g, ' ').trim();
  if (xCorrecao.length < 15 || xCorrecao.length > 1000) throw erro('A correção precisa ter entre 15 e 1000 caracteres.', 400);

  const cfg = await configuracao.carregar(api);
  if (!cfg) throw erro('Configuração fiscal ausente.', 409);
  const ambiente = nota.ambiente === configuracao.PRODUCAO ? configuracao.PRODUCAO : configuracao.HOMOLOGACAO;

  const anteriores = await api.get('/api/notas_fiscais_eventos', { query: { nota_fiscal_id: nota.id, tipo: 'cce' } }).then(lista).catch(() => []);
  const nSeqEvento = anteriores.filter(e => ['135', '136'].includes(String(e?.codigo_sefaz))).length + 1;
  const instante = agora();
  const xmlEvento = assinatura.assinarEvento(sefaz.xmlEventoCartaCorrecao({
    uf: cfg.uf, ambiente, cnpj: cfg.cnpj, chave: nota.chave_acesso, correcao: xCorrecao, dhEvento: xmlNfe.formatarDataHora(instante), nSeqEvento
  }), certificado);

  let retorno;
  try {
    retorno = await sefaz.enviarEvento({ uf: cfg.uf, ambiente, transporte, xmlEvento, idLote: String(nota.id) });
  } catch (e) {
    await registrarEvento(api, nota.id, { tipo: 'erro', status_anterior: 'autorizada', status_novo: 'autorizada', mensagem: `Carta de correção não enviada: ${e.message}`, usuario_id: usuarioId });
    throw erro(e.message, e.status || 502);
  }
  const ev = retorno.evento;
  if (ev?.registrado) {
    const proc = sefaz.montarProcEvento(xmlEvento, ev.xml);
    await registrarEvento(api, nota.id, {
      tipo: 'cce', status_anterior: 'autorizada', status_novo: 'autorizada', codigo_sefaz: ev.cStat,
      mensagem: `Carta de correção ${nSeqEvento}: ${xCorrecao}`, detalhe: { nSeqEvento, correcao: xCorrecao, protocolo: ev.nProt, xml: proc }, usuario_id: usuarioId
    });
    return { nota: emissao.semXml(nota), sefaz: { cStat: ev.cStat, xMotivo: ev.xMotivo, protocolo: ev.nProt }, nSeqEvento, registrada: true };
  }
  const cStat = ev?.cStat || retorno.cStat;
  const xMotivo = ev?.xMotivo || retorno.xMotivo;
  await registrarEvento(api, nota.id, { tipo: 'rejeitada', status_anterior: 'autorizada', status_novo: 'autorizada', codigo_sefaz: cStat, mensagem: `Carta de correção recusada: ${xMotivo}`, usuario_id: usuarioId });
  throw erro(`SEFAZ ${cStat}: ${xMotivo}`, 422, { sefaz: { cStat, xMotivo } });
}

/** As cartas registradas de uma nota, da mais antiga à mais nova (sem o XML). */
async function listarCartasCorrecao(api, notaId) {
  const id = Number(notaId);
  const eventos = await api.get('/api/notas_fiscais_eventos', { query: { nota_fiscal_id: id, tipo: 'cce' } }).then(lista).catch(() => []);
  return eventos
    .filter(e => e && ['135', '136'].includes(String(e.codigo_sefaz)))
    .map(e => {
      const det = typeof e.detalhe === 'string' ? JSON.parse(e.detalhe || '{}') : (e.detalhe || {});
      return { id: e.id, nSeqEvento: Number(det.nSeqEvento) || 1, correcao: det.correcao || '', protocolo: det.protocolo || null, registradaEm: e.criado_em || null, tem_xml: Boolean(det.xml) };
    })
    .sort((a, b) => a.nSeqEvento - b.nSeqEvento);
}

/** Uma carta pela sequência, com o XML (procEventoNFe). */
async function lerCartaCorrecao(api, notaId, nSeqEvento) {
  const id = Number(notaId);
  const seq = Number(nSeqEvento);
  const eventos = await api.get('/api/notas_fiscais_eventos', { query: { nota_fiscal_id: id, tipo: 'cce' } }).then(lista).catch(() => []);
  const achado = eventos
    .map(e => ({ e, det: typeof e?.detalhe === 'string' ? JSON.parse(e.detalhe || '{}') : (e?.detalhe || {}) }))
    .find(({ e, det }) => e && ['135', '136'].includes(String(e.codigo_sefaz)) && (Number(det.nSeqEvento) || 1) === seq);
  if (!achado) throw erro(`Carta de correção ${seq} não encontrada.`, 404);
  return { id: achado.e.id, nSeqEvento: seq, correcao: achado.det.correcao || '', protocolo: achado.det.protocolo || null, registradaEm: achado.e.criado_em || null, xml: achado.det.xml || null };
}

/**
 * Inutiliza uma faixa de números da série no ambiente escolhido (o efetivo,
 * ou homologação quando pedido). Registra em notas_fiscais_inutilizacoes.
 */
async function inutilizar({ api, entrada = {}, certificado, transporte, env = process.env, usuarioId = null, agora = () => new Date() }) {
  const cfg = await configuracao.carregar(api);
  if (!cfg) throw erro('Configuração fiscal ausente.', 409);
  const efetivo = configuracao.ambienteEfetivo(cfg, env);
  const pedido = String(entrada.ambiente || efetivo).toLowerCase();
  const ambiente = pedido === configuracao.PRODUCAO && efetivo === configuracao.PRODUCAO ? configuracao.PRODUCAO : configuracao.HOMOLOGACAO;
  const instante = agora();
  const ano = Number(String(xmlNfe.partesNoFuso(instante).year).slice(-2));
  const serie = Number(entrada.serie ?? configuracao.numeracao(cfg, ambiente).serie);
  const numeroInicial = Number(entrada.numero_inicial);
  const numeroFinal = Number(entrada.numero_final ?? entrada.numero_inicial);
  const xJust = String(entrada.justificativa || '').replace(/\s+/g, ' ').trim();

  // Número já usado por uma nota que existiu para a SEFAZ não pode ser inutilizado.
  const notas = await api.get('/api/notas_fiscais', { query: { ambiente, serie } }).then(lista).catch(() => []);
  const conflito = notas.find(n => Number(n.numero) >= numeroInicial && Number(n.numero) <= numeroFinal && ['autorizada', 'cancelada', 'denegada', 'processando', 'enviando', 'cancelamento_pendente'].includes(String(n.status_fiscal)));
  if (conflito) throw erro(`O número ${conflito.numero} desta faixa já tem a NF-e ${conflito.status_fiscal}: não pode ser inutilizado.`, 409);

  const xmlInut = assinatura.assinarInutilizacao(sefaz.xmlInutilizacao({
    uf: cfg.uf, ambiente, ano, cnpj: cfg.cnpj, serie, numeroInicial, numeroFinal, justificativa: xJust
  }), certificado);
  const retorno = await sefaz.enviarInutilizacao({ uf: cfg.uf, ambiente, transporte, xmlInut });

  const registro = {
    ambiente, ano, serie, numero_inicial: numeroInicial, numero_final: numeroFinal, justificativa: xJust,
    status: retorno.homologada ? 'homologada' : 'rejeitada', codigo_status_sefaz: retorno.cStat, motivo_sefaz: retorno.xMotivo,
    protocolo: retorno.nProt || null, xml: retorno.homologada ? sefaz.montarProcInut(xmlInut, retorno.xml) : null,
    criado_por: usuarioId, criado_em: instante.toISOString()
  };
  const criado = await api.post('/api/notas_fiscais_inutilizacoes', registro).catch(e => { console.error('Inutilização não registrada:', e.message); return null; });
  const { xml, ...semXmlInut } = registro;
  const resposta = { inutilizacao: { id: criado?.id ?? criado?.data?.id ?? null, ...semXmlInut }, sefaz: { cStat: retorno.cStat, xMotivo: retorno.xMotivo, protocolo: retorno.nProt } };
  if (!retorno.homologada) throw erro(`SEFAZ ${retorno.cStat}: ${retorno.xMotivo}`, 422, resposta);
  // A numeração não volta: se a faixa inutilizada era o próximo número, pula-a.
  const campoProximo = ambiente === configuracao.PRODUCAO ? 'proximo_numero_producao' : 'proximo_numero_homologacao';
  if (Number(cfg[campoProximo]) >= numeroInicial && Number(cfg[campoProximo]) <= numeroFinal) {
    await configuracao.gravar(api, { [campoProximo]: numeroFinal + 1 }, usuarioId).catch(() => {});
  }
  return resposta;
}

async function listarInutilizacoes(api) {
  const linhas = await api.get('/api/notas_fiscais_inutilizacoes').then(lista).catch(() => []);
  return linhas.map(({ xml, ...resto }) => ({ ...resto, tem_xml: Boolean(xml) })).sort((a, b) => Number(b.id) - Number(a.id));
}

module.exports = { cancelar, cartaCorrecao, listarCartasCorrecao, lerCartaCorrecao, inutilizar, listarInutilizacoes };
