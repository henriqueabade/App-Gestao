// Script principal do módulo de Usuários
// Controla carregamento da lista, edições e filtros

// Endereço base da API. Como o frontend é servido via protocolo `file://`,
// precisamos apontar explicitamente para o servidor HTTP.
const API_URL = 'http://localhost:3000';

// Cache local dos usuários carregados
let usuariosCache = [];

function updateEmptyStateUsuarios(hasData) {
    const wrapper = document.getElementById('usuariosTableWrapper');
    const empty = document.getElementById('usuariosEmptyState');
    if (!wrapper || !empty) return;
    if (hasData) {
        wrapper.classList.remove('hidden');
        empty.classList.add('hidden');
    } else {
        wrapper.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

function coletarFiltros() {
    const status = [];
    document.querySelectorAll('.checkbox-custom:checked').forEach(cb => status.push(cb.value));
    return {
        busca: document.getElementById('filtroBusca')?.value || '',
        perfil: document.getElementById('filtroPerfil')?.value || '',
        status
    };
}

function initUsuarios() {
    // animação de entrada
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    carregarUsuarios();

    document.getElementById('btnNovoUsuario')?.addEventListener('click', () => {
        console.log('Criar novo usuário');
    });

    document.getElementById('aplicarFiltro')?.addEventListener('click', aplicarFiltros);
    document.getElementById('filtroBusca')?.addEventListener('input', aplicarFiltros);

    document.getElementById('limparFiltro')?.addEventListener('click', () => {
        document.getElementById('filtroBusca').value = '';
        document.getElementById('filtroPerfil').value = '';
        document.querySelectorAll('.checkbox-custom').forEach(cb => cb.checked = false);
        renderUsuarios(usuariosCache);
    });

    // Controle do popover de resumo
    const infoIcon = document.querySelector('.info-icon');
    const resumoPopover = document.getElementById('resumoPopover');

    if (infoIcon && resumoPopover) {
        const mostrarPopover = () => {
            const rect = infoIcon.getBoundingClientRect();
            resumoPopover.style.left = '1vw';
            resumoPopover.style.top = '2.5vw';
            resumoPopover.classList.add('show');
        };

        const ocultarPopover = () => {
            resumoPopover.classList.remove('show');
        };

        infoIcon.addEventListener('mouseenter', mostrarPopover);
        infoIcon.addEventListener('mouseleave', () => {
            setTimeout(() => {
                if (!resumoPopover.matches(':hover')) ocultarPopover();
            }, 100);
        });
        resumoPopover.addEventListener('mouseleave', ocultarPopover);
    }
}

function aplicarFiltros() {
    const filtros = coletarFiltros();
    const busca = filtros.busca.toLowerCase();
    const filtrados = usuariosCache.filter(u => {
        if (busca && !u.nome.toLowerCase().includes(busca) && !u.email.toLowerCase().includes(busca)) {
            return false;
        }
        if (filtros.perfil && u.perfil !== filtros.perfil) {
            return false;
        }
        if (filtros.status.length > 0 && !filtros.status.includes(u.status.toLowerCase())) {
            return false;
        }
        return true;
    });
    renderUsuarios(filtrados);
}

function renderUsuarios(lista) {
    const tbody = document.getElementById('listaUsuarios');
    if (!tbody) return;
    tbody.innerHTML = '';
    lista.forEach(u => {
        const tr = document.createElement('tr');
        tr.classList.add('table-row');
        const iniciais = u.nome
            .split(' ')
            .map(p => p[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
        tr.innerHTML = `
            <td class="px-6 py-4">
                <div class="w-9 h-9 rounded-full flex items-center justify-center text-white font-medium text-sm" style="background: var(--color-primary)">${iniciais}</div>
            </td>
            <td class="px-6 py-4">
                <div class="text-sm font-medium text-white">${u.nome}</div>
            </td>
            <td class="px-6 py-4 text-sm text-white">${u.email}</td>
            <td class="px-6 py-4 text-sm text-white">${u.perfil || ''}</td>
            <td class="px-6 py-4">
                <span class="${u.status === 'Ativo' ? 'badge-success' : 'badge-danger'} px-2 py-1 rounded-full text-xs font-medium">${u.status}</span>
            </td>
            <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                    <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-acao="editar" style="color: var(--color-primary)" title="Editar"></i>
                    <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" data-acao="remover" style="color: var(--color-red)" title="Excluir"></i>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('[data-acao="editar"]').forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('Editar usuário');
        });
    });

    document.querySelectorAll('[data-acao="remover"]').forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('Remover usuário');
        });
    });

    updateEmptyStateUsuarios(lista.length > 0);
}

function atualizarResumo() {
    const totalEl = document.getElementById('totalUsuarios');
    const statusEl = document.getElementById('distribuicaoStatus');
    const perfisEl = document.getElementById('distribuicaoPerfis');
    if (!totalEl || !statusEl || !perfisEl) return;

    totalEl.textContent = usuariosCache.length;

    const statusCounts = usuariosCache.reduce((acc, u) => {
        const key = (u.status || 'Aguardando').toLowerCase();
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    statusEl.innerHTML = '';
    const statusConfig = {
        ativo: { class: 'badge-success', label: 'Ativos' },
        inativo: { class: 'badge-danger', label: 'Inativos' },
        aguardando: { class: 'badge-warning', label: 'Aguardando' }
    };
    Object.entries(statusCounts).forEach(([status, count]) => {
        const cfg = statusConfig[status] || { class: 'badge-secondary', label: status };
        const span = document.createElement('span');
        span.className = `${cfg.class} px-3 py-1 rounded-full text-xs font-medium`;
        span.textContent = `${count} ${cfg.label}`;
        statusEl.appendChild(span);
    });

    const perfilCounts = usuariosCache.reduce((acc, u) => {
        const perfil = u.perfil || 'Sem Perfil';
        acc[perfil] = (acc[perfil] || 0) + 1;
        return acc;
    }, {});
    perfisEl.innerHTML = '';
    const perfilLabels = {
        admin: 'Administradores',
        operacional: 'Operacionais',
        cliente: 'Clientes',
        'Sem Perfil': 'Sem Perfil'
    };
    Object.entries(perfilCounts).forEach(([perfil, count]) => {
        const div = document.createElement('div');
        const label = perfilLabels[perfil] || perfil;
        div.textContent = `• ${count} ${label}`;
        perfisEl.appendChild(div);
    });
}

async function carregarUsuarios() {
    try {
        const resp = await fetch(`${API_URL}/api/usuarios/lista`);
        usuariosCache = await resp.json();
        renderUsuarios(usuariosCache);
        atualizarResumo();
    } catch (err) {
        console.error('Erro ao carregar usuários:', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUsuarios);
} else {
    initUsuarios();
}
