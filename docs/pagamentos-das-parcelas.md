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

## Comissões do mês: previstas, atrasadas e "Previsto no mês" (24/09/2026, 2ª rodada)

Decisões do dono (2a recomendado, 2b, 2c ok, 2d recomendado, 2e sim). Para o
mês escolhido no Financeiro (`comissoes.visaoDoMes`):

- **Previstas:** vencem no mês e ainda não estão pagas nem atrasadas.
- **Atrasadas:** venceram **até** o mês (passado o último dia sem encargos) e
  não estão pagas. **Passam para os meses seguintes** até alguém registrar o
  pagamento — pelo boleto ou pelo modal "Pagamentos". Pago, sai das atrasadas
  e vira **apurada** no mês em que o cliente pagou.
- **Mês passado** mostra a **foto do fim dele**: o que estava atrasado em
  31/08 aparece em agosto, mesmo que tenha sido pago em setembro. O mês
  corrente e os futuros usam hoje.
- **"Previsto no mês"** (linha nova do card) = previstas + atrasadas: a
  comissão que o mês ainda espera.
- O corte "parcelas controladas a partir de…" continua valendo: o que venceu
  antes dele fica fora de previstas e atrasadas.

Antes, "Atrasadas" era a posição de hoje em qualquer mês — agosto mostrava a
parcela de setembro — e a previsão do mês não mostrava a atrasada.

Onde vale: o card "Resumo de Comissões", o cartão "Comissões atrasadas" do
topo, o relatório **"Previsão de comissões"** (lista previstas e atrasadas,
com a coluna **Situação**: "Prevista" ou "Atrasada · N dias"), o relatório
"Comissões atrasadas" e o modal das atrasadas (`GET
/api/financeiro/parcelas?visao=atrasadas&competencia=`), que diz de que mês é e
de quando é a foto. Por período, os relatórios continuam na posição de hoje.
A pendência "parcelas vencidas há mais de 30 dias" continua sendo de hoje.

## Parcela paga não recebe boleto; editar o pagamento (24/09/2026, 3ª rodada)

- **Parcela com pagamento registrado** (Pix, cartão, transferência, boleto
  pago, quitação por fora) **não recebe boleto** até o pagamento ser estornado
  em "Pagamentos":
  - **Gerar boletos**: a linha aparece "Paga · Pix" e não se marca; sem
    escolha ("todas"), a paga fica de fora; escolhida, responde o motivo
    (`boletos.registrar` + `pagamentoDaParcela`);
  - **Importar do BB**: não é sugerida, aparece "(paga)" e não se escolhe, e o
    importar recusa ("importe sem relacionar ou estorne");
  - **Boletos de fora / colar a linha**: no lugar do campo, a tag "Paga ·
    Pix · data" e o aviso; o backend recusa com o mesmo texto;
  - **Mudar de parcela**: a paga não aparece como destino.
- **Editar o pagamento lançado à mão** (ícone ✏️ em "Pagamentos"): data,
  valor, forma e observação, no mesmo formulário (`PUT
  /api/cobranca/recebimentos/:id`, permissão de registrar). O que veio do
  banco não se edita. A comissão usa o valor da PARCELA — mudar o valor
  recebido não mexe nela; mudar a data para outro mês muda a competência, e
  isso é recusado se o pagamento já entrou numa comissão fechada.
- **Visualizar › Parcelas**: coluna **VENCIMENTO** (a data prevista de cada
  parcela); a de parcela virou **"PRC."**, com 4 caracteres.

## Boleto na parcela errada

O boleto do BB importado (colado aqui ou trazido pelo "Importar do BB") pode
mudar de parcela no "NF-e e boletos de fora", levando o pagamento junto — ver
`docs/importar-boletos-do-bb.md`.

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
