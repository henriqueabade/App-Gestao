/**
 * /api/chat — o chat interno no programa (12/10/2026).
 *
 *   /referencias/buscar e /referencias/resolver   as citações com # (aqui
 *       mesmo, com as permissões de quem pede — backend/chatReferencias.js);
 *   o resto (conversas, mensagens, presença, o "ao vivo" em /eventos)
 *       vai para a API (/chat), com o token da sessão. Com BANCO=DEV não há
 *       API no meio: as MESMAS rotas rodam aqui contra o banco local
 *       (backend/chat/, cópia da API — scripts/copiar-chat-da-api.js).
 */
const express = require('express');
const { isDev } = require('./dataConfig');
const referencias = require('./chatReferencias');

const router = express.Router();

const API_ORIGEM = (process.env.API_BASE_URL || process.env.API_URL || 'https://api.santissimodecor.com.br')
  .trim().replace(/\/+$/, '').replace(/\/api$/, '');

const rota = fn => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (!err?.status) console.error('[chat] falha:', err?.message || err);
    res.status(err?.status || 500).json({ error: err?.status ? err.message : 'Não foi possível agora. Tente de novo.' });
  }
};

router.get('/referencias/buscar', rota(referencias.buscar));
router.post('/referencias/resolver', rota(referencias.resolver));

/** A mesma trava do apiHttpClient: teste nunca fala com a API de verdade. */
function destinoPermitido(url) {
  const emTeste = Boolean(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test' || process.argv.includes('--test'));
  if (!emTeste) return true;
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  } catch (_) {
    return false;
  }
}

/** Repassa para a API /chat — o /eventos em fluxo (Server-Sent Events). */
async function repassar(req, res) {
  const destino = `${API_ORIGEM}/chat${req.url}`;
  if (!destinoPermitido(destino)) return res.status(599).json({ error: `[chat] BLOQUEADO em teste: ${destino}` });
  const eventos = req.method === 'GET' && req.path === '/eventos';
  const controle = new AbortController();
  res.on('close', () => controle.abort());
  const headers = {
    Authorization: req.headers.authorization || '',
    Accept: eventos ? 'text/event-stream' : 'application/json',
    ...require('./contextoDaRota').cabecalhos(req)
  };
  let body;
  if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(req.body || {});
  }
  try {
    const resposta = await fetch(destino, { method: req.method, headers, body, signal: controle.signal });
    if (eventos && resposta.ok && resposta.body) {
      res.status(200);
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      const leitor = resposta.body.getReader();
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }
    const texto = await resposta.text();
    res.status(resposta.status).type('application/json').send(texto || '{}');
  } catch (err) {
    if (controle.signal.aborted) return;
    console.error('[chat] sem resposta da API:', err?.message || err);
    if (!res.headersSent) res.status(502).json({ error: 'Sem conexão com o servidor do chat.' });
    else res.end();
  }
}

if (isDev) {
  // BANCO=DEV: as rotas do chat aqui mesmo, contra o banco local.
  const autenticar = (req, res, next) => {
    try {
      const dados = require('./localAuth').verifyToken(req.headers.authorization);
      req.user = { id: dados.id };
      next();
    } catch (_) {
      res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    }
  };
  router.use(require('./chat/rotas').criarRotasDoChat({ pool: require('./localDatabase'), autenticar }));
} else {
  router.use(repassar);
}

module.exports = router;
module.exports.repassar = repassar;
module.exports.API_ORIGEM = API_ORIGEM;
