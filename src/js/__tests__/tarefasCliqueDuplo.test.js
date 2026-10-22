/**
 * Proteção contra clique duplo em Tarefas e na Agenda (dono, 22/10/2026).
 *
 * Os <button> o BotaoAcao já guarda. Passavam: a linha da tarefa (um
 * <article>) e os itens da Agenda, que abriam DOIS editores; e o Enter nos
 * campos (criação rápida, nova lista, checklist, marcador) e o Ctrl+Enter do
 * editor, que criavam ou gravavam em dobro.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const UI = ler('js/utils/tarefas-ui.js');
const TAREFAS = ler('js/tarefas.js');
const CAL = ler('js/calendario.js');

/** O TarefasUI de verdade com a rede fingida (a API recusa: o editor não chega a abrir). */
function carregar() {
  const chamadas = [];
  const janela = { showToast: () => {}, dispatchEvent: () => {} };
  const contexto = {
    window: janela, Intl, Date, Map, Set, TextEncoder, console, URL, Promise, setTimeout, clearTimeout, Blob: class {},
    CustomEvent: class { constructor(tipo, init) { this.type = tipo; this.detail = init?.detail; } },
    fetch: async url => {
      chamadas.push(url);
      await new Promise(r => setTimeout(r, 5));
      return { ok: false, status: 500, json: async () => ({ error: 'fora do ar' }) };
    }
  };
  vm.runInNewContext(UI, contexto, { filename: 'tarefas-ui.js' });
  return { T: janela.TarefasUI, chamadas };
}

test('umaVez: enquanto a ação corre, a segunda chamada não repete nada', async () => {
  const { T } = carregar();
  let vezes = 0;
  const acao = T.umaVez(async x => { vezes += 1; await new Promise(r => setTimeout(r, 10)); return x * 2; });
  const a = acao(21);
  const b = acao(99);
  assert.strictEqual(a, b, 'a mesma promessa');
  assert.strictEqual(await a, 42);
  assert.strictEqual(vezes, 1);
  assert.strictEqual(await acao(5), 10, 'terminada, vale de novo');
  assert.strictEqual(vezes, 2);
});

test('abrir o editor duas vezes seguidas abre UM editor (clique duplo na linha ou na Agenda)', async () => {
  const { T, chamadas } = carregar();
  const primeiro = T.abrirEditor({ id: 7 });
  const segundo = T.abrirEditor({ id: 7 });
  assert.strictEqual(primeiro, segundo, 'o segundo pedido recebe o primeiro');
  assert.strictEqual(await primeiro, false, 'a API recusou: nada abre');
  assert.deepStrictEqual(chamadas, ['/api/tarefas/contexto'], 'uma ida só à API');
  await T.abrirEditor({ id: 7 });
  assert.strictEqual(chamadas.length, 2, 'terminado (ou falhado), abre de novo');
  // A trava sai assim que o editor aparece; a abertura lenta mostra o carregando.
  assert.ok(UI.includes('      d.showModal();\n      aoMostrar();'));
  assert.ok(UI.includes("const espera = setTimeout(() => { comCarregamento(() => aberto, 'Abrindo a tarefa…'); }, 300);"));
});

test('Enter e Ctrl+Enter não criam nem gravam em dobro', () => {
  assert.ok(UI.includes('const gravar = umaVez(gravarAgora);'), 'Ctrl+Enter + Salvar no editor');
  assert.ok(UI.includes('const adicionarItem = umaVez(async () => {'), 'item do checklist');
  assert.ok(UI.includes('const criarMarcador = umaVez(async () => {'), 'marcador novo');
  assert.ok(TAREFAS.includes("if (e.key === 'Enter') { e.preventDefault(); criarRapidaUmaVez({ completa: e.shiftKey }); }"), 'criação rápida');
  assert.ok(TAREFAS.includes('const criarRapidaUmaVez = T.umaVez(async opcoes => {'));
  assert.ok(TAREFAS.includes('  const criar = T.umaVez(async () => {\n    if (!campo.value.trim())'), 'nova lista');
  assert.ok(CAL.includes('  const criar = T.umaVez(async () => {\n    const r = T.interpretarTexto('), 'criação rápida do dia na Agenda');
});

test('Agenda: clique duplo numa tarefa do mês abre a tarefa, sem criar outra no dia', () => {
  assert.ok(CAL.includes("celula.addEventListener('dblclick', e => { if (e.target.closest?.('button, [role=\"button\"]')) return; criarRapido(dia); });"));
});
