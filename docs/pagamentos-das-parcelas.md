# Pagamentos das parcelas e vencimento em dia não útil

Entrega de 24/09/2026, com as decisões do dono (1a ok, 1b, 1c e 2a
recomendados, 1d = comissão e relatórios do Financeiro).

## Pagamento sem boleto (Pix, cartão, transferência…)

O cliente pode pagar uma parcela por outro meio, sem boleto nenhum — ou mesmo
tendo boleto. **Pedidos › Visualizar › "Pagamentos"** abre o modal
**"Pagamentos das parcelas"**:

- o topo mostra **Recebido**, **Em aberto** e **Atrasadas**;
- a tabela mostra cada parcela: vencimento (e, se ele cai em fim de semana ou
  feriado, "sem encargos até…"), valor, **situação** e a coluna **Ações**;
- **Registrar** (ícone verde) abre o formulário da parcela: **pago em**, **como
  foi pago**, **valor recebido** (vem com o valor da parcela) e observação;
- **Estornar** (ícone vermelho) pede o motivo; a parcela volta a ficar em
  aberto.

| Situação | Quando |
|---|---|
| Pago em dd/mm · forma | há pagamento registrado (à mão, quitação por fora ou boleto pago) |
| Boleto pago no banco / Quitado por fora | o banco já pagou, falta a conciliação lançar |
| Atrasada · N dias | passou do último dia sem encargos (ver abaixo) |
| Em aberto | o resto, dizendo como a parcela é cobrada (boleto do BB, de fora ou nenhum) |
| Cancelada | nada a receber |

O botão aparece em todo pedido com parcelas; no pedido cancelado, só se há
pagamento registrado (para estornar). O pagamento à mão aparece também na
coluna **BOLETO** das parcelas do Visualizar ("pago · Pix · 21/09/2026") e na
etiqueta **"Pagas à mão N/M"** do rodapé.

### Parcela com boleto do BB em aberto (1b)

O webhook só age quando o cliente paga **o boleto**. Se ele pagou por Pix a
parcela que tem boleto em aberto, o boleto continua vivo no banco e poderia
ser pago de novo ou ir a protesto. Por isso, ao registrar, uma caixa pergunta
se o boleto pode ser **baixado no BB como "quitado por fora"**; confirmado, o
app baixa e registra o pagamento de uma vez. Isso pede também a permissão de
baixar boletos. Boleto já pago no banco não se registra aqui: chega pelo aviso
do BB ou pela conciliação.

O boleto **de fora** não é baixado (é de outro banco): fica só como registro.

### Multa e juros sugeridos (1c)

O formulário diz, para a data escolhida, se o pagamento foi em dia ou com
quantos dias de atraso, e calcula **multa + juros pelas regras dos boletos**
(configuração de cobrança: 2% de multa, 9% ao mês de juros por dia, desde o
vencimento). O botão **"Somar encargos"** põe o total no valor recebido. É uma
sugestão: vale o que você confirmar.

### Comissão e royalty (1d)

O pagamento registrado é um **recebimento** como o do boleto: entra na
comissão e no royalty do **mês em que o cliente pagou**, com a base de sempre
(valor da parcela − abatimento − ajustes; multa e juros **não** entram).
Estornar depois do fechamento vira **ajuste** no próximo fechamento.

Pedido ainda **em produção**, sem nota e sem boleto, antes não entrava nas
contas a receber — o pagamento não contaria. Agora **ter pagamento registrado
também fatura o pedido** (`contasReceber.js`).

## Vencimento em dia não útil (2)

- O vencimento do papel **não muda**: a parcela que vence no domingo 20/09
  continua vencendo em 20/09.
- Pago até o **próximo dia útil** (segunda, 21/09): **em dia**, sem multa nem
  juros.
- Depois disso, o **atraso conta desde o vencimento do papel**: pago em 23/09,
  são 3 dias desde 20/09.

Dia útil (2a): sábado e domingo nunca; nem os **feriados nacionais**; nem os
**cadastrados no Financeiro** (o mesmo calendário do 5º dia útil da produção).
O status "vencido" do boleto usa só os nacionais — é o calendário do banco.

Vale para: as contas a receber e o aviso do painel, as atrasadas da comissão,
o status do boleto no app e os encargos sugeridos no modal de pagamentos. No
boleto do BB nada muda no registro: o próprio banco já segue essa regra.

## A tabela dos boletos de fora

Na mesma entrega, o modal "NF-e e boletos de fora" ganhou a coluna Ações
(copiar, trocar e remover) e ficou mais largo, sem rolagem de lado — ver
`docs/nfe-e-boletos-de-fora.md`.

## Banco

Nenhum SQL novo: usa `recebimentos` (sql/cobranca_recebimentos.sql) e, para
os feriados cadastrados, `financeiro_feriados` (sem ela, só os nacionais).

## Código e testes

| Onde | O quê |
|---|---|
| `backend/cobranca/vencimento.js` | limite sem encargos, dias de atraso, multa e juros (puro) |
| `backend/cobranca/contasReceber.js` | atraso pelo limite; pagamento fatura; `lerFeriados` |
| `backend/cobranca/boletoOperacoes.js`, `conciliacao.js` | "vencido" só depois do limite |
| `backend/cobranca/pagamentosDoPedido.js` | a leitura do modal e os encargos |
| `backend/cobrancaController.js` | `GET /pedidos/:id/pagamentos` e `/pagamentos/encargos`; o estado dos boletos leva o recebimento de cada parcela |
| `src/html/modals/pedidos/pagamentos-parcelas.html` + `src/js/modals/pedido-pagamentos-parcelas.js` | o modal |
| `src/js/modals/pedido-visualizar.js` | botão, coluna e etiqueta |

Gravar e estornar usam as rotas que já existiam:
`POST /api/cobranca/recebimentos` (com `baixar_boleto`) e
`POST /api/cobranca/recebimentos/:id/estornar`.

Testes: `vencimento.test.js`, `pagamentosDoPedido.test.js`,
`contasReceber.test.js`, `boletoOperacoes.test.js`, `cobrancaController.test.js`
e, na tela, `pagamentosParcelas.test.js` e `pedidoDadosExternos.test.js`.
