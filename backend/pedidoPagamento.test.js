/**
 * Repactuação da condição de pagamento de um pedido em produção.
 *
 * Dois riscos que estes testes existem para prender:
 *
 * 1. `pedidos_itens` NÃO pode ser apagado e recriado. Os ids dessas linhas são
 *    referenciados por movimentos de estoque, reservas e lotes — o PUT de
 *    orçamento pode recriar os dele porque nada aponta para eles, este aqui
 *    não pode. O teste confere que nenhum DELETE toca a tabela.
 *
 * 2. O desconto ESPECIAL sobrevive à troca de condição; o de PAGAMENTO é
 *    recalculado. Quem negociou 3% continua com eles depois de trocar "à
 *    vista" por "a prazo", perdendo só os 5% que existiam por ser à vista.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  pedidos: [
    'id', 'numero', 'situacao', 'cliente_id', 'data_emissao', 'parcelas', 'tipo_parcela',
    'forma_pagamento', 'prazo', 'desconto_pagamento', 'desconto_especial',
    'desconto_total', 'valor_final'
  ],
  pedidos_itens: [
    'id', 'pedido_id', 'produto_id', 'nome', 'quantidade', 'valor_unitario',
    'valor_unitario_desc', 'desconto_pagamento', 'desconto_pagamento_prc',
    'desconto_especial', 'desconto_especial_prc', 'valor_desc', 'desconto_total',
    'valor_total', 'qtd_a_produzir', 'qtd_usar_pronta'
  ],
  pedido_parcelas: ['id', 'pedido_id', 'numero_parcela', 'valor', 'data_vencimento']
};

function criarUpstream(dados) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const chamadas = [];

  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const partes = url.pathname.split('/').filter(Boolean);
      const tabela = partes[1];
      const id = partes[2];
      const body = corpo ? JSON.parse(corpo) : null;
      chamadas.push({ metodo: req.method, tabela, id, body });

      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (!tabelas[tabela]) return responder(404, { error: 'Tabela não encontrada' });
      const colunas = COLUNAS[tabela] || [];

      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Not found' });
      }
      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (!colunas.includes(chave)) continue;
          linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        if (url.searchParams.get('order') === 'id.desc') {
          linhas = [...linhas].sort((a, b) => Number(b.id) - Number(a.id));
        }
        const limite = Number(url.searchParams.get('limit'));
        if (Number.isFinite(limite) && limite > 0) linhas = linhas.slice(0, limite);
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const linha = {};
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        if (linha.id === undefined) {
          linha.id = Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1;
        }
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Not found' });
        for (const c of colunas) if (body?.[c] !== undefined) alvo[c] = body[c];
        return responder(200, alvo);
      }
      if (req.method === 'DELETE') {
        const idx = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (idx === -1) return responder(404, { error: 'Not found' });
        const [removido] = tabelas[tabela].splice(idx, 1);
        return responder(200, { sucesso: true, deletado: removido });
      }
      responder(405, { error: 'Método não suportado' });
    });
  });

  return { servidor, tabelas, chamadas };
}

const MODULOS = ['./apiHttpClient', './permissionsController', './pedidosController'];

async function montar(dados, { permitir = true } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;

  for (const m of MODULOS) delete require.cache[require.resolve(m)];

  // A guarda de permissão é substituída para que estes testes falem sobre a
  // regra de negócio. Um teste específico inverte `permitir` para provar que
  // a guarda continua no caminho.
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm,
    filename: caminhoPerm,
    loaded: true,
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
    tabelas: upstream.tabelas,
    chamadas: upstream.chamadas,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

function alterarPagamento(porta, id, body) {
  return fetch(`http://127.0.0.1:${porta}/api/pedidos/${id}/pagamento`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${tokenDe(1)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/**
 * Pedido a prazo com duas peças:
 *   item 10 — 2 un × R$ 100, 5% de pagamento (por ser >1 peça) + 3% especial
 *   item 11 — 1 un × R$ 200, sem desconto nenhum
 */
function cenario({ situacao = 'Produção' } = {}) {
  return {
    pedidos: [{
      id: 1, numero: 'PED-1', situacao, cliente_id: 50,
      data_emissao: '2026-01-10T00:00:00.000Z',
      parcelas: 2, tipo_parcela: 'igual', forma_pagamento: 'boleto', prazo: '30/60',
      desconto_pagamento: 10, desconto_especial: 6, desconto_total: 16, valor_final: 384
    }],
    pedidos_itens: [
      {
        id: 10, pedido_id: 1, produto_id: 900, nome: 'Peça A', quantidade: 2,
        valor_unitario: 100, valor_unitario_desc: 92,
        desconto_pagamento: 5, desconto_pagamento_prc: 5,
        desconto_especial: 3, desconto_especial_prc: 3,
        valor_desc: 8, desconto_total: 16, valor_total: 184,
        qtd_a_produzir: 2, qtd_usar_pronta: 0
      },
      {
        id: 11, pedido_id: 1, produto_id: 901, nome: 'Peça B', quantidade: 1,
        valor_unitario: 200, valor_unitario_desc: 200,
        desconto_pagamento: 0, desconto_pagamento_prc: 0,
        desconto_especial: 0, desconto_especial_prc: 0,
        valor_desc: 0, desconto_total: 0, valor_total: 200,
        qtd_a_produzir: 1, qtd_usar_pronta: 0
      }
    ],
    pedido_parcelas: [
      { id: 5, pedido_id: 1, numero_parcela: 1, valor: 192, data_vencimento: '2026-02-09' },
      { id: 6, pedido_id: 1, numero_parcela: 2, valor: 192, data_vencimento: '2026-03-11' }
    ]
  };
}

// ------------------------------------------------------------------ regra

test('trocar para à vista acrescenta 5% e preserva o desconto especial', async () => {
  const ctx = await montar(cenario());
  try {
    // À vista: item 10 → 5 (qtd>1) + 5 (à vista) = 10 de pagamento, 3 especial.
    //          item 11 → 0 (qtd 1) + 5 (à vista) = 5 de pagamento, 0 especial.
    // Subtotal 400. Descontos: 100×0,13×2 = 26  +  200×0,05×1 = 10  → 364.
    const resposta = await alterarPagamento(ctx.porta, 1, {
      condicao: 'vista',
      forma_pagamento: 'pix',
      prazo: '15',
      parcelas_detalhes: [{ valor: 364, data_vencimento: '2026-01-25', numero_parcela: 1 }]
    });
    assert.strictEqual(resposta.status, 200);

    const pedido = ctx.tabelas.pedidos[0];
    assert.strictEqual(pedido.valor_final, 364);
    assert.strictEqual(pedido.forma_pagamento, 'pix');
    assert.strictEqual(pedido.prazo, '15');
    assert.strictEqual(pedido.parcelas, 1);
    assert.strictEqual(pedido.tipo_parcela, 'a vista');

    const itemA = ctx.tabelas.pedidos_itens.find(i => i.id === 10);
    assert.strictEqual(itemA.desconto_pagamento_prc, 10, 'ganhou os 5% do à vista');
    assert.strictEqual(itemA.desconto_especial_prc, 3, 'o negociado não pode evaporar');
    assert.strictEqual(itemA.valor_unitario_desc, 87, '100 − 13%');
    assert.strictEqual(itemA.valor_total, 174, 'linha líquida: 87 × 2');

    const itemB = ctx.tabelas.pedidos_itens.find(i => i.id === 11);
    assert.strictEqual(itemB.desconto_pagamento_prc, 5);
    assert.strictEqual(itemB.valor_total, 190);
  } finally {
    await ctx.encerrar();
  }
});

test('voltar para a prazo remove só os 5% do à vista', async () => {
  const ctx = await montar(cenario());
  try {
    // O pedido já está a prazo; repactuar mantendo a prazo não pode alterar
    // desconto nenhum. Subtotal 400 − (100×0,08×2) = 384.
    const resposta = await alterarPagamento(ctx.porta, 1, {
      condicao: 'prazo',
      forma_pagamento: 'boleto',
      prazo: '30/60/90',
      tipo_parcela: 'igual',
      parcelas_detalhes: [
        { valor: 128, data_vencimento: '2026-02-09', numero_parcela: 1 },
        { valor: 128, data_vencimento: '2026-03-11', numero_parcela: 2 },
        { valor: 128, data_vencimento: '2026-04-10', numero_parcela: 3 }
      ]
    });
    assert.strictEqual(resposta.status, 200);

    const itemA = ctx.tabelas.pedidos_itens.find(i => i.id === 10);
    assert.strictEqual(itemA.desconto_pagamento_prc, 5, 'segue só o desconto por quantidade');
    assert.strictEqual(itemA.desconto_especial_prc, 3);
    assert.strictEqual(ctx.tabelas.pedidos[0].valor_final, 384);
    assert.strictEqual(ctx.tabelas.pedidos[0].parcelas, 3);
  } finally {
    await ctx.encerrar();
  }
});

// -------------------------------------------------------------- integridade

test('os itens do pedido são atualizados no lugar, nunca apagados', async () => {
  const ctx = await montar(cenario());
  try {
    await alterarPagamento(ctx.porta, 1, {
      condicao: 'vista',
      forma_pagamento: 'pix',
      prazo: '15',
      parcelas_detalhes: [{ valor: 364, data_vencimento: '2026-01-25', numero_parcela: 1 }]
    });

    // Recriar as linhas romperia as referências de estoque, reserva e lote.
    const apagouItem = ctx.chamadas.some(c => c.metodo === 'DELETE' && c.tabela === 'pedidos_itens');
    assert.ok(!apagouItem, 'nenhum item pode ser apagado');

    const ids = ctx.tabelas.pedidos_itens.map(i => i.id).sort();
    assert.deepStrictEqual(ids, [10, 11], 'os ids originais têm de continuar os mesmos');

    // E o que não é assunto do pagamento fica intacto.
    const itemA = ctx.tabelas.pedidos_itens.find(i => i.id === 10);
    assert.strictEqual(itemA.quantidade, 2);
    assert.strictEqual(itemA.valor_unitario, 100);
    assert.strictEqual(itemA.qtd_a_produzir, 2, 'a decisão de produção não se mexe aqui');
  } finally {
    await ctx.encerrar();
  }
});

test('as parcelas antigas são substituídas, sem sobrar linha', async () => {
  const ctx = await montar(cenario());
  try {
    await alterarPagamento(ctx.porta, 1, {
      condicao: 'vista',
      forma_pagamento: 'pix',
      prazo: '15',
      parcelas_detalhes: [{ valor: 364, data_vencimento: '2026-01-25', numero_parcela: 1 }]
    });

    // De 2x para à vista: sobrar a segunda parcela faria o financeiro cobrar
    // um valor que não existe mais.
    assert.strictEqual(ctx.tabelas.pedido_parcelas.length, 1);
    assert.strictEqual(ctx.tabelas.pedido_parcelas[0].valor, 364);
    assert.strictEqual(ctx.tabelas.pedido_parcelas[0].numero_parcela, 1);
    assert.strictEqual(ctx.tabelas.pedido_parcelas[0].pedido_id, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('recusa quando a soma das parcelas não fecha com o total', async () => {
  const ctx = await montar(cenario());
  try {
    const resposta = await alterarPagamento(ctx.porta, 1, {
      condicao: 'vista',
      forma_pagamento: 'pix',
      prazo: '15',
      // O total à vista é 364; gravar 384 deixaria o financeiro cobrando
      // uma diferença de ninguém.
      parcelas_detalhes: [{ valor: 384, data_vencimento: '2026-01-25', numero_parcela: 1 }]
    });
    assert.strictEqual(resposta.status, 422);
    assert.strictEqual((await resposta.json()).code, 'PARCELAS_NAO_FECHAM');

    assert.strictEqual(ctx.tabelas.pedidos[0].valor_final, 384, 'nada pode ter sido gravado');
    assert.strictEqual(ctx.tabelas.pedido_parcelas.length, 2);
  } finally {
    await ctx.encerrar();
  }
});

// ------------------------------------------------------------------ travas

for (const situacao of ['Enviado', 'Entregue', 'Cancelado', 'Rascunho']) {
  test(`pedido em "${situacao}" não pode ter o pagamento alterado`, async () => {
    const ctx = await montar(cenario({ situacao }));
    try {
      const resposta = await alterarPagamento(ctx.porta, 1, {
        condicao: 'vista',
        forma_pagamento: 'pix',
        prazo: '15',
        parcelas_detalhes: [{ valor: 364, data_vencimento: '2026-01-25', numero_parcela: 1 }]
      });
      assert.strictEqual(resposta.status, 409);
      assert.strictEqual((await resposta.json()).code, 'SITUACAO_NAO_PERMITE');
      assert.strictEqual(ctx.tabelas.pedidos[0].valor_final, 384, 'nada pode ter mudado');
    } finally {
      await ctx.encerrar();
    }
  });
}

test('sem a permissão ped.payment.edit a alteração é barrada', async () => {
  const ctx = await montar(cenario(), { permitir: false });
  try {
    const resposta = await alterarPagamento(ctx.porta, 1, {
      condicao: 'vista',
      forma_pagamento: 'pix',
      prazo: '15',
      parcelas_detalhes: [{ valor: 364, data_vencimento: '2026-01-25', numero_parcela: 1 }]
    });
    assert.strictEqual(resposta.status, 403);
    assert.ok(!ctx.chamadas.some(c => c.metodo === 'PUT'), 'nada pode ter sido escrito');
  } finally {
    await ctx.encerrar();
  }
});

test('campos obrigatórios são exigidos antes de tocar no banco', async () => {
  const casos = [
    [{ condicao: 'vista', prazo: '15', parcelas_detalhes: [{ valor: 1 }] }, /forma de pagamento/i],
    [{ condicao: 'vista', forma_pagamento: 'pix', parcelas_detalhes: [{ valor: 1 }] }, /prazo/i],
    [{ condicao: 'vista', forma_pagamento: 'pix', prazo: '15', parcelas_detalhes: [] }, /parcela/i]
  ];

  for (const [body, esperado] of casos) {
    const ctx = await montar(cenario());
    try {
      const resposta = await alterarPagamento(ctx.porta, 1, body);
      assert.strictEqual(resposta.status, 400, `deveria recusar: ${JSON.stringify(body)}`);
      assert.match((await resposta.json()).error, esperado);
      assert.ok(!ctx.chamadas.some(c => c.metodo === 'PUT'), 'nada pode ter sido escrito');
    } finally {
      await ctx.encerrar();
    }
  }
});
