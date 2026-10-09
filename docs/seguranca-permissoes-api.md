# Segurança: permissão por tabela na API

Ordem do dono de 09/10/2026: *"cada tabela com as mesmas permissões da tela
(ler e gravar)"*, sem quebrar nada do que já funciona. O trabalho está na
branch `Segurança-Permisoes`, nos dois repositórios (App-Gestao e
Santissimo-db-API).

## O problema

O programa fala com a API pela rota genérica `/api/<tabela>` (ler, inserir,
alterar, apagar). Até aqui a API só conferia o **token**. Qualquer usuário
logado, chamando a API direto, lia e gravava **qualquer tabela**:

- virava **Sup Admin** com um `PUT /api/usuarios/<id>` (`perfil = 'Sup Admin'`);
- mexia nas próprias permissões (`perm_*`, `modelos_permissoes`);
- apagava ou trocava os segredos (certificado A1, senha do SMTP, segredos do BB);
- lia boletos, notas, fechamentos e comissões sem ter a tela do Financeiro.

As telas escondiam os botões e o backend local conferia as rotas, mas os
dois rodam no computador de cada um. A trava de verdade tem de estar na API.

## Como ficou

### 1. A API sabe o que cada usuário pode (`acesso/permissoes.js`)

As mesmas regras do programa (`backend/permissionsRepository.js`):

- **Sup Admin** é quem tem o perfil "Sup Admin" (sem diferença de caixa,
  acento ou hífen) e pode tudo;
- o **perfil** vem de `usuarios.modelo_permissoes_id` ou, na falta dele, do
  `modelos_permissoes` com o mesmo nome de `usuarios.perfil`;
- uma **chave** (`ped.view`, `financeiro.boleto.view`...) vale quando o módulo
  está ativo no perfil (`modulo_ativo`) e a coluna dela está marcada;
- `modulo:<código>` é a chave do módulo inteiro (Dashboard, Calendário e
  Laminação não têm ações).

O catálogo (chave → tabela `perm_*` e coluna) vem do programa, exportado por
`scripts/exportar-catalogo-para-api.js` para `acesso/catalogo-permissoes.json`.
Mudou uma ação no catálogo, exporte de novo; o teste
`backend/catalogoDaApi.test.js` avisa.

### 2. A regra de cada tabela (`acesso/politica.js`)

Cada tabela tem uma regra por operação: `"todos"` (qualquer logado),
`"supadmin"`, `"ninguem"` (só a própria API grava) ou a lista de chaves
(basta ter **uma**).

**À mão (valem sempre, nos dois modos):**

| Tabela | Regra |
|---|---|
| `usuarios` | Ler: todos. Criar: `usuarios.create`. Apagar: Sup Admin. **Alterar a própria linha:** dados pessoais, foto, preferências e registro de entrada/saída; do acesso, só recusar os termos (desativa) e limpar o pedido de aceite. **A linha de outro:** `usuarios.edit`; só o status, `usuarios.status.toggle`. Ninguém além do Sup Admin dá o perfil Sup Admin nem mexe num Sup Admin. |
| `perm_*`, `modelos_permissoes` | Ler: todos (o programa lê as do próprio perfil). Gravar: Sup Admin. |
| `segredos_app` | Ler: todos (está cifrado). Gravar: Sup Admin (as rotas do programa já exigiam). |
| `usuarios_termos_aceites`, `termos_versoes` | Registrar: todos (cada um o seu). Alterar/apagar: ninguém. |
| `usuarios_confirmacoes`, `api_acessos_registro` | Só a API grava. O registro só o Sup Admin lê. |

**O mapa das outras tabelas** é tirado do próprio código do backend pelo
`scripts/mapa-permissoes-api.js`:

1. ele acha cada rota (`router.get/post/...`, os IPC do `main.js`) e a guarda
   dela (`exigirPermissao`, `exigirAlgumaPermissao`, `exigirSupAdmin`,
   `verificarPermissaoIpc`);
2. segue as funções que o handler chama até as chamadas à API;
3. para cada tabela e operação, junta as chaves das rotas que chegam nela.
   Rota sem guarda, tarefa em segundo plano e o resto do `main.js` contam
   como "todos".

Quando ele não sabe qual função é chamada, liga a todas com esse nome, o que
deixa o mapa mais largo e nunca mais estreito. O resultado vai para
`acesso/politica-tabelas.json` na API. Mudou rota ou tabela, rode de novo; o
teste `backend/mapaPermissoesApi.test.js` avisa.

```
node scripts/mapa-permissoes-api.js
node scripts/mapa-permissoes-api.js --explicar "POST /documentos" contabil_arquivos inserir
```

O `--explicar` mostra a cadeia de chamadas, da rota até a tabela.

Hoje, por exemplo:

- **apagar pedido** exige `ped.delete`;
- **ler boleto** exige uma chave do Financeiro ou da Contabilidade;
- **ler clientes, pedidos e orçamentos** é de todos, porque as Tarefas e o
  Dashboard mostram.

### 3. Observar antes de bloquear (`PERMISSOES_MODO` no .env da API)

- **`observar`** (o padrão): o que o mapa negaria **passa**, mas fica anotado
  como "seria negado". As regras à mão (escalada de privilégio) já valem.
- **`bloquear`**: o que o mapa nega recebe **403**. Tabela fora do mapa: só o
  Sup Admin.

O registro (`api_acessos_registro`, do `sql/seguranca_registro_api.sql`)
guarda uma linha por combinação: usuário, tabela, operação, a **tela do
programa** que pediu e quantas vezes. A tela vem do cabeçalho `X-Rota`, que o
backend local manda (`backend/contextoDaRota.js`). Esse cabeçalho serve só
para o registro: a decisão é sempre pelo token.

**Usuários › Segurança da API** (botão só do Sup Admin) mostra o modo, se o
registro está gravando e a lista.

### 4. O que mais fechou

- O e-mail "seu acesso foi liberado" só sai para quem tem permissão de
  liberar usuários (antes, qualquer logado pedia).
- Apagar **categoria** e **unidade** da Matéria-prima: o IPC passou a exigir
  `mp.category.delete` / `mp.unit.delete`. A tela já escondia o botão, mas o
  `main.js` não conferia.
- Criar e apagar **transportadora**: exige cadastro de cliente ou de orçamento
  (`cli.create`, `cli.edit`, `orc.create`, `orc.edit`) ou a IA aplicando neles.
- **`JWT_SECRET` obrigatório** (o dono confirmou que está no .env): sem ele
  a API não sobe. Antes ela caía numa chave escrita no código, e quem lesse o
  código fabricava o token de qualquer usuário.
- **Dados pessoais dos usuários** (decisão do dono, 09/10/2026): e-mail,
  telefone e as notas internas de **outros** usuários só saem para quem tem o
  módulo Usuários (`usuarios.view`) ou os Relatórios (`rel.view`). O próprio
  usuário vê os seus; o Sup Admin vê tudo.
  - Na tela vale já: a lista reduzida (`/usuarios/lista`, `/usuarios`)
    perdeu o e-mail dos outros. Os seletores de dono e responsável só usam o
    nome.
  - Na API segue o modo: em observar anota como "seria negado", em bloquear
    tira as colunas (`acesso/politica.js` › `filtrarLeitura`).
  - Efeito em bloquear: a importação de planilha casa o "responsável" pelo
    nome. Quem importa sem o módulo Usuários só deixa de casar quando a coluna
    traz o **e-mail** do responsável.

## Para ligar

1. Rodar `sql/seguranca_registro_api.sql` no banco.
2. Publicar a API nova e reiniciar. Ela sobe em `observar` e fecha a escalada
   de privilégio desde já.
3. O `JWT_SECRET` precisa estar no .env da API (o dono confirmou que está);
   sem ele a API não sobe.
4. Usar o programa normalmente por alguns dias, com todos os perfis, e olhar
   **Usuários › Segurança da API**:
   - "Seria negado" de alguém que **precisava** daquela tela: falta a
     permissão no perfil dele (Modelos de Permissão) ou o mapa esqueceu uma
     tabela (avise para corrigir);
   - "Seria negado" de quem **não** devia: era exatamente isso que a trava vai
     barrar.
5. Com a lista limpa: `PERMISSOES_MODO=bloquear` no .env da API e reiniciar.

## Testes

- API:
  - `acesso/politica.test.js`: regras, modos, mapa gerado e registro;
  - `acesso/login.test.js`;
  - `cadastro/cadastro.test.js`;
  - `acesso/status.test.js`.
- App:
  - `backend/mapaPermissoesApi.test.js`;
  - `backend/catalogoDaApi.test.js`;
  - `backend/contextoDaRota.test.js`;
  - `src/js/__tests__/segurancaApiTela.test.js`.
- Também com a API de verdade contra um Postgres descartável, nos dois modos:
  - a escalada barrada;
  - quem precisa continua (entrada/saída, recusa dos termos, Gerente editando,
    Sup Admin);
  - o rebaixado perde na hora;
  - o registro grava a tela;
  - em bloquear, Vendedor lê pedidos mas não boletos;
  - quem tem a coluna marcada com o módulo desligado não lê;
  - apagar pedido só com `ped.delete`.
