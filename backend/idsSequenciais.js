/**
 * Ids explícitos para as tabelas de pedido.
 *
 * `pedidos`, `pedidos_itens` e `pedido_parcelas` são NOT NULL sem default: o
 * banco não gera o id, quem insere é que precisa escolher. Como não há
 * sequence, dois cadastros simultâneos podem mirar o mesmo número — daí a
 * retentativa em vez de um simples "maior + 1".
 *
 * Extraído de orcamentosController.js quando a repactuação de pagamento em
 * pedidosController.js passou a precisar da mesma lógica: duplicar a
 * retentativa em dois arquivos é como perdê-la num deles na primeira correção
 * que só um dos dois receber.
 */

/** Colisão de chave (pkey/unique), para retentar com outro id. */
function isDuplicateKeyError(err) {
  const partes = [
    err?.body?.detalhe,
    err?.body?.detail,
    err?.body?.message,
    err?.body?.error,
    err?.message
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return partes.includes('duplicate key')
      || partes.includes('_pkey')
      || partes.includes('unique constraint');
}

/**
 * Maior id atual da tabela, ou 0 se ela estiver vazia.
 *
 * A CONTA É FEITA AQUI, E NÃO PELO BANCO
 * --------------------------------------
 * Esta função pedia `order=id.desc&limit=1` e ficava com a primeira linha. A
 * Santissimo-db-API IGNORA `order` e `limit`: ela devolve a tabela inteira na
 * ordem de inserção. A "primeira linha" era, portanto, a MAIS ANTIGA — o MENOR
 * id, não o maior.
 *
 * O estrago só aparecia com a tabela grande, e por isso demorou. `pedidos_itens`
 * começa no id 5 (as quatro primeiras linhas foram apagadas um dia), então a
 * conta devolvia 5 e a inserção começava a tentar do 6. `inserirLinhaComId`
 * subia de um em um até achar vaga — 6, 7, 8... — e desistia na 50ª tentativa.
 * Enquanto a tabela teve menos de ~50 linhas isso passou como lentidão; ao
 * cruzar essa marca virou "duplicate key value violates unique constraint".
 *
 * `select: 'id'` fica: esse a API honra, e é o que impede de trazer a tabela
 * inteira com todas as colunas só para descobrir um número.
 */
async function getMaxId(api, tabela) {
  const lista = await api
    .get(`/api/${tabela}`, { query: { select: 'id' } })
    .catch(() => []);
  if (!Array.isArray(lista)) return 0;

  let maior = 0;
  for (const linha of lista) {
    const id = Number(linha?.id);
    if (Number.isFinite(id) && id > maior) maior = id;
  }
  return maior;
}

/**
 * Insere com id explícito, avançando para o próximo em caso de colisão.
 * Devolve o id efetivamente usado.
 */
async function inserirLinhaComId(api, tabela, payload, idInicial) {
  let id = idInicial;
  const maxTentativas = 50;
  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    try {
      await api.post(`/api/${tabela}`, { ...payload, id });
      return id;
    } catch (err) {
      if (isDuplicateKeyError(err) && tentativa < maxTentativas - 1) {
        id += 1;
        continue;
      }
      throw err;
    }
  }
  return id;
}

module.exports = { isDuplicateKeyError, getMaxId, inserirLinhaComId };
