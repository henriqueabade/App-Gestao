/**
 * "Etiqueta Produto" do Visualizar pedido: a planilha (Excel) que alimenta a
 * impressão das etiquetas das peças. Uma linha por UNIDADE — 10 peças iguais
 * são 10 linhas —, com duas colunas: o nome da peça sem as medidas e a
 * variação (o acabamento), que é o último trecho do nome.
 *
 *   "Platter Pietra - M (25 x 50 x 3h) - Quartzito Nacarado"
 *     → Nome "Platter Pietra - M" · Variação "Quartzito Nacarado"
 */
const ExcelJS = require('exceljs');

/** Os trechos do nome são separados por " - " (hífen ou travessão entre espaços). */
const SEPARADOR = /\s+[-–—]\s+/;

const semMedidas = texto => String(texto || '')
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Nome e variação de uma peça. A variação é o ÚLTIMO trecho; o nome é todo o
 * resto, sem o que estiver entre parênteses (as medidas). Nome com um trecho
 * só não tem variação.
 */
function dividirNome(nomeCompleto) {
  const partes = String(nomeCompleto ?? '')
    .split(SEPARADOR)
    .map(p => p.trim())
    .filter(Boolean);
  if (!partes.length) return { nome: '', variacao: '' };
  if (partes.length === 1) return { nome: semMedidas(partes[0]), variacao: '' };
  return {
    nome: partes.slice(0, -1).map(semMedidas).filter(Boolean).join(' - '),
    variacao: partes[partes.length - 1]
  };
}

/** Quantas etiquetas o item pede: a quantidade inteira, nunca negativa. */
function unidadesDoItem(item) {
  const n = Math.round(Number(item?.quantidade));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * As linhas da planilha, na ordem dos itens do pedido (pelo id, porque o
 * upstream devolve na ordem de inserção e não honra `order`).
 */
function linhasDasEtiquetas(itens = []) {
  const ordenados = (Array.isArray(itens) ? itens : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  const linhas = [];
  for (const item of ordenados) {
    const { nome, variacao } = dividirNome(item.nome);
    if (!nome && !variacao) continue;
    for (let i = unidadesDoItem(item); i > 0; i--) linhas.push({ nome, variacao });
  }
  return linhas;
}

/**
 * "PED115_Jackie.xlsx": número do pedido e cliente separados por "_". Tira só
 * o que o Windows não aceita em nome de arquivo; acento e espaço ficam.
 */
function nomeDoArquivo(numero, cliente) {
  const limpar = t => String(t ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const partes = [limpar(numero) || 'Pedido', limpar(cliente)].filter(Boolean);
  return `${partes.join('_')}.xlsx`;
}

/** O .xlsx em bytes: aba "Etiquetas", cabeçalho "Nome" e "Variação". */
async function gerarPlanilha(linhas = []) {
  const livro = new ExcelJS.Workbook();
  livro.creator = 'Santíssimo Decor';
  const aba = livro.addWorksheet('Etiquetas');
  aba.columns = [
    { header: 'Nome', key: 'nome', width: 40 },
    { header: 'Variação', key: 'variacao', width: 32 }
  ];
  aba.getRow(1).font = { bold: true };
  aba.addRows(linhas);
  return Buffer.from(await livro.xlsx.writeBuffer());
}

module.exports = {
  dividirNome,
  unidadesDoItem,
  linhasDasEtiquetas,
  nomeDoArquivo,
  gerarPlanilha
};
