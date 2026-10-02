/**
 * Pedidos do dono de 02/10/2026, na tela:
 *   - a ação no sistema aparece na tarefa e no CARD do calendário (⚡), e o
 *     editor avisa quando a API ainda não grava a ação (sql/tarefas_acoes.sql);
 *   - "Cancelar tarefa" no editor (motivo opcional), que não apaga: a
 *     cancelada fica em Tarefas › Canceladas, com o 🚫, e pode ser reaberta;
 *   - Usuários: Online (verde), Ausente (amarelo: programa rodando perto do
 *     relógio) e Offline (vermelho: programa fechado).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const UI = ler('js/utils/tarefas-ui.js');
const CAL = ler('js/calendario.js');
const TAREFAS = ler('js/tarefas.js');
const USU = ler('js/usuarios.js');

test('a ação no card do calendário: o texto curto vem do TarefasUI e o ⚡ entra no mês e na semana/dia', () => {
  // textoDaAcao (pura): extraída e rodada isolada.
  const ini = UI.indexOf('  const competenciaLegivel');
  const fim = UI.indexOf('  /** "Fazer agora"');
  const ctx = {};
  vm.runInNewContext(`${UI.slice(ini, fim)}; this.textoDaAcao = textoDaAcao;`, ctx);
  assert.strictEqual(ctx.textoDaAcao({ acao: { chave: 'financeiro.fechar_comissoes', rotulo: 'Fechar a competência de comissões', registroTipo: 'competencia', registro: '2026-09' } }), 'Fechar a competência de comissões · 09/2026');
  assert.strictEqual(ctx.textoDaAcao({ acao: { chave: 'pedido.despachar', rotulo: 'Despachar o pedido (Enviado)', registroTipo: 'pedido', registroRotulo: 'PED-40 — Loja Boa' } }), 'Despachar o pedido (Enviado) — PED-40 — Loja Boa');
  assert.strictEqual(ctx.textoDaAcao({ acao: null }), '');
  assert.ok(UI.includes('abrirAcao, linhaDeTarefa, mover, montarTarefasDaFicha, textoDaAcao,'), 'exportada');
  assert.ok(CAL.includes("acao: T.textoDaAcao ? T.textoDaAcao(t) : '',"));
  assert.ok(CAL.includes("if (it.acao) el.append(h('span', { class: 'cal-acao', title: it.acao }, icone('fa-bolt')));"), 'mês');
  assert.ok(CAL.includes("it.acao ? h('span', { class: 'cal-acao', title: it.acao }, icone('fa-bolt')) : null), hora);"), 'semana/dia');
  assert.ok(CAL.includes("if (it.acao && it.duracao >= 45) el.append(h('span', { class: 'cal-evento__sub cal-evento__sub--acao', text: `⚡ ${it.acao}` }));"));
  assert.ok(ler('css/calendario.css').includes('.cal-acao {'));
});

test('a ação que a API ainda não grava: o editor avisa (sql/tarefas_acoes.sql) em vez de deixar escolher e perder', () => {
  assert.ok(UI.includes('if (catalogo?.sql_pendente) {'));
  assert.ok(UI.includes("catalogo.mensagem || 'Rode sql/tarefas_acoes.sql e reinicie a API do banco para ligar ações do sistema.'"));
});

test('Cancelar tarefa: no editor para quem edita (tarefa aberta), motivo opcional, rota própria; a cancelada mostra 🚫 e "Cancelada"', () => {
  assert.ok(UI.includes("if (original && !['concluida', 'cancelada'].includes(original.status) && pode.editar) {"));
  assert.ok(UI.includes("icone('fa-ban'), ' Cancelar tarefa'));"));
  assert.ok(UI.includes("await api(`/${t.id}/cancelar`, { method: 'POST', corpo: { motivo: motivo.value.trim() || null } });"));
  assert.ok(UI.includes("placeholder: 'Por que a tarefa foi cancelada? (opcional)'"));
  assert.ok(UI.includes('abrirEditor, copiarTarefa, concluir, cancelarTarefa, responderConvite,'));
  assert.ok(UI.includes("if (cancelada) meta.append(chip('Cancelada', { icone: 'fa-ban', classe: 'tui-chip--perigo'"));
  assert.ok(UI.includes("icone(cancelada ? 'fa-ban' : 'fa-check')"));
  assert.ok(ler('styles/tarefas-ui.css').includes('.tui-tarefa--cancelada .tui-tarefa__check'));
});

test('Tarefas › Canceladas: busca as canceladas, filtro e grupo próprios (não entram nas abertas nem no quadro)', () => {
  assert.ok(TAREFAS.includes("{ chave: 'canceladas', rotulo: 'Canceladas', icone: 'fa-ban', dica: 'Últimos 30 dias — cancelar não apaga' }"));
  assert.ok(TAREFAS.includes('&dias_concluidas=30&canceladas=1'));
  assert.ok(TAREFAS.includes("case 'canceladas': return t.status === 'cancelada';"));
  assert.ok(TAREFAS.includes("if (t.status === 'cancelada') return 'cancelada';"));
  assert.ok(TAREFAS.includes("['cancelada', 'Canceladas', 'fa-ban']"));
  assert.ok(TAREFAS.includes("if (estado.visao === 'quadro' && !['convites', 'canceladas'].includes(estado.filtro.chave)) {"));
});

test('Usuários: Online verde, Ausente amarelo (programa rodando perto do relógio), Offline vermelho (programa fechado)', () => {
  assert.ok(USU.includes("fetchApi('/api/usuarios/lista?presenca=1')"));
  const ini = USU.indexOf('const PRESENCA = {');
  const fim = USU.indexOf('function fecharPopoversUsuarios()');
  const ctx = { resolverStatusOnline: u => Boolean(u.sessao) };
  vm.runInNewContext(`${USU.slice(ini, fim)}; this.resolverPresenca = resolverPresenca; this.PRESENCA = PRESENCA;`, ctx);
  assert.strictEqual(ctx.resolverPresenca({ sessao: true, programa_rodando: true }), 'online');
  assert.strictEqual(ctx.resolverPresenca({ sessao: false, programa_rodando: true }), 'ausente');
  assert.strictEqual(ctx.resolverPresenca({ sessao: false, programa_rodando: false }), 'offline');
  assert.strictEqual(ctx.resolverPresenca({ sessao: false }), 'offline', 'sem o sinal (API antiga): offline');
  assert.deepStrictEqual(Object.values(ctx.PRESENCA).map(p => p.rotulo), ['Online', 'Ausente', 'Offline']);
  assert.ok(USU.includes('const sessaoClasse = `usuario-sessao-badge ${presenca.classe}`;'));
  const css = ler('css/usuarios.css');
  assert.match(css, /\.usuario-sessao-badge\.offline \{[^}]*color: var\(--color-red, #ff5858\);/, 'offline vermelho');
  assert.match(css, /\.usuario-sessao-badge\.ausente \{[^}]*color: #fbbf24;/, 'ausente amarelo');
});
