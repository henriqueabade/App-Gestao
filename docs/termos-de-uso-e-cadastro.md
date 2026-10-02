# Termos de Uso, Política de Privacidade, cadastro e bloqueio de login

Pedido do dono em 02/10/2026. Quatro frentes na mesma rodada:

1. todo usuário aceita os **Termos de Uso** e a **Política de Privacidade**
   (no cadastro; e, para quem já existia, quando o Sup Admin pedir);
2. o **cadastro pela tela de login** passa a funcionar em produção, com
   e-mail de confirmação e espera pela liberação do Sup Admin;
3. **login bloqueado** para todo status diferente de ativo, com o mesmo
   recado em amarelo;
4. o **menu** não mostra mais, nem por um instante, os módulos que o usuário
   não pode abrir — e as rotas de usuários ganharam as travas que faltavam.

## O que precisa ser feito para valer

| Onde | O quê |
| --- | --- |
| Banco (produção e local) | rodar `sql/usuarios_termos.sql` (pode rodar mais de uma vez) |
| API (Santissimo-db-API) | publicar `cadastro/`, `acesso/`, `senha/email.js` e `server.js`, e **reiniciar** |
| Programa | publicar a versão nova |

Ordem: SQL → API → programa. Sem o SQL (ou sem reiniciar a API) nada grava no
vazio: a coluna Termos mostra "—", o botão de pedir o aceite fica desligado
com a explicação, o aceite responde 409 e o cadastro responde 503, todos
dizendo o que falta.

A primeira sessão aberta com a versão nova do programa guarda o texto dos
documentos no banco (`termos_versoes`). É isso que libera o cadastro da tela
de login: ele é anônimo e só aceita versão de documento que já esteja lá.

## Os documentos

- O texto mora **só** em `src/js/utils/termos-documentos.js` (a tela de login,
  a caixa dentro do programa e o backend leem o mesmo arquivo).
- Cada documento tem `versao` e `vigencia`. **Mudou o texto, mude a versão.**
  Com versão nova, todo mundo volta a "Pendente" em Usuários e o Sup Admin
  pede o aceite de novo. Versão igual com texto diferente é recusada
  (o banco guarda a impressão digital — sha256 — do texto de cada versão).
- Dados do controlador no topo do arquivo (`CONTROLADOR`): razão social, CNPJ
  e o e-mail de contato para os direitos do titular.

**Para o dono conferir com a assessoria jurídica antes de valer para todos:**
o texto foi escrito para descrever o que o programa faz de verdade (registro
de autoria, presença, avisos no sino/Windows/e-mail, computadores, IA,
compartilhamento, prazos, direitos do art. 18), com as bases legais do art. 7º
da LGPD. Faltam decisões que são da empresa: endereço da sede, quem responde
pelo canal de privacidade (encarregado, se houver) e a redação final.

## Onde o aceite acontece

### No cadastro (tela de login › Cadastrar)

Duas caixas: "Li e aceito os **Termos de Uso**" e "Li e aceito a **Política de
Privacidade**". Clicar na caixa ou no nome abre o documento num modal com
rolagem; o botão "Li e aceito" só libera depois de rolar até o fim, e é ele
que marca a caixa (a caixa não marca sozinha). Sem as duas, o cadastro não
sai — a tela avisa e o backend confere de novo.

### Para quem já existia (ou foi criado pelo administrador)

- **Usuários › coluna Termos** (depois de Status): `Aceito` em verde quando a
  pessoa aceitou a versão vigente dos dois documentos; `Pendente` em vermelho
  no resto. A dica da etiqueta diz quando aceitou, quando o aceite foi pedido
  e se houve recusa.
- **Botão dos termos em Ações**, à esquerda do Editar (ícone de documento
  assinado): só o Sup Admin aciona e só com os termos pendentes. Pede
  confirmação e marca o usuário (`termos_solicitados_em`).
- **A caixa obrigatória**: ao entrar (login, entrada automática ou voltando do
  segundo plano) o programa pergunta ao backend se há aceite pedido. Havendo,
  a caixa aparece **antes de qualquer módulo**, com o motivo no cabeçalho, as
  duas caixas de aceite e dois botões: Recusar e Aceitar e continuar. Não tem
  X, o Esc não fecha, fechada à força ela volta, e enquanto está na tela o
  backend local responde 423 a todo o resto. Com o programa já aberto, a
  conferência se repete ao voltar para a frente e a cada minuto.
- **Aceitar**: grava e libera. **Recusar** (com confirmação): desativa o
  acesso (`aguardando_aprovacao` = Inativo; a conta não é excluída), leva para
  a tela de login com o aviso "Usuário Desativado" e avisa os outros Sup
  Admins no sino. O pedido continua de pé: reativada pelo administrador, a
  pessoa vê a caixa de novo ao entrar. O único Sup Admin ativo não consegue
  recusar (ninguém poderia reativá-lo).

## O que fica guardado (a prova do aceite)

`sql/usuarios_termos.sql`:

| Tabela / coluna | Para quê |
| --- | --- |
| `termos_versoes` | o texto exato de cada versão, com o sha256 |
| `usuarios_termos_aceites` | cada aceite **ou recusa**: uma linha por documento, com usuário (id, nome e e-mail copiados), versão, sha256 do texto, origem (`cadastro` ou `solicitacao`), quem pediu, computador, versão do programa, IP (visto pelo servidor) e a hora do banco |
| `usuarios.termos_versao`, `privacidade_versao`, `termos_aceitos_em` | o resumo que a tela usa |
| `usuarios.termos_solicitados_em/_por`, `termos_recusados_em` | o pedido do Sup Admin e a recusa |
| `usuarios_confirmacoes` | o link de confirmação do e-mail (só o sha256; 48 horas; uma vez) |

As duas primeiras tabelas só recebem linhas novas: um gatilho do banco recusa
alterar ou apagar. O registro do aceite não tem chave para `usuarios` de
propósito — continua existindo se o usuário for excluído. Pela API genérica,
só o próprio usuário grava o aceite dele.

## Cadastro pela tela de login

**Como estava:** o programa gravava direto em `/api/usuarios`, rota que exige
token. Sem sessão aberta o cadastro falhava; nenhum e-mail de confirmação era
enviado (a função existia e nunca era chamada); e o link do e-mail apontaria
para uma rota que a API não tem.

**Como ficou** (mesmo molde do "Esqueceu a senha?"):

1. `POST /cadastro` (pública) — usuário nasce `nao_confirmado`, com a senha em
   bcrypt e o aceite gravado; sai o e-mail **Confirme o seu cadastro**.
2. `GET /cadastro/confirmar?token=` — o link do e-mail abre uma página da
   API. O status passa a `aguardando_aprovacao` (aparece como **Inativo** em
   Usuários, com a tomada pronta para ativar). **Confirmar não libera a
   entrada.** Os Sup Admins ativos são avisados no sino e por e-mail.
3. O Sup Admin define o perfil em Editar e ativa o acesso (tomada ou Editar).
   O usuário recebe o e-mail **Seu acesso foi liberado** (`POST
   /cadastro/liberado`, pedido pelo programa).
4. `GET /cadastro/nao-reconheco?token=` — "Não fui eu": o link morre e os Sup
   Admins são avisados.

Limites: um cadastro por minuto por e-mail e cinco em dez minutos por
computador; e-mail já cadastrado responde 409. Se o e-mail não sair (SMTP), o
cadastro fica gravado e a tela diz para procurar o administrador.

Arquivos: `Santissimo-db-API/cadastro/cadastro.js` (regra), `cadastro/email.js`
(os quatro e-mails, no visual dos outros), e a cópia idêntica
`backend/cadastroPublico.js` para o banco DEV (`backend/cadastroLocal.js` liga
ao PostgreSQL local; o link aparece no terminal). Mudou um, mude o outro.

## Login bloqueado

Quem acerta e-mail e senha mas não está **ativo** — não confirmado, esperando
o administrador, desativado ou que recusou os termos — vê o recado em amarelo
**"Login bloqueado. Contate o administrador."** (o mesmo para todos).

- Na API (`acesso/status.js`): o `/login` responde 403 **sem emitir token**, e
  o `authMiddleware` recusa o token de quem deixou de estar ativo (confere no
  banco no máximo a cada 30 segundos por usuário; alteração do cadastro pela
  API vale na hora). Antes, a API entregava o token a qualquer senha certa.
- No programa: continua conferindo o status depois do login (vale com a API
  antiga), e a sessão aberta de quem foi desativado cai com o aviso de acesso
  revogado.

## Menu e permissões

**O clarão do Ctrl+R:** o menu vinha inteiro no HTML e os módulos proibidos
eram escondidos depois que as permissões chegavam; se a consulta falhasse,
ficava tudo à mostra ("para não travar o app").

**Agora:** o menu nasce escondido (`menu.css`) e cada módulo só aparece quando
o `permissoes.js` põe a marca `data-perm-liberado`. Sem as permissões na mão
— carregando, API fora, falha — nenhum módulo aparece e nenhum abre; a carga
insiste (3 tentativas) e volta a tentar sozinha a cada 5 segundos, com um
quadro de espera no lugar do módulo. O `loadPage` espera as permissões antes
de buscar o HTML do módulo. Grupo (CRM, Laminação) sem módulo liberado some
junto. Quem não pode abrir o Dashboard cai no primeiro módulo permitido (antes
a tela ficava parada em "Carregando").

**Travas que faltavam no backend** (`usuariosController.js`,
`permissionsController.js`):

- `/lista`, `/me` e `/:id` devolviam o hash da senha e os tokens de todo
  mundo para a tela, em produção. Agora a resposta é limpa em todas as rotas
  de usuários.
- `/lista` para quem não tem o módulo Usuários (nem Relatórios) traz só o que
  os seletores de dono/responsável precisam (id, nome, e-mail, perfil, status,
  foto).
- Ativar/desativar exige `usuarios.status.toggle`; editar, `usuarios.edit`;
  excluir, modelos de permissão e vincular perfil, Sup Admin; ler o cadastro
  de outra pessoa, `usuarios.view`.
- `PUT /me` não aceita mais perfil, permissões nem status; e só o Sup Admin
  mexe no cadastro de um Sup Admin ou concede esse perfil (antes, quem podia
  editar usuários se promovia).

## O que NÃO foi resolvido aqui (decisão do dono)

A API do banco confere **quem** é o usuário (token), mas não **o que** ele
pode: quem tem um token válido e fala direto com a API, por fora do programa,
lê e grava qualquer tabela. As permissões são conferidas pelo backend que
roda dentro do programa. Fechar isso é levar as permissões para dentro da
API — um trabalho próprio, a planejar.

## Testes

- `backend/usuariosTermos.test.js` — regras do aceite, rotas e travas.
- `backend/cadastroELogin.test.js` — cadastro pela rota pública e bloqueio.
- `src/js/__tests__/termosAceiteEMenu.test.js` — caixas de aceite, caixa
  obrigatória, coluna e botão em Usuários, menu.
- API: `node --test cadastro/ acesso/`.
- SQL ensaiado duas vezes num PostgreSQL 17 descartável, com o cadastro, a
  confirmação, o aceite e a recusa rodando contra ele.
