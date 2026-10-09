# Rodada de 08/10/2026: etiquetas, filtros, Relatórios, Fechar produção, menu e tarefas

Dez pedidos do dono feitos de uma vez, sem parar para perguntar. Onde houve
decisão minha, ela está marcada com **Decisão** e o porquê, para o dono
confirmar ou pedir para mudar.

---

## 1. Etiqueta Produto (Excel): peça que saiu do estoque não entra

`backend/etiquetasProduto.js` (`prontasDoEstoque`, `unidadesDoItem`) e a rota
`GET /api/pedidos/:id/etiquetas-produto` (`backend/pedidosController.js`).

- Etiquetas de um item = quantidade − unidades **prontas** do estoque
  (`qtd_usar_pronta`, com teto na quantidade — a coluna pode guardar o estoque
  que havia, maior que o pedido).
- Pedido todo do estoque: a planilha não sai, com o aviso "Todas as peças deste
  pedido saíram prontas do estoque".
- O aviso de "Planilha salva" diz quantas ficaram de fora.

**Decisão:** só a peça **pronta** do estoque sai da planilha. A que saiu do
estoque **pela metade** continua pedindo etiqueta, porque ainda passa pela
produção e é etiquetada no fim, como a feita do zero.

## 2 e 5. Relatórios: filtros revisados e o Master-Detail parado

`src/js/relatorios.js`, `src/html/relatorios.html`, `src/css/relatorios.css`.

O que estava quebrado e foi corrigido:

| Onde | Antes | Agora |
|---|---|---|
| Pedidos e Orçamentos › Cliente | comparava com um campo que a lista não tem: escolher um cliente esvaziava a tabela | compara com o nome do cliente (`cliente_nome`) |
| Pedidos e Orçamentos › Dono | nenhum filtro lia | filtra |
| Pedidos e Orçamentos › Período | nenhum filtro lia (nem o Personalizado) | Última semana / mês / trimestre pela data de emissão; Personalizado pelo intervalo do balão |
| Seletores (status, coleção, categoria, dono, tipo, condição) | "contém": Mármore trazia Mármore Branco; 2 parcelas trazia 12 | igualdade |
| Prospecções | Estado e Data de criação sem ligação; Filtrar/Limpar não faziam nada | ligados |
| Clientes › País/Estado | escolher não mudava a tabela | redesenha |
| Coluna Data | mostrava o dia anterior (DATE lido com fuso) | o dia gravado |
| Carregar Modelo | três nomes de exemplo que não faziam nada; "Salvar" não salvava | modelos de verdade |
| Agendar | desenho de um envio por e-mail que nunca existiu | saiu da tela |

Os filtros agora **filtram na hora**: caixa de texto enquanto se digita;
seletor, data e marcador ao mudar. O "Filtrar" continua.

**Master-Detail:** marcar um card não o leva mais para o topo. A lista fica
sempre na ordem do relatório e só os cards mudam de cor (nada é redesenhado),
com "N selecionados" ao lado de "Registros". A ordem em que se marcou continua
guardada: é nela que o Agrupamento e o PDF montam os documentos. Marcar mostra
o detalhe do card marcado; desmarcar deixa o detalhe onde estava.

**Decisões:**
- **Modelos** ficam salvos **neste computador** (`localStorage`, chave
  `relatorios-modelos:v1`). Não há tabela para guardá-los para a equipe, então a
  "Visibilidade" (pessoal/equipe/público) saiu do modal. Um modelo guarda a
  aba, os filtros, o período (inclusive o intervalo personalizado) e, se
  marcado, as colunas. País/Estado não entram. Salvar com o mesmo nome na mesma
  aba substitui o anterior.
- **"Agendar" saiu.** Os destinatários eram de exemplo e o botão não agendava
  nada. Fazer de verdade (envio automático por e-mail, com hora e formato) é um
  trabalho próprio; fica como pendência nova, se o dono quiser.

## 3. Filtros avançados e busca enquanto digita

- `src/js/utils/filtros-avancados.js` + `src/styles/filtros-avancados.css`: o
  padrão "Filtros avançados" de Prospecções virou global. É um botão com a
  setinha no fim da barra; o painel nasce **fechado** e cresce para baixo
  dentro do card. Fechado e filtrando, o botão ganha um ponto dourado.
- `backend/vinculosDasPecas.js` (`/api/vinculos-pecas/{produtos,pedidos,orcamentos}`):
  que peça está em que documento, numa leitura só.
- **Produtos:** "Cliente ou pedido" mostra só as peças que estão nos pedidos e
  orçamentos desse cliente ou número. Embaixo do nome aparecem os documentos
  (por exemplo "PED100 · Jackie"). "Procurar em" escolhe entre pedidos e
  orçamentos, só pedidos ou só orçamentos. Quem não pode ver Pedidos (ou
  Orçamentos) não recebe os documentos daquele módulo.
- **Orçamentos e Pedidos:** "Cliente, peça ou código" mostra os documentos
  desse cliente ou que têm a peça. Vários termos valem juntos ("jackie
  pietra"), e embaixo do cliente aparecem as peças que casaram.
- `src/js/utils/busca-ao-digitar.js`: **toda** caixa de texto de filtro filtra
  enquanto se digita, com uma pausa curta. O Enter aplica na hora.
  - **Ligadas agora:** Clientes, Contatos, Laminação › Clientes, IA, o mínimo e
    o máximo de Prospecções, o preço de Produtos, a busca do "Importar boletos"
    e todos os campos dos Relatórios.
  - **Já filtravam assim:** Matéria-prima, Produtos, Prospecções, Usuários,
    Tarefas, os modais do Financeiro e da Contabilidade, "Converter
    orçamentos", "Substituir peça" e as Permissões.
- Orçamentos e Pedidos: a lista refeita (depois de salvar ou converter) volta a
  aplicar os filtros que estão na tela. Antes ficavam marcados sem efeito.

**Decisão:** em Produtos o filtro procura em pedidos **e** orçamentos (dá para
escolher). Um cliente só com orçamento também tem peças relacionadas.

## 4. Fechar competência — produção

`src/html/modals/financeiro/fechar-producao.html`, `montarFecharProducao` em
`src/js/modals/financeiro-modais.js`.

- Barra **"Filtrar pedidos"** retraída (a seção retrátil dos modais). Aceita
  número do pedido, cliente, nome ou código da peça, e filtra enquanto se
  digita. Fechada, a barra diz o que está filtrando.
  - Se casou pelo pedido ou pelo cliente, o card vem inteiro.
  - Se casou só por peça, o card vem com as peças que casaram e um aviso de que
    "Tudo pronto" e "Nada pronto" valem para o pedido inteiro.
- **A tela não se mexe:** confirmar uma peça recolhe os campos dela, e o
  cabeçalho da peça fica no mesmo ponto da tela. O mesmo vale para "Tudo"/"Nada"
  da peça e para "Tudo pronto"/"Nada pronto" do pedido, ancorados no card.
  - **Antes:** a releitura mostrava "Carregando os pedidos..." em cima dos
    cards e a lista inteira era refeita, então a tela pulava.
  - **Agora:** a releitura depois de confirmar é silenciosa, e a rolagem volta o
    bloco ao lugar.

## 6. Menu lateral com rolagem

`src/css/menu.css` (`#sidebar > nav`).

- Quando os itens passam da altura da tela, o menu rola com a barra fina
  dourada do programa (a regra global de `scroll.css`, 3d). A barra só aparece
  com o mouse sobre o menu.
- **Sem mudar largura nenhuma.** O lugar da barra (6 px) fica sempre reservado
  (`scrollbar-gutter: stable`) e sai do recuo da direita, que era 8 px e passou
  a 2 px. 2 + 6 = 8, então os itens têm exatamente a largura de antes: 48 px
  recolhido e 224 px aberto, conferido no Electron.
- Fora do menu, `overflow-y: hidden` esconde a barra; em cima, `auto` a
  mostra. A posição da rolagem se mantém.

## 7, 8 e 9. Relatório de produção (Relatórios › Pedidos › Agrupamento + Detalhe)

`createAgrupamentoPrintHtml` em `src/js/relatorios.js`; `detalharPedidos` em
`backend/agrupamentoPedidos.js`.

- **7:** na linha do cliente, à direita, "Previsão de embarque: dd/mm/aaaa"
  (ou "Sem previsão de embarque").
- **8:** pedido com transportadora ganha, colado embaixo das peças do cliente,
  o quadro **"Descrição caixas"**: o nome da transportadora, as colunas Peso
  (kg), Altura, Largura e Comprimento (cm), e 4 linhas em branco. O bloco
  inteiro (peças e caixas) não se parte entre folhas.
- **9:** o total do agrupamento sai **uma vez só**, no fim da tabela. Antes o
  Chromium repetia o `<tfoot>` no pé de cada folha. O cabeçalho continua
  repetindo.
- Conferido imprimindo o documento em PDF (70 peças e 6 pedidos, 4 folhas).

**Decisões:**
- A "data prevista de entrega" é a **Previsão de embarque** do pedido, com
  esse nome no papel, que é como o programa a chama. O pedido não tem outra
  data prevista.
- "Não Definida" não conta como transportadora.

## 10. Tarefas automáticas: o fim natural

`backend/tarefasAutomaticas.js` (`ENCERRAMENTOS`, `encerramentoDaTarefa`),
`backend/tarefasServico.js` (`concluirTarefa`, `encerrarTarefa`,
`encerrarTarefasDoRegistro`, `conferirEncerramentos`).

**O problema:** a tarefa automática nasce de um fato ("orçamento enviado") e
cobra o passo seguinte ("cobrar a resposta"). Quando o registro dela se
encerrava por outro caminho, ela ficava aberta, com a data antiga.

**A regra geral:**
- Se o registro chegou ao fim que a tarefa esperava, ela é **concluída**, e o
  dia dela passa a ser **o do fechamento**.
- Se o registro deixou de existir (excluído), ela é **cancelada**: não foi
  feita, e "concluída" mentiria.

**Regra a regra:**

| Tarefa automática | O que a fecha |
|---|---|
| Orçamento enviado (follow-up) | aprovado (virou pedido), rejeitado ou expirado → concluída no dia do fechamento (`data_aprovacao`); excluído → cancelada |
| Pedido entregue (pós-venda) | o pedido já foi entregue e não "fecha" depois; só a exclusão do pedido cancela |
| Prospecção convertida (boas-vindas) | só a exclusão do cliente cancela |
| Comissões / Produção fechadas, Nota de quem recebe | já concluíam sozinhas pelo pagamento; faltava o dia |

**Tarefa automática concluída vai para o dia da conclusão.** Vale para
qualquer jeito de concluir: pelo sistema ou pela pessoa. A troca do dia fica na
linha do tempo da tarefa. A tarefa criada à mão continua no dia escolhido.

**Onde se percebe o fechamento:**
- **Na hora:** aprovar, rejeitar ou expirar o orçamento (pela edição ou pelo
  status, inclusive a conversão em lote de Pedidos).
- Excluir o orçamento, o pedido ou o cliente.
- **A prospecção dada como Perdida:** ela rejeita os orçamentos direto na API,
  sem passar pela rota do orçamento, então ganhou o gancho próprio.
- **Conferência das que ficaram para trás:**
  - Quando alguém abre Tarefas ou Calendário, em segundo plano e no máximo uma
    vez por minuto.
  - É o que fecha as antigas que já estavam abertas antes desta regra.
  - Não avisa ninguém, nem escreve na ficha do cliente.
  - "Excluído" só vale com o 404 do registro: uma lista que não pôde ser lida
    não cancela nada.

**Avisos:** no fechamento na hora, quem responde pela tarefa (e quem a criou)
recebe "Tarefa concluída sozinha", menos quem fez a ação.

**Fica como estava:**
- **Tarefas criadas à mão com "Ação no sistema"** (por exemplo, "Despachar o
  pedido") continuam como estão: a regra é das automáticas. Se o pedido for
  cancelado, a tarefa à mão não fecha sozinha. Se o dono quiser, a mesma
  lógica cancela essas também.
- O **próximo passo da prospecção** já acompanhava a prospecção (é concluído
  ou cancelado quando ela muda).

## Testes

- **Backend:**
  - `etiquetasProduto.test.js`
  - `vinculosDasPecas.test.js`
  - `agrupamentoPedidos.test.js`
  - `tarefasFimNatural.test.js`
- **Tela:**
  - `relatoriosFiltros.test.js`
  - `agrupamentoPedidosDocumento.test.js`
  - `filtrosAoDigitar.test.js`
  - `padroesDeTela.test.js` (o "Agendar" saiu)
