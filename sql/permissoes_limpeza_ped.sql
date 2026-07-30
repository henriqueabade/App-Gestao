-- ---------------------------------------------------------------------------
-- LIMPEZA OPCIONAL — Pedidos (perm_ped)
--
-- Nao existe tabela de logistica (transportadora/rastreio/frete), nem colunas
-- de vendedor, entrega, itens, origem ou "abate estoque" na grade. "Faturar
-- pedido" e "Abater estoque" nao tem elemento na interface: o abatimento e
-- efeito da conversao, tratado no backend. Rode somente se quiser limpar o
-- banco — o app funciona com as colunas orfas.
-- ---------------------------------------------------------------------------

ALTER TABLE perm_ped DROP COLUMN IF EXISTS acao_stock_deduct;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS acao_status_invoice;

ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_ped_vendedor;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_ped_entrega;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_ped_itens;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_ped_abate_estoque;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_ped_origem;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_ped_it_sku;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_ped_it_situacao;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_log_transportadora;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_log_cod_rastreio;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_log_frete_valor;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_log_data_envio;
ALTER TABLE perm_ped DROP COLUMN IF EXISTS col_log_data_entrega;
