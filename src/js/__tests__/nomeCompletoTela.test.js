/**
 * Nome e sobrenome no cadastro e o login pelo nome completo (pedido do dono,
 * 09/10/2026) — o lado da tela. As regras ficam em src/js/utils/nome-completo.js
 * (o mesmo arquivo serve ao navegador e ao Node); quem decide é a API.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');

test('no navegador o utilitário vira window.NomeCompleto (UMD)', () => {
  const janela = {};
  janela.self = janela;
  vm.createContext(janela);
  vm.runInContext(ler('js/utils/nome-completo.js'), janela);
  assert.equal(typeof janela.NomeCompleto.juntar, 'function');
  assert.equal(janela.NomeCompleto.juntar('Ana', 'Lima'), 'Ana Lima');
  assert.equal(janela.NomeCompleto.mensagemDasPartes('Ana', ''), 'Informe o sobrenome.');
});

test('tela de login: "E-mail ou nome completo" e o cadastro com Nome e Sobrenome obrigatórios', () => {
  const html = ler('login/login.html');
  assert.match(html, /<label for="email"[^>]*>E-mail ou nome completo<\/label>/);
  assert.match(html, /<input type="text" id="email"/, 'o campo aceita texto (nome), não só e-mail');
  assert.match(html, /<input type="text" id="registerName"[^>]*autocomplete="given-name" required/);
  assert.match(html, /<input type="text" id="registerSobrenome"[^>]*autocomplete="family-name" required/);
  assert.match(html, /<label for="registerName"[^>]*>Nome<\/label>/);
  assert.match(html, /<label for="registerSobrenome"[^>]*>Sobrenome<\/label>/);
  assert.match(html, /id="registerNomeErro" class="cadastro-campo-erro hidden" role="alert"/);
  assert.ok(html.indexOf('../js/utils/nome-completo.js') > html.indexOf('../js/utils/senha-forte.js'));
  assert.ok(!/Nome completo<\/label>/.test(html), 'o campo único "Nome completo" saiu do cadastro');

  const css = ler('login/login.css');
  assert.match(css, /\.form-input\.campo-com-erro\s*\{/);
  assert.match(css, /\.cadastro-campo-erro\s*\{/);
});

test('cadastro na tela de login: junta os dois campos, confere antes e marca os campos do nome quando a API recusa', () => {
  const js = ler('login/loginRenderer.js');
  assert.ok(js.includes('window.NomeCompleto?.mensagemDasPartes(campoNome?.value, campoSobrenome?.value)'));
  assert.ok(js.includes('window.NomeCompleto.juntar(campoNome?.value, campoSobrenome?.value)'));
  assert.ok(js.includes("if (result.campo === 'nome') {"), 'o nome repetido (409 da API) marca os campos');
  assert.ok(js.includes("c?.classList.toggle('campo-com-erro', Boolean(mensagem));"));
  assert.ok(js.includes("[campoNome, campoSobrenome].forEach(c => c?.addEventListener('input', () => marcarErroNoNome('')));"), 'digitar de novo tira a marca');
});

test('Usuários › Novo usuário: Nome e Sobrenome obrigatórios, nome repetido marca os dois campos', () => {
  const html = ler('html/modals/usuarios/novo.html');
  assert.match(html, /<label for="novoUsuarioNome"[^>]*>Nome <span class="text-red-400">\*<\/span><\/label>/);
  assert.match(html, /<label for="novoUsuarioSobrenome"[^>]*>Sobrenome <span class="text-red-400">\*<\/span><\/label>/);
  assert.match(html, /<input id="novoUsuarioSobrenome" type="text"[^>]*class="w-full ctl-campo /);

  const js = ler('js/modals/usuario-novo.js');
  assert.ok(js.includes("sobrenome: document.getElementById('novoUsuarioSobrenome'),"));
  assert.ok(js.includes('window.NomeCompleto.mensagemDasPartes(dados.primeiroNome, dados.sobrenome)'));
  assert.ok(js.includes("if (corpo?.campo === 'nome') marcarErroNoNome(true);"));
  assert.ok(js.includes("sobrenome: inputs.sobrenome?.value || '',"), 'o rascunho guarda o sobrenome');

  assert.ok(ler('html/menu.html').includes('<script src="../js/utils/nome-completo.js"></script>'));
  // O campo com erro é do padrão: só a borda, a medida é a mesma.
  assert.match(ler('styles/controles.css'), /\.ctl-campo\[aria-invalid="true"\]\s*\{\s*border-color:/);
});

test('Editar usuário: o recado do backend (não o JSON cru) e o campo do nome marcado', () => {
  const js = ler('js/modals/usuario-editar.js');
  assert.ok(js.includes("if (corpo?.campo === 'nome') inputs.nome?.setAttribute('aria-invalid', 'true');"));
  assert.ok(js.includes("throw new Error(corpo?.error || texto || 'Não foi possível salvar os dados pessoais.');"));
});
