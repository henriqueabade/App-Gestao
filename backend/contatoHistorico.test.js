/**
 * Histórico do contato (fornecedor/prestador): o que cada cadastro e edição
 * grava na linha do tempo (backend/contatoHistorico.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('./contatoHistorico');

test('diferencasDoContato: um evento por campo que mudou; ausente não é "apagado"; o tipo compara pelo nome', () => {
  const antes = { nome: 'Madeiras Silva', tipo: 'Fornecedor', status: 'Ativo', end_cidade: 'Contagem', email: 'a@b.com' };
  const depois = { nome: 'Madeiras Silva', tipo: 'Prestador de serviço', status: 'Inativo', end_cidade: ' Contagem ', email: '' };
  const eventos = h.diferencasDoContato(antes, depois);
  assert.deepEqual(eventos.map(e => [e.campo, e.valor_anterior, e.valor_novo]), [
    ['tipo', 'Fornecedor', 'Prestador de serviço'],
    ['email', 'a@b.com', null],
    ['status', 'Ativo', 'Inativo']
  ]);
  assert.equal(eventos.find(e => e.campo === 'status').entidade, 'Status');
  assert.deepEqual(h.diferencasDoContato({ site: 'a.com' }, { nome: undefined }), []);
  assert.equal(h.CAMPOS_CONTATO.end_logradouro, 'Endereço · rua');
});

test('eventosDaCriacao: o retrato do cadastro, as pendências da planilha e um evento por pessoa', () => {
  const eventos = h.eventosDaCriacao(
    { nome: 'Madeiras Silva', tipo: 'Fornecedor', cnpj: '11222333000181', site: '' },
    [{ nome: 'Carlos', cargo: 'Vendedor', email: '' }],
    { observacao: 'Importado da planilha x.csv (linha 3)', pendencias: ['Sem endereço.'] }
  );
  assert.equal(eventos.length, 2);
  assert.equal(eventos[0].tipo, 'criacao');
  assert.equal(eventos[0].valor_novo, 'Madeiras Silva');
  assert.equal(eventos[0].observacao, 'Importado da planilha x.csv (linha 3)');
  assert.deepEqual(eventos[0].detalhe.campos, [{ rotulo: 'Nome', valor: 'Madeiras Silva' }, { rotulo: 'Tipo', valor: 'Fornecedor' }, { rotulo: 'CNPJ', valor: '11222333000181' }]);
  assert.deepEqual(eventos[0].detalhe.pendencias, ['Sem endereço.']);
  assert.equal(eventos[1].tipo, 'pessoa');
  assert.equal(eventos[1].entidade, 'Carlos — Vendedor');
  assert.deepEqual(eventos[1].detalhe.campos, [{ rotulo: 'Nome', valor: 'Carlos' }, { rotulo: 'Cargo', valor: 'Vendedor' }]);
});

test('eventosDasPessoas: criou, alterou (só o que mudou) e excluiu (com o retrato de antes)', () => {
  const pessoasAntes = [{ id: 7, nome: 'Carlos', cargo: 'Vendedor', email: 'c@x.com', telefone_fixo: '', telefone_celular: '9999' }];
  const eventos = h.eventosDasPessoas({
    pessoasNovas: [{ nome: 'Ana', cargo: 'Financeiro' }],
    pessoasAtualizadas: [{ id: 7, nome: 'Carlos', cargo: 'Gerente', email: 'c@x.com', telefone_fixo: null, telefone_celular: '9999' }],
    pessoasExcluidas: [7]
  }, { pessoasAntes });
  assert.deepEqual(eventos.map(e => [e.tipo, e.acao, e.entidade]), [
    ['pessoa', 'criou', 'Ana — Financeiro'],
    ['pessoa', 'alterou', 'Carlos — Gerente'],
    ['pessoa', 'excluiu', 'Carlos — Vendedor']
  ]);
  assert.deepEqual([eventos[1].campo, eventos[1].valor_anterior, eventos[1].valor_novo, eventos[1].detalhe.rotulo], ['cargo', 'Vendedor', 'Gerente', 'Cargo']);
  assert.equal(eventos[2].valor_anterior, 'Carlos');
});

test('registrarNoContato: nada a gravar sem eventos ou sem id', async () => {
  assert.deepEqual(await h.registrarNoContato({}, 1, [], 1), []);
  assert.deepEqual(await h.registrarNoContato({}, null, [{ tipo: 'campo' }], 1), []);
});
