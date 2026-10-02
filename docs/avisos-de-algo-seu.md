# Avisos de "algo seu" no sino

Data: 01/10/2026. Pedido do dono: avisar a pessoa quando ela for citada ou quando alguém mexer em algo dela. Isso inclui:
- passar algo para ela, ou tirar dela;
- excluir algo que era dela;
- trocar o responsável quando era ela.

Quando a ação traz texto (nota, motivo, observação, justificativa), o texto aparece no aviso como aparece no histórico.

**Não precisa de SQL.** A tabela `notificacoes` não tem trava de tipo nem de origem. O texto vai dentro da `mensagem`.

## Respostas do dono (02/10/2026)

| # | Pendência | Resposta | Situação |
| --- | --- | --- | --- |
| 1 | Edição comum também avisa? | "1b — se o usuário for o responsável, tudo; se não for, nada, mesmo que tenha sido ele quem cadastrou" | **Em aberto:** a resposta conflita com a do item 2 (ver abaixo). Continua como estava. |
| 2 | Quem criou recebe junto com o responsável? | "2c" — quem criou recebe só o importante | **Em aberto**, junto com o 1. |
| 3 | Excluir sem motivo | **3c — motivo obrigatório** | Feito. |
| 4 | Cancelar tarefa sem motivo | 4b — motivo opcional | **Em aberto:** nenhuma tela cancela tarefa à mão (ver abaixo). |
| 5 | Observações internas do usuário | 5a — ficam de fora | Como estava. |
| 6 | Tarefa do próximo passo | **6b — "Nova tarefa para você", sem chegar junto com outro aviso igual** | Feito. |
| 7 | Comissão paga | **7b — quem paga escolhe quem avisar; o sistema sugere pelo nome; vale para comissão e produção** | Feito. |
| 8 | Categorias do sino | **8b — cada aviso na sua categoria, no sino e na janela do canto** | Feito. |

### 3c — Excluir pede o motivo

- **Prospecção, cliente, orçamento e pedido:** a caixa de excluir tem o campo **Motivo da exclusão** (obrigatório, até 600 letras). Sem ele, a tela não manda e o servidor recusa ANTES de apagar qualquer coisa ("Escreva o motivo da exclusão.").
- O motivo vai no aviso de quem tinha a ficha ("» Motivo: …"). No orçamento, fica também no histórico do cliente e da prospecção ligados.
- **Código:** `avisosEnvolvidos.motivoDaExclusao` e `SEM_MOTIVO`; as quatro rotas `DELETE /:id`; as telas `prospeccao-excluir.js`, `cliente-excluir.js`, e o `confirmarExclusaoSupAdmin` de `orcamentos.js` e `pedidos.js`.

### 6b — A tarefa do próximo passo avisa

- Quando outra pessoa define o próximo passo de uma prospecção, quem responde por ela recebe **na hora** "Nova tarefa para você": "Henrique definiu o próximo passo da prospecção ACME: Ligar — 05/10/2026".
- O aviso da prospecção **não repete** o passo para quem recebeu a tarefa. Se só o passo mudou, ele nem sai para essa pessoa; se mudou mais coisa (etapa, uma nota), sai com o resto. Quem criou a prospecção continua recebendo a atualização, como antes.
- O lembrete e o atraso da tarefa continuam no dia e na hora dela, como em qualquer tarefa.
- Quem define o próprio passo não recebe nada (foi ele quem fez). A planilha continua não criando a tarefa.
- **Código:** `tarefasServico.criarTarefa` (o aviso) e `sincronizarPassoDaProspeccao` (devolve se a tarefa é nova); `prospeccoesController.historicoEPasso` (grava o histórico, cria a tarefa e só então avisa), usado em editar, definir o próximo passo e concluir o passo; `montarAvisos({ semPassoPara })`.

### 7b — Comissão e produção pagas avisam quem recebeu

- Em **Confirmar pagamento** há a lista **Avisar no sino**: uma linha por pessoa deste pagamento, com o valor e um seletor de usuário.
  - Comissão: os beneficiários (CMS e Royalty da mesma pessoa numa linha só) — de tudo o que falta ou só de quem foi escolhido.
  - Produção: os colaboradores do rateio da competência, com a parte de cada um. Sem rateio, a tela diz que não há a quem avisar.
- O usuário **de mesmo nome** (sem diferença de acento e maiúscula) já vem escolhido. Quem paga pode trocar por outro usuário ou deixar **Não avisar**.
- Depois de gravar os pagamentos, a tela manda as escolhas; o servidor calcula o valor de cada pessoa a partir dos pagamentos gravados (nunca da tela) e manda **um** aviso por usuário: "Henrique confirmou o pagamento da sua comissão de setembro/2026: R$ 1.234,56 (Pix, 01/10/2026)", com as linhas CMS e Royalty quando houver as duas. Se o usuário escolhido não é a própria pessoa, o aviso diz de quem era o pagamento.
- Só os pagamentos que a própria pessoa acabou de gravar (até 30 minutos) podem ser avisados. Se o aviso falhar, o pagamento continua confirmado e a tela diz que os avisos não foram.
- Clicar no aviso abre o Financeiro. A categoria do aviso é **Financeiro**.
- **Código:** `backend/financeiro/avisoDoPagamento.js` (+ teste); rota `POST /api/financeiro/pagamentos/avisos`; tela `confirmar-pagamento.html` e `montarConfirmarPagamento`.

### 8b — As categorias do sino valem de verdade

- **Antes:** só "Vendas e pedidos" contava, e desmarcá-la calava o sino inteiro (tarefas inclusive). As outras três não faziam nada.
- **Agora** (`src/js/utils/categorias-aviso.js`, o mesmo arquivo no sino, no servidor e na janela do canto):
  - **Tarefas e lembretes:** lembrete, atraso, convite, e tudo das tarefas (passada, alterada, concluída, excluída, comentário);
  - **Vendas e pedidos:** prospecções, clientes, contatos, orçamentos, pedidos e os comentários do histórico;
  - **Financeiro:** Financeiro, Cobrança e Contabilidade (inclusive as mensagens dela);
  - **o seu cadastro** (acesso, senha, perfil) aparece sempre.
- Desmarcar esconde da lista **e da contagem** (o servidor filtra: `GET /api/notificacoes?ocultar=…`). Remarcar traz de volta: nada é apagado.
- O interruptor geral desligado cala tudo, inclusive a janela do canto.
- A janela do canto segue as mesmas escolhas, mesmo com o programa só na bandeja (`categorias-do-sino.json` na pasta do programa).
- As escolhas continuam sendo **do computador** (como já eram), não da pessoa.

### Os dois que ficaram em aberto

- **1 e 2:** "se não for o responsável, nada, mesmo que tenha sido ele quem cadastrou" diz que quem criou não recebe nada; a "2c" diz que quem criou recebe o importante. Até a resposta, continua como estava (responsável e quem criou recebem tudo).
- **4:** a explicação de 01/10 estava errada — nenhuma tela cancela tarefa à mão. O quadro só tem A fazer, Em andamento, Aguardando e Concluída, e o editor não tem "Cancelada". Só o sistema cancela (passo substituído, próximo passo removido, prospecção encerrada), já com o motivo no histórico da tarefa.

## Regras gerais

- **Quem recebe:** quem tem a ficha.
  - Prospecção: o responsável e quem criou.
  - Cliente: o dono (pelo nome) e quem cadastrou.
  - Contato: quem cadastrou.
  - Tarefa: quem responde, quem criou e quem participa.
  - Orçamento e pedido: o dono (o vendedor, pelo nome), mais quem responde pelo cliente e pela prospecção ligados.
  - Usuário: a própria pessoa.
  - Lançamentos do Financeiro e da Contabilidade: quem lançou ou fechou.
- **Quem escreveu um registro** (interação, nota, comentário) também recebe quando outra pessoa o altera ou exclui.
- **Nunca avisa quem fez a ação.** Cada pessoa recebe **um** aviso por ação, na ordem:
  1. quem passou a responder;
  2. quem deixou de responder;
  3. quem escreveu o registro;
  4. os demais.
- **Sem quem agiu** (o sistema sozinho), não avisa.
- **Falha ao avisar** só vai para o log. Nunca desfaz o que foi salvo.
- **Menção (@)** continua como era, no histórico e nas mensagens da Contabilidade.
  - Agora o comentário, a resposta, a observação e a menção trazem o texto inteiro (até 600 letras) como nota, e não só um pedaço.

## O que cada módulo avisa

| Módulo | Ação de outra pessoa | Quem recebe | O aviso |
| --- | --- | --- | --- |
| Prospecções | troca de responsável (a rota própria ou a edição) | o novo, o antigo, quem criou | "Prospecção agora é sua" / "passou para outra pessoa", com a observação |
| Prospecções | edição, etapa, perdido, próximo passo, interação, nota, campanha, conversão, orçamento ligado | responsável e quem criou | "Prospecção atualizada" + o que mudou + a observação ou o motivo |
| Prospecções | interação ou nota de outra pessoa alterada/excluída | quem a escreveu | "Um registro seu foi alterado/excluído" |
| Prospecções | criada já com outro responsável | o responsável | "criou a prospecção X e deixou com você" |
| Prospecções | exclusão (Sup Admin) | responsável e quem criou | "Prospecção excluída", com o motivo (obrigatório desde 02/10) |
| Prospecções | planilha importada | um aviso por pessoa | "Prospecções importadas para você", com a lista |
| Clientes | troca de dono, edição, contatos, transportadoras, atividades | o dono e quem cadastrou | igual a Prospecções; a descrição da atividade vai como nota |
| Clientes | cadastrado/convertido já com outro dono; planilha | o dono | "Cliente agora é seu" / um aviso por dono na planilha |
| Clientes | exclusão | o dono e quem cadastrou | "Cliente excluído" |
| Contatos | edição, pessoas, atividades; exclusão | quem cadastrou (e quem registrou a atividade) | "Contato atualizado/excluído" |
| Tarefas | passar para outra pessoa | o novo ("Nova tarefa para você", como antes) e o antigo ("passou para outra pessoa") | — |
| Tarefas | edição, reagendar, cancelar, reabrir | quem responde, criou e participa | "Tarefa reagendada" (como antes, agora com o resto do que mudou), "Tarefa atualizada", "Tarefa cancelada" |
| Tarefas | concluir | quem criou, responde e participa | "Tarefa concluída", **com a nota de quem concluiu** |
| Tarefas | excluir | quem responde e participa | "Tarefa excluída", com o motivo |
| Tarefas | tirar alguém da tarefa em conjunto | quem saiu ("Você saiu de uma tarefa") e quem tem a tarefa | — |
| Tarefas | convite | o convidado | o recado do convite vai como nota |
| Tarefas | tarefa ligada a uma prospecção/cliente | quem tem a ficha, se não tem a tarefa | "atualizou a prospecção/o cliente" |
| Orçamentos | situação, edição (o que mudou de fato: situação, dono, valor, validade, prazo, pagamento, transportadora, observações), cópia, exclusão | o dono, quem responde pelo cliente e pela prospecção | "Orçamento atualizado/excluído", "Orçamento agora é seu" |
| Pedidos | situação; cancelado; exclusão | o dono e quem responde pelo cliente | "Pedido atualizado", "Pedido cancelado", "Pedido excluído" |
| Usuários | perfil de permissões, nome, e-mail, telefone, perfil, acesso, senha | a própria pessoa | "Seu cadastro foi alterado" (a senha só diz "Redefiniu a senha"; as observações internas não entram) |
| Histórico | o Sup Admin tira um comentário ou um registro do histórico | quem escreveu | "Seu comentário foi removido", com o motivo |
| Financeiro | ajuste cancelado; produção estornada | quem lançou | com o motivo |
| Financeiro | comissão ou produção paga (02/10) | o usuário que quem pagou escolheu para cada pessoa (sugerido pelo nome) | "Comissão paga" / "Produção paga", com o valor |
| Cobrança | ordem de pagamento cancelada; recebimento estornado | quem lançou | com o motivo |
| Contabilidade | arquivo ou documento excluído; conta cancelada; pagamento estornado; competência reaberta | quem enviou/lançou/fechou | com o motivo ou a justificativa |

### O que fica de fora, de propósito

- **A tarefa do próximo passo** não avisa a ficha (quem tem a prospecção). Desde 02/10 ela avisa quem a recebe ("Nova tarefa para você"), e o aviso da prospecção não repete o passo para essa pessoa (ver 6b acima).
  - A tarefa automática e a próxima da série também não avisam a ficha: o fato que as gerou já avisou.
- **As baixas automáticas do banco** (conciliação do BB) não avisam: o banco agiu, não uma pessoa.
- **As fichas de Contatos criadas pela planilha** não avisam: quem cadastra é quem importa.
- **Os lançamentos derivados não repetem o aviso.**
  - Na aprovação de um orçamento, o aviso é o da situação. A renumeração do OCRP e a conversão da prospecção não avisam de novo.
  - Na exclusão de um documento, quem o lançou recebe um aviso só, com as contas que caíram junto.

## O texto do aviso

A `mensagem` é gravada em linhas:

1. **A 1ª linha diz o que aconteceu.** Exemplo: "Ana passou a prospecção ACME para você."
2. **As linhas "• …" dizem o que mudou.** Exemplo: "Etapa do funil: Proposta → Perdido".
   - Vão até 5 linhas; o que passar vira "e mais N mudanças".
3. **As linhas "» …" trazem a nota, como foi escrita.**
   - Uma nota de várias linhas tem "» " em cada uma.
   - Um "»" sozinho separa duas notas.

`GET /api/notificacoes` devolve cada aviso com `mensagem` (a 1ª linha), `mudancas` e `notas` (`notificacoesController.partesDaMensagem`). Um aviso antigo, de uma linha, volta igual.

No sino:
- **As mudanças** aparecem numa lista pequena.
- **A nota** aparece num quadro com a barra dourada, mantendo as quebras de linha. Ela corta em 5 linhas, e o texto inteiro fica ao passar o mouse.
- **A notificação do Windows** leva a mensagem e o começo da nota.

**Ao clicar no aviso:**
- prospecção, cliente, contato e tarefa abrem a ficha, como antes;
- orçamento e pedido abrem a visualização deles;
- o Financeiro e a Contabilidade abrem o módulo;
- o aviso de várias fichas (a planilha) abre a lista do módulo;
- o "excluído" e o aviso de cadastro só ficam marcados como lidos.

## Onde mora

- `backend/avisosEnvolvidos.js`. Funções puras:
  - `montarAvisos`, `linhaDoEvento`, `notasDosEventos`, `trocaNosEventos`, `comporMensagem`, `avisosDaPlanilha`.

  E as que falam com a API:
  - `avisarDaFicha`: lê a ficha e os nomes;
  - `avisarDaVenda`: orçamento e pedido, mais o cliente e a prospecção;
  - `avisarPessoa`: uma pessoa só.
- **Os gravadores de histórico avisam sozinhos.** Recebem um último parâmetro `aviso` (opções, ou `false`):
  - `prospeccoesController.registrarHistorico`;
  - `clienteHistorico.registrarNoCliente`;
  - `contatoHistorico.registrarNoContato`.
- **Tarefas** (`tarefasController`): na edição, concluir, reabrir, excluir e participantes; mais `tarefasServico.registrarNaFicha`.
- **Orçamentos:** `avisarDoOrcamento` e `mudancasDoOrcamento`.
- **Pedidos** (`/:id/status`, `DELETE /:id`): o módulo é `sino`, porque as rotas já têm uma lista `avisos`.
- **Usuários:** `avisarDaConta` e `mudancasDaConta`.
- **Histórico social:** `avisarRemocao`.
- **Financeiro, Cobrança e Contabilidade:** `avisarPessoa` em cada `cancelar`, `estornar`, `excluir` e `reabrir`.
- **Tela:** `src/js/notifications.js` e `src/styles/historico-social.css` (as classes `sino-aviso__mudancas` e `sino-aviso__nota`).

## Conferido

- **Testes do backend:**
  - `avisosEnvolvidos.test.js` (12);
  - novos testes de rota em `tarefasController.test.js` (passar, concluir com nota, reabrir, tirar da tarefa, excluir com motivo) e em `prospeccoesController.test.js` (troca de responsável com observação, interação de outra pessoa excluída, perdido com motivo);
  - `historicoSocial.test.js` (a remoção avisa quem escreveu, com o motivo);
  - `senhaUsuario.test.js` (o aviso diz que a senha mudou, nunca a senha).
- **As baterias** de Prospecções, Clientes, Contatos, Tarefas, Orçamentos, Pedidos, Usuários, Financeiro, Cobrança e Contabilidade, uma a uma. As falhas que restam já falhavam no HEAD.
- **Tela:** `sinoAlgoSeu.test.js`, e o sino no Electron nos temas escuro e claro, com avisos montados pelo próprio backend.
