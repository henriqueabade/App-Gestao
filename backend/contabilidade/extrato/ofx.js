/**
 * Leitor de OFX (extrato bancário) — próprio, sem biblioteca. Lê as duas
 * formas que os bancos exportam:
 *
 *   - OFX 1.x (SGML): cabeçalho "OFXHEADER:100 … CHARSET:1252" e tags de valor
 *     SEM fechamento (`<TRNAMT>-50.00`), só os agrupadores fecham
 *     (`</STMTTRN>`). É o que o Gerenciador Financeiro do BB costuma gerar.
 *   - OFX 2.x (XML): `<?OFX …?>` e tudo fechado.
 *
 * O texto vira uma árvore: agrupador conhecido (STMTTRN, BANKACCTFROM…) abre
 * nível; qualquer outra tag é folha, com ou sem fechamento. Tudo puro.
 *
 * Saída de cada extrato (STMTRS): banco, agência, conta, moeda, período
 * (DTSTART/DTEND), saldo (LEDGERBAL) e os lançamentos: data (a do lançamento
 * no banco, cortada como texto), valor com sinal (crédito +, débito −), tipo
 * do banco (TRNTYPE), FITID, documento (CHECKNUM/REFNUM) e a descrição
 * (NAME + MEMO). Lançamento com valor zero (linhas de "SALDO") é pulado.
 */
const crypto = require('node:crypto');

/** Os agrupadores do OFX (o resto é folha). */
const AGRUPADORES = new Set([
  'OFX', 'SIGNONMSGSRSV1', 'SONRS', 'STATUS', 'FI', 'BANKMSGSRSV1', 'STMTTRNRS', 'STMTRS', 'BANKACCTFROM', 'BANKACCTTO',
  'BANKTRANLIST', 'STMTTRN', 'LEDGERBAL', 'AVAILBAL', 'BALLIST', 'BAL', 'PAYEE', 'CCACCTTO', 'CURRENCY', 'ORIGCURRENCY',
  'CREDITCARDMSGSRSV1', 'CCSTMTTRNRS', 'CCSTMTRS', 'CCACCTFROM', 'SIGNUPMSGSRSV1', 'MKTGINFO', 'INVSTMTMSGSRSV1'
]);

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

function decodificarEntidades(t) {
  return String(t)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, n) => ENTIDADES[n.toLowerCase()]);
}

/**
 * O texto do arquivo: OFX 1.x com CHARSET 1252 (ou ENCODING USASCII) é
 * Windows-1252; OFX 2.x declara o encoding no <?xml?>. Sem pista, UTF-8 — e,
 * se aparecer caractere inválido, Windows-1252.
 */
function textoDoArquivo(entrada) {
  if (typeof entrada === 'string') return entrada.replace(/^﻿/, '');
  const buffer = Buffer.isBuffer(entrada) ? entrada : Buffer.from(entrada || []);
  const cabeca = buffer.subarray(0, 600).toString('latin1');
  const utf8 = /encoding\s*=\s*["']utf-?8["']/i.test(cabeca) || /CHARSET:\s*UTF-?8/i.test(cabeca);
  const w1252 = /CHARSET:\s*(1252|WINDOWS-1252|ISO-8859-1)/i.test(cabeca) || /ENCODING:\s*USASCII/i.test(cabeca);
  if (w1252 && !utf8) return new TextDecoder('windows-1252').decode(buffer);
  const texto = buffer.toString('utf8').replace(/^﻿/, '');
  return !utf8 && texto.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : texto;
}

/** A árvore do OFX (a partir de <OFX>). */
function arvore(texto) {
  const inicio = texto.search(/<OFX[\s>]/i);
  if (inicio === -1) throw erro('Este arquivo não é um extrato OFX (não achei a tag <OFX>).');
  const tokens = texto.slice(inicio).match(/<[^>]*>|[^<]+/g) || [];
  const raiz = { tag: '#', filhos: [], valor: null };
  const pilha = [raiz];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith('<')) continue;
    if (t.startsWith('<?') || t.startsWith('<!')) continue;
    if (t.startsWith('</')) {
      const nome = t.slice(2, -1).trim().toUpperCase();
      for (let j = pilha.length - 1; j > 0; j--) {
        if (pilha[j].tag === nome) { pilha.length = j; break; }
      }
      continue;
    }
    const nome = t.slice(1, -1).trim().split(/\s/)[0].replace(/\/$/, '').toUpperCase();
    if (!nome) continue;
    const no = { tag: nome, filhos: [], valor: null };
    pilha[pilha.length - 1].filhos.push(no);
    if (AGRUPADORES.has(nome)) {
      pilha.push(no);
      continue;
    }
    // Folha: o texto até a próxima tag (e o fechamento dela, quando há).
    const prox = tokens[i + 1];
    if (prox !== undefined && !prox.startsWith('<')) {
      no.valor = decodificarEntidades(prox.trim());
      i++;
    }
    if (tokens[i + 1] && tokens[i + 1].replace(/\s/g, '').toUpperCase() === `</${nome}>`) i++;
  }
  return raiz;
}

function achar(no, tag) {
  for (const f of no?.filhos || []) {
    if (f.tag === tag) return f;
    const dentro = achar(f, tag);
    if (dentro) return dentro;
  }
  return null;
}

function todos(no, tag, lista = []) {
  for (const f of no?.filhos || []) {
    if (f.tag === tag) lista.push(f);
    else todos(f, tag, lista);
  }
  return lista;
}

/** O valor da primeira folha `tag` DIRETAMENTE dentro do nó (ou em qualquer nível, com `fundo`). */
function valor(no, tag, fundo = false) {
  const f = fundo ? achar(no, tag) : (no?.filhos || []).find(x => x.tag === tag);
  const v = f?.valor;
  return v === null || v === undefined || v === '' ? null : String(v);
}

/** '20260805120000[-3:BRT]' → '2026-08-05' (a data do banco, cortada como texto). */
function dataOfx(texto) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(texto || '').trim());
  if (!m) return null;
  const [, a, mes, d] = m;
  if (Number(mes) < 1 || Number(mes) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${a}-${mes}-${d}`;
}

/** '-1.234,56', '-1234.56', '1234,5' → número; inválido → null. */
function valorOfx(texto) {
  let t = String(texto ?? '').trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

const limpar = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const digitos = t => String(t ?? '').replace(/\D/g, '');

/** A descrição do lançamento: NAME e MEMO, sem repetir o mesmo texto. */
function descricaoDe(no) {
  const partes = [valor(no, 'NAME'), valor(no, 'MEMO')].map(limpar).filter(Boolean);
  return [...new Set(partes)].join(' — ') || null;
}

/**
 * Lê o OFX inteiro. Devolve `{ versao, extratos: [...], avisos }`; recusa o
 * que não é OFX ou não tem extrato de conta.
 */
function lerOfx(entrada) {
  const texto = textoDoArquivo(entrada);
  if (!texto.trim()) throw erro('O arquivo está vazio.');
  if (texto.length > 20 * 1024 * 1024) throw erro('O arquivo é grande demais para um extrato OFX.');
  const raiz = arvore(texto);
  const versao = /OFXHEADER:\s*100/i.test(texto) || /DATA:\s*OFXSGML/i.test(texto) ? '1.x (SGML)' : (/<\?OFX/i.test(texto) ? '2.x (XML)' : 'desconhecida');
  const extratos = todos(raiz, 'STMTRS').map(st => {
    const conta = achar(st, 'BANKACCTFROM');
    const lista = achar(st, 'BANKTRANLIST');
    const saldo = achar(st, 'LEDGERBAL');
    const lancamentos = [];
    let zerados = 0;
    let invalidos = 0;
    for (const t of todos(lista, 'STMTTRN')) {
      const data = dataOfx(valor(t, 'DTPOSTED'));
      const v = valorOfx(valor(t, 'TRNAMT'));
      if (!data || v === null) { invalidos++; continue; }
      if (v === 0) { zerados++; continue; }
      lancamentos.push({
        data,
        valor: v,
        tipo: v > 0 ? 'credito' : 'debito',
        tipo_banco: limpar(valor(t, 'TRNTYPE')).toUpperCase() || null,
        identificador: limpar(valor(t, 'FITID')) || null,
        documento: limpar(valor(t, 'CHECKNUM') || valor(t, 'REFNUM')) || null,
        descricao: descricaoDe(t)
      });
    }
    return {
      moeda: limpar(valor(st, 'CURDEF')).toUpperCase() || null,
      banco: digitos(valor(conta, 'BANKID')) || null,
      agencia: limpar(valor(conta, 'BRANCHID')) || null,
      conta: limpar(valor(conta, 'ACCTID')) || null,
      tipo_conta: limpar(valor(conta, 'ACCTTYPE')).toUpperCase() || null,
      inicio: dataOfx(valor(lista, 'DTSTART')),
      fim: dataOfx(valor(lista, 'DTEND')),
      saldo: saldo ? { valor: valorOfx(valor(saldo, 'BALAMT')), data: dataOfx(valor(saldo, 'DTASOF')) } : null,
      lancamentos,
      zerados,
      invalidos
    };
  });
  if (!extratos.length) {
    if (todos(raiz, 'CCSTMTRS').length) throw erro('Este OFX é de cartão de crédito: aqui entra o extrato da conta corrente.');
    throw erro('Não achei o extrato da conta neste OFX (falta o bloco STMTRS).');
  }
  return { versao, extratos };
}

/**
 * A identidade de cada lançamento na conta: data + valor + FITID (ou, sem
 * FITID, documento + descrição). Linhas idênticas no mesmo arquivo ganham um
 * número de ordem — reimportar o mesmo arquivo dá as mesmas identidades.
 * `hash_por_documento` (API do BB) ignora o identificador: o do BB só nasce
 * no dia seguinte, e a mesma linha não pode ter duas identidades. Pura.
 */
function comHash(contaId, lancamentos) {
  const vistos = new Map();
  return lancamentos.map(l => {
    const porId = l.identificador && !l.hash_por_documento;
    const base = [contaId, l.data, Number(l.valor).toFixed(2), porId ? `F:${l.identificador}` : `D:${l.documento || ''}|${(l.descricao || '').toUpperCase()}`].join('|');
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);
    return { ...l, hash: crypto.createHash('sha256').update(n > 1 ? `${base}#${n}` : base).digest('hex') };
  });
}

/**
 * A conta do arquivo é a conta escolhida? Compara só os dígitos, sem os zeros
 * à esquerda, aceitando o dígito verificador junto ou separado. Pura.
 */
function mesmaConta(arquivo, conta) {
  const sem0 = t => digitos(t).replace(/^0+/, '');
  const a = sem0(arquivo?.conta);
  const b = sem0(`${conta?.conta || ''}`);
  if (!a || !b) return null;
  const contaOk = a === b || a.startsWith(b) || b.startsWith(a);
  const ag = sem0(arquivo?.agencia);
  const agConta = sem0(`${conta?.agencia || ''}${conta?.agencia_dv || ''}`);
  const agSemDv = sem0(conta?.agencia);
  const agenciaOk = !ag || !agSemDv || ag === agConta || ag === agSemDv || ag.startsWith(agSemDv);
  return contaOk && agenciaOk;
}

module.exports = { AGRUPADORES, textoDoArquivo, arvore, dataOfx, valorOfx, lerOfx, comHash, mesmaConta };
