const db = require('./db');
const {
  loadPermissionsCatalog,
  loadPermissionsForRole,
  savePermissionsForRole,
  deletePermissionsForRole
} = require('./permissionsCatalogRepository');

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

function mergePermissoes(base, override) {
  const resultado = Array.isArray(base) ? [...base] : { ...base };
  if (!override || typeof override !== 'object') {
    return resultado;
  }

  const mergeObjeto = (destino, origem) => {
    for (const [chave, valorOrigem] of Object.entries(origem)) {
      if (valorOrigem && typeof valorOrigem === 'object' && !Array.isArray(valorOrigem)) {
        const atual = destino[chave];
        if (!atual || typeof atual !== 'object' || Array.isArray(atual)) {
          destino[chave] = Array.isArray(valorOrigem) ? [...valorOrigem] : {};
        }
        mergeObjeto(destino[chave], valorOrigem);
      } else if (Array.isArray(valorOrigem)) {
        destino[chave] = [...valorOrigem];
      } else {
        destino[chave] = valorOrigem;
      }
    }
  };

  mergeObjeto(resultado, override);
  return resultado;
}

function mapRow(row, permissoes) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    permissoes: permissoes ?? row.permissoes ?? {},
    criadoEm: row.criado_em ?? row.created_at ?? null,
    atualizadoEm: row.atualizado_em ?? row.updated_at ?? null
  };
}

async function carregarPermissoesNormalizadas(client, linhas, catalogo) {
  const modelos = [];
  for (const row of linhas) {
    const permissoesBase = parsePermissoesValor(row.permissoes);
    const permissoesDb = await loadPermissionsForRole(client, row.id, catalogo);
    const permissoesFinais = Object.keys(permissoesDb).length
      ? mergePermissoes(permissoesBase, permissoesDb)
      : permissoesBase;
    modelos.push(mapRow(row, permissoesFinais));
  }
  return modelos;
}

async function listModelosPermissoes() {
  const client = await db.connect();
  try {
    const { rows } = await client.query(
      'SELECT id, nome, permissoes, criado_em, atualizado_em FROM modelos_permissoes ORDER BY nome ASC'
    );
    const catalogo = await loadPermissionsCatalog(client);
    const modelos = await carregarPermissoesNormalizadas(client, rows, catalogo);
    return modelos;
  } finally {
    client.release();
  }
}

async function getModeloPermissoesById(id) {
  const client = await db.connect();
  try {
    const { rows } = await client.query(
      'SELECT id, nome, permissoes, criado_em, atualizado_em FROM modelos_permissoes WHERE id = $1',
      [id]
    );
    if (!rows.length) {
      return null;
    }
    const catalogo = await loadPermissionsCatalog(client);
    const [modelo] = await carregarPermissoesNormalizadas(client, rows, catalogo);
    return modelo ?? null;
  } finally {
    client.release();
  }
}

async function createModeloPermissoes({ nome, permissoes }) {
  const sanitizedNome = sanitizeNome(nome);
  await ensureNomeDisponivel(sanitizedNome);

  const permissoesNormalizadas = permissoes ?? {};
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO modelos_permissoes (nome, permissoes) VALUES ($1, $2) RETURNING id, nome, permissoes, criado_em, atualizado_em',
      [sanitizedNome, permissoesNormalizadas]
    );
    const criado = rows[0];
    await savePermissionsForRole(client, criado.id, permissoesNormalizadas);
    await client.query('COMMIT');
    return getModeloPermissoesById(criado.id);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Falha ao desfazer transação de criação de modelo de permissões:', rollbackErr);
    }
    if (err.code === '23505') {
      throw new ModeloPermissoesError('Já existe um modelo com este nome.', 'NOME_DUPLICADO');
    }
    throw err;
  } finally {
    client.release();
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

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let rowAtualizado = null;
    if (campos.length) {
      const { rows } = await client.query(
        `UPDATE modelos_permissoes SET ${campos.join(', ')} WHERE id = $${valores.length} RETURNING id, nome, permissoes, criado_em, atualizado_em`,
        valores
      );
      rowAtualizado = rows[0] ?? null;
    } else {
      const { rows } = await client.query(
        'SELECT id, nome, permissoes, criado_em, atualizado_em FROM modelos_permissoes WHERE id = $1',
        [id]
      );
      rowAtualizado = rows[0] ?? null;
    }

    if (!rowAtualizado) {
      await client.query('ROLLBACK');
      return null;
    }

    if (permissoes !== undefined) {
      await savePermissionsForRole(client, id, permissoes);
    }

    await client.query('COMMIT');
    return getModeloPermissoesById(id);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Falha ao desfazer transação de atualização de modelo de permissões:', rollbackErr);
    }
    if (err.code === '23505') {
      throw new ModeloPermissoesError('Já existe um modelo com este nome.', 'NOME_DUPLICADO');
    }
    throw err;
  } finally {
    client.release();
  }
}

async function deleteModeloPermissoes(id) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await deletePermissionsForRole(client, id);
    const { rowCount } = await client.query('DELETE FROM modelos_permissoes WHERE id = $1', [id]);
    if (!rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('COMMIT');
    return true;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Falha ao desfazer transação de remoção de modelo de permissões:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
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
