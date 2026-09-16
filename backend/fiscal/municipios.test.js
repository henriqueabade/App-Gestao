/**
 * municipios: sigla do estado a partir do nome, busca do código IBGE por nome
 * (sem acento/caixa), cache por 24 h e erros claros quando o IBGE não responde.
 * A rede é injetada — nada aqui sai para a internet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const municipios = require('./municipios');

const MG = [
  { id: 3106200, nome: 'Belo Horizonte' },
  { id: 3170206, nome: 'Uberlândia' },
  { id: 3170107, nome: 'Uberaba' },
  { id: 3143302, nome: 'Montes Claros' },
  { id: 3118601, nome: 'Contagem' },
  { id: 12, nome: 'Inválido' }
];

test('siglaDaUf aceita sigla ou nome, sem acento e sem caixa', () => {
  assert.equal(municipios.siglaDaUf('MG'), 'MG');
  assert.equal(municipios.siglaDaUf('mg'), 'MG');
  assert.equal(municipios.siglaDaUf('Minas Gerais'), 'MG');
  assert.equal(municipios.siglaDaUf('minas gerais'), 'MG');
  assert.equal(municipios.siglaDaUf('SAO PAULO'), 'SP');
  assert.equal(municipios.siglaDaUf('Espírito Santo'), 'ES');
  assert.equal(municipios.siglaDaUf('Marte'), null);
  assert.equal(municipios.siglaDaUf(''), null);
  assert.equal(municipios.siglaDaUf(null), null);
  assert.equal(municipios.CODIGO_UF.MG, '31');
});

test('buscar acha o exato sem acento/caixa e lista parecidos quando não acha', async () => {
  municipios.limparCache();
  const rede = async () => MG;
  const exato = await municipios.buscar('Minas Gerais', 'uberlandia', { buscarNaRede: rede });
  assert.deepEqual(exato.exato, { codigo: '3170206', nome: 'Uberlândia' });
  assert.deepEqual(exato.candidatos, [exato.exato]);

  const parecidos = await municipios.buscar('MG', 'Uber', { buscarNaRede: rede });
  assert.equal(parecidos.exato, null);
  assert.deepEqual(parecidos.candidatos.map(c => c.nome).sort(), ['Uberaba', 'Uberlândia']);

  const nada = await municipios.buscar('MG', 'Xyz', { buscarNaRede: rede });
  assert.deepEqual(nada, { exato: null, candidatos: [] });
  assert.deepEqual(await municipios.buscar('MG', '', { buscarNaRede: rede }), { exato: null, candidatos: [] });
});

test('lista descarta códigos que não têm 7 dígitos e usa o cache por 24 h por estado', async () => {
  municipios.limparCache();
  let chamadas = 0;
  const rede = async uf => { chamadas++; assert.equal(uf, 'MG'); return MG; };
  const agora = 1_000_000;
  const lista = await municipios.listar('MG', { buscarNaRede: rede, agora });
  assert.equal(lista.length, 5, 'o código 12 cai fora');
  await municipios.listar('mg', { buscarNaRede: rede, agora: agora + municipios.VALIDADE_MS - 1 });
  assert.equal(chamadas, 1, 'dentro da validade não vai à rede');
  await municipios.listar('MG', { buscarNaRede: rede, agora: agora + municipios.VALIDADE_MS + 1 });
  assert.equal(chamadas, 2, 'vencido o cache, busca de novo');
});

test('estado desconhecido, IBGE fora do ar e lista vazia viram erros com status', async () => {
  municipios.limparCache();
  await assert.rejects(municipios.listar('Marte', { buscarNaRede: async () => MG }), e => e.status === 400 && /Estado desconhecido/.test(e.message));
  await assert.rejects(municipios.listar('MG', { buscarNaRede: async () => { throw new Error('ECONNRESET'); } }), e => e.status === 502 && /sem internet/.test(e.message));
  await assert.rejects(municipios.listar('MG', { buscarNaRede: async () => [] }), e => e.status === 502 && /lista vazia/.test(e.message));
  await assert.rejects(municipios.listar('MG', { buscarNaRede: async () => ({ erro: true }) }), e => e.status === 502);
});
