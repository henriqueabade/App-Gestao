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
