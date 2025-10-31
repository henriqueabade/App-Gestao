(function () {
  const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
  const IDLE_EVENTS = [
    'mousemove',
    'mousedown',
    'keydown',
    'touchstart',
    'wheel',
    'scroll',
    'focus',
  ];

  let timerId = null;
  let tracking = false;

  function clearInactivityTimer() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function resetInactivityTimer() {
    if (!tracking) return;
    clearInactivityTimer();
    timerId = setTimeout(handleInactivityTimeout, INACTIVITY_LIMIT_MS);
  }

  async function performIdleLogout() {
    tracking = false;
    clearInactivityTimer();
    detachIdleListeners();

    try {
      window.stopServerCheck?.();
    } catch (err) {
      console.warn('Falha ao interromper verificação de rede ao encerrar sessão inativa.', err);
    }

    try {
      window.__notificationsInternals?.shutdown?.();
    } catch (err) {
      console.warn('Falha ao encerrar notificações ao encerrar sessão inativa.', err);
    }

    try {
      window.__updatesInternals?.shutdown?.();
    } catch (err) {
      console.warn('Falha ao encerrar verificações de atualização ao encerrar sessão inativa.', err);
    }

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('app-session-logout', { detail: { reason: 'idle-timeout' } }));
      } catch (err) {
        // ignora erros ao propagar evento
      }
    }

    try {
      window.showToast?.('Você foi desconectado por inatividade.', 'info');
    } catch (err) {
      console.warn('Não foi possível exibir aviso de inatividade.', err);
    }

    if (window.collectState && window.electronAPI?.saveState) {
      try {
        const state = window.collectState();
        await window.electronAPI.saveState(state);
      } catch (err) {
        console.warn('Falha ao salvar estado antes do logout por inatividade.', err);
      }
    }

    if (window.electronAPI) {
      try {
        await window.electronAPI.openLoginHidden?.();
        await window.electronAPI.showLogin?.();
        await window.electronAPI.logout?.();
      } catch (err) {
        console.error('Falha ao processar logout por inatividade.', err);
      }
    }
  }

  function handleInactivityTimeout() {
    performIdleLogout();
  }

  function attachIdleListeners() {
    if (tracking) return;
    tracking = true;
    IDLE_EVENTS.forEach((event) => {
      window.addEventListener(event, resetInactivityTimer, { passive: true });
    });
    document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });
    resetInactivityTimer();
  }

  function detachIdleListeners() {
    IDLE_EVENTS.forEach((event) => {
      window.removeEventListener(event, resetInactivityTimer, { passive: true });
    });
    document.removeEventListener('visibilitychange', handleVisibilityChange, { passive: true });
  }

  function handleVisibilityChange() {
    if (!tracking) return;
    if (!document.hidden) {
      resetInactivityTimer();
    }
  }

  window.__sessionInternals = window.__sessionInternals || {};
  Object.assign(window.__sessionInternals, {
    reset: resetInactivityTimer,
    forceTimeout: handleInactivityTimeout,
    stop: () => {
      tracking = false;
      clearInactivityTimer();
      detachIdleListeners();
    },
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (tracking) return;
    attachIdleListeners();
  });
})();
