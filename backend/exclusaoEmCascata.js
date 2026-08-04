/**
 * Exclusão de um pedido ou orçamento com os dados presos a ele.
 *
 * POR QUE EXISTE
 * --------------
 * Um pedido convertido espalha linhas por oito tabelas, todas com chave
 * estrangeira apontando de volta. O `DELETE` direto batia em
 * `estoque_movimentos_pedido_id_fkey` e o pedido ficava impossível de excluir.
 *
 * O QUE ELA NUNCA TOCA
 * --------------------
 * A regra é uma LISTA BRANCA, não uma lista negra: só as tabelas nomeadas em
 * `DEPENDENTES_*` podem ser apagadas. Qualquer tabela fora dela — produtos,
 * lotes de estoque, rotas de produto, matéria-prima e seu histórico, usuários,
 * clientes, etapas, unidades, permissões — está fora de alcance por construção,
 * e continuará fora mesmo que alguém acrescente uma coluna `pedido_id` nela
 * amanhã. Numa operação destrutiva, "esqueci de proibir" não pode ser o padrão.
 *
 * A ORDEM IMPORTA
 * ---------------
 * As dependentes também dependem umas das outras: o histórico do pedido aponta
 * para o movimento de estoque, o movimento aponta para a reserva e para o item.
 * Apagar fora de ordem só troca uma violação de chave por outra. A ordem abaixo
 * é das folhas para a raiz e está anotada linha a linha.
 *
 * O QUE ELA NÃO FAZ
 * -----------------
 * NÃO devolve estoque. Excluir é apagar o registro, não desfazer o efeito —
 * peças e insumos já baixados continuam baixados. Desfazer o efeito é papel do
 * cancelamento com estorno, que é outra operação e tem outro nome de propósito.
 */

/**
 * Dependentes de um PEDIDO, na ordem em que devem ser apagadas.
 *
 * `campo` é a coluna que aponta para o pedido; quando é null, as linhas são
 * encontradas por outro caminho (ver `resolver`).
 */
const DEPENDENTES_PEDIDO = [
  // Realocação e notificação apontam para os MOVIMENTOS de estoque, e podem
  // fazer isso sem apontar para o pedido: uma notificação de saldo negativo
  // gerada por um movimento deste pedido pode ter `pedido_id` vazio e ainda
  // assim prender o movimento. Por isso as duas são resolvidas pelos dois
  // caminhos — pela coluna do pedido E pelos ids dos movimentos dele.
  { tabela: 'realocacoes', campo: 'pedido_id_destino', resolver: 'porMovimento',
    camposDeMovimento: ['movimento_id_origem', 'movimento_id_destino'] },
  { tabela: 'notificacoes_estoque', campo: 'pedido_id', resolver: 'porMovimento',
    camposDeMovimento: ['movimento_id'] },
  // Evento do pedido aponta para o movimento que o causou.
  { tabela: 'pedido_historico_eventos', campo: 'pedido_id' },
  // Movimento aponta para reserva, item do pedido e ordem de produção: sai
  // antes dos três.
  { tabela: 'estoque_movimentos', campo: 'pedido_id' },
  // Transferência entre pedidos: o movimento pode apontar para ESTE pedido como
  // destino sem pertencer a ele. Sem isto a chave continuaria presa.
  { tabela: 'estoque_movimentos', campo: 'transfer_to_pedido_id' },
  // Itens da ordem de produção antes da ordem.
  { tabela: 'ordem_producao_itens', campo: null, resolver: 'itensDeOrdemDeProducao' },
  { tabela: 'ordens_producao', campo: 'pedido_id' },
  { tabela: 'reservas_estoque', campo: 'pedido_id' },
  { tabela: 'pedido_itens_ext', campo: 'id_pedido' },
  { tabela: 'pedidos_itens_faltantes', campo: 'pedido_id' },
  { tabela: 'pedido_parcelas', campo: 'pedido_id' },
  // Por último entre as dependentes: quase todas apontam para ela.
  { tabela: 'pedidos_itens', campo: 'pedido_id' }
];

/** Dependentes de um ORÇAMENTO. */
const DEPENDENTES_ORCAMENTO = [
  { tabela: 'orcamento_parcelas', campo: 'orcamento_id' },
  { tabela: 'orcamentos_itens', campo: 'orcamento_id' }
];

/**
 * Tabelas que a cascata pode apagar. Redundante com as listas acima de
 * propósito: é a última tranca antes de um DELETE sair.
 */
const PERMITIDAS = new Set([
  ...DEPENDENTES_PEDIDO.map(d => d.tabela),
  ...DEPENDENTES_ORCAMENTO.map(d => d.tabela),
  'pedidos',
  'orcamentos'
]);

/**
 * `materia_prima_movimentacoes` também tem `pedido_id`, e fica FORA de
 * propósito: ela é o histórico do INSUMO, não do pedido. O saldo daquele insumo
 * mudou de verdade e o registro dessa mudança tem de sobreviver ao pedido —
 * apagá-lo deixaria o histórico do insumo sem explicar para onde o material foi.
 * A coluna não tem chave estrangeira, então nada impede a exclusão do pedido.
 */

async function apagarLinhas(api, tabela, linhas, resumo, avisos) {
  if (!PERMITIDAS.has(tabela)) {
    // Não deveria acontecer: é a tranca contra um erro de programação futuro.
    avisos.push(`Tabela "${tabela}" não é apagável em cascata; ignorada.`);
    return;
  }
  for (const linha of linhas) {
    if (linha?.id === undefined || linha?.id === null) continue;
    try {
      await api.delete(`/api/${tabela}/${linha.id}`);
      resumo[tabela] = (resumo[tabela] || 0) + 1;
    } catch (err) {
      avisos.push(`Falha ao apagar ${tabela} ${linha.id}: ${err?.message || err}`);
    }
  }
}

async function buscar(api, tabela, campo, valor) {
  const linhas = await api
    .get(`/api/${tabela}`, { query: { [campo]: valor } })
    .catch(() => []);
  // O filtro é conferido aqui também: se a API ignorar um parâmetro que não
  // reconhece, ela devolve a TABELA INTEIRA — e a cascata apagaria tudo.
  return (Array.isArray(linhas) ? linhas : [])
    .filter(l => String(l?.[campo]) === String(valor));
}

/**
 * Apaga um pedido e tudo que estava preso a ele.
 *
 * @returns {{ removidos: object, avisos: string[] }}
 */
async function excluirPedidoEmCascata(api, pedidoId) {
  const resumo = {};
  const avisos = [];

  // Ordens de produção do pedido, para alcançar os itens delas antes.
  const ordens = await buscar(api, 'ordens_producao', 'pedido_id', pedidoId);

  // Ids dos movimentos deste pedido — incluindo os que só o têm como destino de
  // transferência. É por eles que se acham as notificações e realocações que
  // prendem os movimentos sem citar o pedido.
  const movimentos = [
    ...await buscar(api, 'estoque_movimentos', 'pedido_id', pedidoId),
    ...await buscar(api, 'estoque_movimentos', 'transfer_to_pedido_id', pedidoId)
  ];
  const idsDeMovimento = new Set(movimentos.map(m => String(m.id)));

  for (const dependente of DEPENDENTES_PEDIDO) {
    let linhas = [];

    if (dependente.resolver === 'itensDeOrdemDeProducao') {
      for (const ordem of ordens) {
        const itens = await buscar(api, 'ordem_producao_itens', 'ordem_producao_id', ordem.id);
        linhas.push(...itens);
      }
    } else if (dependente.resolver === 'porMovimento') {
      // A tabela inteira e o filtro em memória: são tabelas pequenas, e uma
      // consulta por movimento seria uma requisição por linha.
      const todas = await api.get(`/api/${dependente.tabela}`).catch(() => []);
      linhas = (Array.isArray(todas) ? todas : []).filter(l =>
        String(l?.[dependente.campo]) === String(pedidoId)
        || dependente.camposDeMovimento.some(campo => idsDeMovimento.has(String(l?.[campo]))));
    } else {
      linhas = await buscar(api, dependente.tabela, dependente.campo, pedidoId);
    }

    await apagarLinhas(api, dependente.tabela, linhas, resumo, avisos);
  }

  await api.delete(`/api/pedidos/${pedidoId}`);
  resumo.pedidos = 1;

  return { removidos: resumo, avisos };
}

/** Apaga um orçamento e seus itens e parcelas. */
async function excluirOrcamentoEmCascata(api, orcamentoId) {
  const resumo = {};
  const avisos = [];

  for (const dependente of DEPENDENTES_ORCAMENTO) {
    const linhas = await buscar(api, dependente.tabela, dependente.campo, orcamentoId);
    await apagarLinhas(api, dependente.tabela, linhas, resumo, avisos);
  }

  await api.delete(`/api/orcamentos/${orcamentoId}`);
  resumo.orcamentos = 1;

  return { removidos: resumo, avisos };
}

module.exports = {
  excluirPedidoEmCascata,
  excluirOrcamentoEmCascata,
  DEPENDENTES_PEDIDO,
  DEPENDENTES_ORCAMENTO,
  PERMITIDAS
};
