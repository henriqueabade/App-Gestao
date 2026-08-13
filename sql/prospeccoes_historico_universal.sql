-- ============================================================================
--  prospeccoes_historico_universal.sql
--  Histórico completo e imutável do módulo Prospecções — App-Gestao
--
--  Rode DEPOIS de sql/prospeccoes.sql.
--
--  ------------------------------------------------------------------------
--  POR QUE UMA TABELA NOVA
--
--  `prospeccao_etapas_historico` só sabe registrar movimentação de funil:
--  tem `etapa_anterior` e `etapa_nova` e nada mais. Não há onde guardar
--  "o valor estimado passou de 48.000 para 62.000", nem o conteúdo de uma
--  nota que foi apagada.
--
--  `prospeccao_historico` registra QUALQUER acontecimento, sempre com o valor
--  anterior ao lado do novo. Em exclusão, o registro inteiro é fotografado em
--  `detalhe` (JSON) — é o que permite responder "o que era antes?" mesmo depois
--  de o dado original não existir mais.
--
--  Os registros do histórico NÃO são apagáveis pela interface comum: só o
--  Sup Admin remove, e isso é garantido no backend (exigirSupAdmin).
--
--  Script idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A tabela
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospeccao_historico (
  id             SERIAL PRIMARY KEY,
  prospeccao_id  INTEGER NOT NULL REFERENCES prospeccoes(id) ON DELETE CASCADE,

  -- O QUE aconteceu
  tipo           VARCHAR(30) NOT NULL,   -- etapa, campo, contato, nota, campanha,
                                         -- interacao, anexo, orcamento, conversao,
                                         -- arquivamento, responsavel, criacao
  acao           VARCHAR(20) NOT NULL,   -- criou, alterou, excluiu, moveu, converteu

  -- Rótulo humano do alvo: "Valor estimado", "Contato Ricardo Mourão",
  -- "Campanha Portfólio 2026". É o que a tela mostra na linha.
  entidade       VARCHAR(180),

  -- Nome técnico do campo quando `tipo = 'campo'` (valor_estimado, cnpj…).
  campo          VARCHAR(60),

  -- O par que responde "o que mudou". Texto por opção: o histórico precisa
  -- guardar número, data, booleano e texto na mesma coluna, e nunca mais
  -- será usado em cálculo.
  valor_anterior TEXT,
  valor_novo     TEXT,

  -- Fotografia do registro inteiro, em JSON. Preenchido em exclusões, onde a
  -- linha original deixa de existir e só isto responde "o que era antes".
  detalhe        JSONB,

  observacao     TEXT,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pros_historico_acao_check') THEN
    ALTER TABLE prospeccao_historico
      ADD CONSTRAINT pros_historico_acao_check
      CHECK (acao IN ('criou', 'alterou', 'excluiu', 'moveu', 'converteu'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_pros_historico_prospeccao ON prospeccao_historico(prospeccao_id);
CREATE INDEX IF NOT EXISTS idx_pros_historico_criado_em  ON prospeccao_historico(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pros_historico_tipo       ON prospeccao_historico(tipo);

-- ---------------------------------------------------------------------------
-- 2) Traz o que já existe em prospeccao_etapas_historico
--
--    A guarda pelo NOT EXISTS deixa o script repetível: rodar duas vezes não
--    duplica as movimentações antigas.
-- ---------------------------------------------------------------------------
INSERT INTO prospeccao_historico
  (prospeccao_id, tipo, acao, entidade, valor_anterior, valor_novo, observacao, usuario_id, criado_em)
SELECT
  h.prospeccao_id,
  'etapa',
  CASE WHEN h.etapa_anterior IS NULL THEN 'criou' ELSE 'moveu' END,
  'Etapa do funil',
  h.etapa_anterior,
  h.etapa_nova,
  h.observacao,
  h.usuario_id,
  h.criado_em
  FROM prospeccao_etapas_historico h
 WHERE NOT EXISTS (
   SELECT 1 FROM prospeccao_historico ph
    WHERE ph.prospeccao_id = h.prospeccao_id
      AND ph.tipo          = 'etapa'
      AND ph.criado_em     = h.criado_em
      AND COALESCE(ph.valor_novo, '') = COALESCE(h.etapa_nova, '')
 );

-- ---------------------------------------------------------------------------
-- 3) Marca de criação para prospecções que ainda não têm nenhuma linha
--
--    Sem isto, uma prospecção antiga abriria a aba Histórico vazia, dando a
--    impressão de que o registro nunca existiu.
-- ---------------------------------------------------------------------------
INSERT INTO prospeccao_historico
  (prospeccao_id, tipo, acao, entidade, valor_novo, observacao, usuario_id, criado_em)
SELECT
  p.id, 'criacao', 'criou', 'Prospecção', p.nome_fantasia,
  'Registro anterior à implantação do histórico completo',
  p.criado_por, p.criado_em
  FROM prospeccoes p
 WHERE NOT EXISTS (SELECT 1 FROM prospeccao_historico ph WHERE ph.prospeccao_id = p.id);

COMMIT;

-- ============================================================================
--  Conferência — rode depois do COMMIT:
--
--    SELECT tipo, acao, COUNT(*)
--      FROM prospeccao_historico
--     GROUP BY tipo, acao
--     ORDER BY tipo, acao;
--
--    SELECT p.nome_fantasia, COUNT(h.id) AS eventos
--      FROM prospeccoes p
--      LEFT JOIN prospeccao_historico h ON h.prospeccao_id = p.id
--     GROUP BY p.nome_fantasia
--     ORDER BY eventos DESC;
--
--  Toda prospecção deve ter pelo menos 1 evento.
--
-- ----------------------------------------------------------------------------
--  A TABELA ANTIGA
--
--  `prospeccao_etapas_historico` deixa de ser escrita a partir desta versão,
--  mas NÃO é derrubada aqui de propósito: os dados dela já foram copiados
--  acima e ela fica como rede de segurança até você conferir a migração.
--
--  Quando a conferência acima estiver de acordo, pode remover:
--
--    DROP TABLE prospeccao_etapas_historico;
-- ============================================================================
