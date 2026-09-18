/**
 * O sino do topo — avisos por usuário (/api/notificacoes).
 *
 * Quem recebe: quem criou a prospecção/o cliente e quem fez a ação comentada
 * ou curtida no histórico social (backend/historicoSocial.js). Vale para
 * TODOS os perfis — cada um vê só os próprios avisos (o id vem do token).
 *
 *   - o número no sino é o total de não lidos;
 *   - clicar num aviso marca como lido, abre o módulo, a ficha e a aba
 *     Histórico já no comentário (window.historicoSocialFoco);
 *   - "Marcar todas como lidas" limpa o contador;
 *   - busca ao abrir o app, a cada minuto e quando a janela volta ao foco.
 *
 * Preferências (Configurações → Notificações, chave `menu.notifications`):
 * desligado, o sino fica quieto; a categoria "Vendas e pedidos" desligada
 * silencia estes avisos (são movimentação comercial).
 *
 * Tarefas (sql/tarefas_calendario.sql): a cada minuto o sino pede ao servidor
 * os lembretes e atrasos devidos (POST /api/tarefas/avisos); convite de
 * tarefa em conjunto tem Aceitar/Recusar no próprio aviso; o "x" tira o aviso
 * do sino; o que chega de novo também aparece como notificação do Windows.
 *
 * `window.__notificationsInternals` segue com o mesmo contrato de antes
 * (fetchNotificationsWithRetry, refreshNotifications({ respectDaily }),
 * resetDailyState, shutdown) — session.js e os testes dependem dele.
 */
window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('notificationBtn');
  const badge = document.getElementById('notificationBadge');
  if (!btn || !badge) return;

  let currentUser = {};
  try {
    currentUser = JSON.parse(
      sessionStorage.getItem('currentUser') || localStorage.getItem('user') || '{}',
    );
  } catch (e) {
    currentUser = {};
  }

  const defaultPreferences = {
    enabled: true,
    categories: {
      system: true,
      tasks: true,
      sales: true,
      finance: true,
    },
  };
  // Categoria das preferências em que os avisos do histórico social entram.
  const CATEGORIA = 'sales';
  const INTERVALO_MS = 60 * 1000;
  const FOCO_MINIMO_MS = 15 * 1000;

  const preferenceKey = 'menu.notifications';
  const preferenceEvent = 'menu-notification-preferences-changed';
  const dailyBaseKey = 'menu.notifications.lastCheckAt';

  let avisos = [];
  let naoLidas = 0;
  let sqlPendente = false;
  let ultimaBusca = 0;
  let isFetching = false;
  let hasDailyCheckRun = false;
  let desligado = false;
  let intervalo = null;
  let clickHandler = null;
  let painel = null;

  // ------------------------------------------------ marca do dia
  // Não decide mais SE busca (o sino busca sempre ao abrir o app); só evita a
  // busca repetida de quem pede refreshNotifications({ respectDaily: true }).

  let dailyStorageKey;

  function updateDailyStorageKey(user = currentUser) {
    if (window.dailyRun?.getScopedKey) {
      dailyStorageKey = window.dailyRun.getScopedKey(dailyBaseKey, user);
      return;
    }
    const identifier =
      user?.id || user?.usuario_id || user?.email || user?.login || 'anonimo';
    dailyStorageKey = `${dailyBaseKey}:${String(identifier).toLowerCase()}`;
  }

  function getTodayKeySafe() {
    return (
      window.dateUtils?.getTodayKey?.() || new Date().toISOString().slice(0, 10)
    );
  }

  function readDailyCheck() {
    if (window.dailyRun?.readFlag) {
      return window.dailyRun.readFlag(dailyBaseKey, currentUser);
    }
    try {
      return localStorage.getItem(dailyStorageKey);
    } catch (err) {
      return null;
    }
  }

  function markDailyCheck(value) {
    const today = value || getTodayKeySafe();
    if (window.dailyRun?.writeFlag) {
      window.dailyRun.writeFlag(dailyBaseKey, currentUser, today);
      return today;
    }
    try {
      localStorage.setItem(dailyStorageKey, today);
    } catch (err) {
      // ignora falhas de storage
    }
    return today;
  }

  function clearDailyCheck() {
    if (window.dailyRun?.clearFlag) {
      window.dailyRun.clearFlag(dailyBaseKey, currentUser);
      return;
    }
    try {
      localStorage.removeItem(dailyStorageKey);
    } catch (err) {
      // ignora falhas de storage
    }
  }

  function resetDailyStateForToday() {
    hasDailyCheckRun = readDailyCheck() === getTodayKeySafe();
  }

  updateDailyStorageKey(currentUser);
  resetDailyStateForToday();

  // ------------------------------------------------ preferências

  const clone = (value) => {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return value;
    }
  };

  const normalizeCategories = (source) => {
    const normalized = { ...defaultPreferences.categories };
    if (Array.isArray(source)) {
      Object.keys(normalized).forEach((key) => {
        normalized[key] = source.includes(key);
      });
      source.forEach((key) => {
        if (!(key in normalized)) {
          normalized[key] = true;
        }
      });
      return normalized;
    }
    if (source && typeof source === 'object') {
      Object.entries(source).forEach(([key, value]) => {
        normalized[key] = Boolean(value);
      });
    }
    return normalized;
  };

  const getPreferences = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
      if (!stored || typeof stored !== 'object') {
        return clone(defaultPreferences);
      }
      return {
        enabled: stored.enabled !== false,
        categories: normalizeCategories(stored.categories),
      };
    } catch (err) {
      return clone(defaultPreferences);
    }
  };

  const savePreferences = (state) => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(state));
    } catch (err) {
      console.warn('Não foi possível salvar preferências de notificações', err);
    }
    window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: { preferences: clone(state) } }));
  };

  let currentPreferences = getPreferences();
  const ativo = () => !desligado
    && currentPreferences.enabled !== false
    && currentPreferences.categories?.[CATEGORIA] !== false;

  // ------------------------------------------------ busca

  /** Qualquer formato de resposta → { lista, naoLidas, sqlPendente }. Pura. */
  function lerResposta(data) {
    let lista = [];
    if (Array.isArray(data)) lista = data;
    else if (Array.isArray(data?.itens)) lista = data.itens;
    else if (Array.isArray(data?.items)) lista = data.items;
    else if (Array.isArray(data?.notifications)) lista = data.notifications;
    else if (Array.isArray(data?.data)) lista = data.data;
    const contados = Number(data?.nao_lidas);
    return {
      lista,
      naoLidas: Number.isFinite(contados) ? contados : lista.filter((n) => n && n.lida === false).length,
      sqlPendente: Boolean(data?.sql_pendente),
    };
  }

  let ultimaResposta = null;

  async function baseDaApi() {
    try {
      return await window.apiConfig?.getApiBaseUrl?.();
    } catch (err) {
      console.warn('Não foi possível obter a URL base da API.', err);
      return null;
    }
  }

  async function fetchNotificationsWithRetry(maxRetries = 2) {
    const baseUrl = await baseDaApi();
    if (!baseUrl) {
      console.warn('URL base da API não definida para o sino de avisos.');
      return [];
    }
    const url = new URL('/api/notificacoes', baseUrl).toString();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          credentials: 'include',
        });
        if (!response.ok) {
          const statusError = new Error(`Falha ao carregar avisos (${response.status})`);
          statusError.status = response.status;
          throw statusError;
        }
        let data;
        try {
          data = await response.json();
        } catch (err) {
          return [];
        }
        ultimaResposta = lerResposta(data);
        return ultimaResposta.lista;
      } catch (error) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        console.warn('Erro ao carregar avisos do sino.', { error, attempt: attempt + 1, offline });
        // 401/403: sem sessão ou sem acesso — insistir não muda nada.
        if (offline || error.status === 401 || error.status === 403 || attempt >= maxRetries) break;
        const delay = Math.min(4000, 1000 * (attempt + 1));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return [];
  }

  async function refreshNotifications({ respectDaily = true } = {}) {
    if (!ativo()) return;
    if (respectDaily) {
      resetDailyStateForToday();
      if (hasDailyCheckRun) return;
      hasDailyCheckRun = true;
    }
    if (isFetching) return;
    isFetching = true;
    try {
      // Continua null se a busca falhar: aí o sino mantém o que já mostrava.
      ultimaResposta = null;
      const lista = await fetchNotificationsWithRetry(respectDaily ? 2 : 0);
      if (!desligado && ultimaResposta) {
        avisos = lista.filter((n) => n && typeof n === 'object');
        naoLidas = ultimaResposta.naoLidas;
        sqlPendente = ultimaResposta.sqlPendente;
        notificarNoSistema(avisos);
      }
      ultimaBusca = Date.now();
    } catch (error) {
      console.warn('Erro inesperado ao atualizar o sino.', error);
    } finally {
      isFetching = false;
      if (!desligado) {
        markDailyCheck();
        hasDailyCheckRun = true;
      }
      updateIcon();
      if (painel) desenharPainel();
    }
  }

  async function marcarLidas(corpo) {
    const baseUrl = await baseDaApi();
    if (!baseUrl) return;
    try {
      await fetch(new URL('/api/notificacoes/lidas', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify(corpo),
      });
    } catch (err) {
      console.warn('Não foi possível marcar os avisos como lidos.', err);
    }
  }

  // ------------------------------------------------ ícone

  function updateIcon() {
    const total = ativo() ? naoLidas : 0;
    btn.setAttribute('aria-label', total ? `Avisos: ${total} não lido${total > 1 ? 's' : ''}` : 'Avisos');
    if (!total) {
      btn.style.color = 'white';
      badge.classList.add('hidden');
      badge.textContent = '';
      return;
    }
    btn.style.color = 'var(--color-primary)';
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.remove('hidden');
  }

  window.updateNotificationColor = updateIcon;

  // ------------------------------------------------ painel

  const criar = (tag, classe, texto) => {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  };
  const icone = (nome) => {
    const i = criar('i', `fas ${nome}`);
    i.setAttribute('aria-hidden', 'true');
    return i;
  };

  /** "agora", "há 5 min", "há 3 h", "ontem às 14:30", "12/09 às 10:05". Pura. */
  function quando(valor, agora = new Date()) {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return '';
    const seg = Math.max(0, Math.round((agora - d) / 1000));
    if (seg < 60) return 'agora';
    if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dias = Math.round((dia(agora) - dia(d)) / 86400000);
    if (dias === 0) return `há ${Math.floor(seg / 3600)} h`;
    if (dias === 1) return `ontem às ${hora}`;
    const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', ...(d.getFullYear() !== agora.getFullYear() ? { year: 'numeric' } : {}) });
    return `${data} às ${hora}`;
  }

  const ICONE_DO_TIPO = {
    comentario: 'fa-comment',
    resposta: 'fa-reply',
    curtida: 'fa-heart',
    observacao: 'fa-pen-to-square',
    tarefa_lembrete: 'fa-clock',
    tarefa_atrasada: 'fa-triangle-exclamation',
    tarefa_atribuida: 'fa-list-check',
    tarefa_alterada: 'fa-calendar-days',
    tarefa_concluida: 'fa-circle-check',
    convite_tarefa: 'fa-user-plus',
    convite_respondido: 'fa-user-check',
  };
  const ORIGEM = { prospeccao: 'Prospecção', cliente: 'Cliente', tarefa: 'Tarefa' };
  // O que vira notificação do Windows quando chega (não lido e novo).
  const NO_SISTEMA = new Set(['tarefa_lembrete', 'tarefa_atrasada', 'tarefa_atribuida', 'convite_tarefa', 'convite_respondido', 'resposta', 'comentario']);

  async function dispensar(aviso) {
    avisos = avisos.filter((a) => a.id !== aviso.id);
    if (!aviso.lida) naoLidas = Math.max(0, naoLidas - 1);
    updateIcon();
    desenharPainel();
    const baseUrl = await baseDaApi();
    if (!baseUrl) return;
    try {
      await fetch(new URL('/api/notificacoes/dispensar', baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ids: [aviso.id] }),
      });
    } catch (err) {
      console.warn('Não foi possível tirar o aviso do sino.', err);
    }
  }

  async function responderConvite(aviso, resposta) {
    if (!window.TarefasUI?.responderConvite) return;
    const ok = await window.TarefasUI.responderConvite(aviso.registro_id, resposta);
    if (ok) {
      avisos = avisos.map((a) => (a.id === aviso.id ? { ...a, lida: true, convite_pendente: false } : a));
      if (!aviso.lida) naoLidas = Math.max(0, naoLidas - 1);
      updateIcon();
      desenharPainel();
    }
  }

  let fotos = new Map();

  function avatar(aviso) {
    const caixa = criar('span', 'sino-avatar');
    const foto = aviso.autor_id !== null && aviso.autor_id !== undefined ? fotos.get(String(aviso.autor_id)) : null;
    if (foto) {
      const img = criar('img');
      img.src = foto;
      img.alt = '';
      caixa.appendChild(img);
    } else if (!aviso.autor && String(aviso.tipo || '').startsWith('tarefa_')) {
      // Lembrete e atraso vêm do sistema, não de uma pessoa.
      caixa.appendChild(icone('fa-calendar-check'));
    } else {
      caixa.textContent = window.HistoricoSocial?.iniciais?.(aviso.autor || '') || (aviso.autor || '?').slice(0, 1).toUpperCase();
    }
    const tipo = criar('span', `sino-avatar__tipo sino-avatar__tipo--${aviso.tipo || 'aviso'}`);
    tipo.appendChild(icone(ICONE_DO_TIPO[aviso.tipo] || 'fa-bell'));
    caixa.appendChild(tipo);
    return caixa;
  }

  function linhaDoAviso(aviso) {
    const linha = criar('div', `sino-aviso${aviso.lida ? '' : ' sino-aviso--nova'}`);
    linha.tabIndex = 0;
    linha.setAttribute('role', 'menuitem');
    linha.appendChild(avatar(aviso));
    const corpo = criar('span', 'sino-aviso__corpo');
    corpo.appendChild(criar('span', 'sino-aviso__titulo', aviso.titulo || aviso.message || 'Aviso'));
    if (aviso.mensagem) corpo.appendChild(criar('span', 'sino-aviso__texto', aviso.mensagem));
    const rodape = criar('span', 'sino-aviso__rodape');
    if (ORIGEM[aviso.origem]) rodape.appendChild(criar('span', 'sino-aviso__origem', ORIGEM[aviso.origem]));
    rodape.appendChild(criar('span', null, quando(aviso.criado_em || aviso.date)));
    corpo.appendChild(rodape);
    if (aviso.tipo === 'convite_tarefa' && aviso.convite_pendente) {
      const acoes = criar('span', 'sino-aviso__acoes');
      const aceitar = criar('button', 'sino-aviso__botao sino-aviso__botao--sim');
      aceitar.type = 'button';
      aceitar.append(icone('fa-check'), document.createTextNode(' Aceitar'));
      aceitar.addEventListener('click', (e) => { e.stopPropagation(); responderConvite(aviso, 'aceitar'); });
      const recusar = criar('button', 'sino-aviso__botao sino-aviso__botao--nao');
      recusar.type = 'button';
      recusar.append(icone('fa-xmark'), document.createTextNode(' Recusar'));
      recusar.addEventListener('click', (e) => { e.stopPropagation(); responderConvite(aviso, 'recusar'); });
      acoes.append(aceitar, recusar);
      corpo.appendChild(acoes);
    }
    linha.appendChild(corpo);
    const lado = criar('span', 'sino-aviso__lado');
    if (!aviso.lida) {
      const ponto = criar('span', 'sino-aviso__ponto');
      ponto.title = 'Não lido';
      lado.appendChild(ponto);
    }
    const tirar = criar('button', 'sino-aviso__tirar');
    tirar.type = 'button';
    tirar.title = 'Tirar do sino';
    tirar.setAttribute('aria-label', 'Tirar este aviso do sino');
    tirar.appendChild(icone('fa-xmark'));
    tirar.addEventListener('click', (e) => { e.stopPropagation(); dispensar(aviso); });
    lado.appendChild(tirar);
    linha.appendChild(lado);
    linha.addEventListener('click', () => abrirAviso(aviso));
    linha.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === linha) abrirAviso(aviso); });
    return linha;
  }

  function desenharPainel() {
    if (!painel) return;
    painel.replaceChildren();

    const topo = criar('div', 'sino-topo');
    const titulo = criar('div', 'sino-topo__titulo');
    titulo.appendChild(criar('strong', null, 'Avisos'));
    if (naoLidas) titulo.appendChild(criar('span', 'sino-topo__novos', `${naoLidas} não lido${naoLidas > 1 ? 's' : ''}`));
    topo.appendChild(titulo);
    const todas = criar('button', 'sino-topo__acao');
    todas.type = 'button';
    todas.append(icone('fa-check-double'), document.createTextNode(' Marcar todas como lidas'));
    todas.disabled = !naoLidas;
    todas.addEventListener('click', async () => {
      avisos = avisos.map((a) => ({ ...a, lida: true }));
      naoLidas = 0;
      updateIcon();
      desenharPainel();
      await marcarLidas({ todas: true });
    });
    topo.appendChild(todas);
    painel.appendChild(topo);

    const lista = criar('div', 'sino-lista');
    if (sqlPendente) {
      const vazio = criar('div', 'sino-vazio');
      vazio.append(icone('fa-database'), criar('span', null, 'Os avisos passam a aparecer depois que o SQL do histórico social for executado no banco.'));
      lista.appendChild(vazio);
    } else if (!avisos.length) {
      const vazio = criar('div', 'sino-vazio');
      vazio.append(icone('fa-bell-slash'), criar('span', null, isFetching ? 'Carregando avisos…' : 'Nenhum aviso por aqui. Quando comentarem, responderem ou curtirem algo seu em Prospecções ou Clientes, aparece aqui.'));
      lista.appendChild(vazio);
    } else {
      avisos.forEach((aviso) => lista.appendChild(linhaDoAviso(aviso)));
    }
    painel.appendChild(lista);
  }

  function posicionarPainel() {
    if (!painel) return;
    const r = btn.getBoundingClientRect();
    const largura = Math.min(400, window.innerWidth - 16);
    painel.style.width = `${largura}px`;
    painel.style.top = `${Math.round(r.bottom + 8)}px`;
    painel.style.left = `${Math.round(Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8)))}px`;
  }

  const foraDoPainel = (e) => {
    if (!painel || painel.contains(e.target) || btn.contains(e.target)) return;
    fecharPainel();
  };
  const teclaNoPainel = (e) => {
    if (e.key !== 'Escape') return;
    fecharPainel();
    btn.focus?.();
  };

  function fecharPainel() {
    if (!painel) return;
    painel.remove();
    painel = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', foraDoPainel, true);
    document.removeEventListener('keydown', teclaNoPainel, true);
    window.removeEventListener('resize', posicionarPainel);
  }

  async function abrirPainel() {
    if (painel) {
      fecharPainel();
      return;
    }
    painel = criar('div', 'sino-painel');
    painel.setAttribute('role', 'menu');
    painel.setAttribute('aria-label', 'Avisos');
    document.body.appendChild(painel);
    btn.setAttribute('aria-expanded', 'true');
    desenharPainel();
    posicionarPainel();
    document.addEventListener('mousedown', foraDoPainel, true);
    document.addEventListener('keydown', teclaNoPainel, true);
    window.addEventListener('resize', posicionarPainel);

    try {
      const base = await baseDaApi();
      if (base && window.HistoricoSocial?.carregarFotos) {
        fotos = await window.HistoricoSocial.carregarFotos(base);
      }
    } catch (_) { /* sem foto, fica a inicial */ }
    await refreshNotifications({ respectDaily: false });
  }

  /** Marca como lido e leva até o comentário: módulo → ficha → aba Histórico. */
  async function abrirAviso(aviso) {
    fecharPainel();
    if (!aviso.lida) {
      avisos = avisos.map((a) => (a.id === aviso.id ? { ...a, lida: true } : a));
      naoLidas = Math.max(0, naoLidas - 1);
      updateIcon();
      marcarLidas({ ids: [aviso.id] });
    }
    // Tarefa abre o editor por cima de onde a pessoa estiver (o comentário, na aba da conversa).
    if (aviso.origem === 'tarefa' && aviso.registro_id && window.TarefasUI?.abrirEditor) {
      const conversa = ['comentario', 'resposta', 'observacao', 'curtida'].includes(aviso.tipo);
      window.TarefasUI.abrirEditor({
        id: aviso.registro_id, aba: conversa ? 'conversa' : 'detalhes',
        foco: conversa ? { itemId: aviso.item_id, comentarioId: aviso.comentario_id } : null,
      });
      return;
    }
    const pagina = aviso.origem === 'cliente' ? 'clientes' : aviso.origem === 'prospeccao' ? 'prospeccoes' : null;
    if (!pagina || !aviso.registro_id) return;
    window.historicoSocialFoco = {
      origem: aviso.origem,
      registroId: aviso.registro_id,
      itemId: aviso.item_id,
      comentarioId: aviso.comentario_id,
    };
    try {
      await window.loadPage?.(pagina);
      if (document.getElementById('content')?.dataset.activePage !== pagina) {
        window.historicoSocialFoco = null;
        window.showToast?.('Você não tem acesso a este módulo.', 'error');
        return;
      }
      const registro = { id: aviso.registro_id };
      if (pagina === 'clientes') window.ClientesModulo?.abrirDetalhes?.(registro);
      else window.ProspeccoesModulo?.abrirDetalhes?.(registro);
    } catch (err) {
      console.error('[sino] não foi possível abrir o aviso:', err);
      window.showToast?.('Não foi possível abrir este aviso.', 'error');
    }
  }

  // ------------------------------------------------ ciclo

  function attachClickListener() {
    if (clickHandler) return;
    clickHandler = (e) => {
      e?.preventDefault?.();
      abrirPainel();
    };
    btn.addEventListener('click', clickHandler);
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
  }

  function detachClickListener() {
    if (!clickHandler) return;
    btn.removeEventListener('click', clickHandler);
    clickHandler = null;
  }

  const aoVoltarFoco = () => {
    if (ativo() && Date.now() - ultimaBusca > FOCO_MINIMO_MS) refreshNotifications({ respectDaily: false });
  };

  /** Lembretes e atrasos de tarefa: quem gera é o servidor, a pedido do sino. */
  let gerando = false;
  async function gerarAvisosDeTarefas() {
    if (gerando || !ativo()) return;
    gerando = true;
    try {
      const baseUrl = await baseDaApi();
      if (!baseUrl) return;
      await fetch(new URL('/api/tarefas/avisos', baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'include', body: '{}',
      });
    } catch (err) {
      console.warn('Não foi possível gerar os avisos das tarefas.', err);
    } finally {
      gerando = false;
    }
  }

  // Notificação do Windows para o que chegou de novo. Na primeira leitura só
  // anota o que já existia (abrir o app não pode disparar dez notificações).
  const vistos = new Set();
  let primeiraLeitura = true;
  function notificarNoSistema(lista) {
    const novos = lista.filter((n) => !n.lida && n.id !== undefined && !vistos.has(n.id));
    lista.forEach((n) => vistos.add(n.id));
    if (primeiraLeitura) { primeiraLeitura = false; return; }
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return;
    for (const aviso of novos.filter((n) => NO_SISTEMA.has(n.tipo)).slice(0, 3)) {
      try {
        const n = new Notification(aviso.titulo || 'Aviso', { body: aviso.mensagem || '', tag: `sd-aviso-${aviso.id}` });
        n.onclick = () => { try { window.focus(); } catch (_) { /* segue */ } abrirAviso(aviso); n.close(); };
      } catch (err) {
        console.warn('Notificação do Windows indisponível.', err);
        return;
      }
    }
  }

  function iniciarVigia() {
    if (intervalo !== null || typeof window.setInterval !== 'function') return;
    intervalo = window.setInterval(async () => {
      if (!ativo()) return;
      await gerarAvisosDeTarefas();
      refreshNotifications({ respectDaily: false });
    }, INTERVALO_MS);
    // Logo depois de abrir: o lembrete que venceu com o app fechado já aparece.
    // (Só na tela de verdade: nos testes o documento é um dublê sem body.)
    if (document.body) window.setTimeout?.(async () => {
      if (!ativo()) return;
      await gerarAvisosDeTarefas();
      refreshNotifications({ respectDaily: false });
    }, 4000);
  }

  function pararVigia() {
    if (intervalo === null) return;
    window.clearInterval?.(intervalo);
    intervalo = null;
  }

  function applyPreferences(preferences) {
    currentPreferences = {
      enabled: preferences?.enabled !== false,
      categories: normalizeCategories(preferences?.categories),
    };
    if (ativo()) {
      attachClickListener();
      updateIcon();
      iniciarVigia();
    } else {
      fecharPainel();
      detachClickListener();
      pararVigia();
      updateIcon();
    }
  }

  applyPreferences(currentPreferences);
  window.addEventListener('focus', aoVoltarFoco);
  window.addEventListener(preferenceEvent, (event) => {
    const detail = event?.detail?.preferences;
    const estavaAtivo = ativo();
    applyPreferences(detail && typeof detail === 'object' ? detail : getPreferences());
    if (!estavaAtivo && ativo()) refreshNotifications({ respectDaily: false });
  });

  // Toda abertura do app busca (é o que acende o sino com o que chegou
  // enquanto estava fechado) e deixa a marca do dia.
  refreshNotifications({ respectDaily: false });

  window.__notificationsInternals = window.__notificationsInternals || {};
  window.__notificationsInternals.fetchNotificationsWithRetry = fetchNotificationsWithRetry;
  window.__notificationsInternals.refreshNotifications = refreshNotifications;
  window.__notificationsInternals.lerResposta = lerResposta;
  window.__notificationsInternals.quando = quando;
  window.__notificationsInternals.resetDailyState = () => {
    clearDailyCheck();
    hasDailyCheckRun = false;
  };
  window.__notificationsInternals.shutdown = () => {
    desligado = true;
    fecharPainel();
    detachClickListener();
    pararVigia();
    window.removeEventListener?.('focus', aoVoltarFoco);
    avisos = [];
    naoLidas = 0;
    clearDailyCheck();
    hasDailyCheckRun = false;
    updateIcon();
  };

  if (typeof window.setMenuNotifications !== 'function') {
    window.setMenuNotifications = (update = {}) => {
      const current = getPreferences();
      if (typeof update.enabled === 'boolean') {
        current.enabled = update.enabled;
      }
      if (update.categories !== undefined) {
        current.categories = normalizeCategories(update.categories);
      }
      savePreferences(current);
      return clone(current);
    };
  }
});
