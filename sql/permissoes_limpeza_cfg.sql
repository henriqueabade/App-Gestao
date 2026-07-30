-- -------------------------------------------------------------------------
-- LIMPEZA OPCIONAL — Configuracoes (perm_cfg)
--
-- O modulo tem 7 secoes de CAMPOS e NENHUMA tabela: as colunas de papeis e de
-- integracoes nunca foram construidas. Tambem nao existe tela de integracoes.
-- Rode somente se quiser limpar o banco.
-- -------------------------------------------------------------------------

ALTER TABLE perm_cfg DROP COLUMN IF EXISTS acao_integrations_edit;

ALTER TABLE perm_cfg DROP COLUMN IF EXISTS col_role_code;
ALTER TABLE perm_cfg DROP COLUMN IF EXISTS col_role_name;
ALTER TABLE perm_cfg DROP COLUMN IF EXISTS col_role_desc;
ALTER TABLE perm_cfg DROP COLUMN IF EXISTS col_role_modulos;
ALTER TABLE perm_cfg DROP COLUMN IF EXISTS col_role_features;
ALTER TABLE perm_cfg DROP COLUMN IF EXISTS col_int_nome;
ALTER TABLE perm_cfg DROP COLUMN IF EXISTS col_int_status;
ALTER TABLE perm_cfg DROP COLUMN IF EXISTS col_int_ult_sync;
