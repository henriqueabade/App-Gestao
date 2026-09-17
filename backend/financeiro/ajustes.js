/**
 * Ajustes comerciais por parcela (fase G): devolução, desconto comercial,
 * abatimento, cancelamento parcial e outros. Um ajuste REDUZ o valor
 * líquido da parcela — a base da CMS e do Royalty — e fica guardado à
 * parte (o valor original nunca é apagado).
 *
 *   - antes do fechamento da comissão da parcela: a parcela entra no
 *     fechamento já pelo valor ajustado;
 *   - depois: o fechamento não muda; a diferença entra como ajuste negativo
 *     na próxima competência (comissoes.apurar).
 *
 * O ajuste não mexe no boleto. Abatimento em parcela com boleto em aberto
 * é feito no próprio boleto (Detalhes do boleto), que é o que o cliente
 * paga — e o abatimento do boleto já reduz a base; registrar os dois
 * contaria em dobro. Cancelar um ajuste só enquanto ele não entrou em
 * fechamento.
 */
const c = require('./comum');
const comissoes = require('./comissoes');
const regras = require('./regras');
const auditoria = require('./auditoria');
const base = require('./base');
const boletos = require('../cobranca/boletos');

const TIPOS = comissoes.TIPOS_AJUSTE;

function validar(entrada, hoje) {
  const pedidoId = Number(entrada?.pedido_id);
  const numero = Number(entrada?.numero_parcela);
  if (!(Number.isInteger(pedidoId) && pedidoId > 0)) throw c.erro('Escolha a parcela.');
  if (!(Number.isInteger(numero) && numero > 0)) throw c.erro('Escolha a parcela.');
  const tipo = String(entrada?.tipo || '');
  if (!TIPOS[tipo]) throw c.erro('Escolha o tipo de ajuste.');
  const valor = c.centavos(entrada?.valor);
  if (!(valor > 0)) throw c.erro('Informe o valor do ajuste.');
  const data = String(entrada?.data_ajuste || '').slice(0, 10);
  if (!c.dataValida(data)) throw c.erro('Informe a data do ajuste.');
  if (data > hoje) throw c.erro('A data do ajuste não pode ser futura.');
  const motivo = c.texto(entrada?.motivo, 200);
  if (motivo.length < 3) throw c.erro('Diga o motivo do ajuste.');
  return { pedidoId, numero, tipo, valor, data, motivo, observacao: c.texto(entrada?.observacao, 500) || null };
}

/** A situação de comissão de uma parcela (com os ajustes e o que já foi fechado). */
async function parcela(api, { pedidoId, numero, hoje, desde }) {
  const b = await base.lerComissoes(api, { hoje, desde });
  const estado = comissoes.estadoDosFechamentos({ ...b, tipo: 'comissao' });
  const todas = comissoes.apurar({
    linhas: b.linhas.filter(l => Number(l.pedido_id) === Number(pedidoId)),
    pedidos: b.receber.pedidos, parcelas: b.receber.parcelas.filter(p => Number(p.pedido_id) === Number(pedidoId)),
    recebimentos: b.receber.recebimentos.filter(r => Number(r.pedido_id) === Number(pedidoId)),
    ajustes: b.ajustes.filter(a => Number(a.pedido_id) === Number(pedidoId)),
    regrasLista: b.regras.regras, estado: { ...estado, congelados: estado.congelados.filter(i => Number(i.pedido_id) === Number(pedidoId)) }, hoje
  });
  return { alvo: todas.find(p => Number(p.numero_parcela) === Number(numero)) || null, doPedido: todas, base: b, estado };
}

/** O que o ajuste faria: valor líquido e comissão antes/depois, e se vira estorno futuro. Pura. */
function impacto(p, valor) {
  const novoLiquido = c.centavos(Math.max(0, p.liquido - Number(valor || 0)));
  const depois = regras.valoresSobre(novoLiquido, p.taxas);
  return {
    original: p.valor_original,
    abatimento_boleto: p.abatimento_boleto,
    anteriores: c.centavos(-p.ajustes_total),
    novo: c.centavos(-Number(valor || 0)),
    liquido_antes: p.liquido,
    liquido: novoLiquido,
    cms_antes: p.potencial.cms, royalty_antes: p.potencial.royalty,
    cms: depois.cms, royalty: depois.royalty,
    excede: Number(valor || 0) > p.liquido,
    gera_estorno: p.comissao_fechada && p.estado_parcela === 'recebida',
    diferenca: c.centavos(depois.total - p.potencial.total)
  };
}

async function registrar({ api, entrada, usuarioId = null, hoje, desde = null }) {
  const v = validar(entrada, hoje);
  const { alvo } = await parcela(api, { pedidoId: v.pedidoId, numero: v.numero, hoje, desde });
  if (!alvo) throw c.erro(`A parcela ${v.numero} deste pedido não está nas contas do Financeiro (pedido ainda não faturado?).`, 404);
  if (alvo.estado_parcela === 'cancelada') throw c.erro('Esta parcela foi cancelada: não há o que ajustar.', 409);
  if (v.valor > alvo.liquido) throw c.erro(`O ajuste (${c.reais(v.valor)}) é maior que o valor líquido que resta na parcela (${c.reais(alvo.liquido)}).`, 409);
  const boletoAberto = alvo.boleto && boletos.STATUS_A_PAGAR.has(String(alvo.boleto.status));
  if (v.tipo === 'abatimento' && boletoAberto) {
    throw c.erro(`A parcela tem boleto em aberto no BB (${alvo.boleto.nosso_numero}): conceda o abatimento no próprio boleto (Detalhes do boleto). Ele já reduz a base da comissão.`, 409);
  }
  const efeito = impacto(alvo, v.valor);
  const ajuste = await c.inserir(api, 'ajustes_financeiros', {
    pedido_id: v.pedidoId, numero_parcela: v.numero, parcela_id: null, nota_fiscal_id: null,
    tipo: v.tipo, valor: v.valor, data_ajuste: v.data, competencia: c.competenciaDe(v.data),
    motivo: v.motivo, observacao: v.observacao, status: 'ativo', criado_por: usuarioId, criado_em: c.agora()
  });
  await auditoria.registrar(api, {
    tipo: 'ajuste_registrado', pedidoId: v.pedidoId, numeroParcela: v.numero, referenciaId: ajuste.id, valor: -v.valor, usuarioId,
    descricao: `${TIPOS[v.tipo]} de ${c.reais(v.valor)} na parcela ${alvo.parcela} do pedido ${alvo.pedido}: ${v.motivo}${efeito.gera_estorno ? ' (comissão já fechada: estorno na próxima competência)' : ''}`,
    dados: { impacto: efeito }
  });
  return { ajuste, impacto: efeito, boleto_aberto: Boolean(boletoAberto) };
}

/**
 * Os ajustes de uma DEVOLUÇÃO de pedido (backend/devolucoes): um por parcela
 * paga que teve parte reembolsada ao cliente — `partes`: [{ numero, valor }].
 * É o mesmo ajuste "Devolução" da tela, lançado de uma vez: a base da CMS e
 * do Royalty cai, e a comissão já fechada é estornada na próxima competência.
 * Cada parte é limitada ao valor líquido que resta na parcela.
 */
async function registrarDaDevolucao({ api, pedidoId, partes = [], data, motivo, usuarioId = null, hoje, desde = null }) {
  const validas = partes.filter(p => Number(p?.numero) > 0 && c.centavos(p?.valor) > 0);
  if (!validas.length) return [];
  const dataAjuste = c.dataValida(String(data || '').slice(0, 10)) && String(data).slice(0, 10) <= hoje ? String(data).slice(0, 10) : hoje;
  const { doPedido } = await parcela(api, { pedidoId, numero: validas[0].numero, hoje, desde });
  const texto = c.texto(motivo, 200) || 'Devolução do cliente';
  const saida = [];
  for (const parte of validas) {
    const alvo = doPedido.find(p => Number(p.numero_parcela) === Number(parte.numero));
    if (!alvo) { saida.push({ numero: parte.numero, ajuste: null, motivo: 'a parcela não está nas contas do Financeiro' }); continue; }
    const valor = Math.min(c.centavos(parte.valor), c.centavos(alvo.liquido));
    if (!(valor > 0)) { saida.push({ numero: parte.numero, ajuste: null, motivo: 'a parcela não tem mais valor líquido' }); continue; }
    const efeito = impacto(alvo, valor);
    const ajuste = await c.inserir(api, 'ajustes_financeiros', {
      pedido_id: Number(pedidoId), numero_parcela: Number(parte.numero), parcela_id: null, nota_fiscal_id: null,
      tipo: 'devolucao', valor, data_ajuste: dataAjuste, competencia: c.competenciaDe(dataAjuste),
      motivo: texto, observacao: null, status: 'ativo', criado_por: usuarioId, criado_em: c.agora()
    });
    await auditoria.registrar(api, {
      tipo: 'ajuste_registrado', pedidoId: Number(pedidoId), numeroParcela: Number(parte.numero), referenciaId: ajuste.id, valor: -valor, usuarioId,
      descricao: `${TIPOS.devolucao} de ${c.reais(valor)} na parcela ${alvo.parcela} do pedido ${alvo.pedido}: ${texto}${efeito.gera_estorno ? ' (comissão já fechada: estorno na próxima competência)' : ''}`,
      dados: { impacto: efeito }
    });
    saida.push({ numero: Number(parte.numero), ajuste, gera_estorno: efeito.gera_estorno });
  }
  return saida;
}

async function cancelar({ api, id, motivo, usuarioId = null, hoje, desde = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que o ajuste está sendo cancelado.');
  const ajuste = (await c.ler(api, 'ajustes_financeiros', { id: Number(id) }))[0];
  if (!ajuste) throw c.erro('Ajuste não encontrado.', 404);
  if (ajuste.status !== 'ativo') throw c.erro('Este ajuste já foi cancelado.', 409);
  const { alvo } = await parcela(api, { pedidoId: ajuste.pedido_id, numero: ajuste.numero_parcela, hoje, desde });
  const noFechamento = alvo?.ajustes.find(a => String(a.id) === String(ajuste.id))?.no_fechamento;
  if (noFechamento) throw c.erro('Este ajuste já entrou num fechamento de comissões: não pode mais ser cancelado.', 409);
  const campos = { status: 'cancelado', cancelado_em: c.agora(), cancelado_por: usuarioId, motivo_cancelamento: texto };
  await c.atualizar(api, 'ajustes_financeiros', ajuste.id, campos);
  await auditoria.registrar(api, {
    tipo: 'ajuste_cancelado', pedidoId: ajuste.pedido_id, numeroParcela: ajuste.numero_parcela, referenciaId: ajuste.id, valor: Number(ajuste.valor), usuarioId,
    descricao: `${TIPOS[ajuste.tipo] || ajuste.tipo} de ${c.reais(ajuste.valor)} cancelado (parcela ${ajuste.numero_parcela}): ${texto}`
  });
  return { ...ajuste, ...campos };
}

module.exports = { TIPOS, validar, parcela, impacto, registrar, registrarDaDevolucao, cancelar };
