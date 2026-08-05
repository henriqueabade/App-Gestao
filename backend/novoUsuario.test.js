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
const bcrypt = require('bcrypt');

const TOKEN = `x.${Buffer.from(JSON.stringify({ id: 9 })).toString('base64')}.y`;

const CAMINHOS = {
  api: require.resolve('./apiHttpClient'),
  usuarios: require.resolve('./usuariosController'),
  permissoes: require.resolve('./permissionsController')
};

async function montar({ existentes = [], permitir = true, falharFoto = false } = {}) {
  const recebidos = [];

  const upstream = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      recebidos.push({ metodo: req.method, url: req.url, corpo: corpo ? JSON.parse(corpo) : null });

      if (req.method === 'PUT' && falharFoto) {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'upload indisponível' }));
      }

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
    assert.strictEqual(c.perfil, 'Comercial');
    assert.strictEqual(c.descricao, 'Equipe de vendas');
  } finally {
    await ctx.encerrar();
  }
});

test('grava a senha apenas como hash bcrypt, nunca em texto', async () => {
  const ctx = await montar();
  try {
    const resposta = await cadastrar(ctx.porta, VALIDO);
    assert.strictEqual(resposta.status, 201);

    const enviada = ctx.recebidos.find(r => r.metodo === 'POST').corpo.senha;

    assert.notStrictEqual(enviada, VALIDO.senha, 'a senha NÃO pode trafegar/gravar crua');
    assert.doesNotMatch(enviada, /segredo123/, 'a senha original não pode aparecer no valor gravado');
    assert.match(enviada, /^\$2[aby]\$\d{2}\$/, 'deveria ser um hash bcrypt');

    // O que realmente importa: o login precisa conseguir validar por este hash.
    assert.ok(await bcrypt.compare(VALIDO.senha, enviada), 'o hash tem de conferir com a senha digitada');
    assert.ok(!(await bcrypt.compare('senhaErrada', enviada)), 'senha errada não pode conferir');
  } finally {
    await ctx.encerrar();
  }
});

test('duas contas com a mesma senha geram hashes diferentes (salt por registro)', async () => {
  const hashes = [];
  for (const email of ['a@empresa.com', 'b@empresa.com']) {
    const ctx = await montar();
    try {
      await cadastrar(ctx.porta, { ...VALIDO, email });
      hashes.push(ctx.recebidos.find(r => r.metodo === 'POST').corpo.senha);
    } finally {
      await ctx.encerrar();
    }
  }
  assert.notStrictEqual(hashes[0], hashes[1], 'hashes iguais indicariam ausência de salt');
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

test('a foto NÃO vai no INSERT: sobe pelo endpoint de avatar do usuário criado', async () => {
  const pngMinimo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  const ok = await montar();
  try {
    const resposta = await cadastrar(ok.porta, { ...VALIDO, avatar: pngMinimo });
    assert.strictEqual(resposta.status, 201);

    // O INSERT tem de sair limpo — era aqui que a dataURL ia parar na coluna errada.
    const criacao = ok.recebidos.find(r => r.metodo === 'POST');
    assert.strictEqual(criacao.corpo.foto_usuario, undefined, 'a foto não pode ir no INSERT');
    assert.strictEqual(criacao.corpo.avatar_version, undefined, 'nem a versão da foto');

    // A imagem sobe depois, pelo endpoint próprio, já com o id retornado.
    const envioFoto = ok.recebidos.find(r => r.metodo === 'PUT');
    assert.ok(envioFoto, 'deveria ter chamado o endpoint de avatar');
    assert.match(envioFoto.url, /\/api\/usuarios\/77\/avatar/, 'deve mirar o usuário recém-criado');
    assert.strictEqual(envioFoto.corpo.avatar, pngMinimo);
    assert.ok(envioFoto.corpo.avatar_version, 'deveria versionar para quebrar cache');

    assert.strictEqual((await resposta.json()).aviso, undefined, 'sem aviso quando a foto sobe');
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

test('falha no envio da foto não desfaz o cadastro — avisa e segue', async () => {
  const ctx = await montar({ falharFoto: true });
  try {
    const resposta = await cadastrar(ctx.porta, {
      ...VALIDO,
      avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    });

    assert.strictEqual(resposta.status, 201, 'o usuário foi criado e já pode entrar');
    const corpo = await resposta.json();
    assert.match(corpo.aviso, /foto/i, 'deveria avisar que a foto não subiu');
    assert.ok(ctx.recebidos.some(r => r.metodo === 'POST'), 'a criação tem de permanecer');
  } finally {
    await ctx.encerrar();
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
