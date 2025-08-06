// Script principal do módulo Clientes (CRM)
// Carrega lista de empresas e aplica interações básicas da tela

let todosClientes = [];

async function carregarClientes() {
    try {
        const resp = await fetch('http://localhost:3000/api/clientes/lista');
        const clientes = await resp.json();
        todosClientes = clientes;
        popularFiltros(clientes);
        renderClientes(clientes);
    } catch (err) {
        console.error('Erro ao carregar clientes', err);
    }
}

function popularFiltros(clientes) {
    const donoSel = document.getElementById('filtroDono');
    const statusSel = document.getElementById('filtroStatus');

    if (donoSel) {
        const donos = [...new Set(clientes.map(c => c.dono_cliente).filter(Boolean))].sort();
        donoSel.innerHTML = '<option value="">Todos</option>' +
            donos.map(d => `<option value="${d}">${d}</option>`).join('');
    }

    if (statusSel) {
        const statusList = [...new Set(clientes.map(c => c.status_cliente).filter(Boolean))].sort();
        statusSel.innerHTML = '<option value="">Todos</option>' +
            statusList.map(s => `<option value="${s}">${s}</option>`).join('');
    }
}

function aplicarFiltros() {
    const termo = (document.getElementById('filtroBusca')?.value || '').toLowerCase();
    const dono = document.getElementById('filtroDono')?.value || '';
    const status = document.getElementById('filtroStatus')?.value || '';

    const filtrados = todosClientes.filter(c => {
        const matchTermo = !termo ||
            c.nome_fantasia.toLowerCase().includes(termo) ||
            (c.cnpj || '').toLowerCase().includes(termo) ||
            (c.estado || '').toLowerCase().includes(termo);
        const matchDono = !dono || c.dono_cliente === dono;
        const matchStatus = !status || c.status_cliente === status;
        return matchTermo && matchDono && matchStatus;
    });

    renderClientes(filtrados);
}

function limparFiltros() {
    const busca = document.getElementById('filtroBusca');
    const dono = document.getElementById('filtroDono');
    const status = document.getElementById('filtroStatus');
    if (busca) busca.value = '';
    if (dono) dono.value = '';
    if (status) status.value = '';
    renderClientes(todosClientes);
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

    document.getElementById('btnFiltrar')?.addEventListener('click', aplicarFiltros);
    document.getElementById('btnLimpar')?.addEventListener('click', limparFiltros);

    carregarClientes();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initClientes);
} else {
    initClientes();
}
