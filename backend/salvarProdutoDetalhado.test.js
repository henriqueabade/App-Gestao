/**
 * Salvamento da ficha de uma peça (`salvarProdutoDetalhado`).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO FOI REESCRITO
 *
 * A versão anterior montava um Postgres em memória (`pg-mem`), criava as
 * tabelas em SQL e chamava a função com a assinatura antiga —
 * `salvarProdutoDetalhado('P001', {...}, {...})`, um CÓDIGO no primeiro
 * argumento e nenhum `produto_id`.
 *
 * Nada disso corresponde ao código de hoje: `produtos.js` fala HTTP com a
 * Santissimo-db-API (`pool.get/post/put/delete`), não SQL, e exige
 * `produto_id`. As quatro provas morriam em "produto_id é obrigatório" antes de
 * exercitar uma linha sequer da função.
 *
 * O efeito prático era que a função que grava a ficha inteira de uma peça —
 * inclusive as três listas de insumos e a tabela fixa — estava SEM COBERTURA
 * NENHUMA. Foi assim que uma linha nova pôde ser enviada em `atualizados`
 * carregando o id do insumo, e o salvamento levar 404 sem nenhum teste piscar.
 *
 * O duplo abaixo é o mesmo de `tabelaFixa.test.js`: um fake de `backend/db.js`
 * com get/post/put/delete sobre caminhos de tabela, guardando o que recebeu —
 * porque aqui o que NÃO foi escrito importa tanto quanto o que foi.
 * ---------------------------------------------------------------------------
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const CAMINHO_DB = require.resolve('./db');
const MODULOS = ['./produtos', './tabelaFixa', './catalogoCache', './estoqueLedger']
  .map(m => require.resolve(m));

/**
 * Fake do cliente HTTP no formato de `backend/db.js`.
 *
 * `tabela_fixa` é endereçada por `id_prod`, e não por `id` — é assim que
 * `tabelaFixa.js` monta o caminho do PUT.
 */
function montarPool(tabelas = {}) {
  const dados = {
    produtos: [],
    produtos_insumos: [],
    produtos_em_cada_ponto: [],
    tabela_fixa: [],
    orcamentos: [],
    orcamentos_itens: [],
    materia_prima: [],
    ...tabelas
  };
  const chamadas = { get: [], post: [], put: [], delete: [] };
  let proximoId = 1000;

  const nomeDaTabela = caminho => String(caminho).replace(/^\//, '').split('/')[0];
  const idDoCaminho = caminho => String(caminho).replace(/^\//, '').split('/')[1];
  const chaveDa = tabela => (tabela === 'tabela_fixa' ? 'id_prod' : 'id');

  function filtrar(lista, query = {}) {
    const filtros = Object.entries(query)
      .filter(([k]) => !['select', 'limit', 'order'].includes(k));
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
      chamadas.get.push({ caminho, query: opcoes.query || {} });
      const tabela = nomeDaTabela(caminho);
      const id = idDoCaminho(caminho);
      const lista = dados[tabela] || [];
      if (id) return lista.filter(l => String(l[chaveDa(tabela)]) === String(id));
      return filtrar(lista, opcoes.query || {});
    },
    async post(caminho, payload) {
      chamadas.post.push({ caminho, payload });
      const tabela = nomeDaTabela(caminho);
      dados[tabela] = dados[tabela] || [];
      const linha = { id: payload?.id ?? ++proximoId, ...payload };
      dados[tabela].push(linha);
      return linha;
    },
    async put(caminho, payload) {
      chamadas.put.push({ caminho, payload });
      const tabela = nomeDaTabela(caminho);
      const id = idDoCaminho(caminho);
      const alvo = (dados[tabela] || []).find(l => String(l[chaveDa(tabela)]) === String(id));
      // A API responde 404 quando o id não existe — é exatamente o erro que
      // aparecia ao mandar uma linha nova em `atualizados`.
      if (!alvo) {
        const err = new Error(`Erro na requisição PUT ${caminho}: 404 — Registro não encontrado`);
        err.status = 404;
        err.body = { error: 'Registro não encontrado' };
        throw err;
      }
      Object.assign(alvo, payload);
      return alvo;
    },
    async delete(caminho) {
      chamadas.delete.push({ caminho });
      const tabela = nomeDaTabela(caminho);
      const id = idDoCaminho(caminho);
      dados[tabela] = (dados[tabela] || []).filter(l => String(l[chaveDa(tabela)]) !== String(id));
      return true;
    }
  };
}

function carregar(pool) {
  require.cache[CAMINHO_DB] = {
    id: CAMINHO_DB, filename: CAMINHO_DB, loaded: true, exports: pool
  };
  for (const m of MODULOS) delete require.cache[m];
  return require('./produtos');
}

test.afterEach(() => {
  delete require.cache[CAMINHO_DB];
  for (const m of MODULOS) delete require.cache[m];
});

/** Uma peça já cadastrada, com dois insumos na ficha. */
function baseComPeca(extra = {}) {
  return montarPool({
    produtos: [{ id: 7, codigo: 'P001', nome: 'Bandeja Vero', preco_venda: 100, ncm: '4419' }],
    produtos_insumos: [
      { id: 401, produto_id: 7, produto_codigo: 'P001', insumo_id: 5, quantidade: 2, ordem_insumo: 1 },
      { id: 402, produto_id: 7, produto_codigo: 'P001', insumo_id: 6, quantidade: 3, ordem_insumo: 2 }
    ],
    ...extra
  });
}

const PERCENTUAIS = {
  pct_fabricacao: 1, pct_acabamento: 1, pct_montagem: 1, pct_embalagem: 1,
  pct_markup: 1, pct_comissao: 1, pct_imposto: 1, preco_base: 10, preco_venda: 20
};

const insumosDe = pool => pool.dados.produtos_insumos.filter(l => Number(l.produto_id) === 7);

// ---------------------------------------------------------------------------
// As três listas
// ---------------------------------------------------------------------------

test('insumo acrescentado entra com o produto e o código da peça', async () => {
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, { ...PERCENTUAIS }, {
    produto_id: 7,
    inseridos: [{ insumo_id: 9, quantidade: 4, ordem_insumo: 3 }],
    atualizados: [],
    deletados: []
  });

  const novo = insumosDe(pool).find(l => Number(l.insumo_id) === 9);
  assert.ok(novo, 'o insumo acrescentado não entrou');
  assert.equal(Number(novo.quantidade), 4);
  // As duas colunas de vínculo: a tela lê por `produto_id`, a restrição única
  // é sobre `produto_codigo`. Uma sem a outra deixa a linha invisível ou
  // impede o próximo INSERT.
  assert.equal(Number(novo.produto_id), 7);
  assert.equal(novo.produto_codigo, 'P001');
});

test('a quantidade de um insumo existente é atualizada pelo id da LINHA', async () => {
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, { ...PERCENTUAIS }, {
    produto_id: 7,
    inseridos: [],
    atualizados: [{ id: 401, quantidade: 99, ordem_insumo: 1 }],
    deletados: []
  });

  assert.equal(Number(insumosDe(pool).find(l => l.id === 401).quantidade), 99);
});

test('insumo excluído sai da ficha', async () => {
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, { ...PERCENTUAIS }, {
    produto_id: 7, inseridos: [], atualizados: [], deletados: [{ id: 402 }]
  });

  assert.deepEqual(insumosDe(pool).map(l => l.id), [401]);
});

test('linha nova mandada como "atualizada" é o 404 que quebrou o salvamento', async () => {
  // Reprodução do defeito do modal: a linha acrescentada leva o id do INSUMO,
  // e mandá-la em `atualizados` faz o salvamento tentar
  // `PUT /produtos_insumos/<id do insumo>`. A guarda está do lado do modal
  // (ver produtoInsumoNovoNaoViraUpdate.test.js); aqui fica registrado o que
  // acontece quando ela falha, para ninguém "consertar" isto engolindo o erro.
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await assert.rejects(
    () => salvarProdutoDetalhado(null, { ...PERCENTUAIS }, {
      produto_id: 7, inseridos: [], atualizados: [{ id: 409, quantidade: 1, ordem_insumo: 1 }], deletados: []
    }),
    /404/
  );
});

test('o insumo que já existe sob este código é ATUALIZADO, não duplicado', async () => {
  // `produtos_insumos` tem UNIQUE (produto_codigo, insumo_id). Inserir por
  // cima devolvia o erro cru de chave duplicada do Postgres, com a ficha
  // inteira revisada e nada gravado.
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, { ...PERCENTUAIS }, {
    produto_id: 7,
    inseridos: [{ insumo_id: 5, quantidade: 50, ordem_insumo: 1 }],
    atualizados: [],
    deletados: []
  });

  const doInsumo5 = insumosDe(pool).filter(l => Number(l.insumo_id) === 5);
  assert.equal(doInsumo5.length, 1, 'a peça ficou com o mesmo insumo duas vezes');
  assert.equal(Number(doInsumo5[0].quantidade), 50);
});

test('linha apagada neste mesmo salvamento não conta como existente', async () => {
  // Apagar o insumo 5 e acrescentá-lo de novo é o gesto de quem quer refazer a
  // linha. Se a busca por "o que já existe" rodasse antes dos deletados, o
  // acréscimo viraria um UPDATE numa linha que estava indo embora.
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, { ...PERCENTUAIS }, {
    produto_id: 7,
    inseridos: [{ insumo_id: 5, quantidade: 7, ordem_insumo: 1 }],
    atualizados: [],
    deletados: [{ id: 401 }]
  });

  const doInsumo5 = insumosDe(pool).filter(l => Number(l.insumo_id) === 5);
  assert.equal(doInsumo5.length, 1);
  assert.equal(Number(doInsumo5[0].quantidade), 7);
});

// ---------------------------------------------------------------------------
// Troca de código
// ---------------------------------------------------------------------------

test('trocar o código leva junto as linhas de insumo', async () => {
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, { ...PERCENTUAIS, codigo: 'P002' }, {
    produto_id: 7, inseridos: [], atualizados: [], deletados: []
  });

  assert.equal(pool.dados.produtos.find(p => p.id === 7).codigo, 'P002');
  // `produto_codigo` é FK para `produtos.codigo`: deixá-la para trás quebra o
  // vínculo de toda a ficha.
  assert.deepEqual([...new Set(insumosDe(pool).map(l => l.produto_codigo))], ['P002']);
});

test('código repetido é recusado antes de gravar qualquer coisa', async () => {
  const pool = baseComPeca();
  pool.dados.produtos.push({ id: 8, codigo: 'P002', nome: 'Outra peça' });
  const { salvarProdutoDetalhado } = carregar(pool);

  await assert.rejects(
    () => salvarProdutoDetalhado(null, { ...PERCENTUAIS, codigo: 'P002' }, {
      produto_id: 7, inseridos: [], atualizados: [], deletados: []
    }),
    err => err.code === 'CODIGO_EXISTE'
  );

  assert.equal(pool.dados.produtos.find(p => p.id === 7).codigo, 'P001');
});

// ---------------------------------------------------------------------------
// Tabela fixa: o código acompanha sempre; o preço só por escolha
// ---------------------------------------------------------------------------

const linhaFixaDe7 = pool => pool.dados.tabela_fixa.find(l => Number(l.id_prod) === 7);

// Fábrica, e não constante: os testes MUTAM estas linhas, e um objeto só
// compartilharia o mesmo array entre todos — o preço gravado por um teste
// apareceria como estado inicial do seguinte.
const comPreco = () => ({ tabela_fixa: [{ id: 1, id_prod: 7, cod_prod: 'P001', vlr_prod: 850 }] });

test('trocar o código atualiza a tabela fixa MESMO sem "Atualizar Tabela Fixa"', async () => {
  const pool = baseComPeca(comPreco());
  const { salvarProdutoDetalhado } = carregar(pool);

  const r = await salvarProdutoDetalhado(null, {
    ...PERCENTUAIS, codigo: 'P002', nome: 'Bandeja Vero PP', atualizar_tabela_fixa: false
  }, { produto_id: 7, inseridos: [], atualizados: [], deletados: [] });

  const fixa = linhaFixaDe7(pool);
  // O código é a IDENTIDADE da peça, e ela mudou de fato. "Atualizar Tabela
  // Fixa" é uma decisão sobre PREÇO, não sobre identidade.
  assert.equal(fixa.cod_prod, 'P002');
  // E o preço praticado ficou exatamente onde estava.
  assert.equal(Number(fixa.vlr_prod), 850);
  assert.deepEqual(r.tabelaFixaCodigo, { produtoId: 7, de: 'P001', para: 'P002' });
  assert.equal(r.tabelaFixa, null, 'o preço não devia ter sido gravado');
});

test('com a opção marcada, código e preço vão juntos', async () => {
  const pool = baseComPeca(comPreco());
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, {
    ...PERCENTUAIS, codigo: 'P002', preco_venda: 999, atualizar_tabela_fixa: true
  }, { produto_id: 7, inseridos: [], atualizados: [], deletados: [] });

  const fixa = linhaFixaDe7(pool);
  assert.equal(fixa.cod_prod, 'P002');
  assert.equal(Number(fixa.vlr_prod), 999);
});

test('sem a opção marcada, o preço praticado não se move', async () => {
  const pool = baseComPeca(comPreco());
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, {
    ...PERCENTUAIS, preco_venda: 999, atualizar_tabela_fixa: false
  }, { produto_id: 7, inseridos: [], atualizados: [], deletados: [] });

  // Reprecificar sozinho o que já foi proposto ao cliente é o pior efeito
  // colateral que este módulo poderia ter.
  assert.equal(Number(linhaFixaDe7(pool).vlr_prod), 850);
});

test('peça sem linha na tabela fixa não ganha uma só por trocar de código', async () => {
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, { ...PERCENTUAIS, codigo: 'P002' }, {
    produto_id: 7, inseridos: [], atualizados: [], deletados: []
  });

  // Sem linha quer dizer SEM preço praticado, e o sistema inteiro conta com
  // isso. Criar uma aqui inventaria um preço de zero — que não é "sem preço",
  // é uma venda de graça que ninguém aprovou.
  assert.equal(pool.dados.tabela_fixa.length, 0);
});

test('código igual não gera escrita nenhuma na tabela fixa', async () => {
  const pool = baseComPeca(comPreco());
  const { salvarProdutoDetalhado } = carregar(pool);

  await salvarProdutoDetalhado(null, { ...PERCENTUAIS }, {
    produto_id: 7, inseridos: [], atualizados: [], deletados: []
  });

  assert.equal(pool.chamadas.put.some(c => c.caminho.startsWith('/tabela_fixa')), false);
});

// ---------------------------------------------------------------------------
// Contrato de entrada
// ---------------------------------------------------------------------------

test('sem produto_id o salvamento recusa em vez de adivinhar', async () => {
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await assert.rejects(
    () => salvarProdutoDetalhado(null, { ...PERCENTUAIS }, { inseridos: [] }),
    err => err.code === 'PRODUTO_ID_OBRIGATORIO'
  );
});

test('o produto_id pode vir no payload dos itens ou no argumento', async () => {
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  // É o modal que manda os dois — `itensPayload.produto_id` e o 4º argumento.
  await salvarProdutoDetalhado(null, { ...PERCENTUAIS, nome: 'Pelo argumento' },
    { inseridos: [], atualizados: [], deletados: [] }, 7);

  assert.equal(pool.dados.produtos.find(p => p.id === 7).nome, 'Pelo argumento');
});

test('peça que não existe não é criada por engano', async () => {
  const pool = baseComPeca();
  const { salvarProdutoDetalhado } = carregar(pool);

  await assert.rejects(
    () => salvarProdutoDetalhado(null, { ...PERCENTUAIS }, { produto_id: 999, inseridos: [] }),
    /não encontrado/i
  );
  assert.equal(pool.dados.produtos.length, 1);
});
