/**
 * Ambiente DEV isolado: a máquina de desenvolvimento que não pode, de jeito
 * nenhum, falar com a produção (hoje, a VPS de desenvolvimento).
 *
 * QUANDO VALE
 * -----------
 * Só numa máquina marcada: o arquivo `/etc/app-gestao/ambiente-isolado` (fora
 * do repositório, fora do Syncthing, só o administrador da máquina grava) ou a
 * variável APP_GESTAO_AMBIENTE_ISOLADO=1. No Windows do dono não há nem um nem
 * outro, e nada aqui muda o comportamento de lá.
 *
 * FALHA FECHADA
 * -------------
 * Com a marca presente, o `.env` precisa estar inteiro no modo DEV seguro; se
 * faltar, sobrar ou estiver ambíguo, o app NÃO inicia. A marca fica na máquina
 * e não no `.env` de propósito: quem copiar de volta um `.env` de produção não
 * desliga a trava, é barrado por ela.
 *
 * As mensagens citam só o NOME das chaves, nunca o valor.
 */
const fs = require('fs');
const net = require('net');

const MARCADOR = '/etc/app-gestao/ambiente-isolado';
const MARCA_DO_BANCO = 'app-gestao:dev-vps';
const CODIGO = 'AMBIENTE_DEV_ISOLADO';

// Segredos que não têm o que fazer numa máquina isolada (todos são de produção
// ou dão acesso a serviço real): preenchidos, o app não inicia.
const PROIBIDAS = [
  'SEGREDOS_CHAVE_MESTRA', 'GH_TOKEN', 'SMTP_PASS', 'NFE_CERT_PATH', 'NFE_CERT_SENHA', 'NFE_SMTP_SENHA',
  'BB_CLIENT_SECRET_SANDBOX', 'BB_CLIENT_SECRET_PRODUCAO', 'GEMINI_API_KEY', 'GROQ_API_KEY',
  'API_BEARER_TOKEN', 'DEFAULT_API_TOKEN'
];

// Endereços de produção que nunca podem entrar na lista de rede permitida.
const HOSTS_DE_PRODUCAO = [
  /(^|\.)santissimodecor\.com\.br$/i, /^api\.bb\.com\.br$/i, /^oauth\.bb\.com\.br$/i,
  /^[a-z]+\.mtls\.api\.bb\.com\.br$/i, /^nfe\.fazenda\.mg\.gov\.br$/i, /^www1?\.nfe\.fazenda\.gov\.br$/i,
  /^adn\.nfse\.gov\.br$/i, /ngrok/i
];

function erro(problemas) {
  const e = new Error(
    'AMBIENTE DEV ISOLADO: o aplicativo não vai iniciar nesta máquina enquanto o .env não estiver no modo DEV seguro.\n'
    + problemas.map(p => `  - ${p}`).join('\n')
    + '\nVeja docs/ambientes-dev-e-migracoes.md.');
  e.code = CODIGO;
  e.problemas = problemas;
  return e;
}

/** O marcador da máquina: null sem arquivo; { invalido } se o arquivo não diz dev-vps. */
function lerMarcador(caminho = MARCADOR, ler = fs.readFileSync) {
  let texto;
  try {
    texto = String(ler(caminho, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    // Existe e não se consegue ler: vale como marcado (e inválido), nunca como livre.
    return { invalido: true };
  }
  const campos = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = linha.match(/^\s*([a-z_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !linha.trim().startsWith('#')) campos[m[1].toLowerCase()] = m[2];
  }
  if (campos.ambiente !== 'dev-vps') return { invalido: true };
  return { ambiente: 'dev-vps', banco: campos.banco || '', usuario: campos.usuario || '' };
}

function hostLocal(valor) {
  const h = String(valor || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h.startsWith('/')) return true; // socket Unix
  if (h === 'localhost' || h === 'localhost.') return true;
  if (net.isIPv4(h)) return h.startsWith('127.');
  if (net.isIPv6(h)) return h === '::1' || /^::ffff:127\./.test(h);
  return false;
}

function urlLocal(valor) {
  try {
    return hostLocal(new URL(String(valor).trim()).hostname);
  } catch (_) {
    return false;
  }
}

/** A lista de rede permitida (DEV_REDE_PERMITIDA, separada por vírgula); vazia por padrão. */
function redePermitida(env) {
  return String(env.DEV_REDE_PERMITIDA || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
}

/**
 * Os problemas do `.env` para uma máquina isolada (lista vazia = pode iniciar).
 * `env` é o process.env já carregado; `banco` são as DB_* (que o dataConfig
 * guarda à parte); `marcador` é o lido da máquina.
 */
function avaliar({ env = {}, banco = {}, marcador = null } = {}) {
  const problemas = [];
  const v = chave => String(env[chave] ?? '').trim();
  const b = chave => String(banco[chave] ?? '').trim();

  if (marcador && marcador.invalido) problemas.push(`o marcador ${MARCADOR} existe mas não diz ambiente=dev-vps`);
  if (v('BANCO').toUpperCase() !== 'DEV') problemas.push('BANCO precisa ser DEV');
  if (!hostLocal(b('DB_HOST'))) problemas.push('DB_HOST precisa ser local (127.0.0.1, localhost ou socket)');
  const bancoEsperado = marcador && marcador.banco;
  if (bancoEsperado ? b('DB_NAME') !== bancoEsperado : !/_Dev_VPS$/.test(b('DB_NAME'))) {
    problemas.push('DB_NAME precisa ser o banco DEV desta máquina');
  }
  const usuarioEsperado = marcador && marcador.usuario;
  if (!b('DB_USER') || b('DB_USER').toLowerCase() === 'postgres' || (usuarioEsperado && b('DB_USER') !== usuarioEsperado)) {
    problemas.push('DB_USER precisa ser o usuário DEV desta máquina (nunca postgres)');
  }
  if (v('NFE_AMBIENTE').toLowerCase() !== 'homologacao') problemas.push('NFE_AMBIENTE precisa ser homologacao');
  if (!['sandbox', 'homologacao'].includes(v('BB_AMBIENTE').toLowerCase())) problemas.push('BB_AMBIENTE precisa ser sandbox');
  if (v('CONTABILIDADE_INTEGRACOES_AMBIENTE').toLowerCase() !== 'homologacao') {
    problemas.push('CONTABILIDADE_INTEGRACOES_AMBIENTE precisa ser homologacao');
  }
  for (const chave of PROIBIDAS) {
    if (v(chave)) problemas.push(`${chave} não pode estar preenchida (segredo de produção ou de serviço real)`);
  }
  if (['true', '1', 'yes', 'on'].includes(v('EMAIL_SENDING_ENABLED').toLowerCase())) {
    problemas.push('EMAIL_SENDING_ENABLED precisa ser false');
  }
  if (v('SMTP_HOST') && !hostLocal(v('SMTP_HOST'))) problemas.push('SMTP_HOST precisa ficar vazio (ou local)');
  for (const chave of ['API_BASE_URL', 'API_URL']) {
    if (v(chave) && !urlLocal(v(chave))) problemas.push(`${chave} precisa ficar vazia (ou local): nada de API de produção`);
  }
  for (const host of redePermitida(env)) {
    if (HOSTS_DE_PRODUCAO.some(re => re.test(host))) problemas.push(`DEV_REDE_PERMITIDA não pode liberar endereço de produção (${host})`);
  }
  return problemas;
}

/**
 * Lê o marcador e, se a máquina for isolada, exige o `.env` seguro.
 * Devolve { ativo, marcaDoBanco, permitidos }; lança se não puder iniciar.
 */
function exigirNaInicializacao({ env = process.env, banco = {}, lerMarcadorDaMaquina = lerMarcador } = {}) {
  const marcador = lerMarcadorDaMaquina();
  const ativo = Boolean(marcador) || String(env.APP_GESTAO_AMBIENTE_ISOLADO || '').trim() === '1';
  if (!ativo) return { ativo: false };
  const problemas = avaliar({ env, banco, marcador });
  if (problemas.length) throw erro(problemas);
  return { ativo: true, marcaDoBanco: MARCA_DO_BANCO, permitidos: redePermitida(env) };
}

module.exports = {
  MARCADOR, MARCA_DO_BANCO, CODIGO, PROIBIDAS,
  lerMarcador, hostLocal, urlLocal, redePermitida, avaliar, exigirNaInicializacao
};
