# Lentidão ao abrir módulos e modais — diagnóstico, plano e entrega

Pedido do dono em 06/10/2026: "muita lentidão de carregamento nos módulos e
modais, principalmente Financeiro e Contabilidade, mas no geral em todos".
Este documento é o diagnóstico (medido, não estimado), o plano e, logo abaixo,
a entrega das quatro fases (06/10/2026, autorizada de uma vez pelo dono).
Tudo está na branch `Otimização-de-Carregamentos`, nos dois repositórios
(App-Gestao e Santissimo-db-API).

## Entrega

### Resultado medido (a mesma medição do diagnóstico)

| Rota (o que a tela pede)            | Antes: idas / 120 ms por ida | Depois: idas / 120 ms por ida |
|-------------------------------------|-----------------------------:|------------------------------:|
| Financeiro › painel de comissões    | 402 / **19,9 s**             | 33 / **0,6 s**                |
| Financeiro › Produção da competência| 817 / **39,3 s**             | 21 / **1,0 s**                |
| Financeiro › Comissões atrasadas    | 438 / **20,2 s**             | 29 / **0,7 s**                |
| Financeiro › Registrar ajuste       | 399 / **19,5 s**             | 29 / **0,4 s**                |
| Contabilidade › painel              | 204 / **3,4 s**              | 48 / **0,7 s**                |
| Fiscal › painel                     | 7 / 0,5 s                    | 7 / 0,5 s                     |
| Cobrança › painel de recebimentos   | 10 / 0,6 s                   | 10 / 0,3 s                    |

- **Abrir o Financeiro** (três painéis juntos): de 419 idas e 7 MB para 50 idas e 0,73 MB, antes do gzip.
- **Contabilidade:** de 4,5 MB para 0,26 MB.
- **Pico de chamadas simultâneas à API:** também caiu (Financeiro de 104 para 28, Contabilidade de 73 para 41).
- **Na tela:** o piso do spinner continua o de antes. Voltar a um módulo recarrega a tela de verdade, como na primeira vez (a Fase 4 foi tirada, abaixo).

### Decisões (as do dono, de 06/10/2026, e as técnicas)
1. **Piso do spinner (dono): NÃO baixar.** Ficou como sempre foi:
   - 1 s nos módulos, no Financeiro, na Contabilidade e nos modais dos módulos;
   - 0,5 s nos modais de Pedidos e nos abertos por cima;
   - nenhum no Visualizar/Editar orçamento, que aparece quando o orçamento chega.
   - Uma primeira versão tinha baixado tudo para 0,3 s; foi desfeita.
2. **API da internet (dono): pode, desde que não quebre nada.** Foi auditada ponto a ponto (abaixo, Fase 2). Precisa ser publicada de novo; sem isso o programa funciona igual, só baixa mais.
3. **Volta instantânea (dono): tirada em 07/10/2026.** Foi feita como uma foto da última visita, mostrada só enquanto o módulo relia tudo. O dono viu e preferiu a recarga normal: a troca da foto pela tela parecia "uma travada, uma piscada", e a carga real já está rápida. Saiu inteira: `main.js`, `preload.js`, o utilitário, o CSS e o teste.
4. **Otimizado nos dois modos** (DEV e PROD). O `select` vale também no `localDataClient`.

### O que mudou, fase por fase
**Fase 1 (backend):**
- leitura de uma vez em vez de uma por uma, a partir de 4 ids:
  - `carregarRotas` em `cancelamentoEstorno.js`;
  - `linhasDosPedidos` em `financeiro/producao.js`;
  - `porId` em `contabilidade/conciliacao/liquidacoes.js`;
  - `nomesDosClientes` e `clientesDe`;
- memória de leitura por requisição (`comLeituraUnica` em `apiHttpClient.js`):
  - a mesma tabela, com o mesmo filtro, é lida uma vez por rota;
  - qualquer escrita limpa a memória;
- a Contabilidade lê em duas ondas paralelas em vez de oito em série;
- a trava: `backend/desempenhoPaineis.test.js`. Ela falha no código antigo com 155 idas contra o teto de 45.

**Fase 2 (API, repositório Santissimo-db-API):**
- a API respeita o `select` (`consultas/colunas.js`): nomes, ou `-coluna` para excluir;
- as listas de notas pedem sem os XMLs (`backend/fiscal/colunasDaNota.js`);
- gzip nas respostas (`consultas/compactar.js`);
- `usuarios.senha` nunca sai, e `password_reset_tokens` fica fechada (403).

**Auditoria "não quebrar nada" (Fase 2):**
- **`select` respeitado:** conferidos os ~50 pontos do programa que mandam `select` e o que cada um usa depois.
  - Achada e corrigida uma quebra real: o `getFiltrado` de Matéria-prima e Produtos refiltra pela coluna do filtro, e leituras como `{ categoria, select: 'id' }` vinham sem ela.
  - O efeito era "a categoria/unidade/processo/coleção tem dependência?" e "o produto está em orçamento?" responderem sempre "não", e as linhas da rota de um produto excluído não serem achadas.
  - O defeito já existia no modo DEV. Agora o `separarFiltrosQuery` põe a coluna do filtro no `select`.
  - Trava: `backend/filtrosComSelect.test.js`, que falha sem a correção.
- **Notas sem XML:** nenhum dos cinco lugares que pedem `SEM_XML` usa os XMLs. As evidências, o DANFE, o e-mail e o download leem a nota inteira.
- **Memória por requisição:** a chave inclui o `select`, então a nota inteira e a nota sem XML nunca se misturam. Ela vive só durante uma rota.
- **`senha` e tokens:**
  - o login, o "esqueci a senha", o cadastro e a troca de senha da API leem o banco direto, não pela rota genérica;
  - o login do modo DEV também lê o banco direto;
  - nenhum código do programa lê o hash pela API.
- **gzip:** só vai para quem pede. O `fetch` do Node (backend e `main.js`) descompacta sozinho; os transportes de banco/SEFAZ não falam com a API.

**Fase 3 (tela):**
- **spinner único:**
  - `Modal.openModuleModal` no lugar das dez cópias, com relógio de 15 s;
  - limpeza se o modal fecha, se a página não chega ou se a abertura é cancelada;
- **avisam "pronto" só depois dos dados:**
  - Novo cliente (Clientes e Laminação), Novo serviço, Novo orçamento, Novo insumo e Novo produto;
  - Responsável da prospecção também ganhou spinner;
- **módulos que publicam a primeira carga ao menu** (`window.moduloPronto`), com teto de 20 s. São 12:
  - Clientes, Contatos, IA, Laminação (clientes e serviços), Matéria-prima;
  - Orçamentos, Pedidos, Produtos, Prospecções, Relatórios e Usuários;
- trava: `src/js/__tests__/desempenhoTela.test.js`;
- **ficou de fora, de propósito:**
  - "carregar uma vez os scripts grandes do Financeiro e da Contabilidade". Medido: ler e compilar custa ~6 ms por abertura. Reescrever os scripts para isso traria risco sem ganho que se sinta;
  - o spinner próprio do Financeiro e da Contabilidade foi mantido: já tinha relógio e limpeza, com o piso de 1 s de sempre.

**Fase 4 (volta instantânea): feita em 06/10 e tirada em 07/10/2026, a pedido do dono.**
- Ao voltar a um módulo, ela mostrava a foto da última visita enquanto o módulo relia tudo por baixo.
- Na prática, a troca da foto pela tela parecia uma travada. Com as Fases 1 a 3 a carga real já é rápida, então voltar recarrega a tela de verdade: máscara, spinner de 1 s e a entrada em cascata.
- `entradaCascata.test.js` confere que ela não volta sem querer.

### O que o dono precisa fazer
1. Tudo está na branch `Otimização-de-Carregamentos` (nos dois repositórios); a `main` ficou como estava. Juntar à `main` quando aprovar.
2. **Publicar a API** (Santissimo-db-API, a partir dessa branch) e reiniciá-la. Até lá, o programa funciona, só baixa mais.
3. **Fechar e abrir o programa.**
4. Nenhum SQL novo.

## Como foi medido

Um roteiro sobe as rotas **reais** do backend (Fiscal, Cobrança, Financeiro,
Contabilidade e Pedidos) em cima de uma API de mentira que conta cada ida à
API remota, soma o peso das respostas e espera um tempo fixo por ida, para
imitar a internet. Os dados foram montados no tamanho aproximado do de vocês:
120 pedidos, 360 parcelas, cerca de 70 notas com os dois XMLs e 150 peças. Os
números reais mudam com o volume e com a conexão, mas as causas não.

| Rota (o que a tela pede)            | Idas à API | Baixado | Com 0 ms | Com 120 ms por ida |
|-------------------------------------|-----------:|--------:|---------:|-------------------:|
| Financeiro › painel de comissões    | 402        | 2,6 MB  | 2,6 s    | **19,9 s**         |
| Financeiro › Produção da competência| 817        | 0,4 MB  | 5,0 s    | **39,3 s**         |
| Financeiro › Comissões atrasadas    | 438        | 2,6 MB  | 2,6 s    | **20,2 s**         |
| Financeiro › Registrar ajuste       | 399        | 2,6 MB  | 2,5 s    | **19,5 s**         |
| Contabilidade › painel              | 204        | 4,5 MB  | 0,4 s    | **3,4 s**          |
| Fiscal › painel                     | 7          | 2,1 MB  | 0,1 s    | 0,5 s              |
| Cobrança › painel de recebimentos   | 10         | 2,3 MB  | 0,1 s    | 0,6 s              |
| Pedidos › lista                     | 2          | 0,03 MB | 0,03 s   | 0,3 s              |

Abrir o Financeiro chama três desses painéis ao mesmo tempo: são **419 idas e
7 MB** só para a primeira tela.

## As causas, da maior para a menor

### 1. A produção monta as peças uma por uma, em fila (o grosso do tempo)
`backend/financeiro/producao.js` › `montarFilas` lê os insumos de cada peça
(`carregarRota`) **um depois do outro**: são 150 idas em série. Ainda lê os
itens e os itens de estoque **um pedido por vez** (`itensDe`, `extDe`), mais
cerca de 210 idas. Com 120 ms por ida, só a fila custa uns 18 s.

A produção entra no painel do Financeiro, na seção "A pagar" do **Dashboard**
(a tela inicial: o `/api/dashboard` só responde quando a seção mais lenta
termina), em Comissões atrasadas, no Registrar ajuste, na Produção da
competência, no fechamento da produção e no rateio. Por isso o atraso aparece
"em todo lugar".

### 2. A Contabilidade busca pedido e cliente um por um
`backend/contabilidade/conciliacao/liquidacoes.js` › `porId` faz uma ida por
pedido (75) e uma por cliente (50). `nomesDosClientes` (Financeiro) e
`clientesDe` (Cobrança) fazem o mesmo com os nomes dos clientes.

### 3. A mesma tabela é lida várias vezes no mesmo painel
- **Financeiro:** feriados três vezes, pedidos e regras duas vezes cada.
- **Contabilidade:** vínculos da conciliação seis vezes, fechamentos, pagamentos e títulos quatro vezes cada.
- **Painel de contas a receber:** é lido inteiro de novo dentro do Financeiro e de novo dentro da Contabilidade.

### 4. O peso: os XMLs das notas viajam em toda leitura
- A API remota ignora o `select`: pedir "só id e nome" devolve a linha inteira.
- As notas fiscais vêm com o XML de envio e o autorizado, uns 2 MB por leitura no tamanho simulado.
- As listas jogam o XML fora logo depois (`semXml`).
- A API também não compacta as respostas (sem gzip): JSON com XML encolhe de 5 a 10 vezes.
- **Segurança:** a leitura genérica de `usuarios` devolve a coluna `senha` (o hash). Isso já está na pendência das permissões da API.

### 5. Ondas em série na Contabilidade
`contabilidade/checklist.js` › `carregar` tem umas oito esperas uma depois da
outra que poderiam correr juntas: situação, resoluções, versão, pacotes,
integrações, contas a pagar (com mais três esperas em série dentro), extrato
(com uma ida por conta) e conciliação.

### 6. Na tela: tempo fixo e spinners diferentes
- **Piso fixo de 1 segundo** em todo módulo (`MIN_MODULE_SPINNER_MS` no `menu.js`) e em quase todo modal (Financeiro, Contabilidade e as 9 cópias de `openModalWithSpinner`). Mesmo o que carrega em 0,1 s espera 1 s. Foi pedido seu em 18/09: o esqueleto parecia travamento.
- **Nove cópias do `openModalWithSpinner`** (Clientes, Contatos, IA, Laminação clientes e serviços, Matéria-prima, Produtos, Prospecções, Usuários), todas **sem relógio de segurança**: se o modal der erro antes de avisar, a tela escura fica presa. Ao todo há quatro mecanismos de spinner diferentes.
- **Modais que avisam "pronto" antes de ter os dados** (o spinner sai cedo e a tela se completa na frente do usuário):
  - `cliente-novo` (Clientes e Laminação) carrega os donos e as cidades depois do aviso;
  - `laminacao-servicos/servico-novo` carrega a lista de clientes depois do aviso.
- **12 módulos não avisam quando os dados terminaram** (`moduleReadyPromise`): Clientes, Contatos, IA, Laminação clientes e serviços, Matéria-prima, Orçamentos, Pedidos, Produtos, Prospecções, Relatórios e Usuários. A máscara sai por um palpite ("a rede ficou quieta por 90 ms"), que às vezes erra para menos (tela pela metade) e às vezes para mais (qualquer outra chamada em andamento segura a tela, até 8 s).
- **Os scripts de modal do Financeiro (335 KB) e da Contabilidade (362 KB)** são baixados e lidos de novo a cada modal aberto.

## O plano

Ordem pensada para o maior ganho com o menor risco, uma fase por vez, com
testes e com a medição acima repetida no fim de cada fase.

### Fase 1 — Backend: fim das idas uma a uma e em fila (maior ganho, nenhuma mudança de tela)
1. **Produção:**
   - `montarFilas` lê `produtos_insumos`, `pedidos_itens` e `pedido_itens_ext` **uma vez cada** e monta as filas em memória;
   - `carregarRota` passa a receber a tabela já lida;
   - o modal de cancelamento, que usa o mesmo `carregarRota`, ganha a mesma leitura única.
2. **Contabilidade:** `liquidacoes.porId` vira uma leitura de pedidos e uma de clientes.
3. **Nomes de clientes:** `nomesDosClientes` e `clientesDe` leem a tabela de clientes uma vez.
4. **Leitura única por requisição:** dentro de uma mesma rota, a mesma tabela com o mesmo filtro é lida uma vez só (memória da requisição no cliente da API). Não muda nenhuma conta e tira as leituras repetidas do item 3 das causas.
5. **Contabilidade em paralelo:** as esperas independentes de `checklist.carregar` correm juntas.
6. **Trava contra regressão:** um teste que sobe as rotas e falha se o painel do Financeiro passar de ~30 idas, a Contabilidade de ~40, e assim por diante.

**Estimativa (120 ms por ida):** painel do Financeiro de ~20 s para ~1,5 s; Produção de ~39 s para ~1 s; Contabilidade de ~3,4 s para ~1,2 s; o Dashboard deixa de esperar a produção.

### Fase 2 — API remota: menos peso (precisa publicar a API de novo)
1. A API passa a respeitar o `select` (só as colunas pedidas), e as listas de notas deixam o XML de fora. A nota cai de ~40 KB para ~1 KB por linha.
2. Compressão gzip nas respostas.
3. A leitura genérica de `usuarios` deixa de devolver `senha`.

**Estimativa:** abrir o Financeiro baixa de ~7 MB para menos de 0,5 MB.

### Fase 3 — Tela: spinner certo, na hora certa
1. **Um spinner só para todo modal:** as 9 cópias e os mecanismos do Financeiro e da Contabilidade passam a usar o `Modal.openWithSpinner`, com relógio de segurança de 15 s, limpeza quando o modal fecha antes e um piso único.
2. **Aviso de pronto só depois dos dados:** `cliente-novo` (as duas cópias) e `servico-novo`, mais uma passada pelos outros modais que avisam cedo.
3. **Os 12 módulos sem aviso** passam a publicar o `moduleReadyPromise`: a máscara sai exatamente quando os dados chegam, nem antes nem depois.
4. **Piso do spinner** (decisão sua, pergunta 1): de 1 s para 0,3 s. *Resposta do dono: não baixar — ficou 1 s.*
5. **Os modais que abrem sem spinner e carregam dados:** sub-modais de Matéria-prima, Produtos, Orçamentos e Prospecções. Os de confirmação (excluir) continuam como estão; os que leem dados ganham o spinner.
6. **Scripts grandes** (Financeiro e Contabilidade): carregados uma vez e reaproveitados nos modais seguintes.

### Fase 4 — Opcional: volta instantânea (pergunta 3)
Ao voltar a um módulo já visitado, a tela mostra na hora o que tinha da última
visita e atualiza por trás, com um aviso discreto enquanto atualiza. Hoje cada
visita recomeça do zero.

## Pendências pedidas para depois do plano — feitas (06/10/2026)

- **Animação de entrada:** a causa não era o número de blocos. Em 12 módulos
  o JavaScript punha `opacity: 1` inline nos blocos durante a carga, e o
  `fadeInUp` (só `to`) partia de 1: a animação rodava, mas não se via.
  - O trecho saiu dos módulos.
  - `src/js/utils/entrada-cascata.js` dá o atraso pela ordem: antes, em Prospecções e na IA a tabela subia antes dos filtros.
  - O bloco fica parado depois da entrada, para não repetir a subida ao filtrar.
  - O cabeçalho deixou de ficar 20 px abaixo até o fim.
  - Conferido quadro a quadro no Electron, ao lado do Financeiro.
- **Contatos:**
  - a tabela não rolava porque o módulo faltava na lista de `scroll.css`;
  - os botões Filtrar/Limpar quebravam linha, espremidos pelas etiquetas de tipo.
  - Agora a tela é igual à de Clientes.

## Rodada de 22/10/2026 — "o sistema parece lento em todos os módulos e modais"

### Como foi medido

O app real rodou na VPS, numa tela virtual, com o banco DEV. Um carregador
fora do repositório pôs **120 ms em cada ida ao banco**, o tempo de uma ida à
API de produção, e anotou cada ida com o tamanho da resposta. A medida da
abertura vai do clique até o carregando sumir. Também se repetiu tudo a
300 ms, para achar o que fica em fila.

### O que se viu

- **Módulos:** quase todos abrem em **1,0 s**, que é o tempo mínimo do
  carregando (decisão do dono, 06/10). Os dados chegam antes: entre 0,1 e
  0,9 s.
- **Modais:** os de "Novo" e a maioria dos de ver ou editar ficam no mínimo
  (1 s ou 0,5 s). As tarefas, que não têm mínimo, abrem em cerca de 50 ms.
- **Os lentos de verdade** eram modais que buscavam os dados **um depois do
  outro**:

  | Modal | Antes (120 ms / 300 ms) | Depois (120 ms / 300 ms) |
  | --- | --- | --- |
  | Visualizar pedido | 2,0 s / 4,6 s | 0,84 s / 1,7 s |
  | Editar orçamento | 1,5 s / 3,3 s | 0,70 s / 1,4–1,7 s |
  | Visualizar orçamento | 0,86 s / 2,0 s | 0,58 s / 1,3 s |
  | Detalhes do cliente | 1,1 s / 2,0 s | no mínimo / 1,1 s |
  | Editar cliente | 1,1 s / 1,7 s | no mínimo / 1,0 s |
  | Editar e Visualizar produto | 1,1 s / 2,0 e 1,3 s | no mínimo / 1,1 s |

- **Salvar orçamento:** caiu de 3,4–3,8 s para 2,6 s, a 120 ms. Eram cerca de
  28 idas em fila, cerca de 1,1 s delas só da auditoria: uma leitura do
  usuário mais 8 registros, gravados um por vez, com a resposta esperando.
- **Aviso "registro de auditoria não confirmado"** depois de salvar um
  orçamento: a descrição da última alteração ia até 500 caracteres, mas a
  coluna do usuário só aceita 255. O banco recusava e a tela avisava.
- **Parado**, o app faz cerca de 30 idas por minuto (sino e verificação de
  conexão). As 71 idas nos primeiros 10 s são a carga do Dashboard.
- **Dados grandes:** o plano de contas (1,1 MB) ia inteiro a cada abertura do
  Financeiro e da Contabilidade. As rotas das peças (600 KB) iam no Dashboard
  e no Financeiro.

### O que mudou

- **Modais:** o que só depende do registro aberto sai junto, logo depois
  dele, e cada resposta é lida no mesmo lugar de antes. Mudaram
  `pedido-visualizar.js`, `orcamento-editar.js`, `orcamento-visualizar.js`,
  `cliente-detalhes.js`, `cliente-editar.js` e `produto-editar.js`.
- **Backend:**
  - **Boletos do pedido:** `estadoDoPedido` lê os nomes e o secret junto com
    o pedido (4 rodadas → 2). Serve ao Visualizar pedido, ao Gerar boletos e
    ao Emitir NF-e.
  - **Produtos:** `listarProdutos` lê produtos, lotes e preços praticados
    juntos (3 → 1). Serve a Produtos, aos orçamentos e aos relatórios.
  - **Visualizar produto:** `listarDetalhesProduto` lê os lotes junto com o
    produto.
- **Salvar orçamento:** itens e parcelas são trocados ao mesmo tempo, e as
  exclusões também. As inclusões continuam uma por vez, porque é a ordem de
  inclusão que dá a posição na tela e no PDF: a API ignora `order`.
- **Auditoria** (`auditoriaCaptura.js`):
  - a pessoa é identificada na primeira gravação, não no fim (vale para
    todo salvamento);
  - os efeitos de uma ação são gravados em grupos de 6, depois da ação.
    Entre os efeitos da mesma ação, a ordem pode variar em milissegundos.
- **Auditoria, última alteração:** `userActivity.camposDaAlteracao` corta o
  texto em 255 caracteres (o texto inteiro continua na auditoria).
- **Menos peso:**
  - o checklist da Contabilidade lê o plano só com as colunas do
    "comprovante basta" (1,17 MB → 0,63 MB). Se a API recusar o `select`, lê
    inteiro como antes;
  - as rotas das peças vêm sem a coluna que não se usa;
  - nenhum dos dois passa por `b.ler`, cujo filtro trataria o `select` como
    coluna.

### O que ficou para o dono decidir

O tempo mínimo do carregando: **1 s** nos módulos e nos modais deles, e
**0,5 s** nos de Pedidos. Hoje ele é a maior espera fixa de cada abertura.
Mudar é só trocar as constantes `MIN_MODULE_SPINNER_MS` (`menu.js`) e
`PISO_DOS_MODAIS_DO_MODULO_MS`/`minSpinnerMs` (`modal.js`).
