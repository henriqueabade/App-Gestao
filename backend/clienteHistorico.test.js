/**
 * Histórico do cliente: o que cada cadastro e edição grava na linha do tempo.
 */
const test = require('node:test');
const assert = require('node:assert');

const h = require('./clienteHistorico');

test('diferencasDoCliente: um evento por campo que mudou; ausente não é "apagado"', () => {
  const antes = { nome_fantasia: 'Casa Azul', status_cliente: 'Ativo', consumidor_final: false, reg_cidade: 'BH', indicador_ie: 9, site: 'a.com' };
  const depois = { nome_fantasia: 'Casa Azul', status_cliente: 'Inativo', consumidor_final: true, reg_cidade: ' BH ', indicador_ie: '9', site: '' };
  const eventos = h.diferencasDoCliente(antes, depois);
  assert.deepStrictEqual(eventos.map(e => [e.campo, e.valor_anterior, e.valor_novo]), [
    ['site', 'a.com', null],
    ['status_cliente', 'Ativo', 'Inativo'],
    ['consumidor_final', 'Não', 'Sim']
  ].sort((a, b) => Object.keys(h.CAMPOS_CLIENTE).indexOf(a[0]) - Object.keys(h.CAMPOS_CLIENTE).indexOf(b[0])));
  assert.strictEqual(eventos.find(e => e.campo === 'status_cliente').entidade, 'Status');
  assert.deepStrictEqual(h.diferencasDoCliente({ site: 'a.com' }, { nome_fantasia: undefined }), []);
});

test('rótulos dos endereços: Registro, Cobrança e Entrega', () => {
  assert.strictEqual(h.CAMPOS_CLIENTE.reg_logradouro, 'Registro · rua');
  assert.strictEqual(h.CAMPOS_CLIENTE.ent_codigo_municipio, 'Entrega · código IBGE');
  assert.ok(!('cob_codigo_municipio' in h.CAMPOS_CLIENTE));
});

test('eventosDaCriacao: retrato do cadastro, pendências da planilha e um evento por contato', () => {
  const eventos = h.eventosDaCriacao(
    { nome_fantasia: 'Casa Azul', cnpj: '11.222.333/0001-81', consumidor_final: false, site: '' },
    [{ nome: 'Maria', cargo: 'Compras', email: 'm@x.com' }],
    { observacao: 'Importado da planilha x.csv (linha 3)', pendencias: ['Dono não informado.'] }
  );
  assert.strictEqual(eventos.length, 2);
  assert.strictEqual(eventos[0].tipo, 'criacao');
  assert.strictEqual(eventos[0].valor_novo, 'Casa Azul');
  assert.deepStrictEqual(eventos[0].detalhe.pendencias, ['Dono não informado.']);
  assert.deepStrictEqual(eventos[0].detalhe.campos.map(c => c.rotulo), ['Nome fantasia', 'CNPJ', 'Consumidor final']);
  assert.strictEqual(eventos[1].entidade, 'Maria — Compras');
  assert.ok(!('pendencias' in h.eventosDaCriacao({ nome_fantasia: 'X' })[0].detalhe));
});

test('eventosDosFilhos: contato novo, alterado (campo a campo) e excluído; transportadoras', () => {
  const eventos = h.eventosDosFilhos(
    {
      contatosNovos: [{ nome: 'Novo' }],
      contatosAtualizados: [{ id: 1, nome: 'Carla', email: 'nova@x.com' }],
      contatosExcluidos: [2],
      transportadorasNovas: [{ transportadora: 'Jadlog' }, { transportadora: '  ' }],
      transportadorasExcluidas: [5]
    },
    {
      contatosAntes: [{ id: 1, nome: 'Carla', email: 'velha@x.com' }, { id: 2, nome: 'Beto', cargo: 'Dono' }],
      transportadorasAntes: [{ id: 5, transportadora: 'Correios' }]
    }
  );
  assert.deepStrictEqual(eventos.map(e => `${e.tipo}:${e.acao}`), [
    'contato:criou', 'contato:alterou', 'contato:excluiu', 'transportadora:criou', 'transportadora:excluiu'
  ]);
  const alterou = eventos[1];
  assert.deepStrictEqual([alterou.campo, alterou.valor_anterior, alterou.valor_novo], ['email', 'velha@x.com', 'nova@x.com']);
  assert.strictEqual(eventos[2].entidade, 'Beto — Dono');
  assert.strictEqual(eventos[4].valor_anterior, 'Correios');
});

test('gravar o histórico nunca derruba quem chamou', async () => {
  const api = {
    post: async () => { throw Object.assign(new Error("Tabela 'cliente_historico' não encontrada."), { status: 404 }); },
    put: async () => { throw new Error('coluna criado_por não existe'); }
  };
  assert.deepStrictEqual(await h.registrarNoCliente(api, 1, [{ tipo: 'criacao', acao: 'criou' }], 1), []);
  assert.strictEqual(await h.marcarCriador(api, 1, 1), null);
  assert.deepStrictEqual(await h.registrarNoCliente(api, null, [{ tipo: 'x' }], 1), []);
});
