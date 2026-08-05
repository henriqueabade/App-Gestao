/**
 * Cadastro de usuário pelo Sup Admin (modal "Novo usuário").
 *
 * O ponto central: o usuário precisa nascer LIBERADO — sem confirmação de
 * e-mail e sem fila de aprovação —, porque quem cadastrou é justamente quem
 * aprovaria depois. Se algum desses campos deixar de ser gravado, o usuário
 * some da tela de login com "aguardando aprovação" e ninguém entende por quê.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const TOKEN = `x.${Buffer.from(JSON.stringify({ id: 9 })).toString('base64')}.y`;

const CAMINHOS = {
  api: require.resolve('./apiHttpClient'),
  usuarios: require.resolve('./usuariosController'),
  permissoes: require.resolve('./permissionsController')
};

async function montar({ existentes = [], permitir = true } = {}) {
  const recebidos = [];

  const upstream = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      recebidos.push({ metodo: req.method, url: req.url, corpo: corpo ? JSON.parse(corpo) : null });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'GET') return res.end(JSON.stringify(existentes));
      return res.end(JSON.stringify({ id: 77, nome: 'Novo', email: 'novo@empresa.com' }));
    });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));

  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  Object.values(CAMINHOS).forEach(p => delete require.cache[p]);

  // Guarda de permissão controlada: o objetivo aqui é a regra de cadastro.
  // Um teste específico inverte `permitir` para provar que a guarda existe.
  require.cache[CAMINHOS.permissoes] = {
    id: CAMINHOS.permissoes,
    filename: CAMINHOS.permissoes,
    loaded: true,
    exports: {
      exigirPermissao: () => (req, res, next) =>
        permitir ? next() : res.status(403).json({ error: 'Sem permissão' }),
      limparCachePermissoes: () => {}
    }
  };

  const app = express();
  app.use(express.json({ limit: '5mb' }));
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
      Object.values(CAMINHOS).forEach(p => delete require.cache[p]);
    }
  };
}

function cadastrar(porta, body) {
  return fetch(`http://127.0.0.1:${porta}/api/usuarios`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body)
  });
}

const VALIDO = {
  nome: 'Maria Souza',
  email: 'Maria.Souza@Empresa.com',
  telefone: '(11) 99999-0000',
  perfil: 'Comercial',
  senha: 'segredo123',
  observacoes: 'Equipe de vendas'
};

test('cadastra o usuário já liberado, sem confirmação nem aprovação', async () => {
  const ctx = await montar();
  try {
    const resposta = await cadastrar(ctx.porta, VALIDO);
    assert.strictEqual(resposta.status, 201);

    const criacao = ctx.recebidos.find(r => r.metodo === 'POST');
    assert.ok(criacao, 'deveria ter criado no upstream');
    const c = criacao.corpo;

    assert.strictEqual(c.status, 'ativo');
    assert.strictEqual(c.verificado, true);
    assert.strictEqual(c.confirmacao, true);
    assert.strictEqual(c.email_confirmado, true);
    assert.ok(c.email_confirmado_em, 'deveria datar a confirmação');
    assert.ok(c.hora_ativacao && c.data_ativacao, 'deveria datar a ativação');
    assert.strictEqual(c.aprovacao_token, null, 'não pode ficar pendente de aprovação');
    assert.strictEqual(c.confirmacao_token, null, 'não pode ficar pendente de confirmação');

    assert.strictEqual(c.email, 'maria.souza@empresa.com', 'e-mail deve ser normalizado');
    assert.strictEqual(c.senha, 'segredo123', 'a senha vai em texto: o upstream aplica o hash');
    assert.strictEqual(c.perfil, 'Comercial');
    assert.strictEqual(c.descricao, 'Equipe de vendas');
  } finally {
    await ctx.encerrar();
  }
});

test('recusa e-mail já cadastrado com mensagem clara', async () => {
  const ctx = await montar({ existentes: [{ id: 3, email: 'maria.souza@empresa.com' }] });
  try {
    const resposta = await cadastrar(ctx.porta, VALIDO);
    assert.strictEqual(resposta.status, 409);
    assert.match((await resposta.json()).error, /já existe/i);
    assert.ok(!ctx.recebidos.some(r => r.metodo === 'POST'), 'não pode ter criado nada');
  } finally {
    await ctx.encerrar();
  }
});

test('valida os campos obrigatórios antes de tocar no banco', async () => {
  const casos = [
    [{ ...VALIDO, nome: 'Jo' }, /nome completo/i],
    [{ ...VALIDO, email: 'sem-arroba' }, /e-mail válido/i],
    [{ ...VALIDO, senha: '123' }, /6 caracteres/i],
    [{ ...VALIDO, perfil: '' }, /perfil/i]
  ];

  for (const [body, esperado] of casos) {
    const ctx = await montar();
    try {
      const resposta = await cadastrar(ctx.porta, body);
      assert.strictEqual(resposta.status, 400, `deveria recusar: ${JSON.stringify(body).slice(0, 60)}`);
      assert.match((await resposta.json()).error, esperado);
      assert.ok(!ctx.recebidos.some(r => r.metodo === 'POST'), 'não pode ter criado nada');
    } finally {
      await ctx.encerrar();
    }
  }
});

test('aceita foto e recusa imagem fora do padrão', async () => {
  const pngMinimo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  const ok = await montar();
  try {
    const resposta = await cadastrar(ok.porta, { ...VALIDO, avatar: pngMinimo });
    assert.strictEqual(resposta.status, 201);
    const criacao = ok.recebidos.find(r => r.metodo === 'POST');
    assert.strictEqual(criacao.corpo.foto_usuario, pngMinimo);
    assert.ok(criacao.corpo.avatar_version, 'deveria versionar a foto para quebrar cache');
  } finally {
    await ok.encerrar();
  }

  const ruim = await montar();
  try {
    const resposta = await cadastrar(ruim.porta, { ...VALIDO, avatar: 'data:image/gif;base64,R0lGOD' });
    assert.strictEqual(resposta.status, 400);
    assert.match((await resposta.json()).error, /PNG ou JPEG/i);
  } finally {
    await ruim.encerrar();
  }
});

test('sem a permissão usuarios.create o cadastro é barrado', async () => {
  const ctx = await montar({ permitir: false });
  try {
    const resposta = await cadastrar(ctx.porta, VALIDO);
    assert.strictEqual(resposta.status, 403);
    assert.ok(!ctx.recebidos.some(r => r.metodo === 'POST'), 'não pode ter criado nada');
  } finally {
    await ctx.encerrar();
  }
});
