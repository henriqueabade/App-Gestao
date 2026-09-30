/**
 * Conciliação (etapa 5) — as funções puras: o motor (motor.js), a forma
 * única das liquidações (liquidacoes.js) e as contas da conciliação
 * (conciliacao.js). O que fica preso:
 *   - automático SÓ com par único dos dois lados + chave (CNPJ/CPF da
 *     contrapartida ou nº do documento); o resto é sugestão;
 *   - as janelas de data (boleto: crédito em até 5 dias; cartão: 35; os
 *     outros: 3 antes a 4 depois) e o sentido (entrada × saída);
 *   - dois débitos iguais para um pagamento: sugestão, nunca única;
 *   - o crédito de cobrança que soma os boletos do dia vira composição;
 *   - estornado, dinheiro e o que já está ligado ficam de fora;
 *   - vínculo com registro estornado ou de valor menor é inválido;
 *   - "sem lançamento no extrato" só no trecho que o extrato cobre.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const motor = require('./motor');
const L = require('./liquidacoes');
const conc = require('./conciliacao');

const liq = (tipo, id, data, valor, extra = {}) => {
  const base = {
    recebimento: () => L.deRecebimento({ id, pedido_id: 1, numero_parcela: 1, data_recebimento: data, valor_recebido: valor, status: 'confirmado', origem: extra.origem || 'manual', forma: 'forma' in extra ? extra.forma : 'Pix', data_credito: extra.data_credito || null }),
    titulo_pagamento: () => L.deTituloPagamento({ id, titulo_id: 9, parcela_id: 90, data_pagamento: data, valor_pago: valor, forma: extra.forma || 'Pix' }, {
      titulos: new Map([['9', { id: 9, descricao: extra.descricao || 'Conta', contato_id: 5, numero_documento: extra.numero || null }]]),
      contatos: new Map([['5', { id: 5, nome: extra.nome || 'Fornecedor Qualquer', cnpj: extra.cnpj || null }]]),
      parcelas: new Map([['90', { id: 90, titulo_id: 9, numero: 1 }]])
    }),
    financeiro_pagamento: () => L.deFinanceiroPagamento({ id, tipo: 'comissao', competencia: '2026-07', valor, data_pagamento: data, forma: extra.forma || 'Pix', beneficiario: extra.nome || 'Ana' })
  }[tipo]();
  return { ...base, restante: extra.restante ?? base.valor_abs };
};
const mov = (id, data, valor, extra = {}) => ({ id, data, valor, restante: Math.abs(valor), descricao: extra.descricao || '', documento: extra.documento || null, contrapartida_documento: extra.cnpj || null });

test('janelas: boleto recebido até 5 dias depois (a data de crédito é o alvo); cartão até 35; os outros 3 antes e 4 depois', () => {
  const boleto = liq('recebimento', 1, '2026-08-10', 100, { origem: 'boleto', forma: null });
  assert.equal(boleto.forma, 'Boleto');
  assert.deepEqual(motor.janela(boleto), { alvo: '2026-08-10', de: '2026-08-10', ate: '2026-08-15' });
  assert.deepEqual(motor.janela(liq('recebimento', 2, '2026-08-10', 100, { origem: 'boleto', forma: null, data_credito: '2026-08-11' })), { alvo: '2026-08-11', de: '2026-08-10', ate: '2026-08-16' });
  assert.deepEqual(motor.janela(liq('titulo_pagamento', 3, '2026-08-10', 100)), { alvo: '2026-08-10', de: '2026-08-07', ate: '2026-08-14' });
  assert.equal(motor.janela(liq('titulo_pagamento', 4, '2026-08-10', 100, { forma: 'Cartão' })).ate, '2026-09-14');
  assert.equal(motor.somarDias('2026-02-27', 3), '2026-03-02');
  assert.equal(motor.diasEntre('2026-08-30', '2026-09-02'), 3);
});

test('nome na descrição: sem acento, palavras de 4+ letras, ignora LTDA/PIX/(simulado)', () => {
  assert.equal(motor.nomeNaDescricao('Imobiliária Centro (simulado)', 'Pagamento de boleto - IMOBILIARIA CENTRO'), true);
  assert.equal(motor.nomeNaDescricao('Contabilidade Exata (simulado)', 'TED enviada - Exata Serviços Contábeis'), true, 'uma palavra de 5+ letras basta');
  assert.equal(motor.nomeNaDescricao('Vidros Norte LTDA', 'PIX RECEBIDO - CASA VICENZO'), false);
  assert.equal(motor.nomeNaDescricao('Ana', 'PIX ENVIADO - ANA'), false, 'nome curto demais não conta');
  assert.equal(motor.nomeNaDescricao(null, 'qualquer'), false);
});

test('pontuar: sentido, janela, mesmo valor, CNPJ e nº de documento (chaves), nome; "livre" ignora a janela', () => {
  const pag = liq('titulo_pagamento', 1, '2026-08-20', 600, { nome: 'Vidros Norte', cnpj: '84031759000121', numero: '4521' });
  assert.equal(motor.pontuar(mov(1, '2026-08-20', 600), pag), null, 'crédito × pagamento: outro sentido');
  assert.equal(motor.pontuar(mov(1, '2026-08-28', -600), pag), null, 'fora da janela');
  const simples = motor.pontuar(mov(1, '2026-08-21', -600), pag);
  assert.deepEqual([simples.exato, simples.forte, simples.dias, simples.motivos], [true, false, 1, ['mesmo valor', '1 dia de diferença']]);
  const comCnpj = motor.pontuar(mov(1, '2026-08-20', -600, { cnpj: '84.031.759/0001-21' }), pag);
  assert.deepEqual([comCnpj.forte, comCnpj.motivos], [true, ['mesmo valor', 'mesmo dia', 'mesmo CNPJ/CPF']]);
  const comDoc = motor.pontuar(mov(1, '2026-08-20', -600, { documento: '0004521' }), pag);
  assert.equal(comDoc.forte, true);
  const comNome = motor.pontuar(mov(1, '2026-08-20', -600, { descricao: 'PIX ENVIADO - VIDROS NORTE COMERCIO' }), pag);
  assert.deepEqual([comNome.forte, comNome.nome], [false, true]);
  assert.ok(comNome.pontos > simples.pontos);
  const outroValor = motor.pontuar(mov(1, '2026-08-20', -612), pag);
  assert.equal(outroValor.exato, false);
  assert.ok(motor.pontuar(mov(1, '2026-10-20', -600), pag, { livre: true }), 'livre: fora da janela ainda pontua');
});

test('sugerir: automático só com par único + chave; sem chave é sugestão única; dois débitos iguais para um pagamento não são únicos', () => {
  const aluguel = liq('titulo_pagamento', 1, '2026-08-05', 2500, { nome: 'Imobiliária Centro', cnpj: '23132546000100' });
  const vidros = liq('titulo_pagamento', 2, '2026-08-20', 600, { nome: 'Vidros Norte' });
  const das = liq('titulo_pagamento', 3, '2026-08-20', 321.45, { nome: null });
  const movs = [
    mov(10, '2026-08-05', -2500, { cnpj: '23132546000100' }),
    mov(11, '2026-08-20', -600, { descricao: 'PIX ENVIADO - VIDROS NORTE' }),
    mov(12, '2026-08-20', -321.45),
    mov(13, '2026-08-21', -321.45),
    mov(14, '2026-08-31', -12.9, { descricao: 'Tarifa' })
  ];
  const r = motor.sugerir(movs, [aluguel, vidros, das]);
  assert.deepEqual([r.get(10).tipo, r.get(10).unica, r.get(10).itens], ['automatico', true, ['titulo_pagamento:1']]);
  assert.deepEqual([r.get(11).tipo, r.get(11).unica], ['sugestao', true]);
  assert.ok(r.get(11).motivos.includes('nome na descrição'));
  assert.deepEqual([r.get(12).tipo, r.get(12).unica, r.get(13).tipo, r.get(13).unica], ['sugestao', false, 'sugestao', false], 'o mesmo DAS serve para os dois débitos');
  assert.equal(r.has(14), false, 'a tarifa não tem par');
});

test('sugerir: o crédito de cobrança que soma os boletos do dia vira composição (nunca automático)', () => {
  const b1 = liq('recebimento', 1, '2026-08-10', 1200, { origem: 'boleto', forma: null });
  const b2 = liq('recebimento', 2, '2026-08-10', 2500, { origem: 'boleto', forma: null });
  const b3 = liq('recebimento', 3, '2026-08-03', 999, { origem: 'boleto', forma: null });
  const r = motor.sugerir([mov(20, '2026-08-11', 3700, { descricao: 'LIQUIDACAO DE COBRANCA' })], [b1, b2, b3]);
  const s = r.get(20);
  assert.deepEqual([s.tipo, s.unica, [...s.itens].sort(), s.soma], ['composicao', false, ['recebimento:1', 'recebimento:2'], 3700]);
  assert.match(s.motivos[0], /soma de 2 \(recebimento\)/);
});

test('sugerir: estornado, já ligado (restante 0) e o outro sentido ficam de fora', () => {
  const estornado = { ...liq('recebimento', 1, '2026-08-10', 500), estornado: true };
  const ligado = liq('recebimento', 2, '2026-08-10', 500, { restante: 0 });
  const saida = liq('titulo_pagamento', 3, '2026-08-10', 500);
  assert.equal(motor.sugerir([mov(1, '2026-08-10', 500)], [estornado, ligado, saida]).size, 0);
});

test('candidatas da escolha à mão: mesmo sentido, na janela de dias, as de mesmo valor primeiro', () => {
  const lista = motor.candidatasDoMovimento(mov(1, '2026-08-20', -600), [
    liq('titulo_pagamento', 1, '2026-08-19', 350), liq('titulo_pagamento', 2, '2026-08-10', 600),
    liq('titulo_pagamento', 3, '2026-06-01', 600), liq('recebimento', 4, '2026-08-20', 600)
  ], { dias: 15 });
  assert.deepEqual(lista.map(x => x.liq.chave), ['titulo_pagamento:2', 'titulo_pagamento:1']);
  assert.equal(lista[0].p.exato, true);
});

test('liquidações: cada fonte na mesma forma; dinheiro fora do banco; cartão com data incerta; restante pelos vínculos valendo', () => {
  const rec = L.deRecebimento({ id: 7, pedido_id: 3, numero_parcela: 2, data_recebimento: '2026-08-10', valor_recebido: '1500.00', status: 'confirmado', origem: 'boleto', boleto_id: 44 }, {
    pedidos: new Map([['3', { id: 3, numero: 2540, cliente_id: 8 }]]), clientes: new Map([['8', { id: 8, nome_fantasia: 'Casa Vicenzo', cnpj: '11.444.777/0001-61' }]])
  });
  assert.deepEqual([rec.chave, rec.valor, rec.rotulo, rec.nome, rec.documento, rec.forma, rec.detalhe, rec.referencia, rec.competencia],
    ['recebimento:7', 1500, 'Pedido 2540 · parcela 2', 'Casa Vicenzo', '11444777000161', 'Boleto', 'boleto pago', '44', '2026-08']);
  assert.equal(L.deRecebimento({ id: 8, status: 'estornado', data_recebimento: '2026-08-01', valor_recebido: 1 }).estornado, true);
  const tit = L.deTituloPagamento({ id: 5, titulo_id: 2, parcela_id: 21, data_pagamento: '2026-08-20', valor_pago: 600, forma: 'Dinheiro' }, {
    titulos: new Map([['2', { id: 2, descricao: 'NF-e 1/4521', categoria: 'Aquisição de Bens' }]]),
    parcelas: new Map([['21', { id: 21, titulo_id: 2, numero: 1 }], ['22', { id: 22, titulo_id: 2, numero: 2 }]])
  });
  assert.deepEqual([tit.valor, tit.rotulo, tit.no_banco, tit.detalhe], [-600, 'NF-e 1/4521 · parcela 1/2', false, 'Aquisição de Bens']);
  const fin = L.deFinanceiroPagamento({ id: 70, tipo: 'producao', competencia: '2026-07', valor: 900, data_pagamento: '2026-08-10', forma: 'Pix' });
  assert.deepEqual([fin.valor, fin.rotulo], [-900, 'Produção de julho/2026']);
  const reemb = L.deReembolso({ id: 3, pedido_id: 3, valor: 80, data_pagamento: '2026-08-12', forma: 'Pix', status: 'pago' }, { pedidos: new Map([['3', { numero: 2540 }]]) });
  assert.deepEqual([reemb.valor, reemb.rotulo, reemb.estornado], [-80, 'Reembolso do pedido 2540', false]);
  assert.equal(liq('titulo_pagamento', 1, '2026-08-01', 10, { forma: 'Cartão' }).data_incerta, true);
  const rest = L.restantes([rec, fin], [
    { alvo_tipo: 'recebimento', alvo_id: 7, valor: 1000 }, { alvo_tipo: 'recebimento', alvo_id: 7, valor: 500, desfeito_em: '2026-08-12' }
  ]);
  assert.deepEqual([rest.get('recebimento:7'), rest.get('financeiro_pagamento:70')], [500, 900]);
});

test('conciliação: vínculo inválido (estornado, sumiu, valor menor); "sem lançamento" só no trecho coberto; totais e visões', () => {
  const rec = { ...liq('recebimento', 1, '2026-08-10', 500), estornado: true };
  const pag = liq('titulo_pagamento', 2, '2026-08-20', 300);
  const porChave = new Map([[rec.chave, rec], [pag.chave, pag]]);
  const inval = conc.vinculosInvalidos([
    { id: 1, movimento_id: 10, alvo_tipo: 'recebimento', alvo_id: 1, valor: 500 },
    { id: 2, movimento_id: 11, alvo_tipo: 'titulo_pagamento', alvo_id: 2, valor: 400 },
    { id: 3, movimento_id: 12, alvo_tipo: 'reembolso', alvo_id: 9, valor: 10 },
    { id: 4, movimento_id: 13, alvo_tipo: 'titulo_pagamento', alvo_id: 2, valor: 300, desfeito_em: '2026-08-25' }
  ], porChave);
  assert.deepEqual(inval.map(x => [x.vinculo.id, x.motivo.replace(/ /g, ' ')]), [[1, 'recebimento estornado'], [2, 'o valor mudou para R$ 300,00'], [3, 'o registro não existe mais']]);

  const cob = { exigido_ate: '2026-08-31', faltas: [{ de: '2026-08-29', ate: '2026-08-31' }] };
  assert.deepEqual([conc.coberto('2026-08-10', cob, '2026-08'), conc.coberto('2026-08-30', cob, '2026-08'), conc.coberto('2026-07-31', cob, '2026-08')], [true, false, false]);
  const sem = conc.semLancamento([
    liq('titulo_pagamento', 1, '2026-08-10', 100), liq('titulo_pagamento', 2, '2026-08-30', 100),
    liq('titulo_pagamento', 3, '2026-08-11', 100, { forma: 'Dinheiro' }), liq('titulo_pagamento', 4, '2026-08-12', 100, { forma: 'Cartão' }),
    liq('titulo_pagamento', 5, '2026-08-13', 100, { restante: 0 })
  ], { competencia: '2026-08', coberturas: [cob] });
  assert.deepEqual(sem.map(l => l.chave), ['titulo_pagamento:1']);
  // Com um lançamento de mesmo valor esperando (ou numa sugestão de soma), não é "sem lançamento".
  const temPar = conc.semLancamento([liq('titulo_pagamento', 1, '2026-08-10', 100)], { competencia: '2026-08', coberturas: [cob], movimentos: [mov(1, '2026-08-11', -100)] });
  assert.deepEqual(temPar, []);
  const naSoma = conc.semLancamento([liq('titulo_pagamento', 1, '2026-08-10', 100)], { competencia: '2026-08', coberturas: [cob], sugestoes: new Map([[9, { itens: ['titulo_pagamento:1'] }]]) });
  assert.deepEqual(naSoma, []);

  const linhas = [
    { estado: 'pendente', valor: -100, sugestao: { tipo: 'sugestao' } }, { estado: 'pendente', valor: 50, sugestao: null },
    { estado: 'conciliado', valor: 10 }, { estado: 'ignorado', valor: -1 }
  ];
  assert.deepEqual(conc.totaisDe(linhas), { total: 4, a_conciliar: { quantidade: 2, total: 150 }, com_sugestao: 1, conciliados: 1, ignorados: 1 });
  assert.deepEqual(['pendentes', 'sugestoes', 'conciliados', 'ignorados', 'todos'].map(v => linhas.filter(l => conc.naVisao(l, v)).length), [2, 1, 1, 1, 4]);
});
