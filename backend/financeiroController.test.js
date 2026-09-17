/**
 * Rotas do Financeiro completo (backend/financeiroController.js), de ponta
 * a ponta, com uma API genérica de mentira que tem as travas do banco
 * (fechamento único por tipo e competência, item e pagamento únicos) e
 * permissões dubladas.
 *
 * O caminho: sem o SQL a tela sabe o que fazer; cada ação pede a sua
 * permissão; regras → recebimento → ajuste antes do fechamento → fechar
 * (uma vez só) → ajuste depois (estorno na próxima) → pagar (uma vez só) →
 * produção com saldo e valor por peça → fechar a produção → estorno do
 * fechado vira negativo → relatórios, detalhes da parcela e do pedido.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const TOKEN = 'x.eyJpZCI6MX0.assinatura';
const TABELAS_G = [
  'financeiro_configuracao', 'comissao_regras', 'producao_setores', 'producao_valores', 'financeiro_feriados', 'ajustes_financeiros',
  'producao_eventos', 'financeiro_fechamentos', 'financeiro_fechamento_itens', 'financeiro_pagamentos', 'financeiro_eventos'
];

function hojeBR() {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = t => partes.find(p => p.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}
const mesesAntes = (comp, n) => {
  const [a, m] = comp.split('-').map(Number);
  const t = a * 12 + (m - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

function unicoViolado(tabela, lista, dados) {
  if (tabela === 'financeiro_fechamentos') return lista.some(l => l.tipo === dados.tipo && l.competencia === dados.competencia);
  if (tabela === 'financeiro_fechamento_itens') {
    return (dados.producao_evento_id && lista.some(l => l.producao_evento_id === dados.producao_evento_id))
      || (dados.tipo_item === 'parcela' && dados.recebimento_id && lista.some(l => l.tipo_item === 'parcela' && l.recebimento_id === dados.recebimento_id));
  }
  if (tabela === 'financeiro_pagamentos') return lista.some(l => l.fechamento_id === dados.fechamento_id);
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
        if (id) return responder(200, lista.find(l => String(l.id) === id) || null);
        const filtros = [...url.searchParams.entries()].filter(([k]) => k !== 'select' && k !== 'order');
        return responder(200, lista.filter(l => filtros.every(([k, v]) => String(l[k]) === String(v))));
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
      if (req.method === 'DELETE' && id) {
        const i = lista.findIndex(l => String(l.id) === id);
        if (i >= 0) lista.splice(i, 1);
        return responder(200, {});
      }
      return responder(404, { error: 'não há' });
    });
    return undefined;
  });
}

function tabelasBase(ant) {
  return {
    configuracao_cobranca: [{ id: 1, recebimentos_desde: null }],
    pedidos: [{ id: 55, numero: '2548', situacao: 'Enviado', cliente_id: 7, valor_final: 40000, prazo: '30/60', data_aprovacao: `${ant}-01` }],
    pedido_parcelas: [
      { id: 1, pedido_id: 55, numero_parcela: 1, valor: '20000.00', data_vencimento: `${ant}-20` },
      { id: 2, pedido_id: 55, numero_parcela: 2, valor: '20000.00', data_vencimento: '2099-01-20' }
    ],
    pedidos_itens: [{ id: 501, pedido_id: 55, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona', quantidade: 5, qtd_usar_pronta: 0 }],
    clientes: [{ id: 7, nome_fantasia: 'Cliente Bom' }],
    usuarios: [{ id: 1, nome: 'Henrique' }],
    produtos: [{ id: 10, codigo: 'POL-01', nome: 'Poltrona' }],
    notas_fiscais: [{ id: 10, pedido_id: 55, serie: 1, numero: 5, status_fiscal: 'autorizada' }],
    boletos: [], boletos_eventos: [], cobranca_execucoes: [],
    recebimentos: [{
      id: 1, pedido_id: 55, numero_parcela: 1, status: 'confirmado', origem: 'manual', forma: 'Pix', data_recebimento: `${ant}-10`,
      competencia: ant, valor_parcela: '20000.00', valor_abatimento: '0', valor_recebido: '20000.00', valor_encargos: '0'
    }]
  };
}

function tabelasG() {
  const t = Object.fromEntries(TABELAS_G.map(n => [n, []]));
  t.financeiro_configuracao.push({ id: 1, comissao_dia_pagamento: 15, producao_dia_util: 5, sabado_dia_util: false });
  t.producao_setores.push({ id: 1, nome: 'Marcenaria', ordem: 1, ativo: true }, { id: 2, nome: 'Pintura', ordem: 2, ativo: true });
  return t;
}

async function montar(tabelas) {
  const upstream = criarUpstream(tabelas);
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  for (const chave of Object.keys(require.cache)) {
    if (/[\\/]backend[\\/](financeiro|cobranca|fiscal)[\\/]/.test(chave) || /(apiHttpClient|permissionsController|cobrancaController|financeiroController)\.js$/.test(chave)) delete require.cache[chave];
  }
  const estado = { chaves: new Set() };
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: chave => (req, res, next) => {
        const bruto = typeof chave === 'function' ? chave(req) : chave;
        const chaves = Array.isArray(bruto) ? bruto : [bruto];
        const falta = chaves.find(c => !estado.chaves.has(c));
        return falta ? res.status(403).json({ error: 'Permissão negada', permissao: falta }) : next();
      },
      exigirSupAdmin: (req, res) => res.status(403).json({ error: 'Somente Sup Admin' }),
      ehSupAdmin: async () => false
    }
  };
  const { criarRouter } = require('./financeiroController');
  const app = express();
  app.use(express.json());
  app.use('/api/financeiro', criarRouter());
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, corpo: await r.json() };
  };
  const permitir = (...chaves) => chaves.forEach(c => estado.chaves.add(c));
  const fechar = () => Promise.all([new Promise(r => servidor.close(r)), new Promise(r => upstream.close(r))]);
  return { chamar, permitir, estado, tabelas, fechar };
}

test('sem o SQL da fase G: a tela recebe 409 com sql_pendente e a mensagem do arquivo', async () => {
  const hoje = hojeBR();
  const t = await montar(tabelasBase(mesesAntes(hoje.slice(0, 7), 1)));
  try {
    t.permitir('financeiro.comissao.view');
    const r = await t.chamar('GET', '/api/financeiro/painel');
    assert.equal(r.status, 409);
    assert.equal(r.corpo.sql_pendente, true);
    assert.match(r.corpo.error, /financeiro_comissoes_producao\.sql/);
  } finally {
    await t.fechar();
  }
});

test('ponta a ponta: regras, ajuste, fechamento, estorno futuro, pagamento, produção, relatórios e detalhes', async () => {
  const hoje = hojeBR();
  const atual = hoje.slice(0, 7);
  const ant = mesesAntes(atual, 1);
  const t = await montar({ ...tabelasBase(ant), ...tabelasG() });
  try {
    // Ver não é editar.
    assert.equal((await t.chamar('GET', '/api/financeiro/painel')).status, 403);
    t.permitir('financeiro.comissao.view');
    const vazio = await t.chamar('GET', `/api/financeiro/painel?competencia=${ant}`);
    assert.equal(vazio.status, 200);
    assert.equal(vazio.corpo.tem_regras, false);
    assert.ok(vazio.corpo.pendencias.some(p => p.chave === 'sem_regras'));
    assert.equal(vazio.corpo.comissoes.valor, 0, 'sem regra, comissão zero — nada inventado');

    const regra = { tipo: 'cms', beneficiario: 'Arquiteta Ana', percentual: 10, escopo: 'todos' };
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', regra)).status, 403);
    t.permitir('financeiro.regras.editar');
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', regra)).status, 200);
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', regra)).status, 409, 'a mesma regra duas vezes');
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', { ...regra, percentual: 120 })).status, 400);
    await t.chamar('POST', '/api/financeiro/regras', { tipo: 'royalty', beneficiario: 'Marca', percentual: '10', escopo: 'todos' });
    assert.equal((await t.chamar('POST', '/api/financeiro/valores', { setor_id: 2, produto_id: null, valor_unitario: 25 })).status, 200);
    const telaRegras = await t.chamar('GET', '/api/financeiro/regras');
    assert.equal(telaRegras.corpo.regras.length, 2);
    assert.equal(telaRegras.corpo.valores[0].setor, 'Pintura');
    assert.ok(telaRegras.corpo.feriados_nacionais.some(f => f.descricao === 'Sexta-feira Santa'));

    const antes = await t.chamar('GET', `/api/financeiro/painel?competencia=${ant}`);
    assert.equal(antes.corpo.comissoes.valor, 4000);
    assert.equal(antes.corpo.comissoes.situacao, 'aberta');
    assert.ok(antes.corpo.pendencias.some(p => p.chave === 'fechar_comissao' && p.filtro.competencia === ant));

    // Ajuste antes do fechamento: reduz a base.
    const ajuste = { pedido_id: 55, numero_parcela: 1, tipo: 'desconto', valor: 3000, data_ajuste: `${ant}-12`, motivo: 'Negociação com o cliente' };
    assert.equal((await t.chamar('POST', '/api/financeiro/ajustes', ajuste)).status, 403);
    t.permitir('financeiro.ajuste.registrar');
    assert.equal((await t.chamar('POST', '/api/financeiro/ajustes', { ...ajuste, valor: 25000 })).status, 409, 'maior que o líquido');
    const aj = await t.chamar('POST', '/api/financeiro/ajustes', ajuste);
    assert.equal(aj.status, 200);
    assert.equal(aj.corpo.impacto.liquido, 17000);
    assert.equal(aj.corpo.impacto.gera_estorno, false);

    // Fechar: uma vez só.
    const previa = await t.chamar('GET', `/api/financeiro/fechamentos/previa?tipo=comissao&competencia=${ant}`);
    assert.equal(previa.corpo.comissao, 3400);
    assert.equal(previa.corpo.pode_fechar, true);
    assert.equal((await t.chamar('POST', '/api/financeiro/fechamentos', { tipo: 'comissao', competencia: ant })).status, 403);
    t.permitir('financeiro.competencia.fechar');
    const fechou = await t.chamar('POST', '/api/financeiro/fechamentos', { tipo: 'comissao', competencia: ant });
    assert.equal(fechou.status, 200);
    assert.equal(fechou.corpo.total, 3400);
    assert.equal(t.tabelas.financeiro_fechamentos[0].status, 'fechado');
    assert.equal((await t.chamar('POST', '/api/financeiro/fechamentos', { tipo: 'comissao', competencia: ant })).status, 409);
    assert.equal((await t.chamar('POST', '/api/financeiro/fechamentos', { tipo: 'comissao', competencia: mesesAntes(atual, -1) })).status, 409, 'futuro não fecha');

    // Ajuste depois do fechamento: não reescreve; vira estorno na próxima.
    const dev = await t.chamar('POST', '/api/financeiro/ajustes', { ...ajuste, tipo: 'devolucao', valor: 1000, data_ajuste: hoje, motivo: 'Peça devolvida' });
    assert.equal(dev.status, 200);
    assert.equal(dev.corpo.impacto.gera_estorno, true);
    const proxima = await t.chamar('GET', `/api/financeiro/fechamentos/previa?tipo=comissao&competencia=${atual}`);
    assert.equal(proxima.corpo.ajustes, -200);
    assert.equal(proxima.corpo.a_compensar, -200);
    assert.ok(proxima.corpo.avisos.some(a => /ainda não terminou/.test(a)));
    const fechada = await t.chamar('GET', `/api/financeiro/fechamentos/previa?tipo=comissao&competencia=${ant}`);
    assert.equal(fechada.corpo.fechado, true);
    assert.equal(fechada.corpo.a_pagar, 3400, 'o fechado continua igual');
    const primeiroAjuste = t.tabelas.ajustes_financeiros[0];
    assert.equal((await t.chamar('POST', `/api/financeiro/ajustes/${primeiroAjuste.id}/cancelar`, { motivo: 'engano de digitação' })).status, 409, 'já fechado não se cancela');

    // Pagar: uma vez só.
    const pagamento = { tipo: 'comissao', competencia: ant, data_pagamento: hoje, forma: 'Pix' };
    assert.equal((await t.chamar('POST', '/api/financeiro/pagamentos', pagamento)).status, 403);
    t.permitir('financeiro.pagamento.confirmar');
    assert.equal((await t.chamar('POST', '/api/financeiro/pagamentos', { ...pagamento, forma: 'Boleto' })).status, 400);
    assert.equal((await t.chamar('POST', '/api/financeiro/pagamentos', pagamento)).status, 200);
    assert.equal((await t.chamar('POST', '/api/financeiro/pagamentos', pagamento)).status, 409);
    assert.equal((await t.chamar('GET', `/api/financeiro/painel?competencia=${ant}`)).corpo.comissoes.situacao, 'paga');

    // Produção: saldo por setor, valor por peça, fechamento e estorno do fechado.
    const producao = { pedido_id: 55, pedido_item_id: 501, setor_id: 2, quantidade: 3, data_finalizacao: `${ant}-15` };
    assert.equal((await t.chamar('POST', '/api/financeiro/producao', producao)).status, 403);
    t.permitir('financeiro.producao.registrar');
    const doPedido = await t.chamar('GET', '/api/financeiro/producao/pedidos/55');
    assert.equal(doPedido.corpo.itens[0].setores.find(s => s.setor_id === 2).valor_unitario, 25);
    assert.equal(doPedido.corpo.itens[0].setores.find(s => s.setor_id === 1).valor_unitario, null);
    const reg = await t.chamar('POST', '/api/financeiro/producao', producao);
    assert.equal(reg.status, 200);
    assert.equal(reg.corpo.item.status, 'Parcial');
    assert.equal((await t.chamar('POST', '/api/financeiro/producao', { ...producao, quantidade: 3 })).status, 409, 'passa do saldo');
    const semValor = await t.chamar('POST', '/api/financeiro/producao', { ...producao, setor_id: 1, quantidade: 1 });
    assert.equal(semValor.corpo.sem_valor, true);
    const bloqueada = await t.chamar('GET', `/api/financeiro/fechamentos/previa?tipo=producao&competencia=${ant}`);
    assert.equal(bloqueada.corpo.pode_fechar, false);
    assert.match(bloqueada.corpo.bloqueios.join(' '), /Sem valor por peça/);
    await t.chamar('POST', `/api/financeiro/producao/${semValor.corpo.evento.id}/estornar`, { motivo: 'lançado no setor errado' });
    const prodFechou = await t.chamar('POST', '/api/financeiro/fechamentos', { tipo: 'producao', competencia: ant });
    assert.equal(prodFechou.status, 200);
    assert.equal(prodFechou.corpo.total, 75);
    const estorno = await t.chamar('POST', `/api/financeiro/producao/${reg.corpo.evento.id}/estornar`, { motivo: 'peças voltaram para retrabalho' });
    assert.equal(estorno.status, 200);
    assert.equal(estorno.corpo.ja_fechado, true);
    assert.equal(estorno.corpo.negativo.quantidade, -3);
    const prodAtual = await t.chamar('GET', `/api/financeiro/producao?competencia=${atual}`);
    assert.equal(prodAtual.corpo.liquido, -75);
    assert.equal(prodAtual.corpo.a_pagar, 0);
    assert.equal((await t.chamar('POST', `/api/financeiro/producao/${reg.corpo.evento.id}/estornar`, { motivo: 'de novo por engano' })).status, 409);

    // Relatórios e detalhes.
    const apuradas = await t.chamar('GET', `/api/financeiro/relatorios/comissoes-apuradas?competencia=${ant}`);
    assert.equal(apuradas.corpo.linhas.length, 1);
    assert.equal(apuradas.corpo.linhas[0].comissao, 3400);
    assert.equal(apuradas.corpo.linhas[0].cliente, 'Cliente Bom');
    const ajustesAnt = await t.chamar('GET', `/api/financeiro/relatorios/ajustes-anteriores?competencia=${atual}`);
    assert.equal(ajustesAnt.corpo.linhas[0].valor, -200);
    const pintura = await t.chamar('GET', `/api/financeiro/relatorios/pagamento-pintura?competencia=${ant}`);
    assert.equal(pintura.corpo.linhas[0].total, 75);
    assert.equal((await t.chamar('GET', '/api/financeiro/relatorios/nao-existe')).status, 404);
    const parcela = await t.chamar('GET', '/api/financeiro/parcelas/55/1');
    assert.equal(parcela.status, 200);
    assert.equal(parcela.corpo.ajustes.length, 2);
    assert.equal(parcela.corpo.ajustes[0].usuario, 'Henrique');
    assert.equal(parcela.corpo.fechamentos[0].pagamento.forma, 'Pix');
    assert.ok(parcela.corpo.historico.length >= 4);
    const pedido = await t.chamar('GET', '/api/financeiro/pedidos/55');
    assert.equal(pedido.corpo.producao.length, 3);
    assert.equal(pedido.corpo.pedido.cliente, 'Cliente Bom');
    const atrasadas = await t.chamar('GET', '/api/financeiro/parcelas?visao=ajustaveis');
    assert.deepEqual(atrasadas.corpo.linhas.map(l => l.numero_parcela), [1, 2]);
    assert.ok(t.tabelas.financeiro_eventos.some(e => e.tipo === 'pagamento_confirmado'));
    assert.ok(t.tabelas.financeiro_eventos.every(e => e.usuario_id === 1));
  } finally {
    await t.fechar();
  }
});

test('fechamento interrompido: o que sobrou é desfeito e nada conta como fechado', async () => {
  const hoje = hojeBR();
  const ant = mesesAntes(hoje.slice(0, 7), 1);
  const tabelas = { ...tabelasBase(ant), ...tabelasG() };
  tabelas.comissao_regras.push({ id: 1, tipo: 'cms', beneficiario: 'Ana', percentual: 10, escopo: 'todos', ativo: true });
  // Sobra antiga de uma queda: cabeçalho "fechando" com um item.
  tabelas.financeiro_fechamentos.push({ id: 90, tipo: 'comissao', competencia: ant, status: 'fechando', criado_em: '2020-01-01T00:00:00Z' });
  tabelas.financeiro_fechamento_itens.push({ id: 91, fechamento_id: 90, tipo_item: 'parcela', recebimento_id: 1, pedido_id: 55, numero_parcela: 1, cms: 1, royalty: 0, total: 1 });
  const t = await montar(tabelas);
  try {
    t.permitir('financeiro.comissao.view', 'financeiro.competencia.fechar');
    const previa = await t.chamar('GET', `/api/financeiro/fechamentos/previa?tipo=comissao&competencia=${ant}`);
    assert.equal(previa.corpo.fechado, false, '"fechando" não vale');
    assert.equal(previa.corpo.comissao, 2000);
    const r = await t.chamar('POST', '/api/financeiro/fechamentos', { tipo: 'comissao', competencia: ant });
    assert.equal(r.status, 200);
    assert.ok(!tabelas.financeiro_fechamentos.some(f => f.id === 90));
    assert.ok(!tabelas.financeiro_fechamento_itens.some(i => i.id === 91));
    assert.equal(tabelas.financeiro_fechamento_itens.length, 1);
  } finally {
    await t.fechar();
  }
});
