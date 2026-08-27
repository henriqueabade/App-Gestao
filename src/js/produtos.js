// Script principal do módulo de Produtos
// Responsável por carregar os dados e controlar filtros e ações de estoque.

let listaProdutos = [];
let refreshInProgress = false;
let refreshQueued = false;
let refreshQueuedOptions = null;
let filtrosAplicados = {
    busca: '',
    categoria: '',
    status: '',
    precoMin: '',
    precoMax: '',
    zeroEstoque: false
};
let filtrosPendentes = false;
let avisoNovoItemEl = null;

// Controle de popup de informações do produto
let produtosRenderizados = [];
let currentProductPopup = null;
let productInfoEventsBound = false;
let produtoActionsBound = false;

// ---------------------------------------------------------------------------
// COLUNA DE PREÇO: DOIS NÚMEROS QUE NÃO SÃO A MESMA COISA
//
// `preco_venda` é o preço CALCULADO — ele se move sozinho toda vez que um
// insumo muda de custo. `preco_tabela` é o preço PRATICADO, que só muda
// quando alguém marca "Atualizar Tabela Fixa" ao salvar a peça. Quem vende
// precisa do segundo; quem apura custo, do primeiro.
//
// A coluna é uma só e alterna entre eles pelo ícone na linha. O estado vale
// para a tabela inteira: alternar em qualquer linha vira a coluna toda, senão
// a mesma coluna mostraria grandezas diferentes de linha para linha.
//
//   'custo'  → "Preço de Custo"  (preco_venda — o nome diz o que o número é)
//   'tabela' → "Preço Tabela"    (preco_tabela; vazio quando não há registro)
//
// "Preço de Venda" saiu do vocabulário do módulo de propósito: era o rótulo
// de `preco_venda`, que não é preço de venda nenhum — é o custo apurado.
// ---------------------------------------------------------------------------
const MODOS_PRECO = {
    custo:  { titulo: 'Preço de Custo', permCol: 'col_prod_preco_base',   proximo: 'tabela' },
    tabela: { titulo: 'Preço Tabela',   permCol: 'col_prod_preco_tabela', proximo: 'custo'  }
};
// A coluna NASCE no preço praticado. É esse o número que a peça "vale" para
// quem olha o catálogo: é o que vai no orçamento, é o que o cliente paga. O
// calculado é ferramenta de quem apura custo, e abrir a tela mostrando ele
// fazia todo mundo ler um número de custo achando que era o preço de venda.
let modoPreco = 'tabela';
let trocandoModoPreco = false;

/** Ícone que a linha mostra hoje — e para onde ele leva. */
function iconePrecoAtual() {
    // Em 'tabela' a coluna já mostra o preço praticado, então o convite é
    // voltar para o custo: calculadora roxa. Caso contrário, moeda verde.
    return modoPreco === 'tabela'
        ? { classe: 'fa-calculator', cor: '#7300ba', titulo: 'Mostrar preço de custo' }
        : { classe: 'fa-coins',      cor: 'var(--color-green)', titulo: 'Mostrar preço de tabela' };
}

/**
 * A peça cabe na faixa de preço pedida?
 *
 * A faixa é sobre o preço PRATICADO, não sobre o calculado. Quem digita "entre
 * 2.000 e 2.100" está procurando a peça que custa isso para o cliente —
 * filtrar pelo calculado devolvia outra lista, e pior: uma lista plausível.
 * Os dois números vivem na mesma ordem de grandeza, então o resultado errado
 * não parecia errado.
 *
 * Peça sem linha na tabela fixa não tem preço praticado e fica DE FORA de
 * qualquer faixa — coerente com o resto do programa, onde ela também não pode
 * ser vendida. Sem faixa nenhuma pedida, porém, ela aparece: o catálogo mostra
 * tudo, e é do catálogo que se descobre o que ainda falta cadastrar.
 *
 * `PrecoTabela` (src/utils/precoTabela.js) é a MESMA função que o orçamento usa
 * para decidir se a peça pode ser vendida. Uma segunda leitura de
 * `preco_tabela` aqui viraria uma segunda regra sobre o mesmo campo, e as duas
 * divergiriam na primeira mudança.
 */
function naFaixaDePreco(produto, min, max) {
    const temMin = Number.isFinite(min);
    const temMax = Number.isFinite(max);
    if (!temMin && !temMax) return true;

    const valor = window.PrecoTabela.precoDeVenda(produto);
    if (valor === null) return false;
    if (temMin && valor < min) return false;
    if (temMax && valor > max) return false;
    return true;
}

/** Valor que a célula de preço mostra no modo corrente. */
function valorPrecoDaLinha(produto) {
    if (modoPreco !== 'tabela') return formatCurrency(produto?.preco_venda);
    // Peça sem linha na tabela fixa fica com célula VAZIA, não com R$ 0,00:
    // zero é um preço, ausência é um cadastro que falta fazer.
    const valor = produto?.preco_tabela;
    return valor == null ? '' : formatCurrency(valor);
}

/**
 * Conteúdo da célula de preço.
 *
 * Durante a troca de modo a célula mostra o spinner em vez do número. Isso
 * vale para TODO render enquanto a troca está em curso — inclusive o que
 * `carregarProdutos` dispara no meio do caminho —, senão o valor antigo
 * reapareceria por um instante e a coluna piscaria o número errado.
 */
function celulaPrecoHtml(produto) {
    if (trocandoModoPreco) {
        return '<span class="preco-carregando" role="status" aria-label="Atualizando preço"></span>';
    }
    const valor = valorPrecoDaLinha(produto);
    return `<span class="cell-text" title="${valor}">${valor}</span>`;
}

/** Reescreve o cabeçalho da coluna de preço conforme o modo. */
function sincronizarCabecalhoPreco() {
    const th = document.querySelector('#produtosTableWrapper th[data-coluna-preco]');
    if (!th) return;
    const modo = MODOS_PRECO[modoPreco] || MODOS_PRECO.custo;
    th.textContent = modo.titulo;
    // A coluna troca de identidade junto com o conteúdo: esconder "Preço
    // Tabela" de quem não pode vê-lo exige que a chave acompanhe o modo.
    th.setAttribute('data-perm-col', modo.permCol);
    window.Permissoes?.aplicarAcoesEColunas?.(th.parentElement || th);
}

/**
 * Troca a coluna entre "Preço de Custo" e "Preço Tabela".
 *
 * A troca REBUSCA os produtos em vez de apenas reetiquetar o que já está na
 * tela: o preço de tabela pode ter sido alterado por outra pessoa desde que o
 * módulo abriu, e exibir um número velho no lugar do preço praticado é
 * exatamente o erro que a tabela fixa existe para evitar.
 *
 * O spinner por linha existe porque essa ida ao servidor tem custo — sem ele
 * a coluna ficaria parada no valor anterior e o clique pareceria não ter
 * surtido efeito.
 */
async function alternarModoPreco() {
    // Segundo clique durante a troca dispararia uma busca concorrente e
    // deixaria o modo fora de sincronia com o que a coluna mostra.
    if (trocandoModoPreco) return;

    const modo = MODOS_PRECO[modoPreco] || MODOS_PRECO.custo;
    modoPreco = modo.proximo;
    trocandoModoPreco = true;
    renderProdutos(produtosRenderizados);

    // Piso curto: o suficiente para o spinner ser percebido quando a resposta
    // volta rápido, sem transformar a troca em espera.
    const MIN_SPINNER_MS = 450;
    const inicio = Date.now();
    try {
        await carregarProdutos();
    } finally {
        const restante = MIN_SPINNER_MS - (Date.now() - inicio);
        if (restante > 0) {
            await new Promise(resolve => setTimeout(resolve, restante));
        }
        trocandoModoPreco = false;
        renderProdutos(produtosRenderizados);
    }
}

async function carregarProdutos(options = {}) {
    if (refreshInProgress) {
        refreshQueued = true;
        refreshQueuedOptions = options;
        return;
    }
    refreshInProgress = true;
    try {
        listaProdutos = await (window.electronAPI?.listarProdutos?.() ?? []);
        popularFiltros();
        if (options.resetFiltros) {
            resetarFiltrosUI();
        }
        if (options.novoProduto) {
            sinalizarNovoProduto(options.novoProduto, options.origem);
        }
        aplicarFiltro(true);
    } catch (err) {
        console.error('Erro ao carregar produtos', err);
        showToast('Erro ao carregar produtos', 'error');
    } finally {
        refreshInProgress = false;
        if (refreshQueued) {
            refreshQueued = false;
            const queuedOptions = refreshQueuedOptions || {};
            refreshQueuedOptions = null;
            carregarProdutos(queuedOptions);
        }
    }
}
window.carregarProdutos = carregarProdutos;
window.recarregarProdutos = carregarProdutos;

function atualizarProdutoLocal(produto, { mode } = {}) {
    if (!produto) return;
    const produtoId = produto?.id;
    if (produtoId == null) {
        console.error('atualizarProdutoLocal recebeu produto sem id', produto);
        return;
    }
    const index = listaProdutos.findIndex(p => (
        p.id === produtoId
    ));
    if (mode === 'add' || index === -1) {
        listaProdutos = [...listaProdutos, produto];
    } else {
        listaProdutos[index] = { ...listaProdutos[index], ...produto };
    }
    popularFiltros();
    aplicarFiltro(false);
}
window.atualizarProdutoLocal = atualizarProdutoLocal;

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

    sincronizarCabecalhoPreco();
    aplicarEfeitoHoverLinhas();
    garantirEventosAcoesProdutos();

    if (window.feather) feather.replace();
    attachProductInfoEvents();
    updateEmptyStateProdutos(produtos.length > 0);
}

function criarLinhaProduto(produto, index) {
    const markup = formatPercent(produto.pct_markup);
    const quantidade = produto.quantidade_total ?? 0;
    const codigo = produto.codigo || '';
    const nome = reduzirNome(produto.nome) || '';
    const categoria = produto.categoria || '';
    const precoColuna = celulaPrecoHtml(produto);
    const modoColuna = MODOS_PRECO[modoPreco] || MODOS_PRECO.custo;
    const icone = iconePrecoAtual();
    const produtoId = produto?.id != null ? ` data-id="${produto.id}"` : '';
    const infoId = produto?.id ?? '';

    return `
        <tr class="transition-colors duration-150" data-index="${index}"${produtoId} style="cursor: pointer;">
            <td data-perm-col="col_prod_sku" class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white relative">
                <div class="flex items-center min-w-0">
                    <span class="cell-text" title="${codigo}">${codigo}</span>
                    <i class="info-icon ml-2" data-id="${infoId}"></i>
                </div>
            </td>
            <td data-perm-col="col_prod_nome" class="px-6 py-4 whitespace-nowrap text-sm text-white">
                <span class="cell-text" title="${produto.nome || ''}">${nome}</span>
            </td>
            <td data-perm-col="col_prod_colecao" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">
                <span class="cell-text" title="${categoria}">${categoria}</span>
            </td>
            <td data-perm-col="${modoColuna.permCol}" class="px-6 py-4 whitespace-nowrap text-sm text-white">
                ${precoColuna}
            </td>
            <td data-perm-col="col_prod_margem" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-green)">
                <span class="cell-text" title="${markup}">${markup}</span>
            </td>
            <td data-perm-col="col_prod_estoque" class="px-6 py-4 whitespace-nowrap text-sm text-white">
                <span class="cell-text" title="${quantidade}">${quantidade}</span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-left action-cell">
                <div class="flex items-center justify-start space-x-2">
                    <i data-perm="prod.tabela.view" class="fas ${icone.classe} w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-action="preco-tabela" data-index="${index}" title="${icone.titulo}" style="color: ${icone.cor}"></i>
                    <i data-perm="prod.movimentos.view" class="fas fa-clipboard-list w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-action="movimentos" data-index="${index}" title="Relatório de movimentações" style="color: var(--color-blue)"></i>
                    <i data-perm="prod.stock.view" class="fas fa-box w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-action="stock" data-index="${index}" title="Estoque" style="color: var(--color-primary)"></i>
                    <i data-perm="prod.details.view" class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-action="view" data-index="${index}" title="Visualizar produto" style="color: var(--color-primary)"></i>
                    <i data-perm="prod.edit" class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-action="edit" data-index="${index}" title="Editar" style="color: var(--color-primary)"></i>
                    <i data-perm="prod.delete" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" data-action="delete" data-index="${index}" title="Excluir" style="color: var(--color-red)"></i>
                </div>
            </td>
        </tr>
    `;
}

/**
 * O realce da linha agora é CSS (`#produtosTableBody tr:hover`, em
 * produtos.css).
 *
 * Esta função prendia DOIS listeners por linha a cada render — e o render
 * acontece ao abrir o módulo e a cada filtro. Numa tabela cheia são milhares de
 * closures criadas só para pintar um fundo, trabalho que o navegador faz de
 * graça. Mantida vazia porque é chamada de mais de um ponto do arquivo.
 */
function aplicarEfeitoHoverLinhas() {}

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
            case 'preco-tabela':
                alternarModoPreco();
                break;
            case 'view':
                abrirVisualizarProduto(produto);
                break;
            case 'stock':
                abrirDetalhesProduto(produto);
                break;
            case 'movimentos':
                abrirMovimentosProduto(produto);
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
    const buscaRaw = document.getElementById('filterSearch')?.value || '';
    const busca = buscaRaw.trim().toLowerCase();
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
    filtrados = filtrados.filter(
        p => naFaixaDePreco(p, parseFloat(precoMinStr), parseFloat(precoMaxStr)));
    if (zeroEstoque) {
        filtrados = filtrados.filter(p => Number(p.quantidade_total) === 0);
    }

    if (aplicarNovos) {
        filtrosAplicados = {
            busca: buscaRaw.trim(),
            categoria,
            status,
            precoMin: precoMinStr || '',
            precoMax: precoMaxStr || '',
            zeroEstoque: !!zeroEstoque
        };
        filtrosPendentes = false;
    }

    renderProdutos(filtrados);
    registrarFiltroAplicado({ busca: buscaRaw, categoria, status, precoMinStr, precoMaxStr, zeroEstoque, total: listaProdutos.length, exibidos: filtrados.length });
    avaliarNovoProdutoFiltrado(filtrados);
}

function limparFiltros() {
    resetarFiltrosUI();
    aplicarFiltro(true);
    ocultarAvisoNovoItem();
}

function resetarFiltrosUI() {
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
    filtrosAplicados = { busca: '', categoria: '', status: '', precoMin: '', precoMax: '', zeroEstoque: false };
    filtrosPendentes = false;
}
function marcarFiltrosPendentes() {
    filtrosPendentes = true;
}

function filtrosAtivos({ busca, categoria, status, precoMinStr, precoMaxStr, zeroEstoque } = {}) {
    const hasBusca = typeof busca === 'string' && busca.trim().length > 0;
    return Boolean(
        hasBusca ||
        categoria ||
        status ||
        (precoMinStr && String(precoMinStr).trim() !== '') ||
        (precoMaxStr && String(precoMaxStr).trim() !== '') ||
        zeroEstoque
    );
}

function registrarFiltroAplicado({ busca, categoria, status, precoMinStr, precoMaxStr, zeroEstoque, total, exibidos } = {}) {
    if (!filtrosAtivos({ busca, categoria, status, precoMinStr, precoMaxStr, zeroEstoque })) return;
    const detalhes = {
        busca: (busca || '').trim(),
        categoria: categoria || '',
        status: status || '',
        precoMin: precoMinStr || '',
        precoMax: precoMaxStr || '',
        zeroEstoque: !!zeroEstoque,
        total: Number(total) || 0,
        exibidos: Number(exibidos) || 0
    };
    window.electronAPI?.log?.(`produtos.lista_filtrada ${JSON.stringify(detalhes)}`);
}

function avaliarNovoProdutoFiltrado(filtrados) {
    if (!pendingNovoProduto) return;
    const filtrosEmUso = filtrosAtivos({
        busca: filtrosAplicados.busca || document.getElementById('filterSearch')?.value || '',
        categoria: filtrosAplicados.categoria,
        status: filtrosAplicados.status,
        precoMinStr: filtrosAplicados.precoMin,
        precoMaxStr: filtrosAplicados.precoMax,
        zeroEstoque: filtrosAplicados.zeroEstoque
    });
    const produto = pendingNovoProduto;
    const encontrado = filtrados.some(item => (
        produto?.id != null && item.id === produto.id
    ));

    if (filtrosEmUso && !encontrado) {
        const aviso = 'Novo item criado, mas filtrado.';
        window.showToast?.(aviso, 'info');
        exibirAvisoNovoItem(aviso);
        window.electronAPI?.log?.(`produtos.novo_item_filtrado origem=${pendingNovoProdutoOrigem || 'n/a'} id=${produto?.id ?? ''} codigo=${produto?.codigo ?? ''}`);
    } else {
        ocultarAvisoNovoItem();
    }

    pendingNovoProduto = null;
    pendingNovoProdutoOrigem = '';
}

function exibirAvisoNovoItem(mensagem) {
    const container = obterAvisoNovoItemContainer();
    if (!container) return;
    const messageEl = container.querySelector('[data-role="aviso-mensagem"]');
    if (messageEl) messageEl.textContent = mensagem;
    container.classList.remove('hidden');
}

function ocultarAvisoNovoItem() {
    const container = obterAvisoNovoItemContainer();
    if (!container) return;
    container.classList.add('hidden');
}

function obterAvisoNovoItemContainer() {
    if (avisoNovoItemEl) return avisoNovoItemEl;
    const filtroBar = document.querySelector('.filter-bar');
    const filtroWrapper = filtroBar?.closest('.glass-surface');
    const parent = filtroWrapper?.parentElement;
    if (!parent || !filtroWrapper) return null;
    const container = document.createElement('div');
    container.id = 'produtosFilteredNotice';
    container.className = 'glass-surface rounded-xl p-4 mb-6 border border-yellow-500/20 text-yellow-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4 hidden';
    container.innerHTML = `
        <div class="flex items-center gap-3">
            <i class="fas fa-filter"></i>
            <p class="text-sm" data-role="aviso-mensagem">Novo item criado, mas filtrado.</p>
        </div>
        <button type="button" class="btn-warning text-white rounded-md px-4 py-2 text-sm font-medium" data-role="aviso-reset">
            Limpar filtros e recarregar
        </button>
    `;
    parent.insertBefore(container, filtroWrapper.nextSibling);
    container.querySelector('[data-role="aviso-reset"]')?.addEventListener('click', () => {
        ocultarAvisoNovoItem();
        carregarProdutos({ resetFiltros: true });
    });
    avisoNovoItemEl = container;
    return avisoNovoItemEl;
}

let pendingNovoProduto = null;
let pendingNovoProdutoOrigem = '';

function sinalizarNovoProduto(produto, origem) {
    pendingNovoProduto = produto;
    pendingNovoProdutoOrigem = origem || '';
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
    const statusText = item.status || '';
    const badgeClass = statusText.toLowerCase() === 'em linha' ? 'badge-success' : 'badge-danger';
    const statusSection = statusText
        ? `<span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${statusText}</span>`
        : '<p class="popup-info-value">-</p>';
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
            <p class="popup-info-label">Status:</p>
            ${statusSection}
          </div>
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

function abrirNovoProduto() {
    Modal.open('modals/produtos/novo.html', '../js/modals/produto-novo.js', 'novoProduto');
}

function abrirEditarProduto(prod) {
    if (!prod || prod.id == null) {
        showToast('Produto inválido', 'error');
        return;
    }
    const produtoCompleto = listaProdutos.find(item => item?.id === prod.id) || prod;
    window.produtoSelecionado = produtoCompleto;
    openModalWithSpinner('modals/produtos/editar.html', '../js/modals/produto-editar.js', 'editarProduto');
}

function abrirExcluirProduto(prod) {
    window.produtoExcluir = prod;
    Modal.open('modals/produtos/excluir.html', '../js/modals/produto-excluir.js', 'excluirProduto');
}

function abrirDetalhesProduto(prod) {
    if (!prod || prod.id == null) {
        showToast('Produto inválido', 'error');
        return;
    }
    const produtoCompleto = listaProdutos.find(item => item?.id === prod.id) || prod;
    window.produtoDetalhes = produtoCompleto;
    openModalWithSpinner('modals/produtos/detalhes.html', '../js/modals/produto-detalhes.js', 'detalhesProduto');
}

/** Histórico de estoque da peça: tudo que entrou, saiu e por quê. */
function abrirMovimentosProduto(prod) {
    if (!prod || prod.id == null) {
        showToast('Produto inválido', 'error');
        return;
    }
    const produtoCompleto = listaProdutos.find(item => item?.id === prod.id) || prod;
    window.produtoMovimentos = produtoCompleto;
    openModalWithSpinner('modals/produtos/movimentos.html', '../js/modals/produto-movimentos.js', 'movimentosProduto');
}

function abrirVisualizarProduto(prod) {
    if (!prod || prod.id == null) {
        showToast('Produto inválido', 'error');
        return;
    }
    const produtoCompleto = listaProdutos.find(item => item?.id === prod.id) || prod;
    window.produtoVisualizar = produtoCompleto;
    openModalWithSpinner('modals/produtos/visualizar.html', '../js/modals/produto-visualizar.js', 'visualizarProduto');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProdutos);
} else {
    initProdutos();
}
