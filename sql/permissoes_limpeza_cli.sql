-- ---------------------------------------------------------------------------
-- LIMPEZA OPCIONAL — Clientes (perm_cli)
--
-- A grade tem 6 colunas (Nome, CNPJ, Pais, Estado, Status, Dono). Nos modais,
-- Contatos tem 5 colunas e Ordens tem 6. Nao existem campos de comprador,
-- telefone/e-mail do cliente (isso vive em Contatos), transportadora, tipo de
-- endereco, tags, status do contato nem ultima interacao. Nenhuma ACAO foi
-- removida. Rode somente se quiser limpar o banco.
-- ---------------------------------------------------------------------------

ALTER TABLE perm_cli DROP COLUMN IF EXISTS col_cli_comprador;
ALTER TABLE perm_cli DROP COLUMN IF EXISTS col_cli_tel;
ALTER TABLE perm_cli DROP COLUMN IF EXISTS col_cli_email;
ALTER TABLE perm_cli DROP COLUMN IF EXISTS col_cli_transportadora;
ALTER TABLE perm_cli DROP COLUMN IF EXISTS col_end_tipo;
ALTER TABLE perm_cli DROP COLUMN IF EXISTS col_ctt_tags;
ALTER TABLE perm_cli DROP COLUMN IF EXISTS col_ctt_status;
ALTER TABLE perm_cli DROP COLUMN IF EXISTS col_ctt_ult_interacao;
