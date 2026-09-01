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

function showInactiveUserWarning(mensagem) {
  showToast(mensagem || 'Login bloqueado pelo administrador, entre em contato.', 'error');
}

let pinErrorShown = false;
let offlineErrorShown = false;
let userRemovedErrorShown = false;
let pendingLoginRetryTimeout = null;
let lastLoginAttempt = null;
const LOGIN_RETRY_MIN_DELAY_MS = 5000;
let pendingAutoLoginRetryTimeout = null;
const AUTO_LOGIN_RETRY_MIN_DELAY_MS = 1000;
const PARTICLES_RESIZE_DEBOUNCE_MS = 200;
const PARTICLES_LAYOUT_STABILIZE_DELAY_MS = 600;

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
      <h2 class="warning-title">Token Alterado</h2>
      <p class="warning-text">Usuário desconectado, Token de Acesso alterado por questões de segurança. Faça login novamente para renovar Token.</p>
      <hr class="warning-divider">
      <p class="warning-text-small">Caso tenha problemas no login, contate o Administrador.</p>
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

let adminDisabledErrorShown = false;
function showAdminDisabledError(modo) {
  if (adminDisabledErrorShown) return;
  adminDisabledErrorShown = true;
  const pendente = modo === 'pending';
  const overlay = document.createElement('div');
  overlay.className = 'warning-overlay';
  overlay.innerHTML = `
    <div class="warning-modal scale-95">
      <div class="warning-icon">
        <div class="warning-icon-circle">
          <i data-feather="user-minus"></i>
        </div>
      </div>
      <h2 class="warning-title">${pendente ? 'Acesso Pendente' : 'Acesso Revogado'}</h2>
      <p class="warning-text">${pendente
        ? 'Seu acesso ainda não foi liberado pelo administrador. Você foi desconectado.'
        : 'Seu acesso foi desativado pelo administrador. Você foi desconectado do sistema.'}</p>
      <hr class="warning-divider">
      <p class="warning-text-small">Entre em contato com o administrador para reativar o seu acesso. Ao fazer login dentro de 30 min o programa restaurará os dados em registro, se existirem.</p>
      <button id="adminDisabledOk" class="warning-button pulse">OK</button>
    </div>`;
  document.body.appendChild(overlay);
  if (typeof feather !== 'undefined') feather.replace();
  overlay.querySelector('#adminDisabledOk')?.addEventListener('click', () => {
    overlay.remove();
    adminDisabledErrorShown = false;
  }, { once: true });
}

let maxAttemptsErrorShown = false;
/**
 * @param {boolean|null} emailEnviado  `null` quando o bloqueio já estava ativo
 *   e nenhum envio foi tentado agora. Prometer um e-mail que não saiu deixa o
 *   usuário esperando por uma mensagem que nunca chega — pior que dizer que
 *   ele não foi enviado.
 */
function showMaxAttemptsError(mensagem, emailEnviado = null) {
  if (maxAttemptsErrorShown) return;
  maxAttemptsErrorShown = true;
  const rodape = emailEnviado === true
    ? 'Enviamos um e-mail de redefinição de senha para o endereço cadastrado. Verifique sua caixa de entrada.'
    : (emailEnviado === false
      ? 'Não foi possível enviar o e-mail de redefinição de senha. Procure o administrador para liberar o acesso.'
      : 'Aguarde o tempo indicado ou procure o administrador para liberar o acesso.');
  const overlay = document.createElement('div');
  overlay.className = 'warning-overlay';
  overlay.innerHTML = `
    <div class="warning-modal scale-95">
      <div class="warning-icon">
        <div class="warning-icon-circle">
          <i data-feather="lock"></i>
        </div>
      </div>
      <h2 class="warning-title">Login Bloqueado</h2>
      <p class="warning-text">${mensagem || 'Número máximo de tentativas de login atingido.'}</p>
      <hr class="warning-divider">
      <p class="warning-text-small">${rodape}</p>
      <button id="maxAttemptsOk" class="warning-button pulse">OK</button>
    </div>`;
  document.body.appendChild(overlay);
  if (typeof feather !== 'undefined') feather.replace();
  overlay.querySelector('#maxAttemptsOk')?.addEventListener('click', () => {
    overlay.remove();
    maxAttemptsErrorShown = false;
  }, { once: true });
}

function showUserRemovedError() {
  if (userRemovedErrorShown) return;
  userRemovedErrorShown = true;
  const overlay = document.createElement('div');
  overlay.className = 'warning-overlay';
  overlay.innerHTML = `
    <div class="warning-modal scale-95">
      <div class="warning-icon">
        <div class="warning-icon-circle">
          <i data-feather="user-x"></i>
        </div>
      </div>
      <h2 class="warning-title">Usuário Removido</h2>
      <p class="warning-text">Seu usuário foi removido dos registros. Você foi desconectado por segurança.</p>
      <hr class="warning-divider">
      <p class="warning-text-small">Entre em contato com o suporte para restaurar o acesso e obter mais informações.</p>
      <button id="userRemovedOk" class="warning-button pulse">OK</button>
    </div>`;
  document.body.appendChild(overlay);
  feather.replace();
  requestAnimationFrame(() => {
    const modal = overlay.querySelector('div');
    modal.classList.remove('scale-95');
  });
  const btn = overlay.querySelector('#userRemovedOk');
  setTimeout(() => btn.classList.remove('pulse'), 1500);
  btn.addEventListener('click', () => overlay.remove());
}

window.addEventListener("DOMContentLoaded", async () => {
  const intro = document.getElementById('introOverlay');
  const params = new URLSearchParams(window.location.search);
  const startHidden = params.get('hidden') === '1';
  let particlesContainer = null;
  let particlesCleanupIntervalId = null;
  let particlesReady = false;
  let particlesResizeTimeoutId = null;
  let particlesResizeUnlockTimeoutId = null;
  let particlesResizeListenerAttached = false;
  let particlesResizeLocked = true;
  let particlesLastSize = { width: 0, height: 0 };

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


  const storedUser = localStorage.getItem('user');
  let parsedStoredUser = null;
  try {
    parsedStoredUser = storedUser ? JSON.parse(storedUser) : null;
  } catch (_) {
    parsedStoredUser = null;
  }
  const rememberUser = localStorage.getItem('rememberUser') === '1';

  function clearPendingAutoLoginRetry() {
    if (pendingAutoLoginRetryTimeout) {
      clearTimeout(pendingAutoLoginRetryTimeout);
      pendingAutoLoginRetryTimeout = null;
    }
  }

  function scheduleAutoLoginRetry(user, storedUserValue, retryAfter) {
    clearPendingAutoLoginRetry();
    const suggestedRetry = Number(retryAfter);
    const delay = Math.max(
      AUTO_LOGIN_RETRY_MIN_DELAY_MS,
      Number.isFinite(suggestedRetry) && suggestedRetry > 0 ? suggestedRetry : 0
    );
    pendingAutoLoginRetryTimeout = setTimeout(async () => {
      pendingAutoLoginRetryTimeout = null;
      const stillRemembering = localStorage.getItem('rememberUser') === '1';
      const stillHasUser = localStorage.getItem('user');
      if (!stillRemembering || !stillHasUser) {
        return;
      }
      try {
        await attemptStoredAutoLogin(user, storedUserValue);
      } catch (retryErr) {
        console.error('Tentativa automática de auto-login falhou', retryErr);
      }
    }, delay);
  }

  /**
   * Guarda quem entrou por último — é o que monta o cartão com foto e nome na
   * próxima abertura. O carimbo de horário é gravado AQUI, no instante do
   * login: quando a tela de login volta a aparecer não há sessão nem rede
   * garantida para perguntar isso a ninguém.
   */
  function registrarUltimoUsuario(usuario, emailDigitado = '') {
    if (!usuario) return;
    try {
      const lastUser = {
        id: usuario.id,
        nome: getUserName(usuario),
        email: getUserLogin(usuario) || emailDigitado,
        avatarUrl: getUserAvatar(usuario),
        avatarVersion: usuario.avatarVersion || usuario.avatar_version || '',
        ultimoLoginEm: new Date().toISOString()
      };
      localStorage.setItem('lastLoginUser', JSON.stringify(lastUser));
    } catch (err) {
      console.error('Não foi possível guardar o último usuário.', err);
    }
  }

  async function attemptStoredAutoLogin(user, storedUserValue) {
    try {
      const result = await window.electronAPI.autoLogin(user);
      if (result && result.success) {
        clearPendingAutoLoginRetry();
        const cachedUser = storedUserValue || (result.user ? JSON.stringify(result.user) : null);
        if (cachedUser) sessionStorage.setItem('currentUser', cachedUser);
        // O auto-login também é um login: sem isto o cartão continuaria
        // mostrando a data de uma entrada manual antiga.
        registrarUltimoUsuario(result.user || user, getUserLogin(user));
        await cacheUpdateStatus();
        await window.electronAPI.requestConnectionCheck?.({ forceDeep: true });
        return true;
      }

      const reasonRaw = typeof result?.reason === 'string' ? result.reason.trim() : '';
      const codeRaw = typeof result?.code === 'string' ? result.code.trim() : '';
      const normalizedReason = reasonRaw.toLowerCase();
      const normalizedCode = codeRaw.toLowerCase();
      const effectiveReason = normalizedReason || normalizedCode;

      if (effectiveReason === 'db-connecting') {
        scheduleAutoLoginRetry(user, storedUserValue, result?.retryAfter);
        return false;
      }

      clearPendingAutoLoginRetry();
      localStorage.removeItem('user');
      localStorage.removeItem('rememberUser');
      const adminDisabledFlag = localStorage.getItem('adminDisabled');
      if (effectiveReason === 'admin-disabled' || effectiveReason === 'admin-pending' || adminDisabledFlag) {
        showAdminDisabledError(
          effectiveReason === 'admin-pending' || adminDisabledFlag === 'pending' ? 'pending' : 'disabled'
        );
      } else if (effectiveReason === 'offline') {
        showOfflineError();
      } else if (effectiveReason === 'user-removed') {
        showUserRemovedError();
      } else if (effectiveReason === 'pin') {
        showPinError();
      } else if (effectiveReason) {
        showToast(result?.message || 'Falha no login automático.', 'error');
      } else {
        showPinError();
      }
      localStorage.removeItem('pinChanged');
      localStorage.removeItem('offlineDisconnect');
      localStorage.removeItem('userRemoved');
      localStorage.removeItem('adminDisabled');
    } catch (err) {
      clearPendingAutoLoginRetry();
      console.error('Erro inesperado durante auto-login:', err);
      showToast('Falha no login automático.', 'error');
    }
    return false;
  }

  if (storedUser && rememberUser) {
    let saved = await window.electronAPI.loadState();
    if (saved) {
      try {
        // Regra única em src/js/utils/restauracao.js: só volta se a sessão
        // anterior caiu (rede/banco/corte do admin) E o dono for quem está
        // entrando agora. NÃO apagamos o arquivo do disco: o menu lê de lá como
        // plano B e aplica exatamente o mesmo porteiro.
        const veredito = window.RestauracaoTrabalho.podeRestaurar(saved, parsedStoredUser);
        if (veredito.ok && saved.sectionId && saved.sectionId !== 'dashboard') {
          localStorage.setItem('savedState', JSON.stringify(saved));
        }
      } catch (err) {
        console.error('Falha ao repassar o trabalho guardado.', err);
      }
    }

    const autoLoginSucceeded = await attemptStoredAutoLogin(parsedStoredUser, storedUser);
    if (autoLoginSucceeded) {
      return;
    }
  } else if (storedUser && !rememberUser) {
    localStorage.removeItem('user');
    localStorage.removeItem('rememberUser');
  }
  /**
   * Avisos deixados pelo dashboard antes de cair para o login.
   *
   * Precisa ser reavaliado toda vez que a janela é EXIBIDA, não só no
   * DOMContentLoaded: a janela de login costuma já existir (criada escondida no
   * início do app), então o carregamento acontece muito antes da desconexão e
   * os avisos gravados depois nunca eram lidos — a tela voltava calada.
   */
  function mostrarAvisosPendentes() {
    if (localStorage.getItem('pinChanged')) {
      localStorage.removeItem('pinChanged');
      showPinError();
    }
    if (localStorage.getItem('offlineDisconnect')) {
      localStorage.removeItem('offlineDisconnect');
      showOfflineError();
    }
    if (localStorage.getItem('userRemoved')) {
      localStorage.removeItem('userRemoved');
      showUserRemovedError();
    }
    if (localStorage.getItem('sessaoExpirada')) {
      localStorage.removeItem('sessaoExpirada');
      showToast('Sua sessão expirou. Entre novamente para continuar.', 'info');
    }
    const admin = localStorage.getItem('adminDisabled');
    if (admin) {
      localStorage.removeItem('adminDisabled');
      if (typeof showAdminDisabledError === 'function') {
        showAdminDisabledError(admin === 'pending' ? 'pending' : 'disabled');
      }
    }
  }

  mostrarAvisosPendentes();
  window.__mostrarAvisosPendentes = mostrarAvisosPendentes;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) mostrarAvisosPendentes();
  });
  const setupParticlesCleanupInterval = () => {
    if (particlesCleanupIntervalId) {
      clearInterval(particlesCleanupIntervalId);
      particlesCleanupIntervalId = null;
    }
    if (!particlesContainer) return;
    particlesCleanupIntervalId = setInterval(() => {
      const count = particlesContainer.particles.count;
      if (count > 400) {
        const excess = Math.min(count - 400, 5);
        particlesContainer.particles.removeQuantity(excess);
      }
    }, 500);
  };

  const getParticlesTargetSize = () => {
    const network = document.getElementById('bg-network');
    if (!network) return null;
    const width = network.clientWidth;
    const height = network.clientHeight;
    if (!width || !height) return null;
    return { width, height };
  };

  const lockParticlesCanvasSize = () => {
    const canvas = particlesContainer?.canvas?.element;
    const size = getParticlesTargetSize();
    if (!canvas || !size) return;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    particlesLastSize = size;
    particlesResizeLocked = true;
  };

  const unlockParticlesCanvasSize = () => {
    const canvas = particlesContainer?.canvas?.element;
    if (!canvas) return;
    canvas.style.width = "";
    canvas.style.height = "";
    particlesResizeLocked = false;
  };

  const resizeParticlesIfNeeded = () => {
    if (!particlesContainer || particlesResizeLocked) return;
    const size = getParticlesTargetSize();
    if (!size) return;
    if (size.width === particlesLastSize.width && size.height === particlesLastSize.height) return;
    particlesLastSize = size;
    if (typeof particlesContainer.resize === "function") {
      particlesContainer.resize();
    }
  };

  const handleParticlesResize = () => {
    if (particlesResizeTimeoutId) {
      clearTimeout(particlesResizeTimeoutId);
    }
    particlesResizeTimeoutId = setTimeout(() => {
      particlesResizeTimeoutId = null;
      resizeParticlesIfNeeded();
    }, PARTICLES_RESIZE_DEBOUNCE_MS);
  };

  const attachParticlesResizeListener = () => {
    if (particlesResizeListenerAttached) return;
    particlesResizeListenerAttached = true;
    window.addEventListener('resize', handleParticlesResize);
  };

  const scheduleParticlesResizeUnlock = () => {
    if (particlesResizeUnlockTimeoutId) {
      clearTimeout(particlesResizeUnlockTimeoutId);
    }
    particlesResizeUnlockTimeoutId = setTimeout(() => {
      particlesResizeUnlockTimeoutId = null;
      unlockParticlesCanvasSize();
      resizeParticlesIfNeeded();
    }, PARTICLES_LAYOUT_STABILIZE_DELAY_MS);
  };

  const handleParticlesReady = (container) => {
    particlesContainer = container;
    const network = document.getElementById('bg-network');
    if (network) {
      network.classList.remove('network-fade-out');
      network.classList.add('visible');
    }

    window.electronAPI.showLogin();
    lockParticlesCanvasSize();
    scheduleParticlesResizeUnlock();
    attachParticlesResizeListener();
    resizeParticlesIfNeeded();
    setupParticlesCleanupInterval();
  };

  document.addEventListener('visibilitychange', () => {
    if (!particlesContainer) return;
    if (document.hidden) {
      particlesContainer.pause();
    } else {
      particlesContainer.play();
    }
  });

  const existingParticles = tsParticles.domItem("bg-network");
  if (existingParticles) {
    particlesContainer = existingParticles;
    particlesContainer.play();
    particlesReady = true;
    handleParticlesReady(existingParticles);
  } else {
    if (!particlesReady) {
      // NÃO marcamos `particlesReady` aqui. A janela de login nasce oculta
      // (show:false) e uma janela oculta no Electron não compõe quadros: os
      // requestAnimationFrame abaixo simplesmente não disparavam. Marcando o
      // sinalizador antes da hora, a retentativa ficava bloqueada e o efeito
      // nunca começava. Agora só marcamos depois de realmente carregar.
      const iniciarParticulas = () => {
        if (particlesReady) return;
        particlesReady = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
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
                resize: { enable: false, delay: 0 },

              },
              modes: {
                grab: { distance: 140, links: { opacity: 0.7, color: "#ffffff" } },
                push: { particles_nb: 4},
              }
            },
            detectRetina: true
          }).then(handleParticlesReady);
          });
        });
      };

      // Só inicia quando a página estiver de fato visível. Assim o carregamento
      // pesado (300 partículas) não é disparado no exato instante em que a
      // janela aparece — era daí o travamento rápido ao voltar para o login.
      if (!document.hidden) {
        iniciarParticulas();
      } else {
        document.addEventListener('visibilitychange', function aoAparecer() {
          if (document.hidden) return;
          document.removeEventListener('visibilitychange', aoAparecer);
          iniciarParticulas();
        });
      }
    }
  }
  // === 3) Abas Login / Cadastro ===
  const loginTab     = document.getElementById('loginTab');
  const registerTab  = document.getElementById('registerTab');
  const loginForm    = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const registerSubmitButton = registerForm?.querySelector('button[type="submit"]');
  const loginSubmitButton = loginForm?.querySelector('button[type="submit"]');
  const emailInput = document.getElementById('email');
  const emailSuggestions = document.getElementById('emailSuggestions');
  const loginContainer = document.querySelector('.login-container');
  const lastUserProfile = document.getElementById('lastUserProfile');
  const lastUserAvatar = document.getElementById('lastUserAvatar');
  const lastUserName = document.getElementById('lastUserName');
  const lastUserLoginAt = document.getElementById('lastUserLoginAt');
  const changeUserButton = document.getElementById('changeUserButton');
  let activeEmailSuggestionIndex = -1;
  let lastUserMode = false;

  function getLastLoginUser() {
    try {
      const value = localStorage.getItem('lastLoginUser');
      const user = value ? JSON.parse(value) : parsedStoredUser;
      return user && (user.email || user.usuario || user.username) ? user : null;
    } catch (_) {
      return null;
    }
  }

  function getUserLogin(user) {
    return String(user?.email || user?.usuario || user?.username || '').trim();
  }

  function getUserName(user) {
    return String(user?.nome || user?.name || user?.nome_completo || getUserLogin(user)).trim();
  }

  /**
   * Quando este usuário entrou pela última vez.
   *
   * O carimbo é gravado no próprio login (`lastLoginUser.ultimoLoginEm`), então
   * na volta à tela ele já está lá — sem depender de rede nem de sessão ativa,
   * que é justamente o que não existe nesse momento. Cadastros antigos, salvos
   * antes disto, simplesmente não trazem a data e a linha não aparece.
   */
  function getUltimoLoginEm(user) {
    const bruto = user?.ultimoLoginEm || user?.ultimo_login_em || user?.ultimaEntrada || user?.ultima_entrada;
    if (!bruto) return null;
    const data = bruto instanceof Date ? bruto : new Date(bruto);
    return Number.isNaN(data.getTime()) ? null : data;
  }

  function formatarUltimoLogin(data) {
    if (!data) return '';
    return data.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getUserAvatar(user) {
    return user?.avatarUrl || user?.avatar_url || user?.avatar || user?.fotoUrl ||
      user?.foto_usuario || user?.foto || user?.foto_perfil_url || user?.foto_perfil || '';
  }

  async function resolveAvatarSource(source) {
    if (!source || /^(data:|blob:|https?:\/\/|file:)/i.test(source)) return source;
    try {
      const baseUrl = await window.apiConfig.getApiBaseUrl();
      return new URL(source, `${baseUrl}/`).href;
    } catch (_) {
      return source;
    }
  }

  async function activateLastUserMode(user) {
    if (!user || !emailInput || !lastUserProfile) return;
    lastUserMode = true;
    const login = getUserLogin(user);
    const name = getUserName(user);
    emailInput.value = login;
    emailInput.readOnly = true;
    emailInput.classList.add('is-locked');
    emailInput.setAttribute('aria-label', `Usuário selecionado: ${login}`);
    lastUserName.textContent = name;

    const ultimoLogin = getUltimoLoginEm(user);
    if (lastUserLoginAt) {
      if (ultimoLogin) {
        lastUserLoginAt.textContent = `Último login: ${formatarUltimoLogin(ultimoLogin)}`;
        lastUserLoginAt.classList.remove('hidden');
      } else {
        lastUserLoginAt.textContent = '';
        lastUserLoginAt.classList.add('hidden');
      }
    }

    lastUserAvatar.textContent = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
    const avatar = await resolveAvatarSource(getUserAvatar(user));
    if (lastUserMode && avatar) {
      const image = document.createElement('img');
      image.alt = `Foto de perfil de ${name}`;
      image.src = avatar;
      image.addEventListener('error', () => {
        if (lastUserMode) lastUserAvatar.textContent = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
      }, { once: true });
      lastUserAvatar.replaceChildren(image);
    }
    lastUserProfile.classList.remove('hidden');
    changeUserButton?.classList.remove('hidden');
    loginContainer?.classList.add('has-last-user');
    closeEmailSuggestions();
    document.getElementById('password')?.focus();
    if (typeof feather !== 'undefined') feather.replace();
  }

  function deactivateLastUserMode() {
    lastUserMode = false;
    emailInput.readOnly = false;
    emailInput.value = '';
    emailInput.classList.remove('is-locked');
    emailInput.setAttribute('aria-label', 'E-mail ou usuário');
    lastUserProfile?.classList.add('hidden');
    lastUserLoginAt?.classList.add('hidden');
    changeUserButton?.classList.add('hidden');
    loginContainer?.classList.remove('has-last-user');
    emailInput.focus();
    renderEmailSuggestions();
  }

  changeUserButton?.addEventListener('click', deactivateLastUserMode);
  const lastLoginUser = getLastLoginUser();
  if (lastLoginUser) activateLastUserMode(lastLoginUser);

  function loadRememberedEmails() {
    try {
      const raw = localStorage.getItem('rememberedEmails');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch (_) {
      return [];
    }
  }

  function persistRememberedEmail(value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const list = loadRememberedEmails();
    const seen = new Set();
    const updated = [];
    const lowerTrimmed = trimmed.toLowerCase();
    list.forEach((email) => {
      const lower = email.toLowerCase();
      if (!seen.has(lower) && lower !== lowerTrimmed) {
        seen.add(lower);
        updated.push(email);
      }
    });
    updated.push(trimmed);
    updated.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    localStorage.setItem('rememberedEmails', JSON.stringify(updated));
  }

  function filterRememberedEmails(prefix) {
    const normalized = prefix.trim().toLowerCase();
    if (!normalized) return loadRememberedEmails();
    return loadRememberedEmails().filter((email) => email.toLowerCase().startsWith(normalized));
  }

  function closeEmailSuggestions() {
    if (!emailSuggestions || !emailInput) return;
    emailSuggestions.classList.add('hidden');
    emailSuggestions.innerHTML = '';
    activeEmailSuggestionIndex = -1;
    emailInput.setAttribute('aria-expanded', 'false');
  }

  function highlightEmailSuggestion(index) {
    if (!emailSuggestions) return;
    const options = Array.from(emailSuggestions.querySelectorAll('[role="option"]'));
    options.forEach((option, idx) => {
      if (idx === index) {
        option.classList.add('active');
        option.setAttribute('aria-selected', 'true');
        option.scrollIntoView({ block: 'nearest' });
      } else {
        option.classList.remove('active');
        option.setAttribute('aria-selected', 'false');
      }
    });
  }

  function selectEmailSuggestion(value) {
    if (!emailInput) return;
    emailInput.value = value;
    closeEmailSuggestions();
  }

  function renderEmailSuggestions() {
    if (!emailSuggestions || !emailInput) return;
    if (lastUserMode) {
      closeEmailSuggestions();
      return;
    }
    const suggestions = filterRememberedEmails(emailInput.value);
    emailSuggestions.innerHTML = '';
    activeEmailSuggestionIndex = -1;

    if (!suggestions.length) {
      closeEmailSuggestions();
      return;
    }

    suggestions.forEach((email, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'email-suggestion-option';
      option.textContent = email;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.addEventListener('click', () => selectEmailSuggestion(email));
      option.addEventListener('mousemove', () => {
        activeEmailSuggestionIndex = index;
        highlightEmailSuggestion(activeEmailSuggestionIndex);
      });
      emailSuggestions.appendChild(option);
    });

    emailSuggestions.classList.remove('hidden');
    emailInput.setAttribute('aria-expanded', 'true');
  }

  if (emailInput && emailSuggestions) {
    emailInput.addEventListener('input', () => {
      renderEmailSuggestions();
    });

    emailInput.addEventListener('focus', () => {
      renderEmailSuggestions();
    });

    emailInput.addEventListener('keydown', (event) => {
      const options = Array.from(emailSuggestions.querySelectorAll('[role="option"]'));
      if (!options.length) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeEmailSuggestionIndex =
          activeEmailSuggestionIndex < options.length - 1 ? activeEmailSuggestionIndex + 1 : 0;
        highlightEmailSuggestion(activeEmailSuggestionIndex);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeEmailSuggestionIndex =
          activeEmailSuggestionIndex > 0 ? activeEmailSuggestionIndex - 1 : options.length - 1;
        highlightEmailSuggestion(activeEmailSuggestionIndex);
      } else if (event.key === 'Enter') {
        if (activeEmailSuggestionIndex >= 0) {
          event.preventDefault();
          const selected = options[activeEmailSuggestionIndex];
          if (selected) {
            selectEmailSuggestion(selected.textContent);
          }
        }
      } else if (event.key === 'Tab') {
        const targetIndex = activeEmailSuggestionIndex >= 0 ? activeEmailSuggestionIndex : 0;
        const selected = options[targetIndex];
        if (selected) {
          selectEmailSuggestion(selected.textContent);
        }
      } else if (event.key === 'Escape') {
        closeEmailSuggestions();
      }
    });

    document.addEventListener('click', (event) => {
      if (!emailSuggestions.contains(event.target) && event.target !== emailInput) {
        closeEmailSuggestions();
      }
    });
  }

  function clearPendingLoginRetry() {
    if (pendingLoginRetryTimeout) {
      clearTimeout(pendingLoginRetryTimeout);
      pendingLoginRetryTimeout = null;
    }
  }

  function setLoginButtonLoading(isLoading, label = 'Entrando...') {
    if (!loginSubmitButton) return;
    loginSubmitButton.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (isLoading) {
      if (!loginSubmitButton.dataset.originalContent) {
        loginSubmitButton.dataset.originalContent = loginSubmitButton.innerHTML;
      }
      loginSubmitButton.disabled = true;
      loginSubmitButton.classList.add('cursor-not-allowed', 'opacity-80');
      loginSubmitButton.innerHTML =
        `<span class="button-spinner" aria-hidden="true"></span><span class="ml-2">${label}</span>`;
    } else {
      const original = loginSubmitButton.dataset.originalContent;
      if (original) {
        loginSubmitButton.innerHTML = original;
      }
      loginSubmitButton.disabled = false;
      loginSubmitButton.classList.remove('cursor-not-allowed', 'opacity-80');
      delete loginSubmitButton.dataset.originalContent;
    }
  }

  function scheduleLoginRetry(payload, retryAfter) {
    clearPendingLoginRetry();
    const delay = Math.max(Number(retryAfter) || 0, LOGIN_RETRY_MIN_DELAY_MS);
    pendingLoginRetryTimeout = setTimeout(() => {
      pendingLoginRetryTimeout = null;
      if (!lastLoginAttempt || lastLoginAttempt.attemptId !== payload.attemptId) {
        return;
      }
      setLoginButtonLoading(true, 'Entrando...');
      processLoginAttempt({ ...payload, autoRetry: true }).catch((err) => {
        console.error('Tentativa automática de login falhou', err);
      });
    }, delay);
  }

  async function processLoginAttempt({ email, password, attemptId, autoRetry = false }) {
    let keepLoading = false;
    setLoginButtonLoading(true, 'Entrando...');
    try {
      const result = await window.electronAPI.login(email, password);
      if (!result.success) {
        const message = typeof result.message === 'string' ? result.message : '';
        const reason = typeof result.reason === 'string' ? result.reason.trim() : '';
        const normalizedReason = reason.toLowerCase();
        if (normalizedReason && normalizedReason !== 'db-connecting') {
          clearPendingLoginRetry();
          lastLoginAttempt = null;
          if (normalizedReason === 'pin') {
            showToast(message || 'Sessão inválida. Faça login novamente.', 'error');
            return;
          }
          if (normalizedReason === 'user-auth') {
            showToast(message || 'Credenciais inválidas. Verifique login e senha.', 'error');
            return;
          }
          if (normalizedReason === 'offline') {
            showToast(message || 'Sem conexão com internet', 'error');
            return;
          }
          showToast(message || 'Erro ao realizar login', 'error');
          return;
        }
        if (normalizedReason === 'db-connecting' || result.code === 'db-connecting') {
          keepLoading = true;
          setLoginButtonLoading(true, 'Entrando...');
          const retryPayload = { email, password, attemptId };
          scheduleLoginRetry(retryPayload, result.retryAfter);
          return;
        }
        clearPendingLoginRetry();
        lastLoginAttempt = null;
        if (result.code === 'max-attempts') {
          showMaxAttemptsError(message, result.emailEnviado ?? null);
        } else if (result.code === 'invalid-credentials') {
          // mensagem específica: erro de usuário/senha (não genérica)
          showToast(message || 'Usuário ou senha incorretos.', 'error');
        } else if (
          result.code === 'inactive-user' ||
          result.code === 'unconfirmed-user' ||
          message.toLowerCase().includes('inativo') ||
          message.toLowerCase().includes('bloqueado')
        ) {
          showInactiveUserWarning(message);
        } else {
          showToast(message || 'Erro ao realizar login', 'error');
        }
        return;
      }

      clearPendingLoginRetry();
      lastLoginAttempt = null;
      showToast('Login realizado com sucesso!', 'success');
      const remember = document.getElementById('remember').checked;
      if (remember) {
        persistRememberedEmail(email);
      }
      if (result.user) localStorage.setItem('user', JSON.stringify(result.user));
      if (result.user) {
        registrarUltimoUsuario(result.user, email);
      }
      localStorage.setItem('rememberUser', remember ? '1' : '0');
      sessionStorage.setItem('currentUser', JSON.stringify(result.user));
      await cacheUpdateStatus();

      let savedState = localStorage.getItem('savedState');
      if (!savedState) {
        const diskState = await window.electronAPI.loadState();
        if (diskState) {
          try {
            // Mesma regra do bloco de auto-login: repassa quando a sessão
            // anterior caiu e o dono é quem acabou de entrar; deixa o arquivo
            // no disco para o menu ler como plano B.
            const veredito = window.RestauracaoTrabalho.podeRestaurar(diskState, result.user);
            if (veredito.ok && diskState.sectionId && diskState.sectionId !== 'dashboard') {
              localStorage.setItem('savedState', JSON.stringify(diskState));
            }
          } catch (err) {
            console.error('Falha ao repassar o trabalho guardado.', err);
          }
        }
      }

      window.electronAPI.openDashboard();
      window.electronAPI.requestConnectionCheck?.({ forceDeep: true });
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
        if (overlay) overlay.classList.add('fade-out');
      }, 1500);
      setTimeout(() => {
        if (overlay) overlay.classList.remove('visible');
        document.body.classList.add('fade-out');
        setTimeout(() => {
          window.electronAPI.closeLogin();
        }, 500);
      }, 4000);
    } catch (err) {
      clearPendingLoginRetry();
      lastLoginAttempt = null;
      showToast('Erro ao realizar login', 'error');
      console.error('Falha ao realizar login', err);
    } finally {
      if (!keepLoading) {
        setLoginButtonLoading(false);
      }
    }
  }

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
      // Sinal explícito de que a janela foi exibida: garante o aviso de
      // desconexão mesmo se o visibilitychange não chegar.
      window.__mostrarAvisosPendentes?.();
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
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const email = emailInput ? emailInput.value : '';
    const password = passwordInput ? passwordInput.value : '';

    clearPendingLoginRetry();
    const attemptId = Date.now();
    lastLoginAttempt = { email, password, attemptId };
    await processLoginAttempt({ email, password, attemptId, autoRetry: false });
  });

  // === 7) Envio do formulário de Cadastro ===
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!registerForm.reportValidity()) return;

    const name            = document.getElementById('registerName').value;
    const emailReg        = document.getElementById('registerEmail').value;
    const passwordReg     = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    if (passwordReg !== confirmPassword) {
      showToast('As senhas não coincidem!', 'error');
      return;
    }
    setRegisterButtonLoading(true);
    try {
      const result = await window.electronAPI.register(
        name,
        emailReg,
        passwordReg
      );
      if (!result.success) {
        showToast(result.message || 'Erro ao cadastrar usuário', 'error');
        return;
      }

      showToast(result.message, 'success');
      registerForm.reset();
      loginTab.click();
    } catch (err) {
      showToast(err.message || 'Erro ao cadastrar usuário', 'error');
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

      if (resp.ok) {
        // O token foi criado; o e-mail pode não ter saído (envio desligado no
        // servidor). Dizer "enviado" nesse caso deixa o usuário esperando.
        const dados = await resp.json().catch(() => null);
        if (dados?.emailEnviado === false) {
          showToast(
            'Não foi possível enviar o e-mail de redefinição. Procure o administrador.',
            'error'
          );
        } else {
          showToast('E-mail enviado!', 'success');
        }
      } else {
        let errorMessage = '';
        try {
          const data = await resp.json();
          if (data && typeof data.error === 'string') errorMessage = data.error;
        } catch (_) {
          errorMessage = '';
        }

        if (resp.status === 404) {
          showToast(errorMessage || 'E-mail não encontrado!', 'error');
        } else if (resp.status === 401) {
          showToast(errorMessage || 'Sessão inválida. Tente novamente.', 'error');
        } else if (resp.status === 400) {
          showToast(errorMessage || 'Solicitação inválida. Tente novamente.', 'error');
        } else if (resp.status === 503) {
          showToast(errorMessage || 'Sem conexão com internet.', 'error');
        } else {
          showToast('Erro ao solicitar redefinição', 'error');
        }
      }
    } catch (err) {
      showToast('Erro ao solicitar redefinição', 'error');
    } finally {
      forgotPasswordModal.classList.add('hidden');
    }
  });
});
