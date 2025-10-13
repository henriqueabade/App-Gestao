// Toast helper
const notificationContainer = document.getElementById("notification");
function showToast(message, type = "info") {
  const div = document.createElement("div");
  let toastClass = "toast-info";
  if (type === "success") toastClass = "toast-success";
  else if (type === "error") toastClass = "toast-error";
  div.className = `toast ${toastClass}`;
  div.textContent = message;
  notificationContainer.appendChild(div);
  setTimeout(() => {
    div.classList.add("opacity-0");
    setTimeout(() => div.remove(), 500);
  }, 3000);
}

function showInactiveUserWarning() {
  showToast('Seu usuário está inativo. Solicite ao administrador a ativação do seu acesso.', 'error');
}

let currentPinPopup = null;
let pinErrorShown = false;
let offlineErrorShown = false;

async function fetchApi(path, options) {
  const baseUrl = await window.apiConfig.getApiBaseUrl();
  return fetch(`${baseUrl}${path}`, options);
}

async function cacheUpdateStatus() {
  if (typeof sessionStorage === 'undefined') return;
  if (!window.electronAPI?.getUpdateStatus) {
    sessionStorage.removeItem('pendingUpdate');
    return;
  }
  try {
    const status = await window.electronAPI.getUpdateStatus();
    if (status !== undefined) {
      sessionStorage.setItem('pendingUpdate', JSON.stringify(status));
    } else {
      sessionStorage.removeItem('pendingUpdate');
    }
  } catch (err) {
    sessionStorage.removeItem('pendingUpdate');
  }
}
function createPinPopupContent() {
  return `
    <div class="bg-white p-4 rounded-lg shadow-md border border-gray-100 w-64 text-sm text-gray-700 leading-relaxed">
      <p><strong>PIN</strong> é o número de 5 dígitos recebido por e-mail</p>
      <p class="mt-2"><strong>Para primeiro PIN:</strong> Contate o Administrador</p>
      <p class="mt-1"><strong>Em caso de Erro/Não Recebimento:</strong> Contate o Administrador</p>
    </div>`;
}

function showPinPopup(target) {
  hidePinPopup();
  const popup = document.createElement('div');
  popup.className = 'fixed z-50';
  popup.style.position = 'fixed';
  popup.innerHTML = createPinPopupContent();
  document.body.appendChild(popup);
  const rect = target.getBoundingClientRect();
  const margin = 8;
  const popupRect = popup.getBoundingClientRect();

  let top = rect.top - popupRect.height - margin;
  if (top < margin) top = margin;

  let left = rect.left + rect.width / 2 - popupRect.width / 2;
  if (left + popupRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popupRect.width - margin;
  }
  if (left < margin) left = margin;

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
  currentPinPopup = popup;
}

function hidePinPopup() {
  if (currentPinPopup) {
    currentPinPopup.remove();
    currentPinPopup = null;
  }
}

function showPinError() {
  if (pinErrorShown) return;
  pinErrorShown = true;
  const overlay = document.createElement('div');
  overlay.className = 'warning-overlay';
  overlay.innerHTML = `
    <div class="warning-modal scale-95">
      <div class="warning-icon">
        <div class="warning-icon-circle">
          <i data-feather="lock"></i>
        </div>
      </div>
      <h2 class="warning-title">PIN Alterado</h2>
      <p class="warning-text">Usuário desconectado, PIN alterado por questões de segurança. Faça login novamente com o novo PIN recebido no e-mail cadastrado.</p>
      <hr class="warning-divider">
      <p class="warning-text-small">As atividades que estavam sendo realizadas não foram perdidas e ficarão disponíveis por 30 min. Em caso de não recebimento do PIN, contate o Administrador.</p>
      <button id="pinErrorOk" class="warning-button pulse">OK</button>
    </div>`;
  document.body.appendChild(overlay);
  feather.replace();
  requestAnimationFrame(() => {
    const modal = overlay.querySelector('div');
    modal.classList.remove('scale-95');
  });
  const btn = overlay.querySelector('#pinErrorOk');
  setTimeout(() => btn.classList.remove('pulse'), 1500);
  btn.addEventListener('click', () => overlay.remove());
}

function showOfflineError() {
  if (offlineErrorShown) return;
  offlineErrorShown = true;
  const overlay = document.createElement('div');
  overlay.className = 'warning-overlay';
  overlay.innerHTML = `
    <div class="warning-modal scale-95">
      <div class="warning-icon">
        <div class="warning-icon-circle">
          <i data-feather="wifi-off"></i>
        </div>
      </div>
      <h2 class="warning-title">Conexão Perdida</h2>
      <p class="warning-text">Usuário desconectado, conexão com internet interrompida. Faça login novamente.</p>
      <hr class="warning-divider">
      <p class="warning-text-small">Ao fazer login dentro de 30 min o programa restaurará os dados em registro, se existirem.</p>
      <button id="offlineErrorOk" class="warning-button pulse">OK</button>
    </div>`;
  document.body.appendChild(overlay);
  feather.replace();
  requestAnimationFrame(() => {
    const modal = overlay.querySelector('div');
    modal.classList.remove('scale-95');
  });
  const btn = overlay.querySelector('#offlineErrorOk');
  setTimeout(() => btn.classList.remove('pulse'), 1500);
  btn.addEventListener('click', () => overlay.remove());
}

window.addEventListener("DOMContentLoaded", async () => {
  const intro = document.getElementById('introOverlay');
  const params = new URLSearchParams(window.location.search);
  const startHidden = params.get('hidden') === '1';

 // remove intro overlay only after the window becomes visible
const hideIntro = () => {
  if (!intro) return;
  intro.classList.add('fade-out');
  intro.addEventListener('transitionend', () => intro.remove(), { once: true });
};

if (intro) {
  if (startHidden) {
    intro.remove();
  } else if (document.hasFocus()) {
    hideIntro(); // page reload with focus: remove overlay right away
  } else {
    window.addEventListener('focus', hideIntro, { once: true });
  }
}


  const storedPin = localStorage.getItem('pin');
  const storedUser = localStorage.getItem('user');
  let parsedStoredUser = null;
  try {
    parsedStoredUser = storedUser ? JSON.parse(storedUser) : null;
  } catch (_) {
    parsedStoredUser = null;
  }
  const rememberUser = localStorage.getItem('rememberUser') === '1';
  if (storedUser && rememberUser) {
    let saved = await window.electronAPI.loadState();
    if (saved) {
      try {
        const savedUser = saved.storage && saved.storage.user
          ? JSON.parse(saved.storage.user)
          : null;
        const current = parsedStoredUser;
        if (
          savedUser &&
          current &&
          savedUser.id === current.id &&
          saved.sectionId &&
          saved.sectionId !== 'dashboard'
        ) {
          localStorage.setItem('savedState', JSON.stringify(saved));
          await window.electronAPI.clearState();
        } else {
          await window.electronAPI.clearState();
          localStorage.removeItem('savedState');
        }
      } catch (err) {
        await window.electronAPI.clearState();
        localStorage.removeItem('savedState');
      }
    }

    const result = await window.electronAPI.autoLogin(storedPin, parsedStoredUser);
    if (result && result.success) {
      const cachedUser = storedUser || (result.user ? JSON.stringify(result.user) : null);
      if (cachedUser) sessionStorage.setItem('currentUser', cachedUser);
      await cacheUpdateStatus();
      return;
    }
    localStorage.removeItem('user');
    localStorage.removeItem('rememberUser');
    localStorage.removeItem('pin');
    if (result && result.reason === 'offline') {
      showOfflineError();
    } else {
      showPinError();
    }
    localStorage.removeItem('pinChanged');
    localStorage.removeItem('offlineDisconnect');
  } else if (storedUser && !rememberUser) {
    localStorage.removeItem('user');
    localStorage.removeItem('rememberUser');
  }
  if (localStorage.getItem('pinChanged')) {
    localStorage.removeItem('pinChanged');
    showPinError();
  }
  if (localStorage.getItem('offlineDisconnect')) {
    localStorage.removeItem('offlineDisconnect');
    showOfflineError();
  }
  const pinInput = document.getElementById('pin');
  const registerPinInput = document.getElementById('registerPin');
  const applyStoredPin = input => {
    if (input && storedPin) {
      input.value = storedPin;
      input.readOnly = true;
      input.classList.add('text-gray-400');
      input.addEventListener('focus', () => {
        input.readOnly = false;
        input.classList.remove('text-gray-400');
      }, { once: true });
    }
  };
  applyStoredPin(pinInput);
  applyStoredPin(registerPinInput);

  const enforcePin = input => {
    if (!input) return;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 5);
    });
  };
  enforcePin(pinInput);
  enforcePin(registerPinInput);
  const pinInfoLogin = document.getElementById('pinInfoLogin');
  const pinInfoRegister = document.getElementById('pinInfoRegister');
  [pinInfoLogin, pinInfoRegister].forEach(icon => {
    if (!icon) return;
    icon.addEventListener('mouseenter', () => showPinPopup(icon));
    icon.addEventListener('mouseleave', hidePinPopup);
    icon.addEventListener('click', () => {
      if (currentPinPopup) hidePinPopup();
      else showPinPopup(icon);
    });
  });


// 1) Inicializa tsParticles com efeito twinkle e cores customizadas
  tsParticles.load("bg-network", {
    fpsLimit: 30,
    background: { color: "transparent" },
    fullScreen: { enable: false },
    particles: {
      number: { value: 300, density: { enable: false } },
      color: { value: ["#A394A7", "#B7A1C2", "#CAB4D0"] },
      links: {
        enable: true,
        color: "#ffd000",
        distance: 200,
        opacity: 0.5,
        width: 0.8
      },
      move: {
        enable: true,
        speed: 1,
        warp: false,
        outModes: { default: "bounce" }
      },
      size: { value: 2 },
    },
    interactivity: {
      events: {
        onHover: { enable: true, mode: "grab" },
        onclick: { enable: true, mode: "push"},

      },
      modes: {
        grab: { distance: 140, links: { opacity: 0.7, color: "#ffffff" } },
        push: { particles_nb: 4},
      }
    },
    detectRetina: true
  }).then(container => {
    particlesContainer = container;
    const network = document.getElementById('bg-network');
    if (network) {
      network.classList.remove('network-fade-out');
      network.classList.add('visible');
    }

    window.electronAPI.showLogin();

    // Remove partículas extras gradualmente para manter o limite de 700
    setInterval(() => {
      const count = particlesContainer.particles.count;
      if (count > 400) {
        const excess = Math.min(count - 400, 5);
        particlesContainer.particles.removeQuantity(excess);
      }
    }, 500);


  });
  // === 3) Abas Login / Cadastro ===
  const loginTab     = document.getElementById('loginTab');
  const registerTab  = document.getElementById('registerTab');
  const loginForm    = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const registerSubmitButton = registerForm?.querySelector('button[type="submit"]');

  function setRegisterButtonLoading(isLoading) {
    if (!registerSubmitButton) return;
    registerSubmitButton.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (isLoading) {
      if (!registerSubmitButton.dataset.originalContent) {
        registerSubmitButton.dataset.originalContent = registerSubmitButton.innerHTML;
      }
      registerSubmitButton.disabled = true;
      registerSubmitButton.classList.add('cursor-not-allowed', 'opacity-80');
      registerSubmitButton.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span class="ml-2">Cadastrando...</span>';
    } else {
      const original = registerSubmitButton.dataset.originalContent;
      if (original) {
        registerSubmitButton.innerHTML = original;
      }
      registerSubmitButton.disabled = false;
      registerSubmitButton.classList.remove('cursor-not-allowed', 'opacity-80');
      delete registerSubmitButton.dataset.originalContent;
    }
  }
  loginTab.addEventListener('click', () => {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    loginTab.classList.add('border-b-2','border-[#b6a03e]','text-[#b6a03e]');
    loginTab.classList.remove('text-white','border-transparent');
    registerTab.classList.remove('border-b-2','border-[#b6a03e]','text-[#b6a03e]');
    registerTab.classList.add('text-white','border-transparent');
  });
  registerTab.addEventListener('click', () => {
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    registerTab.classList.add('border-b-2','border-[#b6a03e]','text-[#b6a03e]');
    registerTab.classList.remove('text-white','border-transparent');
  loginTab.classList.remove('border-b-2','border-[#b6a03e]','text-[#b6a03e]');
  loginTab.classList.add('text-white','border-transparent');
  });

  if (loginTab) loginTab.click();

  if (window.electronAPI.onActivateTab) {
    window.electronAPI.onActivateTab((tab) => {
      if (tab === 'login' && loginTab) loginTab.click();
      else if (tab === 'register' && registerTab) registerTab.click();
    });
  }

  // === 4) Modal "Esqueceu a senha?" ===
  const forgotPasswordLink  = document.getElementById('forgotPassword');
  const forgotPasswordModal = document.getElementById('forgotPasswordModal');
  const cancelResetBtn      = document.getElementById('cancelReset');
  forgotPasswordLink.addEventListener('click', e => {
    e.preventDefault();
    forgotPasswordModal.classList.remove('hidden');
  });
  cancelResetBtn.addEventListener('click', () => {
    forgotPasswordModal.classList.add('hidden');
  });

  // === 5) Toggle visibilidade de senha ===
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      target.type = target.type === 'password' ? 'text' : 'password';
    });
  });

  // === 6) Envio do formulário de Login ===
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const email    = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const pin      = document.getElementById('pin').value;
    if (pin.length !== 5) {
      showToast('PIN deve ter 5 dígitos', 'error');
      return;
    }
    const result   = await window.electronAPI.login(email, password, pin);
    if (!result.success) {
      const message = typeof result.message === 'string' ? result.message : '';
      if (
        result.code === 'inactive-user' ||
        message.toLowerCase().includes('inativo')
      ) {
        showInactiveUserWarning();
      } else {
        showToast(message || 'Erro ao realizar login', 'error');
      }
      return;
    }

    showToast('Login realizado com sucesso!', 'success');
    const remember = document.getElementById('remember').checked;
    if (result.user) localStorage.setItem('user', JSON.stringify(result.user));
    localStorage.setItem('rememberUser', remember ? '1' : '0');
    localStorage.setItem('pin', pin);
    sessionStorage.setItem('currentUser', JSON.stringify(result.user));
    await cacheUpdateStatus();

    if (pinInput) {
      pinInput.value = pin;
      pinInput.readOnly = true;
      pinInput.classList.add('text-gray-400');
    }
    if (registerPinInput) {
      registerPinInput.value = pin;
      registerPinInput.readOnly = true;
      registerPinInput.classList.add('text-gray-400');
    }

    let savedState = localStorage.getItem('savedState');
    if (!savedState) {
      const diskState = await window.electronAPI.loadState();
      if (diskState) {
        try {
          const savedUser = diskState.storage && diskState.storage.user
            ? JSON.parse(diskState.storage.user)
            : null;
          if (
            savedUser &&
            savedUser.id === result.user.id &&
            diskState.sectionId &&
            diskState.sectionId !== 'dashboard'
          ) {
            localStorage.setItem('savedState', JSON.stringify(diskState));
            await window.electronAPI.clearState();
          } else {
            await window.electronAPI.clearState();
            localStorage.removeItem('savedState');
          }
        } catch (err) {
          await window.electronAPI.clearState();
          localStorage.removeItem('savedState');
        }
      } else {
        localStorage.removeItem('savedState');
      }
    }

    window.electronAPI.openDashboard();
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.classList.add('visible');
    }
    const network = document.getElementById('bg-network');
    if (network) {
      network.classList.remove('visible');
      network.classList.add('network-fade-out');
    }
    setTimeout(() => {
      if (overlay) overlay.classList.remove('visible');
      document.body.classList.add('fade-out');
      setTimeout(() => {
        window.electronAPI.closeLogin();
      }, 500);
    }, 4000);
  });

  // === 7) Envio do formulário de Cadastro ===
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!registerForm.reportValidity()) return;

    const name            = document.getElementById('registerName').value;
    const emailReg        = document.getElementById('registerEmail').value;
    const passwordReg     = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const pinReg          = document.getElementById('registerPin').value;
    if (pinReg.length !== 5) {
      showToast('PIN deve ter 5 dígitos', 'error');
      return;
    }
    if (passwordReg !== confirmPassword) {
      showToast('As senhas não coincidem!', 'error');
      return;
    }
    setRegisterButtonLoading(true);
    try {
      const result = await window.electronAPI.register(
        name,
        emailReg,
        passwordReg,
        pinReg
      );
      if (!result.success) {
        showToast(result.message || 'PIN incorreto', 'error');
        return;
      }

      showToast(result.message, 'success');
      localStorage.setItem('pin', pinReg);
      registerForm.reset();
      applyStoredPin(registerPinInput);
      loginTab.click();
    } catch (err) {
      showToast(err.message || 'PIN incorreto', 'error');
    } finally {
      setRegisterButtonLoading(false);
    }
  });

  // === 8) Envio do formulário de Recuperação de Senha ===
  document.getElementById('resetPasswordForm').addEventListener('submit', async e => {
    e.preventDefault();
    const emailReset = document.getElementById('resetEmail').value;
    try {
      const resp = await fetchApi('/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailReset })
      });
      if (resp.ok) showToast('E-mail enviado!', 'success');
      else if (resp.status === 404) showToast('E-mail não encontrado!', 'error');
      else showToast('Erro ao solicitar redefinição', 'error');
    } catch (err) {
      showToast('Erro ao solicitar redefinição', 'error');
    }
    forgotPasswordModal.classList.add('hidden');
  });
});
