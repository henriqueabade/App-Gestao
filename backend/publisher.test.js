const test = require('node:test');
const assert = require('node:assert/strict');

const { createPublishProgressTracker } = require('./publisher');

test('progresso da publicação acompanha as etapas reais sem retroceder', () => {
  const events = [];
  const tracker = createPublishProgressTracker(event => events.push(event));

  tracker.report(10, 'Repositório validado');
  tracker.consume('packaging platform=win32 arch=x64');
  tracker.consume('building target=nsis');
  tracker.consume('uploading file=app.exe progress=50%');
  tracker.consume('mensagem tardia de empacotamento');

  assert.deepEqual(events.map(event => event.progress), [10, 20, 38, 77, 77]);
  assert.equal(tracker.getProgress(), 77);
});

test('progresso reportado pela ferramenta fica reservado abaixo de 100%', () => {
  const events = [];
  const tracker = createPublishProgressTracker(event => events.push(event));

  tracker.consume('uploading 100%');

  assert.equal(events.at(-1).progress, 98);
});

// ---------------------------------------------------------------------------
// Como o electron-builder é iniciado (o "spawn EINVAL" do Electron 45)
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const trava = require('./travaPublicacao');

test('o caminho antigo (.cmd sem shell) é recusado pelo Node atual no Windows: era o spawn EINVAL', { skip: process.platform !== 'win32' && 'só no Windows' }, () => {
  // Node 18.20.2+/20.12.2+ (CVE-2024-27980): .cmd/.bat sem shell lança EINVAL na
  // hora, exista o arquivo ou não. O Electron 45 traz o Node 24.
  assert.throws(() => childProcess.spawn('npx.cmd', ['--version'], { stdio: 'ignore' }), err => err.code === 'EINVAL');
});

test('o electron-builder roda pelo cli.js com o Node de verdade, sem shell, e responde', () => {
  const { resolverElectronBuilder } = require('./publisher');
  const b = resolverElectronBuilder();
  assert.match(b.args[0], /electron-builder[\\/]cli\.js$/);
  assert.ok(fs.existsSync(b.args[0]));
  assert.deepEqual(b.env, {});
  assert.ok(path.isAbsolute(b.command), 'caminho absoluto, sem depender do shell achar o programa');
  assert.ok(!/\.(cmd|bat)$/i.test(b.command), 'nunca .cmd/.bat (o EINVAL)');
  if (process.versions.electron) {
    // Dentro do Electron, NÃO o próprio executável: o yargs leria o cli.js como argumento.
    assert.notEqual(b.command, process.execPath);
    assert.match(path.basename(b.command), /^node(\.exe)?$/i);
  } else {
    assert.equal(b.command, process.execPath);
  }
  const r = childProcess.spawnSync(b.command, [...b.args, '--version'], { env: { ...process.env, ...b.env }, encoding: 'utf8', timeout: 60000, windowsHide: true });
  assert.equal(r.error, undefined, r.error && r.error.message);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

/** .env temporário: os testes nunca leem o .env real nem o seu token. */
function envTemporario(conteudo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publicador-'));
  const arquivo = path.join(dir, '.env');
  fs.writeFileSync(arquivo, conteudo);
  return arquivo;
}

/**
 * Publicador carregado de novo com o spawn, o https e o log trocados por
 * dublês: nada sai para o GitHub, nenhum processo abre, o publish-audit.log
 * real não recebe linha de teste.
 */
function publicadorComDubles(t, { statusDoGithub = 200, saida = [], codigo = 0 } = {}) {
  const chamadas = { spawn: [], github: 0 };
  t.mock.method(fs, 'appendFile', (_arq, _txt, cb) => { if (typeof cb === 'function') cb(null); });
  t.mock.method(https, 'request', (_opcoes, aoResponder) => {
    chamadas.github += 1;
    return {
      on() { return this; },
      setTimeout() { return this; },
      destroy() {},
      end() { setImmediate(() => aoResponder({ statusCode: statusDoGithub, resume() {} })); }
    };
  });
  t.mock.method(childProcess, 'spawn', (comando, args, opcoes) => {
    chamadas.spawn.push({ comando, args, opcoes });
    const filho = new EventEmitter();
    filho.stdout = new EventEmitter();
    filho.stderr = new EventEmitter();
    setImmediate(() => {
      for (const [canal, texto] of saida) filho[canal].emit('data', Buffer.from(texto));
      filho.emit('close', codigo);
    });
    return filho;
  });
  const caminho = require.resolve('./publisher');
  delete require.cache[caminho];
  const publicador = require('./publisher');
  t.after(() => { delete require.cache[caminho]; });
  return { publicador, chamadas };
}

const ENV_OK = 'BANCO=PROD\nGH_TOKEN=token-de-teste\n';

test('publicação: electron-builder pelo cli.js, --publish always, token novo, sem shell, progresso até o fim', async t => {
  const { publicador, chamadas } = publicadorComDubles(t, {
    saida: [['stdout', '• packaging platform=win32 arch=x64\n'], ['stdout', '• building target=nsis\n'], ['stdout', '• uploading progress=50%\n']]
  });
  const progresso = [];
  const r = await publicador.runPublishPipeline({ version: '9.9.9', caminhoEnv: envTemporario(ENV_OK), onProgress: e => { if (e.progress) progresso.push(e.progress); } });
  assert.deepEqual(r, { code: 0 });
  assert.equal(chamadas.github, 1, 'o token é conferido antes');
  assert.equal(chamadas.spawn.length, 1);
  const { comando, args, opcoes } = chamadas.spawn[0];
  assert.equal(comando, publicador.resolverElectronBuilder().command);
  assert.match(args[0], /electron-builder[\\/]cli\.js$/);
  assert.deepEqual(args.slice(1), ['--config', 'electron-builder.config.js', '--publish', 'always']);
  assert.ok(!opcoes.shell, 'sem shell');
  assert.equal(opcoes.env.GH_TOKEN, 'token-de-teste');
  assert.equal(opcoes.env.GITHUB_TOKEN, 'token-de-teste');
  assert.equal(opcoes.env.TARGET_VERSION, '9.9.9');
  assert.equal(opcoes.windowsHide, true);
  assert.ok(progresso.length >= 4 && progresso.every((p, i) => i === 0 || p >= progresso[i - 1]), `progresso: ${progresso}`);
  assert.equal(publicador.isPublishing(), false);
});

for (const [saida, esperado] of [
  ['HttpError: 401 Unauthorized\n"Bad credentials"', /401/],
  ['HttpError: 403 Forbidden "Resource not accessible by personal access token"', /403/],
  ['HttpError: 404 Not Found', /404/]
]) {
  test(`falha do electron-builder vira mensagem clara: ${esperado}`, async t => {
    const { publicador } = publicadorComDubles(t, { saida: [['stderr', saida]], codigo: 1 });
    await assert.rejects(publicador.runPublishPipeline({ caminhoEnv: envTemporario(ENV_OK) }), err => esperado.test(err.message) && err.code === 'publish-failed');
    assert.equal(publicador.isPublishing(), false);
  });
}

for (const [status, esperado] of [[401, /401/], [403, /403/], [404, /404/]]) {
  test(`token recusado pelo GitHub (${status}) para ANTES de abrir processo`, async t => {
    const { publicador, chamadas } = publicadorComDubles(t, { statusDoGithub: status });
    await assert.rejects(publicador.runPublishPipeline({ caminhoEnv: envTemporario(ENV_OK) }), esperado);
    assert.equal(chamadas.spawn.length, 0);
  });
}

for (const [nome, preparar, codigo] of [
  ['programa em DEV com o .env em PROD', () => { process.env.BANCO = 'DEV'; }, trava.CODIGO],
  ['máquina DEV isolada', () => { process.env.APP_GESTAO_AMBIENTE_ISOLADO = '1'; }, trava.CODIGO_ISOLADO],
  ['.env em DEV', () => {}, trava.CODIGO]
]) {
  test(`bloqueio de publicação: ${nome} — nada vai ao GitHub, nenhum processo abre`, async t => {
    const antes = { BANCO: process.env.BANCO, ISO: process.env.APP_GESTAO_AMBIENTE_ISOLADO };
    t.after(() => {
      if (antes.BANCO === undefined) delete process.env.BANCO; else process.env.BANCO = antes.BANCO;
      if (antes.ISO === undefined) delete process.env.APP_GESTAO_AMBIENTE_ISOLADO; else process.env.APP_GESTAO_AMBIENTE_ISOLADO = antes.ISO;
    });
    const { publicador, chamadas } = publicadorComDubles(t);
    preparar();
    const env = nome === '.env em DEV' ? 'BANCO=DEV\nGH_TOKEN=token-de-teste\n' : ENV_OK;
    await assert.rejects(publicador.runPublishPipeline({ caminhoEnv: envTemporario(env) }), err => err.code === codigo);
    assert.equal(chamadas.github, 0, 'o token não pode ser conferido');
    assert.equal(chamadas.spawn.length, 0, 'nenhum processo pode abrir');
    assert.ok(publicador.verificarAmbienteDePublicacao(envTemporario(env)), 'o botão também bloqueia');
  });
}
