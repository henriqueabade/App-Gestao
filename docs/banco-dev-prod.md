# Seleção de dados: DEV e PROD

O `.env` da raiz é carregado exclusivamente no backend/processo principal. Reinicie o Electron após alterar a configuração.

| BANCO | Origem dos dados | Login |
| --- | --- | --- |
| `PROD` | API configurada em `API_BASE_URL`/`API_URL`, como antes | API remota |
| `DEV` | PostgreSQL indicado por `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME` e `DB_PASSWORD` | Senha bcrypt na tabela local `usuarios` |

Ausência de `BANCO` ou valor vazio mantém `PROD`. Valores diferentes de DEV/PROD interrompem a inicialização. Não existe fallback entre ambientes: uma falha no banco DEV nunca redireciona uma operação à produção.

## Configurar

Instale as dependências com `npm install`. Use `.env.example` como referência, preservando suas configurações existentes:

```dotenv
BANCO=DEV
DB_HOST=localhost
DB_PORT=5432
DB_USER=usuario_local
DB_NAME=banco_local
DB_PASSWORD=senha_local
```

Execute `npm start`. Para retornar à API, altere para `BANCO=PROD` e reinicie.

O banco DEV deve conter o schema e os dados do aplicativo. Esta implementação não cria, migra ou copia tabelas automaticamente. O login usa os usuários desse banco e continua bloqueando contas inativas/não confirmadas. O autocadastro cria uma conta não confirmada; o cadastro administrativo mantém o fluxo existente.

## Limites entre frontend e backend

- A interface mantém as mesmas rotas locais e chamadas IPC. `get-runtime-config` retorna somente o endereço HTTP local.
- `backend/db.js` e `backend/apiHttpClient.js` selecionam o adaptador. Controllers continuam aplicando as regras e permissões existentes.
- `backend/localDataClient.js` converte operações internas em SQL parametrizado, valida nomes de tabelas/colunas e exige ID para atualizar/excluir. Chaves especiais (`modelo_id` e `id_prod`) são respeitadas.
- `backend/localDatabase.js` mantém o pool PostgreSQL e substitui erros do driver por mensagens seguras, sem host, usuário, senha, SQL, parâmetros ou `cause`.
- As variáveis `DB_*` ficam em memória privada no backend e são removidas de `process.env`, para não serem herdadas pelos processos renderer.
- As sessões DEV são assinadas no backend e ficam somente na memória. Reiniciar exige login; o token salvo de PROD não é lido nem sobrescrito.
- O servidor escuta em `127.0.0.1`. Em DEV, as rotas `/api` exigem sessão, exceto links públicos de confirmação/aprovação; tabelas privadas ficam fora do proxy genérico e respostas JSON são sanitizadas.
- Fotos DEV vêm da coluna local `foto_usuario`, em TEXT ou BYTEA. O proxy de imagens remotas fica desativado em DEV.
- Durante esta fase de uso interno, o empacotamento inclui o `.env` no `app.asar`, onde o backend já o carrega. O instalador utiliza o `BANCO` e as configurações presentes nesse arquivo no momento da geração. Variantes `.env.*`, dados locais e arquivos SQL continuam excluídos.
- As janelas usam sandbox e um bloqueio de requisições `file://` para `.env` e arquivos de sessão, inclusive durante o desenvolvimento.

## Verificação

```sh
node --test backend/localDataClient.test.js
npm test
```

Os testes novos usam `pg-mem`, credenciais fictícias e HTTP em loopback. O adaptador bloqueia conexões PostgreSQL reais durante testes. Eles verificam CRUD, filtros, login, isolamento DEV/PROD, assinatura de sessão, injeção SQL, respostas públicas e exclusões do instalador.

Referências da implementação: [consultas parametrizadas do node-postgres](https://node-postgres.com/features/queries) e [interceptação de requisições no Electron](https://www.electronjs.org/docs/latest/api/web-request).
