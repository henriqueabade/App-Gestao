/**
 * Chat interno (12/10/2026): o programa usa, com BANCO=DEV, uma CÓPIA do chat
 * da API (backend/chat/ ← Santissimo-db-API/chat/). Mudou lá e não copiou,
 * o DEV passa a se comportar diferente da produção — este teste avisa.
 *
 * Copiar: node scripts/copiar-chat-da-api.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const copia = require('../scripts/copiar-chat-da-api');

test('backend/chat é a cópia exata do chat da API', { skip: !fs.existsSync(copia.ORIGEM) && 'a pasta da API não está ao lado deste repositório' }, () => {
  assert.deepStrictEqual(copia.diferentes(), [], 'rode: node scripts/copiar-chat-da-api.js');
});

test('a cópia carrega e monta as mesmas rotas (sem banco)', () => {
  for (const arquivo of copia.ARQUIVOS) assert.ok(fs.existsSync(require('node:path').join(copia.DESTINO, arquivo)), `falta backend/chat/${arquivo}`);
  const { criarRotasDoChat } = require('./chat/rotas');
  const rotas = criarRotasDoChat({ pool: { query: async () => ({ rows: [] }) }, autenticar: (_req, _res, next) => next(), log: { error() {} } });
  try {
    const caminhos = rotas.stack.filter(c => c.route).map(c => `${Object.keys(c.route.methods)[0].toUpperCase()} ${c.route.path}`);
    for (const esperado of ['GET /eventos', 'GET /resumo', 'POST /conversas/direta', 'POST /conversas/:id/mensagens', 'PUT /mensagens/:id', 'POST /mensagens/:id/reacoes', 'PUT /status', 'POST /presenca']) {
      assert.ok(caminhos.includes(esperado), `falta ${esperado}`);
    }
  } finally {
    rotas.eventos.parar();
  }
});
