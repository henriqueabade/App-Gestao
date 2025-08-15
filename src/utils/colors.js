/**
 * Resolve uma cor textual para seu equivalente hexadecimal e expõe a função
 * globalmente apenas uma vez, mesmo com múltiplas inclusões do script.
 * Mantém assinatura pública utilizada pela UI.
 * @param {string} cor
 * @returns {string}
 */
(function (global) {
  if (global.resolveColorCss) return;

  let getColorFromText;
  if (global.colorParser) {
    getColorFromText = global.colorParser.getColorFromText;
  } else if (typeof require !== 'undefined') {
    ({ getColorFromText } = require('./colorParser'));
  }

  function resolveColorCss(cor = '') {
    if (!getColorFromText) {
      throw new Error('colorParser not available');
    }
    return getColorFromText(cor.trim());
  }

  if (typeof module !== 'undefined') {
    module.exports = { resolveColorCss };
  }
  global.resolveColorCss = resolveColorCss;
})(typeof window !== 'undefined' ? window : globalThis);
