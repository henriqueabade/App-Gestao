/**
 * Classificação dos lançamentos do extrato (etapa 6): em que conta do plano
 * cada entrada e saída do banco cai — a base do relatório mensal.
 *
 * A conta de um lançamento, nesta ordem:
 *   1. à mão       o que alguém escolheu (classificacoes; reclassificar
 *                  substitui, a anterior fica guardada)
 *   2. conciliado  pelo que ele casa: a categoria da conta a pagar (ou a regra
 *                  do fornecedor dela), a origem do dinheiro (recebimento,
 *                  reembolso, comissão, produção) — todas as partes na mesma
 *                  conta; partes em contas diferentes pedem a mão
 *   3. regra       descrição do banco ou CNPJ/CPF da contrapartida
 *   4. sem         vira pendência documental no checklist
 *
 * Só o 1 é gravado; o 2 e o 3 são calculados a cada leitura (mudar uma regra
 * reclassifica o que ainda não foi fechado). O fechamento completo (etapa 7)
 * congela o resultado do mês.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const extrato = require('../extrato/extrato');
const liquidacoes = require('../conciliacao/liquidacoes');
const regrasMod = require('./regras');
const planoMod = require('./plano');

const CRITERIOS = { manual: 'À mão', titulo: 'Pela categoria da conta a pagar', origem: 'Pela origem do dinheiro', regra: 'Por regra', sem: 'Sem classificação' };
const VISOES = { sem: 'Sem classificação', manuais: 'Classificados à mão', automaticos: 'Classificados sozinhos', todos: 'Todos' };

const ativaC = x => x && !x.substituida_em;
const sentidoDe = valor => (Number(valor) < 0 ? 'debito' : 'credito');

// ------------------------------------------------------------------ puras

/** Mapas para classificar: o plano por id e por nome, e as regras ativas. Pura. */
function contexto({ plano = [], regras = [] }) {
  return {
    planoPorId: new Map(c.lista(plano).map(p => [String(p.id), p])),
    planoPorNome: new Map(c.lista(plano).filter(planoMod.ativa).map(p => [planoMod.chaveNome(p.nome), p])),
    regras: c.lista(regras).filter(r => r && r.ativa !== false && r.ativa !== 'false')
  };
}

const daRegra = (r, ctx, criterio = 'regra') => {
  const conta = r ? ctx.planoPorId.get(String(r.conta_id)) : null;
  return conta ? { conta, criterio, regra_id: r.id, detalhe: `${regrasMod.CONDICOES[r.condicao_tipo]}: ${regrasMod.rotuloDoValor(r)}` } : null;
};

/** A conta de uma liquidação conciliada (ou null). Pura. */
function contaDaLiquidacao(liq, ctx) {
  if (!liq) return null;
  const sentido = sentidoDe(liq.valor);
  if (liq.tipo === 'titulo_pagamento') {
    const pelaCategoria = liq.categoria ? ctx.planoPorNome.get(planoMod.chaveNome(liq.categoria)) : null;
    if (pelaCategoria) return { conta: pelaCategoria, criterio: 'titulo', regra_id: null, detalhe: `categoria "${liq.categoria}" de ${liq.rotulo}` };
    return daRegra(regrasMod.escolher(ctx.regras, { contato_id: liq.contato_id, sentido }, { condicoes: ['fornecedor'] }), ctx);
  }
  const origem = liq.tipo === 'financeiro_pagamento' ? liq.subtipo : liq.tipo;
  const r = regrasMod.escolher(ctx.regras, { origem, sentido }, { condicoes: ['origem'] });
  const x = daRegra(r, ctx, 'origem');
  return x ? { ...x, detalhe: regrasMod.ORIGENS[origem] || x.detalhe } : null;
}

/**
 * A classificação que vale para o lançamento. `manual` é a linha de
 * classificacoes valendo (ou null); `vinculos` os valendo dele. Pura.
 */
function efetiva(mov, { manual = null, vinculos = [], liqsPorChave = new Map(), ctx }) {
  const saida = (x, criterio) => ({
    conta_id: x.conta.id, conta: x.conta.nome, conta_tipo: x.conta.tipo, criterio, criterio_rotulo: CRITERIOS[criterio],
    detalhe: x.detalhe || null, regra_id: x.regra_id ?? null
  });
  if (manual) {
    const conta = ctx.planoPorId.get(String(manual.conta_id));
    if (conta) return saida({ conta, detalhe: manual.observacao || null }, 'manual');
  }
  let partesDivergentes = false;
  if (mov.estado_conciliacao === 'conciliado' && vinculos.length) {
    const contas = vinculos.map(v => contaDaLiquidacao(liqsPorChave.get(liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id)), ctx));
    if (contas.every(Boolean) && new Set(contas.map(x => String(x.conta.id))).size === 1) return saida(contas[0], contas[0].criterio);
    partesDivergentes = contas.filter(Boolean).length > 0;
  }
  const r = regrasMod.escolher(ctx.regras, { descricao: mov.descricao, contrapartida: mov.contrapartida_documento, sentido: sentidoDe(mov.valor) }, { condicoes: ['descricao', 'contrapartida'] });
  const pelaRegra = daRegra(r, ctx);
  if (pelaRegra) return saida(pelaRegra, 'regra');
  return {
    conta_id: null, conta: null, conta_tipo: null, criterio: 'sem', criterio_rotulo: CRITERIOS.sem, regra_id: null,
    detalhe: partesDivergentes ? 'as partes da conciliação caem em contas diferentes: escolha uma' : null
  };
}

/** O total por conta do plano (a prévia do relatório): entradas, saídas, resultado. Pura. */
function porConta(linhas) {
  const grupos = new Map();
  for (const l of c.lista(linhas)) {
    const k = l.classificacao?.conta_id ? String(l.classificacao.conta_id) : 'sem';
    const g = grupos.get(k) || {
      conta_id: l.classificacao?.conta_id ?? null, conta: l.classificacao?.conta || 'Sem classificação', tipo: l.classificacao?.conta_tipo || null,
      entradas: 0, saidas: 0, resultado: 0, quantidade: 0
    };
    const v = Number(l.valor) || 0;
    if (v > 0) g.entradas = c.centavos(g.entradas + v); else g.saidas = c.centavos(g.saidas + v);
    g.resultado = c.centavos(g.resultado + v);
    g.quantidade += 1;
    grupos.set(k, g);
  }
  return [...grupos.values()].sort((x, y) => (x.conta_id === null) - (y.conta_id === null)
    || planoMod.ORDEM.indexOf(x.tipo) - planoMod.ORDEM.indexOf(y.tipo) || x.conta.localeCompare(y.conta, 'pt-BR'))
    .map(g => ({ ...g, tipo_rotulo: planoMod.TIPOS[g.tipo] || null, do_resultado: planoMod.DO_RESULTADO.has(g.tipo) }));
}

function totaisDe(linhas) {
  const l = c.lista(linhas);
  const sem = l.filter(x => !x.classificacao?.conta_id);
  return {
    total: l.length, classificados: l.length - sem.length, sem: sem.length,
    sem_valor: c.centavos(sem.reduce((s, x) => s + Math.abs(Number(x.valor) || 0), 0)),
    manuais: l.filter(x => x.classificacao?.criterio === 'manual').length,
    automaticos: l.filter(x => x.classificacao?.conta_id && x.classificacao.criterio !== 'manual').length
  };
}

function naVisao(linha, visao) {
  if (visao === 'sem') return !linha.classificacao?.conta_id;
  if (visao === 'manuais') return linha.classificacao?.criterio === 'manual';
  if (visao === 'automaticos') return Boolean(linha.classificacao?.conta_id) && linha.classificacao.criterio !== 'manual';
  return true;
}

// ------------------------------------------------------------------ leitura

/** Tudo o que classificar um conjunto de lançamentos precisa (plano, regras, à mão, vínculos, liquidações). */
async function lerContexto(api, movimentos) {
  const [plano, regras, manuais, vinculos] = await Promise.all([
    planoMod.lerPlano(api), regrasMod.lerRegras(api), b.ler(api, 'classificacoes'),
    b.lerOpcional(api, 'conciliacao_vinculos').then(x => x || [])
  ]);
  const ids = new Set(c.lista(movimentos).map(m => String(m.id)));
  const ligados = vinculos.filter(v => !v.desfeito_em && ids.has(String(v.movimento_id)));
  const liqs = ligados.length ? await liquidacoes.carregar(api, { incluir: ligados.map(v => liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id)) }) : [];
  return {
    plano, regras, ctx: contexto({ plano, regras }),
    manualDe: new Map(manuais.filter(ativaC).map(x => [String(x.movimento_id), x])),
    vinculosDe: id => ligados.filter(v => String(v.movimento_id) === String(id)),
    liqsPorChave: new Map(liqs.map(l => [l.chave, l])),
    manuais
  };
}

function classificarTodos(movimentos, lido) {
  return c.lista(movimentos).map(m => ({
    movimento: m,
    classificacao: efetiva(m, { manual: lido.manualDe.get(String(m.id)) || null, vinculos: lido.vinculosDe(m.id), liqsPorChave: lido.liqsPorChave, ctx: lido.ctx })
  }));
}

async function competenciaFechada(api, competencia) {
  const linha = ((await b.lerOpcional(api, 'competencia_contabil', { competencia })) || [])[0] || null;
  return linha?.status === 'fechada';
}

/** O mês: cada lançamento com a conta que vale e como; o total por conta; os totais. */
async function painel(api, { competencia, contaId = null, hoje, visao = 'todos' }) {
  const comp = c.competenciaValida(competencia) ? String(competencia) : c.competenciaDe(hoje);
  await planoMod.lerPlano(api);
  const [{ contas }, movsDoMes, fechada] = await Promise.all([
    extrato.listarContas(api), b.ler(api, 'movimentos_bancarios', { competencia: comp }), competenciaFechada(api, comp)
  ]);
  const movs = movsDoMes.filter(m => !contaId || String(m.conta_id) === String(contaId))
    .sort((x, y) => String(c.dia(x.data)).localeCompare(String(c.dia(y.data))) || Number(x.id) - Number(y.id));
  const lido = await lerContexto(api, movs);
  const nomeDaConta = new Map(contas.map(x => [String(x.id), x.nome]));
  const linhas = classificarTodos(movs, lido).map(({ movimento: m, classificacao }) => ({
    ...extrato.movimentoPublico(m), conta_financeira: nomeDaConta.get(String(m.conta_id)) || null,
    estado_conciliacao: ['conciliado', 'ignorado'].includes(m.estado_conciliacao) ? m.estado_conciliacao : 'pendente',
    classificacao,
    // O texto que uma regra nova usaria (o botão "Regra" já preenche).
    chave_regra: regrasMod.chaveDaDescricao(m.descricao)
  }));
  const v = VISOES[visao] ? visao : 'todos';
  return {
    competencia: comp, rotulo: c.rotuloCompetencia(comp), conta_id: contaId ? Number(contaId) : null,
    contas_financeiras: contas.map(x => ({ id: x.id, nome: x.nome, ativa: x.ativa })),
    plano: planoMod.ordenar(lido.plano.filter(planoMod.ativa)).map(p => planoMod.contaPublica(p)),
    visao: v, visoes: VISOES, fechada,
    linhas: linhas.filter(l => naVisao(l, v)),
    totais: totaisDe(linhas),
    por_conta: porConta(linhas)
  };
}

/** A classificação que vale para os lançamentos de um mês (para o checklist); null sem o SQL. */
async function doMes(api, movimentos) {
  const plano = await b.lerOpcional(api, 'plano_contas');
  if (!plano) return null;
  const lido = await lerContexto(api, movimentos);
  return classificarTodos(movimentos, lido);
}

// ------------------------------------------------------------------ gravação

/** Classifica à mão um ou vários lançamentos numa conta (substitui a anterior de cada um). */
async function classificar(api, { ids = [], conta_id, observacao = '', usuarioId = null }) {
  const lista = [...new Set(c.lista(ids).map(String).filter(x => /^\d+$/.test(x)))];
  if (!lista.length) throw c.erro('Escolha os lançamentos a classificar.');
  if (lista.length > 500) throw c.erro('No máximo 500 lançamentos de uma vez.');
  if (!/^\d+$/.test(String(conta_id ?? ''))) throw c.erro('Escolha a conta do plano.');
  const conta = (await b.ler(api, 'plano_contas', { id: Number(conta_id) }))[0] || null;
  if (!conta) throw c.erro('Conta do plano não encontrada.', 404);
  if (!planoMod.ativa(conta)) throw c.erro(`A conta "${conta.nome}" está desativada.`, 409);
  const todos = await b.ler(api, 'movimentos_bancarios');
  const movs = lista.map(id => todos.find(m => String(m.id) === id) || null);
  if (movs.some(m => !m)) throw c.erro('Um dos lançamentos não existe mais: atualize a lista.', 404);
  for (const comp of [...new Set(movs.map(m => m.competencia))]) await b.garantirAberta(api, comp, 'classificar lançamentos nela');
  const manuais = (await b.ler(api, 'classificacoes')).filter(ativaC);
  const obs = String(observacao ?? '').trim().slice(0, 500) || null;
  let feitos = 0;
  for (const m of movs) {
    const anterior = manuais.find(x => String(x.movimento_id) === String(m.id));
    if (anterior && String(anterior.conta_id) === String(conta.id) && (anterior.observacao || null) === obs) continue;
    if (anterior) await b.atualizar(api, 'classificacoes', anterior.id, { substituida_em: c.agora(), substituida_por: usuarioId });
    await b.inserir(api, 'classificacoes', { movimento_id: Number(m.id), conta_id: Number(conta.id), observacao: obs, criado_por: usuarioId, criado_em: c.agora() });
    feitos++;
  }
  for (const comp of [...new Set(movs.map(m => m.competencia))]) {
    const doMesComp = movs.filter(m => m.competencia === comp);
    await eventos.registrar(api, {
      tipo: 'lancamento_classificado', competencia: comp, usuarioId,
      descricao: doMesComp.length === 1
        ? `Lançamento de ${c.impressa(c.dia(doMesComp[0].data))} (${c.reais(doMesComp[0].valor)}) classificado em "${conta.nome}"${obs ? `: ${obs}` : ''}`
        : `${c.plural(doMesComp.length, 'lançamento classificado', 'lançamentos classificados')} em "${conta.nome}"${obs ? `: ${obs}` : ''}`,
      dados: { conta_id: conta.id, movimentos: doMesComp.map(m => m.id) }
    });
  }
  return { classificados: feitos, conta: conta.nome };
}

/** Tira a classificação à mão: o lançamento volta ao que a conciliação e as regras dizem. */
async function voltarAoAutomatico(api, movimentoId, { usuarioId = null }) {
  const m = (await b.ler(api, 'movimentos_bancarios', { id: Number(movimentoId) }))[0] || null;
  if (!m) throw c.erro('Lançamento do extrato não encontrado.', 404);
  const manual = (await b.ler(api, 'classificacoes', { movimento_id: Number(m.id) })).find(ativaC) || null;
  if (!manual) throw c.erro('Este lançamento não foi classificado à mão.', 409);
  await b.garantirAberta(api, m.competencia, 'classificar lançamentos nela');
  await b.atualizar(api, 'classificacoes', manual.id, { substituida_em: c.agora(), substituida_por: usuarioId });
  await eventos.registrar(api, {
    tipo: 'classificacao_removida', competencia: m.competencia, usuarioId,
    descricao: `Lançamento de ${c.impressa(c.dia(m.data))} (${c.reais(m.valor)}) voltou à classificação automática`,
    dados: { movimento_id: m.id }
  });
  return { id: m.id, manual: false };
}

// ------------------------------------------------------------------ regras (lista e teste)

/** As regras, as sugeridas pelas classificações à mão e o que a tela precisa para o formulário. */
async function listarRegras(api) {
  const [plano, regras, manuais, movs] = await Promise.all([
    planoMod.lerPlano(api), regrasMod.lerRegras(api), b.ler(api, 'classificacoes'), b.ler(api, 'movimentos_bancarios')
  ]);
  const planoPorId = new Map(plano.map(p => [String(p.id), p]));
  const contatos = await regrasMod.lerContatosDasRegras(api, regras);
  const movPorId = new Map(movs.map(m => [String(m.id), m]));
  const manuaisComDescricao = manuais.filter(ativaC).map(x => ({ ...x, descricao: movPorId.get(String(x.movimento_id))?.descricao, valor: movPorId.get(String(x.movimento_id))?.valor }))
    .filter(x => x.descricao);
  const ordem = Object.keys(regrasMod.CONDICOES);
  return {
    regras: regras.sort((x, y) => Number(y.ativa !== false) - Number(x.ativa !== false) || ordem.indexOf(x.condicao_tipo) - ordem.indexOf(y.condicao_tipo)
      || (Number(y.prioridade) || 0) - (Number(x.prioridade) || 0) || String(x.valor).localeCompare(String(y.valor)))
      .map(r => regrasMod.regraPublica(r, { plano: planoPorId, contatos })),
    sugeridas: regrasMod.sugeridas(manuaisComDescricao, regras).map(s => ({ ...s, conta: planoPorId.get(String(s.conta_id))?.nome || null })),
    condicoes: regrasMod.CONDICOES, origens: regrasMod.ORIGENS, sentidos: regrasMod.SENTIDOS,
    plano: planoMod.ordenar(plano.filter(planoMod.ativa)).map(p => planoMod.contaPublica(p))
  };
}

/**
 * Testa uma regra (sem gravar) nos lançamentos do mês: quantos ela pega e
 * quantos mudariam de conta (os à mão não mudam — a mão vence a regra).
 */
async function testarRegra(api, { entrada = {}, competencia, hoje }) {
  const regra = { ...regrasMod.validarRegra(entrada), id: 0 };
  const comp = c.competenciaValida(competencia) ? String(competencia) : c.competenciaDe(hoje);
  const movs = await b.ler(api, 'movimentos_bancarios', { competencia: comp });
  const lido = await lerContexto(api, movs);
  const conta = lido.ctx.planoPorId.get(String(regra.conta_id)) || null;
  const pegos = [];
  for (const { movimento: m, classificacao } of classificarTodos(movs, lido)) {
    const sentido = sentidoDe(m.valor);
    let vale = false;
    if (['descricao', 'contrapartida'].includes(regra.condicao_tipo)) vale = regrasMod.casa(regra, { descricao: m.descricao, contrapartida: m.contrapartida_documento, sentido });
    else {
      const liqs = lido.vinculosDe(m.id).map(v => lido.liqsPorChave.get(liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id))).filter(Boolean);
      vale = liqs.some(l => regrasMod.casa(regra, {
        contato_id: l.contato_id, origem: l.tipo === 'financeiro_pagamento' ? l.subtipo : l.tipo, sentido
      }));
    }
    if (vale) pegos.push({ data: c.dia(m.data), descricao: m.descricao || null, valor: c.centavos(m.valor), agora: classificacao.conta, criterio: classificacao.criterio });
  }
  return {
    competencia: comp, rotulo: c.rotuloCompetencia(comp), conta: conta?.nome || null, quantidade: pegos.length,
    mudariam: pegos.filter(x => x.criterio !== 'manual' && x.agora !== conta?.nome).length,
    a_mao: pegos.filter(x => x.criterio === 'manual').length,
    exemplos: pegos.slice(0, 8)
  };
}

module.exports = {
  CRITERIOS, VISOES, contexto, contaDaLiquidacao, efetiva, porConta, totaisDe, naVisao,
  lerContexto, classificarTodos, painel, doMes, classificar, voltarAoAutomatico, listarRegras, testarRegra
};
