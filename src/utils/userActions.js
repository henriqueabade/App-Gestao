window.addEventListener('DOMContentLoaded', () => {
  const nameEl = document.getElementById('userName');
  const profileEl = document.getElementById('userProfile');
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
    if (nameEl) nameEl.textContent = user.nome || '';
    if (profileEl) profileEl.textContent = user.perfil || 'Sem Perfil';
  } catch (e) {
    /* ignore */
  }

  const btn = document.getElementById('user-actions-btn');
  const menu = document.getElementById('user-actions-menu');
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
    if (el) el.addEventListener('click', () => {
      menu.classList.add('hidden');
      fn();
    });
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
