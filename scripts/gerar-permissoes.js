// Gera o catálogo canônico de permissões a partir do modal e emite:
//  - backend/permissionsCatalog.js  (fonte única da verdade)
//  - sql/permissoes.sql             (DDL completo)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'src/html/modals/usuarios/permissoes.html');
const html = fs.readFileSync(HTML, 'utf8');

// Rótulo humano dos módulos configurados (aba do modal)
const MODULE_LABELS = {
  mp: ['Matéria-prima', 'materia-prima'],
  prod: ['Produtos', 'produtos'],
  orc: ['Orçamentos', 'orcamentos'],
  ped: ['Pedidos', 'pedidos'],
  cli: ['Clientes', 'clientes'],
  pros: ['Prospecções', 'prospeccoes'],
  ctt: ['Contatos', 'contatos'],
  rel: ['Relatórios', 'relatorios'],
  tarefas: ['Tarefas', 'tarefas'],
  cfg: ['Configurações', 'configuracoes'],
  usuarios: ['Usuários', 'usuarios']
};

// Módulos existentes no menu que ainda NÃO têm ações/colunas configuradas.
// Recebem somente "modulo_ativo" (visibilidade no menu).
const PENDING_MODULES = [
  ['dashboard', 'Dashboard', 'dashboard'],
  ['calendario', 'Calendário', 'calendario'],
  ['lam_clientes', 'Laminação · Clientes', 'laminacao-clientes'],
  ['lam_servicos', 'Laminação · Serviços', 'laminacao-servicos'],
  ['lam_precificacao', 'Laminação · Precificação', 'laminacao-precificacao'],
  ['lam_relatorios', 'Laminação · Relatórios', 'laminacao-relatorios'],
  ['ia', 'IA', 'ia'],
  ['financeiro', 'Financeiro', 'financeiro']
];

// ---- parse do HTML -------------------------------------------------------
const panels = [...html.matchAll(/<section data-permission-tab-panel="([^"]+)" data-module="([^"]+)"/g)]
  .map(m => ({ panel: m[1], mod: m[2], idx: m.index }));

// Captura o input e, logo em seguida, o primeiro <span> (rótulo) e um <p>
// opcional (descrição). Ações vêm embrulhadas em <div>; colunas não.
const inputRe = /<input[^>]*name="([^"]+)"[^>]*data-item-type="(action|column)"[^>]*>([\s\S]{0,400}?)<\/label>/g;
const items = [];
let m;
while ((m = inputRe.exec(html))) {
  const bloco = m[3];
  const label = (bloco.match(/<span[^>]*>([^<]*)<\/span>/) || [, ''])[1].trim();
  const desc = (bloco.match(/<p[^>]*>([^<]*)<\/p>/) || [, ''])[1].trim();
  items.push({ name: m[1], type: m[2], label, desc, idx: m.index });
}

const modules = new Map();
for (const [code, [label, page]] of Object.entries(MODULE_LABELS)) {
  modules.set(code, { code, label, page, configured: true, actions: [], columns: [] });
}

for (const it of items) {
  const owner = panels.filter(p => p.idx < it.idx).pop();
  if (!owner) continue;
  const mod = modules.get(owner.mod);
  if (!mod) continue;
  const target = it.type === 'column' ? mod.columns : mod.actions;
  if (target.some(x => x.name === it.name)) {
    console.warn(`AVISO duplicata ignorada: ${owner.mod} ${it.type} ${it.name}`);
    continue;
  }
  target.push({ name: it.name, label: it.label, desc: it.desc });
}

for (const [code, label, page] of PENDING_MODULES) {
  // Nunca sobrescreve um módulo que já foi mapeado com ações/colunas —
  // era assim que "usuarios" voltava a ficar vazio depois de configurado.
  const existente = modules.get(code);
  if (existente && (existente.actions.length || existente.columns.length)) continue;
  modules.set(code, { code, label, page, configured: false, actions: [], columns: [] });
}

// ---- nomes de coluna SQL -------------------------------------------------
// ação  "mp.process.view"      -> acao_process_view   (remove prefixo do módulo)
// coluna "col_mp_codigo"       -> mantém como está (já é único e prefixado)
function actionColumn(modCode, name) {
  let rest = name;
  const pfx = modCode + '.';
  if (rest.startsWith(pfx)) rest = rest.slice(pfx.length);
  return 'acao_' + rest.replace(/[.\-]/g, '_').toLowerCase();
}
function columnColumn(name) {
  return name.replace(/[.\-]/g, '_').toLowerCase();
}

for (const mod of modules.values()) {
  mod.actions.forEach(a => { a.column = actionColumn(mod.code, a.name); });
  mod.columns.forEach(c => { c.column = columnColumn(c.name); });
  // valida colisões dentro da tabela
  const seen = new Set(['modelo_id', 'modulo_ativo']);
  for (const x of [...mod.actions, ...mod.columns]) {
    if (seen.has(x.column)) throw new Error(`COLISAO em perm_${mod.code}: ${x.column}`);
    seen.add(x.column);
    if (x.column.length > 63) throw new Error(`Nome de coluna >63 chars: ${x.column}`);
  }
}

// ---- emite catálogo JS ---------------------------------------------------
const catalogObj = {};
for (const mod of modules.values()) {
  catalogObj[mod.code] = {
    code: mod.code,
    label: mod.label,
    page: mod.page,
    table: `perm_${mod.code}`,
    configured: mod.configured,
    actions: mod.actions.map(a => ({ key: a.name, column: a.column, label: a.label, desc: a.desc })),
    columns: mod.columns.map(c => ({ key: c.name, column: c.column, label: c.label }))
  };
}

const jsOut = `// GERADO AUTOMATICAMENTE — fonte única da verdade das permissões.
// Cada módulo vira uma tabela perm_<code> com uma coluna booleana por permissão.
// Para regenerar, rode o gerador em scripts/ (ver README de permissões).
/* eslint-disable */
const PERMISSIONS_CATALOG = ${JSON.stringify(catalogObj, null, 2)};

const MODULE_CODES = Object.keys(PERMISSIONS_CATALOG);

function getModule(code) {
  return PERMISSIONS_CATALOG[code] || null;
}

// "mp.view" -> { module:'mp', column:'acao_view', type:'action' }
function resolvePermissionKey(key) {
  if (!key) return null;
  for (const mod of Object.values(PERMISSIONS_CATALOG)) {
    const a = mod.actions.find(x => x.key === key);
    if (a) return { module: mod.code, table: mod.table, column: a.column, type: 'action' };
    const c = mod.columns.find(x => x.key === key);
    if (c) return { module: mod.code, table: mod.table, column: c.column, type: 'column' };
  }
  return null;
}

module.exports = { PERMISSIONS_CATALOG, MODULE_CODES, getModule, resolvePermissionKey };
`;
fs.writeFileSync(path.join(ROOT, 'backend/permissionsCatalog.js'), jsOut);

// ---- emite SQL -----------------------------------------------------------
let sql = `-- =====================================================================
-- ESTRUTURA DE PERMISSÕES — App-Gestao
-- Gerado a partir do modal de permissões (fonte única: backend/permissionsCatalog.js)
--
-- Modelo:
--   modelos_permissoes  ......... perfis de permissão (ex.: "Vendedor", "Admin")
--   usuarios.modelo_permissoes_id  vincula o usuário a um perfil
--   perm_<modulo> ............... 1 linha por perfil, 1 coluna booleana por permissão
--                                 modulo_ativo = módulo visível no menu
--
-- Regra: TRUE = permitido (marcado) | FALSE = negado (desmarcado)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Perfis de permissão
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modelos_permissoes (
  id           SERIAL PRIMARY KEY,
  nome         VARCHAR(120) NOT NULL UNIQUE,
  descricao    TEXT,
  criado_em    TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 2) Vínculo usuário -> perfil
-- ---------------------------------------------------------------------
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS modelo_permissoes_id INTEGER
  REFERENCES modelos_permissoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_modelo_permissoes
  ON usuarios(modelo_permissoes_id);

`;

let n = 3;
for (const mod of modules.values()) {
  const total = mod.actions.length + mod.columns.length;
  sql += `-- ---------------------------------------------------------------------
-- ${n}) ${mod.label}  (perm_${mod.code})${mod.configured ? `  —  ${mod.actions.length} ações, ${mod.columns.length} colunas` : '  —  módulo ainda não configurado (somente modulo_ativo)'}
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_${mod.code} (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE`;
  // A vírgula precisa vir ANTES do comentário, senão ela fica dentro do
  // comentário "--" e o DDL quebra.
  const linhas = [];
  if (mod.actions.length) {
    linhas.push({ head: '  -- Ações', items: mod.actions.map(a => ({ col: a.column, cmt: `${a.name} · ${a.label}` })) });
  }
  if (mod.columns.length) {
    linhas.push({ head: '  -- Colunas visíveis', items: mod.columns.map(c => ({ col: c.column, cmt: c.label })) });
  }
  const todas = [];
  for (const grupo of linhas) {
    todas.push({ head: grupo.head });
    for (const it of grupo.items) todas.push(it);
  }
  if (todas.length) {
    sql += ',\n';
    const defs = todas.filter(x => !x.head);
    let i = 0;
    for (const entry of todas) {
      if (entry.head) { sql += `\n${entry.head}\n`; continue; }
      i++;
      const virgula = i < defs.length ? ',' : '';
      sql += `  ${entry.col.padEnd(34)} BOOLEAN NOT NULL DEFAULT FALSE${virgula}  -- ${entry.cmt}\n`;
    }
  } else {
    sql += '\n';
  }
  sql += `);\n\n`;
  n++;
}

sql += `-- ---------------------------------------------------------------------
-- ${n}) Perfil padrão "Administrador" com tudo liberado
-- ---------------------------------------------------------------------
INSERT INTO modelos_permissoes (nome, descricao)
VALUES ('Administrador', 'Acesso total a todos os módulos')
ON CONFLICT (nome) DO NOTHING;

`;

for (const mod of modules.values()) {
  const cols = ['modulo_ativo', ...mod.actions.map(a => a.column), ...mod.columns.map(c => c.column)];
  sql += `INSERT INTO perm_${mod.code} (modelo_id, ${cols.join(', ')})
SELECT id, ${cols.map(() => 'TRUE').join(', ')} FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;\n\n`;
}

sql += `COMMIT;\n`;

fs.mkdirSync(path.join(ROOT, 'sql'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'sql/permissoes.sql'), sql);

// ---- emite migração incremental (ALTER TABLE) ----------------------------
// Idempotente: cria a tabela se não existir e adiciona apenas as colunas que
// faltam. Pode ser rodado quantas vezes quiser, inclusive num banco já criado.
let alter = `-- =====================================================================
-- MIGRAÇÃO INCREMENTAL DE PERMISSÕES — App-Gestao
-- Seguro rodar em banco JÁ EXISTENTE: só adiciona o que falta.
-- Regenerado por: node scripts/gerar-permissoes.js
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS modelos_permissoes (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(120) NOT NULL UNIQUE,
  descricao     TEXT,
  criado_em     TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS modelo_permissoes_id INTEGER
  REFERENCES modelos_permissoes(id) ON DELETE SET NULL;

`;

for (const mod of modules.values()) {
  alter += `-- ${mod.label} (${mod.table || 'perm_' + mod.code})\n`;
  alter += `CREATE TABLE IF NOT EXISTS perm_${mod.code} (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);\n`;
  const todas = [
    ...mod.actions.map(a => ({ col: a.column, cmt: `${a.name} · ${a.label}` })),
    ...mod.columns.map(c => ({ col: c.column, cmt: c.label }))
  ];
  for (const it of todas) {
    alter += `ALTER TABLE perm_${mod.code} ADD COLUMN IF NOT EXISTS ${it.col} BOOLEAN NOT NULL DEFAULT FALSE;  -- ${it.cmt}\n`;
  }
  alter += '\n';
}

alter += `-- Garante 1 linha por perfil em cada tabela (perfis já existentes)\n`;
for (const mod of modules.values()) {
  alter += `INSERT INTO perm_${mod.code} (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;\n`;
}

alter += `\n-- Mantém o perfil "Administrador" com tudo liberado\n`;
for (const mod of modules.values()) {
  const cols = ['modulo_ativo', ...mod.actions.map(a => a.column), ...mod.columns.map(c => c.column)];
  alter += `UPDATE perm_${mod.code} SET ${cols.map(c => `${c} = TRUE`).join(', ')}
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');\n`;
}

alter += `\nCOMMIT;\n`;
fs.writeFileSync(path.join(ROOT, 'sql/permissoes_migracao.sql'), alter);

// ---- resumo --------------------------------------------------------------
let ta = 0, tc = 0;
console.log('MODULO'.padEnd(20), 'TABELA'.padEnd(22), 'ACOES', 'COLUNAS', 'TOTAL COLS');
for (const mod of modules.values()) {
  ta += mod.actions.length; tc += mod.columns.length;
  console.log(
    mod.label.padEnd(20),
    ('perm_' + mod.code).padEnd(22),
    String(mod.actions.length).padStart(5),
    String(mod.columns.length).padStart(7),
    String(1 + mod.actions.length + mod.columns.length).padStart(10)
  );
}
console.log(`\nTabelas: ${modules.size} | Ações: ${ta} | Colunas: ${tc} | Permissões totais: ${ta + tc + modules.size}`);
