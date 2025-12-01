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
    telefone: body.telefone,
    senha: body.senha,
    permissoes: body.permissoes,
    status: body.status
  };
}

function normalizeAvatar(usuario = {}) {
  const normalized = { ...usuario };

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

  const versionValue =
    avatarVersion === null || avatarVersion === undefined
      ? null
      : typeof avatarVersion === 'string'
        ? avatarVersion.trim()
        : String(avatarVersion);

  const fotoUsuario =
    usuario?.foto_usuario ??
    usuario?.fotoUsuario ??
    usuario?.avatar ??
    usuario?.avatar_url ??
    usuario?.avatarUrl ??
    null;

  if (versionValue) {
    normalized.avatarVersion = versionValue;
    normalized.avatar_version = versionValue;
  }

  if (fotoUsuario) {
    normalized.foto_usuario = fotoUsuario;
    normalized.avatar = fotoUsuario;
    normalized.avatarUrl = fotoUsuario;
    normalized.avatar_url = fotoUsuario;
    normalized.foto = fotoUsuario;
    normalized.fotoUrl = fotoUsuario;
  }

  return normalized;
}

function validateAvatarPayload(dataUrl) {
  const trimmed = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  if (!trimmed) {
    const error = new Error('Avatar ausente.');
    error.status = 400;
    throw error;
  }

  const matches = trimmed.match(/^data:(image\/(?:png|jpe?g));base64,(.+)$/i);
  if (!matches) {
    const error = new Error('Formato de avatar inválido. Utilize PNG ou JPEG em dataURL.');
    error.status = 400;
    throw error;
  }

  const base64Payload = matches[2];
  const sanitized = base64Payload.replace(/\s+/g, '');
  const padding = (sanitized.match(/=*$/) || [''])[0].length;
  const bytes = Math.floor((sanitized.length * 3) / 4) - padding;

  if (bytes > 1_048_576) {
    const error = new Error('Avatar excede o limite de 1 MB.');
    error.status = 413;
    throw error;
  }

  return trimmed;
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
      select: 'id,nome,email,perfil,status,permissoes,foto_usuario,avatar_version',
      order: 'nome',
      ...req.query
    };

    const usuarios = await api.get('/api/usuarios', { query });
    const payload = Array.isArray(usuarios)
      ? usuarios.map(user => normalizeAvatar(user))
      : [];

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

router.put('/me/avatar', async (req, res) => {
  try {
    const avatar = validateAvatarPayload(req.body?.avatar);
    const avatarVersion = Date.now();

    const api = createInternalApiClient();
    const tokenFromRequest = req.headers?.authorization || getToken();
    const userId = extractUserIdFromToken(tokenFromRequest);
    const targetPath = userId
      ? `/api/usuarios/${userId}/avatar`
      : '/api/usuarios/me/avatar';

    const updated = await api.put(targetPath, {
      avatar,
      avatarVersion,
      avatar_version: avatarVersion,
      foto_usuario: avatar
    });

    const payload = normalizeAvatar({ ...updated, avatarVersion, avatar_version: avatarVersion });
    res.status(200).json(payload);
  } catch (err) {
    console.error('Erro ao atualizar avatar do usuário:', err);
    res
      .status(err.status || 500)
      .json({ error: err.message || 'Erro ao atualizar avatar do usuário' });
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
 * PUT /usuarios/me
 */
router.put('/me', async (req, res) => {
  try {
    const api = createInternalApiClient();
    const tokenFromRequest = req.headers?.authorization || getToken();
    const userId = extractUserIdFromToken(tokenFromRequest);
    const targetPath = userId ? `/api/usuarios/${userId}` : '/api/usuarios/me';

    const updated = await api.put(targetPath, buildPayload(req.body));
    res.json(normalizeAvatar(updated || {}));
  } catch (err) {
    console.error('Erro ao atualizar usuário autenticado:', err);
    res
      .status(err.status || 500)
      .json({ error: 'Erro ao atualizar usuário autenticado' });
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

module.exports = router;
