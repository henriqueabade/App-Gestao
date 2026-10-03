/**
 * Fase D: refazer o comprovante do BB a partir dos dados guardados — a mesma
 * página, a mesma fonte, o mesmo tamanho, a mesma entrelinha e cada linha na
 * mesma posição (o comprovante é uma folha só de texto). É assim que o
 * arquivo original pode sair do servidor sem perder valor de prova: o que
 * prova o pagamento é o código de AUTENTICAÇÃO (conferível no banco), e o
 * texto refeito é conferido com o do original na hora de anexar.
 *
 * No pacote a reprodução leva, no pé da página, a linha "Reproduzido pelo
 * App-Gestão a partir do comprovante original do BB (arquivo …, SHA-256 …)" —
 * o app nunca apresenta a reprodução como arquivo emitido pelo BB. Sem o
 * rodapé (a conferência), o conteúdo é o do original.
 *
 * PDF 1.3 mínimo e determinístico (os mesmos dados dão os mesmos bytes),
 * fontes padrão em WinAnsiEncoding. Puro.
 */
const { WIN_ANSI } = require('./leitor');

const PARA_WIN_ANSI = new Map(Object.entries(WIN_ANSI).map(([codigo, ch]) => [ch, Number(codigo)]));
const PRODUCER = 'App-Gestao - reproducao de comprovante do BB';

/** Texto → bytes WinAnsi, com \ ( ) escapados (o que não existe vira "?"). Pura. */
function stringPdf(texto) {
  const bytes = [];
  for (const ch of String(texto ?? '')) {
    const cod = ch.codePointAt(0);
    let b;
    if (cod < 0x80 || (cod >= 0xa0 && cod <= 0xff)) b = cod;
    else if (PARA_WIN_ANSI.has(ch)) b = PARA_WIN_ANSI.get(ch);
    else b = 0x3f;
    if (b === 0x5c || b === 0x28 || b === 0x29) bytes.push(0x5c);
    if (b === 0x0a) { bytes.push(0x5c, 0x6e); continue; }
    if (b === 0x0d) { bytes.push(0x5c, 0x72); continue; }
    bytes.push(b);
  }
  return Buffer.from([0x28, ...bytes, 0x29]);
}

/** Número como o jsPDF escreve (até 2 casas, sem zeros sobrando no inteiro). Pura. */
function num(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

const NOMES_FONTE = new Set(['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Helvetica', 'Helvetica-Bold', 'Times-Roman']);

/** O bloco principal do conteúdo (o do comprovante), como o jsPDF escreve. Pura. */
function blocoPrincipal(layout, linhas) {
  const partes = [];
  if (layout.linha_espessura !== null && layout.linha_espessura !== undefined) partes.push(Buffer.from(`${num(layout.linha_espessura)} w\n`));
  if (layout.cor_traco !== null && layout.cor_traco !== undefined) partes.push(Buffer.from(`${num(layout.cor_traco)} G\n`));
  partes.push(Buffer.from(`BT\n/F1 ${num(layout.tamanho)} Tf\n${Number(layout.entrelinha).toFixed(2)} TL\n`));
  if (layout.cor_texto !== null && layout.cor_texto !== undefined) partes.push(Buffer.from(`${num(layout.cor_texto)} g\n`));
  partes.push(Buffer.from(`${Number(layout.x).toFixed(2)} ${Number(layout.y).toFixed(2)} Td\n`));
  linhas.forEach((l, i) => {
    if (i > 0) partes.push(Buffer.from('T* '));
    partes.push(stringPdf(l), Buffer.from(' Tj\n'));
  });
  partes.push(Buffer.from('ET\n'));
  return Buffer.concat(partes);
}

/** O rodapé da reprodução (Helvetica 6, cinza, no pé da página). Pura. */
function blocoRodape(linhas, layout) {
  if (!linhas?.length) return Buffer.alloc(0);
  const partes = [Buffer.from(`BT\n/F2 6 Tf\n7.00 TL\n0.35 g\n${Number(layout.x ?? 28.35).toFixed(2)} ${(18 + 7 * (linhas.length - 1)).toFixed(2)} Td\n`)];
  linhas.forEach((l, i) => {
    if (i > 0) partes.push(Buffer.from('T* '));
    partes.push(stringPdf(l), Buffer.from(' Tj\n'));
  });
  partes.push(Buffer.from('ET\n'));
  return Buffer.concat(partes);
}

/** O texto do rodapé, quebrado para caber na largura (Helvetica 6 ≈ 3 pt por letra). Pura. */
function quebrar(texto, max = 175) {
  const palavras = String(texto).split(/\s+/);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if ((atual ? `${atual} ${p}` : p).length > max && atual) { linhas.push(atual); atual = p; } else atual = atual ? `${atual} ${p}` : p;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** A frase do pé da reprodução. Pura. */
function rodapeDaReproducao({ nomeArquivo, sha256, autenticacao = null }) {
  return quebrar(`Reproduzido pelo App-Gestão a partir do comprovante original do BB (arquivo "${nomeArquivo || 'sem nome'}", SHA-256 ${sha256 || '—'}).`
    + ` Não é o arquivo emitido pelo banco${autenticacao ? `; a autenticação ${autenticacao} pode ser conferida no BB` : ''}.`);
}

/**
 * O PDF do comprovante: `layout` (o que o leitor achou) e `linhas`; `rodape`
 * = linhas do pé (a reprodução do pacote) ou nada (a conferência). Pura.
 */
function gerarPdf({ layout, linhas, rodape = [], titulo = 'Comprovante' }) {
  if (!layout || !Array.isArray(linhas)) throw new Error('Faltam o layout e as linhas do comprovante.');
  const [largura, altura] = layout.pagina || [595.28, 841.89];
  const fonte = NOMES_FONTE.has(layout.fonte) ? layout.fonte : 'Courier';
  const conteudo = Buffer.concat([blocoPrincipal(layout, linhas), blocoRodape(rodape, layout)]);
  const objetos = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(largura)} ${num(altura)}] /Resources << /ProcSet [/PDF /Text] /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`),
    Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /${fonte} /Encoding /WinAnsiEncoding >>`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    Buffer.concat([Buffer.from(`<< /Length ${conteudo.length} >>\nstream\n`), conteudo, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from('<< /Producer '), stringPdf(PRODUCER), Buffer.from(' /Title '), stringPdf(titulo), Buffer.from(' >>')])
  ];
  const partes = [Buffer.from('%PDF-1.3\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let posicao = partes[0].length;
  const offsets = [];
  objetos.forEach((o, i) => {
    offsets.push(posicao);
    const bloco = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    partes.push(bloco);
    posicao += bloco.length;
  });
  const xref = [`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`, ...offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  partes.push(Buffer.from(`${xref}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${posicao}\n%%EOF\n`));
  return Buffer.concat(partes);
}

module.exports = { PRODUCER, stringPdf, num, blocoPrincipal, quebrar, rodapeDaReproducao, gerarPdf };
