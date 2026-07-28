// backend/usuariosController.js
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { getToken } = require('./tokenStore');
const permissoesRepo = require('./permissionsRepository');

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

// ==========================================================================
// Modelos (perfis) de permissão
//
// IMPORTANTE: estas rotas precisam ficar ANTES de "/:id", senão o Express
// casa "/modelos-permissoes" com "/:id" e tenta buscar um usuário de id
// "modelos-permissoes" (erro: invalid input syntax for type integer).
// ==========================================================================

function mapModelo(row = {}, permissoes) {
  const selecoes = permissoes ? permissoesRepo.toSelections(permissoes) : null;
  return {
    id: row.id,
    nome: row.nome,
    descricao: row.descricao || '',
    criadoEm: row.criado_em ?? null,
    atualizadoEm: row.atualizado_em ?? null,
    ...(selecoes
      ? { permissoes, acoes: selecoes.acoes, colunas: selecoes.colunas, modulos: selecoes.modulos }
      : {})
  };
}

// Aceita as listas planas do modal e também o formato antigo aninhado.
function permissoesDoBody(body = {}) {
  const acoes = Array.isArray(body.acoes) ? body.acoes : [];
  const colunas = Array.isArray(body.colunas) ? body.colunas : [];
  const modulos = Array.isArray(body.modulos) ? body.modulos : [];
  return permissoesRepo.fromSelections({ acoes, colunas, modulos });
}

/** GET /usuarios/modelos-permissoes — lista os perfis */
router.get('/modelos-permissoes', async (_req, res) => {
  try {
    const api = createInternalApiClient();
    const linhas = await api.get('/api/modelos_permissoes', { query: { order: 'nome' } });
    res.json(Array.isArray(linhas) ? linhas.map(l => mapModelo(l)) : []);
  } catch (err) {
    console.error('Erro ao listar modelos de permissões:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar modelos de permissões' });
  }
});

/** GET /usuarios/modelos-permissoes/:id — perfil + permissões */
router.get('/modelos-permissoes/:id', async (req, res) => {
  try {
    const api = createInternalApiClient();
    const modelo = await api.get(`/api/modelos_permissoes/${req.params.id}`);
    if (!modelo || modelo.error === 'Not found') {
      return res.status(404).json({ error: 'Modelo não encontrado' });
    }
    const permissoes = await permissoesRepo.loadPermissionsForModelo(api, req.params.id);
    res.json({ modelo: mapModelo(modelo, permissoes) });
  } catch (err) {
    console.error('Erro ao buscar modelo de permissões:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar modelo de permissões' });
  }
});

/** POST /usuarios/modelos-permissoes — cria perfil e grava permissões */
router.post('/modelos-permissoes', async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  if (!nome) return res.status(400).json({ error: 'Informe o nome do perfil.' });

  try {
    const api = createInternalApiClient();
    const existentes = await api.get('/api/modelos_permissoes', { query: { nome } }).catch(() => []);
    if (Array.isArray(existentes) && existentes.some(m => String(m?.nome).trim().toLowerCase() === nome.toLowerCase())) {
      return res.status(409).json({ error: 'Já existe um perfil com este nome.' });
    }

    const criado = await api.post('/api/modelos_permissoes', {
      nome,
      descricao: req.body?.descricao || ''
    });
    const modeloId = criado?.id ?? criado?.data?.id ?? criado?.[0]?.id;
    if (!modeloId) throw new Error('A API não retornou o id do perfil criado.');

    const permissoes = permissoesDoBody(req.body);
    await permissoesRepo.savePermissionsForModelo(api, modeloId, permissoes);

    res.status(201).json({ modelo: mapModelo({ ...criado, id: modeloId, nome }, permissoes) });
  } catch (err) {
    console.error('Erro ao criar modelo de permissões:', err);
    res.status(err.status || 500).json({ error: 'Erro ao criar modelo de permissões' });
  }
});

/** PATCH/PUT /usuarios/modelos-permissoes/:id — atualiza perfil e permissões */
async function atualizarModelo(req, res) {
  const { id } = req.params;
  try {
    const api = createInternalApiClient();
    const payload = {};
    if (req.body?.nome !== undefined) payload.nome = String(req.body.nome).trim();
    if (req.body?.descricao !== undefined) payload.descricao = req.body.descricao || '';
    if (Object.keys(payload).length) {
      await api.put(`/api/modelos_permissoes/${id}`, payload);
    }

    const permissoes = permissoesDoBody(req.body);
    await permissoesRepo.savePermissionsForModelo(api, id, permissoes);

    res.json({ modelo: mapModelo({ id: Number(id), ...payload }, permissoes) });
  } catch (err) {
    console.error('Erro ao atualizar modelo de permissões:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar modelo de permissões' });
  }
}
router.patch('/modelos-permissoes/:id', atualizarModelo);
router.put('/modelos-permissoes/:id', atualizarModelo);

/** DELETE /usuarios/modelos-permissoes/:id */
router.delete('/modelos-permissoes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const api = createInternalApiClient();
    await permissoesRepo.deletePermissionsForModelo(api, id);
    await api.delete(`/api/modelos_permissoes/${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir modelo de permissões:', err);
    res.status(err.status || 500).json({ error: 'Erro ao excluir modelo de permissões' });
  }
});

/** PUT /usuarios/:id/permissoes — vincula um perfil ao usuário */
router.put('/:id/permissoes', async (req, res) => {
  const { id } = req.params;
  const modeloId = req.body?.modeloPermissoesId ?? req.body?.modelo_permissoes_id ?? null;
  try {
    const api = createInternalApiClient();
    await api.put(`/api/usuarios/${id}`, { modelo_permissoes_id: modeloId });
    try { require('./permissionsController').limparCachePermissoes(); } catch (_) {}
    res.json({ success: true, modeloPermissoesId: modeloId });
  } catch (err) {
    console.error('Erro ao aplicar permissões ao usuário:', err);
    res.status(err.status || 500).json({ error: 'Erro ao aplicar permissões ao usuário' });
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
