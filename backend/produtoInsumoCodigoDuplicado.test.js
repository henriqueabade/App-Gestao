/**
 * Salvar a ficha de uma peça quando o banco já tem o insumo sob aquele código.
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO
 *
 * `produtos_insumos` tem `UNIQUE (produto_codigo, insumo_id)`. A tela, porém,
 * carrega os insumos da peça por `produto_id` (`carregarInsumosBase`). São duas
 * colunas independentes da mesma linha, e elas podem discordar: a FK
 * `produto_codigo -> produtos.codigo` é `ON UPDATE CASCADE`, então trocar o
 * código de uma peça move as linhas pelo CÓDIGO, sem olhar para `produto_id`.
 *
 * Quando discordam, existe linha que a tela não mostra e que mesmo assim
 * impede o INSERT. O sintoma era o pior possível: a pessoa revisava a ficha
 * inteira, mandava salvar, e recebia o erro cru de chave duplicada do Postgres
 * — sem nada que dissesse o que fazer, e sem nada gravado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Carregado DENTRO de `montar`, depois de apontar `API_BASE_URL` para o duplo:
// `db.js` congela a URL na hora do `require`, e um require no topo deixaria o
// cliente apontando para a API de verdade.
const MODULOS = ['./produtos', './db'];

// ---------------------------------------------------------------------------
// Duplo do upstream: `produtos` e `produtos_insumos` em memória, com a mesma
// restrição de unicidade que o banco tem.
// ---------------------------------------------------------------------------

function criarUpstream({ produtos = [], insumos = [] } = {}) {
  const tabelas = {
    produtos: produtos.map(p => ({ ...p })),
    produtos_insumos: insumos.map(i => ({ ...i })),
    lotes_producao: [],
    tabela_fixa: []
  };
  let proximoId = 1000;
  const chamadas = [];

  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const partes = url.pathname.replace(/^\/api\//, '').split('/');
      const tabela = partes[0];
      const id = partes[1] ? Number(partes[1]) : null;
      const body = corpo ? JSON.parse(corpo) : null;
      chamadas.push({ metodo: req.method, tabela, id, body });

      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      const linhas = tabelas[tabela] || [];

      if (req.method === 'GET') {
        let saida = linhas;
        for (const [campo, valor] of url.searchParams) {
          if (campo === 'select' || campo === 'limit') continue;
          saida = saida.filter(l => String(l[campo]) === String(valor));
        }
        return responder(200, saida);
      }

      if (req.method === 'POST') {
        // A MESMA restrição do banco. Sem ela o teste não mede nada: o insert
        // duplicado passaria em silêncio e só quebraria em produção.
        if (tabela === 'produtos_insumos') {
          const colide = linhas.some(l =>
            String(l.produto_codigo) === String(body.produto_codigo) &&
            Number(l.insumo_id) === Number(body.insumo_id));
          if (colide) {
            return responder(500, {
              error: 'Erro no INSERT',
              detalhe: 'duplicate key value violates unique constraint '
                + '"produtos_insumos_produto_codigo_insumo_id_key"'
            });
          }
        }
        const nova = { id: proximoId++, ...body };
        linhas.push(nova);
        return responder(201, nova);
      }

      if (req.method === 'PUT' || req.method === 'PATCH') {
        const i = linhas.findIndex(l => Number(l.id) === id);
        if (i < 0) return responder(404, { error: 'Not found' });
        linhas[i] = { ...linhas[i], ...body };
        return responder(200, linhas[i]);
      }

      if (req.method === 'DELETE') {
        const i = linhas.findIndex(l => Number(l.id) === id);
        if (i >= 0) linhas.splice(i, 1);
        return responder(200, { sucesso: true });
      }

      return responder(404, { error: 'Not found' });
    });
  });

  return { servidor, tabelas, chamadas };
}

async function montar(dados) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  const anterior = process.env.API_BASE_URL;
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;

  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  // Sem token, `db.js` recusa antes de sair da máquina. Um qualquer serve: o
  // duplo não confere credencial, e o que este teste mede é o que chega à
  // tabela.
  require('./db').init('token-de-teste');
  const produtos = require('./produtos');

  return {
    produtos,
    tabelas: upstream.tabelas,
    chamadas: upstream.chamadas,
    async encerrar() {
      process.env.API_BASE_URL = anterior;
      await new Promise(r => upstream.servidor.close(r));
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

const PRODUTO = { id: 7, codigo: 'VASO-01', nome: 'Vaso Cônico', preco_venda: 0 };

/** Os quatro argumentos posicionais de `salvarProdutoDetalhado`. */
const ficha = extra => ([
  'VASO-01',
  {
    pct_fabricacao: 0, pct_acabamento: 0, pct_montagem: 0, pct_embalagem: 0,
    pct_markup: 0, pct_comissao: 0, pct_imposto: 0,
    preco_base: 0, preco_venda: 0
  },
  { produto_id: 7, inseridos: [], atualizados: [], deletados: [], ...extra },
  7
]);

// ---------------------------------------------------------------------------

test('a linha invisível para a tela não derruba mais o salvamento', async () => {
  const ctx = await montar({
    produtos: [PRODUTO],
    insumos: [
      // Existe sob o CÓDIGO, mas com outro `produto_id`: a tela, que filtra por
      // `produto_id`, não a mostra — e mandava inserir de novo.
      { id: 500, produto_codigo: 'VASO-01', produto_id: 99, insumo_id: 42, quantidade: 5, ordem_insumo: 1 }
    ]
  });

  try {
    await ctx.produtos.salvarProdutoDetalhado(...ficha({
      inseridos: [{ insumo_id: 42, quantidade: 3, ordem_insumo: 1 }]
    }));

    const linhas = ctx.tabelas.produtos_insumos;
    assert.equal(linhas.length, 1, 'nenhuma segunda linha: o banco não a aceita');
    assert.equal(Number(linhas[0].quantidade), 3,
      'a linha que já existia é ATUALIZADA com o que o formulário mandou');
    assert.equal(Number(linhas[0].produto_id), 7,
      'e o produto_id é realinhado de passagem, desfazendo a divergência');
  } finally {
    await ctx.encerrar();
  }
});

test('insumo realmente novo continua sendo inserido', async () => {
  const ctx = await montar({
    produtos: [PRODUTO],
    insumos: [{ id: 500, produto_codigo: 'VASO-01', produto_id: 7, insumo_id: 42, quantidade: 5, ordem_insumo: 1 }]
  });

  try {
    await ctx.produtos.salvarProdutoDetalhado(...ficha({
      inseridos: [{ insumo_id: 77, quantidade: 2, ordem_insumo: 2 }]
    }));

    const linhas = ctx.tabelas.produtos_insumos;
    assert.equal(linhas.length, 2, '"não duplicar" não pode virar "nunca inserir"');
    assert.equal(Number(linhas[1].insumo_id), 77);
    assert.equal(String(linhas[1].produto_codigo), 'VASO-01');
  } finally {
    await ctx.encerrar();
  }
});

test('a consulta é pela chave da restrição, não por produto_id', async () => {
  const ctx = await montar({
    produtos: [PRODUTO],
    insumos: [{ id: 500, produto_codigo: 'VASO-01', produto_id: 99, insumo_id: 42, quantidade: 5 }]
  });

  try {
    await ctx.produtos.salvarProdutoDetalhado(...ficha({
      inseridos: [{ insumo_id: 42, quantidade: 3, ordem_insumo: 1 }]
    }));

    // Perguntar por `produto_id` devolveria vazio justamente no caso que
    // quebra — é a pergunta errada para esta restrição.
    const consulta = ctx.chamadas.find(c =>
      c.metodo === 'GET' && c.tabela === 'produtos_insumos');
    assert.ok(consulta, 'o salvamento precisa perguntar o que já existe');
  } finally {
    await ctx.encerrar();
  }
});

test('a linha apagada neste mesmo salvamento não conta como existente', async () => {
  const ctx = await montar({
    produtos: [PRODUTO],
    insumos: [{ id: 500, produto_codigo: 'VASO-01', produto_id: 7, insumo_id: 42, quantidade: 5, ordem_insumo: 1 }]
  });

  try {
    // Tirar o insumo e pôr de volta na mesma revisão é o gesto de quem
    // reposicionou a linha. A consulta acontece DEPOIS dos deletados: feita
    // antes, ela veria a linha já apagada e faria um PUT num id que não existe
    // mais.
    await ctx.produtos.salvarProdutoDetalhado(...ficha({
      deletados: [{ id: 500 }],
      inseridos: [{ insumo_id: 42, quantidade: 9, ordem_insumo: 1 }]
    }));

    const linhas = ctx.tabelas.produtos_insumos;
    assert.equal(linhas.length, 1);
    assert.equal(Number(linhas[0].quantidade), 9);
    assert.notEqual(Number(linhas[0].id), 500, 'é uma linha nova, não a antiga');
  } finally {
    await ctx.encerrar();
  }
});

test('sem nada a inserir, o salvamento não pergunta à toa', async () => {
  const ctx = await montar({
    produtos: [PRODUTO],
    insumos: [{ id: 500, produto_codigo: 'VASO-01', produto_id: 7, insumo_id: 42, quantidade: 5 }]
  });

  try {
    await ctx.produtos.salvarProdutoDetalhado(...ficha({
      atualizados: [{ id: 500, quantidade: 8, ordem_insumo: 1 }]
    }));

    const consultas = ctx.chamadas.filter(c =>
      c.metodo === 'GET' && c.tabela === 'produtos_insumos');
    assert.equal(consultas.length, 0,
      'uma ida ao servidor para saber o que já existe só se paga quando há '
      + 'algo a inserir');
    assert.equal(Number(ctx.tabelas.produtos_insumos[0].quantidade), 8);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// A OUTRA METADE: a tela precisa MOSTRAR o que a restrição governa
//
// Salvar sem quebrar já é melhor do que quebrar, mas a ficha continuava
// abrindo sem um insumo que é dela. Quem revisava o incluía achando que
// faltava, e a quantidade que aparecia na tela não era a que estava gravada.
// ---------------------------------------------------------------------------

test('a ficha mostra o insumo ligado pelo CÓDIGO, não só pelo id', async () => {
  const ctx = await montar({
    produtos: [PRODUTO],
    insumos: [
      { id: 500, produto_codigo: 'VASO-01', produto_id: 7, insumo_id: 42, quantidade: 5, ordem_insumo: 1 },
      // Mesma peça, ligada só pelo código — é o que a troca de código deixa
      // para trás, e era invisível na ficha.
      { id: 501, produto_codigo: 'VASO-01', produto_id: 99, insumo_id: 77, quantidade: 2, ordem_insumo: 2 }
    ]
  });

  try {
    const { itens } = await ctx.produtos.listarDetalhesProduto(7);
    assert.deepEqual(
      Array.from(itens, i => Number(i.insumo_id)).sort((a, b) => a - b),
      [42, 77],
      'o insumo ligado pelo código ficava de fora da ficha');
  } finally {
    await ctx.encerrar();
  }
});

test('a linha não vem duas vezes quando as duas chaves apontam para ela', async () => {
  const ctx = await montar({
    produtos: [PRODUTO],
    insumos: [
      { id: 500, produto_codigo: 'VASO-01', produto_id: 7, insumo_id: 42, quantidade: 5, ordem_insumo: 1 }
    ]
  });

  try {
    const { itens } = await ctx.produtos.listarDetalhesProduto(7);

    // As duas buscas devolvem a MESMA linha. Unidas sem cuidado, o insumo
    // apareceria em dobro na ficha — e a quantidade em dobro no custo.
    assert.equal(itens.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('peça sem código continua sendo carregada pelo id', async () => {
  const ctx = await montar({
    produtos: [{ id: 7, codigo: '', nome: 'Vaso sem código' }],
    insumos: [{ id: 500, produto_id: 7, insumo_id: 42, quantidade: 5, ordem_insumo: 1 }]
  });

  try {
    const { itens } = await ctx.produtos.listarDetalhesProduto(7);

    // Buscar SÓ pelo código perderia linha antiga que nunca teve o campo
    // preenchido — a ficha abriria vazia.
    assert.equal(itens.length, 1);
    assert.equal(Number(itens[0].insumo_id), 42);
  } finally {
    await ctx.encerrar();
  }
});
