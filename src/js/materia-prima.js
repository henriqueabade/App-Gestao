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

    // Duas coisas a cada tecla: o filtro local, que é instantâneo, e o AGENDAMENTO
    // da busca por produto, que só sai quando a digitação para.
    document.getElementById('materiaPrimaSearch')?.addEventListener('input', () => {
        aplicarFiltros();
        agendarBuscaPorProduto();
    });
    document.getElementById('filtroProcesso')?.addEventListener('change', aplicarFiltros);
    document.getElementById('filtroCategoria')?.addEventListener('change', aplicarFiltros);
    // Quem clica em "Filtrar" quer o resultado AGORA: a busca por produto não
    // espera os 300 ms da digitação.
    document.getElementById('btnFiltrar')?.addEventListener('click', () => {
        aplicarFiltros();
        agendarBuscaPorProduto(0);
    });
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

let sequenciaBuscaProduto = 0;
let temporizadorBuscaProduto = null;

/**
 * Insumos usados por um PRODUTO cujo nome bate com a busca.
 *
 * Guardado com o termo que o gerou: uma lista de outra pesquisa mostraria
 * insumos que não têm nada a ver com o que está escrito na caixa.
 */
let buscaPorProduto = { termo: '', ids: new Set() };

/** Espera o usuário parar de digitar. Ver a nota em `agendarBuscaPorProduto`. */
const ESPERA_DIGITACAO_MS = 300;

/**
 * A parte da busca que vai ao banco, DEPOIS que o usuário para de digitar.
 *
 * Filtrar por nome, categoria e processo é instantâneo — a lista já está aqui.
 * O que custa é descobrir quais insumos são usados por um produto com aquele
 * nome, e isso era feito A CADA TECLA: escrever "Apaga Velas Silvia" disparava
 * dezoito consultas, uma atrás da outra, e a tabela só assentava quando a
 * última voltava. Agora vai uma só, quando a digitação para.
 */
function agendarBuscaPorProduto(espera = ESPERA_DIGITACAO_MS) {
    const termo = (document.getElementById('materiaPrimaSearch')?.value || '').trim();

    if (temporizadorBuscaProduto) clearTimeout(temporizadorBuscaProduto);

    if (!termo) {
        // Caixa vazia: a lista de produtos não vale mais e some na hora.
        sequenciaBuscaProduto += 1;
        if (buscaPorProduto.ids.size) {
            buscaPorProduto = { termo: '', ids: new Set() };
            aplicarFiltros();
        }
        return;
    }

    temporizadorBuscaProduto = setTimeout(async () => {
        const sequenciaAtual = ++sequenciaBuscaProduto;
        try {
            const ids = await (window.electronAPI?.listarInsumosPorProduto?.(termo) ?? []);
            // Uma resposta antiga nunca deve substituir a pesquisa mais recente.
            if (sequenciaAtual !== sequenciaBuscaProduto) return;
            buscaPorProduto = {
                termo: termo.toLowerCase(),
                ids: new Set((Array.isArray(ids) ? ids : []).map(String))
            };
            aplicarFiltros();
        } catch (err) {
            console.error('Erro ao buscar insumos por produto', err);
        }
    }, espera);
}

/**
 * Filtra e redesenha a tabela. SÍNCRONA de propósito: roda a cada tecla e não
 * pode esperar rede — o que depende do banco entra por
 * `agendarBuscaPorProduto` e redesenha de novo quando chega.
 */
function aplicarFiltros() {
    const termo = (document.getElementById('materiaPrimaSearch')?.value || '').toLowerCase();
    const processo = document.getElementById('filtroProcesso')?.value || '';
    const categoria = document.getElementById('filtroCategoria')?.value || '';
    const zeroEstoque = document.getElementById('zeroStock')?.checked;

    // Só vale a lista de produtos que corresponde ao que está escrito AGORA.
    const idsUsadosPeloProduto = buscaPorProduto.termo === termo.trim()
        ? buscaPorProduto.ids
        : new Set();

    let filtrados = todosMateriais.filter(m => {
        const isCritical = !m.infinito && Number(m.quantidade) < 10;
        const matchTermo = !termo ||
            (m.nome || '').toLowerCase().includes(termo) ||
            (m.categoria || '').toLowerCase().includes(termo) ||
            (m.processo || '').toLowerCase().includes(termo) ||
            idsUsadosPeloProduto.has(String(m.id)) ||
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
    // Cancela a busca que estava agendada: sem isto ela chegaria depois e
    // repintaria a tabela com o resultado de um filtro que já foi limpo.
    agendarBuscaPorProduto();
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

/**
 * Custo médio na grade. O campo de preço aceita até 4 casas decimais, então
 * arredondar em 2 aqui escondia o que o usuário digitou (0,0125 aparecia como
 * 0,01). Mostra 2 casas no caso comum e vai até 4 só quando o valor tem.
 */
function formatarPreco(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
    });
}

// Controle de popup de informações da matéria prima
let materiais = [];
// Mapa auxiliar para lookup rápido pelo id
let materiaisMap = new Map();
let currentRawMaterialPopup = null;

const escaparHtml = valor =>
    valor == null
        ? ''
        : String(valor).replace(/[&<>"']/g, ch =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Cache por insumo: o popup abre no hover e reabre a cada passada do mouse, não
// dá para consultar o back-end toda vez.
const produtosPorInsumoCache = new Map();

function buscarProdutosDoInsumo(insumoId) {
    const chave = String(insumoId);
    if (produtosPorInsumoCache.has(chave)) {
        return produtosPorInsumoCache.get(chave);
    }
    const promessa = Promise.resolve(
        window.electronAPI?.listarProdutosPorInsumo?.(insumoId) ?? []
    ).catch(err => {
        console.error('Erro ao listar produtos que usam o insumo', err);
        produtosPorInsumoCache.delete(chave);   // permite nova tentativa
        return null;
    });
    produtosPorInsumoCache.set(chave, promessa);
    return promessa;
}

function renderizarUtilizadoEm(produtos) {
    if (produtos === null) {
        return '<p class="popup-description-text">Não foi possível carregar.</p>';
    }
    if (!Array.isArray(produtos) || produtos.length === 0) {
        return '<p class="popup-description-text">Nenhum produto utiliza este insumo.</p>';
    }
    return produtos
        .map(produto => {
            const codigo = produto?.codigo || produto?.nome || produto?.id;
            const titulo = produto?.nome ? ` title="${escaparHtml(produto.nome)}"` : '';
            return `<span class="badge badge-neutral"${titulo}>${escaparHtml(codigo)}</span>`;
        })
        .join('');
}

/**
 * Preenche a seção "Utilizado em:" depois que o popup já está na tela. Confere
 * o id gravado no container porque o mouse pode ter trocado de linha (ou saído
 * da tabela) enquanto a consulta acontecia.
 */
async function preencherUtilizadoEm(popup, insumoId) {
    const container = popup?.querySelector('[data-usage-for]');
    if (!container) return;
    const produtos = await buscarProdutosDoInsumo(insumoId);
    if (!popup.isConnected) return;
    if (container.dataset.usageFor !== String(insumoId)) return;
    container.innerHTML = renderizarUtilizadoEm(produtos);
}

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
        <div class="popup-description-section">
          <p class="popup-info-label">Utilizado em:</p>
          <div class="popup-usage-list modal-scroll" data-usage-for="${escaparHtml(item.id)}">
            <p class="popup-description-text">Carregando...</p>
          </div>
        </div>
      </div>
    </div>`;
}

function showRawMaterialInfoPopup(target, item) {
    hideRawMaterialInfoPopup();
    const { popup, left, top } = createPopup(target, createPopupContent(item), { onHide: hideRawMaterialInfoPopup });
    window.electronAPI?.log?.(`showRawMaterialInfoPopup left=${left} top=${top} id=${item.id}`);
    currentRawMaterialPopup = popup;
    // A lista de produtos vem do back-end: preenche depois, sem travar o hover.
    preencherUtilizadoEm(popup, item.id);
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

    // ESTADO DA LINHA POR CLASSE, cor e realce por CSS (materia-prima.css).
    //
    // Antes cada linha carregava cor inline e DOIS listeners próprios, criados
    // de novo a cada render — e o render acontece ao abrir o módulo e a cada
    // tecla do filtro. Numa tabela cheia são milhares de closures só para
    // pintar fundo. A classe diz o estado; o resto o navegador resolve sozinho,
    // sem tocar na thread principal.
    if (isInfinite) tr.classList.add('linha-infinita');
    else if (!isNaN(quantidadeNumero) && quantidadeNumero < 10) tr.classList.add('linha-critica');

    const preco = Number(item.preco_unitario || 0);
    tr.innerHTML = `
        <td data-perm-col="col_mp_nome" class="px-6 py-4 whitespace-nowrap relative text-base text-white">
            <div class="flex items-center">
                <span class="font-medium">${item.nome}</span>
                <i class="info-icon ml-2" data-id="${item.id}"></i>
            </div>
        </td>
        <td data-perm-col="col_mp_estoque_atual" class="px-6 py-4 whitespace-nowrap text-base text-white">${quantidadeValor}</td>
        <td data-perm-col="col_mp_unidade" class="px-6 py-4 whitespace-nowrap text-base" style="color: var(--color-violet)">${item.unidade || ''}</td>
        <td data-perm-col="col_mp_custo_medio" class="px-6 py-4 whitespace-nowrap text-base text-white">R$ ${formatarPreco(preco)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-base text-left">
            <div class="flex items-center justify-start space-x-2">
                <i data-perm="mp.movimentos.view" class="fas fa-clipboard-list w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-blue)" title="Relatório de movimentações"></i>
                <i data-perm="mp.edit" class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
                <i data-perm="mp.delete" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Excluir"></i>
            </div>
        </td>`;

    const infoIcon = tr.querySelector('.info-icon');
    if (infoIcon) {
        infoIcon.dataset.id = String(item.id);
        bindRawMaterialInfoIcon(infoIcon);
    }

    const movBtn = tr.querySelector('.fa-clipboard-list');
    const editBtn = tr.querySelector('.fa-edit');
    const delBtn = tr.querySelector('.fa-trash');
    if (movBtn) movBtn.addEventListener('click', e => { e.stopPropagation(); abrirMovimentosInsumo(item); });
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
    // Registra como reabrir este modal, para restaurar o trabalho apos queda.
    window.__registrarModalAberto?.({ htmlPath, scriptPath, overlayId });
    Modal.closeAll();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    spinner.style.zIndex = 'var(--z-dialog)';
    spinner.innerHTML = '<div class="app-loading-indicator app-loading-indicator--compact" aria-hidden="true"><span class="module-loading-orbit"></span><span class="module-loading-core"><img src="../assets/Logo.ico" alt=""></span></div>';
    document.body.appendChild(spinner);
    // Tempo mínimo de exibição do spinner: evita o "piscar" do modal e a
    // sensação de travamento. Não atrasa o carregamento dos dados — apenas
    // segura a revelação do modal caso ele fique pronto antes disso.
    const MIN_SPINNER_MS = 1000;
    const inicioSpinner = Date.now();
    function handleLoaded(e) {
        if (e.detail !== overlayId) return;
        const restante = Math.max(0, MIN_SPINNER_MS - (Date.now() - inicioSpinner));
        setTimeout(() => {
            const overlay = document.getElementById(`${overlayId}Overlay`);
            spinner.remove();
            overlay?.classList.remove('hidden');
        }, restante);
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

/** Auditoria do insumo: tudo que entrou, saiu e por quê. */
function abrirMovimentosInsumo(item) {
    window.insumoMovimentos = item;
    openModalWithSpinner('modals/materia-prima/movimentos.html', '../js/modals/materia-prima-movimentos.js', 'movimentosInsumo');
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
