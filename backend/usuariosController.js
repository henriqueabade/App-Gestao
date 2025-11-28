const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { getToken } = require('./tokenStore');

const router = express.Router();

function buildPayload(body = {}) {
  return {
    nome: body.nome,
    email: body.email,
    perfil: body.perfil,
    senha: body.senha,
    permissoes: body.permissoes,
    status: body.status
  };
}

function normalizeAvatar(usuario = {}) {
  const { fotoUsuario, foto_usuario, ...rest } = usuario || {};
  const normalized = { ...rest };
  const id = usuario?.id ?? usuario?.usuario_id;
  const avatarVersion =
    usuario?.avatarVersion ??
    usuario?.avatar_version ??
    usuario?.avatar_updated_at ??
    usuario?.avatarUpdatedAt ??
    usuario?.avatar_atualizado_em ??
    usuario?.avatarAtualizadoEm ??
    usuario?.foto_atualizado_em ??
    usuario?.fotoAtualizadoEm ??
    null;

  const avatarUrl = usuario?.avatarUrl ?? usuario?.avatar_url ?? (id ? `/users/${id}/avatar` : null);

  if (avatarUrl) {
    normalized.avatarUrl = avatarUrl;
    normalized.avatar_url = avatarUrl;
    normalized.foto = avatarUrl;
    normalized.fotoUrl = avatarUrl;
  }

  if (avatarVersion !== null && avatarVersion !== undefined) {
    const value = typeof avatarVersion === 'string' ? avatarVersion.trim() : String(avatarVersion);
    if (value) {
      normalized.avatarVersion = value;
      normalized.avatar_version = value;
    }
  }

  return normalized;
}

router.get('/', async (req, res) => {
  try {
    const api = createApiClient(req);
    const usuarios = await api.get('/api/usuarios', { query: req.query });
    res.json(Array.isArray(usuarios) ? usuarios : []);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar usuários' });
  }
});

router.get('/lista', async (req, res) => {
  try {
    const api = createApiClient(req);
    const query = {
      select:
        'id,nome,email,perfil,status,permissoes,modelo_permissoes_id,avatar_url,avatar_updated_at,avatar_atualizado_em,foto_usuario',
      order: 'nome',
      ...req.query
    };

    const usuarios = await api.get('/api/usuarios', { query });
    const payload = Array.isArray(usuarios) ? usuarios.map(normalizeAvatar) : [];
    res.status(200).json(payload);
  } catch (err) {
    console.error('Erro ao listar usuários (rota /lista):', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar usuários' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const api = createApiClient(req);
    const usuario = await api.get('/api/usuarios/me');
    res.status(200).json(normalizeAvatar(usuario || {}));
  } catch (err) {
    console.error('Erro ao buscar usuário autenticado:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar usuário autenticado' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const api = createApiClient(req);
    const usuario = await api.get(`/api/usuarios/${req.params.id}`);
    res.json(usuario || {});
  } catch (err) {
    console.error('Erro ao buscar usuário:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar usuário' });
  }
});

router.post('/', async (req, res) => {
  try {
    const api = createApiClient(req);
    const created = await api.post('/api/usuarios', buildPayload(req.body));
    res.status(201).json(created);
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    res.status(err.status || 500).json({ error: 'Erro ao criar usuário' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const api = createApiClient(req);
    await api.put(`/api/usuarios/${req.params.id}`, buildPayload(req.body));
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar usuário' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const api = createApiClient(req);
    await api.delete(`/api/usuarios/${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir usuário:', err);
    res.status(err.status || 500).json({ error: 'Erro ao excluir usuário' });
  }
});

async function handleAvatarRequest(req, res) {
  const token = getToken();
  const api = createApiClient({ headers: { authorization: token ? `Bearer ${token}` : '' } });
  try {
    const usuario = await api.get(`/api/usuarios/${req.params.id}`);
    if (usuario?.avatar_url) {
      return res.redirect(usuario.avatar_url);
    }
    return res.status(404).end();
  } catch (err) {
    console.error('Erro ao buscar avatar do usuário:', err);
    res.status(err.status || 500).end();
  }
}

router.handleAvatarRequest = handleAvatarRequest;

module.exports = router;
