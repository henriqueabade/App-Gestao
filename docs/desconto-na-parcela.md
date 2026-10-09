# Desconto na parcela

Pedido do dono em 09/10/2026: o ajuste antigo de parcela volta como um botão
**"Desconto na parcela"** nos **Detalhes da parcela** (Financeiro).

## O caso

Pedido já faturado (Enviado ou Entregue), parcela ainda em aberto e sem
boleto, e a empresa dá um desconto ao cliente. Antes de 09/10 não havia tela
para isso: o "Pagamento do pedido" só mexe em pedido em Produção, e o "Gerar
boletos com data/valor" só depois de um boleto cancelado.

## O que o desconto faz

- **Muda o valor da parcela** (`pedido_parcelas.valor`): R$ 1.000,00 com
  R$ 50,00 de desconto vira R$ 950,00. Vale em todo lugar: Contas a receber,
  previsão, comissão e o recebimento sugerido.
- **O total do pedido** passa a ser a soma das parcelas, e a diferença para os
  itens vira o "Desconto" do pedido (a mesma conta do Gerar boletos:
  `valor_final`, `ajuste_valor`, `ajuste_motivo`).
- **O histórico do pedido** (`ajuste_historico`) guarda quem, quando, de
  quanto para quanto e o motivo, com `origem: 'desconto_parcela'`.
- **O histórico do Financeiro** ganha o evento "Desconto na parcela", que
  aparece na aba Histórico da parcela.
- **Justificativa obrigatória**, de ao menos 10 letras, como no Pagamento do
  pedido.

### Por que não o ajuste antigo

O ajuste antigo (`ajustes_financeiros`, `backend/financeiro/ajustes.js`)
reduz só a **base da comissão**. Desde 06/10/2026 a parcela recebida vale o
que entrou. Assim, com o ajuste antigo, o cliente pagando o valor com
desconto contava o desconto **duas vezes**: R$ 1.000,00 − R$ 50,00 de
desconto, pagos R$ 950,00, davam comissão sobre R$ 900,00. O ajuste antigo
continua por dentro: a devolução usa, e os já lançados continuam na aba
Ajustes, com o Cancelar.

## Quando o botão acende

Só na parcela **em aberto e livre**. A parcela travada não aceita o desconto
aqui, e o clique no botão apagado diz o caminho certo:

| A parcela tem | O caminho |
| --- | --- |
| boleto do BB | o abatimento no próprio boleto (Detalhes do boleto) |
| boleto de fora | o desconto nesse boleto, no banco que o emitiu |
| pagamento registrado | a Devolução do pedido |
| ordem de pagamento aberta | cancelar a ordem antes |
| cancelada | nada a fazer |

As travas são as do "Pagamento do pedido" (`pedidoParcelas.travasDasParcelas`).

## Onde está

- Backend: `backend/financeiro/descontoParcela.js` (`aplicar`), na rota
  `POST /api/financeiro/parcelas/:pedidoId/:numero/desconto`
  `{ valor, justificativa }`, com a permissão `financeiro.ajuste.registrar`.
- Os Detalhes da parcela devolvem `desconto_na_parcela: { pode, motivo }`
  (`detalhes.descontoNaParcela`).
- Tela: o botão `finParcelaDesconto` em
  `modals/financeiro/detalhes-parcela.html`. A caixa é
  `pedirDescontoNaParcela`, em `financeiro-modais.js`, e mostra o antes e o
  depois da parcela, da comissão e do total do pedido. Se a API recusar, a
  caixa fica aberta com o recado.
- Sem SQL novo.

## Testes

- `backend/financeiroDescontoParcela.test.js` cobre:
  - a parcela livre;
  - o segundo desconto sobre um Adicional;
  - as quatro travas e o boleto cancelado que não trava;
  - a validação;
  - o botão;
  - a comissão sem contar duas vezes.
- `src/js/__tests__/descontoParcela.test.js` cobre o botão, a caixa e a rota.
