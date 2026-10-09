/**
 * Peça AVULSA (pedido do dono, 09/10/2026): no cancelamento, "Continuar
 * produzindo" deixa a peça seguir em produção fora de pedido — sem voltar ao
 * estoque e sem devolver matéria-prima; ela aparece no Fechar competência e,
 * terminada, entra no estoque como peça pronta. "Devolver ao estoque" e
 * "Cancelar a produção" encerram a avulsa à mão.
 *
 * A poltrona: 3 passos de Marcenaria (R$ 300) e 2 de Acabamento (R$ 200).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { estornarCancelamento } = require('./cancelamentoEstorno');
const confirmacao = require('./financeiro/producaoConfirmacao');
const producao = require('./financeiro/producao');
const avulsas = require('./pecasAvulsas');
const trocas = require('./trocasPecas');

function apiFalsa(tabelas) {
  let proximo = 9000;
  const nome = caminho => String(caminho).replace(/^\/api\//, '').split('?')[0].split('/')[0];
  return {
    tabelas,
    async get(caminho, opcoes = {}) {
      const partes = String(caminho).replace(/^\/api\//, '').split('?')[0].split('/');
      const linhas = tabelas[partes[0]];
      if (!linhas) throw new Error(`relation "${partes[0]}" does not exist`);
      if (partes[1]) return linhas.find(l => String(l.id) === partes[1]) || null;
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
    async delete(caminho) {
      const partes = String(caminho).replace(/^\/api\//, '').split('/');
      const lista = tabelas[partes[0]] || [];
      const i = lista.findIndex(l => String(l.id) === partes[1]);
      if (i >= 0) lista.splice(i, 1);
      return {};
    }
  };
}

const ev = (id, itemId, pedidoId, etapaId, quantidade, criado_em) => ({
  id, pedido_id: pedidoId, pedido_item_id: itemId, produto_id: 10, etapa_id: etapaId, setor_id: null, quantidade,
  data_finalizacao: criado_em.slice(0, 10), competencia: criado_em.slice(0, 7), status: 'ativo', criado_em
});

function tabelas() {
  return {
    pedidos: [
      { id: 55, numero: 'PED55', situacao: 'Produção', cliente_id: 7 },
      { id: 66, numero: 'PED66', situacao: 'Produção', cliente_id: 8 }
    ],
    pedidos_itens: [
      { id: 501, pedido_id: 55, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona', quantidade: 2, qtd_a_produzir: 2, qtd_usar_pronta: 0 },
      { id: 601, pedido_id: 66, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona', quantidade: 1, qtd_a_produzir: 1, qtd_usar_pronta: 0 }
    ],
    pedido_itens_ext: [],
    reservas_estoque: [{ id: 1, pedido_id: 55, pedido_item_id: 501, quantidade: 2, status: 'producao' }],
    clientes: [{ id: 7, nome_fantasia: 'Pupê' }, { id: 8, nome_fantasia: 'Figo Casa' }],
    materia_prima: [
      { id: 301, nome: 'MDF', processo: 'Marcenaria' }, { id: 302, nome: 'Cola', processo: 'Marcenaria' }, { id: 303, nome: 'Parafuso', processo: 'Marcenaria' },
      { id: 304, nome: 'Seladora', processo: 'Acabamento' }, { id: 305, nome: 'Verniz', processo: 'Acabamento' }
    ],
    produtos_insumos: [301, 302, 303, 304, 305].map((insumo, i) => ({ id: 401 + i, produto_id: 10, insumo_id: insumo, quantidade: 1, ordem_insumo: i + 1 })),
    produtos_em_cada_ponto: [],
    estoque_movimentos: [],
    cancelamento_destinacoes: [],
    realocacoes: [],
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
    // Setembro fechado: outubro pode ser confirmado.
    financeiro_fechamentos: [{ id: 1, tipo: 'producao', competencia: '2026-09', status: 'fechado', total: 0, por_setor: '[]', fechado_em: '2026-10-01T10:00:00Z' }],
    financeiro_fechamento_itens: [],
    financeiro_pagamentos: [],
    financeiro_eventos: [],
    producao_confirmacoes: [],
    // As duas poltronas com a Marcenaria feita.
    producao_eventos: [ev(1, 501, 55, 1, 2, '2026-10-02T10:00:00Z')],
    pedido_historico_eventos: [],
    trocas_pecas: [],
    pecas_avulsas: []
  };
}

const GRUPO_DO_ZERO = { origem: 'producao', ordem_origem: 0, lote_id: null };
const HOJE = '2026-10-20';

/** O cancelamento como a rota faz: estorno, situação, produção do trecho e só então as avulsas. */
async function cancelar(api, acoes) {
  const entradas = [];
  const r = await estornarCancelamento(api, { pedidoId: 55, acoes, usuarioId: 3, registrarEntradaInsumo: async (insumo, quantidade) => entradas.push([insumo, quantidade]) });
  api.tabelas.pedidos.find(p => p.id === 55).situacao = 'Cancelado';
  const apurado = await confirmacao.confirmarCancelamento({ api, pedidoId: 55, data: HOJE, hoje: HOJE, usuarioId: 3, avulsas: r.avulsas });
  const criadas = await avulsas.criarDoCancelamento(api, { pedidoId: 55, avulsas: r.avulsas, usuarioId: 3 });
  return { r, entradas, apurado, criadas };
}

test('cancelar com "Continuar produzindo": nada volta ao estoque nem à matéria-prima pela avulsa; ela vira linha nova', async () => {
  const api = apiFalsa(tabelas());
  const { r, entradas, criadas } = await cancelar(api, [
    { item: 501, action: 'avulsa', quantity: 1, ordem: 3, grupo: GRUPO_DO_ZERO },
    { item: 501, action: 'stock', quantity: 1, ordem: 3, grupo: GRUPO_DO_ZERO }
  ]);
  assert.equal(r.resumo.pecasAvulsas, 1);
  assert.equal(r.avulsas.length, 1);
  assert.equal(r.avulsas[0].ordemDestino, 3);
  // Só a que voltou ao estoque devolveu o Acabamento (passos 4 e 5) à matéria-prima.
  assert.deepEqual(entradas.sort(), [[304, 1], [305, 1]]);
  assert.equal(api.tabelas.produtos_em_cada_ponto.reduce((s, l) => s + Number(l.quantidade), 0), 1, 'só uma peça entrou no estoque');
  assert.equal(criadas.criadas.length, 1);
  const linha = api.tabelas.pecas_avulsas[0];
  assert.equal(linha.status, 'em_producao');
  assert.deepEqual(JSON.parse(linha.estado_inicio).restante, { 1: 0, 2: 1 }, 'Marcenaria feita, Acabamento inteiro por fazer');
  assert.ok(api.tabelas.pedido_historico_eventos.some(e => /segue em produção como avulsa/.test(e.descricao)));
});

test('"Continuar produzindo" numa peça já pronta: não vira avulsa, entra no estoque (com o aviso)', async () => {
  const api = apiFalsa(tabelas());
  const { r, entradas, criadas } = await cancelar(api, [
    { item: 501, action: 'avulsa', quantity: 2, ordem: 5, grupo: GRUPO_DO_ZERO }
  ]);
  assert.equal(r.avulsas.length, 0);
  assert.equal(r.resumo.pecasAvulsas, 0);
  assert.ok(r.avisos.some(a => /já estava pronta: entrou no estoque/.test(a)), r.avisos.join(' | '));
  assert.equal(api.tabelas.produtos_em_cada_ponto.reduce((s, l) => s + Number(l.quantidade), 0), 2);
  assert.deepEqual(entradas, [], 'peça pronta não devolve matéria-prima');
  assert.equal(criadas.criadas.length, 0);
  assert.equal(api.tabelas.pecas_avulsas.length, 0);
});

test('a avulsa no Fechar competência: card próprio, só o que falta nela; confirmada, entra no estoque pronta', async () => {
  const api = apiFalsa(tabelas());
  await cancelar(api, [
    { item: 501, action: 'avulsa', quantity: 1, ordem: 3, grupo: GRUPO_DO_ZERO },
    { item: 501, action: 'discard', quantity: 1, ordem: 3, grupo: GRUPO_DO_ZERO }
  ]);
  const pend = await confirmacao.lerPendencias(api, { competencia: '2026-10', hoje: HOJE });
  const card = pend.pedidos.find(p => p.pedido_id === 55);
  assert.ok(card, 'o pedido cancelado aparece pela avulsa');
  assert.equal(card.avulsa, true);
  assert.equal(card.avulsas.length, 1);
  const processos = card.pecas[0].processos.map(e => [e.nome, e.saldo]);
  assert.deepEqual(processos, [['Acabamento', 1]], 'só o Acabamento da avulsa; a outra unidade ganhou destino no cancelamento');

  const r = await confirmacao.confirmar({ api, competencia: '2026-10', pedidoId: 55, decisoes: [{ pedido_item_id: 501, etapa_id: 2, prontas: 1 }], usuarioId: 3, hoje: HOJE });
  assert.deepEqual(r.avisos, ['A peça avulsa ficou pronta e entrou no estoque.']);
  assert.equal(api.tabelas.pecas_avulsas[0].status, 'no_estoque', 'terminada, ela entra no estoque');
  const encerramento = JSON.parse(api.tabelas.pecas_avulsas[0].encerramento);
  assert.equal(encerramento.tipo, 'pronta');
  assert.equal(encerramento.ordem, 5);
  const lote = api.tabelas.produtos_em_cada_ponto.find(l => Number(l.quantidade) > 0);
  assert.ok(lote, 'há um lote com a peça pronta');
  // A produção da avulsa é paga: o Acabamento dela vale R$ 200.
  const base = await producao.lerBase(api);
  const doAcabamento = base.pend.filter(l => l.pedido_item_id === 501 && l.setor_id === 2);
  assert.equal(doAcabamento.reduce((s, l) => s + l.total, 0), 200);
  // E o card não volta mais.
  const depois = await confirmacao.lerPendencias(api, { competencia: '2026-10', hoje: HOJE });
  assert.ok(!depois.pedidos.some(p => p.pedido_id === 55));
});

test('decisão do cancelamento no mesmo processo fica SELADA: confirmar a avulsa no mesmo mês não estorna o que o cancelamento pagou', async () => {
  const t = tabelas();
  t.pedidos_itens[0].quantidade = 3;
  t.pedidos_itens[0].qtd_a_produzir = 3;
  t.producao_eventos = [ev(1, 501, 55, 1, 3, '2026-10-02T10:00:00Z')];
  const api = apiFalsa(t);
  // Duas voltam PRONTAS ao estoque (o cancelamento paga o Acabamento delas) e uma segue avulsa.
  await cancelar(api, [
    { item: 501, action: 'stock', quantity: 2, ordem: 5, grupo: GRUPO_DO_ZERO },
    { item: 501, action: 'avulsa', quantity: 1, ordem: 3, grupo: GRUPO_DO_ZERO }
  ]);
  const doCancelamento = api.tabelas.producao_eventos.filter(e => e.etapa_id === 2 && e.status === 'ativo');
  assert.equal(doCancelamento.reduce((s, e) => s + Number(e.quantidade), 0), 2, 'o Acabamento das duas prontas, pago no cancelamento');
  assert.ok(api.tabelas.producao_confirmacoes.some(x => x.etapa_id === 2 && x.origem === 'cancelamento'));

  const card = (await confirmacao.lerPendencias(api, { competencia: '2026-10', hoje: HOJE })).pedidos.find(p => p.pedido_id === 55);
  const acabamento = card.pecas[0].processos.find(e => e.etapa_id === 2);
  assert.equal(acabamento.saldo, 1);
  assert.equal(acabamento.decidido, null, 'a decisão do cancelamento é das outras unidades');
  assert.equal(acabamento.decisao_selada, true);
  assert.equal(card.confirmado, false, 'a avulsa ainda está a decidir');

  await confirmacao.confirmar({ api, competencia: '2026-10', pedidoId: 55, decisoes: [{ pedido_item_id: 501, etapa_id: 2, prontas: 1 }], usuarioId: 3, hoje: HOJE });
  const ativos = api.tabelas.producao_eventos.filter(e => e.etapa_id === 2 && e.status === 'ativo');
  assert.ok(doCancelamento.every(e => ativos.includes(e)), 'o registro do cancelamento continua valendo');
  assert.equal(ativos.reduce((s, e) => s + Number(e.quantidade), 0), 3, '2 do cancelamento + 1 da avulsa');
  const base = await producao.lerBase(api);
  const doAcabamento = base.pend.filter(l => l.pedido_item_id === 501 && l.setor_id === 2);
  assert.equal(doAcabamento.reduce((s, l) => s + l.total, 0), 600, 'R$ 200 × 3 unidades');
  assert.equal(api.tabelas.pecas_avulsas[0].status, 'no_estoque');
});

test('encerrar à mão: devolver ao estoque num ponto (não antes de onde entrou) e cancelar a produção', async () => {
  const api = apiFalsa(tabelas());
  const entradas = [];
  await cancelar(api, [{ item: 501, action: 'avulsa', quantity: 2, ordem: 3, grupo: GRUPO_DO_ZERO }]);
  const [primeira, segunda] = api.tabelas.pecas_avulsas;
  await assert.rejects(avulsas.encerrar({ api, avulsaId: primeira.id, entrada: { tipo: 'estoque', ordem: 4, motivo: 'curto' } }), /ao menos 10 letras/);
  const r = await avulsas.encerrar({ api, avulsaId: primeira.id, entrada: { tipo: 'estoque', ordem: 4, motivo: 'O cliente novo vai usar mais tarde' }, registrarEntradaInsumo: async (i, q) => entradas.push([i, q]) });
  assert.equal(r.avulsa.status, 'no_estoque');
  assert.deepEqual(entradas, [[305, 1]], 'volta só o passo 5 (ela foi ao estoque no 4)');
  await assert.rejects(avulsas.encerrar({ api, avulsaId: primeira.id, entrada: { tipo: 'estoque', motivo: 'De novo, não pode mais' } }), e => e.status === 409);
  entradas.length = 0;
  const d = await avulsas.encerrar({ api, avulsaId: segunda.id, entrada: { tipo: 'descarte', ordem: 3, motivo: 'A peça rachou na marcenaria' }, registrarEntradaInsumo: async (i, q) => entradas.push([i, q]) });
  assert.equal(d.avulsa.status, 'descartada');
  assert.deepEqual(entradas.sort(), [[304, 1], [305, 1]], 'o Acabamento que ela não vai usar volta à matéria-prima');
  // Encerradas, a produção não deve mais nada por elas.
  const pend = await confirmacao.lerPendencias(api, { competencia: '2026-10', hoje: HOJE });
  assert.ok(!pend.pedidos.some(p => p.pedido_id === 55));
});

test('a avulsa substitui a peça de um pedido: ela vai para o PED66 e a peça de lá vira a avulsa', async () => {
  const api = apiFalsa(tabelas());
  await cancelar(api, [
    { item: 501, action: 'avulsa', quantity: 1, ordem: 3, grupo: GRUPO_DO_ZERO },
    { item: 501, action: 'discard', quantity: 1, ordem: 3, grupo: GRUPO_DO_ZERO }
  ]);
  // Do PED66, a avulsa aparece como opção para a poltrona.
  const o = await trocas.opcoes(api, 66);
  const cand = o.itens[0].candidatos.find(x => x.tipo === 'avulsa');
  assert.ok(cand, 'a avulsa é candidata');
  assert.match(cand.numero, /Peça avulsa \(PED55 cancelado\)/);
  assert.deepEqual(cand.estados.map(e => [e.rotulo, e.quantidade]), [['Marcenaria feita', 1]]);
  await trocas.trocar({ api, entrada: { item_a: 601, chave_a: o.itens[0].estados[0].chave, item_b: 501, chave_b: cand.estados[0].chave, quantidade: 1, motivo: 'A avulsa já estava com a marcenaria pronta' } });
  // A avulsa antiga ficou trocada; a peça do PED66 (por começar) é a avulsa agora.
  const [antiga, nova] = api.tabelas.pecas_avulsas;
  assert.equal(antiga.status, 'trocada');
  assert.equal(nova.status, 'em_producao');
  assert.equal(nova.origem, 'troca');
  assert.deepEqual(JSON.parse(nova.estado_inicio).restante, { 1: 1, 2: 1 });
  // O PED66 deve só o Acabamento (a Marcenaria chegou feita: nem aparece); a avulsa deve a peça inteira.
  const de66 = await producao.doPedido(api, 66);
  assert.deepEqual(de66.itens[0].setores.map(s => [s.setor_id, s.saldo]), [[2, 1]]);
  const pend = await confirmacao.lerPendencias(api, { competencia: '2026-10', hoje: HOJE });
  const card = pend.pedidos.find(p => p.pedido_id === 55);
  assert.deepEqual(card.pecas[0].processos.map(e => [e.nome, e.saldo]), [['Marcenaria', 1], ['Acabamento', 1]]);
});
