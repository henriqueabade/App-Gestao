// Script principal do módulo de Produtos
// Responsável por carregar os dados e controlar filtros e ações de estoque.

let listaProdutos = [];
let notificationContainer;
let filtrosAplicados = {
    categoria: '',
    status: '',
    precoMin: '',
    precoMax: '',
    zeroEstoque: false
};
let filtrosPendentes = false;

// Controle de popup de informações do produto
let produtosRenderizados = [];
let currentPopup = null;
let infoMouseEnter;
let infoMouseLeave;

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

window.showToast = window.showToast || showToast;

async function carregarProdutos() {
    try {
        listaProdutos = await window.electronAPI.listarProdutos();
        popularFiltros();
        aplicarFiltro(true);
    } catch (err) {
        console.error('Erro ao carregar produtos', err);
        showToast('Erro ao carregar produtos', 'error');
    }
}

function renderProdutos(produtos) {
    const tbody = document.getElementById('produtosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    produtosRenderizados = produtos;

    produtos.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'transition-colors duration-150';
        tr.style.cursor = 'pointer';
        tr.onmouseover = () => tr.style.background = 'rgba(163, 148, 167, 0.05)';
        tr.onmouseout = () => tr.style.background = 'transparent';

        const statusText = p.status || '';
        const badgeClass = statusText.toLowerCase() === 'em linha' ? 'badge-success' : 'badge-danger';

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white relative">
                <div class="flex items-center">
                    <span>${p.codigo || ''}</span>
                    <i class="info-icon ml-2" data-id="${p.id}"></i>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${reduzirNome(p.nome) || ''}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${p.categoria || ''}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${formatCurrency(p.preco_venda)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-green)">${formatPercent(p.pct_markup)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${p.quantidade_total ?? 0}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">
                    ${statusText}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center action-cell"></td>
        `;
        tbody.appendChild(tr);
    });

    const template = document.getElementById('action-icons-template');
    if (template) {
        document.querySelectorAll('.action-cell').forEach((cell, index) => {
            cell.appendChild(template.content.cloneNode(true));
            const icons = cell.querySelectorAll('i');
            const prod = produtos[index];
            const ver = icons[0];
            const editar = icons[1];
            const excluir = icons[2];
            if (ver) ver.addEventListener('click', e => { e.stopPropagation(); abrirDetalhesProduto(prod); });
            if (editar) editar.addEventListener('click', e => { e.stopPropagation(); abrirEditarProduto(prod); });
            if (excluir) excluir.addEventListener('click', e => { e.stopPropagation(); abrirExcluirProduto(prod); });
        });
    }

    attachInfoEvents();
}

function popularFiltros() {
    const categoriaSelect = document.getElementById('filterCategory');
    const statusSelect = document.getElementById('filterStatus');
    if (categoriaSelect) {
        const categorias = [...new Set(listaProdutos.map(p => p.categoria).filter(Boolean))];
        categoriaSelect.innerHTML = '<option value="">Todas as Categorias</option>' +
            categorias.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    if (statusSelect) {
        const status = [...new Set(listaProdutos.map(p => p.status).filter(Boolean))];
        statusSelect.innerHTML = '<option value="">Todos</option>' +
            status.map(s => `<option value="${s}">${s}</option>`).join('');
    }
}

function aplicarFiltro(aplicarNovos = false) {
    const busca = document.getElementById('filterSearch')?.value.toLowerCase() || '';
    const categoria = aplicarNovos ? (document.getElementById('filterCategory')?.value || '') : filtrosAplicados.categoria;
    const status = aplicarNovos ? (document.getElementById('filterStatus')?.value || '') : filtrosAplicados.status;
    const precoMinStr = aplicarNovos ? document.getElementById('filterPriceMin')?.value : filtrosAplicados.precoMin;
    const precoMaxStr = aplicarNovos ? document.getElementById('filterPriceMax')?.value : filtrosAplicados.precoMax;
    const zeroEstoque = aplicarNovos ? document.getElementById('zeroStock')?.checked : filtrosAplicados.zeroEstoque;

    let filtrados = [...listaProdutos];

    if (busca) {
        filtrados = filtrados.filter(p => {
            const codigo = (p.codigo || '').toString().toLowerCase();
            const nome = (p.nome || '').toLowerCase();
            return codigo.includes(busca) || nome.includes(busca);
        });
    }
    if (categoria) {
        filtrados = filtrados.filter(p => p.categoria === categoria);
    }
    if (status) {
        filtrados = filtrados.filter(p => p.status === status);
    }
    const precoMin = parseFloat(precoMinStr);
    if (!isNaN(precoMin)) {
        filtrados = filtrados.filter(p => Number(p.preco_venda) >= precoMin);
    }
    const precoMax = parseFloat(precoMaxStr);
    if (!isNaN(precoMax)) {
        filtrados = filtrados.filter(p => Number(p.preco_venda) <= precoMax);
    }
    if (zeroEstoque) {
        filtrados = filtrados.filter(p => Number(p.quantidade_total) === 0);
    }

    if (aplicarNovos) {
        filtrosAplicados = { categoria, status, precoMin: precoMinStr || '', precoMax: precoMaxStr || '', zeroEstoque: !!zeroEstoque };
        filtrosPendentes = false;
    }

    renderProdutos(filtrados);
}

function limparFiltros() {
    const busca = document.getElementById('filterSearch');
    const categoria = document.getElementById('filterCategory');
    const status = document.getElementById('filterStatus');
    const precoMin = document.getElementById('filterPriceMin');
    const precoMax = document.getElementById('filterPriceMax');
    const zero = document.getElementById('zeroStock');
    if (busca) busca.value = '';
    if (categoria) categoria.value = '';
    if (status) status.value = '';
    if (precoMin) precoMin.value = '';
    if (precoMax) precoMax.value = '';
    if (zero) zero.checked = false;
    filtrosAplicados = { categoria: '', status: '', precoMin: '', precoMax: '', zeroEstoque: false };
    filtrosPendentes = false;
    aplicarFiltro(false);
}
function marcarFiltrosPendentes() {
    filtrosPendentes = true;
}

function formatCurrency(value) {
    if (value == null) return '';
    return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value) {
    if (value == null) return '';
    return `${Number(value).toFixed(1)}%`;
}

function reduzirNome(nome) {
    if (!nome) return '';
    const partes = nome.split(' - ');
    if (partes.length < 2) return partes[0];
    const medida = partes[1].split(' (')[0].trim();
    return `${partes[0]} - ${medida}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function extrairCorDimensoes(nome) {
    if (!nome) return { cor: '', dimensoes: '' };
    const partes = nome.split(' - ');
    const cor = partes[2] ? partes[2].trim() : '';
    let dimensoes = '';
    if (partes[1]) {
        const match = partes[1].match(/\(([^)]+)\)/);
        if (match) dimensoes = `(${match[1]}) cm`;
    }
    return { cor, dimensoes };
}

const resolveColorCss = window.resolveColorCss || (c => c);

function createPopupContent(item) {
    const { cor, dimensoes } = extrairCorDimensoes(item.nome);
    const corCss = resolveColorCss(cor);
    return `
    <div class="popup-card">
      <div class="popup-header">
        <p class="popup-header-subtitle">Categoria:</p>
        <h3 class="popup-header-title">${item.categoria || ''}</h3>
      </div>
      <div class="popup-body">
        <div class="popup-info-grid">
          <div>
            <p class="popup-info-label">Data de Criação:</p>
            <p class="popup-info-value">${formatDate(item.criado_em)}</p>
          </div>
          <div>
            <p class="popup-info-label">Última Atualização:</p>
            <p class="popup-info-value">${formatDate(item.data)}</p>
          </div>
        </div>
        <div class="popup-info-grid">
          <div>
            <p class="popup-info-label">Cor:</p>
            <div class="popup-color-wrapper">
              <p class="popup-info-value">${cor}</p>
              <div class="popup-color-bar" style="background-color: ${corCss};"></div>
            </div>
          </div>
          <div>
            <p class="popup-info-label">Dimensões:</p>
            <p class="popup-info-value">${dimensoes}</p>
          </div>
        </div>
        <div class="popup-description-section">
          <p class="popup-info-label">Descrição:</p>
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

window.hideProductInfoPopup = hideInfoPopup;

function attachInfoEvents() {
    const lista = document.getElementById('produtosTableBody');
    if (!lista) return;

    lista.removeEventListener('mouseover', infoMouseEnter);
    lista.removeEventListener('mouseout', infoMouseLeave);

    infoMouseEnter = e => {
        const icon = e.target.closest('.info-icon');
        if (!icon) return;
        const id = parseInt(icon.dataset.id);
        const item = produtosRenderizados.find(p => p.id === id);
        if (item) showInfoPopup(icon, item);
    };

    infoMouseLeave = e => {
        if (e.target.closest('.info-icon')) hideInfoPopup();
    };

    lista.addEventListener('mouseover', infoMouseEnter);
    lista.addEventListener('mouseout', infoMouseLeave);

    if (window.feather) feather.replace();
}

function initProdutos() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    document.getElementById('btnNovoProduto')?.addEventListener('click', abrirNovoProduto);

    document.getElementById('btnFiltrar')?.addEventListener('click', () => {
        aplicarFiltro(true);
        if (typeof collapseSidebar === 'function') collapseSidebar();
    });
    document.getElementById('btnLimpar')?.addEventListener('click', () => {
        limparFiltros();
        if (typeof collapseSidebar === 'function') collapseSidebar();
    });

    document.getElementById('filterSearch')?.addEventListener('input', () => aplicarFiltro(false));
    document.getElementById('filterCategory')?.addEventListener('change', marcarFiltrosPendentes);
    document.getElementById('filterStatus')?.addEventListener('change', marcarFiltrosPendentes);
    document.getElementById('filterPriceMin')?.addEventListener('input', marcarFiltrosPendentes);
    document.getElementById('filterPriceMax')?.addEventListener('input', marcarFiltrosPendentes);
    document.getElementById('zeroStock')?.addEventListener('change', () => aplicarFiltro(true));

    carregarProdutos();

    ajustarBotoes();

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        const observer = new MutationObserver(ajustarBotoes);
        observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    }
}

// Reduz ou amplia o padding dos botões "Filtrar" e "Novo"
function ajustarBotoes() {
    const sidebar = document.getElementById('sidebar');
    const expandida = sidebar?.classList.contains('sidebar-expanded');
    document.querySelectorAll('#bt-actions button').forEach(btn => {
        if (expandida) {
            btn.classList.remove('px-4');
            btn.classList.add('px-2');
        } else {
            btn.classList.remove('px-2');
            btn.classList.add('px-4');
        }
    });
}

function abrirNovoProduto() {
    Modal.open('modals/produtos/novo.html', '../js/modals/produto-novo.js', 'novoProduto');
}

function abrirEditarProduto(prod) {
    if (!prod || !prod.codigo) {
        showToast('Produto inválido', 'error');
        return;
    }
    window.produtoSelecionado = prod;
    Modal.open('modals/produtos/editar.html', '../js/modals/produto-editar.js', 'editarProduto');
}

function abrirExcluirProduto(prod) {
    window.produtoExcluir = prod;
    Modal.open('modals/produtos/excluir.html', '../js/modals/produto-excluir.js', 'excluirProduto');
}

function abrirDetalhesProduto(prod) {
    window.produtoDetalhes = prod;
    Modal.open('modals/produtos/detalhes.html', '../js/modals/produto-detalhes.js', 'detalhesProduto');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProdutos);
} else {
    initProdutos();
}
