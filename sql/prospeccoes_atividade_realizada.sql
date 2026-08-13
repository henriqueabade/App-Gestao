-- ============================================================================
--  prospeccoes_atividade_realizada.sql
--  Novo tipo de interação: "Atividade realizada" — App-Gestao
--
--  Rode DEPOIS de sql/prospeccoes.sql.
--
--  ------------------------------------------------------------------------
--  POR QUE
--
--  Quando o próximo passo planejado é concluído, ele vira um registro na
--  timeline. Mas "Ligar para o Ricardo" não é uma ligação, um e-mail nem uma
--  reunião: é o CUMPRIMENTO de um combinado, e forçá-lo num dos tipos
--  existentes falsearia o relatório de atividades.
--
--  `pros_interacoes_tipo_check` recusaria o valor novo, então a constraint é
--  recriada com ele incluído.
--
--  Script idempotente.
-- ============================================================================

BEGIN;

-- Só recria se a lista ainda não contempla o tipo novo — assim rodar de novo
-- não faz trabalho à toa nem trava a tabela sem necessidade.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'pros_interacoes_tipo_check'
       AND pg_get_constraintdef(oid) NOT LIKE '%Atividade realizada%'
  ) THEN
    ALTER TABLE prospeccao_interacoes DROP CONSTRAINT pros_interacoes_tipo_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pros_interacoes_tipo_check'
  ) THEN
    ALTER TABLE prospeccao_interacoes
      ADD CONSTRAINT pros_interacoes_tipo_check
      CHECK (tipo IN (
        'Ligação', 'E-mail', 'Reunião', 'WhatsApp', 'Visita',
        'Nota', 'Proposta', 'Atividade realizada'
      ));
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Vínculo com o passo que originou a atividade.
--
-- Guardar o texto do passo planejado ao lado do que foi feito permite comparar
-- depois "o que foi combinado" com "o que aconteceu". Sem esta coluna, o
-- resumo da interação seria a única pista e ela pode ser editada.
-- ---------------------------------------------------------------------------
ALTER TABLE prospeccao_interacoes
  ADD COLUMN IF NOT EXISTS passo_planejado VARCHAR(255);

ALTER TABLE prospeccao_interacoes
  ADD COLUMN IF NOT EXISTS passo_planejado_data DATE;

COMMIT;

-- ============================================================================
--  Conferência — rode depois do COMMIT:
--
--    SELECT pg_get_constraintdef(oid)
--      FROM pg_constraint
--     WHERE conname = 'pros_interacoes_tipo_check';
--
--  Deve conter 'Atividade realizada'.
--
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'prospeccao_interacoes'
--       AND column_name IN ('passo_planejado', 'passo_planejado_data');
--
--  Devem aparecer as duas linhas.
-- ============================================================================
