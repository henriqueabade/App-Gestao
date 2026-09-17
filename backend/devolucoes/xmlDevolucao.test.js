/**
 * Leitura do XML da NF-e de devolução do cliente e o casamento com as peças
 * do pedido (backend/devolucoes/xmlDevolucao.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const xml = require('./xmlDevolucao');

const { notaDeDevolucao, CHAVE_DA_DEVOLUCAO, CHAVE_DA_VENDA } = require('./notaDeTeste');

const pecas = [
  { pedido_item_id: 1, codigo: 'CX-INF-P', nome: 'Caixa Infinito - P (15 × 30 × 8h) - Jequitibá', ncm: '44201000', disponivel: 1, valor_unitario: 592.84, valor_cheio: 592.84 },
  { pedido_item_id: 2, codigo: 'BAN-OV', nome: 'Bandeja Oval & Cia', ncm: '44201000', disponivel: 3, valor_unitario: 300, valor_cheio: 320 },
  { pedido_item_id: 3, codigo: 'VASO-1', nome: 'Vaso Alto', ncm: '69139000', disponivel: 2, valor_unitario: 450, valor_cheio: 450 }
];

test('lê a nota: chave, número, emitente, destinatário, referência, protocolo e itens', () => {
  const nota = xml.lerNota(notaDeDevolucao());
  assert.equal(nota.chave_acesso, CHAVE_DA_DEVOLUCAO);
  assert.deepEqual([nota.modelo, nota.serie, nota.numero, nota.finalidade], ['55', 1, 456, 4]);
  assert.equal(nota.emitente_documento, '11222333000144');
  assert.equal(nota.emitente_nome, 'Basica Home Ltda');
  assert.equal(nota.destinatario_documento, '99888777000166');
  assert.deepEqual(nota.chaves_referenciadas, [CHAVE_DA_VENDA]);
  assert.equal(nota.protocolo, '131260000012345');
  assert.equal(nota.valor_total, 1192.84);
  assert.equal(nota.itens.length, 2);
  assert.deepEqual([nota.itens[1].descricao, nota.itens[1].quantidade, nota.itens[1].valor_unitario, nota.itens[1].valor_total], ['Bandeja Oval & Cia', 2, 300, 600]);
  assert.equal(xml.resumoDaNota(nota).quantidade_de_itens, 2);
});

test('recusa o que não é XML de NF-e', () => {
  assert.throws(() => xml.lerNota(''), /vazio/);
  assert.throws(() => xml.lerNota('<html><body>oi</body></html>'), /não é o XML de uma NF-e/);
  assert.throws(() => xml.lerNota(`<!DOCTYPE x [<!ENTITY a "b">]>${notaDeDevolucao()}`), /não é o XML de uma NF-e/);
  assert.throws(() => xml.lerNota('x'.repeat(xml.TAMANHO_MAXIMO + 1)), /grande demais/);
});

test('confere a nota contra o pedido: bloqueia a que não é para a empresa e avisa o resto', () => {
  const contexto = { chaveDaNotaDoPedido: CHAVE_DA_VENDA, documentoDaEmpresa: '99.888.777/0001-66', documentoDoCliente: '11.222.333/0001-44' };
  assert.deepEqual(xml.conferirNota(xml.lerNota(notaDeDevolucao()), contexto), { bloqueios: [], avisos: [] });

  const deOutro = xml.conferirNota(xml.lerNota(notaDeDevolucao({ destinatario: '00111222000133' })), contexto);
  assert.match(deOutro.bloqueios.join(' '), /não foi emitida para a empresa/);

  const torta = xml.conferirNota(xml.lerNota(notaDeDevolucao({ finalidade: 1, referencia: null, protocolo: false })), { ...contexto, documentoDoCliente: '55.666.777/0001-88' });
  assert.equal(torta.bloqueios.length, 0);
  assert.match(torta.avisos.join(' | '), /não está marcada como devolução/);
  assert.match(torta.avisos.join(' | '), /não referencia a NF-e deste pedido/);
  assert.match(torta.avisos.join(' | '), /não é o cliente deste pedido/);
  assert.match(torta.avisos.join(' | '), /protocolo de autorização/);
});

test('casa os itens por nome (sem acento nem pontuação) e por NCM + preço; o resto fica para o usuário', () => {
  const nota = xml.lerNota(notaDeDevolucao());
  const r = xml.casarItens(nota.itens, pecas);
  assert.deepEqual(r.escolhas, [{ pedido_item_id: 1, quantidade: 1 }, { pedido_item_id: 2, quantidade: 2 }]);
  assert.deepEqual(r.casados.map(c => c.criterio), ['nome', 'nome']);
  assert.equal(r.nao_reconhecidos.length, 0);

  const porPreco = xml.casarItens([{ n_item: 1, codigo: 'Q', descricao: 'PECA DECORATIVA', ncm: '69139000', quantidade: 1, valor_unitario: 450, valor_total: 450 }], pecas);
  assert.deepEqual(porPreco.casados.map(c => [c.pedido_item_id, c.criterio]), [[3, 'NCM e preço']]);

  const estranho = xml.casarItens([{ n_item: 1, codigo: 'Q', descricao: 'Sofa', ncm: '94016100', quantidade: 1, valor_unitario: 10, valor_total: 10 }], pecas);
  assert.equal(estranho.escolhas.length, 0);
  assert.equal(estranho.nao_reconhecidos[0].descricao, 'Sofa');
});

test('quantidade maior que o pedido, ou quebrada, vira aviso e é limitada', () => {
  const demais = xml.casarItens([{ n_item: 1, codigo: 'BAN-OV', descricao: 'x', ncm: '', quantidade: 5, valor_unitario: 1, valor_total: 5 }], pecas);
  assert.deepEqual(demais.escolhas, [{ pedido_item_id: 2, quantidade: 3 }]);
  assert.match(demais.avisos.join(' '), /só tem 3 para devolver/);

  const quebrada = xml.casarItens([{ n_item: 1, codigo: 'VASO-1', descricao: 'Vaso', ncm: '', quantidade: 1.5, valor_unitario: 1, valor_total: 1 }], pecas);
  assert.deepEqual(quebrada.escolhas, [{ pedido_item_id: 3, quantidade: 1 }]);
  assert.match(quebrada.avisos.join(' '), /quantidade quebrada/);

  // A mesma peça em duas linhas da nota soma, sem passar do que o pedido tem.
  const duas = xml.casarItens([
    { n_item: 1, codigo: 'VASO-1', descricao: 'Vaso', ncm: '', quantidade: 1, valor_unitario: 1, valor_total: 1 },
    { n_item: 2, codigo: 'VASO-1', descricao: 'Vaso', ncm: '', quantidade: 1, valor_unitario: 1, valor_total: 1 }
  ], pecas);
  assert.deepEqual(duas.escolhas, [{ pedido_item_id: 3, quantidade: 2 }]);
});
