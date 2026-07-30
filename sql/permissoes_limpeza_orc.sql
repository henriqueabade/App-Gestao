-- ---------------------------------------------------------------------------
-- LIMPEZA OPCIONAL — Orcamentos (perm_orc)
--
-- A grade tem 6 colunas (Codigo, Cliente, Data, Valor Total, Condicao, Status)
-- e a tabela de itens tem 6 (ITEM..TOT R$). Nao existem colunas de vendedor,
-- validade, contagem de itens, subtotal, descontos, frete, SKU, observacoes do
-- item, parcelas nem prazo. Nenhuma ACAO foi removida: todas as 8 que existiam
-- tem elemento na tela. Rode somente se quiser limpar o banco.
-- ---------------------------------------------------------------------------

ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_vendedor;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_validade;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_itens;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_subtotal;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_desc;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_frete_outros;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_it_sku;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_it_obs;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_cond_parc;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_cond_prazo;
ALTER TABLE perm_orc DROP COLUMN IF EXISTS col_orc_cond_validade;
