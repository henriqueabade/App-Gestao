// Verificação periódica de conectividade com o backend e ao banco de dados
// Usa o botão de sincronização existente para exibir o status
const checkBtn = document.getElementById('networkCheck');
const icon = checkBtn ? checkBtn.querySelector('i') : null;
let intervalId;
let checking = false;

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
    if (!checking) {
      showSpinner();
    }
  }, 1000);
}

function showFailure() {
  showSpinner('var(--color-red)');
}

function handleDisconnect(reason) {
  showFailure();
  if (window.stopServerCheck) window.stopServerCheck();
  if (reason === 'pin') {
    localStorage.setItem('pinChanged', '1');
  } else if (reason === 'offline') {
    localStorage.setItem('offlineDisconnect', '1');
  }
  if (window.collectState && window.electronAPI && window.electronAPI.saveState) {
    window.electronAPI.saveState(window.collectState());
  }
  if (window.electronAPI) {
    window.electronAPI.openLoginHidden();
    window.electronAPI.logout();
  }
}

async function verifyConnection() {
  if (checking || !checkBtn || !icon) return;
  checking = true;
  showSpinner();
  try {
    const result = await window.electronAPI.checkPin();
    if (result && result.success) {
      showSuccess();
    } else if (result && (result.reason === 'pin' || result.reason === 'offline')) {
      handleDisconnect(result.reason);
    } else {
      showFailure();
    }
  } catch (err) {
    showFailure();
  } finally {
    checking = false;
  }
}

// verifica ao iniciar e a cada 10s
verifyConnection();
if (checkBtn) checkBtn.addEventListener('click', verifyConnection);
intervalId = setInterval(verifyConnection, 10000);
window.stopServerCheck = () => clearInterval(intervalId);
