/**
 * prontidao.avaliar: o que falta para faturar um pedido. Um pedido completo
 * fica pronto; cada cadastro incompleto aparece com a origem certa; o código
 * IBGE ausente é "automático" (não bloqueia); nota viva bloqueia nova emissão.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { avaliar, STATUS_QUE_BLOQUEIAM } = require('./prontidao');

const CONFIG = {
  cnpj: '44039257000122', razao_social: 'SANTÍSSIMO DECOR LTDA', inscricao_estadual: '0041842150081',
  logradouro: 'Av. Abílio Machado', numero: '1264', bairro: 'Inconfidência', codigo_municipio: '3106200',
  municipio: 'Belo Horizonte', uf: 'MG', cep: '30820272', natureza_operacao: 'Venda',
  cfop_dentro_uf: '5101', cfop_fora_uf: '6101', csosn: '101', unidade_padrao: 'Peça'
};
const CERTIFICADO = { configurado: true, vencido: false, confereComEmitente: true };
const CLIENTE = {
  id: 7, razao_social: 'Cliente Bom LTDA', nome_fantasia: 'Cliente Bom', tipo_pessoa: 'PJ', cnpj: '11.222.333/0001-81',
  inscricao_estadual: '123456789', indicador_ie: 1, reg_logradouro: 'Rua A', reg_numero: '10', reg_bairro: 'Centro',
  reg_cidade: 'Uberlândia', reg_uf: 'Minas Gerais', reg_cep: '38400-000', reg_codigo_municipio: '3170206'
};
const PEDIDO = { id: 55, numero: 'PED-55', situacao: 'Produção', cliente_id: 7, valor_final: '1500,00' };
const ITENS = [
  { id: 1, produto_id: 3, codigo: 'MESA-01', nome: 'Mesa', ncm: '94036000', quantidade: 2, valor_total: 1000 },
  { id: 2, produto_id: 4, codigo: 'CAD-02', nome: 'Cadeira', ncm: '94016100', quantidade: 1, valor_total: 500 }
];
const PARCELAS = [
  { numero_parcela: 1, valor: 750, data_vencimento: '2026-10-10' },
  { numero_parcela: 2, valor: '750.00', data_vencimento: '2026-11-10T00:00:00.000Z' }
];
const PRODUTOS = [
  { id: 3, codigo: 'MESA-01', ncm: '94036000', origem_mercadoria: 0, unidade_comercial: null, cfop_dentro_uf: null, csosn: null },
  { id: 4, codigo: 'CAD-02', ncm: '94016100', origem_mercadoria: 0, unidade_comercial: 'UN', cfop_fora_uf: '6102', csosn: '102', cest: '1234567' }
];

const completo = (extra = {}) => ({
  pedido: PEDIDO, itens: ITENS, parcelas: PARCELAS, cliente: CLIENTE, produtos: PRODUTOS,
  configuracao: CONFIG, certificado: CERTIFICADO, notas: [], ...extra
});

test('pedido completo está pronto e o resumo traz UF, CFOP e valores resolvidos', () => {
  const r = avaliar(completo());
  assert.equal(r.pronto, true, JSON.stringify(r.pendencias));
  assert.deepEqual(r.pendencias, []);
  assert.equal(r.resumo.ufEmitente, 'MG');
  assert.equal(r.resumo.ufDestino, 'MG');
  assert.equal(r.resumo.dentroDoEstado, true);
  assert.equal(r.resumo.valorFinal, 1500);
  assert.equal(r.resumo.somaParcelas, 1500);
  assert.equal(r.resumo.parcelas, 2);
  assert.equal(r.resumo.cliente, 'Cliente Bom LTDA');
  // Peça sem CFOP/CSOSN próprios herda da configuração; unidade também.
  assert.deepEqual(r.resumo.itens.map(i => [i.codigo, i.cfop, i.csosn, i.unidade]), [
    ['MESA-01', '5101', '101', 'Peça'],
    ['CAD-02', '5101', '102', 'UN']
  ]);
});

test('o resumo traz o que a tela de embarque preenche: documento e cidade do cliente, frete do pedido (ou o padrão) e tPag sugerido', () => {
  const r = avaliar(completo({ pedido: { ...PEDIDO, forma_pagamento: 'Boleto', transportadora: 'Transp XYZ', volumes_quantidade: 2, volumes_especie: 'Caixa' }, configuracao: { ...CONFIG, modalidade_frete_padrao: 4 } }));
  assert.equal(r.resumo.pedidoId, 55);
  assert.equal(r.resumo.documentoCliente, '11222333000181');
  assert.equal(r.resumo.cidadeCliente, 'Uberlândia');
  assert.equal(r.resumo.formaPagamento, 'Boleto');
  assert.equal(r.resumo.tPagSugerido, '15');
  assert.deepEqual(r.resumo.frete, { modalidade: 4, transportadora: 'Transp XYZ', volumes_quantidade: 2, volumes_especie: 'Caixa', peso_bruto: null, peso_liquido: null });
  const proprio = avaliar(completo({ pedido: { ...PEDIDO, modalidade_frete: 1 } }));
  assert.equal(proprio.resumo.frete.modalidade, 1, 'o que o pedido já tem vence o padrão');
  assert.equal(proprio.resumo.tPagSugerido, '99', 'sem forma de pagamento: outros');
  assert.equal(avaliar(completo({ cliente: { ...CLIENTE, tipo_pessoa: 'PF', cpf: '12345678909', indicador_ie: 9, inscricao_estadual: '' } })).resumo.documentoCliente, '12345678909');
});

test('fora do estado usa o CFOP de fora (da peça ou da configuração)', () => {
  const r = avaliar(completo({ cliente: { ...CLIENTE, reg_uf: 'SP', reg_codigo_municipio: '3550308' } }));
  assert.equal(r.pronto, true);
  assert.equal(r.resumo.dentroDoEstado, false);
  assert.deepEqual(r.resumo.itens.map(i => i.cfop), ['6101', '6102']);
});

test('código IBGE ausente é pendência automática: aparece, mas não bloqueia', () => {
  const r = avaliar(completo({ cliente: { ...CLIENTE, reg_codigo_municipio: null } }));
  assert.equal(r.pronto, true);
  assert.equal(r.bloqueiam, 0);
  assert.equal(r.automaticas, 1);
  assert.equal(r.pendencias[0].chave, 'reg_codigo_municipio');
  assert.equal(r.pendencias[0].automatico, true);
  assert.match(r.pendencias[0].mensagem, /Uberlândia\/MG/);
});

test('cada origem aponta o que falta: emitente, certificado, cliente, peça e pedido', () => {
  const r = avaliar(completo({
    configuracao: { ...CONFIG, inscricao_estadual: '', cfop_fora_uf: '' },
    certificado: { configurado: true, vencido: true, confereComEmitente: false },
    cliente: { ...CLIENTE, cnpj: '123', inscricao_estadual: '', reg_cep: '384', reg_bairro: '' },
    produtos: [{ ...PRODUTOS[0], origem_mercadoria: 12, cest: '12' }, PRODUTOS[1]],
    itens: [{ ...ITENS[0], ncm: '9403' }, { ...ITENS[1], quantidade: 0 }],
    parcelas: [{ numero_parcela: 1, valor: 100, data_vencimento: '' }]
  }));
  assert.equal(r.pronto, false);
  const chaves = r.pendencias.map(p => `${p.origem}:${p.chave}`);
  for (const esperada of [
    'emitente:inscricao_estadual', 'emitente:cfop_fora_uf',
    'certificado:vencido', 'certificado:cnpj',
    'cliente:cnpj', 'cliente:inscricao_estadual', 'cliente:reg_bairro', 'cliente:reg_cep',
    'peca:ncm', 'peca:origem', 'peca:cest',
    'pedido:quantidade', 'pedido:parcelas'
  ]) assert.ok(chaves.includes(esperada), `faltou ${esperada} em ${chaves.join(', ')}`);
  assert.ok(r.pendencias.find(p => p.chave === 'ncm').produto_id === 3, 'pendência de peça aponta o produto');
  assert.match(r.pendencias.find(p => p.origem === 'pedido' && /somam/.test(p.mensagem)).mensagem, /100\.00 e o pedido vale 1500\.00/);
});

test('sem configuração, sem certificado e sem cliente: mensagens claras e sem quebrar', () => {
  const r = avaliar({ pedido: PEDIDO, itens: [], parcelas: [], cliente: null, configuracao: null, certificado: null });
  assert.equal(r.pronto, false);
  const porChave = Object.fromEntries(r.pendencias.map(p => [`${p.origem}:${p.chave}`, p.mensagem]));
  assert.match(porChave['emitente:configuracao'], /notas_fiscais_base\.sql/);
  assert.match(porChave['certificado:ausente'], /não configurado/);
  assert.match(porChave['cliente:inexistente'], /sem cliente/);
  assert.match(porChave['pedido:itens'], /não tem itens/);
  assert.match(porChave['pedido:parcelas'], /não tem parcelas/);
  assert.equal(r.resumo.ufEmitente, null);
});

test('pedido inexistente devolve só as pendências gerais e resumo nulo', () => {
  const r = avaliar({ pedido: null, configuracao: CONFIG, certificado: CERTIFICADO });
  assert.equal(r.pronto, false);
  assert.ok(r.pendencias.some(p => p.chave === 'inexistente' && p.origem === 'pedido'));
  assert.equal(r.resumo, null);
});

test('pessoa física exige CPF e dispensa CNPJ; contribuinte sem IE e IE sem indicador são apontados', () => {
  const pf = avaliar(completo({ cliente: { ...CLIENTE, tipo_pessoa: 'PF', cnpj: null, cpf: '123.456.789-09', inscricao_estadual: '', indicador_ie: 9 } }));
  assert.equal(pf.pronto, true, JSON.stringify(pf.pendencias));
  const semCpf = avaliar(completo({ cliente: { ...CLIENTE, tipo_pessoa: 'PF', cpf: '123', indicador_ie: 9, inscricao_estadual: '' } }));
  assert.ok(semCpf.pendencias.some(p => p.chave === 'cpf'));
  const ieSemIndicador = avaliar(completo({ cliente: { ...CLIENTE, indicador_ie: 9 } }));
  assert.ok(ieSemIndicador.pendencias.some(p => p.chave === 'indicador_ie'));
  const isento = avaliar(completo({ cliente: { ...CLIENTE, indicador_ie: 2, inscricao_estadual: '' } }));
  assert.equal(isento.pronto, true);
});

test('nota viva (enviando/autorizada) bloqueia; cancelada ou rejeitada não', () => {
  for (const status of STATUS_QUE_BLOQUEIAM) {
    const r = avaliar(completo({ notas: [{ id: 9, numero: 362, status_fiscal: status }] }));
    assert.equal(r.pronto, false, status);
    const p = r.pendencias.find(x => x.chave === 'nota_existente');
    assert.match(p.mensagem, /nº 362/);
    assert.equal(p.nota, 9);
  }
  for (const status of ['cancelada', 'rejeitada', 'rascunho', 'erro']) {
    assert.equal(avaliar(completo({ notas: [{ id: 9, status_fiscal: status }] })).pronto, true, status);
  }
});

test('pedido cancelado, sem valor ou com parcelas fora da tolerância não fatura', () => {
  assert.ok(avaliar(completo({ pedido: { ...PEDIDO, situacao: 'Cancelado' } })).pendencias.some(p => p.chave === 'situacao'));
  assert.ok(avaliar(completo({ pedido: { ...PEDIDO, valor_final: null } })).pendencias.some(p => p.chave === 'valor_final'));
  const tolerado = avaliar(completo({ parcelas: [{ numero_parcela: 1, valor: 1500.01, data_vencimento: '2026-10-10' }] }));
  assert.equal(tolerado.pronto, true, 'um centavo de diferença passa');
  const fora = avaliar(completo({ parcelas: [{ numero_parcela: 1, valor: 1400, data_vencimento: '2026-10-10' }] }));
  assert.equal(fora.pronto, false);
});
