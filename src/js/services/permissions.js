(function () {
  const ENDPOINT = '/auth/permissions/bootstrap';
  const CACHE = new Map();
  const EVENT_NAME = 'permissions-bootstrap:update';
  const DEFAULT_ROLE_KEY = 'default';

  const arrayCoerce = (value) => {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
  };

  const toStringSafe = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return String(value);
  };

  const normalizeKey = (value) => {
    const raw = toStringSafe(value).trim();
    if (!raw) return null;
    return raw.toLowerCase();
  };

  const clone = (value) => {
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch (err) {
        // ignore structuredClone failures and fallback below
      }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return value;
    }
  };

  function readStoredUser() {
    try {
      const sessionStored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('currentUser') : null;
      const localStored = typeof localStorage !== 'undefined' ? localStorage.getItem('user') : null;
      const raw = sessionStored || localStored;
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[permissions] falha ao recuperar usuário armazenado', err);
      return null;
    }
  }

  function deriveRoleKey(user, payloadRole) {
    const candidates = [];
    const role = payloadRole && typeof payloadRole === 'object' ? payloadRole : null;

    if (role?.code) candidates.push(role.code);
    if (role?.id) candidates.push(role.id);

    if (user && typeof user === 'object') {
      candidates.push(user.role?.code, user.role?.id, user.role_code, user.roleCode, user.roleId);
      candidates.push(user.perfil, user.profile, user.tipo, user.role);
      candidates.push(user.papel, user.papelCodigo, user.perfilCodigo);
      if (user.permissions?.role) {
        candidates.push(user.permissions.role.code, user.permissions.role.id, user.permissions.role.slug);
      }
    }

    for (const candidate of candidates) {
      const normalized = normalizeKey(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return DEFAULT_ROLE_KEY;
  }

  function ensureMap(map, key) {
    if (!map.has(key)) {
      map.set(key, new Map());
    }
    return map.get(key);
  }

  function normalizeMenuItem(item, { index = 0, parent = null } = {}) {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const normalized = {};
    const codeCandidates = [item.code, item.key, item.id, item.slug, item.page, item.route, item.module];
    let code = null;
    for (const candidate of codeCandidates) {
      const normalizedCandidate = normalizeKey(candidate);
      if (normalizedCandidate) {
        code = normalizedCandidate;
        break;
      }
    }

    const typeCandidates = [item.type, item.itemType];
    const type = normalizeKey(typeCandidates.find(Boolean)) || (Array.isArray(item.children) || Array.isArray(item.items) ? 'group' : 'item');

    const childrenSource = item.children ?? item.items ?? item.submenu ?? item.nodes ?? [];
    const children = arrayCoerce(childrenSource)
      .map((child, childIndex) => normalizeMenuItem(child, { index: childIndex, parent: code || parent }))
      .filter(Boolean);

    normalized.code = code || (parent ? `${parent}:${index}` : `item:${index}`);
    normalized.page = toStringSafe(item.page ?? item.route ?? item.href ?? item.link ?? code ?? '').trim();
    const labelFallback = normalized.page || normalized.code || '';
    normalized.label = toStringSafe(item.label ?? item.title ?? item.name ?? labelFallback).trim();
    normalized.icon = toStringSafe(item.icon ?? item.iconClass ?? item.icon_name ?? item.iconName ?? '').trim();
    normalized.type = type === 'group' && !children.length ? 'item' : type;
    normalized.children = children;
    normalized.order = Number.isFinite(Number(item.order ?? item.order_index ?? item.position))
      ? Number(item.order ?? item.order_index ?? item.position)
      : index;
    normalized.metadata = item.metadata && typeof item.metadata === 'object' ? { ...item.metadata } : {};

    return normalized;
  }

  function normalizeMenu(menuSource) {
    const items = arrayCoerce(menuSource);
    return items
      .map((item, index) => normalizeMenuItem(item, { index }))
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  }

  function coerceObject(value, fallback = {}) {
    if (!value || typeof value !== 'object') {
      return { ...fallback };
    }
    return { ...value };
  }

  function appendAliases(collection, ...values) {
    values.forEach((value) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach((item) => appendAliases(collection, item));
        return;
      }
      const normalized = normalizeKey(value);
      if (normalized) {
        collection.add(normalized);
      }
    });
  }

  function normalizeFeature(moduleCode, feature, index = 0) {
    if (!feature || typeof feature !== 'object') {
      return null;
    }

    const codeCandidates = [feature.code, feature.key, feature.slug, feature.name, feature.identifier];
    let code = null;
    for (const candidate of codeCandidates) {
      const normalizedCandidate = normalizeKey(candidate);
      if (normalizedCandidate) {
        code = normalizedCandidate;
        break;
      }
    }
    if (!code) {
      code = `feature:${index}`;
    }

    const label = toStringSafe(feature.label ?? feature.name ?? feature.title ?? code).trim();
    const permitted = feature.permitted !== false && feature.allowed !== false && feature.enabled !== false;
    const scopes = coerceObject(feature.scopes ?? feature.permissions ?? feature.scoped ?? {});
    const metadata = coerceObject(feature.metadata ?? feature.meta ?? {});
    const aliases = new Set();
    appendAliases(aliases, feature.aliases, feature.alias, metadata.aliases, metadata.alias);

    const scopeFlags = {};
    Object.entries(scopes).forEach(([scopeKey, scopeValue]) => {
      const normalizedScopeKey = normalizeKey(scopeKey) || scopeKey;
      scopeFlags[normalizedScopeKey] = Boolean(scopeValue);
    });

    return {
      code,
      label,
      permitted,
      scopes: scopeFlags,
      metadata,
      aliases,
      moduleCode,
      raw: feature,
    };
  }

  function normalizeFeatures(featuresSource) {
    const moduleMap = new Map();
    if (!featuresSource) {
      return moduleMap;
    }

    const processModule = (moduleCode, featuresList) => {
      const normalizedModuleCode = normalizeKey(moduleCode) || moduleCode || 'default';
      const featureMap = ensureMap(moduleMap, normalizedModuleCode);
      arrayCoerce(featuresList)
        .map((feature, index) => normalizeFeature(normalizedModuleCode, feature, index))
        .filter(Boolean)
        .forEach((feature) => {
          featureMap.set(feature.code, feature);
          feature.aliases?.forEach((alias) => {
            if (!featureMap.has(alias)) {
              featureMap.set(alias, feature);
            }
          });
        });
    };

    if (Array.isArray(featuresSource)) {
      featuresSource.forEach((feature) => {
        const moduleCode = feature?.module ?? feature?.module_code ?? feature?.moduleCode ?? feature?.modulo ?? 'default';
        processModule(moduleCode, [feature]);
      });
    } else if (typeof featuresSource === 'object') {
      Object.entries(featuresSource).forEach(([moduleCode, value]) => {
        processModule(moduleCode, value);
      });
    }

    return moduleMap;
  }

  function normalizeColumn(column, index = 0) {
    if (!column || typeof column !== 'object') {
      return null;
    }
    const codeCandidates = [column.code, column.key, column.slug, column.field, column.name, column.identifier];
    let code = null;
    for (const candidate of codeCandidates) {
      const normalizedCandidate = normalizeKey(candidate);
      if (normalizedCandidate) {
        code = normalizedCandidate;
        break;
      }
    }
    if (!code) {
      code = `column:${index}`;
    }

    const metadata = coerceObject(column.metadata ?? column.meta ?? {});
    const label = toStringSafe(column.label ?? column.name ?? metadata.label ?? code).trim();
    const visibilityRaw = metadata.visibility ?? column.visibility ?? column.visible;
    const visibilityNormalized = normalizeKey(visibilityRaw);
    const visibility = visibilityNormalized === 'hidden' || visibilityNormalized === 'false' ? 'hidden' : 'visible';

    const mask = metadata.mask ?? metadata.mascara ?? column.mask ?? null;
    const canView = column.can_view !== undefined ? Boolean(column.can_view) : column.permitted !== false;
    const canEdit = column.can_edit !== undefined ? Boolean(column.can_edit) : Boolean(metadata.can_edit);
    const canSort = metadata.can_sort ?? metadata.sortable ?? column.can_sort ?? column.sortable;
    const canFilter = metadata.can_filter ?? column.can_filter ?? metadata.filterable;
    const exportPerm = metadata.export_perm ?? metadata.export ?? column.export_perm ?? column.exportable;
    const featureCode = normalizeKey(column.feature_code ?? metadata.feature ?? metadata.feature_code);

    const aliases = new Set();
    appendAliases(aliases, column.aliases, metadata.aliases, metadata.alias, column.key, column.field);

    return {
      code,
      label,
      visibility,
      mask: mask === undefined ? null : mask,
      canView,
      canEdit,
      canSort: canSort !== undefined ? Boolean(canSort) : true,
      canFilter: canFilter !== undefined ? Boolean(canFilter) : true,
      exportPerm: exportPerm !== undefined ? Boolean(exportPerm) : true,
      featureCode,
      metadata,
      aliases,
      raw: column,
    };
  }

  function normalizeColumns(columnsSource) {
    const moduleMap = new Map();
    if (!columnsSource || typeof columnsSource !== 'object') {
      return moduleMap;
    }

    const processTable = (moduleCode, tableCode, columnsList, tableMeta = {}) => {
      const normalizedModuleCode = normalizeKey(moduleCode) || moduleCode || 'default';
      const normalizedTableCode = normalizeKey(tableCode) || tableCode || 'default';
      const moduleEntry = ensureMap(moduleMap, normalizedModuleCode);
      const columns = [];
      const columnMap = new Map();

      arrayCoerce(columnsList)
        .map((column, index) => normalizeColumn(column, index))
        .filter(Boolean)
        .forEach((column) => {
          columns.push(column);
          columnMap.set(column.code, column);
          column.aliases?.forEach((alias) => {
            if (!columnMap.has(alias)) {
              columnMap.set(alias, column);
            }
          });
        });

      moduleEntry.set(normalizedTableCode, {
        code: normalizedTableCode,
        label: tableMeta?.label ?? tableMeta?.name ?? '',
        metadata: coerceObject(tableMeta.metadata ?? tableMeta.meta ?? {}),
        columns,
        columnMap,
      });
    };

    const entries = Object.entries(columnsSource);
    entries.forEach(([moduleCode, moduleTables]) => {
      if (Array.isArray(moduleTables)) {
        moduleTables.forEach((column) => {
          const tableCode = column?.table_code ?? column?.tableCode ?? column?.table ?? 'default';
          processTable(moduleCode, tableCode, [column], column?.tableMeta ?? column);
        });
        return;
      }

      if (moduleTables && typeof moduleTables === 'object') {
        Object.entries(moduleTables).forEach(([tableCode, value]) => {
          if (Array.isArray(value)) {
            processTable(moduleCode, tableCode, value, {});
          } else if (value && typeof value === 'object') {
            processTable(moduleCode, tableCode, value.columns ?? value.colunas ?? value.lista ?? [], value);
          }
        });
      }
    });

    return moduleMap;
  }

  function normalizeBootstrapPayload(payload) {
    const menu = normalizeMenu(payload?.menu ?? payload?.menus ?? payload?.itens ?? payload?.items ?? []);
    const features = normalizeFeatures(payload?.features ?? payload?.funcionalidades ?? payload?.permissoes ?? {});
    const columns = normalizeColumns(payload?.columns ?? payload?.colunas ?? payload?.grids ?? {});

    return {
      raw: payload || {},
      menu,
      features,
      columns,
      fetchedAt: Date.now(),
    };
  }

  function getCacheEntry(roleKey) {
    const normalizedKey = normalizeKey(roleKey) || DEFAULT_ROLE_KEY;
    if (!CACHE.has(normalizedKey)) {
      CACHE.set(normalizedKey, {
        roleKey: normalizedKey,
        promise: null,
        data: null,
        etag: null,
        lastFetched: 0,
      });
    }
    return CACHE.get(normalizedKey);
  }

  function dispatchUpdate(roleKey, data) {
    try {
      const eventDetail = { roleKey, data: clone(data) };
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: eventDetail }));
    } catch (err) {
      console.warn('[permissions] falha ao emitir evento de atualização', err);
    }
  }

  async function performFetch(roleKey, entry, { forceRefresh = false } = {}) {
    const headers = new Headers({ Accept: 'application/json' });
    if (entry.etag && !forceRefresh) {
      headers.set('If-None-Match', entry.etag);
    }

    let url = ENDPOINT;
    try {
      if (window.apiConfig?.resolveUrlAsync) {
        url = await window.apiConfig.resolveUrlAsync(ENDPOINT);
      } else if (window.apiConfig?.resolveUrl) {
        url = window.apiConfig.resolveUrl(ENDPOINT);
      }
    } catch (err) {
      console.warn('[permissions] falha ao resolver URL do endpoint', err);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
    });

    if (response.status === 304 && entry.data) {
      entry.lastFetched = Date.now();
      return entry.data;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => null);
      const error = new Error(text || `Falha ao carregar permissões (${response.status})`);
      error.status = response.status;
      throw error;
    }

    let payload = null;
    if (response.status !== 204) {
      payload = await response.json();
    }

    const normalized = normalizeBootstrapPayload(payload || {});
    entry.data = normalized;
    entry.etag = response.headers.get('ETag');
    entry.lastFetched = Date.now();
    dispatchUpdate(roleKey, normalized);
    return normalized;
  }

  async function loadBootstrap(options = {}) {
    const user = options.user ?? readStoredUser();
    const roleKey = normalizeKey(options.roleKey) || deriveRoleKey(user, options.role);
    const entry = getCacheEntry(roleKey);

    if (entry.promise) {
      return entry.promise;
    }

    if (entry.data && options.force !== true && options.forceRefresh !== true) {
      return entry.data;
    }

    entry.promise = performFetch(roleKey, entry, { forceRefresh: options.forceRefresh })
      .catch((err) => {
        if (!entry.data) {
          throw err;
        }
        console.warn('[permissions] falha ao atualizar bootstrap, usando cache anterior', err);
        return entry.data;
      })
      .finally(() => {
        entry.promise = null;
      });

    return entry.promise;
  }

  function getCached(roleKey) {
    const entry = getCacheEntry(roleKey);
    return entry.data;
  }

  function getActiveRoleKey() {
    const cachedUser = readStoredUser();
    return deriveRoleKey(cachedUser, null);
  }

  function getMenu(options = {}) {
    const roleKey = normalizeKey(options.roleKey) || getActiveRoleKey();
    const data = getCached(roleKey);
    return data?.menu ? clone(data.menu) : [];
  }

  function getFeaturesForModule(moduleCode, options = {}) {
    const roleKey = normalizeKey(options.roleKey) || getActiveRoleKey();
    const data = getCached(roleKey);
    if (!data) return [];
    const moduleMap = data.features.get(normalizeKey(moduleCode) || moduleCode || 'default');
    if (!moduleMap) return [];
    const unique = new Set();
    const result = [];
    moduleMap.forEach((feature, key) => {
      if (unique.has(feature.code)) return;
      unique.add(feature.code);
      result.push(feature);
    });
    return result;
  }

  function findFeature(moduleCode, featureCode, options = {}) {
    const roleKey = normalizeKey(options.roleKey) || getActiveRoleKey();
    const data = getCached(roleKey);
    if (!data) return null;
    const moduleMap = data.features.get(normalizeKey(moduleCode) || moduleCode || 'default');
    if (!moduleMap) return null;
    const normalizedFeature = normalizeKey(featureCode);
    if (normalizedFeature && moduleMap.has(normalizedFeature)) {
      return moduleMap.get(normalizedFeature);
    }
    if (!normalizedFeature) return null;
    let found = null;
    moduleMap.forEach((feature) => {
      if (found) return;
      if (feature.aliases?.has(normalizedFeature)) {
        found = feature;
      }
    });
    return found;
  }

  function isFeatureEnabled(moduleCode, featureCode, options = {}) {
    const feature = findFeature(moduleCode, featureCode, options);
    if (!feature) return false;
    if (!feature.permitted) return false;
    if (!options.scope) return feature.permitted;
    const normalizedScope = normalizeKey(options.scope) || options.scope;
    if (!normalizedScope) return feature.permitted;
    if (Object.prototype.hasOwnProperty.call(feature.scopes, normalizedScope)) {
      return Boolean(feature.scopes[normalizedScope]);
    }
    return feature.permitted;
  }

  function getColumns(moduleCode, tableCode, options = {}) {
    const roleKey = normalizeKey(options.roleKey) || getActiveRoleKey();
    const data = getCached(roleKey);
    if (!data) return [];
    const moduleEntry = data.columns.get(normalizeKey(moduleCode) || moduleCode || 'default');
    if (!moduleEntry) return [];
    const tableEntry = moduleEntry.get(normalizeKey(tableCode) || tableCode || 'default');
    if (!tableEntry) return [];
    return tableEntry.columns.map((column) => ({ ...column }));
  }

  function getColumn(moduleCode, tableCode, columnCode, options = {}) {
    const roleKey = normalizeKey(options.roleKey) || getActiveRoleKey();
    const data = getCached(roleKey);
    if (!data) return null;
    const moduleEntry = data.columns.get(normalizeKey(moduleCode) || moduleCode || 'default');
    if (!moduleEntry) return null;
    const tableEntry = moduleEntry.get(normalizeKey(tableCode) || tableCode || 'default');
    if (!tableEntry) return null;
    const normalizedColumn = normalizeKey(columnCode);
    if (!normalizedColumn) return null;
    if (tableEntry.columnMap.has(normalizedColumn)) {
      return tableEntry.columnMap.get(normalizedColumn);
    }
    let found = null;
    tableEntry.columnMap.forEach((column) => {
      if (found) return;
      if (column.aliases?.has(normalizedColumn)) {
        found = column;
      }
    });
    return found;
  }

  function clearCache(roleKey) {
    if (roleKey) {
      const normalized = normalizeKey(roleKey);
      if (normalized && CACHE.has(normalized)) {
        CACHE.delete(normalized);
      }
      return;
    }
    CACHE.clear();
  }

  window.permissionsService = {
    loadBootstrap,
    getMenu,
    getFeaturesForModule,
    findFeature,
    isFeatureEnabled,
    getColumns,
    getColumn,
    clearCache,
    getCached,
    getActiveRoleKey,
    EVENT_NAME,
  };
})();
