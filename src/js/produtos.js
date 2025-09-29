// Script principal do módulo de Produtos
// Responsável por carregar os dados e controlar filtros e ações de estoque.

let listaProdutos = [];
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
let currentProductPopup = null;
let productInfoEventsBound = false;
let produtoActionsBound = false;

async function carregarProdutos() {
    try {
        listaProdutos = await (window.electronAPI?.listarProdutos?.() ?? []);
        popularFiltros();
        aplicarFiltro(true);
    } catch (err) {
        console.error('Erro ao carregar produtos', err);
        showToast('Erro ao carregar produtos', 'error');
    }
}
window.carregarProdutos = carregarProdutos;

function updateEmptyStateProdutos(hasData) {
    const wrapper = document.getElementById('produtosTableWrapper');
    const empty = document.getElementById('produtosEmptyState');
    if (!wrapper || !empty) return;
    if (hasData) {
        wrapper.classList.remove('hidden');
        empty.classList.add('hidden');
    } else {
        wrapper.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

function renderProdutos(produtos) {
    const tbody = document.getElementById('produtosTableBody');
    if (!tbody) return;

    produtosRenderizados = [...produtos];
    tbody.innerHTML = produtos.map((prod, index) => criarLinhaProduto(prod, index)).join('');

    aplicarEfeitoHoverLinhas();
    garantirEventosAcoesProdutos();

    if (window.feather) feather.replace();
    attachProductInfoEvents();
    updateEmptyStateProdutos(produtos.length > 0);
}

function criarLinhaProduto(produto, index) {
    const statusText = produto.status || '';
    const badgeClass = statusText.toLowerCase() === 'em linha' ? 'badge-success' : 'badge-danger';
    const markup = formatPercent(produto.pct_markup);
    const quantidade = produto.quantidade_total ?? 0;
    const codigo = produto.codigo || '';
    const nome = reduzirNome(produto.nome) || '';
    const categoria = produto.categoria || '';
    const precoVenda = formatCurrency(produto.preco_venda);
    const produtoId = produto?.id != null ? ` data-id="${produto.id}"` : '';
    const infoId = produto?.id ?? '';

    return `
        <tr class="transition-colors duration-150" data-index="${index}"${produtoId} style="cursor: pointer;">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white relative">
                <div class="flex items-center">
                    <span>${codigo}</span>
                    <i class="info-icon ml-2" data-id="${infoId}"></i>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${nome}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${categoria}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${precoVenda}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-green)">${markup}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${quantidade}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">
                    ${statusText}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-left action-cell">
                <div class="flex items-center justify-start space-x-2">
                    <i class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-action="view" data-index="${index}" title="Visualizar" style="color: var(--color-primary)"></i>
                    <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-action="edit" data-index="${index}" title="Editar" style="color: var(--color-primary)"></i>
                    <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" data-action="delete" data-index="${index}" title="Excluir" style="color: var(--color-red)"></i>
                </div>
            </td>
        </tr>
    `;
}

function aplicarEfeitoHoverLinhas() {
    const tbody = document.getElementById('produtosTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('mouseover', () => {
            tr.style.background = 'rgba(163, 148, 167, 0.05)';
        });
        tr.addEventListener('mouseout', () => {
            tr.style.background = 'transparent';
        });
    });
}

function garantirEventosAcoesProdutos() {
    if (produtoActionsBound) return;
    const tbody = document.getElementById('produtosTableBody');
    if (!tbody) return;
    produtoActionsBound = true;

    tbody.addEventListener('click', event => {
        const actionEl = event.target.closest('[data-action]');
        if (!actionEl || !tbody.contains(actionEl)) return;

        event.preventDefault();
        event.stopPropagation();

        const action = actionEl.dataset.action;
        const indexAttr = actionEl.dataset.index;
        let produto = null;

        if (indexAttr !== undefined) {
            const index = Number(indexAttr);
            if (!Number.isNaN(index)) {
                produto = produtosRenderizados[index];
            }
        }

        if (!produto) {
            const row = actionEl.closest('tr');
            const id = row?.dataset?.id;
            if (id) {
                produto = produtosRenderizados.find(p => String(p.id) === id);
            }
        }

        if (!produto) return;

        switch (action) {
            case 'view':
                abrirDetalhesProduto(produto);
                break;
            case 'edit':
                abrirEditarProduto(produto);
                break;
            case 'delete':
                abrirExcluirProduto(produto);
                break;
            default:
                break;
        }
    });
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

function extrairCorDimensoes(item) {
    if (!item) return { corNome: '', corAmostra: '', dimensoes: '' };
    const nome = item.nome || '';
    const partes = nome.split(' - ');
    let corNome = '';
    if (item.cor) {
        corNome = item.cor.trim();
    } else if (partes[2]) {
        corNome = partes[2].trim();
    }

    let corAmostra = corNome;
    if (corNome.includes('/')) {
        const partesCor = corNome.split('/');
        corAmostra = partesCor[partesCor.length - 1].trim();
    }

    let dimensoes = '';
    if (partes[1]) {
        const match = partes[1].match(/\(([^)]+)\)/);
        if (match) dimensoes = `(${match[1]}) cm`;
    }
    return { corNome, corAmostra, dimensoes };
}

const resolveColorCss = (cor) => {
    return window.resolveColorCss ? window.resolveColorCss(cor) : cor;
};

function isDarkColor(hex) {
    const sanitized = hex.replace('#', '');
    const full = sanitized.length === 3
        ? sanitized.replace(/(.)/g, '$1$1')
        : sanitized;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 128;
}

function createPopupContent(item) {
    const { corNome, corAmostra, dimensoes } = extrairCorDimensoes(item);
    const corCss = resolveColorCss(corAmostra);
    const outlineClass = isDarkColor(corCss) ? ' popup-color-bar-outline' : '';
    const corSection = corNome
        ? `
            <div class="popup-color-wrapper">
              <p class="popup-info-value">${corNome}</p>
              <div class="popup-color-bar${outlineClass}" style="background-color: ${corCss};"></div>
            </div>
          `
        : '<p class="popup-info-value">-</p>';
    return `
    <div class="popup-card">
      <div class="popup-header">
        <div class="popup-header-item">
          <p class="popup-header-subtitle">Categoria:</p>
          <h3 class="popup-header-title">${item.categoria || ''}</h3>
        </div>
        <div class="popup-header-item">
          <p class="popup-header-subtitle">NCM:</p>
          <h3 class="popup-header-title">${item.ncm || ''}</h3>
        </div>
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
            ${corSection}
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

function showProductInfoPopup(target, item) {
    hideProductInfoPopup();
    const { popup, left, top } = createPopup(target, createPopupContent(item), { onHide: hideProductInfoPopup });
    window.electronAPI?.log?.(`showProductInfoPopup left=${left} top=${top} id=${item.id}`);
    currentProductPopup = popup;
}

function hideProductInfoPopup() {
    if (currentProductPopup) {
        currentProductPopup.remove();
        currentProductPopup = null;
    }
    window.electronAPI?.log?.('hideProductInfoPopup');
}

window.showProductInfoPopup = showProductInfoPopup;
window.hideProductInfoPopup = hideProductInfoPopup;
window.attachProductInfoEvents = attachProductInfoEvents;

function attachProductInfoEvents() {
    if (productInfoEventsBound) return;
    const tbody = document.getElementById('produtosTableBody');
    if (!tbody) return;
    productInfoEventsBound = true;

    tbody.addEventListener('mouseover', e => {
        const icon = e.target.closest('.info-icon');
        if (!icon || !tbody.contains(icon)) return;
        const id = icon.dataset.id;
        if (!id) {
            window.electronAPI?.log?.('attachProductInfoEvents invalid id');
            return;
        }
        window.electronAPI?.log?.(`attachProductInfoEvents icon=${id}`);
        const item = produtosRenderizados.find(p => String(p.id) === id);
        if (item) showProductInfoPopup(icon, item);
    });

    tbody.addEventListener('mouseout', e => {
        const icon = e.target.closest('.info-icon');
        if (!icon || !tbody.contains(icon)) return;
        setTimeout(() => {
            if (!currentProductPopup?.matches(':hover')) hideProductInfoPopup();
        }, 100);
    });
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

    document.getElementById('produtosEmptyNew')?.addEventListener('click', () => {
        document.getElementById('btnNovoProduto')?.click();
    });

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

function abrirNovoProduto() {
    Modal.open('modals/produtos/novo.html', '../js/modals/produto-novo.js', 'novoProduto');
}

function abrirEditarProduto(prod) {
    if (!prod || !prod.codigo) {
        showToast('Produto inválido', 'error');
        return;
    }
    window.produtoSelecionado = prod;
    openModalWithSpinner('modals/produtos/editar.html', '../js/modals/produto-editar.js', 'editarProduto');
}

function abrirExcluirProduto(prod) {
    window.produtoExcluir = prod;
    Modal.open('modals/produtos/excluir.html', '../js/modals/produto-excluir.js', 'excluirProduto');
}

function abrirDetalhesProduto(prod) {
    window.produtoDetalhes = prod;
    openModalWithSpinner('modals/produtos/detalhes.html', '../js/modals/produto-detalhes.js', 'detalhesProduto');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProdutos);
} else {
    initProdutos();
}
