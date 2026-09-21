const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente } = require('./apoio/domMinimo');

/**
 * Senha forte e "Esqueceu a senha?" (fase 4 das correções de 21/09/2026).
 *
 * A regra (mínimo de 8, maiúscula, número e caractere especial) mora só em
 * src/js/utils/senha-forte.js e vale onde uma senha nasce ou muda: cadastro da
 * tela de login, Usuários › Novo usuário, Configurações › Dados pessoais e a
 * troca pelo código do e-mail. Aqui se trava a regra, a lista que marca os
 * requisitos enquanto se digita e a ligação de cada tela com ela.
 */

const RAIZ = path.join(__dirname, '..', '..', '..');
const ler = relativo => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
const SenhaForte = require('../utils/senha-forte');

test('a regra: 8+, maiúscula, número e especial; letra acentuada é letra e espaço não é especial', () => {
  assert.equal(SenhaForte.MINIMO, 8);
  for (const boa of ['Abcdef1!', 'Ábcdéf1@', 'Mesa#Posta2026', 'Ç1aaaaa_']) {
    assert.equal(SenhaForte.conferir(boa).valida, true, boa);
    assert.equal(SenhaForte.mensagem(boa), '');
  }
  assert.equal(SenhaForte.mensagem('Abcde1!'), 'A senha precisa ter pelo menos 8 caracteres.');
  assert.equal(SenhaForte.mensagem('abcdef1!'), 'A senha precisa ter uma letra maiúscula.');
  assert.equal(SenhaForte.mensagem('Abcdefg!'), 'A senha precisa ter um número.');
  assert.equal(SenhaForte.mensagem('Senha Forte 1'), 'A senha precisa ter um caractere especial.');
  assert.equal(SenhaForte.mensagem('éééééééé'), 'A senha precisa ter uma letra maiúscula, um número e um caractere especial.');
  assert.equal(SenhaForte.mensagem(null),
    'A senha precisa ter pelo menos 8 caracteres, uma letra maiúscula, um número e um caractere especial.');
  // Emoji conta como um caractere (e como especial), não como dois.
  assert.equal(SenhaForte.conferir('Ab1😀xyz').itens.find(i => i.chave === 'tamanho').ok, false);
});

test('a lista marca cada requisito enquanto se digita', () => {
  const { janela, documento, montar, disparar } = criarAmbiente();
  vm.createContext(janela);
  vm.runInContext(ler('src/js/utils/senha-forte.js'), janela);
  assert.ok(janela.SenhaForte, 'no navegador a regra fica em window.SenhaForte');

  montar('<input id="s" type="password"><ul id="r"></ul>');
  const campo = documento.getElementById('s');
  const lista = documento.getElementById('r');
  const controle = janela.SenhaForte.ligarLista(campo, lista);

  const marcados = () => lista.querySelectorAll('li').filter(li => li.classList.contains('senha-forte__item--ok')).map(li => li.dataset.requisito);
  assert.equal(lista.querySelectorAll('li').length, 4);
  assert.ok(lista.classList.contains('senha-forte'));
  assert.deepEqual(marcados(), []);

  campo.value = 'abcdefgh1';
  disparar(campo, 'input');
  assert.deepEqual(marcados(), ['tamanho', 'numero']);

  campo.value = 'Abcdefgh1!';
  disparar(campo, 'input');
  assert.deepEqual(marcados(), ['tamanho', 'maiuscula', 'numero', 'especial']);

  // Campo limpo por código (sem evento): quem limpa chama atualizar().
  campo.value = '';
  controle.atualizar();
  assert.deepEqual(marcados(), []);
});

test('tela de login: regra carregada antes do renderer e "Esqueceu a senha?" em dois passos, com código', () => {
  const html = ler('src/login/login.html');
  assert.ok(html.includes('href="../styles/senha-forte.css"'));
  const regra = html.indexOf('src="../js/utils/senha-forte.js"');
  assert.ok(regra > 0 && regra < html.indexOf('src="loginRenderer.js"'), 'senha-forte.js antes do loginRenderer.js');
  for (const id of ['resetPasswordForm', 'novaSenhaForm', 'jaTenhoCodigo', 'novaSenhaCodigo', 'novaSenha',
    'novaSenhaConfirma', 'novaSenhaRegras', 'registerSenhaRegras']) {
    assert.ok(html.includes(`id="${id}"`), `falta #${id}`);
  }
  assert.ok(!/link de recupera/i.test(html), 'não há mais link: o código é digitado aqui');

  const js = ler('src/login/loginRenderer.js');
  assert.match(js, /fetchApi\('\/password-reset',/);
  assert.match(js, /JSON\.stringify\(\{ email, codigo, novaSenha \}\)/);
  assert.match(js, /SenhaForte\?\.mensagem\(passwordReg\)/, 'o cadastro confere a regra antes de enviar');
  assert.match(js, /SenhaForte\?\.mensagem\(novaSenha\)/, 'a troca confere a regra antes de enviar');

  // A página antiga do link (nunca servida pelo backend) saiu.
  assert.equal(fs.existsSync(path.join(RAIZ, 'src/login/reset-password.html')), false);
  assert.equal(fs.existsSync(path.join(RAIZ, 'src/login/resetPasswordRenderer.js')), false);
});

test('Usuários › Novo usuário e Configurações usam a mesma regra e mostram a lista', () => {
  const menu = ler('src/html/menu.html');
  assert.ok(menu.includes('src="../js/utils/senha-forte.js"'));
  assert.ok(menu.includes('href="../styles/senha-forte.css"'));

  const novo = ler('src/html/modals/usuarios/novo.html');
  assert.ok(novo.includes('id="novoUsuarioSenhaRegras"'));
  assert.ok(novo.includes('Mínimo de 8 caracteres'));
  const novoJs = ler('src/js/modals/usuario-novo.js');
  assert.match(novoJs, /SenhaForte\?\.mensagem\(dados\.senha\)/);
  assert.match(novoJs, /SenhaForte\?\.ligarLista\(inputs\.senha/);

  const cfg = ler('src/html/configuracoes.html');
  assert.match(cfg, /id="personalDataPasswordRegras" class="senha-forte senha-forte--escuro hidden"/);
  const cfgJs = ler('src/js/configuracoes.js');
  assert.match(cfgJs, /window\.SenhaForte\.mensagem\(values\.senha\)/);
  assert.match(cfgJs, /Repita a nova senha para confirmar/);

  // A folha carrega depois do Tailwind: o .hidden precisa do par.
  assert.match(ler('src/styles/senha-forte.css'), /\.senha-forte\.hidden\s*\{\s*display:\s*none;/);

  for (const arquivo of ['src/js/modals/usuario-novo.js', 'src/js/configuracoes.js', 'src/login/loginRenderer.js',
    'backend/usuariosController.js', 'backend/localAuth.js']) {
    assert.ok(!/6 caracteres/.test(ler(arquivo)), `regra antiga de 6 caracteres em ${arquivo}`);
  }
});
