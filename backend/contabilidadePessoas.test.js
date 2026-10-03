/**
 * Contabilidade — fase E (02/10/2026): quem recebe CMS, Royalty e produção, e
 * a nota dela, pelas rotas, com a API genérica e a guarda de permissão de
 * mentira.
 *
 * O que fica preso:
 *   - a lista dos nomes do Financeiro; ligar o nome ao contato (sem o CPF/CNPJ
 *     não liga); o aviso de quem recebe sem o cadastro;
 *   - a NFS-e da pessoa registrada à mão: reconhecida pelo CPF/CNPJ, a soma de
 *     CMS + Royalty repartida (5.2 a), sem conta a pagar, pronta para pagar e
 *     a tarefa de pagar criada para quem fechou (5.3 b);
 *   - a nota que não bate: aviso, as opções, escolher; desfazer;
 *   - o pagamento confirmado no Financeiro: o vínculo antigo, o "sem NFS-e" do
 *     painel resolvido pelas partes e a tarefa de pagar concluída;
 *   - permissões e "falta o SQL da fase E" (a nota segue como na fase A).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const semNbsp = t => String(t).replace(/ /g, ' ');

const COLUNAS = {
  contabil_parametros: ['id', 'chave', 'valor'],
  pedidos: ['id', 'numero', 'situacao', 'cliente_id'], notas_fiscais: ['id'], notas_devolucao: ['id'],
  configuracao_fiscal: ['id', 'cnpj', 'uf', 'razao_social'], configuracao_cobranca: ['id'],
  financeiro_fechamentos: ['id', 'tipo', 'competencia', 'status', 'total', 'quantidade', 'pagar_ate', 'fechado_em', 'fechado_por', 'por_setor'],
  financeiro_fechamento_itens: ['id', 'fechamento_id'],
  financeiro_pagamentos: ['id', 'fechamento_id', 'tipo', 'competencia', 'valor', 'data_pagamento', 'forma', 'beneficiario', 'tipo_comissao'],
  usuarios: ['id', 'nome', 'perfil'], contatos: ['id', 'nome', 'cnpj', 'cpf'],
  competencia_contabil: ['id', 'competencia', 'status'], contabil_pendencias_resolucoes: ['id', 'competencia', 'chave'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id'], contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id'], contabil_pacotes: ['id', 'competencia'],
  documentos_recebidos: ['id', 'tipo', 'origem', 'numero', 'serie', 'municipio', 'emitente_nome', 'emitente_documento', 'contato_id', 'data_emissao', 'competencia', 'valor_total',
    'valor_iss', 'iss_retido', 'valor_retencoes', 'financeiro_pagamento_id', 'sem_pagamento', 'excluido_em', 'descricao', 'observacao', 'criado_por', 'criado_em'],
  titulos_pagar: ['id', 'contato_id', 'documento_recebido_id', 'descricao', 'competencia', 'valor_total', 'status'], titulo_pagar_parcelas: ['id', 'titulo_id'], titulo_pagar_pagamentos: ['id'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'agencia_dv', 'conta', 'ativa'],
  extrato_importacoes: ['id', 'conta_id', 'origem', 'status', 'periodo_inicio', 'periodo_fim'],
  movimentos_bancarios: ['id', 'conta_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'hash', 'estado_conciliacao'],
  conciliacao_vinculos: ['id', 'movimento_id', 'alvo_tipo', 'alvo_id', 'valor', 'criterio', 'desfeito_em'],
  contabil_integracoes: ['id', 'chave', 'ativa'], contabil_dfe_recebidos: ['id'],
  contabil_pessoas: ['id', 'nome', 'nome_chave', 'contato_id', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por'],
  contabil_notas_fechamento: ['id', 'documento_id', 'fechamento_id', 'tipo', 'competencia', 'beneficiario', 'tipo_comissao', 'valor', 'criterio', 'tarefa_id', 'criado_em', 'criado_por',
    'desfeito_em', 'desfeito_por', 'motivo_desfazer']
  // As tabelas das tarefas e do sino (tarefas, tarefa_automacoes, notificacoes…) guardam o corpo inteiro.
};
const LIMITES = {
  contabil_pessoas: { nome: 120, nome_chave: 120 }, contabil_notas_fechamento: { tipo: 12, competencia: 7, beneficiario: 120, tipo_comissao: 20, criterio: 20 }, contabil_eventos: { tipo: 40 }
};
const passaDoLimite = (tabela, linha) => Object.entries(LIMITES[tabela] || {}).find(([col, max]) => typeof linha[col] === 'string' && linha[col].length > max) || null;
const UNICOS = { contabil_pessoas: (n, l) => l.some(r => r.nome_chave === n.nome_chave) };
const SEM_FILTRO = new Set(['select', 'order', 'limit', 'offset']);

function criarUpstream(dados) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const [, tabela, id] = url.pathname.split('/').filter(Boolean);
      const body = corpo ? JSON.parse(corpo) : null;
      const responder = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || null;
      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Not found' });
      }
      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [k, v] of url.searchParams.entries()) if (colunas ? colunas.includes(k) : !SEM_FILTRO.has(k)) linhas = linhas.filter(r => String(r[k]) === String(v));
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const linha = colunas ? Object.fromEntries(colunas.filter(c => body?.[c] !== undefined).map(c => [c, body[c]])) : { ...body };
        if (passaDoLimite(tabela, linha)) return responder(500, { error: `value too long (${passaDoLimite(tabela, linha)[0]})` });
        if (UNICOS[tabela]?.(linha, tabelas[tabela])) return responder(500, { error: 'duplicate key value violates unique constraint' });
        linha.id = Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1;
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Not found' });
        for (const [k, v] of Object.entries(body || {})) if (!colunas || colunas.includes(k)) alvo[k] = v;
        return responder(200, alvo);
      }
      return responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas };
}

const MODULOS = [
  './apiHttpClient', './permissionsController', './contabilidadeController', './contabilidade/checklist', './contabilidade/base', './contabilidade/eventos',
  './contabilidade/titulos', './contabilidade/arquivos', './contabilidade/documentosRecebidos', './contabilidade/conciliacao/conciliacao', './contabilidade/conciliacao/liquidacoes',
  './contabilidade/pessoas/pessoas', './contabilidade/pacote/pacote', './fiscal/configuracaoFiscal', './tarefasServico'
];

const RESUMO_SET = [
  { tipo: 'cms', beneficiario: 'Márcia Lamounier', valor: 554.4 }, { tipo: 'royalty', beneficiario: 'Márcia Lamounier', valor: 300 },
  { tipo: 'royalty', beneficiario: 'Barral & Lamounier', valor: 277.2 }
];

function cenario(extra = {}) {
  return {
    contabil_parametros: [{ id: 1, chave: 'inicio_competencia', valor: '2026-08' }],
    pedidos: [], notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: '11444777000161', uf: 'MG', razao_social: 'SANTISSIMO DECOR LTDA' }], configuracao_cobranca: [],
    financeiro_fechamentos: [
      { id: 1, tipo: 'comissao', competencia: '2026-09', status: 'fechado', total: 1131.6, quantidade: 3, pagar_ate: '2026-10-15', fechado_em: '2026-10-01T12:00:00Z', fechado_por: 3, por_setor: JSON.stringify(RESUMO_SET) },
      { id: 2, tipo: 'comissao', competencia: '2026-08', status: 'fechado', total: 554.4, quantidade: 1, pagar_ate: '2026-09-15', fechado_em: '2026-09-01T12:00:00Z', fechado_por: 3,
        por_setor: JSON.stringify([{ tipo: 'cms', beneficiario: 'Márcia Lamounier', valor: 554.4 }]) }
    ],
    financeiro_fechamento_itens: [], financeiro_pagamentos: [],
    usuarios: [{ id: 3, nome: 'Henrique', perfil: 'Sup Admin' }],
    contatos: [
      { id: 7, nome: 'Márcia Lamounier', cpf: '529.982.247-25' }, { id: 8, nome: 'Barral & Lamounier Design', cnpj: '12.345.678/0001-95' }, { id: 10, nome: 'Contato sem documento' }
    ],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [], contabil_arquivos: [], contabil_arquivo_vinculos: [], contabil_pacotes: [],
    documentos_recebidos: [], titulos_pagar: [], titulo_pagar_parcelas: [], titulo_pagar_pagamentos: [],
    contas_financeiras: [{ id: 1, nome: 'BB', tipo: 'corrente', banco_codigo: '001', agencia: '1614', conta: '167738', ativa: true }],
    extrato_importacoes: [], movimentos_bancarios: [], conciliacao_vinculos: [], contabil_integracoes: [], contabil_dfe_recebidos: [],
    contabil_pessoas: [], contabil_notas_fechamento: [],
    tarefa_automacoes: [{ id: 6, chave: 'nota_de_fechamento', nome: 'Nota recebida → pagar', ativa: true, dias: 0, titulo: 'Pagar {beneficiario} — {fechamento} (nota recebida)', tipo: 'Tarefa', prioridade: 'alta' }],
    tarefa_automacao_usuarios: [], tarefas: [], tarefa_participantes: [], historico_comentarios: [], notificacoes: [],
    ...extra
  };
}

async function montar(dados, { permitir = true } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  require('./fiscal/configuracaoFiscal').limparCache?.();
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: chaveOuFn => (req, res, next) => {
        const chaves = typeof chaveOuFn === 'function' ? chaveOuFn(req) : chaveOuFn;
        const pedidas = Array.isArray(chaves) ? chaves : [chaves];
        const liberado = Array.isArray(permitir) ? pedidas.every(c => permitir.includes(c)) : permitir;
        return liberado ? next() : res.status(403).json({ error: 'Sem permissão', pedidas });
      },
      exigirAlgumaPermissao: () => (req, res, next) => next(),
      exigirSupAdmin: (req, res, next) => next(),
      ehSupAdmin: async () => true,
      podeAlguma: async () => true,
      limparCachePermissoes: () => {}
    }
  };
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api/contabilidade', require('./contabilidadeController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const porta = server.address().port;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(`http://127.0.0.1:${porta}/api/contabilidade${caminho}`, {
      method: metodo, headers: { authorization: `Bearer ${tokenDe(3)}`, 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined
    });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  };
  return {
    chamar, tabelas: upstream.tabelas,
    api: () => require('./apiHttpClient').createApiClient({ headers: { authorization: `Bearer ${tokenDe(3)}` } }),
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

const nfse = (numero, contatoId, valor, data = '2026-10-01') => ({ tipo: 'nfse', numero, municipio: 'Belo Horizonte', contato_id: contatoId, data_emissao: data, valor_total: valor });
const ativas = ctx => ctx.tabelas.contabil_notas_fechamento.filter(n => !n.desfeito_em);

test('quem recebe ligado ao contato; a NFS-e reconhecida pelo CPF/CNPJ reparte CMS + Royalty, não vira conta, fica pronta para pagar e cria a tarefa de pagar; a que não bate: escolher; desfazer', async () => {
  const ctx = await montar(cenario());
  try {
    // Os nomes do Financeiro, sem o cadastro: aviso no painel.
    const lista = await ctx.chamar('GET', '/pessoas');
    assert.equal(lista.status, 200, JSON.stringify(lista.corpo));
    assert.deepEqual(lista.corpo.pessoas.map(p => [p.nome, p.fontes, p.contato]), [['Barral & Lamounier', ['Royalty'], null], ['Márcia Lamounier', ['CMS', 'Royalty'], null]]);
    let painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    assert.deepEqual(painel.corpo.pendencias.filter(p => p.chave === 'pessoas_sem_cadastro').map(p => [p.nivel, p.fonte, p.titulo]), [['aviso', 'documentos_recebidos', '2 pessoas que recebem sem o CPF/CNPJ']]);

    // Ligar ao contato: sem o CPF/CNPJ, não.
    assert.equal((await ctx.chamar('PUT', '/pessoas', { nome: 'Márcia Lamounier', contato_id: 10 })).status, 422);
    assert.equal((await ctx.chamar('PUT', '/pessoas', { nome: 'Márcia Lamounier', contato_id: 7 })).status, 200);
    assert.equal((await ctx.chamar('PUT', '/pessoas', { nome: 'Barral & Lamounier', contato_id: 8 })).status, 200);
    assert.deepEqual(ctx.tabelas.contabil_pessoas.map(p => [p.nome_chave, p.contato_id]), [['marcia lamounier', 7], ['barral & lamounier', 8]]);
    painel = await ctx.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.corpo.pendencias.some(p => p.chave === 'pessoas_sem_cadastro'), false);

    // A NFS-e da Márcia: CMS + Royalty de setembro (854,40), repartida; sem conta a pagar.
    const r = await ctx.chamar('POST', '/documentos', { ...nfse('101', 7, 854.4), gerar_titulo: true });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual([r.corpo.titulo_id, r.corpo.ligado_a.tipo, r.corpo.ligado_a.rotulo], [null, 'fechamento', 'CMS + Royalty de setembro/2026 — Márcia Lamounier (pronta para pagar)']);
    assert.equal(ctx.tabelas.titulos_pagar.length, 0);
    assert.deepEqual(ativas(ctx).map(n => [n.documento_id, n.fechamento_id, n.tipo_comissao, Number(n.valor), n.criterio]), [[r.corpo.id, 1, 'cms', 554.4, 'automatico'], [r.corpo.id, 1, 'royalty', 300, 'automatico']]);
    // A tarefa de pagar, para quem fechou, no dia marcado.
    const [t] = ctx.tabelas.tarefas;
    assert.deepEqual([t.titulo, t.responsavel_id, t.data, t.chave_origem, t.origem], ['Pagar Márcia Lamounier — CMS + Royalty de setembro/2026 (nota recebida)', 3, '2026-10-15', 'nota_de_fechamento:1-marcia-lamounier', 'automacao']);
    assert.ok(ativas(ctx).every(n => n.tarefa_id === t.id));
    assert.ok(ctx.tabelas.contabil_eventos.some(e => e.tipo === 'nota_fechamento_ligada' && /pronta para pagar · tarefa de pagar criada/.test(e.descricao)));
    const marcia = (await ctx.chamar('GET', '/pessoas')).corpo.pessoas.find(p => p.chave === 'marcia lamounier');
    assert.deepEqual(marcia.partes.filter(x => x.competencia === '2026-09').map(x => [x.tipo_comissao, x.situacao]), [['cms', 'pronto_para_pagar'], ['royalty', 'pronto_para_pagar']]);
    painel = await ctx.chamar('GET', '/painel?competencia=2026-10');
    assert.equal(painel.corpo.pendencias.some(p => p.chave === 'docrec_sem_conta'), false, 'a nota do fechamento não pede conta a pagar');

    // A nota da Barral (300,00) não bate com a parte (277,20): aviso, as opções, escolher.
    const b = await ctx.chamar('POST', '/documentos', nfse('55', 8, 300));
    assert.equal(b.status, 200, JSON.stringify(b.corpo));
    assert.match(b.corpo.avisos.join(' '), /é de Barral & Lamounier \(recebe no Financeiro\), mas não bateu com uma parte só do fechamento/);
    assert.equal(b.corpo.titulo_id, null);
    painel = await ctx.chamar('GET', '/painel?competencia=2026-10');
    assert.ok(painel.corpo.pendencias.some(p => p.chave === `nota_pessoa_conferir_${b.corpo.id}` && p.nivel === 'aviso'));
    const op = await ctx.chamar('GET', `/pessoas/notas/${b.corpo.id}/opcoes`);
    assert.deepEqual(op.corpo.opcoes.map(o => [o.rotulo, o.valor, o.exato]), [['Royalty de setembro/2026 — Barral & Lamounier', 277.2, false]]);
    assert.equal((await ctx.chamar('POST', `/pessoas/notas/${b.corpo.id}/escolher`, { opcao: 'nao-existe' })).status, 422);
    const esc = await ctx.chamar('POST', `/pessoas/notas/${b.corpo.id}/escolher`, { opcao: op.corpo.opcoes[0].chave });
    assert.equal(esc.status, 200, JSON.stringify(esc.corpo));
    assert.equal(ativas(ctx).find(n => n.documento_id === b.corpo.id).criterio, 'escolhido');
    painel = await ctx.chamar('GET', '/painel?competencia=2026-10');
    assert.equal(painel.corpo.pendencias.some(p => p.chave.startsWith('nota_pessoa_conferir')), false);
    assert.equal(ctx.tabelas.tarefas.length, 2, 'uma tarefa por pessoa no fechamento');

    // Desfazer: a nota volta a ficar para escolher.
    assert.equal((await ctx.chamar('POST', `/pessoas/notas/${b.corpo.id}/desfazer`, { motivo: 'x' })).status, 400);
    assert.equal((await ctx.chamar('POST', `/pessoas/notas/${b.corpo.id}/desfazer`, { motivo: 'Era de outro mês' })).status, 200);
    painel = await ctx.chamar('GET', '/painel?competencia=2026-10');
    assert.ok(painel.corpo.pendencias.some(p => p.chave === `nota_pessoa_conferir_${b.corpo.id}`));
  } finally {
    await ctx.encerrar();
  }
});

test('o pagamento confirmado no Financeiro: o vínculo antigo, o "sem NFS-e" resolvido pelas partes e a tarefa de pagar concluída; a nota que chega depois do pagamento só documenta', async () => {
  const ctx = await montar(cenario({
    contabil_pessoas: [{ id: 1, nome: 'Márcia Lamounier', nome_chave: 'marcia lamounier', contato_id: 7 }, { id: 2, nome: 'Barral & Lamounier', nome_chave: 'barral & lamounier', contato_id: 8 }]
  }));
  try {
    const r = await ctx.chamar('POST', '/documentos', nfse('101', 7, 854.4));
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const tarefaId = ctx.tabelas.tarefas[0].id;
    // O Financeiro confirma o pagamento da Márcia (tudo dela) e chama o gancho.
    ctx.tabelas.financeiro_pagamentos.push({ id: 70, fechamento_id: 1, tipo: 'comissao', competencia: '2026-09', valor: 854.4, data_pagamento: '2026-10-02', forma: 'Pix', beneficiario: 'Márcia Lamounier', tipo_comissao: null });
    const feito = await require('./contabilidade/pessoas/pessoas').aposPagamento(ctx.api(), { fechamentoId: 1, usuarioId: 3 });
    assert.deepEqual(feito, { concluidas: 1 });
    assert.equal(ctx.tabelas.documentos_recebidos.find(d => d.id === r.corpo.id).financeiro_pagamento_id, 70);
    assert.equal(ctx.tabelas.tarefas.find(t => t.id === tarefaId).status, 'concluida');
    // A Barral foi paga antes da nota: a nota (277,20) só documenta — sem tarefa.
    ctx.tabelas.financeiro_pagamentos.push({ id: 71, fechamento_id: 1, tipo: 'comissao', competencia: '2026-09', valor: 277.2, data_pagamento: '2026-10-02', forma: 'Pix', beneficiario: 'Barral & Lamounier', tipo_comissao: 'royalty' });
    const b = await ctx.chamar('POST', '/documentos', nfse('55', 8, 277.2));
    assert.match(b.corpo.ligado_a.rotulo, /^Royalty de setembro\/2026 — Barral & Lamounier$/);
    assert.equal(ctx.tabelas.documentos_recebidos.find(d => d.id === b.corpo.id).financeiro_pagamento_id, 71);
    assert.equal(ctx.tabelas.tarefas.length, 1, 'já paga: nada de tarefa');
    // O painel de outubro: os dois pagamentos têm a NFS-e; o de agosto (sem nota), não.
    ctx.tabelas.financeiro_pagamentos.push({ id: 72, fechamento_id: 2, tipo: 'comissao', competencia: '2026-08', valor: 554.4, data_pagamento: '2026-10-02', forma: 'Pix', beneficiario: 'Márcia Lamounier', tipo_comissao: 'cms' });
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-10');
    assert.deepEqual(painel.corpo.pendencias.filter(p => p.chave.startsWith('nfse_fech_')).map(p => p.chave), ['nfse_fech_72']);
  } finally {
    await ctx.encerrar();
  }
});

test('permissões e "falta o SQL da fase E": a nota segue como antes', async () => {
  const leitura = await montar(cenario(), { permitir: ['contabilidade.view'] });
  try {
    assert.equal((await leitura.chamar('GET', '/pessoas')).status, 200);
    assert.deepEqual((await leitura.chamar('PUT', '/pessoas', { nome: 'X', contato_id: 7 })).corpo.pedidas, ['contabilidade.documento.registrar']);
    for (const rota of ['/pessoas/conferir', '/pessoas/notas/1/escolher', '/pessoas/notas/1/desfazer']) {
      assert.deepEqual((await leitura.chamar('POST', rota, {})).corpo.pedidas, ['contabilidade.documento.registrar'], rota);
    }
  } finally {
    await leitura.encerrar();
  }
  const dados = cenario();
  delete dados.contabil_pessoas;
  delete dados.contabil_notas_fechamento;
  const sem = await montar(dados);
  try {
    const lista = await sem.chamar('GET', '/pessoas');
    assert.deepEqual([lista.corpo.sql_pendente, lista.corpo.sql_arquivo], [true, 'sql/contabilidade_fase_e.sql']);
    assert.deepEqual([(await sem.chamar('PUT', '/pessoas', { nome: 'Márcia', contato_id: 7 })).status], [409]);
    const r = await sem.chamar('POST', '/documentos', nfse('101', 7, 854.4));
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(semNbsp(JSON.stringify(r.corpo.avisos)).includes('recebe no Financeiro'), false);
    const painel = await sem.chamar('GET', '/painel?competencia=2026-09');
    assert.equal(painel.status, 200);
    assert.equal(painel.corpo.pendencias.some(p => p.chave === 'pessoas_sem_cadastro'), false, 'sem o SQL, nada cobrado');
  } finally {
    await sem.encerrar();
  }
});
