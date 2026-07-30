/**
 * Conversão de números na fronteira do back-end.
 *
 * O front já entrega tudo com ponto como separador decimal (ver
 * `src/utils/numericInput.js`), mas o banco é a última linha de defesa: se
 * qualquer caminho — importação, API externa, versão antiga do app — mandar
 * "1,5" ou "1.234,56", gravar a string crua estouraria a coluna numérica ou
 * salvaria um valor errado. Aqui a string é normalizada e devolvida como Number,
 * do jeito que a variável está declarada no restante do código.
 */

const MAX_DECIMAIS = 4;

/**
 * Converte para Number aceitando "," ou "." como separador decimal e pontos ou
 * vírgulas de milhar. Devolve `null` para vazio/inválido, para o chamador
 * decidir entre omitir o campo ou usar um padrão.
 */
function paraNumero(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  let texto = String(valor).trim();
  if (texto === '') return null;

  const negativo = /^-/.test(texto);
  texto = texto.replace(/[^\d.,]/g, '');
  if (texto === '') return null;

  const ultimaVirgula = texto.lastIndexOf(',');
  const ultimoPonto = texto.lastIndexOf('.');

  if (ultimaVirgula !== -1 && ultimoPonto !== -1) {
    // Os dois presentes: o que vem por último é o separador decimal e o outro
    // é separador de milhar ("1.234,56" e "1,234.56").
    const decimal = ultimaVirgula > ultimoPonto ? ',' : '.';
    const milhar = decimal === ',' ? '.' : ',';
    texto = texto.split(milhar).join('');
    texto = texto.replace(decimal, '.');
  } else if (ultimaVirgula !== -1) {
    texto = texto.replace(/,/g, '.');
  }

  // Sobrou mais de um ponto: só o último vale como decimal.
  const partes = texto.split('.');
  if (partes.length > 2) {
    texto = `${partes.slice(0, -1).join('')}.${partes[partes.length - 1]}`;
  }

  const numero = Number(negativo ? `-${texto}` : texto);
  return Number.isFinite(numero) ? numero : null;
}

/** Igual a `paraNumero`, mas limitado a `decimais` casas (padrão: 4). */
function paraDecimal(valor, decimais = MAX_DECIMAIS) {
  const numero = paraNumero(valor);
  if (numero === null) return null;
  const fator = 10 ** decimais;
  return Math.round(numero * fator) / fator;
}

/**
 * Normaliza in loco as chaves numéricas de um payload, preservando `undefined`
 * (campo não enviado) e `null` (limpeza intencional).
 */
function normalizarCamposNumericos(dados, chaves, decimais = MAX_DECIMAIS) {
  if (!dados || typeof dados !== 'object') return dados;
  for (const chave of chaves) {
    if (!Object.prototype.hasOwnProperty.call(dados, chave)) continue;
    const valor = dados[chave];
    if (valor === undefined || valor === null) continue;
    const convertido = paraDecimal(valor, decimais);
    dados[chave] = convertido === null ? null : convertido;
  }
  return dados;
}

module.exports = { MAX_DECIMAIS, paraNumero, paraDecimal, normalizarCamposNumericos };
