# Login pelo nome completo e cadastro com Nome e Sobrenome

Pedido do dono de 09/10/2026, na branch `Segurança-Permisoes`, nos dois
repositórios.

## O que mudou para quem usa

- **Login**: o campo virou **"E-mail ou nome completo"**. Dá para entrar com
  o e-mail, como antes, ou com o nome completo do cadastro. A comparação
  ignora maiúsculas, acentos e espaços repetidos: "joao  da SILVA" entra
  como "João da Silva".
- **Cadastro pela tela de login** e **Usuários › Novo usuário**: o campo
  único "Nome completo" virou **Nome** e **Sobrenome**, os dois
  obrigatórios. Eles são gravados juntos na coluna `usuarios.nome` (o banco
  não mudou).
- **O nome não repete.** Se já existir o mesmo nome (pela mesma
  comparação), o cadastro é recusado. Os dois campos ficam com a borda
  vermelha e o recado aparece embaixo: *O nome "…" já está cadastrado.
  Diferencie (por exemplo, com outro sobrenome).* A marca some quando se
  digita de novo.
- **Edição** (Usuários › Editar, Configurações › Dados pessoais): continua
  um campo só, "Nome completo". Mudar o nome segue as mesmas regras (nome e
  sobrenome, sem repetir); manter o nome de antes passa sempre.

## Os casos de borda

- **Nomes repetidos que já existiam antes da regra**: o login pelo nome tenta
  a senha em cada cadastro com aquele nome. Se a senha abrir só um, entra
  nele; se abrir mais de um, pede para entrar com o e-mail. Editar outro dado
  desses cadastros não trava, porque o nome não mudou.
- **Bloqueio por três tentativas**: o nome conta como a mesma conta,
  escrito de qualquer jeito. O código de troca de senha só é mandado quando
  o que foi digitado é um e-mail; pelo nome, a mensagem orienta a usar
  "Esqueceu a senha?" com o e-mail.

## Onde mora cada coisa

| Lado | Arquivo |
|---|---|
| Regra única da tela e do backend local | `src/js/utils/nome-completo.js` (`window.NomeCompleto` / `require`) |
| API: comparação, busca do login, nome repetido | `acesso/nomes.js` |
| API: o `POST /login` (e-mail ou nome) | `acesso/login.js`, ligado em `server.js` |
| API: gravação em `usuarios` pela rota genérica | `server.js` (POST/PUT recusam nome repetido com 409 `NOME_JA_CADASTRADO`) |
| API: cadastro da tela de login | `cadastro/cadastro.js` (aceita `sobrenome`; 409 com `campo: "nome"`) |
| Cópia DEV do cadastro | `backend/cadastroPublico.js` (o mesmo código) |
| Login DEV | `backend/localAuth.js` |
| Rotas de usuário do programa | `backend/usuariosController.js` (`conferirNomeDoUsuario`) |
| Tela de login | `src/login/login.html`, `loginRenderer.js`, `login.css` |
| Novo / Editar usuário | `src/html/modals/usuarios/novo.html`, `usuario-novo.js`, `usuario-editar.js` |
| Campo com erro (padrão) | `.ctl-campo[aria-invalid="true"]` em `src/styles/controles.css` |

## Testes

- API: `acesso/login.test.js`, `cadastro/cadastro.test.js`,
  `acesso/status.test.js`.
- App: `backend/loginPeloNome.test.js`, `backend/novoUsuario.test.js`,
  `backend/senhaUsuario.test.js`, `src/js/__tests__/nomeCompletoTela.test.js`
  e `src/js/__tests__/bloqueioDeLogin.test.js`.
- Conferido também com a API de verdade contra um Postgres descartável:
  login pelo e-mail e pelo nome, senha errada, bloqueado, repetido antigo e
  409 no INSERT e no UPDATE.
