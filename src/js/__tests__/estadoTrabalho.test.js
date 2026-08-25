const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');

/**
 * Monta um ambiente mínimo (document + localStorage + electronAPI com um
 * "disco" em memória) e carrega os dois scripts de verdade, na mesma ordem em
 * que o menu.html carrega.
 */
function montarAmbiente({ usuarioLogado = null, paginaAtiva = 'produtos' } = {}) {
  const disco = { arquivo: null };

  const campo = (id, value) => ({
    id, name: '', value, type: 'text', disabled: false, dataset: {},
    dispatchEvent: () => {}
  });

  const content = {
    dataset: { activePage: paginaAtiva },
    querySelectorAll: () => [campo('nomeInput', 'Mesa de Jantar')],
    querySelector: () => null
  };

  const armazenamento = new Map();
  if (usuarioLogado) armazenamento.set('user', JSON.stringify(usuarioLogado));

  const localStorage = {
    getItem: k => (armazenamento.has(k) ? armazenamento.get(k) : null),
    setItem: (k, v) => armazenamento.set(k, String(v)),
    removeItem: k => armazenamento.delete(k)
  };

  const chamadas = { saveState: 0, clearState: 0 };

  const janela = {
    localStorage,
    electronAPI: {
      async saveState(estado) {
        chamadas.saveState += 1;
        disco.arquivo = { savedAt: Date.now(), state: estado };
        return true;
      },
      async loadState() {
        if (!disco.arquivo) return null;
        if (Date.now() - disco.arquivo.savedAt >= 30 * 60 * 1000) {
          disco.arquivo = null;
          return null;
        }
        return disco.arquivo.state;
      },
      async clearState() {
        chamadas.clearState += 1;
        disco.arquivo = null;
        return true;
      }
    },
    document: {
      getElementById: id => (id === 'content' ? content : null),
      querySelectorAll: () => []
    },
    console,
    Event: class { constructor(t) { this.type = t; } },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  janela.window = janela;
  janela.globalThis = janela;

  const contexto = vm.createContext(janela);
  for (const relativo of ['src/js/utils/restauracao.js', 'src/js/estado-trabalho.js']) {
    const codigo = fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
    vm.runInContext(codigo, contexto, { filename: relativo });
  }

  return { janela, disco, chamadas, armazenamento };
}

const X = { id: 7, nome: 'Usuário X' };
const Y = { id: 9, nome: 'Usuário Y' };

// --- Gravação --------------------------------------------------------------

test('queda de internet grava o trabalho carimbado com motivo e dono', async () => {
  const { janela, disco } = montarAmbiente({ usuarioLogado: X });

  const gravou = await janela.EstadoTrabalho.salvarPorDesconexao('offline');

  assert.strictEqual(gravou, true);
  assert.strictEqual(disco.arquivo.state.motivo, 'offline');
  assert.strictEqual(disco.arquivo.state.usuarioId, '7');
  assert.strictEqual(disco.arquivo.state.sectionId, 'produtos');
});

test('sair pelo menu não grava nada', async () => {
  const { janela, disco, chamadas } = montarAmbiente({ usuarioLogado: X });

  const gravou = await janela.EstadoTrabalho.salvarPorDesconexao('logout');

  assert.strictEqual(gravou, false);
  assert.strictEqual(chamadas.saveState, 0);
  assert.strictEqual(disco.arquivo, null);
});

test('sair pelo menu apaga o trabalho gravado por uma queda anterior do MESMO usuário', async () => {
  const { janela, disco } = montarAmbiente({ usuarioLogado: X });

  await janela.EstadoTrabalho.salvarPorDesconexao('offline');
  assert.ok(disco.arquivo, 'a queda precisa ter gravado');

  await janela.EstadoTrabalho.descartarTrabalhoGuardado();
  assert.strictEqual(disco.arquivo, null, 'a saída voluntária limpa o próprio trabalho');
});

test('sair pelo menu NÃO apaga o trabalho de outro usuário que caiu', async () => {
  const { janela: janelaX, disco } = montarAmbiente({ usuarioLogado: X });
  await janelaX.EstadoTrabalho.salvarPorDesconexao('offline');
  const gravadoDeX = disco.arquivo;

  // Y entra na mesma máquina e sai pelo menu; o disco é o mesmo arquivo.
  const { janela: janelaY } = montarAmbiente({ usuarioLogado: Y });
  janelaY.electronAPI.loadState = async () => gravadoDeX.state;
  let apagou = false;
  janelaY.electronAPI.clearState = async () => { apagou = true; };

  await janelaY.EstadoTrabalho.descartarTrabalhoGuardado();

  assert.strictEqual(apagou, false, 'o trabalho de X tem de sobreviver à saída de Y');
});

// --- Leitura ---------------------------------------------------------------

async function lerComo(usuario, estadoNoDisco) {
  const { janela } = montarAmbiente({ usuarioLogado: usuario });
  janela.electronAPI.loadState = async () => estadoNoDisco;
  let apagou = false;
  janela.electronAPI.clearState = async () => { apagou = true; };

  let restaurou = false;
  await janela.restaurarTrabalhoInterrompido(async () => { restaurou = true; });
  return { restaurou, apagou };
}

test('X caiu e X volta: restaura e consome o arquivo', async () => {
  const { janela, disco } = montarAmbiente({ usuarioLogado: X });
  await janela.EstadoTrabalho.salvarPorDesconexao('offline');

  const resultado = await lerComo(X, disco.arquivo.state);

  assert.strictEqual(resultado.restaurou, true);
  assert.strictEqual(resultado.apagou, true, 'restaurado é de uso único');
});

test('X caiu e Y entra: não restaura e o arquivo de X é preservado', async () => {
  const { janela, disco } = montarAmbiente({ usuarioLogado: X });
  await janela.EstadoTrabalho.salvarPorDesconexao('offline');

  const resultado = await lerComo(Y, disco.arquivo.state);

  assert.strictEqual(resultado.restaurou, false);
  assert.strictEqual(resultado.apagou, false, 'X ainda pode voltar dentro dos 30 min');
});

test('estado de versão antiga (sem motivo) não restaura e é descartado', async () => {
  const antigo = {
    sectionId: 'produtos',
    salvoEm: Date.now(),
    storage: { user: JSON.stringify(X) },
    campos: []
  };

  const resultado = await lerComo(X, antigo);

  assert.strictEqual(resultado.restaurou, false);
  assert.strictEqual(resultado.apagou, true, 'lixo de versão antiga pode sair');
});

test('trabalho expirado não restaura e é descartado', async () => {
  const expirado = {
    sectionId: 'produtos',
    motivo: 'offline',
    usuarioId: '7',
    salvoEm: Date.now() - 31 * 60 * 1000,
    storage: { user: JSON.stringify(X) },
    campos: []
  };

  const resultado = await lerComo(X, expirado);

  assert.strictEqual(resultado.restaurou, false);
  assert.strictEqual(resultado.apagou, true);
});

test('corte pelo administrador restaura normalmente', async () => {
  const { janela, disco } = montarAmbiente({ usuarioLogado: X });
  await janela.EstadoTrabalho.salvarPorDesconexao('admin-disabled');

  const resultado = await lerComo(X, disco.arquivo.state);

  assert.strictEqual(resultado.restaurou, true);
});

// --- Corrida com o login ---------------------------------------------------
//
// A janela do dashboard é criada pela de login e chega no `load` — onde a
// restauração dispara — podendo ser ANTES de o `localStorage.user` existir.
// Era o que fazia a restauração parar de funcionar por completo.

test('restaura mesmo quando o usuário só aparece depois do dashboard abrir', async () => {
  const { janela: origem, disco } = montarAmbiente({ usuarioLogado: X });
  await origem.EstadoTrabalho.salvarPorDesconexao('offline');
  const estadoGravado = disco.arquivo.state;

  // dashboard sobe SEM usuário no localStorage
  const { janela, armazenamento } = montarAmbiente({ usuarioLogado: null });
  janela.electronAPI.loadState = async () => estadoGravado;
  let apagou = false;
  janela.electronAPI.clearState = async () => { apagou = true; };

  // o login grava o usuário 400ms depois
  setTimeout(() => armazenamento.set('user', JSON.stringify(X)), 400);

  let paginaPedida = null;
  const restaurou = await janela.restaurarTrabalhoInterrompido(async p => { paginaPedida = p; });

  assert.strictEqual(restaurou, true, 'deve esperar o usuário em vez de desistir');
  assert.strictEqual(paginaPedida, 'produtos');
  assert.strictEqual(apagou, true, 'restaurado é de uso único');
});

test('usuário que nunca aparece NÃO faz o trabalho ser apagado', async () => {
  const { janela: origem, disco } = montarAmbiente({ usuarioLogado: X });
  await origem.EstadoTrabalho.salvarPorDesconexao('offline');
  const estadoGravado = disco.arquivo.state;

  const { janela } = montarAmbiente({ usuarioLogado: null });
  janela.electronAPI.loadState = async () => estadoGravado;
  let apagou = false;
  janela.electronAPI.clearState = async () => { apagou = true; };

  const restaurou = await janela.restaurarTrabalhoInterrompido(async () => {});

  assert.strictEqual(restaurou, false);
  assert.strictEqual(apagou, false, 'sem saber de quem é a vez, o trabalho fica guardado');
});

test('motivo posterior não-restaurável não apaga o que a queda já guardou', async () => {
  const { janela, disco } = montarAmbiente({ usuarioLogado: X });

  // O monitor pode disparar duas vezes com motivos diferentes.
  await janela.EstadoTrabalho.salvarPorDesconexao('offline');
  assert.ok(disco.arquivo, 'a queda guardou');

  await janela.EstadoTrabalho.salvarPorDesconexao('user-removed');

  assert.ok(disco.arquivo, 'o segundo motivo não pode destruir o trabalho guardado');
  assert.strictEqual(disco.arquivo.state.motivo, 'offline');
});


// ---------------------------------------------------------------------------
// Preencher de fora, pelo mesmo contrato da restauração
//
// A restauração de trabalho e o preenchimento por IA são o mesmo problema visto
// de dois lados: pôr valores num formulário recém-aberto, incluindo o que NÃO é
// caixa de texto. Reaproveitar o `restaurar` que cada modal já declara evita
// redescobrir as ordens difíceis — país antes de estado, cliente antes de
// contato, itens antes do total — e redescobrir errado em silêncio.
// ---------------------------------------------------------------------------

/** Ambiente com um overlay que tem campos de verdade dentro. */
function ambienteComOverlay(overlayId, campos = []) {
  const amb = montarAmbiente();
  const elementos = new Map();

  for (const id of campos) {
    elementos.set(id, {
      id, name: '', value: '', type: 'text', disabled: false, dataset: {},
      eventos: [],
      dispatchEvent(e) { this.eventos.push(e?.type || String(e)); }
    });
  }

  const overlay = {
    id: `${overlayId}Overlay`,
    querySelector: sel => elementos.get(String(sel).replace(/^#/, '')) || null,
    querySelectorAll: () => [...elementos.values()]
  };

  const original = amb.janela.document.getElementById;
  amb.janela.document.getElementById = id =>
    (id === overlay.id ? overlay : original(id));

  return { ...amb, campo: id => elementos.get(id) };
}

test('preencher aplica os campos e chama o restaurar do modal', async () => {
  const amb = ambienteComOverlay('novoTeste', ['nomeTeste']);

  let recebido = null;
  amb.janela.EstadoTrabalho.registrarConteudo('novoTeste', {
    capturar: () => ({}),
    restaurar: async dados => { recebido = dados; }
  });

  const r = await amb.janela.EstadoTrabalho.preencher('novoTeste', {
    campos: [{ chave: '#nomeTeste', valor: 'MDF 15mm' }],
    conteudo: { contatos: [{ nome: 'Lúcia' }] }
  });

  assert.strictEqual(amb.campo('nomeTeste').value, 'MDF 15mm');
  // Os dois eventos: `input` acorda máscaras e cálculos, `change` acorda quem
  // só escuta o campo perder o foco. Sem eles o formulário fica com o valor à
  // mostra e o estado interno vazio.
  assert.ok(amb.campo('nomeTeste').eventos.includes('input'));
  assert.ok(amb.campo('nomeTeste').eventos.includes('change'));

  // O conteúdo dinâmico — contatos, itens, insumos — chega pelo contrato que o
  // próprio modal declarou. É a metade que o preenchimento por id não alcança.
  assert.deepStrictEqual(recebido, { contatos: [{ nome: 'Lúcia' }] });
  assert.strictEqual(r.campos, 1);
  assert.strictEqual(r.conteudo, true);
});

test('preencher espera o modal declarar como repor o conteúdo', async () => {
  const amb = ambienteComOverlay('novoTarde');

  let recebido = null;
  // O modal registra o `restaurar` no fim do IIFE dele, DEPOIS de anunciar que
  // carregou. Sem esperar, o preenchimento chegaria antes de existir quem o
  // recebesse — e falharia calado.
  setTimeout(() => {
    amb.janela.EstadoTrabalho.registrarConteudo('novoTarde', {
      capturar: () => ({}),
      restaurar: dados => { recebido = dados; }
    });
  }, 80);

  const r = await amb.janela.EstadoTrabalho.preencher('novoTarde', { conteudo: { itens: [1, 2] } });
  assert.deepStrictEqual(recebido, { itens: [1, 2] });
  assert.strictEqual(r.conteudo, true);
});

test('modal sem conteúdo dinâmico ainda recebe os campos simples', async () => {
  const amb = ambienteComOverlay('novoSimples', ['soTexto']);

  // Nem todo modal tem sub-lista, e a espera pelo registro tem prazo. Desistir
  // do preenchimento inteiro por causa disso perderia também o que dava para
  // preencher.
  const r = await amb.janela.EstadoTrabalho.preencher('novoSimples',
    { campos: [{ chave: '#soTexto', valor: 'valor' }] });

  assert.strictEqual(amb.campo('soTexto').value, 'valor');
  assert.strictEqual(r.campos, 1);
  assert.strictEqual(r.conteudo, false);
});
