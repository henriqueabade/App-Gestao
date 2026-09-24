# Tarefas e Calendário (CRM)

Pedido do dono em 18/09/2026: terminar os módulos **Tarefas** e **Calendário**
ligados a tudo o que o CRM já faz (clientes, prospecções, orçamentos, pedidos,
histórico social e sino). O banco muda: rodar `sql/tarefas_calendario.sql`
(depois de `sql/historico_social.sql`) e **reiniciar a API** (ver o fim).

Mapa do código:

| Parte | Onde |
| --- | --- |
| Regras puras (quem vê, quem mexe, recorrência, lembrete, atraso, "Meu dia", estatísticas) | `backend/tarefasRegras.js` |
| Operações que gravam (criar, convidar, concluir, cancelar, tarefas automáticas, eventos nas fichas) | `backend/tarefasServico.js` |
| Rotas `/api/tarefas` | `backend/tarefasController.js` |
| Componentes da tela (linha de tarefa, editor, concluir, criação rápida, feriados, .ics, "Meu dia", tarefas na ficha) | `src/js/utils/tarefas-ui.js` + `src/styles/tarefas-ui.css` (globais, carregados pelo `menu.html`) |
| Módulo Tarefas | `src/html/tarefas.html`, `src/js/tarefas.js`, `src/css/tarefas.css` |
| Módulo Calendário | `src/html/calendario.html`, `src/js/calendario.js`, `src/css/calendario.css` |
| Testes | `backend/tarefasRegras.test.js`, `backend/tarefasController.test.js`, `src/js/__tests__/tarefasUi.test.js` |

## 1. A tarefa

| Campo | Regra |
| --- | --- |
| Tipo | Tarefa, Ligação, E-mail, Reunião, WhatsApp, Visita, Proposta, Follow-up, Evento |
| Prioridade | Baixa, Média, Alta, Urgente |
| Situação | A fazer, Em andamento, Aguardando (as três colunas abertas do Quadro), Concluída, Cancelada |
| Quando | Data e hora opcionais (sem data = "Sem data"). Hora e data são as de **Brasília**, no servidor e na tela |
| Duração | Ocupa o bloco no calendário (Semana/Dia/Equipe) |
| Lembrete | Sem, na hora, 5/15/30 min, 1 ou 2 horas, 1 ou 2 dias antes. Sem hora, o lembrete conta a partir das 9h |
| Repetir | Todo dia, todo dia útil, toda semana (escolhendo os dias), todo mês (no dia N ou "2ª terça"), todo ano, a cada N... Ao concluir, nasce a próxima da série com o checklist zerado e os participantes que já tinham aceitado |
| Lista | Pessoal de cada usuário (cor e nome). Tarefa sem lista fica na "Caixa de entrada" |
| Marcadores | De todos (#vip, #obra...), com cor |
| Checklist | Itens com barra de progresso na linha da tarefa |
| Ligada a | Cliente, prospecção, orçamento ou pedido (busca única). Ligar a orçamento/pedido preenche o cliente dele, então a tarefa aparece também na ficha do cliente |
| Conversa e anexos | A mesma linha do tempo do histórico social (curtir, comentar, responder, anexos até 20 MB), origem `tarefa`, com o histórico de alterações da própria tarefa (`tarefa_historico`) |

**Exclusão é por marca** (`excluida_em`): nada sai do banco. Excluir: quem
criou, Admin e Sup Admin (e quem tem "Excluir tarefa" no modelo).

### Criação rápida (Tarefas › caixa do topo e calendário)

Uma linha só, com prévia em "chips" antes de criar:

| Escrevendo | Vira |
| --- | --- |
| `hoje`, `amanhã`, `segunda`...`domingo`, `em 3 dias`, `dia 25`, `25/09`, `semana que vem`, `mês que vem` | Data |
| `14h`, `14:30`, `às 9` | Hora |
| `por 30min`, `por 1h30` | Duração |
| `!` / `!!` | Alta / Urgente |
| `#vip` | Marcador (existente) |
| `~Obras` ou `~"Clientes VIP"` | Lista |
| `@Ana` | Convida a Ana (tarefa em conjunto) |
| Ligar, E-mail, Visita, Reunião, WhatsApp no começo | Tipo |

Enter cria; **Shift+Enter** abre o editor completo já preenchido.

## 2. Quem vê e quem mexe

Só vale para **tarefas e calendário**. Clientes e prospecções não mudaram.

| Quem | Vê | Cria/atribui |
| --- | --- | --- |
| Usuário comum | Só as próprias: as que criou, as de que é responsável e as em que aceitou convite | Só para si. Para trabalhar junto, **convida** |
| Com "Ver tarefas de outros usuários" | As próprias **+ as das pessoas que o Sup Admin escolheu** na ficha do usuário (aba "Tarefas e calendário": nenhuma, todas ou algumas) | Igual ao comum (a menos que tenha "Atribuir tarefa") |
| Admin e Sup Admin | Todas, de todos (nativo, sem depender do modelo) | Para qualquer um |

- Participante que **aceitou** edita e conclui. **Excluir** fica com quem criou e com o gestor.
- O servidor confere tudo de novo (`precisa(...)` no controller e `podeVerTarefa` / `podeMexerNaTarefa` / `conferirResponsavel` nas regras). Esconder botão é só conforto.

### Permissões (modelo de permissões › Tarefas)

| Ação | Coluna | Nasce |
| --- | --- | --- |
| Ver tarefas/agenda, Criar, Editar, Excluir, Atribuir, Ver calendário | já existiam | como estavam |
| Convidar para tarefa em conjunto | `acao_invite` | igual a "Criar tarefa" |
| Estatísticas | `acao_stats` | igual a "Ver" |
| Exportar para Google/Outlook | `acao_export` | igual a "Ver" |
| Ver tarefas de outros usuários | `acao_others_view` | **desligada** |
| Configurar tarefas automáticas | `acao_automations` | **desligada** |
| Cliente › Registrar atividade | `perm_cli.acao_interaction_add` | igual a "Editar cliente" |

## 3. Integração com o resto do CRM

| De onde | O que acontece |
| --- | --- |
| **Próximo passo da prospecção** | Vira uma tarefa-espelho (`origem = 'proximo_passo'`) com selo próprio **turquesa** ("Próximo passo"). Mudar o passo muda a tarefa e vice-versa. **Concluir** a tarefa — de qualquer lugar: ficha, lista, Quadro, calendário, até o Shift+clique — abre o **"Concluir passo planejado"** da prospecção, que cobra o que aconteceu, com quem, o rumo no funil e o próximo passo; o backend conclui a tarefa junto. O SQL converte os passos já combinados |
| **Ficha da prospecção** | Caixa de tarefas ligadas (abrir, concluir, agendar nova) |
| **Ficha do cliente › aba Atividades** (nova) | Registrar atividade feita (ligação, e-mail, reunião, visita, WhatsApp...) e agendar tarefa com prazo; lista as tarefas ligadas ao cliente |
| **Atividade = o que já aconteceu** | No cliente e na prospecção, registrar atividade é registrar algo **já feito**: o campo "Quando aconteceu" não passa de agora, a atividade entra como **concluída** (selo verde) e o servidor recusa data no futuro (5 min de folga para o relógio — `quandoAconteceu` em `backend/tarefasRegras.js`). O "Concluir passo planejado" segue a mesma regra. Algo futuro é tarefa ou próximo passo |
| **Histórico social da ficha** | "Henrique adicionou a tarefa…", "…concluiu a tarefa…" (com o resultado) entram no histórico do cliente/prospecção |
| **Concluir** | Pede o resultado (Feito, Falou com o cliente, Não atendeu, Pediu retorno...) e uma nota. Tarefa ligada a cliente/prospecção vira **atividade** da ficha. Opção "Concluir e agendar a próxima" |
| **Calendário** | Camadas: tarefas, atividades feitas (as registradas à mão; as que nasceram de tarefa aparecem como a tarefa concluída), marcos do histórico com data (mudança de etapa do funil, orçamento, conversão, arquivamento) e feriados |

### Tarefas automáticas (Tarefas › Automáticas e Configurações › Tarefas automáticas)

| Gatilho | Tarefa | Para quem | Permissão da regra |
| --- | --- | --- | --- |
| Orçamento sai do rascunho (Pendente) | "Follow-up do orçamento {orcamento} — {cliente}", em 3 dias, alta | Quem enviou | Enviar orçamento |
| Prospecção convertida em cliente | "Ligação de boas-vindas — {cliente}", em 1 dia | O responsável | Ver prospecções |
| Pedido marcado como Entregue | "Pós-venda do pedido {pedido} — {cliente}", em 7 dias | O dono do cliente | Ver pedidos |
| Comissões da competência fechadas | "Confirmar o pagamento das comissões de {competencia}", no dia do "pagar até" | Quem fechou | Confirmar pagamento |
| Produção da competência fechada | "Confirmar o pagamento da produção de {competencia}", no dia do "pagar até" | Quem fechou | Confirmar pagamento |

Não duplica: um índice único por gatilho + registro segura o segundo disparo.

**Decisões do dono (24/09/2026):**

- **Cada regra está ligada a uma permissão** (tabela acima, em
  `backend/tarefasAutomaticas.js`). Só quem vê Tarefas e tem a permissão da
  regra a enxerga nas telas **e recebe a tarefa** — senão chegaria uma tarefa
  que a pessoa não consegue desligar. Admin e Sup Admin têm todas.
- **Cada pessoa desliga a regra só para si**: interruptor "Receber esta
  tarefa" em Tarefas › Automáticas (que agora abre para todos que veem
  Tarefas) e em Configurações › Tarefas automáticas. Ligada por padrão
  (sem linha em `tarefa_automacao_usuarios` = ligada). Quem tem "Configurar
  tarefas automáticas" continua ajustando a regra para todos (ligada, título,
  prazo, tipo, prioridade).
- **Toda tarefa automática avisa** quem a recebeu, no sino e no Windows —
  mesmo quando foi a própria pessoa que fez a ação: aviso
  `tarefa_automatica`, "Tarefa automática criada", com o que aconteceu, a
  tarefa e o prazo, e a dica pequena "Pode ser desativada em Tarefas ou em
  Configurações." Substitui o "Nova tarefa para você" dessas tarefas.
- **Competência fechada**: a tarefa só nasce se quem fechou pode "Confirmar
  pagamento" e se há valor a pagar. O prazo das duas regras novas é a
  **antecedência** em dias antes do "pagar até" (0 = no próprio dia; se o dia
  já passou, a tarefa nasce atrasada). Ela vem com a ação "Confirmar o
  pagamento das comissões/da produção (até quitar)": conclui sozinha quando a
  competência fica **toda** paga — o pagamento por beneficiário deixa a tarefa
  aberta até o último.

Banco: `sql/tarefas_automaticas_por_usuario.sql` (tabela das preferências e
as 2 regras novas). Rotas: `GET /api/tarefas/automacoes` (as regras que eu
posso receber), `PUT /api/tarefas/automacoes/:chave/minha` e
`PUT /api/tarefas/automacoes/:chave`.

### Ação no sistema: a tarefa que cobra algo de outro módulo (2ª rodada, 18/09)

No editor, **Ação no sistema** (opcional): escolhe-se o **módulo**, o
**registro** (busca do pedido/orçamento/prospecção/cliente, ou o **mês** no
Financeiro) e a **ação**. A lista só libera o que o **responsável** pode fazer
(o servidor confere de novo e recusa); o registro vira também o vínculo da
tarefa. Quando a ação acontece no módulo — **por qualquer pessoa** (decisão do
dono) —, a tarefa **conclui sozinha**, com a nota "Feito no módulo Pedidos:
João despachou o pedido (PED-40 — Loja Boa)", a atividade na ficha, a próxima
da série e o aviso `acao_concluida` para quem acompanha. Na tarefa, **Fazer
agora** abre o registro no módulo.

| Módulo | Ações |
| --- | --- |
| Pedidos | Confirmar (Produção), Despachar (Enviado), Dar como entregue, Emitir NF-e (só autorizada; vale a autorizada depois, ao sincronizar), Gerar boletos, Registrar recebimento, Registrar produção, Alterar pagamento, Ajustar datas, Registrar devolução |
| Orçamentos | Enviar (sair do rascunho), Converter em pedido (Aprovado), Retorno: rejeitado |
| Prospecções | Mover no funil (inclusive pelo "Concluir passo" com etapa), Converter em cliente, Registrar atividade, Registrar campanha |
| Clientes | Registrar atividade, Atualizar o cadastro |
| Financeiro (competência) | Fechar comissões, Fechar produção, Confirmar pagamento, Confirmar o pagamento das comissões / da produção (até quitar) |

Como se percebe: cada ação do catálogo (`backend/tarefasAcoes.js`) diz a rota
do servidor local que a executa (método + caminho + condição no corpo/na
resposta). O vigia `observar`, montado no `server.js` antes das rotas,
espera a resposta sair com sucesso e só então procura as tarefas
(`concluirPelaAcao` no controller). **Ação nova é uma linha no catálogo.**
Produtos e Matéria-prima ficaram de fora: essas telas gravam direto na API,
sem passar pelo servidor local.

## 4. Sino, convites e lembretes

- **Convite**: quem é convidado recebe no sino, com **Aceitar / Recusar** ali mesmo. Se apagar o aviso, o convite continua em **Tarefas › Convites**. Recusar avisa quem convidou.
- **Lembrete**: na hora escolhida, no sino e como **notificação do Windows** (uma vez).
- **Atrasada**: aviso no sino **uma vez por dia** enquanto estiver atrasada.
- O sino pergunta a cada **10 segundos**; tudo o que chega vai também para a **notificação do Windows**, menos curtida (fica só no sino).
- Os lembretes e atrasos nascem no servidor quando o sino pede (`POST /api/tarefas/avisos`, a cada 30 s) e não se repetem (`notificacoes.chave` única por usuário).
- Menção (`@`) no histórico gera o aviso `mencao` ("mencionou você"); tarefa concluída pelo módulo, `acao_concluida`.
- Aviso dispensado fica marcado (`excluida_em`), não é apagado.

## 5. As telas

**Tarefas**: lateral com Caixa de entrada, Hoje, Próximos 7 dias, Atrasadas,
Sem data, Todas abertas, Concluídas; Em conjunto (Convites, Em conjunto,
Delegadas por mim); Minhas listas; Marcadores. Visões **Lista** (agrupada) e
**Quadro** (arrastar entre colunas muda a situação). Busca, filtro de pessoa
(quem pode ver outros), ordem (prazo, prioridade, mais recentes, título), Estatísticas e
Automáticas.

**Calendário**: visões **Mês, Semana, Dia, Agenda** e **Equipe** (uma
coluna por pessoa; só para quem vê outros). Mini-mês com pontos nos dias com
coisa, camadas liga/desliga, "Mostrar concluídas", listas. Os **números** ao
lado das camadas contam o período da visão: o mês inteiro (sem as pontas de
outros meses), a semana, o dia ou os 30 dias da agenda (o rótulo diz qual).
**Zoom** da grade de horas (Semana, Dia, Equipe): **Ctrl + rolar** (ou − +
na barra) vai de 1 h até 15 min por linha, mantendo parado o horário sob o
mouse; de perto, arrastar anda de 5 em 5 min. O zoom fica salvo e a grade
não volta para as 7h a cada gesto. Arrastar muda dia
e hora; puxar a borda de baixo muda a duração; clicar num horário vazio cria
ali. Feriados nacionais, pontos facultativos e, para Belo Horizonte
(município da Configuração fiscal), os municipais. **Google / Outlook**:
baixa um `.ics` (o que está na tela, os próximos 90 dias ou todas as abertas)
para importar.

**Dashboard**: o cartão **"Meu dia"** (para hoje, atrasadas, feitas hoje,
convites e a próxima com hora) leva direto ao filtro certo em Tarefas.

### Atalhos (`?` mostra a lista na tela)

| Tarefas | | Calendário | |
| --- | --- | --- | --- |
| `N` | criação rápida | `N` | nova tarefa no dia em foco |
| `Shift+N` | editor completo | `T` | hoje |
| `/` | buscar | `←` `→` | anterior / próximo |
| `1` / `2` | Lista / Quadro | `M` `S` `D` `A` `E` | Mês, Semana, Dia, Agenda, Equipe |
| | | `Ctrl` + rolar | zoom da grade de horas |

## 6. Banco (`sql/tarefas_calendario.sql`)

Tabelas novas: `tarefa_listas`, `tarefa_marcadores`, `tarefas`,
`tarefa_participantes`, `tarefa_checklist`, `tarefa_historico`,
`cliente_interacoes`, `tarefa_visibilidade`, `tarefa_automacoes` (com as 3
automações). Colunas novas: `prospeccao_interacoes.tarefa_id`,
`notificacoes.chave` e `notificacoes.excluida_em`, as permissões da seção 2.
Também libera a origem `tarefa` no histórico social e a ação "alterou" nos
históricos de cliente e prospecção.

Pode rodar mais de uma vez (tudo idempotente). Depois de rodar, **reiniciar a
API**: ela só lê a lista de tabelas na partida. Enquanto o SQL não roda, as
telas mostram o aviso "rode sql/tarefas_calendario.sql" em vez de quebrar.

**2ª rodada: `sql/tarefas_acoes.sql`** — colunas `tarefas.acao_chave`,
`acao_registro` e `acao_rotulo` e o índice `idx_tarefas_acao`. Depois de
rodar, reiniciar a API de novo.

## 7. Armadilhas

- **Express 5**: as rotas fixas (`/automacoes`, `/listas`, `/visibilidade`...) ficam **antes** de `/:id` no controller, senão `/:id` as engole.
- **`h(..., { style })`** do `tarefas-ui.js` aceita variável CSS (`'--x'`) — vai por `setProperty`; `Object.assign(el.style)` ignora variáveis.
- **FontAwesome 6.0.0** do app não tem `fa-people-group`: usar `fa-users`.
- O título global `.module-header__title` tem cor clara fixa; no tema claro o módulo corrige com seletor próprio (`.cal-cabecalho .module-header__title`).
- Notificação do Windows precisa do `app.setAppUserModelId('com.santissimo.decor')` do `main.js` (só vale depois de reiniciar o app).
- **`querySelectorAll('[data-visao]')`** pegava também o `.cal-area` (que marca a visão): use `.cal-visoes [data-visao]`.
- **`requestAnimationFrame` não roda com a janela escondida**: rolagem que precisa acontecer ao redesenhar vai direto (a grade já está na tela).
- Módulos embrulhados numa IIFE pelo `menu.js` só são alcançáveis pelo que publicam em `window` (`PedidosModulo`, `OrcamentosModulo`, `ProspeccoesModulo`, `ClientesModulo`).
