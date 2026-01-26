// Lógica de interação para o módulo de Serviços de Laminação
window.customPeriodServicosLaminacao = null;
let servicosDateRangeController = null;
let servicosData = [];
let servicosColumns = [];
let servicosFieldMap = {};

async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
}

function parseIsoDateToLocal(iso) {
    if (!iso || typeof iso !== 'string' || !iso.includes('-')) return null;
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return null;
    const parsed = new Date(year, month - 1, day);
    parsed.setHours(0, 0, 0, 0);
    return parsed;
}

function formatarDataLocal(isoDate) {
    if (!isoDate) return '';
    const data = new Date(isoDate);
    if (isNaN(data)) return '';
    return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function updateEmptyStateServicos(hasData) {
    const wrapper = document.getElementById('servicosTableWrapper');
    const empty = document.getElementById('servicosEmptyState');
    if (!wrapper || !empty) return;
    if (hasData) {
        wrapper.classList.remove('hidden');
        empty.classList.add('hidden');
    } else {
        wrapper.classList.add('hidden');
        empty.classList.remove('hidden');
    }
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

function toTitleCase(value) {
    return value
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function detectFieldMap(items) {
    const keys = items.length ? Object.keys(items[0]) : [];
    const findKey = (patterns) => keys.find((key) => patterns.some((p) => key.toLowerCase().includes(p)));
    return {
        keys,
        statusKey: findKey(['status', 'situacao']),
        dateKey: findKey(['data', 'dt']),
        ownerKey: findKey(['dono', 'responsavel', 'vendedor', 'usuario']),
        clientKey: findKey(['cliente']),
        valueKey: findKey(['valor', 'preco', 'total', 'custo']),
        codeKey: findKey(['codigo', 'numero', 'id'])
    };
}

function buildColumns(fieldMap) {
    const { keys, codeKey, clientKey, dateKey, valueKey, statusKey } = fieldMap;
    const preferred = [codeKey, clientKey, dateKey, valueKey, statusKey].filter(Boolean);
    const columns = [...new Set(preferred)];
    keys.forEach((key) => {
        if (columns.length >= 5) return;
        if (!columns.includes(key)) columns.push(key);
    });
    return columns.map((key) => ({ key, label: toTitleCase(key) }));
}

function parseNumericValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/\./g, '').replace(',', '.');
    const parsed = Number(cleaned);
    return Number.isNaN(parsed) ? null : parsed;
}

function getStatusBadgeClass(value) {
    if (!value) return 'badge-neutral';
    const normalized = String(value).toLowerCase();
    if (normalized.includes('conclu') || normalized.includes('entreg')) return 'badge-success';
    if (normalized.includes('cancel')) return 'badge-danger';
    if (normalized.includes('envia')) return 'badge-info';
    if (normalized.includes('produ') || normalized.includes('andamento')) return 'badge-warning';
    return 'badge-neutral';
}

function formatCellValue(key, value, fieldMap) {
    if (value === null || value === undefined || value === '') return '—';
    const lowerKey = key.toLowerCase();
    if (fieldMap.dateKey && key === fieldMap.dateKey) {
        return formatarDataLocal(value) || String(value);
    }
    if (fieldMap.valueKey && key === fieldMap.valueKey) {
        const parsed = parseNumericValue(value);
        if (parsed !== null) {
            return parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }
    }
    if (lowerKey.includes('valor') || lowerKey.includes('preco') || lowerKey.includes('total') || lowerKey.includes('custo')) {
        const parsed = parseNumericValue(value);
        if (parsed !== null) {
            return parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }
    }
    return String(value);
}

function renderTable(data) {
    const headerRow = document.getElementById('servicosHeaderRow');
    const tbody = document.getElementById('servicosTabela');
    if (!headerRow || !tbody) return;

    headerRow.innerHTML = servicosColumns
        .map((col) => `<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${col.label}</th>`)
        .join('');

    tbody.innerHTML = '';

    data.forEach((item) => {
        const tr = document.createElement('tr');
        tr.className = 'transition-colors duration-150';
        tr.setAttribute('onmouseover', "this.style.background='rgba(163, 148, 167, 0.05)'");
        tr.setAttribute('onmouseout', "this.style.background='transparent'");
        if (servicosFieldMap.statusKey) {
            tr.dataset.status = item[servicosFieldMap.statusKey] ?? '';
        }
        if (servicosFieldMap.ownerKey) {
            tr.dataset.owner = item[servicosFieldMap.ownerKey] ?? '';
        }
        if (servicosFieldMap.clientKey) {
            tr.dataset.client = item[servicosFieldMap.clientKey] ?? '';
        }
        if (servicosFieldMap.dateKey) {
            tr.dataset.date = item[servicosFieldMap.dateKey] ?? '';
        }

        tr.innerHTML = servicosColumns
            .map((col) => {
                const value = formatCellValue(col.key, item[col.key], servicosFieldMap);
                if (servicosFieldMap.statusKey && col.key === servicosFieldMap.statusKey) {
                    const badgeClass = getStatusBadgeClass(item[col.key]);
                    return `<td class="px-6 py-4 whitespace-nowrap text-sm"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${value}</span></td>`;
                }
                return `<td class="px-6 py-4 whitespace-nowrap text-sm text-white">${value}</td>`;
            })
            .join('');

        tbody.appendChild(tr);
    });
}

function popularFiltros(data) {
    const statusSelect = document.getElementById('filterStatusServicos');
    const ownerSelect = document.getElementById('filterOwnerServicos');
    const clientSelect = document.getElementById('filterClientServicos');

    if (statusSelect) {
        statusSelect.innerHTML = '<option value="">Todos os Status</option>';
        if (servicosFieldMap.statusKey) {
            const statuses = [...new Set(data.map((item) => item[servicosFieldMap.statusKey]).filter((value) => value))];
            statusSelect.innerHTML += statuses
                .map((status) => `<option value="${status}">${status}</option>`)
                .join('');
        }
    }

    if (ownerSelect) {
        ownerSelect.innerHTML = '<option value="">Todos os Donos</option>';
        if (servicosFieldMap.ownerKey) {
            const owners = [...new Set(data.map((item) => item[servicosFieldMap.ownerKey]).filter((value) => value))];
            ownerSelect.innerHTML += owners
                .map((owner) => `<option value="${owner}">${owner}</option>`)
                .join('');
        }
    }

    if (clientSelect) {
        clientSelect.innerHTML = '<option value="">Todos os Clientes</option>';
        if (servicosFieldMap.clientKey) {
            const clients = [...new Set(data.map((item) => item[servicosFieldMap.clientKey]).filter((value) => value))];
            clientSelect.innerHTML += clients
                .map((client) => `<option value="${client}">${client}</option>`)
                .join('');
        }
    }
}

function filtrarServicos() {
    const status = document.getElementById('filterStatusServicos')?.value || '';
    const periodo = document.getElementById('filterPeriodServicos')?.value || '';
    const dono = document.getElementById('filterOwnerServicos')?.value || '';
    const cliente = document.getElementById('filterClientServicos')?.value || '';
    const now = new Date();
    const customPeriod = window.customPeriodServicosLaminacao;

    const filtered = servicosData.filter((item) => {
        let show = true;
        if (servicosFieldMap.statusKey && status) {
            show &&= String(item[servicosFieldMap.statusKey] ?? '') === status;
        }
        if (servicosFieldMap.ownerKey && dono) {
            show &&= String(item[servicosFieldMap.ownerKey] ?? '') === dono;
        }
        if (servicosFieldMap.clientKey && cliente) {
            show &&= String(item[servicosFieldMap.clientKey] ?? '') === cliente;
        }
        if (servicosFieldMap.dateKey && periodo) {
            const rawDate = item[servicosFieldMap.dateKey];
            const rowDate = parseIsoDateToLocal(String(rawDate));
            if (!rowDate) return false;
            if (periodo === 'Personalizado' && customPeriod?.start && customPeriod?.end) {
                const inicio = parseIsoDateToLocal(customPeriod.start);
                const fim = parseIsoDateToLocal(customPeriod.end);
                if (inicio && fim) {
                    fim.setHours(23, 59, 59, 999);
                    show &&= rowDate >= inicio && rowDate <= fim;
                }
            } else {
                const diff = (now - rowDate) / (1000 * 60 * 60 * 24);
                if (periodo === 'Semana') show &&= diff <= 7;
                else if (periodo === 'Mês') show &&= diff <= 30;
                else if (periodo === 'Trimestre') show &&= diff <= 90;
                else if (periodo === 'Ano') show &&= diff <= 365;
            }
        }
        return show;
    });

    renderTable(filtered);
    updateEmptyStateServicos(filtered.length > 0);
}

function limparFiltrosServicos() {
    document.getElementById('filterStatusServicos').value = '';
    servicosDateRangeController?.clear();
    document.getElementById('filterOwnerServicos').value = '';
    document.getElementById('filterClientServicos').value = '';
    window.customPeriodServicosLaminacao = null;
    filtrarServicos();
}

async function carregarServicos() {
    try {
        const resp = await fetchApi('/api/servicos_laminacao');
        const data = await resp.json();
        servicosData = Array.isArray(data) ? data : [];
        servicosFieldMap = detectFieldMap(servicosData);
        servicosColumns = buildColumns(servicosFieldMap);
        renderTable(servicosData);
        popularFiltros(servicosData);
        updateEmptyStateServicos(servicosData.length > 0);
        const periodSelect = document.getElementById('filterPeriodServicos');
        if (periodSelect?.dataset.customActive === 'true' && window.customPeriodServicosLaminacao?.start && window.customPeriodServicosLaminacao?.end) {
            filtrarServicos();
        }
    } catch (err) {
        console.error('Erro ao carregar serviços de laminação', err);
        servicosData = [];
        renderTable(servicosData);
        updateEmptyStateServicos(false);
    }
}

function initServicosLaminacao() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    const novoServico = document.getElementById('btnNovoServico');
    if (novoServico) {
        novoServico.addEventListener('click', () => {
            openModalWithSpinner('modals/laminacao-servicos/novo.html', '../js/modals/laminacao-servicos/servico-novo.js', 'novoServico');
        });
    }

    const filtrar = document.getElementById('btnFiltrarServicos');
    const limpar = document.getElementById('btnLimparServicos');
    if (filtrar) filtrar.addEventListener('click', filtrarServicos);
    if (limpar) limpar.addEventListener('click', limparFiltrosServicos);

    const periodSelect = document.getElementById('filterPeriodServicos');
    if (periodSelect && window.DateRangeFilter?.initDateRangeFilter) {
        servicosDateRangeController = window.DateRangeFilter.initDateRangeFilter({
            selectElement: periodSelect,
            moduleKey: 'servicos-laminacao',
            getRange: () => window.customPeriodServicosLaminacao,
            setRange: (range) => {
                window.customPeriodServicosLaminacao = range;
            },
            onApply: () => {
                filtrarServicos();
            }
        });
    }

    carregarServicos();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initServicosLaminacao);
} else {
    initServicosLaminacao();
}
