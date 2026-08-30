/**
 * Agrupamento de pedidos para relatório.
 *
 * O que estes testes protegem é a pergunta que a produção faz ao documento:
 * "quantas peças de cada modelo, e quantas já estão prontas?". Uma soma errada
 * aqui vira peça produzida a mais ou cliente esperando por peça que ninguém
 * fez — e o erro não aparece na tela, aparece na bancada.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  chaveDaPeca,
  agruparPecas,
  detalharPedidos,
  totaisDoAgrupamento,
  montarAgrupamento
} = require('./agrupamentoPedidos');

/** Dois pedidos que compartilham a peça AV01. */
function cenario() {
  return [
    {
      id: 1,
      numero: 'PED1',
      cliente_nome: 'Loja Central',
      situacao: 'Produção',
      itens: [
        {
          produto_id: 9, codigo: 'AV01', nome: 'Apaga Velas', quantidade: 2,
          qtd_usar_pronta: 1, qtd_a_produzir: 1,
          valor_unitario: 100, valor_unitario_desc: 100, valor_total: 200
        },
        {
          produto_id: 7, codigo: 'BD01', nome: 'Bandeja', quantidade: 1,
          qtd_usar_pronta: 0, qtd_a_produzir: 1,
          valor_unitario: 300, valor_unitario_desc: 300, valor_total: 300
        }
      ]
    },
    {
      id: 2,
      numero: 'PED2',
      cliente_nome: 'Decorações Silvia',
      situacao: 'Produção',
      itens: [
        {
          produto_id: 9, codigo: 'AV01', nome: 'Apaga Velas', quantidade: 3,
          qtd_usar_pronta: 0, qtd_a_produzir: 3,
          // Mesma peça, com desconto: 270 para 3 unidades.
          valor_unitario: 100, valor_unitario_desc: 90, valor_total: 270
        }
      ]
    }
  ];
}

// ------------------------------------------------------------ consolidado

test('a mesma peça em pedidos diferentes vira uma linha só', () => {
  const [av, bd] = agruparPecas(cenario());

  assert.strictEqual(av.codigo, 'AV01');
  assert.strictEqual(av.quantidade, 5, '2 + 3');
  assert.strictEqual(av.pronta, 1);
  assert.strictEqual(av.a_fazer, 4, '1 + 3');
  assert.strictEqual(av.em_pedidos, 2);

  assert.strictEqual(bd.codigo, 'BD01');
  assert.strictEqual(bd.quantidade, 1);
});

test('o unitário é a média do que foi cobrado, e fecha com o total', () => {
  const [av] = agruparPecas(cenario());

  // 470 em 5 unidades. Copiar o `valor_unitario` de um dos itens daria 100, e
  // 100 × 5 = 500 ≠ 470: a linha não fecharia com a soma dos pedidos.
  assert.strictEqual(av.valor_total, 470);
  assert.strictEqual(av.valor_unitario, 94);
  assert.strictEqual(av.valor_unitario * av.quantidade, av.valor_total);
});

test('agrupa por produto_id, não pelo nome gravado', () => {
  // O nome é copiado para o item na conversão; dois pedidos podem tê-lo
  // gravado com grafias diferentes. Agrupar por texto partiria a peça em duas.
  const pecas = agruparPecas([
    { id: 1, itens: [{ produto_id: 9, codigo: 'AV01', nome: 'Apaga Velas', quantidade: 2, qtd_a_produzir: 2 }] },
    { id: 2, itens: [{ produto_id: 9, codigo: 'AV01', nome: 'APAGA VELAS - 1', quantidade: 1, qtd_a_produzir: 1 }] }
  ]);

  assert.strictEqual(pecas.length, 1);
  assert.strictEqual(pecas[0].quantidade, 3);
});

test('item sem produto_id cai para o código, sem virar um balde só', () => {
  assert.strictEqual(chaveDaPeca({ produto_id: 9, codigo: 'AV01' }), 'id:9');
  assert.strictEqual(chaveDaPeca({ codigo: 'av01' }), 'cod:AV01');
  assert.strictEqual(chaveDaPeca({}), null, 'sem identidade nenhuma, o item é ignorado');

  const pecas = agruparPecas([
    { id: 1, itens: [
      { codigo: 'X1', nome: 'Peça X', quantidade: 1, qtd_a_produzir: 1 },
      { codigo: 'Y1', nome: 'Peça Y', quantidade: 2, qtd_a_produzir: 2 },
      { nome: 'Sem identidade', quantidade: 9, qtd_a_produzir: 9 }
    ] }
  ]);

  assert.strictEqual(pecas.length, 2, 'os dois com código; o terceiro fica de fora');
  assert.deepStrictEqual(pecas.map(p => p.codigo), ['X1', 'Y1']);
});

test('item sem decisão de estoque conta como "a fazer"', () => {
  // Itens anteriores à decisão de conversão vêm com as duas colunas zeradas.
  // Contar como pronta prometeria peça que ninguém confirmou ter.
  const [peca] = agruparPecas([
    { id: 1, itens: [{ produto_id: 5, codigo: 'Z1', nome: 'Antiga', quantidade: 4, qtd_usar_pronta: 0, qtd_a_produzir: 0 }] }
  ]);

  assert.strictEqual(peca.a_fazer, 4);
  assert.strictEqual(peca.pronta, 0);
});

test('o rótulo mais completo vence quando um pedido gravou sem código', () => {
  const [peca] = agruparPecas([
    { id: 1, itens: [{ produto_id: 9, codigo: '', nome: '', quantidade: 1, qtd_a_produzir: 1 }] },
    { id: 2, itens: [{ produto_id: 9, codigo: 'AV01', nome: 'Apaga Velas', quantidade: 1, qtd_a_produzir: 1 }] }
  ]);

  assert.strictEqual(peca.codigo, 'AV01', 'a linha não deve herdar a lacuna do primeiro');
  assert.strictEqual(peca.nome, 'Apaga Velas');
});

test('as linhas saem ordenadas por código', () => {
  const pecas = agruparPecas([
    { id: 1, itens: [
      { produto_id: 3, codigo: 'ZZ9', nome: 'Z', quantidade: 1, qtd_a_produzir: 1 },
      { produto_id: 2, codigo: 'AA1', nome: 'A', quantidade: 1, qtd_a_produzir: 1 },
      { produto_id: 1, codigo: 'MM5', nome: 'M', quantidade: 1, qtd_a_produzir: 1 }
    ] }
  ]);

  assert.deepStrictEqual(pecas.map(p => p.codigo), ['AA1', 'MM5', 'ZZ9']);
});

test('números em texto não quebram a soma', () => {
  // O upstream devolve numeric como string.
  const [peca] = agruparPecas([
    { id: 1, itens: [{ produto_id: 9, codigo: 'A', nome: 'A', quantidade: '2', qtd_usar_pronta: '1', qtd_a_produzir: '1', valor_total: '200.50' }] }
  ]);

  assert.strictEqual(peca.quantidade, 2);
  assert.strictEqual(peca.pronta, 1);
  assert.strictEqual(peca.valor_total, 200.5);
});

test('conjunto vazio não quebra', () => {
  assert.deepStrictEqual(agruparPecas([]), []);
  assert.deepStrictEqual(agruparPecas(null), []);
  assert.deepStrictEqual(agruparPecas([{ id: 1 }]), [], 'pedido sem itens');
});

// ----------------------------------------------------------- detalhamento

test('o detalhamento preserva os pedidos separados, sem consolidar', () => {
  const detalhe = detalharPedidos(cenario());

  assert.strictEqual(detalhe.length, 2);
  // O cliente é o cabeçalho da seção — é por ele que quem separa acha o
  // pedido na bancada.
  assert.strictEqual(detalhe[0].cliente, 'Loja Central');
  assert.strictEqual(detalhe[1].cliente, 'Decorações Silvia');
  assert.strictEqual(detalhe[0].itens.length, 2);
  assert.strictEqual(detalhe[1].itens.length, 1);
});

test('o detalhe usa o unitário com desconto, que é o que foi cobrado', () => {
  const [, segundo] = detalharPedidos(cenario());
  assert.strictEqual(segundo.itens[0].valor_unitario, 90, 'não os 100 cheios');
});

test('cliente ausente não vira "undefined" no cabeçalho', () => {
  const [semNome] = detalharPedidos([{ id: 1, numero: 'PED9', itens: [] }]);
  assert.strictEqual(semNome.cliente, '');
});

// ----------------------------------------------------------------- totais

test('os totais do rodapé somam o consolidado', () => {
  const { pecas, totais } = montarAgrupamento(cenario());

  assert.strictEqual(totais.linhas, 2);
  assert.strictEqual(totais.quantidade, 6, '5 apaga-velas + 1 bandeja');
  assert.strictEqual(totais.pronta, 1);
  assert.strictEqual(totais.a_fazer, 5);
  assert.strictEqual(totais.valor_total, 770);

  // Pronta + a fazer tem de fechar com a quantidade, senão a produção recebe
  // um documento que não soma.
  const soma = pecas.reduce((s, p) => s + p.pronta + p.a_fazer, 0);
  assert.strictEqual(soma, totais.quantidade);
});

test('montarAgrupamento devolve as duas visões do mesmo conjunto', () => {
  const doc = montarAgrupamento(cenario());

  assert.ok(Array.isArray(doc.pecas));
  assert.ok(Array.isArray(doc.pedidos));
  assert.ok(doc.totais);
  // Três itens espalhados em dois pedidos viram duas linhas consolidadas.
  assert.strictEqual(doc.pecas.length, 2);
  assert.strictEqual(doc.pedidos.length, 2);
});

// ------------------------------------------------------------------ rota

/**
 * A rota tem um risco próprio, invisível na lógica acima: `/agrupamento` é
 * registrada depois de outras rotas com parâmetro, e o Express casa na ordem.
 * Se ela cair depois de `/:id`, o Express a trata como um pedido de id
 * "agrupamento" e devolve 404 — sem erro nenhum no console.
 */
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const MODULOS_ROTA = ['./apiHttpClient', './permissionsController', './pedidosController'];

function upstreamFake(tabelas) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const partes = url.pathname.split('/').filter(Boolean);
    const tabela = partes[1];
    const id = partes[2];
    const responder = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (!dados[tabela]) return responder(404, { error: 'Not found' });
    if (id) {
      const achado = dados[tabela].find(r => String(r.id) === String(id));
      return achado ? responder(200, achado) : responder(404, { error: 'Not found' });
    }
    let linhas = dados[tabela];
    for (const [chave, valor] of url.searchParams.entries()) {
      if (['order', 'limit', 'select'].includes(chave)) continue;
      linhas = linhas.filter(r => String(r[chave]) === String(valor));
    }
    responder(200, linhas);
  });
  return servidor;
}

async function montarRota(tabelas, { permitir = true } = {}) {
  const servidor = upstreamFake(tabelas);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${servidor.address().port}`;

  for (const m of MODULOS_ROTA) delete require.cache[require.resolve(m)];
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: () => (req, res, next) =>
        permitir ? next() : res.status(403).json({ error: 'Sem permissão' }),
      exigirSupAdmin: (req, res, next) => next(),
      limparCachePermissoes: () => {}
    }
  };

  const app = express();
  app.use(express.json());
  app.use('/api/pedidos', require('./pedidosController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));

  return {
    porta: server.address().port,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS_ROTA) delete require.cache[require.resolve(m)];
    }
  };
}

const TABELAS = {
  pedidos: [
    { id: 1, numero: 'PED1', cliente_id: 50, situacao: 'Produção', valor_final: 500 },
    { id: 2, numero: 'PED2', cliente_id: 51, situacao: 'Entregue', valor_final: 270 }
  ],
  pedidos_itens: [
    { id: 10, pedido_id: 1, produto_id: 9, codigo: 'AV01', nome: 'Apaga Velas', quantidade: 2, qtd_usar_pronta: 1, qtd_a_produzir: 1, valor_unitario: 100, valor_total: 200 },
    { id: 11, pedido_id: 1, produto_id: 7, codigo: 'BD01', nome: 'Bandeja', quantidade: 1, qtd_usar_pronta: 0, qtd_a_produzir: 1, valor_unitario: 300, valor_total: 300 },
    { id: 12, pedido_id: 2, produto_id: 9, codigo: 'AV01', nome: 'Apaga Velas', quantidade: 3, qtd_usar_pronta: 0, qtd_a_produzir: 3, valor_unitario: 100, valor_total: 270 }
  ],
  clientes: [
    { id: 50, nome_fantasia: 'Loja Central' },
    { id: 51, nome_fantasia: 'Decorações Silvia' }
  ]
};

const buscar = (porta, query) =>
  fetch(`http://127.0.0.1:${porta}/api/pedidos/agrupamento?${query}`, {
    headers: { authorization: `Bearer ${tokenDe(1)}` }
  });

test('a rota /agrupamento não é engolida por /:id', async () => {
  const ctx = await montarRota(TABELAS);
  try {
    const resposta = await buscar(ctx.porta, 'ids=1,2');
    // 404 aqui significaria que o Express casou em /:id com id="agrupamento".
    assert.strictEqual(resposta.status, 200);

    const doc = await resposta.json();
    assert.strictEqual(doc.pecas.length, 2);
    assert.strictEqual(doc.pedidos.length, 2);
    assert.strictEqual(doc.totais.quantidade, 6);
    assert.strictEqual(doc.pedidos[0].cliente, 'Loja Central');
  } finally {
    await ctx.encerrar();
  }
});

test('a ordem do documento é a ordem que o usuário selecionou', async () => {
  const ctx = await montarRota(TABELAS);
  try {
    const doc = await (await buscar(ctx.porta, 'ids=2,1')).json();
    assert.deepStrictEqual(doc.pedidos.map(p => p.numero), ['PED2', 'PED1']);
  } finally {
    await ctx.encerrar();
  }
});

test('pedido inexistente sai do documento e é contado como ausente', async () => {
  const ctx = await montarRota(TABELAS);
  try {
    const doc = await (await buscar(ctx.porta, 'ids=1,999')).json();
    assert.strictEqual(doc.pedidos.length, 1);
    assert.strictEqual(doc.ausentes, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('sem ids a rota recusa antes de tocar no upstream', async () => {
  const ctx = await montarRota(TABELAS);
  try {
    assert.strictEqual((await buscar(ctx.porta, 'ids=')).status, 400);
    assert.strictEqual((await buscar(ctx.porta, '')).status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('seleção grande demais é recusada com motivo', async () => {
  const ctx = await montarRota(TABELAS);
  try {
    const ids = Array.from({ length: 61 }, (_, i) => i + 1).join(',');
    const resposta = await buscar(ctx.porta, `ids=${ids}`);
    assert.strictEqual(resposta.status, 422);
    assert.strictEqual((await resposta.json()).code, 'AGRUPAMENTO_EXCEDE_LIMITE');
  } finally {
    await ctx.encerrar();
  }
});

test('sem permissão de detalhe o agrupamento é barrado', async () => {
  const ctx = await montarRota(TABELAS, { permitir: false });
  try {
    assert.strictEqual((await buscar(ctx.porta, 'ids=1,2')).status, 403);
  } finally {
    await ctx.encerrar();
  }
});
