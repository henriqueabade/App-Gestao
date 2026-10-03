/**
 * Os parâmetros gerais da Contabilidade (fase A, 02/10/2026) — a tabela
 * contabil_parametros (sql/contabilidade_fase_a.sql), uma linha por chave:
 *
 *   inicio_competencia   o mês em que a Contabilidade começa (o dono:
 *                        setembro/2026). Os meses de antes não são cobrados
 *                        nem fechados; as notas deles esperam a decisão na
 *                        caixa de entrada (histórico ou registro).
 *   cartao_ativo         (fase G) "sim": a fatura do cartão de cada mês é
 *                        cobrada no painel.
 *   cartao_limite_sem_nota (fase G) a compra no cartão abaixo deste valor
 *                        não precisa de nota (o dono: R$ 50).
 *
 * Sem o SQL, nenhum corte (como era antes) e a tela diz qual arquivo rodar.
 * Mudar é do Sup Admin (como as integrações).
 */
const c = require('../financeiro/comum');
const b = require('./base');
const eventos = require('./eventos');

const TABELA = 'contabil_parametros';
const CAMPOS = {
  inicio_competencia: { rotulo: 'Início da Contabilidade', padrao: '2026-09' },
  // Fase G: o cartão de crédito (a fatura do mês é cobrada) e a compra que não precisa de nota.
  cartao_ativo: { rotulo: 'Cartão de crédito em uso', padrao: 'sim' },
  cartao_limite_sem_nota: { rotulo: 'Compra no cartão sem nota até', padrao: '50.00' }
};

/** "50", "50,00", "R$ 1.250,90" → "50.00" (0 a 100.000). Pura. */
function limiteDe(valor) {
  const t = String(valor ?? '').replace(/R\$/g, '').replace(/\s+/g, '').trim();
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  if (!t || !Number.isFinite(n) || n < 0 || n > 100000) throw c.erro('Informe o limite da compra sem nota em reais (de 0 a 100.000).');
  return c.centavos(n).toFixed(2);
}

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
  if (entrada.cartao_ativo !== undefined) {
    novos.cartao_ativo = [true, 'true', 'sim', 'Sim', 1, '1'].includes(entrada.cartao_ativo) ? 'sim' : 'nao';
  }
  if (entrada.cartao_limite_sem_nota !== undefined) novos.cartao_limite_sem_nota = limiteDe(entrada.cartao_limite_sem_nota);
  const linhas = await b.ler(api, TABELA);
  const mudou = [];
  for (const [chave, valor] of Object.entries(novos)) {
    if (atual.valores[chave] === valor) continue;
    const linha = linhas.find(l => l.chave === chave);
    if (linha) await b.atualizar(api, TABELA, linha.id, { valor, atualizado_em: c.agora(), atualizado_por: usuarioId });
    else await b.inserir(api, TABELA, { chave, valor, atualizado_em: c.agora(), atualizado_por: usuarioId });
    const impresso = chave === 'inicio_competencia' ? c.rotuloCompetencia(valor) : chave === 'cartao_limite_sem_nota' ? c.reais(Number(valor)) : chave === 'cartao_ativo' ? (valor === 'sim' ? 'sim' : 'não') : valor;
    mudou.push(`${CAMPOS[chave].rotulo}: ${impresso}`);
  }
  if (mudou.length) await eventos.registrar(api, { tipo: 'parametros_alterados', usuarioId, descricao: `Configurações gerais: ${mudou.join(', ')}` });
  return ler(api);
}

/** A competência é de antes do início? (sem início, nunca) Pura. */
const antesDoInicio = (competencia, inicioComp) => Boolean(inicioComp && competencia && String(competencia) < String(inicioComp));

module.exports = { TABELA, CAMPOS, competenciaDe, limiteDe, ler, inicio, salvar, antesDoInicio };
