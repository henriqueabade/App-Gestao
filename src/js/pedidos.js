// Lógica de interação para o módulo de Pedidos
window.customStartDate = null;
window.customEndDate = null;

async function popularClientes() {
    const select = document.getElementById('filterClient');
    if (!select) return;
    try {
        const resp = await fetch('http://localhost:3000/api/clientes/lista');
        const data = await resp.json();
        select.innerHTML = '<option value="">Todos os Clientes</option>' +
            data.map(c => `<option value="${c.nome_fantasia}">${c.nome_fantasia}</option>`).join('');
    } catch (err) {
        console.error('Erro ao carregar clientes', err);
    }
}

function showFunctionUnavailableDialog(message) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML = `<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
            <h3 class="text-lg font-semibold mb-4 text-yellow-400">Função Indisponível</h3>
            <p class="text-sm text-gray-300 mb-6">${message}</p>
            <div class="flex justify-center">
                <button id="funcUnavailableOk" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">OK</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#funcUnavailableOk').addEventListener('click', () => overlay.remove());
}

async function carregarPedidos() {
    try {
        const resp = await fetch('http://localhost:3000/api/pedidos');
        const data = await resp.json();
        const tbody = document.getElementById('pedidosTabela');
        tbody.innerHTML = '';
        const statusClasses = {
            'Rascunho': 'badge-info',
            'Em Produção': 'badge-warning',
            'Concluído': 'badge-success',
            'Cancelado': 'badge-danger'
        };
        const owners = new Set();
        data.forEach(p => {
            const tr = document.createElement('tr');
            tr.className = 'transition-colors duration-150';
            tr.style.cursor = 'pointer';
            tr.setAttribute('onmouseover', "this.style.background='rgba(163, 148, 167, 0.05)'");
            tr.setAttribute('onmouseout', "this.style.background='transparent'");
            tr.dataset.dono = p.dono || '';
            owners.add(p.dono);
            const condicao = p.parcelas > 1 ? `${p.parcelas}x` : 'À vista';
            const badgeClass = statusClasses[p.situacao] || 'badge-neutral';
            const valor = Number(p.valor_final || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${p.numero}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${p.cliente || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${p.data_emissao || ''}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-white">${valor}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${condicao}</td>
                <td class="px-6 py-4 whitespace-nowrap"><span class="${badgeClass} px-3 py-1 rounded-full text-xs font-medium">${p.situacao}</span></td>
                <td class="px-6 py-4 whitespace-nowrap text-center">
                    <div class="flex items-center justify-center space-x-2">
                        <i class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Visualizar"></i>
                        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Concluir"></i>
                        <i class="fas fa-clipboard w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Relatório"></i>
                        <i class="fas fa-download w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Download"></i>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
        const ownerSelect = document.getElementById('filterOwner');
        if (ownerSelect) {
            ownerSelect.innerHTML = '<option value="">Todos os Donos</option>' +
                [...owners].map(d => `<option value="${d}">${d}</option>`).join('');
        }
        tbody.querySelectorAll('.fa-eye, .fa-check, .fa-clipboard, .fa-download').forEach(icon => {
            icon.addEventListener('click', e => {
                e.stopPropagation();
                showFunctionUnavailableDialog('Função em desenvolvimento.');
            });
        });
        await popularClientes();
    } catch (err) {
        console.error('Erro ao carregar pedidos', err);
    }
}

function aplicarFiltro() {
    const status = document.getElementById('filterStatus')?.value || '';
    const periodo = document.getElementById('filterPeriod')?.value || '';
    const dono = document.getElementById('filterOwner')?.value || '';
    const cliente = document.getElementById('filterClient')?.value.toLowerCase() || '';
    const now = new Date();
    document.querySelectorAll('#pedidosTabela tr').forEach(row => {
        const rowStatus = row.cells[5]?.innerText.trim() || '';
        const rowCliente = row.cells[1]?.innerText.trim().toLowerCase() || '';
        const rowDono = (row.dataset.dono || '').toLowerCase();
        const dateText = row.cells[2]?.innerText.trim();
        let show = true;

        if (status) show &&= rowStatus === status;
        if (dono) show &&= rowDono === dono.toLowerCase();
        if (cliente) show &&= rowCliente === cliente;
        if (periodo) {
            const [d, m, y] = dateText.split('/').map(Number);
            const rowDate = new Date(y, m - 1, d);
            if (periodo === 'Personalizado' && window.customStartDate && window.customEndDate) {
                const inicio = new Date(window.customStartDate);
                const fim = new Date(window.customEndDate);
                show &&= rowDate >= inicio && rowDate <= fim;
            } else {
                const diff = (now - rowDate) / (1000 * 60 * 60 * 24);
                if (periodo === 'Semana') show &&= diff <= 7;
                else if (periodo === 'Mês') show &&= diff <= 30;
                else if (periodo === 'Trimestre') show &&= diff <= 90;
                else if (periodo === 'Ano') show &&= diff <= 365;
            }
        }

        row.style.display = show ? '' : 'none';
    });
}

function limparFiltros() {
    document.getElementById('filterStatus').value = '';
    const periodSel = document.getElementById('filterPeriod');
    periodSel.value = '';
    const customOpt = periodSel.querySelector('option[value="Personalizado"]');
    if (customOpt) customOpt.textContent = 'Personalizado';
    document.getElementById('filterOwner').value = '';
    document.getElementById('filterClient').value = '';
    window.customStartDate = null;
    window.customEndDate = null;
    aplicarFiltro();
}

function initPedidos() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    const converterBtn = document.getElementById('converterOrcamentoBtn');
    if (converterBtn) {
        converterBtn.addEventListener('click', () => {
            showFunctionUnavailableDialog('Conversão de orçamento ainda não implementada.');
        });
    }

    const filtrar = document.getElementById('btnFiltrar');
    const limpar = document.getElementById('btnLimpar');
    if (filtrar) filtrar.addEventListener('click', aplicarFiltro);
    if (limpar) limpar.addEventListener('click', limparFiltros);

    const periodSelect = document.getElementById('filterPeriod');
    const periodModal = document.getElementById('periodModal');
    const periodConfirm = document.getElementById('periodConfirm');
    periodSelect?.addEventListener('change', () => {
        if (periodSelect.value === 'Personalizado') {
            periodModal.classList.remove('hidden');
        } else {
            const customOpt = periodSelect.querySelector('option[value="Personalizado"]');
            if (customOpt) customOpt.textContent = 'Personalizado';
            window.customStartDate = null;
            window.customEndDate = null;
        }
    });
    periodConfirm?.addEventListener('click', () => {
        window.customStartDate = document.getElementById('startDate').value;
        window.customEndDate = document.getElementById('endDate').value;
        periodModal.classList.add('hidden');
        const customOpt = periodSelect.querySelector('option[value="Personalizado"]');
        if (customOpt && window.customStartDate && window.customEndDate) {
            const fmt = d => d.split('-').reverse().join('/');
            customOpt.textContent = `${fmt(window.customStartDate)} - ${fmt(window.customEndDate)}`;
        }
        periodSelect.value = 'Personalizado';
        aplicarFiltro();
    });

    carregarPedidos();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPedidos);
} else {
    initPedidos();
}
