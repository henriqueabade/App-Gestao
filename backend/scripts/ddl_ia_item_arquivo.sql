-- De qual ARQUIVO cada item extraído veio.
--
-- Sem esta coluna não existe extração por arquivo: a extração junta o texto de
-- todos os documentos da leitura num prompt só, e os itens voltam sem dizer de
-- onde saíram. Refazer a leitura de um documento obrigava a apagar os itens de
-- TODOS — inclusive os que já tinham sido conferidos à mão.
--
-- Aceita NULO de propósito. As linhas que já existem foram extraídas antes de
-- haver rastreio, e NULO diz exatamente isso: "veio da leitura inteira, não se
-- sabe de qual arquivo". A extração seletiva não as toca (não há como saber se
-- são do arquivo escolhido); a extração da leitura inteira as substitui, como
-- sempre fez — e a partir daí toda linha nasce carimbada.
--
-- ON DELETE SET NULL: apagar um arquivo não pode levar junto os itens que ele
-- gerou. Eles podem já ter virado cadastro, e a procedência de um saldo que
-- existe não se apaga por causa de uma faxina de anexos.

ALTER TABLE ia_extracao_itens
  ADD COLUMN IF NOT EXISTS arquivo_id integer;

ALTER TABLE ia_extracao_itens
  DROP CONSTRAINT IF EXISTS ia_extracao_itens_arquivo_id_fkey;

ALTER TABLE ia_extracao_itens
  ADD CONSTRAINT ia_extracao_itens_arquivo_id_fkey
  FOREIGN KEY (arquivo_id)
  REFERENCES ia_extracao_arquivos (id)
  ON DELETE SET NULL;

-- A pergunta que a extração seletiva faz o tempo todo é "quais itens são deste
-- arquivo?". Sem índice, cada extração varre a tabela inteira.
CREATE INDEX IF NOT EXISTS ia_extracao_itens_arquivo_id_idx
  ON ia_extracao_itens (arquivo_id);
