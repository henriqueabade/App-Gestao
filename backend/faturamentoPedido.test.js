/**
 * As datas do faturamento de um pedido — de quando o prazo de cada parcela
 * conta.
 *
 * O que estes testes prendem:
 *
 * 1. FUSO. "Hoje" e a emissão são o dia de São Paulo: às 22h30 o dia UTC já é
 *    amanhã, e todos os vencimentos andariam um dia.
 * 2. DATE. Coluna DATE serializada como '...T00:00:00.000Z' é CORTADA, nunca
 *    convertida — convertida para São Paulo, vira o dia anterior.
 * 3. "Ao embarcar" só anda para FRENTE: embarque no dia ou adiantado não mexe
 *    no início.
 * 4. A reprogramação mexe nas parcelas NO LUGAR, e só nas que mudaram.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REGRAS_FATURAMENTO,
  diaValido,
  diaEmSaoPaulo,
  hojeEmSaoPaulo,
  somarDias,
  calcularVencimentos,
  prazosDoTexto,
  validarDatas,
  resolverDatas,
  baseDoFaturamento,
  inicioAposEmbarque,
  reprogramarParcelas
} = require('./faturamentoPedido');

// ------------------------------------------------------------------- fuso

test('hoje é o dia de São Paulo, não o dia UTC', () => {
  // 22h30 do dia 13 em São Paulo = 01h30 do dia 14 em UTC.
  assert.equal(hojeEmSaoPaulo(new Date('2026-09-14T01:30:00.000Z')), '2026-09-13');
  // 00h30 do dia 14 em São Paulo = 03h30Z.
  assert.equal(hojeEmSaoPaulo(new Date('2026-09-14T03:30:00.000Z')), '2026-09-14');
  assert.equal(hojeEmSaoPaulo(new Date('2026-09-13T15:00:00.000Z')), '2026-09-13');
});

test('a emissão (TIMESTAMP) vira o dia de São Paulo', () => {
  assert.equal(diaEmSaoPaulo('2026-01-10T01:30:00.000Z'), '2026-01-09');
  assert.equal(diaEmSaoPaulo('2026-01-10T12:00:00.000Z'), '2026-01-10');
  assert.equal(diaEmSaoPaulo(new Date('2026-01-10T02:59:00.000Z')), '2026-01-09');
  // Texto que já é só data não passa por new Date() — seria o dia 9 em SP.
  assert.equal(diaEmSaoPaulo('2026-01-10'), '2026-01-10');
  for (const vazio of [null, undefined, '', 'ontem', '2026-02-30']) {
    assert.equal(diaEmSaoPaulo(vazio), null, String(vazio));
  }
});

// ------------------------------------------------------------ coluna DATE

test('coluna DATE é cortada, nunca convertida', () => {
  assert.equal(diaValido('2026-09-13'), '2026-09-13');
  // Convertido para São Paulo, isto seria o dia 12.
  assert.equal(diaValido('2026-09-13T00:00:00.000Z'), '2026-09-13');
  assert.equal(diaValido('2026-09-13 00:00:00'), '2026-09-13');
  assert.equal(diaValido(' 2026-09-13 '), '2026-09-13');
});

test('dia impossível ou fora do formato é recusado', () => {
  for (const valor of [
    '2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31',
    '13/09/2026', '2026-9-13', '2026-09-130', '0026-09-13',
    '', '   ', null, undefined, 20260913, new Date()
  ]) {
    assert.equal(diaValido(valor), null, String(valor));
  }
  // 2028 é bissexto.
  assert.equal(diaValido('2028-02-29'), '2028-02-29');
});

// ------------------------------------------------------------- calendário

test('somar dias atravessa mês, ano e fevereiro pelo calendário', () => {
  // O exemplo da regra: início 10/08, prazo 15 → 25/08.
  assert.equal(somarDias('2026-08-10', 15), '2026-08-25');
  assert.equal(somarDias('2026-01-31', 30), '2026-03-02');
  assert.equal(somarDias('2026-02-28', 1), '2026-03-01');
  assert.equal(somarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(somarDias('2026-08-10', 0), '2026-08-10');
  // Início do antigo horário de verão (04/11/2018): nenhum dia some.
  assert.equal(somarDias('2018-11-03', 1), '2018-11-04');
  // DATE serializada entra cortada.
  assert.equal(somarDias('2026-08-10T00:00:00.000Z', 15), '2026-08-25');
  assert.equal(somarDias('2026-02-30', 1), null);
});

test('um vencimento por prazo, contado do início', () => {
  assert.deepEqual(
    calcularVencimentos('2026-08-10', [0, 15, 30]),
    ['2026-08-10', '2026-08-25', '2026-09-09']
  );
  assert.deepEqual(calcularVencimentos('2026-08-10', []), []);
});

test('os prazos saem do texto do pedido, um por parcela', () => {
  assert.deepEqual(prazosDoTexto('0/30/60'), [0, 30, 60]);
  assert.deepEqual(prazosDoTexto('0/30/60', 3), [0, 30, 60]);
  // Menos segmentos que parcelas: repete o último.
  assert.deepEqual(prazosDoTexto('30', 3), [30, 30, 30]);
  assert.deepEqual(prazosDoTexto('30/60', 3), [30, 60, 60]);
  // Mais segmentos que parcelas: o que sobra fica de fora.
  assert.deepEqual(prazosDoTexto('30/60/90', 2), [30, 60]);
  // Vazio vira zeros.
  assert.deepEqual(prazosDoTexto('', 2), [0, 0]);
  assert.deepEqual(prazosDoTexto(null, 1), [0]);
  assert.deepEqual(prazosDoTexto(undefined), []);
  // Lixo é ignorado.
  assert.deepEqual(prazosDoTexto('30/abc/60'), [30, 60]);
  assert.deepEqual(prazosDoTexto(' 15 '), [15]);
  assert.deepEqual(prazosDoTexto('-5/30'), [30]);
});

// ------------------------------------------------------ resolver as datas

test('cada erro das datas volta com a mensagem para o usuário', () => {
  const casos = [
    [null, /informe a previsão de embarque/i],
    [{}, /informe a previsão de embarque/i],
    [{ embarcar_previsao: '  ', faturamento_regra: 'ao_embarcar' }, /informe a previsão/i],
    [{ embarcar_previsao: '2026-02-30', faturamento_regra: 'ao_embarcar' }, /previsão de embarque não é uma data válida/i],
    [{ embarcar_previsao: '2026-10-01' }, /quando o faturamento começa/i],
    [{ embarcar_previsao: '2026-10-01', faturamento_regra: 'depois' }, /desconhecida/i],
    [{ embarcar_previsao: '2026-10-01', faturamento_regra: 'data' }, /informe a data de início/i],
    [
      { embarcar_previsao: '2026-10-01', faturamento_regra: 'data', inicio_faturamento: '31/10/2026' },
      /início do faturamento não é uma data válida/i
    ]
  ];
  for (const [entrada, esperado] of casos) {
    const r = resolverDatas(entrada, { dataConversao: '2026-09-14' });
    assert.equal(r.ok, false, JSON.stringify(entrada));
    assert.match(r.erro, esperado, JSON.stringify(entrada));
    assert.deepEqual(validarDatas(entrada), r, 'o formato é conferido igual nas duas');
  }
});

test('"ao converter" sem o dia da conversão é recusado', () => {
  const entrada = { embarcar_previsao: '2026-10-01', faturamento_regra: 'ao_converter' };
  const r = resolverDatas(entrada, {});
  assert.equal(r.ok, false);
  assert.match(r.erro, /dia da conversão/i);
  // O formato em si estava certo: a rota do pedido o aceita antes de ler o banco.
  assert.equal(validarDatas(entrada).ok, true);
});

test('cada regra resolve o seu início', () => {
  const previsao = '2026-10-01';
  assert.deepEqual(
    resolverDatas(
      { embarcar_previsao: previsao, faturamento_regra: 'ao_embarcar', inicio_faturamento: '2026-12-25' },
      { dataConversao: '2026-09-14' }
    ),
    { ok: true, embarcar_previsao: previsao, faturamento_regra: 'ao_embarcar', inicio_faturamento: previsao },
    'ao embarcar: começa na previsão, e o que vier no campo de início é ignorado'
  );
  assert.deepEqual(
    resolverDatas({ embarcar_previsao: previsao, faturamento_regra: 'ao_converter' }, { dataConversao: '2026-09-14' }),
    { ok: true, embarcar_previsao: previsao, faturamento_regra: 'ao_converter', inicio_faturamento: '2026-09-14' }
  );
  assert.deepEqual(
    resolverDatas(
      { embarcar_previsao: '2026-10-01T00:00:00.000Z', faturamento_regra: 'data', inicio_faturamento: '2026-09-20' },
      {}
    ),
    { ok: true, embarcar_previsao: previsao, faturamento_regra: 'data', inicio_faturamento: '2026-09-20' },
    'data específica — que pode vir antes da previsão'
  );
  assert.deepEqual([...REGRAS_FATURAMENTO], ['ao_embarcar', 'ao_converter', 'data']);
});

// ---------------------------------------------------- base do faturamento

test('os prazos contam do início gravado; no legado, do dia da emissão', () => {
  assert.equal(
    baseDoFaturamento({ inicio_faturamento: '2026-08-10T00:00:00.000Z', data_emissao: '2026-01-10T12:00:00.000Z' }),
    '2026-08-10'
  );
  // Emitido às 22h30 do dia 9 em São Paulo: o dia é 9, não 10.
  assert.equal(baseDoFaturamento({ inicio_faturamento: null, data_emissao: '2026-01-10T01:30:00.000Z' }), '2026-01-09');
  assert.equal(baseDoFaturamento({}), null);
  assert.equal(baseDoFaturamento(null), null);
});

// --------------------------------------------------------------- embarque

test('"ao embarcar": só o embarque ATRASADO move o início', () => {
  const pedido = {
    faturamento_regra: 'ao_embarcar', embarcar_previsao: '2026-08-10', inicio_faturamento: '2026-08-10'
  };
  assert.equal(inicioAposEmbarque(pedido, '2026-08-05'), null, 'adiantado não antecipa a cobrança');
  assert.equal(inicioAposEmbarque(pedido, '2026-08-10'), null, 'no dia não muda nada');
  assert.equal(inicioAposEmbarque(pedido, '2026-08-12'), '2026-08-12', 'atrasado passa a contar do embarque');
  // DATE serializada entra cortada: no dia continua sendo no dia.
  const serializado = {
    ...pedido, embarcar_previsao: '2026-08-10T00:00:00.000Z', inicio_faturamento: '2026-08-10T00:00:00.000Z'
  };
  assert.equal(inicioAposEmbarque(serializado, '2026-08-10'), null);
});

test('o embarque compara com o início atual, e só na regra "ao embarcar"', () => {
  // Início e previsão diferentes: o que vale é o início.
  const pedido = { faturamento_regra: 'ao_embarcar', embarcar_previsao: '2026-08-10', inicio_faturamento: '2026-08-20' };
  assert.equal(inicioAposEmbarque(pedido, '2026-08-15'), null);
  assert.equal(inicioAposEmbarque(pedido, '2026-08-21'), '2026-08-21');
  // Sem início gravado, vale a previsão.
  assert.equal(
    inicioAposEmbarque({ faturamento_regra: 'ao_embarcar', embarcar_previsao: '2026-08-10' }, '2026-08-11'),
    '2026-08-11'
  );
  // Sem nenhum dos dois (a tela não produz isso), "ao embarcar" é o embarque.
  assert.equal(inicioAposEmbarque({ faturamento_regra: 'ao_embarcar' }, '2026-08-11'), '2026-08-11');

  for (const regra of ['ao_converter', 'data', null, undefined, '']) {
    const outro = { faturamento_regra: regra, embarcar_previsao: '2026-08-10', inicio_faturamento: '2026-08-10' };
    assert.equal(inicioAposEmbarque(outro, '2026-09-30'), null, `regra ${regra}`);
  }
  assert.equal(inicioAposEmbarque(null, '2026-09-30'), null);
  assert.equal(inicioAposEmbarque({ faturamento_regra: 'ao_embarcar', embarcar_previsao: '2026-08-10' }, 'ontem'), null);
});

// ---------------------------------------------------------- reprogramação

/**
 * Cliente de API em memória, com o que importa do upstream: devolve na ordem
 * de inserção (ignora `order`) e o PUT é parcial. Não tem `post` nem
 * `delete` — se a reprogramação tentasse recriar parcelas, o teste quebraria
 * com "não é uma função".
 */
function apiFalsa(linhas, { falharPut = [], ignorarFiltro = false, falharGet = false } = {}) {
  const tabela = JSON.parse(JSON.stringify(linhas));
  const chamadas = [];
  return {
    tabela,
    chamadas,
    async get(caminho, { query } = {}) {
      chamadas.push({ metodo: 'GET', caminho, query });
      if (falharGet) throw new Error('Falha na requisição GET /api/pedido_parcelas: 500');
      if (ignorarFiltro) return tabela;
      return tabela.filter(l => String(l.pedido_id) === String(query?.pedido_id));
    },
    async put(caminho, body) {
      chamadas.push({ metodo: 'PUT', caminho, body });
      const id = Number(caminho.split('/').pop());
      if (falharPut.includes(id)) throw new Error(`Falha na requisição PUT ${caminho}: 500`);
      const alvo = tabela.find(l => l.id === id);
      Object.assign(alvo, body);
      return alvo;
    }
  };
}

test('reprograma no lugar, na ordem de numero_parcela, só o que mudou', async () => {
  // Gravadas fora de ordem de propósito: o upstream devolve na ordem de inserção.
  const api = apiFalsa([
    { id: 7, pedido_id: 1, numero_parcela: 2, valor: '120.50', data_vencimento: '2026-01-01' },
    { id: 3, pedido_id: 1, numero_parcela: 1, valor: 100, data_vencimento: '2026-08-25T00:00:00.000Z' },
    { id: 9, pedido_id: 1, numero_parcela: 3, valor: 80, data_vencimento: null }
  ]);
  const avisos = [];
  const parcelas = await reprogramarParcelas(api, '1', '2026-08-10', '15/45/75', avisos);

  assert.deepEqual(parcelas, [
    { id: 3, numero_parcela: 1, valor: 100, data_vencimento: '2026-08-25' },
    { id: 7, numero_parcela: 2, valor: 120.5, data_vencimento: '2026-09-24' },
    { id: 9, numero_parcela: 3, valor: 80, data_vencimento: '2026-10-24' }
  ]);
  assert.deepEqual(avisos, []);

  // A primeira já estava certa (DATE serializada, cortada): nenhum PUT nela.
  const puts = api.chamadas.filter(c => c.metodo === 'PUT');
  assert.deepEqual(puts.map(c => [c.caminho, c.body]), [
    ['/api/pedido_parcelas/7', { data_vencimento: '2026-09-24' }],
    ['/api/pedido_parcelas/9', { data_vencimento: '2026-10-24' }]
  ]);
  assert.deepEqual(api.chamadas[0].query, { pedido_id: '1' });
});

test('filtro ignorado pelo upstream não reescreve parcela de outro pedido', async () => {
  const api = apiFalsa([
    { id: 1, pedido_id: 1, numero_parcela: 1, valor: 50, data_vencimento: '2026-01-01' },
    { id: 2, pedido_id: 2, numero_parcela: 1, valor: 70, data_vencimento: '2026-01-01' }
  ], { ignorarFiltro: true });
  const parcelas = await reprogramarParcelas(api, 1, '2026-08-10', '30', []);

  assert.deepEqual(parcelas.map(p => p.id), [1]);
  assert.equal(api.tabela.find(l => l.id === 2).data_vencimento, '2026-01-01', 'a parcela do pedido 2 é intocável');
});

test('falha numa parcela vira aviso e a próxima segue', async () => {
  const api = apiFalsa([
    { id: 5, pedido_id: 1, numero_parcela: 1, valor: 192, data_vencimento: '2026-02-09' },
    { id: 6, pedido_id: 1, numero_parcela: 2, valor: 192, data_vencimento: '2026-03-11' }
  ], { falharPut: [5] });
  const avisos = [];
  const parcelas = await reprogramarParcelas(api, 1, '2026-10-10', '30/60', avisos);

  // A que falhou volta com a data que continua no banco.
  assert.deepEqual(parcelas.map(p => p.data_vencimento), ['2026-02-09', '2026-12-09']);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /Parcela 1/);
  assert.match(avisos[0], /09\/11\/2026/, 'a data que não entrou');
  assert.match(avisos[0], /09\/02\/2026/, 'a data que ficou');
});

test('sem conseguir ler as parcelas, avisa e não escreve nada', async () => {
  const api = apiFalsa([], { falharGet: true });
  const avisos = [];
  assert.deepEqual(await reprogramarParcelas(api, 1, '2026-10-10', '30', avisos), []);
  assert.equal(avisos.length, 1);
  assert.ok(!api.chamadas.some(c => c.metodo === 'PUT'));
});

test('início inválido não toca em nada', async () => {
  const api = apiFalsa([{ id: 5, pedido_id: 1, numero_parcela: 1, valor: 10, data_vencimento: '2026-02-09' }]);
  const avisos = [];
  assert.deepEqual(await reprogramarParcelas(api, 1, '2026-02-30', '30', avisos), []);
  assert.equal(api.chamadas.length, 0);
  assert.equal(avisos.length, 1);
});
