window.addEventListener('DOMContentLoaded', () => {
  const nameEl = document.getElementById('userName');
  const profileEl = document.getElementById('userProfile');
  const avatarEl = document.getElementById('userAvatar');
  const summaryEl = document.getElementById('userSummary');
  const appUpdates = window.AppUpdates || null;
  const usuariosMenuItem = document.querySelector('[data-page="usuarios"]');

  const QUICK_ACTIONS_STORAGE_KEY = 'menu.quickActions';
  const QUICK_ACTIONS_EVENT = 'menu-quick-actions-changed';
  const QUICK_ACTIONS_DEFAULT = {
    actions: {
      logout: true,
      minimize: true,
      reload: true,
      'select-display': true,
      close: true,
    },
    showAvatar: true,
    showName: true,
  };

  const getInitials = name => {
    if (!name) return '';
    return String(name)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  };

  const applyUserProfile = userData => {
    const user = userData && typeof userData === 'object' ? userData : {};
    const nome = user.nome || '';
    const perfil = user.perfil || '';
    const isSupAdmin = perfil === 'Sup Admin';
    const isAdmin = perfil === 'Admin';
    const hasAdminAccess = isSupAdmin || isAdmin;

    if (usuariosMenuItem) {
      if (hasAdminAccess) {
        usuariosMenuItem.classList.remove('hidden');
        usuariosMenuItem.removeAttribute('aria-hidden');
      } else {
        usuariosMenuItem.classList.add('hidden');
        usuariosMenuItem.setAttribute('aria-hidden', 'true');
      }
    }

    if (nameEl) nameEl.textContent = nome;
    if (profileEl) profileEl.textContent = perfil || 'Sem Perfil';

    if (avatarEl) {
      const avatarUrl = user.avatarUrl || user.fotoUrl || user.foto || null;
      const initials = getInitials(nome);

      if (avatarUrl) {
        const safeUrl = String(avatarUrl).replace(/"/g, '\\"');
        avatarEl.style.backgroundImage = `url("${safeUrl}")`;
        avatarEl.classList.add('has-image');
        avatarEl.textContent = '';
        avatarEl.classList.remove('hidden');
      } else if (initials) {
        avatarEl.style.removeProperty('background-image');
        avatarEl.classList.remove('has-image');
        avatarEl.textContent = initials;
        avatarEl.classList.remove('hidden');
      } else {
        avatarEl.style.removeProperty('background-image');
        avatarEl.classList.remove('has-image');
        avatarEl.textContent = '';
        avatarEl.classList.add('hidden');
      }
    }

    if (appUpdates && typeof appUpdates.setUserProfile === 'function') {
      appUpdates.setUserProfile(user);
    }
  };

  const cloneQuickActions = value => {
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch (error) {
        /* ignore structured clone failures */
      }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  };

  const normalizeQuickActions = source => {
    const normalized = {
      actions: { ...QUICK_ACTIONS_DEFAULT.actions },
      showAvatar: QUICK_ACTIONS_DEFAULT.showAvatar,
      showName: QUICK_ACTIONS_DEFAULT.showName,
    };

    if (!source || typeof source !== 'object') {
      return normalized;
    }

    if (source.actions && typeof source.actions === 'object') {
      Object.entries(source.actions).forEach(([key, enabled]) => {
        if (key in normalized.actions) {
          normalized.actions[key] = Boolean(enabled);
        }
      });
    }

    if (Array.isArray(source.actions)) {
      Object.keys(normalized.actions).forEach(key => {
        normalized.actions[key] = source.actions.includes(key);
      });
    }

    if (typeof source.showAvatar === 'boolean') {
      normalized.showAvatar = source.showAvatar;
    }
    if (typeof source.showName === 'boolean') {
      normalized.showName = source.showName;
    }

    return normalized;
  };

  const readQuickActionsFromStorage = () => {
    if (typeof localStorage === 'undefined') {
      return cloneQuickActions(QUICK_ACTIONS_DEFAULT);
    }
    try {
      const stored = localStorage.getItem(QUICK_ACTIONS_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      return normalizeQuickActions(parsed);
    } catch (error) {
      return cloneQuickActions(QUICK_ACTIONS_DEFAULT);
    }
  };

  let quickActionsPreferences = readQuickActionsFromStorage();
  let btn = null;
  let menu = null;

  const applyQuickActionsPreferences = () => {
    if (summaryEl) {
      summaryEl.classList.toggle('user-summary--hide-avatar', !quickActionsPreferences.showAvatar);
      summaryEl.classList.toggle('user-summary--hide-name', !quickActionsPreferences.showName);
    }
    if (!menu) return;
    Object.entries(quickActionsPreferences.actions).forEach(([key, enabled]) => {
      const el = menu.querySelector(`[data-action="${key}"]`);
      if (!el) return;
      el.classList.toggle('hidden', !enabled);
      el.setAttribute('aria-hidden', enabled ? 'false' : 'true');
      el.tabIndex = enabled ? 0 : -1;
      el.disabled = !enabled;
    });
  };

  try {
    const storedSession = sessionStorage.getItem('currentUser');
    let stored = storedSession || localStorage.getItem('user');
    if (!storedSession && stored) {
      sessionStorage.setItem('currentUser', stored);
      if (localStorage.getItem('rememberUser') !== '1') {
        localStorage.removeItem('user');
        localStorage.removeItem('rememberUser');
      }
    }
    const user = stored ? JSON.parse(stored) : {};
    const isSupAdmin = user.perfil === 'Sup Admin';
    const isAdmin = user.perfil === 'Admin';

    applyUserProfile(user);

    let pendingUpdate = null;
    const rawPendingUpdate = sessionStorage.getItem('pendingUpdate');
    if (rawPendingUpdate) {
      try {
        pendingUpdate = JSON.parse(rawPendingUpdate);
      } catch (err) {
        pendingUpdate = null;
        sessionStorage.removeItem('pendingUpdate');
      }
    }

    if (pendingUpdate) {
      if (pendingUpdate.publishState && appUpdates?.setPublishState) {
        appUpdates.setPublishState(pendingUpdate.publishState, { silent: true });
      }
      if (appUpdates?.setUpdateStatus) {
        appUpdates.setUpdateStatus(pendingUpdate, { origin: 'login-cache' });
      }
      sessionStorage.removeItem('pendingUpdate');
    }

    const shouldRequestStatus = isSupAdmin || !pendingUpdate;
    if (shouldRequestStatus && window.electronAPI?.getUpdateStatus) {
      window.electronAPI
        .getUpdateStatus()
        .then(status => {
          if (!status) return;
          if (status.publishState && appUpdates?.setPublishState) {
            appUpdates.setPublishState(status.publishState, { silent: true });
          }
          if (appUpdates?.setUpdateStatus) {
            appUpdates.setUpdateStatus(status, { origin: 'initial' });
          }
        })
        .catch(() => {
          /* ignore initial update status errors */
        });
    }
  } catch (e) {
    /* ignore */
  }

  window.addEventListener('user-profile-updated', event => {
    const updatedUser = event?.detail?.user;
    if (!updatedUser) return;
    applyUserProfile(updatedUser);
  });

  btn = document.getElementById('user-actions-btn');
  menu = document.getElementById('user-actions-menu');
  applyQuickActionsPreferences();
  window.addEventListener(QUICK_ACTIONS_EVENT, event => {
    const updated = normalizeQuickActions(event?.detail?.preferences);
    quickActionsPreferences = updated;
    applyQuickActionsPreferences();
  });
  if (!btn || !menu) return;

  const positionMenu = () => {
    const margin = 8; // 0.5rem
    const btnRect = btn.getBoundingClientRect();
    const parentRect = btn.parentElement.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    let top = btnRect.bottom - parentRect.top + margin;
    const maxTop = window.innerHeight - menuHeight - margin - parentRect.top;
    if (top > maxTop) top = Math.max(margin, maxTop);
    menu.style.top = `${top}px`;
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) positionMenu();
  });

  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });

  window.addEventListener('resize', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  });

  const action = (name, fn) => {
    const el = menu.querySelector(`[data-action="${name}"]`);
    if (!el) return;
    if (!el.dataset.actionHandlerBound) {
      el.addEventListener('click', () => {
        if (!quickActionsPreferences.actions[name]) return;
        menu.classList.add('hidden');
        fn();
      });
      el.dataset.actionHandlerBound = 'true';
    }
  };

  

action('logout', () => {
  if (window.collectState && window.electronAPI && window.electronAPI.saveState) {
    window.electronAPI.saveState(window.collectState());
  }

  if (window.stopServerCheck) window.stopServerCheck();
  localStorage.removeItem('offlineDisconnect');
  localStorage.removeItem('pinChanged');
  // 0) garante que o "lembrar-me" não acione um auto login

  if (localStorage.getItem('user') !== null) {
    // Se existir, remove
    localStorage.removeItem('user');
  }
  localStorage.removeItem('rememberUser');

  // 1) pré-carrega o login por trás
  setTimeout(() => {
    window.electronAPI.openLoginHidden();
  }, 3000);

  // 2) dispara o overlay de saída e espera o fade
  const overlay = document.getElementById('exitOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('visible');

    setTimeout(() => {
      window.electronAPI.logout();
    }, 5000);

    overlay.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'opacity') return;
      overlay.removeEventListener('transitionend', onEnd);
    });
  } else {
    window.electronAPI.logout();
  }
});




  action('close', () => {
    if (window.collectState && window.electronAPI && window.electronAPI.saveState) {
      window.electronAPI.saveState(window.collectState());
    }
    if (window.stopServerCheck) window.stopServerCheck();
    localStorage.removeItem('offlineDisconnect');
    localStorage.removeItem('pinChanged');
    const overlay = document.getElementById('exitOverlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      void overlay.offsetWidth; // trigger reflow
      overlay.classList.add('visible');
      overlay.addEventListener('transitionend', function onEnd(e) {
        if (e.propertyName !== 'opacity') return;
        overlay.removeEventListener('transitionend', onEnd);
        window.electronAPI.closeWindow();
      });
    } else {
      window.electronAPI.closeWindow();
    }
  });
  action('minimize', () => window.electronAPI.minimizeWindow());
  action('reload', () => window.electronAPI.reloadWindow());

  const chooseDisplay = async () => {
    if (!window.electronAPI || !window.electronAPI.getDisplays) return;
    const displays = await window.electronAPI.getDisplays();
    const currentId = await window.electronAPI.getSavedDisplay();
    if (!displays || displays.length <= 1) return;

    const overlay = document.createElement('div');
    overlay.className = 'warning-overlay';
    overlay.innerHTML = `
      <div class="warning-modal scale-95">
        <div class="warning-icon">
          <div class="warning-icon-circle">
            <i data-feather="monitor"></i>
          </div>
        </div>
        <h2 class="warning-title">Escolha a tela</h2>
        <div id="display-options" class="mt-4 space-y-2">
          ${displays
            .map(
              d => `<button class="warning-button w-full ${currentId===d.id? 'border border-white':''}" data-id="${d.id}">${d.name}</button>`
            )
            .join('')}
        </div>
        <button id="cancelDisplay" class="warning-button mt-4">Cancelar</button>
      </div>`;
    document.body.appendChild(overlay);
    feather.replace();
    requestAnimationFrame(() => {
      const modal = overlay.querySelector('.warning-modal');
      modal.classList.remove('scale-95');
    });

    overlay.querySelectorAll('#display-options button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-id'));
        await window.electronAPI.setDisplay(id);
        overlay.remove();
        if (window.electronAPI && window.electronAPI.showLogin) {
          window.electronAPI.showLogin();
        }
      });
    });
    overlay
      .querySelector('#cancelDisplay')
      .addEventListener('click', () => overlay.remove());
  };

  action('select-display', chooseDisplay);
});
