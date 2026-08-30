/**
 * Fechar o programa tem de fechar o programa — na primeira vez.
 *
 * ---------------------------------------------------------------------------
 * O QUE ACONTECIA
 *
 * Ctrl+W, ou "Fechar" no menu da engrenagem, precisava ser dado duas vezes (às
 * vezes mais). Não era o comando que se perdia: era o encerramento que ficava
 * preso em duas esperas, com a tela intacta e nenhum sinal de que algo estava
 * em curso.
 *
 * 1. O REGISTRO DA SAÍDA. Fechar grava a saída do usuário na API remota, e
 *    essa chamada não tem tempo limite. Numa rede ruim ela segurava a janela
 *    aberta por tempo indefinido.
 *
 * 2. O SERVIDOR LOCAL. `server.close()` só chama de volta quando cai a ÚLTIMA
 *    conexão, e o renderer mantém ligações keep-alive abertas com ele o tempo
 *    todo. Sem derrubá-las, a espera era o keep-alive inteiro.
 *
 * E era por isso que a SEGUNDA vez funcionava: no Ctrl+W, o segundo evento
 * caía na trava `closingDashboardWindow` e passava direto; no menu, a segunda
 * chamada encontrava `apiServerInstance` já nulo e não esperava nada. A
 * conclusão natural de quem usa é "precisa apertar duas vezes".
 *
 * ---------------------------------------------------------------------------
 * COMO ESTE TESTE ALCANÇA O `main.js`
 *
 * `main.js` faz `require('electron')` na primeira linha e não exporta nada:
 * não dá para carregá-lo num teste comum. As funções são RECORTADAS do arquivo
 * e executadas numa VM com o mínimo de Electron fingido. Cada coisa fingida
 * aqui é uma coisa que o teste não mede, e vale saber quais são: as janelas, o
 * servidor local, a gravação da saída e o relógio.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MAIN = path.join(__dirname, '..', '..', '..', 'main.js');
const fonte = () => fs.readFileSync(MAIN, 'utf8');

/** Recorta o trecho que vai de `de` até (exclusive) `ate`. */
function recortar(texto, de, ate) {
  const i = texto.indexOf(de);
  const f = texto.indexOf(ate, i + 1);
  assert.ok(i >= 0, `não achei "${de}" em main.js`);
  assert.ok(f > i, `não achei "${ate}" depois de "${de}"`);
  return texto.slice(i, f);
}

// ---------------------------------------------------------------------------
// Duplos
// ---------------------------------------------------------------------------

/** Um relógio que só dispara quando o teste mandar. */
function criarRelogio() {
  const agendados = new Map();
  let proximo = 1;
  return {
    agendados,
    setTimeout(fn, ms) {
      const id = proximo++;
      agendados.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { agendados.delete(id); },
    /** Dispara o que estava marcado para daqui a `ms` ou menos. */
    avancar(ms) {
      for (const [id, t] of [...agendados]) {
        if (t.ms <= ms) { agendados.delete(id); t.fn(); }
      }
    }
  };
}

function criarJanela(nome) {
  return {
    nome,
    visivel: true,
    destruida: false,
    escondidaEm: null,
    fechamentos: 0,
    isDestroyed() { return this.destruida; },
    isVisible() { return this.visivel; },
    hide() { this.visivel = false; },
    close() { this.fechamentos += 1; }
  };
}

/** Monta `closeApiServer` + `flushAndQuit` e o que elas usam. */
function montarEncerramento({ servidor = null, sessao = { id: 7 }, janelas = [] } = {}) {
  const texto = fonte();
  const trecho = [
    recortar(texto, 'function closeApiServer() {', 'function normalizeMonitorBaseUrl('),
    recortar(texto, 'const PRAZO_DE_SAIDA_MS', 'function createLoginWindow(')
  ].join('\n');

  const relogio = criarRelogio();
  const registro = { monitorParado: 0, saidas: [], saiu: 0 };
  let resolverSaida;
  const saidaPendente = new Promise(r => { resolverSaida = r; });

  const contexto = {
    console: { warn() {}, error() {}, log() {} },
    apiServerInstance: servidor,
    handleApiServerError() {},
    quittingApp: false,
    currentUserSession: sessao,
    stopConnectionMonitor() { registro.monitorParado += 1; },
    persistUserExit(motivo) {
      registro.saidas.push(motivo);
      return saidaPendente;
    },
    app: { quit() { registro.saiu += 1; } },
    BrowserWindow: { getAllWindows: () => janelas },
    Promise,
    setTimeout: relogio.setTimeout,
    clearTimeout: relogio.clearTimeout
  };
  vm.createContext(contexto);
  vm.runInContext(trecho, contexto);

  return { contexto, relogio, registro, resolverSaida, janelas };
}

/** Monta o handler de `close` da janela do dashboard. */
function montarFechamentoDaJanela({ sessao = { id: 7 } } = {}) {
  const texto = fonte();
  const trecho = recortar(texto,
    "  dashboardWindow.on('close', (event) => {",
    '  // Carrega a nova tela de menu');

  const relogio = criarRelogio();
  const janela = criarJanela('dashboard');
  const handlers = new Map();
  let resolverSaida;
  const saidaPendente = new Promise(r => { resolverSaida = r; });
  const registro = { saidas: [], preventDefaults: 0 };

  janela.on = (nome, fn) => handlers.set(nome, fn);

  const contexto = {
    console: { warn() {}, error() {}, log() {} },
    dashboardWindow: janela,
    currentUserSession: sessao,
    closingDashboardWindow: false,
    persistUserExit(motivo) {
      registro.saidas.push(motivo);
      return saidaPendente;
    },
    // As duas vêm do outro recorte; aqui basta o comportamento delas.
    PRAZO_DE_SAIDA_MS: 1500,
    comPrazo(promessa, ms) {
      return new Promise(resolve => {
        const id = relogio.setTimeout(resolve, ms);
        Promise.resolve(promessa).catch(() => {}).finally(() => {
          relogio.clearTimeout(id);
          resolve();
        });
      });
    },
    Promise,
    setTimeout: relogio.setTimeout,
    clearTimeout: relogio.clearTimeout
  };
  vm.createContext(contexto);
  vm.runInContext(trecho, contexto);

  const fechar = () => {
    const evento = { preventDefault() { registro.preventDefaults += 1; } };
    handlers.get('close')(evento);
    return evento;
  };

  // Fechar de verdade re-dispara o evento, como o Electron faz.
  janela.close = function () {
    this.fechamentos = (this.fechamentos || 0) + 1;
    fechar();
    this.destruida = true;
  };
  janela.fechamentos = 0;

  return { contexto, relogio, registro, janela, fechar, resolverSaida };
}

// ---------------------------------------------------------------------------
// O servidor local
// ---------------------------------------------------------------------------

test('encerrar derruba as conexões do servidor local em vez de esperá-las', () => {
  const chamadas = [];
  const servidor = {
    removeListener() {},
    close(cb) { chamadas.push('close'); /* de propósito: NÃO chama de volta */ },
    closeAllConnections() { chamadas.push('closeAllConnections'); }
  };

  const { contexto } = montarEncerramento({ servidor });
  contexto.closeApiServer();

  // Sem derrubar as conexões, `close` só volta quando o keep-alive do renderer
  // expira — segundos com a janela já mandada fechar e a tela parada.
  assert.deepEqual(Array.from(chamadas), ['close', 'closeAllConnections']);
});

test('sem servidor no ar, encerrar não espera nada', async () => {
  const { contexto } = montarEncerramento({ servidor: null });
  await contexto.closeApiServer();
});

test('o servidor é soltado antes da espera, não depois', () => {
  const servidor = { removeListener() {}, close() {}, closeAllConnections() {} };
  const { contexto } = montarEncerramento({ servidor });

  contexto.closeApiServer();
  // Zerar a referência ANTES de esperar é o que faz uma segunda ordem de
  // fechar não tentar derrubar o mesmo servidor de novo.
  assert.equal(contexto.apiServerInstance, null);
});

// ---------------------------------------------------------------------------
// O menu da engrenagem
// ---------------------------------------------------------------------------

test('a tela some ANTES da ida à rede, não depois', () => {
  const janela = criarJanela('dashboard');
  const { contexto, registro } = montarEncerramento({ janelas: [janela] });

  contexto.flushAndQuit('close-window');

  // Sem `await`: o que importa é o que já aconteceu no instante do comando.
  // A gravação da saída ainda está pendurada, e a janela já saiu da tela — é
  // essa a diferença entre "fechou" e "parece que ignorei o clique".
  assert.equal(janela.visivel, false, 'a janela tinha de sumir na hora');
  assert.deepEqual(Array.from(registro.saidas), ['close-window'],
    'e o registro da saída tinha de ter começado');
});

test('uma rede travada não segura o encerramento', async () => {
  const servidor = { removeListener() {}, close(cb) { cb(); }, closeAllConnections() {} };
  const { contexto, relogio, registro } = montarEncerramento({ servidor });

  const encerrando = contexto.flushAndQuit('close-window');

  // A gravação NUNCA responde — é a rede ruim de verdade.
  assert.equal(registro.saiu, 0, 'ainda não saiu, está no prazo');
  relogio.avancar(5000);
  await encerrando;

  assert.equal(registro.saiu, 1,
    'passado o prazo, o programa sai mesmo sem ter conseguido gravar a saída: '
    + 'registrar importa, mas não mais do que obedecer a uma ordem de fechar');
});

test('rede boa: o encerramento não espera o prazo inteiro', async () => {
  const servidor = { removeListener() {}, close(cb) { cb(); }, closeAllConnections() {} };
  const { contexto, resolverSaida, registro, relogio } = montarEncerramento({ servidor });

  const encerrando = contexto.flushAndQuit('close-window');
  resolverSaida();
  await encerrando;

  assert.equal(registro.saiu, 1);
  assert.equal(relogio.agendados.size, 0,
    'o relógio do prazo precisa ser desmarcado, senão fica um timer solto '
    + 'segurando o processo depois do quit');
});

test('a segunda ordem de fechar não regrava a saída', async () => {
  const servidor = { removeListener() {}, close(cb) { cb(); }, closeAllConnections() {} };
  const { contexto, resolverSaida, registro } = montarEncerramento({ servidor });

  const primeira = contexto.flushAndQuit('close-window');
  resolverSaida();
  await primeira;
  await contexto.flushAndQuit('close-window');

  assert.deepEqual(Array.from(registro.saidas), ['close-window'],
    'gravar a saída duas vezes carimbaria a segunda por cima da primeira');
  assert.equal(registro.saiu, 2, 'mas sair é sempre atendido');
});

test('janela já escondida ou destruída não é mexida', () => {
  const escondida = criarJanela('login-oculto');
  escondida.visivel = false;
  const morta = criarJanela('antiga');
  morta.destruida = true;
  morta.hide = () => assert.fail('não se esconde uma janela destruída');

  const { contexto } = montarEncerramento({ janelas: [escondida, morta] });
  contexto.flushAndQuit('close-window');

  assert.equal(escondida.visivel, false);
});

// ---------------------------------------------------------------------------
// Ctrl+W
// ---------------------------------------------------------------------------

test('um Ctrl+W basta: a janela some na hora', () => {
  const { janela, fechar, registro } = montarFechamentoDaJanela();

  fechar();

  assert.equal(registro.preventDefaults, 1, 'o primeiro fechamento é adiado');
  assert.equal(janela.visivel, false,
    'mas a janela sai da tela imediatamente — segurá-la até a rede responder '
    + 'era o que fazia parecer que o comando tinha sido ignorado');
  assert.deepEqual(Array.from(registro.saidas), ['dashboard-close']);
});

test('gravada a saída, o fechamento é refeito e PASSA', async () => {
  const { janela, fechar, registro, resolverSaida, contexto } = montarFechamentoDaJanela();

  fechar();
  // A sessão é zerada pela gravação, como no programa.
  contexto.currentUserSession = null;
  resolverSaida();
  await new Promise(r => setImmediate(r));

  assert.equal(janela.fechamentos, 1, 'o fechamento é refeito uma vez');
  assert.equal(registro.preventDefaults, 1,
    'e não é adiado de novo — o segundo adiamento é o laço que nunca fechava');
  assert.equal(janela.destruida, true);
});

test('o fechamento passa mesmo se a sessão não tiver sido zerada', async () => {
  // `persistUserExit` volta sem zerar nada quando já há uma gravação em curso
  // — um logout disparado junto, por exemplo. A trava é o que garante a
  // passagem nesse caso; sem ela, o fechamento se readiava para sempre.
  const { janela, fechar, registro, resolverSaida } = montarFechamentoDaJanela();

  fechar();
  resolverSaida();
  await new Promise(r => setImmediate(r));

  assert.equal(registro.preventDefaults, 1,
    'a trava precisa continuar valendo NO fechamento que ela existe para '
    + 'deixar passar — solta antes dele, o handler recomeça do zero');
  assert.equal(janela.destruida, true, 'a janela fechou');
});

test('a trava é solta depois, para um fechamento futuro ainda gravar a saída', async () => {
  const { contexto, fechar, resolverSaida } = montarFechamentoDaJanela();

  fechar();
  resolverSaida();
  await new Promise(r => setImmediate(r));

  assert.equal(contexto.closingDashboardWindow, false,
    'deixada em pé, a próxima janela fecharia sem registrar saída nenhuma');
});

test('rede travada no Ctrl+W: a janela fecha pelo prazo', async () => {
  const { janela, fechar, relogio } = montarFechamentoDaJanela();

  fechar();
  assert.equal(janela.destruida, false, 'ainda no prazo');

  relogio.avancar(5000);
  await new Promise(r => setImmediate(r));

  assert.equal(janela.destruida, true,
    'passado o prazo, a janela fecha mesmo sem resposta do servidor');
});

test('sem sessão, fechar é imediato e não adia nada', () => {
  const { janela, fechar, registro } = montarFechamentoDaJanela({ sessao: null });

  fechar();

  assert.equal(registro.preventDefaults, 0);
  assert.equal(registro.saidas.length, 0, 'não há saída de quem não entrou');
  assert.equal(janela.visivel, true, 'nem precisa esconder: o fechamento é direto');
});

// ---------------------------------------------------------------------------
// A tela cheia
// ---------------------------------------------------------------------------

test('a tela cheia não traz de volta a janela que está fechando', () => {
  const texto = fonte();
  const trecho = recortar(texto,
    "  dashboardWindow.on('leave-full-screen'", '  dashboardWindow.webContents.on(');

  // Esconder uma janela em tela cheia pode passar por `leave-full-screen`, e
  // devolvê-la à tela cheia nesse instante é trazer de volta o que acabou de
  // ser mandado embora.
  assert.match(trecho, /if \(closingDashboardWindow \|\| quittingApp\) return;/,
    'o retorno à tela cheia precisa se calar durante o encerramento');
});
