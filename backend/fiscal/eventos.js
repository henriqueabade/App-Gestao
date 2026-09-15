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

module.exports = { cancelar };
