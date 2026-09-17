/**
 * A trava do cancelamento (backend/pedidosController.js): pedido enviado,
 * entregue, com NF-e autorizada ou que já teve devolução não se cancela —
 * devolve-se. Sem ela, uma tela velha cancelaria um pedido "Parcial" e o
 * estorno devolveria ao estoque peças que a devolução já tinha devolvido.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { motivoParaDevolverEmVezDeCancelar: motivo } = require('./pedidosController');

const apiCom = notas => ({
  chamadas: 0,
  async get(caminho, opcoes) {
    this.chamadas += 1;
    assert.equal(caminho, '/api/notas_fiscais');
    assert.deepEqual(opcoes, { query: { pedido_id: 7 } });
    if (notas instanceof Error) throw notas;
    return notas;
  }
});

test('em produção e sem nota viva: cancela como sempre', async () => {
  assert.equal(await motivo(apiCom([]), { situacao: 'Produção' }, 7), null);
  assert.equal(await motivo(apiCom([{ pedido_id: 7, status_fiscal: 'cancelada' }, { pedido_id: 7, status_fiscal: 'rejeitada' }]), { situacao: 'Produção' }, 7), null,
    'nota cancelada na SEFAZ devolve o pedido ao cancelamento');
  // A API ignora filtro que não conhece e pode devolver a nota de OUTRO pedido: não conta.
  assert.equal(await motivo(apiCom([{ pedido_id: 8, status_fiscal: 'autorizada' }]), { situacao: 'Produção' }, 7), null);
  // Sem conseguir ler as notas (sem o módulo fiscal), vale o que o pedido diz.
  assert.equal(await motivo(apiCom(new Error('fora do ar')), { situacao: 'Produção' }, 7), null);
  // Sem o pedido lido não há o que conferir: o fluxo antigo segue.
  assert.equal(await motivo(apiCom([]), null, 7), null);
});

test('enviado, entregue, com NF-e autorizada ou já devolvido: recusa e manda devolver', async () => {
  const enviado = apiCom([]);
  assert.match(await motivo(enviado, { situacao: 'Enviado' }, 7), /Pedido enviado não se cancela: registre a devolução/);
  assert.equal(enviado.chamadas, 0, 'nem precisa ler as notas');
  assert.match(await motivo(apiCom([]), { situacao: ' ENTREGUE ' }, 7), /Pedido entregue não se cancela/);
  assert.match(await motivo(apiCom([{ pedido_id: 7, status_fiscal: 'autorizada' }]), { situacao: 'Produção' }, 7), /NF-e autorizada: cancele a nota na SEFAZ/);
  assert.match(await motivo(apiCom([]), { situacao: 'Enviado', devolucao: 'parcial' }, 7), /já teve devolução registrada/);
  assert.match(await motivo(apiCom([]), { situacao: 'Entregue', devolucao: 'total' }, 7), /já teve devolução registrada/);
});
