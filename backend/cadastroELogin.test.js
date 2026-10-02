/**
 * Cadastro pela tela de login e bloqueio de login (02/10/2026).
 *
 *  - O cadastro vai para a rota PÚBLICA /cadastro da API (sem token), levando
 *    o aceite dos Termos de Uso e da Política de Privacidade com o texto
 *    exato de cada documento. Antes ia para /api/usuarios, que exige token: em
 *    produção falhava e nenhum e-mail de confirmação saía.
 *  - Quem acerta a senha mas não está ativo recebe o mesmo recado — "Login
 *    bloqueado. Contate o administrador." — e nenhum token fica guardado,
 *    tanto com a API nova (recusa com 403) quanto com a antiga (o programa
 *    confere o status depois).
 *
 * Tudo contra uma API de mentira local: o tokenStore, o ./db e o modo do
 * banco são trocados antes de carregar o backend (nada toca a sessão real).
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function trocar(caminho, exportsFalsos) {
  const id = require.resolve(caminho);
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsFalsos };
}

/** Sobe a API de mentira e carrega o backend apontado para ela (modo produção). */
async function montar(rotas) {
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', parte => { corpo += parte; });
    req.on('end', () => {
      const dados = corpo ? JSON.parse(corpo) : null;
      pedidos.push({ metodo: req.method, caminho: req.url, corpo: dados, autorizacao: req.headers.authorization || null });
      const rota = rotas[`${req.method} ${req.url}`];
      const [status, resposta] = rota ? rota(dados) : [404, { error: 'Cannot ' + req.method }];
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resposta));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${srv.address().port}`;

  let guardado = null;
  trocar('./dataConfig', { isDev: false });
  trocar('./tokenStore', { setToken: t => { guardado = t; }, clearToken: () => { guardado = null; }, getToken: () => guardado });
  trocar('./db', { init() {} });
  for (const modulo of ['./apiHttpClient', './backend']) delete require.cache[require.resolve(modulo)];
  const backend = require('./backend');
  return { backend, pedidos, token: () => guardado, fechar: () => new Promise(r => srv.close(r)) };
}

const termos = require('./termosDeUso');
const VIGENTES = termos.versoesVigentes();

test('cadastro: vai para /cadastro sem token, com o aceite e o texto exato dos dois documentos', async () => {
  const m = await montar({ 'POST /cadastro': () => [201, { success: true, id: 9, emailEnviado: true, motivo: null }] });
  try {
    const r = await m.backend.registrarUsuario('Maria Souza', ' Maria@Loja.COM ', 'Senha@Forte1', VIGENTES);
    assert.deepStrictEqual(r, { success: true, id: 9, emailEnviado: true, motivo: null });
    assert.strictEqual(m.pedidos.length, 1);
    const p = m.pedidos[0];
    assert.strictEqual(`${p.metodo} ${p.caminho}`, 'POST /cadastro');
    assert.strictEqual(p.autorizacao, null, 'quem se cadastra ainda não tem token');
    assert.strictEqual(p.corpo.email, 'maria@loja.com');
    assert.strictEqual(p.corpo.senha, 'Senha@Forte1', 'quem faz o hash é a API');
    assert.deepStrictEqual(p.corpo.aceites.map(a => [a.documento, a.versao, a.aceito]), [
      ['termos_de_uso', VIGENTES.termos_de_uso, true],
      ['politica_de_privacidade', VIGENTES.politica_de_privacidade, true]
    ]);
    for (const a of p.corpo.aceites) {
      const vigente = termos.vigentes().find(v => v.documento === a.documento);
      assert.strictEqual(termos.sha256(a.texto), vigente.hash_sha256, 'o texto enviado é o que foi mostrado');
    }
    assert.ok(p.corpo.computador && p.corpo.versaoApp, 'o registro do aceite leva o computador e a versão do programa');
  } finally { await m.fechar(); }
});

test('cadastro: sem os dois aceites (ou com versão antiga) nem chega à API; senha fraca também não', async () => {
  const m = await montar({ 'POST /cadastro': () => [201, { success: true }] });
  try {
    for (const aceites of [undefined, null, {}, { termos_de_uso: VIGENTES.termos_de_uso }, { ...VIGENTES, politica_de_privacidade: '0.1' }]) {
      await assert.rejects(
        m.backend.registrarUsuario('Maria Souza', 'maria@loja.com', 'Senha@Forte1', aceites),
        /ler e aceitar os Termos de Uso e a Política de Privacidade/
      );
    }
    await assert.rejects(m.backend.registrarUsuario('Maria Souza', 'maria@loja.com', 'fraca', VIGENTES), /A senha precisa ter/);
    assert.strictEqual(m.pedidos.length, 0);
  } finally { await m.fechar(); }
});

test('cadastro: a recusa da API chega com a frase dela; API antiga (sem a rota) diz o que fazer', async () => {
  const repetido = await montar({ 'POST /cadastro': () => [409, { error: 'Já existe um cadastro com esse e-mail.' }] });
  try {
    await assert.rejects(repetido.backend.registrarUsuario('Maria Souza', 'maria@loja.com', 'Senha@Forte1', VIGENTES), /Já existe um cadastro com esse e-mail/);
  } finally { await repetido.fechar(); }

  const antiga = await montar({});
  try {
    await assert.rejects(antiga.backend.registrarUsuario('Maria Souza', 'maria@loja.com', 'Senha@Forte1', VIGENTES), /ainda não está disponível no servidor/);
  } finally { await antiga.fechar(); }
});

test('login: senha certa com acesso não ativo → "Login bloqueado. Contate o administrador." e nenhum token guardado', async () => {
  // API nova: recusa no próprio /login, sem emitir token.
  for (const codigo of ['inactive-user', 'unconfirmed-user']) {
    const nova = await montar({ 'POST /login': () => [403, { code: codigo, error: 'Login bloqueado. Contate o administrador.' }] });
    try {
      await assert.rejects(nova.backend.loginUsuario('ana@loja.com', 'Senha@Forte1'), erro => {
        assert.strictEqual(erro.message, 'Login bloqueado. Contate o administrador.');
        assert.strictEqual(erro.code, codigo);
        assert.strictEqual(erro.reason, undefined, 'não é erro de senha: não conta tentativa');
        return true;
      });
      assert.strictEqual(nova.token(), null);
    } finally { await nova.fechar(); }
  }

  // API antiga: entrega o token; o programa confere o status e descarta.
  for (const [status, codigo] of [['aguardando_aprovacao', 'inactive-user'], ['nao_confirmado', 'unconfirmed-user'], ['Inativo', 'inactive-user']]) {
    const antiga = await montar({
      'POST /login': () => [200, { token: 'x.eyJpZCI6N30.y', usuario: { id: 7, nome: 'Ana' } }],
      'GET /api/usuarios/7': () => [200, { id: 7, nome: 'Ana', email: 'ana@loja.com', status }]
    });
    try {
      await assert.rejects(antiga.backend.loginUsuario('ana@loja.com', 'Senha@Forte1'), erro => {
        assert.strictEqual(erro.message, 'Login bloqueado. Contate o administrador.', `o mesmo recado para "${status}"`);
        assert.strictEqual(erro.code, codigo);
        return true;
      });
      assert.strictEqual(antiga.token(), null, 'o token recebido é descartado');
    } finally { await antiga.fechar(); }
  }
});

test('login: usuário ativo entra normalmente e senha errada continua sendo erro de credencial', async () => {
  const ok = await montar({
    'POST /login': () => [200, { token: 'x.eyJpZCI6N30.y', usuario: { id: 7, nome: 'Ana' } }],
    'GET /api/usuarios/7': () => [200, { id: 7, nome: 'Ana', email: 'ana@loja.com', status: 'ativo', perfil: 'Comercial' }]
  });
  try {
    const usuario = await ok.backend.loginUsuario('ana@loja.com', 'Senha@Forte1');
    assert.strictEqual(usuario.id, 7);
    assert.strictEqual(usuario.perfil, 'Comercial');
    assert.strictEqual(ok.token(), 'x.eyJpZCI6N30.y');
  } finally { await ok.fechar(); }

  const errada = await montar({ 'POST /login': () => [401, { error: 'Senha incorreta' }] });
  try {
    await assert.rejects(errada.backend.loginUsuario('ana@loja.com', 'errada'), erro => erro.code === 'auth-failed' && erro.reason === 'user-auth');
  } finally { await errada.fechar(); }
});

test('main.js e a tela de login: o mesmo recado, em amarelo, para todo status diferente de ativo', () => {
  const raiz = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
  assert.ok(!main.includes('Login bloqueado pelo administrador'), 'o recado antigo saiu do main.js');
  assert.ok(!main.includes('Confirme seu e-mail para acessar'), 'não confirmado recebe o mesmo recado');
  assert.ok(main.includes("if (codigoDaApi === 'inactive-user') return 'admin-disabled';"), 'token recusado pela API = acesso revogado, não "token alterado"');
  assert.ok(main.includes("await registrarUsuario(dados.name, dados.email, dados.password, dados.aceites, {"));

  const login = fs.readFileSync(path.join(raiz, 'src/login/loginRenderer.js'), 'utf8');
  assert.ok(login.includes("const MENSAGEM_LOGIN_BLOQUEADO = 'Login bloqueado. Contate o administrador.';"));
  assert.ok(login.includes("showToast(MENSAGEM_LOGIN_BLOQUEADO, 'warning', 7000);"));
  const css = fs.readFileSync(path.join(raiz, 'src/login/login.css'), 'utf8');
  const amarelo = css.slice(css.indexOf('.toast-warning {'), css.indexOf('}', css.indexOf('.toast-warning {')));
  assert.ok(amarelo.includes('background-color: #facc15'), 'o aviso é amarelo');

  // Recusou os termos: a tela de login explica, e esse aviso vence o de "acesso revogado".
  assert.ok(login.includes("if (localStorage.getItem('termosRecusados')) {"));
  assert.ok(login.indexOf("localStorage.getItem('termosRecusados')") < login.indexOf("const admin = localStorage.getItem('adminDisabled');"));
  assert.ok(login.includes('Para utilizar o programa é necessário aceitar os termos'));
});
