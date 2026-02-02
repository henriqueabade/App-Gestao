// Script principal do módulo de Contatos
// Responsável por carregar e filtrar contatos vinculados aos clientes

function updateEmptyStateContatos(hasData) {
    const wrapper = document.getElementById('contatosTableWrapper');
    const empty = document.getElementById('contatosEmptyState');
    if (!wrapper || !empty) return;
    if (hasData) {
        wrapper.classList.remove('hidden');
        empty.classList.add('hidden');
    } else {
        wrapper.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

function aplicarFiltroContatos() {
    const termo = document.querySelector('input[placeholder="Nome / Empresa"]')?.value.toLowerCase() || '';
    const tipos = Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.nextElementSibling?.textContent.trim());
    let visible = 0;
    document.querySelectorAll('#contatosTableWrapper tbody tr').forEach(row => {
        const nome = row.cells[0]?.innerText.toLowerCase() || '';
        const empresa = row.cells[2]?.innerText.toLowerCase() || '';
        const tipo = row.cells[1]?.innerText.trim();
        const matchTermo = !termo || nome.includes(termo) || empresa.includes(termo);
        const matchTipo = tipos.length === 0 || tipos.includes(tipo);
        const show = matchTermo && matchTipo;
        row.style.display = show ? '' : 'none';
        if (show) visible++;
    });
    updateEmptyStateContatos(visible > 0);
}

function showFunctionUnavailableDialog(message) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.style.zIndex = 'var(--z-dialog)';
    overlay.innerHTML = `<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
            <h3 class="text-lg font-semibold mb-4 text-yellow-400">Função Indisponível</h3>
            <p class="text-sm text-gray-300 mb-6">${message}</p>
            <div class="flex justify-center">
                <button id="funcUnavailableOk" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">OK</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#funcUnavailableOk').addEventListener('click', () => overlay.remove());
}

function initContatos() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', aplicarFiltroContatos);
    });

    const searchInput = document.querySelector('input[placeholder="Nome / Empresa"]');
    searchInput?.addEventListener('input', aplicarFiltroContatos);

    document.getElementById('btnNovoContato')?.addEventListener('click', () => {
        console.log('Criar novo contato');
    });
    document.getElementById('contatosEmptyNew')?.addEventListener('click', () => {
        document.getElementById('btnNovoContato')?.click();
    });

    document.querySelectorAll('.fa-edit').forEach(icon => {
        icon.addEventListener('click', () => {
            console.log('Editar contato');
        });
    });

    ['exportar-csv','importar-csv','gerar-relatorio','enviar-email-massa','filtrar','limpar'].forEach(action => {
        document.querySelector(`[data-action="${action}"]`)?.addEventListener('click', () => {
            showFunctionUnavailableDialog('Função em desenvolvimento');
        });
    });

    aplicarFiltroContatos();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContatos);
} else {
    initContatos();
}
