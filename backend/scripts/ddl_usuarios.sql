-- Script de DDL/migração para garantir colunas necessárias da tabela usuarios
-- Inclui campos de confirmação de e-mail, status detalhado e carimbos de data

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT,
  email TEXT UNIQUE,
  senha TEXT,
  perfil TEXT,
  verificado BOOLEAN DEFAULT false,
  hora_ativacao TIMESTAMPTZ
);

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS confirmacao BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_confirmado BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_confirmado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmacao_token TEXT,
  ADD COLUMN IF NOT EXISTS confirmacao_token_gerado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmacao_token_expira_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmacao_token_revogado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'nao_confirmado',
  ADD COLUMN IF NOT EXISTS status_atualizado_em TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'usuarios' AND constraint_name = 'usuarios_status_check'
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_status_check
      CHECK (status IN ('nao_confirmado', 'aguardando_aprovacao', 'ativo'));
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unq
  ON usuarios (lower(email));

UPDATE usuarios
   SET status = CASE
         WHEN verificado IS TRUE THEN 'ativo'
         ELSE 'nao_confirmado'
       END,
       status_atualizado_em = COALESCE(status_atualizado_em, NOW())
 WHERE status IS NULL
    OR status NOT IN ('nao_confirmado', 'aguardando_aprovacao', 'ativo');

UPDATE usuarios
   SET confirmacao = COALESCE(confirmacao, email_confirmado, verificado, false)
 WHERE confirmacao IS NULL;

UPDATE usuarios
   SET email_confirmado = confirmacao
 WHERE email_confirmado IS DISTINCT FROM confirmacao;

UPDATE usuarios
   SET email_confirmado_em = CASE
         WHEN confirmacao IS TRUE AND email_confirmado_em IS NULL THEN NOW()
         ELSE email_confirmado_em
       END
 WHERE confirmacao IS TRUE;

-- Para usuários já ativados, garanta que verificado acompanhe o status
UPDATE usuarios
   SET verificado = CASE WHEN status = 'ativo' THEN true ELSE false END
 WHERE (status = 'ativo' AND verificado IS DISTINCT FROM true)
    OR (status <> 'ativo' AND verificado IS DISTINCT FROM false);
