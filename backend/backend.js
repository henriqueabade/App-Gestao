const pool = require('./db');
const bcrypt = require('bcrypt');
const { sendRegistrationEmail } = require("../src/email/sendRegistrationEmail");
const { registrarUltimaEntrada } = require('./userActivity');

// Track failed PIN attempts across session
let pinErrorAttempts = 0;

// Helper to detect errors related to an invalid PIN/port
function isPinError(err) {
  if (!err) return false;
  const codes = ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET'];
  if (codes.includes(err.code)) return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('port should') ||
    msg.includes('invalid port')
  );
}

// Helper to detect network connectivity issues
function isNetworkError(err) {
  if (!err) return false;
  const codes = ['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'];
  if (codes.includes(err.code)) return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('enetworkunreach') ||
    msg.includes('getaddrinfo')
  );
}

async function usuarioExiste(email) {
  const trimmed = (email || '').trim();
  const res = await pool.query(
    'SELECT id FROM usuarios WHERE lower(email) = lower($1)',
    [trimmed]
  );
  return res.rows.length > 0;
}

// Cadastro de usuário (corrigido)
async function registrarUsuario(nome, email, senha, pin) {
  const senhaCriptografada = await bcrypt.hash(senha, 10);
  try {
    pool.init(pin);
    if (await usuarioExiste(email)) {
      throw new Error('Usuário já cadastrado');
    }
    const normalized = (email || '').trim().toLowerCase();
    const resultado = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, verificado) VALUES ($1, $2, $3, false) RETURNING id',
      [nome, normalized, senhaCriptografada]
    );
    try {
      await sendRegistrationEmail(email, nome);
    } catch (e) {
      console.error('sendRegistrationEmail error', e);
    }
    pinErrorAttempts = 0; // reset after successful operation
    return resultado.rows[0];
  } catch (err) {
    if (isNetworkError(err)) {
      throw new Error('Sem conexão com internet');
    }
    if (isPinError(err)) {
      pinErrorAttempts += 1;
      if (pinErrorAttempts >= 5) {
        throw new Error('PIN incorreto, contate Administrador');
      }
      throw new Error('PIN incorreto');
    }
    throw err;
  }
}

// Login de usuário (corrigido)
async function loginUsuario(email, senha, pin) {
  try {
    pool.init(pin);
    const resultado = await pool.query(
      'SELECT * FROM usuarios WHERE lower(email) = lower($1)',
      [email.trim()]
    );

    const usuario = resultado.rows[0];
    if (!usuario) throw new Error('Usuário não encontrado');

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
    if (!senhaCorreta) throw new Error('Senha incorreta');

    pinErrorAttempts = 0; // reset after successful login
    try {
      await registrarUltimaEntrada(usuario.id);
    } catch (err) {
      console.error('Falha ao registrar ultima entrada do usuário:', err);
    }
    return { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil };
  } catch (err) {
    if (isNetworkError(err)) {
      throw new Error('Sem conexão com internet');
    }
    if (isPinError(err)) {
      pinErrorAttempts += 1;
      if (pinErrorAttempts >= 5) {
        throw new Error('PIN incorreto, contate Administrador');
      }
      throw new Error('PIN incorreto');
    }
    throw err;
  }
}

module.exports = {
  registrarUsuario,
  loginUsuario,
  isPinError,
  isNetworkError
};
