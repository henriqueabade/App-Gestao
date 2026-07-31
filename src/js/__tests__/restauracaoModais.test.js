const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');

/**
 * Exercita a REABERTURA de modais na restauração — a parte que precisa valer
 * para todos eles:
 *   1. `__contexto` volta para o `window` ANTES de o script do modal rodar
 *      (modais de edição leem `window.selectedQuoteId` e afins);
 *   2. a restauração espera o modal declarar `registrarConteudo`, porque quase
 *      todos fazem `await` (buscar produtos, pedidos...) antes de registrar.
 */
function criarArmazenamento(inicial = []) {
  const dados = new Map(inicial);
  return {
    getItem: k => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: k => dados.delete(k)
  };
}

/**
 * @param {'local'|'sessao'|'nenhum'} ondeEstaUsuario
 *   ONDE o usuário logado está guardado. Não é detalhe de teste: o dashboard
 *   real MOVE o usuário para o `sessionStorage` e apaga o `localStorage` quando
 *   não há "lembrar-me" (`src/utils/userActions.js`). Ler só o `localStorage`
 *   foi o que matou a restauração inteira.
 */
function montarAmbiente({
  usuario = { id: 7 },
  estadoNoDisco = null,
  ondeEstaUsuario = 'local'
} = {}) {
  const bruto = JSON.stringify(usuario);
  const localStorage = criarArmazenamento(ondeEstaUsuario === 'local' ? [['user', bruto]] : []);
  const sessionStorage = criarArmazenamento(
    ondeEstaUsuario === 'sessao' ? [['currentUser', bruto]] : []
  );
  let limpezas = 0;

  const registroDeAberturas = [];
  const overlays = new Map();

  const criarOverlay = (id, { comecaEscondido = false } = {}) => {
    const classes = new Set(comecaEscondido ? ['hidden'] : []);
    return {
      id,
      classList: {
        contains: c => classes.has(c),
        add: c => classes.add(c),
        remove: c => classes.delete(c)
      },
      removeAttribute() {},
      querySelector: () => ({ id: 'campo', value: '', type: 'text', disabled: false, dataset: {}, dispatchEvent() {} }),
      querySelectorAll: () => []
    };
  };

  const content = {
    dataset: { activePage: 'dashboard' },
    querySelectorAll: () => [],
    querySelector: () => null
  };

  const ouvintes = new Map();
  const janela = {
    localStorage,
    sessionStorage,
    console,
    Event: class { constructor(t) { this.type = t; } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    addEventListener: (tipo, fn) => {
      if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
      ouvintes.get(tipo).add(fn);
    },
    removeEventListener: (tipo, fn) => ouvintes.get(tipo)?.delete(fn),
    electronAPI: {
      async saveState() { return true; },
      async loadState() { return estadoNoDisco; },
      async clearState() { limpezas += 1; return true; }
    },
    document: {
      getElementById: id => (id === 'content' ? content : overlays.get(id) || null),
      querySelectorAll: () => []
    },
    // Sinaliza o que o "script do modal" enxergou no momento em que rodou.
    __visto: {}
  };
  janela.window = janela;
  janela.globalThis = janela;

  const contexto = vm.createContext(janela);
  for (const rel of ['src/js/utils/restauracao.js', 'src/js/estado-trabalho.js']) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, rel), 'utf8'), contexto, { filename: rel });
  }

  /** Dispara um evento de janela, como o modal faz ao terminar de carregar. */
  const disparar = (tipo, detail) => {
    (ouvintes.get(tipo) || new Set()).forEach(fn => fn({ type: tipo, detail }));
  };

  return {
    janela,
    registroDeAberturas,
    overlays,
    criarOverlay,
    disparar,
    /** Quantas vezes o arquivo do disco foi consumido. */
    limpezas: () => limpezas
  };
}

const X = { id: 7 };

function estadoComModal(conteudo, overlayId = 'editarOrcamentoOverlay') {
  return {
    sectionId: 'orcamentos',
    motivo: 'offline',
    usuarioId: '7',
    salvoEm: Date.now(),
    storage: { user: JSON.stringify(X) },
    campos: [],
    modais: [{
      overlayId,
      abertura: {
        htmlPath: 'modals/orcamentos/editar.html',
        scriptPath: '../js/modals/orcamento-editar.js',
        overlayId: 'editarOrcamento'
      },
      campos: [],
      conteudo
    }]
  };
}

test('__contexto volta para o window ANTES de o script do modal rodar', async () => {
  const conteudo = { __contexto: { selectedQuoteId: 123 }, itens: [{ id: '9' }] };
  const { janela, overlays, criarOverlay } = montarAmbiente({ estadoNoDisco: estadoComModal(conteudo) });

  janela.Modal = {
    async open(_html, _script, overlayId) {
      // é exatamente aqui que o script do modal leria o global
      janela.__visto.selectedQuoteId = janela.selectedQuoteId;
      const id = `${overlayId}Overlay`;
      overlays.set(id, criarOverlay(id));
      janela.EstadoTrabalho.registrarConteudo(overlayId, {
        capturar: () => ({}),
        restaurar: () => {}
      });
    }
  };

  await janela.restaurarTrabalhoInterrompido(async () => {});

  assert.strictEqual(janela.__visto.selectedQuoteId, 123,
    'o modal precisa encontrar o id do registro que estava editando');
});

test('a restauração espera o modal registrar restaurar (registro tardio)', async () => {
  const conteudo = { itens: [{ id: '9' }, { id: '10' }] };
  const { janela, overlays, criarOverlay } = montarAmbiente({ estadoNoDisco: estadoComModal(conteudo) });

  let recebido = null;
  janela.Modal = {
    async open(_html, _script, overlayId) {
      const id = `${overlayId}Overlay`;
      overlays.set(id, criarOverlay(id));
      // modal "pesado": só registra 900ms depois, como quem busca dados na API
      setTimeout(() => {
        janela.EstadoTrabalho.registrarConteudo(overlayId, {
          capturar: () => ({}),
          restaurar: dados => { recebido = dados; }
        });
      }, 900);
    }
  };

  await janela.restaurarTrabalhoInterrompido(async () => {});

  assert.ok(recebido, 'o conteúdo precisa chegar mesmo com registro tardio');
  assert.strictEqual(recebido.itens.length, 2);
});

test('modal que nunca registra não trava a restauração', async () => {
  const { janela, overlays, criarOverlay } = montarAmbiente({
    estadoNoDisco: estadoComModal({ itens: [] })
  });

  janela.Modal = {
    async open(_html, _script, overlayId) {
      const id = `${overlayId}Overlay`;
      overlays.set(id, criarOverlay(id));
      // nunca chama registrarConteudo
    }
  };

  const restaurou = await janela.restaurarTrabalhoInterrompido(async () => {});
  assert.strictEqual(restaurou, true, 'a restauração do resto não pode ser abortada');
});

// Overlays de modais abertos por `openModalWithSpinner` nascem com `hidden` e
// só são revelados por um listener que a restauração não instalava. Era por isso
// que "Novo Produto" voltava (nasce visível) e "Editar Produto" não.

test('modal que nasce escondido é revelado e restaurado', async () => {
  const conteudo = { itens: [{ id: '1' }] };
  const { janela, overlays, criarOverlay } = montarAmbiente({ estadoNoDisco: estadoComModal(conteudo) });

  let recebido = null;
  janela.Modal = {
    async open(_html, _script, overlayId) {
      const id = `${overlayId}Overlay`;
      overlays.set(id, criarOverlay(id, { comecaEscondido: true }));
      janela.EstadoTrabalho.registrarConteudo(overlayId, {
        capturar: () => ({}),
        restaurar: dados => { recebido = dados; }
      });
      // de propósito: NINGUÉM remove a classe `hidden`
    }
  };

  await janela.restaurarTrabalhoInterrompido(async () => {});

  assert.ok(recebido, 'o modal precisa ser revelado sozinho e restaurado');
  assert.strictEqual(overlays.get('editarOrcamentoOverlay').classList.contains('hidden'), false);
});

test('modal que avisa "carreguei" é revelado na hora', async () => {
  const conteudo = { itens: [{ id: '1' }] };
  const { janela, overlays, criarOverlay, disparar } = montarAmbiente({
    estadoNoDisco: estadoComModal(conteudo)
  });

  let recebido = null;
  janela.Modal = {
    async open(_html, _script, overlayId) {
      const id = `${overlayId}Overlay`;
      overlays.set(id, criarOverlay(id, { comecaEscondido: true }));
      janela.EstadoTrabalho.registrarConteudo(overlayId, {
        capturar: () => ({}),
        restaurar: dados => { recebido = dados; }
      });
      // o modal avisa que terminou de carregar, como faz cliente-novo.js
      setTimeout(() => disparar('modalSpinnerLoaded', overlayId), 50);
    }
  };

  await janela.restaurarTrabalhoInterrompido(async () => {});

  assert.ok(recebido, 'o aviso de carregado precisa revelar o modal');
});

test('registrarContexto grava o contexto e a restauração o devolve ao window', async () => {
  // 1) O modal declara o atalho e o estado é capturado com o overlay aberto.
  const origem = montarAmbiente();
  const overlayAberto = origem.criarOverlay('excluirProdutoOverlay');
  origem.overlays.set('excluirProdutoOverlay', overlayAberto);
  origem.janela.document.querySelectorAll = () => [overlayAberto];

  origem.janela.EstadoTrabalho.registrarContexto('excluirProduto',
    () => ({ produtoExcluir: { id: 42, nome: 'Mesa' } }));

  const capturado = origem.janela.collectState('offline');
  const modalCapturado = capturado.modais.find(m => m.overlayId === 'excluirProdutoOverlay');
  assert.deepStrictEqual(
    modalCapturado.conteudo.__contexto,
    { produtoExcluir: { id: 42, nome: 'Mesa' } },
    'o atalho precisa produzir o __contexto'
  );

  // 2) Na volta, esse contexto vira global ANTES de o script do modal rodar.
  const { janela, overlays, criarOverlay } = montarAmbiente({
    estadoNoDisco: estadoComModal(modalCapturado.conteudo, 'excluirProdutoOverlay')
  });

  janela.Modal = {
    async open(_html, _script, overlayId) {
      janela.__visto.produtoExcluir = janela.produtoExcluir;
      const id = `${overlayId}Overlay`;
      overlays.set(id, criarOverlay(id));
      janela.EstadoTrabalho.registrarContexto(overlayId, () => ({}));
    }
  };

  await janela.restaurarTrabalhoInterrompido(async () => {});

  assert.deepStrictEqual(janela.__visto.produtoExcluir, { id: 42, nome: 'Mesa' },
    'o modal de exclusão precisa saber qual registro apagar');
});

test('reporSelect espera as opções chegarem antes de aplicar o valor', async () => {
  const { janela } = montarAmbiente();

  const select = {
    id: 'novoCliente',
    options: [],
    value: '',
    atributos: {},
    setAttribute(k, v) { this.atributos[k] = v; },
    dispatchEvent() {}
  };

  // as opções só chegam depois — como num `fetch`
  setTimeout(() => { select.options = [{ value: '' }, { value: '42' }]; }, 300);

  const aplicou = await janela.EstadoTrabalho.reporSelect(select, '42');

  assert.strictEqual(aplicou, true);
  assert.strictEqual(select.value, '42');
  assert.strictEqual(select.atributos['data-filled'], 'true');
});

test('reporSelect desiste (sem travar) quando a opção nunca aparece', async () => {
  const { janela } = montarAmbiente();
  const select = { id: 'novoCliente', options: [], value: '', setAttribute() {}, dispatchEvent() {} };

  const aplicou = await janela.EstadoTrabalho.reporSelect(select, '42', 300);

  assert.strictEqual(aplicou, false);
  assert.strictEqual(select.value, '', 'não pode inventar um valor que não existe');
});

// ===================================================================
// A REGRESSÃO QUE MATOU A RESTAURAÇÃO INTEIRA
//
// `src/utils/userActions.js`, ao montar o dashboard, faz:
//
//     sessionStorage.setItem('currentUser', stored);
//     if (localStorage.getItem('rememberUser') !== '1') {
//       localStorage.removeItem('user');
//     }
//
// Isso roda na execução dos scripts, ANTES do `load` em que a restauração
// dispara. Como o `estado-trabalho.js` lia só o `localStorage`, o veredito era
// sempre "não dá para identificar quem está logando agora": nenhum módulo,
// nenhum modal, nada — e o arquivo do disco ficava intocado, provando que a
// restauração nem chegou a tentar.
//
// Estes testes fixam as DUAS pontas: o carimbo do dono ao salvar e a
// identificação do dono ao repor.
// ===================================================================

test('restaura com o usuário APENAS no sessionStorage (sem "lembrar-me")', async () => {
  const conteudo = { itens: [{ id: '1' }] };
  const { janela, overlays, criarOverlay, limpezas } = montarAmbiente({
    estadoNoDisco: estadoComModal(conteudo),
    ondeEstaUsuario: 'sessao'          // exatamente o que o dashboard real faz
  });

  let recebido = null;
  const paginas = [];
  janela.Modal = {
    async open(_html, _script, overlayId) {
      const id = `${overlayId}Overlay`;
      overlays.set(id, criarOverlay(id));
      janela.EstadoTrabalho.registrarConteudo(overlayId, {
        capturar: () => ({}),
        restaurar: dados => { recebido = dados; }
      });
    }
  };

  const restaurou = await janela.restaurarTrabalhoInterrompido(async p => { paginas.push(p); });

  assert.strictEqual(restaurou, true, 'o usuário no sessionStorage precisa contar como dono');
  assert.deepStrictEqual(paginas, ['orcamentos'], 'o módulo tem de voltar');
  assert.ok(recebido, 'o conteúdo do modal tem de voltar');
  assert.strictEqual(limpezas(), 1, 'restaurado com sucesso: o arquivo é consumido');
});

test('o dono é carimbado mesmo com o usuário só no sessionStorage', async () => {
  const { janela, overlays, criarOverlay } = montarAmbiente({ ondeEstaUsuario: 'sessao' });

  const aberto = criarOverlay('novoProdutoOverlay');
  overlays.set('novoProdutoOverlay', aberto);
  janela.document.querySelectorAll = () => [aberto];

  const estado = janela.collectState('offline');

  assert.strictEqual(estado.usuarioId, '7',
    'sem o carimbo do dono o estado é descartado como "sem dono" na volta');
  assert.ok(estado.storage.user, 'o usuário bruto também precisa ir junto');
});

test('sem usuário em lugar nenhum: não restaura E preserva o trabalho', async () => {
  const { janela, limpezas } = montarAmbiente({
    estadoNoDisco: estadoComModal({ itens: [] }),
    ondeEstaUsuario: 'nenhum'
  });

  const restaurou = await janela.restaurarTrabalhoInterrompido(async () => {});

  assert.strictEqual(restaurou, false, 'sem saber de quem é, não se restaura para ninguém');
  assert.strictEqual(limpezas(), 0,
    'o arquivo FICA: quem caiu ainda pode logar dentro dos 30 minutos');
});

test('falha no meio da reposição preserva o trabalho guardado', async () => {
  const { janela, limpezas } = montarAmbiente({
    estadoNoDisco: estadoComModal({ itens: [] })
  });

  // o módulo não carrega (rede ainda instável logo depois da queda)
  const restaurou = await janela.restaurarTrabalhoInterrompido(async () => {
    throw new Error('falha ao carregar o módulo');
  });

  assert.strictEqual(restaurou, false);
  assert.strictEqual(limpezas(), 0,
    'apagar aqui perderia o trabalho sem nunca tê-lo mostrado; a próxima tentativa ainda o encontra');
});
