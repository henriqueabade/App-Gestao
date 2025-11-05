
const { app, BrowserWindow, ipcMain, screen, shell, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const DEBUG = process.env.DEBUG === 'true';
const { autoUpdater } = require('electron-updater');
const updateService = require('./backend/updateService');
const publisher = require('./backend/publisher');
const versionManager = require('./backend/versionManager');
const { performReleaseCommit } = require('./backend/gitAutomation');
const {
  registrarUsuario,
  loginUsuario,
  isPinError,
  isNetworkError
} = require('./backend/backend');
const { registrarUltimaSaida, registrarUltimaEntrada } = require('./backend/userActivity');
const db = require('./backend/db');
const fs = require('fs');
const net = require('net');
const http = require('http');
const {
  listarMaterias,
  adicionarMateria,
  atualizarMateria,
  excluirMateria,
  registrarEntrada,
  registrarSaida,
  atualizarPreco,
  listarCategorias,
  listarUnidades,
  adicionarCategoria,
  adicionarUnidade,
  removerCategoria,
  removerUnidade,
  categoriaTemDependencias,
  unidadeTemDependencias,
  processoTemDependencias
} = require('./backend/materiaPrima');
const {
  listarProdutos,
  obterProduto,
  adicionarProduto,
  atualizarProduto,
  excluirProduto,
  listarDetalhesProduto,
  listarInsumosProduto,
  listarEtapasProducao,
  adicionarEtapaProducao,
  removerEtapaProducao,
  listarItensProcessoProduto,
  inserirLoteProduto,
  atualizarLoteProduto,
  excluirLoteProduto,
  salvarProdutoDetalhado,
  listarColecoes,
  adicionarColecao,
  removerColecao,
  colecaoTemDependencias
} = require('./backend/produtos');
const apiServer = require('./backend/server');

function showStartupBanner() {
  const banner = `\n==============================\n Aplicativo iniciado com sucesso! \n==============================\n`;
  console.log(banner);
}

// Impede que múltiplas instâncias do aplicativo sejam abertas
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Garante que qualquer janela criada permaneça em tela cheia
app.on('browser-window-created', (_event, win) => {
  const webPreferences =
    typeof win.webContents.getWebPreferences === 'function'
      ? win.webContents.getWebPreferences()
      : {};
  if (webPreferences.sandbox) {
    return;
  }
  win.setFullScreen(true);
  win.setResizable(false);
  win.setMaximizable(false);
  win.setMinimizable(false);
  win.setFullScreenable(false);
  win.on('leave-full-screen', () => {
    win.setFullScreen(true);
  });
  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    if (input.control && key === 'w') {
      event.preventDefault();
      app.quit();
    }
    if (input.control && key === 'r') {
      event.preventDefault();
      const url = win.webContents.getURL();
      if (url.includes('login/login.html')) {
        win.loadFile(
          path.join(__dirname, 'src/login/login.html'),
          { query: { hidden: '1' } }
        );
      } else {
        win.reload();
      }
    }
  });
});

let loginWindow = null;
let dashboardWindow = null;
let stateFile;
let displayFile;
let currentDisplayId;
let currentUserSession = null;
let isSupAdmin = false;
let lastRecordedAction = null;
let isPersistingExit = false;
let apiServerInstance = null;
let currentApiPort = null;
ipcMain.handle('get-runtime-config', () => {
  const port = currentApiPort ?? configuredApiPort ?? DEFAULT_API_PORT;
  return { apiBaseUrl: `http://localhost:${port}` };
});
let closingDashboardWindow = false;
let quittingApp = false;
const localAppVersion = app.getVersion();
const initialPublishing = publisher.isPublishing();
const projectRoot = path.resolve(__dirname);

const HEALTH_CHECK_INTERVAL_MS = 10000;
const HEALTH_CHECK_TIMEOUT_MS = 5000;
const HEALTH_CHECK_PATH = '/healthz';

const DEFAULT_API_PORT = 3000;
const MAX_PORT = 65535;
let configuredApiPort = DEFAULT_API_PORT;

let publishState = {
  publishing: initialPublishing,
  canPublish: !initialPublishing,
  latestPublishedVersion: localAppVersion,
  localVersion: localAppVersion,
  lastPublishedCommit: null,
  pendingChanges: []
};

let gitUnavailable = false;
const gitCommandTimeout = Number.parseInt(process.env.GIT_COMMAND_TIMEOUT_MS || '', 10);
let headCommitState = {
  promise: null,
  value: null,
  timestamp: 0
};
let pendingChangesRefreshPromise = null;
let lastPendingChangesContext = {
  head: null,
  reference: null
};
let publishStateInitializationPromise = null;
const updateStatusCache = {
  promise: null,
  value: null,
  timestamp: 0,
  refreshInFlight: false
};
const UPDATE_STATUS_CACHE_TTL = 1500;

let publishStateFilePath;

let healthCheckAgent = null;
let healthCheckIntervalId = null;
let lastHealthStatusPayload = null;

function getPublishStateFilePath() {
  if (!publishStateFilePath) {
    publishStateFilePath = path.join(app.getPath('userData'), 'publish-state.json');
  }
  return publishStateFilePath;
}

function loadPersistedPublishState() {
  try {
    const filePath = getPublishStateFilePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.error('Não foi possível carregar estado de publicação persistido:', err);
    return null;
  }
}

function ensureHealthCheckAgent() {
  if (!healthCheckAgent) {
    healthCheckAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: HEALTH_CHECK_INTERVAL_MS,
      maxSockets: 1,
      maxFreeSockets: 1
    });
  }
  return healthCheckAgent;
}

function sendLastNetworkStatusToWindow(win) {
  if (!win || win.isDestroyed() || !lastHealthStatusPayload) return;
  try {
    win.webContents.send('network-status', lastHealthStatusPayload);
  } catch (err) {
    if (DEBUG) console.error('Falha ao enviar status de rede para janela', err);
  }
}

function broadcastNetworkStatus(payload) {
  lastHealthStatusPayload = payload;
  BrowserWindow.getAllWindows().forEach(win => {
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('network-status', payload);
      } catch (err) {
        if (DEBUG) console.error('Falha ao enviar status de rede', err);
      }
    }
  });
}

function performHealthCheck() {
  if (!currentApiPort) {
    return Promise.resolve();
  }

  const agent = ensureHealthCheckAgent();

  return new Promise((resolve) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: currentApiPort,
        path: HEALTH_CHECK_PATH,
        method: 'GET',
        agent,
        timeout: HEALTH_CHECK_TIMEOUT_MS
      },
      (res) => {
        res.resume();
        const online = res.statusCode >= 200 && res.statusCode < 300;
        resolve({ online, statusCode: res.statusCode });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error('Health check timeout'));
    });

    request.on('error', (err) => {
      resolve({ online: false, error: err });
    });

    request.end();
  })
    .then((result) => {
      if (!result) return;
      const payload = {
        online: Boolean(result.online),
        timestamp: Date.now()
      };

      if (typeof result.statusCode === 'number') {
        payload.statusCode = result.statusCode;
      }

      payload.status = payload.online ? 'online' : 'offline';

      if (!result.online && result.error) {
        payload.error = {
          message: result.error.message,
          code: result.error.code
        };
      }

      broadcastNetworkStatus(payload);
    })
    .catch((err) => {
      if (DEBUG) console.error('Falha na verificação de saúde da API', err);
    });
}

function startHealthMonitoring() {
  stopHealthMonitoring();
  performHealthCheck();
  healthCheckIntervalId = setInterval(() => {
    performHealthCheck();
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthMonitoring() {
  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId);
    healthCheckIntervalId = null;
  }
  if (healthCheckAgent) {
    try {
      healthCheckAgent.destroy();
    } catch (err) {
      if (DEBUG) console.error('Falha ao destruir agente de verificação de saúde', err);
    }
    healthCheckAgent = null;
  }
}

function persistPublishStateSnapshot() {
  try {
    const filePath = getPublishStateFilePath();
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const snapshot = {
      latestPublishedVersion: publishState.latestPublishedVersion,
      localVersion: publishState.localVersion,
      lastPublishedCommit: publishState.lastPublishedCommit
    };
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (err) {
    console.error('Não foi possível salvar estado de publicação:', err);
  }
}

const persistedPublishState = loadPersistedPublishState();
if (persistedPublishState) {
  if (persistedPublishState.latestPublishedVersion) {
    publishState.latestPublishedVersion = persistedPublishState.latestPublishedVersion;
  }
  if (persistedPublishState.localVersion) {
    publishState.localVersion = persistedPublishState.localVersion;
  }
  if (persistedPublishState.lastPublishedCommit) {
    publishState.lastPublishedCommit = persistedPublishState.lastPublishedCommit;
  }
}

function getPublishLogPath() {
  return path.join(__dirname, 'publish-audit.log');
}

function recordPublishAudit(event, extra = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    event,
    userId: currentUserSession?.id ?? null,
    userName: currentUserSession?.nome ?? null,
    ...extra
  };
  try {
    fs.appendFileSync(getPublishLogPath(), `${JSON.stringify(payload)}\n`);
  } catch (err) {
    console.error('Não foi possível registrar auditoria de publicação:', err);
  }
}

function runGitCommand(args = []) {
  if (gitUnavailable) {
    return Promise.resolve(null);
  }

  const command = ['git', ...(Array.isArray(args) ? args : [])].join(' ');
  const options = {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true
  };

  if (Number.isFinite(gitCommandTimeout) && gitCommandTimeout > 0) {
    options.timeout = gitCommandTimeout;
  }

  return new Promise(resolve => {
    const child = execFile('git', args, options, (error, stdout = '', stderr = '') => {
      if (error) {
        if (error && error.code === 'ENOENT') {
          gitUnavailable = true;
        }
        if (DEBUG) {
          const errorMessage = stderr ? stderr.toString().trim() : error.message;
          console.warn('git command failed:', command, errorMessage);
        }
        resolve(null);
        return;
      }
      resolve(stdout || '');
    });

    child.on('error', err => {
      if (err && err.code === 'ENOENT') {
        gitUnavailable = true;
      }
      if (DEBUG) {
        console.warn('git command failed:', command, err);
      }
      resolve(null);
    });
  });
}

async function getHeadCommitHash(options = {}) {
  if (gitUnavailable) {
    return null;
  }

  const { force = false } = options;
  const now = Date.now();

  if (!force && headCommitState.value && now - headCommitState.timestamp < 2000) {
    return headCommitState.value;
  }

  if (!force && headCommitState.promise) {
    return headCommitState.promise;
  }

  const execution = (async () => {
    const output = await runGitCommand(['rev-parse', 'HEAD']);
    if (!output) return null;
    const value = output.trim();
    return value || null;
  })();

  headCommitState.promise = execution
    .then(value => {
      headCommitState.value = value;
      headCommitState.timestamp = Date.now();
      return value;
    })
    .catch(err => {
      if (DEBUG) {
        console.warn('Falha ao obter HEAD do Git:', err);
      }
      return null;
    })
    .finally(() => {
      if (headCommitState.promise === execution) {
        headCommitState.promise = null;
      }
    });

  return headCommitState.promise;
}

function invalidateHeadCommitCache() {
  headCommitState = {
    promise: null,
    value: null,
    timestamp: 0
  };
}

function deriveSummaryFromSubject(subject) {
  if (!subject) return '';
  const trimmed = String(subject).trim();
  if (!trimmed) return '';
  const normalized = trimmed.replace(/\s+/g, ' ');
  const sentence = `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
  return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`;
}

async function getChangedFilesForCommit(hash) {
  if (!hash) return [];
  const output = await runGitCommand(['show', '--pretty=format:', '--name-only', hash]);
  if (!output) return [];
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function buildFileDisplayName(filePath) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return normalized;
  if (segments.length === 1) {
    return segments[0];
  }
  return segments.slice(-2).join('/');
}

function categorizeChangedFiles(files) {
  const categories = {
    frontend: new Set(),
    backend: new Set(),
    tests: new Set(),
    docs: new Set(),
    config: new Set(),
    dependencies: new Set(),
    assets: new Set(),
    database: new Set(),
    scripts: new Set(),
    other: new Set(),
    frontendDetails: {
      styles: new Set(),
      layouts: new Set(),
      logic: new Set()
    }
  };

  files.forEach(file => {
    if (!file) return;
    const normalized = file.replace(/\\/g, '/');
    const lower = normalized.toLowerCase();
    const display = buildFileDisplayName(normalized);

    const baseName = path.basename(normalized);
    const isTest = /test|spec|\.test|\.spec|__tests__/i.test(normalized);
    const isDoc = lower.startsWith('docs/') || /\.(md|mdx|adoc|rst)$/i.test(baseName);
    const isConfig =
      lower.includes('config/') ||
      /config\.(js|ts|json|mjs|cjs)$/i.test(baseName) ||
      /\.ya?ml$/i.test(baseName);
    const isDependency = /package(-lock)?\.json$|yarn\.lock$|pnpm-lock\.ya?ml$/i.test(baseName);
    const isAsset = /\.(png|jpe?g|gif|svg|ico|webp|bmp)$/i.test(baseName);
    const isDatabase = /^(data\/|migrations?\/)/.test(lower) || /\.sql$/i.test(baseName);
    const isScript = lower.startsWith('scripts/') || lower.startsWith('tools/');

    const ext = path.extname(baseName).toLowerCase();

    if (normalized.startsWith('src/') || normalized.startsWith('manual-tests/') || normalized.startsWith('public/')) {
      categories.frontend.add(display);

      const isStyleFile =
        [
          '.css',
          '.scss',
          '.sass',
          '.less',
          '.styl'
        ].includes(ext) ||
        /\b(styles|css)\b/.test(normalized);
      const isLayoutFile = ['.html', '.hbs', '.ejs', '.pug', '.vue'].includes(ext);
      const isLogicFile =
        ['.js', '.ts', '.tsx', '.jsx'].includes(ext) ||
        /\b(js|ts)\b/.test(path.dirname(normalized));

      if (isStyleFile) {
        categories.frontendDetails.styles.add(display);
      } else if (isLayoutFile) {
        categories.frontendDetails.layouts.add(display);
      } else if (isLogicFile) {
        categories.frontendDetails.logic.add(display);
      }
    } else if (normalized.startsWith('backend/')) {
      categories.backend.add(display);
    } else if (isTest) {
      categories.tests.add(display);
    } else if (isDoc) {
      categories.docs.add(display);
    } else if (isDependency) {
      categories.dependencies.add(display);
    } else if (isConfig) {
      categories.config.add(display);
    } else if (isDatabase) {
      categories.database.add(display);
    } else if (isScript) {
      categories.scripts.add(display);
    } else if (isAsset) {
      categories.assets.add(display);
    } else {
      categories.other.add(display);
    }
  });

  return categories;
}

function formatFileList(set, max = 2) {
  const values = Array.from(set).filter(Boolean);
  if (!values.length) return '';
  const selected = values.slice(0, max);
  const remaining = values.length - selected.length;
  const formatted = selected.join(', ');
  if (remaining > 0) {
    return `${formatted} e +${remaining}`;
  }
  return formatted;
}

function summarizeChangedFiles(files) {
  if (!Array.isArray(files) || !files.length) return '';
  const categories = categorizeChangedFiles(files);
  const impactMessages = [];

  const frontendDetails = categories.frontendDetails || { styles: new Set(), layouts: new Set(), logic: new Set() };

  const styleList = formatFileList(frontendDetails.styles, 3);
  if (styleList) {
    impactMessages.push(
      `Atualiza a paleta de cores e os contrastes das telas (${styleList}), aplicando o novo visual assim que a atualização for instalada.`
    );
  }

  const layoutList = formatFileList(frontendDetails.layouts, 3);
  if (layoutList) {
    impactMessages.push(
      `Reorganiza a estrutura e os componentes visuais (${layoutList}), deixando a navegação mais clara para a equipe.`
    );
  }

  const logicList = formatFileList(frontendDetails.logic, 3);
  if (logicList) {
    const touchesMenu = frontendDetails.logic.has('js/menu.js');
    const message = touchesMenu
      ? `Torna imediata a abertura e o fechamento do painel "Atualizações" (${logicList}), eliminando travamentos ao clicar no botão.`
      : `Ajusta os comportamentos interativos das telas (${logicList}), garantindo respostas mais rápidas durante o uso.`;
    impactMessages.push(message);
  }

  const CATEGORY_BUILDERS = [
    {
      items: categories.backend,
      build: list =>
        `Reestrutura serviços internos e regras de negócio (${list}), garantindo respostas consistentes aos novos processos.`
    },
    {
      items: categories.tests,
      build: list =>
        `Reforça a confiabilidade adicionando cenários automatizados que validam os comportamentos atualizados (${list}), prevenindo regressões.`
    },
    {
      items: categories.docs,
      build: list =>
        `Atualiza a documentação compartilhada (${list}) com orientações práticas sobre como aplicar as mudanças.`
    },
    {
      items: categories.config,
      build: list =>
        `Ajusta configurações e parâmetros do projeto (${list}) para sustentar o novo comportamento em todos os ambientes.`
    },
    {
      items: categories.dependencies,
      build: list =>
        `Mantém dependências e bibliotecas alinhadas (${list}), preservando compatibilidade e segurança.`
    },
    {
      items: categories.scripts,
      build: list =>
        `Refina automações e scripts de suporte (${list}) para simplificar tarefas recorrentes da equipe.`
    },
    {
      items: categories.assets,
      build: list =>
        `Atualiza recursos visuais e arquivos estáticos (${list}), assegurando que a identidade visual reflita as melhorias.`
    },
    {
      items: categories.database,
      build: list =>
        `Organiza estruturas de dados e migrações (${list}) para acomodar os novos fluxos sem perda de informação.`
    }
  ];

  CATEGORY_BUILDERS.forEach(({ items, build }) => {
    const formatted = formatFileList(items);
    if (!formatted) return;
    impactMessages.push(build(formatted));
  });

  const otherList = formatFileList(categories.other, impactMessages.length ? 2 : 3);
  if (otherList) {
    const touchesMainAutomation = categories.other.has('main.js');
    const message = touchesMainAutomation
      ? `Aprimora a geração automática das notas de versão (${otherList}), descrevendo com clareza o que muda para quem aplica a atualização.`
      : impactMessages.length
          ? `Completa a entrega com ajustes pontuais em componentes adicionais (${otherList}), deixando o pacote coerente.`
          : `Inclui melhorias complementares em arquivos variados (${otherList}) para dar suporte às demais mudanças.`;
    impactMessages.push(message);
  }

  return impactMessages.join(' ');
}

async function collectPendingChangesSince(referenceCommit, headCommitOverride) {
  if (!referenceCommit) {
    return [];
  }

  const headCommit = headCommitOverride || (await getHeadCommitHash());
  if (!headCommit || referenceCommit === headCommit) {
    return [];
  }

  const output = await runGitCommand([
    'log',
    '--date=iso-strict',
    '--pretty=format:%H%x1f%an%x1f%ad%x1f%s%x1f%b%x1e',
    '--max-count=50',
    `${referenceCommit}..${headCommit}`
  ]);

  if (!output) return [];

  const entries = [];
  const rawEntries = output
    .split('\x1e')
    .map(entry => entry.trim())
    .filter(Boolean);

  for (const raw of rawEntries) {
    const [hash, author, date, subject, body] = raw.split('\x1f');
    const normalizedBody = (body || '').replace(/\r/g, '').trim();
    const bodyLines = normalizedBody
      ? normalizedBody
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
      : [];
    const highlightLines = bodyLines
      .filter(line => /^[-*•]/.test(line))
      .map(line => line.replace(/^[-*•]+\s*/, '').trim())
      .filter(Boolean);
    const detailLines = bodyLines.filter(line => !/^[-*•]/.test(line));
    const summaryText = detailLines.join('\n').trim();
    const changedFiles = await getChangedFilesForCommit(hash);
    const fileSummary = summarizeChangedFiles(changedFiles);
    let derivedSummary = summaryText;
    if (fileSummary) {
      derivedSummary = derivedSummary ? `${derivedSummary} ${fileSummary}` : fileSummary;
    }
    if (!derivedSummary) {
      derivedSummary = deriveSummaryFromSubject(subject);
    }

    entries.push({
      id: hash,
      title: subject || (hash ? `Alteração ${hash.slice(0, 7)}` : 'Alteração pendente'),
      version: null,
      date: date || null,
      author: author || null,
      highlights: highlightLines,
      items: highlightLines,
      summary: derivedSummary,
      details: normalizedBody,
      files: changedFiles
    });
  }

  return entries;
}

async function refreshPendingChanges(options = {}) {
  const { force = false } = options;

  if (gitUnavailable) {
    publishState.pendingChanges = [];
    return publishState.pendingChanges;
  }

  if (pendingChangesRefreshPromise) {
    if (!force) {
      return pendingChangesRefreshPromise;
    }
    try {
      await pendingChangesRefreshPromise;
    } catch (err) {
      if (DEBUG) {
        console.warn('Falha anterior ao atualizar alterações pendentes:', err);
      }
    }
  }

  const execution = (async () => {
    if (gitUnavailable) {
      publishState.pendingChanges = [];
      return publishState.pendingChanges;
    }

    const referenceCommit = publishState.lastPublishedCommit;
    const headCommit = await getHeadCommitHash({ force });

    if (!headCommit) {
      publishState.pendingChanges = [];
      lastPendingChangesContext = { head: null, reference: null };
      return publishState.pendingChanges;
    }

    if (!referenceCommit) {
      publishState.lastPublishedCommit = headCommit;
      publishState.pendingChanges = [];
      lastPendingChangesContext = { head: headCommit, reference: headCommit };
      return publishState.pendingChanges;
    }

    if (!force && lastPendingChangesContext.head === headCommit && lastPendingChangesContext.reference === referenceCommit) {
      return publishState.pendingChanges;
    }

    const entries = await collectPendingChangesSince(referenceCommit, headCommit);
    publishState.pendingChanges = Array.isArray(entries) ? entries : [];
    lastPendingChangesContext = { head: headCommit, reference: referenceCommit };
    return publishState.pendingChanges;
  })();

  const trackedPromise = execution
    .catch(err => {
      if (DEBUG) {
        console.warn('Falha ao atualizar alterações pendentes:', err);
      }
      return publishState.pendingChanges;
    })
    .finally(() => {
      if (pendingChangesRefreshPromise === trackedPromise) {
        pendingChangesRefreshPromise = null;
      }
    });

  pendingChangesRefreshPromise = trackedPromise;
  return trackedPromise;
}

function ensurePublishStateInitialized() {
  if (!publishStateInitializationPromise) {
    publishStateInitializationPromise = (async () => {
      if (!publishState.lastPublishedCommit) {
        const head = await getHeadCommitHash();
        if (head) {
          publishState.lastPublishedCommit = head;
        }
      }
      await refreshPendingChanges();
      return publishState.pendingChanges;
    })().catch(err => {
      if (DEBUG) {
        console.warn('Falha ao inicializar estado de publicação:', err);
      }
      return publishState.pendingChanges;
    });
  }

  return publishStateInitializationPromise;
}

ensurePublishStateInitialized();

async function buildUpdateStatusPayload({ refresh = false } = {}) {
  if (refresh) {
    await updateService.checkForUpdates({ silent: true });
  }

  await ensurePublishStateInitialized();
  await refreshPendingChanges({ force: refresh });

  const status = updateService.getUpdateStatus();
  const payload = {
    ...status,
    canPublish: publishState.canPublish,
    latestPublishedVersion: publishState.latestPublishedVersion,
    localVersion: publishState.localVersion,
    publishState: { ...publishState }
  };

  updateStatusCache.value = payload;
  updateStatusCache.timestamp = Date.now();

  return payload;
}

function broadcastPublishEvent(channel, payload = {}) {
  const currentState = { ...publishState };
  const finalPayload = { ...payload, ...currentState, publishState: currentState };
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, finalPayload);
    }
  });
}

async function updatePublishState(partial = {}) {
  await ensurePublishStateInitialized();

  const hasOwn = key => Object.prototype.hasOwnProperty.call(partial, key);
  const pipelineActive = publisher.isPublishing();

  if (hasOwn('publishing')) {
    publishState.publishing = Boolean(partial.publishing);
  }

  if (hasOwn('latestPublishedVersion')) {
    publishState.latestPublishedVersion = partial.latestPublishedVersion;
  }

  if (hasOwn('localVersion')) {
    publishState.localVersion = partial.localVersion;
  } else if (!publishState.localVersion) {
    publishState.localVersion = app.getVersion();
  }

  if (hasOwn('lastPublishedCommit')) {
    publishState.lastPublishedCommit = partial.lastPublishedCommit || null;
  } else if (!publishState.lastPublishedCommit) {
    const head = await getHeadCommitHash();
    if (head) {
      publishState.lastPublishedCommit = head;
    }
  }

  let nextCanPublish;
  if (hasOwn('canPublish')) {
    nextCanPublish = Boolean(partial.canPublish);
  } else if (hasOwn('publishing')) {
    nextCanPublish = !publishState.publishing && !pipelineActive;
  }

  if (nextCanPublish !== undefined) {
    publishState.canPublish = nextCanPublish;
  } else {
    publishState.canPublish = !(publishState.publishing || pipelineActive);
  }

  const versionChanged = hasOwn('latestPublishedVersion') || hasOwn('localVersion');
  const commitChanged = hasOwn('lastPublishedCommit');
  await refreshPendingChanges({ force: versionChanged || commitChanged });

  if (versionChanged || commitChanged) {
    persistPublishStateSnapshot();
  }

  if (updateStatusCache.value) {
    updateStatusCache.value = {
      ...updateStatusCache.value,
      canPublish: publishState.canPublish,
      latestPublishedVersion: publishState.latestPublishedVersion,
      localVersion: publishState.localVersion,
      publishState: { ...publishState }
    };
    updateStatusCache.timestamp = Date.now();
  }

  return { ...publishState };
}

function configureAutoUpdaterFeed() {
  const feedUrl = process.env.ELECTRON_UPDATE_URL;
  const channel = process.env.ELECTRON_UPDATE_CHANNEL;

  if (!feedUrl) {
    if (DEBUG) {
      console.warn('AutoUpdater: nenhum feed customizado configurado (ELECTRON_UPDATE_URL ausente).');
    }
    updateService.recordFeedConfiguration(false);
    return;
  }

  const feedOptions = channel ? { url: feedUrl, channel } : { url: feedUrl };
  try {
    autoUpdater.setFeedURL(feedOptions);
    updateService.recordFeedConfiguration(true);
    if (DEBUG) {
      console.log('AutoUpdater: feed configurado', feedOptions);
    }
  } catch (error) {
    console.error('AutoUpdater: falha ao configurar feed customizado', error);
    updateService.recordFeedConfiguration(false, error);
  }
}

function initializeAutoUpdater() {
  if (!app.isPackaged) {
    if (DEBUG) {
      console.warn('AutoUpdater: ignorado em ambiente de desenvolvimento');
    }
    updateService.recordFeedConfiguration(false, new Error('Atualizações indisponíveis durante o desenvolvimento.'));
    return;
  }

  if (process.env.ELECTRON_UPDATE_DISABLE === 'true') {
    console.warn('AutoUpdater: desabilitado pela variável ELECTRON_UPDATE_DISABLE');
    updateService.recordFeedConfiguration(false, new Error('Atualizações desabilitadas.'));
    return;
  }

  configureAutoUpdaterFeed();

  const scheduleInitialCheck = () => {
    updateService
      .checkForUpdates()
      .catch(err => {
        if (DEBUG) {
          console.error('AutoUpdater: falha ao verificar atualizações', err);
        }
      });
  };

  const configuredDelay = Number.parseInt(process.env.ELECTRON_UPDATE_INITIAL_DELAY, 10);
  const defaultDelay = 1500;
  const delay = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : defaultDelay;

  if (delay > 0) {
    setTimeout(scheduleInitialCheck, delay);
  } else if (typeof setImmediate === 'function') {
    setImmediate(scheduleInitialCheck);
  } else {
    scheduleInitialCheck();
  }
}

function logDisplayInfo(context, selected) {
  if (!DEBUG) return;
  try {
    const displays = screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds }));
    console.log(`[${context}] available displays:`, JSON.stringify(displays));
    if (selected) {
      console.log(`[${context}] using display`, selected.id, 'bounds:', selected.bounds);
    }
  } catch (err) {
    console.error(`[${context}] logDisplayInfo error`, err);
  }
}

const offsetX = 0;
const offsetY = 0;

function getBoundsForDisplay(display, offX = offsetX, offY = offsetY) {
  const { bounds } = display;
  return {
    x: Math.round(bounds.x + offX),
    y: Math.round(bounds.y + offY),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}

function loadSavedDisplay() {
  try {
    if (fs.existsSync(displayFile)) {
      const { id } = JSON.parse(fs.readFileSync(displayFile, 'utf-8'));
      const display = screen.getAllDisplays().find(d => d.id === id);
      logDisplayInfo('load-saved-display', display);
      if (display) {
        currentDisplayId = id;
        return display;
      }
      fs.unlinkSync(displayFile);
    }
  } catch (err) {
    console.error('loadSavedDisplay error', err);
  }
  const primary = screen.getPrimaryDisplay();
  logDisplayInfo('load-saved-display-primary', primary);
  currentDisplayId = primary.id;
  return primary;
}

function saveDisplayId(id) {
  try {
    currentDisplayId = id;
    fs.writeFileSync(displayFile, JSON.stringify({ id }));
  } catch (err) {
    console.error('saveDisplayId error', err);
  }
}

function handleDisplaysChanged() {
  const display = screen.getAllDisplays().find(d => d.id === currentDisplayId);
  const target = display || screen.getPrimaryDisplay();
  logDisplayInfo('display-changed', target);
  if (!display) {
    saveDisplayId(target.id);
  }
  const bounds = getBoundsForDisplay(target);
  if (loginWindow) {
    loginWindow.setBounds(bounds);
    loginWindow.setFullScreen(true);
  }
  if (dashboardWindow) {
    dashboardWindow.setBounds(bounds);
    dashboardWindow.setFullScreen(true);
  }
}

const IPC_ACTION_MAP = {
  'adicionar-materia-prima': { module: 'Matéria-Prima', label: 'Adicionou matéria-prima' },
  'atualizar-materia-prima': { module: 'Matéria-Prima', label: 'Atualizou matéria-prima' },
  'excluir-materia-prima': { module: 'Matéria-Prima', label: 'Removeu matéria-prima' },
  'registrar-entrada-materia-prima': { module: 'Matéria-Prima', label: 'Registrou entrada em matéria-prima' },
  'registrar-saida-materia-prima': { module: 'Matéria-Prima', label: 'Registrou saída em matéria-prima' },
  'atualizar-preco-materia-prima': { module: 'Matéria-Prima', label: 'Atualizou preço de matéria-prima' },
  'adicionar-categoria': { module: 'Matéria-Prima', label: 'Adicionou categoria' },
  'adicionar-unidade': { module: 'Matéria-Prima', label: 'Adicionou unidade' },
  'adicionar-colecao': { module: 'Produtos', label: 'Adicionou coleção' },
  'remover-categoria': { module: 'Matéria-Prima', label: 'Removeu categoria' },
  'remover-unidade': { module: 'Matéria-Prima', label: 'Removeu unidade' },
  'remover-colecao': { module: 'Produtos', label: 'Removeu coleção' },
  'adicionar-produto': { module: 'Produtos', label: 'Adicionou produto' },
  'atualizar-produto': { module: 'Produtos', label: 'Atualizou produto' },
  'excluir-produto': { module: 'Produtos', label: 'Removeu produto' },
  'inserir-lote-produto': { module: 'Produtos', label: 'Inseriu lote de produto' },
  'atualizar-lote-produto': { module: 'Produtos', label: 'Atualizou lote de produto' },
  'excluir-lote-produto': { module: 'Produtos', label: 'Removeu lote de produto' },
  'salvar-produto-detalhado': { module: 'Produtos', label: 'Salvou produto detalhado' },
  'adicionar-etapa-producao': { module: 'Produtos', label: 'Adicionou etapa de produção' },
  'remover-etapa-producao': { module: 'Produtos', label: 'Removeu etapa de produção' },
  'registrar-usuario': { module: 'Usuários', label: 'Registrou novo usuário' }
};

const API_MODULE_TITLES = {
  clientes: 'Clientes',
  orcamentos: 'Orçamentos',
  pedidos: 'Pedidos',
  transportadoras: 'Transportadoras',
  usuarios: 'Usuários',
  materia_prima: 'Matéria-Prima',
  materia: 'Matéria-Prima',
  produtos: 'Produtos',
  financeiro: 'Financeiro',
  contatos: 'Contatos'
};

function setCurrentUserSession(user) {
  const previousUserId = currentUserSession?.id ?? null;
  if (user && user.id) {
    currentUserSession = {
      id: user.id,
      nome: user.nome,
      perfil: user.perfil
    };
    isSupAdmin = user.perfil === 'Sup Admin';
  } else {
    currentUserSession = null;
    isSupAdmin = false;
  }
  lastRecordedAction = null;
  quittingApp = false;
  const nextUserId = currentUserSession?.id ?? null;
  if (previousUserId !== nextUserId) {
    updateService.resetCachedState(nextUserId ? 'user-switched' : 'session-ended');
  }
}

function summarizeValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function summarizePayload(payload) {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload.slice(0, 180);
  if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload);
  if (Array.isArray(payload)) {
    return payload
      .slice(0, 3)
      .map(item => summarizePayload(item))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof payload === 'object') {
    const keys = ['nome', 'name', 'codigo', 'id', 'email', 'cliente', 'cliente_id', 'produto', 'status', 'descricao', 'titulo'];
    const parts = [];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        const value = summarizePayload(payload[key]);
        if (value) parts.push(`${key}: ${value}`);
      }
    }
    if (!parts.length && typeof payload.dados === 'object') {
      const nested = summarizePayload(payload.dados);
      if (nested) parts.push(nested);
    }
    if (!parts.length && typeof payload.produto === 'object') {
      const nested = summarizePayload(payload.produto);
      if (nested) parts.push(nested);
    }
    if (!parts.length && Array.isArray(payload.itens)) {
      const nested = summarizePayload(payload.itens);
      if (nested) parts.push(`itens: ${nested}`);
    }
    if (!parts.length && payload.nome_categoria) {
      const value = summarizeValue(payload.nome_categoria);
      if (value) parts.push(`nome_categoria: ${value}`);
    }
    if (!parts.length) {
      try {
        return JSON.stringify(payload).slice(0, 200);
      } catch (err) {
        return '';
      }
    }
    return parts.join(', ');
  }
  return '';
}

function formatNumber(value, options = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const { decimals } = options;
  if (typeof decimals === 'number') {
    return num.toLocaleString('pt-BR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
  if (Number.isInteger(num)) {
    return num.toLocaleString('pt-BR');
  }
  return num.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatBoolean(value) {
  return value ? 'Sim' : 'Não';
}

function formatText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return formatBoolean(value);
  return String(value);
}

function formatQuantity(value, unit, options = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const abs = Math.abs(num);
  const baseOptions = {};
  if (typeof options.decimals === 'number') {
    baseOptions.decimals = options.decimals;
  }
  const formattedBase = options.signed
    ? formatNumber(abs, baseOptions)
    : formatNumber(num, baseOptions);
  const sign = options.signed ? (num > 0 ? '+' : num < 0 ? '−' : '') : '';
  const valueStr = sign ? `${sign}${formattedBase}` : formattedBase;
  return unit ? `${valueStr} ${unit}` : valueStr;
}

function describeQuantityChange(before, after, unit) {
  const prev = Number(before);
  const next = Number(after);
  const hasPrev = Number.isFinite(prev);
  const hasNext = Number.isFinite(next);
  if (!hasPrev && !hasNext) return null;
  if (hasPrev && hasNext) {
    const delta = next - prev;
    const deltaText = formatQuantity(delta, unit, { signed: true });
    return `quantidade: ${formatQuantity(prev, unit)} → ${formatQuantity(next, unit)}${deltaText ? ` (${deltaText})` : ''}`;
  }
  if (hasNext) {
    return `quantidade definida para ${formatQuantity(next, unit)}`;
  }
  return `quantidade removida (anterior ${formatQuantity(prev, unit)})`;
}

function describePriceChange(before, after) {
  const prev = Number(before);
  const next = Number(after);
  const hasPrev = Number.isFinite(prev);
  const hasNext = Number.isFinite(next);
  if (!hasPrev && !hasNext) return null;
  if (hasPrev && hasNext) {
    if (Math.abs(prev - next) < 0.0001) return null;
    const delta = next - prev;
    const deltaText = formatCurrency(Math.abs(delta));
    const prefix = delta > 0 ? '+' : delta < 0 ? '−' : '';
    return `preço: ${formatCurrency(prev)} → ${formatCurrency(next)}${deltaText ? ` (${prefix}${deltaText})` : ''}`;
  }
  if (hasNext) {
    return `preço ajustado para ${formatCurrency(next)}`;
  }
  return `preço removido (anterior ${formatCurrency(prev)})`;
}

function describeTextChange(label, before, after) {
  const prev = formatText(before);
  const next = formatText(after);
  if (!prev && !next) return null;
  if (prev === next) return null;
  if (prev && next) return `${label}: ${prev} → ${next}`;
  if (next) return `${label}: ${next}`;
  return `${label}: removido (${prev})`;
}

function describeIpcActionDetails(channel, payload, result) {
  const payloadObj = typeof payload === 'object' && payload !== null ? payload : null;
  switch (channel) {
    case 'adicionar-materia-prima': {
      const data = (result && result.materia) || result || payloadObj || {};
      const nome = data.nome || payloadObj?.nome;
      const categoria = data.categoria || payloadObj?.categoria;
      const unidade = data.unidade || payloadObj?.unidade;
      const processo = data.processo || payloadObj?.processo;
      const infinito = data.infinito ?? payloadObj?.infinito;
      const quantidade = data.quantidade ?? payloadObj?.quantidade;
      const preco = data.preco_unitario ?? payloadObj?.preco_unitario;
      const detalhes = [];
      if (categoria) detalhes.push(`categoria ${categoria}`);
      if (unidade) detalhes.push(`unidade ${unidade}`);
      if (processo) detalhes.push(`processo ${processo}`);
      if (infinito) {
        detalhes.push('estoque infinito');
      } else if (quantidade !== undefined && quantidade !== null) {
        const qtdText = formatQuantity(quantidade, unidade);
        if (qtdText) detalhes.push(`estoque ${qtdText}`);
      }
      if (preco !== undefined && preco !== null) {
        const precoText = formatCurrency(preco);
        if (precoText) detalhes.push(`preço unitário ${precoText}`);
      }
      const base = nome ? `Adicionou insumo "${nome}"` : 'Adicionou matéria-prima';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'atualizar-materia-prima': {
      const dados = payloadObj?.dados || {};
      const before = dados.__meta?.antes || payloadObj?.__meta?.antes || null;
      const after = (result && result.materia) || result || dados;
      const nome = after?.nome ?? dados.nome ?? before?.nome;
      const unidade = after?.unidade ?? dados.unidade ?? before?.unidade;
      const changes = [];
      const quantidadeChange = describeQuantityChange(before?.quantidade, after?.quantidade ?? dados.quantidade, unidade);
      if (quantidadeChange) changes.push(quantidadeChange);
      const precoChange = describePriceChange(before?.preco_unitario, after?.preco_unitario ?? dados.preco_unitario);
      if (precoChange) changes.push(precoChange);
      const categoriaChange = describeTextChange('categoria', before?.categoria, after?.categoria ?? dados.categoria);
      if (categoriaChange) changes.push(categoriaChange);
      const unidadeChange = describeTextChange('unidade', before?.unidade, after?.unidade ?? dados.unidade);
      if (unidadeChange) changes.push(unidadeChange);
      const processoChange = describeTextChange('processo', before?.processo, after?.processo ?? dados.processo);
      if (processoChange) changes.push(processoChange);
      const infinitoBefore = before?.infinito;
      const infinitoAfter = after?.infinito ?? dados.infinito;
      if (infinitoBefore !== undefined || infinitoAfter !== undefined) {
        if (infinitoBefore !== infinitoAfter) {
          const labelAtual = formatBoolean(!!infinitoAfter);
          const labelAnterior = infinitoBefore === undefined ? null : formatBoolean(!!infinitoBefore);
          changes.push(labelAnterior ? `estoque infinito: ${labelAnterior} → ${labelAtual}` : `estoque infinito: ${labelAtual}`);
        }
      }
      const descricaoChange = describeTextChange('descrição', before?.descricao, after?.descricao ?? dados.descricao);
      if (descricaoChange) changes.push(descricaoChange);
      if (!changes.length) return null;
      const base = nome ? `Atualizou insumo "${nome}"` : 'Atualizou matéria-prima';
      return `${base} (${changes.join(' | ')})`;
    }
    case 'excluir-materia-prima': {
      const meta = payloadObj?.__meta || {};
      const nome = meta.nome;
      const categoria = meta.categoria;
      const unidade = meta.unidade;
      const processo = meta.processo;
      const quantidade = meta.quantidade;
      const detalhes = [];
      if (categoria) detalhes.push(`categoria ${categoria}`);
      if (unidade) detalhes.push(`unidade ${unidade}`);
      if (processo) detalhes.push(`processo ${processo}`);
      if (quantidade !== undefined && quantidade !== null) {
        const qtdText = formatQuantity(quantidade, unidade);
        if (qtdText) detalhes.push(`estoque removido ${qtdText}`);
      }
      const base = nome ? `Removeu insumo "${nome}"` : payloadObj?.id ? `Removeu matéria-prima #${payloadObj.id}` : 'Removeu matéria-prima';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'registrar-entrada-materia-prima': {
      const quantidade = Number(payloadObj?.quantidade);
      const data = result || {};
      const nome = data.nome;
      const unidade = data.unidade;
      const saldoAtual = Number(data.quantidade);
      const saldoAnterior = Number.isFinite(quantidade) && Number.isFinite(saldoAtual)
        ? saldoAtual - quantidade
        : undefined;
      const detalhes = [];
      if (Number.isFinite(quantidade)) {
        const qtdText = formatQuantity(quantidade, unidade);
        if (qtdText) detalhes.push(`entrada de ${qtdText}`);
      }
      if (Number.isFinite(saldoAtual)) {
        if (Number.isFinite(saldoAnterior)) {
          detalhes.push(`saldo ${formatQuantity(saldoAnterior, unidade)} → ${formatQuantity(saldoAtual, unidade)}`);
        } else {
          detalhes.push(`saldo atual ${formatQuantity(saldoAtual, unidade)}`);
        }
      }
      const base = nome ? `Registrou entrada do insumo "${nome}"` : 'Registrou entrada em matéria-prima';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'registrar-saida-materia-prima': {
      const quantidade = Number(payloadObj?.quantidade);
      const data = result || {};
      const nome = data.nome;
      const unidade = data.unidade;
      const saldoAtual = Number(data.quantidade);
      const saldoAnterior = Number.isFinite(quantidade) && Number.isFinite(saldoAtual)
        ? saldoAtual + quantidade
        : undefined;
      const detalhes = [];
      if (Number.isFinite(quantidade)) {
        const qtdText = formatQuantity(quantidade, unidade);
        if (qtdText) detalhes.push(`retirou ${qtdText}`);
      }
      if (Number.isFinite(saldoAtual)) {
        if (Number.isFinite(saldoAnterior)) {
          detalhes.push(`saldo ${formatQuantity(saldoAnterior, unidade)} → ${formatQuantity(saldoAtual, unidade)}`);
        } else {
          detalhes.push(`saldo atual ${formatQuantity(saldoAtual, unidade)}`);
        }
      }
      const base = nome ? `Registrou saída do insumo "${nome}"` : 'Registrou saída em matéria-prima';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'atualizar-preco-materia-prima': {
      const data = result || {};
      const nome = data.nome;
      const preco = data.preco_unitario ?? payloadObj?.preco;
      const precoText = formatCurrency(preco);
      const detalhes = precoText ? [`preço unitário ${precoText}`] : [];
      const base = nome ? `Atualizou preço do insumo "${nome}"` : 'Atualizou preço de matéria-prima';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'adicionar-categoria': {
      const nome = result || payload;
      const text = formatText(nome);
      return text ? `Adicionou categoria "${text}"` : null;
    }
    case 'adicionar-unidade': {
      const nome = result || payload;
      const text = formatText(nome);
      return text ? `Adicionou unidade "${text}"` : null;
    }
    case 'adicionar-colecao': {
      const nome = result || payload;
      const text = formatText(nome);
      return text ? `Adicionou coleção "${text}"` : null;
    }
    case 'remover-categoria': {
      const nome = typeof payload === 'string' ? payload : payloadObj;
      const text = formatText(nome);
      return text ? `Removeu categoria "${text}"` : null;
    }
    case 'remover-unidade': {
      const nome = typeof payload === 'string' ? payload : payloadObj;
      const text = formatText(nome);
      return text ? `Removeu unidade "${text}"` : null;
    }
    case 'remover-colecao': {
      const nome = typeof payload === 'string' ? payload : payloadObj;
      const text = formatText(nome);
      return text ? `Removeu coleção "${text}"` : null;
    }
    case 'adicionar-produto': {
      const data = result || {};
      const nome = data.nome || payloadObj?.nome;
      const codigo = data.codigo || payloadObj?.codigo;
      const categoria = data.categoria || payloadObj?.categoria;
      const preco = data.preco_venda ?? payloadObj?.preco_venda;
      const markup = data.pct_markup ?? payloadObj?.pct_markup;
      const status = data.status ?? payloadObj?.status;
      const detalhes = [];
      if (codigo) detalhes.push(`código ${codigo}`);
      if (categoria) detalhes.push(`coleção ${categoria}`);
      if (preco !== undefined && preco !== null) {
        const precoText = formatCurrency(preco);
        if (precoText) detalhes.push(`preço de venda ${precoText}`);
      }
      if (markup !== undefined && markup !== null) {
        const markupText = formatNumber(markup, { decimals: 2 });
        if (markupText) detalhes.push(`markup ${markupText}%`);
      }
      if (status) detalhes.push(`status ${status}`);
      const base = nome ? `Adicionou produto "${nome}"` : 'Adicionou produto';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'atualizar-produto': {
      const dados = payloadObj?.dados || {};
      const before = dados.__meta?.antes || payloadObj?.__meta?.antes || null;
      const after = result || {};
      const nome = after.nome ?? dados.nome ?? before?.nome;
      const codigo = after.codigo ?? dados.codigo ?? before?.codigo;
      const categoria = after.categoria ?? dados.categoria ?? before?.categoria;
      const preco = after.preco_venda ?? dados.preco_venda;
      const markup = after.pct_markup ?? dados.pct_markup;
      const status = after.status ?? dados.status;
      const changes = [];
      if (before) {
        const nomeChange = describeTextChange('nome', before.nome, after.nome ?? dados.nome);
        if (nomeChange) changes.push(nomeChange);
        const codigoChange = describeTextChange('código', before.codigo, after.codigo ?? dados.codigo);
        if (codigoChange) changes.push(codigoChange);
        const categoriaChange = describeTextChange('coleção', before.categoria, after.categoria ?? dados.categoria);
        if (categoriaChange) changes.push(categoriaChange);
        const precoChange = describePriceChange(before.preco_venda, after.preco_venda ?? dados.preco_venda);
        if (precoChange) changes.push(precoChange);
        const markupChange = describeTextChange('markup', before.pct_markup != null ? `${formatNumber(before.pct_markup, { decimals: 2 })}%` : null, markup != null ? `${formatNumber(markup, { decimals: 2 })}%` : null);
        if (markupChange) changes.push(markupChange);
        const statusChange = describeTextChange('status', before.status, after.status ?? dados.status);
        if (statusChange) changes.push(statusChange);
      } else {
        if (codigo) changes.push(`código ${codigo}`);
        if (categoria) changes.push(`coleção ${categoria}`);
        if (preco !== undefined && preco !== null) {
          const precoText = formatCurrency(preco);
          if (precoText) changes.push(`preço de venda ${precoText}`);
        }
        if (markup !== undefined && markup !== null) {
          const markupText = formatNumber(markup, { decimals: 2 });
          if (markupText) changes.push(`markup ${markupText}%`);
        }
        if (status) changes.push(`status ${status}`);
      }
      if (!changes.length) return null;
      const base = nome ? `Atualizou produto "${nome}"` : 'Atualizou produto';
      return `${base} (${changes.join(' | ')})`;
    }
    case 'excluir-produto': {
      const meta = payloadObj?.__meta || {};
      const nome = meta.nome;
      const codigo = meta.codigo;
      const categoria = meta.categoria;
      const detalhes = [];
      if (codigo) detalhes.push(`código ${codigo}`);
      if (categoria) detalhes.push(`coleção ${categoria}`);
      if (meta.preco_venda !== undefined && meta.preco_venda !== null) {
        const precoText = formatCurrency(meta.preco_venda);
        if (precoText) detalhes.push(`preço de venda ${precoText}`);
      }
      if (meta.status) detalhes.push(`status ${meta.status}`);
      const base = nome ? `Removeu produto "${nome}"` : payloadObj?.id ? `Removeu produto #${payloadObj.id}` : 'Removeu produto';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'inserir-lote-produto': {
      const meta = payloadObj?.__meta || {};
      const produto = meta.produto || {};
      const etapa = meta.etapa || payloadObj?.etapa;
      const itemNome = meta.itemNome;
      const quantidade = (result && result.quantidade) ?? payloadObj?.quantidade;
      const detalhes = [];
      if (produto.codigo) detalhes.push(`código ${produto.codigo}`);
      if (etapa) detalhes.push(`etapa ${etapa}`);
      if (itemNome) detalhes.push(`item ${itemNome}`);
      if (quantidade !== undefined && quantidade !== null) {
        const qtdText = formatQuantity(quantidade, meta.unidade);
        if (qtdText) detalhes.push(`quantidade ${qtdText}`);
      }
      const base = produto.nome ? `Inseriu lote para o produto "${produto.nome}"` : 'Inseriu lote de produto';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'atualizar-lote-produto': {
      const meta = payloadObj?.__meta || {};
      const produto = meta.produto || {};
      const etapa = meta.etapa || payloadObj?.etapa;
      const itemNome = meta.itemNome;
      const unidade = meta.unidade;
      const quantidadeAnterior = meta.quantidadeAnterior;
      const quantidadeNova = meta.quantidadeNova ?? payloadObj?.quantidade ?? result?.quantidade;
      const change = describeQuantityChange(quantidadeAnterior, quantidadeNova, unidade);
      const detalhes = [];
      if (produto.codigo) detalhes.push(`código ${produto.codigo}`);
      if (etapa) detalhes.push(`etapa ${etapa}`);
      if (itemNome) detalhes.push(`item ${itemNome}`);
      if (change) detalhes.push(change);
      const base = produto.nome ? `Atualizou lote do produto "${produto.nome}"` : 'Atualizou lote de produto';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'excluir-lote-produto': {
      const meta = payloadObj?.__meta || {};
      const produto = meta.produto || {};
      const etapa = meta.etapa;
      const itemNome = meta.itemNome;
      const quantidade = meta.quantidade;
      const detalhes = [];
      if (produto.codigo) detalhes.push(`código ${produto.codigo}`);
      if (etapa) detalhes.push(`etapa ${etapa}`);
      if (itemNome) detalhes.push(`item ${itemNome}`);
      if (quantidade !== undefined && quantidade !== null) {
        const qtdText = formatQuantity(quantidade, meta.unidade);
        if (qtdText) detalhes.push(`estoque removido ${qtdText}`);
      }
      const base = produto.nome ? `Removeu lote do produto "${produto.nome}"` : 'Removeu lote de produto';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'salvar-produto-detalhado': {
      const produto = payloadObj?.produto || {};
      const codigo = payloadObj?.codigo || produto.codigo;
      const nome = produto.nome;
      const precoBase = produto.preco_base;
      const precoVenda = produto.preco_venda;
      const itens = payloadObj?.itens || {};
      const detalhes = [];
      if (codigo) detalhes.push(`código ${codigo}`);
      if (precoBase !== undefined && precoBase !== null) {
        const precoText = formatCurrency(precoBase);
        if (precoText) detalhes.push(`preço base ${precoText}`);
      }
      if (precoVenda !== undefined && precoVenda !== null) {
        const precoText = formatCurrency(precoVenda);
        if (precoText) detalhes.push(`preço de venda ${precoText}`);
      }
      const inseridos = Array.isArray(itens.inseridos) ? itens.inseridos.length : 0;
      const atualizados = Array.isArray(itens.atualizados) ? itens.atualizados.length : 0;
      const deletados = Array.isArray(itens.deletados) ? itens.deletados.length : 0;
      const resumoItens = [];
      if (inseridos) resumoItens.push(`${inseridos} adicionado(s)`);
      if (atualizados) resumoItens.push(`${atualizados} atualizado(s)`);
      if (deletados) resumoItens.push(`${deletados} removido(s)`);
      if (resumoItens.length) detalhes.push(`insumos ${resumoItens.join(', ')}`);
      const base = nome ? `Salvou detalhes do produto "${nome}"` : 'Salvou detalhes do produto';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'adicionar-etapa-producao': {
      const nome = payloadObj?.nome || result?.nome;
      const ordem = payloadObj?.ordem ?? result?.ordem;
      const detalhes = [];
      if (ordem !== undefined && ordem !== null) detalhes.push(`ordem ${ordem}`);
      const base = nome ? `Adicionou etapa de produção "${nome}"` : 'Adicionou etapa de produção';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    case 'remover-etapa-producao': {
      const nome = typeof payload === 'string' ? payload : payloadObj;
      const text = formatText(nome);
      return text ? `Removeu etapa de produção "${text}"` : null;
    }
    case 'registrar-usuario': {
      const data = payloadObj || {};
      const nome = data.name || data.nome;
      const email = data.email;
      const detalhes = [];
      if (email) detalhes.push(`email ${email}`);
      const base = nome ? `Registrou usuário "${nome}"` : 'Registrou novo usuário';
      return detalhes.length ? `${base} (${detalhes.join(' | ')})` : base;
    }
    default:
      return null;
  }
}

function capitalizeModuleName(key = '') {
  return key
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeIpcAction(action) {
  if (!action || !action.channel) return null;
  const meta = IPC_ACTION_MAP[action.channel];
  if (!meta) return null;
  if (action.result && (action.result.success === false || action.result.error)) return null;
  const detailed = describeIpcActionDetails(action.channel, action.payload, action.result);
  if (detailed) {
    return { module: meta.module, description: detailed };
  }
  const details = summarizePayload(action.payload) || summarizePayload(action.result);
  const description = details ? `${meta.label} (${details})` : meta.label;
  return { module: meta.module, description };
}

function normalizeFetchAction(action) {
  if (!action || !action.url) return null;
  if (action.ok === false) return null;
  const method = (action.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;
  try {
    const parsed = new URL(action.url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const apiIndex = segments.indexOf('api');
    if (apiIndex === -1 || apiIndex >= segments.length - 1) return null;
    const rawModule = segments[apiIndex + 1] || '';
    const normalizedKey = rawModule.replace(/-/g, '_');
    const module =
      API_MODULE_TITLES[normalizedKey] ||
      API_MODULE_TITLES[rawModule] ||
      capitalizeModuleName(rawModule);
    const pathInfo = segments.slice(apiIndex + 1).join('/');
    const summary = action.bodySummary ? ` :: ${action.bodySummary}` : '';
    return {
      module,
      description: `${method} ${pathInfo}${summary}`
    };
  } catch (err) {
    return null;
  }
}

function normalizeUserAction(action) {
  if (!action) return null;
  let data = null;
  if (action.source === 'ipc') {
    data = normalizeIpcAction(action);
  } else if (action.source === 'fetch') {
    data = normalizeFetchAction(action);
  } else if (action.module || action.description) {
    data = { module: action.module, description: action.description };
  }
  if (!data) return null;
  const timestamp = new Date(action.timestamp || Date.now());
  if (Number.isNaN(timestamp.getTime())) return null;
  return {
    timestamp,
    module: data.module || 'Sistema',
    description: data.description || 'Ação registrada',
    details: action
  };
}

async function persistUserExit(reason) {
  if (!currentUserSession || isPersistingExit) return;
  isPersistingExit = true;
  const payload = { saida: new Date() };
  if (lastRecordedAction) {
    payload.ultimaAcao = {
      timestamp: lastRecordedAction.timestamp,
      modulo: lastRecordedAction.module,
      descricao: lastRecordedAction.description
    };
  }
  try {
    await registrarUltimaSaida(currentUserSession.id, payload);
  } catch (err) {
    console.error('Falha ao registrar saída do usuário:', err);
  }
  currentUserSession = null;
  lastRecordedAction = null;
  isPersistingExit = false;
}

function checkPortAvailability(port) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.unref();

    const handleError = (err) => {
      tester.removeListener('listening', handleListening);
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(false);
      } else {
        reject(err);
      }
    };

    const handleListening = () => {
      tester.removeListener('error', handleError);
      tester.close(() => resolve(true));
    };

    tester.once('error', handleError);
    tester.once('listening', handleListening);
    tester.listen({ port, host: '0.0.0.0' });
  });
}

async function findAvailablePort(startPort) {
  const initialPort = Number.isInteger(startPort) && startPort > 0 ? startPort : DEFAULT_API_PORT;

  for (let port = initialPort; port <= MAX_PORT; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await checkPortAvailability(port);
    if (available) {
      return port;
    }
  }

  throw new Error(`Não há portas disponíveis a partir da porta ${initialPort}.`);
}

async function startApiServerOnPort(port) {
  await closeApiServer();

  return new Promise((resolve, reject) => {
    const server = apiServer.listen(port);

    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };

    const onListening = () => {
      cleanup();
      apiServerInstance = server;
      currentApiPort = port;
      apiServerInstance.on('error', handleApiServerError);
      startHealthMonitoring();
      if (DEBUG) {
        console.log(`API server running on port ${currentApiPort}`);
      }
      resolve(apiServerInstance);
    };

    const onError = (err) => {
      cleanup();
      if (apiServerInstance === server) {
        apiServerInstance = null;
      }
      reject(err);
    };

    server.once('error', onError);
    server.once('listening', onListening);
  });
}

async function handleApiServerError(err) {
  if (err && err.code === 'EADDRINUSE') {
    const previousPort = currentApiPort;
    try {
      await closeApiServer();
      const fallbackStart = previousPort ? previousPort + 1 : configuredApiPort;
      const newPort = await findAvailablePort(fallbackStart);
      await startApiServerOnPort(newPort);
      console.warn(
        `Port ${previousPort ?? configuredApiPort} in use. API server restarted on port ${newPort}.`
      );
      return;
    } catch (fallbackErr) {
      console.error('Falha ao tentar iniciar o servidor da API em porta alternativa.', fallbackErr);
      dialog.showErrorBox(
        'Erro ao iniciar servidor',
        `Não foi possível iniciar o servidor interno nas portas a partir de ${previousPort ?? configuredApiPort}.` +
          '\nVerifique se outra aplicação está utilizando essas portas.'
      );
      return;
    }
  }

  console.error(
    `Erro ao iniciar o servidor da API na porta ${currentApiPort ?? configuredApiPort}`,
    err
  );
  dialog.showErrorBox(
    'Erro ao iniciar servidor',
    `Não foi possível iniciar o servidor interno na porta ${currentApiPort ?? configuredApiPort}.` +
      '\nVerifique se outra aplicação está utilizando essa porta.'
  );
}

function closeApiServer() {
  stopHealthMonitoring();
  if (!apiServerInstance) {
    return Promise.resolve();
  }

  const server = apiServerInstance;
  apiServerInstance = null;
  server.removeListener('error', handleApiServerError);

  return new Promise((resolve) => {
    server.close((err) => {
      if (err) {
        console.error('Failed to close API server', err);
      }
      resolve();
    });
  });
}

async function flushAndQuit(reason) {
  if (!quittingApp) {
    quittingApp = true;
    await persistUserExit(reason);
  }
  await closeApiServer();
  app.quit();
}

function createLoginWindow(show = true, showOnLoad = true) {
  // Se já existir, não cria de novo
  if (loginWindow) return;

  const savedDisplay = loadSavedDisplay();
  logDisplayInfo('create-login', savedDisplay);
  const { x, y, width, height } = getBoundsForDisplay(savedDisplay);

  loginWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    fullscreen: true,
    frame: false,
    fullscreenable: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    useContentSize: true,
    center: false,
    autoHideMenuBar: false,

    // ********** NOVO **********
    transparent: true,             // janela sem fundo branco
    backgroundColor: '#00000000',  // totalmente transparente
    show: false,                   // NUNCA mostra automaticamente
    // **************************

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    nodeIntegration: false
  }
  });

  // Espera o conteúdo estar pronto para posicionar e exibir
  loginWindow.once('ready-to-show', () => {
    loginWindow.setBounds(getBoundsForDisplay(savedDisplay));
    loginWindow.setFullScreen(true);
    if (show && showOnLoad) {
      loginWindow.show();
      loginWindow.focus();
      loginWindow.webContents.send('activate-tab', 'login');
    } else if (show) {
      loginWindow.show();
      loginWindow.focus();
      loginWindow.webContents.send('activate-tab', 'login');
    }
  });

  // Garante full-screen contínuo
  loginWindow.on('leave-full-screen', () => {
    loginWindow.setFullScreen(true);
  });

  // Carrega o HTML, passando hidden=0/1 via query (como você já fazia)
  loginWindow.loadFile(
    path.join(__dirname, 'src/login/login.html'),
    { query: { hidden: showOnLoad ? '0' : '1'
     } }
  );

  loginWindow.webContents.on('did-finish-load', () => {
    sendLastNetworkStatusToWindow(loginWindow);
  });

  loginWindow.on('closed', () => {
    loginWindow = null;
  });
}


function revealLoginWindow() {
  return new Promise((resolve) => {
    if (!loginWindow || loginWindow.isDestroyed()) {
      resolve();
      return;
    }

    const finish = () => {
      if (!loginWindow || loginWindow.isDestroyed()) {
        resolve();
        return;
      }

      try {
        loginWindow.show();
        loginWindow.focus();
        loginWindow.webContents.send('activate-tab', 'login');
      } catch (err) {
        console.error('Failed to show login window', err);
      }
      resolve();
    };

    if (loginWindow.webContents.isLoading()) {
      loginWindow.once('ready-to-show', finish);
    } else {
      finish();
    }
  });
}


function createDashboardWindow(show = true) {
  const savedDisplay = loadSavedDisplay();
  logDisplayInfo('create-dashboard', savedDisplay);
  const { x, y, width, height } = getBoundsForDisplay(savedDisplay);

  dashboardWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    fullscreen: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    useContentSize: true,
    fullscreenable: false,
    frame: false,
    center: false,
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    nodeIntegration: false
  }
  });

  dashboardWindow.once('ready-to-show', () => {
    dashboardWindow.webContents.send('select-tab', 'dashboard');
    dashboardWindow.setBounds(getBoundsForDisplay(savedDisplay));
    dashboardWindow.setFullScreen(true);
    if (show) {
      dashboardWindow.show();
      dashboardWindow.focus();
    }
  });

  dashboardWindow.on('leave-full-screen', () => {
    dashboardWindow.setFullScreen(true);
  });

  dashboardWindow.webContents.on('did-finish-load', () => {
    dashboardWindow.webContents.send('select-tab', 'dashboard');
    sendLastNetworkStatusToWindow(dashboardWindow);
  });

  dashboardWindow.on('close', (event) => {
    if (!currentUserSession || closingDashboardWindow) return;
    event.preventDefault();
    closingDashboardWindow = true;
    persistUserExit('dashboard-close')
      .catch(err => {
        console.error('Falha ao registrar saída ao fechar dashboard:', err);
      })
      .finally(() => {
        closingDashboardWindow = false;
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
          dashboardWindow.close();
        }
      });
  });

  // Carrega a nova tela de menu
  dashboardWindow.loadFile(path.join(__dirname, 'src/html/menu.html'));
  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });
}

app.whenReady().then(async () => {
  const userDataPath = path.join(app.getPath('appData'), 'santissimo-decor');
  app.setPath('userData', userDataPath);
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
  } catch (err) {
    console.error('Failed to create userData directory', err);
  }
  stateFile = path.join(app.getPath('userData'), 'session-state.json');
  displayFile = path.join(app.getPath('userData'), 'display.json');

  const envPortValue = process.env.API_PORT;
  if (!envPortValue) {
    console.warn(`API_PORT not set, defaulting to ${DEFAULT_API_PORT}`);
  }

  const parsedPort = Number(envPortValue);
  if (envPortValue && (!Number.isInteger(parsedPort) || parsedPort <= 0)) {
    console.warn(
      `API_PORT value "${envPortValue}" is invalid. Defaulting to ${DEFAULT_API_PORT}.`
    );
    configuredApiPort = DEFAULT_API_PORT;
  } else if (envPortValue) {
    configuredApiPort = parsedPort;
  } else {
    configuredApiPort = DEFAULT_API_PORT;
  }

  let availablePort = null;
  try {
    availablePort = await findAvailablePort(configuredApiPort);
  } catch (err) {
    console.error('Não foi possível localizar uma porta livre para o servidor da API.', err);
    dialog.showErrorBox(
      'Erro ao iniciar servidor',
      `Não foi possível localizar uma porta livre a partir da porta ${configuredApiPort}.` +
        '\nVerifique se outra aplicação está utilizando essas portas.'
    );
  }

  if (availablePort !== null) {
    try {
      await startApiServerOnPort(availablePort);
    } catch (err) {
      await handleApiServerError(err);
    }
  }

  // Cria a janela de login sem exibí-la imediatamente.
  // Ela será mostrada somente após o carregamento completo do conteúdo
  // pelo renderer (via IPC 'show-login'), evitando flashes iniciais.
  createLoginWindow(false, true);
  screen.on('display-added', handleDisplaysChanged);
  screen.on('display-removed', handleDisplaysChanged);
  screen.on('display-metrics-changed', handleDisplaysChanged);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // Em sistemas macOS, ao reativar o aplicativo sem janelas abertas,
      // criamos a tela de login oculta e deixamos que o renderer a exiba
      // quando estiver pronto, garantindo uma transição suave.
      createLoginWindow(false, true);
    }
  });

  showStartupBanner();
  initializeAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') flushAndQuit('window-all-closed');
});

app.on('before-quit', (event) => {
  if (quittingApp) return;
  if (currentUserSession) {
    event.preventDefault();
    flushAndQuit('before-quit');
  }
});

app.on('will-quit', () => {
  // Garantimos que o servidor da API seja finalizado mesmo em encerramentos atípicos
  closeApiServer();
});

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    closeApiServer().finally(() => {
      process.exit();
    });
  });
});

ipcMain.handle('registrar-usuario', async (_event, dados) => {
  try {
    await registrarUsuario(dados.name, dados.email, dados.password, dados.pin);
    return { success: true, message: 'Usuário cadastrado com sucesso!' };
  } catch (err) {
    return { success: false, message: err.message || 'Erro ao cadastrar usuário' };
  }
});

ipcMain.handle('login-usuario', async (event, dados) => {
  try {
    const user = await loginUsuario(dados.email, dados.password, dados.pin);
    setCurrentUserSession(user);
    return { success: true, user };
  } catch (err) {
    return { success: false, message: err.message, code: err.code };
  }
});

ipcMain.handle('publish-update', async (_event, payload) => {
  if (!currentUserSession) {
    return {
      success: false,
      code: 'unauthenticated',
      ...publishState
    };
  }

  if (!isSupAdmin) {
    return {
      success: false,
      code: 'forbidden',
      ...publishState
    };
  }

  if (publishState.publishing || publisher.isPublishing()) {
    return {
      success: false,
      code: 'in-progress',
      ...publishState
    };
  }

  const requestedVersion = typeof payload === 'object' && payload !== null ? payload.version : undefined;
  const sanitizedVersion = typeof requestedVersion === 'string' ? requestedVersion.trim() : '';
  const versionPattern = /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*$/;
  if (!sanitizedVersion || !versionPattern.test(sanitizedVersion)) {
    return {
      success: false,
      code: 'invalid-version',
      message: 'Informe uma versão válida no formato 1.2.3.',
      ...publishState
    };
  }

  let revertVersionChange = null;
  try {
    revertVersionChange = versionManager.applyProjectVersion(sanitizedVersion);
  } catch (err) {
    return {
      success: false,
      code: 'version-update-failed',
      message: err?.message || 'Falha ao preparar arquivos da nova versão.',
      ...publishState
    };
  }

  const previousLocalVersion = publishState.localVersion;
  const previousPublishedVersion = publishState.latestPublishedVersion;

  const startState = await updatePublishState({ publishing: true, canPublish: false });
  const startMessage = `Iniciando publicação da versão ${sanitizedVersion}...`;
  broadcastPublishEvent('publish-progress', {
    ...startState,
    message: startMessage,
    targetVersion: sanitizedVersion
  });
  recordPublishAudit('publish-start', { version: sanitizedVersion });

  const progressHandler = info => {
    if (!info || !info.message) return;
    broadcastPublishEvent('publish-progress', {
      ...publishState,
      message: info.message,
      targetVersion: sanitizedVersion
    });
  };

  try {
    await publisher.runPublishPipeline({
      user: currentUserSession,
      onProgress: progressHandler,
      version: sanitizedVersion
    });
    const gitResult = await performReleaseCommit({
      runGitCommand,
      version: sanitizedVersion,
      logger: console
    });

    if (!gitResult.success) {
      const gitError = new Error(
        gitResult.message || 'Falha ao sincronizar repositório após publicação.'
      );
      gitError.code = gitResult.code || 'git-automation-failed';
      gitError.isGitAutomationError = true;
      throw gitError;
    }

    const headAfterPush = await getHeadCommitHash({ force: true });
    const nextHeadCommit = headAfterPush || publishState.lastPublishedCommit;
    if (!headAfterPush) {
      console.warn('Não foi possível obter o commit HEAD após o push. Mantendo último commit conhecido.');
    }
    const successState = await updatePublishState({
      publishing: false,
      canPublish: true,
      latestPublishedVersion: sanitizedVersion,
      localVersion: sanitizedVersion,
      lastPublishedCommit: nextHeadCommit
    });
    broadcastPublishEvent('publish-done', { ...successState, targetVersion: sanitizedVersion });
    recordPublishAudit('publish-success', { version: sanitizedVersion });
    revertVersionChange = null;
    return { success: true, ...successState };
  } catch (err) {
    if (typeof revertVersionChange === 'function') {
      try {
        revertVersionChange();
      } catch (restoreErr) {
        console.error('Falha ao restaurar arquivos da versão anterior:', restoreErr);
      } finally {
        revertVersionChange = null;
      }
    }
    const errorState = await updatePublishState({ publishing: false, canPublish: true });
    const isGitFailure = Boolean(err?.isGitAutomationError || (err?.code && String(err.code).startsWith('git-')));
    let message;
    if (gitUnavailable) {
      console.warn('Git não está disponível neste ambiente; publicação abortada e versão revertida.');
      message =
        'Git não está disponível neste ambiente. Instale e configure o Git para concluir a publicação.';
    } else if (isGitFailure) {
      message = err?.message || 'Falha ao sincronizar repositório com a nova versão.';
    } else {
      message = err?.message || 'Falha ao publicar atualização.';
    }
    broadcastPublishEvent('publish-error', {
      ...errorState,
      message,
      targetVersion: sanitizedVersion
    });
    recordPublishAudit('publish-failure', { error: message, version: sanitizedVersion });
    const restoredState = await updatePublishState({
      latestPublishedVersion: previousPublishedVersion,
      localVersion: previousLocalVersion
    });
    return { success: false, error: message, ...restoredState };
  }
});

ipcMain.handle('get-update-status', async (_event, options = {}) => {
  const refresh = Boolean(options?.refresh);

  if (refresh) {
    if (updateStatusCache.promise && updateStatusCache.refreshInFlight) {
      return updateStatusCache.promise;
    }
    if (updateStatusCache.promise) {
      try {
        await updateStatusCache.promise;
      } catch (err) {
        if (DEBUG) {
          console.warn('Falha em consulta anterior de status de atualização:', err);
        }
      }
    }

    updateStatusCache.refreshInFlight = true;
    const promise = buildUpdateStatusPayload({ refresh: true })
      .catch(err => {
        if (DEBUG) {
          console.warn('Falha ao atualizar status de atualização (refresh):', err);
        }
        throw err;
      })
      .finally(() => {
        if (updateStatusCache.promise === promise) {
          updateStatusCache.promise = null;
        }
        updateStatusCache.refreshInFlight = false;
      });
    updateStatusCache.promise = promise;
    return promise;
  }

  const now = Date.now();
  if (
    updateStatusCache.value &&
    now - updateStatusCache.timestamp < UPDATE_STATUS_CACHE_TTL
  ) {
    return updateStatusCache.value;
  }

  if (updateStatusCache.promise) {
    return updateStatusCache.promise;
  }

  updateStatusCache.refreshInFlight = false;
  const promise = buildUpdateStatusPayload({ refresh: false })
    .catch(err => {
      if (DEBUG) {
        console.warn('Falha ao obter status de atualização:', err);
      }
      throw err;
    })
    .finally(() => {
      if (updateStatusCache.promise === promise) {
        updateStatusCache.promise = null;
      }
      updateStatusCache.refreshInFlight = false;
    });

  updateStatusCache.promise = promise;
  return promise;
});

ipcMain.handle('check-for-updates', async () => {
  return updateService.checkForUpdates();
});

ipcMain.handle('download-update', async () => {
  const statusBefore = updateService.getUpdateStatus();

  if (statusBefore.status === 'downloaded' || statusBefore.status === 'installing') {
    return statusBefore;
  }

  if (statusBefore.status !== 'update-available' && statusBefore.status !== 'downloading') {
    const afterCheck = await updateService.checkForUpdates({ silent: true });
    if (afterCheck.status !== 'update-available') {
      return afterCheck;
    }
  }

  return updateService.downloadUpdate();
});

ipcMain.handle('install-update', async () => {
  const statusBefore = updateService.getUpdateStatus();
  if (statusBefore.status !== 'downloaded') {
    return {
      ...statusBefore,
      canInstall: false,
      statusMessage:
        statusBefore.status === 'installing'
          ? statusBefore.statusMessage
          : 'Nenhuma atualização baixada para instalar.'
    };
  }

  const success = updateService.installUpdate();
  return {
    ...updateService.getUpdateStatus(),
    canInstall: success
  };
});

ipcMain.handle('listar-materia-prima', async (_e, { filtro }) => {
  return listarMaterias(filtro);
});
ipcMain.handle('adicionar-materia-prima', async (_e, dados) => {
  try {
    const materia = await adicionarMateria(dados);
    return { success: true, materia };
  } catch (err) {
    return { success: false, message: err.message, code: err.code };
  }
});
ipcMain.handle('atualizar-materia-prima', async (_e, { id, dados }) => {
  try {
    const materia = await atualizarMateria(id, dados);
    return { success: true, materia };
  } catch (err) {
    return { success: false, message: err.message, code: err.code };
  }
});
ipcMain.handle('excluir-materia-prima', async (_e, info) => {
  try {
    const id = typeof info === 'object' && info !== null ? info.id : info;
    if (id === undefined || id === null) {
      return { success: false, message: 'ID inválido', code: 'invalid-id' };
    }
    await excluirMateria(id);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message, code: err.code };
  }
});
ipcMain.handle('registrar-entrada-materia-prima', async (_e, { id, quantidade }) => {
  return registrarEntrada(id, quantidade, currentUserSession?.id ?? null);
});
ipcMain.handle('registrar-saida-materia-prima', async (_e, { id, quantidade }) => {
  return registrarSaida(id, quantidade, currentUserSession?.id ?? null);
});
ipcMain.handle('atualizar-preco-materia-prima', async (_e, { id, preco }) => {
  return atualizarPreco(id, preco, currentUserSession?.id ?? null);
});
ipcMain.handle('listar-categorias', async () => {
  try {
    return await listarCategorias();
  } catch (err) {
    console.error('Erro ao listar categorias:', err);
    throw err;
  }
});
ipcMain.handle('listar-unidades', async () => {
  try {
    return await listarUnidades();
  } catch (err) {
    console.error('Erro ao listar unidades:', err);
    throw err;
  }
});
ipcMain.handle('listar-colecoes', async () => {
  try {
    return await listarColecoes();
  } catch (err) {
    console.error('Erro ao listar coleções:', err);
    throw err;
  }
});
ipcMain.handle('adicionar-categoria', async (_e, nome) => {
  try {
    return await adicionarCategoria(nome);
  } catch (err) {
    console.error('Erro ao adicionar categoria:', err);
    throw err;
  }
});
ipcMain.handle('adicionar-unidade', async (_e, nome) => {
  try {
    return await adicionarUnidade(nome);
  } catch (err) {
    console.error('Erro ao adicionar unidade:', err);
    throw err;
  }
});
ipcMain.handle('adicionar-colecao', async (_e, nome) => {
  try {
    return await adicionarColecao(nome);
  } catch (err) {
    console.error('Erro ao adicionar coleção:', err);
    throw err;
  }
});
ipcMain.handle('remover-categoria', async (_e, nome) => {
  try {
    return await removerCategoria(nome);
  } catch (err) {
    console.error('Erro ao remover categoria:', err);
    throw err;
  }
});
ipcMain.handle('remover-unidade', async (_e, nome) => {
  try {
    return await removerUnidade(nome);
  } catch (err) {
    console.error('Erro ao remover unidade:', err);
    throw err;
  }
});
ipcMain.handle('remover-colecao', async (_e, nome) => {
  try {
    return await removerColecao(nome);
  } catch (err) {
    console.error('Erro ao remover coleção:', err);
    throw err;
  }
});
ipcMain.handle('verificar-dependencia-categoria', async (_e, nome) => {
  try {
    return await categoriaTemDependencias(nome);
  } catch (err) {
    console.error('Erro ao verificar dependência de categoria:', err);
    throw err;
  }
});
ipcMain.handle('verificar-dependencia-unidade', async (_e, nome) => {
  try {
    return await unidadeTemDependencias(nome);
  } catch (err) {
    console.error('Erro ao verificar dependência de unidade:', err);
    throw err;
  }
});
ipcMain.handle('verificar-dependencia-colecao', async (_e, nome) => {
  try {
    return await colecaoTemDependencias(nome);
  } catch (err) {
    console.error('Erro ao verificar dependência de coleção:', err);
    throw err;
  }
});
ipcMain.handle('verificar-dependencia-processo', async (_e, nome) => {
  try {
    return await processoTemDependencias(nome);
  } catch (err) {
    console.error('Erro ao verificar dependência de processo:', err);
    throw err;
  }
});
ipcMain.handle('listar-produtos', async () => {
  return listarProdutos();
});
ipcMain.handle('obter-produto', async (_e, codigo) => {
  try {
    return await obterProduto(codigo);
  } catch (err) {
    console.error('Erro ao obter produto:', err);
    throw err;
  }
});
ipcMain.handle('adicionar-produto', async (_e, dados) => {
  return adicionarProduto(dados);
});
ipcMain.handle('atualizar-produto', async (_e, { id, dados }) => {
  return atualizarProduto(id, dados);
});
ipcMain.handle('excluir-produto', async (_e, info) => {
  try {
    const id = typeof info === 'object' && info !== null ? info.id : info;
    if (id === undefined || id === null) {
      return { error: 'invalid-id' };
    }
    await excluirProduto(id);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('listar-detalhes-produto', async (_e, { produtoCodigo, produtoId }) => {
  try {
    // Ajuste: encaminha ambos os parâmetros para o backend
    return await listarDetalhesProduto(produtoCodigo, produtoId);
  } catch (err) {
    console.error('Erro ao listar detalhes do produto:', err);
    throw err;
  }
});
ipcMain.handle('inserir-lote-produto', async (_e, dados) => {
  return inserirLoteProduto(dados);
});
ipcMain.handle('atualizar-lote-produto', async (_e, { id, quantidade }) => {
  return atualizarLoteProduto(id, quantidade);
});
ipcMain.handle('excluir-lote-produto', async (_e, info) => {
  const id = typeof info === 'object' && info !== null ? info.id : info;
  if (id === undefined || id === null) {
    return { success: false, error: 'invalid-id' };
  }
  await excluirLoteProduto(id);
  return { success: true };
});
ipcMain.handle('listar-insumos-produto', async (_e, codigo) => {
  return listarInsumosProduto(codigo);
});
ipcMain.handle('listar-etapas-producao', async () => {
  return listarEtapasProducao();
});
ipcMain.handle('adicionar-etapa-producao', async (_e, dados) => {
  return adicionarEtapaProducao(dados);
});
ipcMain.handle('remover-etapa-producao', async (_e, nome) => {
  try {
    return await removerEtapaProducao(nome);
  } catch (err) {
    console.error('Erro ao remover etapa de produção:', err);
    throw err;
  }
});
ipcMain.handle('listar-itens-processo-produto', async (_e, { codigo, etapa, busca }) => {
  return listarItensProcessoProduto(codigo, etapa, busca);
});
ipcMain.handle('salvar-produto-detalhado', async (_e, { codigo, produto, itens }) => {
  return salvarProdutoDetalhado(codigo, produto, itens);
});

ipcMain.handle('auto-login', async (_event, payload) => {
  const { pin, user } = typeof payload === 'object' && payload !== null
    ? payload
    : { pin: payload };
  try {
    if (pin) {
      db.init(pin);
      await db.query('SELECT 1');
    }

    if (!dashboardWindow) {
      if (loginWindow) {
        try {
          const bounds = loginWindow.getBounds();
          const display = screen.getDisplayMatching(bounds);
          logDisplayInfo('auto-login-detected', display);
          if (display && display.id !== currentDisplayId) {
            saveDisplayId(display.id);
          }
        } catch (err) {
          console.error('Failed to detect login display', err);
        }
      }
      createDashboardWindow(true);
    }
    if (loginWindow) {
      loginWindow.close();
    }
    if (user && user.id) {
      setCurrentUserSession(user);
      try {
        await registrarUltimaEntrada(user.id);
      } catch (err) {
        console.error('Falha ao registrar ultima entrada (auto-login):', err);
      }
    } else {
      setCurrentUserSession(null);
    }
    if (dashboardWindow) {
      dashboardWindow.show();
      dashboardWindow.focus();
    }
    return { success: true };
  } catch (err) {
    console.error('Auto-login failed:', err.message);
    currentUserSession = null;
    if (isNetworkError(err)) {
      return { success: false, reason: 'offline' };
    }
    if (isPinError(err)) {
      return { success: false, reason: 'pin' };
    }
    return { success: false, message: err.message };
  }
});

ipcMain.handle('open-dashboard', async () => {
  if (!dashboardWindow) {
    if (loginWindow) {
      try {
        const bounds = loginWindow.getBounds();
        const display = screen.getDisplayMatching(bounds);
        logDisplayInfo('open-dashboard-detected', display);
        if (display && display.id !== currentDisplayId) {
          saveDisplayId(display.id);
        }
      } catch (err) {
        console.error('Failed to detect login display', err);
      }
    }
    createDashboardWindow(false);
  }
  return true;
});

ipcMain.handle('check-pin', async () => {
  try {
    await db.query('SELECT 1');
    if (currentUserSession?.id) {
      const { rows } = await db.query('SELECT 1 FROM usuarios WHERE id = $1 LIMIT 1', [
        currentUserSession.id
      ]);
      if (!rows || rows.length === 0) {
        return { success: false, reason: 'user-removed' };
      }
    }
    return { success: true };
  } catch (err) {
    if (isNetworkError(err)) {
      return { success: false, reason: 'offline' };
    }
    if (isPinError(err)) {
      return { success: false, reason: 'pin' };
    }
    return { success: false };
  }
});

ipcMain.handle('save-state', async (_e, state) => {
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ savedAt: Date.now(), state }));
    return true;
  } catch (err) {
    console.error('save-state error', err);
    return false;
  }
});

ipcMain.handle('load-state', async () => {
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (Date.now() - data.savedAt < 30 * 60 * 1000) {
        return data.state;
      }
      fs.unlinkSync(stateFile);
    }
  } catch (err) {
    console.error('load-state error', err);
  }
  return null;
});

ipcMain.handle('clear-state', () => {
  try {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  } catch (err) {
    console.error('clear-state error', err);
  }
  return true;
});

ipcMain.handle('record-user-action', async (_event, action) => {
  if (!currentUserSession) return false;
  const normalized = normalizeUserAction(action);
  if (!normalized) return false;
  if (!lastRecordedAction || normalized.timestamp >= lastRecordedAction.timestamp) {
    lastRecordedAction = normalized;
  }
  return true;
});

ipcMain.handle('close-dashboard', async () => {
  await persistUserExit('close-dashboard');
  if (dashboardWindow) {
    dashboardWindow.close();
  }
  return true;
});

ipcMain.handle('close-login', async () => {
  if (loginWindow) {
    loginWindow.close();
  }
  if (dashboardWindow) {
    dashboardWindow.show();
    dashboardWindow.focus();
  }
  return true;
});

ipcMain.handle('logout', async () => {
  await persistUserExit('logout');
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
  }
  return true;
});

ipcMain.handle('open-login-hidden', async () => {
  if (!loginWindow) {
    // show = false, showOnLoad = false → janela carregada, mas não exibida
    createLoginWindow(false, false);
  }
  return true;
});

// 3) Mostra o loginWindow **somente** após o conteúdo terminar de carregar,
//    evitando o flash branco
ipcMain.handle('show-login', async () => {
  if (!loginWindow) {
    createLoginWindow(false, false);
  }
  await revealLoginWindow();
  return true;
});


ipcMain.handle('close-window', () => {
  flushAndQuit('close-window');
});
ipcMain.handle('minimize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});
ipcMain.handle('reload-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const url = win.webContents.getURL();
    if (url.includes('login/login.html')) {
      win.loadFile(
        path.join(__dirname, 'src/login/login.html'),
        { query: { hidden: '1' } }
      );
    } else {
      win.reload();
    }
  }
});

ipcMain.handle('get-displays', () => {
  const displays = screen.getAllDisplays();
  return displays.map((d, i) => ({ id: d.id, name: d.label || `Tela ${i + 1}` }));
});

ipcMain.handle('set-display', (_e, id) => {
  let display = screen.getAllDisplays().find(d => d.id === id);
  if (!display) {
    display = screen.getPrimaryDisplay();
    id = display.id;
  }
  logDisplayInfo('set-display', display);
  const bounds = getBoundsForDisplay(display);
  if (loginWindow) {
    const wasVisible = loginWindow.isVisible();
    loginWindow.setBounds(bounds);
    loginWindow.setFullScreen(true);
    if (wasVisible) {
      loginWindow.show();
      loginWindow.focus();
      loginWindow.webContents.send('activate-tab', 'login');
    }
  }
  if (dashboardWindow) {
    const wasVisible = dashboardWindow.isVisible();
    dashboardWindow.setBounds(bounds);
    dashboardWindow.setFullScreen(true);
    if (wasVisible) {
      dashboardWindow.show();
      dashboardWindow.focus();
    }
  }
  saveDisplayId(id);
  return true;
});

ipcMain.handle('get-saved-display', () => {
  try {
    if (fs.existsSync(displayFile)) {
      const { id } = JSON.parse(fs.readFileSync(displayFile, 'utf-8'));
      currentDisplayId = id;
    }
  } catch (err) {
    console.error('get-saved-display error', err);
  }
  return currentDisplayId || null;
});

ipcMain.handle('open-pdf', async (_event, { id, tipo }) => {
  const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const prefix = `[pdf:${requestId}]`;
  const logInfo = (...args) => console.info(prefix, ...args);
  const logWarn = (...args) => console.warn(prefix, ...args);
  const logError = (...args) => console.error(prefix, ...args);

  if (!id) {
    logWarn('Tentativa de gerar PDF sem um identificador válido.');
    return { success: false, message: 'Documento inválido para geração de PDF.' };
  }

  const apiBaseUrl = `http://localhost:${currentApiPort ?? configuredApiPort ?? DEFAULT_API_PORT}`;
  const url = new URL('/pdf', apiBaseUrl);
  url.searchParams.set('id', id);
  if (tipo) url.searchParams.set('tipo', tipo);
  url.searchParams.set('apiBaseUrl', apiBaseUrl);

  logInfo('Iniciando geração de PDF.', { id, tipo: tipo || 'orcamento', apiBaseUrl, url: url.toString() });

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  const { webContents } = pdfWindow;

  const logConsoleMessage = (_event, level, message, line, sourceId) => {
    const levelMap = {
      0: 'log',
      1: 'warn',
      2: 'error',
      3: 'info',
      4: 'debug'
    };
    const label = levelMap[level] || `level-${level}`;
    console.info(`${prefix} [renderer:${label}] ${message} (${sourceId}:${line})`);
  };

  webContents.on('console-message', logConsoleMessage);
  webContents.on('did-start-navigation', (_event, navigationUrl, isInPlace, isMainFrame) => {
    logInfo('Iniciou navegação.', { navigationUrl, isInPlace, isMainFrame });
  });
  webContents.on('did-finish-load', () => {
    logInfo('Carregamento inicial concluído.');
  });
  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logError('Falha ao carregar conteúdo do PDF.', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    });
  });
  webContents.on('render-process-gone', (_event, details) => {
    logError('Processo de renderização finalizado inesperadamente.', details);
  });
  webContents.on('unresponsive', () => {
    logWarn('Janela de PDF ficou sem resposta.');
  });
  webContents.on('responsive', () => {
    logInfo('Janela de PDF voltou a responder.');
  });

  try {
    logInfo('Carregando URL da visualização oculta do PDF.');
    await webContents.loadURL(url.toString());
    logInfo('URL carregada. Aguardando montagem completa do documento no renderer.', {
      timeoutMs: 20000
    });

    const timeoutMs = 20000;
    const pollIntervalMs = 100;
    const waitStart = Date.now();
    let rendererState = { pronto: false, erro: null, dadosCarregados: false };
    let dadosCarregadosLogEmitted = false;

    while (Date.now() - waitStart < timeoutMs) {
      try {
        rendererState = await webContents.executeJavaScript(
          `(() => ({
              pronto: Boolean(window.__pdf_montado),
              erro: window.__pdf_erro || null,
              dadosCarregados: Boolean(window.__dados_carregados)
            }))();`,
          true
        );
      } catch (pollError) {
        logWarn('Falha ao consultar estado do renderer durante a geração de PDF.', pollError);
        rendererState = rendererState || { pronto: false, erro: null, dadosCarregados: false };
      }

      if (rendererState?.erro) {
        throw new Error(rendererState.erro);
      }

      if (rendererState?.dadosCarregados && !dadosCarregadosLogEmitted) {
        dadosCarregadosLogEmitted = true;
        logInfo('Renderer sinalizou dados carregados. Aguardando fontes/imagens e evento de load.');
      }

      if (rendererState?.pronto) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    if (!rendererState?.pronto) {
      throw new Error('Timeout esperando a montagem do PDF.');
    }

    logInfo('Renderer confirmou montagem completa do PDF. Recuperando metadados.');

    const meta = await webContents
      .executeJavaScript('window.generatedPdfMeta || {};', true)
      .catch((err) => {
        logWarn('Não foi possível obter metadados do documento.', err);
        return {};
      });

    logInfo('Metadados coletados.', meta);

    const docType = (meta?.tipo || tipo || 'documento').toString();
    const docNumber = (meta?.numero || id || '').toString();
    const baseName = [docType, docNumber].filter(Boolean).join('-') || 'documento';
    const sanitizedBaseName = baseName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'documento';

    logInfo('Iniciando renderização nativa para PDF.');

    const pdfData = await webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      marginsType: 0
    });

    logInfo('PDF gerado em memória. Exibindo diálogo de salvamento padrão.', {
      suggestedName: `${sanitizedBaseName}.pdf`
    });

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: docType === 'pedido' ? 'Salvar Pedido em PDF' : 'Salvar Orçamento em PDF',
      defaultPath: path.join(app.getPath('documents'), `${sanitizedBaseName}.pdf`),
      filters: [{ name: 'Arquivos PDF', extensions: ['pdf'] }]
    });

    if (canceled || !filePath) {
      logWarn('Usuário cancelou a geração ou nenhum caminho foi informado.', { canceled, filePath });
      return { success: false, canceled: true };
    }

    logInfo('Salvando arquivo PDF no destino escolhido.', { filePath });

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, pdfData);

    logInfo('Arquivo PDF salvo com sucesso.', { filePath });
    return { success: true, filePath };
  } catch (error) {
    logError('Erro durante o fluxo de geração de PDF.', error);
    return { success: false, message: error?.message || 'Erro ao gerar PDF.' };
  } finally {
    if (!webContents.isDestroyed()) {
      webContents.removeListener('console-message', logConsoleMessage);
    }
    if (!pdfWindow.isDestroyed()) {
      logInfo('Encerrando janela oculta de PDF.');
      pdfWindow.close();
    }
  }
});

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
  return true;
});

ipcMain.handle('open-external-html', async (_event, html) => {
  if (typeof html !== 'string' || !html.trim()) {
    return false;
  }

  try {
    const tempDir = path.join(app.getPath('temp'), 'app-gestao-print');
    await fs.promises.mkdir(tempDir, { recursive: true });
    const filePath = path.join(
      tempDir,
      `relatorio-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
    );
    await fs.promises.writeFile(filePath, html, 'utf-8');
    const fileUrl = pathToFileURL(filePath).toString();
    await shell.openExternal(fileUrl);
    return true;
  } catch (err) {
    console.error('open-external-html error', err);
    return false;
  }
});

if (DEBUG) {
  ipcMain.on('debug-log', (_, m) => console.log('[popup]', m));
}
