/**
 * Ids explícitos das tabelas de pedido (backend/idsSequenciais.js).
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
 *
 * `getMaxId` pedia `order=id.desc&limit=1` e ficava com a primeira linha da
 * resposta. A Santissimo-db-API IGNORA `order` e `limit` — devolve a tabela
 * inteira na ordem de inserção —, então a "primeira linha" era a MAIS ANTIGA:
 * o MENOR id, e não o maior.
 *
 * A inserção então começava a tentar bem abaixo do fim da tabela e subia de um
 * em um até achar vaga, desistindo na 50ª tentativa. Com a tabela pequena isso
 * passou por lentidão; quando `pedidos_itens` cruzou ~50 linhas acima do
 * primeiro id, a conversão de orçamento em pedido passou a estourar com
 * "duplicate key value violates unique constraint pedidos_itens_pkey".
 *
 * O duplo abaixo repete as limitações da API real de propósito. O duplo de
 * `pedidoPagamento.test.js` obedecia `order` e `limit`, e foi por isso que o
 * defeito atravessou o teste inteiro sem ninguém ver.
 * ---------------------------------------------------------------------------
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { getMaxId, inserirLinhaComId, isDuplicateKeyError } = require('./idsSequenciais');

/**
 * API falsa com os defeitos da verdadeira:
 *   • ignora `order` e `limit`, devolvendo tudo na ordem de inserção;
 *   • recusa id repetido, como a chave primária de verdade.
 */
function apiFalsa(linhas = []) {
  const tabela = linhas.map(l => ({ ...l }));
  const gets = [];

  return {
    tabela,
    gets,
    async get(caminho, opcoes) {
      gets.push({ caminho, query: opcoes?.query || {} });
      // Nem ordena nem corta: é exatamente o que a API faz — nada.
      return tabela.map(l => ({ ...l }));
    },
    async post(caminho, corpo) {
      if (tabela.some(l => Number(l.id) === Number(corpo.id))) {
        const err = new Error(`Falha na requisição POST ${caminho}: 500`);
        err.status = 500;
        err.body = {
          error: 'Erro no INSERT',
          detalhe: 'duplicate key value violates unique constraint "pedidos_itens_pkey"'
        };
        throw err;
      }
      tabela.push({ ...corpo });
      return { ...corpo };
    }
  };
}

/** A forma da tabela em produção: começa no 5 e vai até o 56. */
const COMO_EM_PRODUCAO = Array.from({ length: 52 }, (_, i) => ({ id: i + 5, pedido_id: 90 }));

// ---------------------------------------------------------------------------
// getMaxId
// ---------------------------------------------------------------------------

test('o maior id é o MAIOR, não o primeiro que a API devolveu', async () => {
  const api = apiFalsa(COMO_EM_PRODUCAO);

  // A API devolve na ordem de inserção: a primeira linha é a de id 5.
  assert.equal((await api.get('/api/pedidos_itens')).at(0).id, 5);

  // Pegar a primeira é o defeito. O maior é 56.
  assert.equal(await getMaxId(api, 'pedidos_itens'), 56);
});

test('não se pede ordenação nem corte a quem não os obedece', async () => {
  const api = apiFalsa(COMO_EM_PRODUCAO);
  await getMaxId(api, 'pedidos_itens');

  const { query } = api.gets.at(-1);
  // Pedir `order`/`limit` e confiar na resposta foi a origem do defeito. Ficam
  // de fora para que ninguém volte a ler a primeira linha achando que é a
  // última.
  assert.equal(query.order, undefined);
  assert.equal(query.limit, undefined);
  // `select` fica: esse a API honra, e evita arrastar a tabela inteira com
  // todas as colunas só para descobrir um número.
  assert.equal(query.select, 'id');
});

test('tabela fora de ordem não engana a conta', async () => {
  // Linha inserida com id manual pode entrar em qualquer posição — é o que
  // acontece quando a inserção sobe de um em um até achar vaga.
  const api = apiFalsa([{ id: 30 }, { id: 7 }, { id: 56 }, { id: 12 }]);
  assert.equal(await getMaxId(api, 'pedidos_itens'), 56);
});

test('tabela vazia começa do zero', async () => {
  assert.equal(await getMaxId(apiFalsa([]), 'pedidos_itens'), 0);
});

test('leitura que falha não derruba a inserção', async () => {
  const api = {
    async get() { throw new Error('rede caiu'); },
    async post() {}
  };
  // Zero faz a inserção tentar do 1 e subir — devagar, mas viva. Uma exceção
  // aqui derrubaria a conversão inteira por causa de um GET.
  assert.equal(await getMaxId(api, 'pedidos_itens'), 0);
});

// ---------------------------------------------------------------------------
// A conversão, que é onde o defeito aparecia
// ---------------------------------------------------------------------------

test('converter um pedido grande não estoura a chave primária', async () => {
  const api = apiFalsa(COMO_EM_PRODUCAO);

  // 26 peças, como o pedido 91 da produção.
  let proximo = (await getMaxId(api, 'pedidos_itens')) + 1;
  const usados = [];
  for (let i = 0; i < 26; i++) {
    const usado = await inserirLinhaComId(api, 'pedidos_itens', { pedido_id: 92 }, proximo);
    usados.push(usado);
    proximo = usado + 1;
  }

  // Começa logo depois do maior que existia, e segue sem buraco.
  assert.equal(usados[0], 57);
  assert.deepEqual(usados, Array.from({ length: 26 }, (_, i) => 57 + i));
});

test('com o maior id certo, ninguém precisa subir de um em um', async () => {
  const api = apiFalsa(COMO_EM_PRODUCAO);
  const proximo = (await getMaxId(api, 'pedidos_itens')) + 1;

  let posts = 0;
  const contando = { ...api, post: async (c, b) => { posts++; return api.post(c, b); } };

  await inserirLinhaComId(contando, 'pedidos_itens', { pedido_id: 92 }, proximo);

  // Uma inserção, um POST. Partindo do id errado eram 52 — e a partir da 50ª
  // a conversão morria.
  assert.equal(posts, 1);
});

test('a retentativa continua valendo para a corrida de verdade', async () => {
  // Dois usuários convertendo ao mesmo tempo: o id lido estava livre e deixou
  // de estar entre a leitura e o INSERT. É para isso que a retentativa existe,
  // e ela não pode ter ido embora junto com o defeito.
  const api = apiFalsa([{ id: 10 }, { id: 11 }, { id: 12 }]);
  const usado = await inserirLinhaComId(api, 'pedidos_itens', { pedido_id: 92 }, 11);
  assert.equal(usado, 13);
});

test('erro que não é de chave duplicada sobe na hora', async () => {
  const api = apiFalsa([]);
  api.post = async () => {
    const err = new Error('coluna inexistente');
    err.status = 400;
    err.body = { error: 'Erro no INSERT', detalhe: 'column "xpto" does not exist' };
    throw err;
  };

  // Retentar 50 vezes um erro que não é de colisão é 50 vezes o mesmo erro,
  // e cinquenta requisições para nada.
  await assert.rejects(
    () => inserirLinhaComId(api, 'pedidos_itens', {}, 1),
    /coluna inexistente/
  );
});

test('a colisão é reconhecida pelo corpo que a API devolve', () => {
  // O formato é o da Santissimo-db-API: `body.detalhe`, em português.
  assert.equal(isDuplicateKeyError({
    body: { error: 'Erro no INSERT', detalhe: 'duplicate key value violates unique constraint "pedidos_itens_pkey"' }
  }), true);
  assert.equal(isDuplicateKeyError({ body: { detalhe: 'column "x" does not exist' } }), false);
});
