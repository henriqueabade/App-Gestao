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

  let ouvintes = 0;
  const win = { webContents: { on: () => { ouvintes += 1; } } };
  M.ligar(win);
  M.ligar(win);
  assert.strictEqual(ouvintes, 1);

  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const inicio = main.indexOf("app.on('browser-window-created'");
  const ligacao = main.indexOf("require('./backend/menuDeContexto').ligar(win);");
  const sandbox = main.indexOf('if (webPreferences.sandbox) {');
  assert.ok(inicio > 0 && ligacao > inicio && ligacao < sandbox, 'antes do retorno das janelas com sandbox (login e menu são sandbox)');
  assert.ok(main.includes("configurarCorretor(require('electron').session.defaultSession)"));
});
