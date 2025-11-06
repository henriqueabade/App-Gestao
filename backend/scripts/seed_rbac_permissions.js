const db = require('../db');

const MODULE_DEFINITIONS = [
  {
    code: 'clientes',
    name: 'Clientes',
    description: 'Gerenciamento de clientes e contatos.',
    aliases: ['cliente'],
    order: 1,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'inserir', name: 'Inserir', aliases: ['criar', 'create', 'add', 'adicionar', 'incluir'], order: 3 },
      { code: 'excluir', name: 'Excluir', aliases: ['remover', 'delete', 'remove', 'apagar'], order: 4 },
      { code: 'exportar', name: 'Exportar', aliases: ['export'], order: 5 }
    ],
    tables: [
      {
        code: 'clientes_grid',
        name: 'Clientes - Grid',
        order: 1,
        columns: [
          { code: 'nome', name: 'Nome', description: 'Nome do cliente', order: 1 },
          { code: 'email', name: 'E-mail', description: 'Endereço de e-mail', order: 2 },
          { code: 'telefone', name: 'Telefone', description: 'Telefone principal', order: 3 }
        ]
      }
    ]
  },
  {
    code: 'pedidos',
    name: 'Pedidos',
    description: 'Gestão de pedidos e acompanhamento de status.',
    aliases: ['pedido'],
    order: 2,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'criar', name: 'Criar', aliases: ['inserir', 'create', 'add', 'adicionar', 'incluir'], order: 3 },
      { code: 'cancelar', name: 'Cancelar', aliases: ['cancel'], order: 4 },
      { code: 'exportar', name: 'Exportar', aliases: ['export'], order: 5 }
    ],
    tables: [
      {
        code: 'pedidos_grid',
        name: 'Pedidos - Grid',
        order: 1,
        columns: [
          { code: 'codigo', name: 'Código', description: 'Código do pedido', order: 1 },
          { code: 'cliente', name: 'Cliente', description: 'Cliente associado', order: 2 },
          { code: 'valor_total', name: 'Valor Total', description: 'Valor agregado do pedido', order: 3 }
        ]
      }
    ]
  },
  {
    code: 'orcamentos',
    name: 'Orçamentos',
    description: 'Controle de orçamentos e propostas.',
    aliases: ['orcamento', 'cotacoes', 'cotacao'],
    order: 3,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'criar', name: 'Criar', aliases: ['inserir', 'create', 'add', 'adicionar', 'incluir'], order: 3 },
      { code: 'aprovar', name: 'Aprovar', aliases: ['approve'], order: 4 },
      { code: 'enviar', name: 'Enviar', aliases: ['send'], order: 5 }
    ],
    tables: [
      {
        code: 'orcamentos_grid',
        name: 'Orçamentos - Grid',
        order: 1,
        columns: [
          { code: 'referencia', name: 'Referência', description: 'Identificador interno', order: 1 },
          { code: 'cliente', name: 'Cliente', description: 'Cliente interessado', order: 2 },
          { code: 'status', name: 'Status', description: 'Situação atual do orçamento', order: 3 }
        ]
      }
    ]
  },
  {
    code: 'produtos',
    name: 'Produtos',
    description: 'Catálogo de produtos e itens negociados.',
    aliases: ['produto', 'itens', 'item'],
    order: 4,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'inserir', name: 'Inserir', aliases: ['criar', 'create', 'add', 'adicionar', 'incluir'], order: 3 },
      { code: 'inativar', name: 'Inativar', aliases: ['desativar', 'disable'], order: 4 },
      { code: 'exportar', name: 'Exportar', aliases: ['export'], order: 5 }
    ],
    tables: [
      {
        code: 'produtos_grid',
        name: 'Produtos - Grid',
        order: 1,
        columns: [
          { code: 'codigo', name: 'Código', description: 'Código do produto', order: 1 },
          { code: 'descricao', name: 'Descrição', description: 'Descrição resumida', order: 2 },
          { code: 'preco', name: 'Preço', description: 'Preço unitário', order: 3 }
        ]
      }
    ]
  },
  {
    code: 'materia_prima',
    name: 'Matéria-Prima',
    description: 'Gestão de insumos e matérias-primas.',
    aliases: ['materia', 'insumos', 'insumo'],
    order: 8,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'inserir', name: 'Inserir', aliases: ['criar', 'create', 'add', 'adicionar', 'incluir'], order: 3 },
      { code: 'excluir', name: 'Excluir', aliases: ['remover', 'delete', 'apagar'], order: 4 },
      { code: 'exportar', name: 'Exportar', aliases: ['export'], order: 5 }
    ],
    tables: []
  },
  {
    code: 'contatos',
    name: 'Contatos',
    description: 'Gestão de contatos e relacionamento.',
    aliases: ['contato', 'contacts'],
    order: 9,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'inserir', name: 'Inserir', aliases: ['criar', 'create', 'add', 'adicionar', 'incluir'], order: 3 },
      { code: 'excluir', name: 'Excluir', aliases: ['remover', 'delete', 'apagar'], order: 4 },
      { code: 'exportar', name: 'Exportar', aliases: ['export'], order: 5 }
    ],
    tables: []
  },
  {
    code: 'prospeccoes',
    name: 'Prospecções',
    description: 'Acompanhamento de prospecções comerciais.',
    aliases: ['prospeccao', 'prospects', 'prospectos'],
    order: 10,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'inserir', name: 'Inserir', aliases: ['criar', 'create', 'add', 'adicionar', 'incluir'], order: 3 },
      { code: 'excluir', name: 'Excluir', aliases: ['remover', 'delete', 'apagar'], order: 4 },
      { code: 'exportar', name: 'Exportar', aliases: ['export'], order: 5 }
    ],
    tables: []
  },
  {
    code: 'financeiro',
    name: 'Financeiro',
    description: 'Análises financeiras e aprovações.',
    aliases: ['financeiro', 'finance'],
    order: 5,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'aprovar', name: 'Aprovar', aliases: ['approve'], order: 3 },
      { code: 'exportar', name: 'Exportar', aliases: ['export'], order: 4 }
    ],
    tables: []
  },
  {
    code: 'relatorios',
    name: 'Relatórios',
    description: 'Relatórios gerenciais e dashboards.',
    aliases: ['relatorio', 'reports', 'report'],
    order: 6,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'exportar', name: 'Exportar', aliases: ['export'], order: 2 }
    ],
    tables: []
  },
  {
    code: 'tarefas',
    name: 'Tarefas',
    description: 'Gestão de atividades e tarefas operacionais.',
    aliases: ['tarefa', 'tasks', 'task'],
    order: 11,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'inserir', name: 'Inserir', aliases: ['criar', 'create', 'add', 'adicionar', 'incluir'], order: 2 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 3 },
      { code: 'concluir', name: 'Concluir', aliases: ['finalizar', 'complete', 'done'], order: 4 },
      { code: 'excluir', name: 'Excluir', aliases: ['remover', 'delete', 'apagar'], order: 5 }
    ],
    tables: []
  },
  {
    code: 'configuracoes',
    name: 'Configurações',
    description: 'Painel de configurações e preferências.',
    aliases: ['configuracao', 'settings'],
    order: 12,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'gerenciar', name: 'Gerenciar', aliases: ['manage', 'administrar'], order: 3 },
      { code: 'exportar', name: 'Exportar', aliases: ['export'], order: 4 }
    ],
    tables: []
  },
  {
    code: 'usuarios',
    name: 'Usuários',
    description: 'Gestão de contas e permissões.',
    aliases: ['usuario', 'users', 'user'],
    order: 7,
    features: [
      { code: 'visualizar', name: 'Visualizar', aliases: ['ver', 'view', 'read', 'ler'], order: 1 },
      { code: 'editar', name: 'Editar', aliases: ['edit', 'write', 'atualizar', 'update'], order: 2 },
      { code: 'permissoes', name: 'Gerenciar permissões', aliases: ['permissoes', 'permissions', 'permissao', 'permission', 'roles'], order: 3 },
      { code: 'aprovar', name: 'Aprovar', aliases: ['approve'], order: 4 }
    ],
    tables: [
      {
        code: 'usuarios_grid',
        name: 'Usuários - Grid',
        order: 1,
        columns: [
          { code: 'nome', name: 'Nome', description: 'Nome completo', order: 1 },
          { code: 'email', name: 'E-mail', description: 'E-mail de acesso', order: 2 },
          { code: 'status', name: 'Status', description: 'Situação do usuário', order: 3 }
        ]
      }
    ]
  }
];

const ROLE_DEFINITIONS = [
  {
    code: 'SUPERADMIN',
    name: 'Super Administrador',
    description: 'Acesso total ao sistema.',
    grantAllModules: true
  },
  {
    code: 'admin',
    name: 'Administrador',
    description: 'Administra operações sem alterar permissões globais.',
    grantAllModules: true,
    denyFeatures: {
      usuarios: ['permissoes']
    }
  },
  {
    code: 'vendas',
    name: 'Equipe de Vendas',
    description: 'Equipe comercial com acesso aos módulos de relacionamento.',
    moduleFeatures: {
      clientes: ['visualizar', 'editar', 'inserir', 'exportar'],
      pedidos: ['visualizar', 'criar', 'editar', 'exportar'],
      orcamentos: ['visualizar', 'criar', 'enviar'],
      produtos: ['visualizar'],
      relatorios: ['visualizar'],
      contatos: ['visualizar', 'inserir', 'editar', 'exportar'],
      prospeccoes: ['visualizar', 'inserir', 'editar', 'exportar'],
      tarefas: ['visualizar', 'inserir', 'editar']
    }
  }
];

const ROLE_COLUMN_EDIT_POLICIES = {
  SUPERADMIN: 'all',
  admin: 'all',
  vendas: ['pedidos', 'orcamentos']
};

async function ensureSchema(query) {
  await query('CREATE SCHEMA IF NOT EXISTS rbac');

  await query(`CREATE TABLE IF NOT EXISTS rbac.role (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS rbac.module (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    order_index INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await query(`CREATE TABLE IF NOT EXISTS rbac.feature (
    id SERIAL PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES rbac.module(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    order_index INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (module_id, code)
  )`);

  await query(`CREATE TABLE IF NOT EXISTS rbac.ui_table (
    id SERIAL PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES rbac.module(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    order_index INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (module_id, code)
  )`);

  await query(`CREATE TABLE IF NOT EXISTS rbac.ui_column (
    id SERIAL PRIMARY KEY,
    ui_table_id INTEGER NOT NULL REFERENCES rbac.ui_table(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    data_type TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    order_index INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ui_table_id, code)
  )`);

  await query(`CREATE TABLE IF NOT EXISTS rbac.role_module_access (
    role_id INTEGER NOT NULL REFERENCES rbac.role(id) ON DELETE CASCADE,
    module_id INTEGER NOT NULL REFERENCES rbac.module(id) ON DELETE CASCADE,
    permitted BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, module_id)
  )`);

  await query(`CREATE TABLE IF NOT EXISTS rbac.role_feature_access (
    role_id INTEGER NOT NULL REFERENCES rbac.role(id) ON DELETE CASCADE,
    feature_id INTEGER NOT NULL REFERENCES rbac.feature(id) ON DELETE CASCADE,
    permitted BOOLEAN NOT NULL DEFAULT FALSE,
    scopes JSONB NOT NULL DEFAULT '{}'::JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, feature_id)
  )`);

  await query(`CREATE TABLE IF NOT EXISTS rbac.role_column_access (
    role_id INTEGER NOT NULL REFERENCES rbac.role(id) ON DELETE CASCADE,
    ui_column_id INTEGER NOT NULL REFERENCES rbac.ui_column(id) ON DELETE CASCADE,
    feature_code TEXT,
    can_view BOOLEAN NOT NULL DEFAULT FALSE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, ui_column_id)
  )`);
}

async function upsertModule(query, definition) {
  const { rows } = await query(
    `INSERT INTO rbac.module (code, name, description, aliases, order_index)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (code)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       aliases = EXCLUDED.aliases,
       order_index = EXCLUDED.order_index,
       updated_at = NOW()
     RETURNING id`,
    [definition.code, definition.name, definition.description || null, definition.aliases || [], definition.order || null]
  );
  return rows[0].id;
}

async function upsertFeature(query, moduleId, definition) {
  const { rows } = await query(
    `INSERT INTO rbac.feature (module_id, code, name, description, aliases, order_index)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (module_id, code)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       aliases = EXCLUDED.aliases,
       order_index = EXCLUDED.order_index,
       updated_at = NOW()
     RETURNING id`,
    [moduleId, definition.code, definition.name, definition.description || null, definition.aliases || [], definition.order || null]
  );
  return rows[0].id;
}

async function upsertTable(query, moduleId, definition) {
  const { rows } = await query(
    `INSERT INTO rbac.ui_table (module_id, code, name, description, order_index)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (module_id, code)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       order_index = EXCLUDED.order_index,
       updated_at = NOW()
     RETURNING id`,
    [moduleId, definition.code, definition.name, definition.description || null, definition.order || null]
  );
  return rows[0].id;
}

async function upsertColumn(query, tableId, definition) {
  const { rows } = await query(
    `INSERT INTO rbac.ui_column (ui_table_id, code, name, description, data_type, metadata, order_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (ui_table_id, code)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       data_type = EXCLUDED.data_type,
       metadata = EXCLUDED.metadata,
       order_index = EXCLUDED.order_index,
       updated_at = NOW()
     RETURNING id`,
    [
      tableId,
      definition.code,
      definition.name,
      definition.description || null,
      definition.data_type || null,
      definition.metadata || {},
      definition.order || null
    ]
  );
  return rows[0].id;
}

async function upsertRole(query, definition) {
  const { rows } = await query(
    `INSERT INTO rbac.role (code, name, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (code)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       updated_at = NOW()
     RETURNING id`,
    [definition.code, definition.name, definition.description || null]
  );
  return rows[0].id;
}

async function upsertRoleModuleAccess(query, roleId, moduleId, permitted) {
  await query(
    `INSERT INTO rbac.role_module_access (role_id, module_id, permitted)
     VALUES ($1, $2, $3)
     ON CONFLICT (role_id, module_id)
     DO UPDATE SET
       permitted = EXCLUDED.permitted,
       updated_at = NOW()`,
    [roleId, moduleId, Boolean(permitted)]
  );
}

async function upsertRoleFeatureAccess(query, roleId, featureId, { permitted, scopes, metadata }) {
  await query(
    `INSERT INTO rbac.role_feature_access (role_id, feature_id, permitted, scopes, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (role_id, feature_id)
     DO UPDATE SET
       permitted = EXCLUDED.permitted,
       scopes = EXCLUDED.scopes,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()`,
    [roleId, featureId, Boolean(permitted), scopes || {}, metadata || {}]
  );
}

async function upsertRoleColumnAccess(query, roleId, columnId, { can_view, can_edit, feature_code, metadata }) {
  await query(
    `INSERT INTO rbac.role_column_access (role_id, ui_column_id, feature_code, can_view, can_edit, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (role_id, ui_column_id)
     DO UPDATE SET
       feature_code = EXCLUDED.feature_code,
       can_view = EXCLUDED.can_view,
       can_edit = EXCLUDED.can_edit,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()`,
    [roleId, columnId, feature_code || null, Boolean(can_view), Boolean(can_edit), metadata || {}]
  );
}

async function seedRbacPermissions(options = {}) {
  const exec = typeof options.query === 'function' ? options.query : (text, params) => db.query(text, params);
  const query = (text, params) => exec(text, params);

  await ensureSchema(query);

  const moduleIdMap = new Map();
  const featureIdMap = new Map();
  const tableIdMap = new Map();
  const columnIdMap = new Map();

  for (const moduleDef of MODULE_DEFINITIONS) {
    const moduleId = await upsertModule(query, moduleDef);
    moduleIdMap.set(moduleDef.code, moduleId);

    for (const feature of moduleDef.features || []) {
      const featureId = await upsertFeature(query, moduleId, feature);
      featureIdMap.set(`${moduleDef.code}:${feature.code}`, featureId);
    }

    for (const table of moduleDef.tables || []) {
      const tableId = await upsertTable(query, moduleId, table);
      tableIdMap.set(`${moduleDef.code}:${table.code}`, tableId);
      for (const column of table.columns || []) {
        const columnId = await upsertColumn(query, tableId, column);
        columnIdMap.set(`${moduleDef.code}:${table.code}:${column.code}`, columnId);
      }
    }
  }

  const featureCatalog = new Map();
  for (const moduleDef of MODULE_DEFINITIONS) {
    featureCatalog.set(
      moduleDef.code,
      new Set((moduleDef.features || []).map(feature => feature.code))
    );
  }

  const roleIdMap = new Map();
  for (const roleDef of ROLE_DEFINITIONS) {
    const roleId = await upsertRole(query, roleDef);
    roleIdMap.set(roleDef.code, roleId);

    const editablePolicy = ROLE_COLUMN_EDIT_POLICIES[roleDef.code];
    const editableAll = editablePolicy === 'all';
    const editableModules = new Set(Array.isArray(editablePolicy) ? editablePolicy : []);

    const grantedModules = new Map();

    if (roleDef.grantAllModules) {
      for (const moduleDef of MODULE_DEFINITIONS) {
        grantedModules.set(moduleDef.code, new Set(featureCatalog.get(moduleDef.code)));
      }
      if (roleDef.denyFeatures) {
        for (const [moduleCode, denies] of Object.entries(roleDef.denyFeatures)) {
          if (!grantedModules.has(moduleCode)) continue;
          for (const featureCode of denies) {
            grantedModules.get(moduleCode).delete(featureCode);
          }
        }
      }
    }

    if (roleDef.moduleFeatures) {
      for (const [moduleCode, features] of Object.entries(roleDef.moduleFeatures)) {
        const set = grantedModules.get(moduleCode) || new Set();
        for (const feature of features) {
          set.add(feature);
        }
        grantedModules.set(moduleCode, set);
      }
    }

    for (const [moduleCode, featureSet] of grantedModules.entries()) {
      const moduleId = moduleIdMap.get(moduleCode);
      if (!moduleId) continue;
      await upsertRoleModuleAccess(query, roleId, moduleId, featureSet.size > 0);

      for (const featureCode of featureSet) {
        const featureId = featureIdMap.get(`${moduleCode}:${featureCode}`);
        if (!featureId) continue;
        await upsertRoleFeatureAccess(query, roleId, featureId, {
          permitted: true,
          scopes: {},
          metadata: {}
        });
      }

      const moduleDefinition = MODULE_DEFINITIONS.find(mod => mod.code === moduleCode);
      if (!moduleDefinition) continue;

      for (const table of moduleDefinition.tables || []) {
        for (const column of table.columns || []) {
          const columnId = columnIdMap.get(`${moduleCode}:${table.code}:${column.code}`);
          if (!columnId) continue;
          const canEdit = editableAll || editableModules.has(moduleCode);
          await upsertRoleColumnAccess(query, roleId, columnId, {
            can_view: true,
            can_edit: canEdit,
            feature_code: 'visualizar',
            metadata: {}
          });
        }
      }
    }
  }
}

if (require.main === module) {
  seedRbacPermissions()
    .then(() => {
      console.log('RBAC seed executado com sucesso.');
      process.exit(0);
    })
    .catch(err => {
      console.error('Falha ao executar seed RBAC:', err);
      process.exit(1);
    });
}

module.exports = { seedRbacPermissions };
