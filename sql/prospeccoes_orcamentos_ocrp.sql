-- ============================================================================
--  Orçamentos de prospecção (OCRP) — Etapa 7a
--
--  Um orçamento pode nascer para uma PROSPECÇÃO, antes de existir cliente.
--  O vínculo `orcamentos.prospeccao_id` já foi criado em `prospeccoes.sql`;
--  falta agora tornar o registro POSSÍVEL sem cliente e guardar QUAL contato
--  da prospecção recebeu a proposta.
--
--  Por que uma coluna nova em vez de reaproveitar `contato_id`:
--  `contato_id` referencia `contatos` (contatos de CLIENTE). Um contato de
--  prospecção vive em `prospeccao_contatos`, com numeração própria — gravar o
--  id de um na coluna do outro violaria a chave estrangeira ou, pior, apontaria
--  silenciosamente para o contato errado de outro cliente.
--
--  Aplicar com:
--      psql -h <host> -U <usuario> -d <banco> -f prospeccoes_orcamentos_ocrp.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Orçamento sem cliente
--
--    Enquanto a prospecção não vira cliente, não há o que pôr em `cliente_id`.
--    Na conversão o mesmo orçamento passa a ter os DOIS preenchidos, o que
--    preserva a origem em vez de apagá-la.
-- ---------------------------------------------------------------------------
ALTER TABLE orcamentos ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE orcamentos ALTER COLUMN contato_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Contato da prospecção que recebeu a proposta
-- ---------------------------------------------------------------------------
ALTER TABLE orcamentos
  ADD COLUMN IF NOT EXISTS prospeccao_contato_id INTEGER
    REFERENCES prospeccao_contatos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orcamentos_prospeccao_contato
  ON orcamentos(prospeccao_contato_id);

-- ---------------------------------------------------------------------------
-- 3) Todo orçamento pertence a alguém
--
--    Afrouxar o NOT NULL de `cliente_id` sem isto abriria espaço para orçamento
--    órfão: sem cliente E sem prospecção, invisível nas duas telas.
--
--    NOT VALID de propósito: a regra passa a valer para tudo que for gravado
--    daqui em diante SEM varrer a tabela inteira agora. Se houver linha antiga
--    fora do padrão, a migração não quebra — a conferência no fim do arquivo
--    mostra quantas são.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orcamentos_dono_cliente_ou_prospeccao'
  ) THEN
    ALTER TABLE orcamentos
      ADD CONSTRAINT orcamentos_dono_cliente_ou_prospeccao
      CHECK (cliente_id IS NOT NULL OR prospeccao_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

COMMIT;

-- ============================================================================
--  Conferência rápida — rode depois do COMMIT:
--
--  1) As colunas ficaram anuláveis e a nova existe?
--
--     SELECT column_name, is_nullable
--       FROM information_schema.columns
--      WHERE table_name = 'orcamentos'
--        AND column_name IN ('cliente_id', 'contato_id',
--                            'prospeccao_id', 'prospeccao_contato_id')
--      ORDER BY column_name;
--
--     Esperado: cliente_id = YES, contato_id = YES,
--               prospeccao_id = YES, prospeccao_contato_id = YES (4 linhas).
--
--  2) Existe orçamento órfão (sem cliente e sem prospecção)?
--
--     SELECT COUNT(*) AS orfaos
--       FROM orcamentos
--      WHERE cliente_id IS NULL AND prospeccao_id IS NULL;
--
--     Esperado: 0. Se vier maior que zero, são linhas ANTERIORES a esta
--     migração — me avise antes de validar a constraint.
--
--  3) Só depois de (2) devolver 0, opcionalmente valide a regra para o
--     passado também:
--
--     ALTER TABLE orcamentos VALIDATE CONSTRAINT orcamentos_dono_cliente_ou_prospeccao;
-- ============================================================================
