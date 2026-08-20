/**
 * Tabela fixa de preços.
 *
 * O que estes testes protegem é uma regra de negócio que não se vê no código
 * de uma linha só: a peça tem dois preços, e trocar um pelo outro no lugar
 * errado remarca silenciosamente propostas que já foram para o cliente.
 *
 * `preco_venda` sobe sozinho quando um insumo encarece. `vlr_prod` só muda
 * quando alguém decide. Orçamento em aberto acompanha o segundo; pedido não
 * acompanha nada — o preço dele foi combinado e está fechado.
 */
const test = require('node:test');
const assert = require('node:assert');

const CAMINHO_DB = require.resolve('./db');
const CAMINHO_MODULO = require.resolve('./tabelaFixa');

/**
 * Fake do cliente HTTP no formato que `backend/db.js` expõe (get/post/put/
 * delete sobre caminhos de tabela). Guarda o que recebeu para os testes
 * poderem afirmar o que NÃO foi escrito — que aqui importa tanto quanto o
 * que foi.
 */
function montarPool(tabelas = {}) {
  const dados = {
    tabela_fixa: [],
    orcamentos: [],
    orcamentos_itens: [],
    pedidos_itens: [],
    ...tabelas
  };
  const chamadas = { post: [], put: [], delete: [] };

  const nomeDaTabela = caminho => String(caminho).replace(/^\//, '').split('/')[0];
  const idDoCaminho = caminho => String(caminho).split('/')[2];

  function filtrar(lista, query = {}) {
    const filtros = Object.entries(query).filter(([k]) => !['select', 'limit', 'order'].includes(k));
    let saida = lista.filter(linha =>
      filtros.every(([campo, valor]) => String(linha?.[campo]) === String(valor))
    );
    if (query.limit) saida = saida.slice(0, Number(query.limit));
    return saida;
  }

  return {
    dados,
    chamadas,
    async get(caminho, opcoes = {}) {
      return filtrar(dados[nomeDaTabela(caminho)] || [], opcoes.query || {});
    },
    async post(caminho, payload) {
      chamadas.post.push({ caminho, payload });
      const tabela = nomeDaTabela(caminho);
      dados[tabela] = dados[tabela] || [];
      dados[tabela].push({ ...payload });
      return payload;
    },
    async put(caminho, payload) {
      chamadas.put.push({ caminho, payload });
      const tabela = nomeDaTabela(caminho);
      const id = idDoCaminho(caminho);
      const chave = tabela === 'tabela_fixa' ? 'id_prod' : 'id';
      const alvo = (dados[tabela] || []).find(linha => String(linha[chave]) === String(id));
      if (alvo) Object.assign(alvo, payload);
      return payload;
    },
    async delete(caminho) {
      chamadas.delete.push({ caminho });
      const tabela = nomeDaTabela(caminho);
      const id = idDoCaminho(caminho);
      const chave = tabela === 'tabela_fixa' ? 'id_prod' : 'id';
      dados[tabela] = (dados[tabela] || []).filter(linha => String(linha[chave]) !== String(id));
      return true;
    }
  };
}

function carregarModulo(pool) {
  require.cache[CAMINHO_DB] = {
    id: CAMINHO_DB,
    filename: CAMINHO_DB,
    loaded: true,
    exports: pool
  };
  delete require.cache[CAMINHO_MODULO];
  return require('./tabelaFixa');
}

function limpar() {
  delete require.cache[CAMINHO_DB];
  delete require.cache[CAMINHO_MODULO];
}

test.afterEach(limpar);

// ---------------------------------------------------------------- leitura

test('anexarPrecoTabela distingue "sem preço" de "preço zero"', async () => {
  const pool = montarPool({
    tabela_fixa: [
      { id_prod: 1, cod_prod: 'A', vlr_prod: '18.71' },
      { id_prod: 2, cod_prod: 'B', vlr_prod: '0' }
    ]
  });
  const { anexarPrecoTabela } = carregarModulo(pool);

  const [comPreco, zerado, semLinha] = await anexarPrecoTabela([
    { id: 1, nome: 'Apaga Velas' },
    { id: 2, nome: 'Brinde' },
    { id: 3, nome: 'Peça antiga' }
  ]);

  assert.strictEqual(comPreco.preco_tabela, 18.71);
  // Zero é um preço que alguém escolheu; ausência é cadastro que falta fazer.
  // A tela e o orçamento tratam os dois de forma diferente.
  assert.strictEqual(zerado.preco_tabela, 0);
  assert.strictEqual(semLinha.preco_tabela, null);
});

// ---------------------------------------------------------------- escrita

test('cadastro de peça nova cria a linha na tabela fixa', async () => {
  const pool = montarPool();
  const { registrarPrecoTabela, obterPrecoTabela } = carregarModulo(pool);

  await registrarPrecoTabela({ produtoId: 77, codigo: 'AVSO 0114 MUI', valor: 18.71 });

  const linha = await obterPrecoTabela(77);
  assert.strictEqual(linha.vlr_prod, 18.71);
  assert.strictEqual(linha.cod_prod, 'AVSO 0114 MUI');
});

test('registrar não sobrescreve preço já ajustado à mão', async () => {
  const pool = montarPool({
    tabela_fixa: [{ id_prod: 77, cod_prod: 'AVSO', vlr_prod: '250.00' }]
  });
  const { registrarPrecoTabela, obterPrecoTabela } = carregarModulo(pool);

  await registrarPrecoTabela({ produtoId: 77, codigo: 'AVSO', valor: 18.71 });

  const linha = await obterPrecoTabela(77);
  assert.strictEqual(String(linha.vlr_prod), '250.00', 'o preço praticado não pode ser rebaixado por um recadastro');
  assert.strictEqual(pool.chamadas.post.length, 0, 'não deveria ter inserido nada');
});

test('falha ao gravar a tabela fixa não derruba o cadastro do produto', async () => {
  const pool = montarPool();
  pool.post = async () => { throw new Error('upstream fora do ar'); };
  const { registrarPrecoTabela } = carregarModulo(pool);

  // O produto já foi criado quando esta chamada acontece. Propagar o erro aqui
  // faria a tela reportar falha num cadastro que, no banco, existe.
  const resultado = await registrarPrecoTabela({ produtoId: 77, codigo: 'X', valor: 10 });
  assert.strictEqual(resultado, null);
});

test('gravar cria a linha quando a peça é anterior à tabela fixa', async () => {
  const pool = montarPool();
  const { gravarPrecoTabela } = carregarModulo(pool);

  await gravarPrecoTabela({ produtoId: 5, codigo: 'ANTIGA', valor: 99.9 });

  assert.strictEqual(pool.chamadas.post.length, 1);
  assert.deepStrictEqual(pool.chamadas.post[0].payload, {
    id_prod: 5,
    cod_prod: 'ANTIGA',
    vlr_prod: 99.9
  });
});

test('gravar atualiza a linha existente pela PK id_prod', async () => {
  const pool = montarPool({
    tabela_fixa: [{ id_prod: 5, cod_prod: 'ANTIGA', vlr_prod: '10.00' }]
  });
  const { gravarPrecoTabela, obterPrecoTabela } = carregarModulo(pool);

  await gravarPrecoTabela({ produtoId: 5, codigo: 'ANTIGA', valor: 42 });

  assert.strictEqual(pool.chamadas.post.length, 0, 'não pode duplicar a linha');
  assert.strictEqual(pool.chamadas.put[0].caminho, '/tabela_fixa/5');
  assert.strictEqual((await obterPrecoTabela(5)).vlr_prod, 42);
});

test('gravar aceita valor em formato brasileiro', async () => {
  const pool = montarPool();
  const { gravarPrecoTabela } = carregarModulo(pool);

  const resultado = await gravarPrecoTabela({ produtoId: 5, codigo: 'X', valor: '1.234,56' });

  assert.strictEqual(resultado.valor, 1234.56);
});

test('gravar recusa valor que não é número', async () => {
  const pool = montarPool();
  const { gravarPrecoTabela } = carregarModulo(pool);

  await assert.rejects(
    () => gravarPrecoTabela({ produtoId: 5, codigo: 'X', valor: 'abc' }),
    err => err.code === 'TABELA_FIXA_VALOR_INVALIDO'
  );
  assert.strictEqual(pool.chamadas.post.length, 0);
});

// ------------------------------------------------------------ propagação

/** Orçamento + um item, no formato que o upstream devolve. */
function cenarioOrcamentos() {
  return montarPool({
    tabela_fixa: [{ id_prod: 9, cod_prod: 'PEC', vlr_prod: '100.00' }],
    orcamentos: [
      { id: 10, situacao: 'Rascunho' },
      { id: 20, situacao: 'Pendente' },
      { id: 30, situacao: 'Aprovado' },
      { id: 40, situacao: 'Rejeitado' },
      { id: 50, situacao: 'Expirado' }
    ],
    orcamentos_itens: [
      { id: 101, orcamento_id: 10, produto_id: 9, quantidade: 2, valor_unitario: 100, valor_total: 200 },
      { id: 102, orcamento_id: 20, produto_id: 9, quantidade: 1, valor_unitario: 100, valor_total: 100 },
      { id: 103, orcamento_id: 30, produto_id: 9, quantidade: 3, valor_unitario: 100, valor_total: 300 },
      { id: 104, orcamento_id: 40, produto_id: 9, quantidade: 1, valor_unitario: 100, valor_total: 100 },
      { id: 105, orcamento_id: 50, produto_id: 9, quantidade: 1, valor_unitario: 100, valor_total: 100 }
    ]
  });
}

test('novo preço alcança apenas orçamentos em Rascunho e Pendente', async () => {
  const pool = cenarioOrcamentos();
  const { gravarPrecoTabela } = carregarModulo(pool);

  const resultado = await gravarPrecoTabela({ produtoId: 9, codigo: 'PEC', valor: 150 });

  assert.strictEqual(resultado.orcamentosAtualizados, 2);

  const porId = new Map(pool.dados.orcamentos_itens.map(i => [i.id, i]));
  assert.strictEqual(porId.get(101).valor_unitario, 150, 'Rascunho acompanha');
  assert.strictEqual(porId.get(102).valor_unitario, 150, 'Pendente acompanha');

  // Estes três já foram para o cliente com um número. Remarcar depois é
  // exatamente o que a tabela fixa existe para impedir.
  assert.strictEqual(porId.get(103).valor_unitario, 100, 'Aprovado NÃO pode mudar');
  assert.strictEqual(porId.get(104).valor_unitario, 100, 'Rejeitado NÃO pode mudar');
  assert.strictEqual(porId.get(105).valor_unitario, 100, 'Expirado NÃO pode mudar');
});

test('pedido nunca é remarcado pela tabela fixa', async () => {
  const pool = cenarioOrcamentos();
  pool.dados.pedidos_itens = [
    { id: 900, pedido_id: 1, produto_id: 9, quantidade: 5, valor_unitario: 100 }
  ];
  const { gravarPrecoTabela } = carregarModulo(pool);

  await gravarPrecoTabela({ produtoId: 9, codigo: 'PEC', valor: 150 });

  assert.strictEqual(pool.dados.pedidos_itens[0].valor_unitario, 100);
  const tocouPedido = [...pool.chamadas.put, ...pool.chamadas.post, ...pool.chamadas.delete]
    .some(c => String(c.caminho).includes('pedidos'));
  assert.ok(!tocouPedido, 'nenhuma escrita pode chegar em pedidos');
});

test('o repasse recalcula o total mantendo os descontos da linha', async () => {
  const pool = montarPool({
    tabela_fixa: [{ id_prod: 9, cod_prod: 'PEC', vlr_prod: '100.00' }],
    orcamentos: [{ id: 10, situacao: 'Pendente' }],
    orcamentos_itens: [{
      id: 101,
      orcamento_id: 10,
      produto_id: 9,
      quantidade: 2,
      valor_unitario: 100,
      valor_total: 200,
      desconto_pagamento_prc: 5,
      desconto_especial_prc: 5
    }]
  });
  const { gravarPrecoTabela } = carregarModulo(pool);

  await gravarPrecoTabela({ produtoId: 9, codigo: 'PEC', valor: 200 });

  const item = pool.dados.orcamentos_itens[0];
  // 2 × 200 = 400 bruto; 5% + 5% = 40 de desconto; 360 líquido.
  assert.strictEqual(item.valor_total, 400);
  assert.strictEqual(item.desconto_total, 40);
  assert.strictEqual(item.valor_desc, 360);
  assert.strictEqual(item.valor_unitario_desc, 180);
  // Sem recalcular o valor EM REAIS, o percentual e o total ficariam
  // divergentes e a soma das linhas não fecharia com o total do orçamento.
  assert.strictEqual(item.desconto_pagamento, 20);
  assert.strictEqual(item.desconto_especial, 20);
});

test('peça sem item em orçamento nenhum não gera escrita extra', async () => {
  const pool = montarPool({ tabela_fixa: [{ id_prod: 9, cod_prod: 'PEC', vlr_prod: '10' }] });
  const { gravarPrecoTabela } = carregarModulo(pool);

  const resultado = await gravarPrecoTabela({ produtoId: 9, codigo: 'PEC', valor: 20 });

  assert.strictEqual(resultado.orcamentosAtualizados, 0);
  assert.strictEqual(pool.chamadas.put.length, 1, 'só a própria linha da tabela fixa');
});

test('exclusão da peça leva o preço praticado junto', async () => {
  const pool = montarPool({ tabela_fixa: [{ id_prod: 9, cod_prod: 'PEC', vlr_prod: '10' }] });
  const { removerPrecoTabela, obterPrecoTabela } = carregarModulo(pool);

  await removerPrecoTabela(9);

  // Preço órfão reapareceria colado no próximo produto a receber este id.
  assert.strictEqual(await obterPrecoTabela(9), null);
});

// ------------------------------------------- integração com salvarProduto

/**
 * O ponto que o usuário pediu explicitamente: "a edição do valor dos insumos
 * não deve alterar a tabela fixa". Salvar a peça recalcula `preco_venda`
 * sempre; a tabela fixa só se move com a caixa marcada.
 */
function carregarProdutos(pool) {
  require.cache[CAMINHO_DB] = {
    id: CAMINHO_DB, filename: CAMINHO_DB, loaded: true, exports: pool
  };
  for (const mod of ['./tabelaFixa', './produtos', './catalogoCache', './estoqueLedger']) {
    delete require.cache[require.resolve(mod)];
  }
  return require('./produtos');
}

function cenarioSalvar() {
  return montarPool({
    produtos: [{ id: 9, codigo: 'PEC', nome: 'Peça', preco_venda: 100 }],
    produtos_insumos: [],
    tabela_fixa: [{ id_prod: 9, cod_prod: 'PEC', vlr_prod: '100.00' }],
    orcamentos: [{ id: 10, situacao: 'Pendente' }],
    orcamentos_itens: [
      { id: 101, orcamento_id: 10, produto_id: 9, quantidade: 1, valor_unitario: 100, valor_total: 100 }
    ]
  });
}

test('salvar sem marcar a caixa NÃO mexe na tabela fixa nem no orçamento', async () => {
  const pool = cenarioSalvar();
  const { salvarProdutoDetalhado } = carregarProdutos(pool);

  // Um insumo encareceu: preco_venda sobe para 180. É custo, não preço de venda.
  await salvarProdutoDetalhado(null, { preco_venda: 180 }, { produto_id: 9 }, 9);

  assert.strictEqual(String(pool.dados.tabela_fixa[0].vlr_prod), '100.00',
    'o preço praticado não pode acompanhar o custo');
  assert.strictEqual(pool.dados.orcamentos_itens[0].valor_unitario, 100,
    'a proposta em aberto não pode ser remarcada por um reajuste de insumo');
});

test('salvar com a caixa marcada leva o novo preço à tabela e ao orçamento aberto', async () => {
  const pool = cenarioSalvar();
  const { salvarProdutoDetalhado } = carregarProdutos(pool);

  const resultado = await salvarProdutoDetalhado(
    null,
    { preco_venda: 180, atualizar_tabela_fixa: true },
    { produto_id: 9 },
    9
  );

  assert.strictEqual(pool.dados.tabela_fixa[0].vlr_prod, 180);
  assert.strictEqual(pool.dados.orcamentos_itens[0].valor_unitario, 180);
  assert.strictEqual(resultado.tabelaFixa.orcamentosAtualizados, 1);
});

test('a flag de decisão não vaza para a tabela produtos', async () => {
  const pool = cenarioSalvar();
  const { salvarProdutoDetalhado } = carregarProdutos(pool);

  await salvarProdutoDetalhado(
    null,
    { preco_venda: 180, atualizar_tabela_fixa: true },
    { produto_id: 9 },
    9
  );

  const escritaNoProduto = pool.chamadas.put.find(c => c.caminho === '/produtos/9');
  assert.ok(escritaNoProduto, 'o produto deveria ter sido atualizado');
  assert.strictEqual(escritaNoProduto.payload.atualizar_tabela_fixa, undefined,
    'é uma decisão de interface, não uma coluna do banco');
});

test('produto novo já nasce na tabela fixa e pode ser orçado', async () => {
  const pool = montarPool({ produtos: [], tabela_fixa: [] });
  // O upstream devolve a linha criada com o id atribuído.
  const postOriginal = pool.post.bind(pool);
  pool.post = async (caminho, payload) => {
    if (caminho === '/produtos') {
      pool.chamadas.post.push({ caminho, payload });
      const criado = { ...payload, id: 501 };
      pool.dados.produtos.push(criado);
      return criado;
    }
    return postOriginal(caminho, payload);
  };

  const { adicionarProduto } = carregarProdutos(pool);
  await adicionarProduto({
    codigo: 'NOVA 001',
    nome: 'Peça Nova',
    preco_venda: 250,
    pct_markup: 10,
    status: 'Em linha'
  });

  const linha = pool.dados.tabela_fixa.find(l => l.id_prod === 501);
  assert.ok(linha, 'sem linha na tabela fixa a peça nasceria invendável');
  assert.strictEqual(linha.vlr_prod, 250);
  assert.strictEqual(linha.cod_prod, 'NOVA 001');
});
