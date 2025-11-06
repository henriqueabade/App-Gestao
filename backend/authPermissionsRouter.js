const express = require('express');

const {
  getRoleByCode,
  getModulesWithAccess,
  getFeaturesByRoleAndModule,
  getGridColumns,
  getPermissionsVersion
} = require('./rbac/permissionsRepository');

const router = express.Router();

const roleCaches = new Map();

function toCleanString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function extractFirstValue(raw) {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const cleaned = toCleanString(item);
      if (cleaned) {
        return cleaned;
      }
    }
    return '';
  }
  return toCleanString(raw);
}

function extractRoleCode(req) {
  const candidates = [
    req?.user?.role?.code,
    req?.user?.role_code,
    req?.user?.roleCode,
    req?.headers?.['x-role-code'],
    req?.headers?.['x-role'],
    req?.query?.role,
    req?.query?.role_code,
    req?.query?.roleCode
  ];

  for (const candidate of candidates) {
    const cleaned = extractFirstValue(candidate);
    if (cleaned) {
      return cleaned;
    }
  }

  return '';
}

function normalizeIdentifier(value) {
  return toCleanString(value).toLowerCase();
}

function parseModuleFilter(req) {
  const raw = req?.query?.module ?? req?.query?.modules ?? null;
  if (raw === undefined || raw === null) {
    return { set: null, cacheKey: '*' };
  }

  const values = Array.isArray(raw) ? raw : String(raw).split(',');
  const normalized = new Set();
  for (const value of values) {
    const cleaned = toCleanString(value);
    if (!cleaned) continue;
    normalized.add(cleaned.toLowerCase());
  }

  if (normalized.size === 0) {
    return { set: null, cacheKey: '*' };
  }

  const cacheKey = `modules:${Array.from(normalized).sort().join(',')}`;
  return { set: normalized, cacheKey };
}

function parseTableFilter(req) {
  const raw = req?.query?.table ?? req?.query?.tabela ?? null;
  const cleaned = extractFirstValue(raw);
  if (!cleaned) {
    return { value: null, cacheKey: '*' };
  }
  return { value: cleaned, cacheKey: cleaned.toLowerCase() };
}

function matchesIfNoneMatch(req, eTagValue) {
  const header = req?.headers?.['if-none-match'];
  if (!header) {
    return false;
  }

  const trimmed = header.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === '*') {
    return true;
  }

  return trimmed
    .split(',')
    .map(token => token.trim())
    .filter(Boolean)
    .includes(eTagValue);
}

function buildRoleSummary(role) {
  return {
    code: role.code,
    name: role.name,
    description: role.description ?? null
  };
}

function normalizeModule(module) {
  return {
    code: module.code,
    name: module.name ?? null,
    description: module.description ?? null,
    aliases: Array.isArray(module.aliases) ? module.aliases : [],
    order: module.order ?? null,
    permitted: Boolean(module.permitted),
    metadata: module.metadata && typeof module.metadata === 'object' ? { ...module.metadata } : {}
  };
}

function normalizeFeature(feature) {
  return {
    code: feature.code,
    name: feature.name ?? null,
    description: feature.description ?? null,
    aliases: Array.isArray(feature.aliases) ? feature.aliases : [],
    order: feature.order ?? null,
    permitted: Boolean(feature.permitted),
    scopes: feature.scopes && typeof feature.scopes === 'object' ? { ...feature.scopes } : {},
    metadata: feature.metadata && typeof feature.metadata === 'object' ? { ...feature.metadata } : {}
  };
}

function normalizeColumn(column) {
  return {
    code: column.code,
    name: column.name ?? null,
    description: column.description ?? null,
    data_type: column.data_type ?? null,
    metadata: column.metadata && typeof column.metadata === 'object' ? { ...column.metadata } : {},
    order: column.order ?? null,
    table_code: column.table_code ?? null,
    table_name: column.table_name ?? null,
    table_order: column.table_order ?? null,
    can_view: Boolean(column.can_view),
    can_edit: Boolean(column.can_edit),
    feature_code: column.feature_code ?? null
  };
}

function groupColumnsByTable(columns) {
  const grouped = {};

  for (const column of columns) {
    const key = column.table_code || 'default';
    if (!grouped[key]) {
      grouped[key] = {
        table_code: column.table_code ?? null,
        table_name: column.table_name ?? null,
        order: column.table_order ?? null,
        columns: []
      };
    }
    grouped[key].columns.push(column);
  }

  return grouped;
}

function createCacheEntry(role) {
  return {
    role,
    version: null,
    menu: new Map(),
    features: new Map(),
    grid: new Map(),
    bootstrap: new Map()
  };
}

async function ensureRoleContext(req, res) {
  const rawRoleCode = extractRoleCode(req);
  if (!rawRoleCode) {
    res.status(401).json({ error: 'role_required' });
    return null;
  }

  const normalizedRoleCode = rawRoleCode.toLowerCase();
  let cacheEntry = roleCaches.get(normalizedRoleCode);

  if (!cacheEntry) {
    const role = await getRoleByCode(rawRoleCode);
    if (!role) {
      res.status(404).json({ error: 'role_not_found', role: rawRoleCode });
      return null;
    }

    cacheEntry = createCacheEntry(role);
    roleCaches.set(normalizedRoleCode, cacheEntry);
  }

  const versionRaw = await getPermissionsVersion(cacheEntry.role.id);
  const version = versionRaw || '0';
  const eTagValue = `"${version}"`;

  if (matchesIfNoneMatch(req, eTagValue)) {
    res.set('ETag', eTagValue);
    res.status(304).end();
    return null;
  }

  if (cacheEntry.version !== version) {
    cacheEntry.version = version;
    cacheEntry.menu.clear();
    cacheEntry.features.clear();
    cacheEntry.grid.clear();
    cacheEntry.bootstrap.clear();
  }

  return {
    role: cacheEntry.role,
    cacheEntry,
    version,
    eTag: eTagValue
  };
}

async function ensureModules(cacheEntry) {
  let modules = cacheEntry.menu.get('*');
  if (!modules) {
    const rawModules = await getModulesWithAccess(cacheEntry.role.id);
    modules = rawModules.map(normalizeModule);
    cacheEntry.menu.set('*', modules);
  }
  return modules;
}

router.get('/menu', async (req, res) => {
  const context = await ensureRoleContext(req, res);
  if (!context) {
    return;
  }

  const { role, cacheEntry, version, eTag } = context;
  const filter = parseModuleFilter(req);

  let modules = cacheEntry.menu.get(filter.cacheKey);

  if (!modules) {
    const allModules = await ensureModules(cacheEntry);
    if (filter.set) {
      modules = allModules.filter(module => filter.set.has(module.code.toLowerCase()));
    } else {
      modules = allModules;
    }
    cacheEntry.menu.set(filter.cacheKey, modules);
  }

  res.set('ETag', eTag);
  res.json({
    permissions_version: version,
    role: buildRoleSummary(role),
    modules
  });
});

router.get('/features', async (req, res) => {
  const context = await ensureRoleContext(req, res);
  if (!context) {
    return;
  }

  const { role, cacheEntry, version, eTag } = context;
  const rawModule = extractFirstValue(req?.query?.module ?? req?.query?.modulo ?? null);
  if (!rawModule) {
    res.status(400).json({ error: 'module_required' });
    return;
  }

  const modules = await ensureModules(cacheEntry);
  const normalizedModuleCode = normalizeIdentifier(rawModule);
  const moduleEntry = modules.find(mod => normalizeIdentifier(mod.code) === normalizedModuleCode);

  if (!moduleEntry) {
    res.status(404).json({ error: 'module_not_found', module: rawModule });
    return;
  }

  const moduleKey = normalizeIdentifier(moduleEntry.code);

  let features = cacheEntry.features.get(moduleKey);
  if (!features) {
    const rawFeatures = await getFeaturesByRoleAndModule(role.id, moduleEntry.code);
    features = rawFeatures.map(normalizeFeature);
    cacheEntry.features.set(moduleKey, features);
  }

  res.set('ETag', eTag);
  res.json({
    permissions_version: version,
    role: buildRoleSummary(role),
    module: moduleEntry.code,
    features
  });
});

router.get('/grid', async (req, res) => {
  const context = await ensureRoleContext(req, res);
  if (!context) {
    return;
  }

  const { role, cacheEntry, version, eTag } = context;
  const rawModule = extractFirstValue(req?.query?.module ?? req?.query?.modulo ?? null);
  if (!rawModule) {
    res.status(400).json({ error: 'module_required' });
    return;
  }

  const modules = await ensureModules(cacheEntry);
  const normalizedModuleCode = normalizeIdentifier(rawModule);
  const moduleEntry = modules.find(mod => normalizeIdentifier(mod.code) === normalizedModuleCode);

  if (!moduleEntry) {
    res.status(404).json({ error: 'module_not_found', module: rawModule });
    return;
  }

  const moduleKey = normalizeIdentifier(moduleEntry.code);
  const tableFilter = parseTableFilter(req);
  const cacheKey = `${moduleKey}:${tableFilter.cacheKey}`;

  let columns = cacheEntry.grid.get(cacheKey);
  if (!columns) {
    const rawColumns = await getGridColumns(role.id, moduleEntry.code, tableFilter.value);
    columns = rawColumns.map(normalizeColumn);
    cacheEntry.grid.set(cacheKey, columns);
  }

  res.set('ETag', eTag);
  res.json({
    permissions_version: version,
    role: buildRoleSummary(role),
    module: moduleEntry.code,
    table: tableFilter.value ?? null,
    columns
  });
});

router.get('/bootstrap', async (req, res) => {
  const context = await ensureRoleContext(req, res);
  if (!context) {
    return;
  }

  const { role, cacheEntry, version, eTag } = context;

  let payload = cacheEntry.bootstrap.get('default');

  if (!payload) {
    const modules = await ensureModules(cacheEntry);
    const features = {};
    const grids = {};

    for (const moduleEntry of modules) {
      const moduleKey = normalizeIdentifier(moduleEntry.code);

      let featureList = cacheEntry.features.get(moduleKey);
      if (!featureList) {
        const rawFeatures = await getFeaturesByRoleAndModule(role.id, moduleEntry.code);
        featureList = rawFeatures.map(normalizeFeature);
        cacheEntry.features.set(moduleKey, featureList);
      }
      features[moduleEntry.code] = featureList;

      let columnList = cacheEntry.grid.get(`${moduleKey}:*`);
      if (!columnList) {
        const rawColumns = await getGridColumns(role.id, moduleEntry.code);
        columnList = rawColumns.map(normalizeColumn);
        cacheEntry.grid.set(`${moduleKey}:*`, columnList);
      }
      grids[moduleEntry.code] = {
        columns: columnList,
        tables: groupColumnsByTable(columnList)
      };
    }

    payload = { modules, features, grids };
    cacheEntry.bootstrap.set('default', payload);
  }

  res.set('ETag', eTag);
  res.json({
    permissions_version: version,
    role: buildRoleSummary(role),
    modules: payload.modules,
    features: payload.features,
    grids: payload.grids
  });
});

module.exports = router;
