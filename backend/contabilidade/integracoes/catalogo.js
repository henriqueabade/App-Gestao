/**
 * As integrações automáticas da Contabilidade (etapas 10 a 13): o que cada
 * uma faz, o que precisa para funcionar, os campos que a tela mostra e os
 * endereços padrão de cada ambiente.
 *
 * Endereços são os oficiais conhecidos em 30/09/2026; todos podem ser
 * trocados na tela ("Avançado"), sem mexer no código, se o órgão ou o banco
 * mudar. O que é segredo (client_secret) não mora aqui nem no banco em
 * claro: ver integracoes/segredos.js.
 *
 * Tipos de campo: booleano, texto, digitos, inteiro, opcao, conta (uma das
 * contas do banco da etapa 4), url, competencia (AAAA-MM). `avancado` fica
 * escondido por padrão; `quando` mostra o campo só com outro campo num valor
 * (ex.: credenciais próprias só quando não reaproveita as da cobrança).
 * `foraDeUso` (texto) deixa o cartão parado: sem pendências e sem ligar.
 */
const HOMOLOGACAO = 'homologacao';
const PRODUCAO = 'producao';
const AMBIENTES = [HOMOLOGACAO, PRODUCAO];

const URLS = {
  sefaz_distribuicao: {
    homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    producao: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
  },
  // A manifestação do destinatário vai ao Ambiente Nacional (cOrgao 91), não à SEFAZ-MG.
  sefaz_evento: {
    homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    producao: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
  },
  bb_oauth: { homologacao: 'https://oauth.hm.bb.com.br/oauth/token', producao: 'https://oauth.bb.com.br/oauth/token' },
  // Extratos v2 (02/10/2026): a v1 (api.hm…/extratos/v1, api-extratos…/extratos/v1) é desligada pelo BB em 20/11/2026.
  bb_extratos: { homologacao: 'https://extratos.mtls.api.hm.bb.com.br/v2', producao: 'https://extratos.mtls.api.bb.com.br/v2' },
  bb_api: { homologacao: 'https://api.hm.bb.com.br', producao: 'https://api.bb.com.br' },
  adn: { homologacao: 'https://adn.producaorestrita.nfse.gov.br/contribuintes', producao: 'https://adn.nfse.gov.br/contribuintes' }
};

/**
 * Os campos das credenciais do BB (quando não reaproveita as da cobrança).
 * `usarCobranca` é o padrão da caixa; `ajuda` explica o porquê dele.
 */
function camposCredenciaisBB({ usarCobranca = true, ajuda, appKeyProducao = 'app key / gw-app-key (produção)' } = {}) {
  return [
    { chave: 'usar_credenciais_da_cobranca', rotulo: 'Usar a mesma aplicação da cobrança (client_id, app key e client_secret da Configuração de cobrança)', tipo: 'booleano', padrao: usarCobranca,
      ajuda: ajuda || 'No Portal Developers do BB, uma aplicação pode ter várias APIs: basta incluir esta API na aplicação que já emite os boletos.' },
    { chave: 'client_id_homologacao', rotulo: 'client_id (homologação)', tipo: 'texto', max: 200, quando: { usar_credenciais_da_cobranca: false } },
    { chave: 'app_key_homologacao', rotulo: 'app key / gw-dev-app-key (homologação)', tipo: 'texto', max: 120, quando: { usar_credenciais_da_cobranca: false } },
    { chave: 'client_id_producao', rotulo: 'client_id (produção)', tipo: 'texto', max: 200, quando: { usar_credenciais_da_cobranca: false } },
    { chave: 'app_key_producao', rotulo: appKeyProducao, tipo: 'texto', max: 120, quando: { usar_credenciais_da_cobranca: false } }
  ];
}

const CAMPO_MTLS = {
  chave: 'mtls', rotulo: 'Certificado da empresa na conexão (mTLS)', tipo: 'opcao', padrao: 'auto',
  opcoes: { auto: 'Automático (só em produção)', sim: 'Sempre', nao: 'Nunca' },
  ajuda: 'O BB pede o certificado A1 da empresa na conexão das APIs de conta. O certificado público (.cer) precisa estar cadastrado na aplicação do portal.'
};

/**
 * O mês em que a Contabilidade começa (decisão do dono em 02/10/2026:
 * setembro/2026). Nas buscas da SEFAZ e do ADN, as notas do mês anterior a
 * ele ficam na caixa de entrada para decidir (registrar ou guardar como
 * histórico) e as mais antigas não entram.
 */
const CAMPO_PRIMEIRA_COMPETENCIA = {
  chave: 'primeira_competencia', rotulo: 'A Contabilidade começa em', tipo: 'competencia', padrao: '2026-09',
  ajuda: 'As notas do mês anterior a este ficam na caixa de entrada para você decidir (registrar ou guardar como histórico); as mais antigas não entram.'
};

/**
 * As contas de teste da homologação da Extratos v2 (documentação do BB,
 * "Especificações e testes", 02/10/2026): cada uma tem o seu código, que vai
 * no cabeçalho `x-br-com-bb-ipa-mciteste` — só na homologação.
 */
const CONTAS_TESTE_EXTRATO = [
  { agencia: '1505', conta: '1348', mciteste: '178961031' },
  { agencia: '551', conta: '5087', mciteste: '26968930' },
  { agencia: '452', conta: '123873', mciteste: '704950857' }
];

const INTEGRACOES = {
  sefaz_nfe: {
    chave: 'sefaz_nfe', etapa: 10, nome: 'NF-e de entrada (SEFAZ)', icone: 'fa-file-import', banco: false,
    descricao: 'Busca na SEFAZ (Distribuição de DF-e do Ambiente Nacional) toda NF-e emitida contra o CNPJ da empresa, dá ciência para liberar o XML completo, registra em "Documentos recebidos" e acompanha cancelamentos.',
    usa: ['certificado', 'configuracao_fiscal'],
    permissaoExecutar: 'contabilidade.documento.registrar',
    automatica: true, intervalo: { padrao: 60, min: 60, max: 1440 },
    campos: [
      { chave: 'manifestar_ciencia', rotulo: 'Dar "Ciência da operação" automaticamente às NF-e novas', tipo: 'booleano', padrao: true,
        ajuda: 'Sem a ciência, a SEFAZ entrega só o resumo da nota; com ela, o XML completo chega na busca seguinte.' },
      { chave: 'registrar_automaticamente', rotulo: 'Registrar sozinha em "Documentos recebidos" a NF-e que chega completa', tipo: 'booleano', padrao: true },
      { chave: 'gerar_conta', rotulo: 'Lançar a conta a pagar junto (pelas duplicatas da nota)', tipo: 'booleano', padrao: false,
        ajuda: 'Desligado, a nota entra sem conta e o checklist avisa ("documento sem conta a pagar").' },
      CAMPO_PRIMEIRA_COMPETENCIA,
      { chave: 'nsu_inicial', rotulo: 'Recomeçar do NSU', tipo: 'digitos', max: 15, avancado: true,
        ajuda: 'Vazio: continua de onde parou. 0: pede de novo o que a SEFAZ ainda guarda (cerca de 90 dias); as notas de antes do mês anterior ao início não entram.' },
      { chave: 'url_distribuicao', rotulo: 'Endereço da Distribuição de DF-e', tipo: 'url', avancado: true, porAmbiente: true, padraoUrl: 'sefaz_distribuicao' },
      { chave: 'url_evento', rotulo: 'Endereço da Recepção de Evento (Ambiente Nacional)', tipo: 'url', avancado: true, porAmbiente: true, padraoUrl: 'sefaz_evento' }
    ],
    fornecer: [
      'Nada novo: usa o certificado A1 e o CNPJ da Configuração fiscal (Financeiro).',
      'Decidir se a ciência e o registro são automáticos (padrão: sim) e se a conta a pagar é lançada junto (padrão: não).'
    ]
  },
  bb_extrato: {
    chave: 'bb_extrato', etapa: 11, nome: 'Extrato da conta (API do BB)', icone: 'fa-university', banco: true,
    descricao: 'Busca os lançamentos da conta corrente pela API de Extratos v2 do Banco do Brasil e grava no Extrato bancário (o mesmo lugar do OFX, sem repetir o que já entrou).',
    usa: ['credenciais_bb', 'certificado_opcional'],
    // A v2 pede o certificado da empresa na conexão também na homologação.
    mtlsSempre: true,
    permissaoExecutar: 'contabilidade.extrato.importar',
    automatica: true, intervalo: { padrao: 1440, min: 60, max: 1440 },
    segredo: 'bb_extrato',
    campos: [
      ...camposCredenciaisBB({
        usarCobranca: false, appKeyProducao: 'app key (produção)',
        ajuda: 'A Extratos v2 exige uma aplicação própria no Portal Developers (não entra na aplicação dos boletos): desmarque e preencha as credenciais dela.'
      }),
      { chave: 'conta_id', rotulo: 'Conta do Extrato bancário que recebe os lançamentos', tipo: 'conta', obrigatorio: true },
      { chave: 'agencia', rotulo: 'Agência (sem o dígito)', tipo: 'digitos', semDv: true, max: 5, obrigatorio: true },
      { chave: 'conta', rotulo: 'Conta corrente (sem o dígito)', tipo: 'digitos', semDv: true, max: 12, obrigatorio: true },
      { chave: 'escopo', rotulo: 'Escopo (scope) do OAuth', tipo: 'texto', max: 200, padrao: 'extrato-info' },
      {
        ...CAMPO_MTLS, padrao: 'sim',
        // Um "auto" gravado antes da v2 vale como "sim" (usaMtls).
        opcoes: { sim: 'Sempre (a Extratos v2 exige)', nao: 'Nunca (só para diagnóstico)' },
        ajuda: 'A Extratos v2 pede o certificado A1 da empresa na conexão, na homologação e na produção. A cadeia do certificado precisa estar enviada na aplicação do portal, nos dois ambientes.'
      },
      { chave: 'dias_para_tras', rotulo: 'Dias a reler para trás (lançamentos que o banco lança com atraso)', tipo: 'inteiro', min: 0, max: 30, padrao: 5 },
      { chave: 'homologacao_agencia', rotulo: 'Agência de teste (homologação do BB)', tipo: 'digitos', semDv: true, max: 5, avancado: true, padrao: '1505',
        ajuda: 'Na homologação o BB só aceita as contas de teste da documentação: 1505 / 1348, 551 / 5087 ou 452 / 123873.' },
      { chave: 'homologacao_conta', rotulo: 'Conta de teste (homologação do BB)', tipo: 'digitos', semDv: true, max: 12, avancado: true, padrao: '1348' },
      { chave: 'homologacao_mciteste', rotulo: 'Código da conta de teste (cabeçalho x-br-com-bb-ipa-mciteste)', tipo: 'digitos', max: 12, avancado: true,
        ajuda: 'Vazio: o app usa o código da documentação para a conta de teste escolhida. Só vai na homologação.' },
      { chave: 'url_oauth', rotulo: 'Endereço do token (OAuth)', tipo: 'url', avancado: true, porAmbiente: true, padraoUrl: 'bb_oauth' },
      { chave: 'url_api', rotulo: 'Endereço da API de Extratos (v2)', tipo: 'url', avancado: true, porAmbiente: true, padraoUrl: 'bb_extratos' }
    ],
    fornecer: [
      'No Portal Developers BB: uma aplicação própria com a API Extratos (v2), credenciais de teste e de produção, a cadeia do certificado enviada nos dois ambientes e o termo de adesão assinado (envio para produção).',
      'Aqui: as credenciais dessa aplicação (client_id e app key de cada ambiente; o client_secret no bloco "Credenciais do BB").',
      'Agência e conta da empresa sem o dígito (as mesmas do cadastro da conta no Extrato bancário) e qual conta do Extrato recebe os lançamentos.'
    ]
  },
  nfse_adn: {
    chave: 'nfse_adn', etapa: 13, nome: 'NFS-e tomadas (ADN nacional)', icone: 'fa-file-signature', banco: false,
    descricao: 'Busca no Ambiente de Dados Nacional da NFS-e as notas de serviço em que a empresa é tomadora (Contagem, Belo Horizonte e os demais municípios do padrão nacional) e registra em "Documentos recebidos" com o XML.',
    usa: ['certificado', 'configuracao_fiscal'],
    permissaoExecutar: 'contabilidade.documento.registrar',
    automatica: true, intervalo: { padrao: 180, min: 60, max: 1440 },
    campos: [
      { chave: 'registrar_automaticamente', rotulo: 'Registrar sozinha em "Documentos recebidos" a NFS-e que chega', tipo: 'booleano', padrao: true },
      { chave: 'gerar_conta', rotulo: 'Lançar a conta a pagar junto (vencimento na emissão)', tipo: 'booleano', padrao: false },
      CAMPO_PRIMEIRA_COMPETENCIA,
      { chave: 'nsu_inicial', rotulo: 'Recomeçar do NSU', tipo: 'digitos', max: 15, avancado: true, ajuda: 'Vazio: continua de onde parou. 0: do começo (as notas de antes do mês anterior ao início não entram).' },
      { chave: 'lote', rotulo: 'Pedir em lotes (até 50 por consulta)', tipo: 'booleano', padrao: true, avancado: true },
      { chave: 'url', rotulo: 'Endereço da API dos contribuintes', tipo: 'url', avancado: true, porAmbiente: true, padraoUrl: 'adn' }
    ],
    fornecer: [
      'Nada novo: usa o certificado A1 e o CNPJ da Configuração fiscal.',
      'Confirmar com os prestadores/prefeituras que as NFS-e de Contagem e BH aparecem no ADN (padrão nacional).'
    ]
  },
  bb_investimentos: {
    chave: 'bb_investimentos', etapa: 12, nome: 'Aplicações — CDB (BB)', icone: 'fa-piggy-bank', banco: true,
    descricao: 'O CDB da empresa no BB. O catálogo público do BB traz a API de Fundos de Investimento, não uma de CDB: aqui ficam as credenciais e o teste (token + uma consulta de sondagem). Quando o BB disser qual API traz o CDB, o mapeamento dos campos entra por cima disto.',
    // Decisão do dono (02/10/2026): Rende Fácil e CDB entram pelos PDFs mensais do BB.
    foraDeUso: 'Fora de uso: o Rende Fácil e o CDB vão entrar pelos PDFs mensais do BB (fase das aplicações), conferidos ao centavo com o extrato. Este cartão só volta se o BB lançar uma API de CDB.',
    usa: ['credenciais_bb', 'certificado_opcional'],
    permissaoExecutar: 'contabilidade.config.view',
    automatica: false, intervalo: { padrao: 1440, min: 60, max: 1440 },
    segredo: 'bb_investimentos',
    campos: [
      ...camposCredenciaisBB(),
      { chave: 'escopo', rotulo: 'Escopo (scope) do OAuth — o que o BB indicar', tipo: 'texto', max: 200, obrigatorio: true },
      { chave: 'caminho_consulta', rotulo: 'Caminho da consulta (ex.: /investimentos/v1/…/agencia/{agencia}/conta/{conta})', tipo: 'texto', max: 300,
        ajuda: '{agencia} e {conta} são trocados pelos números abaixo. A resposta aparece no teste, para o mapeamento.' },
      { chave: 'agencia', rotulo: 'Agência (sem o dígito)', tipo: 'digitos', semDv: true, max: 5 },
      { chave: 'conta', rotulo: 'Conta (sem o dígito)', tipo: 'digitos', semDv: true, max: 12 },
      CAMPO_MTLS,
      { chave: 'url_oauth', rotulo: 'Endereço do token (OAuth)', tipo: 'url', avancado: true, porAmbiente: true, padraoUrl: 'bb_oauth' },
      { chave: 'url_api', rotulo: 'Endereço base da API', tipo: 'url', avancado: true, porAmbiente: true, padraoUrl: 'bb_api' }
    ],
    fornecer: [
      'Perguntar ao gerente/BB qual API (produto no Portal Developers) consulta a posição do CDB da empresa, com o escopo e o caminho.',
      'Incluir essa API na aplicação do portal e trazer um retorno de teste para o mapeamento.'
    ]
  }
};

const CHAVES = Object.keys(INTEGRACOES);

/** A integração pela chave, ou erro. */
function definicao(chave) {
  const d = INTEGRACOES[String(chave || '')];
  if (!d) {
    const e = new Error(`Integração desconhecida: ${chave}.`);
    e.status = 404;
    throw e;
  }
  return d;
}

/** O nome do campo guardado por ambiente (url_api → url_api_producao). */
const campoDoAmbiente = (chave, ambiente) => `${chave}_${ambiente === PRODUCAO ? PRODUCAO : HOMOLOGACAO}`;

/** O endereço que vale: o que foi digitado para o ambiente ou o padrão. */
function url(def, chaveCampo, parametros, ambiente) {
  const campo = def.campos.find(c => c.chave === chaveCampo);
  const digitado = String(parametros?.[campoDoAmbiente(chaveCampo, ambiente)] || '').trim();
  if (digitado) return digitado.replace(/\/+$/, '');
  const padrao = campo?.padraoUrl ? URLS[campo.padraoUrl]?.[ambiente === PRODUCAO ? PRODUCAO : HOMOLOGACAO] : null;
  return padrao ? padrao.replace(/\/+$/, '') : null;
}

/** Os padrões dos parâmetros de uma integração. */
function padroes(def) {
  const saida = {};
  for (const c of def.campos) if (c.padrao !== undefined) saida[c.chave] = c.padrao;
  return saida;
}

/**
 * Vai o certificado da empresa na conexão? "nao" desliga sempre; nas APIs
 * que o exigem nos dois ambientes (`mtlsSempre`) qualquer outro valor liga;
 * nas outras, "auto" liga só em produção. Pura.
 */
function usaMtls(def, params, ambiente) {
  const mtls = params?.mtls;
  if (mtls === 'nao') return false;
  if (def?.mtlsSempre || mtls === 'sim') return true;
  return ambiente === PRODUCAO;
}

const semZeros = v => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/**
 * O código de teste (x-br-com-bb-ipa-mciteste) da conta de homologação: o
 * digitado ou, vazio, o da documentação para aquela agência/conta; null
 * quando a conta não é uma das de teste. Pura.
 */
function mciTesteDoExtrato(params, agencia, conta) {
  const digitado = semZeros(params?.homologacao_mciteste);
  if (digitado) return digitado;
  const ag = semZeros(agencia);
  const cc = semZeros(conta);
  return CONTAS_TESTE_EXTRATO.find(x => x.agencia === ag && x.conta === cc)?.mciteste || null;
}

module.exports = {
  HOMOLOGACAO, PRODUCAO, AMBIENTES, URLS, INTEGRACOES, CHAVES, CONTAS_TESTE_EXTRATO,
  definicao, campoDoAmbiente, url, padroes, usaMtls, mciTesteDoExtrato
};
