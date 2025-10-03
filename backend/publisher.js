// backend/publisher.js
// ✅ Lê GH_TOKEN do .env
// ✅ Não exige OWNER/REPO/SLUG do ambiente (usa valores padrão)
// ✅ Injeta OWNER/REPO/RELEASE_TYPE no spawn para o electron-builder

require('dotenv').config();

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

const emitter = new EventEmitter();
const projectRoot = path.resolve(__dirname, '..');
const logFilePath = path.join(projectRoot, 'publish-audit.log');

let currentProcess = null;

// 🔧 AJUSTE AQUI SE PRECISAR:
const DEFAULT_OWNER = process.env.ELECTRON_PUBLISH_GITHUB_OWNER || 'henriqueabade';
const DEFAULT_REPO  = process.env.ELECTRON_PUBLISH_GITHUB_REPO  || 'App-Gestao';
const DEFAULT_RELEASE_TYPE = process.env.ELECTRON_PUBLISH_GITHUB_RELEASE_TYPE || 'draft';

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFile(logFilePath, line, err => {
    if (err) console.error('Publish pipeline log write failed:', err);
  });
}

function notifyProgress(text, stream, callback) {
  if (!text) return;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (typeof callback === 'function') callback({ message: line, stream });
    emitter.emit('progress', { message: line, stream });
  }
}

async function runPublishPipeline(options = {}) {
  if (currentProcess) throw new Error('Já existe uma publicação em andamento.');

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

      const child = spawn(command, [...extraArgs, 'electron-builder', '--config', 'electron-builder.config.js', '--publish', 'always'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          TARGET_VERSION: version || process.env.TARGET_VERSION,
          // ✅ injeta fallback seguro pro electron-builder
          ELECTRON_PUBLISH_GITHUB_OWNER: DEFAULT_OWNER,
          ELECTRON_PUBLISH_GITHUB_REPO: DEFAULT_REPO,
          ELECTRON_PUBLISH_GITHUB_RELEASE_TYPE: DEFAULT_RELEASE_TYPE
        },
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
  // 🔒 ÚNICO requisito obrigatório: GH_TOKEN (pode estar no .env)
  const token = (process.env.GH_TOKEN || '').trim();
  if (!token) return new Error('Defina GH_TOKEN (no .env ou nas variáveis do sistema) antes de publicar.');

  // ⚙️ Dono/Repo agora têm fallback; só avisa se vazio por algum motivo
  if (!DEFAULT_OWNER || !DEFAULT_REPO) {
    return new Error('Owner/Repo não definidos. Ajuste DEFAULT_OWNER/DEFAULT_REPO em publisher.js.');
  }
  return null;
}

function resolveNpxCommand() {
  const nodeDir = path.dirname(process.execPath);
  const npxBinary = process.platform === 'win32' ? path.join(nodeDir, 'npx.cmd') : path.join(nodeDir, 'npx');
  if (fs.existsSync(npxBinary)) return { command: npxBinary, extraArgs: [] };
  try {
    const npxCli = require.resolve('npm/bin/npx-cli.js');
    return { command: process.execPath, extraArgs: [npxCli] };
  } catch {
    const fallback = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    appendLog(`Aviso: npx não encontrado em ${npxBinary}, usando fallback "${fallback}".`);
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
