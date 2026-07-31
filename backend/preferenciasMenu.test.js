/**
 * Preferências de inicialização do menu (sql/mudancausuario.sql).
 * Roda contra um mock local — a trava de rede impede alcançar a API real.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const TOKEN_USUARIO_7 = `x.${Buffer.from(JSON.stringify({ id: 7 })).toString('base64')}.y`;

async function montar(usuarioNoBanco) {
  const recebidos = [];
  const upstream = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', parte => { corpo += parte; });
    req.on('end', () => {
      recebidos.push({
        metodo: req.method,
        url: req.url,
        corpo: corpo ? JSON.parse(corpo) : null
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.method === 'GET' ? usuarioNoBanco : { ok: true }));
    });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));

  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  for (const m of ['./apiHttpClient', './usuariosController', './permissionsController']) {
    delete require.cache[require.resolve(m)];
  }

  const app = express();
  app.use(express.json());
  app.use('/api/usuarios', require('./usuariosController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));

  return {
    porta: server.address().port,
    recebidos,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.close(r));
      delete process.env.API_BASE_URL;
      delete require.cache[require.resolve('./apiHttpClient')];
      delete require.cache[require.resolve('./usuariosController')];
    }
  };
}

function chamar(porta, caminho, opcoes = {}) {
  return fetch(`http://127.0.0.1:${porta}${caminho}`, {
    ...opcoes,
    headers: { authorization: `Bearer ${TOKEN_USUARIO_7}`, ...(opcoes.headers || {}) }
  });
}

test('GET devolve o que está no banco', async () => {
  const ctx = await montar({
    id: 7,
    menu_modulo_inicial: 'pedidos',
    menu_crm_expandido: true,
    menu_barra_lateral: 'auto'
  });
  try {
    const resposta = await chamar(ctx.porta, '/api/usuarios/me/preferencias-menu');
    assert.strictEqual(resposta.status, 200);
    assert.deepStrictEqual(await resposta.json(), {
      menu_modulo_inicial: 'pedidos',
      menu_crm_expandido: true,
      menu_barra_lateral: 'auto'
    });
  } finally {
    await ctx.encerrar();
  }
});

test('valores ausentes/invalidos caem no padrão: dashboard, off, sempre aberta', async () => {
  const ctx = await montar({ id: 7, menu_modulo_inicial: 'modulo-que-nao-existe' });
  try {
    const resposta = await chamar(ctx.porta, '/api/usuarios/me/preferencias-menu');
    assert.deepStrictEqual(await resposta.json(), {
      menu_modulo_inicial: 'dashboard',
      menu_crm_expandido: false,
      menu_barra_lateral: 'fixed'
    });
  } finally {
    await ctx.encerrar();
  }
});

test('PUT normaliza antes de gravar e envia só as três colunas', async () => {
  const ctx = await montar({ id: 7 });
  try {
    const resposta = await chamar(ctx.porta, '/api/usuarios/me/preferencias-menu', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        menu_modulo_inicial: 'ORCAMENTOS',
        menu_crm_expandido: 'true',
        menu_barra_lateral: 'valor-invalido',
        perfil: 'Sup Admin'          // campo intruso: não pode ser gravado
      })
    });
    assert.strictEqual(resposta.status, 200);

    const gravacao = ctx.recebidos.find(r => r.metodo === 'PUT');
    assert.deepStrictEqual(gravacao.corpo, {
      menu_modulo_inicial: 'orcamentos',
      menu_crm_expandido: true,
      menu_barra_lateral: 'fixed'
    });
    assert.ok(gravacao.url.includes('/api/usuarios/7'), 'grava no usuário do token');
  } finally {
    await ctx.encerrar();
  }
});

test('aceita "last" (retomar último módulo)', async () => {
  const ctx = await montar({ id: 7, menu_modulo_inicial: 'last' });
  try {
    const resposta = await chamar(ctx.porta, '/api/usuarios/me/preferencias-menu');
    assert.strictEqual((await resposta.json()).menu_modulo_inicial, 'last');
  } finally {
    await ctx.encerrar();
  }
});
