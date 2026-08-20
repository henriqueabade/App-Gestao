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

/** Maior id atual da tabela, ou 0 se ela estiver vazia. */
async function getMaxId(api, tabela) {
  const lista = await api
    .get(`/api/${tabela}`, { query: { order: 'id.desc', limit: 1 } })
    .catch(() => []);
  const primeiro = Array.isArray(lista) && lista.length ? lista[0] : null;
  const maxId = Number(primeiro?.id);
  return Number.isFinite(maxId) ? maxId : 0;
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
