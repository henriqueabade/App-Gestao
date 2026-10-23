// backend/publisher.js
// ✅ Lê GH_TOKEN do .env
// ✅ Não exige OWNER/REPO/SLUG do ambiente (usa valores padrão)
// ✅ Injeta OWNER/REPO/RELEASE_TYPE no spawn para o electron-builder

const { isolamento } = require('./dataConfig');

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { verificarAmbienteParaPublicar } = require('./travaPublicacao');

const emitter = new EventEmitter();
const projectRoot = path.resolve(__dirname, '..');
const envDoProjeto = path.join(projectRoot, '.env');
const logFilePath = path.join(projectRoot, 'publish-audit.log');

let currentProcess = null;

// Emite eventos sem derrubar o processo. Um EventEmitter que emite 'error' SEM
// listener registrado lança a exceção como "uncaught" e mata o processo main
// (foi o que causava o crash "A JavaScript error occurred in the main process").
// O erro real continua sendo propagado pela Promise (reject), então aqui só
// notificamos quem estiver ouvindo.
function safeEmit(event, payload) {
  if (event === 'error' && emitter.listenerCount('error') === 0) {
    return;
  }
  try {
    emitter.emit(event, payload);
  } catch (err) {
    appendLog(`Falha ao emitir evento "${event}": ${err && err.message ? err.message : err}`);
  }
}

// Traduz uma falha do electron-builder em uma mensagem clara e acionável,
// analisando a saída capturada (stdout/stderr).
function describePublishFailure(code, output = '') {
  const text = String(output).toLowerCase();
  if (text.includes('bad credentials') || text.includes('401') || text.includes('unauthorized')) {
    return 'Token do GitHub inválido ou expirado (401 - Bad credentials). Atualize o GH_TOKEN no arquivo .env com um token válido (com escopo "repo") e tente novamente.';
  }
  if (text.includes('403') || text.includes('forbidden') || text.includes('resource not accessible')) {
    return 'Sem permissão para publicar releases (403). Se o GH_TOKEN for fine-grained, conceda a permissão "Contents: Read and write" (é ela que libera Releases). Alternativa mais simples: use um token classic com o escopo "repo".';
  }
  if (text.includes('404') || text.includes('not found')) {
    return 'Repositório de publicação não encontrado (404). Confira OWNER/REPO e as permissões do GH_TOKEN.';
  }
  if (text.includes('enotfound') || text.includes('etimedout') || text.includes('econnrefused') || text.includes('getaddrinfo') || text.includes('network')) {
    return 'Falha de rede ao publicar no GitHub. Verifique sua conexão com a internet e tente novamente.';
  }
  return `Publicação finalizada com código ${code}. Consulte o arquivo publish-audit.log para detalhes.`;
}

// 🔧 AJUSTE AQUI SE PRECISAR:
const DEFAULT_OWNER = process.env.ELECTRON_PUBLISH_GITHUB_OWNER || 'henriqueabade';
const DEFAULT_REPO  = process.env.ELECTRON_PUBLISH_GITHUB_REPO  || 'App-Gestao';
const DEFAULT_RELEASE_TYPE = process.env.ELECTRON_PUBLISH_GITHUB_RELEASE_TYPE || 'draft';

// Lê o GH_TOKEN diretamente do arquivo .env no momento da publicação.
// Necessário porque o dotenv só carrega no início do processo e NÃO sobrescreve
// process.env: sem isto, atualizar o token no .env não teria efeito enquanto o
// app estivesse aberto (era a causa do 401 persistir após trocar o token).
function getFreshGithubToken(envPath = envDoProjeto) {
  try {
    if (fs.existsSync(envPath)) {
      const parsed = require('dotenv').parse(fs.readFileSync(envPath));
      const fromFile = (parsed.GH_TOKEN || '').trim();
      if (fromFile) return fromFile;
    }
  } catch (err) {
    appendLog(`Não foi possível reler o .env para o token: ${err && err.message ? err.message : err}`);
  }
  return (process.env.GH_TOKEN || '').trim();
}

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

function createPublishProgressTracker(callback) {
  let progress = 1;
  const report = (next, message) => {
    progress = Math.max(progress, Math.min(99, Math.round(next)));
    if (typeof callback === 'function') callback({ message, progress });
  };
  const consume = message => {
    const text = String(message || '').toLowerCase();
    const explicit = text.match(/(?:progress|upload(?:ing)?)[^\d]{0,24}(\d{1,3}(?:\.\d+)?)\s*%/i);
    if (explicit) {
      report(55 + Math.min(100, Number(explicit[1])) * 0.43, message);
    } else if (text.includes('packaging')) report(20, message);
    else if (text.includes('building block map')) report(48, message);
    else if (text.includes('building target')) report(38, message);
    else if (text.includes('publish') || text.includes('upload')) report(55, message);
    else report(Math.min(progress + 1, 18), message);
  };
  return { report, consume, getProgress: () => progress };
}

async function runPublishPipeline(options = {}) {
  if (currentProcess) throw new Error('Já existe uma publicação em andamento.');

  // `caminhoEnv` só muda nos testes (um .env temporário); o padrão é o do projeto.
  const { user, onProgress, version, caminhoEnv = envDoProjeto } = options;
  const tracker = createPublishProgressTracker(onProgress);
  const requester = user ? `${user.nome || user.email || user.id || 'usuário desconhecido'}` : 'usuário desconhecido';
  const versionSuffix = version ? ` (versão ${version})` : '';
  appendLog(`Publicação iniciada por ${requester}${versionSuffix}`);

  // Ambiente (programa em DEV/isolado, .env em DEV), GH_TOKEN e owner/repo —
  // nessa ordem, antes de qualquer acesso à rede ou subprocesso.
  const validationError = validatePublishEnvironment(caminhoEnv);
  if (validationError) {
    appendLog(`Validação de ambiente falhou: ${validationError.message}`);
    safeEmit('error', validationError);
    throw validationError;
  }
  tracker.report(5, 'Ambiente de publicação validado.');

  // Pré-checagem do token no GitHub: falha rápido com mensagem clara, sem
  // esperar todo o empacotamento para só então descobrir credencial inválida.
  const tokenError = await verificarTokenGithub(caminhoEnv);
  if (tokenError) {
    appendLog(`Pré-checagem do GitHub falhou: ${tokenError.message}`);
    safeEmit('error', tokenError);
    throw tokenError;
  }
  tracker.report(10, 'Acesso ao repositório validado.');

  return new Promise((resolve, reject) => {
    // Acumula a saída recente para diagnosticar a causa em caso de falha.
    let outputBuffer = '';
    const appendOutput = text => {
      outputBuffer += text;
      if (outputBuffer.length > 20000) {
        outputBuffer = outputBuffer.slice(-20000);
      }
    };

    try {
      const builder = resolverElectronBuilder();

      const freshToken = getFreshGithubToken(caminhoEnv);
      const child = spawn(builder.command, [...builder.args, '--config', 'electron-builder.config.js', '--publish', 'always'], {
        cwd: projectRoot,
        windowsHide: true,
        env: {
          ...process.env,
          ...builder.env,
          // ✅ usa o token ATUAL do .env (electron-builder aceita GH_TOKEN e GITHUB_TOKEN)
          GH_TOKEN: freshToken,
          GITHUB_TOKEN: freshToken,
          TARGET_VERSION: version || process.env.TARGET_VERSION,
          // ✅ injeta fallback seguro pro electron-builder
          ELECTRON_PUBLISH_GITHUB_OWNER: DEFAULT_OWNER,
          ELECTRON_PUBLISH_GITHUB_REPO: DEFAULT_REPO,
          ELECTRON_PUBLISH_GITHUB_RELEASE_TYPE: DEFAULT_RELEASE_TYPE
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      currentProcess = child;
      tracker.report(15, 'Preparando arquivos da atualização.');

      child.stdout.on('data', data => {
        const text = data.toString();
        appendOutput(text);
        notifyProgress(text, 'stdout', onProgress);
        tracker.consume(text);
        appendLog(`stdout: ${text.trimEnd()}`);
      });

      child.stderr.on('data', data => {
        const text = data.toString();
        appendOutput(text);
        notifyProgress(text, 'stderr', onProgress);
        tracker.consume(text);
        appendLog(`stderr: ${text.trimEnd()}`);
      });

      child.on('error', err => {
        currentProcess = null;
        appendLog(`Erro ao iniciar publicação: ${err.message}`);
        safeEmit('error', err);
        reject(err);
      });

      child.on('close', code => {
        currentProcess = null;
        if (code === 0) {
          appendLog('Publicação concluída com sucesso.');
          safeEmit('done', { code });
          resolve({ code });
        } else {
          const message = describePublishFailure(code, outputBuffer);
          const err = new Error(message);
          err.code = 'publish-failed';
          err.exitCode = code;
          appendLog(message);
          safeEmit('error', err);
          reject(err);
        }
      });
    } catch (err) {
      currentProcess = null;
      appendLog(`Falha inesperada na publicação: ${err.message}`);
      safeEmit('error', err);
      reject(err);
    }
  });
}

// Verifica o GH_TOKEN contra a API do GitHub antes de empacotar. Retorna um
// Error se o token for definitivamente inválido/sem permissão; retorna null se
// estiver ok OU se não for possível checar (rede indisponível) — nesse caso a
// publicação segue e, se falhar, a saída do electron-builder é analisada.
function verificarTokenGithub(caminhoEnv = envDoProjeto) {
  const token = getFreshGithubToken(caminhoEnv);
  if (!token) return Promise.resolve(null); // já tratado em validatePublishEnvironment

  const https = require('https');
  return new Promise(resolve => {
    let finished = false;
    const finish = value => { if (!finished) { finished = true; resolve(value); } };

    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${DEFAULT_OWNER}/${DEFAULT_REPO}/releases?per_page=1`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'App-Gestao-Publisher',
          Accept: 'application/vnd.github+json'
        }
      },
      res => {
        const status = res.statusCode;
        res.resume(); // drena a resposta
        if (status === 401) {
          finish(new Error('Token do GitHub inválido ou expirado (401 - Bad credentials). Atualize o GH_TOKEN no arquivo .env com um token válido (escopo "repo") e tente novamente.'));
        } else if (status === 403) {
          finish(new Error('Sem permissão para publicar releases (403 - "Resource not accessible by personal access token"). Se o GH_TOKEN for fine-grained, conceda a permissão "Contents: Read and write" (é ela que libera Releases). Alternativa: use um token classic com escopo "repo".'));
        } else if (status === 404) {
          finish(new Error(`Repositório ${DEFAULT_OWNER}/${DEFAULT_REPO} não encontrado ou sem acesso (404). Confira OWNER/REPO e as permissões do GH_TOKEN.`));
        } else {
          finish(null); // 2xx ou outro status não bloqueante
        }
      }
    );
    // Rede indisponível ou timeout: não bloqueia a publicação (retorna null).
    req.on('error', () => finish(null));
    req.setTimeout(8000, () => { req.destroy(); finish(null); });
    req.end();
  });
}

/**
 * O que impede publicar NESTE programa: rodando em DEV (BANCO=DEV no ambiente,
 * mesmo com o .env em PROD), máquina DEV isolada, ou o .env em DEV. `null` se
 * pode. O main.js chama antes de gravar a versão; a publicação chama de novo.
 */
function verificarAmbienteDePublicacao(caminhoEnv = envDoProjeto) {
  return verificarAmbienteParaPublicar({ env: process.env, caminhoEnv, isolado: Boolean(isolamento && isolamento.ativo) });
}

function validatePublishEnvironment(caminhoEnv = envDoProjeto) {
  // 🔒 PRIMEIRO o ambiente e o banco. O .env vai dentro do instalador, e com
  // BANCO=DEV todos os clientes ficariam sem sistema. Antes do token de
  // propósito: nem vale a pena conferir credencial de uma publicação que não
  // pode acontecer.
  const ambienteBloqueia = verificarAmbienteDePublicacao(caminhoEnv);
  if (ambienteBloqueia) return ambienteBloqueia;

  // 🔒 GH_TOKEN (lido direto do .env, sempre atual)
  const token = getFreshGithubToken(caminhoEnv);
  if (!token) return new Error('Defina GH_TOKEN (no .env ou nas variáveis do sistema) antes de publicar.');

  // ⚙️ Dono/Repo agora têm fallback; só avisa se vazio por algum motivo
  if (!DEFAULT_OWNER || !DEFAULT_REPO) {
    return new Error('Owner/Repo não definidos. Ajuste DEFAULT_OWNER/DEFAULT_REPO em publisher.js.');
  }
  return null;
}

/** O node.exe (ou node) do PATH, pelo caminho absoluto; null se não houver. */
function acharNodeNoPath(env = process.env) {
  const nome = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const pasta of String(env.PATH || '').split(path.delimiter)) {
    const limpa = pasta.trim().replace(/^"(.*)"$/, '$1');
    if (!limpa) continue;
    const candidato = path.join(limpa, nome);
    try {
      if (fs.statSync(candidato).isFile()) return candidato;
    } catch (_) { /* não está nesta pasta */ }
  }
  return null;
}

/**
 * Como rodar o electron-builder: o `cli.js` do pacote (campo "bin") com o
 * Node.js de verdade — o do PATH, o mesmo do `npm ci` e que o `npx` usava —,
 * pelo caminho absoluto e SEM shell: os argumentos vão como lista, nada passa
 * pelo cmd.exe. Nos testes (rodando no próprio node) é o executável atual.
 *
 * Antes era `npx.cmd` sem shell. Desde o Node 18.20.2/20.12.2 (CVE-2024-27980)
 * o Windows recusa .cmd/.bat em spawn sem shell: "spawn EINVAL" no Electron 45
 * (Node 24); no Electron 28 (Node 18.18.2) ainda passava. E o Electron no modo
 * Node (ELECTRON_RUN_AS_NODE) não serve: o yargs do electron-builder vê
 * `process.versions.electron`, acha que está num app empacotado e lê o próprio
 * cli.js como argumento ("Unknown argument").
 */
function resolverElectronBuilder() {
  const pacote = require.resolve('electron-builder/package.json', { paths: [projectRoot] });
  const { bin } = JSON.parse(fs.readFileSync(pacote, 'utf8'));
  const relativo = typeof bin === 'string' ? bin : bin && bin['electron-builder'];
  if (!relativo) throw new Error('O electron-builder instalado não declara o executável "electron-builder" (campo bin).');
  const cli = path.resolve(path.dirname(pacote), relativo);
  if (!fs.existsSync(cli)) throw new Error(`Executável do electron-builder não encontrado: ${cli}. Rode npm ci.`);
  const node = process.versions.electron ? acharNodeNoPath() : process.execPath;
  if (!node) {
    throw new Error('Node.js não encontrado no PATH. A publicação roda o electron-builder com o Node (o mesmo do npm ci): instale o Node LTS e abra o programa de novo.');
  }
  return { command: node, args: [cli], env: {} };
}

function isPublishing() {
  return Boolean(currentProcess);
}

module.exports = {
  runPublishPipeline,
  isPublishing,
  createPublishProgressTracker,
  verificarAmbienteDePublicacao,
  resolverElectronBuilder,
  describePublishFailure,
  on: emitter.on.bind(emitter),
  once: emitter.once.bind(emitter),
  off: emitter.off ? emitter.off.bind(emitter) : emitter.removeListener.bind(emitter)
};
