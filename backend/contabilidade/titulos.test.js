/**
 * Contas a pagar (backend/contabilidade/titulos.js): as funções puras.
 * O que fica preso: a divisão das parcelas em centavos (sobra na última) e o
 * vencimento mensal no fim do mês; a conferência da soma; a competência que
 * nasce da emissão; a situação de cada parcela e da conta; as visões da
 * lista e os totais.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('./titulos');

const HOJE = '2026-09-28';
const semNbsp = v => String(v).replace(/ /g, ' ');

test('gerarParcelas: centavos divididos com a sobra na última; mensal no mesmo dia ou no último do mês', () => {
  const p = t.gerarParcelas({ quantidade: 3, primeiroVencimento: '2026-01-31', valorTotal: 100 });
  assert.deepEqual(p.map(x => [x.numero, x.vencimento, x.valor]), [[1, '2026-01-31', 33.33], [2, '2026-02-28', 33.33], [3, '2026-03-31', 33.34]]);
  assert.equal(t.gerarParcelas({ quantidade: 1, primeiroVencimento: '2026-09-10', valorTotal: '1.234,56' })[0].valor, 1234.56);
  assert.throws(() => t.gerarParcelas({ quantidade: 0, primeiroVencimento: '2026-09-10', valorTotal: 10 }), /de 1 a 60/);
  assert.throws(() => t.gerarParcelas({ quantidade: 2, primeiroVencimento: '', valorTotal: 10 }), /vencimento/);
  assert.throws(() => t.gerarParcelas({ quantidade: 2, primeiroVencimento: '2026-09-10', valorTotal: 0 }), /valor da conta/);
  assert.equal(t.somarMesesNaData('2026-12-15', 1), '2027-01-15');
});

test('conferirParcelas: a soma tem de bater; renumera pela ordem do vencimento; linha digitável só com números', () => {
  const p = t.conferirParcelas([
    { vencimento: '2026-10-10', valor: '600,00', linha_digitavel: '00190.00009 01234.567891 23456.789012 3 99990000060000' },
    { vencimento: '2026-09-10', valor: 600 }
  ], 1200);
  assert.deepEqual(p.map(x => [x.numero, x.vencimento, x.valor]), [[1, '2026-09-10', 600], [2, '2026-10-10', 600]]);
  assert.equal(p[1].linha_digitavel, '00190000090123456789123456789012399990000060000');
  assert.throws(() => t.conferirParcelas([{ vencimento: '2026-09-10', valor: 500 }], 1200), e => /não bate/.test(e.message) && /R\$\s500,00/.test(semNbsp(e.message)));
  assert.throws(() => t.conferirParcelas([], 10), /ao menos uma parcela/);
  assert.throws(() => t.conferirParcelas([{ vencimento: 'x', valor: 10 }], 10), /vencimento da parcela 1/);
});

test('validarTitulo: descrição e valor obrigatórios; a competência nasce da emissão ou do primeiro vencimento', () => {
  const v = t.validarTitulo({ descricao: '  Vidros   da obra ', valor_total: '1.200,00', data_emissao: '2026-08-10', contato_id: '7', categoria: 'Aquisição de Bens' });
  assert.deepEqual(v, {
    descricao: 'Vidros da obra', valor_total: 1200, data_emissao: '2026-08-10', competencia: '2026-08', categoria: 'Aquisição de Bens',
    numero_documento: null, observacao: null, contato_id: 7, documento_recebido_id: null
  });
  assert.equal(t.validarTitulo({ descricao: 'Guia DAS', valor_total: 50 }, { primeiroVencimento: '2026-09-20' }).competencia, '2026-09');
  assert.throws(() => t.validarTitulo({ descricao: 'ab', valor_total: 10, competencia: '2026-09' }), /Descreva/);
  assert.throws(() => t.validarTitulo({ descricao: 'Conta', valor_total: 0, competencia: '2026-09' }), /valor da conta/);
  assert.throws(() => t.validarTitulo({ descricao: 'Conta', valor_total: 10, competencia: '2026-13' }), /Competência inválida/);
  assert.throws(() => t.validarTitulo({ descricao: 'Conta', valor_total: 10 }), /competência/);
  assert.deepEqual(t.validarTitulo({ categoria: 'X' }, { parcial: true }), { categoria: 'X' }, 'parcial só confere o que veio');
});

function base() {
  return {
    titulos: [
      { id: 1, contato_id: 7, descricao: 'Vidros', valor_total: 1200, competencia: '2026-08', status: 'aberto', data_emissao: '2026-08-10' },
      { id: 2, contato_id: null, descricao: 'Guia DAS', valor_total: 300, competencia: '2026-09', status: 'aberto' },
      { id: 3, contato_id: 7, descricao: 'Cancelada', valor_total: 100, competencia: '2026-09', status: 'cancelado', motivo_cancelamento: 'Lançada em dobro' }
    ],
    parcelas: [
      { id: 11, titulo_id: 1, numero: 1, vencimento: '2026-09-10', valor: 600 },
      { id: 12, titulo_id: 1, numero: 2, vencimento: '2026-10-10', valor: 600 },
      { id: 21, titulo_id: 2, numero: 1, vencimento: '2026-09-28', valor: 300 },
      { id: 31, titulo_id: 3, numero: 1, vencimento: '2026-09-15', valor: 100 }
    ],
    pagamentos: [
      { id: 100, parcela_id: 11, titulo_id: 1, data_pagamento: '2026-09-09', competencia: '2026-09', valor_pago: 612, valor_juros: 12, valor_desconto: 0, forma: 'Pix' },
      { id: 101, parcela_id: 12, titulo_id: 1, data_pagamento: '2026-09-01', competencia: '2026-09', valor_pago: 600, valor_juros: 0, valor_desconto: 0, forma: 'Pix', estornado_em: '2026-09-02T10:00:00Z', motivo_estorno: 'Engano' }
    ],
    contatos: new Map([['7', { id: 7, nome: 'Vidros Norte', cnpj: '57248237000103' }]])
  };
}

test('montarTitulo: a situação de cada parcela e da conta; estorno não conta como pago', () => {
  const [um, dois, tres] = t.montarTodos(base(), HOJE);
  assert.deepEqual(um.parcelas.map(p => [p.numero, p.situacao, p.pagamento?.valor_pago ?? null, p.estornos.length]), [[1, 'paga', 612, 0], [2, 'a_vencer', null, 1]]);
  assert.equal(um.situacao, 'parcial');
  assert.equal(um.fornecedor, 'Vidros Norte');
  assert.equal(um.fornecedor_documento, '57.248.237/0001-03');
  assert.equal(um.pago, 612);
  assert.equal(um.aberto, 600);
  assert.equal(um.proximo_vencimento, '2026-10-10');
  assert.equal(um.parcelas[0].pagamento.juros, 12);
  assert.equal(dois.parcelas[0].situacao, 'vence_hoje');
  assert.equal(dois.situacao, 'aberto');
  assert.equal(tres.situacao, 'cancelado');
  assert.equal(tres.parcelas[0].situacao, 'cancelada');
  const vencida = t.montarTitulo({ id: 9, descricao: 'x', valor_total: 10, competencia: '2026-08', status: 'aberto' }, { parcelas: [{ id: 1, titulo_id: 9, numero: 1, vencimento: '2026-09-01', valor: 10 }], hoje: HOJE });
  assert.equal(vencida.situacao, 'vencido');
  assert.equal(vencida.vencido, 10);
});

test('visaoDaLista: cada visão pega as parcelas certas; os totais da competência', () => {
  const titulos = t.montarTodos(base(), HOJE);
  const ids = v => t.visaoDaLista(titulos, { visao: v, competencia: '2026-09', hoje: HOJE }).linhas.map(l => l.parcela_id);
  assert.deepEqual(ids('abertas'), [21, 12]);
  assert.deepEqual(ids('vencidas'), []);
  assert.deepEqual(ids('mes'), [11, 21], 'vencem em setembro (a cancelada fica de fora)');
  assert.deepEqual(ids('pagas'), [11]);
  assert.deepEqual(ids('todas'), [21], 'lançadas em setembro e não canceladas');
  assert.deepEqual(ids('canceladas'), [31]);
  assert.deepEqual(ids('qualquer'), [21, 12], 'visão desconhecida = em aberto');
  const r = t.visaoDaLista(titulos, { visao: 'pagas', competencia: '2026-09', hoje: HOJE });
  assert.deepEqual(r.totais, {
    em_aberto: { quantidade: 2, total: 900 },
    vencido: { quantidade: 0, total: 0 },
    vence_no_mes: { quantidade: 1, total: 300 },
    pago_no_mes: { quantidade: 1, total: 612 }
  });
  assert.equal(r.linhas[0].fornecedor, 'Vidros Norte');
  assert.equal(r.linhas[0].de, 2);
});

test('parcelasMudaram e categoriasDe', () => {
  const antes = [{ numero: 1, vencimento: '2026-09-10', valor: '600.00' }, { numero: 2, vencimento: '2026-10-10', valor: 600 }];
  assert.equal(t.parcelasMudaram(antes, [{ vencimento: '2026-09-10', valor: 600 }, { vencimento: '2026-10-10', valor: 600 }]), false);
  assert.equal(t.parcelasMudaram(antes, [{ vencimento: '2026-09-11', valor: 600 }, { vencimento: '2026-10-10', valor: 600 }]), true);
  assert.equal(t.parcelasMudaram(antes, [{ vencimento: '2026-09-10', valor: 1200 }]), true);
  assert.deepEqual(t.categoriasDe([{ categoria: 'aquisição de bens' }, { categoria: 'Aluguel' }, { categoria: null }]),
    ['Aluguel', 'Aporte de Capital', 'Aquisição de Bens', 'Impostos e Taxas', 'Serviços de Terceiros']);
});
