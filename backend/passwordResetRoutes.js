const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('./db');

const { sendResetEmail } = require('../src/email/sendResetEmail');


const router = express.Router();

router.post('/password-reset-request', async (req, res) => {
  const { email } = req.body;
  try {
    const userRes = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).end();
    }
    const userId = userRes.rows[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES ($1,$2,$3,NOW())',
      [userId, tokenHash, expiresAt]
    );
    await sendResetEmail(email, token);
    res.sendStatus(200);
  } catch (err) {
    console.error('password-reset-request error', err);
    res.status(500).end();
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
    res.status(500).end();
  }
});

module.exports = router;
