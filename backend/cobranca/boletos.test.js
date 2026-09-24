/**
 * Registro de boletos por parcela (backend/cobranca/boletos.js) com API e BB
 * de mentira: reserva do nosso número pelo UNIQUE (quem perde a corrida pega
 * o próximo), registro e gravação da linha digitável/Pix, recusa do BB que
 * deixa a linha "erro" e reaproveita o número, parcela já registrada que não
 * duplica, e o que é barrado antes (pedido cancelado, sem parcelas).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const configuracao = require('./configuracaoCobranca');
const boletos = require('./boletos');

const CFG = {
  id: 1, ambiente: 'sandbox', convenio: '3453481', carteira: 17, variacao: 19, especie: 'DM', aceite: false, juros_tipo: 'valor_dia', juros_percentual_mes: 9,
  multa_percentual: 2, multa_dias: 1, protesto_dias: 7, negativacao_dias: null, dias_limite_recebimento: 15, desconto_percentual: 0, desconto_dias: 0,
  indicador_pix: true, proximo_sequencial_sandbox: 1, proximo_sequencial_producao: 394
};
const CLIENTE = { id: 7, tipo_pessoa: 'PJ', razao_social: 'Cliente Bom LTDA', cnpj: '11222333000181', reg_logradouro: 'Rua Diamante', reg_numero: '504', reg_bairro: 'São Joaquim', reg_cidade: 'Contagem', reg_uf: 'Minas Gerais', reg_cep: '32113000' };

function tabelasBase() {
  return {
    configuracao_cobranca: [{ ...CFG }],
    pedidos: [{ id: 55, numero: '2548', situacao: 'Enviado', cliente_id: 7, valor_final: 3000 }],
    pedido_parcelas: [
      { id: 1, pedido_id: 55, numero_parcela: 1, valor: 1000, data_vencimento: '2027-01-18' },
      { id: 2, pedido_id: 55, numero_parcela: 2, valor: 1000, data_vencimento: '2027-02-17' },
      { id: 3, pedido_id: 55, numero_parcela: 3, valor: 1000, data_vencimento: '2027-03-19' }
    ],
    clientes: [{ ...CLIENTE }],
    notas_fiscais: [{ id: 10, pedido_id: 55, serie: 1, numero: 5, status_fiscal: 'autorizada' }],
    boletos: [], boletos_eventos: []
  };
}

/** API genérica de mentira, com o UNIQUE (ambiente, nosso_numero) dos boletos e uma corrida opcional. */
function apiFalsa(tabelas = tabelasBase(), { corridas = 0 } = {}) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  let proximoId = 1000;
  let corridasRestantes = corridas;
  const falha = (msg, status) => { const e = new Error(msg); e.status = status; e.body = { detalhe: msg }; return e; };
  const tabelaDe = caminho => caminho.replace(/^\/api\//, '').split('/');
  return {
    dados,
    async get(caminho, { query = {} } = {}) {
      const [tabela, id] = tabelaDe(caminho);
      const lista = dados[tabela];
      if (!lista) throw falha('não há', 404);
      if (id) return lista.find(l => String(l.id) === String(id)) || null;
      return lista.filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    },
    async post(caminho, corpo) {
      const [tabela] = tabelaDe(caminho);
      const lista = dados[tabela];
      if (!lista) throw falha('não há', 404);
      if (tabela === 'boletos') {
        if (corridasRestantes > 0) { corridasRestantes -= 1; lista.push({ id: proximoId++, ambiente: corpo.ambiente, nosso_numero: corpo.nosso_numero, pedido_id: 999, status: 'registrado', parcela_id: 999 }); }
        if (lista.some(l => l.ambiente === corpo.ambiente && l.nosso_numero === corpo.nosso_numero && l.pedido_id !== corpo.pedido_id)) {
          throw falha('duplicate key value violates unique constraint "boletos_nosso_numero_unico"', 500);
        }
        if (lista.some(l => l.ambiente === corpo.ambiente && l.nosso_numero === corpo.nosso_numero)) throw falha('duplicate key value violates unique constraint "boletos_nosso_numero_unico"', 500);
      }
      const linha = { id: proximoId++, ...corpo };
      lista.push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [tabela, id] = tabelaDe(caminho);
      const linha = (dados[tabela] || []).find(l => String(l.id) === String(id));
      if (!linha) throw falha('não há', 404);
      Object.assign(linha, corpo);
      return linha;
    }
  };
}

/** O BB de mentira: registra tudo, menos valor 999 (recusa) e valor 998 (queda de rede). */
function bbFalso() {
  const chamadas = [];
  return {
    chamadas,
    async chamar({ corpo, caminho, metodo }) {
      chamadas.push({ caminho, metodo, corpo });
      if (corpo.valorOriginal === 999) { const e = new Error('O BB respondeu 422 em POST /boletos: 4874990 — Valor inválido.'); e.status = 422; e.extra = { bb: { erros: [{ codigo: '4874990' }] }, http: 422 }; throw e; }
      if (corpo.valorOriginal === 998) throw Object.assign(new Error('Não foi possível falar com o BB: ECONNRESET'), { status: 502 });
      return {
        numero: corpo.numeroTituloCliente, linhaDigitavel: `00190000090345348100800000393173116950000332700`, codigoBarraNumerico: '00191169500003327000000003453481000000039317',
        qrCode: { url: 'https://qrcodepix.bb.com.br/x', txId: `tx-${corpo.numeroTituloCliente}`, emv: '000201...' }
      };
    }
  };
}

const registrar = (api, bb, extra = {}) => boletos.registrar({
  api, pedidoId: 55, bb, credenciais: { clientId: 'c', clientSecret: 's' }, appKey: 'k', ambiente: 'sandbox', usuarioId: 1, hoje: '2026-09-16', ...extra
});

test('boleto emitido FORA ocupa a parcela: aparece na tela e o "gerar" não leva ao BB (sem cobrar duas vezes)', async () => {
  configuracao.limparCache();
  const calculo = require('./boletoCalculo');
  const livre = calculo.campoLivre({ convenio: '3128557', sequencial: 42 });
  const linha = calculo.linhaDigitavel(calculo.codigoBarras({ vencimento: '2027-02-17', valor: 1000, campoLivre: livre, banco: '341' })).digitos;
  const api = apiFalsa({
    ...tabelasBase(),
    boletos_externos: [{ id: 5, pedido_id: 55, parcela_id: 2, numero_parcela: 2, linha_digitavel: linha, banco: '341', valor: 1000, vencimento: '2027-02-17', ativo: true }]
  });
  const bb = bbFalso();
  const r = await registrar(api, bb);
  assert.equal(bb.chamadas.length, 2, 'só as parcelas 1 e 3 vão ao BB');
  const segunda = r.resultados.find(x => x.numero_parcela === 2);
  assert.deepEqual([segunda.ok, segunda.ja_existia, segunda.externo, segunda.boleto_externo.banco_nome], [true, true, true, 'Itaú']);

  const dados = await boletos.lerPedidoCobranca(api, 55);
  const linhas = boletos.parcelasComBoletos(dados);
  assert.equal(linhas[1].boleto_externo.vencimento, '2027-02-17');
  assert.equal(linhas[1].boleto_externo.linha_impressa.length, 54, 'a linha como sai impressa, com os pontos e espaços');
  assert.equal(linhas[1].tem_boleto_vivo, false, 'tem_boleto_vivo continua só do BB');
});

test('parcela já PAGA (Pix, cartão…) não ganha boleto: "todas" a pula, escolhida responde o motivo (dono, 24/09/2026)', async () => {
  configuracao.limparCache();
  const api = apiFalsa({
    ...tabelasBase(),
    recebimentos: [{ id: 9, pedido_id: 55, parcela_id: 1, numero_parcela: 1, status: 'confirmado', origem: 'manual', forma: 'Pix', data_recebimento: '2026-08-20', valor_recebido: '1000.00' }]
  });
  const bb = bbFalso();
  const todas = await registrar(api, bb);
  assert.deepEqual(todas.resultados.map(x => x.numero_parcela), [2, 3], 'sem escolha, a paga fica de fora sem barulho');
  const escolhida = await registrar(api, bb, { parcelaIds: [1] });
  assert.equal(escolhida.resultados[0].ok, false);
  assert.match(escolhida.resultados[0].erro, /A parcela 1 já tem pagamento registrado \(Pix em 20\/08\/2026\): estorne-o em "Pagamentos"/);

  const linhas = boletos.parcelasComBoletos(await boletos.lerPedidoCobranca(api, 55));
  assert.deepEqual(linhas[0].recebimento, { id: 9, data: '2026-08-20', valor: 1000, forma: 'Pix', origem: 'manual', boleto_id: null }, 'a tela sabe que ela está paga');
  assert.equal(linhas[1].recebimento, null);
  assert.equal(boletos.pagamentoDaParcela([{ status: 'estornado', numero_parcela: 1 }], { id: 1, numero_parcela: 1 }), null, 'estornado não conta');
});

test('registra as três parcelas: nosso número sequencial reservado, BB chamado com o payload, linha/Pix gravados, eventos e sequencial avançado', async () => {
  configuracao.limparCache();
  const api = apiFalsa();
  const bb = bbFalso();
  const r = await registrar(api, bb);
  assert.equal(r.registrados, 3);
  assert.equal(r.erros, 0);
  assert.deepEqual(r.resultados.map(x => [x.numero_parcela, x.ok, x.boleto.nosso_numero, x.boleto.status]), [
    [1, true, '00031285570000000001', 'registrado'], [2, true, '00031285570000000002', 'registrado'], [3, true, '00031285570000000003', 'registrado']
  ]);
  assert.equal(api.dados.boletos.length, 3);
  const b = api.dados.boletos[0];
  assert.equal(b.linha_digitavel, '00190.00009 03453.481008 00000.393173 1 16950000332700');
  assert.equal(b.pix_txid, 'tx-00031285570000000001');
  assert.equal(b.nota_fiscal_id, 10, 'a NF-e viva do pedido fica ligada');
  assert.equal(b.numero_documento, '2548P1');
  assert.equal(b.chave_idempotencia, 'sandbox:00031285570000000001');
  assert.equal(b.requisicao.numeroTituloCliente, '00031285570000000001');
  assert.equal(b.requisicao.campoUtilizacaoBeneficiario, 'NFE 5 SERIE 1');
  assert.equal(api.dados.configuracao_cobranca[0].proximo_sequencial_sandbox, 4);
  assert.deepEqual(api.dados.boletos_eventos.map(e => e.tipo), ['reservado', 'registrado', 'reservado', 'registrado', 'reservado', 'registrado']);
  assert.equal(bb.chamadas.length, 3);
  assert.equal(bb.chamadas[0].metodo, 'POST');
  assert.equal(bb.chamadas[0].caminho, '/boletos');
  assert.ok(!('tem_pix' in b), 'a linha do banco guarda o emv; a resposta traz só tem_pix');
  assert.equal(r.resultados[0].boleto.tem_pix, true);
  assert.deepEqual(r.resumo, { total: 3, registrados: 3, pagos: 0, com_erro: 0, valor_registrado: 3000 });

  // Gerar de novo não duplica: as três já existem.
  const de_novo = await registrar(api, bb);
  assert.equal(de_novo.registrados, 0);
  assert.ok(de_novo.resultados.every(x => x.ok && x.ja_existia));
  assert.equal(api.dados.boletos.length, 3);
  assert.equal(bb.chamadas.length, 3);
});

test('corrida pelo nosso número: outra máquina pegou o 1, o app pula para o 2 e o sequencial vai para 3', async () => {
  configuracao.limparCache();
  const api = apiFalsa(tabelasBase(), { corridas: 1 });
  const r = await registrar(api, bbFalso(), { parcelaIds: [1] });
  assert.equal(r.registrados, 1);
  assert.equal(r.resultados[0].boleto.nosso_numero, '00031285570000000002');
  assert.equal(api.dados.configuracao_cobranca[0].proximo_sequencial_sandbox, 3);
});

test('recusa do BB deixa a linha "erro" com o motivo; a próxima tentativa reaproveita o mesmo nosso número; queda de rede idem', async () => {
  configuracao.limparCache();
  const tabelas = tabelasBase();
  tabelas.pedido_parcelas[1].valor = 999;
  tabelas.pedido_parcelas[2].valor = 998;
  const api = apiFalsa(tabelas);
  const bb = bbFalso();
  const r = await registrar(api, bb);
  assert.equal(r.registrados, 1);
  assert.equal(r.erros, 2);
  assert.match(r.resultados[1].erro, /4874990 — Valor inválido/);
  assert.equal(r.resultados[1].boleto.status, 'erro');
  assert.match(r.resultados[2].erro, /ECONNRESET/);
  assert.equal(api.dados.boletos.filter(b => b.status === 'erro').length, 2);
  assert.equal(api.dados.configuracao_cobranca[0].proximo_sequencial_sandbox, 4);
  assert.deepEqual(api.dados.boletos_eventos.filter(e => e.tipo === 'erro').length, 2);

  // Corrigido o valor, a parcela 2 usa o MESMO nosso número (não gasta outro).
  api.dados.pedido_parcelas[1].valor = 1000;
  const r2 = await registrar(api, bb, { parcelaIds: [2] });
  assert.equal(r2.registrados, 1);
  assert.equal(r2.resultados[0].boleto.nosso_numero, '00031285570000000002');
  assert.equal(r2.resultados[0].boleto.status, 'registrado');
  assert.equal(api.dados.boletos.length, 3, 'nenhuma linha nova');
  assert.equal(api.dados.configuracao_cobranca[0].proximo_sequencial_sandbox, 4, 'sequencial não anda');
});

test('homologação: registra com a conta de teste do BB; "nosso número já incluído" no BB troca para o próximo livre e tenta de novo', async () => {
  configuracao.limparCache();
  const api = apiFalsa();
  const ocupadosNoBB = new Set(['00031285570000000001', '00031285570000000002']);
  const chamadas = [];
  const bb = {
    async chamar({ corpo }) {
      chamadas.push(corpo);
      if (ocupadosNoBB.has(corpo.numeroTituloCliente)) {
        const e = new Error('O BB respondeu 400 em POST /boletos: 4874915 — Nosso Número já incluído anteriormente. — Informar outro Nosso Número.');
        e.status = 422;
        e.extra = { bb: { erros: [{ codigoMensagem: '4874915', textoMensagem: 'Nosso Número já incluído anteriormente.' }] }, http: 400 };
        throw e;
      }
      return { numero: corpo.numeroTituloCliente, linhaDigitavel: '00190000090345348100800000393173116950000332700', codigoBarraNumerico: '00191169500003327000000003453481000000039317' };
    }
  };
  const r = await registrar(api, bb, { parcelaIds: [1] });
  assert.equal(r.registrados, 1, JSON.stringify(r.resultados));
  // Conta de teste (a configuração não tem as colunas de homologação: vale o padrão da documentação).
  assert.equal(chamadas[0].numeroConvenio, 3128557);
  assert.equal(chamadas[0].numeroCarteira, 17);
  assert.equal(chamadas[0].numeroVariacaoCarteira, 35);
  assert.deepEqual(chamadas.map(c => c.numeroTituloCliente), ['00031285570000000001', '00031285570000000002', '00031285570000000003']);
  const b = api.dados.boletos[0];
  assert.equal(b.nosso_numero, '00031285570000000003');
  assert.equal(b.sequencial, 3);
  assert.equal(b.convenio, '3128557');
  assert.equal(b.status, 'registrado');
  assert.equal(b.chave_idempotencia, 'sandbox:00031285570000000003');
  assert.equal(api.dados.configuracao_cobranca[0].proximo_sequencial_sandbox, 4);
  assert.deepEqual(api.dados.boletos_eventos.map(e => e.tipo), ['reservado', 'renumerado', 'renumerado', 'registrado']);

  // Produção usa a conta real.
  configuracao.limparCache();
  const prod = apiFalsa();
  const bbProd = bbFalso();
  await registrar(prod, bbProd, { parcelaIds: [1], ambiente: 'producao' });
  assert.equal(bbProd.chamadas[0].corpo.numeroConvenio, 3453481);
  assert.equal(bbProd.chamadas[0].corpo.numeroVariacaoCarteira, 19);
  assert.equal(bbProd.chamadas[0].corpo.numeroTituloCliente, '00034534810000000394');

  // Sempre ocupado: desiste depois das tentativas e deixa a parcela em "erro".
  configuracao.limparCache();
  const cheio = apiFalsa();
  const sempreOcupado = { async chamar() { const e = new Error('4874915 — Nosso Número já incluído anteriormente.'); e.extra = { http: 400 }; throw e; } };
  const r3 = await registrar(cheio, sempreOcupado, { parcelaIds: [1] });
  assert.equal(r3.erros, 1);
  assert.equal(cheio.dados.boletos[0].status, 'erro');
  assert.equal(cheio.dados.boletos_eventos.filter(e => e.tipo === 'renumerado').length, boletos.TENTATIVAS_NO_BB - 1);
});

test('o que é barrado: pedido cancelado, sem parcelas, parcela inexistente, cliente incompleto (por parcela), vencimento passado', async () => {
  configuracao.limparCache();
  const cancelado = tabelasBase();
  cancelado.pedidos[0].situacao = 'Cancelado';
  await assert.rejects(() => registrar(apiFalsa(cancelado), bbFalso()), /cancelado não gera boleto/);

  const semParcelas = tabelasBase();
  semParcelas.pedido_parcelas = [];
  await assert.rejects(() => registrar(apiFalsa(semParcelas), bbFalso()), /não tem parcelas/);

  await assert.rejects(() => registrar(apiFalsa(), bbFalso(), { parcelaIds: [99] }), /Nenhuma parcela encontrada/);

  const semCep = tabelasBase();
  semCep.clientes[0].reg_cep = '';
  const r = await registrar(apiFalsa(semCep), bbFalso(), { parcelaIds: [1] });
  assert.equal(r.erros, 1);
  assert.match(r.resultados[0].erro, /CEP de 8 dígitos/);
  assert.deepEqual(r.resultados[0].pendencias, ['Cliente sem CEP de 8 dígitos no endereço de registro.']);

  const vencida = tabelasBase();
  vencida.pedido_parcelas[0].data_vencimento = '2026-09-10';
  const r2 = await registrar(apiFalsa(vencida), bbFalso(), { parcelaIds: [1] });
  assert.match(r2.resultados[0].erro, /vence em 10\/09\/2026, que já passou/);
  assert.equal(r2.resumo.total, 0, 'nada foi reservado');
});

test('parcelasComBoletos e resumo: o boleto que vale por parcela (vivo > reaproveitável), sem os campos pesados', () => {
  const parcelas = [{ id: 1, numero_parcela: 1 }, { id: 2, numero_parcela: 2 }, { id: 3, numero_parcela: 3 }];
  const lista = [
    { id: 10, parcela_id: 1, numero_parcela: 1, status: 'erro', valor: 100, pix_emv: null, requisicao: {} },
    { id: 11, parcela_id: 1, numero_parcela: 1, status: 'registrado', valor: 100, pix_emv: 'x', requisicao: {}, resposta: {} },
    { id: 12, parcela_id: 2, numero_parcela: 2, status: 'erro', valor: 100 },
    { id: 13, parcela_id: null, numero_parcela: 3, status: 'pago', valor: 100 }
  ];
  const r = boletos.parcelasComBoletos({ parcelas, boletos: lista });
  assert.deepEqual(r.map(x => [x.boleto?.id, x.tem_boleto_vivo]), [[11, true], [12, false], [13, true]]);
  assert.ok(!('requisicao' in r[0].boleto) && r[0].boleto.tem_pix === true);
  assert.deepEqual(boletos.resumo(lista), { total: 4, registrados: 2, pagos: 1, com_erro: 2, valor_registrado: 200 });
  assert.equal(boletos.boletoDaParcela(lista, { id: 9, numero_parcela: 9 }), null);
});
