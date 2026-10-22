#!/usr/bin/env node
/**
 * Executa um SQL EXCLUSIVO da VPS (scripts/dev-vps/*.sql) no banco DEV da VPS,
 * com as conferências de sempre:
 *   - máquina isolada (/etc/app-gestao/ambiente-isolado);
 *   - conexão local, banco Santissimo_Decor_App_Gestao_Dev_VPS, usuário app_gestao_dev;
 *   - backup pg_dump -Fc verificado (SHA-256 + índice) antes, fora do repositório;
 *   - SHA-256 do script passado ao SQL, que se registra em controle.operacoes_dev_vps;
 *   - a saída inteira guardada em ~/app-gestao-dev-vps/registros/.
 *
 *   node scripts/dev-vps/operacao-vps.js <script.sql> [--sem-backup] [-v nome=valor ...]
 *
 * A senha vem do ~/.pgpass. Nunca rode isto fora da VPS (ele recusa).
 * Ver docs/ambientes-dev-e-migracoes.md, seção "SQL exclusivo da VPS".
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const { lerMarcador } = require('../../backend/ambienteIsolado');
const { normalizar } = require('../migracoes/nucleo');

const BANCO = 'Santissimo_Decor_App_Gestao_Dev_VPS';
const USUARIO = 'app_gestao_dev';
const HOST = '127.0.0.1';
const PASTA = path.join(os.homedir(), 'app-gestao-dev-vps');
const BACKUPS = path.join(os.homedir(), 'dumps-dev', 'backups');
const carimbo = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

function psql(args, opcoes = {}) {
  return execFileSync('psql', ['-h', HOST, '-U', USUARIO, '-d', BANCO, '-X', '-At', ...args], { timeout: 60000, ...opcoes }).toString().trim();
}

function conferirAlvo() {
  const marcador = lerMarcador();
  if (!(process.platform === 'linux' && marcador && marcador.banco === BANCO && marcador.usuario === USUARIO)) {
    throw new Error('esta não é a VPS DEV marcada (/etc/app-gestao/ambiente-isolado): recusado');
  }
  const [banco, usuario, servidor, superusuario] = psql(['-F', '|', '-c',
    "SELECT current_database(), current_user, coalesce(host(inet_server_addr()), 'socket'), (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)"]).split('|');
  if (banco !== BANCO || usuario !== USUARIO || !['127.0.0.1', 'socket'].includes(servidor) || superusuario !== 'f') {
    throw new Error(`alvo inesperado (${banco} / ${usuario} / ${servidor}): recusado`);
  }
  const marca = psql(['-c', "SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = current_database()"]);
  return { banco, usuario, servidor, marca };
}

function backupVerificado(rotulo) {
  const pasta = path.join(BACKUPS, `${carimbo()}-antes-de-${rotulo}`);
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const arquivo = path.join(pasta, `${BANCO}.dump`);
  execFileSync('pg_dump', ['-h', HOST, '-U', USUARIO, '-d', BANCO, '-Fc', '-Z', '6', '--no-owner', '--no-acl', '-f', arquivo], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600000 });
  fs.chmodSync(arquivo, 0o600);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
  fs.writeFileSync(`${arquivo}.sha256`, `${sha}  ${path.basename(arquivo)}\n`, { mode: 0o600 });
  const objetos = execFileSync('pg_restore', ['-l', arquivo]).toString().split('\n').filter(l => l && !l.startsWith(';')).length;
  if (objetos < 100) throw new Error(`backup com só ${objetos} objetos: operação cancelada`);
  return { arquivo, sha, objetos };
}

function principal(argv) {
  const script = argv[0];
  if (!script || !fs.existsSync(script)) throw new Error('uso: node scripts/dev-vps/operacao-vps.js <script.sql> [--sem-backup] [-v nome=valor ...]');
  const absoluto = path.resolve(script);
  if (path.dirname(absoluto) !== path.resolve(__dirname)) throw new Error('só scripts de scripts/dev-vps/ (SQL exclusivo da VPS)');
  const extras = [];
  for (let i = 1; i < argv.length; i += 1) if (argv[i] === '-v') { extras.push('-v', argv[i + 1]); i += 1; }
  const alvo = conferirAlvo();
  console.log(`alvo: ${alvo.banco} | ${alvo.usuario} | ${alvo.servidor} | marca: ${alvo.marca || 'nenhuma'}`);
  const sha = crypto.createHash('sha256').update(normalizar(fs.readFileSync(absoluto)), 'utf8').digest('hex');
  const backup = argv.includes('--sem-backup') ? null : backupVerificado(path.basename(absoluto, '.sql'));
  if (backup) console.log(`backup: ${backup.arquivo} (${backup.objetos} objetos, SHA-256 ${backup.sha})`);
  fs.mkdirSync(path.join(PASTA, 'registros'), { recursive: true, mode: 0o700 });
  const registro = path.join(PASTA, 'registros', `${carimbo()}-${path.basename(absoluto, '.sql')}.log`);
  const r = spawnSync('psql', ['-h', HOST, '-U', USUARIO, '-d', BANCO, '-X', '-v', 'ON_ERROR_STOP=1',
    '-v', `operacao_sha256=${sha}`, '-v', `maquina=${os.hostname()}`,
    '-v', `backup_arquivo=${backup ? backup.arquivo : ''}`, '-v', `backup_sha256=${backup ? backup.sha : ''}`,
    ...extras, '-f', absoluto], { encoding: 'utf8', timeout: 1800000 });
  const saida = `# ${path.basename(absoluto)} sha256=${sha} em ${new Date().toISOString()}\n# backup=${backup ? `${backup.arquivo} ${backup.sha}` : 'nenhum'}\n${r.stdout || ''}${r.stderr ? `\n# stderr\n${r.stderr}` : ''}\n# exit=${r.status}\n`;
  fs.writeFileSync(registro, saida, { mode: 0o600 });
  process.stdout.write(r.stdout || '');
  if (r.stderr) process.stderr.write(r.stderr);
  console.log(`registro da execução: ${registro}`);
  return r.status === 0 ? 0 : 1;
}

if (require.main === module) {
  try { process.exitCode = principal(process.argv.slice(2)); } catch (e) { console.error(`ERRO: ${e.message}`); process.exitCode = 1; }
}
