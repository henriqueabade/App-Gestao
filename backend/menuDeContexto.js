/**
 * Botão direito do mouse nos campos de texto (01/10/2026, pedido do dono):
 * a palavra sublinhada em vermelho mostra as sugestões de correção do
 * corretor (português) e "Adicionar ao dicionário"; em qualquer campo,
 * Desfazer/Refazer/Recortar/Copiar/Colar/Selecionar tudo; num texto
 * selecionado fora de campo, Copiar.
 *
 * Fora disso não abre menu nenhum — as telas que têm menu próprio no botão
 * direito continuam como estão (o Electron só avisa quando a página não
 * cancelou o evento).
 *
 * `montarItens` é pura (testável sem Electron); `ligar` liga a uma janela.
 */

const MAX_SUGESTOES = 6;

/**
 * O que o menu mostra para o clique (os `params` do evento `context-menu`).
 * Devolve uma lista de { tipo, rotulo, ... } — vazia quando não há menu. Pura.
 */
function montarItens(params = {}) {
  const itens = [];
  const palavra = String(params.misspelledWord || '').trim();
  const flags = params.editFlags || {};
  if (palavra && params.isEditable) {
    const sugestoes = (Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : []).slice(0, MAX_SUGESTOES);
    if (sugestoes.length) {
      sugestoes.forEach(s => itens.push({ tipo: 'sugestao', rotulo: s, palavra: s }));
    } else {
      itens.push({ tipo: 'aviso', rotulo: 'Sem sugestões para esta palavra' });
    }
    itens.push({ tipo: 'separador' });
    itens.push({ tipo: 'dicionario', rotulo: `Adicionar "${palavra}" ao dicionário`, palavra });
    itens.push({ tipo: 'separador' });
  }
  if (params.isEditable) {
    itens.push(
      { tipo: 'papel', papel: 'undo', rotulo: 'Desfazer', ativo: flags.canUndo !== false },
      { tipo: 'papel', papel: 'redo', rotulo: 'Refazer', ativo: flags.canRedo !== false },
      { tipo: 'separador' },
      { tipo: 'papel', papel: 'cut', rotulo: 'Recortar', ativo: flags.canCut !== false },
      { tipo: 'papel', papel: 'copy', rotulo: 'Copiar', ativo: flags.canCopy !== false },
      { tipo: 'papel', papel: 'paste', rotulo: 'Colar', ativo: flags.canPaste !== false },
      { tipo: 'separador' },
      { tipo: 'papel', papel: 'selectAll', rotulo: 'Selecionar tudo', ativo: flags.canSelectAll !== false }
    );
  } else if (String(params.selectionText || '').trim()) {
    itens.push({ tipo: 'papel', papel: 'copy', rotulo: 'Copiar', ativo: true });
  }
  return itens;
}

/** Os itens → o modelo do Menu do Electron. `wc`: o webContents do clique. */
function paraModelo(itens, wc) {
  return itens.map(item => {
    switch (item.tipo) {
      case 'separador': return { type: 'separator' };
      case 'aviso': return { label: item.rotulo, enabled: false };
      case 'sugestao': return { label: item.rotulo, click: () => wc.replaceMisspelling(item.palavra) };
      case 'dicionario': return { label: item.rotulo, click: () => wc.session.addWordToSpellCheckerDictionary(item.palavra) };
      default: return { role: item.papel, label: item.rotulo, enabled: item.ativo !== false };
    }
  });
}

/**
 * Texto que JÁ ESTAVA no campo (a descrição salva de uma tarefa, por
 * exemplo): o corretor só confere o campo quando ele recebe o foco — e o
 * clique com o botão direito que dá esse foco chega antes da conferência. O
 * menu abria sem a sugestão e só o 2º clique a trazia ("demora a aparecer",
 * reclamação do dono em 02/10/2026; medido: 2 a 3 cliques).
 *
 * Por isso, quando o clique ACABOU de dar o foco a um campo de texto e não
 * veio palavra marcada, o clique é refeito até TENTATIVAS vezes, a cada
 * RELER_MS (o tempo de a conferência terminar): o menu sai com a sugestão,
 * se a palavra estiver errada (medido: 0,15 a 0,3 s), ou normal, se não
 * houver erro. Quem já estava digitando no campo vê o menu na hora, como
 * antes. Pura na decisão (`precisaReler`).
 */
const RELER_MS = 120;
const TENTATIVAS = 3;
const NOVO_CLIQUE_MS = 1000;

/**
 * Refazer o clique? Só num campo de texto sem palavra marcada, e: no 1º
 * clique, se ele acabou de trocar o campo ativo (`focoNovo`); nos seguintes,
 * até esgotar as tentativas. Pura.
 */
function precisaReler(params = {}, { tentativa = 0, focoNovo = false } = {}) {
  if (!params.isEditable || String(params.misspelledWord || '').trim()) return false;
  if (tentativa >= TENTATIVAS) return false;
  return tentativa > 0 || Boolean(focoNovo);
}

// Anota o campo ativo ANTES de cada clique com o botão direito (a página
// responde pelo main world); o clique que troca o campo é o que chega antes
// da conferência.
const VIGIA_DO_FOCO = "if (!window.__sdVigiaDoFoco) { window.__sdVigiaDoFoco = true; window.addEventListener('mousedown', e => { if (e.button === 2) window.__sdAntesDoClique = document.activeElement; }, true); } true";
const FOCO_NOVO = 'window.__sdAntesDoClique !== undefined && window.__sdAntesDoClique !== document.activeElement';

/** Liga o menu a uma janela (uma vez por webContents). */
function ligar(win, { reler = RELER_MS, relogio = () => Date.now(), aguardar = setTimeout } = {}) {
  const wc = win?.webContents;
  if (!wc || wc.__menuDeContextoLigado) return;
  wc.__menuDeContextoLigado = true;
  wc.on('dom-ready', () => { wc.executeJavaScript(VIGIA_DO_FOCO).catch(() => {}); });
  let tentativa = 0;
  let ultimaEm = 0;
  wc.on('context-menu', async (_evento, params) => {
    if (relogio() - ultimaEm > NOVO_CLIQUE_MS) tentativa = 0; // um clique novo da pessoa
    ultimaEm = relogio();
    let focoNovo = false;
    if (tentativa === 0 && params.isEditable && !params.misspelledWord) {
      focoNovo = Boolean(await wc.executeJavaScript(FOCO_NOVO).catch(() => false));
    }
    if (precisaReler(params, { tentativa, focoNovo })) {
      tentativa += 1;
      aguardar(() => {
        if (wc.isDestroyed?.()) return;
        for (const tipo of ['mouseDown', 'mouseUp']) {
          wc.sendInputEvent({ type: tipo, x: params.x, y: params.y, button: 'right', clickCount: 1 });
        }
      }, reler);
      return;
    }
    tentativa = 0;
    const itens = montarItens(params);
    if (!itens.length) return;
    const { Menu } = require('electron');
    Menu.buildFromTemplate(paraModelo(itens, wc)).popup({ window: win });
  });
}

/** Corretor em português do Brasil, quando o Electron o tem (fica o padrão do sistema se não). */
function configurarCorretor(sessao) {
  try {
    const disponiveis = sessao?.availableSpellCheckerLanguages || [];
    const escolhidos = ['pt-BR', 'pt'].filter(l => disponiveis.includes(l));
    if (escolhidos.length) sessao.setSpellCheckerLanguages([escolhidos[0]]);
    sessao?.setSpellCheckerEnabled?.(true);
  } catch (err) {
    console.warn('[corretor] não foi possível configurar o português:', err?.message || err);
  }
}

module.exports = { MAX_SUGESTOES, RELER_MS, TENTATIVAS, montarItens, paraModelo, precisaReler, ligar, configurarCorretor };
