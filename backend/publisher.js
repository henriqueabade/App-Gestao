const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

const emitter = new EventEmitter();
const projectRoot = path.resolve(__dirname, '..');
const logFilePath = path.join(projectRoot, 'publish-audit.log');

let currentProcess = null;

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFile(logFilePath, line, err => {
    if (err) {
      console.error('Publish pipeline log write failed:', err);
    }
  });
}

function notifyProgress(text, stream, callback) {
  if (!text) return;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (typeof callback === 'function') {
      callback({ message: line, stream });
    }
    emitter.emit('progress', { message: line, stream });
  }
}

async function runPublishPipeline(options = {}) {
  if (currentProcess) {
    throw new Error('Já existe uma publicação em andamento.');
  }

  const { user, onProgress, version } = options;
  const requester = user ? `${user.nome || user.email || user.id || 'usuário desconhecido'}` : 'usuário desconhecido';
  const versionSuffix = version ? ` (versão ${version})` : '';
  appendLog(`Publicação iniciada por ${requester}${versionSuffix}`);

  return new Promise((resolve, reject) => {
    const validationError = validatePublishEnvironment();
    if (validationError) {
      appendLog(`Validação de ambiente falhou: ${validationError.message}`);
      emitter.emit('error', validationError);
      return reject(validationError);
    }

    try {
      const { command, extraArgs } = resolveNpxCommand();
      const child = spawn(command, [...extraArgs, 'electron-builder', '--publish=always'], {
        cwd: projectRoot,
        env: { ...process.env, TARGET_VERSION: version || process.env.TARGET_VERSION },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      currentProcess = child;

      child.stdout.on('data', data => {
        const text = data.toString();
        notifyProgress(text, 'stdout', onProgress);
        appendLog(`stdout: ${text.trimEnd()}`);
      });

      child.stderr.on('data', data => {
        const text = data.toString();
        notifyProgress(text, 'stderr', onProgress);
        appendLog(`stderr: ${text.trimEnd()}`);
      });

      child.on('error', err => {
        currentProcess = null;
        appendLog(`Erro ao iniciar publicação: ${err.message}`);
        emitter.emit('error', err);
        reject(err);
      });

      child.on('close', code => {
        currentProcess = null;
        if (code === 0) {
          appendLog('Publicação concluída com sucesso.');
          emitter.emit('done', { code });
          resolve({ code });
        } else {
          const err = new Error(`Publicação finalizada com código ${code}`);
          appendLog(err.message);
          emitter.emit('error', err);
          reject(err);
        }
      });
    } catch (err) {
      currentProcess = null;
      appendLog(`Falha inesperada na publicação: ${err.message}`);
      emitter.emit('error', err);
      reject(err);
    }
  });
}

function validatePublishEnvironment() {
  const publishProvider = (process.env.ELECTRON_PUBLISH_PROVIDER || 'github').toLowerCase();

  if (publishProvider === 'github') {
    const owner = (process.env.ELECTRON_PUBLISH_GITHUB_OWNER || '').trim();
    const repo = (process.env.ELECTRON_PUBLISH_GITHUB_REPO || '').trim();
    const slug = (process.env.ELECTRON_PUBLISH_GITHUB_SLUG || '').trim();
    const token = (process.env.GH_TOKEN || '').trim();

    const missing = [];

    if (!token) {
      missing.push('GH_TOKEN');
    }

    const hasSlug = Boolean(slug);
    const hasOwnerRepo = Boolean(owner && repo);

    if (!hasSlug && !hasOwnerRepo) {
      missing.push('ELECTRON_PUBLISH_GITHUB_OWNER/REPO ou ELECTRON_PUBLISH_GITHUB_SLUG');
    }

    if (missing.length > 0) {
      const instructions =
        missing.length === 1
          ? missing[0]
          : `${missing.slice(0, -1).join(', ')} e ${missing.slice(-1)}`;
      return new Error(`Defina ${instructions} antes de publicar.`);
    }
  }

  return null;
}

function resolveNpxCommand() {
  const nodeDir = path.dirname(process.execPath);
  const npxBinary = process.platform === 'win32' ? path.join(nodeDir, 'npx.cmd') : path.join(nodeDir, 'npx');

  if (fs.existsSync(npxBinary)) {
    return { command: npxBinary, extraArgs: [] };
  }

  try {
    const npxCli = require.resolve('npm/bin/npx-cli.js');
    return { command: process.execPath, extraArgs: [npxCli] };
  } catch (err) {
    const fallback = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    appendLog(`Aviso: npx não encontrado em ${npxBinary}, utilizando fallback "${fallback}". Detalhes: ${err.message}`);
    return { command: fallback, extraArgs: [] };
  }
}

function isPublishing() {
  return Boolean(currentProcess);
}

module.exports = {
  runPublishPipeline,
  isPublishing,
  on: emitter.on.bind(emitter),
  once: emitter.once.bind(emitter),
  off: emitter.off ? emitter.off.bind(emitter) : emitter.removeListener.bind(emitter)
};
