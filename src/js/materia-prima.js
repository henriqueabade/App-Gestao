// Lógica principal do módulo Matéria Prima
let todosMateriais = [];
let notificationContainer;

function showToast(message, type = 'success') {
    if (!notificationContainer) {
        notificationContainer = document.getElementById('notification');
        if (!notificationContainer) {
            notificationContainer = document.createElement('div');
            notificationContainer.id = 'notification';
            notificationContainer.className = 'fixed top-4 right-4 space-y-2 z-[10000]';
            document.body.appendChild(notificationContainer);
        }
    }
    const div = document.createElement('div');
    div.className = `toast ${type === 'success' ? 'toast-success' : 'toast-error'}`;
    div.textContent = message;
    notificationContainer.appendChild(div);
    setTimeout(() => {
        div.classList.add('opacity-0');
        setTimeout(() => div.remove(), 500);
    }, 3000);
}

window.showToast = showToast;

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
    document.getElementById('btnNovoInsumo')?.addEventListener('click', abrirNovoInsumo);

    carregarMateriais();
}

async function carregarMateriais() {
    try {
        const lista = await window.electronAPI.listarMateriaPrima('');
        todosMateriais = lista;
        popularFiltros(lista);
        aplicarFiltros();
    } catch (err) {
        console.error('Erro ao carregar materiais', err);
    }
}

function popularFiltros(lista) {
    const procSel = document.getElementById('filtroProcesso');
    const catSel = document.getElementById('filtroCategoria');

    if (procSel) {
        const processos = [...new Set(lista.map(m => m.processo).filter(Boolean))].sort();
        procSel.innerHTML = '<option value="">Todos</option>' +
            processos.map(p => `<option value="${p}">${p}</option>`).join('');
    }

    if (catSel) {
        const categorias = [...new Set(lista.map(m => m.categoria).filter(Boolean))].sort();
        catSel.innerHTML = '<option value="">Todas</option>' +
            categorias.map(c => `<option value="${c}">${c}</option>`).join('');
    }
}

function aplicarFiltros() {
    const termo = (document.getElementById('materiaPrimaSearch')?.value || '').toLowerCase();
    const processo = document.getElementById('filtroProcesso')?.value || '';
    const categoria = document.getElementById('filtroCategoria')?.value || '';

    const filtrados = todosMateriais.filter(m => {
        const matchTermo = !termo ||
            (m.nome || '').toLowerCase().includes(termo) ||
            (m.categoria || '').toLowerCase().includes(termo) ||
            (m.processo || '').toLowerCase().includes(termo) ||
            (m.infinito ? 'infinito'.includes(termo) : false);
        const matchProc = !processo || m.processo === processo;
        const matchCat = !categoria || m.categoria === categoria;
        return matchTermo && matchProc && matchCat;
    });

    renderMateriais(filtrados);
    renderTotais(filtrados);
}

function limparFiltros() {
    const busca = document.getElementById('materiaPrimaSearch');
    const proc = document.getElementById('filtroProcesso');
    const cat = document.getElementById('filtroCategoria');
    if (busca) busca.value = '';
    if (proc) proc.value = '';
    if (cat) cat.value = '';
    aplicarFiltros();
}

function renderTotais(lista) {
    const container = document.getElementById('totaisTags');
    if (!container) return;

    const infinitos = lista.filter(m => m.infinito).length;
    const acabando = lista.filter(m => !m.infinito && Number(m.quantidade) < 10).length;
    const processos = {};
    lista.forEach(m => {
        if (m.processo) {
            processos[m.processo] = (processos[m.processo] || 0) + 1;
        }
    });

    const tags = [];
    tags.push(`<span class="badge-success px-3 py-1 rounded-full text-xs font-medium">Infinitos: ${infinitos}</span>`);
    tags.push(`<span class="badge-danger px-3 py-1 rounded-full text-xs font-medium">Acabando: ${acabando}</span>`);
    Object.keys(processos).sort().forEach(p => {
        tags.push(`<span class="badge-neutral px-3 py-1 rounded-full text-xs font-medium">${p}: ${processos[p]}</span>`);
    });

    container.innerHTML = tags.join('');
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

// Controle de popup de informações da matéria prima
let materiais = [];
let currentPopup = null;
let infoMouseEnter;
let infoMouseLeave;

function createPopupContent(item) {
    const infinitoBadge = item.infinito
        ? `<span class="badge badge-sim">✔ Sim</span>`
        : `<span class="badge badge-nao">✖ Não</span>`;

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
            <p class="popup-info-value">${item.processo || ''}</p>
          </div>
        </div>
        <div class="popup-description-section">
          <p class="popup-info-label">Descrição Técnica:</p>
          <p class="popup-description-text">${item.descricao || ''}</p>
        </div>
      </div>
    </div>`;
}

function showInfoPopup(target, item) {
    hideInfoPopup();
    const popup = document.createElement('div');
    popup.className = 'absolute z-50';
    popup.innerHTML = createPopupContent(item);
    document.body.appendChild(popup);
    const rect = target.getBoundingClientRect();
    const margin = 8;
    const popupRect = popup.getBoundingClientRect();

    let top = rect.bottom + margin;
    if (top + popupRect.height > window.innerHeight) {
        if (rect.top - margin - popupRect.height >= 0) {
            top = rect.top - popupRect.height - margin;
        } else {
            top = Math.max(margin, window.innerHeight - popupRect.height - margin);
        }
    }

    let left = rect.right + margin;
    if (left + popupRect.width > window.innerWidth) {
        if (rect.left - margin - popupRect.width >= 0) {
            left = rect.left - popupRect.width - margin;
        } else {
            left = Math.max(margin, window.innerWidth - popupRect.width - margin);
        }
    }

    popup.style.left = `${left + window.scrollX}px`;
    popup.style.top = `${top + window.scrollY}px`;
    currentPopup = popup;
}

function hideInfoPopup() {
    if (currentPopup) {
        currentPopup.remove();
        currentPopup = null;
    }
}

function attachInfoEvents() {
    const lista = document.getElementById('materiaPrimaTableBody');
    if (!lista) return;

    lista.removeEventListener('mouseover', infoMouseEnter);
    lista.removeEventListener('mouseout', infoMouseLeave);

    infoMouseEnter = e => {
        const icon = e.target.closest('.info-icon');
        if (!icon) return;
        const id = parseInt(icon.dataset.id);
        const item = materiais.find(m => m.id === id);
        if (item) showInfoPopup(icon, item);
    };

    infoMouseLeave = e => {
        if (e.target.closest('.info-icon')) hideInfoPopup();
    };

    lista.addEventListener('mouseover', infoMouseEnter);
    lista.addEventListener('mouseout', infoMouseLeave);

    if (window.feather) feather.replace();
}

function renderMateriais(listaMateriais) {
    materiais = listaMateriais;
    const tbody = document.getElementById('materiaPrimaTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const acoes = `
        <div class="flex items-center justify-center space-x-2">
            <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
            <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Excluir"></i>
        </div>`;

    materiais.forEach((item) => {
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
            <td class="px-6 py-4 whitespace-nowrap relative">
                <div class="flex items-center">
                    <span class="text-sm text-white">${item.nome}</span>
                    <i class="info-icon ml-2" data-id="${item.id}"></i>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${quantidadeValor}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${item.unidade || ''}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">R$ ${preco.toFixed(2).replace('.', ',')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center">${acoes}</td>`;
        tbody.appendChild(tr);
        const editBtn = tr.querySelector('.fa-edit');
        const delBtn = tr.querySelector('.fa-trash');
        if (editBtn) editBtn.addEventListener('click', e => { e.stopPropagation(); abrirEditarInsumo(item); });
        if (delBtn) delBtn.addEventListener('click', e => { e.stopPropagation(); abrirExcluirInsumo(item); });
    });

    attachInfoEvents();
}

function abrirNovoInsumo() {
    Modal.open('modals/materia-prima/novo.html', '../js/modals/materia-prima-novo.js', 'novoInsumo');
}

function abrirEditarInsumo(item) {
    window.materiaSelecionada = item;
    Modal.open('modals/materia-prima/editar.html', '../js/modals/materia-prima-editar.js', 'editarInsumo');
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
