/**
 * Os números do Dashboard.
 *
 * O painel antigo era Math.random. Este lê o banco, e cada teste aqui prende
 * uma armadilha que faria um número mentir calado: o fuso que muda a venda de
 * mês, a coluna DATE que vira o dia anterior, o dinheiro que chega como
 * "1.234,56", e as definições de Relatórios que parecem certas e não são
 * (cancelado no faturado, rascunho no denominador, negativo descontado).
 *
 * O relógio é sempre injetado: 13/09/2026, meio-dia em São Paulo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./dashboardResumo');

const AGORA = new Date('2026-09-13T15:04:05.000Z'); // 12:04 em São Paulo
const HOJE = '2026-09-13';

const dia = n => r.somarDias(HOJE, n);
/** Meio-dia em São Paulo do dia pedido — longe de qualquer virada de fuso. */
const meioDia = d => `${d}T15:00:00.000Z`;

// -------------------------------------------------------------------- tempo

test('hoje e o mês atual são os de São Paulo, não os de Greenwich', () => {
  // 02:30Z do dia 1 ainda é 23:30 do dia 31 em São Paulo.
  assert.deepEqual(r.contextoDeTempo(new Date('2026-09-01T02:30:00Z')), { hoje: '2026-08-31', mesAtual: '2026-08' });
  assert.deepEqual(r.contextoDeTempo(AGORA), { hoje: HOJE, mesAtual: '2026-09' });
});

test('coluna DATE à meia-noite UTC continua sendo o mesmo dia', () => {
  // É assim que o upstream pode serializar um DATE. Convertido para São Paulo,
  // viraria o dia 12 — e o orçamento que vence hoje apareceria vencido.
  assert.equal(r.diaDeColunaDate('2026-09-13T00:00:00.000Z'), '2026-09-13');
  assert.equal(r.diaLocal('2026-09-13T00:00:00.000Z'), '2026-09-12', 'a armadilha que o corte evita');
  assert.equal(r.diaDeColunaDate('2026-09-13'), '2026-09-13');
  assert.equal(r.diaDeColunaDate(''), null);
  assert.equal(r.diaDeColunaDate(null), null);
});

test('texto só de data não é deslocado pelo fuso', () => {
  // new Date('2026-09-13') é meia-noite UTC: em São Paulo, dia 12.
  assert.equal(r.diaLocal('2026-09-13'), '2026-09-13');
  assert.equal(r.diaLocal('não é data'), null);
  assert.equal(r.diaLocal(null), null);
});

// ------------------------------------------------------------------- vendas

test('vendas do mês não contam pedido cancelado', () => {
  const vendas = r.resumirVendas({
    pedidos: [
      { id: 1, situacao: 'Produção', data_emissao: meioDia('2026-09-02'), valor_final: 1000 },
      { id: 2, situacao: 'Cancelado', data_emissao: meioDia('2026-09-03'), valor_final: 5000 },
      { id: 3, situacao: 'Entregue', data_emissao: meioDia('2026-09-04'), valor_final: 3000 }
    ]
  }, { agora: AGORA });

  assert.deepEqual(vendas.mesAtual, { quantidade: 2, valor: 4000, ticketMedio: 2000 });
  // Nem na série: o gráfico e o KPI têm de bater.
  assert.deepEqual(vendas.serie12m.at(-1), { mes: '2026-09', quantidade: 2, valor: 4000 });
});

test('pedido emitido às 02:30Z do dia 1 é venda do mês anterior', () => {
  const vendas = r.resumirVendas({
    pedidos: [{ id: 1, situacao: 'Produção', data_emissao: '2026-09-01T02:30:00Z', valor_final: 700 }]
  }, { agora: AGORA });

  assert.equal(vendas.mesAtual.quantidade, 0);
  assert.equal(vendas.mesAnterior.quantidade, 1);
  assert.equal(vendas.serie12m.find(m => m.mes === '2026-08').valor, 700);
});

test('a série tem sempre 12 meses, com zero nos meses sem venda', () => {
  const vendas = r.resumirVendas({
    pedidos: [
      { id: 1, situacao: 'Entregue', data_emissao: meioDia('2026-03-10'), valor_final: 100 },
      // Setembro do ano passado já fica fora da janela de 12 meses.
      { id: 2, situacao: 'Entregue', data_emissao: meioDia('2025-09-30'), valor_final: 999 }
    ]
  }, { agora: AGORA });

  assert.equal(vendas.serie12m.length, 12);
  assert.equal(vendas.serie12m[0].mes, '2025-10');
  assert.equal(vendas.serie12m.at(-1).mes, '2026-09');
  assert.deepEqual(vendas.serie12m.find(m => m.mes === '2026-03'), { mes: '2026-03', quantidade: 1, valor: 100 });
  assert.equal(vendas.serie12m.filter(m => m.quantidade === 0).length, 11, 'mês vazio aparece com zero, não some');
});

test('o mesmo período do mês passado vai até o mesmo dia de hoje', () => {
  const vendas = r.resumirVendas({
    pedidos: [
      { id: 1, situacao: 'Entregue', data_emissao: meioDia('2026-08-13'), valor_final: 100 },
      { id: 2, situacao: 'Entregue', data_emissao: meioDia('2026-08-14'), valor_final: 200 },
      // 23:30 do dia 13 em São Paulo — dentro, apesar de já ser 14 em UTC.
      { id: 3, situacao: 'Entregue', data_emissao: '2026-08-14T02:30:00Z', valor_final: 50 }
    ]
  }, { agora: AGORA });

  assert.deepEqual(vendas.mesAnteriorMesmoPeriodo, { quantidade: 2, valor: 150, ticketMedio: 75 });
  assert.deepEqual(vendas.mesAnterior, { quantidade: 3, valor: 350, ticketMedio: 116.67 });
});

test('no dia 31, o mês anterior de 30 dias entra inteiro no mesmo período', () => {
  const vendas = r.resumirVendas({
    pedidos: [{ id: 1, situacao: 'Entregue', data_emissao: meioDia('2026-09-30'), valor_final: 900 }]
  }, { agora: new Date('2026-10-31T15:00:00Z') });

  assert.equal(vendas.mesAnteriorMesmoPeriodo.quantidade, 1);
  assert.equal(vendas.mesAnteriorMesmoPeriodo.valor, 900);
});

test('ticket médio é zero sem pedido, nunca NaN', () => {
  const vendas = r.resumirVendas({ pedidos: [] }, { agora: AGORA });
  assert.deepEqual(vendas.mesAtual, { quantidade: 0, valor: 0, ticketMedio: 0 });
});

test('cancelados do mês contam pela data do cancelamento, e sem data não entram', () => {
  const vendas = r.resumirVendas({
    pedidos: [
      // Emitido em julho, cancelado em setembro: é perda DESTE mês.
      { id: 1, situacao: 'Cancelado', data_emissao: meioDia('2026-07-10'), data_cancelamento: meioDia('2026-09-05'), valor_final: 3200 },
      // Linha antiga, sem a data: não se chuta.
      { id: 2, situacao: 'Cancelado', data_emissao: meioDia('2026-09-02'), valor_final: 800 },
      // 02:00Z do dia 1 é 31 de agosto em São Paulo.
      { id: 3, situacao: 'cancelado', data_emissao: meioDia('2026-08-20'), data_cancelamento: '2026-09-01T02:00:00Z', valor_final: 100 }
    ]
  }, { agora: AGORA });

  assert.deepEqual(vendas.canceladosMes, { quantidade: 1, valor: 3200 });
});

test('valores em string no formato brasileiro somam certo', () => {
  const vendas = r.resumirVendas({
    pedidos: [
      { id: 1, situacao: 'Produção', data_emissao: meioDia('2026-09-01'), valor_final: '1.234,56' },
      { id: 2, situacao: 'Produção', data_emissao: meioDia('2026-09-02'), valor_final: '1234.44' },
      { id: 3, situacao: 'Produção', data_emissao: meioDia('2026-09-03'), valor_final: 100 },
      { id: 4, situacao: 'Produção', data_emissao: meioDia('2026-09-04'), valor_final: null }
    ]
  }, { agora: AGORA });

  // Number('1.234,56') é NaN — uma linha assim zerava o mês inteiro.
  assert.equal(vendas.mesAtual.valor, 2569);
  assert.equal(vendas.mesAtual.ticketMedio, 642.25);
});

// ----------------------------------------------------------------- produção

test('faixas de idade nas bordas: 15/16, 30/31, 60/61', () => {
  const idades = [15, 16, 30, 31, 60, 61];
  const producao = r.resumirProducao({
    pedidos: idades.map((d, i) => ({ id: i + 1, situacao: 'Produção', data_aprovacao: dia(-d), valor_final: 10 }))
  }, { agora: AGORA });

  assert.deepEqual(producao.porIdade, [
    { faixa: '0-15', quantidade: 1 },
    { faixa: '16-30', quantidade: 2 },
    { faixa: '31-60', quantidade: 2 },
    { faixa: '60+', quantidade: 1 }
  ]);
});

test('idade conta do dia local da emissão; a aprovação (DATE) vale sozinha ou quando é outra data', () => {
  const producao = r.resumirProducao({
    pedidos: [
      // Aprovação e emissão do mesmo instante: vale o dia da emissão em São Paulo.
      { id: 1, numero: 'PED1', situacao: 'Produção', data_aprovacao: '2026-09-13T00:00:00.000Z', data_emissao: meioDia(HOJE) },
      // Sem aprovação: emissão às 02:30Z do dia 1 = 31/08 em São Paulo = 13 dias.
      { id: 2, numero: 'PED2', situacao: 'Em produção', data_aprovacao: null, data_emissao: '2026-09-01T02:30:00Z' },
      // Só a aprovação, DATE à meia-noite UTC: aprovado HOJE, não ontem.
      { id: 3, numero: 'PED3', situacao: 'Produção', data_aprovacao: '2026-09-13T00:00:00.000Z' }
    ]
  }, { agora: AGORA });

  const dias = Object.fromEntries(producao.maisAntigos.map(p => [p.numero, p.dias]));
  assert.deepEqual(dias, { PED1: 0, PED2: 13, PED3: 0 });
  assert.equal(producao.quantidade, 3, '"Em produção" também é Produção');
});

test('pedido convertido às 22h30 em São Paulo conta a idade do dia local, não do dia UTC gravado na aprovação', () => {
  // A linha como buildPedidoPayload grava: `data_emissao` é o instante, e
  // `data_aprovacao` o corte UTC dele — dia 29, quando em São Paulo ainda é 28.
  const producao = r.resumirProducao({
    pedidos: [{
      id: 1, numero: 'PED1', situacao: 'Produção',
      data_emissao: '2026-08-29T01:30:00.000Z', data_aprovacao: '2026-08-29', valor_final: 10
    }]
  }, { agora: new Date('2026-09-13T15:04:00Z') });

  assert.equal(producao.maisAntigos[0].dias, 16, 'contada do dia UTC, dava 15');
  assert.deepEqual(producao.porIdade.map(f => f.quantidade), [0, 1, 0, 0], 'faixa 16-30, e não 0-15');
});

test('aprovação em outra data que a emissão vale a aprovação, e início no futuro conta zero dia', () => {
  const producao = r.resumirProducao({
    pedidos: [
      // Linha antiga: aprovado há 20 dias, pedido emitido só há 5.
      { id: 1, numero: 'PED1', situacao: 'Produção', data_aprovacao: dia(-20), data_emissao: meioDia(dia(-5)) },
      // Aprovação digitada no futuro: "há -2 dias" não diz nada a ninguém.
      { id: 2, numero: 'PED2', situacao: 'Produção', data_aprovacao: dia(2) }
    ]
  }, { agora: AGORA });

  const dias = Object.fromEntries(producao.maisAntigos.map(p => [p.numero, p.dias]));
  assert.deepEqual(dias, { PED1: 20, PED2: 0 });
  assert.equal(producao.porIdade[0].quantidade, 1, 'o de início no futuro entra na faixa 0-15');
});

test('os mais antigos vêm primeiro, no máximo cinco, com o nome do cliente', () => {
  const pedidos = [3, 90, 45, 12, 70, 20, 8].map((d, i) => ({
    id: i + 1,
    numero: `PED${i + 1}`,
    cliente_id: i === 1 ? 51 : 50,
    situacao: 'Produção',
    data_aprovacao: dia(-d),
    valor_final: '1.000,00'
  }));
  pedidos.push({ id: 99, numero: 'PED99', cliente_id: 77, situacao: 'Produção', data_aprovacao: dia(-200), valor_final: 5 });

  const producao = r.resumirProducao({
    pedidos,
    clientes: [
      { id: 50, nome_fantasia: 'Móveis Aurora' },
      { id: 51, nome_fantasia: '', razao_social: 'Casa Bela Decorações ME' }
    ]
  }, { agora: AGORA });

  assert.equal(producao.quantidade, 8, 'a lista corta em cinco; o total, não');
  assert.equal(producao.valor, 7005);
  assert.deepEqual(producao.maisAntigos.map(p => p.dias), [200, 90, 70, 45, 20]);
  // Cliente fora do cadastro vira travessão; sem nome fantasia, a razão social.
  assert.equal(producao.maisAntigos[0].cliente, '—');
  assert.deepEqual(producao.maisAntigos[1], { id: 2, numero: 'PED2', cliente: 'Casa Bela Decorações ME', dias: 90, valor: 1000 });
  assert.equal(producao.maisAntigos[2].cliente, 'Móveis Aurora');
});

test('pedidos por situação trazem as cinco chaves em ordem, só dos últimos 12 meses', () => {
  const producao = r.resumirProducao({
    pedidos: [
      { id: 1, situacao: 'Produção', data_emissao: meioDia('2026-09-01'), valor_final: 100 },
      { id: 2, situacao: 'Entregue', data_emissao: meioDia('2026-01-10'), valor_final: 200 },
      { id: 3, situacao: 'Aguardando', data_emissao: meioDia('2026-02-10'), valor_final: 300 },
      { id: 4, situacao: 'Cancelado', data_emissao: meioDia('2026-05-10'), valor_final: 50 },
      // Treze meses atrás: fora do gráfico.
      { id: 5, situacao: 'Entregue', data_emissao: meioDia('2025-08-10'), valor_final: 999 }
    ]
  }, { agora: AGORA });

  // Situação desconhecida vai para "Outros": sumir com ela deixaria o donut
  // menor que o número de pedidos.
  assert.deepEqual(producao.porSituacao12m, [
    { situacao: 'Produção', quantidade: 1, valor: 100 },
    { situacao: 'Enviado', quantidade: 0, valor: 0 },
    { situacao: 'Entregue', quantidade: 1, valor: 200 },
    { situacao: 'Cancelado', quantidade: 1, valor: 50 },
    { situacao: 'Outros', quantidade: 1, valor: 300 }
  ]);
});

// --------------------------------------------------------------- orçamentos

test('pendente vigente, vencido e sem validade', () => {
  const orcamentos = r.resumirOrcamentos({
    orcamentos: [
      { id: 1, situacao: 'Pendente', validade: HOJE, valor_final: 100 },
      { id: 2, situacao: 'Pendente', validade: dia(-1), valor_final: 200 },
      { id: 3, situacao: 'Pendente', validade: null, valor_final: 400 },
      { id: 4, situacao: 'pendente', validade: dia(30), valor_final: '1.000,00' },
      { id: 5, situacao: 'Rascunho', validade: dia(-10), valor_final: 50 },
      { id: 6, situacao: 'Aprovado', validade: dia(-10), valor_final: 70 }
    ]
  }, { agora: AGORA });

  // Vence hoje ainda vale; sem validade também. Só o de ontem está vencido —
  // e continua "Pendente" no banco, porque nada expira orçamento sozinho.
  assert.deepEqual(orcamentos.pendentesVigentes, { quantidade: 3, valor: 1500 });
  assert.deepEqual(orcamentos.pendentesVencidos, { quantidade: 1, valor: 200 });
  assert.deepEqual(orcamentos.rascunhos, { quantidade: 1, valor: 50 });
});

test('vencendo em 7 dias: hoje e hoje+7 entram, hoje+8 fica de fora', () => {
  const orcamentos = r.resumirOrcamentos({
    orcamentos: [
      { id: 1, numero: 'ORC1', situacao: 'Pendente', validade: dia(7), valor_final: 10, dono: 'Ana', cliente_id: 50 },
      { id: 2, numero: 'ORC2', situacao: 'Pendente', validade: dia(8), valor_final: 20, dono: 'Ana', cliente_id: 50 },
      // DATE serializado à meia-noite UTC: vence HOJE, não ontem.
      { id: 3, numero: 'ORC3', situacao: 'Pendente', validade: '2026-09-13T00:00:00.000Z', valor_final: 30, dono: '  ', cliente_id: 99 },
      { id: 4, numero: 'ORC4', situacao: 'Pendente', validade: dia(-1), valor_final: 40, dono: 'Ana', cliente_id: 50 }
    ],
    clientes: [{ id: 50, nome_fantasia: 'Móveis Aurora' }]
  }, { agora: AGORA });

  assert.equal(orcamentos.vencendo7d.total, 2);
  assert.deepEqual(orcamentos.vencendo7d.itens, [
    { id: 3, numero: 'ORC3', destinatario: '—', dono: '—', validade: HOJE, diasRestantes: 0, valor: 30 },
    { id: 1, numero: 'ORC1', destinatario: 'Móveis Aurora', dono: 'Ana', validade: dia(7), diasRestantes: 7, valor: 10 }
  ]);
  assert.equal(orcamentos.pendentesVencidos.quantidade, 1, 'o de meia-noite UTC não pode cair em vencido');
});

test('a lista de vencendo acompanha o total real', () => {
  const orcamentos = r.resumirOrcamentos({
    orcamentos: Array.from({ length: 11 }, (_, i) => ({
      id: i + 1, situacao: 'Pendente', validade: dia(6 - (i % 7)), valor_final: 1
    }))
  }, { agora: AGORA });

  assert.equal(orcamentos.vencendo7d.total, 11);
  assert.equal(orcamentos.vencendo7d.itens.length, 8);
  // O que vence primeiro vem primeiro — é o que ainda dá para salvar.
  const validades = orcamentos.vencendo7d.itens.map(i => i.validade);
  assert.deepEqual(validades, [...validades].sort());
  assert.equal(validades[0], HOJE);
});

test('decisão dos últimos 90 dias usa o dia local da decisão e só os decididos', () => {
  const orcamentos = r.resumirOrcamentos({
    orcamentos: [
      { id: 1, situacao: 'Aprovado', data_aprovacao: meioDia(dia(-89)) },
      { id: 2, situacao: 'Aprovado', data_aprovacao: meioDia(dia(-90)) },
      { id: 3, situacao: 'Aprovado', data_aprovacao: meioDia(HOJE) },
      { id: 4, situacao: 'Rejeitado', data_aprovacao: meioDia(dia(-10)) },
      { id: 5, situacao: 'Expirado', data_aprovacao: meioDia(dia(-3)) },
      // 02:00Z do dia −89 ainda é o dia −90 em São Paulo: fora.
      { id: 6, situacao: 'Aprovado', data_aprovacao: `${dia(-89)}T02:00:00Z` },
      // Rascunho e pendente não entram no denominador — Relatórios os põe, e a
      // taxa de lá parece sempre ruim.
      { id: 7, situacao: 'Rascunho' },
      { id: 8, situacao: 'Pendente', validade: dia(3) }
    ]
  }, { agora: AGORA });

  assert.deepEqual(orcamentos.decisao90d, {
    aprovados: 2, rejeitados: 1, expirados: 1, decididos: 4, taxaAprovacao: 0.5
  });
});

test('sem decisão no período, a taxa é nula e não zero', () => {
  const orcamentos = r.resumirOrcamentos({ orcamentos: [{ id: 1, situacao: 'Pendente' }] }, { agora: AGORA });
  // 0% diria que tudo foi recusado.
  assert.equal(orcamentos.decisao90d.decididos, 0);
  assert.equal(orcamentos.decisao90d.taxaAprovacao, null);
});

test('destinatário de orçamento de prospecção só tem nome com pros.view', () => {
  const tabelas = {
    orcamentos: [{
      id: 1, numero: 'OCRP1', situacao: 'Pendente', validade: dia(2),
      cliente_id: null, prospeccao_id: 30, valor_final: 10
    }],
    prospeccoes: [{ id: 30, nome_fantasia: 'Casa Vicenzo' }]
  };

  const comPros = r.resumirOrcamentos(tabelas, { agora: AGORA, nomeDeProspeccao: true });
  const semPros = r.resumirOrcamentos(tabelas, { agora: AGORA, nomeDeProspeccao: false });

  assert.equal(comPros.vencendo7d.itens[0].destinatario, 'Casa Vicenzo');
  assert.equal(semPros.vencendo7d.itens[0].destinatario, 'Prospecção');
});

// ------------------------------------------------------------------ alertas

test('aprovado sem pedido é achado pelas duas correspondências', () => {
  const alertas = r.resumirAlertas({
    orcamentos: [
      { id: 1, numero: 'ORC1', situacao: 'Aprovado', cliente_id: 50, valor_final: 100, data_aprovacao: meioDia(dia(-5)) },
      { id: 2, numero: 'ORC2', situacao: 'Aprovado', cliente_id: 50, valor_final: 200, data_aprovacao: meioDia(dia(-4)) },
      { id: 3, numero: 'ORC3', situacao: 'Aprovado', cliente_id: 50, valor_final: '1.500,00', data_aprovacao: meioDia(dia(-3)) },
      { id: 4, numero: 'ORC4', situacao: 'Pendente', cliente_id: 50, valor_final: 400 }
    ],
    pedidos: [
      // Casa pelo orcamento_id, com id diferente.
      { id: 900, orcamento_id: 1, situacao: 'Produção' },
      // Casa pelo id reusado, sem orcamento_id. Cancelado também conta: a
      // conversão aconteceu.
      { id: 2, orcamento_id: null, situacao: 'Cancelado' }
    ],
    clientes: [{ id: 50, nome_fantasia: 'Móveis Aurora' }]
  }, { agora: AGORA });

  assert.deepEqual(alertas.aprovadosSemPedido, {
    quantidade: 1,
    itens: [{ id: 3, numero: 'ORC3', destinatario: 'Móveis Aurora', valor: 1500 }]
  });
});

test('aprovados sem pedido: o total é o real, e a lista traz os cinco mais recentes primeiro', () => {
  // ORCn foi aprovado há n dias. Entrada, ids e recência embaralhados de
  // propósito: só a ordem pela data da aprovação dá ORC1..ORC5.
  const diasAtras = [3, 1, 7, 2, 5, 4, 6];
  const alertas = r.resumirAlertas({
    orcamentos: diasAtras.map((n, i) => ({
      id: 10 + i, numero: `ORC${n}`, situacao: 'Aprovado', valor_final: 10, data_aprovacao: meioDia(dia(-n))
    })),
    pedidos: []
  }, { agora: AGORA });

  assert.equal(alertas.aprovadosSemPedido.quantidade, 7, 'a lista corta em cinco; o total, não');
  assert.deepEqual(alertas.aprovadosSemPedido.itens.map(i => i.numero), ['ORC1', 'ORC2', 'ORC3', 'ORC4', 'ORC5']);
});

// --------------------------------------------------------------- prospecção

test('prospecção aberta exclui Ganho, Perdido, convertida e arquivada', () => {
  const pros = r.resumirProspeccao({
    prospeccoes: [
      { id: 1, etapa: 'Novo', status: 'ativa', valor_estimado: '10.000,00', probabilidade: 10 },
      { id: 2, etapa: 'Negociacao', status: 'ativa', valor_estimado: 20000, probabilidade: '80' },
      { id: 3, etapa: 'Ganho', status: 'ativa', valor_estimado: 99999 },
      { id: 4, etapa: 'Perdido', status: 'arquivada', valor_estimado: 99999 },
      { id: 5, etapa: 'Proposta', status: 'arquivada', cliente_id: 50, valor_estimado: 99999 },
      { id: 6, etapa: 'Qualificado', status: 'Arquivada', valor_estimado: 99999 }
    ]
  }, { agora: AGORA });

  assert.equal(pros.abertos, 2);
  assert.equal(pros.valorEmAberto, 30000);
  assert.equal(pros.valorPonderado, 17000); // 10.000 × 10% + 20.000 × 80%
  // "Negociacao" sem acento é Negociação: o funil não pode perder a linha.
  assert.equal(pros.funil.find(e => e.etapa === 'Negociação').quantidade, 1);
});

test('Perdido com status ativa e convertida com status ativa também ficam fora do pipeline', () => {
  // No teste acima, Perdido e convertida também estão arquivados e sairiam só
  // pelo status. Aqui nada as tira além da etapa e do cliente_id: o POST de
  // prospecção aceita a etapa do corpo sem tocar no status, e linha legada
  // pode ter cliente_id com status ativa.
  const pros = r.resumirProspeccao({
    prospeccoes: [
      { id: 1, etapa: 'Novo', status: 'ativa', valor_estimado: 10000, probabilidade: 10 },
      { id: 2, etapa: 'Perdido', status: 'ativa', valor_estimado: 50000, probabilidade: 50, proximo_passo_data: dia(-40) },
      { id: 3, etapa: 'Proposta', status: 'ativa', cliente_id: 77, valor_estimado: 80000, probabilidade: 90, proximo_passo_data: dia(-10) }
    ]
  }, { agora: AGORA });

  assert.equal(pros.abertos, 1);
  assert.equal(pros.valorEmAberto, 10000);
  assert.equal(pros.valorPonderado, 1000);
  assert.equal(pros.followups.atrasados, 0, 'nem o Perdido nem a convertida cobram próximo passo');
  assert.equal(pros.funil.find(e => e.etapa === 'Proposta').quantidade, 0);
});

test('o funil traz as cinco etapas abertas, em ordem, mesmo vazias', () => {
  const pros = r.resumirProspeccao({
    prospeccoes: [
      { id: 1, etapa: 'Proposta', status: 'ativa', valor_estimado: 5000 },
      { id: 2, etapa: 'Proposta', status: 'ativa', valor_estimado: 7000 },
      { id: 3, etapa: 'Negociação', status: 'ativa', valor_estimado: 1000 }
    ]
  }, { agora: AGORA });

  assert.deepEqual(pros.funil, [
    { etapa: 'Novo', quantidade: 0, valor: 0 },
    { etapa: 'Contactado', quantidade: 0, valor: 0 },
    { etapa: 'Qualificado', quantidade: 0, valor: 0 },
    { etapa: 'Proposta', quantidade: 2, valor: 12000 },
    { etapa: 'Negociação', quantidade: 1, valor: 1000 }
  ]);
});

test('follow-ups nas bordas: ontem atrasa, hoje é hoje, +7 entra e +8 não', () => {
  const pros = r.resumirProspeccao({
    prospeccoes: [
      { id: 1, nome_fantasia: 'Casa Bela', etapa: 'Proposta', status: 'ativa', proximo_passo: 'Ligar', proximo_passo_data: dia(-3) },
      { id: 2, razao_social: 'Serrana Ltda', etapa: 'Novo', status: 'ativa', proximo_passo: 'Visitar', proximo_passo_data: dia(-1) },
      // DATE à meia-noite UTC: é HOJE, não atraso.
      { id: 3, nome_fantasia: 'Vicenzo', etapa: 'Contactado', status: 'ativa', proximo_passo: 'E-mail', proximo_passo_data: '2026-09-13T00:00:00.000Z' },
      { id: 4, nome_fantasia: 'Amanhã', etapa: 'Novo', status: 'ativa', proximo_passo_data: dia(1) },
      { id: 5, nome_fantasia: 'Borda', etapa: 'Novo', status: 'ativa', proximo_passo_data: dia(7) },
      { id: 6, nome_fantasia: 'Longe', etapa: 'Novo', status: 'ativa', proximo_passo_data: dia(8) },
      // Perdida não se cobra, por mais atrasada que esteja.
      { id: 7, nome_fantasia: 'Perdida', etapa: 'Perdido', status: 'arquivada', proximo_passo_data: dia(-30) },
      { id: 8, nome_fantasia: 'Sem data', etapa: 'Novo', status: 'ativa', proximo_passo_data: null }
    ]
  }, { agora: AGORA });

  assert.equal(pros.followups.atrasados, 2);
  assert.equal(pros.followups.hoje, 1);
  assert.equal(pros.followups.proximos7, 2);
  assert.deepEqual(pros.followups.itens, [
    { id: 1, nome: 'Casa Bela', etapa: 'Proposta', proximoPasso: 'Ligar', data: dia(-3), dias: -3 },
    { id: 2, nome: 'Serrana Ltda', etapa: 'Novo', proximoPasso: 'Visitar', data: dia(-1), dias: -1 },
    { id: 3, nome: 'Vicenzo', etapa: 'Contactado', proximoPasso: 'E-mail', data: HOJE, dias: 0 }
  ]);
});

test('follow-ups atrasados: o total é o real, e a lista traz seis, do atraso maior ao menor', () => {
  // Entrada embaralhada de propósito: só a ordem pela data dá dia −7 … dia −2.
  const pros = r.resumirProspeccao({
    prospeccoes: [3, 1, 7, 5, 2, 6, 4].map(n => ({
      id: n, nome_fantasia: `Loja ${n}`, etapa: 'Novo', status: 'ativa', proximo_passo_data: dia(-n)
    }))
  }, { agora: AGORA });

  assert.equal(pros.followups.atrasados, 7, 'a lista corta em seis; o total, não');
  assert.deepEqual(pros.followups.itens.map(i => i.data), [dia(-7), dia(-6), dia(-5), dia(-4), dia(-3), dia(-2)]);
});

test('convertidos no mês contam pela data local da conversão', () => {
  const pros = r.resumirProspeccao({
    prospeccoes: [
      { id: 1, etapa: 'Ganho', status: 'arquivada', cliente_id: 50, convertida_em: '2026-09-10T12:00:00Z' },
      // 02:00Z do dia 1 ainda é agosto em São Paulo.
      { id: 2, etapa: 'Ganho', status: 'arquivada', cliente_id: 51, convertida_em: '2026-09-01T02:00:00Z' },
      // Ganho sem cliente não é conversão.
      { id: 3, etapa: 'Ganho', status: 'ativa', cliente_id: null, convertida_em: '2026-09-10T12:00:00Z' }
    ]
  }, { agora: AGORA });

  assert.equal(pros.convertidosMes, 1);
});

test('a ordem do funil é a mesma do módulo de Prospecções', () => {
  // A lista do painel é uma cópia (o motivo está em dashboardResumo.js). Se
  // uma etapa nova nascer lá, o funil daqui não pode ficar sem ela calado.
  const { ETAPAS } = require('./prospeccoesController');
  assert.deepEqual(r.ETAPAS, ETAPAS);
});

// --------------------------------------------------- clientes, estoque, IA

test('cliente ativo é o de status Ativo, em qualquer grafia', () => {
  assert.deepEqual(r.resumirClientes({
    clientes: [
      { status_cliente: 'Ativo' },
      { status_cliente: '  ATIVO ' },
      { status_cliente: 'Inativo' },
      { status_cliente: null }
    ]
  }), { ativos: 2, total: 4 });
});

test('estoque ignora insumo infinito e não desconta negativo do valor', () => {
  const estoque = r.resumirEstoque({
    materia_prima: [
      { id: 1, nome: 'MDF 15mm', quantidade: 40, preco_unitario: '189,90' },
      { id: 2, nome: 'Lixa 120', quantidade: '6', preco_unitario: 2.5 },
      { id: 3, nome: 'Parafuso', quantidade: 0, preco_unitario: 1 },
      { id: 4, nome: 'Cola PVA', quantidade: -3.5, preco_unitario: 20, unidade: 'L', processo: 'Montagem' },
      { id: 5, nome: 'Energia', quantidade: 0, infinito: true, preco_unitario: 1 },
      { id: 6, nome: 'Água', quantidade: -50, infinito: 't', preco_unitario: 1 },
      { id: 7, nome: 'Fita de borda', quantidade: 9.99, preco_unitario: 1 },
      { id: 8, nome: 'Tinta', quantidade: 10, preco_unitario: 1 }
    ]
  });

  // 40 × 189,90 + 6 × 2,50 + 9,99 + 10 — o −3,5 × 20 NÃO é descontado.
  assert.equal(estoque.valorEstoque, 7630.99);
  assert.equal(estoque.zerados, 1, 'o infinito zerado não é falta');
  assert.equal(estoque.criticos, 2, 'abaixo de 10 e acima de zero; o 10 não é crítico');
  assert.equal(estoque.limiteCritico, 10);
  assert.deepEqual(estoque.negativos, {
    quantidade: 1,
    itens: [{ id: 4, nome: 'Cola PVA', quantidade: -3.5, unidade: 'L', processo: 'Montagem' }]
  });
});

test('negativos vêm do mais negativo, no máximo seis, sem somar quantidades', () => {
  const estoque = r.resumirEstoque({
    materia_prima: [-1, -8, -2.5, -30, -4, -0.5, -12].map((q, i) => ({
      id: i + 1, nome: `Insumo ${i + 1}`, quantidade: q, unidade: i % 2 ? 'm' : 'L'
    }))
  });

  assert.equal(estoque.negativos.quantidade, 7);
  assert.deepEqual(estoque.negativos.itens.map(i => i.quantidade), [-30, -12, -8, -4, -2.5, -1]);
  // Nenhum total de quantidade: metro e litro não se somam.
  assert.deepEqual(Object.keys(estoque.negativos), ['quantidade', 'itens']);
});

test('leituras da IA em revisão contam só o status revisao', () => {
  assert.deepEqual(r.resumirIa({
    ia_extracoes: [
      { status: 'revisao' },
      { status: ' Revisão ' },
      { status: 'aplicada' },
      { status: 'cancelada' },
      { status: 'lendo' }
    ]
  }), { emRevisao: 2 });
});

// ------------------------------------------------------------- sem valores

test('sem a coluna de valor os R$ viram nulo e as contagens continuam', () => {
  // Nulo, e não zero: "R$ 0,00" no lugar de "sem permissão" é mentira.
  const opcoes = { agora: AGORA, comValores: false };
  const pedidos = [{
    id: 1, numero: 'PED1', situacao: 'Produção',
    data_emissao: meioDia('2026-09-02'), data_aprovacao: '2026-09-02', valor_final: 100
  }];

  const vendas = r.resumirVendas({ pedidos }, opcoes);
  assert.deepEqual(vendas.mesAtual, { quantidade: 1, valor: null, ticketMedio: null });
  assert.ok(vendas.serie12m.every(m => m.valor === null));
  assert.equal(vendas.canceladosMes.valor, null);

  const producao = r.resumirProducao({ pedidos }, opcoes);
  assert.equal(producao.quantidade, 1);
  assert.equal(producao.valor, null);
  assert.equal(producao.maisAntigos[0].valor, null);
  assert.ok(producao.porSituacao12m.every(s => s.valor === null));

  const orcamentos = r.resumirOrcamentos({
    orcamentos: [{ id: 1, situacao: 'Pendente', validade: dia(1), valor_final: 50 }]
  }, opcoes);
  assert.deepEqual(orcamentos.pendentesVigentes, { quantidade: 1, valor: null });
  assert.equal(orcamentos.vencendo7d.itens[0].valor, null);

  const alertas = r.resumirAlertas({ orcamentos: [{ id: 1, situacao: 'Aprovado', valor_final: 50 }], pedidos: [] }, opcoes);
  assert.equal(alertas.aprovadosSemPedido.itens[0].valor, null);

  const pros = r.resumirProspeccao({
    prospeccoes: [{ id: 1, etapa: 'Novo', status: 'ativa', valor_estimado: 10 }]
  }, opcoes);
  assert.equal(pros.abertos, 1);
  assert.equal(pros.valorEmAberto, null);
  assert.equal(pros.valorPonderado, null);
  assert.ok(pros.funil.every(e => e.valor === null));

  const estoque = r.resumirEstoque({ materia_prima: [{ id: 1, quantidade: 2, preco_unitario: 5 }] }, opcoes);
  assert.equal(estoque.valorEstoque, null);
  assert.equal(estoque.criticos, 1);
});

// --------------------------------------------------------- nomes por coluna

test('sem as colunas de texto, prospecção e insumo saem sem nome, e o ponderado sem a probabilidade', () => {
  const escondidas = new Set(['col_pros_entidade', 'col_pros_proximo_passo', 'col_pros_prob', 'col_mp_nome', 'col_mp_unidade']);
  const pode = chave => !escondidas.has(chave);

  const pros = r.resumirProspeccao({
    prospeccoes: [{
      id: 1, nome_fantasia: 'Casa Bela', etapa: 'Proposta', status: 'ativa',
      valor_estimado: 10000, probabilidade: 40, proximo_passo: 'Ligar', proximo_passo_data: dia(-2)
    }]
  }, { agora: AGORA, pode });
  // Etapa, data e dias não identificam ninguém — os chips de atraso são feitos deles.
  assert.deepEqual(pros.followups.itens, [{ id: 1, nome: null, etapa: 'Proposta', proximoPasso: null, data: dia(-2), dias: -2 }]);
  assert.equal(pros.valorEmAberto, 10000);
  // Com uma prospecção só, o ponderado ao lado do valor É a probabilidade dela.
  assert.equal(pros.valorPonderado, null);

  const estoque = r.resumirEstoque({
    materia_prima: [{ id: 4, nome: 'Cola PVA', quantidade: -3.5, unidade: 'L', processo: 'Montagem' }]
  }, { pode });
  assert.deepEqual(estoque.negativos.itens, [{ id: 4, nome: null, quantidade: -3.5, unidade: null, processo: 'Montagem' }]);
});

// ----------------------------------------------------------------- previsão

/*
 * A amostra REAL de pedido_parcelas (SPEC-previsao §2), vista em 14/09/2026.
 * O valor chega como texto, como o upstream entrega coluna numeric. Os pedidos
 * em volta são inventados; só o valor_final segue a regra do banco: fecha com
 * a soma das parcelas (pedidosController recusa o contrário).
 */
const AGORA_PREVISAO = new Date('2026-09-14T15:00:00.000Z'); // meio-dia em São Paulo

const PARCELAS_REAIS = [
  [7, 90, 1, '3327.01', '2026-08-21'], [8, 90, 2, '3327.01', '2026-09-20'], [9, 90, 3, '3327.01', '2026-10-20'],
  [10, 90, 4, '3327.01', '2026-11-19'], [11, 90, 5, '3327.01', '2026-12-19'], [12, 90, 6, '3327.01', '2027-01-18'],
  [13, 91, 1, '3326.51', '2026-08-28'], [14, 91, 2, '3326.51', '2026-09-27'], [15, 91, 3, '3326.51', '2026-10-27'],
  [16, 91, 4, '3326.51', '2026-11-26'], [17, 91, 5, '3326.51', '2026-12-26'], [18, 91, 6, '3326.51', '2027-01-25'],
  [19, 95, 1, '12774.28', '2026-09-04'],
  [20, 96, 1, '1731.30', '2026-10-02'], [21, 96, 2, '1731.29', '2026-10-16'], [22, 96, 3, '1731.29', '2026-10-30'],
  [23, 99, 1, '2006.68', '2026-10-10'], [24, 99, 2, '2006.68', '2026-10-24'],
  [25, 98, 1, '3490.55', '2026-10-10'], [26, 98, 2, '3490.55', '2026-10-24'], [27, 98, 3, '3490.54', '2026-11-07'],
  [28, 92, 1, '1891.55', '2026-09-30'], [29, 92, 2, '1891.54', '2026-10-14'],
  [30, 93, 1, '2700.53', '2026-09-12']
].map(([id, pedido_id, numero_parcela, valor, data_vencimento]) => ({ id, pedido_id, numero_parcela, valor, data_vencimento }));

const CLIENTES_DA_AMOSTRA = [
  { id: 50, nome_fantasia: 'Vetri' },
  { id: 51, nome_fantasia: 'Móveis Aurora' },
  { id: 52, nome_fantasia: '', razao_social: 'Casa Bela Decorações ME' }
];

function pedidosDaAmostra() {
  return [
    { id: 90, numero: 'PED99', cliente_id: 51, situacao: 'Produção', valor_final: '19962.06', data_emissao: '2026-07-22T18:00:00.000Z' },
    { id: 91, numero: 'PED100', cliente_id: 52, situacao: 'Produção', valor_final: '19959.06', data_emissao: '2026-07-29T18:00:00.000Z' },
    { id: 92, numero: 'PED101', cliente_id: 50, situacao: 'Enviado', valor_final: '3783.09', data_emissao: '2026-08-31T18:00:00.000Z' },
    { id: 93, numero: 'PED102', cliente_id: 51, situacao: 'Entregue', valor_final: '2700.53', data_emissao: '2026-09-12T13:00:00.000Z' },
    { id: 95, numero: 'PED104', cliente_id: 52, situacao: 'Produção', valor_final: '12774.28', data_emissao: '2026-09-04T13:00:00.000Z' },
    { id: 96, numero: 'PED105', cliente_id: 50, situacao: 'Produção', valor_final: '5193.88', data_emissao: '2026-09-02T13:00:00.000Z' },
    { id: 98, numero: 'PED107', cliente_id: 51, situacao: 'Produção', valor_final: '10471.64', data_emissao: '2026-09-10T13:00:00.000Z' },
    // Cliente fora do cadastro: o nome vira travessão.
    { id: 99, numero: 'PED108', cliente_id: 77, situacao: 'Produção', valor_final: '4013.36', data_emissao: '2026-09-10T14:00:00.000Z' }
  ];
}

/** A amostra inteira; `mudar` troca campos de pedidos pelo id ({ 99: { situacao: 'Cancelado' } }). */
const amostra = (mudar = {}) => ({
  pedidos: pedidosDaAmostra().map(p => ({ ...p, ...(mudar[p.id] || {}) })),
  pedido_parcelas: PARCELAS_REAIS,
  clientes: CLIENTES_DA_AMOSTRA
});
const previsaoDe = (tabelas, opcoes = {}) => r.resumirPrevisao(tabelas, { agora: AGORA_PREVISAO, ...opcoes });
const doMes = (previsao, mes) => previsao.meses.find(m => m.mes === mes);

test('previsão da amostra real: cada parcela no mês do seu vencimento, com as somas feitas à mão', () => {
  const previsao = previsaoDe(amostra());

  // [mês, valor, parcelas, pedidos] — só os meses que têm parcela.
  assert.deepEqual(previsao.meses.filter(m => m.parcelas).map(m => [m.mes, m.valor, m.parcelas, m.pedidos]), [
    // ago/26: 3.327,01 (90, 1 de 6) + 3.326,51 (91, 1 de 6)
    ['2026-08', 6653.52, 2, 2],
    // set/26: 12.774,28 (95, à vista) + 2.700,53 (93) + 3.327,01 (90) + 3.326,51 (91) + 1.891,55 (92)
    ['2026-09', 24019.88, 5, 5],
    // out/26: 1.731,30 + 1.731,29 + 1.731,29 (96, as três) + 2 × 3.490,55 (98) + 2 × 2.006,68 (99)
    //         + 1.891,54 (92) + 3.327,01 (90) + 3.326,51 (91) = 24.733,40 em 10 parcelas de 6 pedidos
    ['2026-10', 24733.4, 10, 6],
    // nov/26: 3.490,54 (98, 3 de 3) + 3.327,01 (90) + 3.326,51 (91)
    ['2026-11', 10144.06, 3, 3],
    ['2026-12', 6653.52, 2, 2],
    ['2027-01', 6653.52, 2, 2]
  ]);
  // Da janela de vendas (out/25) até o último vencimento (jan/27), com zero no meio.
  assert.equal(previsao.meses.length, 16);
  assert.equal(previsao.meses[0].mes, '2025-10');
  assert.equal(previsao.meses.at(-1).mes, '2027-01');
  assert.deepEqual(doMes(previsao, '2026-07'), { mes: '2026-07', valor: 0, parcelas: 0, pedidos: 0, outros: 0, itens: [] });

  // De set/26 em diante: 78.857,90 (tudo) − 6.653,52 (agosto, já passou) = 72.204,38.
  assert.equal(previsao.programadoDesteMes, 72204.38);
  assert.deepEqual(previsao.alemDoHorizonte, { valor: 0, parcelas: 0, ate: null });
  assert.deepEqual(previsao.semParcelas, { pedidos: 0, valor: 0 });
  assert.equal(previsao.orfas, 0);
  assert.equal(previsao.semData, 0);

  // Nada se perde: as barras verdes somam o valor_final dos 8 pedidos.
  const totalDasBarras = previsao.meses.reduce((s, m) => s + m.valor, 0);
  const totalDosPedidos = pedidosDaAmostra().reduce((s, p) => s + Number(p.valor_final), 0);
  assert.equal(Math.round(totalDasBarras * 100), Math.round(totalDosPedidos * 100));
});

test('os 12 primeiros meses da previsão são exatamente os de serie12m', () => {
  // As barras de ouro e as verdes dividem o eixo: um mês de diferença as
  // desencontraria na tela inteira.
  const tabelas = amostra();
  const vendas = r.resumirVendas(tabelas, { agora: AGORA_PREVISAO });
  assert.deepEqual(previsaoDe(tabelas).meses.slice(0, 12).map(m => m.mes), vendas.serie12m.map(m => m.mes));
});

test('out/26 agrupa por pedido: as três parcelas do 96 num item só, na ordem do vencimento', () => {
  // Entrada de trás para frente: a ordem tem de vir da conta, não do banco.
  const outubro = doMes(previsaoDe({ ...amostra(), pedido_parcelas: [...PARCELAS_REAIS].reverse() }), '2026-10');

  assert.equal(outubro.outros, 0);
  // Ordem do 1º vencimento no mês; no empate do dia 10 (98 e 99), o número do pedido.
  assert.deepEqual(outubro.itens.map(i => [i.pedidoId, i.numero, i.cliente, i.totalParcelas, i.valor]), [
    [96, 'PED105', 'Vetri', 3, 5193.88],
    [98, 'PED107', 'Móveis Aurora', 3, 6981.1],
    [99, 'PED108', '—', 2, 4013.36],
    [92, 'PED101', 'Vetri', 2, 1891.54],
    [90, 'PED99', 'Móveis Aurora', 6, 3327.01],
    [91, 'PED100', 'Casa Bela Decorações ME', 6, 3326.51]
  ]);
  assert.deepEqual(outubro.itens[0], {
    pedidoId: 96, numero: 'PED105', cliente: 'Vetri', totalParcelas: 3, valor: 5193.88, estimada: false,
    parcelas: [
      { numero: 1, vencimento: '2026-10-02', valor: 1731.3 },
      { numero: 2, vencimento: '2026-10-16', valor: 1731.29 },
      { numero: 3, vencimento: '2026-10-30', valor: 1731.29 }
    ]
  });
  // "parcela 3 de 6": o total é o do pedido, não o do mês.
  assert.deepEqual(outubro.itens[4].parcelas, [{ numero: 3, vencimento: '2026-10-20', valor: 3327.01 }]);
});

test('pedido cancelado não será faturado: as parcelas dele somem da previsão, sem virar órfãs', () => {
  const previsao = previsaoDe(amostra({ 99: { situacao: 'Cancelado' } }));
  const outubro = doMes(previsao, '2026-10');

  // out/26 sem as duas de 2.006,68: 24.733,40 − 4.013,36.
  assert.deepEqual([outubro.valor, outubro.parcelas, outubro.pedidos], [20720.04, 8, 5]);
  assert.equal(previsao.meses.some(m => m.itens.some(i => i.pedidoId === 99)), false);
  assert.equal(previsao.programadoDesteMes, 68191.02); // 72.204,38 − 4.013,36
  assert.equal(previsao.orfas, 0, 'o pedido existe: a parcela dele não é órfã, só não conta');
  assert.deepEqual(previsao.semParcelas, { pedidos: 0, valor: 0 }, 'e cancelado não vira estimado');

  // Qualquer grafia de "Cancelado" vale.
  const minusculo = previsaoDe(amostra({ 93: { situacao: ' cancelado ' } }));
  assert.equal(doMes(minusculo, '2026-09').valor, 21319.35); // 24.019,88 − 2.700,53
});

test('pedido sem parcela entra uma vez, estimado, no dia em São Paulo da emissão', () => {
  const tabelas = {
    pedidos: [
      // 01:30Z do dia 1 é 22h30 do dia 31 em São Paulo: venda de agosto — e previsão de agosto.
      { id: 200, numero: 'PED200', cliente_id: 50, situacao: 'Entregue', valor_final: '1.500,00', data_emissao: '2026-09-01T01:30:00.000Z' },
      // Sem emissão não há dia: fica fora das barras, mas contado.
      { id: 201, numero: 'PED201', situacao: 'Produção', valor_final: 700, data_emissao: null },
      // Cancelado sem parcela: não será faturado, nem estimado.
      { id: 202, numero: 'PED202', situacao: 'Cancelado', valor_final: 999, data_emissao: '2026-09-02T15:00:00.000Z' }
    ],
    pedido_parcelas: [],
    clientes: CLIENTES_DA_AMOSTRA
  };
  const previsao = previsaoDe(tabelas);
  const agosto = doMes(previsao, '2026-08');

  assert.deepEqual(agosto.itens, [{
    pedidoId: 200, numero: 'PED200', cliente: 'Vetri', totalParcelas: 1, valor: 1500, estimada: true,
    parcelas: [{ numero: 1, vencimento: '2026-08-31', valor: 1500 }]
  }]);
  assert.deepEqual(previsao.semParcelas, { pedidos: 2, valor: 2200 });
  assert.equal(previsao.semData, 1, 'o pedido sem emissão não some calado');
  // Sem parcela, a barra verde é igual à de ouro, no mesmo mês.
  const vendas = r.resumirVendas(tabelas, { agora: AGORA_PREVISAO });
  assert.equal(vendas.serie12m.find(m => m.mes === '2026-08').valor, agosto.valor);
});

test('vencimento DATE à meia-noite UTC continua no dia e no mês dele', () => {
  const previsao = previsaoDe({
    pedidos: [{ id: 1, numero: 'PED1', situacao: 'Produção', valor_final: 300 }],
    pedido_parcelas: [
      // Pelo new Date() em São Paulo esta seria 30/09 — e iria para setembro.
      { id: 1, pedido_id: 1, numero_parcela: 1, valor: 200, data_vencimento: '2026-10-01T00:00:00.000Z' },
      { id: 2, pedido_id: 1, numero_parcela: 2, valor: 100, data_vencimento: '2026-10-02T00:00:00.000Z' }
    ]
  });

  assert.equal(doMes(previsao, '2026-09').valor, 0);
  assert.deepEqual(doMes(previsao, '2026-10').itens[0].parcelas, [
    { numero: 1, vencimento: '2026-10-01', valor: 200 },
    { numero: 2, vencimento: '2026-10-02', valor: 100 }
  ]);
});

test('a janela vai até o último vencimento, no máximo 12 meses à frente; o resto vai para além do horizonte', () => {
  const comParcelas = (...vencimentos) => previsaoDe({
    pedidos: [{ id: 1, numero: 'PED1', situacao: 'Produção', valor_final: 0 }],
    pedido_parcelas: vencimentos.map(([data, valor], i) => ({
      id: i + 1, pedido_id: 1, numero_parcela: i + 1, valor, data_vencimento: data
    }))
  });
  const semBuraco = meses => meses.every((m, i) => i === 0 || m.mes === r.deslocarMes(meses[i - 1].mes, 1));

  // Nada no futuro: os mesmos 12 meses de vendas, e só.
  const soPassado = comParcelas(['2026-09-20', 100]);
  assert.equal(soPassado.meses.length, 12);
  assert.equal(soPassado.meses.at(-1).mes, '2026-09');

  // Último vencimento em mar/27: a janela para lá, com os meses do meio em zero.
  const ateMarco = comParcelas(['2026-09-20', 100], ['2027-03-10', 50]);
  assert.equal(ateMarco.meses.length, 18);
  assert.equal(ateMarco.meses.at(-1).mes, '2027-03');
  assert.ok(semBuraco(ateMarco.meses));
  assert.equal(doMes(ateMarco, '2026-12').valor, 0);
  assert.deepEqual(ateMarco.alemDoHorizonte, { valor: 0, parcelas: 0, ate: null });

  // Parcelamento que passa de set/27 (mês atual + 12): o gráfico para em set/27
  // e o resto aparece somado, com o último mês — nada é cortado calado.
  const longo = comParcelas(
    ['2025-09-30', 999], // antes da janela: histórico, fora de tudo
    ['2026-09-20', 100],
    ['2027-09-30', 10], // exatamente no teto: dentro
    ['2027-10-01', 20],
    ['2028-02-15', 30]
  );
  assert.equal(longo.meses.length, 24);
  assert.equal(longo.meses[0].mes, '2025-10');
  assert.equal(longo.meses.at(-1).mes, '2027-09');
  assert.ok(semBuraco(longo.meses));
  assert.equal(doMes(longo, '2027-09').valor, 10);
  assert.deepEqual(longo.alemDoHorizonte, { valor: 50, parcelas: 2, ate: '2028-02' });
  // Programado de set/26 em diante: 100 + 10 no gráfico + 50 além dele. O 999 é passado.
  assert.equal(longo.programadoDesteMes, 160);
  assert.equal(longo.meses.reduce((s, m) => s + m.parcelas, 0), 2, 'a de set/25 não entra em mês nenhum');
});

test('o mês lista até oito pedidos, em ordem natural de número; os outros viram contagem e o total fica inteiro', () => {
  // PED1 … PED10 no mesmo dia, embaralhados. Em ordem de texto puro o PED10
  // viria logo depois do PED1.
  const ordem = [7, 10, 2, 5, 1, 9, 3, 8, 6, 4];
  const outubro = doMes(previsaoDe({
    pedidos: ordem.map(n => ({ id: 500 + n, numero: `PED${n}`, situacao: 'Produção', valor_final: n * 100 })),
    pedido_parcelas: ordem.map(n => ({ id: n, pedido_id: 500 + n, numero_parcela: 1, valor: n * 100, data_vencimento: '2026-10-05' }))
  }), '2026-10');

  assert.deepEqual(outubro.itens.map(i => i.numero), ['PED1', 'PED2', 'PED3', 'PED4', 'PED5', 'PED6', 'PED7', 'PED8']);
  assert.equal(outubro.outros, 2);
  assert.equal(outubro.pedidos, 10);
  assert.equal(outubro.parcelas, 10);
  assert.equal(outubro.valor, 5500, 'a lista corta em oito; a soma do mês, não');
});

test('parcela órfã e parcela sem data não entram nas barras, mas são contadas', () => {
  const previsao = previsaoDe({
    pedidos: [
      { id: 1, numero: 'PED1', situacao: 'Produção', valor_final: 500 },
      { id: 2, numero: 'PED2', situacao: 'Cancelado', valor_final: 80 }
    ],
    pedido_parcelas: [
      { id: 10, pedido_id: 1, numero_parcela: 1, valor: 100, data_vencimento: '2026-10-10' },
      { id: 11, pedido_id: 1, numero_parcela: 2, valor: 100, data_vencimento: null },
      { id: 12, pedido_id: 1, numero_parcela: 3, valor: 100, data_vencimento: '' },
      { id: 13, pedido_id: 1, numero_parcela: 4, valor: 100, data_vencimento: 'a combinar' },
      // Passa no corte de texto, mas o dia não existe: iria para um fevereiro inventado.
      { id: 14, pedido_id: 1, numero_parcela: 5, valor: 100, data_vencimento: '2026-02-30' },
      // Órfãs: pedido que não está na tabela, e parcela sem pedido.
      { id: 15, pedido_id: 777, numero_parcela: 1, valor: 900, data_vencimento: '2026-10-10' },
      { id: 16, pedido_id: null, numero_parcela: 1, valor: 900, data_vencimento: '2026-10-10' },
      // De pedido cancelado: nem soma nem é órfã.
      { id: 17, pedido_id: 2, numero_parcela: 1, valor: 80, data_vencimento: '2026-10-10' }
    ]
  });
  const outubro = doMes(previsao, '2026-10');

  assert.equal(previsao.orfas, 2);
  assert.equal(previsao.semData, 4);
  assert.deepEqual([outubro.valor, outubro.parcelas, outubro.pedidos], [100, 1, 1]);
  // "parcela 1 de 5": as sem data continuam sendo parcelas do pedido.
  assert.equal(outubro.itens[0].totalParcelas, 5);
});

test('parcela sem número gravado leva a posição na ordem de vencimento', () => {
  const previsao = previsaoDe({
    pedidos: [{ id: 1, numero: 'PED1', situacao: 'Produção', valor_final: 300 }],
    pedido_parcelas: [
      { id: 2, pedido_id: 1, numero_parcela: null, valor: 200, data_vencimento: '2026-11-10' },
      { id: 1, pedido_id: 1, valor: 100, data_vencimento: '2026-10-10' }
    ]
  });

  assert.deepEqual(doMes(previsao, '2026-10').itens[0].parcelas, [{ numero: 1, vencimento: '2026-10-10', valor: 100 }]);
  assert.deepEqual(doMes(previsao, '2026-11').itens[0].parcelas, [{ numero: 2, vencimento: '2026-11-10', valor: 200 }]);
});

test('o cliente da previsão só sai com a coluna Cliente de Pedidos; o número do pedido sai sempre', () => {
  const semColuna = previsaoDe(amostra(), { pode: chave => chave !== 'col_ped_cliente' }).meses.flatMap(m => m.itens);
  assert.ok(semColuna.length > 0);
  assert.ok(semColuna.every(i => i.cliente === null), 'null, e não "—": "—" diz que o cadastro está vazio');
  assert.ok(semColuna.every(i => typeof i.numero === 'string' && i.numero));

  // Com a coluna, mas sem a tabela de clientes (a leitura falhou): travessão.
  const semTabela = previsaoDe({ ...amostra(), clientes: undefined }).meses.flatMap(m => m.itens);
  assert.ok(semTabela.every(i => i.cliente === '—'));
});

test('sem pedido nenhum, a previsão traz os 12 meses zerados e nada fora deles', () => {
  const { meses, ...resto } = previsaoDe({});
  assert.equal(meses.length, 12);
  assert.ok(meses.every(m => m.valor === 0 && m.parcelas === 0 && m.itens.length === 0));
  assert.deepEqual(resto, {
    programadoDesteMes: 0,
    alemDoHorizonte: { valor: 0, parcelas: 0, ate: null },
    semParcelas: { pedidos: 0, valor: 0 },
    orfas: 0,
    semData: 0
  });
});
