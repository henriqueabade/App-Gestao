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
let releaseNotes = [];
let releaseName = null;
let releaseDate = null;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function sanitizeReleaseNoteText(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  text = text.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  text = text.replace(/<\/(p|div)>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '\n- ');
  text = text.replace(/<\/(li|ul|ol)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/\r\n|\r/g, '\n');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  return text.trim();
}

function splitReleaseNoteText(text) {
  if (!text) return [];
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const bulletCount = lines.filter(line => /^[-*•]/.test(line)).length;
  if (bulletCount && bulletCount === lines.length) {
    return lines.map(line => line.replace(/^[-*•]+\s*/, '').trim()).filter(Boolean);
  }
  return lines;
}

function normalizeReleaseNotes(raw, info = {}) {
  if (!raw) return [];
  const source = Array.isArray(raw) ? raw : [raw];
  const normalized = [];

  source.forEach((entry, index) => {
    if (!entry && typeof entry !== 'number') return;

    let version = info.version || null;
    let title = info.releaseName || (version ? `Versão ${version}` : null);
    let date = info.releaseDate || info.pubDate || null;
    let author = null;
    let highlights = [];
    let summary = '';

    if (typeof entry === 'string') {
      summary = sanitizeReleaseNoteText(entry);
    } else if (entry && typeof entry === 'object') {
      if (entry.version) version = entry.version;
      if (entry.releaseVersion) version = entry.releaseVersion;
      if (entry.releaseName || entry.name || entry.title) {
        title = entry.releaseName || entry.name || entry.title;
      }
      if (entry.date || entry.releaseDate || entry.pubDate || entry.publishedAt) {
        date = entry.date || entry.releaseDate || entry.pubDate || entry.publishedAt;
      }
      if (entry.author || entry.publisher) {
        author = entry.author || entry.publisher;
      }

      if (Array.isArray(entry.notes)) {
        highlights = entry.notes.map(item => sanitizeReleaseNoteText(item)).filter(Boolean);
      } else if (Array.isArray(entry.changes)) {
        highlights = entry.changes.map(item => sanitizeReleaseNoteText(item)).filter(Boolean);
      } else {
        const content =
          entry.note ?? entry.notes ?? entry.body ?? entry.description ?? entry.summary ?? entry.text ?? '';
        summary = sanitizeReleaseNoteText(content);
      }
    } else {
      summary = sanitizeReleaseNoteText(entry);
    }

    if (!highlights.length && summary) {
      highlights = splitReleaseNoteText(summary);
    }

    if (!highlights.length && !summary) return;

    const resolvedTitle = title || (version ? `Versão ${version}` : `Alterações ${index + 1}`);
    normalized.push({
      id: entry?.id || `${version || info.version || 'note'}-${index}`,
      version,
      title: resolvedTitle,
      date: date || null,
      author: author || null,
      highlights,
      summary
    });
  });

  return normalized;
}

function clearReleaseMetadata() {
  releaseNotes = [];
  releaseName = null;
  releaseDate = null;
}

function captureReleaseMetadata(info) {
  if (!info || typeof info !== 'object') return;
  if (info.releaseNotes !== undefined) {
    releaseNotes = normalizeReleaseNotes(info.releaseNotes, info);
  }
  if (info.releaseName !== undefined) {
    releaseName = info.releaseName || null;
  } else if (!releaseName && info.version) {
    releaseName = `Versão ${info.version}`;
  }
  if (info.releaseDate !== undefined || info.pubDate !== undefined) {
    releaseDate = info.releaseDate || info.pubDate || null;
  }
  if (!releaseDate && info.date) {
    releaseDate = info.date;
  }
}

function getReleaseMetadata() {
  return {
    releaseNotes,
    releaseName,
    releaseDate
  };
}

function getChannel() {
  return updateChannel || process.env.ELECTRON_UPDATE_CHANNEL || null;
}

function setStatus(update = {}) {
  if (Object.prototype.hasOwnProperty.call(update, 'latestVersion')) {
    latestVersion = update.latestVersion;
  }
  if (Object.prototype.hasOwnProperty.call(update, 'downloadProgress')) {
    downloadProgress = update.downloadProgress;
  }
  if (Object.prototype.hasOwnProperty.call(update, 'statusMessage')) {
    statusMessage = update.statusMessage;
  }
  if (Object.prototype.hasOwnProperty.call(update, 'status')) {
    status = update.status;
  }
  if (Object.prototype.hasOwnProperty.call(update, 'lastCheckAt')) {
    lastCheckAt = update.lastCheckAt;
  }
  if (Object.prototype.hasOwnProperty.call(update, 'error')) {
    lastError = update.error;
  }
  if (Object.prototype.hasOwnProperty.call(update, 'releaseNotes')) {
    releaseNotes = Array.isArray(update.releaseNotes) ? update.releaseNotes : [];
  }
  if (Object.prototype.hasOwnProperty.call(update, 'releaseName')) {
    releaseName = update.releaseName ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(update, 'releaseDate')) {
    releaseDate = update.releaseDate ?? null;
  }

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
    feedConfigured,
    ...getReleaseMetadata()
  };
}

function resetCachedState(reason = 'manual-reset') {
  if (DEBUG) {
    console.log(`updateService: resetCachedState (${reason})`);
  }
  latestVersion = null;
  downloadProgress = null;
  clearReleaseMetadata();
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
    const message = 'Atualizações Indisponíveis';
    setStatus({
      status: 'disabled',
      statusMessage: message,
      error: null
    });
    return getUpdateStatus();
  }

  if (UPDATE_DISABLED) {
    const message = 'Atualizações Desabilitadas';
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
    error: null,
    ...getReleaseMetadata()
  });

  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result && result.updateInfo ? result.updateInfo : null;
    if (info && info.version) {
      latestVersion = info.version;
      captureReleaseMetadata(info);
      setStatus({
        status: 'update-available',
        statusMessage: 'Nova atualização disponível.',
        latestVersion,
        ...getReleaseMetadata()
      });
    } else {
      clearReleaseMetadata();
      setStatus({
        status: 'up-to-date',
        statusMessage: 'Aplicativo já está na versão mais recente.',
        latestVersion: null,
        downloadProgress: null,
        ...getReleaseMetadata()
      });
    }
  } catch (error) {
    const decorated = decorateError(error);
    setStatus({
      status: 'error',
      statusMessage: decorated?.friendlyMessage || 'Não foi possível verificar atualizações.',
      error: decorated,
      ...getReleaseMetadata()
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
      error: null,
      ...getReleaseMetadata()
    });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const decorated = decorateError(error);
    setStatus({
      status: 'error',
      statusMessage: decorated?.friendlyMessage || 'Falha ao baixar atualização.',
      error: decorated,
      downloadProgress: null,
      ...getReleaseMetadata()
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
    statusMessage: 'Reiniciando para instalar a atualização...',
    ...getReleaseMetadata()
  });
  autoUpdater.quitAndInstall();
  return true;
}

autoUpdater.on('update-available', info => {
  latestVersion = info?.version || latestVersion;
  captureReleaseMetadata(info);
  setStatus({
    status: 'update-available',
    statusMessage: 'Nova atualização disponível.',
    latestVersion,
    ...getReleaseMetadata()
  });
});

autoUpdater.on('update-not-available', () => {
  clearReleaseMetadata();
  setStatus({
    status: 'up-to-date',
    statusMessage: 'Aplicativo já está na versão mais recente.',
    latestVersion: null,
    downloadProgress: null,
    ...getReleaseMetadata()
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
    downloadProgress,
    ...getReleaseMetadata()
  });
});

autoUpdater.on('update-downloaded', info => {
  latestVersion = info?.version || latestVersion;
  captureReleaseMetadata(info);
  setStatus({
    status: 'downloaded',
    statusMessage: 'Atualização pronta para instalação.',
    latestVersion,
    downloadProgress: { percent: 100 },
    ...getReleaseMetadata()
  });
});

autoUpdater.on('error', error => {
  const decorated = decorateError(error);
  setStatus({
    status: 'error',
    statusMessage: decorated?.friendlyMessage || 'Ocorreu um erro durante o processo de atualização.',
    error: decorated,
    downloadProgress: null,
    ...getReleaseMetadata()
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
