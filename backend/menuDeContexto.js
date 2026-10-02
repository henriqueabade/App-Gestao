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

/** Liga o menu a uma janela (uma vez por webContents). */
function ligar(win) {
  const wc = win?.webContents;
  if (!wc || wc.__menuDeContextoLigado) return;
  wc.__menuDeContextoLigado = true;
  wc.on('context-menu', (_evento, params) => {
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

module.exports = { MAX_SUGESTOES, montarItens, paraModelo, ligar, configurarCorretor };
