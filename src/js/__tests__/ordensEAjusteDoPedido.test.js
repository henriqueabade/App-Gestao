/**
 * Decisões do dono de 24/09/2026 (4ª rodada):
 *   A. "Pago em ou PARA QUANDO": data futura, até o vencimento da parcela,
 *      vira ORDEM DE PAGAMENTO — ocupa a parcela como um boleto, tem baixa à
 *      mão e cancelamento; a parcela com ordem não recebe boleto.
 *   B. No "Pagamento do pedido", as parcelas podem ter valores diferentes e
 *      somar MAIS (Adicional) ou MENOS (Desconto) que os itens, com
 *      justificativa; a parcela com boleto/pagamento/ordem fica travada; o
 *      Visualizar mostra a linha a mais nos itens.
 * O backend está em backend/cobranca/ordens.test.js, backend/pedidoPagamento.test.js
 * e backend/fiscal/xmlNfe.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const PAGAMENTOS = ler('js', 'modals', 'pedido-pagamentos-parcelas.js');
const PAG_HTML = ler('html', 'modals', 'pedidos', 'pagamentos-parcelas.html');
const PAGAMENTO_PEDIDO = ler('js', 'modals', 'pedido-pagamento.js');
const PAGAMENTO_HTML = ler('html', 'modals', 'pedidos', 'pagamento.html');
const VISUALIZAR = ler('js', 'modals', 'pedido-visualizar.js');
const VIS_HTML = ler('html', 'modals', 'pedidos', 'visualizar.html');
const GERAR = ler('js', 'modals', 'pedido-gerar-boletos.js');
const EXTERNOS = ler('js', 'modals', 'pedido-dados-externos.js');
const IMPORTAR = ler('js', 'modals', 'pedido-importar-boletos.js');
const PARCELAMENTO = path.join(RAIZ, 'js', 'utils', 'parcelamento.js');
const plano = v => JSON.parse(JSON.stringify(v));
const semEspacoFixo = s => String(s).replace(/\s/g, ' ');

function puras(fonte, inicio, fim, nomes) {
  const i = fonte.indexOf(inicio);
  const f = fonte.indexOf(fim, i);
  assert.ok(i !== -1 && f > i, 'bloco de funções puras não encontrado');
  return vm.runInContext(`${fonte.slice(i, f)}\n({ ${nomes.join(', ')} })`, vm.createContext({}));
}

/** O texto de uma função pelo nome (chaves balanceadas). */
function funcao(fonte, nome, extras = '') {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.ok(inicio !== -1, `sem a função ${nome}`);
  let nivel = 0;
  let i = fonte.indexOf(') {', inicio) + 2;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    if (fonte[i] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return vm.runInContext(`${extras}\n${fonte.slice(inicio, i + 1)}\n${nome}`, vm.createContext({}));
}

// ------------------------------------------------------------ A. ordens

test('ordem: "pago em ou para quando" — até hoje é pagamento; futuro até o vencimento é ordem; depois disso, recusa', () => {
  const f = puras(PAGAMENTOS, 'const MESES', '// ------------------------------------------------- fim das funções puras', ['modoDaData', 'situacaoDaParcela', 'acoesDaParcela']);
  const regra = { hoje: '2026-09-24', vencimentoParcela: '2026-10-20', podeOrdem: true };
  assert.strictEqual(f.modoDaData('2026-09-24', regra).modo, 'pagamento');
  assert.strictEqual(f.modoDaData('2026-09-01', regra).modo, 'pagamento');
  const ordem = f.modoDaData('2026-10-15', regra);
  assert.strictEqual(ordem.modo, 'ordem');
  assert.match(ordem.texto, /Ordem de pagamento para 15\/10\/2026: .*dê a baixa em "Ações"; passou da data sem baixa, ela fica atrasada desde 15\/10\/2026/);
  assert.match(f.modoDaData('2026-10-21', regra).texto, /no máximo até o vencimento da parcela \(20\/10\/2026\)/);
  assert.strictEqual(f.modoDaData('2026-10-15', { ...regra, podeOrdem: false }).modo, 'invalida', 'parcela com boleto, vencida ou paga não aceita ordem');

  const comOrdem = { situacao: 'aberta', ordem: { forma: 'Pix', data: '2026-10-15', valor: 1000 } };
  assert.deepStrictEqual(plano(f.situacaoDaParcela(comOrdem)).texto, 'Ordem · Pix · para 15/10/2026');
  const atrasada = plano(f.situacaoDaParcela({ ...comOrdem, situacao: 'atrasada', dias_atraso: 3 }));
  assert.deepStrictEqual([atrasada.classe, atrasada.texto], ['badge-warning', 'Ordem atrasada · 3 dias']);
  assert.deepStrictEqual(plano(f.acoesDaParcela(comOrdem, { podeRegistrar: true, podeEstornar: true })), ['baixar', 'cancelar_ordem']);
  assert.deepStrictEqual(plano(f.acoesDaParcela(comOrdem, { podeRegistrar: false })), []);
});

test('ordem: o modal cria, dá baixa e cancela pelas rotas; o rótulo virou "Pago em ou para quando"', () => {
  assert.ok(PAG_HTML.includes('>Pago em ou para quando <span'));
  assert.ok(PAGAMENTOS.includes('fetchApi(`/api/cobranca/pedidos/${id}/ordens`, comoJson({ numero_parcela: p.numero_parcela, data_prevista: data, valor, forma, observacao }))'));
  assert.ok(PAGAMENTOS.includes('fetchApi(`/api/cobranca/ordens/${encodeURIComponent(o.id)}/baixar`'));
  assert.ok(PAGAMENTOS.includes('fetchApi(`/api/cobranca/ordens/${encodeURIComponent(o.id)}/cancelar`'));
  assert.ok(PAGAMENTOS.includes("data.max = aceitaOrdem && p.vencimento_parcela ? p.vencimento_parcela : (estado?.hoje || '');"), 'o calendário vai até o vencimento da parcela');
  assert.ok(PAGAMENTOS.includes("(modo.modo === 'ordem' ? 'Agendar pagamento' : 'Registrar pagamento')"));
});

test('ordem ocupa a parcela nas outras telas: Visualizar, Gerar boletos, Boletos de fora e Importar', () => {
  const gerar = puras(GERAR, 'const ROTULO_STATUS', '/** O aviso depois de gerar', ['linhaDaParcela']);
  const linha = plano(gerar.linhaDaParcela({ parcela: { id: 1, numero_parcela: 1 }, tem_boleto_vivo: false, ordem: { forma: 'Pix', data: '2026-10-15' } }));
  assert.deepStrictEqual([linha.podeGerar, linha.rotulo], [false, 'Ordem · Pix']);
  assert.match(linha.detalhe, /para 15\/10\/2026 · para gerar boleto, cancele a ordem em "Pagamentos"/);

  const ext = puras(EXTERNOS, 'const TAMANHO_MAXIMO_DO_XML', '// ------------------------------------------------- fim das funções puras', ['estadoDaParcela']);
  assert.deepStrictEqual(plano(ext.estadoDaParcela({ ordem: { forma: 'Pix', data: '2026-10-15' } })), { tipo: 'paga', ordem: true, texto: 'Ordem · Pix · para 15/10/2026' });
  assert.ok(IMPORTAR.includes("' (com ordem)'"));
  assert.ok(VISUALIZAR.includes('if (linha?.ordem && !linha?.recebimento && !linha?.tem_boleto_vivo) {'), 'a coluna BOLETO mostra a ordem');
  assert.ok(VISUALIZAR.includes('!l?.recebimento && !l?.ordem);'), '"Gerar boletos" não conta a parcela com ordem como faltando');
});

// ------------------------------------------------ B. valor das parcelas

/** O duplo de DOM mínimo para o utilitário de parcelas (o mesmo recorte de parcelamento.test.js). */
function montarParcelamento() {
  const registro = new Map();
  const criar = (tag = 'div') => {
    const el = { tagName: String(tag).toUpperCase(), id: '', name: '', type: '', checked: false, disabled: false, textContent: '', className: '', filhos: [], dataset: {}, style: {}, _escutas: new Map(), _html: '' };
    el.classList = { add() {}, remove() {}, contains: () => false, toggle() {} };
    el.appendChild = f => { el.filhos.push(f); return f; };
    el.addEventListener = (t, fn) => { if (!el._escutas.has(t)) el._escutas.set(t, []); el._escutas.get(t).push(fn); };
    el.querySelector = sel => (sel?.startsWith('#') ? registro.get(sel.slice(1)) || null : null);
    el.querySelectorAll = sel => { const m = /\[name="([^"]+)"\]/.exec(sel || ''); return m ? [...registro.values()].filter(e => e.name === m[1]) : []; };
    Object.defineProperty(el, 'value', { get() { return el._value ?? ''; }, set(v) { el._value = v === null || v === undefined ? '' : String(v); } });
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html; },
      set(v) {
        el._html = String(v);
        if (!el._html.includes('<select')) return;
        const select = [...registro.values()].find(e => e.tagName === 'SELECT');
        if (!select) return;
        select.filhos = [];
        for (const [, valor] of el._html.matchAll(/<option value="(\d+)"/g)) { const op = criar('option'); op.value = valor; select.filhos.push(op); }
        for (const [, nome, valor] of el._html.matchAll(/name="([^"]+)" value="(\w+)"/g)) { const r = criar('input'); r.name = nome; r.value = valor; registro.set(`${nome}:${valor}`, r); }
      }
    });
    Object.defineProperty(el, 'options', { get() { return el.filhos.filter(f => f.tagName === 'OPTION'); } });
    return el;
  };
  const doc = { getElementById: id => registro.get(id) || null, createElement: criar };
  const sandbox = { document: doc, Array, Math, Number, String, Object, Map, parseInt, parseFloat, Intl, console, setTimeout, JSON };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(PARCELAMENTO, 'utf8'), sandbox, { filename: 'parcelamento.js' });
  const preparar = (id, n) => {
    const c = criar(); c.id = id; registro.set(id, c);
    const sel = criar('select'); sel.id = `${id}_count`; registro.set(sel.id, sel);
    for (const s of ['_rows', '_summary', '_minimo']) { const e = criar('div'); e.id = `${id}${s}`; registro.set(e.id, e); }
    for (let i = 0; i < n; i += 1) for (const s of ['amount', 'due']) { const e = criar('input'); e.id = `${id}_${s}_${i}`; registro.set(e.id, e); }
  };
  return { P: sandbox.Parcelamento, registro, preparar };
}

test('parcelas: com permitirDiferenca a soma diferente vira Adicional/Desconto; sem, continua "Faltante" (o orçamento não muda)', () => {
  const { P, registro, preparar } = montarParcelamento();
  preparar('a', 2);
  P.init('a', { getTotal: () => 38400, permitirDiferenca: true, prefill: { count: 2, mode: 'custom', items: [{ amount: 19200, dueInDays: 30 }, { amount: 20000, dueInDays: 60 }] } });
  const a = P.getData('a');
  assert.deepStrictEqual([a.canRegister, a.diferenca], [true, 800], 'quem chama pede a justificativa');
  assert.strictEqual(semEspacoFixo(registro.get('a_summary').textContent), 'Adicional: R$ 8,00');

  preparar('b', 2);
  P.init('b', { getTotal: () => 38400, prefill: { count: 2, mode: 'custom', items: [{ amount: 19200, dueInDays: 30 }, { amount: 18000, dueInDays: 60 }] } });
  const b = P.getData('b');
  assert.strictEqual(b.canRegister, false, 'sem a opção, a soma tem de bater (orçamento)');
  assert.match(semEspacoFixo(registro.get('b_summary').textContent), /^Faltante: R\$ 12,00$/);
});

test('parcelas: a travada fica só de leitura, com o aviso e o botão "Usar R$ X"; "Iguais" some', () => {
  const { P, registro, preparar } = montarParcelamento();
  preparar('t', 2);
  P.init('t', {
    getTotal: () => 38400, permitirDiferenca: true,
    travas: [{ atual: 19200, permitido: 19250, texto: 'Tem boleto do BB de R$ 192,50: o valor fica em R$ 192,00 ou vai exatamente para R$ 192,50.' }],
    prefill: { count: 2, mode: 'equal', items: [{ amount: 19200, dueInDays: 30 }, { amount: 19200, dueInDays: 60 }] }
  });
  assert.strictEqual(P.getData('t').mode, 'custom', 'com parcela travada, repartir por igual mexeria nela');
  const primeira = registro.get('t_rows').filhos[0];
  assert.match(primeira.innerHTML, /id="t_amount_0"[^>]*readonly/);
  assert.match(primeira.innerHTML, /id="t_due_0"[^>]*readonly/);
  const aviso = primeira.filhos.find(f => f.filhos?.length);
  assert.match(aviso.filhos[0].textContent, /Tem boleto do BB de R\$ 192,50/);
  assert.match(semEspacoFixo(aviso.filhos[1].textContent), /^Usar R\$ 192,50$/);
  assert.doesNotMatch(registro.get('t_rows').filhos[1].innerHTML, /readonly/, 'a outra continua livre');
});

test('pagamento do pedido: travas vindas da cobrança, a diferença pede justificativa e vai no PUT', () => {
  const travas = funcao(PAGAMENTO_PEDIDO, 'travasDasLinhas')([
    { parcela: { numero_parcela: 2, valor: 192 }, tem_boleto_vivo: false, recebimento: { valor: 192 } },
    { parcela: { numero_parcela: 1, valor: 192 }, tem_boleto_vivo: true, boleto: { valor: 192.5 } },
    { parcela: { numero_parcela: 3, valor: 100 } }
  ]);
  assert.deepStrictEqual([travas[0].atual, travas[0].permitido, travas[1].permitido, travas[2]], [19200, 19250, 19200, undefined]);
  assert.match(semEspacoFixo(travas[0].texto), /^Tem boleto do BB de R\$ 192,50: o valor fica em R\$ 192,00 ou vai exatamente para R\$ 192,50\.$/);
  assert.strictEqual(travas[1].texto, 'Tem pagamento registrado: o valor e o prazo desta parcela não mudam.');

  const ajuste = funcao(PAGAMENTO_PEDIDO, 'ajusteDasParcelas');
  assert.deepStrictEqual([ajuste(38400, 36400), ajuste(35000, 36400), ajuste(36401, 36400)], [2000, -1400, 0]);

  assert.ok(PAGAMENTO_HTML.includes('id="pagamentoPedidoJustificativa"') && PAGAMENTO_HTML.includes('Justificativa da diferença'));
  assert.match(PAGAMENTO_PEDIDO, /permitirDiferenca: true,\s+travas\s/);
  assert.ok(PAGAMENTO_PEDIDO.includes("if (ajuste && justificativa.length < 10) {"));
  assert.ok(PAGAMENTO_PEDIDO.includes('justificativa: montagem.justificativa || undefined'));
});

test('Visualizar: a linha "Adicional"/"Desconto" no fim dos itens, com a justificativa, quem e quando; o Total já vem com o ajuste', () => {
  const texto = funcao(VISUALIZAR, 'textoDoAjuste', `
    function diaEmSaoPaulo(v) { return v ? String(v).slice(0, 10) : null; }
    function formatarDia(d) { const [a, m, dd] = String(d).split('-'); return dd + '/' + m + '/' + a; }`);
  const pedido = { ajuste_motivo: 'Frete combinado', ajuste_em: '2026-09-24T15:00:00Z', ajuste_historico: JSON.stringify([{ por_nome: 'Henrique', motivo: 'Frete combinado' }]) };
  assert.deepStrictEqual(plano(texto(pedido, 20)), { rotulo: 'Adicional', valor: `+ ${(20).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, motivo: 'Frete combinado', autoria: 'Henrique · 24/09/2026' });
  assert.strictEqual(texto(pedido, -14).rotulo, 'Desconto');
  assert.ok(VISUALIZAR.includes('const total = subtotal - descontoTotal + ajuste;'));
  assert.ok(VISUALIZAR.includes('if (itensTbody && Math.abs(ajuste) > 0.005) itensTbody.appendChild(linhaDoAjuste(data, ajuste, fmtCurrency));'));
  assert.ok(VIS_HTML.includes('id="ajustePedidoChip"'));
});
