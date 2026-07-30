-- -------------------------------------------------------------------------
-- LIMPEZA OPCIONAL — Relatorios (perm_rel)
--
-- Nao existe botao proprio de "Rodar" (o relatorio roda ao filtrar), nem tela
-- de gerenciar presets, nem geracao de link compartilhavel.
-- Rode somente se quiser limpar o banco.
-- -------------------------------------------------------------------------

ALTER TABLE perm_rel DROP COLUMN IF EXISTS acao_run;
ALTER TABLE perm_rel DROP COLUMN IF EXISTS acao_preset_manage;
ALTER TABLE perm_rel DROP COLUMN IF EXISTS acao_share_link;
