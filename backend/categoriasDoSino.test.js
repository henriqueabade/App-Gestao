/**
 * As categorias do sino (decisão do dono, 02/10/2026): cada aviso na sua
 * categoria; desmarcar uma categoria esconde só os avisos dela — na lista e
 * na contagem do sino (o servidor filtra) e na janela do canto (main.js).
 * Os avisos do próprio cadastro sempre aparecem; o interruptor geral
 * desligado esconde tudo.
 */
const test = require('node:test');
const assert = require('node:assert');

const C = require('../src/js/utils/categorias-aviso');
const { montarAvisos, categoriasOcultas } = require('./notificacoesController');

test('cada aviso na sua categoria', () => {
  const casos = [
    [{ tipo: 'tarefa_lembrete', origem: 'tarefa' }, 'tasks'],
    [{ tipo: 'tarefa_atrasada' }, 'tasks'],
    [{ tipo: 'convite_tarefa', origem: 'tarefa' }, 'tasks'],
    [{ tipo: 'registro_alterado', origem: 'tarefa' }, 'tasks'],
    [{ tipo: 'comentario', origem: 'tarefa' }, 'tasks'],
    [{ tipo: 'responsavel_novo', origem: 'prospeccao' }, 'sales'],
    [{ tipo: 'comentario', origem: 'cliente' }, 'sales'],
    [{ tipo: 'registro_excluido', origem: 'pedido' }, 'sales'],
    [{ tipo: 'registro_alterado', origem: 'orcamento' }, 'sales'],
    [{ tipo: 'registro_cancelado', origem: 'financeiro' }, 'finance'],
    [{ tipo: 'registro_cancelado', origem: 'contabil' }, 'finance'],
    [{ tipo: 'mencao', origem: 'contabilidade' }, 'finance'],
    [{ tipo: 'conta_alterada', origem: 'usuario' }, 'conta'],
    [{}, 'sales']
  ];
  for (const [aviso, esperada] of casos) assert.strictEqual(C.categoriaDoAviso(aviso), esperada, JSON.stringify(aviso));
});

test('ocultas e aparece: categoria desmarcada some; cadastro sempre aparece; geral desligado esconde tudo', () => {
  const semTarefas = { enabled: true, categories: { tasks: false, sales: true, finance: true, system: false } };
  assert.deepStrictEqual(C.ocultas(semTarefas), ['tasks'], '"Atualizações do sistema" não entra no sino');
  assert.strictEqual(C.aparece({ tipo: 'tarefa_lembrete' }, semTarefas), false);
  assert.strictEqual(C.aparece({ tipo: 'responsavel_novo', origem: 'prospeccao' }, semTarefas), true);
  assert.strictEqual(C.aparece({ tipo: 'conta_alterada', origem: 'usuario' }, { categories: { tasks: false, sales: false, finance: false } }), true);
  assert.deepStrictEqual(C.ocultas({}), [], 'sem escolha = tudo ligado');
  assert.strictEqual(C.aparece({ tipo: 'conta_alterada' }, { enabled: false }), false);
  // Antes, desmarcar "Vendas e pedidos" calava o sino inteiro; agora só as vendas.
  const semVendas = { categories: { sales: false } };
  assert.strictEqual(C.aparece({ tipo: 'tarefa_lembrete' }, semVendas), true);
  assert.strictEqual(C.aparece({ tipo: 'comentario', origem: 'cliente' }, semVendas), false);
});

test('servidor: ?ocultar tira a categoria da lista E da contagem de não lidos', () => {
  const linhas = [
    { id: 1, tipo: 'tarefa_lembrete', origem: 'tarefa', titulo: 'Lembrete', mensagem: 'Ligar', criado_em: '2026-10-02T10:00:00Z' },
    { id: 2, tipo: 'responsavel_novo', origem: 'prospeccao', titulo: 'Prospecção agora é sua', mensagem: 'ACME', criado_em: '2026-10-02T11:00:00Z' },
    { id: 3, tipo: 'registro_cancelado', origem: 'financeiro', titulo: 'Ajuste cancelado', mensagem: 'x', criado_em: '2026-10-02T12:00:00Z', lida_em: '2026-10-02T12:30:00Z' },
    { id: 4, tipo: 'conta_alterada', origem: 'usuario', titulo: 'Seu cadastro foi alterado', mensagem: 'x', criado_em: '2026-10-02T13:00:00Z' }
  ];
  const tudo = montarAvisos(linhas);
  assert.strictEqual(tudo.nao_lidas, 3);
  const semTarefas = montarAvisos(linhas, new Map(), 50, new Set(), categoriasOcultas({ ocultar: 'tasks' }));
  assert.deepStrictEqual(semTarefas.itens.map(i => i.id), [4, 3, 2]);
  assert.strictEqual(semTarefas.nao_lidas, 2);
  const quase = montarAvisos(linhas, new Map(), 50, new Set(), categoriasOcultas({ ocultar: 'tasks,sales,finance,conta,qualquer' }));
  assert.deepStrictEqual(quase.itens.map(i => i.id), [4], 'o cadastro não se esconde pelo filtro');
  assert.deepStrictEqual([...categoriasOcultas({ ocultar: ['sales', 'finance'] })], ['sales', 'finance']);
  assert.strictEqual(categoriasOcultas({}).size, 0);
});
