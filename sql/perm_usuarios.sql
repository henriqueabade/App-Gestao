-- =====================================================================
-- MODULO: Usuários  (tabela perm_usuarios)
-- 11 acoes + 9 colunas + modulo_ativo
-- Idempotente: pode rodar mesmo se a tabela ja existir.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS perm_usuarios (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- Acoes
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_view                    BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.view · Ver lista
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_search                  BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.search · Buscar/filtrar
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_create                  BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.create · Cadastrar usuário
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_edit                    BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.edit · Editar usuário
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_delete                  BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.delete · Excluir usuário
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_status_toggle           BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.status.toggle · Ativar/desativar acesso
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_activity_view           BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.activity.view · Ver atividade
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_approve                 BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.approve · Aprovar cadastro
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_roles_view              BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.roles.view · Ver modelos de permissão
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_roles_manage            BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.roles.manage · Gerenciar modelos de permissão
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_roles_assign            BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.roles.assign · Aplicar perfil ao usuário

-- Colunas visiveis
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_avatar               BOOLEAN NOT NULL DEFAULT FALSE;  -- Avatar
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_nome                 BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_email                BOOLEAN NOT NULL DEFAULT FALSE;  -- E-mail
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_perfil               BOOLEAN NOT NULL DEFAULT FALSE;  -- Perfil
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_situacao             BOOLEAN NOT NULL DEFAULT FALSE;  -- Situação (online/offline)
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_status               BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_ultimo_login         BOOLEAN NOT NULL DEFAULT FALSE;  -- Último login
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_ultima_alteracao     BOOLEAN NOT NULL DEFAULT FALSE;  -- Última alteração
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_acoes                BOOLEAN NOT NULL DEFAULT FALSE;  -- Ações

-- Garante 1 linha por perfil existente
INSERT INTO perm_usuarios (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;

-- Perfil Administrador com tudo liberado neste modulo
UPDATE perm_usuarios SET modulo_ativo = TRUE, acao_view = TRUE, acao_search = TRUE, acao_create = TRUE, acao_edit = TRUE, acao_delete = TRUE, acao_status_toggle = TRUE, acao_activity_view = TRUE, acao_approve = TRUE, acao_roles_view = TRUE, acao_roles_manage = TRUE, acao_roles_assign = TRUE, col_usr_avatar = TRUE, col_usr_nome = TRUE, col_usr_email = TRUE, col_usr_perfil = TRUE, col_usr_situacao = TRUE, col_usr_status = TRUE, col_usr_ultimo_login = TRUE, col_usr_ultima_alteracao = TRUE, col_usr_acoes = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');

COMMIT;
