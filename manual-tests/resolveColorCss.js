const { resolveColorCss } = require('../src/utils/colors');

const inputs = ['navy', '#7fff00', 'vermelho'];
for (const name of inputs) {
  console.log(name + ' -> ' + resolveColorCss(name));
}
