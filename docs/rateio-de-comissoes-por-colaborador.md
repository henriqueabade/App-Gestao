# Rateio das comissões entre colaboradores

Entrega de 24/09/2026. A comissão já tinha dono por natureza — **CMS** é do
dono do cliente, **Royalty** é do desenhista da peça. O rateio é uma camada
por cima: de cada **peça contabilizada**, o usuário diz **quem recebe** e
**quanto por cento**.

## Onde fica

Financeiro › **Regras** › aba **"Colaboradores (rateio)"** — o mesmo modal
onde já se cadastram a CMS, o Royalty, os processos e os prazos. A aba tem
duas partes:

| Parte | O que faz |
|---|---|
| **Colaboradores** | quem participa das comissões: nome e função. Desligar tira a pessoa das peças em que estava |
| **Peças contabilizadas** | uma competência por vez: cada peça com a comissão que puxa, a barra do que já foi distribuído e as linhas de quem recebe |

## A unidade é a PEÇA

Depois que a comissão de um pedido é apurada, ela é repartida entre as peças
dele **na proporção do valor vendido** — a mesma proporção que o Royalty usa
para achar o desenhista, e com a mesma regra da devolução (peça devolvida sai
da conta; se tudo voltou, a divisão fica pelo valor vendido).

A sobra de centavo do arredondamento vai para a maior fatia, nas duas
divisões (pedido → peças, peça → colaboradores): a soma sempre bate com o
total, sem centavo perdido nem inventado.

## As travas

1. **A soma de uma peça vai até 100% e nunca passa.** O campo já anuncia o
   restante ("até 40%") e o botão **"Dar os 40%"** fecha a peça de uma vez.
   Tentar mais do que cabe é recusado com o texto do que resta.
2. **Peça já em 100% não recebe mais ninguém** — o formulário some dela.
3. **Ninguém entra duas vezes na mesma peça**: quem já está sai da lista de
   escolha, e o banco tem o índice único para o caso de duas máquinas.
4. **Fechar a competência exige 100% em toda peça contabilizada.** O bloqueio
   aparece na prévia de "Fechar competência — comissões", com os três
   primeiros exemplos do que falta.
5. **A exigência só vale quando o rateio está em uso**, isto é, quando há ao
   menos um colaborador cadastrado. Sem ninguém, o Financeiro fecha como
   sempre fechou — senão a primeira virada de mês depois de subir o código
   travaria sozinha.

## Onde aparece

- **Painel do Financeiro**: pendência de nível alto — "N peças sem rateio
  completo", com o botão que leva às Regras — enquanto faltar distribuir.
- **Fechar competência — comissões**: o bloqueio, e o resumo de quanto cada
  colaborador leva.
- **Na própria aba**: o bloco **"A pagar por colaborador"**, com o valor e em
  quantas peças cada um entrou.

Competência já fechada fica só em leitura: o que foi congelado no fechamento
não se reescreve.

## Banco

`sql/comissao_colaboradores_rateio.sql` — rode e **reinicie a API**. Sem ele a
aba avisa qual arquivo falta e **nada quebra**: o fechamento não passa a
exigir coisa nenhuma.

| Tabela | Para quê |
|---|---|
| `comissao_colaboradores` | quem pode receber (nome, função, `ativo`). Índice único por nome entre os vivos |
| `comissao_rateios` | a distribuição: `pedido_item_id` (a peça), `colaborador_id`, `percentual`. Índice único por (peça, colaborador) entre as vivas |

Remover é **desligar** (`ativo`), nos dois casos: o rastro fica, e o histórico
do Financeiro (`financeiro_eventos`) guarda quem cadastrou, editou e tirou.

## Permissões

| Ação | Permissão |
|---|---|
| Ver os colaboradores, as peças e o rateio | `financeiro.comissao.view` |
| Cadastrar, distribuir, tirar e desligar | `financeiro.regras.editar` |

Nenhuma permissão nova: quem já mexe nas regras de comissão mexe no rateio.

## Código e testes

- `backend/financeiro/rateios.js` — as contas puras (soma, restante, a trava
  do cadastro, a divisão sem perder centavo, o estado das peças, o bloqueio do
  fechamento) e o CRUD; teste em `rateios.test.js`.
- `backend/financeiro/fechamentos.js` — o bloqueio entra na prévia de
  comissões, junto com os outros.
- `backend/financeiro/painel.js` — `pendenciaDoRateio`.
- Rotas em `backend/financeiroController.js`:
  `GET/POST/PUT/DELETE /api/financeiro/colaboradores` e
  `GET/POST/PUT/DELETE /api/financeiro/rateio`.
- Tela: a aba em `src/html/modals/financeiro/regras.html` e
  `montarColaboradores` em `src/js/modals/financeiro-modais.js`; teste em
  `src/js/__tests__/comissaoRateio.test.js`.

## Decisões tomadas sem o dono (24/09/2026)

Ele pediu para decidir e fechar. Para o registro:

- **A unidade do rateio é a peça do pedido** (`pedidos_itens`), e a
  distribuição vale para aquela peça daquele pedido — não por competência.
  Assim o que foi combinado uma vez continua valendo nos meses seguintes.
- **A exigência de 100% só liga quando há colaborador cadastrado.** Era o
  único jeito de entregar a trava sem arriscar travar o fechamento de quem
  ainda não usa o recurso.
- **Desligar um colaborador tira o rateio dele**, e as peças voltam a ficar
  incompletas. Deixar linha viva apontando para quem não existe mais seria
  pior que pedir para refazer a distribuição.
- **O percentual aceita 4 casas** (para 3 pessoas em 33,3333% cada), e a
  tela mostra vírgula.
