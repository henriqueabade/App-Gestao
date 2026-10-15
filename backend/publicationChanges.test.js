const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { resolvePublicationReference } = require('./publicationChanges');

function repository(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'publicacao-pendentes-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Teste de publicação');
  git('config', 'user.email', 'publicacao@example.invalid');
  let sequence = 0;
  const commit = subject => {
    fs.writeFileSync(path.join(cwd, 'alteracao.txt'), String(++sequence));
    git('add', 'alteracao.txt');
    git('commit', '-q', '-m', subject);
    return git('rev-parse', 'HEAD');
  };
  const runGitCommand = async args => {
    try { return git(...args); } catch { return null; }
  };
  return { git, commit, runGitCommand };
}

function mainState(repo, initial = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = source.indexOf('async function collectPendingChangesSince(');
  const end = source.indexOf('\nensurePublishStateInitialized();', start);
  assert.ok(start > 0 && end > start);
  const context = {
    resolvePublicationReference,
    runGitCommand: repo.runGitCommand,
    getHeadCommitHash: async () => repo.git('rev-parse', 'HEAD'),
    getChangedFilesForCommit: async hash => repo.git('show', '--pretty=format:', '--name-only', hash).split('\n'),
    summarizeChangedFiles: files => files.join(', '),
    deriveSummaryFromSubject: subject => subject,
    publishState: {
      latestPublishedVersion: '2.9.5', lastPublishedCommit: null,
      lastPublishedCommitConfirmed: false, lastPublishedCommitVersion: null,
      pendingChanges: [], pendingChangesStatus: 'loading', pendingChangesMessage: null,
      ...initial
    },
    gitUnavailable: false,
    pendingChangesRefreshPromise: null,
    publishStateInitializationPromise: null,
    lastPendingChangesContext: { head: null, reference: null },
    DEBUG: false,
    console
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test('abrir uma árvore limpa detecta commits posteriores à publicação e corrige o cache legado de HEAD', async t => {
  const repo = repository(t);
  repo.commit('Base');
  const release = repo.commit('Publicação: versão 2.9.5');
  const first = repo.commit('Correção do pedido');
  const second = repo.commit('Melhora a auditoria');
  assert.equal(repo.git('status', '--porcelain'), '');
  const state = mainState(repo, { lastPublishedCommit: second });

  await state.ensurePublishStateInitialized();

  assert.equal(state.publishState.lastPublishedCommit, release);
  assert.equal(state.publishState.pendingChangesStatus, 'ready');
  assert.deepEqual(Array.from(state.publishState.pendingChanges, entry => entry.id), [second, first]);
  assert.equal(repo.git('status', '--porcelain'), '');
  assert.equal(repo.git('rev-parse', 'HEAD'), second);
});

test('a abertura sem cache usa a entrega conhecida e não publica nem marca HEAD como publicado', async t => {
  const repo = repository(t);
  const release = repo.commit('Publicação: versão 2.9.5');
  const head = repo.commit('Nova alteração ainda não publicada');
  const state = mainState(repo);
  await state.refreshPendingChanges({ force: true });
  await state.refreshPendingChanges({ force: true });
  assert.equal(state.publishState.lastPublishedCommit, release);
  assert.deepEqual(Array.from(state.publishState.pendingChanges, entry => entry.id), [head]);
});

test('mensagem de tentativa de versão nova não substitui a versão realmente publicada', async t => {
  const repo = repository(t);
  const release = repo.commit('Publicação: versão 2.9.5');
  repo.commit('Correção pendente');
  const attempt = repo.commit('Publicação: versão 2.9.6');
  const result = await resolvePublicationReference({ ...repo, version: '2.9.5', headCommit: attempt });
  assert.equal(result.commit, release);
});

test('tag da versão publicada prevalece sobre nova tentativa com mensagem repetida', async t => {
  const repo = repository(t);
  const release = repo.commit('Publicação: versão 2.9.5');
  repo.git('tag', '-a', 'v2.9.5', '-m', 'Entrega publicada');
  repo.commit('Correção pendente');
  const attempt = repo.commit('Publicação: versão 2.9.5');
  const result = await resolvePublicationReference({ ...repo, version: '2.9.5', headCommit: attempt });
  assert.equal(result.commit, release);
  assert.equal(result.source, 'release-tag');
});

test('cache só é confiável quando confirmado para a mesma versão e ancestral do HEAD', async t => {
  const repo = repository(t);
  const release = repo.commit('Publicação: versão 2.9.5');
  const next = repo.commit('Publicação: versão 2.9.6');
  const head = repo.commit('Correção após a nova entrega');
  const result = await resolvePublicationReference({
    ...repo, version: '2.9.6', headCommit: head,
    persistedCommit: release, persistedCommitConfirmed: true, persistedCommitVersion: '2.9.5'
  });
  assert.equal(result.commit, next);
  const confirmed = await resolvePublicationReference({
    ...repo, version: '2.9.6', headCommit: head,
    persistedCommit: next, persistedCommitConfirmed: true, persistedCommitVersion: '2.9.6'
  });
  assert.deepEqual(confirmed, { commit: next, source: 'confirmed-publication' });
});

test('nenhuma mudança desde a entrega confirmada produz estado pronto e vazio', async t => {
  const repo = repository(t);
  const head = repo.commit('Entrega confirmada pelo fluxo de publicação');
  const state = mainState(repo, {
    lastPublishedCommit: head, lastPublishedCommitConfirmed: true, lastPublishedCommitVersion: '2.9.5'
  });
  await state.ensurePublishStateInitialized();
  assert.equal(state.publishState.pendingChangesStatus, 'ready');
  assert.equal(state.publishState.pendingChanges.length, 0);
});

test('versão publicada retornada pelo servidor invalida confirmação de outra versão', async t => {
  const repo = repository(t);
  const previous = repo.commit('Publicação: versão 2.9.5');
  const next = repo.commit('Publicação: versão 2.9.6');
  const head = repo.commit('Alteração posterior à versão do servidor');
  const state = mainState(repo, {
    lastPublishedCommit: previous, lastPublishedCommitConfirmed: true, lastPublishedCommitVersion: '2.9.5'
  });
  state.updateService = {
    checkForUpdates: async () => {},
    getUpdateStatus: () => ({ status: 'update-available', latestVersion: '2.9.6' })
  };
  state.updateStatusCache = {};
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = source.indexOf('async function buildUpdateStatusPayload(');
  const end = source.indexOf('\nfunction broadcastPublishEvent(', start);
  vm.runInContext(source.slice(start, end), state);
  const result = await state.buildUpdateStatusPayload({ refresh: true });
  assert.equal(result.publishState.latestPublishedVersion, '2.9.6');
  assert.equal(result.publishState.lastPublishedCommit, next);
  assert.equal(result.publishState.lastPublishedCommitConfirmed, false);
  assert.equal(result.publishState.lastPublishedCommitVersion, null);
  assert.deepEqual(Array.from(result.publishState.pendingChanges, entry => entry.id), [head]);
});

test('sem referência ou com mensagens ambíguas, o estado permanece desconhecido', async t => {
  const repo = repository(t);
  const head = repo.commit('Mudança sem comprovação de publicação');
  const state = mainState(repo, { lastPublishedCommit: head });
  await state.ensurePublishStateInitialized();
  assert.equal(state.publishState.pendingChangesStatus, 'unknown');
  assert.equal(state.publishState.lastPublishedCommit, null);
  assert.match(state.publishState.pendingChangesMessage, /desconhecido/);
  repo.commit('Publicação: versão 2.9.5');
  repo.commit('Publicação: versão 2.9.5');
  await state.refreshPendingChanges({ force: true });
  assert.equal(state.publishState.pendingChangesStatus, 'unknown');
});

test('falha de git log não é convertida em lista vazia de publicações concluídas e pode ser recuperada', async t => {
  const repo = repository(t);
  repo.commit('Publicação: versão 2.9.5');
  const head = repo.commit('Correção ainda pendente');
  let fail = true;
  const state = mainState(repo);
  state.runGitCommand = async args => fail && args.includes('--date=iso-strict')
    ? null : repo.runGitCommand(args);
  await state.ensurePublishStateInitialized();
  assert.equal(state.publishState.pendingChangesStatus, 'error');
  assert.match(state.publishState.pendingChangesMessage, /consultar os commits/);
  fail = false;
  await state.refreshPendingChanges();
  assert.equal(state.publishState.pendingChangesStatus, 'ready');
  assert.deepEqual(Array.from(state.publishState.pendingChanges, entry => entry.id), [head]);
});

function menuState(publishState) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'menu.js'), 'utf8');
  const availability = source.slice(source.indexOf('    function computePublishAvailability()'), source.indexOf('    function setSupAdminIcon('));
  const click = source.slice(source.indexOf('    async function handleSupAdminTriggerClick('), source.indexOf('    async function handleSupAdminPublish('));
  const dialogs = [];
  const state = {
    publishState, updateStatus: {},
    supAdmin: { mode: 'idle', panelOpen: false }
  };
  const context = {
    state, window: {},
    runAutomaticCheck: async () => ({}),
    setSupAdminMode: (mode, options) => Object.assign(state.supAdmin, { mode }, options),
    showStandardDialog: async options => dialogs.push(options)
  };
  vm.createContext(context);
  vm.runInContext(availability + click, context);
  context.dialogs = dialogs;
  return context;
}

test('botão abre a publicação para commits novos mesmo quando a versão local é igual à publicada', async () => {
  const menu = menuState({
    canPublish: true, pendingChangesStatus: 'ready', pendingChanges: [{ id: 'novo-commit' }],
    localVersion: '2.9.5', latestPublishedVersion: '2.9.5'
  });
  assert.equal(menu.computePublishAvailability(), true);
  await menu.handleSupAdminTriggerClick({ button: 0 });
  assert.equal(menu.state.supAdmin.mode, 'available');
  assert.equal(menu.state.supAdmin.panelOpen, true);
  assert.equal(menu.dialogs.length, 0);
});

test('botão mostra erro de verificação em vez de afirmar que tudo foi publicado', async () => {
  const menu = menuState({
    canPublish: true, pendingChangesStatus: 'unknown', pendingChanges: [],
    pendingChangesMessage: 'Referência de publicação desconhecida.'
  });
  assert.equal(menu.computePublishAvailability(), false);
  await menu.handleSupAdminTriggerClick({ button: 0 });
  assert.equal(menu.dialogs[0].message, 'Referência de publicação desconhecida.');
  assert.equal(menu.dialogs[0].variant, 'error');
});

test('falha silenciosa de atualização não usa cache vazio para afirmar que tudo foi publicado', async () => {
  const menu = menuState({ canPublish: true, pendingChangesStatus: 'ready', pendingChanges: [] });
  vm.runInContext('runAutomaticCheck = async () => null', menu);
  await menu.handleSupAdminTriggerClick({ button: 0 });
  assert.match(menu.dialogs[0].message, /Não foi possível verificar/);
  assert.equal(menu.dialogs[0].variant, 'error');
});
