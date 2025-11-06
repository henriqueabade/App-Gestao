const db = require('../db');

function normalizeCode(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

function coerceArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value].filter(Boolean);
}

function coerceJson(value, fallback = {}) {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }
  return { ...value };
}

async function getRoleByCode(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) {
    return null;
  }

  const { rows } = await db.query(
    `SELECT id, code, name, description, created_at, updated_at
       FROM rbac.role
      WHERE LOWER(code) = $1
      LIMIT 1`,
    [code]
  );

  return rows[0] || null;
}

async function getPermissionsVersion(rawRoleId) {
  const roleId = rawRoleId ? Number(rawRoleId) : null;
  if (!roleId || Number.isNaN(roleId)) {
    return null;
  }

  const { rows } = await db.query(
    `SELECT r.updated_at AS role_updated_at,
            modules.max_updated_at  AS module_updated_at,
            features.max_updated_at AS feature_updated_at,
            columns.max_updated_at  AS column_updated_at
       FROM rbac.role r
       LEFT JOIN (
             SELECT role_id, MAX(updated_at) AS max_updated_at
               FROM rbac.role_module_access
              WHERE role_id = $1
              GROUP BY role_id
       ) AS modules ON modules.role_id = r.id
       LEFT JOIN (
             SELECT role_id, MAX(updated_at) AS max_updated_at
               FROM rbac.role_feature_access
              WHERE role_id = $1
              GROUP BY role_id
       ) AS features ON features.role_id = r.id
       LEFT JOIN (
             SELECT role_id, MAX(updated_at) AS max_updated_at
               FROM rbac.role_column_access
              WHERE role_id = $1
              GROUP BY role_id
       ) AS columns ON columns.role_id = r.id
      WHERE r.id = $1`,
    [roleId]
  );

  if (!rows || rows.length === 0) {
    return null;
  }

  const timestamps = [
    rows[0].role_updated_at,
    rows[0].module_updated_at,
    rows[0].feature_updated_at,
    rows[0].column_updated_at
  ]
    .map(value => {
      if (!value) return null;
      if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? null : time;
      }
      const time = new Date(value).getTime();
      return Number.isNaN(time) ? null : time;
    })
    .filter(time => time !== null);

  if (timestamps.length === 0) {
    return null;
  }

  return String(Math.max(...timestamps));
}

async function listAllModules() {
  const { rows } = await db.query(
    `SELECT id, code, name, description, aliases, order_index
       FROM rbac.module
      ORDER BY order_index NULLS LAST, code`
  );

  return rows.map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    aliases: coerceArray(row.aliases),
    order: row.order_index
  }));
}

async function listFeaturesForModule(rawModuleCode) {
  const moduleCode = normalizeCode(rawModuleCode);
  if (!moduleCode) {
    return [];
  }

  const { rows } = await db.query(
    `SELECT f.id,
            f.code,
            f.name,
            f.description,
            f.aliases,
            f.order_index
       FROM rbac.feature f
       JOIN rbac.module m ON m.id = f.module_id
      WHERE LOWER(m.code) = $1
      ORDER BY f.order_index NULLS LAST, f.code`,
    [moduleCode]
  );

  return rows.map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    aliases: coerceArray(row.aliases),
    order: row.order_index
  }));
}

async function getModulesWithAccess(roleId) {
  if (!roleId) {
    return [];
  }

  const { rows } = await db.query(
    `SELECT m.id,
            m.code,
            m.name,
            m.description,
            m.aliases,
            m.order_index,
            rma.permitted,
            COALESCE(rma.metadata, '{}'::jsonb) AS metadata
       FROM rbac.module m
       LEFT JOIN rbac.role_module_access rma
         ON rma.module_id = m.id AND rma.role_id = $1
      ORDER BY m.order_index NULLS LAST, m.code`,
    [roleId]
  );

  return rows.map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    aliases: coerceArray(row.aliases),
    order: row.order_index,
    permitted: Boolean(row.permitted),
    metadata: coerceJson(row.metadata)
  }));
}

async function getFeaturesByRoleAndModule(roleId, rawModuleCode) {
  if (!roleId) {
    return [];
  }

  const moduleCode = normalizeCode(rawModuleCode);
  if (!moduleCode) {
    return [];
  }

  const { rows } = await db.query(
    `SELECT f.id,
            f.code,
            f.name,
            f.description,
            f.aliases,
            f.order_index,
            COALESCE(rfa.permitted, false) AS permitted,
            COALESCE(rfa.scopes, '{}'::jsonb) AS scopes,
            COALESCE(rfa.metadata, '{}'::jsonb) AS metadata
       FROM rbac.feature f
       JOIN rbac.module m ON m.id = f.module_id
       LEFT JOIN rbac.role_feature_access rfa
         ON rfa.feature_id = f.id AND rfa.role_id = $1
      WHERE LOWER(m.code) = $2
      ORDER BY f.order_index NULLS LAST, f.code`,
    [roleId, moduleCode]
  );

  return rows.map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    aliases: coerceArray(row.aliases),
    order: row.order_index,
    permitted: Boolean(row.permitted),
    scopes: coerceJson(row.scopes),
    metadata: coerceJson(row.metadata)
  }));
}

async function getGridColumns(roleId, rawModuleCode, rawTableCode) {
  if (!roleId) {
    return [];
  }

  const moduleCode = normalizeCode(rawModuleCode);
  if (!moduleCode) {
    return [];
  }

  const params = [roleId, moduleCode];
  let tableFilter = '';
  if (rawTableCode) {
    const tableCode = normalizeCode(rawTableCode);
    if (tableCode) {
      params.push(tableCode);
      tableFilter = ' AND LOWER(t.code) = $3';
    }
  }

  const { rows } = await db.query(
    `SELECT c.id,
            c.code,
            c.name,
            c.description,
            c.data_type,
            c.metadata,
            c.order_index,
            t.code   AS table_code,
            t.name   AS table_name,
            t.order_index AS table_order,
            COALESCE(rca.can_view, false) AS can_view,
            COALESCE(rca.can_edit, false) AS can_edit,
            rca.feature_code
       FROM rbac.ui_column c
       JOIN rbac.ui_table t ON t.id = c.ui_table_id
       JOIN rbac.module m ON m.id = t.module_id
       LEFT JOIN rbac.role_column_access rca
         ON rca.ui_column_id = c.id AND rca.role_id = $1
      WHERE LOWER(m.code) = $2${tableFilter}
      ORDER BY t.order_index NULLS LAST,
               t.code,
               c.order_index NULLS LAST,
               c.code`,
    params
  );

  return rows.map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    data_type: row.data_type,
    metadata: coerceJson(row.metadata),
    order: row.order_index,
    table_code: row.table_code,
    table_name: row.table_name,
    table_order: row.table_order,
    can_view: Boolean(row.can_view),
    can_edit: Boolean(row.can_edit),
    feature_code: row.feature_code
  }));
}

module.exports = {
  getRoleByCode,
  getModulesWithAccess,
  getFeaturesByRoleAndModule,
  getGridColumns,
  listAllModules,
  listFeaturesForModule,
  getPermissionsVersion
};
