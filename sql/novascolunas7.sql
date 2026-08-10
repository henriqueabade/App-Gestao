-- ---------------------------------------------------------------------------
-- Vínculo entre o consumo de insumo e a movimentação de PEÇA que o causou
--
-- Quando alguém lança uma peça no estoque pelo módulo de Produtos e manda
-- abater a matéria-prima, saem vários consumos de insumo. Eles ficavam corretos
-- no saldo e mudos na auditoria: nada dizia QUAL peça, quantas unidades e em
-- que estágio da rota originaram aquela baixa. Só dava para deduzir por
-- horário — e horário não é vínculo.
--
-- `estoque_movimento_id` aponta para a linha de `estoque_movimentos` da PEÇA.
-- É dela que o relatório tira o produto, a quantidade e o ponto da rota.
--
-- Pode rodar inteiro, quantas vezes quiser.
--
-- IMPORTANTE: REINICIE A API depois. Ela carrega o mapa de colunas uma vez, ao
-- subir; sem reiniciar, o campo novo é descartado em silêncio.
-- ---------------------------------------------------------------------------

ALTER TABLE materia_prima_movimentacoes
  ADD COLUMN IF NOT EXISTS estoque_movimento_id BIGINT;

-- A pergunta que este índice serve: "o que esta movimentação de peça consumiu?"
CREATE INDEX IF NOT EXISTS idx_mp_mov_estoque_movimento
  ON materia_prima_movimentacoes (estoque_movimento_id);


-- ===========================================================================
-- Conferência
-- ===========================================================================
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'materia_prima_movimentacoes'
   AND column_name IN ('pedido_id', 'realocacao_id', 'estoque_movimento_id', 'observacao')
 ORDER BY column_name;


-- ===========================================================================
-- Leitura: o extrato completo de um consumo ligado a uma peça
--
-- Troque o insumo_id e confira que produto, quantidade e estágio aparecem.
-- ===========================================================================
SELECT mm.id,
       mm.criado_em,
       mm.tipo,
       mm.quantidade,
       mm.quantidade_anterior,
       mm.quantidade_atual,
       em.item_id            AS produto_id,
       p.codigo              AS peca_codigo,
       p.nome                AS peca_nome,
       em.quantidade         AS pecas,
       em.ultimo_insumo_id   AS insumo_do_ponto,
       em.lote_id,
       mm.observacao
  FROM materia_prima_movimentacoes mm
  LEFT JOIN estoque_movimentos em ON em.id = mm.estoque_movimento_id
  LEFT JOIN produtos p ON p.id = em.item_id
 WHERE mm.insumo_id = 151
 ORDER BY mm.criado_em DESC
 LIMIT 50;
