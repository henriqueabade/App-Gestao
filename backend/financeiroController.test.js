/**
 * Rotas do Financeiro completo (backend/financeiroController.js), de ponta
 * a ponta, com uma API genérica de mentira que tem as travas do banco
 * (fechamento único por tipo e competência, item e pagamento únicos) e
 * permissões dubladas.
 *
 * O caminho: sem o SQL a tela sabe o que fazer; cada ação pede a sua
 * permissão; regras (CMS só para o dono do cliente, Royalty para o desenhista
 * da peça) → recebimento → ajuste antes do fechamento → fechar (uma vez só) →
 * ajuste depois (estorno na próxima) → pagar (uma vez só) → produção por
 * processo, proporcional aos insumos que faltavam (a peça do estoque paga só
 * o resto) → fechar a produção → estorno do fechado vira negativo →
 * relatórios, detalhes da parcela e do pedido; a regra de produção da peça;
 * os processos (incluir, renomear, desligar, excluir).
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
    pedidos_itens: [{ id: 501, pedido_id: 55, produto_id: 10, codigo: 'POL-01', nome: 'Poltrona', quantidade: 5, qtd_usar_pronta: 0, valor_total: '40000.00' }],
    clientes: [{ id: 7, nome_fantasia: 'Cliente Bom', dono_cliente: 'Marcia Lamounier' }, { id: 8, nome_fantasia: 'Outro Cliente', dono_cliente: 'Iara Abade' }],
    usuarios: [{ id: 1, nome: 'Henrique' }],
    produtos: [{ id: 10, codigo: 'POL-01', nome: 'Poltrona', desenhado_por: 'Barral & Lamounier' }],
    // Rota da poltrona: 3 insumos de Marcenaria e 2 de Acabamento.
    materia_prima: [
      { id: 301, nome: 'MDF', processo: 'Marcenaria' }, { id: 302, nome: 'Cola', processo: 'Marcenaria' }, { id: 303, nome: 'Parafuso', processo: 'Marcenaria' },
      { id: 304, nome: 'Seladora', processo: 'Acabamento' }, { id: 305, nome: 'Verniz', processo: 'Acabamento' }
    ],
    produtos_insumos: [301, 302, 303, 304, 305].map((insumo, i) => ({ id: 401 + i, produto_id: 10, insumo_id: insumo, quantidade: 1, ordem_insumo: i + 1 })),
    // Uma das 5 poltronas saiu do estoque com a marcenaria pronta e metade do acabamento (parou na Seladora).
    pedido_itens_ext: [{ id: 1, pedido_item_id: 501, id_pedido: 55, ultimo_insumo_id: 404, etapa_id: 700, quantidade: 1 }],
    produtos_em_cada_ponto: [{ id: 700, produto_id: 10, etapa_id: 'Acabamento', ultimo_insumo_id: 304, quantidade: 0 }],
    pedidos_itens_faltantes: [],
    tabela_fixa: [{ id_prod: 10, cod_prod: 'POL-01', vlr_prod: '1000.00' }],
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
  t.etapas_producao = [
    { id: 1, nome: 'Marcenaria', ordem: 1, producao_ativa: true },
    { id: 2, nome: 'Acabamento', ordem: 2, producao_ativa: true },
    { id: 3, nome: 'Embalagem', ordem: 3, producao_ativa: false }
  ];
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
      exigirAlgumaPermissao: chaves => (req, res, next) => ([].concat(chaves).some(k => estado.chaves.has(k)) ? next() : res.status(403).json({ error: 'Permissão negada' })),
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

    const regra = { tipo: 'cms', beneficiario: 'Marcia Lamounier', percentual: 10, escopo: 'todos' };
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', regra)).status, 403);
    t.permitir('financeiro.regras.editar');
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', { ...regra, beneficiario: 'Arquiteta Ana' })).status, 422, 'CMS só para dono de cliente');
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', { ...regra, beneficiario: 'Iara Abade', escopo: 'cliente', cliente_id: 7 })).status, 422, 'no cliente, só o dono DELE');
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', regra)).status, 200);
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', regra)).status, 409, 'a mesma regra duas vezes');
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', { ...regra, percentual: 120 })).status, 400);
    // Iara ganha regra, mas o cliente 7 é da Marcia: não entra neste pedido.
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', { ...regra, beneficiario: 'Iara Abade', percentual: 50 })).status, 200);
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', { tipo: 'royalty', beneficiario: 'Qualquer', percentual: '10', escopo: 'todos' })).status, 200);
    assert.equal((await t.chamar('POST', '/api/financeiro/regras', { tipo: 'royalty', percentual: '12', escopo: 'todos' })).status, 409, 'um royalty por alcance');
    assert.equal(t.tabelas.comissao_regras.find(r => r.tipo === 'royalty').beneficiario, null, 'royalty não tem quem recebe: é o desenhista');
    assert.equal((await t.chamar('POST', '/api/financeiro/valores', { etapa_id: 2, produto_id: null, tipo: 'valor', valor: 25 })).status, 200);
    assert.equal((await t.chamar('POST', '/api/financeiro/valores', { etapa_id: 2, produto_id: null, tipo: 'percentual', valor: 150 })).status, 400);
    const telaRegras = await t.chamar('GET', '/api/financeiro/regras');
    assert.equal(telaRegras.corpo.regras.length, 3);
    assert.equal(telaRegras.corpo.regras.find(r => r.tipo === 'royalty').beneficiario, 'Desenhista da peça');
    assert.deepEqual([telaRegras.corpo.valores[0].etapa, telaRegras.corpo.valores[0].descricao], ['Acabamento', 'R$\u00a025,00 por peça']);
    assert.deepEqual(telaRegras.corpo.donos, ['Iara Abade', 'Marcia Lamounier']);
    assert.deepEqual(telaRegras.corpo.etapas.map(e => [e.nome, e.producao_ativa]), [['Marcenaria', true], ['Acabamento', true], ['Embalagem', false]]);
    assert.ok(telaRegras.corpo.feriados_nacionais.some(f => f.descricao === 'Sexta-feira Santa'));
    const detalheRegra = await t.chamar('GET', '/api/financeiro/fechamentos/previa?tipo=comissao&competencia=' + ant);
    const benefs = detalheRegra.corpo.beneficiarios.map(b => [b.tipo, b.beneficiario, b.valor]);
    assert.deepEqual(benefs, [['cms', 'Marcia Lamounier', 2000], ['royalty', 'Barral & Lamounier', 2000]], 'CMS para a dona do cliente, royalty para o desenhista da poltrona');

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

    // Produção por processo: a poltrona do estoque (acabamento pela metade) paga meio acabamento e nenhuma marcenaria.
    const producao = { pedido_id: 55, pedido_item_id: 501, etapa_id: 2, quantidade: 3, data_finalizacao: `${ant}-15` };
    assert.equal((await t.chamar('POST', '/api/financeiro/producao', producao)).status, 403);
    t.permitir('financeiro.producao.registrar');
    const doPedido = await t.chamar('GET', '/api/financeiro/producao/pedidos/55');
    assert.deepEqual(doPedido.corpo.setores.map(s => s.nome), ['Marcenaria', 'Acabamento'], 'Embalagem está com o pagamento desligado');
    const acab = doPedido.corpo.itens[0].setores.find(s => s.setor_id === 2);
    const marc = doPedido.corpo.itens[0].setores.find(s => s.setor_id === 1);
    assert.deepEqual([acab.pedida, acab.valor_unitario, acab.proximas], [5, 25, [0.5, 1, 1, 1, 1]]);
    assert.deepEqual([marc.pedida, marc.valor_unitario], [4, null], 'a do estoque já tinha a marcenaria: 4 peças precisam dela');
    assert.equal(doPedido.corpo.itens[0].do_estoque, 1);
    const reg = await t.chamar('POST', '/api/financeiro/producao', producao);
    assert.equal(reg.status, 200);
    assert.equal(reg.corpo.valor, 62.5, 'meia peça + duas inteiras a R$ 25');
    assert.equal(reg.corpo.item.status, 'Parcial');
    assert.equal((await t.chamar('POST', '/api/financeiro/producao', { ...producao, quantidade: 3 })).status, 409, 'passa do saldo');
    assert.equal((await t.chamar('POST', '/api/financeiro/producao', { ...producao, etapa_id: 3, quantidade: 1 })).status, 404, 'processo desligado não se registra');
    const semValor = await t.chamar('POST', '/api/financeiro/producao', { ...producao, etapa_id: 1, quantidade: 1 });
    assert.equal(semValor.corpo.sem_valor, true);
    const bloqueada = await t.chamar('GET', `/api/financeiro/fechamentos/previa?tipo=producao&competencia=${ant}`);
    assert.equal(bloqueada.corpo.pode_fechar, false);
    assert.match(bloqueada.corpo.bloqueios.join(' '), /Produção sem valor/);
    await t.chamar('POST', `/api/financeiro/producao/${semValor.corpo.evento.id}/estornar`, { motivo: 'lançado no processo errado' });
    const prodFechou = await t.chamar('POST', '/api/financeiro/fechamentos', { tipo: 'producao', competencia: ant });
    assert.equal(prodFechou.status, 200);
    assert.equal(prodFechou.corpo.total, 62.5);
    const congelado = t.tabelas.financeiro_fechamento_itens.find(i => i.tipo_item === 'producao');
    assert.deepEqual([congelado.setor, JSON.parse(congelado.detalhes).fracao], ['Acabamento', 2.5]);
    const estorno = await t.chamar('POST', `/api/financeiro/producao/${reg.corpo.evento.id}/estornar`, { motivo: 'peças voltaram para retrabalho' });
    assert.equal(estorno.status, 200);
    assert.equal(estorno.corpo.ja_fechado, true);
    assert.equal(estorno.corpo.negativo.quantidade, -3);
    assert.equal(estorno.corpo.negativo.etapa_id, 2);
    const prodAtual = await t.chamar('GET', `/api/financeiro/producao?competencia=${atual}`);
    assert.equal(prodAtual.corpo.liquido, -62.5);
    assert.equal(prodAtual.corpo.a_pagar, 0);

    // Regra da peça: marcenaria em % da tabela fixa (R$ 1.000 → 10% = R$ 100 por peça inteira).
    const regraPeca = await t.chamar('GET', '/api/financeiro/regra-producao?produto_id=10');
    assert.equal(regraPeca.status, 200);
    assert.deepEqual(regraPeca.corpo.processos.map(p => [p.nome, p.insumos]).sort(), [['Acabamento', 2], ['Marcenaria', 3]]);
    assert.equal(regraPeca.corpo.preco_tabela, 1000);
    assert.equal(regraPeca.corpo.etapas.find(e => e.id === 2).padrao.descricao, 'R$\u00a025,00 por peça');
    const salvaRegra = await t.chamar('PUT', '/api/financeiro/regra-producao/10', { valores: [{ etapa_id: 1, modo: 'percentual', valor: '10' }, { etapa_id: 2, modo: 'padrao' }] });
    assert.equal(salvaRegra.status, 200);
    assert.equal(salvaRegra.corpo.completa, true);
    const comRegra = await t.chamar('GET', '/api/financeiro/producao/pedidos/55');
    assert.equal(comRegra.corpo.itens[0].setores.find(s => s.setor_id === 1).valor_unitario, 100);
    const incompleta = await t.chamar('PUT', '/api/financeiro/regra-producao/10', { valores: [{ etapa_id: 1, modo: 'padrao' }] });
    assert.deepEqual(incompleta.corpo.faltam.map(x => x.nome), ['Marcenaria'], 'sem o % da peça e sem padrão, a marcenaria fica sem regra');
    assert.equal((await t.chamar('POST', `/api/financeiro/producao/${reg.corpo.evento.id}/estornar`, { motivo: 'de novo por engano' })).status, 409);

    // Relatórios e detalhes.
    const apuradas = await t.chamar('GET', `/api/financeiro/relatorios/comissoes-apuradas?competencia=${ant}`);
    assert.equal(apuradas.corpo.linhas.length, 1);
    assert.equal(apuradas.corpo.linhas[0].comissao, 3400);
    assert.equal(apuradas.corpo.linhas[0].cliente, 'Cliente Bom');
    const ajustesAnt = await t.chamar('GET', `/api/financeiro/relatorios/ajustes-anteriores?competencia=${atual}`);
    assert.equal(ajustesAnt.corpo.linhas[0].valor, -200);
    const acabamento = await t.chamar('GET', `/api/financeiro/relatorios/pagamento-acabamento?competencia=${ant}`);
    assert.equal(acabamento.corpo.linhas[0].total, 62.5);
    const porPedido = await t.chamar('GET', `/api/financeiro/relatorios/producao-por-pedido?competencia=${ant}`);
    assert.deepEqual([porPedido.corpo.linhas[0].acabamento, porPedido.corpo.linhas[0].marcenaria], [62.5, 0]);
    assert.equal((await t.chamar('GET', `/api/financeiro/relatorios/pagamento-pintura?competencia=${ant}`)).status, 404, 'Pintura não é processo');
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
  tabelas.comissao_regras.push({ id: 1, tipo: 'cms', beneficiario: 'Marcia Lamounier', percentual: 10, escopo: 'todos', ativo: true });
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

test('processos: incluir, renomear (acompanha matéria-prima e estoque), desligar o pagamento e excluir só sem insumo', async () => {
  const hoje = hojeBR();
  const t = await montar({ ...tabelasBase(mesesAntes(hoje.slice(0, 7), 1)), ...tabelasG() });
  try {
    t.permitir('financeiro.comissao.view');
    assert.equal((await t.chamar('POST', '/api/financeiro/etapas', { nome: 'Pintura' })).status, 403);
    t.permitir('financeiro.regras.editar');
    const nova = await t.chamar('POST', '/api/financeiro/etapas', { nome: 'Pintura' });
    assert.equal(nova.status, 200);
    assert.deepEqual([nova.corpo.nome, nova.corpo.ordem, nova.corpo.producao_ativa], ['Pintura', 4, true]);
    assert.equal((await t.chamar('POST', '/api/financeiro/etapas', { nome: 'marcenária' })).status, 409, 'nome repetido (sem acento)');

    const renomeada = await t.chamar('PUT', '/api/financeiro/etapas/2', { nome: 'Acabamento Fino' });
    assert.equal(renomeada.status, 200);
    assert.equal(renomeada.corpo.registros_renomeados, 3, 'dois insumos e um lote do estoque');
    assert.deepEqual(t.tabelas.materia_prima.filter(m => m.processo === 'Acabamento Fino').map(m => m.id), [304, 305]);
    assert.equal(t.tabelas.produtos_em_cada_ponto[0].etapa_id, 'Acabamento Fino');

    const desligada = await t.chamar('PUT', '/api/financeiro/etapas/1', { producao_ativa: false });
    assert.equal(desligada.corpo.producao_ativa, false);
    assert.equal(t.tabelas.etapas_producao.find(e => e.id === 1).nome, 'Marcenaria', 'desligar não renomeia');

    const recusada = await t.chamar('DELETE', '/api/financeiro/etapas/1');
    assert.equal(recusada.status, 409);
    assert.match(recusada.corpo.error, /processo de 3 insumos/);
    assert.equal((await t.chamar('DELETE', `/api/financeiro/etapas/${nova.corpo.id}`)).status, 200);
    assert.deepEqual(t.tabelas.etapas_producao.map(e => [e.nome, e.ordem]), [['Marcenaria', 1], ['Acabamento Fino', 2], ['Embalagem', 3]]);
    assert.ok(t.tabelas.financeiro_eventos.some(e => /passou a se chamar Acabamento Fino/.test(e.descricao)));

    // Quem só cadastra peças lê e grava a regra da peça, mas não mexe nos processos.
    const soPecas = await montar({ ...tabelasBase(mesesAntes(hoje.slice(0, 7), 1)), ...tabelasG() });
    try {
      soPecas.permitir('prod.edit');
      assert.equal((await soPecas.chamar('GET', '/api/financeiro/regra-producao?produto_id=10')).status, 200);
      assert.equal((await soPecas.chamar('PUT', '/api/financeiro/regra-producao/10', { valores: [{ etapa_id: 1, modo: 'valor', valor: '12,50' }] })).status, 200);
      assert.equal((await soPecas.chamar('POST', '/api/financeiro/etapas', { nome: 'Outro' })).status, 403);
      assert.equal(soPecas.tabelas.producao_valores[0].valor_unitario, 12.5);
    } finally {
      await soPecas.fechar();
    }
  } finally {
    await t.fechar();
  }
});
