/**
 * Emissão ponta a ponta (backend/fiscal/emissao.js) com API e SEFAZ de mentira.
 *
 * A API falsa guarda tabelas em memória, filtra por igualdade (como a real)
 * e aplica o UNIQUE (ambiente, série, número) — é ele que decide a corrida
 * pelo número. A SEFAZ falsa responde por serviço. O que se prende: a nota
 * autorizada fica completa no banco (chave, protocolo, nfeProc, itens,
 * eventos) e a numeração avança; pendência bloqueia antes de gastar número;
 * rejeição reaproveita o número; colisão pega o seguinte; estouro de tempo
 * deixa "processando" e a consulta pela chave resolve; recibo assíncrono.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { gerarPfx } = require('./certificadoDeTeste');
const { abrirPfx } = require('./certificado');
const configuracao = require('./configuracaoFiscal');
const municipios = require('./municipios');
const assinatura = require('./assinatura');
const emissao = require('./emissao');

const SENHA = 'segredo';
const CERT = abrirPfx(gerarPfx({ cn: 'SANTISSIMO DECOR LTDA:44039257000122', senha: SENHA }), SENHA);
const RESUMO_CERT = { configurado: true, vencido: false, confereComEmitente: true };

const CONFIG = {
  id: 1, cnpj: '44039257000122', razao_social: 'SANTÍSSIMO DECOR LTDA', inscricao_estadual: '0041842150081',
  logradouro: 'Av. Abílio Machado', numero: '1264', bairro: 'Inconfidência', codigo_municipio: '3106200',
  municipio: 'Belo Horizonte', uf: 'MG', cep: '30820272', crt: 1, ambiente: 'homologacao',
  serie_homologacao: 1, proximo_numero_homologacao: 1, serie_producao: 1, proximo_numero_producao: 362,
  natureza_operacao: 'Venda de produtos de fabricação própria', cfop_dentro_uf: '5101', cfop_fora_uf: '6101',
  csosn: '101', pcred_sn: 2.33, pis_cst: '07', cofins_cst: '07', unidade_padrao: 'Peça', modalidade_frete_padrao: 4
};

function tabelasBase() {
  return {
    configuracao_fiscal: [{ ...CONFIG }],
    pedidos: [{ id: 55, numero: '2548', situacao: 'Produção', cliente_id: 7, valor_final: 294, forma_pagamento: 'Boleto', transportadora: 'Não Definida' }],
    pedidos_itens: [{ id: 1, pedido_id: 55, produto_id: 3, codigo: 'OCJP 0000 MDF', nome: 'Painel de MDF', ncm: '94036000', quantidade: 2, valor_unitario: '147.00', valor_total: '294.00' }],
    pedido_parcelas: [{ id: 1, pedido_id: 55, numero_parcela: 1, valor: 147, data_vencimento: '2026-10-14' }, { id: 2, pedido_id: 55, numero_parcela: 2, valor: 147, data_vencimento: '2026-11-13' }],
    clientes: [{
      id: 7, razao_social: 'Cliente Bom LTDA', tipo_pessoa: 'PJ', cnpj: '11222333000181', inscricao_estadual: '0628725380094', indicador_ie: 1,
      reg_logradouro: 'Rua Diamante', reg_numero: '504', reg_bairro: 'São Joaquim', reg_cidade: 'Contagem', reg_uf: 'Minas Gerais', reg_cep: '32113000', reg_codigo_municipio: null
    }],
    produtos: [{ id: 3, codigo: 'OCJP 0000 MDF', ncm: '94036000', origem_mercadoria: 0 }],
    notas_fiscais: [], notas_fiscais_itens: [], notas_fiscais_eventos: []
  };
}

/** API genérica em memória: igualdade nos filtros e o UNIQUE das notas. */
function apiFalsa(tabelas = tabelasBase()) {
  const dados = JSON.parse(JSON.stringify(tabelas));
  const chamadas = [];
  let proximoId = 1000;
  const falha = (msg, status) => { const e = new Error(msg); e.status = status; return e; };
  const partes = path => path.replace(/^\/api\//, '').split('/');
  return {
    dados, chamadas,
    async get(path, { query = {} } = {}) {
      const [t, id] = partes(path);
      chamadas.push(['GET', t, id || query]);
      if (!dados[t]) throw falha(`Tabela ${t} não existe`, 404);
      if (id) return dados[t].find(l => String(l.id) === id) || null;
      return dados[t].filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v)));
    },
    async post(path, body) {
      const [t] = partes(path);
      chamadas.push(['POST', t, body]);
      if (!dados[t]) throw falha(`Tabela ${t} não existe`, 404);
      if (t === 'notas_fiscais' && dados[t].some(l => l.ambiente === body.ambiente && Number(l.serie) === Number(body.serie) && Number(l.numero) === Number(body.numero))) {
        throw falha('Falha na requisição POST /api/notas_fiscais: 500 duplicate key value violates unique constraint "notas_fiscais_numero_unico"', 500);
      }
      const linha = { id: proximoId++, ...body };
      dados[t].push(linha);
      return linha;
    },
    async put(path, body) {
      const [t, id] = partes(path);
      chamadas.push(['PUT', t, id, body]);
      const linha = dados[t]?.find(l => String(l.id) === id);
      if (!linha) throw falha(`${t}/${id} não existe`, 404);
      Object.assign(linha, body);
      return linha;
    },
    async delete(path) {
      const [t, id] = partes(path);
      chamadas.push(['DELETE', t, id]);
      const i = (dados[t] || []).findIndex(l => String(l.id) === id);
      if (i >= 0) dados[t].splice(i, 1);
      return {};
    }
  };
}

const envelope = (servico, corpo) => `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">${corpo}</nfeResultMsg></soap:Body></soap:Envelope>`;
const protocolo = (chave, cStat, xMotivo, nProt = '131260000123456') => `<protNFe versao="4.00"><infProt Id="ID${nProt}"><tpAmb>2</tpAmb><verAplic>MG</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-09-15T15:10:01-03:00</dhRecbto>${nProt ? `<nProt>${nProt}</nProt>` : ''}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
const retEnvi = (cStat, xMotivo, dentro = '') => `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><verAplic>MG</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>31</cUF><dhRecbto>2026-09-15T15:10:00-03:00</dhRecbto>${dentro}</retEnviNFe>`;
const retRecibo = (cStat, xMotivo, dentro = '') => `<retConsReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><verAplic>MG</verAplic><nRec>311000012345678</nRec><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>31</cUF>${dentro}</retConsReciNFe>`;
const retSit = (chave, cStat, xMotivo, dentro = '') => `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><verAplic>MG</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>31</cUF><chNFe>${chave}</chNFe>${dentro}</retConsSitNFe>`;
const chaveDoLote = corpo => /<chNFe>|Id="NFe(\d{44})"/.exec(corpo)?.[1] || /Id="NFe(\d{44})"/.exec(corpo)[1];

/** SEFAZ falsa: cada serviço é uma função (corpo enviado) -> XML, ou um erro a lançar. */
function sefazFalsa(respostas) {
  const chamadas = [];
  return {
    chamadas,
    transporte: async (url, corpo) => {
      const servico = url.split('/').pop();
      chamadas.push({ servico, corpo });
      const r = respostas[servico];
      if (!r) throw new Error(`SEFAZ falsa sem resposta para ${servico}`);
      const saida = typeof r === 'function' ? r(corpo, chamadas) : r;
      if (saida instanceof Error) throw saida;
      return { status: 200, corpo: envelope(servico, saida) };
    }
  };
}

const AUTORIZA = corpo => retEnvi('104', 'Lote processado', protocolo(chaveDoLote(corpo), '100', 'Autorizado o uso da NF-e'));
const IBGE_MG = async () => [{ id: 3106200, nome: 'Belo Horizonte' }, { id: 3118601, nome: 'Contagem' }];

function montar({ tabelas, respostas = { NFeAutorizacao4: AUTORIZA }, env = {} } = {}) {
  configuracao.limparCache();
  municipios.limparCache();
  const api = apiFalsa(tabelas);
  const sefaz = sefazFalsa(respostas);
  const emitir = (entrada = {}, extra = {}) => emissao.emitir({
    api, pedidoId: 55, entrada, certificado: CERT, resumoCertificado: RESUMO_CERT, transporte: sefaz.transporte, env,
    usuarioId: 9, agora: () => new Date('2026-09-15T15:00:00-03:00'), aleatorio: () => 0.14000305,
    opcoesMunicipios: { buscarNaRede: IBGE_MG }, verProc: 'Santissimo 1.1.1', esperar: async () => {}, ...extra
  });
  const sincronizar = notaId => emissao.sincronizar({ api, notaId, transporte: sefaz.transporte, usuarioId: 9 });
  return { api, sefaz, emitir, sincronizar };
}

test('autorizada: nota completa no banco, itens e eventos gravados, numeração avançada, IBGE resolvido e guardado no cliente', async () => {
  const t = montar();
  const r = await t.emitir();
  assert.equal(r.autorizada, true);
  assert.equal(r.sefaz.cStat, '100');
  assert.equal(r.sefaz.protocolo, '131260000123456');
  assert.equal(r.nota.status_fiscal, 'autorizada');
  assert.equal(r.nota.serie, 1);
  assert.equal(r.nota.numero, 1);
  assert.equal(r.nota.ambiente, 'homologacao');
  assert.ok(!('xml_envio' in r.nota) && r.nota.tem_xml_envio && r.nota.tem_xml_autorizado, 'a resposta não carrega os XMLs');

  const nota = t.api.dados.notas_fiscais[0];
  assert.equal(nota.chave_acesso.length, 44);
  assert.ok(nota.chave_acesso.startsWith('31260944039257000122550010000000011'), 'cUF AAMM CNPJ mod série número tpEmis');
  assert.match(nota.codigo_numerico, /^\d{8}$/);
  assert.equal(nota.chave_acesso.slice(35, 43), nota.codigo_numerico, 'cNF dentro da chave');
  assert.equal(nota.protocolo, '131260000123456');
  assert.equal(nota.data_autorizacao, '2026-09-15T15:10:01-03:00');
  assert.equal(nota.valor_total, 294);
  assert.equal(nota.valor_produtos, 294);
  assert.equal(nota.destinatario.nome, 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL');
  assert.equal(nota.destinatario.codigo_municipio, '3118601');
  assert.equal(nota.chave_idempotencia, 'homologacao:1:1:pedido-55');
  assert.equal(nota.criado_por, 9);
  assert.deepEqual(assinatura.verificarAssinatura(nota.xml_envio), { assinada: true, digestConfere: true, assinaturaConfere: true });
  assert.ok(nota.xml_autorizado.startsWith('<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe'));
  assert.ok(nota.xml_autorizado.endsWith('</protNFe></nfeProc>'));
  assert.match(nota.xml_envio, /<tpAmb>2<\/tpAmb>/);
  assert.match(nota.xml_envio, /<cMun>3118601<\/cMun>/);

  assert.equal(t.api.dados.notas_fiscais_itens.length, 1);
  assert.equal(t.api.dados.notas_fiscais_itens[0].nota_fiscal_id, nota.id);
  assert.equal(t.api.dados.notas_fiscais_itens[0].cfop, '5101');
  assert.deepEqual(t.api.dados.notas_fiscais_eventos.map(e => `${e.tipo}:${e.status_novo}`), ['criada:rascunho', 'enviada:enviando', 'autorizada:autorizada']);
  assert.equal(t.api.dados.notas_fiscais_eventos[2].codigo_sefaz, '100');
  assert.equal(t.api.dados.configuracao_fiscal[0].proximo_numero_homologacao, 2);
  assert.equal(t.api.dados.configuracao_fiscal[0].proximo_numero_producao, 362, 'produção não mexe');
  assert.equal(t.api.dados.clientes[0].reg_codigo_municipio, '3118601', 'o código IBGE achado pelo nome fica no cadastro');
  assert.equal(t.api.dados.pedidos[0].nfe_dispensada, false, 'nota autorizada apaga a marca "enviado sem nota"');
  assert.equal(t.sefaz.chamadas.length, 1);
  assert.match(t.sefaz.chamadas[0].corpo, /<enviNFe [^>]*><idLote>\d+<\/idLote><indSinc>1<\/indSinc><NFe xmlns=/);
});

test('pendência bloqueia antes de gastar número: sem parcelas nada é gravado e as pendências voltam no erro', async () => {
  const tabelas = tabelasBase();
  tabelas.pedido_parcelas = [];
  const t = montar({ tabelas });
  await assert.rejects(t.emitir(), e => e.status === 422 && /não pode ser faturado/.test(e.message) && e.extra.pendencias.some(p => p.chave === 'parcelas'));
  assert.equal(t.api.dados.notas_fiscais.length, 0);
  assert.equal(t.api.dados.configuracao_fiscal[0].proximo_numero_homologacao, 1);
  assert.equal(t.sefaz.chamadas.length, 0);
});

test('rejeição da SEFAZ: nota "rejeitada" com o motivo; a próxima emissão do pedido reaproveita o mesmo número', async () => {
  let vez = 0;
  const t = montar({
    respostas: {
      NFeAutorizacao4: corpo => (++vez === 1
        ? retEnvi('104', 'Lote processado', protocolo(chaveDoLote(corpo), '539', 'Rejeicao: Duplicidade de NF-e com diferenca na Chave de Acesso', ''))
        : AUTORIZA(corpo))
    }
  });
  await assert.rejects(t.emitir(), e => e.status === 422 && e.message === 'SEFAZ 539: Rejeicao: Duplicidade de NF-e com diferenca na Chave de Acesso' && e.extra.nota.status_fiscal === 'rejeitada' && e.extra.sefaz.cStat === '539');
  assert.equal(t.api.dados.notas_fiscais.length, 1);
  assert.equal(t.api.dados.notas_fiscais[0].codigo_status_sefaz, '539');
  assert.equal(t.api.dados.configuracao_fiscal[0].proximo_numero_homologacao, 2);

  const r = await t.emitir();
  assert.equal(r.autorizada, true);
  assert.equal(t.api.dados.notas_fiscais.length, 1, 'mesma linha');
  assert.equal(t.api.dados.notas_fiscais[0].numero, 1, 'mesmo número: rejeição não consome numeração');
  assert.equal(t.api.dados.notas_fiscais[0].status_fiscal, 'autorizada');
  assert.equal(t.api.dados.notas_fiscais_itens.length, 1, 'os itens foram trocados, não duplicados');
  assert.equal(t.api.dados.configuracao_fiscal[0].proximo_numero_homologacao, 2, 'numeração não avança de novo');
  assert.deepEqual(t.api.dados.notas_fiscais_eventos.map(e => e.tipo), ['criada', 'enviada', 'rejeitada', 'enviada', 'autorizada']);
});

test('número já usado por outra máquina: pega o seguinte e a numeração vai para depois dele', async () => {
  const tabelas = tabelasBase();
  tabelas.notas_fiscais = [
    { id: 1, pedido_id: 54, ambiente: 'homologacao', serie: 1, numero: 1, status_fiscal: 'autorizada', chave_idempotencia: 'x1' },
    { id: 2, pedido_id: 53, ambiente: 'homologacao', serie: 1, numero: 2, status_fiscal: 'autorizada', chave_idempotencia: 'x2' }
  ];
  const t = montar({ tabelas });
  const r = await t.emitir();
  assert.equal(r.nota.numero, 3);
  assert.equal(t.api.dados.configuracao_fiscal[0].proximo_numero_homologacao, 4);
  assert.equal(t.api.dados.notas_fiscais.length, 3);
});

test('estouro de tempo no envio deixa "processando"; sincronizar consulta pela chave e conclui como autorizada', async () => {
  const t = montar({
    respostas: {
      NFeAutorizacao4: () => Object.assign(new Error('A SEFAZ não respondeu a tempo.'), { status: 504 }),
      NFeConsultaProtocolo4: corpo => { const chave = /<chNFe>(\d{44})</.exec(corpo)[1]; return retSit(chave, '100', 'Autorizado o uso da NF-e', protocolo(chave, '100', 'Autorizado o uso da NF-e', '131260000999999')); }
    }
  });
  await assert.rejects(t.emitir(), e => e.status === 504 && /ficou "processando"/.test(e.message) && e.extra.nota.status_fiscal === 'processando');
  const nota = t.api.dados.notas_fiscais[0];
  assert.equal(nota.status_fiscal, 'processando');
  assert.ok(nota.chave_acesso);

  const r = await t.sincronizar(nota.id);
  assert.equal(r.autorizada, true);
  assert.equal(nota.status_fiscal, 'autorizada');
  assert.equal(nota.protocolo, '131260000999999');
  assert.ok(nota.xml_autorizado.includes('131260000999999'));
  assert.equal(t.sefaz.chamadas[1].servico, 'NFeConsultaProtocolo4');
  assert.deepEqual(t.api.dados.notas_fiscais_eventos.map(e => e.tipo), ['criada', 'enviada', 'erro', 'autorizada']);
});

test('falha de rede antes de chegar vira "erro_tecnico" (número reaproveitável); consulta que "não consta" também', async () => {
  const t = montar({
    respostas: {
      NFeAutorizacao4: () => Object.assign(new Error('A SEFAZ não aceitou a conexão agora.'), { status: 502 }),
      NFeConsultaProtocolo4: corpo => retSit(/<chNFe>(\d{44})</.exec(corpo)[1], '217', 'Rejeicao: NF-e nao consta na base de dados da SEFAZ')
    }
  });
  await assert.rejects(t.emitir(), e => e.status === 502 && e.extra.nota.status_fiscal === 'erro_tecnico');
  const nota = t.api.dados.notas_fiscais[0];
  assert.equal(nota.status_fiscal, 'erro_tecnico');

  // Simula uma nota que ficou "processando" e a SEFAZ diz que nunca chegou.
  nota.status_fiscal = 'processando';
  const r = await t.sincronizar(nota.id);
  assert.equal(r.naoConsta, true);
  assert.equal(nota.status_fiscal, 'erro_tecnico');
  assert.equal(emissao.notaReutilizavel(t.api.dados.notas_fiscais, 'homologacao', 1)?.id, nota.id);
});

test('lote recebido (103): fica processando com o recibo e a consulta do recibo conclui a autorização', async () => {
  const t = montar({
    respostas: {
      NFeAutorizacao4: () => retEnvi('103', 'Lote recebido com sucesso', '<infRec><nRec>311000012345678</nRec><tMed>1</tMed></infRec>'),
      NFeRetAutorizacao4: (corpo, chamadas) => {
        const chave = chaveDoLote(chamadas[0].corpo);
        return chamadas.filter(c => c.servico === 'NFeRetAutorizacao4').length === 1
          ? retRecibo('105', 'Lote em processamento')
          : retRecibo('104', 'Lote processado', protocolo(chave, '100', 'Autorizado o uso da NF-e'));
      }
    }
  });
  const r = await t.emitir();
  assert.equal(r.processando, true);
  assert.equal(r.sefaz.recibo, '311000012345678');
  const nota = t.api.dados.notas_fiscais[0];
  assert.equal(nota.status_fiscal, 'processando');
  assert.equal(nota.recibo, '311000012345678');

  const s = await t.sincronizar(nota.id);
  assert.equal(s.autorizada, true);
  assert.equal(nota.status_fiscal, 'autorizada');
  assert.deepEqual(t.sefaz.chamadas.map(c => c.servico), ['NFeAutorizacao4', 'NFeRetAutorizacao4', 'NFeRetAutorizacao4']);
});

test('ambiente: pedir homologação com produção ligada é permitido; pedir produção sem ela estar ligada cai em homologação', async () => {
  const tabelas = tabelasBase();
  tabelas.configuracao_fiscal[0].ambiente = 'producao';
  const t = montar({ tabelas });
  const r = await t.emitir({ ambiente: 'homologacao' });
  assert.equal(r.nota.ambiente, 'homologacao');
  assert.equal(r.nota.numero, 1);
  assert.match(t.api.dados.notas_fiscais[0].xml_envio, /<tpAmb>2<\/tpAmb>/);
  assert.equal(t.api.dados.configuracao_fiscal[0].proximo_numero_producao, 362);

  const t2 = montar({ env: { NFE_AMBIENTE: 'homologacao' }, tabelas: (() => { const x = tabelasBase(); x.configuracao_fiscal[0].ambiente = 'producao'; return x; })() });
  const r2 = await t2.emitir({ ambiente: 'producao' });
  assert.equal(r2.nota.ambiente, 'homologacao', 'a trava da máquina vale');

  const t3 = montar({ tabelas: (() => { const x = tabelasBase(); x.configuracao_fiscal[0].ambiente = 'producao'; return x; })() });
  const r3 = await t3.emitir({ ambiente: 'producao' });
  assert.equal(r3.nota.ambiente, 'producao');
  assert.equal(r3.nota.numero, 362);
  assert.match(t3.api.dados.notas_fiscais[0].xml_envio, /<tpAmb>1<\/tpAmb>.*<xNome>Cliente Bom LTDA<\/xNome>/);
  assert.equal(t3.api.dados.configuracao_fiscal[0].proximo_numero_producao, 363);
});

test('os dados de transporte e pagamento da entrada entram no XML; a mesma emissão não roda duas vezes ao mesmo tempo', async () => {
  const t = montar();
  const [a, b] = await Promise.allSettled([
    t.emitir({ transporte: { modalidade_frete: 1, volumes_quantidade: 3, volumes_especie: 'Volumes', transportadora_nome: 'Transp XYZ' }, pagamento: { tPag: '17' } }),
    t.emitir()
  ]);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'rejected', 'a segunda vê a nota autorizada e não emite de novo');
  assert.ok(b.reason.extra.pendencias.some(p => p.chave === 'nota_existente'));
  assert.equal(t.api.dados.notas_fiscais.length, 1);
  const xml = t.api.dados.notas_fiscais[0].xml_envio;
  assert.match(xml, /<transp><modFrete>1<\/modFrete><transporta><xNome>Transp XYZ<\/xNome><\/transporta><vol><qVol>3<\/qVol><esp>Volumes<\/esp><marca>SANTÍSSIMO DECOR LTDA SD<\/marca><\/vol><\/transp>/);
  assert.match(xml, /<tPag>17<\/tPag>/);
  // O que foi informado no embarque fica no pedido, para o DANFE e a próxima nota.
  const pedido = t.api.dados.pedidos[0];
  assert.equal(pedido.modalidade_frete, 1);
  assert.equal(pedido.volumes_quantidade, 3);
  assert.equal(pedido.volumes_especie, 'Volumes');
  assert.equal(pedido.transportadora, 'Transp XYZ');
  assert.equal(pedido.forma_pagamento, 'Boleto', 'a forma do pedido não muda');
});

test('camposTransporteDoPedido: só o que veio, limpo; vazio zera volumes/pesos e nunca apaga a transportadora', () => {
  assert.deepEqual(emissao.camposTransporteDoPedido(undefined), {});
  assert.deepEqual(emissao.camposTransporteDoPedido({ modalidade_frete: '4', volumes_quantidade: '', peso_bruto: '12.5', transportadora_nome: '  ' }), { modalidade_frete: 4, volumes_quantidade: null, peso_bruto: 12.5 });
  assert.deepEqual(emissao.camposTransporteDoPedido({ volumes_quantidade: 'x', volumes_especie: ' Caixa ', transportadora_nome: 'T' }), { volumes_especie: 'Caixa', transportadora: 'T' });
  // Volumes detalhados viram o resumo gravado no pedido.
  assert.deepEqual(emissao.camposTransporteDoPedido({ modalidade_frete: 1, volumes: [{ especie: 'Caixa', peso_bruto: 10.5, peso_liquido: 9 }, { especie: 'Engradado', peso_bruto: 20, peso_liquido: 18 }, { especie: 'Caixa', quantidade: 2 }] }),
    { modalidade_frete: 1, volumes_quantidade: 4, volumes_especie: 'Caixa, Engradado', peso_bruto: 30.5, peso_liquido: 27 });
});

test('volumes detalhados na emissão: um <vol> por linha no XML e o resumo no pedido', async () => {
  const t = montar();
  await t.emitir({ transporte: { modalidade_frete: 1, volumes: [{ especie: 'Caixa', peso_bruto: 10, peso_liquido: 9 }, { especie: 'Caixa', peso_bruto: 12, peso_liquido: 11 }] } });
  const xml = t.api.dados.notas_fiscais[0].xml_envio;
  assert.equal((xml.match(/<vol>/g) || []).length, 2);
  assert.match(xml, /<vol><qVol>1<\/qVol><esp>Caixa<\/esp><marca>SANTÍSSIMO DECOR LTDA SD<\/marca><nVol>1<\/nVol><pesoL>9\.000<\/pesoL><pesoB>10\.000<\/pesoB><\/vol><vol><qVol>1<\/qVol><esp>Caixa<\/esp><marca>[^<]+<\/marca><nVol>2<\/nVol>/);
  const pedido = t.api.dados.pedidos[0];
  assert.equal(pedido.volumes_quantidade, 2);
  assert.equal(pedido.volumes_especie, 'Caixa');
  assert.equal(pedido.peso_bruto, 22);
  assert.equal(pedido.peso_liquido, 20);
});
