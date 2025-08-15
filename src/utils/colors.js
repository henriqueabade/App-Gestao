/**
 * Resolve uma cor textual para seu equivalente hexadecimal.
 * Mantém assinatura pública utilizada pela UI.
 * @param {string} cor
 * @returns {string}
 */
let getColorFromText;
if (typeof window !== 'undefined' && window.colorParser) {
  getColorFromText = window.colorParser.getColorFromText;
} else if (typeof require !== 'undefined') {
  ({ getColorFromText } = require('./colorParser'));
}

function resolveColorCss(cor = '') {
  if (!getColorFromText) {
    throw new Error('colorParser not available');
  }
  return getColorFromText((cor.split('/')[1] || cor).trim());
}

if (typeof window !== 'undefined') {
  window.resolveColorCss = resolveColorCss;
}

if (typeof module !== 'undefined') {
  module.exports = { resolveColorCss };
}
