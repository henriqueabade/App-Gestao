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

    aplicarFiltroContatos();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContatos);
} else {
    initContatos();
}
