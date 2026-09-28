/**
 * Peças comuns do módulo Contabilidade (etapa 1): as tabelas do módulo, a
 * leitura/gravação pela API genérica com a detecção de "tabela ausente"
 * (409 `sql_pendente`, como no Financeiro), as três severidades de pendência
 * e os formatadores de data.
 *
 * As três severidades são decisão do dono (28/09/2026):
 *   critico     bloqueia o fechamento da competência
 *   documental  bloqueia o pacote e o envio à contabilidade
 *   aviso       não bloqueia nada
 */
const c = require('../financeiro/comum');

const SQL_ARQUIVO = 'sql/contabilidade_base.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;
const TABELAS = ['competencia_contabil', 'contabil_pendencias_resolucoes', 'contabil_eventos'];

/** Na ordem em que importam (a lista de pendências sai nesta ordem). */
const NIVEIS = {
  critico: { ordem: 0, rotulo: 'Erro crítico', bloqueia: 'fechamento', ignoravel: false },
  documental: { ordem: 1, rotulo: 'Pendência documental', bloqueia: 'pacote', ignoravel: true },
  aviso: { ordem: 2, rotulo: 'Aviso', bloqueia: null, ignoravel: true }
};

const nivelValido = n => Object.prototype.hasOwnProperty.call(NIVEIS, String(n || ''));

/** Tabela do módulo ausente: API remota (404 "Tabela 'x' não encontrada") ou Postgres (42P01). */
function tabelaAusente(err) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  if (/42P01/.test(bruto) && TABELAS.some(t => bruto.includes(t))) return true;
  const citaTabela = TABELAS.some(t => bruto.includes(t));
  return citaTabela && (/does not exist|não encontrada|não existe/i.test(bruto) || (err?.status === 404 && /tabela/i.test(bruto)));
}

function traduzir(e) {
  if (tabelaAusente(e)) return c.erro(SQL_FALTANDO, 409, { sql_pendente: true });
  return e;
}

/** Lê uma tabela do módulo, conferindo o filtro aqui também (a API ignora coluna que não conhece). */
async function ler(api, tabela, query = {}) {
  try {
    const linhas = c.lista(await api.get(`/api/${tabela}`, { query }));
    return linhas.filter(l => l && Object.entries(query).every(([k, v]) => String(l[k]) === String(v)));
  } catch (e) {
    throw traduzir(e);
  }
}

async function inserir(api, tabela, linha) {
  try {
    const criado = await api.post(`/api/${tabela}`, linha);
    return { ...linha, ...(criado && typeof criado === 'object' && !Array.isArray(criado) ? criado : {}) };
  } catch (e) {
    throw traduzir(e);
  }
}

async function atualizar(api, tabela, id, campos) {
  try {
    await api.put(`/api/${tabela}/${id}`, campos);
  } catch (e) {
    throw traduzir(e);
  }
}

async function excluir(api, tabela, id) {
  try {
    await api.delete(`/api/${tabela}/${id}`);
  } catch (e) {
    throw traduzir(e);
  }
}

/** Os nomes dos usuários citados (fechou, reabriu, ignorou): `Map(id -> nome)`. */
async function nomesDeUsuarios(api, ids) {
  const unicos = [...new Set(ids.filter(v => v !== null && v !== undefined && v !== '').map(String))];
  const achados = await Promise.all(unicos.map(id => api.get('/api/usuarios', { query: { id } })
    .then(r => c.lista(r).find(u => String(u?.id) === id) || null)
    .catch(() => null)));
  return new Map(achados.filter(Boolean).map(u => [String(u.id), u.nome || u.email || `Usuário ${u.id}`]));
}

/** Um instante ISO no horário de Brasília ('2026-09-28T15:10:01-03:00'); null quando não há. */
function instanteBR(iso) {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(d);
  const v = t => partes.find(p => p.type === t)?.value;
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}:${v('second')}-03:00`;
}

/** 'YYYY-MM' -> o último dia do mês ('YYYY-MM-DD'). */
function ultimoDia(competencia) {
  const [a, m] = String(competencia).split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${competencia}-${String(ultimo).padStart(2, '0')}`;
}

module.exports = {
  SQL_ARQUIVO, SQL_FALTANDO, TABELAS, NIVEIS, nivelValido,
  tabelaAusente, ler, inserir, atualizar, excluir, nomesDeUsuarios, instanteBR, ultimoDia
};
