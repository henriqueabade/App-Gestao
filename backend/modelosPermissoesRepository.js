const { createApiClient } = require('./apiHttpClient');

class ModeloPermissoesError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ModeloPermissoesError';
    if (code) this.code = code;
  }
}

function sanitizeNome(nome) {
  if (nome === undefined || nome === null) {
    throw new ModeloPermissoesError('Nome do modelo é obrigatório.', 'VALIDATION_ERROR');
  }
  if (typeof nome !== 'string') {
    throw new ModeloPermissoesError('Nome do modelo deve ser uma string.', 'VALIDATION_ERROR');
  }
  const trimmed = nome.trim();
  if (!trimmed) {
    throw new ModeloPermissoesError('Nome do modelo é obrigatório.', 'VALIDATION_ERROR');
  }
  if (trimmed.length > 120) {
    throw new ModeloPermissoesError('Nome do modelo deve ter no máximo 120 caracteres.', 'VALIDATION_ERROR');
  }
  return trimmed;
}

function parsePermissoesValor(valor) {
  if (!valor) return {};
  if (typeof valor === 'object') {
    return valor;
  }
  if (typeof valor === 'string') {
    const trimmed = valor.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      return {};
    }
  }
  return {};
}

function mapRow(row) {
  if (!row) return null;
  const permissoes = parsePermissoesValor(row.permissoes);
  return {
    id: row.id,
    nome: row.nome,
    permissoes,
    criadoEm: row.criado_em ?? row.created_at ?? null,
    atualizadoEm: row.atualizado_em ?? row.updated_at ?? null
  };
}

function mapApiError(err) {
  if (err?.status === 409 || err?.body?.code === 'NOME_DUPLICADO') {
    return new ModeloPermissoesError('Já existe um modelo com este nome.', 'NOME_DUPLICADO');
  }
  return err;
}

function createAuthenticatedClient() {
  return createApiClient();
}

async function ensureNomeDisponivel(nome, ignoreId) {
  const api = createAuthenticatedClient();
  const resposta = await api.get('/api/modelos_permissoes', { query: { nome } });
  const lista = Array.isArray(resposta) ? resposta : resposta ? [resposta] : [];
  const conflito = lista.find(item => {
    const nomeItem = (item?.nome ?? '').trim().toLowerCase();
    if (!nomeItem) return false;
    const mesmoId = ignoreId ? item?.id === ignoreId : false;
    return nomeItem === nome.toLowerCase() && !mesmoId;
  });
  if (conflito) {
    throw new ModeloPermissoesError('Já existe um modelo com este nome.', 'NOME_DUPLICADO');
  }
}

async function listModelosPermissoes() {
  const api = createAuthenticatedClient();
  const resposta = await api.get('/api/modelos_permissoes');
  const linhas = Array.isArray(resposta) ? resposta : [];
  return linhas.map(mapRow).filter(Boolean);
}

async function getModeloPermissoesById(id) {
  const api = createAuthenticatedClient();
  try {
    const modelo = await api.get(`/api/modelos_permissoes/${id}`);
    return mapRow(modelo);
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

async function createModeloPermissoes({ nome, permissoes }) {
  const sanitizedNome = sanitizeNome(nome);
  await ensureNomeDisponivel(sanitizedNome);

  const api = createAuthenticatedClient();
  try {
    const criado = await api.post('/api/modelos_permissoes', {
      nome: sanitizedNome,
      permissoes: permissoes ?? {}
    });
    return mapRow(criado);
  } catch (err) {
    throw mapApiError(err);
  }
}

async function updateModeloPermissoes(id, { nome, permissoes }) {
  const payload = {};

  if (nome !== undefined) {
    const sanitizedNome = sanitizeNome(nome);
    await ensureNomeDisponivel(sanitizedNome, id);
    payload.nome = sanitizedNome;
  }

  if (permissoes !== undefined) {
    payload.permissoes = permissoes;
  }

  if (!Object.keys(payload).length) {
    return getModeloPermissoesById(id);
  }

  const api = createAuthenticatedClient();
  try {
    const atualizado = await api.put(`/api/modelos_permissoes/${id}`, payload);
    return mapRow(atualizado) ?? getModeloPermissoesById(id);
  } catch (err) {
    if (err?.status === 404) return null;
    throw mapApiError(err);
  }
}

async function deleteModeloPermissoes(id) {
  const api = createAuthenticatedClient();
  try {
    await api.delete(`/api/modelos_permissoes/${id}`);
    return true;
  } catch (err) {
    if (err?.status === 404) return false;
    throw err;
  }
}

module.exports = {
  ModeloPermissoesError,
  listModelosPermissoes,
  getModeloPermissoesById,
  createModeloPermissoes,
  updateModeloPermissoes,
  deleteModeloPermissoes
};
