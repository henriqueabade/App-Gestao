/**
 * Ações Rápidas de planilha — Clientes e Prospecções.
 *
 * O que o dono pediu: exportar, importar e salvar o modelo em CSV; na
 * importação, uma linha com dado obrigatório faltando NÃO interrompe as
 * outras, e o relatório final diz, linha a linha, o que deu errado, por quê e
 * se a linha ficou pendente de registro ou foi registrada com dados faltantes.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const csv = require('./importacaoCsv');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

// ---------------------------------------------------------------------------
// Leitura e escrita do CSV
// ---------------------------------------------------------------------------

test('lerCsv: BOM, aspas, quebra de linha dentro de aspas e número da linha do Excel', () => {
  const texto = '\uFEFFNome;Obs\r\n"ACME; filial";"disse ""oi""\r\nduas linhas"\r\n\r\nBeta;x\r\n';
  const { separador, linhas } = csv.lerCsv(texto);
  assert.strictEqual(separador, ';');
  assert.deepStrictEqual(linhas.map(l => l.numero), [1, 2, 5], 'a linha vazia some; a numeração segue o arquivo');
  assert.deepStrictEqual(linhas[1].valores, ['ACME; filial', 'disse "oi"\nduas linhas']);
  assert.deepStrictEqual(linhas[2].valores, ['Beta', 'x']);
});

test('lerCsv detecta vírgula como separador', () => {
  const { separador, linhas } = csv.lerCsv('Empresa,CNPJ\nACME,123\n');
  assert.strictEqual(separador, ',');
  assert.deepStrictEqual(linhas[1].valores, ['ACME', '123']);
});

test('o modelo volta pela importação: cabeçalho reconhecido e a linha de exemplo ignorada', () => {
  for (const [modelo, colunas] of [[csv.modeloDeClientes(), csv.COLUNAS_CLIENTE], [csv.modeloDeProspeccoes(), csv.COLUNAS_PROSPECCAO]]) {
    assert.ok(modelo.startsWith(csv.BOM));
    assert.ok(modelo.includes('\r\n'));
    const { linhas } = csv.lerCsv(modelo);
    const mapa = csv.mapearCabecalho(linhas[0].valores, colunas);
    assert.deepStrictEqual(mapa.desconhecidas, []);
    assert.deepStrictEqual(mapa.ausentes, []);
    assert.ok(csv.ehLinhaDeExemplo(csv.registroDaLinha(linhas[1].valores, mapa.indice)));
  }
});

test('mapearCabecalho aceita título sem acento, sem "*" e a própria chave', () => {
  const mapa = csv.mapearCabecalho(['RAZAO SOCIAL', 'nome fantasia *', 'cnpj', 'Coluna estranha'], csv.COLUNAS_CLIENTE);
  assert.strictEqual(mapa.indice.razao_social, 0);
  assert.strictEqual(mapa.indice.nome_fantasia, 1);
  assert.strictEqual(mapa.indice.cnpj, 2);
  assert.deepStrictEqual(mapa.desconhecidas, ['Coluna estranha']);
});

test('valores: Sim/Não, número brasileiro, datas', () => {
  assert.strictEqual(csv.lerSimNao('Sim'), true);
  assert.strictEqual(csv.lerSimNao('não'), false);
  assert.strictEqual(csv.lerSimNao(''), false);
  assert.strictEqual(csv.lerSimNao('talvez'), null);
  assert.strictEqual(csv.lerNumero('1.234,56'), 1234.56);
  assert.strictEqual(csv.lerNumero('R$ 15.000'), 15000);
  assert.strictEqual(csv.lerNumero('1234.5'), 1234.5);
  assert.strictEqual(csv.lerNumero(''), null);
  assert.ok(Number.isNaN(csv.lerNumero('abc')));
  assert.strictEqual(csv.lerData('30/09/2026'), '2026-09-30');
  assert.strictEqual(csv.lerData('2026-09-30'), '2026-09-30');
  assert.strictEqual(csv.lerData('31/02/2026'), undefined);
  assert.strictEqual(csv.lerData(''), null);
  assert.strictEqual(csv.dataBr('2026-09-30'), '30/09/2026');
});

test('CNPJ e CPF: dígitos verificadores', () => {
  assert.ok(csv.cnpjValido('11.222.333/0001-81'));
  assert.ok(!csv.cnpjValido('11.222.333/0001-82'));
  assert.ok(!csv.cnpjValido('11111111111111'));
  assert.ok(csv.cpfValido('529.982.247-25'));
  assert.ok(!csv.cpfValido('529.982.247-24'));
});

test('conferirCliente: o que bloqueia e o que só fica pendente', () => {
  const completo = {
    tipo_pessoa: 'PJ', razao_social: 'Casa Azul LTDA', nome_fantasia: 'Casa Azul', cnpj: '11.222.333/0001-81',
    inscricao_estadual: '123', status_cliente: 'ativo', dono_cliente: 'ana',
    reg_rua: 'Rua A', reg_numero: '1', reg_bairro: 'Centro', reg_cidade: 'BH', reg_estado: 'mg', reg_pais: 'Brasil', reg_cep: '30000-000',
    cob_igual: 'Sim', ent_igual: 'Sim', contato_nome: 'Maria', contato_email: 'maria@x.com'
  };
  const ok = csv.conferirCliente(completo, { donos: ['Ana'] });
  assert.deepStrictEqual(ok.bloqueios, []);
  assert.deepStrictEqual(ok.pendencias, []);
  assert.strictEqual(csv.situacaoDaLinha(ok), 'registrado');
  assert.strictEqual(ok.payload.status_cliente, 'Ativo');
  assert.strictEqual(ok.payload.dono_cliente, 'Ana', 'o nome volta como está no cadastro de usuários');
  assert.strictEqual(ok.payload.endereco_registro.estado, 'MG');
  assert.deepStrictEqual(ok.payload.endereco_entrega, ok.payload.endereco_registro);

  const pendente = csv.conferirCliente({ razao_social: 'X LTDA', nome_fantasia: 'X', cnpj: '11222333000181' });
  assert.deepStrictEqual(pendente.bloqueios, []);
  assert.strictEqual(csv.situacaoDaLinha(pendente), 'registrado_com_pendencias');
  assert.ok(pendente.pendencias.includes('Dono não informado.'));
  assert.ok(pendente.pendencias.includes('Sem contato.'));
  assert.ok(pendente.pendencias.some(p => p.startsWith('Endereço de registro incompleto')));

  const barrado = csv.conferirCliente({ nome_fantasia: 'Sem Razão', cnpj: '11.222.333/0001-82' });
  assert.strictEqual(csv.situacaoDaLinha(barrado), 'nao_registrado');
  assert.ok(barrado.bloqueios.includes('Razão social é obrigatória.'));
  assert.ok(barrado.bloqueios.some(b => /CNPJ .* é inválido/.test(b)));

  const repetido = csv.conferirCliente({ razao_social: 'Y', nome_fantasia: 'Y', cnpj: '11.222.333/0001-81' }, { documentosDoArquivo: new Map([['11222333000181', 3]]) });
  assert.ok(repetido.bloqueios.includes('CNPJ repetido: já aparece na linha 3.'));

  const pf = csv.conferirCliente({ razao_social: 'João', nome_fantasia: 'João', cpf: '529.982.247-25' });
  assert.deepStrictEqual(pf.bloqueios, []);
  assert.strictEqual(pf.payload.tipo_pessoa, 'PF');
  assert.strictEqual(pf.payload.cpf, '52998224725');
});

test('conferirProspeccao: só o nome e o CNPJ duplicado bloqueiam', () => {
  const r = csv.conferirProspeccao({
    nome_fantasia: 'ACME', cnpj: '11.222.333/0001-82', etapa: 'Fechando', probabilidade: '150', valor_estimado: 'muito',
    responsavel: 'fulano', proximo_passo_data: '31/02/2026', end_estado: 'Minas', contato_nome: 'Zé', contato_decisor: 'talvez'
  }, { usuarios: [{ id: 2, nome: 'Ana', email: 'ana@x.com' }] });
  assert.deepStrictEqual(r.bloqueios, []);
  assert.strictEqual(csv.situacaoDaLinha(r), 'registrado_com_pendencias');
  assert.strictEqual(r.payload.cnpj, null, 'CNPJ inválido não é gravado');
  assert.strictEqual(r.payload.etapa, 'Novo');
  assert.strictEqual(r.payload.probabilidade, 10);
  assert.strictEqual(r.payload.valor_estimado, 0);
  assert.strictEqual(r.payload.responsavel_id, null);
  assert.strictEqual(r.payload.proximo_passo_data, null);
  assert.strictEqual(r.payload.endereco.estado, '');
  assert.strictEqual(r.pendencias.length, 9);

  const responsavelPorEmail = csv.conferirProspeccao({ nome_fantasia: 'B', responsavel: 'ANA@X.COM' }, { usuarios: [{ id: 2, nome: 'Ana', email: 'ana@x.com' }] });
  assert.strictEqual(responsavelPorEmail.payload.responsavel_id, 2);

  assert.ok(csv.conferirProspeccao({ cnpj: '11.222.333/0001-81' }).bloqueios.includes('O nome da empresa é obrigatório.'));
  assert.ok(csv.conferirProspeccao({ nome_fantasia: 'C', cnpj: '11.222.333/0001-81' }, { cnpjsAtivos: new Set(['11222333000181']) })
    .bloqueios.includes('Já existe uma prospecção ativa com este CNPJ.'));
});

test('emParalelo respeita o limite e passa por todos', async () => {
  let aoMesmoTempo = 0;
  let pico = 0;
  const feitos = [];
  await csv.emParalelo([1, 2, 3, 4, 5, 6, 7], 3, async n => {
    aoMesmoTempo++;
    pico = Math.max(pico, aoMesmoTempo);
    await new Promise(r => setTimeout(r, 5));
    feitos.push(n);
    aoMesmoTempo--;
  });
  assert.strictEqual(pico, 3);
  assert.deepStrictEqual(feitos.sort(), [1, 2, 3, 4, 5, 6, 7]);
});

// ---------------------------------------------------------------------------
// Rotas: modelo, exportação e importação (com o duplo da API)
// ---------------------------------------------------------------------------

const COLUNAS = {
  usuarios: ['id', 'nome', 'email', 'perfil', 'modelo_permissoes_id'],
  modelos_permissoes: ['id', 'nome'],
  clientes: [
    'id', 'tipo_pessoa', 'razao_social', 'nome_fantasia', 'cnpj', 'cpf', 'inscricao_estadual', 'indicador_ie', 'email_nfe',
    'consumidor_final', 'site', 'status_cliente', 'dono_cliente', 'origem_captacao', 'anotacoes', 'criado_por',
    'reg_pais', 'reg_logradouro', 'reg_numero', 'reg_complemento', 'reg_bairro', 'reg_cidade', 'reg_uf', 'reg_cep', 'reg_codigo_municipio',
    'cob_pais', 'cob_logradouro', 'cob_numero', 'cob_complemento', 'cob_bairro', 'cob_cidade', 'cob_uf', 'cob_cep',
    'ent_pais', 'ent_logradouro', 'ent_numero', 'ent_complemento', 'ent_bairro', 'ent_cidade', 'ent_uf', 'ent_cep', 'ent_codigo_municipio'
  ],
  contatos_cliente: ['id', 'id_cliente', 'nome', 'cargo', 'email', 'telefone_fixo', 'telefone_celular'],
  cliente_historico: ['id', 'cliente_id', 'tipo', 'acao', 'entidade', 'campo', 'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em'],
  prospeccoes: [
    'id', 'nome_fantasia', 'razao_social', 'cnpj', 'inscricao_estadual', 'site', 'segmento', 'origem', 'etapa', 'valor_estimado',
    'probabilidade', 'responsavel_id', 'proximo_passo', 'proximo_passo_data', 'end_logradouro', 'end_numero', 'end_complemento',
    'end_bairro', 'end_cidade', 'end_uf', 'end_pais', 'end_cep', 'status', 'anotacoes', 'criado_por', 'criado_em', 'atualizado_em'
  ],
  prospeccao_contatos: ['id', 'prospeccao_id', 'nome', 'cargo', 'email', 'telefone_fixo', 'telefone_celular', 'decisor', 'principal', 'observacao'],
  prospeccao_historico: ['id', 'prospeccao_id', 'tipo', 'acao', 'entidade', 'campo', 'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em'],
  perm_cli: ['id', 'modelo_id', 'modulo_ativo', 'acao_view', 'acao_create', 'acao_export_csv', 'acao_import_csv'],
  perm_pros: ['id', 'modelo_id', 'modulo_ativo', 'acao_view', 'acao_create', 'acao_export_csv', 'acao_import_csv']
};

function criarUpstream(dados) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const [, tabela, id] = url.pathname.split('/').filter(Boolean);
      const body = corpo ? JSON.parse(corpo) : null;
      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || [];
      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Registro não encontrado' });
      }
      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (!colunas.includes(chave)) continue;
          linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const linha = { id: Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1 };
        for (const c of colunas) if (body?.[c] !== undefined && c !== 'id') linha[c] = body[c];
        if (tabela === 'prospeccoes' && !linha.status) linha.status = 'ativa';
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Registro não encontrado' });
        for (const c of colunas) if (body?.[c] !== undefined && c !== 'id') alvo[c] = body[c];
        return responder(200, alvo);
      }
      if (req.method === 'DELETE') {
        const idx = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (idx === -1) return responder(404, { error: 'Registro não encontrado' });
        tabelas[tabela].splice(idx, 1);
        return responder(200, { sucesso: true });
      }
      responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas };
}

const MODULOS = ['./apiHttpClient', './permissionsController', './permissionsRepository', './clientesController', './prospeccoesController'];

async function montar(dados) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api/clientes', require('./clientesController'));
  app.use('/api/prospeccoes', require('./prospeccoesController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  return {
    porta: server.address().port,
    tabelas: upstream.tabelas,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

async function chamar(porta, caminho, { usuario = 1, corpo, method } = {}) {
  const resp = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
    method: method || (corpo ? 'POST' : 'GET'),
    headers: { authorization: `Bearer ${tokenDe(usuario)}`, 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  return { status: resp.status, json: await resp.json().catch(() => null) };
}

/** 1 Sup Admin; 2 Ana só exporta (não importa); dono "Ana" existe. */
function baseDados() {
  return {
    usuarios: [
      { id: 1, nome: 'Henrique', email: 'h@x.com', perfil: 'Sup Admin', modelo_permissoes_id: null },
      { id: 2, nome: 'Ana', email: 'ana@x.com', perfil: 'Vendedor', modelo_permissoes_id: 9 }
    ],
    modelos_permissoes: [{ id: 9, nome: 'Vendedor' }],
    perm_cli: [{ id: 1, modelo_id: 9, modulo_ativo: true, acao_view: true, acao_create: true, acao_export_csv: true, acao_import_csv: false }],
    perm_pros: [{ id: 1, modelo_id: 9, modulo_ativo: true, acao_view: true, acao_create: true, acao_export_csv: true, acao_import_csv: false }],
    clientes: [
      { id: 1, tipo_pessoa: 'PJ', razao_social: 'Já Cadastrada LTDA', nome_fantasia: 'Já Cadastrada', cnpj: '04.252.011/0001-10', status_cliente: 'Ativo', dono_cliente: 'Ana', reg_cidade: 'BH', reg_uf: 'MG' },
      { id: 2, tipo_pessoa: 'PJ', razao_social: 'Outra LTDA', nome_fantasia: 'Outra; com ponto e vírgula', cnpj: '', status_cliente: 'Inativo' }
    ],
    contatos_cliente: [{ id: 1, id_cliente: 1, nome: 'Carla', email: 'carla@x.com' }],
    cliente_historico: [],
    prospeccoes: [{ id: 1, nome_fantasia: 'Ativa SA', cnpj: '04.252.011/0001-10', etapa: 'Proposta', valor_estimado: 1500.5, probabilidade: 65, responsavel_id: 2, status: 'ativa', proximo_passo_data: '2026-10-01' }],
    prospeccao_contatos: [],
    prospeccao_historico: []
  };
}

/** Monta a planilha a partir do cabeçalho do modelo (a ordem é a do arquivo). */
function planilha(colunas, linhas) {
  const titulos = colunas.map(c => (c.obrigatoria ? `${c.titulo} *` : c.titulo));
  const corpo = linhas.map(l => colunas.map(c => csv.celula(l[c.chave] ?? '')).join(';'));
  return [titulos.join(';'), ...corpo].join('\r\n');
}

test('modelo e exportação de clientes: permissões e o filtro da tela', async () => {
  const ctx = await montar(baseDados());
  try {
    const modelo = await chamar(ctx.porta, '/api/clientes/csv/modelo', { usuario: 1 });
    assert.strictEqual(modelo.status, 200);
    assert.strictEqual(modelo.json.nome, 'modelo-clientes');
    assert.ok(modelo.json.conteudo.includes('Razão social *'));
    assert.strictEqual((await chamar(ctx.porta, '/api/clientes/csv/modelo', { usuario: 2 })).status, 403, 'sem "Importar CSV" não baixa o modelo');

    const todos = await chamar(ctx.porta, '/api/clientes/csv/exportar', { usuario: 2, corpo: { ids: [] } });
    assert.strictEqual(todos.status, 200);
    assert.strictEqual(todos.json.total, 2);
    assert.match(todos.json.nome, /^clientes-\d{4}-\d{2}-\d{2}$/);
    const { linhas } = csv.lerCsv(todos.json.conteudo);
    const mapa = csv.mapearCabecalho(linhas[0].valores, csv.COLUNAS_CLIENTE);
    const primeira = csv.registroDaLinha(linhas[1].valores, mapa.indice);
    assert.strictEqual(primeira.nome_fantasia, 'Já Cadastrada', 'em ordem alfabética');
    assert.strictEqual(primeira.contato_nome, 'Carla');
    assert.strictEqual(primeira.reg_estado, 'MG');
    assert.strictEqual(csv.registroDaLinha(linhas[2].valores, mapa.indice).nome_fantasia, 'Outra; com ponto e vírgula');

    const soUm = await chamar(ctx.porta, '/api/clientes/csv/exportar', { usuario: 2, corpo: { ids: [2] } });
    assert.strictEqual(soUm.json.total, 1);
    const porGet = await chamar(ctx.porta, '/api/clientes/csv/exportar?ids=1', { usuario: 2 });
    assert.strictEqual(porGet.json.total, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('importar clientes: nada interrompe; cada linha volta com a situação e o porquê', async () => {
  const ctx = await montar(baseDados());
  try {
    const conteudo = '\uFEFF' + planilha(csv.COLUNAS_CLIENTE, [
      { nome_fantasia: csv.MARCA_EXEMPLO, razao_social: 'Exemplo', cnpj: '11.222.333/0001-81' },
      {
        tipo_pessoa: 'PJ', razao_social: 'Casa Azul LTDA', nome_fantasia: 'Casa Azul', cnpj: '11.222.333/0001-81', inscricao_estadual: '123',
        status_cliente: 'Ativo', dono_cliente: 'ana', reg_rua: 'Rua A', reg_numero: '1', reg_bairro: 'Centro', reg_cidade: 'BH',
        reg_estado: 'MG', reg_pais: 'Brasil', reg_cep: '30000-000', cob_igual: 'Sim', ent_igual: 'Sim', contato_nome: 'Maria', contato_email: 'maria@x.com'
      },
      { razao_social: 'Sem Dono LTDA', nome_fantasia: 'Sem Dono', cnpj: '19.131.243/0001-97' },
      { nome_fantasia: 'Sem Razão', cnpj: '45.997.418/0001-53' },
      { razao_social: 'Repetida', nome_fantasia: 'Repetida', cnpj: '11222333000181' },
      { razao_social: 'Já existe', nome_fantasia: 'Já existe', cnpj: '04.252.011/0001-10' }
    ]);

    assert.strictEqual((await chamar(ctx.porta, '/api/clientes/csv/importar', { usuario: 2, corpo: { conteudo } })).status, 403);

    const r = await chamar(ctx.porta, '/api/clientes/csv/importar', { usuario: 1, corpo: { conteudo, nome_arquivo: 'lista.csv' } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.resumo, { linhas: 6, registrados: 1, com_pendencias: 1, nao_registrados: 3, ignorados: 1 });
    const porLinha = new Map(r.json.linhas.map(l => [l.linha, l]));
    assert.strictEqual(porLinha.get(2).situacao, 'ignorado');
    assert.strictEqual(porLinha.get(3).situacao, 'registrado');
    assert.strictEqual(porLinha.get(4).situacao, 'registrado_com_pendencias');
    assert.ok(porLinha.get(4).pendencias.includes('Dono não informado.'));
    assert.strictEqual(porLinha.get(5).situacao, 'nao_registrado');
    assert.ok(porLinha.get(5).bloqueios.includes('Razão social é obrigatória.'));
    assert.ok(porLinha.get(6).bloqueios.includes('CNPJ repetido: já aparece na linha 3.'));
    assert.ok(porLinha.get(7).bloqueios.includes('Já existe cliente com este CNPJ.'));

    // Gravados: os dois que passaram, com contato, criador e histórico.
    const novos = ctx.tabelas.clientes.filter(c => c.id > 2);
    assert.deepStrictEqual(novos.map(c => c.nome_fantasia).sort(), ['Casa Azul', 'Sem Dono']);
    const azul = novos.find(c => c.nome_fantasia === 'Casa Azul');
    assert.strictEqual(azul.dono_cliente, 'Ana');
    assert.strictEqual(azul.criado_por, 1);
    assert.strictEqual(azul.ent_logradouro, 'Rua A', 'entrega igual ao registro');
    assert.strictEqual(ctx.tabelas.contatos_cliente.filter(c => c.id_cliente === azul.id).length, 1);
    const criacao = ctx.tabelas.cliente_historico.find(h => h.cliente_id === porLinha.get(4).id && h.acao === 'criou' && h.tipo === 'criacao');
    assert.match(criacao.observacao, /Importado da planilha lista\.csv \(linha 4\)/);
    const detalhe = typeof criacao.detalhe === 'string' ? JSON.parse(criacao.detalhe) : criacao.detalhe;
    assert.ok(detalhe.pendencias.includes('Dono não informado.'), 'o que ficou faltando vai para a linha do tempo do cliente');
  } finally {
    await ctx.encerrar();
  }
});

test('importar: planilha sem as colunas do modelo nem começa', async () => {
  const ctx = await montar(baseDados());
  try {
    const r = await chamar(ctx.porta, '/api/clientes/csv/importar', { usuario: 1, corpo: { conteudo: 'a;b\n1;2\n' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.json.error, /Salvar modelo CSV/);
    const vazia = await chamar(ctx.porta, '/api/prospeccoes/csv/importar', { usuario: 1, corpo: { conteudo: 'Empresa *\n' } });
    assert.strictEqual(vazia.status, 400);
    assert.strictEqual(ctx.tabelas.clientes.length, 2);
  } finally {
    await ctx.encerrar();
  }
});

test('prospecções: exportar e importar (CNPJ ativo bloqueia; o resto vira pendência)', async () => {
  const ctx = await montar(baseDados());
  try {
    const exp = await chamar(ctx.porta, '/api/prospeccoes/csv/exportar', { usuario: 2, corpo: { ids: [1] } });
    assert.strictEqual(exp.status, 200);
    const { linhas } = csv.lerCsv(exp.json.conteudo);
    const mapa = csv.mapearCabecalho(linhas[0].valores, csv.COLUNAS_PROSPECCAO);
    const linha = csv.registroDaLinha(linhas[1].valores, mapa.indice);
    assert.strictEqual(linha.valor_estimado, '1500,5');
    assert.strictEqual(linha.responsavel, 'Ana');
    assert.strictEqual(linha.proximo_passo_data, '01/10/2026');

    const conteudo = planilha(csv.COLUNAS_PROSPECCAO, [
      { nome_fantasia: 'Nova Loja', cnpj: '11.222.333/0001-81', etapa: 'qualificado', valor_estimado: '20.000,00', responsavel: 'ana@x.com', contato_nome: 'Zé', contato_email: 'ze@x.com', end_estado: 'mg' },
      { nome_fantasia: 'Rascunho', etapa: 'Fechando' },
      { razao_social: 'Sem nome' },
      { nome_fantasia: 'Duplicada', cnpj: '04.252.011/0001-10' }
    ]);
    const r = await chamar(ctx.porta, '/api/prospeccoes/csv/importar', { usuario: 1, corpo: { conteudo, nome_arquivo: 'leads.csv' } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.resumo, { linhas: 4, registrados: 1, com_pendencias: 1, nao_registrados: 2, ignorados: 0 });
    const nova = ctx.tabelas.prospeccoes.find(p => p.nome_fantasia === 'Nova Loja');
    assert.strictEqual(nova.etapa, 'Qualificado');
    assert.strictEqual(nova.valor_estimado, 20000);
    assert.strictEqual(nova.responsavel_id, 2);
    assert.strictEqual(nova.end_uf, 'MG');
    assert.strictEqual(nova.criado_por, 1);
    assert.strictEqual(ctx.tabelas.prospeccao_contatos.filter(c => c.prospeccao_id === nova.id && c.principal).length, 1);
    const rascunho = r.json.linhas.find(l => l.identificacao === 'Rascunho');
    assert.strictEqual(rascunho.situacao, 'registrado_com_pendencias');
    assert.ok(rascunho.pendencias.some(p => p.startsWith('Etapa "Fechando" não existe')));
    assert.ok(r.json.linhas.find(l => l.linha === 5).bloqueios.includes('Já existe uma prospecção ativa com este CNPJ.'));
    assert.ok(ctx.tabelas.prospeccao_historico.some(h => h.acao === 'criou' && /Importada da planilha leads\.csv/.test(h.observacao || '')));
  } finally {
    await ctx.encerrar();
  }
});
