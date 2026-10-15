/**
 * A API audita a gravação efetiva. Aqui viajam apenas contexto e cabeçalhos,
 * nunca corpos HTTP. Após await, use o token explícito de vincular(evento).
 * Um escopo global mantido até a promessa terminar atribuiria timers e outras
 * ações concorrentes ao gesto errado.
 */
(function setupActivityTracker() {
  if (window.AuditoriaAcao) return;
  const api = window.electronAPI;
  const gestos = new Set(['click', 'change', 'submit', 'keydown']);
  const porEvento = new WeakMap();
  const tokens = new WeakSet();
  const semContexto = Object.freeze({ origem: 'nao_confirmada' });
  let escopo = null;

  function identificador() {
    if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  }

  function chave(valor) {
    return String(valor || '').replace(/[^\w./:-]/g, '').slice(0, 160);
  }

  function capturar(evento = window.event) {
    if (typeof window.Event !== 'function' || !(evento instanceof window.Event)
      || evento.isTrusted !== true || !gestos.has(evento.type)) return null;
    if (porEvento.has(evento)) return porEvento.get(evento);
    const alvo = evento.target?.closest?.('[data-perm], button, [role="button"], input, select, textarea, form') || evento.target;
    const contexto = Object.freeze({
      origem: 'manual', acao_id: identificador(), evento: evento.type,
      tela: chave(document.getElementById('page-script')?.dataset?.page || window.location?.pathname),
      alvo_id: chave(alvo?.id), operacao: chave(alvo?.dataset?.perm)
    });
    porEvento.set(evento, contexto);
    tokens.add(contexto);
    return contexto;
  }

  function contextoAtual() {
    return escopo || capturar() || semContexto;
  }

  function tokenDe(eventoOuToken) {
    return eventoOuToken && tokens.has(eventoOuToken) ? eventoOuToken : capturar(eventoOuToken);
  }

  function executar(eventoOuToken, fn, ...args) {
    const anterior = escopo;
    escopo = tokenDe(eventoOuToken) || semContexto;
    try { return fn(...args); } finally { escopo = anterior; }
  }

  function automatico(fn, ...args) {
    const anterior = escopo;
    escopo = Object.freeze({ origem: 'automatico', acao_id: identificador() });
    tokens.add(escopo);
    try { return fn(...args); } finally { escopo = anterior; }
  }

  function fetchComContexto(token, input, init) {
    return executar(token, () => window.fetch(input, init));
  }

  function ipcComContexto(token, metodo, ...args) {
    const contexto = tokenDe(token) || semContexto;
    if (typeof api?.comAuditoria !== 'function') throw new Error('A ponte de auditoria precisa ser atualizada.');
    const ponte = api.comAuditoria(contexto);
    if (!Object.prototype.hasOwnProperty.call(ponte, metodo) || typeof ponte[metodo] !== 'function') {
      throw new Error('Operação IPC não disponível.');
    }
    return ponte[metodo](...args);
  }

  function vincular(eventoOuToken) {
    const token = arguments.length === 0 ? (escopo || capturar()) : tokenDe(eventoOuToken);
    return Object.freeze({
      contexto: token || semContexto,
      fetch: (input, init) => fetchComContexto(token, input, init),
      ipc: (metodo, ...args) => ipcComContexto(token, metodo, ...args),
      executar: (fn, ...args) => executar(token, fn, ...args)
    });
  }

  window.AuditoriaAcao = Object.freeze({ capturar, contextoAtual, executar, automatico,
    fetch: fetchComContexto, ipc: ipcComContexto, vincular });
  api?.registrarContextoAuditoria?.(contextoAtual);

  let avisoPendenteMostrado = false;
  function avisarAuditoriaPendente() {
    if (avisoPendenteMostrado) return;
    avisoPendenteMostrado = true;
    window.showToast?.('A operação foi processada, mas o registro de auditoria não foi confirmado. Consulte o administrador para ativar ou verificar a auditoria.', 'warning');
  }
  api?.onAuditoriaStatus?.(estado => {
    if (estado?.status === 'pendente') avisarAuditoriaPendente();
  });

  window.registerUserAction = function registerUserAction(module) {
    api?.recordActivity?.({ source: 'renderer', module: chave(module),
      contexto: contextoAtual(), description: 'Ação informada pela interface' });
  };

  if (typeof window.fetch !== 'function') return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = function trackedFetch(input, init = {}) {
    const request = typeof window.Request === 'function' && input instanceof window.Request ? input : null;
    let url;
    try { url = new URL(request ? request.url : input, window.location?.href); }
    catch (_) { return originalFetch(input, init); }
    if (!/^https?:$/.test(url.protocol) || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
    const contexto = contextoAtual();
    const headers = new Headers(init.headers === undefined ? request?.headers : init.headers);
    headers.set('X-Auditoria-Origem', contexto.origem);
    headers.set('X-Auditoria-Acao', contexto.acao_id || identificador());
    headers.set('X-Auditoria-Contexto', encodeURIComponent(JSON.stringify(contexto)));
    return originalFetch(input, { ...init, headers }).then(resposta => {
      if (resposta?.headers?.get?.('X-Auditoria-Status') === 'pendente') avisarAuditoriaPendente();
      return resposta;
    });
  };
})();
