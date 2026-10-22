/**
 * Núcleo do executor de migrações SQL (pasta migracoes/).
 *
 * Regras (docs/ambientes-dev-e-migracoes.md):
 * - um arquivo por migração, AAAAMMDD_HHMM_descricao.sql, com cabeçalho;
 * - o SHA-256 é do conteúdo normalizado (sem BOM, fim de linha LF), para o
 *   mesmo arquivo dar o mesmo número no Windows e na VPS;
 * - só banco local e marcado (COMMENT ON DATABASE app-gestao:dev-vps ou
 *   app-gestao:dev-windows) — a produção nunca tem marca e é recusada;
 * - toda migração está no manifesto com o SHA-256 congelado: mudou, recusa
 *   (correção é migração nova); escopo "app" (vai ao Windows e, se o dono
 *   decidir, à produção) ou "infra" (controle do próprio executor);
 * - uma de cada vez, em transação, com trava (advisory lock), sem repetir,
 *   sem aceitar arquivo alterado depois de aplicado.
 *
 * Funções puras aqui; quem fala com o banco recebe um `client` do pg.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const PASTA = path.join(RAIZ, 'migracoes');
const NOME = /^([0-9]{8}_[0-9]{4})_([a-z0-9_]+)\.sql$/;
const ID_DO_CONTROLE = '20261021_2230';
const MARCAS = { 'dev-vps': 'app-gestao:dev-vps', 'dev-windows': 'app-gestao:dev-windows' };
const TRAVA = 'app-gestao:migracoes';
const FERRAMENTA = 'scripts/migracoes 1';

/** Conteúdo normalizado: sem BOM e com LF, para o checksum não depender da máquina. */
function normalizar(conteudo) {
  return String(Buffer.isBuffer(conteudo) ? conteudo.toString('utf8') : conteudo).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function sha256(texto) {
  return crypto.createHash('sha256').update(normalizar(texto), 'utf8').digest('hex');
}

/** O cabeçalho: as linhas "-- chave: valor" do topo do arquivo. */
function lerCabecalho(texto) {
  const campos = {};
  for (const linha of normalizar(texto).split('\n')) {
    if (!linha.trim()) continue;
    const m = linha.match(/^--\s*([a-z]+)\s*:\s*(.*?)\s*$/i);
    if (!m) {
      if (linha.startsWith('--')) continue;
      break;
    }
    campos[m[1].toLowerCase()] = m[2];
  }
  return {
    migracao: campos.migracao || '',
    descricao: campos.descricao || '',
    requer: String(campos.requer || '').split(/[,\s]+/).filter(Boolean),
    escopo: (campos.escopo || '').toLowerCase(),
    transacao: (campos.transacao || '').toLowerCase(),
    destrutiva: (campos.destrutiva || '').toLowerCase()
  };
}

/** O SQL sem comentários, literais e corpos $$...$$ — só para as conferências por palavra. */
function soCodigo(sql) {
  let s = normalizar(sql);
  s = s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, ' ');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/--[^\n]*/g, ' ');
  s = s.replace(/'(?:[^']|'')*'/g, ' ');
  s = s.replace(/"(?:[^"]|"")*"/g, 'x');
  return s.toUpperCase();
}

const DESTRUTIVOS = [
  /\bDROP\s+(TABLE|COLUMN|SCHEMA|INDEX|VIEW|MATERIALIZED|FUNCTION|PROCEDURE|TRIGGER|TYPE|SEQUENCE|CONSTRAINT|POLICY|RULE)\b/,
  // TRUNCATE só como comando (no CREATE TRIGGER ... OR TRUNCATE ON ele é evento).
  /(^|;)\s*TRUNCATE\b/, /\bDELETE\s+FROM\b/, /\bUPDATE\s+[\w.]+\s+(AS\s+\w+\s+)?SET\b/,
  /\bALTER\s+TABLE\b[^;]*\bDROP\b/, /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/, /\bRENAME\b/
];
const PROIBIDOS = [
  [/\b(CREATE|ALTER|DROP)\s+(ROLE|USER|DATABASE|TABLESPACE)\b/, 'mexe em usuário, banco ou tablespace'],
  [/\bALTER\s+SYSTEM\b/, 'ALTER SYSTEM'],
  [/\bCOPY\b[^;]*\bPROGRAM\b/, 'COPY ... PROGRAM'],
  [/\bCREATE\s+EXTENSION\b/, 'CREATE EXTENSION (exige superusuário na VPS: combinar antes)'],
  [/\b(GRANT|REVOKE)\b/, 'GRANT/REVOKE (as permissões diferem entre as máquinas)'],
  [/\bSET\s+(ROLE|SESSION\s+AUTHORIZATION)\b/, 'troca de usuário'],
  [/\b(PG_READ_FILE|PG_READ_BINARY_FILE|PG_WRITE|LO_IMPORT|LO_EXPORT|DBLINK|POSTGRES_FDW)\b/, 'acesso a arquivo ou a outro servidor']
];
const FORA_DE_TRANSACAO = [/\bCONCURRENTLY\b/, /\bVACUUM\b/, /\bCREATE\s+DATABASE\b/];
const CONTROLE_DE_TRANSACAO = /(^|;)\s*(BEGIN|COMMIT|ROLLBACK|END|START\s+TRANSACTION|SAVEPOINT|RELEASE)\b/;

/** O que o SQL faz de arriscado (lista de palavras achadas por categoria). */
function analisar(sql) {
  const codigo = soCodigo(sql);
  return {
    destrutivo: DESTRUTIVOS.filter(re => re.test(codigo)).map(re => re.source),
    proibido: PROIBIDOS.filter(([re]) => re.test(codigo)).map(([, motivo]) => motivo),
    foraDeTransacao: FORA_DE_TRANSACAO.filter(re => re.test(codigo)).map(re => re.source),
    controlaTransacao: CONTROLE_DE_TRANSACAO.test(codigo),
    metaComandos: /^\s*\\/m.test(normalizar(sql))
  };
}

/** Os problemas de um arquivo de migração (vazio = arquivo bom). */
function problemasDoArquivo(nome, texto) {
  const problemas = [];
  const m = nome.match(NOME);
  if (!m) return [`nome fora do padrão AAAAMMDD_HHMM_descricao.sql: ${nome}`];
  const cab = lerCabecalho(texto);
  if (cab.migracao !== m[1]) problemas.push(`cabeçalho "-- migracao:" (${cab.migracao || 'ausente'}) diferente do id do nome (${m[1]})`);
  if (!cab.descricao) problemas.push('cabeçalho sem "-- descricao:"');
  if (!['app', 'infra'].includes(cab.escopo)) problemas.push('cabeçalho "-- escopo:" precisa ser app (estrutura do aplicativo) ou infra (controle do executor)');
  if (!['sim', 'nao'].includes(cab.transacao)) problemas.push('cabeçalho "-- transacao:" precisa ser sim ou nao');
  if (!['sim', 'nao'].includes(cab.destrutiva)) problemas.push('cabeçalho "-- destrutiva:" precisa ser sim ou nao');
  for (const r of cab.requer) if (!/^[0-9]{8}_[0-9]{4}$/.test(r)) problemas.push(`"-- requer:" com id inválido: ${r}`);
  const a = analisar(texto);
  if (a.metaComandos) problemas.push('tem comando do psql (linha com \\): use só SQL');
  if (a.controlaTransacao) problemas.push('tem BEGIN/COMMIT/ROLLBACK: quem abre e fecha a transação é o executor');
  for (const motivo of a.proibido) problemas.push(`proibido: ${motivo}`);
  if (a.destrutivo.length && cab.destrutiva !== 'sim') problemas.push('apaga, renomeia ou reescreve dados/estrutura: marque "-- destrutiva: sim"');
  if (a.foraDeTransacao.length && cab.transacao !== 'nao') problemas.push('tem comando que não roda em transação: marque "-- transacao: nao"');
  return problemas;
}

/** Os arquivos de migracoes/, em ordem de id, com checksum e problemas. */
function listarArquivos(pasta = PASTA, fsx = fs) {
  const nomes = fsx.readdirSync(pasta).filter(n => n.endsWith('.sql')).sort();
  const arquivos = nomes.map(nome => {
    const texto = normalizar(fsx.readFileSync(path.join(pasta, nome)));
    const m = nome.match(NOME);
    return {
      id: m ? m[1] : null, nome, caminho: path.join(pasta, nome), texto,
      sha256: sha256(texto), cabecalho: lerCabecalho(texto), problemas: problemasDoArquivo(nome, texto)
    };
  });
  const vistos = new Map();
  for (const a of arquivos) {
    if (!a.id) continue;
    if (vistos.has(a.id)) {
      a.problemas.push(`id repetido com ${vistos.get(a.id)}`);
    } else {
      vistos.set(a.id, a.nome);
    }
  }
  return arquivos;
}

function lerManifesto(pasta = PASTA, fsx = fs) {
  const dados = JSON.parse(fsx.readFileSync(path.join(pasta, 'manifesto.json'), 'utf8'));
  if (!Array.isArray(dados.migracoes)) throw new Error('manifesto.json sem a lista "migracoes"');
  return dados;
}

/** Conferência do manifesto contra os arquivos (vazio = tudo bate). */
function problemasDoManifesto(manifesto, arquivos) {
  const problemas = [];
  const porId = new Map(arquivos.map(a => [a.id, a]));
  const ids = new Set();
  for (const m of manifesto.migracoes) {
    if (ids.has(m.id)) problemas.push(`manifesto: ${m.id} registrado duas vezes`);
    ids.add(m.id);
    const a = porId.get(m.id);
    if (!a) {
      problemas.push(`manifesto: ${m.id} registrado, mas o arquivo sumiu`);
    } else {
      if (a.nome !== m.arquivo) problemas.push(`manifesto: ${m.id} registrado como ${m.arquivo}, mas o arquivo é ${a.nome}`);
      if (a.sha256 !== m.sha256) problemas.push(`manifesto: ${a.nome} MUDOU depois de registrado (SHA-256 diferente) — crie uma migração nova`);
      if (a.cabecalho.escopo !== m.escopo) problemas.push(`manifesto: ${a.nome} com escopo ${m.escopo}, mas o cabeçalho diz ${a.cabecalho.escopo || 'nada'}`);
    }
  }
  for (const a of arquivos) if (a.id && !ids.has(a.id)) problemas.push(`manifesto: ${a.nome} não está registrado (congele o SHA-256 no manifesto)`);
  return problemas;
}

function ambienteDaMarca(marca) {
  return Object.keys(MARCAS).find(k => MARCAS[k] === marca) || null;
}

/** Erro sem valores de dados: SQLSTATE e a 1ª linha, com "(col)=(valor)" e literais tirados. */
function erroSemDados(err) {
  const codigo = String((err && err.code) || '').slice(0, 10) || null;
  let mensagem = String((err && err.message) || err || 'erro').split('\n')[0];
  mensagem = mensagem.replace(/\(([^()]*)\)=\(([^()]*)\)/g, '($1)=(…)').replace(/'[^']*'/g, '\'…\'').slice(0, 500);
  return { codigo, mensagem };
}

/**
 * Decide se dá para aplicar. Devolve { situacao: 'aplicar'|'ja-aplicada'|'recusada', motivos }.
 * estado = { banco, marca, temControle, aplicadas: [{ id, arquivo, sha256 }] }
 */
function planejar({ arquivo, arquivos, manifesto, estado, ambiente, opcoes = {} }) {
  const motivos = [];
  if (!arquivo) return { situacao: 'recusada', motivos: ['migração não encontrada em migracoes/'] };
  motivos.push(...arquivo.problemas);
  if (!MARCAS[ambiente]) motivos.push(`--ambiente precisa ser dev-vps ou dev-windows (veio ${ambiente || 'vazio'})`);
  if (estado.marca !== MARCAS[ambiente]) {
    motivos.push(`o banco não tem a marca ${MARCAS[ambiente] || '?'} (tem ${estado.marca ? `"${estado.marca}"` : 'nenhuma'}): produção e bancos não marcados são recusados`);
  }
  if (opcoes.confirmarBanco !== estado.banco) motivos.push(`--confirmar-banco precisa repetir o nome exato do banco conectado (${estado.banco})`);

  const aplicadas = new Map((estado.aplicadas || []).map(r => [r.id, r]));
  const ja = aplicadas.get(arquivo.id);
  if (ja) {
    if (ja.sha256 === arquivo.sha256) return { situacao: 'ja-aplicada', motivos: [] };
    motivos.push(`${arquivo.nome} já foi aplicada com OUTRO conteúdo (SHA-256 diferente): não se altera migração aplicada; crie uma nova`);
  }
  if (!estado.temControle && arquivo.id !== ID_DO_CONTROLE) motivos.push(`o controle de migrações ainda não existe neste banco: a primeira é ${ID_DO_CONTROLE}`);

  const porId = new Map(arquivos.map(a => [a.id, a]));
  for (const r of aplicadas.values()) {
    const a = porId.get(r.id);
    if (a && a.sha256 !== r.sha256) motivos.push(`divergência: ${a.nome} mudou depois de aplicada neste banco`);
  }
  const registro = (manifesto.migracoes || []).find(x => x.id === arquivo.id);
  if (!registro) {
    motivos.push(`${arquivo.id} não está no manifesto: congele o SHA-256 em migracoes/manifesto.json antes de aplicar`);
  } else if (registro.sha256 !== arquivo.sha256 || registro.arquivo !== arquivo.nome) {
    motivos.push(`${arquivo.nome} não é o arquivo registrado no manifesto (nome ou SHA-256 diferente)`);
  }
  for (const r of arquivo.cabecalho.requer) if (!aplicadas.has(r)) motivos.push(`requer ${r}, que ainda não foi aplicada neste banco`);
  const anteriores = arquivos.filter(a => a.id && a.id < arquivo.id && !aplicadas.has(a.id)).map(a => a.id);
  if (anteriores.length && !opcoes.foraDeOrdem) motivos.push(`há migrações anteriores ainda não aplicadas (${anteriores.join(', ')}); use --fora-de-ordem só se o dono pedir`);
  if (arquivo.cabecalho.destrutiva === 'sim' && ambiente === 'dev-vps' && !opcoes.backupFeito) {
    motivos.push('migração destrutiva: faça o backup antes (--backup-dir <pasta fora do repositório>)');
  }
  return { situacao: motivos.length ? 'recusada' : 'aplicar', motivos };
}

/** O banco conectado: nome, usuário, marca, controle e migrações aplicadas. Só leitura. */
async function lerEstado(client) {
  const { rows: [id] } = await client.query(
    "SELECT current_database() AS banco, current_user AS usuario, host(inet_server_addr()) AS servidor, " +
    "current_setting('server_version') AS versao, shobj_description(d.oid, 'pg_database') AS marca, " +
    "to_regclass('controle.migracoes_aplicadas') IS NOT NULL AS tem_controle " +
    'FROM pg_database d WHERE d.datname = current_database()');
  const estado = {
    banco: id.banco, usuario: id.usuario, servidor: id.servidor, versao: id.versao,
    marca: id.marca || null, temControle: id.tem_controle, aplicadas: []
  };
  if (estado.temControle) {
    const { rows } = await client.query('SELECT id, arquivo, sha256, ambiente, modo, aplicada_em FROM controle.migracoes_aplicadas ORDER BY id');
    estado.aplicadas = rows.map(r => ({ ...r, sha256: String(r.sha256).trim() }));
  }
  return estado;
}

async function anotarExecucao(client, { arquivo, ambiente, inicio, resultado, erro = null, info = {} }) {
  await client.query(
    'INSERT INTO controle.migracoes_execucoes (migracao_id, arquivo, sha256, ambiente, iniciada_em, resultado, erro_codigo, erro_mensagem, maquina, commit_git) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [arquivo.id, arquivo.nome, arquivo.sha256, ambiente, inicio, resultado, erro && erro.codigo, erro && erro.mensagem,
      info.maquina || null, info.commit || null]);
}

/**
 * Aplica UMA migração já planejada (situacao 'aplicar'). Em transação, com a
 * trava; confere de novo dentro da trava que ninguém aplicou antes. Falhou:
 * ROLLBACK, a falha vai para o diário (sem dados) e o erro sobe sem dados.
 */
async function aplicar({ client, arquivo, ambiente, info = {}, agora = () => new Date(), modo = 'executada' }) {
  const inicio = agora();
  const t0 = Date.now();
  const registrar = () => client.query(
    'INSERT INTO controle.migracoes_aplicadas (id, arquivo, sha256, descricao, ambiente, modo, duracao_ms, maquina, commit_git, arquivo_no_git, ferramenta) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
    [arquivo.id, arquivo.nome, arquivo.sha256, arquivo.cabecalho.descricao, ambiente, modo, Date.now() - t0,
      info.maquina || null, info.commit || null, info.noGit ?? null, FERRAMENTA]);
  const emTransacao = arquivo.cabecalho.transacao !== 'nao' || modo === 'registrada';
  let travaDeSessao = false;
  try {
    if (emTransacao) {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SET LOCAL statement_timeout = '10min'");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [TRAVA]);
    } else {
      const { rows: [t] } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [TRAVA]);
      if (!t.ok) throw Object.assign(new Error('outra execução de migração está em andamento neste banco'), { code: 'TRAVADO' });
      travaDeSessao = true;
    }
    const { rows: [c] } = await client.query("SELECT to_regclass('controle.migracoes_aplicadas') IS NOT NULL AS tem");
    if (c.tem) {
      const { rows } = await client.query('SELECT sha256 FROM controle.migracoes_aplicadas WHERE id = $1', [arquivo.id]);
      if (rows.length) throw Object.assign(new Error('outra execução aplicou esta migração enquanto esta esperava a trava'), { code: 'JA_APLICADA' });
    }
    if (modo === 'executada') await client.query(arquivo.texto);
    await registrar();
    await anotarExecucao(client, { arquivo, ambiente, inicio, resultado: 'sucesso', info });
    if (emTransacao) await client.query('COMMIT');
    return { situacao: modo === 'registrada' ? 'registrada' : 'aplicada', duracaoMs: Date.now() - t0 };
  } catch (err) {
    if (emTransacao) await client.query('ROLLBACK').catch(() => {});
    const erro = erroSemDados(err);
    try {
      const { rows: [c] } = await client.query("SELECT to_regclass('controle.migracoes_execucoes') IS NOT NULL AS tem");
      if (c.tem) await anotarExecucao(client, { arquivo, ambiente, inicio, resultado: 'falha', erro, info });
    } catch (_) { /* o diário é melhor esforço; o erro original é o que importa */ }
    throw Object.assign(new Error(`a migração ${arquivo.nome} FALHOU e nada dela foi gravado${emTransacao ? '' : ' (atenção: sem transação, confira o banco)'}: ` +
      `${erro.codigo ? `[${erro.codigo}] ` : ''}${erro.mensagem}`), { code: 'MIGRACAO_FALHOU', erro });
  } finally {
    if (travaDeSessao) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [TRAVA]).catch(() => {});
  }
}

/** Anota uma recusa no diário (se o controle existir). Nada mais é gravado. */
async function anotarRecusa(client, { arquivo, ambiente, motivos, info = {} }) {
  const { rows: [c] } = await client.query("SELECT to_regclass('controle.migracoes_execucoes') IS NOT NULL AS tem");
  if (!c.tem || !arquivo) return false;
  await anotarExecucao(client, {
    arquivo, ambiente: MARCAS[ambiente] ? ambiente : 'desconhecido', inicio: new Date(), resultado: 'recusada', info,
    erro: { codigo: null, mensagem: motivos.join(' | ').slice(0, 500) }
  });
  return true;
}

/**
 * Uma definição na forma que o PostgreSQL devolve depois de um dump/restore.
 * `varchar IN ('a', 'b')` criado direto sai como
 * `((ARRAY['a'::character varying, ...])::text[])`; restaurado de um dump, como
 * `ARRAY[('a'::character varying)::text, ...]`. É a mesma regra; sem isto, o
 * banco restaurado (a VPS) e o criado à mão (o Windows) pareceriam diferentes.
 */
function canonico(definicao) {
  return String(definicao)
    .replace(/\(('(?:[^']|'')*'::(?:character varying|bpchar))\)::text\b/g, '$1')
    .replace(/\(\(ARRAY\[((?:[^\]']|'(?:[^']|'')*')*)\]\)::text\[\]\)/g, '(ARRAY[$1])');
}

/**
 * A impressão digital da ESTRUTURA do aplicativo (nunca dos dados): tabelas e
 * colunas, restrições, índices, triggers, funções, views, sequências (sem o
 * valor atual) e tipos, mais a lista de migrações aplicadas. Só leitura. O
 * schema controle fica de fora por padrão: é infraestrutura de cada ambiente.
 */
async function impressaoDigital(client, schemas = ['public', 'rbac']) {
  const objetos = {};
  const md5 = t => crypto.createHash('md5').update(canonico(t)).digest('hex');
  const q = async (sql) => (await client.query(sql, [schemas])).rows;
  for (const r of await q(
    "SELECT table_schema || '.' || table_name AS t, string_agg(column_name || ' ' || udt_name || coalesce('(' || character_maximum_length || ')', '') " +
    "|| coalesce('(' || numeric_precision || ',' || numeric_scale || ')', '') || CASE WHEN is_nullable = 'NO' THEN ' not null' ELSE '' END " +
    "|| coalesce(' default ' || column_default, '') || CASE WHEN is_identity = 'YES' THEN ' identity ' || identity_generation ELSE '' END, ' | ' ORDER BY column_name) AS d " +
    'FROM information_schema.columns WHERE table_schema = ANY($1) GROUP BY 1')) objetos[`tabela ${r.t}`] = md5(r.d);
  for (const r of await q(
    "SELECT c.conrelid::regclass::text || ' ' || c.conname AS k, pg_get_constraintdef(c.oid) AS d FROM pg_constraint c " +
    'JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = ANY($1) AND c.conrelid <> 0')) objetos[`restricao ${r.k}`] = md5(r.d);
  for (const r of await q("SELECT schemaname || '.' || indexname AS k, indexdef AS d FROM pg_indexes WHERE schemaname = ANY($1)")) objetos[`indice ${r.k}`] = md5(r.d);
  for (const r of await q(
    "SELECT t.tgrelid::regclass::text || ' ' || t.tgname AS k, pg_get_triggerdef(t.oid) AS d FROM pg_trigger t " +
    'JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = ANY($1)')) objetos[`trigger ${r.k}`] = md5(r.d);
  for (const r of await q(
    "SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS k, pg_get_functiondef(p.oid) AS d " +
    "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1) AND p.prokind IN ('f', 'p')")) objetos[`funcao ${r.k}`] = md5(r.d);
  for (const r of await q("SELECT schemaname || '.' || viewname AS k, definition AS d FROM pg_views WHERE schemaname = ANY($1)")) objetos[`view ${r.k}`] = md5(r.d);
  for (const r of await q(
    "SELECT schemaname || '.' || sequencename AS k, data_type || ' ' || increment_by || ' ' || min_value || ' ' || max_value || ' ' || cycle AS d " +
    'FROM pg_sequences WHERE schemaname = ANY($1)')) objetos[`sequencia ${r.k}`] = md5(r.d);
  for (const r of await q(
    "SELECT n.nspname || '.' || t.typname AS k, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS d FROM pg_type t " +
    'JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = ANY($1) GROUP BY 1')) objetos[`tipo ${r.k}`] = md5(r.d);
  const estado = await lerEstado(client);
  const ordenados = Object.fromEntries(Object.keys(objetos).sort().map(k => [k, objetos[k]]));
  return {
    banco: estado.banco, ambiente: ambienteDaMarca(estado.marca), versao_servidor: estado.versao,
    schemas, total_objetos: Object.keys(ordenados).length,
    estrutura_sha256: crypto.createHash('sha256').update(JSON.stringify(ordenados)).digest('hex'),
    migracoes: estado.aplicadas.map(r => ({ id: r.id, sha256: r.sha256, modo: r.modo })),
    objetos: ordenados
  };
}

/**
 * Diferenças entre duas impressões digitais (a = este banco, b = o outro).
 * `escopoDe(id)` (do manifesto) separa as migrações "infra" — o controle de
 * cada ambiente —, que aparecem só como informação e não contam como diferença.
 */
function compararImpressoes(a, b, escopoDe = () => 'app') {
  const ka = new Set(Object.keys(a.objetos || {}));
  const kb = new Set(Object.keys(b.objetos || {}));
  const doApp = lista => (lista || []).filter(m => escopoDe(m.id) !== 'infra');
  const ma = new Map(doApp(a.migracoes).map(m => [m.id, m.sha256]));
  const mb = new Map(doApp(b.migracoes).map(m => [m.id, m.sha256]));
  const infra = [...new Set([...(a.migracoes || []), ...(b.migracoes || [])].filter(m => escopoDe(m.id) === 'infra').map(m => m.id))].sort();
  return {
    infra,
    iguais: a.estrutura_sha256 === b.estrutura_sha256 && JSON.stringify([...ma].sort()) === JSON.stringify([...mb].sort()),
    soNoPrimeiro: [...ka].filter(k => !kb.has(k)).sort(),
    soNoSegundo: [...kb].filter(k => !ka.has(k)).sort(),
    diferentes: [...ka].filter(k => kb.has(k) && a.objetos[k] !== b.objetos[k]).sort(),
    migracoes: {
      soNoPrimeiro: [...ma.keys()].filter(k => !mb.has(k)).sort(),
      soNoSegundo: [...mb.keys()].filter(k => !ma.has(k)).sort(),
      shaDiferente: [...ma.keys()].filter(k => mb.has(k) && ma.get(k) !== mb.get(k)).sort()
    }
  };
}

module.exports = {
  RAIZ, PASTA, NOME, ID_DO_CONTROLE, MARCAS, TRAVA, FERRAMENTA,
  normalizar, sha256, lerCabecalho, soCodigo, analisar, problemasDoArquivo, listarArquivos,
  lerManifesto, problemasDoManifesto, ambienteDaMarca, erroSemDados, planejar,
  lerEstado, aplicar, anotarRecusa, canonico, impressaoDigital, compararImpressoes
};
