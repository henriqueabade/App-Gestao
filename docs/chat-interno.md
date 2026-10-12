# Chat interno

Pedido do dono em 12/10/2026: um chat interno "como o do ClickUp", com a cara
da Santíssimo Decor. Fica no botão redondo do canto inferior direito, em
qualquer tela. Tudo é restrito ao que o perfil de cada pessoa pode ver.

## O que tem

- **Conversas diretas**: uma pessoa com outra. Só as duas leem.
- **Grupos**: conversa fechada. Quem está dentro chama mais gente. Quem cria
  é o administrador.
- **Canais**: abertos a toda a empresa. Qualquer pessoa acha o canal em
  "Explorar canais" e entra. O nome é único.
- **Ao vivo**: mensagens, "digitando…", "Visto" (na direta), reações, edições,
  quem entrou ou saiu e a presença chegam na hora.
- **Presença** de cada pessoa:

  | Estado | Quando | Cor |
  | --- | --- | --- |
  | Online | O programa está aberto e a pessoa mexe nele. | verde |
  | Ausente | Parada há 5 minutos, ou escolheu "Ausente", ou o programa roda só perto do relógio, sem sessão. | amarelo |
  | Ocupado | Escolheu "Ocupado" (não perturbe). | vermelho com traço |
  | Offline | Programa fechado, ou escolheu "Invisível". Mostra "visto há…". | anel cinza |

- **Status escolhido** (clique no próprio nome, no alto da lista):
  Disponível, Ocupado, Ausente ou Invisível, com um recado de até 120 letras
  (por exemplo, "Em reunião até as 15h").
- **@ menciona** alguém da conversa. A pessoa recebe aviso no sino, mesmo
  com a conversa silenciada. Clicar no aviso abre o chat já na conversa.
- **# cita** tarefa, cliente, prospecção, contato, pedido, orçamento ou
  produto. Clicar na citação abre a ficha, pelo mesmo caminho do sino. Regras:
  - ao buscar, aparecem só os tipos que o perfil de quem escreve vê; nas
    tarefas, só as que a pessoa vê pela regra das Tarefas;
  - ao ler, cada um vê o nome só se o perfil dele deixar. Sem a permissão,
    aparece "Pedido (sem acesso)", e o nome não sai do programa;
  - a mensagem guarda só a marca `[[#pedido:900]]`, nunca o nome.
- **Responder**, **reagir** (👍 ❤️ 😂 😮 😢 🙏 ✅ 👀 🎉 🔥 👏 💯), **editar** a
  própria mensagem (fica "(editada)", e o texto anterior é guardado) e
  **apagar** a própria (fica "Mensagem apagada"). O Sup Admin também apaga a
  dos outros, mas **não lê** as conversas em que não está.
- **Silenciar** e **fixar** cada conversa. A conversa silenciada não toca nem
  avisa, e conta no botão só as menções.
- **Avisos**: com o programa na frente, aparece um cartão acima do botão,
  com som. Com o programa atrás, aparece a notificação do Windows. Em
  "Ocupado", nada toca.
- **Não lidas**: o número vermelho do botão é o total. A linha "Novas
  mensagens" marca onde parou a leitura. Quem cria, entra ou chama alguém já
  leu o aviso da própria ação. Quem chega a um grupo ou canal vê o que havia
  antes, sem isso virar "não lida".

## Teclas

| Tecla | O que faz |
| --- | --- |
| Enter | Envia |
| Shift+Enter | Quebra a linha |
| ↑ (caixa vazia) | Edita a sua última mensagem |
| Esc | Fecha a lista do @/#, cancela a resposta ou edição, ou fecha o painel |
| ↑ ↓ e Enter/Tab | Escolhem na lista do @ e do # |

## Onde mora

**API (Santissimo-db-API):**

- `chat/chat.js`: as regras e o SQL.
- `chat/presenca.js`: Online, Ausente, Ocupado e Offline, guardados na memória.
- `chat/eventos.js`: o ao vivo (Server-Sent Events).
- `chat/rotas.js`: as rotas `/chat/*`.
- As tabelas `chat_*` ficam fechadas na rota genérica `/api/:tabela`, para
  ninguém, nem o Sup Admin.

**Programa (App-Gestão):**

- `backend/chatController.js`: `/api/chat`. Repassa tudo à API com o token
  da sessão (o `/eventos` passa em fluxo). Com `BANCO=DEV`, roda as mesmas
  rotas contra o banco local.
- `backend/chat/`: cópia idêntica da pasta `chat/` da API, usada no DEV.
  Mudou lá, rode `node scripts/copiar-chat-da-api.js`. O teste
  `backend/chatCopia.test.js` avisa se ficar diferente.
- `backend/chatReferencias.js`: as citações com # (buscar e resolver), com as
  permissões de quem pede.
- `src/js/utils/chat.js` e `src/styles/chat.css`: a tela.
- `sql/chat_interno.sql`: as tabelas. As mensagens não se apagam de verdade
  (um gatilho bloqueia; fica `apagada_em`), e o histórico de edições não se
  altera.

## Para pôr no ar

1. Rodar `sql/chat_interno.sql` no banco.
2. Publicar a API nova e reiniciar.
3. Se houver nginx na frente da API, o `/chat/eventos` não pode ser
   segurado. A API já manda `X-Accel-Buffering: no` e um sinal a cada 25 s,
   então o `proxy_read_timeout` padrão (60 s) basta.
4. Publicar o programa.

Enquanto o SQL ou a API nova não chegarem, o botão fica escondido para
todos. O Sup Admin vê o botão com o aviso do que falta e um "Tentar de novo".
O programa tenta sozinho a cada 2 minutos.

## Testes

- API: `node --test chat/chat.test.js` (marcas, presença, ao vivo).
- Programa:
  - `backend/chatCopia.test.js`
  - `backend/chatReferencias.test.js` (permissões das citações)
  - `backend/chatProxy.test.js` (repasse e ao vivo em fluxo)
  - `src/js/__tests__/chatInterno.test.js` (partes puras da tela)
- Integração e tela: roteiros no scratchpad da sessão de 12/10/2026, com a
  API de verdade contra um Postgres descartável e o programa no Electron sem
  janela.

## Para depois

- Anexos (arquivo e imagem) nas mensagens.
- Aviso do chat na janela do canto do Windows (programa fechado, só na bandeja).
- Busca dentro das mensagens.
