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
  com som. Com o programa atrás, minimizado, na bandeja ou fechado, a
  mensagem vai para a **janela do canto do Windows** (a mesma dos avisos do
  sino; ver "Fase 2"). Com a janela do canto desligada, vai a notificação do
  Windows. Em "Ocupado", nada toca.
- **Não lidas**: o número vermelho do botão é o total. A linha "Novas
  mensagens" marca onde parou a leitura. Quem cria, entra ou chama alguém já
  leu o aviso da própria ação. Quem chega a um grupo ou canal vê o que havia
  antes, sem isso virar "não lida".

## Fase 2 (12/10/2026): arquivos, janela do canto e busca

### Arquivos e imagens

- **Como mandar:** pelo clipe, colando uma imagem (Ctrl+V) ou arrastando
  arquivos para a conversa. Os arquivos sobem na hora, com barra de
  progresso, e vão junto com a próxima mensagem. O texto pode ficar vazio.
- **Limites:** até 20 MB por arquivo e 10 por mensagem. Programas e scripts
  (`.exe`, `.bat`, `.ps1`, `.js`, `.lnk`…) são recusados antes de subir, e a
  API recusa de novo. A lista é a mesma nos dois lados, e o teste confere.
- **Ordem:** a mensagem mostra os arquivos na ordem em que a pessoa escolheu,
  e não na ordem em que terminaram de subir.
- **Imagens:** aparecem na conversa como miniatura (a API gera um webp de até
  480 px). Uma imagem fica inteira; duas ou mais viram quadrados.
  - Clicar abre o **visor**: a imagem grande, ← e → para as outras da
    conversa, "Abrir no Windows", "Salvar" e Esc para fechar.
  - SVG não aparece como imagem, porque pode levar script; vai como arquivo.
- **Outros arquivos:** aparecem como cartão com ícone, nome, tamanho, "Abrir"
  e "Salvar como…".
  - PDF abre no "Visualizar documento" do programa.
  - Os outros abrem no programa padrão do Windows (o mesmo caminho dos anexos
    do histórico).
- **Quem baixa:** só quem está na conversa.
  - O arquivo escolhido e ainda não enviado, só quem o escolheu.
  - O de mensagem apagada, ninguém; nem o nome dele aparece.
  - O Sup Admin fora da conversa também não.
  - A rota genérica não abre a tabela.
- **Guardados no banco** (`chat_anexos`):
  - o arquivo de mensagem enviada não se apaga nem muda (gatilho);
  - o escolhido e nunca enviado sai depois de 1 dia;
  - a API manda os arquivos com `nosniff` e CSP `sandbox`.
- **Sem o `sql/chat_anexos.sql`**, o chat continua funcionando, só sem
  arquivos. Subir um arquivo diz qual SQL rodar.
- **Validade de 1 ano** (pedido do dono, 12/10/2026; `sql/chat_anexos_validade.sql`):
  - **O que acontece:** 1 ano depois de subir, a API apaga o arquivo e a
    miniatura do banco, para não ocupar espaço. Ficam o nome e o tamanho.
  - **Quando a API limpa:** 2 minutos depois de ligar e depois de 6 em 6
    horas. O espaço volta a ser usado pelo banco (autovacuum).
  - **Antes da limpeza:** o vencido já não abre (a API responde "apagado").
  - **A linha debaixo da mensagem com arquivo:**
    - normal: "Arquivo guardado até 12/10/2027: o chat apaga os arquivos
      depois de 1 ano…";
    - faltando 30 dias ou menos, em amarelo: "Será apagado em 10 dias…";
    - depois: "Arquivo apagado: o chat guarda os arquivos por 1 ano…", e o
      arquivo aparece riscado ("Apagado · passou de 1 ano"), sem abrir nem
      salvar.
  - **Ao escolher arquivos:** a fila também avisa que eles ficam 1 ano.
  - **Trava do banco:** o gatilho só deixa um arquivo enviado perder os bytes
    depois da validade; nada mais muda nele.
  - **Sem esse SQL:** os arquivos funcionam sem validade, e a linha diz só
    que ficam 1 ano.

### Mensagens diretas na lista

A conversa direta só aparece em "Mensagens diretas" quando já tem mensagem
(pedido do dono, 12/10/2026). Clicar numa pessoa abre a conversa, que fica
na lista enquanto estiver aberta, para escrever a primeira. Saiu sem
escrever, ela some. A pessoa continua em "Pessoas", e do outro lado também
não aparece nada. Grupos e canais aparecem sempre.

### Janela do canto do Windows

As mensagens do chat aparecem na mesma janela do canto dos avisos do sino,
com um cartão por conversa. O cartão mostra:
- quem escreveu por último e onde ("Thiago Rocha em #produção");
- o texto;
- "3 mensagens novas · mencionaram você";
- o ícone vermelho de @ quando há menção.

Clicar abre o programa já na conversa. Ela entra na janela de dois jeitos:

- **Programa aberto** (atrás, minimizado ou na bandeja): o próprio chat
  manda a mensagem para a janela na hora.
- **Programa sem sessão** (saiu, a sessão venceu ou ligou com o Windows): o
  serviço da janela pergunta a cada 20 s pela rota `GET /avisos/chat`, com o
  token do aparelho (o mesmo dos avisos do sino). Da primeira vez, só marca o
  que já havia, sem despejar o histórico.

Seguem as mesmas regras do chat: conversa silenciada só com menção, e nada em
"Ocupado". A conversa lida (no programa ou em outro computador) sai da
janela.

### Busca nas mensagens

- **Onde:** o campo "Buscar pessoas e conversas", no alto da lista. Com 2
  letras ou mais, aparece primeiro **"Nas mensagens"**, com o trecho e o
  termo destacado.
- **O que acha:**
  - o texto, sem acento e sem diferença de maiúscula ("orcamento" acha
    "Orçamento");
  - o nome dos arquivos;
  - as menções a quem tem esse nome.
- **O que não acha:** as marcas internas, e nada das conversas em que a
  pessoa não está.
- **Só nesta conversa:** a lupa no topo da conversa limita a busca a ela. O
  "×" do selo volta a buscar em todas.
- **Clicar num achado** abre a conversa já na mensagem, destacada, mesmo que
  seja antiga: carrega as vizinhas dos dois lados.
  - Rolar para baixo carrega as seguintes.
  - "Ir para as mais recentes" volta ao fim.
  - Enquanto a tela está no meio da conversa, a conversa não é marcada como
    lida, e a mensagem nova que chega não se mistura.

## Teclas

| Tecla | O que faz |
| --- | --- |
| Enter | Envia |
| Shift+Enter | Quebra a linha |
| ↑ (caixa vazia) | Edita a sua última mensagem |
| Esc | Fecha a lista do @/#, cancela a resposta ou edição, ou fecha o painel |
| ↑ ↓ e Enter/Tab | Escolhem na lista do @ e do # |
| Ctrl+V | Cola uma imagem como arquivo |
| ← → / Esc (visor) | Imagem anterior ou próxima / fecha o visor |

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
- **Fase 2:**
  - `sql/chat_anexos.sql`: os arquivos.
  - API: `avisos/dispositivo.js` (`mensagensDoChat`, rota `/avisos/chat`).
  - Programa:
    - `backend/avisosDoDispositivo.js` (a mesma cópia);
    - `backend/avisosNoWindows.js` (o serviço pergunta pelo chat);
    - `backend/janelaDeAviso.js` (um cartão por conversa);
    - `main.js` (canais `avisos-windows:chat` e `avisos-windows:chat-ao-vivo`);
    - `src/js/aviso-windows.js` (os ícones).

## Para pôr no ar

1. Rodar `sql/chat_interno.sql` no banco.
2. Publicar a API nova e reiniciar.
3. Se houver nginx na frente da API, o `/chat/eventos` não pode ser
   segurado. A API já manda `X-Accel-Buffering: no` e um sinal a cada 25 s,
   então o `proxy_read_timeout` padrão (60 s) basta.
4. Publicar o programa.

**Fase 2:**
1. Rodar `sql/chat_anexos.sql` e depois `sql/chat_anexos_validade.sql`.
2. Publicar a API e reiniciar. A API precisa do `sharp`, que já está no
   `package.json` dela.
3. Publicar o programa.
4. Se houver nginx, o `client_max_body_size` tem de aceitar ao menos 21 MB
   no `/chat/`.

Enquanto o SQL ou a API nova não chegarem, o botão fica escondido para
todos. O Sup Admin vê o botão com o aviso do que falta e um "Tentar de novo".
O programa tenta sozinho a cada 2 minutos.

## Testes

- API:
  - `node --test chat/chat.test.js` (marcas, presença, ao vivo);
  - `node --test chat/arquivos.test.js` (nome, bloqueados, tipo, busca);
  - `node --test avisos/dispositivo.test.js` (`/avisos/chat`).
- Programa:
  - `backend/chatCopia.test.js`
  - `backend/chatReferencias.test.js` (permissões das citações)
  - `backend/chatProxy.test.js` (repasse, ao vivo em fluxo, arquivos em bytes)
  - `backend/avisosNoWindows.test.js` e `backend/programaNoWindows.test.js`
    (o chat na janela do canto)
  - `src/js/__tests__/chatInterno.test.js` (partes puras da tela)
- Integração e tela: roteiros no scratchpad da sessão de 12/10/2026, com a
  API de verdade contra um Postgres descartável e o programa no Electron sem
  janela.

## Para depois

- Respostas em fio (thread), como no ClickUp.
- Mensagem fixada no topo da conversa.
- Gravar áudio.
