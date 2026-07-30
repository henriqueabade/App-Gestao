-- ---------------------------------------------------------------------------
-- LIMPEZA OPCIONAL — Produtos (perm_prod)
--
-- Estas colunas representavam permissoes que NAO existem na interface real do
-- modulo de Produtos (etapas com responsavel/tempo, variacoes, tabela de
-- colecoes, exportacao, saida de estoque, estoque infinito). Foram retiradas do
-- catalogo. Rode este bloco somente se quiser limpar o banco tambem — o app
-- funciona normalmente com as colunas orfas.
-- ---------------------------------------------------------------------------

ALTER TABLE perm_prod DROP COLUMN IF EXISTS acao_export;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS acao_stage_view;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS acao_stage_advance;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS acao_collection_view;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS acao_collection_edit;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS acao_stock_output;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS acao_stock_infinite_toggle;

ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_prod_categoria;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_prod_custo_total;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_prod_etapa_atual;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_prod_status;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_prod_atualizado_em;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_etp_ordem;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_etp_nome;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_etp_resp;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_etp_inicio;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_etp_fim;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_etp_tempo_real;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_var_nome;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_var_estoque;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_var_reservado;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_var_disponivel;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_col_nome;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_col_periodo;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_col_status;
ALTER TABLE perm_prod DROP COLUMN IF EXISTS col_col_itens;
