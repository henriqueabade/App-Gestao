/**
 * Botão "Etiquetas" (bordô) no rodapé do pedido enviado (pedido do dono,
 * 24/09/2026): gera o PDF das etiquetas das caixas pelo HTML do backend
 * (GET /api/fiscal/pedidos/:id/etiquetas). O desenho e as contas das
 * etiquetas estão em backend/fiscal/etiquetas.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const VISUALIZAR = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-visualizar.js'), 'utf8');
const VIS_HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'visualizar.html'), 'utf8');
const MENU_CSS = fs.readFileSync(path.join(RAIZ, 'css', 'menu.css'), 'utf8');

test('o botão bordô "Etiquetas": escondido de saída, aparece no pedido que saiu e gera o PDF', () => {
  assert.match(VIS_HTML, /<button id="visualizarPedidoEtiquetas" type="button" data-perm="ped\.view" class="hidden btn-etiquetas ctl-botao ctl-botao--pequeno text-white"[^>]*>Etiquetas<\/button>/);
  assert.match(MENU_CSS, /\.btn-etiquetas \{\s*background: #6a152c;/, 'bordô, e global (o Visualizar também abre por cima do Financeiro)');
  assert.ok(VISUALIZAR.includes('if (!botao || !pedidoJaSaiu(pedido)) return;'), 'só no pedido enviado ou entregue');
  assert.ok(VISUALIZAR.includes('fetchApi(`/api/fiscal/pedidos/${encodeURIComponent(id)}/etiquetas`)'));
  assert.ok(VISUALIZAR.includes("window.electronAPI?.salvarHtmlComoPdf?.({ html: corpo.html, nomeSugerido: corpo.nome, titulo: 'Salvar etiquetas em PDF' })"), 'o usuário escolhe onde salvar o PDF');
  assert.ok(VISUALIZAR.includes('ligarEtiquetas(data);'));
});
