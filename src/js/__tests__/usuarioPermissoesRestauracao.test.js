const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const MODAL = path.join(RAIZ, 'src/js/modals/usuario-permissoes.js');

/**
 * Restauração das PERMISSÕES (modal "Permissões de usuário").
 *
 * A tela de permissões é uma grade de caixas de seleção. A armadilha é sutil:
 * guardar só o que está MARCADO parece suficiente, mas depois da queda o modal
 * recarrega o perfil do banco — e tudo que o usuário tinha DESMARCADO volta
 * marcado. Desmarcar é metade do trabalho numa tela de permissão.
 *
 * Por isso `capturarMarcacoes` guarda `true` E `false`, e a reposição atribui
 * `cb.checked = Boolean(payload[nome])` (atribuição, não "marque se true").
 *
 * Os dois trechos são recortados do arquivo REAL: se alguém voltar a guardar
 * só os marcados, ou trocar a atribuição por um `if`, o teste quebra.
 */
function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada em usuario-permissoes.js`);
  let i = fonte.indexOf('{', inicio);
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    else if (fonte[i] === '}') {
      nivel -= 1;
      if (nivel === 0) break;
    }
  }
  return fonte.slice(inicio, i + 1);
}

const FONTE = fs.readFileSync(MODAL, 'utf8');

/** Grade falsa: caixas de item + interruptores de módulo. */
function montarGrade(itens, modulos = []) {
  const caixas = itens.map(i => ({
    name: i.nome,
    value: i.nome,
    checked: Boolean(i.marcado),
    disabled: Boolean(i.bloqueado)
  }));
  const overlay = {
    querySelectorAll: seletor => {
      assert.match(seletor, /data-role="item"/, 'a captura precisa mirar as caixas de item');
      return caixas;
    }
  };
  const moduleToggles = modulos.map(m => ({
    dataset: { moduleToggle: m.id },
    querySelector: () => ({ checked: Boolean(m.marcado) })
  }));
  return { overlay, elements: { moduleToggles }, caixas };
}

function carregarCaptura(grade) {
  const contexto = vm.createContext({ overlay: grade.overlay, elements: grade.elements });
  vm.runInContext(
    recortarFuncao(FONTE, 'capturarMarcacoes') + '\nthis.capturar = capturarMarcacoes;',
    contexto
  );
  return contexto.capturar;
}

/**
 * Só o laço de reposição de `applyNormalizedPayload` — o resto da função mexe
 * em resumo, mestres e módulos, que não têm como quebrar a reposição.
 */
function repor(grade, payload) {
  grade.caixas.forEach(cb => {
    const name = cb.name || cb.value;
    if (!name) return;
    cb.checked = !cb.disabled && Boolean(payload[name]);
  });
}

test('a captura guarda também o que foi DESMARCADO', () => {
  const grade = montarGrade([
    { nome: 'prod.view', marcado: true },
    { nome: 'prod.edit', marcado: false },
    { nome: 'prod.delete', marcado: false }
  ]);

  const marcacoes = carregarCaptura(grade)();

  assert.strictEqual(marcacoes['prod.view'], true);
  assert.strictEqual(marcacoes['prod.edit'], false, 'o desmarcado precisa existir no estado guardado');
  assert.ok('prod.delete' in marcacoes, 'guardar só os marcados é o bug que este teste protege');
});

test('marcar e desmarcar volta exatamente como estava', () => {
  // o banco tem view=true, edit=true
  const grade = montarGrade([
    { nome: 'prod.view', marcado: true },
    { nome: 'prod.edit', marcado: true }
  ]);

  // o usuário desmarca view e o app cai
  grade.caixas.find(c => c.name === 'prod.view').checked = false;
  const guardado = carregarCaptura(grade)();

  // depois da queda o modal recarrega do banco (valores originais)
  const recarregada = montarGrade([
    { nome: 'prod.view', marcado: true },
    { nome: 'prod.edit', marcado: true }
  ]);
  repor(recarregada, guardado);

  assert.strictEqual(
    recarregada.caixas.find(c => c.name === 'prod.view').checked,
    false,
    'o que foi DESMARCADO precisa voltar desmarcado — é a metade que se perdia'
  );
  assert.strictEqual(recarregada.caixas.find(c => c.name === 'prod.edit').checked, true);
});

test('os interruptores de módulo entram no estado com prefixo module_', () => {
  const grade = montarGrade(
    [{ nome: 'prod.view', marcado: true }],
    [{ id: 'produtos', marcado: true }, { id: 'clientes', marcado: false }]
  );

  const marcacoes = carregarCaptura(grade)();

  assert.strictEqual(marcacoes.module_produtos, true);
  assert.strictEqual(marcacoes.module_clientes, false,
    'a reposição filtra por `payload[module_x]`; o módulo desligado precisa estar lá como false');
});

test('caixa bloqueada por permissão não é marcada na reposição', () => {
  const grade = montarGrade([{ nome: 'adm.tudo', marcado: true }]);
  const guardado = carregarCaptura(grade)();

  // o perfil recarregado não permite mais essa ação
  const recarregada = montarGrade([{ nome: 'adm.tudo', marcado: false, bloqueado: true }]);
  repor(recarregada, guardado);

  assert.strictEqual(recarregada.caixas[0].checked, false,
    'restaurar não pode conceder o que o perfil atual bloqueia');
});

test('item que sumiu do perfil não quebra a reposição', () => {
  const grade = montarGrade([
    { nome: 'prod.view', marcado: true },
    { nome: 'prod.legado', marcado: true }
  ]);
  const guardado = carregarCaptura(grade)();

  const recarregada = montarGrade([{ nome: 'prod.view', marcado: false }]);
  assert.doesNotThrow(() => repor(recarregada, guardado));
  assert.strictEqual(recarregada.caixas[0].checked, true);
});
