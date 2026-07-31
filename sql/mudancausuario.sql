-- ============================================================================
--  mudancausuario.sql
--  Preferências de inicialização do menu, por usuário.
--
--  Passa a guardar no banco (antes só existia em localStorage, então cada
--  máquina tinha a sua e nada era lido no login):
--    - módulo inicial
--    - manter CRM expandido
--    - comportamento da barra lateral
--
--  Padrão ao criar usuário: dashboard, expandido OFF, barra sempre aberta.
--  Script idempotente: pode rodar mais de uma vez sem erro.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Colunas
-- ---------------------------------------------------------------------------

-- Módulo aberto logo após o login.
-- Aceita também 'last' = "retomar o último módulo aberto".
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS menu_modulo_inicial TEXT NOT NULL DEFAULT 'dashboard';

-- Submenu do CRM já aberto ao entrar. Padrão: desligado.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS menu_crm_expandido BOOLEAN NOT NULL DEFAULT FALSE;

-- 'fixed' = manter sempre aberta (padrão) · 'auto' = recolher automaticamente.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS menu_barra_lateral TEXT NOT NULL DEFAULT 'fixed';

-- ---------------------------------------------------------------------------
-- 2) Restrições de valor
--    Evita que um valor inválido vindo da tela quebre o carregamento do menu.
-- ---------------------------------------------------------------------------

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_menu_modulo_inicial_check;
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_menu_modulo_inicial_check
  CHECK (menu_modulo_inicial IN (
    'last',
    'dashboard',
    'materia-prima',
    'produtos',
    'orcamentos',
    'pedidos',
    'clientes',
    'prospeccoes',
    'contatos',
    'calendario',
    'tarefas',
    'ia',
    'usuarios',
    'financeiro',
    'relatorios',
    'laminacao-clientes',
    'laminacao-servicos',
    'laminacao-precificacao',
    'laminacao-relatorios',
    'configuracoes'
  ));

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_menu_barra_lateral_check;
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_menu_barra_lateral_check
  CHECK (menu_barra_lateral IN ('auto', 'fixed'));

-- ---------------------------------------------------------------------------
-- 3) Usuários já existentes recebem o padrão
--    (só onde estiver nulo/vazio — não sobrescreve escolha de ninguém)
-- ---------------------------------------------------------------------------

UPDATE usuarios
   SET menu_modulo_inicial = 'dashboard'
 WHERE menu_modulo_inicial IS NULL OR btrim(menu_modulo_inicial) = '';

UPDATE usuarios
   SET menu_crm_expandido = FALSE
 WHERE menu_crm_expandido IS NULL;

UPDATE usuarios
   SET menu_barra_lateral = 'fixed'
 WHERE menu_barra_lateral IS NULL OR btrim(menu_barra_lateral) = '';

COMMIT;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
-- SELECT id, nome, menu_modulo_inicial, menu_crm_expandido, menu_barra_lateral
--   FROM usuarios
--  ORDER BY id;
