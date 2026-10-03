/**
 * Fase G (02/10/2026) — o cartão de crédito do BB pela fatura em XLSX: as
 * partes puras.
 *
 * O que fica preso:
 *   - a leitura da fatura no layout do BB: cabeçalho, saldo anterior,
 *     pagamento, compras, encargo, estorno, supermercados, parceladas ("PARC
 *     03/10", a data da compra), o ano de cada data (a parcela que vem do ano
 *     anterior), as conferências (e a que não fecha), o número do cartão que
 *     não é guardado; o XLSX de verdade (exceljs);
 *   - a situação de cada compra (nota, recibo, sem nota, abaixo do limite, de
 *     antes do início, falta) e o casamento das notas: o mesmo valor, a compra
 *     inteira da parcelada (com o arredondamento), a emissão perto do dia; a
 *     dúvida (duas notas) e a nota com conta a pagar só à mão; as parcelas
 *     herdam a nota;
 *   - as pendências: a fatura do mês a importar (aviso no mês em curso,
 *     crítico depois), a que não fecha, as compras sem nota (crítico), as de
 *     antes do início e a fatura sem o pagamento (avisos);
 *   - a liquidação da fatura, a classificação pela origem "cartao" e a pasta
 *     do pacote com as notas das compras.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const leitura = require('./leitura');
const cartao = require('./cartao');
const { linhasDaFatura, xlsxDaFatura, desc, parc } = require('./faturasDeTeste');
const liquidacoes = require('../conciliacao/liquidacoes');
const classificacao = require('../classificacao/classificacao');
const pagamentos = require('../pacote/pagamentos');

test('a leitura da fatura do BB: cabeçalho, seções, parceladas com a data da compra, o ano de cada data, as conferências e o cartão que não é guardado', async () => {
  const f = leitura.analisarLinhas(linhasDaFatura());
  assert.deepEqual([f.titular, f.cartao_final, f.vencimento, f.competencia, f.valor_total, f.saldo_anterior, f.limite, f.confere], ['EMPRESA TESTE LTDA', '9876', '2026-09-12', '2026-09', 616.6, 1000, 10000, true]);
  assert.deepEqual(f.lancamentos.map(l => [l.tipo, l.data, l.descricao, l.cidade, l.valor, l.parcela_numero, l.parcela_total, l.valor_compra, l.secao]), [
    ['pagamento', '2026-08-12', 'PGTO. COBRANCA 4700 000000200 2003', null, -1000, null, null, -1000, 'Pagamentos/Créditos'],
    ['compra', '2026-08-15', 'PADARIA PAO QUENTE', 'BELO HORIZONT', 18.5, null, null, 18.5, 'Compras'],
    ['compra', '2026-08-20', 'KALUNGA LOJA 12', 'CONTAGEM', 320, null, null, 320, 'Compras'],
    ['compra', '2026-09-02', 'LEROY MERLIN BH', 'BELO HORIZONT', 150, null, null, 150, 'Compras'],
    ['encargo', '2026-09-05', 'IOF COMPRA EXTERIOR', null, 3.2, null, null, 3.2, 'Compras'],
    ['credito', '2026-09-06', 'ESTORNO KALUNGA', 'CONTAGEM', -20, null, null, -20, 'Compras'],
    ['compra', '2026-08-25', 'SUPERMERCADO BH', 'CONTAGEM', 45, null, null, 45, 'Supermercados'],
    ['compra', '2026-06-10', 'TOK STOK', 'BELO HORIZON', 99.9, 3, 10, 999, 'Compras parceladas']
  ]);
  assert.deepEqual(f.conferencias.map(x => [x.chave, x.ok]), [['total', true], ['subtotal_1', true], ['subtotal_2', true], ['total_linha', true]]);
  assert.equal(JSON.stringify(f.linhas).includes('4984123412349876'), false, 'o número inteiro do cartão não é guardado');
  assert.ok(JSON.stringify(f.linhas).includes('**** **** **** 9876'));
  // A que não fecha: o total do cabeçalho errado.
  const errada = leitura.analisarLinhas(linhasDaFatura({ total: 700 }));
  assert.deepEqual([errada.confere, errada.conferencias.filter(x => !x.ok).map(x => x.chave)], [false, ['total']]);
  // O ano: venc. em fevereiro, compra de dezembro é do ano anterior; a parcela 05/10 de setembro também.
  assert.equal(leitura.dataDaFatura('20/12', '2027-02-12'), '2026-12-20');
  assert.equal(leitura.dataDaFatura('10/09', '2027-02-12', 5), '2026-09-10');
  assert.equal(leitura.dataDaFatura('10/01', '2027-02-12'), '2027-01-10');
  assert.deepEqual([leitura.dinheiro('4.394,90'), leitura.dinheiro('-1.000,00'), leitura.dinheiro('0,00'), leitura.dinheiro('abc')], [4394.9, -1000, 0, null]);
  assert.throws(() => leitura.analisarLinhas([['Razao Social', 'X']]), /Data \| Lancamentos/);
  // O XLSX de verdade (exceljs), ida e volta.
  const doXlsx = await leitura.analisar(await xlsxDaFatura());
  assert.deepEqual([doXlsx.valor_total, doXlsx.lancamentos.length, doXlsx.confere], [616.6, 8, true]);
  await assert.rejects(leitura.analisar(Buffer.from('não é planilha')), /Não é um arquivo XLSX/);
});

const compra = (id, data, descricao, valor, extra = {}) => ({ id, fatura_id: 1, tipo: 'compra', data, descricao, valor, valor_compra: extra.parcela_total ? Math.round(valor * extra.parcela_total * 100) / 100 : valor, documento_id: null, decisao: null, ...extra });
const doc = (id, data, valor, emitente, extra = {}) => ({ id, tipo: 'nfe', numero: String(id), data_emissao: data, valor_total: valor, emitente_nome: emitente, ...extra });

test('a situação de cada compra e o casamento das notas: valor, parcelada inteira, a data; a dúvida e a nota com conta só à mão; as parcelas herdam', () => {
  const sit = (x, o = {}) => cartao.situacaoDaCompra(x, { limite: 50, inicio: '2026-08', ...o });
  assert.deepEqual([
    sit(compra(1, '2026-08-15', 'PADARIA', 18.5)), sit(compra(2, '2026-08-20', 'KALUNGA', 320)), sit(compra(3, '2026-06-10', 'TOK STOK', 99.9, { parcela_numero: 3, parcela_total: 10 })),
    sit(compra(4, '2026-08-20', 'X', 320, { documento_id: 9 })), sit(compra(5, '2026-08-20', 'X', 320, { decisao: 'sem_nota' })), sit(compra(6, '2026-08-20', 'X', 320), { comRecibo: true }),
    sit({ ...compra(7, '2026-08-20', 'IOF', 3.2), tipo: 'encargo' }), sit(compra(8, '2026-08-20', 'X', 320), { limite: 500 })
  ], ['abaixo_do_limite', 'pendente', 'anterior', 'com_nota', 'sem_nota', 'com_recibo', 'nao_se_aplica', 'abaixo_do_limite']);

  const compras = [
    compra(1, '2026-08-20', 'KALUNGA LOJA 12', 320), compra(2, '2026-09-02', 'LEROY MERLIN BH', 150), compra(3, '2026-06-10', 'TOK STOK', 99.9, { parcela_numero: 3, parcela_total: 10 }),
    compra(4, '2026-09-04', 'MADEIREIRA SAO JOSE', 600)
  ];
  const documentos = [
    doc(11, '2026-08-20', 320, 'KALUNGA COMERCIO E INDUSTRIA GRAFICA LTDA'),
    doc(12, '2026-09-02', 150, 'LEROY MERLIN CIA BRASILEIRA'), doc(13, '2026-09-03', 150, 'OUTRA LOJA LTDA'),
    doc(14, '2026-06-10', 999.02, 'TOK STOK LTDA'), // a compra inteira com 2 centavos de arredondamento (10 parcelas)
    doc(15, '2026-09-05', 600, 'MADEIREIRA SAO JOSE LTDA'), // tem conta a pagar: só à mão
    doc(16, '2026-07-01', 320, 'KALUNGA'), // longe da data da compra
    doc(17, '2026-08-21', 320, 'KALUNGA X', { financeiro_pagamento_id: 4 }), // NFS-e de fechamento: não serve
    doc(18, '2026-08-22', 320, 'KALUNGA Y', { excluido_em: '2026-09-01T00:00:00Z' })
  ];
  const r = cartao.casarNotas({ compras, documentos, contaAberta: new Set(['15']), limite: 50, inicio: '2026-08' });
  assert.deepEqual(r.automaticos, [{ compra_id: 1, documento_id: 11 }, { compra_id: 3, documento_id: 14 }]);
  assert.deepEqual(r.sugestoes.get(2).map(k => [k.documento.id, k.nome]), [[12, true], [13, false]], 'a dúvida: duas notas de 150 — a do nome parecido primeiro');
  assert.deepEqual(r.sugestoes.get(4).map(k => [k.documento.id, k.com_conta]), [[15, true]], 'a nota com conta a pagar é sugestão, nunca automática');
  assert.match(r.sugestoes.get(3)[0].motivos.join(', '), /a compra inteira, com o arredondamento das 10 parcelas, emitida no dia da compra, o nome do emitente/);
  // A nota já ligada a outra compra não serve; a mesma nota para duas compras também fica para a mão.
  const outra = cartao.casarNotas({ compras: [compras[0], { ...compra(9, '2026-08-21', 'OUTRA LOJA', 320) }], documentos: [documentos[0]], limite: 50 });
  assert.deepEqual(outra.automaticos, []);
  const ocupada = cartao.casarNotas({ compras: [{ ...compras[0], documento_id: 11 }, compra(9, '2026-08-21', 'KALUNGA', 320)], documentos: [documentos[0]], limite: 50 });
  assert.deepEqual([ocupada.automaticos, ocupada.sugestoes.size], [[], 0]);
  // As parcelas da mesma compra (outra fatura) herdam a nota ou o "sem nota".
  const p3 = { ...compras[2], documento_id: 14 };
  const p4 = { ...compra(20, '2026-06-10', 'TOK STOK', 99.9, { parcela_numero: 4, parcela_total: 10 }), fatura_id: 2 };
  const s1 = compra(21, '2026-07-01', 'LOJA Z', 50, { parcela_numero: 1, parcela_total: 2, decisao: 'sem_nota', motivo: 'cupom perdido' });
  const s2 = { ...compra(22, '2026-07-01', 'LOJA Z', 50, { parcela_numero: 2, parcela_total: 2 }), fatura_id: 2 };
  assert.deepEqual(cartao.herdarParcelas([p3, p4, s1, s2]), [
    { compra_id: 20, de: 3, documento_id: 14, decisao: null, motivo: null }, { compra_id: 22, de: 21, documento_id: null, decisao: 'sem_nota', motivo: 'cupom perdido' }
  ]);
});

test('as pendências: a fatura do mês a importar, a que não fecha, as compras sem nota (crítico), as de antes do início e a fatura sem o pagamento', () => {
  const vazio = { faturas: [], compras: [], vinculos: [] };
  const cfg = { ativo: true, limite: 50 };
  assert.deepEqual(cartao.pendencias({ competencia: '2026-09', dados: vazio, config: cfg, inicio: '2026-09' }).map(p => [p.nivel, p.chave, p.titulo]),
    [['aviso', 'cartao_fatura_2026-09', 'Fatura do cartão de setembro/2026 a importar']]);
  assert.equal(cartao.pendencias({ competencia: '2026-09', dados: vazio, config: cfg, inicio: '2026-09', encerrada: true })[0].nivel, 'critico');
  assert.deepEqual(cartao.pendencias({ competencia: '2026-08', dados: vazio, config: cfg, inicio: '2026-09', encerrada: true }), [], 'antes do início');
  assert.deepEqual(cartao.pendencias({ competencia: '2026-09', dados: vazio, config: { ativo: false, limite: 50 }, encerrada: true }), [], 'cartão fora de uso');
  assert.deepEqual(cartao.pendencias({ competencia: '2026-09', dados: null, config: cfg }), [], 'sem o SQL');

  const f = { id: 1, competencia: '2026-09', vencimento: '2026-09-12', valor_total: 616.6, confere: false, conferencias: [{ rotulo: 'O total não bate', ok: false }] };
  const dados = {
    faturas: [f], vinculos: [{ alvo_tipo: 'fatura_cartao', alvo_id: 1, valor: 300, movimento_id: 801 }],
    compras: [compra(1, '2026-09-02', 'LEROY', 150), compra(2, '2026-08-20', 'KALUNGA', 320), compra(3, '2026-08-15', 'PADARIA', 18.5), compra(4, '2026-09-03', 'ACME', 99, { documento_id: 5 })],
    sugestoes: new Map([[1, [{}]]]), comRecibo: new Set()
  };
  const p = cartao.pendencias({ competencia: '2026-09', dados, config: cfg, inicio: '2026-09', encerrada: true });
  assert.deepEqual(p.map(x => [x.nivel, x.chave]), [['critico', 'cartao_nao_confere_1'], ['critico', 'cartao_sem_nota_1'], ['aviso', 'cartao_anteriores_1'], ['aviso', 'cartao_nao_paga_1']]);
  assert.deepEqual(p.map(x => x.titulo), [
    'A fatura do cartão (venc. 12/09/2026) não fecha', '1 compra do cartão sem nota (venc. 12/09/2026)', '1 compra de antes do início sem nota (venc. 12/09/2026)',
    'Fatura do cartão (venc. 12/09/2026) sem o pagamento conciliado'
  ]);
  assert.match(p[1].descricao.replace(/ /g, ' '), /^Total R\$ 150,00 · 1 tem nota sugerida: escolha · ou anexe o recibo/);
  assert.match(p[3].descricao.replace(/ /g, ' '), /Conciliado R\$ 300,00; falta R\$ 316,60/);
  assert.ok(p.every(x => x.filtro.acao === 'cartao'));
  // No mês em curso, sem o pagamento ainda: nada sobre o pagamento.
  assert.equal(cartao.pendencias({ competencia: '2026-09', dados, config: cfg, inicio: '2026-09' }).some(x => x.chave.startsWith('cartao_nao_paga')), false);
});

test('a liquidação da fatura, a classificação pela origem "cartao" e a pasta do pacote com as notas das compras', () => {
  const liq = liquidacoes.deFatura({ id: 1, vencimento: '2026-09-12', valor_total: 616.6, valor_minimo: 92.49, cartao_final: '9876' });
  assert.deepEqual([liq.chave, liq.tipo_rotulo, liq.valor, liq.forma, liq.rotulo, liq.subtipo, liq.no_banco], ['fatura_cartao:1', 'Fatura do cartão', -616.6, 'Fatura do cartão', 'Fatura do cartão final 9876 · venc. 12/09/2026', 'cartao', true]);
  const ctx = classificacao.contexto({
    plano: [{ id: 44, nome: 'Cartao de Credito', tipo: 'passivo', ativa: true, origem: 'aea' }],
    regras: [{ id: 1, condicao_tipo: 'origem', valor: 'cartao', sentido: 'debito', conta_id: 44, prioridade: 2, ativa: true, origem: 'padrao' }]
  });
  const r = classificacao.efetiva({ id: 801, valor: -616.6, descricao: 'PAGAMENTO DE BOLETO - BANCO DO BRASIL', estado_conciliacao: 'conciliado' }, {
    vinculos: [{ alvo_tipo: 'fatura_cartao', alvo_id: 1 }], liqsPorChave: new Map([[liq.chave, liq]]), ctx
  });
  assert.deepEqual([r.conta, r.criterio], ['Cartao de Credito', 'origem']);

  const fatura = { id: 1, vencimento: '2026-09-12', valor_total: 616.6, confere: true, cartao_final: '9876' };
  const compras = [
    { ...compra(1, '2026-08-20', 'KALUNGA', 320, { documento_id: 11 }), situacao: 'com_nota' },
    { ...compra(2, '2026-09-02', 'LEROY', 150), situacao: 'pendente' }, { ...compra(3, '2026-08-15', 'PADARIA', 18.5), situacao: 'abaixo_do_limite' }
  ];
  const m = { id: 801, conta_id: 1, data: '2026-09-14', valor: -616.6, descricao: 'PAGAMENTO DE BOLETO', estado_conciliacao: 'conciliado' };
  const { pagamentos: [pag] } = pagamentos.planoDosPagamentos({
    competencia: '2026-09', liquidacoesLista: [{ ...liq, data: '2026-09-14' }], documentosPorId: new Map([['11', { id: 11, tipo: 'nfe', numero: '77', serie: '1', competencia: '2026-08', emitente_nome: 'KALUNGA', data_emissao: '2026-08-20', valor_total: 320 }]]),
    vinculosPorChave: new Map([[liq.chave, [{ movimento_id: 801, criterio: 'cartao' }]]]), movimentosPorId: new Map([['801', m]]), comprovantesDoMovimento: new Map([['801', [{ id: 5 }]]]),
    cartaoDaFatura: new Map([['1', { fatura, compras, limite: 50 }]])
  });
  assert.equal(pag.pasta, '001 14-09 Banco do Brasil 616,60');
  assert.deepEqual([pag.documentos.map(d => d.id), pag.faltas], [[11], ['1 compra sem nota (de 3 compras)']]);
  assert.equal(pag.cartao.compras.length, 3);
});

test('o leitor entende a descrição do BB: o estabelecimento, a cidade e a parcela', () => {
  assert.deepEqual(leitura.descricaoDaLinha(desc('MERCADO  LIVRE', 'SAO PAULO')), { descricao: 'MERCADO LIVRE', cidade: 'SAO PAULO', parcela_numero: null, parcela_total: null });
  assert.deepEqual(leitura.descricaoDaLinha(parc('MAGAZINE LUIZ', 6, 10, 'CONTAGEM')), { descricao: 'MAGAZINE LUIZ', cidade: 'CONTAGEM', parcela_numero: 6, parcela_total: 10 });
  assert.deepEqual(leitura.descricaoDaLinha('LOJA CURTA'), { descricao: 'LOJA CURTA', cidade: null, parcela_numero: null, parcela_total: null });
  assert.deepEqual(['IOF COMPRA', 'ANUIDADE DIFERENCIADA', 'LOJA'].map(t => leitura.tipoDaLinha({ secao: 'Compras', texto: t, valor: 10 })), ['encargo', 'encargo', 'compra']);
  assert.equal(leitura.tipoDaLinha({ secao: 'Pagamentos/Créditos', texto: 'ESTORNO', valor: -10 }), 'credito');
});
