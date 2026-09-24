/**
 * "FOLHA 1/x" do DANFE: o total de folhas só se sabe depois de imprimir (a
 * janela do PDF roda sem JavaScript, e o Chromium do Electron 28 não tem as
 * margens de página do CSS com `counter(pages)`). Então o HTML leva a marca
 * {{TOTAL_DE_FOLHAS}} e o processo principal imprime duas vezes: a primeira
 * conta as páginas, a segunda sai com o número certo (main.js).
 *
 * Antes o campo era fixo em "FOLHA 1/1", mesmo com o DANFE de 2 ou 3 folhas
 * (defeito apontado pelo dono, 24/09/2026). Tudo aqui é puro.
 */
const MARCA_TOTAL_DE_FOLHAS = '{{TOTAL_DE_FOLHAS}}';

/** O HTML pede o total de folhas? */
const pedeTotalDeFolhas = html => typeof html === 'string' && html.includes(MARCA_TOTAL_DE_FOLHAS);

/** Troca a marca pelo total. */
const comTotalDeFolhas = (html, total) => String(html).split(MARCA_TOTAL_DE_FOLHAS).join(String(total));

/**
 * Quantas páginas tem o PDF: os objetos "/Type /Page" (o "/Type /Pages" é a
 * árvore, não conta). O PDF do Chromium não usa fluxos de objetos, então eles
 * aparecem em texto.
 */
function contarPaginasPdf(bytes) {
  const texto = Buffer.from(bytes || []).toString('latin1');
  return (texto.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
}

module.exports = { MARCA_TOTAL_DE_FOLHAS, pedeTotalDeFolhas, comTotalDeFolhas, contarPaginasPdf };
