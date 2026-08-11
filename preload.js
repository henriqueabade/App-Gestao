const { contextBridge, ipcRenderer: electronIpcRenderer } = require('electron');

// Centraliza as chamadas IPC para que a interface possa aguardar todas as
// consultas disparadas durante a inicialização de um módulo.
let ipcRequestSequence = 0;
const pendingIpcRequests = new Map();
let lastIpcActivityAt = Date.now();

function trackedIpcInvoke(...args) {
  const requestId = ++ipcRequestSequence;
  pendingIpcRequests.set(requestId, Date.now());
  lastIpcActivityAt = Date.now();

  return electronIpcRenderer.invoke(...args).finally(() => {
    pendingIpcRequests.delete(requestId);
    lastIpcActivityAt = Date.now();
  });
}

const ipcRenderer = new Proxy(electronIpcRenderer, {
  get(target, property) {
    if (property === 'invoke') return trackedIpcInvoke;
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }
});

/** A partir de quanto tempo uma chamada merece aparecer no console. */
const LIMITE_LENTIDAO_MS = 400;

function beginModuleLoading() {
  return { sequence: ipcRequestSequence, startedAt: Date.now() };
}

function waitForModuleLoading(token = {}, options = {}) {
  const sequence = Number.isFinite(token.sequence) ? token.sequence : ipcRequestSequence;
  const startedAt = Number.isFinite(token.startedAt) ? token.startedAt : Date.now();
  // ESPERAS CURTAS, porque elas são o grosso do tempo de abrir um módulo.
  //
  // A garantia de "não revelar tela pela metade" vem de `pendingIpcRequests`
  // estar vazio — isso é fato, não estimativa. O silêncio serve só para pegar
  // uma chamada ENCADEADA, que começa logo depois de a anterior responder: isso
  // acontece em poucos milissegundos, não em 220.
  //
  // Com 220 ms de silêncio + 280 ms de piso, e mais 250 ms de silêncio de fetch
  // no menu logo em seguida, todo módulo pagava mais de meio segundo de espera
  // pura — inclusive os vazios, que carregam em 90 ms.
  const quietMs = Math.max(60, Number(options.quietMs) || 90);
  const minimumMs = Math.max(0, Number(options.minimumMs) || 120);
  const timeoutMs = Math.max(minimumMs, Number(options.timeoutMs) || 30000);

  return new Promise(resolve => {
    const inspect = () => {
      const now = Date.now();
      const pendentes = [...pendingIpcRequests.keys()].filter(id => id > sequence);
      const hasModuleRequests = pendentes.length > 0;
      const minimumElapsed = now - startedAt >= minimumMs;
      const isQuiet = now - lastIpcActivityAt >= quietMs;
      if ((!hasModuleRequests && minimumElapsed && isQuiet) || now - startedAt >= timeoutMs) {
        const total = now - startedAt;
        // O NÚMERO QUE O USUÁRIO SENTE, e a razão dele.
        //
        // A espera termina quando o IPC fica quieto — não quando a última
        // resposta chega. Se alguma chamada continuar pingando, a tela segura
        // mesmo com tudo já respondido, e nenhum cronômetro de chamada
        // individual mostra isso. Só este log mostra.
        if (total >= LIMITE_LENTIDAO_MS) {
          console.warn(
            `[lento] abertura do módulo: ${total}ms `
            + `(mínimo ${minimumMs}ms, silêncio exigido ${quietMs}ms, `
            + `última atividade há ${now - lastIpcActivityAt}ms, `
            + `chamadas ainda em voo: ${pendentes.length})`
          );
        }
        resolve({ timedOut: now - startedAt >= timeoutMs });
        return;
      }
      setTimeout(inspect, 32);
    };
    inspect();
  });
}

const DEBUG = process.env.DEBUG === 'true';

function recordAction(action) {
  if (!action || typeof action !== 'object') return;
  const payload = {
    ...action,
    timestamp: action.timestamp || Date.now()
  };
  if (!payload.source) payload.source = 'ipc';
  ipcRenderer.invoke('record-user-action', payload).catch(err => {
    if (DEBUG) console.error('record-user-action failed', err);
  });
}

function recordIpcAction(channel, payload, result) {
  recordAction({ source: 'ipc', channel, payload, result });
}

function formatErrorForRecord(err) {
  if (!err) return null;
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    message: error.message || String(error),
    code: error.code,
    stack: DEBUG ? error.stack : undefined
  };
}

async function invokeIpc(channel, payload, { trackAction = false } = {}) {
  try {
    const result = await ipcRenderer.invoke(channel, payload);
    if (trackAction) {
      recordIpcAction(channel, payload, result);
    }
    return result;
  } catch (err) {
    if (trackAction) {
      recordIpcAction(channel, payload, { error: formatErrorForRecord(err) });
    }
    if (DEBUG) console.error(`${channel} failed`, err);
    throw err;
  }
}

function subscribeToChannel(channel, callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  const listener = (_event, payload) => {
    try {
      callback(payload);
    } catch (err) {
      if (DEBUG) console.error(`listener for ${channel} failed`, err);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

let runtimeConfigPromise = null;

function getRuntimeConfigCached() {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = ipcRenderer.invoke('get-runtime-config').catch(err => {
      runtimeConfigPromise = null;
      throw err;
    });
  }
  return runtimeConfigPromise;
}

/**
 * Cronômetro das chamadas ao processo principal.
 *
 * O DevTools mostra a aba Network, e a aba Network mostra `fetch`. Quase todo
 * dado de módulo NÃO passa por `fetch`: passa por IPC (`electronAPI.listarX`),
 * que atravessa o processo principal até a API remota — e some do Network.
 * Resultado: uma tela podia levar dez segundos com o Network dizendo que tudo
 * estava rápido, porque o que demorava era invisível ali.
 *
 * Só reclama do que passa do limite, para o console não virar ruído. É pouco
 * código e resolve a pergunta "o que está demorando?" sem chute.
 */
/**
 * Quem quer saber de cada chamada em andamento.
 *
 * `botaoAcao` precisa das promessas do IPC para manter o botão carregando até a
 * ação terminar. Ele tentava embrulhar `window.electronAPI` no renderer, e não
 * dava: `contextBridge` publica a ponte como propriedade NÃO-CONFIGURÁVEL, então
 * nem a atribuição nem `defineProperty` pegam — o console mostrava
 * "Cannot redefine property: electronAPI" e nenhuma ação por IPC exibia
 * carregamento. Aqui dentro do preload, onde as funções são criadas, o registro
 * é trivial.
 */
let coletorDoRenderer = null;

function cronometrar(nome, fn) {
  if (typeof fn !== 'function') return fn;
  return function (...args) {
    const inicio = Date.now();
    let resultado;
    try {
      resultado = fn.apply(this, args);
    } catch (err) {
      console.warn(`[lento] ${nome} falhou em ${Date.now() - inicio}ms`, err);
      throw err;
    }
    if (resultado && typeof resultado.then === 'function') {
      if (coletorDoRenderer) {
        try { coletorDoRenderer(resultado); } catch (_) { /* nunca derruba a ação */ }
      }
      return resultado.finally(() => {
        const levou = Date.now() - inicio;
        if (levou >= LIMITE_LENTIDAO_MS) console.warn(`[lento] ${nome}: ${levou}ms`);
      });
    }
    return resultado;
  };
}

/** Envolve cada função da ponte, mantendo o resto do objeto intacto. */
function comCronometro(api) {
  const saida = {};
  for (const [nome, valor] of Object.entries(api)) {
    saida[nome] = typeof valor === 'function' ? cronometrar(nome, valor) : valor;
  }
  return saida;
}

contextBridge.exposeInMainWorld('electronAPI', comCronometro({
  beginModuleLoading,
  waitForModuleLoading,
  /**
   * O renderer registra quem acompanha as chamadas em andamento.
   *
   * É o que devolve o carregamento aos botões que agem por IPC — ver
   * `coletorDoRenderer`. Uma função só: quem registra por último manda, e
   * `null` desliga.
   */
  registrarColetorIpc: (fn) => {
    coletorDoRenderer = typeof fn === 'function' ? fn : null;
  },
  log: (msg) => {
    if (DEBUG) ipcRenderer.send('debug-log', msg);
  },
  getRuntimeConfig: () => getRuntimeConfigCached(),
  login: (email, password) => ipcRenderer.invoke('login-usuario', { email, password }),
  obterPerfil: () => ipcRenderer.invoke('perfil:obter'),
  enviarImagemPerfil: (file) => ipcRenderer.invoke('perfil:enviar-imagem', file),
  // Foto de outro usuário (cadastro pelo Sup Admin): mesmo multipart, mirando o id.
  enviarImagemUsuario: (payload) => ipcRenderer.invoke('usuarios:enviar-imagem', payload),
  removerImagemPerfil: () => ipcRenderer.invoke('perfil:remover-imagem'),
  register: async (name, email, password) => {
    const result = await ipcRenderer.invoke('registrar-usuario', { name, email, password });
    if (result && result.success) {
      recordIpcAction('registrar-usuario', { name, email }, result);
    }
    return result;
  },
  // Módulo de Matéria-Prima
  listarMateriaPrima: (filtro) => ipcRenderer.invoke('listar-materia-prima', { filtro }),
  listarProdutosPorInsumo: (insumoId) =>
    ipcRenderer.invoke('listar-produtos-por-insumo', insumoId).catch((err) => {
      console.error('listar-produtos-por-insumo error', err);
      return [];
    }),
  listarInsumosPorProduto: (termo) =>
    ipcRenderer.invoke('listar-insumos-por-produto', termo).catch((err) => {
      console.error('listar-insumos-por-produto error', err);
      return [];
    }),
  listarCategorias: () =>
    ipcRenderer.invoke('listar-categorias').catch((err) => {
      console.error('listar-categorias error', err);
      return [];
    }),
  listarUnidades: () =>
    ipcRenderer.invoke('listar-unidades').catch((err) => {
      console.error('listar-unidades error', err);
      return [];
    }),
  listarColecoes: () =>
    ipcRenderer.invoke('listar-colecoes').catch((err) => {
      console.error('listar-colecoes error', err);
      return [];
    }),
  adicionarCategoria: async (nome) => {
    const result = await ipcRenderer.invoke('adicionar-categoria', nome);
    recordIpcAction('adicionar-categoria', nome, result);
    return result;
  },
  adicionarUnidade: async (nome) => {
    const result = await ipcRenderer.invoke('adicionar-unidade', nome);
    recordIpcAction('adicionar-unidade', nome, result);
    return result;
  },
  adicionarColecao: async (nome) => {
    const result = await ipcRenderer.invoke('adicionar-colecao', nome);
    recordIpcAction('adicionar-colecao', nome, result);
    return result;
  },
  removerCategoria: async (nome) => {
    const result = await ipcRenderer.invoke('remover-categoria', nome);
    recordIpcAction('remover-categoria', nome, result);
    return result;
  },
  removerUnidade: async (nome) => {
    const result = await ipcRenderer.invoke('remover-unidade', nome);
    recordIpcAction('remover-unidade', nome, result);
    return result;
  },
  removerColecao: async (nome) => {
    const result = await ipcRenderer.invoke('remover-colecao', nome);
    recordIpcAction('remover-colecao', nome, result);
    return result;
  },
  verificarDependenciaCategoria: (nome) => ipcRenderer.invoke('verificar-dependencia-categoria', nome),
  verificarDependenciaUnidade: (nome) => ipcRenderer.invoke('verificar-dependencia-unidade', nome),
  verificarDependenciaColecao: (nome) => ipcRenderer.invoke('verificar-dependencia-colecao', nome),
  verificarDependenciaProcesso: (nome) => ipcRenderer.invoke('verificar-dependencia-processo', nome),
  listarProdutos: () => ipcRenderer.invoke('listar-produtos'),
  obterProduto: (codigo) => ipcRenderer.invoke('obter-produto', codigo),
  adicionarProduto: async (dados) => {
    const result = await ipcRenderer.invoke('adicionar-produto', dados);
    recordIpcAction('adicionar-produto', dados, result);
    return result;
  },
  atualizarProduto: async (id, dados) => {
    const result = await ipcRenderer.invoke('atualizar-produto', { id, dados });
    recordIpcAction('atualizar-produto', { id, dados }, result);
    return result;
  },
  excluirProduto: async (info) => {
    const payload = typeof info === 'object' && info !== null ? info : { id: info };
    const result = await ipcRenderer.invoke('excluir-produto', payload.id);
    if (result && result.error) {
      throw new Error(result.error);
    }
    recordIpcAction('excluir-produto', payload, result);
    return result;
  },
  listarDetalhesProduto: (params) => ipcRenderer.invoke('listar-detalhes-produto', params),
  listarMovimentosProduto: (params) => ipcRenderer.invoke('listar-movimentos-produto', params),
  listarMovimentosInsumo: (params) => ipcRenderer.invoke('listar-movimentos-insumo', params),
  // Só leitura: diz o que aconteceria com cada insumo, para a tela avisar
  // ANTES de confirmar quais ficariam negativos.
  previsaoInsumosPeca: (dados) => ipcRenderer.invoke('previsao-insumos-peca', dados),
  inserirLoteProduto: async (dados) => {
    const result = await ipcRenderer.invoke('inserir-lote-produto', dados);
    recordIpcAction('inserir-lote-produto', dados, result);
    return result;
  },
  atualizarLoteProduto: async (dados) => {
    const result = await ipcRenderer.invoke('atualizar-lote-produto', dados);
    recordIpcAction('atualizar-lote-produto', dados, result);
    return result;
  },
  excluirLoteProduto: async (info) => {
    const payload = typeof info === 'object' && info !== null ? info : { id: info };
    if (payload.id === undefined || payload.id === null) {
      throw new Error('ID do lote não informado');
    }
    // O objeto inteiro, não só o id: é por ele que viaja a escolha de devolver
    // (ou não) a matéria-prima da peça excluída. Mandando só o id, a escolha
    // se perdia no caminho e nada era devolvido.
    const result = await ipcRenderer.invoke('excluir-lote-produto', {
      id: payload.id,
      devolverInsumos: payload.devolverInsumos === true,
      justificativaNegativo: payload.justificativaNegativo || null
    });
    recordIpcAction('excluir-lote-produto', payload, result);
    return result;
  },
  listarInsumosProduto: (codigoOuParams) => {
    const payload = typeof codigoOuParams === 'object' && codigoOuParams !== null
      ? codigoOuParams
      : { codigo: codigoOuParams };
    return ipcRenderer.invoke('listar-insumos-produto', payload);
  },
  listarEtapasProducao: () => ipcRenderer.invoke('listar-etapas-producao'),
  adicionarEtapaProducao: async (dados) => {
    const result = await ipcRenderer.invoke('adicionar-etapa-producao', dados);
    recordIpcAction('adicionar-etapa-producao', dados, result);
    return result;
  },
  removerEtapaProducao: async (nome) => {
    const result = await ipcRenderer.invoke('remover-etapa-producao', nome);
    recordIpcAction('remover-etapa-producao', nome, result);
    return result;
  },
  listarItensProcessoProduto: (codigo, etapa, busca, produtoId) =>
    ipcRenderer.invoke('listar-itens-processo-produto', { codigo, etapa, busca, produtoId }),
  salvarProdutoDetalhado: async (codigo, produto, itens, produtoId) => {
    const result = await ipcRenderer.invoke('salvar-produto-detalhado', {
      codigo,
      produto,
      itens,
      produtoId
    });
    recordIpcAction('salvar-produto-detalhado', { codigo, produto, itens, produtoId }, result);
    return result;
  },
  adicionarMateriaPrima: async (dados) => {
    const result = await ipcRenderer.invoke('adicionar-materia-prima', dados);
    if (result && result.success === false) {
      const err = new Error(result.message);
      if (result.code) err.code = result.code;
      throw err;
    }
    recordIpcAction('adicionar-materia-prima', dados, result);
    return result.materia;
  },
  atualizarMateriaPrima: async (id, dados) => {
    const result = await ipcRenderer.invoke('atualizar-materia-prima', { id, dados });
    if (result && result.success === false) {
      const err = new Error(result.message);
      if (result.code) err.code = result.code;
      throw err;
    }
    recordIpcAction('atualizar-materia-prima', { id, dados }, result);
    return result.materia;
  },
  excluirMateriaPrima: async (info) => {
    const payload = typeof info === 'object' && info !== null ? info : { id: info };
    if (payload.id === undefined || payload.id === null) {
      throw new Error('ID do insumo não informado');
    }
    const result = await ipcRenderer.invoke('excluir-materia-prima', payload.id);
    if (result && result.success === false) {
      const err = new Error(result.message);
      if (result.code) err.code = result.code;
      throw err;
    }
    recordIpcAction('excluir-materia-prima', payload, result);
    return result;
  },
  registrarEntrada: async (id, quantidade) => {
    const result = await ipcRenderer.invoke('registrar-entrada-materia-prima', { id, quantidade });
    recordIpcAction('registrar-entrada-materia-prima', { id, quantidade }, result);
    return result;
  },
  registrarSaida: async (id, quantidade) => {
    const result = await ipcRenderer.invoke('registrar-saida-materia-prima', { id, quantidade });
    recordIpcAction('registrar-saida-materia-prima', { id, quantidade }, result);
    return result;
  },
  atualizarPreco: async (id, preco) => {
    const result = await ipcRenderer.invoke('atualizar-preco-materia-prima', { id, preco });
    recordIpcAction('atualizar-preco-materia-prima', { id, preco }, result);
    return result;
  },
  autoLogin: (user) => ipcRenderer.invoke('auto-login', { user }),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  closeLogin: () => ipcRenderer.invoke('close-login'),
  openLoginHidden: () => ipcRenderer.invoke('open-login-hidden'),
  logout: () => ipcRenderer.invoke('logout'),
  checkPin: () => ipcRenderer.invoke('check-pin'),
  getConnectionStatus: () => ipcRenderer.invoke('connection-monitor:get-status'),
  requestConnectionCheck: (options) =>
    ipcRenderer.invoke('connection-monitor:request-check', options || {}),
  onConnectionStatus: (callback) => subscribeToChannel('connection-monitor:status', callback),
  onSessionForceLogout: (callback) => subscribeToChannel('session:force-logout', callback),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  loadState: () => ipcRenderer.invoke('load-state'),
  clearState: () => ipcRenderer.invoke('clear-state'),
  getUpdateStatus: (options) => invokeIpc('get-update-status', options),
  checkForUpdates: () => invokeIpc('check-for-updates', null, { trackAction: true }),
  downloadUpdate: () => invokeIpc('download-update', null, { trackAction: true }),
  installUpdate: () => invokeIpc('install-update', null, { trackAction: true }),
  publishUpdate: (payload) => invokeIpc('publish-update', payload, { trackAction: true }),
  showLogin: () => ipcRenderer.invoke('show-login'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  reloadWindow: () => ipcRenderer.invoke('reload-window'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setDisplay: (id) => ipcRenderer.invoke('set-display', id),
  openPdf: (id, tipo) => ipcRenderer.invoke('open-pdf', { id, tipo }),
  salvarHtmlComoPdf: (payload) => ipcRenderer.invoke('salvar-html-como-pdf', payload),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openExternalHtml: (html) => ipcRenderer.invoke('open-external-html', html),
  recordActivity: (info) => {
    if (!info || typeof info !== 'object') return;
    const payload = { ...info };
    if (!payload.source) payload.source = 'renderer';
    recordAction(payload);
  },
  getSavedDisplay: () => ipcRenderer.invoke('get-saved-display'),
  onActivateTab: (callback) =>
    ipcRenderer.on('activate-tab', (_event, tab) => callback(tab)),
  onSelectTab: (callback) =>
    ipcRenderer.on('select-tab', (_event, tab) => callback(tab)),
  onUpdateStatus: (callback) => subscribeToChannel('update-status', callback),
  onNetworkStatus: (callback) => subscribeToChannel('network-status', callback),
  onPublishStatus: (callback) => {
    const unsubscribes = ['publish-progress', 'publish-done'].map(channel =>
      subscribeToChannel(channel, callback)
    );
    return () => {
      unsubscribes.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
      });
    };
  },
  onPublishError: (callback) => subscribeToChannel('publish-error', callback)
  }));



// Changelog:
// - 2024-05-17: adicionadas APIs de monitoramento de conexão (status, request e listener) para uso pelo renderer.
// - 2024-06-09: exposto listener session:force-logout para reutilizar fluxo de logout centralizado.
