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
  assert.deepEqual(cfgMod.pendencias(LINHA, 'sandbox'), ['Sem client_secret de homologação guardado (banco ou este computador)']);
  assert.deepEqual(cfgMod.pendencias(LINHA, 'producao', { secret: false }), [
    'Sem client_id de produção (Portal Developers BB)', 'Sem app key de produção (Portal Developers BB)', 'Sem client_secret de produção guardado (banco ou este computador)'
  ]);
  // A conta real só pesa em produção; na homologação vale a de teste.
  assert.match(cfgMod.pendencias({ ...LINHA, convenio: '123', agencia: '', client_id_producao: 'x', app_key_producao: 'y' }, 'producao', { secret: true }).join(' | '), /Cobrança sem agência.*Convênio precisa ter 7 dígitos/);
  assert.deepEqual(cfgMod.pendencias({ ...LINHA, convenio: '123', agencia: '' }, 'sandbox', { secret: true }), [], 'a conta real incompleta não trava os testes');
  assert.match(cfgMod.pendencias({ ...LINHA, homologacao_convenio: '99' }, 'sandbox', { secret: true }).join(' | '), /Convênio de teste \(homologação\) precisa ter 7 dígitos/);
  assert.match(cfgMod.pendencias(null)[0], /rode sql\/cobranca_base\.sql/);
});

test('conta por ambiente: produção usa a real; homologação usa a de teste do BB (ou a gravada nas colunas homologacao_*)', () => {
  assert.deepEqual(cfgMod.dadosDaConta(LINHA, 'producao'), { convenio: '3453481', agencia: '1614', conta: '16773', carteira: 17, variacao: 19, teste: false });
  assert.deepEqual(cfgMod.dadosDaConta(LINHA, 'sandbox'), { convenio: '3128557', agencia: '452', conta: '123873', carteira: 17, variacao: 35, teste: true });
  assert.deepEqual(cfgMod.dadosDaConta({ ...LINHA, homologacao_convenio: '1234567', homologacao_agencia: '1', homologacao_conta: '2', homologacao_carteira: 18, homologacao_variacao: 1 }, 'sandbox'),
    { convenio: '1234567', agencia: '1', conta: '2', carteira: 18, variacao: 1, teste: true });
  assert.deepEqual(cfgMod.dadosDaConta({ ...LINHA, homologacao_convenio: '' }, 'sandbox').convenio, '3128557', 'vazio volta ao padrão');
  assert.equal(cfgMod.ambienteEfetivo({ ambiente: 'producao' }, { BB_AMBIENTE: 'homologacao' }), 'sandbox', 'BB_AMBIENTE=homologacao também prende em testes');
  assert.equal(cfgMod.nomeDoAmbiente('sandbox'), 'homologação');
  assert.equal(cfgMod.nomeDoAmbiente('producao'), 'produção');
  const { valores, erros } = cfgMod.validar({ homologacao_convenio: '3128557', homologacao_agencia: '', homologacao_carteira: '' });
  assert.deepEqual(erros, []);
  assert.deepEqual(valores, { homologacao_convenio: '3128557', homologacao_agencia: null, homologacao_carteira: null });
});

test('fases E e F: controle de recebimentos (data) e conciliação automática (sim/não, 15 a 720 minutos)', () => {
  const ok = cfgMod.validar({ recebimentos_desde: '2026-09-01', conciliacao_automatica: 'false', conciliacao_intervalo_min: '30' });
  assert.deepEqual(ok, { valores: { recebimentos_desde: '2026-09-01', conciliacao_automatica: false, conciliacao_intervalo_min: 30 }, erros: [] });
  assert.deepEqual(cfgMod.validar({ recebimentos_desde: '' }).valores, { recebimentos_desde: null }, 'data vazia pode');
  const ruim = cfgMod.validar({ recebimentos_desde: '2026-02-30', conciliacao_automatica: '', conciliacao_intervalo_min: '10' });
  assert.deepEqual(ruim.erros, [
    'recebimentos_desde: data inválida',
    'conciliacao_automatica: não pode ficar vazio',
    'conciliacao_intervalo_min: precisa ser um inteiro entre 15 e 720'
  ]);
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
