/**
 * Fase C (02/10/2026) — as aplicações do BB pelos PDFs mensais que o dono já
 * baixa do site (o BB não tem API para o Rende Fácil nem para o CDB). Pedido
 * do dono: "precisamos pensar em uma solução para que fique 100% correto".
 *
 *   Rende Fácil ... "BB RENDE FÁCIL": impresso pelo navegador (Skia). Resumo do
 *                   mês (saldo bruto inicial e final, aplicações, resgates
 *                   líquidos, IR, IOF, rendimentos) e o histórico (Data,
 *                   Histórico, Capital, Rendimento*, IR, IOF, Valor Líquido).
 *   CDB DI ........ "Extratos - CDB / RDB e BB Reaplic" (iText): saldo anterior,
 *                   cada resgate (capital, juros até o mês anterior, juros no
 *                   mês, IR, líquido), o rendimento mensal de cada depósito,
 *                   o saldo final e as tabelas (saldo dos últimos meses,
 *                   depósitos em ser, rendimento por depósito).
 *
 * Daqui saem os dados (nunca o arquivo), as CONFERÊNCIAS ao centavo (o PDF
 * tem de fechar com ele mesmo) e os LANÇAMENTOS que o extrato da conta
 * corrente tem de mostrar: no Rende Fácil, a soma do dia (uma linha para as
 * aplicações, outra para os resgates); no CDB, o capital e o rendimento
 * líquido de cada resgate em duas linhas. Tudo puro.
 */
const leitor = require('../comprovantes/leitor');

const PRODUTOS = { rende_facil: 'BB Rende Fácil', cdb: 'BB CDB DI' };
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const sem = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cent = v => Math.round((Number(v) || 0) * 100) / 100;
const igual = (a, b) => Math.abs(cent(a) - cent(b)) < 0.005;

/** "R$ 32.741,89" | "8,96-" | "99999,99" → número (o sinal de menos do fim é do rótulo IR: vale o valor). Pura. */
function dinheiro(texto) {
  const m = /(-?)\s*(?:R\$\s*)?([\d.]+,\d{2})/.exec(String(texto ?? ''));
  if (!m) return null;
  return cent(Number(m[2].replace(/\./g, '').replace(',', '.')));
}

/** "dd/mm/aaaa" → "aaaa-mm-dd". Pura. */
const dataIso = d => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(d ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** As linhas de todas as páginas, em ordem de leitura. Pura. */
function linhasDoPdf(buffer) {
  const lido = leitor.lerPdf(buffer, { todasPaginas: true });
  return (lido.paginasLidas || []).flatMap(p => leitor.linhasDaPagina(p));
}

/** Qual aplicação é o PDF (pelo título). Pura. */
function identificar(linhas) {
  const textos = linhas.map(l => sem(l.texto));
  if (textos.some(t => t.includes('bb rende facil'))) return 'rende_facil';
  if (textos.some(t => t.includes('bb cdb di') || t.includes('extratos - cdb'))) return 'cdb';
  return null;
}

const conferencia = (chave, rotulo, esperado, obtido) => ({ chave, rotulo, esperado: cent(esperado), obtido: cent(obtido), ok: igual(esperado, obtido) });

// ------------------------------------------------------------------ Rende Fácil

/** O PDF do BB Rende Fácil → dados, conferências e os lançamentos do extrato. Pura. */
function lerRendeFacil(linhas) {
  const saida = { produto: 'rende_facil', agencia: null, conta: null, competencia: null, periodo_inicio: null, periodo_fim: null, resumo: {}, movimentos: [], depositos: [] };
  let colunas = null;
  const saldos = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const cel = l.celulas.map(x => x.texto);
    const t0 = sem(cel[0]);
    if (t0 === 'agencia' && sem(cel[1]) === 'conta' && linhas[i + 1]) {
      saida.agencia = linhas[i + 1].celulas[0]?.texto || null;
      saida.conta = linhas[i + 1].celulas[1]?.texto || null;
      continue;
    }
    const mesAno = /resumo do mes - ([a-z]+)\/(\d{4})/.exec(sem(l.texto));
    if (mesAno && MESES.includes(mesAno[1])) {
      saida.competencia = `${mesAno[2]}-${String(MESES.indexOf(mesAno[1]) + 1).padStart(2, '0')}`;
      continue;
    }
    if (t0.startsWith('saldo bruto em')) { saldos.push({ data: dataIso(cel[0]), valor: dinheiro(cel[cel.length - 1]) }); continue; }
    const resumo = [['aplicacoes no mes', 'aplicacoes'], ['resgates liquidos no mes', 'resgates_liquidos'], ['ir sobre resgates', 'ir'], ['iof sobre resgates', 'iof'], ['rendimentos no mes', 'rendimentos']]
      .find(([rotulo]) => t0.startsWith(rotulo));
    if (resumo) { saida.resumo[resumo[1]] = dinheiro(cel[cel.length - 1]); continue; }
    if (t0 === 'data' && cel.some(x => sem(x) === 'historico') && cel.some(x => sem(x).startsWith('valor liquido'))) {
      colunas = l.celulas.map(x => ({ x: x.x, nome: sem(x.texto).replace('*', '') }));
      continue;
    }
    if (colunas && /^\d{2}\/\d{2}\/\d{4}$/.test(cel[0] || '')) {
      const valores = {};
      for (const c of l.celulas) {
        const col = colunas.reduce((melhor, k) => (Math.abs(k.x - c.x) < Math.abs(melhor.x - c.x) ? k : melhor), colunas[0]);
        valores[col.nome] = c.texto;
      }
      const hist = sem(valores.historico);
      const tipo = hist.startsWith('saldo anterior') ? 'saldo_anterior' : hist.startsWith('saldo final') ? 'saldo_final' : hist.startsWith('aplica') ? 'aplicacao' : hist.startsWith('resgate') ? 'resgate' : 'outro';
      saida.movimentos.push({
        data: dataIso(cel[0]), tipo, historico: valores.historico || null, capital: dinheiro(valores.capital), rendimento: dinheiro(valores.rendimento),
        ir: dinheiro(valores.ir), iof: dinheiro(valores.iof), liquido: dinheiro(valores['valor liquido'])
      });
    }
  }
  saida.saldo_inicial = saldos[0]?.valor ?? null;
  saida.saldo_final = saldos.length > 1 ? saldos[saldos.length - 1].valor : null;
  saida.periodo_inicio = saldos[0]?.data ?? null;
  saida.periodo_fim = saldos.length > 1 ? saldos[saldos.length - 1].data : null;

  const so = tipo => saida.movimentos.filter(m => m.tipo === tipo);
  const soma = (lista, campo) => cent(lista.reduce((s, m) => s + (m[campo] || 0), 0));
  const anterior = so('saldo_anterior')[0] || null;
  const final = so('saldo_final')[0] || null;
  const r = saida.resumo;
  // O rendimento do mês: o dos resgates, menos o que vinha do mês anterior, mais o que ficou no saldo.
  const rendimentoDoMes = cent(soma(so('resgate'), 'rendimento') - (anterior?.rendimento || 0) + (final?.rendimento || 0));
  saida.rendimento_mes = rendimentoDoMes;
  saida.ir_mes = soma(so('resgate'), 'ir');
  saida.iof_mes = soma(so('resgate'), 'iof');
  saida.conferencias = [
    conferencia('saldo', 'Saldo inicial + aplicações − resgates líquidos − IR − IOF + rendimentos = saldo final',
      (saida.saldo_inicial || 0) + (r.aplicacoes || 0) - (r.resgates_liquidos || 0) - (r.ir || 0) - (r.iof || 0) + (r.rendimentos || 0), saida.saldo_final),
    conferencia('aplicacoes', 'Soma das aplicações do histórico = aplicações no mês', soma(so('aplicacao'), 'liquido'), r.aplicacoes),
    conferencia('resgates', 'Soma dos resgates líquidos do histórico = resgates líquidos no mês', soma(so('resgate'), 'liquido'), r.resgates_liquidos),
    conferencia('ir', 'IR dos resgates = IR no mês', saida.ir_mes, r.ir),
    conferencia('iof', 'IOF dos resgates = IOF no mês', saida.iof_mes, r.iof),
    conferencia('rendimento', 'Rendimento dos resgates − o do mês anterior + o do saldo final = rendimentos no mês', rendimentoDoMes, r.rendimentos),
    conferencia('saldo_historico', 'Capital do saldo final do histórico = saldo bruto final', (final?.capital || 0) + (final?.rendimento || 0), saida.saldo_final)
  ];
  // O extrato mostra uma linha por dia para as aplicações e outra para os resgates (a soma do dia).
  const porDia = new Map();
  for (const m of [...so('aplicacao'), ...so('resgate')]) {
    const k = `${m.data}|${m.tipo}`;
    const g = porDia.get(k) || { data: m.data, sentido: m.tipo, parte: 'liquido', valor: 0, quantos: 0 };
    g.valor = cent(g.valor + (m.liquido || 0));
    g.quantos++;
    porDia.set(k, g);
  }
  saida.lancamentos = [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data) || a.sentido.localeCompare(b.sentido)).map(g => ({
    data: g.data, sentido: g.sentido, parte: g.parte, valor: g.valor,
    descricao: `${PRODUTOS.rende_facil} — ${g.sentido === 'aplicacao' ? (g.quantos > 1 ? `${g.quantos} aplicações` : 'aplicação') : (g.quantos > 1 ? `${g.quantos} resgates` : 'resgate')} do dia`
  }));
  return saida;
}

// ------------------------------------------------------------------ CDB

const CAMPOS_CDB = [
  ['valor juros ate mes ant', 'juros_anterior'], ['valor juros no mes', 'juros_mes'], ['valor juros', 'juros'], ['valor capital', 'capital'],
  ['valor ir', 'ir'], ['valor iof', 'iof'], ['valor liquido', 'liquido']
];

/** O PDF do CDB DI → dados, conferências e os lançamentos do extrato. Pura. */
function lerCdb(linhas) {
  const saida = { produto: 'cdb', agencia: null, conta: null, competencia: null, periodo_inicio: null, periodo_fim: null, resumo: {}, movimentos: [], depositos: [], saldos_meses: [], rendimento_por_deposito: [] };
  let atual = null;
  let secao = 'movimentos';
  const anoDe = (dia, mes) => {
    const ini = saida.periodo_inicio || '';
    const ano = Number(ini.slice(0, 4)) || new Date().getFullYear();
    return `${Number(mes) < Number(ini.slice(5, 7) || mes) ? ano + 1 : ano}-${mes}-${dia}`;
  };
  for (const l of linhas) {
    const cel = l.celulas.map(x => x.texto);
    const texto = cel.join(' ');
    const t = sem(texto);
    if (sem(cel[0]) === 'agencia') { saida.agencia = cel[1] || null; continue; }
    if (sem(cel[0]) === 'conta') { saida.conta = String(cel[1] || '').split(' ')[0] || null; continue; }
    if (sem(cel[0]) === 'periodo') {
      const m = /(\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/.exec(cel[1] || '');
      if (m) { saida.periodo_inicio = dataIso(m[1]); saida.periodo_fim = dataIso(m[2]); saida.competencia = saida.periodo_inicio.slice(0, 7); }
      continue;
    }
    if (t.startsWith('saldo nos ultimos')) { secao = 'saldos'; atual = null; continue; }
    if (t.startsWith('resumo dos depositos em ser')) { secao = 'depositos'; continue; }
    if (t.startsWith('rendimento bruto no periodo')) { secao = 'rendimentos'; continue; }
    if (secao === 'movimentos') {
      const h = /^(\d{2})\/(\d{2}) (.+?)(?: - (\d{6,}))?$/.exec(texto.trim());
      if (h) {
        const hist = sem(h[3]);
        const tipo = hist.startsWith('saldo anterior') ? 'saldo_anterior' : hist.startsWith('saldo final') ? 'saldo_final' : hist.startsWith('resgate') ? 'resgate'
          : hist.startsWith('rendimento') ? 'rendimento' : hist.startsWith('aplica') ? 'aplicacao' : 'outro';
        atual = { data: anoDe(h[1], h[2]), tipo, historico: h[3], deposito: h[4] || null };
        saida.movimentos.push(atual);
        continue;
      }
      const campo = CAMPOS_CDB.find(([rotulo]) => t.startsWith(rotulo));
      if (campo && atual) atual[campo[1]] = dinheiro(texto);
      continue;
    }
    if (secao === 'saldos') {
      const m = /^(\d{2}\/\d{2}\/\d{4}) ([\d.,]+) ([\d.,]+) ([\d.,]+) ([\d.,]+)$/.exec(texto.trim());
      if (m) saida.saldos_meses.push({ data: dataIso(m[1]), capital: dinheiro(m[2]), juros: dinheiro(m[3]), ir_projetado: dinheiro(m[4]), liquido_projetado: dinheiro(m[5]) });
      continue;
    }
    if (secao === 'depositos') {
      const m = /^(\d{6,}) (\d{2}\/\d{2}\/\d{4}) ([\d.,]+) ([\d.,]+) ([\d.,]+) (\d{2}\/\d{2}\/\d{4})$/.exec(texto.trim());
      if (m) saida.depositos.push({ deposito: m[1], data_aplicacao: dataIso(m[2]), capital_inicial: dinheiro(m[3]), saldo_capital: dinheiro(m[4]), taxa: dinheiro(m[5]), vencimento: dataIso(m[6]) });
      continue;
    }
    if (secao === 'rendimentos') {
      const m = /^(\d{2})\/(\d{2}) (\d{6,}) ([\d.,]+)$/.exec(texto.trim());
      if (m) saida.rendimento_por_deposito.push({ data: anoDe(m[1], m[2]), deposito: m[3], rendimento_bruto: dinheiro(m[4]) });
    }
  }
  const so = tipo => saida.movimentos.filter(m => m.tipo === tipo);
  const soma = (lista, campo) => cent(lista.reduce((s, m) => s + (m[campo] || 0), 0));
  const anterior = so('saldo_anterior')[0] || null;
  const final = so('saldo_final')[0] || null;
  saida.saldo_inicial = anterior?.capital ?? null;
  saida.saldo_final = final?.capital ?? null;
  saida.rendimento_mes = cent(soma(so('rendimento'), 'juros') + soma(so('resgate'), 'juros_mes'));
  saida.ir_mes = soma(so('resgate'), 'ir');
  saida.iof_mes = soma(so('resgate'), 'iof');
  const doFim = saida.saldos_meses.find(s => s.data === saida.periodo_fim) || null;
  saida.resumo = {
    aplicacoes: soma(so('aplicacao'), 'capital'), resgates_capital: soma(so('resgate'), 'capital'), resgates_liquidos: soma(so('resgate'), 'liquido'),
    rendimentos: saida.rendimento_mes, ir: saida.ir_mes, iof: saida.iof_mes,
    juros_acumulados_fim: doFim?.juros ?? null, ir_projetado_fim: doFim?.ir_projetado ?? null, liquido_projetado_fim: doFim?.liquido_projetado ?? null
  };
  saida.conferencias = [
    conferencia('capital', 'Capital anterior − capital resgatado + aplicado = capital final',
      (saida.saldo_inicial || 0) - saida.resumo.resgates_capital + saida.resumo.aplicacoes, saida.saldo_final),
    ...so('resgate').map((m, i) => conferencia(`resgate_${i + 1}`, `Resgate de ${m.data.split('-').reverse().join('/')}: capital + juros − IR − IOF = líquido`,
      (m.capital || 0) + (m.juros_anterior || 0) + (m.juros_mes || 0) - (m.ir || 0) - (m.iof || 0), m.liquido)),
    ...(doFim ? [conferencia('saldo_meses', 'Capital final = capital em ser na tabela dos últimos meses', doFim.capital, saida.saldo_final)] : []),
    ...(saida.depositos.length ? [conferencia('depositos', 'Capital final = soma dos depósitos em ser', soma(saida.depositos, 'saldo_capital'), saida.saldo_final)] : [])
  ];
  // O extrato mostra o capital e o rendimento líquido de cada resgate em duas linhas; a aplicação, uma.
  saida.lancamentos = [];
  for (const m of so('resgate')) {
    saida.lancamentos.push({ data: m.data, sentido: 'resgate', parte: 'capital', valor: cent(m.capital), descricao: `${PRODUTOS.cdb} — resgate (capital)${m.deposito ? ` · depósito ${m.deposito}` : ''}` });
    const rend = cent((m.liquido || 0) - (m.capital || 0));
    if (rend > 0) saida.lancamentos.push({ data: m.data, sentido: 'resgate', parte: 'rendimento', valor: rend, descricao: `${PRODUTOS.cdb} — resgate (rendimento líquido)${m.deposito ? ` · depósito ${m.deposito}` : ''}` });
  }
  for (const m of so('aplicacao')) saida.lancamentos.push({ data: m.data, sentido: 'aplicacao', parte: 'capital', valor: cent(m.capital), descricao: `${PRODUTOS.cdb} — aplicação` });
  saida.lancamentos.sort((a, b) => a.data.localeCompare(b.data) || a.sentido.localeCompare(b.sentido) || a.parte.localeCompare(b.parte));
  return saida;
}

/**
 * Um PDF → `{ produto, competencia, …, conferencias, confere, lancamentos }`.
 * Lança com mensagem clara quando não é um PDF das aplicações. Pura.
 */
function analisar(buffer) {
  const linhas = linhasDoPdf(buffer);
  const produto = identificar(linhas);
  if (!produto) {
    const e = new Error('Não é o PDF do BB Rende Fácil nem o do CDB DI (o extrato mensal do site do BB).');
    e.status = 400;
    throw e;
  }
  const lido = produto === 'rende_facil' ? lerRendeFacil(linhas) : lerCdb(linhas);
  if (!lido.competencia || lido.saldo_final === null) {
    const e = new Error(`Não deu para ler o mês ou o saldo final do PDF do ${PRODUTOS[produto]}.`);
    e.status = 422;
    throw e;
  }
  return { ...lido, produto_rotulo: PRODUTOS[produto], confere: lido.conferencias.every(x => x.ok) };
}

module.exports = { PRODUTOS, MESES, dinheiro, dataIso, linhasDoPdf, identificar, lerRendeFacil, lerCdb, analisar };
