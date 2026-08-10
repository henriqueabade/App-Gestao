const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'src/js/materia-prima.js'), 'utf8');

/**
 * Busca de matéria-prima: uma consulta por PAUSA, não por tecla.
 *
 * Filtrar por nome, categoria e processo é instantâneo — a lista já está na
 * tela. O que custa é descobrir quais insumos são usados por um produto com
 * aquele nome, e isso ia ao banco a CADA TECLA: escrever "Apaga Velas Silvia"
 * disparava dezoito consultas em sequência, e a tabela só assentava quando a
 * última voltava.
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

/** DOM mínimo: só a caixa de busca e o contador de renderizações. */
function carregar({ resposta = [], atraso = 0 } = {}) {
  const caixa = { value: '' };
  const chamadas = [];
  const contexto = {
    console: { error() {}, warn() {} },
    setTimeout,
    clearTimeout,
    Set,
    Array,
    Number,
    String,
    Boolean,
    todosMateriais: [],
    // Objeto, não número: o retorno é um espalhamento e copiaria o valor.
    contador: { renders: 0 },
    document: {
      getElementById: id => (id === 'materiaPrimaSearch' ? caixa : null)
    },
    window: {
      electronAPI: {
        listarInsumosPorProduto: async termo => {
          chamadas.push(termo);
          if (atraso) await new Promise(r => setTimeout(r, atraso));
          return resposta;
        }
      }
    },
    // O render real depende de muito DOM; aqui só se conta que ele aconteceu.
    renderMateriais() { contexto.contador.renders += 1; },
    renderTotais() {},
    updateEmptyStateMateriaPrima() {}
  };

  vm.createContext(contexto);
  vm.runInContext(
    [
      'let sequenciaBuscaProduto = 0;',
      'let temporizadorBuscaProduto = null;',
      "let buscaPorProduto = { termo: '', ids: new Set() };",
      'const ESPERA_DIGITACAO_MS = 300;',
      recortarFuncao(FONTE, 'agendarBuscaPorProduto'),
      recortarFuncao(FONTE, 'aplicarFiltros'),
      'this.agendarBuscaPorProduto = agendarBuscaPorProduto;',
      'this.aplicarFiltros = aplicarFiltros;',
      'this.estado = () => buscaPorProduto;'
    ].join('\n'),
    contexto
  );

  return { ...contexto, caixa, chamadas };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

test('digitar não dispara uma consulta por tecla', async () => {
  const app = carregar();

  for (const parcial of ['A', 'Ap', 'Apa', 'Apag', 'Apaga']) {
    app.caixa.value = parcial;
    app.aplicarFiltros();
    app.agendarBuscaPorProduto();
  }

  assert.equal(app.chamadas.length, 0, 'nada sai enquanto o usuário digita');
  assert.equal(app.contador.renders, 5, 'mas a tabela filtra na hora, a cada tecla');

  await esperar(400);
  assert.deepEqual(app.chamadas, ['Apaga'], 'uma consulta só, com o termo final');
});

test('a lista de produtos é aplicada quando chega', async () => {
  const app = carregar({ resposta: [7, 8] });

  app.caixa.value = 'Bandeja';
  app.agendarBuscaPorProduto();
  await esperar(400);

  assert.equal(app.estado().termo, 'bandeja');
  assert.deepEqual([...app.estado().ids], ['7', '8']);
});

test('apagar a busca descarta a lista na hora', async () => {
  const app = carregar({ resposta: [7] });

  app.caixa.value = 'Bandeja';
  app.agendarBuscaPorProduto();
  await esperar(400);
  assert.equal(app.estado().ids.size, 1);

  app.caixa.value = '';
  app.agendarBuscaPorProduto();
  assert.equal(app.estado().ids.size, 0, 'sem termo, a lista de produtos não vale mais');
});

test('resposta atrasada não repinta a tabela de uma busca já trocada', async () => {
  // O caso clássico: a consulta de "Ban" volta depois da de "Bandeja" e
  // sobrescreve o resultado certo pelo antigo.
  const app = carregar({ resposta: [7], atraso: 200 });

  app.caixa.value = 'Ban';
  app.agendarBuscaPorProduto();
  await esperar(320);          // a primeira já saiu e está no ar

  app.caixa.value = 'Bandeja';
  app.agendarBuscaPorProduto();
  await esperar(600);

  assert.equal(app.estado().termo, 'bandeja', 'vale a última busca, não a que voltou depois');
});
