const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('./db');
const { sendSupAdminReviewNotification } = require('../src/email/sendSupAdminReviewNotification');
const { sendUserActivationNotice } = require('../src/email/sendUserActivationNotice');
const { sendEmailChangeConfirmation } = require('../src/email/sendEmailChangeConfirmation');

const router = express.Router();

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const EMAIL_CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000;
let multer = null;
let MulterError = null;
let upload = null;

try {
  // Carregamento lazy para que o aplicativo possa iniciar mesmo sem a
  // dependência instalada (ex.: builds antigas).
  // eslint-disable-next-line global-require
  multer = require('multer');
  MulterError = multer.MulterError;
  upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_SIZE }
  });
} catch (err) {
  console.warn('Multer não está disponível. Usando analisador multipart simplificado.', err);
  MulterError = class SimpleMulterError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'MulterError';
      this.code = code;
    }
  };
  upload = createFallbackUpload();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && value.constructor === Object;
}

function extractBoundary(contentType) {
  if (typeof contentType !== 'string') {
    return null;
  }

  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    return null;
  }

  return match[1] || match[2];
}

function parseMultipartBody(buffer, boundary) {
  const boundaryText = `--${boundary}`;
  const raw = buffer.toString('latin1');
  const segments = raw.split(boundaryText);
  const fields = {};
  const files = {};

  for (const segment of segments) {
    if (!segment) continue;

    let working = segment;
    if (working.startsWith('\r\n')) {
      working = working.slice(2);
    }

    working = working.trimEnd();
    if (!working || working === '--') {
      continue;
    }

    const headerEndIndex = working.indexOf('\r\n\r\n');
    if (headerEndIndex === -1) {
      continue;
    }

    const headerBlock = working.slice(0, headerEndIndex);
    let bodyPart = working.slice(headerEndIndex + 4);

    if (bodyPart.endsWith('\r\n')) {
      bodyPart = bodyPart.slice(0, -2);
    }

    const headers = headerBlock.split('\r\n');
    let fieldName = null;
    let filename = null;
    let contentType = 'application/octet-stream';

    for (const header of headers) {
      const [rawKey, ...rawRest] = header.split(':');
      if (!rawKey || !rawRest.length) continue;
      const key = rawKey.trim().toLowerCase();
      const value = rawRest.join(':').trim();

      if (key === 'content-disposition') {
        const parts = value.split(';').map(part => part.trim());
        for (const part of parts) {
          if (part.startsWith('name=')) {
            fieldName = part.slice(5).replace(/^"|"$/g, '');
          } else if (part.startsWith('filename=')) {
            filename = part.slice(9).replace(/^"|"$/g, '');
          }
        }
      } else if (key === 'content-type') {
        contentType = value;
      }
    }

    if (!fieldName) {
      continue;
    }

    const bodyBuffer = Buffer.from(bodyPart, 'latin1');

    if (filename !== null) {
      files[fieldName] = {
        filename: filename || 'file',
        contentType,
        data: bodyBuffer
      };
    } else {
      const value = bodyBuffer.toString('utf8');
      if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
        const existing = fields[fieldName];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          fields[fieldName] = [existing, value];
        }
      } else {
        fields[fieldName] = value;
      }
    }
  }

  return { fields, files };
}

function createFallbackUpload() {
  return {
    single(fieldName) {
      return (req, res, next) => {
        const boundary = extractBoundary(req.headers['content-type']);
        if (!boundary) {
          return next(new Error('Formato multipart inválido: boundary ausente.'));
        }

        const chunks = [];
        let hasError = false;

        const cleanup = () => {
          req.removeListener('data', onData);
          req.removeListener('end', onEnd);
          req.removeListener('error', onError);
          req.removeListener('aborted', onAborted);
        };

        const onError = err => {
          if (hasError) return;
          hasError = true;
          cleanup();
          next(err);
        };

        const onAborted = () => {
          if (hasError) return;
          hasError = true;
          cleanup();
          next(new Error('Requisição abortada durante upload.'));
        };

        const onData = chunk => {
          chunks.push(chunk);
        };

        const onEnd = () => {
          if (hasError) return;
          cleanup();

          try {
            const buffer = Buffer.concat(chunks);
            const { fields, files } = parseMultipartBody(buffer, boundary);

            const baseBody = isPlainObject(req.body) ? req.body : {};
            req.body = { ...baseBody, ...fields };

            const file = files[fieldName];
            if (file) {
              if (file.data.length > MAX_IMAGE_SIZE) {
                throw new MulterError('LIMIT_FILE_SIZE', 'File too large');
              }

              req.file = {
                fieldname: fieldName,
                originalname: file.filename,
                mimetype: file.contentType,
                buffer: file.data,
                size: file.data.length
              };
            } else {
              req.file = undefined;
            }

            next();
          } catch (err) {
            hasError = true;
            next(err);
          }
        };

        req.on('data', onData);
        req.once('end', onEnd);
        req.once('error', onError);
        req.once('aborted', onAborted);
      };
    }
  };
}

let usuarioColunasCache = null;
let loginCacheMeta = null;
let emailChangeTableEnsured = false;

const telefoneColunasPreferidas = ['telefone', 'telefone_usuario', 'telefone_principal'];
const celularColunasPreferidas = ['telefone_celular', 'celular', 'celular_usuario'];
const whatsappColunasPreferidas = ['whatsapp', 'whatsapp_usuario'];

function parsePositiveInteger(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }
  return null;
}

function extrairUsuarioId(req) {
  const headerCandidates = [
    req.headers['x-usuario-id'],
    req.headers['x-user-id'],
    req.headers['x-usuario'],
    req.headers['x-user']
  ];

  for (const candidate of headerCandidates) {
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    const parsed = parsePositiveInteger(value);
    if (parsed) {
      return parsed;
    }
  }

  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    const match = token.match(/(\d+)/);
    if (match) {
      const parsed = parsePositiveInteger(match[1]);
      if (parsed) {
        return parsed;
      }
    }
  }

  if (req.body && typeof req.body === 'object' && req.body !== null) {
    const candidate = parsePositiveInteger(req.body.usuarioId ?? req.body.userId);
    if (candidate) return candidate;
  }

  if (req.query && typeof req.query === 'object' && req.query !== null) {
    const candidate = parsePositiveInteger(req.query.usuarioId ?? req.query.userId);
    if (candidate) return candidate;
  }

  return null;
}

function autenticarUsuario(req, res, next) {
  const usuarioId = extrairUsuarioId(req);
  if (!usuarioId) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }
  req.usuarioAutenticadoId = usuarioId;
  return next();
}

function shouldParseMultipart(req) {
  const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : '';
  return contentType.includes('multipart/form-data');
}

function parseMultipartIfNeeded(req, res, next) {
  if (!shouldParseMultipart(req)) {
    return next();
  }

  return upload.single('foto')(req, res, err => {
    if (!err) {
      return next();
    }

    if (MulterError && err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Foto de perfil deve ter no máximo 2 MB.' });
    }

    console.error('Falha ao processar upload multipart:', err);
    return res.status(400).json({ error: 'Não foi possível processar o upload da foto.' });
  });
}

async function getUsuarioColumns() {
  if (usuarioColunasCache) {
    return usuarioColunasCache;
  }

  try {
    const { rows } = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'usuarios'`
    );
    usuarioColunasCache = new Set(rows.map(row => row.column_name));
  } catch (err) {
    console.error('Falha ao carregar metadados de colunas da tabela usuarios:', err);
    usuarioColunasCache = new Set();
  }

  return usuarioColunasCache;
}

async function getLoginCacheMeta() {
  if (loginCacheMeta) {
    return loginCacheMeta;
  }

  try {
    const { rows } = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'usuarios_login_cache'`
    );

    if (!rows.length) {
      loginCacheMeta = { exists: false, columns: new Set() };
    } else {
      loginCacheMeta = { exists: true, columns: new Set(rows.map(row => row.column_name)) };
    }
  } catch (err) {
    console.error('Falha ao carregar metadados da tabela usuarios_login_cache:', err);
    loginCacheMeta = { exists: false, columns: new Set() };
  }

  return loginCacheMeta;
}

async function ensureEmailChangeTable() {
  if (emailChangeTableEnsured) {
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios_confirmacoes_email (
        id serial PRIMARY KEY,
        usuario_id integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        email text NOT NULL,
        token text,
        expira_em timestamptz NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT NOW(),
        confirmado_em timestamptz,
        cancelado_em timestamptz
      )
    `);
    try {
      await pool.query('ALTER TABLE usuarios_confirmacoes_email ALTER COLUMN token DROP NOT NULL');
    } catch (err) {
      /* ignore constraint change failures */
    }
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS usuarios_confirmacoes_email_usuario_idx ON usuarios_confirmacoes_email (usuario_id)'
    );
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS usuarios_confirmacoes_email_token_idx ON usuarios_confirmacoes_email (token)'
    );
    emailChangeTableEnsured = true;
  } catch (err) {
    console.error('Falha ao garantir tabela de confirmações de e-mail:', err);
    throw err;
  }
}

function extrairPrimeiroValor(row, colunas) {
  if (!row || !colunas || !colunas.length) return undefined;
  for (const coluna of colunas) {
    if (Object.prototype.hasOwnProperty.call(row, coluna)) {
      return row[coluna];
    }
  }
  return undefined;
}

function getFirstDefined(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

function findAvailableColumn(columns, candidates) {
  if (!columns || !candidates) return null;
  for (const candidate of candidates) {
    if (columns.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function sanitizeNome(valor) {
  if (valor === undefined) return undefined;
  if (valor === null) {
    throw new Error('Nome não pode ser vazio.');
  }
  if (typeof valor !== 'string') {
    throw new Error('Nome deve ser uma string.');
  }
  const trimmed = valor.trim();
  if (!trimmed) {
    throw new Error('Nome não pode ser vazio.');
  }
  if (trimmed.length > 120) {
    throw new Error('Nome deve ter no máximo 120 caracteres.');
  }
  return trimmed;
}

function sanitizeTelefone(valor, label) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== 'string') {
    throw new Error(`${label} deve ser uma string.`);
  }
  const trimmed = valor.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return null;
  }
  if (trimmed.length > 60) {
    throw new Error(`${label} deve ter no máximo 60 caracteres.`);
  }
  if (!/^[-+()\d\s]+$/.test(trimmed)) {
    throw new Error(`${label} possui caracteres inválidos.`);
  }
  return trimmed.replace(/\s+/g, ' ').trim();
}

function sanitizeOptionalString(valor, label, maxLength = 120) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== 'string') {
    throw new Error(`${label} deve ser uma string.`);
  }
  const trimmed = valor.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} deve ter no máximo ${maxLength} caracteres.`);
  }
  return trimmed;
}

function sanitizeEmail(valor) {
  if (valor === undefined || valor === null) {
    throw new Error('Informe o e-mail desejado.');
  }
  if (typeof valor !== 'string') {
    throw new Error('E-mail deve ser uma string.');
  }
  const trimmed = valor.trim();
  if (!trimmed) {
    throw new Error('Informe o e-mail desejado.');
  }
  const normalized = trimmed.toLowerCase();
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regex.test(normalized)) {
    throw new Error('E-mail inválido.');
  }
  return normalized;
}

function parseBoolean(valor) {
  if (valor === undefined) return false;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return valor !== 0;
  if (typeof valor === 'string') {
    const normalized = valor.trim().toLowerCase();
    return ['1', 'true', 'sim', 'yes', 'y'].includes(normalized);
  }
  return false;
}

function parseBase64Image(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const dataUrlMatch = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(trimmed);
  let base64Content = trimmed;
  if (dataUrlMatch) {
    base64Content = dataUrlMatch[2];
  }
  const sanitized = base64Content.replace(/\s+/g, '');
  if (!sanitized) return null;
  try {
    const buffer = Buffer.from(sanitized, 'base64');
    if (!buffer || !buffer.length) {
      return null;
    }
    return buffer;
  } catch (err) {
    return null;
  }
}

async function carregarUsuarioRaw(id) {
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
  return rows[0] || null;
}

function normalizarFotoParaResposta(valor) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (Buffer.isBuffer(valor)) {
    return valor.length ? valor.toString('base64') : null;
  }
  if (valor instanceof Uint8Array) {
    const buffer = Buffer.from(valor);
    return buffer.length ? buffer.toString('base64') : null;
  }
  if (typeof valor === 'string') {
    const trimmed = valor.trim();
    return trimmed || null;
  }
  return null;
}

async function atualizarCacheLogin(usuarioId, usuarioRow) {
  if (!usuarioId || !usuarioRow) return false;
  const meta = await getLoginCacheMeta();
  if (!meta.exists || !meta.columns.has('usuario_id')) {
    return false;
  }

  const colunas = meta.columns;
  const valores = [usuarioId];
  const nomes = ['usuario_id'];
  const placeholders = ['$1'];

  const adicionarCampo = (coluna, valor) => {
    if (!colunas.has(coluna)) return;
    valores.push(valor === undefined ? null : valor);
    nomes.push(coluna);
    placeholders.push(`$${valores.length}`);
  };

  adicionarCampo('nome', usuarioRow.nome ?? null);
  adicionarCampo('email', usuarioRow.email ?? null);
  adicionarCampo('perfil', usuarioRow.perfil ?? null);

  if (colunas.has('telefone')) {
    adicionarCampo('telefone', extrairPrimeiroValor(usuarioRow, telefoneColunasPreferidas) ?? null);
  }
  if (colunas.has('telefone_celular')) {
    adicionarCampo('telefone_celular', extrairPrimeiroValor(usuarioRow, celularColunasPreferidas) ?? null);
  }
  if (colunas.has('whatsapp')) {
    adicionarCampo('whatsapp', extrairPrimeiroValor(usuarioRow, whatsappColunasPreferidas) ?? null);
  }

  if (colunas.has('foto_usuario')) {
    const origem = extrairPrimeiroValor(usuarioRow, ['foto_usuario', 'foto', 'avatar', 'avatar_url']);
    let fotoBuffer = null;
    if (Buffer.isBuffer(origem)) {
      fotoBuffer = origem;
    } else if (origem instanceof Uint8Array) {
      fotoBuffer = Buffer.from(origem);
    } else if (typeof origem === 'string') {
      const trimmed = origem.trim();
      if (trimmed) {
        const conteudo = trimmed.includes(',') ? trimmed.slice(trimmed.indexOf(',') + 1) : trimmed;
        try {
          fotoBuffer = Buffer.from(conteudo, 'base64');
        } catch (err) {
          fotoBuffer = null;
        }
      }
    }
    adicionarCampo('foto_usuario', fotoBuffer);
  }

  if (colunas.has('atualizado_em')) {
    adicionarCampo('atualizado_em', new Date());
  }

  try {
    await pool.query('DELETE FROM usuarios_login_cache WHERE usuario_id = $1', [usuarioId]);
  } catch (err) {
    console.error('Falha ao limpar cache de login do usuário:', err);
  }

  try {
    await pool.query(
      `INSERT INTO usuarios_login_cache (${nomes.join(', ')}) VALUES (${placeholders.join(', ')})`,
      valores
    );
    return true;
  } catch (err) {
    console.error('Falha ao atualizar cache de login do usuário:', err);
    return false;
  }
}

function formatarUsuarioDetalhado(row) {
  if (!row) return null;
  const base = formatarUsuario(row);
  const resultado = { ...base };

  const telefone = extrairPrimeiroValor(row, telefoneColunasPreferidas);
  if (telefone !== undefined) {
    resultado.telefone = telefone;
  }

  const celular = extrairPrimeiroValor(row, celularColunasPreferidas);
  if (celular !== undefined) {
    resultado.celular = celular;
  }

  const whatsapp = extrairPrimeiroValor(row, whatsappColunasPreferidas);
  if (whatsapp !== undefined) {
    resultado.whatsapp = whatsapp;
  }

  const foto = normalizarFotoParaResposta(extrairPrimeiroValor(row, ['foto_usuario', 'foto', 'avatar', 'avatar_url']));
  if (foto !== undefined) {
    resultado.fotoUsuario = foto;
    resultado.foto_usuario = foto;
  }

  if (Object.prototype.hasOwnProperty.call(row, 'descricao')) {
    resultado.descricao = row.descricao;
  }

  return resultado;
}

router.get('/me', autenticarUsuario, async (req, res) => {
  try {
    const usuario = await carregarUsuarioRaw(req.usuarioAutenticadoId);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    return res.json(formatarUsuarioDetalhado(usuario));
  } catch (err) {
    console.error('Erro ao obter dados do usuário autenticado:', err);
    return res.status(500).json({ error: 'Erro ao carregar dados do usuário.' });
  }
});

router.put('/me', autenticarUsuario, parseMultipartIfNeeded, async (req, res) => {
  const usuarioId = req.usuarioAutenticadoId;
  let usuarioAtual;
  try {
    usuarioAtual = await carregarUsuarioRaw(usuarioId);
  } catch (err) {
    console.error('Erro ao carregar usuário antes da atualização:', err);
    return res.status(500).json({ error: 'Erro ao carregar dados do usuário.' });
  }

  if (!usuarioAtual) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  let nomeSanitizado;
  try {
    const nomeBruto = getFirstDefined(body, ['nome', 'name']);
    if (nomeBruto !== undefined) {
      nomeSanitizado = sanitizeNome(nomeBruto);
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let telefoneSanitizado;
  let celularSanitizado;
  let whatsappSanitizado;
  let descricaoSanitizada;

  try {
    const telefoneBruto = getFirstDefined(body, ['telefone', 'telefonePrincipal', 'phone']);
    telefoneSanitizado = sanitizeTelefone(telefoneBruto, 'Telefone');

    const celularBruto = getFirstDefined(body, ['celular', 'telefone_celular', 'mobile']);
    celularSanitizado = sanitizeTelefone(celularBruto, 'Celular');

    const whatsappBruto = getFirstDefined(body, ['whatsapp', 'whatsApp']);
    whatsappSanitizado = sanitizeTelefone(whatsappBruto, 'WhatsApp');

    const descricaoBruta = getFirstDefined(body, ['descricao', 'bio', 'sobre']);
    descricaoSanitizada = sanitizeOptionalString(descricaoBruta, 'Descrição', 500);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const emailInformado = getFirstDefined(body, ['email', 'novoEmail', 'novo_email']);
  if (emailInformado !== undefined) {
    try {
      const emailNormalizado = sanitizeEmail(emailInformado);
      const emailAtual = typeof usuarioAtual.email === 'string' ? usuarioAtual.email.trim().toLowerCase() : '';
      if (emailNormalizado !== emailAtual) {
        return res.status(400).json({
          error: 'Use a confirmação de e-mail para alterar o endereço. Envie a solicitação pela rota apropriada.'
        });
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  let fotoAcao = 'manter';
  let fotoBuffer = null;

  if (parseBoolean(getFirstDefined(body, ['removerFoto', 'remover_foto']))) {
    fotoAcao = 'remover';
  }

  if (fotoAcao === 'manter' && req.file && req.file.buffer) {
    if (req.file.mimetype && !req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Foto de perfil deve ser um arquivo de imagem.' });
    }
    if (!req.file.buffer.length) {
      return res.status(400).json({ error: 'Foto de perfil inválida.' });
    }
    fotoBuffer = req.file.buffer;
    fotoAcao = 'atualizar';
  }

  if (fotoAcao === 'manter') {
    const candidatos = [body.foto, body.fotoBase64, body.foto_usuario, body.avatar];
    for (const valor of candidatos) {
      if (valor === undefined) continue;
      if (valor === null) {
        fotoAcao = 'remover';
        break;
      }
      if (typeof valor !== 'string') {
        return res.status(400).json({ error: 'Foto de perfil inválida.' });
      }
      const trimmed = valor.trim();
      if (!trimmed) {
        fotoAcao = 'remover';
        break;
      }
      const buffer = parseBase64Image(trimmed);
      if (!buffer) {
        return res.status(400).json({ error: 'Foto de perfil deve estar em formato base64 válido.' });
      }
      fotoBuffer = buffer;
      fotoAcao = 'atualizar';
      break;
    }
  }

  if (fotoAcao === 'atualizar' && fotoBuffer && fotoBuffer.length > MAX_IMAGE_SIZE) {
    return res.status(400).json({ error: 'Foto de perfil deve ter no máximo 2 MB.' });
  }

  let colunas;
  try {
    colunas = await getUsuarioColumns();
  } catch (err) {
    console.error('Erro ao carregar metadados de usuários:', err);
    colunas = new Set();
  }

  const updates = [];
  const valores = [];

  const adicionarSet = (coluna, valor) => {
    updates.push(`${coluna} = $${valores.length + 1}`);
    valores.push(valor);
  };

  if (nomeSanitizado !== undefined && colunas.has('nome') && nomeSanitizado !== usuarioAtual.nome) {
    adicionarSet('nome', nomeSanitizado);
  }

  const colunaTelefone = telefoneSanitizado !== undefined ? findAvailableColumn(colunas, telefoneColunasPreferidas) : null;
  if (telefoneSanitizado !== undefined && colunaTelefone) {
    adicionarSet(colunaTelefone, telefoneSanitizado);
  }

  const colunaCelular = celularSanitizado !== undefined ? findAvailableColumn(colunas, celularColunasPreferidas) : null;
  if (celularSanitizado !== undefined && colunaCelular) {
    adicionarSet(colunaCelular, celularSanitizado);
  }

  const colunaWhatsapp = whatsappSanitizado !== undefined ? findAvailableColumn(colunas, whatsappColunasPreferidas) : null;
  if (whatsappSanitizado !== undefined && colunaWhatsapp) {
    adicionarSet(colunaWhatsapp, whatsappSanitizado);
  }

  const colunaDescricao = colunas.has('descricao') ? 'descricao' : colunas.has('bio') ? 'bio' : null;
  if (descricaoSanitizada !== undefined && colunaDescricao) {
    adicionarSet(colunaDescricao, descricaoSanitizada);
  }

  if (fotoAcao === 'atualizar') {
    if (colunas.has('foto_usuario')) {
      adicionarSet('foto_usuario', fotoBuffer);
    } else {
      console.warn('Foto de perfil enviada, mas coluna foto_usuario não existe na tabela.');
    }
  } else if (fotoAcao === 'remover' && colunas.has('foto_usuario')) {
    updates.push('foto_usuario = NULL');
  }

  if (!updates.length) {
    return res.json(formatarUsuarioDetalhado(usuarioAtual));
  }

  if (colunas.has('ultima_alteracao')) {
    updates.push('ultima_alteracao = NOW()');
  }
  if (colunas.has('ultima_alteracao_em')) {
    updates.push('ultima_alteracao_em = NOW()');
  }
  if (colunas.has('ultima_atividade_em')) {
    updates.push('ultima_atividade_em = NOW()');
  }
  if (colunas.has('ultima_acao_em')) {
    updates.push('ultima_acao_em = NOW()');
  }

  valores.push(usuarioId);

  let atualizado;
  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${valores.length} RETURNING *`,
      valores
    );
    atualizado = rows[0];
  } catch (err) {
    console.error('Erro ao atualizar dados do usuário logado:', err);
    return res.status(500).json({ error: 'Erro ao atualizar dados do usuário.' });
  }

  try {
    await atualizarCacheLogin(usuarioId, atualizado);
  } catch (err) {
    console.error('Falha ao atualizar cache de login após alteração de perfil:', err);
  }

  return res.json(formatarUsuarioDetalhado(atualizado));
});

router.post('/me/email-confirmation', autenticarUsuario, async (req, res) => {
  const usuarioId = req.usuarioAutenticadoId;
  let usuario;
  try {
    usuario = await carregarUsuarioRaw(usuarioId);
  } catch (err) {
    console.error('Erro ao carregar usuário para confirmação de e-mail:', err);
    return res.status(500).json({ error: 'Erro ao carregar dados do usuário.' });
  }

  if (!usuario) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  const corpo = req.body && typeof req.body === 'object' ? req.body : {};
  let novoEmail;
  try {
    novoEmail = sanitizeEmail(getFirstDefined(corpo, ['email', 'novoEmail', 'novo_email']));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const emailAtual = typeof usuario.email === 'string' ? usuario.email.trim().toLowerCase() : '';
  if (novoEmail === emailAtual) {
    return res.status(400).json({ error: 'Informe um e-mail diferente do atual.' });
  }

  try {
    const existente = await pool.query(
      'SELECT id FROM usuarios WHERE lower(email) = $1 AND id <> $2',
      [novoEmail, usuarioId]
    );
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: 'E-mail já está em uso por outro usuário.' });
    }
  } catch (err) {
    console.error('Erro ao verificar existência de e-mail:', err);
    return res.status(500).json({ error: 'Erro ao validar o novo e-mail.' });
  }

  try {
    await ensureEmailChangeTable();
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao preparar confirmação de e-mail.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + EMAIL_CONFIRMATION_TTL_MS);

  try {
    await pool.query(
      `INSERT INTO usuarios_confirmacoes_email (usuario_id, email, token, expira_em, criado_em, confirmado_em, cancelado_em)
         VALUES ($1, $2, $3, $4, NOW(), NULL, NULL)
       ON CONFLICT (usuario_id)
         DO UPDATE SET email = EXCLUDED.email,
                       token = EXCLUDED.token,
                       expira_em = EXCLUDED.expira_em,
                       criado_em = NOW(),
                       confirmado_em = NULL,
                       cancelado_em = NULL`,
      [usuarioId, novoEmail, token, expiraEm]
    );
  } catch (err) {
    console.error('Erro ao registrar solicitação de novo e-mail:', err);
    return res.status(500).json({ error: 'Erro ao registrar solicitação de novo e-mail.' });
  }

  try {
    const colunas = await getUsuarioColumns();
    const atualizacoes = [];
    if (colunas.has('confirmacao')) atualizacoes.push('confirmacao = false');
    if (colunas.has('email_confirmado')) atualizacoes.push('email_confirmado = false');
    if (colunas.has('email_confirmado_em')) atualizacoes.push('email_confirmado_em = NULL');
    if (atualizacoes.length) {
      if (colunas.has('ultima_alteracao')) atualizacoes.push('ultima_alteracao = NOW()');
      if (colunas.has('ultima_alteracao_em')) atualizacoes.push('ultima_alteracao_em = NOW()');
      await pool.query(`UPDATE usuarios SET ${atualizacoes.join(', ')} WHERE id = $1`, [usuarioId]);
    }
  } catch (err) {
    console.error('Falha ao atualizar flags de confirmação do usuário:', err);
  }

  try {
    await sendEmailChangeConfirmation({
      to: novoEmail,
      nome: usuario.nome,
      token,
      emailAtual: usuario.email
    });
  } catch (err) {
    console.error('sendEmailChangeConfirmation error', err);
  }

  return res.json({
    message: 'Enviamos um link para o novo e-mail. Confirme o endereço para concluir a alteração.',
    expiraEm: expiraEm.toISOString()
  });
});

async function confirmarAlteracaoEmail(req, res) {
  const token = extrairToken(req);
  if (!token) {
    return responder(req, res, 400, 'Token inválido', 'Token de confirmação não informado.');
  }

  try {
    await ensureEmailChangeTable();
  } catch (err) {
    return responder(req, res, 500, 'Erro interno', 'Não foi possível validar o token informado.');
  }

  try {
    const { rows } = await pool.query(
      `SELECT c.usuario_id, c.email AS novo_email, c.expira_em, u.nome, u.email
         FROM usuarios_confirmacoes_email c
         JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.token = $1`,
      [token]
    );

    if (!rows.length) {
      return responder(req, res, 404, 'Token inválido', 'Solicitação de alteração não encontrada ou já utilizada.');
    }

    const registro = rows[0];
    const expiraEm = registro.expira_em instanceof Date ? registro.expira_em : new Date(registro.expira_em);
    if (Number.isNaN(expiraEm.getTime()) || expiraEm.getTime() < Date.now()) {
      return responder(req, res, 410, 'Token expirado', 'O link de confirmação expirou. Solicite uma nova alteração de e-mail.');
    }

    const colunas = await getUsuarioColumns();
    const sets = ['email = $1'];
    if (colunas.has('confirmacao')) sets.push('confirmacao = true');
    if (colunas.has('email_confirmado')) sets.push('email_confirmado = true');
    if (colunas.has('email_confirmado_em')) sets.push('email_confirmado_em = NOW()');
    if (colunas.has('verificado')) sets.push('verificado = true');
    if (colunas.has('ultima_alteracao')) sets.push('ultima_alteracao = NOW()');
    if (colunas.has('ultima_alteracao_em')) sets.push('ultima_alteracao_em = NOW()');

    const { rows: atualizados } = await pool.query(
      `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $2 RETURNING *`,
      [registro.novo_email.trim().toLowerCase(), registro.usuario_id]
    );

    const usuarioAtualizado = atualizados[0];

    await pool.query(
      `UPDATE usuarios_confirmacoes_email
          SET confirmado_em = NOW(), token = NULL
        WHERE usuario_id = $1`,
      [registro.usuario_id]
    );

    try {
      await atualizarCacheLogin(registro.usuario_id, usuarioAtualizado);
    } catch (err) {
      console.error('Falha ao atualizar cache de login após confirmação de novo e-mail:', err);
    }

    return responder(
      req,
      res,
      200,
      'E-mail atualizado',
      'Seu novo e-mail foi confirmado com sucesso.',
      { usuario: formatarUsuarioDetalhado(usuarioAtualizado) }
    );
  } catch (err) {
    console.error('Erro ao confirmar novo e-mail:', err);
    return responder(req, res, 500, 'Erro interno', 'Não foi possível confirmar o novo e-mail.');
  }
}

router.get('/confirm-email', confirmarAlteracaoEmail);

// GET /api/usuarios/lista
router.get('/lista', async (_req, res) => {
  try {
    const meta = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'usuarios'`
    );

    const colunas = meta.rows.map(row => row.column_name);
    const selecionar = ['u.id', 'u.nome', 'u.email', 'u.verificado', 'u.perfil'];

    const garantirColuna = (nome, alias) => {
      if (colunas.includes(nome)) {
        selecionar.push(`u.${nome}${alias && alias !== nome ? ` AS ${alias}` : ''}`);
        return true;
      }
      return false;
    };

    garantirColuna('ultimo_login_em', 'ultimo_login_em') ||
      garantirColuna('ultimo_login', 'ultimo_login_em');

    garantirColuna('ultima_atividade_em', 'ultima_atividade_em') ||
      garantirColuna('ultima_atividade', 'ultima_atividade_em');

    garantirColuna('ultima_alteracao', 'ultima_alteracao') ||
      garantirColuna('ultima_acao_em', 'ultima_alteracao') ||
      garantirColuna('ultima_alteracao_em', 'ultima_alteracao');

    garantirColuna('ultima_entrada', 'ultima_entrada') ||
      garantirColuna('ultima_entrada_em', 'ultima_entrada');
    garantirColuna('ultima_saida', 'ultima_saida') ||
      garantirColuna('ultima_saida_em', 'ultima_saida');

    garantirColuna('hora_ativacao', 'hora_ativacao');
    garantirColuna('status', 'status');
    const possuiConfirmacao = garantirColuna('confirmacao', 'confirmacao');
    if (!possuiConfirmacao) {
      garantirColuna('email_confirmado', 'confirmacao');
    } else {
      garantirColuna('email_confirmado', 'email_confirmado');
    }
    garantirColuna('email_confirmado_em', 'email_confirmado_em');
    garantirColuna('status_atualizado_em', 'status_atualizado_em');

    garantirColuna('local_ultima_acao', 'local_ultima_acao') ||
      garantirColuna('local_ultima_alteracao', 'local_ultima_acao');

    garantirColuna('especificacao_ultima_acao', 'especificacao_ultima_acao') ||
      garantirColuna('especificacao_ultima_alteracao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_acao_descricao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_alteracao_descricao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_acao', 'especificacao_ultima_acao');

    const query = `SELECT ${selecionar.join(', ')} FROM usuarios u ORDER BY u.nome`;
    const result = await pool.query(query);

    const usuarios = result.rows.map(formatarUsuario);

    res.json(usuarios);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

const normalizarStatus = body => {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const normalizarTexto = valor =>
    String(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

  const mapearValor = valor => {
    if (typeof valor === 'boolean') {
      return valor ? 'ativo' : 'aguardando_aprovacao';
    }

    if (typeof valor === 'number' && Number.isFinite(valor)) {
      return valor > 0 ? 'ativo' : 'aguardando_aprovacao';
    }

    if (typeof valor === 'string' && valor.trim()) {
      const normalizado = normalizarTexto(valor);
      if (!normalizado) {
        return undefined;
      }

      const mapa = {
        ativo: 'ativo',
        active: 'ativo',
        habilitado: 'ativo',
        habilitada: 'ativo',
        enabled: 'ativo',
        enable: 'ativo',
        ligado: 'ativo',
        ligado_em: 'ativo',
        on: 'ativo',
        sim: 'ativo',
        yes: 'ativo',
        y: 'ativo',
        '1': 'ativo',

        aguardando: 'aguardando_aprovacao',
        aguardando_aprovacao: 'aguardando_aprovacao',
        aguardandoaprovacao: 'aguardando_aprovacao',
        pendente: 'aguardando_aprovacao',
        pending: 'aguardando_aprovacao',
        revisao: 'aguardando_aprovacao',
        review: 'aguardando_aprovacao',
        inativo: 'aguardando_aprovacao',
        inativado: 'aguardando_aprovacao',
        desativado: 'aguardando_aprovacao',
        desativada: 'aguardando_aprovacao',
        desativadao: 'aguardando_aprovacao',
        desabilitado: 'aguardando_aprovacao',
        desabilitada: 'aguardando_aprovacao',
        desligado: 'aguardando_aprovacao',
        off: 'aguardando_aprovacao',
        '0': 'aguardando_aprovacao',
        nao: 'aguardando_aprovacao',
        n: 'aguardando_aprovacao',

        nao_confirmado: 'nao_confirmado',
        nao_confirmada: 'nao_confirmado',
        naoconfirmado: 'nao_confirmado',
        naoconfirmada: 'nao_confirmado',
        unconfirmed: 'nao_confirmado',
        email_nao_confirmado: 'nao_confirmado',
        pendente_confirmacao: 'nao_confirmado',
        aguardando_confirmacao: 'nao_confirmado'
      };

      return mapa[normalizado];
    }

    return undefined;
  };

  const candidatos = [body.status, body.statusInterno, body.novoStatus];

  for (const candidato of candidatos) {
    const mapeado = mapearValor(candidato);
    if (mapeado) {
      return mapeado;
    }
  }

  const confirmacaoInput = getFirstDefined(body, ['confirmacao', 'email_confirmado', 'emailConfirmado']);
  const isExplicitFalse = valor => {
    if (typeof valor === 'boolean') return valor === false;
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor <= 0;
    if (typeof valor === 'string' && valor.trim()) {
      const normalizado = normalizarTexto(valor);
      return ['false', 'f', 'nao', 'nao_confirmado', 'naoconfirmado', 'no', 'n', '0'].includes(normalizado);
    }
    return false;
  };

  if (confirmacaoInput !== undefined) {
    if (parseBoolean(confirmacaoInput)) {
      return 'aguardando_aprovacao';
    }
    if (isExplicitFalse(confirmacaoInput)) {
      return 'nao_confirmado';
    }
  }

  if (typeof body.verificado === 'boolean') {
    if (body.verificado) {
      return 'ativo';
    }
    if (confirmacaoInput !== undefined) {
      if (parseBoolean(confirmacaoInput)) {
        return 'aguardando_aprovacao';
      }
      if (isExplicitFalse(confirmacaoInput)) {
        return 'nao_confirmado';
      }
    }
    return 'aguardando_aprovacao';
  }

  if (typeof body.ativo === 'boolean') {
    return body.ativo ? 'ativo' : 'aguardando_aprovacao';
  }

  return undefined;
};

const renderMensagemHtml = (titulo, mensagem) => `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>${titulo}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { background: rgba(15, 23, 42, 0.85); border-radius: 12px; padding: 32px; max-width: 420px; text-align: center; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.6); }
      h1 { font-size: 24px; margin-bottom: 16px; }
      p { line-height: 1.5; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${titulo}</h1>
      <p>${mensagem}</p>
    </main>
  </body>
</html>`;

const responder = (req, res, status, titulo, mensagem, payload = {}) => {
  if (req.method === 'GET') {
    res.status(status).send(renderMensagemHtml(titulo, mensagem));
  } else {
    res.status(status).json({ message: mensagem, titulo, ...payload });
  }
};

const extrairToken = req => {
  if (req.method === 'GET') {
    const token = typeof req.query.token === 'string' ? req.query.token : Array.isArray(req.query.token) ? req.query.token[0] : '';
    return (token || '').trim();
  }
  if (!req.body || typeof req.body !== 'object') {
    return '';
  }
  const token = req.body.token;
  return typeof token === 'string' ? token.trim() : '';
};

const tokenExpirado = usuario => {
  if (!usuario.confirmacao_token_expira_em) return false;
  const data = usuario.confirmacao_token_expira_em instanceof Date
    ? usuario.confirmacao_token_expira_em
    : new Date(usuario.confirmacao_token_expira_em);
  if (Number.isNaN(data.getTime())) return false;
  return data.getTime() < Date.now();
};

router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const novoStatus = normalizarStatus(req.body);

  if (typeof novoStatus !== 'string') {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  try {
    const estadoAtual = await pool.query('SELECT 1 FROM usuarios WHERE id = $1', [id]);

    if (estadoAtual.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const novoVerificado = novoStatus === 'ativo';

    const colunas = await getUsuarioColumns();
    const camposAtualizacao = [
      'status = $1',
      'verificado = $2',
      'status_atualizado_em = NOW()',
      "hora_ativacao = CASE WHEN $1 = 'ativo' THEN NOW() ELSE hora_ativacao END"
    ];
    if (colunas.has('confirmacao')) {
      camposAtualizacao.push(
        "confirmacao = CASE WHEN $1 = 'ativo' THEN true ELSE confirmacao END"
      );
    }
    if (colunas.has('email_confirmado')) {
      camposAtualizacao.push(
        "email_confirmado = CASE WHEN $1 = 'ativo' THEN true ELSE email_confirmado END"
      );
    }

    const result = await pool.query(
      `UPDATE usuarios
          SET ${camposAtualizacao.join(', ')}
        WHERE id = $3
      RETURNING *`,
      [novoStatus, novoVerificado, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const linhaAtualizada = result.rows[0];
    try {
      await atualizarCacheLogin(linhaAtualizada.id, linhaAtualizada);
    } catch (err) {
      console.error('Falha ao atualizar cache de login após alteração de status:', err);
    }

    const usuario = formatarUsuario(linhaAtualizada);

    res.json(usuario);
  } catch (err) {
    console.error('Erro ao atualizar status do usuário:', err);
    res.status(500).json({ error: 'Erro ao atualizar status do usuário' });
  }
});

async function confirmarEmail(req, res) {
  const token = extrairToken(req);

  if (!token) {
    return responder(req, res, 400, 'Token inválido', 'Token de confirmação não informado.');
  }

  try {
    const resultado = await pool.query(
      `SELECT id, nome, email, confirmacao, email_confirmado, confirmacao_token_expira_em
         FROM usuarios
        WHERE confirmacao_token = $1`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return responder(req, res, 404, 'Token inválido', 'Não encontramos uma solicitação válida para este link.');
    }

    const usuario = resultado.rows[0];

    if (tokenExpirado(usuario)) {
      return responder(
        req,
        res,
        410,
        'Token expirado',
        'O link de confirmação expirou. Solicite um novo cadastro.'
      );
    }

    if (parseBoolean(usuario.confirmacao ?? usuario.email_confirmado)) {
      return responder(
        req,
        res,
        200,
        'E-mail já confirmado',
        'Você já havia confirmado este e-mail. Aguarde a aprovação do Sup Admin.'
      );
    }

    const colunasTabela = await getUsuarioColumns();
    const atualizacoes = [
      "status = 'aguardando_aprovacao'",
      'status_atualizado_em = NOW()',
      'confirmacao_token = NULL'
    ];
    if (colunasTabela.has('confirmacao')) atualizacoes.unshift('confirmacao = true');
    if (colunasTabela.has('email_confirmado')) atualizacoes.push('email_confirmado = true');
    if (colunasTabela.has('email_confirmado_em')) atualizacoes.push('email_confirmado_em = NOW()');
    if (colunasTabela.has('confirmacao_token_revogado_em')) {
      atualizacoes.push('confirmacao_token_revogado_em = NOW()');
    }

    const atualizado = await pool.query(
      `UPDATE usuarios
          SET ${atualizacoes.join(', ')}
        WHERE id = $1
      RETURNING *`,
      [usuario.id]
    );

    const usuarioAtualizado = atualizado.rows[0];

    try {
      await atualizarCacheLogin(usuarioAtualizado.id, usuarioAtualizado);
    } catch (err) {
      console.error('Falha ao atualizar cache de login após confirmação de e-mail:', err);
    }

    try {
      await sendSupAdminReviewNotification({
        usuarioNome: usuarioAtualizado.nome,
        usuarioEmail: usuarioAtualizado.email,
        motivo: 'Usuário confirmou o e-mail.',
        acaoRecomendada: 'Acesse o painel e realize a aprovação do cadastro.'
      });
    } catch (err) {
      console.error('sendSupAdminReviewNotification error', err);
    }

    return responder(
      req,
      res,
      200,
      'Confirmação registrada',
      'Obrigado! Sua confirmação foi recebida e o Sup Admin foi notificado.',
      { usuario: formatarUsuario(usuarioAtualizado) }
    );
  } catch (err) {
    console.error('Erro ao confirmar e-mail do usuário:', err);
    return responder(
      req,
      res,
      500,
      'Erro interno',
      'Não foi possível confirmar seu e-mail. Tente novamente mais tarde.'
    );
  }
}

async function reportarEmailIncorreto(req, res) {
  const token = extrairToken(req);

  if (!token) {
    return responder(req, res, 400, 'Token inválido', 'Token de confirmação não informado.');
  }

  try {
    const resultado = await pool.query(
      `SELECT id, nome, email, confirmacao_token_expira_em
         FROM usuarios
        WHERE confirmacao_token = $1`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return responder(req, res, 404, 'Token inválido', 'Não encontramos uma solicitação válida para este link.');
    }

    const usuario = resultado.rows[0];

    if (tokenExpirado(usuario)) {
      return responder(
        req,
        res,
        410,
        'Token expirado',
        'O link de confirmação expirou. Caso o cadastro tenha sido indevido, entre em contato com o suporte.'
      );
    }

    const colunasTabela = await getUsuarioColumns();
    const atualizacoes = [
      'verificado = false',
      "status = 'nao_confirmado'",
      'status_atualizado_em = NOW()',
      'confirmacao_token = NULL'
    ];
    if (colunasTabela.has('confirmacao')) atualizacoes.unshift('confirmacao = false');
    if (colunasTabela.has('email_confirmado')) atualizacoes.push('email_confirmado = false');
    if (colunasTabela.has('email_confirmado_em')) atualizacoes.push('email_confirmado_em = NULL');
    if (colunasTabela.has('confirmacao_token_revogado_em')) {
      atualizacoes.push('confirmacao_token_revogado_em = NOW()');
    }

    const atualizado = await pool.query(
      `UPDATE usuarios
          SET ${atualizacoes.join(', ')}
        WHERE id = $1
      RETURNING *`,
      [usuario.id]
    );

    const usuarioAtualizado = atualizado.rows[0];

    try {
      await atualizarCacheLogin(usuarioAtualizado.id, usuarioAtualizado);
    } catch (err) {
      console.error('Falha ao atualizar cache de login após relato de e-mail incorreto:', err);
    }

    try {
      await sendSupAdminReviewNotification({
        usuarioNome: usuarioAtualizado.nome,
        usuarioEmail: usuarioAtualizado.email,
        motivo: 'O destinatário informou que não reconhece o cadastro.',
        acaoRecomendada: 'Investigue o caso e, se necessário, bloqueie o acesso.'
      });
    } catch (err) {
      console.error('sendSupAdminReviewNotification error', err);
    }

    return responder(
      req,
      res,
      200,
      'Relato registrado',
      'Obrigado por nos avisar. Nossa equipe foi notificada e investigará o caso.',
      { usuario: formatarUsuario(usuarioAtualizado) }
    );
  } catch (err) {
    console.error('Erro ao reportar e-mail incorreto:', err);
    return responder(
      req,
      res,
      500,
      'Erro interno',
      'Não foi possível registrar o relato. Tente novamente mais tarde.'
    );
  }
}

router.get('/confirmar-email', confirmarEmail);
router.post('/confirmar-email', confirmarEmail);
router.get('/reportar-email-incorreto', reportarEmailIncorreto);
router.post('/reportar-email-incorreto', reportarEmailIncorreto);

router.post('/aprovar', async (req, res) => {
  const usuarioId = Number(req.body?.usuarioId);
  const supAdminEmail = typeof req.body?.supAdminEmail === 'string' ? req.body.supAdminEmail.trim() : '';
  const supAdminSenha = typeof req.body?.supAdminSenha === 'string' ? req.body.supAdminSenha : '';

  if (!usuarioId || !supAdminEmail || !supAdminSenha) {
    return res.status(400).json({ error: 'Dados insuficientes para aprovação.' });
  }

  try {
    const credenciais = await pool.query(
      `SELECT id, senha, perfil
         FROM usuarios
        WHERE lower(email) = lower($1)`,
      [supAdminEmail]
    );

    if (credenciais.rows.length === 0) {
      return res.status(403).json({ error: 'Credenciais inválidas.' });
    }

    const supAdmin = credenciais.rows[0];
    const perfil = (supAdmin.perfil || '').toLowerCase();
    if (!perfil.includes('sup admin')) {
      return res.status(403).json({ error: 'Apenas Sup Admin pode aprovar usuários.' });
    }

    const senhaValida = await bcrypt.compare(supAdminSenha, supAdmin.senha || '');
    if (!senhaValida) {
      return res.status(403).json({ error: 'Credenciais inválidas.' });
    }

    const colunas = await getUsuarioColumns();
    const camposAtualizacao = [
      "status = 'ativo'",
      'verificado = true',
      'status_atualizado_em = NOW()',
      'hora_ativacao = NOW()',
      'confirmacao_token = NULL'
    ];
    if (colunas.has('confirmacao')) camposAtualizacao.push('confirmacao = true');
    if (colunas.has('email_confirmado')) camposAtualizacao.push('email_confirmado = true');
    if (colunas.has('email_confirmado_em')) {
      camposAtualizacao.push('email_confirmado_em = COALESCE(email_confirmado_em, NOW())');
    }
    if (colunas.has('confirmacao_token_revogado_em')) {
      camposAtualizacao.push('confirmacao_token_revogado_em = NOW()');
    }

    const atualizado = await pool.query(
      `UPDATE usuarios
          SET ${camposAtualizacao.join(', ')}
        WHERE id = $1
      RETURNING *`,
      [usuarioId]
    );

    if (atualizado.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const usuario = atualizado.rows[0];

    try {
      await atualizarCacheLogin(usuario.id, usuario);
    } catch (err) {
      console.error('Falha ao atualizar cache de login após aprovação de usuário:', err);
    }

    try {
      await sendUserActivationNotice({ to: usuario.email, nome: usuario.nome });
    } catch (err) {
      console.error('sendUserActivationNotice error', err);
    }

    res.json({ message: 'Usuário aprovado com sucesso.', usuario: formatarUsuario(usuario) });
  } catch (err) {
    console.error('Erro ao aprovar usuário:', err);
    res.status(500).json({ error: 'Erro ao aprovar usuário.' });
  }
});

function formatarUsuario(u) {
  const parseDate = valor => {
    if (!valor) return null;
    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(data.getTime()) ? null : data;
  };

  const ultimoLogin = parseDate(u.ultimo_login_em);
  const ultimaAtividade = parseDate(u.ultima_atividade_em);
  const ultimaEntrada = parseDate(u.ultima_entrada || u.ultima_entrada_em || u.ultimo_login_em);
  const ultimaAlteracao = parseDate(u.ultima_alteracao) || ultimaAtividade;
  const ultimaSaida = parseDate(u.ultima_saida || u.ultima_saida_em);
  const horaAtivacao = parseDate(u.hora_ativacao);
  const ultimaAcaoLocal =
    u.local_ultima_alteracao || u.local_ultima_acao || u.local_ultima_atividade || null;
  const especificacaoUltimaAcao =
    u.especificacao_ultima_alteracao ||
    u.especificacao_ultima_acao ||
    u.ultima_acao_descricao ||
    u.ultima_alteracao_descricao ||
    u.ultima_acao ||
    null;

  let online;
  if (ultimaEntrada || ultimaSaida) {
    if (!ultimaSaida) {
      online = Boolean(ultimaEntrada);
    } else if (!ultimaEntrada) {
      online = false;
    } else {
      online = ultimaSaida.getTime() < ultimaEntrada.getTime();
    }
  } else {
    const ONLINE_LIMITE_MINUTOS = 5;
    online = ultimaAtividade
      ? Date.now() - ultimaAtividade.getTime() <= ONLINE_LIMITE_MINUTOS * 60 * 1000
      : false;
  }

  const serializar = data => (data ? data.toISOString() : null);

  const formatarDescricaoAlteracao = () => {
    const local = (ultimaAcaoLocal || '').trim();
    const especificacao = (especificacaoUltimaAcao || '').trim();
    if (local && especificacao) {
      return `Usuário alterou o módulo ${local}, mudando ${especificacao}`;
    }
    if (local) {
      return `Usuário alterou o módulo ${local}`;
    }
    if (especificacao) {
      return `Usuário alterou ${especificacao}`;
    }
    return '';
  };

  const ultimaAlteracaoDescricao = formatarDescricaoAlteracao();

  const normalizarStatusInterno = valor => {
    if (!valor) return '';
    const normalizado = String(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

    const mapa = {
      ativo: 'ativo',
      active: 'ativo',
      habilitado: 'ativo',
      aguardando: 'aguardando_aprovacao',
      aguardando_aprovacao: 'aguardando_aprovacao',
      aguardandoaprovacao: 'aguardando_aprovacao',
      pendente: 'aguardando_aprovacao',
      pending: 'aguardando_aprovacao',
      inativo: 'aguardando_aprovacao',
      desativado: 'aguardando_aprovacao',
      desativada: 'aguardando_aprovacao',
      desativadao: 'aguardando_aprovacao',
      desabilitado: 'aguardando_aprovacao',
      desabilitada: 'aguardando_aprovacao',
      naoconfirmado: 'nao_confirmado',
      nao_confirmado: 'nao_confirmado',
      nao_confirmada: 'nao_confirmado',
      unconfirmed: 'nao_confirmado',
      email_nao_confirmado: 'nao_confirmado',
      aguardando_confirmacao: 'nao_confirmado',
      pendente_confirmacao: 'nao_confirmado'
    };

    return mapa[normalizado] || normalizado;
  };

  const confirmacaoBruta = Object.prototype.hasOwnProperty.call(u, 'confirmacao')
    ? u.confirmacao
    : undefined;
  const confirmacaoNormalizada =
    confirmacaoBruta !== undefined ? parseBoolean(confirmacaoBruta) : parseBoolean(u.email_confirmado);

  const statusPersistido = typeof u.status === 'string' ? u.status : '';
  let statusInterno = normalizarStatusInterno(statusPersistido);
  if (!statusInterno) {
    if (u.verificado) {
      statusInterno = 'ativo';
    } else if (confirmacaoNormalizada) {
      statusInterno = 'aguardando_aprovacao';
    } else {
      statusInterno = 'nao_confirmado';
    }
  }

  const statusLabelMapa = {
    ativo: 'Ativo',
    aguardando_aprovacao: 'Inativo',
    nao_confirmado: 'Não confirmado'
  };

  const statusBadgeMapa = {
    ativo: 'badge-success',
    aguardando_aprovacao: 'badge-danger',
    nao_confirmado: 'badge-warning'
  };

  const statusLabel = statusLabelMapa[statusInterno] || (u.verificado ? 'Ativo' : 'Inativo');
  const statusBadge = statusBadgeMapa[statusInterno] || 'badge-secondary';

  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    perfil: u.perfil,
    status: statusLabel,
    statusInterno,
    statusBadge,
    confirmado: Boolean(u.verificado),
    confirmadoEm: serializar(horaAtivacao),
    confirmacao: confirmacaoNormalizada,
    confirmacaoEm: serializar(parseDate(u.confirmacao_em || u.email_confirmado_em)),
    emailConfirmado: confirmacaoNormalizada,
    emailConfirmadoEm: serializar(parseDate(u.email_confirmado_em)),
    statusAtualizadoEm: serializar(parseDate(u.status_atualizado_em)),
    online,
    ultimoLoginEm: serializar(ultimaEntrada || ultimoLogin),
    ultimaAtividadeEm: serializar(ultimaAtividade),
    ultimaAlteracaoEm: serializar(ultimaAlteracao),
    ultimaEntradaEm: serializar(ultimaEntrada),
    ultimaSaidaEm: serializar(ultimaSaida),
    horaAtivacaoEm: serializar(horaAtivacao),
    hora_ativacao: serializar(horaAtivacao),
    ultimaAlteracaoDescricao: ultimaAlteracaoDescricao || null,
    localUltimaAlteracao: ultimaAcaoLocal || null,
    especificacaoUltimaAlteracao: especificacaoUltimaAcao || null
  };
}

module.exports = router;
