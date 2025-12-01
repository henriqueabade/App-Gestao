Arquitetura Oficial (100% HTTP / 0% Banco Local)

Este projeto é o Dashboard Desktop da Santíssimo Decor, desenvolvido em Electron, que se comunica exclusivamente com a API externa do sistema corporativo.

Ele não acessa PostgreSQL local, não executa SQL e não contém backend próprio.
O Electron atua somente como:

interface gráfica (UI)

gerenciador do Token JWT

orquestrador de requisições HTTP

parser/interpretador de JSON

🚨 ARQUITETURA OFICIAL – REGRAS INFRAUTILMENTE OBRIGATÓRIAS
✔ Modelo Real

100% baseado em HTTP → API externa

0% PostgreSQL local

0% SQL

0% SELECT / FROM / JOIN

0% pg, pg-pool, migrations, seeds, warmup, rollback

✔ API REST simples

A API usa REST puro, sem qualquer sintaxe avançada.

❗Proibido (não funciona):

eq., neq., gte., lte.

in.(1,2,3)

like.*

select=id,nome,perfil:perfil_id(...)

joins virtuais tipo:

materia_prima:insumo_id(...)

processo:etapa_id(...)

✔ Permitido (funciona):
GET /api/tabela?id=1
GET /api/tabela?id=1&id=2&id=3
GET /api/tabela?status=ativo


📌 Qualquer uso de arrays via URLSearchParams vira erro.
Use apenas múltiplos parâmetros repetidos:

Correto:
?id=1&id=2&id=3

Errado (API não entende):
?id=1,2,3

⚙️ Requisitos

Node.js 18+

npm

Windows / macOS / Linux

Nenhum banco ou serviço adicional é necessário na máquina local.

🔐 Variáveis de Ambiente (.env)

Somente variáveis relacionadas à API e serviços externos:

APP_URL=http://localhost:3000
API_BASE_URL=https://api.santissimodecor.com.br

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
FROM_EMAIL=

❌ NÃO USAR (obsoletos)
DB_HOST
DB_USER
DB_NAME
DB_PASSWORD
DB_PORT

▶️ Execução em Desenvolvimento
npm start


Isso inicia o Electron + ponte HTTP para a API externa.

❗Não existe mais:

nenhum backend local

server.js

pg ou pg-pool

conexões PostgreSQL locais

queries SQL

migrations

seeds

introspecção information_schema

🔑 Autenticação – Fluxo Oficial

Electron envia POST /login para a API

API retorna:

{ sucesso, token, usuario }


Electron salva o token (localStorage / storage interno)

Todas as requisições passam a enviar:

Authorization: Bearer TOKEN


Sem o token → 403
Token inválido → 401

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

Toda a estrutura vem pura da API.

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

A arquitetura não afeta o build

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

5. Achar que Electron tem backend próprio

→ Electron só faz chamadas HTTP

🧠 PRINCÍPIO CENTRAL

O frontend deve se comportar como um cliente HTTP burro — sem regras de banco, sem joins, sem SQL.
Toda lógica de dados está na API externa.

✅ Conclusão

O Santíssimo Decor Dashboard é:

✔ Electron + HTTP
✔ 100% REST
✔ API externa como única fonte de dados
✔ Token JWT obrigatório
✔ Zero SQL local
✔ Zero PostgreSQL
✔ Estrutura dinâmica deduzida de JSON
✔ Sem operadores PostgREST
✔ Sem joins automáticos
✔ Sem arrays na querystring