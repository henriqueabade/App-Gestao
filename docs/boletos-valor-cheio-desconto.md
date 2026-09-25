# Boleto com o valor cheio e desconto até o vencimento

Decisões do dono em 25/09/2026 (B1 a B5, todas "a"). O pedido continua com
desconto no sistema; o **boleto sai com o valor cheio** (sem os descontos do
pedido) e um **desconto de valor fixo que vale até o vencimento** — para
estimular o cliente a pagar em dia.

| Exemplo | Valor |
| --- | --- |
| Pedido cheio | R$ 10.000 |
| Desconto do pedido | R$ 500 |
| Pedido (o que o sistema guarda) | R$ 9.500, em 2 × R$ 4.750 |
| Cada boleto | **R$ 5.000**, com "desconto de R$ 250 até o vencimento" |
| Pagou até o vencimento | R$ 4.750 |
| Venceu | R$ 5.000 + multa (2% de 5.000) + juros por dia sobre os 5.000 |

## As regras

- **B1 — o desconto** é o que a NF-e chama de desconto: o dos itens
  (quantidade, à vista, especial) mais o ajuste **para menos** das parcelas.
  O **Adicional** entra no valor cheio. Cada parcela leva a parte proporcional
  ao valor dela; a última com valor fica com o resto dos centavos.
- **B2 — Configuração de cobrança**: pedido com desconto usa só o dele; o
  "Desconto por antecipação" da configuração continua valendo para pedido sem
  desconto (a tela da configuração diz isso).
- **B3 — boletos já registrados** ficam como estão. A regra vale para os
  gerados daqui em diante e as reemissões.
- **B4 — parcela sem boleto** (Pix, transferência, ordem de pagamento) continua
  como antes: o valor da parcela, com multa e juros sobre ele.
- **B5 — NF-e**: não muda. As duplicatas saem com o valor do pedido (com
  desconto); o que o boleto cobra a mais depois do vencimento é encargo
  financeiro, como a multa.

## Onde o valor cheio aparece

| Lugar | O que mostra |
| --- | --- |
| Registro no BB | `valorOriginal` = cheio; `desconto` tipo 1 (valor fixo até a data), com a data do vencimento; juros por dia e multa sobre o cheio |
| PDF do boleto | valor do documento = cheio; instrução "DESCONTO DE R$ X ATÉ dd/mm/aaaa" |
| Gerar boletos | na parcela sem boleto: "o boleto sai com R$ X e desconto de R$ Y até o vencimento"; no registrado: "boleto de R$ X com desconto de R$ Y até dd/mm" |
| Detalhe do boleto | a linha "Desconto até o vencimento" (em dia paga X; vencido, o cheio com multa e juros); a quitação por fora sugere o valor em dia antes de vencer |
| Financeiro › Recebimentos | "A receber" é o de **hoje**: em dia, com desconto; vencida com boleto, o cheio + multa + juros, com "em dia R$ X + desconto perdido + multa + juros" embaixo |
| Pagamentos do pedido | a mesma coisa na coluna do valor; o "em aberto" do rodapé soma o de hoje; a sugestão de multa e juros perde o desconto e conta sobre o cheio |
| Dashboard | a receber, em atraso e as faixas de vencimento somam o de hoje |

## O que NÃO muda

- **Comissão e royalty**: sempre sobre o valor do pedido (a parcela). No
  recebimento do boleto, `valor_parcela` é o cheio menos o desconto, e o que o
  cliente pagou a mais (desconto perdido + multa + juros) vai em
  `valor_encargos`.
- **`a_receber`** das contas a receber continua sendo o valor em dia: é a base
  da comissão, da devolução e da sugestão de encargos. O de hoje é
  `a_receber_hoje` (com `encargos_hoje`).
- A trava do "Alterar pagamento" aceita o valor em dia (o cheio menos o
  desconto), não o cheio.

## Acertos que vieram junto

- **Devolução**: o abatimento sai do valor em dia; o desconto continua no
  boleto (senão seria dado duas vezes).
- **Abatimento à mão**: precisa ser menor que o valor em dia.
- **Prorrogação**: a data do desconto vai para o novo vencimento (PATCH
  `indicadorAlterarDataDesconto`). Se o BB recusar, o boleto fica prorrogado,
  o desconto fica na data antiga e a tela avisa.

## Banco

`sql/boletos_desconto_condicional.sql` — `boletos.valor_desconto` e
`boletos.desconto_ate`. Depois de rodar, **reiniciar a API**. Sem ele, o
boleto de pedido com desconto **não vai ao BB**: a linha fica "erro" com o
nome do arquivo (o app confere se o banco guardou a coluna antes de
registrar), e o nosso número é reaproveitado na próxima tentativa.

## Código e testes

| Onde | O quê |
| --- | --- |
| `backend/cobranca/descontoCondicional.js` | a regra (pura): desconto do pedido, rateio por parcela, valor em dia, quanto o boleto cobra hoje |
| `backend/cobranca/boletoCalculo.js` | `encargos({ descontoFixo })`: o desconto do pedido no lugar do da configuração |
| `backend/cobranca/bbBoleto.js` | `montarRegistro({ desconto })`: valor cheio e desconto até o vencimento |
| `backend/cobranca/boletos.js` | lê os itens, grava `valor_desconto`/`desconto_ate`, confere o SQL; `parcelasComBoletos` leva `desconto_condicional` |
| `backend/cobranca/recebimentos.js` | `valoresDoBoleto`: parcela = cheio − desconto |
| `backend/cobranca/contasReceber.js` | `a_receber_hoje`, `encargos_hoje`; os totais do resumo |
| `backend/cobranca/vencimento.js` | `encargosDoAtraso({ desconto })` |
| `backend/cobranca/boletoOperacoes.js` | prorrogação leva o desconto; limite do abatimento |
| `backend/devolucoes/registro.js`, `backend/pedidoParcelas.js` | abatimento e trava pelo valor em dia |

Testes: `backend/cobranca/descontoCondicional.test.js` e
`src/js/__tests__/boletoValorCheio.test.js`.
