-- ============================================================================
--  novousuario.sql
--  Suporte ao modal "Novo usuário" da Gestão de Usuários.
--
--  Cobre duas frentes:
--    1) a permissão da ação no modelo do módulo (tabela perm_usuarios);
--    2) as colunas que o cadastro grava em `usuarios` para o usuário já
--       nascer liberado — sem confirmação de e-mail e sem fila de aprovação.
--
--  Script idempotente: pode rodar mais de uma vez sem erro, e não sobrescreve
--  permissão nem dado de ninguém.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Permissão da ação no modelo do módulo
--
--    A tabela é criada aqui caso ainda não exista (se você já aplicou
--    sql/perm_usuarios.sql, este bloco não muda nada).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS perm_usuarios (
  id         SERIAL PRIMARY KEY,
  modelo_id  INTEGER NOT NULL REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  UNIQUE (modelo_id)
);

ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE;

-- A ação do botão/modal "Novo Usuário".
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_create BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.create · Cadastrar usuário

-- Demais ações do módulo (ficam aqui para a tabela nunca sair incompleta).
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_view          BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.view
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_search        BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.search
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_edit          BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.edit
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_delete        BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.delete
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_status_toggle BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.status.toggle
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_activity_view BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.activity.view
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_approve       BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.approve
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_roles_view    BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.roles.view
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_roles_manage  BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.roles.manage
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS acao_roles_assign  BOOLEAN NOT NULL DEFAULT FALSE;  -- usuarios.roles.assign

-- Colunas da grade
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_avatar            BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_nome              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_email             BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_perfil            BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_situacao          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_status            BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_ultimo_login      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_ultima_alteracao  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE perm_usuarios ADD COLUMN IF NOT EXISTS col_usr_acoes             BOOLEAN NOT NULL DEFAULT FALSE;

-- Todo modelo existente precisa ter uma linha, senão o módulo não é avaliado.
INSERT INTO perm_usuarios (modelo_id)
SELECT m.id FROM modelos_permissoes m
 WHERE NOT EXISTS (SELECT 1 FROM perm_usuarios p WHERE p.modelo_id = m.id);

-- ---------------------------------------------------------------------------
-- 2) Colunas gravadas pelo cadastro interno
--
--    O usuário criado pelo Sup Admin já entra ativo e confirmado. São os
--    mesmos campos que a aprovação por e-mail preenche — os dois caminhos
--    deixam o registro no mesmo estado.
-- ---------------------------------------------------------------------------

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone             TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil               TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS descricao            TEXT;         -- campo "Observações" do modal
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_usuario         TEXT;         -- foto em dataURL (PNG/JPEG, até 1 MB)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avatar_version       BIGINT;       -- quebra o cache da imagem ao trocar
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS verificado           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS confirmacao          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_confirmado     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_confirmado_em  TIMESTAMP;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS hora_ativacao        TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS data_ativacao        TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aprovacao_token      TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS confirmacao_token    TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS modelo_permissoes_id INTEGER;

-- E-mail é a chave de login: não pode repetir.
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unico ON usuarios (LOWER(TRIM(email)));

COMMIT;

-- ---------------------------------------------------------------------------
-- Opcional: liberar o cadastro para um perfil específico
-- (o Sup Admin não precisa — ele passa por cima de qualquer permissão)
-- ---------------------------------------------------------------------------
-- UPDATE perm_usuarios SET modulo_ativo = TRUE, acao_view = TRUE, acao_create = TRUE
--  WHERE modelo_id = (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
-- SELECT m.nome, p.modulo_ativo, p.acao_create
--   FROM perm_usuarios p
--   JOIN modelos_permissoes m ON m.id = p.modelo_id
--  ORDER BY m.nome;
