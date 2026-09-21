# "Esqueceu a senha?" e a regra da senha forte

Fase 4 das correções de 21/09/2026. Duas coisas: consertar o "Esqueceu a
senha?" da tela de login e exigir senha forte em todo lugar onde uma senha
nasce ou muda.

## O que estava errado

- **No app instalado (PROD) o pedido nunca funcionava.** As rotas exigiam o
  token do app, e na tela de login não há sessão: a API respondia 401 ("Token
  ausente ou inválido").
- **O e-mail era comparado com maiúsculas e minúsculas**: "Maria@..." dava
  "E-mail não encontrado".
- **Com o envio de e-mail desligado** (`EMAIL_SENDING_ENABLED=false`, como no
  DEV) a tela sempre mostrava erro, e não havia como testar.
- **O link do e-mail não abria nada**: apontava para
  `http://localhost:3000/reset-password`, página que o servidor local não
  servia (404). E mesmo servida, não abriria no celular, com o app fechado ou
  com a API local em outra porta.
- **A troca de senha em Configurações gravava a senha crua.** A coluna `senha`
  só guarda hash bcrypt (é o que o login compara): quem trocava a senha não
  conseguia mais entrar. O auto-cadastro em PROD tinha o mesmo defeito.

## Como funciona agora

1. Tela de login › **Esqueceu a senha?** › e-mail › **Enviar código**.
2. Chega no e-mail um **código de 8 números** (vale 30 minutos, uma vez; um
   pedido novo anula o anterior).
3. Na mesma caixa: e-mail, código, **nova senha** (com a lista de requisitos)
   e confirmação › **Salvar nova senha**.
4. Deu certo: a caixa fecha, o e-mail fica no campo do login e o bloqueio de
   tentativas daquela máquina é liberado.

"Já recebeu o código? **Digitar o código**" leva direto ao passo 3 — por
exemplo, depois do bloqueio por 3 senhas erradas, que já manda o código sozinho.

**Segurança.** O código só existe no e-mail: nunca volta na resposta. O banco
guarda só o sha256 de `<id do usuário>:<código>` (tabela
`password_reset_tokens`, a mesma de antes). 5 códigos errados apagam o pedido;
um pedido por e-mail a cada 60 segundos; na troca, e-mail que não existe
responde igual a código errado.

## Quem faz o quê

| Banco | Onde roda |
|---|---|
| **PROD** | Na **API** (Santissimo-db-API): `POST /senha/esqueci` e `POST /senha/redefinir`, sem JWT. Regras em `senha/redefinicao.js`; o e-mail sai de lá (`senha/email.js`, `SMTP_*` e `FROM_EMAIL` no `.env` da API). O app só repassa. |
| **DEV** | No backend local, contra o banco local: `backend/redefinicaoSenha.js` (cópia do arquivo da API). Com `EMAIL_SENDING_ENABLED=false`, o código é escrito no terminal do app e a tela avisa. |

O código não pode ser criado no app e enviado de lá em PROD: a API teria de
aceitar "grave este código para este e-mail" de qualquer um, e qualquer um
trocaria a senha de qualquer pessoa. Por isso quem cria o código é quem manda
o e-mail.

Sem a API atualizada, o app instalado mostra: "O servidor ainda não tem a
troca de senha pelo código. Avise o administrador para atualizar a API."

**O e-mail** segue o modelo dos e-mails do Monitoramento Túnel Bancos Físicos
(fundo vinho, cartão com a logo redonda no topo, título dourado, código na
faixa dourada como o PIN). A logo vai anexa (`cid:logo-sidebar`): na API é
`senha/logo-email.png`; no app, `src/assets/Logo SideBar.png`. O mesmo HTML
está em `senha/email.js` (API) e `src/email/sendResetEmail.js` (DEV): mudou
um, mude o outro.

## A regra da senha

Mínimo de **8 caracteres**, com **uma letra maiúscula**, **um número** e **um
caractere especial**. Letra acentuada conta como letra; espaço não conta como
especial. A regra mora só em `src/js/utils/senha-forte.js` (tela e backend do
app); a API tem a cópia em `senha/regra.js`. Mudou uma, mude a outra.

Vale para a **senha nova**; as senhas já gravadas continuam entrando.

| Onde | Tela (lista que marca enquanto se digita) | Quem confere antes de gravar |
|---|---|---|
| Tela de login › Cadastrar | sim | `registrarUsuario` (backend.js) e `localAuth.register` |
| Tela de login › Esqueceu a senha? | sim | `passwordResetRoutes.js` e a API |
| Usuários › Novo usuário | sim | `validarNovoUsuario` (usuariosController.js) |
| Configurações › Dados pessoais | sim, aparece ao digitar | `PUT /api/usuarios/me` (e `/:id`), que agora grava em hash |

A lista é desenhada por `SenhaForte.ligarLista(campo, <ul>)` com o estilo de
`src/styles/senha-forte.css` (use `senha-forte--escuro` em fundo escuro).

## Para colocar em produção

1. **API** (Santissimo-db-API): atualizar o código (`senha/` inteira, com a
   `logo-email.png`, `server.js`, `package.json`), instalar o `nodemailer`
   (`npm install`, ou copiar a pasta `node_modules/nodemailer` do app — ele não
   tem dependências), pôr no `.env`
   da API `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `FROM_EMAIL`
   (os mesmos do `.env` do app) e reiniciar.
2. Conferir: `POST https://<api>/senha/esqueci` com um e-mail que não existe
   responde `{"error":"E-mail não encontrado."}`. Se vier "Cannot POST", a API
   não foi atualizada.
3. Publicar a nova versão do app.

## Código e testes

- App: `backend/passwordResetRoutes.js` (as duas rotas; `eventos` avisa o
  `main.js` para liberar o bloqueio), `backend/redefinicaoSenha.js`,
  `src/email/sendResetEmail.js` (e-mail do código no DEV),
  `src/login/login.html` + `loginRenderer.js` (os dois passos). A página antiga
  `reset-password.html` saiu.
- Testes: `backend/senhaUsuario.test.js`, `src/js/__tests__/senhaForte.test.js`
  e, na API, `senha/redefinicao.test.js` (`node --test senha/`).
