# Santíssimo Decor Dashboard

Aplicativo desktop em Electron com backend local e duas opções de acesso aos dados.

## Escolher o ambiente

- **BANCO=PROD**: usa a API remota, mantendo o comportamento existente. É o padrão quando BANCO está vazio ou ausente.
- **BANCO=DEV**: usa o PostgreSQL configurado no .env, exclusivamente pelo backend.

O frontend usa IPC e HTTP local em ambos os modos. Credenciais DB nunca são enviadas pela configuração pública; o instalador exclui arquivos .env e dados locais.

Consulte [Configuração DEV/PROD](docs/banco-dev-prod.md) e [.env.example](.env.example). Reinicie o app após alterar o ambiente. O banco DEV precisa ter o schema do aplicativo e um usuário ativo com senha bcrypt. Não há cópia automática de dados entre ambientes.

## Executar

Requisitos: Node.js, npm e, para DEV, PostgreSQL acessível.

```sh
npm install
npm start
```

## Testar

```sh
npm test
node --test backend/localDataClient.test.js
```

## Variáveis de ambiente

```dotenv
BANCO=PROD
API_BASE_URL=https://api.santissimodecor.com.br
DB_HOST=localhost
DB_PORT=5432
DB_USER=
DB_NAME=
DB_PASSWORD=
```

As configurações de SMTP e demais serviços continuam independentes da seleção do banco.

## Contrato da API de produção

As orientações abaixo descrevem a API remota. Ela usa comparações simples; mantenha os controllers compatíveis com esse contrato, mesmo ao desenvolver em DEV.

📦 Acesso às Tabelas (CRUD Oficial)

Padrão REST real da API:

Listar
GET /api/<tabela>

Buscar por ID
GET /api/<tabela>/<id>

Criar
POST /api/<tabela>

Atualizar
PUT /api/<tabela>/<id>

Deletar
DELETE /api/<tabela>/<id>

Exemplos
GET /api/usuarios
GET /api/clientes
GET /api/materia_prima
GET /api/produtos
GET /api/orcamentos
GET /api/pedidos

🔄 Como o Electron interpreta colunas, tipos e tabelas

Os controllers recebem registros JSON do adaptador selecionado.

O Electron deduz:

colunas → chaves do JSON

tipos → typeof

datas → ISO convertida para Date

selects → carregados via endpoints de apoio

relacionamentos → devem ser buscados manualmente no backend da API

❗IMPORTANTE

O Electron não faz JOIN.
Ele não deve tentar usar select expandido.

Se precisar de dados relacionados:
➡ buscar manualmente usando id e montar.

👤 Permissões de Usuário

Rotas oficiais:

GET /api/usuarios/:id
PATCH /api/usuarios/:id
PUT /api/usuarios/:id/permissoes


A API já retorna o JSON completo de permissões normalizadas.

O Electron apenas consome e renderiza.

🎨 Padrões de Interface

O projeto mantém:

tipografia original

gradientes

tokens CSS

componentes padrão

layout do Dashboard

Nada da arquitetura de dados interfere na UI.

📦 Geração de Instaladores (Build)
npm run dist
npm run dist:publish


Criação de .exe, .dmg, .AppImage

Usa electron-builder

O build exclui .env, .env.*, dados locais e arquivos SQL.

🚫 ERROS MAIS COMUNS (NÃO PODEM ACONTECER)
1. Usar operadores PostgREST

→ causa tabelas vazias
→ API ignora parâmetros
→ erro silencioso

2. Enviar arrays no querystring

?id=1,2,3
→ API interpreta como string e retorna vazio

3. Tentar fazer JOIN via select=

→ API devolve apenas tabela base

4. Supondo que a API faz filtragem avançada

→ é REST simples; tudo manual

5. Colocar credenciais ou SQL no frontend

→ A seleção do ambiente e o acesso PostgreSQL pertencem somente ao backend.

🧠 PRINCÍPIO CENTRAL

O frontend deve se comportar como um cliente HTTP burro — sem regras de banco, sem joins, sem SQL.
As regras ficam no backend; a origem dos dados é selecionada por BANCO.

✅ Conclusão

O Santíssimo Decor Dashboard é:

✔ Electron + HTTP
✔ 100% REST
✔ API externa em PROD e PostgreSQL local em DEV
✔ Token JWT obrigatório
✔ SQL e PostgreSQL somente no backend DEV
✔ Estrutura dinâmica deduzida de JSON
✔ Sem operadores PostgREST
✔ Sem joins automáticos
✔ Sem arrays na querystring