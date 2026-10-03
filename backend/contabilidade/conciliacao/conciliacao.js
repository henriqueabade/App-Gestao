/**
 * Conciliação do extrato (etapa 5): liga cada lançamento do banco ao que o
 * app registrou (recebimento, pagamento de conta, de comissão/produção,
 * reembolso) — ou o ignora com justificativa.
 *
 * - O lançamento continua o dado do banco: a conciliação só muda o estado
 *   (pendente → conciliado | ignorado) e guarda a justificativa.
 * - Um lançamento pode somar várias liquidações (o crédito de cobrança do BB
 *   junta os boletos do dia). A soma tem de bater; diferença (tarifa
 *   descontada, juros) só com justificativa, e fica gravada.
 * - Desfazer não apaga o vínculo: marca quem, quando e por quê.
 * - Competência fechada recusa qualquer mudança nela (reabra antes).
 * - O motor (motor.js) só propõe; automático é só com chave exata (ou o
 *   nome na descrição bem perto do dia — 16b do dono).
 * - Fase A (02/10/2026): o débito também casa com uma OBRIGAÇÃO — a parcela
 *   em aberto ou a nota registrada sem conta. Conciliar com ela paga a
 *   parcela (ou lança a conta da nota e a paga) com o dia e o valor do
 *   banco; desfazer estorna esse pagamento (e cancela a conta lançada).
 *   Depois de importar o extrato e de registrar notas, `automaticaDosMeses`
 *   roda sozinha.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const extrato = require('../extrato/extrato');
const titulos = require('../titulos');
const liquidacoes = require('./liquidacoes');
const motor = require('./motor');

const ESTADOS = { pendente: 'A conciliar', conciliado: 'Conciliado', ignorado: 'Ignorado' };
const CRITERIOS = {
  automatico: 'Automático', sugestao: 'Sugestão aceita', composicao: 'Soma aceita', manual: 'Escolhido à mão', conta_criada: 'Conta lançada do extrato',
  parcela_paga: 'Conta paga pelo extrato', documento_pago: 'Nota lançada e paga pelo extrato', dda_pago: 'Boleto do DDA lançado e pago pelo extrato',
  // Fase C: a linha do Rende Fácil/CDB conferida com o PDF mensal do BB (aplicacoes/aplicacoes.js).
  aplicacao: 'Conferido com o PDF da aplicação',
  // Fase F: pago em nome de outra empresa (a receber) ou a devolução dela (terceiros/terceiros.js).
  terceiro: 'De terceiro (a receber)',
  // Fase G: o pagamento da fatura do cartão, pela fatura importada (XLSX).
  cartao: 'Pela fatura do cartão importada'
};
/** O vínculo que nasceu pagando uma obrigação: desfazer estorna o pagamento (e cancela a conta da nota ou do boleto). */
const CRITERIOS_QUE_PAGAM = ['parcela_paga', 'documento_pago', 'dda_pago'];
const CRITERIO_DA_OBRIGACAO = { parcela: 'parcela_paga', documento: 'documento_pago', dda: 'dda_pago' };
const VISOES = { pendentes: 'A conciliar', sugestoes: 'Com sugestão', conciliados: 'Conciliados', ignorados: 'Ignorados', todos: 'Todos' };

const ativo = v => v && !v.desfeito_em;
const estadoDe = m => (ESTADOS[m?.estado_conciliacao] ? m.estado_conciliacao : 'pendente');
const abs = v => c.centavos(Math.abs(Number(v) || 0));
const dataDoMov = m => `${c.impressa(c.dia(m.data))} (${c.reais(m.valor)})`;

// ------------------------------------------------------------------ puras

/** O lançamento no formato do motor (o que falta ligar = o valor inteiro, se está a conciliar). */
function paraMotor(m) {
  return {
    id: m.id, data: c.dia(m.data), valor: c.centavos(m.valor), restante: abs(m.valor), descricao: m.descricao || '',
    documento: m.documento || null, contrapartida_documento: m.contrapartida_documento || null
  };
}

/** As liquidações com o que falta ligar de cada uma. Pura. */
function comRestante(liqs, vinculos) {
  const rest = liquidacoes.restantes(liqs, vinculos);
  return liqs.map(l => ({ ...l, restante: rest.get(l.chave) ?? l.valor_abs }));
}

function liqPublica(l) {
  if (!l) return null;
  return {
    chave: l.chave, tipo: l.tipo, tipo_rotulo: l.tipo_rotulo, id: l.id, data: l.data, data_credito: l.data_credito, valor: l.valor,
    restante: l.restante ?? l.valor_abs, forma: l.forma, rotulo: l.rotulo, detalhe: l.detalhe, nome: l.nome, estornado: l.estornado,
    obrigacao: Boolean(l.obrigacao)
  };
}

/**
 * Os vínculos valendo que não se sustentam mais: a liquidação foi estornada
 * (ou sumiu) ou ficou com valor menor que o ligado (recebimento editado). Pura.
 */
function vinculosInvalidos(vinculos, liqsPorChave) {
  const usado = new Map();
  for (const v of c.lista(vinculos).filter(ativo)) {
    const k = liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id);
    usado.set(k, c.centavos((usado.get(k) || 0) + Number(v.valor || 0)));
  }
  return c.lista(vinculos).filter(ativo).map(v => {
    const k = liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id);
    const liq = liqsPorChave.get(k) || null;
    if (!liq) return { vinculo: v, motivo: 'o registro não existe mais' };
    if (liq.estornado) return { vinculo: v, motivo: `${liq.tipo_rotulo.toLowerCase()} estornado`, liq };
    if (c.centavos(usado.get(k)) > c.centavos(liq.valor_abs) + 0.009) return { vinculo: v, motivo: `o valor mudou para ${c.reais(liq.valor_abs)}`, liq };
    return null;
  }).filter(Boolean);
}

/** O dia está no trecho do mês que o extrato importado cobre? Pura. */
function coberto(diaIso, cob, competencia) {
  if (!cob || !diaIso) return false;
  if (diaIso < `${competencia}-01` || diaIso > cob.exigido_ate) return false;
  return !cob.faltas.some(f => diaIso >= f.de && diaIso <= f.ate);
}

/**
 * O que foi registrado no app no mês, pelo banco, num trecho que o extrato
 * cobre, sem lançamento nenhum que possa ser o dele: não está ligado, nenhum
 * lançamento a conciliar tem o mesmo valor na janela e nenhuma sugestão
 * (soma) o usa. Faltou no extrato ou foi registrado com dia/valor errado. Pura.
 */
function semLancamento(liqs, { competencia, coberturas, movimentos = [], sugestoes = new Map() }) {
  const sugeridas = new Set([...sugestoes.values()].flatMap(s => s.itens || []).map(i => (typeof i === 'string' ? i : i?.chave)));
  return liqs
    .filter(l => !l.obrigacao && l.competencia === competencia && l.no_banco && !l.data_incerta && !l.estornado && c.centavos(l.restante) > 0.009)
    .filter(l => coberturas.some(cob => coberto(l.data, cob, competencia)))
    .filter(l => !sugeridas.has(l.chave) && !movimentos.some(m => motor.pontuar(m, l)?.exato))
    .map(liqPublica);
}

function totaisDe(linhas) {
  const conta = f => linhas.filter(f).length;
  const pendentes = linhas.filter(l => l.estado === 'pendente');
  return {
    total: linhas.length,
    a_conciliar: { quantidade: pendentes.length, total: c.centavos(pendentes.reduce((s, l) => s + Math.abs(l.valor), 0)) },
    com_sugestao: conta(l => l.estado === 'pendente' && l.sugestao),
    conciliados: conta(l => l.estado === 'conciliado'),
    ignorados: conta(l => l.estado === 'ignorado')
  };
}

function naVisao(linha, visao) {
  if (visao === 'pendentes') return linha.estado === 'pendente';
  if (visao === 'sugestoes') return linha.estado === 'pendente' && Boolean(linha.sugestao);
  if (visao === 'conciliados') return linha.estado === 'conciliado';
  if (visao === 'ignorados') return linha.estado === 'ignorado';
  return true;
}

// ------------------------------------------------------------------ leitura

/** Os vínculos (409 dizendo qual SQL falta, se a tabela não existe). */
const lerVinculos = api => b.ler(api, 'conciliacao_vinculos');

async function lerMovimento(api, id) {
  const m = (await b.ler(api, 'movimentos_bancarios', { id: Number(id) }))[0] || null;
  if (!m) throw c.erro('Lançamento do extrato não encontrado.', 404);
  return m;
}

/** A janela de liquidações para os lançamentos de um mês (o crédito pode vir dias depois; cartão, semanas). */
function janelaDoMes(competencia) {
  return { de: motor.somarDias(`${competencia}-01`, -40), ate: motor.somarDias(b.ultimoDia(competencia), 5) };
}

async function competenciaFechada(api, competencia) {
  const linha = ((await b.lerOpcional(api, 'competencia_contabil', { competencia })) || [])[0] || null;
  return linha?.status === 'fechada';
}

/**
 * O mês de uma conta na conciliação: os lançamentos com o estado, o que
 * cada um casa (vínculos) e a sugestão do motor para os que faltam, os
 * totais e o que foi registrado no app sem lançamento no extrato.
 */
async function painel(api, { contaId = null, competencia, hoje, visao = 'todos' }) {
  const comp = c.competenciaValida(competencia) ? String(competencia) : c.competenciaDe(hoje);
  const vinculos = await lerVinculos(api);
  const { contas } = await extrato.listarContas(api);
  const conta = contas.find(x => String(x.id) === String(contaId)) || contas.find(x => x.ativa && x.tipo === 'corrente') || contas[0] || null;
  const vazio = { competencia: comp, rotulo: c.rotuloCompetencia(comp), conta, contas, visao, visoes: VISOES, linhas: [], totais: totaisDe([]), sem_lancamento: [], fechada: false };
  if (!conta) return vazio;
  const [movs, importacoes, fechada] = await Promise.all([
    b.ler(api, 'movimentos_bancarios', { conta_id: Number(conta.id), competencia: comp }),
    b.ler(api, 'extrato_importacoes', { conta_id: Number(conta.id) }),
    competenciaFechada(api, comp)
  ]);
  const idsDoMes = new Set(movs.map(m => String(m.id)));
  const ligados = vinculos.filter(v => ativo(v) && idsDoMes.has(String(v.movimento_id)));
  const { de, ate } = janelaDoMes(comp);
  const liqs = comRestante(await liquidacoes.carregar(api, { de, ate, incluir: ligados.map(v => liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id)), obrigacoes: true }), vinculos);
  const porChave = new Map(liqs.map(l => [l.chave, l]));
  const pendentes = movs.filter(m => estadoDe(m) === 'pendente');
  const sugestoes = motor.sugerir(pendentes.map(paraMotor), liqs);
  const invalidos = new Map(vinculosInvalidos(ligados, porChave).map(x => [String(x.vinculo.id), x.motivo]));

  const linhas = movs
    .sort((x, y) => String(c.dia(x.data)).localeCompare(String(c.dia(y.data))) || Number(x.id) - Number(y.id))
    .map(m => {
      const estado = estadoDe(m);
      const sug = estado === 'pendente' ? sugestoes.get(m.id) || null : null;
      return {
        ...extrato.movimentoPublico(m), estado, estado_rotulo: ESTADOS[estado],
        diferenca: m.conciliacao_diferenca === null || m.conciliacao_diferenca === undefined ? null : c.centavos(m.conciliacao_diferenca),
        observacao: m.conciliacao_observacao || null, conciliado_em: b.instanteBR(m.conciliado_em),
        vinculos: ligados.filter(v => String(v.movimento_id) === String(m.id)).map(v => ({
          id: v.id, alvo_tipo: v.alvo_tipo, alvo_id: v.alvo_id, valor: c.centavos(v.valor), criterio: v.criterio, criterio_rotulo: CRITERIOS[v.criterio] || v.criterio,
          detalhe: v.detalhe || null, liquidacao: liqPublica(porChave.get(liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id))), invalido: invalidos.get(String(v.id)) || null
        })),
        sugestao: sug ? { ...sug, itens: sug.itens.map(k => liqPublica(porChave.get(k))).filter(Boolean) } : null
      };
    });
  const cob = extrato.cobertura(importacoes, comp, { hoje });
  const todas = linhas;
  const v = VISOES[visao] ? visao : 'todos';
  return {
    ...vazio, visao: v, fechada,
    linhas: todas.filter(l => naVisao(l, v)),
    totais: totaisDe(todas),
    sem_lancamento: semLancamento(liqs, { competencia: comp, coberturas: [cob], movimentos: pendentes.map(paraMotor), sugestoes }),
    cobertura: cob
  };
}

/** O lançamento e o que pode casar com ele (para a escolha à mão). */
async function candidatos(api, movimentoId, { dias = 10 } = {}) {
  const m = await lerMovimento(api, movimentoId);
  const vinculos = await lerVinculos(api);
  const janelaDias = Math.min(Math.max(Number(dias) || 10, 1), 90);
  const d = c.dia(m.data);
  const liqs = comRestante(await liquidacoes.carregar(api, { de: motor.somarDias(d, -janelaDias - 35), ate: motor.somarDias(d, janelaDias), obrigacoes: true }), vinculos);
  const mov = paraMotor(m);
  const lista = motor.candidatasDoMovimento(mov, liqs, { dias: janelaDias });
  const sug = estadoDe(m) === 'pendente' ? motor.sugerir([mov], liqs).get(m.id) || null : null;
  const porChave = new Map(liqs.map(l => [l.chave, l]));
  const ligados = vinculos.filter(v => ativo(v) && String(v.movimento_id) === String(m.id));
  const conta = (await b.ler(api, 'contas_financeiras', { id: Number(m.conta_id) }))[0] || null;
  return {
    movimento: {
      ...extrato.movimentoPublico(m), estado: estadoDe(m), estado_rotulo: ESTADOS[estadoDe(m)], competencia: m.competencia,
      observacao: m.conciliacao_observacao || null, conta: conta ? extrato.contaPublica(conta).nome : null
    },
    dias: janelaDias,
    candidatos: lista.map(x => ({ ...liqPublica(x.liq), pontos: x.p.pontos, motivos: x.p.motivos, exato: x.p.exato })),
    sugestao: sug ? { ...sug, itens: sug.itens.map(k => liqPublica(porChave.get(k))).filter(Boolean) } : null,
    vinculos: ligados.map(v => ({ id: v.id, valor: c.centavos(v.valor), criterio_rotulo: CRITERIOS[v.criterio] || v.criterio, liquidacao: liqPublica(porChave.get(liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id))) })),
    fechada: await competenciaFechada(api, m.competencia),
    formas: titulos.FORMAS
  };
}

// ------------------------------------------------------------------ gravação

/** Grava os vínculos e marca o lançamento conciliado (desfaz o que gravou se falhar no meio). */
async function gravar(api, m, itens, { criterio, detalhe = null, justificativa = null, diferenca = 0, usuarioId = null }) {
  const gravados = [];
  try {
    for (const l of itens) {
      gravados.push(await b.inserir(api, 'conciliacao_vinculos', {
        movimento_id: Number(m.id), alvo_tipo: l.tipo, alvo_id: Number(l.id), valor: c.centavos(l.restante),
        criterio, detalhe: detalhe ? String(detalhe).slice(0, 300) : null, criado_por: usuarioId, criado_em: c.agora()
      }));
    }
    await b.atualizar(api, 'movimentos_bancarios', m.id, {
      estado_conciliacao: 'conciliado', conciliacao_diferenca: diferenca ? c.centavos(diferenca) : null,
      conciliacao_observacao: justificativa || null, conciliado_em: c.agora(), conciliado_por: usuarioId
    });
  } catch (e) {
    for (const v of gravados) await api.delete(`/api/conciliacao_vinculos/${v.id}`).catch(() => null);
    if (c.ehDuplicado(e) && !e.extra?.sql_pendente) throw c.erro('Este lançamento acabou de ser conciliado por outra pessoa.', 409);
    throw e;
  }
  return gravados;
}

const rotulosDe = itens => itens.map(l => `${l.rotulo}${l.nome ? ` (${l.nome})` : ''}`).join(' + ');

/**
 * Paga a obrigação com o lançamento do banco (fase A): a parcela em aberto
 * recebe o pagamento com o dia e o valor do banco (a diferença vira
 * juros/desconto na conta); a nota sem conta ganha a conta — com o
 * fornecedor, a categoria da regra e o documento — já paga. A forma vem da
 * descrição do banco. Falhou no meio: cancela a conta que lançou.
 */
async function pagarObrigacao(api, m, liq, { usuarioId = null, hoje, observacao = null }) {
  const dia = c.dia(m.data);
  const valor = abs(m.valor);
  const nota = [observacao, `Pago pela conciliação com o extrato (${c.impressa(dia)}${m.descricao ? `, ${m.descricao}` : ''}).`].filter(Boolean).join(' ').slice(0, 500);
  let tituloId = liq.titulo_id ?? null;
  let parcelaId = liq.tipo === 'parcela' ? liq.id : null;
  let criouConta = false;
  if (liq.tipo === 'documento') {
    const doc = (await b.ler(api, 'documentos_recebidos', { id: Number(liq.documento_recebido_id) }))[0] || null;
    if (!doc || doc.excluido_em) throw c.erro('A nota não existe mais: atualize a lista.', 404);
    const criada = await titulos.criar(api, {
      entrada: {
        descricao: `${liq.rotulo} — ${liq.nome || 'fornecedor'}`, numero_documento: doc.numero || null,
        data_emissao: c.dia(doc.data_emissao), competencia: liq.competencia_documento, valor_total: liq.valor_abs,
        contato_id: doc.contato_id ?? null, documento_recebido_id: doc.id, quantidade_parcelas: 1, primeiro_vencimento: dia,
        observacao: `Lançada pela conciliação com o extrato de ${c.impressa(dia)}.`
      },
      usuarioId, hoje, origem: ['nfe', 'nfse'].includes(doc.tipo) ? doc.tipo : 'outro'
    });
    tituloId = criada.id;
    criouConta = true;
    parcelaId = (await b.ler(api, 'titulo_pagar_parcelas', { titulo_id: Number(criada.id) }))[0]?.id ?? null;
  }
  // Fase H: o boleto do DDA sem conta vira a conta do boleto (fornecedor pelo CNPJ, linha digitável, seu número) e fica ligado a ela.
  let boleto = null;
  if (liq.tipo === 'dda') {
    const dda = require('../dda/dda');
    boleto = dda.normalizar(await dda.lerBoleto(api, liq.dda_boleto_id));
    if (boleto.situacao !== 'novo') throw c.erro('O boleto do DDA já foi ligado a uma conta ou decidido: atualize a lista.', 409);
    const sugerida = dda.contaSugerida(boleto, { contatos: await titulos.lerContatos(api) });
    const criada = await titulos.criar(api, {
      entrada: {
        ...sugerida, competencia: m.competencia || c.competenciaDe(dia),
        observacao: `Lançada pela conciliação com o extrato de ${c.impressa(dia)} (boleto liquidado no DDA do BB).`
      },
      usuarioId, hoje, origem: 'dda'
    });
    tituloId = criada.id;
    criouConta = true;
    const p = (await b.ler(api, 'titulo_pagar_parcelas', { titulo_id: Number(criada.id) }))[0] || null;
    parcelaId = p?.id ?? null;
    try {
      const t = (await b.ler(api, 'titulos_pagar', { id: Number(criada.id) }))[0];
      await dda.ligar(api, boleto, { p, t }, { criterio: 'conciliacao', usuarioId });
    } catch (e) {
      await titulos.cancelar(api, tituloId, { motivo: 'Falhou ao ligar o boleto do DDA pela conciliação', usuarioId, avisar: false }).catch(() => null);
      throw e;
    }
  }
  try {
    const pago = await titulos.pagar(api, parcelaId, { entrada: { data_pagamento: dia, valor_pago: valor, forma: liq.tipo === 'dda' ? 'Boleto' : motor.formaDaDescricao(m.descricao), observacao: nota }, usuarioId, hoje });
    return { pagamento_id: pago.pagamento.id, titulo_id: tituloId, criou_conta: criouConta };
  } catch (e) {
    if (criouConta) await titulos.cancelar(api, tituloId, { motivo: 'Falhou ao pagar a nota pela conciliação', usuarioId, avisar: false }).catch(() => null);
    if (boleto) await soltarBoleto(api, boleto.id).catch(() => null);
    throw e;
  }
}

/** O boleto do DDA volta a ficar sem conta (a conta lançada pela conciliação foi desfeita). */
async function soltarBoleto(api, boletoId) {
  await b.atualizar(api, 'contabil_dda_boletos', boletoId, {
    situacao: 'novo', titulo_id: null, parcela_id: null, vinculo_criterio: null, vinculado_em: null, vinculado_por: null, atualizado_em: c.agora()
  });
}

/** Desfaz o que `pagarObrigacao` gravou (estorna; cancela a conta lançada). Não lança erro: devolve o aviso. */
async function desfazerPagamento(api, { pagamentoId, tituloId = null, criouConta = false, motivo, usuarioId = null }) {
  try {
    await titulos.estornar(api, pagamentoId, { motivo, usuarioId });
    if (criouConta && tituloId) await titulos.cancelar(api, tituloId, { motivo, usuarioId, avisar: false });
    return null;
  } catch (e) {
    return `${criouConta ? 'A conta lançada pela conciliação' : 'O pagamento registrado pela conciliação'} não pôde ser desfeito (${e.message}): resolva em Contas a pagar.`;
  }
}

/**
 * Concilia o lançamento com UMA obrigação (sem `hoje`, vale o dia do banco):
 * paga, liga e registra. A diferença de valor, com justificativa, vira
 * juros/desconto no pagamento.
 */
async function conciliarObrigacao(api, m, liq, { justificativa = null, criterio, usuarioId = null, hoje = null }) {
  const pago = await pagarObrigacao(api, m, liq, { usuarioId, hoje: hoje || c.dia(m.data), observacao: justificativa });
  const crit = CRITERIO_DA_OBRIGACAO[liq.tipo] || 'documento_pago';
  const item = { tipo: 'titulo_pagamento', id: pago.pagamento_id, restante: abs(m.valor) };
  try {
    await gravar(api, m, [item], { criterio: crit, detalhe: `${CRITERIOS[criterio] || CRITERIOS.manual} · ${liq.rotulo}`, justificativa, usuarioId });
  } catch (e) {
    await desfazerPagamento(api, { pagamentoId: pago.pagamento_id, tituloId: pago.titulo_id, criouConta: pago.criou_conta, motivo: 'Falhou ao conciliar com o extrato', usuarioId });
    if (liq.tipo === 'dda') await soltarBoleto(api, liq.dda_boleto_id).catch(() => null);
    throw e;
  }
  await eventos.registrar(api, {
    tipo: 'conciliacao_feita', competencia: m.competencia, usuarioId, referenciaTipo: 'titulo', referenciaId: pago.titulo_id,
    descricao: `Lançamento de ${dataDoMov(m)} ${liq.tipo === 'parcela' ? 'pagou' : 'virou a conta paga de'} ${rotulosDe([liq])}`
      + ` (${(CRITERIOS[criterio] || CRITERIOS.manual).toLowerCase()})${justificativa ? ` — ${justificativa}` : ''}`,
    dados: { movimento_id: m.id, criterio: crit, itens: [liq.chave], titulo_id: pago.titulo_id, pagamento_id: pago.pagamento_id, conta_criada: pago.criou_conta }
  });
  return { id: m.id, estado: 'conciliado', vinculos: 1, diferenca: 0, titulo_id: pago.titulo_id, pagamento_id: pago.pagamento_id, conta_criada: pago.criou_conta };
}

/**
 * Concilia o lançamento com as liquidações escolhidas. A soma tem de dar o
 * valor do lançamento; senão, só com justificativa (e a diferença fica gravada).
 * Uma obrigação (parcela em aberto, nota sem conta) vai sozinha e é paga.
 */
async function conciliar(api, movimentoId, { itens = [], justificativa = '', criterio = 'manual', usuarioId = null, hoje = null }) {
  const pedidos = [...new Map(c.lista(itens).map(i => [liquidacoes.chaveDe(i?.tipo, i?.id), i])).values()]
    .filter(i => liquidacoes.TIPOS[i?.tipo] && /^\d+$/.test(String(i?.id)));
  if (!pedidos.length) throw c.erro('Escolha o que casa com este lançamento.');
  const m = await lerMovimento(api, movimentoId);
  const estado = estadoDe(m);
  if (estado === 'conciliado') throw c.erro('Este lançamento já está conciliado: desfaça antes de conciliar de novo.', 409);
  if (estado === 'ignorado') throw c.erro('Este lançamento está ignorado: reative-o antes de conciliar.', 409);
  await b.garantirAberta(api, m.competencia, 'conciliar lançamentos nela');
  const vinculos = await lerVinculos(api);
  const chaves = pedidos.map(i => liquidacoes.chaveDe(i.tipo, i.id));
  const liqs = comRestante(await liquidacoes.carregar(api, { incluir: chaves }), vinculos);
  const porChave = new Map(liqs.map(l => [l.chave, l]));
  const escolhidas = chaves.map(k => porChave.get(k) || null);
  if (escolhidas.some(l => !l)) throw c.erro('Um dos registros escolhidos não existe mais: atualize a lista.', 404);
  for (const l of escolhidas) {
    if (l.estornado) throw c.erro(`${l.rotulo}: foi estornado e não pode ser conciliado.`, 409);
    if (Math.sign(l.valor) !== Math.sign(Number(m.valor))) throw c.erro(`${l.rotulo} é ${l.valor > 0 ? 'uma entrada' : 'uma saída'} e o lançamento é ${Number(m.valor) > 0 ? 'um crédito' : 'um débito'}.`, 422);
    if (!(l.restante > 0.009)) throw c.erro(`${l.rotulo} já está conciliado com outro lançamento.`, 409);
  }
  if (escolhidas.some(l => l.obrigacao) && escolhidas.length > 1) {
    throw c.erro('A conta em aberto (ou a nota sem conta) é paga sozinha com o lançamento: escolha só ela.', 422);
  }
  const soma = c.centavos(escolhidas.reduce((s, l) => s + l.restante, 0));
  const diferenca = c.centavos(abs(m.valor) - soma);
  const texto = c.texto(justificativa, 500);
  if (Math.abs(diferenca) > 0.009 && texto.length < 5) {
    throw c.erro(`A soma escolhida (${c.reais(soma)}) não bate com o lançamento (${c.reais(abs(m.valor))}): diferença de ${c.reais(diferenca)}. Justifique para conciliar assim (tarifa descontada, juros…).`, 422, { diferenca, soma });
  }
  const crit = CRITERIOS[criterio] && !['conta_criada', ...CRITERIOS_QUE_PAGAM].includes(criterio) ? criterio : 'manual';
  if (escolhidas[0].obrigacao) {
    return conciliarObrigacao(api, m, escolhidas[0], { justificativa: Math.abs(diferenca) > 0.009 ? texto : (texto || null), criterio: crit, usuarioId, hoje });
  }
  await gravar(api, m, escolhidas, { criterio: crit, justificativa: Math.abs(diferenca) > 0.009 ? texto : (texto || null), diferenca, usuarioId });
  await eventos.registrar(api, {
    tipo: 'conciliacao_feita', competencia: m.competencia, usuarioId,
    descricao: `Lançamento de ${dataDoMov(m)} conciliado com ${rotulosDe(escolhidas)}${Math.abs(diferenca) > 0.009 ? ` — diferença de ${c.reais(diferenca)}: ${texto}` : ''}`,
    dados: { movimento_id: m.id, criterio: crit, itens: chaves, diferenca }
  });
  return { id: m.id, estado: 'conciliado', vinculos: escolhidas.length, diferenca };
}

async function desfazer(api, movimentoId, { motivo, usuarioId = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que a conciliação é desfeita (ao menos 5 letras).');
  const m = await lerMovimento(api, movimentoId);
  if (estadoDe(m) !== 'conciliado') throw c.erro('Este lançamento não está conciliado.', 409);
  await b.garantirAberta(api, m.competencia, 'mudar a conciliação nela');
  const ligados = (await lerVinculos(api)).filter(v => ativo(v) && String(v.movimento_id) === String(m.id));
  for (const v of ligados) await b.atualizar(api, 'conciliacao_vinculos', v.id, { desfeito_em: c.agora(), desfeito_por: usuarioId, motivo_desfazer: texto });
  await b.atualizar(api, 'movimentos_bancarios', m.id, {
    estado_conciliacao: 'pendente', conciliacao_diferenca: null, conciliacao_observacao: null, conciliado_em: null, conciliado_por: null
  });
  const criouConta = ligados.some(v => v.criterio === 'conta_criada');
  // Fase A: o pagamento que a própria conciliação registrou é estornado (e a conta da nota, cancelada).
  const avisos = [];
  const estornados = [];
  for (const v of ligados.filter(x => CRITERIOS_QUE_PAGAM.includes(x.criterio) && x.alvo_tipo === 'titulo_pagamento')) {
    const p = (await b.ler(api, 'titulo_pagar_pagamentos', { id: Number(v.alvo_id) }))[0] || null;
    if (!p || p.estornado_em) continue;
    const aviso = await desfazerPagamento(api, {
      pagamentoId: p.id, tituloId: p.titulo_id, criouConta: ['documento_pago', 'dda_pago'].includes(v.criterio), motivo: `Conciliação desfeita: ${texto}`, usuarioId
    });
    if (aviso) { avisos.push(aviso); continue; }
    estornados.push(v.criterio);
    // Fase H: a conta do boleto foi cancelada — o boleto do DDA volta a ficar sem conta.
    if (v.criterio === 'dda_pago') {
      const boletos = (await b.lerOpcional(api, 'contabil_dda_boletos', { titulo_id: Number(p.titulo_id) }).catch(() => null)) || [];
      for (const bol of boletos) await soltarBoleto(api, bol.id).catch(() => null);
    }
  }
  const partes = [
    estornados.includes('parcela_paga') ? 'o pagamento da conta foi estornado (ela volta a ficar em aberto)' : null,
    estornados.includes('documento_pago') ? 'a conta lançada da nota foi cancelada (a nota volta a ficar sem conta)' : null,
    estornados.includes('dda_pago') ? 'a conta lançada do boleto foi cancelada (o boleto do DDA volta a ficar sem conta)' : null,
    criouConta ? 'a conta lançada do extrato continua; estorne-a em Contas a pagar se foi engano' : null
  ].filter(Boolean);
  await eventos.registrar(api, {
    tipo: 'conciliacao_desfeita', competencia: m.competencia, usuarioId,
    descricao: `Conciliação do lançamento de ${dataDoMov(m)} desfeita (${c.plural(ligados.length, 'vínculo', 'vínculos')}): ${texto}${partes.length ? ` — ${partes.join('; ')}` : ''}`,
    dados: { movimento_id: m.id, vinculos: ligados.map(v => v.id), estornados }
  });
  return { id: m.id, estado: 'pendente', desfeitos: ligados.length, conta_criada_continua: criouConta, estornados: estornados.length, avisos };
}

async function ignorar(api, movimentoId, { motivo, usuarioId = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que o lançamento fica sem par (ao menos 5 letras): tarifa, aplicação, aporte…');
  const m = await lerMovimento(api, movimentoId);
  if (estadoDe(m) !== 'pendente') throw c.erro(estadoDe(m) === 'ignorado' ? 'Este lançamento já está ignorado.' : 'Este lançamento está conciliado: desfaça antes.', 409);
  await b.garantirAberta(api, m.competencia, 'mudar a conciliação nela');
  await lerVinculos(api);
  await b.atualizar(api, 'movimentos_bancarios', m.id, {
    estado_conciliacao: 'ignorado', conciliacao_observacao: texto, conciliado_em: c.agora(), conciliado_por: usuarioId
  });
  await eventos.registrar(api, {
    tipo: 'lancamento_ignorado', competencia: m.competencia, usuarioId,
    descricao: `Lançamento de ${dataDoMov(m)}${m.descricao ? ` — ${m.descricao}` : ''} ficou sem par: ${texto}`,
    dados: { movimento_id: m.id }
  });
  return { id: m.id, estado: 'ignorado' };
}

async function reativar(api, movimentoId, { usuarioId = null }) {
  const m = await lerMovimento(api, movimentoId);
  if (estadoDe(m) !== 'ignorado') throw c.erro('Este lançamento não está ignorado.', 409);
  await b.garantirAberta(api, m.competencia, 'mudar a conciliação nela');
  await lerVinculos(api);
  await b.atualizar(api, 'movimentos_bancarios', m.id, { estado_conciliacao: 'pendente', conciliacao_observacao: null, conciliado_em: null, conciliado_por: null });
  await eventos.registrar(api, {
    tipo: 'lancamento_reativado', competencia: m.competencia, usuarioId,
    descricao: `Lançamento de ${dataDoMov(m)} voltou a ficar a conciliar (antes ignorado: ${m.conciliacao_observacao || 'sem justificativa'})`,
    dados: { movimento_id: m.id }
  });
  return { id: m.id, estado: 'pendente' };
}

/**
 * Concilia em lote o mês de uma conta: o que o motor decide como automático
 * e, com `aceitarSugestoes`, as sugestões únicas (um par só dos dois lados).
 * Composição (soma de várias) nunca entra em lote; obrigação (paga ou lança
 * a conta) só quando é automático. O lançamento que falhar fica a conciliar
 * e vai em `falhas`.
 */
async function automatica(api, { contaId, competencia, aceitarSugestoes = false, usuarioId = null, hoje, sozinha = false }) {
  if (!c.competenciaValida(competencia)) throw c.erro('Escolha a competência.');
  await b.garantirAberta(api, competencia, 'conciliar lançamentos nela');
  const vinculos = await lerVinculos(api);
  const conta = (await b.ler(api, 'contas_financeiras', { id: Number(contaId) }))[0] || null;
  if (!conta) throw c.erro('Escolha a conta.', 404);
  const movs = (await b.ler(api, 'movimentos_bancarios', { conta_id: Number(conta.id), competencia: String(competencia) })).filter(m => estadoDe(m) === 'pendente');
  const { de, ate } = janelaDoMes(competencia);
  const liqs = comRestante(await liquidacoes.carregar(api, { de, ate, obrigacoes: true }), vinculos);
  const porChave = new Map(liqs.map(l => [l.chave, l]));
  const decisoes = motor.sugerir(movs.map(paraMotor), liqs);
  const usados = new Set();
  const feitos = { automatico: 0, sugestao: 0, contas_pagas: 0, contas_lancadas: 0, boletos_lancados: 0 };
  const falhas = [];
  for (const m of movs) {
    const d = decisoes.get(m.id);
    if (!d || d.tipo === 'composicao') continue;
    if (d.tipo !== 'automatico' && !(aceitarSugestoes && d.unica)) continue;
    const itens = d.itens.map(k => porChave.get(k)).filter(Boolean);
    if (!itens.length || itens.some(l => usados.has(l.chave))) continue;
    if (itens[0].obrigacao && d.tipo !== 'automatico') continue;
    try {
      if (itens[0].obrigacao) {
        const r = await conciliarObrigacao(api, m, itens[0], { criterio: 'automatico', usuarioId, hoje });
        feitos[!r.conta_criada ? 'contas_pagas' : (itens[0].tipo === 'dda' ? 'boletos_lancados' : 'contas_lancadas')] += 1;
      } else {
        await gravar(api, m, itens, { criterio: d.tipo, detalhe: d.motivos.join('; '), usuarioId });
      }
    } catch (e) {
      falhas.push(`${dataDoMov(m)}: ${e.message}`);
      continue;
    }
    itens.forEach(l => usados.add(l.chave));
    feitos[d.tipo === 'automatico' ? 'automatico' : 'sugestao'] += 1;
  }
  const total = feitos.automatico + feitos.sugestao;
  if (total) {
    const obrig = frasesDasObrigacoes(feitos);
    await eventos.registrar(api, {
      tipo: 'conciliacao_automatica', competencia, usuarioId,
      descricao: `${conta.nome}, ${c.rotuloCompetencia(competencia)}: ${c.plural(total, 'lançamento conciliado', 'lançamentos conciliados')} ${sozinha ? 'sozinho' + (total > 1 ? 's' : '') : 'em lote'}`
        + ` (${c.plural(feitos.automatico, 'automático', 'automáticos')}${aceitarSugestoes ? `, ${c.plural(feitos.sugestao, 'sugestão aceita', 'sugestões aceitas')}` : ''}${obrig ? `; ${obrig}` : ''})`,
      dados: { conta_id: conta.id, ...feitos }
    });
  }
  return { ...feitos, total, restantes: movs.length - total, falhas };
}

/**
 * A conciliação que roda sozinha (fase A): depois de importar o extrato (OFX
 * ou API) e de registrar notas (SEFAZ/ADN/à mão). Cada conta ativa (ou só a
 * `contaId`) × cada mês ABERTO com lançamento a conciliar; só o automático,
 * nunca sugestão. Nada aqui derruba quem chamou: sem o SQL, não faz nada;
 * erro vira `falhas`.
 */
async function automaticaDosMeses(api, { competencias = [], contaId = null, usuarioId = null, hoje }) {
  const total = { conciliados: 0, contas_pagas: 0, contas_lancadas: 0, boletos_lancados: 0, falhas: [] };
  const meses = [...new Set(c.lista(competencias).filter(x => c.competenciaValida(x)).map(String))].sort();
  if (!meses.length) return total;
  // Fase D: o extrato que acabou de chegar pode ser o par dos comprovantes do
  // BB anexados antes — eles se ligam primeiro (a ligação completa o CPF/CNPJ
  // do lançamento, o que ajuda a conciliação logo abaixo).
  try {
    const cps = await require('../comprovantes/comprovantes').ligarSozinhos(api, { usuarioId });
    if (cps.ligados) total.comprovantes_ligados = cps.ligados;
    total.falhas.push(...cps.falhas);
  } catch (e) {
    if (!e?.extra?.sql_pendente) total.falhas.push(e.message);
  }
  // Fase C: as linhas do Rende Fácil e do CDB conferidas com os PDFs mensais já importados.
  try {
    const apl = await require('../aplicacoes/aplicacoes').conciliarSozinho(api, { competencias: meses, usuarioId });
    if (apl.ligados) total.aplicacoes_ligadas = apl.ligados;
    total.falhas.push(...apl.falhas);
  } catch (e) {
    if (!e?.extra?.sql_pendente) total.falhas.push(e.message);
  }
  // Fase G (antes do automático: a nota da compra no cartão não pode virar obrigação paga por outro débito):
  // as notas que chegaram casam com as compras e o pagamento da fatura liga ao débito.
  try {
    const cartao = await require('../cartao/cartao').conferir(api, { competencias: meses, usuarioId });
    if (cartao.pagamentos) total.faturas_ligadas = cartao.pagamentos;
    if (cartao.ligadas) total.notas_do_cartao = cartao.ligadas;
    total.falhas.push(...cartao.falhas);
  } catch (e) {
    if (!e?.extra?.sql_pendente) total.falhas.push(e.message);
  }
  try {
    await lerVinculos(api);
    const { contas } = await extrato.listarContas(api);
    const alvo = contas.filter(x => (contaId !== null && contaId !== undefined ? String(x.id) === String(contaId) : x.ativa !== false && x.ativa !== 'false'));
    for (const comp of meses) {
      if (await competenciaFechada(api, comp)) continue;
      for (const conta of alvo) {
        const pendentes = (await b.ler(api, 'movimentos_bancarios', { conta_id: Number(conta.id), competencia: comp })).filter(m => estadoDe(m) === 'pendente');
        if (!pendentes.length) continue;
        const r = await automatica(api, { contaId: conta.id, competencia: comp, usuarioId, hoje, sozinha: true });
        total.conciliados += r.total;
        total.contas_pagas += r.contas_pagas;
        total.contas_lancadas += r.contas_lancadas;
        total.boletos_lancados += r.boletos_lancados || 0;
        total.falhas.push(...r.falhas);
      }
    }
  } catch (e) {
    if (!e?.extra?.sql_pendente) total.falhas.push(e.message);
  }
  // Fase F (depois do automático: a conta da própria empresa que casa exatamente vem primeiro): o que foi
  // pago em nome de outra empresa (pelo comprovante do BB) e o que ela devolveu.
  try {
    const t = await require('../terceiros/terceiros').conferir(api, { competencias: meses, usuarioId });
    if (t.ligados + t.recebidos) total.terceiros_ligados = t.ligados + t.recebidos;
    total.falhas.push(...t.falhas);
  } catch (e) {
    if (!e?.extra?.sql_pendente) total.falhas.push(e.message);
  }
  return total;
}

/** "1 conta paga, 1 nota lançada e paga, 1 boleto do DDA lançado e pago" (o que as obrigações viraram). Pura. */
function frasesDasObrigacoes(r) {
  return [
    r.contas_pagas ? c.plural(r.contas_pagas, 'conta paga', 'contas pagas') : null,
    r.contas_lancadas ? c.plural(r.contas_lancadas, 'nota lançada e paga', 'notas lançadas e pagas') : null,
    r.boletos_lancados ? c.plural(r.boletos_lancados, 'boleto do DDA lançado e pago', 'boletos do DDA lançados e pagos') : null
  ].filter(Boolean).join(', ');
}

/** A frase para o resumo de quem chamou ("3 conciliados sozinhos (1 conta paga)"), ou null. Pura. */
function resumoDaAutomatica(r) {
  const comprovantes = r?.comprovantes_ligados ? c.plural(r.comprovantes_ligados, 'comprovante do BB ligado ao extrato', 'comprovantes do BB ligados ao extrato') : null;
  const aplicacoes = r?.aplicacoes_ligadas ? c.plural(r.aplicacoes_ligadas, 'linha de aplicação conferida com o PDF', 'linhas de aplicação conferidas com o PDF') : null;
  const terceiros = r?.terceiros_ligados ? c.plural(r.terceiros_ligados, 'lançamento de terceiro (a receber) ligado', 'lançamentos de terceiros (a receber) ligados') : null;
  const cartao = [
    r?.faturas_ligadas ? c.plural(r.faturas_ligadas, 'pagamento de fatura do cartão conciliado', 'pagamentos de fatura do cartão conciliados') : null,
    r?.notas_do_cartao ? c.plural(r.notas_do_cartao, 'nota ligada a compra do cartão', 'notas ligadas a compras do cartão') : null
  ].filter(Boolean).join(' · ') || null;
  if (!r?.conciliados) return [comprovantes, aplicacoes, cartao, terceiros].filter(Boolean).join(' · ') || null;
  const extra = frasesDasObrigacoes(r);
  return [comprovantes, aplicacoes, cartao, terceiros, `${c.plural(r.conciliados, 'lançamento conciliado sozinho', 'lançamentos conciliados sozinhos')}${extra ? ` (${extra})` : ''}`].filter(Boolean).join(' · ');
}

/** Os meses que um conjunto de datas toca, com o seguinte (a nota de um mês é paga no outro). Pura. */
function mesesParaConciliar(datas, { comSeguinte = false } = {}) {
  const meses = new Set();
  for (const d of c.lista(datas)) {
    const mes = String(c.dia(d) || '').slice(0, 7);
    if (!c.competenciaValida(mes)) continue;
    meses.add(mes);
    if (comSeguinte) meses.add(c.somarMeses(mes, 1));
  }
  return [...meses].sort();
}

/**
 * Débito sem conta no app (tarifa, imposto em débito automático…): lança a
 * conta já paga, com o dia e o valor do banco, e concilia com ela.
 */
async function criarConta(api, movimentoId, { entrada = {}, usuarioId = null, hoje }) {
  const m = await lerMovimento(api, movimentoId);
  if (Number(m.valor) >= 0) throw c.erro('Só débito vira conta a pagar.', 422);
  if (estadoDe(m) !== 'pendente') throw c.erro('Este lançamento não está a conciliar.', 409);
  await b.garantirAberta(api, m.competencia, 'conciliar lançamentos nela');
  await lerVinculos(api);
  const valor = abs(m.valor);
  const dia = c.dia(m.data);
  const forma = titulos.FORMAS.includes(entrada.forma) ? entrada.forma : 'Débito automático';
  const criada = await titulos.criar(api, {
    entrada: {
      descricao: entrada.descricao || m.descricao, categoria: entrada.categoria || null, contato_id: entrada.contato_id ?? null,
      valor_total: valor, data_emissao: dia, competencia: m.competencia, quantidade_parcelas: 1, primeiro_vencimento: dia,
      observacao: [entrada.observacao, `Lançada a partir do extrato (${c.impressa(dia)}, ${m.descricao || 'sem descrição'}).`].filter(Boolean).join(' ')
    },
    usuarioId, hoje
  });
  // Falhou no meio: desfaz o que já foi gravado (estorna o pagamento, cancela a conta).
  const MOTIVO = 'Falhou ao lançar a conta a partir do extrato';
  let pago = null;
  try {
    const parcela = (await b.ler(api, 'titulo_pagar_parcelas', { titulo_id: Number(criada.id) }))[0];
    pago = await titulos.pagar(api, parcela.id, { entrada: { data_pagamento: dia, valor_pago: valor, forma }, usuarioId, hoje });
  } catch (e) {
    await titulos.cancelar(api, criada.id, { motivo: MOTIVO, usuarioId }).catch(() => null);
    throw e;
  }
  const liq = { tipo: 'titulo_pagamento', id: pago.pagamento.id, restante: valor, rotulo: entrada.descricao || m.descricao };
  try {
    await gravar(api, m, [liq], { criterio: 'conta_criada', detalhe: 'conta lançada a partir do lançamento', usuarioId });
  } catch (e) {
    await titulos.estornar(api, pago.pagamento.id, { motivo: MOTIVO, usuarioId }).catch(() => null);
    await titulos.cancelar(api, criada.id, { motivo: MOTIVO, usuarioId }).catch(() => null);
    throw e;
  }
  await eventos.registrar(api, {
    tipo: 'conciliacao_feita', competencia: m.competencia, usuarioId, referenciaTipo: 'titulo', referenciaId: criada.id,
    descricao: `Lançamento de ${dataDoMov(m)} virou a conta "${liq.rotulo}", paga e conciliada`,
    dados: { movimento_id: m.id, titulo_id: criada.id, pagamento_id: pago.pagamento.id }
  });
  return { id: m.id, estado: 'conciliado', titulo_id: criada.id, pagamento_id: pago.pagamento.id };
}

module.exports = {
  ESTADOS, CRITERIOS, CRITERIOS_QUE_PAGAM, CRITERIO_DA_OBRIGACAO, VISOES,
  paraMotor, comRestante, liqPublica, vinculosInvalidos, coberto, semLancamento, totaisDe, naVisao, janelaDoMes, resumoDaAutomatica, mesesParaConciliar,
  lerVinculos, painel, candidatos, gravar, conciliar, desfazer, ignorar, reativar, automatica, automaticaDosMeses, criarConta
};
