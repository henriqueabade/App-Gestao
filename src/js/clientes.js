// Script principal do módulo Clientes (CRM)
// Carrega lista de empresas e aplica interações básicas da tela

let clientesCache = [];

async function carregarClientes() {
    try {
        const resp = await fetch('http://localhost:3000/api/clientes/lista');
        clientesCache = await resp.json();
        renderClientes(clientesCache);
        preencherFiltros(clientesCache);
    } catch (err) {
        console.error('Erro ao carregar clientes', err);
    }
}

function preencherFiltros(clientes) {
    const donoSel = document.getElementById('donoSelect');
    const statusSel = document.getElementById('statusSelect');
    const dataList = document.getElementById('clientesOptions');

    if (donoSel) {
        const donos = [...new Set(clientes.map(c => c.dono_cliente).filter(Boolean))];
        donoSel.innerHTML = '<option value="">Todos</option>' +
            donos.map(d => `<option value="${d}">${d}</option>`).join('');
    }
    if (statusSel) {
        const status = [...new Set(clientes.map(c => c.status_cliente).filter(Boolean))];
        statusSel.innerHTML = '<option value="">Todos</option>' +
            status.map(s => `<option value="${s}">${s}</option>`).join('');
    }
    if (dataList) {
        const valores = new Set();
        clientes.forEach(c => {
            if (c.nome_fantasia) valores.add(c.nome_fantasia);
            if (c.cnpj) valores.add(c.cnpj);
            if (c.estado) valores.add(c.estado);
        });
        dataList.innerHTML = Array.from(valores).map(v => `<option value="${v}"></option>`).join('');
    }
}

function aplicarFiltro() {
    const busca = document.getElementById('searchCliente')?.value.trim().toLowerCase() || '';
    const dono = document.getElementById('donoSelect')?.value || '';
    const status = document.getElementById('statusSelect')?.value || '';

    const filtrados = clientesCache.filter(c => {
        const cnpjNum = (c.cnpj || '').replace(/\D/g, '');
        const buscaNum = busca.replace(/\D/g, '');
        const matchBusca = !busca ||
            (c.nome_fantasia && c.nome_fantasia.toLowerCase().includes(busca)) ||
            (c.estado && c.estado.toLowerCase().includes(busca)) ||
            (cnpjNum && cnpjNum.includes(buscaNum));
        const matchDono = !dono || c.dono_cliente === dono;
        const matchStatus = !status || c.status_cliente === status;
        return matchBusca && matchDono && matchStatus;
    });

    renderClientes(filtrados);
}

function limparFiltros() {
    const buscaEl = document.getElementById('searchCliente');
    const donoEl = document.getElementById('donoSelect');
    const statusEl = document.getElementById('statusSelect');
    if (buscaEl) buscaEl.value = '';
    if (donoEl) donoEl.value = '';
    if (statusEl) statusEl.value = '';
    renderClientes(clientesCache);
}

function badgeForStatus(status) {
    const map = {
        'Ativo': 'badge-success',
        'Inativo': 'badge-danger',
        'Pendente': 'badge-warning',
        'Suspenso': 'badge-neutral'
    };
    const classe = map[status] || 'badge-neutral';
    return `<span class="${classe} px-3 py-1 rounded-full text-xs font-medium">${status}</span>`;
}

function renderClientes(clientes) {
    const tbody = document.getElementById('clientesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    clientes.forEach((c) => {
        const tr = document.createElement('tr');
        tr.className = 'transition-colors duration-150';
        tr.style.cursor = 'pointer';
        tr.addEventListener('mouseover', () => {
            tr.style.background = 'rgba(163, 148, 167, 0.05)';
        });
        tr.addEventListener('mouseout', () => {
            tr.style.background = 'transparent';
        });
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${c.nome_fantasia}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${c.cnpj}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${c.estado}</td>
            <td class="px-6 py-4 whitespace-nowrap">${badgeForStatus(c.status_cliente)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${c.dono_cliente || ''}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
                <div class="flex items-center justify-center space-x-2">
                    <i class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Visualizar"></i>
                    <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-red)" title="Excluir"></i>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

function initClientes() {
    // animação de entrada
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    carregarClientes();

    document.getElementById('filtrarBtn')?.addEventListener('click', aplicarFiltro);
    document.getElementById('limparBtn')?.addEventListener('click', limparFiltros);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initClientes);
} else {
    initClientes();
}
