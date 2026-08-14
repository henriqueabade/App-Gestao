/**
 * Transportadoras do cliente e contatos, pelo PUT de cliente.
 *
 * O duplo abaixo repete a limitação que importa aqui: a API só conhece rotas
 * sob `/api/<tabela>`. Qualquer caminho sem esse prefixo devolve 404 — foi o
 * que escondeu, por muito tempo, que editar e excluir contato de cliente não
 * funcionava.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  clientes: ['id', 'nome_fantasia', 'razao_social', 'cnpj', 'inscricao_estadual', 'site',
    'status_cliente', 'dono_cliente', 'origem_captacao', 'anotacoes'],
  contatos_cliente: ['id', 'id_cliente', 'nome', 'cargo', 'email', 'telefone_fixo', 'telefone_celular'],
  transportadoras: ['id', 'id_cliente', 'transportadora'],
  orcamentos: ['id', 'numero', 'cliente_id'],
  usuarios: ['id', 'nome', 'perfil', 'modelo_permissoes_id'],
  modelos_permissoes: ['id', 'nome']
};

function criarUpstream(dados) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const caminhosRecusados = [];

  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const partes = url.pathname.split('/').filter(Boolean);
      const body = corpo ? JSON.parse(corpo) : null;

      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      // A API real só atende sob /api. Sem esta recusa, um caminho sem o
      // prefixo passaria no teste e continuaria quebrado em produção.
      if (partes[0] !== 'api') {
        caminhosRecusados.push(`${req.method} ${url.pathname}`);
        return responder(404, { error: 'Rota não encontrada' });
      }

      const tabela = partes[1];
      const id = partes[2];
      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || [];

      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Registro não encontrado' });
      }
      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (!colunas.includes(chave)) continue;
          linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const proximo = Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1;
        const linha = { id: proximo };
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Registro não encontrado' });
        for (const c of colunas) if (body?.[c] !== undefined) alvo[c] = body[c];
        return responder(200, alvo);
      }
      if (req.method === 'DELETE') {
        const idx = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (idx === -1) return responder(404, { error: 'Registro não encontrado' });
        const [removido] = tabelas[tabela].splice(idx, 1);
        return responder(200, { sucesso: true, deletado: removido });
      }
      responder(405, { error: 'Método não suportado' });
    });
  });

  return { servidor, tabelas, caminhosRecusados };
}

const MODULOS = ['./apiHttpClient', './permissionsController', './permissionsRepository', './clientesController'];

async function montar(dados) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];

  const app = express();
  app.use(express.json());
  app.use('/api/clientes', require('./clientesController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));

  return {
    porta: server.address().port,
    tabelas: upstream.tabelas,
    caminhosRecusados: upstream.caminhosRecusados,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

function chamar(porta, caminho, opcoes = {}) {
  const { usuario = 1, ...resto } = opcoes;
  return fetch(`http://127.0.0.1:${porta}${caminho}`, {
    ...resto,
    headers: {
      authorization: `Bearer ${tokenDe(usuario)}`,
      'content-type': 'application/json',
      ...(resto.headers || {})
    }
  });
}

function baseDados() {
  return {
    usuarios: [{ id: 1, nome: 'Henrique', perfil: 'Sup Admin', modelo_permissoes_id: null }],
    modelos_permissoes: [],
    clientes: [{ id: 50, nome_fantasia: 'Casa Vicenzo', razao_social: 'Vicenzo Ltda', cnpj: '11.111.111/0001-11' }],
    contatos_cliente: [{ id: 7, id_cliente: 50, nome: 'Ana', cargo: 'Compras', email: 'ana@vic.com' }],
    transportadoras: [{ id: 3, id_cliente: 50, transportadora: 'Braspress' }],
    orcamentos: []
  };
}

const CLIENTE = { razao_social: 'Vicenzo Ltda', nome_fantasia: 'Casa Vicenzo' };

// ---------------------------------------------------------------------------
// Transportadoras
// ---------------------------------------------------------------------------

test('cadastrar transportadora nova pelo salvamento do cliente', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/clientes/50', {
      method: 'PUT',
      body: JSON.stringify({ ...CLIENTE, transportadorasNovas: [{ transportadora: 'Jamef' }] })
    });
    assert.strictEqual(resp.status, 200);

    const doCliente = ctx.tabelas.transportadoras.filter(t => t.id_cliente === 50);
    assert.deepStrictEqual(doCliente.map(t => t.transportadora).sort(), ['Braspress', 'Jamef']);
  } finally {
    await ctx.encerrar();
  }
});

test('editar o nome de uma transportadora', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/clientes/50', {
      method: 'PUT',
      body: JSON.stringify({ ...CLIENTE, transportadorasAtualizadas: [{ id: 3, transportadora: 'Braspress Cargo' }] })
    });
    assert.strictEqual(ctx.tabelas.transportadoras.find(t => t.id === 3).transportadora, 'Braspress Cargo');
  } finally {
    await ctx.encerrar();
  }
});

test('excluir uma transportadora', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/clientes/50', {
      method: 'PUT',
      body: JSON.stringify({ ...CLIENTE, transportadorasExcluidas: [3] })
    });
    assert.strictEqual(ctx.tabelas.transportadoras.some(t => t.id === 3), false);
  } finally {
    await ctx.encerrar();
  }
});

test('nome em branco não vira linha no banco', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/clientes/50', {
      method: 'PUT',
      body: JSON.stringify({ ...CLIENTE, transportadorasNovas: [{ transportadora: '   ' }, { transportadora: '' }] })
    });
    assert.strictEqual(ctx.tabelas.transportadoras.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('as três operações convivem no mesmo salvamento', async () => {
  const dados = baseDados();
  dados.transportadoras.push({ id: 4, id_cliente: 50, transportadora: 'Correios' });
  const ctx = await montar(dados);
  try {
    await chamar(ctx.porta, '/api/clientes/50', {
      method: 'PUT',
      body: JSON.stringify({
        ...CLIENTE,
        transportadorasNovas: [{ transportadora: 'Jamef' }],
        transportadorasAtualizadas: [{ id: 3, transportadora: 'Braspress Cargo' }],
        transportadorasExcluidas: [4]
      })
    });
    const nomes = ctx.tabelas.transportadoras.map(t => t.transportadora).sort();
    assert.deepStrictEqual(nomes, ['Braspress Cargo', 'Jamef']);
  } finally {
    await ctx.encerrar();
  }
});

test('o cliente sem deltas de transportadora não perde as que tem', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/clientes/50', {
      method: 'PUT', body: JSON.stringify({ ...CLIENTE, nome_fantasia: 'Casa Vicenzo Matriz' })
    });
    assert.strictEqual(ctx.tabelas.transportadoras.length, 1);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Contatos: o `/api` que faltava
//
// O POST usava `/api/contatos_cliente`, mas o PUT e o DELETE usavam
// `/contatos_cliente`. Como o cliente HTTP concatena o caminho cru na base,
// isso batia numa rota inexistente — editar e excluir contato não funcionava.
// ---------------------------------------------------------------------------

test('editar contato de cliente chega ao banco', async () => {
  const ctx = await montar(baseDados());
  try {
    const resp = await chamar(ctx.porta, '/api/clientes/50', {
      method: 'PUT',
      body: JSON.stringify({ ...CLIENTE, contatosAtualizados: [{ id: 7, nome: 'Ana Paula', cargo: 'Gerente' }] })
    });
    assert.strictEqual(resp.status, 200);

    const contato = ctx.tabelas.contatos_cliente.find(c => c.id === 7);
    assert.strictEqual(contato.nome, 'Ana Paula');
    assert.strictEqual(contato.cargo, 'Gerente');
    assert.deepStrictEqual(ctx.caminhosRecusados, [], 'alguma chamada saiu sem o prefixo /api');
  } finally {
    await ctx.encerrar();
  }
});

test('excluir contato de cliente chega ao banco', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/clientes/50', {
      method: 'PUT', body: JSON.stringify({ ...CLIENTE, contatosExcluidos: [7] })
    });
    assert.strictEqual(ctx.tabelas.contatos_cliente.some(c => c.id === 7), false);
    assert.deepStrictEqual(ctx.caminhosRecusados, [], 'alguma chamada saiu sem o prefixo /api');
  } finally {
    await ctx.encerrar();
  }
});
