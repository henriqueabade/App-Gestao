// Lógica principal do módulo Matéria Prima
let todosMateriais = [];

function updateEmptyStateMateriaPrima(hasData) {
    const wrapper = document.getElementById('materiaPrimaTableWrapper');
    const empty = document.getElementById('materiaPrimaEmptyState');
    if (!wrapper || !empty) return;
    if (hasData) {
        wrapper.classList.remove('hidden');
        empty.classList.add('hidden');
    } else {
        wrapper.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

// Inicializa animações e eventos
function initMateriaPrima() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    document.getElementById('materiaPrimaSearch')?.addEventListener('input', aplicarFiltros);
    document.getElementById('filtroProcesso')?.addEventListener('change', aplicarFiltros);
    document.getElementById('filtroCategoria')?.addEventListener('change', aplicarFiltros);
    document.getElementById('btnFiltrar')?.addEventListener('click', aplicarFiltros);
    document.getElementById('btnLimpar')?.addEventListener('click', limparFiltros);
    document.getElementById('zeroStock')?.addEventListener('change', aplicarFiltros);

    const novoBtn = document.getElementById('btnNovoInsumo');
    novoBtn?.addEventListener('click', event => {
        event.stopPropagation();
        abrirNovoInsumo();
    });

    document.getElementById('materiaPrimaEmptyNew')?.addEventListener('click', event => {
        event.stopPropagation();
        abrirNovoInsumo();
    });

    const infoIcon = document.getElementById('totaisInfoIcon');
    const popover = document.getElementById('totaisPopover');
    if (infoIcon && popover) {
        const mostrar = () => {
            popover.classList.add('show');
            const rect = infoIcon.getBoundingClientRect();
            const popRect = popover.getBoundingClientRect();
            popover.style.left = `${rect.left + rect.width / 2 - popRect.width / 2}px`;
            popover.style.top = `${rect.top - popRect.height - 4}px`;
        };
        const ocultar = () => popover.classList.remove('show');
        infoIcon.addEventListener('mouseenter', mostrar);
        infoIcon.addEventListener('mouseleave', () => {
            setTimeout(() => {
                if (!popover.matches(':hover')) ocultar();
            }, 100);
        });
        popover.addEventListener('mouseleave', ocultar);
    }

    requestAnimationFrame(() => requestAnimationFrame(carregarMateriais));
}

async function carregarMateriais() {
    try {
        const lista = await (window.electronAPI?.listarMateriaPrima?.('') ?? []);
        todosMateriais = lista;
        await popularFiltros(lista);
        aplicarFiltros();
    } catch (err) {
        console.error('Erro ao carregar materiais', err);
    }
}

window.carregarMateriais = carregarMateriais;

async function popularFiltros(lista) {
    const procSel = document.getElementById('filtroProcesso');
    const catSel = document.getElementById('filtroCategoria');

    if (procSel) {
        const processos = [...new Set(lista.map(m => m.processo).filter(Boolean))].sort();
        procSel.innerHTML = '<option value="">Todos</option>' +
            processos.map(p => `<option value="${p}">${p}</option>`).join('');
    }

    if (catSel) {
        let categorias = [];
        try {
            categorias = await (window.electronAPI?.listarCategorias?.() ?? []);
        } catch (e) {
            console.error('Erro ao carregar categorias', e);
        }
        catSel.innerHTML = '<option value="">Todas</option>' +
            categorias.map(c => `<option value="${c}">${c}</option>`).join('');
    }
}

function aplicarFiltros() {
    const termo = (document.getElementById('materiaPrimaSearch')?.value || '').toLowerCase();
    const processo = document.getElementById('filtroProcesso')?.value || '';
    const categoria = document.getElementById('filtroCategoria')?.value || '';
    const zeroEstoque = document.getElementById('zeroStock')?.checked;

    let filtrados = todosMateriais.filter(m => {
        const isCritical = !m.infinito && Number(m.quantidade) < 10;
        const matchTermo = !termo ||
            (m.nome || '').toLowerCase().includes(termo) ||
            (m.categoria || '').toLowerCase().includes(termo) ||
            (m.processo || '').toLowerCase().includes(termo) ||
            (m.infinito ? 'infinito'.includes(termo) : false) ||
            (isCritical && ['acabando', 'critico', 'crítico'].some(k => k.includes(termo)));
        const matchProc = !processo || m.processo === processo;
        const matchCat = !categoria || m.categoria === categoria;
        return matchTermo && matchProc && matchCat;
    });

    if (zeroEstoque) {
        filtrados = filtrados.filter(m => !m.infinito && Number(m.quantidade) === 0);
    }

    renderMateriais(filtrados);
    renderTotais(filtrados);
    updateEmptyStateMateriaPrima(filtrados.length > 0);
}

function limparFiltros() {
    const busca = document.getElementById('materiaPrimaSearch');
    const proc = document.getElementById('filtroProcesso');
    const cat = document.getElementById('filtroCategoria');
    const zero = document.getElementById('zeroStock');
    if (busca) busca.value = '';
    if (proc) proc.value = '';
    if (cat) cat.value = '';
    if (zero) zero.checked = false;
    aplicarFiltros();
}

function renderTotais(lista) {
    const container = document.getElementById('totaisTags');
    if (!container) return;

    const infinitos = lista.filter(m => m.infinito).length;
    const acabando = lista.filter(m => !m.infinito && Number(m.quantidade) < 10).length;

    const processos = { 'Acabamento': 0, 'Embalagem': 0, 'Marcenaria': 0, 'Montagem': 0 };
    lista.forEach(m => {
        const p = (m.processo || '').toLowerCase();
        if (p === 'acabamento') processos.Acabamento++;
        if (p === 'embalagem') processos.Embalagem++;
        if (p === 'marcenaria') processos.Marcenaria++;
        if (p === 'montagem') processos.Montagem++;
    });

    container.innerHTML = `
        <span class="badge-success px-3 py-1 rounded-full text-xs font-medium">Infinitos: ${infinitos}</span>
        <span class="badge-danger px-3 py-1 rounded-full text-xs font-medium">Acabando: ${acabando}</span>`;

    updateProcessPopover(processos);
}

function getProcessBadgeClass(proc) {
    switch ((proc || '').toLowerCase()) {
        case 'acabamento': return 'badge-acabamento';
        case 'embalagem': return 'badge-embalagem';
        case 'marcenaria': return 'badge-marcenaria';
        case 'montagem': return 'badge-montagem';
        default: return 'badge-neutral';
    }
}

function updateProcessPopover(processos) {
    const container = document.getElementById('processTags');
    if (!container) return;
    container.innerHTML = Object.entries(processos)
        .map(([proc, qtd]) => `<span class="badge ${getProcessBadgeClass(proc)}">${proc}: ${qtd}</span>`)
        .join('');
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

// Controle de popup de informações da matéria prima
let materiais = [];
// Mapa auxiliar para lookup rápido pelo id
let materiaisMap = new Map();
let currentRawMaterialPopup = null;

function createPopupContent(item) {
    const infinitoBadge = item.infinito
        ? `<span class="badge badge-sim">✔ Sim</span>`
        : `<span class="badge badge-nao">✖ Não</span>`;

    const processoBadge = item.processo
        ? `<span class="badge ${getProcessBadgeClass(item.processo)}">${item.processo}</span>`
        : '<span class="popup-info-value">-</span>';

    return `
    <div class="popup-card">
      <div class="popup-header">
        <p class="popup-header-subtitle">Categoria:</p>
        <h3 class="popup-header-title">${item.categoria || ''}</h3>
      </div>
      <div class="popup-body">
        <div class="popup-info-grid">
          <div>
            <p class="popup-info-label">Data de Entrada:</p>
            <p class="popup-info-value">${formatDate(item.data_estoque)}</p>
          </div>
          <div>
            <p class="popup-info-label">Última Atualização:</p>
            <p class="popup-info-value">${formatDate(item.data_preco)}</p>
          </div>
        </div>
        <div class="popup-info-grid">
          <div>
            <p class="popup-info-label">Estoque Infinito:</p>
            ${infinitoBadge}
          </div>
          <div>
            <p class="popup-info-label">Processo Atual:</p>
            ${processoBadge}
          </div>
        </div>
        <div class="popup-description-section">
          <p class="popup-info-label">Descrição Técnica:</p>
          <p class="popup-description-text">${item.descricao || ''}</p>
        </div>
      </div>
    </div>`;
}

function showRawMaterialInfoPopup(target, item) {
    hideRawMaterialInfoPopup();
    const { popup, left, top } = createPopup(target, createPopupContent(item), { onHide: hideRawMaterialInfoPopup });
    window.electronAPI?.log?.(`showRawMaterialInfoPopup left=${left} top=${top} id=${item.id}`);
    currentRawMaterialPopup = popup;
}

function hideRawMaterialInfoPopup() {
    if (currentRawMaterialPopup) {
        currentRawMaterialPopup.remove();
        currentRawMaterialPopup = null;
    }
    window.electronAPI?.log?.('hideRawMaterialInfoPopup');
}

window.showRawMaterialInfoPopup = showRawMaterialInfoPopup;
window.hideRawMaterialInfoPopup = hideRawMaterialInfoPopup;
window.attachRawMaterialInfoEvents = attachRawMaterialInfoEvents;

function attachRawMaterialInfoEvents() {
    const tbody = document.getElementById('materiaPrimaTableBody');
    if (!tbody) return;

    tbody.querySelectorAll('.info-icon').forEach(bindRawMaterialInfoIcon);
}


function bindRawMaterialInfoIcon(icon) {
    if (!icon || icon.dataset.bound) return;
    icon.dataset.bound = 'true';
    icon.addEventListener('mouseenter', () => {
        const id = icon.dataset.id;
        if (!id) {
            window.electronAPI?.log?.('bindRawMaterialInfoIcon invalid id');
            return;
        }
        const item = materiaisMap.get(id) || materiais.find(m => String(m.id) === id);
        if (item) showRawMaterialInfoPopup(icon, item);
    });

    icon.addEventListener('mouseleave', () => {
        setTimeout(() => {
            if (!currentRawMaterialPopup?.matches(':hover')) hideRawMaterialInfoPopup();
        }, 100);
    });
}

function createMateriaPrimaRow(item) {
    const tr = document.createElement('tr');
    tr.className = 'transition-colors duration-150';
    tr.style.cursor = 'pointer';

    const isInfinite = !!item.infinito;
    const quantidadeValor = isInfinite ? '∞' : (item.quantidade ?? 0);
    const quantidadeNumero = Number(item.quantidade);

    let baseColor = 'transparent';
    if (isInfinite) {
        baseColor = 'rgba(162, 255, 166, 0.1)';
        tr.style.borderLeft = `4px solid var(--color-green)`;
    } else if (!isNaN(quantidadeNumero) && quantidadeNumero < 10) {
        baseColor = 'rgba(255, 88, 88, 0.1)';
        tr.style.borderLeft = `4px solid var(--color-red)`;
    }
    tr.style.background = baseColor;

    tr.addEventListener('mouseover', () => {
        if (isInfinite) {
            tr.style.background = 'rgba(162, 255, 166, 0.15)';
        } else if (!isNaN(quantidadeNumero) && quantidadeNumero < 10) {
            tr.style.background = 'rgba(255, 88, 88, 0.15)';
        } else {
            tr.style.background = 'rgba(163, 148, 167, 0.05)';
        }
    });
    tr.addEventListener('mouseout', () => {
        tr.style.background = baseColor;
    });

    const preco = Number(item.preco_unitario || 0);
    tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap relative text-base text-white">
            <div class="flex items-center">
                <span class="font-medium">${item.nome}</span>
                <i class="info-icon ml-2" data-id="${item.id}"></i>
            </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-base text-white">${quantidadeValor}</td>
        <td class="px-6 py-4 whitespace-nowrap text-base" style="color: var(--color-violet)">${item.unidade || ''}</td>
        <td class="px-6 py-4 whitespace-nowrap text-base text-white">R$ ${preco.toFixed(2).replace('.', ',')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-base text-left">
            <div class="flex items-center justify-start space-x-2">
                <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
                <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Excluir"></i>
            </div>
        </td>`;

    const infoIcon = tr.querySelector('.info-icon');
    if (infoIcon) {
        infoIcon.dataset.id = String(item.id);
        bindRawMaterialInfoIcon(infoIcon);
    }

    const editBtn = tr.querySelector('.fa-edit');
    const delBtn = tr.querySelector('.fa-trash');
    if (editBtn) editBtn.addEventListener('click', e => { e.stopPropagation(); abrirEditarInsumo(item); });
    if (delBtn) delBtn.addEventListener('click', e => { e.stopPropagation(); abrirExcluirInsumo(item); });

    return tr;
}

function renderMateriais(listaMateriais) {
    materiais = listaMateriais;
    materiaisMap = new Map(listaMateriais.map(m => [String(m.id), m]));
    const tbody = document.getElementById('materiaPrimaTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const chunkSize = 50;
    let index = 0;

    const renderChunk = () => {
        const fragment = document.createDocumentFragment();
        const end = Math.min(index + chunkSize, materiais.length);
        for (; index < end; index++) {
            fragment.appendChild(createMateriaPrimaRow(materiais[index]));
        }
        tbody.appendChild(fragment);
        if (index < materiais.length) {
            requestAnimationFrame(renderChunk);
        } else {
            if (window.feather) feather.replace();
        }
    };

    requestAnimationFrame(renderChunk);
}

function openModalWithSpinner(htmlPath, scriptPath, overlayId) {
    Modal.closeAll();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    spinner.style.zIndex = 'var(--z-dialog)';
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

function abrirNovoInsumo() {
    Modal.open('modals/materia-prima/novo.html', '../js/modals/materia-prima-novo.js', 'novoInsumo');
}

function abrirEditarInsumo(item) {
    window.materiaSelecionada = item;
    openModalWithSpinner('modals/materia-prima/editar.html', '../js/modals/materia-prima-editar.js', 'editarInsumo');
}

function abrirExcluirInsumo(item) {
    window.materiaExcluir = item;
    Modal.open('modals/materia-prima/excluir.html', '../js/modals/materia-prima-excluir.js', 'excluirInsumo');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMateriaPrima);
} else {
    initMateriaPrima();
}
