Bem-vindo ao time de desenvolvimento do Santíssimo Decor Dashboard.
Este documento explica, de forma objetiva e definitiva, como o sistema realmente funciona e como você deve programar para evitar falhas.

Ele é obrigatório para qualquer pessoa que vá escrever código para este projeto.

🎯 1. OBJETIVO DO PROJETO

O Santíssimo Decor Dashboard é um app desktop em Electron, usado para gerenciar processos internos da empresa.

A arquitetura é 100% baseada em chamadas HTTP para uma API REST externa.

👉 O Dashboard NÃO acessa banco local
👉 NÃO executa SQL
👉 NÃO possui backend Node próprio

O Electron funciona somente como:

interface gráfica

gerenciador de token

orquestrador de requisições HTTP

leitor/interpretador de JSON

🏛 2. ARQUITETURA GERAL
┌─────────────────────────────┐
│       Electron App          │
│  (HTML, CSS, JS, Token)     │
└──────────────┬──────────────┘
               │ HTTP/JSON
               ▼
┌─────────────────────────────┐
│        API Externa          │
│  (CRUD, Permissões, Login)  │
└──────────────┬──────────────┘
               │ SQL real
               ▼
┌─────────────────────────────┐
│       PostgreSQL (API)      │
└─────────────────────────────┘


➡ O Electron NUNCA conversa diretamente com o PostgreSQL.
➡ Somente a API externa faz isso.

🔥 3. REGRAS ABSOLUTAS (OBRIGATÓRIAS)
✔ A API é REST simples — e mais simples do que parece

O filtro da listagem é montado em Santissimo-db-API/server.js (GET /api/:table).
Ele percorre a query string e SÓ aproveita as chaves que são nome de coluna
real da tabela, montando `WHERE coluna = $n`. Todo o resto é descartado sem
aviso.

Correto:

GET /api/usuarios?id=1
GET /api/prospeccoes?etapa=Novo
GET /api/prospeccoes?etapa=Novo&status=ativa      (vira AND)


Errado (não funciona):

id=eq.1
id=in.(1,2,3)
cs.{...}
select=...
materia_prima:insumo_id(...)

⚠️ IGNORADO EM SILÊNCIO (não são colunas — a API descarta e devolve tudo):

?order=nome        → NÃO ordena
?limit=10          → NÃO limita
?offset=20         → NÃO pagina
?select=id,nome    → NÃO projeta; a resposta sempre traz TODAS as colunas

Ordenação, paginação e recorte de colunas são responsabilidade do backend
local (backend/*.js), depois de receber os dados. Nunca confie na query.

❌ ?id=1&id=2&id=3 NÃO FUNCIONA — devolve HTTP 500

Este era o padrão recomendado nas versões anteriores deste guia. Estava
ERRADO. O Express transforma parâmetro repetido em array JavaScript, e a API
monta `WHERE "id" = $1` passando esse array como valor único. O Postgres não
compara inteiro com array:

  cannot cast type array to integer

Para vários ids, escolha um dos dois caminhos:

  a) uma requisição por id, em paralelo
     const registros = await Promise.all(
       ids.map(id => api.get(`/api/perfis/${id}`).catch(() => null))
     );

  b) puxar a tabela e casar em memória (melhor quando são muitos ids)
     const todos = await api.get('/api/perfis');
     const porId = new Map(todos.map(p => [p.id, p]));

O caminho (b) é o que backend/clientesController.js já usa.

✔ A API não faz JOIN

O frontend deve buscar manualmente, por exemplo:

/api/usuarios → retorna perfil_id
/api/perfis?id=perfil_id → retorna nome do perfil

✔ Token JWT obrigatório

Todas as requisições:

Authorization: Bearer TOKEN

✔ Zero SQL local

Nada de SELECT

Nada de pg ou pg-pool

Nada de migrations

Nada de PostgreSQL no Electron

❌ 4. ANTI-PADRÕES PROIBIDOS (NÃO PODE COMETER)

Esses pontos já causaram falhas graves. NUNCA USE:

1. Sintaxe PostgREST

❌ eq.
❌ neq.
❌ lte.
❌ gte.
❌ like.*
❌ in.(...)
❌ select=id,nome,perfil:perfil_id(...)

2. Vários ids na mesma query — de QUALQUER forma
new URLSearchParams({ id: [1,2,3] })   // vira ?id=1,2,3     → filtro inútil
params.append("id", 1); params.append("id", 2);  // ?id=1&id=2 → HTTP 500

Não existe forma de filtrar por vários ids em uma requisição. Use requisições
paralelas por id, ou traga a tabela e case em memória (ver seção 3).

3. Tentar fazer JOIN com select expandido

❌ materia_prima:insumo_id(nome)
A API não conhece isso.

4. Achar que o App tem backend

❌ Não existe server.js
❌ Não existe SQL local
❌ Não existe ORM

5. Engolir erros silenciosos

Sempre trate erros corretamente.

💻 5. COMO FUNCIONA A COMUNICAÇÃO COM A API
Login
POST /login
→ retorna { token, usuario }

Requisição autenticada
fetch(`${API}/usuarios`, {
  headers: { Authorization: `Bearer ${token}` }
})

Vários registros por id
// NÃO existe filtro por lista. Um dos dois caminhos:

// a) uma requisição por id, em paralelo
const registros = (await Promise.all(
  ids.map(id => api.get(`/api/perfis/${id}`).catch(() => null))
)).filter(Boolean);

// b) tabela inteira + casamento em memória (muitos ids)
const todos = await api.get('/api/perfis');
const porId = new Map(todos.map(p => [p.id, p]));
const registros2 = ids.map(id => porId.get(id)).filter(Boolean);

📦 6. CRUD OFICIAL
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

🔗 7. COMO LIDAR COM RELACIONAMENTOS (JOIN MANUAL)

Exemplo: Listar usuários com nome do perfil.

Passo 1 – Buscar usuários

GET /api/usuarios

Passo 2 – Extrair perfil_id

usuarios.map(u => u.perfil_id)

Passo 3 – Buscar os perfis
(NÃO use ?id=1&id=2&id=3 — devolve 500; ver seção 3)

GET /api/perfis                     ← tabela inteira, e casa em memória
   ou
GET /api/perfis/1, /api/perfis/2…   ← uma por id, em paralelo

Passo 4 – Combinar manualmente
const porId = new Map(perfis.map(p => [p.id, p]));
usuario.perfil = porId.get(usuario.perfil_id);

🧩 8. ESTRUTURA DO PROJETO
/src
  /html
  /css
  /js
  /assets
main.js           → inicialização Electron
renderer.js       → lógica de UI
env               → API / SMTP

⚠️ 9. HISTÓRICO DE ERROS – PARA NUNCA MAIS ACONTECER
❌ Erro: usar eq./in.

→ listas vazias
→ perfis não carregavam
→ permissões quebradas
→ sem mensagem de erro

❌ Erro: acreditar que a API tem PostgREST

→ API devolvia vazio silencioso

❌ Erro: arrays no SearchParams

→ ?id=1,2,3 → tratado como string → zero resultados

❌ Erro: acreditar que ?id=1&id=2&id=3 funciona

→ este guia recomendava esse padrão até 2026-08
→ o Express vira array, a API monta "id" = $1 com o array
→ HTTP 500: cannot cast type array to integer
→ corrigido na seção 3

❌ Erro: confiar em order / limit / select na query

→ não são colunas, a API descarta sem avisar
→ a lista volta inteira e fora de ordem, sem nenhum erro
→ código em produção ainda depende disso em alguns pontos
→ ordene, pagine e recorte no backend local

❌ Erro: JOIN via select expandido

→ nome dos insumos, etapas, usuários vinham undefined

❌ Erro: backend local misturado com Electron

→ conflito total com arquitetura do projeto

Este documento elimina esses riscos.

🧱 10. TEMPLATE PADRÃO DE MODAL

Para manter consistência visual e de acessibilidade, use o template compartilhado:

`src/html/modals/shared/dialog-base.html`

Ele contém o overlay padrão e o container do diálogo (com `role="dialog"`, `aria-modal="true"` e `tabindex="0"`).
Mantenha as classes do overlay e do container para preservar o visual padrão.

Como consumir:

1) Crie um HTML de conteúdo com slots:

```html
<div data-modal-slot="header">
  <!-- Conteúdo do header -->
</div>
<div data-modal-slot="body">
  <!-- Conteúdo do body -->
</div>
<div data-modal-slot="footer">
  <!-- Conteúdo do footer -->
</div>
```

2) Abra o modal usando o helper de template:

```js
Modal.openWithTemplate({
  templatePath: 'modals/shared/dialog-base.html',
  contentPath: 'modals/usuarios/novo.html',
  scriptPath: '../js/modals/usuario-novo.js',
  overlayId: 'novoUsuario'
});
```

Se o conteúdo não tiver slots, todo o HTML será inserido no slot `body`.

🔍 11. CHECKLIST OBRIGATÓRIO PARA QUALQUER NOVA FEATURE

Antes de fazer PR:

✔ API REST simples usada corretamente
✔ Zero operadores PostgREST
✔ Filtros só por igualdade em coluna real
✔ Nenhum order / limit / select / offset na query
✔ Vários ids → requisições paralelas ou casamento em memória
✔ Ordenação e paginação feitas no backend local
✔ Token JWT correto em todos os fetch
✔ Erros tratados e logados
✔ Nenhum SQL, JOIN, SELECT, FROM
✔ Nenhum acesso direto ao banco
✔ Nenhum backend local recriado
✔ JS limpo, sem lógica de banco

Se algum item falhar → a PR não deve ser aprovada.

🧠 12. MANDAMENTOS DO DESENVOLVEDOR SANTÍSSIMO DECOR

A API é minha única fonte de dados.

Não farei SQL local.

Não usarei operadores PostgREST.

Nunca enviarei arrays na query, nem parâmetros repetidos.

Filtrarei apenas por igualdade, e só em coluna que existe.

Ordenarei e paginarei no backend local, nunca na query.

Jamais tentarei fazer JOIN no select.

Toda requisição terá Authorization: Bearer TOKEN.

Se a API devolver vazio, investigarei o filtro.

Se a API devolver tudo, lembrarei que ela ignora o que não é coluna.

A UI é burra; a API é inteligente.

Eu sigo este DEV-ONBOARDING.md.

🏁 13. CONCLUSÃO

Este guia garante que o Dashboard seja:

✔ Estável
✔ Manutenível
✔ Compatível com a API
✔ Livre de erros silenciosos
✔ Impossível de quebrar por desconhecimento
✔ Fácil para novos desenvolvedores entrarem no time
