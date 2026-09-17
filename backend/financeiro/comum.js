/**
 * Peças comuns do Financeiro completo (etapa 6, fase G): comissões CMS e
 * Royalty, ajustes, produção, fechamentos e pagamentos.
 *
 * Tudo fala com o banco pelo `api` genérico (o mesmo dos boletos). As
 * tabelas nascem em sql/financeiro_comissoes_producao.sql; sem ele, a
 * leitura responde 409 com `sql_pendente` e a tela diz o que fazer.
 */
const recebimentos = require('../cobranca/recebimentos');

const SQL_ARQUIVO = 'sql/financeiro_comissoes_producao.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;

/** As tabelas da fase G (a detecção de "tabela ausente" procura por estes nomes). */
const TABELAS = [
  'financeiro_configuracao', 'comissao_regras', 'producao_setores', 'producao_valores', 'financeiro_feriados',
  'ajustes_financeiros', 'producao_eventos', 'financeiro_fechamentos', 'financeiro_fechamento_itens',
  'financeiro_pagamentos', 'financeiro_eventos'
];

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const centavos = v => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const dia = recebimentos.dia;
const dataValida = recebimentos.dataValida;
const competenciaDe = recebimentos.competenciaDe;
const agora = () => new Date().toISOString();
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = v => (Number(v) < 0 ? `- ${moeda.format(Math.abs(Number(v)))}` : moeda.format(Number(v || 0)));
const impressa = iso => (dia(iso) ? `${dia(iso).slice(8, 10)}/${dia(iso).slice(5, 7)}/${dia(iso).slice(0, 4)}` : '—');
const plural = (n, um, varios) => `${n} ${Number(n) === 1 ? um : varios}`;
const texto = (v, max = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

const competenciaValida = c => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(c || ''));

/** 'YYYY-MM' + n meses. */
function somarMeses(competencia, n) {
  const [a, m] = String(competencia).split('-').map(Number);
  const total = a * 12 + (m - 1) + Number(n || 0);
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' -> 'setembro/2026'. */
function rotuloCompetencia(competencia) {
  if (!competenciaValida(competencia)) return String(competencia || '—');
  const [a, m] = competencia.split('-');
  return `${MESES[Number(m) - 1]}/${a}`;
}

/** Tabela da fase G ausente: API remota (404 "Tabela 'x' não encontrada") ou Postgres local (42P01). */
function tabelaAusente(err) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  if (/42P01/.test(bruto)) return true;
  const citaTabela = TABELAS.some(t => bruto.includes(t));
  return citaTabela && (/does not exist|não encontrada|não existe/i.test(bruto) || (err?.status === 404 && /tabela/i.test(bruto)));
}

/** Violação de chave única (duas máquinas, clique repetido). */
function ehDuplicado(err) {
  const t = `${err?.message || ''} ${err?.body?.detalhe || ''} ${err?.body?.error || ''}`.toLowerCase();
  return t.includes('duplicate key') || t.includes('23505') || t.includes('unique') || err?.status === 409;
}

/**
 * Lê uma tabela da fase G, conferindo o filtro aqui também (a API ignora
 * coluna que não conhece e devolveria tudo).
 */
async function ler(api, tabela, query = {}) {
  try {
    const linhas = lista(await api.get(`/api/${tabela}`, { query }));
    return linhas.filter(l => l && Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
  } catch (e) {
    if (tabelaAusente(e)) throw erro(SQL_FALTANDO, 409, { sql_pendente: true });
    throw e;
  }
}

/** Grava e devolve a linha com o id que o banco deu. */
async function inserir(api, tabela, linha) {
  try {
    const criado = await api.post(`/api/${tabela}`, linha);
    return { ...linha, ...(criado && typeof criado === 'object' && !Array.isArray(criado) ? criado : {}) };
  } catch (e) {
    if (tabelaAusente(e)) throw erro(SQL_FALTANDO, 409, { sql_pendente: true });
    throw e;
  }
}

async function atualizar(api, tabela, id, campos) {
  try {
    await api.put(`/api/${tabela}/${id}`, campos);
  } catch (e) {
    if (tabelaAusente(e)) throw erro(SQL_FALTANDO, 409, { sql_pendente: true });
    throw e;
  }
}

/** JSON guardado como texto (a API remota recusa array JS em coluna JSONB). */
function jsonDe(valor, padrao = null) {
  if (valor === null || valor === undefined || valor === '') return padrao;
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(valor); } catch (_) { return padrao; }
}

const nomeDoCliente = c => (c ? (c.nome_fantasia || c.razao_social || c.nome || null) : null);

module.exports = {
  SQL_ARQUIVO, SQL_FALTANDO, TABELAS, MESES,
  lista, centavos, dia, dataValida, competenciaDe, agora, reais, impressa, plural, texto, erro,
  competenciaValida, somarMeses, rotuloCompetencia, tabelaAusente, ehDuplicado, ler, inserir, atualizar, jsonDe, nomeDoCliente
};
