// Script principal do módulo de Usuários
// Controla carregamento da lista, edições e filtros

async function fetchApi(path, options = {}) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    const finalOptions = { ...options };
    const headers = new Headers(options?.headers || {});

    const usuarioAtual = usuarioLogado || carregarUsuarioLogado();
    const email = typeof usuarioAtual?.email === 'string' ? usuarioAtual.email.trim() : '';
    const usuarioId =
        typeof usuarioAtual?.id === 'number'
            ? usuarioAtual.id
            : Number.isFinite(Number(usuarioAtual?.id))
                ? Number(usuarioAtual.id)
                : null;
    if (email) {
        headers.set('x-usuario-email', email);
    }
    if (usuarioId && !headers.has('x-usuario-id')) {
        headers.set('x-usuario-id', String(usuarioId));
    }
    if (usuarioId && !headers.has('authorization')) {
        headers.set('authorization', `Bearer ${usuarioId}`);
    }

    finalOptions.headers = headers;
    return fetch(`${baseUrl}${path}`, finalOptions);
}

// Cache local dos usuários carregados
let usuariosCache = [];
let usuarioPopoverAtual = null;
let usuarioLogado = null;
let usuariosPermissoesAtuais = {
    podeEditar: false,
    podeEditarDados: false,
    podeGerenciarPermissoes: false,
    podeExcluir: false,
    podeAtivar: false,
    colunaDesabilitada: false
};
const usuariosColunasConfiguradas = new Map();

const USUARIOS_FEATURE_CODES = {
    editar: ['usuarios.editar', 'usuarios:editar', 'usuarios_edit', 'edit-user', 'editar'],
    editarDados: ['usuarios.editar-dados', 'usuarios.editar_dados', 'usuarios.update', 'edit-data'],
    gerenciarPermissoes: [
        'usuarios.permissoes',
        'usuarios:permissoes',
        'usuarios.gerenciar_permissoes',
        'usuarios.manage_permissions',
        'usuarios.permissions'
    ],
    excluir: ['usuarios.excluir', 'usuarios:excluir', 'usuarios_delete', 'delete-user', 'excluir'],
    ativar: ['usuarios.ativar', 'usuarios.alterar_status', 'usuarios.toggle', 'usuarios.activate']
};

const USUARIOS_COLUMN_CODES = {
    acoes: ['acoes', 'actions', 'operacoes', 'options']
};

const USUARIO_TRIGGER_ACTIVE_CLASS = 'usuario-detalhes-trigger--active';

const ONLINE_LIMITE_MINUTOS = 5;

const STATUS_LABEL_MAP = {
    ativo: 'Ativo',
    aguardando_aprovacao: 'Inativo',
    nao_confirmado: 'Não confirmado'
};

const STATUS_BADGE_MAP = {
    ativo: 'badge-success',
    aguardando_aprovacao: 'badge-danger',
    nao_confirmado: 'badge-warning'
};

function normalizarValorVersao(valor) {
    if (valor === null || valor === undefined) return null;
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
        return String(valor.getTime());
    }
    if (typeof valor === 'number' && Number.isFinite(valor)) {
        return String(Math.trunc(valor));
    }
    if (typeof valor === 'string') {
        const trimmed = valor.trim();
        if (!trimmed) return null;
        if (/^\d+$/.test(trimmed)) {
            return trimmed;
        }
        const parsed = Date.parse(trimmed);
        if (!Number.isNaN(parsed)) {
            return String(parsed);
        }
    }
    return null;
}

function extrairAvatarVersao(usuario) {
    if (!usuario || typeof usuario !== 'object') return null;
    const candidatos = [
        usuario.avatar_version,
        usuario.avatarVersion,
        usuario.avatar_updated_at,
        usuario.avatarUpdatedAt,
        usuario.atualizadoEm,
        usuario.atualizado_em,
        usuario.updatedAt,
        usuario.updated_at,
        usuario.ultimaAlteracaoEm,
        usuario.ultima_alteracao_em,
        usuario.ultimaAlteracao,
        usuario.ultima_alteracao
    ];
    for (const candidato of candidatos) {
        const normalizado = normalizarValorVersao(candidato);
        if (normalizado) {
            return normalizado;
        }
    }
    return null;
}

function aplicarCacheBuster(url, versao) {
    if (!url || !versao) return url;
    if (typeof url !== 'string') return url;
    if (/^data:/i.test(url)) return url;

    const [base, fragmento] = url.split('#', 2);
    const encoded = encodeURIComponent(versao);
    let atualizado = base;

    if (/(?:^|[?&])t=/.test(base)) {
        atualizado = base.replace(/([?&])t=[^&]*/, `$1t=${encoded}`);
    } else {
        const separador = base.includes('?') ? '&' : '?';
        atualizado = `${base}${separador}t=${encoded}`;
    }

    return fragmento !== undefined ? `${atualizado}#${fragmento}` : atualizado;
}

function showUsuariosConfirmDialog({
    title = 'Tem certeza?',
    message = '',
    confirmLabel = 'Sim',
    cancelLabel = 'Não'
} = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[2100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4';
        overlay.innerHTML = `
            <div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
                <div class="p-6 text-center space-y-4">
                    <h3 class="text-lg font-semibold text-white">${title}</h3>
                    <p class="text-sm text-gray-300">${message}</p>
                    <div class="flex justify-center gap-4">
                        <button data-action="confirm" class="btn-success px-4 py-2 rounded-lg text-white font-medium min-w-[96px]">${confirmLabel}</button>
                        <button data-action="cancel" class="btn-danger px-4 py-2 rounded-lg text-white font-medium min-w-[96px]">${cancelLabel}</button>
                    </div>
                </div>
            </div>
        `;

        const cleanup = (result) => {
            document.removeEventListener('keydown', handleKeydown);
            overlay.remove();
            resolve(result);
        };

        const handleKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                cleanup(false);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                cleanup(true);
            }
        };

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                cleanup(false);
            }
        });

        overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => cleanup(true));
        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(false));

        document.addEventListener('keydown', handleKeydown);
        document.body.appendChild(overlay);

        const confirmButton = overlay.querySelector('[data-action="confirm"]');
        setTimeout(() => confirmButton.focus(), 50);
    });
}

window.usuariosShowConfirmDialog = showUsuariosConfirmDialog;

function setAcaoBotaoLoading(botao, isLoading) {
    if (!botao) return;
    if (isLoading) {
        botao.disabled = true;
        botao.classList.add('usuario-acao-botao--loading');
        botao.setAttribute('aria-busy', 'true');
    } else {
        botao.disabled = false;
        botao.classList.remove('usuario-acao-botao--loading');
        botao.removeAttribute('aria-busy');
    }
}

function normalizarBoolean(valor) {
    if (typeof valor === 'boolean') {
        return valor;
    }
    if (typeof valor === 'number') {
        return Number.isFinite(valor) && valor !== 0;
    }
    if (typeof valor === 'string') {
        const normalizado = valor.trim().toLowerCase();
        if (!normalizado) return false;
        return ['true', 't', '1', 'sim', 'yes', 'y', 'ativo', 'confirmado', 'aguardando_aprovacao'].includes(normalizado);
    }
    return false;
}

function normalizarStatusInternoValor(valor) {
    if (!valor) return '';
    const normalizado = String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_|_$/g, '')
        .toLowerCase();

    const mapa = {
        ativo: 'ativo',
        active: 'ativo',
        habilitado: 'ativo',
        habilitada: 'ativo',
        aguardando: 'aguardando_aprovacao',
        aguardando_aprovacao: 'aguardando_aprovacao',
        aguardandoaprovacao: 'aguardando_aprovacao',
        pendente: 'aguardando_aprovacao',
        pending: 'aguardando_aprovacao',
        inativo: 'aguardando_aprovacao',
        inativado: 'aguardando_aprovacao',
        desativado: 'aguardando_aprovacao',
        desativada: 'aguardando_aprovacao',
        desativadao: 'aguardando_aprovacao',
        desabilitado: 'aguardando_aprovacao',
        desabilitada: 'aguardando_aprovacao',
        nao_confirmado: 'nao_confirmado',
        nao_confirmada: 'nao_confirmado',
        naoconfirmado: 'nao_confirmado',
        naoconfirmada: 'nao_confirmado',
        nao_confirmados: 'nao_confirmado',
        nao_confirmadas: 'nao_confirmado',
        unconfirmed: 'nao_confirmado',
        aguardando_confirmacao: 'nao_confirmado',
        pendente_confirmacao: 'nao_confirmado',
        email_nao_confirmado: 'nao_confirmado'
    };

    return mapa[normalizado] || normalizado;
}

function obterStatusInterno(usuario) {
    if (!usuario || typeof usuario !== 'object') return '';
    if (typeof usuario.statusInterno === 'string' && usuario.statusInterno.trim()) {
        const normalizado = normalizarStatusInternoValor(usuario.statusInterno);
        if (normalizado) return normalizado;
    }

    if (typeof usuario.status === 'string' && usuario.status.trim()) {
        const normalizado = normalizarStatusInternoValor(usuario.status);
        if (normalizado) return normalizado;
    }

    const confirmacaoOrigem = Object.prototype.hasOwnProperty.call(usuario, 'confirmacao')
        ? usuario.confirmacao
        : Object.prototype.hasOwnProperty.call(usuario, 'emailConfirmado')
            ? usuario.emailConfirmado
            : usuario.email_confirmado;
    const confirmacao = normalizarBoolean(confirmacaoOrigem);

    if (typeof usuario.confirmado === 'boolean') {
        if (usuario.confirmado) return 'ativo';
        if (confirmacao) return 'aguardando_aprovacao';
        return 'nao_confirmado';
    }

    if (typeof usuario.verificado === 'boolean') {
        if (usuario.verificado) return 'ativo';
        if (confirmacao) return 'aguardando_aprovacao';
        return 'nao_confirmado';
    }

    if (typeof usuario.confirmacao === 'boolean' || confirmacaoOrigem !== undefined) {
        return confirmacao ? 'aguardando_aprovacao' : 'nao_confirmado';
    }

    return '';
}

function obterStatusLabel(usuario, statusInterno) {
    const interno = statusInterno || obterStatusInterno(usuario);
    if (usuario && typeof usuario.status === 'string' && usuario.status.trim()) {
        const normalizado = normalizarStatusInternoValor(usuario.status);
        if (STATUS_LABEL_MAP[normalizado]) {
            return STATUS_LABEL_MAP[normalizado];
        }
        return usuario.status;
    }
    return STATUS_LABEL_MAP[interno] || 'Inativo';
}

function obterStatusBadge(usuario, statusInterno) {
    if (usuario && typeof usuario.statusBadge === 'string' && usuario.statusBadge.trim()) {
        return usuario.statusBadge;
    }
    const interno = statusInterno || obterStatusInterno(usuario);
    return STATUS_BADGE_MAP[interno] || 'badge-secondary';
}

function statusPodeSerAlternado(statusInterno) {
    return statusInterno !== 'nao_confirmado' && statusInterno !== '';
}

function carregarUsuarioLogado() {
    try {
        const sessionStore = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
        const localStore = typeof localStorage !== 'undefined' ? localStorage : null;
        const stored = sessionStore?.getItem('currentUser') || localStore?.getItem('user');
        usuarioLogado = stored ? JSON.parse(stored) : null;
        usuariosPermissoesAtuais = calcularPermissoesPorPerfil();
    } catch (err) {
        console.error('Erro ao recuperar usuário logado', err);
        usuarioLogado = null;
        usuariosPermissoesAtuais = calcularPermissoesPorPerfil();
    }
    return usuarioLogado;
}

function calcularPermissoesPorPerfil() {
    const perfil = usuarioLogado?.perfil;
    if (perfil === 'Sup Admin') {
        return {
            podeEditar: true,
            podeEditarDados: true,
            podeGerenciarPermissoes: true,
            podeExcluir: true,
            podeAtivar: true,
            colunaDesabilitada: false
        };
    }
    if (perfil === 'Admin') {
        return {
            podeEditar: true,
            podeEditarDados: true,
            podeGerenciarPermissoes: false,
            podeExcluir: false,
            podeAtivar: true,
            colunaDesabilitada: false
        };
    }
    return {
        podeEditar: false,
        podeEditarDados: false,
        podeGerenciarPermissoes: false,
        podeExcluir: false,
        podeAtivar: false,
        colunaDesabilitada: true
    };
}

function normalizarCodigoGenerico(valor) {
    if (valor === null || valor === undefined) {
        return null;
    }
    const texto = typeof valor === 'string' ? valor : String(valor);
    const trimmed = texto.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.toLowerCase();
}

function possuiRecurso(modulos, codigos, options = {}) {
    if (!window.permissionsService?.isFeatureEnabled) {
        return null;
    }
    const modulesList = Array.isArray(modulos) && modulos.length ? modulos : ['usuarios', 'users', 'menu'];
    const codesList = Array.isArray(codigos) ? codigos : [codigos];
    for (const modulo of modulesList) {
        for (const codigo of codesList) {
            const featureCode = normalizarCodigoGenerico(codigo);
            if (!featureCode) continue;
            if (window.permissionsService.isFeatureEnabled(normalizarCodigoGenerico(modulo) || modulo, featureCode, options)) {
                return true;
            }
        }
    }
    return false;
}

function encontrarColunaUsuarios(codigos = []) {
    const columnCodes = codigos.map(normalizarCodigoGenerico).filter(Boolean);
    for (const codigo of columnCodes) {
        if (usuariosColunasConfiguradas.has(codigo)) {
            return usuariosColunasConfiguradas.get(codigo);
        }
    }
    if (!window.permissionsService?.getCached) {
        return null;
    }
    try {
        const roleKey = window.permissionsService.getActiveRoleKey?.();
        const data = window.permissionsService.getCached(roleKey);
        if (!data) {
            return null;
        }
        const modules = ['usuarios', 'users', 'default'];
        for (const modulo of modules) {
            const moduleEntry = data.columns.get(normalizarCodigoGenerico(modulo) || modulo);
            if (!moduleEntry) continue;
            for (const table of moduleEntry.values()) {
                for (const column of table.columns) {
                    const columnCode = normalizarCodigoGenerico(column.code);
                    if (columnCode && columnCodes.includes(columnCode)) {
                        return column;
                    }
                    if (column.aliases) {
                        for (const alias of column.aliases) {
                            if (columnCodes.includes(normalizarCodigoGenerico(alias))) {
                                return column;
                            }
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn('Não foi possível avaliar colunas do módulo de usuários via serviço de permissões.', err);
    }
    return null;
}

async function atualizarPermissoesUsuarios() {
    const fallback = calcularPermissoesPorPerfil();
    const service = window.permissionsService;
    if (!service?.loadBootstrap) {
        usuariosPermissoesAtuais = fallback;
        return;
    }
    try {
        await service.loadBootstrap();
    } catch (err) {
        console.warn('Não foi possível carregar permissões de usuários via serviço dedicado.', err);
        usuariosPermissoesAtuais = fallback;
        return;
    }

    usuariosColunasConfiguradas.clear();
    try {
        const roleKey = service.getActiveRoleKey?.();
        const data = service.getCached(roleKey);
        if (data) {
            const modules = ['usuarios', 'users', 'default'];
            modules.forEach(modulo => {
                const entry = data.columns.get(normalizarCodigoGenerico(modulo) || modulo);
                if (!entry) return;
                entry.forEach(table => {
                    table.columns.forEach(column => {
                        const codeKey = normalizarCodigoGenerico(column.code);
                        if (codeKey) {
                            usuariosColunasConfiguradas.set(codeKey, column);
                        }
                        if (column.aliases) {
                            column.aliases.forEach(alias => {
                                const aliasKey = normalizarCodigoGenerico(alias);
                                if (aliasKey) {
                                    usuariosColunasConfiguradas.set(aliasKey, column);
                                }
                            });
                        }
                    });
                });
            });
        }
    } catch (err) {
        console.warn('Não foi possível mapear colunas de usuários a partir do serviço de permissões.', err);
    }

    const podeEditar = possuiRecurso(null, USUARIOS_FEATURE_CODES.editar) || false;
    const podeEditarDados =
        possuiRecurso(null, USUARIOS_FEATURE_CODES.editarDados) || podeEditar || false;
    const podeGerenciarPermissoes = possuiRecurso(null, USUARIOS_FEATURE_CODES.gerenciarPermissoes) || false;
    const podeExcluir = possuiRecurso(null, USUARIOS_FEATURE_CODES.excluir) || false;
    const podeAtivarFeature =
        possuiRecurso(null, USUARIOS_FEATURE_CODES.ativar, { scope: 'toggle' }) ||
        possuiRecurso(null, USUARIOS_FEATURE_CODES.ativar) ||
        false;

    const colunaAcoes = encontrarColunaUsuarios(USUARIOS_COLUMN_CODES.acoes);

    usuariosPermissoesAtuais = {
        podeEditar: podeEditar || fallback.podeEditar,
        podeEditarDados: podeEditarDados || fallback.podeEditarDados,
        podeGerenciarPermissoes: podeGerenciarPermissoes || fallback.podeGerenciarPermissoes,
        podeExcluir: podeExcluir || fallback.podeExcluir,
        podeAtivar: podeAtivarFeature || fallback.podeAtivar,
        colunaDesabilitada: colunaAcoes
            ? columnVisibilityIndicaBloqueio(colunaAcoes)
            : fallback.colunaDesabilitada
    };

    aplicarConfiguracaoCabecalhoUsuarios();
}

function columnVisibilityIndicaBloqueio(column) {
    if (!column) return false;
    if (column.canView === false) return true;
    const visibility = normalizarCodigoGenerico(column.visibility);
    return visibility === 'hidden';
}

function obterConfiguracaoColuna(codigos) {
    const lista = Array.isArray(codigos) ? codigos : [codigos];
    for (const codigo of lista) {
        const normalized = normalizarCodigoGenerico(codigo);
        if (normalized && usuariosColunasConfiguradas.has(normalized)) {
            return usuariosColunasConfiguradas.get(normalized);
        }
    }
    return null;
}

function aplicarMascaraValor(config, valor) {
    if (!config) {
        return valor;
    }
    const mask = config.mask ?? config.metadata?.mask ?? config.metadata?.mascara ?? null;
    if (typeof mask === 'string' && mask.trim()) {
        return mask;
    }
    return valor;
}

function aplicarConfiguracaoCabecalhoUsuarios() {
    const headers = document.querySelectorAll('#usuariosTableWrapper th[data-column-key]');
    headers.forEach(header => {
        const key = header.dataset.columnKey;
        const config = obterConfiguracaoColuna(key);
        const oculto = columnVisibilityIndicaBloqueio(config);
        header.classList.toggle('hidden', oculto);
        header.dataset.canSort = config ? String(config.canSort !== false) : 'true';
        header.dataset.canFilter = config ? String(config.canFilter !== false) : 'true';
        header.dataset.exportPerm = config ? String(config.exportPerm !== false) : 'true';
    });
}

function obterPermissoesUsuario() {
    return usuariosPermissoesAtuais;
}

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

function escapeAttribute(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function obterAvatarUrl(usuario) {
    if (!usuario || typeof usuario !== 'object') return null;
    const candidatos = [
        usuario.avatar_url,
        usuario.avatarUrl,
        usuario.fotoUrl,
        usuario.foto,
        usuario.fotoUsuario,
        usuario.foto_usuario,
        usuario.avatar
    ];

    const loadablePattern = /^(?:data:|blob:|file:|https?:|\/\/)/i;
    const versao = extrairAvatarVersao(usuario);

    for (const candidato of candidatos) {
        if (!candidato) continue;
        if (typeof candidato === 'string') {
            const trimmed = candidato.trim();
            if (!trimmed) continue;
            if (/^data:image\//i.test(trimmed)) {
                return trimmed;
            }

            let resolved = trimmed;
            if (typeof window.apiConfig?.resolveUrl === 'function') {
                resolved = window.apiConfig.resolveUrl(trimmed);
            }
            const resolvedTrimmed = typeof resolved === 'string' ? resolved.trim() : '';
            if (resolvedTrimmed && loadablePattern.test(resolvedTrimmed)) {
                return aplicarCacheBuster(resolvedTrimmed, versao);
            }

            const base64Regex = /^[A-Za-z0-9+/=\s]+$/;
            if (base64Regex.test(trimmed)) {
                const sanitized = trimmed.replace(/\s+/g, '');
                if (sanitized) {
                    return `data:image/png;base64,${sanitized}`;
                }
            }
        } else if (typeof candidato === 'object' && candidato.type === 'Buffer' && Array.isArray(candidato.data)) {
            try {
                const buffer = Uint8Array.from(candidato.data);
                if (buffer.length) {
                    let binary = '';
                    const chunkSize = 0x8000;
                    for (let i = 0; i < buffer.length; i += chunkSize) {
                        const chunk = buffer.subarray(i, i + chunkSize);
                        binary += String.fromCharCode.apply(null, chunk);
                    }
                    return `data:image/png;base64,${btoa(binary)}`;
                }
            } catch (err) {
                // ignore buffer conversion failures
            }
        }
    }

    return null;
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

function temFiltrosAplicados() {
    const filtros = coletarFiltros();
    if (filtros.busca && filtros.busca.trim()) return true;
    if (filtros.perfil && filtros.perfil.trim()) return true;
    return Array.isArray(filtros.status) && filtros.status.length > 0;
}

async function initUsuarios() {
    carregarUsuarioLogado();
    await atualizarPermissoesUsuarios().catch(err => {
        console.warn('Falha ao atualizar permissões do módulo de usuários via serviço dedicado.', err);
    });

    const btnModelosPermissao = document.getElementById('btnModelosPermissao');
    if (btnModelosPermissao) {
        if (usuariosPermissoesAtuais.podeGerenciarPermissoes) {
            btnModelosPermissao.classList.remove('hidden');
            btnModelosPermissao.addEventListener('click', () => {
                window.usuarioModelosPermissoesContext = { podeGerenciarPermissoes: true };
                openModalWithSpinner(
                    'modals/usuarios/modelos-permissoes.html',
                    '../js/modals/usuario-modelos-permissoes.js',
                    'modelosPermissoes'
                );
            });
        } else {
            btnModelosPermissao.classList.add('hidden');
        }
    }
    // animação de entrada
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    carregarUsuarios();

    document.getElementById('btnNovoUsuario')?.addEventListener('click', () => {
        abrirNovoUsuario();
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
            .map(status => normalizarStatusInternoValor(status))
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
            const statusUsuario = obterStatusInterno(u);
            if (!statusUsuario || !statusFiltros.has(statusUsuario)) {
                return false;
            }
        }
        return true;
    });
    renderUsuarios(filtrados);
}

function sanitizarTextoPlano(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/[<>]/g, '')
        .replace(/[\n\r\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function renderUsuarios(lista) {
    const tbody = document.getElementById('listaUsuarios');
    if (!tbody) return;
    fecharPopoversUsuarios();
    tbody.innerHTML = '';
    const permissoes = obterPermissoesUsuario();

    lista.forEach(u => {
        const tr = document.createElement('tr');
        tr.classList.add('table-row');
        const nomeOriginal = typeof u.nome === 'string' ? u.nome : '';
        const baseParaIniciais = nomeOriginal || (typeof u.email === 'string' ? u.email : '');
        const iniciais = baseParaIniciais
            .split(' ')
            .map(p => p[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
        const iniciaisSeguro = escapeHtml(iniciais);
        const online = resolverStatusOnline(u);
        const sessaoClasse = online ? 'usuario-sessao-badge online' : 'usuario-sessao-badge offline';
        const sessaoRotulo = online ? 'Online' : 'Offline';
        const avatarUrl = obterAvatarUrl(u);
        const avatarAltTexto = nomeOriginal ? `Avatar de ${nomeOriginal}` : 'Avatar do usuário';
        const avatarAlt = escapeAttribute(avatarAltTexto);
        const avatarMarkup = avatarUrl
            ? `<div class="usuario-avatar usuario-avatar--list usuario-avatar--has-image"><img src="${escapeAttribute(avatarUrl)}" alt="${avatarAlt}" class="usuario-avatar__image" loading="lazy" /></div>`
            : `<div class="usuario-avatar usuario-avatar--list"><span class="usuario-avatar__initials">${iniciaisSeguro || 'US'}</span></div>`;
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
        const horaAtivacaoValor = obterPrimeiroValor(u, [
            'horaAtivacaoEm',
            'hora_ativacao',
            'horaAtivacao'
        ]);
        const horaAtivacaoTexto = formatarDataHoraCompleta(horaAtivacaoValor);
        const statusInterno = obterStatusInterno(u) || 'aguardando_aprovacao';
        const statusRotulo = obterStatusLabel(u, statusInterno);
        const statusBadgeClasse = obterStatusBadge(u, statusInterno);
        const podeAlternarStatus = statusPodeSerAlternado(statusInterno);

        const colunaAvatarConfig = obterConfiguracaoColuna(['avatar', 'foto', 'photo']);
        const colunaNomeConfig = obterConfiguracaoColuna(['nome', 'name', 'full_name']);
        const colunaEmailConfig = obterConfiguracaoColuna(['email', 'mail']);
        const colunaPerfilConfig = obterConfiguracaoColuna(['perfil', 'role']);
        const colunaSessaoConfig = obterConfiguracaoColuna(['situacao', 'sessao', 'session']);
        const colunaStatusConfig = obterConfiguracaoColuna(['status']);
        const colunaAcoesConfig = obterConfiguracaoColuna(USUARIOS_COLUMN_CODES.acoes);

        const avatarHiddenClass = colunaAvatarConfig && columnVisibilityIndicaBloqueio(colunaAvatarConfig) ? ' hidden' : '';
        const nomeHiddenClass = colunaNomeConfig && columnVisibilityIndicaBloqueio(colunaNomeConfig) ? ' hidden' : '';
        const emailHiddenClass = colunaEmailConfig && columnVisibilityIndicaBloqueio(colunaEmailConfig) ? ' hidden' : '';
        const perfilHiddenClass = colunaPerfilConfig && columnVisibilityIndicaBloqueio(colunaPerfilConfig) ? ' hidden' : '';
        const sessaoHiddenClass = colunaSessaoConfig && columnVisibilityIndicaBloqueio(colunaSessaoConfig) ? ' hidden' : '';
        const statusHiddenClass = colunaStatusConfig && columnVisibilityIndicaBloqueio(colunaStatusConfig) ? ' hidden' : '';
        const acoesHiddenClass = colunaAcoesConfig && columnVisibilityIndicaBloqueio(colunaAcoesConfig) ? ' hidden' : '';

        const nomeComMascara = aplicarMascaraValor(colunaNomeConfig, nomeOriginal);
        const nomeDisplay = escapeHtml(nomeComMascara);
        const nomeAtributo = escapeAttribute(nomeComMascara);
        const nomePlano = sanitizarTextoPlano(nomeComMascara) || 'este usuário';
        const emailComMascara = aplicarMascaraValor(colunaEmailConfig, u.email);
        const emailDisplay = escapeHtml(emailComMascara);
        const perfilComMascara = aplicarMascaraValor(colunaPerfilConfig, u.perfil || '');
        const perfilDisplay = escapeHtml(perfilComMascara);
        const sessaoRotuloComMascara = aplicarMascaraValor(colunaSessaoConfig, sessaoRotulo);
        const sessaoRotuloDisplay = escapeHtml(sessaoRotuloComMascara);
        const statusRotuloComMascara = aplicarMascaraValor(colunaStatusConfig, statusRotulo);
        const statusRotuloDisplay = escapeHtml(statusRotuloComMascara);

        tr.innerHTML = `
            <td data-column-key="avatar" class="px-6 py-4${avatarHiddenClass}">
                ${avatarMarkup}
            </td>
            <td data-column-key="nome" class="px-6 py-4${nomeHiddenClass}">
                <div class="usuario-popover-container relative">
                    <div class="flex items-center gap-2">
                        <div class="text-sm font-medium text-white">${nomeDisplay}</div>
                        <button
                            type="button"
                            class="usuario-detalhes-trigger"
                            aria-expanded="false"
                            aria-haspopup="dialog"
                            title="Ver atividade recente de ${nomeDisplay}"
                            data-nome="${nomeAtributo}"
                            data-ultimo-login="${ultimoLoginTexto}"
                            data-ultima-alteracao="${ultimaAlteracaoTexto}"
                            data-ultima-descricao="${ultimaDescricaoTexto}"
                        >
                            <span class="sr-only">Ver atividade recente de ${nomeDisplay}</span>
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
            <td data-column-key="email" class="px-6 py-4 text-sm text-white${emailHiddenClass}">${emailDisplay}</td>
            <td data-column-key="perfil" class="px-6 py-4 text-sm text-white${perfilHiddenClass}">${perfilDisplay}</td>
            <td data-column-key="situacao" class="px-6 py-4${sessaoHiddenClass}">
                <span class="${sessaoClasse}">
                    <span class="status-dot"></span>
                    ${sessaoRotuloDisplay}
                </span>
            </td>
            <td data-column-key="status" class="px-6 py-4${statusHiddenClass}">
                <span class="${statusBadgeClasse} px-2 py-1 rounded-full text-xs font-medium">${statusRotuloDisplay}</span>
            </td>`;

        if (avatarUrl) {
            const avatarContainer = tr.querySelector('.usuario-avatar');
            const avatarImage = avatarContainer?.querySelector('img');
            if (avatarContainer && avatarImage) {
                const fallbackInitials = iniciais || 'US';
                avatarImage.addEventListener(
                    'error',
                    () => {
                        avatarContainer.classList.remove('usuario-avatar--has-image');
                        avatarContainer.innerHTML = '';
                        const initialsSpan = document.createElement('span');
                        initialsSpan.className = 'usuario-avatar__initials';
                        initialsSpan.textContent = fallbackInitials;
                        avatarContainer.appendChild(initialsSpan);
                    },
                    { once: true }
                );
            }
        }

        const actionsTd = document.createElement('td');
        actionsTd.className = `px-6 py-4${acoesHiddenClass}`;
        actionsTd.dataset.columnKey = 'acoes';
        const actionsWrapper = document.createElement('div');
        actionsWrapper.className = 'flex items-center gap-2 usuario-acoes';
        if (permissoes.colunaDesabilitada) {
            actionsWrapper.classList.add('usuario-acoes--desabilitadas');
        }

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'usuario-acao-botao usuario-acao-botao--toggle';
        toggleBtn.dataset.usuarioId = u.id;
        toggleBtn.dataset.usuarioStatus = statusInterno;
        const isAtivo = statusInterno === 'ativo';
        const isNaoConfirmado = statusInterno === 'nao_confirmado';
        toggleBtn.setAttribute('aria-label', `${isAtivo ? 'Desativar' : 'Ativar'} ${nomePlano}`);
        if (isAtivo) {
            toggleBtn.classList.add('usuario-acao-botao--ativo');
        }
        const toggleIcon = document.createElement('i');
        toggleIcon.classList.add('fas', 'fa-plug', 'usuario-acao-icone');
        toggleIcon.classList.add(isAtivo ? 'usuario-acao-icone--on' : 'usuario-acao-icone--off');
        toggleBtn.appendChild(toggleIcon);
        if (isNaoConfirmado) {
            toggleBtn.title = 'Confirmação de e-mail pendente';
        } else if (horaAtivacaoTexto && horaAtivacaoTexto !== 'Sem registro') {
            toggleBtn.title =
                isAtivo
                    ? `Desativar acesso (ativado em ${horaAtivacaoTexto})`
                    : `Ativar acesso (última ativação em ${horaAtivacaoTexto})`;
        } else {
            toggleBtn.title = isAtivo ? 'Desativar acesso' : 'Ativar acesso';
        }

        const podeAlternar =
            podeAlternarStatus && permissoes.podeAtivar && !permissoes.colunaDesabilitada;

        if (!podeAlternar) {
            toggleBtn.classList.add('usuario-acao-botao--disabled');
            toggleBtn.disabled = true;
        }

        if (podeAlternar) {
            toggleBtn.addEventListener('click', () => alternarStatusUsuario(toggleBtn));
        }

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'usuario-acao-botao';
        editBtn.dataset.acao = 'editar';
        editBtn.title = `Editar ${nomePlano}`;
        const editIcon = document.createElement('i');
        editIcon.classList.add('fas', 'fa-edit', 'usuario-acao-icone');
        editIcon.style.color = 'var(--color-primary)';
        editBtn.appendChild(editIcon);
        if (!permissoes.podeEditar || permissoes.colunaDesabilitada) {
            editBtn.classList.add('usuario-acao-botao--disabled');
            editBtn.disabled = true;
            editIcon.style.color = 'rgba(255, 255, 255, 0.45)';
        } else {
            editBtn.addEventListener('click', () => {
                abrirEditarUsuario(u);
            });
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'usuario-acao-botao';
        deleteBtn.dataset.acao = 'remover';
        deleteBtn.dataset.usuarioId = String(u.id || '');
        deleteBtn.title = `Excluir ${nomePlano}`;
        const deleteIcon = document.createElement('i');
        deleteIcon.classList.add('fas', 'fa-trash', 'usuario-acao-icone');
        deleteIcon.style.color = 'var(--color-red)';
        deleteBtn.appendChild(deleteIcon);
        if (!permissoes.podeExcluir || permissoes.colunaDesabilitada) {
            deleteBtn.classList.add('usuario-acao-botao--disabled');
            deleteBtn.disabled = true;
            deleteIcon.style.color = 'rgba(255, 255, 255, 0.45)';
        } else {
            deleteBtn.addEventListener('click', () => handleRemoverUsuario(u, deleteBtn));
        }

        actionsWrapper.appendChild(toggleBtn);
        actionsWrapper.appendChild(editBtn);
        actionsWrapper.appendChild(deleteBtn);
        actionsTd.appendChild(actionsWrapper);
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
    });

    aplicarConfiguracaoCabecalhoUsuarios();
    prepararPopoversUsuarios();
    updateEmptyStateUsuarios(lista.length > 0);
}

async function handleRemoverUsuario(usuario, botao) {
    if (!usuario || !usuario.id || !botao || botao.disabled) return;

    const nomeOuEmail = usuario.nome?.trim() || usuario.email?.trim() || 'este usuário';
    const confirmou = await showUsuariosConfirmDialog({
        title: 'Excluir usuário',
        message: `Tem certeza de que deseja excluir ${nomeOuEmail}? Essa ação não poderá ser desfeita.`,
        confirmLabel: 'Sim',
        cancelLabel: 'Não'
    });

    if (!confirmou) {
        return;
    }

    setAcaoBotaoLoading(botao, true);

    try {
        const resp = await fetchApi(`/api/usuarios/${encodeURIComponent(usuario.id)}`, {
            method: 'DELETE'
        });
        let payload = {};
        try {
            payload = await resp.json();
        } catch (err) {
            payload = {};
        }

        if (resp.ok) {
            usuariosCache = usuariosCache.filter((item) => Number(item.id) !== Number(usuario.id));
            refreshUsuariosAposAtualizacao();
            if (typeof window.showToast === 'function') {
                window.showToast(payload.message || 'Exclusão concluída com sucesso.', 'success');
            }
            return;
        }

        if (resp.status === 409 && Array.isArray(payload.associacoes)) {
            const desejaTransferir = await showUsuariosConfirmDialog({
                title: 'Transferir dados do usuário',
                message:
                    payload.message ||
                    'Não foi possível excluir este usuário pois existem dados atrelados a ele. Deseja transferir esses dados para outro usuário?',
                confirmLabel: 'Sim',
                cancelLabel: 'Não'
            });

            if (desejaTransferir) {
                abrirTransferenciaUsuarioModal(usuario, payload.associacoes);
            }
        } else if (typeof window.showToast === 'function') {
            window.showToast(payload.error || 'Erro ao excluir usuário.', 'error');
        }
        console.error(
            'Falha ao excluir usuário:',
            Object.assign({ status: resp.status, statusText: resp.statusText }, payload || {})
        );
    } catch (err) {
        console.error('Erro ao excluir usuário:', err);
        if (typeof window.showToast === 'function') {
            window.showToast('Erro ao excluir usuário.', 'error');
        }
    } finally {
        setAcaoBotaoLoading(botao, false);
    }
}

function abrirTransferenciaUsuarioModal(usuario, associacoes) {
    if (!usuario) return;
    const usuariosDisponiveis = usuariosCache
        .filter((item) => Number(item.id) !== Number(usuario.id))
        .map((item) => ({ id: item.id, nome: item.nome, email: item.email }));

    window.usuarioTransferenciaContext = {
        usuario: { ...usuario },
        associacoes,
        usuariosDisponiveis
    };

    openModalWithSpinner('modals/usuarios/transferir.html', '../js/modals/usuario-transferir.js', 'transferirUsuario');
}

function atualizarResumo() {
    const totalEl = document.getElementById('totalUsuarios');
    const statusEl = document.getElementById('distribuicaoStatus');
    const perfisEl = document.getElementById('distribuicaoPerfis');
    if (!totalEl || !statusEl || !perfisEl) return;

    totalEl.textContent = usuariosCache.length;

    const statusCounts = usuariosCache.reduce((acc, u) => {
        const key = obterStatusInterno(u) || 'desconhecido';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    statusEl.innerHTML = '';
    const statusConfig = {
        ativo: { class: STATUS_BADGE_MAP.ativo, label: 'Ativos' },
        aguardando_aprovacao: { class: STATUS_BADGE_MAP.aguardando_aprovacao, label: 'Inativos' },
        nao_confirmado: { class: STATUS_BADGE_MAP.nao_confirmado, label: 'Não confirmados' }
    };
    Object.entries(statusCounts).forEach(([status, count]) => {
        const cfg = statusConfig[status] || { class: 'badge-secondary', label: STATUS_LABEL_MAP[status] || status };
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

function refreshUsuariosAposAtualizacao() {
    if (temFiltrosAplicados()) {
        aplicarFiltros();
    } else {
        renderUsuarios(usuariosCache);
    }
    atualizarResumo();
}

function openModalWithSpinner(htmlPath, scriptPath, overlayId) {
    Modal.closeAll();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center';
    spinner.innerHTML = '<div class="w-16 h-16 border-4 border-[#b6a03e] border-t-transparent rounded-full animate-spin"></div>';
    document.body.appendChild(spinner);

    const start = Date.now();

    function handleLoaded(event) {
        if (event.detail !== overlayId) return;
        const overlay = document.getElementById(`${overlayId}Overlay`);
        const elapsed = Date.now() - start;

        const show = () => {
            spinner.remove();
            if (overlay) {
                overlay.classList.remove('hidden');
            }
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

function abrirNovoUsuario() {
    openModalWithSpinner('modals/usuarios/novo.html', '../js/modals/usuario-novo.js', 'novoUsuario');
}

function abrirEditarUsuario(usuario) {
    if (!usuario) return;
    const permissoes = obterPermissoesUsuario();
    window.usuarioEditar = {
        ...usuario,
        podeEditarDados: Boolean(permissoes.podeEditarDados),
        podeGerenciarPermissoes: Boolean(permissoes.podeGerenciarPermissoes)
    };
    window.usuarioEditarContext = {
        podeEditarDados: Boolean(permissoes.podeEditarDados),
        podeGerenciarPermissoes: Boolean(permissoes.podeGerenciarPermissoes)
    };
    openModalWithSpinner('modals/usuarios/editar.html', '../js/modals/usuario-editar.js', 'editarUsuario');
}

window.abrirEditarUsuario = abrirEditarUsuario;
window.abrirNovoUsuario = abrirNovoUsuario;

async function alternarStatusUsuario(botao) {
    if (!botao || botao.disabled) return;
    const usuarioId = Number(botao.dataset.usuarioId);
    if (!usuarioId) return;
    const statusAtualInterno = normalizarStatusInternoValor(botao.dataset.usuarioStatus) || 'aguardando_aprovacao';
    const novoStatusInterno = statusAtualInterno === 'ativo' ? 'aguardando_aprovacao' : 'ativo';

    botao.disabled = true;
    botao.classList.add('usuario-acao-botao--loading');

    try {
        const resp = await fetchApi(`/api/usuarios/${usuarioId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: novoStatusInterno })
        });

        if (!resp.ok) {
            const texto = await resp.text();
            throw new Error(texto || 'Falha ao atualizar status');
        }

        const atualizado = await resp.json();
        const idx = usuariosCache.findIndex(user => Number(user.id) === Number(atualizado.id || usuarioId));
        if (idx !== -1) {
            usuariosCache[idx] = {
                ...usuariosCache[idx],
                ...atualizado
            };
        }

        botao.dataset.usuarioStatus = atualizado.statusInterno || novoStatusInterno;
        refreshUsuariosAposAtualizacao();
    } catch (err) {
        console.error('Erro ao alternar status do usuário:', err);
    } finally {
        botao.disabled = false;
        botao.classList.remove('usuario-acao-botao--loading');
    }
}

async function carregarUsuarios() {
    try {
        const resp = await fetchApi('/api/usuarios/lista');
        usuariosCache = await resp.json();
        renderUsuarios(usuariosCache);
        atualizarResumo();
    } catch (err) {
        console.error('Erro ao carregar usuários:', err);
    }
}

window.addEventListener('usuarioAtualizado', () => carregarUsuarios());
window.addEventListener('usuariosModeloPermissaoAtualizado', (event) => {
    if (event?.detail?.refresh) {
        carregarUsuarios();
    }
});
window.addEventListener('usuarioTransferenciaConcluida', () => {
    carregarUsuarios();
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUsuarios);
} else {
    initUsuarios();
}
