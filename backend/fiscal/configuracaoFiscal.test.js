/**
 * Configuração fiscal (backend/fiscal/configuracaoFiscal.js): validação dos
 * campos, ambiente efetivo (banco × trava da máquina), numeração por ambiente
 * e a gravação na linha 1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cfg = require('./configuracaoFiscal');

const LINHA = {
  id: 1, cnpj: '44039257000122', razao_social: 'SANTÍSSIMO DECOR LTDA', inscricao_estadual: '0041842150081',
  logradouro: 'Av. Abílio Machado', numero: '1264', bairro: 'Inconfidência', codigo_municipio: '3106200',
  municipio: 'Belo Horizonte', uf: 'MG', cep: '30820272', crt: 1, ambiente: 'homologacao',
  serie_homologacao: 1, proximo_numero_homologacao: 1, serie_producao: 2, proximo_numero_producao: 1,
  natureza_operacao: 'Venda de produtos de fabricação própria', cfop_dentro_uf: '5101', cfop_fora_uf: '6101',
  csosn: '101', pcred_sn: 2.33, pis_cst: '07', cofins_cst: '07', unidade_padrao: 'Peça', modalidade_frete_padrao: 4
};

function apiFalsa(linhas = [LINHA]) {
  const chamadas = [];
  return {
    chamadas,
    get: async (caminho, opcoes) => { chamadas.push(['GET', caminho, opcoes?.query]); return linhas; },
    put: async (caminho, corpo) => { chamadas.push(['PUT', caminho, corpo]); Object.assign(linhas[0], corpo); return linhas[0]; }
  };
}

test('validar: dígitos limpos, UF em maiúsculas, opções e limites; chave desconhecida é erro', () => {
  const { valores, erros } = cfg.validar({
    cnpj: '44.039.257/0001-22', uf: 'mg', cep: '30820-272', crt: '1', ambiente: 'homologacao',
    serie_producao: '2', proximo_numero_producao: '1', pcred_sn: '2,33', telefone: '', complemento: ''
  });
  assert.deepEqual(erros, []);
  assert.equal(valores.cnpj, '44039257000122');
  assert.equal(valores.uf, 'MG');
  assert.equal(valores.cep, '30820272');
  assert.equal(valores.serie_producao, 2);
  assert.equal(valores.pcred_sn, 2.33);
  assert.equal(valores.telefone, null, 'opcional vazio vira null');
  assert.equal(valores.complemento, null);

  const ruim = cfg.validar({ cnpj: '123', ambiente: 'teste', serie_homologacao: '0', razao_social: '', uf: 'MGX', inexistente: 'x' });
  assert.equal(ruim.erros.length, 6);
  assert.match(ruim.erros.join(' | '), /cnpj: precisa ter 14 dígitos/);
  assert.match(ruim.erros.join(' | '), /ambiente: "teste" não é uma opção/);
  assert.match(ruim.erros.join(' | '), /serie_homologacao: precisa ser um inteiro entre 1 e 999/);
  assert.match(ruim.erros.join(' | '), /razao_social: não pode ficar vazio/);
  assert.match(ruim.erros.join(' | '), /"inexistente" não é uma configuração fiscal/);
});

test('ambiente efetivo: o banco manda, mas NFE_AMBIENTE=homologacao prende a máquina; o env nunca liga produção', () => {
  assert.equal(cfg.ambienteEfetivo({ ambiente: 'producao' }, {}), 'producao');
  assert.equal(cfg.ambienteEfetivo({ ambiente: 'producao' }, { NFE_AMBIENTE: 'homologacao' }), 'homologacao');
  assert.equal(cfg.ambienteEfetivo({ ambiente: 'homologacao' }, { NFE_AMBIENTE: 'producao' }), 'homologacao');
  assert.equal(cfg.ambienteEfetivo(null, {}), 'homologacao');
  assert.equal(cfg.ambienteEfetivo({ ambiente: 'PRODUCAO ' }, {}), 'producao');
});

test('numeração por ambiente e pendências do emitente', () => {
  assert.deepEqual(cfg.numeracao(LINHA, 'homologacao'), { serie: 1, proximoNumero: 1 });
  assert.deepEqual(cfg.numeracao({ ...LINHA, proximo_numero_producao: 42 }, 'producao'), { serie: 2, proximoNumero: 42 });
  assert.deepEqual(cfg.pendencias(LINHA), []);
  assert.deepEqual(cfg.pendencias({ ...LINHA, inscricao_estadual: '', cep: null }), ['Emitente sem inscricao estadual', 'Emitente sem cep']);
  assert.match(cfg.pendencias(null)[0], /notas_fiscais_base\.sql/);
});

test('carregar lê a linha 1 com cache curto; gravar faz PUT na linha 1 e derruba o cache', async () => {
  cfg.limparCache();
  const api = apiFalsa();
  const primeira = await cfg.carregar(api);
  assert.equal(primeira.cnpj, '44039257000122');
  await cfg.carregar(api);
  assert.equal(api.chamadas.filter(c => c[0] === 'GET').length, 1, 'segunda leitura veio do cache');
  assert.deepEqual(api.chamadas[0][2], { id: 1 });

  const depois = await cfg.gravar(api, { ambiente: 'producao', serie_producao: 2 }, 7);
  const put = api.chamadas.find(c => c[0] === 'PUT');
  assert.equal(put[1], '/api/configuracao_fiscal/1');
  assert.equal(put[2].ambiente, 'producao');
  assert.equal(put[2].atualizado_por, 7);
  assert.match(put[2].atualizado_em, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(depois.ambiente, 'producao');
  cfg.limparCache();
});

test('gravar sem a linha do emitente avisa para rodar o SQL, em vez de criar às cegas', async () => {
  cfg.limparCache();
  const api = apiFalsa([]);
  await assert.rejects(cfg.gravar(api, { ambiente: 'homologacao' }, 1), e => e.status === 409 && /notas_fiscais_base\.sql/.test(e.message));
  assert.equal(api.chamadas.some(c => c[0] === 'PUT'), false);
  cfg.limparCache();
});
