/**
 * Editar as peças de um pedido em Produção (backend/pedidoEdicao.js, 14/10/2026),
 * com uma API de mentira em memória.
 *
 * O cenário é o do PED121: duas linhas da mesma peça ("Caixa Rio") vindas da
 * IA. A rota da Caixa Rio tem 3 passos de Marcenaria (MDF, Cola, Parafuso) e 2
 * de Acabamento (Seladora, Verniz — o Verniz é infinito: a conversão não o
 * abate, e a edição não o devolve).
 *
 *   linha 501: 2 caixas — 1 pronta do estoque (lote 801) + 1 do zero, que já
 *              teve a Marcenaria registrada (02/10)
 *   linha 502: 2 caixas do zero, por começar
 *
 * O que trava:
 *   - a ordem de retirada (do zero, as menos adiantadas antes; depois as pela
 *     metade; as prontas do estoque por último) e as travas do pedido;
 *   - juntar as duas linhas não mexe no estoque nem na matéria-prima, e a
 *     produção vê as unidades mudarem de linha sem pagar nada de novo;
 *   - tirar a caixa com a Marcenaria feita: ela volta ao estoque nesse ponto,
 *     só a Seladora volta à matéria-prima e o registro da Marcenaria continua
 *     valendo o que valia;
 *   - pôr uma peça nova: linha nova, reserva de produção, matéria-prima
 *     abatida, preço da tabela e as parcelas iguais de novo;
 *   - a assinatura da revisão e o SQL que falta.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// A matéria-prima e o cache de lotes de verdade falam com o banco: aqui não.
const saidasDeInsumo = [];
function falso(relativo, exports) {
  const caminho = require.resolve(relativo);
  require.cache[caminho] = new Module(caminho, null);
  require.cache[caminho].filename = caminho;
  require.cache[caminho].loaded = true;
  require.cache[caminho].exports = exports;
}
falso('./materiaPrima', {
  registrarSaida: async (id, quantidade) => { saidasDeInsumo.push([Number(id), Number(quantidade)]); },
  registrarEntrada: async () => { throw new Error('a edição recebe a entrada injetada no teste'); }
});
falso('./produtos', { invalidarCacheLotes: () => {} });
for (const m of ['./conversaoAplicar', './pedidoEdicao']) delete require.cache[require.resolve(m)];

const edicao = require('./pedidoEdicao');
const producao = require('./financeiro/producao');
const unidades = require('./financeiro/producaoUnidades');

function apiFalsa(tabelas) {
  let proximo = 9000;
  const partes = caminho => String(caminho).replace(/^\/api\//, '').split('?')[0].split('/');
  return {
    tabelas,
    async get(caminho, opcoes = {}) {
      const [t, id] = partes(caminho);
      const linhas = tabelas[t];
      if (!linhas) throw new Error(`relation "${t}" does not exist`);
      if (id) return linhas.find(l => String(l.id) === id) || null;
      const query = opcoes.query || {};
      return linhas.filter(l => Object.entries(query)
        .filter(([campo]) => !['select', 'order', 'limit'].includes(campo))
        .every(([campo, valor]) => String(l[campo]) === String(valor)));
    },
    async post(caminho, corpo) {
      const [t] = partes(caminho);
      if (!tabelas[t]) throw new Error(`relation "${t}" does not exist`);
      if (corpo.id !== undefined && tabelas[t].some(l => String(l.id) === String(corpo.id))) {
        const e = new Error('duplicate key value violates unique constraint'); e.status = 409; throw e;
      }
      const linha = { id: (proximo += 1), ...corpo };
      tabelas[t].push(linha);
      return linha;
    },
    async put(caminho, corpo) {
      const [t, id] = partes(caminho);
      const linha = (tabelas[t] || []).find(l => String(l.id) === id);
      if (!linha) throw new Error(`${t}/${id} não existe`);
      Object.assign(linha, corpo);
      return linha;
    },
    async delete(caminho) {
      const [t, id] = partes(caminho);
      const lista = tabelas[t] || [];
      const i = lista.findIndex(l => String(l.id) === id);
      if (i >= 0) lista.splice(i, 1);
      return {};
    }
  };
}

const ev = (id, itemId, etapaId, quantidade, criado_em) => ({
  id, pedido_id: 55, pedido_item_id: itemId, produto_id: 10, etapa_id: etapaId, setor_id: null, quantidade,
  data_finalizacao: criado_em.slice(0, 10), competencia: criado_em.slice(0, 7), status: 'ativo', criado_em
});

const linhaDoItem = (id, quantidade, extra = {}) => ({
  id, pedido_id: 55, produto_id: 10, codigo: 'CXR-P', nome: 'Caixa Rio - P', ncm: '94036000', quantidade,
  valor_unitario: 1000, valor_unitario_desc: 950, desconto_pagamento: 50, desconto_pagamento_prc: 5, desconto_especial: 0, desconto_especial_prc: 0,
  valor_desc: 50, desconto_total: 50 * quantidade, valor_total: 950 * quantidade, ...extra
});

function tabelas() {
  return {
    pedidos: [{ id: 55, numero: 'PED55', situacao: 'Produção', cliente_id: 7, parcelas: 3, prazo: '28/42/56', valor_final: 3800, desconto_total: 200, ajuste_valor: null }],
    pedidos_itens: [
      linhaDoItem(501, 2, { qtd_usar_pronta: 1, qtd_a_produzir: 1 }),
      linhaDoItem(502, 2, { qtd_usar_pronta: 0, qtd_a_produzir: 2 })
    ],
    pedido_parcelas: [
      { id: 1, pedido_id: 55, numero_parcela: 1, valor: 1266.67, data_vencimento: '2026-12-21' },
      { id: 2, pedido_id: 55, numero_parcela: 2, valor: 1266.67, data_vencimento: '2027-01-04' },
      { id: 3, pedido_id: 55, numero_parcela: 3, valor: 1266.66, data_vencimento: '2027-01-18' }
    ],
    // A caixa pronta da linha 501 saiu do lote 801 (fim da rota: passo 405).
    pedido_itens_ext: [{ id: 701, id_pedido: 55, pedido_item_id: 501, ultimo_insumo_id: 405, etapa_id: 801, quantidade: 1 }],
    reservas_estoque: [
      { id: 1, pedido_id: 55, pedido_item_id: 501, item_id: 10, quantidade: 1, quantidade_original: 1, status: 'producao' },
      { id: 2, pedido_id: 55, pedido_item_id: 502, item_id: 10, quantidade: 2, quantidade_original: 2, status: 'producao' }
    ],
    pedidos_itens_faltantes: [{ id: 1, pedido_id: 55, pedido_item_id: 502, insumo_id: 301, quantidade: 2 }],
    notas_fiscais: [], notas_fiscais_externas: [], boletos: [], recebimentos: [], boletos_externos: [], ordens_pagamento: [],
    clientes: [{ id: 7, nome_fantasia: 'Vetri' }],
    materia_prima: [
      { id: 301, nome: 'MDF', processo: 'Marcenaria', unidade: 'm²', quantidade: 100 },
      { id: 302, nome: 'Cola', processo: 'Marcenaria', unidade: 'kg', quantidade: 100 },
      { id: 303, nome: 'Parafuso', processo: 'Marcenaria', unidade: 'un', quantidade: 100 },
      { id: 304, nome: 'Seladora', processo: 'Acabamento', unidade: 'l', quantidade: 100 },
      { id: 305, nome: 'Verniz', processo: 'Acabamento', unidade: 'l', quantidade: 0, infinito: true },
      { id: 306, nome: 'Freijó', processo: 'Marcenaria', unidade: 'm²', quantidade: 50 },
      { id: 307, nome: 'Cera', processo: 'Acabamento', unidade: 'kg', quantidade: 50 }
    ],
    produtos_insumos: [
      ...[301, 302, 303, 304, 305].map((insumo, i) => ({ id: 401 + i, produto_id: 10, insumo_id: insumo, quantidade: 1, ordem_insumo: i + 1 })),
      { id: 411, produto_id: 20, insumo_id: 306, quantidade: 2, ordem_insumo: 1 },
      { id: 412, produto_id: 20, insumo_id: 307, quantidade: 1, ordem_insumo: 2 }
    ],
    produtos: [
      { id: 10, codigo: 'CXR-P', nome: 'Caixa Rio - P', ncm: '94036000' },
      { id: 20, codigo: 'BLV-U', nome: 'Bandeja La Vie', ncm: '94036000' }
    ],
    tabela_fixa: [{ id_prod: 10, cod_prod: 'CXR-P', vlr_prod: '1000.00' }, { id_prod: 20, cod_prod: 'BLV-U', vlr_prod: '500,00' }],
    produtos_em_cada_ponto: [{ id: 801, produto_id: 10, ultimo_insumo_id: 305, etapa_id: 'Acabamento', quantidade: 0 }],
    estoque_movimentos: [],
    pedido_historico_eventos: [],
    financeiro_eventos: [],
    pedido_edicoes: [],
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
    producao_confirmacoes: [],
    // A caixa do zero da linha 501 já teve a Marcenaria registrada.
    producao_eventos: [ev(1, 501, 1, 1, '2026-10-02T10:00:00Z')],
    trocas_pecas: [],
    pecas_avulsas: []
  };
}

function montar(t = tabelas()) {
  const api = apiFalsa(t);
  const entradas = [];
  const registrarEntradaInsumo = async (insumo, quantidade, _u, contexto) => entradas.push([Number(insumo), Number(quantidade), contexto?.nota || null]);
  return {
    api, entradas,
    simular: entrada => edicao.montar(api, 55, entrada).then(edicao.previa),
    aplicar: async (entrada) => {
      const p = await edicao.montar(api, 55, entrada);
      return edicao.aplicar(api, { pedidoId: 55, entrada: { motivo: 'Linhas repetidas vindas da IA', ...entrada, assinatura: edicao.assinar({ pedido: p.lidos.pedido, linhas: p.plano.linhas, totais: p.plano.totais, parcelas: p.plano.parcelas }) }, usuarioId: 3, registrarEntradaInsumo });
    }
  };
}

/** Quanto do processo o registro `id` vale agora, pelo motor da produção (com as mudanças). */
async function fracaoDoRegistro(api, itemId, etapaId, eventoId) {
  const itens = await producao.itensDe(api, [55]);
  const etapasPor = new Map(api.tabelas.etapas_producao.map(e => [String(e.id), e]));
  const { filaDe, mudancasDe } = await producao.montarFilas(api, { itens, etapasPor });
  const eventos = api.tabelas.producao_eventos.filter(e => String(e.pedido_item_id) === String(itemId) && String(e.etapa_id) === String(etapaId));
  const al = unidades.alocarComMudancas({ fila: filaDe(itemId, etapaId), eventos, mudancas: mudancasDe(itemId, etapaId) });
  return { fracao: al.porEvento.get(String(eventoId))?.fracao ?? 0, pedida: al.pedida, pendentes: al.pendentes };
}

// ===================================================================== puras

test('quem edita: só os dois e-mails do dono, sem diferença de maiúscula', () => {
  assert.equal(edicao.ehEditor({ email: 'henrique.abade@santissimodecor.com.br' }), true);
  assert.equal(edicao.ehEditor({ email: ' Henrique.VAbade@gmail.com ' }), true);
  assert.equal(edicao.ehEditor({ email: 'vendas@santissimodecor.com.br', perfil: 'Sup Admin' }), false, 'nem outro Sup Admin');
  assert.equal(edicao.ehEditor(null), false);
});

test('DEV isolado (VPS): a conta do dono sanitizada edita lá, e só lá', () => {
  assert.equal(edicao.ehEditor({ email: 'dono@exemplo.invalid' }, true), true);
  assert.equal(edicao.ehEditor({ email: 'dono.13@exemplo.invalid' }, true), true);
  assert.equal(edicao.ehEditor({ email: 'usuario.4@exemplo.invalid' }, true), false);
  assert.equal(edicao.ehEditor({ email: 'dono@exemplo.invalid' }, false), false, 'fora da máquina isolada não vale');
  assert.equal(edicao.ehEditor({ email: 'dono@exemplo.invalid' }), false, 'nos testes não há máquina isolada');
});

test('as travas: só Produção; NF-e viva, NF-e de fora e parcela travada impedem', () => {
  const pedido = { situacao: 'Produção' };
  assert.deepEqual(edicao.motivosDoBloqueio({ pedido }), []);
  assert.match(edicao.motivosDoBloqueio({ pedido: { situacao: 'Aprovado' } })[0], /só dá para editar .* em Produção/);
  assert.match(edicao.motivosDoBloqueio({ pedido, notas: [{ status_fiscal: 'autorizada', serie: 1, numero: 367 }] })[0], /NF-e 1\/367 \(autorizada\)/);
  assert.deepEqual(edicao.motivosDoBloqueio({ pedido, notas: [{ status_fiscal: 'rejeitada' }, { status_fiscal: 'cancelada' }] }), [], 'rejeitada e cancelada não contam');
  assert.match(edicao.motivosDoBloqueio({ pedido, externas: [{ ativo: true }] })[0], /NF-e de fora/);
  assert.match(edicao.motivosDoBloqueio({ pedido, travas: new Map([[2, { texto: 'boleto do BB registrado' }]]) })[0], /2ª parcela está travada \(boleto do BB registrado\)/);
});

test('ordem de retirada: do zero (as menos adiantadas antes), depois as pela metade, as prontas do estoque por último', () => {
  const u = (origem, pronta, ordem_origem, ordem_atual, nome) => ({ origem, pronta, ordem_origem, ordem_atual, nome });
  const ficar = edicao.ordenarParaFicar([
    u('producao', false, 0, 0, 'zero parado'), u('estoque', true, 5, 5, 'pronta'), u('producao', false, 0, 3, 'zero na Marcenaria'), u('estoque', false, 2, 2, 'metade')
  ]).map(x => x.nome);
  assert.deepEqual(ficar, ['pronta', 'metade', 'zero na Marcenaria', 'zero parado']);
});

test('as unidades da linha: origem e estado na mesma ordem; o ponto atual nunca antes da origem', () => {
  const rota = [1, 2, 3, 4, 5].map(o => ({ passo_id: 400 + o, insumo_id: 300 + o, ordem: o, processo: o <= 3 ? 'Marcenaria' : 'Acabamento', por_unidade: 1 }));
  const us = edicao.unidadesDoItem({
    item: { id: 501, quantidade: 3 },
    ext: [{ id: 701, ultimo_insumo_id: 405, etapa_id: 801, quantidade: 1 }, { id: 702, ultimo_insumo_id: 402, etapa_id: 802, quantidade: 1 }],
    rota,
    estados: [{ quantidade: 1, ordem: 5, rotulo: 'Pronta', restante: {} }, { quantidade: 1, ordem: 1, rotulo: 'Marcenaria 33%', restante: { 1: 0.33 } }, { quantidade: 1, ordem: 0, rotulo: 'Por começar', restante: { 1: 1 } }]
  });
  assert.deepEqual(us.map(x => [x.origem, x.ordem_origem, x.ordem_atual, x.ext_id]), [['estoque', 5, 5, 701], ['estoque', 2, 2, 702], ['producao', 0, 0, null]]);
  assert.equal(edicao.partesIguais(22230.56, 3).join(' '), '7410.19 7410.19 7410.18', 'como o splitEqual do orçamento');
  assert.equal(edicao.precoDaTabela({ preco_tabela: '1.860,39' }), 1860.39);
  assert.equal(edicao.precoDaTabela({ preco_tabela: null }), null);
});

test('peça nova usa a tabela fixa e acumula somente os descontos padrão de quantidade e pagamento', () => {
  const produto = { preco_tabela: '1.242,42', preco_venda: 9999 };
  const casos = [
    { quantidade: 1, condicao: 'prazo', percentual: 0, total: 1242.42 },
    { quantidade: 2, condicao: 'prazo', percentual: 5, total: 2360.598 },
    { quantidade: 1, condicao: 'vista', percentual: 5, total: 1180.299 },
    { quantidade: 2, condicao: 'vista', percentual: 10, total: 2236.356 }
  ];
  for (const c of casos) {
    const valores = edicao.valoresDaLinha({ produto, ...c });
    assert.equal(valores.valor_unitario, 1242.42, 'o preço calculado da peça não substitui a tabela fixa');
    assert.equal(valores.desconto_pagamento_prc, c.percentual, `${c.quantidade} un. ${c.condicao}`);
    assert.equal(valores.desconto_especial_prc, 0);
    assert.ok(Math.abs(valores.valor_total - c.total) < 0.000001);
  }
});

test('mudar a quantidade mantém o especial e substitui o padrão, sem acumular o desconto anterior', () => {
  const produto = { preco_tabela: 1000 };
  const aPrazo = linhaDoItem(501, 2, { desconto_pagamento_prc: 5, desconto_especial_prc: 3 });
  const uma = edicao.valoresDaLinha({ item: aPrazo, produto, quantidade: 1, condicao: 'prazo' });
  assert.deepEqual([uma.desconto_pagamento_prc, uma.desconto_especial_prc, uma.valor_total], [0, 3, 970]);
  const duas = edicao.valoresDaLinha({ item: { ...aPrazo, ...uma, quantidade: 1 }, produto, quantidade: 2, condicao: 'prazo' });
  assert.deepEqual([duas.desconto_pagamento_prc, duas.desconto_especial_prc, duas.valor_total], [5, 3, 1840]);
  const tres = edicao.valoresDaLinha({ item: { ...aPrazo, ...duas }, produto, quantidade: 3, condicao: 'prazo' });
  assert.deepEqual([tres.desconto_pagamento_prc, tres.desconto_especial_prc, tres.valor_total], [5, 3, 2760]);
  const aVista = edicao.valoresDaLinha({ item: { ...aPrazo, desconto_pagamento_prc: 10 }, produto, quantidade: 1, condicao: 'vista' });
  assert.deepEqual([aVista.desconto_pagamento_prc, aVista.desconto_especial_prc, aVista.valor_total], [5, 3, 920]);
});

// =================================================================== ponta a ponta

test('situação e revisão levam preço atual, percentuais e unitários sem arredondar antes de multiplicar', async () => {
  const dados = tabelas();
  Object.assign(dados.pedidos_itens[0], { valor_unitario: 1000.1234, valor_unitario_desc: 950.11723 });
  dados.tabela_fixa[0].vlr_prod = '1130.5678';
  const t = montar(dados);
  const situacao = await edicao.situacao(t.api, 55);
  const atual = situacao.linhas.find(l => l.item_id === 501);
  assert.equal(atual.valor_unitario, 1000.1234);
  assert.equal(atual.valor_unitario_desc, 950.11723);
  assert.equal(atual.valor_total, 1900, 'mantém o valor original enquanto a linha não foi alterada');
  assert.equal(atual.preco_tabela, 1130.5678);
  assert.deepEqual([atual.desconto_pagamento_prc, atual.desconto_especial_prc], [5, 0]);

  const revisao = await t.simular({ linhas: [{ item_id: 501, quantidade: 3 }] });
  const alterada = revisao.linhas.find(l => l.item_id === 501);
  assert.equal(alterada.valor_unitario, 1130.5678);
  assert.ok(Math.abs(alterada.valor_unitario_desc - 1074.03941) < 0.000001);
  assert.equal(alterada.valor_total, 3222.12);
  assert.equal(alterada.desconto_total, 169.59);
  assert.deepEqual([alterada.desconto_pagamento_prc, alterada.desconto_especial_prc], [5, 0]);
  assert.match(revisao.avisos[0], /o preço da tabela mudou/);
});

test('sem preço fixo a situação sinaliza null e a edição recusa nova peça mesmo que haja preço calculado', async () => {
  const dados = tabelas();
  dados.tabela_fixa = [];
  dados.produtos[1].preco_venda = 500;
  const t = montar(dados);
  const situacao = await edicao.situacao(t.api, 55);
  assert.ok(situacao.linhas.every(l => l.preco_tabela === null));
  await assert.rejects(t.simular({ linhas: [{ produto_id: 20, quantidade: 2 }] }), /não tem preço na tabela fixa/);
});

test('trocar uma linha por duas peças a prazo mostra e grava tabela fixa com 5% de quantidade', async () => {
  const dados = tabelas();
  dados.tabela_fixa[1].vlr_prod = '1.242,42';
  const t = montar(dados);
  const entrada = {
    linhas: [{ item_id: 502, quantidade: 0 }, { produto_id: 20, quantidade: 2 }],
    decisoes: [{ produto_id: 20, qtd_usar_pronta: 0, qtd_a_produzir: 2 }]
  };
  const revisao = await t.simular(entrada);
  const nova = revisao.linhas.find(l => l.produto_id === 20);
  assert.deepEqual([nova.valor_unitario, nova.desconto_pagamento_prc, nova.desconto_especial_prc], [1242.42, 5, 0]);
  assert.deepEqual([nova.desconto_total, nova.valor_total], [124.24, 2360.60]);
  assert.equal(revisao.valores.depois.valor_final, 4260.60);
  await t.aplicar(entrada);
  const gravada = t.api.tabelas.pedidos_itens.find(i => i.produto_id === 20);
  assert.equal(gravada.valor_unitario, 1242.42);
  assert.equal(gravada.desconto_pagamento_prc, 5);
  assert.ok(Math.abs(gravada.valor_total - 2360.598) < 0.000001);
  assert.equal(t.api.tabelas.pedidos[0].valor_final, 4260.60);
  assert.deepEqual(t.api.tabelas.pedido_parcelas.map(p => p.valor), [1420.20, 1420.20, 1420.20]);
});

test('adicionar e depois alterar peça à vista preserva o desconto do pagamento e aplica ajuste uma única vez', async () => {
  const dados = tabelas();
  Object.assign(dados.pedidos[0], { parcelas: 1, ajuste_valor: -123.45, valor_final: 3476.55, desconto_total: 400 });
  for (const i of dados.pedidos_itens) Object.assign(i, {
    valor_unitario_desc: 900, desconto_pagamento: 100, desconto_pagamento_prc: 10,
    valor_desc: 100, desconto_total: 200, valor_total: 1800
  });
  dados.pedido_parcelas = [{ id: 1, pedido_id: 55, numero_parcela: 1, valor: 3476.55, data_vencimento: '2026-12-21' }];
  const t = montar(dados);
  const entrada = { linhas: [{ produto_id: 20, quantidade: 2 }], decisoes: [{ produto_id: 20, qtd_usar_pronta: 0, qtd_a_produzir: 2 }] };
  const revisao = await t.simular(entrada);
  const novaNaRevisao = revisao.linhas.find(l => l.produto_id === 20);
  assert.deepEqual([novaNaRevisao.desconto_pagamento_prc, novaNaRevisao.desconto_especial_prc, novaNaRevisao.valor_total], [10, 0, 900]);
  assert.equal(revisao.valores.depois.valor_final, 4376.55);
  assert.equal(revisao.valores.depois.ajuste, -123.45);
  await t.aplicar(entrada);
  const nova = t.api.tabelas.pedidos_itens.find(i => i.produto_id === 20);
  assert.deepEqual([nova.valor_unitario, nova.desconto_pagamento_prc, nova.valor_total], [500, 10, 900]);
  assert.equal(t.api.tabelas.pedidos[0].ajuste_valor, -123.45);
  assert.equal(t.api.tabelas.pedido_parcelas[0].valor, 4376.55);

  await t.aplicar({ linhas: [{ item_id: nova.id, quantidade: 3 }], decisoes: [{ produto_id: 20, qtd_usar_pronta: 0, qtd_a_produzir: 1 }] });
  assert.deepEqual([nova.quantidade, nova.desconto_pagamento_prc, nova.valor_total], [3, 10, 1350]);
  assert.equal(t.api.tabelas.pedidos[0].valor_final, 4826.55);
  assert.equal(t.api.tabelas.pedidos[0].ajuste_valor, -123.45);
  assert.equal(t.api.tabelas.pedido_parcelas[0].valor, 4826.55);
});

test('juntar duas linhas unitárias aplica o desconto de quantidade na linha resultante', async () => {
  const dados = tabelas();
  for (const i of dados.pedidos_itens) Object.assign(i, {
    quantidade: 1, valor_unitario_desc: 1000, desconto_pagamento: 0, desconto_pagamento_prc: 0,
    valor_desc: 0, desconto_total: 0, valor_total: 1000
  });
  const t = montar(dados);
  const entrada = { linhas: [{ item_id: 501, quantidade: 2 }, { item_id: 502, juntar_em: 501 }] };
  const revisao = await t.simular(entrada);
  const resultante = revisao.linhas.find(l => l.item_id === 501);
  assert.deepEqual([resultante.quantidade_depois, resultante.desconto_pagamento_prc, resultante.valor_total], [2, 5, 1900]);
  await t.aplicar(entrada);
  assert.deepEqual(t.api.tabelas.pedidos_itens.map(i => [i.quantidade, i.valor_total]), [[2, 1900], [0, 0]]);
});

test('o caso do PED121: juntar as duas linhas iguais — nada mexe no estoque, a produção vê as unidades mudarem de linha', async () => {
  const t = montar();
  const previa = await t.simular({ linhas: [{ item_id: 501, quantidade: 4 }, { item_id: 502, juntar_em: 501 }] });
  assert.equal(previa.saem.length, 0, 'nenhuma peça sai');
  assert.equal(previa.novas.length, 0, 'nenhuma peça nova');
  assert.deepEqual(previa.materia_prima.volta, []);
  assert.equal(previa.valores.depois.valor_final, 3800, 'mesmo total: 4 caixas com os mesmos 5%');

  const r = await t.aplicar({ linhas: [{ item_id: 501, quantidade: 4 }, { item_id: 502, juntar_em: 501 }] });
  assert.equal(r.ok, true);
  const itens = t.api.tabelas.pedidos_itens;
  assert.deepEqual(itens.map(i => [i.id, i.quantidade, i.qtd_usar_pronta, i.qtd_a_produzir]), [[501, 4, 1, 3], [502, 0, 0, 0]]);
  assert.equal(itens[0].valor_total, 3800);
  assert.equal(itens[1].valor_total, 0);
  assert.equal(t.api.tabelas.reservas_estoque.find(x => x.id === 2).pedido_item_id, 501, 'a reserva das 2 do zero foi junto');
  assert.equal(t.api.tabelas.pedidos_itens_faltantes[0].pedido_item_id, 501, 'o que faltava foi junto');
  assert.equal(t.api.tabelas.pedido_itens_ext[0].pedido_item_id, 501, 'a pronta do estoque continua na 501');
  assert.equal(t.api.tabelas.estoque_movimentos.length, 0, 'nenhum movimento de estoque');
  assert.equal(t.entradas.length, 0, 'nenhum insumo voltou');

  const registro = t.api.tabelas.pedido_edicoes[0];
  assert.equal(registro.motivo, 'Linhas repetidas vindas da IA');
  assert.ok(registro.concluida_em);
  const unidadesGravadas = JSON.parse(registro.unidades);
  const da502 = unidadesGravadas.find(u => u.pedido_item_id === 502);
  const da501 = unidadesGravadas.find(u => u.pedido_item_id === 501);
  assert.deepEqual(da502.sai['1'], [1, 1], 'saem da 502 as duas por começar');
  assert.deepEqual(da501.entra['1'], [1, 1], 'e entram na 501 como estavam');
  assert.deepEqual(da501.fila_antes['1'], [1], 'a fila da Marcenaria da 501 antes: só a do zero');

  // A produção: o registro da Marcenaria (1 caixa) continua valendo 1; agora
  // a 501 deve a Marcenaria de 2 caixas, e a 502 não deve nada.
  const m501 = await fracaoDoRegistro(t.api, 501, 1, 1);
  assert.equal(m501.fracao, 1);
  assert.deepEqual(m501.pendentes, [1, 1]);
  const m502 = await fracaoDoRegistro(t.api, 502, 1, 999);
  assert.equal(m502.pedida, 0);
  assert.match(t.api.tabelas.pedido_historico_eventos[0].descricao, /linha juntada/);
  assert.equal(t.api.tabelas.pedido_historico_eventos[0].tipo_evento, 'edicao');
});

test('tirar uma caixa: sai a do zero que já passou pela Marcenaria — volta ao estoque nesse ponto e só a Seladora volta', async () => {
  const t = montar();
  const previa = await t.simular({ linhas: [{ item_id: 501, quantidade: 1 }] });
  assert.equal(previa.saem.length, 1);
  assert.match(previa.saem[0].destino, /volta ao estoque em 3\/5 — Parafuso/);
  assert.equal(previa.saem[0].origem, 'do zero');
  assert.deepEqual(previa.materia_prima.volta.map(m => [m.nome, m.quantidade]), [['Seladora', 1]], 'o Verniz é infinito e não volta');
  assert.equal(previa.valores.depois.valor_final, 2900, '1 caixa sem o desconto de quantidade + as 2 da outra linha');
  assert.deepEqual(previa.parcelas.map(p => p.valor), [966.67, 966.67, 966.66]);

  await t.aplicar({ linhas: [{ item_id: 501, quantidade: 1 }] });
  const item = t.api.tabelas.pedidos_itens.find(i => i.id === 501);
  assert.deepEqual([item.quantidade, item.qtd_usar_pronta, item.qtd_a_produzir, item.valor_total, item.desconto_pagamento_prc], [1, 1, 0, 1000, 0]);
  assert.equal(t.api.tabelas.pedido_itens_ext.length, 1, 'a pronta do estoque ficou');
  const lote = t.api.tabelas.produtos_em_cada_ponto.find(l => l.ultimo_insumo_id === 303);
  assert.equal(lote.quantidade, 1, 'a caixa entrou no estoque no Parafuso (Marcenaria feita)');
  assert.equal(lote.etapa_id, 'Marcenaria');
  const mov = t.api.tabelas.estoque_movimentos.find(x => x.tipo_item === 'peca');
  assert.match(mov.decision_note, /Edição do PED55/);
  assert.deepEqual(t.entradas.map(e => [e[0], e[1]]), [[304, 1]]);
  assert.equal(t.api.tabelas.reservas_estoque.find(r => r.id === 1).status, 'retornada');
  assert.deepEqual(t.api.tabelas.pedido_parcelas.map(p => p.valor), [966.67, 966.67, 966.66]);
  assert.equal(t.api.tabelas.pedidos[0].valor_final, 2900);
  assert.equal(t.api.tabelas.financeiro_eventos[0].tipo, 'edicao_pedido');

  // O registro da Marcenaria foi feito ANTES: continua valendo a caixa inteira.
  const m = await fracaoDoRegistro(t.api, 501, 1, 1);
  assert.equal(m.fracao, 1);
  assert.equal(m.pedida, 0, 'a 501 não deve mais Marcenaria (só ficou a pronta)');
});

test('tirar a unidade do zero elimina a falta do passo já feito na parcial que fica', async () => {
  const dados = tabelas();
  dados.pedido_itens_ext.push({ id: 702, id_pedido: 55, pedido_item_id: 502, ultimo_insumo_id: 401, etapa_id: 802, quantidade: 1 });
  dados.reservas_estoque.find(r => r.pedido_item_id === 502).quantidade = 1;
  dados.pedidos_itens_faltantes = [
    { id: 1, pedido_id: 55, pedido_item_id: 502, insumo_id: 301, quantidade: 1 },
    { id: 2, pedido_id: 55, pedido_item_id: 502, insumo_id: 302, quantidade: 2 }
  ];
  const t = montar(dados);

  await t.aplicar({ linhas: [{ item_id: 502, quantidade: 1 }] });

  assert.deepEqual(t.api.tabelas.pedidos_itens_faltantes.map(f => [f.insumo_id, f.quantidade]), [[302, 1]],
    'MDF não falta para a parcial; a falta de Cola cai só pela unidade retirada');
  assert.equal(t.api.tabelas.pedido_itens_ext.find(r => r.id === 702).quantidade, 1, 'a parcial ficou no pedido');
  assert.deepEqual(t.entradas.map(e => [e[0], e[1]]), [[301, 1], [302, 1], [303, 1], [304, 1]]);
});

test('devolver três unidades abate a falta de duas, sem deixar falta proporcional ou negativa', async () => {
  const dados = tabelas();
  Object.assign(dados.pedidos_itens[1], linhaDoItem(502, 10, { qtd_usar_pronta: 0, qtd_a_produzir: 10 }));
  Object.assign(dados.reservas_estoque[1], { quantidade: 10, quantidade_original: 10 });
  dados.pedidos[0].valor_final = 11400;
  dados.pedidos[0].desconto_total = 600;
  dados.pedido_parcelas.forEach(p => { p.valor = 3800; });
  // Dez unidades consumiram o MDF; só oito estavam disponíveis na conversão.
  dados.materia_prima.find(m => m.id === 301).quantidade = -2;
  const t = montar(dados);

  await t.aplicar({ linhas: [{ item_id: 502, quantidade: 7 }] });

  assert.deepEqual(t.api.tabelas.pedidos_itens_faltantes, [], '2 - 3 tem piso zero, e não vira 2 × 7/10');
  assert.equal(t.entradas.find(e => e[0] === 301)[1], 3, 'a devolução de matéria-prima continua a mesma');
});

test('junção com retirada abate faltas pela linha de origem uma só vez antes de transferir o saldo', async () => {
  const dados = tabelas();
  dados.producao_eventos = [];
  Object.assign(dados.pedidos_itens[1], linhaDoItem(502, 3, { qtd_usar_pronta: 0, qtd_a_produzir: 3 }));
  // A 501 tem uma pronta e uma do zero; as três da 502 já vieram após o MDF.
  dados.pedido_itens_ext.push({ id: 702, id_pedido: 55, pedido_item_id: 502, ultimo_insumo_id: 401, etapa_id: 802, quantidade: 3 });
  dados.reservas_estoque = [dados.reservas_estoque[0]];
  dados.pedidos_itens_faltantes = [
    { id: 1, pedido_id: 55, pedido_item_id: 502, insumo_id: 302, quantidade: 1 },
    { id: 2, pedido_id: 55, pedido_item_id: 502, insumo_id: 302, quantidade: 2 },
    { id: 3, pedido_id: 55, pedido_item_id: 501, insumo_id: 302, quantidade: 1 }
  ];
  dados.pedidos[0].valor_final = 4750;
  const t = montar(dados);

  // Processa a linha juntada primeiro: a falta transferida não pertence à
  // origem 501 e não pode receber a devolução dela uma segunda vez.
  await t.aplicar({ linhas: [{ item_id: 502, juntar_em: 501 }, { item_id: 501, quantidade: 2 }] });

  assert.deepEqual(t.api.tabelas.pedidos_itens_faltantes, [
    { id: 2, pedido_id: 55, pedido_item_id: 501, insumo_id: 302, quantidade: 1 }
  ], 'a falta das três parciais cai em duas e a da unidade do zero some');
  assert.equal(t.entradas.find(e => e[0] === 302)[1], 3, 'a devolução soma as duas origens sem duplicar');
  assert.equal(t.api.tabelas.pedido_itens_ext.find(r => r.id === 702).quantidade, 1);
  assert.equal(t.api.tabelas.pedido_itens_ext.find(r => r.id === 702).pedido_item_id, 501);
});

test('a falta de um passo já produzido não é apagada como se o material tivesse voltado', async () => {
  const dados = tabelas();
  dados.pedidos_itens_faltantes = [
    { id: 1, pedido_id: 55, pedido_item_id: 501, insumo_id: 301, quantidade: 1 },
    { id: 2, pedido_id: 55, pedido_item_id: 501, insumo_id: 304, quantidade: 1 }
  ];
  const t = montar(dados);

  await t.aplicar({ linhas: [{ item_id: 501, quantidade: 1 }] });

  assert.deepEqual(t.api.tabelas.pedidos_itens_faltantes.map(f => [f.insumo_id, f.quantidade]), [[301, 1]],
    'o MDF foi usado; só a falta da Seladora devolvida é abatida');
});

test('pôr uma peça nova: linha nova pelo preço da tabela, reserva de produção, matéria-prima abatida e as parcelas iguais de novo', async () => {
  const t = montar();
  saidasDeInsumo.length = 0;
  const linhas = [{ produto_id: 20, quantidade: 1 }];
  await assert.rejects(t.aplicar({ linhas }), e => e.status === 422 && e.extra?.falta_decisao === true, 'sem a escolha da origem não grava');
  const decisoes = [{ produto_id: 20, qtd_usar_pronta: 0, qtd_a_produzir: 1 }];
  const previa = await t.simular({ linhas, decisoes });
  assert.deepEqual(previa.materia_prima.sai.map(m => [m.nome, m.quantidade]), [['Cera', 1], ['Freijó', 2]]);
  assert.equal(previa.valores.depois.valor_final, 4300);

  const r = await t.aplicar({ linhas, decisoes });
  const nova = t.api.tabelas.pedidos_itens.find(i => i.produto_id === 20);
  assert.ok(nova);
  assert.deepEqual([nova.quantidade, nova.valor_unitario, nova.valor_total, nova.qtd_a_produzir, nova.qtd_usar_pronta], [1, 500, 500, 1, 0]);
  assert.deepEqual(r.linhas_criadas, [nova.id]);
  assert.ok(t.api.tabelas.reservas_estoque.some(x => x.pedido_item_id === nova.id && x.status === 'producao'));
  assert.deepEqual(saidasDeInsumo.sort(), [[306, 2], [307, 1]]);
  assert.deepEqual(t.api.tabelas.pedido_parcelas.map(p => p.valor), [1433.34, 1433.33, 1433.33]);
  assert.ok(!t.api.tabelas.pedido_historico_eventos.some(e => /Convertido do orçamento/.test(e.descricao || '')), 'o evento é o da edição, não o da conversão');
});

test('pôr mais da peça que já existe aumenta a linha dela (uma linha por peça)', async () => {
  const t = montar();
  const previa = await t.simular({ linhas: [{ item_id: 502, juntar_em: 501 }, { item_id: 501, quantidade: 4 }, { produto_id: 10, quantidade: 1 }], decisoes: [{ produto_id: 10, qtd_usar_pronta: 0, qtd_a_produzir: 1 }] });
  const l501 = previa.linhas.find(l => l.item_id === 501);
  assert.equal(l501.quantidade_depois, 5);
  assert.equal(l501.novas, 1);
  assert.equal(previa.linhas.filter(l => l.tipo === 'nova').length, 0);
});

test('o pedido mudou entre a revisão e a confirmação: nada é gravado', async () => {
  const t = montar();
  const p = await edicao.montar(t.api, 55, { linhas: [{ item_id: 501, quantidade: 1 }] });
  const assinatura = edicao.assinar({ pedido: p.lidos.pedido, linhas: p.plano.linhas, totais: p.plano.totais, parcelas: p.plano.parcelas });
  // Alguém registrou a Marcenaria da outra linha no meio do caminho.
  t.api.tabelas.producao_eventos.push(ev(2, 502, 1, 2, '2026-10-14T10:00:00Z'));
  t.api.tabelas.pedidos[0].valor_final = 3799;
  await assert.rejects(edicao.aplicar(t.api, { pedidoId: 55, entrada: { motivo: 'Linhas repetidas vindas da IA', linhas: [{ item_id: 501, quantidade: 1 }], assinatura }, usuarioId: 3, registrarEntradaInsumo: async () => {} }),
    e => e.status === 409 && e.extra?.mudou === true);
  assert.equal(t.api.tabelas.pedido_edicoes.length, 0);
  assert.equal(t.api.tabelas.pedidos_itens.find(i => i.id === 501).quantidade, 2);
});

test('sem o SQL da edição, nada é gravado; sem motivo, também não; pedido com boleto registrado, nem simula', async () => {
  const semTabela = tabelas();
  delete semTabela.pedido_edicoes;
  const t = montar(semTabela);
  await assert.rejects(t.aplicar({ linhas: [{ item_id: 501, quantidade: 1 }] }), e => e.status === 409 && e.extra?.sql_pendente === true);
  assert.equal(t.api.tabelas.pedidos_itens.find(i => i.id === 501).quantidade, 2);

  const t2 = montar();
  await assert.rejects(edicao.aplicar(t2.api, { pedidoId: 55, entrada: { motivo: 'curto', linhas: [] } }), e => e.status === 422 && /motivo/.test(e.message));

  const comBoleto = tabelas();
  comBoleto.boletos.push({ id: 1, pedido_id: 55, pedido_parcela_id: 2, numero_parcela: 2, status: 'registrado', valor: 1266.67 });
  const t3 = montar(comBoleto);
  await assert.rejects(t3.simular({ linhas: [{ item_id: 501, quantidade: 1 }] }), e => e.status === 409 && /parcela está travada/.test(e.message));
});

test('linha que passou por troca entre pedidos não é editada (as outras sim); o pedido não fica sem peça', async () => {
  const comTroca = tabelas();
  comTroca.trocas_pecas.push({ id: 1, pedido_item_id_a: 502, pedido_item_id_b: 999, quantidade: 1, criado_em: '2026-10-05T10:00:00Z', estado_a: '{}', estado_b: '{}' });
  const t = montar(comTroca);
  await assert.rejects(t.simular({ linhas: [{ item_id: 502, quantidade: 1 }] }), e => e.status === 409 && /troca entre pedidos/.test(e.message));
  const ok = await t.simular({ linhas: [{ item_id: 501, quantidade: 1 }] });
  assert.equal(ok.saem.length, 1);
  await assert.rejects(montar().simular({ linhas: [{ item_id: 501, quantidade: 0 }, { item_id: 502, quantidade: 0 }] }), e => /não pode ficar sem nenhuma peça/.test(e.message));
  await assert.rejects(montar().simular({ linhas: [{ item_id: 501, quantidade: 2 }] }), e => /Nada foi mudado/.test(e.message));
});
