const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function obterHandler() {
  const inicio = fonte.indexOf("ipcMain.handle('usuarios:enviar-imagem'");
  const fim = fonte.indexOf("ipcMain.handle('registrar-usuario'", inicio);
  assert.notStrictEqual(inicio, -1, 'handler de envio da foto não encontrado');
  assert.notStrictEqual(fim, -1, 'fim do handler de envio da foto não encontrado');
  return fonte.slice(inicio, fim);
}

test('foto do cadastro usa a rota de avatar do usuário criado', () => {
  const handler = obterHandler();

  assert.match(handler, /`\/api\/usuarios\/\$\{idSeguro\}\/avatar`/);
  assert.match(handler, /method:\s*'PUT'/);
  assert.match(handler, /foto_usuario:\s*avatar/);
  assert.doesNotMatch(
    handler,
    /const path\s*=\s*`\/api\/perfil\/imagem/,
    'a rota de perfil atribui a foto ao usuário autenticado, não ao recém-criado'
  );
});

test('id do usuário criado é validado antes do upload', () => {
  const handler = obterHandler();

  assert.match(handler, /Number\.isInteger\(usuarioId\)/);
  assert.match(handler, /encodeURIComponent\(String\(usuarioId\)\)/);
});
