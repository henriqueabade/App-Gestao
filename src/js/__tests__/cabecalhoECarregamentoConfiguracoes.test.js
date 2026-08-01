const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..');

test('cabeçalhos principais usam a mesma classe de posicionamento', () => {
  for (const pagina of ['produtos', 'dashboard', 'financeiro', 'relatorios', 'configuracoes']) {
    const html = fs.readFileSync(path.join(SRC, 'html', `${pagina}.html`), 'utf8');
    assert.match(html, /class="[^"]*\bmodule-header\b[^"]*"/, `${pagina} sem module-header`);
  }

  const css = fs.readFileSync(path.join(SRC, 'css', 'menu.css'), 'utf8');
  assert.match(css, /\.module-header\s*\{[^}]*transform:\s*none\s*!important/s);
});

test('configurações publica sua promessa e o menu aguarda a inicialização', () => {
  const configuracoes = fs.readFileSync(path.join(SRC, 'js', 'configuracoes.js'), 'utf8');
  const menu = fs.readFileSync(path.join(SRC, 'js', 'menu.js'), 'utf8');

  assert.match(configuracoes, /moduleElement\.moduleReadyPromise\s*=\s*Promise\.resolve\(profileReady\)/);
  assert.doesNotMatch(configuracoes, /document\.addEventListener\('module-change'/,
    'o evento do menu não deve disparar uma segunda carga do perfil');
  assert.match(menu, /await module\.moduleReadyPromise/);
});
