-- ---------------------------------------------------------------------------
-- LIMPEZA OPCIONAL — Contatos (perm_ctt)
--
-- O modulo tem UMA tela: tabela de 5 colunas + painel "Acoes Rapidas" + icone
-- de editar por linha. NAO EXISTE modal nenhum: sem detalhes, sem vinculo a
-- cliente, sem registro de interacao, sem tags e sem status. As 8 acoes e as
-- 12 colunas abaixo cobriam telas que nunca foram construidas.
-- Rode somente se quiser limpar o banco.
-- ---------------------------------------------------------------------------

ALTER TABLE perm_ctt DROP COLUMN IF EXISTS acao_details_view;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS acao_delete;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS acao_link_client;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS acao_unlink_client;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS acao_log_add;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS acao_log_view;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS acao_status_update;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS acao_tag_manage;

ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_ctt_cargo;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_ctt_email;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_ctt_origem;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_ctt_tags;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_ctt_status;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_ctt_ult_interacao;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_ctt_owner;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_log_data;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_log_canal;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_log_assunto;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_log_detalhes;
ALTER TABLE perm_ctt DROP COLUMN IF EXISTS col_log_resp;
