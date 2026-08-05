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
  const noCorpo = new Map();
  const criarElemento = (tag, attrs = {}) => ({
    tagName: tag.toUpperCase(),
    id: '',
    dataset: {},
    attrs,
    innerHTML: '',
    textContent: '',
    classList: { add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    appendChild() {},
    remove() { noCorpo.delete(this.id); },
    querySelector: () => ({ textContent: '' }),
    closest: () => null
  });

  const documento = {
    getElementById: id => noCorpo.get(id) || null,
    querySelector: seletor => elementos.get(seletor) || null,
    addEventListener() {},
    createElement: tag => criarElemento(tag),
    head: { appendChild() {} },
    body: {
      appendChild(el) { noCorpo.set(el.id, el); }
    },
    documentElement: { appendChild() {} },
    readyState: 'complete'
  };
  documento.__noCorpo = noCorpo;

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

  return { api: contexto.window.BotaoAcao, elementos, criarElemento, documento };
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

/**
 * Véu de carregamento para ações sem botão a marcar.
 *
 * A exclusão de um pedido é confirmada por caixa de diálogo: quando a
 * requisição sai, o clique original já terminou e o diálogo já fechou. Sem o
 * véu, a espera — que na exclusão em cascata são vários segundos — ficava muda,
 * e o usuário clicava de novo achando que travou.
 */
test('o véu aparece durante a ação e some ao terminar', async () => {
  const { api, documento } = carregarBotaoAcao();
  assert.ok(api?.comCarregamento, 'BotaoAcao precisa expor comCarregamento');

  let veuDurante = null;
  const resultado = await api.comCarregamento(async () => {
    veuDurante = documento.getElementById('botaoAcaoVeu');
    return 'pronto';
  }, 'Excluindo o pedido PED12...');

  assert.ok(veuDurante, 'o véu tem de estar na tela ENQUANTO a ação roda');
  assert.equal(resultado, 'pronto', 'o retorno da ação é preservado');
  assert.equal(
    documento.getElementById('botaoAcaoVeu'), null,
    'e sair ao terminar'
  );
});

test('o véu some mesmo quando a ação falha', async () => {
  const { api, documento } = carregarBotaoAcao();

  await assert.rejects(
    () => api.comCarregamento(async () => { throw new Error('falhou'); }, 'Excluindo...'),
    /falhou/,
    'o erro continua subindo para quem chamou'
  );

  // Sem o `finally`, um erro deixaria a tela bloqueada para sempre — pior que
  // não ter véu nenhum.
  assert.equal(documento.getElementById('botaoAcaoVeu'), null, 'a tela é liberada');
});

test('duas ações ao mesmo tempo: a primeira a terminar não tira o véu da outra', async () => {
  const { api, documento } = carregarBotaoAcao();

  let liberarSegunda;
  const segunda = new Promise(resolve => { liberarSegunda = resolve; });

  const a = api.comCarregamento(async () => 'rápida', 'A...');
  const b = api.comCarregamento(() => segunda, 'B...');

  await a;
  assert.ok(
    documento.getElementById('botaoAcaoVeu'),
    'a ação B ainda está rodando: o véu precisa continuar'
  );

  liberarSegunda('lenta');
  await b;
  assert.equal(documento.getElementById('botaoAcaoVeu'), null);
});
