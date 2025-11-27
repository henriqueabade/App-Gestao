const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('./db');

const { sendResetEmail } = require('../src/email/sendResetEmail');
const { isPinError, isNetworkError } = require('./backend');


const router = express.Router();

router.post('/password-reset-request', async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email || '').trim();
  const authHeader = req.get('authorization') || '';
  const tokenMatch = authHeader.trim().match(/^Bearer\s+(.+)/i);
  const token = tokenMatch ? tokenMatch[1] : authHeader.trim();

  if (!token) {
    return res.status(401).json({ error: 'Token ausente. Solicitação não enviada.' });
  }

  try {
    pool.init({ token });
    if (typeof pool.ensureWarmup === 'function') {
      pool.ensureWarmup();
    }
    const hasReadyCheck = typeof pool.isReady === 'function';
    const hasNotReadyFactory = typeof pool.createNotReadyError === 'function';
    if (hasReadyCheck && !pool.isReady()) {
      const err = hasNotReadyFactory ? pool.createNotReadyError() : Object.assign(new Error('Conectando ao banco...'), { code: 'db-connecting', retryAfter: 5000 });
      return res.status(503).json({
        error: err.message,
        code: err.code,
        retryAfter: err.retryAfter
      });
    }

    const userRes = await pool.query('SELECT id FROM usuarios WHERE email = $1', [normalizedEmail]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'E-mail não encontrado.' });
    }

    const userId = userRes.rows[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES ($1,$2,$3,NOW())',
      [userId, tokenHash, expiresAt]
    );

    await sendResetEmail(normalizedEmail, token);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('password-reset-request error', err);

    if (err.code === 'db-connecting') {
      return res.status(503).json({
        error: err.message,
        code: err.code,
        retryAfter: err.retryAfter
      });
    }

    if (isPinError(err)) {
      return res.status(400).json({ error: 'PIN incorreto. E-mail não enviado.' });
    }

    if (isNetworkError(err)) {
      return res.status(503).json({ error: 'Sem conexão com internet.' });
    }

    res.status(500).json({ error: 'Erro ao solicitar redefinição de senha.' });
  }
});

router.post('/password-reset', async (req, res) => {
  const { token, newPassword } = req.body;
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query('SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash=$1', [tokenHash]);
    if (result.rows.length === 0) {
      return res.status(400).end();
    }
    const row = result.rows[0];
    if (new Date(row.expires_at) < new Date()) {
      await pool.query('DELETE FROM password_reset_tokens WHERE token_hash=$1', [tokenHash]);
      return res.status(400).end();
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE usuarios SET senha=$1 WHERE id=$2', [hashed, row.user_id]);
    await pool.query('DELETE FROM password_reset_tokens WHERE token_hash=$1', [tokenHash]);
    res.sendStatus(200);
  } catch (err) {
    console.error('password-reset error', err);
    if (err.code === 'db-connecting') {
      return res.status(503).json({
        error: err.message,
        code: err.code,
        retryAfter: err.retryAfter
      });
    }
    res.status(500).end();
  }
});

module.exports = router;
