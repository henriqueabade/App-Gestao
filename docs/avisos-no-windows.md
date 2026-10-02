# O programa no Windows, copiar tarefa e o corretor no botão direito

Data: 01/10/2026. Três pedidos do dono:

1. **Copiar uma tarefa:** abre a cópia em modo de edição, com o nome "… - cópia".
2. **Corrigir o texto pelo botão direito do mouse:** a palavra sublinhada mostra as sugestões.
3. **O programa no Windows:**
   - inicia com o Windows, em segundo plano (vem ligado na instalação);
   - desde o login, a máquina fica do último usuário que entrou. Isso vale mesmo depois de sair ou de a sessão vencer;
   - os avisos do sino aparecem no canto inferior direito da tela, numa janela com a cara do programa que **só fecha no X dela**;
   - com o programa na frente, só o sino, com o som "tum-tum" (ou o som que o dono puser em `src/assets`);
   - tudo pode ser desligado em Configurações;
   - o Sup Admin vê os computadores de cada usuário e cancela o de um deles (Usuários › editar › Computadores).

### Decisões do dono (01/10/2026, tarde)

| Pergunta | Decisão |
| --- | --- |
| Sair do programa (logout) continua recebendo os avisos? | Sim, como está. |
| Lista de computadores para cancelar o token? | Sim, com tabela nova (`sql/avisos_dispositivos.sql`). **Só o Sup Admin cancela**, em Usuários. |
| O X do programa (fechar a janela principal)? | **A — como está:** o programa vai para o ícone perto do relógio e os avisos continuam chegando. |
| A cópia da tarefa mantém a data? | Sim, a mesma da original. |
| O som? | O dono vai pôr o arquivo dele: `src/assets/som-aviso.mp3` (ou `.wav`/`.ogg`). Sem ele, o "tum-tum". |
| A janela do canto? | Com a identidade visual do programa e **persistente**: só fecha no X dela; não some sozinha nem ao perder o foco. |
| E com o programa na frente? | **Confirmado:** ela sai do caminho enquanto o programa está na frente e volta, com a mesma lista, quando ele sai. |

## 1. Copiar tarefa

- **Onde fica o botão:**
  - no editor da tarefa (rodapé, à esquerda), o botão **Copiar**;
  - na lista, o ícone de copiar, que aparece ao passar o mouse, junto de "Hoje / Amanhã / +1 sem".
- **O que acontece:** abre o editor de uma tarefa **nova**, com o selo "Cópia de “…”" e o título "… - cópia". Nada é gravado até "Criar tarefa".
- **O que a cópia leva:**
  - tudo o que se escolhe no editor (descrição, tipo, prioridade, data, hora, duração, lembrete, repetição, lista, marcadores, local, "ligada a");
  - o checklist, sem marcar;
  - quem participa (convidado de novo, menos quem recusou);
  - a ação no sistema.
- **O responsável** fica o mesmo para quem pode atribuir. Os outros criam a cópia para si.
- **Com alterações não salvas no editor,** a cópia leva o que está na tela e pergunta antes. A tarefa original fica como estava.
- **Só aparece** para quem pode criar tarefas.
- **Código:** `presetDaCopia` (pura) e `copiarTarefa` em `src/js/utils/tarefas-ui.js`.

## 2. Corretor no botão direito

- **Na palavra sublinhada em vermelho:** as sugestões (até 6), "Adicionar ao dicionário" e depois Desfazer/Refazer/Recortar/Copiar/Colar/Selecionar tudo.
- **Em qualquer campo de texto:** as opções de edição.
- **Num texto selecionado fora de campo:** Copiar.
- **Fora disso:** nenhum menu (as telas continuam como estão).
- **Corretor:** em português (pt-BR).
- **Conferido no Electron:** o botão direito em "mêses" sugere "meses".
- **A demora (02/10/2026):** em texto que **já estava** no campo (a descrição salva de uma tarefa), o corretor só confere o campo quando ele ganha o foco, e o clique com o botão direito que dá esse foco chegava antes da conferência. O menu abria sem a sugestão e só o 2º ou 3º clique a trazia (medido).
  - Agora, quando o clique acabou de trocar o campo ativo e não veio palavra marcada, o programa refaz o clique até 3 vezes, a cada 0,12 s.
  - Resultado medido: a sugestão vem no **primeiro** clique, em 0,13 a 0,25 s ("meses", "relatório"). Palavra certa: o menu normal em ~0,4 s. Campo em que você já estava digitando: na hora, como antes.
  - Continua o corretor do Windows em pt-BR: medido, ele marca e sugere em 0,1 a 0,3 s.
- **Código:** `backend/menuDeContexto.js` (`precisaReler`, `ligar`), ligado em toda janela pelo `main.js` (`browser-window-created`, antes do retorno das janelas com sandbox).

## 3. O programa no Windows

### O que a pessoa vê

- **Ao ligar o computador:** o programa abre sozinho, **sem janela**, só com o ícone perto do relógio.
  - Clicar no ícone (ou abrir pelo atalho) mostra o login ou o menu.
  - O menu do ícone tem: avisos no canto da tela, som, iniciar com o Windows e **Sair do programa**.
- **Fechar o programa** (o X, Alt+F4, Ctrl+W) **deixa ele na bandeja**, com os avisos ligados.
  - Na primeira vez, um balão explica onde ele ficou.
  - Para sair de vez: botão direito no ícone › Sair do programa.
- **Quando chega um aviso e o programa não está na frente,** aparece a janela no canto inferior direito. Ela:
  - tem a cara do programa: o fundo vinho do menu com o vidro dos modais, a faixa e os detalhes em dourado, o logo, o X vermelho e o "Abrir o programa" dourado (botão do padrão, 40 px, letra de 14 px);
  - mostra até 3 avisos (os mais novos em cima), com o título, a mensagem e o começo da nota, e "e mais N no sino";
  - fica sempre por cima, sem roubar o foco de quem está digitando em outro programa;
  - toca o som (o do dono ou o "tum-tum").
- **A janela é persistente — só o X dela fecha.** Não some sozinha, não fecha ao perder o foco:
  - **clicar num aviso** abre o programa e o aviso (sem sessão, abre depois do login). O aviso sai da janela e ela continua com os outros;
  - **"Abrir o programa"** abre e deixa a lista como está;
  - **aviso lido no sino** (ou "Marcar todas como lidas") sai da janela também;
  - **aviso novo** entra em cima, na mesma janela;
  - **sem nenhum aviso**, ela mostra "Tudo visto por aqui" e continua até o X;
  - **o X** fecha e esvazia: o que não foi aberto continua no sino, não lido. O próximo aviso abre a janela de novo, só com ele.
- **Com o programa na frente,** quem avisa é o sino (com o som). A janela do canto, se estiver aberta, **sai do caminho** (fica escondida, com a lista guardada) e **volta sozinha** quando o programa sai da frente (outro programa na frente, minimizado ou fechado para a bandeja). Assim ela não cobre os botões dos modais, que ficam no canto de baixo.
- **O som do dono:** o arquivo `src/assets/som-aviso.mp3` (ou `.wav`, ou `.ogg`; nessa ordem, se houver mais de um). Curto, de preferência até 3 segundos e menos de 500 KB; o programa para em 5 segundos. Sem o arquivo, ou se ele não tocar, vai o "tum-tum". Vale para a janela do canto e para o sino. Entra no instalador junto com o resto (`**/*`); para trocar, troque o arquivo e gere a versão nova.
- **As categorias do sino valem aqui também** (02/10/2026): o que está desmarcado em Configurações › Notificações (Tarefas e lembretes, Vendas e pedidos, Financeiro) não aparece na janela do canto; o interruptor geral desligado cala a janela. Os avisos do próprio cadastro sempre aparecem. Ver `docs/avisos-de-algo-seu.md` (8b).
- **O que chegou com o computador desligado** aparece quando ele liga.
- **Na primeira vez de cada usuário,** o histórico antigo não é despejado na tela.
- **Configurações › Programa no Windows:** três interruptores, que gravam na hora e valem para o computador:
  - iniciar com o Windows;
  - avisos no canto da tela;
  - som dos avisos.

  Desligar os avisos faz o computador esquecer o usuário e o token. Fora do programa instalado, "iniciar com o Windows" fica apagado.

### Como funciona depois de sair do programa

O token da sessão vence em 12 horas. No login, o programa pede à API um **segundo token, só dos avisos** (`escopo: avisos`):
- vale 90 dias e é renovado sozinho faltando 30, enquanto o computador continua perguntando;
- **só** lê os avisos e as tarefas abertas do próprio usuário, e só grava os lembretes/atrasos das tarefas dele;
- **o `authMiddleware` da API recusa esse token em todas as outras rotas;**
- usuário desativado deixa de receber;
- fica guardado **cifrado pelo Windows** (safeStorage) em `%APPDATA%\santissimo-decor\avisos-windows.json`. Sem a cifra, fica só na memória.

Outra pessoa que entra no mesmo computador passa a ser a dona dos avisos dele.

### Online, Ausente e Offline em Usuários (02/10/2026)

- **Online (verde):** a pessoa está com a sessão aberta no programa.
- **Ausente (amarelo):** sem sessão, mas o programa está **rodando** perto do relógio. O computador manda um sinal a cada 1 minuto pelos avisos do Windows (`avisos_dispositivos.ultimo_uso_em`).
- **Offline (vermelho):** o programa está fechado de verdade (sem sinal há mais de 3 minutos), ou o computador foi cancelado.
- Precisa da **API publicada**: é ela que grava o sinal a cada 1 minuto (antes, a cada 10).
- **Código:**
  - `SINAL_MS` em `avisos/dispositivo.js` (API) e `backend/avisosDoDispositivo.js` (cópia DEV);
  - `comSinalDoPrograma` em `backend/usuariosController.js` (`GET /api/usuarios/lista?presenca=1`);
  - `resolverPresenca` em `src/js/usuarios.js`.

### Os computadores de cada usuário (só o Sup Admin)

Com `sql/avisos_dispositivos.sql` rodado, cada computador que liga os avisos ganha uma linha em `avisos_dispositivos`: o nome do computador no Windows, o usuário do Windows, quando ligou, o último uso e, se for o caso, quando e por quem foi cancelado. O token do computador passa a levar o número dessa linha (`did`).

- **Usuários › editar › Computadores** (a aba só aparece para o Sup Admin; o servidor confere de novo): a lista dos computadores do usuário, os que recebem em cima e os cancelados embaixo, cada um com **Cancelar** (vermelho, com confirmação).
- **Cancelar corta na hora:** na próxima pergunta (até 20 s), a API responde 401 com `cancelado: true` e o computador **fica quieto**, mesmo reiniciando, sem tentar a sessão no lugar.
- **Volta a receber** quando a pessoa entra de novo no programa naquele computador (login ou entrada automática): nasce outra linha.
- **O mesmo computador** entrando de novo, sem ter sido cancelado, reaproveita a linha dele.
- **Excluir o usuário** apaga os computadores dele; "cancelado por" de quem foi excluído fica vazio.
- **Com a tabela, token antigo (sem `did`) não vale:** o programa pede outro sozinho na próxima vez que a sessão estiver aberta.
- **Sem a tabela** (SQL não rodado), tudo funciona como antes e a aba diz "Rode sql/avisos_dispositivos.sql e reinicie a API para ver os computadores."
- **Rotas do programa:** `GET /api/usuarios/:id/computadores` e `POST /api/usuarios/:id/computadores/:computadorId/cancelar` (`backend/usuariosController.js`, `exigirSupAdmin`).

**Antes de a API ser atualizada,** a rota nova não existe. Nesse caso, o computador usa a sessão do programa enquanto ela vale, pelo mesmo caminho do sino, e tenta o token de novo a cada 30 min.

**Os lembretes e atrasos das tarefas** nascem quando alguém pergunta. Antes só o sino perguntava; agora o computador também pergunta, a cada minuto. O cálculo é o mesmo do sino (`tarefasRegras.avisosDevidos`).

### Rotas novas na API (`Santissimo-db-API`)

`avisos/dispositivo.js` (+ teste `avisos/dispositivo.test.js`), ligado no `server.js`:

| Rota | Autenticação | O que faz |
| --- | --- | --- |
| `POST /avisos/dispositivo` | token da **sessão** | emite o token do computador (90 dias); o corpo `{ computador, usuario_windows }` registra o computador na lista |
| `GET /avisos/meus` | token do computador | os últimos 30 avisos (não dispensados), com o nome de quem fez; `token_novo` faltando 30 dias |
| `GET /avisos/tarefas` | token do computador | as tarefas abertas em que responde ou participa (aceito) |
| `POST /avisos/lembretes` | token do computador | grava os lembretes/atrasos calculados pelo programa: só do próprio usuário, só esses dois tipos, só de tarefa dele, uma vez cada chave |

Usa `usuarios`, `notificacoes` (com `chave` e `excluida_em`, do SQL de tarefas), `tarefas` e `tarefa_participantes`. **A lista de computadores precisa de `sql/avisos_dispositivos.sql`** (sem ele, os avisos funcionam, mas sem lista nem Cancelar). A API confere se a tabela existe a cada 10 minutos até achar.

**Em DEV,** a cópia `backend/avisosDoDispositivo.js` faz o papel da API contra o banco local. O token vale só enquanto o programa está aberto.

### Onde mora no programa

- `backend/preferenciasWindows.js`: as três preferências, todas ligadas de fábrica (`preferencias-windows.json`), e `arquivoDoSom` (qual `som-aviso.*` existe em `src/assets`).
- `backend/avisosNoWindows.js`: o serviço que pergunta a cada 20 s (token do computador ou sessão), gera os lembretes e decide o que é novo; manda o nome do computador ao pedir o token e fica quieto quando ele é cancelado.
- `backend/janelaDeAviso.js`: a janela do canto — `mostrar`, `retirar` (aberto/lido), `recolher`/`voltar` (programa na frente) e `fechar` (só o X, desligar os avisos ou sair). A página é `src/html/aviso-windows.html`, com `src/js/aviso-windows.js` e `src/styles/aviso-windows.css`.
- `src/js/utils/som-aviso.js`: o som do dono (`../assets/som-aviso.*`, até 5 s) ou o "tum-tum", gerado na hora (duas batidas, 392 Hz e 330 Hz).
- `backend/usuariosController.js` e `src/js/modals/usuario-editar.js` (aba Computadores): a lista e o Cancelar.
- **`main.js`:**
  - iniciar com o Windows (`setLoginItemSettings` com `--segundo-plano`, só no programa instalado);
  - a bandeja e fechar para a bandeja (`fecharOuSair`, `window-all-closed`);
  - abrir pelo atalho (`second-instance`);
  - o login e a entrada automática (`avisosAposEntrar`);
  - o relógio dos avisos;
  - a janela do canto sai do caminho com o menu na frente (`focus` → `recolher`; `blur`/`hide`/`minimize`/`closed` → `voltar`);
  - os canais `avisos-windows:*` (o `abrir` não fecha mais a janela; `lidos` tira da janela o que o sino leu).
- `preload.js`: `electronAPI.avisosWindows`.
- `src/js/notifications.js`: o som com o programa na frente; o aviso clicado na janela do canto abre no sino; o que o sino marca como lido sai da janela do canto.
- `build/installer.nsh`: desinstalar tira o "iniciar com o Windows" (na atualização, não).

## Conferido

- **Testes:**
  - API: `avisos/dispositivo.test.js` (7), mais os 14 de senha e webhook;
  - programa: `avisosNoWindows.test.js` (10), `programaNoWindows.test.js` (9, com um Electron de mentira para a janela persistente), `usuariosComputadores.test.js` (3), `menuDeContexto.test.js` (4), `tarefasUi.test.js` (cópia), `programaNoWindowsTela.test.js` (6), `redesSociaisClientes.test.js` (aba Computadores);
  - a bateria de tela: 1259 de 1260 (a falha é a antiga do logout).
- **Electron:** a janela do canto cheia, depois do clique num aviso e vazia ("Tudo visto por aqui"); a aba Computadores com o Cancelar; antes, o editor com Copiar e o corretor no botão direito.
- **Postgres descartável (porta 55432):** `sql/avisos_dispositivos.sql` duas vezes sem erro; o módulo de verdade dos tokens contra ele — registrar, reaproveitar, cancelar (401), o outro computador seguindo, token sem `did` recusado, entrar de novo, excluir usuário; e numa base sem a tabela, tudo como antes.
