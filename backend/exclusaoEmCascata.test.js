const test = require('node:test');
const assert = require('node:assert/strict');
const {
  excluirPedidoEmCascata,
  excluirOrcamentoEmCascata,
  DEPENDENTES_PEDIDO,
  PERMITIDAS
} = require('./exclusaoEmCascata');

/**
 * Exclusão em cascata: uma operação irreversível.
 *
 * Os testes aqui não conferem só "funcionou": conferem o que ela NÃO faz. Numa
 * rotina que apaga dados, o dano de um acerto a mais é muito maior que o de uma
 * falha — apagar um produto, um insumo ou um usuário por tabela a mais na lista
 * não teria volta.
 */

/** Banco de mentira, com o mesmo formato da API genérica. */
function montarApi(tabelas) {
  const apagados = [];
  const dados = JSON.parse(JSON.stringify(tabelas));

  return {
    apagados,
    dados,
    async get(rota, opcoes = {}) {
      const tabela = rota.replace('/api/', '');
      const query = opcoes?.query || {};
      const [campo, valor] = Object.entries(query)[0] || [];
      const lista = dados[tabela] || [];
      if (!campo) return lista;
      return lista.filter(l => String(l[campo]) === String(valor));
    },
    async delete(rota) {
      const [, , tabela, id] = rota.split('/');
      apagados.push({ tabela, id: String(id) });
      if (dados[tabela]) {
        dados[tabela] = dados[tabela].filter(l => String(l.id) !== String(id));
      }
      return { ok: true };
    }
  };
}

const BANCO = () => ({
  pedidos: [{ id: 60, numero: 'PED12' }],
  pedidos_itens: [{ id: 500, pedido_id: 60 }, { id: 501, pedido_id: 60 }],
  pedido_parcelas: [{ id: 600, pedido_id: 60 }],
  pedidos_itens_faltantes: [{ id: 700, pedido_id: 60 }],
  pedido_itens_ext: [{ id: 800, id_pedido: 60, pedido_item_id: 500 }],
  reservas_estoque: [{ id: 900, pedido_id: 60, pedido_item_id: 500 }],
  estoque_movimentos: [
    { id: 1000, pedido_id: 60, reserva_id: 900 },
    { id: 1001, pedido_id: 60, pedido_item_id: 500 },
    // De OUTRO pedido, mas transferido para este: também prende a chave.
    { id: 1002, pedido_id: 55, transfer_to_pedido_id: 60 }
  ],
  pedido_historico_eventos: [{ id: 1100, pedido_id: 60, movimento_id: 1000 }],
  notificacoes_estoque: [{ id: 1200, pedido_id: 60, movimento_id: 1000 }],
  realocacoes: [{ id: 1300, pedido_id_destino: 60, movimento_id_origem: 1000 }],
  ordens_producao: [{ id: 1400, pedido_id: 60 }],
  ordem_producao_itens: [{ id: 1500, ordem_producao_id: 1400 }],

  // O QUE NÃO PODE SER TOCADO — de propósito com colunas que se parecem com as
  // filtradas, para flagrar uma cascata descuidada.
  produtos: [{ id: 215, nome: 'Apaga Velas' }],
  produtos_em_cada_ponto: [{ id: 104, produto_id: 215, quantidade: 10 }],
  produtos_insumos: [{ id: 4680, produto_id: 215, insumo_id: 177 }],
  materia_prima: [{ id: 151, nome: 'Etiqueta' }],
  materia_prima_movimentacoes: [{ id: 254, insumo_id: 151, pedido_id: 60 }],
  usuarios: [{ id: 13, nome: 'Henrique' }],
  clientes: [{ id: 29, nome: 'Objeto Casa' }],

  orcamentos: [{ id: 40, numero: 'ORC7' }],
  orcamentos_itens: [{ id: 2000, orcamento_id: 40 }],
  orcamento_parcelas: [{ id: 2100, orcamento_id: 40 }]
});

test('o pedido e tudo que estava preso a ele saem', async () => {
  const api = montarApi(BANCO());
  const { removidos, avisos } = await excluirPedidoEmCascata(api, 60);

  assert.deepEqual(avisos, [], 'nenhuma falha esperada');
  assert.equal(api.dados.pedidos.length, 0, 'o pedido foi apagado');
  assert.equal(api.dados.pedidos_itens.length, 0);
  assert.equal(api.dados.estoque_movimentos.length, 0, 'inclusive o transferido de outro pedido');
  assert.equal(api.dados.ordem_producao_itens.length, 0);
  assert.equal(removidos.pedidos, 1);
});

test('NÃO apaga produtos, lotes, rotas, insumos, usuários nem clientes', async () => {
  const api = montarApi(BANCO());
  await excluirPedidoEmCascata(api, 60);

  const intocaveis = [
    'produtos', 'produtos_em_cada_ponto', 'produtos_insumos',
    'materia_prima', 'materia_prima_movimentacoes', 'usuarios', 'clientes'
  ];
  for (const tabela of intocaveis) {
    assert.ok(
      api.dados[tabela].length > 0,
      `${tabela} não pode ser tocada por uma exclusão de pedido`
    );
    assert.ok(
      !api.apagados.some(a => a.tabela === tabela),
      `nenhum DELETE pode sair para ${tabela}`
    );
  }
});

test('o histórico do INSUMO sobrevive ao pedido', async () => {
  const api = montarApi(BANCO());
  await excluirPedidoEmCascata(api, 60);

  // A linha tem `pedido_id: 60` e mesmo assim fica: ela é o histórico do insumo,
  // e o saldo dele mudou de verdade. Apagá-la deixaria o extrato do insumo sem
  // explicar para onde o material foi.
  assert.equal(api.dados.materia_prima_movimentacoes.length, 1);
});

test('a ordem respeita as chaves estrangeiras', async () => {
  const api = montarApi(BANCO());
  await excluirPedidoEmCascata(api, 60);

  const posicao = tabela => api.apagados.findIndex(a => a.tabela === tabela);

  // O evento aponta para o movimento; o movimento aponta para a reserva e para
  // o item. Fora desta ordem, o banco recusa.
  assert.ok(posicao('pedido_historico_eventos') < posicao('estoque_movimentos'));
  assert.ok(posicao('notificacoes_estoque') < posicao('estoque_movimentos'));
  assert.ok(posicao('realocacoes') < posicao('estoque_movimentos'));
  assert.ok(posicao('estoque_movimentos') < posicao('reservas_estoque'));
  assert.ok(posicao('estoque_movimentos') < posicao('pedidos_itens'));
  assert.ok(posicao('ordem_producao_itens') < posicao('ordens_producao'));
  assert.ok(posicao('pedido_itens_ext') < posicao('pedidos_itens'));
  assert.ok(posicao('reservas_estoque') < posicao('pedidos_itens'));
});

test('alcança a notificação que prende o movimento sem citar o pedido', async () => {
  const banco = BANCO();
  // Notificação de saldo negativo gerada por um movimento DESTE pedido, mas sem
  // `pedido_id`. Filtrando só pelo pedido, ela ficava para trás e o DELETE do
  // movimento batia na chave estrangeira.
  banco.notificacoes_estoque.push({ id: 1201, pedido_id: null, movimento_id: 1001 });
  banco.realocacoes.push({ id: 1301, pedido_id_destino: null, movimento_id_destino: 1000 });

  const api = montarApi(banco);
  await excluirPedidoEmCascata(api, 60);

  assert.equal(api.dados.notificacoes_estoque.length, 0, 'a órfã também sai');
  assert.equal(api.dados.realocacoes.length, 0);
  assert.equal(api.dados.estoque_movimentos.length, 0, 'e o movimento pôde ser apagado');
});

test('não apaga dados de OUTRO pedido', async () => {
  const banco = BANCO();
  banco.pedidos.push({ id: 61, numero: 'PED13' });
  banco.pedidos_itens.push({ id: 502, pedido_id: 61 });
  banco.estoque_movimentos.push({ id: 1003, pedido_id: 61 });

  const api = montarApi(banco);
  await excluirPedidoEmCascata(api, 60);

  assert.equal(api.dados.pedidos.length, 1, 'o outro pedido continua');
  assert.ok(api.dados.pedidos_itens.some(i => i.id === 502));
  assert.ok(api.dados.estoque_movimentos.some(m => m.id === 1003));
});

test('a lista branca é a última tranca: tabela fora dela não é apagada', async () => {
  const api = montarApi(BANCO());
  // Simula um erro de programação futuro: alguém acrescenta uma dependente sem
  // pôr a tabela na lista branca.
  DEPENDENTES_PEDIDO.push({ tabela: 'produtos', campo: 'id' });
  try {
    const { avisos } = await excluirPedidoEmCascata(api, 60);
    assert.equal(api.dados.produtos.length, 1, 'produtos continua intacto');
    assert.ok(
      avisos.some(a => /produtos/.test(a) && /não é apagável/.test(a)),
      'e a tentativa é denunciada em vez de passar em silêncio'
    );
  } finally {
    DEPENDENTES_PEDIDO.pop();
  }
  assert.ok(!PERMITIDAS.has('produtos'), 'produtos nunca entra na lista branca');
});

test('orçamento sai com itens e parcelas, e nada além', async () => {
  const api = montarApi(BANCO());
  const { removidos } = await excluirOrcamentoEmCascata(api, 40);

  assert.equal(api.dados.orcamentos.length, 0);
  assert.equal(api.dados.orcamentos_itens.length, 0);
  assert.equal(api.dados.orcamento_parcelas.length, 0);
  assert.equal(removidos.orcamentos, 1);

  assert.equal(api.dados.produtos.length, 1, 'produto do orçamento não é tocado');
  assert.equal(api.dados.pedidos.length, 1, 'o pedido gerado a partir dele também não');
});
