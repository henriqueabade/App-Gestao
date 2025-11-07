const db = require('./db');

const ROLE_COLUMN_CANDIDATES = ['role_id', 'perfil_id', 'modelo_id', 'modelo_permissoes_id', 'model_id'];
const MODULE_COLUMN_CANDIDATES = ['modulo', 'module', 'modulo_nome', 'module_name'];
const ACTION_COLUMN_CANDIDATES = ['acao', 'funcao', 'action', 'function'];
const ALLOWED_COLUMN_CANDIDATES = ['permitido', 'allowed', 'permitted', 'habilitado', 'enabled', 'ativo', 'active'];
const SCOPE_COLUMN_CANDIDATES = ['escopos', 'scopes', 'scope'];
const FIELD_COLUMN_CANDIDATES = ['campo', 'coluna', 'column', 'field'];
const MODULE_TITLE_COLUMN_CANDIDATES = ['modulo_titulo', 'module_title', 'modulo_label', 'module_label', 'modulo_nome', 'module_name'];
const MODULE_DESCRIPTION_COLUMN_CANDIDATES = [
  'modulo_descricao',
  'module_description',
  'modulo_desc',
  'module_desc',
  'modulo_detalhes',
  'module_details'
];
const ACTION_TITLE_COLUMN_CANDIDATES = ['acao_titulo', 'action_title', 'funcao_titulo', 'acao_label', 'action_label'];
const ACTION_DESCRIPTION_COLUMN_CANDIDATES = [
  'acao_descricao',
  'action_description',
  'funcao_descricao',
  'acao_desc',
  'action_desc',
  'funcao_desc'
];
const FIELD_TITLE_COLUMN_CANDIDATES = ['campo_titulo', 'coluna_titulo', 'field_title', 'campo_label', 'field_label'];
const FIELD_DESCRIPTION_COLUMN_CANDIDATES = [
  'campo_descricao',
  'coluna_descricao',
  'field_description',
  'campo_desc',
  'field_desc'
];

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

function formatDisplayName(value, fallback) {
  const base = value === null || value === undefined || value === '' ? fallback : value;
  if (base === null || base === undefined) return '';
  return String(base)
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function assignIfPresent(target, key, value) {
  if (!value) {
    return;
  }
  if (!target[key]) {
    target[key] = value;
    return;
  }
  if (typeof target[key] === 'string' && target[key].trim() === '') {
    target[key] = value;
  }
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

async function buildPermissionsStructure(client, existingCatalog) {
  const catalog = existingCatalog || (await loadPermissionsCatalog(client));
  const modules = new Map();

  const ensureModule = (moduleKey, initial = {}) => {
    if (!moduleKey) {
      return null;
    }
    const key = normalizeIdentifier(moduleKey);
    if (!key) {
      return null;
    }
    let entry = modules.get(key);
    if (!entry) {
      entry = {
        chave: key,
        modulo: moduleKey,
        titulo: formatDisplayName(moduleKey),
        descricao: '',
        campos: new Map()
      };
      modules.set(key, entry);
    }
    if (initial.titulo) {
      assignIfPresent(entry, 'titulo', initial.titulo);
    }
    if (initial.descricao) {
      assignIfPresent(entry, 'descricao', initial.descricao);
    }
    if (initial.modulo) {
      assignIfPresent(entry, 'modulo', initial.modulo);
    }
    return entry;
  };

  const ensureAction = (moduleEntry, actionName, initial = {}) => {
    if (!moduleEntry) {
      return null;
    }
    const actionKey = normalizeIdentifier(actionName || initial.chave || initial.nome);
    if (!actionKey) {
      return null;
    }
    let actionEntry = moduleEntry.campos.get(actionKey);
    if (!actionEntry) {
      actionEntry = {
        chave: actionKey,
        acao: actionName || initial.nome || actionKey,
        titulo: formatDisplayName(actionName || initial.nome || actionKey),
        descricao: '',
        colunas: new Map()
      };
      moduleEntry.campos.set(actionKey, actionEntry);
    }
    if (initial.titulo) {
      assignIfPresent(actionEntry, 'titulo', initial.titulo);
    }
    if (initial.descricao) {
      assignIfPresent(actionEntry, 'descricao', initial.descricao);
    }
    if (initial.acao) {
      assignIfPresent(actionEntry, 'acao', initial.acao);
    }
    return actionEntry;
  };

  const ensureField = (actionEntry, fieldName, initial = {}) => {
    if (!actionEntry) {
      return null;
    }
    const fieldKey = normalizeIdentifier(fieldName || initial.nome);
    if (!fieldKey) {
      return null;
    }
    let fieldEntry = actionEntry.colunas.get(fieldKey);
    if (!fieldEntry) {
      fieldEntry = {
        chave: fieldKey,
        campo: fieldName || initial.nome || fieldKey,
        titulo: formatDisplayName(fieldName || initial.nome || fieldKey),
        descricao: ''
      };
      actionEntry.colunas.set(fieldKey, fieldEntry);
    }
    if (initial.titulo) {
      assignIfPresent(fieldEntry, 'titulo', initial.titulo);
    }
    if (initial.descricao) {
      assignIfPresent(fieldEntry, 'descricao', initial.descricao);
    }
    if (initial.campo) {
      assignIfPresent(fieldEntry, 'campo', initial.campo);
    }
    return fieldEntry;
  };

  for (const moduleMeta of catalog.modules.values()) {
    const moduleEntry = ensureModule(moduleMeta.name || moduleMeta.key, {
      modulo: moduleMeta.name || moduleMeta.key,
      titulo: moduleMeta.name,
      descricao: moduleMeta.description
    });
    if (!moduleEntry) {
      continue;
    }
    for (const actionMeta of moduleMeta.actions.values()) {
      ensureAction(moduleEntry, actionMeta.name || actionMeta.key, {
        titulo: actionMeta.name,
        acao: actionMeta.name || actionMeta.key
      });
    }
  }

  const matrixColumns = catalog.matrix.table
    ? await getTableColumns(client, catalog.matrix.table)
    : [];
  const moduleTitleColumn = detectColumn(matrixColumns, MODULE_TITLE_COLUMN_CANDIDATES);
  const moduleDescriptionColumn = detectColumn(matrixColumns, MODULE_DESCRIPTION_COLUMN_CANDIDATES);
  const actionTitleColumn = detectColumn(matrixColumns, ACTION_TITLE_COLUMN_CANDIDATES);
  const actionDescriptionColumn = detectColumn(matrixColumns, ACTION_DESCRIPTION_COLUMN_CANDIDATES);

  if (catalog.matrix.moduleColumn) {
    const selectParts = [`${catalog.matrix.moduleColumn} AS modulo`];
    if (moduleTitleColumn) {
      selectParts.push(`${moduleTitleColumn} AS modulo_titulo`);
    }
    if (moduleDescriptionColumn) {
      selectParts.push(`${moduleDescriptionColumn} AS modulo_descricao`);
    }
    if (catalog.matrix.actionColumn) {
      selectParts.push(`${catalog.matrix.actionColumn} AS acao`);
      if (actionTitleColumn) {
        selectParts.push(`${actionTitleColumn} AS acao_titulo`);
      }
      if (actionDescriptionColumn) {
        selectParts.push(`${actionDescriptionColumn} AS acao_descricao`);
      }
    }
    const query = `SELECT DISTINCT ${selectParts.join(', ')} FROM ${catalog.matrix.table} WHERE ${catalog.matrix.moduleColumn} IS NOT NULL`;
    const { rows } = await runQuery(client, query);
    for (const row of rows) {
      const moduleEntry = ensureModule(row.modulo, {
        titulo: row.modulo_titulo,
        descricao: row.modulo_descricao
      });
      if (!moduleEntry || !catalog.matrix.actionColumn) {
        continue;
      }
      const actionEntry = ensureAction(moduleEntry, row.acao, {
        titulo: row.acao_titulo,
        descricao: row.acao_descricao
      });
      if (actionEntry && row.acao) {
        assignIfPresent(actionEntry, 'acao', row.acao);
      }
    }
  }

  for (const tableInfo of catalog.permTables.values()) {
    if (!tableInfo.table || !tableInfo.actionColumn || !tableInfo.fieldColumn) {
      continue;
    }
    const columns = await getTableColumns(client, tableInfo.table);
    const fieldTitleColumn = detectColumn(columns, FIELD_TITLE_COLUMN_CANDIDATES);
    const fieldDescriptionColumn = detectColumn(columns, FIELD_DESCRIPTION_COLUMN_CANDIDATES);
    const actionTitleColumnTable = detectColumn(columns, ACTION_TITLE_COLUMN_CANDIDATES);
    const actionDescriptionColumnTable = detectColumn(columns, ACTION_DESCRIPTION_COLUMN_CANDIDATES);
    const moduleColumnCandidate = detectColumn(columns, MODULE_COLUMN_CANDIDATES);

    const selectParts = [
      `${tableInfo.fieldColumn} AS campo`,
      `${tableInfo.actionColumn} AS acao`
    ];
    if (fieldTitleColumn) {
      selectParts.push(`${fieldTitleColumn} AS campo_titulo`);
    }
    if (fieldDescriptionColumn) {
      selectParts.push(`${fieldDescriptionColumn} AS campo_descricao`);
    }
    if (actionTitleColumnTable) {
      selectParts.push(`${actionTitleColumnTable} AS acao_titulo`);
    }
    if (actionDescriptionColumnTable) {
      selectParts.push(`${actionDescriptionColumnTable} AS acao_descricao`);
    }
    if (moduleColumnCandidate) {
      selectParts.push(`${moduleColumnCandidate} AS modulo`);
    }

    const query = `SELECT DISTINCT ${selectParts.join(', ')} FROM ${tableInfo.table} WHERE ${tableInfo.fieldColumn} IS NOT NULL`;
    const { rows } = await runQuery(client, query);
    for (const row of rows) {
      const moduleEntry = ensureModule(row.modulo || tableInfo.moduleKey, {
        modulo: row.modulo || tableInfo.moduleKey
      });
      const actionEntry = ensureAction(moduleEntry, row.acao, {
        titulo: row.acao_titulo,
        descricao: row.acao_descricao
      });
      ensureField(actionEntry, row.campo, {
        titulo: row.campo_titulo,
        descricao: row.campo_descricao,
        campo: row.campo
      });
    }
  }

  const resultado = [];
  for (const moduleEntry of modules.values()) {
    const campos = [];
    for (const actionEntry of moduleEntry.campos.values()) {
      const colunas = Array.from(actionEntry.colunas.values()).map(field => ({
        ...field,
        nome: field.chave,
        permitido: false
      }));
      campos.push({
        chave: actionEntry.chave,
        acao: actionEntry.acao,
        titulo: actionEntry.titulo,
        descricao: actionEntry.descricao,
        permitido: false,
        colunas
      });
    }
    campos.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
    resultado.push({
      chave: moduleEntry.chave,
      modulo: moduleEntry.modulo,
      titulo: moduleEntry.titulo,
      descricao: moduleEntry.descricao,
      campos
    });
  }

  resultado.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
  return resultado;
}

module.exports = {
  loadPermissionsCatalog,
  loadPermissionsForRole,
  savePermissionsForRole,
  deletePermissionsForRole,
  buildPermissionsStructure
};
