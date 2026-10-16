const { contextBridge, ipcRenderer: electronIpcRenderer } = require('electron');

// Lista explícita das operações já publicadas pela ponte. Não expõe um
// invoke genérico ao renderer e não usa o mapa de rótulos do processo main.
const TRACKED_IPC_ACTIONS = new Set([
  'registrar-usuario', 'adicionar-categoria', 'adicionar-unidade', 'adicionar-colecao',
  'remover-categoria', 'remover-unidade', 'remover-colecao', 'gravar-preco-tabela',
  'adicionar-produto', 'atualizar-produto', 'excluir-produto', 'inserir-lote-produto',
  'atualizar-lote-produto', 'excluir-lote-produto', 'adicionar-etapa-producao',
  'remover-etapa-producao', 'salvar-produto-detalhado', 'adicionar-materia-prima',
  'atualizar-materia-prima', 'excluir-materia-prima', 'registrar-entrada-materia-prima',
  'registrar-saida-materia-prima', 'atualizar-preco-materia-prima', 'perfil:enviar-imagem',
  'usuarios:enviar-imagem', 'perfil:remover-imagem', 'avisos-windows:gravar-preferencias',
  'avisos-windows:categorias'
]);
let provedorContextoAuditoria = null;
let contextoIpcExplicito = null;

function chaveAuditoria(valor, limite = 160) {
  return typeof valor === 'string' ? valor.replace(/[^\w./:-]/g, '').slice(0, limite) : '';
}

function normalizarContextoAuditoria(entrada) {
  const origem = ['manual', 'automatico'].includes(entrada?.origem) ? entrada.origem : 'nao_confirmada';
  const acaoId = chaveAuditoria(entrada?.acao_id, 80);
  if (origem === 'manual' && !acaoId) return { origem: 'nao_confirmada' };
  const contexto = { origem };
  if (acaoId) contexto.acao_id = acaoId;
  for (const campo of ['evento', 'tela', 'alvo_id', 'operacao']) {
    const valor = chaveAuditoria(entrada?.[campo]);
    if (valor) contexto[campo] = valor;
  }
  return contexto;
}

function obterContextoAuditoria() {
  if (contextoIpcExplicito) return contextoIpcExplicito;
  try { return normalizarContextoAuditoria(provedorContextoAuditoria?.()); }
  catch (_) { return { origem: 'nao_confirmada' }; }
}

/** Só nomes de campos e identificação: nenhum corpo/retorno bruto ou segredo. */
function detalhesSegurosAuditoria(payload) {
  const campos = [];
  const protegidos = [];
  const alvo = {};
  const sensivel = /senha|password|secret|token|authorization|credential|certificad|private.?key|api.?key|cookie|pin|pfx|p12/i;
  const visitados = new WeakSet();
  function visitar(objeto, prefixo = '', profundidade = 0) {
    if (!objeto || typeof objeto !== 'object' || visitados.has(objeto) || profundidade > 3) return;
    visitados.add(objeto);
    for (const [campo, valor] of Object.entries(objeto).slice(0, 50)) {
      const caminho = `${prefixo}${chaveAuditoria(campo, 80)}`;
      if (campos.length >= 80) break;
      if (sensivel.test(campo)) { protegidos.push(caminho); continue; }
      campos.push(caminho);
      if (['id', 'nome', 'name', 'codigo'].includes(campo) && (typeof valor === 'string' || typeof valor === 'number')) {
        const chave = campo === 'name' ? 'nome' : campo;
        if (alvo[chave] === undefined) alvo[chave] = String(valor).replace(/[\r\n\t]/g, ' ').slice(0, 120);
      }
      visitar(valor, `${caminho}.`, profundidade + 1);
    }
  }
  visitar(payload);
  return { campos, campos_protegidos: protegidos, alvo };
}

// Centraliza as chamadas IPC para que a interface possa aguardar todas as
// consultas disparadas durante a inicialização de um módulo.
let ipcRequestSequence = 0;
const pendingIpcRequests = new Map();
let lastIpcActivityAt = Date.now();

function trackedIpcInvoke(...args) {
  const [channel, payload] = args;
  const contexto = obterContextoAuditoria();
  // O main recebe a origem ANTES de executar a operação. O segundo argumento
  // continua sendo o payload original esperado pelos handlers existentes.
  const argumentos = channel === 'record-user-action' ? args
    : [channel, payload, ...args.slice(2), { __auditoria: contexto }];
  const requestId = ++ipcRequestSequence;
  pendingIpcRequests.set(requestId, Date.now());
  lastIpcActivityAt = Date.now();

  return electronIpcRenderer.invoke(...argumentos).then(result => {
    if (TRACKED_IPC_ACTIONS.has(channel)) recordIpcAction(channel, payload, result, contexto);
    return result;
  }, err => {
    if (TRACKED_IPC_ACTIONS.has(channel)) recordIpcAction(channel, payload, null, contexto, false);
    throw err;
  }).finally(() => {
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

/**
 * A partir de quanto tempo uma chamada merece aparecer no console.
 *
 * Alto de propósito. Abrir um módulo custa uns 400 ms hoje — piso de espera
 * mais montagem da tabela — e ninguém sente isso. Um alarme que dispara em toda
 * abertura vira ruído, e ruído a gente aprende a ignorar; então o limite fica
 * acima do normal, para o log só falar quando houver algo de fato errado.
 */
const LIMITE_LENTIDAO_MS = 800;

/**
 * Chamadas que já têm log próprio, mais detalhado.
 *
 * `waitForModuleLoading` é uma ESPERA, não trabalho: o cronômetro genérico
 * repetiria o mesmo número sem o porquê, ao lado da linha que explica.
 */
const SEM_CRONOMETRO_GENERICO = new Set(['waitForModuleLoading', 'beginModuleLoading']);

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
          // A diferença entre "silêncio há X" e o silêncio exigido diz ONDE o
          // tempo foi: sobra grande significa que a thread estava ocupada
          // montando a tela e nem conseguiu rodar esta verificação; sobra
          // pequena significa que o tempo foi esperando dado mesmo.
          const atraso = Math.max(0, (now - lastIpcActivityAt) - quietMs);
          console.warn(
            `[lento] abertura do módulo: ${total}ms `
            + `(mínimo ${minimumMs}ms, silêncio exigido ${quietMs}ms, `
            + `última atividade há ${now - lastIpcActivityAt}ms, `
            + `chamadas ainda em voo: ${pendentes.length}, `
            + `thread ocupada por ~${atraso}ms)`
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
  // O backend já audita HTTP. Um registro do renderer duplicaria a mudança.
  if (action.source === 'fetch') return;
  const contexto = normalizarContextoAuditoria(action.contexto || obterContextoAuditoria());
  const payload = {
    source: action.source === 'ipc' ? 'ipc' : 'renderer',
    channel: chaveAuditoria(action.channel),
    module: chaveAuditoria(action.module),
    method: action.source === 'ipc' ? 'IPC' : chaveAuditoria(action.method),
    url: chaveAuditoria(action.channel),
    manual: contexto.origem === 'manual', contexto,
    details: detalhesSegurosAuditoria(action.payload),
    ok: action.ok !== false,
    timestamp: Date.now()
  };
  ipcRenderer.invoke('record-user-action', payload).catch(err => {
    if (DEBUG) console.error('record-user-action failed', err);
  });
}

function recordIpcAction(channel, payload, result, contexto, ok = true) {
  const entrada = typeof payload === 'string' && /^(adicionar|remover)-(categoria|unidade|colecao|etapa-producao)$/.test(channel)
    ? { nome: payload } : (typeof payload === 'number' ? { id: payload } : payload);
  recordAction({ source: 'ipc', channel, payload: entrada, contexto,
    ok: ok && result?.success !== false && !result?.error });
}

async function invokeIpc(channel, payload, { trackAction = false } = {}) {
  if (trackAction) TRACKED_IPC_ACTIONS.add(channel);
  try {
    const result = await ipcRenderer.invoke(channel, payload);
    return result;
  } catch (err) {
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
    saida[nome] = typeof valor === 'function' && !SEM_CRONOMETRO_GENERICO.has(nome)
      ? cronometrar(nome, valor)
      : valor;
  }
  return saida;
}

const electronApiDefinitions = {
  beginModuleLoading,
  waitForModuleLoading,
  registrarContextoAuditoria: (provider) => {
    provedorContextoAuditoria = typeof provider === 'function' ? provider : null;
  },
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
  // 'DEV' ou 'PROD' — só para o selo do cabeçalho.
  getModoBanco: () => ipcRenderer.invoke('get-modo-banco'),
  getNaMicrosoftStore: () => ipcRenderer.invoke('get-na-microsoft-store'),
  // Abre o seletor de arquivo do certificado fiscal; devolve só o caminho.
  selecionarCertificadoFiscal: () => ipcRenderer.invoke('fiscal:selecionar-certificado'),
  login: (email, password) => ipcRenderer.invoke('login-usuario', { email, password }),
  obterPerfil: () => ipcRenderer.invoke('perfil:obter'),
  enviarImagemPerfil: (file) => ipcRenderer.invoke('perfil:enviar-imagem', file),
  // Foto de outro usuário (cadastro pelo Sup Admin): mesmo multipart, mirando o id.
  enviarImagemUsuario: (payload) => ipcRenderer.invoke('usuarios:enviar-imagem', payload),
  removerImagemPerfil: () => ipcRenderer.invoke('perfil:remover-imagem'),
  // `aceites`: versões dos Termos de Uso e da Política de Privacidade aceitas na tela.
  register: async (name, email, password, aceites) => {
    const result = await ipcRenderer.invoke('registrar-usuario', { name, email, password, aceites });
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
    return result;
  },
  adicionarUnidade: async (nome) => {
    const result = await ipcRenderer.invoke('adicionar-unidade', nome);
    return result;
  },
  adicionarColecao: async (nome) => {
    const result = await ipcRenderer.invoke('adicionar-colecao', nome);
    return result;
  },
  removerCategoria: async (nome) => {
    const result = await ipcRenderer.invoke('remover-categoria', nome);
    return result;
  },
  removerUnidade: async (nome) => {
    const result = await ipcRenderer.invoke('remover-unidade', nome);
    return result;
  },
  removerColecao: async (nome) => {
    const result = await ipcRenderer.invoke('remover-colecao', nome);
    return result;
  },
  verificarDependenciaCategoria: (nome) => ipcRenderer.invoke('verificar-dependencia-categoria', nome),
  verificarDependenciaUnidade: (nome) => ipcRenderer.invoke('verificar-dependencia-unidade', nome),
  verificarDependenciaColecao: (nome) => ipcRenderer.invoke('verificar-dependencia-colecao', nome),
  verificarDependenciaProcesso: (nome) => ipcRenderer.invoke('verificar-dependencia-processo', nome),
  listarProdutos: () => ipcRenderer.invoke('listar-produtos'),
  listarTabelaFixa: () => ipcRenderer.invoke('listar-tabela-fixa'),
  gravarPrecoTabela: (payload) => ipcRenderer.invoke('gravar-preco-tabela', payload),
  obterProduto: (codigo) => ipcRenderer.invoke('obter-produto', codigo),
  adicionarProduto: async (dados) => {
    const result = await ipcRenderer.invoke('adicionar-produto', dados);
    return result;
  },
  atualizarProduto: async (id, dados) => {
    const result = await ipcRenderer.invoke('atualizar-produto', { id, dados });
    return result;
  },
  excluirProduto: async (info) => {
    const payload = typeof info === 'object' && info !== null ? info : { id: info };
    const result = await ipcRenderer.invoke('excluir-produto', payload.id);
    if (result && result.error) {
      throw new Error(result.error);
    }
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
    return result;
  },
  atualizarLoteProduto: async (dados) => {
    const result = await ipcRenderer.invoke('atualizar-lote-produto', dados);
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
    return result;
  },
  removerEtapaProducao: async (nome) => {
    const result = await ipcRenderer.invoke('remover-etapa-producao', nome);
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
    return result;
  },
  adicionarMateriaPrima: async (dados) => {
    const result = await ipcRenderer.invoke('adicionar-materia-prima', dados);
    if (result && result.success === false) {
      const err = new Error(result.message);
      if (result.code) err.code = result.code;
      throw err;
    }
    return result.materia;
  },
  atualizarMateriaPrima: async (id, dados) => {
    const result = await ipcRenderer.invoke('atualizar-materia-prima', { id, dados });
    if (result && result.success === false) {
      const err = new Error(result.message);
      if (result.code) err.code = result.code;
      throw err;
    }
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
    return result;
  },
  registrarEntrada: async (id, quantidade) => {
    const result = await ipcRenderer.invoke('registrar-entrada-materia-prima', { id, quantidade });
    return result;
  },
  registrarSaida: async (id, quantidade) => {
    const result = await ipcRenderer.invoke('registrar-saida-materia-prima', { id, quantidade });
    return result;
  },
  atualizarPreco: async (id, preco) => {
    const result = await ipcRenderer.invoke('atualizar-preco-materia-prima', { id, preco });
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
  salvarTextoComoArquivo: (payload) => ipcRenderer.invoke('salvar-texto-como-arquivo', payload),
  salvarArquivoBinario: (payload) => ipcRenderer.invoke('salvar-arquivo-binario', payload),
  gerarPdfDeHtml: (payload) => ipcRenderer.invoke('gerar-pdf-de-html', payload),
  // Visualizar documento (src/js/utils/visualizador-pdf.js): salvar e imprimir
  // os mesmos bytes que o modal mostra.
  salvarPdf: (payload) => ipcRenderer.invoke('salvar-pdf', payload),
  imprimirPdf: (payload) => ipcRenderer.invoke('imprimir-pdf', payload),
  // O PDF do orçamento/pedido em bytes, sem a janela de salvar (Fase 2).
  gerarPdfDocumento: (id, tipo) => ipcRenderer.invoke('open-pdf', { id, tipo, somenteBytes: true }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openExternalHtml: (html) => ipcRenderer.invoke('open-external-html', html),
  recordActivity: (info) => {
    if (!info || typeof info !== 'object') return;
    const payload = { ...info };
    if (!payload.source) payload.source = 'renderer';
    recordAction(payload);
  },
  onAuditoriaStatus: (callback) => subscribeToChannel('auditoria-status', callback),
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
  onPublishError: (callback) => subscribeToChannel('publish-error', callback),
  /**
   * O programa no Windows (01/10/2026): preferências (iniciar com o Windows,
   * avisos no canto da tela, som), a janela dos avisos (backend/janelaDeAviso.js)
   * e o aviso que ela manda abrir no sino.
   */
  avisosWindows: {
    lerPreferencias: () => ipcRenderer.invoke('avisos-windows:preferencias'),
    gravarPreferencias: (mudancas) => ipcRenderer.invoke('avisos-windows:gravar-preferencias', mudancas),
    onPreferencias: (callback) => subscribeToChannel('avisos-windows:preferencias', callback),
    // janela do canto
    pronto: () => ipcRenderer.invoke('avisos-windows:pronto'),
    onAvisos: (callback) => subscribeToChannel('avisos-windows:avisos', callback),
    ajustarAltura: (altura) => ipcRenderer.invoke('avisos-windows:altura', altura),
    abrir: (aviso) => ipcRenderer.invoke('avisos-windows:abrir', aviso || null),
    dispensar: () => ipcRenderer.invoke('avisos-windows:dispensar'),
    // o sino, com o programa aberto
    onAbrirAviso: (callback) => subscribeToChannel('avisos-windows:abrir-no-sino', callback),
    avisoPendente: () => ipcRenderer.invoke('avisos-windows:pendente'),
    lidos: (lidos) => ipcRenderer.invoke('avisos-windows:lidos', lidos || {}),
    // as categorias do sino (Configurações › Notificações) valem para a janela do canto
    categorias: (preferencias) => ipcRenderer.invoke('avisos-windows:categorias', preferencias || {}),
    // o chat interno (12/10/2026): ao vivo ligado e a mensagem nova para a janela do canto
    chatAoVivo: (ligado) => ipcRenderer.invoke('avisos-windows:chat-ao-vivo', Boolean(ligado)),
    chat: (item) => ipcRenderer.invoke('avisos-windows:chat', item || null)
  }
};

/** APIs já autorizadas, vinculadas a um token; não aceita nomes de canais IPC. */
function comAuditoria(contextoBruto) {
  const contexto = normalizarContextoAuditoria(contextoBruto);
  const vincular = api => Object.fromEntries(Object.entries(api)
    .filter(([nome]) => !['comAuditoria', 'registrarContextoAuditoria'].includes(nome))
    .map(([nome, valor]) => [nome, typeof valor === 'function' ? (...args) => {
      const anterior = contextoIpcExplicito;
      contextoIpcExplicito = contexto;
      try { return valor(...args); } finally { contextoIpcExplicito = anterior; }
    } : (valor && typeof valor === 'object' ? vincular(valor) : valor)]));
  return comCronometro(vincular(electronApiDefinitions));
}
electronApiDefinitions.comAuditoria = comAuditoria;
contextBridge.exposeInMainWorld('electronAPI', comCronometro(electronApiDefinitions));



// Changelog:
// - 2024-05-17: adicionadas APIs de monitoramento de conexão (status, request e listener) para uso pelo renderer.
// - 2024-06-09: exposto listener session:force-logout para reutilizar fluxo de logout centralizado.
