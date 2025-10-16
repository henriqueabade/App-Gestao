const db = require('./db');

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

async function ensureNomeDisponivel(nome, ignoreId) {
  const params = [nome.toLowerCase()];
  let query = 'SELECT id FROM modelos_permissoes WHERE lower(nome) = $1';
  if (ignoreId) {
    params.push(ignoreId);
    query += ' AND id <> $2';
  }
  const { rows } = await db.query(query, params);
  if (rows.length) {
    throw new ModeloPermissoesError('Já existe um modelo com este nome.', 'NOME_DUPLICADO');
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    permissoes: row.permissoes ?? {},
    criadoEm: row.criado_em ?? row.created_at ?? null,
    atualizadoEm: row.atualizado_em ?? row.updated_at ?? null
  };
}

async function listModelosPermissoes() {
  const { rows } = await db.query(
    'SELECT id, nome, permissoes, criado_em, atualizado_em FROM modelos_permissoes ORDER BY nome ASC'
  );
  return rows.map(mapRow);
}

async function getModeloPermissoesById(id) {
  const { rows } = await db.query(
    'SELECT id, nome, permissoes, criado_em, atualizado_em FROM modelos_permissoes WHERE id = $1',
    [id]
  );
  return mapRow(rows[0]);
}

async function createModeloPermissoes({ nome, permissoes }) {
  const sanitizedNome = sanitizeNome(nome);
  await ensureNomeDisponivel(sanitizedNome);

  try {
    const { rows } = await db.query(
      'INSERT INTO modelos_permissoes (nome, permissoes) VALUES ($1, $2) RETURNING id, nome, permissoes, criado_em, atualizado_em',
      [sanitizedNome, permissoes ?? {}]
    );
    return mapRow(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw new ModeloPermissoesError('Já existe um modelo com este nome.', 'NOME_DUPLICADO');
    }
    throw err;
  }
}

async function updateModeloPermissoes(id, { nome, permissoes }) {
  const campos = [];
  const valores = [];

  if (nome !== undefined) {
    const sanitizedNome = sanitizeNome(nome);
    await ensureNomeDisponivel(sanitizedNome, id);
    valores.push(sanitizedNome);
    campos.push(`nome = $${valores.length}`);
  }

  if (permissoes !== undefined) {
    valores.push(permissoes);
    campos.push(`permissoes = $${valores.length}`);
  }

  if (!campos.length) {
    return getModeloPermissoesById(id);
  }

  valores.push(id);

  try {
    const { rows } = await db.query(
      `UPDATE modelos_permissoes SET ${campos.join(', ')} WHERE id = $${valores.length} RETURNING id, nome, permissoes, criado_em, atualizado_em`,
      valores
    );
    return mapRow(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw new ModeloPermissoesError('Já existe um modelo com este nome.', 'NOME_DUPLICADO');
    }
    throw err;
  }
}

async function deleteModeloPermissoes(id) {
  const { rowCount } = await db.query('DELETE FROM modelos_permissoes WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  ModeloPermissoesError,
  listModelosPermissoes,
  getModeloPermissoesById,
  createModeloPermissoes,
  updateModeloPermissoes,
  deleteModeloPermissoes
};
