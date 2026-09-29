/**
 * O histórico do módulo Contabilidade (contabil_eventos): quem, quando, o
 * quê, e a que se refere (a conta a pagar, o documento, o pagamento) —
 * é daqui que saem a "Atividade recente" da tela e o histórico de cada
 * conta e documento.
 *
 * Registrar é o último passo de cada ação e não a desfaz se falhar: a ação
 * já aconteceu, e perder a linha do histórico é menos grave que responder
 * erro para algo que foi gravado (o mesmo hábito de financeiro/auditoria.js).
 */
const c = require('../financeiro/comum');
const b = require('./base');

const TIPOS = {
  competencia_fechada: 'Competência fechada',
  competencia_reaberta: 'Competência reaberta',
  pendencia_ignorada: 'Pendência ignorada',
  pendencia_restaurada: 'Pendência restaurada',
  documento_registrado: 'Documento registrado',
  documento_excluido: 'Documento excluído',
  fornecedor_cadastrado: 'Fornecedor cadastrado',
  arquivo_anexado: 'Arquivo anexado',
  arquivo_excluido: 'Arquivo excluído',
  titulo_criado: 'Conta a pagar lançada',
  titulo_alterado: 'Conta a pagar alterada',
  titulo_cancelado: 'Conta a pagar cancelada',
  pagamento_registrado: 'Pagamento registrado',
  pagamento_estornado: 'Pagamento estornado',
  conta_financeira_criada: 'Conta financeira cadastrada',
  extrato_importado: 'Extrato importado',
  extrato_desfeito: 'Importação de extrato desfeita',
  conciliacao_feita: 'Lançamento conciliado',
  conciliacao_desfeita: 'Conciliação desfeita',
  conciliacao_automatica: 'Conciliação em lote',
  lancamento_ignorado: 'Lançamento ignorado',
  lancamento_reativado: 'Lançamento reativado'
};

/** A que um evento se refere (o histórico de uma conta ou de um documento). */
const REFERENCIAS = ['titulo', 'documento_recebido', 'arquivo'];

async function registrar(api, { tipo, competencia = null, descricao, dados = null, usuarioId = null, referenciaTipo = null, referenciaId = null }) {
  try {
    const linha = {
      tipo, competencia: c.competenciaValida(competencia) ? String(competencia) : null, descricao: c.texto(descricao, 500),
      dados: dados ? JSON.stringify(dados) : null, usuario_id: usuarioId, criado_em: c.agora()
    };
    // As colunas de referência chegam com sql/contabilidade_contas_pagar.sql;
    // antes dele a API ignora o que não conhece.
    if (REFERENCIAS.includes(referenciaTipo) && referenciaId !== null && referenciaId !== undefined) {
      linha.referencia_tipo = referenciaTipo;
      linha.referencia_id = Number(referenciaId);
    }
    await b.inserir(api, 'contabil_eventos', linha);
    return true;
  } catch (e) {
    console.error('[contabilidade] não foi possível registrar o histórico:', e?.message || e);
    return false;
  }
}

/**
 * Os eventos mais recentes, com quem fez, já em horário de Brasília. Filtra
 * pela competência ou pela referência (o histórico de uma conta).
 */
async function atividade({ api, competencia = null, limite = 50, referenciaTipo = null, referenciaId = null }) {
  const query = {};
  if (c.competenciaValida(competencia)) query.competencia = String(competencia);
  if (REFERENCIAS.includes(referenciaTipo) && referenciaId !== null && referenciaId !== undefined) {
    query.referencia_tipo = referenciaTipo;
    query.referencia_id = Number(referenciaId);
  }
  const linhas = (await b.ler(api, 'contabil_eventos', query))
    .sort((x, y) => String(y.criado_em).localeCompare(String(x.criado_em)) || Number(y.id) - Number(x.id))
    .slice(0, Math.max(1, Math.min(500, Number(limite) || 50)));
  const nomes = await b.nomesDeUsuarios(api, linhas.map(e => e.usuario_id));
  return linhas.map(e => ({
    id: e.id, tipo: e.tipo, rotulo: TIPOS[e.tipo] || e.tipo, competencia: e.competencia || null,
    descricao: e.descricao || '', dados: c.jsonDe(e.dados), usuario: nomes.get(String(e.usuario_id)) || null,
    referencia_tipo: e.referencia_tipo || null, referencia_id: e.referencia_id ?? null,
    quando: b.instanteBR(e.criado_em)
  }));
}

module.exports = { TIPOS, REFERENCIAS, registrar, atividade };
