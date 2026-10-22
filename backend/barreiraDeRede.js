/**
 * Barreira de rede do ambiente DEV isolado (ver ambienteIsolado.js).
 *
 * Instalada só numa máquina isolada, ANTES de qualquer módulo abrir conexão:
 * toda conexão TCP/TLS do processo (http, https, fetch, pg, nodemailer) passa
 * por net.Socket.prototype.connect, e aqui só sai para o próprio computador
 * (127.x, ::1, localhost, socket Unix) ou para um host da lista
 * DEV_REDE_PERMITIDA — que nasce vazia e só cresce com autorização do dono.
 *
 * O Chromium (janelas, electron.net) não passa por aqui: main.js liga, na
 * mesma máquina, o host-resolver-rules que só resolve localhost.
 */
const net = require('net');
const { hostLocal } = require('./ambienteIsolado');

const CODIGO = 'BARREIRA_DE_REDE';
let instalada = null;

/** Destino de uma chamada a Socket#connect, em qualquer das formas aceitas pelo Node. */
function destinoDe(args) {
  let primeiro = args[0];
  // net.connect/http/tls chamam socket.connect([opções, cb]) já normalizado.
  if (Array.isArray(primeiro)) primeiro = primeiro[0];
  if (primeiro && typeof primeiro === 'object') {
    if (primeiro.path) return { local: true, host: String(primeiro.path) };
    return { host: String(primeiro.host || 'localhost'), porta: primeiro.port };
  }
  if (typeof primeiro === 'string' && !/^\d+$/.test(primeiro)) return { local: true, host: primeiro }; // socket Unix
  const host = typeof args[1] === 'string' ? args[1] : 'localhost';
  return { host, porta: primeiro };
}

function permitido(destino, permitidos = []) {
  if (destino.local || hostLocal(destino.host)) return true;
  const host = String(destino.host).trim().toLowerCase().replace(/\.$/, '');
  return permitidos.includes(host);
}

/** Liga a barreira (uma vez por processo). `permitidos`: hosts extras liberados. */
function instalar({ permitidos = [], avisar = mensagem => console.warn(mensagem) } = {}) {
  if (instalada) return instalada;
  const connectOriginal = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connectComBarreira(...args) {
    const destino = destinoDe(args);
    if (!permitido(destino, permitidos)) {
      const e = new Error(`[barreira-de-rede] conexão bloqueada no ambiente DEV isolado: ${destino.host}${destino.porta ? `:${destino.porta}` : ''}`);
      e.code = CODIGO;
      avisar(e.message);
      process.nextTick(() => this.destroy(e));
      return this;
    }
    return connectOriginal.apply(this, args);
  };
  instalada = {
    permitidos: [...permitidos],
    desinstalar() {
      net.Socket.prototype.connect = connectOriginal;
      instalada = null;
    }
  };
  return instalada;
}

/** Regras para o Chromium (app.commandLine host-resolver-rules): só localhost e os permitidos. */
function regrasDoChromium(permitidos = []) {
  return ['MAP * ~NOTFOUND', 'EXCLUDE localhost', 'EXCLUDE 127.0.0.1', ...permitidos.map(h => `EXCLUDE ${h}`)].join(', ');
}

module.exports = { CODIGO, destinoDe, permitido, instalar, regrasDoChromium };
