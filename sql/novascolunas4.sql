-- ---------------------------------------------------------------------------
-- Colunas para o histórico completo e para a nova permissão
--
-- Três coisas independentes. Pode rodar o arquivo inteiro; é idempotente.
--
-- IMPORTANTE: a API carrega o mapa de colunas UMA VEZ, ao subir
-- (`loadSchema()` em server.js). Depois de rodar este arquivo, REINICIE A API —
-- sem isso ela continua montando os INSERT com as colunas antigas e os campos
-- novos são silenciosamente ignorados.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. Permissão da nova ação: relatório de movimentações da peça
--
-- Segue o padrão das outras: BOOLEAN NOT NULL DEFAULT FALSE. Nasce negada para
-- todo mundo — quem não recebe explicitamente não vê o ícone.
-- ===========================================================================
ALTER TABLE perm_prod
  ADD COLUMN IF NOT EXISTS acao_movimentos_view BOOLEAN NOT NULL DEFAULT FALSE;
  -- prod.movimentos.view · Ver movimentações da peça

ALTER TABLE perm_mp
  ADD COLUMN IF NOT EXISTS acao_movimentos_view BOOLEAN NOT NULL DEFAULT FALSE;
  -- mp.movimentos.view · Ver auditoria do insumo

-- O Sup Admin tem tudo, por definição. Sem isto, quem administra o sistema
-- teria de se dar a permissão à mão para ver o próprio relatório.
UPDATE perm_prod
   SET acao_movimentos_view = TRUE
 WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE LOWER(nome) LIKE '%sup admin%');

UPDATE perm_mp
   SET acao_movimentos_view = TRUE
 WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE LOWER(nome) LIKE '%sup admin%');


-- ===========================================================================
-- 2. Histórico da matéria-prima: de onde veio a alteração
--
-- `materia_prima_movimentacoes` só tinha o tipo, e por isso não distinguia uma
-- baixa por pedido de uma retirada feita à mão, nem dizia POR QUÊ alguém mexeu
-- no saldo. O tipo passou a ser específico (saida_pedido, ajuste_quantidade,
-- ajuste_preco, cadastro, exclusao...), e estas duas colunas guardam o resto.
--
-- O app já envia os dois campos: enquanto não existirem, a API os descarta sem
-- erro; depois de existirem (e da API reiniciar), passam a gravar sozinhos.
-- ===========================================================================
ALTER TABLE materia_prima_movimentacoes
  ADD COLUMN IF NOT EXISTS pedido_id BIGINT;

ALTER TABLE materia_prima_movimentacoes
  ADD COLUMN IF NOT EXISTS observacao TEXT;

-- Índice para a pergunta "o que este pedido consumiu de matéria-prima?".
CREATE INDEX IF NOT EXISTS idx_mp_mov_pedido
  ON materia_prima_movimentacoes (pedido_id);

-- E para "qual o histórico deste insumo?", que é a leitura mais comum.
CREATE INDEX IF NOT EXISTS idx_mp_mov_insumo_data
  ON materia_prima_movimentacoes (insumo_id, criado_em DESC);


-- ===========================================================================
-- 3. Conferência
-- ===========================================================================
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (
     (table_name IN ('perm_prod', 'perm_mp') AND column_name = 'acao_movimentos_view')
     OR (table_name = 'materia_prima_movimentacoes' AND column_name IN ('pedido_id', 'observacao'))
   )
 ORDER BY table_name, column_name;


-- ===========================================================================
-- O QUE ESTE ARQUIVO **NÃO** RESOLVE — e por quê
--
-- `estoque_movimentos.ordem_producao_id` continuará vazio, e isso está certo:
-- a coluna tem chave estrangeira para `ordens_producao`, que hoje está VAZIA
-- (0 linhas, assim como `ordem_producao_itens`). Não existe ordem de produção
-- no sistema ainda, então não há id válido para gravar ali — qualquer número
-- inventado seria recusado pelo banco.
--
-- Ela passa a ser preenchida sozinha quando o módulo de ordens de produção
-- existir e a conversão criar uma ordem por peça. Até lá, o vínculo entre o
-- insumo e a peça que o consome está em `pedido_item_id` e `reserva_id`, que
-- passaram a ser preenchidos.
-- ===========================================================================
