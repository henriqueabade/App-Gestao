-- =====================================================================
-- ALTERAR PAGAMENTO DO PEDIDO — App-Gestao
--
-- Permite repactuar a condição de pagamento de um pedido JÁ EM PRODUÇÃO:
-- à vista / a prazo, forma de pagamento, prazos em dias e parcelas. Os
-- descontos e o total são recalculados pela mesma regra do orçamento
-- (5% por mais de uma peça + 5% por pagar à vista; o excedente é desconto
-- especial e sobrevive à troca da condição).
--
-- Nenhuma coluna nova é necessária: a rota escreve em colunas que já
-- existem (pedidos.parcelas, tipo_parcela, forma_pagamento, prazo,
-- desconto_*, valor_final; pedidos_itens.desconto_*; pedido_parcelas).
-- O que falta no banco é apenas a permissão.
--
-- Seguro rodar em banco já existente.
-- =====================================================================

BEGIN;

-- A ação nasce FALSE: mexer no valor de um pedido em produção altera o que
-- o financeiro vai cobrar, e não é algo que qualquer perfil deva poder
-- fazer sem que alguém tenha decidido liberar.
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_payment_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.payment.edit · Alterar pagamento

UPDATE perm_ped
SET acao_payment_edit = TRUE
WHERE modelo_id IN (
  SELECT id FROM modelos_permissoes
  WHERE LOWER(TRIM(nome)) IN ('sup admin', 'supadmin', 'super admin', 'administrador')
);

COMMIT;
