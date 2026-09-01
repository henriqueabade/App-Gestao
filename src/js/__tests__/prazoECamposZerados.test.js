/**
 * O prazo lido como dinheiro, e o zero que precisava ser apagado.
 *
 * ---------------------------------------------------------------------------
 * 1. "28/42/56" NÃO É DINHEIRO
 *
 * É como este ramo escreve prazo de pagamento, e o modelo copia a expressão
 * inteira para o campo de PARCELAS. Lida de lá como valor, ela virava três
 * parcelas de R$ 28, R$ 42 e R$ 56 num pedido de oito mil reais — e os dias
 * caíam no padrão 30/60/90, que ninguém combinou.
 *
 * Junto vinha a coluna Prazo da grade em branco: os dias estavam escritos do
 * outro lado.
 *
 * ---------------------------------------------------------------------------
 * 2. O ZERO QUE ERA FORMATO
 *
 * `R$ 0,00` num campo de parcela e `0` numa quantidade não são coisas que
 * alguém digitou — é o formato mostrado antes de haver resposta. Mas ficavam no
 * `value`, e para escrever era preciso apagar primeiro. Quem não apagava
 * terminava com `fgdgR$ 0,00` no campo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const preenchimento = require(path.join(raiz, 'backend', 'iaPreenchimento.js'));

// ---------------------------------------------------------------------------
// 1. Dias escritos como parcelas
// ---------------------------------------------------------------------------

const dias = preenchimento.diasEscritosComoParcelas;

test('uma lista de inteiros pelados é prazo, não preço', () => {
  assert.deepEqual(Array.from(dias('28/42/56')), [28, 42, 56]);
  assert.deepEqual(Array.from(dias('30/60/90')), [30, 60, 90]);
  assert.deepEqual(Array.from(dias('30 dias / 60 dias')), [30, 60]);
});

test('qualquer marca de dinheiro tira a dúvida', () => {
  // `R$` e os centavos são como dinheiro se escreve neste programa. Sem esta
  // recusa, um parcelamento de verdade viraria prazo.
  assert.deepEqual(Array.from(dias('R$ 28,00/R$ 42,00')), []);
  assert.deepEqual(Array.from(dias('1.899,90/2.000,00')), []);
  assert.deepEqual(Array.from(dias('R$ 28/42')), []);
});

test('basta um pedaço fora do padrão para não ser prazo', () => {
  // Exigir que TODOS casem impede que "28/entrada" entre aqui por engano — e
  // entrar por engano é trocar valores por dias num pedido inteiro.
  assert.deepEqual(Array.from(dias('28/entrada')), []);
  assert.deepEqual(Array.from(dias('28/4200')), [], 'acima de um ano não é prazo');
});

test('um número sozinho não decide nada', () => {
  // "30" pode ser o prazo ou o valor de uma parcela única. Sem uma lista, o
  // sinal não existe, e adivinhar aqui trocaria um pelo outro em silêncio.
  assert.deepEqual(Array.from(dias('30')), []);
  assert.deepEqual(Array.from(dias('')), []);
  assert.deepEqual(Array.from(dias(null)), []);
});

test('o parcelamento usa os dias e não inventa valores', () => {
  const r = preenchimento.interpretarPagamento({
    forma_pagamento: 'À VISTA 5% OU 28/42/56',
    condicao_pagamento: 'a prazo',
    parcelas: '28/42/56',
    prazo: ''
  });

  assert.equal(r.condicao, 'prazo');
  assert.equal(r.parcelas.count, 3);

  const vencimentos = Array.from(r.parcelas.items, i => i.dueInDays);
  assert.deepEqual(vencimentos, [28, 42, 56],
    'os dias caíam no padrão 30/60/90 porque o campo de prazo estava vazio');

  const valores = Array.from(r.parcelas.items, i => i.amount);
  assert.deepEqual(valores, [0, 0, 0],
    '28, 42 e 56 eram lidos como R$ 28, R$ 42 e R$ 56 — três parcelas de '
    + 'trocados num pedido de oito mil reais');
});

test('o prazo escrito no campo certo continua mandando', () => {
  const r = preenchimento.interpretarPagamento({
    condicao_pagamento: 'a prazo',
    parcelas: '28/42/56',
    prazo: '15/30'
  });

  // O que o modelo pôs no campo certo vale mais que a dedução.
  assert.deepEqual(Array.from(r.parcelas.items, i => i.dueInDays), [15, 30]);
});

test('parcelamento de verdade não é confundido com prazo', () => {
  const r = preenchimento.interpretarPagamento({
    condicao_pagamento: 'a prazo',
    parcelas: 'R$ 1.000,00/R$ 2.000,00',
    prazo: '30/60'
  });

  assert.deepEqual(Array.from(r.parcelas.items, i => i.amount), [100000, 200000]);
  assert.deepEqual(Array.from(r.parcelas.items, i => i.dueInDays), [30, 60]);
});

test('a extração move os dias para a coluna Prazo', () => {
  const js = ler('backend', 'iaEstruturacao.js');

  // Era isso que deixava a coluna Prazo da grade em branco num pedido que
  // declara o prazo: ele estava escrito no campo do lado.
  assert.match(js, /if \('prazo' in dados && !String\(dados\.prazo \?\? ''\)\.trim\(\)\)/);
  assert.match(js, /dados\.prazo = dias\.join\('\/'\)/);

  // A mesma leitura dos dois lados: duas divergiriam, e a divergência
  // apareceria como a grade dizendo um prazo e o formulário outro.
  assert.match(js, /const \{ diasEscritosComoParcelas \} = require\('\.\/iaPreenchimento'\)/);
});

test('o campo de parcelas fica como o documento escreveu', () => {
  const js = ler('backend', 'iaEstruturacao.js');

  // É por ele que se confere se a leitura entendeu. Limpá-lo depois de mover
  // os dias apagaria a prova.
  assert.doesNotMatch(js, /dados\.parcelas = (null|'')/);
});

// ---------------------------------------------------------------------------
// 2. O zero que é formato
// ---------------------------------------------------------------------------

/** O utilitário, executado de verdade sobre um campo fingido. */
function montarCampo(valorInicial) {
  const fonte = ler('src', 'js', 'utils', 'campo-zerado.js');
  const ouvintes = {};
  const input = {
    value: valorInicial,
    dataset: {},
    addEventListener: (nome, fn) => { ouvintes[nome] = fn; }
  };
  const contexto = { String, RegExp, document: { querySelectorAll: () => [] } };
  contexto.window = contexto;
  vm.createContext(contexto);
  vm.runInContext(fonte, contexto);

  contexto.CampoZerado.ligar(input);
  return {
    input,
    focar: () => ouvintes.focus(),
    sair: () => ouvintes.blur()
  };
}

test('ao focar, o zero de formato sai da frente', () => {
  for (const zero of ['0', '0,00', 'R$ 0,00', '0.0000', ' R$ 0,00 ']) {
    const campo = montarCampo(zero);
    campo.focar();
    assert.equal(campo.input.value, '',
      `"${zero}" precisa sair da frente: é formato, não resposta`);
  }
});

test('ao sair sem escrever, o zero volta exatamente como estava', () => {
  const campo = montarCampo('R$ 0,00');
  campo.focar();
  campo.sair();

  // O zero costuma ir para o banco. Deixar o campo vazio mandaria `null` onde
  // o registro espera `0` — ou seria recusado por um `required` que nada na
  // tela explica.
  assert.equal(campo.input.value, 'R$ 0,00');
});

test('o que a pessoa escreveu fica', () => {
  const campo = montarCampo('R$ 1.899,90');
  campo.focar();

  // Ela clicou para corrigir, não para recomeçar.
  assert.equal(campo.input.value, 'R$ 1.899,90');
});

test('escreveu e saiu: o que ficou é o que ela escreveu', () => {
  const campo = montarCampo('0');
  campo.focar();
  campo.input.value = '12';
  campo.sair();
  assert.equal(campo.input.value, '12');
});

test('ligar duas vezes no mesmo campo é ignorado', () => {
  const fonte = ler('src', 'js', 'utils', 'campo-zerado.js');
  const contexto = { String, RegExp, document: { querySelectorAll: () => [] } };
  contexto.window = contexto;
  vm.createContext(contexto);
  vm.runInContext(fonte, contexto);

  let ligados = 0;
  const input = { value: '0', dataset: {}, addEventListener: () => { ligados += 1; } };
  contexto.CampoZerado.ligar(input);
  contexto.CampoZerado.ligar(input);

  // Duas ligações esvaziariam e reporiam duas vezes, e a segunda leria o
  // estado que a primeira acabou de mudar. As telas chamam a cada desenho.
  assert.equal(ligados, 2, 'só o primeiro par de ouvintes é ligado');
});

test('os três lugares que nascem em zero estão ligados', () => {
  const parcelas = ler('src', 'js', 'utils', 'parcelamento.js');
  assert.match(parcelas, /CampoZerado\?\.ligar\(campoValor\)/,
    'o valor da parcela era o caso do "fgdgR$ 0,00"');

  const devolucao = ler('src', 'js', 'modals', 'pedido-cancelar.js');
  assert.match(devolucao, /CampoZerado\?\.ligar\(input\)/,
    'a quantidade por destino, ao devolver uma peça');

  for (const arquivo of ['produto-novo.js', 'produto-editar.js']) {
    assert.match(ler('src', 'js', 'modals', arquivo),
      /CampoZerado\?\.ligarTodos\(/,
      `${arquivo}: os sete percentuais da ficha nascem em zero`);
  }
});

test('o utilitário é carregado sempre, não por módulo', () => {
  // Ele serve a modal e a módulo, e o de parcelas é carregado sob demanda.
  const menu = ler('src', 'html', 'menu.html');
  assert.match(menu, /js\/utils\/campo-zerado\.js/);
});
