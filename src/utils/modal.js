const ModalManager = (() => {
  const modals = new Map();
  // Token used to ensure only the latest open() call displays a modal.
  // Any call to closeAll() increments this token, invalidating in-flight opens.
  let openToken = 0;
  const modalConfigs = {
  };

  async function open(htmlPath, scriptPath, overlayId) {
    if (arguments.length === 1) {
      const cfg = modalConfigs[htmlPath];
      if (!cfg) return;
      overlayId = htmlPath;
      scriptPath = cfg.script;
      htmlPath = cfg.html;
    }

    // Closing existing modals invalidates older open() calls via openToken.
    closeAll();
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
