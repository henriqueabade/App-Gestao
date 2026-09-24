/**
 * Ordens de pagamento (decisões do dono, 24/09/2026).
 *
 * No modal "Pagamentos", o campo virou "Pago em ou para quando": com data
 * FUTURA — no máximo o vencimento da parcela — o registro vira uma ORDEM DE
 * PAGAMENTO, uma cobrança pendente como um boleto, mas por Pix, cartão,
 * transferência… A baixa é à mão (data, valor e forma confirmados) e vira um
 * recebimento como os outros.
 *
 * Enquanto aberta, a ordem:
 *   - vale como o vencimento da parcela (previsão, atraso e comissão contam
 *     da data dela — contasReceber.js); passou da data sem baixa, fica
 *     atrasada desde ela, com a regra do dia útil;
 *   - ocupa a parcela: não se gera, importa nem informa boleto nela até a
 *     ordem ser cancelada (boletos.js, importacao.js);
 *   - não entra em parcela com boleto do BB em aberto, boleto de fora ou
 *     pagamento registrado.
 *
 * Tabela: sql/ordens_pagamento.sql. Sem ela, nenhuma ordem existe e o resto
 * segue como era.
 */
const boletos = require('./boletos');
const recebimentos = require('./recebimentos');
const externas = require('../fiscal/externas');

const SQL_ARQUIVO = 'sql/ordens_pagamento.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const centavos = v => Math.round(Number(v || 0) * 100) / 100;
const dia = recebimentos.dia;
const impressa = iso => (iso ? iso.split('-').reverse().join('/') : '');
const agora = () => new Date().toISOString();

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** A tabela ainda não existe (SQL da fase não rodou). */
function tabelaAusente(err) {
  const texto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  return /42P01/.test(texto) || /ordens_pagamento.{0,20}(does not exist|não encontrada|não existe)/i.test(texto)
    || (err?.status === 404 && /ordens_pagamento/i.test(texto));
}

/** As ordens ABERTAS (de um pedido ou de todos). Sem a tabela, nenhuma. */
async function abertas(api, query = {}) {
  const linhas = await api.get('/api/ordens_pagamento', { query: { ...query, status: 'aberta' } }).then(lista).catch(() => []);
  return linhas.filter(o => o && o.status === 'aberta' && Object.entries(query).every(([c, v]) => String(o[c]) === String(v)));
}

// Os auxiliares puros moram em boletos.js (que não pode depender deste módulo).
const { ordemDaParcela, ordemParaTela, textoDaParcelaComOrdem } = boletos;

/**
 * Confere uma ordem nova: a data é FUTURA e no máximo o vencimento da
 * parcela (decisão do dono); valor maior que zero; forma conhecida. Pura.
 */
function validarOrdem(entrada, { hoje, vencimentoParcela }) {
  const data = String(entrada?.data_prevista || '').slice(0, 10);
  if (!recebimentos.dataValida(data)) throw erro('Informe para quando é o pagamento.');
  if (data <= hoje) throw erro('A ordem de pagamento é para uma data futura; pagamento de hoje ou de antes se registra direto.');
  const venc = dia(vencimentoParcela);
  if (venc && data > venc) throw erro(`A ordem vai no máximo até o vencimento da parcela (${impressa(venc)}).`);
  const valor = centavos(entrada?.valor);
  if (!(valor > 0)) throw erro('Informe o valor da ordem.');
  const forma = String(entrada?.forma || '');
  if (!recebimentos.FORMAS.includes(forma)) throw erro(`Informe como o cliente vai pagar (${recebimentos.FORMAS.join(', ')}).`);
  const observacao = String(entrada?.observacao || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  return { data, valor, forma, observacao };
}

/** Cria a ordem da parcela `numero_parcela` do pedido. */
async function criar({ api, pedidoId, entrada, usuarioId = null, hoje }) {
  const dados = await boletos.lerPedidoCobranca(api, pedidoId);
  if (String(dados.pedido.situacao || '').toLowerCase() === 'cancelado') throw erro('Pedido cancelado não recebe.', 409);
  const numeroParcela = Number(entrada?.numero_parcela);
  const parcela = dados.parcelas.find(p => Number(p.numero_parcela) === numeroParcela);
  if (!parcela) throw erro(`O pedido não tem a parcela ${entrada?.numero_parcela ?? '?'}.`, 404);
  const v = validarOrdem(entrada, { hoje, vencimentoParcela: parcela.data_vencimento });

  const paga = boletos.pagamentoDaParcela(dados.recebimentos, parcela);
  if (paga) throw erro(`A parcela ${numeroParcela} já tem pagamento registrado.`, 409);
  const boleto = boletos.boletoDaParcela(dados.boletos, parcela);
  if (boleto && boletos.STATUS_A_PAGAR.has(String(boleto.status))) {
    throw erro(`A parcela ${numeroParcela} já é cobrada pelo boleto do BB ${boleto.nosso_numero}: baixe ou estorne o boleto antes de marcar outra forma de pagamento.`, 409);
  }
  if (externas.boletoExternoDaParcela(dados.boletosExternos, parcela)) {
    throw erro(`A parcela ${numeroParcela} já é cobrada por um boleto de fora: remova-o antes.`, 409);
  }
  if (ordemDaParcela(dados.ordens, parcela)) throw erro(`A parcela ${numeroParcela} já tem ordem de pagamento aberta.`, 409);

  try {
    const criado = await api.post('/api/ordens_pagamento', {
      pedido_id: dados.pedido.id, parcela_id: parcela.id ?? null, numero_parcela: numeroParcela,
      data_prevista: v.data, valor: v.valor, forma: v.forma, observacao: v.observacao || null,
      status: 'aberta', criado_por: usuarioId, criado_em: agora()
    });
    return { ordem: ordemParaTela(criado, hoje) };
  } catch (e) {
    if (tabelaAusente(e)) throw erro(SQL_FALTANDO, 409, { sql_pendente: true });
    if (/duplicate key|23505|uma_aberta/i.test(`${e?.message || ''} ${e?.body?.detalhe || ''}`)) throw erro(`A parcela ${numeroParcela} já tem ordem de pagamento aberta.`, 409);
    throw e;
  }
}

async function lerAberta(api, id) {
  const numeroId = Number(id);
  if (!Number.isInteger(numeroId) || numeroId <= 0) throw erro('Ordem inválida.');
  const o = await api.get('/api/ordens_pagamento', { query: { id: numeroId } }).then(lista).then(l => l.find(x => Number(x?.id) === numeroId) || null)
    .catch(e => { if (tabelaAusente(e)) throw erro(SQL_FALTANDO, 409, { sql_pendente: true }); throw e; });
  if (!o) throw erro('Ordem de pagamento não encontrada.', 404);
  if (o.status !== 'aberta') throw erro(`Esta ordem já foi ${o.status === 'baixada' ? 'baixada' : 'cancelada'}.`, 409);
  return o;
}

/**
 * A baixa: o cliente pagou. Vira um recebimento à mão (data até hoje, valor e
 * forma confirmados) e a ordem fica "baixada", ligada a ele.
 */
async function baixar({ api, id, entrada, usuarioId = null, hoje }) {
  const o = await lerAberta(api, id);
  const recebimento = await recebimentos.registrarManual({
    api, usuarioId, hoje,
    entrada: {
      pedido_id: o.pedido_id, numero_parcela: o.numero_parcela,
      data_recebimento: entrada?.data_recebimento, valor_recebido: entrada?.valor_recebido,
      forma: entrada?.forma || o.forma,
      observacao: String(entrada?.observacao || o.observacao || '').trim() || `Baixa da ordem de pagamento de ${impressa(dia(o.data_prevista))}.`
    }
  });
  await api.put(`/api/ordens_pagamento/${o.id}`, { status: 'baixada', recebimento_id: recebimento.id ?? null, baixada_por: usuarioId, baixada_em: agora(), atualizado_em: agora() });
  return { recebimento, ordem: { ...o, status: 'baixada', recebimento_id: recebimento.id ?? null } };
}

/** Cancela a ordem: a parcela volta a ficar livre (para boleto ou outra ordem). */
async function cancelar({ api, id, motivo = '', usuarioId = null }) {
  const o = await lerAberta(api, id);
  const campos = {
    status: 'cancelada', cancelada_por: usuarioId, cancelada_em: agora(),
    motivo_cancelamento: String(motivo || '').replace(/\s+/g, ' ').trim().slice(0, 500) || null, atualizado_em: agora()
  };
  await api.put(`/api/ordens_pagamento/${o.id}`, campos);
  return { ordem: { ...o, ...campos } };
}

/**
 * Pagamento registrado direto na parcela (sem passar pela baixa): a ordem
 * aberta dela fica baixada com ele — o cliente pagou, a ordem cumpriu-se.
 */
async function baixarPelaParcela(api, recebimento, usuarioId = null) {
  if (!recebimento?.pedido_id) return null;
  const doPedido = await abertas(api, { pedido_id: recebimento.pedido_id });
  const o = doPedido.find(x => Number(x.numero_parcela) === Number(recebimento.numero_parcela)) || null;
  if (!o) return null;
  await api.put(`/api/ordens_pagamento/${o.id}`, { status: 'baixada', recebimento_id: recebimento.id ?? null, baixada_por: usuarioId, baixada_em: agora(), atualizado_em: agora() }).catch(() => null);
  return o;
}

module.exports = {
  SQL_ARQUIVO, SQL_FALTANDO, tabelaAusente,
  abertas, ordemDaParcela, ordemParaTela, textoDaParcelaComOrdem, validarOrdem,
  criar, baixar, cancelar, baixarPelaParcela
};
