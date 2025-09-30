const { app, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const { EventEmitter } = require('events');

const DEBUG = process.env.DEBUG === 'true';
const UPDATE_DISABLED = process.env.ELECTRON_UPDATE_DISABLE === 'true';

const statusEmitter = new EventEmitter();

let latestVersion = null;
let downloadProgress = null;
let statusMessage = 'Aguardando verificação de atualização.';
let status = 'idle';
let lastCheckAt = null;
let lastError = null;
let isChecking = false;
let updateChannel = process.env.ELECTRON_UPDATE_CHANNEL || null;
let feedConfigured = false;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function getChannel() {
  return updateChannel || process.env.ELECTRON_UPDATE_CHANNEL || null;
}

function setStatus(update = {}) {
  latestVersion = update.latestVersion ?? latestVersion;
  downloadProgress = update.downloadProgress ?? downloadProgress;
  statusMessage = update.statusMessage ?? statusMessage;
  status = update.status ?? status;
  lastCheckAt = update.lastCheckAt ?? lastCheckAt;
  lastError = update.error ?? lastError;

  const payload = getUpdateStatus();
  statusEmitter.emit('status', payload);
  broadcastToWindows(payload);
}

function broadcastToWindows(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('update-status', payload);
      }
    } catch (err) {
      if (DEBUG) {
        console.warn('Falha ao enviar status de atualização para uma janela:', err);
      }
    }
  }
}

function getUpdateStatus() {
  return {
    latestVersion,
    downloadProgress,
    statusMessage,
    status,
    lastCheckAt,
    error: lastError ? { message: lastError.message, code: lastError.code } : null,
    channel: getChannel(),
    feedConfigured
  };
}

function resetCachedState(reason = 'manual-reset') {
  if (DEBUG) {
    console.log(`updateService: resetCachedState (${reason})`);
  }
  latestVersion = null;
  downloadProgress = null;
  const persistentErrorCodes = new Set(['disabled', 'dev-mode']);
  const shouldKeepError = lastError && persistentErrorCodes.has(lastError.code);
  if (shouldKeepError) {
    status = 'error';
    statusMessage = lastError.friendlyMessage || lastError.message || 'Atualizações indisponíveis.';
  } else {
    statusMessage = 'Aguardando verificação de atualização.';
    status = 'idle';
    lastError = null;
  }
  lastCheckAt = null;
  setStatus({});
}

function recordFeedConfiguration(success, error) {
  feedConfigured = Boolean(success);
  if (!success && error) {
    lastError = decorateError(error);
    setStatus({
      status: 'error',
      statusMessage: lastError?.friendlyMessage || 'Não foi possível configurar o servidor de atualização.',
      error: lastError
    });
  } else if (success) {
    updateChannel = getChannel();
    if (status === 'error' && lastError?.code === 'no-feed') {
      setStatus({
        status: 'idle',
        statusMessage: 'Servidor de atualização configurado. Pronto para verificar novas versões.',
        error: null
      });
    }
  }
}

function ensureAppReady() {
  if (app.isReady()) return Promise.resolve();
  return app.whenReady();
}

function decorateError(error) {
  if (!error) return null;
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message || '';
  if (message.includes('ERR_INTERNET_DISCONNECTED') || message.includes('ENOTFOUND')) {
    err.code = 'offline';
    err.friendlyMessage = 'Sem conexão com a internet. Tente novamente quando estiver online.';
  } else if (
    message.includes('404') ||
    message.includes('no available update') ||
    message.toLowerCase().includes('feed de atualização não configurado') ||
    message.toLowerCase().includes('update feed not configured')
  ) {
    err.code = 'no-feed';
    err.friendlyMessage = 'Servidor de atualização indisponível no momento.';
  } else if (message.toLowerCase().includes('desabilit')) {
    err.code = 'disabled';
    err.friendlyMessage = 'Atualizações Desabilitadas';
  } else if (message.toLowerCase().includes('desenvolvimento')) {
    err.code = 'dev-mode';
    err.friendlyMessage = 'Atualizações Indisponíveis';
  } else {
    err.code = err.code || 'unexpected';
    err.friendlyMessage = 'Ocorreu um erro ao verificar atualizações.';
  }
  return err;
}

async function checkForUpdates({ silent = false } = {}) {
  await ensureAppReady();

  if (!app.isPackaged) {
    const message = 'Atualizações automáticas indisponíveis durante o desenvolvimento.';
    setStatus({
      status: 'disabled',
      statusMessage: message,
      error: null
    });
    return getUpdateStatus();
  }

  if (UPDATE_DISABLED) {
    const message = 'Atualizações automáticas foram desabilitadas pelo administrador.';
    setStatus({
      status: 'disabled',
      statusMessage: message,
      error: null
    });
    return getUpdateStatus();
  }

  if (isChecking) {
    if (DEBUG && !silent) {
      console.warn('updateService: checkForUpdates ignorado, já existe uma verificação em andamento.');
    }
    return getUpdateStatus();
  }

  isChecking = true;
  const startedAt = new Date().toISOString();
  setStatus({
    status: 'checking',
    statusMessage: 'Procurando atualizações...',
    lastCheckAt: startedAt,
    error: null
  });

  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result && result.updateInfo ? result.updateInfo : null;
    if (info && info.version) {
      latestVersion = info.version;
      setStatus({
        status: 'update-available',
        statusMessage: 'Nova atualização disponível.',
        latestVersion
      });
    } else {
      setStatus({
        status: 'up-to-date',
        statusMessage: 'Aplicativo já está na versão mais recente.'
      });
    }
  } catch (error) {
    const decorated = decorateError(error);
    setStatus({
      status: 'error',
      statusMessage: decorated?.friendlyMessage || 'Não foi possível verificar atualizações.',
      error: decorated
    });
  } finally {
    isChecking = false;
  }

  return getUpdateStatus();
}

async function fetchPublishedVersion({ force = false } = {}) {
  if (!force && latestVersion) {
    return { version: latestVersion, channel: getChannel() };
  }

  const statusBefore = await checkForUpdates({ silent: true });

  if (statusBefore.error && statusBefore.error.code === 'offline') {
    return {
      version: latestVersion,
      channel: getChannel(),
      message: 'Não foi possível obter a versão publicada sem conexão com a internet.'
    };
  }

  return { version: latestVersion, channel: getChannel() };
}

async function downloadUpdate() {
  await ensureAppReady();

  if (!app.isPackaged || UPDATE_DISABLED) {
    return getUpdateStatus();
  }

  try {
    setStatus({
      status: 'downloading',
      statusMessage: 'Baixando atualização...',
      error: null
    });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const decorated = decorateError(error);
    setStatus({
      status: 'error',
      statusMessage: decorated?.friendlyMessage || 'Falha ao baixar atualização.',
      error: decorated,
      downloadProgress: null
    });
  }

  return getUpdateStatus();
}

function installUpdate() {
  if (!app.isPackaged || UPDATE_DISABLED) {
    return false;
  }
  setStatus({
    status: 'installing',
    statusMessage: 'Reiniciando para instalar a atualização...'
  });
  autoUpdater.quitAndInstall();
  return true;
}

autoUpdater.on('update-available', info => {
  latestVersion = info?.version || latestVersion;
  setStatus({
    status: 'update-available',
    statusMessage: 'Nova atualização disponível.',
    latestVersion
  });
});

autoUpdater.on('update-not-available', () => {
  setStatus({
    status: 'up-to-date',
    statusMessage: 'Aplicativo já está na versão mais recente.'
  });
});

autoUpdater.on('download-progress', progress => {
  downloadProgress = {
    percent: progress?.percent,
    transferred: progress?.transferred,
    total: progress?.total,
    bytesPerSecond: progress?.bytesPerSecond
  };
  setStatus({
    status: 'downloading',
    statusMessage: 'Baixando atualização...',
    downloadProgress
  });
});

autoUpdater.on('update-downloaded', info => {
  latestVersion = info?.version || latestVersion;
  setStatus({
    status: 'downloaded',
    statusMessage: 'Atualização pronta para instalação.',
    latestVersion,
    downloadProgress: { percent: 100 }
  });
});

autoUpdater.on('error', error => {
  const decorated = decorateError(error);
  setStatus({
    status: 'error',
    statusMessage: decorated?.friendlyMessage || 'Ocorreu um erro durante o processo de atualização.',
    error: decorated,
    downloadProgress: null
  });
});

module.exports = {
  checkForUpdates,
  fetchPublishedVersion,
  downloadUpdate,
  installUpdate,
  getUpdateStatus,
  onStatusChange: listener => {
    statusEmitter.on('status', listener);
    return () => statusEmitter.off('status', listener);
  },
  resetCachedState,
  ensureAppReady,
  recordFeedConfiguration
};
