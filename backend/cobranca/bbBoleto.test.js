/**
 * Registro do boleto (backend/cobranca/bbBoleto.js): o payload do POST
 * /boletos do BB montado da parcela, do cliente e da configuração — conferido
 * contra o boleto real (R$ 3.327,00, vencimento 18/01/2027, juros R$ 9,98/dia,
 * multa 2% a partir de 19/01, protesto 7 dias, DM/N, Pix). O pagador vem do
 * mesmo endereço de registro da NF-e; o que falta nele é dito antes de ir
 * ao banco.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const bb = require('./bbBoleto');

const CFG = {
  convenio: '3453481', carteira: 17, variacao: 19, especie: 'DM', aceite: false, juros_tipo: 'valor_dia', juros_percentual_mes: 9,
  multa_percentual: 2, multa_dias: 1, protesto_dias: 7, negativacao_dias: null, dias_limite_recebimento: 15, desconto_percentual: 0, desconto_dias: 0,
  indicador_pix: true, mensagem_boleto: null
};
const CLIENTE = {
  id: 7, tipo_pessoa: 'PJ', razao_social: 'ESTUDIO SOMBRA - ESTUDIO DE DESIGN LTDA', nome_fantasia: 'Estúdio Sombra', cnpj: '57.248.237/0001-03',
  reg_logradouro: 'AVENIDA DO ESTADO DALMO VIEIRA', reg_numero: '4770', reg_complemento: 'S', reg_bairro: 'PIONEIROS', reg_cidade: 'BALNEARIO CAMBORIU',
  reg_uf: 'Santa Catarina', reg_cep: '88339-060', reg_telefone: '(47) 99999-0000', email_nfe: 'fin@sombra.com'
};
const PEDIDO = { id: 55, numero: '40F' };
const PARCELA = { id: 1, numero_parcela: 1, valor: '3327.00', data_vencimento: '2027-01-18' };

test('payload do registro bate com o boleto real: convênio/carteira, datas dd.mm.aaaa, juros valor/dia, multa %, protesto, vencido aceito 15 dias, DM/N, Pix', () => {
  const r = bb.montarRegistro({ cfg: CFG, ambiente: 'producao', sequencial: 393, pedido: PEDIDO, parcela: PARCELA, cliente: CLIENTE, hoje: '2026-09-15', notaNumero: '361 SERIE 1' });
  const p = r.payload;
  assert.equal(p.numeroConvenio, 3453481);
  assert.equal(p.numeroCarteira, 17);
  assert.equal(p.numeroVariacaoCarteira, 19);
  assert.equal(p.codigoModalidade, 1);
  assert.equal(p.dataEmissao, '15.09.2026');
  assert.equal(p.dataVencimento, '18.01.2027');
  assert.equal(p.valorOriginal, 3327);
  assert.equal(p.quantidadeDiasProtesto, 7);
  assert.equal(p.quantidadeDiasNegativacao, 0);
  assert.equal(p.indicadorAceiteTituloVencido, 'S');
  assert.equal(p.numeroDiasLimiteRecebimento, 15);
  assert.equal(p.codigoAceite, 'N');
  assert.equal(p.codigoTipoTitulo, 2);
  assert.equal(p.descricaoTipoTitulo, 'DM');
  assert.equal(p.numeroTituloBeneficiario, '40FP1', 'seu número: só letras e números');
  assert.equal(p.campoUtilizacaoBeneficiario, 'NFE 361 SERIE 1', 'campo livre: só letras, números e espaço ("NF-e 1/7" foi recusado pelo BB)');
  assert.equal(p.numeroTituloCliente, '00034534810000000393');
  assert.deepEqual(p.jurosMora, { tipo: 1, valor: 9.98 });
  assert.deepEqual(p.multa, { tipo: 2, data: '19.01.2027', porcentagem: 2 });
  assert.deepEqual(p.desconto, { tipo: 0 });
  assert.equal(p.indicadorPix, 'S');
  assert.ok(!('mensagemBloquetoOcorrencia' in p), 'sem mensagem configurada o campo não vai');
  assert.deepEqual(p.pagador, {
    tipoInscricao: 2, numeroInscricao: 57248237000103, nome: 'ESTUDIO SOMBRA - ESTUDIO DE DESIGN LTDA',
    endereco: 'AVENIDA DO ESTADO DALMO VIEIRA, 4770 S', cep: 88339060, cidade: 'BALNEARIO CAMBORIU', bairro: 'PIONEIROS', uf: 'SC', telefone: '47999990000'
  });
  assert.equal(r.nossoNumero.formatado, '00034534810000000393-4');
  assert.equal(r.numeroDocumento, '40FP1');
  assert.deepEqual(r.encargos.instrucoes.slice(0, 3), ['JRS: Vl p/Dia Atraso R$9,98 A PARTIR DE 19/01/27', 'MULTA DE 2,00% A PARTIR DE 19/01/2027', 'PROTESTO: A partir de 25/01/2027']);
  assert.equal(r.pagador.email, 'fin@sombra.com');
});

test('variações: pessoa física (CPF), sem Pix, juros mensal, sem protesto, sem prazo depois de vencido, mensagem, espécie OU', () => {
  const cfg = { ...CFG, indicador_pix: false, juros_tipo: 'percentual_mes', juros_percentual_mes: 1, protesto_dias: null, dias_limite_recebimento: 0, mensagem_boleto: 'Pedido de outubro', especie: 'OU', aceite: true };
  const cliente = { tipo_pessoa: 'PF', nome: 'Maria Silva', cpf: '123.456.789-09', reg_logradouro: 'Rua A', reg_numero: '1', reg_bairro: 'B', reg_cidade: 'C', reg_uf: 'MG', reg_cep: '30000000' };
  const r = bb.montarRegistro({ cfg, ambiente: 'sandbox', sequencial: 1, pedido: { id: 9, numero: '2600' }, parcela: { id: 2, numero_parcela: 2, valor: 100, data_vencimento: '2026-12-10' }, cliente, hoje: '2026-09-16' });
  const p = r.payload;
  assert.equal(p.indicadorPix, 'N');
  assert.deepEqual(p.jurosMora, { tipo: 2, porcentagem: 1 });
  assert.equal(p.quantidadeDiasProtesto, 0);
  assert.equal(p.indicadorAceiteTituloVencido, 'N');
  assert.equal(p.numeroDiasLimiteRecebimento, 0);
  assert.equal(p.codigoAceite, 'A');
  assert.equal(p.codigoTipoTitulo, 99);
  assert.equal(p.campoUtilizacaoBeneficiario, 'PEDIDO 2600');
  assert.equal(p.numeroTituloBeneficiario, '2600P2');
  assert.equal(p.mensagemBloquetoOcorrencia, 'PEDIDO DE OUTUBRO');
  // Homologação: documento de teste do BB (o CPF/CNPJ real é recusado lá); nome e endereço do cliente.
  assert.deepEqual(p.pagador, { tipoInscricao: 2, numeroInscricao: 86761393000171, nome: 'MARIA SILVA', endereco: 'RUA A, 1', cep: 30000000, cidade: 'C', bairro: 'B', uf: 'MG' });
  assert.equal(r.pagador.documento, '12345678909', 'o registro guarda o documento real do cliente');
  const outroTeste = bb.montarRegistro({ cfg, ambiente: 'sandbox', sequencial: 1, pedido: { id: 9, numero: '2600' }, parcela: { id: 2, numero_parcela: 2, valor: 100, data_vencimento: '2026-12-10' }, cliente, hoje: '2026-09-16', pagadorTeste: '74.910.037/0001-93' });
  assert.equal(outroTeste.payload.pagador.numeroInscricao, 74910037000193, 'BB_PAGADOR_TESTE troca o documento de teste');
  // Produção: o documento real, PF com tipo 1.
  const prod = bb.montarRegistro({ cfg, ambiente: 'producao', sequencial: 1, pedido: { id: 9, numero: '2600' }, parcela: { id: 2, numero_parcela: 2, valor: 100, data_vencimento: '2026-12-10' }, cliente, hoje: '2026-09-16' });
  assert.equal(prod.payload.pagador.tipoInscricao, 1);
  assert.equal(prod.payload.pagador.numeroInscricao, 12345678909);
});

test('textos do jeito que o BB aceita: maiúsculas, sem acento, sem caracteres fora da lista; campo livre só letras, números e espaço', () => {
  assert.equal(bb.textoBB('Rua São João, 12 – Sala 3/4', 60), 'RUA SAO JOAO, 12 SALA 3/4');
  assert.equal(bb.textoBB('Ação & Cia. Ltda.', 60), 'ACAO & CIA. LTDA.');
  assert.equal(bb.textoBB('Ç'.repeat(5), 3), 'CCC');
  assert.equal(bb.alfanumerico('NF-e 1/7', 30), 'NF E 1 7');
  assert.equal(bb.alfanumerico('  pedido  PED120 ', 30), 'PEDIDO PED120');
  const pagador = bb.pagadorDoCliente({ tipo_pessoa: 'PJ', razao_social: 'Básica Home Comércio de Móveis LTDA', cnpj: '04.195.262/0001-00', reg_logradouro: 'Av. Tancredo Neves', reg_numero: '1.632', reg_complemento: 'Sala 1º', reg_bairro: 'Caminho das Árvores', reg_cidade: 'Salvador', reg_uf: 'Bahia', reg_cep: '41820-020' });
  assert.equal(pagador.nome, 'BASICA HOME COMERCIO DE MOVEIS LTDA');
  assert.equal(pagador.endereco, 'AV. TANCREDO NEVES, 1.632 SALA 1');
  assert.equal(pagador.bairro, 'CAMINHO DAS ARVORES');
  assert.equal(pagador.cidade, 'SALVADOR');
  assert.equal(pagador.uf, 'BA');
});

test('o que é barrado antes do BB: parcela sem valor, sem vencimento, vencida, cliente incompleto', () => {
  const base = { cfg: CFG, ambiente: 'sandbox', sequencial: 1, pedido: PEDIDO, cliente: CLIENTE, hoje: '2026-09-16' };
  assert.throws(() => bb.montarRegistro({ ...base, parcela: { numero_parcela: 1, valor: 0, data_vencimento: '2026-10-10' } }), /Parcela 1 sem valor/);
  assert.throws(() => bb.montarRegistro({ ...base, parcela: { numero_parcela: 2, valor: 10, data_vencimento: null } }), /Parcela 2 sem data de vencimento/);
  assert.throws(() => bb.montarRegistro({ ...base, parcela: { numero_parcela: 3, valor: 10, data_vencimento: '2026-09-15' } }), /vence em 15\/09\/2026, que já passou/);
  assert.throws(() => bb.montarRegistro({ ...base, parcela: PARCELA, cliente: { ...CLIENTE, cnpj: '', reg_cep: '', reg_uf: '' } }),
    e => e.status === 422 && /CNPJ válido/.test(e.message) && /CEP de 8 dígitos/.test(e.message) && e.extra.pendencias.length === 3);
  assert.throws(() => bb.montarRegistro({ ...base, cfg: null, parcela: PARCELA }), /Configuração de cobrança ausente/);
  assert.deepEqual(bb.pendenciasDoPagador(bb.pagadorDoCliente(CLIENTE)), []);
  assert.deepEqual(bb.pendenciasDoPagador(bb.pagadorDoCliente({ tipo_pessoa: 'PF' })), [
    'Cliente sem razão social/nome.', 'Cliente sem CPF válido.', 'Cliente sem logradouro/número no endereço de registro.',
    'Cliente sem bairro no endereço de registro.', 'Cliente sem cidade no endereço de registro.', 'Cliente sem UF no endereço de registro.', 'Cliente sem CEP de 8 dígitos no endereço de registro.'
  ]);
});

test('o retorno do BB vira as colunas do boleto: linha digitável formatada, código de barras, Pix', () => {
  const r = bb.lerRetornoRegistro({
    numero: '00034534810000000393', linhaDigitavel: '00190000090345348100800000393173116950000332700', codigoBarraNumerico: '00191169500003327000000003453481000000039317',
    qrCode: { url: 'https://qrcodepix.bb.com.br/pix/v2/x', txId: 'tx123', emv: '00020101021226...' }
  });
  assert.deepEqual(r, {
    numero_bb: '00034534810000000393', linha_digitavel: '00190.00009 03453.481008 00000.393173 1 16950000332700', codigo_barras: '00191169500003327000000003453481000000039317',
    pix_txid: 'tx123', pix_emv: '00020101021226...', pix_url: 'https://qrcodepix.bb.com.br/pix/v2/x'
  });
  assert.deepEqual(bb.lerRetornoRegistro(null), { numero_bb: null, linha_digitavel: null, codigo_barras: null, pix_txid: null, pix_emv: null, pix_url: null });
  assert.equal(bb.formatarLinha('123'), '123', 'fora do padrão fica como veio');
});
