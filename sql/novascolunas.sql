-- ---------------------------------------------------------------------------
-- Colunas que faltam para o razão de estoque
--
-- VERSÃO 2 — a primeira falhou e é importante entender por quê: ela tentava
-- criar valores de enum que o seu banco já tem com OUTRO nome, e o `ALTER TYPE
-- ... does not exist` derrubou a transação inteira. Como o pgAdmin roda o
-- script todo numa transação só, o erro no fim desfez até os `ALTER TABLE` do
-- começo — por isso as colunas também não foram criadas.
--
-- Esta versão NÃO mexe em nenhum enum. O código foi alinhado aos valores que
-- você já tem ('peca', 'reservado', 'abatido', 'conversao'...).
--
-- COMO RODAR: execute o BLOCO 1 e depois o BLOCO 2. O bloco 3 é uma consulta —
-- rode e me mande o resultado.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- BLOCO 1 — COLUNAS (rode este primeiro)
-- ===========================================================================

-- A reserva guarda a peça que será PRODUZIDA DO ZERO para um pedido. Para ela
-- voltar ao estoque num cancelamento é preciso saber em que ponto da rota ela
-- ficou; sem isso a peça volta sem identidade e ninguém sabe o que ela é.
ALTER TABLE public.reservas_estoque
    ADD COLUMN IF NOT EXISTS ultimo_insumo_id bigint;

-- `item_id` diz QUAL peça, mas não em que ponto da rota ela estava nem de qual
-- linha do estoque saiu. Sem as duas colunas abaixo, o estorno de um
-- cancelamento teria de adivinhar para onde devolver — foi exatamente esse tipo
-- de adivinhação que fez o abatimento das peças parciais falhar.
ALTER TABLE public.estoque_movimentos
    ADD COLUMN IF NOT EXISTS ultimo_insumo_id bigint;

ALTER TABLE public.estoque_movimentos
    ADD COLUMN IF NOT EXISTS lote_id bigint;

COMMENT ON COLUMN public.reservas_estoque.ultimo_insumo_id IS
    'Último insumo da peça (ponto da rota). Define o que volta ao estoque no cancelamento.';
COMMENT ON COLUMN public.estoque_movimentos.ultimo_insumo_id IS
    'Ponto da rota em que a peça estava (produtos_em_cada_ponto.ultimo_insumo_id).';
COMMENT ON COLUMN public.estoque_movimentos.lote_id IS
    'Linha exata de produtos_em_cada_ponto movimentada. É por ela que o estorno devolve ao mesmo lugar.';


-- ===========================================================================
-- BLOCO 2 — ÍNDICES (rode depois do bloco 1)
--
-- As tabelas são lidas SEMPRE por pedido (cancelamento e relatório) e o razão
-- cresce sem parar. Sem índice, o estorno fica mais lento a cada pedido.
-- ===========================================================================
CREATE INDEX IF NOT EXISTS idx_estoque_mov_pedido  ON public.estoque_movimentos (pedido_id);
CREATE INDEX IF NOT EXISTS idx_estoque_mov_item    ON public.estoque_movimentos (tipo_item, item_id);
CREATE INDEX IF NOT EXISTS idx_estoque_mov_lote    ON public.estoque_movimentos (lote_id);
CREATE INDEX IF NOT EXISTS idx_reservas_pedido     ON public.reservas_estoque (pedido_id);
CREATE INDEX IF NOT EXISTS idx_reservas_status     ON public.reservas_estoque (status);
CREATE INDEX IF NOT EXISTS idx_hist_eventos_pedido ON public.pedido_historico_eventos (pedido_id);
CREATE INDEX IF NOT EXISTS idx_ext_pedido          ON public.pedido_itens_ext (id_pedido);


-- ===========================================================================
-- BLOCO 3 — A ÚNICA COISA QUE AINDA ME FALTA
--
-- `estoque_movimentos.tipo_movimento` usa um tipo cujo nome NÃO é
-- "tipo_movimento" — por isso o erro. Esta consulta descobre o nome real e
-- lista os valores aceitos. Rode e me mande o resultado: é com ele que eu
-- acerto o rótulo de cada movimento (entrada, saída, abatimento, reversão...).
--
-- Enquanto isso não vier, TUDO funciona: a conversão abate estoque, grava
-- pedido_itens_ext, reservas_estoque e o histórico do pedido. Só a linha em
-- estoque_movimentos pode ser recusada pelo banco — e nesse caso ela vira um
-- aviso na tela, sem derrubar a conversão.
-- ===========================================================================
SELECT c.relname            AS tabela,
       a.attname            AS coluna,
       t.typname            AS tipo_enum,
       e.enumlabel          AS valor_aceito,
       e.enumsortorder      AS ordem
  FROM pg_attribute a
  JOIN pg_class     c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type      t ON t.oid = a.atttypid
  LEFT JOIN pg_enum e ON e.enumtypid = t.oid
 WHERE n.nspname = 'public'
   AND c.relname = 'estoque_movimentos'
   AND a.attname IN ('tipo_movimento', 'tipo_item')
 ORDER BY a.attname, e.enumsortorder;
