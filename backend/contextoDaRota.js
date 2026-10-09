/**
 * A rota do programa que está falando com a API (Segurança, 09/10/2026).
 *
 * A API passou a conferir permissão por tabela e anota o que nega (ou negaria,
 * no modo observar) em api_acessos_registro. Para o registro dizer DE QUE TELA
 * veio a leitura, cada chamada à API leva:
 *   X-Rota              "GET /api/financeiro/painel" (a rota daqui, sem ids);
 *   X-Permissoes-Rota   as chaves que a rota exigiu ("financeiro.view").
 * Servem só para o registro: a API decide pelo token, nunca por eles.
 *
 * O contexto vale a requisição inteira (AsyncLocalStorage), então tanto o
 * apiHttpClient quanto o `db` (remoteDatabase) acham a rota sem ninguém passar
 * o `req` adiante. Fora de uma requisição (tarefas em segundo plano), a rota é
 * "segundo-plano".
 */
const { AsyncLocalStorage } = require('async_hooks');

const contexto = new AsyncLocalStorage();

/** No server.js, antes dos routers. */
function middleware(req, _res, next) {
  contexto.run({ req }, next);
}

/** Só ASCII imprimível no cabeçalho (o fetch recusa o resto). */
const ascii = (texto, maximo) => String(texto || '').replace(/[^\x20-\x7e]/g, '?').slice(0, maximo);

/** "GET /api/pedidos/:id/status" — o molde da rota, sem os ids de verdade. */
function rotulo(req) {
  if (!req || typeof req.method !== 'string') return '';
  const molde = req.route && typeof req.route.path === 'string'
    ? `${req.baseUrl || ''}${req.route.path}`
    : String(req.originalUrl || req.url || '').split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id');
  return ascii(`${req.method} ${molde}`, 200);
}

/** Os cabeçalhos do registro para a chamada à API (o `req` explícito vence o do contexto). */
function cabecalhos(reqExplicita) {
  const req = reqExplicita && typeof reqExplicita.method === 'string' ? reqExplicita : contexto.getStore()?.req;
  if (!req) return { 'X-Rota': 'segundo-plano' };
  const h = { 'X-Rota': rotulo(req) || 'desconhecida' };
  const chaves = Array.isArray(req.permissoesExigidas) ? req.permissoesExigidas.filter(Boolean) : [];
  if (chaves.length) h['X-Permissoes-Rota'] = ascii(chaves.join(','), 300);
  return h;
}

module.exports = { contexto, middleware, rotulo, cabecalhos };
