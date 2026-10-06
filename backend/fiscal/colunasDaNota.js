/**
 * As LISTAS de notas fiscais não precisam dos XMLs (desempenho, 06/10/2026).
 *
 * Cada nota guarda o XML de envio e o autorizado (~40 KB juntos). As listas do
 * Financeiro, da Cobrança, do Dashboard e da Contabilidade liam a tabela
 * inteira e jogavam os XMLs fora logo depois: abrir o Financeiro baixava uns
 * 7 MB. Com `select: SEM_XML` a API (Santissimo-db-API/consultas/colunas.js)
 * e o banco local (localDataClient.selecaoDe) devolvem a nota sem eles. API
 * antiga, que ainda ignora o `select`, devolve a linha inteira: nada quebra,
 * só pesa como antes.
 *
 * Quem precisa do XML (DANFE, download, e-mail, evidências, a lista de notas
 * que diz "tem XML") continua lendo a nota inteira.
 */
const SEM_XML = '-xml_envio,-xml_autorizado,-xml_cancelamento';

module.exports = { SEM_XML };
