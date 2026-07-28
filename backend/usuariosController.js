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

    // Campos base + os de sessão/atividade. Sem estes últimos a listagem
    // mostrava todo mundo OFFLINE e "Sem registro" no popover de atividade,
    // porque as colunas simplesmente não vinham na resposta.
    const camposBase = 'id,nome,email,perfil,status,permissoes,foto_usuario,avatar_version';
    const camposAtividade = 'modelo_permissoes_id,data_ativacao,ultimo_login,ultima_entrada,ultima_saida,ultima_alteracao,ultima_atividade';

    const query = {
      select: `${camposBase},${camposAtividade}`,
      order: 'nome',
      ...req.query
    };

    let usuarios;
    try {
      usuarios = await api.get('/api/usuarios', { query });
    } catch (err) {
      // Se alguma coluna de atividade ainda não existir na tabela, o upstream
      // recusa o select inteiro. Nesse caso, cai para os campos base.
      console.warn('[usuarios] select estendido falhou; usando campos base.', err?.message || err);
      usuarios = await api.get('/api/usuarios', { ...query, select: camposBase });
    }
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
    const modelos = Array.isArray(linhas) ? linhas.map(l => mapModelo(l)) : [];
    // O modal espera { modelos: [...] } — devolver um array puro fazia a lista
    // de perfis vir vazia (data.modelos === undefined).
    res.json({ modelos });
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
 * A coluna usuarios.status tem CHECK constraint e só aceita os valores
 * INTERNOS ('ativo', 'aguardando_aprovacao', 'nao_confirmado').
 * A interface trabalha com rótulos ("Ativo", "Inativo", "Não confirmado"),
 * que violavam a constraint (erro "usuarios_status_check").
 * Normalizamos aqui, no backend, para proteger qualquer chamador.
 */
const STATUS_INTERNOS = new Set(['ativo', 'aguardando_aprovacao', 'nao_confirmado']);

function normalizarStatusUsuario(valor) {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return null;

  const chave = bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

  if (STATUS_INTERNOS.has(chave)) return chave;

  const mapa = {
    ativo: 'ativo', ativa: 'ativo', active: 'ativo', habilitado: 'ativo', confirmado: 'ativo',
    inativo: 'aguardando_aprovacao', inativa: 'aguardando_aprovacao', inativado: 'aguardando_aprovacao',
    desativado: 'aguardando_aprovacao', desativada: 'aguardando_aprovacao',
    desabilitado: 'aguardando_aprovacao', desabilitada: 'aguardando_aprovacao',
    pendente: 'aguardando_aprovacao', pending: 'aguardando_aprovacao',
    aguardando: 'aguardando_aprovacao', aguardando_aprovacao: 'aguardando_aprovacao',
    nao_confirmado: 'nao_confirmado', nao_confirmada: 'nao_confirmado',
    naoconfirmado: 'nao_confirmado', unconfirmed: 'nao_confirmado',
    aguardando_confirmacao: 'nao_confirmado', pendente_confirmacao: 'nao_confirmado',
    email_nao_confirmado: 'nao_confirmado'
  };

  return mapa[chave] || null;
}

/**
 * GET /usuarios/perfis
 * Lista os perfis disponíveis para o combo do modal de edição.
 * Junta os modelos de permissão com os valores de "perfil" já usados pelos
 * usuários, para não perder perfis legados que ainda não viraram modelo.
 */
router.get('/perfis', async (req, res) => {
  try {
    const api = createInternalApiClient();
    const [modelos, usuarios] = await Promise.all([
      api.get('/api/modelos_permissoes', { query: { order: 'nome' } }).catch(() => []),
      api.get('/api/usuarios', { query: { select: 'perfil' } }).catch(() => [])
    ]);

    const perfis = [];
    const vistos = new Set();

    for (const m of Array.isArray(modelos) ? modelos : []) {
      const nome = String(m?.nome || '').trim();
      if (!nome || vistos.has(nome.toLowerCase())) continue;
      vistos.add(nome.toLowerCase());
      perfis.push({ id: m.id, nome, modelo: true });
    }
    for (const u of Array.isArray(usuarios) ? usuarios : []) {
      const nome = String(u?.perfil || '').trim();
      if (!nome || vistos.has(nome.toLowerCase())) continue;
      vistos.add(nome.toLowerCase());
      perfis.push({ id: null, nome, modelo: false });
    }

    perfis.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    res.json({ perfis });
  } catch (err) {
    console.error('Erro ao listar perfis:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar perfis' });
  }
});

/**
 * PUT /usuarios/:id/dados
 * Dados pessoais do modal de edição. O modal chamava esta rota, que não
 * existia — por isso "não foi possível salvar os dados pessoais".
 */
router.put('/:id/dados', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  try {
    const api = createInternalApiClient();

    const payload = {};
    if (body.nome !== undefined) payload.nome = body.nome;
    if (body.email !== undefined) payload.email = body.email;
    if (body.telefone !== undefined) payload.telefone = body.telefone;
    if (body.status !== undefined) {
      const st = normalizarStatusUsuario(body.status);
      if (!st) return res.status(400).json({ error: `Status inválido: ${body.status}` });
      payload.status = st;
    }
    if (body.observacoes !== undefined) payload.observacoes = body.observacoes;

    // Perfil: grava o texto e, quando ele corresponder a um modelo de
    // permissão, também vincula o modelo (é o que faz as permissões valerem).
    if (body.perfil !== undefined) {
      const perfil = String(body.perfil || '').trim();
      payload.perfil = perfil;
      if (perfil) {
        const modelos = await api
          .get('/api/modelos_permissoes', { query: { nome: perfil } })
          .catch(() => []);
        const modelo = Array.isArray(modelos)
          ? modelos.find(m => String(m?.nome).trim().toLowerCase() === perfil.toLowerCase())
          : null;
        if (modelo?.id) payload.modelo_permissoes_id = modelo.id;
      }
    }
    if (body.modeloPermissoesId !== undefined) {
      payload.modelo_permissoes_id = body.modeloPermissoesId || null;
    }

    await api.put(`/api/usuarios/${id}`, payload);
    try { require('./permissionsController').limparCachePermissoes(); } catch (_) {}
    // devolve o usuário completo para o front atualizar a linha sem recarregar
    const atualizado = await api.get(`/api/usuarios/${id}`).catch(() => null);
    res.json({
      success: true,
      modeloPermissoesId: payload.modelo_permissoes_id ?? null,
      usuario: atualizado || null,
      ...(atualizado || {}),
      statusInterno: atualizado?.status ?? payload.status ?? null
    });
  } catch (err) {
    console.error('Erro ao salvar dados do usuário:', err);
    res.status(err.status || 500).json({ error: 'Erro ao salvar dados do usuário' });
  }
});

/**
 * PATCH /usuarios/:id/status
 * Ativar/desativar acesso (ícone de tomada na listagem). Também não existia.
 */
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const status = normalizarStatusUsuario(req.body?.status);
  if (!status) return res.status(400).json({ error: `Status inválido: ${req.body?.status ?? ''}` });

  try {
    const api = createInternalApiClient();
    const payload = { status };
    // registra quando o acesso foi (re)ativado, usado no tooltip da listagem
    if (status === 'ativo') payload.data_ativacao = new Date().toISOString();
    await api.put(`/api/usuarios/${id}`, payload);
    try { require('./permissionsController').limparCachePermissoes(); } catch (_) {}
    // devolve o usuário completo: o front usa isso para atualizar só aquela
    // linha da tabela, em vez de recarregar/refiltrar a lista inteira.
    const atualizado = await api.get(`/api/usuarios/${id}`).catch(() => null);
    res.json({
      success: true,
      id: Number(id),
      status,
      statusInterno: status,
      ...(atualizado || {}),
      usuario: atualizado || null
    });
  } catch (err) {
    console.error('Erro ao atualizar status do usuário:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar status do usuário' });
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
