// Testa o bloqueio de login por status, com upstream simulado.
const http = require('http');
process.env.API_BASE_URL = 'http://localhost:4500';

const ROOT = require('path').resolve(__dirname, '..');
const { loginUsuario, isPinError, isNetworkError } = require(ROOT + '/backend/backend.js');
const tokenStore = require(ROOT + '/backend/tokenStore.js');

let statusDoUsuario = 'ativo';

const srv = http.createServer((req, res) => {
  let d = '';
  req.on('data', c => (d += c));
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/login') {
      return res.end(JSON.stringify({ token: 'tok-123', usuario: { id: 7 } }));
    }
    if (req.url.startsWith('/api/usuarios/7')) {
      return res.end(JSON.stringify({ id: 7, nome: 'Marcia', email: 'm@x.com', perfil: 'Admin', status: statusDoUsuario }));
    }
    res.end(JSON.stringify({}));
  });
});

// reproduz o que o handler IPC faz com o erro
function simularIpc(err) {
  let reason = err?.reason;
  if (!reason) {
    if (isPinError(err)) reason = 'pin';
    else if (isNetworkError(err)) reason = 'offline';
    else if (err && err.code === 'db-connecting') reason = 'db-connecting';
  }
  return { success: false, message: err.message, code: err.code, reason };
}

// reproduz a decisão da tela de login
function simularTela(result) {
  const message = typeof result.message === 'string' ? result.message : '';
  const reason = typeof result.reason === 'string' ? result.reason.trim() : '';
  const normalizedReason = reason.toLowerCase();
  if (normalizedReason && normalizedReason !== 'db-connecting') {
    if (normalizedReason === 'pin') return 'toast:sessao-invalida';
    if (normalizedReason === 'user-auth') return 'toast:credenciais';
    if (normalizedReason === 'offline') return 'toast:offline';
    return 'toast:erro-generico';
  }
  if (
    result.code === 'inactive-user' ||
    result.code === 'unconfirmed-user' ||
    message.toLowerCase().includes('inativo') ||
    message.toLowerCase().includes('bloqueado')
  ) {
    return 'AVISO_BLOQUEIO:' + message;
  }
  return 'toast:erro-generico';
}

let fail = 0;
const ok = (c, t) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + t); if (!c) fail++; };

srv.listen(4500, async () => {
  // 1) usuário ATIVO entra normalmente
  statusDoUsuario = 'ativo';
  tokenStore.clearToken();
  try {
    const u = await loginUsuario('m@x.com', 'senha');
    ok(u && u.id === 7, 'usuário ativo consegue logar');
    ok(Boolean(tokenStore.getToken()), 'token mantido para usuário ativo');
  } catch (e) {
    ok(false, 'usuário ativo consegue logar (lançou: ' + e.message + ')');
  }

  // 2) usuário INATIVO é bloqueado
  statusDoUsuario = 'aguardando_aprovacao';
  tokenStore.clearToken();
  try {
    await loginUsuario('m@x.com', 'senha');
    ok(false, 'usuário inativo deveria ser bloqueado');
  } catch (e) {
    ok(e.code === 'inactive-user', 'inativo -> code inactive-user');
    ok(e.message === 'Login bloqueado pelo administrador, entre em contato.', 'mensagem exata: "' + e.message + '"');
    ok(!tokenStore.getToken(), 'token descartado (sem sessão válida)');
    const r = simularIpc(e);
    ok(!r.reason, 'IPC nao define reason (senao a tela nao chega no aviso)');
    ok(simularTela(r).startsWith('AVISO_BLOQUEIO:'), 'tela exibe o aviso de bloqueio');
    console.log('        -> tela mostra: ' + simularTela(r).replace('AVISO_BLOQUEIO:', ''));
  }

  // 3) rótulo da interface ("Inativo") também bloqueia
  statusDoUsuario = 'Inativo';
  tokenStore.clearToken();
  try { await loginUsuario('m@x.com', 'senha'); ok(false, 'rótulo "Inativo" deveria bloquear'); }
  catch (e) { ok(e.code === 'inactive-user', 'rótulo "Inativo" tambem bloqueia'); }

  // 4) e-mail não confirmado
  statusDoUsuario = 'nao_confirmado';
  tokenStore.clearToken();
  try { await loginUsuario('m@x.com', 'senha'); ok(false, 'nao confirmado deveria bloquear'); }
  catch (e) {
    ok(e.code === 'unconfirmed-user', 'nao_confirmado -> code unconfirmed-user');
    ok(simularTela(simularIpc(e)).startsWith('AVISO_BLOQUEIO:'), 'tela exibe aviso p/ nao confirmado');
    console.log('        -> tela mostra: ' + simularTela(simularIpc(e)).replace('AVISO_BLOQUEIO:', ''));
  }

  // 5) sem status informado -> nao bloqueia (evita travar login por dado ausente)
  statusDoUsuario = '';
  tokenStore.clearToken();
  try { const u = await loginUsuario('m@x.com', 'senha'); ok(!!u, 'sem status: login segue (nao bloqueia por dado ausente)'); }
  catch (e) { ok(false, 'sem status nao deveria bloquear (lançou: ' + e.message + ')'); }

  srv.close();
  console.log(fail ? '\n' + fail + ' FALHA(S)' : '\nTODOS OS TESTES PASSARAM');
  process.exit(fail ? 1 : 0);
});
