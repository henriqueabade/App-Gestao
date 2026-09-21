/**
 * Painel fiscal do Financeiro (backend/fiscal/painel.js): funções puras sobre
 * listas já lidas. O que se prende: quem é "aguardando NF-e" (enviado, sem
 * nota viva, não dispensado, a partir da competência), o resumo das notas do
 * mês, as pendências na ordem certa com o destino de cada uma, a atividade
 * recente ordenada, e a leitura que busca só os clientes que aparecem.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const painel = require('./painel');

const HOJE = '2026-09-16T12:00:00-03:00';
const semNbsp = t => String(t).replace(/ /g, ' ');

function pedidos() {
  return [
    { id: 1, numero: '2540', situacao: 'Enviado', cliente_id: 7, valor_final: '1500.00', parcelas: 3, embarcar_real: '2026-09-10T00:00:00.000Z' },
    { id: 2, numero: '2541', situacao: 'Entregue', cliente_id: 8, valor_final: 800, parcelas: 1, embarcar_real: '2026-09-12', data_entrega: '2026-09-14' },
    { id: 3, numero: '2542', situacao: 'Produção', cliente_id: 7, valor_final: 300 },
    { id: 4, numero: '2543', situacao: 'Enviado', cliente_id: 9, valor_final: 250, embarcar_real: '2026-09-11', nfe_dispensada: true },
    { id: 5, numero: '2500', situacao: 'Entregue', cliente_id: 7, valor_final: 9999, embarcar_real: '2026-08-20' },
    { id: 6, numero: '2544', situacao: 'Enviado', cliente_id: 8, valor_final: 400, embarcar_real: '2026-09-15' },
    { id: 7, numero: '2545', situacao: 'Cancelado', cliente_id: 8, valor_final: 400, embarcar_real: '2026-09-15' },
    { id: 8, numero: '2546', situacao: 'Enviado', cliente_id: 8, valor_final: 120, data_aprovacao: '2026-09-02T10:00:00.000Z' }
  ];
}

function notas() {
  return [
    { id: 10, pedido_id: 2, serie: 1, numero: 1, status_fiscal: 'autorizada', ambiente: 'homologacao', valor_total: '800.00', data_emissao: '2026-09-14T10:00:00-03:00', data_autorizacao: '2026-09-14T10:00:05-03:00', criado_em: '2026-09-14T10:00:00-03:00', xml_envio: '<x/>', xml_autorizado: '<y/>' },
    { id: 11, pedido_id: 6, serie: 1, numero: 2, status_fiscal: 'rejeitada', ambiente: 'homologacao', valor_total: 400, codigo_status_sefaz: '778', motivo_sefaz: 'NCM inexistente', data_emissao: '2026-09-15T09:00:00-03:00', criado_em: '2026-09-15T09:00:00-03:00', atualizado_em: '2026-09-15T09:00:03-03:00' },
    { id: 12, pedido_id: 8, serie: 1, numero: 3, status_fiscal: 'processando', ambiente: 'homologacao', valor_total: 120, recibo: '311000000000001', data_emissao: '2026-09-16T08:00:00-03:00', criado_em: '2026-09-16T08:00:00-03:00' },
    { id: 13, pedido_id: 5, serie: 1, numero: 4, status_fiscal: 'cancelada', ambiente: 'homologacao', valor_total: 9999, data_emissao: '2026-08-25T08:00:00-03:00', data_autorizacao: '2026-08-25T08:00:05-03:00', cancelada_em: '2026-09-01T11:00:00-03:00', justificativa_cancelamento: 'Pedido devolvido pelo cliente', criado_em: '2026-08-25T08:00:00-03:00' }
  ];
}

const clientes = () => [{ id: 7, nome_fantasia: 'Casa Vicenzo', razao_social: 'Vicenzo LTDA' }, { id: 8, razao_social: 'Marcenaria Serrana' }];

test('aguardando NF-e: enviado ou entregue, sem nota viva, a partir da competência; dispensado entra marcado e não conta', () => {
  const r = painel.pedidosAguardandoNfe({ pedidos: pedidos(), notas: notas(), clientes: clientes(), desde: '2026-09-01', hoje: HOJE });
  // 2541 tem nota autorizada, 2546 tem nota processando (viva), 2500 é de
  // agosto, 2542 está em produção e 2545 foi cancelado: nenhum aguarda.
  // 2544 tem só uma nota rejeitada: aguarda. Mais dias sem nota primeiro.
  assert.deepEqual(r.pedidos.map(l => l.numero), ['2540', '2543', '2544']);
  assert.equal(r.quantidade, 2, 'o dispensado (2543) não conta');
  assert.equal(r.total, 1900);
  assert.equal(r.dispensados, 1);
  const p = r.pedidos[0];
  assert.equal(p.cliente, 'Casa Vicenzo', 'nome fantasia antes da razão social');
  assert.equal(p.enviado_em, '2026-09-10', 'DATE cortada como texto, sem fuso');
  assert.equal(p.dias_sem_nfe, 6);
  assert.equal(p.valor, 1500, '"1500.00" do Postgres é mil e quinhentos');
  assert.equal(p.parcelas, 3);
  assert.equal(p.ultima_nota, null);
  const rejeitado = r.pedidos.find(l => l.numero === '2544');
  assert.deepEqual(rejeitado.ultima_nota, { id: 11, serie: 1, numero: 2, status_fiscal: 'rejeitada', motivo_sefaz: 'NCM inexistente' });
  assert.equal(r.pedidos.find(l => l.numero === '2543').dispensada, true);
  assert.equal(r.pedidos.find(l => l.numero === '2544').cliente, 'Marcenaria Serrana');

  // A NF-e emitida fora e informada (fiscal/externas.js) também é nota; a desligada não conta.
  const comDeFora = painel.pedidosAguardandoNfe({
    pedidos: pedidos(), notas: notas(), desde: '2026-09-01', hoje: HOJE,
    externas: [{ pedido_id: 1, ativo: true }, { pedido_id: 6, ativo: false }]
  });
  assert.deepEqual(comDeFora.pedidos.map(l => l.numero), ['2543', '2544'], 'o 2540 tem nota de fora e sai da lista');
  assert.equal(comDeFora.total, 400);

  const agosto = painel.pedidosAguardandoNfe({ pedidos: pedidos(), notas: notas(), desde: '2026-08-01', hoje: HOJE });
  assert.ok(agosto.pedidos.some(l => l.numero === '2500'), 'com a competência anterior o pedido de agosto (nota cancelada) entra');
  assert.equal(agosto.pedidos.find(l => l.numero === '2500').ultima_nota.status_fiscal, 'cancelada');
});

test('resumo das notas da competência: contagem por situação e o valor autorizado', () => {
  assert.deepEqual(painel.resumoDasNotas(notas(), '2026-09'), { competencia: '2026-09', emitidas: 3, autorizadas: 1, canceladas: 0, processando: 1, rejeitadas: 1, valor_autorizado: 800 });
  assert.deepEqual(painel.resumoDasNotas(notas(), '2026-08'), { competencia: '2026-08', emitidas: 1, autorizadas: 0, canceladas: 1, processando: 0, rejeitadas: 0, valor_autorizado: 0 });
});

test('pendências: nota parada na SEFAZ, recusada sem substituta, pedidos sem nota, certificado e configuração — cada uma com destino', () => {
  const aguardando = painel.pedidosAguardandoNfe({ pedidos: pedidos(), notas: notas(), desde: '2026-09-01', hoje: HOJE });
  const p = painel.pendenciasFiscais({ aguardando, notas: notas(), certificado: { configurado: true, venceEmBreve: true, diasRestantes: 12, validoAte: '2026-09-28T00:00:00.000Z' }, pendenciasConfiguracao: [], hoje: HOJE });
  assert.deepEqual(p.map(x => x.chave), ['processando', 'rejeitadas', 'aguardando_nf', 'certificado']);
  assert.deepEqual(p.map(x => x.nivel), ['critico', 'critico', 'normal', 'normal']);
  assert.equal(p[0].titulo, '1 nota aguardando resposta da SEFAZ');
  assert.equal(p[0].descricao, 'NF-e 1/3 — consulte para concluir a autorização');
  assert.deepEqual([p[0].destino, p[0].filtro, p[0].acao], ['notas-fiscais', { status: 'processando' }, 'Consultar']);
  assert.equal(p[1].titulo, '1 nota recusada pela SEFAZ sem nova emissão');
  assert.equal(p[1].descricao, '778 — NCM inexistente');
  assert.equal(p[2].titulo, '2 pedidos enviados sem NF-e');
  assert.equal(semNbsp(p[2].descricao), 'Total: R$ 1.900,00');
  assert.equal(p[2].data, '2026-09-10', 'a data é a do pedido mais antigo sem nota');
  assert.deepEqual([p[2].destino, p[2].acao], ['aguardando-nf', 'Emitir']);
  assert.equal(p[3].titulo, 'Certificado digital vence em 12 dias');
  assert.equal(p[3].destino, 'configuracao-fiscal');

  const critico = painel.pendenciasFiscais({ aguardando: { quantidade: 0, pedidos: [] }, notas: [], certificado: { configurado: false, erro: 'Nenhum certificado' }, pendenciasConfiguracao: ['Emitente sem cep'], hoje: HOJE });
  assert.deepEqual(critico.map(x => [x.chave, x.nivel, x.titulo]), [['certificado', 'critico', 'Certificado digital não configurado'], ['configuracao', 'critico', 'Configuração fiscal incompleta']]);
  assert.equal(critico[0].descricao, 'Nenhum certificado');
  assert.equal(critico[1].descricao, 'Emitente sem cep');
  assert.equal(painel.pendenciasFiscais({ aguardando: { quantidade: 0, pedidos: [] }, notas: [], certificado: { configurado: true, vencido: true, validoAte: '2026-09-01' }, hoje: HOJE })[0].titulo, 'Certificado digital vencido');
  assert.equal(painel.pendenciasFiscais({ aguardando: { quantidade: 0, pedidos: [] }, notas: [], certificado: { configurado: true, confereComEmitente: false }, hoje: HOJE })[0].titulo, 'Certificado digital de outro CNPJ');
  assert.deepEqual(painel.pendenciasFiscais({ aguardando: { quantidade: 0, pedidos: [] }, notas: [], certificado: { configurado: true }, hoje: HOJE }), [], 'tudo em dia: nenhuma pendência');

  // Nota recusada que já tem outra autorizada no lugar não é pendência.
  const comSubstituta = [...notas(), { id: 14, pedido_id: 6, serie: 1, numero: 2, status_fiscal: 'autorizada', data_emissao: '2026-09-15T10:00:00-03:00', data_autorizacao: '2026-09-15T10:00:05-03:00', valor_total: 400 }];
  assert.ok(!painel.pendenciasFiscais({ aguardando: { quantidade: 0, pedidos: [] }, notas: comSubstituta, certificado: { configurado: true }, hoje: HOJE }).some(x => x.chave === 'rejeitadas'));
});

test('atividade recente: autorizações, cancelamentos, recusas, envios e cartas, da mais nova para a mais velha, com limite', () => {
  const eventosCce = [
    { id: 1, nota_fiscal_id: 10, tipo: 'cce', codigo_sefaz: '135', criado_em: '2026-09-15T14:00:00-03:00', detalhe: JSON.stringify({ nSeqEvento: 1, correcao: 'Onde se lê Caixa, leia-se Engradado' }) },
    { id: 2, nota_fiscal_id: 10, tipo: 'cce', codigo_sefaz: '573', criado_em: '2026-09-15T15:00:00-03:00', detalhe: { nSeqEvento: 2, correcao: 'recusada' } },
    { id: 3, nota_fiscal_id: 999, tipo: 'cce', codigo_sefaz: '135', criado_em: '2026-09-15T16:00:00-03:00', detalhe: {} }
  ];
  const a = painel.atividadeRecente({ notas: notas(), eventosCce, pedidos: pedidos() });
  // A nota 4 (cancelada em setembro) também teve a autorização em agosto: dois movimentos.
  assert.deepEqual(a.map(i => i.tipo), ['processando', 'cce', 'rejeitada', 'autorizada', 'cancelada', 'autorizada']);
  assert.equal(a[0].titulo, 'NF-e 1/3 enviada à SEFAZ');
  assert.equal(a[0].detalhe, 'Pedido 2546 • aguardando resposta');
  assert.equal(a[1].titulo, 'Carta de correção 1 da NF-e 1/1');
  assert.equal(a[1].detalhe, 'Pedido 2541 • Onde se lê Caixa, leia-se Engradado');
  assert.equal(a[2].detalhe, 'Pedido 2544 • 778 — NCM inexistente');
  assert.equal(semNbsp(a[3].detalhe), 'Pedido 2541 • R$ 800,00');
  assert.equal(a[4].titulo, 'NF-e 1/4 cancelada');
  assert.equal(a[4].detalhe, 'Pedido 2500 • Pedido devolvido pelo cliente');
  assert.equal(a[4].quando, '2026-09-01T11:00:00-03:00');
  assert.equal(painel.atividadeRecente({ notas: notas(), eventosCce, pedidos: pedidos(), limite: 2 }).length, 2);
  assert.deepEqual(painel.atividadeRecente({ notas: [], eventosCce: [], pedidos: [] }), []);
});

test('montar: competência inválida cai na de hoje; nada de XML sai; o certificado vira um resumo', () => {
  const r = painel.montar({ pedidos: pedidos(), notas: notas(), clientes: clientes(), competencia: 'x', hoje: new Date('2026-09-16T12:00:00-03:00'), certificado: { configurado: true, chavePrivadaPem: 'segredo', diasRestantes: 59, validoAte: '2026-11-14T00:00:00.000Z' }, ambiente: 'homologacao' });
  assert.equal(r.competencia, '2026-09');
  assert.equal(r.desde, '2026-09-01');
  assert.equal(r.ambiente, 'homologacao');
  assert.deepEqual(r.certificado, { configurado: true, vencido: false, venceEmBreve: false, diasRestantes: 59, validoAte: '2026-11-14T00:00:00.000Z' });
  assert.equal(r.aguardando_nf.quantidade, 2);
  assert.equal(r.notas.autorizadas, 1);
  assert.ok(!JSON.stringify(r).includes('segredo') && !JSON.stringify(r).includes('xml_'), 'sem chave nem XML na resposta');
  assert.deepEqual(painel.montar({ competencia: '2026-07', hoje: HOJE }).pendencias.map(p => p.chave), ['certificado']);
  assert.equal(painel.competenciaValida('2026-13', HOJE), '2026-09');
  assert.equal(painel.diasEntre('2026-09-16', '2026-08-31'), 16);
  assert.equal(painel.dataDeEnvio({ data_emissao: '2026-09-01T00:00:00.000Z' }), '2026-09-01');
});

test('carregar: lê pedidos, notas e cartas, e busca só os clientes dos pedidos que aguardam nota', async () => {
  const chamadas = [];
  const api = {
    async get(caminho, { query } = {}) {
      chamadas.push({ caminho, query });
      if (caminho === '/api/pedidos') return pedidos();
      if (caminho === '/api/notas_fiscais') return notas();
      if (caminho === '/api/notas_fiscais_eventos') return [];
      if (caminho === '/api/clientes') return clientes().filter(c => c.id === query.id);
      throw new Error('rota inesperada');
    }
  };
  const r = await painel.carregar({ api, competencia: '2026-09', hoje: HOJE, certificado: { configurado: true } });
  const idsBuscados = chamadas.filter(c => c.caminho === '/api/clientes').map(c => c.query.id).sort();
  assert.deepEqual(idsBuscados, [7, 8, 9], 'um GET por cliente distinto dos pedidos sem nota, e nenhum outro');
  assert.equal(r.aguardando_nf.pedidos[0].cliente, 'Casa Vicenzo');
  assert.equal(r.aguardando_nf.pedidos.find(l => l.numero === '2543').cliente, null, 'cliente 9 não existe: fica sem nome, sem derrubar o painel');
  assert.deepEqual(chamadas.find(c => c.caminho === '/api/notas_fiscais_eventos').query, { tipo: 'cce' });
});
