// Rotas de permissões.
//
//   GET    /api/permissoes/catalogo          -> catálogo (módulos, ações, colunas)
//   GET    /api/permissoes/efetivas          -> permissões do usuário autenticado
//   GET    /api/permissoes/modelo/:modeloId  -> permissões de um perfil
//   PUT    /api/permissoes/modelo/:modeloId  -> grava permissões de um perfil
//   DELETE /api/permissoes/modelo/:modeloId  -> remove permissões de um perfil
//
// Também exporta `exigirPermissao(chave)`, middleware que bloqueia (403) uma
// rota quando o usuário não tem a permissão — a proteção real, já que esconder
// botões na interface não impede chamadas diretas à API.

const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { getToken } = require('./tokenStore');
const { PERMISSIONS_CATALOG } = require('./permissionsCatalog');
const permissoesRepo = require('./permissionsRepository');

const router = express.Router();

/** Extrai o id do usuário de um JWT (sem validar assinatura — só leitura). */
function extractUserIdFromToken(rawToken) {
  try {
    const token = String(rawToken || '').replace(/^Bearer\s+/i, '').trim();
    const parte = token.split('.')[1];
    if (!parte) return null;
    const json = Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload.id ?? payload.userId ?? payload.sub ?? null;
  } catch (_) {
    return null;
  }
}

// Cache da identidade do usuário.
// Sem isto, CADA rota protegida fazia uma ida extra ao upstream só para
// descobrir quem é o usuário — dobrando a latência de toda a aplicação.
// A identidade praticamente não muda dentro de uma sessão.
const cacheUsuario = new Map();
const CACHE_USUARIO_TTL_MS = 60_000;

async function carregarUsuarioAtual(req) {
  const token = req.headers?.authorization || getToken() || '';
  const userId = extractUserIdFromToken(token);
  const chaveCache = userId ? `id:${userId}` : `tok:${String(token).slice(-24)}`;

  const emCache = cacheUsuario.get(chaveCache);
  if (emCache && Date.now() < emCache.expiraEm) {
    return emCache.valor;
  }

  const api = createApiClient(req);
  try {
    const usuario = userId
      ? await api.get(`/api/usuarios/${userId}`)
      : await api.get('/api/usuarios/me');
    cacheUsuario.set(chaveCache, { valor: usuario, expiraEm: Date.now() + CACHE_USUARIO_TTL_MS });
    return usuario;
  } catch (err) {
    console.error('[permissoes] não foi possível identificar o usuário:', err?.message || err);
    return null;
  }
}

/** Cache curto das permissões efetivas por usuário (evita reler 19 tabelas a cada request). */
const cacheEfetivas = new Map();
const CACHE_TTL_MS = 30_000;

function lerCache(userId) {
  const item = cacheEfetivas.get(String(userId));
  if (!item) return null;
  if (Date.now() > item.expiraEm) { cacheEfetivas.delete(String(userId)); return null; }
  return item.valor;
}
function gravarCache(userId, valor) {
  cacheEfetivas.set(String(userId), { valor, expiraEm: Date.now() + CACHE_TTL_MS });
}
function limparCache() { cacheEfetivas.clear(); cacheUsuario.clear(); }

async function obterPermissoesEfetivas(req) {
  const usuario = await carregarUsuarioAtual(req);
  if (!usuario) return permissoesRepo.emptyPermissions();
  const chave = usuario.id ?? 'anon';
  const emCache = lerCache(chave);
  if (emCache) return emCache;
  const api = createApiClient(req);
  const permissoes = await permissoesRepo.loadPermissionsForUsuario(api, usuario);
  gravarCache(chave, permissoes);
  return permissoes;
}

// --------------------------------------------------------------------------
// Rotas
// --------------------------------------------------------------------------

/** { 'materia-prima': 'mp', 'orcamentos': 'orc', ... } */
function mapaPaginas() {
  const mapa = {};
  for (const mod of Object.values(PERMISSIONS_CATALOG)) {
    if (mod.page) mapa[mod.page] = mod.code;
    mapa[mod.code] = mod.code;
  }
  return mapa;
}

router.get('/catalogo', (_req, res) => {
  res.json(PERMISSIONS_CATALOG);
});

router.get('/efetivas', async (req, res) => {
  try {
    const usuario = await carregarUsuarioAtual(req);

    // Não foi possível identificar o usuário (token ausente/inválido, API fora).
    // Sinaliza "erro" para que a INTERFACE não restrinja nada — travar a tela
    // inteira por uma falha de identificação deixaria o app inutilizável.
    // A segurança continua no backend: exigirPermissao() nega por conta própria.
    if (!usuario) {
      return res.status(200).json({
        usuarioId: null,
        perfil: null,
        supAdmin: false,
        permissoes: permissoesRepo.emptyPermissions(),
        erro: true
      });
    }

    const permissoes = await obterPermissoesEfetivas(req);
    res.json({
      usuarioId: usuario.id ?? null,
      perfil: usuario.perfil ?? null,
      supAdmin: permissoesRepo.isSupAdmin(usuario),
      modeloPermissoesId: usuario.modelo_permissoes_id ?? null,
      // mapa "página do menu" -> "código do módulo" (ex.: materia-prima -> mp),
      // necessário para o front decidir a visibilidade dos itens da sidebar.
      paginas: mapaPaginas(),
      permissoes
    });
  } catch (err) {
    console.error('Erro ao carregar permissões efetivas:', err);
    res.status(200).json({ permissoes: permissoesRepo.emptyPermissions(), erro: true });
  }
});

router.get('/modelo/:modeloId', async (req, res) => {
  try {
    const api = createApiClient(req);
    const permissoes = await permissoesRepo.loadPermissionsForModelo(api, req.params.modeloId);
    res.json({ modeloId: Number(req.params.modeloId), permissoes });
  } catch (err) {
    console.error('Erro ao carregar permissões do modelo:', err);
    res.status(err.status || 500).json({ error: 'Erro ao carregar permissões do modelo' });
  }
});

router.put('/modelo/:modeloId', async (req, res) => {
  try {
    const api = createApiClient(req);
    await permissoesRepo.savePermissionsForModelo(api, req.params.modeloId, req.body?.permissoes || {});
    limparCache();
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao salvar permissões do modelo:', err);
    res.status(err.status || 500).json({ error: 'Erro ao salvar permissões do modelo' });
  }
});

router.delete('/modelo/:modeloId', async (req, res) => {
  try {
    const api = createApiClient(req);
    await permissoesRepo.deletePermissionsForModelo(api, req.params.modeloId);
    limparCache();
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir permissões do modelo:', err);
    res.status(err.status || 500).json({ error: 'Erro ao excluir permissões do modelo' });
  }
});

/**
 * Middleware de proteção: use nas rotas sensíveis.
 *   router.delete('/:id', exigirPermissao('mp.delete'), handler)
 */
/**
 * `chave` pode ser uma string OU uma função (req) => string, para casos em que a
 * permissão depende do que está sendo feito. Exemplo: PUT /pedidos/:id/status
 * muda o pedido para Enviado ou Entregue — checar sempre "confirmar" negava quem
 * só tinha "dar como entregue" e, pior, deixava quem tinha "confirmar" despachar
 * e entregar sem ter essas permissões.
 */
function exigirPermissao(chaveOuFn) {
  return async (req, res, next) => {
    const bruto = typeof chaveOuFn === 'function' ? chaveOuFn(req) : chaveOuFn;
    // Uma rota pode exigir MAIS DE UMA permissao: e o caso das rotas de
    // orcamento que, ao aprovar, tambem convertem em pedido e abatem estoque.
    // Nessas, exigir apenas uma das duas deixava passar quem nao tinha a outra.
    const chaves = Array.isArray(bruto) ? bruto.filter(Boolean) : [bruto];
    try {
      const permissoes = await obterPermissoesEfetivas(req);
      const negada = chaves.find(c => !permissoesRepo.can(permissoes, c));
      if (!negada) return next();
      return res.status(403).json({
        error: 'Permissão negada',
        code: 'FORBIDDEN',
        permissao: negada
      });
    } catch (err) {
      console.error('[permissoes] falha ao verificar permissão:', err?.message || err);
      return res.status(403).json({ error: 'Permissão negada', code: 'FORBIDDEN', permissao: chaves[0] });
    }
  };
}

/**
 * Guarda de rota para o que SÓ o Sup Admin pode fazer.
 *
 * Vale junto com `exigirPermissao`, não no lugar dela: a permissão diz que a
 * ação está habilitada para o modelo; esta diz que o perfil é o certo. Em
 * exclusão irreversível, uma configuração errada de modelo não pode ser a única
 * coisa entre o usuário e o dado apagado.
 */
function exigirSupAdmin(req, res, next) {
  carregarUsuarioAtual(req)
    .then(usuario => {
      if (permissoesRepo.isSupAdmin(usuario)) return next();
      return res.status(403).json({
        error: 'Ação restrita ao Sup Admin',
        code: 'FORBIDDEN_SUP_ADMIN'
      });
    })
    .catch(err => {
      console.error('[permissoes] falha ao verificar Sup Admin:', err?.message || err);
      res.status(403).json({ error: 'Ação restrita ao Sup Admin', code: 'FORBIDDEN_SUP_ADMIN' });
    });
}

/**
 * Versão consultável do `exigirSupAdmin`, para quando a restrição vale só para
 * PARTE do que a rota faz.
 *
 * Exemplo: editar a prospecção é permitido a quem tem `pros.edit`, mas trocar
 * o responsável dentro do mesmo PUT é privativo do Sup Admin. Como middleware
 * isso barraria a edição inteira; aqui a rota decide o que fazer.
 */
async function ehSupAdmin(req) {
  try {
    return permissoesRepo.isSupAdmin(await carregarUsuarioAtual(req));
  } catch (err) {
    console.error('[permissoes] falha ao verificar Sup Admin:', err?.message || err);
    return false;
  }
}

module.exports = router;
module.exports.exigirPermissao = exigirPermissao;
module.exports.exigirSupAdmin = exigirSupAdmin;
module.exports.ehSupAdmin = ehSupAdmin;
module.exports.obterPermissoesEfetivas = obterPermissoesEfetivas;
module.exports.limparCachePermissoes = limparCache;
