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
const TABELAS_BASE = ['competencia_contabil', 'contabil_pendencias_resolucoes', 'contabil_eventos'];

/** Etapas 2 e 3: documentos, arquivos e contas a pagar. */
const SQL_ARQUIVO_PAGAR = 'sql/contabilidade_contas_pagar.sql';
const SQL_FALTANDO_PAGAR = `Falta rodar ${SQL_ARQUIVO_PAGAR} no banco e reiniciar a API.`;
const TABELAS_PAGAR = [
  'contabil_arquivos', 'contabil_arquivo_partes', 'contabil_arquivo_vinculos',
  'documentos_recebidos', 'titulos_pagar', 'titulo_pagar_parcelas', 'titulo_pagar_pagamentos'
];
/** Etapa 4: contas financeiras e extrato bancário. */
const SQL_ARQUIVO_EXTRATO = 'sql/contabilidade_extrato.sql';
const SQL_FALTANDO_EXTRATO = `Falta rodar ${SQL_ARQUIVO_EXTRATO} no banco e reiniciar a API.`;
const TABELAS_EXTRATO = ['contas_financeiras', 'extrato_importacoes', 'movimentos_bancarios'];
/** Etapa 5: conciliação do extrato. */
const SQL_ARQUIVO_CONCILIACAO = 'sql/contabilidade_conciliacao.sql';
const SQL_FALTANDO_CONCILIACAO = `Falta rodar ${SQL_ARQUIVO_CONCILIACAO} no banco e reiniciar a API.`;
const TABELAS_CONCILIACAO = ['conciliacao_vinculos'];
/** Etapa 6: classificação (plano de contas e regras). */
const SQL_ARQUIVO_CLASSIFICACAO = 'sql/contabilidade_classificacao.sql';
const SQL_FALTANDO_CLASSIFICACAO = `Falta rodar ${SQL_ARQUIVO_CLASSIFICACAO} no banco e reiniciar a API.`;
const TABELAS_CLASSIFICACAO = ['plano_contas', 'classificacao_regras', 'classificacoes'];
/** Etapa 7: fechamento completo (versões com a foto do mês). */
const SQL_ARQUIVO_FECHAMENTO = 'sql/contabilidade_fechamento.sql';
const SQL_FALTANDO_FECHAMENTO = `Falta rodar ${SQL_ARQUIVO_FECHAMENTO} no banco e reiniciar a API.`;
const TABELAS_FECHAMENTO = ['competencia_fechamentos'];

const SQL_ARQUIVO_PACOTE = 'sql/contabilidade_pacote.sql';
const SQL_FALTANDO_PACOTE = `Falta rodar ${SQL_ARQUIVO_PACOTE} no banco e reiniciar a API.`;
const TABELAS_PACOTE = ['contabil_pacotes'];
/** Etapas 10 a 13: as integrações automáticas (SEFAZ, BB, ADN) e a caixa de entrada. */
const SQL_ARQUIVO_INTEGRACOES = 'sql/contabilidade_integracoes.sql';
const SQL_FALTANDO_INTEGRACOES = `Falta rodar ${SQL_ARQUIVO_INTEGRACOES} no banco e reiniciar a API.`;
const TABELAS_INTEGRACOES = ['contabil_integracoes', 'contabil_integracao_execucoes', 'contabil_dfe_recebidos'];
/** Fase A (02/10/2026): os parâmetros gerais (o mês em que a Contabilidade começa). */
const SQL_ARQUIVO_FASE_A = 'sql/contabilidade_fase_a.sql';
const SQL_FALTANDO_FASE_A = `Falta rodar ${SQL_ARQUIVO_FASE_A} no banco e reiniciar a API.`;
const TABELAS_FASE_A = ['contabil_parametros'];
/** Fase H (02/10/2026): os boletos contra a empresa (DDA do BB). */
const SQL_ARQUIVO_FASE_H = 'sql/contabilidade_fase_h.sql';
const SQL_FALTANDO_FASE_H = `Falta rodar ${SQL_ARQUIVO_FASE_H} no banco e reiniciar a API.`;
const TABELAS_FASE_H = ['contabil_dda_boletos'];
/** Fase D (02/10/2026): os comprovantes do BB (o ZIP do site), só os dados. */
const SQL_ARQUIVO_FASE_D = 'sql/contabilidade_fase_d.sql';
const SQL_FALTANDO_FASE_D = `Falta rodar ${SQL_ARQUIVO_FASE_D} no banco e reiniciar a API.`;
const TABELAS_FASE_D = ['contabil_comprovantes'];
const TABELAS = [...TABELAS_BASE, ...TABELAS_PAGAR, ...TABELAS_EXTRATO, ...TABELAS_CONCILIACAO, ...TABELAS_CLASSIFICACAO, ...TABELAS_FECHAMENTO, ...TABELAS_PACOTE, ...TABELAS_INTEGRACOES, ...TABELAS_FASE_A, ...TABELAS_FASE_H, ...TABELAS_FASE_D];

/** O SQL que cria cada tabela do módulo (a mensagem de "falta o SQL" aponta o certo). */
function sqlDaTabela(tabela) {
  if (TABELAS_FASE_D.includes(tabela)) return { arquivo: SQL_ARQUIVO_FASE_D, mensagem: SQL_FALTANDO_FASE_D };
  if (TABELAS_FASE_H.includes(tabela)) return { arquivo: SQL_ARQUIVO_FASE_H, mensagem: SQL_FALTANDO_FASE_H };
  if (TABELAS_FASE_A.includes(tabela)) return { arquivo: SQL_ARQUIVO_FASE_A, mensagem: SQL_FALTANDO_FASE_A };
  if (TABELAS_INTEGRACOES.includes(tabela)) return { arquivo: SQL_ARQUIVO_INTEGRACOES, mensagem: SQL_FALTANDO_INTEGRACOES };
  if (TABELAS_PACOTE.includes(tabela)) return { arquivo: SQL_ARQUIVO_PACOTE, mensagem: SQL_FALTANDO_PACOTE };
  if (TABELAS_FECHAMENTO.includes(tabela)) return { arquivo: SQL_ARQUIVO_FECHAMENTO, mensagem: SQL_FALTANDO_FECHAMENTO };
  if (TABELAS_CLASSIFICACAO.includes(tabela)) return { arquivo: SQL_ARQUIVO_CLASSIFICACAO, mensagem: SQL_FALTANDO_CLASSIFICACAO };
  if (TABELAS_CONCILIACAO.includes(tabela)) return { arquivo: SQL_ARQUIVO_CONCILIACAO, mensagem: SQL_FALTANDO_CONCILIACAO };
  if (TABELAS_EXTRATO.includes(tabela)) return { arquivo: SQL_ARQUIVO_EXTRATO, mensagem: SQL_FALTANDO_EXTRATO };
  if (TABELAS_PAGAR.includes(tabela)) return { arquivo: SQL_ARQUIVO_PAGAR, mensagem: SQL_FALTANDO_PAGAR };
  return { arquivo: SQL_ARQUIVO, mensagem: SQL_FALTANDO };
}

/** Na ordem em que importam (a lista de pendências sai nesta ordem). */
const NIVEIS = {
  critico: { ordem: 0, rotulo: 'Erro crítico', bloqueia: 'fechamento', ignoravel: false },
  documental: { ordem: 1, rotulo: 'Pendência documental', bloqueia: 'pacote', ignoravel: true },
  aviso: { ordem: 2, rotulo: 'Aviso', bloqueia: null, ignoravel: true }
};

const nivelValido = n => Object.prototype.hasOwnProperty.call(NIVEIS, String(n || ''));

/**
 * Tabela do módulo ausente (o SQL da etapa não rodou). Três jeitos de chegar:
 *   - API remota: 404 "Tabela 'x' não encontrada.";
 *   - Postgres: 42P01 'relation "x" does not exist';
 *   - banco DEV (localDatabase.safeDatabaseError): código 42P01 com a mensagem
 *     "Tabela não disponível no banco DEV" — SEM o nome da tabela.
 * `tabela` é a que a chamada leu/gravou: com ela, o 42P01 basta.
 */
function tabelaAusente(err, tabela = null) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  const cita = t => bruto.includes(t);
  if (/42P01/.test(bruto)) return Boolean(tabela && TABELAS.includes(tabela)) || TABELAS.some(cita);
  const citaTabela = TABELAS.some(cita) || Boolean(tabela && TABELAS.includes(tabela) && /tabela não disponível/i.test(bruto));
  return citaTabela && (/does not exist|não encontrada|não existe|não disponível/i.test(bruto) || (err?.status === 404 && /tabela/i.test(bruto)));
}

/** A mensagem diz QUAL SQL falta (pela tabela da chamada ou, sem ela, pela citada no erro). */
function traduzir(e, tabela = null) {
  if (!tabelaAusente(e, tabela)) return e;
  const bruto = `${e?.message || ''} ${e?.body?.error || ''} ${e?.body?.detalhe || ''}`;
  const alvo = tabela && TABELAS.includes(tabela) ? tabela : TABELAS.find(t => bruto.includes(t)) || null;
  const { arquivo, mensagem } = sqlDaTabela(alvo);
  return c.erro(mensagem, 409, { sql_pendente: true, sql_arquivo: arquivo });
}

/** Lê uma tabela do módulo, conferindo o filtro aqui também (a API ignora coluna que não conhece). */
async function ler(api, tabela, query = {}) {
  try {
    const linhas = c.lista(await api.get(`/api/${tabela}`, { query }));
    return linhas.filter(l => l && Object.entries(query).every(([k, v]) => String(l[k]) === String(v)));
  } catch (e) {
    throw traduzir(e, tabela);
  }
}

async function inserir(api, tabela, linha) {
  try {
    const criado = await api.post(`/api/${tabela}`, linha);
    return { ...linha, ...(criado && typeof criado === 'object' && !Array.isArray(criado) ? criado : {}) };
  } catch (e) {
    throw traduzir(e, tabela);
  }
}

async function atualizar(api, tabela, id, campos) {
  try {
    await api.put(`/api/${tabela}/${id}`, campos);
  } catch (e) {
    throw traduzir(e, tabela);
  }
}

async function excluir(api, tabela, id) {
  try {
    await api.delete(`/api/${tabela}/${id}`);
  } catch (e) {
    throw traduzir(e, tabela);
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

/**
 * Lê uma tabela que pode ainda não existir (SQL da etapa não rodado):
 * `null` quando falta a tabela, as linhas quando existe. Quem chama decide
 * o que mostrar (a fonte do checklist fica "falta o SQL").
 */
async function lerOpcional(api, tabela, query = {}) {
  try {
    return await ler(api, tabela, query);
  } catch (e) {
    if (e?.extra?.sql_pendente) return null;
    throw e;
  }
}

/**
 * Competência fechada não aceita mudança no que ela prova (pagamento,
 * documento, conta): a rota recusa, não só a tela (plano, seção M). Reabrir
 * com justificativa é o caminho. Sem o SQL da base, não há o que travar.
 */
async function garantirAberta(api, competencia, oQue = 'alterar') {
  if (!c.competenciaValida(competencia)) return;
  const linha = (await lerOpcional(api, 'competencia_contabil', { competencia: String(competencia) }) || [])[0] || null;
  if (linha?.status === 'fechada') {
    throw c.erro(`A competência ${c.rotuloCompetencia(competencia)} está fechada na Contabilidade: reabra-a para ${oQue}.`, 409, { competencia_fechada: competencia });
  }
}

/** Texto de dinheiro digitado ("1.234,56", "1234.56" ou número) em reais; null quando não há. */
function valorDe(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? c.centavos(v) : null;
  const t = String(v ?? '').replace(/[R$\s ]/g, '');
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normal);
  return Number.isFinite(n) ? c.centavos(n) : null;
}

const digitos = v => String(v ?? '').replace(/\D/g, '');

/** CNPJ (14) ou CPF (11) por extenso; outro tamanho volta como veio. */
function documentoFormatado(doc) {
  const d = digitos(doc);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return d || null;
}

module.exports = {
  SQL_ARQUIVO, SQL_FALTANDO, SQL_ARQUIVO_PAGAR, SQL_FALTANDO_PAGAR, SQL_ARQUIVO_EXTRATO, SQL_FALTANDO_EXTRATO,
  SQL_ARQUIVO_CONCILIACAO, SQL_FALTANDO_CONCILIACAO, SQL_ARQUIVO_CLASSIFICACAO, SQL_FALTANDO_CLASSIFICACAO,
  SQL_ARQUIVO_FECHAMENTO, SQL_FALTANDO_FECHAMENTO, SQL_ARQUIVO_PACOTE, SQL_FALTANDO_PACOTE, SQL_ARQUIVO_INTEGRACOES, SQL_FALTANDO_INTEGRACOES,
  SQL_ARQUIVO_FASE_A, SQL_FALTANDO_FASE_A, SQL_ARQUIVO_FASE_H, SQL_FALTANDO_FASE_H, SQL_ARQUIVO_FASE_D, SQL_FALTANDO_FASE_D,
  TABELAS, TABELAS_BASE, TABELAS_PAGAR, TABELAS_EXTRATO, TABELAS_CONCILIACAO, TABELAS_CLASSIFICACAO, TABELAS_FECHAMENTO, TABELAS_PACOTE, TABELAS_INTEGRACOES, TABELAS_FASE_A, TABELAS_FASE_H, TABELAS_FASE_D,
  sqlDaTabela, NIVEIS, nivelValido,
  tabelaAusente, ler, lerOpcional, inserir, atualizar, excluir, nomesDeUsuarios, instanteBR, ultimoDia,
  garantirAberta, valorDe, digitos, documentoFormatado
};
