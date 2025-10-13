window.addEventListener('DOMContentLoaded', () => {
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

  const allowedProfiles = new Set(['Admin', 'Sup Admin']);
  if (!allowedProfiles.has(currentUser?.perfil)) {
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
  let refreshIntervalId = null;
  let isFetching = false;

  const preferenceKey = 'menu.notifications';
  const preferenceEvent = 'menu-notification-preferences-changed';

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
    } else {
      detachClickListener();
      btn.style.color = 'white';
      badge.classList.add('hidden');
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

    const endpoints = ['/api/notifications/menu', '/api/notifications'];
    for (const endpoint of endpoints) {
      const url = new URL(endpoint, baseUrl).toString();
      let attempt = 0;

      while (attempt <= maxRetries) {
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
          return [];
        } catch (error) {
          attempt += 1;
          const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          console.warn('Erro ao carregar notificações do menu.', {
            error,
            attempt,
            offline,
            endpoint,
          });

          if (offline) {
            return [];
          }

          if (error?.status === 404) {
            break;
          }

          if (attempt > maxRetries) {
            break;
          }

          const delay = Math.min(4000, 1000 * attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
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

  async function refreshNotifications() {
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
    }
  }

  refreshNotifications();
  const REFRESH_INTERVAL = 60000;
  refreshIntervalId = window.setInterval(refreshNotifications, REFRESH_INTERVAL);

  window.addEventListener('beforeunload', () => {
    if (refreshIntervalId) {
      window.clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
  });

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
