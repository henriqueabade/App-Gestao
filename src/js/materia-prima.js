// Lógica principal do módulo Matéria Prima
// Carrega dados e inicializa animações da tela
function initMateriaPrima() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
    carregarMateriais();
}

async function carregarMateriais(filtro = '') {
    try {
        const materiais = await window.electronAPI.listarMateriaPrima(filtro);
        renderMateriais(materiais);
    } catch (err) {
        console.error('Erro ao carregar materiais', err);
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function renderMateriais(lista) {
    const tbody = document.getElementById('materiaPrimaTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const acoes = `
        <div class="flex items-center justify-center space-x-2">
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Excluir"></i>
        </div>`;

    lista.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.className = 'transition-colors duration-150';
        tr.style.cursor = 'pointer';
        tr.addEventListener('mouseover', () => {
            tr.style.background = 'rgba(163, 148, 167, 0.05)';
        });
        tr.addEventListener('mouseout', () => {
            tr.style.background = 'transparent';
        });
        const preco = Number(item.preco_unitario || 0);
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap relative">
                <div class="flex items-center">
                    <span class="text-sm text-white">${item.nome}</span>
                    <i id="infoIcon_${index}" class="info-icon ml-2"></i>
                </div>
                <div id="popover_${index}" class="resumo-popover glass-surface rounded-xl p-4 text-sm text-white">
                    <h3 class="font-medium mb-2">${item.nome}</h3>
                    <p class="text-xs text-gray-400 mb-1">Categoria:</p>
                    <p class="text-base font-semibold mb-2 text-white">${item.categoria || '-'}</p>
                    <div class="text-xs text-gray-400 mb-1">Quantidade</div>
                    <div class="mb-2">${item.quantidade} ${item.unidade}</div>
                    <div class="text-xs text-gray-400 mb-1">Preço Unitário</div>
                    <div class="mb-4">R$ ${preco.toFixed(2).replace('.', ',')}</div>
                    <div class="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-gray-200">
                        <div>
                            <span class="text-xs">Data de Entrada:</span><br>
                            <span class="font-medium">${formatDate(item.data_estoque)}</span>
                        </div>
                        <div>
                            <span class="text-xs">Última Atualização:</span><br>
                            <span class="font-medium">${formatDate(item.data_preco)}</span>
                        </div>
                        <div class="col-span-1">
                            <span class="text-xs">Estoque Infinito:</span><br>
                            ${item.infinito ? '<span class="badge-success">✓ Sim</span>' : '<span class="badge-danger">✕ Não</span>'}
                        </div>
                        <div class="col-span-1">
                            <span class="text-xs">Processo Atual:</span><br>
                            <span class="font-medium">${item.processo || '-'}</span>
                        </div>
                    </div>
                    <hr class="border-white/10 my-4">
                    <p class="text-xs text-gray-400 mb-1">Descrição Técnica:</p>
                    <p class="text-gray-200">${item.descricao || '-'}</p>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${item.quantidade}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${item.unidade}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">R$ ${preco.toFixed(2).replace('.', ',')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center">${acoes}</td>`;
        tbody.appendChild(tr);

        const infoIcon = tr.querySelector(`#infoIcon_${index}`);
        const popover = tr.querySelector(`#popover_${index}`);
        if (infoIcon && popover) {
            const mostrarPopover = () => {
                const iconRect = infoIcon.getBoundingClientRect();
                const popRect = popover.getBoundingClientRect();

                let top = iconRect.bottom + 8;
                let left = iconRect.left + iconRect.width / 2 - popRect.width / 2;

                if (top + popRect.height > window.innerHeight) {
                    top = iconRect.top - popRect.height - 8;
                    if (top < 0) {
                        top = window.innerHeight / 2 - popRect.height / 2;
                    }
                }

                if (left + popRect.width > window.innerWidth) {
                    left = window.innerWidth - popRect.width - 8;
                }
                if (left < 8) left = 8;

                popover.style.left = `${left}px`;
                popover.style.top = `${top}px`;
                popover.classList.add('show');
            };

            const ocultarPopover = () => {
                popover.classList.remove('show');
            };

            infoIcon.addEventListener('mouseenter', mostrarPopover);
            infoIcon.addEventListener('mouseleave', () => {
                setTimeout(() => {
                    if (!popover.matches(':hover')) ocultarPopover();
                }, 100);
            });
            popover.addEventListener('mouseleave', ocultarPopover);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMateriaPrima);
} else {
    initMateriaPrima();
}
