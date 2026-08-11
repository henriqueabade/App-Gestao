const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'src/js/permissoes.js'), 'utf8');

/**
 * Reaplicação de permissões quando a tabela é montada.
 *
 * O observador de DOM recebe TODAS as linhas na mesma mutação. Tratar nó a nó
 * fazia, para cada linha, uma varredura do DOM e a conferência de cada ícone —
 * numa tabela cheia, milhares de idas ao DOM ao abrir o módulo, e de novo a
 * cada filtro. Era o custo que sobrava depois de a rede já estar rápida.
 *
 * O que se defende aqui: menos passadas, cobrindo exatamente os mesmos
 * elementos.
 */

function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada`);
  let i = fonte.indexOf('{', fonte.indexOf('(', inicio));
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

/** Elemento mínimo: só o que `tratarNovosNos` consulta. */
function criarNo({ atributos = [], temAlvoDentro = false, pai = null } = {}) {
  return {
    nodeType: 1,
    parentElement: pai,
    hasAttribute: nome => atributos.includes(nome),
    querySelector: () => (temAlvoDentro ? {} : null)
  };
}

function carregar() {
  const aplicados = [];
  const contexto = {
    // A função começa checando o estado das permissões; aqui elas estão
    // carregadas e nada é liberado em bloco, que é o caso normal do app.
    ESTADO: { carregado: true },
    liberaTudo: () => false,
    aplicarAcoesEColunas: alvo => aplicados.push(alvo),
    Map,
    Set,
    document: { __raiz: true }
  };
  vm.createContext(contexto);
  vm.runInContext(
    `${recortarFuncao(FONTE, 'tratarNovosNos')}\nthis.tratarNovosNos = tratarNovosNos;`,
    contexto
  );
  return { tratarNovosNos: contexto.tratarNovosNos, aplicados };
}

test('uma tabela inteira vira UMA passada, no corpo dela', () => {
  const { tratarNovosNos, aplicados } = carregar();
  const tbody = { __tbody: true };
  // 500 linhas, cada uma com ícones de ação dentro — o caso do módulo cheio.
  const linhas = Array.from({ length: 500 }, () =>
    criarNo({ temAlvoDentro: true, pai: tbody }));

  tratarNovosNos(linhas);

  assert.equal(aplicados.length, 1, '500 linhas não podem virar 500 varreduras');
  assert.equal(aplicados[0], tbody, 'e a passada é no pai, que cobre todas elas');
});

test('nós de pais diferentes são tratados separadamente', () => {
  const { tratarNovosNos, aplicados } = carregar();
  const paiA = { nome: 'A' };
  const paiB = { nome: 'B' };

  tratarNovosNos([
    criarNo({ temAlvoDentro: true, pai: paiA }),
    criarNo({ temAlvoDentro: true, pai: paiB })
  ]);

  // Um alvo por pai: agrupar aqui perderia elementos de um dos lados.
  assert.equal(aplicados.length, 2);
});

test('nó que ELE MESMO tem a marcação vai pelo pai', () => {
  const { tratarNovosNos, aplicados } = carregar();
  const pai = { nome: 'linha' };
  tratarNovosNos([criarNo({ atributos: ['data-perm'], pai })]);

  assert.deepEqual(aplicados, [pai]);
});

test('nó solto, sem pai, cai no documento', () => {
  const { tratarNovosNos, aplicados } = carregar();
  tratarNovosNos([criarNo({ atributos: ['data-perm-col'], pai: null })]);

  assert.equal(aplicados.length, 1);
  assert.equal(aplicados[0].__raiz, true);
});

test('nó sem nada dentro não gera passada nenhuma', () => {
  const { tratarNovosNos, aplicados } = carregar();
  tratarNovosNos([criarNo({ pai: { nome: 'x' } })]);

  assert.deepEqual(aplicados, [], 'texto e nós irrelevantes não custam trabalho');
});

test('nós que não são elemento são ignorados', () => {
  const { tratarNovosNos, aplicados } = carregar();
  tratarNovosNos([null, { nodeType: 3 }, undefined]);

  assert.deepEqual(aplicados, []);
});
