/**
 * "Desconto na parcela" (dono, 09/10/2026): o botão dos Detalhes da parcela
 * muda o VALOR da parcela livre e o total do pedido (a conta do Gerar
 * boletos), guarda a justificativa no histórico do pedido e no do Financeiro,
 * e recusa a parcela travada (boleto, boleto de fora, pagamento, ordem).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const desconto = require('./financeiro/descontoParcela');
const detalhes = require('./financeiro/detalhes');
const comissoes = require('./financeiro/comissoes');

/** API falsa em memória, no feitio do cliente de verdade (filtra por igualdade). */
function apiFalsa(tabelas) {
  let proximo = 9000;
  const nome = caminho => String(caminho).replace(/^\/api\//, '').split('?')[0].split('/')[0];
  return {
    tabelas,
    async get(caminho, opcoes = {}) {
      const partes = String(caminho).replace(/^\/api\//, '').split('/');
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
      if (!tabelas[tabela]) tabelas[tabela] = [];
      const linha = { id: (proximo += 1), ...corpo };
      tabelas[tabela].push(linha);
      return linha;
    },
    async put(caminho, campos) {
      const [tabela, id] = String(caminho).replace(/^\/api\//, '').split('/');
      const linha = (tabelas[tabela] || []).find(l => String(l.id) === String(id));
      if (!linha) throw new Error(`${tabela} ${id} não existe`);
      Object.assign(linha, campos);
      return linha;
    }
  };
}

function base(extra = {}) {
  return {
    pedidos: [{ id: 115, numero: 'PED115', situacao: 'Enviado', valor_final: 3000, ajuste_valor: 0, ajuste_historico: null }],
    pedido_parcelas: [1, 2, 3].map(n => ({ id: 500 + n, pedido_id: 115, numero_parcela: n, valor: 1000, data_vencimento: `2026-1${n - 1}-10` })),
    boletos: [], recebimentos: [], boletos_externos: [], ordens_pagamento: [],
    usuarios: [{ id: 7, nome: 'Henrique' }],
    financeiro_eventos: [],
    ...extra
  };
}

test('parcela livre: a parcela e o total do pedido caem, com a justificativa no histórico', async () => {
  const api = apiFalsa(base());
  const r = await desconto.aplicar({ api, pedidoId: 115, numero: 2, entrada: { valor: '50', justificativa: 'Cliente pediu por atraso na entrega' }, usuarioId: 7 });
  assert.deepEqual(r.parcela, { numero: 2, antes: 1000, depois: 950, desconto: 50 });
  assert.equal(r.pedido.total_antes, 3000);
  assert.equal(r.pedido.total_depois, 2950);
  assert.equal(api.tabelas.pedido_parcelas.find(p => p.numero_parcela === 2).valor, 950);
  assert.equal(api.tabelas.pedido_parcelas.find(p => p.numero_parcela === 1).valor, 1000, 'as outras parcelas não mudam');
  const pedido = api.tabelas.pedidos[0];
  assert.equal(pedido.valor_final, 2950);
  assert.equal(pedido.ajuste_valor, -50, 'a diferença para os itens vira o "Desconto" do pedido');
  // A moeda do Intl leva espaço não separável depois do "R$".
  assert.equal(pedido.ajuste_motivo.replace(/ /g, ' '), 'Desconto de R$ 50,00 na 2ª parcela: Cliente pediu por atraso na entrega');
  const historico = JSON.parse(pedido.ajuste_historico);
  assert.equal(historico.length, 1);
  assert.equal(historico[0].origem, 'desconto_parcela');
  assert.equal(historico[0].por_nome, 'Henrique');
  assert.equal(historico[0].total_antes, 3000);
  assert.equal(historico[0].total_depois, 2950);
  const evento = api.tabelas.financeiro_eventos[0];
  assert.equal(evento.tipo, 'desconto_parcela');
  assert.equal(evento.numero_parcela, 2);
  assert.equal(evento.valor, -50);
  assert.match(evento.descricao, /R\$\s1\.000,00 → R\$\s950,00/);
});

test('o segundo desconto soma no ajuste do pedido (que já tinha um Adicional)', async () => {
  const api = apiFalsa(base({ pedidos: [{ id: 115, numero: 'PED115', situacao: 'Entregue', valor_final: 3025.97, ajuste_valor: 25.97, ajuste_historico: '[{"origem":"pagamento"}]' }] }));
  api.tabelas.pedido_parcelas[0].valor = 1025.97;
  await desconto.aplicar({ api, pedidoId: 115, numero: 3, entrada: { valor: 100, justificativa: 'Acordo comercial com o cliente' }, usuarioId: null });
  const pedido = api.tabelas.pedidos[0];
  assert.equal(pedido.valor_final, 2925.97);
  assert.equal(pedido.ajuste_valor, -74.03);
  assert.equal(JSON.parse(pedido.ajuste_historico).length, 2, 'o histórico antigo continua');
});

test('parcela travada: boleto, boleto de fora, pagamento e ordem recusam com o caminho certo', async () => {
  const casos = [
    [{ boletos: [{ id: 1, pedido_id: 115, numero_parcela: 2, status: 'registrado', valor: 1000 }] }, /boleto do BB de R\$\s1\.000,00: o desconto vai no próprio boleto/],
    [{ boletos_externos: [{ id: 1, pedido_id: 115, numero_parcela: 2, ativo: true, valor: 1000 }] }, /boleto de fora/],
    [{ recebimentos: [{ id: 1, pedido_id: 115, numero_parcela: 2, status: 'confirmado', valor_recebido: 1000 }] }, /já foi paga: dinheiro devolvido ao cliente é a Devolução/],
    [{ ordens_pagamento: [{ id: 1, pedido_id: 115, numero_parcela: 2, status: 'aberta', valor: 1000 }] }, /ordem de pagamento aberta de R\$\s1\.000,00: cancele a ordem/]
  ];
  for (const [extra, mensagem] of casos) {
    const api = apiFalsa(base(extra));
    await assert.rejects(
      desconto.aplicar({ api, pedidoId: 115, numero: 2, entrada: { valor: 50, justificativa: 'Desconto combinado com o cliente' } }),
      e => e.status === 409 && mensagem.test(e.message) && e.extra?.code === 'PARCELA_TRAVADA'
    );
    assert.equal(api.tabelas.pedido_parcelas[1].valor, 1000, 'nada foi gravado');
  }
  // Boleto cancelado não trava: a parcela ficou livre.
  const livre = apiFalsa(base({ boletos: [{ id: 1, pedido_id: 115, numero_parcela: 2, status: 'baixado', valor: 1000 }] }));
  await desconto.aplicar({ api: livre, pedidoId: 115, numero: 2, entrada: { valor: 50, justificativa: 'Desconto combinado com o cliente' } });
  assert.equal(livre.tabelas.pedido_parcelas[1].valor, 950);
});

test('validação: valor, justificativa, desconto maior que a parcela, pedido cancelado, parcela que não existe', async () => {
  const tentar = (entrada, extra = {}, numero = 2) => desconto.aplicar({ api: apiFalsa(base(extra)), pedidoId: 115, numero, entrada });
  await assert.rejects(tentar({ valor: 0, justificativa: 'Desconto combinado' }), e => e.status === 422 && /valor do desconto/.test(e.message));
  await assert.rejects(tentar({ valor: 10, justificativa: 'curta' }), e => e.status === 422 && /ao menos 10 letras/.test(e.message));
  await assert.rejects(tentar({ valor: 1000, justificativa: 'Desconto combinado' }), e => e.status === 422 && /menor que a parcela \(R\$\s1\.000,00\)/.test(e.message));
  await assert.rejects(tentar({ valor: 10, justificativa: 'Desconto combinado' }, { pedidos: [{ id: 115, situacao: 'Cancelado', valor_final: 3000 }] }), e => e.status === 409 && /cancelado/.test(e.message));
  await assert.rejects(tentar({ valor: 10, justificativa: 'Desconto combinado' }, {}, 9), e => e.status === 404 && /9ª parcela não existe/.test(e.message));
});

test('Detalhes da parcela: o botão acende só na parcela em aberto e livre', () => {
  assert.deepEqual(detalhes.descontoNaParcela({ situacao: 'prevista', base_origem: 'parcela', recebimento: null }), { pode: true, motivo: null });
  assert.deepEqual(detalhes.descontoNaParcela({ situacao: 'atrasada', base_origem: 'parcela', recebimento: null }), { pode: true, motivo: null });
  assert.match(detalhes.descontoNaParcela({ situacao: 'prevista', base_origem: 'boleto' }).motivo, /no próprio boleto/);
  assert.match(detalhes.descontoNaParcela({ situacao: 'prevista', base_origem: 'ordem' }).motivo, /ordem de pagamento/);
  assert.match(detalhes.descontoNaParcela({ situacao: 'apurada', base_origem: 'recebimento', recebimento: { id: 1 } }).motivo, /já foi paga/);
  assert.match(detalhes.descontoNaParcela({ situacao: 'nao_realizada' }).motivo, /cancelada/);
  assert.equal(detalhes.descontoNaParcela({ situacao: 'a_lancar', base_origem: 'parcela' }).pode, false);
});

test('a comissão não conta o desconto duas vezes: a parcela vale o valor novo, e paga com ele, o que entrou', () => {
  // Em aberto: a parcela do pedido (já com o desconto).
  assert.deepEqual(comissoes.valorRealDaParcela({ valor: 950 }, null), { valor: 950, origem: 'parcela' });
  // Paga com o valor do desconto: 950, e não 900 (o ajuste antigo descontava de novo).
  assert.deepEqual(comissoes.valorRealDaParcela({ valor: 950 }, { valor_parcela: 950, valor_recebido: 950, valor_abatimento: 0 }), { valor: 950, origem: 'recebimento' });
});
