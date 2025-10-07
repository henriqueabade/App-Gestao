// Lógica de interação para o módulo de Relatórios
const RELATORIOS_API_BASE_URL = 'http://localhost:3000';
const BADGE_CLASS_MAP = {
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    info: 'badge-info',
    neutral: 'badge-neutral',
    secondary: 'badge-secondary'
};

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numberFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

const AVATAR_COLORS = [
    'var(--color-primary)',
    'var(--color-violet)',
    '#0ea5e9',
    '#f97316',
    '#10b981',
    '#8b5cf6',
    '#ef4444',
    '#f59e0b'
];

const reportDataCache = new Map();
const reportDataPromises = new Map();
const reportTableRenderers = new Map();
const filterDefaults = new Map();
let relatoriosKpiManager = null;

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function formatText(value, fallback = '—') {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text ? escapeHtml(text) : fallback;
}

function formatCurrency(value, { fallback = 'R$ 0,00' } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return currencyFormatter.format(number);
}

function formatNumber(value, { fallback = '—', formatter = numberFormatter } = {}) {
    if (value === Infinity) return '∞';
    if (value === -Infinity) return '-∞';
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return formatter.format(number);
}

function formatPercent(value, { fallback = '—' } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return `${percentFormatter.format(number)}%`;
}

function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function formatDate(value) {
    if (!value) return '—';
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return '—';
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleDateString('pt-BR');
        }
        return trimmed;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('pt-BR');
}

function createBadge(label, variant = 'neutral', options = {}) {
    const { size = 'md', className = '' } = options;
    const baseClass = BADGE_CLASS_MAP[variant] || BADGE_CLASS_MAP.neutral;
    const sizeClass = size === 'sm' ? 'px-2 py-1' : 'px-3 py-1';
    const classes = `${baseClass} ${sizeClass} rounded-full text-xs font-medium${className ? ` ${className}` : ''}`.trim();
    return `<span class="${classes}">${escapeHtml(label)}</span>`;
}

function getColumnCount(table) {
    if (!table) return 1;
    const headers = table.querySelectorAll('thead th');
    return headers.length || 1;
}

function createMessageRow(table, message, options = {}) {
    const { className = 'px-6 py-6 text-center text-sm text-white/70', allowHtml = false } = options;
    const colspan = getColumnCount(table);
    const content = allowHtml ? message : escapeHtml(message);
    return `<tr><td colspan="${colspan}" class="${className}">${content}</td></tr>`;
}

function getInitials(name) {
    const value = name && String(name).trim();
    if (!value) return '?';
    const parts = value.split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const initials = parts.slice(0, 2).map(part => part[0]).join('');
    return initials.toUpperCase();
}

function getAvatarColor(name) {
    const normalized = normalizeText(name);
    if (!normalized) return AVATAR_COLORS[0];
    let hash = 0;
    for (let i = 0; i < normalized.length; i += 1) {
        hash = (hash + normalized.charCodeAt(i)) % AVATAR_COLORS.length;
    }
    return AVATAR_COLORS[hash];
}

function formatPhone(value) {
    return formatText(value, '—');
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        const error = new Error(`Request failed with status ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

async function fetchContactsData() {
    const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/clientes/contatos`);
    if (!Array.isArray(data)) return [];

    return data
        .map(contact => ({
            ...contact,
            cliente: contact?.cliente ?? contact?.nome_fantasia ?? '',
            dono: contact?.dono ?? contact?.dono_cliente ?? '',
            status_cliente: contact?.status_cliente ?? ''
        }))
        .sort((a, b) => {
            const byClient = normalizeText(a.cliente).localeCompare(normalizeText(b.cliente));
            if (byClient !== 0) return byClient;
            return normalizeText(a.nome).localeCompare(normalizeText(b.nome));
        });
}

async function loadContactsReportData() {
    if (reportDataCache.has('contatos')) {
        return reportDataCache.get('contatos');
    }

    if (!reportDataPromises.has('contatos')) {
        const promise = (async () => {
            try {
                const result = await fetchContactsData();
                const normalized = Array.isArray(result) ? result : [];
                reportDataCache.set('contatos', normalized);
                return normalized;
            } finally {
                reportDataPromises.delete('contatos');
            }
        })();
        reportDataPromises.set('contatos', promise);
    }

    return reportDataPromises.get('contatos');
}

function getRawMaterialStatus(item) {
    if (item?.infinito) {
        return { label: 'Infinito', variant: 'info' };
    }
    const quantity = Number(item?.quantidade ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { label: 'Sem estoque', variant: 'danger' };
    }
    if (quantity < 10) {
        return { label: 'Baixo', variant: 'warning' };
    }
    return { label: 'Disponível', variant: 'success' };
}

function getProductStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (['ativo', 'em linha'].includes(normalized)) return 'success';
    if (normalized.includes('reposicao') || normalized === 'pendente') return 'warning';
    if (['inativo', 'descontinuado', 'cancelado'].includes(normalized)) return 'danger';
    if (normalized === 'sob demanda') return 'neutral';
    return 'info';
}

function getClientStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (normalized === 'ativo') return 'success';
    if (['inativo', 'inadimplente', 'cancelado'].includes(normalized)) return 'danger';
    if (['negociacao', 'pendente', 'prospeccao'].includes(normalized)) return 'warning';
    if (normalized === 'prospect') return 'info';
    return 'neutral';
}

function getContactTypeVariant(type) {
    const normalized = normalizeText(type);
    if (!normalized) return 'neutral';
    if (normalized === 'fornecedor') return 'info';
    if (['parceiro', 'cliente', 'representante comercial'].includes(normalized)) return 'success';
    if (['arquiteto', 'consultor'].includes(normalized)) return 'warning';
    if (normalized === 'prospect') return 'secondary';
    return 'neutral';
}

function getQuoteStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (['aprovado', 'convertido'].includes(normalized)) return 'success';
    if (['rejeitado', 'cancelado'].includes(normalized)) return 'danger';
    if (['pendente', 'revisao'].includes(normalized)) return 'warning';
    if (normalized === 'rascunho') return 'info';
    if (normalized === 'enviado') return 'info';
    if (normalized === 'expirado') return 'secondary';
    return 'neutral';
}

function getOrderStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (['entregue', 'concluido'].includes(normalized)) return 'success';
    if (normalized === 'cancelado') return 'danger';
    if (normalized === 'enviado') return 'info';
    if (normalized === 'producao') return 'warning';
    if (normalized === 'rascunho') return 'secondary';
    return 'neutral';
}

function getUserStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (normalized === 'ativo') return 'success';
    if (['inativo', 'suspenso'].includes(normalized)) return 'danger';
    if (['aguardando', 'pendente'].includes(normalized)) return 'warning';
    if (normalized === 'offline') return 'danger';
    return 'neutral';
}

const FILTERED_EMPTY_MESSAGE = 'Nenhum registro encontrado para os filtros aplicados.';

function parseFilterNumber(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

function sanitizeDigits(value) {
    return typeof value === 'string' ? value.replace(/\D+/g, '') : '';
}

function includesNormalized(value, searchTerm) {
    if (!searchTerm) return true;
    return normalizeText(value).includes(searchTerm);
}

function getStockMinimum(item) {
    const candidates = [
        item?.estoque_minimo,
        item?.quantidade_minima,
        item?.quantidade_min,
        item?.minimo,
        item?.estoqueMinimo
    ];
    for (const candidate of candidates) {
        const number = Number(candidate);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

const REPORT_FILTERS = {
    'materia-prima': (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const processo = normalizeText(filters.processo);
        const categoria = normalizeText(filters.categoria);
        const quantidadeMin = parseFilterNumber(filters.quantidadeMin);
        const quantidadeMax = parseFilterNumber(filters.quantidadeMax);
        const precoMin = parseFilterNumber(filters.precoMin);
        const precoMax = parseFilterNumber(filters.precoMax);
        const semEstoque = Boolean(filters.semEstoque);
        const baixoEstoque = Boolean(filters.baixoEstoque);

        return list.filter(item => {
            const nome = item?.nome;
            if (searchTerm) {
                const matches = [nome, item?.categoria, item?.processo].some(value => includesNormalized(value, searchTerm));
                if (!matches) return false;
            }
            if (processo && !includesNormalized(item?.processo, processo)) return false;
            if (categoria && !includesNormalized(item?.categoria, categoria)) return false;

            const quantidade = safeNumber(item?.quantidade);
            if (semEstoque && quantidade > 0) return false;

            if (Number.isFinite(quantidadeMin) && quantidade < quantidadeMin) return false;
            if (Number.isFinite(quantidadeMax) && quantidade > quantidadeMax) return false;

            const minimo = getStockMinimum(item);
            if (baixoEstoque) {
                if (!Number.isFinite(minimo)) return false;
                if (!(quantidade > 0 && quantidade < minimo)) return false;
            }

            const preco = safeNumber(item?.preco_unitario ?? item?.precoUnitario);
            if (Number.isFinite(precoMin) && preco < precoMin) return false;
            if (Number.isFinite(precoMax) && preco > precoMax) return false;

            return true;
        });
    },
    produtos: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const colecao = normalizeText(filters.colecao);
        const status = normalizeText(filters.status);
        const quantidadeMin = parseFilterNumber(filters.quantidadeMin);
        const quantidadeMax = parseFilterNumber(filters.quantidadeMax);
        const precoMin = parseFilterNumber(filters.precoMin);
        const precoMax = parseFilterNumber(filters.precoMax);
        const margemMin = parseFilterNumber(filters.margemMin);
        const semEstoque = Boolean(filters.semEstoque);
        const destaque = Boolean(filters.destaque);

        return list.filter(produto => {
            if (searchTerm) {
                const matches = [produto?.codigo, produto?.nome, produto?.categoria]
                    .some(value => includesNormalized(value, searchTerm));
                if (!matches) return false;
            }

            if (colecao) {
                const colecaoProduto = normalizeText(produto?.colecao ?? produto?.linha ?? '');
                if (!colecaoProduto.includes(colecao)) return false;
            }

            if (status && !includesNormalized(produto?.status, status)) return false;

            const quantidade = safeNumber(produto?.quantidade_total);
            if (semEstoque && quantidade > 0) return false;
            if (Number.isFinite(quantidadeMin) && quantidade < quantidadeMin) return false;
            if (Number.isFinite(quantidadeMax) && quantidade > quantidadeMax) return false;

            const preco = safeNumber(produto?.preco_venda);
            if (Number.isFinite(precoMin) && preco < precoMin) return false;
            if (Number.isFinite(precoMax) && preco > precoMax) return false;

            if (Number.isFinite(margemMin)) {
                const margem = Number(produto?.pct_markup);
                if (!Number.isFinite(margem) || margem < margemMin) return false;
            }

            if (destaque) {
                const flag = Boolean(produto?.destaque || produto?.is_destaque || produto?.highlight);
                if (!flag) return false;
            }

            return true;
        });
    },
    clientes: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const owner = normalizeText(filters.owner);
        const status = normalizeText(filters.status);

        return list.filter(cliente => {
            if (searchTerm) {
                const matches = [
                    cliente?.nome_fantasia,
                    cliente?.cnpj,
                    cliente?.pais,
                    cliente?.estado
                ].some(value => includesNormalized(value, searchTerm));
                if (!matches) return false;
            }

            if (owner && !includesNormalized(cliente?.dono_cliente ?? cliente?.dono, owner)) return false;
            if (status && !includesNormalized(cliente?.status_cliente, status)) return false;
            return true;
        });
    },
    contatos: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const tipo = normalizeText(filters.tipo);
        const empresaFiltro = normalizeText(filters.empresa);
        const celularFiltro = sanitizeDigits(filters.celular || '');
        const telefoneFiltro = sanitizeDigits(filters.telefone || '');

        return list.filter(contato => {
            if (searchTerm) {
                const matches = [contato?.nome, contato?.cliente, contato?.empresa]
                    .some(value => includesNormalized(value, searchTerm));
                if (!matches) return false;
            }

            if (tipo && !includesNormalized(contato?.cargo, tipo)) return false;
            if (empresaFiltro && !includesNormalized(contato?.cliente ?? contato?.empresa, empresaFiltro)) return false;

            if (celularFiltro) {
                const digits = sanitizeDigits(contato?.telefone_celular ?? '');
                if (!digits.includes(celularFiltro)) return false;
            }

            if (telefoneFiltro) {
                const digits = sanitizeDigits(contato?.telefone_fixo ?? '');
                if (!digits.includes(telefoneFiltro)) return false;
            }

            return true;
        });
    },
    prospeccoes: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const status = normalizeText(filters.status);
        const responsavel = normalizeText(filters.responsavel);

        return list.filter(prospeccao => {
            if (searchTerm) {
                const matches = [prospeccao?.nome, prospeccao?.email]
                    .some(value => includesNormalized(value, searchTerm));
                if (!matches) return false;
            }
            if (status && !includesNormalized(prospeccao?.status, status)) return false;
            if (responsavel && !includesNormalized(prospeccao?.responsavel, responsavel)) return false;
            return true;
        });
    },
    orcamentos: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const status = normalizeText(filters.status);
        const cliente = normalizeText(filters.cliente);
        const codigo = normalizeText(filters.codigo);
        const valorMin = parseFilterNumber(filters.valorMin);
        const valorMax = parseFilterNumber(filters.valorMax);
        const condicaoFiltro = normalizeText(filters.condicao);

        return list.filter(orcamento => {
            if (status && !includesNormalized(orcamento?.situacao, status)) return false;
            if (cliente && !includesNormalized(orcamento?.cliente, cliente)) return false;
            if (codigo && !includesNormalized(orcamento?.numero, codigo)) return false;

            const valor = safeNumber(orcamento?.valor_final);
            if (Number.isFinite(valorMin) && valor < valorMin) return false;
            if (Number.isFinite(valorMax) && valor > valorMax) return false;

            if (condicaoFiltro) {
                const condicao = normalizeText(orcamento?.condicao_comercial ?? '');
                if (!condicao || !condicao.includes(condicaoFiltro)) return false;
            }

            return true;
        });
    },
    pedidos: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const status = normalizeText(filters.status);
        const cliente = normalizeText(filters.cliente);
        const codigo = normalizeText(filters.codigo);
        const valorMin = parseFilterNumber(filters.valorMin);
        const valorMax = parseFilterNumber(filters.valorMax);
        const condicaoFiltro = normalizeText(filters.condicao);

        return list.filter(pedido => {
            if (status && !includesNormalized(pedido?.situacao, status)) return false;
            if (cliente && !includesNormalized(pedido?.cliente, cliente)) return false;
            if (codigo && !includesNormalized(pedido?.numero, codigo)) return false;

            const valor = safeNumber(pedido?.valor_final);
            if (Number.isFinite(valorMin) && valor < valorMin) return false;
            if (Number.isFinite(valorMax) && valor > valorMax) return false;

            if (condicaoFiltro) {
                const parcelas = Number.parseInt(pedido?.parcelas, 10);
                if (condicaoFiltro === 'avista' && Number.isFinite(parcelas) && parcelas > 1) return false;
                if (condicaoFiltro === 'parcelado' && Number.isFinite(parcelas) && parcelas <= 1) return false;
            }

            return true;
        });
    },
    usuarios: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const perfil = normalizeText(filters.perfil);
        const situacao = normalizeText(filters.situacao);
        const statusFilters = ['ativo', 'inativo', 'aguardando'].filter(flag => Boolean(filters[flag]));

        return list.filter(usuario => {
            if (searchTerm) {
                const matches = [usuario?.nome, usuario?.email]
                    .some(value => includesNormalized(value, searchTerm));
                if (!matches) return false;
            }

            if (perfil && !includesNormalized(usuario?.perfil, perfil)) return false;

            if (situacao) {
                if (situacao === 'online' && !usuario?.online) return false;
                if (situacao === 'offline' && usuario?.online) return false;
                if (situacao === 'aguardando') {
                    const status = normalizeText(usuario?.status);
                    if (!status.includes('aguard')) return false;
                }
            }

            if (statusFilters.length) {
                const status = normalizeText(usuario?.status);
                const matchesStatus = statusFilters.some(filter => {
                    if (filter === 'aguardando') {
                        return status.includes('aguard');
                    }
                    return status === filter;
                });
                if (!matchesStatus) return false;
            }

            return true;
        });
    }
};

function getFilterValues(key, root) {
    if (!root) return {};
    const elements = Array.from(root.querySelectorAll(`[data-relatorios-filter="${key}"]`));
    if (!elements.length) return {};

    return elements.reduce((acc, element) => {
        const field = element.dataset.filterKey;
        if (!field) return acc;
        if (element.type === 'checkbox') {
            acc[field] = element.checked;
        } else {
            acc[field] = element.value ?? '';
        }
        return acc;
    }, {});
}

function applyReportFilters(key, data, root) {
    const handler = REPORT_FILTERS[key];
    const source = Array.isArray(data) ? data : [];
    if (!handler || !root) return source;
    try {
        const filters = getFilterValues(key, root);
        const result = handler(source, filters);
        return Array.isArray(result) ? result : source;
    } catch (error) {
        console.error(`Erro ao aplicar filtros para "${key}"`, error);
        return source;
    }
}

function setupFilterInteractions(root) {
    if (!root) return;
    const sections = Array.from(root.querySelectorAll('[data-relatorios-tab-content]'));
    sections.forEach(section => {
        const key = section.dataset.relatoriosTabContent;
        if (!key || section.dataset.filtersSetup === 'true') return;
        const inputs = Array.from(section.querySelectorAll(`[data-relatorios-filter="${key}"]`));
        if (!inputs.length) {
            section.dataset.filtersSetup = 'true';
            return;
        }

        const defaults = inputs.map(element => ({
            element,
            value: element.type === 'checkbox' ? element.checked : element.value
        }));
        filterDefaults.set(key, defaults);

        const update = () => {
            const render = reportTableRenderers.get(key);
            if (typeof render === 'function') {
                render();
            }
        };

        inputs.forEach(element => {
            const eventName = element.tagName === 'SELECT' || element.type === 'checkbox' || element.type === 'range'
                ? 'change'
                : 'input';
            element.addEventListener(eventName, update);
        });

        const applyBtn = section.querySelector(`[data-relatorios-apply="${key}"]`);
        if (applyBtn) {
            applyBtn.addEventListener('click', event => {
                event.preventDefault();
                update();
            });
        }

        const resetBtn = section.querySelector(`[data-relatorios-reset="${key}"]`);
        if (resetBtn) {
            resetBtn.addEventListener('click', event => {
                event.preventDefault();
                const defaultsForKey = filterDefaults.get(key) || [];
                defaultsForKey.forEach(({ element, value }) => {
                    if (element.type === 'checkbox') {
                        element.checked = Boolean(value);
                    } else {
                        element.value = value;
                    }
                    if (element.type === 'range') {
                        element.dispatchEvent(new Event('input'));
                    }
                });
                update();
            });
        }

        section.dataset.filtersSetup = 'true';
    });
}

async function getReportData(key, config) {
    if (reportDataCache.has(key)) {
        return reportDataCache.get(key);
    }

    if (reportDataPromises.has(key)) {
        try {
            const pending = await reportDataPromises.get(key);
            return Array.isArray(pending) ? pending : [];
        } catch (error) {
            console.error(`Erro ao reutilizar promessa de relatório "${key}"`, error);
            throw error;
        }
    }

    const fetchPromise = (async () => {
        const result = await config.fetchData();
        const normalized = Array.isArray(result) ? result : [];
        reportDataCache.set(key, normalized);
        return normalized;
    })();

    reportDataPromises.set(key, fetchPromise);

    try {
        const data = await fetchPromise;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        reportDataCache.delete(key);
        throw error;
    } finally {
        reportDataPromises.delete(key);
    }
}

function createKpiItem({ value, label, icon = 'fas fa-chart-line', iconBg = 'bg-white/10', iconColor = 'text-white/80' }) {
    return { value, label, icon, iconBg, iconColor };
}

function renderKpiCards(kpis) {
    if (!Array.isArray(kpis) || !kpis.length) {
        return createKpiPlaceholder('Nenhum indicador disponível.');
    }

    return kpis
        .map(item => {
            const value = item?.value ?? '—';
            const label = item?.label ?? '';
            const icon = item?.icon ?? 'fas fa-chart-line';
            const iconBg = item?.iconBg ?? 'bg-white/10';
            const iconColor = item?.iconColor ?? 'text-white';
            return `
                <article class="relatorios-kpi-card animate-fade-in-up">
                    <div class="flex items-center gap-4">
                        <div class="relatorios-kpi-icon ${iconBg}">
                            <i class="${icon} ${iconColor}"></i>
                        </div>
                        <div>
                            <p class="relatorios-kpi-value">${escapeHtml(String(value))}</p>
                            <p class="relatorios-kpi-label">${escapeHtml(String(label))}</p>
                        </div>
                    </div>
                </article>
            `;
        })
        .join('');
}

function createKpiPlaceholder(message) {
    return `<div class="relatorios-kpi-placeholder text-sm text-white/70">${escapeHtml(String(message))}</div>`;
}

function createKpiLoadingContent() {
    return Array.from({ length: 4 })
        .map(() => `
            <article class="relatorios-kpi-card">
                <div class="flex items-center gap-4 animate-pulse">
                    <div class="relatorios-kpi-icon bg-white/10"></div>
                    <div class="flex-1 space-y-2">
                        <div class="h-4 bg-white/10 rounded w-24"></div>
                        <div class="h-3 bg-white/5 rounded w-32"></div>
                    </div>
                </div>
            </article>
        `)
        .join('');
}

function createKpiManager(root, options = {}) {
    const { initialTab = null } = options;
    const sections = new Map();

    root.querySelectorAll('[data-relatorios-kpi]').forEach(section => {
        const key = section.dataset.relatoriosKpi;
        if (!key) return;
        sections.set(key, section);
        section.innerHTML = '';
    });

    let activeKey = null;

    if (initialTab && sections.has(initialTab)) {
        activeKey = initialTab;
        sections.get(initialTab).innerHTML = createKpiLoadingContent();
    }

    const clearInactiveSections = () => {
        sections.forEach((section, key) => {
            if (key !== activeKey && section.innerHTML) {
                section.innerHTML = '';
            }
        });
    };

    const setContent = (key, html) => {
        const section = sections.get(key);
        if (!section) return;
        if (activeKey !== key) {
            if (section.innerHTML) {
                section.innerHTML = '';
            }
            return;
        }
        section.innerHTML = html;
    };

    return {
        setActiveKey(key) {
            if (!key || !sections.has(key)) {
                activeKey = null;
                sections.forEach(section => {
                    if (section.innerHTML) {
                        section.innerHTML = '';
                    }
                });
                return;
            }
            const previousKey = activeKey;
            activeKey = key;
            if (key !== previousKey) {
                const currentSection = sections.get(key);
                if (currentSection && currentSection.innerHTML) {
                    currentSection.innerHTML = '';
                }
            }
            clearInactiveSections();
        },
        setLoading(key) {
            setContent(key, createKpiLoadingContent());
        },
        setError(key, message) {
            setContent(key, createKpiPlaceholder(message || 'Não foi possível carregar os indicadores.'));
        },
        setUnavailable(key) {
            setContent(key, createKpiPlaceholder('Indicadores não disponíveis para esta categoria.'));
        },
        setData(key, data, config) {
            if (!config?.computeKpis) {
                setContent(key, createKpiPlaceholder('Indicadores não disponíveis para esta categoria.'));
                return;
            }

            if (activeKey !== key) {
                setContent(key, '');
                return;
            }

            try {
                const kpis = config.computeKpis(Array.isArray(data) ? data : []);
                if (!Array.isArray(kpis) || !kpis.length) {
                    setContent(key, createKpiPlaceholder('Nenhum indicador disponível.'));
                    return;
                }
                setContent(key, renderKpiCards(kpis));
            } catch (error) {
                console.error(`Erro ao calcular indicadores para "${key}"`, error);
                setContent(key, createKpiPlaceholder('Não foi possível calcular os indicadores.'));
            }
        }
    };
}

function computeMateriaPrimaKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const finite = list.filter(item => !item?.infinito);
    const critical = finite.filter(item => {
        const qty = safeNumber(item?.quantidade);
        return qty > 0 && qty < 10;
    }).length;
    const outOfStock = finite.filter(item => safeNumber(item?.quantidade) <= 0).length;
    const totalValue = finite.reduce((sum, item) => sum + safeNumber(item?.quantidade) * safeNumber(item?.preco_unitario), 0);

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Materiais cadastrados',
            icon: 'fas fa-boxes-stacked',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatNumber(critical, { fallback: '0' }),
            label: 'Itens em estoque crítico',
            icon: 'fas fa-exclamation-triangle',
            iconBg: 'bg-rose-500/20',
            iconColor: 'text-rose-300'
        }),
        createKpiItem({
            value: formatNumber(outOfStock, { fallback: '0' }),
            label: 'Itens sem estoque',
            icon: 'fas fa-ban',
            iconBg: 'bg-gray-500/20',
            iconColor: 'text-gray-200'
        }),
        createKpiItem({
            value: formatCurrency(totalValue),
            label: 'Valor total em estoque',
            icon: 'fas fa-coins',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        })
    ];
}

function computeProdutosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const activeStatuses = new Set(['em linha', 'ativo', 'disponivel', 'disponível']);
    const active = list.filter(produto => activeStatuses.has(normalizeText(produto?.status))).length;
    const totalStock = list.reduce((sum, produto) => sum + safeNumber(produto?.quantidade_total), 0);
    const totalValue = list.reduce((sum, produto) => sum + safeNumber(produto?.quantidade_total) * safeNumber(produto?.preco_venda), 0);

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Produtos cadastrados',
            icon: 'fas fa-boxes-stacked',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatNumber(active, { fallback: '0' }),
            label: 'Ativos em linha',
            icon: 'fas fa-check-circle',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(totalStock, { fallback: '0' }),
            label: 'Estoque disponível',
            icon: 'fas fa-layer-group',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatCurrency(totalValue),
            label: 'Valor potencial',
            icon: 'fas fa-coins',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        })
    ];
}

function computeClientesKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const active = list.filter(cliente => normalizeText(cliente?.status_cliente) === 'ativo').length;
    const inadimplentes = list.filter(cliente => normalizeText(cliente?.status_cliente).includes('inadimpl')).length;
    const owners = new Set();
    list.forEach(cliente => {
        const owner = (cliente?.dono_cliente || '').trim();
        if (owner) owners.add(owner);
    });

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Clientes cadastrados',
            icon: 'fas fa-address-book',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(active, { fallback: '0' }),
            label: 'Clientes ativos',
            icon: 'fas fa-user-check',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(inadimplentes, { fallback: '0' }),
            label: 'Clientes inadimplentes',
            icon: 'fas fa-exclamation-circle',
            iconBg: 'bg-rose-500/20',
            iconColor: 'text-rose-300'
        }),
        createKpiItem({
            value: formatNumber(owners.size, { fallback: '0' }),
            label: 'Responsáveis únicos',
            icon: 'fas fa-user-tie',
            iconBg: 'bg-purple-500/20',
            iconColor: 'text-purple-300'
        })
    ];
}

function computeContatosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const withEmail = list.filter(contato => Boolean((contato?.email || '').trim())).length;
    const withPhone = list.filter(contato => {
        return Boolean((contato?.telefone_fixo || '').trim()) || Boolean((contato?.telefone_celular || '').trim());
    }).length;
    const companies = new Set();
    list.forEach(contato => {
        const company = (contato?.cliente || '').trim();
        if (company) companies.add(company);
    });

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Contatos cadastrados',
            icon: 'fas fa-id-badge',
            iconBg: 'bg-cyan-500/20',
            iconColor: 'text-cyan-300'
        }),
        createKpiItem({
            value: formatNumber(withEmail, { fallback: '0' }),
            label: 'Contatos com e-mail',
            icon: 'fas fa-envelope',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatNumber(withPhone, { fallback: '0' }),
            label: 'Contatos com telefone',
            icon: 'fas fa-phone',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(companies.size, { fallback: '0' }),
            label: 'Empresas atendidas',
            icon: 'fas fa-building',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        })
    ];
}

function computeProspeccoesKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const withOwner = list.filter(prospeccao => Boolean((prospeccao?.responsavel || '').trim())).length;
    const withContact = list.filter(prospeccao => {
        const email = (prospeccao?.email || '').trim();
        const phone = (prospeccao?.telefone || prospeccao?.celular || '').trim();
        return Boolean(email) || Boolean(phone);
    }).length;
    const statuses = new Set();
    list.forEach(prospeccao => {
        const status = normalizeText(prospeccao?.status);
        if (status) statuses.add(status);
    });

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Leads em aberto',
            icon: 'fas fa-bullseye',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(withOwner, { fallback: '0' }),
            label: 'Leads com responsável',
            icon: 'fas fa-user-tie',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(withContact, { fallback: '0' }),
            label: 'Leads com contato principal',
            icon: 'fas fa-address-card',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatNumber(statuses.size, { fallback: '0' }),
            label: 'Status distintos',
            icon: 'fas fa-chart-pie',
            iconBg: 'bg-purple-500/20',
            iconColor: 'text-purple-300'
        })
    ];
}

function computeOrcamentosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const totalValue = list.reduce((sum, orcamento) => sum + safeNumber(orcamento?.valor_final), 0);
    const approved = list.filter(orcamento => {
        const status = normalizeText(orcamento?.situacao);
        return status.includes('aprov') || status.includes('convert') || status.includes('aceit');
    }).length;
    const approvalRate = total > 0 ? (approved / total) * 100 : 0;

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Orçamentos emitidos',
            icon: 'fas fa-file-invoice',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(approved, { fallback: '0' }),
            label: 'Orçamentos aprovados',
            icon: 'fas fa-file-signature',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatCurrency(totalValue),
            label: 'Valor total orçado',
            icon: 'fas fa-coins',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        }),
        createKpiItem({
            value: formatPercent(approvalRate, { fallback: '0%' }),
            label: 'Taxa de aprovação',
            icon: 'fas fa-percentage',
            iconBg: 'bg-purple-500/20',
            iconColor: 'text-purple-300'
        })
    ];
}

function computePedidosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const totalValue = list.reduce((sum, pedido) => sum + safeNumber(pedido?.valor_final), 0);
    const deliveredStatuses = new Set(['entregue', 'concluido', 'concluído', 'faturado', 'finalizado']);
    const productionStatuses = new Set(['producao', 'produção', 'em producao', 'em produção']);
    const delivered = list.filter(pedido => deliveredStatuses.has(normalizeText(pedido?.situacao))).length;
    const inProduction = list.filter(pedido => productionStatuses.has(normalizeText(pedido?.situacao))).length;

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Pedidos emitidos',
            icon: 'fas fa-receipt',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(delivered, { fallback: '0' }),
            label: 'Pedidos entregues',
            icon: 'fas fa-truck',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(inProduction, { fallback: '0' }),
            label: 'Pedidos em produção',
            icon: 'fas fa-industry',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatCurrency(totalValue),
            label: 'Valor total faturado',
            icon: 'fas fa-coins',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        })
    ];
}

function computeUsuariosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const active = list.filter(usuario => normalizeText(usuario?.status) === 'ativo').length;
    const online = list.filter(usuario => Boolean(usuario?.online)).length;
    const profiles = new Set();
    list.forEach(usuario => {
        const perfil = (usuario?.perfil || '').trim();
        if (perfil) profiles.add(perfil);
    });

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Usuários cadastrados',
            icon: 'fas fa-users',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(active, { fallback: '0' }),
            label: 'Usuários ativos',
            icon: 'fas fa-user-check',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(online, { fallback: '0' }),
            label: 'Usuários online',
            icon: 'fas fa-signal',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        }),
        createKpiItem({
            value: formatNumber(profiles.size, { fallback: '0' }),
            label: 'Perfis diferentes',
            icon: 'fas fa-user-shield',
            iconBg: 'bg-purple-500/20',
            iconColor: 'text-purple-300'
        })
    ];
}

const REPORT_CONFIGS = {};

REPORT_CONFIGS['materia-prima'] = {
    loadingMessage: 'Carregando matérias-primas...',
    emptyMessage: 'Nenhuma matéria-prima encontrada.',
    errorMessage: 'Não foi possível carregar as matérias-primas.',
    computeKpis: computeMateriaPrimaKpis,
    async fetchData() {
        if (!window.electronAPI?.listarMateriaPrima) {
            throw new Error('Integração com matérias-primas indisponível.');
        }
        const data = await window.electronAPI.listarMateriaPrima('');
        return Array.isArray(data) ? data : [];
    },
    renderRow(item) {
        const nome = formatText(item?.nome, '—');
        const categoria = formatText(item?.categoria, '—');
        const unidade = formatText(item?.unidade, '—');
        const quantidade = item?.infinito ? '∞' : formatNumber(item?.quantidade, { fallback: '0' });
        const preco = item?.infinito ? '—' : formatCurrency(item?.preco_unitario);
        const processo = formatText(item?.processo, '—');
        const status = getRawMaterialStatus(item);
        const statusBadge = createBadge(status.label, status.variant, { size: 'sm' });
        return `
            <tr class="transition-colors duration-150">
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm font-medium text-white">${nome}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${categoria}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${unidade}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${quantidade}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${preco}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${processo}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.produtos = {
    loadingMessage: 'Carregando produtos...',
    emptyMessage: 'Nenhum produto encontrado.',
    errorMessage: 'Não foi possível carregar os produtos.',
    computeKpis: computeProdutosKpis,
    async fetchData() {
        try {
            const data = await (window.electronAPI?.listarProdutos?.() ?? []);
            if (!Array.isArray(data)) {
                console.warn('KPI manager (produtos): dados inválidos recebidos, usando lista vazia.', data);
                return [];
            }
            return data;
        } catch (error) {
            console.error('KPI manager (produtos): erro ao carregar produtos.', error);
            return [];
        }
    },
    renderRow(produto) {
        const codigo = formatText(produto?.codigo, '—');
        const nome = formatText(produto?.nome, '—');
        const categoria = formatText(produto?.categoria, '—');
        const precoVenda = formatCurrency(produto?.preco_venda);
        const margem = Number.isFinite(Number(produto?.pct_markup))
            ? formatPercent(Number(produto.pct_markup))
            : '—';
        const quantidade = formatNumber(produto?.quantidade_total, { fallback: '0' });
        const statusLabel = produto?.status ? produto.status : '—';
        const statusBadge = createBadge(statusLabel, getProductStatusVariant(produto?.status), { size: 'sm' });
        return `
            <tr class="transition-colors duration-150">
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm font-medium text-white">${codigo}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-white">${nome}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${categoria}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${precoVenda}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${margem}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${quantidade}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.clientes = {
    loadingMessage: 'Carregando clientes...',
    emptyMessage: 'Nenhum cliente encontrado.',
    errorMessage: 'Não foi possível carregar os clientes.',
    computeKpis: computeClientesKpis,
    async fetchData() {
        const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/clientes/lista`);
        if (!Array.isArray(data)) return [];
        return data.sort((a, b) => normalizeText(a?.nome_fantasia).localeCompare(normalizeText(b?.nome_fantasia)));
    },
    renderRow(cliente) {
        const nome = formatText(cliente?.nome_fantasia, '—');
        const cnpj = formatText(cliente?.cnpj, '—');
        const pais = formatText(cliente?.pais, '—');
        const estado = formatText(cliente?.estado, '—');
        const dono = formatText(cliente?.dono_cliente, '—');
        const statusLabel = cliente?.status_cliente ? cliente.status_cliente : '—';
        const statusBadge = createBadge(statusLabel, getClientStatusVariant(cliente?.status_cliente), { size: 'sm' });

        return `
            <tr class="transition-colors duration-150">
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm font-medium text-white">${nome}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${cnpj}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${pais}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${estado}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${dono}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.contatos = {
    loadingMessage: 'Carregando contatos...',
    emptyMessage: 'Nenhum contato encontrado.',
    errorMessage: 'Não foi possível carregar os contatos.',
    computeKpis: computeContatosKpis,
    async fetchData() {
        const data = await loadContactsReportData();
        return Array.isArray(data) ? data : [];
    },
    renderRow(contato) {
        const nome = formatText(contato?.nome, '—');
        const empresa = formatText(contato?.cliente, '—');
        const celular = formatPhone(contato?.telefone_celular);
        const telefone = formatPhone(contato?.telefone_fixo);
        const email = formatText(contato?.email, '—');
        const tipo = formatText(contato?.cargo, '—');
        const initials = getInitials(contato?.nome);
        const avatarColor = getAvatarColor(contato?.nome);
        const tipoBadge = createBadge(tipo !== '—' ? tipo : 'Contato', getContactTypeVariant(tipo), { size: 'sm' });

        return `
            <tr class="transition-colors duration-150">
                <td class="px-6 py-4 text-left">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white" style="background:${avatarColor};">${initials}</div>
                        <div>
                            <p class="text-sm font-medium text-white whitespace-normal break-words">${nome}</p>
                            <p class="text-xs text-white/70 whitespace-normal break-words">${empresa}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm">${tipoBadge}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${empresa}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${celular}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${telefone}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${email}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.prospeccoes = {
    loadingMessage: 'Carregando prospecções...',
    emptyMessage: 'Nenhuma prospecção encontrada.',
    errorMessage: 'Não foi possível carregar as prospecções.',
    computeKpis: computeProspeccoesKpis,
    async fetchData() {
        const contatos = await loadContactsReportData();
        const contactMap = new Map();
        (Array.isArray(contatos) ? contatos : []).forEach(contato => {
            const clientId = contato?.id_cliente || contato?.clienteId;
            if (clientId && !contactMap.has(clientId)) {
                contactMap.set(clientId, contato);
            }
        });

        const leadStatuses = new Set([
            'prospect',
            'prospeccao',
            'prospecção',
            'negociacao',
            'negociação',
            'lead',
            'pendente',
            'contato inicial'
        ]);

        const leads = Array.from(contactMap.values())
            .filter(contato => leadStatuses.has(normalizeText(contato?.status_cliente)))
            .map(contato => {
                const clientId = contato?.id_cliente || contato?.clienteId || contato?.id;
                const nomeFantasia = contato?.cliente || contato?.nome_fantasia || '';
                return {
                    id: clientId,
                    nome: nomeFantasia,
                    email: contato?.email || '',
                    status: contato?.status_cliente || '',
                    responsavel: contato?.dono || contato?.dono_cliente || '',
                    telefone: contato?.telefone_fixo || '',
                    celular: contato?.telefone_celular || '',
                    empresa: nomeFantasia
                };
            })
            .sort((a, b) => normalizeText(a.nome).localeCompare(normalizeText(b.nome)));

        return leads;
    },
    renderRow(prospeccao) {
        const nome = formatText(prospeccao?.nome, '—');
        const email = formatText(prospeccao?.email, '—');
        const responsavel = formatText(prospeccao?.responsavel, '—');
        const statusLabel = prospeccao?.status ? prospeccao.status : '—';
        const statusBadge = createBadge(statusLabel, getClientStatusVariant(prospeccao?.status), { size: 'sm' });

        return `
            <tr class="transition-colors duration-150">
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm font-medium text-white">${nome}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${email}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${responsavel}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.orcamentos = {
    loadingMessage: 'Carregando orçamentos...',
    emptyMessage: 'Nenhum orçamento encontrado.',
    errorMessage: 'Não foi possível carregar os orçamentos.',
    computeKpis: computeOrcamentosKpis,
    async fetchData() {
        const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/orcamentos`);
        if (!Array.isArray(data)) return [];
        return data.sort((a, b) => normalizeText(a?.numero).localeCompare(normalizeText(b?.numero)));
    },
    renderRow(orcamento) {
        const codigo = formatText(orcamento?.numero, '—');
        const cliente = formatText(orcamento?.cliente, '—');
        const dataEmissao = formatDate(orcamento?.data_emissao);
        const valor = formatCurrency(orcamento?.valor_final);
        const parcelas = Number.parseInt(orcamento?.parcelas, 10);
        const condicao = Number.isFinite(parcelas) && parcelas > 1 ? `${parcelas}x` : 'À vista';
        const statusLabel = orcamento?.situacao ? orcamento.situacao : '—';
        const statusBadge = createBadge(statusLabel, getQuoteStatusVariant(orcamento?.situacao), { size: 'sm' });
        return `
            <tr class="transition-colors duration-150">
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm font-medium text-white">${codigo}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${cliente}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${dataEmissao}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${valor}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${condicao}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.pedidos = {
    loadingMessage: 'Carregando pedidos...',
    emptyMessage: 'Nenhum pedido encontrado.',
    errorMessage: 'Não foi possível carregar os pedidos.',
    computeKpis: computePedidosKpis,
    async fetchData() {
        const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/pedidos`);
        if (!Array.isArray(data)) return [];
        return data.sort((a, b) => normalizeText(a?.numero).localeCompare(normalizeText(b?.numero)));
    },
    renderRow(pedido) {
        const codigo = formatText(pedido?.numero, '—');
        const cliente = formatText(pedido?.cliente, '—');
        const dataEmissao = formatDate(pedido?.data_emissao);
        const valor = formatCurrency(pedido?.valor_final);
        const parcelas = Number.parseInt(pedido?.parcelas, 10);
        const condicao = Number.isFinite(parcelas) && parcelas > 1 ? `${parcelas}x` : 'À vista';
        const statusLabel = pedido?.situacao ? pedido.situacao : '—';
        const statusBadge = createBadge(statusLabel, getOrderStatusVariant(pedido?.situacao), { size: 'sm' });
        return `
            <tr class="transition-colors duration-150">
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm font-medium text-white">${codigo}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${cliente}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${dataEmissao}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${valor}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${condicao}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.usuarios = {
    loadingMessage: 'Carregando usuários...',
    emptyMessage: 'Nenhum usuário encontrado.',
    errorMessage: 'Não foi possível carregar os usuários.',
    computeKpis: computeUsuariosKpis,
    async fetchData() {
        const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/usuarios/lista`);
        if (!Array.isArray(data)) return [];
        return data.sort((a, b) => normalizeText(a?.nome).localeCompare(normalizeText(b?.nome)));
    },
    renderRow(usuario) {
        const nome = formatText(usuario?.nome, '—');
        const email = formatText(usuario?.email, '—');
        const perfil = formatText(usuario?.perfil, '—');
        const statusLabel = usuario?.status ? usuario.status : '—';
        const statusBadge = createBadge(statusLabel, getUserStatusVariant(usuario?.status), { size: 'sm' });
        const onlineBadge = createBadge(usuario?.online ? 'Online' : 'Offline', usuario?.online ? 'success' : 'danger', { size: 'sm' });
        const ultimoLogin = usuario?.ultimoLoginEm
            ? formatDate(usuario.ultimoLoginEm)
            : (usuario?.ultimaAtividadeEm ? formatDate(usuario.ultimaAtividadeEm) : '—');
        const initials = getInitials(usuario?.nome);
        const avatarColor = getAvatarColor(usuario?.nome);

        return `
            <tr class="transition-colors duration-150">
                <td class="px-6 py-4 text-left">
                    <div class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white" style="background:${avatarColor};">${initials}</div>
                </td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm font-medium text-white">${nome}</td>
                <td class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${email}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${perfil}</td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm">
                    <div class="flex flex-col gap-1">
                        <span>${onlineBadge}</span>
                        <span class="text-xs text-white/60">Último login: ${ultimoLogin}</span>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

function initRelatoriosModule() {
    const container = document.querySelector('.relatorios-module');
    if (!container) {
        relatoriosKpiManager = null;
        return;
    }

    // Garante que o body esteja liberado caso algum modal anterior tenha alterado o overflow
    document.body.style.overflow = '';

    applyEntranceAnimations(container);

    const initialTabButton = container.querySelector('[data-relatorios-tab].tab-active')
        || container.querySelector('[data-relatorios-tab]');
    const initialTabKey = initialTabButton?.dataset?.relatoriosTab || null;

    relatoriosKpiManager = createKpiManager(container, { initialTab: initialTabKey });
    const loadTableForTab = setupReportTables(container);

    setupCategoryTabs(container, {
        onTabChange: tab => {
            if (loadTableForTab) {
                loadTableForTab(tab);
            }
        }
    });
    setupResultTabs(container);
    setupDropdowns(container);
    setupModals(container);
    setupShare(container);
    setupGeoFilters(container);
    setupFilterInteractions(container);
    setupDateRangeFilters(container);

    if (initialTabKey && loadTableForTab) {
        loadTableForTab(initialTabKey);
    }
}

function setupCategoryTabs(root, options = {}) {
    const { onTabChange } = options;
    const tabButtons = Array.from(root.querySelectorAll('[data-relatorios-tab]'));
    if (!tabButtons.length) return;

    const filterSections = Array.from(root.querySelectorAll('[data-relatorios-tab-content]'));
    const kpiSections = Array.from(root.querySelectorAll('[data-relatorios-kpi]'));

    let activeTab = null;

    const applyVisibility = target => {
        filterSections.forEach(section => {
            section.classList.toggle('hidden', section.dataset.relatoriosTabContent !== target);
        });

        kpiSections.forEach(section => {
            section.classList.toggle('hidden', section.dataset.relatoriosKpi !== target);
        });
    };

    const updateButtonsState = activeButton => {
        tabButtons.forEach(btn => {
            const isActive = btn === activeButton;
            btn.classList.toggle('tab-active', isActive);
            btn.classList.toggle('tab-inactive', !isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    };

    const activateTab = (button, { emitEvent = true } = {}) => {
        const target = button?.dataset?.relatoriosTab;
        if (!target || target === activeTab) return;

        activeTab = target;
        updateButtonsState(button);
        applyVisibility(target);
        if (relatoriosKpiManager?.setActiveKey) {
            relatoriosKpiManager.setActiveKey(target);
        }

        if (emitEvent && typeof onTabChange === 'function') {
            onTabChange(target, button);
        }
    };

    const initialButton = tabButtons.find(btn => btn.classList.contains('tab-active')) || tabButtons[0];
    if (initialButton) {
        activeTab = initialButton.dataset?.relatoriosTab || null;
        updateButtonsState(initialButton);
        applyVisibility(activeTab);
        if (relatoriosKpiManager?.setActiveKey && activeTab) {
            relatoriosKpiManager.setActiveKey(activeTab);
        }
    }

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (button.classList.contains('tab-active')) return;
            activateTab(button);
        });
    });

    return {
        getActiveTab: () => activeTab,
        activateTab: (target, options = {}) => {
            const button = tabButtons.find(btn => btn.dataset?.relatoriosTab === target);
            if (button) {
                activateTab(button, options);
            }
        }
    };
}

function setupReportTables(root) {
    const container = root.querySelector('#relatoriosTableContainer');
    if (!container) return null;

    const templates = new Map();
    root.querySelectorAll('template[data-relatorios-template]').forEach(template => {
        const key = template.dataset.relatoriosTemplate;
        if (key) {
            templates.set(key, template);
        }
    });

    const fallback = root.querySelector('#relatoriosTableFallback');

    const loadTable = async key => {
        if (!key || container.dataset.currentTab === key) return;

        container.dataset.currentTab = key;
        container.innerHTML = '';

        const template = templates.get(key);

        if (template) {
            const fragment = template.content.cloneNode(true);
            container.appendChild(fragment);
            requestAnimationFrame(() => {
                const wrapper = container.querySelector('.relatorios-table-wrapper');
                if (wrapper) {
                    wrapper.classList.add('relatorios-table-enter');
                    wrapper.addEventListener('animationend', () => {
                        wrapper.classList.remove('relatorios-table-enter');
                    }, { once: true });
                }
            });
            populateReportTable(key, container).catch(error => {
                console.error(`Erro ao carregar tabela do relatório "${key}"`, error);
            });
        } else if (fallback) {
            container.appendChild(fallback.content.cloneNode(true));
        } else {
            container.innerHTML = '<p class="text-sm text-white/70">Tabela não disponível para esta categoria.</p>';
        }
    };

    return loadTable;
}

async function populateReportTable(key, container) {
    const config = REPORT_CONFIGS[key];
    if (!config) {
        container.innerHTML = '<p class="text-sm text-white/70">Configuração de relatório não encontrada.</p>';
        if (relatoriosKpiManager) {
            relatoriosKpiManager.setUnavailable(key);
        }
        return;
    }

    const tableRoot = container.querySelector('[data-relatorios-table-root]') || container;
    const table = tableRoot.querySelector('table');
    const tbody = tableRoot.querySelector('[data-relatorios-body]');

    if (!table || !tbody) {
        console.warn(`Estrutura de tabela ausente para o relatório "${key}".`);
        if (relatoriosKpiManager) {
            relatoriosKpiManager.setUnavailable(key);
        }
        return;
    }

    const showMessage = message => {
        tbody.innerHTML = createMessageRow(table, message);
    };

    showMessage(config.loadingMessage || 'Carregando dados...');
    if (relatoriosKpiManager) {
        relatoriosKpiManager.setLoading(key);
    }

    try {
        const data = await getReportData(key, config);
        if (relatoriosKpiManager) {
            relatoriosKpiManager.setData(key, data, config);
        }
        if (container.dataset.currentTab !== key) {
            return;
        }

        const moduleRoot = container.closest('.relatorios-module');

        if (!Array.isArray(data) || data.length === 0) {
            const renderEmpty = () => {
                showMessage(config.emptyMessage || 'Nenhum registro encontrado.');
            };
            reportTableRenderers.set(key, renderEmpty);
            renderEmpty();
            return;
        }

        const render = () => {
            const filtered = applyReportFilters(key, data, moduleRoot);
            if (!Array.isArray(filtered) || filtered.length === 0) {
                tbody.innerHTML = createMessageRow(table, config.filteredEmptyMessage || FILTERED_EMPTY_MESSAGE);
                return;
            }

            const rows = filtered
                .map(item => {
                    try {
                        return config.renderRow(item);
                    } catch (error) {
                        console.error(`Erro ao renderizar linha do relatório "${key}"`, error, item);
                        return '';
                    }
                })
                .filter(Boolean)
                .join('');

            if (!rows) {
                tbody.innerHTML = createMessageRow(table, config.filteredEmptyMessage || config.emptyMessage || FILTERED_EMPTY_MESSAGE);
                return;
            }

            tbody.innerHTML = rows;
        };

        render();
        reportTableRenderers.set(key, render);
    } catch (error) {
        console.error(`Erro ao popular relatório "${key}"`, error);
        if (relatoriosKpiManager) {
            relatoriosKpiManager.setError(key, config.errorMessage || 'Não foi possível carregar os dados.');
        }
        if (container.dataset.currentTab !== key) {
            return;
        }
        showMessage(config.errorMessage || 'Não foi possível carregar os dados.');
        reportTableRenderers.delete(key);
    }
}

function setupResultTabs(root) {
    const tabButtons = Array.from(root.querySelectorAll('[data-relatorios-result]'));
    if (!tabButtons.length) return;

    const views = {
        table: root.querySelector('#relatoriosTableView'),
        charts: root.querySelector('#relatoriosChartsView'),
        detail: root.querySelector('#relatoriosDetailView')
    };

    const activateView = target => {
        Object.entries(views).forEach(([key, view]) => {
            if (!view) return;
            const isTarget = key === target;
            view.classList.toggle('hidden', !isTarget);
            if (isTarget) {
                animateResultView(view);
            }
        });
    };

    activateView('table');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const target = button.dataset.relatoriosResult;
            if (!target || !views[target] || button.classList.contains('tab-active')) return;

            tabButtons.forEach(btn => {
                btn.classList.remove('tab-active');
                btn.classList.add('tab-inactive');
            });

            button.classList.add('tab-active');
            button.classList.remove('tab-inactive');

            activateView(target);
        });
    });
}

function setupDropdowns(root) {
    const configs = [
        {
            button: root.querySelector('#relatoriosLoadTemplateBtn'),
            dropdown: root.querySelector('#relatoriosTemplateDropdown')
        },
        {
            button: root.querySelector('#relatoriosExportBtn'),
            dropdown: root.querySelector('#relatoriosExportDropdown')
        }
    ].filter(({ button, dropdown }) => button && dropdown);

    const closeDropdowns = () => {
        configs.forEach(({ dropdown }) => dropdown.classList.remove('visible'));
    };

    configs.forEach(({ button, dropdown }) => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const isOpen = dropdown.classList.contains('visible');
            closeDropdowns();
            if (!isOpen) {
                dropdown.classList.add('visible');
            }
        });

        dropdown.addEventListener('click', event => {
            event.stopPropagation();
        });
    });

    if (window.__relatoriosDropdownHandler) {
        document.removeEventListener('click', window.__relatoriosDropdownHandler);
    }

    const handleDocumentClick = () => closeDropdowns();
    document.addEventListener('click', handleDocumentClick);
    window.__relatoriosDropdownHandler = handleDocumentClick;
}

function setupModals(root) {
    const modals = [
        {
            openButton: root.querySelector('#relatoriosSaveTemplateBtn'),
            modal: root.querySelector('#relatoriosSaveTemplateModal'),
            closeButton: root.querySelector('#relatoriosCancelSaveTemplate')
        },
        {
            openButton: root.querySelector('#relatoriosScheduleBtn'),
            modal: root.querySelector('#relatoriosScheduleModal'),
            closeButton: root.querySelector('#relatoriosCancelSchedule')
        }
    ];

    const openModal = modal => {
        if (!modal) return;
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    };

    const closeModal = modal => {
        if (!modal) return;
        modal.classList.add('hidden');
        const anyOpen = root.querySelector('.relatorios-modal:not(.hidden)');
        if (!anyOpen) {
            document.body.style.overflow = '';
        }
    };

    modals.forEach(({ openButton, modal, closeButton }) => {
        if (!openButton || !modal || !closeButton) return;

        openButton.addEventListener('click', () => openModal(modal));
        closeButton.addEventListener('click', () => closeModal(modal));

        modal.addEventListener('click', event => {
            if (event.target && event.target.classList.contains('relatorios-modal-backdrop')) {
                closeModal(modal);
            }
        });
    });
}

function setupShare(root) {
    const shareBtn = root.querySelector('#relatoriosShareBtn');
    if (!shareBtn || !navigator.clipboard) return;

    shareBtn.addEventListener('click', async () => {
        const label = shareBtn.querySelector('.relatorios-share-label');
        const originalText = label ? label.textContent.trim() : shareBtn.textContent.trim();
        try {
            await navigator.clipboard.writeText(window.location.href);
            if (label) {
                label.textContent = 'Link copiado!';
            } else {
                shareBtn.textContent = 'Link copiado!';
            }
            shareBtn.classList.add('btn-success');
            setTimeout(() => {
                if (label) {
                    label.textContent = originalText;
                } else {
                    shareBtn.textContent = originalText;
                }
                shareBtn.classList.remove('btn-success');
            }, 2000);
        } catch (error) {
            console.error('Falha ao copiar link de compartilhamento', error);
        }
    });
}

function applyEntranceAnimations(root) {
    const animatedElements = Array.from(root.querySelectorAll('.animate-fade-in-up'));
    animatedElements.forEach((element, index) => {
        element.style.animationDelay = `${index * 80}ms`;
    });
}

function animateResultView(view) {
    if (!view) return;
    view.style.animation = 'none';
    view.style.opacity = '0';
    view.style.transform = 'translateY(24px)';
    void view.offsetWidth;
    view.style.animation = 'relatoriosFloatIn 0.6s ease-out forwards';
}

function loadScriptOnce(src) {
    const registry = window.__moduleScriptPromises = window.__moduleScriptPromises || new Map();
    if (registry.has(src)) {
        return registry.get(src);
    }

    const promise = new Promise((resolve, reject) => {
        const existing = Array.from(document.querySelectorAll('script')).find(script => {
            const current = script.getAttribute('src') || '';
            if (!current) return false;
            if (current === src) return true;
            return current.endsWith(src.replace('../', '')) || current.includes(src.replace('../', ''));
        });

        if (existing) {
            if (existing.dataset.loaded === 'true' || existing.readyState === 'complete') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => {
                existing.dataset.loaded = 'true';
                resolve();
            }, { once: true });
            existing.addEventListener('error', reject, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => {
            script.remove();
            reject(new Error(`Falha ao carregar script: ${src}`));
        };
        document.head.appendChild(script);
    });

    promise.catch(() => registry.delete(src));
    registry.set(src, promise);
    return promise;
}

async function setupGeoFilters(root) {
    if (!root) return;
    try {
        await loadScriptOnce('../js/utils/geo-multiselect.js');
        if (window.GeoMultiSelect?.initInContainer) {
            window.GeoMultiSelect.initInContainer(root, {
                module: 'relatorios',
                onChange: detail => {
                    document.dispatchEvent(new CustomEvent('relatorios:geo-filter-change', {
                        detail
                    }));
                }
            });
        }
    } catch (error) {
        console.error('Falha ao carregar seleção geográfica', error);
    }
}

function setupDateRangeFilters(root) {
    if (!root || !window.DateRangeFilter?.initDateRangeFilter) return;

    const configs = [
        { selector: '#relatoriosOrcamentosPeriod', storageKey: 'relatorios-orcamentos' },
        { selector: '#relatoriosPedidosPeriod', storageKey: 'relatorios-pedidos' }
    ];

    window.__relatoriosDateRanges = window.__relatoriosDateRanges || {};

    configs.forEach(({ selector, storageKey }) => {
        const select = root.querySelector(selector);
        if (!select) return;
        if (select.dataset.dateRangeInitialized === 'true') return;
        const controller = window.DateRangeFilter.initDateRangeFilter({
            selectElement: select,
            moduleKey: storageKey,
            getRange: () => window.__relatoriosDateRanges[storageKey] || null,
            setRange: range => {
                window.__relatoriosDateRanges[storageKey] = range;
            },
            onApply: () => {
                document.dispatchEvent(new CustomEvent('relatorios:periodo-personalizado', {
                    detail: {
                        key: storageKey,
                        range: window.__relatoriosDateRanges[storageKey] || null
                    }
                }));
            }
        });
        if (controller) {
            select.dataset.dateRangeInitialized = 'true';
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRelatoriosModule);
} else {
    initRelatoriosModule();
}
