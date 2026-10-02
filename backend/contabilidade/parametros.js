/**
 * Os parâmetros gerais da Contabilidade (fase A, 02/10/2026) — a tabela
 * contabil_parametros (sql/contabilidade_fase_a.sql), uma linha por chave:
 *
 *   inicio_competencia   o mês em que a Contabilidade começa (o dono:
 *                        setembro/2026). Os meses de antes não são cobrados
 *                        nem fechados; as notas deles esperam a decisão na
 *                        caixa de entrada (histórico ou registro).
 *
 * Sem o SQL, nenhum corte (como era antes) e a tela diz qual arquivo rodar.
 * Mudar é do Sup Admin (como as integrações).
 */
const c = require('../financeiro/comum');
const b = require('./base');
const eventos = require('./eventos');

const TABELA = 'contabil_parametros';
const CAMPOS = {
  inicio_competencia: { rotulo: 'Início da Contabilidade', padrao: '2026-09' }
};

/** AAAA-MM ou MM/AAAA → AAAA-MM; vazio → null. Pura. */
function competenciaDe(valor) {
  const t = String(valor ?? '').trim();
  if (!t) return null;
  const br = /^(\d{2})\/(\d{4})$/.exec(t);
  const comp = br ? `${br[2]}-${br[1]}` : t;
  if (!c.competenciaValida(comp)) throw c.erro('Informe o mês no formato AAAA-MM (ou MM/AAAA).');
  return comp;
}

/** Os valores que valem: os gravados ou, sem a linha, o padrão (null sem o SQL). */
async function ler(api) {
  const linhas = await b.lerOpcional(api, TABELA);
  if (linhas === null) return { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_A, valores: { inicio_competencia: null } };
  const porChave = new Map(linhas.map(l => [l.chave, l]));
  const valores = {};
  for (const [chave, def] of Object.entries(CAMPOS)) {
    const l = porChave.get(chave);
    valores[chave] = l ? (l.valor || null) : def.padrao;
  }
  return { sql_pendente: false, valores };
}

/** O mês de início que vale (null = sem corte). */
async function inicio(api) {
  return (await ler(api).catch(() => ({ valores: {} }))).valores.inicio_competencia || null;
}

/** Grava o que veio (só as chaves conhecidas). */
async function salvar(api, entrada = {}, { usuarioId = null } = {}) {
  const atual = await ler(api);
  if (atual.sql_pendente) throw c.erro(b.SQL_FALTANDO_FASE_A, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_A });
  const novos = {};
  if (entrada.inicio_competencia !== undefined) {
    novos.inicio_competencia = competenciaDe(entrada.inicio_competencia) || CAMPOS.inicio_competencia.padrao;
  }
  const linhas = await b.ler(api, TABELA);
  const mudou = [];
  for (const [chave, valor] of Object.entries(novos)) {
    if (atual.valores[chave] === valor) continue;
    const linha = linhas.find(l => l.chave === chave);
    if (linha) await b.atualizar(api, TABELA, linha.id, { valor, atualizado_em: c.agora(), atualizado_por: usuarioId });
    else await b.inserir(api, TABELA, { chave, valor, atualizado_em: c.agora(), atualizado_por: usuarioId });
    mudou.push(`${CAMPOS[chave].rotulo}: ${chave === 'inicio_competencia' ? c.rotuloCompetencia(valor) : valor}`);
  }
  if (mudou.length) await eventos.registrar(api, { tipo: 'parametros_alterados', usuarioId, descricao: `Configurações gerais: ${mudou.join(', ')}` });
  return ler(api);
}

/** A competência é de antes do início? (sem início, nunca) Pura. */
const antesDoInicio = (competencia, inicioComp) => Boolean(inicioComp && competencia && String(competencia) < String(inicioComp));

module.exports = { TABELA, CAMPOS, competenciaDe, ler, inicio, salvar, antesDoInicio };
