// carrega variáveis do .env sem mensagens informativas
const { isDev } = require('./dataConfig');

const express = require('express');
const cors = require('cors');
const path = require('path');
const clientesRouter = require('./clientesController');
const passwordResetRouter = require('./passwordResetRoutes');
const usuariosRouter = require('./usuariosController');
const transportadorasRouter = require('./transportadorasController');
const orcamentosRouter = require('./orcamentosController');
const pedidosRouter = require('./pedidosController');
const prospeccoesRouter = require('./prospeccoesController');
const iaRouter = require('./iaController');
const dashboardRouter = require('./dashboardController');
const notificationsRouter = require('./notificationsController');
const db = require('./db');
const { normalizeToken } = require('./apiHttpClient');
const { getToken } = require('./tokenStore');

const DEFAULT_BEARER_TOKEN = normalizeToken(
  process.env.API_BEARER_TOKEN || process.env.DEFAULT_API_TOKEN || 'test-token'
);

db.init({ tokenProvider: getToken });

const { sanitizarSaida } = require('./sanitizarSaida');

const app = express();

// Origem da API remota, sem o sufixo /api — usada para repassar as imagens.
const API_BASE_ORIGIN = (
  process.env.API_BASE_URL || process.env.API_URL || 'https://api.santissimodecor.com.br'
).replace(/\/+$/, '').replace(/\/api$/, '');
app.use(cors());
app.use(express.json({ limit: '3mb' }));

if (isDev) {
  app.use((req, res, next) => {
    // Bloqueia páginas externas tentando usar a sessão do app pelo loopback.
    const origin = req.headers.origin;
    if (origin && origin !== 'null' && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return res.status(403).json({ error: 'Origem não autorizada.' });
    }
    const json = res.json.bind(res);
    res.json = body => json(sanitizarSaida(body));
    next();
  });
}

app.use((req, _res, next) => {
  if (!req.headers.authorization) {
    const stored = getToken();
    if (stored) {
      req.headers.authorization = `Bearer ${normalizeToken(stored)}`;
    } else if (DEFAULT_BEARER_TOKEN) {
      req.headers.authorization = `Bearer ${DEFAULT_BEARER_TOKEN}`;
    }
  }
  next();
});

if (isDev) {
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' && ['/usuarios/confirmar-email', '/usuarios/aprovar'].includes(req.path)) return next();
    try {
      require('./localAuth').verifyToken(req.headers.authorization);
      next();
    } catch (_) { res.status(401).json({ error: 'Sessão expirada. Entre novamente.' }); }
  });
}

app.use('/api/clientes', clientesRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/transportadoras', transportadorasRouter);
app.use('/api/orcamentos', orcamentosRouter);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/prospeccoes', prospeccoesRouter);
app.use('/api/ia', iaRouter);
// Fiscal (NF-e): configuração do emitente, certificado e SEFAZ. Antes do
// proxy genérico, que não confere permissão.
app.use('/api/fiscal', require('./fiscalController'));
// Cobrança (boletos BB): configuração, credenciais e teste de conexão.
app.use('/api/cobranca', require('./cobrancaController'));
// Financeiro completo (fase G): comissões, ajustes, produção, fechamentos e pagamentos.
app.use('/api/financeiro', require('./financeiroController'));
// Devolução de pedidos (parcial e total): peças ao estoque, parcelas, boletos no BB e reembolso.
app.use('/api/devolucoes', require('./devolucoesController'));
// Antes do proxy genérico `app.get('/api/:table')` lá embaixo: montado depois,
// ele responderia /api/dashboard como se "dashboard" fosse uma tabela — sem
// conferir permissão e com o cache que nunca expira.
app.use('/api/dashboard', dashboardRouter);

const { createApiClient } = require('./apiHttpClient');
const apiCache = new Map();
const CACHE_TTL_MS = Number.parseInt(process.env.API_TABLE_CACHE_TTL_MS || '0', 10);

function getTableCache(table) {
  if (!apiCache.has(table)) {
    apiCache.set(table, new Map());
  }
  return apiCache.get(table);
}

function buildCacheKey(query = {}) {
  const entries = [];
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null || item === '') return;
        entries.push([key, String(item)]);
      });
      continue;
    }
    if (value === undefined || value === null || value === '') continue;
    entries.push([key, String(value)]);
  }

  if (!entries.length) return '';
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return entries.map(([key, value]) => `${key}=${value}`).join('&');
}

function readCache(table, cacheKey) {
  const tableCache = apiCache.get(table);
  if (!tableCache) return null;
  const entry = tableCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    tableCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function writeCache(table, cacheKey, value) {
  const tableCache = getTableCache(table);
  const expiresAt = CACHE_TTL_MS > 0 ? Date.now() + CACHE_TTL_MS : null;
  tableCache.set(cacheKey, { value, expiresAt });
}

function invalidateCache(table) {
  if (!table) {
    apiCache.clear();
    return;
  }
  apiCache.delete(table);
}

// Sem guarda, esta rota expunha todos os contatos de todos os clientes.
app.get('/api/contatos_cliente', require('./permissionsController').exigirPermissao('ctt.view'), async (req, res) => {
  try {
    // Cria o cliente com base na requisição atual (injeta token automaticamente)
    const api = createApiClient(req);

    const query = req._parsedUrl.search || '';

    // Agora sim, o cliente possui o método .get()
    const data = sanitizarSaida(await api.get(`/api/contatos_cliente${query}`));

    res.status(200).json(data);
  } catch (err) {
    console.error('Erro no proxy /api/contatos_cliente:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Erro interno ao buscar contatos do cliente' });
  }
});

app.use('/api/permissoes', require('./permissionsController'));
app.use('/api/notifications', notificationsRouter);
app.use(passwordResetRouter);
// As fotos de perfil ficam na API remota (/imagens/perfis/...). O front resolve
// URLs contra o backend LOCAL, que não servia esse caminho — o avatar caía
// sempre nas iniciais. Repassamos a imagem por aqui.
// (app.use e não app.get('/imagens/*'): no Express 5 o curinga precisa de nome)
app.use('/imagens', async (req, res) => {
  if (isDev) return res.sendStatus(404); // Fotos DEV são lidas do BYTEA local.
  try {
    const destino = `${API_BASE_ORIGIN}${req.originalUrl}`;
    const resposta = await fetch(destino);
    if (!resposta.ok) return res.sendStatus(resposta.status);
    const tipo = resposta.headers.get('content-type');
    if (tipo) res.set('Content-Type', tipo);
    res.set('Cache-Control', 'public, max-age=300');
    const buffer = Buffer.from(await resposta.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Falha ao repassar imagem de perfil:', err?.message || err);
    res.sendStatus(502);
  }
});

app.use('/pdf', express.static(path.join(__dirname, '../src/pdf')));
app.use('/styles', express.static(path.join(__dirname, '../src/styles')));
app.use('/js', express.static(path.join(__dirname, '../src/js')));

// Tabelas que o proxy generico NUNCA deve servir ao renderer. Sem esta lista,
// qualquer usuario lia as proprias tabelas de permissao (perm_*) e os modelos de
// perfil — ou seja, dava para inspecionar e mapear todo o controle de acesso.
// O backend le essas tabelas pelo cliente da API remota, nao por aqui.
//
// As tabelas de prospeccao entram aqui porque o proxy generico NAO checa
// permissao: sem o bloqueio, `GET /api/prospeccoes` entregaria todo o pipeline
// comercial a qualquer usuario logado, ignorando `pros.view`. Tudo do modulo
// passa por prospeccoesController, que aplica exigirPermissao() rota a rota.
//
// O mesmo vale para as tabelas do modulo de IA, e ali o prefixo e `ia_`
// inteiro. Ja foi `ia_extraca`, e com esse sufixo mais longo
// `ia_extracao_arquivos` e `ia_extracao_itens` ficavam bloqueadas mas
// `ia_extracoes` (com "o") passava batido -- e ela e justamente a tabela que
// lista TODAS as leituras. Depois veio `ia_configuracao`, que nao casava com
// `ia_extra` nenhum: sem ela na lista, a trava de Sup Admin do
// PUT /api/ia/config nao valeria nada, porque qualquer usuario logado gravaria
// a linha direto por aqui e trocaria o modelo de todo mundo.
//
// A licao das duas vezes e a mesma: prefixo do MODULO, nao da tabela.
const TABELAS_BLOQUEADAS = /^(perm_|modelos_permissoes$|usuarios(?:_|$)|password_|prospeccoes$|prospeccao_|ia_)/i;
// Em DEV uma rota genérica só pode alcançar tabelas de negócio conhecidas.
// Isso exclui também tabelas extras/segredos existentes no PostgreSQL local.
const TABELAS_PUBLICAS_DEV = new Set([
  'cancelamento_destinacoes', 'categoria', 'estoque_movimentos', 'colecao',
  'etapas_producao', 'clientes', 'materia_prima_movimentacoes', 'materia_prima_ordenada',
  'notificacoes_estoque', 'orcamento_parcelas', 'orcamentos', 'pedido_itens_ext',
  'pedido_parcelas', 'pedidos_itens_faltantes', 'pedidos_itens', 'orcamentos_itens',
  'pedidos', 'ordem_producao_itens', 'pedido_historico_eventos', 'produtos_insumos',
  'produtos_em_cada_ponto', 'precos_detalhados', 'realocacoes', 'tabela_fixa',
  'transportadoras', 'unidades', 'reservas_estoque', 'vw_modal_conversao',
  'vw_pedidos_candidatos_realocacao', 'vw_relatorio_producao', 'contatos_cliente',
  'ordens_producao', 'materia_prima', 'produtos'
]);

app.get('/api/:table', async (req, res) => {
  const { table } = req.params;
  if (!table) {
    res.status(400).json({ error: 'Tabela inválida' });
    return;
  }
  if (TABELAS_BLOQUEADAS.test(table) || (isDev && !TABELAS_PUBLICAS_DEV.has(table))) {
    return res.status(403).json({ error: 'Acesso negado a esta tabela', code: 'FORBIDDEN' });
  }

  try {
    const api = createApiClient(req);
    const cacheKey = buildCacheKey(req.query);
    const cached = readCache(table, cacheKey);
    if (cached) {
      res.status(200).json(cached);
      return;
    }

    const bruto = await api.get(`/api/${table}`, { query: req.query });
    const data = sanitizarSaida(bruto);
    writeCache(table, cacheKey, data);
    res.status(200).json(data);
  } catch (err) {
    console.error('Erro no proxy /api/:table:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Erro interno ao buscar dados' });
  }
});

app.post('/api/:table', async (req, res) => {
  const { table } = req.params;
  if (!table) {
    res.status(400).json({ error: 'Tabela inválida' });
    return;
  }
  // A mesma trava do GET. Faltava aqui: o GET protegia a LEITURA das tabelas de
  // permissao, mas a ESCRITA seguia aberta — dava para inserir linha em perm_*,
  // modelos_permissoes ou usuarios direto pelo proxy, sem passar por nenhuma
  // checagem. Escrever nessas tabelas so pelos controllers dedicados.
  if (TABELAS_BLOQUEADAS.test(table) || (isDev && !TABELAS_PUBLICAS_DEV.has(table))) {
    return res.status(403).json({ error: 'Acesso negado a esta tabela', code: 'FORBIDDEN' });
  }

  try {
    const api = createApiClient(req);
    const created = await api.post(`/api/${table}`, req.body);
    invalidateCache(table);
    res.status(201).json(created);
  } catch (err) {
    console.error('Erro no proxy POST /api/:table:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Erro interno ao salvar dados' });
  }
});

app.get('/status', (_req, res) => {
  res.json({ status: 'ok' });
});

async function runHealthCheck() {
  const health = await db.healthCheck();
  const dbStatus = db.getStatus();
  const ok = Boolean(health?.ok && dbStatus.ready);
  const statusCode = ok ? 200 : health?.statusCode || 503;

  return {
    statusCode,
    status: ok ? 'ok' : 'error',
    db_ready: ok,
    db_ok: ok,
    db_status: ok ? 'ready' : 'error',
    last_error: health?.lastError || dbStatus.lastError || null,
    last_success_at: dbStatus.lastSuccessAt || null,
    last_failure_at: dbStatus.lastFailureAt || null,
    token_ready: dbStatus.ready
  };
}

async function handleHealthz(req, res) {
  try {
    const payload = await runHealthCheck();
    res.status(payload.statusCode).json({
      status: payload.status,
      db_ok: payload.db_ok,
      db_ready: payload.db_ready,
      db_status: payload.db_status,
      last_error: payload.last_error,
      last_success_at: payload.last_success_at,
      last_failure_at: payload.last_failure_at,
      token_ready: payload.token_ready
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db_ok: false,
      db_ready: false,
      db_status: 'error',
      last_error: { message: err?.message || 'health-check-error' }
    });
  }
}

app.get('/healthz', handleHealthz);
app.get('/healthz/combined', handleHealthz);
app.get('/healthz/db', handleHealthz);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  if (!process.env.PORT) console.warn('PORT not set, defaulting to 3000');
  const DEBUG = process.env.DEBUG === 'true';
  const server = app.listen(PORT, '127.0.0.1', () => {
    if (DEBUG) console.log(`API server running on port ${PORT}`);
  });
  try {
    const keepAliveTimeout = 65_000;
    server.keepAliveTimeout = Math.max(server.keepAliveTimeout ?? 0, keepAliveTimeout);
    server.headersTimeout = Math.max(server.headersTimeout ?? 0, keepAliveTimeout + 5_000);
  } catch (err) {
    if (process.env.DEBUG === 'true') {
      console.warn('[server] unable to adjust keep-alive timeouts:', err);
    }
  }
}

// Conciliação automática com o Banco do Brasil (boletos, fase F): só no
// processo principal do app. Nos testes e no servidor solto não liga.
if (process.versions && process.versions.electron && process.env.NODE_ENV !== 'test') {
  try {
    require('./cobranca/agendaConciliacao').iniciarNoApp();
  } catch (err) {
    console.error('[cobranca] a conciliação automática não iniciou:', err?.message || err);
  }
}

module.exports = app;
