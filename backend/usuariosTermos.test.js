/**
 * Termos de Uso e Política de Privacidade (02/10/2026, pedido do dono) e as
 * travas das rotas de usuários.
 *
 *  - "Aceito" = aceitou a versão vigente dos dois documentos; o resto é
 *    "Pendente". A caixa de aceite só aparece com o pedido do Sup Admin.
 *  - Cada aceite/recusa vira uma linha por documento, com a versão e o sha256
 *    do texto; o texto da versão fica guardado. Recusar desativa (não exclui).
 *  - Sem o SQL (ou sem reiniciar a API) nada "grava no vazio": responde 409.
 *  - Rotas de usuários: nada de hash de senha para a tela, lista reduzida
 *    para quem não tem o módulo, e ninguém se promove a Sup Admin.
 */
process.env.NODE_ENV = 'test';
process.env.BANCO = 'DEV';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const termos = require('./termosDeUso');
const Documentos = require('../src/js/utils/termos-documentos');

/** Troca um módulo no cache do require e devolve como desfazer. */
function trocar(caminho, exportsFalsos) {
  const id = require.resolve(caminho);
  const antes = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsFalsos };
  return () => { if (antes) require.cache[id] = antes; else delete require.cache[id]; };
}

const VIGENTES = termos.versoesVigentes();
const ACEITO = {
  termos_versao: VIGENTES.termos_de_uso,
  privacidade_versao: VIGENTES.politica_de_privacidade,
  termos_aceitos_em: '2026-10-02T12:00:00.000Z'
};

/** Um /api genérico de mentira: usuarios, termos_versoes, aceites, notificacoes e /api/tabelas. */
function apiFalsa({ semSql = false, usuarios } = {}) {
  const dados = {
    usuarios: usuarios || [
      { id: 2, nome: 'Henrique', email: 'h@x.com', perfil: 'Sup Admin', status: 'ativo', senha: '$2b$12$hashdohenrique', confirmacao_token: 'segredo', ultimo_login: '2026-10-01T10:00:00Z' },
      { id: 3, nome: 'Iara', email: 'i@x.com', perfil: 'Sup Admin', status: 'ativo', senha: '$2b$12$hashdaiara' },
      { id: 7, nome: 'Ana', email: 'ana@x.com', perfil: 'Comercial', status: 'ativo', senha: '$2b$12$hashdaana', ultimo_login: '2026-10-02T09:00:00Z' }
    ],
    termos_versoes: [],
    usuarios_termos_aceites: [],
    notificacoes: []
  };
  const chamadas = [];
  const achar = id => dados.usuarios.find(u => String(u.id) === String(id));
  return {
    dados, chamadas,
    async get(caminho, { query } = {}) {
      chamadas.push(['GET', caminho]);
      if (caminho === '/api/tabelas') {
        const tabelas = [{ tabela: 'usuarios', colunas: ['id', 'nome', 'status', ...(semSql ? [] : termos.COLUNAS)] }];
        if (!semSql) tabelas.push({ tabela: 'termos_versoes', colunas: ['id'] }, { tabela: 'usuarios_termos_aceites', colunas: ['id'] });
        return { tabelas };
      }
      if (caminho === '/api/usuarios') return dados.usuarios.map(u => ({ ...u }));
      if (caminho === '/api/modelos_permissoes') return [];
      if (caminho === '/api/avisos_dispositivos') return [];
      if (caminho === '/api/termos_versoes') {
        return dados.termos_versoes.filter(l => l.documento === query?.documento && l.versao === query?.versao);
      }
      const m = caminho.match(/^\/api\/usuarios\/(\d+)$/);
      if (m) {
        const u = achar(m[1]);
        if (!u) throw Object.assign(new Error('não encontrado'), { status: 404 });
        return { ...u };
      }
      throw new Error(`GET inesperado: ${caminho}`);
    },
    async post(caminho, corpo) {
      chamadas.push(['POST', caminho, corpo]);
      const tabela = caminho.replace('/api/', '');
      if (!dados[tabela]) throw new Error(`POST inesperado: ${caminho}`);
      const linha = { id: dados[tabela].length + 1, ...corpo };
      dados[tabela].push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      chamadas.push(['PUT', caminho, corpo]);
      const u = achar(caminho.replace('/api/usuarios/', ''));
      if (!u) throw Object.assign(new Error('não encontrado'), { status: 404 });
      Object.assign(u, corpo);
      return { ...u };
    }
  };
}

/** Sobe o router de usuários com a API de mentira. `pode`: as permissões de quem chama. */
async function servidor({ quem = 7, supAdmin = false, pode = [], semSql = false, usuarios } = {}) {
  const api = apiFalsa({ semSql, usuarios });
  termos.esquecerEsquema();
  termos.esquecerAguardando();
  const acoesDe = prefixo => Object.fromEntries(pode.filter(c => c.startsWith(prefixo)).map(chave => [chave, true]));
  const permissoes = {
    usuarios: { ativo: pode.some(c => c.startsWith('usuarios.')), acoes: acoesDe('usuarios.') },
    rel: { ativo: pode.includes('rel.view'), acoes: acoesDe('rel.') }
  };
  const negar = (res, corpo) => res.status(403).json(corpo);
  const desfazer = [
    trocar('./apiHttpClient', { ...require('./apiHttpClient'), createApiClient: () => api }),
    trocar('./permissionsController', {
      exigirSupAdmin: (_req, res, next) => (supAdmin ? next() : negar(res, { error: 'Ação restrita ao Sup Admin', code: 'FORBIDDEN_SUP_ADMIN' })),
      exigirPermissao: chave => (_req, res, next) => (supAdmin || pode.includes(chave) ? next() : negar(res, { error: 'Permissão negada', code: 'FORBIDDEN', permissao: chave })),
      obterPermissoesEfetivas: async () => (supAdmin
        ? { usuarios: { ativo: true, acoes: { 'usuarios.view': true } } }
        : permissoes),
      limparCachePermissoes: () => {}
    })
  ];
  delete require.cache[require.resolve('./usuariosController')];
  const router = require('./usuariosController');
  const app = express();
  app.use(express.json());
  app.use('/api', termos.travaDoAceite(require('./usuarioAtual').usuarioDaRequisicao));
  app.use('/api/usuarios', router);
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}/api/usuarios`;
  // usuarioAtual lê o id de um JWT: monta um de mentira (sem assinatura).
  const jwt = `x.${Buffer.from(JSON.stringify({ id: quem })).toString('base64url')}.y`;
  const pedir = async (metodo, caminho, corpo) => {
    const r = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    return { status: r.status, corpo: await r.json() };
  };
  return {
    api, pedir,
    fechar: async () => {
      await new Promise(r => srv.close(r));
      desfazer.forEach(d => d());
      delete require.cache[require.resolve('./usuariosController')];
      termos.esquecerEsquema();
      termos.esquecerAguardando();
    }
  };
}

// ---------------------------------------------------------------------------
// Os documentos e as regras puras
// ---------------------------------------------------------------------------

test('os dois documentos têm versão, vigência e o que a lei e o dono pedem', () => {
  assert.deepStrictEqual(Documentos.ORDEM, ['termos_de_uso', 'politica_de_privacidade']);
  for (const chave of Documentos.ORDEM) {
    const doc = Documentos.documento(chave);
    assert.match(doc.versao, /^\d+\.\d+$/);
    assert.match(doc.vigencia, /^\d{2}\/\d{2}\/\d{4}$/);
    assert.ok(doc.secoes.length >= 8, `${chave} com seções de menos`);
    const texto = Documentos.textoPlano(chave);
    assert.ok(texto.startsWith(`${doc.titulo}\nVersão ${doc.versao}`), 'o texto corrido começa pelo título e pela versão');
    assert.ok(!texto.includes('undefined') && !texto.includes('[object'), 'sem sobra de montagem');
    assert.strictEqual(texto, Documentos.textoPlano(chave), 'sempre o mesmo texto para o mesmo conteúdo');
  }
  const uso = Documentos.textoPlano('termos_de_uso');
  const priv = Documentos.textoPlano('politica_de_privacidade');
  // O que o dono pediu que constasse: os avisos e o registro do que é feito.
  for (const trecho of ['janela no canto da tela do Windows', 'registrada com o seu nome', 'Online', 'Ausente', 'Login bloqueado. Contate o administrador.', 'o acesso desativado']) {
    assert.ok(uso.includes(trecho), `Termos de Uso sem "${trecho}"`);
  }
  // O mínimo da LGPD: controlador, canal, finalidades e bases, compartilhamento, prazo, direitos, ANPD.
  for (const trecho of ['controladora', 'Lei nº 13.709/2018', 'art. 7º', 'art. 18', 'ANPD', 'transferência internacional', 'Por quanto tempo', Documentos.CONTROLADOR.contato, Documentos.CONTROLADOR.cnpj]) {
    assert.ok(priv.includes(trecho), `Política de Privacidade sem "${trecho}"`);
  }
});

test('vigentes: uma impressão digital (sha256) por documento, tirada do texto corrido', () => {
  const lista = termos.vigentes();
  assert.deepStrictEqual(lista.map(v => v.documento), Documentos.ORDEM);
  for (const v of lista) {
    assert.match(v.hash_sha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(v.hash_sha256, termos.sha256(Documentos.textoPlano(v.documento)));
    assert.strictEqual(v.versao, Documentos.documento(v.documento).versao);
  }
  assert.notStrictEqual(lista[0].hash_sha256, lista[1].hash_sha256);
});

test('aceito só com a versão vigente dos DOIS documentos; a caixa só aparece com o pedido do Sup Admin', () => {
  assert.strictEqual(termos.aceitou(ACEITO), true);
  assert.strictEqual(termos.aceitou({ ...ACEITO, privacidade_versao: '0.9' }), false, 'versão antiga de um deles = pendente');
  assert.strictEqual(termos.aceitou({ ...ACEITO, termos_aceitos_em: null }), false);
  assert.strictEqual(termos.aceitou({}), false, 'usuário antigo = pendente');

  assert.strictEqual(termos.precisaAceitar({}), false, 'pendente sem pedido: não barra');
  assert.strictEqual(termos.precisaAceitar({ termos_solicitados_em: '2026-10-02T10:00:00Z' }), true);
  assert.strictEqual(termos.precisaAceitar({ ...ACEITO, termos_solicitados_em: '2026-10-02T10:00:00Z' }), false, 'já aceitou: não barra');

  assert.deepStrictEqual(
    termos.situacaoDe({ termos_solicitados_em: '2026-10-02T10:00:00Z', termos_recusados_em: '2026-10-02T11:00:00Z' }),
    { termos_situacao: 'pendente', termos_solicitado: true, termos_aceitos_em: null, termos_solicitados_em: '2026-10-02T10:00:00Z', termos_recusados_em: '2026-10-02T11:00:00Z', termos_versao: null, privacidade_versao: null }
  );
  const ok = termos.situacaoDe(ACEITO);
  assert.strictEqual(ok.termos_situacao, 'aceito');
  assert.strictEqual(ok.termos_solicitado, false);

  assert.doesNotThrow(() => termos.conferirVersoes(VIGENTES));
  assert.throws(() => termos.conferirVersoes({ termos_de_uso: VIGENTES.termos_de_uso }), e => e.status === 409 && e.code === 'TERMOS_VERSAO');
  assert.throws(() => termos.conferirVersoes(null), e => e.status === 409);
});

test('registrar: guarda o texto da versão uma vez, uma linha por documento e o resumo no usuário', async () => {
  termos.esquecerEsquema();
  const api = apiFalsa();
  const usuario = { id: 7, nome: 'Ana', email: 'ana@x.com', termos_solicitados_em: '2026-10-02T10:00:00Z', termos_solicitados_por: 2 };
  const campos = await termos.registrar(api, usuario, { decisao: 'aceito', agora: new Date('2026-10-02T15:00:00Z') });

  assert.strictEqual(api.dados.termos_versoes.length, 2);
  assert.ok(api.dados.termos_versoes.every(v => v.texto.length > 2000 && v.hash_sha256 === termos.sha256(v.texto)));
  assert.deepStrictEqual(
    api.dados.usuarios_termos_aceites.map(a => [a.usuario_id, a.documento, a.versao, a.decisao, a.origem, a.solicitado_por, a.usuario_email]),
    [[7, 'termos_de_uso', VIGENTES.termos_de_uso, 'aceito', 'solicitacao', 2, 'ana@x.com'],
      [7, 'politica_de_privacidade', VIGENTES.politica_de_privacidade, 'aceito', 'solicitacao', 2, 'ana@x.com']]
  );
  assert.ok(api.dados.usuarios_termos_aceites.every(a => /^[a-f0-9]{64}$/.test(a.hash_sha256)));
  assert.deepStrictEqual(campos, {
    termos_versao: VIGENTES.termos_de_uso, privacidade_versao: VIGENTES.politica_de_privacidade,
    termos_aceitos_em: '2026-10-02T15:00:00.000Z', termos_solicitados_em: null, termos_recusados_em: null
  });
  assert.strictEqual(termos.aceitou(api.dados.usuarios.find(u => u.id === 7)), true);

  // Outro aceite: o texto da versão já está guardado e não é gravado de novo.
  await termos.registrar(api, { id: 3, nome: 'Iara', email: 'i@x.com' }, { decisao: 'aceito' });
  assert.strictEqual(api.dados.termos_versoes.length, 2);
  assert.strictEqual(api.dados.usuarios_termos_aceites.length, 4);
  termos.esquecerEsquema();
});

test('recusar desativa sem excluir e mantém o pedido de pé; versão igual com texto diferente é erro', async () => {
  termos.esquecerEsquema();
  const api = apiFalsa();
  const campos = await termos.registrar(api, { id: 7, nome: 'Ana', termos_solicitados_em: '2026-10-02T10:00:00Z' }, { decisao: 'recusado', agora: new Date('2026-10-02T16:00:00Z') });
  assert.deepStrictEqual(campos, { termos_recusados_em: '2026-10-02T16:00:00.000Z', status: 'aguardando_aprovacao' });
  const ana = api.dados.usuarios.find(u => u.id === 7);
  assert.strictEqual(ana.status, 'aguardando_aprovacao');
  assert.strictEqual(api.dados.usuarios.length, 3, 'ninguém é excluído');
  assert.ok(api.dados.usuarios_termos_aceites.every(a => a.decisao === 'recusado'));
  assert.strictEqual(termos.precisaAceitar({ ...ana, termos_solicitados_em: '2026-10-02T10:00:00Z' }), true, 'reativada, a pessoa vê a caixa de novo');

  const adulterada = apiFalsa();
  adulterada.dados.termos_versoes.push({ documento: 'termos_de_uso', versao: VIGENTES.termos_de_uso, hash_sha256: 'f'.repeat(64) });
  await assert.rejects(termos.registrar(adulterada, { id: 7 }, { decisao: 'aceito' }), e => e.status === 409 && e.code === 'TERMOS_TEXTO');
  assert.strictEqual(adulterada.dados.usuarios_termos_aceites.length, 0, 'nada é gravado com o texto divergente');

  await assert.rejects(termos.registrar(api, { id: 7 }, { decisao: 'talvez' }), e => e.status === 400);
  termos.esquecerEsquema();
});

test('sem o SQL (ou sem reiniciar a API) nada grava no vazio: 409 dizendo o que fazer', async () => {
  termos.esquecerEsquema();
  const api = apiFalsa({ semSql: true });
  assert.strictEqual(await termos.temEsquema(api), false);
  await assert.rejects(termos.registrar(api, { id: 7 }, { decisao: 'aceito' }), e => e.status === 409 && e.code === 'TERMOS_SQL' && e.message === termos.SEM_SQL);
  await assert.rejects(termos.solicitar(api, { id: 7 }, 2), e => e.status === 409);
  assert.strictEqual(api.chamadas.filter(c => c[0] !== 'GET').length, 0);
  termos.esquecerEsquema();
  assert.strictEqual(await termos.temEsquema(apiFalsa()), true);
  termos.esquecerEsquema();
});

test('trava do backend: só quem está com a caixa na tela é barrado, e só fora das rotas da caixa', () => {
  termos.esquecerAguardando();
  const trava = termos.travaDoAceite(req => req.quem);
  const passar = (quem, caminho) => {
    let resultado = 'passou';
    trava({ quem, path: caminho }, { status: codigo => ({ json: corpo => { resultado = [codigo, corpo.code]; } }) }, () => {});
    return resultado;
  };
  assert.strictEqual(passar(7, '/pedidos'), 'passou', 'ninguém aguardando: nada muda');
  termos.marcarAguardando(7, true);
  assert.deepStrictEqual(passar(7, '/pedidos'), [423, 'TERMOS_PENDENTES']);
  assert.deepStrictEqual(passar(7, '/usuarios/lista'), [423, 'TERMOS_PENDENTES']);
  assert.deepStrictEqual(passar(7, '/usuarios/me/preferencias-menu'), [423, 'TERMOS_PENDENTES']);
  for (const livre of ['/usuarios/me', '/usuarios/me/termos', '/usuarios/me/termos/aceitar', '/usuarios/me/termos/recusar', '/permissoes/efetivas']) {
    assert.strictEqual(passar(7, livre), 'passou', `${livre} é da própria caixa`);
  }
  assert.strictEqual(passar(8, '/pedidos'), 'passou', 'outro usuário não é barrado');
  termos.marcarAguardando(7, false);
  assert.strictEqual(passar(7, '/pedidos'), 'passou');
});

// ---------------------------------------------------------------------------
// As rotas
// ---------------------------------------------------------------------------

test('pedido do Sup Admin → a caixa aparece → aceitar grava e libera', async () => {
  const s = await servidor({ quem: 7 });
  try {
    let r = await s.pedir('GET', '/me/termos');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.pendente, false, 'pendente sem pedido: o programa segue normal');
    assert.strictEqual(r.corpo.termos_situacao, 'pendente');
    assert.deepStrictEqual(r.corpo.documentos, VIGENTES);
    // A primeira sessão aberta guarda o texto das versões: é o que libera o
    // cadastro da tela de login (anônimo, só aceita versão já registrada).
    assert.deepStrictEqual(s.api.dados.termos_versoes.map(v => [v.documento, v.versao]), [['termos_de_uso', VIGENTES.termos_de_uso], ['politica_de_privacidade', VIGENTES.politica_de_privacidade]]);
    await s.pedir('GET', '/me/termos');
    assert.strictEqual(s.api.dados.termos_versoes.length, 2, 'uma vez só');

    // Quem não é Sup Admin não pede o aceite de ninguém.
    r = await s.pedir('POST', '/7/termos/solicitar');
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.corpo.code, 'FORBIDDEN_SUP_ADMIN');

    Object.assign(s.api.dados.usuarios.find(u => u.id === 7), { termos_solicitados_em: '2026-10-02T10:00:00Z', termos_solicitados_por: 2 });
    r = await s.pedir('GET', '/me/termos');
    assert.strictEqual(r.corpo.pendente, true);
    assert.strictEqual(r.corpo.termos_solicitado, true);

    // Com a caixa na tela, o resto do /api fica fechado para ela.
    r = await s.pedir('GET', '/lista');
    assert.strictEqual(r.status, 423);
    assert.strictEqual(r.corpo.code, 'TERMOS_PENDENTES');

    r = await s.pedir('POST', '/me/termos/aceitar', { documentos: { termos_de_uso: '0.1', politica_de_privacidade: VIGENTES.politica_de_privacidade } });
    assert.strictEqual(r.status, 409, 'versão que não é a vigente não é aceita');
    assert.strictEqual(s.api.dados.usuarios_termos_aceites.length, 0);

    r = await s.pedir('POST', '/me/termos/aceitar', { documentos: VIGENTES });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.termos_situacao, 'aceito');
    assert.strictEqual(s.api.dados.usuarios_termos_aceites.length, 2);
    assert.strictEqual(s.api.dados.usuarios.find(u => u.id === 7).termos_solicitados_em, null);

    r = await s.pedir('GET', '/me/termos');
    assert.strictEqual(r.corpo.pendente, false);
    r = await s.pedir('GET', '/lista');
    assert.strictEqual(r.status, 200, 'aceito: o programa volta ao normal');

    r = await s.pedir('POST', '/me/termos/recusar');
    assert.strictEqual(r.status, 409, 'quem já aceitou não recusa por aqui');
  } finally { await s.fechar(); }
});

test('POST /:id/termos/solicitar: só o Sup Admin, só com os termos pendentes', async () => {
  const s = await servidor({ quem: 2, supAdmin: true });
  try {
    let r = await s.pedir('POST', '/7/termos/solicitar');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.termos_situacao, 'pendente');
    assert.strictEqual(r.corpo.termos_solicitado, true);
    const ana = s.api.dados.usuarios.find(u => u.id === 7);
    assert.ok(ana.termos_solicitados_em);
    assert.strictEqual(ana.termos_solicitados_por, 2);
    assert.strictEqual(ana.status, 'ativo', 'pedir o aceite não mexe no acesso');

    Object.assign(s.api.dados.usuarios.find(u => u.id === 3), ACEITO);
    r = await s.pedir('POST', '/3/termos/solicitar');
    assert.strictEqual(r.status, 409, 'já aceitou a versão atual: nada a pedir');

    r = await s.pedir('POST', '/99/termos/solicitar');
    assert.strictEqual(r.status, 404);
  } finally { await s.fechar(); }

  const semSql = await servidor({ quem: 2, supAdmin: true, semSql: true });
  try {
    const r = await semSql.pedir('POST', '/7/termos/solicitar');
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.corpo.code, 'TERMOS_SQL');
    const lista = await semSql.pedir('GET', '/lista');
    assert.ok(lista.corpo.every(u => u.termos_situacao === 'indisponivel'), 'sem o SQL a coluna diz que falta rodar');
  } finally { await semSql.fechar(); }
});

test('recusar: desativa, avisa os outros Sup Admins e não deixa o único Sup Admin se trancar para fora', async () => {
  const s = await servidor({ quem: 7 });
  try {
    Object.assign(s.api.dados.usuarios.find(u => u.id === 7), { termos_solicitados_em: '2026-10-02T10:00:00Z' });
    const r = await s.pedir('POST', '/me/termos/recusar');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corpo.desativado, true);
    const ana = s.api.dados.usuarios.find(u => u.id === 7);
    assert.strictEqual(ana.status, 'aguardando_aprovacao');
    assert.ok(ana.termos_recusados_em);
    assert.deepStrictEqual(s.api.dados.usuarios_termos_aceites.map(a => a.decisao), ['recusado', 'recusado']);
    assert.deepStrictEqual(s.api.dados.notificacoes.map(n => [n.usuario_id, n.tipo, n.origem]), [[2, 'termos_recusados', 'usuario'], [3, 'termos_recusados', 'usuario']]);
    assert.ok(s.api.dados.notificacoes[0].mensagem.includes('Ana recusou os Termos de Uso'));
  } finally { await s.fechar(); }

  const unico = await servidor({
    quem: 2, supAdmin: true,
    usuarios: [
      { id: 2, nome: 'Henrique', perfil: 'Sup Admin', status: 'ativo', termos_solicitados_em: '2026-10-02T10:00:00Z' },
      { id: 3, nome: 'Iara', perfil: 'Sup Admin', status: 'aguardando_aprovacao' },
      { id: 7, nome: 'Ana', perfil: 'Comercial', status: 'ativo' }
    ]
  });
  try {
    const r = await unico.pedir('POST', '/me/termos/recusar');
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.corpo.code, 'UNICO_SUP_ADMIN');
    assert.strictEqual(unico.api.dados.usuarios.find(u => u.id === 2).status, 'ativo');
    assert.strictEqual(unico.api.dados.usuarios_termos_aceites.length, 0);
  } finally { await unico.fechar(); }
});

test('lista de usuários: nunca o hash da senha; sem o módulo, só o que o seletor precisa', async () => {
  const semModulo = await servidor({ quem: 7 });
  try {
    const r = await semModulo.pedir('GET', '/lista');
    assert.strictEqual(r.status, 200);
    // Sem o e-mail dos outros (decisão do dono, 09/10/2026); o próprio (7) continua.
    const outro = r.corpo.find(u => u.id !== 7);
    assert.deepStrictEqual(Object.keys(outro).sort(), ['id', 'nome', 'perfil', 'status']);
    const proprio = r.corpo.find(u => u.id === 7);
    if (proprio) assert.ok('email' in proprio, 'o próprio e-mail continua');
    assert.ok(!JSON.stringify(r.corpo).includes('hashd'), 'nada de senha');
    assert.ok(!JSON.stringify(r.corpo).includes('ultimo_login'), 'nem a atividade dos colegas');
  } finally { await semModulo.fechar(); }

  const comModulo = await servidor({ quem: 7, pode: ['usuarios.view'] });
  try {
    Object.assign(comModulo.api.dados.usuarios.find(u => u.id === 3), ACEITO);
    const r = await comModulo.pedir('GET', '/lista');
    const texto = JSON.stringify(r.corpo);
    assert.ok(!texto.includes('hashd') && !texto.includes('segredo'), 'nem com o módulo: senha e tokens ficam no backend');
    assert.strictEqual(r.corpo.find(u => u.id === 2).ultimo_login, '2026-10-01T10:00:00Z');
    assert.deepStrictEqual(r.corpo.map(u => [u.id, u.termos_situacao]), [[2, 'pendente'], [3, 'aceito'], [7, 'pendente']]);

    const eu = await comModulo.pedir('GET', '/me');
    assert.ok(!('senha' in eu.corpo), '/me sem a senha');
    const outro = await comModulo.pedir('GET', '/2');
    assert.strictEqual(outro.status, 200);
    assert.ok(!('senha' in outro.corpo) && !('confirmacao_token' in outro.corpo));
  } finally { await comModulo.fechar(); }

  const relatorios = await servidor({ quem: 7, pode: ['rel.view'] });
  try {
    const r = await relatorios.pedir('GET', '/lista');
    assert.ok('ultimo_login' in r.corpo.find(u => u.id === 2), 'o relatório de usuários continua com a atividade');
  } finally { await relatorios.fechar(); }
});

test('rotas de usuários: cada uma com a sua permissão, e ninguém se promove a Sup Admin', async () => {
  const comum = await servidor({ quem: 7 });
  try {
    for (const [metodo, caminho, corpo] of [
      ['PATCH', '/2/status', { status: 'inativo' }],
      ['PUT', '/2/dados', { nome: 'Outro' }],
      ['PUT', '/2', { nome: 'Outro' }],
      ['DELETE', '/2'],
      ['PUT', '/7/permissoes', { modeloPermissoesId: 1 }],
      ['GET', '/2'],
      ['GET', '/modelos-permissoes'],
      ['POST', '/modelos-permissoes', { nome: 'Tudo' }]
    ]) {
      const r = await comum.pedir(metodo, caminho, corpo);
      assert.strictEqual(r.status, 403, `${metodo} ${caminho} sem permissão`);
    }
    assert.strictEqual((await comum.pedir('GET', '/7')).status, 200, 'o próprio cadastro sempre pode ser lido');

    // /me aceita os dados pessoais e ignora perfil, permissões e acesso.
    const r = await comum.pedir('PUT', '/me', { nome: 'Ana Maria', perfil: 'Sup Admin', status: 'ativo', permissoes: { tudo: true } });
    assert.strictEqual(r.status, 200);
    const put = comum.api.chamadas.find(c => c[0] === 'PUT');
    assert.strictEqual(put[2].nome, 'Ana Maria');
    assert.ok(!('perfil' in put[2]) && !('status' in put[2]) && !('permissoes' in put[2]));
    assert.strictEqual(comum.api.dados.usuarios.find(u => u.id === 7).perfil, 'Comercial');
  } finally { await comum.fechar(); }

  const editor = await servidor({ quem: 7, pode: ['usuarios.view', 'usuarios.edit', 'usuarios.status.toggle'] });
  try {
    let r = await editor.pedir('PUT', '/7/dados', { perfil: 'Sup Admin' });
    assert.strictEqual(r.status, 403, 'editar usuários não dá para virar Sup Admin');
    assert.strictEqual(r.corpo.code, 'FORBIDDEN_SUP_ADMIN');
    r = await editor.pedir('PUT', '/2/dados', { nome: 'Henrique 2' });
    assert.strictEqual(r.status, 403, 'nem mexer no cadastro de um Sup Admin');
    r = await editor.pedir('PATCH', '/2/status', { status: 'inativo' });
    assert.strictEqual(r.status, 403, 'nem desativar um Sup Admin');
    r = await editor.pedir('PUT', '/7', { perfil: 'Sup Admin' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(editor.api.chamadas.filter(c => c[0] === 'PUT').length, 0, 'nada foi gravado');

    r = await editor.pedir('PUT', '/7/dados', { telefone: '31 99999-0000' });
    assert.strictEqual(r.status, 200, 'o que a permissão cobre continua funcionando');
  } finally { await editor.fechar(); }
});
