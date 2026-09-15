/**
 * Datas do pedido na conversão de orçamento.
 *
 * Na revisão de estoque, "Confirmar Conversão" passou a perguntar a previsão
 * de embarque e o início do faturamento antes de gravar. Três coisas não podem
 * falhar, e nenhuma delas aparece num `grep`:
 *
 * 1. A pergunta vem ANTES da limpeza da revisão. Depois dela o "Substituir"
 *    fica desligado, e quem desistisse das datas voltaria a uma revisão
 *    capenga.
 * 2. Desistir das datas não converte nada: é só voltar à revisão.
 * 3. As datas escolhidas chegam ao corpo do PUT. O editar copia a conversão
 *    campo a campo, e o campo esquecido ali some sem aviso.
 *
 * Por isso o código REAL é recortado dos arquivos e executado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const ler = relativo => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

const FONTE_CONVERTER = ler('src/js/modals/orcamento-converter.js');
const FONTE_EDITAR = ler('src/js/modals/orcamento-editar.js');

const SILENCIO = { error: () => {}, warn: () => {}, log: () => {}, info: () => {} };

/** Do começo do trecho até a chave que fecha o primeiro bloco aberto nele. */
function recortarBloco(fonte, inicioTexto) {
  const inicio = fonte.indexOf(inicioTexto);
  assert.notStrictEqual(inicio, -1, `trecho não encontrado: ${inicioTexto}`);
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

/** A função inteira, com o `async` da frente quando houver. */
function recortarFuncao(fonte, nome) {
  const marca = `function ${nome}(`;
  const inicio = fonte.indexOf(marca);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada`);
  const assincrona = fonte.slice(Math.max(0, inicio - 6), inicio) === 'async ';
  const corpo = recortarBloco(fonte, marca);
  return assincrona ? `async ${corpo}` : corpo;
}

/** A declaração `const nome = ...;` de uma linha só. */
function recortarConstante(fonte, nome) {
  const inicio = fonte.indexOf(`const ${nome} =`);
  assert.notStrictEqual(inicio, -1, `constante ${nome} não encontrada`);
  return fonte.slice(inicio, fonte.indexOf(';', inicio) + 1);
}

const DATAS = Object.freeze({
  embarcar_previsao: '2026-10-05',
  faturamento_regra: 'ao_embarcar',
  inicio_faturamento: '2026-10-05'
});

// ===========================================================================
// 1. O botão "Confirmar Conversão" da revisão
// ===========================================================================

function montarConfirmar({ datas = DATAS, validacao } = {}) {
  const trecho = recortarBloco(FONTE_CONVERTER, "btnConfirmar.addEventListener('click', async () => {") + ');';
  const passos = [];
  const recebidos = [];
  const contexto = {
    console: SILENCIO,
    ctx: { items: [{ produto_id: 1 }] },
    rows: [{ produto_id: 1, nome: 'Porta 2 Folhas', pronta: 1, a_produzir: 2, produzir_parcial: 0, approved: true }],
    state: { hasNegative: false },
    decisionNote: () => ({ value: '' }),
    validate: () => validacao || { canConfirm: true, unapproved: [], needsJustification: false, pendencias: [] },
    resumoPendencias: () => '',
    pecasBody: null,
    showToast: () => {},
    overlay: { isConnected: true, dataset: {} },
    btnConfirmar: { addEventListener: (_tipo, fn) => { contexto.ouvinte = fn; } },
    pedirDatasDoPedido: () => {
      passos.push('datas');
      return typeof datas === 'function' ? datas(contexto) : Promise.resolve(datas);
    },
    cleanupReplaceModalIntegration: () => passos.push('limpeza'),
    close: () => passos.push('fechar'),
    window: {
      confirmQuoteConversion: payload => {
        passos.push('converter');
        recebidos.push(payload);
      }
    }
  };
  vm.createContext(contexto);
  vm.runInContext(`var pedindoDatas = false;\nvar ultimasDatas = null;\n${trecho}`, contexto);
  return { contexto, passos, recebidos };
}

test('Confirmar Conversão pergunta as datas ANTES de limpar a revisão e converter', async () => {
  const { contexto, passos, recebidos } = montarConfirmar();

  await contexto.ouvinte();

  assert.deepEqual(passos, ['datas', 'limpeza', 'converter', 'fechar'],
    'a limpeza desliga o "Substituir": perguntar depois dela deixaria a revisão '
    + 'capenga para quem desistisse das datas');
  assert.deepEqual(recebidos[0].conversao.datas, DATAS,
    'as datas viajam dentro da conversão, junto da decisão de estoque');
  assert.equal(contexto.ultimasDatas, DATAS, 'a resposta fica guardada para reabrir preenchido');
});

test('desistir das datas não converte: a revisão continua aberta como estava', async () => {
  const { contexto, passos } = montarConfirmar({ datas: null });

  await contexto.ouvinte();

  assert.deepEqual(passos, ['datas'], 'sem datas não limpa, não converte e não fecha');
  assert.equal(contexto.pedindoDatas, false, 'a trava é solta: dá para confirmar de novo');
  assert.equal(contexto.overlay.dataset.pedindoDatas, undefined,
    'a marca que segura o Esc do editar sai junto');

  await contexto.ouvinte();
  assert.deepEqual(passos, ['datas', 'datas'], 'o segundo Confirmar pergunta outra vez');
});

test('revisão com pendência nem chega a perguntar as datas', async () => {
  const { contexto, passos } = montarConfirmar({
    validacao: { canConfirm: false, unapproved: [], needsJustification: false, pendencias: [] }
  });

  await contexto.ouvinte();

  assert.deepEqual(passos, [], 'as datas são o último passo, depois da validação');
});

test('segundo clique com a pergunta aberta não abre outro modal de datas', async () => {
  let responder;
  const { contexto, passos } = montarConfirmar({
    datas: () => new Promise(resolve => { responder = resolve; })
  });

  const primeiro = contexto.ouvinte();
  assert.equal(contexto.overlay.dataset.pedindoDatas, 'true',
    'enquanto pergunta, o overlay avisa o editar para não fechar no Esc');
  await contexto.ouvinte();
  assert.deepEqual(passos, ['datas'], 'a rede do BotaoAcao solta o botão cedo; a trava é daqui');

  responder(null);
  await primeiro;
  assert.equal(contexto.pedindoDatas, false);
});

test('revisão fechada por baixo enquanto perguntava: nada é convertido', async () => {
  const { contexto, passos } = montarConfirmar({
    datas: ctx => {
      ctx.overlay.isConnected = false;
      return Promise.resolve(DATAS);
    }
  });

  await contexto.ouvinte();

  assert.deepEqual(passos, ['datas'], 'sem a revisão na tela não sobrou o que confirmar');
});

test('o Esc da revisão respeita o modal de datas aberto', () => {
  const ouvinte = recortarBloco(FONTE_CONVERTER, "document.addEventListener('keydown', function esc(e){");
  const guarda = ouvinte.indexOf('isDatasPedidoOpen()');
  assert.ok(guarda !== -1, 'o Esc do converter não olha o modal de datas');
  assert.ok(guarda < ouvinte.indexOf('close()'), 'a guarda precisa vir antes de fechar');

  const editar = FONTE_EDITAR.split('\n').find(l => l.includes("document.addEventListener('keydown', function esc(e)"));
  assert.ok(editar, 'não achei o Esc do editar');
  assert.ok(editar.indexOf('perguntandoDatasDoPedido()') !== -1
    && editar.indexOf('perguntandoDatasDoPedido()') < editar.indexOf('close()'),
  'o Esc do editar fecharia o hospedeiro da conversão com as datas abertas');
});

// ===========================================================================
// 2. A pergunta em si: abrir o modal pelo contrato e esperar a resposta
// ===========================================================================

function criarJanela() {
  const ouvintes = new Map();
  return {
    addEventListener(tipo, fn) {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
      ouvintes.get(tipo).add(fn);
    },
    removeEventListener(tipo, fn) { ouvintes.get(tipo)?.delete(fn); },
    disparar(tipo, detail) {
      Array.from(ouvintes.get(tipo) || []).forEach(fn => fn({ type: tipo, detail }));
    },
    pendurados() {
      let total = 0;
      ouvintes.forEach(lista => { total += lista.size; });
      return total;
    }
  };
}

function criarOverlay(escondido = false) {
  const classes = new Set(escondido ? ['hidden'] : []);
  return {
    classList: {
      contains: c => classes.has(c),
      remove: c => classes.delete(c),
      add: c => classes.add(c)
    },
    removeAttribute: () => {}
  };
}

function montarPergunta({ ctx = {}, hoje, abrir } = {}) {
  const janela = criarJanela();
  if (hoje) janela.dateUtils = { getTodayKey: () => hoje };
  const dom = new Map();
  const aberturas = [];
  const toasts = [];
  const contexto = {
    console: SILENCIO,
    setTimeout,
    clearTimeout,
    ctx,
    window: janela,
    document: { getElementById: id => dom.get(id) || null },
    showToast: (texto, tipo) => toasts.push({ texto, tipo }),
    Modal: {
      open: (...args) => {
        aberturas.push(args);
        if (abrir) return abrir(dom);
        dom.set('datasPedidoOverlay', criarOverlay());
        return Promise.resolve();
      }
    }
  };
  vm.createContext(contexto);
  vm.runInContext([
    recortarConstante(FONTE_CONVERTER, 'datasPedidoOverlayId'),
    recortarConstante(FONTE_CONVERTER, 'datasPedidoEvento'),
    'var pedindoDatas = false;',
    'var ultimasDatas = null;',
    recortarFuncao(FONTE_CONVERTER, 'hojeEmSaoPaulo'),
    recortarFuncao(FONTE_CONVERTER, 'pedirDatasDoPedido')
  ].join('\n'), contexto);
  return { contexto, janela, dom, aberturas, toasts };
}

const umCiclo = () => new Promise(resolve => setImmediate(resolve));

test('abre o modal de datas pelo contrato e devolve o que foi confirmado', async () => {
  const { contexto, janela, aberturas } = montarPergunta({
    ctx: { numero: 'ORC-10', cliente: 'Loja Centro', prazos: [0, 30, 60] },
    hoje: '2026-09-14'
  });

  const pergunta = contexto.pedirDatasDoPedido();

  assert.deepEqual(aberturas, [[
    'modals/pedidos/datas.html', '../js/modals/pedido-datas.js', 'datasPedido', true
  ]], 'mesmo caminho dos outros modais de pedido, empilhado sobre a revisão');

  const recebido = janela.datasPedidoContext;
  assert.equal(recebido.modo, 'conversao');
  assert.equal(recebido.numero, 'ORC-10');
  assert.equal(recebido.cliente, 'Loja Centro');
  assert.deepEqual(Array.from(recebido.prazos), [0, 30, 60]);
  assert.equal(recebido.dataConversao, '2026-09-14', '"ao converter" é hoje em São Paulo');

  await umCiclo();
  janela.disparar('pedido:datas-definidas', { source: 'pedido-datas', modo: 'conversao', datas: DATAS, resposta: null });

  assert.deepEqual(await pergunta, DATAS);
  assert.equal(janela.pendurados(), 0, 'nenhum ouvinte fica pendurado depois da resposta');
  assert.equal(janela.datasPedidoContext, null);
});

test('fechar o modal sem confirmar é desistir', async () => {
  const { contexto, janela } = montarPergunta();
  const pergunta = contexto.pedirDatasDoPedido();
  await umCiclo();

  janela.disparar('modalFechado', 'datasPedido');

  assert.equal(await pergunta, null);
  assert.equal(janela.pendurados(), 0);
});

test('a confirmação que chega logo depois do fechamento ainda vale', async () => {
  const { contexto, janela } = montarPergunta();
  const pergunta = contexto.pedirDatasDoPedido();
  await umCiclo();

  janela.disparar('modalFechado', 'datasPedido');
  janela.disparar('pedido:datas-definidas', { source: 'pedido-datas', modo: 'conversao', datas: DATAS });

  assert.deepEqual(await pergunta, DATAS);
});

test('eventos de outro modal, de outra origem ou do modo "pedido" não respondem', async () => {
  const { contexto, janela } = montarPergunta();
  const pergunta = contexto.pedirDatasDoPedido();
  await umCiclo();

  janela.disparar('modalFechado', 'converterOrcamento');
  janela.disparar('pedido:datas-definidas', { source: 'outra-tela', modo: 'conversao', datas: DATAS });
  janela.disparar('pedido:datas-definidas', { source: 'pedido-datas', modo: 'pedido', datas: DATAS });

  const corrida = await Promise.race([
    pergunta.then(() => 'respondeu'),
    new Promise(resolve => setTimeout(() => resolve('esperando'), 20))
  ]);
  assert.equal(corrida, 'esperando');

  janela.disparar('modalFechado', 'datasPedido');
  assert.equal(await pergunta, null);
});

test('modal que não chega ao DOM não deixa a revisão presa esperando', async () => {
  // `Modal.open` desiste calado quando outra abertura passa na frente.
  const { contexto, janela } = montarPergunta({ abrir: () => Promise.resolve() });

  assert.equal(await contexto.pedirDatasDoPedido(), null);
  assert.equal(janela.pendurados(), 0);
});

test('falha ao abrir vira desistência, com aviso na tela', async () => {
  const { contexto, toasts } = montarPergunta({ abrir: () => Promise.reject(new Error('sem rede')) });

  assert.equal(await contexto.pedirDatasDoPedido(), null);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].tipo, 'error');
});

test('a rede de revelação só tira o "hidden" do modal de datas', async () => {
  const overlay = criarOverlay(true);
  const { contexto, janela } = montarPergunta({
    abrir: dom => { dom.set('datasPedidoOverlay', overlay); return Promise.resolve(); }
  });
  const pergunta = contexto.pedirDatasDoPedido();
  await umCiclo();

  janela.disparar('pedidoModalLoaded', 'pagamentoPedido');
  assert.equal(overlay.classList.contains('hidden'), true, 'evento de outro modal não mexe neste');

  janela.disparar('pedidoModalLoaded', 'datasPedido');
  assert.equal(overlay.classList.contains('hidden'), false);

  janela.disparar('modalFechado', 'datasPedido');
  await pergunta;
});

test('reabrir depois de uma tentativa traz as últimas datas preenchidas', async () => {
  const { contexto, janela } = montarPergunta({ hoje: '2026-09-14' });
  contexto.ultimasDatas = { ...DATAS };

  const pergunta = contexto.pedirDatasDoPedido();
  assert.equal(janela.datasPedidoContext.embarcar_previsao, '2026-10-05');
  assert.equal(janela.datasPedidoContext.faturamento_regra, 'ao_embarcar');
  assert.equal(janela.datasPedidoContext.modo, 'conversao', 'o preenchimento não troca o modo');

  await umCiclo();
  janela.disparar('modalFechado', 'datasPedido');
  await pergunta;
});

test('sem o utilitário de data, o dia da conversão é o de São Paulo', () => {
  const { contexto } = montarPergunta();
  const partes = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).forEach(p => { partes[p.type] = p.value; });

  assert.equal(contexto.hojeEmSaoPaulo(), `${partes.year}-${partes.month}-${partes.day}`);
});

// ===========================================================================
// 3. O editar: prazos da prévia e as datas até o PUT
// ===========================================================================

function montarEditar({ condicao = 'prazo', prazoVista = '', itens = [] } = {}) {
  const janela = {
    Parcelamento: { getData: id => (id === 'editarParcelamento' ? { items: itens, canRegister: true } : null) }
  };
  const contexto = {
    console: SILENCIO,
    window: janela,
    id: 42,
    data: { numero: 'ORC-42', data_emissao: '2026-09-01T12:00:00.000Z' },
    itensTbody: { children: [] },
    editarCliente: { options: [{ textContent: 'Loja Centro' }], selectedIndex: 0 },
    editarCondicao: { value: condicao },
    document: { getElementById: id => (id === 'editarPrazoVista' ? { value: prazoVista } : null) },
    recalcTotals: () => {},
    updateLineTotal: () => {},
    showToast: () => {},
    Modal: { open: async () => {}, waitForReady: async () => {} }
  };
  vm.createContext(contexto);
  vm.runInContext([
    'var lastConversionData = null;',
    recortarFuncao(FONTE_EDITAR, 'prazosDoFormulario'),
    recortarFuncao(FONTE_EDITAR, 'openConverterModal'),
    'this.lerConversao = () => lastConversionData;'
  ].join('\n'), contexto);
  return { contexto, janela };
}

test('a revisão recebe os prazos do FORMULÁRIO, parcela a parcela', async () => {
  const { contexto, janela } = montarEditar({
    condicao: 'prazo',
    itens: [{ dueInDays: 0 }, { dueInDays: '30' }, { dueInDays: null }, { dueInDays: 60 }]
  });

  await contexto.openConverterModal(() => {});

  assert.deepEqual(Array.from(janela.quoteConversionContext.prazos), [0, 30, 0, 60],
    'dia vazio vale zero, como no saveChanges que grava a condição');
});

test('à vista, o prazo é o único dia; sem prazo digitado, a prévia fica vazia', async () => {
  const comPrazo = montarEditar({ condicao: 'vista', prazoVista: '15' });
  await comPrazo.contexto.openConverterModal(() => {});
  assert.deepEqual(Array.from(comPrazo.janela.quoteConversionContext.prazos), [15]);

  const semPrazo = montarEditar({ condicao: 'vista', prazoVista: '' });
  await semPrazo.contexto.openConverterModal(() => {});
  assert.deepEqual(Array.from(semPrazo.janela.quoteConversionContext.prazos), []);
});

test('as datas escolhidas chegam a lastConversionData', async () => {
  const { contexto, janela } = montarEditar();
  let gravou = false;
  await contexto.openConverterModal(() => { gravou = true; });

  janela.confirmQuoteConversion({
    deletions: [],
    replacements: [],
    conversao: { decisionNote: 'Reposição pedida.', hasNegative: false, items: [], datas: DATAS }
  });

  const guardado = contexto.lerConversao();
  assert.deepEqual(guardado.datas, DATAS, 'sem a cópia na whitelist as datas nunca chegariam ao backend');
  assert.equal(guardado.decisaoNote, 'Reposição pedida.', 'o resto da conversão continua igual');
  assert.equal(gravou, true);
});

test('conversão sem datas manda `datas: null` — o backend mantém o comportamento antigo', async () => {
  const { contexto, janela } = montarEditar();
  await contexto.openConverterModal(() => {});

  janela.confirmQuoteConversion({ conversao: { decisionNote: '', hasNegative: false, items: [] } });

  assert.equal(contexto.lerConversao().datas, null);
});

test('o PUT leva a conversão inteira, datas incluídas', () => {
  assert.match(FONTE_EDITAR, /body\.conversao = lastConversionData;/,
    'body.conversao precisa levar lastConversionData inteiro, sem novo filtro');
});

test('recusa do PUT mostra o motivo que o backend mandou', () => {
  const salvar = recortarFuncao(FONTE_EDITAR, 'saveChanges');
  // 400 DATAS_INVALIDAS chega antes de qualquer escrita; o toast genérico não
  // diria o que corrigir.
  assert.match(salvar, /const corpo = await resp\.json\(\)\.catch\(\(\) => null\);/);
  assert.match(salvar, /err\?\.motivo \? `Erro ao atualizar orçamento: \$\{err\.motivo\}`/);
});
