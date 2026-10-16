/**
 * CNPJ que já está em outra prospecção ativa (16/10/2026): nada é gravado e a
 * caixa de diálogo padrão mostra qual é a ficha, no novo e no editar — antes
 * o editar mostrava o erro cru do banco numa faixa vermelha.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

function carregarForm(dialogPadrao) {
  const chamadas = [];
  const window = { DialogPadrao: dialogPadrao && { info: opcoes => { chamadas.push(opcoes); return Promise.resolve(true); } } };
  vm.runInNewContext(ler('js/modals/prospeccao-form-comum.js'), { window, document: {}, console });
  return { form: window.ProspeccaoForm, chamadas };
}

test('a caixa mostra a prospecção que já tem o CNPJ e diz que nada foi salvo', () => {
  const { form, chamadas } = carregarForm(true);
  const tratou = form.mostrarCnpjEmUso({
    error: 'O CNPJ … já está na prospecção #12',
    cnpj_em_uso: { cnpj: '17.557.509/0001-32', id: 12, nome_fantasia: 'Ornament Casa', razao_social: 'Ornament Decoracoes e Presentes LTDA', etapa: 'Novo', responsavel: 'Bruno Maia' }
  });
  assert.strictEqual(tratou, true);
  const [caixa] = chamadas;
  assert.strictEqual(caixa.tom, 'aviso');
  assert.strictEqual(caixa.title, 'CNPJ já cadastrado');
  assert.match(caixa.subtitle, /17\.557\.509\/0001-32 já está em uma prospecção ativa\. Nada foi salvo\./);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(caixa.secoes[0].itens)), [
    { rotulo: 'Prospecção', valor: '#12' },
    { rotulo: 'Nome fantasia', valor: 'Ornament Casa' },
    { rotulo: 'Razão social', valor: 'Ornament Decoracoes e Presentes LTDA' },
    { rotulo: 'CNPJ', valor: '17.557.509/0001-32' },
    { rotulo: 'Etapa', valor: 'Novo' },
    { rotulo: 'Responsável', valor: 'Bruno Maia' }
  ]);
  assert.match(caixa.nota, /mova uma delas para "Perdido"/);
});

test('sem a ficha na resposta (outro 409) ou sem a caixa padrão, quem chama segue com o aviso de sempre', () => {
  assert.strictEqual(carregarForm(true).form.mostrarCnpjEmUso({ error: 'outro conflito' }), false);
  assert.strictEqual(carregarForm(false).form.mostrarCnpjEmUso({ cnpj_em_uso: { id: 1 } }), false);
});

test('novo e editar usam a caixa no 409 e não fecham o modal', () => {
  const editar = ler('js/modals/prospeccao-editar.js');
  assert.match(editar, /if \(resp\.status === 409 && window\.ProspeccaoForm\.mostrarCnpjEmUso\(corpo\)\) \{[\s\S]*?return;\s*\}/);
  assert.ok(editar.indexOf('mostrarCnpjEmUso(corpo)') < editar.indexOf("if (!resp.ok) throw new Error(corpo.error || 'Erro ao salvar prospecção');"));
  const novo = ler('js/modals/prospeccao-novo.js');
  assert.match(novo, /if \(!window\.ProspeccaoForm\.mostrarCnpjEmUso\(corpo\)\) \{\s*showToast\(/);
});
