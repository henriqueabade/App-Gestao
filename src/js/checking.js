// Verificação periódica de conectividade com o backend e ao banco de dados
// Usa o botão de sincronização existente para exibir o status
const checkBtn = document.getElementById('networkCheck');
const icon = checkBtn ? checkBtn.querySelector('i') : null;
const LOGOUT_DEBOUNCE_MS = 5000;
let checking = false;
let unsubscribeStatus = null;
let lastLogoutReason = null;
let lastLogoutHandledAt = 0;

function showSpinner(color = 'var(--color-blue)') {
  if (!checkBtn || !icon) return;
  checkBtn.style.color = color;
  icon.classList.remove('fa-check');
  icon.classList.add('fa-sync-alt', 'rotating');
}

function showSuccess() {
  if (!checkBtn || !icon) return;
  icon.classList.remove('fa-sync-alt', 'rotating');
  icon.classList.add('fa-check');
  checkBtn.style.color = 'var(--color-green)';
  setTimeout(() => {
    if (!disconnectHandled) {
      showSpinner();
    }
  }, 1000);
}

function showFailure() {
  showSpinner('var(--color-red)');
}

async function handleDisconnect(reason) {
  showFailure();
  if (window.stopServerCheck) window.stopServerCheck();
  if (reason === 'pin') {
    localStorage.setItem('pinChanged', '1');
  } else if (reason === 'offline') {
    localStorage.setItem('offlineDisconnect', '1');
  } else if (reason === 'user-removed') {
    localStorage.setItem('userRemoved', '1');
  }
  if (window.collectState && window.electronAPI && window.electronAPI.saveState) {
    window.electronAPI.saveState(window.collectState());
  }
  if (window.electronAPI) {
    try {
      await window.electronAPI.openLoginHidden();
      await window.electronAPI.showLogin();
      await new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => resolve());
        } else {
          resolve();
        }
      });
      await window.electronAPI.logout();
    } catch (err) {
      console.error('Failed to return to login after disconnect', err);
    }
  }
}

function applyStatus(status) {
  if (!status || !checkBtn || !icon) return;
  const state = status.state || 'checking';
  const reason = status.reason;
  const shouldLogout = Boolean(status.shouldLogout);

  const titles = {
    online: 'Conectado ao servidor',
    checking: 'Verificando conectividade...',
    offline: 'Sem conexão com a Internet ou servidor',
    'db-offline': 'Banco de dados indisponível',
    waiting: 'Monitor em espera (janela inativa)'
  };
  const title = titles[state] || 'Monitorando conexão';
  checkBtn.setAttribute('title', title);

  if (state === 'online') {
    checking = false;
    showSuccess();
  } else if (state === 'checking') {
    checking = true;
    showSpinner();
  } else if (state === 'waiting') {
    checking = false;
    showSpinner('var(--color-blue)');
  } else if (state === 'db-offline') {
    checking = false;
    showSpinner('var(--color-orange)');
  } else {
    checking = false;
    showSpinner('var(--color-red)');
  }

  if (!shouldLogout && lastLogoutReason) {
    lastLogoutReason = null;
    lastLogoutHandledAt = 0;
  }
}

function shouldDebounceLogout(reason) {
  const now = Date.now();
  if (!reason) return false;
  if (lastLogoutReason === reason && now - lastLogoutHandledAt < LOGOUT_DEBOUNCE_MS) {
    return true;
  }
  return false;
}

function markLogoutHandled(reason) {
  lastLogoutReason = reason;
  lastLogoutHandledAt = Date.now();
}

async function initializeMonitorBridge() {
  if (!window.electronAPI || !checkBtn || !icon) return;

  showSpinner();
  try {
    if (typeof window.electronAPI.onConnectionStatus === 'function') {
      unsubscribeStatus = window.electronAPI.onConnectionStatus(applyStatus);
    }
    if (typeof window.electronAPI.onSessionForceLogout === 'function') {
      window.electronAPI.onSessionForceLogout((payload) => {
        const reason = payload?.reason || 'offline';
        if (shouldDebounceLogout(reason)) {
          return;
        }
        markLogoutHandled(reason);
        handleDisconnect(reason).catch((err) => {
          console.error('Falha ao tratar desconexão forçada:', err);
        });
      });
    }
    const initialStatus = await window.electronAPI.getConnectionStatus?.();
    if (initialStatus) {
      applyStatus(initialStatus);
    }
    await window.electronAPI.requestConnectionCheck?.({ forceDeep: true });
  } catch (err) {
    console.error('Falha ao inicializar monitor de conexão:', err);
    showFailure();
  }
}

if (checkBtn) {
  checkBtn.addEventListener('click', () => {
    if (!window.electronAPI || checking) return;
    showSpinner();
    window.electronAPI.requestConnectionCheck?.({ forceDeep: true }).catch((err) => {
      console.error('Falha ao solicitar verificação manual de conexão:', err);
    });
  });
}

initializeMonitorBridge();

window.stopServerCheck = () => {
  if (typeof unsubscribeStatus === 'function') {
    unsubscribeStatus();
    unsubscribeStatus = null;
  }
};

// Changelog:
// - 2024-05-17: renderer passou a consumir status via IPC do monitor centralizado no processo principal, removendo polling local.
// - 2024-06-09: adicionado debounce para session:force-logout recebido via IPC dedicado do monitor.
