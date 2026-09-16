/**
 * Campos fiscais dos cadastros (etapa 2 da NF-e): a peça (produtos.js) e o
 * cliente (clientesController.js) limpam o que vem do modal antes de gravar.
 * Regra dos dois: chave ausente fica ausente (não apaga o que está no banco);
 * vazio vira null (volta ao padrão da configuração fiscal).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');

function carregar() {
  // produtos.js e clientesController.js abrem o banco ao carregar; um pg-mem vazio basta.
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  require.cache[require.resolve('./db')] = { exports: { query: (t, p) => pool.query(t, p), connect: () => pool.connect() } };
  delete require.cache[require.resolve('./produtos')];
  delete require.cache[require.resolve('./clientesController')];
  return {
    camposFiscaisDaPeca: require('./produtos').camposFiscaisDaPeca,
    clientes: require('./clientesController')
  };
}

test('camposFiscaisDaPeca: limpa, limita e não inventa chave que não veio', () => {
  const { camposFiscaisDaPeca } = carregar();
  assert.deepEqual(camposFiscaisDaPeca({}), {});
  assert.deepEqual(camposFiscaisDaPeca({ nome: 'Mesa', preco: 10 }), {});
  assert.deepEqual(camposFiscaisDaPeca({
    origem_mercadoria: '3', unidade_comercial: '  unidade ', cest: '01.234.56', gtin: ' 7891234567890 ',
    cfop_dentro_uf: '5.101', cfop_fora_uf: '6101x', csosn: '101'
  }), {
    origem_mercadoria: 3, unidade_comercial: 'unidad', cest: '0123456', gtin: '7891234567890',
    cfop_dentro_uf: '5101', cfop_fora_uf: '6101', csosn: '101'
  });
  // Vazio -> null (volta ao padrão); origem inválida -> 0 (nacional).
  assert.deepEqual(camposFiscaisDaPeca({ origem_mercadoria: '9', unidade_comercial: '', cest: '', gtin: null, cfop_dentro_uf: '', cfop_fora_uf: undefined, csosn: 'abc' }), {
    origem_mercadoria: 0, unidade_comercial: null, cest: null, gtin: null, cfop_dentro_uf: null, csosn: null
  });
});

test('camposFiscaisDoCliente: tipo de pessoa, CPF só dígitos, indicador de IE válido e códigos IBGE dos endereços', () => {
  const { clientes } = carregar();
  const { camposFiscaisDoCliente } = clientes;
  assert.deepEqual(camposFiscaisDoCliente({}), {});
  assert.deepEqual(camposFiscaisDoCliente({ razao_social: 'X', endereco_registro: { rua: 'A' } }), {});
  assert.deepEqual(camposFiscaisDoCliente({
    tipo_pessoa: 'pf', cpf: '123.456.789-09', indicador_ie: '2', email_nfe: ' fiscal@x.com ', consumidor_final: 'sim',
    endereco_registro: { codigo_municipio: '3106200' }, endereco_entrega: { codigo_municipio: '' }
  }), {
    tipo_pessoa: 'PF', cpf: '12345678909', indicador_ie: 2, email_nfe: 'fiscal@x.com', consumidor_final: true,
    reg_codigo_municipio: '3106200', ent_codigo_municipio: null
  });
  assert.deepEqual(camposFiscaisDoCliente({ tipo_pessoa: 'qualquer', cpf: '', indicador_ie: '7', email_nfe: '', consumidor_final: false, indicador: 1 }), {
    tipo_pessoa: 'PJ', cpf: null, indicador_ie: 9, email_nfe: null, consumidor_final: false
  });
  assert.deepEqual(camposFiscaisDoCliente({ indicador_ie: '' }), {}, 'indicador vazio não mexe no gravado');
});

test('buildPayload leva os campos fiscais junto com o resto do cliente', () => {
  const { clientes } = carregar();
  const payload = clientes.buildPayload({
    razao_social: 'Cliente', nome_fantasia: 'Cli', cnpj: '11222333000181', tipo_pessoa: 'PJ', indicador_ie: 1, email_nfe: 'nf@cli.com',
    endereco_registro: { rua: 'Rua A', numero: '1', bairro: 'B', cidade: 'Uberlândia', estado: 'Minas Gerais', cep: '38400-000', pais: 'Brasil', codigo_municipio: '3170206' },
    endereco_entrega: { rua: 'Rua A', numero: '1', bairro: 'B', cidade: 'Uberlândia', estado: 'Minas Gerais', cep: '38400-000', pais: 'Brasil', codigo_municipio: '' }
  });
  assert.equal(payload.tipo_pessoa, 'PJ');
  assert.equal(payload.indicador_ie, 1);
  assert.equal(payload.email_nfe, 'nf@cli.com');
  assert.equal(payload.reg_codigo_municipio, '3170206');
  assert.equal(payload.ent_codigo_municipio, null);
  assert.equal(payload.reg_cidade, 'Uberlândia');
  assert.equal(payload.razao_social, 'Cliente');
});

test('mapClienteCompleto devolve os campos fiscais e o código IBGE dentro dos endereços', () => {
  const { clientes } = carregar();
  const cli = clientes.mapClienteCompleto({
    id: 1, razao_social: 'X', tipo_pessoa: 'PF', cpf: '12345678909', indicador_ie: 9, email_nfe: 'a@b.c', consumidor_final: true,
    reg_logradouro: 'Rua', reg_codigo_municipio: '3106200', ent_codigo_municipio: '3170206'
  });
  assert.equal(cli.tipo_pessoa, 'PF');
  assert.equal(cli.cpf, '12345678909');
  assert.equal(cli.indicador_ie, 9);
  assert.equal(cli.email_nfe, 'a@b.c');
  assert.equal(cli.consumidor_final, true);
  assert.equal(cli.endereco_registro.codigo_municipio, '3106200');
  assert.equal(cli.endereco_entrega.codigo_municipio, '3170206');
  assert.equal(clientes.mapClienteCompleto({ id: 2 }).tipo_pessoa, 'PJ', 'linha antiga sem a coluna continua PJ');
});
