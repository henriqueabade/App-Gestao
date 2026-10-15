// Script principal do módulo de Usuários
// Controla carregamento da lista, edições e filtros

async function fetchApi(path, options = {}, contextoAuditoria) {
    const auditoria = contextoAuditoria ?? window.AuditoriaAcao?.vincular();
    const fetchVinculado = auditoria?.fetch || fetch;
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    baseApiParaFotos = baseUrl || '';

    const finalOptions = { ...options };
    const headers = new Headers(options?.headers || {});

    // Carrega usuário atual
    const usuarioAtual = usuarioLogado || carregarUsuarioLogado();

    // Extrai e normaliza EMAIL
    const email = typeof usuarioAtual?.email === 'string'
        ? usuarioAtual.email.trim()
        : '';

    if (email) {
        headers.set('x-usuario-email', email);
    }

    // Extrai e normaliza ID (para headers auxiliares)
    const usuarioId =
        typeof usuarioAtual?.id === 'number'
            ? usuarioAtual.id
            : Number.isFinite(Number(usuarioAtual?.id))
                ? Number(usuarioAtual.id)
                : null;

    if (usuarioId && !headers.has('x-usuario-id')) {
        headers.set('x-usuario-id', String(usuarioId));
    }

    // ======== 🔥 AQUÍ CORRIGIMOS O PROBLEMA PRINCIPAL 🔥 ========

    // Tenta encontrar o token JWT salvo
    const token =
        usuarioAtual?.token ||
        usuarioAtual?.jwt ||
        usuarioAtual?.accessToken ||
        usuarioAtual?.access_token ||
        null;

    // Só define authorization se ainda não foi definido manualmente
    if (token && !headers.has('authorization')) {
        headers.set('authorization', `Bearer ${token}`);
    }

    // NÃO enviar mais Bearer <usuarioId> !! (erro original)
    // ==========================================================

    finalOptions.headers = headers;

    return fetchVinculado(`${baseUrl}${path}`, finalOptions);
}


// Cache local dos usuários carregados
let usuariosCache = [];
let usuarioPopoverAtual = null;
let usuarioLogado = null;

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
    if (/^(?:blob|data):/i.test(url)) return url;

    const [base, fragmento] = url.split('#', 2);
    const encoded = encodeURIComponent(versao);
    const separador = base.includes('?') ? '&' : '?';
    const atualizado = `${base}${separador}v=${encoded}`;

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
        overlay.className = 'app-message-overlay fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4';
        overlay.innerHTML = `
            <div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
                <div class="p-6 text-center space-y-4">
                    <h3 class="ctl-modal-titulo text-white">${title}</h3>
                    <p class="text-sm text-gray-300">${message}</p>
                    <div class="ctl-acoes justify-center">
                        <button data-action="confirm" class="btn-success ctl-botao text-white min-w-[96px]">${confirmLabel}</button>
                        <button data-action="cancel" class="btn-danger ctl-botao text-white min-w-[96px]">${cancelLabel}</button>
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
    } catch (err) {
        console.error('Erro ao recuperar usuário logado', err);
        usuarioLogado = null;
    }
    return usuarioLogado;
}

function obterPermissoesUsuario() {
    const perfil = usuarioLogado?.perfil;
    const isSupAdmin = perfil === 'Sup Admin';
    const isAdmin = perfil === 'Admin';

    if (isSupAdmin) {
        return {
            podeEditar: true,
            podeEditarDados: true,
            podeGerenciarPermissoes: true,
            podeExcluir: true,
            podeAtivar: true,
            colunaDesabilitada: false
        };
    }

    if (isAdmin) {
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

// Base da API, guardada de forma sincrona: a renderizacao da tabela e sincrona
// e nao pode esperar por uma Promise.
let baseApiParaFotos = '';
(async () => {
    try {
        baseApiParaFotos = (await window.apiConfig.getApiBaseUrl()) || '';
    } catch (err) {
        console.error('[usuarios] nao foi possivel resolver a base da API para as fotos.', err);
    }
})();

/**
 * A lista de usuários devolve a foto em `foto_perfil` como CAMINHO RELATIVO
 * (ex.: "/imagens/perfis/13-....webp"). Esse campo não estava entre os
 * candidatos — só variantes já absolutas como `foto_perfil_url`, que a rota da
 * lista não produz. Resultado: o avatar caía sempre nas iniciais.
 * Aqui incluímos `foto_perfil` e resolvemos o caminho contra a base da API
 * (a página roda em file://, então um caminho relativo não resolveria sozinho).
 */
function resolverUrlDaFoto(valor) {
    const bruto = String(valor || '').trim();
    if (!bruto) return null;
    if (/^(https?:\/\/|data:image\/|blob:|file:)/i.test(bruto)) return bruto;
    if (/^[a-z][\w+.-]*:/i.test(bruto)) return null;
    if (!baseApiParaFotos) return null;          // sem base não há como montar
    const base = baseApiParaFotos.replace(/\/+$/, '');
    const caminho = bruto.startsWith('/') ? bruto : `/${bruto}`;
    return `${base}${caminho}`;
}

function obterAvatarUrl(usuario) {
    if (!usuario || typeof usuario !== 'object') return null;
    const candidatos = [
        // O backend já escolheu e normalizou a foto atual. Um caminho antigo
        // em foto_perfil não deve esconder o dataURL retornado em foto_usuario.
        usuario.foto_usuario,
        usuario.fotoUsuario,
        usuario.avatar,
        usuario.avatar_url,
        usuario.avatarUrl,
        usuario.fotoUrl,
        usuario.foto,
        usuario.foto_perfil_url,
        usuario.foto_perfil,
        usuario.fotoPerfil,
        usuario.fotoPerfilUrl
    ];

    const versao = extrairAvatarVersao(usuario);

    for (const candidato of candidatos) {
        if (!candidato || typeof candidato !== 'string') continue;
        const url = resolverUrlDaFoto(candidato);
        if (!url) continue;
        return aplicarCacheBuster(url, versao);
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

/**
 * Monta a frase de "Alteração registrada".
 *
 * A leitura precisa responder duas coisas: EM QUE MÓDULO a pessoa mexeu e O QUE
 * ela fez. Antes, quando só existia o módulo, saía "Usuário alterou o módulo
 * Produtos" — verdadeiro e inútil. Agora o módulo vira um rótulo e o detalhe
 * vem logo em seguida:
 *
 *   Produtos — Atualizou o produto 12 (nome Mesa Lateral)
 *
 * Sem o detalhe, ainda dizemos o módulo; sem o módulo, só o detalhe.
 */
function formatarDescricaoAlteracao(descricao, local, especificacao) {
    const localLimpo = local && String(local).trim();
    const especificacaoLimpa = especificacao && String(especificacao).trim();

    if (localLimpo || especificacaoLimpa) {
        const detalhes = !especificacaoLimpa ? [] : especificacaoLimpa
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

        if (localLimpo && detalhes.length) {
            return `<strong>${escapeHtml(localLimpo)}</strong> — ${detalhes.join(' | ')}`;
        }
        if (detalhes.length) {
            return detalhes.join(' | ');
        }
        if (localLimpo) {
            return `<strong>${escapeHtml(localLimpo)}</strong> — alteração sem detalhe registrado`;
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

/**
 * A situação na tabela (decisão do dono, 02/10/2026):
 *   online   sessão aberta no programa (entrada depois da saída) — verde;
 *   ausente  sem sessão, mas o programa está rodando perto do relógio (o
 *            computador manda sinal a cada minuto — `programa_rodando`) — amarelo;
 *   offline  programa fechado de verdade — vermelho.
 */
const PRESENCA = {
    online: { classe: 'online', rotulo: 'Online' },
    ausente: { classe: 'ausente', rotulo: 'Ausente' },
    offline: { classe: 'offline', rotulo: 'Offline' }
};
function resolverPresenca(usuario) {
    if (resolverStatusOnline(usuario)) return 'online';
    return usuario && usuario.programa_rodando === true ? 'ausente' : 'offline';
}

// ---------------------------------------------------------------------------
// Termos de Uso e Política de Privacidade (15/10/2026).
// Coluna "Termos": Aceito (verde) quando a pessoa aceitou a versão vigente
// dos dois documentos; Desatualizado (amarelo) para aceite anterior e
// Pendente (vermelho) para quem ainda não aceitou. Quem decide é o backend
// (`termos_situacao` em /api/usuarios/lista). O botão de Ações pede o aceite:
// só o Sup Admin, com os termos pendentes ou desatualizados.
// ---------------------------------------------------------------------------
const TERMOS_SEM_SQL = 'Rode sql/usuarios_termos.sql e reinicie a API do banco para usar o aceite dos termos.';

function resolverTermos(usuario) {
    const situacao = usuario?.termos_situacao;
    if (situacao === 'aceito' || situacao === 'desatualizado') {
        const versoes = [
            usuario.termos_versao ? `Termos de Uso ${usuario.termos_versao}` : '',
            usuario.privacidade_versao ? `Política de Privacidade ${usuario.privacidade_versao}` : ''
        ].filter(Boolean).join(' e ');
        const anterior = `Aceito em ${formatarDataHoraCompleta(usuario.termos_aceitos_em)}${versoes ? ` (${versoes})` : ''}`;
        if (situacao === 'aceito') return { situacao, rotulo: 'Aceito', classe: 'badge-success', dica: anterior };
        const pedido = usuario.termos_solicitado
            ? `Aceite da versão vigente pedido em ${formatarDataHoraCompleta(usuario.termos_solicitados_em)}: aguardando a resposta.`
            : 'O Sup Admin pode pedir o aceite da versão vigente pelo botão de termos, em Ações.';
        return { situacao, rotulo: 'Desatualizado', classe: 'badge-warning', dica: `${anterior}. Os documentos foram atualizados. ${pedido}` };
    }
    if (situacao === 'pendente') {
        const partes = [];
        if (usuario.termos_solicitado) {
            partes.push(`Aceite pedido em ${formatarDataHoraCompleta(usuario.termos_solicitados_em)}: aparece para a pessoa ao entrar no programa.`);
        } else {
            partes.push('Ainda não aceitou os termos. O Sup Admin pede o aceite pelo botão de termos, em Ações.');
        }
        if (usuario.termos_recusados_em) {
            partes.push(`Recusou em ${formatarDataHoraCompleta(usuario.termos_recusados_em)}.`);
        }
        return { situacao: 'pendente', rotulo: 'Pendente', classe: 'badge-danger', dica: partes.join(' ') };
    }
    return { situacao: 'indisponivel', rotulo: '—', classe: 'badge-secondary', dica: TERMOS_SEM_SQL };
}

function ehSupAdminLogado() {
    return Boolean(window.Permissoes?.supAdmin) || usuarioLogado?.perfil === 'Sup Admin';
}

/** O botão "pedir o aceite dos termos" da linha (ícone de documento assinado). */
function criarBotaoDosTermos(usuario) {
    const termos = resolverTermos(usuario);
    const nome = typeof usuario.nome === 'string' && usuario.nome ? usuario.nome : 'este usuário';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'usuario-acao-botao usuario-acao-botao--termos';
    botao.dataset.acao = 'termos';
    botao.dataset.usuarioId = String(usuario.id || '');
    // O carregando automático não entra: o clique abre uma confirmação antes.
    botao.dataset.semLoading = 'true';
    const icone = document.createElement('i');
    icone.classList.add('fas', 'fa-file-signature', 'usuario-acao-icone');
    botao.appendChild(icone);

    let motivo = '';
    if (!ehSupAdminLogado()) motivo = 'Só o Sup Admin pede o aceite dos termos';
    else if (termos.situacao === 'indisponivel') motivo = TERMOS_SEM_SQL;
    else if (termos.situacao === 'aceito') motivo = 'Termos já aceitos';
    else if (usuario.termos_solicitado) motivo = `Aceite já pedido em ${formatarDataHoraCompleta(usuario.termos_solicitados_em)}: aguardando a resposta`;

    if (motivo) {
        botao.classList.add('usuario-acao-botao--disabled');
        botao.disabled = true;
        botao.title = motivo;
        if (termos.situacao === 'aceito') botao.classList.add('usuario-acao-botao--termos-aceito');
        else if (usuario.termos_solicitado) botao.classList.add('usuario-acao-botao--termos-pedido');
    } else {
        botao.title = `Pedir a ${nome} o aceite dos Termos de Uso e da Política de Privacidade`;
        botao.addEventListener('click', evento => pedirAceiteDosTermos(usuario, botao, evento));
    }
    botao.setAttribute('aria-label', botao.title);
    return botao;
}

async function pedirAceiteDosTermos(usuario, botao, evento, auditoria) {
    const contextoAuditoria = auditoria ?? window.AuditoriaAcao?.vincular(evento);
    if (!usuario?.id || botao?.disabled) return;
    const nome = usuario.nome || usuario.email || 'este usuário';
    const confirmou = await window.DialogPadrao.confirm({
        title: 'Pedir o aceite dos termos',
        subtitle: nome,
        tom: 'pergunta',
        secoes: [{
            titulo: 'O que acontece',
            icone: 'fa-file-signature',
            lista: [
                'Ao entrar no programa — ou ao voltar para ele, se já estiver aberto — a pessoa vê os Termos de Uso e a Política de Privacidade.',
                'A caixa só fecha quando ela aceita os dois documentos ou recusa.',
                'Se aceitar, o aceite fica registrado e ela segue usando normalmente.',
                'Se recusar, o acesso é desativado (a conta não é excluída) e ela volta para a tela de entrada.'
            ]
        }],
        confirmText: 'Pedir o aceite',
        cancelText: 'Cancelar'
    });
    if (!confirmou) return;

    try {
        const resp = await window.BotaoAcao.comCarregamento(
            () => fetchApi(`/api/usuarios/${encodeURIComponent(usuario.id)}/termos/solicitar`, { method: 'POST' }, contextoAuditoria),
            'Pedindo o aceite…'
        );
        const dados = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(dados?.error || 'Não foi possível pedir o aceite.');
        const idx = usuariosCache.findIndex(item => Number(item.id) === Number(usuario.id));
        if (idx !== -1) usuariosCache[idx] = { ...usuariosCache[idx], ...dados, id: usuariosCache[idx].id };
        usuariosRecemAlterados.add(Number(usuario.id));
        refreshUsuariosAposAtualizacao();
        showToast(`Aceite pedido. ${nome} verá os termos ao entrar no programa.`, 'success');
    } catch (err) {
        console.error('Erro ao pedir o aceite dos termos:', err);
        showToast(err.message || 'Não foi possível pedir o aceite.', 'error');
    }
}

function criarBotaoAuditoriaUsuario(usuario) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'usuario-acao-botao';
    botao.dataset.acao = 'auditoria';
    const nome = usuario.nome || usuario.email || 'usuário';
    botao.title = `Relatório de atividades de ${nome}`;
    botao.setAttribute('aria-label', botao.title);
    const icone = document.createElement('i');
    icone.className = 'fas fa-clock-rotate-left usuario-acao-icone';
    icone.style.color = 'var(--color-primary)';
    botao.appendChild(icone);
    if (!ehSupAdminLogado()) {
        botao.disabled = true;
        botao.classList.add('usuario-acao-botao--disabled');
        botao.title = 'O relatório de atividades é restrito ao Sup Admin';
    } else {
        botao.addEventListener('click', () => abrirAuditoriaUsuario(usuario));
    }
    return botao;
}

/** O relatório de atividades do usuário (botão da linha e "Ver auditoria completa" do "i"). */
function abrirAuditoriaUsuario(usuario) {
    window.usuarioAuditoriaContext = { usuarioId: usuario.id, nome: usuario.nome || '', email: usuario.email || '' };
    // Com o spinner da casa, como os outros modais de Usuários: `Modal.open`
    // sozinho carregava o modal e o deixava escondido (o overlay nasce
    // `hidden` e só o openWithSpinner o revela) — "clico e nada aparece".
    return openModalWithSpinner('modals/usuarios/auditoria.html', '../js/modals/usuario-auditoria.js', 'usuarioAuditoria');
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
    const ultimaEntrada = botao.dataset.ultimaEntrada || '';
    const ultimaSaida = botao.dataset.ultimaSaida || '';
    const ultimaAlteracao = botao.dataset.ultimaAlteracao || 'Sem registro';
    const ultimaDescricao = botao.dataset.ultimaDescricao || 'Nenhuma alteração registrada';
    const linhaOpcional = (rotulo, valor) => (valor && valor !== 'Sem registro' ? `
            <div class="usuario-popover-section">
                <span class="usuario-popover-label">${rotulo}</span>
                <span class="usuario-popover-value">${valor}</span>
            </div>` : '');
    const temAuditoria = ehSupAdminLogado() && botao.dataset.usuarioId;
    const auditoria = temAuditoria ? `
            <button type="button" class="usuario-popover-ver-tudo" data-ver-auditoria>
                <i class="fas fa-clock-rotate-left" aria-hidden="true"></i> Ver auditoria completa
            </button>` : '';
    return `
        <div class="usuario-popover-card">
            <div class="usuario-popover-header">
                <span class="usuario-popover-title">Atividade recente</span>
                <span class="usuario-popover-username">${nome}</span>
            </div>
            <div class="usuario-popover-section">
                <span class="usuario-popover-label">Último login</span>
                <span class="usuario-popover-value">${ultimoLogin}</span>
            </div>${linhaOpcional('Última entrada', ultimaEntrada)}${linhaOpcional('Última saída', ultimaSaida)}
            <div class="usuario-popover-section">
                <span class="usuario-popover-label">Última ação</span>
                <ul class="usuario-popover-acoes" ${temAuditoria ? 'data-ultimas-acoes' : ''}>
                    <li class="usuario-popover-acao">
                        <span class="usuario-popover-acao-topo">${ultimaAlteracao}</span>
                        <p class="usuario-popover-acao-texto">${ultimaDescricao}</p>
                    </li>
                </ul>
            </div>${auditoria}
        </div>`;
}

/** Somente a última ação manual; o histórico completo fica na auditoria. */
const ultimasAcoesCache = new Map();
async function buscarUltimasAcoes(usuarioId) {
    const guardado = ultimasAcoesCache.get(String(usuarioId));
    if (guardado && Date.now() - guardado.em < 30000) return guardado.registros;
    const query = new URLSearchParams({
        usuario_id: String(usuarioId), origem: 'manual', pagina: '1', limite: '1'
    });
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}/api/auditoria-usuarios?${query}`);
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok || !Array.isArray(corpo?.registros)) {
        throw new Error(corpo?.sql_pendente ? 'Auditoria ainda não ativada no banco.' : (corpo?.error || 'Não foi possível ler a auditoria.'));
    }
    ultimasAcoesCache.set(String(usuarioId), { em: Date.now(), registros: corpo.registros });
    return corpo.registros;
}

/** "Antes → Depois" curto de um valor da auditoria. */
function valorCurtoDaAuditoria(valor) {
    if (valor === undefined) return '—';
    if (valor === null || valor === '') return 'vazio';
    const texto = typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
    return texto.length > 40 ? `${texto.slice(0, 39)}…` : texto;
}

/** Preenche uma única ação (textContent: os textos vêm do banco). */
async function preencherUltimasAcoes(lista, usuarioId) {
    const item = (classe, texto) => {
        const li = document.createElement('li');
        li.className = classe;
        li.textContent = texto;
        return li;
    };
    try {
        const registros = await buscarUltimasAcoes(usuarioId);
        if (!lista.isConnected) return;
        lista.replaceChildren();
        if (!registros.length) {
            lista.appendChild(item('usuario-popover-acao-vazia', 'Nenhuma ação registrada na auditoria.'));
            return;
        }
        for (const r of registros.slice(0, 1)) {
            const li = document.createElement('li');
            li.className = `usuario-popover-acao${r.resultado === 'falha' ? ' usuario-popover-acao--falha' : ''}`;
            const quando = new Date(r.criado_em);
            const topo = document.createElement('span');
            topo.className = 'usuario-popover-acao-topo';
            topo.textContent = [
                Number.isNaN(quando.getTime()) ? '' : quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
                r.modulo, r.resultado === 'falha' ? 'falhou' : ''
            ].filter(Boolean).join(' · ');
            const texto = document.createElement('span');
            texto.className = 'usuario-popover-acao-texto';
            texto.textContent = r.descricao || r.acao || 'Ação registrada';
            li.append(topo, texto);
            const mudancas = Array.isArray(r.mudancas) ? r.mudancas.slice(0, 2) : [];
            for (const m of mudancas) {
                li.appendChild(item('usuario-popover-acao-mudanca', `${m.campo || 'Campo'}: ${valorCurtoDaAuditoria(m.antes)} → ${valorCurtoDaAuditoria(m.depois)}`));
            }
            if (Array.isArray(r.mudancas) && r.mudancas.length > 2) li.appendChild(item('usuario-popover-acao-mudanca', `+ ${r.mudancas.length - 2} campo(s)`));
            lista.appendChild(li);
        }
    } catch (erro) {
        if (!lista.isConnected) return;
        lista.replaceChildren(item('usuario-popover-acao-vazia', erro.message || 'Não foi possível ler a auditoria.'));
    }
}

function abrirPopoverUsuario(botao) {
    if (typeof window.createPopup !== 'function') {
        console.warn('createPopup não disponível para popover de usuário');
        return;
    }
    const html = criarConteudoPopoverUsuario(botao);
    const { popup } = window.createPopup(botao, html, { margin: 12 });
    const card = popup.querySelector('.usuario-popover-card');
    const reposicionar = () => {
        if (!popup.isConnected) return;
        const viewport = window.visualViewport;
        const largura = viewport?.width || window.innerWidth;
        const altura = viewport?.height || window.innerHeight;
        const esquerda = (viewport?.offsetLeft || 0) + 12;
        const topo = (viewport?.offsetTop || 0) + 12;
        card.style.maxWidth = `${Math.max(0, largura - 24)}px`;
        card.style.maxHeight = `${Math.max(0, altura - 24)}px`;
        const alvo = botao.getBoundingClientRect();
        const tamanho = popup.getBoundingClientRect();
        const limitar = (valor, minimo, maximo) => Math.max(minimo, Math.min(valor, maximo));
        const direita = esquerda + largura - 24 - tamanho.width;
        const inferior = topo + altura - 24 - tamanho.height;
        const x = alvo.right + 12 + tamanho.width <= esquerda + largura - 24
            ? alvo.right + 12 : alvo.left - tamanho.width - 12;
        const y = alvo.bottom + 12 + tamanho.height <= topo + altura - 24
            ? alvo.bottom + 12 : alvo.top - tamanho.height - 12;
        popup.style.left = `${limitar(x, esquerda, direita)}px`;
        popup.style.top = `${limitar(y, topo, inferior)}px`;
    };
    reposicionar();
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(reposicionar) : null;
    observador?.observe(card);
    window.visualViewport?.addEventListener('resize', reposicionar);
    window.visualViewport?.addEventListener('scroll', reposicionar);
    const listaAcoes = popup.querySelector('[data-ultimas-acoes]');
    if (listaAcoes) preencherUltimasAcoes(listaAcoes, botao.dataset.usuarioId).finally(reposicionar);
    popup.querySelector('[data-ver-auditoria]')?.addEventListener('click', () => {
        fecharPopoversUsuarios();
        abrirAuditoriaUsuario({ id: botao.dataset.usuarioId, nome: botao.dataset.nome || '', email: botao.dataset.email || '' });
    });

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
        observador?.disconnect();
        window.visualViewport?.removeEventListener('resize', reposicionar);
        window.visualViewport?.removeEventListener('scroll', reposicionar);
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
        window.addEventListener('scroll', evento => {
            if (evento.target?.nodeType && usuarioPopoverAtual?.popup.contains(evento.target)) return;
            fecharPopoversUsuarios();
        }, true);
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

function initUsuarios() {
    carregarUsuarioLogado();

    const btnModelosPermissao = document.getElementById('btnModelosPermissao');
    const isSupAdmin = usuarioLogado?.perfil === 'Sup Admin';
    if (btnModelosPermissao) {
        if (isSupAdmin) {
            btnModelosPermissao.classList.remove('hidden');
            btnModelosPermissao.addEventListener('click', () => {
                openModalWithSpinner(
                    'modals/usuarios/permissoes.html',
                    '../js/modals/usuario-permissoes.js',
                    'usuariosPermissoes'
                );
            });
        } else {
            btnModelosPermissao.classList.add('hidden');
        }
    }
    // Segurança da API (09/10/2026): o registro do que a API negou/negaria.
    const btnSegurancaApi = document.getElementById('btnSegurancaApi');
    if (btnSegurancaApi) {
        const veSeguranca = isSupAdmin || Boolean(window.Permissoes?.supAdmin);
        btnSegurancaApi.classList.toggle('hidden', !veSeguranca);
        if (veSeguranca) {
            btnSegurancaApi.addEventListener('click', () => {
                openModalWithSpinner('modals/usuarios/seguranca.html', '../js/modals/usuario-seguranca.js', 'segurancaApi');
            });
        }
    }
    // A entrada em cascata é só do CSS (`animate-fade-in-up`, um bloco depois do
    // outro, como no Financeiro). Não ponha opacity/transform inline aqui: o
    // fadeInUp parte do valor que o bloco já tem, e com opacity 1 a animação
    // ficava invisível (06/10/2026).

    // A primeira carga, publicada para o menu tirar a máscara na hora certa (06/10/2026).
    window.moduloPronto?.(carregarUsuarios());

    document.getElementById('btnNovoUsuario')?.addEventListener('click', () => {
        abrirNovoUsuario();
    });
    document.getElementById('usuariosEmptyNew')?.addEventListener('click', () => {
        document.getElementById('btnNovoUsuario')?.click();
    });

    document.getElementById('aplicarFiltro')?.addEventListener('click', () => {
        // filtro explícito volta a valer para todos
        usuariosRecemAlterados.clear();
        aplicarFiltros();
    });
    document.getElementById('filtroBusca')?.addEventListener('input', aplicarFiltros);

    document.getElementById('limparFiltro')?.addEventListener('click', () => {
        document.getElementById('filtroBusca').value = '';
        document.getElementById('filtroPerfil').value = '';
        document.querySelectorAll('.checkbox-custom').forEach(cb => cb.checked = false);
        usuariosRecemAlterados.clear();
        renderUsuarios(usuariosCache);
    });

    // Controle do popover de resumo
    const infoIcon = document.getElementById('usuariosResumoInfo');
    const resumoPopover = document.getElementById('resumoPopover');

    if (infoIcon && resumoPopover) {
        let hideTimeout;

        const posicionarPopover = () => {
            if (!resumoPopover.classList.contains('show')) return;
            // `window.Popover` leva o balão para o <body> e posiciona em
            // relação à janela: com ele dentro do módulo (que rola e tem
            // deslocamento próprio), as coordenadas da janela o jogavam longe
            // do (i). A conta abaixo fica como reserva, sem o utilitário.
            if (window.Popover?.abrir) {
                window.Popover.abrir(resumoPopover, infoIcon);
                return;
            }

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

// Usuários cujo status acabou de ser alterado. Eles permanecem visíveis mesmo
// que deixem de casar com o filtro de status — antes, ativar/desativar com o
// filtro "Ativo" marcado fazia a linha sumir da tabela.
const usuariosRecemAlterados = new Set();

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

        if (statusFiltros.size > 0 && !usuariosRecemAlterados.has(Number(u.id))) {
            const statusUsuario = obterStatusInterno(u);
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
    const permissoes = obterPermissoesUsuario();

    lista.forEach(u => {
        const tr = document.createElement('tr');
        tr.classList.add('table-row');
        const nomeOriginal = typeof u.nome === 'string' ? u.nome : '';
        const nome = escapeHtml(nomeOriginal);
        const baseParaIniciais = nomeOriginal || (typeof u.email === 'string' ? u.email : '');
        const iniciais = baseParaIniciais
            .split(' ')
            .map(p => p[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
        const iniciaisSeguro = escapeHtml(iniciais);
        const email = escapeHtml(u.email);
        const perfil = escapeHtml(u.perfil || '');
        const presenca = PRESENCA[resolverPresenca(u)];
        const sessaoClasse = `usuario-sessao-badge ${presenca.classe}`;
        const sessaoRotulo = presenca.rotulo;
        const avatarUrl = obterAvatarUrl(u);
        const avatarAltTexto = nomeOriginal ? `Avatar de ${nomeOriginal}` : 'Avatar do usuário';
        const avatarAlt = escapeAttribute(avatarAltTexto);
        const avatarMarkup = avatarUrl
            ? `
            <div class="usuario-avatar usuario-avatar--list usuario-avatar--has-image">
                <img src="${escapeAttribute(avatarUrl)}" alt="${avatarAlt}" loading="lazy" class="usuario-avatar__image" />
                <span class="usuario-avatar__initials">${iniciaisSeguro || 'US'}</span>
            </div>
            `
            : `
            <div class="usuario-avatar usuario-avatar--list usuario-avatar--initials">
                <span class="usuario-avatar__initials">${iniciaisSeguro || 'US'}</span>
            </div>
            `;

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
        // `ultima_atividade` NÃO entra aqui: ela é carimbada a cada entrada
        // (`registrarUltimaEntrada`) e mostrar a hora do login no lugar da hora
        // da alteração é pior que admitir que não há registro.
        const ultimaAlteracaoValor = obterPrimeiroValor(u, [
            'ultimaAlteracaoEm',
            'ultima_alteracao_em',
            'ultimaAlteracao',
            'ultima_alteracao',
            'ultimaAcaoEm',
            'ultima_acao_em'
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
        const ultimaDescricaoTexto = formatarDescricaoAlteracao(
            ultimaDescricaoValor,
            localUltimaAlteracao,
            especificacaoUltimaAlteracao
        );
        // Registros gravados antes da correção da saída ficaram com o módulo e
        // sem a data. "Sem registro" ao lado de "Usuário alterou o módulo X" lê
        // como defeito; o que houve foi a data ter sido perdida. Distinguir os
        // dois casos é mais honesto que esconder qualquer um deles.
        const temAlteracaoRegistrada = Boolean(
            (localUltimaAlteracao && String(localUltimaAlteracao).trim())
            || (especificacaoUltimaAlteracao && String(especificacaoUltimaAlteracao).trim())
            || (ultimaDescricaoValor && String(ultimaDescricaoValor).trim())
        );
        const ultimaAlteracaoBruta = formatarDataHoraCompleta(ultimaAlteracaoValor);
        const ultimaAlteracaoTexto = escapeHtml(
            ultimaAlteracaoBruta === 'Sem registro' && temAlteracaoRegistrada
                ? 'Data não registrada'
                : ultimaAlteracaoBruta
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
        const termosDoUsuario = resolverTermos(u);

        tr.innerHTML = `
            <td class="px-6 py-4">
                ${avatarMarkup}
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
                            data-usuario-id="${escapeHtml(String(u.id ?? ''))}"
                            data-email="${escapeHtml(String(u.email ?? ''))}"
                            data-ultima-entrada="${ultimaEntradaTexto}"
                            data-ultima-saida="${ultimaSaidaTexto}"
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
                <span data-status-badge class="${statusBadgeClasse} px-2 py-1 rounded-full text-xs font-medium">${escapeHtml(statusRotulo)}</span>
            </td>
            <td class="px-6 py-4">
                <span data-termos-badge class="${termosDoUsuario.classe} px-2 py-1 rounded-full text-xs font-medium" title="${escapeAttribute(termosDoUsuario.dica)}">${escapeHtml(termosDoUsuario.rotulo)}</span>
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
        actionsTd.className = 'px-6 py-4';
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
        toggleBtn.setAttribute('aria-label', `${isAtivo ? 'Desativar' : 'Ativar'} ${nome}`);
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
            toggleBtn.addEventListener('click', evento => alternarStatusUsuario(toggleBtn, evento));
        }

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'usuario-acao-botao';
        editBtn.dataset.acao = 'editar';
        editBtn.title = `Editar ${nome}`;
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
        deleteBtn.title = `Excluir ${nome}`;
        const deleteIcon = document.createElement('i');
        deleteIcon.classList.add('fas', 'fa-trash', 'usuario-acao-icone');
        deleteIcon.style.color = 'var(--color-red)';
        deleteBtn.appendChild(deleteIcon);
        if (!permissoes.podeExcluir || permissoes.colunaDesabilitada) {
            deleteBtn.classList.add('usuario-acao-botao--disabled');
            deleteBtn.disabled = true;
            deleteIcon.style.color = 'rgba(255, 255, 255, 0.45)';
        } else {
            deleteBtn.addEventListener('click', evento => handleRemoverUsuario(u, deleteBtn, evento));
        }

        actionsWrapper.appendChild(toggleBtn);
        // Pedir o aceite dos termos: à esquerda do Editar (pedido do dono).
        actionsWrapper.appendChild(criarBotaoDosTermos(u));
        actionsWrapper.appendChild(editBtn);
        actionsWrapper.appendChild(deleteBtn);
        actionsWrapper.appendChild(criarBotaoAuditoriaUsuario(u));
        actionsTd.appendChild(actionsWrapper);
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
    });

    prepararPopoversUsuarios();
    updateEmptyStateUsuarios(lista.length > 0);
}

async function handleRemoverUsuario(usuario, botao, evento, auditoria) {
    const contextoAuditoria = auditoria ?? window.AuditoriaAcao?.vincular(evento);
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
        }, contextoAuditoria);
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

/**
 * Atualiza no lugar a linha de um usuário após alternar o status.
 * A tabela NÃO é re-renderizada nem re-filtrada: nenhuma outra linha some,
 * some ou muda de posição — apenas o selo de status e o botão daquele usuário.
 */
function atualizarLinhaStatusUsuario(botao, statusInterno, usuarioAtualizado) {
    const linha = botao?.closest('tr');
    if (!linha) return;

    const rotulo = obterStatusLabel(usuarioAtualizado || {}, statusInterno);
    const classeBadge = obterStatusBadge(usuarioAtualizado || {}, statusInterno);

    const badge = linha.querySelector('[data-status-badge]');
    if (badge) {
        badge.className = `${classeBadge} px-2 py-1 rounded-full text-xs font-medium`;
        badge.setAttribute('data-status-badge', '');
        badge.textContent = rotulo;
    }

    const isAtivo = statusInterno === 'ativo';
    botao.dataset.usuarioStatus = statusInterno;
    botao.classList.toggle('usuario-acao-botao--ativo', isAtivo);
    botao.title = isAtivo ? 'Desativar acesso' : 'Ativar acesso';

    const nomeLinha = linha.querySelector('td')?.textContent?.trim() || '';
    botao.setAttribute('aria-label', `${isAtivo ? 'Desativar' : 'Ativar'} ${nomeLinha}`);

    const icone = botao.querySelector('.usuario-acao-icone');
    if (icone) {
        icone.classList.toggle('usuario-acao-icone--on', isAtivo);
        icone.classList.toggle('usuario-acao-icone--off', !isAtivo);
    }
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
    // Um spinner só no programa inteiro (src/utils/modal.js › openModuleModal,
    // desempenho 06/10/2026): fecha os outros modais, revela o overlay quando o
    // modal avisa `modalSpinnerLoaded` (tira o `hidden` — classList.remove('hidden')),
    // com o piso de 1 s de sempre, relógio de segurança e limpeza se fechar
    // antes. Antes eram nove cópias desta função, sem relógio: modal que desse
    // erro deixava a tela escura presa.
    return Modal.openModuleModal(htmlPath, scriptPath, overlayId);
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

async function alternarStatusUsuario(botao, evento, auditoria) {
    const contextoAuditoria = auditoria ?? window.AuditoriaAcao?.vincular(evento);
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
        }, contextoAuditoria);

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

        const statusFinal = normalizarStatusInternoValor(
            atualizado.statusInterno || atualizado.status || novoStatusInterno
        ) || novoStatusInterno;

        // Atualiza SOMENTE esta linha. Antes chamávamos refreshUsuariosAposAtualizacao(),
        // que re-aplicava os filtros e fazia linhas sumirem da tabela.
        usuariosRecemAlterados.add(Number(usuarioId));
        atualizarLinhaStatusUsuario(botao, statusFinal, usuariosCache[idx] || atualizado);
        atualizarResumo();
    } catch (err) {
        console.error('Erro ao alternar status do usuário:', err);
    } finally {
        botao.disabled = false;
        botao.classList.remove('usuario-acao-botao--loading');
    }
}

async function carregarUsuarios() {
    const t0 = performance.now();
    console.log("📌 Iniciando carregarUsuarios()");

    try {
        const t1 = performance.now();
        // presenca=1: o sinal do programa de cada um (Ausente = rodando só perto do relógio).
        const resp = await fetchApi('/api/usuarios/lista?presenca=1');
        const t2 = performance.now();

        console.log("⏱ Tempo fetchApi →", (t2 - t1).toFixed(2), "ms");

        usuariosCache = await resp.json();
        const t3 = performance.now();

        console.log("⏱ Tempo JSON.parse →", (t3 - t2).toFixed(2), "ms");
        console.log("📦 Total usuários recebidos:", usuariosCache.length);

        renderUsuarios(usuariosCache);
        const t4 = performance.now();

        console.log("⏱ Tempo renderUsuarios →", (t4 - t3).toFixed(2), "ms");
        console.log("⏳ Tempo total carregarUsuarios →", (t4 - t0).toFixed(2), "ms");

        atualizarResumo();
    } catch (err) {
        console.error('❌ Erro ao carregar usuários:', err);
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
