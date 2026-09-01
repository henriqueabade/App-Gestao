const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Onde o token e guardado.
//
// Antes era `<raiz-do-projeto>/data/authToken.json`, resolvido por __dirname.
// Em desenvolvimento isso funciona; num app EMPACOTADO, __dirname aponta para
// dentro do app.asar, que e SOMENTE LEITURA. O resultado era o relatado na
// maquina de producao: a gravacao falhava em silencio, e poucos segundos depois
// a releitura do disco nao achava o arquivo e ZERAVA o token da memoria — a
// proxima chamada tomava 401, o monitor classificava como "token invalido" e
// derrubava a sessao. O usuario logava de novo e o ciclo recomecava.
//
// Agora preferimos sempre um diretorio gravavel do usuario.
// ---------------------------------------------------------------------------
function resolverDiretorio() {
  const candidatos = [];

  // 1) Electron: o proprio userData do app (mesmo caminho usado pelo main.js)
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      candidatos.push(app.getPath('userData'));
    }
  } catch (_) { /* fora do Electron (ex.: `node backend/server.js`) */ }

  // 2) override explicito, util em testes e em execucao avulsa
  if (process.env.APP_DATA_DIR) candidatos.push(process.env.APP_DATA_DIR);

  // 3) pasta do usuario, sempre gravavel
  try {
    const base = process.env.APPDATA || path.join(os.homedir(), '.config');
    candidatos.push(path.join(base, 'santissimo-decor'));
  } catch (_) {}

  for (const dir of candidatos) {
    if (!dir) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (_) { /* tenta o proximo */ }
  }

  // ultimo recurso: comportamento antigo
  return path.join(__dirname, '..', 'data');
}

const TOKEN_DIR = resolverDiretorio();
const TOKEN_PATH = path.join(TOKEN_DIR, 'authToken.json');
const CAMINHO_ANTIGO = path.join(__dirname, '..', 'data', 'authToken.json');

const TOKEN_REFRESH_INTERVAL_MS = Math.max(
  Number.parseInt(process.env.TOKEN_REFRESH_INTERVAL_MS || '5000', 10),
  1000
);

let currentToken = null;
let lastKnownMtimeMs = null;
let lastStatCheckAt = 0;
// Distingue "nao ha token" de "o arquivo sumiu, mas eu tenho um na memoria".
let limpezaDeliberada = false;

function persistToken(token) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ token, salvoEm: Date.now() }), 'utf-8');
    return true;
  } catch (err) {
    console.error('Nao foi possivel salvar o token de autenticacao em', TOKEN_PATH, err?.message || err);
    return false;
  }
}

function lerArquivo(caminho) {
  const raw = fs.readFileSync(caminho, 'utf-8');
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed.token === 'string' && parsed.token.trim()
    ? parsed.token.trim()
    : null;
}

function loadPersistedToken() {
  try {
    currentToken = lerArquivo(TOKEN_PATH);
    lastKnownMtimeMs = fs.statSync(TOKEN_PATH)?.mtimeMs || null;
    return;
  } catch (_) { /* segue para a migracao */ }

  // Migra o token da localizacao antiga, para quem ja estava logado.
  try {
    if (CAMINHO_ANTIGO !== TOKEN_PATH) {
      const antigo = lerArquivo(CAMINHO_ANTIGO);
      if (antigo) {
        currentToken = antigo;
        if (persistToken(antigo)) {
          lastKnownMtimeMs = fs.statSync(TOKEN_PATH)?.mtimeMs || null;
          console.info('Token migrado para', TOKEN_PATH);
        }
        return;
      }
    }
  } catch (_) {}

  currentToken = null;
  lastKnownMtimeMs = null;
}

function setToken(token) {
  const limpo = typeof token === 'string' && token.trim() ? token.trim() : null;
  if (!limpo) return clearToken();

  currentToken = limpo;
  limpezaDeliberada = false;
  if (persistToken(limpo)) {
    try {
      lastKnownMtimeMs = fs.statSync(TOKEN_PATH)?.mtimeMs || null;
      lastStatCheckAt = Date.now();
    } catch (_) {
      lastKnownMtimeMs = null;
    }
  } else {
    // Mesmo sem conseguir gravar, o token vale para esta sessao.
    lastKnownMtimeMs = null;
    lastStatCheckAt = Date.now();
  }
}

function getToken() {
  refreshTokenFromDisk();
  return currentToken;
}

function clearToken() {
  currentToken = null;
  lastKnownMtimeMs = null;
  limpezaDeliberada = true;
  try {
    fs.rmSync(TOKEN_PATH, { force: true });
  } catch (err) {
    console.error('Nao foi possivel limpar o token salvo', err?.message || err);
  }
}

function refreshTokenFromDisk(force = false) {
  const now = Date.now();
  if (!force && now - lastStatCheckAt < TOKEN_REFRESH_INTERVAL_MS) return;
  lastStatCheckAt = now;

  let stats = null;
  try {
    stats = fs.statSync(TOKEN_PATH);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // Arquivo ausente. Se o token foi limpo de proposito, nao ha o que fazer.
      // Se NAO foi, manter o da memoria: sumico de arquivo (disco somente
      // leitura, antivirus, pasta apagada) nao pode derrubar a sessao — era
      // exatamente isso que fazia o app "trocar de token" a cada login.
      if (limpezaDeliberada) {
        currentToken = null;
        lastKnownMtimeMs = null;
      } else if (currentToken) {
        persistToken(currentToken);
      }
    }
    return;
  }

  if (!stats || (lastKnownMtimeMs && stats.mtimeMs === lastKnownMtimeMs)) return;

  try {
    const doDisco = lerArquivo(TOKEN_PATH);
    // So adotamos o valor do disco se ele existir. Um arquivo corrompido nao
    // deve zerar uma sessao que esta funcionando.
    if (doDisco) currentToken = doDisco;
    lastKnownMtimeMs = stats.mtimeMs;
  } catch (err) {
    lastKnownMtimeMs = stats?.mtimeMs || lastKnownMtimeMs;
  }
}

/** Dados do JWT sem expor o token: usado para decidir se ainda vale. */
function getTokenInfo() {
  const token = getToken();
  if (!token) return { valido: false, motivo: 'ausente' };
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const agora = Math.floor(Date.now() / 1000);
    if (payload.exp && agora >= payload.exp) {
      return { valido: false, motivo: 'expirado', exp: payload.exp };
    }
    return {
      valido: true,
      exp: payload.exp || null,
      usuarioId: payload.id ?? payload.sub ?? payload.usuario_id ?? null,
      expiraEmMs: payload.exp ? (payload.exp - agora) * 1000 : null
    };
  } catch (_) {
    return { valido: false, motivo: 'ilegivel' };
  }
}

loadPersistedToken();

module.exports = {
  setToken, getToken, clearToken, refreshTokenFromDisk, getTokenInfo,
  TOKEN_PATH
};
