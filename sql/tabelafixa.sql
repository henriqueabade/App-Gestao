-- =====================================================================
-- TABELA FIXA DE PREÇOS — App-Gestao
--
-- A peça passa a ter dois preços, com donos diferentes:
--
--   produtos.preco_venda  → preço CALCULADO. Muda sozinho sempre que um
--                           insumo muda de custo.
--   tabela_fixa.vlr_prod  → preço PRATICADO. Só muda por decisão explícita
--                           ("Atualizar Tabela Fixa" ao salvar o produto).
--
-- Orçamentos, Relatórios e a lista de Produtos leem o preço praticado.
-- Pedido não: ao converter, o preço é copiado para pedidos_itens e congela.
--
-- Seguro rodar em banco já existente: só cria o que falta.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) A tabela em si (idempotente — normalmente já existe)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tabela_fixa (
  id_prod  INTEGER PRIMARY KEY,
  cod_prod VARCHAR(40),
  vlr_prod NUMERIC(12,2)
);

-- Garante as colunas caso a tabela tenha sido criada em versão anterior.
ALTER TABLE tabela_fixa ADD COLUMN IF NOT EXISTS cod_prod VARCHAR(40);
ALTER TABLE tabela_fixa ADD COLUMN IF NOT EXISTS vlr_prod NUMERIC(12,2);

-- id_prod aponta para produtos.id. O ON DELETE CASCADE evita preço órfão:
-- sem ele, excluir uma peça deixaria a linha para trás e ela reapareceria
-- colada no próximo produto que recebesse o mesmo id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tabela_fixa_id_prod_fkey'
  ) THEN
    ALTER TABLE tabela_fixa
      ADD CONSTRAINT tabela_fixa_id_prod_fkey
      FOREIGN KEY (id_prod) REFERENCES produtos(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Busca por código acontece nos relatórios e na conferência de preço.
CREATE INDEX IF NOT EXISTS tabela_fixa_cod_prod_idx ON tabela_fixa (cod_prod);

-- ---------------------------------------------------------------------
-- 2) Carga inicial
--
-- Peça sem linha na tabela fixa não tem preço praticado, e Orçamentos
-- recusa vendê-la. Esta carga parte do preço calculado atual para que
-- nenhum produto já cadastrado fique de fora no dia da virada.
-- ON CONFLICT DO NOTHING: rodar de novo não sobrescreve preço já ajustado.
-- ---------------------------------------------------------------------
INSERT INTO tabela_fixa (id_prod, cod_prod, vlr_prod)
SELECT p.id, p.codigo, COALESCE(p.preco_venda, 0)
FROM produtos p
ON CONFLICT (id_prod) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3) Permissões (perm_prod)
--
-- As duas ações são críticas e por isso nascem FALSE: ver o preço
-- praticado e, principalmente, reprecificar orçamentos em aberto não são
-- coisas que qualquer perfil deva poder fazer por acidente.
-- ---------------------------------------------------------------------
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_tabela_view BOOLEAN NOT NULL DEFAULT FALSE;    -- prod.tabela.view · Ver preço de tabela
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_tabela_update BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.tabela.update · Atualizar tabela fixa
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_prod_preco_tabela BOOLEAN NOT NULL DEFAULT FALSE; -- col_prod_preco_tabela · Preço Tabela

-- Sup Admin enxerga e opera tudo: sem isto, quem administra o sistema
-- abriria Produtos sem o botão que acabou de ser criado.
UPDATE perm_prod
SET acao_tabela_view = TRUE,
    acao_tabela_update = TRUE,
    col_prod_preco_tabela = TRUE
WHERE modelo_id IN (
  SELECT id FROM modelos_permissoes
  WHERE LOWER(TRIM(nome)) IN ('sup admin', 'supadmin', 'super admin', 'administrador')
);

COMMIT;
