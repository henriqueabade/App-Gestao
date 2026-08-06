const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const FONTE = fs.readFileSync(
  path.join(RAIZ, 'src/js/modals/pedido-cancelar.js'),
  'utf8'
);

/**
 * Recorta a função do arquivo real — o teste exercita o código que roda.
 *
 * A contagem de chaves começa DEPOIS da lista de parâmetros: com parâmetro
 * desestruturado (`{ orderId, ... }`) a primeira chave é a do argumento, e
 * contar a partir dela recortava só a assinatura.
 */
function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada`);

  let i = fonte.indexOf('(', inicio);
  let parenteses = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '(') parenteses += 1;
    else if (fonte[i] === ')') {
      parenteses -= 1;
      if (parenteses === 0) break;
    }
  }

  i = fonte.indexOf('{', i);
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

function carregar() {
  const contexto = vm.createContext({});
  vm.runInContext(
    [
      // `normalizeQuantity` é uma arrow constante, não uma declaração.
      'const normalizeQuantity = value => {',
      '  const num = Number(value ?? 0);',
      '  if (!Number.isFinite(num) || num < 0) return 0;',
      '  return Math.trunc(num);',
      '};',
      recortarFuncao(FONTE, 'aplicarSubstituicao'),
      recortarFuncao(FONTE, 'livreNoGrupo'),
      'this.aplicarSubstituicao = aplicarSubstituicao;',
      'this.livreNoGrupo = livreNoGrupo;'
    ].join('\n'),
    contexto
  );
  return contexto;
}

const { aplicarSubstituicao, livreNoGrupo } = carregar();

const grupo = (chave, quantidade, jaSubstituido = 0, extras = {}) => ({
  chave,
  quantidade,
  jaSubstituido,
  pedidoItemId: extras.pedidoItemId ?? 99,
  origem: extras.origem ?? 'estoque',
  ordemOrigem: extras.ordemOrigem ?? 9,
  rotulo: extras.rotulo ?? chave
});

// ===================================================================
// Uma peça, vários lugares no mesmo pedido
//
// O caso que estava quebrado: realocar 2 unidades para uma peça do destino e
// depois 3 para outra registrava só a última. São duas substituições, cada uma
// com o seu lugar e a sua quantidade.
// ===================================================================
test('duas peças de destino diferentes viram duas substituições', () => {
  let lista = [];
  lista = aplicarSubstituicao(lista, {
    orderId: 24,
    quantidade: 2,
    grupo: grupo('24::7::estoque::15', 3, 0, { rotulo: '15/15 — Etiqueta do Produto' })
  });
  lista = aplicarSubstituicao(lista, {
    orderId: 24,
    quantidade: 3,
    grupo: grupo('24::7::estoque::9', 4, 0, { rotulo: '9/15 — Tag de Papel' })
  });

  assert.equal(lista.length, 2);
  assert.deepEqual(lista.map(e => e.quantity), [2, 3]);
  assert.deepEqual(
    lista.map(e => e.grupoDestinoRotulo),
    ['15/15 — Etiqueta do Produto', '9/15 — Tag de Papel']
  );
  // O total enviado ao pedido é a soma das duas, não a última.
  assert.equal(lista.reduce((s, e) => s + e.quantity, 0), 5);
});

test('a mesma peça de destino escolhida de novo soma, sem repetir a linha', () => {
  let lista = aplicarSubstituicao([], {
    orderId: 24, quantidade: 2, grupo: grupo('24::7::estoque::15', 5)
  });
  lista = aplicarSubstituicao(lista, {
    orderId: 24, quantidade: 1, grupo: grupo('24::7::estoque::15', 5, 2)
  });

  assert.equal(lista.length, 1);
  assert.equal(lista[0].quantity, 3);
});

test('editar e trocar a peça de destino MOVE a substituição', () => {
  let lista = aplicarSubstituicao([], {
    orderId: 24, quantidade: 2, grupo: grupo('24::7::estoque::15', 5)
  });
  const anterior = lista[0];

  lista = aplicarSubstituicao(lista, {
    orderId: 24,
    quantidade: 2,
    grupo: grupo('24::7::producao::0', 6, 0, { origem: 'producao', ordemOrigem: 0 }),
    anterior
  });

  assert.equal(lista.length, 1);
  assert.equal(lista[0].grupoDestino, '24::7::producao::0');
  assert.equal(lista[0].grupoDestinoInfo.origem, 'producao');
});

test('quantidade zero remove a substituição em edição', () => {
  let lista = aplicarSubstituicao([], {
    orderId: 24, quantidade: 2, grupo: grupo('24::7::estoque::15', 5)
  });
  lista = aplicarSubstituicao(lista, {
    orderId: 24, quantidade: 0, grupo: grupo('24::7::estoque::15', 5, 2), anterior: lista[0]
  });

  assert.deepEqual(lista, []);
});

test('realocações para pedidos diferentes não se misturam', () => {
  let lista = aplicarSubstituicao([], {
    orderId: 24, quantidade: 2, grupo: grupo('24::7::estoque::15', 5)
  });
  lista = aplicarSubstituicao(lista, {
    orderId: 25, quantidade: 2, grupo: grupo('25::8::estoque::15', 5)
  });

  assert.equal(lista.length, 2);
  assert.deepEqual(lista.map(e => e.orderId), [24, 25]);
});

// ===================================================================
// O saldo de cada peça do destino
//
// "Compatível: 7 unidades" contava as peças do destino, não as que ainda podem
// ser substituídas. Depois de substituir 2 das 7, restam 5.
// ===================================================================
test('o livre desconta o que já foi substituído', () => {
  assert.equal(livreNoGrupo(grupo('a', 7, 2)), 5);
  assert.equal(livreNoGrupo(grupo('a', 7, 7)), 0);
  assert.equal(livreNoGrupo(null), 0);
});

test('editando, as unidades da própria substituição voltam ao saldo', () => {
  const entrada = { orderId: 24, quantity: 3, grupoDestino: 'a' };
  // 3 das 4 já estão com esta mesma entrada: editar precisa enxergar as 4.
  assert.equal(livreNoGrupo(grupo('a', 4, 3), entrada), 4);
  // Outra entrada, outro grupo: não devolve nada.
  assert.equal(livreNoGrupo(grupo('b', 4, 3), entrada), 1);
});
