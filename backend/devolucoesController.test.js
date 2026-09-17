/**
 * Rotas da devolução de pedidos (backend/devolucoesController.js), de ponta a
 * ponta, com uma API genérica de mentira (com as chaves únicas do banco), o BB
 * dublado e permissões dubladas.
 *
 * O caminho: sem o SQL a tela sabe o que fazer; quem não tem a permissão não
 * devolve; pedido em produção sem nota não devolve (cancela); devolução
 * parcial → peça volta ao estoque, desconto proporcional nas parcelas em
 * aberto (valor da parcela e abatimento no BB), pedido vira "parcial";
 * devolução do resto → vira "total", boleto baixado, reembolso pendente e
 * ajuste de comissão; o XML do cliente preenche as quantidades e fica
 * guardado; o BB fora do ar vira pendência e "tentar de novo" resolve; o
 * reembolso é confirmado uma vez só.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { notaDeDevolucao, CHAVE_DA_VENDA } = require('./devolucoes/notaDeTeste');

const TOKEN = 'x.eyJpZCI6MX0.assinatura';
const TABELAS_DEVOLUCAO = ['devolucoes', 'devolucao_itens', 'devolucao_parcelas', 'reembolsos', 'notas_devolucao'];
const TABELAS_G = [
  'financeiro_configuracao', 'comissao_regras', 'producao_setores', 'producao_valores', 'financeiro_feriados', 'ajustes_financeiros',
  'producao_eventos', 'financeiro_fechamentos', 'financeiro_fechamento_itens', 'financeiro_pagamentos', 'financeiro_eventos'
];

function hojeBR() {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = t => partes.find(p => p.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

function unicoViolado(tabela, lista, dados) {
  if (tabela === 'devolucoes') {
    return lista.some(l => (l.pedido_id === dados.pedido_id && l.sequencia === dados.sequencia) || (dados.chave_idempotencia && l.chave_idempotencia === dados.chave_idempotencia));
  }
  if (tabela === 'notas_devolucao') return lista.some(l => l.chave_acesso === dados.chave_acesso);
  if (tabela === 'reembolsos') return lista.some(l => l.devolucao_id === dados.devolucao_id);
  return false;
}

function criarUpstream(tabelas) {
  let proximo = 1000;
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const responder = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    const [, tabela, id] = url.pathname.match(/^\/api\/([a-z_]+)(?:\/(\d+))?$/) || [];
    const lista = tabela && tabelas[tabela];
    if (!lista) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const dados = corpo ? JSON.parse(corpo) : {};
      if (req.method === 'GET') {
        if (id) return responder(200, lista.find(l => String(l.id) === id) || { error: 'Not found' });
        const filtros = [...url.searchParams.entries()].filter(([k]) => k !== 'select' && k !== 'order');
        // Como a API de verdade: coluna que a tabela não tem é ignorada no filtro.
        return responder(200, lista.filter(l => filtros.every(([k, v]) => !(k in l) || String(l[k]) === String(v))));
      }
      if (req.method === 'POST') {
        if (unicoViolado(tabela, lista, dados)) return responder(500, { error: 'Erro no INSERT', detalhe: 'duplicate key value violates unique constraint' });
        const linha = { id: dados.id ?? proximo++, ...dados };
        lista.push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT' && id) {
        const linha = lista.find(l => String(l.id) === id);
        if (!linha) return responder(404, { error: 'não há' });
        Object.assign(linha, dados);
        return responder(200, linha);
      }
      return responder(404, { error: 'não há' });
    });
    return undefined;
  });
}

/** Pedido 55 (Enviado): 4 poltronas de R$ 750 e 1 mesa de R$ 1.000 = R$ 4.000 em 3 parcelas (1ª paga, 2ª sem boleto, 3ª com boleto). */
function tabelasBase() {
  return {
    configuracao_cobranca: [{ id: 1, recebimentos_desde: null, ambiente: 'sandbox' }],
    configuracao_fiscal: [{ id: 1, cnpj: '99888777000166' }],
    pedidos: [
      { id: 55, numero: 'PED55', situacao: 'Enviado', cliente_id: 7, valor_final: 4000, prazo: '30/60/90' },
      { id: 56, numero: 'PED56', situacao: 'Produção', cliente_id: 7, valor_final: 100 }
    ],
    pedidos_itens: [
      { id: 501, pedido_id: 55, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona Asa', ncm: '94016100', quantidade: 4, valor_unitario: 800, valor_unitario_desc: 750, valor_total: 3000 },
      { id: 502, pedido_id: 55, produto_id: 11, codigo: 'MES-01', nome: 'Mesa Lateral', ncm: '94036000', quantidade: 1, valor_unitario: 1000, valor_unitario_desc: 1000, valor_total: 1000 },
      { id: 601, pedido_id: 56, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona Asa', quantidade: 1, valor_total: 100 }
    ],
    pedido_parcelas: [
      { id: 1, pedido_id: 55, numero_parcela: 1, valor: '1000.00', data_vencimento: '2026-08-10' },
      { id: 2, pedido_id: 55, numero_parcela: 2, valor: '1000.00', data_vencimento: '2099-01-10' },
      { id: 3, pedido_id: 55, numero_parcela: 3, valor: '2000.00', data_vencimento: '2099-02-10' }
    ],
    boletos: [{
      id: 90, pedido_id: 55, parcela_id: 3, numero_parcela: 3, ambiente: 'sandbox', convenio: '3128557', nosso_numero: '00031285570000000090', valor: '2000.00',
      data_vencimento: '2099-02-10', status: 'registrado', valor_abatimento: '0', vencimento_original: null, motivo_baixa: null, sincronizado_em: null
    }],
    boletos_eventos: [], cobranca_execucoes: [],
    recebimentos: [{
      id: 1, pedido_id: 55, numero_parcela: 1, status: 'confirmado', origem: 'manual', forma: 'Pix', data_recebimento: '2026-08-10',
      competencia: '2026-08', valor_parcela: '1000.00', valor_abatimento: '0', valor_recebido: '1000.00', valor_encargos: '0'
    }],
    notas_fiscais: [{ id: 10, pedido_id: 55, serie: 2, numero: 123, status_fiscal: 'autorizada', chave_acesso: CHAVE_DA_VENDA }],
    clientes: [{ id: 7, nome_fantasia: 'Básica Home', cnpj: '11222333000144' }],
    usuarios: [{ id: 1, nome: 'Henrique' }],
    materia_prima: [{ id: 300, nome: 'Verniz', processo: 'Acabamento' }],
    produtos_insumos: [{ id: 1, produto_id: 10, insumo_id: 300, quantidade: 1, ordem_insumo: 1 }],
    produtos_em_cada_ponto: [{ id: 700, produto_id: 10, etapa_id: 'Acabamento', ultimo_insumo_id: 300, quantidade: 2 }],
    estoque_movimentos: [], pedido_historico_eventos: []
  };
}

const vazias = nomes => Object.fromEntries(nomes.map(n => [n, []]));
function tabelasG() {
  const t = vazias(TABELAS_G);
  t.financeiro_configuracao.push({ id: 1, comissao_dia_pagamento: 15, producao_dia_util: 5, sabado_dia_util: false });
  t.comissao_regras.push({ id: 1, tipo: 'cms', beneficiario: 'Arquiteta Ana', percentual: 10, escopo: 'todos', ativo: true });
  return t;
}

async function montar(tabelas) {
  const upstream = criarUpstream(tabelas);
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  for (const chave of Object.keys(require.cache)) {
    if (/[\\/]backend[\\/](financeiro|cobranca|fiscal|devolucoes)[\\/](?!.*\.test\.js$)/.test(chave)
      || /(apiHttpClient|permissionsController|cobrancaController|devolucoesController|estoqueLedger|cancelamentoEstorno)\.js$/.test(chave)) delete require.cache[chave];
  }
  const estado = { chaves: new Set(), bbForaDoAr: false, chamadasBB: [] };
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: chave => (req, res, next) => {
        const chaves = Array.isArray(chave) ? chave : [chave];
        const falta = chaves.find(k => !estado.chaves.has(k));
        return falta ? res.status(403).json({ error: 'Permissão negada', permissao: falta }) : next();
      },
      exigirSupAdmin: (req, res) => res.status(403).json({ error: 'Somente Sup Admin' }),
      ehSupAdmin: async () => false
    }
  };
  const bb = {
    chamar: async ({ metodo, caminho, corpo }) => {
      if (estado.bbForaDoAr) throw Object.assign(new Error('BB fora do ar'), { status: 502 });
      estado.chamadasBB.push({ metodo, caminho, corpo });
      if (metodo === 'GET') throw Object.assign(new Error('consulta não dublada'), { status: 502 });
      return {};
    }
  };
  const { criarRouter } = require('./devolucoesController');
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use('/api/devolucoes', criarRouter({ contextoBB: async () => ({ bb, cfg: tabelas.configuracao_cobranca[0], conexao: {} }) }));
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, corpo: await r.json() };
  };
  const permitir = (...chaves) => chaves.forEach(k => estado.chaves.add(k));
  const fechar = () => Promise.all([new Promise(r => servidor.close(r)), new Promise(r => upstream.close(r))]);
  return { chamar, permitir, estado, tabelas, fechar };
}

test('sem o SQL da devolução: 409 com sql_pendente e o nome do arquivo; sem a permissão: 403', async () => {
  const t = await montar(tabelasBase());
  try {
    assert.equal((await t.chamar('GET', '/api/devolucoes/pedido/55')).status, 403);
    t.permitir('ped.devolucao');
    const r = await t.chamar('GET', '/api/devolucoes/pedido/55');
    assert.equal(r.status, 409);
    assert.equal(r.corpo.sql_pendente, true);
    assert.match(r.corpo.error, /sql\/devolucoes\.sql/);
  } finally {
    await t.fechar();
  }
});

test('ponta a ponta: parcial com desconto proporcional, depois o resto vira total com baixa, reembolso e ajuste de comissão', async () => {
  const hoje = hojeBR();
  const t = await montar({ ...tabelasBase(), ...tabelasG(), ...vazias(TABELAS_DEVOLUCAO) });
  try {
    t.permitir('ped.devolucao');

    // Pedido em produção e sem nota: é cancelamento, não devolução.
    const emProducao = await t.chamar('GET', '/api/devolucoes/pedido/56');
    assert.match(emProducao.corpo.bloqueio, /use "Cancelar"/);
    assert.equal((await t.chamar('POST', '/api/devolucoes/pedido/56', { itens: [{ pedido_item_id: 601, quantidade: 1 }], data_devolucao: hoje, motivo: 'teste' })).status, 409);

    const tela = await t.chamar('GET', '/api/devolucoes/pedido/55');
    assert.equal(tela.status, 200);
    assert.equal(tela.corpo.bloqueio, null);
    assert.deepEqual(tela.corpo.itens.map(i => [i.pedido_item_id, i.disponivel, i.valor_unitario]), [[501, 4, 750], [502, 1, 1000]]);
    assert.deepEqual(tela.corpo.parcelas.map(p => [p.numero, p.estado, p.saldo, p.pago]), [[1, 'paga', 0, 1000], [2, 'aberta', 1000, 0], [3, 'aberta', 2000, 0]]);

    // Prévia: 2 poltronas = R$ 1.500 sobre R$ 3.000 em aberto → R$ 500 na 2ª e R$ 1.000 na 3ª (boleto).
    const previa = await t.chamar('POST', '/api/devolucoes/pedido/55/previa', { itens: [{ pedido_item_id: 501, quantidade: 2 }] });
    assert.equal(previa.status, 200);
    assert.deepEqual([previa.corpo.tipo, previa.corpo.valor, previa.corpo.valor_reembolso], ['parcial', 1500, 0]);
    assert.deepEqual(previa.corpo.parcelas.map(p => [p.numero_parcela, p.modo, p.desconto, p.valor_depois]), [[2, 'valor_parcela', 500, 500], [3, 'abatimento_boleto', 1000, 1000]]);
    assert.equal(t.tabelas.devolucoes.length, 0, 'a prévia não grava nada');

    assert.equal((await t.chamar('POST', '/api/devolucoes/pedido/55', { itens: [{ pedido_item_id: 501, quantidade: 2 }], data_devolucao: hoje })).status, 400, 'sem motivo');
    assert.equal((await t.chamar('POST', '/api/devolucoes/pedido/55', { itens: [{ pedido_item_id: 501, quantidade: 9 }], data_devolucao: hoje, motivo: 'Avaria' })).status, 422);
    assert.equal(t.tabelas.devolucoes.length, 0, 'recusa sem gravar nada');

    const entrada = { itens: [{ pedido_item_id: 501, quantidade: 2 }], data_devolucao: hoje, motivo: 'Cliente recusou 2 poltronas', chave_idempotencia: 'abc-1' };
    const parcial = await t.chamar('POST', '/api/devolucoes/pedido/55', entrada);
    assert.equal(parcial.status, 200);
    assert.equal(parcial.corpo.devolucao.status, 'concluida');
    assert.equal(parcial.corpo.pendencias, 0);
    // Estoque: o lote de peça pronta foi de 2 para 4, com o movimento próprio.
    assert.equal(t.tabelas.produtos_em_cada_ponto[0].quantidade, 4);
    assert.deepEqual(t.tabelas.estoque_movimentos.map(m => [m.tipo_movimento, m.item_id, m.quantidade, m.pedido_id]), [['retorno_devolucao', 10, 2, 55]]);
    assert.equal(t.tabelas.pedidos_itens[0].quantidade_devolvida, 2);
    // Parcelas: a sem boleto baixa o valor (guardando o original); a com boleto ganha abatimento no BB.
    assert.deepEqual([t.tabelas.pedido_parcelas[1].valor, t.tabelas.pedido_parcelas[1].valor_original], [500, '1000.00']);
    assert.equal(t.tabelas.pedido_parcelas[2].valor, '2000.00');
    assert.equal(Number(t.tabelas.boletos[0].valor_abatimento), 1000);
    assert.ok(t.estado.chamadasBB.some(x => x.metodo === 'PATCH'), 'o abatimento foi ao BB');
    // Pedido: etiqueta parcial e o valor que restou.
    const pedido = t.tabelas.pedidos[0];
    assert.deepEqual([pedido.devolucao, pedido.valor_original, pedido.valor_devolvido, pedido.valor_final, pedido.situacao], ['parcial', 4000, 1500, 2500, 'Enviado']);
    assert.equal(t.tabelas.reembolsos.length, 0);
    assert.match(t.tabelas.pedido_historico_eventos[0].descricao, /Devolução parcial nº 1/);
    assert.equal(t.tabelas.pedido_historico_eventos[0].tipo_evento, 'devolucao');
    assert.ok(t.tabelas.financeiro_eventos.some(e => e.tipo === 'devolucao_registrada'));

    // O mesmo envio de novo (duplo clique) devolve a mesma devolução.
    const repetida = await t.chamar('POST', '/api/devolucoes/pedido/55', entrada);
    assert.equal(repetida.corpo.repetida, true);
    assert.equal(t.tabelas.devolucoes.length, 1);

    // O resto volta: total. A 2ª (R$ 500) é cancelada, o boleto da 3ª é baixado e a 1ª (paga) é reembolsada.
    const resto = await t.chamar('POST', '/api/devolucoes/pedido/55', {
      itens: [{ pedido_item_id: 501, quantidade: 2 }, { pedido_item_id: 502, quantidade: 1 }], data_devolucao: hoje, motivo: 'Desistiu do restante'
    });
    assert.equal(resto.status, 200);
    assert.equal(resto.corpo.devolucao.tipo, 'total');
    assert.deepEqual(resto.corpo.parcelas.map(p => [p.numero_parcela, p.modo, p.desconto, p.status]), [[1, 'reembolso', 1000, 'ok'], [2, 'cancelada', 500, 'ok'], [3, 'baixa_boleto', 1000, 'ok']]);
    assert.deepEqual(t.tabelas.pedido_parcelas.map(p => Number(p.valor)), [1000, 0, 0]);
    assert.deepEqual([t.tabelas.boletos[0].status, t.tabelas.boletos[0].motivo_baixa], ['baixado', 'cancelado']);
    assert.deepEqual([t.tabelas.pedidos[0].devolucao, t.tabelas.pedidos[0].valor_devolvido, t.tabelas.pedidos[0].valor_final], ['total', 4000, 4000]);
    assert.deepEqual(t.tabelas.reembolsos.map(r => [r.valor, r.status]), [[1000, 'pendente']]);
    // Comissão: o reembolso vira ajuste "Devolução" na parcela paga.
    assert.deepEqual(t.tabelas.ajustes_financeiros.map(a => [a.tipo, a.numero_parcela, a.valor]), [['devolucao', 1, 1000]]);
    assert.equal(t.tabelas.devolucao_parcelas.find(p => p.modo === 'reembolso').ajuste_id, t.tabelas.ajustes_financeiros[0].id);
    // A mesa não tem rota cadastrada: entrou num lote "sem ponto".
    assert.ok(t.tabelas.produtos_em_cada_ponto.some(l => l.produto_id === 11 && l.quantidade === 1));

    // Devolvido por inteiro: não há mais o que devolver.
    const depois = await t.chamar('GET', '/api/devolucoes/pedido/55');
    assert.match(depois.corpo.bloqueio, /já foi devolvido por inteiro/);
    assert.equal(depois.corpo.devolucoes.length, 2);

    // Reembolso: aparece pendente e é confirmado uma vez só, com a permissão dele.
    t.permitir('financeiro.view');
    const lista = await t.chamar('GET', '/api/devolucoes/reembolsos?status=pendente');
    assert.deepEqual(lista.corpo.reembolsos.map(r => [r.pedido, r.cliente, r.valor]), [['PED55', 'Básica Home', 1000]]);
    const idReembolso = lista.corpo.reembolsos[0].id;
    assert.equal((await t.chamar('POST', `/api/devolucoes/reembolsos/${idReembolso}/confirmar`, { data_pagamento: hoje, forma: 'Pix' })).status, 403);
    t.permitir('financeiro.reembolso.confirmar');
    assert.equal((await t.chamar('POST', `/api/devolucoes/reembolsos/${idReembolso}/confirmar`, { data_pagamento: hoje, forma: 'Boleto' })).status, 400);
    assert.equal((await t.chamar('POST', `/api/devolucoes/reembolsos/${idReembolso}/confirmar`, { data_pagamento: hoje, forma: 'Pix' })).status, 200);
    assert.equal((await t.chamar('POST', `/api/devolucoes/reembolsos/${idReembolso}/confirmar`, { data_pagamento: hoje, forma: 'Pix' })).status, 409);
    assert.ok(t.tabelas.financeiro_eventos.some(e => e.tipo === 'reembolso_confirmado'));
  } finally {
    await t.fechar();
  }
});

test('o XML do cliente preenche as quantidades, fica guardado e não entra duas vezes; BB fora do ar vira pendência e "tentar de novo" resolve', async () => {
  const hoje = hojeBR();
  const t = await montar({ ...tabelasBase(), ...vazias(TABELAS_DEVOLUCAO) });
  try {
    t.permitir('ped.devolucao', 'ped.view');
    const xml = notaDeDevolucao({
      itens: [{ codigo: 'X1', nome: 'POLTRONA ASA', ncm: '94016100', qtd: '1.0000', un: '750.0000', total: '750.00' }]
    });
    const lido = await t.chamar('POST', '/api/devolucoes/pedido/55/xml', { xml });
    assert.equal(lido.status, 200);
    assert.deepEqual(lido.corpo.bloqueios, []);
    assert.deepEqual(lido.corpo.escolhas, [{ pedido_item_id: 501, quantidade: 1 }]);
    assert.equal(lido.corpo.nota.numero, 456);
    assert.equal((await t.chamar('POST', '/api/devolucoes/pedido/55/xml', { xml: '<a/>' })).status, 422);

    t.estado.bbForaDoAr = true;
    const r = await t.chamar('POST', '/api/devolucoes/pedido/55', { itens: lido.corpo.escolhas, data_devolucao: hoje, motivo: 'Peça com defeito', xml });
    assert.equal(r.status, 200);
    // R$ 750 sobre R$ 3.000 em aberto: R$ 250 na 2ª (gravou) e R$ 500 na 3ª (BB fora do ar).
    assert.equal(r.corpo.devolucao.status, 'pendencias');
    assert.deepEqual(r.corpo.parcelas.map(p => [p.numero_parcela, p.modo, p.desconto, p.status]), [[2, 'valor_parcela', 250, 'ok'], [3, 'abatimento_boleto', 500, 'erro']]);
    assert.match(r.corpo.avisos.join(' | '), /BB fora do ar/);
    assert.equal(Number(t.tabelas.boletos[0].valor_abatimento), 0);
    // A nota ficou guardada, ligada à devolução, e a lista sai sem o XML.
    assert.equal(t.tabelas.notas_devolucao.length, 1);
    assert.equal(t.tabelas.devolucoes[0].nota_devolucao_id, t.tabelas.notas_devolucao[0].id);
    const notas = await t.chamar('GET', '/api/devolucoes/notas?pedido_id=55');
    assert.equal(notas.corpo.length, 1);
    assert.equal(notas.corpo[0].xml, undefined);
    assert.equal((await t.chamar('GET', `/api/devolucoes/notas/${notas.corpo[0].id}/xml`)).corpo.xml, xml);
    // A mesma nota não entra de novo.
    const deNovo = await t.chamar('POST', '/api/devolucoes/pedido/55', { itens: [{ pedido_item_id: 501, quantidade: 1 }], data_devolucao: hoje, motivo: 'Outra', xml });
    assert.equal(deNovo.status, 409);
    assert.match(deNovo.corpo.error, /já foi lançada/);

    t.estado.bbForaDoAr = false;
    const denovo = await t.chamar('POST', `/api/devolucoes/${r.corpo.devolucao.id}/reaplicar`);
    assert.equal(denovo.status, 200);
    assert.equal(denovo.corpo.devolucao.status, 'concluida');
    assert.equal(denovo.corpo.pendencias, 0);
    assert.equal(Number(t.tabelas.boletos[0].valor_abatimento), 500);
    // Tentar de novo outra vez não aplica nada em dobro.
    await t.chamar('POST', `/api/devolucoes/${r.corpo.devolucao.id}/reaplicar`);
    assert.equal(Number(t.tabelas.boletos[0].valor_abatimento), 500);
    // Sem as tabelas da fase G nada quebrou: a devolução não depende delas.
    assert.equal(t.tabelas.pedidos[0].devolucao, 'parcial');
  } finally {
    await t.fechar();
  }
});
