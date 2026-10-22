-- =============================================================================
-- SÓ DA VPS — registro das operações exclusivas do DEV da VPS
-- =============================================================================
-- Cria controle.operacoes_dev_vps: uma linha (imutável) por operação que vale
-- só para o banco DEV da VPS — sanitização, marca, ajustes, dados fictícios.
-- Nada disto vai para o Windows nem para a produção. Requer o schema controle
-- (migração 20261021_2230). Rode pelo executor: scripts/dev-vps/operacao-vps.js.
-- =============================================================================
\set ON_ERROR_STOP on
\if :{?operacao_sha256}
\else
  \echo 'ERRO: rode pelo scripts/dev-vps/operacao-vps.js (falta operacao_sha256).'
  \quit
\endif

SET client_encoding = 'UTF8';
BEGIN;
DO $guarda$
BEGIN
  IF current_database() <> 'Santissimo_Decor_App_Gestao_Dev_VPS'
     OR shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') IS DISTINCT FROM 'app-gestao:dev-vps' THEN
    RAISE EXCEPTION 'GUARDA: só no banco DEV da VPS, com a marca app-gestao:dev-vps.';
  END IF;
  IF to_regnamespace('controle') IS NULL THEN
    RAISE EXCEPTION 'Falta o schema controle: aplique antes a migração 20261021_2230.';
  END IF;
  IF to_regclass('controle.operacoes_dev_vps') IS NOT NULL THEN
    RAISE EXCEPTION 'controle.operacoes_dev_vps já existe: nada a fazer.';
  END IF;
END
$guarda$;

CREATE TABLE controle.operacoes_dev_vps (
  id             bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operacao       varchar(120) NOT NULL,
  sha256         char(64)     NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  executada_em   timestamptz  NOT NULL DEFAULT now(),
  executada_por  name         NOT NULL DEFAULT current_user,
  maquina        varchar(100),
  backup_arquivo text,
  backup_sha256  char(64),
  resumo         jsonb,
  observacao     text
);
COMMENT ON TABLE controle.operacoes_dev_vps IS 'Operações exclusivas do DEV da VPS (sanitização, marca, ajustes). Não vão ao Windows nem à produção.';

CREATE TRIGGER operacoes_dev_vps_imutavel
  BEFORE UPDATE OR DELETE OR TRUNCATE ON controle.operacoes_dev_vps
  FOR EACH STATEMENT EXECUTE FUNCTION controle.registro_imutavel();

INSERT INTO controle.operacoes_dev_vps (operacao, sha256, maquina, backup_arquivo, backup_sha256, resumo, observacao)
VALUES ('registro-de-operacoes-dev-vps.sql', :'operacao_sha256', :'maquina', nullif(:'backup_arquivo', ''), nullif(:'backup_sha256', ''),
        jsonb_build_object('criou', 'controle.operacoes_dev_vps',
                           'antes_desta_tabela', jsonb_build_array(
                             'marca app-gestao:dev-vps gravada por scripts/migracoes/cli.js marcar-ambiente dev-vps',
                             'schema controle criado pela migração 20261021_2230 (registrada em controle.migracoes_aplicadas)')),
        'tabela do registro criada');
COMMIT;
\echo 'controle.operacoes_dev_vps criada e registrada.'
