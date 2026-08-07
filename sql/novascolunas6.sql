-- ---------------------------------------------------------------------------
-- Precisão dos saldos de matéria-prima
--
-- O saldo estava sendo TRUNCADO a cada movimento. O histórico registra o valor
-- certo (993.5825), mas o movimento seguinte lia 993.58 do saldo — porque a
-- coluna do saldo guarda menos casas do que a conta produz. A cada operação
-- perde-se um pedaço, e a perda se acumula:
--
--   Feltro: partiu de 1,2500, consumiu 0,0025 e deveria terminar em 1,2475.
--           Terminou em ~1,2425 — 0,0050 m² sumiram em arredondamentos.
--
-- Nada disso aparece numa conferência isolada: cada movimento parece certo. Só
-- a soma da coluna inteira revela.
--
-- Este arquivo iguala a precisão do SALDO à precisão do MOVIMENTO: 4 casas nas
-- duas pontas. Pode rodar inteiro, quantas vezes quiser.
--
-- IMPORTANTE: REINICIE A API depois. E rode com o app parado — a alteração
-- reescreve as tabelas e pega lock exclusivo por alguns instantes.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. Diagnóstico — o que está estreito hoje
--
-- Rode isto ANTES e guarde o resultado: é a prova de que a causa era esta.
-- `numeric_scale` menor que 4 é o problema; NULL significa dupla precisão
-- (float), que não trunca mas também não é exata — ver a nota no fim.
-- ===========================================================================
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (
     (table_name = 'materia_prima' AND column_name = 'quantidade')
     OR (table_name = 'materia_prima_movimentacoes'
         AND column_name IN ('quantidade', 'quantidade_anterior', 'quantidade_atual'))
     OR (table_name = 'produtos_insumos' AND column_name = 'quantidade')
     OR (table_name = 'estoque_movimentos' AND column_name = 'quantidade')
   )
 ORDER BY table_name, column_name;


-- ===========================================================================
-- 2. Alargar só o que está estreito
--
-- O bloco só mexe em coluna NUMERIC com escala menor que 4. Coluna que já está
-- em 4 (ou mais) fica intacta, e rodar de novo não faz nada — a alteração é
-- cara demais para ser feita à toa.
-- ===========================================================================
DO $$
DECLARE
  alvo RECORD;
BEGIN
  FOR alvo IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.data_type = 'numeric'
       AND c.numeric_scale IS NOT NULL
       AND c.numeric_scale < 4
       AND (
         (c.table_name = 'materia_prima' AND c.column_name = 'quantidade')
         OR (c.table_name = 'materia_prima_movimentacoes'
             AND c.column_name IN ('quantidade', 'quantidade_anterior', 'quantidade_atual'))
         OR (c.table_name = 'produtos_insumos' AND c.column_name = 'quantidade')
         OR (c.table_name = 'estoque_movimentos' AND c.column_name = 'quantidade')
       )
  LOOP
    RAISE NOTICE 'Alargando %.% para NUMERIC(18,4)', alvo.table_name, alvo.column_name;
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE NUMERIC(18,4)',
      alvo.table_name, alvo.column_name
    );
  END LOOP;
END
$$;


-- ===========================================================================
-- 3. Conferência
-- ===========================================================================
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (
     (table_name = 'materia_prima' AND column_name = 'quantidade')
     OR (table_name = 'materia_prima_movimentacoes'
         AND column_name IN ('quantidade', 'quantidade_anterior', 'quantidade_atual'))
     OR (table_name = 'produtos_insumos' AND column_name = 'quantidade')
     OR (table_name = 'estoque_movimentos' AND column_name = 'quantidade')
   )
 ORDER BY table_name, column_name;


-- ===========================================================================
-- 4. Quem já derivou — como achar
--
-- A consulta abaixo compara o saldo atual de cada insumo com o último
-- `quantidade_atual` registrado no histórico. Diferença aqui é resíduo de
-- arredondamento (ou movimento gravado fora do app).
--
-- O passado NÃO é recuperável: o valor truncado foi gravado e a informação
-- perdida não está em lugar nenhum. O que dá para fazer é achar os insumos
-- afetados e corrigir o saldo à mão, uma vez.
-- ===========================================================================
SELECT m.id,
       m.nome,
       m.quantidade                    AS saldo_atual,
       ultimo.quantidade_atual         AS ultimo_registrado,
       (m.quantidade - ultimo.quantidade_atual) AS diferenca
  FROM materia_prima m
  JOIN LATERAL (
    SELECT mm.quantidade_atual
      FROM materia_prima_movimentacoes mm
     WHERE mm.insumo_id = m.id
       AND mm.quantidade_atual IS NOT NULL
     ORDER BY mm.criado_em DESC, mm.id DESC
     LIMIT 1
  ) ultimo ON TRUE
 WHERE m.quantidade IS DISTINCT FROM ultimo.quantidade_atual
 ORDER BY ABS(m.quantidade - ultimo.quantidade_atual) DESC;


-- ===========================================================================
-- NOTA — por que NUMERIC e não float
--
-- Se alguma dessas colunas estiver como `double precision`, este arquivo não a
-- toca, e é proposital: converter float para numeric materializa o erro binário
-- que já existe no valor guardado. Se for o caso, o certo é converter numa
-- migração pensada, arredondando explicitamente:
--
--   ALTER TABLE materia_prima
--     ALTER COLUMN quantidade TYPE NUMERIC(18,4) USING ROUND(quantidade::numeric, 4);
--
-- Do lado do app, `registrarEntrada` e `registrarSaida` passaram a arredondar em
-- 4 casas antes de gravar — o que impede o outro caminho do mesmo problema:
-- somas binárias gravando 993.5824999999999 e a leitura seguinte partindo dali.
-- ===========================================================================
