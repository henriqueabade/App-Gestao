const crypto = require('crypto');
const pool = require('./db');
const bcrypt = require('bcrypt');
const { sendEmailConfirmationRequest } = require('../src/email/sendEmailConfirmationRequest');
const { registrarUltimaEntrada } = require('./userActivity');

// Track failed PIN attempts across session
let pinErrorAttempts = 0;

// Helper to detect errors related to an invalid PIN/port
function isPinError(err) {
  if (!err) return false;
  const codes = ['ETIMEDOUT', 'ECONNREFUSED'];
  if (codes.includes(err.code)) return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('port should') ||
    msg.includes('invalid port')
  );
}

// Helper to detect network connectivity issues
function isNetworkError(err) {
  if (!err) return false;
  const codes = ['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNRESET'];
  if (codes.includes(err.code)) return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('enetworkunreach') ||
    msg.includes('getaddrinfo') ||
    msg.includes('ssl connection') ||
    msg.includes('econnreset')
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
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'usuarios'`
      );
      const colunas = new Set(rows.map(row => row.column_name));

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
    pool.init(pin);
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
      throw new Error('Sem conexão com internet');
    }
    if (isPinError(err)) {
      pinErrorAttempts += 1;
      if (pinErrorAttempts >= 5) {
        throw new Error('PIN incorreto, contate Administrador');
      }
      throw new Error('PIN incorreto');
    }
    throw err;
  }
}

// Login de usuário (corrigido)
async function loginUsuario(email, senha, pin) {
  try {
    pool.init(pin);
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
    return { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil };
  } catch (err) {
    if (isNetworkError(err)) {
      throw new Error('Sem conexão com internet');
    }
    if (isPinError(err)) {
      pinErrorAttempts += 1;
      if (pinErrorAttempts >= 5) {
        throw new Error('PIN incorreto, contate Administrador');
      }
      throw new Error('PIN incorreto');
    }
    throw err;
  }
}

module.exports = {
  registrarUsuario,
  loginUsuario,
  isPinError,
  isNetworkError
};
