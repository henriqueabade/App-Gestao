# Fechamento da produção e comissões por quem recebe

Continuação da entrega de 17/09/2026 (ver
[desenhistas-producao-parcela.md](desenhistas-producao-parcela.md)). O banco
muda por **`sql/fechamento_producao_e_pagamentos.sql`** (o dono roda e
reinicia a API). Sem o SQL, as telas dizem qual arquivo rodar e nada é
gravado pela metade.

Duas mudanças grandes:

1. **A produção entra sozinha e é confirmada no fechamento**, peça a peça.
2. **As comissões mostram e pagam por quem recebe** (CMS do dono do cliente e
   Royalty do desenhista), com cor e legenda em todas as telas.

---

## 1. Produção: pendente desde o orçamento confirmado

Antes, a produção só existia se alguém usasse "Registrar produção". Agora:

- O pedido que vai para produção (orçamento confirmado) **já carrega o que há
  para produzir**: cada peça, em cada processo que ela usa, com o valor da
  regra. A peça que saiu do estoque adiantada deve só o que faltava — a fila
  de `backend/financeiro/producaoUnidades.js` continua valendo.
- Isso fica **pendente** até alguém dizer o que ficou pronto. Nada é pago sem
  decisão, e nenhuma competência fecha com pedido sem decisão.

### A tela nova: "Fechar competência — produção"

No módulo Financeiro há dois botões:

| Botão | O que faz |
|---|---|
| **Fechar competência — comissões** | o modal de sempre, agora só de comissões (sem escolher o tipo) |
| **Fechar competência — produção** | a tela nova, com um **card por pedido** |

Na tela nova (`src/html/modals/financeiro/fechar-producao.html`):

- Um card por pedido pendente, com cliente, situação, o que está pendente em
  reais e o que já foi decidido no mês.
- Cada **peça** abre para baixo. Em cada **processo** o usuário informa
  **quantas unidades ficaram prontas** (botões "Tudo" e "Nada", ou o número).
  O que sobra fica **pendente e vai para o mês seguinte**.
- **Todas as unidades precisam de decisão** — inclusive "nada pronto", que é
  decisão e fica gravada com zero. Enquanto faltar alguma, o fechamento é
  bloqueado com o aviso "Falta confirmar a produção de N pedidos: …".
- **"Confirmar peça"** grava e fecha a expansão; dá para reabrir e mudar
  enquanto a competência não for fechada (o registro anterior é estornado e
  refeito). "Tudo pronto neste pedido" resolve o pedido inteiro.
- O rodapé fecha a competência como antes (prévia, bloqueios, avisos e
  resumo por processo).

### Quando o sistema confirma sozinho

| Situação | O que acontece |
|---|---|
| **Envio ao cliente** (Enviado/Entregue) | tudo o que estava pendente entra como **pronto**, na competência do envio. Começou em setembro só com a marcenaria pronta e foi enviado em outubro? O que sobrou é confirmado em **outubro** e pago no fechamento de outubro. |
| **Devolução** | **nada muda na produção** — as peças voltam ao estoque como estavam. |
| **Cancelamento** | paga **só o trecho que a peça andou**: o ponto em que ela parou menos o ponto em que ela entrou no pedido (é o que o cancelamento grava em `cancelamento_destinacoes`). O resto da pendência some com o pedido. |
| **"Registrar produção"** | continua existindo, para acertos fora do fechamento. |

### A conta do cancelamento

Cada passo da rota vale o mesmo dentro do seu processo. Saiu em 8/12 e voltou:

| Volta em | Andou | Paga |
|---|---|---|
| 8/12 | nada | nada |
| 9/12 | 1 passo | 1 ÷ (passos daquele processo) do valor da peça |
| pronta (12/12) | 4 passos | os 4, cada um na sua parte |

- O que **já tinha sido registrado** naquele processo é abatido: não se paga
  duas vezes o mesmo trecho (rodar de novo não repete nada).
- Peça que vai para **outro pedido** não paga duas vezes: ela entra lá pelo
  `pedido_itens_ext`, no ponto em que chegou, e a fila do destino já nasce
  descontada — o destino deve só o que ainda falta. É o "apaga a de 7/12 e
  conta uma nova de 5/12".
- A fração paga fica em `producao_eventos.fracao_paga`; sem essa coluna o
  lançamento é desfeito e a tela avisa qual SQL rodar.
- Código: `backend/financeiro/producaoConfirmacao.js`
  (`avancoNoProcesso`, `fracaoJaPaga`, `confirmarCancelamento`), testes em
  `backend/financeiro/producaoCancelamento.test.js`.

### O que o banco ganhou

| Tabela / coluna | Para quê |
|---|---|
| `producao_confirmacoes` | a decisão de cada competência: competência, pedido, peça, processo, quantas prontas, quantas pendentes, origem (fechamento, envio, cancelamento, manual) e o evento que gerou. Único por (competência, peça, processo). |
| `producao_eventos.fracao_paga` | a fração paga de um registro (só o cancelamento usa). |

---

## 2. Comissões por quem recebe

Toda comissão tem dono: **CMS** é do dono do cliente, **Royalty** é do
desenhista da peça. Agora isso aparece e paga separado.

- Cada pessoa tem uma **cor estável** (a mesma em todas as telas), tirada do
  próprio nome: `src/js/utils/beneficiarios.js` (carregado por `menu.html`).
  O tipo vira etiqueta: **CMS** preenchida, **Royalty** vazada. Onde há
  etiqueta, há **legenda** ("CMS: dono do cliente", "Royalty: desenhista da peça").

### Onde aparece

| Tela | O que tem |
|---|---|
| Card **Resumo de Comissões** (módulo) | bloco "Quem recebe": uma linha por pessoa, com CMS/Royalty e o valor (o apurado do mês; sem apuração, a previsão) |
| **Comissões atrasadas** | coluna "Quem recebe", filtro por tipo/pessoa e legenda |
| **Fechar competência — comissões** | a tabela "Por beneficiário" com cor e etiqueta |
| **Detalhes da parcela** e **Detalhes do pedido** | a mesma tabela/coluna, com legenda |
| **Relatórios** (previsão, atrasadas, apuradas, ajustes) | coluna "Quem recebe" + filtro; o PDF e a planilha saem com o texto |

**O filtro muda os valores**: escolhendo "Royalty" ou uma pessoa, as linhas
que não têm parte dela somem e o que sobra passa a ser **a parte dela** — o
total do relatório bate com o filtro. É o mesmo filtro no que é exportado.

### Pagar tudo ou por beneficiário

No **Confirmar pagamento** (comissões):

- "Pagar tudo o que falta" (padrão) paga o saldo da competência de uma vez.
- Desmarcando, aparece a lista: uma linha por **CMS/Royalty de cada pessoa**,
  com o valor e "pago em …" para quem já recebeu. Marque uma, várias ou
  todas — cada uma vira um pagamento próprio, registrado com o nome.
- O que sobra continua a pagar: a competência fica **"paga em parte"** no
  painel até o saldo zerar, e o botão só some quando não falta mais nada.
- Regras do backend (`backend/financeiro/fechamentos.js`): o mesmo alvo não é
  pago duas vezes, a soma nunca passa do total da competência, e o valor de
  cada pessoa sai do resumo **congelado no fechamento**.

### O que o banco ganhou

| Coluna | Para quê |
|---|---|
| `financeiro_pagamentos.beneficiario` | o nome de quem recebeu (vazio = a competência inteira) |
| `financeiro_pagamentos.tipo_comissao` | `cms`, `royalty` ou vazio |
| índice `financeiro_pagamentos_por_beneficiario` | um pagamento por (fechamento, beneficiário, tipo) — o antigo "um por fechamento" foi derrubado |

---

## Depois de puxar o código

1. Rodar **`sql/fechamento_producao_e_pagamentos.sql`** no banco.
2. Reiniciar a API.
3. Conferir: Financeiro → "Fechar competência — produção" (os cards), o card
   "Resumo de Comissões" (bloco "Quem recebe") e o "Confirmar pagamento".

Sem o passo 1 as telas mostram o aviso com o nome do arquivo e nada é gravado.
