/**
 * "FOLHA 1/x" do DANFE (backend/fiscal/folhas.js): o HTML leva a marca, o
 * main.js imprime uma vez para contar as páginas e outra com o total.
 * Antes o campo era fixo em "1/1" (defeito apontado pelo dono, 24/09/2026).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const folhas = require('./folhas');
const danfe = require('./danfe');

test('a marca do total: o DANFE pede, a troca põe o número', () => {
  const html = `<div>FOLHA 1/${folhas.MARCA_TOTAL_DE_FOLHAS}</div>`;
  assert.equal(folhas.pedeTotalDeFolhas(html), true);
  assert.equal(folhas.pedeTotalDeFolhas('<div>relatório</div>'), false);
  assert.equal(folhas.comTotalDeFolhas(html, 3), '<div>FOLHA 1/3</div>');
  const fonte = fs.readFileSync(path.join(__dirname, 'danfe.js'), 'utf8');
  assert.ok(fonte.includes('FOLHA 1/${MARCA_TOTAL_DE_FOLHAS}'), 'o DANFE não diz mais "1/1" fixo');
  assert.equal(typeof danfe.montarDanfeHtml, 'function');
});

test('conta as páginas do PDF pelos objetos /Type /Page (a árvore /Pages não conta)', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Pages /Count 3 >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj <</Type/Page>> endobj\n4 0 obj << /Type /Page /Parent 1 0 R >> endobj', 'latin1');
  assert.equal(folhas.contarPaginasPdf(pdf), 3);
  assert.equal(folhas.contarPaginasPdf(Buffer.alloc(0)), 0);
});

test('o main.js imprime duas vezes quando o HTML pede o total, nos dois caminhos do PDF', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  assert.ok(main.includes("const folhasDoPdf = require('./backend/fiscal/folhas');"));
  assert.ok(main.includes('const total = folhasDoPdf.contarPaginasPdf(primeira) || 1;'));
  assert.equal((main.match(/await imprimirHtmlEmPdf\(janela, arquivoTemp, html, \{/g) || []).length, 2, 'o PDF salvo e o PDF do e-mail');
});
