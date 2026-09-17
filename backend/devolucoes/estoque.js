/**
 * A peça devolvida pelo cliente volta ao estoque como PEÇA PRONTA: ela saiu
 * acabada, então entra no lote do fim da rota do produto. Nenhum insumo volta
 * — o material está na peça.
 *
 * O caminho é o do cancelamento (cancelamentoEstorno.js): achar ou criar o
 * lote, somar, e gravar o movimento no razão. O tipo do movimento é próprio
 * (`retorno_devolucao`, "Devolvida pelo cliente"), para o histórico da peça
 * não confundir devolução com cancelamento.
 */
const { MOV, ITEM, registrarMovimento } = require('../estoqueLedger');
const { carregarInsumos, carregarRota, lotePara, TABELA_LOTES } = require('../cancelamentoEstorno');

const numero = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** O que se repete entre as peças de uma mesma devolução. */
function criarContexto() {
  return { insumos: null, rotas: new Map(), lotes: new Map() };
}

/** Produto sem rota cadastrada: o lote "sem ponto" dele (ou um novo). */
async function loteSemRota(api, produtoId, ctx, avisos) {
  const chave = `${produtoId}:sem-rota`;
  if (ctx.lotes.has(chave)) return ctx.lotes.get(chave);
  const existentes = await api.get(TABELA_LOTES, { query: { produto_id: produtoId } }).catch(() => []);
  let lote = (Array.isArray(existentes) ? existentes : [])
    .find(l => Number(l?.produto_id) === Number(produtoId) && (l.ultimo_insumo_id === null || l.ultimo_insumo_id === undefined)) || null;
  if (!lote) {
    lote = await api.post(TABELA_LOTES, {
      produto_id: produtoId, etapa_id: null, ultimo_insumo_id: null, quantidade: 0, data_hora_completa: new Date().toISOString()
    }).catch(err => {
      avisos.push(`Falha ao criar o lote do produto ${produtoId}: ${err?.message || err}`);
      return null;
    });
    if (lote) lote = { ...lote, quantidade: 0 };
  }
  if (lote) ctx.lotes.set(chave, lote);
  return lote;
}

/**
 * Devolve `quantidade` peças do produto ao estoque. Responde
 * { lote_id, movimento_id, erro } — `erro` quando a peça NÃO entrou no lote.
 */
async function devolverAoEstoque(api, { pedido, item, quantidade, usuarioId = null }, ctx, avisos = []) {
  const produtoId = Number(item?.produto_id);
  const qtd = numero(quantidade);
  if (!Number.isFinite(produtoId) || produtoId <= 0) return { lote_id: null, movimento_id: null, erro: 'A peça não tem produto cadastrado: não há estoque para onde voltar.' };
  if (!(qtd > 0)) return { lote_id: null, movimento_id: null, erro: 'Quantidade inválida.' };

  if (!ctx.insumos) ctx.insumos = await carregarInsumos(api);
  const rota = await carregarRota(api, produtoId, ctx.rotas, ctx.insumos);
  const fim = rota[rota.length - 1] || null;
  const lote = fim
    ? await lotePara(api, { produtoId, passo: fim, lotePreferido: null }, ctx.lotes, avisos)
    : await loteSemRota(api, produtoId, ctx, avisos);
  if (!lote?.id) return { lote_id: null, movimento_id: null, erro: 'Não foi possível achar nem criar o lote de peça pronta.' };

  const nova = numero(lote.quantidade) + qtd;
  try {
    await api.put(`${TABELA_LOTES}/${lote.id}`, { quantidade: nova, data_hora_completa: new Date().toISOString() });
  } catch (err) {
    return { lote_id: lote.id, movimento_id: null, erro: `Falha ao somar ao lote ${lote.id}: ${err?.message || err}` };
  }
  lote.quantidade = nova;

  const movimentoId = await registrarMovimento(api, {
    tipoMovimento: MOV.RETORNO_DEVOLUCAO,
    tipoAlternativo: MOV.RETORNO,
    tipoItem: ITEM.PECA,
    itemId: produtoId,
    quantidade: qtd,
    pedidoId: pedido?.id ?? null,
    pedidoItemId: item?.pedido_item_id ?? null,
    loteId: lote.id,
    ultimoInsumoId: fim?.insumo_id ?? null,
    nota: `Devolução do cliente (pedido ${pedido?.numero || pedido?.id}): voltou ao estoque como peça pronta`,
    usuarioId
  }, avisos);
  return { lote_id: lote.id, movimento_id: movimentoId, erro: null };
}

module.exports = { criarContexto, devolverAoEstoque };
