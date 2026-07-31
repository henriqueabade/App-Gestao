const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

/**
 * "Última alteração" no popover de Gestão de Usuários.
 *
 * O defeito: a cada saída sem ação registrada, `registrarUltimaSaida` mandava
 * a DATA da última alteração como `null` e o MÓDULO como `undefined`. O filtro
 * do `updateUsuarioCampos` descartava só o `undefined`, então o `null` chegava
 * ao banco e apagava a data — enquanto o nome do módulo, filtrado, sobrevivia.
 *
 * O resultado na tela era esta contradição:
 *   Última alteração:     Sem registro
 *   Alteração registrada: Usuário alterou o módulo Produtos
 *
 * Quando, onde e o quê descrevem UM evento: ou vão os três, ou não vai nenhum.
 */
function carregarComPoolFalso() {
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

test('saída SEM ação registrada não apaga a última alteração', async () => {
  const { userActivity, chamadas, restaurar } = carregarComPoolFalso();
  try {
    await userActivity.registrarUltimaSaida(7, { saida: new Date('2026-07-31T18:00:00Z') });

    assert.equal(chamadas.length, 1);
    const enviado = chamadas[0].payload;

    assert.ok(enviado.ultima_saida, 'a saída em si continua sendo gravada');
    for (const campo of [
      'ultima_alteracao',
      'ultima_alteracao_em',
      'ultima_acao_em',
      'local_ultima_alteracao',
      'local_ultima_acao',
      'especificacao_ultima_alteracao',
      'especificacao_ultima_acao'
    ]) {
      assert.ok(
        !(campo in enviado),
        `"${campo}" não pode ser enviado: mandar vazio APAGA o que já estava registrado`
      );
    }
  } finally {
    restaurar();
  }
});

test('saída COM ação grava quando, onde e o quê juntos', async () => {
  const { userActivity, chamadas, restaurar } = carregarComPoolFalso();
  try {
    const quando = new Date('2026-07-31T16:16:41Z');
    await userActivity.registrarUltimaSaida(7, {
      saida: new Date('2026-07-31T18:00:00Z'),
      ultimaAcao: { timestamp: quando, modulo: 'Produtos', descricao: 'Alterou o preço' }
    });

    const enviado = chamadas[0].payload;
    assert.equal(new Date(enviado.ultima_alteracao).toISOString(), quando.toISOString());
    assert.equal(new Date(enviado.ultima_alteracao_em).toISOString(), quando.toISOString());
    assert.equal(enviado.local_ultima_alteracao, 'Produtos');
    assert.equal(enviado.especificacao_ultima_alteracao, 'Alterou o preço');
  } finally {
    restaurar();
  }
});

test('ação sem carimbo próprio usa a hora da saída, nunca fica sem data', async () => {
  const { userActivity, chamadas, restaurar } = carregarComPoolFalso();
  try {
    const saida = new Date('2026-07-31T18:00:00Z');
    await userActivity.registrarUltimaSaida(7, {
      saida,
      ultimaAcao: { modulo: 'Produtos' }   // veio sem timestamp
    });

    const enviado = chamadas[0].payload;
    assert.equal(enviado.local_ultima_alteracao, 'Produtos');
    assert.equal(
      new Date(enviado.ultima_alteracao).toISOString(),
      saida.toISOString(),
      'a alteração foi nesta sessão, que termina agora: a saída é o instante honesto'
    );
  } finally {
    restaurar();
  }
});

test('updateUsuarioCampos nunca deixa vazio sobrescrever valor registrado', async () => {
  const { userActivity, chamadas, restaurar } = carregarComPoolFalso();
  try {
    await userActivity.updateUsuarioCampos(7, {
      ultima_alteracao: null,
      local_ultima_alteracao: '',
      especificacao_ultima_alteracao: undefined,
      ultima_saida: new Date('2026-07-31T18:00:00Z')
    });

    const enviado = chamadas[0].payload;
    assert.deepEqual(Object.keys(enviado), ['ultima_saida']);
  } finally {
    restaurar();
  }
});

test('sem nenhum campo aproveitável, nada é enviado', async () => {
  const { userActivity, chamadas, restaurar } = carregarComPoolFalso();
  try {
    const gravou = await userActivity.updateUsuarioCampos(7, { ultima_alteracao: null });
    assert.equal(gravou, false);
    assert.equal(chamadas.length, 0, 'não faz sentido um PUT que só carrega vazios');
  } finally {
    restaurar();
  }
});

test('entrada continua carimbando atividade (não virou vítima do filtro)', async () => {
  const { userActivity, chamadas, restaurar } = carregarComPoolFalso();
  try {
    const entrada = new Date('2026-07-31T12:00:00Z');
    await userActivity.registrarUltimaEntrada(7, entrada);

    const enviado = chamadas[0].payload;
    assert.equal(new Date(enviado.ultima_entrada).toISOString(), entrada.toISOString());
    assert.equal(new Date(enviado.ultima_atividade).toISOString(), entrada.toISOString());
  } finally {
    restaurar();
  }
});
