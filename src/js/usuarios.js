// Script principal do módulo de Usuários
// Controla carregamento da lista, edições e filtros

// Endereço base da API. Como o frontend é servido via protocolo `file://`,
// precisamos apontar explicitamente para o servidor HTTP.
const API_URL = 'http://localhost:3000';

// Cache local dos usuários carregados
let usuariosCache = [];
let usuarioPopoverAtual = null;

const USUARIO_TRIGGER_ACTIVE_CLASS = 'usuario-detalhes-trigger--active';

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

function normalizarParaComparacao(texto) {
    if (!texto) return '';
    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function formatarSegmentoDescricao(parte) {
    const horarioRegex = /^hor[áa]rio:\s*/i;
    if (horarioRegex.test(parte)) {
        const valor = parte.replace(horarioRegex, '').trim();
        const data = new Date(valor);
        if (!Number.isNaN(data.getTime())) {
            return escapeHtml(`Horário: ${formatarDataHoraCompleta(data)}`);
        }
    }
    return escapeHtml(parte);
}

function formatarDescricaoAlteracao(descricao, local, especificacao) {
    const localLimpo = local && String(local).trim();
    const especificacaoLimpa = especificacao && String(especificacao).trim();

    if (localLimpo || especificacaoLimpa) {
        const partes = [];
        if (localLimpo) {
            partes.push(`Usuário alterou o módulo ${escapeHtml(localLimpo)}`);
        }
        if (especificacaoLimpa) {
            const detalhesEspecificacao = especificacaoLimpa
                .split('|')
                .map(parte => parte.trim())
                .filter(Boolean)
                .filter(parte => {
                    const normalizado = normalizarParaComparacao(parte);
                    if (normalizado.startsWith('motivo')) return false;
                    if (localLimpo && normalizado.startsWith('modulo')) return false;
                    return true;
                })
                .map(formatarSegmentoDescricao);

            if (detalhesEspecificacao.length) {
                partes.push(`mudando ${detalhesEspecificacao.join(' | ')}`);
            }
        }

        if (partes.length) {
            return partes.join(', ');
        }
    }

    if (!descricao || !String(descricao).trim()) {
        return 'Nenhuma alteração registrada';
    }

    return String(descricao)
        .split('|')
        .map(parte => parte.trim())
        .filter(Boolean)
        .map(formatarSegmentoDescricao)
        .join('<br>');
}

function estaOnline(ultimaAtividade) {
    if (!ultimaAtividade) return false;
    const data = ultimaAtividade instanceof Date ? ultimaAtividade : new Date(ultimaAtividade);
    if (Number.isNaN(data.getTime())) return false;
    return Date.now() - data.getTime() <= ONLINE_LIMITE_MINUTOS * 60 * 1000;
}

function resolverStatusOnline(usuario) {
    const ultimaEntrada = obterPrimeiroValor(usuario, [
        'ultimaEntradaEm',
        'ultima_entrada_em',
        'ultimaEntrada',
        'ultima_entrada'
    ]);
    const ultimaSaida = obterPrimeiroValor(usuario, [
        'ultimaSaidaEm',
        'ultima_saida_em',
        'ultimaSaida',
        'ultima_saida'
    ]);

    const entradaData = ultimaEntrada ? new Date(ultimaEntrada) : null;
    const saidaData = ultimaSaida ? new Date(ultimaSaida) : null;
    const entradaValida = entradaData && !Number.isNaN(entradaData.getTime());
    const saidaValida = saidaData && !Number.isNaN(saidaData.getTime());

    if (entradaValida || saidaValida) {
        if (!saidaValida) return Boolean(entradaValida);
        if (!entradaValida) return false;
        return saidaData.getTime() < entradaData.getTime();
    }

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
    if (!usuarioPopoverAtual) return;
    const { popup, trigger, cleanup } = usuarioPopoverAtual;
    if (typeof cleanup === 'function') {
        try {
            cleanup();
        } catch (erro) {
            console.error('Erro ao limpar eventos do popover de usuário', erro);
        }
    }
    if (popup && typeof popup.remove === 'function') {
        popup.remove();
    }
    if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.classList.remove(USUARIO_TRIGGER_ACTIVE_CLASS);
    }
    usuarioPopoverAtual = null;
}

function criarConteudoPopoverUsuario(botao) {
    const nome = botao.dataset.nome || 'Usuário';
    const ultimoLogin = botao.dataset.ultimoLogin || 'Sem registro';
    const ultimaAlteracao = botao.dataset.ultimaAlteracao || 'Sem registro';
    const ultimaDescricao = botao.dataset.ultimaDescricao || 'Nenhuma alteração registrada';
    return `
        <div class="usuario-popover-card">
            <div class="usuario-popover-header">
                <span class="usuario-popover-title">Atividade recente</span>
                <span class="usuario-popover-username">${nome}</span>
            </div>
            <div class="usuario-popover-section">
                <span class="usuario-popover-label">Último login</span>
                <span class="usuario-popover-value">${ultimoLogin}</span>
            </div>
            <div class="usuario-popover-section">
                <span class="usuario-popover-label">Última alteração</span>
                <span class="usuario-popover-value">${ultimaAlteracao}</span>
            </div>
            <div class="usuario-popover-section">
                <span class="usuario-popover-label">Alteração registrada</span>
                <p class="usuario-popover-description">${ultimaDescricao}</p>
            </div>
        </div>`;
}

function abrirPopoverUsuario(botao) {
    if (typeof window.createPopup !== 'function') {
        console.warn('createPopup não disponível para popover de usuário');
        return;
    }
    const html = criarConteudoPopoverUsuario(botao);
    const { popup } = window.createPopup(botao, html, { margin: 12 });

    let hideTimeoutId = null;
    const cancelarOcultacao = () => {
        if (hideTimeoutId) {
            clearTimeout(hideTimeoutId);
            hideTimeoutId = null;
        }
    };

    const agendarOcultacao = () => {
        cancelarOcultacao();
        hideTimeoutId = setTimeout(() => {
            hideTimeoutId = null;
            const aindaSobreTrigger = botao.matches(':hover');
            const aindaSobrePopup = popup.matches(':hover');
            if (!aindaSobreTrigger && !aindaSobrePopup) {
                fecharPopoversUsuarios();
            }
        }, 120);
    };

    const listeners = [
        { elemento: botao, tipo: 'mouseleave', handler: agendarOcultacao },
        { elemento: popup, tipo: 'mouseleave', handler: agendarOcultacao },
        { elemento: botao, tipo: 'mouseenter', handler: cancelarOcultacao },
        { elemento: popup, tipo: 'mouseenter', handler: cancelarOcultacao }
    ];

    listeners.forEach(({ elemento, tipo, handler }) => {
        elemento.addEventListener(tipo, handler);
    });

    const cleanup = () => {
        cancelarOcultacao();
        listeners.forEach(({ elemento, tipo, handler }) => {
            elemento.removeEventListener(tipo, handler);
        });
    };

    usuarioPopoverAtual = { popup, trigger: botao, cleanup };
    botao.setAttribute('aria-expanded', 'true');
    botao.classList.add(USUARIO_TRIGGER_ACTIVE_CLASS);
}

let popoverEventosRegistrados = false;

function prepararPopoversUsuarios() {
    document.querySelectorAll('.usuario-detalhes-trigger').forEach(botao => {
        if (botao.dataset.popoverBound === 'true') return;
        botao.dataset.popoverBound = 'true';
        botao.addEventListener('click', evento => {
            evento.preventDefault();
            evento.stopPropagation();
            if (usuarioPopoverAtual?.trigger === botao) {
                fecharPopoversUsuarios();
                return;
            }
            fecharPopoversUsuarios();
            abrirPopoverUsuario(botao);
        });
    });

    if (!popoverEventosRegistrados) {
        document.addEventListener('click', evento => {
            if (!usuarioPopoverAtual) return;
            const { popup, trigger } = usuarioPopoverAtual;
            if (trigger?.contains(evento.target)) return;
            if (popup?.contains(evento.target)) return;
            fecharPopoversUsuarios();
        });
        document.addEventListener('keydown', evento => {
            if (evento.key === 'Escape') fecharPopoversUsuarios();
        });
        window.addEventListener('resize', fecharPopoversUsuarios);
        window.addEventListener('scroll', fecharPopoversUsuarios, true);
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
    const infoIcon = document.getElementById('usuariosResumoInfo');
    const resumoPopover = document.getElementById('resumoPopover');

    if (infoIcon && resumoPopover) {
        let hideTimeout;

        const posicionarPopover = () => {
            if (!resumoPopover.classList.contains('show')) return;

            const iconRect = infoIcon.getBoundingClientRect();
            const popRect = resumoPopover.getBoundingClientRect();
            const viewportPadding = 16;

            let left = iconRect.left + iconRect.width / 2 - popRect.width / 2;
            left = Math.max(viewportPadding, Math.min(left, window.innerWidth - popRect.width - viewportPadding));

            let top = iconRect.bottom + 12;
            const overflowBottom = top + popRect.height + viewportPadding > window.innerHeight;
            if (overflowBottom) {
                top = iconRect.top - popRect.height - 12;
            }
            if (top < viewportPadding) {
                top = viewportPadding;
            }

            resumoPopover.style.left = `${left}px`;
            resumoPopover.style.top = `${top}px`;
        };

        const limparOcultamento = () => {
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }
        };

        const ocultarPopover = () => {
            limparOcultamento();
            resumoPopover.classList.remove('show');
        };

        const agendarOcultamento = () => {
            limparOcultamento();
            hideTimeout = setTimeout(() => {
                if (!infoIcon.matches(':hover') && !resumoPopover.matches(':hover') && document.activeElement !== infoIcon) {
                    resumoPopover.classList.remove('show');
                }
            }, 120);
        };

        const mostrarPopover = () => {
            limparOcultamento();
            resumoPopover.classList.add('show');
            requestAnimationFrame(posicionarPopover);
        };

        infoIcon.addEventListener('mouseenter', mostrarPopover);
        infoIcon.addEventListener('focus', mostrarPopover);
        infoIcon.addEventListener('mouseleave', agendarOcultamento);
        infoIcon.addEventListener('blur', ocultarPopover);
        infoIcon.addEventListener('keydown', evento => {
            if (evento.key === 'Escape') {
                ocultarPopover();
                infoIcon.blur();
            }
        });

        resumoPopover.addEventListener('mouseenter', limparOcultamento);
        resumoPopover.addEventListener('mouseleave', agendarOcultamento);

        window.addEventListener('resize', posicionarPopover);
        window.addEventListener('scroll', posicionarPopover, { passive: true });
    }
}

function aplicarFiltros() {
    const filtros = coletarFiltros();
    const busca = normalizarParaComparacao(filtros.busca);
    const perfilFiltro = normalizarParaComparacao(filtros.perfil);
    const statusFiltros = new Set(
        filtros.status
            .map(status => normalizarParaComparacao(status))
            .filter(Boolean)
    );

    const filtrados = usuariosCache.filter(u => {
        const nomeNormalizado = normalizarParaComparacao(u.nome);
        const emailNormalizado = normalizarParaComparacao(u.email);

        if (busca && !nomeNormalizado.includes(busca) && !emailNormalizado.includes(busca)) {
            return false;
        }

        if (perfilFiltro) {
            const perfilUsuario = normalizarParaComparacao(u.perfil);
            if (!perfilUsuario || perfilUsuario !== perfilFiltro) {
                return false;
            }
        }

        if (statusFiltros.size > 0) {
            const statusUsuario = normalizarParaComparacao(u.status);
            if (!statusUsuario || !statusFiltros.has(statusUsuario)) {
                return false;
            }
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
        const ultimaEntradaValor = obterPrimeiroValor(u, [
            'ultimaEntradaEm',
            'ultima_entrada_em',
            'ultimaEntrada',
            'ultima_entrada'
        ]);
        const ultimoLoginValor = obterPrimeiroValor(u, [
            'ultimaEntradaEm',
            'ultima_entrada_em',
            'ultimaEntrada',
            'ultima_entrada',
            'ultimoLoginEm',
            'ultimo_login_em',
            'ultimoLogin',
            'ultimo_login'
        ]);
        const ultimaSaidaValor = obterPrimeiroValor(u, [
            'ultimaSaidaEm',
            'ultima_saida_em',
            'ultimaSaida',
            'ultima_saida'
        ]);
        const ultimaAlteracaoValor = obterPrimeiroValor(u, [
            'ultimaAlteracaoEm',
            'ultima_alteracao_em',
            'ultimaAlteracao',
            'ultima_alteracao',
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
        const localUltimaAlteracao = obterPrimeiroValor(u, [
            'localUltimaAlteracao',
            'local_ultima_alteracao',
            'localUltimaAcao',
            'local_ultima_acao'
        ]);
        const especificacaoUltimaAlteracao = obterPrimeiroValor(u, [
            'especificacaoUltimaAlteracao',
            'especificacao_ultima_alteracao',
            'especificacaoUltimaAcao',
            'especificacao_ultima_acao'
        ]);
        const ultimaEntradaTexto = escapeHtml(formatarDataHoraCompleta(ultimaEntradaValor));
        const ultimoLoginTexto =
            ultimaEntradaTexto !== 'Sem registro'
                ? ultimaEntradaTexto
                : escapeHtml(formatarDataHoraCompleta(ultimoLoginValor));
        const ultimaSaidaTexto = escapeHtml(formatarDataHoraCompleta(ultimaSaidaValor));
        const ultimaAlteracaoTexto = escapeHtml(formatarDataHoraCompleta(ultimaAlteracaoValor));
        const ultimaDescricaoTexto = formatarDescricaoAlteracao(
            ultimaDescricaoValor,
            localUltimaAlteracao,
            especificacaoUltimaAlteracao
        );
        tr.innerHTML = `
            <td class="px-6 py-4">
                <div class="w-9 h-9 rounded-full flex items-center justify-center text-white font-medium text-sm" style="background: var(--color-primary)">${iniciais}</div>
            </td>
            <td class="px-6 py-4">
                <div class="usuario-popover-container relative">
                    <div class="flex items-center gap-2">
                        <div class="text-sm font-medium text-white">${nome}</div>
                        <button
                            type="button"
                            class="usuario-detalhes-trigger"
                            aria-expanded="false"
                            aria-haspopup="dialog"
                            title="Ver atividade recente de ${nome}"
                            data-nome="${nome}"
                            data-ultimo-login="${ultimoLoginTexto}"
                            data-ultima-alteracao="${ultimaAlteracaoTexto}"
                            data-ultima-descricao="${ultimaDescricaoTexto}"
                        >
                            <span class="sr-only">Ver atividade recente de ${nome}</span>
                            <span class="info-icon" aria-hidden="true"></span>
                        </button>
                    </div>
                    <div class="usuario-popover glass-surface rounded-xl p-4 text-left text-sm shadow-xl">
                        <div class="usuario-popover-section">
                            <span class="usuario-popover-label">Último login</span>
                            <span class="usuario-popover-value">${ultimoLoginTexto}</span>
                        </div>
                        <div class="usuario-popover-section">
                            <span class="usuario-popover-label">Última entrada</span>
                            <span class="usuario-popover-value">${ultimaEntradaTexto}</span>
                        </div>
                        <div class="usuario-popover-section">
                            <span class="usuario-popover-label">Última saída</span>
                            <span class="usuario-popover-value">${ultimaSaidaTexto}</span>
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
