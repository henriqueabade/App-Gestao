// Testa o permissionsRepository com uma API simulada em memória.
const ROOT = require('path').resolve(__dirname, '..');
const repo = require(ROOT + '/backend/permissionsRepository.js');
const { PERMISSIONS_CATALOG, MODULE_CODES } = require(ROOT + '/backend/permissionsCatalog.js');

let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + m); if (!c) fail++; };

// ---- API fake: guarda linhas por tabela ----
function makeApi() {
  const db = {};
  const calls = { post: 0, put: 0, del: 0 };
  return {
    db, calls,
    async get(path, opts) {
      const t = path.replace('/api/', '');
      const rows = db[t] || [];
      const mid = opts?.query?.modelo_id;
      return mid == null ? rows : rows.filter(r => String(r.modelo_id) === String(mid));
    },
    async post(path, body) {
      const t = path.replace('/api/', '');
      db[t] = db[t] || []; db[t].push({ ...body }); calls.post++; return body;
    },
    async put(path, body) {
      const t = path.replace('/api/', '').split('/')[0];
      const id = path.split('/').pop();
      db[t] = db[t] || [];
      const i = db[t].findIndex(r => String(r.modelo_id) === String(id));
      if (i >= 0) db[t][i] = { ...body }; else db[t].push({ ...body });
      calls.put++; return body;
    },
    async delete(path) {
      const t = path.replace('/api/', '').split('/')[0];
      const id = path.split('/').pop();
      db[t] = (db[t] || []).filter(r => String(r.modelo_id) !== String(id));
      calls.del++; return true;
    }
  };
}

(async () => {
  // 1. estrutura vazia cobre todos os módulos/permissões
  const vazio = repo.emptyPermissions();
  const totalAcoes = MODULE_CODES.reduce((s, c) => s + Object.keys(vazio[c].acoes).length, 0);
  const totalCols = MODULE_CODES.reduce((s, c) => s + Object.keys(vazio[c].colunas).length, 0);
  const catAcoes = MODULE_CODES.reduce((s, c) => s + PERMISSIONS_CATALOG[c].actions.length, 0);
  const catCols = MODULE_CODES.reduce((s, c) => s + PERMISSIONS_CATALOG[c].columns.length, 0);
  ok(MODULE_CODES.length === 19 && totalAcoes === catAcoes && totalCols === catCols,
    `estrutura vazia cobre o catálogo: ${MODULE_CODES.length} módulos, ${totalAcoes}/${catAcoes} ações, ${totalCols}/${catCols} colunas`);
  ok(Object.values(vazio).every(m => m.ativo === false), 'estrutura vazia nega tudo (fail-safe)');

  // 2. round-trip: salvar -> ler devolve exatamente o que foi gravado
  const api = makeApi();
  const perms = repo.emptyPermissions();
  perms.mp.ativo = true;
  perms.mp.acoes['mp.view'] = true;
  perms.mp.acoes['mp.delete'] = true;
  perms.mp.colunas['col_mp_codigo'] = true;
  perms.orc.ativo = true;
  perms.orc.acoes['orc.convert'] = true;

  await repo.savePermissionsForModelo(api, 7, perms);
  ok(api.calls.post === 19, `gravou 1 linha em cada uma das 19 tabelas (posts=${api.calls.post})`);

  const lido = await repo.loadPermissionsForModelo(api, 7);
  ok(lido.mp.ativo === true && lido.mp.acoes['mp.view'] === true && lido.mp.acoes['mp.delete'] === true,
    'round-trip: ações marcadas voltam true');
  ok(lido.mp.acoes['mp.edit'] === false, 'round-trip: ação não marcada volta false');
  ok(lido.mp.colunas['col_mp_codigo'] === true && lido.mp.colunas['col_mp_nome'] === false,
    'round-trip: colunas preservadas');
  ok(lido.orc.acoes['orc.convert'] === true && lido.cli.ativo === false,
    'round-trip: módulos independentes');

  // 3. update (2ª gravação usa PUT, não duplica)
  perms.mp.acoes['mp.delete'] = false;
  await repo.savePermissionsForModelo(api, 7, perms);
  ok(api.calls.put === 19 && api.db.perm_mp.length === 1,
    `2ª gravação atualizou via PUT sem duplicar (puts=${api.calls.put}, linhas=${api.db.perm_mp.length})`);
  const lido2 = await repo.loadPermissionsForModelo(api, 7);
  ok(lido2.mp.acoes['mp.delete'] === false, 'update reflete desmarcação');

  // 4. nomes de coluna gravados batem com o catálogo/DDL
  const linhaMp = api.db.perm_mp[0];
  const esperadas = ['modelo_id', 'modulo_ativo',
    ...PERMISSIONS_CATALOG.mp.actions.map(a => a.column),
    ...PERMISSIONS_CATALOG.mp.columns.map(c => c.column)];
  const faltando = esperadas.filter(c => !(c in linhaMp));
  const sobrando = Object.keys(linhaMp).filter(c => !esperadas.includes(c));
  ok(faltando.length === 0 && sobrando.length === 0,
    `payload perm_mp usa exatamente as colunas do DDL (faltando=${faltando.length}, sobrando=${sobrando.length})`);

  // 5. can()
  ok(repo.can(lido2, 'mp.view') === true, 'can(): ação permitida');
  ok(repo.can(lido2, 'mp.delete') === false, 'can(): ação negada');
  ok(repo.can(lido2, 'cli.view') === false, 'can(): módulo inativo nega ação');
  // módulo inativo derruba tudo
  const l3 = JSON.parse(JSON.stringify(lido2)); l3.mp.ativo = false;
  ok(repo.can(l3, 'mp.view') === false, 'can(): modulo_ativo=false nega ações do módulo');

  // 6. Sup Admin x usuário sem perfil
  const sup = await repo.loadPermissionsForUsuario(api, { perfil: 'Sup Admin' });
  ok(sup.mp.ativo && sup.mp.acoes['mp.delete'] && sup.financeiro.ativo, 'Sup Admin recebe acesso total');
  const semPerfil = await repo.loadPermissionsForUsuario(api, { perfil: 'Vendedor' });
  ok(Object.values(semPerfil).every(m => !m.ativo), 'usuário sem perfil: tudo negado (fail-safe)');
  const comPerfil = await repo.loadPermissionsForUsuario(api, { perfil: 'Vendedor', modelo_permissoes_id: 7 });
  ok(comPerfil.mp.acoes['mp.view'] === true, 'usuário com perfil herda permissões do perfil');

  // 7. exclusão
  await repo.deletePermissionsForModelo(api, 7);
  ok((api.db.perm_mp || []).length === 0 && api.calls.del === 19, 'exclusão remove as 19 linhas do perfil');

  // 8. falha de leitura vira negação, não exceção
  const apiRuim = { get: async () => { throw new Error('boom'); }, post: async()=>{}, put: async()=>{}, delete: async()=>{} };
  const seguro = await repo.loadPermissionsForModelo(apiRuim, 9);
  ok(Object.values(seguro).every(m => !m.ativo), 'erro de leitura => tudo negado (fail-safe), sem lançar');

  console.log(fail === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${fail} FALHA(S)`);
  process.exit(fail ? 1 : 0);
})();
