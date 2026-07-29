// Verificação periódica de conectividade com o backend e ao banco de dados
// Usa o botão de sincronização existente para exibir o status
const checkBtn = document.getElementById('networkCheck');
const icon = checkBtn ? checkBtn.querySelector('i') : null;
const LOGOUT_DEBOUNCE_MS = 5000;
let checking = false;
let unsubscribeStatus = null;
let lastLogoutReason = null;
let lastLogoutHandledAt = 0;
let disconnectHandled = false;

function resetIcon() {
  if (!icon) return;
  icon.classList.remove('fa-sync-alt', 'fa-check', 'fa-times', 'rotating');
}

function showSpinner(color = 'var(--color-blue)') {
  if (!checkBtn || !icon) return;
  resetIcon();
  checkBtn.style.color = color;
  icon.classList.add('fa-sync-alt', 'rotating');
}

function showSuccess() {
  if (!checkBtn || !icon) return;
  resetIcon();
  icon.classList.add('fa-check');
  checkBtn.style.color = 'var(--color-green)';
}

let pulsoTimer = null;
const PULSO_RESULTADO_MS = 1000;

/**
 * O estado normal do indicador é GIRANDO. A cada verificação mostramos o
 * resultado (check verde ou X vermelho) por 1s e voltamos a girar — assim o
 * usuário vê que a checagem aconteceu, em vez de um ícone sempre igual.
 */
function pulsarResultado(sucesso, cor) {
  if (!checkBtn || !icon) return;
  if (pulsoTimer) clearTimeout(pulsoTimer);
  if (sucesso) showSuccess();
  else showFailure(cor || 'var(--color-red)');
  pulsoTimer = setTimeout(() => {
    pulsoTimer = null;
    // Girando é SEMPRE azul. Verde pertence só ao check e vermelho só ao X —
    // um giro colorido confundia o estado de repouso com o resultado.
    showSpinner();
  }, PULSO_RESULTADO_MS);
}

function showFailure(color = 'var(--color-red)') {
  if (!checkBtn || !icon) return;
  resetIcon();
  icon.classList.add('fa-times');
  checkBtn.style.color = color;
}

async function handleDisconnect(reason) {
  disconnectHandled = true;
  // Cancela um pulso em andamento: aqui o X precisa FICAR, não voltar a girar.
  if (pulsoTimer) {
    clearTimeout(pulsoTimer);
    pulsoTimer = null;
  }
  const failureColor = reason === 'offline-db' ? 'var(--color-orange)' : 'var(--color-red)';
  showFailure(failureColor);
  if (window.stopServerCheck) window.stopServerCheck();
  if (reason === 'pin' || reason === 'offline-db') {
    localStorage.setItem('pinChanged', '1');
  } else if (reason === 'offline') {
    localStorage.setItem('offlineDisconnect', '1');
  } else if (reason === 'user-removed') {
    localStorage.setItem('userRemoved', '1');
  } else if (reason === 'admin-disabled' || reason === 'admin-pending') {
    localStorage.setItem('adminDisabled', reason === 'admin-pending' ? 'pending' : '1');
  }

  // O estado precisa ser coletado ANTES de limpar o localStorage: collectState()
  // carimba `storage.user` para o login saber de quem é o trabalho guardado.
  // Limpando primeiro, o carimbo saía nulo e o loginRenderer descartava tudo —
  // era por isso que nada era restaurado.
  let estadoTrabalho = null;
  if (typeof window.collectState === 'function') {
    try {
      estadoTrabalho = window.collectState();
    } catch (err) {
      console.error('Falha ao coletar o trabalho em andamento', err);
    }
  }

  // E o salvamento precisa ser AGUARDADO: logo abaixo a janela é fechada, e um
  // invoke não aguardado podia morrer junto com ela sem gravar o arquivo.
  if (estadoTrabalho && window.electronAPI?.saveState) {
    try {
      await window.electronAPI.saveState(estadoTrabalho);
    } catch (err) {
      console.error('Falha ao salvar o trabalho em andamento', err);
    }
  }

  try {
    localStorage.removeItem('user');
    localStorage.removeItem('rememberUser');
  } catch (storageErr) {
    console.error('Failed to clear remembered credentials after disconnect', storageErr);
  }
  if (window.electronAPI) {
    try {
      // Prepara a janela de login ESCONDIDA e deixa o `logout` fazer a troca
      // por inteiro (esconde o dashboard, revela o login, fecha o dashboard).
      // Chamar `showLogin()` aqui exibia o login com o dashboard ainda na
      // frente — as duas telas apareciam juntas.
      await window.electronAPI.openLoginHidden();
      await window.electronAPI.logout();
    } catch (err) {
      console.error('Failed to return to login after disconnect', err);
    }
  }
}

function applyStatus(status) {
  if (!status || !checkBtn || !icon) return;
  const rawState = status.state || 'checking';
  const reason = status.reason;
  const shouldLogout = Boolean(status.shouldLogout);
  const state = rawState === 'db-offline' ? 'offline-db' : rawState;

  if (!shouldLogout) {
    disconnectHandled = false;
  }

  const titles = {
    online: 'Conectado ao servidor',
    checking: 'Verificando conectividade...',
    offline: 'Sem conexão com a Internet ou servidor',
    'offline-db': 'Banco de dados indisponível',
    waiting: 'Monitor em espera (janela inativa)'
  };
  let title = titles[state] || 'Monitorando conexão';
  if (state === 'offline' && reason === 'pin') {
    title = 'PIN inválido ou alterado';
  } else if (state === 'offline' && reason === 'user-removed') {
    title = 'Usuário removido do sistema';
  } else if (reason === 'admin-disabled') {
    title = 'Acesso desativado pelo administrador';
  } else if (reason === 'admin-pending') {
    title = 'Acesso ainda não liberado pelo administrador';
  }
  checkBtn.setAttribute('title', title);

  if (state === 'online') {
    checking = false;
    pulsarResultado(true);
  } else if (state === 'checking') {
    checking = true;
    if (!pulsoTimer) showSpinner();          // não corta o pulso em andamento
  } else if (state === 'waiting') {
    checking = false;
    if (!pulsoTimer) showSpinner('var(--color-blue)');
  } else if (state === 'offline-db') {
    checking = false;
    pulsarResultado(false, 'var(--color-orange)');
  } else {
    checking = false;
    pulsarResultado(false, 'var(--color-red)');
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
