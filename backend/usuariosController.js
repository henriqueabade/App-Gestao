const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const { Client } = require('pg');
const pool = require('./db');
const { updateUsuarioCampos } = require('./userActivity');
const {
  ModeloPermissoesError,
  listModelosPermissoes,
  getModeloPermissoesById,
  createModeloPermissoes,
  updateModeloPermissoes,
  deleteModeloPermissoes
} = require('./modelosPermissoesRepository');
const { sendSupAdminReviewNotification } = require('../src/email/sendSupAdminReviewNotification');
const { sendUserActivationNotice } = require('../src/email/sendUserActivationNotice');
const { sendEmailChangeConfirmation } = require('../src/email/sendEmailChangeConfirmation');

const router = express.Router();

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const EMAIL_CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000;
const SUP_ADMIN_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

const PERMISSOES_CATALOGO = {
  clientes: {
    label: 'Clientes',
    aliases: ['cliente'],
    acoes: {
      visualizar: { label: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'] },
      editar: { label: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'] },
      inserir: { label: 'Inserir', aliases: ['criar', 'create', 'add', 'adicionar', 'incluir'] },
      excluir: { label: 'Excluir', aliases: ['remover', 'delete', 'remove', 'apagar'] },
      exportar: { label: 'Exportar', aliases: ['export'] }
    }
  },
  pedidos: {
    label: 'Pedidos',
    aliases: ['pedido'],
    acoes: {
      visualizar: { label: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'] },
      editar: { label: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'] },
      criar: { label: 'Criar', aliases: ['inserir', 'create', 'add', 'adicionar', 'incluir'] },
      cancelar: { label: 'Cancelar', aliases: ['cancel'] },
      exportar: { label: 'Exportar', aliases: ['export'] }
    }
  },
  orcamentos: {
    label: 'Orçamentos',
    aliases: ['orcamento', 'cotacoes', 'cotacao'],
    acoes: {
      visualizar: { label: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'] },
      editar: { label: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'] },
      criar: { label: 'Criar', aliases: ['inserir', 'create', 'add', 'adicionar', 'incluir'] },
      aprovar: { label: 'Aprovar', aliases: ['approve'] },
      enviar: { label: 'Enviar', aliases: ['send'] }
    }
  },
  produtos: {
    label: 'Produtos',
    aliases: ['produto', 'itens', 'item'],
    acoes: {
      visualizar: { label: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'] },
      editar: { label: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'] },
      inserir: { label: 'Inserir', aliases: ['criar', 'create', 'add', 'adicionar', 'incluir'] },
      inativar: { label: 'Inativar', aliases: ['desativar', 'disable'] },
      exportar: { label: 'Exportar', aliases: ['export'] }
    }
  },
  financeiro: {
    label: 'Financeiro',
    aliases: ['financeiro', 'finance'],
    acoes: {
      visualizar: { label: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'] },
      editar: { label: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'] },
      aprovar: { label: 'Aprovar', aliases: ['approve'] },
      exportar: { label: 'Exportar', aliases: ['export'] }
    }
  },
  relatorios: {
    label: 'Relatórios',
    aliases: ['relatorio', 'reports', 'report'],
    acoes: {
      visualizar: { label: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'] },
      exportar: { label: 'Exportar', aliases: ['export'] }
    }
  },
  usuarios: {
    label: 'Usuários',
    aliases: ['usuario', 'users', 'user'],
    acoes: {
      visualizar: { label: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'] },
      editar: { label: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'] },
      permissoes: { label: 'Gerenciar permissões', aliases: ['permissoes', 'permissions', 'permissao', 'permission', 'roles'] },
      aprovar: { label: 'Aprovar', aliases: ['approve'] }
    }
  }
};

const ESCOPO_ALIASES = new Map([
  ['ver', 'visualizar'],
  ['visualizar', 'visualizar'],
  ['view', 'visualizar'],
  ['read', 'visualizar'],
  ['ler', 'visualizar'],
  ['listar', 'listar'],
  ['list', 'listar'],
  ['editar', 'editar'],
  ['edit', 'editar'],
  ['write', 'editar'],
  ['atualizar', 'editar'],
  ['update', 'editar'],
  ['inserir', 'inserir'],
  ['criar', 'inserir'],
  ['create', 'inserir'],
  ['add', 'inserir'],
  ['adicionar', 'inserir'],
  ['incluir', 'inserir'],
  ['remover', 'remover'],
  ['remove', 'remover'],
  ['delete', 'remover'],
  ['excluir', 'remover'],
  ['apagar', 'remover'],
  ['cancelar', 'cancelar'],
  ['cancel', 'cancelar'],
  ['aprovar', 'aprovar'],
  ['approve', 'aprovar'],
  ['exportar', 'exportar'],
  ['export', 'exportar']
]);

const ACTION_SCOPE_ALLOWED = new Set(['visualizar', 'listar', 'editar', 'inserir', 'remover', 'cancelar', 'aprovar', 'exportar']);
const FIELD_SCOPE_ALLOWED = new Set(['visualizar', 'editar', 'inserir']);

const ESCOPOS_IGNORE_KEYS = new Set([
  'permitido',
  'allowed',
  'habilitado',
  'enabled',
  'valor',
  'value',
  'acesso',
  'access',
  'ativo',
  'active',
  'campos',
  'fields',
  'colunas',
  'columns',
  'permissoes',
  'acoes',
  'scopes',
  'escopos',
  'nome',
  'acao',
  'label',
  'id',
  'modulo',
  'module',
  'action'
]);

const PERMISSOES_MODULO_MAP = new Map();
const PERMISSOES_ACAO_MAP = new Map();

for (const [modulo, config] of Object.entries(PERMISSOES_CATALOGO)) {
  const moduloNormalized = normalizeKey(modulo);
  PERMISSOES_MODULO_MAP.set(moduloNormalized, modulo);
  if (Array.isArray(config.aliases)) {
    for (const alias of config.aliases) {
      PERMISSOES_MODULO_MAP.set(normalizeKey(alias), modulo);
    }
  }

  const acaoMap = new Map();
  for (const [acao, detalhes] of Object.entries(config.acoes)) {
    acaoMap.set(normalizeKey(acao), acao);
    if (Array.isArray(detalhes.aliases)) {
      for (const alias of detalhes.aliases) {
        acaoMap.set(normalizeKey(alias), acao);
      }
    }
  }
  PERMISSOES_ACAO_MAP.set(modulo, acaoMap);
}

function normalizeKey(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function booleanFromValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ['1', 'true', 'yes', 'y', 'sim', 'on', 'permitido', 'habilitado', 'enabled', 'ativo', 'active'].includes(
      normalized
    );
  }
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }
  return Boolean(value);
}

function mapScopeKey(rawKey, allowedSet) {
  const normalized = normalizeKey(rawKey);
  if (!normalized) return null;
  const canonical = ESCOPO_ALIASES.get(normalized) || normalized;
  if (!allowedSet.has(canonical)) {
    return null;
  }
  return canonical;
}

function extrairEscoposGenericos(source, allowedSet) {
  if (!source || typeof source !== 'object') return undefined;
  const resultado = {};
  for (const [key, valor] of Object.entries(source)) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey || ESCOPOS_IGNORE_KEYS.has(normalizedKey)) {
      continue;
    }
    const canonical = mapScopeKey(key, allowedSet);
    if (!canonical) continue;
    resultado[canonical] = booleanFromValue(valor);
  }
  return Object.keys(resultado).length ? resultado : undefined;
}

function extrairCamposPermissoes(rawCampos, { strict = false } = {}) {
  if (!rawCampos || (typeof rawCampos !== 'object' && !Array.isArray(rawCampos))) {
    return undefined;
  }

  const resultado = {};

  const adicionarCampo = (nomeCampo, valor) => {
    const chaveNormalizada = normalizeKey(nomeCampo);
    if (!chaveNormalizada) {
      return;
    }

    if (valor === undefined) {
      return;
    }

    if (typeof valor === 'boolean' || typeof valor === 'number' || typeof valor === 'string') {
      const permitido = booleanFromValue(valor);
      resultado[chaveNormalizada] = { visualizar: permitido, editar: permitido };
      return;
    }

    if (Array.isArray(valor)) {
      const escopos = {};
      for (const item of valor) {
        const canonical = mapScopeKey(item, FIELD_SCOPE_ALLOWED);
        if (!canonical) continue;
        escopos[canonical] = true;
      }
      if (Object.keys(escopos).length) {
        if (!Object.prototype.hasOwnProperty.call(escopos, 'visualizar')) {
          escopos.visualizar = true;
        }
        resultado[chaveNormalizada] = escopos;
      }
      return;
    }

    if (valor && typeof valor === 'object') {
      const copia = { ...valor };
      delete copia.nome;
      delete copia.campo;
      delete copia.coluna;
      delete copia.label;
      delete copia.id;

      let permitidoBase;
      for (const key of ['permitido', 'allowed', 'habilitado', 'enabled', 'valor', 'value', 'ativo', 'active']) {
        if (Object.prototype.hasOwnProperty.call(copia, key)) {
          permitidoBase = booleanFromValue(copia[key]);
          delete copia[key];
          break;
        }
      }

      const escopos = extrairEscoposGenericos(copia, FIELD_SCOPE_ALLOWED);
      if (!escopos && permitidoBase === undefined) {
        if (strict) {
          throw new Error(`Campo ${nomeCampo} não possui escopos válidos.`);
        }
        return;
      }

      const final = escopos ? { ...escopos } : {};
      if (permitidoBase !== undefined) {
        if (!Object.prototype.hasOwnProperty.call(final, 'visualizar')) {
          final.visualizar = Boolean(permitidoBase);
        }
        if (!Object.prototype.hasOwnProperty.call(final, 'editar')) {
          final.editar = Boolean(permitidoBase);
        }
      }

      if (Object.keys(final).length) {
        resultado[chaveNormalizada] = final;
      }
      return;
    }
  };

  if (Array.isArray(rawCampos)) {
    rawCampos.forEach((item, index) => {
      if (item === null || item === undefined) return;
      if (typeof item === 'object' && !Array.isArray(item)) {
        const nome = item.nome ?? item.campo ?? item.coluna ?? `campo_${index + 1}`;
        const detalhe = { ...item };
        delete detalhe.nome;
        delete detalhe.campo;
        delete detalhe.coluna;
        delete detalhe.label;
        delete detalhe.id;
        adicionarCampo(nome, Object.keys(detalhe).length ? detalhe : item.valor ?? item.value ?? item.permitido ?? true);
      } else {
        adicionarCampo(item, true);
      }
    });
  } else {
    Object.entries(rawCampos).forEach(([nome, valor]) => adicionarCampo(nome, valor));
  }

  return Object.keys(resultado).length ? resultado : undefined;
}

function prepararValorAcao(valor) {
  if (valor === null || valor === undefined) return undefined;
  if (typeof valor === 'object' && !Array.isArray(valor)) {
    if (Object.prototype.hasOwnProperty.call(valor, 'permissoes')) {
      return valor.permissoes;
    }
    if (Object.prototype.hasOwnProperty.call(valor, 'acoes')) {
      return valor.acoes;
    }
    const copia = { ...valor };
    delete copia.nome;
    delete copia.acao;
    delete copia.action;
    delete copia.label;
    delete copia.id;
    delete copia.modulo;
    delete copia.module;
    if (Object.keys(copia).length === 0) {
      if (Object.prototype.hasOwnProperty.call(valor, 'permitido')) {
        return Boolean(valor.permitido);
      }
      if (Object.prototype.hasOwnProperty.call(valor, 'valor')) {
        return valor.valor;
      }
    }
    return copia;
  }
  return valor;
}

function parseActionValue(rawValor) {
  if (rawValor === undefined) return null;

  if (typeof rawValor === 'boolean' || typeof rawValor === 'number' || typeof rawValor === 'string') {
    return { permitido: booleanFromValue(rawValor) };
  }

  if (Array.isArray(rawValor)) {
    const escopos = {};
    for (const item of rawValor) {
      const canonical = mapScopeKey(item, ACTION_SCOPE_ALLOWED);
      if (!canonical) continue;
      escopos[canonical] = true;
    }
    const permitido = Object.values(escopos).some(Boolean);
    return permitido || Object.keys(escopos).length
      ? { permitido, escopos: Object.keys(escopos).length ? escopos : undefined }
      : { permitido: false };
  }

  if (rawValor && typeof rawValor === 'object') {
    const copia = { ...rawValor };
    let permitido;
    for (const key of ['permitido', 'allowed', 'habilitado', 'enabled', 'valor', 'value', 'acesso', 'access', 'ativo', 'active']) {
      if (Object.prototype.hasOwnProperty.call(copia, key)) {
        permitido = booleanFromValue(copia[key]);
        delete copia[key];
        break;
      }
    }

    const camposRaw = copia.campos ?? copia.fields ?? copia.colunas ?? copia.columns;
    if (camposRaw !== undefined) {
      delete copia.campos;
      delete copia.fields;
      delete copia.colunas;
      delete copia.columns;
    }

    const escopos = extrairEscoposGenericos(copia, ACTION_SCOPE_ALLOWED);
    const campos = extrairCamposPermissoes(camposRaw, { strict: false });

    if (permitido === undefined) {
      if (escopos) {
        permitido = Object.values(escopos).some(Boolean);
      } else if (campos) {
        permitido = Object.values(campos).some(campo =>
          campo && typeof campo === 'object' && Object.values(campo).some(Boolean)
        );
      } else {
        permitido = false;
      }
    }

    const resposta = { permitido: Boolean(permitido) };
    if (escopos && Object.keys(escopos).length) {
      resposta.escopos = escopos;
    }
    if (campos && Object.keys(campos).length) {
      resposta.campos = campos;
    }
    return resposta;
  }

  return { permitido: booleanFromValue(rawValor) };
}

function normalizarPermissoesEstrutura(origem, { strict = true } = {}) {
  if (origem === undefined || origem === null) return {};

  let input = origem;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};
    try {
      input = JSON.parse(trimmed);
    } catch (err) {
      throw new Error('Permissões devem ser fornecidas como JSON válido.');
    }
  }

  if (!Array.isArray(input) && typeof input !== 'object') {
    throw new Error('Formato de permissões inválido. Use objeto ou array.');
  }

  const resultado = {};

  const processarModulo = (identificador, valor) => {
    const moduloKey = PERMISSOES_MODULO_MAP.get(normalizeKey(identificador));
    if (!moduloKey) {
      if (strict) {
        throw new Error(`Módulo desconhecido: ${identificador}`);
      }
      return;
    }

    const acoesPermitidas = PERMISSOES_ACAO_MAP.get(moduloKey) || new Map();
    const moduloResultado = resultado[moduloKey] || {};

    const adicionarAcao = (acaoIdentificador, acaoValor) => {
      const acaoKey = acoesPermitidas.get(normalizeKey(acaoIdentificador));
      if (!acaoKey) {
        if (strict) {
          throw new Error(`Ação desconhecida para ${moduloKey}: ${acaoIdentificador}`);
        }
        return;
      }

      const preparado = prepararValorAcao(acaoValor);
      const parsed = parseActionValue(preparado);
      if (!parsed) return;
      moduloResultado[acaoKey] = parsed;
    };

    if (Array.isArray(valor)) {
      valor.forEach((item, index) => {
        if (item === null || item === undefined) return;
        if (typeof item === 'object' && !Array.isArray(item)) {
          const nome = item.acao ?? item.nome ?? item.id ?? item.action ?? `acao_${index + 1}`;
          adicionarAcao(nome, item);
        } else {
          adicionarAcao(item, true);
        }
      });
    } else if (valor && typeof valor === 'object') {
      for (const [acaoNome, acaoValor] of Object.entries(valor)) {
        adicionarAcao(acaoNome, acaoValor);
      }
    } else if (valor !== undefined) {
      adicionarAcao('visualizar', valor);
    }

    if (Object.keys(moduloResultado).length) {
      resultado[moduloKey] = moduloResultado;
    }
  };

  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      if (!item) return;
      if (typeof item === 'object' && !Array.isArray(item)) {
        const moduloId = item.modulo ?? item.module ?? item.nome ?? item.id ?? `modulo_${index + 1}`;
        const permissoesValor =
          item.permissoes ?? item.acoes ?? item.actions ?? item.scopes ?? prepararValorAcao(item);
        processarModulo(moduloId, permissoesValor);
      }
    });
  } else {
    for (const [modulo, valor] of Object.entries(input)) {
      processarModulo(modulo, valor);
    }
  }

  return resultado;
}

function construirResumoPermissoes(permissoes) {
  if (!permissoes || typeof permissoes !== 'object') {
    return [];
  }

  const resumo = [];

  for (const [modulo, acoes] of Object.entries(permissoes)) {
    if (!acoes || typeof acoes !== 'object') continue;
    const permitidas = [];
    for (const [acao, detalhes] of Object.entries(acoes)) {
      if (!detalhes) continue;
      if (typeof detalhes === 'boolean') {
        if (detalhes) permitidas.push(acao);
        continue;
      }
      const permitido = typeof detalhes.permitido === 'boolean' ? detalhes.permitido : booleanFromValue(detalhes.permitido);
      if (permitido) {
        permitidas.push(acao);
        continue;
      }
      const escoposPermitidos = detalhes.escopos && typeof detalhes.escopos === 'object'
        ? Object.values(detalhes.escopos).some(Boolean)
        : false;
      const camposPermitidos = detalhes.campos && typeof detalhes.campos === 'object'
        ? Object.values(detalhes.campos).some(campo => campo && typeof campo === 'object' && Object.values(campo).some(Boolean))
        : false;
      if (escoposPermitidos || camposPermitidos) {
        permitidas.push(acao);
      }
    }
    if (permitidas.length) {
      permitidas.sort();
      resumo.push({ modulo, acoes: permitidas });
    }
  }

  return resumo;
}

function obterPermissoesDoUsuario(row) {
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'permissoes')) {
    return {};
  }

  try {
    return normalizarPermissoesEstrutura(row.permissoes, { strict: false });
  } catch (err) {
    console.error('Falha ao normalizar permissões do usuário:', err);
    return {};
  }
}

function isSupAdminPerfil(perfil) {
  if (typeof perfil !== 'string') return false;
  return perfil.toLowerCase().includes('sup admin');
}

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

async function carregarUsuarioAutenticado(req) {
  if (!req.usuarioAutenticadoId) {
    return null;
  }
  try {
    return await carregarUsuarioRaw(req.usuarioAutenticadoId);
  } catch (err) {
    console.error('Erro ao carregar usuário autenticado:', err);
    throw err;
  }
}

async function garantirSupAdmin(req, res) {
  let solicitante;
  try {
    solicitante = await carregarUsuarioAutenticado(req);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao carregar dados do usuário autenticado.' });
  }

  if (!solicitante) {
    res.status(401).json({ error: 'Usuário autenticado não encontrado.' });
    return null;
  }

  if (!isSupAdminPerfil(solicitante.perfil)) {
    res.status(403).json({ error: 'Apenas Sup Admin pode acessar este recurso.' });
    return null;
  }

  return solicitante;
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

  const permissoes = obterPermissoesDoUsuario(row);
  resultado.permissoes = permissoes;
  resultado.permissoesResumo = construirResumoPermissoes(permissoes);

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

function formatarModeloPermissoes(modelo) {
  if (!modelo) return null;
  let permissoesFormatadas = {};
  try {
    permissoesFormatadas = normalizarPermissoesEstrutura(modelo.permissoes, { strict: false });
  } catch (err) {
    console.warn('Modelo de permissões possui estrutura inválida, retornando conteúdo bruto.', err);
    permissoesFormatadas = modelo.permissoes ?? {};
  }

  const parseData = valor => {
    if (!valor) return null;
    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(data.getTime()) ? null : data.toISOString();
  };

  return {
    id: modelo.id,
    nome: modelo.nome,
    permissoes: permissoesFormatadas,
    criadoEm: parseData(modelo.criadoEm),
    atualizadoEm: parseData(modelo.atualizadoEm)
  };
}

router.get('/modelos-permissoes', autenticarUsuario, async (req, res) => {
  const solicitante = await garantirSupAdmin(req, res);
  if (!solicitante) {
    return null;
  }

  try {
    const modelos = await listModelosPermissoes();
    return res.json({ modelos: modelos.map(formatarModeloPermissoes) });
  } catch (err) {
    console.error('Erro ao listar modelos de permissões:', err);
    return res.status(500).json({ error: 'Erro ao listar modelos de permissões.' });
  }
});

router.post('/modelos-permissoes', autenticarUsuario, async (req, res) => {
  const solicitante = await garantirSupAdmin(req, res);
  if (!solicitante) {
    return null;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const nome = body.nome ?? body.name;
  const permissoesPayload = body.permissoes ?? body.permissions ?? {};

  let permissoesNormalizadas;
  try {
    permissoesNormalizadas = normalizarPermissoesEstrutura(permissoesPayload, { strict: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const criado = await createModeloPermissoes({ nome, permissoes: permissoesNormalizadas });
    return res.status(201).json({ modelo: formatarModeloPermissoes(criado) });
  } catch (err) {
    if (err instanceof ModeloPermissoesError) {
      if (err.code === 'NOME_DUPLICADO') {
        return res.status(409).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }
    console.error('Erro ao criar modelo de permissões:', err);
    return res.status(500).json({ error: 'Erro ao criar modelo de permissões.' });
  }
});

router.patch('/modelos-permissoes/:id', autenticarUsuario, async (req, res) => {
  const solicitante = await garantirSupAdmin(req, res);
  if (!solicitante) {
    return null;
  }

  const modeloId = parsePositiveInteger(req.params.id);
  if (!modeloId) {
    return res.status(400).json({ error: 'Identificador de modelo inválido.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const nome = Object.prototype.hasOwnProperty.call(body, 'nome') ? body.nome : body.name;
  const permissoesPayload = Object.prototype.hasOwnProperty.call(body, 'permissoes')
    ? body.permissoes
    : body.permissions;

  let permissoesNormalizadas;
  if (permissoesPayload !== undefined) {
    try {
      permissoesNormalizadas = normalizarPermissoesEstrutura(permissoesPayload, { strict: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  try {
    const atualizado = await updateModeloPermissoes(modeloId, {
      nome,
      permissoes: permissoesNormalizadas
    });

    if (!atualizado) {
      return res.status(404).json({ error: 'Modelo de permissões não encontrado.' });
    }

    return res.json({ modelo: formatarModeloPermissoes(atualizado) });
  } catch (err) {
    if (err instanceof ModeloPermissoesError) {
      if (err.code === 'NOME_DUPLICADO') {
        return res.status(409).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }
    console.error('Erro ao atualizar modelo de permissões:', err);
    return res.status(500).json({ error: 'Erro ao atualizar modelo de permissões.' });
  }
});

router.delete('/modelos-permissoes/:id', autenticarUsuario, async (req, res) => {
  const solicitante = await garantirSupAdmin(req, res);
  if (!solicitante) {
    return null;
  }

  const modeloId = parsePositiveInteger(req.params.id);
  if (!modeloId) {
    return res.status(400).json({ error: 'Identificador de modelo inválido.' });
  }

  try {
    const removido = await deleteModeloPermissoes(modeloId);
    if (!removido) {
      return res.status(404).json({ error: 'Modelo de permissões não encontrado.' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('Erro ao remover modelo de permissões:', err);
    return res.status(500).json({ error: 'Erro ao remover modelo de permissões.' });
  }
});

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

router.patch('/:id', autenticarUsuario, async (req, res) => {
  const alvoId = parsePositiveInteger(req.params.id);
  if (!alvoId) {
    return res.status(400).json({ error: 'Identificador de usuário inválido.' });
  }

  let solicitante;
  let alvo;
  try {
    [solicitante, alvo] = await Promise.all([
      carregarUsuarioRaw(req.usuarioAutenticadoId),
      carregarUsuarioRaw(alvoId)
    ]);
  } catch (err) {
    console.error('Erro ao carregar dados para atualização de usuário:', err);
    return res.status(500).json({ error: 'Erro ao carregar dados do usuário.' });
  }

  if (!solicitante) {
    return res.status(401).json({ error: 'Usuário autenticado não encontrado.' });
  }

  if (!alvo) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const solicitanteSupAdmin = isSupAdminPerfil(solicitante.perfil);
  if (!solicitanteSupAdmin && solicitante.id !== alvoId) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const permissoesEntrada = Object.prototype.hasOwnProperty.call(body, 'permissoes')
    ? body.permissoes
    : Object.prototype.hasOwnProperty.call(body, 'permissions')
    ? body.permissions
    : undefined;
  const rawModeloPermissoesId = getFirstDefined(body, ['modeloPermissoesId', 'modelo_permissoes_id']);
  const aplicarModeloEntrada = getFirstDefined(body, [
    'aplicarPermissoesDoModelo',
    'sincronizarPermissoesDoModelo',
    'sincronizarPermissoesModelo'
  ]);

  if (
    !solicitanteSupAdmin &&
    (permissoesEntrada !== undefined || rawModeloPermissoesId !== undefined || aplicarModeloEntrada !== undefined)
  ) {
    return res.status(403).json({ error: 'Apenas Sup Admin pode atualizar permissões ou modelos de permissões.' });
  }

  let permissoesNormalizadas;
  let atualizarPermissoes = false;
  if (permissoesEntrada !== undefined) {
    try {
      permissoesNormalizadas = normalizarPermissoesEstrutura(permissoesEntrada, { strict: true });
      atualizarPermissoes = true;
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  let modeloPermissoesIdAtualizacao;
  if (rawModeloPermissoesId !== undefined) {
    if (rawModeloPermissoesId === null || rawModeloPermissoesId === '') {
      modeloPermissoesIdAtualizacao = null;
    } else {
      const parsedModeloId = parsePositiveInteger(rawModeloPermissoesId);
      if (!parsedModeloId) {
        return res.status(400).json({ error: 'Identificador de modelo inválido.' });
      }
      modeloPermissoesIdAtualizacao = parsedModeloId;
    }
  }

  let aplicarModelo;
  if (aplicarModeloEntrada !== undefined) {
    aplicarModelo = parseBoolean(aplicarModeloEntrada);
  }

  if (aplicarModelo === undefined && rawModeloPermissoesId !== undefined && permissoesEntrada === undefined) {
    aplicarModelo = modeloPermissoesIdAtualizacao !== null;
  }

  let modeloDestinoId = null;
  if (modeloPermissoesIdAtualizacao !== undefined && modeloPermissoesIdAtualizacao !== null) {
    modeloDestinoId = modeloPermissoesIdAtualizacao;
  }

  if (aplicarModelo) {
    if (modeloPermissoesIdAtualizacao === null) {
      return res.status(400).json({ error: 'Selecione um modelo válido para aplicar permissões.' });
    }
    if (!modeloDestinoId) {
      const atual = parsePositiveInteger(alvo.modelo_permissoes_id);
      if (!atual) {
        return res
          .status(400)
          .json({ error: 'Não é possível aplicar permissões porque o usuário não possui um modelo associado.' });
      }
      modeloDestinoId = atual;
    }
  }

  let modeloDestino = null;
  if (modeloDestinoId) {
    try {
      modeloDestino = await getModeloPermissoesById(modeloDestinoId);
    } catch (err) {
      console.error('Erro ao carregar modelo de permissões:', err);
      return res.status(500).json({ error: 'Erro ao carregar modelo de permissões.' });
    }

    if (!modeloDestino) {
      return res.status(404).json({ error: 'Modelo de permissões não encontrado.' });
    }
  }

  if (aplicarModelo) {
    try {
      permissoesNormalizadas = normalizarPermissoesEstrutura(modeloDestino?.permissoes ?? {}, { strict: true });
      atualizarPermissoes = true;
    } catch (err) {
      console.error('Modelo de permissões inválido:', err);
      return res.status(500).json({ error: 'Modelo de permissões inválido.' });
    }

    if (modeloPermissoesIdAtualizacao === undefined) {
      modeloPermissoesIdAtualizacao = modeloDestinoId;
    }
  }

  let nomeSanitizado;
  try {
    const nomeBruto = getFirstDefined(body, ['nome', 'name']);
    if (nomeBruto !== undefined) {
      nomeSanitizado = sanitizeNome(nomeBruto);
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let emailSanitizado;
  try {
    const emailBruto = getFirstDefined(body, ['email']);
    if (emailBruto !== undefined) {
      emailSanitizado = sanitizeEmail(emailBruto);
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

    const descricaoBruta = getFirstDefined(body, ['descricao', 'bio', 'sobre', 'observacoes']);
    descricaoSanitizada = sanitizeOptionalString(descricaoBruta, 'Descrição', 500);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (emailSanitizado !== undefined) {
    const emailAtual = typeof alvo.email === 'string' ? alvo.email.trim().toLowerCase() : '';
    if (emailSanitizado === emailAtual) {
      emailSanitizado = undefined;
    } else {
      try {
        const existente = await pool.query(
          'SELECT id FROM usuarios WHERE lower(email) = $1 AND id <> $2',
          [emailSanitizado, alvoId]
        );
        if (existente.rows.length > 0) {
          return res.status(409).json({ error: 'E-mail já está em uso por outro usuário.' });
        }
      } catch (err) {
        console.error('Erro ao validar e-mail durante atualização de usuário:', err);
        return res.status(500).json({ error: 'Erro ao validar o e-mail informado.' });
      }
    }
  }

  let colunas;
  try {
    colunas = await getUsuarioColumns();
  } catch (err) {
    console.error('Erro ao carregar metadados da tabela de usuários:', err);
    colunas = new Set();
  }

  const camposAtualizar = {};

  if (nomeSanitizado !== undefined && colunas.has('nome') && nomeSanitizado !== alvo.nome) {
    camposAtualizar.nome = nomeSanitizado;
  }

  if (emailSanitizado !== undefined && colunas.has('email')) {
    camposAtualizar.email = emailSanitizado;
  }

  const telefoneAtual = extrairPrimeiroValor(alvo, telefoneColunasPreferidas);
  const colunaTelefone = telefoneSanitizado !== undefined ? findAvailableColumn(colunas, telefoneColunasPreferidas) : null;
  if (colunaTelefone && telefoneSanitizado !== telefoneAtual) {
    camposAtualizar[colunaTelefone] = telefoneSanitizado;
  }

  const celularAtual = extrairPrimeiroValor(alvo, celularColunasPreferidas);
  const colunaCelular = celularSanitizado !== undefined ? findAvailableColumn(colunas, celularColunasPreferidas) : null;
  if (colunaCelular && celularSanitizado !== celularAtual) {
    camposAtualizar[colunaCelular] = celularSanitizado;
  }

  const whatsappAtual = extrairPrimeiroValor(alvo, whatsappColunasPreferidas);
  const colunaWhatsapp = whatsappSanitizado !== undefined ? findAvailableColumn(colunas, whatsappColunasPreferidas) : null;
  if (colunaWhatsapp && whatsappSanitizado !== whatsappAtual) {
    camposAtualizar[colunaWhatsapp] = whatsappSanitizado;
  }

  const colunaDescricao = colunas.has('descricao') ? 'descricao' : colunas.has('bio') ? 'bio' : null;
  if (colunaDescricao && descricaoSanitizada !== undefined && descricaoSanitizada !== alvo[colunaDescricao]) {
    camposAtualizar[colunaDescricao] = descricaoSanitizada;
  }

  if (modeloPermissoesIdAtualizacao !== undefined && colunas.has('modelo_permissoes_id')) {
    const atual = alvo.modelo_permissoes_id ?? null;
    if (modeloPermissoesIdAtualizacao !== atual) {
      camposAtualizar.modelo_permissoes_id = modeloPermissoesIdAtualizacao;
    }
  }

  if (atualizarPermissoes && colunas.has('permissoes')) {
    camposAtualizar.permissoes = permissoesNormalizadas;
  }

  if (!Object.keys(camposAtualizar).length) {
    return res.json(formatarUsuarioDetalhado(alvo));
  }

  const agora = new Date();
  if (colunas.has('ultima_alteracao')) camposAtualizar.ultima_alteracao = agora;
  if (colunas.has('ultima_alteracao_em')) camposAtualizar.ultima_alteracao_em = agora;
  if (colunas.has('ultima_atividade_em')) camposAtualizar.ultima_atividade_em = agora;
  if (colunas.has('ultima_acao_em')) camposAtualizar.ultima_acao_em = agora;

  let atualizadoComSucesso = false;
  try {
    atualizadoComSucesso = await updateUsuarioCampos(alvoId, camposAtualizar);
  } catch (err) {
    console.error('Falha ao atualizar dados pessoais do usuário:', err);
    return res.status(500).json({ error: 'Erro ao atualizar dados do usuário.' });
  }

  if (!atualizadoComSucesso) {
    return res.status(500).json({ error: 'Não foi possível atualizar os dados do usuário.' });
  }

  let atualizado;
  try {
    atualizado = await carregarUsuarioRaw(alvoId);
  } catch (err) {
    console.error('Erro ao recarregar usuário após atualização:', err);
    return res.status(500).json({ error: 'Erro ao carregar usuário atualizado.' });
  }

  try {
    await atualizarCacheLogin(alvoId, atualizado);
  } catch (err) {
    console.error('Falha ao atualizar cache de login após alteração de dados pessoais:', err);
  }

  return res.json(formatarUsuarioDetalhado(atualizado));
});

router.put('/:id/permissoes', autenticarUsuario, async (req, res) => {
  const alvoId = parsePositiveInteger(req.params.id);
  if (!alvoId) {
    return res.status(400).json({ error: 'Identificador de usuário inválido.' });
  }

  let solicitante;
  let alvo;
  try {
    [solicitante, alvo] = await Promise.all([
      carregarUsuarioRaw(req.usuarioAutenticadoId),
      carregarUsuarioRaw(alvoId)
    ]);
  } catch (err) {
    console.error('Erro ao carregar dados para atualização de permissões:', err);
    return res.status(500).json({ error: 'Erro ao carregar dados do usuário.' });
  }

  if (!solicitante) {
    return res.status(401).json({ error: 'Usuário autenticado não encontrado.' });
  }

  if (!isSupAdminPerfil(solicitante.perfil)) {
    return res.status(403).json({ error: 'Apenas Sup Admin pode atualizar permissões.' });
  }

  if (!alvo) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let permissoesPayload = body;
  if (Object.prototype.hasOwnProperty.call(body, 'permissoes')) {
    permissoesPayload = body.permissoes;
  } else if (Object.prototype.hasOwnProperty.call(body, 'permissions')) {
    permissoesPayload = body.permissions;
  }

  if (permissoesPayload === undefined) {
    return res.status(400).json({ error: 'Informe as permissões desejadas.' });
  }

  let permissoesNormalizadas;
  try {
    permissoesNormalizadas = normalizarPermissoesEstrutura(permissoesPayload, { strict: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let atualizacaoOk = false;
  try {
    atualizacaoOk = await updateUsuarioCampos(alvoId, { permissoes: permissoesNormalizadas });
  } catch (err) {
    console.error('Erro ao atualizar permissões do usuário:', err);
    return res.status(500).json({ error: 'Erro ao atualizar permissões do usuário.' });
  }

  if (!atualizacaoOk) {
    return res.status(500).json({ error: 'Não foi possível atualizar as permissões do usuário.' });
  }

  let atualizado;
  try {
    atualizado = await carregarUsuarioRaw(alvoId);
  } catch (err) {
    console.error('Erro ao recarregar usuário após atualização de permissões:', err);
    return res.status(500).json({ error: 'Erro ao carregar usuário atualizado.' });
  }

  const permissoes = obterPermissoesDoUsuario(atualizado);
  const resumo = construirResumoPermissoes(permissoes);

  return res.json({ permissoes, permissoesResumo: resumo });
});

const USER_ASSOCIATION_SOURCES = [
  { table: 'contatos_cliente', label: 'Contatos' },
  { table: 'prospeccoes', label: 'Prospecções' },
  { table: 'clientes', label: 'Clientes' },
  { table: 'orcamentos', label: 'Orçamentos' },
  { table: 'pedidos', label: 'Pedidos' }
];

const TEXTUAL_DATA_TYPES = new Set(['character varying', 'text', 'citext', 'varchar']);
const NAME_COLUMN_KEYWORDS = ['dono', 'responsavel', 'usuario', 'vendedor', 'owner', 'consultor'];
const EMAIL_COLUMN_KEYWORDS = ['email', 'mail'];

function isValidIdentifier(identifier) {
  return typeof identifier === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
}

function quoteIdentifier(identifier) {
  if (!isValidIdentifier(identifier)) {
    throw new Error(`Identificador inválido: ${identifier}`);
  }
  return `"${identifier}"`;
}

function schemaQualifiedTable(table) {
  return `${quoteIdentifier('public')}.${quoteIdentifier(table)}`;
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
      LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function getTableColumnInfo(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [table]
  );
  return rows;
}

function categorizeColumns(columns) {
  const nameColumns = new Set();
  const emailColumns = new Set();

  for (const column of columns) {
    const columnName = column.column_name;
    if (!isValidIdentifier(columnName)) {
      continue;
    }

    const dataType = typeof column.data_type === 'string' ? column.data_type.toLowerCase() : '';
    if (!TEXTUAL_DATA_TYPES.has(dataType)) {
      continue;
    }

    const normalized = columnName.toLowerCase();
    if (NAME_COLUMN_KEYWORDS.some(keyword => normalized.includes(keyword))) {
      nameColumns.add(columnName);
    }

    if (EMAIL_COLUMN_KEYWORDS.some(keyword => normalized.includes(keyword))) {
      emailColumns.add(columnName);
    }
  }

  return {
    nameColumns: Array.from(nameColumns),
    emailColumns: Array.from(emailColumns)
  };
}

function normalizeUserField(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildColumnMatchExpression(column, paramIndex) {
  const columnRef = quoteIdentifier(column);
  return `LOWER(TRIM(COALESCE(${columnRef}::text, ''))) = $${paramIndex}`;
}

async function findUsuarioAssociacoes(client, usuario) {
  const nome = normalizeUserField(usuario?.nome);
  const email = normalizeUserField(usuario?.email);
  const nomeLower = nome.toLowerCase();
  const emailLower = email.toLowerCase();

  if (!nomeLower && !emailLower) {
    return [];
  }

  const associacoes = [];

  for (const source of USER_ASSOCIATION_SOURCES) {
    if (!isValidIdentifier(source.table)) {
      continue;
    }

    if (!(await tableExists(client, source.table))) {
      continue;
    }

    const columns = await getTableColumnInfo(client, source.table);
    const { nameColumns, emailColumns } = categorizeColumns(columns);

    const entries = [];
    if (nomeLower) {
      for (const column of nameColumns) {
        entries.push({ column, type: 'nome', value: nomeLower });
      }
    }
    if (emailLower) {
      for (const column of emailColumns) {
        entries.push({ column, type: 'email', value: emailLower });
      }
    }

    if (!entries.length) {
      continue;
    }

    const whereParts = entries.map((entry, index) => buildColumnMatchExpression(entry.column, index + 1));
    const params = entries.map(entry => entry.value);
    const tableRef = schemaQualifiedTable(source.table);

    const totalQuery = `SELECT COUNT(*)::int AS total FROM ${tableRef} WHERE ${whereParts.join(' OR ')}`;
    const totalResult = await client.query(totalQuery, params);
    const total = Number(totalResult.rows[0]?.total ?? 0);

    if (!total) {
      continue;
    }

    const columnMatches = [];
    const processed = new Set();

    for (const entry of entries) {
      const key = `${entry.column}:${entry.type}`;
      if (processed.has(key)) {
        continue;
      }
      processed.add(key);

      const specificQuery = `SELECT COUNT(*)::int AS total FROM ${tableRef} WHERE ${buildColumnMatchExpression(
        entry.column,
        1
      )}`;
      const specificResult = await client.query(specificQuery, [entry.value]);
      const specificTotal = Number(specificResult.rows[0]?.total ?? 0);
      if (specificTotal > 0) {
        columnMatches.push({ column: entry.column, type: entry.type, total: specificTotal });
      }
    }

    associacoes.push({
      table: source.table,
      label: source.label,
      total,
      columns: columnMatches
    });
  }

  return associacoes;
}

async function transferirAssociacoesUsuario(client, associacoes, origem, destino) {
  const origemNome = normalizeUserField(origem?.nome);
  const origemEmail = normalizeUserField(origem?.email);
  const destinoNome = normalizeUserField(destino?.nome);
  const destinoEmail = normalizeUserField(destino?.email);
  const origemNomeLower = origemNome.toLowerCase();
  const origemEmailLower = origemEmail.toLowerCase();

  for (const associacao of associacoes) {
    if (!isValidIdentifier(associacao.table)) {
      continue;
    }
    if (!(await tableExists(client, associacao.table))) {
      continue;
    }

    const tableRef = schemaQualifiedTable(associacao.table);
    for (const columnMatch of associacao.columns || []) {
      if (!isValidIdentifier(columnMatch.column)) {
        continue;
      }

      const columnRef = quoteIdentifier(columnMatch.column);
      if (columnMatch.type === 'nome') {
        if (!origemNomeLower || !destinoNome) {
          continue;
        }
        const updateQuery = `UPDATE ${tableRef}
            SET ${columnRef} = $1
          WHERE ${buildColumnMatchExpression(columnMatch.column, 2)}`;
        await client.query(updateQuery, [destinoNome, origemNomeLower]);
      } else if (columnMatch.type === 'email') {
        if (!origemEmailLower || !destinoEmail) {
          continue;
        }
        const updateQuery = `UPDATE ${tableRef}
            SET ${columnRef} = $1
          WHERE ${buildColumnMatchExpression(columnMatch.column, 2)}`;
        await client.query(updateQuery, [destinoEmail, origemEmailLower]);
      }
    }
  }
}

async function removerUsuario(client, usuarioId) {
  if (await tableExists(client, 'usuarios_login_cache')) {
    await client.query('DELETE FROM usuarios_login_cache WHERE usuario_id = $1', [usuarioId]);
  }

  const resultado = await client.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
  return resultado.rowCount || 0;
}

router.delete('/:id', autenticarUsuario, async (req, res) => {
  const usuarioId = parsePositiveInteger(req.params.id);
  if (!usuarioId) {
    return res.status(400).json({ error: 'Identificador de usuário inválido.' });
  }

  const solicitante = await garantirSupAdmin(req, res);
  if (!solicitante) {
    return undefined;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, nome, email FROM usuarios WHERE id = $1', [usuarioId]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const usuario = rows[0];
    const associacoes = await findUsuarioAssociacoes(client, usuario);

    if (associacoes.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Usuário possui dados vinculados.',
        message: 'Não foi possível excluir o usuário pois existem dados atrelados a ele.',
        associacoes,
        usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email }
      });
    }

    const removidos = await removerUsuario(client, usuarioId);
    await client.query('COMMIT');

    if (!removidos) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    return res.json({ message: 'Exclusão concluída com sucesso.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao excluir usuário:', err);
    return res.status(500).json({ error: 'Erro ao excluir usuário.' });
  } finally {
    client.release();
  }
});

router.post('/:id/transferencia', autenticarUsuario, async (req, res) => {
  const usuarioId = parsePositiveInteger(req.params.id);
  if (!usuarioId) {
    return res.status(400).json({ error: 'Identificador de usuário inválido.' });
  }

  const solicitante = await garantirSupAdmin(req, res);
  if (!solicitante) {
    return undefined;
  }

  const destinoRaw = getFirstDefined(req.body, ['destinoId', 'destino_id']);
  const destinoId = parsePositiveInteger(destinoRaw);
  if (!destinoId) {
    return res.status(400).json({ error: 'Informe o usuário de destino para a transferência.' });
  }

  if (destinoId === usuarioId) {
    return res.status(400).json({ error: 'Selecione um usuário de destino diferente.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const [origemResult, destinoResult] = await Promise.all([
      client.query('SELECT id, nome, email FROM usuarios WHERE id = $1', [usuarioId]),
      client.query('SELECT id, nome, email FROM usuarios WHERE id = $1', [destinoId])
    ]);

    if (!origemResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (!destinoResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuário de destino não encontrado.' });
    }

    const origem = origemResult.rows[0];
    const destino = destinoResult.rows[0];

    const associacoes = await findUsuarioAssociacoes(client, origem);
    if (!associacoes.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Nenhum dado para transferir.',
        message: 'Nenhuma associação foi encontrada para este usuário.',
        associacoes: []
      });
    }

    const exigeNome = associacoes.some(assoc => assoc.columns.some(col => col.type === 'nome'));
    const exigeEmail = associacoes.some(assoc => assoc.columns.some(col => col.type === 'email'));

    const destinoNome = normalizeUserField(destino.nome);
    const destinoEmail = normalizeUserField(destino.email);

    if (exigeNome && !destinoNome) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Usuário de destino sem nome.',
        message: 'O usuário de destino precisa ter um nome cadastrado para receber os dados vinculados.'
      });
    }

    if (exigeEmail && !destinoEmail) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Usuário de destino sem e-mail.',
        message: 'O usuário de destino precisa ter um e-mail cadastrado para receber os dados vinculados.'
      });
    }

    await transferirAssociacoesUsuario(client, associacoes, origem, destino);
    const removidos = await removerUsuario(client, usuarioId);
    await client.query('COMMIT');

    if (!removidos) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    return res.json({
      message: 'Exclusão e transferência concluídas com sucesso.',
      associacoes,
      usuarioTransferido: { id: origem.id, nome: origem.nome, email: origem.email },
      destino: { id: destino.id, nome: destino.nome, email: destino.email }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao transferir dados do usuário:', err);
    return res.status(500).json({ error: 'Erro ao transferir dados do usuário.' });
  } finally {
    client.release();
  }
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

const obterPrimeiroTexto = valor => {
  if (typeof valor === 'string') {
    return valor;
  }
  if (Array.isArray(valor) && valor.length > 0) {
    const primeiro = valor[0];
    return typeof primeiro === 'string' ? primeiro : '';
  }
  return '';
};

const obterTokenDeObjeto = objeto => {
  if (!objeto || typeof objeto !== 'object') {
    return '';
  }

  const chavesPreferidas = ['token', 'th', 'code', 'codigo', 'hash'];
  const entradas = Object.entries(objeto);

  for (const chavePreferida of chavesPreferidas) {
    for (const [chave, valor] of entradas) {
      if (typeof chave === 'string' && chave.toLowerCase() === chavePreferida) {
        const texto = obterPrimeiroTexto(valor).trim();
        if (texto) {
          return texto;
        }
      }
    }
  }

  for (const [, valor] of entradas) {
    const texto = obterPrimeiroTexto(valor).trim();
    if (texto) {
      return texto;
    }
  }

  return '';
};

const obterTokenDeUrl = urlBruta => {
  if (typeof urlBruta !== 'string' || !urlBruta.includes('?')) {
    return '';
  }

  const [, query] = urlBruta.split('?', 2);
  try {
    const params = new URLSearchParams(query);
    const possiveisChaves = ['token', 'th', 'code', 'codigo', 'hash'];
    for (const chave of possiveisChaves) {
      const valor = params.get(chave);
      if (valor && valor.trim()) {
        return valor.trim();
      }
    }
    for (const valor of params.values()) {
      if (valor && valor.trim()) {
        return valor.trim();
      }
    }
  } catch (err) {
    console.warn('Não foi possível analisar parâmetros da URL para extração de token.', err);
  }
  return '';
};

const extrairToken = req => {
  if (!req || typeof req !== 'object') {
    return '';
  }

  const fontes = [];
  if (req.method === 'GET') {
    fontes.push(req.query);
  } else {
    fontes.push(req.body);
  }

  fontes.push(req.params);

  if (req.headers && typeof req.headers === 'object') {
    const cabecalhoAuth = obterPrimeiroTexto(req.headers.authorization).replace(/^Bearer\s+/i, '').trim();
    if (cabecalhoAuth) {
      return cabecalhoAuth;
    }
  }

  for (const fonte of fontes) {
    const token = obterTokenDeObjeto(fonte);
    if (token) {
      return token;
    }
  }

  const tokenUrl = obterTokenDeUrl(req.originalUrl || req.url);
  if (tokenUrl) {
    return tokenUrl;
  }

  return '';
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

const confirmarEmail = async (req, res) => {
  try {
    console.log('[confirmar-email]', {
      url: req.originalUrl,
      query: req.query,
      params: req.params,
      body: req.body
    });
    // Aceita token enviado via query (?token=..., ?th=...), body ou params (/confirmar-email/:token)
    const rawToken =
      (req.query && (req.query.token || req.query.th)) ||
      (req.body && (req.body.token || req.body.th)) ||
      (req.params && (req.params.token || req.params.th));

    const token = typeof rawToken === 'string' ? rawToken.trim() : '';

    if (!token) {
      return res.status(400).json({ ok: false, error: 'token ausente' });
    }

    const client = new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });
    await client.connect();

    // Procura usuário com esse token e ainda não confirmado
    const { rows } = await client.query(
      `SELECT id, email_confirmado, confirmacao_token_expira_em
         FROM usuarios
        WHERE confirmacao_token = $1
        LIMIT 1`,
      [token]
    );

    if (rows.length === 0) {
      await client.end();
      return res.status(400).json({ ok: false, error: 'token inválido' });
    }

    const u = rows[0];

    // Verifica expiração se existir
    if (u.confirmacao_token_expira_em && new Date(u.confirmacao_token_expira_em) < new Date()) {
      await client.end();
      return res.status(400).json({ ok: false, error: 'token expirado' });
    }

    if (u.email_confirmado === true) {
      await client.end();
      return res.json({ ok: true, message: 'e-mail já confirmado' });
    }

    // Confirma e invalida o token
    await client.query(
      `UPDATE usuarios
          SET email_confirmado = TRUE,
              email_confirmado_em = NOW(),
              confirmacao_token = NULL,
              confirmacao_token_revogado_em = NOW()
        WHERE id = $1`,
      [u.id]
    );

    await client.end();
    return res.json({ ok: true, message: 'e-mail confirmado com sucesso' });
  } catch (err) {
    console.error('confirmarEmail erro:', err);
    return res.status(500).json({ ok: false, error: 'erro interno' });
  }
};

exports.confirmarEmail = confirmarEmail;

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
    if (colunasTabela.has('aprovacao_token')) atualizacoes.push('aprovacao_token = NULL');
    if (colunasTabela.has('aprovacao_token_gerado_em')) {
      atualizacoes.push('aprovacao_token_gerado_em = NULL');
    }
    if (colunasTabela.has('aprovacao_token_expira_em')) {
      atualizacoes.push('aprovacao_token_expira_em = NULL');
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

router.get('/usuarios/confirmar-email', confirmarEmail);
router.get('/usuarios/confirmar-email/:token', confirmarEmail);
router.get('/confirmar-email', confirmarEmail);
router.get('/confirmar-email/:token', confirmarEmail);
router.post('/confirmar-email', confirmarEmail);
router.get('/reportar-email-incorreto', reportarEmailIncorreto);
router.post('/reportar-email-incorreto', reportarEmailIncorreto);

router.get('/aprovar', async (req, res) => {
  const token = typeof req.query?.token === 'string' ? req.query.token.trim() : '';

  if (!token) {
    return responder(req, res, 400, 'Token inválido', 'Token de aprovação não informado.');
  }

  try {
    const resultado = await pool.query(
      `SELECT id, nome, email, aprovacao_token_expira_em
         FROM usuarios
        WHERE aprovacao_token = $1`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return responder(req, res, 404, 'Token inválido', 'Este link de aprovação não é mais válido.');
    }

    const usuario = resultado.rows[0];

    if (usuario.aprovacao_token_expira_em) {
      const expira =
        usuario.aprovacao_token_expira_em instanceof Date
          ? usuario.aprovacao_token_expira_em
          : new Date(usuario.aprovacao_token_expira_em);
      if (!Number.isNaN(expira.getTime()) && expira.getTime() < Date.now()) {
        return responder(req, res, 410, 'Link expirado', 'Este link de aprovação expirou. Solicite uma nova confirmação.');
      }
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
    if (colunas.has('aprovacao_token')) camposAtualizacao.push('aprovacao_token = NULL');
    if (colunas.has('aprovacao_token_gerado_em')) {
      camposAtualizacao.push('aprovacao_token_gerado_em = NULL');
    }
    if (colunas.has('aprovacao_token_expira_em')) {
      camposAtualizacao.push('aprovacao_token_expira_em = NULL');
    }

    const atualizado = await pool.query(
      `UPDATE usuarios
          SET ${camposAtualizacao.join(', ')}
        WHERE id = $1
      RETURNING *`,
      [usuario.id]
    );

    if (atualizado.rows.length === 0) {
      return responder(req, res, 404, 'Usuário não encontrado', 'Não foi possível localizar o usuário para aprovação.');
    }

    const usuarioAtualizado = atualizado.rows[0];

    try {
      await atualizarCacheLogin(usuarioAtualizado.id, usuarioAtualizado);
    } catch (err) {
      console.error('Falha ao atualizar cache de login após aprovação automática de usuário:', err);
    }

    try {
      if (usuarioAtualizado.email) {
        await sendUserActivationNotice({ to: usuarioAtualizado.email, nome: usuarioAtualizado.nome });
      }
    } catch (err) {
      console.error('sendUserActivationNotice error', err);
    }

    return responder(
      req,
      res,
      200,
      'Usuário ativado',
      'O usuário foi ativado com sucesso.',
      { usuario: formatarUsuario(usuarioAtualizado) }
    );
  } catch (err) {
    console.error('Erro ao aprovar usuário com token:', err);
    return responder(req, res, 500, 'Erro interno', 'Não foi possível aprovar o usuário.');
  }
});

router.get('/:id', autenticarUsuario, async (req, res) => {
  const alvoId = parsePositiveInteger(req.params.id);
  if (!alvoId) {
    return res.status(400).json({ error: 'Identificador de usuário inválido.' });
  }

  let solicitante;
  let alvo;
  try {
    [solicitante, alvo] = await Promise.all([
      carregarUsuarioRaw(req.usuarioAutenticadoId),
      carregarUsuarioRaw(alvoId)
    ]);
  } catch (err) {
    console.error('Erro ao carregar dados para consulta de usuário:', err);
    return res.status(500).json({ error: 'Erro ao carregar dados do usuário.' });
  }

  if (!solicitante) {
    return res.status(401).json({ error: 'Usuário autenticado não encontrado.' });
  }

  if (!alvo) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const solicitanteSupAdmin = isSupAdminPerfil(solicitante.perfil);
  if (!solicitanteSupAdmin && solicitante.id !== alvoId) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  return res.json(formatarUsuarioDetalhado(alvo));
});

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

  const permissoes = obterPermissoesDoUsuario(u);
  const permissoesResumo = construirResumoPermissoes(permissoes);

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
    modeloPermissoesId: u.modelo_permissoes_id ?? null,
    modelo_permissoes_id: u.modelo_permissoes_id ?? null,
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
    especificacaoUltimaAlteracao: especificacaoUltimaAcao || null,
    permissoesResumo
  };
}

module.exports = router;
