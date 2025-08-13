const { getColorFromText } = require('./colorParser');

/**
 * Resolve uma cor textual para seu equivalente hexadecimal.
 * Mantém assinatura pública utilizada pela UI.
 * @param {string} cor
 * @returns {string}
 */
function resolveColorCss(cor = '') {
  return getColorFromText((cor.split('/')[1] || cor).trim());
}

if (typeof window !== 'undefined') {
  window.resolveColorCss = resolveColorCss;
}

module.exports = { resolveColorCss };
