/**
 * O preço e o desconto de um orçamento preenchido pela IA.
 *
 * ---------------------------------------------------------------------------
 * OS DOIS DEFEITOS
 *
 * 1. O PREÇO ERA O ERRADO. A peça tem duas colunas de preço: `preco_venda`, que
 *    é CUSTO apurado e se move sozinho quando um insumo encarece, e o da
 *    `tabela_fixa`, que é o PRATICADO — o que vai ao cliente.
 *
 *    A grade da revisão mostrava o praticado; o item do orçamento recebia o
 *    custo. O número conferido na tela não era o que chegava ao orçamento, e o
 *    que chegava era menor.
 *
 *    Junto vinha um segundo defeito na mesma linha: `Number("1.234,56")` é NaN,
 *    e o `|| 0` transformava isso em ZERO. A peça mais cara do catálogo é
 *    justamente a que tem separador de milhar.
 *
 * 2. O DESCONTO À VISTA NÃO ERA APLICADO. O desconto padrão do módulo é 5% para
 *    mais de uma peça MAIS 5% à vista, e a regra lê a condição do próprio
 *    select. Ela rodava antes de o select ser preenchido: todo orçamento à
 *    vista preenchido pela IA saía com 5 pontos a menos, calado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

const preenchimento = require(path.join(raiz, 'backend', 'iaPreenchimento.js'));
const novoJs = () => ler('src', 'js', 'modals', 'orcamento-novo.js');

// ---------------------------------------------------------------------------
// 1. O preço que chega ao orçamento
// ---------------------------------------------------------------------------

const CATALOGO = [
  // Preço praticado e custo apurado DIFERENTES de propósito: é a única forma
  // de o teste dizer qual dos dois chegou.
  { id: 1, codigo: 'P-100', nome: 'Mesa Carvalho', preco_venda: 410.5, preco_tabela: 890 },
  { id: 2, codigo: 'P-200', nome: 'Painel Ripado', preco_venda: 700, preco_tabela: '1.234,56' },
  { id: 3, codigo: 'P-300', nome: 'Banqueta Baixa', preco_venda: 120, preco_tabela: null }
];

const montar = linhas => preenchimento.montarItensDeOrcamento(
  linhas,
  preenchimento.indexarPor(CATALOGO, 'codigo'),
  preenchimento.indexarPor(CATALOGO, 'nome'),
  CATALOGO
);

test('sem preço no documento, vale o PRATICADO e não o custo', () => {
  const { itens } = montar([{ codigo: 'P-100', nome: 'Mesa Carvalho', quantidade: 2 }]);

  assert.equal(itens.length, 1);
  assert.equal(itens[0].valor_unitario, 890,
    'chegou o custo apurado (410,50) no lugar do preço praticado — é este '
    + 'número que vai ao cliente, e é o que a grade da revisão mostra');
  assert.equal(itens[0].preco_de_tabela, true, 'e a linha precisa dizer que veio da tabela');
});

test('preço praticado com separador de milhar não vira zero', () => {
  const { itens } = montar([{ codigo: 'P-200', nome: 'Painel Ripado', quantidade: 1 }]);

  // `Number("1.234,56")` é NaN, e o `|| 0` transformava isso em zero: a peça
  // mais cara do catálogo saía de graça no orçamento.
  assert.equal(itens[0].valor_unitario, 1234.56);
});

test('o preço do documento manda, quando existe', () => {
  const { itens } = montar([
    { codigo: 'P-100', nome: 'Mesa Carvalho', quantidade: 1, valor_unitario: 950 }
  ]);

  // O documento é o que foi negociado; a tabela é o padrão de quem não disse.
  assert.equal(itens[0].valor_unitario, 950);
  assert.equal(itens[0].preco_de_tabela, false);
});

test('preço do documento em texto brasileiro é lido, não descartado', () => {
  const { itens } = montar([
    { codigo: 'P-100', nome: 'Mesa Carvalho', quantidade: 1, valor_unitario: '1.899,90' }
  ]);

  // Sob `Number`, isto virava NaN e a linha caía calada para o preço de
  // tabela: o valor negociado com o cliente sumia do orçamento.
  assert.equal(itens[0].valor_unitario, 1899.9);
  assert.equal(itens[0].preco_de_tabela, false);
});

test('peça sem preço na tabela entra com zero e avisada', () => {
  const { itens } = montar([{ codigo: 'P-300', nome: 'Banqueta Baixa', quantidade: 1 }]);

  // Zero é errado, mas é visível. O aviso `preco_de_tabela` é o que faz a
  // revisão dizer "confira" antes de o orçamento sair.
  assert.equal(itens[0].valor_unitario, 0);
  assert.equal(itens[0].preco_de_tabela, true);
});

test('o catálogo do preenchimento traz a tabela fixa junto', async () => {
  const chamados = [];
  const api = {
    get: caminho => {
      chamados.push(caminho);
      if (caminho === '/api/produtos') return Promise.resolve([{ id: 1, nome: 'Mesa' }]);
      if (caminho === '/api/tabela_fixa') return Promise.resolve([{ id_prod: 1, vlr_prod: '890,00' }]);
      return Promise.resolve([]);
    }
  };

  const catalogo = await preenchimento.catalogoDeProdutos(api);

  // Lido direto de `/api/produtos`, o preço praticado não vem — a coluna é de
  // outra tabela. Era essa leitura direta que fazia o item sair com o custo.
  assert.ok(chamados.includes('/api/tabela_fixa'));
  assert.equal(catalogo[0].preco_tabela, '890,00');
  assert.equal(preenchimento.precoDeVenda(catalogo[0]), 890);
});

/**
 * O caminho INTEIRO, de ponta a ponta.
 *
 * Os testes acima medem `montarItensDeOrcamento` e `catalogoDeProdutos`
 * separados, e os dois podiam estar certos com a ligação entre eles errada —
 * que foi exatamente o defeito: `montarPreenchimento` lia `/api/produtos`
 * direto, sem a junção, e entregava ao montador um catálogo sem preço
 * praticado. Cada peça no seu lugar, o conjunto errado.
 */
function apiFalsa({ produtos, tabelaFixa }) {
  const pedidos = [];
  return {
    pedidos,
    get(caminho) {
      pedidos.push(caminho);
      if (caminho === '/api/produtos') return Promise.resolve(produtos);
      if (caminho === '/api/tabela_fixa') return Promise.resolve(tabelaFixa);
      // Contatos e transportadoras do cliente: o bloco comercial do orçamento
      // os pede, e devolver undefined quebraria antes de chegar aos itens.
      return Promise.resolve([]);
    }
  };
}

test('o item chega ao formulário com o preço PRATICADO', async () => {
  const api = apiFalsa({
    produtos: [{ id: 1, codigo: 'P-100', nome: 'Mesa Carvalho', preco_venda: 410.5 }],
    tabelaFixa: [{ id_prod: 1, vlr_prod: '890,00' }]
  });

  const carga = await preenchimento.montarPreenchimento({
    api,
    destino: 'orcamentos',
    item: { alvo_id: null, dados: { itens: [{ nome: 'Mesa Carvalho', quantidade: 2 }] } }
  });

  assert.equal(carga.itens.length, 1, 'a peça não chegou ao formulário');
  assert.equal(carga.itens[0].valor_unitario, 890,
    'chegou o custo apurado (410,50). É o preço PRATICADO que vai ao cliente, '
    + 'e é o que a grade da revisão mostra — os dois têm de ser o mesmo número');

  // A junção precisa ter sido feita: sem ela o preço praticado não existe.
  assert.ok(api.pedidos.includes('/api/tabela_fixa'),
    'o preenchimento montou o catálogo sem a tabela fixa');
});

test('de ponta a ponta, o milhar não vira zero', async () => {
  const api = apiFalsa({
    produtos: [{ id: 2, codigo: 'P-200', nome: 'Painel Ripado', preco_venda: 700 }],
    tabelaFixa: [{ id_prod: 2, vlr_prod: '1.234,56' }]
  });

  const carga = await preenchimento.montarPreenchimento({
    api,
    destino: 'orcamentos',
    item: { alvo_id: null, dados: { itens: [{ nome: 'Painel Ripado', quantidade: 1 }] } }
  });

  assert.equal(carga.itens[0].valor_unitario, 1234.56);
});

test('a regra do preço praticado vive num lugar só', () => {
  const controller = ler('backend', 'iaController.js');

  // Ela estava no controller, e o preenchimento — que é outro arquivo — acabou
  // usando outro preço. Duas contas sobre a mesma pergunta divergem, e a
  // divergência aparece como um número na tela e outro no orçamento.
  assert.doesNotMatch(controller, /^async function catalogoDeProdutos/m,
    'o catálogo voltou a ter uma segunda definição no controller');
  assert.match(controller, /const \{ catalogoDeProdutos, precoDeVenda \} = preenchimento;/,
    'o controller precisa usar a mesma do preenchimento');
});

// ---------------------------------------------------------------------------
// 2. O desconto padrão
// ---------------------------------------------------------------------------

test('a condição de pagamento é posta ANTES da regra de desconto', () => {
  const js = novoJs();

  const posCondicao = js.indexOf('if (dados.condicao) condicaoSelect.value = dados.condicao;');
  const posRegra = js.indexOf('if (dados.aplicarDescontoPadrao) applyDefaultDiscounts();');

  assert.ok(posCondicao > 0, 'a condição não é mais reposta antes da regra');
  assert.ok(posRegra > 0, 'a regra de desconto sumiu');
  assert.ok(posCondicao < posRegra,
    'metade do desconto padrão é "5% à vista", e a regra lê isso do select. '
    + 'Rodando antes de o select ser preenchido, ela conclui que não é à vista '
    + 'e o orçamento sai com 5 pontos a menos — sem nada na tela dizendo.');
});

test('a regra de desconto continua sendo a do módulo', () => {
  const js = novoJs();
  const regra = js.slice(js.indexOf('function applyDefaultDiscounts'),
    js.indexOf('function recalcTotals'));

  // 5% acima de uma peça, mais 5% à vista. Calcular isso na revisão da IA
  // seria uma segunda regra de desconto no mesmo sistema, e as duas
  // divergiriam na primeira mudança — calado, porque o número sai plausível.
  assert.match(regra, /\(qty > 1 \? 5 : 0\) \+ \(newCond === 'vista' \? 5 : 0\)/);

  const ia = ler('src', 'js', 'modals', 'ia-detalhes.js');
  assert.match(ia, /desc: '0'/,
    'a IA manda desconto zero e pede a regra do módulo');
  assert.match(ia, /aplicarDescontoPadrao: true/);
  assert.doesNotMatch(ia, /\? 5 : 0/,
    'a revisão da IA não pode ter uma cópia da regra de desconto');
});

test('o desconto negociado à mão sobrevive à regra', () => {
  const js = novoJs();
  const regra = js.slice(js.indexOf('function applyDefaultDiscounts'),
    js.indexOf('function recalcTotals'));

  // A restauração depois de uma queda repõe descontos que alguém combinou com
  // o cliente. A regra separa o que é padrão do que foi negociado e só troca a
  // primeira parte.
  assert.match(regra, /const special = Math\.max\(currentDesc - oldDefault, 0\);/);
  assert.match(regra, /const newDesc = special \+ newDefault;/);
});

// ---------------------------------------------------------------------------
// 3. A soma: sem armadilha de formato
// ---------------------------------------------------------------------------

test('as células da tabela guardam número puro, não moeda formatada', () => {
  const ia = ler('src', 'js', 'modals', 'ia-detalhes.js');

  // A tabela é RELIDA com `parseFloat` para recalcular o total. Escrita
  // formatada, "1.234,56" viraria 1.234 — e o total sairia mil vezes menor.
  assert.match(ia, /valor: String\(i\.valor_unitario\)/);
  assert.match(ia, /qtd: String\(i\.quantidade\)/);

  const js = novoJs();
  const linha = js.slice(js.indexOf('function montarLinhaItem'),
    js.indexOf('function montarLinhaItem') + 1200);
  assert.doesNotMatch(linha, /formatCurrency\(dados\./,
    'as células de quantidade e preço não podem ser escritas formatadas');
});

test('só o total é formatado, e é relido por quem entende pt-BR', () => {
  const js = novoJs();

  // O subtotal salvo vem do texto que está na tela: formatado por
  // `toLocaleString('pt-BR')` e relido por `parseCurrencyToCents`, que tira o
  // ponto de milhar e troca a vírgula por ponto. Um `parseFloat` aqui leria
  // "R$ 1.234,56" como 1,234 — e o orçamento seria salvo mil vezes menor.
  assert.match(js, /parseCurrencyToCents\(document\.getElementById\('novoSubtotal'\)\.textContent\) \/ 100/);

  const util = ler('src', 'js', 'utils', 'parcelamento.js');
  const parse = util.slice(util.indexOf('function parseCurrencyToCents'),
    util.indexOf('function formatCentsBRL'));
  assert.match(parse, /\.replace\(\/\\\.\/g,''\)/, 'precisa tirar o ponto de milhar');
  assert.match(parse, /\.replace\(',', '\.'\)/, 'e trocar a vírgula decimal');
  assert.match(parse, /Math\.round\(value\*100\)/, 'e fechar em centavos inteiros');
});
