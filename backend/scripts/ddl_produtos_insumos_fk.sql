-- Ajusta FK produtos_insumos_produto_codigo_fkey para atualização em cascata

ALTER TABLE produtos_insumos
  DROP CONSTRAINT IF EXISTS produtos_insumos_produto_codigo_fkey;

ALTER TABLE produtos_insumos
  ADD CONSTRAINT produtos_insumos_produto_codigo_fkey
  FOREIGN KEY (produto_codigo)
  REFERENCES produtos (codigo)
  ON UPDATE CASCADE;
