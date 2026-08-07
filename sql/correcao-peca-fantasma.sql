-- ---------------------------------------------------------------------------
-- Reparo: peça liberada ao estoque que continuou contada dentro do pedido
--
-- Origem do problema (corrigido no código a partir de agora): quando a
-- substituição levava a ÚLTIMA unidade de uma linha de `pedido_itens_ext`, o
-- sistema tentava gravar `quantidade = 0`. A constraint recusa — e com razão,
-- linha de peça com zero unidades não é registro, é lixo. O erro virava aviso,
-- o fluxo continuava, e a peça terminava em DOIS lugares: somada de volta ao
-- lote e ainda dentro do pedido de destino.
--
-- Este arquivo NÃO altera nada sozinho. Ele diagnostica; o reparo está no fim,
-- comentado, para ser aplicado linha a linha depois de conferir.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. Suspeitas: substituições que liberaram peça mas cuja linha ficou de pé
--
-- Toda realocação com `movimento_id_peca_liberada` preenchido devolveu uma peça
-- ao lote. A linha de `pedido_itens_ext` correspondente TINHA de ter encolhido
-- na mesma quantidade — ou desaparecido, se ficasse zerada.
--
-- `sobra_esperada` é o que a linha deveria ter hoje. Onde ela dá 0 e a linha
-- ainda existe, a peça está duplicada.
-- ===========================================================================
SELECT r.id                        AS realocacao_id,
       r.pedido_id_origem,
       r.pedido_id_destino,
       r.quantidade                AS unidades_substituidas,
       r.tipo_destino_substituido,
       r.pedido_itens_ext_id_substituido AS linha_ext,
       e.quantidade                AS quantidade_hoje,
       (e.quantidade - r.quantidade) AS sobra_esperada,
       r.movimento_id_peca_liberada,
       r.created_at
  FROM realocacoes r
  JOIN pedido_itens_ext e ON e.id = r.pedido_itens_ext_id_substituido
 WHERE r.movimento_id_peca_liberada IS NOT NULL
   AND r.pedido_itens_ext_id_substituido IS NOT NULL
 ORDER BY r.id;


-- ===========================================================================
-- 2. Confirmação pelo total do pedido
--
-- A prova independente: quantas peças o pedido de destino tem hoje, contra
-- quantas ele deveria ter. Substituição NÃO muda o total — uma entra, uma sai.
--
-- Compare `pecas_do_estoque + a_produzir_do_zero` com a quantidade do item.
-- ===========================================================================
SELECT pi.pedido_id,
       p.numero,
       pi.id                                   AS pedido_item_id,
       pi.quantidade                           AS quantidade_do_item,
       COALESCE(SUM(e.quantidade), 0)          AS pecas_do_estoque,
       pi.qtd_a_produzir,
       pi.qtd_usar_pronta,
       (COALESCE(SUM(e.quantidade), 0) + pi.qtd_a_produzir - COALESCE(SUM(
          CASE WHEN e.ultimo_insumo_id IS NOT NULL THEN 0 ELSE 0 END), 0))
                                               AS soma_conferencia
  FROM pedidos_itens pi
  JOIN pedidos p ON p.id = pi.pedido_id
  LEFT JOIN pedido_itens_ext e ON e.pedido_item_id = pi.id
 WHERE pi.pedido_id IN (
        SELECT DISTINCT pedido_id_destino FROM realocacoes WHERE pedido_id_destino IS NOT NULL
      )
 GROUP BY pi.pedido_id, p.numero, pi.id, pi.quantidade, pi.qtd_a_produzir, pi.qtd_usar_pronta
 ORDER BY p.numero, pi.id;


-- ===========================================================================
-- 3. O reparo — descomente APENAS as linhas que a consulta 1 apontou
--
-- Regra, a mesma que o código passou a seguir:
--   sobra_esperada  > 0  -> UPDATE para a sobra
--   sobra_esperada  = 0  -> DELETE da linha
--   sobra_esperada  < 0  -> NÃO mexa: significa que a linha já foi reduzida
--                           (ou reduzida demais) e o caso pede conferência.
--
-- Exemplo do caso relatado — linha 58, do PED25, com 1 unidade substituída
-- por inteiro:
--
--   DELETE FROM pedido_itens_ext WHERE id = 58;
--
-- E, quando sobrar quantidade:
--
--   UPDATE pedido_itens_ext SET quantidade = <sobra_esperada> WHERE id = <linha_ext>;
--
-- Rode a consulta 1 de novo depois: nenhuma linha deve restar com
-- `sobra_esperada = 0`.
-- ===========================================================================


-- ===========================================================================
-- O QUE ESTE ARQUIVO **NÃO** FAZ
--
-- Não mexe em lote, movimento nem realocação. Os movimentos 617/618 do caso
-- relatado estão CERTOS: a peça foi mesmo liberada ao lote e a nova foi mesmo
-- recebida. O que estava errado era só a linha que deveria ter saído e ficou.
-- Apagar movimento seria apagar história verdadeira.
--
-- Também não desfaz o cancelamento do PED26. Ele foi marcado como cancelado
-- por um caminho que hoje é bloqueado (o estorno interrompido devolve 409 e o
-- pedido continua ativo). Reabrir um pedido cancelado é decisão de operação,
-- não de reparo de dado — se for o caso, mude a situação pela tela.
-- ===========================================================================
