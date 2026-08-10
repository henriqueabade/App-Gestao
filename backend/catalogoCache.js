/**
 * Cache do CATÁLOGO: produtos e as rotas deles (`produtos_insumos`).
 *
 * Duas telas perguntam a mesma coisa o tempo todo:
 *
 *   - "quais produtos usam este insumo?" — o popup de informações da
 *     matéria-prima, que abre a cada passada do mouse;
 *   - "quais insumos pertencem a um produto com este nome?" — a busca do
 *     módulo de Matéria-Prima.
 *
 * As duas liam a tabela INTEIRA de produtos, e a segunda lia também a de
 * `produtos_insumos`, que é a maior do sistema (um registro por passo de rota
 * de cada produto). A cada chamada. Sair e voltar ao módulo apagava o cache da
 * tela e recomeçava tudo — era isso que deixava o "Utilizado em: Carregando..."
 * parado na tela.
 *
 * Duas travas contra dado velho:
 *
 *   1. VALIDADE CURTA. Um minuto: tempo de o usuário passar o mouse por vinte
 *      linhas sem perguntar vinte vezes, e curto demais para alguém conviver
 *      com um catálogo desatualizado.
 *   2. INVALIDAÇÃO EXPLÍCITA. Quem mexe em produto ou em rota chama
 *      `invalidar()` — a leitura seguinte vai ao banco. É o mesmo contrato do
 *      `invalidarCacheLotes`, que já existe por este motivo.
 *
 * O que fica guardado é a PROMESSA, não o resultado: vinte popups abertos ao
 * mesmo tempo compartilham uma requisição em vez de dispararem vinte.
 */

const VALIDADE_MS = 60 * 1000;

const cache = new Map();   // tabela -> { promessa, expiraEm }

/** Lê a tabela inteira, reaproveitando o que ainda vale. */
function lerTabela(pool, tabela) {
  const agora = Date.now();
  const guardado = cache.get(tabela);
  if (guardado && guardado.expiraEm > agora) return guardado.promessa;

  const promessa = pool.get(`/${tabela}`)
    .then(dados => (Array.isArray(dados) ? dados : []))
    .catch(err => {
      // Falha não fica em cache: a próxima tentativa tem de ir ao banco.
      cache.delete(tabela);
      throw err;
    });

  cache.set(tabela, { promessa, expiraEm: agora + VALIDADE_MS });
  return promessa;
}

/** Todos os produtos, com id, código e nome. */
function lerProdutos(pool) {
  return lerTabela(pool, 'produtos');
}

/** Todas as linhas de rota (produto -> insumo). */
function lerProdutosInsumos(pool) {
  return lerTabela(pool, 'produtos_insumos');
}

/**
 * Descarta o que está guardado.
 *
 * Chamada por quem grava produto ou rota. Sem parâmetro limpa tudo — é barato,
 * e esquecer de limpar uma das duas é pior que reler as duas.
 */
function invalidar() {
  cache.clear();
}

module.exports = { lerProdutos, lerProdutosInsumos, invalidar, VALIDADE_MS };
