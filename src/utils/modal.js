const ModalManager = (() => {
  const modals = new Map();
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
        <div class="rounded-full bg-[var(--color-primary-opacity)] p-6 mb-4">
          <i class="fas fa-box-open text-[var(--color-primary)] text-6xl"></i>
        </div>
        <h3 class="text-lg font-medium text-white">Nenhum resultado encontrado</h3>
      `;
      table.parentNode.insertBefore(empty, table.nextSibling);
      const check = () => {
        const visible = Array.from(tbody.querySelectorAll('tr')).filter(r => r.style.display !== 'none');
        if (visible.length === 0) {
          table.classList.add('hidden');
          empty.classList.remove('hidden');
        } else {
          table.classList.remove('hidden');
          empty.classList.add('hidden');
        }
      };
      new MutationObserver(check).observe(tbody, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      check();
    });
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
    // Increment and store token so async steps know if they should continue.
    const token = ++openToken;

    const resp = await fetch(htmlPath);
    if (token !== openToken) return;
    const html = await resp.text();
    if (token !== openToken) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
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

  return { open, close, closeAll };
})();

window.ModalManager = ModalManager;
window.Modal = ModalManager;

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
