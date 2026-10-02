/**
 * A configuração de cada integração (tabela contabil_integracoes, uma linha
 * por chave — sql/contabilidade_integracoes.sql): ligada ou não, ambiente,
 * busca automática, intervalo e os parâmetros (jsonb) de cada uma.
 *
 * AMBIENTE — como na NF-e e na cobrança, duas travas e a mais restritiva
 * vence: o que o Sup Admin escolheu na tela (vale para todos) e o .env desta
 * máquina, que prende em homologação (NFE_AMBIENTE=homologacao para SEFAZ e
 * ADN, BB_AMBIENTE=sandbox|homologacao para o BB, ou
 * CONTABILIDADE_INTEGRACOES_AMBIENTE=homologacao para todas). O .env nunca
 * liga a produção sozinho.
 *
 * Sem a tabela (SQL não rodou), `carregar` devolve null e a tela diz o que
 * rodar.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const catalogo = require('./catalogo');

const { HOMOLOGACAO, PRODUCAO } = catalogo;

/** Linhas → Map(chave → linha com `parametros` já como objeto). null = falta o SQL. */
async function carregar(api) {
  const linhas = await b.lerOpcional(api, 'contabil_integracoes');
  if (linhas === null) return null;
  return new Map(linhas.filter(l => l && catalogo.INTEGRACOES[l.chave]).map(l => [l.chave, { ...l, parametros: c.jsonDe(l.parametros, {}) || {} }]));
}

/** Os parâmetros que valem: os padrões do catálogo por baixo do que foi gravado. */
function parametros(def, linha) {
  return { ...catalogo.padroes(def), ...(linha?.parametros || {}) };
}

/** O ambiente que VALE nesta máquina para a integração. Pura. */
function ambienteEfetivo(def, linha, env = process.env) {
  const doBanco = String(linha?.ambiente || HOMOLOGACAO).toLowerCase() === PRODUCAO ? PRODUCAO : HOMOLOGACAO;
  const geral = String(env.CONTABILIDADE_INTEGRACOES_AMBIENTE || '').trim().toLowerCase();
  if (geral === HOMOLOGACAO) return HOMOLOGACAO;
  if (def.banco) {
    const bb = String(env.BB_AMBIENTE || '').trim().toLowerCase();
    if (bb === 'sandbox' || bb === HOMOLOGACAO) return HOMOLOGACAO;
  } else if (String(env.NFE_AMBIENTE || '').trim().toLowerCase() === HOMOLOGACAO) {
    return HOMOLOGACAO;
  }
  return doBanco;
}

/** A máquina está presa em homologação para esta integração? Pura. */
function travadaEmHomologacao(def, env = process.env) {
  return ambienteEfetivo(def, { ambiente: PRODUCAO }, env) === HOMOLOGACAO;
}

/** O campo aparece com os parâmetros atuais? (`quando`) Pura. */
function campoVale(campo, params) {
  if (!campo.quando) return true;
  return Object.entries(campo.quando).every(([k, v]) => params?.[k] === v);
}

/** Um valor de campo conferido: `{ valor }` ou `{ erro }`. Pura. */
function validarCampo(campo, bruto) {
  const texto = bruto === null || bruto === undefined ? '' : String(bruto).trim();
  switch (campo.tipo) {
    case 'booleano':
      if (typeof bruto === 'boolean') return { valor: bruto };
      if (!texto) return { valor: campo.padrao === true };
      if (!['true', 'false', '1', '0', 'sim', 'nao', 'não'].includes(texto.toLowerCase())) return { erro: `${campo.rotulo}: use sim ou não` };
      return { valor: ['true', '1', 'sim'].includes(texto.toLowerCase()) };
    case 'texto':
      if (texto.length > (campo.max || 500)) return { erro: `${campo.rotulo}: passa de ${campo.max || 500} caracteres` };
      return { valor: texto || null };
    case 'digitos': {
      // Agência e conta vão sem o dígito: "1614-4" vira "1614" (não "16144").
      const d = (campo.semDv ? texto.split('-')[0] : texto).replace(/\D/g, '');
      if (texto && !d) return { erro: `${campo.rotulo}: só números` };
      if (campo.max && d.length > campo.max) return { erro: `${campo.rotulo}: passa de ${campo.max} dígitos` };
      return { valor: d || null };
    }
    case 'inteiro': {
      if (!texto) return { valor: campo.padrao ?? null };
      const n = Number(texto);
      if (!Number.isInteger(n) || n < campo.min || n > campo.max) return { erro: `${campo.rotulo}: um número inteiro de ${campo.min} a ${campo.max}` };
      return { valor: n };
    }
    case 'opcao':
      if (!texto) return { valor: campo.padrao ?? null };
      if (!Object.prototype.hasOwnProperty.call(campo.opcoes, texto)) return { erro: `${campo.rotulo}: opção inválida` };
      return { valor: texto };
    case 'conta': {
      if (!texto) return { valor: null };
      const n = Number(texto);
      if (!Number.isInteger(n) || n <= 0) return { erro: `${campo.rotulo}: escolha uma conta` };
      return { valor: n };
    }
    case 'url':
      if (!texto) return { valor: null };
      if (!/^https:\/\/[^\s]+$/i.test(texto) || texto.length > 300) return { erro: `${campo.rotulo}: um endereço https:// completo` };
      return { valor: texto.replace(/\/+$/, '') };
    default:
      return { erro: `${campo.rotulo}: tipo desconhecido` };
  }
}

/**
 * Confere o que a tela mandou: `{ ativa, ambiente, automatica, intervalo_min,
 * parametros }`. Devolve `{ valores, erros }` — `valores` já com os
 * parâmetros juntos aos gravados. Pura.
 */
function validar(def, entrada = {}, atual = null) {
  const erros = [];
  const valores = {};
  if (entrada.ativa !== undefined) valores.ativa = entrada.ativa === true || entrada.ativa === 'true';
  if (entrada.ambiente !== undefined) {
    if (!catalogo.AMBIENTES.includes(entrada.ambiente)) erros.push('Ambiente: homologação ou produção');
    else valores.ambiente = entrada.ambiente;
  }
  if (entrada.automatica !== undefined) {
    const auto = entrada.automatica === true || entrada.automatica === 'true';
    if (auto && !def.automatica) erros.push(`${def.nome}: ainda não há busca automática`);
    else valores.automatica = auto;
  }
  if (entrada.intervalo_min !== undefined && entrada.intervalo_min !== null && entrada.intervalo_min !== '') {
    const n = Number(entrada.intervalo_min);
    if (!Number.isInteger(n) || n < def.intervalo.min || n > def.intervalo.max) erros.push(`Intervalo: de ${def.intervalo.min} a ${def.intervalo.max} minutos`);
    else valores.intervalo_min = n;
  }
  if (entrada.parametros !== undefined) {
    if (!entrada.parametros || typeof entrada.parametros !== 'object' || Array.isArray(entrada.parametros)) {
      erros.push('Parâmetros inválidos');
    } else {
      const novos = { ...(atual?.parametros || {}) };
      const conhecidos = new Set();
      for (const campo of def.campos) {
        const chaves = campo.porAmbiente ? catalogo.AMBIENTES.map(a => catalogo.campoDoAmbiente(campo.chave, a)) : [campo.chave];
        for (const chave of chaves) {
          conhecidos.add(chave);
          if (!Object.prototype.hasOwnProperty.call(entrada.parametros, chave)) continue;
          const r = validarCampo(campo, entrada.parametros[chave]);
          if (r.erro) erros.push(r.erro);
          else novos[chave] = r.valor;
        }
      }
      for (const chave of Object.keys(entrada.parametros)) if (!conhecidos.has(chave)) erros.push(`"${chave}" não é um parâmetro de ${def.nome}`);
      valores.parametros = novos;
    }
  }
  return { valores, erros };
}

/** Grava (a linha nasce no SQL; sem ela, 409). */
async function gravar(api, def, valores, usuarioId = null) {
  const linhas = await carregar(api);
  if (linhas === null) throw c.erro(b.SQL_FALTANDO_INTEGRACOES, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_INTEGRACOES });
  const atual = linhas.get(def.chave);
  const campos = { ...valores, atualizado_em: c.agora(), atualizado_por: usuarioId };
  // jsonb pela API genérica: vai como texto JSON (lista viraria array do Postgres).
  if (campos.parametros) campos.parametros = JSON.stringify(campos.parametros);
  if (atual) await b.atualizar(api, 'contabil_integracoes', atual.id, campos);
  else await b.inserir(api, 'contabil_integracoes', { chave: def.chave, ...campos, parametros: campos.parametros || '{}' });
  return (await carregar(api)).get(def.chave);
}

/** Onde a busca parou e como foi (NSU, último erro…). Falha aqui não derruba quem chamou. */
async function atualizarEstado(api, linha, campos) {
  if (!linha?.id) return;
  try {
    await b.atualizar(api, 'contabil_integracoes', linha.id, campos);
  } catch (e) {
    console.warn('[contabilidade/integracoes] estado não gravado:', e?.message || e);
  }
}

/**
 * O que falta para a integração funcionar no ambiente. `ctx` traz o que o
 * serviço já leu: certificado (resumo), fiscal (cnpj/uf), credenciais BB
 * ({ clientId, appKey, secret }), contas do banco. Pura.
 */
function pendencias(def, { linha, params, ambiente, certificado = null, fiscal = null, credenciais = null, contas = [] } = {}) {
  const faltas = [];
  const nomeAmb = ambiente === PRODUCAO ? 'produção' : 'homologação';
  if (!linha) return ['Falta rodar sql/contabilidade_integracoes.sql e reiniciar a API.'];
  if (def.usa.includes('certificado')) {
    if (!certificado?.configurado) faltas.push(`Certificado digital A1 da empresa não encontrado${certificado?.erro ? ` (${certificado.erro})` : ''}: cadastre em Financeiro › Configuração fiscal.`);
    else if (certificado.vencido) faltas.push('O certificado digital está vencido: renove e cadastre o novo na Configuração fiscal.');
  }
  if (def.usa.includes('configuracao_fiscal')) {
    if (!fiscal?.cnpj) faltas.push('A Configuração fiscal não tem o CNPJ da empresa.');
    if (def.chave === 'sefaz_nfe' && !fiscal?.uf) faltas.push('A Configuração fiscal não tem a UF da empresa.');
    if (certificado?.configurado && fiscal?.cnpj && certificado.cnpj && String(certificado.cnpj).slice(0, 8) !== String(fiscal.cnpj).slice(0, 8)) {
      faltas.push(`O certificado é de outro CNPJ (${b.documentoFormatado(certificado.cnpj)}): a busca exige o e-CNPJ da empresa.`);
    }
  }
  if (def.usa.includes('credenciais_bb')) {
    const origem = params.usar_credenciais_da_cobranca !== false ? ' (Configuração de cobrança)' : '';
    if (!credenciais?.clientId) faltas.push(`Sem client_id de ${nomeAmb}${origem}.`);
    if (!credenciais?.appKey) faltas.push(`Sem app key de ${nomeAmb}${origem}.`);
    if (!credenciais?.secret) faltas.push(`Sem client_secret de ${nomeAmb} guardado${origem}.`);
    if (catalogo.usaMtls(def, params, ambiente) && !certificado?.configurado) faltas.push('A conexão pede o certificado da empresa (mTLS) e ele não foi encontrado.');
  }
  if (def.chave === 'bb_extrato') {
    if (!params.conta_id) faltas.push('Escolha a conta do Extrato bancário que recebe os lançamentos.');
    else if (contas.length && !contas.some(x => String(x.id) === String(params.conta_id))) faltas.push('A conta escolhida não existe mais no Extrato bancário.');
    if (ambiente === PRODUCAO && (!params.agencia || !params.conta)) faltas.push('Informe agência e conta corrente (sem o dígito).');
    if (ambiente !== PRODUCAO) {
      const agencia = params.homologacao_agencia || params.agencia;
      const conta = params.homologacao_conta || params.conta;
      if (!agencia || !conta) faltas.push('Informe a conta de teste da homologação do BB (ou agência e conta).');
      else if (!catalogo.mciTesteDoExtrato(params, agencia, conta)) {
        faltas.push(`A conta ${agencia} / ${conta} não é uma das contas de teste do BB: use 1505 / 1348, 551 / 5087 ou 452 / 123873 (Avançado), ou informe o código dela (x-br-com-bb-ipa-mciteste).`);
      }
    }
    if (!String(params.escopo || '').trim()) faltas.push('Informe o escopo do OAuth (extrato-info).');
    const urlApi = catalogo.url(def, 'url_api', params, ambiente) || '';
    if (/\/extratos\/v1\b/i.test(urlApi)) faltas.push('O endereço da API de Extratos é o da versão 1, que o BB desliga em 20/11/2026: apague o endereço digitado (Avançado) para usar o da v2.');
  }
  if (def.chave === 'bb_investimentos') {
    if (!String(params.escopo || '').trim()) faltas.push('Falta o escopo que o BB indicar para a API do CDB.');
    if (!String(params.caminho_consulta || '').trim()) faltas.push('Falta o caminho da consulta da posição (o BB indica).');
  }
  return faltas;
}

/** O que a tela mostra de uma linha (sem nada secreto). Pura. */
function linhaPublica(def, linha, { ambiente, travada } = {}) {
  const params = parametros(def, linha);
  return {
    chave: def.chave, etapa: def.etapa, nome: def.nome, icone: def.icone, descricao: def.descricao, banco: def.banco,
    tem_automatica: def.automatica, intervalo_limites: def.intervalo, fornecer: def.fornecer,
    permissao_executar: def.permissaoExecutar, tem_segredo: Boolean(def.segredo),
    campos: def.campos, sql_pronto: Boolean(linha),
    ativa: Boolean(linha?.ativa), ambiente_no_banco: linha?.ambiente || HOMOLOGACAO, ambiente, travada_em_homologacao: Boolean(travada),
    automatica: Boolean(linha?.automatica), intervalo_min: Number(linha?.intervalo_min) || def.intervalo.padrao,
    parametros: params,
    urls: Object.fromEntries(def.campos.filter(x => x.tipo === 'url').map(x => [x.chave, catalogo.url(def, x.chave, params, ambiente)])),
    estado: {
      ultimo_nsu: linha?.ultimo_nsu || null, max_nsu: linha?.max_nsu || null,
      proxima_consulta_apos: b.instanteBR(linha?.proxima_consulta_apos), ultima_execucao_em: b.instanteBR(linha?.ultima_execucao_em),
      ultimo_sucesso_em: b.instanteBR(linha?.ultimo_sucesso_em), ultimo_erro: linha?.ultimo_erro || null
    }
  };
}

module.exports = {
  HOMOLOGACAO, PRODUCAO,
  carregar, parametros, ambienteEfetivo, travadaEmHomologacao, campoVale, validarCampo, validar, gravar, atualizarEstado, pendencias, linhaPublica
};
