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

// Os cabeçalhos do arquivo que voltam da API junto com os bytes.
const CABECALHOS_DO_ARQUIVO = ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options', 'content-security-policy'];
// O arquivo enviado (fase 2): até 20 MB, em bytes, sem passar pelo JSON.
const LIMITE_DO_ARQUIVO = 20 * 1024 * 1024 + 1024;

/**
 * Repassa para a API /chat — o /eventos em fluxo (Server-Sent Events); o
 * arquivo enviado em bytes (com o nome e o tipo nos cabeçalhos); o arquivo
 * baixado em bytes, com o tipo e o nome que a API mandou.
 */
async function repassar(req, res) {
  const destino = `${API_ORIGEM}/chat${req.url}`;
  if (!destinoPermitido(destino)) return res.status(599).json({ error: `[chat] BLOQUEADO em teste: ${destino}` });
  const eventos = req.method === 'GET' && req.path === '/eventos';
  const controle = new AbortController();
  res.on('close', () => controle.abort());
  const headers = {
    Authorization: req.headers.authorization || '',
    Accept: eventos ? 'text/event-stream' : 'application/json, */*',
    ...require('./contextoDaRota').cabecalhos(req)
  };
  let body;
  if (Buffer.isBuffer(req.body)) {
    headers['Content-Type'] = 'application/octet-stream';
    headers['X-Nome-Arquivo'] = String(req.get('x-nome-arquivo') || '');
    headers['X-Tipo-Arquivo'] = String(req.get('x-tipo-arquivo') || '');
    body = req.body;
  } else if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
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
    const tipo = resposta.headers.get('content-type') || '';
    if (resposta.ok && tipo && !/json/i.test(tipo)) {
      // Um arquivo do chat: os bytes como vieram (o fetch já tirou o gzip).
      const bytes = Buffer.from(await resposta.arrayBuffer());
      res.status(resposta.status);
      for (const nome of CABECALHOS_DO_ARQUIVO) {
        const valor = resposta.headers.get(nome);
        if (valor) res.set(nome, valor);
      }
      res.set('Content-Length', String(bytes.length));
      res.end(bytes);
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
  // O arquivo chega em bytes (o JSON do programa não o lê); vai igual para a API.
  const arquivoCru = express.raw({ type: () => true, limit: LIMITE_DO_ARQUIVO });
  router.post('/conversas/:id/anexos', (req, res, next) => arquivoCru(req, res, err => {
    if (!err) return next();
    const grande = err.status === 413 || err.type === 'entity.too.large';
    res.status(grande ? 413 : 400).json({ error: grande ? 'O arquivo passa de 20 MB.' : 'Arquivo inválido.' });
  }), repassar);
  router.use(repassar);
}

module.exports = router;
module.exports.repassar = repassar;
module.exports.API_ORIGEM = API_ORIGEM;
