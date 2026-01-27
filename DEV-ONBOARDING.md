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
✔ A API é REST simples

Somente usa parâmetros simples:

Correto:

GET /api/usuarios?id=1
GET /api/usuarios?id=1&id=2&id=3


Errado (não funciona):

id=eq.1
id=in.(1,2,3)
cs.{...}
select=...
materia_prima:insumo_id(...)

✔ Arrays na URL são proibidos

O padrão correto para múltiplos ids:

?id=1&id=2&id=3

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

2. Arrays no URLSearchParams
new URLSearchParams({ id: [1,2,3] })
// ERRADO → vira id=1,2,3

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

Parâmetros múltiplos
const params = new URLSearchParams();
ids.forEach(id => params.append("id", id));

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

Passo 3 – Repetir ids na query

GET /api/perfis?id=1&id=2&id=3

Passo 4 – Combinar manualmente
usuario.perfil = perfis.find(p => p.id === usuario.perfil_id)

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
✔ Parâmetros múltiplos → repetidos, não array
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

Nunca enviarei arrays na query.

Sempre repetirei os parâmetros quando houver múltiplos IDs.

Jamais tentarei fazer JOIN no select.

Toda requisição terá Authorization: Bearer TOKEN.

Se a API devolver vazio, investigarei o filtro.

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
