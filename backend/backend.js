const crypto = require('crypto');
const pool = require('./db');
const bcrypt = require('bcrypt');
const { ensureFotoUsuarioColumn } = require('./fotoUsuarioBytea');
const { sendEmailConfirmationRequest } = require('../src/email/sendEmailConfirmationRequest');
const { registrarUltimaEntrada } = require('./userActivity');
const { formatarUsuario: formatarUsuarioResposta } = require('./usuariosController');

const DEFAULT_PUBLIC_API_BASE_URL =
  process.env.AVATAR_PUBLIC_BASE_URL ||
  process.env.API_PUBLIC_BASE_URL ||
  process.env.API_BASE_URL ||
  null;
const DEFAULT_DATABASE_PORT = (() => {
  const configured = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432;
  return Number.isFinite(configured) ? String(configured) : '5432';
})();

const DEBUG_ENABLED =
  typeof process.env.DEBUG === 'string' && process.env.DEBUG.toLowerCase() === 'true';
const DEFAULT_NOT_READY_RETRY_MS = 1_000;
const DEFAULT_DB_WAIT_OPTIONS = {
  timeoutMs: 4_000,
  pingTimeoutMs: 1_200,
  pollIntervalMs: 120
};

function debugLogAuth(message, metadata) {
  if (!DEBUG_ENABLED) return;
  if (metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0) {
    console.debug(`[auth] ${message}`, metadata);
  } else {
    console.debug(`[auth] ${message}`);
  }
}

function normalizeNotReadyError(err) {
  const error = err instanceof Error ? err : new Error('Conectando ao banco...');
  if (!error.code) {
    error.code = 'db-connecting';
  }
  if (!error.reason) {
    error.reason = 'db-connecting';
  }
  const retryAfterNumber = Number(error.retryAfter);
  if (!Number.isFinite(retryAfterNumber) || retryAfterNumber <= 0) {
    let fallback = null;
    if (typeof pool.getStatus === 'function') {
      try {
        const status = pool.getStatus();
        if (status) {
          const candidate = Number(status.retryInMs);
          if (Number.isFinite(candidate) && candidate > 0) {
            fallback = candidate;
          }
        }
      } catch (statusErr) {
        debugLogAuth('Falha ao obter status do pool para retryAfter', {
          message: statusErr?.message
        });
      }
    }
    if (!Number.isFinite(fallback) || fallback <= 0) {
      fallback = DEFAULT_NOT_READY_RETRY_MS;
    }
    error.retryAfter = fallback;
  }
  return error;
}

// Track failed PIN attempts across session
let pinErrorAttempts = 0;
let lastDatabaseInitPin = null;

function ensureDatabaseReady(pin, credentials) {
  const sanitizedPin = typeof pin === 'string' ? pin.trim() : pin;
  const normalizedPin =
    typeof sanitizedPin === 'string'
      ? sanitizedPin
      : sanitizedPin !== null && sanitizedPin !== undefined
        ? String(sanitizedPin)
        : '';
  if (/^\d+$/.test(normalizedPin) && normalizedPin !== DEFAULT_DATABASE_PORT) {
    lastDatabaseInitPin = normalizedPin;
  } else {
    lastDatabaseInitPin = null;
  }
  const sanitizedCredentials =
    credentials && typeof credentials === 'object'
      ? {
          login: typeof credentials.login === 'string' ? credentials.login.trim() : credentials.login,
          password: credentials.password,
          pin: sanitizedPin
        }
      : { pin: sanitizedPin };
  pool.init(sanitizedCredentials);
  const hasEnsureWarmup = Object.prototype.hasOwnProperty.call(pool, 'ensureWarmup');
  const hasGetStatus = Object.prototype.hasOwnProperty.call(pool, 'getStatus');
  if (hasEnsureWarmup && typeof pool.ensureWarmup === 'function') {
    pool.ensureWarmup();
  }
  const hasIsReady = Object.prototype.hasOwnProperty.call(pool, 'isReady');
  const hasCreateNotReadyError = Object.prototype.hasOwnProperty.call(pool, 'createNotReadyError');
  if (hasIsReady && hasCreateNotReadyError && typeof pool.isReady === 'function') {
    if (!pool.isReady()) {
      let status = null;
      if (hasGetStatus && typeof pool.getStatus === 'function') {
        try {
          status = pool.getStatus();
        } catch (statusErr) {
          console.error('Falha ao obter status do pool:', statusErr);
        }
      }
      if (status && status.lastError) {
        const errorMessage = status.lastError.message || 'Conectando ao banco...';
        const detailedError = new Error(errorMessage);
        detailedError.code = status.lastError.code || 'db-connecting';
        const retryAfter = Number(status.retryInMs ?? 0);
        if (!Number.isNaN(retryAfter)) {
          detailedError.retryAfter = Math.max(retryAfter, 0);
        }
        const lastErrorReason = status.lastError.reason || status.lastError.code;
        if (lastErrorReason) {
          detailedError.reason = lastErrorReason;
        }
        if (isPinError(detailedError)) {
          detailedError.reason = 'pin';
        } else if (isNetworkError(detailedError)) {
          detailedError.reason = 'offline';
        } else if (!detailedError.reason) {
          detailedError.reason = 'db-connecting';
        }
        throw detailedError;
      }
      if (typeof pool.createNotReadyError === 'function') {
        throw normalizeNotReadyError(pool.createNotReadyError());
      }
      throw normalizeNotReadyError(new Error('Conectando ao banco...'));
    }
  }
}

async function waitForDatabaseReady(pin, credentials, options = {}) {
  const mergedOptions = { ...DEFAULT_DB_WAIT_OPTIONS, ...(options || {}) };
  const timeoutMs = Number.isFinite(mergedOptions.timeoutMs)
    ? Math.max(0, mergedOptions.timeoutMs)
    : DEFAULT_DB_WAIT_OPTIONS.timeoutMs;
  const pingTimeoutMs = Number.isFinite(mergedOptions.pingTimeoutMs)
    ? Math.max(100, mergedOptions.pingTimeoutMs)
    : DEFAULT_DB_WAIT_OPTIONS.pingTimeoutMs;
  const pollIntervalMs = Number.isFinite(mergedOptions.pollIntervalMs)
    ? Math.max(50, mergedOptions.pollIntervalMs)
    : DEFAULT_DB_WAIT_OPTIONS.pollIntervalMs;

  const hasTimeout = timeoutMs > 0;
  const start = Date.now();
  let attempt = 0;
  let lastError = null;
  let loggedWaitStart = false;

  while (true) {
    attempt += 1;
    try {
      ensureDatabaseReady(pin, credentials);
      if (typeof pool.isReady !== 'function' || pool.isReady()) {
        if (loggedWaitStart) {
          debugLogAuth('Pool do banco pronto após espera', {
            attempts: attempt,
            elapsedMs: Date.now() - start
          });
        }
        return;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const reason = typeof error.reason === 'string'
        ? error.reason.toLowerCase()
        : error.code === 'db-connecting'
          ? 'db-connecting'
          : '';
      if (reason !== 'db-connecting') {
        throw error;
      }
      lastError = error;
      if (!loggedWaitStart) {
        loggedWaitStart = true;
        debugLogAuth('Aguardando pool do banco ficar pronto', {
          attempts: attempt,
          elapsedMs: Date.now() - start
        });
      }
    }

    if (typeof pool.isReady !== 'function' || pool.isReady()) {
      if (loggedWaitStart) {
        debugLogAuth('Pool do banco pronto após espera', {
          attempts: attempt,
          elapsedMs: Date.now() - start
        });
      }
      return;
    }

    const elapsed = Date.now() - start;
    if (hasTimeout && elapsed >= timeoutMs) {
      const timeoutError = normalizeNotReadyError(
        lastError || (typeof pool.createNotReadyError === 'function' ? pool.createNotReadyError() : null)
      );
      debugLogAuth('Pool do banco não ficou pronto no tempo limite', {
        attempts: attempt,
        elapsedMs: elapsed,
        timeoutMs
      });
      throw timeoutError;
    }

    const remainingBudget = hasTimeout ? Math.max(timeoutMs - elapsed, 0) : Number.POSITIVE_INFINITY;
    const effectivePingBudget = Number.isFinite(remainingBudget)
      ? Math.max(100, Math.min(pingTimeoutMs, remainingBudget || pingTimeoutMs))
      : pingTimeoutMs;

    if (typeof pool.ping === 'function') {
      const pingOutcome = await Promise.race([
        pool.ping().catch(() => false),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), effectivePingBudget))
      ]);
      if (pingOutcome === true && (typeof pool.isReady !== 'function' || pool.isReady())) {
        if (loggedWaitStart) {
          debugLogAuth('Pool do banco pronto após ping', {
            attempts: attempt,
            elapsedMs: Date.now() - start
          });
        }
        return;
      }
      if (pingOutcome === 'timeout') {
        debugLogAuth('Ping do banco excedeu tempo limite', {
          attempts: attempt,
          elapsedMs: Date.now() - start,
          budgetMs: effectivePingBudget
        });
      }
    }

    const waitBudget = Number.isFinite(remainingBudget)
      ? Math.min(pollIntervalMs, Math.max(remainingBudget, 0))
      : pollIntervalMs;
    if (waitBudget > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitBudget));
    }
  }
}

// Helper to detect errors related to an invalid PIN/port
function isPinError(err) {
  if (!err) return false;
  if (err.reason === 'pin') return true;

  if (err.code === 'ECONNREFUSED' && lastDatabaseInitPin) {
    return true;
  }

  const pinErrorCodes = new Set([
    'ERR_INVALID_ARG_TYPE',
    'ERR_SOCKET_BAD_PORT',
    'ERR_INVALID_PORT'
  ]);
  if (pinErrorCodes.has(err.code)) {
    return true;
  }

  const msg = String(err.message || '').toLowerCase();
  if (!msg) return false;

  if (
    msg.includes('pin incorreto') ||
    msg.includes('pin inválido') ||
    msg.includes('pin invalido') ||
    msg.includes('pin alterado') ||
    msg.includes('invalid pin') ||
    msg.includes('invalid port') ||
    msg.includes('port should') ||
    msg.includes('porta inválida') ||
    msg.includes('porta invalida')
  ) {
    return true;
  }

  if (lastDatabaseInitPin) {
    if (msg.includes('econnrefused') || msg.includes('connection refused')) {
      return true;
    }
  }

  return false;
}

// Helper to detect network connectivity issues
function isNetworkError(err) {
  if (!err) return false;

  if (isPinError(err)) return false;

  const networkCodes = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETUNREACH',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ECONNREFUSED',
    'ETIMEDOUT'
  ]);

  if (networkCodes.has(err.code)) {
    return true;
  }

  const msg = String(err.message || '').toLowerCase();
  if (!msg) return false;

  return (
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('enetworkunreach') ||
    msg.includes('ehostunreach') ||
    msg.includes('getaddrinfo') ||
    msg.includes('ssl connection') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout')
  );
}

async function usuarioExiste(email) {
  const trimmed = (email || '').trim();
  const res = await pool.query(
    'SELECT id FROM usuarios WHERE lower(email) = lower($1)',
    [trimmed]
  );
  return res.rows.length > 0;
}

let ensureUsuariosSchemaPromise = null;

async function ensureUsuariosSchema() {
  if (ensureUsuariosSchemaPromise) return ensureUsuariosSchemaPromise;

  ensureUsuariosSchemaPromise = (async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rowCount: tabelaExiste } = await client.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = 'usuarios'
          LIMIT 1`
      );

      if (!tabelaExiste) {
        await client.query(`
          CREATE TABLE usuarios (
            id SERIAL PRIMARY KEY,
            nome TEXT,
            email TEXT UNIQUE,
            senha TEXT,
            perfil TEXT,
            verificado BOOLEAN DEFAULT false,
            hora_ativacao TIMESTAMPTZ
          )
        `);
      }

      const { rows } = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'usuarios'`
      );
      const colunasInfo = new Map(rows.map(row => [row.column_name, row]));
      const colunas = new Set(colunasInfo.keys());

      const alteracoes = [];

      if (!colunas.has('confirmacao')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN confirmacao BOOLEAN DEFAULT false");
      }
      if (!colunas.has('email_confirmado')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN email_confirmado BOOLEAN DEFAULT false");
      }
      if (!colunas.has('email_confirmado_em')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN email_confirmado_em TIMESTAMPTZ");
      }
      if (!colunas.has('aprovacao_token')) {
        alteracoes.push('ALTER TABLE usuarios ADD COLUMN aprovacao_token TEXT');
      }
      if (!colunas.has('aprovacao_token_gerado_em')) {
        alteracoes.push('ALTER TABLE usuarios ADD COLUMN aprovacao_token_gerado_em TIMESTAMPTZ');
      }
      if (!colunas.has('aprovacao_token_expira_em')) {
        alteracoes.push('ALTER TABLE usuarios ADD COLUMN aprovacao_token_expira_em TIMESTAMPTZ');
      }
      if (!colunas.has('confirmacao_token')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN confirmacao_token TEXT");
      }
      if (!colunas.has('confirmacao_token_gerado_em')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN confirmacao_token_gerado_em TIMESTAMPTZ");
      }
      if (!colunas.has('confirmacao_token_expira_em')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN confirmacao_token_expira_em TIMESTAMPTZ");
      }
      if (!colunas.has('confirmacao_token_revogado_em')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN confirmacao_token_revogado_em TIMESTAMPTZ");
      }
      if (!colunas.has('status')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN status TEXT NOT NULL DEFAULT 'nao_confirmado'");
      }
      if (!colunas.has('status_atualizado_em')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN status_atualizado_em TIMESTAMPTZ");
      }
      if (!colunas.has('foto_mime')) {
        alteracoes.push("ALTER TABLE usuarios ADD COLUMN foto_mime TEXT");
      }

      const fotoResultado = await ensureFotoUsuarioColumn(client, 'usuarios', { createIfMissing: true });
      if (fotoResultado.exists) {
        colunas.add('foto_usuario');
      }

      for (const comando of alteracoes) {
        await client.query(comando);
      }

      const { rowCount: constraintExists } = await client.query(
        `SELECT 1 FROM information_schema.constraint_column_usage
          WHERE table_name = 'usuarios'
            AND constraint_name = 'usuarios_status_check'`
      );

      if (!constraintExists) {
        await client.query(
          "ALTER TABLE usuarios ADD CONSTRAINT usuarios_status_check CHECK (status IN ('nao_confirmado', 'aguardando_aprovacao', 'ativo'))"
        );
      }

      await client.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unq ON usuarios (lower(email))'
      );

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Erro ao executar ROLLBACK após falha na migração de usuarios:', rollbackErr);
      }
      throw err;
    } finally {
      client.release();
    }
  })().catch(err => {
    ensureUsuariosSchemaPromise = null;
    throw err;
  });

  return ensureUsuariosSchemaPromise;
}

// Cadastro de usuário (corrigido)
async function registrarUsuario(nome, email, senha, pin) {
  const senhaCriptografada = await bcrypt.hash(senha, 10);
  try {
    await waitForDatabaseReady(pin);
    await ensureUsuariosSchema();
    if (await usuarioExiste(email)) {
      throw new Error('Usuário já cadastrado');
    }
    const normalized = (email || '').trim().toLowerCase();
    const token = crypto.randomBytes(32).toString('hex');
    const resultado = await pool.query(
      `INSERT INTO usuarios (
          nome,
          email,
          senha,
          verificado,
          status,
          confirmacao,
          confirmacao_token,
          confirmacao_token_gerado_em,
          confirmacao_token_expira_em,
          status_atualizado_em
        )
        VALUES ($1, $2, $3, false, 'nao_confirmado', false, $4, NOW(), NOW() + INTERVAL '48 hours', NOW())
        RETURNING id`,
      [nome, normalized, senhaCriptografada, token]
    );
    try {
      await sendEmailConfirmationRequest({ to: email, nome, token });
    } catch (e) {
      console.error('sendEmailConfirmationRequest error', e);
    }
    pinErrorAttempts = 0; // reset after successful operation
    return resultado.rows[0];
  } catch (err) {
    if (isNetworkError(err)) {
      if (err instanceof Error) {
        err.message = 'Sem conexão com internet';
        err.reason = err.reason || 'offline';
      }
      throw err;
    }
    if (isPinError(err)) {
      pinErrorAttempts += 1;
      if (pinErrorAttempts >= 5) {
        if (err instanceof Error) {
          err.message = 'PIN incorreto, contate Administrador';
        }
      } else if (err instanceof Error) {
        err.message = 'PIN incorreto';
      }
      if (err instanceof Error) {
        err.reason = err.reason || 'pin';
      }
      throw err;
    }
    throw err;
  }
}

// Login de usuário (corrigido)
async function loginUsuario(email, senha, pin) {
  try {
    const credentials = { login: email, password: senha };
    await waitForDatabaseReady(pin, credentials);
    await ensureUsuariosSchema();
    const resultado = await pool.query(
      'SELECT * FROM usuarios WHERE lower(email) = lower($1)',
      [email.trim()]
    );

    const usuario = resultado.rows[0];
    if (!usuario) throw new Error('Usuário não encontrado');

    const statusValor = typeof usuario.status === 'string' ? usuario.status.trim().toLowerCase() : '';
    const possuiVerificado = Object.prototype.hasOwnProperty.call(usuario, 'verificado');
    const verificadoBruto = possuiVerificado ? usuario.verificado : undefined;

    const estaAtivo = () => {
      if (statusValor) {
        return statusValor === 'ativo';
      }
      if (typeof verificadoBruto === 'boolean') return verificadoBruto;
      if (typeof verificadoBruto === 'number') return verificadoBruto === 1;
      if (verificadoBruto === null || verificadoBruto === undefined) return false;
      const normalized = String(verificadoBruto).trim().toLowerCase();
      return ['true', 't', '1', 'ativo', 'active'].includes(normalized);
    };

    if (!estaAtivo()) {
      const mensagens = {
        nao_confirmado: 'Confirme seu e-mail para concluir o cadastro.',
        aguardando_aprovacao: 'Aguarde a aprovação do Sup Admin para acessar o sistema.'
      };
      const error = new Error(mensagens[statusValor] || 'Usuário inativo. Solicite ao administrador a ativação do seu acesso.');
      error.code = 'inactive-user';
      throw error;
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
    if (!senhaCorreta) throw new Error('Senha incorreta');

    pinErrorAttempts = 0; // reset after successful login
    try {
      await registrarUltimaEntrada(usuario.id);
    } catch (err) {
      console.error('Falha ao registrar ultima entrada do usuário:', err);
    }
    let resposta = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil
    };

    if (typeof formatarUsuarioResposta === 'function') {
      try {
        resposta = {
          ...formatarUsuarioResposta(usuario, { baseUrl: DEFAULT_PUBLIC_API_BASE_URL })
        };
      } catch (err) {
        console.error('Falha ao formatar usuário para resposta de login:', err);
      }
    }

    return resposta;
  } catch (err) {
    if (isNetworkError(err)) {
      if (err instanceof Error) {
        err.message = 'Sem conexão com internet';
        err.reason = err.reason || 'offline';
      }
      throw err;
    }
    if (isPinError(err)) {
      pinErrorAttempts += 1;
      if (pinErrorAttempts >= 5) {
        if (err instanceof Error) {
          err.message = 'PIN incorreto, contate Administrador';
        }
      } else if (err instanceof Error) {
        err.message = 'PIN incorreto';
      }
      if (err instanceof Error) {
        err.reason = err.reason || 'pin';
      }
      throw err;
    }
    if (err && err.code === 'auth-failed') {
      if (err instanceof Error) {
        err.message = err.message || 'Falha ao autenticar com as credenciais informadas.';
        err.reason = err.reason || 'user-auth';
      }
      throw err;
    }
    throw err;
  }
}

module.exports = {
  registrarUsuario,
  loginUsuario,
  isPinError,
  isNetworkError,
  ensureDatabaseReady,
  waitForDatabaseReady
};
