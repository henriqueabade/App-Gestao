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
- **Na tela:** voltar a um módulo já visitado mostra a tela na hora (Fase 4). O piso do spinner continua o de antes.

### Decisões (as do dono, de 06/10/2026, e as técnicas)
1. **Piso do spinner (dono): NÃO baixar.** Ficou como sempre foi:
   - 1 s nos módulos, no Financeiro, na Contabilidade e nos modais dos módulos;
   - 0,5 s nos modais de Pedidos e nos abertos por cima;
   - nenhum no Visualizar/Editar orçamento, que aparece quando o orçamento chega.
   - Uma primeira versão tinha baixado tudo para 0,3 s; foi desfeita.
2. **API da internet (dono): pode, desde que não quebre nada.** Foi auditada ponto a ponto (abaixo, Fase 2). Precisa ser publicada de novo; sem isso o programa funciona igual, só baixa mais.
3. **Volta instantânea (dono): sim, mas sem perder a atualização ao vivo.** Por isso é uma FOTO só para a espera, e não um cache:
   - a cada volta, o módulo é buscado e lido do zero, como sempre;
   - a foto sai assim que os dados novos chegam;
   - o que outro usuário mudou aparece na volta, e as atualizações por evento e o sino continuam iguais;
   - nunca há dois elementos com o mesmo id, nem ninguém editando dado velho.
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

**Fase 4 (volta instantânea):**
- ao sair de um módulo pronto, o menu pede ao Electron uma foto só da área do módulo (`main.js › 'modulo:fotografar'`);
- a troca de módulo espera só a leitura da tela: 30–50 ms medidos, com teto de 150 ms. O JPEG (~10 ms) sai depois, por fora;
- ao voltar, a foto aparece com o selo "Atualizando…" e o módulo carrega por baixo. Quando ele fica pronto, a troca é sem animação e na mesma rolagem;
- **não há foto quando:**
  - há modal ou aviso por cima;
  - o módulo ainda está carregando;
  - o layout mudou (janela, barra lateral, tema);
  - a foto passou de 30 min;
  - nesses casos, a máscara de sempre;
- a foto fica só na memória da janela;
- trava: `src/js/__tests__/voltaInstantanea.test.js`, que também confere que a foto nunca encurta a releitura;
- conferido no Electron com o `menu.html` e o `preload.js` de verdade, inclusive com um "outro usuário" cadastrando um cliente entre a saída e a volta. A foto mostrou 12 clientes; a tela viva, logo depois, os 13.

### O que o dono precisa fazer
1. Tudo está na branch `Otimização-de-Carregamentos` (nos dois repositórios); a `main` ficou como estava. Juntar à `main` quando aprovar.
2. **Publicar a API** (Santissimo-db-API, a partir dessa branch) e reiniciá-la. Até lá, o programa funciona, só baixa mais.
3. **Fechar e abrir o programa.** `main.js` e `preload.js` mudaram (a foto da volta instantânea).
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
