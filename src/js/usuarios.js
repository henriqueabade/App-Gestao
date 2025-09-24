// Script principal do módulo de Usuários
// Controla carregamento da lista, edições e filtros

// Endereço base da API. Como o frontend é servido via protocolo `file://`,
// precisamos apontar explicitamente para o servidor HTTP.
const API_URL = 'http://localhost:3000';

// Cache local dos usuários carregados
let usuariosCache = [];

const ONLINE_LIMITE_MINUTOS = 5;

function obterPrimeiroValor(obj, chaves) {
    if (!obj) return null;
    for (const chave of chaves) {
        if (Object.prototype.hasOwnProperty.call(obj, chave) && obj[chave] !== null && obj[chave] !== undefined && obj[chave] !== '') {
            return obj[chave];
        }
    }
    return null;
}

function escapeHtml(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatarDataHoraCompleta(valor) {
    if (!valor) return 'Sem registro';
    const data = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(data.getTime())) return 'Sem registro';
    return data.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function formatarDescricaoAlteracao(descricao) {
    if (!descricao || !String(descricao).trim()) {
        return 'Nenhuma alteração registrada';
    }
    return escapeHtml(descricao);
}

function estaOnline(ultimaAtividade) {
    if (!ultimaAtividade) return false;
    const data = ultimaAtividade instanceof Date ? ultimaAtividade : new Date(ultimaAtividade);
    if (Number.isNaN(data.getTime())) return false;
    return Date.now() - data.getTime() <= ONLINE_LIMITE_MINUTOS * 60 * 1000;
}

function resolverStatusOnline(usuario) {
    if (typeof usuario.online === 'boolean') return usuario.online;
    const ultimaAtividade = obterPrimeiroValor(usuario, [
        'ultimaAtividadeEm',
        'ultima_atividade_em',
        'ultimaAtividade',
        'ultima_atividade',
        'ultimaAlteracaoEm',
        'ultima_alteracao_em',
        'ultimaAcaoEm',
        'ultima_acao_em'
    ]);
    return estaOnline(ultimaAtividade);
}

function fecharPopoversUsuarios() {
    document.querySelectorAll('.usuario-popover.show').forEach(pop => {
        pop.classList.remove('show');
        const trigger = pop.closest('.usuario-popover-container')?.querySelector('.usuario-detalhes-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
}

let popoverEventosRegistrados = false;

function prepararPopoversUsuarios() {
    document.querySelectorAll('.usuario-detalhes-trigger').forEach(botao => {
        botao.addEventListener('click', evento => {
            evento.stopPropagation();
            const container = botao.closest('.usuario-popover-container');
            const popover = container?.querySelector('.usuario-popover');
            if (!popover) return;
            const estavaAberto = popover.classList.contains('show');
            fecharPopoversUsuarios();
            if (!estavaAberto) {
                popover.classList.add('show');
                botao.setAttribute('aria-expanded', 'true');
            }
        });
    });

    if (!popoverEventosRegistrados) {
        document.addEventListener('click', evento => {
            if (!evento.target.closest('.usuario-popover-container')) {
                fecharPopoversUsuarios();
            }
        });
        document.addEventListener('keydown', evento => {
            if (evento.key === 'Escape') fecharPopoversUsuarios();
        });
        popoverEventosRegistrados = true;
    }
}

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
    document.getElementById('usuariosEmptyNew')?.addEventListener('click', () => {
        document.getElementById('btnNovoUsuario')?.click();
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
    fecharPopoversUsuarios();
    tbody.innerHTML = '';
    lista.forEach(u => {
        const tr = document.createElement('tr');
        tr.classList.add('table-row');
        const nome = escapeHtml(u.nome);
        const iniciais = u.nome
            .split(' ')
            .map(p => p[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
        const email = escapeHtml(u.email);
        const perfil = escapeHtml(u.perfil || '');
        const online = resolverStatusOnline(u);
        const sessaoClasse = online ? 'usuario-sessao-badge online' : 'usuario-sessao-badge offline';
        const sessaoRotulo = online ? 'Online' : 'Offline';
        const ultimoLoginValor = obterPrimeiroValor(u, ['ultimoLoginEm', 'ultimo_login_em', 'ultimoLogin', 'ultimo_login']);
        const ultimaAlteracaoValor = obterPrimeiroValor(u, [
            'ultimaAlteracaoEm',
            'ultima_alteracao_em',
            'ultimaAcaoEm',
            'ultima_acao_em',
            'ultimaAtividadeEm',
            'ultima_atividade_em'
        ]);
        const ultimaDescricaoValor = obterPrimeiroValor(u, [
            'ultimaAlteracaoDescricao',
            'ultima_alteracao_descricao',
            'ultimaAcaoDescricao',
            'ultima_acao_descricao',
            'ultimaAcao',
            'ultima_acao'
        ]);
        const ultimoLoginTexto = escapeHtml(formatarDataHoraCompleta(ultimoLoginValor));
        const ultimaAlteracaoTexto = escapeHtml(formatarDataHoraCompleta(ultimaAlteracaoValor));
        const ultimaDescricaoTexto = formatarDescricaoAlteracao(ultimaDescricaoValor);
        tr.innerHTML = `
            <td class="px-6 py-4">
                <div class="w-9 h-9 rounded-full flex items-center justify-center text-white font-medium text-sm" style="background: var(--color-primary)">${iniciais}</div>
            </td>
            <td class="px-6 py-4">
                <div class="usuario-popover-container relative">
                    <div class="flex items-center gap-2">
                        <div class="text-sm font-medium text-white">${nome}</div>
                        <button type="button" class="usuario-detalhes-trigger" aria-expanded="false" aria-haspopup="dialog" title="Ver atividade recente de ${nome}">
                            <span class="sr-only">Ver atividade recente de ${nome}</span>
                            <i class="fas fa-circle-info"></i>
                        </button>
                    </div>
                    <div class="usuario-popover glass-surface rounded-xl p-4 text-left text-sm shadow-xl">
                        <div class="usuario-popover-section">
                            <span class="usuario-popover-label">Último login</span>
                            <span class="usuario-popover-value">${ultimoLoginTexto}</span>
                        </div>
                        <div class="usuario-popover-section">
                            <span class="usuario-popover-label">Última alteração</span>
                            <span class="usuario-popover-value">${ultimaAlteracaoTexto}</span>
                        </div>
                        <div class="usuario-popover-section">
                            <span class="usuario-popover-label">Alteração registrada</span>
                            <p class="usuario-popover-description">${ultimaDescricaoTexto}</p>
                        </div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 text-sm text-white">${email}</td>
            <td class="px-6 py-4 text-sm text-white">${perfil}</td>
            <td class="px-6 py-4">
                <span class="${sessaoClasse}">
                    <span class="status-dot"></span>
                    ${sessaoRotulo}
                </span>
            </td>
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

    prepararPopoversUsuarios();
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
