# Rateio da produção entre colaboradores

Entrega de 24/09/2026. A produção paga **por processo de cada peça**
(marcenaria, acabamento, montagem, embalagem…). O rateio diz **quem fez** cada
um desses processos e **quanto por cento** leva.

> A primeira versão desta tela, feita na madrugada, tinha sido montada em cima
> da **comissão**. O dono corrigiu: é da **produção**. A comissão voltou a
> fechar como era antes.

## Onde fica

**Modal próprio "Rateio da produção"**, aberto por:

- Financeiro › **Ações rápidas › Rateio da produção**;
- a pendência do painel ("N processos sem rateio completo");
- o **"Fechar competência"** do "Fechar competência — produção", quando tudo
  já está confirmado e só falta distribuir: em vez de barrar, ele pergunta e
  leva para cá.

O cadastro de **colaboradores** mora dentro do mesmo modal, na coluna da
esquerda. Não há mais aba nas Regras.

## A unidade é o PROCESSO

Uma peça que passa por quatro processos paga quatro linhas — são **4
processos**, mas **1 peça**. Quem fez a marcenaria pode não ser quem montou,
então cada processo tem a sua própria divisão.

Para quem divide a peça inteira do mesmo jeito, existe o atalho **"Mesma
divisão nos outros N processos"**: ele copia a divisão de um processo já
fechado para os outros da mesma peça que ainda não têm ninguém (os que já têm
ficam como estão, e a tela diz quantos foram pulados).

## Quando dá para ratear

**A qualquer momento**, no que já foi decidido no mês. Processo que ainda não
foi confirmado em "Fechar competência — produção" nem aparece aqui: ele entra
assim que você disser quantas unidades ficaram prontas. O aviso no topo mostra
o que ainda está esperando decisão, sem impedir que você distribua o resto.

## As travas

1. **A soma de cada processo vai até 100% e nunca passa.** O campo anuncia o
   restante ("até 40%") e o botão **"Dar os 40%"** fecha o processo de uma vez.
2. **Processo em 100% não recebe mais ninguém** — o formulário some dele.
3. **Ninguém entra duas vezes no mesmo processo**: quem já está sai da lista, e
   o banco tem o índice único para o caso de duas máquinas.
4. **Fechar a competência da produção exige 100% em todo processo.**
5. **A exigência só vale quando o rateio está em uso**, isto é, quando há ao
   menos um colaborador cadastrado. Sem ninguém, a produção fecha como sempre
   fechou.

Competência fechada fica só em leitura.

## Peças × processos

Confundir os dois era um defeito: o resumo dizia "8 peças finalizadas" quando
eram **2 peças × 4 processos**. Agora:

| Número | O que é |
|---|---|
| `pecas` | peças distintas (pela linha do pedido) |
| `processos` | pares peça+processo — o que de fato se paga |
| `unidades` | a soma das quantidades (era o que `pecas` contava antes) |

Os dois aparecem nos cartões da tela de produção, no rodapé do "Fechar
competência — produção" e nos indicadores do rateio.

## Banco

`sql/producao_colaboradores_rateio.sql` — rode e **reinicie a API**. Ele
**substitui** o `comissao_colaboradores_rateio.sql` da madrugada e funciona
nos dois casos: quem já rodou o anterior tem a tabela de colaboradores
renomeada (os cadastros continuam) e a de rateios antiga descartada; quem não
rodou, cria tudo.

| Tabela | Para quê |
|---|---|
| `producao_colaboradores` | quem pode receber (nome, função, `ativo`). Único por nome entre os vivos |
| `producao_rateios` | a divisão: `pedido_item_id` + `setor_id` (o processo), `colaborador_id`, `percentual`. Único por (peça, processo, colaborador) entre as vivas |

Remover é **desligar** (`ativo`), nos dois casos; o histórico do Financeiro
guarda quem cadastrou, editou e tirou.

## Permissões

| Ação | Permissão |
|---|---|
| Ver os colaboradores, os processos e o rateio | `financeiro.comissao.view` |
| Cadastrar, distribuir, tirar e desligar | `financeiro.regras.editar` |
| Fechar a competência pelo modal | `financeiro.competencia.fechar` |

## O "Fechar competência — produção" na mesma entrega

- **"Nada pronto"** vermelho no pedido, ao lado do "Tudo pronto neste pedido":
  nenhuma unidade entra na competência, tudo volta no mês seguinte.
- **"Tudo" e "Nada" em cada peça**, na frente da tag do código, decidindo
  todos os processos dela de uma vez.
- Pedido ou peça **já confirmado**: os botões continuam **visíveis e
  inativos** (antes sumiam), com a data no hover.
- Hover na etiqueta **"Confirmado"**: quando o pedido inteiro foi confirmado.
  Na **"Tudo decidido"** de cada peça: quando aquela peça foi decidida.
- Hover na etiqueta **"Peça sem regra de produção"**: **quais** peças estão sem
  regra.
- O **"Fechar competência"** do modal "Produção — mês/ano" abre a tela da
  **produção** (antes abria a de comissões).

## Código e testes

- `backend/financeiro/rateios.js` — as contas puras (soma, restante, a trava
  do cadastro, a divisão sem perder centavo, o estado dos processos, o atalho
  da peça, o bloqueio do fechamento) e o CRUD; teste em `rateios.test.js`.
- `backend/financeiro/producao.js` — `contarPecasEProcessos`.
- `backend/financeiro/producaoConfirmacao.js` — as datas (`decidida_em`,
  `confirmado_em`) e `pecas_sem_valor`.
- `backend/financeiro/fechamentos.js` — o bloqueio entra na prévia da
  produção; `painel.js` — a pendência.
- Rotas em `backend/financeiroController.js`:
  `GET/POST/PUT/DELETE /api/financeiro/colaboradores`,
  `GET/POST/PUT/DELETE /api/financeiro/rateio` e `POST /api/financeiro/rateio/peca`.
- Tela: `src/html/modals/financeiro/rateio-producao.html` e
  `montarRateioProducao` em `src/js/modals/financeiro-modais.js`; teste em
  `src/js/__tests__/rateioProducao.test.js`.
