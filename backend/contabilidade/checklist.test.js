/**
 * Checklist do fechamento contábil (backend/contabilidade/checklist.js):
 * funções puras sobre listas já lidas. O que fica preso (decisões do dono,
 * 28/09/2026): as três severidades e o que cada uma bloqueia; o que cada
 * fonte vira em pendência; ignorada com justificativa sai dos bloqueios mas
 * fica na lista (e erro crítico nunca se ignora); o mês em curso não fecha;
 * a situação (aberta, fechada, reaberta) e o que cada uma permite.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const ck = require('./checklist');

const HOJE = '2026-09-28';
const COMP = '2026-08';

const notas = () => [
  { id: 1, pedido_id: 1, serie: 2, numero: 10, status_fiscal: 'autorizada', valor_total: '1500.00', data_emissao: '2026-08-05T10:00:00-03:00', criado_em: '2026-08-05T10:00:00-03:00', xml_autorizado: '<x/>' },
  { id: 2, pedido_id: 2, serie: 2, numero: 11, status_fiscal: 'cancelada', valor_total: 800, data_emissao: '2026-08-10T10:00:00-03:00', criado_em: '2026-08-10T10:00:00-03:00' },
  { id: 3, pedido_id: 3, serie: 2, numero: 12, status_fiscal: 'processando', valor_total: 300, data_emissao: '2026-08-20T10:00:00-03:00', criado_em: '2026-08-20T10:00:00-03:00' },
  // Rejeitada e depois autorizada para o mesmo pedido: não é pendência.
  { id: 4, pedido_id: 4, serie: 2, numero: 13, status_fiscal: 'rejeitada', valor_total: 200, motivo_sefaz: 'NCM inexistente', codigo_status_sefaz: '778', data_emissao: '2026-08-21T10:00:00-03:00', criado_em: '2026-08-21T10:00:00-03:00' },
  { id: 5, pedido_id: 4, serie: 2, numero: 14, status_fiscal: 'autorizada', valor_total: 200, data_emissao: '2026-08-22T10:00:00-03:00', criado_em: '2026-08-22T10:00:00-03:00' },
  // Rejeitada sem nova emissão: erro crítico.
  { id: 6, pedido_id: 5, serie: 2, numero: 15, status_fiscal: 'rejeitada', valor_total: 900, motivo_sefaz: 'Cadastro do destinatário', codigo_status_sefaz: '999', data_emissao: '2026-08-23T10:00:00-03:00', criado_em: '2026-08-23T10:00:00-03:00' },
  // De outro mês: não entra.
  { id: 7, pedido_id: 6, serie: 2, numero: 16, status_fiscal: 'processando', valor_total: 50, data_emissao: '2026-09-02T10:00:00-03:00', criado_em: '2026-09-02T10:00:00-03:00' }
];

const aguardando = () => ({
  quantidade: 2, total: 650, dispensados: 1,
  pedidos: [
    { pedido_id: 7, numero: '2600', enviado_em: '2026-08-12', valor: 400, dispensada: false },
    { pedido_id: 8, numero: '2601', enviado_em: '2026-09-03', valor: 250, dispensada: false },
    { pedido_id: 9, numero: '2602', enviado_em: '2026-08-15', valor: 99, dispensada: true }
  ]
});

test('NF-e de saída: parada e recusada sem nova emissão são críticas; pedido enviado no mês sem nota é documental; o resumo conta só o mês', () => {
  const r = ck.fonteNfe({ notas: notas(), externas: [{ id: 1, pedido_id: 2, data_emissao: '2026-08-30' }], aguardando: aguardando(), competencia: COMP, hoje: HOJE });
  assert.deepEqual(r.pendencias.map(p => [p.nivel, p.chave]), [['critico', 'nfe_processando'], ['critico', 'nfe_rejeitadas'], ['documental', 'nfe_aguardando']]);
  assert.match(r.pendencias[1].descricao, /999 — Cadastro do destinatário/);
  assert.equal(r.pendencias[2].titulo, '1 pedido enviado no mês sem NF-e', 'só o de agosto (o de setembro e o dispensado ficam de fora)');
  assert.match(r.pendencias[2].descricao, /R\$\s400,00/);
  assert.deepEqual(r.pendencias[2].filtro, { acao: 'aguardando-nf' });
  assert.deepEqual(r.numeros, { autorizadas: 2, valor_autorizado: 1700, canceladas: 1, de_fora: 1, sem_nota: 1 });
  assert.equal(r.pendencias.every(p => p.destino === 'financeiro'), true, 'tudo se resolve no Financeiro');
  assert.equal(r.pendencias[0].ignoravel, false);
  assert.equal(r.pendencias[2].ignoravel, true);
});

test('recebimentos: as pendências de cobrança ganham a severidade contábil pela chave; sem o painel a fonte fica indisponível', () => {
  const receber = {
    recebido: { quantidade: 3, total: 2500 }, a_receber: { total: 1200 }, em_atraso: { quantidade: 1, total: 300 }, a_conciliar: { fila: 1, lancamentos: 2 },
    pendencias: [
      { chave: 'em_atraso', titulo: '1 parcela vencida', descricao: 'x', data: '2026-08-20', destino: 'recebimentos-atraso' },
      { chave: 'conciliar', titulo: 'Pagamentos a conciliar', descricao: 'y', data: '2026-09-28', destino: 'conciliar' },
      { chave: 'alertas', titulo: '1 aviso do BB', descricao: 'z', data: '2026-09-27', destino: 'recebimentos-recebidos' },
      { chave: 'recebimentos_sql', titulo: 'Recebimentos ainda não ativados', descricao: 'sql', data: '2026-09-28', destino: 'configuracao-cobranca' }
    ]
  };
  const r = ck.fonteRecebimentos({ receber, receberErro: null });
  assert.deepEqual(r.pendencias.map(p => [p.nivel, p.chave]), [['aviso', 'receb_em_atraso'], ['documental', 'receb_conciliar'], ['critico', 'receb_alertas'], ['critico', 'receb_recebimentos_sql']]);
  assert.deepEqual(r.numeros, { recebido: 2500, recebidos: 3, a_receber: 1200, em_atraso: 300, a_conciliar: 3 });
  assert.equal(r.resumo[3].valor, '3');
  const semPermissao = ck.fonteRecebimentos({ receber: null, receberErro: { status: 403 } });
  assert.match(semPermissao.indisponivel, /financeiro\.recebimento\.view/);
  assert.deepEqual(semPermissao.pendencias, []);
});

test('comissões e produção: mês terminado sem fechamento é documental; fechado sem pagar é aviso até o prazo e documental depois; pago é em dia; mês em curso não cobra', () => {
  const fech = [
    { tipo: 'comissao', competencia: COMP, total: 1000, falta_pagar: 0, pagar_ate: '2026-09-10' },
    { tipo: 'producao', competencia: COMP, total: 500, falta_pagar: 500, pagar_ate: '2026-09-05' },
    { tipo: 'comissao', competencia: '2026-07', total: 900, falta_pagar: 900, pagar_ate: '2026-10-10' }
  ];
  const agosto = ck.fonteFechamentos({ fechamentos: fech, competencia: COMP, hoje: HOJE, encerrada: true });
  assert.deepEqual(agosto.pendencias.map(p => [p.nivel, p.chave]), [['documental', 'fech_producao_pagar']]);
  assert.match(agosto.pendencias[0].titulo, /Pagamento de produção em atraso/);
  assert.deepEqual(agosto.pendencias[0].filtro, { acao: 'confirmar-pagamento', tipo: 'producao', competencia: COMP });
  assert.equal(agosto.numeros.comissao.fechada, true);
  assert.equal(agosto.resumo[0].valor.replace(/ /g, ' '), 'R$ 1.000,00 · pago');

  const julho = ck.fonteFechamentos({ fechamentos: fech, competencia: '2026-07', hoje: HOJE, encerrada: true });
  assert.deepEqual(julho.pendencias.map(p => [p.nivel, p.chave]), [['aviso', 'fech_comissao_pagar'], ['documental', 'fech_producao_fechar']]);
  assert.match(julho.pendencias[0].titulo, /a confirmar/);
  assert.deepEqual(julho.pendencias[1].filtro, { acao: 'fechar-competencia-producao', tipo: 'producao', competencia: '2026-07' });

  const setembro = ck.fonteFechamentos({ fechamentos: fech, competencia: '2026-09', hoje: HOJE, encerrada: false });
  assert.deepEqual(setembro.pendencias, [], 'mês em curso: nada a cobrar ainda');
  assert.equal(setembro.resumo[0].valor, 'Mês em curso');

  assert.match(ck.fonteFechamentos({ fechamentos: null, competencia: COMP, hoje: HOJE, encerrada: true }).indisponivel, /fase G/);
});

test('devoluções: reembolso a pagar é documental (comprovante) e devolução que não terminou é crítica', () => {
  const r = ck.fonteDevolucoes({ hoje: HOJE, reembolsosPendencias: [
    { chave: 'reembolso_12', titulo: 'Reembolso a pagar — pedido 2590', descricao: 'R$ 100,00', data: '2026-08-28', destino: 'confirmar-reembolso', filtro: { reembolso_id: 12 } },
    { chave: 'devolucao_4', titulo: 'Devolução do pedido 2591 com pendência', descricao: 'Algo não terminou', data: '2026-08-29', destino: 'reaplicar-devolucao', filtro: { devolucao_id: 4 } }
  ] });
  assert.deepEqual(r.pendencias.map(p => [p.nivel, p.chave, p.filtro]), [
    ['documental', 'reembolso_12', { acao: 'confirmar-reembolso', reembolso_id: 12 }],
    ['critico', 'devolucao_4', { acao: 'reaplicar-devolucao', devolucao_id: 4 }]
  ]);
  assert.deepEqual(r.numeros, { reembolsos: 1, devolucoes: 1 });
});

function cenario(extra = {}) {
  return {
    competencia: COMP, hoje: HOJE, notas: notas(), aguardando: aguardando(),
    receber: { recebido: { quantidade: 1, total: 100 }, a_receber: { total: 0 }, em_atraso: { quantidade: 0, total: 0 }, a_conciliar: { fila: 0, lancamentos: 0 }, pendencias: [{ chave: 'conciliar', titulo: 'Pagamentos a conciliar', descricao: 'y', data: '2026-09-28', destino: 'conciliar' }] },
    fechamentos: [{ tipo: 'comissao', competencia: COMP, total: 1000, falta_pagar: 0, pagar_ate: '2026-09-10' }, { tipo: 'producao', competencia: COMP, total: 500, falta_pagar: 0, pagar_ate: '2026-09-05' }],
    reembolsosPendencias: [],
    ...extra
  };
}

test('montar: críticas primeiro e ignoradas por último; a contagem, o progresso e os bloqueios do fechamento e do pacote', () => {
  const p = ck.montar(cenario());
  assert.equal(p.competencia, COMP);
  assert.equal(p.rotulo, 'agosto/2026');
  assert.equal(p.encerrada, true);
  assert.deepEqual(p.pendencias.map(x => [x.nivel, x.chave]), [
    ['critico', 'nfe_processando'], ['critico', 'nfe_rejeitadas'], ['documental', 'nfe_aguardando'], ['documental', 'receb_conciliar']
  ]);
  assert.deepEqual(p.contagem, { critico: 2, documental: 2, aviso: 0, ignoradas: 0, total: 4 });
  assert.deepEqual(p.fontes.map(f => [f.chave, f.estado, f.pendencias]), [
    ['nfe_saida', 'critico', 3], ['recebimentos', 'pendente', 1], ['fechamentos', 'ok', 0], ['devolucoes', 'ok', 0],
    ['documentos_recebidos', 'indisponivel', 0], ['contas_pagar', 'indisponivel', 0], ['extrato', 'indisponivel', 0], ['conciliacao', 'indisponivel', 0]
  ]);
  // Sem as tabelas das etapas 2 a 4 (aqui não vieram), as fontes novas dizem qual SQL falta.
  assert.match(p.fontes[4].nota, /sql\/contabilidade_contas_pagar\.sql/);
  assert.match(p.fontes[6].nota, /sql\/contabilidade_extrato\.sql/);
  assert.deepEqual(p.progresso, { ok: 2, total: 4 });
  assert.equal(p.situacao.status, 'aberta');
  assert.deepEqual(p.bloqueios.fechar, ['2 erros críticos a resolver (erro crítico não se ignora).']);
  assert.deepEqual(p.bloqueios.pacote, ['A competência precisa estar fechada.', '2 pendências documentais a resolver ou ignorar com justificativa.']);
  assert.deepEqual(p.pode, { fechar: false, reabrir: false, pacote: false });
});

test('montar: ignorada com justificativa fica na lista (marcada, com quem e quando) e sai dos bloqueios; erro crítico ignorado não vale', () => {
  const resolucoes = [
    { id: 1, chave: 'nfe_aguardando', justificativa: 'Nota emitida à mão pela contabilidade', usuario_id: 3, criado_em: '2026-09-20T12:00:00.000Z' },
    { id: 2, chave: 'nfe_processando', justificativa: 'tentando ignorar um crítico', usuario_id: 3, criado_em: '2026-09-20T12:00:00.000Z' }
  ];
  const p = ck.montar(cenario({ resolucoes, nomes: new Map([['3', 'Henrique']]) }));
  const ignorada = p.pendencias.at(-1);
  assert.equal(ignorada.chave, 'nfe_aguardando');
  assert.equal(ignorada.ignorada, true);
  assert.equal(ignorada.ignorada_por, 'Henrique');
  assert.equal(ignorada.ignorada_em, '2026-09-20T09:00:00-03:00', 'no horário de Brasília');
  assert.equal(p.pendencias.find(x => x.chave === 'nfe_processando').ignorada, false, 'crítico continua vivo');
  assert.deepEqual(p.contagem, { critico: 2, documental: 1, aviso: 0, ignoradas: 1, total: 4 });
  assert.equal(p.fontes[0].pendencias, 2, 'o cartão conta só as vivas');
});

test('montar: sem crítico e com o mês terminado, pode fechar (documentais e avisos não impedem); o mês em curso não fecha', () => {
  const limpo = cenario({ notas: notas().filter(n => ![3, 6].includes(n.id)) });
  const p = ck.montar(limpo);
  assert.deepEqual(p.contagem, { critico: 0, documental: 2, aviso: 0, ignoradas: 0, total: 2 });
  assert.deepEqual(p.bloqueios.fechar, []);
  assert.equal(p.pode.fechar, true);
  assert.equal(p.pode.pacote, false, 'o pacote espera o fechamento e as documentais');

  // Setembro: a nota 7 (processando, de setembro) sairia como crítica — fica de fora para isolar a regra do mês em curso.
  const emCurso = ck.montar({ ...limpo, competencia: '2026-09', notas: limpo.notas.filter(n => n.id !== 7), aguardando: { pedidos: [] }, fechamentos: [] });
  assert.equal(emCurso.encerrada, false);
  assert.deepEqual(emCurso.bloqueios.fechar, ['A competência ainda está em curso: termina em 30/09/2026.']);
  assert.equal(emCurso.fontes[2].estado, 'em_curso');
  assert.equal(emCurso.pode.fechar, false);
});

test('montar: fechada permite reabrir e pacote (sem documentais); crítico novo depois do fechamento vira divergência; reaberta volta a poder fechar', () => {
  const situacao = { id: 9, status: 'fechada', fechada_em: '2026-09-25T18:30:00.000Z', fechada_por: 3 };
  const base = cenario({ notas: notas().filter(n => ![3, 6].includes(n.id)), aguardando: { pedidos: [] }, receber: { recebido: {}, a_receber: {}, em_atraso: {}, a_conciliar: {}, pendencias: [] } });
  const fechada = ck.montar({ ...base, situacao, nomes: new Map([['3', 'Henrique']]) });
  assert.deepEqual(fechada.situacao, { status: 'fechada', fechada_em: '2026-09-25T15:30:00-03:00', fechada_por: 'Henrique', reaberta_em: null, reaberta_por: null, justificativa_reabertura: null, divergencias: 0 });
  assert.deepEqual(fechada.pode, { fechar: false, reabrir: true, pacote: true });
  assert.deepEqual(fechada.bloqueios.fechar, ['A competência já está fechada.']);

  const comCritico = ck.montar({ ...cenario(), situacao });
  assert.equal(comCritico.situacao.divergencias, 2);

  const reaberta = ck.montar({ ...base, situacao: { ...situacao, status: 'reaberta', reaberta_em: '2026-09-26T12:00:00.000Z', reaberta_por: 3, justificativa_reabertura: 'Entrou uma nota atrasada' } });
  assert.equal(reaberta.situacao.status, 'reaberta');
  assert.equal(reaberta.situacao.justificativa_reabertura, 'Entrou uma nota atrasada');
  assert.deepEqual(reaberta.pode, { fechar: true, reabrir: false, pacote: false });
});

test('competência inválida cai no mês de hoje; sql pendente vai na resposta', () => {
  const p = ck.montar({ competencia: 'x', hoje: HOJE, sqlPendente: true, aguardando: { pedidos: [] }, fechamentos: [] });
  assert.equal(p.competencia, '2026-09');
  assert.equal(p.sql_pendente, true);
  assert.equal(ck.competenciaValida('2026-13', HOJE), '2026-09');
  assert.equal(ck.competenciaValida('2025-01', HOJE), '2025-01');
});

// ------------------------------------------------------------- etapas 2 e 3

const titulosMod = require('./titulos');

/** Agosto/2026: uma NF-e com XML e conta, uma só pela chave, uma NFS-e sem PDF, um recibo sem conta; contas e pagamentos. */
function pagarDeAgosto(extra = {}) {
  const base = {
    titulos: [
      { id: 1, contato_id: 7, documento_recebido_id: 20, descricao: 'Vidros', valor_total: 1200, competencia: '2026-08', status: 'aberto' },
      { id: 2, contato_id: null, documento_recebido_id: null, descricao: 'Frete avulso', valor_total: 150, competencia: '2026-08', status: 'aberto' },
      { id: 3, contato_id: null, documento_recebido_id: null, descricao: 'Aluguel', valor_total: 2000, competencia: '2026-08', status: 'aberto' }
    ],
    parcelas: [
      { id: 11, titulo_id: 1, numero: 1, vencimento: '2026-08-20', valor: 600 },
      { id: 12, titulo_id: 1, numero: 2, vencimento: '2026-09-20', valor: 600 },
      { id: 21, titulo_id: 2, numero: 1, vencimento: '2026-08-15', valor: 150 },
      { id: 31, titulo_id: 3, numero: 1, vencimento: '2026-08-05', valor: 2000 }
    ],
    pagamentos: [
      { id: 100, parcela_id: 11, titulo_id: 1, data_pagamento: '2026-08-20', competencia: '2026-08', valor_pago: 600, forma: 'Pix' },
      { id: 101, parcela_id: 21, titulo_id: 2, data_pagamento: '2026-08-15', competencia: '2026-08', valor_pago: 150, forma: 'Dinheiro' }
    ],
    contatos: new Map([['7', { id: 7, nome: 'Vidros Norte', cnpj: '57248237000103' }]])
  };
  return {
    titulos: titulosMod.montarTodos(base, HOJE),
    contatos: base.contatos,
    documentos: [
      { id: 20, tipo: 'nfe', origem: 'xml', serie: '1', numero: '1234', contato_id: 7, data_emissao: '2026-08-10', competencia: '2026-08', valor_total: 1200 },
      { id: 21, tipo: 'nfe', origem: 'chave', serie: '1', numero: '99', emitente_nome: 'Madeiras Silva', data_emissao: '2026-08-12', competencia: '2026-08', valor_total: 300 },
      { id: 22, tipo: 'nfse', origem: 'manual', numero: '45', emitente_nome: 'Ana Pintura', data_emissao: '2026-08-15', competencia: '2026-08', valor_total: 400, financeiro_pagamento_id: 70 },
      { id: 23, tipo: 'outro', especie: 'recibo', origem: 'manual', emitente_nome: 'Chaveiro', data_emissao: '2026-08-18', competencia: '2026-08', valor_total: 80 },
      { id: 24, tipo: 'nfe', origem: 'chave', numero: '5', emitente_nome: 'Excluída', data_emissao: '2026-08-18', competencia: '2026-08', valor_total: 5, excluido_em: '2026-08-19' }
    ],
    arquivosMapa: new Map([
      ['documento_recebido:20', [{ id: 1, categoria: 'xml_nfe' }]],
      ['documento_recebido:23', [{ id: 2, categoria: 'recibo' }]],
      ['pagamento:100', [{ id: 3, categoria: 'comprovante' }]]
    ]),
    pagamentosFechamento: new Map([
      ['70', { id: 70, rotulo: 'Comissões de julho/2026 — Ana (CMS)', valor: 1000, data: '2026-08-10' }],
      ['71', { id: 71, rotulo: 'Produção de julho/2026', valor: 500, data: '2026-08-12' }],
      ['72', { id: 72, rotulo: 'Comissões de agosto/2026 — Ana (CMS)', valor: 900, data: '2026-09-10' }]
    ]),
    ...extra
  };
}

test('NF-e de entrada e NFS-e: falta de XML e de arquivo por documento; NFS-e que falta de cada pagamento de fechamento; documento sem conta junta num aviso', () => {
  const r = ck.fonteDocumentosRecebidos({ pagar: pagarDeAgosto(), competencia: COMP, hoje: HOJE });
  assert.deepEqual(r.pendencias.map(p => [p.nivel, p.chave, p.filtro.acao]), [
    ['documental', 'docrec_sem_xml_21', 'documento-recebido'],
    ['documental', 'docrec_sem_arquivo_22', 'documento-recebido'],
    ['documental', 'nfse_fech_70', 'registrar-documento'],
    ['documental', 'nfse_fech_71', 'registrar-documento'],
    ['aviso', 'docrec_sem_conta', 'documentos-recebidos']
  ]);
  assert.equal(r.pendencias[0].titulo, 'NF-e 1/99 de Madeiras Silva sem o XML');
  assert.match(r.pendencias[2].descricao.replace(/ /g, ' '), /R\$ 1\.000,00 pagos em 10\/08\/2026 · NFS-e registradas: R\$ 400,00/);
  assert.deepEqual(r.pendencias[3].filtro, { acao: 'registrar-documento', tipo: 'nfse', financeiro_pagamento_id: 71 });
  assert.equal(r.pendencias[4].titulo, '2 documentos sem conta a pagar', 'a NF-e só pela chave e o recibo (a NFS-e é do fechamento)');
  assert.ok(r.pendencias.every(p => p.destino === 'contabilidade' && p.fonte === 'documentos_recebidos'));
  assert.deepEqual(r.numeros, {
    nfe: { quantidade: 2, total: 1500 }, nfse: { quantidade: 1, total: 400 }, outro: { quantidade: 1, total: 80 },
    sem_arquivo: 2, sem_conta: 2, fechamentos_sem_nfse: 2
  });
  const semSql = ck.fonteDocumentosRecebidos({ pagar: null, competencia: COMP });
  assert.match(semSql.indisponivel, /contabilidade_contas_pagar\.sql/);
});

test('contas a pagar: pagamento do mês sem nota/recibo é documental (um por pagamento); sem comprovante e vencidas são avisos', () => {
  const r = ck.fonteContasPagar({ pagar: pagarDeAgosto(), competencia: COMP, hoje: HOJE });
  assert.deepEqual(r.pendencias.map(p => [p.nivel, p.chave]), [
    ['documental', 'pagar_sem_doc_101'],
    ['aviso', 'pagar_sem_comprovante'],
    ['aviso', 'pagar_vencidas']
  ]);
  assert.equal(r.pendencias[0].titulo, 'Pagamento sem nota ou recibo — Frete avulso');
  assert.deepEqual(r.pendencias[0].filtro, { acao: 'conta-pagar', titulo_id: 2 });
  assert.equal(r.pendencias[1].titulo, '1 pagamento sem comprovante');
  assert.equal(r.pendencias[2].titulo, '1 parcela vencida sem pagamento registrado', 'o aluguel de 05/08; a de 20/09 ainda não venceu em agosto');
  assert.deepEqual(r.numeros, {
    pago_no_mes: { quantidade: 2, total: 750 }, vence_no_mes: { quantidade: 1, total: 2000 }, vencidas: 1, sem_comprovante: 1, sem_documento: 1
  });
  // Recibo anexado à conta resolve o "sem nota".
  const comRecibo = pagarDeAgosto();
  comRecibo.arquivosMapa.set('titulo:2', [{ id: 9, categoria: 'recibo' }]);
  assert.deepEqual(ck.fonteContasPagar({ pagar: comRecibo, competencia: COMP, hoje: HOJE }).pendencias.map(p => p.chave), ['pagar_sem_comprovante', 'pagar_vencidas']);
});

test('montar com as etapas 2 e 3: as fontes novas entram na conta, no progresso e nos bloqueios do pacote', () => {
  const p = ck.montar({
    competencia: COMP, hoje: HOJE, notas: [], aguardando: { pedidos: [] },
    receber: { recebido: {}, a_receber: {}, em_atraso: {}, a_conciliar: {}, pendencias: [] },
    fechamentos: [{ tipo: 'comissao', competencia: COMP, total: 10, falta_pagar: 0 }, { tipo: 'producao', competencia: COMP, total: 10, falta_pagar: 0 }],
    pagar: pagarDeAgosto()
  });
  assert.deepEqual(p.fontes.map(f => [f.chave, f.estado, f.pendencias]), [
    ['nfe_saida', 'ok', 0], ['recebimentos', 'ok', 0], ['fechamentos', 'ok', 0], ['devolucoes', 'ok', 0],
    ['documentos_recebidos', 'pendente', 5], ['contas_pagar', 'pendente', 3], ['extrato', 'indisponivel', 0], ['conciliacao', 'indisponivel', 0]
  ]);
  assert.deepEqual(p.contagem, { critico: 0, documental: 5, aviso: 3, ignoradas: 0, total: 8 });
  assert.deepEqual(p.progresso, { ok: 4, total: 6 });
  assert.equal(p.pode.fechar, true, 'documental não impede o fechamento');
  assert.deepEqual(p.bloqueios.pacote, ['A competência precisa estar fechada.', '5 pendências documentais a resolver ou ignorar com justificativa.']);
  // Ignorar a NFS-e da produção (o colaborador não emite) tira do bloqueio.
  const ignorada = ck.montar({
    competencia: COMP, hoje: HOJE, notas: [], aguardando: { pedidos: [] }, receber: { pendencias: [] },
    fechamentos: [{ tipo: 'comissao', competencia: COMP, total: 10, falta_pagar: 0 }, { tipo: 'producao', competencia: COMP, total: 10, falta_pagar: 0 }],
    pagar: pagarDeAgosto(), resolucoes: [{ id: 1, chave: 'nfse_fech_71', justificativa: 'Colaborador sem MEI', usuario_id: 3, criado_em: '2026-09-02T12:00:00Z' }]
  });
  assert.equal(ignorada.pendencias.find(x => x.chave === 'nfse_fech_71').ignorada, true);
  assert.equal(ignorada.contagem.documental, 4);
});

// ------------------------------------------------------------- extrato (etapa 4)

const extratoDeAgosto = (extra = {}) => ({
  contas: [
    { id: 1, nome: 'BB — conta corrente', tipo: 'corrente', ativa: true },
    { id: 2, nome: 'Caixa da loja', tipo: 'caixa', ativa: true },
    { id: 3, nome: 'Conta antiga', tipo: 'corrente', ativa: false }
  ],
  importacoes: [{ id: 10, conta_id: 1, status: 'completa', periodo_inicio: '2026-08-01', periodo_fim: '2026-08-20' }],
  movimentos: [
    { id: 1, conta_id: 1, competencia: COMP, valor: '1500.00' },
    { id: 2, conta_id: 1, competencia: COMP, valor: '-2500.00' },
    { id: 3, conta_id: 1, competencia: '2026-09', valor: '99.00' }
  ],
  ...extra
});

test('extrato: sem conta corrente cadastrada é documental; mês fechado sem o extrato inteiro é documental, com o que falta', () => {
  const semConta = ck.fonteExtrato({ extrato: { contas: [], importacoes: [], movimentos: [] }, competencia: COMP, hoje: HOJE, encerrada: true });
  assert.deepEqual(semConta.pendencias.map(p => [p.nivel, p.chave, p.filtro]), [['documental', 'extrato_sem_conta', { acao: 'contas-financeiras' }]]);
  assert.equal(semConta.resumo[3].valor, 'Sem conta');

  const r = ck.fonteExtrato({ extrato: extratoDeAgosto(), competencia: COMP, hoje: HOJE, encerrada: true });
  assert.deepEqual(r.pendencias.map(p => [p.nivel, p.chave, p.filtro]), [['documental', 'extrato_1', { acao: 'importar-extrato', conta_id: 1 }]], 'caixa e conta inativa não cobram extrato');
  assert.equal(r.pendencias[0].titulo, 'Extrato de agosto/2026 — BB — conta corrente incompleto');
  assert.match(r.pendencias[0].descricao, /^Falta: 21\/08\/2026 a 31\/08\/2026/);
  assert.deepEqual(r.numeros, { contas: 1, movimentos: 2, entradas: 1500, saidas: -2500, completo: false });
  assert.equal(r.resumo[3].valor, '01/08/2026 a 20/08/2026 (falta)');

  const nada = ck.fonteExtrato({ extrato: extratoDeAgosto({ importacoes: [] }), competencia: COMP, hoje: HOJE, encerrada: true });
  assert.equal(nada.pendencias[0].titulo, 'Extrato de agosto/2026 — BB — conta corrente não importado');

  const completo = ck.fonteExtrato({
    extrato: extratoDeAgosto({ importacoes: [{ id: 10, conta_id: 1, status: 'completa', periodo_inicio: '2026-07-25', periodo_fim: '2026-09-02' }] }),
    competencia: COMP, hoje: HOJE, encerrada: true
  });
  assert.deepEqual(completo.pendencias, []);
  assert.equal(completo.numeros.completo, true);

  // Importação desfeita não cobre nada.
  const desfeita = ck.fonteExtrato({
    extrato: extratoDeAgosto({ importacoes: [{ id: 10, conta_id: 1, status: 'desfeita', periodo_inicio: '2026-08-01', periodo_fim: '2026-08-31' }] }),
    competencia: COMP, hoje: HOJE, encerrada: true
  });
  assert.deepEqual(desfeita.pendencias.map(p => p.chave), ['extrato_1']);
});

test('extrato: o mês em curso não cobra o extrato (fica "em curso"); sem o SQL da etapa 4 a fonte diz qual arquivo rodar', () => {
  const emCurso = ck.fonteExtrato({ extrato: extratoDeAgosto(), competencia: '2026-09', hoje: HOJE, encerrada: false });
  assert.deepEqual(emCurso.pendencias, []);
  const p = ck.montar({
    competencia: '2026-09', hoje: HOJE, notas: [], aguardando: { pedidos: [] }, receber: { pendencias: [] },
    fechamentos: [], extrato: extratoDeAgosto()
  });
  assert.equal(p.fontes.find(f => f.chave === 'extrato').estado, 'em_curso');
  const semSql = ck.fonteExtrato({ extrato: null, competencia: COMP, hoje: HOJE, encerrada: true });
  assert.match(semSql.indisponivel, /sql\/contabilidade_extrato\.sql/);
});

test('montar com o extrato: a pendência entra no bloqueio do pacote (documental), não no fechamento', () => {
  const p = ck.montar({
    competencia: COMP, hoje: HOJE, notas: [], aguardando: { pedidos: [] },
    receber: { recebido: {}, a_receber: {}, em_atraso: {}, a_conciliar: {}, pendencias: [] },
    fechamentos: [{ tipo: 'comissao', competencia: COMP, total: 10, falta_pagar: 0 }, { tipo: 'producao', competencia: COMP, total: 10, falta_pagar: 0 }],
    extrato: extratoDeAgosto()
  });
  const fonte = p.fontes.find(f => f.chave === 'extrato');
  assert.deepEqual([fonte.estado, fonte.pendencias, fonte.nota], ['pendente', 1, null]);
  assert.equal(p.pode.fechar, true);
  assert.deepEqual(p.bloqueios.pacote, ['A competência precisa estar fechada.', '1 pendência documental a resolver ou ignorar com justificativa.']);
});

// ------------------------------------------------------------- conciliação (etapa 5)

test('conciliação: pendentes = uma documental; registro estornado = crítico (um por lançamento); sem lançamento = aviso; sem SQL diz qual', () => {
  assert.match(ck.fonteConciliacao({ conciliacao: null, competencia: COMP }).indisponivel, /Depende do extrato: .*contabilidade_extrato\.sql/);
  assert.match(ck.fonteConciliacao({ conciliacao: { semSql: 'Falta rodar sql/contabilidade_conciliacao.sql' }, competencia: COMP }).indisponivel, /contabilidade_conciliacao\.sql/);
  const r = ck.fonteConciliacao({
    competencia: COMP,
    conciliacao: {
      movimentos: [
        { id: 1, data: '2026-08-05', valor: -2500, estado_conciliacao: 'pendente' }, { id: 2, data: '2026-08-11', valor: 3700 },
        { id: 3, data: '2026-08-20', valor: -600, estado_conciliacao: 'conciliado' }, { id: 4, data: '2026-08-31', valor: -12.9, estado_conciliacao: 'ignorado' }
      ],
      sugeridos: 2,
      invalidos: [{ vinculo: { movimento_id: 3, alvo_tipo: 'recebimento', alvo_id: 9 }, motivo: 'recebimento estornado', liq: { rotulo: 'Pedido 2540 · parcela 1' }, movimento: { data: '2026-08-20', valor: -600 } }],
      semLancamento: [{ chave: 'financeiro_pagamento:70', valor: -900 }]
    }
  });
  assert.deepEqual(r.pendencias.map(p => [p.nivel, p.chave]), [['documental', 'conciliacao_pendente'], ['critico', 'conciliacao_invalida_3'], ['aviso', 'conciliacao_sem_lancamento']]);
  assert.equal(r.pendencias[0].titulo, '2 lançamentos do extrato sem conciliação');
  assert.match(r.pendencias[0].descricao.replace(/ /g, ' '), /^Total R\$ 6\.200,00 · 2 com sugestão/);
  assert.deepEqual(r.pendencias[1].filtro, { acao: 'conciliacao', visao: 'conciliados', movimento_id: 3 });
  assert.match(r.pendencias[1].descricao, /Pedido 2540 · parcela 1: recebimento estornado/);
  assert.deepEqual(r.numeros, { movimentos: 4, conciliados: 1, pendentes: 2, ignorados: 1, sugeridos: 2, sem_lancamento: 1, invalidos: 1 });
  assert.deepEqual(r.resumo.map(x => x.rotulo), ['Conciliados', 'A conciliar', 'Ignorados (sem par)', 'Sem lançamento no extrato']);
  assert.equal(r.resumo[0].valor, '1 de 4');
  // Tudo conciliado ou ignorado: nada a cobrar; no mês em curso fica "em curso".
  const emDia = ck.montar({ competencia: '2026-09', hoje: HOJE, notas: [], aguardando: { pedidos: [] }, receber: { pendencias: [] }, fechamentos: [],
    conciliacao: { movimentos: [{ id: 1, valor: 10, estado_conciliacao: 'conciliado' }], sugeridos: 0, invalidos: [], semLancamento: [] } });
  assert.equal(emDia.fontes.find(f => f.chave === 'conciliacao').estado, 'em_curso');
});
