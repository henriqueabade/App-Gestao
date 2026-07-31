const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..', '..');

/**
 * Restauração das PERMISSÕES no módulo de Usuários.
 *
 * Em "Editar Usuário" as permissões não são caixas de seleção: são botões com
 * `aria-pressed`, e o estado vive no array `permissoesState`. A varredura
 * genérica de campos não enxerga nada disso, então o modal captura e repõe o
 * array por conta própria, casando módulo e ação POR CHAVE.
 *
 * Casar por chave errada não quebra nada visivelmente — simplesmente não repõe.
 * Este teste roda os normalizadores REAIS do modal para garantir que as chaves
 * usadas na captura (`modulo` e `nome`) são mesmo as que eles produzem.
 */
function carregarNormalizadores() {
  const fonte = fs.readFileSync(
    path.join(RAIZ, 'src/js/modals/usuario-editar.js'),
    'utf8'
  );

  const recortar = nome => {
    const inicio = fonte.indexOf(`function ${nome}(`);
    assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada no modal`);
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
  };

  const contexto = vm.createContext({});
  vm.runInContext(
    [recortar('formatarTitulo'), recortar('normalizarAcoes'), recortar('normalizarPermissoes')]
      .join('\n') + '\nthis.api = { normalizarPermissoes, normalizarAcoes };',
    contexto
  );
  return contexto.api;
}

/**
 * Mesma lógica de captura/reposição que o modal usa. Se as chaves divergirem
 * dos normalizadores, o `reaplicar` vira um no-op silencioso.
 */
function capturar(permissoesState) {
  return permissoesState.map(modulo => ({
    modulo: modulo.modulo ?? null,
    acoes: (modulo.acoes || []).map(acao => ({
      nome: acao.nome ?? null,
      permitido: Boolean(acao.permitido)
    }))
  }));
}

function reaplicar(permissoesState, guardadas) {
  const porModulo = new Map(guardadas.map(m => [String(m.modulo), m]));
  permissoesState.forEach(modulo => {
    const guardado = porModulo.get(String(modulo.modulo));
    if (!guardado) return;
    const porAcao = new Map((guardado.acoes || []).map(a => [String(a.nome), a]));
    (modulo.acoes || []).forEach(acao => {
      const guardadaAcao = porAcao.get(String(acao.nome));
      if (guardadaAcao) acao.permitido = Boolean(guardadaAcao.permitido);
    });
  });
  return permissoesState;
}

const { normalizarPermissoes } = carregarNormalizadores();

// Os dois formatos que a API devolve.
const BRUTO_OBJETO = {
  materia_prima: { 'mp.view': true, 'mp.create': false, 'mp.delete': false },
  produtos: { 'prod.view': true, 'prod.edit': true }
};

const BRUTO_LISTA = [
  { modulo: 'materia_prima', acoes: [{ nome: 'mp.view', permitido: true }, { nome: 'mp.create', permitido: false }] },
  { modulo: 'produtos', acoes: [{ nome: 'prod.view', permitido: false }] }
];

test('as chaves capturadas existem mesmo no estado normalizado', () => {
  for (const bruto of [BRUTO_OBJETO, BRUTO_LISTA]) {
    const estado = normalizarPermissoes(bruto);
    assert.ok(estado.length, 'o normalizador precisa produzir módulos');

    capturar(estado).forEach(modulo => {
      assert.notStrictEqual(modulo.modulo, null, 'módulo sem chave: a reposição não casaria');
      modulo.acoes.forEach(acao => {
        assert.notStrictEqual(acao.nome, null, 'ação sem chave: a reposição não casaria');
      });
    });
  }
});

test('marcar e desmarcar volta exatamente como estava', () => {
  const estado = normalizarPermissoes(BRUTO_OBJETO);

  // usuário liga um e desliga outro
  const mp = estado.find(m => m.modulo === 'materia_prima');
  mp.acoes.find(a => a.nome === 'mp.create').permitido = true;   // ligou
  mp.acoes.find(a => a.nome === 'mp.view').permitido = false;    // DESLIGOU
  const guardado = capturar(estado);

  // depois da queda o modal recarrega do banco (valores originais)
  const recarregado = normalizarPermissoes(BRUTO_OBJETO);
  reaplicar(recarregado, guardado);

  const mpNovo = recarregado.find(m => m.modulo === 'materia_prima');
  assert.strictEqual(mpNovo.acoes.find(a => a.nome === 'mp.create').permitido, true,
    'o que foi ligado precisa voltar ligado');
  assert.strictEqual(mpNovo.acoes.find(a => a.nome === 'mp.view').permitido, false,
    'o que foi DESLIGADO precisa voltar desligado — é a metade que se perdia');
});

test('chave errada seria um no-op silencioso (guarda contra a regressão)', () => {
  const estado = normalizarPermissoes(BRUTO_OBJETO);
  const mp = estado.find(m => m.modulo === 'materia_prima');
  mp.acoes.find(a => a.nome === 'mp.view').permitido = false;

  // captura com a chave ANTIGA e errada (`chave` em vez de `modulo`/`nome`)
  const guardadoErrado = estado.map(m => ({
    modulo: m.chave ?? null,
    acoes: (m.acoes || []).map(a => ({ nome: a.chave ?? null, permitido: Boolean(a.permitido) }))
  }));

  const recarregado = normalizarPermissoes(BRUTO_OBJETO);
  reaplicar(recarregado, guardadoErrado);

  assert.strictEqual(
    recarregado.find(m => m.modulo === 'materia_prima').acoes.find(a => a.nome === 'mp.view').permitido,
    true,
    'com a chave errada nada é reposto — este teste documenta o bug corrigido'
  );
});

test('módulo ou ação que sumiu do banco não quebra a reposição', () => {
  const estado = normalizarPermissoes(BRUTO_OBJETO);
  estado.find(m => m.modulo === 'produtos').acoes[0].permitido = false;
  const guardado = capturar(estado);

  // o banco agora só tem matéria-prima
  const recarregado = normalizarPermissoes({ materia_prima: { 'mp.view': true } });
  assert.doesNotThrow(() => reaplicar(recarregado, guardado));
  assert.strictEqual(recarregado.length, 1);
});
