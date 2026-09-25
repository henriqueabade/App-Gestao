/**
 * Recebimentos por parcela (backend/cobranca/recebimentos.js) com uma API de
 * mentira que tem o índice único parcial do banco (uma parcela, um
 * recebimento confirmado): o do boleto é idempotente e completa a data de
 * crédito; o manual confere a parcela, recusa a que tem boleto em aberto (e
 * diz qual) e a já recebida; o estorno só vale para o que não veio do banco
 * e, na quitação por fora, libera a parcela para um boleto novo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const boletos = require('./boletos');
const rec = require('./recebimentos');

const HOJE = '2026-09-16';

function apiFalsa(tabelas) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  let proximoId = 700;
  const tabelaDe = caminho => caminho.replace(/^\/api\//, '').split('/');
  const exigir = tabela => {
    if (dados[tabela]) return dados[tabela];
    const e = new Error(`API respondeu 404 — Tabela '${tabela}' não encontrada.`);
    e.status = 404;
    throw e;
  };
  return {
    dados,
    async get(caminho, { query = {} } = {}) {
      const [tabela] = tabelaDe(caminho);
      return exigir(tabela).filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    },
    async post(caminho, corpo) {
      const [tabela] = tabelaDe(caminho);
      const linhas = exigir(tabela);
      if (tabela === 'recebimentos') {
        const repetida = linhas.some(l => l.chave_idempotencia === corpo.chave_idempotencia)
          || (corpo.status === 'confirmado' && linhas.some(l => l.status === 'confirmado' && l.pedido_id === corpo.pedido_id && l.numero_parcela === corpo.numero_parcela));
        if (repetida) {
          const e = new Error('API respondeu 500 — Erro no INSERT: duplicate key value violates unique constraint "recebimentos_parcela_confirmada"');
          e.status = 500;
          throw e;
        }
      }
      const linha = { id: proximoId++, ...corpo };
      linhas.push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [tabela, id] = tabelaDe(caminho);
      const linha = exigir(tabela).find(l => String(l.id) === String(id));
      Object.assign(linha, corpo);
      return linha;
    }
  };
}

const BOLETO = {
  id: 41, pedido_id: 55, parcela_id: 1, numero_parcela: 1, nota_fiscal_id: 10, ambiente: 'sandbox', nosso_numero: '00031285570000000001',
  valor: '1000.00', valor_abatimento: '50.00', status: 'pago', data_pagamento: '2026-09-20', valor_pago: '980.00', canal_pagamento: 'Pix', data_vencimento: '2026-09-18'
};

function tabelas(extra = {}) {
  return {
    pedidos: [{ id: 55, numero: 'PED120', situacao: 'Enviado', cliente_id: 7 }],
    pedido_parcelas: [
      { id: 1, pedido_id: 55, numero_parcela: 1, valor: '1000.00', data_vencimento: '2026-09-18' },
      { id: 2, pedido_id: 55, numero_parcela: 2, valor: '1000.00', data_vencimento: '2026-10-18' },
      { id: 3, pedido_id: 55, numero_parcela: 3, valor: '1000.00', data_vencimento: '2026-11-18' }
    ],
    clientes: [], notas_fiscais: [{ id: 10, pedido_id: 55, serie: 1, numero: 7, status_fiscal: 'autorizada' }], configuracao_cobranca: [],
    boletos: [], boletos_eventos: [], recebimentos: [],
    ...extra
  };
}

test('contas puras: competência, valores do boleto, validação do manual, duplicidade e tabela ausente', () => {
  assert.equal(rec.competenciaDe('2026-09-30T00:00:00.000Z'), '2026-09');
  assert.equal(rec.dia(new Date('2026-09-16T03:00:00Z')), '2026-09-16');
  assert.deepEqual(rec.valoresDoBoleto(BOLETO), { valor_parcela: 1000, valor_abatimento: 50, valor_recebido: 980, valor_encargos: 30 });
  assert.deepEqual(rec.valoresDoBoleto(BOLETO, { valor: 950 }), { valor_parcela: 1000, valor_abatimento: 50, valor_recebido: 950, valor_encargos: 0 });
  assert.deepEqual(rec.valoresDoBoleto({ ...BOLETO, valor_pago: null }), { valor_parcela: 1000, valor_abatimento: 50, valor_recebido: 950, valor_encargos: 0 }, 'sem valor pago: o devido');

  const ok = { pedido_id: '55', numero_parcela: '2', data_recebimento: '2026-09-15', valor_recebido: '1000', forma: 'Pix', observacao: '  pago  na conta ' };
  assert.deepEqual(rec.validarManual(ok, HOJE), { pedidoId: 55, numeroParcela: 2, data: '2026-09-15', valor: 1000, forma: 'Pix', observacao: 'pago na conta' });
  assert.throws(() => rec.validarManual({ ...ok, pedido_id: '' }, HOJE), /Escolha o pedido/);
  assert.throws(() => rec.validarManual({ ...ok, numero_parcela: 0 }, HOJE), /Escolha a parcela/);
  assert.throws(() => rec.validarManual({ ...ok, data_recebimento: '2026-09-17' }, HOJE), /não pode ser futura/);
  assert.throws(() => rec.validarManual({ ...ok, data_recebimento: '2026-02-30' }, HOJE), /Informe a data/);
  assert.throws(() => rec.validarManual({ ...ok, valor_recebido: '0' }, HOJE), /Informe o valor/);
  assert.throws(() => rec.validarManual({ ...ok, forma: 'Boleto' }, HOJE), /como o valor foi recebido/);
  assert.ok(rec.FORMAS.includes('Cartão de crédito'));

  assert.equal(rec.ehDuplicado(new Error('duplicate key value violates unique constraint "recebimentos_parcela_confirmada"')), true);
  assert.equal(rec.ehDuplicado(new Error('outra coisa')), false);
  assert.equal(rec.tabelaAusente(Object.assign(new Error("API respondeu 404 — Tabela 'recebimentos' não encontrada."), { status: 404 })), true);
  assert.equal(rec.tabelaAusente(Object.assign(new Error('relation "public.recebimentos" does not exist'), { code: '42P01' })), true);
  assert.equal(rec.tabelaAusente(Object.assign(new Error("Tabela 'boletos' não encontrada."), { status: 404 })), false);
});

test('do boleto: lança uma vez, completa a data de crédito depois; sem a tabela avisa o SQL', async () => {
  const api = apiFalsa(tabelas({ boletos: [BOLETO] }));
  const r = await rec.doBoleto({ api, boleto: BOLETO, dados: { data: '2026-09-20', canal: 'Pix' }, usuarioId: 3, hoje: HOJE });
  assert.equal(r.ja_existia, false);
  const linha = api.dados.recebimentos[0];
  assert.deepEqual([linha.origem, linha.forma, linha.canal, linha.competencia, linha.chave_idempotencia, linha.nota_fiscal_id, linha.data_credito, linha.criado_por],
    ['boleto', 'Boleto', 'Pix', '2026-09', 'boleto:41:1', 10, null, 3]);
  assert.match(api.dados.boletos_eventos[0].mensagem, /Recebimento de R\$ 980,00 em 20\/09\/2026 lançado no Financeiro \(competência 09\/2026\)/);

  const de_novo = await rec.doBoleto({ api, boleto: BOLETO, dados: { dataCredito: '2026-09-21' }, hoje: HOJE });
  assert.equal(de_novo.ja_existia, true);
  assert.equal(de_novo.atualizado, true);
  assert.equal(api.dados.recebimentos.length, 1);
  assert.equal(api.dados.recebimentos[0].data_credito, '2026-09-21');

  // Corrida: outra máquina gravou entre a leitura e a gravação → devolve "já existia".
  const corrida = apiFalsa(tabelas());
  const lerOriginal = corrida.get;
  corrida.get = async (c, o) => (c === '/api/recebimentos' ? [] : lerOriginal(c, o));
  corrida.dados.recebimentos.push({ id: 1, pedido_id: 55, numero_parcela: 1, status: 'confirmado', chave_idempotencia: 'x' });
  assert.deepEqual(await rec.doBoleto({ api: corrida, boleto: BOLETO, hoje: HOJE }), { recebimento: null, ja_existia: true });

  const semTabela = apiFalsa(tabelas({ recebimentos: undefined }));
  delete semTabela.dados.recebimentos;
  await assert.rejects(() => rec.doBoleto({ api: semTabela, boleto: BOLETO, hoje: HOJE }), err => err.status === 409 && /sql\/cobranca_recebimentos\.sql/.test(err.message));
  assert.equal(await rec.tabelaPronta(semTabela), false);
  assert.equal(await rec.tabelaPronta(api), true);
});

test('manual: grava a parcela; recusa boleto em aberto (dizendo qual), boleto pago, parcela já recebida, pedido cancelado', async () => {
  const aberto = { ...BOLETO, id: 42, parcela_id: 2, numero_parcela: 2, status: 'registrado', nosso_numero: '00031285570000000002', data_vencimento: '2026-10-18' };
  const api = apiFalsa(tabelas({ boletos: [BOLETO, aberto] }));
  const entrada = { pedido_id: 55, numero_parcela: 3, data_recebimento: '2026-09-15', valor_recebido: 990, forma: 'Transferência', observacao: 'desconto combinado' };
  const r = await rec.registrarManual({ api, entrada, usuarioId: 3, hoje: HOJE });
  assert.deepEqual([r.origem, r.forma, r.boleto_id, r.parcela_id, r.numero_parcela, r.valor_parcela, r.valor_recebido, r.valor_encargos, r.competencia, r.nota_fiscal_id],
    ['manual', 'Transferência', null, 3, 3, 1000, 990, -10, '2026-09', 10]);
  assert.match(r.chave_idempotencia, /^manual:55:3:\d+$/);

  await assert.rejects(() => rec.registrarManual({ api, entrada, hoje: HOJE }), /A parcela 3 já tem recebimento de R\$ 990,00 em 15\/09\/2026/);
  await assert.rejects(() => rec.registrarManual({ api, entrada: { ...entrada, numero_parcela: 2 }, hoje: HOJE }), err => {
    assert.equal(err.status, 409);
    assert.match(err.message, /tem boleto em aberto no BB \(00031285570000000002\)/);
    assert.deepEqual(err.extra.boleto_em_aberto, { id: 42, nosso_numero: '00031285570000000002', ambiente: 'sandbox', valor: '1000.00', valor_desconto: null, data_vencimento: '2026-10-18' });
    return true;
  });
  await assert.rejects(() => rec.registrarManual({ api, entrada: { ...entrada, numero_parcela: 1 }, hoje: HOJE }), /já foi pago no banco: use "Conciliar com o BB"/);
  await assert.rejects(() => rec.registrarManual({ api, entrada: { ...entrada, numero_parcela: 9 }, hoje: HOJE }), /não tem a parcela 9/);

  const cancelado = apiFalsa(tabelas());
  cancelado.dados.pedidos[0].situacao = 'Cancelado';
  await assert.rejects(() => rec.registrarManual({ api: cancelado, entrada, hoje: HOJE }), /cancelado não recebe/);
});

test('estorno: pede motivo; não vale para o que veio do banco; quitação por fora estornada libera a parcela', async () => {
  const quitado = { ...BOLETO, id: 43, parcela_id: 2, numero_parcela: 2, status: 'baixado', motivo_baixa: 'quitado_por_fora', data_pagamento: '2026-09-10', valor_pago: '1000.00' };
  const api = apiFalsa(tabelas({
    boletos: [BOLETO, quitado],
    recebimentos: [
      { id: 1, pedido_id: 55, numero_parcela: 1, boleto_id: 41, origem: 'boleto', status: 'confirmado', valor_recebido: '980.00' },
      { id: 2, pedido_id: 55, numero_parcela: 2, boleto_id: 43, origem: 'quitado_por_fora', status: 'confirmado', valor_recebido: '1000.00' },
      { id: 3, pedido_id: 55, numero_parcela: 3, boleto_id: null, origem: 'manual', status: 'confirmado', valor_recebido: '1000.00' }
    ]
  }));
  await assert.rejects(() => rec.estornar({ api, id: 3, motivo: 'x' }), /Diga o motivo/);
  await assert.rejects(() => rec.estornar({ api, id: 1, motivo: 'engano de digitação' }), /veio do banco/);
  await assert.rejects(() => rec.estornar({ api, id: 99, motivo: 'engano de digitação' }), /não encontrado/);

  const r = await rec.estornar({ api, id: 3, motivo: 'lançado no pedido errado', usuarioId: 4 });
  assert.deepEqual([r.status, r.estornado_por, r.motivo_estorno], ['estornado', 4, 'lançado no pedido errado']);
  await assert.rejects(() => rec.estornar({ api, id: 3, motivo: 'de novo por engano' }), /já foi estornado/);

  assert.equal(boletos.ocupaParcela(api.dados.boletos[1]), true, 'quitado por fora ocupa a parcela');
  await rec.estornar({ api, id: 2, motivo: 'o Pix não caiu', usuarioId: 4 });
  const b = api.dados.boletos[1];
  assert.deepEqual([b.motivo_baixa, b.data_pagamento, b.valor_pago], ['quitacao_estornada', null, null]);
  assert.equal(boletos.ocupaParcela(b), false, 'parcela livre para boleto novo');
  assert.equal(api.dados.boletos_eventos.at(-1).tipo, 'quitacao_estornada');

  // Estorno do banco (cancelamento da baixa operacional): só os que vieram do boleto.
  const n = await rec.estornarDoBoleto({ api, boleto: BOLETO, motivo: 'BB cancelou' });
  assert.equal(n, 1);
  assert.equal(api.dados.recebimentos[0].status, 'estornado');
});

test('editar o pagamento lançado à mão: data, valor, forma e observação; o do banco não; mudar de mês com a comissão fechada, não (dono, 24/09/2026)', async () => {
  const api = apiFalsa(tabelas({
    recebimentos: [
      { id: 1, pedido_id: 55, numero_parcela: 1, origem: 'manual', status: 'confirmado', forma: 'Pix', data_recebimento: '2026-09-10', competencia: '2026-09', valor_parcela: '1000.00', valor_recebido: '1000.00' },
      { id: 2, pedido_id: 55, numero_parcela: 2, origem: 'boleto', status: 'confirmado', forma: 'Boleto', data_recebimento: '2026-09-11', competencia: '2026-09', valor_parcela: '1000.00', valor_recebido: '1000.00' },
      { id: 3, pedido_id: 55, numero_parcela: 3, origem: 'manual', status: 'estornado', data_recebimento: '2026-09-11', competencia: '2026-09', valor_parcela: '1000.00', valor_recebido: '1000.00' }
    ],
    financeiro_fechamentos: [], financeiro_fechamento_itens: []
  }));
  const editado = await rec.editarManual({ api, id: 1, entrada: { data_recebimento: '2026-09-12', valor_recebido: 1020.5, forma: 'Cartão de crédito', observacao: 'maquininha' }, hoje: HOJE });
  assert.deepEqual([editado.data_recebimento, editado.valor_recebido, editado.valor_encargos, editado.forma, editado.observacao, editado.competencia], ['2026-09-12', 1020.5, 20.5, 'Cartão de crédito', 'maquininha', '2026-09']);
  assert.equal(api.dados.recebimentos[0].forma, 'Cartão de crédito', 'gravou');

  await assert.rejects(() => rec.editarManual({ api, id: 2, entrada: { data_recebimento: '2026-09-12', valor_recebido: 1000, forma: 'Pix' }, hoje: HOJE }), /o do boleto vem do banco/);
  await assert.rejects(() => rec.editarManual({ api, id: 3, entrada: { data_recebimento: '2026-09-12', valor_recebido: 1000, forma: 'Pix' }, hoje: HOJE }), /estornado/);
  await assert.rejects(() => rec.editarManual({ api, id: 1, entrada: { data_recebimento: '2026-09-30', valor_recebido: 1000, forma: 'Pix' }, hoje: HOJE }), /não pode ser futura/);

  // Comissão de setembro fechada com esse pagamento: mudar de mês é recusado; no mesmo mês, pode.
  api.dados.financeiro_fechamentos.push({ id: 8, tipo: 'comissao', competencia: '2026-09', status: 'fechado' });
  api.dados.financeiro_fechamento_itens.push({ id: 80, fechamento_id: 8, recebimento_id: 1 });
  await assert.rejects(() => rec.editarManual({ api, id: 1, entrada: { data_recebimento: '2026-08-31', valor_recebido: 1000, forma: 'Pix' }, hoje: HOJE }), /comissão de 09\/2026, que está fechada/);
  const mesmoMes = await rec.editarManual({ api, id: 1, entrada: { data_recebimento: '2026-09-15', valor_recebido: 1000, forma: 'Pix' }, hoje: HOJE });
  assert.equal(mesmoMes.data_recebimento, '2026-09-15');
});
