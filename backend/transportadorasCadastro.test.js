/**
 * Cadastrar e excluir a transportadora de um cliente.
 *
 * A transportadora é gravada no orçamento como TEXTO — não como id. Duas
 * grafias da mesma empresa ("rodonaves", "RODONAVES") viram duas
 * transportadoras diferentes na leitura de um relatório, e nada no sistema
 * volta a juntá-las depois. Por isso a normalização é do SERVIDOR: ela vale
 * para todo caminho que crie uma, e não só para a tela que lembrar de fazê-la.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

// Carregado DENTRO de `montar`, depois de apontar `API_BASE_URL` para o
// duplo: `apiHttpClient` congela a URL na hora do `require`, e um require no
// topo deixaria o cliente apontando para a API de verdade — que o modo de
// teste bloqueia com 599.
const MODULOS = ['./transportadorasController', './apiHttpClient'];

// ---------------------------------------------------------------------------
// Duplo do upstream: uma tabela de transportadoras em memória.
// ---------------------------------------------------------------------------

function criarUpstream(linhas) {
  const tabela = linhas.map(l => ({ ...l }));
  let proximoId = Math.max(0, ...tabela.map(l => Number(l.id) || 0)) + 1;
  const chamadas = [];

  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = corpo ? JSON.parse(corpo) : null;
      chamadas.push({ metodo: req.method, caminho: url.pathname, body });

      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (req.method === 'GET' && url.pathname === '/api/transportadoras') {
        const cliente = url.searchParams.get('id_cliente');
        return responder(200, tabela.filter(l => String(l.id_cliente) === String(cliente)));
      }
      if (req.method === 'POST' && url.pathname === '/api/transportadoras') {
        const nova = { id: proximoId++, ...body };
        tabela.push(nova);
        return responder(201, nova);
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/transportadoras/')) {
        const id = Number(url.pathname.split('/').pop());
        const i = tabela.findIndex(l => Number(l.id) === id);
        if (i >= 0) tabela.splice(i, 1);
        return responder(200, { sucesso: true });
      }
      return responder(404, { error: 'Not found' });
    });
  });

  return { servidor, tabela, chamadas };
}

async function montar(linhas = []) {
  const upstream = criarUpstream(linhas);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  const anterior = process.env.API_BASE_URL;
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;

  for (const m of MODULOS) delete require.cache[require.resolve(m)];

  const app = express();
  app.use(express.json());
  app.use('/api/transportadoras', require('./transportadorasController'));

  const api = http.createServer(app);
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  const porta = api.address().port;

  return {
    porta,
    tabela: upstream.tabela,
    chamadas: upstream.chamadas,
    async encerrar() {
      process.env.API_BASE_URL = anterior;
      await new Promise(r => api.close(r));
      await new Promise(r => upstream.servidor.close(r));
    }
  };
}

const chamar = (porta, caminho, opcoes = {}) =>
  fetch(`http://127.0.0.1:${porta}${caminho}`, {
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    ...opcoes
  });

// ---------------------------------------------------------------------------
// O nome
// ---------------------------------------------------------------------------

test('o nome entra com iniciais maiúsculas, digite-se como digitar', async () => {
  const ctx = await montar();
  try {
    const r = await chamar(ctx.porta, '/api/transportadoras', {
      method: 'POST',
      body: JSON.stringify({ id_cliente: 50, transportadora: '  rodonaves   express  ' })
    });
    assert.strictEqual(r.status, 201);

    const corpo = await r.json();
    assert.strictEqual(corpo.nome, 'Rodonaves Express');

    // E é assim que fica no BANCO. Normalizar só na resposta deixaria a
    // gravação com a grafia crua, que é onde o relatório vai ler.
    assert.strictEqual(ctx.tabela.at(-1).transportadora, 'Rodonaves Express');
  } finally {
    await ctx.encerrar();
  }
});

test('sigla não vira palavra', () => {
  const { comIniciaisMaiusculas } = require('./transportadorasController');

  // Mexer no resto do nome transformaria "JSL" em "Jsl" e "MG Log" em "Mg log"
  // — siglas são metade dos nomes deste ramo.
  assert.strictEqual(comIniciaisMaiusculas('JSL'), 'JSL');
  assert.strictEqual(comIniciaisMaiusculas('MG Log'), 'MG Log');
  assert.strictEqual(comIniciaisMaiusculas('braspress'), 'Braspress');
  assert.strictEqual(comIniciaisMaiusculas('  '), '');
});

test('nome vazio é recusado antes de ir ao banco', async () => {
  const ctx = await montar();
  try {
    const r = await chamar(ctx.porta, '/api/transportadoras', {
      method: 'POST', body: JSON.stringify({ id_cliente: 50, transportadora: '   ' })
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(ctx.tabela.length, 0);
    assert.strictEqual(ctx.chamadas.some(c => c.metodo === 'POST'), false);
  } finally {
    await ctx.encerrar();
  }
});

test('sem cliente, não se cadastra', async () => {
  const ctx = await montar();
  try {
    const r = await chamar(ctx.porta, '/api/transportadoras', {
      method: 'POST', body: JSON.stringify({ transportadora: 'Rodonaves' })
    });

    // Uma transportadora sem dono não aparece em lista nenhuma — fica no banco
    // ocupando espaço e sem jeito de ser achada.
    assert.strictEqual(r.status, 400);
    assert.strictEqual(ctx.tabela.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Duplicata
// ---------------------------------------------------------------------------

test('a mesma transportadora não entra duas vezes', async () => {
  const ctx = await montar([{ id: 1, id_cliente: 50, transportadora: 'Rodonaves' }]);
  try {
    const r = await chamar(ctx.porta, '/api/transportadoras', {
      method: 'POST', body: JSON.stringify({ id_cliente: 50, transportadora: 'RODONAVES' })
    });

    // Duplicata é o caso comum, não o excepcional: quem não vê a empresa na
    // lista digita o nome dela de novo. Recusar com o nome que JÁ existe é o
    // que faz a pessoa procurar em vez de cadastrar uma segunda.
    assert.strictEqual(r.status, 409);
    const corpo = await r.json();
    assert.match(corpo.error, /Rodonaves/);
    assert.strictEqual(ctx.tabela.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('a mesma transportadora entra para OUTRO cliente', async () => {
  const ctx = await montar([{ id: 1, id_cliente: 50, transportadora: 'Rodonaves' }]);
  try {
    const r = await chamar(ctx.porta, '/api/transportadoras', {
      method: 'POST', body: JSON.stringify({ id_cliente: 51, transportadora: 'Rodonaves' })
    });

    // O cadastro é POR CLIENTE. A mesma transportadora atende empresas
    // diferentes, e recusar aqui obrigaria a inventar um nome falso.
    assert.strictEqual(r.status, 201);
    assert.strictEqual(ctx.tabela.length, 2);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Excluir
// ---------------------------------------------------------------------------

test('excluir tira do cadastro daquele cliente', async () => {
  const ctx = await montar([
    { id: 1, id_cliente: 50, transportadora: 'Rodonaves' },
    { id: 2, id_cliente: 50, transportadora: 'Braspress' }
  ]);
  try {
    const r = await chamar(ctx.porta, '/api/transportadoras/1?id_cliente=50',
      { method: 'DELETE' });
    assert.strictEqual(r.status, 200);

    const corpo = await r.json();
    // A resposta traz a lista nova: quem chamou vai repintar o seletor, e
    // pedi-la de novo seria uma segunda ida para saber o que já veio.
    assert.deepStrictEqual(corpo.transportadoras.map(t => t.nome), ['Braspress']);
    assert.strictEqual(ctx.tabela.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('não se exclui a transportadora de OUTRO cliente', async () => {
  const ctx = await montar([
    { id: 1, id_cliente: 50, transportadora: 'Rodonaves' },
    { id: 2, id_cliente: 51, transportadora: 'Braspress' }
  ]);
  try {
    // O id 2 existe, mas é de outra empresa. Sem conferir, um id qualquer
    // apagaria o cadastro de lá — e o erro só apareceria quando alguém de lá
    // fosse montar um pedido.
    const r = await chamar(ctx.porta, '/api/transportadoras/2?id_cliente=50',
      { method: 'DELETE' });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(ctx.tabela.length, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('excluir sem dizer o cliente não passa', async () => {
  const ctx = await montar([{ id: 1, id_cliente: 50, transportadora: 'Rodonaves' }]);
  try {
    const r = await chamar(ctx.porta, '/api/transportadoras/1', { method: 'DELETE' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(ctx.tabela.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('a listagem devolve id e nome, ordenados', async () => {
  const ctx = await montar([
    { id: 1, id_cliente: 50, transportadora: 'Rodonaves' },
    { id: 2, id_cliente: 51, transportadora: 'Braspress' }
  ]);
  try {
    const lista = await (await chamar(ctx.porta, '/api/transportadoras/50')).json();

    // Só as do cliente pedido: a lista alimenta um seletor, e uma transportadora
    // de outra empresa ali seria escolhida sem ninguém notar.
    assert.deepStrictEqual(lista, [{ id: 1, nome: 'Rodonaves' }]);
  } finally {
    await ctx.encerrar();
  }
});
