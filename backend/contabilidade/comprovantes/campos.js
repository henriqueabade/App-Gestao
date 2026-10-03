/**
 * Fase D: o que se lê de cada comprovante do BB, pelas linhas do texto (os
 * modelos do ZIP de setembro/2026):
 *
 *   boleto ......... "COMPROVANTE DE PAGAMENTO DE TITULOS" (e "…PARCIAL DE
 *                    TITULO", a fatura do cartão): banco, linha digitável (47
 *                    dígitos), beneficiário, beneficiário final, pagador (pode
 *                    não ser a empresa: ARTDECO), NR. DOCUMENTO, vencimento,
 *                    DATA DO PAGAMENTO, VALOR COBRADO, NR.AUTENTICACAO;
 *   convenio ....... "COMPROVANTE DE PAGAMENTO" + "Convenio …" (contas de
 *                    consumo, DAS): Codigo de Barras (48), Data do pagamento,
 *                    Valor Total, DOCUMENTO, AUTENTICACAO SISBB;
 *   pix ............ "Comprovante Pix": ID (o fim a fim), CNPJ DO PAGADOR,
 *                    VALOR, TARIFA, DATA, PAGO PARA, CPF/CNPJ (às vezes com
 *                    asteriscos), CHAVE PIX, INSTITUICAO, DOCUMENTO;
 *   credito_conta .. "COMPROVANTE DE PAGAMENTO ELETRONICO" (salário/crédito
 *                    em conta): PAGADOR, FAVORECIDO, CPF, DATA DE PAGAMENTO,
 *                    VALOR CREDITADO, EVENTO;
 *   transferencia, tributo, outro … o que vier de novo: data, valor e
 *                    autenticação pelos rótulos comuns.
 *
 * O "DOCUMENTO" é o número do lançamento no extrato (a chave da ligação);
 * nos títulos o "NR. DOCUMENTO" é o do boleto. O número do cabeçalho
 * (`controle`) também é tentado. Pura.
 */
const sem = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const dig = t => String(t ?? '').replace(/\D/g, '');

/** "9.999,99" ou "R$9.999,99" → número. Pura. */
function dinheiro(t) {
  const m = /(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})\s*$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "dd/mm/aaaa" (a primeira da linha) → 'YYYY-MM-DD'. Pura. */
function dataDe(t) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(t ?? ''));
  if (!m || Number(m[1]) > 31 || Number(m[2]) > 12) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** CPF/CNPJ: só os dígitos (com os zeros que o BB às vezes corta); com asterisco fica como veio (não serve de chave). Pura. */
function documentoDe(t) {
  const s = String(t ?? '').trim();
  if (!s) return null;
  if (s.includes('*')) return s.replace(/\s+/g, '').slice(0, 20);
  const d = dig(s);
  if (!d) return null;
  if (/\//.test(s) || d.length > 11) return d.padStart(14, '0').slice(-14);
  return d.padStart(11, '0');
}

const valorDoRotulo = (linhas, re) => {
  const l = linhas.find(x => re.test(sem(x)));
  return l === undefined ? null : l;
};
const depoisDe = (linha, rotulo) => String(linha ?? '').slice(String(linha ?? '').toUpperCase().indexOf(rotulo.toUpperCase()) + rotulo.length).trim();

/** O tipo do comprovante pelo título. Pura. */
function tipoDe(linhas) {
  const titulo = sem(linhas.find(l => /COMPROVANTE/.test(sem(l))) || '');
  if (/PAGAMENTO (PARCIAL )?DE TITULO/.test(titulo)) return 'boleto';
  if (/COMPROVANTE PIX/.test(titulo)) return 'pix';
  if (/PAGAMENTO ELETRONICO/.test(titulo)) return 'credito_conta';
  if (/TRANSFERENCIA/.test(titulo)) return 'transferencia';
  if (/TRIBUTO|DARF|GPS|FGTS|IMPOSTO/.test(titulo)) return 'tributo';
  if (/COMPROVANTE DE PAGAMENTO/.test(titulo) && linhas.some(l => /^CONVENIO\b/.test(sem(l).trim()))) return 'convenio';
  return 'outro';
}

/** O nome que vem na linha seguinte a um rótulo sozinho ("BENEFICIARIO:" → a próxima). Pura. */
function linhaSeguinte(linhas, re) {
  const i = linhas.findIndex(l => re.test(sem(l).trim()));
  return i >= 0 ? (linhas[i + 1] || '').trim() || null : null;
}

/** O CPF/CNPJ da primeira linha "CNPJ:"/"CPF:" depois de um rótulo. Pura. */
function documentoDepois(linhas, re) {
  const i = linhas.findIndex(l => re.test(sem(l).trim()));
  if (i < 0) return null;
  for (let k = i + 1; k < Math.min(linhas.length, i + 5); k++) {
    const m = /^(CNPJ|CPF)\s*:\s*(.+)$/.exec(sem(linhas[k]).trim());
    if (m) return documentoDe(m[2]);
  }
  return null;
}

/**
 * Os campos de um comprovante, pelas linhas. `nomeArquivo` ajuda quando falta
 * algo ("N - DDMMAAAA - Pagamento - 1.234,56.pdf"). Pura.
 */
function lerCampos(linhas, { nomeArquivo = null } = {}) {
  const ls = (linhas || []).map(l => String(l ?? ''));
  const tipo = tipoDe(ls);
  const c = {
    tipo, data: null, valor: null, tarifa: null, autenticacao: null, documento: null, controle: null,
    favorecido_nome: null, favorecido_documento: null, pagador_nome: null, pagador_documento: null,
    codigo: null, e2e: null, agencia: null, conta: null, vencimento: null, banco: null, segunda_via: false
  };
  c.segunda_via = ls.some(l => /SEGUNDA VIA/.test(sem(l)));
  // O cabeçalho: a data/hora da emissão e o número de controle.
  const dataCabecalho = dataDe(ls.slice(0, 4).find(l => dataDe(l)) || '');
  const controle = ls.slice(0, 5).map(l => /^\s*(\d{6,})\b/.exec(l)?.[1]).find(Boolean);
  if (controle) c.controle = controle.replace(/^0+(?=\d)/, '');
  // A conta debitada: a linha "AGENCIA … CONTA …" antes do primeiro separador (depois são as do favorecido).
  const sep = ls.findIndex(l => /^[=\-]{10,}/.test(l.trim()));
  const daEmpresa = ls.slice(0, sep < 0 ? ls.length : sep).find(l => /AGENCIA\s*:/.test(sem(l)) && /CONTA\s*:/.test(sem(l)));
  if (daEmpresa) {
    const ag = /AGENCIA\s*:\s*([\d\-]+)/.exec(sem(daEmpresa));
    const cc = /CONTA\s*:\s*([\d.\-]+)/.exec(sem(daEmpresa));
    c.agencia = ag ? dig(ag[1].split('-')[0]) : null;
    c.conta = cc ? dig(cc[1].split('-')[0]) : null;
  }
  // A autenticação (o que prova o pagamento no banco).
  const aut = valorDoRotulo(ls, /AUTENTICACAO/);
  if (aut) c.autenticacao = (/([0-9A-F]{1,4}(?:\.[0-9A-F]{1,4}){3,})\s*$/i.exec(aut.trim())?.[1] || aut.trim().split(/\s+/).pop()).slice(0, 60);
  const doc = ls.find(l => /^\s*DOCUMENTO\s*:/.test(sem(l)));
  if (doc) c.documento = dig(depoisDe(doc, 'DOCUMENTO:')).replace(/^0+(?=\d)/, '') || null;

  if (tipo === 'boleto') {
    const nr = ls.find(l => /^\s*NR\.?\s*DOCUMENTO/.test(sem(l)));
    if (nr && !c.documento) c.documento = (nr.trim().split(/\s+/).pop() || '').slice(0, 30) || null;
    const linhaDig = ls.map(l => l.trim()).find(l => /^\d{47}$/.test(l) || /^\d{44}$/.test(l));
    c.codigo = linhaDig || null;
    c.favorecido_nome = linhaSeguinte(ls, /^BENEFICIARIO:$/);
    c.favorecido_documento = documentoDepois(ls, /^BENEFICIARIO:$/);
    const final = linhaSeguinte(ls, /^BENEFICIARIO FINAL:$/);
    if (!c.favorecido_nome && final) c.favorecido_nome = final;
    c.pagador_nome = linhaSeguinte(ls, /^PAGADOR:$/);
    c.pagador_documento = documentoDepois(ls, /^PAGADOR:$/);
    const sepBanco = ls.findIndex(l => /^={10,}/.test(l.trim()));
    c.banco = sepBanco >= 0 ? (ls[sepBanco + 1] || '').trim() || null : null;
    c.vencimento = dataDe(valorDoRotulo(ls, /DATA DE VENCIMENTO/) || '');
    c.data = dataDe(valorDoRotulo(ls, /DATA DO PAGAMENTO/) || '');
    c.valor = dinheiro(valorDoRotulo(ls, /VALOR COBRADO/) || '') ?? dinheiro(valorDoRotulo(ls, /VALOR DO DOCUMENTO/) || '');
  } else if (tipo === 'convenio') {
    const conv = ls.find(l => /^CONVENIO\b/.test(sem(l).trim()));
    c.favorecido_nome = conv ? conv.trim().replace(/^Convenio\s+/i, '').trim() || null : null;
    // A linha do código com os números (o DARF/DAS da Receita traz "Código de Barras" também num texto antes).
    const i = ls.findIndex(l => /CODIGO DE BARRAS/.test(sem(l)) && /\d{5}/.test(l));
    if (i >= 0) c.codigo = dig(`${sem(ls[i]).split('CODIGO DE BARRAS')[1] || ''} ${/^\s*[\d\- ]+$/.test(ls[i + 1] || '') ? ls[i + 1] : ''}`).slice(0, 60) || null;
    c.data = dataDe(valorDoRotulo(ls, /DATA DO PAGAMENTO/) || '');
    c.valor = dinheiro(valorDoRotulo(ls, /VALOR TOTAL/) || '') ?? dinheiro(valorDoRotulo(ls, /^VALOR\b/) || '');
  } else if (tipo === 'pix') {
    const id = ls.find(l => /^\s*ID\s*:/.test(sem(l)));
    c.e2e = id ? depoisDe(id, 'ID:').replace(/\s+/g, '').slice(0, 40) || null : null;
    const pagador = ls.find(l => /CNPJ DO PAGADOR\s*:/.test(sem(l)));
    c.pagador_documento = pagador ? documentoDe(depoisDe(pagador, 'PAGADOR:')) : null;
    c.valor = dinheiro(valorDoRotulo(ls, /^\s*VALOR\s*:/) || '');
    c.tarifa = dinheiro(valorDoRotulo(ls, /^\s*TARIFA\s*:/) || '');
    c.data = dataDe(valorDoRotulo(ls, /^\s*DATA\s*:/) || '');
    const para = ls.findIndex(l => /^\s*PAGO PARA\s*:/.test(sem(l)));
    if (para >= 0) {
      c.favorecido_nome = depoisDe(ls[para], 'PAGO PARA:') || null;
      const m = /^(CNPJ|CPF)\s*:\s*(.+)$/.exec(sem(ls[para + 1] || '').trim());
      if (m) c.favorecido_documento = documentoDe(m[2]);
    }
  } else if (tipo === 'credito_conta') {
    const pag = ls.find(l => /^\s*PAGADOR\s*:/.test(sem(l)));
    c.pagador_nome = pag ? depoisDe(pag, 'PAGADOR:') || null : null;
    const fav = ls.findIndex(l => /^\s*FAVORECIDO\s*:/.test(sem(l)));
    if (fav >= 0) {
      c.favorecido_nome = depoisDe(ls[fav], 'FAVORECIDO:') || null;
      const m = /^(CNPJ|CPF)\s*:\s*(.+)$/.exec(sem(ls[fav + 1] || '').trim());
      if (m) c.favorecido_documento = documentoDe(m[2]);
    }
    const pdoc = ls.findIndex(l => /^\s*PAGADOR\s*:/.test(sem(l)));
    if (pdoc >= 0) {
      const m = /^(CNPJ|CPF)\s*:\s*(.+)$/.exec(sem(ls[pdoc + 1] || '').trim());
      if (m) c.pagador_documento = documentoDe(m[2]);
    }
    c.data = dataDe(valorDoRotulo(ls, /DATA DE PAGAMENTO/) || '');
    c.valor = dinheiro(valorDoRotulo(ls, /VALOR CREDITADO/) || '');
  }
  // O que ainda falta: pelos rótulos comuns, pelo cabeçalho e pelo nome do arquivo.
  if (!c.data) c.data = dataDe(valorDoRotulo(ls, /DATA (DO|DE) PAGAMENTO|DATA DA TRANSFERENCIA|^\s*DATA\s*:/) || '') || null;
  if (c.valor === null) {
    const comValor = ls.filter(l => /VALOR/.test(sem(l)) && dinheiro(l) !== null);
    c.valor = comValor.length ? dinheiro(comValor[comValor.length - 1]) : null;
  }
  const doNome = /(\d{2})(\d{2})(\d{4})\s*-\s*[^-]+-\s*([\d.]+,\d{2})/.exec(String(nomeArquivo || ''));
  if (!c.data && doNome) c.data = `${doNome[3]}-${doNome[2]}-${doNome[1]}`;
  if (c.valor === null && doNome) c.valor = dinheiro(doNome[4]);
  if (!c.data) c.data = dataCabecalho;
  for (const k of ['favorecido_nome', 'pagador_nome', 'banco']) if (c[k]) c[k] = c[k].replace(/\s+/g, ' ').slice(0, 200);
  return c;
}

/** O rótulo do tipo para a tela. */
const TIPOS = { boleto: 'Boleto (título)', convenio: 'Conta de consumo / convênio', pix: 'Pix', credito_conta: 'Crédito em conta', transferencia: 'Transferência', tributo: 'Tributo', outro: 'Outro' };

module.exports = { TIPOS, dinheiro, dataDe, documentoDe, tipoDe, lerCampos };
