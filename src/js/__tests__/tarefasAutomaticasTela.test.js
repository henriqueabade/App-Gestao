/**
 * Tarefas automáticas na tela — decisões do dono de 24/09/2026:
 *   - toda tarefa automática avisa no sino e no Windows, com a dica pequena
 *     "Pode ser desativada em Tarefas ou em Configurações.";
 *   - Tarefas › Automáticas abre para todos que veem Tarefas, com "Receber
 *     esta tarefa" (só para si); quem configura ajusta a regra para todos;
 *   - Configurações › Tarefas automáticas: o mesmo interruptor, grava na hora.
 * O backend (filtro por permissão, criação, SQL) está em
 * backend/tarefasAutomaticas.test.js e backend/tarefasController.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const SINO = ler('js', 'notifications.js');
const TAREFAS = ler('js', 'tarefas.js');
const TAREFAS_HTML = ler('html', 'tarefas.html');
const TAREFAS_CSS = ler('css', 'tarefas.css');
const CONFIG = ler('js', 'configuracoes.js');
const CONFIG_HTML = ler('html', 'configuracoes.html');
const CONFIG_CSS = ler('css', 'configuracoes.css');
const SINO_CSS = ler('styles', 'historico-social.css');

function trecho(fonte, inicio, fim) {
  const i = fonte.indexOf(inicio);
  const f = fonte.indexOf(fim, i + 1);
  assert.ok(i !== -1 && f > i, `trecho não encontrado: ${inicio}`);
  return fonte.slice(i, f);
}

test('sino: o aviso da tarefa automática tem ícone próprio, a dica pequena e ela vai também para o Windows', () => {
  assert.ok(SINO.includes("tarefa_automatica: 'fa-robot',"));
  assert.ok(SINO.includes("tarefa_automatica: 'Pode ser desativada em Tarefas ou em Configurações.',"));
  assert.ok(SINO.includes("if (dica) corpo.appendChild(criar('span', 'sino-aviso__dica', dica));"), 'a dica numa linha própria, por textContent');
  assert.ok(SINO.includes("const corpo = [aviso.mensagem, DICA_DO_TIPO[aviso.tipo]].filter(Boolean).join('\\n');"));
  assert.ok(SINO.includes('{ body: corpo, tag: `sd-aviso-${aviso.id}` }'));
  assert.match(SINO_CSS, /\.sino-aviso__dica \{[^}]*font-size: 0\.68rem/);
  assert.match(SINO_CSS, /\.sino-aviso__texto--longo \{ -webkit-line-clamp: 3; \}/);
});

test('Tarefas › Automáticas: abre para quem vê Tarefas; "Receber esta tarefa" grava só para si', () => {
  assert.match(TAREFAS_HTML, /id="tarefasBtnAutomacoes"[^>]*data-perm="tarefas\.view"/);
  assert.ok(TAREFAS.includes("$('tarefasBtnAutomacoes').hidden = !estado.ctx?.pode?.ver;"));
  const modal = trecho(TAREFAS, 'async function abrirAutomacoes()', '// ------------------------------------------------------------ atalhos');
  assert.ok(modal.includes("await T.api(`/automacoes/${chave}/minha`, { method: 'PUT', corpo: { ativa } })"));
  assert.ok(modal.includes("await T.api(`/automacoes/${chave}`, { method: 'PUT', corpo: patch })"), 'quem configura continua ajustando para todos');
  assert.ok(modal.includes("text: 'Receber esta tarefa'"));
  assert.ok(modal.includes("text: 'Ligada para todos'"));
  assert.ok(modal.includes("antecedencia ? 'Antecedência (dias)' : 'Prazo (dias)'"), 'a regra do pagamento conta os dias antes do dia marcado');
  assert.ok(modal.includes('if (configura) {'), 'os campos da regra só para quem configura');
  assert.ok(modal.includes('Nenhuma tarefa automática ligada às suas permissões.'));
  assert.ok(modal.includes('sql/tarefas_automaticas_por_usuario.sql'));
  assert.ok(!/innerHTML/.test(modal));
  for (const classe of ['tarefas-regra__textos', 'tarefas-regra__modulo', 'tarefas-regra__minha', 'tarefas-regra__geral', 'tarefas-regra__aviso']) {
    assert.ok(TAREFAS_CSS.includes(`.${classe}`), classe);
  }
});

test('Configurações › Tarefas automáticas: escondido até ter regra; o interruptor grava na hora e volta se falhar', () => {
  assert.match(CONFIG_HTML, /<section id="tarefasAutomaticasSettings" class="settings-card[^"]*" hidden>/);
  assert.ok(CONFIG_HTML.includes('id="tarefasAutomaticasLista"'));
  assert.ok(CONFIG_CSS.includes('.settings-card[hidden] {'), 'o display: flex do cartão não pode anular o hidden');
  const bloco = trecho(CONFIG, "const TAREFAS_AUTOMATICAS_SQL", '    function init() {');
  assert.ok(bloco.includes("await fetchApi('/api/tarefas/automacoes');"));
  assert.ok(bloco.includes('if (!resposta.ok) return;'), 'sem ver Tarefas (403) ou sem o SQL, o quadro fica escondido');
  assert.ok(bloco.includes('fetchApi(`/api/tarefas/automacoes/${encodeURIComponent(regra.chave)}/minha`'));
  assert.ok(bloco.includes('interruptor.checked = !ativa;'), 'falhou: o interruptor volta');
  assert.ok(bloco.includes('secao.hidden = false;'));
  assert.ok(!/innerHTML/.test(bloco), 'nome e descrição vêm do banco: só textContent');
  assert.match(CONFIG, /^ {8}initTarefasAutomaticasSection\(\);\r?$/m, 'chamado no init, sem segurar a abertura da tela');
});
