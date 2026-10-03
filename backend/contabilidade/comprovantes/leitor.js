/**
 * Fase D (02/10/2026): ler o que o BB entrega — o ZIP do site com os
 * comprovantes (ou os PDFs soltos) — sem biblioteca nova:
 *
 *   ZIP ... o diretório central e cada arquivo (guardado ou "deflate", pelo
 *           zlib do Node); limites de quantidade e de tamanho contra ZIP
 *           malicioso;
 *   PDF ... o comprovante do BB é uma folha A4 só de texto, feita no
 *           navegador (jsPDF 1.5.2, sem compressão, sem assinatura digital):
 *           um bloco BT…ET com a fonte (Courier 8), a entrelinha (TL 9,2), a
 *           posição da primeira linha (Td 28,35 813,54) e cada linha num
 *           "T* (…) Tj". O leitor entende os operadores de texto mais comuns
 *           (Tf, TL, Td, TD, Tm, T*, Tj, ', ", TJ) e devolve cada linha com a
 *           posição — e diz se o PDF é desse formato simples (o que o app sabe
 *           refazer idêntico, pdf.js).
 *
 * O texto vem em WinAnsiEncoding (os acentos são bytes de 0xA0 a 0xFF).
 *
 * Fase C (02/10/2026): os PDFs mensais das aplicações (Rende Fácil, CDB) são
 * impressos pelo navegador (Skia), com fontes Type0/Identity-H — cada letra é
 * um código de 2 bytes traduzido pelo mapa /ToUnicode da fonte. O leitor
 * entende esse mapa (bfchar e bfrange) e, com `todasPaginas`, lê todas as
 * páginas (`paginasLidas`). Para o comprovante do BB nada muda.
 * Tudo aqui é puro (Buffer → objetos).
 */
const zlib = require('zlib');

const MAX_ARQUIVOS_ZIP = 500;
const MAX_BYTES_DESCOMPACTADOS = 60 * 1024 * 1024;

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

// ------------------------------------------------------------------ ZIP

/** O nome do arquivo no ZIP: UTF-8 (bit 11) ou, sem ele, UTF-8 se for válido, senão CP437/latin1. Pura. */
function nomeDoZip(bytes, utf8) {
  const texto = bytes.toString('utf8');
  if (utf8 || !texto.includes('�')) return texto;
  return bytes.toString('latin1');
}

/**
 * Os arquivos de um ZIP: `[{ nome, dados }]` (pastas de fora). Lê pelo
 * diretório central; "guardado" (0) e "deflate" (8). Pura.
 */
function lerZip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw erro('O arquivo não é um ZIP.');
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw erro('O ZIP está incompleto (sem o diretório central).');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  if (total > MAX_ARQUIVOS_ZIP) throw erro(`O ZIP tem mais de ${MAX_ARQUIVOS_ZIP} arquivos.`, 413);
  const saida = [];
  let somados = 0;
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw erro('O ZIP está estragado (diretório central).');
    const flags = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const compactado = buf.readUInt32LE(p + 20);
    const tamanho = buf.readUInt32LE(p + 24);
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = nomeDoZip(buf.subarray(p + 46, p + 46 + lenNome), Boolean(flags & 0x800));
    p += 46 + lenNome + lenExtra + lenComentario;
    if (nome.endsWith('/')) continue;
    if (flags & 0x1) throw erro(`"${nome}" está protegido por senha no ZIP.`);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw erro('O ZIP está estragado (cabeçalho local).');
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const bruto = buf.subarray(inicio, inicio + compactado);
    somados += tamanho;
    if (somados > MAX_BYTES_DESCOMPACTADOS) throw erro('O ZIP descompactado passa do limite.', 413);
    let dados;
    if (metodo === 0) dados = Buffer.from(bruto);
    else if (metodo === 8) dados = zlib.inflateRawSync(bruto, { maxOutputLength: Math.max(tamanho, 1) + 1024 });
    else throw erro(`"${nome}" usa uma compressão que o app não lê (${metodo}).`);
    saida.push({ nome: nome.split('/').pop(), caminho: nome, dados });
  }
  return saida;
}

// ------------------------------------------------------------------ PDF

/** WinAnsiEncoding de 0x80 a 0x9F (o resto é latin1). */
const WIN_ANSI = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ'
};

/** Bytes de uma string do PDF (WinAnsi) → texto. Pura. */
function textoWinAnsi(bytes) {
  let s = '';
  for (const b of bytes) s += WIN_ANSI[b] || String.fromCharCode(b);
  return s;
}

/** Os objetos do PDF: Map(numero → { dict (texto), stream (Buffer|null) }). Pura. */
function objetos(buf) {
  const texto = buf.toString('latin1');
  const mapa = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(texto))) {
    const inicio = m.index + m[0].length;
    const fim = texto.indexOf('endobj', inicio);
    if (fim < 0) break;
    const corpo = texto.slice(inicio, fim);
    const s = /stream\r?\n/.exec(corpo);
    let dict = corpo;
    let stream = null;
    if (s) {
      dict = corpo.slice(0, s.index);
      const dadosIni = inicio + s.index + s[0].length;
      const lenDireto = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dadosFim = texto.indexOf('endstream', dadosIni);
      if (lenDireto && dadosIni + Number(lenDireto[1]) <= dadosFim) dadosFim = dadosIni + Number(lenDireto[1]);
      stream = buf.subarray(dadosIni, dadosFim);
      if (/\/FlateDecode/.test(dict)) {
        try { stream = zlib.inflateSync(stream); } catch (_) { stream = zlib.inflateSync(Buffer.concat([stream, Buffer.alloc(0)]), { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
      }
    }
    mapa.set(Number(m[1]), { dict, stream });
    re.lastIndex = fim + 6;
  }
  return mapa;
}

const ref = (texto, chave) => {
  const m = new RegExp(`/${chave}\\s+(\\d+)\\s+\\d+\\s+R`).exec(texto);
  return m ? Number(m[1]) : null;
};

/** O dicionário (texto) de /Chave: direto `<< … >>` ou pela referência. */
function dicionario(texto, chave, objs) {
  const i = texto.indexOf(`/${chave}`);
  if (i < 0) return '';
  const resto = texto.slice(i + chave.length + 1).trimStart();
  if (resto.startsWith('<<')) {
    let nivel = 0;
    for (let k = 0; k < resto.length - 1; k++) {
      if (resto[k] === '<' && resto[k + 1] === '<') { nivel++; k++; continue; }
      if (resto[k] === '>' && resto[k + 1] === '>') { nivel--; k++; if (nivel === 0) return resto.slice(0, k + 1); }
    }
    return resto;
  }
  const r = /^(\d+)\s+\d+\s+R/.exec(resto);
  return r ? (objs.get(Number(r[1]))?.dict || '') : '';
}

// ------------------------------------------------------------------ o conteúdo (operadores)

/** Os tokens de um conteúdo de página: números, nomes, strings (Buffer), arrays e operadores. Pura. */
function tokens(bytes) {
  const s = bytes;
  const saida = [];
  let i = 0;
  const ehBranco = c => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
  const ehDelim = c => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x2f || c === 0x25 || c === 0x7b || c === 0x7d;
  const pilhaArray = [];
  const empurrar = t => (pilhaArray.length ? pilhaArray[pilhaArray.length - 1].push(t) : saida.push(t));
  while (i < s.length) {
    const c = s[i];
    if (ehBranco(c)) { i++; continue; }
    if (c === 0x25) { while (i < s.length && s[i] !== 0x0a && s[i] !== 0x0d) i++; continue; }
    if (c === 0x28) {
      const out = [];
      let nivel = 1;
      i++;
      while (i < s.length && nivel > 0) {
        const d = s[i];
        if (d === 0x5c) {
          const e = s[i + 1];
          const mapa = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
          if (mapa[e] !== undefined) { out.push(mapa[e]); i += 2; continue; }
          if (e >= 0x30 && e <= 0x37) {
            let oct = '';
            let k = i + 1;
            while (k < s.length && oct.length < 3 && s[k] >= 0x30 && s[k] <= 0x37) oct += String.fromCharCode(s[k++]);
            out.push(parseInt(oct, 8) & 0xff);
            i = k;
            continue;
          }
          if (e === 0x0d || e === 0x0a) { i += 2; if (e === 0x0d && s[i] === 0x0a) i++; continue; }
          i += 1;
          continue;
        }
        if (d === 0x28) nivel++;
        if (d === 0x29) { nivel--; if (nivel === 0) { i++; break; } }
        out.push(d);
        i++;
      }
      empurrar({ t: 'str', v: Buffer.from(out) });
      continue;
    }
    if (c === 0x3c && s[i + 1] !== 0x3c) {
      let hex = '';
      i++;
      while (i < s.length && s[i] !== 0x3e) { if (!ehBranco(s[i])) hex += String.fromCharCode(s[i]); i++; }
      i++;
      if (hex.length % 2) hex += '0';
      empurrar({ t: 'str', v: Buffer.from(hex, 'hex') });
      continue;
    }
    if (c === 0x3c || c === 0x3e) { i += 2; continue; }
    if (c === 0x5b) { pilhaArray.push([]); i++; continue; }
    if (c === 0x5d) { const a = pilhaArray.pop() || []; empurrar({ t: 'arr', v: a }); i++; continue; }
    if (c === 0x2f) {
      let n = '';
      i++;
      while (i < s.length && !ehBranco(s[i]) && !ehDelim(s[i])) n += String.fromCharCode(s[i++]);
      empurrar({ t: 'nome', v: n });
      continue;
    }
    let w = '';
    while (i < s.length && !ehBranco(s[i]) && !ehDelim(s[i])) w += String.fromCharCode(s[i++]);
    if (!w) { i++; continue; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) empurrar({ t: 'num', v: Number(w) });
    else empurrar({ t: 'op', v: w });
  }
  return saida;
}

const arred = n => Math.round(Number(n) * 1000) / 1000;

/** Hex de um CMap → texto (UTF-16BE). Pura. */
const deUtf16 = hex => {
  const b = Buffer.from(hex.length % 4 ? hex.padStart(Math.ceil(hex.length / 4) * 4, '0') : hex, 'hex');
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i));
  return s;
};

/**
 * O mapa /ToUnicode de uma fonte: `{ bytes, mapa: Map(código → texto) }`
 * (bytes = tamanho do código, do codespacerange). Entende bfchar e bfrange
 * (com destino inicial ou com a lista). Pura.
 */
function lerCmap(texto) {
  const mapa = new Map();
  const espaco = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(texto);
  const bytes = espaco ? Math.max(1, espaco[1].length / 2) : 2;
  for (const bloco of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of bloco[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) mapa.set(parseInt(m[1], 16), deUtf16(m[2]));
  }
  for (const bloco of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of bloco[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const ini = parseInt(m[1], 16);
      const fim = parseInt(m[2], 16);
      if (fim - ini > 0xffff) continue;
      if (m[4]) {
        const base = Buffer.from(m[4].padStart(Math.ceil(m[4].length / 4) * 4, '0'), 'hex');
        for (let c = ini; c <= fim; c++) {
          const d = Buffer.from(base);
          d.writeUInt16BE((d.readUInt16BE(d.length - 2) + (c - ini)) & 0xffff, d.length - 2);
          mapa.set(c, deUtf16(d.toString('hex')));
        }
      } else {
        const destinos = [...m[5].matchAll(/<([0-9A-Fa-f]+)>/g)].map(x => deUtf16(x[1]));
        for (let c = ini; c <= fim && c - ini < destinos.length; c++) mapa.set(c, destinos[c - ini]);
      }
    }
  }
  return { bytes, mapa };
}

/** Bytes de uma string do PDF → texto pelo mapa da fonte. Pura. */
function textoPeloCmap(bytes, cmap) {
  let s = '';
  for (let i = 0; i + cmap.bytes - 1 < bytes.length; i += cmap.bytes) {
    let c = 0;
    for (let k = 0; k < cmap.bytes; k++) c = c * 256 + bytes[i + k];
    s += cmap.mapa.has(c) ? cmap.mapa.get(c) : '';
  }
  return s;
}

/**
 * Interpreta o texto de um conteúdo: cada Tj vira uma linha com a posição
 * (x, y), a fonte e o tamanho. Os blocos BT…ET separados. Também os
 * operadores vistos (para saber se é o formato simples). `cmaps` = Map(nome
 * da fonte no recurso → mapa ToUnicode), para as fontes Type0. Pura.
 */
function interpretar(conteudo, fontes = new Map(), cmaps = new Map()) {
  const lista = tokens(conteudo);
  const blocos = [];
  const operadores = new Set();
  const graficos = {};
  let pilha = [];
  let bloco = null;
  let fonte = null;
  let cmap = null;
  let tamanho = null;
  let tl = 0;
  let tm = [1, 0, 0, 1, 0, 0];
  let linha = [1, 0, 0, 1, 0, 0];
  const mover = (tx, ty) => {
    linha = [linha[0], linha[1], linha[2], linha[3], linha[4] + tx * linha[0] + ty * linha[2], linha[5] + tx * linha[1] + ty * linha[3]];
    tm = [...linha];
  };
  const escrever = (bytes, como) => {
    if (!bloco) return;
    bloco.linhas.push({ texto: cmap ? textoPeloCmap(bytes, cmap) : textoWinAnsi(bytes), x: arred(tm[4]), y: arred(tm[5]), fonte, tamanho, como });
  };
  for (const tk of lista) {
    if (tk.t !== 'op') { pilha.push(tk); continue; }
    const op = tk.v;
    operadores.add(op);
    const n = k => Number(pilha[pilha.length - k]?.v);
    switch (op) {
      case 'BT': bloco = { linhas: [] }; tm = [1, 0, 0, 1, 0, 0]; linha = [1, 0, 0, 1, 0, 0]; break;
      case 'ET': if (bloco) blocos.push(bloco); bloco = null; break;
      case 'Tf': {
        const nomeFonte = pilha[pilha.length - 2]?.v;
        fonte = fontes.get(nomeFonte) || nomeFonte || null;
        cmap = cmaps.get(nomeFonte) || null;
        tamanho = n(1);
        if (bloco && bloco.fonteNome === undefined) { bloco.fonteNome = nomeFonte; }
        break;
      }
      case 'TL': tl = n(1); if (bloco) bloco.entrelinha = tl; break;
      case 'Td': mover(n(2), n(1)); break;
      case 'TD': tl = -n(1); mover(n(2), n(1)); break;
      case 'Tm': linha = [n(6), n(5), n(4), n(3), n(2), n(1)]; tm = [...linha]; break;
      case 'T*': mover(0, -tl); break;
      case 'Tj': escrever(pilha[pilha.length - 1]?.v || Buffer.alloc(0), 'Tj'); break;
      case "'": mover(0, -tl); escrever(pilha[pilha.length - 1]?.v || Buffer.alloc(0), "'"); break;
      case '"': mover(0, -tl); escrever(pilha[pilha.length - 1]?.v || Buffer.alloc(0), '"'); break;
      case 'TJ': {
        const arr = pilha[pilha.length - 1]?.v || [];
        escrever(Buffer.concat(arr.filter(x => x.t === 'str').map(x => x.v)), 'TJ');
        break;
      }
      case 'w': graficos.w = n(1); break;
      case 'G': graficos.G = n(1); break;
      case 'g': graficos.g = n(1); break;
      default: break;
    }
    pilha = [];
  }
  if (bloco) blocos.push(bloco);
  return { blocos, operadores: [...operadores].sort(), graficos };
}

/**
 * Lê um PDF: `{ paginas, pagina: [largura, altura], producer, blocos,
 * operadores, graficos }`. Só a primeira página entra nos blocos (o
 * comprovante do BB tem uma). Lança se não for PDF.
 */
function lerPdf(buffer, { todasPaginas = false } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw erro('O arquivo não é um PDF.');
  const objs = objetos(buf);
  const paginas = paginasEmOrdem(objs);
  if (!paginas.length) throw erro('O PDF não tem página.');
  const producer = /\/Producer\s*\(([^)]*)\)/.exec(buf.toString('latin1'))?.[1] || null;
  const primeira = lerPagina(paginas[0], objs);
  const saida = { paginas: paginas.length, pagina: primeira.pagina, producer, ...primeira.lido };
  if (todasPaginas) saida.paginasLidas = paginas.map((p, i) => (i ? lerPagina(p, objs) : primeira).lido);
  return saida;
}

/** As páginas na ordem da árvore (/Pages → /Kids); sem árvore, na ordem dos objetos. Pura. */
function paginasEmOrdem(objs) {
  const ehPagina = o => /\/Type\s*\/Page\b(?!s)/.test(o?.dict || '');
  const raiz = [...objs.entries()].find(([, o]) => /\/Type\s*\/Pages\b/.test(o.dict) && !/\/Parent\s+\d+\s+\d+\s+R/.test(o.dict));
  const ordem = [];
  const vistos = new Set();
  const visitar = num => {
    if (vistos.has(num) || ordem.length > 2000) return;
    vistos.add(num);
    const o = objs.get(num);
    if (!o) return;
    if (ehPagina(o)) { ordem.push(o); return; }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
    if (kids) for (const m of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) visitar(Number(m[1]));
  };
  if (raiz) visitar(raiz[0]);
  return ordem.length ? ordem : [...objs.values()].filter(ehPagina);
}

/** Uma página: o tamanho, as fontes (com o mapa ToUnicode das Type0) e o texto interpretado. Pura. */
function lerPagina(pag, objs) {
  const caixa = /\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/.exec(pag.dict)
    || /\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/.exec(objs.get(ref(pag.dict, 'Parent'))?.dict || '');
  const pagina = caixa ? [arred(Number(caixa[3]) - Number(caixa[1])), arred(Number(caixa[4]) - Number(caixa[2]))] : null;
  const recursos = dicionario(pag.dict, 'Resources', objs) || dicionario(objs.get(ref(pag.dict, 'Parent'))?.dict || '', 'Resources', objs);
  const dictFontes = dicionario(recursos, 'Font', objs);
  const fontes = new Map();
  const cmaps = new Map();
  for (const m of dictFontes.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
    const dictFonte = objs.get(Number(m[2]))?.dict || '';
    const base = /\/BaseFont\s*\/([A-Za-z0-9_.+-]+)/.exec(dictFonte);
    fontes.set(m[1], base ? base[1] : m[1]);
    const toUnicode = ref(dictFonte, 'ToUnicode');
    if (/\/Subtype\s*\/Type0/.test(dictFonte) && toUnicode && objs.get(toUnicode)?.stream) {
      cmaps.set(m[1], lerCmap(objs.get(toUnicode).stream.toString('latin1')));
    }
  }
  const contRefs = [];
  const arr = /\/Contents\s*\[([^\]]*)\]/.exec(pag.dict);
  if (arr) for (const m of arr[1].matchAll(/(\d+)\s+\d+\s+R/g)) contRefs.push(Number(m[1]));
  else if (ref(pag.dict, 'Contents')) contRefs.push(ref(pag.dict, 'Contents'));
  const conteudo = Buffer.concat(contRefs.map(r => objs.get(r)?.stream).filter(Boolean).flatMap(x => [x, Buffer.from('\n')]));
  return { pagina, lido: interpretar(conteudo, fontes, cmaps) };
}

/**
 * As linhas da página como o olho lê (fase C): os pedaços de texto juntados
 * pela altura (`y`, com tolerância) e, em cada linha, as colunas pela
 * posição `x`. `[{ y, celulas: [{ x, texto }], texto }]`, de cima para baixo.
 * O navegador (Skia) imprime com o eixo y invertido (y cresce para baixo); o
 * iText, no eixo normal (y cresce para cima). A direção sai da ordem em que
 * o texto aparece no conteúdo: de um pedaço para o seguinte, a leitura desce
 * a folha na maioria das vezes (um "voto" por passo). Pura.
 */
function linhasDaPagina(lido, { tolerancia = 2 } = {}) {
  const pedacos = (lido.blocos || []).flatMap(b => b.linhas).filter(l => String(l.texto).trim() !== '' || l.texto === ' ');
  let cresce = 0;
  let diminui = 0;
  for (let k = 1; k < pedacos.length; k++) {
    const d = pedacos[k].y - pedacos[k - 1].y;
    if (d > tolerancia) cresce++;
    else if (d < -tolerancia) diminui++;
  }
  const desce = cresce >= diminui;
  const ordemY = (a, b) => (desce ? a.y - b.y : b.y - a.y);
  const linhas = [];
  for (const p of [...pedacos].sort((a, b) => ordemY(a, b) || a.x - b.x)) {
    let alvo = linhas.find(l => Math.abs(l.y - p.y) <= tolerancia);
    if (!alvo) { alvo = { y: p.y, pedacos: [] }; linhas.push(alvo); }
    alvo.pedacos.push(p);
  }
  return linhas.sort(ordemY).map(l => {
    const ordem = l.pedacos.sort((a, b) => a.x - b.x);
    // Pedaços colados (a mesma palavra em fontes diferentes) viram uma célula; o espaço grande separa colunas.
    const celulas = [];
    for (const p of ordem) {
      const ultima = celulas[celulas.length - 1];
      const fimAnterior = ultima ? ultima.x + ultima.largura : -Infinity;
      if (ultima && p.x - fimAnterior < Math.max(4, (p.tamanho || 10) * 0.9)) {
        ultima.texto += p.texto;
        ultima.largura = p.x - ultima.x + String(p.texto).length * (p.tamanho || 10) * 0.5;
      } else {
        celulas.push({ x: p.x, texto: p.texto, largura: String(p.texto).length * (p.tamanho || 10) * 0.5 });
      }
    }
    const limpas = celulas.map(c => ({ x: c.x, texto: c.texto.replace(/\s+/g, ' ').trim() })).filter(c => c.texto);
    return { y: l.y, celulas: limpas, texto: limpas.map(c => c.texto).join(' | ') };
  });
}

/**
 * O PDF é o comprovante simples do BB (o que o app refaz idêntico)? Uma
 * página, um bloco de texto, uma fonte e um tamanho, só Tf, TL, Td, T* e Tj, a
 * primeira linha pelo Td e cada uma das outras a uma entrelinha da anterior.
 * Devolve `{ ok, motivo, layout, linhas }`. Pura.
 */
function formatoSimples(lido) {
  const nao = motivo => ({ ok: false, motivo, layout: null, linhas: (lido.blocos || []).flatMap(b => b.linhas.map(l => l.texto)) });
  if (lido.paginas !== 1) return nao(`o PDF tem ${lido.paginas} páginas`);
  if (lido.blocos.length !== 1) return nao(`o PDF tem ${lido.blocos.length} blocos de texto`);
  const permitidos = new Set(['BT', 'ET', 'Tf', 'TL', 'Td', 'T*', 'Tj', 'w', 'G', 'g']);
  const outros = lido.operadores.filter(o => !permitidos.has(o));
  if (outros.length) return nao(`o PDF usa ${outros.join(', ')}`);
  const [bloco] = lido.blocos;
  const ls = bloco.linhas;
  if (!ls.length) return nao('o PDF não tem texto');
  const fonte = ls[0].fonte;
  const tamanho = ls[0].tamanho;
  if (ls.some(l => l.fonte !== fonte || l.tamanho !== tamanho)) return nao('o texto muda de fonte');
  const entrelinha = Number(bloco.entrelinha) || 0;
  for (let k = 1; k < ls.length; k++) {
    if (Math.abs(ls[k].x - ls[0].x) > 0.001 || Math.abs((ls[k - 1].y - ls[k].y) - entrelinha) > 0.001) return nao('as linhas não seguem a entrelinha');
  }
  return {
    ok: true, motivo: null,
    layout: {
      pagina: lido.pagina, fonte, tamanho, entrelinha, x: ls[0].x, y: ls[0].y,
      linha_espessura: lido.graficos.w ?? null, cor_traco: lido.graficos.G ?? null, cor_texto: lido.graficos.g ?? null
    },
    linhas: ls.map(l => l.texto)
  };
}

module.exports = {
  MAX_ARQUIVOS_ZIP, MAX_BYTES_DESCOMPACTADOS, WIN_ANSI, lerZip, textoWinAnsi, objetos, tokens, lerCmap, textoPeloCmap, interpretar, lerPdf, paginasEmOrdem, linhasDaPagina,
  formatoSimples
};
