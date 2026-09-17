/**
 * Peças comuns da devolução de pedidos. As tabelas nascem em
 * sql/devolucoes.sql; sem ele, a leitura responde 409 com `sql_pendente` e a
 * tela diz o que fazer — o mesmo trato da fase G (financeiro/comum.js).
 */
const f = require('../financeiro/comum');

const SQL_ARQUIVO = 'sql/devolucoes.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;
const TABELAS = ['devolucoes', 'devolucao_itens', 'devolucao_parcelas', 'reembolsos', 'notas_devolucao'];

/** Tabela da devolução ausente: API remota (404 "Tabela 'x' não encontrada") ou Postgres local (42P01). */
function tabelaAusente(err) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  if (/42P01/.test(bruto)) return true;
  const citaTabela = TABELAS.some(t => bruto.includes(t));
  return citaTabela && (/does not exist|não encontrada|não existe/i.test(bruto) || (err?.status === 404 && /tabela/i.test(bruto)));
}

const sqlPendente = () => f.erro(SQL_FALTANDO, 409, { sql_pendente: true });

/** Lê conferindo o filtro aqui também (a API ignora coluna que não conhece e devolveria tudo). */
async function ler(api, tabela, query = {}) {
  try {
    const linhas = f.lista(await api.get(`/api/${tabela}`, { query }));
    return linhas.filter(l => l && Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
  } catch (e) {
    if (tabelaAusente(e)) throw sqlPendente();
    throw e;
  }
}

/** Como `ler`, mas sem o SQL devolve lista vazia: para quem só enfeita outra tela (dashboard, painel). */
async function lerSePuder(api, tabela, query = {}) {
  try {
    return await ler(api, tabela, query);
  } catch (e) {
    if (e?.extra?.sql_pendente) return [];
    throw e;
  }
}

async function inserir(api, tabela, linha) {
  try {
    const criado = await api.post(`/api/${tabela}`, linha);
    return { ...linha, ...(criado && typeof criado === 'object' && !Array.isArray(criado) ? criado : {}) };
  } catch (e) {
    if (tabelaAusente(e)) throw sqlPendente();
    throw e;
  }
}

async function atualizar(api, tabela, id, campos) {
  try {
    await api.put(`/api/${tabela}/${id}`, campos);
  } catch (e) {
    if (tabelaAusente(e)) throw sqlPendente();
    throw e;
  }
}

module.exports = {
  ...f,
  SQL_ARQUIVO, SQL_FALTANDO, TABELAS, tabelaAusente, ler, lerSePuder, inserir, atualizar
};
