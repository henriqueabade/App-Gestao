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

    // Ação de edição (placeholder)
    document.querySelectorAll('.fa-edit').forEach(icon => {
        icon.addEventListener('click', () => {
            console.log('Editar contato');
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContatos);
} else {
    initContatos();
}
