-- Executar no banco selecionado e reiniciar a API para ela reler o esquema.
-- Só cria o histórico novo. Não altera usuários nem tenta inventar eventos antigos.
BEGIN;

CREATE TABLE IF NOT EXISTS public.usuarios_auditoria (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  modulo VARCHAR(80) NOT NULL,
  acao VARCHAR(80) NOT NULL,
  entidade VARCHAR(80) NOT NULL,
  entidade_id VARCHAR(32),
  origem VARCHAR(16) NOT NULL CHECK (origem IN ('manual', 'automatico', 'sistema', 'nao_confirmada')),
  resultado VARCHAR(12) NOT NULL CHECK (resultado IN ('sucesso', 'falha', 'cancelado')),
  acao_id VARCHAR(64),
  contexto JSONB NOT NULL DEFAULT '{}'::jsonb,
  descricao VARCHAR(250) NOT NULL,
  mudancas JSONB NOT NULL DEFAULT '[]'::jsonb,
  CHECK (usuario_id IS NOT NULL OR origem = 'sistema'),
  CHECK (jsonb_typeof(mudancas) = 'array')
);

-- Sem FK com DELETE CASCADE: excluir um cadastro nunca elimina sua autoria.
CREATE INDEX IF NOT EXISTS usuarios_auditoria_usuario_data_idx
  ON public.usuarios_auditoria (usuario_id, criado_em DESC, id DESC);
CREATE INDEX IF NOT EXISTS usuarios_auditoria_modulo_data_idx
  ON public.usuarios_auditoria (modulo, criado_em DESC);

CREATE OR REPLACE FUNCTION public.usuarios_auditoria_carimbar()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.criado_em := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.usuarios_auditoria_impedir_alteracao()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de auditoria só permite inserir registros.';
END;
$$;

DROP TRIGGER IF EXISTS usuarios_auditoria_hora_servidor ON public.usuarios_auditoria;
CREATE TRIGGER usuarios_auditoria_hora_servidor BEFORE INSERT ON public.usuarios_auditoria
  FOR EACH ROW EXECUTE FUNCTION public.usuarios_auditoria_carimbar();
DROP TRIGGER IF EXISTS usuarios_auditoria_sem_edicao ON public.usuarios_auditoria;
CREATE TRIGGER usuarios_auditoria_sem_edicao BEFORE UPDATE OR DELETE ON public.usuarios_auditoria
  FOR EACH ROW EXECUTE FUNCTION public.usuarios_auditoria_impedir_alteracao();
DROP TRIGGER IF EXISTS usuarios_auditoria_sem_truncate ON public.usuarios_auditoria;
CREATE TRIGGER usuarios_auditoria_sem_truncate BEFORE TRUNCATE ON public.usuarios_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION public.usuarios_auditoria_impedir_alteracao();

COMMIT;
