/**
 * O botão de salvar dos modais de Produto.
 *
 * Os dois modais põem Cancelar/Registrar num rodapé FORA do `<form>`, ligados
 * por `form="idDoForm"` — o HTML permite, e vários modais do app fazem assim.
 *
 * Os dois também procuravam o botão com `form.querySelector('button[type=
 * "submit"]')`, que só olha os DESCENDENTES: o resultado era `null`, o
 * `setLoadingState` saía pela porta dos fundos, e o botão nunca desabilitava
 * nem mostrava "Salvando...". Quem clicava via a tela parada durante o tempo
 * do cadastro e clicava de novo.
 *
 * `localizarBotaoEnvio` (src/utils/botaoAcao.js) é a busca que já sabia disso.
 * Este arquivo trava as duas pontas: que o HTML continua com o botão fora do
 * form, e que os dois modais usam a busca que o encontra.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

const MODAIS = [
  {
    nome: 'Novo produto',
    html: ['html', 'modals', 'produtos', 'novo.html'],
    js: ['js', 'modals', 'produto-novo.js'],
    form: 'novoProdutoForm'
  },
  {
    nome: 'Editar produto',
    html: ['html', 'modals', 'produtos', 'editar.html'],
    js: ['js', 'modals', 'produto-editar.js'],
    form: 'editarProdutoForm'
  }
];

test('o botão de salvar mora fora do form, ligado por `form=`', () => {
  for (const modal of MODAIS) {
    const html = ler(...modal.html);

    // Se um dia o botão voltar para dentro do form, o teste abaixo passaria a
    // não medir nada — e esta âncora é o que avisa.
    const botao = new RegExp(
      `<button[^>]*type="submit"[^>]*form="${modal.form}"`
      + `|<button[^>]*form="${modal.form}"[^>]*type="submit"`
    );
    assert.match(html, botao, `${modal.nome}: o botão não usa form="${modal.form}"`);

    const abreForm = html.indexOf(`id="${modal.form}"`);
    const posBotao = html.search(botao);
    assert.ok(posBotao < abreForm,
      `${modal.nome}: o botão está DENTRO do form — este teste virou letra morta`);
  }
});

test('os dois modais acham o botão com a busca que enxerga fora do form', () => {
  for (const modal of MODAIS) {
    const js = ler(...modal.js);

    // `querySelector` dos descendentes devolvia null: sem botão, não havia o
    // que desabilitar nem onde mostrar "Salvando...", e o segundo clique
    // parecia legítimo.
    assert.match(js, /BotaoAcao\?\.localizarBotaoEnvio\?\.\(form\)/,
      `${modal.nome}: não usa localizarBotaoEnvio`);
    assert.doesNotMatch(js, /const submitBtn = form\?\.querySelector/,
      `${modal.nome}: voltou a procurar só nos descendentes`);
  }
});

test('achado o botão, ele trava e avisa durante o salvamento', () => {
  for (const modal of MODAIS) {
    const js = ler(...modal.js);

    // A trava do segundo clique é a razão de tudo isto: sem `disabled`, achar
    // o botão não adiantaria nada.
    assert.match(js, /submitBtn\.disabled = isLoading/,
      `${modal.nome}: o botão não é desabilitado`);
    assert.match(js, /Salvando\.\.\./,
      `${modal.nome}: o botão não diz que está salvando`);

    // E a guarda no próprio envio, para o caso de o botão não existir. O modal
    // de edição a combina com `isCloning`, que é outra ação longa do mesmo
    // formulário — o teste aceita as duas formas.
    assert.match(js, /if \(isSubmitting[^)]*\) return;/,
      `${modal.nome}: o envio não se protege do segundo disparo`);
  }
});

test('a busca do botão é exportada, e é uma só', () => {
  const util = ler('utils', 'botaoAcao.js');

  // Duas buscas diferentes pelo mesmo botão divergem na primeira mudança — foi
  // assim que Produtos ficou sem travar o segundo clique enquanto o resto do
  // app travava.
  assert.match(util, /function localizarBotaoEnvio\(form\)/);
  assert.match(util, /^\s{4}localizarBotaoEnvio,$/m,
    'localizarBotaoEnvio não está no que o utilitário publica');

  // E ela procura pelo atributo `form`, que é o que o botão de fora usa.
  const corpo = /function localizarBotaoEnvio\(form\)[\s\S]*?\n  \}/.exec(util);
  assert.ok(corpo, 'não consegui recortar a função');
  assert.match(corpo[0], /form=/,
    'a busca não olha o atributo `form` — o botão de fora continua invisível');
});
