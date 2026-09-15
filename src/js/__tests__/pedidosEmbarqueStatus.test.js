/**
 * Embarque na lista de pedidos e no Visualizar.
 *
 * `data_envio` virou `embarcar_real` (DATE) e o pedido ganhou a previsão de
 * embarque e o início do faturamento. Três cuidados:
 *
 * 1. Coluna DATE é cortada como texto. Servida como '2026-09-13T00:00:00.000Z'
 *    e passada por `new Date()` no fuso de São Paulo, vira o dia 12.
 * 2. Marcar "Enviado" pode reprogramar os vencimentos (embarque atrasado num
 *    pedido "ao embarcar"), e a lista precisa dizer isso — a resposta do PUT
 *    era descartada, inclusive recusas como o 409 de pedido já enviado.
 * 3. No Visualizar, o prazo deduzido de uma parcela conta do início do
 *    faturamento, e não mais da emissão.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const ler = relativo => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

const FONTE_PEDIDOS = ler('src/js/pedidos.js');
const FONTE_VISUALIZAR = ler('src/js/modals/pedido-visualizar.js');

function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada`);
  let i = fonte.indexOf('{', inicio);
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}') {
      nivel -= 1;
      if (nivel === 0) break;
    }
  }
  return fonte.slice(inicio, i + 1);
}

// ===========================================================================
// 1. Lista de pedidos
// ===========================================================================

test('a lista lê embarcar_real — data_envio foi renomeada', () => {
  assert.doesNotMatch(FONTE_PEDIDOS, /data_envio/,
    'depois do RENAME a chave data_envio não vem mais do banco');
  assert.match(FONTE_PEDIDOS, /formatarDiaDate\(p\.embarcar_real\)/);
  assert.match(FONTE_PEDIDOS, /formatarDiaDate\(p\.embarcar_previsao\)/);
});

test('o balão do status fala em embarque, com a previsão ao lado', () => {
  assert.doesNotMatch(FONTE_PEDIDOS, /Data de Envio/);
  assert.match(FONTE_PEDIDOS, /label: 'Previsão de Embarque', value: badge\.dataset\.previsaoEmbarque/);
  assert.match(FONTE_PEDIDOS, /label: 'Data de Embarque', value: badge\.dataset\.embarque/);

  // O atributo e a leitura andam juntos: `data-embarque` ↔ `dataset.embarque`.
  assert.match(FONTE_PEDIDOS, /data-previsao-embarque="\$\{dataPrevisaoEmbarque\}"/);
  assert.match(FONTE_PEDIDOS, /data-embarque="\$\{dataEmbarque\}"/);
});

function carregarLista() {
  const contexto = vm.createContext({});
  vm.runInContext([
    recortarFuncao(FONTE_PEDIDOS, 'formatarDiaDate'),
    recortarFuncao(FONTE_PEDIDOS, 'mensagensDaTrocaDeStatus')
  ].join('\n'), contexto);
  return contexto;
}

test('data DATE aparece no dia certo, venha só a data ou com meia-noite UTC', () => {
  const { formatarDiaDate } = carregarLista();

  assert.equal(formatarDiaDate('2026-08-25'), '25/08/2026');
  assert.equal(formatarDiaDate('2026-08-25T00:00:00.000Z'), '25/08/2026',
    'meia-noite UTC em São Paulo seria o dia 24');
  assert.equal(formatarDiaDate(null), '');
  assert.equal(formatarDiaDate(undefined), '');
  assert.equal(formatarDiaDate(''), '');
  assert.equal(formatarDiaDate('sem data'), '');
});

test('recusa da troca de status mostra o motivo do backend', () => {
  const { mensagensDaTrocaDeStatus } = carregarLista();

  const jaEnviado = Array.from(mensagensDaTrocaDeStatus(false, 409, {
    error: 'Este pedido já foi enviado.', code: 'JA_ENVIADO'
  }));
  assert.equal(jaEnviado.length, 1);
  assert.equal(jaEnviado[0].texto, 'Este pedido já foi enviado.');
  assert.equal(jaEnviado[0].tipo, 'error');

  const semCorpo = Array.from(mensagensDaTrocaDeStatus(false, 403, null));
  assert.equal(semCorpo.length, 1);
  assert.match(semCorpo[0].texto, /HTTP 403/, 'sem corpo, ao menos o código do erro');
  assert.equal(semCorpo[0].tipo, 'error');
});

test('embarque atrasado avisa a partir de quando os vencimentos contam', () => {
  const { mensagensDaTrocaDeStatus } = carregarLista();

  const mensagens = Array.from(mensagensDaTrocaDeStatus(true, 200, {
    success: true,
    avisos: [],
    faturamento: { reprogramado: true, inicio_faturamento: '2026-08-12', parcelas: [] }
  }));

  assert.equal(mensagens.length, 1);
  assert.equal(mensagens[0].texto, 'Embarque atrasado: vencimentos reprogramados a partir de 12/08/2026');
  assert.equal(mensagens[0].tipo, 'info');
});

test('embarque no prazo, sem avisos: nada a dizer', () => {
  const { mensagensDaTrocaDeStatus } = carregarLista();

  const mensagens = mensagensDaTrocaDeStatus(true, 200, {
    success: true, avisos: [], faturamento: { reprogramado: false, inicio_faturamento: '2026-08-10' }
  });
  assert.equal(mensagens.length, 0);
  assert.equal(mensagensDaTrocaDeStatus(true, 200, null).length, 0, 'resposta sem corpo não quebra');
});

test('os avisos do backend chegam à tela', () => {
  const { mensagensDaTrocaDeStatus } = carregarLista();

  const um = Array.from(mensagensDaTrocaDeStatus(true, 200, { success: true, avisos: ['Reserva 7 não encontrada.'] }));
  assert.equal(um.length, 1);
  assert.match(um[0].texto, /Reserva 7 não encontrada\./);

  const dois = Array.from(mensagensDaTrocaDeStatus(true, 200, { success: true, avisos: ['a', 'b'] }));
  assert.equal(dois.length, 1);
  assert.match(dois[0].texto, /2 avisos/);
});

test('o clique no "Concluir" usa a resposta do PUT', () => {
  const inicio = FONTE_PEDIDOS.indexOf('showStatusConfirmDialog(`Deseja alterar o status');
  assert.notStrictEqual(inicio, -1, 'o diálogo de confirmação continua sendo o caminho');
  const trecho = FONTE_PEDIDOS.slice(inicio, FONTE_PEDIDOS.indexOf('tbody.appendChild(tr);', inicio));

  assert.match(trecho, /const resp = await fetchApi\(`\/api\/pedidos\/\$\{p\.id\}\/status`/);
  assert.match(trecho, /const corpo = await resp\.json\(\)\.catch\(\(\) => null\);/);
  assert.match(trecho, /mensagensDaTrocaDeStatus\(resp\.ok, resp\.status, corpo\)/);
});

// ===========================================================================
// 2. Visualizar pedido
// ===========================================================================

test('Enviado mostra a data de embarque real', () => {
  assert.match(FONTE_VISUALIZAR, /Enviado: \{ badge: 'badge-info', dateKey: 'embarcar_real' \}/);
  assert.doesNotMatch(FONTE_VISUALIZAR, /data_envio/);
});

function carregarVisualizar() {
  const inicio = FONTE_VISUALIZAR.indexOf('const COLUNAS_DATE');
  assert.notStrictEqual(inicio, -1, 'não achei COLUNAS_DATE');
  const colunas = FONTE_VISUALIZAR.slice(inicio, FONTE_VISUALIZAR.indexOf(']);', inicio) + 3);

  const contexto = vm.createContext({});
  vm.runInContext([
    colunas,
    recortarFuncao(FONTE_VISUALIZAR, 'diaDeColunaDate'),
    recortarFuncao(FONTE_VISUALIZAR, 'formatarDia'),
    recortarFuncao(FONTE_VISUALIZAR, 'diaEmSaoPaulo'),
    recortarFuncao(FONTE_VISUALIZAR, 'diferencaEmDias'),
    recortarFuncao(FONTE_VISUALIZAR, 'baseDoFaturamento'),
    recortarFuncao(FONTE_VISUALIZAR, 'formatarDataDaColuna')
  ].join('\n'), contexto);
  return contexto;
}

test('colunas DATE aparecem sem recuar um dia', () => {
  const { formatarDataDaColuna } = carregarVisualizar();

  for (const coluna of ['data_aprovacao', 'embarcar_real', 'embarcar_previsao', 'inicio_faturamento']) {
    assert.equal(formatarDataDaColuna(coluna, '2026-09-13T00:00:00.000Z'), '13/09/2026',
      `${coluna} é DATE: new Date() no fuso local mostraria o dia 12`);
    assert.equal(formatarDataDaColuna(coluna, '2026-09-13'), '13/09/2026');
  }
  assert.equal(formatarDataDaColuna('data_entrega', 'lixo'), '', 'instante inválido não vira "Invalid Date"');
});

test('os vencimentos contam do início do faturamento; nos antigos, do dia da emissão em SP', () => {
  const { baseDoFaturamento } = carregarVisualizar();

  assert.equal(baseDoFaturamento({
    inicio_faturamento: '2026-08-10T00:00:00.000Z',
    data_emissao: '2026-07-01T15:00:00.000Z'
  }), '2026-08-10');

  // 02:30 UTC do dia 2 ainda é dia 1 em São Paulo.
  assert.equal(baseDoFaturamento({ inicio_faturamento: null, data_emissao: '2026-09-02T02:30:00.000Z' }), '2026-09-01');
  assert.equal(baseDoFaturamento({}), null);
});

test('a distância entre datas é em dias de calendário', () => {
  const { diferencaEmDias } = carregarVisualizar();

  assert.equal(diferencaEmDias('2026-08-25', '2026-08-10'), 15, 'início 10/08 + 15 dias = 25/08');
  assert.equal(diferencaEmDias('2026-03-01', '2026-02-01'), 28);
  assert.equal(diferencaEmDias('2027-01-09', '2026-12-10'), 30);
});

test('o prazo deduzido da parcela usa a base do faturamento, não a emissão', () => {
  assert.match(FONTE_VISUALIZAR, /const baseFaturamento = baseDoFaturamento\(data\);/);
  assert.match(FONTE_VISUALIZAR, /diferencaEmDias\(vencimento, baseFaturamento\)/);
  assert.doesNotMatch(FONTE_VISUALIZAR, /new Date\(p\.data_vencimento\)/,
    'data_vencimento é DATE e não passa por new Date()');
});

test('as parcelas mostram a previsão de embarque e o início do faturamento', () => {
  assert.match(FONTE_VISUALIZAR, /Previsão de embarque: \$\{previsaoEmbarque\}/);
  assert.match(FONTE_VISUALIZAR, /Início do faturamento: \$\{inicioFaturamento\}/);
});
