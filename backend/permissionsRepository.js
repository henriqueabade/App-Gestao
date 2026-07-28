// Leitura/escrita das permissões nas tabelas perm_<modulo>.
//
// Modelo adotado (decisão do projeto): SOMENTE PERFIS.
//   - Cada perfil (modelos_permissoes) tem exatamente 1 linha em cada perm_<modulo>.
//   - O usuário aponta para um perfil via usuarios.modelo_permissoes_id.
//   - Não existe permissão "solta" por usuário: para customizar, cria-se um novo perfil.
//
// As permissões trafegam no app como um objeto plano:
//   {
//     mp:  { ativo: true, acoes: { 'mp.view': true, ... }, colunas: { col_mp_codigo: true, ... } },
//     ...
//   }

const { PERMISSIONS_CATALOG, MODULE_CODES } = require('./permissionsCatalog');

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return ['1', 't', 'true', 'yes', 'sim', 'on'].includes(v);
  }
  return false;
}

/** Estrutura vazia (tudo negado) — usada como base e como fallback seguro. */
function emptyPermissions() {
  const out = {};
  for (const code of MODULE_CODES) {
    const mod = PERMISSIONS_CATALOG[code];
    out[code] = { ativo: false, acoes: {}, colunas: {} };
    mod.actions.forEach(a => { out[code].acoes[a.key] = false; });
    mod.columns.forEach(c => { out[code].colunas[c.key] = false; });
  }
  return out;
}

/** Estrutura com tudo liberado — usada para o Sup Admin. */
function fullPermissions() {
  const out = emptyPermissions();
  for (const code of MODULE_CODES) {
    out[code].ativo = true;
    Object.keys(out[code].acoes).forEach(k => { out[code].acoes[k] = true; });
    Object.keys(out[code].colunas).forEach(k => { out[code].colunas[k] = true; });
  }
  return out;
}

/** Converte uma linha da tabela perm_<modulo> para o formato do app. */
function rowToModule(code, row) {
  const mod = PERMISSIONS_CATALOG[code];
  const bloco = { ativo: false, acoes: {}, colunas: {} };
  if (!mod) return bloco;
  bloco.ativo = toBool(row?.modulo_ativo);
  for (const a of mod.actions) bloco.acoes[a.key] = toBool(row?.[a.column]);
  for (const c of mod.columns) bloco.colunas[c.key] = toBool(row?.[c.column]);
  return bloco;
}

/** Converte o formato do app para o payload da tabela perm_<modulo>. */
function moduleToRow(code, bloco = {}, modeloId) {
  const mod = PERMISSIONS_CATALOG[code];
  const payload = { modelo_id: modeloId, modulo_ativo: toBool(bloco.ativo) };
  if (!mod) return payload;
  for (const a of mod.actions) payload[a.column] = toBool(bloco.acoes?.[a.key]);
  for (const c of mod.columns) payload[c.column] = toBool(bloco.colunas?.[c.key]);
  return payload;
}

/**
 * Converte as seleções do modal para a estrutura do app.
 * O modal envia listas planas do que está MARCADO:
 *   acoes:   ['mp.view', 'mp.delete', ...]
 *   colunas: ['col_mp_codigo', ...]
 *   modulos: ['module_mp', 'mp', ...]   (aceita com ou sem prefixo)
 * Tudo que não vier nas listas fica FALSE (desmarcado = negado).
 */
function fromSelections({ acoes = [], colunas = [], modulos = [] } = {}) {
  const resultado = emptyPermissions();

  const ativos = new Set(
    (Array.isArray(modulos) ? modulos : [])
      .map(m => String(m || '').replace(/^module_/, '').trim())
      .filter(Boolean)
  );
  for (const code of MODULE_CODES) {
    if (ativos.has(code)) resultado[code].ativo = true;
  }

  const marcadasAcoes = new Set((Array.isArray(acoes) ? acoes : []).map(String));
  const marcadasColunas = new Set((Array.isArray(colunas) ? colunas : []).map(String));

  for (const code of MODULE_CODES) {
    const mod = PERMISSIONS_CATALOG[code];
    for (const a of mod.actions) {
      if (marcadasAcoes.has(a.key)) resultado[code].acoes[a.key] = true;
    }
    for (const c of mod.columns) {
      if (marcadasColunas.has(c.key)) resultado[code].colunas[c.key] = true;
    }
  }

  return resultado;
}

/** Converte a estrutura do app de volta para as listas planas do modal. */
function toSelections(permissoes = {}) {
  const acoes = [];
  const colunas = [];
  const modulos = [];
  for (const code of MODULE_CODES) {
    const bloco = permissoes[code];
    if (!bloco) continue;
    if (bloco.ativo) modulos.push(code);
    for (const [k, v] of Object.entries(bloco.acoes || {})) if (v) acoes.push(k);
    for (const [k, v] of Object.entries(bloco.colunas || {})) if (v) colunas.push(k);
  }
  return { acoes, colunas, modulos };
}

/** Lê todas as permissões de um perfil. */
async function loadPermissionsForModelo(api, modeloId) {
  const resultado = emptyPermissions();
  if (!modeloId) return resultado;

  await Promise.all(
    MODULE_CODES.map(async code => {
      const tabela = PERMISSIONS_CATALOG[code].table;
      try {
        const linhas = await api.get(`/api/${tabela}`, { query: { modelo_id: modeloId } });
        const linha = Array.isArray(linhas)
          ? linhas.find(l => String(l?.modelo_id) === String(modeloId))
          : linhas;
        if (linha) resultado[code] = rowToModule(code, linha);
      } catch (err) {
        // Tabela ausente ou erro pontual: mantém o módulo negado (fail-safe).
        console.error(`[permissoes] falha ao ler ${tabela}:`, err?.message || err);
      }
    })
  );

  return resultado;
}

/** Grava (upsert) todas as permissões de um perfil. */
async function savePermissionsForModelo(api, modeloId, permissoes = {}) {
  if (!modeloId) throw new Error('modelo_id é obrigatório para salvar permissões.');

  for (const code of MODULE_CODES) {
    const tabela = PERMISSIONS_CATALOG[code].table;
    const payload = moduleToRow(code, permissoes[code], modeloId);
    try {
      const existentes = await api
        .get(`/api/${tabela}`, { query: { modelo_id: modeloId } })
        .catch(() => []);
      const existe = Array.isArray(existentes)
        ? existentes.some(l => String(l?.modelo_id) === String(modeloId))
        : Boolean(existentes);

      if (existe) {
        await api.put(`/api/${tabela}/${modeloId}`, payload);
      } else {
        await api.post(`/api/${tabela}`, payload);
      }
    } catch (err) {
      console.error(`[permissoes] falha ao gravar ${tabela}:`, err?.message || err);
      throw err;
    }
  }
}

/** Remove as linhas de permissão de um perfil (ao excluir o perfil). */
async function deletePermissionsForModelo(api, modeloId) {
  if (!modeloId) return;
  for (const code of MODULE_CODES) {
    const tabela = PERMISSIONS_CATALOG[code].table;
    try {
      await api.delete(`/api/${tabela}/${modeloId}`);
    } catch (err) {
      if (err?.status !== 404) {
        console.error(`[permissoes] falha ao excluir ${tabela}:`, err?.message || err);
      }
    }
  }
}

/**
 * Sup Admin? Comparação tolerante a caixa, acento, espaço, hífen e underscore
 * ("Sup Admin", "SUP-ADMIN", "supadmin", "Super Admin" ...).
 * Regra do projeto: Sup Admin tem TODAS as permissões, sem exceção.
 */
function isSupAdmin(usuario) {
  const bruto = usuario?.perfil ?? usuario?.tipo_usuario ?? usuario?.role ?? '';
  const perfil = String(bruto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s._-]+/g, '')
    .toLowerCase();
  return perfil === 'supadmin' || perfil === 'superadmin';
}

/**
 * Permissões efetivas de um usuário.
 * Sup Admin recebe acesso total; usuário sem perfil recebe tudo negado.
 */
async function loadPermissionsForUsuario(api, usuario) {
  if (!usuario) return emptyPermissions();
  if (isSupAdmin(usuario)) {
    return fullPermissions();
  }
  const modeloId = usuario.modelo_permissoes_id ?? usuario.modeloPermissoesId ?? null;
  if (!modeloId) return emptyPermissions();
  return loadPermissionsForModelo(api, modeloId);
}

/** Verifica uma chave de permissão ("mp.view" / "col_mp_codigo") na estrutura. */
function can(permissoes, chave) {
  if (!permissoes || !chave) return false;
  for (const code of MODULE_CODES) {
    const bloco = permissoes[code];
    if (!bloco) continue;
    if (Object.prototype.hasOwnProperty.call(bloco.acoes || {}, chave)) {
      return Boolean(bloco.ativo) && Boolean(bloco.acoes[chave]);
    }
    if (Object.prototype.hasOwnProperty.call(bloco.colunas || {}, chave)) {
      return Boolean(bloco.ativo) && Boolean(bloco.colunas[chave]);
    }
  }
  return false;
}

module.exports = {
  isSupAdmin,
  emptyPermissions,
  fullPermissions,
  fromSelections,
  toSelections,
  rowToModule,
  moduleToRow,
  loadPermissionsForModelo,
  savePermissionsForModelo,
  deletePermissionsForModelo,
  loadPermissionsForUsuario,
  can
};
