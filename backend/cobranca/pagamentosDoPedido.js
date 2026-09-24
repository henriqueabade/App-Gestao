/**
 * Pagamentos das parcelas de UM pedido — o modal "Pagamentos" do Visualizar
 * (decisões do dono, 24/09/2026).
 *
 * O cliente pode pagar uma parcela por Pix, cartão, transferência… sem boleto
 * nenhum, ou mesmo tendo boleto. O modal mostra cada parcela com a situação
 * (paga, em aberto, atrasada, com boleto), registra o pagamento à mão e
 * estorna o registrado por engano. Gravar e estornar são as rotas que já
 * existiam (`POST /api/cobranca/recebimentos` e `/recebimentos/:id/estornar`);
 * aqui fica só a leitura e a sugestão de multa e juros.
 *
 * O pagamento registrado entra na comissão e no royalty como qualquer
 * recebimento: a base é o valor da parcela (multa e juros não entram), na
 * competência do mês em que o cliente pagou. Pedido ainda em produção passa a
 * contar como faturado quando tem pagamento (contasReceber.js).
 *
 * Atraso e encargos seguem o vencimento em dia não útil (`vencimento.js`).
 */
const boletos = require('./boletos');
const recebimentos = require('./recebimentos');
const contasReceber = require('./contasReceber');
const vencimentos = require('./vencimento');
const externas = require('../fiscal/externas');

const centavos = v => Math.round(Number(v || 0) * 100) / 100;
const dia = recebimentos.dia;

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

const pedidoCancelado = pedido => String(pedido?.situacao || '').trim().toLowerCase() === 'cancelado';

/**
 * As parcelas do pedido como o modal mostra. `linhas` são as de
 * contasReceber.parcelasDosPedidos (com o pedido tratado como faturado);
 * `recebimentosDoPedido`, todos os do pedido (para a observação e os
 * encargos, que a linha não traz). Pura.
 */
function parcelasParaPagamento({ linhas = [], parcelas = [], boletosExternos = [], recebimentosDoPedido = [], hoje, feriados = [], cancelado = false }) {
  const recPorId = new Map((recebimentosDoPedido || []).filter(Boolean).map(r => [String(r.id), r]));
  return linhas.map(l => {
    const crua = parcelas.find(p => Number(p.id) === Number(l.parcela_id) || Number(p.numero_parcela) === Number(l.numero_parcela)) || {};
    const r = l.recebimento ? recPorId.get(String(l.recebimento.id)) || null : null;
    const vencPapel = dia(crua.data_vencimento) || l.vencimento;
    const boletoAberto = Boolean(l.boleto && boletos.STATUS_A_PAGAR.has(String(l.boleto.status)));
    const pagoNoBanco = !l.recebimento && l.estado === 'recebida';
    let situacao = 'aberta';
    if (l.recebimento) situacao = 'paga';
    else if (pagoNoBanco) situacao = 'paga_no_banco';
    else if (l.estado === 'cancelada') situacao = 'cancelada';
    else if (l.dias_atraso > 0) situacao = 'atrasada';
    const origem = l.recebimento?.origem || null;
    return {
      parcela_id: l.parcela_id, numero_parcela: l.numero_parcela, parcela: l.parcela,
      vencimento: l.vencimento,
      // O boleto prorrogado vence noutro dia: a tela mostra os dois.
      vencimento_original: vencPapel && vencPapel !== l.vencimento ? vencPapel : null,
      limite_sem_encargos: vencimentos.limiteSemEncargos(l.vencimento, feriados),
      dias_atraso: l.dias_atraso,
      valor: l.valor, abatimento: l.abatimento, a_receber: l.a_receber,
      situacao,
      boleto: l.boleto ? { id: l.boleto.id, status: l.boleto.status, nosso_numero: l.boleto.nosso_numero, ambiente: l.boleto.ambiente, motivo_baixa: l.boleto.motivo_baixa } : null,
      boleto_aberto: boletoAberto,
      boleto_externo: externoDaParcela(boletosExternos, crua),
      recebimento: l.recebimento ? {
        id: l.recebimento.id, data: l.recebimento.data, valor: l.recebimento.valor, forma: l.recebimento.forma,
        origem, origem_rotulo: recebimentos.ORIGENS[origem] || origem,
        competencia: l.recebimento.competencia,
        encargos: r ? centavos(r.valor_encargos || 0) : 0,
        observacao: r?.observacao || null,
        // O que veio do banco só o BB desfaz (recebimentos.estornar).
        pode_estornar: origem !== 'boleto'
      } : null,
      pode_registrar: !cancelado && situacao !== 'paga' && situacao !== 'paga_no_banco' && situacao !== 'cancelada' && l.valor > 0
    };
  });
}

/** O boleto emitido fora da parcela, só com o que o modal mostra. Pura. */
function externoDaParcela(externos, parcela) {
  const b = externas.boletoParaTela(externas.boletoExternoDaParcela(externos, parcela));
  return b ? { id: b.id, banco_nome: b.banco_nome, vencimento: b.vencimento, valor: b.valor } : null;
}

/** Os números do rodapé do modal. Pura. */
function resumoDosPagamentos(parcelas) {
  const pagas = parcelas.filter(p => p.situacao === 'paga' || p.situacao === 'paga_no_banco');
  return {
    parcelas: parcelas.length,
    pagas: pagas.length,
    recebido: centavos(pagas.reduce((s, p) => s + Number(p.recebimento?.valor ?? p.a_receber ?? 0), 0)),
    em_aberto: centavos(parcelas.filter(p => p.situacao === 'aberta' || p.situacao === 'atrasada').reduce((s, p) => s + Number(p.a_receber || 0), 0)),
    atrasadas: parcelas.filter(p => p.situacao === 'atrasada').length
  };
}

/** Lê o pedido e monta a tela. */
async function estadoDosPagamentos({ api, pedidoId, hoje }) {
  const dados = await boletos.lerPedidoCobranca(api, pedidoId);
  let recs = [];
  let sqlPendente = false;
  try {
    recs = await recebimentos.lerTodos(api, { pedido_id: dados.pedido.id });
  } catch (e) {
    if (!e?.extra?.sql_pendente) throw e;
    sqlPendente = true;
  }
  const feriados = await contasReceber.lerFeriados(api);
  const cancelado = pedidoCancelado(dados.pedido);
  // O modal mostra TODAS as parcelas, inclusive do pedido em produção sem nota
  // nem boleto: para as contas, o pedido é tratado como faturado.
  const linhas = contasReceber.parcelasDosPedidos({
    pedidos: [{ ...dados.pedido, situacao: 'Entregue' }], parcelas: dados.parcelas,
    recebimentos: recs, boletos: dados.boletos,
    notas: dados.notaViva ? [{ ...dados.notaViva, pedido_id: dados.pedido.id }] : [],
    hoje, feriados
  });
  const parcelas = parcelasParaPagamento({
    linhas, parcelas: dados.parcelas, boletosExternos: dados.boletosExternos,
    recebimentosDoPedido: recs, hoje, feriados, cancelado
  });
  return {
    pedido: {
      id: dados.pedido.id, numero: dados.pedido.numero ?? String(dados.pedido.id), situacao: dados.pedido.situacao,
      forma_pagamento: dados.pedido.forma_pagamento || null,
      cliente: dados.cliente ? (dados.cliente.nome_fantasia || dados.cliente.razao_social || dados.cliente.nome || null) : null,
      cancelado
    },
    hoje,
    formas: recebimentos.FORMAS,
    sql_pendente: sqlPendente,
    parcelas,
    resumo: resumoDosPagamentos(parcelas),
    // Para a sugestão de multa e juros (as regras dos boletos).
    _cfg: dados.configuracao || {},
    _feriados: feriados
  };
}

/**
 * A multa e os juros sugeridos para pagar a parcela `numeroParcela` em
 * `data`: zero até o limite sem encargos; depois, pelas regras dos boletos,
 * desde o vencimento do papel.
 */
async function encargosDaParcela({ api, pedidoId, numeroParcela, data, hoje }) {
  const quando = dia(data);
  if (!quando || !recebimentos.dataValida(quando)) throw erro('Informe a data do pagamento.');
  const estado = await estadoDosPagamentos({ api, pedidoId, hoje });
  const p = estado.parcelas.find(x => Number(x.numero_parcela) === Number(numeroParcela));
  if (!p) throw erro(`O pedido não tem a parcela ${numeroParcela}.`, 404);
  const e = vencimentos.encargosDoAtraso({ valor: p.a_receber, vencimento: p.vencimento, data: quando, cfg: estado._cfg, feriados: estado._feriados });
  return { numero_parcela: p.numero_parcela, data: quando, vencimento: p.vencimento, ...e };
}

/** O estado sem os campos internos (o que vai para a tela). */
function paraTela(estado) {
  const { _cfg, _feriados, ...resto } = estado;
  return resto;
}

module.exports = { parcelasParaPagamento, resumoDosPagamentos, estadoDosPagamentos, encargosDaParcela, paraTela };
