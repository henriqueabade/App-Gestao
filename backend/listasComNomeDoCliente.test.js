/**
 * Nome do cliente nas listas de pedidos e orçamentos.
 *
 * As tabelas guardam `cliente_id`, não o nome. Os Relatórios pedem o nome — na
 * coluna "Cliente" e no filtro por cliente —, e enquanto a lista não o
 * carregava a coluna ficava em "—" e o seletor de clientes abria vazio. Não
 * era falta de cadastro: era um campo que a resposta nunca teve.
 *
 * O que estes testes prendem: o nome vem junto, vem de UMA consulta (não uma
 * por documento), e a ausência do cliente não derruba a lista.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const MODULOS = [
    './apiHttpClient',
    './permissionsController',
    './pedidosController',
    './orcamentosController'
];

function upstreamFake(tabelas) {
    const dados = JSON.parse(JSON.stringify(tabelas));
    const chamadas = [];

    const servidor = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        const partes = url.pathname.split('/').filter(Boolean);
        const tabela = partes[1];
        const id = partes[2];
        chamadas.push({ metodo: req.method, tabela, id });

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

    return { servidor, chamadas };
}

async function montar(tabelas) {
    const { servidor, chamadas } = upstreamFake(tabelas);
    await new Promise(r => servidor.listen(0, '127.0.0.1', r));
    process.env.API_BASE_URL = `http://127.0.0.1:${servidor.address().port}`;

    for (const m of MODULOS) delete require.cache[require.resolve(m)];
    const caminhoPerm = require.resolve('./permissionsController');
    require.cache[caminhoPerm] = {
        id: caminhoPerm,
        filename: caminhoPerm,
        loaded: true,
        exports: {
            exigirPermissao: () => (req, res, next) => next(),
            exigirSupAdmin: (req, res, next) => next(),
            limparCachePermissoes: () => {}
        }
    };

    const app = express();
    app.use(express.json());
    app.use('/api/pedidos', require('./pedidosController'));
    app.use('/api/orcamentos', require('./orcamentosController'));
    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));

    return {
        porta: server.address().port,
        chamadas,
        encerrar: async () => {
            await new Promise(r => server.close(r));
            await new Promise(r => servidor.close(r));
            delete process.env.API_BASE_URL;
            for (const m of MODULOS) delete require.cache[require.resolve(m)];
        }
    };
}

const CLIENTES = [
    { id: 50, nome_fantasia: 'Loja Central', razao_social: 'Central Comércio ME' },
    // Sem nome fantasia: o relatório deve cair para a razão social em vez de
    // mostrar vazio.
    { id: 51, nome_fantasia: '', razao_social: 'Silvia Decorações Ltda' }
];

function tabelas() {
    return {
        clientes: CLIENTES,
        pedidos: [
            { id: 1, numero: 'PED1', cliente_id: 50, situacao: 'Produção', valor_final: 500 },
            { id: 2, numero: 'PED2', cliente_id: 51, situacao: 'Entregue', valor_final: 270 },
            // Órfão de propósito: cliente que não existe mais.
            { id: 3, numero: 'PED3', cliente_id: 999, situacao: 'Produção', valor_final: 100 },
            { id: 4, numero: 'PED4', cliente_id: null, situacao: 'Produção', valor_final: 50 }
        ],
        orcamentos: [
            { id: 10, numero: 'ORC1', cliente_id: 50, situacao: 'Pendente', valor_final: 800 },
            { id: 11, numero: 'ORC2', cliente_id: 51, situacao: 'Rascunho', valor_final: 90 }
        ]
    };
}

const listar = (porta, caminho) =>
    fetch(`http://127.0.0.1:${porta}${caminho}`, {
        headers: { authorization: `Bearer ${tokenDe(1)}` }
    });

// ----------------------------------------------------------------- pedidos

test('a lista de pedidos carrega o nome do cliente', async () => {
    const ctx = await montar(tabelas());
    try {
        const lista = await (await listar(ctx.porta, '/api/pedidos')).json();
        const porNumero = new Map(lista.map(p => [p.numero, p]));

        assert.strictEqual(porNumero.get('PED1').cliente_nome, 'Loja Central');
        // Sem nome fantasia, a razão social responde — melhor que "—".
        assert.strictEqual(porNumero.get('PED2').cliente_nome, 'Silvia Decorações Ltda');
    } finally {
        await ctx.encerrar();
    }
});

test('cliente ausente ou nulo não derruba a lista', async () => {
    const ctx = await montar(tabelas());
    try {
        const resposta = await listar(ctx.porta, '/api/pedidos');
        assert.strictEqual(resposta.status, 200);

        const porNumero = new Map((await resposta.json()).map(p => [p.numero, p]));
        assert.strictEqual(porNumero.get('PED3').cliente_nome, null, 'cliente que sumiu');
        assert.strictEqual(porNumero.get('PED4').cliente_nome, null, 'pedido sem cliente');
    } finally {
        await ctx.encerrar();
    }
});

test('os clientes são buscados UMA vez, não uma por pedido', async () => {
    const ctx = await montar(tabelas());
    try {
        await listar(ctx.porta, '/api/pedidos');

        // Quatro pedidos; uma consulta a clientes. Uma por documento faria o
        // custo da tela crescer com o tamanho da lista.
        const consultas = ctx.chamadas.filter(c => c.tabela === 'clientes').length;
        assert.strictEqual(consultas, 1);
    } finally {
        await ctx.encerrar();
    }
});

test('os campos originais do pedido continuam intactos', async () => {
    const ctx = await montar(tabelas());
    try {
        const [primeiro] = await (await listar(ctx.porta, '/api/pedidos')).json();
        // O enriquecimento acrescenta; não pode substituir o que já vinha.
        assert.strictEqual(primeiro.numero, 'PED1');
        assert.strictEqual(primeiro.cliente_id, 50);
        assert.strictEqual(primeiro.valor_final, 500);
        assert.strictEqual(primeiro.situacao, 'Produção');
    } finally {
        await ctx.encerrar();
    }
});

// -------------------------------------------------------------- orçamentos

test('a lista de orçamentos carrega o nome do cliente', async () => {
    const ctx = await montar(tabelas());
    try {
        const lista = await (await listar(ctx.porta, '/api/orcamentos')).json();
        const porNumero = new Map(lista.map(o => [o.numero, o]));

        assert.strictEqual(porNumero.get('ORC1').cliente_nome, 'Loja Central');
        assert.strictEqual(porNumero.get('ORC2').cliente_nome, 'Silvia Decorações Ltda');
    } finally {
        await ctx.encerrar();
    }
});

test('lista vazia não dispara consulta de clientes', async () => {
    const vazio = tabelas();
    vazio.pedidos = [];
    const ctx = await montar(vazio);
    try {
        const lista = await (await listar(ctx.porta, '/api/pedidos')).json();
        assert.deepStrictEqual(lista, []);

        const consultas = ctx.chamadas.filter(c => c.tabela === 'clientes').length;
        assert.strictEqual(consultas, 0, 'sem documentos não há nome a resolver');
    } finally {
        await ctx.encerrar();
    }
});
