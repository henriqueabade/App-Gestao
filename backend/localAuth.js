const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('./localDatabase');
const { sanitizarSaida } = require('./sanitizarSaida');
// Sessão válida apenas nesta execução do DEV. Nenhuma chave secreta no front/disco.
const secret = crypto.randomBytes(32);
function authError() {
  const error = new Error('E-mail ou senha inválidos, ou sessão expirada.');
  error.status = 401;
  error.code = 'auth-failed';
  error.reason = 'user-auth';
  return error;
}
function signToken(id) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ id, env: 'DEV', exp: Math.floor(Date.now() / 1000) + 12 * 3600 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
function verifyToken(raw) {
  try {
    const parts = String(raw || '').replace(/^Bearer\s+/i, '').split('.');
    if (parts.length !== 3) throw authError();
    const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw authError();
    const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (data.env !== 'DEV' || !data.id || data.exp <= Date.now() / 1000) throw authError();
    return data;
  } catch (_) { throw authError(); }
}
async function login(email, senha) {
  if (typeof senha !== 'string' || !senha) throw authError();
  const { rows } = await db.query('SELECT * FROM "public"."usuarios" WHERE lower(email) = $1 LIMIT 1', [email]);
  const user = rows[0];
  if (!user || typeof user.senha !== 'string' || !(await bcrypt.compare(senha, user.senha))) throw authError();
  return { token: signToken(user.id), usuario: sanitizarSaida(user) };
}
async function register(nome, email, senha) {
  if (typeof senha !== 'string' || senha.length < 6 || !nome || !email) throw new Error('Informe nome, e-mail e senha com ao menos 6 caracteres.');
  const { rows } = await db.query(
    'INSERT INTO "public"."usuarios" (nome, email, senha, status) VALUES ($1, $2, $3, $4) RETURNING id, nome, email, status',
    [nome, email, await bcrypt.hash(senha, 12), 'nao_confirmado']
  );
  return rows[0];
}
module.exports = { login, register, verifyToken, signToken };
