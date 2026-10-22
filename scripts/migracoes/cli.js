#!/usr/bin/env node
/**
 * Executor das migrações SQL de migracoes/. Ver docs/ambientes-dev-e-migracoes.md.
 *
 * Sem banco (só leitura dos arquivos):
 *   node scripts/migracoes/cli.js listar
 *   node scripts/migracoes/cli.js verificar
 *   node scripts/migracoes/cli.js comparar <a.json> <b.json>
 * Com banco (conexão: --host/--porta/--usuario/--banco, ou --do-env para usar as
 * DB_* do .env; senha pelo ~/.pgpass (Windows: %APPDATA%\postgresql\pgpass.conf)
 * ou PGPASSWORD; o host precisa ser local):
 *   estado                                      só leitura
 *   impressao-digital [--salvar <arquivo>]      só leitura (estrutura, nunca dados)
 *   aplicar <id> --ambiente dev-vps|dev-windows --confirmar-banco <nome> [--backup-dir <pasta>] [--fora-de-ordem]
 *   registrar <id> --confirmar-banco <nome>     (dev-windows: aplicada à mão no psql, só registra)
 *   marcar-ambiente dev-windows|dev-vps --confirmar-banco <nome>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const n = require('./nucleo');
const { hostLocal, lerMarcador } = require('../../backend/ambienteIsolado');

function argumentos(argv) {
  const flags = {};
  const posicionais = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const chave = a.slice(2);
      if (['do-env', 'fora-de-ordem', 'json'].includes(chave)) flags[chave] = true;
      else { flags[chave] = argv[i + 1]; i += 1; }
    } else posicionais.push(a);
  }
  return { comando: posicionais[0], alvo: posicionais[1], extra: posicionais[2], flags };
}

function dentroDoRepositorio(p) {
  const abs = path.resolve(p);
  return abs === n.RAIZ || abs.startsWith(n.RAIZ + path.sep);
}

/** Conexão: só local; a senha nunca passa por argumento nem aparece na tela. */
function configuracaoDaConexao(flags) {
  let cfg;
  if (flags['do-env']) {
    const env = require('dotenv').parse(fs.readFileSync(path.join(n.RAIZ, '.env')));
    cfg = { host: env.DB_HOST, port: Number(env.DB_PORT || 5432), user: env.DB_USER, database: env.DB_NAME, senha: env.DB_PASSWORD };
  } else {
    cfg = { host: flags.host || '127.0.0.1', port: Number(flags.porta || 5432), user: flags.usuario, database: flags.banco };
  }
  if (!cfg.user || !cfg.database) throw new Error('informe --usuario e --banco (ou --do-env)');
  if (!hostLocal(cfg.host)) throw new Error('o executor só conecta em banco LOCAL (127.0.0.1, localhost ou socket): nunca em servidor remoto, túnel ou produção');
  const senha = cfg.senha;
  delete cfg.senha;
  cfg.password = async () => {
    if (senha) return senha;
    if (process.env.PGPASSWORD) return process.env.PGPASSWORD;
    return new Promise(resolve => require('pgpass')({ host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database }, s => resolve(s || '')));
  };
  cfg.application_name = 'app-gestao-migracoes';
  cfg.connectionTimeoutMillis = 10000;
  return cfg;
}

async function conectar(flags) {
  const { Client } = require('pg');
  const client = new Client(configuracaoDaConexao(flags));
  client.on('notice', m => console.log(`  aviso do banco: ${m.message}`));
  await client.connect();
  return client;
}

/** A máquina confere com o ambiente pedido (o Windows nunca se passa pela VPS, e vice-versa). */
function conferirMaquina(ambiente) {
  if (ambiente === 'dev-vps' && !(process.platform === 'linux' && lerMarcador())) {
    throw new Error('dev-vps só roda na VPS (Linux com /etc/app-gestao/ambiente-isolado)');
  }
  if (ambiente === 'dev-windows' && process.platform !== 'win32') throw new Error('dev-windows só roda no Windows do dono');
  if (!n.MARCAS[ambiente]) throw new Error('--ambiente precisa ser dev-vps ou dev-windows');
}

function infoDaMaquina(arquivo) {
  const git = args => execFileSync('git', args, { cwd: n.RAIZ, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  let commit = null;
  let noGit = null;
  try { commit = git(['rev-parse', 'HEAD']); } catch (_) { /* sem git */ }
  if (arquivo) {
    try {
      git(['ls-files', '--error-unmatch', path.relative(n.RAIZ, arquivo.caminho)]);
      execFileSync('git', ['diff', '--quiet', 'HEAD', '--', path.relative(n.RAIZ, arquivo.caminho)], { cwd: n.RAIZ, timeout: 5000, stdio: 'ignore' });
      noGit = true;
    } catch (_) { noGit = false; }
  }
  return { maquina: os.hostname().slice(0, 100), commit, noGit };
}

/** Backup antes de migração destrutiva: pg_dump -Fc fora do repositório, com SHA-256 e conferência. */
function fazerBackup(flags, banco, pasta) {
  if (!pasta) throw new Error('--backup-dir é obrigatório para migração destrutiva');
  if (dentroDoRepositorio(pasta)) throw new Error('--backup-dir precisa ficar FORA do repositório (o repositório é sincronizado)');
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const cfg = configuracaoDaConexao(flags);
  const carimbo = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const arquivo = path.join(pasta, `${banco}-${carimbo}-antes-de-migracao.dump`);
  execFileSync('pg_dump', ['-h', cfg.host, '-p', String(cfg.port), '-U', cfg.user, '-d', banco, '-Fc', '--no-owner', '--no-acl', '-f', arquivo],
    { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600000 });
  fs.chmodSync(arquivo, 0o600);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
  fs.writeFileSync(`${arquivo}.sha256`, `${hash}  ${path.basename(arquivo)}\n`, { mode: 0o600 });
  const indice = execFileSync('pg_restore', ['-l', arquivo], { timeout: 60000 }).toString().split('\n').filter(l => l && !l.startsWith(';'));
  if (!indice.length) throw new Error('o backup ficou vazio: migração cancelada');
  return { arquivo, sha256: hash, objetos: indice.length };
}

function imprimirArquivos(arquivos, manifesto, estado) {
  const registradas = new Map(manifesto.migracoes.map(a => [a.id, a]));
  const aplicadas = new Map(((estado && estado.aplicadas) || []).map(a => [a.id, a]));
  for (const a of arquivos) {
    const reg = registradas.get(a.id);
    const apl = aplicadas.get(a.id);
    const marcas = [
      `escopo ${a.cabecalho.escopo || '?'}`,
      reg ? (reg.sha256 === a.sha256 ? 'congelada no manifesto' : 'MANIFESTO-COM-OUTRO-SHA') : 'FORA DO MANIFESTO',
      estado ? (apl ? (apl.sha256 === a.sha256 ? `aplicada (${apl.modo})` : 'APLICADA-COM-OUTRO-SHA') : 'pendente neste banco') : null
    ].filter(Boolean);
    console.log(`${a.id || '?'}  ${a.sha256}  ${a.nome}  [${marcas.join(', ')}]`);
    for (const p of a.problemas) console.log(`    problema: ${p}`);
  }
  if (estado) for (const r of estado.aplicadas) if (!arquivos.some(a => a.id === r.id)) console.log(`${r.id}  ${r.sha256}  ${r.arquivo}  [APLICADA, MAS O ARQUIVO NÃO EXISTE MAIS]`);
}

async function principal(argv) {
  const { comando, alvo, extra, flags } = argumentos(argv);
  const arquivos = n.listarArquivos();
  const manifesto = n.lerManifesto();

  if (comando === 'listar' || comando === 'verificar') {
    imprimirArquivos(arquivos, manifesto, null);
    const problemas = [...arquivos.flatMap(a => a.problemas.map(p => `${a.nome}: ${p}`)), ...n.problemasDoManifesto(manifesto, arquivos)];
    if (comando === 'verificar') {
      if (problemas.length) { console.log(`\nVERIFICAÇÃO FALHOU:\n- ${problemas.join('\n- ')}`); return 1; }
      console.log(`\nverificação ok: ${arquivos.length} migração(ões), todas congeladas no manifesto, checksums conferem`);
    }
    return 0;
  }
  if (comando === 'comparar') {
    const a = JSON.parse(fs.readFileSync(alvo, 'utf8'));
    const b = JSON.parse(fs.readFileSync(extra, 'utf8'));
    const escopos = new Map(manifesto.migracoes.map(m => [m.id, m.escopo]));
    const d = n.compararImpressoes(a, b, id => escopos.get(id) || 'app');
    if (d.infra.length) console.log(`(migrações de infraestrutura, fora da comparação: ${d.infra.join(', ')})`);
    console.log(`primeiro: ${a.banco} (${a.ambiente}), ${a.total_objetos} objetos, estrutura ${a.estrutura_sha256}`);
    console.log(`segundo:  ${b.banco} (${b.ambiente}), ${b.total_objetos} objetos, estrutura ${b.estrutura_sha256}`);
    console.log(d.iguais ? 'IGUAIS: mesma estrutura e mesmas migrações (id e SHA-256).' : 'DIFERENTES:');
    for (const [rotulo, lista] of [['só no primeiro', d.soNoPrimeiro], ['só no segundo', d.soNoSegundo], ['diferentes', d.diferentes],
      ['migrações só no primeiro', d.migracoes.soNoPrimeiro], ['migrações só no segundo', d.migracoes.soNoSegundo], ['migrações com SHA diferente', d.migracoes.shaDiferente]]) {
      if (lista.length) console.log(`  ${rotulo}: ${lista.join(', ')}`);
    }
    return d.iguais ? 0 : 1;
  }

  const client = await conectar(flags);
  try {
    const estado = await n.lerEstado(client);
    console.log(`banco: ${estado.banco} | usuário: ${estado.usuario} | servidor: ${estado.servidor || 'socket local'} | PostgreSQL ${estado.versao} | marca: ${estado.marca || 'nenhuma'} | controle: ${estado.temControle ? 'sim' : 'não'}`);

    if (comando === 'estado') {
      imprimirArquivos(arquivos, manifesto, estado);
      return 0;
    }
    if (comando === 'impressao-digital') {
      const imp = await n.impressaoDigital(client);
      imp.gerada_em = new Date().toISOString();
      imp.maquina = os.hostname();
      const destino = flags.salvar || path.join(n.PASTA, '.estado', `${imp.ambiente || 'sem-marca'}-${imp.banco}.json`);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, `${JSON.stringify(imp, null, 2)}\n`);
      console.log(`impressão digital: ${imp.total_objetos} objetos, estrutura ${imp.estrutura_sha256}, ${imp.migracoes.length} migração(ões) -> ${destino}`);
      return 0;
    }
    if (comando === 'marcar-ambiente') {
      conferirMaquina(alvo);
      if (flags['confirmar-banco'] !== estado.banco) throw new Error(`--confirmar-banco precisa repetir o nome exato do banco conectado (${estado.banco})`);
      if (estado.marca && estado.marca !== n.MARCAS[alvo]) throw new Error(`o banco já tem outra marca ("${estado.marca}"): não troco sozinho`);
      if (estado.marca === n.MARCAS[alvo]) { console.log('o banco já tinha esta marca: nada mudou'); return 0; }
      await client.query(`COMMENT ON DATABASE "${estado.banco.replace(/"/g, '""')}" IS '${n.MARCAS[alvo]}'`);
      console.log(`marca gravada: ${n.MARCAS[alvo]}`);
      return 0;
    }
    if (comando === 'aplicar' || comando === 'registrar') {
      const ambiente = comando === 'registrar' ? 'dev-windows' : flags.ambiente;
      conferirMaquina(ambiente);
      const arquivo = arquivos.find(a => a.id === alvo);
      const info = infoDaMaquina(arquivo);
      let backup = null;
      const previa = n.planejar({ arquivo, arquivos, manifesto, estado, ambiente, opcoes: { confirmarBanco: flags['confirmar-banco'], foraDeOrdem: flags['fora-de-ordem'], backupFeito: true } });
      if (previa.situacao === 'aplicar' && arquivo.cabecalho.destrutiva === 'sim' && ambiente === 'dev-vps') {
        backup = fazerBackup(flags, estado.banco, flags['backup-dir']);
        console.log(`backup: ${backup.arquivo} (${backup.objetos} objetos, SHA-256 ${backup.sha256})`);
      }
      const plano = n.planejar({
        arquivo, arquivos, manifesto, estado, ambiente,
        opcoes: { confirmarBanco: flags['confirmar-banco'], foraDeOrdem: flags['fora-de-ordem'], backupFeito: Boolean(backup) || arquivo?.cabecalho.destrutiva !== 'sim' }
      });
      if (plano.situacao === 'ja-aplicada') { console.log(`${arquivo.nome}: já aplicada neste banco com o mesmo SHA-256 — nada a fazer`); return 0; }
      if (plano.situacao === 'recusada') {
        await n.anotarRecusa(client, { arquivo, ambiente, motivos: plano.motivos, info }).catch(() => false);
        console.log(`RECUSADA (nada foi executado):\n- ${plano.motivos.join('\n- ')}`);
        return 2;
      }
      console.log(`${comando === 'registrar' ? 'registrando' : 'aplicando'} ${arquivo.nome} (SHA-256 ${arquivo.sha256}) em ${estado.banco} [${ambiente}] ...`);
      const r = await n.aplicar({ client, arquivo, ambiente, info, modo: comando === 'registrar' ? 'registrada' : 'executada' });
      console.log(`${r.situacao.toUpperCase()} em ${r.duracaoMs} ms; registrado em controle.migracoes_aplicadas (commit ${info.commit || 'desconhecido'}${info.noGit ? '' : ', arquivo ainda não commitado'})`);
      return 0;
    }
    throw new Error(`comando desconhecido: ${comando || '(nenhum)'}`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  principal(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => {
    console.error(`ERRO: ${n.erroSemDados(e).mensagem}`);
    process.exitCode = 1;
  });
}

module.exports = { argumentos, configuracaoDaConexao, conferirMaquina, dentroDoRepositorio, principal };
