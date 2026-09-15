/**
 * Datas no modal "Pagamento do pedido" (src/js/modals/pedido-pagamento.js).
 *
 *  - A base dos vencimentos é o INÍCIO DO FATURAMENTO do pedido; no pedido
 *    antigo, o dia da emissão em São Paulo. Antes era o instante da emissão
 *    somado em milissegundos e cortado em UTC — de noite, um dia a mais.
 *  - O botão "Embarque e faturamento" fica à direita da escolha do tipo de
 *    parcela, na linha de "Iguais" / "Diferentes", e continua lá depois de
 *    trocar quantidade, modo e condição. O teste roda o `parcelamento.js`
 *    REAL, o mesmo dos orçamentos, num DOM de mentira (./apoio/domMinimo.js).
 *
 * O fuso fica fixo em São Paulo, onde o erro de um dia aparece.
 */
process.env.TZ = 'America/Sao_Paulo';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarAmbiente, esperarTarefas } = require('./apoio/domMinimo');

const RAIZ = path.join(__dirname, '..', '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'js', 'modals', 'pedido-pagamento.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'html', 'modals', 'pedidos', 'pagamento.html'), 'utf8');
const PARCELAMENTO = fs.readFileSync(path.join(RAIZ, 'js', 'utils', 'parcelamento.js'), 'utf8');

const simples = valor => JSON.parse(JSON.stringify(valor));

function carregarDatasPuras() {
  const inicio = FONTE.indexOf('const FUSO_PEDIDO');
  const fim = FONTE.indexOf('// fim das datas do faturamento');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco das datas do faturamento não foi encontrado');
  // eslint-disable-next-line no-new-func
  return new Function(`${FONTE.slice(inicio, fim)}
    return { diaDeColunaDate, diaEmSaoPaulo, somarDias, baseDosVencimentos, formatarDia,
      textoResumoDatas, ordenarPorNumeroParcela };`)();
}

const D = carregarDatasPuras();

// ============================================================ funções puras

test('base dos vencimentos: o início do faturamento, cortado, sem recuar um dia', () => {
  const pedido = {
    inicio_faturamento: '2026-08-10T00:00:00.000Z',
    data_emissao: '2026-07-01T15:00:00.000Z'
  };
  assert.equal(D.baseDosVencimentos(pedido), '2026-08-10');
  assert.equal(D.somarDias(D.baseDosVencimentos(pedido), 15), '2026-08-25');
});

test('base no pedido antigo: o dia da emissão EM SÃO PAULO', () => {
  // 02:30 em UTC é 23:30 do dia 1º em São Paulo.
  const antigo = { data_emissao: '2026-09-02T02:30:00.000Z' };
  assert.equal(D.baseDosVencimentos(antigo), '2026-09-01');
  // O cálculo que havia aqui dava o dia UTC:
  const comoEra = new Date(new Date(antigo.data_emissao).getTime() + 0).toISOString().split('T')[0];
  assert.equal(comoEra, '2026-09-02');
  // Sem nenhuma data, hoje (em São Paulo).
  assert.equal(D.baseDosVencimentos({}, new Date('2026-09-14T15:00:00.000Z')), '2026-09-14');
});

test('diaEmSaoPaulo: instante vira o dia local; só-data passa direto', () => {
  assert.equal(D.diaEmSaoPaulo('2026-09-02T02:30:00.000Z'), '2026-09-01');
  assert.equal(D.diaEmSaoPaulo('2026-09-02T03:30:00.000Z'), '2026-09-02');
  assert.equal(D.diaEmSaoPaulo('2026-09-02'), '2026-09-02');
  assert.equal(D.diaEmSaoPaulo(null), null);
  assert.equal(D.diaEmSaoPaulo('lixo'), null);
});

test('somarDias e formatarDia: calendário, dd/mm/aaaa sem new Date()', () => {
  assert.equal(D.somarDias('2026-12-20', 15), '2027-01-04');
  assert.equal(D.somarDias('2018-11-03', 1), '2018-11-04', 'dia do horário de verão de 2018');
  assert.equal(D.formatarDia('2026-08-10T00:00:00.000Z'), '10/08/2026');
  assert.equal(D.formatarDia(null), '—');
});

test('resumo: de onde os vencimentos partem, e o aviso no pedido antigo', () => {
  const base = { embarcar_previsao: '2026-08-10', inicio_faturamento: '2026-08-10T00:00:00.000Z' };
  assert.equal(D.textoResumoDatas({ ...base, faturamento_regra: 'ao_embarcar' }),
    'Embarque previsto: 10/08/2026 · Faturamento a partir de 10/08/2026 (ao embarcar)');
  assert.equal(D.textoResumoDatas({ ...base, inicio_faturamento: '2026-07-20', faturamento_regra: 'ao_converter' }),
    'Embarque previsto: 10/08/2026 · Faturamento a partir de 20/07/2026 (na conversão)');
  assert.equal(D.textoResumoDatas({ ...base, inicio_faturamento: '2026-09-01', faturamento_regra: 'data' }),
    'Embarque previsto: 10/08/2026 · Faturamento a partir de 01/09/2026 (data específica)');
  assert.equal(D.textoResumoDatas({ data_emissao: '2026-09-02T02:30:00.000Z' }),
    'Sem previsão de embarque — defina em Embarque e faturamento');
});

test('parcelas em ordem de numero_parcela: o upstream ignora o order do GET', () => {
  const lista = [{ numero_parcela: 3 }, { numero_parcela: 1 }, { numero_parcela: 2 }];
  assert.deepEqual(D.ordenarPorNumeroParcela(lista).map(p => p.numero_parcela), [1, 2, 3]);
  assert.deepEqual(lista.map(p => p.numero_parcela), [3, 1, 2], 'não mexe na lista original');
  assert.deepEqual(D.ordenarPorNumeroParcela(null), []);
});

// ====================================================== o modal funcionando

/** Pedido em Produção, a prazo, com as parcelas vindas FORA de ordem. */
const PEDIDO_PRAZO = {
  id: 7,
  numero: 'PED7',
  situacao: 'Produção',
  cliente_nome: 'Atelier Lume',
  data_emissao: '2026-09-02T02:30:00.000Z',
  parcelas: 2,
  prazo: '15/30',
  tipo_parcela: 'diferente',
  forma_pagamento: 'boleto',
  embarcar_previsao: '2026-10-10T00:00:00.000Z',
  inicio_faturamento: '2026-10-10T00:00:00.000Z',
  faturamento_regra: 'ao_embarcar',
  itens: [{ id: 1, quantidade: 1, valor_unitario: 1000, desconto_pagamento_prc: 0, desconto_especial_prc: 0 }],
  parcelas_detalhes: [
    { id: 11, numero_parcela: 2, valor: 600, data_vencimento: '2026-11-09' },
    { id: 10, numero_parcela: 1, valor: 400, data_vencimento: '2026-10-25' }
  ]
};

/** Pedido antigo (sem datas novas), à vista, que já saiu de Produção. */
const PEDIDO_ANTIGO = {
  id: 8,
  numero: 'PED8',
  situacao: 'Enviado',
  cliente_nome: 'Casa Bela',
  data_emissao: '2026-09-02T02:30:00.000Z',
  parcelas: 1,
  prazo: '0',
  tipo_parcela: 'a vista',
  forma_pagamento: 'pix',
  itens: [{ id: 2, quantidade: 1, valor_unitario: 1000, desconto_pagamento_prc: 5, desconto_especial_prc: 0 }],
  parcelas_detalhes: [{ id: 20, numero_parcela: 1, valor: 950 }]
};

function abrirPagamento(pedido) {
  const amb = criarAmbiente();
  const { janela, documento } = amb;
  const wrapper = amb.montar(HTML);
  const registro = { aberturas: [], fechados: [], toasts: [], recargas: 0 };

  janela.Modal = {
    async open(...args) { registro.aberturas.push(args); },
    close(id) {
      registro.fechados.push(id);
      wrapper.remove();
      janela.dispatchEvent(new janela.CustomEvent('modalFechado', { detail: id }));
    }
  };
  janela.apiConfig = { getApiBaseUrl: async () => 'http://api.teste' };
  janela.fetch = async () => ({ ok: true, status: 200, json: async () => simples(pedido) });
  janela.selectedOrderId = String(pedido.id);
  janela.showToast = (texto, tipo) => registro.toasts.push([texto, tipo]);
  janela.carregarPedidos = () => { registro.recargas += 1; };

  const contexto = vm.createContext(janela);
  vm.runInContext(PARCELAMENTO, contexto, { filename: 'parcelamento.js' });
  const carregado = new Promise(resolve => janela.addEventListener('pedidoModalLoaded', resolve));
  vm.runInContext(FONTE, contexto, { filename: 'pedido-pagamento.js' });

  const $ = id => documento.getElementById(id);
  return {
    ...amb,
    wrapper,
    registro,
    carregado,
    $,
    botao: () => $('pagamentoPedidoDatasBtn'),
    linhaDoModo: () => wrapper.querySelector('input[value="custom"]').closest('label').parentElement,
    chips: () => $('pagamentoPedidoVencimentosLista').children.map(c => c.textContent),
    resumo: () => $('pagamentoPedidoDatasResumo').textContent,
    definirDatas(detail) {
      janela.dispatchEvent(new janela.CustomEvent('pedido:datas-definidas', { detail }));
    }
  };
}

test('o botão fica na linha de "Iguais" / "Diferentes", à direita, com a guarda ped.dates.edit', async () => {
  const p = abrirPagamento(PEDIDO_PRAZO);
  await p.carregado;

  const botao = p.botao();
  assert.ok(botao, 'o botão foi inserido');
  const linha = p.linhaDoModo();
  assert.equal(botao.parentElement, linha, 'na linha dos rádios de Modo');
  assert.equal(linha.lastElementChild, botao, 'depois de "Diferentes"');
  assert.equal(botao.style.marginLeft, 'auto', 'empurrado para a ponta direita');
  assert.equal(botao.getAttribute('data-perm'), 'ped.dates.edit');
  assert.equal(botao.type, 'button');
  assert.ok(botao.querySelector('i.fa-calendar-alt'));
  assert.match(botao.textContent, /Embarque e faturamento/);
  assert.ok(botao.classList.contains('btn-neutral'), 'classe de botão do app, que não quebra linha');
  assert.equal(botao.disabled, false, 'em Produção fica liberado');
});

test('vencimentos partem do início do faturamento, com as parcelas na ordem do número', async () => {
  const p = abrirPagamento(PEDIDO_PRAZO);
  await p.carregado;

  assert.match(p.$('pagamentoPedidoParcelamento_amount_0').value, /400,00/,
    'a 1ª parcela é a de numero_parcela 1, mesmo vindo depois no GET');
  assert.match(p.$('pagamentoPedidoParcelamento_amount_1').value, /600,00/);
  assert.deepEqual(p.chips(), ['1ª — 25/10/2026 (15 dias)', '2ª — 09/11/2026 (30 dias)']);
  assert.equal(p.resumo(), 'Embarque previsto: 10/10/2026 · Faturamento a partir de 10/10/2026 (ao embarcar)');
  assert.equal(p.$('pagamentoPedidoEmissao').textContent, '01/09/2026', 'o dia da emissão em São Paulo');
});

test('o botão continua lá depois de trocar quantidade, modo e condição', async () => {
  const p = abrirPagamento(PEDIDO_PRAZO);
  await p.carregado;

  const quantidade = p.$('pagamentoPedidoParcelamento_count');
  quantidade.value = '3';
  p.disparar(quantidade, 'change');
  assert.equal(p.botao().parentElement, p.linhaDoModo(), 'depois de trocar a quantidade');

  p.wrapper.querySelector('input[value="equal"]').click();
  assert.equal(p.botao().parentElement, p.linhaDoModo(), 'depois de trocar o modo');

  const condicao = p.$('pagamentoPedidoCondicao');
  condicao.value = 'vista';
  p.disparar(condicao, 'change');
  await esperarTarefas();
  const linhaVista = p.$('pagamentoPedidoPrazoVista').closest('[data-linha-prazo-vista]');
  assert.ok(linhaVista);
  assert.equal(p.botao().parentElement, linhaVista, 'à vista: na linha do "Prazo (dias)"');
  assert.equal(p.botao().style.marginLeft, 'auto');

  condicao.value = 'prazo';
  p.disparar(condicao, 'change');
  await esperarTarefas();
  assert.equal(p.botao().parentElement, p.linhaDoModo(), 'de volta a prazo, na nova linha de Modo');
  assert.equal(p.documento.querySelectorAll('#pagamentoPedidoDatasBtn').length, 1, 'um botão só');
});

test('a lista repinta quando o prazo sai do campo, e não fica uma edição atrasada', async () => {
  const p = abrirPagamento(PEDIDO_PRAZO);
  await p.carregado;

  const prazo = p.$('pagamentoPedidoParcelamento_due_0');
  prazo.value = '20';
  // No Chromium o `change` vem antes do `blur`, e o parcelamento só grava o
  // prazo no blur: no change a lista ainda enxerga o valor antigo.
  p.disparar(prazo, 'change');
  assert.equal(p.chips()[0], '1ª — 25/10/2026 (15 dias)');
  p.disparar(prazo, 'blur', { bubbles: false });
  p.disparar(prazo, 'focusout');
  assert.equal(p.chips()[0], '1ª — 30/10/2026 (20 dias)');
});

test('o clique abre o modal de datas no modo pedido, com o contexto do pedido', async () => {
  const p = abrirPagamento(PEDIDO_PRAZO);
  await p.carregado;

  p.botao().click();
  await esperarTarefas();

  assert.deepEqual(p.registro.aberturas,
    [['modals/pedidos/datas.html', '../js/modals/pedido-datas.js', 'datasPedido', true]]);
  assert.deepEqual(simples(p.janela.datasPedidoContext), {
    modo: 'pedido',
    pedidoId: '7',
    numero: 'PED7',
    cliente: 'Atelier Lume',
    prazos: [15, 30],
    embarcar_previsao: '2026-10-10',
    inicio_faturamento: '2026-10-10',
    faturamento_regra: 'ao_embarcar',
    dataConversao: '2026-09-01'
  });
});

test('as datas gravadas pelo modal de datas repintam resumo e vencimentos', async () => {
  const p = abrirPagamento(PEDIDO_PRAZO);
  await p.carregado;

  const datas = { embarcar_previsao: '2026-11-05', faturamento_regra: 'ao_embarcar', inicio_faturamento: '2026-11-05' };
  p.definirDatas({ source: 'outra-tela', modo: 'pedido', datas, resposta: null });
  p.definirDatas({ source: 'pedido-datas', modo: 'conversao', datas, resposta: null });
  assert.deepEqual(p.registro.toasts, [], 'só o modal de datas, no modo pedido, fala com este modal');

  p.definirDatas({
    source: 'pedido-datas',
    modo: 'pedido',
    datas,
    resposta: { ok: true, ...datas, parcelas: [], avisos: ['Parcela 2 reprogramada.'] }
  });
  assert.equal(p.resumo(), 'Embarque previsto: 05/11/2026 · Faturamento a partir de 05/11/2026 (ao embarcar)');
  assert.deepEqual(p.chips(), ['1ª — 20/11/2026 (15 dias)', '2ª — 05/12/2026 (30 dias)']);
  assert.deepEqual(p.registro.toasts,
    [['Datas do pedido atualizadas.', 'success'], ['Parcela 2 reprogramada.', 'info']]);
  assert.equal(p.registro.recargas, 1, 'a lista de pedidos é relida');
});

test('fechado o pagamento, o ouvinte das datas sai junto', async () => {
  const p = abrirPagamento(PEDIDO_PRAZO);
  await p.carregado;
  p.$('cancelarPagamentoPedido').click();
  assert.deepEqual(p.registro.fechados, ['pagamentoPedido']);

  p.definirDatas({ source: 'pedido-datas', modo: 'pedido', datas: {}, resposta: { inicio_faturamento: '2026-11-05' } });
  assert.deepEqual(p.registro.toasts, []);
});

test('pedido antigo fora de Produção: botão travado, aviso de sem previsão, base na emissão (SP)', async () => {
  const p = abrirPagamento(PEDIDO_ANTIGO);
  await p.carregado;

  const botao = p.botao();
  assert.equal(botao.parentElement, p.$('pagamentoPedidoPrazoVista').closest('[data-linha-prazo-vista]'),
    'à vista, ao lado do "Prazo (dias)"');
  assert.equal(botao.disabled, true, 'a mesma trava do Salvar');
  assert.match(botao.title, /em produção/);
  assert.equal(p.$('salvarPagamentoPedido').disabled, true);
  assert.equal(p.resumo(), 'Sem previsão de embarque — defina em Embarque e faturamento');
  assert.deepEqual(p.chips(), ['01/09/2026 (0 dias)'], 'o dia 1º em São Paulo, e não o dia 2 do UTC');

  botao.click();
  await esperarTarefas();
  assert.deepEqual(p.registro.aberturas, []);
});

test('o parcelamento compartilhado não ganhou o botão (ele serve também aos orçamentos)', () => {
  assert.doesNotMatch(PARCELAMENTO, /pagamentoPedidoDatasBtn|ped\.dates\.edit|Embarque e faturamento/);
});
