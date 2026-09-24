# Financeiro no Dashboard (24/09/2026)

Pedido do dono: marcadores e indicadores novos para o que o Financeiro já faz
(recebimentos, boletos, ordens de pagamento, NF-e, comissões e produção), sem
mudar o que o painel tinha; nos cartões de antes, só o que é de fato
relevante. Decisões: "tudo recomendado" (itens 1–6, 8–12 e os acréscimos a, b
e c da proposta; a faixa "Financeiro" abaixo dos gráficos e os cartões de
atenção no "Precisa de atenção" que já existia).

## Seções (`GET /api/dashboard`)

Cada uma atrás da permissão do Financeiro de onde o número vem; sem ela a
seção nem é calculada e o cartão some. As contas são as do próprio módulo
(`backend/dashboardFinanceiro.js` recorta; nada é recalculado de outro jeito).

| Seção | Permissão | De onde vem |
| --- | --- | --- |
| `receber` | Ver recebimentos | `cobranca/contasReceber.js` sobre as tabelas lidas pelo painel (cache de 60 s) |
| `fiscal` | Ver notas fiscais | `fiscal/painel.js` + o certificado (`complemento`, lido pelo roteador fiscal) |
| `pagar` | Ver comissões e produção | `financeiro/painel.js` do mês (`carregar`, no mesmo cache de 60 s) |

Todo dinheiro sai num campo `valor` (convenção do painel: `null` = sem
permissão → a tela mostra só a contagem).

## O que aparece

**Faixa "Financeiro"** (some inteira sem nenhuma das três permissões):

- **Recebido no mês** — valor, parcelas, variação contra o mesmo trecho do mês
  passado; etiquetas de multa e juros e de estornos.
- **A receber no mês** — etiquetas: com boleto, com ordem de pagamento, sem
  cobrança.
- **Em atraso** — etiquetas: há mais de 15 dias (o BB já não aceita o
  boleto) e a mais antiga.
- **NF-e do mês** — autorizadas (nº e R$); etiquetas: recusadas, aguardando a
  SEFAZ, canceladas.
- **Comissões e produção a pagar** — o que falta pagar na competência;
  etiquetas: pagar até, pagas em parte, comissões atrasadas.
- **Contas a receber por vencimento** — barras por faixa (atraso 31+,
  16–30, 1–15; vence em 7, em 8–30, depois) e a lista das maiores em atraso.

**Precisa de atenção** (cada um só com o que resolver): NF-e com problema
(recusadas, paradas na SEFAZ, certificado), Pedidos enviados sem NF-e (desde o
1º dia do **mês passado** — o Financeiro olha só a competência escolhida),
Pagamentos a confirmar, Ordens de pagamento (próximos 7 dias e as que passaram
da data), Conciliação com o BB.

**Nos cartões de antes:**

- Gráfico de vendas e previsão: linha azul **Recebido** (o que entrou em cada
  mês, só no eixo de R$), "Recebido nos 12 meses" no resumo, a linha
  "Recebido no mês" nos balões e, no balão da previsão, "1 paga" / "1 em
  atraso" por pedido.
- **Em produção**: "R$ X já recebidos antes da nota".
- **Pedidos por situação**: "N enviados sem NF-e".

## Código e testes

| Onde | O quê |
| --- | --- |
| `backend/dashboardFinanceiro.js` | as três seções (puro) |
| `backend/dashboardController.js` | SECOES com `carregar` e `complemento`; opcional só a tabela que nenhuma seção exige |
| `backend/financeiro/painel.js` | `a_confirmar` (competências fechadas esperando o pagamento) |
| `backend/fiscalController.js` | exporta `resumoDoCertificado` |
| `src/html/dashboard.html`, `src/js/dashboard.js`, `src/css/dashboard.css` | cartões, faixa, linha do Recebido, etiquetas |

Testes: `backend/dashboardFinanceiro.test.js`, `backend/dashboardController.test.js`
(seções do Financeiro) e `src/js/__tests__/dashboardModulo.test.js`.
