/**
 * Versões do fechamento (etapa 7) — as funções puras (versoes.js) e a
 * classificação congelada (classificacao.aplicarCongelado). O que fica preso:
 *   - a foto do lançamento, o hash (não depende da ordem; muda com a conta);
 *   - o resultado do mês por tipo de conta (transferência e patrimônio fora);
 *   - as diferenças desde o fechamento: lançamento novo, que sumiu, valor,
 *     conta que seria outra hoje, números das fontes; sem a lista de hoje,
 *     não compara lançamento;
 *   - comparar duas versões: contas que mudaram, novos, saíram, reclassificados;
 *   - mês fechado: vale a conta congelada; a de hoje vai em `atual`;
 *   - o checklist fechado com diferenças: um aviso e a lista na situação.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./versoes');
const C = require('./classificacao/classificacao');
const ck = require('./checklist');

const semNbsp = t => String(t).replace(/ /g, ' ');
const lanc = (id, data, valor, conta_id, conta, conta_tipo = 'despesa') => ({ id, data, valor, descricao: `L${id}`, conta_financeira_id: 1, conta_id, conta, conta_tipo, criterio: conta_id ? 'regra' : 'sem' });

test('foto do lançamento e o hash: mesma lista em outra ordem dá o mesmo; mudar a conta muda', () => {
  const l = V.lancamentoDaFoto({ id: 7, data: '2026-08-05T00:00:00Z', valor: '-2500.00', descricao: 'x'.repeat(300), conta_id: 1, estado_conciliacao: 'conciliado' },
    { conta_id: 2, conta: 'Serviços de Terceiros', conta_tipo: 'despesa', criterio: 'titulo' });
  assert.deepEqual([l.data, l.valor, l.descricao.length, l.conta_financeira_id, l.conta, l.criterio], ['2026-08-05', -2500, 160, 1, 'Serviços de Terceiros', 'titulo']);
  assert.equal(V.lancamentoDaFoto({ id: 8, data: '2026-08-06', valor: 10 }).conta_id, null);
  const a = [lanc(1, '2026-08-01', 100, 1, 'Receita'), lanc(2, '2026-08-02', -50, 2, 'Despesa')];
  assert.equal(V.hashDe(a), V.hashDe([...a].reverse()));
  assert.equal(V.hashDe(a).length, 64);
  assert.notEqual(V.hashDe(a), V.hashDe([a[0], { ...a[1], conta_id: 3 }]));
});

test('resultado do mês: por tipo; transferência e patrimônio fora; o que ficou sem conta à parte', () => {
  const r = V.resultadoDe([
    { conta_id: 1, conta: 'Receita de vendas', tipo: 'receita', entradas: 4700, saidas: 0, resultado: 4700, quantidade: 2 },
    { conta_id: 2, conta: 'Devoluções', tipo: 'deducao', entradas: 0, saidas: -80, resultado: -80, quantidade: 1 },
    { conta_id: 3, conta: 'Aquisição de Bens', tipo: 'custo', entradas: 0, saidas: -600, resultado: -600, quantidade: 1 },
    { conta_id: 4, conta: 'Despesas bancárias', tipo: 'despesa', entradas: 0, saidas: -12.9, resultado: -12.9, quantidade: 1 },
    { conta_id: 5, conta: 'Transferência', tipo: 'transferencia', entradas: 0, saidas: -5000, resultado: -5000, quantidade: 1 },
    { conta_id: null, conta: 'Sem classificação', tipo: null, entradas: 50, saidas: 0, resultado: 50, quantidade: 1 }
  ]);
  assert.deepEqual([r.receitas, r.deducoes, r.custos, r.despesas, r.resultado, r.fora_do_resultado, r.sem_classificacao], [4700, -80, -600, -12.9, 4007.1, -5000, 50]);
  assert.equal(r.por_conta.length, 6);
});

test('diferenças desde o fechamento: novo, sumiu, valor, conta de hoje, números das fontes; sem a lista de hoje não compara lançamento', () => {
  const versao = {
    versao: 1, fechada_em: '2026-09-02T10:00:00Z',
    lancamentos: [lanc(1, '2026-08-05', -2500, 2, 'Serviços de Terceiros'), lanc(2, '2026-08-12', 1850, null, null), lanc(3, '2026-08-31', -12.9, 4, 'Despesas bancárias')],
    foto: { fontes: [{ chave: 'nfe_saida', numeros: { autorizadas: 3, valor_autorizado: 1500, canceladas: 0 } }, { chave: 'recebimentos', numeros: { recebido: 3700, recebidos: 2 } }] }
  };
  const d = V.divergencias(versao, {
    lancamentos: [lanc(1, '2026-08-05', -2500, 2, 'Serviços de Terceiros'), lanc(2, '2026-08-12', 1850, 1, 'Receita de vendas'), lanc(4, '2026-08-20', -99, null, null)],
    fontes: [{ chave: 'nfe_saida', numeros: { autorizadas: 2, valor_autorizado: 1000, canceladas: 1 } }, { chave: 'recebimentos', numeros: { recebido: 3700, recebidos: 2 } }]
  });
  assert.deepEqual(d.map(x => x.tipo), ['classificacao', 'lancamento_novo', 'lancamento_sumiu', 'fonte_nfe_saida', 'fonte_nfe_saida']);
  assert.equal(semNbsp(d[0].descricao), 'no fechamento: sem classificação; hoje: Receita de vendas');
  assert.equal(semNbsp(d[3].descricao), 'no fechamento: 3 · R$ 1.500,00; hoje: 2 · R$ 1.000,00');
  assert.deepEqual(V.divergencias(versao, { lancamentos: null, fontes: versao.foto.fontes }), [], 'sem a lista de hoje, só as fontes');
  assert.deepEqual(V.divergencias(null, {}), []);
});

test('comparar versões: o resultado, as contas que mudaram, novos, saíram e reclassificados', () => {
  const v1 = {
    versao: 1, hash: 'a', lancamentos: [lanc(1, '2026-08-05', -2500, 2, 'Serviços'), lanc(2, '2026-08-12', 1850, null, null)],
    foto: { resultado: { resultado: -2500, por_conta: [{ conta_id: 2, conta: 'Serviços', resultado: -2500 }, { conta_id: null, conta: 'Sem classificação', resultado: 1850 }] } }
  };
  const v2 = {
    versao: 2, hash: 'b', lancamentos: [lanc(1, '2026-08-05', -2500, 2, 'Serviços'), lanc(2, '2026-08-12', 1850, 1, 'Receita'), lanc(3, '2026-08-31', -12.9, 4, 'Bancárias')],
    foto: { resultado: { resultado: -662.9, por_conta: [{ conta_id: 2, conta: 'Serviços', resultado: -2500 }, { conta_id: 1, conta: 'Receita', resultado: 1850 }, { conta_id: 4, conta: 'Bancárias', resultado: -12.9 }] } }
  };
  const x = V.compararVersoes(v1, v2);
  assert.deepEqual([x.de, x.para, x.mesmo_hash, x.novos, x.sairam, x.reclassificados], [1, 2, false, 1, 0, 1]);
  assert.deepEqual(x.resultado, { antes: -2500, depois: -662.9 });
  assert.deepEqual(x.contas.map(c => [c.conta, c.diferenca]), [['Sem classificação', -1850], ['Receita', 1850], ['Bancárias', -12.9]]);
  assert.equal(V.compararVersoes(null, v2), null);
  const p = V.publica({ ...v2, id: 9, fechada_em: '2026-09-02T13:00:00Z', fechada_por: 3, pendencias: [{ nivel: 'aviso' }] }, new Map([['3', 'Henrique']]));
  assert.deepEqual([p.versao, p.fechada_por, p.lancamentos, p.sem_classificacao, p.pendencias.length], [2, 'Henrique', 3, 0, 1]);
});

test('mês fechado: vale a conta congelada; a de hoje vai em "atual" quando é outra', () => {
  const itens = [
    { movimento: { id: 1 }, classificacao: { conta_id: 2, conta: 'Serviços', criterio: 'titulo' } },
    { movimento: { id: 2 }, classificacao: { conta_id: 1, conta: 'Receita', criterio: 'regra' } },
    { movimento: { id: 3 }, classificacao: { conta_id: 4, conta: 'Bancárias', criterio: 'regra' } }
  ];
  const congelado = V.congeladoDe({ lancamentos: [lanc(1, '2026-08-05', -2500, 2, 'Serviços'), lanc(2, '2026-08-12', 1850, null, null)] });
  const r = C.aplicarCongelado(itens, congelado);
  assert.deepEqual([r[0].classificacao.criterio, r[0].atual], ['fechamento', null]);
  assert.deepEqual([r[1].classificacao.conta_id, r[1].classificacao.criterio, r[1].atual.conta], [null, 'sem', 'Receita']);
  assert.deepEqual([r[2].classificacao.criterio, r[2].atual], ['regra', null], 'fora da versão: a de hoje');
  assert.equal(C.aplicarCongelado(itens, null), itens);
});

test('checklist fechado com diferenças: um aviso (não bloqueia) e a lista na situação', () => {
  const base = {
    competencia: '2026-08', hoje: '2026-09-28', notas: [], aguardando: { pedidos: [] }, receber: { pendencias: [] },
    fechamentos: [{ tipo: 'comissao', competencia: '2026-08', total: 10, falta_pagar: 0 }, { tipo: 'producao', competencia: '2026-08', total: 10, falta_pagar: 0 }],
    situacao: { status: 'fechada', fechada_em: '2026-09-02T10:00:00-03:00' }
  };
  const versao = { versao: 2, fechada_em: '2026-09-02T10:00:00-03:00', lancamentos: [lanc(1, '2026-08-12', 1850, null, null)], foto: { fontes: [] } };
  const p = ck.montar({ ...base, versao: { versao, lancamentos: [lanc(1, '2026-08-12', 1850, 1, 'Receita de vendas')] } });
  const aviso = p.pendencias.find(x => x.chave === 'fechamento_diferencas');
  assert.deepEqual([aviso.nivel, aviso.titulo, aviso.filtro], ['aviso', '1 diferença desde o fechamento (versão 2)', { acao: 'fechamentos' }]);
  assert.deepEqual([p.situacao.versao, p.situacao.diferencas, p.situacao.diferencas_lista[0].tipo], [2, 1, 'classificacao']);
  assert.equal(p.pode.reabrir, true);
  const semDiferenca = ck.montar({ ...base, versao: { versao, lancamentos: [lanc(1, '2026-08-12', 1850, null, null)] } });
  assert.deepEqual([semDiferenca.situacao.diferencas, semDiferenca.pendencias.some(x => x.chave === 'fechamento_diferencas')], [0, false]);
  const aberta = ck.montar({ ...base, situacao: { status: 'reaberta' }, versao: { versao, lancamentos: [] } });
  assert.deepEqual([aberta.situacao.versao, aberta.situacao.diferencas], [null, 0], 'reaberta não compara');
});
