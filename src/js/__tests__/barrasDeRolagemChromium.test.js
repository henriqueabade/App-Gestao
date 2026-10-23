// Barras de rolagem no Chromium 121+ (Electron 45): `scrollbar-width` e
// `scrollbar-color` desligam o ::-webkit-scrollbar do elemento (e o
// `scrollbar-color` é herdado). No Electron 28 elas não valiam, e o programa
// todo foi desenhado com o ::-webkit-scrollbar — ver o topo de styles/scroll.css.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..');

function arquivos(dir) {
  const lista = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['vendor', '__tests__', 'node_modules'].includes(e.name)) lista.push(...arquivos(p)); }
    else if (/\.(css|html)$/.test(e.name)) lista.push(p);
  }
  return lista;
}

const semComentarios = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
const blocos = t => [...semComentarios(t).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ seletores: m[1].trim(), corpo: m[2] }));

test('nenhum CSS do programa usa scrollbar-color (herdado, desliga a barra da casa)', () => {
  const achados = [];
  for (const f of arquivos(SRC)) {
    if (/scrollbar-color\s*:/.test(semComentarios(fs.readFileSync(f, 'utf8')))) achados.push(path.relative(SRC, f));
  }
  assert.deepEqual(achados, []);
});

test('scrollbar-width só para esconder, e sempre junto do ::-webkit-scrollbar { display: none }', () => {
  const problemas = [];
  for (const f of arquivos(SRC)) {
    const texto = fs.readFileSync(f, 'utf8');
    // Só quem declara a propriedade é analisado (o tailwind-offline é enorme).
    if (!/scrollbar-width\s*:/.test(semComentarios(texto))) continue;
    const todos = blocos(texto);
    for (const { seletores, corpo } of todos) {
      const m = /scrollbar-width\s*:\s*([^;]+)/.exec(corpo);
      if (!m) continue;
      const valor = m[1].trim();
      if (valor !== 'none') { problemas.push(`${path.relative(SRC, f)}: "${seletores}" usa scrollbar-width: ${valor}`); continue; }
      for (const seletor of seletores.split(',').map(s => s.trim())) {
        const escondida = todos.some(b => b.seletores.split(',').map(s => s.trim()).includes(`${seletor}::-webkit-scrollbar`) && /display\s*:\s*none/.test(b.corpo));
        if (!escondida) problemas.push(`${path.relative(SRC, f)}: "${seletor}" tem scrollbar-width: none sem ${seletor}::-webkit-scrollbar { display: none }`);
      }
    }
  }
  assert.deepEqual(problemas, []);
});

test('a barra da casa continua definida para todo elemento (6px) no scroll.css', () => {
  const css = fs.readFileSync(path.join(SRC, 'styles', 'scroll.css'), 'utf8');
  assert.match(css, /:where\(\*\)::-webkit-scrollbar \{\s*\n\s*width: 6px;\s*\n\s*height: 6px;/);
  assert.match(css, /#content::-webkit-scrollbar \{\s*\n\s*width: 6px;/);
});
