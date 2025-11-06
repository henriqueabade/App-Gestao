window.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('notificationBtn');
  const badge = document.getElementById('notificationBadge');
  if (!btn || !badge) return;

  let currentUser = {};
  try {
    currentUser = JSON.parse(
      sessionStorage.getItem('currentUser') || localStorage.getItem('user') || '{}',
    );
  } catch (e) {
    currentUser = {};
  }

  const allowedProfiles = new Set(['Admin']);

  const resolveRoleCode = (user) => {
    if (!user || typeof user !== 'object') return null;
    const role = user.role && typeof user.role === 'object' ? user.role : null;
    if (role && typeof role.code === 'string' && role.code.trim()) {
      return role.code.trim();
    }
    if (typeof user.role === 'string' && user.role.trim()) {
      return user.role.trim();
    }
    if (typeof user.roleCode === 'string' && user.roleCode.trim()) {
      return user.roleCode.trim();
    }
    if (typeof user.role_code === 'string' && user.role_code.trim()) {
      return user.role_code.trim();
    }
    return null;
  };

  const profileAllowsNotifications = (user = currentUser) => {
    const roleCode = resolveRoleCode(user);
    if (roleCode === 'SUPERADMIN' || roleCode === 'ADMIN') {
      return true;
    }
    return allowedProfiles.has(user?.perfil);
  };

  const targetModules = ['notifications', 'notificacoes', 'menu', 'default'];
  const targetFeatures = [
    'notifications',
    'notificacoes',
    'menu_notifications',
    'menu-notifications',
    'bell',
    'alertas',
    'acessar_notificacoes',
    'visualizar_notificacoes',
    'access',
  ];
  const targetScopes = [null, 'view', 'visualizar', 'access', 'acesso'];
  const targetPages = new Set(['notifications', 'notificacoes', 'alertas', 'bell']);

  const normalizeKey = (value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim().toLowerCase();
  };

  const menuContainsNotifications = (items) => {
    if (!Array.isArray(items)) return false;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const code = normalizeKey(item.code || item.page || item.route || item.slug || item.module);
      if (code && targetPages.has(code)) {
        return true;
      }
      if (menuContainsNotifications(item.children)) {
        return true;
      }
    }
    return false;
  };

  const featureMatchesTarget = (feature) => {
    if (!feature) return false;
    const code = normalizeKey(feature.code);
    if (code && targetFeatures.includes(code)) {
      return true;
    }
    if (feature.aliases && typeof feature.aliases.forEach === 'function') {
      let matched = false;
      feature.aliases.forEach((alias) => {
        if (matched) return;
        const normalized = normalizeKey(alias);
        if (normalized && targetFeatures.includes(normalized)) {
          matched = true;
        }
      });
      if (matched) return true;
    }
    return false;
  };

  const featureHasPermittedScope = (feature) => {
    if (!feature) return false;
    if (feature.permitted) return true;
    const scopes = feature.scopes || {};
    return targetScopes.some((scope) => {
      if (!scope) return false;
      const normalized = normalizeKey(scope);
      return Object.prototype.hasOwnProperty.call(scopes, normalized)
        ? Boolean(scopes[normalized])
        : false;
    });
  };

  const possuiPermissaoNotificacoes = async () => {
    const service = window.permissionsService;
    if (!service?.loadBootstrap) {
      return profileAllowsNotifications();
    }

    try {
      await service.loadBootstrap();
    } catch (err) {
      console.warn(
        'Não foi possível carregar permissões para notificações via serviço dedicado. Usando fallback por perfil.',
        err,
      );
      return profileAllowsNotifications();
    }

    if (typeof service.isFeatureEnabled === 'function') {
      for (const moduleCode of targetModules) {
        for (const featureCode of targetFeatures) {
          for (const scope of targetScopes) {
            const options = {};
            if (scope) {
              options.scope = scope;
            }
            if (service.isFeatureEnabled(moduleCode, featureCode, options)) {
              return true;
            }
          }
        }
      }
    }

    if (typeof service.getFeaturesForModule === 'function') {
      for (const moduleCode of targetModules) {
        const features = service.getFeaturesForModule(moduleCode) || [];
        if (
          features.some(
            (feature) => featureMatchesTarget(feature) && featureHasPermittedScope(feature),
          )
        ) {
          return true;
        }
      }
    }

    if (typeof service.findFeature === 'function') {
      for (const moduleCode of targetModules) {
        for (const featureCode of targetFeatures) {
          const feature = service.findFeature(moduleCode, featureCode);
          if (feature && featureHasPermittedScope(feature)) {
            return true;
          }
        }
      }
    }

    if (typeof service.getMenu === 'function') {
      const menuItems = service.getMenu();
      if (menuContainsNotifications(menuItems)) {
        return true;
      }
    }

    return false;
  };

  const possuiAcessoNotificacoes = await possuiPermissaoNotificacoes();
  if (!possuiAcessoNotificacoes) {
    btn.classList.add('pointer-events-none', 'opacity-50');
    btn.setAttribute('aria-disabled', 'true');
    btn.style.cursor = 'default';
    btn.style.color = 'white';
    badge.classList.add('hidden');
    return;
  }

  const defaultPreferences = {
    enabled: true,
    categories: {
      system: true,
      tasks: true,
      sales: true,
      finance: true,
    },
  };

  const notificationsStore = new Map();
  let isFetching = false;
  let hasDailyCheckRun = false;

  const preferenceKey = 'menu.notifications';
  const preferenceEvent = 'menu-notification-preferences-changed';
  const dailyBaseKey = 'menu.notifications.lastCheckAt';

  let dailyStorageKey;

  function updateDailyStorageKey(user = currentUser) {
    if (window.dailyRun?.getScopedKey) {
      dailyStorageKey = window.dailyRun.getScopedKey(dailyBaseKey, user);
      return;
    }
    const identifier =
      user?.id || user?.usuario_id || user?.email || user?.login || 'anonimo';
    dailyStorageKey = `${dailyBaseKey}:${String(identifier).toLowerCase()}`;
  }

  function getTodayKeySafe() {
    return (
      window.dateUtils?.getTodayKey?.() || new Date().toISOString().slice(0, 10)
    );
  }

  function readDailyCheck() {
    if (window.dailyRun?.readFlag) {
      return window.dailyRun.readFlag(dailyBaseKey, currentUser);
    }
    try {
      return localStorage.getItem(dailyStorageKey);
    } catch (err) {
      return null;
    }
  }

  function markDailyCheck(value) {
    const today = value || getTodayKeySafe();
    if (window.dailyRun?.writeFlag) {
      window.dailyRun.writeFlag(dailyBaseKey, currentUser, today);
      return today;
    }
    try {
      localStorage.setItem(dailyStorageKey, today);
    } catch (err) {
      // ignora falhas de storage
    }
    return today;
  }

  function clearDailyCheck() {
    if (window.dailyRun?.clearFlag) {
      window.dailyRun.clearFlag(dailyBaseKey, currentUser);
      return;
    }
    try {
      localStorage.removeItem(dailyStorageKey);
    } catch (err) {
      // ignora falhas de storage
    }
  }

  function resetDailyStateForToday() {
    const stored = readDailyCheck();
    const today = getTodayKeySafe();
    hasDailyCheckRun = stored === today;
  }

  updateDailyStorageKey(currentUser);
  resetDailyStateForToday();

  const clone = (value) => {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      console.warn('Não foi possível clonar preferências de notificações', err);
      return value;
    }
  };

  const normalizeCategories = (source) => {
    const normalized = { ...defaultPreferences.categories };
    if (Array.isArray(source)) {
      Object.keys(normalized).forEach((key) => {
        normalized[key] = source.includes(key);
      });
      source.forEach((key) => {
        if (!(key in normalized)) {
          normalized[key] = true;
        }
      });
      return normalized;
    }

    if (source && typeof source === 'object') {
      Object.entries(source).forEach(([key, value]) => {
        normalized[key] = Boolean(value);
      });
      return normalized;
    }

    return normalized;
  };

  const getPreferences = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
      if (!stored || typeof stored !== 'object') {
        return clone(defaultPreferences);
      }
      return {
        enabled: stored.enabled !== false,
        categories: normalizeCategories(stored.categories),
      };
    } catch (err) {
      console.warn('Não foi possível ler preferências de notificações', err);
      return clone(defaultPreferences);
    }
  };

  const savePreferences = (state) => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(state));
    } catch (err) {
      console.warn('Não foi possível salvar preferências de notificações', err);
    }
    window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: { preferences: clone(state) } }));
  };

  function formatDate(d) {
    try {
      return new Date(d).toLocaleString('pt-BR');
    } catch (e) {
      return '';
    }
  }

  let currentPreferences = getPreferences();
  let notificationsEnabled = currentPreferences.enabled;
  let clickHandler = null;

  const categoryMap = new Map([
    ['system', 'system'],
    ['sistema', 'system'],
    ['systems', 'system'],
    ['tasks', 'tasks'],
    ['task', 'tasks'],
    ['tarefas', 'tasks'],
    ['sales', 'sales'],
    ['sale', 'sales'],
    ['vendas', 'sales'],
    ['commerce', 'sales'],
    ['finance', 'finance'],
    ['financial', 'finance'],
    ['financeiro', 'finance'],
  ]);

  function mapCategory(value) {
    if (!value) return 'system';
    const normalized = String(value).trim().toLowerCase();
    return categoryMap.get(normalized) || 'system';
  }

  function normalizeNotification(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const categoryKey = mapCategory(payload.category || payload.type);
    const dateValue = payload.date || payload.createdAt || payload.timestamp || Date.now();
    const userName = payload.user || payload.author || payload.sender || 'Sistema';
    const messageText = payload.message || payload.text || payload.description || '';
    if (!messageText) return null;
    const identifier =
      payload.id
      || payload._id
      || payload.uuid
      || `${categoryKey}-${dateValue}-${messageText.slice(0, 24)}`;

    return {
      id: String(identifier),
      key: String(identifier),
      user: userName,
      message: messageText,
      date: dateValue,
      categoryKey,
      raw: payload,
    };
  }

  function getSortedNotifications() {
    return Array.from(notificationsStore.values()).sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (Number.isNaN(dateA) && Number.isNaN(dateB)) return 0;
      if (Number.isNaN(dateA)) return 1;
      if (Number.isNaN(dateB)) return -1;
      return dateB - dateA;
    });
  }

  function getPendingNotifications() {
    if (!notificationsEnabled) return [];
    const categories = currentPreferences?.categories || {};
    return getSortedNotifications().filter((item) => categories[item.categoryKey] !== false);
  }

  function updateIcon() {
    const pending = getPendingNotifications();

    if (!notificationsEnabled || pending.length === 0) {
      btn.style.color = 'white';
      badge.classList.add('hidden');
      return;
    }

    btn.style.color = 'var(--color-primary)';
    badge.classList.remove('hidden');
  }

  function attachClickListener() {
    if (clickHandler) return;
    clickHandler = () => {
      const items = getSortedNotifications()
        .map((n) => {
          const categoryLabel =
            n.categoryKey === 'tasks'
              ? 'Tarefas'
              : n.categoryKey === 'sales'
                ? 'Vendas'
                : n.categoryKey === 'finance'
                  ? 'Financeiro'
                  : 'Sistema';
          return `
          <div class="px-4 py-2 border-b last:border-0 border-gray-100">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="font-semibold">${n.user}</div>
                <div class="text-xs text-gray-500">${formatDate(n.date)}</div>
              </div>
              <button class="text-xs text-gray-400 hover:text-gray-600" data-notification-mute="${n.categoryKey}">
                Silenciar ${categoryLabel}
              </button>
            </div>
            <div class="mt-1 text-sm">${n.message}</div>
            <div class="mt-1 text-[11px] uppercase tracking-wide text-gray-400">${categoryLabel}</div>
          </div>`;
        })
        .join('');
      const content = `<div class="w-80 bg-white rounded-md shadow-lg text-gray-800">${
        items || '<div class="p-4 text-sm text-gray-600">Sem notificações</div>'
      }</div>`;
      const { popup } = createPopup(btn, content, {
        onHide: () => popup.remove(),
      });

      popup.addEventListener('click', (event) => {
        const target = event.target.closest('[data-notification-mute]');
        if (!target) return;
        const categoryToMute = target.getAttribute('data-notification-mute');
        if (!categoryToMute) return;
        event.preventDefault();
        event.stopPropagation();
        muteCategory(categoryToMute);
        popup.remove();
      });

      notificationsStore.clear();
      updateIcon();
    };
    btn.addEventListener('click', clickHandler);
  }

  function detachClickListener() {
    if (!clickHandler) return;
    btn.removeEventListener('click', clickHandler);
    clickHandler = null;
  }

  function applyPreferences(preferences) {
    currentPreferences = {
      enabled: preferences?.enabled !== false,
      categories: normalizeCategories(preferences?.categories),
    };
    notificationsEnabled = currentPreferences.enabled;

    if (notificationsEnabled) {
      attachClickListener();
      updateIcon();
      triggerDailyFetchIfNeeded();
    } else {
      detachClickListener();
      btn.style.color = 'white';
      badge.classList.add('hidden');
      notificationsStore.clear();
      resetDailyStateForToday();
    }
  }

  function muteCategory(category) {
    if (!category) return;
    const categories = { ...currentPreferences.categories, [category]: false };
    if (typeof window.setMenuNotifications === 'function') {
      const next = window.setMenuNotifications({ categories });
      if (next && typeof next === 'object') {
        applyPreferences(next);
      }
    } else {
      const nextState = { ...currentPreferences, categories };
      savePreferences(nextState);
      applyPreferences(nextState);
    }
  }

  window.updateNotificationColor = updateIcon;

  function triggerDailyFetchIfNeeded() {
    if (!notificationsEnabled || !btn || !badge) return;
    resetDailyStateForToday();
    if (!hasDailyCheckRun) {
      refreshNotifications({ respectDaily: true });
    }
  }

  applyPreferences(currentPreferences);

  window.addEventListener(preferenceEvent, (event) => {
    const detail = event?.detail?.preferences;
    if (detail && typeof detail === 'object') {
      applyPreferences(detail);
    } else {
      applyPreferences(getPreferences());
    }
  });

  async function fetchNotificationsWithRetry(maxRetries = 2) {
    let baseUrl;
    try {
      baseUrl = await window.apiConfig?.getApiBaseUrl?.();
    } catch (err) {
      console.warn('Não foi possível obter a URL base da API.', err);
    }

    if (!baseUrl) {
      console.warn('URL base da API não definida para notificações do menu.');
      return [];
    }

    const endpoint = '/api/notifications';
    const url = new URL(endpoint, baseUrl).toString();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          credentials: 'include',
        });
        if (!response.ok) {
          const statusError = new Error(
            `Falha ao carregar notificações (${response.status})`,
          );
          statusError.status = response.status;
          throw statusError;
        }

        let data;
        try {
          data = await response.json();
        } catch (err) {
          console.warn('Resposta de notificações não é JSON válido.', err);
          return [];
        }

        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.notifications)) return data.notifications;
        if (Array.isArray(data?.data)) return data.data;
        if (Array.isArray(data?.items)) return data.items;
        return [];
      } catch (error) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        console.warn('Erro ao carregar notificações do menu.', {
          error,
          attempt: attempt + 1,
          offline,
          endpoint,
        });

        if (offline) {
          return [];
        }

        if (attempt >= maxRetries) {
          break;
        }

        const delay = Math.min(4000, 1000 * (attempt + 1));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return [];
  }

  window.__notificationsInternals = window.__notificationsInternals || {};
  window.__notificationsInternals.fetchNotificationsWithRetry = fetchNotificationsWithRetry;

  function upsertNotifications(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    items.forEach((item) => {
      const normalized = normalizeNotification(item);
      if (!normalized) return;
      notificationsStore.set(normalized.key, normalized);
    });
  }

  async function refreshNotifications({ respectDaily = true } = {}) {
    if (!notificationsEnabled || !btn || !badge) return;
    if (respectDaily) {
      resetDailyStateForToday();
      if (hasDailyCheckRun) {
        return;
      }
      hasDailyCheckRun = true;
    }
    if (isFetching) return;
    isFetching = true;
    try {
      const items = await fetchNotificationsWithRetry();
      upsertNotifications(items);
    } catch (error) {
      console.warn('Erro inesperado ao atualizar notificações do menu.', error);
    } finally {
      isFetching = false;
      updateIcon();
      if (respectDaily) {
        markDailyCheck();
      }
    }
  }

  window.__notificationsInternals.refreshNotifications = refreshNotifications;
  window.__notificationsInternals.resetDailyState = () => {
    clearDailyCheck();
    hasDailyCheckRun = false;
  };
  window.__notificationsInternals.shutdown = () => {
    detachClickListener();
    notificationsEnabled = false;
    notificationsStore.clear();
    clearDailyCheck();
    hasDailyCheckRun = false;
    updateIcon();
  };

  if (typeof window.setMenuNotifications !== 'function') {
    window.setMenuNotifications = (update = {}) => {
      const current = getPreferences();

      if (typeof update.enabled === 'boolean') {
        current.enabled = update.enabled;
      }

      if (update.categories !== undefined) {
        current.categories = normalizeCategories(update.categories);
      }

      savePreferences(current);
      return clone(current);
    };
  }
});
