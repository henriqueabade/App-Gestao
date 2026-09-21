# Devolução de pedidos (parcial e total)

Pedido **enviado** ou **entregue** não se cancela: devolve-se. Os botões do
rodapé do Visualizar seguem a situação (regra do dono, 21/09/2026 —
`botoesDoPedido` em `src/js/modals/pedido-visualizar.js`):

| Situação | Botões |
|---|---|
| Produção | Cancelar e **Enviar** (verde: a conferência da NF-e, o mesmo do "Concluir" da tabela) |
| Produção com NF-e autorizada | só Enviar (o pedido não se cancela com nota viva; cancelada a nota na SEFAZ, o Cancelar volta) |
| Enviado, Entregue | só **Devolução** |
| Parcial | só Devolução, das peças que ainda não voltaram (o modal já limita) |
| Devolvido (total), Cancelado | nenhum |

Botões da NF-e e dos boletos só aparecem quando o pedido tem de fato a nota ou
o boleto; "Gerar boletos" só depois que o pedido saiu e só em pedido pago com
boleto. A tabela de itens não tem mais a coluna de ações, e a etiqueta roxa
"N dev." vai na frente do nome do item. A trava também está no backend
(`PUT /api/pedidos/:id/status` responde 409 `USE_DEVOLUCAO`): pedido que já
teve devolução jamais passa pelo estorno do cancelamento, que devolveria ao
estoque peças que já voltaram.

## Decisões do dono (17/09/2026)

1. A situação do pedido **não muda** (continua Enviado/Entregue por baixo). A
   devolução mora em colunas próprias e a etiqueta roxa — **Parcial** ou
   **Devolvido** — vence a situação na lista, no filtro, no Visualizar, nos
   Relatórios e no Dashboard. Motivo: uns vinte pontos (contas a receber,
   comissões, produção, fiscal) tratam Enviado/Entregue como "faturado".
2. O dinheiro que volta para o cliente é um **reembolso**: nasce pendente,
   aparece no Financeiro ("Reembolso a pagar") e é confirmado quando pago. O
   app não paga nada.
3. O **XML da nota de devolução do cliente** preenche as quantidades e fica
   guardado, ligado ao pedido (etiqueta roxa "NF dev.").
4. Cliente que não emite nota (pessoa física): a NF-e de **entrada** de
   devolução, emitida pela empresa, **fica para depois**. Por ora esses casos
   entram pelo modal, sem XML.
5. Não há "peça avariada que não volta ao estoque": tudo o que é devolvido
   entra no estoque.
6. Parcial maior que o que está em aberto: **zera as parcelas em aberto e
   reembolsa a diferença**.
7. "Pago" é o que está pago **no momento do registro**.

## Parcela mínima (17/09/2026)

A devolução é o único lugar em que a parcela mínima **reajusta** sozinha (em
orçamento e pedido ela só bloqueia — ver `docs/desenhistas-producao-parcela.md`).
Se o desconto proporcional deixa alguma parcela em aberto abaixo do mínimo, as
parcelas em aberto são **juntadas nas primeiras**, na ordem, em partes iguais:
cabem tantas quanto o total comportar (ao menos uma). Ex.: 5 × R$ 100 viram
1 × R$ 500 no primeiro vencimento; 30/60/90 vira 30/60. A 1ª parcela com
prazo 0 (entrada à vista) fica de fora da junção. A parcela que **cresce** e
tinha boleto a pagar ganha **baixa + reemissão** na mesma data (modo
`reemissao_boleto`); se o boleto já tinha vencido, o novo vence hoje.

## As contas (`backend/devolucoes/calculo.js`, puro)

- **Valor devolvido (D)**: quantidade × o que o cliente pagou pela peça (total
  da linha ÷ quantidade — já líquido dos descontos; os percentuais negociados
  não mudam). A linha que fecha leva os centavos que sobraram.
- **Total** quando, com esta devolução, todas as peças do pedido voltaram;
  senão **parcial**. Pode haver várias parciais.

| Caso | O que acontece |
|---|---|
| Total | parcelas em aberto canceladas (boleto baixado no BB) e reembolso de tudo o que foi pago |
| Parcial, D ≤ em aberto | D vira desconto em **todas** as parcelas em aberto, na proporção do saldo de cada uma (centavos na última). Sem reembolso |
| Parcial, D > em aberto | parcelas em aberto zeradas e reembolso de D − em aberto, repartido entre as pagas |

Os **prazos nunca mudam**. O reembolso é do principal (juros e multa ficam de
fora). Pedido: `valor_final` = o que restou (parcial) ou o valor da venda
(total, como o cancelado mostra); `valor_original` guarda a venda e
`valor_devolvido` o acumulado.

Como cada parcela é tratada (`devolucao_parcelas.modo`):

- `valor_parcela` — em aberto, sem boleto a pagar: `pedido_parcelas.valor`
  baixa (o original fica em `valor_original`);
- `abatimento_boleto` — em aberto, com boleto: abatimento no BB (o boleto passa
  a cobrar o valor novo; o valor da parcela não muda, como em toda a cobrança);
- `baixa_boleto` / `cancelada` — parcela zerada: boleto baixado como cancelado e
  `valor` = 0 (Contas a receber trata parcela de valor zero como cancelada);
- `reembolso` — parcela paga: a parte devolvida. Gera o ajuste "Devolução" da
  fase G na parcela, e a comissão já fechada é estornada na competência seguinte.

## O registro (`backend/devolucoes/registro.js`)

Sem transação entre as requisições, vale a política do cancelamento: conferir
tudo antes (o plano recusa sem gravar) e gravar numa ordem em que a falha no
meio seja legível: cabeçalho (`processando`; a sequência única por pedido
impede dois registros ao mesmo tempo, e a `chave_idempotencia` o clique
repetido) → nota do cliente → peças (estoque, `devolucao_itens`,
`quantidade_devolvida`) → pedido → parcelas (BB) → reembolso e ajustes de
comissão → históricos → `concluida` ou `pendencias`.

O que falhar (estoque, BB fora do ar) fica marcado na própria linha, aparece
no resultado, vira pendência no Financeiro e **"Tentar de novo"** refaz só o
que faltou — consultando o BB antes, para não aplicar abatimento em dobro.

Estoque: a peça volta como **peça pronta** (lote do fim da rota do produto),
com o movimento `retorno_devolucao` ("Devolvida pelo cliente") no razão e o
evento `devolucao` no histórico do pedido. Sem o SQL, os dois caem nos tipos
antigos (`retorno_cancelamento`, `edicao`).

## XML do cliente (`backend/devolucoes/xmlDevolucao.js`)

Lido por expressão regular (o app não tem biblioteca de XML; DOCTYPE/ENTITY
são recusados). Bloqueia nota que não é modelo 55, sem itens ou emitida para
outro CNPJ; avisa (sem bloquear) finalidade ≠ 4, emitente que não é o cliente,
nota que não referencia a NF-e do pedido e XML sem protocolo. O casamento dos
itens é uma sugestão: código, nome (sem acento nem pontuação; "×" = "X"), nome
parecido e, por último, NCM + preço quando só uma peça serve. O que não casa
aparece para o usuário informar à mão. A mesma nota não entra duas vezes.

## Rotas — `/api/devolucoes` (`backend/devolucoesController.js`)

| Rota | Permissão |
|---|---|
| `GET /pedido/:id` — peças, parcelas, nota, devoluções anteriores | `ped.devolucao` |
| `POST /pedido/:id/previa` — o plano, sem gravar | `ped.devolucao` |
| `POST /pedido/:id/xml` — lê o XML e sugere as quantidades | `ped.devolucao` |
| `POST /pedido/:id` — registra | `ped.devolucao` |
| `GET /:id` · `POST /:id/reaplicar` | `ped.devolucao` |
| `GET /notas` · `GET /notas/:id/xml` | `ped.view` |
| `GET /reembolsos?status=` | `financeiro.view` |
| `POST /reembolsos/:id/confirmar` | `financeiro.reembolso.confirmar` |

## Banco — `sql/devolucoes.sql`

Enums `retorno_devolucao` e `devolucao`; colunas em `pedidos` (`devolucao`,
`valor_devolvido`, `valor_original`, `data_devolucao`), `pedidos_itens`
(`quantidade_devolvida`) e `pedido_parcelas` (`valor_original`); tabelas
`devolucoes`, `devolucao_itens`, `devolucao_parcelas`, `reembolsos` e
`notas_devolucao`; permissões `perm_ped.acao_devolucao` e
`perm_financeiro.acao_reembolso_confirmar`. Sem o SQL, as rotas respondem 409
com `sql_pendente` e o resto do app segue como era.

## Dashboard e Relatórios

- **Vendas**: a barra de ouro é a venda como aconteceu (`valor_original`, no mês
  da venda). Abaixo da linha de base penduram o **cancelado** (vermelho, no mês
  do cancelamento) e o **devolvido** (roxo, no mês da devolução).
- **Previsão de faturamento**: sob a barra verde, as parcelas de pedidos
  cancelados (vermelho) e o que a devolução tirou das parcelas (roxo), pelo
  vencimento. A verde já vem sem o que saiu.
- **KPI Vendas no mês**: nota roxa "N devoluções no mês (R$)".
- **Pedidos por situação**: fatias **Parcial** (lilás) e **Devolvido** (roxo).
- As tabelas da devolução são *extras* do painel: sem elas (SQL por rodar) o
  que foi devolvido fica em zero e nada falha.

## Para depois

- NF-e de **entrada** de devolução emitida pela empresa (finalidade 4,
  referenciando a nota original), para cliente que não emite nota.
