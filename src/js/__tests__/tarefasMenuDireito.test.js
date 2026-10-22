/**
 * Pedidos do dono de 22/10/2026, nas tarefas:
 *   - botão direito numa tarefa: Editar, Concluir (Reabrir, se fechada) e
 *     Excluir, com o que a pessoa não pode fazer apagado e o motivo;
 *   - excluir mostra o carregando da casa enquanto exclui (antes saía depois
 *     da caixa de confirmação sem sinal nenhum), até a lista se redesenhar;
 *   - o véu do carregando aparece por cima do editor (um <dialog>).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const UI = ler('js/utils/tarefas-ui.js');
const TAREFAS = ler('js/tarefas.js');

/** O TarefasUI de verdade, com a janela, a rede e as caixas de diálogo fingidas. */
function carregar({ confirma = true, respostaOk = true } = {}) {
  const passos = [];
  class CustomEvent { constructor(tipo, init) { this.type = tipo; this.detail = init?.detail; } }
  const janela = {
    DialogPadrao: { confirm: async opcoes => { passos.push(['confirmar', opcoes.title]); return confirma; } },
    BotaoAcao: {
      comCarregamento: async (fn, texto) => {
        passos.push(['veu', texto]);
        try { return await fn(); } finally { passos.push(['veu-fim']); }
      }
    },
    showToast: (texto, tipo) => passos.push(['aviso', tipo, texto]),
    dispatchEvent: evento => {
      passos.push(['mudou', evento.type]);
      // A tela de Tarefas põe a recarga para quem mudou esperar.
      evento.detail.esperar.push(new Promise(r => setTimeout(() => { passos.push(['lista-redesenhada']); r(); }, 5)));
    }
  };
  const contexto = {
    window: janela, CustomEvent, Intl, Date, Map, Set, TextEncoder, console, URL, Promise, setTimeout, Blob: class {},
    fetch: async (url, opcoes) => {
      passos.push(['rede', opcoes.method, url]);
      return { ok: respostaOk, status: respostaOk ? 200 : 403, json: async () => (respostaOk ? {} : { error: 'Sem permissão para excluir.' }) };
    }
  };
  vm.runInNewContext(UI, contexto, { filename: 'tarefas-ui.js' });
  return { T: janela.TarefasUI, passos };
}

const daqui = v => JSON.parse(JSON.stringify(v));

test('botão direito: Editar, Concluir e Excluir numa aberta; o que não pode vem apagado com o motivo', () => {
  const { T } = carregar();
  const tudo = daqui(T.itensDoMenuDaTarefa({ status: 'a_fazer', pode: { editar: true, concluir: true, excluir: true } }));
  assert.deepStrictEqual(tudo.map(i => [i.chave, i.rotulo, i.motivo]), [['editar', 'Editar', ''], ['concluir', 'Concluir', ''], ['excluir', 'Excluir', '']]);

  const semPoder = daqui(T.itensDoMenuDaTarefa({ status: 'em_andamento', pode: {} }));
  assert.deepStrictEqual(semPoder.map(i => [i.chave, i.rotulo]), [['editar', 'Abrir'], ['concluir', 'Concluir'], ['excluir', 'Excluir']]);
  assert.strictEqual(semPoder[0].motivo, '', 'abrir para ver é sempre possível');
  assert.ok(semPoder[1].motivo.includes('responde ou participa'));
  assert.ok(semPoder[2].motivo.includes('Só quem criou'));

  const passo = daqui(T.itensDoMenuDaTarefa({ status: 'a_fazer', origem: 'proximo_passo', pode: { concluir: true } }));
  assert.strictEqual(passo[1].rotulo, 'Concluir o passo');
});

test('botão direito: concluída ou cancelada oferece Reabrir no lugar de Concluir', () => {
  const { T } = carregar();
  for (const status of ['concluida', 'cancelada']) {
    const itens = daqui(T.itensDoMenuDaTarefa({ status, pode: { editar: true, concluir: true, excluir: true } }));
    assert.deepStrictEqual(itens.map(i => i.chave), ['editar', 'reabrir', 'excluir'], status);
  }
});

test('botão direito: ligado na linha de toda tarefa (lista, quadro, fichas), menos nos convites', () => {
  const linha = UI.slice(UI.indexOf('  function linhaDeTarefa('), UI.indexOf('  // ------------------------------------------------------------ tarefas da ficha'));
  assert.ok(linha.includes("if (!convite) el.addEventListener('contextmenu', e => { e.preventDefault(); abrirMenuDaTarefa(t, e, el); });"));
  const menu = UI.slice(UI.indexOf('  function abrirMenuDaTarefa('), UI.indexOf('  async function responderConvite('));
  assert.ok(menu.includes("editar: () => abrirEditor({ id: t.id }),"));
  assert.ok(menu.includes("concluir: () => concluir(t),"));
  assert.ok(menu.includes("excluir: () => excluirTarefa(t)"));
  assert.ok(menu.includes("if (item.motivo) { avisar(item.motivo, 'error'); return; }"), 'apagado não faz nada além de dizer o motivo');
  assert.ok(menu.includes("(linha?.closest?.('dialog[open]') || document.body).append(menu);"), 'dentro do <dialog> da linha, se houver');
  assert.ok(menu.includes("if (e.key === 'Escape')"), 'Esc fecha');
  assert.ok(ler('styles/tarefas-ui.css').includes('.tui-contexto {'));
});

test('excluir: confirma, e só então exclui com o carregando até a lista se redesenhar', async () => {
  const { T, passos } = carregar();
  const ok = await T.excluirTarefa({ id: 42, titulo: 'Ligar para a ACME' });
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(passos, [
    ['confirmar', 'Excluir esta tarefa?'],
    ['veu', 'Excluindo a tarefa…'],
    ['rede', 'DELETE', '/api/tarefas/42'],
    ['mudou', 'tarefas:mudou'],
    ['lista-redesenhada'],
    ['veu-fim'],
    ['aviso', 'success', 'Tarefa excluída.']
  ]);
});

test('excluir: sem confirmar nada sai; erro da API avisa e tira o carregando', async () => {
  const recusou = carregar({ confirma: false });
  assert.strictEqual(await recusou.T.excluirTarefa({ id: 1, titulo: 'X' }), false);
  assert.deepStrictEqual(recusou.passos, [['confirmar', 'Excluir esta tarefa?']]);

  const negado = carregar({ respostaOk: false });
  assert.strictEqual(await negado.T.excluirTarefa({ id: 1, titulo: 'X' }), false);
  assert.deepStrictEqual(negado.passos.slice(-2), [['veu-fim'], ['aviso', 'error', 'Sem permissão para excluir.']]);
});

test('o editor exclui pelo mesmo caminho; a tela de Tarefas avisa quando terminou de recarregar', () => {
  assert.ok(UI.includes("if (await excluirTarefa(original)) { gravou = true; d.fechar(); }"));
  assert.strictEqual(UI.split("method: 'DELETE' });\n        await mudou").length - 1, 1, 'um só DELETE de tarefa');
  assert.ok(TAREFAS.includes('e?.detail?.esperar?.push?.(esta.promessa);'));
  assert.ok(TAREFAS.includes("}, 'Excluindo a lista…');"), 'excluir lista também com o carregando');
});

test('o véu do carregando vai para a camada do topo, por cima de um <dialog> aberto', () => {
  const botao = ler('utils/botaoAcao.js');
  const levar = botao.slice(botao.indexOf('  function levarVeuAoTopo('), botao.indexOf('  async function comCarregamento('));
  assert.ok(levar.includes("ativo.closest('dialog[open]')"), 'dentro do diálogo em que se está');
  assert.ok(levar.includes("veu.setAttribute('popover', 'manual');"));
  assert.ok(levar.includes('veu.showPopover();'));
  assert.ok(botao.includes('#botaoAcaoVeu[popover] {'), 'sem a caixa padrão do popover');
});
