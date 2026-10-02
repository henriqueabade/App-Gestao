/**
 * Relatório mensal para a contabilidade (etapa 8). Uma leitura só — nada é
 * gravado — do que as etapas anteriores produziram:
 *
 *   livro      o livro-caixa de cada conta do banco, no formato que a
 *              contabilidade já recebe ("Extrato de Conta"): data, número,
 *              descrição do banco, débito, crédito, saldo, a conta do plano
 *              (o "Tipo"), a observação (de quem é o dinheiro) e o vencimento
 *              do título; com o total de cada dia e do período
 *   partidas   o mesmo em duas linhas por lançamento (lado do banco × lado da
 *              conta do plano), a partida dobrada simplificada do relatório
 *              de hoje (plano, seção 0)
 *   resultado  receitas, deduções, custos, despesas e o resultado do mês por
 *              conta do plano
 *   conciliacao  o que casou, o que foi ignorado (com a justificativa), o que
 *              falta conciliar e o que o app registrou sem lançamento no banco
 *   pendencias e documentos   as do checklist e os documentos da competência
 *
 * Competência FECHADA com versão (etapa 7): os lançamentos, as contas do
 * plano, o resultado, o saldo do banco e as pendências são os da FOTO do
 * fechamento — o relatório de um mês fechado não muda; o que mudou depois
 * aparece como diferença. Aberta ou reaberta: é uma PRÉVIA, com os números de
 * hoje. Fechada antes da etapa 7 (sem versão): os números de hoje, avisando.
 *
 * O PDF (documento.js) e a planilha (planilha.js) saem deste mesmo objeto.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const checklist = require('../checklist');
const versoes = require('../versoes');
const extratoMod = require('../extrato/extrato');
const classificacao = require('../classificacao/classificacao');
const planoMod = require('../classificacao/plano');
const liquidacoes = require('../conciliacao/liquidacoes');
const conciliacaoMod = require('../conciliacao/conciliacao');
const evidencias = require('../evidencias');

const ESTADOS = { pendente: 'A conciliar', conciliado: 'Conciliado', ignorado: 'Ignorado' };
const estadoDe = m => (ESTADOS[m?.estado_conciliacao] ? m.estado_conciliacao : 'pendente');
const soma = (lista, f) => c.centavos(c.lista(lista).reduce((s, x) => s + (Number(f(x)) || 0), 0));

// ------------------------------------------------------------------ puras

/** 'AAAA-MM-DDTHH:MM…' -> 'dd/mm/aaaa às HH:MM'. Pura. */
function instanteImpresso(instante) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(instante || ''));
  if (!m) return '—';
  return m[4] ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * De quem é o dinheiro de um lançamento, em uma linha (a coluna "Observação"
 * do relatório de hoje): o que ele casa na conciliação (fornecedor, cliente,
 * conta, parcela), a justificativa de ignorado, "a conciliar", e a
 * observação da classificação à mão. Sem nada disso, o CNPJ/CPF da
 * contrapartida que o banco mandou. Pura.
 */
function observacaoDe({ vinculos = [], liqsPorChave = new Map(), estado = 'pendente', observacaoConciliacao = null, manual = null, contrapartida = null }) {
  const partes = [];
  const ligados = c.lista(vinculos).filter(v => v && !v.desfeito_em);
  const textos = ligados.map(v => {
    const l = liqsPorChave.get(liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id));
    if (!l) return `${liquidacoes.TIPOS[v.alvo_tipo]?.rotulo || v.alvo_tipo} ${v.alvo_id}`;
    return [l.nome, l.rotulo].filter(Boolean).join(' — ');
  });
  if (textos.length > 3) partes.push(`${textos.slice(0, 3).join(' + ')} e mais ${textos.length - 3}`);
  else if (textos.length) partes.push(textos.join(' + '));
  if (estado === 'ignorado') partes.push(`Ignorado${observacaoConciliacao ? `: ${observacaoConciliacao}` : ''}`);
  else if (estado === 'pendente' && !textos.length) partes.push('A conciliar');
  if (manual?.observacao) partes.push(String(manual.observacao));
  if (!textos.length && contrapartida) partes.push(`CNPJ/CPF ${contrapartida}`);
  return partes.join(' · ') || null;
}

/** O vencimento do título que o lançamento paga ou recebe (um só; vários diferentes = o primeiro). Pura. */
function vencimentoDe(vinculos, vencPorChave = new Map()) {
  const datas = [...new Set(c.lista(vinculos).filter(v => v && !v.desfeito_em)
    .map(v => vencPorChave.get(liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id))).filter(Boolean))].sort();
  return datas[0] || null;
}

/**
 * O livro-caixa de uma conta: cada lançamento com débito (saída), crédito
 * (entrada) e o saldo depois dele; o total de cada dia e do período. O saldo
 * inicial é o de ABERTURA digitado na conta (19b do dono: `abertura`, já
 * levado até a véspera do mês) e, sem ele, o que sai do saldo que o banco
 * informou (no OFX): saldo informado menos o que entrou e saiu até aquele
 * dia. Com os dois, `conferencia` diz se o livro bate com o banco. Sem
 * nenhum, a coluna é só o acumulado do mês (`saldo_conhecido: false`). Pura.
 */
function livroDaConta({ conta, linhas = [], saldoBanco = null, completo = null, abertura = null, contaPlano = null }) {
  const ordenadas = c.lista(linhas).slice()
    .sort((x, y) => String(x.data).localeCompare(String(y.data)) || Number(x.id) - Number(y.id));
  const doBanco = Boolean(saldoBanco && saldoBanco.data && Number.isFinite(Number(saldoBanco.valor)));
  const digitado = Boolean(abertura && Number.isFinite(Number(abertura.valor)));
  const conhecido = digitado || doBanco;
  const peloBanco = doBanco ? c.centavos(Number(saldoBanco.valor) - soma(ordenadas.filter(l => String(l.data) <= saldoBanco.data), l => l.valor)) : null;
  const saldoInicial = digitado ? c.centavos(abertura.valor) : peloBanco;
  const conferencia = digitado && doBanco ? {
    data: saldoBanco.data, banco: c.centavos(saldoBanco.valor),
    livro: c.centavos(saldoInicial + soma(ordenadas.filter(l => String(l.data) <= saldoBanco.data), l => l.valor)),
    diferenca: c.centavos(saldoInicial - peloBanco)
  } : null;
  let saldo = saldoInicial ?? 0;
  const comSaldo = ordenadas.map(l => {
    saldo = c.centavos(saldo + Number(l.valor || 0));
    const v = c.centavos(l.valor);
    return { ...l, valor: v, debito: v < 0 ? c.centavos(-v) : null, credito: v > 0 ? v : null, saldo };
  });
  const dias = [];
  for (const l of comSaldo) {
    let d = dias[dias.length - 1];
    if (!d || d.data !== l.data) {
      d = { data: l.data, quantidade: 0, entradas: 0, saidas: 0, resultado: 0, saldo: 0 };
      dias.push(d);
    }
    d.quantidade += 1;
    if (l.valor > 0) d.entradas = c.centavos(d.entradas + l.valor); else d.saidas = c.centavos(d.saidas + l.valor);
    d.resultado = c.centavos(d.resultado + l.valor);
    d.saldo = l.saldo;
  }
  const entradas = soma(comSaldo.filter(l => l.valor > 0), l => l.valor);
  const saidas = soma(comSaldo.filter(l => l.valor < 0), l => l.valor);
  const resultado = c.centavos(entradas + saidas);
  return {
    conta_id: conta?.id ?? null, conta: conta?.nome || 'Conta', tipo: conta?.tipo || null, conta_plano: contaPlano || null,
    saldo_conhecido: conhecido, saldo_inicial: saldoInicial, saldo_banco: doBanco ? { valor: c.centavos(saldoBanco.valor), data: saldoBanco.data } : null,
    saldo_origem: digitado ? 'digitado' : (doBanco ? 'banco' : null), abertura: digitado ? { valor: c.centavos(abertura.valor), data: abertura.data || null } : null, conferencia,
    saldo_final: saldoInicial === null ? null : c.centavos(saldoInicial + resultado),
    completo,
    linhas: comSaldo, dias,
    totais: { quantidade: comSaldo.length, entradas, saidas, resultado }
  };
}

/**
 * Duas linhas por lançamento, como o relatório de hoje: a do banco (a conta
 * entre colchetes, com o valor do extrato) e a da conta do plano (o valor ao
 * contrário e a observação). Cada lançamento soma zero. Pura.
 */
function partidasDe(livros) {
  const linhas = [];
  for (const livro of c.lista(livros)) {
    for (const l of livro.linhas) {
      // Fase B: o lado do banco com a conta do plano dele (BB = 00008 · Banco do Brasil).
      const banco = livro.conta_plano ? `${livro.conta_plano} [${livro.conta}]` : `[${livro.conta}]`;
      linhas.push({ movimento_id: l.id, lado: 'banco', data: l.data, numero: l.numero || null, conta: banco, descricao: l.descricao || null, valor: l.valor, observacao: null, vencimento: l.vencimento || null });
      linhas.push({ movimento_id: l.id, lado: 'plano', data: l.data, numero: null, conta: l.conta_plano || 'Sem classificação', descricao: l.observacao || l.descricao || null, valor: c.centavos(-l.valor), observacao: l.observacao || null, vencimento: l.vencimento || null });
    }
  }
  return linhas;
}

/** O resultado com o rótulo do tipo de cada conta do plano. Pura. */
function resultadoComRotulos(resultado) {
  if (!resultado) return null;
  return {
    ...resultado,
    por_conta: c.lista(resultado.por_conta).map(g => ({
      ...g, conta: g.conta_codigo && !String(g.conta).startsWith(`${g.conta_codigo} `) ? `${g.conta_codigo} · ${g.conta}` : g.conta,
      tipo_rotulo: planoMod.TIPOS[g.tipo] || (g.conta_id ? null : 'Sem classificação'), do_resultado: planoMod.DO_RESULTADO.has(g.tipo)
    }))
  };
}

/** O texto da situação no alto do relatório. Pura. */
function notaDaSituacao({ status, versao = null, fechadaEm = null, fechadaPor = null, diferencas = 0, encerrada = true }) {
  if (status === 'fechada' && versao) {
    const dif = diferencas ? ` Há ${c.plural(diferencas, 'diferença', 'diferenças')} desde o fechamento (veja o Histórico dos fechamentos).` : '';
    return `Competência fechada em ${instanteImpresso(fechadaEm)}${fechadaPor ? ` por ${fechadaPor}` : ''} — versão ${versao}. Os números são os da foto do fechamento.${dif}`;
  }
  if (status === 'fechada') return 'Competência fechada antes das versões do fechamento: os números são os de hoje.';
  return `PRÉVIA — a competência está ${status === 'reaberta' ? 'reaberta' : 'aberta'}: os números ainda podem mudar.${encerrada === false ? ' O mês ainda está em curso.' : ''}`;
}

/** O nome do arquivo (sem extensão): competência e versão, ou "previa". Pura. */
const nomeDoArquivo = rel => `contabilidade-${rel.competencia}-relatorio-${rel.situacao?.versao ? `v${rel.situacao.versao}` : 'previa'}`;

// ------------------------------------------------------------------ leitura

const lerSePuder = (api, tabela) => api.get(`/api/${tabela}`).then(c.lista).catch(() => []);

/** O vencimento de cada liquidação ligada: a parcela da conta a pagar ou a do pedido. */
async function vencimentos(api, liqs) {
  const mapa = new Map();
  const pagamentosTitulo = liqs.filter(l => l.tipo === 'titulo_pagamento');
  if (pagamentosTitulo.length) {
    const [pags, parcelas] = await Promise.all([
      b.lerOpcional(api, 'titulo_pagar_pagamentos').then(x => x || []), b.lerOpcional(api, 'titulo_pagar_parcelas').then(x => x || [])
    ]);
    const parcelaPorId = new Map(parcelas.map(p => [String(p.id), p]));
    const pagPorId = new Map(pags.map(p => [String(p.id), p]));
    for (const l of pagamentosTitulo) {
      const venc = c.dia(parcelaPorId.get(String(pagPorId.get(String(l.id))?.parcela_id))?.vencimento);
      if (venc) mapa.set(l.chave, venc);
    }
  }
  const recebidos = liqs.filter(l => l.tipo === 'recebimento');
  if (recebidos.length) {
    const [recs, parcelas] = await Promise.all([lerSePuder(api, 'recebimentos'), lerSePuder(api, 'pedido_parcelas')]);
    const recPorId = new Map(recs.filter(Boolean).map(r => [String(r.id), r]));
    const parcela = new Map(parcelas.filter(Boolean).map(p => [`${p.pedido_id}:${Number(p.numero_parcela)}`, p]));
    for (const l of recebidos) {
      const r = recPorId.get(String(l.id));
      const venc = r ? c.dia(parcela.get(`${r.pedido_id}:${Number(r.numero_parcela)}`)?.data_vencimento) : null;
      if (venc) mapa.set(l.chave, venc);
    }
  }
  return mapa;
}

async function nomeDaEmpresa(api) {
  const cfg = await require('../../fiscal/configuracaoFiscal').carregar(api).catch(() => null);
  return {
    nome: cfg?.nome_fantasia || cfg?.razao_social || 'Santíssimo Decor',
    razao_social: cfg?.razao_social || null,
    cnpj: cfg?.cnpj ? b.documentoFormatado(cfg.cnpj) : null
  };
}

/**
 * Os lançamentos do relatório com a conta do plano: os da versão (mês
 * fechado — a foto; o resto do lançamento vem de hoje, se ainda existe) ou
 * os de hoje. `classificados: false` sem o SQL da classificação.
 */
async function lancamentosDoMes(api, { competencia, versao, movsHoje }) {
  if (versao) {
    const porId = new Map(movsHoje.map(m => [String(m.id), m]));
    return {
      classificados: true,
      itens: c.lista(versao.lancamentos).map(l => {
        const m = porId.get(String(l.id)) || null;
        return {
          movimento: {
            ...(m || {}), id: l.id, data: l.data, valor: l.valor, descricao: m?.descricao ?? l.descricao ?? null,
            conta_id: l.conta_financeira_id ?? m?.conta_id ?? null, competencia, estado_conciliacao: m?.estado_conciliacao ?? l.estado_conciliacao
          },
          classificacao: { conta_id: l.conta_id ?? null, conta: l.conta ?? null, conta_tipo: l.conta_tipo ?? null, criterio: l.conta_id ? 'fechamento' : 'sem' }
        };
      })
    };
  }
  const cls = movsHoje.length ? await classificacao.doMes(api, movsHoje) : [];
  if (cls === null) return { classificados: false, itens: movsHoje.map(m => ({ movimento: m, classificacao: null })) };
  return { classificados: true, itens: cls.map(x => ({ movimento: x.movimento, classificacao: x.classificacao })) };
}

/** A conciliação de cada conta: números e as listas do que não casou; null sem o SQL da etapa 5. */
async function conciliacaoDoMes(api, { contas, competencia, hoje }) {
  const lista = [];
  try {
    for (const conta of contas) {
      const p = await conciliacaoMod.painel(api, { contaId: conta.id, competencia, hoje, visao: 'todos' });
      if (!p.conta || String(p.conta.id) !== String(conta.id)) continue;
      const resumo = l => ({ id: l.id, data: l.data, valor: l.valor, descricao: l.descricao || null, observacao: l.observacao || null, sugestao: Boolean(l.sugestao) });
      lista.push({
        conta_id: conta.id, conta: conta.nome, totais: p.totais,
        a_conciliar: p.linhas.filter(l => l.estado === 'pendente').map(resumo),
        ignorados: p.linhas.filter(l => l.estado === 'ignorado').map(resumo),
        com_diferenca: p.linhas.filter(l => l.estado === 'conciliado' && l.diferenca).map(l => ({ ...resumo(l), diferenca: l.diferenca })),
        sem_lancamento: p.sem_lancamento.map(l => ({ data: l.data, valor: l.valor, tipo: l.tipo_rotulo, rotulo: l.rotulo, nome: l.nome || null, forma: l.forma || null })),
        cobertura: p.cobertura ? { completa: p.cobertura.completa, faltas: p.cobertura.faltas || [] } : null
      });
    }
  } catch (e) {
    if (e?.extra?.sql_pendente) return null;
    throw e;
  }
  return lista;
}

/**
 * O relatório inteiro de uma competência (o que a tela, o PDF e a planilha
 * mostram). Sem o SQL da base do módulo, 409.
 */
async function montar(api, { competencia, hoje, desde = null }) {
  if (!c.competenciaValida(competencia)) throw c.erro('Informe a competência (AAAA-MM).');
  const comp = String(competencia);
  const painel = await checklist.carregar({ api, competencia: comp, hoje, desde });
  if (painel.sql_pendente) throw c.erro(b.SQL_FALTANDO, 409, { sql_pendente: true });
  const st = painel.situacao || {};
  const fechada = st.status === 'fechada';
  const lidas = fechada ? await versoes.lerVersoes(api, comp) : null;
  const versao = lidas ? versoes.ultima(lidas) : null;
  const avisos = [];

  let contas = [];
  let semExtrato = false;
  try {
    contas = (await extratoMod.listarContas(api)).contas;
  } catch (e) {
    if (!e?.extra?.sql_pendente) throw e;
    semExtrato = true;
    avisos.push(`${b.SQL_FALTANDO_EXTRATO} Sem ele, o relatório sai sem o extrato.`);
  }
  const [movsLidos, importacoes, vinculosLidos, manuaisLidas, empresa] = await Promise.all([
    semExtrato ? [] : b.lerOpcional(api, 'movimentos_bancarios', { competencia: comp }).then(x => x || []),
    semExtrato ? [] : b.lerOpcional(api, 'extrato_importacoes').then(x => x || []),
    b.lerOpcional(api, 'conciliacao_vinculos').then(x => x || []),
    b.lerOpcional(api, 'classificacoes').then(x => x || []),
    nomeDaEmpresa(api)
  ]);
  const movsHoje = movsLidos.filter(m => m && m.competencia === comp);
  const { classificados, itens } = await lancamentosDoMes(api, { competencia: comp, versao, movsHoje });
  if (!classificados && itens.length) avisos.push(`${b.SQL_FALTANDO_CLASSIFICACAO} Sem ele, os lançamentos saem sem a conta do plano.`);

  const ids = new Set(itens.map(i => String(i.movimento.id)));
  const ligados = vinculosLidos.filter(v => v && !v.desfeito_em && ids.has(String(v.movimento_id)));
  const liqs = ligados.length ? await liquidacoes.carregar(api, { incluir: ligados.map(v => liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id)) }) : [];
  const liqsPorChave = new Map(liqs.map(l => [l.chave, l]));
  const vencPorChave = await vencimentos(api, liqs);
  const manualDe = new Map(manuaisLidas.filter(x => x && !x.substituida_em).map(x => [String(x.movimento_id), x]));

  const linhaDoLivro = ({ movimento: m, classificacao: cls }) => {
    const vinculos = ligados.filter(v => String(v.movimento_id) === String(m.id));
    const estado = estadoDe(m);
    return {
      id: m.id, data: c.dia(m.data), numero: m.documento || null, descricao: m.descricao || null, valor: c.centavos(m.valor),
      // Fase B: com o código reduzido da AEA na frente ("00528 · Industrialização de Mercadorias").
      conta_plano: cls?.conta ? (cls.conta_codigo ? `${cls.conta_codigo} · ${cls.conta}` : cls.conta) : null, conta_codigo: cls?.conta_codigo || null,
      conta_tipo: cls?.conta_tipo || null, criterio: cls?.criterio || null,
      estado, estado_rotulo: ESTADOS[estado],
      observacao: observacaoDe({
        vinculos, liqsPorChave, estado, observacaoConciliacao: m.conciliacao_observacao || null,
        manual: manualDe.get(String(m.id)) || null, contrapartida: b.documentoFormatado(m.contrapartida_documento)
      }),
      vencimento: vencimentoDe(vinculos, vencPorChave)
    };
  };

  const fotoExtrato = new Map(c.lista(versao?.foto?.extrato).map(x => [String(x.conta_id), x]));
  const contasDoMes = contas.filter(ct => ct.ativa || itens.some(i => String(i.movimento.conta_id) === String(ct.id)));
  // 19b: o saldo de abertura digitado (no fim do dia da data), levado até a véspera do mês.
  const vespera = new Date(Date.UTC(Number(comp.slice(0, 4)), Number(comp.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const aberturas = new Map();
  for (const conta of contasDoMes) {
    const digitado = extratoMod.saldoDigitado(conta);
    if (!digitado || digitado.data > vespera) continue;
    const daConta = digitado.data === vespera ? [] : ((await b.lerOpcional(api, 'movimentos_bancarios', { conta_id: Number(conta.id) })) || []);
    aberturas.set(String(conta.id), { valor: extratoMod.saldoNoFimDoDia(digitado, daConta, vespera), data: digitado.data });
  }
  // Fase B: a conta do plano de cada conta do banco (BB = 00008 · Banco do Brasil), para as partidas.
  const planoLido = (await b.lerOpcional(api, 'plano_contas').catch(() => null)) || [];
  const planoPorId = new Map(planoLido.map(p => [String(p.id), p]));
  const contaPlanoDe = conta => {
    const p = conta.plano_conta_id !== null && conta.plano_conta_id !== undefined ? planoPorId.get(String(conta.plano_conta_id)) : null;
    return p ? planoMod.rotulo(p) : null;
  };
  const livro = contasDoMes.map(conta => {
    const imps = importacoes.filter(i => String(i.conta_id) === String(conta.id));
    const daFoto = fotoExtrato.get(String(conta.id)) || null;
    const saldoBanco = daFoto ? daFoto.saldo_banco || null : extratoMod.saldoDoBanco(imps, comp);
    const completo = daFoto ? daFoto.completo ?? null : (conta.tipo === 'corrente' ? extratoMod.cobertura(imps, comp, { hoje }).completa : null);
    return livroDaConta({
      conta, linhas: itens.filter(i => String(i.movimento.conta_id) === String(conta.id)).map(linhaDoLivro), saldoBanco, completo, abertura: aberturas.get(String(conta.id)) || null,
      contaPlano: contaPlanoDe(conta)
    });
  });
  for (const l of livro) if (l.completo === false) avisos.push(`O extrato de ${l.conta} não cobre o mês inteiro: importe o que falta.`);
  for (const l of livro) {
    if (l.conferencia && Math.abs(l.conferencia.diferenca) > 0.009) {
      avisos.push(`O saldo de ${l.conta} não confere com o banco em ${c.impressa(l.conferencia.data)}: livro ${c.reais(l.conferencia.livro)} × banco ${c.reais(l.conferencia.banco)} (confira o saldo de abertura digitado e o extrato).`);
    }
  }

  const resultado = resultadoComRotulos(versao?.foto?.resultado
    || (classificados ? versoes.resultadoDe(classificacao.porConta(itens.map(i => ({ valor: i.movimento.valor, classificacao: i.classificacao })))) : null));
  const [conciliacao, documentos] = await Promise.all([
    semExtrato ? null : conciliacaoDoMes(api, { contas: contasDoMes, competencia: comp, hoje }),
    evidencias.carregar(api, { competencia: comp, hoje }).catch(() => null)
  ]);
  if (!semExtrato && conciliacao === null) avisos.push(`${b.SQL_FALTANDO_CONCILIACAO} Sem ele, o relatório sai sem a conciliação.`);

  const pendenciasLista = versao
    ? c.lista(versao.pendencias).map(p => ({ nivel: p.nivel, nivel_rotulo: b.NIVEIS[p.nivel]?.rotulo || p.nivel, titulo: p.titulo, descricao: null, ignorada: Boolean(p.ignorada), justificativa: p.justificativa || null }))
    : c.lista(painel.pendencias).map(p => ({ nivel: p.nivel, nivel_rotulo: b.NIVEIS[p.nivel]?.rotulo || p.nivel, titulo: p.titulo, descricao: p.descricao || null, ignorada: Boolean(p.ignorada), justificativa: p.justificativa || null }));
  const contagemPendencias = {
    critico: pendenciasLista.filter(p => !p.ignorada && p.nivel === 'critico').length,
    documental: pendenciasLista.filter(p => !p.ignorada && p.nivel === 'documental').length,
    aviso: pendenciasLista.filter(p => !p.ignorada && p.nivel === 'aviso').length,
    ignoradas: pendenciasLista.filter(p => p.ignorada).length
  };

  const todasLinhas = livro.flatMap(l => l.linhas);
  const concTotais = conciliacao ? {
    conciliados: conciliacao.reduce((s, x) => s + x.totais.conciliados, 0),
    ignorados: conciliacao.reduce((s, x) => s + x.totais.ignorados, 0),
    a_conciliar: { quantidade: conciliacao.reduce((s, x) => s + x.totais.a_conciliar.quantidade, 0), total: soma(conciliacao, x => x.totais.a_conciliar.total) },
    sem_lancamento: conciliacao.reduce((s, x) => s + x.sem_lancamento.length, 0)
  } : null;
  const status = st.status || 'aberta';
  const rel = {
    competencia: comp, rotulo: c.rotuloCompetencia(comp), gerado_em: b.instanteBR(c.agora()), empresa,
    situacao: {
      status, rotulo: { aberta: 'Aberta', fechada: 'Fechada', reaberta: 'Reaberta' }[status] || status,
      versao: versao ? Number(versao.versao) : null, fechada_em: st.fechada_em || null, fechada_por: st.fechada_por || null,
      previa: !fechada, diferencas: fechada ? Number(st.diferencas) || 0 : 0, diferencas_lista: fechada ? c.lista(st.diferencas_lista) : [],
      nota: notaDaSituacao({ status, versao: versao ? Number(versao.versao) : null, fechadaEm: st.fechada_em, fechadaPor: st.fechada_por, diferencas: fechada ? Number(st.diferencas) || 0 : 0, encerrada: painel.encerrada })
    },
    resumo: {
      lancamentos: todasLinhas.length,
      sem_classificacao: classificados ? todasLinhas.filter(l => !l.conta_plano).length : null,
      contas: livro.map(l => ({ conta: l.conta, saldo_inicial: l.saldo_inicial, entradas: l.totais.entradas, saidas: l.totais.saidas, resultado: l.totais.resultado, saldo_final: l.saldo_final, saldo_banco: l.saldo_banco, completo: l.completo })),
      conciliacao: concTotais,
      pendencias: contagemPendencias,
      documentos: documentos?.totais || null
    },
    livro,
    partidas: partidasDe(livro),
    resultado,
    conciliacao,
    pendencias: { origem: versao ? 'fechamento' : 'hoje', lista: pendenciasLista },
    documentos: documentos ? { itens: documentos.itens, totais: documentos.totais } : null,
    avisos
  };
  return { ...rel, arquivo: nomeDoArquivo(rel) };
}

module.exports = {
  ESTADOS, instanteImpresso, observacaoDe, vencimentoDe, livroDaConta, partidasDe, resultadoComRotulos, notaDaSituacao, nomeDoArquivo,
  vencimentos, lancamentosDoMes, conciliacaoDoMes, montar
};
