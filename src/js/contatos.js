// Script principal do módulo de Contatos
// Responsável por carregar e filtrar contatos vinculados aos clientes

function initContatos() {
    // Animação de entrada para elementos marcados
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    // Eventos de filtro por tipo
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            console.log(`Filtro ${cb.nextElementSibling?.textContent}: ${cb.checked}`);
        });
    });

    // Busca por nome ou empresa
    const searchInput = document.querySelector('input[placeholder="Nome / Empresa"]');
    searchInput?.addEventListener('input', e => {
        console.log('Busca:', e.target.value);
    });

    // Abrir detalhes do contato ao clicar no ícone de edição
    document.querySelectorAll('.fa-edit').forEach(icon => {
        icon.addEventListener('click', () => {
            const id = icon.dataset.id;
            if(id) abrirDetalhesContato({ id });
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContatos);
} else {
    initContatos();
}

function openModalWithSpinner(htmlPath, scriptPath, overlayId) {
    Modal.closeAll();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center';
    spinner.innerHTML = '<div class="w-16 h-16 border-4 border-[#b6a03e] border-t-transparent rounded-full animate-spin"></div>';
    document.body.appendChild(spinner);
    const start = Date.now();
    function handleLoaded(e) {
        if (e.detail !== overlayId) return;
        const overlay = document.getElementById(`${overlayId}Overlay`);
        const elapsed = Date.now() - start;
        const show = () => {
            spinner.remove();
            overlay.classList.remove('hidden');
        };
        if (elapsed < 3000) {
            setTimeout(show, Math.max(0, 2000 - elapsed));
        } else {
            show();
        }
        window.removeEventListener('modalSpinnerLoaded', handleLoaded);
    }
    window.addEventListener('modalSpinnerLoaded', handleLoaded);
    Modal.open(htmlPath, scriptPath, overlayId, true);
}

function abrirDetalhesContato(contato){
    window.contatoDetalhes = contato;
    openModalWithSpinner('modals/contatos/detalhes.html', '../js/modals/contato-detalhes.js', 'detalhesContato');
}

function abrirEditarContato(contato){
    window.contatoEditar = contato;
    openModalWithSpinner('modals/contatos/editar.html', '../js/modals/contato-editar.js', 'editarContato');
}

window.abrirEditarContato = abrirEditarContato;
