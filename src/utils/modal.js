const ModalManager = (() => {
  const modals = new Map();
  const readyModals = new Set();
  // Token used to ensure only the latest open() call displays a modal.
  // Any call to closeAll() increments this token, invalidating in-flight opens.
  let openToken = 0;
  const modalConfigs = {
  };

  function setupEmptyStates(wrapper) {
    wrapper.querySelectorAll('table').forEach(table => {
      const tbody = table.tBodies[0];
      if (!tbody) return;
      const empty = document.createElement('div');
      empty.className = 'modal-empty-state hidden py-12 flex flex-col items-center justify-center text-center px-4';
      empty.innerHTML = `
        <div class="rounded-full bg-[var(--color-primary-opacity)] p-8 mb-6">
          <i class="fas fa-box-open text-[var(--color-primary)] text-8xl"></i>
        </div>
        <h3 class="text-lg font-medium text-white">Nenhum resultado encontrado</h3>
      `;
      table.parentNode.insertBefore(empty, table.nextSibling);
      const check = () => {
        const visible = Array.from(tbody.querySelectorAll('tr')).filter(r =>
          r.style.display !== 'none' && !r.classList.contains('hidden') && !r.hidden
        );
        if (visible.length === 0) {
          table.classList.add('hidden');
          empty.classList.remove('hidden');
        } else {
          table.classList.remove('hidden');
          empty.classList.add('hidden');
        }
      };
      new MutationObserver(check).observe(tbody, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden']
      });
      check();
    });
  }

  function ensureHighZIndex(element, minZIndex = 2000) {
    if (!element) return;
    const zClassRegex = /^z-(?:\[(\d+)\]|(\d+))$/;
    let currentZIndex = null;
    element.classList.forEach(className => {
      const match = className.match(zClassRegex);
      if (!match) return;
      const value = Number(match[1] ?? match[2]);
      if (!Number.isNaN(value)) {
        currentZIndex = currentZIndex === null ? value : Math.max(currentZIndex, value);
      }
    });
    if (currentZIndex !== null && currentZIndex >= minZIndex) return;
    [...element.classList].forEach(className => {
      if (zClassRegex.test(className)) {
        element.classList.remove(className);
      }
    });
    element.classList.add(`z-[${minZIndex}]`);
  }

  async function open(htmlPath, scriptPath, overlayId, keepExisting = false) {
    if (arguments.length === 1) {
      const cfg = modalConfigs[htmlPath];
      if (!cfg) return;
      overlayId = htmlPath;
      scriptPath = cfg.script;
      htmlPath = cfg.html;
    }

    // Closing existing modals invalidates older open() calls via openToken.
    if (!keepExisting) closeAll();
    readyModals.delete(overlayId);
    // Increment and store token so async steps know if they should continue.
    const token = ++openToken;

    const resp = await fetch(htmlPath);
    if (token !== openToken) return;
    const html = await resp.text();
    if (token !== openToken) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    ensureHighZIndex(wrapper.firstElementChild);
    if (token !== openToken) return;
    document.body.appendChild(wrapper);
    document.body.classList.add('overflow-hidden');
    setupEmptyStates(wrapper);

    if (scriptPath) {
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = scriptPath;
      wrapper.appendChild(script);
    }

    modals.set(overlayId, wrapper);
  }

  function close(overlayId) {
    if (!readyModals.has(overlayId)) {
      readyModals.add(overlayId);
      window.dispatchEvent(new CustomEvent('modal-ready', { detail: overlayId }));
    }
    readyModals.delete(overlayId);
    const wrapper = modals.get(overlayId);
    if (wrapper) {
      wrapper.remove();
      modals.delete(overlayId);
    }
    if (modals.size === 0) {
      document.body.classList.remove('overflow-hidden');
    }
  }

  function closeAll() {
    // Increment token so any pending open() calls know they were cancelled.
    openToken++;
    Array.from(modals.keys()).forEach(id => close(id));
    document.querySelectorAll('.order-detail-overlay.open')
      .forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.contact-overlay.active')
      .forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.client-overlay')
      .forEach(el => (el.style.display = 'none'));
    document.querySelectorAll('.modal.active')
      .forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.create-menu.active')
      .forEach(el => el.classList.remove('active'));
    document.getElementById('overlay')?.classList.remove('active');
    if (modals.size === 0) {
      document.body.classList.remove('overflow-hidden');
    }
    if (window.hideRawMaterialInfoPopup) {
      window.hideRawMaterialInfoPopup();
    }
  }

  function signalReady(overlayId) {
    readyModals.add(overlayId);
    window.dispatchEvent(new CustomEvent('modal-ready', { detail: overlayId }));
  }

  function waitForReady(overlayId, timeout = 15000) {
    if (readyModals.has(overlayId)) return Promise.resolve();
    return new Promise(resolve => {
      let timer = null;
      const cleanup = () => {
        window.removeEventListener('modal-ready', onReady);
        if (timer) clearTimeout(timer);
      };
      const onReady = event => {
        if (event?.detail !== overlayId) return;
        cleanup();
        resolve();
      };
      window.addEventListener('modal-ready', onReady);
      if (timeout > 0) {
        timer = setTimeout(() => {
          cleanup();
          resolve();
        }, timeout);
      }
    });
  }

  return { open, close, closeAll, signalReady, waitForReady };
})();

window.ModalManager = ModalManager;
window.Modal = ModalManager;

function createModalLoadingOverlay() {
  const existing = document.getElementById('modalLoading');
  if (existing) existing.remove();
  const spinner = document.createElement('div');
  spinner.id = 'modalLoading';
  spinner.className = 'fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center';
  spinner.innerHTML = '<div class="w-16 h-16 border-4 border-[#b6a03e] border-t-transparent rounded-full animate-spin"></div>';
  return spinner;
}

async function withModalLoading(duration = 0, action) {
  const spinner = createModalLoadingOverlay();
  document.body.appendChild(spinner);
  try {
    if (duration > 0) {
      await new Promise(resolve => setTimeout(resolve, duration));
    }
    if (typeof action === 'function') {
      return await action();
    }
    return action;
  } finally {
    if (spinner.isConnected) spinner.remove();
  }
}

window.withModalLoading = withModalLoading;

function closeAllModals() {
  ModalManager.closeAll();
  document.querySelectorAll('.order-detail-overlay.open')
    .forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.contact-overlay.active')
    .forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.client-overlay')
    .forEach(el => (el.style.display = 'none'));
  document.querySelectorAll('.modal.active')
    .forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.create-menu.active')
    .forEach(el => el.classList.remove('active'));
  document.getElementById('overlay')?.classList.remove('active');
  document.body.classList.remove('overflow-hidden');
  if (window.hideRawMaterialInfoPopup) {
    window.hideRawMaterialInfoPopup();
  }
}

window.closeAllModals = closeAllModals;

// Close any active overlays when changing modules
document.addEventListener('module-change', closeAllModals);
