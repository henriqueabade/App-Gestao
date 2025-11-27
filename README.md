README – Santíssimo Decor Dashboard (Arquitetura 100% HTTP)

Santíssimo Decor Dashboard

Este projeto é um aplicativo desktop em Electron usado para gerenciar o fluxo de trabalho interno da Santíssimo Decor.  
A arquitetura atual é 100% baseada em **HTTP + API externa**, sem qualquer conexão direta com PostgreSQL local.

------------------------------------------
Nova Arquitetura (importante)

✔ 100% HTTP  
✔ 0% PostgreSQL local  
✔ Sem SQL, SELECT, FROM, JOIN  
✔ Sem pg, pg-pool, migrations, warmup, rollback  
✔ Token JWT obrigatório em todas as requisições  
✔ Todas as tabelas acessadas via /api/<tabela>  

O Electron funciona apenas como:

- UI
- armazenamento do token
- orquestrador de chamadas HTTP
- interpretador de JSON (colunas, tipos, tabelas, dados)

------------------------------------------
Requisitos

- Node.js (18+)
- npm

Nenhum banco de dados local é necessário.

------------------------------------------
Configuração do .env

Somente variáveis relacionadas à API externa:

APP_URL=http://localhost:3000  
API_BASE_URL=https://api.santissimodecor.com.br  

SMTP_HOST=... (opcional)  
SMTP_PORT=...  
SMTP_USER=...  
SMTP_PASS=...  
FROM_EMAIL=...

❗ Variáveis antigas como DB_HOST, DB_USER, DB_NAME, DB_PASSWORD NÃO são usadas.

------------------------------------------
Execução em Desenvolvimento

npm start

Isso inicia o Electron e habilita a ponte HTTP para a API externa.

Não existe mais:

- backend/server.js
- conexões pg
- pool.connect
- migrations
- db.query
- SQL local

------------------------------------------
Autenticação

Fluxo:

1. Electron envia POST /login  
2. API retorna { sucesso, token, usuario }  
3. Electron salva o token localmente  
4. Todas as requisições seguintes enviam:

Authorization: Bearer TOKEN

------------------------------------------
Acesso às Tabelas

A API já expõe todas as tabelas via rotas simples:

GET /api/usuarios  
GET /api/clientes  
GET /api/materia_prima  
GET /api/produtos  
GET /api/orcamentos  
GET /api/pedidos  

Consulta por ID:

GET /api/<tabela>/<id>

Criação:

POST /api/<tabela>

Atualização:

PUT /api/<tabela>/<id>

Exclusão:

DELETE /api/<tabela>/<id>

------------------------------------------
Como o Electron interpreta colunas e tipos

A API retorna JSON. A estrutura da tabela é deduzida automaticamente:

- colunas = keys do objeto
- tipo = typeof valor
- datas ISO → tipo date
- obrigatórios → inferidos pelas mensagens da API
- selects → obtidos via endpoints auxiliares, quando existirem

Sem SQL.  
Sem information_schema.  
Sem introspecção de banco.

------------------------------------------
Permissões de Usuário (via API)

Rotas:

GET /api/usuarios/:id  
PATCH /api/usuarios/:id  
PUT /api/usuarios/:id/permissoes  

A API retorna o JSON já normalizado de permissões.

------------------------------------------
Padrões de Interface

Mantidos conforme a versão original (tipografia, gradientes, tokens CSS).

------------------------------------------
Geração de Instalador

npm run dist  
npm run dist:publish  

Fluxo permanece inalterado. A arquitetura de dados não influencia no build.

------------------------------------------
Conclusão

O Santíssimo Decor Dashboard agora é totalmente:

✔ Electron + HTTP  
✔ API externa como única fonte de dados  
✔ Token JWT obrigatório  
✔ Zero SQL local  
✔ Zero PostgreSQL local  
✔ 100% REST  
✔ Interpretação dinâmica de colunas via JSON
