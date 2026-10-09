/**
 * As MUDANÇAS de unidade de um item (09/10/2026): a troca de peças entre
 * pedidos e a peça avulsa do pedido cancelado. O que foi registrado antes da
 * mudança vale como valia; depois dela, a unidade que saiu deixa de ser
 * pendência e a que entrou deve só o que falta nela.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const u = require('./producaoUnidades');

const ev = (id, quantidade, criado_em, extra = {}) => ({ id, quantidade, status: 'ativo', data_finalizacao: criado_em.slice(0, 10), criado_em, ...extra });
const fracoesDe = r => Object.fromEntries([...r.porEvento].map(([k, v]) => [k, Math.round(v.fracao * 10000) / 10000]));

test('sem mudança, é o alocar de sempre', () => {
  const fila = [1, 1, 0.5];
  const eventos = [ev(1, 2, '2026-10-01T10:00:00Z')];
  const a = u.alocar({ fila, eventos });
  const b = u.alocarComMudancas({ fila, eventos, mudancas: [] });
  assert.deepEqual(b.pendentes, a.pendentes);
  assert.deepEqual(b.cotas, a.cotas);
  assert.equal(b.usadas, a.usadas);
  assert.equal(b.pedida, 3);
});

test('troca: o pedido dá a peça pronta e recebe uma do zero — o que pagou continua pago, e volta a dever uma', () => {
  // X tinha 2 cadeiras do zero e registrou a Marcenaria das duas.
  const r = u.alocarComMudancas({
    fila: [1, 1],
    eventos: [ev(1, 2, '2026-10-05T10:00:00Z')],
    mudancas: [{ em: '2026-10-06T09:00:00Z', sai: [0], entra: [1] }]
  });
  assert.deepEqual(fracoesDe(r), { 1: 2 }, 'o registro de antes vale as duas peças');
  assert.deepEqual(r.pendentes, [1], 'a que chegou, do zero, é pendência daqui');
  assert.equal(r.usadas, 1);
  assert.equal(r.pedida, 2);
});

test('troca: a peça que chega pela metade deve só o que falta; o registro de depois a consome', () => {
  const r = u.alocarComMudancas({
    fila: [1, 1],
    eventos: [ev(1, 2, '2026-10-05T10:00:00Z'), ev(2, 1, '2026-10-07T10:00:00Z')],
    mudancas: [{ em: '2026-10-06T09:00:00Z', sai: [0], entra: [0.4] }]
  });
  assert.deepEqual(fracoesDe(r), { 1: 2, 2: 0.4 }, 'depois da troca, o registro paga só os 40% que faltavam');
  assert.deepEqual(r.pendentes, []);
});

test('troca: quem recebe a peça PRONTA não paga de novo (ela nem entra na fila do processo)', () => {
  // Y tinha 1 peça do zero, sem nada feito; recebe a pronta e dá a dele.
  const r = u.alocarComMudancas({
    fila: [1],
    eventos: [],
    mudancas: [{ em: '2026-10-06T09:00:00Z', sai: [1], entra: [0] }]
  });
  assert.deepEqual(r.pendentes, []);
  assert.equal(r.pedida, 0);
});

test('registro gravado ANTES da troca, mesmo com data de finalização depois, consome a fila de antes', () => {
  const r = u.alocarComMudancas({
    fila: [1],
    eventos: [ev(1, 1, '2026-10-05T10:00:00Z', { data_finalizacao: '2026-10-09' })],
    mudancas: [{ em: '2026-10-06T09:00:00Z', sai: [0], entra: [1] }]
  });
  assert.deepEqual(fracoesDe(r), { 1: 1 });
  assert.deepEqual(r.pendentes, [1]);
});

test('peça avulsa: o cancelamento tira todas as unidades e só a avulsa continua, do ponto em que estava', () => {
  // 3 peças do zero, 1 com a Marcenaria registrada; no cancelamento, 1 segue como avulsa com 60% por fazer.
  const r = u.alocarComMudancas({
    fila: [1, 1, 1],
    eventos: [ev(1, 1, '2026-10-02T10:00:00Z'), ev(2, 1, '2026-10-12T10:00:00Z', { fracao_paga: 0.25 })],
    mudancas: [{ em: '2026-10-10T09:00:00Z', zerar: true, entra: [0.6] }]
  });
  assert.equal(fracoesDe(r)[1], 1, 'o de antes do cancelamento vale como valia');
  assert.equal(fracoesDe(r)[2], 0.25, 'o de depois consome a avulsa');
  assert.deepEqual(r.pendentes, [0.35]);
  assert.equal(r.pedida, 1, 'só a avulsa: as outras ganharam destino no cancelamento');
});

test('duas trocas no mesmo item, em ordem', () => {
  const r = u.alocarComMudancas({
    fila: [1, 1],
    eventos: [ev(1, 1, '2026-10-01T10:00:00Z'), ev(2, 1, '2026-10-04T10:00:00Z')],
    mudancas: [
      { em: '2026-10-05T09:00:00Z', sai: [1], entra: [0.5] },
      { em: '2026-10-03T09:00:00Z', sai: [0], entra: [1] }
    ]
  });
  // 03/10: a pronta (ev 1) sai, entra uma do zero → [feita(morta), 1, 1].
  // ev 2 (04/10) consome uma; 05/10: sai a outra do zero e entra uma pela metade.
  assert.deepEqual(fracoesDe(r), { 1: 1, 2: 1 });
  assert.deepEqual(r.pendentes, [0.5]);
});
