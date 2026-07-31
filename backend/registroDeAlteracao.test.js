const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const RAIZ = path.join(__dirname, '..');

/**
 * O histórico de "última alteração" precisa responder três perguntas: QUANDO,
 * EM QUE MÓDULO e O QUÊ. Faltando qualquer uma, o popover de Gestão de Usuários
 * vira enfeite — foi o que aconteceu: só o módulo era gravado, a data se perdia
 * e a descrição saía como "PUT orcamentos/9".
 */

// ===================================================================
// 1. A frase: o que o usuário lê
// ===================================================================
const FONTE_MAIN = fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8');

function recortarFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notStrictEqual(inicio, -1, `função ${nome} não encontrada em main.js`);
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

function recortarConstante(fonte, nome) {
  const inicio = fonte.indexOf(`const ${nome} = `);
  assert.notStrictEqual(inicio, -1, `constante ${nome} não encontrada em main.js`);
  const abre = fonte[fonte.indexOf('= ', inicio) + 2];
  const fecha = abre === '[' ? ']' : '}';
  let i = fonte.indexOf(abre, inicio);
  let nivel = 0;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === abre) nivel += 1;
    else if (fonte[i] === fecha) {
      nivel -= 1;
      if (nivel === 0) break;
    }
  }
  return `${fonte.slice(inicio, i + 1)};`;
}

function carregarDescritor() {
  const contexto = vm.createContext({ URL });
  vm.runInContext(
    [
      recortarConstante(FONTE_MAIN, 'API_MODULE_TITLES'),
      recortarConstante(FONTE_MAIN, 'NOMES_DE_RECURSO'),
      recortarConstante(FONTE_MAIN, 'VERBOS_POR_METODO'),
      recortarConstante(FONTE_MAIN, 'CAMPOS_INTERESSANTES'),
      recortarFuncao(FONTE_MAIN, 'capitalizeModuleName'),
      recortarFuncao(FONTE_MAIN, 'detalharCorpo'),
      recortarFuncao(FONTE_MAIN, 'normalizeFetchAction'),
      'this.normalizeFetchAction = normalizeFetchAction;'
    ].join('\n'),
    contexto
  );
  return contexto.normalizeFetchAction;
}

const normalizeFetchAction = carregarDescritor();

test('a descrição diz o que foi feito, não o verbo HTTP', () => {
  const r = normalizeFetchAction({
    method: 'PATCH',
    url: 'http://localhost/api/orcamentos/9/status',
    bodySummary: '{"situacao":"Aprovado"}',
    ok: true
  });

  assert.equal(r.module, 'Orçamentos');
  assert.equal(r.description, 'Alterou o status do orçamento 9 (situação Aprovado)');
  assert.doesNotMatch(r.description, /PATCH|PUT|POST/, 'verbo HTTP não diz nada a quem lê');
});

test('criar, atualizar e excluir viram verbos em português', () => {
  const criar = normalizeFetchAction({
    method: 'POST', url: 'http://x/api/clientes', bodySummary: '{"nome":"Objeto Casa"}', ok: true
  });
  assert.equal(criar.description, 'Criou o cliente (nome Objeto Casa)');

  const atualizar = normalizeFetchAction({
    method: 'PUT', url: 'http://x/api/produtos/12', bodySummary: '{"nome":"Mesa Lateral"}', ok: true
  });
  assert.equal(atualizar.description, 'Atualizou o produto 12 (nome Mesa Lateral)');

  const excluir = normalizeFetchAction({ method: 'DELETE', url: 'http://x/api/pedidos/3', ok: true });
  assert.equal(excluir.description, 'Excluiu o pedido 3');
});

test('o gênero do recurso é respeitado', () => {
  const r = normalizeFetchAction({ method: 'PUT', url: 'http://x/api/transportadoras/4', ok: true });
  assert.equal(r.description, 'Atualizou a transportadora 4');
});

test('leitura e falha não viram registro de alteração', () => {
  assert.equal(normalizeFetchAction({ method: 'GET', url: 'http://x/api/pedidos', ok: true }), null);
  assert.equal(
    normalizeFetchAction({ method: 'PUT', url: 'http://x/api/pedidos/3', ok: false }),
    null,
    'requisição que falhou não alterou nada'
  );
});

// ===================================================================
// 2. A gravação: durante o trabalho, não só na saída
// ===================================================================
function carregarUserActivity() {
  const caminhoDb = require.resolve('./db');
  const caminhoAlvo = require.resolve('./userActivity');
  const anterior = require.cache[caminhoDb];

  const chamadas = [];
  require.cache[caminhoDb] = new Module(caminhoDb, null);
  require.cache[caminhoDb].filename = caminhoDb;
  require.cache[caminhoDb].loaded = true;
  require.cache[caminhoDb].exports = {
    async put(rota, payload) {
      chamadas.push({ rota, payload });
      return { ok: true };
    }
  };

  delete require.cache[caminhoAlvo];
  const userActivity = require(caminhoAlvo);

  return {
    userActivity,
    chamadas,
    restaurar: () => {
      if (anterior) require.cache[caminhoDb] = anterior;
      else delete require.cache[caminhoDb];
      delete require.cache[caminhoAlvo];
    }
  };
}

test('a alteração é gravada na hora, com data, módulo e detalhe', async () => {
  const { userActivity, chamadas, restaurar } = carregarUserActivity();
  try {
    const quando = new Date('2026-07-31T18:30:00Z');
    const gravou = await userActivity.registrarUltimaAlteracao(7, {
      timestamp: quando,
      modulo: 'Orçamentos',
      descricao: 'Alterou o status do orçamento 9 (situação Aprovado)'
    });

    assert.equal(gravou, true);
    const enviado = chamadas[0].payload;
    assert.equal(new Date(enviado.ultima_alteracao).toISOString(), quando.toISOString());
    assert.equal(enviado.local_ultima_alteracao, 'Orçamentos');
    assert.equal(
      enviado.especificacao_ultima_alteracao,
      'Alterou o status do orçamento 9 (situação Aprovado)'
    );
    assert.ok(enviado.ultima_atividade, 'alterar também é atividade: mantém o usuário online');
  } finally {
    restaurar();
  }
});

test('sem módulo nem detalhe, nada é gravado', async () => {
  const { userActivity, chamadas, restaurar } = carregarUserActivity();
  try {
    const gravou = await userActivity.registrarUltimaAlteracao(7, { timestamp: new Date() });
    assert.equal(gravou, false);
    assert.equal(chamadas.length, 0, 'gravar só a data criaria um registro sem sentido');
  } finally {
    restaurar();
  }
});

test('a saída continua registrando a última alteração da sessão', async () => {
  const { userActivity, chamadas, restaurar } = carregarUserActivity();
  try {
    await userActivity.registrarUltimaSaida(7, {
      saida: new Date('2026-07-31T19:00:00Z'),
      ultimaAcao: {
        timestamp: new Date('2026-07-31T18:30:00Z'),
        modulo: 'Produtos',
        descricao: 'Atualizou o produto 12'
      }
    });

    const enviado = chamadas[0].payload;
    assert.ok(enviado.ultima_saida);
    assert.equal(enviado.local_ultima_alteracao, 'Produtos');
    assert.equal(enviado.especificacao_ultima_alteracao, 'Atualizou o produto 12');
  } finally {
    restaurar();
  }
});

// ===================================================================
// 3. Cada status grava a SUA data
// ===================================================================
const { payloadDeStatus } = require('./pedidosController');

test('cancelar grava data_cancelamento', () => {
  const agora = new Date('2026-07-31T20:00:00Z');
  const payload = payloadDeStatus('Cancelado', agora);

  assert.equal(payload.situacao, 'Cancelado');
  assert.equal(
    payload.data_cancelamento,
    agora.toISOString(),
    'sem esta coluna o balão do status não tem o que mostrar para um pedido cancelado'
  );
});

test('enviar e entregar continuam gravando as suas datas', () => {
  const agora = new Date('2026-07-31T20:00:00Z');
  assert.equal(payloadDeStatus('Enviado', agora).data_envio, agora.toISOString());
  assert.equal(payloadDeStatus('Entregue', agora).data_entrega, agora.toISOString());
});

test('um status sem data própria não inventa coluna', () => {
  const payload = payloadDeStatus('Produção', new Date());
  assert.deepEqual(Object.keys(payload), ['situacao']);
});

test('cada status mexe apenas na sua data', () => {
  const payload = payloadDeStatus('Cancelado', new Date());
  assert.ok(!('data_envio' in payload));
  assert.ok(!('data_entrega' in payload));
});
