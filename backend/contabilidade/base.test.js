/**
 * Peças comuns da Contabilidade (backend/contabilidade/base.js). O que fica
 * preso: "tabela ausente" nos três jeitos em que chega — a API remota (404
 * com o nome), o Postgres (42P01 com o nome) e o banco DEV
 * (localDatabase.safeDatabaseError: 42P01 SEM o nome, "Tabela não disponível
 * no banco DEV") —, a mensagem apontando o SQL certo pela tabela da chamada,
 * o dinheiro digitado e o documento formatado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const b = require('./base');

const erro = (message, extra = {}) => Object.assign(new Error(message), extra);

test('tabela ausente: API remota, Postgres e banco DEV (sem o nome da tabela)', () => {
  const remota = erro("Tabela 'titulos_pagar' não encontrada.", { status: 404 });
  const postgres = erro('relation "competencia_contabil" does not exist', { code: '42P01' });
  const dev = erro('Tabela não disponível no banco DEV. Verifique o schema local.', { code: '42P01', status: 500 });
  assert.equal(b.tabelaAusente(remota), true);
  assert.equal(b.tabelaAusente(postgres), true);
  assert.equal(b.tabelaAusente(dev, 'titulos_pagar'), true, 'no DEV a tabela vem da chamada');
  assert.equal(b.tabelaAusente(dev, 'pedidos'), false, 'tabela de fora do módulo não é "falta o SQL da Contabilidade"');
  assert.equal(b.tabelaAusente(erro('Registro duplicado.', { code: '23505', status: 409 }), 'titulos_pagar'), false);
});

test('ler: sem a tabela, 409 sql_pendente apontando o SQL da etapa certa (também no DEV)', async () => {
  const dev = { get: async () => { throw erro('Tabela não disponível no banco DEV. Verifique o schema local.', { code: '42P01', status: 500 }); } };
  await assert.rejects(() => b.ler(dev, 'titulos_pagar'), e => e.status === 409 && e.extra.sql_pendente && e.extra.sql_arquivo === b.SQL_ARQUIVO_PAGAR);
  await assert.rejects(() => b.ler(dev, 'competencia_contabil'), e => e.status === 409 && e.extra.sql_arquivo === b.SQL_ARQUIVO);
  assert.equal(await b.lerOpcional(dev, 'documentos_recebidos'), null);
  const outro = { get: async () => { throw erro('Não foi possível acessar o banco DEV.', { status: 503 }); } };
  await assert.rejects(() => b.ler(outro, 'titulos_pagar'), e => e.status === 503, 'queda do banco não vira "falta o SQL"');
});

test('valorDe, digitos e documentoFormatado', () => {
  assert.equal(b.valorDe('1.234,56'), 1234.56);
  assert.equal(b.valorDe('R$ 10'), 10);
  assert.equal(b.valorDe(12.345), 12.35);
  assert.equal(b.valorDe(''), null);
  assert.equal(b.valorDe('abc'), null);
  assert.equal(b.documentoFormatado('57248237000103'), '57.248.237/0001-03');
  assert.equal(b.documentoFormatado('123.456.789-09'), '123.456.789-09');
  assert.equal(b.documentoFormatado(''), null);
  assert.equal(b.ultimoDia('2026-02'), '2026-02-28');
});
