-- ---------------------------------------------------------------------------
-- LIMPEZA OPCIONAL — Materia-prima (perm_mp)
--
-- A tela de Materia-prima tem UMA tabela com 4 colunas de dados. Nao existem
-- tabelas de movimentacoes de estoque, de processos, de categorias nem de
-- unidades; nao existe exportacao, edicao de categoria/unidade nem modais de
-- entrada/saida/ajuste de estoque. Estas colunas foram retiradas do catalogo.
-- Rode somente se quiser limpar o banco — o app funciona com as colunas orfas.
-- ---------------------------------------------------------------------------

ALTER TABLE perm_mp DROP COLUMN IF EXISTS acao_export;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS acao_category_edit;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS acao_unit_edit;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS acao_stock_view;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS acao_stock_input;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS acao_stock_output;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS acao_stock_adjust;

ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mp_codigo;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mp_categoria;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mp_estoque_min;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mp_fornecedor;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mp_status;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mp_atualizado_em;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mov_data;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mov_tipo;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mov_qtd;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mov_ref;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_mov_usuario;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_prc_nome;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_prc_duracao;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_prc_custo;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_prc_ordem;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_cat_nome;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_cat_desc;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_cat_itens;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_und_nome;
ALTER TABLE perm_mp DROP COLUMN IF EXISTS col_und_desc;
