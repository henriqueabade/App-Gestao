// Lógica principal do módulo Matéria Prima
// Carrega dados e inicializa animações da tela
function initMateriaPrima() {
    // animação simples dos elementos marcados
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
    // dados de exemplo para a tabela
    const materiais = [
        { nome: 'Madeira de Carvalho', quantidade: 150, unidade: 'm²', preco: 85.0 },
        { nome: 'Parafusos Phillips 4x40', quantidade: 8, unidade: 'cx', preco: 15.9 }
    ];
    renderMateriais(materiais);
}

function renderMateriais(lista) {
    const tbody = document.getElementById('materiaPrimaTableBody');
    if (!tbody) return;
    const acoes = `
        <div class="flex items-center justify-center space-x-2">
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Excluir"></i>
        </div>`;

    lista.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'transition-colors duration-150';
        tr.style.cursor = 'pointer';
        tr.addEventListener('mouseover', () => {
            tr.style.background = 'rgba(163, 148, 167, 0.05)';
        });
        tr.addEventListener('mouseout', () => {
            tr.style.background = 'transparent';
        });
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                    <span class="text-sm text-white">${item.nome}</span>
                    <i class="fas fa-info-circle w-4 h-4 ml-2 cursor-pointer" style="color: var(--color-primary)" title="Informações detalhadas"></i>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${item.quantidade}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${item.unidade}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">R$ ${item.preco.toFixed(2).replace('.', ',')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center">${acoes}</td>
        `;
        tbody.appendChild(tr);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMateriaPrima);
} else {
    initMateriaPrima();
}
