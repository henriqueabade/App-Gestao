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
        renderTotais(clientes);
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
    renderTotais(filtrados);
}

function limparFiltros() {
    const busca = document.getElementById('filtroBusca');
    const dono = document.getElementById('filtroDono');
    const status = document.getElementById('filtroStatus');
    if (busca) busca.value = '';
    if (dono) dono.value = '';
    if (status) status.value = '';
    renderClientes(todosClientes);
    renderTotais(todosClientes);
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
                    <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
                    <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-red)" title="Excluir"></i>
                </div>
            </td>`;
        const eyeBtn = tr.querySelector('.fa-eye');
        if (eyeBtn) eyeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            abrirDetalhesCliente(c);
        });
        const editBtn = tr.querySelector('.fa-edit');
        if (editBtn) editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('Editar cliente');
        });
        tbody.appendChild(tr);
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

function abrirDetalhesCliente(cliente) {
    window.clienteDetalhes = cliente;
    openModalWithSpinner('modals/clientes/detalhes.html', '../js/modals/cliente-detalhes.js', 'detalhesCliente');
}

function renderTotais(clientes) {
    const container = document.getElementById('totaisBadges');
    if (!container) return;

    const total = clientes.length;
    const counts = {};
    clientes.forEach(c => {
        const status = c.status_cliente || 'Sem Status';
        counts[status] = (counts[status] || 0) + 1;
    });

    const labelMap = {
        'Ativo': 'Ativos',
        'Inativo': 'Inativos',
        'Pendente': 'Pendentes',
        'Suspenso': 'Suspensos',
        'Sem Status': 'Sem Status'
    };
    const classMap = {
        'Ativo': 'badge-success',
        'Inativo': 'badge-danger',
        'Pendente': 'badge-warning',
        'Suspenso': 'badge-neutral',
        'Sem Status': 'badge-neutral'
    };

    const badges = [`<span class="badge-neutral px-3 py-1 rounded-full text-xs font-medium">Total: ${total}</span>`];
    for (const [status, count] of Object.entries(counts)) {
        const label = labelMap[status] || status;
        const cls = classMap[status] || 'badge-neutral';
        badges.push(`<span class="${cls} px-3 py-1 rounded-full text-xs font-medium">${label}: ${count}</span>`);
    }
    container.innerHTML = badges.join('');
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
