/**
 * Botão direito (01/10/2026): sugestões do corretor na palavra errada,
 * "Adicionar ao dicionário", copiar/colar nos campos — e nenhum menu fora
 * deles (as telas com menu próprio continuam como estão).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const M = require('./menuDeContexto');

test('palavra errada num campo: as sugestões primeiro, depois o dicionário e a edição', () => {
  const itens = M.montarItens({
    isEditable: true, misspelledWord: 'mêses', dictionarySuggestions: ['meses', 'messes'],
    editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
  });
  assert.deepStrictEqual(itens.slice(0, 2).map(i => [i.tipo, i.rotulo]), [['sugestao', 'meses'], ['sugestao', 'messes']]);
  assert.deepStrictEqual(itens[3], { tipo: 'dicionario', rotulo: 'Adicionar "mêses" ao dicionário', palavra: 'mêses' });
  const papeis = itens.filter(i => i.tipo === 'papel');
  assert.deepStrictEqual(papeis.map(i => i.rotulo), ['Desfazer', 'Refazer', 'Recortar', 'Copiar', 'Colar', 'Selecionar tudo']);
  assert.strictEqual(papeis.find(i => i.papel === 'redo').ativo, false, 'o que não dá para fazer fica apagado');
});

test('sem sugestão, no máximo 6; texto selecionado fora de campo só copia; fora disso, nenhum menu', () => {
  const sem = M.montarItens({ isEditable: true, misspelledWord: 'xyzw', dictionarySuggestions: [] });
  assert.deepStrictEqual(sem[0], { tipo: 'aviso', rotulo: 'Sem sugestões para esta palavra' });
  const muitas = M.montarItens({ isEditable: true, misspelledWord: 'a', dictionarySuggestions: ['1', '2', '3', '4', '5', '6', '7', '8'] });
  assert.strictEqual(muitas.filter(i => i.tipo === 'sugestao').length, M.MAX_SUGESTOES);
  assert.deepStrictEqual(M.montarItens({ isEditable: false, selectionText: 'ACME' }).map(i => i.rotulo), ['Copiar']);
  assert.deepStrictEqual(M.montarItens({ isEditable: false, selectionText: '' }), []);
  assert.deepStrictEqual(M.montarItens({}), []);
});

test('o modelo do Electron: a sugestão troca a palavra, o dicionário aprende, o resto usa os papéis prontos', () => {
  const chamadas = [];
  const wc = { replaceMisspelling: p => chamadas.push(['trocar', p]), session: { addWordToSpellCheckerDictionary: p => chamadas.push(['aprender', p]) } };
  const modelo = M.paraModelo(M.montarItens({ isEditable: true, misspelledWord: 'mêses', dictionarySuggestions: ['meses'] }), wc);
  modelo[0].click();
  modelo.find(m => /dicionário/.test(m.label || '')).click();
  assert.deepStrictEqual(chamadas, [['trocar', 'meses'], ['aprender', 'mêses']]);
  assert.deepStrictEqual(modelo.find(m => m.label === 'Colar'), { role: 'paste', label: 'Colar', enabled: true });
  assert.ok(modelo.some(m => m.type === 'separator'));
});

test('corretor em português quando existe; liga o menu uma vez por janela; main.js liga em toda janela', () => {
  const escolhidos = [];
  M.configurarCorretor({ availableSpellCheckerLanguages: ['en-US', 'pt-BR'], setSpellCheckerLanguages: l => escolhidos.push(l), setSpellCheckerEnabled: () => {} });
  assert.deepStrictEqual(escolhidos, [['pt-BR']]);
  assert.doesNotThrow(() => M.configurarCorretor({ availableSpellCheckerLanguages: ['en-US'], setSpellCheckerLanguages: () => { throw new Error('não deveria'); } }));

  const ouvintes = [];
  const win = { webContents: { on: evento => { ouvintes.push(evento); } } };
  M.ligar(win);
  M.ligar(win);
  assert.deepStrictEqual(ouvintes, ['dom-ready', 'context-menu'], 'uma vez só por janela');

  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const inicio = main.indexOf("app.on('browser-window-created'");
  const ligacao = main.indexOf("require('./backend/menuDeContexto').ligar(win);");
  const sandbox = main.indexOf('if (webPreferences.sandbox) {');
  assert.ok(inicio > 0 && ligacao > inicio && ligacao < sandbox, 'antes do retorno das janelas com sandbox (login e menu são sandbox)');
  assert.ok(main.includes("configurarCorretor(require('electron').session.defaultSession)"));
});

test('texto já salvo (02/10/2026): o clique que dá o foco ao campo é refeito até a conferência marcar a palavra', () => {
  const campo = { isEditable: true, misspelledWord: '' };
  assert.strictEqual(M.precisaReler(campo, { tentativa: 0, focoNovo: true }), true, '1º clique trocou o campo');
  assert.strictEqual(M.precisaReler(campo, { tentativa: 0, focoNovo: false }), false, 'já estava digitando nele: menu na hora');
  assert.strictEqual(M.precisaReler(campo, { tentativa: 1 }), true);
  assert.strictEqual(M.precisaReler(campo, { tentativa: M.TENTATIVAS }), false, 'no máximo 3 vezes');
  assert.strictEqual(M.precisaReler({ ...campo, misspelledWord: 'mêses' }, { tentativa: 0, focoNovo: true }), false, 'veio marcada: menu já');
  assert.strictEqual(M.precisaReler({ isEditable: false }, { tentativa: 0, focoNovo: true }), false, 'fora de campo, nunca');
});

test('ligar: refaz o clique na mesma posição e só abre o menu quando a palavra vem marcada (ou acabam as tentativas)', async () => {
  const idElectron = require.resolve('electron');
  const antes = require.cache[idElectron];
  const abertos = [];
  require.cache[idElectron] = { id: idElectron, filename: idElectron, loaded: true, exports: {
    Menu: { buildFromTemplate: modelo => ({ popup: () => abertos.push(modelo.map(i => i.label)) }) }
  } };
  try {
    const ouvintes = {};
    const cliques = [];
    let agora = 1000;
    const pendentes = [];
    const wc = {
      on: (evento, fn) => { ouvintes[evento] = fn; },
      executeJavaScript: async () => true, // o clique trocou o campo ativo
      sendInputEvent: e => cliques.push(`${e.type}@${e.x},${e.y}`),
      isDestroyed: () => false,
      replaceMisspelling: () => {}, session: { addWordToSpellCheckerDictionary: () => {} }
    };
    M.ligar({ webContents: wc }, { relogio: () => agora, aguardar: (fn, ms) => pendentes.push({ fn, ms }) });
    await ouvintes['context-menu']({}, { isEditable: true, misspelledWord: '', x: 50, y: 20, editFlags: {} });
    assert.strictEqual(abertos.length, 0, 'ainda não abriu');
    assert.strictEqual(pendentes[0].ms, M.RELER_MS);
    pendentes.shift().fn();
    assert.deepStrictEqual(cliques, ['mouseDown@50,20', 'mouseUp@50,20']);
    agora += 120;
    await ouvintes['context-menu']({}, { isEditable: true, misspelledWord: 'mêses', dictionarySuggestions: ['meses'], x: 50, y: 20, editFlags: {} });
    assert.strictEqual(abertos.length, 1);
    assert.strictEqual(abertos[0][0], 'meses', 'a sugestão em cima');

    // Palavra certa: tenta 3 vezes e abre o menu normal.
    abertos.length = 0;
    agora += 5000;
    await ouvintes['context-menu']({}, { isEditable: true, misspelledWord: '', x: 9, y: 9, editFlags: {} });
    for (let i = 0; i < M.TENTATIVAS; i++) {
      pendentes.shift().fn();
      agora += 120;
      await ouvintes['context-menu']({}, { isEditable: true, misspelledWord: '', x: 9, y: 9, editFlags: {} });
    }
    assert.strictEqual(abertos.length, 1);
    assert.strictEqual(abertos[0][0], 'Desfazer');
  } finally {
    if (antes) require.cache[idElectron] = antes; else delete require.cache[idElectron];
  }
});
