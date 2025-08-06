// Script principal do módulo Clientes (CRM)
// Carrega lista de empresas e aplica interações básicas da tela

async function carregarClientes() {
    try {
        const resp = await fetch('http://localhost:3000/api/clientes/lista');
        const clientes = await resp.json();
        renderClientes(clientes);
    } catch (err) {
        console.error('Erro ao carregar clientes', err);
    }
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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initClientes);
} else {
    initClientes();
}
