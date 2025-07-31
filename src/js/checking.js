// Verificação periódica de conectividade com o backend e ao banco de dados
// Usa o botão de sincronização existente para exibir o status
const checkBtn = document.getElementById('networkCheck');
const icon = checkBtn ? checkBtn.querySelector('i') : null;
let intervalId;
let checking = false;

function showLoading() {
  if (!checkBtn || !icon) return;
  checkBtn.style.color = 'var(--color-blue)';
  icon.classList.remove('fa-check');
  icon.classList.add('fa-sync-alt', 'rotating');
}

function setStatus(connected) {
  if (!checkBtn || !icon) return;
  if (connected) {
    checkBtn.style.color = 'var(--color-green)';
    icon.classList.remove('fa-sync-alt', 'rotating');
    icon.classList.add('fa-check');
  } else {
    checkBtn.style.color = 'var(--color-red)';
    icon.classList.remove('fa-check');
    icon.classList.remove('rotating');
    icon.classList.add('fa-sync-alt');
  }
}

function handleDisconnect(reason) {
  setStatus(false);
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
  showLoading();
  try {
    const result = await window.electronAPI.checkPin();
    if (result && result.success) {
      setStatus(true);
    } else if (result && (result.reason === 'pin' || result.reason === 'offline')) {
      handleDisconnect(result.reason);
    } else {
      setStatus(false);
    }
  } catch (err) {
    setStatus(false);
  } finally {
    checking = false;
  }
}

// verifica ao iniciar e a cada 10s
verifyConnection();
if (checkBtn) checkBtn.addEventListener('click', verifyConnection);
intervalId = setInterval(verifyConnection, 10000);
window.stopServerCheck = () => clearInterval(intervalId);
