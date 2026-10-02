/**
 * O programa no Windows (01/10/2026) na tela: Configurações › Programa no
 * Windows, a janela dos avisos no canto da tela, o "tum-tum" e o sino.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const CFG_HTML = ler('html/configuracoes.html');
const CFG_JS = ler('js/configuracoes.js');
const AVISO_HTML = ler('html/aviso-windows.html');
const AVISO_JS = ler('js/aviso-windows.js');
const AVISO_CSS = ler('styles/aviso-windows.css');
const SOM_JS = ler('js/utils/som-aviso.js');
const SINO = ler('js/notifications.js');
const MENU = ler('html/menu.html');

/** Um documento mínimo: elementos com textContent, filhos e ouvintes. */
function documentoFalso(ids) {
  const criarEl = tag => {
    const el = {
      tagName: tag, className: '', textContent: '', children: [], ouvintes: {}, atributos: {}, tabIndex: -1,
      appendChild(f) { el.children.push(f); return f; },
      append(...fs) { fs.forEach(f => el.children.push(f)); },
      replaceChildren(...fs) { el.children = [...fs]; },
      setAttribute(k, v) { el.atributos[k] = v; },
      addEventListener(evento, fn) { el.ouvintes[evento] = fn; },
      getBoundingClientRect: () => ({ height: 240 })
    };
    return el;
  };
  const porId = Object.fromEntries(ids.map(id => [id, criarEl('div')]));
  return { porId, document: { getElementById: id => porId[id] || null, createElement: criarEl } };
}

test('Configurações: o quadro "Programa no Windows" com os 3 interruptores, gravando na hora pelo processo principal', () => {
  for (const id of ['programaNoWindowsSettings', 'windowsIniciar', 'windowsAvisos', 'windowsSom', 'programaNoWindowsStatus']) {
    assert.ok(CFG_HTML.includes(`id="${id}"`), id);
  }
  assert.match(CFG_HTML, /<section id="programaNoWindowsSettings"[^>]*hidden>/, 'escondido até o Electron responder');
  assert.ok(CFG_JS.includes("const api = window.electronAPI?.avisosWindows;"));
  assert.ok(CFG_JS.includes('const novas = await api.gravarPreferencias({ [chave]: valor });'));
  assert.ok(CFG_JS.includes('interruptor.checked = !valor;'), 'volta se não gravar');
  assert.ok(CFG_JS.includes("interruptor.disabled = p?.instalado === false;"), 'iniciar com o Windows só no programa instalado');
  assert.ok(CFG_JS.includes('initProgramaNoWindowsSection();'));
});

test('janela do canto: CSP fechada, sem script embutido; a cara do programa (vinho + vidro, ctl-botao, X vermelho, Abrir dourado)', () => {
  assert.match(AVISO_HTML, /script-src 'self';/);
  assert.match(AVISO_HTML, /connect-src 'none'/, 'a janela não fala com rede nenhuma');
  assert.match(AVISO_HTML, /media-src 'self'/, 'o som do dono vem de src/assets');
  assert.ok(!/<script>/.test(AVISO_HTML), 'nada de script embutido');
  assert.ok(!/innerHTML/.test(AVISO_JS), 'tudo por textContent');
  assert.ok(AVISO_HTML.includes('<link rel="stylesheet" href="../styles/controles.css">'));
  assert.match(AVISO_HTML, /<main id="avisoWindows" class="aw ctl-padrao"/);
  assert.match(AVISO_HTML, /<button id="awFechar" type="button" class="aw-fechar btn-danger"/, 'Fechar vermelho, como em todo o programa');
  assert.match(AVISO_HTML, /<button id="awAbrir" type="button" class="ctl-botao btn-primary aw-abrir">/);
  assert.match(AVISO_HTML, /<div id="awVazio" class="aw-vazio" hidden>[\s\S]*Tudo visto por aqui/);
  assert.match(AVISO_CSS, /--menu-background: linear-gradient\(135deg, #310017 0%, #1a0009 100%\);/, 'o vinho do menu');
  assert.match(AVISO_CSS, /--color-surface: rgba\(255, 255, 255, 0\.08\);/, 'o vidro padrão');
  assert.match(AVISO_CSS, /\.btn-primary \{ background: var\(--color-primary\);/);
  assert.match(AVISO_CSS, /\.btn-danger \{ background: var\(--color-red\);/);
});

test('janela do canto PERSISTENTE: até 3 avisos, "e mais N"; clicar abre e tira o aviso; vazia mostra "Tudo visto"; som do dono', () => {
  const { porId, document } = documentoFalso(['avisoWindows', 'awContagem', 'awLista', 'awVazio', 'awMais', 'awFechar', 'awAbrir']);
  const chamadas = [];
  const sons = [];
  const janela = {
    SomAviso: { tocar: o => { sons.push(o); return true; } },
    electronAPI: { avisosWindows: {
      pronto: async () => ({ avisos: [], som: false }), onAvisos: () => {},
      ajustarAltura: a => chamadas.push(['altura', a]), abrir: a => chamadas.push(['abrir', a?.id ?? null]), dispensar: () => chamadas.push(['dispensar'])
    } }
  };
  vm.runInNewContext(AVISO_JS, { window: janela, document, requestAnimationFrame: fn => fn(), console });
  const avisos = [5, 4, 3, 2, 1].map(id => ({ id, tipo: 'registro_excluido', titulo: `Aviso ${id}`, mensagem: 'Ana excluiu a tarefa.', notas: ['Motivo: o cliente desistiu'] }));
  janela.__avisoWindows.receber({ avisos, som: true, somArquivo: 'som-aviso.mp3' });
  assert.strictEqual(porId.awContagem.textContent, '5 avisos novos');
  assert.strictEqual(porId.awLista.children.length, 3);
  assert.strictEqual(porId.awVazio.hidden, true);
  assert.strictEqual(porId.awMais.textContent, 'e mais 2 no sino');
  const primeiro = porId.awLista.children[0];
  const corpo = primeiro.children[1];
  assert.deepStrictEqual(corpo.children.map(c => c.textContent), ['Aviso 5', 'Ana excluiu a tarefa.', 'Motivo: o cliente desistiu']);
  assert.strictEqual(JSON.stringify(sons), '[{"arquivo":"som-aviso.mp3"}]', 'toca o som do dono (o SomAviso cai no tum-tum sem ele)');
  assert.deepStrictEqual(chamadas.find(c => c[0] === 'altura'), ['altura', 242]);

  // Clicar no aviso: abre no programa e ele sai daqui; a janela fica.
  primeiro.ouvintes.click();
  assert.strictEqual(porId.awContagem.textContent, '4 avisos novos');
  assert.strictEqual(porId.awLista.children[0].children[1].children[0].textContent, 'Aviso 4');
  assert.strictEqual(porId.awMais.textContent, 'e mais 1 no sino');
  // "Abrir o programa": abre e a lista fica como está.
  porId.awAbrir.ouvintes.click();
  assert.strictEqual(janela.__avisoWindows.lista().length, 4);
  porId.awFechar.ouvintes.click();
  assert.deepStrictEqual(chamadas.filter(c => c[0] !== 'altura'), [['abrir', 5], ['abrir', null], ['dispensar']]);

  // Um novo chega (o main.js manda a lista toda, o novo em cima), sem som desta vez.
  janela.__avisoWindows.receber({ avisos: avisos.slice(0, 1), som: false });
  assert.strictEqual(porId.awContagem.textContent, '1 aviso novo');
  assert.strictEqual(sons.length, 1, 'sem som desta vez');

  // Todos vistos: a janela continua, com "Tudo visto por aqui", até o X.
  const alturasAntes = chamadas.filter(c => c[0] === 'altura').length;
  janela.__avisoWindows.receber({ avisos: [], som: true });
  assert.strictEqual(porId.awVazio.hidden, false);
  assert.strictEqual(porId.awLista.children.length, 0);
  assert.strictEqual(porId.awContagem.textContent, 'Nenhum aviso novo');
  assert.strictEqual(porId.awMais.textContent, '');
  assert.strictEqual(chamadas.filter(c => c[0] === 'altura').length, alturasAntes + 1, 'a janela se ajusta (não fecha)');
  assert.strictEqual(sons.length, 1, 'vazia não toca');
});

test('o "tum-tum": duas batidas (392 Hz e 330 Hz), geradas na hora; sem Web Audio, não quebra', () => {
  const osciladores = [];
  class ContextoFalso {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createOscillator() {
      const o = { frequencias: [], frequency: { setValueAtTime: (f, t) => o.frequencias.push([f, t]), exponentialRampToValueAtTime() {} }, connect() {}, start: t => { o.inicio = t; }, stop() {} };
      osciladores.push(o);
      return o;
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  const janela = { AudioContext: ContextoFalso };
  vm.runInNewContext(SOM_JS, { window: janela });
  assert.strictEqual(janela.SomAviso.tocar(), true);
  assert.deepStrictEqual(osciladores.map(o => o.frequencias[0][0]), [392, 330]);
  assert.ok(osciladores[1].inicio - osciladores[0].inicio > 0.15, 'a segunda batida vem depois');
  const semAudio = {};
  vm.runInNewContext(SOM_JS, { window: semAudio });
  assert.strictEqual(semAudio.SomAviso.tocar(), false);
});

test('som do dono: toca ../assets/som-aviso.* (até 5 s); nome estranho ou arquivo que não toca = tum-tum', async () => {
  const tocados = [];
  let falhar = false;
  class AudioFalso {
    constructor(src) { this.src = src; tocados.push(this); }
    play() { this.tocou = true; return falhar ? Promise.reject(new Error('formato')) : Promise.resolve(); }
    pause() { this.pausou = true; }
  }
  let tumTum = 0;
  class ContextoFalso {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createOscillator() { tumTum += 1; return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  const relogios = [];
  const janela = { AudioContext: ContextoFalso, setTimeout: (fn, ms) => { relogios.push([fn, ms]); return relogios.length; }, clearTimeout: () => {} };
  vm.runInNewContext(SOM_JS, { window: janela, Audio: AudioFalso });

  assert.strictEqual(janela.SomAviso.tocar({ arquivo: 'som-aviso.mp3' }), true);
  assert.strictEqual(tocados[0].src, '../assets/som-aviso.mp3');
  assert.strictEqual(tocados[0].tocou, true);
  assert.strictEqual(tumTum, 0, 'com o arquivo, sem tum-tum');
  assert.strictEqual(relogios[0][1], 5000);
  relogios[0][0]();
  assert.strictEqual(tocados[0].pausou, true, 'som comprido para em 5 s');

  janela.SomAviso.tocar({ arquivo: '../../windows/x.mp3' });
  assert.strictEqual(tocados.length, 1, 'só o som-aviso de src/assets');
  assert.strictEqual(tumTum, 2, 'nome estranho: tum-tum');

  falhar = true;
  janela.SomAviso.tocar({ arquivo: 'som-aviso.ogg' });
  await new Promise(r => setImmediate(r));
  assert.strictEqual(tumTum, 4, 'arquivo que não toca: tum-tum');
  janela.SomAviso.tocar();
  assert.strictEqual(tumTum, 6, 'sem arquivo: tum-tum');
});

test('sino: com o programa na frente, o aviso novo toca o som; a notificação do Windows é a janela do canto', () => {
  assert.ok(SINO.includes('if (novos.length && somLigado && programaNaFrente()) window.SomAviso?.tocar?.({ arquivo: somArquivo });'));
  assert.match(SINO, /if \(avisosWindows\) \{\s+if \(novos\.length && somLigado && programaNaFrente\(\)\) window\.SomAviso\?\.tocar\?\.\(\{ arquivo: somArquivo \}\);\s+return;\s+\}/,
    'com o Electron, o sino não cria notificação do Windows');
  assert.ok(SINO.includes('somArquivo = p?.somArquivo || null;'), 'o som do dono vem das preferências do processo principal');
  // Lido no sino sai da janela do canto também.
  assert.match(SINO, /async function marcarLidas\(corpo\) \{[\s\S]*?window\.electronAPI\?\.avisosWindows\?\.lidos\?\.\(corpo\)[\s\S]*?\n  \}/);
  assert.ok(SINO.includes("avisosWindows.onAbrirAviso?.((aviso) => { if (aviso?.id !== undefined) abrirAviso({ ...aviso }); });"));
  assert.ok(SINO.includes('avisosWindows.avisoPendente?.()'), 'o aviso clicado com o programa fechado abre depois do login');
  assert.ok(MENU.indexOf('../js/utils/som-aviso.js') > 0 && MENU.indexOf('../js/utils/som-aviso.js') < MENU.indexOf('../js/notifications.js'));
});
