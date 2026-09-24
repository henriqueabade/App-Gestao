/**
 * O que o cliente JÁ PAGOU e ainda não foi repassado — comissões (CMS e
 * Royalty) e produção. Decisões do dono de 24/09/2026 ("tudo recomendado"):
 *
 *   - Há dois atrasos. O de sempre é o do CLIENTE: a parcela venceu e não foi
 *     paga (comissoes.visaoDoMes). Este é o NOSSO: o dinheiro entrou, a
 *     comissão (ou a produção) já é devida, o prazo de pagamento da
 *     competência ("pagar até") passou e não há pagamento registrado — porque
 *     a competência não foi fechada, ou foi fechada e não foi paga (ou foi
 *     paga só em parte).
 *   - Vira atraso NO DIA SEGUINTE ao "pagar até". Até lá é só "a pagar".
 *   - Passa de mês em mês até o pagamento ser confirmado. Olhando um mês que
 *     já passou, é a foto do fim dele (a `referencia` de visaoDoMes).
 *
 * Uma linha por COMPETÊNCIA (é assim que se fecha e se paga), com quem ainda
 * tem a receber e, se ela não foi fechada, os itens que entrariam nela. Nada
 * aqui é recalculado de outro jeito: os itens são os mesmos do fechamento
 * (comissoes.pendentesDe / producao.pend) e o que foi fechado é o congelado.
 * Tudo puro.
 */
const c = require('./comum');
const calendario = require('./calendario');
const comissoes = require('./comissoes');
const producao = require('./producao');

const TIPOS = { comissao: 'Comissões', producao: 'Produção' };
const SITUACOES = {
  nao_fechada: 'competência não fechada',
  fechada: 'fechada, falta pagar',
  paga_em_parte: 'paga em parte, falta pagar'
};

const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Dias corridos de `de` até `ate` ('YYYY-MM-DD'). */
function diasEntre(de, ate) {
  const [a1, m1, d1] = String(de).split('-').map(Number);
  const [a2, m2, d2] = String(ate).split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

/**
 * Um fechamento visto na `referencia`: se já estava fechado nela, o que tinha
 * sido pago até ela e o que faltava. Fechado DEPOIS da referência conta como
 * "não fechado" naquela foto.
 */
function fechamentoNaReferencia(f, referencia) {
  const fechadoEm = comissoes.diaEmBrasilia(f.fechado_em || f.criado_em);
  const fechadoNela = !fechadoEm || fechadoEm <= referencia;
  const pagos = (f.pagamentos || []).filter(p => p && (!p.data_pagamento || c.dia(p.data_pagamento) <= referencia));
  const pago = c.centavos(pagos.reduce((s, p) => s + (Number(p.valor) || 0), 0));
  const total = c.centavos(f.total);
  return { fechadoNela, pagos, pago, total, falta: c.centavos(Math.max(0, total - pago)) };
}

/**
 * Quem ainda tem a receber de uma competência de comissões FECHADA: o resumo
 * congelado (`por_setor`) menos quem já foi pago. Um pagamento sem pessoa e
 * sem tipo cobre todo mundo; só com o tipo, todos daquele tipo; com a pessoa,
 * ela (no tipo, se veio) — as mesmas regras de fechamentos.alvoDoPagamento.
 */
function beneficiariosEmAberto(resumo, pagos) {
  const cobre = (p, b) => (!p.tipo_comissao || p.tipo_comissao === b.tipo)
    && (!p.beneficiario || semAcento(p.beneficiario) === semAcento(b.beneficiario));
  return (Array.isArray(resumo) ? resumo : [])
    .filter(b => b && Number(b.valor) > 0)
    .filter(b => !pagos.some(p => cobre(p, b)))
    .map(b => ({ tipo: b.tipo, beneficiario: b.beneficiario, valor: c.centavos(b.valor) }));
}

/** As competências a olhar: as fechadas e as que têm item à espera de fechamento. */
function competenciasCandidatas(estado, itens) {
  return [...new Set([
    ...estado.fechados.keys(),
    ...itens.map(i => String(i.competencia || '').trim()).filter(Boolean)
  ])].filter(comp => c.competenciaValida(comp)).sort();
}

/**
 * Comissões a repassar em atraso na `referencia`.
 * `estado` = comissoes.estadoDosFechamentos; `apuradas` = comissoes.apurar.
 */
function deComissao({ estado, apuradas, configuracao, referencia }) {
  const pendentes = comissoes.pendentesDe(apuradas || []);
  const saida = [];
  for (const competencia of competenciasCandidatas(estado, pendentes)) {
    const f = estado.fechados.get(competencia) || null;
    const pagarAte = (f && c.dia(f.pagar_ate)) || calendario.pagarComissaoAte(competencia, configuracao);
    if (!pagarAte || !(pagarAte < referencia)) continue;
    let linha;
    if (f) {
      const r = fechamentoNaReferencia(f, referencia);
      if (!(r.falta > 0)) continue;
      const itens = estado.congelados.filter(i => String(i.fechamento_id) === String(f.id)).map(comissoes.itemCongelado);
      linha = {
        situacao: !r.fechadoNela ? 'nao_fechada' : (r.pago > 0 ? 'paga_em_parte' : 'fechada'),
        valor: r.falta, total: r.total, pago: r.pago,
        beneficiarios: r.fechadoNela ? beneficiariosEmAberto(f.resumo, r.pagos) : beneficiariosEmAberto(f.resumo, []),
        fechamento_id: f.id, itens: r.fechadoNela ? [] : itens
      };
    } else {
      const itens = [
        ...pendentes.filter(p => String(p.competencia || '').trim() === competencia),
        ...(estado.proxima === competencia ? comissoes.saldosAnteriores(estado) : [])
      ];
      const resumo = comissoes.resumirItens(itens, { competencia });
      if (!(resumo.a_pagar > 0)) continue;
      linha = {
        situacao: 'nao_fechada', valor: resumo.a_pagar, total: resumo.a_pagar, pago: 0,
        beneficiarios: resumo.beneficiarios.filter(b => b.valor > 0).map(b => ({ tipo: b.tipo, beneficiario: b.beneficiario, valor: c.centavos(b.valor) })),
        fechamento_id: null, itens
      };
    }
    saida.push({
      tipo: 'comissao', competencia, pagar_ate: pagarAte, dias_atraso: diasEntre(pagarAte, referencia),
      rotulo: `${TIPOS.comissao} de ${c.rotuloCompetencia(competencia)}`, situacao_texto: SITUACOES[linha.situacao], ...linha
    });
  }
  return saida;
}

/**
 * Produção a repassar em atraso na `referencia`. A produção se paga de uma
 * vez (não há pagamento por pessoa): o que falta é o do fechamento, e os
 * processos vêm do resumo congelado ou da prévia.
 */
function deProducao({ estado, pend, configuracao, feriados = [], referencia }) {
  const linhasPend = Array.isArray(pend) ? pend : [];
  const saida = [];
  for (const competencia of competenciasCandidatas(estado, linhasPend)) {
    const f = estado.fechados.get(competencia) || null;
    const pagarAte = (f && c.dia(f.pagar_ate)) || calendario.pagarProducaoAte(competencia, configuracao, feriados);
    if (!pagarAte || !(pagarAte < referencia)) continue;
    let linha;
    if (f) {
      const r = fechamentoNaReferencia(f, referencia);
      if (!(r.falta > 0)) continue;
      linha = {
        situacao: !r.fechadoNela ? 'nao_fechada' : (r.pago > 0 ? 'paga_em_parte' : 'fechada'),
        valor: r.falta, total: r.total, pago: r.pago,
        setores: (Array.isArray(f.resumo) ? f.resumo : []).filter(s => Number(s.total) > 0).map(s => ({ setor: s.setor, pecas: Number(s.pecas) || 0, total: c.centavos(s.total) })),
        fechamento_id: f.id
      };
    } else {
      const linhas = [
        ...linhasPend.filter(l => String(l.competencia || '').trim() === competencia),
        ...(estado.proxima === competencia ? producao.saldosAnteriores(estado) : [])
      ];
      const r = producao.resumir(linhas);
      if (!(r.a_pagar > 0)) continue;
      linha = {
        situacao: 'nao_fechada', valor: r.a_pagar, total: r.a_pagar, pago: 0,
        setores: r.setores.filter(s => s.total > 0).map(s => ({ setor: s.setor, pecas: s.pecas, total: c.centavos(s.total) })),
        fechamento_id: null
      };
    }
    saida.push({
      tipo: 'producao', competencia, pagar_ate: pagarAte, dias_atraso: diasEntre(pagarAte, referencia),
      rotulo: `${TIPOS.producao} de ${c.rotuloCompetencia(competencia)}`, situacao_texto: SITUACOES[linha.situacao], ...linha
    });
  }
  return saida;
}

/** Total e as competências ("agosto/2026, julho/2026") de uma lista de repasses. */
function resumir(lista) {
  const l = Array.isArray(lista) ? lista : [];
  return {
    valor: c.centavos(l.reduce((s, r) => s + (Number(r.valor) || 0), 0)),
    competencias: l.map(r => r.competencia),
    rotulo: l.map(r => c.rotuloCompetencia(r.competencia)).join(', ')
  };
}

/** Quanto cada pessoa tem a receber, somando todas as competências em atraso. */
function beneficiariosSomados(lista) {
  return [...comissoes.somarBeneficiarios((lista || []).map(r => r.beneficiarios || [])).values()]
    .filter(b => b.valor > 0)
    .sort((a, b) => Number(b.valor) - Number(a.valor));
}

/** Os repasses sem os itens (a tela e o painel não precisam deles). */
const semItens = lista => (lista || []).map(({ itens, ...r }) => r);

module.exports = { TIPOS, SITUACOES, diasEntre, fechamentoNaReferencia, beneficiariosEmAberto, deComissao, deProducao, resumir, beneficiariosSomados, semItens };
