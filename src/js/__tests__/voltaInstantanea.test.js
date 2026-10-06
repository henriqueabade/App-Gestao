/**
 * Volta instantânea (desempenho, Fase 4 — 06/10/2026): ao voltar a um módulo
 * já visitado, a foto da última visita aparece na hora, com "Atualizando…",
 * enquanto o módulo recarrega por baixo.
 *
 * O que não pode acontecer:
 *  - foto com um modal, um diálogo ou o spinner dentro (a pessoa veria um
 *    modal "fantasma" que não fecha);
 *  - foto de outro layout (janela redimensionada, barra lateral, outro tema):
 *    a troca daria um salto — nesses casos, a máscara de sempre;
 *  - a troca de módulo esperar a foto além do teto.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente } = require('./apoio/domMinimo');

const SRC = path.join(__dirname, '..', '..');
const RAIZ = path.join(SRC, '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');
const FOTO = ler('js/utils/foto-do-modulo.js');

const RETANGULO = { left: 80, top: 80, right: 1580, bottom: 880 };

function montar({ demoraMs = 0, tirar, ler } = {}) {
  const { janela, documento } = criarAmbiente();
  janela.innerWidth = 1600;
  janela.innerHeight = 900;
  documento.documentElement.dataset.menuTheme = 'dark';

  const content = documento.createElement('div');
  content.id = 'content';
  content.dataset.activePage = 'clientes';
  content.scrollTop = 240;
  let retangulo = { ...RETANGULO };
  content.getBoundingClientRect = () => ({ ...retangulo });
  const modulo = documento.createElement('div');
  modulo.className = 'modulo-container';
  modulo.dataset.page = 'clientes'; // como o loadPage marca o módulo de verdade
  content.appendChild(modulo);
  documento.body.appendChild(content);

  // Por padrão nada cobre o módulo: o ponto cai dentro dele.
  let porCima = null;
  documento.elementFromPoint = () => porCima || modulo;

  // Como o main.js: `fotografarArea` lê a tela e devolve um número;
  // `lerFotoDaArea` devolve o JPEG desse número.
  const pedidos = [];
  const leituras = [];
  janela.electronAPI = {
    fotografarArea: tirar || (async area => {
      pedidos.push(area);
      if (demoraMs) await new Promise(r => setTimeout(r, demoraMs));
      return pedidos.length;
    }),
    lerFotoDaArea: ler || (async id => {
      leituras.push(id);
      return new Uint8Array([0xff, 0xd8, 0xff]);
    })
  };
  const criadas = [];
  const revogadas = [];
  janela.URL = {
    createObjectURL: () => { const u = `blob:foto-${criadas.length + 1}`; criadas.push(u); return u; },
    revokeObjectURL: u => revogadas.push(u)
  };
  janela.Blob = class { constructor(partes, opcoes) { this.partes = partes; this.type = opcoes?.type; } };

  vm.createContext(janela);
  vm.runInContext(FOTO, janela);
  return {
    janela, documento, content, modulo, pedidos, leituras, criadas, revogadas,
    Foto: janela.FotoDoModulo,
    cobrir: el => { porCima = el; },
    mudarRetangulo: novo => { retangulo = { ...retangulo, ...novo }; }
  };
}

test('fotografa o módulo pronto: a área visível, a rolagem e o tema', async () => {
  const { Foto, content, pedidos, leituras, criadas } = montar();
  const foto = await Foto.fotografar(content);
  assert.ok(foto, 'não fotografou');
  await foto.pronta;
  assert.deepStrictEqual(leituras, [1], 'o JPEG não foi buscado pelo número da leitura');
  // Pelo JSON: o objeto nasce no contexto do vm (outro Object.prototype).
  assert.strictEqual(JSON.stringify(pedidos), JSON.stringify([{ x: 80, y: 80, width: 1500, height: 800 }]));
  assert.strictEqual(foto.rolagem, 240);
  assert.strictEqual(foto.tema, 'dark');
  assert.strictEqual(foto.url, criadas[0]);
  assert.strictEqual(Foto.queServe('clientes', content), foto, 'a foto recém-tirada não serve');
});

test('o pedido da foto sai no clique, antes de qualquer espera', () => {
  const { Foto, content, pedidos } = montar();
  Foto.fotografar(content); // sem await
  assert.strictEqual(pedidos.length, 1, 'o pedido ficou para depois — a tela já poderia ter mudado');
});

test('não fotografa módulo carregando, com modal aberto, coberto ou sem módulo montado', async () => {
  const casos = {
    carregando: amb => amb.content.classList.add('is-module-loading'),
    modal: amb => amb.documento.body.classList.add('overflow-hidden'),
    coberto: amb => amb.cobrir(amb.documento.body),
    'sem módulo': amb => amb.content.replaceChildren(),
    // A tela de erro do menu também é .modulo-container, mas sem data-page.
    'tela de erro': amb => { delete amb.modulo.dataset.page; },
    'área pequena': amb => amb.mudarRetangulo({ right: 200 }),
    'sem a ponte': amb => { amb.janela.electronAPI = {}; }
  };
  for (const [nome, preparar] of Object.entries(casos)) {
    const amb = montar();
    preparar(amb);
    assert.strictEqual(await amb.Foto.fotografar(amb.content), null, `fotografou: ${nome}`);
    assert.strictEqual(amb.Foto.queServe('clientes', amb.content), null, `ficou foto: ${nome}`);
  }
});

test('o JPEG chega por fora: enquanto não chega a foto não vale, e se falhar ela some', async () => {
  let soltar = null;
  const amb = montar({ ler: () => new Promise(resolve => { soltar = resolve; }) });
  const foto = await amb.Foto.fotografar(amb.content);
  assert.ok(foto, 'a troca não seguiu com a leitura feita');
  assert.strictEqual(amb.Foto.queServe('clientes', amb.content), null, 'serviu foto sem imagem');
  soltar(new Uint8Array([1, 2]));
  await foto.pronta;
  assert.strictEqual(amb.Foto.queServe('clientes', amb.content), foto);

  const falha = montar({ ler: async () => null });
  const semImagem = await falha.Foto.fotografar(falha.content);
  assert.strictEqual(await semImagem.pronta, null);
  assert.strictEqual(falha.Foto.queServe('clientes', falha.content), null);
  assert.strictEqual(falha.criadas.length, 0);
});

test('a foto antiga sai ao sair de novo do módulo, mesmo quando a nova não pode ser tirada', async () => {
  const { Foto, content, revogadas } = montar();
  const antiga = await Foto.fotografar(content);
  await antiga.pronta;
  content.classList.add('is-module-loading'); // agora não dá para fotografar
  await Foto.fotografar(content);
  assert.deepStrictEqual(revogadas, [antiga.url]);
  assert.strictEqual(Foto.queServe('clientes', content), null, 'a foto velha continuou valendo');
});

test('layout que mexe durante a captura descarta a foto', async () => {
  let amb = null;
  amb = montar({
    tirar: async () => {
      amb.mudarRetangulo({ left: 256 }); // a barra lateral recolheu no meio
      return 1;
    }
  });
  assert.strictEqual(await amb.Foto.fotografar(amb.content), null);
  assert.strictEqual(amb.leituras.length, 0, 'buscou o JPEG de uma foto que não confere');
  assert.strictEqual(amb.criadas.length, 0);
});

test('captura lenta não segura a troca de módulo além do teto', async () => {
  const { Foto, content } = montar({ demoraMs: 600 });
  const inicio = Date.now();
  assert.strictEqual(await Foto.fotografar(content), null);
  const levou = Date.now() - inicio;
  assert.ok(levou < Foto.ESPERA_MAXIMA_MS + 150, `esperou ${levou} ms`);
  assert.strictEqual(Foto.ESPERA_MAXIMA_MS, 150);
});

test('a foto só serve na mesma janela, na mesma área, no mesmo tema e por 30 minutos', async () => {
  const mudancas = {
    'janela redimensionada': amb => { amb.janela.innerWidth = 1400; },
    'área do módulo mudou': amb => amb.mudarRetangulo({ left: 256 }),
    'tema trocado': amb => { amb.documento.documentElement.dataset.menuTheme = 'light'; },
    'velha demais': (amb, foto) => { foto.em = Date.now() - 31 * 60 * 1000; }
  };
  for (const [nome, mudar] of Object.entries(mudancas)) {
    const amb = montar();
    const foto = await amb.Foto.fotografar(amb.content);
    await foto.pronta;
    mudar(amb, foto);
    assert.strictEqual(amb.Foto.queServe('clientes', amb.content), null, `serviu: ${nome}`);
    assert.deepStrictEqual(amb.revogadas, [foto.url], `não liberou a memória: ${nome}`);
  }
});

test('o véu mostra a foto no tamanho dela e o selo "Atualizando…"', async () => {
  const { Foto, content } = montar();
  const foto = await Foto.fotografar(content);
  await foto.pronta;
  const veu = Foto.criarVeu(foto, 'Clientes');
  assert.ok(veu.classList.contains('module-snapshot'));
  assert.strictEqual(veu.getAttribute('aria-label'), 'Atualizando Clientes');
  assert.strictEqual(veu.style.width, '1500px');
  assert.strictEqual(veu.style.height, '800px');
  const imagem = veu.querySelector('img');
  assert.strictEqual(imagem.src, foto.url);
  assert.match(veu.querySelector('.module-snapshot-badge').textContent, /Atualizando…/);
});

test('o menu usa a foto: pede na saída, espera antes de trocar, mostra na volta e não anima', () => {
  const menu = ler('js/menu.js');
  const corpo = menu.slice(menu.indexOf('async function loadPage('), menu.indexOf('window.loadPage = loadPage;'));
  const pedido = corpo.indexOf('fotoDoModulo()?.fotografar(content)');
  const permissoes = corpo.indexOf('await window.Permissoes?.carregar?.()');
  const espera = corpo.indexOf('await fotoDaSaida;');
  const troca = corpo.indexOf('content.replaceChildren(');
  assert.ok(pedido > 0 && pedido < permissoes, 'a foto precisa ser pedida antes da primeira espera');
  assert.ok(espera > 0 && espera < troca, 'a tela não pode trocar antes de a foto sair');
  assert.match(corpo, /fotoDoModulo\(\)\?\.queServe\(page, content\)/);
  assert.match(corpo, /if \(veuDaFoto\) module\.classList\.add\('modulo-volta-instantanea'\);/);
  assert.match(corpo, /if \(usesLoadingMask && !veuDaFoto\) \{/, 'o piso do spinner não vale para a foto');
  assert.match(corpo, /content\.scrollTop = Math\.min\(rolagemDaVolta/, 'a rolagem da foto não volta');

  const html = ler('html/menu.html');
  const util = html.indexOf('<script src="../js/utils/foto-do-modulo.js"></script>');
  assert.ok(util > 0 && util < html.indexOf('<script src="../js/menu.js"></script>'), 'o utilitário precisa vir antes do menu.js');

  const css = ler('css/menu.css');
  assert.match(css, /\.module-snapshot \{[^}]*position: absolute;[^}]*z-index: 30;/s);
  assert.match(css, /\.modulo-volta-instantanea \.animate-fade-in-up,\s*\.modulo-volta-instantanea \.module-enter-after-loading \{[^}]*animation: none !important;/s);
});

test('o processo principal fotografa só a janela que pede, em duas etapas; a ponte não entra na contagem', () => {
  const main = fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8');
  const inicio = main.indexOf("ipcMain.handle('modulo:fotografar'");
  assert.ok(inicio > 0, 'sem o canal modulo:fotografar');
  const leitura = main.slice(inicio, main.indexOf("ipcMain.handle('modulo:foto'"));
  const jpeg = main.slice(main.indexOf("ipcMain.handle('modulo:foto'"), main.indexOf("ipcMain.handle('modulo:foto'") + 600);
  assert.match(leitura, /event\.sender\.capturePage\(rect\)/);
  assert.match(leitura, /rect\.width <= 8000 && rect\.height <= 8000/);
  assert.match(leitura, /FOTOS_DE_MODULO\.set\(id, \{ imagem, dono: event\.sender\.id \}\)/);
  assert.match(leitura, /FOTOS_DE_MODULO\.delete\(id\), 15000/, 'a foto não buscada precisa sumir');
  assert.doesNotMatch(leitura, /toJPEG/, 'o JPEG na primeira etapa seguraria a troca de módulo');
  assert.match(jpeg, /foto\.dono !== event\.sender\.id/, 'outra janela não pode buscar a foto');
  assert.match(jpeg, /toJPEG\(82\)/);

  const preload = fs.readFileSync(path.join(RAIZ, 'preload.js'), 'utf8');
  assert.match(preload, /fotografarArea: \(area\) => electronIpcRenderer\.invoke\('modulo:fotografar', area\)/,
    'a foto pelo invoke contado seguraria a máscara do módulo seguinte');
  assert.match(preload, /lerFotoDaArea: \(id\) => electronIpcRenderer\.invoke\('modulo:foto', id\)/);
  assert.match(preload, /SEM_CRONOMETRO_GENERICO = new Set\(\[[^\]]*'fotografarArea', 'lerFotoDaArea'/);
});
