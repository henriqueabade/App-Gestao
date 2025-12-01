// backend/usuariosController.js
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { getToken } = require('./tokenStore');

const router = express.Router();

/**
 * Cria um client interno já com o JWT que está salvo no tokenStore.
 * Esse client só faz proxy HTTP, sem nenhuma transformação pesada.
 */
function createInternalApiClient() {
  const token = getToken();
  return createApiClient({
    headers: {
      authorization: token ? `Bearer ${token}` : ''
    }
  });
}

/**
 * Normaliza o payload de criação/edição de usuário
 */
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

/**
 * Normaliza avatar APENAS para /me (topbar). A lista não mexe mais em avatar.
 */
function normalizeAvatar(usuario = {}) {
  const { fotoUsuario, foto_usuario, ...rest } = usuario || {};
  const normalized = { ...rest };

  const id =
    usuario?.id ??
    usuario?.usuario_id ??
    null;

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

  const avatarUrl =
    usuario?.avatarUrl ??
    usuario?.avatar_url ??
    (id ? `/users/${id}/avatar` : null);

  if (avatarUrl) {
    normalized.avatarUrl = avatarUrl;
    normalized.avatar_url = avatarUrl;
    normalized.foto = avatarUrl;
    normalized.fotoUrl = avatarUrl;
  }

  if (avatarVersion !== null && avatarVersion !== undefined) {
    const value =
      typeof avatarVersion === 'string'
        ? avatarVersion.trim()
        : String(avatarVersion);
    if (value) {
      normalized.avatarVersion = value;
      normalized.avatar_version = value;
    }
  }

  return normalized;
}

function extractUserIdFromToken(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return null;

  const bearerMatch = raw.match(/^Bearer\s+(.+)/i);
  const stripped = bearerMatch ? bearerMatch[1].trim() : raw;

  const numeric = Number(stripped);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }

  const jwtParts = stripped.split('.');
  if (jwtParts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(jwtParts[1], 'base64').toString('utf-8')
      );
      const candidates = [
        payload?.id,
        payload?.usuarioId,
        payload?.userId,
        payload?.sub
      ];
      for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isInteger(parsed) && parsed > 0) {
          return parsed;
        }
      }
    } catch (_) {
      // ignora erro de parse
    }
  }

  return null;
}

/**
 * GET /usuarios
 * Endpoint genérico (quase não usado na UI)
 */
router.get('/', async (req, res) => {
  try {
    const api = createInternalApiClient();
    const usuarios = await api.get('/api/usuarios', { query: req.query });
    res.json(Array.isArray(usuarios) ? usuarios : []);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res
      .status(err.status || 500)
      .json({ error: 'Erro ao listar usuários' });
  }
});

/**
 * GET /usuarios/lista
 * Rota usada na TELA DE USUÁRIOS.
 * Faz um SELECT super leve e NÃO mexe em avatar nem histórico pesado.
 */
router.get('/lista', async (req, res) => {
  try {
    const api = createInternalApiClient();

    const query = {
      // só o que o front realmente usa
      select: 'id,nome,email,perfil,status,permissoes',
      order: 'nome',
      ...req.query
    };

    const usuarios = await api.get('/api/usuarios', { query });
    const payload = Array.isArray(usuarios) ? usuarios : [];

    res.status(200).json(payload);
  } catch (err) {
    console.error('Erro ao listar usuários (rota /lista):', err);
    res
      .status(err.status || 500)
      .json({ error: 'Erro ao listar usuários' });
  }
});

/**
 * GET /usuarios/me
 * Usado na topbar (nome + perfil + avatar).
 */
router.get('/me', async (req, res) => {
  try {
    const api = createInternalApiClient();
    const tokenFromRequest = req.headers?.authorization || getToken();
    const userId = extractUserIdFromToken(tokenFromRequest);

    const usuario = userId
      ? await api.get(`/api/usuarios/${userId}`)
      : await api.get('/api/usuarios/me');

    res.status(200).json(normalizeAvatar(usuario || {}));
  } catch (err) {
    console.error('Erro ao buscar usuário autenticado:', err);
    res
      .status(err.status || 500)
      .json({ error: 'Erro ao buscar usuário autenticado' });
  }
});

/**
 * GET /usuarios/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const api = createInternalApiClient();
    const usuario = await api.get(`/api/usuarios/${req.params.id}`);
    res.json(usuario || {});
  } catch (err) {
    console.error('Erro ao buscar usuário:', err);
    res
      .status(err.status || 500)
      .json({ error: 'Erro ao buscar usuário' });
  }
});

/**
 * POST /usuarios
 */
router.post('/', async (req, res) => {
  try {
    const api = createInternalApiClient();
    const created = await api.post('/api/usuarios', buildPayload(req.body));
    res.status(201).json(created);
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    res
      .status(err.status || 500)
      .json({ error: 'Erro ao criar usuário' });
  }
});

/**
 * PUT /usuarios/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const api = createInternalApiClient();
    await api.put(`/api/usuarios/${req.params.id}`, buildPayload(req.body));
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res
      .status(err.status || 500)
      .json({ error: 'Erro ao atualizar usuário' });
  }
});

/**
 * DELETE /usuarios/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const api = createInternalApiClient();
    await api.delete(`/api/usuarios/${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir usuário:', err);
    res
      .status(err.status || 500)
      .json({ error: 'Erro ao excluir usuário' });
  }
});

/**
 * Handler para /users/:id/avatar (caso você ainda use em algum lugar)
 */
async function handleAvatarRequest(req, res) {
  const token = getToken();
  const api = createApiClient({
    headers: { authorization: token ? `Bearer ${token}` : '' }
  });

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
