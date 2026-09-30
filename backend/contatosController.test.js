/**
 * Contatos = fornecedores, prestadores e parceiros (backend/contatosController.js),
 * com a API genérica e a guarda de permissão de mentira.
 *
 * O que fica preso aqui (decisões do dono, 28/09/2026):
 *   - a lista traz o NOME do tipo e o CNPJ/CPF formatado;
 *   - o tipo é uma lista editável (+ e −): não se exclui tipo em uso;
 *   - cadastrar exige nome, tipo e CNPJ/CPF válido; documento repetido é 409;
 *   - as pessoas de contato vão junto (criar, alterar, excluir) e tudo cai na
 *     linha do tempo (contato_historico) com quem fez;
 *   - a planilha vai e volta pelas mesmas colunas;
 *   - sem o SQL, 409 com `sql_pendente`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const COLUNAS = {
  contato_tipos: ['id', 'nome', 'criado_por', 'criado_em'],
  contatos: ['id', 'nome', 'razao_social', 'tipo_id', 'tipo_pessoa', 'cnpj', 'cpf', 'inscricao_estadual', 'inscricao_municipal', 'email', 'telefone_celular', 'telefone_fixo', 'site',
    'end_logradouro', 'end_numero', 'end_complemento', 'end_bairro', 'end_cidade', 'end_uf', 'end_pais', 'end_cep', 'end_codigo_municipio', 'status', 'anotacoes', 'criado_por', 'criado_em', 'atualizado_em'],
  contato_pessoas: ['id', 'contato_id', 'nome', 'cargo', 'email', 'telefone_celular', 'telefone_fixo', 'criado_em'],
  contato_interacoes: ['id', 'contato_id', 'tipo', 'resumo', 'detalhe', 'pessoa_id', 'duracao_min', 'data', 'usuario_id', 'tarefa_id', 'criado_em'],
  contato_historico: ['id', 'contato_id', 'tipo', 'acao', 'entidade', 'campo', 'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em'],
  usuarios: ['id', 'nome']
};

function criarUpstream(dados) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const chamadas = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const [, tabela, id] = url.pathname.split('/').filter(Boolean);
      const body = corpo ? JSON.parse(corpo) : null;
      chamadas.push({ metodo: req.method, tabela, id, body });
      const responder = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      // Como a API remota: tabela que não existe responde 404 "Tabela 'x' não encontrada."
      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || [];
      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Not found' });
      }
      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (colunas.includes(chave)) linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const linha = {};
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        linha.id = Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1;
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Not found' });
        for (const c of colunas) if (body?.[c] !== undefined) alvo[c] = body[c];
        return responder(200, alvo);
      }
      if (req.method === 'DELETE') {
        const idx = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (idx === -1) return responder(404, { error: 'Not found' });
        tabelas[tabela].splice(idx, 1);
        return responder(200, { sucesso: true });
      }
      return responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas, chamadas };
}

const MODULOS = ['./apiHttpClient', './permissionsController', './contatosController', './historicoSocial', './contatoHistorico', './importacaoCsv'];

async function montar(dados, { permitir = true, contabilidade = false } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: chave => (req, res, next) => {
        const chaves = typeof chave === 'function' ? chave(req) : chave;
        const pedidas = Array.isArray(chaves) ? chaves : [chaves];
        const liberado = Array.isArray(permitir) ? pedidas.every(c => permitir.includes(c)) : permitir;
        return liberado ? next() : res.status(403).json({ error: 'Sem permissão', pedidas });
      },
      exigirAlgumaPermissao: () => (req, res, next) => next(),
      exigirSupAdmin: (req, res, next) => next(),
      limparCachePermissoes: () => {},
      // O "'" do contato só traz documentos e contas para quem vê a Contabilidade.
      obterPermissoesEfetivas: async () => ({ contabilidade: { ativo: contabilidade, acoes: { 'contabilidade.view': contabilidade } } })
    }
  };
  const app = express();
  app.use(express.json());
  app.use('/api/contatos', require('./contatosController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const porta = server.address().port;
  const chamar = (metodo, caminho, corpo) => fetch(`http://127.0.0.1:${porta}/api/contatos${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${tokenDe(3)}`, 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  return {
    chamar, tabelas: upstream.tabelas, chamadas: upstream.chamadas,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

const CNPJ_VALIDO = '11222333000181';
const CNPJ_VALIDO_2 = '57248237000103';
const CPF_VALIDO = '12345678909';

function cenario(extra = {}) {
  return {
    contato_tipos: [{ id: 1, nome: 'Fornecedor' }, { id: 2, nome: 'Prestador de serviço' }, { id: 3, nome: 'Outro' }],
    contatos: [{
      id: 10, nome: 'Madeiras Silva', razao_social: 'Madeiras Silva LTDA', tipo_id: 1, tipo_pessoa: 'PJ', cnpj: CNPJ_VALIDO, cpf: null,
      email: 'vendas@silva.com', telefone_celular: '(31) 99999-0000', telefone_fixo: '(31) 3333-0000', end_cidade: 'Contagem', end_uf: 'Minas Gerais', status: 'Ativo', criado_por: 3
    }],
    contato_pessoas: [{ id: 5, contato_id: 10, nome: 'Carlos', cargo: 'Vendedor', email: 'c@silva.com', telefone_celular: '9999', telefone_fixo: null }],
    contato_interacoes: [],
    contato_historico: [],
    usuarios: [{ id: 3, nome: 'Henrique' }],
    ...extra
  };
}

test('lista: o nome do tipo, o CNPJ formatado e a ordem alfabética; tipos em ordem', async () => {
  const ctx = await montar(cenario({ contatos: [...cenario().contatos, { id: 11, nome: 'Ana Pintura', tipo_id: 2, tipo_pessoa: 'PF', cpf: CPF_VALIDO, status: 'Ativo' }] }));
  try {
    const r = await ctx.chamar('GET', '/lista');
    assert.equal(r.status, 200);
    const lista = await r.json();
    assert.deepEqual(lista.map(c => [c.nome, c.tipo, c.documento, c.tipo_pessoa]), [
      ['Ana Pintura', 'Prestador de serviço', '123.456.789-09', 'PF'],
      ['Madeiras Silva', 'Fornecedor', '11.222.333/0001-81', 'PJ']
    ]);
    const tipos = await (await ctx.chamar('GET', '/tipos')).json();
    assert.deepEqual(tipos.tipos.map(t => t.nome), ['Fornecedor', 'Outro', 'Prestador de serviço']);
  } finally {
    await ctx.encerrar();
  }
});

test('tipos (+ e −): inclui sem repetir (com ou sem acento) e não exclui tipo em uso', async () => {
  const ctx = await montar(cenario());
  try {
    const criado = await ctx.chamar('POST', '/tipos', { nome: ' Contabilidade ' });
    assert.equal(criado.status, 200);
    assert.equal((await criado.json()).tipo.nome, 'Contabilidade');
    const repetido = await ctx.chamar('POST', '/tipos', { nome: 'fornecedor' });
    assert.equal(repetido.status, 409);
    assert.equal((await repetido.json()).tipo.id, 1);
    const emUso = await ctx.chamar('DELETE', '/tipos/1');
    assert.equal(emUso.status, 409);
    assert.match((await emUso.json()).error, /Fornecedor é o tipo de 1 contato/);
    const livre = await ctx.chamar('DELETE', '/tipos/3');
    assert.equal(livre.status, 200);
    assert.deepEqual((await livre.json()).tipos.map(t => t.nome), ['Contabilidade', 'Fornecedor', 'Prestador de serviço']);
  } finally {
    await ctx.encerrar();
  }
});

test('cadastrar: exige nome, tipo e documento válido; grava as pessoas, quem cadastrou e a linha do tempo; CNPJ repetido é 409', async () => {
  const ctx = await montar(cenario());
  try {
    const semTipo = await ctx.chamar('POST', '/', { nome: 'Vidros Norte', cnpj: CNPJ_VALIDO_2 });
    assert.equal(semTipo.status, 400);
    assert.match((await semTipo.json()).error, /Escolha o tipo/);
    const cnpjRuim = await ctx.chamar('POST', '/', { nome: 'Vidros Norte', tipo_id: 1, cnpj: '11.222.333/0001-82' });
    assert.equal(cnpjRuim.status, 400);
    assert.match((await cnpjRuim.json()).error, /CNPJ inválido/);
    const repetido = await ctx.chamar('POST', '/', { nome: 'Outra Silva', tipo_id: 1, cnpj: '11.222.333/0001-81' });
    assert.equal(repetido.status, 409);
    assert.match((await repetido.json()).error, /Já existe o contato "Madeiras Silva"/);

    const ok = await ctx.chamar('POST', '/', {
      nome: 'Vidros Norte', razao_social: 'Vidros Norte ME', tipo: 'Fornecedor', tipo_pessoa: 'PJ', cnpj: '57.248.237/0001-03', email: 'x@vidros.com',
      status: 'ativo', endereco: { rua: 'Rua A', numero: '10', cidade: 'Contagem', estado: 'Minas Gerais', pais: 'Brasil', cep: '32000-000', codigo_municipio: '3118601' },
      pessoas: [{ nome: 'Paulo', cargo: 'Dono', email: 'p@vidros.com' }]
    });
    assert.equal(ok.status, 200);
    const { id } = await ok.json();
    const gravado = ctx.tabelas.contatos.find(c => c.id === id);
    assert.equal(gravado.tipo_id, 1, 'o tipo pelo NOME resolve o id');
    assert.equal(gravado.cnpj, CNPJ_VALIDO_2, 'só dígitos');
    assert.equal(gravado.status, 'Ativo');
    assert.equal(gravado.end_codigo_municipio, '3118601');
    assert.equal(gravado.criado_por, 3);
    assert.deepEqual(ctx.tabelas.contato_pessoas.filter(p => p.contato_id === id).map(p => p.nome), ['Paulo']);
    const eventos = ctx.tabelas.contato_historico.filter(e => e.contato_id === id);
    assert.deepEqual(eventos.map(e => [e.tipo, e.acao, e.usuario_id]), [['criacao', 'criou', 3], ['pessoa', 'criou', 3]]);
    assert.ok(eventos[0].detalhe.campos.some(c => c.rotulo === 'Tipo' && c.valor === 'Fornecedor'));
  } finally {
    await ctx.encerrar();
  }
});

test('ficha, editar e excluir: o PUT altera só o que veio, mexe nas pessoas e a linha do tempo diz o antes e o depois', async () => {
  const ctx = await montar(cenario());
  try {
    const ficha = await (await ctx.chamar('GET', '/10')).json();
    assert.equal(ficha.contato.tipo, 'Fornecedor');
    assert.equal(ficha.contato.documento, '11.222.333/0001-81');
    assert.equal(ficha.contato.endereco.cidade, 'Contagem');
    assert.deepEqual(ficha.pessoas.map(p => p.nome), ['Carlos']);
    assert.equal(ficha.tipos.length, 3);

    const r = await ctx.chamar('PUT', '/10', {
      nome: 'Madeiras Silva', tipo_id: 2, status: 'Inativo',
      pessoasNovas: [{ nome: 'Ana', cargo: 'Financeiro' }],
      pessoasAtualizadas: [{ id: 5, nome: 'Carlos', cargo: 'Gerente', email: 'c@silva.com', telefone_celular: '9999', telefone_fixo: '' }],
      pessoasExcluidas: [999]
    });
    assert.equal(r.status, 200);
    const c = ctx.tabelas.contatos[0];
    assert.equal(c.tipo_id, 2);
    assert.equal(c.status, 'Inativo');
    assert.equal(c.cnpj, CNPJ_VALIDO, 'campo que não veio não é apagado');
    assert.equal(c.email, 'vendas@silva.com');
    assert.deepEqual(ctx.tabelas.contato_pessoas.map(p => [p.nome, p.cargo]), [['Carlos', 'Gerente'], ['Ana', 'Financeiro']]);
    const eventos = ctx.tabelas.contato_historico;
    assert.deepEqual(eventos.map(e => [e.tipo, e.acao, e.campo ?? e.entidade]), [
      ['campo', 'alterou', 'tipo'], ['campo', 'alterou', 'status'], ['pessoa', 'criou', 'Ana — Financeiro'], ['pessoa', 'alterou', 'cargo']
    ]);
    assert.deepEqual([eventos[0].valor_anterior, eventos[0].valor_novo], ['Fornecedor', 'Prestador de serviço']);

    const dup = await ctx.chamar('POST', '/', { nome: 'Cópia', tipo_id: 1, cnpj: CNPJ_VALIDO_2 });
    assert.equal(dup.status, 200);
    const colisao = await ctx.chamar('PUT', '/10', { cnpj: CNPJ_VALIDO_2 });
    assert.equal(colisao.status, 409, 'editar para um CNPJ de outro contato é recusado');

    const apagado = await ctx.chamar('DELETE', '/10');
    assert.equal(apagado.status, 200);
    assert.equal(ctx.tabelas.contatos.some(x => x.id === 10), false);
    assert.equal((await ctx.chamar('GET', '/10')).status, 404);
  } finally {
    await ctx.encerrar();
  }
});

test('atividades: registra com a pessoa do contato, edita, exclui e tudo vai para a linha do tempo', async () => {
  const ctx = await montar(cenario());
  try {
    const errada = await ctx.chamar('POST', '/10/interacoes', { tipo: 'Ligação', resumo: 'x', pessoa_id: 999 });
    assert.equal(errada.status, 400);
    const r = await ctx.chamar('POST', '/10/interacoes', { tipo: 'Ligação', resumo: 'Pedi orçamento do MDF', pessoa_id: 5, duracao_min: 10, data: '2026-09-25T13:00:00.000Z' });
    assert.equal(r.status, 201);
    const { id } = await r.json();
    const lista = await (await ctx.chamar('GET', '/10/interacoes')).json();
    assert.deepEqual(lista.atividades.map(a => [a.resumo, a.pessoa, a.usuario]), [['Pedi orçamento do MDF', 'Carlos', 'Henrique']]);
    assert.equal((await ctx.chamar('PUT', `/10/interacoes/${id}`, { resumo: 'Pedi orçamento do MDF 15mm' })).status, 200);
    assert.equal((await ctx.chamar('DELETE', `/10/interacoes/${id}`)).status, 200);
    assert.deepEqual(ctx.tabelas.contato_historico.map(e => [e.tipo, e.acao]), [['interacao', 'criou'], ['interacao', 'alterou'], ['interacao', 'excluiu']]);
  } finally {
    await ctx.encerrar();
  }
});

test("citáveis do contato (o ' da linha do tempo): pessoas e atividades dele; documentos e contas só para quem vê a Contabilidade", async () => {
  const extra = {
    contato_interacoes: [
      { id: 20, contato_id: 10, tipo: 'Ligação', resumo: 'Pedi orçamento do MDF', data: '2026-09-25T13:00:00.000Z' },
      { id: 21, contato_id: 99, tipo: 'Visita', resumo: 'De outro contato', data: '2026-09-26T13:00:00.000Z' }
    ],
    documentos_recebidos: [
      { id: 7, tipo: 'nfe', serie: '1', numero: '123', emitente_nome: 'Madeiras Silva', contato_id: 10, data_emissao: '2026-08-10', valor_total: 1500 },
      { id: 8, tipo: 'nfe', serie: '1', numero: '9', emitente_nome: 'Outro', contato_id: 99, data_emissao: '2026-08-11', valor_total: 10 }
    ],
    titulos_pagar: [{ id: 12, descricao: 'Compra de MDF', contato_id: 10, valor_total: 1500, status: 'aberto', competencia: '2026-08' }],
    contabil_arquivos: [], contabil_arquivo_vinculos: []
  };
  const semCtb = await montar(cenario(extra));
  try {
    const todos = await (await semCtb.chamar('GET', '/10/citaveis?busca=')).json();
    assert.deepEqual(todos.itens.map(i => `${i.tipo}:${i.id}`), ['pessoa:5', 'interacao:20']);
    assert.equal(todos.itens[0].rotulo, 'Pessoa: Carlos (Vendedor)');
    assert.equal(todos.itens[1].rotulo, 'Atividade: Ligação · Pedi orçamento do MDF');
    const busca = await (await semCtb.chamar('GET', '/10/citaveis?busca=orcamento')).json();
    assert.deepEqual(busca.itens.map(i => `${i.tipo}:${i.id}`), ['interacao:20'], 'busca sem acento');
  } finally {
    await semCtb.encerrar();
  }
  const comCtb = await montar(cenario(extra), { contabilidade: true });
  try {
    const todos = await (await comCtb.chamar('GET', '/10/citaveis?busca=')).json();
    assert.deepEqual(todos.itens.map(i => `${i.tipo}:${i.id}`), ['pessoa:5', 'interacao:20', 'documento:7', 'titulo:12'], 'só os do contato 10');
    const mdf = await (await comCtb.chamar('GET', '/10/citaveis?busca=mdf')).json();
    assert.deepEqual(mdf.itens.map(i => `${i.tipo}:${i.id}`), ['interacao:20', 'titulo:12']);
  } finally {
    await comCtb.encerrar();
  }
});

test('planilha: o modelo volta pela importação; a exportação leva o tipo e a primeira pessoa; tipo fora da lista não entra', async () => {
  const ctx = await montar(cenario());
  try {
    const modelo = await (await ctx.chamar('GET', '/csv/modelo')).json();
    assert.equal(modelo.nome, 'modelo-contatos');
    const exportado = await (await ctx.chamar('POST', '/csv/exportar', { ids: [10] })).json();
    assert.equal(exportado.total, 1);
    assert.match(exportado.conteudo, /Madeiras Silva;Madeiras Silva LTDA;Fornecedor;PJ;11\.222\.333\/0001-81/);
    assert.match(exportado.conteudo, /Carlos;Vendedor;c@silva\.com/);

    const cabecalho = modelo.conteudo.split(/\r?\n/)[0];
    const linhaBoa = 'Vidros Norte;Vidros Norte ME;Fornecedor;PJ;57.248.237/0001-03;;;;x@vidros.com;;;;Ativo;32000-000;Rua A;10;;Centro;Contagem;MG;Brasil;3118601;Paulo;Dono;p@vidros.com;;;';
    const linhaRuim = 'Sem Tipo;;Transportadora;PJ;;;;;;;;;;;;;;;;;;;;;;;;;';
    const importado = await (await ctx.chamar('POST', '/csv/importar', { conteudo: [cabecalho, linhaBoa, linhaRuim].join('\n'), nome_arquivo: 'f.csv' })).json();
    assert.equal(importado.resumo.registrados + importado.resumo.com_pendencias, 1);
    assert.equal(importado.resumo.nao_registrados, 1);
    assert.match(importado.linhas[1].bloqueios[0], /Tipo "Transportadora" não está na lista/);
    const novo = ctx.tabelas.contatos.find(c => c.nome === 'Vidros Norte');
    assert.equal(novo.cnpj, CNPJ_VALIDO_2);
    assert.equal(novo.tipo_id, 1);
    assert.deepEqual(ctx.tabelas.contato_pessoas.filter(p => p.contato_id === novo.id).map(p => p.nome), ['Paulo']);
    assert.match(ctx.tabelas.contato_historico.find(e => e.contato_id === novo.id).observacao, /Importado da planilha f\.csv \(linha 2\)/);
  } finally {
    await ctx.encerrar();
  }
});

test('sem permissão: 403 com a chave certa; sem o SQL: 409 com sql_pendente', async () => {
  const semPerm = await montar(cenario(), { permitir: ['ctt.view'] });
  try {
    assert.equal((await semPerm.chamar('GET', '/lista')).status, 200);
    const criar = await semPerm.chamar('POST', '/', { nome: 'X', tipo_id: 1, cnpj: CNPJ_VALIDO_2 });
    assert.equal(criar.status, 403);
    assert.deepEqual((await criar.json()).pedidas, ['ctt.create']);
    const comPessoa = await semPerm.chamar('POST', '/', { nome: 'X', tipo_id: 1, cnpj: CNPJ_VALIDO_2, pessoas: [{ nome: 'A' }] });
    assert.deepEqual((await comPessoa.json()).pedidas, ['ctt.create', 'ctt.person.add']);
    assert.equal((await semPerm.chamar('POST', '/tipos', { nome: 'Novo' })).status, 403);
    assert.equal((await semPerm.chamar('GET', '/10')).status, 403);
  } finally {
    await semPerm.encerrar();
  }
  const semSql = await montar({ usuarios: [] });
  try {
    const r = await semSql.chamar('GET', '/lista');
    assert.equal(r.status, 409);
    const corpo = await r.json();
    assert.equal(corpo.sql_pendente, true);
    assert.match(corpo.error, /sql\/contatos_fornecedores\.sql/);
  } finally {
    await semSql.encerrar();
  }
});
