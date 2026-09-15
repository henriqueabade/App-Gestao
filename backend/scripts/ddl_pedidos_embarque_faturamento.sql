-- =====================================================================
-- EMBARQUE E INÍCIO DO FATURAMENTO DO PEDIDO — App-Gestao
--
-- Três datas e uma regra por pedido:
--   embarcar_previsao   quando o pedido deve embarcar (pedida na conversão)
--   embarcar_real       quando embarcou — é a antiga `data_envio`, RENOMEADA
--                       e convertida para DATE
--   inicio_faturamento  de quando o prazo de cada parcela conta:
--                       vencimento = início + prazo daquela parcela
--   faturamento_regra   'ao_embarcar' | 'ao_converter' | 'data'
--
-- E a permissão do botão que altera previsão e início depois da conversão
-- (ped.dates.edit · "Alterar datas de embarque e faturamento").
--
-- ORDEM DE PUBLICAÇÃO — NÃO INVERTA:
--   1. Rode este arquivo.
--   2. REINICIE A API (Santissimo-db-API). Ela carrega o mapa de colunas UMA
--      VEZ, ao subir (`loadSchema()` em server.js). Sem o restart ela ignora
--      as colunas novas em silêncio (o pedido nasce sem as datas, sem erro
--      nenhum) e ainda monta o UPDATE com `data_envio`, que já não existe.
--   3. Só então publique o app.
--
-- VERSÕES ANTIGAS DO APP deixam de gravar a data de embarque: continuam
-- mandando `data_envio`, que a API reiniciada descarta sem erro — o pedido
-- vira "Enviado" e fica sem data. FORCE A ATUALIZAÇÃO dos clientes junto com
-- a publicação.
--
-- Pode rodar mais de uma vez: cada passo confere o estado antes de mexer.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. data_envio -> embarcar_real
--
-- Renomeia só se a antiga existe e a nova ainda não: é o que deixa o arquivo
-- rodar de novo sem erro. Se as duas existirem (alguém criou a nova à mão),
-- nada é mexido — confira os dados antes de apagar a antiga.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pedidos' AND column_name = 'data_envio'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pedidos' AND column_name = 'embarcar_real'
    ) THEN
      ALTER TABLE pedidos RENAME COLUMN data_envio TO embarcar_real;
    ELSE
      RAISE NOTICE 'pedidos.data_envio e pedidos.embarcar_real coexistem: nada foi renomeado. Confira os dados e remova data_envio à mão.';
    END IF;
  END IF;
END$$;

-- Banco sem nenhuma das duas: a coluna nasce aqui, e o passo 2 não falha.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS embarcar_real DATE;

-- ---------------------------------------------------------------------
-- 2. embarcar_real vira DATE
--
-- O embarque é um DIA, como a previsão com que ele é comparado ("embarcou
-- até a previsão?"). O app passa a gravar o dia de São Paulo.
--
-- Atenção ao histórico: `data_envio` era gravada como instante UTC
-- (toISOString). O corte `::date` guarda o dia desse valor, então um envio
-- marcado entre 21h e 23h59 (horário de São Paulo) pode ficar com o dia
-- seguinte. Só afeta pedidos já enviados, e só a data exibida.
-- ---------------------------------------------------------------------
ALTER TABLE pedidos ALTER COLUMN embarcar_real TYPE DATE USING embarcar_real::date;

-- ---------------------------------------------------------------------
-- 3. Previsão, início e regra do faturamento
--
-- Nulas nos pedidos anteriores a esta versão: esses continuam contando os
-- vencimentos do dia da emissão, como sempre contaram.
-- ---------------------------------------------------------------------
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS embarcar_previsao  DATE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS inicio_faturamento DATE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS faturamento_regra  VARCHAR(20);

-- A regra é conferida pelo banco também: uma regra desconhecida faria o
-- pedido ser tratado como legado sem ninguém perceber. NULL passa no CHECK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pedidos_faturamento_regra_check'
       AND conrelid = 'pedidos'::regclass
  ) THEN
    ALTER TABLE pedidos
      ADD CONSTRAINT pedidos_faturamento_regra_check
      CHECK (faturamento_regra IN ('ao_embarcar', 'ao_converter', 'data'));
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- 4. Permissão do botão de datas no pagamento do pedido
--
-- Nasce FALSE: reprogramar vencimentos muda quando o financeiro cobra, e não
-- é algo que qualquer perfil deva poder fazer sem que alguém decida liberar.
-- ---------------------------------------------------------------------
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_dates_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.dates.edit · Alterar datas de embarque e faturamento

UPDATE perm_ped
SET acao_dates_edit = TRUE
WHERE modelo_id IN (
  SELECT id FROM modelos_permissoes
  WHERE LOWER(TRIM(nome)) IN ('sup admin', 'supadmin', 'super admin', 'administrador')
);

COMMIT;

-- Conferência (só lê; rode depois do COMMIT):
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'pedidos'
--    AND column_name IN ('data_envio', 'embarcar_real', 'embarcar_previsao',
--                        'inicio_faturamento', 'faturamento_regra');
