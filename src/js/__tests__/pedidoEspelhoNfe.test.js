const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '../../..');
const ler = nome => fs.readFileSync(path.join(raiz, nome), 'utf8');
const html = ler('src/html/modals/pedidos/emitir-nfe.html');
const fonte = ler('src/js/modals/pedido-emitir-nfe.js');
const viewer = ler('src/js/utils/visualizador-pdf.js');

// DOM mínimo para executar os dois scripts reais, inclusive a guarda de
// emissão, o visualizador, a montagem do PDF e o fechamento dos dois modais.
class No {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {};
    this.className = ''; this.value = ''; this.disabled = false; this.listeners = new Map(); this._texto = '';
    this.classList = {
      contains: classe => this.className.split(/\s+/).includes(classe),
      add: (...classes) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...classes])].join(' '); },
      remove: (...classes) => { this.className = this.className.split(/\s+/).filter(c => !classes.includes(c)).join(' '); },
      toggle: (classe, condicao) => {
        const adicionar = condicao === undefined ? !this.classList.contains(classe) : condicao;
        this.classList[adicionar ? 'add' : 'remove'](classe);
      }
    };
  }
  set textContent(valor) { this._texto = String(valor ?? ''); this.children = []; }
  get textContent() { return this._texto + this.children.map(n => n.textContent).join(''); }
  append(...nos) { for (const n of nos) { n.parent = this; this.children.push(n); } }
  appendChild(no) { this.append(no); return no; }
  replaceChildren(...nos) { this.children = []; this._texto = ''; this.append(...nos); }
  setAttribute(nome, valor) { this[nome] = valor; }
  removeAttribute(nome) { delete this[nome]; }
  addEventListener(tipo, fn) { this.listeners.set(tipo, [...(this.listeners.get(tipo) || []), fn]); }
  removeEventListener(tipo, fn) { this.listeners.set(tipo, (this.listeners.get(tipo) || []).filter(f => f !== fn)); }
  async disparar(tipo, evento = {}) {
    if (tipo === 'click' && this.disabled) return;
    for (const fn of this.listeners.get(tipo) || []) await fn({ target: this, ...evento });
  }
  todos() { return [this, ...this.children.flatMap(n => n.todos())]; }
  querySelectorAll(seletor) {
    if (seletor === 'tr') return this.todos().filter(n => n.tagName === 'TR');
    if (seletor === '[data-emitir-nfe-campos]') return [];
    const volume = /^\[data-volume="([^"]+)"\]$/.exec(seletor);
    if (volume) return this.todos().filter(n => n.dataset.volume === volume[1]);
    if (seletor[0] === '#') return this.todos().filter(n => n.id === seletor.slice(1));
    return [];
  }
  querySelector(seletor) { return this.querySelectorAll(seletor)[0] || null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  focus() {}
}

const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
const aguardar = () => new Promise(resolve => setImmediate(resolve));

async function montar({ situacao = 'Produção', emitir = async () => resposta(200, { autorizada: true, nota: { id: 369, numero: 369, status_fiscal: 'autorizada' } }), espelho = null } = {}) {
  const body = new No('body');
  const overlay = new No(); overlay.id = 'emitirNfePedidoOverlay'; body.append(overlay);
  const nos = {};
  for (const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    if (match[2] === overlay.id) continue;
    const no = new No(match[1]); no.id = match[2]; no.className = /class="([^"]+)"/.exec(match[0])?.[1] || '';
    no.disabled = /\sdisabled[\s>]/.test(match[0]); overlay.append(no); nos[no.id] = no;
  }
  nos.emitirNfeGerarBoleto.checked = false;
  const chamadas = [], fechamentos = [], eventos = [], pdfs = [], avisos = [];
  const listeners = new No(), ouvintesDocumento = new No();
  const document = {
    body, createElement: tag => new No(tag), createTextNode: texto => { const n = new No('#text'); n.textContent = texto; return n; },
    getElementById: id => id === overlay.id ? overlay : (nos[id] || null), querySelector: () => null,
    addEventListener: (...args) => ouvintesDocumento.addEventListener(...args), removeEventListener: (...args) => ouvintesDocumento.removeEventListener(...args)
  };
  const window = {
    emitirNfeContext: { pedidoId: 104, numero: 'PED104', cliente: 'Cliente Exemplo' }, apiConfig: { getApiBaseUrl: async () => 'http://app' },
    addEventListener: (...args) => listeners.addEventListener(...args), removeEventListener: (...args) => listeners.removeEventListener(...args),
    dispatchEvent: e => eventos.push(e), showToast: (...args) => avisos.push(args), carregarPedidos: async () => eventos.push({ type: 'recarregou' }),
    BotaoAcao: { bind: (no, fn) => no.addEventListener('click', fn) },
    electronAPI: { gerarPdfDeHtml: async dados => { pdfs.push(dados); return { success: true, base64: Buffer.from('%PDF-1.4\n/Type /Page\n%%EOF').toString('base64') }; } }
  };
  const fetch = async (url, opcoes = {}) => {
    const chamada = { url, method: opcoes.method || 'GET', corpo: opcoes.body ? JSON.parse(opcoes.body) : null };
    chamadas.push(chamada);
    if (url.endsWith('/prontidao')) return resposta(200, { pronto: true, ambiente: 'producao', notas: [], resumo: { situacao, frete: { modalidade: 1 }, tPagSugerido: '15', itens: [], valorFinal: 19962.05 } });
    if (url.endsWith('/espelho')) return espelho ? espelho(chamada) : resposta(200, { html: '<html>ESPELHO — SEM VALOR FISCAL</html>', espelho: true, sem_valor_fiscal: true, nomeArquivo: 'Espelho-NFe-PED104', revisao_espelho: 'abc123' });
    if (url.endsWith('/emitir')) return emitir(chamada);
    if (url.endsWith('/status')) return resposta(200, { status: 'Enviado' });
    if (url.endsWith('/boletos')) return resposta(403, {});
    throw new Error(`Rota inesperada: ${url}`);
  };
  const contexto = vm.createContext({ window, document, fetch, console: { error() {}, warn() {} }, Modal: { close: id => fechamentos.push(id) },
    CustomEvent: class { constructor(type, opcoes) { this.type = type; this.detail = opcoes?.detail; } },
    Blob, URL: { createObjectURL: () => 'blob:espelho', revokeObjectURL() {} }, Uint8Array, ArrayBuffer, atob, btoa, setTimeout: fn => { fn(); } });
  vm.runInContext(viewer, contexto);
  await vm.runInContext(fonte, contexto);
  nos.emitirNfeEnvio.value = '16/10/2026';
  const visor = () => body.children.find(n => n.dataset.visualizadorPdf);
  const botao = (no, texto) => no?.todos().find(n => n.tagName === 'BUTTON' && n.textContent === texto);
  async function abrir() { await nos.emitirNfeEspelho.disparar('click'); await aguardar(); return visor(); }
  return { nos, chamadas, fechamentos, eventos, pdfs, avisos, abrir, visor, botao, listeners };
}

test('espelho usa campos atuais, HTML→PDF padrão e data de envio; Voltar não emite nem fecha o pai', async () => {
  const h = await montar();
  h.nos.emitirNfeTransportadora.value = 'Vipex'; h.nos.emitirNfeInformacoes.value = 'Obra 104';
  const v = await h.abrir();
  assert.ok(v); assert.equal(h.pdfs.length, 1); assert.equal(h.pdfs[0].retrato, true);
  const pedido = h.chamadas.find(c => c.url.endsWith('/espelho'));
  assert.equal(pedido.method, 'POST'); assert.equal(pedido.corpo.data_envio, '2026-10-16');
  assert.equal(pedido.corpo.transporte.transportadora_nome, 'Vipex'); assert.equal(pedido.corpo.informacoes_complementares, 'Obra 104');
  for (const texto of ['Salvar PDF', 'Imprimir', 'Fechar', 'Voltar', 'Emitir NF-e']) assert.ok(h.botao(v, texto), texto);
  await h.botao(v, 'Voltar').disparar('click');
  assert.equal(h.visor(), undefined); assert.deepEqual(h.fechamentos, []);
  assert.equal(h.chamadas.filter(c => c.url.endsWith('/emitir')).length, 0);
});

test('emissão pelo espelho usa fluxo original uma vez, grava envio e fecha os dois modais', async () => {
  let liberar;
  const h = await montar({ emitir: () => new Promise(resolve => { liberar = resolve; }) });
  h.nos.emitirNfeTransportadora.value = 'Vipex';
  const v = await h.abrir(); const botao = h.botao(v, 'Emitir NF-e');
  const concluindo = botao.disparar('click'); await aguardar();
  await botao.disparar('click'); await h.nos.emitirNfeConfirmar.disparar('click');
  await h.botao(v, 'Fechar').disparar('click'); assert.equal(h.visor(), v, 'durante emissão o espelho permanece aberto');
  assert.equal(h.chamadas.filter(c => c.url.endsWith('/emitir')).length, 1);
  liberar(resposta(200, { autorizada: true, nota: { id: 369, numero: 369 } })); await concluindo;
  const prev = h.chamadas.find(c => c.url.endsWith('/espelho')).corpo;
  const envio = h.chamadas.find(c => c.url.endsWith('/emitir')).corpo;
  assert.deepEqual(envio, { ...prev, revisao_espelho: 'abc123' });
  assert.deepEqual(h.chamadas.find(c => c.url.endsWith('/status')).corpo, { status: 'Enviado', data_envio: '2026-10-16' });
  assert.deepEqual(h.fechamentos, ['emitirNfePedido']); assert.equal(h.visor(), undefined);
  assert.ok(h.eventos.some(e => e.type === 'pedido:enviado'));
});

test('rejeição, timeout e processamento saem do espelho com mensagem na emissão sem mudar situação', async t => {
  for (const [nome, status, corpo, mensagem] of [
    ['rejeição', 422, { sefaz: { cStat: '778', xMotivo: 'NCM inexistente' }, nota: { id: 369, status_fiscal: 'rejeitada' } }, /NCM inexistente/],
    ['timeout', 504, { error: 'A SEFAZ demorou a responder.' }, /demorou/],
    ['dados alterados depois do espelho', 409, { error: 'Os dados da nota mudaram desde a conferência. Abra novamente o Espelho NF-e antes de emitir.' }, /Abra novamente o Espelho NF-e/],
    ['processamento', 200, { autorizada: false, nota: { id: 369, status_fiscal: 'processando' }, sefaz: { cStat: '105' } }, /processando/]
  ]) await t.test(nome, async () => {
    const h = await montar({ emitir: async () => resposta(status, corpo) }); const v = await h.abrir();
    await h.botao(v, 'Emitir NF-e').disparar('click');
    assert.equal(h.visor(), undefined); assert.deepEqual(h.fechamentos, []);
    assert.match(h.nos.emitirNfeMensagem.textContent, mensagem);
    assert.equal(h.nos.emitirNfeMensagem.classList.contains('hidden'), false);
    assert.ok(!h.chamadas.some(c => c.url.endsWith('/status')));
  });
});

test('pedido já enviado emite sem mandar data nova ou alterar a situação', async () => {
  const h = await montar({ situacao: 'Enviado' }); const v = await h.abrir();
  assert.equal(h.chamadas.find(c => c.url.endsWith('/espelho')).corpo.data_envio, undefined);
  await h.botao(v, 'Emitir NF-e').disparar('click');
  assert.equal(h.chamadas.find(c => c.url.endsWith('/emitir')).corpo.data_envio, undefined);
  assert.ok(!h.chamadas.some(c => c.url.endsWith('/status')));
  assert.ok(h.eventos.some(e => e.type === 'nfe:emitida')); assert.deepEqual(h.fechamentos, ['emitirNfePedido']);
});

test('data inválida bloqueia espelho; falha ao montar fecha somente espelho e mostra erro no pai', async () => {
  const h = await montar({ espelho: async () => resposta(422, { error: 'Endereço do destinatário incompleto.' }) });
  h.nos.emitirNfeEnvio.value = '31/02/2026'; await h.abrir();
  assert.equal(h.visor(), undefined); assert.ok(!h.chamadas.some(c => c.url.endsWith('/espelho')));
  h.nos.emitirNfeEnvio.value = '16/10/2026'; await h.abrir();
  assert.equal(h.visor(), undefined); assert.match(h.nos.emitirNfeMensagem.textContent, /Endereço do destinatário/);
  assert.deepEqual(h.fechamentos, []); assert.equal(h.pdfs.length, 0);
});

test('Escape fecha só o espelho; o título da emissão mantém colunas laterais iguais e ordem pedida', async () => {
  const h = await montar(); await h.abrir(); let impedido = false;
  await h.listeners.disparar('keydown', { key: 'Escape', preventDefault() {}, stopImmediatePropagation() { impedido = true; } });
  // A propagação no navegador pára no listener de captura do visualizador.
  assert.equal(impedido, true); assert.equal(h.visor(), undefined);
  assert.deepEqual(h.fechamentos, []);
  assert.ok(html.indexOf('id="voltarEmitirNfe"') < html.indexOf('id="emitirNfeEspelho"'));
  assert.ok(html.indexOf('id="emitirNfeEspelho"') < html.indexOf('id="emitirNfeTitulo"'));
  assert.match(ler('src/styles/pedido-emitir-nfe.css'), /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
});

test('Voltar descarta revisão do espelho: emissão direta continua no fluxo anterior sem token', async () => {
  const h = await montar(); const v = await h.abrir(); await h.botao(v, 'Voltar').disparar('click');
  await h.nos.emitirNfeConfirmar.disparar('click');
  assert.equal(h.chamadas.find(c => c.url.endsWith('/emitir')).corpo.revisao_espelho, undefined);
  assert.deepEqual(h.fechamentos, ['emitirNfePedido']);
});
