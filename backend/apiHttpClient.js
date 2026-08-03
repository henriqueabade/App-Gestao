const { getToken } = require('./tokenStore');

const RAW_API_BASE_URL =
  (process.env.API_BASE_URL && process.env.API_BASE_URL.trim()) ||
  (process.env.API_URL && process.env.API_URL.trim()) ||
  'https://api.santissimodecor.com.br';
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, '');
const DEFAULT_BEARER_TOKEN = normalizeToken(
  process.env.API_BEARER_TOKEN || process.env.DEFAULT_API_TOKEN || 'test-token'
);

const FORBIDDEN_OPERATORS = ['or', 'and', 'not'];
const MANDATORY_FILTER_KEYS = ['filtro', 'filter'];

function logValidationIssue(message, context = {}) {
  const logContext = Object.keys(context).length ? context : undefined;
  console.warn(`[api-http-client] ${message}`, logContext);
}

function isForbiddenOperatorValue(value = '') {
  const normalized = String(value).toLowerCase();
  return FORBIDDEN_OPERATORS.some(op =>
    normalized === op || normalized.startsWith(`${op}(`) || normalized.startsWith(`${op}=`) || normalized.includes(`${op}.`)
  );
}

function hasForbiddenOperators(payload = {}) {
  if (!payload || typeof payload !== 'object') return null;

  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_OPERATORS.includes(String(key).toLowerCase())) {
      return { key, value };
    }
    if (Array.isArray(value)) {
      const invalidItem = value.find(item => isForbiddenOperatorValue(item));
      if (invalidItem !== undefined) {
        return { key, value: invalidItem };
      }
    } else if (value !== null && typeof value !== 'object' && isForbiddenOperatorValue(value)) {
      return { key, value };
    }
  }

  return null;
}

function findEmptyMandatoryFilters(payload = {}) {
  if (!payload || typeof payload !== 'object') return [];

  const emptyKeys = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!MANDATORY_FILTER_KEYS.includes(String(key).toLowerCase())) continue;

    if (Array.isArray(value)) {
      const sanitized = value.map(item => (typeof item === 'string' ? item.trim() : item)).filter(item => item !== undefined && item !== null);
      if (!sanitized.length || sanitized.every(item => item === '')) {
        emptyKeys.push(key);
      }
      continue;
    }

    const normalized = typeof value === 'string' ? value.trim() : value;
    if (normalized === '' || normalized === null || normalized === undefined) {
      emptyKeys.push(key);
    }
  }

  return emptyKeys;
}

function appendQueryParam(searchParams, key, value) {
  if (Array.isArray(value)) {
    value.forEach(item => {
      if (item === undefined || item === null || item === '') return;
      searchParams.append(key, String(item));
    });
    return;
  }

  if (value === undefined || value === null || value === '') return;
  searchParams.append(key, String(value));
}

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendQueryParam(searchParams, key, value));
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

/**
 * O que a API disse, junto do número do status.
 *
 * A API responde erro assim: `{ error: "Erro no INSERT", detalhe: "<mensagem
 * do Postgres>" }`. O `detalhe` é onde vem "violates foreign key constraint
 * X", "null value in column Y" — o diagnóstico pronto. Guardá-lo só em
 * `error.body` e mostrar apenas "500" transformava qualquer falha de escrita
 * em adivinhação: foi assim que uma violação de chave estrangeira em
 * `pedido_itens_ext` passou três rodadas de investigação sem ser vista.
 */
function descreverFalha(corpo) {
  if (!corpo || typeof corpo !== 'object') return '';
  const partes = [corpo.error, corpo.detalhe || corpo.detail || corpo.message]
    .map(p => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  if (!partes.length) return '';
  return ` — ${[...new Set(partes)].join(': ')}`;
}

function normalizeToken(rawToken) {
  if (typeof rawToken !== 'string') return '';
  const trimmed = rawToken.trim();
  if (!trimmed) return '';
  if (/^Bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^Bearer\s+/i, '').trim();
  }
  return trimmed;
}

/**
 * TRAVA DE SEGURANÇA: nenhum teste pode falar com a API real.
 *
 * Motivo: este client aponta para a API de produção por padrão e se autentica
 * com o JWT gravado em data/authToken.json (a sessão real de quem usa o app).
 * Os testes sobem um Express com os routers de verdade; qualquer rota que faça
 * proxy (e várias fazem, inclusive DELETE /usuarios/:id) executava a operação
 * NO BANCO DE PRODUÇÃO. Foi assim que um usuário sumiu do nada.
 *
 * Os testes montam o banco com pg-mem e trocam o módulo ./db, mas isso não
 * intercepta este client — ele fala HTTP, não SQL. Por isso a trava é aqui.
 *
 * Sob `node --test` só é permitido falar com host local (os mocks). Qualquer
 * outro destino falha ANTES do fetch, sem sair pacote na rede.
 */
const MODO_TESTE = Boolean(
  process.env.NODE_TEST_CONTEXT ||
  process.env.NODE_ENV === 'test' ||
  process.argv.includes('--test')
);

function ehHostLocal(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname);
  } catch (err) {
    return false;
  }
}

function garantirDestinoSeguroEmTeste(method, url) {
  if (!MODO_TESTE || ehHostLocal(url)) return;
  const error = new Error(
    `[api-http-client] BLOQUEADO: teste tentou ${method} em "${url}". ` +
    'Testes não podem acessar a API real. Aponte API_BASE_URL para um mock local ' +
    '(ex.: process.env.API_BASE_URL = "http://localhost:4500") antes de carregar o controller.'
  );
  error.status = 599;
  throw error;
}

function createApiClient(req) {
  function resolveBearer() {
    const stored = normalizeToken(getToken());
    return normalizeToken(req?.headers?.authorization || '') || stored || DEFAULT_BEARER_TOKEN;
  }

  async function send(method, path, { query, body } = {}) {
    const bearer = resolveBearer();
    if (!bearer) {
      const error = new Error('Token de autenticação ausente');
      error.status = 401;
      throw error;
    }

    const forbiddenQuery = hasForbiddenOperators(query);
    if (forbiddenQuery) {
      logValidationIssue('Payload rejeitado por operador proibido no filtro', {
        path,
        operador: forbiddenQuery.key,
        valor: forbiddenQuery.value
      });
      const error = new Error(
        'Filtros inválidos. Utilize apenas comparações simples (campo=valor) sem operadores lógicos.'
      );
      error.status = 400;
      throw error;
    }

    const emptyMandatoryFilters = findEmptyMandatoryFilters(query);

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${API_BASE_URL}${normalizedPath}${buildQueryString(query)}`;

    // Antes de qualquer coisa sair na rede.
    garantirDestinoSeguroEmTeste(method, url);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }

    if (!response.ok) {
      const error = new Error(
        `Falha na requisição ${method} ${normalizedPath}: ${response.status}${descreverFalha(data)}`
      );
      error.status = response.status;
      error.body = data;
      throw error;
    }

    if (Array.isArray(data) && data.length === 0 && emptyMandatoryFilters.length) {
      const missing = emptyMandatoryFilters.join(', ');
      logValidationIssue('Filtro obrigatório vazio retornou lista vazia', {
        path,
        filtros: emptyMandatoryFilters
      });
      const error = new Error(
        `Filtro obrigatório ausente ou vazio (${missing}). Envie no formato campo=valor para continuar.`
      );
      error.status = 400;
      throw error;
    }

    return data;
  }

  return {
    get: (path, options = {}) => send('GET', path, options),
    post: (path, body, options = {}) => send('POST', path, { ...options, body }),
    put: (path, body, options = {}) => send('PUT', path, { ...options, body }),
    delete: (path, options = {}) => send('DELETE', path, options)
  };
}

module.exports = {
  createApiClient,
  normalizeToken
};
