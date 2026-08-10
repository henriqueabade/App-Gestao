const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Cache do catálogo (produtos e rotas).
 *
 * O popup "Utilizado em:" abre a cada passada do mouse, e a busca do módulo de
 * Matéria-Prima roda a cada pausa da digitação. As duas liam TABELAS INTEIRAS a
 * cada chamada — `produtos_insumos` é a maior do sistema. Sair e voltar ao
 * módulo apagava o cache da tela e recomeçava tudo; era isso que deixava o
 * "Carregando..." parado.
 *
 * O que se defende aqui: economizar leitura sem NUNCA servir catálogo velho
 * depois de alguém mexer em produto ou rota.
 */

function carregar() {
  delete require.cache[require.resolve('./catalogoCache')];
  const cache = require('./catalogoCache');

  const chamadas = { produtos: 0, produtos_insumos: 0 };
  const pool = {
    async get(caminho) {
      const tabela = caminho.replace(/^\//, '');
      chamadas[tabela] = (chamadas[tabela] || 0) + 1;
      if (tabela === 'produtos') return [{ id: 1, codigo: 'P-001', nome: 'Mesa' }];
      if (tabela === 'produtos_insumos') return [{ id: 9, produto_id: 1, insumo_id: 7 }];
      return [];
    }
  };

  return { cache, pool, chamadas };
}

test('a segunda leitura não vai ao banco', async () => {
  const { cache, pool, chamadas } = carregar();

  const primeira = await cache.lerProdutos(pool);
  const segunda = await cache.lerProdutos(pool);

  assert.equal(chamadas.produtos, 1, 'uma requisição, não duas');
  assert.deepEqual(primeira, segunda);
});

test('leituras simultâneas compartilham UMA requisição', async () => {
  // Vinte popups abertos ao mesmo tempo não podem virar vinte requisições —
  // era assim que a fila se formava.
  const { cache, pool, chamadas } = carregar();

  await Promise.all(Array.from({ length: 20 }, () => cache.lerProdutos(pool)));

  assert.equal(chamadas.produtos, 1);
});

test('produtos e rotas são guardados separadamente', async () => {
  const { cache, pool, chamadas } = carregar();

  await cache.lerProdutos(pool);
  await cache.lerProdutosInsumos(pool);

  assert.equal(chamadas.produtos, 1);
  assert.equal(chamadas.produtos_insumos, 1);
});

test('invalidar obriga a reler as duas tabelas', async () => {
  // Sem isto, editar a rota de um produto deixaria o popup e a busca mostrando
  // a composição antiga até o cache vencer.
  const { cache, pool, chamadas } = carregar();

  await cache.lerProdutos(pool);
  await cache.lerProdutosInsumos(pool);
  cache.invalidar();
  await cache.lerProdutos(pool);
  await cache.lerProdutosInsumos(pool);

  assert.equal(chamadas.produtos, 2);
  assert.equal(chamadas.produtos_insumos, 2);
});

test('falha não fica guardada: a próxima tentativa vai ao banco', async () => {
  const { cache } = carregar();
  let tentativas = 0;
  const poolQueFalha = {
    async get() {
      tentativas += 1;
      if (tentativas === 1) throw new Error('rede caiu');
      return [{ id: 1 }];
    }
  };

  await assert.rejects(() => cache.lerProdutos(poolQueFalha));
  const depois = await cache.lerProdutos(poolQueFalha);

  assert.equal(tentativas, 2, 'guardar o erro deixaria a tela quebrada por um minuto');
  assert.deepEqual(depois, [{ id: 1 }]);
});

test('a validade é curta o bastante para ninguém conviver com dado velho', () => {
  const { cache } = carregar();
  assert.ok(cache.VALIDADE_MS <= 60 * 1000, 'no máximo um minuto');
});
