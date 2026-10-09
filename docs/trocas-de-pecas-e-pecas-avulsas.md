# Troca de peças entre pedidos e peças avulsas

Pedido do dono de 09/10/2026. São duas coisas que andam juntas:

1. **Troca de peças entre pedidos.** A unidade de uma peça sai de um pedido
   no estado em que está e entra em outro. A unidade igual que estava lá vem
   no lugar, também no estado dela.
2. **Peça avulsa.** No cancelamento, a peça pode **continuar sendo
   produzida** fora de pedido. Terminada, ela entra no estoque como peça
   pronta.

Nenhuma das duas mexe na matéria-prima na hora: as peças só trocam de lugar.
Tudo vira registro novo (troca, eventos do pedido, auditoria do Financeiro),
e nada do que já foi gravado é reescrito.

## Troca de peças

### Onde fica

- **Pedidos**: o ícone de setas (⇄) na linha, depois da prancheta. Ele fica
  ativo no pedido **Aprovado** ou **em Produção**; nos outros fica riscado, e o
  clique diz por quê.
- **Fechar competência — produção**: o botão **"Substituir a peça de um
  pedido"**, no card das peças avulsas (veja abaixo).
- Permissão nova: **`ped.trocar_pecas`** ("Trocar peças entre pedidos", em
  Usuários › Permissões › Pedidos › Ações). Ela nasce **desligada**; o SQL
  liga para os modelos Sup Admin e Administrador.

### Os três passos do modal

1. **A peça que sai deste pedido.** Cada peça mostra as unidades por estado,
   por exemplo "2 · Marcenaria feita" e "1 · Por começar". O balão de cada
   estado detalha os processos. Escolha o estado da unidade que sai.
2. **A peça que vem no lugar.** Aparecem as peças **do mesmo produto** em
   outros pedidos Aprovados ou em Produção, com os estados delas. O estado
   igual ao da peça que sai fica desligado, porque trocar não mudaria nada.
3. **Confirme.** Escolha quantas (até o menor dos dois estados) e o motivo
   (ao menos 10 letras). O resumo diz o que muda em cada pedido e a caixa da
   casa pede a confirmação.

Embaixo fica o histórico: todas as trocas do pedido, com data, peça, o que
saiu, o que entrou, o outro pedido e o motivo.

### O que muda

| | Pedido que **entrega** a peça | Pedido que **recebe** |
|---|---|---|
| Produção | fica com a peça que veio; se ela está menos adiantada, **volta a dever** o que falta nela | a peça vem no estado dela; a peça **pronta não é produzida nem paga de novo**, e a parcial deve só o que falta |
| O que já foi registrado | continua valendo, com o mesmo valor | idem |
| Matéria-prima e estoque | não mudam | não mudam |

**Como a produção sabe disso:** cada troca é uma "mudança" na fila de
unidades da peça (`backend/financeiro/mudancasUnidades.js`). Um registro
feito **antes** da troca consome a fila de antes, e um feito **depois**
consome a fila nova (`alocarComMudancas` em
`backend/financeiro/producaoUnidades.js`). Por isso o que já foi pago não
muda de valor.

**Decisão selada.** O "Fechar competência" só guarda uma decisão por mês,
peça e processo. Uma decisão tomada antes de uma troca (ou da criação de uma
avulsa) daquela peça é de outra unidade. Ela fica **selada**: o registro dela
continua pago, a unidade nova aparece "a decidir", e confirmá-la cria um
registro novo **sem estornar** o antigo. A linha da decisão passa a ser a da
unidade nova; a anterior fica no registro dela e na auditoria.

**Cancelamento depois de uma troca:** a composição das peças do pedido já
considera as trocas (`gruposComTrocas` em `backend/cancelamentoEstorno.js`).
A unidade que chegou conta como vinda do estoque no ponto em que chegou, e a
devolução de matéria-prima sai certa.

### Os registros

- `trocas_pecas`: uma linha por troca, **imutável** (gatilho no banco). Ela
  guarda os dois lados (pedido, peça, estado de cada um com o restante por
  processo), a quantidade, o motivo, quem fez e quando.
- `pedido_historico_eventos`: um evento de transferência **em cada pedido**.
- Auditoria do Financeiro (`financeiro_eventos`, tipo `troca_pecas`): uma
  linha para cada pedido.

### As travas

- mesmo produto, pedidos diferentes;
- os dois pedidos Aprovados ou em Produção (ou um lado avulsa);
- estados diferentes;
- quantidade de 1 até o que existe nos dois estados, conferida de novo no
  servidor com o estado do momento. Se alguém registrou produção no meio, a
  troca é recusada e a tela pede para escolher de novo;
- motivo com ao menos 10 letras.

## Peça avulsa

### No cancelamento: "Continuar produzindo"

O modal "Cancelar pedido" ganhou uma 4ª opção em cada peça, **"Continuar
produzindo"** (ícone de fábrica). Ela pergunta quantas e **em que ponto a peça
está**: do ponto em que ela entrou no pedido até o penúltimo passo da rota,
com "Por começar — nada feito ainda" para a peça produzida do zero.

- A peça **não volta ao estoque** e **nenhum insumo volta**, porque ela ainda
  vai usar o resto da rota.
- O trecho que ela já andou é **pago na hora**, como no retorno ao estoque.
- Peça já **pronta** não tem o que continuar: a tela não oferece a opção, e se
  vier assim mesmo ela entra no estoque com aviso.
- Sem o SQL novo, o cancelamento com "Continuar produzindo" é **recusado
  antes de mexer em qualquer coisa**.

### No "Fechar competência — produção"

O pedido cancelado com avulsas vivas aparece como **"Peças avulsas — PEDx
(cancelado)"**. As peças contam só as unidades que seguem em produção. Cada
avulsa tem:

- **Devolver ao estoque**: escolha o ponto da rota (do ponto em que ela
  entrou até pronta; o ponto atual vem marcado) e o motivo. Ela entra no lote
  daquele ponto, e o resto da rota volta à matéria-prima.
- **Cancelar a produção**: a peça deixa de existir no ponto escolhido, e o
  resto da rota volta à matéria-prima.
- **Substituir a peça de um pedido**: abre a troca. A avulsa entra no lugar
  da peça de um pedido em produção, e a peça de lá vira a avulsa.

Ela **não vai direto para um pedido**: só substituindo uma peça que o pedido
já tem.

O que foi feito na avulsa é confirmado ali mesmo, como em qualquer pedido.
Quando todos os processos ficam prontos, ela **entra no estoque pronta**
sozinha (movimento de retorno, lote do fim da rota) e a tela avisa.

### Os registros

`pecas_avulsas`: uma linha por unidade, com o pedido de origem, o ponto em
que ficou avulsa, o lote e o status (`em_producao`, `no_estoque`,
`descartada`, `trocada`). Encerrar grava `encerrada_em/por` e o encerramento
(tipo, ponto, lote, movimento, motivo); nada é apagado. A avulsa que entra
numa troca fica `trocada`, e a peça que sai do pedido nasce como avulsa nova
(origem `troca`). Cada passo deixa evento no pedido e auditoria (`peca_avulsa`).

## Banco

`sql/trocas_pecas_e_avulsas.sql`: rode e **reinicie a API**. Ele cria
`trocas_pecas` e `pecas_avulsas` e a coluna `perm_ped.acao_trocar_pecas`
(ligada para Sup Admin e Administrador).

## Permissões

| Ação | Permissão |
|---|---|
| Trocar peças (ícone e "Substituir a peça de um pedido") | `ped.trocar_pecas` |
| Devolver ao estoque / Cancelar a produção da avulsa | `ped.trocar_pecas` **ou** `ped.cancel` |
| "Continuar produzindo" no cancelamento | a do cancelamento (`ped.cancel`) |

## Escolhas feitas sem o dono (a confirmar)

1. A troca é só entre unidades **do mesmo produto**.
2. Só trocam pedidos **Aprovados ou em Produção**.
3. "Cancelar a produção" da avulsa é o descarte no ponto escolhido, com o
   resto da rota voltando à matéria-prima.
4. O que foi feito na avulsa é pago pelo Fechar competência: confirme lá
   **antes** de devolver ou cancelar, porque encerrar não paga nada a mais.
5. A avulsa pronta entra no lote do fim da rota, com movimento de retorno.

## Código e testes

- `backend/trocasPecas.js`: opções, validação e a troca. Rotas
  `GET /api/trocas-pecas/pedido/:id` e `POST /api/trocas-pecas`. Teste em
  `backend/trocasPecas.test.js`.
- `backend/pecasAvulsas.js`: criação no cancelamento, entrada no estoque
  quando fica pronta, encerrar e as opções dele. Rotas
  `GET /api/pecas-avulsas/:id/opcoes` e `POST /api/pecas-avulsas/:id/encerrar`.
  Teste em `backend/pecasAvulsas.test.js`.
- `backend/financeiro/mudancasUnidades.js`: leitura das trocas e avulsas e
  as mudanças de cada peça e processo. `alocarComMudancas` fica em
  `producaoUnidades.js`. Teste em
  `backend/financeiro/producaoMudancas.test.js`.
- `backend/financeiro/producaoConfirmacao.js`: o card das avulsas e a
  decisão selada.
- `backend/cancelamentoEstorno.js`: a ação `avulsa` e `gruposComTrocas`.
- Tela: `src/html/modals/pedidos/trocar-pecas.html`,
  `src/js/modals/pedido-trocar-pecas.js`, `src/styles/trocar-pecas.css`; o
  ícone em `src/js/pedidos.js`; a opção no `pedido-cancelar.js`; o card em
  `financeiro-modais.js`. Teste em `src/js/__tests__/trocasPecasTela.test.js`
  (o modal roda de verdade no DOM mínimo).
