/**
 * Endereço pelo CEP (backend/cep.js e backend/cepController.js).
 *
 * O que se defende aqui: o que a tela recebe (estado pela sigla E pelo nome,
 * código IBGE), o cache que evita repetir a consulta, o CEP que não existe
 * (o ViaCEP responde 200 com `erro`) e a falha de rede virando uma frase em
 * português. Nenhum teste sai para a internet: a busca é injetada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const cep = require('./cep');

const RESPOSTA_VIACEP = {
  cep: '31160-370', logradouro: 'Rua Rubi', complemento: 'de 1 a 99', unidade: '',
  bairro: 'São Joaquim', localidade: 'Contagem', uf: 'MG', estado: 'Minas Gerais',
  regiao: 'Sudeste', ibge: '3118601', gia: '', ddd: '31', siafi: '4123'
};

test('o endereço que a tela usa: rua, bairro, cidade, sigla, nome do estado e código IBGE', () => {
  const e = cep.enderecoDaResposta('31160370', RESPOSTA_VIACEP);
  assert.deepEqual(e, {
    cep: '31160-370',
    logradouro: 'Rua Rubi',
    complemento: 'de 1 a 99',
    bairro: 'São Joaquim',
    cidade: 'Contagem',
    uf: 'MG',
    estado: 'Minas Gerais',
    codigo_municipio: '3118601'
  });

  // UF desconhecida e IBGE fora do formato não viram lixo no cadastro.
  const torto = cep.enderecoDaResposta('31160370', { ...RESPOSTA_VIACEP, uf: 'XX', ibge: '31' });
  assert.equal(torto.uf, '');
  assert.equal(torto.estado, '');
  assert.equal(torto.codigo_municipio, '');
});

test('CEP: só 8 números; a consulta é feita uma vez e fica no cache', async () => {
  cep.limparCache();
  assert.equal(cep.normalizarCep(' 31160-370 '), '31160370');
  assert.equal(cep.normalizarCep('3116037'), null);
  assert.equal(cep.cepFormatado('31160370'), '31160-370');
  await assert.rejects(() => cep.buscar('123'), e => e.status === 400 && /8 números/.test(e.message));

  let chamadas = 0;
  const buscarNaRede = async () => { chamadas += 1; return RESPOSTA_VIACEP; };
  const primeira = await cep.buscar('31160-370', { buscarNaRede });
  const segunda = await cep.buscar('31160370', { buscarNaRede });
  assert.equal(primeira.cidade, 'Contagem');
  assert.equal(segunda.estado, 'Minas Gerais');
  assert.equal(chamadas, 1, 'a segunda vem do cache');

  // Passada a validade, consulta de novo.
  await cep.buscar('31160370', { buscarNaRede, agora: Date.now() + cep.VALIDADE_MS + 1 });
  assert.equal(chamadas, 2);
});

test('CEP que não existe é 404; sem internet, 503 com a frase pronta', async () => {
  cep.limparCache();
  for (const resposta of [{ erro: true }, { erro: 'true' }]) {
    await assert.rejects(
      () => cep.buscar('99999999', { buscarNaRede: async () => resposta }),
      e => e.status === 404 && /não encontrado/i.test(e.message)
    );
  }
  await assert.rejects(
    () => cep.buscar('31160370', { buscarNaRede: async () => { throw new Error('fetch failed'); } }),
    e => e.status === 503 && /internet/i.test(e.message)
  );
});

test('rota GET /api/cep/:cep responde o endereço e repassa o erro', async () => {
  cep.limparCache();
  // Guarda de permissão controlada: o que se exercita aqui é a rota.
  const caminhoPermissoes = require.resolve('./permissionsController');
  const original = require.cache[caminhoPermissoes];
  require.cache[caminhoPermissoes] = {
    id: caminhoPermissoes,
    filename: caminhoPermissoes,
    loaded: true,
    exports: { exigirAlgumaPermissao: () => (req, res, next) => next() }
  };
  delete require.cache[require.resolve('./cepController')];

  const app = express();
  app.use('/api/cep', require('./cepController').criarRouter({
    buscarNaRede: async numero => (numero === '31160370' ? RESPOSTA_VIACEP : { erro: true })
  }));
  const servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  const porta = servidor.address().port;
  try {
    const ok = await fetch(`http://127.0.0.1:${porta}/api/cep/31160-370`);
    assert.equal(ok.status, 200);
    const corpo = await ok.json();
    assert.equal(corpo.cidade, 'Contagem');
    assert.equal(corpo.estado, 'Minas Gerais');

    const naoExiste = await fetch(`http://127.0.0.1:${porta}/api/cep/99999999`);
    assert.equal(naoExiste.status, 404);
    assert.match((await naoExiste.json()).error, /não encontrado/i);

    const curto = await fetch(`http://127.0.0.1:${porta}/api/cep/123`);
    assert.equal(curto.status, 400);
  } finally {
    await new Promise(r => servidor.close(r));
    if (original) require.cache[caminhoPermissoes] = original;
    else delete require.cache[caminhoPermissoes];
    delete require.cache[require.resolve('./cepController')];
  }
});

test('a rota pede permissão de clientes ou de prospecções', () => {
  const fonte = require('node:fs').readFileSync(require.resolve('./cepController'), 'utf8');
  assert.match(fonte, /exigirAlgumaPermissao\(\['cli\.view', 'pros\.view'\]\)/);
});
