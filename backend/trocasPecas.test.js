/**
 * Troca de peças entre pedidos (pedido do dono, 09/10/2026): a peça vai no
 * estado em que está e a do mesmo produto vem no lugar; quem fica com a menos
 * adiantada volta a dever; quem recebe a pronta não paga de novo; o que já foi
 * registrado vale como valia; tudo fica registrado nos dois pedidos.
 *
 * A rota da poltrona: 3 passos de Marcenaria (R$ 300 a peça) e 2 de
 * Acabamento (R$ 200).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const trocas = require('./trocasPecas');
const producao = require('./financeiro/producao');

function apiFalsa(tabelas) {
  let proximo = 9000;
  const nome = caminho => String(caminho).replace(/^\/api\//, '').split('?')[0].split('/')[0];
  return {
    tabelas,
    async get(caminho, opcoes = {}) {
      const tabela = nome(caminho);
      const linhas = tabelas[tabela];
      if (!linhas) throw new Error(`relation "${tabela}" does not exist`);
      const query = opcoes.query || {};
      return linhas.filter(l => Object.entries(query)
        .filter(([campo]) => !['select', 'order'].includes(campo))
        .every(([campo, valor]) => String(l[campo]) === String(valor)));
    },
    async post(caminho, corpo) {
      const tabela = nome(caminho);
      if (!tabelas[tabela]) throw new Error(`relation "${tabela}" does not exist`);
      const linha = { id: (proximo += 1), ...corpo };
      tabelas[tabela].push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const partes = String(caminho).replace(/^\/api\//, '').split('/');
      const linha = (tabelas[partes[0]] || []).find(l => String(l.id) === partes[1]);
      if (linha) Object.assign(linha, corpo);
      return linha || {};
    },
    async delete() { return {}; }
  };
}

const ev = (id, itemId, pedidoId, etapaId, quantidade, criado_em) => ({
  id, pedido_id: pedidoId, pedido_item_id: itemId, produto_id: 10, etapa_id: etapaId, setor_id: null, quantidade,
  data_finalizacao: criado_em.slice(0, 10), competencia: criado_em.slice(0, 7), status: 'ativo', criado_em
});

function tabelas({ semSql = false, situacao66 = 'Produção' } = {}) {
  const t = {
    pedidos: [
      { id: 55, numero: 'PED55', situacao: 'Produção', cliente_id: 7 },
      { id: 66, numero: 'PED66', situacao: situacao66, cliente_id: 8 },
      { id: 77, numero: 'PED77', situacao: 'Produção', cliente_id: 8 }
    ],
    pedidos_itens: [
      { id: 501, pedido_id: 55, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona', quantidade: 2 },
      { id: 601, pedido_id: 66, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona', quantidade: 1 },
      { id: 701, pedido_id: 77, produto_id: 20, codigo: 'MES-01', nome: 'Mesa', quantidade: 1 }
    ],
    pedido_itens_ext: [],
    clientes: [{ id: 7, nome_fantasia: 'Pupê' }, { id: 8, nome_fantasia: 'Figo Casa' }],
    materia_prima: [
      { id: 301, nome: 'MDF', processo: 'Marcenaria' }, { id: 302, nome: 'Cola', processo: 'Marcenaria' }, { id: 303, nome: 'Parafuso', processo: 'Marcenaria' },
      { id: 304, nome: 'Seladora', processo: 'Acabamento' }, { id: 305, nome: 'Verniz', processo: 'Acabamento' }
    ],
    produtos_insumos: [301, 302, 303, 304, 305].map((insumo, i) => ({ id: 401 + i, produto_id: 10, insumo_id: insumo, quantidade: 1, ordem_insumo: i + 1 })),
    tabela_fixa: [{ id_prod: 10, cod_prod: 'POL-01', vlr_prod: '1000.00' }],
    etapas_producao: [
      { id: 1, nome: 'Marcenaria', ordem: 1, producao_ativa: true },
      { id: 2, nome: 'Acabamento', ordem: 2, producao_ativa: true }
    ],
    producao_setores: [],
    producao_valores: [
      { id: 1, etapa_id: 1, produto_id: null, tipo: 'valor', valor_unitario: '300.00', ativo: true },
      { id: 2, etapa_id: 2, produto_id: null, tipo: 'valor', valor_unitario: '200.00', ativo: true }
    ],
    comissao_regras: [],
    financeiro_feriados: [],
    financeiro_configuracao: [{ id: 1, comissao_dia_pagamento: 15, producao_dia_util: 5, sabado_dia_util: false }],
    financeiro_fechamentos: [],
    financeiro_fechamento_itens: [],
    financeiro_pagamentos: [],
    financeiro_eventos: [],
    producao_confirmacoes: [],
    // PED55 fez a Marcenaria das duas peças e o Acabamento de uma: uma pronta, uma com a Marcenaria feita.
    producao_eventos: [ev(1, 501, 55, 1, 2, '2026-10-01T10:00:00Z'), ev(2, 501, 55, 2, 1, '2026-10-02T10:00:00Z')],
    pedido_historico_eventos: []
  };
  if (!semSql) { t.trocas_pecas = []; t.pecas_avulsas = []; }
  return t;
}

const estadoComRotulo = (item, rotulo) => item.estados.find(e => e.rotulo === rotulo);

test('opções: as unidades do pedido por estado e com quem cada peça pode trocar (o mesmo produto, pedido que não saiu)', async () => {
  const api = apiFalsa(tabelas());
  const o = await trocas.opcoes(api, 55);
  assert.equal(o.pedido.numero, 'PED55');
  assert.equal(o.pedido.pode_trocar, true);
  const item = o.itens[0];
  assert.deepEqual(item.estados.map(e => [e.rotulo, e.quantidade]), [['Pronta', 1], ['Marcenaria feita', 1]]);
  assert.equal(item.candidatos.length, 1, 'a mesa do PED77 não entra: é outro produto');
  assert.equal(item.candidatos[0].numero, 'PED66');
  assert.equal(item.candidatos[0].cliente, 'Figo Casa');
  assert.deepEqual(item.candidatos[0].estados.map(e => [e.rotulo, e.quantidade]), [['Por começar', 1]]);
});

test('a troca: PED55 dá a pronta e recebe a por começar — volta a dever; PED66 recebe a pronta e não deve nada', async () => {
  const api = apiFalsa(tabelas());
  const o = await trocas.opcoes(api, 55);
  const pronta = estadoComRotulo(o.itens[0], 'Pronta');
  const porComecar = o.itens[0].candidatos[0].estados[0];
  const r = await trocas.trocar({ api, usuarioId: 3, entrada: { item_a: 501, chave_a: pronta.chave, item_b: 601, chave_b: porComecar.chave, quantidade: 1, motivo: 'O PED66 é mais urgente para o cliente' } });
  assert.equal(r.a.entrou, 'Por começar');
  assert.equal(r.a.volta_a_dever, true);
  assert.equal(r.b.entrou, 'Pronta');
  assert.equal(r.b.volta_a_dever, false);

  // A linha da troca: imutável, com o estado de cada lado.
  const linha = api.tabelas.trocas_pecas[0];
  assert.equal(linha.pedido_item_id_a, 501);
  assert.equal(linha.pedido_item_id_b, 601);
  assert.deepEqual(JSON.parse(linha.estado_a).restante, { 1: 0, 2: 0 });
  assert.deepEqual(JSON.parse(linha.estado_b).restante, { 1: 1, 2: 1 });
  assert.equal(linha.criado_por, 3);

  // Os estados depois: PED55 tem a da Marcenaria feita e a que chegou; PED66, a pronta.
  const depois = await trocas.opcoes(api, 55);
  assert.deepEqual(depois.itens[0].estados.map(e => [e.rotulo, e.quantidade]), [['Marcenaria feita', 1], ['Por começar', 1]]);
  const de66 = await trocas.opcoes(api, 66);
  assert.deepEqual(de66.itens[0].estados.map(e => [e.rotulo, e.quantidade]), [['Pronta', 1]]);
  assert.equal(depois.historico.length, 1);
  assert.equal(depois.historico[0].saiu, 'Pronta');
  assert.equal(depois.historico[0].entrou, 'Por começar');
  assert.equal(depois.historico[0].outro_pedido, 'PED66');

  // A história nos dois pedidos e no Financeiro.
  assert.deepEqual(api.tabelas.pedido_historico_eventos.map(e => [e.pedido_id, e.tipo_evento]), [[55, 'transferencia'], [66, 'transferencia']]);
  assert.match(api.tabelas.pedido_historico_eventos[0].descricao, /saiu 1 × POL-01 — Poltrona \(Pronta\) e entrou 1 × POL-01 — Poltrona \(Por começar\)/);
  assert.deepEqual(api.tabelas.financeiro_eventos.map(e => [e.tipo, e.pedido_id]), [['troca_pecas', 55], ['troca_pecas', 66]]);
});

test('produção depois da troca: o que já foi registrado vale como valia; o registro novo do PED55 paga a peça que chegou', async () => {
  const api = apiFalsa(tabelas());
  const o = await trocas.opcoes(api, 55);
  await trocas.trocar({ api, entrada: { item_a: 501, chave_a: estadoComRotulo(o.itens[0], 'Pronta').chave, item_b: 601, chave_b: o.itens[0].candidatos[0].estados[0].chave, quantidade: 1, motivo: 'O PED66 é mais urgente para o cliente' } });
  // Depois da troca, o PED55 registra a Marcenaria da peça que chegou.
  api.tabelas.producao_eventos.push(ev(3, 501, 55, 1, 1, '2099-10-10T10:00:00Z'));
  const base = await producao.lerBase(api);
  const valor = id => base.pend.find(l => String(l.evento_id) === String(id))?.total;
  assert.equal(valor(1), 600, 'a Marcenaria das duas, registrada antes, continua R$ 600');
  assert.equal(valor(2), 200);
  assert.equal(valor(3), 300, 'a peça que chegou por começar paga a Marcenaria inteira');
  // O PED66 recebeu a pronta: não tem nada pendente.
  const doPedido66 = await producao.doPedido(api, 66);
  assert.ok(doPedido66.itens[0].setores.every(s => s.saldo === 0), 'quem recebe a pronta não deve produção');
  const doPedido55 = await producao.doPedido(api, 55);
  const acab = doPedido55.itens[0].setores.find(s => s.setor_id === 2);
  assert.equal(acab.saldo, 2, 'o PED55 deve o Acabamento das duas que tem agora');
});

test('decisão do mês tomada ANTES da troca fica selada: confirmar a peça que chegou não estorna o que já foi pago', async () => {
  const confirmacao = require('./financeiro/producaoConfirmacao');
  const t = tabelas();
  // Setembro fechado (outubro pode ser confirmado) e uma poltrona por começar a mais no PED55.
  t.financeiro_fechamentos = [{ id: 1, tipo: 'producao', competencia: '2026-09', status: 'fechado', total: 0, por_setor: '[]', fechado_em: '2026-10-01T10:00:00Z' }];
  t.pedidos_itens[0].quantidade = 3;
  const api = apiFalsa(t);
  const HOJE = '2026-10-20';
  // O PED66 confirma a Marcenaria da poltrona dele em outubro.
  await confirmacao.confirmar({ api, competencia: '2026-10', pedidoId: 66, decisoes: [{ pedido_item_id: 601, etapa_id: 1, prontas: 1 }], usuarioId: 3, hoje: HOJE });
  const pago = api.tabelas.producao_eventos.find(e => e.pedido_id === 66 && e.etapa_id === 1 && e.status === 'ativo');
  assert.ok(pago, 'o registro da Marcenaria do PED66');

  // Depois, ele dá essa poltrona (Marcenaria feita) e recebe a por começar do PED55.
  const o = await trocas.opcoes(api, 66);
  const sai = estadoComRotulo(o.itens[0], 'Marcenaria feita');
  const vem = o.itens[0].candidatos[0].estados.find(e => e.rotulo === 'Por começar');
  await trocas.trocar({ api, usuarioId: 3, entrada: { item_a: 601, chave_a: sai.chave, item_b: 501, chave_b: vem.chave, quantidade: 1, motivo: 'O PED55 precisa da que já está adiantada' } });

  const card = (await confirmacao.lerPendencias(api, { competencia: '2026-10', hoje: HOJE, pedidoId: 66 })).pedidos[0];
  const marcenaria = card.pecas[0].processos.find(e => e.etapa_id === 1);
  assert.equal(marcenaria.saldo, 1, 'a poltrona que chegou deve a Marcenaria');
  assert.equal(marcenaria.decidido, null);
  assert.equal(marcenaria.decisao_selada, true);

  await confirmacao.confirmar({ api, competencia: '2026-10', pedidoId: 66, decisoes: [{ pedido_item_id: 601, etapa_id: 1, prontas: 1 }], usuarioId: 3, hoje: HOJE });
  const ativos = api.tabelas.producao_eventos.filter(e => e.pedido_id === 66 && e.etapa_id === 1 && e.status === 'ativo');
  assert.ok(ativos.includes(pago), 'o registro de antes da troca continua valendo');
  assert.equal(ativos.length, 2, 'e a poltrona que chegou ganhou o dela');
  const base = await producao.lerBase(api);
  const doPed66 = base.pend.filter(l => l.pedido_id === 66 && l.setor_id === 1);
  assert.equal(doPed66.reduce((s, l) => s + l.total, 0), 600, 'R$ 300 de cada poltrona');
});

test('recusas: motivo curto, produto diferente, mesmo estado, pedido que já saiu, estado que mudou, SQL pendente', async () => {
  const api = apiFalsa(tabelas());
  const o = await trocas.opcoes(api, 55);
  const pronta = estadoComRotulo(o.itens[0], 'Pronta').chave;
  const metade = estadoComRotulo(o.itens[0], 'Marcenaria feita').chave;
  const porComecar = o.itens[0].candidatos[0].estados[0].chave;
  const tentar = (entrada, a = api) => trocas.trocar({ api: a, entrada: { item_a: 501, chave_a: pronta, item_b: 601, chave_b: porComecar, quantidade: 1, motivo: 'Motivo suficiente aqui', ...entrada } });
  await assert.rejects(tentar({ motivo: 'curto' }), e => e.status === 422 && /ao menos 10 letras/.test(e.message));
  await assert.rejects(tentar({ item_b: 701 }), e => e.status === 422 && /mesmo produto/.test(e.message));
  await assert.rejects(tentar({ chave_b: 'não existe' }), e => e.status === 409 && /mudou/.test(e.message));
  await assert.rejects(tentar({ quantidade: 2 }), e => e.status === 409 && /Só há 1 peça/.test(e.message));
  // Mesmo estado dos dois lados: PED55 contra ele mesmo não vale; com outro pedido no mesmo estado, não muda nada.
  const iguais = apiFalsa(tabelas());
  iguais.tabelas.producao_eventos.push(ev(9, 601, 66, 1, 1, '2026-10-01T11:00:00Z'));
  const o2 = await trocas.opcoes(iguais, 55);
  await assert.rejects(trocas.trocar({ api: iguais, entrada: { item_a: 501, chave_a: metade, item_b: 601, chave_b: o2.itens[0].candidatos[0].estados[0].chave, quantidade: 1, motivo: 'Motivo suficiente aqui' } }),
    e => e.status === 422 && /mesmo estado/.test(e.message));
  const enviado = apiFalsa(tabelas({ situacao66: 'Enviado' }));
  await assert.rejects(tentar({}, enviado), e => e.status === 409 && /só troca peça o pedido que ainda não saiu/.test(e.message));
  const semSql = apiFalsa(tabelas({ semSql: true }));
  await assert.rejects(tentar({}, semSql), e => e.status === 409 && e.extra?.sql_pendente === true);
  assert.equal(api.tabelas.trocas_pecas.length, 0, 'nada foi gravado');
});

test('validação de entrada (pura)', () => {
  assert.throws(() => trocas.validar({ item_a: 1, item_b: 1, chave_a: 'x', chave_b: 'y', motivo: 'Motivo suficiente' }), /pedidos diferentes/);
  assert.throws(() => trocas.validar({ item_a: 1, item_b: 2, chave_a: '', chave_b: 'y', motivo: 'Motivo suficiente' }), /estado da peça/);
  assert.throws(() => trocas.validar({ item_a: 1, item_b: 2, chave_a: 'x', chave_b: 'y', quantidade: 0, motivo: 'Motivo suficiente' }), /quantas peças/);
  assert.equal(trocas.validar({ item_a: '1', item_b: '2', chave_a: 'x', chave_b: 'y', motivo: 'Motivo suficiente' }).quantidade, 1);
});
