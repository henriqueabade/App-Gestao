-- =============================================================================
-- SÓ DA VPS — compactação do banco DEV da VPS depois da sanitização
-- =============================================================================
-- O UPDATE da sanitização não apaga o valor antigo do disco: a versão anterior
-- de cada linha (com o dado real) fica no arquivo da tabela até ser regravada,
-- e as estatísticas do planejador (pg_statistic) guardam amostras dos valores.
-- VACUUM (FULL, ANALYZE) regrava cada tabela só com as linhas vivas e refaz as
-- estatísticas a partir dos dados sanitizados. Não muda nenhum dado.
--
-- Rode pelo executor das operações da VPS (backup verificado + registro):
--   node scripts/dev-vps/operacao-vps.js scripts/dev-vps/compactar-banco-dev-vps.sql
-- Depois, como postgres, CHECKPOINT e troca de segmento do WAL (seção 4 de
-- docs/ambientes-dev-e-migracoes.md). Não vai ao Windows nem à produção.
-- =============================================================================
\set ON_ERROR_STOP on
\if :{?operacao_sha256}
\else
  \echo 'ERRO: rode pelo scripts/dev-vps/operacao-vps.js (falta operacao_sha256).'
  \quit
\endif

SET client_encoding = 'UTF8';
DO $guarda$
BEGIN
  IF current_database() <> 'Santissimo_Decor_App_Gestao_Dev_VPS'
     OR current_user <> 'app_gestao_dev'
     OR shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') IS DISTINCT FROM 'app-gestao:dev-vps' THEN
    RAISE EXCEPTION 'GUARDA: só no banco DEV da VPS, com a marca app-gestao:dev-vps e o usuário app_gestao_dev.';
  END IF;
  IF to_regclass('controle.operacoes_dev_vps') IS NULL
     OR NOT EXISTS (SELECT 1 FROM controle.operacoes_dev_vps WHERE operacao = 'sanitizar-banco-dev-vps.sql') THEN
    RAISE EXCEPTION 'GUARDA: a sanitização ainda não foi aplicada neste banco.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()) THEN
    RAISE EXCEPTION 'GUARDA: há outra conexão neste banco (feche o app e os testes antes de compactar).';
  END IF;
END
$guarda$;

SELECT pg_database_size(current_database()) AS tamanho_antes,
       coalesce(sum(n_dead_tup), 0) AS mortas_antes
  FROM pg_stat_user_tables \gset

VACUUM (FULL, ANALYZE);

SELECT pg_database_size(current_database()) AS tamanho_depois,
       coalesce(sum(n_dead_tup), 0) AS mortas_depois
  FROM pg_stat_user_tables \gset

INSERT INTO controle.operacoes_dev_vps (operacao, sha256, maquina, backup_arquivo, backup_sha256, resumo, observacao)
VALUES ('compactar-banco-dev-vps.sql', :'operacao_sha256', :'maquina', nullif(:'backup_arquivo', ''), nullif(:'backup_sha256', ''),
        jsonb_build_object('tamanho_antes', :tamanho_antes, 'tamanho_depois', :tamanho_depois,
                           'linhas_mortas_antes', :mortas_antes, 'linhas_mortas_depois', :mortas_depois),
        'VACUUM (FULL, ANALYZE): tabelas regravadas só com as linhas sanitizadas');

\echo 'Compactação feita:'
SELECT pg_size_pretty(:tamanho_antes::bigint) AS antes, pg_size_pretty(:tamanho_depois::bigint) AS depois,
       :mortas_antes AS linhas_mortas_antes, :mortas_depois AS linhas_mortas_depois;
