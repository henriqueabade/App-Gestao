/**
 * Sino — avisos de "algo seu" (01/10/2026): o que mudou e a nota/motivo
 * aparecem no aviso como no histórico; ícone e cor de cada tipo novo; o que
 * cada aviso abre. (O desenho foi conferido no Electron com avisos montados
 * pelo próprio backend.)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SINO = fs.readFileSync(path.join(__dirname, '..', 'notifications.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'styles', 'historico-social.css'), 'utf8');
const TIPOS = ['responsavel_novo', 'responsavel_saiu', 'registro_alterado', 'registro_excluido', 'registro_cancelado',
  'item_alterado', 'item_excluido', 'removido_historico', 'participante_removido', 'conta_alterada'];

test('cada tipo novo tem ícone e cor própria', () => {
  for (const tipo of TIPOS) {
    assert.match(SINO, new RegExp(`\\b${tipo}: 'fa-[a-z-]+',`), `ícone de ${tipo}`);
    assert.match(CSS, new RegExp(`\\.sino-avatar__tipo--${tipo}\\b`), `cor de ${tipo}`);
  }
});

test('a lista do que mudou e a nota vão por textContent, abaixo da mensagem', () => {
  assert.ok(SINO.includes("const lista = criar('ul', 'sino-aviso__mudancas');"));
  assert.ok(SINO.includes("mudancas.forEach((m) => lista.appendChild(criar('li', null, m)));"));
  assert.ok(SINO.includes("const nota = criar('span', 'sino-aviso__nota', n);"), 'a nota é texto, nunca HTML');
  assert.ok(SINO.includes('nota.title = n;'), 'o texto inteiro no title, quando passa de 5 linhas');
  assert.ok(!/innerHTML/.test(SINO), 'nada de innerHTML no sino');
  // A nota mantém as quebras de linha e corta em 5 linhas; o marcador da lista fica por dentro.
  assert.match(CSS, /\.sino-aviso__nota \{[^}]*white-space: pre-line;[^}]*-webkit-line-clamp: 5;/);
  assert.match(CSS, /\.sino-aviso__mudancas \{[^}]*list-style: disc inside;/);
  assert.match(CSS, /\[data-menu-theme="light"\] \.sino-aviso__nota \{/);
});

test('o que cada aviso abre: excluído e cadastro só marcam como lido; orçamento, pedido, Financeiro e Contabilidade abrem o módulo', () => {
  assert.ok(SINO.includes("const SEM_FICHA = new Set(['registro_excluido']);"));
  assert.ok(SINO.includes("if (SEM_FICHA.has(aviso.tipo) || aviso.origem === 'usuario') return;"));
  assert.ok(SINO.includes("const SO_O_MODULO = { financeiro: 'financeiro', contabil: 'contabilidade' };"));
  assert.ok(SINO.includes("window.OrcamentosModulo?.abrirVisualizar?.(aviso.registro_id)"));
  assert.ok(SINO.includes("window.PedidosModulo?.abrirVisualizar?.(aviso.registro_id)"));
  // Aviso de várias fichas (a planilha importada) abre só a lista do módulo.
  assert.match(SINO, /if \(!aviso\.registro_id\) \{\s+await window\.loadPage\?\.\(pagina\);\s+return;/);
});

test('a nota também vai para a notificação do Windows (cortada)', () => {
  assert.ok(SINO.includes("const nota = Array.isArray(aviso.notas) && aviso.notas[0] ? `“${aviso.notas[0].replace(/\\s+/g, ' ').slice(0, 160)}”` : '';"));
});
