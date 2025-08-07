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
        const lista = await window.electronAPI.listarMateriaPrima(filtro);
        renderMateriais(lista);
    } catch (err) {
        console.error('Erro ao carregar materiais', err);
    }
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
    });

    attachInfoEvents();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMateriaPrima);
} else {
    initMateriaPrima();
}
