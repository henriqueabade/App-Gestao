/**
 * Rotas fiscais (backend/fiscalController.js): configuração, certificado e
 * teste da SEFAZ.
 *
 * Upstream falso serve a linha de configuracao_fiscal (e recebe o PUT); as
 * permissões são um dublê; o certificado é um .pfx gerado pelo teste, guardado
 * num cofre falso; a SEFAZ é uma função que devolve o XML do Status. O que se
 * prende: quem pode ver e quem pode mudar, a senha e a chave nunca saem na
 * resposta, a trava do NFE_AMBIENTE, a confirmação para ligar a produção e o
 * ambiente que o teste da SEFAZ realmente usa.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { gerarPfx } = require('./fiscal/certificadoDeTeste');

const MODULOS = ['./apiHttpClient', './permissionsController', './fiscal/configuracaoFiscal', './fiscalController'];
const TOKEN = 'x.eyJpZCI6MX0.assinatura';
const SENHA = 'segredo';
const PFX = gerarPfx({ cn: 'SANTISSIMO DECOR LTDA:44039257000122', senha: SENHA });
const PFX_OUTRO = gerarPfx({ cn: 'OUTRA EMPRESA:11111111000191', senha: SENHA });

const LINHA = {
  id: 1, cnpj: '44039257000122', razao_social: 'SANTÍSSIMO DECOR LTDA', inscricao_estadual: '0041842150081',
  logradouro: 'Av. Abílio Machado', numero: '1264', bairro: 'Inconfidência', codigo_municipio: '3106200',
  municipio: 'Belo Horizonte', uf: 'MG', cep: '30820272', crt: 1, ambiente: 'homologacao',
  serie_homologacao: 1, proximo_numero_homologacao: 1, serie_producao: 2, proximo_numero_producao: 1,
  natureza_operacao: 'Venda de produtos de fabricação própria', cfop_dentro_uf: '5101', cfop_fora_uf: '6101',
  csosn: '101', pcred_sn: 2.33, pis_cst: '07', cofins_cst: '07', unidade_padrao: 'Peça', modalidade_frete_padrao: 4
};

const RESPOSTA_107 = tpAmb => `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>`
  + `<retConsStatServ versao="4.00"><tpAmb>${tpAmb}</tpAmb><verAplic>W-3.4.35</verAplic><cStat>107</cStat><xMotivo>Servico em operacao</xMotivo><cUF>31</cUF></retConsStatServ>`
  + `</nfeResultMsg></soap:Body></soap:Envelope>`;

function cofreFalso() {
  return {
    nome: 'teste',
    cifrar: t => Buffer.from(t).toString('base64'),
    decifrar: b => Buffer.from(b, 'base64').toString()
  };
}

/**
 * API genérica de mentira: GET /api/:tabela filtra por igualdade (como a API
 * real), POST cria com id, PUT /:id mescla, DELETE /:id apaga; o UNIQUE
 * (ambiente, série, número) das notas é aplicado. configuracao_fiscal é a
 * linha única. Tabela ausente responde 404, que é o que acontece antes de
 * rodar o SQL.
 */
function criarUpstream(linhas, tabelas = {}) {
  const puts = [];
  tabelas.configuracao_fiscal = linhas;
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const responder = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    const [, tabela, id] = url.pathname.match(/^\/api\/([a-z_]+)(?:\/(\d+))?$/) || [];
    const lista = tabela && tabelas[tabela];
    if (!lista) return responder(404, { error: 'não há' });
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const dados = corpo ? JSON.parse(corpo) : {};
      if (req.method === 'GET') {
        if (id) return responder(200, lista.find(l => String(l.id) === id) || null);
        const filtros = [...url.searchParams.entries()];
        return responder(200, lista.filter(l => filtros.every(([c, v]) => String(l[c]) === String(v))));
      }
      if (req.method === 'POST') {
        if (tabela === 'notas_fiscais' && lista.some(l => l.ambiente === dados.ambiente && Number(l.serie) === Number(dados.serie) && Number(l.numero) === Number(dados.numero))) {
          return responder(500, { error: 'duplicate key value violates unique constraint "notas_fiscais_numero_unico"' });
        }
        const linha = { id: lista.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1, ...dados };
        lista.push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT' && id) {
        const linha = lista.find(l => String(l.id) === id);
        if (!linha) return responder(404, { error: 'não há' });
        if (tabela === 'configuracao_fiscal') puts.push(dados);
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
  return { servidor, puts };
}

const PROTOCOLO_100 = chave => `<protNFe versao="4.00"><infProt Id="ID131260000123456"><tpAmb>2</tpAmb><verAplic>MG</verAplic><chNFe>${chave}</chNFe>`
  + `<dhRecbto>2026-09-15T15:10:01-03:00</dhRecbto><nProt>131260000123456</nProt><digVal>x=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;

/** A SEFAZ de mentira por serviço: status 107, autorização 100 (ou o que `sefazAutoriza` mandar), consulta 100. */
function respostaSefaz(url, corpo, sefazAutoriza) {
  const tpAmb = /<tpAmb>1<\/tpAmb>/.test(corpo) ? 1 : 2;
  const envelope = miolo => `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${miolo}</nfeResultMsg></soap:Body></soap:Envelope>`;
  if (/NFeAutorizacao4$/.test(url)) {
    const chave = /Id="NFe(\d{44})"/.exec(corpo)[1];
    const dentro = sefazAutoriza ? sefazAutoriza(chave) : PROTOCOLO_100(chave);
    return envelope(`<retEnviNFe versao="4.00"><tpAmb>${tpAmb}</tpAmb><verAplic>MG</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>31</cUF><dhRecbto>2026-09-15T15:10:00-03:00</dhRecbto>${dentro}</retEnviNFe>`);
  }
  if (/NFeConsultaProtocolo4$/.test(url)) {
    const chave = /<chNFe>(\d{44})</.exec(corpo)[1];
    return envelope(`<retConsSitNFe versao="4.00"><tpAmb>${tpAmb}</tpAmb><verAplic>MG</verAplic><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><cUF>31</cUF><chNFe>${chave}</chNFe>${PROTOCOLO_100(chave)}</retConsSitNFe>`);
  }
  return RESPOSTA_107(tpAmb);
}

async function montar({ linhas = [JSON.parse(JSON.stringify(LINHA))], env = {}, comCertificado = true, tabelas = {}, municipiosRede, sefazAutoriza } = {}) {
  const upstream = criarUpstream(linhas, tabelas);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  // Os módulos fiscais guardam cache (configuração, municípios): cada teste parte do zero.
  for (const chave of Object.keys(require.cache)) {
    if (chave.includes(`${path.sep}backend${path.sep}fiscal${path.sep}`)) delete require.cache[chave];
  }

  const estado = { chaves: new Set(['financeiro.config.view']), supAdmin: false };
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: chave => (req, res, next) => (estado.supAdmin || estado.chaves.has(chave) ? next() : res.status(403).json({ error: 'Sem permissão' })),
      exigirSupAdmin: (req, res, next) => (estado.supAdmin ? next() : res.status(403).json({ error: 'Somente Sup Admin' })),
      ehSupAdmin: async () => estado.supAdmin
    }
  };

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'fiscal-rotas-'));
  const arquivoPfx = path.join(pasta, 'santissimo.pfx');
  fs.writeFileSync(arquivoPfx, PFX);
  const arquivoOutro = path.join(pasta, 'outra.pfx');
  fs.writeFileSync(arquivoOutro, PFX_OUTRO);

  const segredoLocal = require('./fiscal/segredoLocal');
  const segredo = segredoLocal.criar({ pasta: path.join(pasta, 'guardado'), cofre: cofreFalso(), env: {} });
  if (comCertificado) segredo.guardar({ caminhoOrigem: arquivoPfx, senha: SENHA });

  const chamadasSefaz = [];
  const transporteFabrica = opcoes => async (url, corpo) => { chamadasSefaz.push({ url, corpo, opcoes }); return { status: 200, corpo: respostaSefaz(url, corpo, sefazAutoriza) }; };

  const { criarRouter } = require('./fiscalController');
  const app = express();
  app.use(express.json());
  app.use('/api/fiscal', criarRouter({ segredo, transporteFabrica, env, municipiosRede }));
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function chamar(metodo, caminho, corpo) {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    return { status: r.status, corpo: await r.json() };
  }

  const fechar = () => Promise.all([
    new Promise(r => servidor.close(r)), new Promise(r => upstream.servidor.close(r))
  ]);
  return { chamar, estado, upstream, chamadasSefaz, fechar, arquivoPfx, arquivoOutro, pasta };
}

test('ver a configuração exige financeiro.config.view; a resposta traz o emitente e o certificado sem chave nem senha', async () => {
  const t = await montar();
  try {
    t.estado.chaves.clear();
    assert.equal((await t.chamar('GET', '/api/fiscal/configuracao')).status, 403);

    t.estado.chaves.add('financeiro.config.view');
    const { status, corpo } = await t.chamar('GET', '/api/fiscal/configuracao');
    assert.equal(status, 200);
    assert.equal(corpo.configuracao.cnpj, '44039257000122');
    assert.equal(corpo.ambiente, 'homologacao');
    assert.equal(corpo.travado_em_homologacao_nesta_maquina, false);
    assert.deepEqual(corpo.numeracao, { serie: 1, proximoNumero: 1 });
    assert.deepEqual(corpo.pendencias, []);
    assert.equal(corpo.pode_editar, false);
    assert.equal(corpo.cofre_disponivel, true);
    assert.equal(corpo.certificado.configurado, true);
    assert.equal(corpo.certificado.titular, 'SANTISSIMO DECOR LTDA');
    assert.equal(corpo.certificado.cnpj, '44039257000122');
    assert.equal(corpo.certificado.confereComEmitente, true);
    assert.equal(corpo.certificado.origem, 'arquivo');
    const texto = JSON.stringify(corpo);
    assert.ok(!texto.includes(SENHA) && !/PRIVATE KEY|Pem"/.test(texto), 'nada da chave ou da senha sai na resposta');
  } finally {
    await t.fechar();
  }
});

test('sem certificado guardado o resumo diz que não está configurado, sem derrubar a rota', async () => {
  const t = await montar({ comCertificado: false });
  try {
    const { corpo } = await t.chamar('GET', '/api/fiscal/configuracao');
    assert.equal(corpo.certificado.configurado, false);
    assert.match(corpo.certificado.erro, /Nenhum certificado/);
    const sefaz = await t.chamar('POST', '/api/fiscal/sefaz/status', {});
    assert.equal(sefaz.status, 409);
  } finally {
    await t.fechar();
  }
});

test('NFE_AMBIENTE=homologacao prende a máquina mesmo com produção ligada no banco', async () => {
  const linhas = [{ ...LINHA, ambiente: 'producao' }];
  const t = await montar({ linhas, env: { NFE_AMBIENTE: 'homologacao' } });
  try {
    const { corpo } = await t.chamar('GET', '/api/fiscal/configuracao');
    assert.equal(corpo.ambiente, 'homologacao');
    assert.equal(corpo.ambiente_no_banco, 'producao');
    assert.equal(corpo.travado_em_homologacao_nesta_maquina, true);
    assert.deepEqual(corpo.numeracao, { serie: 1, proximoNumero: 1 }, 'numeração da homologação, não da produção');

    // Pedir produção no teste da SEFAZ não passa da trava: a mensagem vai com tpAmb 2.
    const sefaz = await t.chamar('POST', '/api/fiscal/sefaz/status', { ambiente: 'producao' });
    assert.equal(sefaz.status, 200);
    assert.equal(sefaz.corpo.ambiente, 'homologacao');
    assert.match(t.chamadasSefaz[0].corpo, /<tpAmb>2<\/tpAmb>/);
    assert.match(t.chamadasSefaz[0].url, /^https:\/\/hnfe\.fazenda\.mg\.gov\.br\//);
  } finally {
    await t.fechar();
  }
});

test('só o Sup Admin grava; ligar a produção exige a palavra de confirmação', async () => {
  const t = await montar();
  try {
    assert.equal((await t.chamar('PUT', '/api/fiscal/configuracao', { ambiente: 'producao' })).status, 403);

    t.estado.supAdmin = true;
    const invalido = await t.chamar('PUT', '/api/fiscal/configuracao', { cnpj: '123' });
    assert.equal(invalido.status, 400);
    assert.match(invalido.corpo.error, /cnpj: precisa ter 14 dígitos/);
    assert.equal((await t.chamar('PUT', '/api/fiscal/configuracao', {})).status, 400);

    const semConfirmacao = await t.chamar('PUT', '/api/fiscal/configuracao', { ambiente: 'producao' });
    assert.equal(semConfirmacao.status, 400);
    assert.match(semConfirmacao.corpo.error, /PRODUCAO/);
    assert.equal(t.upstream.puts.length, 0, 'nada gravado sem a confirmação');

    const ok = await t.chamar('PUT', '/api/fiscal/configuracao', { ambiente: 'producao', proximo_numero_producao: '5', confirmacao: 'producao' });
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.ambiente, 'producao');
    assert.equal(ok.corpo.pode_editar, true);
    assert.deepEqual(ok.corpo.numeracao, { serie: 2, proximoNumero: 5 });
    assert.equal(t.upstream.puts[0].ambiente, 'producao');
    assert.equal(t.upstream.puts[0].proximo_numero_producao, 5);
    assert.equal(t.upstream.puts[0].atualizado_por, 1);
    assert.ok(!('confirmacao' in t.upstream.puts[0]), 'a confirmação não vira coluna');

    // Já em produção, mexer em outra coisa não pede a palavra de novo.
    const outra = await t.chamar('PUT', '/api/fiscal/configuracao', { ambiente: 'producao', natureza_operacao: 'Venda' });
    assert.equal(outra.status, 200);
  } finally {
    await t.fechar();
  }
});

test('guardar o certificado valida a senha, avisa CNPJ diferente do emitente e nunca devolve a senha; remover apaga', async () => {
  const t = await montar({ comCertificado: false });
  try {
    assert.equal((await t.chamar('POST', '/api/fiscal/certificado', { caminho: t.arquivoPfx, senha: SENHA })).status, 403);
    t.estado.supAdmin = true;

    const errada = await t.chamar('POST', '/api/fiscal/certificado', { caminho: t.arquivoPfx, senha: 'errada' });
    assert.equal(errada.status, 400);
    assert.match(errada.corpo.error, /Senha do certificado incorreta/);
    assert.equal((await t.chamar('POST', '/api/fiscal/certificado', { caminho: path.join(t.pasta, 'nao-existe.pfx'), senha: SENHA })).status, 400);
    assert.equal((await t.chamar('POST', '/api/fiscal/certificado', { caminho: t.arquivoPfx.replace(/\.pfx$/, '.txt'), senha: SENHA })).status, 400);

    const outra = await t.chamar('POST', '/api/fiscal/certificado', { caminho: t.arquivoOutro, senha: SENHA });
    assert.equal(outra.status, 200);
    assert.equal(outra.corpo.confereComEmitente, false);

    const certa = await t.chamar('POST', '/api/fiscal/certificado', { caminho: t.arquivoPfx, senha: SENHA });
    assert.equal(certa.status, 200);
    assert.equal(certa.corpo.titular, 'SANTISSIMO DECOR LTDA');
    assert.equal(certa.corpo.confereComEmitente, true);
    assert.ok(!JSON.stringify(certa.corpo).includes(SENHA));

    const estado = await t.chamar('GET', '/api/fiscal/configuracao');
    assert.equal(estado.corpo.certificado.origem, 'arquivo');

    const sefaz = await t.chamar('POST', '/api/fiscal/sefaz/status', {});
    assert.equal(sefaz.status, 200);
    assert.equal(sefaz.corpo.emOperacao, true);
    assert.equal(sefaz.corpo.certificado.cnpj, '44039257000122');
    assert.match(t.chamadasSefaz[0].opcoes.certificadoPem, /BEGIN CERTIFICATE/);

    assert.equal((await t.chamar('DELETE', '/api/fiscal/certificado')).corpo.configurado, false);
    assert.equal((await t.chamar('GET', '/api/fiscal/configuracao')).corpo.certificado.configurado, false);
  } finally {
    await t.fechar();
  }
});

test('GET /municipios exige cli.view, aceita nome ou sigla do estado e devolve o exato ou os parecidos', async () => {
  const consultas = [];
  const municipiosRede = async uf => { consultas.push(uf); return [{ id: 3106200, nome: 'Belo Horizonte' }, { id: 3170206, nome: 'Uberlândia' }, { id: 3170107, nome: 'Uberaba' }]; };
  const t = await montar({ municipiosRede });
  try {
    require('./fiscal/municipios').limparCache();
    assert.equal((await t.chamar('GET', '/api/fiscal/municipios?uf=MG&nome=Uberaba')).status, 403);
    t.estado.chaves.add('cli.view');

    const exato = await t.chamar('GET', '/api/fiscal/municipios?uf=Minas%20Gerais&nome=uberlandia');
    assert.equal(exato.status, 200);
    assert.equal(exato.corpo.uf, 'MG');
    assert.deepEqual(exato.corpo.exato, { codigo: '3170206', nome: 'Uberlândia' });

    const parecidos = await t.chamar('GET', '/api/fiscal/municipios?uf=mg&nome=Uber');
    assert.equal(parecidos.corpo.exato, null);
    assert.deepEqual(parecidos.corpo.candidatos.map(c => c.nome).sort(), ['Uberaba', 'Uberlândia']);
    assert.deepEqual(consultas, ['MG'], 'o IBGE é consultado uma vez por estado');

    const semUf = await t.chamar('GET', '/api/fiscal/municipios?nome=Uberaba');
    assert.equal(semUf.status, 400);
    assert.match(semUf.corpo.error, /Informe o estado/);
    assert.equal((await t.chamar('GET', '/api/fiscal/municipios?uf=Marte&nome=X')).status, 400);
  } finally {
    await t.fechar();
  }
});

test('GET /pedidos/:id/prontidao junta pedido, itens, parcelas, cliente, peças e notas e diz o que falta', async () => {
  const tabelas = {
    pedidos: [{ id: 55, numero: 'PED-55', situacao: 'Produção', cliente_id: 7, valor_final: 1500 }],
    pedidos_itens: [
      { id: 1, pedido_id: 55, produto_id: 3, codigo: 'MESA-01', ncm: '94036000', quantidade: 1, valor_total: 1500 },
      { id: 2, pedido_id: 56, produto_id: 3, codigo: 'OUTRO', ncm: '', quantidade: 1, valor_total: 1 }
    ],
    pedido_parcelas: [{ id: 1, pedido_id: 55, numero_parcela: 1, valor: 1500, data_vencimento: '2026-10-10' }],
    clientes: [{
      id: 7, razao_social: 'Cliente Bom LTDA', tipo_pessoa: 'PJ', cnpj: '11222333000181', inscricao_estadual: '', indicador_ie: 9,
      reg_logradouro: 'Rua A', reg_numero: '10', reg_bairro: 'Centro', reg_cidade: 'Uberlândia', reg_uf: 'Minas Gerais', reg_cep: '38400000', reg_codigo_municipio: null
    }],
    produtos: [{ id: 3, codigo: 'MESA-01', ncm: '94036000', origem_mercadoria: 0, unidade_comercial: null, cfop_dentro_uf: null, csosn: null }]
    // notas_fiscais de propósito ausente: sem a tabela a avaliação segue.
  };
  const t = await montar({ tabelas });
  try {
    assert.equal((await t.chamar('GET', '/api/fiscal/pedidos/55/prontidao')).status, 403);
    t.estado.chaves.add('financeiro.nfe.view');

    const { status, corpo } = await t.chamar('GET', '/api/fiscal/pedidos/55/prontidao');
    assert.equal(status, 200);
    assert.equal(corpo.pronto, true, JSON.stringify(corpo.pendencias));
    assert.equal(corpo.automaticas, 1, 'só o código IBGE, que a emissão resolve sozinha');
    assert.equal(corpo.pendencias[0].chave, 'reg_codigo_municipio');
    assert.equal(corpo.resumo.cliente, 'Cliente Bom LTDA');
    assert.equal(corpo.resumo.ufDestino, 'MG');
    assert.equal(corpo.ambiente, 'homologacao', 'a tela de embarque mostra em que ambiente a nota sai');
    assert.deepEqual(corpo.notas, [], 'e as notas que o pedido já tem (sem XML)');
    assert.equal(corpo.resumo.tPagSugerido, '99', 'pedido sem forma de pagamento: "outros"');
    assert.deepEqual(corpo.resumo.itens.map(i => [i.codigo, i.cfop, i.unidade]), [['MESA-01', '5101', 'Peça']], 'só os itens deste pedido; CFOP e unidade herdados da configuração');

    assert.equal((await t.chamar('GET', '/api/fiscal/pedidos/999/prontidao')).status, 404);
    assert.equal((await t.chamar('GET', '/api/fiscal/pedidos/abc/prontidao')).status, 400);
  } finally {
    await t.fechar();
  }
});

test('prontidão sem certificado nesta máquina e com cliente incompleto lista as pendências por origem', async () => {
  const tabelas = {
    pedidos: [{ id: 55, numero: 'PED-55', situacao: 'Produção', cliente_id: 7, valor_final: 1500 }],
    pedidos_itens: [{ id: 1, pedido_id: 55, produto_id: 3, codigo: 'MESA-01', ncm: '9403', quantidade: 1, valor_total: 1500 }],
    pedido_parcelas: [],
    clientes: [{ id: 7, razao_social: 'Cliente', tipo_pessoa: 'PJ', cnpj: '123', reg_uf: 'MG' }],
    produtos: [{ id: 3, codigo: 'MESA-01', ncm: '9403' }],
    notas_fiscais: [{ id: 9, pedido_id: 55, numero: 361, status_fiscal: 'autorizada' }]
  };
  const t = await montar({ tabelas, comCertificado: false });
  try {
    t.estado.chaves.add('financeiro.nfe.view');
    const { corpo } = await t.chamar('GET', '/api/fiscal/pedidos/55/prontidao');
    assert.equal(corpo.pronto, false);
    const origens = new Set(corpo.pendencias.map(p => p.origem));
    assert.deepEqual([...origens].sort(), ['certificado', 'cliente', 'peca', 'pedido']);
    assert.match(corpo.pendencias.find(p => p.chave === 'nota_existente').mensagem, /nº 361 \(autorizada\)/);
    assert.match(corpo.pendencias.find(p => p.origem === 'certificado').mensagem, /Nenhum certificado/);
    assert.equal(corpo.notas.length, 1);
    assert.equal(corpo.notas[0].numero, 361);
    assert.ok(!('xml_envio' in corpo.notas[0]));
  } finally {
    await t.fechar();
  }
});

function tabelasDoPedido() {
  return {
    pedidos: [{ id: 55, numero: '2548', situacao: 'Produção', cliente_id: 7, valor_final: 294, forma_pagamento: 'Boleto' }],
    pedidos_itens: [{ id: 1, pedido_id: 55, produto_id: 3, codigo: 'MESA-01', nome: 'Mesa', ncm: '94036000', quantidade: 2, valor_unitario: 147, valor_total: 294 }],
    pedido_parcelas: [{ id: 1, pedido_id: 55, numero_parcela: 1, valor: 294, data_vencimento: '2026-10-14' }],
    clientes: [{
      id: 7, razao_social: 'Cliente Bom LTDA', tipo_pessoa: 'PJ', cnpj: '11222333000181', inscricao_estadual: '0628725380094', indicador_ie: 1,
      reg_logradouro: 'Rua Diamante', reg_numero: '504', reg_bairro: 'São Joaquim', reg_cidade: 'Contagem', reg_uf: 'Minas Gerais', reg_cep: '32113000', reg_codigo_municipio: '3118601'
    }],
    produtos: [{ id: 3, codigo: 'MESA-01', ncm: '94036000', origem_mercadoria: 0 }],
    notas_fiscais: [], notas_fiscais_itens: [], notas_fiscais_eventos: []
  };
}

test('POST /pedidos/:id/emitir exige financeiro.nfe.emit; emite, grava a nota e as rotas de notas devolvem sem/com XML', async () => {
  const tabelas = tabelasDoPedido();
  const t = await montar({ tabelas });
  try {
    assert.equal((await t.chamar('POST', '/api/fiscal/pedidos/55/emitir', {})).status, 403);
    t.estado.chaves.add('financeiro.nfe.emit');
    t.estado.chaves.add('financeiro.nfe.view');

    const { status, corpo } = await t.chamar('POST', '/api/fiscal/pedidos/55/emitir', { transporte: { modalidade_frete: 9 } });
    assert.equal(status, 200, JSON.stringify(corpo));
    assert.equal(corpo.autorizada, true);
    assert.equal(corpo.sefaz.cStat, '100');
    assert.equal(corpo.sefaz.protocolo, '131260000123456');
    assert.equal(corpo.nota.status_fiscal, 'autorizada');
    assert.equal(corpo.nota.numero, 1);
    assert.equal(corpo.nota.ambiente, 'homologacao');
    assert.ok(!corpo.nota.xml_envio && corpo.nota.tem_xml_autorizado);
    assert.equal(corpo.nota.criado_por, 1, 'usuário do JWT');

    const gravada = tabelas.notas_fiscais[0];
    assert.equal(gravada.status_fiscal, 'autorizada');
    assert.match(gravada.xml_envio, /<verProc>Santissimo \d+\.\d+\.\d+<\/verProc>/);
    assert.match(gravada.xml_envio, /<transp><modFrete>9<\/modFrete><\/transp>/);
    assert.ok(gravada.xml_autorizado.includes('<nfeProc'));
    assert.equal(tabelas.notas_fiscais_itens.length, 1);
    assert.deepEqual(tabelas.notas_fiscais_eventos.map(e => e.tipo), ['criada', 'enviada', 'autorizada']);
    assert.equal(t.upstream.puts.at(-1).proximo_numero_homologacao, 2);
    assert.match(t.chamadasSefaz[0].url, /hnfe\.fazenda\.mg\.gov\.br\/nfe2\/services\/NFeAutorizacao4$/);
    assert.match(t.chamadasSefaz[0].opcoes.certificadoPem, /BEGIN CERTIFICATE/);

    const listaNotas = await t.chamar('GET', '/api/fiscal/notas?pedido_id=55');
    assert.equal(listaNotas.status, 200);
    assert.equal(listaNotas.corpo.length, 1);
    assert.ok(!('xml_envio' in listaNotas.corpo[0]) && listaNotas.corpo[0].tem_xml_envio);

    const uma = await t.chamar('GET', `/api/fiscal/notas/${gravada.id}`);
    assert.equal(uma.status, 200);
    assert.match(uma.corpo.xml_envio, /<Signature/);
    assert.equal((await t.chamar('GET', '/api/fiscal/notas/999')).status, 404);

    const sinc = await t.chamar('POST', `/api/fiscal/notas/${gravada.id}/sincronizar`, {});
    assert.equal(sinc.status, 200);
    assert.equal(sinc.corpo.autorizada, true);

    // Emitir de novo: a nota autorizada bloqueia (422 com a pendência), nada novo é gravado.
    const de_novo = await t.chamar('POST', '/api/fiscal/pedidos/55/emitir', {});
    assert.equal(de_novo.status, 422);
    assert.ok(de_novo.corpo.pendencias.some(p => p.chave === 'nota_existente'));
    assert.equal(tabelas.notas_fiscais.length, 1);
  } finally {
    await t.fechar();
  }
});

test('emitir com pendência e com rejeição da SEFAZ devolve 422 com o detalhe que a tela mostra', async () => {
  const tabelas = tabelasDoPedido();
  tabelas.pedido_parcelas = [];
  const t = await montar({ tabelas });
  try {
    t.estado.chaves.add('financeiro.nfe.emit');
    const pendente = await t.chamar('POST', '/api/fiscal/pedidos/55/emitir', {});
    assert.equal(pendente.status, 422);
    assert.match(pendente.corpo.error, /não pode ser faturado/);
    assert.ok(pendente.corpo.pendencias.some(p => p.origem === 'pedido' && p.chave === 'parcelas'));
    assert.equal(tabelas.notas_fiscais.length, 0);
    assert.equal((await t.chamar('POST', '/api/fiscal/pedidos/999/emitir', {})).status, 404);
  } finally {
    await t.fechar();
  }

  const rejeita = chave => `<protNFe versao="4.00"><infProt Id="IDx"><tpAmb>2</tpAmb><verAplic>MG</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-09-15T15:10:01-03:00</dhRecbto><cStat>778</cStat><xMotivo>Rejeicao: Informado NCM inexistente</xMotivo></infProt></protNFe>`;
  const t2 = await montar({ tabelas: tabelasDoPedido(), sefazAutoriza: rejeita });
  try {
    t2.estado.chaves.add('financeiro.nfe.emit');
    const r = await t2.chamar('POST', '/api/fiscal/pedidos/55/emitir', {});
    assert.equal(r.status, 422);
    assert.equal(r.corpo.error, 'SEFAZ 778: Rejeicao: Informado NCM inexistente');
    assert.equal(r.corpo.sefaz.cStat, '778');
    assert.equal(r.corpo.nota.status_fiscal, 'rejeitada');
  } finally {
    await t2.fechar();
  }
});

test('server.js monta /api/fiscal antes do proxy genérico /api/:table', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const fiscal = fonte.indexOf("app.use('/api/fiscal'");
  const generico = fonte.indexOf("app.get('/api/:table'");
  assert.ok(fiscal > 0 && generico > fiscal);
});
