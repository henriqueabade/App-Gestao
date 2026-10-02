/**
 * Contabilidade — etapas 10 a 13 (integrações automáticas): as rotas de
 * /api/contabilidade/integracoes e /entrada com a API genérica de mentira,
 * a guarda de permissão de mentira, um certificado A1 de teste e a rede de
 * mentira (SEFAZ, Ambiente Nacional, ADN e BB respondendo como os de verdade).
 *
 * O que fica preso (30/09/2026):
 *   - SEFAZ: a distribuição traz o resumo de A (nova → ciência automática),
 *     a nota completa de B (registrada sozinha em Documentos recebidos, origem
 *     "sefaz", com o XML oficial) e o cancelamento de C (entra marcada, não
 *     se registra); o NSU anda e a espera de 1 hora vale até para o botão;
 *     "baixar XML" traz A completa e registra; ignorar/restaurar;
 *   - ADN: a NFS-e em que a empresa é tomadora entra (origem "adn", ISS
 *     retido, XML oficial); a em que é prestadora fica de fora;
 *   - BB: credenciais próprias (secret no cofre do banco), conta de teste na
 *     homologação, sem certificado; os lançamentos entram no Extrato
 *     bancário pela API, com a contrapartida; buscar de novo não repete;
 *   - o estado da tela, o certificado público, as permissões e o painel.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');
const { gerarPfx } = require('./fiscal/certificadoDeTeste');
const { dvModulo11 } = require('./fiscal/xmlNfe');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;
const EMPRESA = '11444777000161';
const chave = n => { const base = `312608572482370001035500100000${String(n).padStart(4, '0')}10000${String(n).padStart(4, '0')}`.slice(0, 43); return `${base}${dvModulo11(base)}`; };
const CHAVE_A = chave(1001);
const CHAVE_B = chave(1002);
const CHAVE_C = chave(1003);
const CHAVE_NFSE = '31062002212345678000199000000000012326090123456789';
const CHAVE_NFSE_OUTRA = '31062002212345678000199000000000012426090123456780';
const AGORA = Date.parse('2026-09-15T12:00:00-03:00');
const gz = t => zlib.gzipSync(Buffer.from(t, 'utf8')).toString('base64');

const COLUNAS = {
  pedidos: ['id', 'numero', 'situacao', 'cliente_id', 'valor_final', 'embarcar_real'],
  notas_fiscais: ['id', 'pedido_id', 'serie', 'numero', 'status_fiscal', 'valor_total', 'data_emissao', 'criado_em', 'xml_autorizado', 'chave_acesso', 'destinatario'],
  notas_devolucao: ['id', 'pedido_id'],
  configuracao_fiscal: ['id', 'cnpj', 'uf', 'razao_social'],
  configuracao_cobranca: ['id'],
  financeiro_fechamentos: ['id'], financeiro_fechamento_itens: ['id'], financeiro_pagamentos: ['id'],
  usuarios: ['id', 'nome'],
  contatos: ['id', 'nome', 'razao_social', 'tipo_id', 'tipo_pessoa', 'cnpj', 'cpf', 'inscricao_estadual', 'email', 'telefone_fixo', 'end_logradouro', 'end_numero', 'end_complemento', 'end_bairro', 'end_cidade', 'end_uf', 'end_pais', 'end_cep', 'end_codigo_municipio', 'status', 'anotacoes', 'criado_por', 'criado_em'],
  contato_tipos: ['id', 'nome'], contato_pessoas: ['id', 'contato_id', 'nome'],
  contato_historico: ['id', 'contato_id', 'tipo', 'acao', 'entidade', 'campo', 'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em'],
  competencia_contabil: ['id', 'competencia', 'status'], contabil_pendencias_resolucoes: ['id', 'competencia', 'chave'],
  contabil_eventos: ['id', 'tipo', 'competencia', 'descricao', 'dados', 'usuario_id', 'criado_em', 'referencia_tipo', 'referencia_id'],
  contabil_arquivos: ['id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'sha256', 'partes', 'completo', 'categoria', 'origem', 'competencia', 'descricao', 'criado_por', 'criado_em', 'excluido_em'],
  contabil_arquivo_partes: ['id', 'arquivo_id', 'ordem', 'dados'],
  contabil_arquivo_vinculos: ['id', 'arquivo_id', 'alvo_tipo', 'alvo_id', 'criado_por', 'criado_em'],
  documentos_recebidos: ['id', 'tipo', 'especie', 'origem', 'chave_acesso', 'modelo', 'serie', 'numero', 'codigo_verificacao', 'municipio', 'emitente_documento', 'emitente_nome', 'contato_id',
    'data_emissao', 'competencia', 'natureza_operacao', 'descricao', 'valor_total', 'valor_produtos', 'valor_iss', 'iss_retido', 'valor_retencoes', 'itens', 'cfops', 'protocolo',
    'financeiro_pagamento_id', 'sem_pagamento', 'observacao', 'criado_por', 'criado_em', 'excluido_em'],
  titulos_pagar: ['id', 'documento_recebido_id', 'status'], titulo_pagar_parcelas: ['id', 'titulo_id'], titulo_pagar_pagamentos: ['id', 'titulo_id'],
  contas_financeiras: ['id', 'nome', 'tipo', 'banco_codigo', 'agencia', 'agencia_dv', 'conta', 'ativa'],
  extrato_importacoes: ['id', 'conta_id', 'origem', 'status', 'periodo_inicio', 'periodo_fim', 'saldo_final', 'saldo_final_data', 'arquivo_id', 'nome_arquivo', 'linhas_lidas', 'novos', 'repetidos', 'criado_por', 'criado_em'],
  movimentos_bancarios: ['id', 'conta_id', 'importacao_id', 'data', 'competencia', 'valor', 'tipo', 'descricao', 'documento', 'identificador', 'tipo_banco', 'contrapartida_documento', 'contrapartida_tipo',
    'codigo_historico', 'codigo_sub_historico', 'sistema_pagamento', 'hash', 'estado_conciliacao', 'criado_em'],
  contabil_integracoes: ['id', 'chave', 'ativa', 'ambiente', 'automatica', 'intervalo_min', 'parametros', 'ultimo_nsu', 'max_nsu', 'proxima_consulta_apos', 'ultima_execucao_em', 'ultimo_sucesso_em', 'ultimo_erro', 'atualizado_em', 'atualizado_por'],
  contabil_integracao_execucoes: ['id', 'integracao', 'tipo', 'chave', 'maquina', 'usuario_id', 'iniciado_em', 'concluido_em', 'resumo', 'resultado', 'erro'],
  contabil_dfe_recebidos: ['id', 'origem', 'tipo', 'chave', 'nsu', 'resumo', 'numero', 'serie', 'municipio', 'emitente_documento', 'emitente_nome', 'data_emissao', 'valor', 'situacao_nota', 'xml', 'eventos',
    'manifestacao', 'manifestacao_em', 'manifestacao_protocolo', 'manifestacao_erro', 'status', 'documento_recebido_id', 'erro', 'ignorado_motivo', 'ignorado_por', 'ignorado_em', 'recebido_em', 'atualizado_em']
};

const UNICOS = {
  documentos_recebidos: (n, l) => n.chave_acesso && l.some(r => r.chave_acesso === n.chave_acesso && !r.excluido_em),
  contabil_arquivo_vinculos: (n, l) => l.some(r => String(r.arquivo_id) === String(n.arquivo_id) && r.alvo_tipo === n.alvo_tipo && String(r.alvo_id) === String(n.alvo_id)),
  movimentos_bancarios: (n, l) => l.some(r => String(r.conta_id) === String(n.conta_id) && r.hash === n.hash),
  contabil_integracao_execucoes: (n, l) => l.some(r => r.chave === n.chave),
  contabil_dfe_recebidos: (n, l) => l.some(r => r.origem === n.origem && r.chave === n.chave)
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
      const responder = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || [];
      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Not found' });
      }
      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [k, v] of url.searchParams.entries()) if (colunas.includes(k)) linhas = linhas.filter(r => String(r[k]) === String(v));
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const linha = {};
        for (const c of colunas) if (body?.[c] !== undefined) linha[c] = body[c];
        if (UNICOS[tabela]?.(linha, tabelas[tabela])) return responder(500, { error: 'duplicate key value violates unique constraint' });
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
        const i = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (i >= 0) tabelas[tabela].splice(i, 1);
        return responder(200, { sucesso: true });
      }
      return responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas };
}

// ------------------------------------------------------------------ a rede de mentira

const xmlNota = ch => `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00">`
  + `<ide><mod>55</mod><serie>1</serie><nNF>${Number(ch.slice(25, 34))}</nNF><dhEmi>2026-08-10T10:00:00-03:00</dhEmi><finNFe>1</finNFe><natOp>Venda</natOp></ide>`
  + '<emit><CNPJ>57248237000103</CNPJ><xNome>Vidros Norte LTDA</xNome><xFant>Vidros Norte</xFant><enderEmit><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>3118601</cMun><xMun>Contagem</xMun><UF>MG</UF><CEP>32000000</CEP></enderEmit><IE>0012345670011</IE></emit>'
  + `<dest><CNPJ>${EMPRESA}</CNPJ></dest>`
  + '<det nItem="1"><prod><cProd>V1</cProd><xProd>Vidro</xProd><NCM>70071900</NCM><CFOP>5102</CFOP><uCom>M2</uCom><qCom>1</qCom><vUnCom>300</vUnCom><vProd>300.00</vProd></prod></det>'
  + '<total><ICMSTot><vProd>300.00</vProd><vNF>300.00</vNF></ICMSTot></total>'
  + `</infNFe></NFe><protNFe><infProt><chNFe>${ch}</chNFe><nProt>131260000012345</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const resumo = ch => `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${ch}</chNFe><CNPJ>57248237000103</CNPJ><xNome>Vidros Norte LTDA</xNome><dhEmi>2026-08-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>300.00</vNF><cSitNFe>1</cSitNFe></resNFe>`;
const cancelamento = ch => `<resEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${ch}</chNFe><dhEvento>2026-08-12T09:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><xEvento>Cancelamento</xEvento><nProt>1</nProt></resEvento>`;
const retDist = ({ cStat = '138', ult, max, docs = [] }) => '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse><nfeDistDFeInteresseResult>'
  + `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>2</tpAmb><cStat>${cStat}</cStat><xMotivo>${cStat === '137' ? 'Nenhum documento localizado' : 'Documento localizado'}</xMotivo>`
  + `<ultNSU>${String(ult).padStart(15, '0')}</ultNSU><maxNSU>${String(max).padStart(15, '0')}</maxNSU>`
  + (docs.length ? `<loteDistDFeInt>${docs.map(d => `<docZip NSU="${String(d.nsu).padStart(15, '0')}" schema="${d.schema}">${gz(d.xml)}</docZip>`).join('')}</loteDistDFeInt>` : '')
  + '</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>';
const nfse = ({ ch = CHAVE_NFSE, tomador = EMPRESA, prestador = '12345678000199', numero = '123' } = {}) => `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infNFSe Id="NFS${ch}">`
  + `<xLocEmi>Belo Horizonte</xLocEmi><nNFSe>${numero}</nNFSe><dhProc>2026-08-20T10:00:00-03:00</dhProc><emit><CNPJ>${prestador}</CNPJ><xNome>Contabilidade Exata</xNome></emit>`
  + '<valores><vISSQN>42.50</vISSQN><vTotalRet>42.50</vTotalRet><vLiq>807.50</vLiq></valores>'
  + `<DPS versao="1.00"><infDPS Id="DPS1"><dhEmi>2026-08-20T09:00:00-03:00</dhEmi><prest><CNPJ>${prestador}</CNPJ></prest><toma><CNPJ>${tomador}</CNPJ></toma>`
  + '<serv><cServ><xDescServ>Honorários de agosto</xDescServ></cServ></serv><valores><vServPrest><vServ>850.00</vServ></vServPrest><trib><tribMun><tpRetISSQN>2</tpRetISSQN></tribMun></trib></valores></infDPS></DPS></infNFSe></NFSe>';
const json = (status, dados) => ({ status, corpo: Buffer.from(JSON.stringify(dados)) });

function redeDeMentira(chamadas) {
  return (cert, { destino } = {}) => async (url, { metodo = 'GET', corpo = null, cabecalhos = {} } = {}) => {
    const texto = String(corpo ?? '');
    chamadas.push({ url, metodo, corpo: texto, cabecalhos, comCertificado: Boolean(cert?.certificadoPem), destino });
    if (url.includes('NFeDistribuicaoDFe')) {
      if (texto.includes('<consChNFe>')) return { status: 200, corpo: Buffer.from(retDist({ ult: 3, max: 3, docs: [{ nsu: 9, schema: 'procNFe_v4.00.xsd', xml: xmlNota(CHAVE_A) }] })) };
      const ult = Number(/<ultNSU>(\d+)<\/ultNSU>/.exec(texto)?.[1] || 0);
      if (ult === 0) {
        return { status: 200, corpo: Buffer.from(retDist({ ult: 3, max: 3, docs: [
          { nsu: 1, schema: 'resNFe_v1.01.xsd', xml: resumo(CHAVE_A) }, { nsu: 2, schema: 'procNFe_v4.00.xsd', xml: xmlNota(CHAVE_B) }, { nsu: 3, schema: 'resEvento_v1.01.xsd', xml: cancelamento(CHAVE_C) }
        ] })) };
      }
      return { status: 200, corpo: Buffer.from(retDist({ cStat: '137', ult, max: ult })) };
    }
    if (url.includes('NFeRecepcaoEvento4')) {
      const ch = /<chNFe>(\d{44})<\/chNFe>/.exec(texto)?.[1];
      const tp = /<tpEvento>(\d+)<\/tpEvento>/.exec(texto)?.[1];
      return { status: 200, corpo: Buffer.from(`<soap:Envelope><soap:Body><nfeResultMsg><retEnvEvento><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento><infEvento><cStat>135</cStat><xMotivo>Evento registrado</xMotivo><chNFe>${ch}</chNFe><tpEvento>${tp}</tpEvento><nProt>891260000000777</nProt></infEvento></retEvento></retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>`) };
    }
    if (url.includes('adn.')) {
      if (/\/DFe\/0\?/.test(url)) {
        return json(200, { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [
          { NSU: 1, ChaveAcesso: CHAVE_NFSE, TipoDocumento: 'NFSE', ArquivoXml: gz(nfse()) },
          { NSU: 2, ChaveAcesso: CHAVE_NFSE_OUTRA, TipoDocumento: 'NFSE', ArquivoXml: gz(nfse({ ch: CHAVE_NFSE_OUTRA, tomador: '99999999000199', prestador: EMPRESA, numero: '9' })) }
        ] });
      }
      return json(404, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO' });
    }
    if (url.includes('/oauth/token')) return json(200, { access_token: 'tk', token_type: 'Bearer', expires_in: 600, scope: 'extrato-info' });
    if (url.includes('/v2/conta-corrente/')) {
      // Extratos v2: o identificador único só existe a partir de D-1 (a 2ª busca o traz numa linha que a 1ª trouxe sem).
      const jaTemId = chamadas.filter(x => x.url.includes('/v2/conta-corrente/')).length > 1;
      return json(200, { numeroPaginaAtual: 1, numeroPaginaProximo: 0, listaLancamento: [
        { indicadorTipoLancamento: '1', dataLancamento: 1082026, valorLancamento: 5000, codigoHistorico: 0, textoDescricaoSubHistorico: 'Saldo Anterior', numeroDocumento: 0, indicadorSinalLancamento: 'C' },
        { indicadorTipoLancamento: '1', dataLancamento: 5082026, valorLancamento: 2500, indicadorSinalLancamento: 'D', numeroDocumento: 123, textoDescricaoSubHistorico: 'Pagamento de boleto', numeroCadastroPessoaFisicaCadastroNacPessoasJuridicasContrapartida: '12345678000199', indicadorTipoPessoaContrapartida: 'J', codigoHistorico: 109, textoIdentificadorUnicoTransacao: 'T1' },
        { indicadorTipoLancamento: '1', dataLancamento: 20082026, valorLancamento: 1500, indicadorSinalLancamento: 'C', numeroDocumento: 7, textoDescricaoSubHistorico: 'Pix recebido', numeroISPB: 0, textoIdentificadorUnicoTransacao: jaTemId ? 'T2' : '' },
        { indicadorTipoLancamento: 'RA', dataLancamento: 31082026, valorLancamento: 300, indicadorSinalLancamento: 'C', textoDescricaoSubHistorico: 'Invest Resgate Autom' },
        { indicadorTipoLancamento: '1', dataLancamento: 31082026, valorLancamento: 4000, codigoHistorico: 999, textoDescricaoSubHistorico: 'S A L D O', numeroDocumento: 0, indicadorSinalLancamento: 'C' }
      ] });
    }
    return json(500, { erro: `rota de mentira sem resposta: ${url}` });
  };
}

// ------------------------------------------------------------------ montagem

const MODULOS = [
  './apiHttpClient', './permissionsController', './contabilidadeController', './contatosController', './historicoSocial', './contatoHistorico',
  './contabilidade/checklist', './contabilidade/fechamento', './contabilidade/base', './contabilidade/eventos', './contabilidade/arquivos',
  './contabilidade/titulos', './contabilidade/documentosRecebidos', './contabilidade/evidencias', './fiscal/configuracaoFiscal',
  './contabilidade/extrato/extrato', './contabilidade/integracoes/rotas', './contabilidade/integracoes/servico', './contabilidade/integracoes/configuracao',
  './contabilidade/integracoes/entrada', './contabilidade/integracoes/execucoes', './contabilidade/integracoes/segredos'
];

/**
 * As notas de mentira são de agosto/2026: os cenários antigos começam a
 * Contabilidade em agosto (tudo "dentro"); `inicio` troca isso para testar
 * a janela (setembro: agosto espera a decisão; outubro: agosto fica de fora).
 */
function cenario(extra = {}, { inicio = '2026-08' } = {}) {
  const linha = (id, chave, parametros, intervalo) => ({ id, chave, ativa: false, ambiente: 'homologacao', automatica: false, intervalo_min: intervalo, parametros: JSON.stringify(parametros) });
  return {
    pedidos: [], notas_fiscais: [], notas_devolucao: [], configuracao_fiscal: [{ id: 1, cnpj: EMPRESA, uf: 'MG', razao_social: 'Santissimo' }], configuracao_cobranca: [],
    financeiro_fechamentos: [], financeiro_fechamento_itens: [], financeiro_pagamentos: [], usuarios: [{ id: 3, nome: 'Henrique' }],
    contatos: [], contato_tipos: [{ id: 1, nome: 'Fornecedor' }, { id: 2, nome: 'Prestador de serviço' }], contato_pessoas: [], contato_historico: [],
    competencia_contabil: [], contabil_pendencias_resolucoes: [], contabil_eventos: [],
    contabil_arquivos: [], contabil_arquivo_partes: [], contabil_arquivo_vinculos: [], documentos_recebidos: [], titulos_pagar: [], titulo_pagar_parcelas: [], titulo_pagar_pagamentos: [],
    contas_financeiras: [{ id: 1, nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1614', agencia_dv: '4', conta: '167738', ativa: true }],
    extrato_importacoes: [], movimentos_bancarios: [],
    contabil_integracoes: [
      linha(1, 'sefaz_nfe', { manifestar_ciencia: true, registrar_automaticamente: true, gerar_conta: false, primeira_competencia: inicio }, 60),
      linha(2, 'bb_extrato', { usar_credenciais_da_cobranca: true, escopo: 'extrato-info', mtls: 'auto', dias_para_tras: 5 }, 1440),
      linha(3, 'nfse_adn', { registrar_automaticamente: true, gerar_conta: false, lote: true, primeira_competencia: inicio }, 180),
      linha(4, 'bb_investimentos', { usar_credenciais_da_cobranca: true, mtls: 'auto' }, 1440)
    ],
    contabil_integracao_execucoes: [], contabil_dfe_recebidos: [],
    ...extra
  };
}

const PFX = gerarPfx({ cn: `SANTISSIMO DECOR LTDA:${EMPRESA}` });

async function montar(dados, { permitir = true } = {}) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  require('./cobranca/configuracaoCobranca').limparCache?.();
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
      limparCachePermissoes: () => {}
    }
  };
  const segredosBanco = { certificado: { pfxBase64: PFX.toString('base64'), senha: 'segredo' } };
  const banco = {
    disponivel: true,
    ler: async (_api, nome) => (segredosBanco[nome] ? { valor: segredosBanco[nome], atualizadoEm: '2026-09-01T00:00:00Z' } : null),
    guardar: async (_api, nome, valor) => { segredosBanco[nome] = valor; return true; },
    remover: async (_api, nome) => { delete segredosBanco[nome]; return true; }
  };
  const cofre = { temCofre: true, fonte: () => null, lerSegredo: () => null, guardarSegredo: () => true, removerSegredo: () => true };
  const chamadas = [];
  const servico = require('./contabilidade/integracoes/servico').criar({ env: { BANCO: 'DEV' }, cofre, banco, transporteFabrica: redeDeMentira(chamadas), agora: () => AGORA });
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api/contabilidade', require('./contabilidade/integracoes/rotas').criarRouter({ servico }));
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
    chamar, tabelas: upstream.tabelas, chamadas, segredosBanco,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

const naEntrada = (ctx, ch) => ctx.tabelas.contabil_dfe_recebidos.find(l => l.chave === ch);

test('SEFAZ: resumo ganha ciência, a completa é registrada sozinha, o cancelamento marca a nota; NSU anda e a espera de 1 hora vale até para o botão', async () => {
  const ctx = await montar(cenario());
  try {
    const antes = await ctx.chamar('GET', '/integracoes');
    assert.equal(antes.status, 200);
    const sefaz = antes.corpo.integracoes.find(i => i.chave === 'sefaz_nfe');
    assert.deepEqual([sefaz.pronta, sefaz.ambiente, sefaz.grava_no_banco, sefaz.pendencias], [true, 'homologacao', true, []]);
    assert.deepEqual([antes.corpo.certificado.configurado, antes.corpo.certificado.cnpj], [true, EMPRESA]);
    assert.equal(antes.corpo.pode_editar, true);

    assert.equal((await ctx.chamar('PUT', '/integracoes/sefaz_nfe', { ativa: true })).status, 200);
    const r = await ctx.chamar('POST', '/integracoes/sefaz_nfe/sincronizar', {});
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(r.corpo.resumo, /3 documentos da SEFAZ · 1 NF-e nova \(resumo\) · 1 XML completo · 1 ciência dada · 1 registrada nos documentos · 1 cancelamento/);

    const a = naEntrada(ctx, CHAVE_A);
    assert.deepEqual([a.status, a.manifestacao, a.manifestacao_protocolo, a.emitente_nome, Number(a.valor)], ['nova', 'ciencia', '891260000000777', 'Vidros Norte LTDA', 300]);
    const b = naEntrada(ctx, CHAVE_B);
    assert.equal(b.status, 'registrada');
    const docB = ctx.tabelas.documentos_recebidos.find(d => d.chave_acesso === CHAVE_B);
    assert.deepEqual([docB.origem, docB.tipo, docB.competencia, b.documento_recebido_id], ['sefaz', 'nfe', '2026-08', docB.id]);
    assert.ok(ctx.tabelas.contabil_arquivos.some(x => x.categoria === 'xml_nfe' && x.origem === 'oficial'), 'o XML da SEFAZ é o oficial');
    const cNota = naEntrada(ctx, CHAVE_C);
    assert.deepEqual([cNota.situacao_nota, cNota.status], ['cancelada', 'nova']);

    const evento = ctx.chamadas.find(x => x.url.includes('NFeRecepcaoEvento4'));
    assert.match(evento.corpo, /<cOrgao>91<\/cOrgao>.*<tpEvento>210210<\/tpEvento>.*<descEvento>Ciencia da Operacao<\/descEvento>.*<Signature/s);
    assert.ok(ctx.chamadas.every(x => x.comCertificado), 'SEFAZ e Ambiente Nacional só com o certificado da empresa');
    const linha = ctx.tabelas.contabil_integracoes.find(x => x.chave === 'sefaz_nfe');
    assert.equal(linha.ultimo_nsu, '000000000000003');
    assert.equal(new Date(linha.proxima_consulta_apos).getTime(), AGORA + 60 * 60 * 1000, 'ultNSU = maxNSU: espera de 1 hora');
    assert.ok(ctx.tabelas.contabil_eventos.some(e => e.tipo === 'nfe_manifestada') && ctx.tabelas.contabil_eventos.some(e => e.tipo === 'documento_registrado'));

    const redeAntes = ctx.chamadas.length;
    const deNovo = await ctx.chamar('POST', '/integracoes/sefaz_nfe/sincronizar', {});
    assert.equal(deNovo.corpo.situacao, 'aguardando');
    assert.match(deNovo.corpo.resumo, /1 hora entre consultas/);
    assert.equal(ctx.chamadas.length, redeAntes, 'na espera nem chega a falar com a SEFAZ');

    // O painel da competência: A ainda está fora dos documentos (documental).
    const painel = await ctx.chamar('GET', '/painel?competencia=2026-08');
    const pend = painel.corpo.pendencias.find(p => p.chave === 'entrada_pendente');
    assert.ok(pend, JSON.stringify(painel.corpo.pendencias.map(p => p.chave)));
    assert.deepEqual([pend.nivel, pend.filtro], ['documental', { acao: 'entrada-dfe' }]);

    const baixou = await ctx.chamar('POST', `/entrada/${a.id}/baixar-xml`, {});
    assert.equal(baixou.status, 200, JSON.stringify(baixou.corpo));
    assert.equal(naEntrada(ctx, CHAVE_A).status, 'registrada');
    assert.match(ctx.chamadas.at(-1).corpo, new RegExp(`<consChNFe><chNFe>${CHAVE_A}</chNFe></consChNFe>`));
    const painelDepois = await ctx.chamar('GET', '/painel?competencia=2026-08');
    assert.ok(!painelDepois.corpo.pendencias.some(p => p.chave === 'entrada_pendente'), 'C é cancelada: não conta');

    const cancelada = await ctx.chamar('POST', `/entrada/${cNota.id}/registrar`, {});
    assert.deepEqual([cancelada.status, cancelada.corpo.error], [409, 'A nota foi cancelada pelo emitente: não entra nos documentos.']);
    assert.equal((await ctx.chamar('POST', `/entrada/${cNota.id}/ignorar`, { motivo: 'curto' })).status, 200);
    assert.equal(naEntrada(ctx, CHAVE_C).status, 'ignorada');
    assert.equal((await ctx.chamar('POST', `/entrada/${cNota.id}/restaurar`, {})).corpo.status, 'nova');
    const lista = await ctx.chamar('GET', '/entrada?visao=todas');
    assert.deepEqual(lista.corpo.linhas.map(l => [l.chave, l.status]).sort(), [[CHAVE_A, 'registrada'], [CHAVE_B, 'registrada'], [CHAVE_C, 'nova']].sort());
    const xml = await ctx.chamar('GET', `/entrada/${a.id}/xml`);
    assert.match(Buffer.from(xml.corpo.base64, 'base64').toString('utf8'), /<nfeProc/);
    assert.ok(ctx.tabelas.contabil_integracao_execucoes.length >= 2);
  } finally {
    await ctx.encerrar();
  }
});

test('ADN: a NFS-e tomada entra nos documentos com o XML oficial e o ISS retido; a prestada fica de fora; o NSU anda', async () => {
  const ctx = await montar(cenario());
  try {
    // Desligada, a busca manual não roda (o teste de conexão, sim).
    const desligada = await ctx.chamar('POST', '/integracoes/nfse_adn/sincronizar', {});
    assert.equal(desligada.status, 409);
    assert.deepEqual(desligada.corpo.pendencias, ['Ligue a integração (marque "Ligada" no cartão de NFS-e tomadas (ADN nacional) e salve).']);
    assert.equal(ctx.chamadas.length, 0, 'nada foi ao ADN');
    await ctx.chamar('PUT', '/integracoes/nfse_adn', { ativa: true });
    const r = await ctx.chamar('POST', '/integracoes/nfse_adn/sincronizar', {});
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(r.corpo.resumo, /2 documentos do ADN · 1 NFS-e tomada · 1 registrada nos documentos/);
    const doc = ctx.tabelas.documentos_recebidos[0];
    assert.deepEqual([ctx.tabelas.documentos_recebidos.length, doc.tipo, doc.origem, doc.numero, doc.municipio, doc.emitente_documento, doc.valor_total, doc.valor_iss, doc.iss_retido, doc.competencia],
      [1, 'nfse', 'adn', '123', 'Belo Horizonte', '12345678000199', 850, 42.5, true, '2026-08']);
    assert.ok(ctx.tabelas.contabil_arquivos.some(x => x.categoria === 'nfse' && x.origem === 'oficial' && x.nome_arquivo === `NFSe-${CHAVE_NFSE}.xml`));
    assert.equal(ctx.tabelas.contabil_integracoes.find(x => x.chave === 'nfse_adn').ultimo_nsu, '2');
    const adn = ctx.chamadas.filter(x => x.url.includes('adn.'));
    assert.deepEqual(adn.map(x => new URL(x.url).pathname + new URL(x.url).search), ['/contribuintes/DFe/0?lote=true', '/contribuintes/DFe/2?lote=true']);
    assert.ok(adn.every(x => x.comCertificado && x.metodo === 'GET'));
  } finally {
    await ctx.encerrar();
  }
});

test('A Contabilidade começa em setembro: as notas de agosto esperam a decisão (registrar ou guardar como histórico); as de antes não entram', async () => {
  const ctx = await montar(cenario({}, { inicio: '2026-09' }));
  try {
    await ctx.chamar('PUT', '/integracoes/sefaz_nfe', { ativa: true });
    const r = await ctx.chamar('POST', '/integracoes/sefaz_nfe/sincronizar', {});
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(r.corpo.resumo, /1 ciência dada · 1 cancelamento · 2 notas de agosto\/2026 esperam a sua decisão na caixa de entrada/);
    assert.ok(!/registrada nos documentos/.test(r.corpo.resumo), 'nada de agosto é registrado sozinho');
    assert.equal(ctx.tabelas.documentos_recebidos.length, 0);
    // A ciência continua (é ela que libera o XML para quem quiser registrar).
    assert.equal(naEntrada(ctx, CHAVE_A).manifestacao, 'ciencia');

    const lista = await ctx.chamar('GET', '/entrada?visao=pendentes');
    const b = lista.corpo.linhas.find(l => l.chave === CHAVE_B);
    assert.deepEqual([b.decidir, b.pode.historico, b.pode.registrar], [true, true, true]);
    assert.match(b.decidir_texto, /^De agosto\/2026, antes do início da Contabilidade \(setembro\/2026\): registre ou guarde como histórico\.$/);

    // Guardar como histórico: sai das pendências, com o rótulo "Histórico"; Restaurar traz de volta.
    const hist = await ctx.chamar('POST', `/entrada/${b.id}/historico`, {});
    assert.equal(hist.status, 200, JSON.stringify(hist.corpo));
    assert.deepEqual([naEntrada(ctx, CHAVE_B).status, naEntrada(ctx, CHAVE_B).ignorado_motivo], ['ignorada', 'Histórico: de agosto/2026, antes do início da Contabilidade (setembro/2026).']);
    const ignoradas = await ctx.chamar('GET', '/entrada?visao=ignoradas');
    assert.deepEqual(ignoradas.corpo.linhas.map(l => [l.chave, l.status_rotulo, l.historico]), [[CHAVE_B, 'Histórico', true]]);
    assert.ok(ctx.tabelas.contabil_eventos.some(e => /guardada como histórico/.test(e.descricao)));
    assert.equal((await ctx.chamar('POST', `/entrada/${b.id}/historico`, {})).status, 409, 'de novo, não');
    assert.equal((await ctx.chamar('POST', `/entrada/${b.id}/restaurar`, {})).corpo.status, 'completa');

    // Registrar à mão continua valendo para a nota de agosto.
    const reg = await ctx.chamar('POST', `/entrada/${b.id}/registrar`, {});
    assert.equal(reg.status, 200, JSON.stringify(reg.corpo));
    assert.equal(ctx.tabelas.documentos_recebidos[0].competencia, '2026-08');

    // "Baixar XML" da nota de agosto traz o XML, mas não registra sozinho.
    const a = naEntrada(ctx, CHAVE_A);
    const baixou = await ctx.chamar('POST', `/entrada/${a.id}/baixar-xml`, {});
    assert.deepEqual([baixou.status, baixou.corpo.registrado, naEntrada(ctx, CHAVE_A).status], [200, null, 'completa']);
  } finally {
    await ctx.encerrar();
  }
});

test('A Contabilidade começa em outubro: a NFS-e de agosto (antes de setembro) nem entra na caixa', async () => {
  const ctx = await montar(cenario({}, { inicio: '2026-10' }));
  try {
    await ctx.chamar('PUT', '/integracoes/nfse_adn', { ativa: true });
    const r = await ctx.chamar('POST', '/integracoes/nfse_adn/sincronizar', {});
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(r.corpo.resumo, /2 documentos do ADN · 1 nota de antes de setembro\/2026 ficou de fora/);
    assert.equal(ctx.tabelas.contabil_dfe_recebidos.length, 0);
    assert.equal(ctx.tabelas.contabil_integracoes.find(x => x.chave === 'nfse_adn').ultimo_nsu, '2', 'o NSU anda mesmo assim');
  } finally {
    await ctx.encerrar();
  }
});

test('BB (Extratos v2): credenciais próprias no cofre, conta de teste com o código dela e o certificado na homologação; o extrato do mês entra pela API e buscar de novo não repete', async () => {
  const ctx = await montar(cenario());
  try {
    const salvar = await ctx.chamar('PUT', '/integracoes/bb_extrato', {
      ativa: true,
      parametros: { usar_credenciais_da_cobranca: false, client_id_homologacao: 'cid', app_key_homologacao: 'app', conta_id: 1, agencia: '1614', conta: '16773', homologacao_agencia: '452', homologacao_conta: '123873' }
    });
    assert.equal(salvar.status, 200, JSON.stringify(salvar.corpo));
    const semSecret = salvar.corpo.integracoes.find(i => i.chave === 'bb_extrato');
    assert.deepEqual(semSecret.pendencias, ['Sem client_secret de homologação guardado.']);
    assert.equal((await ctx.chamar('POST', '/integracoes/bb_extrato/sincronizar', { competencia: '2026-08' })).status, 409);
    const guardou = await ctx.chamar('POST', '/integracoes/bb_extrato/credenciais', { ambiente: 'homologacao', client_secret: 'sec', destino: 'banco' });
    assert.equal(guardou.status, 200);
    assert.deepEqual(ctx.segredosBanco.bb_extrato_client_secret_homologacao, { secret: 'sec' });
    const bb = guardou.corpo.integracoes.find(i => i.chave === 'bb_extrato');
    assert.deepEqual([bb.pronta, bb.credenciais.secret_guardado, bb.credenciais.origem], [true, true, 'propria']);
    assert.ok(!JSON.stringify(guardou.corpo).includes('"sec"'), 'o secret nunca volta numa resposta');

    const r = await ctx.chamar('POST', '/integracoes/bb_extrato/sincronizar', { competencia: '2026-08' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual([r.corpo.periodo, r.corpo.novos, r.corpo.gravou], [{ inicio: '2026-08-01', fim: '2026-08-31' }, 2, true]);
    const token = ctx.chamadas.find(x => x.url.includes('/oauth/token'));
    assert.equal(token.cabecalhos.Authorization, `Basic ${Buffer.from('cid:sec').toString('base64')}`);
    const chamadaBB = ctx.chamadas.find(x => x.url.includes('/v2/conta-corrente/'));
    const consulta = new URL(chamadaBB.url);
    assert.equal(`${consulta.host}${consulta.pathname}`, 'extratos.mtls.api.hm.bb.com.br/v2/conta-corrente/agencia/452/conta/123873', 'na homologação, a conta de teste');
    assert.deepEqual([consulta.searchParams.get('dataInicioSolicitacao'), consulta.searchParams.get('dataFimSolicitacao'), consulta.searchParams.get('gw-dev-app-key')], ['1082026', '31082026', 'app']);
    assert.equal(chamadaBB.cabecalhos['x-br-com-bb-ipa-mciteste'], '704950857', 'o código da conta de teste 452 / 123873');
    assert.ok(ctx.chamadas.filter(x => x.destino === 'o Banco do Brasil').every(x => x.comCertificado), 'a v2 leva o certificado também na homologação');
    const [boleto, pix] = ctx.tabelas.movimentos_bancarios;
    assert.deepEqual([boleto.data, boleto.valor, boleto.documento, boleto.contrapartida_documento, boleto.contrapartida_tipo, boleto.codigo_historico, boleto.tipo_banco, boleto.identificador], ['2026-08-05', -2500, '123', '12345678000199', 'J', '109', 'API', 'T1']);
    assert.deepEqual([pix.valor, pix.sistema_pagamento, pix.competencia, pix.identificador], [1500, '0', '2026-08', null]);
    const imp = ctx.tabelas.extrato_importacoes[0];
    assert.deepEqual([imp.origem, imp.periodo_inicio, imp.periodo_fim, imp.saldo_final, imp.novos], ['api', '2026-08-01', '2026-08-31', 4000, 2]);
    assert.ok(ctx.tabelas.contabil_arquivos.some(x => x.categoria === 'extrato' && x.tipo_mime === 'application/json' && x.origem === 'oficial'), 'a resposta do mês fica como evidência');

    // A 2ª busca traz o Pix já com o identificador do BB (nasce em D-1): continua sendo a mesma linha.
    const deNovo = await ctx.chamar('POST', '/integracoes/bb_extrato/sincronizar', { competencia: '2026-08' });
    assert.deepEqual([deNovo.corpo.novos, deNovo.corpo.repetidos, ctx.tabelas.movimentos_bancarios.length], [0, 2, 2]);

    const teste = await ctx.chamar('POST', '/integracoes/bb_extrato/testar', {});
    assert.equal(teste.status, 200, JSON.stringify(teste.corpo));
    assert.match(teste.corpo.resumo, /com o certificado da empresa.*conta de teste do BB 452 \/ 123873.*2 lançamentos.*Invest Resgate Autom.*Nada foi gravado/s);
  } finally {
    await ctx.encerrar();
  }
});

test('SEFAZ com o mês fechado (30/09/2026): a nota fica na caixa com o motivo e a integração não fica "com erro"; a cancelada nunca registrada não é pendente', async () => {
  const ctx = await montar(cenario({ competencia_contabil: [{ id: 1, competencia: '2026-08', status: 'fechada' }] }));
  try {
    await ctx.chamar('PUT', '/integracoes/sefaz_nfe', { ativa: true });
    const r = await ctx.chamar('POST', '/integracoes/sefaz_nfe/sincronizar', {});
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(r.corpo.resumo, /1 não registrada \(o motivo está na caixa de entrada\)/);
    assert.doesNotMatch(r.corpo.resumo, /erro/);
    const b = naEntrada(ctx, CHAVE_B);
    assert.equal(b.status, 'completa');
    assert.match(b.erro, /agosto\/2026 está fechada/);
    assert.equal(ctx.tabelas.contabil_integracoes.find(l => l.chave === 'sefaz_nfe').ultimo_erro, null);
    const pend = await ctx.chamar('GET', '/entrada?visao=pendentes');
    assert.deepEqual(pend.corpo.linhas.map(l => l.chave).sort(), [CHAVE_A, CHAVE_B].sort(), 'C (cancelada, nunca registrada) fora das pendentes');
    assert.equal(pend.corpo.linhas.find(l => l.chave === CHAVE_B).pode.registrar, true, 'depois de reabrir o mês, registra-se pela linha');
  } finally {
    await ctx.encerrar();
  }
});

test('estado, certificado público, CDB fora de uso, produção só com a palavra e permissões', async () => {
  const ctx = await montar(cenario(), { permitir: ['contabilidade.view', 'contabilidade.config.view'] });
  try {
    const cer = await ctx.chamar('GET', '/integracoes/certificado/publico');
    assert.equal(cer.status, 200);
    assert.match(Buffer.from(cer.corpo.base64, 'base64').toString('utf8'), /^-----BEGIN CERTIFICATE-----/);
    assert.equal(cer.corpo.cnpj, EMPRESA);
    assert.ok(!Buffer.from(cer.corpo.base64, 'base64').toString('utf8').includes('PRIVATE KEY'), 'sem a chave privada');
    // O CDB ficou fora de uso (02/10/2026: as aplicações entram pelos PDFs): sem pendências, não testa, não liga.
    const estado = await ctx.chamar('GET', '/integracoes');
    const cartaoCdb = estado.corpo.integracoes.find(i => i.chave === 'bb_investimentos');
    assert.deepEqual([cartaoCdb.pendencias, Boolean(cartaoCdb.fora_de_uso)], [[], true]);
    const cdb = await ctx.chamar('POST', '/integracoes/bb_investimentos/testar', {});
    assert.equal(cdb.status, 409);
    assert.match(cdb.corpo.error, /^Fora de uso: o Rende Fácil e o CDB vão entrar pelos PDFs/);
    const ligarCdb = await ctx.chamar('PUT', '/integracoes/bb_investimentos', { ativa: true });
    assert.deepEqual([ligarCdb.status, ligarCdb.corpo.error], [400, 'Aplicações — CDB (BB): está fora de uso e não se liga']);
    const semPalavra = await ctx.chamar('PUT', '/integracoes/sefaz_nfe', { ambiente: 'producao' });
    assert.deepEqual([semPalavra.status, semPalavra.corpo.error], [400, 'Para ligar a produção, confirme digitando PRODUCAO.']);
    const comPalavra = await ctx.chamar('PUT', '/integracoes/sefaz_nfe', { ambiente: 'producao', confirmacao: 'PRODUCAO' });
    assert.equal(comPalavra.corpo.integracoes.find(i => i.chave === 'sefaz_nfe').ambiente, 'producao');
    assert.deepEqual((await ctx.chamar('POST', '/integracoes/sefaz_nfe/sincronizar', {})).corpo.pedidas, ['contabilidade.documento.registrar']);
    assert.deepEqual((await ctx.chamar('POST', '/integracoes/bb_extrato/sincronizar', {})).corpo.pedidas, ['contabilidade.extrato.importar']);
    assert.equal((await ctx.chamar('POST', '/integracoes/pix/testar', {})).status, 404);
    assert.equal((await ctx.chamar('GET', '/entrada')).status, 200);
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL das integrações: a tela diz qual arquivo rodar', async () => {
  const dados = cenario();
  delete dados.contabil_integracoes;
  delete dados.contabil_integracao_execucoes;
  delete dados.contabil_dfe_recebidos;
  const ctx = await montar(dados);
  try {
    const r = await ctx.chamar('GET', '/integracoes');
    assert.equal(r.corpo.sql_pendente, true);
    assert.deepEqual(r.corpo.integracoes[0].pendencias, ['Falta rodar sql/contabilidade_integracoes.sql e reiniciar a API.']);
    const s = await ctx.chamar('POST', '/integracoes/sefaz_nfe/sincronizar', {});
    assert.deepEqual([s.status, s.corpo.sql_arquivo], [409, 'sql/contabilidade_integracoes.sql']);
    assert.equal((await ctx.chamar('GET', '/entrada')).corpo.sql_pendente, true);
  } finally {
    await ctx.encerrar();
  }
});
