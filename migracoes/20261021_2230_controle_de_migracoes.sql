-- migracao: 20261021_2230
-- descricao: Controle de migrações (schema controle: migrações aplicadas e execuções)
-- requer:
-- escopo: infra
-- transacao: sim
-- destrutiva: nao
--
-- A primeira migração: cria o schema "controle" com o registro das migrações
-- (uma linha por migração aplicada, com o SHA-256 do arquivo) e o diário de
-- execuções (sucesso, falha, recusa). Os dois registros não se alteram nem se
-- apagam (trigger). Não mexe em nenhuma tabela do aplicativo.
--
-- Escopo infra: é do próprio executor, não da estrutura do aplicativo. Na VPS
-- o executor a aplica sozinho; no Windows ela só é necessária se o dono quiser
-- usar o executor lá; na produção, só se o dono decidir usar o executor lá.
--
-- Roda pelo executor (node scripts/migracoes/cli.js aplicar 20261021_2230 ...),
-- que abre a transação e grava o registro desta própria migração no fim.
-- Ver docs/ambientes-dev-e-migracoes.md.

DO $pre$
BEGIN
  IF to_regnamespace('controle') IS NOT NULL THEN
    RAISE EXCEPTION 'O schema controle já existe: esta migração já foi aplicada, ou há outro objeto com esse nome.';
  END IF;
END
$pre$;

CREATE SCHEMA controle;
COMMENT ON SCHEMA controle IS 'App-Gestão: controle das migrações SQL (pasta migracoes/). As telas não usam.';

CREATE TABLE controle.migracoes_aplicadas (
  id             varchar(13)  PRIMARY KEY CHECK (id ~ '^[0-9]{8}_[0-9]{4}$'),
  arquivo        varchar(200) NOT NULL UNIQUE CHECK (arquivo ~ '^[0-9]{8}_[0-9]{4}_[a-z0-9_]+\.sql$'),
  sha256         char(64)     NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  descricao      text,
  ambiente       varchar(20)  NOT NULL CHECK (ambiente IN ('dev-windows', 'dev-vps')),
  modo           varchar(20)  NOT NULL DEFAULT 'executada' CHECK (modo IN ('executada', 'registrada')),
  aplicada_em    timestamptz  NOT NULL DEFAULT now(),
  duracao_ms     integer      CHECK (duracao_ms >= 0),
  executada_por  name         NOT NULL DEFAULT current_user,
  maquina        varchar(100),
  commit_git     varchar(40),
  arquivo_no_git boolean,
  ferramenta     varchar(60)
);
COMMENT ON TABLE controle.migracoes_aplicadas IS 'Uma linha por migração aplicada neste banco. modo=registrada: aplicada à mão (psql) e só registrada depois.';

CREATE TABLE controle.migracoes_execucoes (
  id            bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migracao_id   varchar(13)  NOT NULL,
  arquivo       varchar(200),
  sha256        char(64),
  ambiente      varchar(20)  NOT NULL,
  iniciada_em   timestamptz  NOT NULL,
  terminada_em  timestamptz  NOT NULL DEFAULT now(),
  resultado     varchar(20)  NOT NULL CHECK (resultado IN ('sucesso', 'falha', 'recusada')),
  erro_codigo   varchar(10),
  erro_mensagem varchar(500),
  executada_por name         NOT NULL DEFAULT current_user,
  maquina       varchar(100),
  commit_git    varchar(40)
);
COMMENT ON TABLE controle.migracoes_execucoes IS 'Diário de toda tentativa de aplicar migração (o erro guardado sem valores de dados).';
CREATE INDEX migracoes_execucoes_migracao_idx ON controle.migracoes_execucoes (migracao_id, iniciada_em);

CREATE FUNCTION controle.registro_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'O registro de migrações não se altera nem se apaga (%).', TG_TABLE_NAME;
END
$f$;

CREATE TRIGGER migracoes_aplicadas_imutavel
  BEFORE UPDATE OR DELETE OR TRUNCATE ON controle.migracoes_aplicadas
  FOR EACH STATEMENT EXECUTE FUNCTION controle.registro_imutavel();
CREATE TRIGGER migracoes_execucoes_imutavel
  BEFORE UPDATE OR DELETE OR TRUNCATE ON controle.migracoes_execucoes
  FOR EACH STATEMENT EXECUTE FUNCTION controle.registro_imutavel();
