/**
 * Ajustes por PESSOA e a base real da comissão (pedido do dono, 06/10/2026).
 *
 * O que se prende:
 *   - a comissão conta o valor REAL do que se cobra: o boleto vivo (valor em
 *     dia, com o Adicional que ele traga), a ordem de pagamento, a parcela do
 *     pedido (que já leva o Adicional) e, recebida, o que o recebimento cobriu;
 *   - o "Registrar ajuste" acerta o que UMA pessoa recebe no mês — CMS,
 *     Royalty ou Produção —, sem tocar no pedido do cliente;
 *   - quem termina o mês negativo não recebe nada nele e a diferença vai para
 *     o mês seguinte como "Ajuste restante do mês anterior" (projetado
 *     enquanto o mês está aberto; do fechamento, depois de fechado);
 *   - aparece no resumo do painel e nos relatórios; mês fechado não recebe
 *     ajuste; ajuste que entrou em fechamento não se cancela.
 *
 * Ponta a ponta com a API genérica de mentira (as travas do banco, inclusive o
 * índice único do ajuste no item do fechamento) e permissões dubladas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const contasReceber = require('./cobranca/contasReceber');
const comissoes = require('./financeiro/comissoes');
const producao = require('./financeiro/producao');
const ajustesPessoa = require('./financeiro/ajustesPessoa');

const TOKEN = 'x.eyJpZCI6MX0.assinatura';

function hojeBR() {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = t => partes.find(p => p.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}
const somarMeses = (comp, n) => {
  const [a, m] = comp.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

// ------------------------------------------------------------ contas puras

const REGRAS = [
  { id: 1, tipo: 'cms', beneficiario: 'Arquiteta Ana', percentual: '10', escopo: 'todos', ativo: true },
  { id: 2, tipo: 'royalty', beneficiario: 'Marca Santíssimo', percentual: '10', escopo: 'todos', ativo: true }
];

function apurado({ parcelas, boletos = [], ordens = [], recebimentos = [], ajustesPessoa: porPessoa = [], fechamentos = [], itens = [], hoje = '2026-10-06' }) {
  const pedidos = [{ id: 55, numero: '2548', situacao: 'Enviado', cliente_id: 7 }];
  const linhas = contasReceber.parcelasDosPedidos({ pedidos, parcelas, recebimentos, boletos, notas: [], clientes: [], hoje, ordens });
  const estado = comissoes.estadoDosFechamentos({ fechamentos, itens, pagamentos: [], tipo: 'comissao' });
  return { estado, apuradas: comissoes.apurar({ linhas, pedidos, parcelas, recebimentos, ajustes: [], regrasLista: REGRAS, estado, hoje, ajustesPessoa: porPessoa }) };
}

test('a base da comissão é o valor real: boleto vivo (em dia), ordem de pagamento, parcela com Adicional, recebimento', () => {
  const parcelas = [
    { id: 1, pedido_id: 55, numero_parcela: 1, valor: '1000.00', data_vencimento: '2026-11-10' },
    { id: 2, pedido_id: 55, numero_parcela: 2, valor: '1000.00', data_vencimento: '2026-12-10' },
    { id: 3, pedido_id: 55, numero_parcela: 3, valor: '1150.00', data_vencimento: '2027-01-10' },
    { id: 4, pedido_id: 55, numero_parcela: 4, valor: '1000.00', data_vencimento: '2026-09-10' }
  ];
  const { apuradas } = apurado({
    parcelas,
    // A 1ª tem boleto vivo com acréscimo: R$ 1.260 cheio, R$ 60 de desconto até o vencimento → R$ 1.200 em dia.
    boletos: [{ id: 9, pedido_id: 55, parcela_id: 1, numero_parcela: 1, status: 'registrado', valor: '1260.00', valor_desconto: '60.00', data_vencimento: '2026-11-10', nosso_numero: '1' }],
    // A 2ª tem ordem de pagamento combinada por R$ 1.100.
    ordens: [{ id: 3, pedido_id: 55, parcela_id: 2, numero_parcela: 2, status: 'aberta', valor: '1100.00', data_prevista: '2026-12-05' }],
    // A 4ª foi paga: o recebimento cobriu R$ 1.050 da parcela (o que ele diz).
    recebimentos: [{ id: 7, pedido_id: 55, numero_parcela: 4, status: 'confirmado', data_recebimento: '2026-09-09', competencia: '2026-09', valor_parcela: '1050.00', valor_abatimento: '0', valor_recebido: '1050.00' }]
  });
  const por = n => apuradas.find(p => p.numero_parcela === n);
  assert.deepEqual([por(1).valor_original, por(1).base_origem, por(1).potencial.cms], [1200, 'boleto', 120], 'o boleto vivo vale pelo valor em dia');
  assert.deepEqual([por(2).valor_original, por(2).base_origem, por(2).potencial.cms], [1100, 'ordem', 110]);
  assert.deepEqual([por(3).valor_original, por(3).base_origem, por(3).potencial.total], [1150, 'parcela', 230], 'a parcela já leva o Adicional do pedido');
  assert.deepEqual([por(4).valor_original, por(4).base_origem], [1050, 'recebimento']);
  assert.equal(por(4).pendentes[0].base, 1050);
  assert.equal(comissoes.valorRealDaParcela({ valor: 900 }, null).origem, 'parcela');
});

test('ajuste por pessoa na CMS: entra no mês dela; negativo não se paga e vai para o mês seguinte como restante', () => {
  const parcelas = [{ id: 1, pedido_id: 55, numero_parcela: 1, valor: '5000.00', data_vencimento: '2026-10-05' }];
  const recebimentos = [{ id: 7, pedido_id: 55, numero_parcela: 1, status: 'confirmado', data_recebimento: '2026-10-05', competencia: '2026-10', valor_parcela: '5000.00', valor_abatimento: '0', valor_recebido: '5000.00' }];
  const porPessoa = [
    { id: 1, area: 'cms', beneficiario: 'Arquiteta Ana', tipo: 'adiantamento', sinal: -1, valor: '800.00', data_ajuste: '2026-10-03', competencia: '2026-10', motivo: 'Adiantamento em dinheiro', status: 'ativo' },
    { id: 2, area: 'royalty', beneficiario: 'Marca Santíssimo', tipo: 'bonificacao', sinal: 1, valor: '100.00', data_ajuste: '2026-10-04', competencia: '2026-10', motivo: 'Bonificação do lançamento', status: 'ativo' },
    { id: 3, area: 'cms', beneficiario: 'Arquiteta Ana', tipo: 'desconto', sinal: -1, valor: '999.00', data_ajuste: '2026-10-04', competencia: '2026-10', motivo: 'Cancelado depois', status: 'cancelado' }
  ];
  const { apuradas, estado } = apurado({ parcelas, recebimentos, ajustesPessoa: porPessoa });
  const entradas = apuradas.filter(p => p.tipo_entrada === 'ajuste_pessoa');
  assert.equal(entradas.length, 2, 'o cancelado não entra');
  assert.equal(entradas[0].controlada, false, 'não é parcela: fica fora das previstas e atrasadas');

  const outubro = comissoes.montarFechamento({ apuradas, estado, competencia: '2026-10', propria: true });
  assert.deepEqual(outubro.beneficiarios.map(b => [b.tipo, b.beneficiario, b.valor]), [['cms', 'Arquiteta Ana', -300], ['royalty', 'Marca Santíssimo', 600]]);
  assert.equal(outubro.a_pagar, 600, 'quem ficou negativo não recebe');
  assert.equal(outubro.a_compensar, -300);
  assert.deepEqual(outubro.ajustes_pessoa, { quantidade: 2, valor: -700, somam: 100, descontam: -800 });
  assert.equal(outubro.restante_anterior, 0);

  // Novembro, com outubro ainda aberto: o negativo da Ana já aparece como restante (projetado).
  const novembro = comissoes.montarFechamento({ apuradas, estado, competencia: '2026-11', propria: true });
  const restante = novembro.itens.find(i => i.tipo_item === 'saldo');
  assert.ok(restante, 'o restante do mês anterior entra em novembro');
  assert.equal(restante.total, -300);
  assert.equal(restante.projetado, true);
  assert.match(restante.motivo, /^Ajuste restante do mês anterior \(outubro\/2026\): Arquiteta Ana terminou outubro\/2026 com - R\$/);
  assert.equal(novembro.restante_anterior, -300);
  // Dezembro: a Ana continua sem nada em novembro, então o negativo segue.
  assert.equal(comissoes.restantesProjetados({ apuradas, estado, competencia: '2026-12' })[0].total, -300);

  // Fechou outubro: os ajustes congelados não entram de novo, e o restante vem do fechamento.
  const r = comissoes.montarFechamento({ apuradas, estado, competencia: '2026-10' });
  const fechamento = { id: 1, tipo: 'comissao', competencia: '2026-10', status: 'fechado', total: r.a_pagar, pagar_ate: '2026-11-15', por_setor: JSON.stringify(r.beneficiarios) };
  const itens = r.itens.map((i, n) => ({
    id: 100 + n, fechamento_id: 1, tipo_item: i.tipo_item, pedido_id: i.pedido_id, numero_parcela: i.numero_parcela, recebimento_id: i.recebimento_id,
    ajuste_pessoa_id: i.ajuste_pessoa_id ?? null, competencia_origem: i.competencia_natural, cms: String(i.cms), royalty: String(i.royalty), total: String(i.total),
    detalhes: JSON.stringify({ ...i.detalhes, motivo: i.motivo || null })
  }));
  const depois = apurado({ parcelas, recebimentos, ajustesPessoa: porPessoa, fechamentos: [fechamento], itens });
  assert.equal(depois.apuradas.filter(p => p.tipo_entrada === 'ajuste_pessoa').length, 0, 'o ajuste entra em um fechamento só');
  const nov = comissoes.montarFechamento({ apuradas: depois.apuradas, estado: depois.estado, competencia: '2026-11', propria: true });
  assert.deepEqual(nov.itens.map(i => [i.tipo_item, i.total, i.projetado]), [['saldo', -300, false]]);
  assert.match(nov.itens[0].motivo, /Ajuste restante do mês anterior \(outubro\/2026\)/);
  const congelado = comissoes.montarFechamento({ apuradas: depois.apuradas, estado: depois.estado, competencia: '2026-10' });
  assert.deepEqual(congelado.ajustes_pessoa, { quantidade: 2, valor: -700, somam: 100, descontam: -800 }, 'o fechado continua dizendo o que foi ajustado');
});

test('ajuste por pessoa na produção: linha do processo; processo negativo leva o restante; validação', () => {
  const estado = comissoes.estadoDosFechamentos({ fechamentos: [], itens: [], pagamentos: [], tipo: 'producao' });
  const linhasAjuste = ajustesPessoa.linhasDeProducao({
    ajustes: [
      { id: 5, area: 'producao', beneficiario: 'João', setor_id: 2, setor: 'Acabamento', colaborador_id: 9, tipo: 'adiantamento', sinal: -1, valor: '500.00', data_ajuste: '2026-10-02', competencia: '2026-10', motivo: 'Vale do dia 02', referencia: 'PED115', status: 'ativo' }
    ],
    estado, competenciaAlvo: comissoes.competenciaAlvo, processos: new Map([['2', 'Acabamento']])
  });
  assert.deepEqual(linhasAjuste.map(l => [l.tipo_item, l.setor, l.total, l.colaborador]), [['ajuste', 'Acabamento', -500, 'João']]);
  assert.match(linhasAjuste[0].produto, /^Ajuste \(Adiantamento já pago\) · João — Vale do dia 02 · ref\. PED115$/);
  const pend = [
    { tipo_item: 'producao', pedido_id: 1, pedido_item_id: 10, setor_id: 2, setor: 'Acabamento', quantidade: 2, total: 200, competencia: '2026-10' },
    ...linhasAjuste
  ];
  const outubro = producao.montarCompetencia({ pend, estado, competencia: '2026-10', propria: true });
  assert.deepEqual(outubro.setores.map(s => [s.setor, s.total]), [['Acabamento', -300]]);
  assert.equal(outubro.a_pagar, 0);
  assert.equal(outubro.ajustes, -500);
  assert.equal(outubro.ajustes_quantidade, 1);
  const novembro = producao.montarCompetencia({ pend, estado, competencia: '2026-11', propria: true });
  assert.deepEqual(novembro.linhas.map(l => [l.tipo_item, l.setor, l.total, l.status_item]), [['saldo', 'Acabamento', -300, 'Restante do mês anterior']]);
  assert.match(novembro.linhas[0].motivo, /^Ajuste restante do mês anterior \(outubro\/2026\): Acabamento terminou outubro\/2026 com - R\$/);
  assert.equal(novembro.restante_anterior, -300);

  const hoje = '2026-10-06';
  const base = { area: 'cms', beneficiario: 'Ana', tipo: 'bonificacao', valor: '1.234,56', data_ajuste: '2026-10-06', motivo: 'Meta batida no mês' };
  assert.deepEqual(
    (({ area, sinal, valor, competencia }) => [area, sinal, valor, competencia])(ajustesPessoa.validar(base, { hoje })),
    ['cms', 1, 1234.56, '2026-10'], 'a competência sai da data quando não vem');
  assert.equal(ajustesPessoa.validar({ ...base, tipo: 'estorno', competencia: '2026-12' }, { hoje }).sinal, -1);
  assert.throws(() => ajustesPessoa.validar({ ...base, area: 'x' }, { hoje }), /CMS, Royalty ou Produção/);
  assert.throws(() => ajustesPessoa.validar({ ...base, beneficiario: '' }, { hoje }), /dono do cliente/);
  assert.throws(() => ajustesPessoa.validar({ ...base, area: 'producao' }, { hoje }), /processo/);
  assert.throws(() => ajustesPessoa.validar({ ...base, valor: 0 }, { hoje }), /valor/);
  assert.throws(() => ajustesPessoa.validar({ ...base, motivo: 'ok' }, { hoje }), /motivo/);
  assert.throws(() => ajustesPessoa.validar({ ...base, competencia: '2027-11' }, { hoje }), /12 meses/);
  assert.deepEqual(ajustesPessoa.impacto({ atual: 500, valor: 800, sinal: -1 }), { antes: 500, depois: -300, a_pagar: 0, restante: -300 });
});

// ------------------------------------------------------------ ponta a ponta

function criarUpstream(tabelas) {
  let proximo = 1000;
  const unicoViolado = (tabela, lista, dados) => {
    if (tabela === 'financeiro_fechamentos') return lista.some(l => l.tipo === dados.tipo && l.competencia === dados.competencia);
    if (tabela === 'financeiro_fechamento_itens') {
      return (dados.ajuste_pessoa_id && lista.some(l => l.ajuste_pessoa_id === dados.ajuste_pessoa_id))
        || (dados.tipo_item === 'parcela' && dados.recebimento_id && lista.some(l => l.tipo_item === 'parcela' && l.recebimento_id === dados.recebimento_id));
    }
    return false;
  };
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const responder = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    const [, tabela, id] = url.pathname.match(/^\/api\/([a-z_]+)(?:\/(\d+))?$/) || [];
    const lista = tabela && tabelas[tabela];
    if (!lista) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const dados = corpo ? JSON.parse(corpo) : {};
      if (req.method === 'GET') {
        if (id) return responder(200, lista.find(l => String(l.id) === id) || null);
        const filtros = [...url.searchParams.entries()].filter(([k]) => k !== 'select' && k !== 'order');
        return responder(200, lista.filter(l => filtros.every(([k, v]) => String(l[k]) === String(v))));
      }
      if (req.method === 'POST') {
        if (unicoViolado(tabela, lista, dados)) return responder(500, { error: 'Erro no INSERT', detalhe: 'duplicate key value violates unique constraint' });
        const linha = { id: dados.id ?? proximo++, ...dados };
        lista.push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT' && id) {
        const linha = lista.find(l => String(l.id) === id);
        if (!linha) return responder(404, { error: 'não há' });
        Object.assign(linha, dados);
        return responder(200, linha);
      }
      if (req.method === 'DELETE' && id) {
        const i = lista.findIndex(l => String(l.id) === id);
        if (i >= 0) lista.splice(i, 1);
        return responder(200, {});
      }
      return responder(404, { error: 'não há' });
    });
    return undefined;
  });
}

function tabelas(ant) {
  const vazias = ['ajustes_financeiros', 'producao_setores', 'producao_valores', 'financeiro_feriados', 'producao_eventos', 'producao_confirmacoes',
    'financeiro_fechamentos', 'financeiro_fechamento_itens', 'financeiro_pagamentos', 'financeiro_eventos', 'financeiro_ajustes_pessoa',
    'boletos', 'boletos_eventos', 'cobranca_execucoes', 'pedidos_itens_faltantes', 'pedido_itens_ext', 'produtos_em_cada_ponto', 'materia_prima', 'produtos_insumos'];
  return {
    ...Object.fromEntries(vazias.map(n => [n, []])),
    configuracao_cobranca: [{ id: 1, recebimentos_desde: null }],
    financeiro_configuracao: [{ id: 1, comissao_dia_pagamento: 15, producao_dia_util: 5, sabado_dia_util: false }],
    comissao_regras: [
      { id: 1, tipo: 'cms', beneficiario: 'Marcia Lamounier', percentual: '10', escopo: 'todos', ativo: true },
      { id: 2, tipo: 'royalty', beneficiario: null, percentual: '10', escopo: 'todos', ativo: true }
    ],
    etapas_producao: [
      { id: 1, nome: 'Marcenaria', ordem: 1, producao_ativa: true },
      { id: 2, nome: 'Acabamento', ordem: 2, producao_ativa: true },
      { id: 3, nome: 'Embalagem', ordem: 3, producao_ativa: false }
    ],
    pedidos: [{ id: 55, numero: '2548', situacao: 'Enviado', cliente_id: 7, valor_final: 40000, prazo: '30/60', data_aprovacao: `${ant}-01` }],
    pedido_parcelas: [
      { id: 1, pedido_id: 55, numero_parcela: 1, valor: '20000.00', data_vencimento: `${ant}-20` },
      { id: 2, pedido_id: 55, numero_parcela: 2, valor: '20000.00', data_vencimento: '2099-01-20' }
    ],
    pedidos_itens: [{ id: 501, pedido_id: 55, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona', quantidade: 5, valor_total: '40000.00' }],
    clientes: [{ id: 7, nome_fantasia: 'Cliente Bom', dono_cliente: 'Marcia Lamounier' }],
    usuarios: [{ id: 1, nome: 'Henrique' }],
    produtos: [{ id: 10, codigo: 'POL-01', nome: 'Poltrona', desenhado_por: 'Barral & Lamounier' }],
    tabela_fixa: [{ id_prod: 10, cod_prod: 'POL-01', vlr_prod: '1000.00' }],
    notas_fiscais: [{ id: 10, pedido_id: 55, serie: 1, numero: 5, status_fiscal: 'autorizada' }],
    recebimentos: [{
      id: 1, pedido_id: 55, numero_parcela: 1, status: 'confirmado', origem: 'manual', forma: 'Pix', data_recebimento: `${ant}-10`,
      competencia: ant, valor_parcela: '20000.00', valor_abatimento: '0', valor_recebido: '20000.00', valor_encargos: '0'
    }]
  };
}

async function montar(t) {
  const upstream = criarUpstream(t);
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  for (const chave of Object.keys(require.cache)) {
    if (/[\\/]backend[\\/](financeiro|cobranca|fiscal)[\\/]/.test(chave) || /(apiHttpClient|permissionsController|cobrancaController|financeiroController)\.js$/.test(chave)) delete require.cache[chave];
  }
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: () => (req, res, next) => next(),
      exigirAlgumaPermissao: () => (req, res, next) => next(),
      exigirSupAdmin: (req, res) => res.status(403).json({ error: 'Somente Sup Admin' }),
      ehSupAdmin: async () => false
    }
  };
  const { criarRouter } = require('./financeiroController');
  const app = express();
  app.use(express.json());
  app.use('/api/financeiro', criarRouter());
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, corpo: await r.json() };
  };
  const fechar = () => Promise.all([new Promise(r => servidor.close(r)), new Promise(r => upstream.close(r))]);
  return { chamar, fechar };
}

test('ponta a ponta: registrar, ver no resumo e nos relatórios, levar o negativo, fechar, travar o mês fechado e cancelar', async () => {
  const hoje = hojeBR();
  const atual = hoje.slice(0, 7);
  const ant = somarMeses(atual, -1);
  const t = tabelas(ant);
  const api = await montar(t);
  try {
    const opcoes = await api.chamar('GET', '/api/financeiro/ajustes-pessoa/opcoes');
    assert.equal(opcoes.status, 200);
    assert.equal(opcoes.corpo.sql_pendente, false);
    assert.deepEqual(opcoes.corpo.pessoas.cms, ['Marcia Lamounier']);
    assert.deepEqual(opcoes.corpo.pessoas.royalty, ['Barral & Lamounier']);
    assert.deepEqual(opcoes.corpo.processos.map(p => p.nome), ['Marcenaria', 'Acabamento'], 'processo com o pagamento desligado não aparece');

    // A Marcia tem R$ 2.000 de CMS no mês passado; o adiantamento de R$ 2.500 deixa −R$ 500.
    const adiantamento = { area: 'cms', beneficiario: 'Marcia Lamounier', tipo: 'adiantamento', valor: 2500, data_ajuste: `${ant}-05`, competencia: ant, motivo: 'Adiantamento pago em dinheiro', referencia: 'PED2548' };
    const r1 = await api.chamar('POST', '/api/financeiro/ajustes-pessoa', adiantamento);
    assert.equal(r1.status, 200, JSON.stringify(r1.corpo));
    assert.equal(r1.corpo.ajuste.valor_com_sinal, -2500);
    assert.equal(t.financeiro_ajustes_pessoa[0].sinal, -1);
    assert.equal(t.financeiro_eventos.at(-1).tipo, 'ajuste_registrado', 'fica no histórico do Financeiro');
    const r2 = await api.chamar('POST', '/api/financeiro/ajustes-pessoa', { area: 'royalty', beneficiario: 'Barral & Lamounier', tipo: 'bonificacao', valor: 100, data_ajuste: `${ant}-06`, competencia: ant, motivo: 'Bonificação do lançamento' });
    assert.equal(r2.status, 200);

    const painelAnt = await api.chamar('GET', `/api/financeiro/painel?competencia=${ant}`);
    const rc = painelAnt.corpo.resumo_comissoes;
    assert.deepEqual(rc.ajustes_pessoa, { quantidade: 2, valor: -2400, somam: 100, descontam: -2500 });
    assert.deepEqual(rc.ficam_para_o_proximo, [{ tipo: 'cms', beneficiario: 'Marcia Lamounier', valor: -500 }]);
    assert.equal(painelAnt.corpo.comissoes.total, 2100, 'só o Royalty com a bonificação: a Marcia ficou negativa');

    const painelAtual = await api.chamar('GET', `/api/financeiro/painel?competencia=${atual}`);
    assert.equal(painelAtual.corpo.resumo_comissoes.restante_anterior, -500, 'o negativo já abate no mês seguinte');

    const doMes = await api.chamar('GET', `/api/financeiro/ajustes-pessoa?competencia=${ant}`);
    assert.deepEqual(doMes.corpo.totais.cms, [{ beneficiario: 'Marcia Lamounier', valor: -500 }]);
    assert.deepEqual(doMes.corpo.ajustes.map(a => [a.tipo_rotulo, a.valor_com_sinal, a.criado_por_nome, a.no_fechamento]),
      [['Bonificação', 100, 'Henrique', false], ['Adiantamento já pago', -2500, 'Henrique', false]]);

    const relatorio = await api.chamar('GET', `/api/financeiro/relatorios/ajustes-pessoa?competencia=${ant}`);
    assert.deepEqual(relatorio.corpo.linhas.map(l => [l.area, l.beneficiario, l.valor, l.situacao]),
      [['CMS', 'Marcia Lamounier', -2500, 'Em aberto'], ['Royalty', 'Barral & Lamounier', 100, 'Em aberto']]);
    assert.match(relatorio.corpo.linhas[0].motivo, /ref\. PED2548/);
    const relAtual = await api.chamar('GET', `/api/financeiro/relatorios/ajustes-pessoa?competencia=${atual}`);
    assert.deepEqual(relAtual.corpo.linhas.map(l => [l.tipo, l.beneficiario, l.valor]), [['Ajuste restante do mês anterior', 'Marcia Lamounier', -500]]);

    // Fechar o mês passado: os ajustes vão para o fechamento, com o id deles.
    const fechou = await api.chamar('POST', '/api/financeiro/fechamentos', { tipo: 'comissao', competencia: ant });
    assert.equal(fechou.status, 200, JSON.stringify(fechou.corpo));
    assert.equal(fechou.corpo.total, 2100);
    assert.deepEqual(t.financeiro_fechamento_itens.filter(i => i.ajuste_pessoa_id).map(i => [i.tipo_item, Number(i.total)]).sort(), [['ajuste', -2500], ['ajuste', 100]]);

    const tarde = await api.chamar('POST', '/api/financeiro/ajustes-pessoa', { ...adiantamento, valor: 10 });
    assert.equal(tarde.status, 409, 'mês fechado não recebe ajuste');
    assert.equal(tarde.corpo.proxima, atual);
    const cancelarFechado = await api.chamar('POST', `/api/financeiro/ajustes-pessoa/${t.financeiro_ajustes_pessoa[0].id}/cancelar`, { motivo: 'Lançado errado' });
    assert.equal(cancelarFechado.status, 409);
    assert.match(cancelarFechado.corpo.error, /já entrou num fechamento/);

    const depois = await api.chamar('GET', `/api/financeiro/painel?competencia=${atual}`);
    assert.equal(depois.corpo.resumo_comissoes.restante_anterior, -500, 'agora o restante vem do fechamento');
    const previa = await api.chamar('GET', `/api/financeiro/fechamentos/previa?tipo=comissao&competencia=${atual}`);
    assert.ok(previa.corpo.itens.some(i => i.tipo_item === 'saldo' && /Ajuste restante do mês anterior/.test(i.motivo)));

    // Produção: o ajuste é do processo; cancelar tira do mês.
    const bonus = await api.chamar('POST', '/api/financeiro/ajustes-pessoa', { area: 'producao', setor_id: 2, tipo: 'bonificacao', valor: 300, data_ajuste: hoje, competencia: atual, motivo: 'Entrega antecipada' });
    assert.equal(bonus.status, 200, JSON.stringify(bonus.corpo));
    assert.equal(bonus.corpo.ajuste.beneficiario, 'Acabamento', 'sem colaborador, quem recebe é o processo');
    const vale = await api.chamar('POST', '/api/financeiro/ajustes-pessoa', { area: 'producao', setor_id: 2, tipo: 'desconto', valor: 50, data_ajuste: hoje, competencia: atual, motivo: 'Peça refeita por erro' });
    let prod = await api.chamar('GET', `/api/financeiro/painel?competencia=${atual}`);
    assert.equal(prod.corpo.resumo_producao.ajustes, 250);
    const linhasProd = await api.chamar('GET', `/api/financeiro/producao?competencia=${atual}`);
    assert.deepEqual(linhasProd.corpo.linhas.filter(l => l.tipo_item === 'ajuste').map(l => [l.setor, l.total]).sort((a, b) => a[1] - b[1]), [['Acabamento', -50], ['Acabamento', 300]]);
    const cancelou = await api.chamar('POST', `/api/financeiro/ajustes-pessoa/${vale.corpo.ajuste.id}/cancelar`, { motivo: 'Lançado em dobro' });
    assert.equal(cancelou.status, 200, JSON.stringify(cancelou.corpo));
    assert.equal(cancelou.corpo.ajuste.status, 'cancelado');
    prod = await api.chamar('GET', `/api/financeiro/painel?competencia=${atual}`);
    assert.equal(prod.corpo.resumo_producao.ajustes, 300);
    const relProd = await api.chamar('GET', `/api/financeiro/relatorios/ajustes-producao?competencia=${atual}`);
    assert.deepEqual(relProd.corpo.linhas.map(l => [l.tipo, l.valor, l.situacao.split(' — ')[0]]), [['Bonificação', 300, 'Em aberto'], ['Desconto', null, 'Cancelado']]);
  } finally {
    await api.fechar();
  }
});
