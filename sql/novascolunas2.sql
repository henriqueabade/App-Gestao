-- ---------------------------------------------------------------------------
-- Valores de enum que o seu fluxo pede e o banco ainda não tem
--
-- Na rodada anterior eu encaixei tudo no vocabulário existente. Olhando os
-- dados do teste, ficou claro que isso PERDE informação:
--
--   * `status_reserva` = 'reservado' não é o que você definiu. Sua regra é
--     produção -> finalizado -> retornada.
--   * `tipo_movimento_estoque` = 'abatimento' para TUDO não distingue "peça
--     pronta usada", "peça pela metade usada" e "insumo consumido". Você pediu
--     explicitamente que cada acontecimento seja distinguível.
--
-- Nada é removido nem renomeado: os valores atuais continuam válidos e os
-- registros já gravados continuam legíveis.
--
-- COMO RODAR: cada `ALTER TYPE ... ADD VALUE` precisa rodar FORA de transação.
-- No pgAdmin: menu da query -> desmarque "Auto commit"? NÃO — o contrário:
-- deixe o Auto commit LIGADO (Query Tool > engrenagem > Auto commit). Depois
-- selecione e execute os comandos. Se der "cannot run inside a transaction
-- block", execute UMA LINHA POR VEZ (F5 com só aquela linha selecionada).
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. status_reserva — o ciclo de vida que você definiu
--
--   producao   : peça prometida ao pedido, ainda será fabricada  (nasce assim)
--   finalizado : pedido enviado, a peça saiu
--   retornada  : pedido cancelado / peça devolveu ao estoque
-- ===========================================================================
ALTER TYPE public.status_reserva ADD VALUE IF NOT EXISTS 'producao';
ALTER TYPE public.status_reserva ADD VALUE IF NOT EXISTS 'finalizado';
ALTER TYPE public.status_reserva ADD VALUE IF NOT EXISTS 'retornada';


-- ===========================================================================
-- 2. tipo_movimento_estoque — cada acontecimento com nome próprio
--
--   entrada_estoque       : peça colocada no estoque pelo módulo de Produtos
--   saida_estoque         : peça retirada pelo módulo de Produtos
--   ajuste_estoque        : quantidade corrigida na tela
--   consumo_peca_pronta   : peça ACABADA do estoque usada num pedido
--   consumo_peca_parcial  : peça INACABADA do estoque usada num pedido
--   consumo_insumo        : matéria-prima abatida para produzir
--   retorno_cancelamento  : peça devolvida ao estoque por cancelamento
--
-- Os valores antigos (reserva, abatimento, reversao, transferencia,
-- cancelamento, negativa) continuam existindo e seguem válidos.
-- ===========================================================================
ALTER TYPE public.tipo_movimento_estoque ADD VALUE IF NOT EXISTS 'entrada_estoque';
ALTER TYPE public.tipo_movimento_estoque ADD VALUE IF NOT EXISTS 'saida_estoque';
ALTER TYPE public.tipo_movimento_estoque ADD VALUE IF NOT EXISTS 'ajuste_estoque';
ALTER TYPE public.tipo_movimento_estoque ADD VALUE IF NOT EXISTS 'consumo_peca_pronta';
ALTER TYPE public.tipo_movimento_estoque ADD VALUE IF NOT EXISTS 'consumo_peca_parcial';
ALTER TYPE public.tipo_movimento_estoque ADD VALUE IF NOT EXISTS 'consumo_insumo';
ALTER TYPE public.tipo_movimento_estoque ADD VALUE IF NOT EXISTS 'retorno_cancelamento';


-- ===========================================================================
-- 3. Conferência — deve listar os valores novos junto dos antigos
-- ===========================================================================
-- SELECT t.typname AS enum, e.enumlabel AS valor, e.enumsortorder AS ordem
--   FROM pg_type t
--   JOIN pg_enum e ON e.enumtypid = t.oid
--  WHERE t.typname IN ('status_reserva', 'tipo_movimento_estoque')
--  ORDER BY t.typname, e.enumsortorder;
