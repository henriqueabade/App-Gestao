const colorMap = {
  branco: '#ffffff',
  preto: '#000000',
  vermelho: '#ff0000',
  azul: '#0000ff',
  verde: '#008000',
  amarelo: '#ffff00',
  roxo: '#800080',
  laranja: '#ffa500',
  rosa: '#ffc0cb',
  marrom: '#a52a2a',
  cinza: '#808080',
  bege: '#f5f5dc',
  prata: '#c0c0c0',
  dourado: '#ffd700',
  magenta: '#ff00ff',
  ciano: '#00ffff',
  offwhite: '#f5f5f5'
};

function resolveColorCss(cor = '') {
  const corSample = (cor.split('/')[1] || cor).trim();
  const key = corSample.toLowerCase().replace(/[\s-]+/g, '');
  return colorMap[key] || corSample;
}

window.resolveColorCss = resolveColorCss;
