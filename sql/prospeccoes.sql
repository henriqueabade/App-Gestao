-- ============================================================================
--  prospeccoes.sql
--  Estrutura de dados do módulo Prospecções (CRM) — App-Gestao
--
--  MODELO: a prospecção é uma EMPRESA (entidade), não um contato solto.
--  Os contatos, interações, notas, anexos e campanhas pendem dela.
--
--      prospeccoes ............... a empresa prospectada + a oportunidade
--       ├── prospeccao_contatos ......... pessoas da empresa (cargo, decisor)
--       ├── prospeccao_interacoes ....... timeline (ligação, e-mail, reunião…)
--       ├── prospeccao_etapas_historico . auditoria de movimentação no funil
--       ├── prospeccao_notas ............ notas livres
--       │    └── prospeccao_anexos ...... metadados do arquivo
--       │         └── prospeccao_anexo_conteudo ... o BYTEA, em tabela à parte
--       └── prospeccao_campanhas ........ campanhas de marketing/outbound
--
--      orcamentos.prospeccao_id ........ orçamento emitido para a prospecção
--                                        (antes de existir cliente)
--
--  FUNIL: Novo → Contactado → Qualificado → Proposta → Negociação → Ganho
--                                                                 ↘ Perdido
--
--  CONVERSÃO: ao ganhar, cria-se o registro em `clientes`, grava-se
--  `cliente_id` e a prospecção vira status 'arquivada'. Nada é apagado —
--  a timeline de como o negócio foi ganho continua consultável.
--
--  Dados fiscais (CNPJ, inscrição estadual) são OPCIONAIS aqui: no primeiro
--  contato raramente se tem esse dado. A obrigatoriedade existe no módulo
--  Clientes, aplicada no momento da conversão.
--
--  Script idempotente: pode rodar mais de uma vez sem erro e sem sobrescrever
--  nada já existente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Gatilho compartilhado para manter `atualizado_em` honesto
--
--    A coluna alimenta a permissão `col_pros_atualizado_em`. Deixar o
--    preenchimento por conta de quem escreve significa que uma gravação vinda
--    de fora do app (importação, correção manual) deixaria a data mentindo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prospeccoes_tocar_atualizado_em()
RETURNS TRIGGER AS $func$
BEGIN
  NEW.atualizado_em := NOW();
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 1) prospeccoes — a empresa prospectada e a oportunidade em si
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospeccoes (
  id                    SERIAL PRIMARY KEY,

  -- Identificação da empresa
  nome_fantasia         VARCHAR(180) NOT NULL,
  razao_social          VARCHAR(180),
  cnpj                  VARCHAR(18),
  inscricao_estadual    VARCHAR(20),
  site                  VARCHAR(255),
  segmento              VARCHAR(120),

  -- Oportunidade
  origem                VARCHAR(80),
  etapa                 VARCHAR(20)   NOT NULL DEFAULT 'Novo',
  valor_estimado        NUMERIC(14,2) NOT NULL DEFAULT 0,
  probabilidade         SMALLINT      NOT NULL DEFAULT 0,
  responsavel_id        INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,

  -- Próximo passo (permissão pros.next.step)
  proximo_passo         VARCHAR(255),
  proximo_passo_data    DATE,

  -- Endereço (mesmos sufixos usados em clientes: reutiliza col_end_* do catálogo)
  end_logradouro        VARCHAR(180),
  end_numero            VARCHAR(20),
  end_complemento       VARCHAR(120),
  end_bairro            VARCHAR(120),
  end_cidade            VARCHAR(120),
  end_uf                VARCHAR(80),
  end_pais              VARCHAR(80),
  end_cep               VARCHAR(20),

  -- Ciclo de vida
  status                VARCHAR(20) NOT NULL DEFAULT 'ativa',
  motivo_perda          TEXT,
  cliente_id            INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  convertida_em         TIMESTAMPTZ,

  anotacoes             TEXT,
  criado_por            INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Colunas adicionadas separadamente para que o script rode também sobre uma
-- instalação anterior parcial.
ALTER TABLE prospeccoes ADD COLUMN IF NOT EXISTS segmento           VARCHAR(120);
ALTER TABLE prospeccoes ADD COLUMN IF NOT EXISTS motivo_perda       TEXT;
ALTER TABLE prospeccoes ADD COLUMN IF NOT EXISTS cliente_id         INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
ALTER TABLE prospeccoes ADD COLUMN IF NOT EXISTS convertida_em      TIMESTAMPTZ;
ALTER TABLE prospeccoes ADD COLUMN IF NOT EXISTS proximo_passo      VARCHAR(255);
ALTER TABLE prospeccoes ADD COLUMN IF NOT EXISTS proximo_passo_data DATE;

-- Etapa: as 7 do funil comercial. 'Ganho' e 'Perdido' são terminais.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospeccoes_etapa_check'
  ) THEN
    ALTER TABLE prospeccoes
      ADD CONSTRAINT prospeccoes_etapa_check
      CHECK (etapa IN ('Novo','Contactado','Qualificado','Proposta','Negociação','Ganho','Perdido'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospeccoes_status_check'
  ) THEN
    ALTER TABLE prospeccoes
      ADD CONSTRAINT prospeccoes_status_check
      CHECK (status IN ('ativa','arquivada'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospeccoes_probabilidade_check'
  ) THEN
    ALTER TABLE prospeccoes
      ADD CONSTRAINT prospeccoes_probabilidade_check
      CHECK (probabilidade BETWEEN 0 AND 100);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospeccoes_valor_check'
  ) THEN
    ALTER TABLE prospeccoes
      ADD CONSTRAINT prospeccoes_valor_check
      CHECK (valor_estimado >= 0);
  END IF;
END$$;

-- O mesmo CNPJ não pode ser prospectado duas vezes em paralelo. Índice
-- PARCIAL: só vale para prospecções ativas e com CNPJ informado — o campo é
-- opcional, e uma empresa perdida hoje pode voltar a ser prospectada amanhã.
CREATE UNIQUE INDEX IF NOT EXISTS prospeccoes_cnpj_ativa_unq
  ON prospeccoes (cnpj)
  WHERE cnpj IS NOT NULL AND cnpj <> '' AND status = 'ativa';

CREATE INDEX IF NOT EXISTS idx_prospeccoes_etapa        ON prospeccoes(etapa);
CREATE INDEX IF NOT EXISTS idx_prospeccoes_status       ON prospeccoes(status);
CREATE INDEX IF NOT EXISTS idx_prospeccoes_responsavel  ON prospeccoes(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_prospeccoes_origem       ON prospeccoes(origem);
CREATE INDEX IF NOT EXISTS idx_prospeccoes_cliente      ON prospeccoes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_prospeccoes_prox_passo   ON prospeccoes(proximo_passo_data)
  WHERE proximo_passo_data IS NOT NULL;

DROP TRIGGER IF EXISTS trg_prospeccoes_atualizado_em ON prospeccoes;
CREATE TRIGGER trg_prospeccoes_atualizado_em
  BEFORE UPDATE ON prospeccoes
  FOR EACH ROW EXECUTE FUNCTION prospeccoes_tocar_atualizado_em();


-- ---------------------------------------------------------------------------
-- 2) prospeccao_contatos — as pessoas dentro da empresa
--
--    Tabela própria, e não `contatos_cliente`: aquela exige `id_cliente` com
--    FK para `clientes`, e uma prospecção ainda não é cliente. Na conversão os
--    contatos são copiados para `contatos_cliente`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospeccao_contatos (
  id                SERIAL PRIMARY KEY,
  prospeccao_id     INTEGER NOT NULL REFERENCES prospeccoes(id) ON DELETE CASCADE,
  nome              VARCHAR(180) NOT NULL,
  cargo             VARCHAR(120),
  email             VARCHAR(180),
  telefone_fixo     VARCHAR(30),
  telefone_celular  VARCHAR(30),
  decisor           BOOLEAN NOT NULL DEFAULT FALSE,
  principal         BOOLEAN NOT NULL DEFAULT FALSE,
  observacao        TEXT,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pros_contatos_prospeccao ON prospeccao_contatos(prospeccao_id);

-- No máximo UM contato principal por prospecção.
CREATE UNIQUE INDEX IF NOT EXISTS pros_contatos_principal_unq
  ON prospeccao_contatos (prospeccao_id)
  WHERE principal;

DROP TRIGGER IF EXISTS trg_pros_contatos_atualizado_em ON prospeccao_contatos;
CREATE TRIGGER trg_pros_contatos_atualizado_em
  BEFORE UPDATE ON prospeccao_contatos
  FOR EACH ROW EXECUTE FUNCTION prospeccoes_tocar_atualizado_em();


-- ---------------------------------------------------------------------------
-- 3) prospeccao_interacoes — a timeline
--    Alimenta as colunas col_hist_data / col_hist_tipo / col_hist_resumo /
--    col_hist_resp já previstas no catálogo de permissões.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospeccao_interacoes (
  id             SERIAL PRIMARY KEY,
  prospeccao_id  INTEGER NOT NULL REFERENCES prospeccoes(id) ON DELETE CASCADE,
  contato_id     INTEGER REFERENCES prospeccao_contatos(id) ON DELETE SET NULL,
  tipo           VARCHAR(20) NOT NULL,
  data           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resumo         VARCHAR(255) NOT NULL,
  detalhe        TEXT,
  duracao_min    SMALLINT,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pros_interacoes_tipo_check'
  ) THEN
    ALTER TABLE prospeccao_interacoes
      ADD CONSTRAINT pros_interacoes_tipo_check
      CHECK (tipo IN ('Ligação','E-mail','Reunião','WhatsApp','Visita','Nota','Proposta'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_pros_interacoes_prospeccao ON prospeccao_interacoes(prospeccao_id);
CREATE INDEX IF NOT EXISTS idx_pros_interacoes_data       ON prospeccao_interacoes(data DESC);
CREATE INDEX IF NOT EXISTS idx_pros_interacoes_contato    ON prospeccao_interacoes(contato_id);


-- ---------------------------------------------------------------------------
-- 4) prospeccao_etapas_historico — auditoria do funil
--    Toda movimentação por `pros.stage.update` deixa rastro aqui. É o que
--    permite medir tempo médio por etapa e taxa de conversão real.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospeccao_etapas_historico (
  id              SERIAL PRIMARY KEY,
  prospeccao_id   INTEGER NOT NULL REFERENCES prospeccoes(id) ON DELETE CASCADE,
  etapa_anterior  VARCHAR(20),
  etapa_nova      VARCHAR(20) NOT NULL,
  observacao      TEXT,
  usuario_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pros_etapas_prospeccao ON prospeccao_etapas_historico(prospeccao_id);
CREATE INDEX IF NOT EXISTS idx_pros_etapas_criado_em  ON prospeccao_etapas_historico(criado_em DESC);


-- ---------------------------------------------------------------------------
-- 5) prospeccao_notas — notas livres
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospeccao_notas (
  id             SERIAL PRIMARY KEY,
  prospeccao_id  INTEGER NOT NULL REFERENCES prospeccoes(id) ON DELETE CASCADE,
  titulo         VARCHAR(180),
  conteudo       TEXT NOT NULL,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pros_notas_prospeccao ON prospeccao_notas(prospeccao_id);

DROP TRIGGER IF EXISTS trg_pros_notas_atualizado_em ON prospeccao_notas;
CREATE TRIGGER trg_pros_notas_atualizado_em
  BEFORE UPDATE ON prospeccao_notas
  FOR EACH ROW EXECUTE FUNCTION prospeccoes_tocar_atualizado_em();


-- ---------------------------------------------------------------------------
-- 6) prospeccao_anexos — METADADOS do arquivo (tabela leve)
--
--    O conteúdo binário fica em `prospeccao_anexo_conteudo`, tabela separada.
--
--    MOTIVO — não é preferência, é imposição da API: o endpoint genérico
--    `GET /api/:table` monta o SELECT com TODAS as colunas da tabela
--    (Santissimo-db-API/server.js:608) e ignora `select=`. Se o BYTEA morasse
--    aqui, montar a lista de anexos de uma prospecção baixaria o conteúdo
--    inteiro de todos os arquivos — dezenas de MB para desenhar nomes.
--
--    Com a separação, listar metadados é barato e os bytes só descem no
--    download, buscados por id em `prospeccao_anexo_conteudo`.
--
--    `nota_id` é opcional: o anexo pode estar preso a uma nota ou solto na
--    prospecção.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospeccao_anexos (
  id             SERIAL PRIMARY KEY,
  prospeccao_id  INTEGER NOT NULL REFERENCES prospeccoes(id) ON DELETE CASCADE,
  nota_id        INTEGER REFERENCES prospeccao_notas(id) ON DELETE CASCADE,
  nome_arquivo   VARCHAR(255) NOT NULL,
  tipo_mime      VARCHAR(120),
  tamanho_bytes  INTEGER,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prospeccao_anexo_conteudo (
  anexo_id  INTEGER PRIMARY KEY REFERENCES prospeccao_anexos(id) ON DELETE CASCADE,
  conteudo  BYTEA NOT NULL
);

-- Migração para quem já aplicou a primeira versão deste script, em que o BYTEA
-- morava em `prospeccao_anexos.conteudo`. Move o conteúdo e derruba a coluna.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'prospeccao_anexos'
       AND column_name  = 'conteudo'
  ) THEN
    INSERT INTO prospeccao_anexo_conteudo (anexo_id, conteudo)
    SELECT id, conteudo
      FROM prospeccao_anexos
     WHERE conteudo IS NOT NULL
    ON CONFLICT (anexo_id) DO NOTHING;

    ALTER TABLE prospeccao_anexos DROP COLUMN conteudo;

    RAISE NOTICE 'prospeccao_anexos.conteudo migrado para prospeccao_anexo_conteudo.';
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_pros_anexos_prospeccao ON prospeccao_anexos(prospeccao_id);
CREATE INDEX IF NOT EXISTS idx_pros_anexos_nota       ON prospeccao_anexos(nota_id);


-- ---------------------------------------------------------------------------
-- 7) prospeccao_campanhas — histórico de campanhas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospeccao_campanhas (
  id             SERIAL PRIMARY KEY,
  prospeccao_id  INTEGER NOT NULL REFERENCES prospeccoes(id) ON DELETE CASCADE,
  nome           VARCHAR(180) NOT NULL,
  canal          VARCHAR(80),
  status         VARCHAR(20) NOT NULL DEFAULT 'Planejada',
  data_envio     DATE,
  resposta       VARCHAR(120),
  observacao     TEXT,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pros_campanhas_status_check'
  ) THEN
    ALTER TABLE prospeccao_campanhas
      ADD CONSTRAINT pros_campanhas_status_check
      CHECK (status IN ('Planejada','Em andamento','Concluída','Cancelada'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_pros_campanhas_prospeccao ON prospeccao_campanhas(prospeccao_id);

DROP TRIGGER IF EXISTS trg_pros_campanhas_atualizado_em ON prospeccao_campanhas;
CREATE TRIGGER trg_pros_campanhas_atualizado_em
  BEFORE UPDATE ON prospeccao_campanhas
  FOR EACH ROW EXECUTE FUNCTION prospeccoes_tocar_atualizado_em();


-- ---------------------------------------------------------------------------
-- 8) Vínculo com Orçamentos
--
--    Um orçamento pode nascer para uma PROSPECÇÃO, antes de existir cliente.
--    A coluna é anulável e não substitui `cliente_id`: na conversão o mesmo
--    orçamento passa a ter os dois preenchidos, preservando a origem.
-- ---------------------------------------------------------------------------
ALTER TABLE orcamentos
  ADD COLUMN IF NOT EXISTS prospeccao_id INTEGER REFERENCES prospeccoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orcamentos_prospeccao ON orcamentos(prospeccao_id);

COMMIT;

-- ============================================================================
--  Conferência rápida — rode depois do COMMIT:
--
--    SELECT table_name
--      FROM information_schema.tables
--     WHERE table_schema = 'public'
--       AND (table_name = 'prospeccoes' OR table_name LIKE 'prospeccao\_%')
--     ORDER BY table_name;
--
--  Devem aparecer 8 linhas:
--    prospeccao_anexo_conteudo, prospeccao_anexos, prospeccao_campanhas,
--    prospeccao_contatos, prospeccao_etapas_historico, prospeccao_interacoes,
--    prospeccao_notas, prospeccoes
--
--  E a coluna antiga NÃO deve mais existir (0 linhas):
--
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'prospeccao_anexos' AND column_name = 'conteudo';
-- ============================================================================
