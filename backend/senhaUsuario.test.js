/**
 * Senha forte e senha sempre em hash (fase 4 das correções de 21/09/2026).
 *
 * - Configurações › Dados pessoais troca a senha por PUT /api/usuarios/me.
 *   Antes a senha ia CRUA para a coluna, que só guarda hash bcrypt: a pessoa
 *   trocava a senha e não conseguia mais entrar. Agora vai em hash, e só se
 *   atender à regra (src/js/utils/senha-forte.js).
 * - "Esqueceu a senha?" (backend/passwordResetRoutes.js): em PROD repassa às
 *   rotas públicas da API; em DEV usa backend/redefinicaoSenha.js no banco
 *   local. O código nunca volta na resposta.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const bcrypt = require('bcrypt');

const SenhaForte = require('../src/js/utils/senha-forte');
const { criarRedefinicaoDeSenha, hashDoCodigo } = require('./redefinicaoSenha');

const TOKEN = `x.${Buffer.from(JSON.stringify({ id: 9 })).toString('base64')}.y`;
const CAMINHOS = {
  api: require.resolve('./apiHttpClient'),
  usuarios: require.resolve('./usuariosController'),
  permissoes: require.resolve('./permissionsController')
};
const SENHA_BOA = 'Nova@Senha1';

async function montarUsuarios() {
  const recebidos = [];
  const upstream = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const dados = corpo ? JSON.parse(corpo) : null;
      recebidos.push({ metodo: req.method, url: req.url, corpo: dados });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 9, nome: 'Maria', email: 'maria@loja.com', ...(dados || {}) }));
    });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  Object.values(CAMINHOS).forEach(p => delete require.cache[p]);
  require.cache[CAMINHOS.permissoes] = {
    id: CAMINHOS.permissoes,
    filename: CAMINHOS.permissoes,
    loaded: true,
    exports: { exigirPermissao: () => (req, res, next) => next(), limparCachePermissoes: () => {} }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/usuarios', require('./usuariosController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const put = (caminho, body) => fetch(`http://127.0.0.1:${server.address().port}/api/usuarios${caminho}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body)
  });
  return {
    put,
    recebidos,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.close(r));
      delete process.env.API_BASE_URL;
      Object.values(CAMINHOS).forEach(p => delete require.cache[p]);
    }
  };
}

test('regra da senha: 8+, maiúscula, número e especial; acento é letra e espaço não é especial', () => {
  assert.strictEqual(SenhaForte.mensagem('Abcdef1!'), '');
  assert.strictEqual(SenhaForte.mensagem('Ábcdéf1@'), '');
  assert.strictEqual(SenhaForte.mensagem('Senha Forte 1'), 'A senha precisa ter um caractere especial.');
  assert.strictEqual(SenhaForte.mensagem('abc'),
    'A senha precisa ter pelo menos 8 caracteres, uma letra maiúscula, um número e um caractere especial.');
  assert.strictEqual(SenhaForte.mensagem(undefined), SenhaForte.mensagem(''));
  const { valida, itens } = SenhaForte.conferir('abcdefgh1');
  assert.strictEqual(valida, false);
  assert.deepStrictEqual(itens.map(i => [i.chave, i.ok]),
    [['tamanho', true], ['maiuscula', false], ['numero', true], ['especial', false]]);
});

test('Configurações: senha fraca é recusada com o que falta e nada vai ao banco', async () => {
  const ctx = await montarUsuarios();
  try {
    const r = await ctx.put('/me', { nome: 'Maria', senha: 'senha123' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await r.json()).error, 'A senha precisa ter uma letra maiúscula e um caractere especial.');
    assert.strictEqual(ctx.recebidos.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('Configurações: a senha nova vai em hash bcrypt (nunca crua) e o hash não volta para a tela', async () => {
  const ctx = await montarUsuarios();
  try {
    const r = await ctx.put('/me', { nome: 'Maria', senha: SENHA_BOA });
    assert.strictEqual(r.status, 200);
    const enviada = ctx.recebidos[0].corpo.senha;
    assert.notStrictEqual(enviada, SENHA_BOA);
    assert.match(enviada, /^\$2[aby]\$12\$/);
    assert.ok(await bcrypt.compare(SENHA_BOA, enviada), 'o login precisa conferir com o hash');
    assert.strictEqual('senha' in (await r.json()), false);
  } finally {
    await ctx.encerrar();
  }
});

test('Configurações: sem senha nova, a senha nem vai no corpo; PUT /:id também faz hash', async () => {
  const ctx = await montarUsuarios();
  try {
    assert.strictEqual((await ctx.put('/me', { nome: 'Maria', senha: '' })).status, 200);
    assert.strictEqual('senha' in ctx.recebidos[0].corpo, false);
    assert.strictEqual((await ctx.put('/5', { senha: SENHA_BOA })).status, 200);
    assert.ok(await bcrypt.compare(SENHA_BOA, ctx.recebidos[1].corpo.senha));
    assert.strictEqual((await ctx.put('/5', { senha: 'fraca' })).status, 400);
    assert.strictEqual(ctx.recebidos.length, 2);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// "Esqueceu a senha?" — as rotas da tela de login
// ---------------------------------------------------------------------------

async function montarRedefinicao({ emDev = false, respostas = {}, local = null } = {}) {
  const rotas = require('./passwordResetRoutes');
  const chamadas = [];
  const antes = { ...rotas._dependencias };
  rotas._dependencias.emDev = emDev;
  rotas._dependencias.local = local;
  rotas._dependencias.fetch = async (url, opcoes) => {
    chamadas.push({ url, corpo: JSON.parse(opcoes.body) });
    const caminho = new URL(url).pathname;
    const resposta = respostas[caminho];
    if (resposta instanceof Error) throw resposta;
    if (!resposta) return new Response('Cannot POST', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { 'content-type': 'application/json' } });
  };
  const redefinidas = [];
  const ouvir = email => redefinidas.push(email);
  rotas.eventos.on('senha-redefinida', ouvir);
  const app = express();
  app.use(express.json());
  app.use(rotas);
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const post = (caminho, body) => fetch(`http://127.0.0.1:${server.address().port}${caminho}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return {
    post,
    chamadas,
    redefinidas,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      rotas.eventos.off('senha-redefinida', ouvir);
      Object.assign(rotas._dependencias, antes);
    }
  };
}

test('PROD: pedir o código não exige sessão e vai à rota pública da API, com o e-mail em minúsculas', async () => {
  const ctx = await montarRedefinicao({
    respostas: { '/senha/esqueci': { status: 200, corpo: { success: true, emailEnviado: true, motivo: null } } }
  });
  try {
    const r = await ctx.post('/password-reset-request', { email: ' Maria@Loja.com ' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(await r.json(), { success: true, emailEnviado: true, motivo: null, dev: false });
    assert.strictEqual(ctx.chamadas.length, 1);
    assert.match(ctx.chamadas[0].url, /\/senha\/esqueci$/);
    assert.deepStrictEqual(ctx.chamadas[0].corpo, { email: 'maria@loja.com' });
  } finally {
    await ctx.encerrar();
  }
});

test('PROD: a mensagem da API chega à tela; API sem as rotas ou fora do ar vira aviso claro', async () => {
  const ctx = await montarRedefinicao({
    respostas: { '/senha/esqueci': { status: 404, corpo: { error: 'E-mail não encontrado.' } } }
  });
  try {
    const r = await ctx.post('/password-reset-request', { email: 'ninguem@loja.com' });
    assert.strictEqual(r.status, 404);
    assert.strictEqual((await r.json()).error, 'E-mail não encontrado.');
    const semRota = await ctx.post('/password-reset', { email: 'maria@loja.com', codigo: '1234 5678', novaSenha: SENHA_BOA });
    assert.strictEqual(semRota.status, 503);
    assert.match((await semRota.json()).error, /atualizar a API/);
  } finally {
    await ctx.encerrar();
  }
  const foraDoAr = await montarRedefinicao({ respostas: { '/senha/esqueci': new Error('fetch failed') } });
  try {
    const r = await foraDoAr.post('/password-reset-request', { email: 'maria@loja.com' });
    assert.strictEqual(r.status, 503);
    assert.match((await r.json()).error, /Sem conexão/);
  } finally {
    await foraDoAr.encerrar();
  }
});

test('PROD: trocar a senha confere código e senha antes de sair; sucesso libera o bloqueio do login', async () => {
  const ctx = await montarRedefinicao({
    respostas: { '/senha/redefinir': { status: 200, corpo: { success: true } } }
  });
  try {
    const fraca = await ctx.post('/password-reset', { email: 'maria@loja.com', codigo: '12345678', novaSenha: 'senha123' });
    assert.strictEqual(fraca.status, 400);
    assert.match((await fraca.json()).error, /letra maiúscula/);
    const curto = await ctx.post('/password-reset', { email: 'maria@loja.com', codigo: '1234', novaSenha: SENHA_BOA });
    assert.strictEqual(curto.status, 400);
    assert.strictEqual(ctx.chamadas.length, 0, 'nada vai à API com dado inválido');

    const ok = await ctx.post('/password-reset', { email: 'Maria@Loja.com', codigo: '1234 5678', novaSenha: SENHA_BOA });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(ctx.chamadas[0].corpo, { email: 'maria@loja.com', codigo: '12345678', novaSenha: SENHA_BOA });
    assert.deepStrictEqual(ctx.redefinidas, ['maria@loja.com']);
  } finally {
    await ctx.encerrar();
  }
});

/** Banco de mentira para a cópia DEV (as mesmas consultas da API). */
function bancoFalso() {
  const usuarios = [{ id: 4, nome: 'Maria', email: 'maria@loja.com', senha: 'antigo' }];
  let tokens = [];
  return {
    usuarios,
    get tokens() { return tokens; },
    async query(sql, p) {
      if (sql.startsWith('SELECT id, nome, email FROM usuarios')) return { rows: usuarios.filter(u => u.email === p[0]) };
      if (sql.startsWith('DELETE FROM password_reset_tokens')) { tokens = tokens.filter(t => t.user_id !== p[0]); return { rows: [] }; }
      if (sql.startsWith('INSERT INTO password_reset_tokens')) { tokens.push({ id: 1, user_id: p[0], token_hash: p[1], expires_at: p[2] }); return { rows: [] }; }
      if (sql.startsWith('SELECT id, token_hash, expires_at')) return { rows: tokens.filter(t => t.user_id === p[0]) };
      if (sql.startsWith('UPDATE usuarios SET senha')) { usuarios.find(u => u.id === p[1]).senha = p[0]; return { rows: [] }; }
      throw new Error('consulta inesperada: ' + sql);
    }
  };
}

test('DEV: o pedido e a troca correm no banco local, com o código só no e-mail e a senha em bcrypt', async () => {
  const banco = bancoFalso();
  const enviados = [];
  const local = criarRedefinicaoDeSenha({
    pool: banco,
    bcrypt,
    mensagemDaSenha: SenhaForte.mensagem,
    enviarCodigo: async dados => { enviados.push(dados); return { enviado: false, motivo: 'desligado' }; },
    gerarCodigo: () => '24681357'
  });
  const ctx = await montarRedefinicao({ emDev: true, local });
  try {
    const pedido = await ctx.post('/password-reset-request', { email: 'MARIA@loja.com' });
    const corpo = await pedido.json();
    assert.strictEqual(pedido.status, 200);
    assert.deepStrictEqual(corpo, { success: true, emailEnviado: false, motivo: 'desligado', dev: true });
    assert.strictEqual(JSON.stringify(corpo).includes('24681357'), false);
    assert.strictEqual(enviados[0].codigo, '24681357');
    assert.strictEqual(banco.tokens[0].token_hash, hashDoCodigo(4, '24681357'));

    const errado = await ctx.post('/password-reset', { email: 'maria@loja.com', codigo: '11111111', novaSenha: SENHA_BOA });
    assert.strictEqual(errado.status, 400);
    assert.match((await errado.json()).error, /Restam 4/);

    const certo = await ctx.post('/password-reset', { email: 'maria@loja.com', codigo: '2468 1357', novaSenha: SENHA_BOA });
    assert.strictEqual(certo.status, 200);
    assert.ok(await bcrypt.compare(SENHA_BOA, banco.usuarios[0].senha));
    assert.strictEqual(banco.tokens.length, 0);
    assert.deepStrictEqual(ctx.redefinidas, ['maria@loja.com']);
    assert.strictEqual(ctx.chamadas.length, 0, 'em DEV nada vai à API remota');
  } finally {
    await ctx.encerrar();
  }
});

test('cadastro pela tela de login recusa senha fraca antes de gravar', async () => {
  const backend = require('./backend');
  await assert.rejects(backend.registrarUsuario('Maria Souza', 'maria@loja.com', 'senha123'),
    { message: 'A senha precisa ter uma letra maiúscula e um caractere especial.' });
});
