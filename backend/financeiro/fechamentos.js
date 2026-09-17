/**
 * Fechamento de competência e pagamento (fase G).
 *
 * Comissões e produção fecham separados. Fechar = apurar e CONGELAR:
 * cada parcela, ajuste, saldo ou evento de produção vira uma linha em
 * `financeiro_fechamento_itens` com os valores e percentuais do momento, e
 * nada disso muda depois. Pagar é outra etapa (`financeiro_pagamentos`).
 *
 * Regras:
 *   - fecha-se em ordem: depois do primeiro fechamento, só o mês seguinte
 *     ao último fechado (o primeiro leva também o que ficou de antes);
 *   - não se fecha mês futuro; o mês corrente pode, com aviso (o que entrar
 *     depois cai no próximo);
 *   - comissões: não fecha com boleto pago ainda não lançado (concilie);
 *   - produção: não fecha com peça sem valor por peça cadastrado.
 *
 * "Tudo ou nada" sem transação na API genérica: o cabeçalho nasce
 * `fechando` (a UNIQUE tipo+competência é a trava entre máquinas), os itens
 * entram e só então ele vira `fechado`. Falhou no meio: os itens são
 * apagados e o cabeçalho também; um `fechando` que sobrou (queda) é
 * limpo na próxima tentativa. Só `fechado` conta.
 */
const c = require('./comum');
const calendario = require('./calendario');
const comissoes = require('./comissoes');
const producao = require('./producao');
const auditoria = require('./auditoria');
const base = require('./base');

const TIPOS = { comissao: 'Comissões', producao: 'Produção' };
const FORMAS_PAGAMENTO = ['Pix', 'Transferência', 'Depósito', 'Dinheiro', 'Cheque', 'Outro'];

function validarTipo(tipo) {
  if (!TIPOS[tipo]) throw c.erro('Escolha comissões ou produção.');
  return tipo;
}

function validarCompetencia(competencia) {
  if (!c.competenciaValida(competencia)) throw c.erro('Escolha a competência.');
  return competencia;
}

/** O que impede fechar (lista de textos) e os avisos. Pura. */
function conferir({ tipo, competencia, estado, hoje, extra = {} }) {
  const bloqueios = [];
  const avisos = [];
  const atual = c.competenciaDe(hoje);
  if (estado.fechados.has(competencia)) bloqueios.push(`${TIPOS[tipo]} de ${c.rotuloCompetencia(competencia)} já foram fechadas.`);
  if (competencia > atual) bloqueios.push('Não se fecha competência futura.');
  if (estado.proxima && competencia !== estado.proxima && !estado.fechados.has(competencia)) {
    bloqueios.push(competencia < estado.proxima
      ? `${c.rotuloCompetencia(competencia)} é anterior ao último fechamento (${c.rotuloCompetencia(estado.ultimo.competencia)}): o que era dela entra em ${c.rotuloCompetencia(estado.proxima)}.`
      : `Feche antes ${c.rotuloCompetencia(estado.proxima)} (as competências fecham em ordem).`);
  }
  if (competencia === atual) avisos.push(`${c.rotuloCompetencia(competencia)} ainda não terminou: o que for registrado com data deste mês depois do fechamento entra em ${c.rotuloCompetencia(c.somarMeses(competencia, 1))}.`);
  if (tipo === 'comissao') {
    if (extra.aLancar) bloqueios.push(`${c.plural(extra.aLancar, 'boleto pago ainda não foi lançado', 'boletos pagos ainda não foram lançados')} nos recebimentos: use "Conciliar com o BB" antes de fechar.`);
    if (extra.fila) avisos.push(`${c.plural(extra.fila, 'aviso de pagamento do BB está', 'avisos de pagamento do BB estão')} na fila: concilie antes, para não ficar pagamento de fora.`);
    if (extra.semRegra) avisos.push(`${c.plural(extra.semRegra, 'parcela recebida não tem', 'parcelas recebidas não têm')} regra de CMS/Royalty: entram com comissão zero.`);
    if (extra.sqlRecebimentos) bloqueios.push('Os recebimentos ainda não estão ativados (sql/cobranca_recebimentos.sql).');
  } else if (extra.semValor?.length) {
    const nomes = [...new Set(extra.semValor.map(l => `${l.produto} (${l.setor})`))].slice(0, 5);
    bloqueios.push(`Produção sem valor (sem regra do processo, ou regra em % numa peça sem preço na tabela fixa): ${nomes.join('; ')}${extra.semValor.length > 5 ? '…' : ''}. Acerte em "Regras" ou no cadastro da peça.`);
  }
  return { bloqueios, avisos };
}

/** Comissões: a base inteira e a prévia (ou o congelado) da competência. */
async function dadosComissao(api, { competencia, hoje, desde }) {
  const b = await base.lerComissoes(api, { hoje, desde });
  const estado = comissoes.estadoDosFechamentos({ ...b, tipo: 'comissao' });
  const apuradas = comissoes.apurar({
    linhas: b.linhas, pedidos: b.receber.pedidos, parcelas: b.receber.parcelas, recebimentos: b.receber.recebimentos,
    ajustes: b.ajustes, regrasLista: b.regras.regras, estado, hoje, contexto: b.contexto
  });
  const resumo = comissoes.montarFechamento({ apuradas, estado, competencia });
  return { b, estado, apuradas, resumo };
}

async function previa({ api, tipo, competencia, hoje, desde }) {
  validarTipo(tipo);
  validarCompetencia(competencia);
  if (tipo === 'comissao') {
    const { b, estado, apuradas, resumo } = await dadosComissao(api, { competencia, hoje, desde });
    const nomes = await base.nomesDosClientes(api, resumo.itens.map(i => i.cliente_id));
    const semRegra = apuradas.filter(a => a.sem_regra && a.pendentes.some(i => i.tipo_item === 'parcela' && i.competencia <= competencia)).length;
    const conf = conferir({
      tipo, competencia, estado, hoje,
      extra: {
        aLancar: apuradas.filter(p => p.lancamento_pendente).length, fila: b.receber.fila,
        semRegra: resumo.fechado ? 0 : semRegra, sqlRecebimentos: b.receber.sqlPendente
      }
    });
    return {
      tipo, competencia, ...resumo,
      itens: resumo.itens.map(i => ({ ...i, cliente: i.cliente || nomes.get(String(i.cliente_id)) || null })),
      pagar_ate: resumo.fechamento?.pagar_ate || calendario.pagarComissaoAte(competencia, b.regras.configuracao),
      proxima: estado.proxima, ...conf, pode_fechar: !resumo.fechado && conf.bloqueios.length === 0
    };
  }
  const p = await producao.lerBase(api);
  const comp = producao.montarCompetencia({ pend: p.pend, estado: p.estado, competencia });
  const conf = conferir({ tipo, competencia, estado: p.estado, hoje, extra: { semValor: comp.fechado ? [] : comp.sem_valor } });
  return {
    tipo, competencia, ...comp,
    pagar_ate: comp.fechamento?.pagar_ate || calendario.pagarProducaoAte(competencia, p.regras.configuracao, p.regras.feriados),
    proxima: p.estado.proxima, ...conf, pode_fechar: !comp.fechado && conf.bloqueios.length === 0
  };
}

/** Apaga o que sobrou de uma tentativa interrompida (cabeçalho `fechando`). */
async function limparTentativa(api, cabecalho) {
  const itens = await c.ler(api, 'financeiro_fechamento_itens', { fechamento_id: cabecalho.id });
  for (const i of itens) await api.delete(`/api/financeiro_fechamento_itens/${i.id}`);
  await api.delete(`/api/financeiro_fechamentos/${cabecalho.id}`);
}

const linhaItemComissao = (fechamentoId, i) => ({
  fechamento_id: fechamentoId, tipo_item: i.tipo_item, pedido_id: i.pedido_id ?? null, numero_parcela: i.numero_parcela ?? null,
  recebimento_id: i.tipo_item === 'parcela' ? (i.recebimento_id ?? null) : null, producao_evento_id: null,
  competencia_origem: i.competencia_natural || null, data_referencia: i.data_referencia || null,
  valor_parcela: i.valor_parcela ?? null, ajustes: i.ajustes ?? null, base: i.base ?? null,
  pct_cms: i.pct_cms ?? null, pct_royalty: i.pct_royalty ?? null,
  cms: c.centavos(i.cms), royalty: c.centavos(i.royalty), quantidade: null, valor_unitario: null, setor: null, produto: null,
  total: c.centavos(i.total),
  detalhes: JSON.stringify({ ...i.detalhes, pedido: i.pedido ?? null, parcela: i.parcela ?? null, nf: i.nf ?? null, cliente_id: i.cliente_id ?? null, motivo: i.motivo || i.detalhes?.motivo || null }),
  criado_em: c.agora()
});

const linhaItemProducao = (fechamentoId, l) => ({
  fechamento_id: fechamentoId, tipo_item: l.tipo_item, pedido_id: l.pedido_id ?? null, numero_parcela: null, recebimento_id: null,
  producao_evento_id: l.tipo_item === 'producao' ? l.evento_id : null,
  competencia_origem: l.competencia_natural || null, data_referencia: l.data || null,
  valor_parcela: null, ajustes: null, base: null, pct_cms: null, pct_royalty: null, cms: 0, royalty: 0,
  quantidade: Number(l.quantidade) || 0, valor_unitario: l.valor_unitario, setor: l.setor, produto: l.produto,
  total: c.centavos(l.total),
  detalhes: JSON.stringify({
    pedido: l.pedido ?? null, pedido_item_id: l.pedido_item_id ?? null, produto_id: l.produto_id ?? null, setor_id: l.setor_id ?? null,
    estorno_de: l.estorno_de ?? null, valor_origem: l.valor_origem ?? null, status_item: l.status_item ?? null, motivo: l.motivo || null,
    valor_peca: l.valor_peca ?? null, fracao: l.fracao ?? null, regra: l.regra ?? null,
    fechamento_origem: l.fechamento_origem ?? null
  }),
  criado_em: c.agora()
});

async function fechar({ api, tipo, competencia, hoje, desde, usuarioId = null }) {
  const p = await previa({ api, tipo, competencia, hoje, desde });
  if (p.fechado) throw c.erro(`${TIPOS[tipo]} de ${c.rotuloCompetencia(competencia)} já foram fechadas.`, 409);
  if (p.bloqueios.length) throw c.erro(p.bloqueios.join(' '), 409, { bloqueios: p.bloqueios });

  const existentes = await c.ler(api, 'financeiro_fechamentos', { tipo });
  const sobra = existentes.find(f => String(f.competencia).trim() === competencia && f.status !== 'fechado');
  if (sobra) {
    // Um `fechando` recente é outra máquina fechando agora; um antigo sobrou de uma queda.
    const idade = Date.now() - new Date(sobra.criado_em || 0).getTime();
    if (idade < 5 * 60 * 1000) throw c.erro('Outra pessoa está fechando esta competência agora. Espere um pouco e atualize a tela.', 409);
    await limparTentativa(api, sobra);
  }

  const comissao = tipo === 'comissao';
  const congelar = comissao ? p.itens : p.linhas;
  const resumoJson = comissao
    ? p.beneficiarios.map(b => ({ tipo: b.tipo, beneficiario: b.beneficiario, valor: b.valor }))
    : p.setores.map(s => ({ setor_id: s.setor_id, setor: s.setor, pecas: s.pecas, total: s.total }));
  let cabecalho;
  try {
    cabecalho = await c.inserir(api, 'financeiro_fechamentos', {
      tipo, competencia, status: 'fechando',
      quantidade: comissao ? p.parcelas : p.pecas,
      base_total: comissao ? p.base : 0,
      cms_total: comissao ? p.cms : 0,
      royalty_total: comissao ? p.royalty : 0,
      ajustes_total: comissao ? p.ajustes : 0,
      total: p.a_pagar,
      por_setor: JSON.stringify(resumoJson),
      pagar_ate: p.pagar_ate, criado_em: c.agora()
    });
  } catch (e) {
    if (c.ehDuplicado(e)) throw c.erro('Outra pessoa está fechando esta competência agora. Atualize a tela.', 409);
    throw e;
  }

  try {
    for (const i of congelar) {
      await c.inserir(api, 'financeiro_fechamento_itens', comissao ? linhaItemComissao(cabecalho.id, i) : linhaItemProducao(cabecalho.id, i));
    }
    await c.atualizar(api, 'financeiro_fechamentos', cabecalho.id, { status: 'fechado', fechado_por: usuarioId, fechado_em: c.agora() });
  } catch (e) {
    await limparTentativa(api, cabecalho).catch(falha => console.error('[financeiro] não foi possível desfazer o fechamento incompleto:', falha?.message || falha));
    if (c.ehDuplicado(e)) throw c.erro('Algum item já entrou em outro fechamento (outra máquina?). Nada foi fechado: atualize e tente de novo.', 409);
    throw e;
  }

  const total = p.a_pagar;
  await auditoria.registrar(api, {
    tipo: 'competencia_fechada', referenciaId: cabecalho.id, valor: total, usuarioId,
    descricao: comissao
      ? `Comissões de ${c.rotuloCompetencia(competencia)} fechadas: ${c.plural(p.parcelas, 'parcela', 'parcelas')}, ${c.reais(total)} a pagar até ${c.impressa(p.pagar_ate)}`
      : `Produção de ${c.rotuloCompetencia(competencia)} fechada: ${c.plural(p.pecas, 'peça', 'peças')}, ${c.reais(total)} a pagar até ${c.impressa(p.pagar_ate)}`,
    dados: { resumo: resumoJson, a_compensar: p.a_compensar }
  });
  return { fechamento: { ...cabecalho, status: 'fechado' }, itens: congelar.length, total, pagar_ate: p.pagar_ate, a_compensar: p.a_compensar };
}

async function pagar({ api, entrada, hoje, usuarioId = null }) {
  const tipo = validarTipo(String(entrada?.tipo || ''));
  const competencia = validarCompetencia(String(entrada?.competencia || ''));
  const data = String(entrada?.data_pagamento || '').slice(0, 10);
  if (!c.dataValida(data)) throw c.erro('Informe a data do pagamento.');
  if (data > hoje) throw c.erro('A data do pagamento não pode ser futura.');
  const forma = String(entrada?.forma || '');
  if (!FORMAS_PAGAMENTO.includes(forma)) throw c.erro(`Informe como foi pago (${FORMAS_PAGAMENTO.join(', ')}).`);
  const fech = await base.lerFechamentos(api);
  const f = fech.fechamentos.find(x => x.tipo === tipo && x.competencia === competencia && x.status === 'fechado');
  if (!f) throw c.erro(`${TIPOS[tipo]} de ${c.rotuloCompetencia(competencia)} ainda não foram fechadas: feche antes de confirmar o pagamento.`, 409);
  const ja = fech.pagamentos.find(x => String(x.fechamento_id) === String(f.id));
  if (ja) throw c.erro(`O pagamento desta competência já foi confirmado em ${c.impressa(ja.data_pagamento)}.`, 409);
  const valor = c.centavos(f.total);
  if (!(valor > 0)) throw c.erro('Não há valor a pagar nesta competência.', 409);
  if (data < (comissoes.diaEmBrasilia(f.fechado_em || f.criado_em) || data)) throw c.erro('O pagamento não pode ser anterior ao fechamento.');
  let pagamento;
  try {
    pagamento = await c.inserir(api, 'financeiro_pagamentos', {
      fechamento_id: f.id, tipo, competencia, valor, data_pagamento: data, forma,
      observacao: c.texto(entrada?.observacao, 500) || null, criado_por: usuarioId, criado_em: c.agora()
    });
  } catch (e) {
    if (c.ehDuplicado(e)) throw c.erro('O pagamento desta competência acabou de ser confirmado por outra pessoa.', 409);
    throw e;
  }
  const atraso = f.pagar_ate && data > c.dia(f.pagar_ate);
  await auditoria.registrar(api, {
    tipo: 'pagamento_confirmado', referenciaId: pagamento.id, valor, usuarioId,
    descricao: `Pagamento de ${TIPOS[tipo].toLowerCase()} de ${c.rotuloCompetencia(competencia)}: ${c.reais(valor)} em ${c.impressa(data)} (${forma})${atraso ? ` — depois do prazo (${c.impressa(f.pagar_ate)})` : ''}`
  });
  return { pagamento, atrasado: Boolean(atraso) };
}

/** Os fechamentos de um tipo (mais novos primeiro), com o pagamento. */
function listarDe(fech, tipo) {
  return fech.fechamentos
    .filter(f => f.tipo === tipo && f.status === 'fechado')
    .sort((a, b) => b.competencia.localeCompare(a.competencia))
    .map(f => {
      const pg = fech.pagamentos.find(x => String(x.fechamento_id) === String(f.id)) || null;
      return {
        id: f.id, tipo, competencia: f.competencia, quantidade: Number(f.quantidade) || 0, total: c.centavos(f.total),
        pagar_ate: c.dia(f.pagar_ate), fechado_em: f.fechado_em, resumo: c.jsonDe(f.por_setor, []),
        pagamento: pg ? { data: pg.data_pagamento, valor: c.centavos(pg.valor), forma: pg.forma } : null
      };
    });
}

async function listar(api, tipo) {
  validarTipo(tipo);
  return listarDe(await base.lerFechamentos(api), tipo);
}

module.exports = { TIPOS, FORMAS_PAGAMENTO, conferir, dadosComissao, previa, fechar, pagar, listarDe, listar, limparTentativa };
