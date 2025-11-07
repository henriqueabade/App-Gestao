const db = require('./db');

const ROLE_COLUMN_CANDIDATES = ['role_id', 'perfil_id', 'modelo_id', 'modelo_permissoes_id', 'model_id'];
const MODULE_COLUMN_CANDIDATES = ['modulo', 'module', 'modulo_nome', 'module_name'];
const ACTION_COLUMN_CANDIDATES = ['acao', 'funcao', 'action', 'function'];
const ALLOWED_COLUMN_CANDIDATES = ['permitido', 'allowed', 'permitted', 'habilitado', 'enabled', 'ativo', 'active'];
const SCOPE_COLUMN_CANDIDATES = ['escopos', 'scopes', 'scope'];
const FIELD_COLUMN_CANDIDATES = ['campo', 'coluna', 'column', 'field'];

function normalizeIdentifier(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function booleanFromValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return [
      '1',
      'true',
      'yes',
      'y',
      'sim',
      'on',
      'permitido',
      'habilitado',
      'enabled',
      'ativo',
      'active'
    ].includes(normalized);
  }
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }
  return Boolean(value);
}

function detectColumn(columns, candidates) {
  if (!Array.isArray(columns) || !columns.length) {
    return null;
  }
  const lookup = new Map();
  for (const column of columns) {
    const key = normalizeIdentifier(column.column_name);
    if (key) {
      lookup.set(key, column.column_name);
    }
  }
  for (const candidate of candidates) {
    const normalized = normalizeIdentifier(candidate);
    if (lookup.has(normalized)) {
      return lookup.get(normalized);
    }
  }
  return null;
}

async function runQuery(client, text, params = []) {
  if (client && typeof client.query === 'function') {
    return client.query(text, params);
  }
  return db.query(text, params);
}

async function getTableColumns(client, tableName) {
  const { rows } = await runQuery(
    client,
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
    [tableName]
  );
  return rows;
}

async function listPermTables(client) {
  const { rows } = await runQuery(
    client,
    `SELECT table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_name LIKE 'perm_%'`
  );
  return rows.map(row => row.table_name);
}

function ensureModuleMetadata(modules, key, name) {
  const normalizedKey = normalizeIdentifier(key);
  if (!normalizedKey) {
    return null;
  }
  let entry = modules.get(normalizedKey);
  if (!entry) {
    entry = {
      key: normalizedKey,
      name: name ?? key,
      actions: new Map()
    };
    modules.set(normalizedKey, entry);
  } else if (name && !entry.name) {
    entry.name = name;
  }
  return entry;
}

function registerModuleAction(metadata, actionName, source) {
  const normalizedAction = normalizeIdentifier(actionName);
  if (!normalizedAction) {
    return null;
  }
  const actionEntry = metadata.actions.get(normalizedAction);
  if (actionEntry) {
    return actionEntry;
  }
  const created = {
    key: normalizedAction,
    name: actionName,
    source
  };
  metadata.actions.set(normalizedAction, created);
  return created;
}

function parseJsonValue(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      return undefined;
    }
  }
  return undefined;
}

async function loadPermissionsCatalog(client) {
  const modules = new Map();
  const matrixColumns = await getTableColumns(client, 'roles_modules_matrix');
  const roleColumn = detectColumn(matrixColumns, ROLE_COLUMN_CANDIDATES);
  const moduleColumn = detectColumn(matrixColumns, MODULE_COLUMN_CANDIDATES);
  const actionColumn = detectColumn(matrixColumns, ACTION_COLUMN_CANDIDATES);
  const allowedColumn = detectColumn(matrixColumns, ALLOWED_COLUMN_CANDIDATES);
  const scopeColumn = detectColumn(matrixColumns, SCOPE_COLUMN_CANDIDATES);

  if (moduleColumn) {
    const { rows } = await runQuery(
      client,
      `SELECT DISTINCT ${moduleColumn} AS module_name FROM roles_modules_matrix WHERE ${moduleColumn} IS NOT NULL`
    );
    for (const row of rows) {
      ensureModuleMetadata(modules, row.module_name, row.module_name);
    }
  }

  if (moduleColumn && actionColumn) {
    const { rows } = await runQuery(
      client,
      `SELECT DISTINCT ${moduleColumn} AS module_name, ${actionColumn} AS action_name FROM roles_modules_matrix WHERE ${moduleColumn} IS NOT NULL AND ${actionColumn} IS NOT NULL`
    );
    for (const row of rows) {
      const moduleMeta = ensureModuleMetadata(modules, row.module_name, row.module_name);
      if (moduleMeta) {
        registerModuleAction(moduleMeta, row.action_name, { type: 'matrix' });
      }
    }
  }

  const permTables = new Map();
  const permTableNames = await listPermTables(client);
  for (const tableName of permTableNames) {
    const moduleName = tableName.replace(/^perm_/, '');
    const moduleMeta = ensureModuleMetadata(modules, moduleName, moduleName);
    const columns = await getTableColumns(client, tableName);
    const tableInfo = {
      table: tableName,
      moduleKey: moduleMeta ? moduleMeta.key : normalizeIdentifier(moduleName),
      roleColumn: detectColumn(columns, ROLE_COLUMN_CANDIDATES),
      fieldColumn: detectColumn(columns, FIELD_COLUMN_CANDIDATES),
      actionColumn: detectColumn(columns, ACTION_COLUMN_CANDIDATES),
      allowedColumn: detectColumn(columns, ALLOWED_COLUMN_CANDIDATES)
    };

    permTables.set(tableInfo.moduleKey, tableInfo);

    if (moduleMeta && tableInfo.actionColumn) {
      const { rows } = await runQuery(
        client,
        `SELECT DISTINCT ${tableInfo.actionColumn} AS action_name FROM ${tableInfo.table} WHERE ${tableInfo.actionColumn} IS NOT NULL`
      );
      for (const row of rows) {
        registerModuleAction(moduleMeta, row.action_name, { type: 'perm_table', table: tableInfo.table });
      }
    }
  }

  return {
    matrix: {
      table: 'roles_modules_matrix',
      roleColumn,
      moduleColumn,
      actionColumn,
      allowedColumn,
      scopeColumn
    },
    modules,
    permTables
  };
}

function extractPermitido(valor) {
  if (valor === undefined || valor === null) {
    return false;
  }
  if (typeof valor === 'boolean') {
    return valor;
  }
  if (typeof valor === 'object') {
    for (const key of ['permitido', 'allowed', 'habilitado', 'enabled', 'valor', 'value', 'ativo', 'active']) {
      if (Object.prototype.hasOwnProperty.call(valor, key)) {
        return booleanFromValue(valor[key]);
      }
    }
    return false;
  }
  return booleanFromValue(valor);
}

function extractEscopos(valor) {
  if (!valor || typeof valor !== 'object') {
    return undefined;
  }
  const escopos = valor.escopos ?? valor.scopes;
  if (!escopos || typeof escopos !== 'object') {
    return undefined;
  }
  return escopos;
}

function normalizeCampos(campos, acao) {
  if (!campos || typeof campos !== 'object') {
    return [];
  }
  const resultados = [];
  for (const [campoNome, campoValor] of Object.entries(campos)) {
    if (campoValor === undefined) continue;
    let permitido;
    if (campoValor && typeof campoValor === 'object' && !Array.isArray(campoValor)) {
      if (Object.prototype.hasOwnProperty.call(campoValor, acao)) {
        permitido = booleanFromValue(campoValor[acao]);
      } else if (Object.prototype.hasOwnProperty.call(campoValor, 'permitido')) {
        permitido = booleanFromValue(campoValor.permitido);
      } else {
        permitido = booleanFromValue(campoValor);
      }
    } else {
      permitido = booleanFromValue(campoValor);
    }
    resultados.push({
      campo: campoNome,
      permitido
    });
  }
  return resultados;
}

function ensureResultadoAcao(resultado, moduloKey, acaoKey) {
  if (!resultado[moduloKey]) {
    resultado[moduloKey] = {};
  }
  if (!resultado[moduloKey][acaoKey]) {
    resultado[moduloKey][acaoKey] = {};
  }
  return resultado[moduloKey][acaoKey];
}

async function loadPermissionsForRole(client, roleId, existingCatalog) {
  if (!roleId) {
    return {};
  }

  const catalog = existingCatalog || (await loadPermissionsCatalog(client));
  const resultado = {};

  const matrix = catalog.matrix;
  if (matrix.roleColumn && matrix.moduleColumn && matrix.actionColumn) {
    const { rows } = await runQuery(
      client,
      `SELECT * FROM ${matrix.table} WHERE ${matrix.roleColumn} = $1`,
      [roleId]
    );
    for (const row of rows) {
      const moduloRaw = row[matrix.moduleColumn];
      const acaoRaw = row[matrix.actionColumn];
      if (!moduloRaw || !acaoRaw) {
        continue;
      }
      const moduloKey = normalizeIdentifier(moduloRaw);
      const acaoKey = normalizeIdentifier(acaoRaw);
      const acao = ensureResultadoAcao(resultado, moduloKey, acaoKey);
      if (matrix.allowedColumn && Object.prototype.hasOwnProperty.call(row, matrix.allowedColumn)) {
        acao.permitido = booleanFromValue(row[matrix.allowedColumn]);
      }
      if (matrix.scopeColumn && Object.prototype.hasOwnProperty.call(row, matrix.scopeColumn)) {
        const escopos = parseJsonValue(row[matrix.scopeColumn]);
        if (escopos && typeof escopos === 'object') {
          acao.escopos = escopos;
        }
      }
    }
  }

  for (const tableInfo of catalog.permTables.values()) {
    if (!tableInfo.roleColumn || !tableInfo.fieldColumn) {
      continue;
    }
    const { rows } = await runQuery(
      client,
      `SELECT * FROM ${tableInfo.table} WHERE ${tableInfo.roleColumn} = $1`,
      [roleId]
    );
    for (const row of rows) {
      const campoRaw = row[tableInfo.fieldColumn];
      if (!campoRaw) continue;
      const moduloKey = tableInfo.moduleKey;
      const acaoRaw = tableInfo.actionColumn ? row[tableInfo.actionColumn] : null;
      if (!acaoRaw) {
        continue;
      }
      const acaoKey = normalizeIdentifier(acaoRaw);
      const acao = ensureResultadoAcao(resultado, moduloKey, acaoKey);
      if (!acao.campos) {
        acao.campos = {};
      }
      const campoKey = normalizeIdentifier(campoRaw) || String(campoRaw);
      const campoEntrada = acao.campos[campoKey] || {};
      if (tableInfo.allowedColumn && Object.prototype.hasOwnProperty.call(row, tableInfo.allowedColumn)) {
        campoEntrada[acaoKey] = booleanFromValue(row[tableInfo.allowedColumn]);
      }
      acao.campos[campoKey] = campoEntrada;
    }
  }

  return resultado;
}

async function deletePermissionsForRole(client, roleId, existingCatalog) {
  const catalog = existingCatalog || (await loadPermissionsCatalog(client));
  if (catalog.matrix.roleColumn) {
    await runQuery(
      client,
      `DELETE FROM ${catalog.matrix.table} WHERE ${catalog.matrix.roleColumn} = $1`,
      [roleId]
    );
  }
  for (const tableInfo of catalog.permTables.values()) {
    if (!tableInfo.roleColumn) continue;
    await runQuery(
      client,
      `DELETE FROM ${tableInfo.table} WHERE ${tableInfo.roleColumn} = $1`,
      [roleId]
    );
  }
}

async function savePermissionsForRole(client, roleId, permissoes, existingCatalog) {
  const catalog = existingCatalog || (await loadPermissionsCatalog(client));
  await deletePermissionsForRole(client, roleId, catalog);

  if (!permissoes || typeof permissoes !== 'object') {
    return;
  }

  for (const [moduloNome, permissoesModulo] of Object.entries(permissoes)) {
    if (!permissoesModulo || typeof permissoesModulo !== 'object') {
      continue;
    }
    const moduloKey = normalizeIdentifier(moduloNome);
    for (const [acaoNome, detalhes] of Object.entries(permissoesModulo)) {
      const acaoKey = normalizeIdentifier(acaoNome);
      const permitido = extractPermitido(detalhes);
      const escopos = extractEscopos(detalhes);
      if (catalog.matrix.roleColumn && catalog.matrix.moduleColumn && catalog.matrix.actionColumn) {
        const valores = [roleId, moduloNome, acaoNome];
        const colunas = [catalog.matrix.roleColumn, catalog.matrix.moduleColumn, catalog.matrix.actionColumn];
        if (catalog.matrix.allowedColumn) {
          colunas.push(catalog.matrix.allowedColumn);
          valores.push(permitido);
        }
        if (catalog.matrix.scopeColumn) {
          colunas.push(catalog.matrix.scopeColumn);
          valores.push(escopos ? JSON.stringify(escopos) : null);
        }
        const placeholders = colunas.map((_, index) => `$${index + 1}`);
        await runQuery(
          client,
          `INSERT INTO ${catalog.matrix.table} (${colunas.join(', ')}) VALUES (${placeholders.join(', ')})`,
          valores
        );
      }

      const tableInfo = catalog.permTables.get(moduloKey);
      if (tableInfo && tableInfo.roleColumn && tableInfo.fieldColumn && tableInfo.actionColumn) {
        const camposNormalizados = normalizeCampos(detalhes?.campos ?? detalhes?.fields, acaoKey);
        for (const campo of camposNormalizados) {
          const valores = [roleId, campo.campo, acaoNome];
          const colunas = [tableInfo.roleColumn, tableInfo.fieldColumn, tableInfo.actionColumn];
          if (tableInfo.allowedColumn) {
            colunas.push(tableInfo.allowedColumn);
            valores.push(campo.permitido);
          }
          const placeholders = colunas.map((_, index) => `$${index + 1}`);
          await runQuery(
            client,
            `INSERT INTO ${tableInfo.table} (${colunas.join(', ')}) VALUES (${placeholders.join(', ')})`,
            valores
          );
        }
      }
    }
  }
}

module.exports = {
  loadPermissionsCatalog,
  loadPermissionsForRole,
  savePermissionsForRole,
  deletePermissionsForRole
};
