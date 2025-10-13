window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('notificationBtn');
  const badge = document.getElementById('notificationBadge');
  if (!btn || !badge) return;

  let currentUser = {};
  try {
    currentUser = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('user') || '{}');
  } catch (e) {
    currentUser = {};
  }

  const defaultPreferences = {
    enabled: true,
    categories: {
      system: true,
      tasks: true,
      sales: true,
      finance: true
    }
  };

  const notifications = [
    {
      user: currentUser.nome || 'Sistema',
      message: 'Bem-vindo ao painel!'
        + (currentUser.perfil ? ` Perfil: ${currentUser.perfil}.` : ''),
      date: new Date()
    },
    {
      user: 'Suporte',
      message: 'Sua conta foi verificada com sucesso.',
      date: new Date(Date.now() - 3600000)
    }
  ];

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
        categories: normalizeCategories(stored.categories)
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

  let notificationsEnabled = getPreferences().enabled;
  let clickHandler = null;

  function updateIcon() {
    if (!notificationsEnabled) {
      btn.style.color = 'white';
      badge.classList.add('hidden');
      return;
    }

    if (notifications.length > 0) {
      btn.style.color = 'var(--color-primary)';
      badge.classList.remove('hidden');
    } else {
      btn.style.color = 'white';
      badge.classList.add('hidden');
    }
  }

  function attachClickListener() {
    if (clickHandler) return;
    clickHandler = () => {
      const items = notifications
        .map(
          n => `
          <div class="px-4 py-2 border-b last:border-0 border-gray-100">
            <div class="font-semibold">${n.user}</div>
            <div class="text-xs text-gray-500">${formatDate(n.date)}</div>
            <div class="text-sm">${n.message}</div>
          </div>`
        )
        .join('');
      const content = `<div class="w-72 bg-white rounded-md shadow-lg text-gray-800">${
        items || '<div class="p-4 text-sm text-gray-600">Sem notificações</div>'
      }</div>`;
      const { popup } = createPopup(btn, content, {
        onHide: () => popup.remove()
      });
      notifications.length = 0;
      updateIcon();
    };
    btn.addEventListener('click', clickHandler);
  }

  function detachClickListener() {
    if (!clickHandler) return;
    btn.removeEventListener('click', clickHandler);
    clickHandler = null;
  }

  function applyPreference(enabled) {
    notificationsEnabled = enabled;
    if (notificationsEnabled) {
      attachClickListener();
      updateIcon();
    } else {
      detachClickListener();
      btn.style.color = 'white';
      badge.classList.add('hidden');
    }
  }

  window.updateNotificationColor = updateIcon;

  applyPreference(notificationsEnabled);

  window.addEventListener(preferenceEvent, (event) => {
    const detail = event?.detail?.preferences;
    const enabled = detail ? detail.enabled !== false : getPreferences().enabled;
    applyPreference(enabled);
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
