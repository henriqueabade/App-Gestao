// Verificação periódica de conectividade com o backend
// Usa o botão de sincronização existente para exibir o status
const checkBtn = document.getElementById('networkCheck');
const icon = checkBtn ? checkBtn.querySelector('i') : null;

async function verifyConnection() {
    if (!checkBtn || !icon) return;
    if (!navigator.onLine) {
        checkBtn.style.color = 'var(--color-red)';
        icon.classList.remove('rotating');
        return;
    }
    try {
        const res = await window.electronAPI.checkPin();
        if (res && res.success) {
            checkBtn.style.color = 'var(--color-green)';
            if (!icon.classList.contains('rotating')) icon.classList.add('rotating');
        } else {
            checkBtn.style.color = 'var(--color-red)';
            icon.classList.remove('rotating');
        }
    } catch (err) {
        checkBtn.style.color = 'var(--color-red)';
        icon.classList.remove('rotating');
    }
}

verifyConnection();
if (checkBtn) checkBtn.addEventListener('click', verifyConnection);
setInterval(verifyConnection, 10000);
