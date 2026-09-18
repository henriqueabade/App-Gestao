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
| **Próximo passo da prospecção** | Vira uma tarefa-espelho (`origem = 'proximo_passo'`). Mudar o passo muda a tarefa e vice-versa; concluir a tarefa conclui o passo (e registra a atividade). O SQL converte os passos já combinados |
| **Ficha da prospecção** | Caixa de tarefas ligadas (abrir, concluir, agendar nova) |
| **Ficha do cliente › aba Atividades** (nova) | Registrar atividade feita (ligação, e-mail, reunião, visita, WhatsApp...) e agendar tarefa com prazo; lista as tarefas ligadas ao cliente |
| **Histórico social da ficha** | "Henrique adicionou a tarefa…", "…concluiu a tarefa…" (com o resultado) entram no histórico do cliente/prospecção |
| **Concluir** | Pede o resultado (Feito, Falou com o cliente, Não atendeu, Pediu retorno...) e uma nota. Tarefa ligada a cliente/prospecção vira **atividade** da ficha. Opção "Concluir e agendar a próxima" |
| **Calendário** | Camadas: tarefas, atividades feitas (as registradas à mão; as que nasceram de tarefa aparecem como a tarefa concluída), marcos do histórico com data (mudança de etapa do funil, orçamento, conversão, arquivamento) e feriados |

### Tarefas automáticas (Tarefas › Automáticas; liga/desliga e ajusta)

| Gatilho | Tarefa | Para quem |
| --- | --- | --- |
| Orçamento sai do rascunho (Pendente) | "Follow-up do orçamento {orcamento} — {cliente}", em 3 dias, alta | Quem enviou |
| Prospecção convertida em cliente | "Ligação de boas-vindas — {cliente}", em 1 dia | O responsável |
| Pedido marcado como Entregue | "Pós-venda do pedido {pedido} — {cliente}", em 7 dias | O dono do cliente |

Não duplica: um índice único por gatilho + registro segura o segundo disparo.

## 4. Sino, convites e lembretes

- **Convite**: quem é convidado recebe no sino, com **Aceitar / Recusar** ali mesmo. Se apagar o aviso, o convite continua em **Tarefas › Convites**. Recusar avisa quem convidou.
- **Lembrete**: na hora escolhida, no sino e como **notificação do Windows** (uma vez).
- **Atrasada**: aviso no sino **uma vez por dia** enquanto estiver atrasada.
- Os avisos nascem no servidor quando o sino pergunta (`POST /api/tarefas/avisos`, a cada minuto) e não se repetem (`notificacoes.chave` única por usuário).
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
coisa, camadas liga/desliga, "Mostrar concluídas", listas. Arrastar muda dia
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

## 7. Armadilhas

- **Express 5**: as rotas fixas (`/automacoes`, `/listas`, `/visibilidade`...) ficam **antes** de `/:id` no controller, senão `/:id` as engole.
- **`h(..., { style })`** do `tarefas-ui.js` aceita variável CSS (`'--x'`) — vai por `setProperty`; `Object.assign(el.style)` ignora variáveis.
- **FontAwesome 6.0.0** do app não tem `fa-people-group`: usar `fa-users`.
- O título global `.module-header__title` tem cor clara fixa; no tema claro o módulo corrige com seletor próprio (`.cal-cabecalho .module-header__title`).
- Notificação do Windows precisa do `app.setAppUserModelId('com.santissimo.decor')` do `main.js` (só vale depois de reiniciar o app).
