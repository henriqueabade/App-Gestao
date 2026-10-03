/**
 * Fase G (02/10/2026) — a leitura da fatura do cartão de crédito do BB em XLSX
 * (o dono: "a fatura vem sempre em XLSX"). O site do BB dá uma aba "Extrato",
 * tudo texto, em quatro colunas:
 *
 *   Razao Social | …           o cabeçalho (rótulo na coluna A, valor na B):
 *   Nome Cliente | …           titular, cartão, limite, vencimento, mínimo e
 *   Centro de Custo | …         total;
 *   Cartao | 9999…9999
 *   Limite Empresa | 99.999,99
 *   Data Vencimento | dd/mm/aaaa
 *   Valor Pagamento Minimo | …
 *   Valor Total | 9.999,99
 *   Data | Lancamentos | | Valor   o começo dos lançamentos
 *        | 0-RAZAO              o titular
 *        | SALDO FATURA ANTERIOR | R$ | 9.999,99
 *        | Pagamentos/Créditos  a seção (sem data nem valor)
 *   dd/mm | PGTO. COBRANCA … | R$ | -9.999,99
 *        | SubTotal | | 0,00   fecha o bloco (com o saldo anterior)
 *        | | US$ | 0,00
 *        | 0--RAZAO   Cartão N. 9999   o cartão (os 4 últimos dígitos)
 *   dd/mm | ESTABELECIMENTO (23) CIDADE (14) | R$ | 99,99
 *        | Supermercados        outra seção
 *        | Compras parceladas
 *   dd/mm | LOJA  PARC 06/10 CIDADE | R$ | 999,99   (a data é a da compra)
 *        | SubTotal | | 9.999,99
 *        | Total | | 9.999,99
 *
 * O número inteiro do cartão nunca sai daqui: só os 4 últimos dígitos.
 * As datas vêm sem ano: o ano sai do vencimento (e, nas parcelas, do número
 * da parcela). Puro, menos `lerXlsx`.
 */
const c = require('../../financeiro/comum');

const ROTULOS = {
  'razao social': 'titular', 'nome cliente': 'nome_cliente', 'centro de custo': 'centro_custo', cartao: 'cartao', 'limite empresa': 'limite',
  'data vencimento': 'vencimento', 'valor pagamento minimo': 'valor_minimo', 'valor total': 'valor_total'
};
const ENCARGO = /\b(IOF|ENCARGOS?|JUROS|MULTA|MORA|ANUIDADE|TARIFA|ROTATIVO)\b/i;
const PAGAMENTO = /\b(PGTO|PAGAMENTO|PAGTO)\b/i;

const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const chaveDoRotulo = t => semAcento(t).toLowerCase().replace(/\s+/g, ' ').trim();
const cent = v => Math.round(Number(v || 0) * 100);

/** "4.394,90", "-4.394,90", "R$ 9,99" ou número → número (null se não é dinheiro). Pura. */
function dinheiro(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? c.centavos(v) : null;
  const t = String(v ?? '').replace(/R\$|US\$/g, '').replace(/\s+/g, '').trim();
  if (!/^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$|^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isFinite(n) ? c.centavos(n) : null;
}

/** "dd/mm/aaaa" → ISO (null se não é data). Pura. */
function dataIso(t) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return c.dataValida(iso) ? iso : null;
}

const mesesEntre = (de, ate) => (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + Number(ate.slice(5, 7)) - Number(de.slice(5, 7));

/**
 * O ano da data "dd/mm" da fatura: a data não passa do vencimento; na parcela
 * k, a compra foi uns k meses antes do vencimento. Pura.
 */
function dataDaFatura(ddmm, vencimento, parcela = null) {
  const m = /^(\d{2})\/(\d{2})$/.exec(String(ddmm ?? '').trim());
  if (!m || !vencimento) return null;
  const ano = Number(vencimento.slice(0, 4));
  const candidatas = [ano, ano - 1, ano - 2, ano - 3].map(a => `${a}-${m[2]}-${m[1]}`).filter(d => c.dataValida(d) && d <= vencimento);
  if (!candidatas.length) return null;
  if (!parcela) return candidatas[0];
  return candidatas.sort((x, y) => Math.abs(mesesEntre(x, vencimento) - parcela) - Math.abs(mesesEntre(y, vencimento) - parcela) || y.localeCompare(x))[0];
}

/** "LOJA X       CIDADE" / "LOJA  PARC 06/10 CIDADE" → estabelecimento, cidade e a parcela. Pura. */
function descricaoDaLinha(texto) {
  const bruto = String(texto ?? '');
  // O nome do estabelecimento vem cortado em 13 letras: o "PARC" pode vir colado nele.
  const parc = /PARC\s*(\d{1,2})\/(\d{1,2})\b/i.exec(bruto);
  let estabelecimento;
  let cidade;
  if (parc) {
    estabelecimento = bruto.slice(0, parc.index);
    cidade = bruto.slice(parc.index + parc[0].length);
  } else if (bruto.length >= 30) {
    estabelecimento = bruto.slice(0, 23);
    cidade = bruto.slice(23);
  } else {
    estabelecimento = bruto;
    cidade = '';
  }
  const limpo = t => t.replace(/\s+/g, ' ').trim();
  return {
    descricao: limpo(estabelecimento) || limpo(bruto), cidade: limpo(cidade) || null,
    parcela_numero: parc ? Number(parc[1]) : null, parcela_total: parc ? Number(parc[2]) : null
  };
}

/** O tipo do lançamento: compra, crédito (estorno), pagamento da fatura ou encargo do banco. Pura. */
function tipoDaLinha({ secao, texto, valor }) {
  if (/pagamentos/i.test(semAcento(secao || ''))) return valor < 0 && PAGAMENTO.test(texto) ? 'pagamento' : 'credito';
  if (ENCARGO.test(texto)) return 'encargo';
  return valor < 0 ? 'credito' : 'compra';
}

/** O texto de uma célula do exceljs (texto, número, data, rich text, fórmula). Pura. */
function textoDaCelula(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}`;
  if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
  if (v.result !== undefined) return textoDaCelula(v.result);
  if (v.text !== undefined) return String(v.text);
  return String(v);
}

/** As linhas como chegam, com o número do cartão trocado pelos 4 últimos dígitos. Pura. */
function linhasSemCartao(linhas) {
  return linhas.map(l => l.map(t => String(t ?? '').replace(/\b\d{4}[ .]?\d{4}[ .]?\d{4}[ .]?(\d{4})\b/g, '**** **** **** $1').replace(/\b\d{2}(\d{4})\b(?=\s*$)/, m => m)));
}

/**
 * A fatura a partir das linhas (cada uma: [A, B, C, D] em texto). Devolve o
 * cabeçalho, os lançamentos, as conferências e `confere`. Pura.
 */
function analisarLinhas(linhas) {
  const L = c.lista(linhas).map(l => [0, 1, 2, 3].map(i => String((l || [])[i] ?? '').trim()));
  const inicio = L.findIndex(l => chaveDoRotulo(l[0]) === 'data' && /^lan[cç]amentos$/i.test(semAcento(l[1])));
  if (inicio < 0) throw c.erro('Não parece a fatura do cartão do BB em XLSX: falta a linha "Data | Lancamentos | Valor".', 422);
  const cab = {};
  for (const l of L.slice(0, inicio)) {
    const campo = ROTULOS[chaveDoRotulo(l[0])];
    if (campo) cab[campo] = l[1];
  }
  const vencimento = dataIso(cab.vencimento);
  if (!vencimento) throw c.erro('A fatura não traz a "Data Vencimento" (dd/mm/aaaa).', 422);
  const valorTotal = dinheiro(cab.valor_total);
  if (valorTotal === null) throw c.erro('A fatura não traz o "Valor Total".', 422);
  let cartaoFinal = (String(cab.cartao || '').replace(/\D/g, '').slice(-4)) || null;

  const lancamentos = [];
  const blocos = [];
  let bloco = { linhas: 0, soma: 0, cartao: null };
  let secao = null;
  let saldoAnterior = null;
  let totalDaLinha = null;
  let dolar = 0;
  for (const [a, texto, moeda, valorTxt] of L.slice(inicio + 1)) {
    const valor = dinheiro(valorTxt);
    if (!a && /^saldo fatura anterior/i.test(texto)) {
      saldoAnterior = valor || 0;
      bloco.soma = c.centavos(bloco.soma + saldoAnterior);
      continue;
    }
    if (!a && /^subtotal$/i.test(texto)) {
      blocos.push({ ...bloco, subtotal: valor });
      bloco = { linhas: 0, soma: 0, cartao: bloco.cartao };
      continue;
    }
    if (!a && /^total$/i.test(texto)) { totalDaLinha = valor; continue; }
    if (/^US\$$/i.test(moeda)) {
      if (valor) dolar = c.centavos(dolar + Math.abs(valor));
      continue;
    }
    if (!a && /^\d+--/.test(texto)) {
      const fim = /N\.?\s*(\d{4})\b/i.exec(texto);
      if (fim) { bloco.cartao = fim[1]; cartaoFinal = cartaoFinal || fim[1]; }
      secao = 'Compras';
      continue;
    }
    if (!a && /^\d+-/.test(texto)) continue;
    if (!a && texto && valor === null) { secao = texto; continue; }
    if (!/^\d{2}\/\d{2}$/.test(a) || valor === null) continue;
    const tipo = tipoDaLinha({ secao, texto, valor });
    // O pagamento da fatura não tem estabelecimento nem cidade: o texto inteiro.
    const d = tipo === 'pagamento' ? { descricao: texto.replace(/\s+/g, ' ').trim(), cidade: null, parcela_numero: null, parcela_total: null } : descricaoDaLinha(texto);
    const data = dataDaFatura(a, vencimento, d.parcela_total ? d.parcela_numero : null);
    lancamentos.push({
      ordem: lancamentos.length + 1, tipo, secao: secao ? String(secao).slice(0, 60) : null, data, descricao: d.descricao.slice(0, 120), cidade: d.cidade ? d.cidade.slice(0, 40) : null,
      valor, parcela_numero: d.parcela_total ? d.parcela_numero : null, parcela_total: d.parcela_total || null,
      valor_compra: d.parcela_total ? c.centavos(valor * d.parcela_total) : valor, texto
    });
    bloco.linhas++;
    bloco.soma = c.centavos(bloco.soma + valor);
  }
  if (bloco.linhas) blocos.push({ ...bloco, subtotal: null });

  const soma = c.centavos((saldoAnterior || 0) + lancamentos.reduce((s, l) => s + l.valor, 0));
  const conferencias = [
    { chave: 'total', rotulo: 'Saldo anterior + pagamentos e créditos + compras e encargos = valor total', esperado: valorTotal, obtido: soma, ok: cent(soma) === cent(valorTotal) },
    ...blocos.filter(x => x.subtotal !== null).map((x, i) => ({
      chave: `subtotal_${i + 1}`, rotulo: `SubTotal ${i + 1}${x.cartao ? ` (cartão final ${x.cartao})` : ''} = a soma das linhas do bloco`, esperado: x.subtotal, obtido: x.soma, ok: cent(x.soma) === cent(x.subtotal)
    }))
  ];
  if (totalDaLinha !== null) conferencias.push({ chave: 'total_linha', rotulo: 'A linha "Total" = o "Valor Total" do cabeçalho', esperado: valorTotal, obtido: totalDaLinha, ok: cent(totalDaLinha) === cent(valorTotal) });
  if (dolar) conferencias.push({ chave: 'dolar', rotulo: 'Há lançamento em dólar (US$): confira a conversão na fatura', esperado: 0, obtido: dolar, ok: false });
  return {
    titular: cab.titular ? String(cab.titular).slice(0, 200) : null, cartao_final: cartaoFinal, limite: dinheiro(cab.limite), vencimento, competencia: vencimento.slice(0, 7),
    valor_total: valorTotal, valor_minimo: dinheiro(cab.valor_minimo), saldo_anterior: saldoAnterior, lancamentos, conferencias, confere: conferencias.every(x => x.ok),
    linhas: linhasSemCartao(L)
  };
}

/** As linhas da aba "Extrato" (ou da primeira) de um XLSX. */
async function lerXlsx(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (_) {
    throw c.erro('Não é um arquivo XLSX (a fatura do cartão vem do site do BB em Excel).', 422);
  }
  const ws = wb.worksheets.find(w => /extrato/i.test(w.name)) || wb.worksheets[0];
  if (!ws) throw c.erro('O XLSX não tem nenhuma aba.', 422);
  const linhas = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const l = [1, 2, 3, 4].map(i => textoDaCelula(row.getCell(i).value));
    linhas[n - 1] = l;
  });
  return Array.from(linhas, l => l || ['', '', '', '']);
}

/** A fatura de um XLSX. */
async function analisar(buffer) {
  return analisarLinhas(await lerXlsx(buffer));
}

module.exports = { dinheiro, dataIso, dataDaFatura, descricaoDaLinha, tipoDaLinha, textoDaCelula, linhasSemCartao, analisarLinhas, lerXlsx, analisar };
