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
 * - O motor (motor.js) só propõe; automático é só com chave exata.
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
  automatico: 'Automático', sugestao: 'Sugestão aceita', composicao: 'Soma aceita', manual: 'Escolhido à mão', conta_criada: 'Conta lançada do extrato'
};
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
    restante: l.restante ?? l.valor_abs, forma: l.forma, rotulo: l.rotulo, detalhe: l.detalhe, nome: l.nome, estornado: l.estornado
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
    .filter(l => l.competencia === competencia && l.no_banco && !l.data_incerta && !l.estornado && c.centavos(l.restante) > 0.009)
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
  const liqs = comRestante(await liquidacoes.carregar(api, { de, ate, incluir: ligados.map(v => liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id)) }), vinculos);
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
  const liqs = comRestante(await liquidacoes.carregar(api, { de: motor.somarDias(d, -janelaDias - 35), ate: motor.somarDias(d, janelaDias) }), vinculos);
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
 * Concilia o lançamento com as liquidações escolhidas. A soma tem de dar o
 * valor do lançamento; senão, só com justificativa (e a diferença fica gravada).
 */
async function conciliar(api, movimentoId, { itens = [], justificativa = '', criterio = 'manual', usuarioId = null }) {
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
  const soma = c.centavos(escolhidas.reduce((s, l) => s + l.restante, 0));
  const diferenca = c.centavos(abs(m.valor) - soma);
  const texto = c.texto(justificativa, 500);
  if (Math.abs(diferenca) > 0.009 && texto.length < 5) {
    throw c.erro(`A soma escolhida (${c.reais(soma)}) não bate com o lançamento (${c.reais(abs(m.valor))}): diferença de ${c.reais(diferenca)}. Justifique para conciliar assim (tarifa descontada, juros…).`, 422, { diferenca, soma });
  }
  const crit = CRITERIOS[criterio] && criterio !== 'conta_criada' ? criterio : 'manual';
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
  await eventos.registrar(api, {
    tipo: 'conciliacao_desfeita', competencia: m.competencia, usuarioId,
    descricao: `Conciliação do lançamento de ${dataDoMov(m)} desfeita (${c.plural(ligados.length, 'vínculo', 'vínculos')}): ${texto}${criouConta ? ' — a conta lançada do extrato continua; estorne-a em Contas a pagar se foi engano' : ''}`,
    dados: { movimento_id: m.id, vinculos: ligados.map(v => v.id) }
  });
  return { id: m.id, estado: 'pendente', desfeitos: ligados.length, conta_criada_continua: criouConta };
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
 * Composição (soma de várias) nunca entra em lote.
 */
async function automatica(api, { contaId, competencia, aceitarSugestoes = false, usuarioId = null, hoje }) {
  if (!c.competenciaValida(competencia)) throw c.erro('Escolha a competência.');
  await b.garantirAberta(api, competencia, 'conciliar lançamentos nela');
  const vinculos = await lerVinculos(api);
  const conta = (await b.ler(api, 'contas_financeiras', { id: Number(contaId) }))[0] || null;
  if (!conta) throw c.erro('Escolha a conta.', 404);
  const movs = (await b.ler(api, 'movimentos_bancarios', { conta_id: Number(conta.id), competencia: String(competencia) })).filter(m => estadoDe(m) === 'pendente');
  const { de, ate } = janelaDoMes(competencia);
  const liqs = comRestante(await liquidacoes.carregar(api, { de, ate }), vinculos);
  const porChave = new Map(liqs.map(l => [l.chave, l]));
  const decisoes = motor.sugerir(movs.map(paraMotor), liqs);
  const usados = new Set();
  const feitos = { automatico: 0, sugestao: 0 };
  for (const m of movs) {
    const d = decisoes.get(m.id);
    if (!d || d.tipo === 'composicao') continue;
    if (d.tipo !== 'automatico' && !(aceitarSugestoes && d.unica)) continue;
    const itens = d.itens.map(k => porChave.get(k)).filter(Boolean);
    if (!itens.length || itens.some(l => usados.has(l.chave))) continue;
    await gravar(api, m, itens, { criterio: d.tipo, detalhe: d.motivos.join('; '), usuarioId });
    itens.forEach(l => usados.add(l.chave));
    feitos[d.tipo === 'automatico' ? 'automatico' : 'sugestao'] += 1;
  }
  const total = feitos.automatico + feitos.sugestao;
  if (total) {
    await eventos.registrar(api, {
      tipo: 'conciliacao_automatica', competencia, usuarioId,
      descricao: `${conta.nome}, ${c.rotuloCompetencia(competencia)}: ${c.plural(total, 'lançamento conciliado', 'lançamentos conciliados')} em lote`
        + ` (${c.plural(feitos.automatico, 'automático', 'automáticos')}${aceitarSugestoes ? `, ${c.plural(feitos.sugestao, 'sugestão aceita', 'sugestões aceitas')}` : ''})`,
      dados: { conta_id: conta.id, ...feitos }
    });
  }
  return { ...feitos, total, restantes: movs.length - total };
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
  ESTADOS, CRITERIOS, VISOES,
  paraMotor, comRestante, liqPublica, vinculosInvalidos, coberto, semLancamento, totaisDe, naVisao, janelaDoMes,
  lerVinculos, painel, candidatos, conciliar, desfazer, ignorar, reativar, automatica, criarConta
};
