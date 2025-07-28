// Verificação periódica de conectividade com o backend
// Usa o botão de sincronização existente para exibir o status
const checkBtn = document.getElementById('networkCheck');
const icon = checkBtn ? checkBtn.querySelector('i') : null;
let checkTimeout;

/**
 * Consulta o endpoint /status para verificar se o servidor responde.
 * Altera a cor do ícone conforme o resultado.
 */
async function verifyConnection() {
    if (!checkBtn || !icon) return;
    if (!navigator.onLine) {
        checkBtn.style.color = 'var(--color-red)';
        icon.classList.remove('rotating');
        icon.classList.remove('fa-check');
        icon.classList.add('fa-sync-alt');
        return;
    }
    try {
        const resp = await fetch('http://localhost:3000/status', { cache: 'no-store' });
        if (resp.ok) {
            checkBtn.style.color = 'var(--color-green)';
            icon.classList.remove('rotating');
            icon.classList.remove('fa-sync-alt');
            icon.classList.add('fa-check');
            clearTimeout(checkTimeout);
            checkTimeout = setTimeout(() => {
                icon.classList.remove('fa-check');
                icon.classList.add('fa-sync-alt', 'rotating');
            }, 2000);
        } else {
            throw new Error('Status não OK');
        }
    } catch (err) {
        checkBtn.style.color = 'var(--color-red)';
        icon.classList.remove('fa-check');
        icon.classList.remove('rotating');
        icon.classList.add('fa-sync-alt');
    }
}

// verifica ao iniciar e a cada 10s
verifyConnection();
if (checkBtn) checkBtn.addEventListener('click', verifyConnection);
setInterval(verifyConnection, 10000);
