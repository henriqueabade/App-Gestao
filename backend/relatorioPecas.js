/**
 * As três leituras do relatório de peças de um pedido.
 *
 *   | seção            | responde                                             |
 *   |------------------|------------------------------------------------------|
 *   | seleção original | o que a conversão escolheu                           |
 *   | alterações       | o que mudou depois — peças recebidas de outro pedido |
 *   | destinações      | o que foi feito com cada peça ao cancelar            |
 *
 * Fora do controller de propósito: aqui é regra sobre dados já lidos, e essa
 * separação é o que permite testá-la sem subir rota, banco e permissão.
 *
 * `rotaDoProduto` chega de fora (o controller já a mantém em cache) para não
 * repetir a leitura de `produtos_insumos` a cada linha.
 */

/** "9/15 — Tag de Papel", ou "Pronta" no fim da rota, a partir do passo. */
function rotuloDoPasso(rota, passoId) {
  const total = rota.length;
  const passo = rota.find(p => Number(p.passo_id) === Number(passoId)) || null;
  if (!passo) return '—';
  return passo.ordem_insumo >= total
    ? `Pronta ${passo.ordem_insumo}/${total}`
    : `${passo.insumo_nome} ${passo.ordem_insumo}/${total}`;
}

/**
 * As peças que este pedido RECEBEU por realocação, e o que cada uma substituiu.
 *
 * Vem de `realocacoes`, uma linha por substituição. Sem esta seção o relatório
 * mostra a composição atual como se fosse a original, e a alteração — que é o
 * que mudou o plano de produção — não aparece em lugar nenhum.
 */
async function alteracoesRecebidas(api, brutas, rotaDoProduto, listaItens) {
  const lista = Array.isArray(brutas) ? brutas : [];
  if (!lista.length) return [];

  const itensPorId = new Map(listaItens.map(i => [String(i.id), i]));
  const numeroPorPedido = new Map();
  const saida = [];

  for (const rea of lista) {
    const item = itensPorId.get(String(rea.pedido_item_id_destino))
      || listaItens[0]
      || null;
    const rota = item ? await rotaDoProduto(item.produto_id) : [];

    const origemId = rea.pedido_id_origem ?? null;
    if (origemId !== null && !numeroPorPedido.has(String(origemId))) {
      const pedidoOrigem = await api.get(`/api/pedidos/${origemId}`).catch(() => null);
      numeroPorPedido.set(String(origemId), pedidoOrigem?.numero || `#${origemId}`);
    }

    saida.push({
      peca: item?.nome || item?.codigo || '—',
      quantidade: Number(rea.quantidade) || 0,
      recebida: rotuloDoPasso(rota, rea.ultimo_insumo_id_origem),
      // Produção do zero não tem passo: o que foi substituído é o plano de
      // produzir, não uma peça que existia.
      substituiu: rea.tipo_destino_substituido === 'producao_zero'
        ? 'Produzir do zero'
        : rotuloDoPasso(rota, rea.ultimo_insumo_id_substituido),
      tipo_substituido: rea.tipo_destino_substituido || null,
      liberou_peca: Boolean(rea.movimento_id_peca_liberada),
      origem: origemId === null ? '—' : numeroPorPedido.get(String(origemId)),
      data: rea.created_at || null
    });
  }

  return saida;
}

/**
 * A composição como era ANTES das substituições.
 *
 * Não existe foto guardada da conversão — `pedido_itens_ext` é o estado atual e
 * muda a cada substituição. Mas a reconstrução é exata, porque cada alteração
 * está registrada: desfazer uma substituição é tirar a peça que chegou e
 * devolver a que saiu. É o inverso literal do que a realocação fez.
 *
 * Quando a linha de origem não é encontrada (dado antigo, sem os campos novos),
 * a unidade é devolvida como "Produzir do zero" — o estado mais provável e o
 * único que não inventa uma peça no estoque.
 */
async function reconstruirSelecaoOriginal(linhasAtuais, brutas, rotaDoProduto, listaItens) {
  const linhas = linhasAtuais.map(l => ({ ...l }));
  const itensPorId = new Map(listaItens.map(i => [String(i.id), i]));

  const acharLinha = (peca, rotulo) => linhas.find(l => l.peca === peca && l.item_parada === rotulo);

  for (const rea of (Array.isArray(brutas) ? brutas : [])) {
    const item = itensPorId.get(String(rea.pedido_item_id_destino)) || listaItens[0] || null;
    if (!item) continue;
    const rota = await rotaDoProduto(item.produto_id);
    const total = rota.length;
    const peca = item.nome || item.codigo || `Item ${item.id}`;
    const quantidade = Number(rea.quantidade) || 0;
    if (!(quantidade > 0)) continue;

    // 1. A peça que CHEGOU não estava aqui.
    const passoRecebido = rota.find(p => Number(p.passo_id) === Number(rea.ultimo_insumo_id_origem)) || null;
    const recebida = acharLinha(peca, passoRecebido?.insumo_nome || '—');
    if (recebida) recebida.quantidade = Math.max(0, recebida.quantidade - quantidade);

    // 2. A que SAIU estava.
    if (rea.tipo_destino_substituido === 'producao_zero' || !rea.ultimo_insumo_id_substituido) {
      const doZero = linhas.find(l => l.peca === peca && l.origem === 'Produzir do zero');
      if (doZero) {
        doZero.quantidade += quantidade;
      } else {
        linhas.push({
          peca,
          codigo: item.codigo || '',
          origem: 'Produzir do zero',
          quantidade,
          etapa: rota.length ? rota[0].processo : '—',
          item_parada: '—',
          lote_id: null,
          itens_faltantes: total,
          itens_da_rota: total
        });
      }
      continue;
    }

    const passoSubstituido = rota.find(p => Number(p.passo_id) === Number(rea.ultimo_insumo_id_substituido)) || null;
    const faltam = passoSubstituido ? Math.max(0, total - passoSubstituido.ordem_insumo) : total;
    const substituida = acharLinha(peca, passoSubstituido?.insumo_nome || '—');
    if (substituida) {
      substituida.quantidade += quantidade;
    } else {
      linhas.push({
        peca,
        codigo: item.codigo || '',
        origem: faltam === 0 ? 'Pronta do estoque' : 'Parcial do estoque',
        quantidade,
        etapa: passoSubstituido?.processo || (faltam === 0 ? 'Finalizada' : '—'),
        item_parada: passoSubstituido?.insumo_nome || '—',
        lote_id: rea.lote_id_substituido ?? null,
        itens_faltantes: faltam,
        itens_da_rota: total
      });
    }
  }

  return linhas.filter(l => l.quantidade > 0);
}

/** Rótulo de cada tipo de destinação, para o relatório não mostrar o slug cru. */
const ROTULO_DA_DESTINACAO = {
  retorno_estoque: 'Retornou ao estoque',
  descarte_restaura_lote: 'Descartada (restaurou o lote de origem)',
  nao_retorna_produto: 'Não retornou como produto',
  realocacao: 'Realocada para outro pedido'
};

/**
 * O que foi feito com cada peça quando ESTE pedido foi cancelado.
 *
 * Vem de `cancelamento_destinacoes`, a fonte única do cancelamento. Enquanto o
 * SQL da auditoria não tiver rodado, a consulta falha e a seção simplesmente
 * não aparece — o resto do relatório continua igual.
 */
async function destinacoesDoCancelamento(api, pedidoId, rotaDoProduto, listaItens) {
  const brutas = await api
    .get('/api/cancelamento_destinacoes', { query: { pedido_id: pedidoId } })
    .catch(() => []);
  const lista = Array.isArray(brutas) ? brutas : [];
  if (!lista.length) return [];

  // O que cada realocação substituiu do outro lado.
  //
  // "Realocada para o PED23" não fecha a história: substituir uma produção do
  // zero e substituir uma peça pronta são consequências completamente
  // diferentes lá. O dado já existe em `realocacoes`; faltava trazê-lo.
  const realocacoes = await api
    .get('/api/realocacoes', { query: { pedido_id_origem: pedidoId } })
    .catch(() => []);
  const substituicaoPorId = new Map(
    (Array.isArray(realocacoes) ? realocacoes : []).map(r => [String(r.id), r])
  );

  const itensPorId = new Map(listaItens.map(i => [String(i.id), i]));
  const numeroPorPedido = new Map();
  const saida = [];

  for (const dest of lista) {
    const item = itensPorId.get(String(dest.pedido_item_id)) || null;
    const rota = item ? await rotaDoProduto(item.produto_id) : [];

    const destinoId = dest.pedido_id_destino ?? null;
    if (destinoId !== null && !numeroPorPedido.has(String(destinoId))) {
      const pedidoDestino = await api.get(`/api/pedidos/${destinoId}`).catch(() => null);
      numeroPorPedido.set(String(destinoId), pedidoDestino?.numero || `#${destinoId}`);
    }

    const realocacao = dest.realocacao_id === null || dest.realocacao_id === undefined
      ? null
      : substituicaoPorId.get(String(dest.realocacao_id)) || null;

    saida.push({
      peca: item?.nome || item?.codigo || '—',
      tipo: dest.tipo_destino,
      rotulo: ROTULO_DA_DESTINACAO[dest.tipo_destino] || dest.tipo_destino,
      quantidade: Number(dest.quantidade) || 0,
      estagio_origem: rotuloDoPasso(rota, dest.ultimo_insumo_id),
      pedido_destino: destinoId === null ? null : numeroPorPedido.get(String(destinoId)),
      // Só a realocação substitui alguma coisa; nas outras destinações a peça
      // volta ao estoque e não ocupa lugar nenhum.
      substituiu: !realocacao
        ? null
        : (realocacao.tipo_destino_substituido === 'producao_zero'
          ? 'Produção do zero'
          : `${rotuloDoPasso(rota, realocacao.ultimo_insumo_id_substituido)}`
            + (realocacao.tipo_destino_substituido === 'pronta' ? ' (pronta)' : '')),
      falha: dest.falha || null,
      data: dest.created_at || null
    });
  }

  return saida;
}

module.exports = {
  rotuloDoPasso,
  alteracoesRecebidas,
  reconstruirSelecaoOriginal,
  destinacoesDoCancelamento,
  ROTULO_DA_DESTINACAO
};