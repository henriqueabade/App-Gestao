#!/usr/bin/env node
/**
 * Gera o .env DEV seguro da VPS num arquivo FORA do repositório (0600), para o
 * dono conferir antes de virar o .env de verdade. Não troca o .env atual.
 *
 *   node scripts/dev-vps/gerar-env-dev-vps.js <destino> [--base <.env atual>]
 *
 * - A senha do banco vem do ~/.pgpass (linha do app_gestao_dev); nunca é exibida.
 * - Do .env atual (--base) só passam chaves que não são segredo nem endereço de
 *   produção (portas, modelos e limites da IA, nomes do GitHub de publicação).
 * - O resultado é conferido por backend/ambienteIsolado.js antes de gravar.
 * Ver docs/ambientes-dev-e-migracoes.md.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const { avaliar, lerMarcador, PROIBIDAS } = require('../../backend/ambienteIsolado');

const RAIZ = path.resolve(__dirname, '..', '..');
const BANCO = 'Santissimo_Decor_App_Gestao_Dev_VPS';
const USUARIO = 'app_gestao_dev';
const SEM_SEGREDO = ['API_PORT', 'GEMINI_MODEL', 'GROQ_MODEL', 'IA_MAX_ARQUIVOS', 'IA_MAX_ARQUIVO_MB', 'IA_TEXTO_MAX_CHARS',
  'IA_TIMEOUT_MS', 'ELECTRON_PUBLISH_GITHUB_OWNER', 'ELECTRON_PUBLISH_GITHUB_REPO', 'ELECTRON_PUBLISH_GITHUB_RELEASE_TYPE'];

function senhaDoPgpass(arquivo = path.join(os.homedir(), '.pgpass')) {
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const [host, porta, , usuario, ...resto] = linha.split(':');
    if (usuario === USUARIO && ['127.0.0.1', 'localhost'].includes(host) && ['5432', '*'].includes(porta)) return resto.join(':');
  }
  throw new Error(`~/.pgpass sem a linha de ${USUARIO}`);
}

function montar(base = {}, senha) {
  const linhas = [
    '# .env DEV da VPS (ambiente isolado). Gerado por scripts/dev-vps/gerar-env-dev-vps.js.',
    '# Sem nenhum segredo de produção. Ver docs/ambientes-dev-e-migracoes.md.',
    'BANCO=DEV',
    'APP_GESTAO_AMBIENTE_ISOLADO=1',
    'DB_HOST=127.0.0.1',
    'DB_PORT=5432',
    `DB_USER=${USUARIO}`,
    `DB_NAME=${BANCO}`,
    `DB_PASSWORD=${senha}`,
    '',
    '# Travas que só rebaixam (o .env nunca liga produção):',
    'NFE_AMBIENTE=homologacao',
    'BB_AMBIENTE=sandbox',
    'CONTABILIDADE_INTEGRACOES_AMBIENTE=homologacao',
    '',
    '# Nada de API de produção: a porta 9 local não atende ninguém.',
    'API_BASE_URL=http://127.0.0.1:9/api',
    'API_URL=http://127.0.0.1:9/api',
    'APP_URL=http://127.0.0.1:3000',
    '',
    '# E-mail desligado e sem SMTP; destinatários fictícios.',
    'EMAIL_SENDING_ENABLED=false',
    'SMTP_HOST=',
    'SMTP_PORT=',
    'SMTP_USER=',
    'SMTP_PASS=',
    'FROM_EMAIL=nao-responda@exemplo.invalid',
    'ADMIN_EMAIL=admin@exemplo.invalid',
    'SUP_ADMIN_EMAIL=sup-admin@exemplo.invalid',
    '',
    '# Atualização automática desligada; rede só local (lista vazia).',
    'ELECTRON_UPDATE_DISABLE=1',
    'DEV_REDE_PERMITIDA=',
    ''
  ];
  const extras = SEM_SEGREDO.filter(k => base[k] !== undefined && String(base[k]).trim() !== '');
  if (extras.length) {
    linhas.push('# Copiadas do .env anterior (não são segredo):');
    for (const k of extras) linhas.push(`${k}=${String(base[k]).trim()}`);
    linhas.push('');
  }
  return linhas.join('\n');
}

function principal(argv) {
  const destino = argv[2];
  if (!destino) throw new Error('uso: node scripts/dev-vps/gerar-env-dev-vps.js <destino> [--base <.env atual>]');
  const absoluto = path.resolve(destino);
  if (absoluto === RAIZ || absoluto.startsWith(RAIZ + path.sep)) throw new Error('o destino precisa ficar FORA do repositório');
  const i = argv.indexOf('--base');
  const base = i > 0 && fs.existsSync(argv[i + 1]) ? dotenv.parse(fs.readFileSync(argv[i + 1])) : {};
  const conteudo = montar(base, senhaDoPgpass());
  const lido = dotenv.parse(conteudo);
  const banco = { DB_HOST: lido.DB_HOST, DB_PORT: lido.DB_PORT, DB_USER: lido.DB_USER, DB_NAME: lido.DB_NAME, DB_PASSWORD: lido.DB_PASSWORD };
  const problemas = avaliar({ env: lido, banco, marcador: lerMarcador() || { ambiente: 'dev-vps', banco: BANCO, usuario: USUARIO } });
  if (problemas.length) throw new Error(`o .env gerado não passaria na trava:\n- ${problemas.join('\n- ')}`);
  if (PROIBIDAS.some(k => String(lido[k] || '').trim())) throw new Error('segredo proibido no resultado');
  fs.mkdirSync(path.dirname(absoluto), { recursive: true, mode: 0o700 });
  fs.writeFileSync(absoluto, conteudo, { mode: 0o600 });
  fs.chmodSync(absoluto, 0o600);
  console.log(`gerado: ${absoluto} (0600, ${conteudo.split('\n').length} linhas; trava ok; nenhum valor exibido)`);
}

if (require.main === module) {
  try { principal(process.argv); } catch (e) { console.error(`ERRO: ${e.message}`); process.exitCode = 1; }
}

module.exports = { montar, senhaDoPgpass };
