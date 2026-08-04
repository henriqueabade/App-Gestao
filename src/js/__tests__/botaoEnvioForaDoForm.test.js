const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

/**
 * O botão de envio nem sempre é filho do formulário.
 *
 * Vários modais do app (Matéria-Prima é o caso que quebrou) põem Cancelar/Salvar
 * num rodapé FORA do `<form>` e ligam por `form="idDoForm"`, que o HTML permite.
 * `localizarBotaoEnvio` só olhava os descendentes e devolvia `null` — sem botão,
 * `BotaoAcao` não tinha onde mostrar o carregando nem o que travar contra o
 * segundo clique. A ação rodava, o banco gravava, e a tela não dava sinal nenhum.
 */

function carregarBotaoAcao() {
  const codigo = fs.readFileSync(
    path.join(__dirname, '..', '..', 'utils', 'botaoAcao.js'),
    'utf8'
  );

  const elementos = new Map();
  const criarElemento = (tag, attrs = {}) => ({
    tagName: tag.toUpperCase(),
    dataset: {},
    attrs,
    classList: { add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    querySelector: () => null,
    closest: () => null
  });

  const documento = {
    getElementById: () => null,
    querySelector: seletor => elementos.get(seletor) || null,
    addEventListener() {},
    createElement: tag => criarElemento(tag),
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    readyState: 'complete'
  };

  const contexto = {
    document: documento,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
    Date,
    CSS: { escape: valor => valor }
  };
  contexto.window = contexto;

  vm.createContext(contexto);
  vm.runInContext(codigo, contexto);

  return { api: contexto.window.BotaoAcao, elementos, criarElemento };
}

test('acha o botão de envio ligado por form="id", fora do formulário', () => {
  const { api, elementos, criarElemento } = carregarBotaoAcao();
  assert.ok(api?.bindSubmit, 'BotaoAcao precisa expor bindSubmit');

  const botaoDoRodape = criarElemento('button');
  elementos.set(
    'button[type="submit"][form="novoInsumoForm"], input[type="submit"][form="novoInsumoForm"]',
    botaoDoRodape
  );

  const form = {
    id: 'novoInsumoForm',
    tagName: 'FORM',
    dataset: {},
    addEventListener() {},
    // Como no HTML real: nenhum botão de envio DENTRO do form.
    querySelector: () => null
  };

  api.bindSubmit(form, async () => {});

  assert.equal(
    botaoDoRodape.dataset.acaoGerida, 'true',
    'o botão do rodapé tem de ser encontrado e marcado como gerido — sem isso '
    + 'não há carregando nem trava de duplo clique'
  );
  assert.equal(form.dataset.acaoGerida, 'true', 'o formulário também é marcado');
});
