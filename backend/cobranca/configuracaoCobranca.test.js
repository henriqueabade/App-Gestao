/**
 * Configuração da cobrança (backend/cobranca/configuracaoCobranca.js): a
 * validação campo a campo, a trava de ambiente por máquina, as credenciais
 * por ambiente, o próximo nosso número e as pendências que a tela lista.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cfgMod = require('./configuracaoCobranca');

const LINHA = {
  id: 1, banco: '001', ambiente: 'sandbox', agencia: '1614', agencia_dv: '4', conta: '16773', conta_dv: '8', convenio: '3453481', carteira: 17, variacao: 19,
  beneficiario_nome: 'SANTISSIMO DECOR LTDA', beneficiario_cnpj: '44039257000122',
  client_id_sandbox: 'id-sb', app_key_sandbox: 'key-sb', client_id_producao: null, app_key_producao: null,
  proximo_sequencial_sandbox: 1, proximo_sequencial_producao: 394,
  especie: 'DM', aceite: false, juros_tipo: 'valor_dia', juros_percentual_mes: 9, multa_percentual: 2, multa_dias: 1, protesto_dias: 7, negativacao_dias: null,
  dias_limite_recebimento: 15, desconto_percentual: 0, desconto_dias: 0, indicador_pix: true, gerar_ao_emitir_nfe: true, mensagem_boleto: null
};

function apiFalsa(linha = LINHA) {
  const puts = [];
  return {
    puts,
    async get(caminho, { query } = {}) { return caminho === '/api/configuracao_cobranca' && linha && query?.id === 1 ? [linha] : []; },
    async put(caminho, corpo) { puts.push({ caminho, corpo }); Object.assign(linha, corpo); return linha; }
  };
}

test('validar: dígitos limpos, opções, inteiros, decimais com vírgula, booleanos; vazio só onde pode', () => {
  const { valores, erros } = cfgMod.validar({
    agencia: '1614-4', conta: ' 16773 ', convenio: '3.453.481', carteira: '17', variacao: '19', beneficiario_cnpj: '44.039.257/0001-22',
    beneficiario_uf: 'mg', juros_percentual_mes: '9,5', multa_percentual: '2', protesto_dias: '', negativacao_dias: '', aceite: 'não', indicador_pix: 'sim',
    ambiente: 'producao', especie: 'DM', juros_tipo: 'valor_dia', mensagem_boleto: '', beneficiario_cep: ''
  });
  assert.deepEqual(erros, []);
  assert.equal(valores.agencia, '16144', 'só dígitos: o DV vai no campo próprio');
  assert.equal(valores.conta, '16773');
  assert.equal(valores.convenio, '3453481');
  assert.equal(valores.carteira, 17);
  assert.equal(valores.beneficiario_cnpj, '44039257000122');
  assert.equal(valores.beneficiario_uf, 'MG');
  assert.equal(valores.juros_percentual_mes, 9.5);
  assert.equal(valores.protesto_dias, null, 'protesto vazio = não protesta');
  assert.equal(valores.negativacao_dias, null);
  assert.equal(valores.aceite, false);
  assert.equal(valores.indicador_pix, true);
  assert.equal(valores.mensagem_boleto, null);
  assert.equal(valores.beneficiario_cep, null);

  const ruim = cfgMod.validar({ convenio: '12345', ambiente: 'teste', carteira: '0', juros_percentual_mes: 'x', especie: 'ZZ', gerar_ao_emitir_nfe: 'talvez', agencia: '', desconhecido: 1 });
  assert.equal(ruim.erros.length, 8, ruim.erros.join(' | '));
  assert.match(ruim.erros.join(' | '), /convenio: precisa ter 7 dígitos/);
  assert.match(ruim.erros.join(' | '), /agencia: não pode ficar vazio/);
  assert.match(ruim.erros.join(' | '), /"desconhecido" não é uma configuração/);
});

test('ambiente: o do banco, rebaixado a sandbox pelo BB_AMBIENTE desta máquina; nunca sobe sozinho', () => {
  assert.equal(cfgMod.ambienteEfetivo({ ambiente: 'producao' }, {}), 'producao');
  assert.equal(cfgMod.ambienteEfetivo({ ambiente: 'producao' }, { BB_AMBIENTE: 'sandbox' }), 'sandbox');
  assert.equal(cfgMod.ambienteEfetivo({ ambiente: 'sandbox' }, { BB_AMBIENTE: 'producao' }), 'sandbox', 'o .env não liga produção');
  assert.equal(cfgMod.ambienteEfetivo(null, {}), 'sandbox');
});

test('credenciais e sequencial por ambiente; pendências dizem o que falta para registrar boletos', () => {
  assert.deepEqual(cfgMod.credenciais(LINHA, 'sandbox'), { ambiente: 'sandbox', clientId: 'id-sb', appKey: 'key-sb' });
  assert.deepEqual(cfgMod.credenciais(LINHA, 'producao'), { ambiente: 'producao', clientId: null, appKey: null });
  assert.equal(cfgMod.proximoSequencial(LINHA, 'sandbox'), 1);
  assert.equal(cfgMod.proximoSequencial(LINHA, 'producao'), 394);
  assert.equal(cfgMod.proximoSequencial({}, 'producao'), 1);

  assert.deepEqual(cfgMod.pendencias(LINHA, 'sandbox', { secret: true }), []);
  assert.deepEqual(cfgMod.pendencias(LINHA, 'sandbox'), ['Sem client_secret de sandbox guardado (banco ou este computador)']);
  assert.deepEqual(cfgMod.pendencias(LINHA, 'producao', { secret: false }), [
    'Sem client_id de produção (Portal Developers BB)', 'Sem app key de produção (Portal Developers BB)', 'Sem client_secret de produção guardado (banco ou este computador)'
  ]);
  assert.match(cfgMod.pendencias({ ...LINHA, convenio: '123', agencia: '' }, 'sandbox', { secret: true }).join(' | '), /Cobrança sem agência.*Convênio precisa ter 7 dígitos/);
  assert.match(cfgMod.pendencias(null)[0], /rode sql\/cobranca_base\.sql/);
});

test('carregar lê a linha 1 (com cache curto) e gravar faz PUT com auditoria; sem a linha, avisa do SQL', async () => {
  cfgMod.limparCache();
  const api = apiFalsa({ ...LINHA });
  const lida = await cfgMod.carregar(api);
  assert.equal(lida.convenio, '3453481');
  const gravada = await cfgMod.gravar(api, { multa_percentual: 1.5 }, 7);
  assert.equal(gravada.multa_percentual, 1.5);
  assert.equal(api.puts[0].caminho, '/api/configuracao_cobranca/1');
  assert.equal(api.puts[0].corpo.atualizado_por, 7);
  assert.match(api.puts[0].corpo.atualizado_em, /^\d{4}-\d{2}-\d{2}T/);

  cfgMod.limparCache();
  const semLinha = apiFalsa(null);
  assert.equal(await cfgMod.carregar(semLinha), null);
  await assert.rejects(() => cfgMod.gravar(semLinha, { multa_percentual: 1 }, 1), /sql\/cobranca_base\.sql/);
  cfgMod.limparCache();
});
