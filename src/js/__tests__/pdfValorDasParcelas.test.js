/**
 * Linha "Valor das Parcelas" no PDF de pedido/orçamento (src/pdf/script.js).
 *
 * A linha repete o formato do campo "Prazo" — valores separados por barra, na
 * mesma ordem — para que o leitor case "30/60/90" com "61,62/1.661,62/861,62"
 * sem precisar de legenda.
 *
 * Ela só aparece quando há parcelamento de verdade: num pagamento à vista o
 * único valor já é o "Valor a Pagar" no fim do documento, e repeti-lo no
 * cabeçalho seria ruído. Por isso a função devolve string vazia — quem chama
 * omite o parágrafo inteiro, sem deixar rótulo órfão.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * `src/pdf/script.js` roda no navegador e não exporta nada. Recortamos a
 * função pelo texto — se ela for renomeada ou movida, este teste falha em vez
 * de passar testando o nada.
 */
function carregarFuncao() {
  const arquivo = path.join(__dirname, '..', '..', 'pdf', 'script.js');
  const fonte = fs.readFileSync(arquivo, 'utf8');
  const inicio = fonte.indexOf('function formatParcelasValores');
  const fim = fonte.indexOf('function formatEndereco');
  assert.ok(inicio !== -1 && fim > inicio, 'formatParcelasValores não foi encontrada em src/pdf/script.js');
  // eslint-disable-next-line no-new-func
  return new Function(`${fonte.slice(inicio, fim)} return formatParcelasValores;`)();
}

const formatParcelasValores = carregarFuncao();

test('formata os valores no mesmo padrão do prazo', () => {
  const resultado = formatParcelasValores({
    parcelas_detalhes: [
      { numero_parcela: 1, valor: 61.62 },
      { numero_parcela: 2, valor: 1661.62 },
      { numero_parcela: 3, valor: 861.62 }
    ]
  });

  // Sem "R$" e sem espaços: o campo "Prazo" ao lado é "30/60/90", e a linha
  // existe para ser lida em paralelo com ele.
  assert.strictEqual(resultado, '61,62/1.661,62/861,62');
});

test('respeita numero_parcela, não a ordem em que a API devolveu', () => {
  // O upstream devolve as linhas na ordem de inserção, que não é
  // necessariamente a ordem de vencimento — trocar a 1ª pela 3ª faria o
  // documento dizer que a primeira cobrança é a maior.
  const resultado = formatParcelasValores({
    parcelas_detalhes: [
      { numero_parcela: 3, valor: 861.62 },
      { numero_parcela: 1, valor: 61.62 },
      { numero_parcela: 2, valor: 1661.62 }
    ]
  });

  assert.strictEqual(resultado, '61,62/1.661,62/861,62');
});

test('à vista não gera a linha', () => {
  // Uma parcela só: o valor já aparece como "Valor a Pagar" no fim.
  assert.strictEqual(
    formatParcelasValores({ parcelas_detalhes: [{ numero_parcela: 1, valor: 2720.9 }] }),
    ''
  );
});

test('documento sem parcelas gravadas não quebra nem gera linha vazia', () => {
  for (const orc of [{ parcelas_detalhes: [] }, {}, { parcelas_detalhes: null }, null]) {
    assert.strictEqual(formatParcelasValores(orc), '', `falhou para ${JSON.stringify(orc)}`);
  }
});

test('centavos são sempre exibidos, mesmo em valor redondo', () => {
  // "1.000/500" pareceria um total, não um valor monetário. As duas casas
  // mantêm a coluna legível como dinheiro.
  const resultado = formatParcelasValores({
    parcelas_detalhes: [
      { numero_parcela: 1, valor: 1000 },
      { numero_parcela: 2, valor: 500.5 }
    ]
  });

  assert.strictEqual(resultado, '1.000,00/500,50');
});
