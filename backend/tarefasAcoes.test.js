/**
 * Catálogo das ações de outros módulos que uma tarefa cobra
 * (backend/tarefasAcoes.js): qual rota é qual ação, de qual registro, e o que
 * a tela pode mandar.
 */
const test = require('node:test');
const assert = require('node:assert');
const A = require('./tarefasAcoes');

const acoes = req => A.acoesDaRequisicao(req).map(a => `${a.chave}:${a.registro}`).sort();

test('pedido: cada status é uma ação; o registro vem do caminho', () => {
  assert.deepStrictEqual(acoes({ metodo: 'PUT', caminho: '/api/pedidos/40/status', corpo: { status: 'Enviado' } }), ['pedido.despachar:40']);
  assert.deepStrictEqual(acoes({ metodo: 'PUT', caminho: '/api/pedidos/40/status', corpo: { status: 'Produção' } }), ['pedido.confirmar:40']);
  assert.deepStrictEqual(acoes({ metodo: 'PUT', caminho: '/api/pedidos/40/status', corpo: { status: 'Entregue' } }), ['pedido.entregar:40']);
  assert.deepStrictEqual(acoes({ metodo: 'PUT', caminho: '/api/pedidos/40/status', corpo: { status: 'Cancelado' } }), [], 'cancelar não é ação do catálogo');
  assert.deepStrictEqual(acoes({ metodo: 'GET', caminho: '/api/pedidos/40/status', corpo: {} }), [], 'leitura não conta');
});

test('pedido: o registro também pode vir do corpo, e a NF-e só conta autorizada', () => {
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/cobranca/recebimentos', corpo: { pedido_id: 40, numero_parcela: 1 } }), ['pedido.recebimento:40']);
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/financeiro/producao', corpo: { pedido_id: '41' } }), ['pedido.producao:41']);
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/fiscal/pedidos/40/emitir', corpo: {}, resposta: { autorizada: false, processando: true } }), []);
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/fiscal/pedidos/40/emitir', corpo: {}, resposta: { autorizada: true } }), ['pedido.nfe:40']);
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/fiscal/notas/9/sincronizar', corpo: {}, resposta: { autorizada: true, nota: { pedido_id: 40 } } }), ['pedido.nfe:40'],
    'a nota que ficou em processamento e foi autorizada depois conta para o pedido dela');
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/devolucoes/pedido/40/previa', corpo: {} }), [], 'prévia da devolução não é a devolução');
});

test('orçamento, prospecção e cliente', () => {
  assert.deepStrictEqual(acoes({ metodo: 'PATCH', caminho: '/api/orcamentos/30/status', corpo: { situacao: 'Pendente' } }), ['orcamento.enviar:30']);
  assert.deepStrictEqual(acoes({ metodo: 'PUT', caminho: '/api/orcamentos/30', corpo: { situacao: 'Aprovado' } }), ['orcamento.converter:30']);
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/prospeccoes/8/concluir-passo', corpo: { nota: 'x', etapa: 'Proposta' } }), ['prospeccao.funil:8', 'prospeccao.interacao:8'],
    'concluir o passo mudando a etapa é mover no funil e registrar atividade');
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/prospeccoes/8/concluir-passo', corpo: { nota: 'x' } }), ['prospeccao.interacao:8']);
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/clientes/7/interacoes', corpo: {} }), ['cliente.atividade:7']);
  assert.deepStrictEqual(acoes({ metodo: 'PUT', caminho: '/api/clientes/7/interacoes/3', corpo: {} }), [], 'editar uma atividade não é registrar outra');
});

test('financeiro: a competência é o registro, e o tipo separa comissões de produção', () => {
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/financeiro/fechamentos', corpo: { tipo: 'comissao', competencia: '2026-09' } }), ['financeiro.fechar_comissoes:2026-09']);
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/financeiro/fechamentos', corpo: { tipo: 'producao', competencia: '2026-09' } }), ['financeiro.fechar_producao:2026-09']);
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/financeiro/pagamentos', corpo: { tipo: 'comissao', competencia: '2026-13' } }), [], 'competência inválida não casa');
});

test('financeiro: "até quitar" só conta quando a competência fica toda paga, e cada tipo o seu', () => {
  const pagar = (tipo, faltaPagar) => acoes({ metodo: 'POST', caminho: '/api/financeiro/pagamentos', corpo: { tipo, competencia: '2026-09' }, resposta: { falta_pagar: faltaPagar } });
  assert.deepStrictEqual(pagar('comissao', 0), ['financeiro.pagar:2026-09', 'financeiro.pagar_comissoes:2026-09']);
  assert.deepStrictEqual(pagar('comissao', 350.5), ['financeiro.pagar:2026-09'], 'pagou só um beneficiário: a tarefa de quitar continua');
  assert.deepStrictEqual(pagar('producao', 0), ['financeiro.pagar:2026-09', 'financeiro.pagar_producao:2026-09']);
  assert.deepStrictEqual(acoes({ metodo: 'POST', caminho: '/api/financeiro/pagamentos', corpo: { tipo: 'producao', competencia: '2026-09' } }), ['financeiro.pagar:2026-09'], 'sem a resposta, não se sabe se quitou');
});

test('normalizarAcao: ação conhecida, registro no formato certo', () => {
  assert.deepStrictEqual(A.normalizarAcao({}), { acao_chave: null, acao_registro: null, acao_rotulo: null });
  assert.deepStrictEqual(A.normalizarAcao({ acao_chave: 'pedido.despachar', acao_registro: '040', acao_rotulo: ' PED-40 ' }), { acao_chave: 'pedido.despachar', acao_registro: '40', acao_rotulo: 'PED-40' });
  assert.throws(() => A.normalizarAcao({ acao_chave: 'pedido.inventada', acao_registro: 1 }), /desconhecida/);
  assert.throws(() => A.normalizarAcao({ acao_chave: 'financeiro.pagar', acao_registro: '09/2026' }), /competência/);
  assert.throws(() => A.normalizarAcao({ acao_chave: 'cliente.cadastro' }), /o cliente/);
});

test('o catálogo da tela: cada ação no seu módulo, marcando o que pode', () => {
  const c = A.catalogo(chave => chave.startsWith('ped.'));
  assert.strictEqual(c.modulos.length, 5);
  assert.ok(c.acoes.length >= 20);
  assert.ok(c.acoes.every(a => A.MODULOS[a.modulo]), 'toda ação aponta para um módulo conhecido');
  assert.strictEqual(c.acoes.find(a => a.chave === 'pedido.despachar').pode, true);
  assert.strictEqual(c.acoes.find(a => a.chave === 'financeiro.pagar').pode, false);
  assert.ok(!('rotas' in c.acoes[0]), 'as rotas não vão para a tela');
});
