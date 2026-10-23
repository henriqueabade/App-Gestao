/**
 * Contenção do backend local (Express em 127.0.0.1, porta 3000 ou a próxima
 * livre): só o próprio programa fala com ele.
 *
 * Antes (até 23/10/2026), fora do DEV, ele respondia a qualquer origem
 * (`cors()`), não conferia Origin nem Host e punha o token de quem estava
 * logado em todo pedido sem token: uma página aberta no navegador do mesmo
 * computador podia ler e alterar dados com o login da pessoa. Agora, com o
 * programa rodando (ativar() no main.js, quando o servidor sobe):
 *
 * - Host só 127.0.0.1/localhost na porta do servidor (barra DNS rebinding);
 * - Origin só a das telas do programa ("null" de file://) ou a do próprio
 *   servidor (a tela de PDF é servida por ele);
 * - todo pedido leva o segredo desta execução no cabeçalho x-app-gestao-local.
 *   As telas não o conhecem: o main.js o põe nos pedidos delas
 *   (sessoesElectron.js) e nos que ele mesmo faz (fetch e http.request).
 *
 * Sem ativar() (testes, `node backend/server.js`) nada muda, salvo a recusa de
 * corpo comprimido, que vale sempre.
 */
const crypto = require('crypto');
const cors = require('cors');

const CABECALHO = 'x-app-gestao-local';
const segredo = crypto.randomBytes(32).toString('base64url');
const segredoEmBytes = Buffer.from(segredo);

// Links abertos no navegador, protegidos pelo token deles (as mesmas exceções
// que o DEV já tinha em server.js).
const LIVRES = [
  ['GET', '/api/usuarios/confirmar-email'],
  ['GET', '/api/usuarios/aprovar']
];

let porta = null;
let ligado = false;

/** Liga a contenção para o servidor que acabou de subir nesta porta. */
function ativar(portaDoServidor) {
  porta = Number(portaDoServidor) || null;
  ligado = true;
}

function ativo() { return ligado; }

function origensDoServidor() {
  return porta ? [`http://127.0.0.1:${porta}`, `http://localhost:${porta}`] : [];
}

/** O endereço é do backend local desta execução? */
function ehDoBackendLocal(endereco) {
  try {
    const u = endereco instanceof URL ? endereco : new URL(String(endereco));
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) return false;
    return !porta || Number(u.port || 80) === porta;
  } catch (_) {
    return false;
  }
}

/** Cabeçalho do segredo, para pedidos que o processo principal faz ao backend local. */
function cabecalhos() {
  return { [CABECALHO]: segredo };
}

function cabecalhosPara(endereco) {
  return ehDoBackendLocal(endereco) ? cabecalhos() : {};
}

function hostPermitido(host) {
  const m = /^(127\.0\.0\.1|localhost)(?::(\d+))?$/i.exec(String(host || ''));
  return !!m && (!porta || Number(m[2] || 80) === porta);
}

function origemPermitida(origem) {
  if (origem === undefined || origem === 'null') return true;
  return origensDoServidor().includes(String(origem).toLowerCase());
}

function segredoConfere(valor) {
  const recebido = Buffer.from(String(valor || ''));
  return recebido.length === segredoEmBytes.length && crypto.timingSafeEqual(recebido, segredoEmBytes);
}

function recusar(res, status, mensagem) {
  res.status(status).json({ error: mensagem });
}

/** Primeiro middleware do server.js: barra quem não é o programa. */
function exigirPrograma(req, res, next) {
  if (!ligado) return next();
  if (!hostPermitido(req.headers.host)) return recusar(res, 403, 'Endereço não autorizado.');
  if (!origemPermitida(req.headers.origin)) return recusar(res, 403, 'Origem não autorizada.');
  // Pré-verificação do CORS: o cors() responde sem passar pelas rotas.
  if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) return next();
  if (segredoConfere(req.headers[CABECALHO])) return next();
  if (LIVRES.some(([metodo, caminho]) => metodo === req.method && caminho === req.path)) return next();
  return recusar(res, 401, 'Acesso permitido só pelo programa.');
}

/**
 * Corpo comprimido nunca chega aos descompressores do body-parser (vale
 * sempre): nenhuma tela manda corpo comprimido, e o Brotli do runtime atual
 * não tem a correção do CVE-2026-111497.
 */
function recusarCorpoComprimido(req, res, next) {
  const codificacao = String(req.headers['content-encoding'] || '').trim().toLowerCase();
  if (!codificacao || codificacao === 'identity') return next();
  return recusar(res, 415, 'Corpo comprimido não é aceito.');
}

const corsAberto = cors();
const corsDoPrograma = cors({ origin: (origem, pronto) => pronto(null, origemPermitida(origem)) });

/** CORS: só as origens do programa quando ativo; o de antes quando não. */
function corsLocal(req, res, next) {
  return (ligado ? corsDoPrograma : corsAberto)(req, res, next);
}

let fetchEmbrulhado = false;
/** O fetch do processo principal leva o segredo quando fala com o backend local. */
function instalarNoFetch() {
  if (fetchEmbrulhado || typeof globalThis.fetch !== 'function') return;
  const original = globalThis.fetch;
  globalThis.fetch = function fetch(entrada, init) {
    const endereco = typeof Request === 'function' && entrada instanceof Request ? entrada.url : entrada;
    if (!ehDoBackendLocal(endereco)) return original(entrada, init);
    const opcoes = init ? { ...init } : {};
    const cab = new Headers(opcoes.headers ?? (typeof Request === 'function' && entrada instanceof Request ? entrada.headers : undefined));
    cab.set(CABECALHO, segredo);
    opcoes.headers = cab;
    return original(entrada, opcoes);
  };
  fetchEmbrulhado = true;
}

module.exports = {
  CABECALHO,
  ativar,
  ativo,
  origensDoServidor,
  ehDoBackendLocal,
  cabecalhos,
  cabecalhosPara,
  exigirPrograma,
  recusarCorpoComprimido,
  corsLocal,
  instalarNoFetch,
  // para os testes
  _segredoConfere: segredoConfere,
  _hostPermitido: hostPermitido,
  _origemPermitida: origemPermitida,
  _desativar() { ligado = false; porta = null; }
};
