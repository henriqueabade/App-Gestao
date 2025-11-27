const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { requireAuthApiClient } = require('./authenticatedApiClient');

const { sendResetEmail } = require('../src/email/sendResetEmail');
const { isPinError, isNetworkError } = require('./backend');


const router = express.Router();

router.post('/password-reset-request', async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = (email || '').trim();

  try {
    const api = requireAuthApiClient(req);
    const users = await api.get('/usuarios', {
      query: { email: `eq.${normalizedEmail}`, select: 'id' }
    });

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(404).json({ error: 'E-mail não encontrado.' });
    }

    const userId = users[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await api.post('/password_reset_tokens', {
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_at: new Date().toISOString()
    });

    await sendResetEmail(normalizedEmail, token);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('password-reset-request error', err);

    if (err.status === 401) {
      return res.status(401).json({ error: 'Token ausente ou inválido.' });
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
    const api = requireAuthApiClient(req);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokens = await api.get('/password_reset_tokens', {
      query: { token_hash: `eq.${tokenHash}`, select: 'user_id,expires_at' }
    });

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).end();
    }
    const row = tokens[0];
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    if (!expiresAt || expiresAt < new Date()) {
      await api.delete('/password_reset_tokens', { query: { token_hash: `eq.${tokenHash}` } });
      return res.status(400).end();
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await api.put(`/usuarios/${row.user_id}`, { senha: hashed });
    await api.delete('/password_reset_tokens', { query: { token_hash: `eq.${tokenHash}` } });
    res.sendStatus(200);
  } catch (err) {
    console.error('password-reset error', err);
    if (err.status === 401) {
      return res.status(401).json({ error: 'Token ausente ou inválido.' });
    }
    res.status(500).end();
  }
});

module.exports = router;
