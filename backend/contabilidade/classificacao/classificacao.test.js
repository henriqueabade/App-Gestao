/**
 * Classificação (etapa 6) — as funções puras: as regras (regras.js), o plano
 * (plano.js) e a conta que vale para cada lançamento (classificacao.js). O que
 * fica preso:
 *   - a ordem: à mão > conciliação (categoria da conta a pagar, regra do
 *     fornecedor, origem do dinheiro) > regra de descrição/CNPJ > sem;
 *   - partes da conciliação em contas diferentes não escolhem sozinhas;
 *   - regra: palavra inteira, sentido, desativada não vale; vence a maior
 *     prioridade, depois o texto mais longo;
 *   - as regras sugeridas saem de 2+ classificações à mão iguais que nenhuma
 *     regra cobre;
 *   - o total por conta separa entradas e saídas; transferência e patrimônio
 *     não são resultado; "Sem classificação" no fim.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./regras');
const P = require('./plano');
const C = require('./classificacao');

const PLANO = [
  { id: 1, nome: 'Receita de vendas', tipo: 'receita' }, { id: 2, nome: 'Serviços de Terceiros', tipo: 'despesa' },
  { id: 3, nome: 'Despesas bancárias', tipo: 'despesa' }, { id: 4, nome: 'Comissões sobre vendas', tipo: 'despesa' },
  { id: 5, nome: 'Aquisição de Bens', tipo: 'custo' }, { id: 6, nome: 'Transferência entre contas', tipo: 'transferencia' },
  { id: 7, nome: 'Conta velha', tipo: 'despesa', ativa: false }
];
const REGRAS = [
  { id: 1, condicao_tipo: 'origem', valor: 'recebimento', sentido: 'credito', conta_id: 1, prioridade: 0, ativa: true },
  { id: 2, condicao_tipo: 'origem', valor: 'comissao', sentido: 'debito', conta_id: 4, prioridade: 0, ativa: true },
  { id: 3, condicao_tipo: 'descricao', valor: 'TARIFA', sentido: 'debito', conta_id: 3, prioridade: 0, ativa: true },
  { id: 4, condicao_tipo: 'fornecedor', valor: '9', sentido: 'ambos', conta_id: 5, prioridade: 0, ativa: true },
  { id: 5, condicao_tipo: 'descricao', valor: 'APLICACAO', sentido: 'ambos', conta_id: 6, prioridade: 0, ativa: true },
  { id: 6, condicao_tipo: 'descricao', valor: 'TARIFA PACOTE', sentido: 'debito', conta_id: 2, prioridade: 0, ativa: false }
];
const ctx = C.contexto({ plano: PLANO, regras: REGRAS });
const mov = (id, valor, descricao, extra = {}) => ({ id, valor, descricao, estado_conciliacao: 'pendente', ...extra });

test('validar a regra: cada condição no seu formato; sem conta ou valor, recusa', () => {
  assert.deepEqual(R.validarRegra({ condicao_tipo: 'descricao', valor: '  Tarifa  pacôte!', conta_id: '3', sentido: 'debito', prioridade: '5' }),
    { condicao_tipo: 'descricao', valor: 'TARIFA PACOTE', sentido: 'debito', conta_id: 3, prioridade: 5, ativa: true, observacao: null });
  assert.equal(R.validarRegra({ condicao_tipo: 'contrapartida', valor: '84.031.759/0001-21', conta_id: 1 }).valor, '84031759000121');
  assert.equal(R.validarRegra({ condicao_tipo: 'cfop', valor: '5102; 6102 5102', conta_id: 5 }).valor, '5102,6102');
  assert.equal(R.validarRegra({ condicao_tipo: 'origem', valor: 'producao', conta_id: 2, prioridade: 999 }).prioridade, 100);
  assert.throws(() => R.validarRegra({ condicao_tipo: 'descricao', valor: 'ab', conta_id: 1 }), /3 letras/);
  assert.throws(() => R.validarRegra({ condicao_tipo: 'contrapartida', valor: '123', conta_id: 1 }), /CNPJ/);
  assert.throws(() => R.validarRegra({ condicao_tipo: 'origem', valor: 'x', conta_id: 1 }), /origem/);
  assert.throws(() => R.validarRegra({ condicao_tipo: 'descricao', valor: 'TARIFA' }), /conta do plano/);
  assert.throws(() => R.validarRegra({ condicao_tipo: 'qualquer' }), /quando a regra vale/);
});

test('casar e escolher: palavra inteira, sentido, desativada não vale; maior prioridade e depois o texto mais longo', () => {
  assert.equal(R.casa(REGRAS[2], { descricao: 'Tarifa pacote de serviços', sentido: 'debito' }), true);
  assert.equal(R.casa(REGRAS[2], { descricao: 'TARIFAÇO', sentido: 'debito' }), false);
  assert.equal(R.casa(REGRAS[2], { descricao: 'Tarifa estornada', sentido: 'credito' }), false, 'regra só de saída');
  assert.equal(R.casa(REGRAS[5], { descricao: 'Tarifa pacote', sentido: 'debito' }), false, 'desativada');
  assert.equal(R.casa({ condicao_tipo: 'cfop', valor: '5101,5102' }, { cfops: '5102, 5405' }), true);
  const longa = { id: 9, condicao_tipo: 'descricao', valor: 'TARIFA PACOTE', sentido: 'ambos', conta_id: 2, prioridade: 0, ativa: true };
  assert.equal(R.escolher([REGRAS[2], longa], { descricao: 'Tarifa pacote', sentido: 'debito' }).id, 9, 'o texto mais longo é mais específico');
  const prioritaria = { ...REGRAS[2], id: 10, prioridade: 5 };
  assert.equal(R.escolher([longa, prioritaria], { descricao: 'Tarifa pacote', sentido: 'debito' }).id, 10, 'a prioridade vence');
  assert.equal(R.escolher(REGRAS, { descricao: 'Tarifa', sentido: 'debito' }, { condicoes: ['origem'] }), null);
});

test('regras sugeridas: 2+ classificações à mão com a mesma chave, sentido e conta, que nenhuma regra cobre', () => {
  assert.equal(R.chaveDaDescricao('PIX ENVIADO - VIDROS NORTE COMERCIO'), 'VIDROS NORTE');
  assert.equal(R.chaveDaDescricao('Pagamento de boleto - Imobiliária Centro'), 'IMOBILIARIA CENTRO');
  assert.equal(R.chaveDaDescricao('PIX 123'), null);
  assert.equal(R.chaveDaDescricao('PIX RECEBIDO - CLIENTE DA LOJA'), 'CLIENTE DA LOJA', 'a palavra de ligação do meio fica');
  assert.equal(P.chaveNome(' Serviços  de Terceiros'), 'servicos de terceiros');
  const s = R.sugeridas([
    { descricao: 'PIX ENVIADO - VIDROS NORTE', valor: -600, conta_id: 5 }, { descricao: 'PIX ENVIADO VIDROS NORTE LTDA', valor: -300, conta_id: 5 },
    { descricao: 'PIX ENVIADO - VIDROS NORTE', valor: 50, conta_id: 1 },
    { descricao: 'Tarifa pacote', valor: -12.9, conta_id: 3 }, { descricao: 'Tarifa pacote', valor: -12.9, conta_id: 3 }
  ], REGRAS);
  assert.deepEqual(s.map(x => [x.valor, x.sentido, x.conta_id, x.quantidade]), [['VIDROS NORTE', 'debito', 5, 2]], 'a tarifa já tem regra; a entrada da Vidros é uma só');
});

test('plano: validar, ordenar por tipo e nome (desativadas no fim), o que entra no resultado', () => {
  assert.deepEqual(P.validarConta({ nome: ' Energia ', tipo: 'xyz', codigo: '3.1.05' }), { nome: 'Energia', codigo: '3.1.05', tipo: 'despesa', ativa: true, observacao: null });
  assert.throws(() => P.validarConta({ nome: 'x' }), /nome/);
  assert.deepEqual(P.ordenar(PLANO).map(p => p.id), [1, 5, 4, 3, 2, 6, 7]);
  assert.deepEqual([P.contaPublica(PLANO[0]).do_resultado, P.contaPublica(PLANO[5]).do_resultado, P.contaPublica(PLANO[6]).ativa], [true, false, false]);
});

test('a conta de cada lançamento: à mão > conciliação > regra > sem', () => {
  const liqs = new Map([
    ['titulo_pagamento:1', { chave: 'titulo_pagamento:1', tipo: 'titulo_pagamento', valor: -2500, categoria: 'serviços de terceiros', rotulo: 'Aluguel', contato_id: 5 }],
    ['titulo_pagamento:2', { chave: 'titulo_pagamento:2', tipo: 'titulo_pagamento', valor: -600, categoria: null, rotulo: 'NF-e', contato_id: 9 }],
    ['titulo_pagamento:3', { chave: 'titulo_pagamento:3', tipo: 'titulo_pagamento', valor: -80, categoria: 'Categoria que não existe', rotulo: 'Recibo', contato_id: null }],
    ['recebimento:1', { chave: 'recebimento:1', tipo: 'recebimento', valor: 1200 }],
    ['recebimento:2', { chave: 'recebimento:2', tipo: 'recebimento', valor: 2500 }],
    ['financeiro_pagamento:70', { chave: 'financeiro_pagamento:70', tipo: 'financeiro_pagamento', subtipo: 'comissao', valor: -900 }]
  ]);
  const v = (tipo, id) => ({ alvo_tipo: tipo, alvo_id: id });
  const conciliado = extra => ({ estado_conciliacao: 'conciliado', ...extra });
  const ef = (m, vinculos = [], manual = null) => C.efetiva(m, { manual, vinculos, liqsPorChave: liqs, ctx });
  assert.deepEqual(['conta', 'criterio'].map(k => ef(mov(1, -2500, 'Boleto', conciliado()), [v('titulo_pagamento', 1)])[k]), ['Serviços de Terceiros', 'titulo'], 'categoria da conta, sem ligar para maiúsculas');
  assert.deepEqual(['conta', 'criterio'].map(k => ef(mov(2, -600, 'PIX', conciliado()), [v('titulo_pagamento', 2)])[k]), ['Aquisição de Bens', 'regra'], 'sem categoria: a regra do fornecedor');
  assert.equal(ef(mov(3, -80, 'Recibo', conciliado()), [v('titulo_pagamento', 3)]).criterio, 'sem', 'categoria fora do plano e sem regra');
  const soma = ef(mov(4, 3700, 'LIQUIDACAO DE COBRANCA', conciliado()), [v('recebimento', 1), v('recebimento', 2)]);
  assert.deepEqual([soma.conta, soma.criterio, soma.detalhe], ['Receita de vendas', 'origem', 'Recebimento de pedido']);
  assert.equal(ef(mov(5, -900, 'PIX', conciliado()), [v('financeiro_pagamento', 70)]).conta, 'Comissões sobre vendas');
  const misto = ef(mov(6, -3100, 'PAGAMENTOS', conciliado()), [v('titulo_pagamento', 1), v('financeiro_pagamento', 70)]);
  assert.deepEqual([misto.criterio, /contas diferentes/.test(misto.detalhe)], ['sem', true]);
  assert.deepEqual(['conta', 'criterio'].map(k => ef(mov(7, -12.9, 'Tarifa pacote de serviços'))[k]), ['Despesas bancárias', 'regra']);
  assert.equal(ef(mov(8, 5000, 'APLICACAO CDB')).conta, 'Transferência entre contas');
  const aMao = ef(mov(9, -12.9, 'Tarifa pacote'), [], { conta_id: 2, observacao: 'É o contador' });
  assert.deepEqual([aMao.conta, aMao.criterio, aMao.detalhe], ['Serviços de Terceiros', 'manual', 'É o contador'], 'a mão vence a regra');
  assert.equal(ef(mov(10, 100, 'PIX RECEBIDO')).criterio, 'sem', 'pendente sem regra');
  assert.equal(ef(mov(11, 1200, 'PIX', { estado_conciliacao: 'pendente' }), [v('recebimento', 1)]).criterio, 'sem', 'só conciliado classifica pela conciliação');
});

test('total por conta e visões: entradas × saídas; "Sem classificação" no fim; transferência fora do resultado', () => {
  const linha = (valor, conta_id, conta, conta_tipo, criterio = 'regra') => ({ valor, classificacao: { conta_id, conta, conta_tipo, criterio } });
  const linhas = [
    linha(1500, 1, 'Receita de vendas', 'receita', 'origem'), linha(1200, 1, 'Receita de vendas', 'receita', 'origem'),
    linha(-12.9, 3, 'Despesas bancárias', 'despesa'), linha(-5000, 6, 'Transferência entre contas', 'transferencia', 'manual'),
    linha(-80, null, null, null, 'sem'), linha(50, null, null, null, 'sem')
  ];
  assert.deepEqual(C.porConta(linhas).map(g => [g.conta, g.entradas, g.saidas, g.resultado, g.quantidade, g.do_resultado]), [
    ['Receita de vendas', 2700, 0, 2700, 2, true], ['Despesas bancárias', 0, -12.9, -12.9, 1, true],
    ['Transferência entre contas', 0, -5000, -5000, 1, false], ['Sem classificação', 50, -80, -30, 2, false]
  ]);
  assert.deepEqual(C.totaisDe(linhas), { total: 6, classificados: 4, sem: 2, sem_valor: 130, manuais: 1, automaticos: 3 });
  assert.deepEqual(['sem', 'manuais', 'automaticos', 'todos'].map(v => linhas.filter(l => C.naVisao(l, v)).length), [2, 1, 3, 6]);
});

// ------------------------------------------------------------- fase B (02/10/2026): o plano da AEA

/** Um pedaço do plano da AEA como o SQL da fase B grava (com as colunas novas). */
const aea = (id, reduzido, codigo, nome, tipo, extra = {}) => ({
  id, codigo_reduzido: reduzido, codigo, nome, tipo, natureza: 'D', analitica: true, nivel: codigo.split('.').length, ativa: true,
  origem: 'aea', em_uso: false, comprovante_basta: false, desdobra: false, conta_pai_id: null, ...extra
});
const PLANO_AEA = [
  aea(10, '00410', '3.02', 'Despesas Operacionais', 'despesa', { analitica: false }),
  aea(11, '00438', '3.02.01.03', 'DESPESAS ADMINISTRATIVAS', 'despesa', { analitica: false, em_uso: true }),
  aea(12, '00440', '3.02.01.03.002', 'Aluguel', 'despesa'),
  aea(13, '00372', '3.01.02.04.002', 'Aluguel', 'custo', { em_uso: true }),
  aea(14, '00383', '3.01.02.04.013', 'Energia Eletrica', 'custo', { em_uso: true, comprovante_basta: true }),
  aea(15, '00457', '3.02.01.03.019', 'Energia Elétrica', 'despesa', { em_uso: true }),
  aea(16, '00020', '1.01.01.04.002', 'Banco do Brasil', 'ativo', { em_uso: true, desdobra: true }),
  { ...aea(17, '00020.002', '1.01.01.04.002.002', 'CDB', 'ativo', { em_uso: true, conta_pai_id: 16 }), origem: 'desdobrado' },
  { ...aea(18, '00020.001', '1.01.01.04.002.001', 'Rende Fácil', 'ativo', { em_uso: true, conta_pai_id: 16 }), origem: 'desdobrado' },
  aea(19, '00008', '1.01.01.02.002', 'Banco do Brasil', 'ativo', { em_uso: true }),
  aea(20, '00528', '4.01.01.01.002', 'Industrialização de Mercadorias', 'receita', { em_uso: true, natureza: 'C' }),
  { id: 30, nome: 'Conta própria', tipo: 'despesa', ativa: true, origem: 'manual' }
];

test('fase B — plano da AEA: código reduzido no rótulo, só a analítica em uso se escolhe, a árvore na ordem da classificação', () => {
  const pub = P.contaPublica(PLANO_AEA.find(p => p.id === 14));
  assert.deepEqual([pub.codigo, pub.classificacao, pub.rotulo, pub.selecionavel, pub.comprovante_basta, pub.em_uso, pub.origem_rotulo],
    ['00383', '3.01.02.04.013', '00383 · Energia Eletrica', true, true, true, 'Plano da AEA']);
  assert.deepEqual(PLANO_AEA.filter(P.selecionavel).map(p => p.id), [13, 14, 15, 16, 17, 18, 19, 20, 30], 'nem a sintética (mesmo marcada) nem a fora de uso');
  assert.deepEqual(P.ordenar(PLANO_AEA).map(p => p.codigo_reduzido || p.nome),
    ['00008', '00020', '00020.001', '00020.002', '00372', '00383', '00410', '00438', '00440', '00457', '00528', 'Conta própria']);
  assert.equal(P.DO_RESULTADO.has('ativo') || P.DO_RESULTADO.has('passivo'), false, 'ativo e passivo não são resultado');
  assert.equal(P.rotuloDeCategoria(PLANO_AEA.find(p => p.id === 30)), 'Conta própria', 'a conta à mão guarda só o nome');
});

test('fase B — a categoria da conta a pagar acha a conta pelo código; pelo nome só quando ele é único entre as em uso', () => {
  const achar = t => P.contaDaCategoria(t, PLANO_AEA)?.id ?? null;
  assert.deepEqual([achar('00383 · Energia Eletrica'), achar('00440 · Aluguel'), achar('00020.001 · Rende Fácil'), achar('99999 · Nada')], [14, 12, 18, null],
    'pelo código vale mesmo fora de uso (a categoria já gravada não se perde)');
  assert.equal(achar('Aluguel'), 13, 'nome repetido no plano, mas só o 00372 está em uso');
  assert.equal(achar('Energia elétrica'), null, '00383 e 00457 estão em uso com o mesmo nome (sem acento): ambíguo');
  assert.equal(achar('Banco do Brasil'), null);
  assert.equal(achar('Conta própria'), 30);
  // A classificação usa o código da categoria e devolve o código reduzido.
  const ctxB = C.contexto({ plano: PLANO_AEA, regras: [] });
  const liq = { chave: 'titulo_pagamento:1', tipo: 'titulo_pagamento', valor: -300, categoria: '00383 · Energia Eletrica', rotulo: 'Conta de luz' };
  const cls = C.efetiva({ id: 1, valor: -300, descricao: 'PAGTO CEMIG', estado_conciliacao: 'conciliado' }, { vinculos: [{ alvo_tipo: 'titulo_pagamento', alvo_id: 1 }], liqsPorChave: new Map([[liq.chave, liq]]), ctx: ctxB });
  assert.deepEqual([cls.conta_id, cls.conta_codigo, cls.criterio], [14, '00383', 'titulo']);
});

test('fase B — desdobramento: o próximo final de três dígitos (.001, .012, .123) e o limite de 999', () => {
  const pai = PLANO_AEA.find(p => p.id === 16);
  assert.equal(P.proximoFinal(pai, PLANO_AEA), '003');
  assert.equal(P.proximoFinal({ codigo_reduzido: '00223' }, []), '001');
  assert.equal(P.proximoFinal({ codigo_reduzido: '00223' }, [{ codigo_reduzido: '00223.011' }, { codigo_reduzido: '00223.004' }]), '012');
  assert.equal(P.proximoFinal({ codigo_reduzido: '00223' }, [{ codigo_reduzido: '00223.122' }]), '123');
  assert.throws(() => P.proximoFinal({ codigo_reduzido: '00223' }, [{ codigo_reduzido: '00223.999' }]), /999 desdobramentos/);
});
