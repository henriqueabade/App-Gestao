/**
 * Boleto com o VALOR CHEIO e desconto até o vencimento — as telas (decisões
 * do dono, 25/09/2026). O backend está em backend/cobranca/descontoCondicional.test.js.
 *
 *   - "Gerar boletos" diz com quanto o boleto novo sai e o desconto dele;
 *   - o Financeiro (Recebimentos) e os Pagamentos do pedido mostram o que a
 *     parcela cobra HOJE: em dia, com desconto; vencida, o cheio + multa + juros;
 *   - a trava do "Alterar pagamento" aceita o valor em dia, não o cheio.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const GERAR = ler('js', 'modals', 'pedido-gerar-boletos.js');
const PAGAMENTOS = ler('js', 'modals', 'pedido-pagamentos-parcelas.js');
const PAGAMENTO_PEDIDO = ler('js', 'modals', 'pedido-pagamento.js');
const FINANCEIRO = ler('js', 'modals', 'financeiro-modais.js');
const COBRANCA_HTML = ler('html', 'modals', 'financeiro', 'configuracao-cobranca.html');
const plano = v => JSON.parse(JSON.stringify(v));
const semNbsp = t => String(t).replace(/ /g, ' ');

function bloco(fonte, inicio, fim, nomes) {
  const i = fonte.indexOf(inicio);
  const f = fonte.indexOf(fim, i);
  assert.ok(i !== -1 && f > i, 'bloco de funções puras não encontrado');
  return vm.runInContext(`${fonte.slice(i, f)}\n({ ${nomes.join(', ')} })`, vm.createContext({}));
}

function funcao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.ok(inicio !== -1, `sem a função ${nome}`);
  let nivel = 0;
  let i = fonte.indexOf(') {', inicio) + 2;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return vm.runInContext(`${fonte.slice(inicio, i + 1)}\n${nome}`, vm.createContext({}));
}

function financeiro() {
  const contexto = { window: {}, document: { getElementById: () => null, createElement: () => ({}) }, console: { error() {} }, Intl, Number, Math, String, Array, Date, Promise };
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(FINANCEIRO, contexto);
  return contexto.window.FinanceiroModais;
}

const BOLETO = { id: 41, status: 'registrado', valor: '5000.00', valor_desconto: '250.00', desconto_ate: '2027-01-18', data_vencimento: '2027-01-18', nosso_numero: '00034534810000000001', nosso_numero_dv: '4', linha_digitavel: '00190.00009' };

test('Gerar boletos: a parcela sem boleto diz com quanto o boleto sai; o registrado mostra o cheio e o desconto', () => {
  const f = bloco(GERAR, 'const ROTULO_STATUS', '// ------------------------------------------------- fim das funções puras', ['linhaDaParcela']);
  const nova = plano(f.linhaDaParcela({ parcela: { id: 1, numero_parcela: 1, data_vencimento: '2027-01-18', valor: '4750.00' }, boleto: null, tem_boleto_vivo: false, desconto_condicional: 250 }));
  assert.strictEqual(nova.valor, 4750, 'a coluna continua sendo a parcela (o valor do pedido)');
  assert.strictEqual(semNbsp(nova.detalhe), 'o boleto sai com R$ 5.000,00 e desconto de R$ 250,00 até o vencimento');

  const registrada = plano(f.linhaDaParcela({ parcela: { id: 1, numero_parcela: 1, data_vencimento: '2027-01-18', valor: '4750.00' }, boleto: BOLETO, tem_boleto_vivo: true, desconto_condicional: 250 }));
  assert.match(semNbsp(registrada.detalhe), /boleto de R\$ 5\.000,00 com desconto de R\$ 250,00 até 18\/01\/2027/);
  assert.doesNotMatch(semNbsp(registrada.detalhe), /o boleto sai com/);

  const semDesconto = plano(f.linhaDaParcela({ parcela: { id: 1, numero_parcela: 1, data_vencimento: '2027-01-18', valor: '4750.00' }, boleto: null, tem_boleto_vivo: false, desconto_condicional: 0 }));
  assert.strictEqual(semDesconto.detalhe, '');
});

test('Recebimentos do Financeiro: vencida com boleto conta o que ele cobra hoje, com o "em dia" embaixo', () => {
  const f = financeiro();
  const vencida = { a_receber: 4750, a_receber_hoje: 5145, desconto_condicional: 250, valor_boleto: 5000, encargos_hoje: { dias: 3, desconto_perdido: 250, multa: 100, juros: 45, total: 395 } };
  const hoje = plano(f.valorAReceberHoje(vencida));
  assert.strictEqual(hoje.valor, 5145);
  assert.strictEqual(semNbsp(hoje.detalhe), 'em dia R$ 4.750,00 + desconto perdido R$ 250,00 + multa R$ 100,00 + juros R$ 45,00');
  const emDia = plano(f.valorAReceberHoje({ a_receber: 4750, a_receber_hoje: 4750, desconto_condicional: 250, valor_boleto: 5000, encargos_hoje: null }));
  assert.strictEqual(semNbsp(emDia.detalhe), 'boleto de R$ 5.000,00 com desconto até o vencimento');
  assert.strictEqual(plano(f.valorAReceberHoje({ a_receber: 900 })).detalhe, '');
  assert.strictEqual(f.totalDaVisao([vencida, { a_receber: 100 }], 'abertas'), 5245);
});

test('Pagamentos do pedido: a coluna do valor mostra o de hoje e de onde ele vem', () => {
  const f = bloco(PAGAMENTOS, 'const MESES', '// ------------------------------------------------- fim das funções puras', ['valorDaParcelaNaTela']);
  const vencida = plano(f.valorDaParcelaNaTela({ a_receber: 4750, a_receber_hoje: 5145, abatimento: 0, boleto_aberto: true, desconto_condicional: 250, valor_boleto: 5000, encargos_hoje: { desconto_perdido: 250, multa: 100, juros: 45, total: 395 } }));
  assert.strictEqual(semNbsp(vencida.principal), 'R$ 5.145,00');
  assert.strictEqual(semNbsp(vencida.detalhe), 'em dia R$ 4.750,00; vencido: sem o desconto de R$ 250,00, multa R$ 100,00, juros R$ 45,00');
  const emDia = plano(f.valorDaParcelaNaTela({ a_receber: 4750, abatimento: 0, boleto_aberto: true, desconto_condicional: 250, valor_boleto: 5000, encargos_hoje: null }));
  assert.strictEqual(semNbsp(emDia.principal), 'R$ 4.750,00');
  assert.strictEqual(semNbsp(emDia.detalhe), 'boleto de R$ 5.000,00 com desconto até o vencimento');
  assert.strictEqual(semNbsp(plano(f.valorDaParcelaNaTela({ a_receber: 900, abatimento: 100 })).detalhe), 'abatimento de R$ 100,00');
});

test('Alterar pagamento: a parcela com boleto de valor cheio fica travada no valor em dia', () => {
  const travas = funcao(PAGAMENTO_PEDIDO, 'travasDasLinhas')([
    { parcela: { numero_parcela: 1, valor: '4750.00' }, tem_boleto_vivo: true, boleto: { valor: '5000.00', valor_desconto: '250.00' } }
  ]);
  assert.strictEqual(travas[0].permitido, 475000);
  assert.strictEqual(travas[0].atual, 475000);
  assert.match(semNbsp(travas[0].texto), /o valor e o prazo desta parcela não mudam/);
});

test('Configuração de cobrança explica que o desconto por antecipação vale só para pedido sem desconto', () => {
  assert.ok(COBRANCA_HTML.includes('O "Desconto por antecipação" abaixo vale só para pedido sem desconto.'));
});
