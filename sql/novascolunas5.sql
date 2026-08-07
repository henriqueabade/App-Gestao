-- ---------------------------------------------------------------------------
-- Rastreabilidade do cancelamento e da realocação
--
-- O cálculo de estoque e de matéria-prima já fecha. O que falta é PROVA: hoje
-- boa parte da operação só pode ser reconstruída cruzando tabelas por data e
-- texto livre. Este arquivo cria o registro direto.
--
-- Pode rodar inteiro, quantas vezes quiser: é idempotente.
--
-- IMPORTANTE: a API carrega o mapa de colunas UMA VEZ, ao subir (`loadSchema()`
-- em server.js). Depois de rodar este arquivo, REINICIE A API — sem isso ela
-- continua montando os INSERT com as colunas antigas, e tudo o que for novo é
-- silenciosamente descartado.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. public.realocacoes — a substituição inteira, numa linha
--
-- A tabela dizia "saiu um movimento daqui e entrou um movimento ali". Não dizia
-- QUANTAS unidades, nem QUAL lugar do destino foi ocupado. E o lugar muda tudo:
-- uma peça em 9/15 que substitui uma peça PRONTA libera a pronta ao estoque;
-- a mesma peça em 9/15 substituindo uma PRODUÇÃO DO ZERO não libera nada e
-- devolve a rota inteira daquela unidade à matéria-prima. Os dois movimentos de
-- recebimento são idênticos — só estas colunas os distinguem.
-- ===========================================================================
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS quantidade NUMERIC(14,4);

-- De onde a peça saiu. Dava para chegar lá pelo movimento de origem; agora
-- responde direto, que é o que uma auditoria precisa.
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS pedido_id_origem BIGINT;
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS pedido_item_id_origem BIGINT;
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS ultimo_insumo_id_origem BIGINT;
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS lote_id_origem BIGINT;

-- 'pronta' | 'parcial' | 'producao_zero' — o que foi substituído no destino.
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS tipo_destino_substituido TEXT;

-- Substituiu peça pronta ou parcial: o grupo fica aqui...
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS pedido_itens_ext_id_substituido BIGINT;
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS ultimo_insumo_id_substituido BIGINT;
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS lote_id_substituido BIGINT;
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS movimento_id_peca_liberada BIGINT;

-- ...substituiu produção do zero: a reserva reduzida fica aqui.
ALTER TABLE realocacoes ADD COLUMN IF NOT EXISTS reserva_id_substituida BIGINT;

-- As colunas são nulas conforme o caso, de propósito: nenhuma substituição é
-- dos dois tipos ao mesmo tempo, e `tipo_destino_substituido` diz qual olhar.

CREATE INDEX IF NOT EXISTS idx_realocacoes_origem
  ON realocacoes (pedido_id_origem);
CREATE INDEX IF NOT EXISTS idx_realocacoes_destino
  ON realocacoes (pedido_id_destino);


-- ===========================================================================
-- 2. public.estoque_movimentos — encadeamento dos dois lados
--
-- O par saída/entrada existe, mas só se reconhece pelo texto e pelo horário.
-- Com estas duas colunas o vínculo é explícito nos dois sentidos.
--
-- Provavelmente já existem (o app manda `source_movement_id` desde a conversão);
-- o IF NOT EXISTS deixa rodar sem saber.
-- ===========================================================================
ALTER TABLE estoque_movimentos ADD COLUMN IF NOT EXISTS source_movement_id BIGINT;
ALTER TABLE estoque_movimentos ADD COLUMN IF NOT EXISTS transfer_to_pedido_id BIGINT;
-- A qual substituição este movimento pertence.
ALTER TABLE estoque_movimentos ADD COLUMN IF NOT EXISTS realocacao_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_estoque_mov_realocacao
  ON estoque_movimentos (realocacao_id);


-- ===========================================================================
-- 3. public.materia_prima_movimentacoes — qual substituição devolveu o insumo
--
-- `pedido_id` já diz qual pedido recebeu o estorno. Com duas substituições no
-- MESMO pedido de destino, isso não basta para separar os estornos — e separar
-- é justamente o que permite conferir cada um.
-- ===========================================================================
ALTER TABLE materia_prima_movimentacoes ADD COLUMN IF NOT EXISTS realocacao_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_mp_mov_realocacao
  ON materia_prima_movimentacoes (realocacao_id);


-- ===========================================================================
-- 4. public.reservas_estoque — o que foi prometido continua registrado
--
-- Uma reserva de cinco produções do zero que sobra com `quantidade = 1` conta a
-- verdade do saldo e apaga a do plano. As duas importam: a original diz o que o
-- pedido prometeu, a atual diz o que ainda falta.
--
-- O backfill preenche o histórico com o melhor valor disponível hoje — o saldo
-- atual. Não reconstrói o passado (não há como), mas a partir daqui as duas
-- colunas passam a ser gravadas na criação da reserva.
-- ===========================================================================
ALTER TABLE reservas_estoque ADD COLUMN IF NOT EXISTS quantidade_original NUMERIC(14,4);

UPDATE reservas_estoque
   SET quantidade_original = quantidade
 WHERE quantidade_original IS NULL;


-- ===========================================================================
-- 5. public.cancelamento_destinacoes — uma fonte só para o cancelamento
--
-- Hoje, um descarte e um retorno ao estoque produzem o MESMO
-- `tipo_movimento = retorno_cancelamento`. São decisões diferentes: o descarte
-- devolve a peça ao lote de origem como estava, o retorno a devolve num ponto
-- ESCOLHIDO e manda o resto da rota para a matéria-prima. Sem distinguir, o
-- inventário fecha e a auditoria não.
--
-- Cada decisão do modal de cancelamento vira uma linha aqui — inclusive as que
-- FALHARAM, com o motivo em `falha`. Um estorno que deu errado tem de deixar
-- rastro; é a única forma de saber depois o que conferir à mão.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS cancelamento_destinacoes (
  id                    BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  pedido_id             BIGINT NOT NULL,
  pedido_item_id        BIGINT,
  produto_id            BIGINT,
  -- retorno_estoque | descarte_restaura_lote | nao_retorna_produto | realocacao
  tipo_destino          TEXT NOT NULL,
  quantidade            NUMERIC(14,4) NOT NULL,
  -- Onde a peça ESTAVA quando o pedido foi cancelado.
  ordem_origem          INTEGER,
  ultimo_insumo_id      BIGINT,
  lote_id_origem        BIGINT,
  -- Onde ela FOI PARAR (ponto escolhido no retorno; nulo nos demais).
  ordem_destino         INTEGER,
  lote_id_destino       BIGINT,
  -- Realocação: para qual pedido, e o vínculo com a linha de `realocacoes`.
  pedido_id_destino     BIGINT,
  realocacao_id         BIGINT,
  movimento_id          BIGINT,
  falha                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            BIGINT
);

CREATE INDEX IF NOT EXISTS idx_canc_dest_pedido
  ON cancelamento_destinacoes (pedido_id);
CREATE INDEX IF NOT EXISTS idx_canc_dest_destino
  ON cancelamento_destinacoes (pedido_id_destino);


-- ===========================================================================
-- 6. Enum: descarte deixa de se disfarçar de retorno
--
-- O nome do tipo é descoberto a partir da própria coluna: em bancos diferentes
-- ele pode se chamar `tipo_movimento_estoque` ou outra coisa, e um nome chutado
-- faria o arquivo inteiro falhar aqui.
--
-- Se a coluna não for enum (for TEXT), não há nada a fazer — e o app grava o
-- valor novo do mesmo jeito.
--
-- O app tenta `descarte_cancelamento` e, se o banco recusar, refaz o movimento
-- como `retorno_cancelamento`: quem ainda não rodou este arquivo continua com o
-- estorno funcionando, só sem a distinção.
-- ===========================================================================
DO $$
DECLARE
  nome_do_tipo TEXT;
BEGIN
  SELECT t.typname INTO nome_do_tipo
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type  t ON t.oid = a.atttypid
   WHERE c.relname = 'estoque_movimentos'
     AND a.attname = 'tipo_movimento'
     AND t.typtype = 'e';

  IF nome_do_tipo IS NOT NULL THEN
    EXECUTE format(
      'ALTER TYPE %I ADD VALUE IF NOT EXISTS %L',
      nome_do_tipo, 'descarte_cancelamento'
    );
  END IF;
END
$$;


-- ===========================================================================
-- 7. Conferência
-- ===========================================================================
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (
     (table_name = 'realocacoes' AND column_name IN (
       'quantidade', 'pedido_id_origem', 'pedido_item_id_origem',
       'ultimo_insumo_id_origem', 'lote_id_origem', 'tipo_destino_substituido',
       'pedido_itens_ext_id_substituido', 'ultimo_insumo_id_substituido',
       'lote_id_substituido', 'movimento_id_peca_liberada', 'reserva_id_substituida'))
     OR (table_name = 'estoque_movimentos' AND column_name IN (
       'source_movement_id', 'transfer_to_pedido_id', 'realocacao_id'))
     OR (table_name = 'materia_prima_movimentacoes' AND column_name = 'realocacao_id')
     OR (table_name = 'reservas_estoque' AND column_name = 'quantidade_original')
     OR table_name = 'cancelamento_destinacoes'
   )
 ORDER BY table_name, column_name;


-- ===========================================================================
-- O QUE ESTE ARQUIVO **NÃO** RESOLVE — e por quê
--
-- TRANSAÇÃO. O app fala com um CRUD genérico por HTTP: cada linha é uma
-- requisição própria, e não existe BEGIN/COMMIT abrangendo o conjunto. Se a
-- rede cair no meio, parte do estorno fica gravada e não há ROLLBACK possível
-- do lado de cá. O que dá para fazer — e foi feito — é conferir tudo ANTES de
-- escrever qualquer coisa, cancelar o pedido só depois do estorno, registrar as
-- falhas em `cancelamento_destinacoes.falha` e nunca dizer "concluído" quando
-- alguma etapa falhou.
--
-- Rollback de verdade exige um endpoint transacional na API (uma função no
-- Postgres com BEGIN/COMMIT, exposta como rota única). Isso é mudança no
-- projeto da API, não neste.
-- ===========================================================================
