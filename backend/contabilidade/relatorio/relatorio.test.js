/**
 * Contabilidade — etapa 8: as partes puras do relatório mensal (livro-caixa,
 * observação, partidas, a nota da situação), o HTML do PDF, a planilha e a
 * montagem do dossiê.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const r = require('./relatorio');
const documento = require('./documento');
const planilha = require('./planilha');
const dossie = require('./dossie');

const semNbsp = t => String(t).replace(/ /g, ' ');
const lin = (id, data, valor, extra = {}) => ({ id, data, valor, descricao: `Lançamento ${id}`, conta_plano: null, observacao: null, vencimento: null, estado: 'pendente', estado_rotulo: 'A conciliar', ...extra });

test('livro-caixa: saldo inicial pelo saldo que o banco informou, saldo linha a linha, total do dia e do período', () => {
  const livro = r.livroDaConta({
    conta: { id: 1, nome: 'BB — conta corrente', tipo: 'corrente' },
    linhas: [lin(3, '2026-08-31', -12.9), lin(2, '2026-08-11', 3700), lin(6, '2026-08-05', 100), lin(1, '2026-08-05', -2500)],
    saldoBanco: { valor: 5000, data: '2026-08-11' }
  });
  assert.equal(livro.saldo_conhecido, true);
  assert.equal(livro.saldo_inicial, 3700, '5.000 no dia 11 menos o que entrou e saiu até ele (1.300)');
  assert.deepEqual(livro.linhas.map(l => [l.id, l.debito, l.credito, l.saldo]), [[1, 2500, null, 1200], [6, null, 100, 1300], [2, null, 3700, 5000], [3, 12.9, null, 4987.1]]);
  assert.deepEqual(livro.dias.map(d => [d.data, d.quantidade, d.entradas, d.saidas, d.saldo]), [['2026-08-05', 2, 100, -2500, 1300], ['2026-08-11', 1, 3700, 0, 5000], ['2026-08-31', 1, 0, -12.9, 4987.1]]);
  assert.deepEqual(livro.totais, { quantidade: 4, entradas: 3800, saidas: -2512.9, resultado: 1287.1 });
  assert.equal(livro.saldo_final, 4987.1);

  const semSaldo = r.livroDaConta({ conta: { id: 1, nome: 'Caixa' }, linhas: [lin(1, '2026-08-05', -50), lin(2, '2026-08-06', 80)] });
  assert.deepEqual([semSaldo.saldo_conhecido, semSaldo.saldo_inicial, semSaldo.saldo_final, semSaldo.linhas.map(l => l.saldo)], [false, null, null, [-50, 30]], 'sem o saldo do banco: o acumulado do mês');
});

test('livro-caixa (19b, fase A): o saldo de abertura digitado vale primeiro e é conferido com o do banco', () => {
  const linhas = [lin(1, '2026-08-05', -2500), lin(2, '2026-08-11', 3700)];
  const bate = r.livroDaConta({ conta: { id: 1, nome: 'BB' }, linhas, saldoBanco: { valor: 5000, data: '2026-08-11' }, abertura: { valor: 3800, data: '2026-07-31' } });
  assert.deepEqual([bate.saldo_origem, bate.saldo_inicial, bate.saldo_final, bate.abertura], ['digitado', 3800, 5000, { valor: 3800, data: '2026-07-31' }]);
  assert.deepEqual(bate.conferencia, { data: '2026-08-11', banco: 5000, livro: 5000, diferenca: 0 });
  const naoBate = r.livroDaConta({ conta: { id: 1, nome: 'BB' }, linhas, saldoBanco: { valor: 5000, data: '2026-08-11' }, abertura: { valor: 3700, data: '2026-07-31' } });
  assert.deepEqual([naoBate.saldo_inicial, naoBate.conferencia.livro, naoBate.conferencia.diferenca], [3700, 4900, -100]);
  const soDigitado = r.livroDaConta({ conta: { id: 1, nome: 'BB' }, linhas, abertura: { valor: 100, data: '2026-07-31' } });
  assert.deepEqual([soDigitado.saldo_conhecido, soDigitado.saldo_origem, soDigitado.conferencia, soDigitado.saldo_final], [true, 'digitado', null, 1300]);
});

test('saldo no fim do dia (19b): anda para a frente e para trás a partir do saldo conhecido', () => {
  const extrato = require('../extrato/extrato');
  const movs = [{ data: '2026-09-05', valor: 700 }, { data: '2026-09-10', valor: -250 }, { data: '2026-10-02', valor: 50 }];
  assert.equal(extrato.saldoNoFimDoDia({ valor: 1000, data: '2026-08-31' }, movs, '2026-09-30'), 1450);
  assert.equal(extrato.saldoNoFimDoDia({ valor: 1000, data: '2026-08-31' }, movs, '2026-08-31'), 1000);
  assert.equal(extrato.saldoNoFimDoDia({ valor: 1500, data: '2026-10-02' }, movs, '2026-09-05'), 1700, 'para trás: desfaz o que veio depois do dia (−250 + 50)');
  assert.deepEqual(extrato.saldoDigitado({ saldo_inicial: '1234.5', saldo_inicial_data: '2026-08-31T00:00:00.000Z' }), { valor: 1234.5, data: '2026-08-31' });
  assert.equal(extrato.saldoDigitado({ saldo_inicial: null, saldo_inicial_data: '2026-08-31' }), null);
  assert.deepEqual(extrato.conferirSaldo({ saldo_inicial: 1000, saldo_inicial_data: '2026-08-31' }, movs, { valor: 1500, data: '2026-09-30' }), { data: '2026-09-30', banco: 1500, livro: 1450, diferenca: -50 });
});

test('observação: de quem é o dinheiro, justificativa do ignorado, a conciliar e a escolha à mão', () => {
  const liqs = new Map([
    ['titulo_pagamento:101', { rotulo: 'Aluguel de agosto · parcela 1/12', nome: 'Imobiliária Centro' }],
    ['recebimento:1', { rotulo: 'Pedido 2540 · parcela 1', nome: 'Casa Vicenzo' }],
    ['recebimento:2', { rotulo: 'Pedido 2541 · parcela 1', nome: 'Loja Sul' }],
    ['recebimento:3', { rotulo: 'Pedido 2542 · parcela 2', nome: 'Ateliê' }],
    ['recebimento:4', { rotulo: 'Pedido 2543 · parcela 1', nome: 'Vila' }]
  ]);
  const v = (tipo, id, extra = {}) => ({ alvo_tipo: tipo, alvo_id: id, ...extra });
  assert.equal(r.observacaoDe({ vinculos: [v('titulo_pagamento', 101)], liqsPorChave: liqs, estado: 'conciliado' }), 'Imobiliária Centro — Aluguel de agosto · parcela 1/12');
  assert.equal(r.observacaoDe({ vinculos: [1, 2, 3, 4].map(i => v('recebimento', i)), liqsPorChave: liqs, estado: 'conciliado' }),
    'Casa Vicenzo — Pedido 2540 · parcela 1 + Loja Sul — Pedido 2541 · parcela 1 + Ateliê — Pedido 2542 · parcela 2 e mais 1');
  assert.equal(r.observacaoDe({ vinculos: [v('recebimento', 1, { desfeito_em: '2026-08-20' })], liqsPorChave: liqs, estado: 'pendente', contrapartida: '84.031.759/0001-21' }), 'A conciliar · CNPJ/CPF 84.031.759/0001-21', 'o desfeito não conta');
  assert.equal(r.observacaoDe({ estado: 'ignorado', observacaoConciliacao: 'Transferência entre contas nossas' }), 'Ignorado: Transferência entre contas nossas');
  assert.equal(r.observacaoDe({ vinculos: [v('titulo_pagamento', 101)], liqsPorChave: liqs, estado: 'conciliado', manual: { observacao: 'contrato 12/2026' } }), 'Imobiliária Centro — Aluguel de agosto · parcela 1/12 · contrato 12/2026');
  assert.equal(r.observacaoDe({ vinculos: [v('reembolso', 9)], estado: 'conciliado' }), 'Reembolso 9', 'liquidação que sumiu: o tipo e o id');
  assert.equal(r.vencimentoDe([v('titulo_pagamento', 101), v('recebimento', 1)], new Map([['titulo_pagamento:101', '2026-08-10'], ['recebimento:1', '2026-08-05']])), '2026-08-05');
  assert.equal(r.vencimentoDe([], new Map()), null);
});

test('partidas: duas linhas por lançamento (banco × conta do plano), somando zero', () => {
  const livro = r.livroDaConta({ conta: { id: 1, nome: 'BB — conta corrente' }, linhas: [lin(1, '2026-08-05', -2500, { conta_plano: 'Serviços de Terceiros', observacao: 'Imobiliária Centro', numero: '123' }), lin(2, '2026-08-11', 3700)] });
  const p = r.partidasDe([livro]);
  assert.deepEqual(p.map(x => [x.lado, x.conta, x.valor]), [['banco', '[BB — conta corrente]', -2500], ['plano', 'Serviços de Terceiros', 2500], ['banco', '[BB — conta corrente]', 3700], ['plano', 'Sem classificação', -3700]]);
  assert.equal(p[1].descricao, 'Imobiliária Centro');
  assert.equal(p[0].numero, '123');
  // Fase B: com o plano da AEA, o banco é a conta dele (00008) e o outro lado vem com o código reduzido.
  const aea = r.livroDaConta({
    conta: { id: 1, nome: 'BB — conta corrente' }, contaPlano: '00008 · Banco do Brasil',
    linhas: [lin(3, '2026-09-08', -2800, { conta_plano: '00476 · Serv de Terc. PJ' })]
  });
  assert.deepEqual(r.partidasDe([aea]).map(x => [x.lado, x.conta, x.valor]), [['banco', '00008 · Banco do Brasil [BB — conta corrente]', -2800], ['plano', '00476 · Serv de Terc. PJ', 2800]]);
  assert.equal(aea.conta_plano, '00008 · Banco do Brasil');
  const res = r.resultadoComRotulos({ resultado: 0, por_conta: [{ conta_id: 9, conta: 'Serv de Terc. PJ', conta_codigo: '00476', tipo: 'despesa', resultado: -2800 }] });
  assert.equal(res.por_conta[0].conta, '00476 · Serv de Terc. PJ');
});

test('nota da situação: fechada com versão, fechada antes das versões, prévia', () => {
  assert.equal(r.notaDaSituacao({ status: 'fechada', versao: 2, fechadaEm: '2026-09-05T10:30:00-03:00', fechadaPor: 'Henrique', diferencas: 1 }),
    'Competência fechada em 05/09/2026 às 10:30 por Henrique — versão 2. Os números são os da foto do fechamento. Há 1 diferença desde o fechamento (veja o Histórico dos fechamentos).');
  assert.match(r.notaDaSituacao({ status: 'fechada' }), /antes das versões/);
  assert.equal(r.notaDaSituacao({ status: 'reaberta' }), 'PRÉVIA — a competência está reaberta: os números ainda podem mudar.');
  assert.equal(r.notaDaSituacao({ status: 'aberta', encerrada: false }), 'PRÉVIA — a competência está aberta: os números ainda podem mudar. O mês ainda está em curso.');
  assert.equal(r.nomeDoArquivo({ competencia: '2026-08', situacao: { versao: 2 } }), 'contabilidade-2026-08-relatorio-v2');
  assert.equal(r.nomeDoArquivo({ competencia: '2026-08', situacao: { versao: null } }), 'contabilidade-2026-08-relatorio-previa');
});

/** Um relatório pequeno, como o montar devolve. */
function relatorioDeExemplo({ previa = true } = {}) {
  const livro = r.livroDaConta({
    conta: { id: 1, nome: 'BB — conta corrente', tipo: 'corrente' },
    linhas: [
      lin(1, '2026-08-05', -2500, { conta_plano: 'Serviços de Terceiros', observacao: 'Imobiliária Centro — Aluguel', vencimento: '2026-08-05', estado: 'conciliado', estado_rotulo: 'Conciliado' }),
      lin(2, '2026-08-05', 1850, { descricao: 'PIX <script>alert(1)</script>' }),
      lin(3, '2026-08-11', 3700, { conta_plano: 'Receita de vendas' })
    ],
    saldoBanco: { valor: 10000, data: '2026-08-31' }, completo: true
  });
  const resultado = r.resultadoComRotulos({
    receitas: 3700, deducoes: 0, custos: 0, despesas: -2500, resultado: 1200, fora_do_resultado: 0, sem_classificacao: 1850,
    por_conta: [
      { conta_id: 1, conta: 'Receita de vendas', tipo: 'receita', entradas: 3700, saidas: 0, resultado: 3700, quantidade: 1 },
      { conta_id: 2, conta: 'Serviços de Terceiros', tipo: 'despesa', entradas: 0, saidas: -2500, resultado: -2500, quantidade: 1 },
      { conta_id: null, conta: 'Sem classificação', tipo: null, entradas: 1850, saidas: 0, resultado: 1850, quantidade: 1 }
    ]
  });
  return {
    competencia: '2026-08', rotulo: 'agosto/2026', gerado_em: '2026-09-29T10:00:00-03:00', empresa: { nome: 'Santíssimo Decor', razao_social: 'Santíssimo Decor Ltda', cnpj: '11.444.777/0001-61' },
    situacao: { status: previa ? 'aberta' : 'fechada', rotulo: previa ? 'Aberta' : 'Fechada', versao: previa ? null : 1, previa, diferencas: 0, diferencas_lista: [], nota: previa ? 'PRÉVIA — a competência está aberta: os números ainda podem mudar.' : 'Competência fechada — versão 1.' },
    resumo: {
      lancamentos: 3, sem_classificacao: 1,
      contas: [{ conta: livro.conta, saldo_inicial: livro.saldo_inicial, entradas: livro.totais.entradas, saidas: livro.totais.saidas, resultado: livro.totais.resultado, saldo_final: livro.saldo_final, saldo_banco: livro.saldo_banco, completo: true }],
      conciliacao: { conciliados: 1, ignorados: 0, a_conciliar: { quantidade: 2, total: 5550 }, sem_lancamento: 1 },
      pendencias: { critico: 0, documental: 1, aviso: 0, ignoradas: 1 }, documentos: { total: 1, falta: 1 }
    },
    livro: [livro], partidas: r.partidasDe([livro]), resultado,
    conciliacao: [{
      conta_id: 1, conta: 'BB — conta corrente', totais: { total: 3, conciliados: 1, ignorados: 0, a_conciliar: { quantidade: 2, total: 5550 } },
      a_conciliar: [{ id: 2, data: '2026-08-05', valor: 1850, descricao: 'PIX', sugestao: true }], ignorados: [], com_diferenca: [],
      sem_lancamento: [{ data: '2026-08-20', valor: -900, tipo: 'Comissão/produção', rotulo: 'Comissões de julho/2026 — Ana', nome: 'Ana', forma: 'Pix' }], cobertura: { completa: true, faltas: [] }
    }],
    pendencias: { origem: 'hoje', lista: [{ nivel: 'documental', nivel_rotulo: 'Pendência documental', titulo: 'NF-e sem XML', descricao: 'Vidros Norte', ignorada: false }, { nivel: 'aviso', nivel_rotulo: 'Aviso', titulo: 'Tarifa', ignorada: true, justificativa: 'Tarifa do pacote' }] },
    documentos: { itens: [{ grupo_rotulo: 'Recebido', data: '2026-08-03', titulo: 'NF-e 1/77', detalhe: 'Vidros Norte', valor: 540, falta: true, falta_rotulo: 'Sem o XML' }], totais: { total: 1, falta: 1 } },
    avisos: [], arquivo: previa ? 'contabilidade-2026-08-relatorio-previa' : 'contabilidade-2026-08-relatorio-v1'
  };
}

test('PDF: o HTML escapa o que vem do banco, marca a prévia e traz o livro-caixa com os totais', () => {
  const html = semNbsp(documento.html(relatorioDeExemplo()));
  assert.ok(!html.includes('<script>alert(1)</script>'), 'nada do banco vira HTML');
  assert.ok(html.includes('PIX &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.match(html, /<div class="marca">PRÉVIA<\/div>/);
  assert.match(html, /Relatório mensal — agosto\/2026/);
  assert.match(html, /Livro-caixa — BB — conta corrente/);
  assert.match(html, /Total do dia 05\/08/);
  assert.match(html, /Total do período/);
  assert.match(html, /Resultado do mês/);
  assert.match(html, /Registrado no app sem lançamento no extrato \(1\)/);
  assert.match(html, /Ignorada: Tarifa do pacote/);
  assert.match(html, /Sem o XML/);
  assert.match(html, /Documento interno gerado pelo App-Gestão/);
  const fechado = documento.html(relatorioDeExemplo({ previa: false }));
  assert.ok(!fechado.includes('class="marca"'), 'fechada: sem a marca de prévia');
  assert.match(fechado, /Fechada · versão 1/);
});

test('planilha: as oito abas, datas do Excel e valores em número', async () => {
  const bytes = await planilha.gerar(relatorioDeExemplo());
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(bytes);
  assert.deepEqual(livro.worksheets.map(w => w.name), ['Resumo', 'Livro-caixa', 'Partidas', 'Lançamentos', 'Resultado', 'Conciliação', 'Pendências', 'Documentos']);
  const lanc = livro.getWorksheet('Lançamentos');
  assert.equal(lanc.rowCount, 4, 'cabeçalho + 3 lançamentos');
  const primeira = lanc.getRow(2);
  assert.equal(primeira.getCell(2).value.toISOString().slice(0, 10), '2026-08-05', 'data de verdade, sem andar com o fuso');
  assert.equal(primeira.getCell(5).value, -2500);
  assert.equal(primeira.getCell(5).numFmt, planilha.MOEDA);
  assert.equal(primeira.getCell(6).value, 'Serviços de Terceiros');
  const livroCaixa = livro.getWorksheet('Livro-caixa');
  const textos = [];
  livroCaixa.eachRow(row => textos.push(String(row.getCell(3).value ?? '')));
  assert.ok(textos.includes('Conta: BB — conta corrente'));
  assert.ok(textos.some(t => /^Total do dia \(2 lançamentos\)$/.test(t)));
  assert.ok(textos.some(t => /^Total do período \(3 lançamentos\)$/.test(t)));
  assert.equal(livro.getWorksheet('Partidas').rowCount, 7, 'duas linhas por lançamento');
  const conc = [];
  livro.getWorksheet('Conciliação').eachRow((row, n) => { if (n > 1) conc.push(row.getCell(2).value); });
  assert.deepEqual(conc, ['A conciliar', 'Registrado no app sem lançamento no extrato']);
});

test('dossiê do lançamento: banco, o que ele paga (com a conta), o desfeito, a conta do plano congelada e as escolhas à mão', () => {
  const d = dossie.dossieDoMovimento({
    m: { id: 1, data: '2026-08-05', valor: -2500, descricao: 'Pagamento de boleto', conta_id: 1, competencia: '2026-08', estado_conciliacao: 'conciliado', conciliado_em: '2026-09-01T09:00:00-03:00', conciliado_por: 3, documento: '000123', contrapartida_documento: '84031759000121' },
    conta: { id: 1, nome: 'BB — conta corrente' },
    importacao: { origem: 'ofx', nome_arquivo: 'agosto.ofx', criado_em: '2026-09-01T08:00:00-03:00' }, importadoPor: 'Henrique',
    vinculos: [
      { alvo_tipo: 'titulo_pagamento', alvo_id: 101, valor: 2500, criterio: 'sugestao' },
      { alvo_tipo: 'recebimento', alvo_id: 7, valor: 2500, criterio: 'manual', desfeito_em: '2026-08-30T10:00:00-03:00', motivo_desfazer: 'era outro' }
    ],
    liqsPorChave: new Map([['titulo_pagamento:101', { rotulo: 'Aluguel de agosto', nome: 'Imobiliária Centro', data: '2026-08-05', forma: 'Boleto' }]]),
    tituloDoPagamento: new Map([['101', { id: 1 }]]),
    congelada: { versao: 1, conta_id: 2, conta: 'Serviços de Terceiros' }, atual: { conta_id: 5, conta: 'Aquisição de Bens' },
    manuais: [{ conta: 'Serviços de Terceiros', observacao: 'aluguel', criado_em: '2026-08-31T10:00:00-03:00', criado_por: 'Henrique' }],
    nomes: new Map([['3', 'Henrique']]),
    arquivosLista: [{ id: 9, nome: 'boleto.pdf' }, { id: 9, nome: 'boleto.pdf' }], historico: [{ id: 1, rotulo: 'Lançamento conciliado' }]
  });
  assert.equal(semNbsp(d.titulo), 'Lançamento de 05/08/2026 · - R$ 2.500,00');
  const secao = chave => d.secoes.find(s => s.chave === chave);
  assert.deepEqual(secao('banco').linhas.find(([k]) => k === 'Veio de'), ['Veio de', 'OFX agosto.ofx · 01/09/2026 às 08:00 · Henrique']);
  assert.deepEqual(secao('banco').linhas.find(([k]) => k === 'CNPJ/CPF da contrapartida'), ['CNPJ/CPF da contrapartida', '84.031.759/0001-21']);
  assert.deepEqual(secao('conciliacao').ligacoes.map(l => [l.tipo, l.id, l.rotulo]), [['titulo', 1, 'Aluguel de agosto — Imobiliária Centro']]);
  assert.match(semNbsp(secao('conciliacao').ligacoes[0].detalhe), /Pagamento de conta · 05\/08\/2026 · R\$ 2\.500,00 · Boleto · sugestão aceita/);
  assert.ok(secao('conciliacao').linhas.some(([k, v]) => /^Desfeito em 30\/08\/2026/.test(k) && /era outro/.test(v)));
  assert.deepEqual(secao('classificacao').linhas.slice(0, 3), [['Conta do plano', 'Serviços de Terceiros'], ['Como', 'Congelada no fechamento (versão 1)'], ['Hoje seria', 'Aquisição de Bens']]);
  assert.match(secao('classificacao').linhas[3][1], /Serviços de Terceiros · "aluguel" · 31\/08\/2026 às 10:00 por Henrique/);
  assert.equal(d.arquivos.length, 1, 'arquivo repetido sai uma vez');
});

test('dossiê da conta e do documento: o banco de cada pagamento, o pagamento sem lançamento e as contas do documento', () => {
  const detalhe = {
    titulo: {
      id: 1, descricao: 'Aluguel de agosto', fornecedor: 'Imobiliária Centro', fornecedor_documento: null, categoria: 'Serviços de Terceiros', competencia: '2026-08', valor_total: 5000,
      situacao_rotulo: 'Paga em parte', origem: 'manual', parcelas: [
        { numero: 1, de: 2, vencimento: '2026-08-05', valor: 2500, situacao_rotulo: 'Paga', pagamento: { id: 101, data: '2026-08-05', valor_pago: 2500, forma: 'Boleto' }, estornos: [] },
        { numero: 2, de: 2, vencimento: '2026-09-05', valor: 2500, situacao_rotulo: 'Paga', pagamento: { id: 102, data: '2026-09-05', valor_pago: 2500, forma: 'Pix' }, estornos: [{ data: '2026-09-04', valor_pago: 2500, motivo_estorno: 'pago em dobro' }] }
      ]
    },
    documento: { id: 4, tipo: 'nfse', numero: '77', emitente: 'Imobiliária Centro', data_emissao: '2026-08-01', valor_total: 5000 },
    arquivos: [], historico: []
  };
  const conta = dossie.dossieDaConta({
    detalhe, movimentosDoPagamento: new Map([['101', [{ id: 1, data: '2026-08-05', valor: -2500, conta_id: 1, descricao: 'Pagamento de boleto', estado_conciliacao: 'conciliado' }]]]),
    contasBanco: new Map([['1', 'BB — conta corrente']])
  });
  const s = chave => conta.secoes.find(x => x.chave === chave);
  assert.deepEqual(s('banco').ligacoes.map(l => [l.tipo, l.id]), [['movimento', 1]]);
  assert.match(s('banco').ligacoes[0].detalhe, /BB — conta corrente · Pagamento de boleto · Conciliado/);
  assert.ok(s('parcelas').linhas.some(([k, v]) => k === 'Banco (parcela 2)' && /Sem lançamento/.test(v)));
  assert.ok(s('parcelas').linhas.some(([k, v]) => /\(estornado\)/.test(k) && /pago em dobro/.test(v)));
  assert.deepEqual(s('documento').ligacoes.map(l => [l.tipo, l.id, l.rotulo]), [['documento', 4, 'NFS-e 77']]);

  const doc = dossie.dossieDoDocumento({
    detalhe: { documento: { id: 4, rotulo: 'NFS-e 77', tipo_rotulo: 'NFS-e', numero: '77', emitente: 'Imobiliária Centro', data_emissao: '2026-08-01', competencia: '2026-08', valor_total: 5000, itens: [], falta_arquivo: true }, arquivos: [], historico: [] },
    contas: [{ id: 1, descricao: 'Aluguel de agosto', valor_total: 5000, categoria: 'Serviços de Terceiros', status: 'aberto' }],
    movimentos: [{ id: 1, data: '2026-08-05', valor: -2500, conta_id: 1, estado_conciliacao: 'conciliado' }]
  });
  assert.deepEqual(doc.secoes.find(x => x.chave === 'contas').ligacoes.map(l => [l.tipo, l.id]), [['titulo', 1]]);
  assert.deepEqual(doc.secoes.find(x => x.chave === 'banco').ligacoes.map(l => [l.tipo, l.id]), [['movimento', 1]]);
  assert.ok(doc.secoes[0].linhas.some(([k, v]) => k === 'Falta' && v === 'o arquivo do documento'));
  const deFechamento = dossie.dossieDoDocumento({
    detalhe: { documento: { id: 5, rotulo: 'NFS-e 9', itens: [], financeiro_pagamento: { rotulo: 'Comissões de julho/2026 — Ana', valor: 900, data: '2026-08-15' } }, arquivos: [], historico: [] }
  });
  assert.match(semNbsp(deFechamento.secoes.find(x => x.chave === 'contas').vazio), /Prova o pagamento Comissões de julho\/2026 — Ana \(R\$ 900,00 em 15\/08\/2026\)/);
});
