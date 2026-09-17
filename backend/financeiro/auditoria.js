/**
 * Histórico do Financeiro (fase G): cada ação que mexe em dinheiro ou nas
 * regras vira uma linha em `financeiro_eventos` — quem, quando, o quê, e o
 * antes/depois quando há. É daqui que saem a "Atividade recente" e o
 * histórico das parcelas e dos pedidos.
 *
 * Registrar é o último passo de cada ação e não a desfaz se falhar: a ação
 * já aconteceu, e perder a linha do histórico é menos grave que responder
 * erro para algo que foi gravado.
 */
const c = require('./comum');

const TIPOS = {
  ajuste_registrado: 'Ajuste registrado',
  ajuste_cancelado: 'Ajuste cancelado',
  producao_registrada: 'Produção registrada',
  producao_estornada: 'Produção estornada',
  competencia_fechada: 'Competência fechada',
  pagamento_confirmado: 'Pagamento confirmado',
  regra_criada: 'Regra de comissão criada',
  regra_alterada: 'Regra de comissão alterada',
  valor_producao: 'Valor de produção alterado',
  setor_alterado: 'Setor de produção alterado',
  feriado_alterado: 'Calendário alterado',
  configuracao_alterada: 'Prazos alterados'
};

async function registrar(api, { tipo, descricao, pedidoId = null, numeroParcela = null, referenciaId = null, valor = null, dados = null, usuarioId = null }) {
  try {
    await api.post('/api/financeiro_eventos', {
      tipo, descricao: c.texto(descricao, 500), pedido_id: pedidoId, numero_parcela: numeroParcela,
      referencia_id: referenciaId, valor: valor === null || valor === undefined ? null : c.centavos(valor),
      dados: dados ? JSON.stringify(dados) : null, usuario_id: usuarioId, criado_em: c.agora()
    });
    return true;
  } catch (e) {
    console.error('[financeiro] não foi possível registrar o histórico:', e?.message || e);
    return false;
  }
}

/** Os eventos mais recentes (os do pedido, quando `pedidoId`). */
async function recentes(api, { limite = 20, pedidoId = null } = {}) {
  const linhas = await c.ler(api, 'financeiro_eventos', pedidoId ? { pedido_id: pedidoId } : {});
  return linhas
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)) || Number(b.id) - Number(a.id))
    .slice(0, limite)
    .map(e => ({ ...e, rotulo: TIPOS[e.tipo] || e.tipo, dados: c.jsonDe(e.dados) }));
}

module.exports = { TIPOS, registrar, recentes };
