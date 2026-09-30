# Contabilidade — roteiro para colocar no ar e homologar

Data: 29/09/2026 (atualizado em 30/09/2026). Tudo o que o dono precisa fazer
para as etapas 1 a 9 do módulo Contabilidade funcionarem — e as rodadas
seguintes (tela nova, mensagens e comentários, o "'" que cita objetos, também
em Contatos; e a **estrutura das integrações, etapas 10 a 13**): preparar o
banco, reiniciar a API, dar as permissões, testar no programa (primeiro no
DEV, com os dados simulados) e depois passar para a produção. O plano e as
regras de cada etapa estão em `docs/contabilidade-fechamento-plano.md`
(seções R a AA). **As integrações (SEFAZ, BB, ADN, CDB) têm roteiro próprio:
`docs/contabilidade-integracoes-roteiro.md`** — o que fazer no portal do BB,
o que fornecer, como ligar e testar.

---

## 0. Antes de começar

1. As rodadas até a seção Z do plano já estão no git ("Fase 10"). **A das
   integrações (seção AA) não está**: faça o commit dela como fez com as
   outras.
2. **Cópia de segurança do banco DEV** (opcional, recomendado). No pgAdmin:
   botão direito no banco › Backup… (formato Custom) › Backup.
3. Conferir se o app está em **modo DEV** (`BANCO=DEV` no `.env` do
   App-Gestão). Os testes com dados simulados são **só no DEV**.

## 1. Os SQLs no banco DEV

Estão na pasta `sql/` do App-Gestão. Já rodaram antes (não precisa de novo):
`contatos_fornecedores.sql` e `contabilidade_base.sql`. **Em 29/09 você já
rodou os de 1 a 8 no DEV** ("JA RODEI TUDO"): falta só o **9**.

**Rodar, nesta ordem:**

| # | Arquivo | O que cria |
|---|---|---|
| 1 | `contabilidade_contas_pagar.sql` | arquivos/evidências, documentos recebidos, contas a pagar (7 tabelas) e 5 permissões |
| 2 | `contabilidade_extrato.sql` | contas do banco, importações e lançamentos do extrato (3 tabelas) e 2 permissões |
| 3 | `contabilidade_conciliacao.sql` | vínculos da conciliação, 4 colunas nos lançamentos e 1 permissão |
| 4 | `contabilidade_classificacao.sql` | plano de contas (10 contas), regras (9) e classificações; 2 permissões |
| 5 | `contabilidade_fechamento.sql` | as versões do fechamento |
| 6 | `contabilidade_pacote.sql` | o registro dos pacotes |
| 7 | `contabilidade_dados_simulados_dev.sql` | **só no DEV**: um mês de exemplo (julho fechado, agosto cheio, setembro em curso) |
| 8 | `contabilidade_mensagens.sql` | as **Mensagens e comentários** da Contabilidade (1 tabela) e a trava de origem do social refeita — **conserta também o social de Contatos**, que o banco recusava (curtir/comentar num contato dava erro) |
| 9 | `contabilidade_integracoes.sql` | as **integrações** (etapas 10 a 13): a configuração das 4 (desligadas, em homologação), o registro das buscas e a caixa de entrada das NF-e/NFS-e (3 tabelas). Ver `docs/contabilidade-integracoes-roteiro.md` |

O 8 precisa do `historico_social.sql` (rodado em 18/09). Todos podem rodar de
novo sem estragar nada. O modelo **Administrador** já
recebe as permissões novas pelo próprio SQL (o Sup Admin tem tudo).

### Pelo pgAdmin (mais fácil)

1. Abra o pgAdmin › servidor do DEV › o banco do DEV › **Query Tool**.
2. Ícone de pasta (**Open File**) › escolha o arquivo 1 da tabela.
3. **Execute** (F5). Tem de terminar com *Query returned successfully*.
   Aviso "já existe, pulando" (NOTICE) é normal.
4. Repita para os arquivos 2 a 7, **na ordem**.
5. No arquivo 7: se o nome do banco DEV **não** tiver dev, local, test ou
   homolog, o SQL para com um aviso. Se for mesmo o DEV, rode antes, na mesma
   janela: `SET app.confirmo_dev = 'sim';` e depois o arquivo.

### Ou pelo psql (Prompt de Comando, na pasta do App-Gestão)

Troque `PORTA` e `BANCO_DEV` pelos do seu banco DEV (vai pedir a senha):

```bat
set PSQL="C:\Program Files\PostgreSQL\17\bin\psql.exe" -h localhost -p PORTA -U postgres -d BANCO_DEV -v ON_ERROR_STOP=1
%PSQL% -f sql\contabilidade_contas_pagar.sql
%PSQL% -f sql\contabilidade_extrato.sql
%PSQL% -f sql\contabilidade_conciliacao.sql
%PSQL% -f sql\contabilidade_classificacao.sql
%PSQL% -f sql\contabilidade_fechamento.sql
%PSQL% -f sql\contabilidade_pacote.sql
%PSQL% -f sql\contabilidade_dados_simulados_dev.sql
%PSQL% -f sql\contabilidade_mensagens.sql
%PSQL% -f sql\contabilidade_integracoes.sql
```

Os arquivos começam com `SET client_encoding = 'UTF8'`: os acentos saem
certos também pelo psql.

### Conferir (no Query Tool)

```sql
-- Tem de dar 16:
SELECT count(*) FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN (
  'contabil_arquivos','contabil_arquivo_partes','contabil_arquivo_vinculos','documentos_recebidos',
  'titulos_pagar','titulo_pagar_parcelas','titulo_pagar_pagamentos','contas_financeiras',
  'extrato_importacoes','movimentos_bancarios','conciliacao_vinculos','plano_contas',
  'classificacao_regras','classificacoes','competencia_fechamentos','contabil_pacotes');

-- Tem de dar 16 colunas (acao_classificar … acao_view):
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'perm_contabilidade' AND column_name LIKE 'acao_%' ORDER BY 1;

-- Acentos certos: tem de voltar "Serviços de Terceiros".
SELECT nome FROM plano_contas WHERE nome LIKE 'Servi%';

-- SQL 8: a tabela das mensagens existe e a trava aceita contato e contabilidade
-- (tem de voltar 4 linhas, cada uma com '... contato ... contabilidade ...'):
SELECT to_regclass('public.contabil_mural_historico') IS NOT NULL AS mural;
SELECT conrelid::regclass, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname LIKE 'historico_%_origem_check';

-- SQL 9: as 4 integrações, desligadas e em homologação (tem de dar 4 linhas):
SELECT chave, ativa, ambiente FROM contabil_integracoes ORDER BY id;
```

## 2. Reiniciar

- **DEV:** feche o App-Gestão **por inteiro** e abra de novo (o app guarda na
  memória as colunas de cada tabela; sem reabrir, ele não vê as colunas
  novas).
- **Produção** (no passo 6): reinicie a **API do banco** (Santissimo-db-API:
  o `node server.js`, do jeito que você sobe hoje — terminal, pm2 ou
  serviço). Ela lê a lista de tabelas **e de colunas** só quando liga; sem
  reiniciar, ela responde "Tabela não encontrada" e descarta as colunas novas
  ao gravar. Depois, feche e abra o App-Gestão.
- Conferir a API: abra `http://ENDERECO_DA_API:PORTA/status` no navegador
  (a porta é a `API_PORT` da API; 3010 se não mudou). Anote o número
  `tabelas_carregadas` **antes** de rodar os SQLs: depois de reiniciar, ele
  tem de estar **20** a mais (16 das etapas + a das mensagens + as 3 das
  integrações). Se os 1 a 8 já tinham rodado e a API já foi reiniciada, o 9
  soma **3**.

## 3. Permissões

Menu **Usuários** › **Modelos de Permissão** (só o Sup Admin vê) › escolha o
modelo › grupo **Contabilidade** › marque › **Salvar**. O Administrador já
vem com tudo marcado pelo SQL.

| Permissão | Para quem |
|---|---|
| Ver o fechamento | quem acompanha o mês (vê tudo, inclusive relatório e dossiê) |
| Fechar competência / Reabrir competência | quem fecha o mês |
| Ignorar pendência | quem pode justificar pendência documental/aviso |
| Registrar documentos e anexar arquivos / Excluir documento ou arquivo | quem lança NF-e de entrada, NFS-e, recibos |
| Lançar contas a pagar / Registrar pagamento / Estornar pagamento e cancelar conta | financeiro |
| Importar extrato / Cadastrar contas financeiras | quem baixa o OFX do BB |
| Conciliar o extrato / Classificar lançamentos | quem concilia e classifica |
| Plano de contas e regras | quem cuida do plano (poucas pessoas) |
| Gerar relatório e pacote | quem salva o PDF/planilha e manda para a contabilidade |

## 4. Testar no programa (DEV, com os dados simulados)

O simulado usa a conta **"BB — conta corrente (simulada)"** e três meses:
julho/2026 **fechado** (antes das versões, com um pacote já enviado),
agosto/2026 **cheio de pendências** (extrato só até 28/08) e setembro/2026 em
curso. Faça na ordem; ao lado de cada passo, o que tem de aparecer. Se algo
não bater, tire um print e me mande com o passo.

### 4.1 Tela principal (etapa 1)
1. Menu **Contabilidade** (logo abaixo do Financeiro). → Abre no mês passado.
2. Escolha **agosto/2026** (mês + ano + lupa). → Cartões: situação
   **Aberta**, críticos, documentais, avisos; checklist por fonte; lista de
   pendências (**todas**, sem "Ver todas": o cartão tem a altura do das Ações
   e a lista rola por dentro, com a barra dourada da casa); embaixo,
   **Atividade recente** e **Mensagens e comentários**, lado a lado, com a
   mesma altura.
3. Role a tela até o topo e clique no cartão **Documentais**. → A tela
   **desliza sozinha** até o cartão das pendências, já filtrado em
   "Documentais". Faça o mesmo com **Erros críticos** e **Avisos**. Clicar de
   novo no mesmo cartão mantém o filtro (o chip "Todas" volta a mostrar tudo).
4. Na lista, **Ignorar** num aviso (justificativa de 10+ letras). → Vai para
   "Ignoradas"; **Restaurar** traz de volta.
5. Erro crítico vindo dos seus dados reais do DEV (NF-e parada, cobrança):
   anote qual; não se ignora (resolva no Financeiro ou me mande).

### 4.2 Documentos e contas a pagar (etapas 2 e 3)
1. Ações › **Contas a pagar**. → Parcelas de agosto/setembro (Vidros Norte,
   aluguel, DAS…), com os totais no alto.
2. Abra uma conta. → Parcelas, pagamentos, arquivos, histórico e os botões
   **Dossiê** (azul claro) e **Editar**.
3. **Nova conta a pagar**: descrição, valor 900,00, 3 parcelas › **Dividir**
   › **Salvar**. → Três parcelas de 300,00, vencimentos mensais.
4. Numa parcela aberta, **Pagar** (com um PDF de comprovante). → Parcela
   "Paga"; o comprovante aparece nos arquivos.
5. Ações › **Registrar NF-e, NFS-e ou recibo** › aba "NF-e pelo XML" › escolha
   um XML de NF-e de compra. → Prévia com emitente, itens, duplicatas e
   parcelas sugeridas; **Registrar** cria o documento e a conta.
6. Ações › **Documentos da competência** (agosto). → NF-e, NFS-e,
   comprovantes; "NF-e 2/881 — Madeiras" aparece como **FALTA** (sem XML).
7. Tente pagar algo com data de **julho**. → Recusado: "competência fechada".

### 4.3 Extrato (etapa 4)
1. Ações › **Extrato bancário** (agosto). → Lançamentos até 28/08; cobertura
   avisa que faltam 29 a 31.
2. **Importar OFX** › escolha `sql/contabilidade_extrato_exemplo_dev.ofx`. →
   Prévia: **2 novos, 2 já importados**; **Importar**. → Agosto fica completo
   e a pendência do extrato some.
3. Nas importações, **Desfazer** a que você acabou de fazer (com motivo). →
   Os 2 lançamentos saem. Importe de novo para seguir.
4. **Contas do banco**. → A conta simulada; **Cadastrar outra** funciona
   (depois desative, se quiser).

### 4.4 Conciliação (etapa 5)
1. Ações › **Conciliação bancária** (agosto). → Aluguel (05/08) e DAS
   (20/08) **Conciliados**; Pix de balcão (10/08) **Ignorado**; outros com
   sugestão.
2. **Aceitar** uma sugestão. → Vira "Conciliado".
3. **Escolher** num lançamento sem sugestão › marque o que casa (a soma tem
   de bater) › **Conciliar**.
4. Em setembro, na energia de 18/09: **Lançar como conta paga**. → Cria a
   conta a pagar já paga e conciliada.
5. **Desfazer** uma conciliação (com motivo). → Volta a "A conciliar".
6. **Aceitar sugestões únicas** e **Conciliar automaticamente**. → Pede
   confirmação e diz quantos fez.

### 4.5 Classificação (etapa 6)
1. Ações › **Classificação** (agosto). → Cada lançamento com a conta do plano
   e como (à mão, pela conta a pagar, pela origem, por regra); os créditos de
   cobrança **sem classificação**; total por conta e o resultado no fim.
2. Marque 2 lançamentos › escolha a conta › **Classificar marcados**.
3. Num crédito de cobrança, **Regra** › **Testar no mês** (diz quantos pega)
   › **Salvar**. → Os créditos passam a ter conta.
4. **Plano de contas**: renomeie uma conta e volte o nome. Crie uma conta
   nova (ex.: "Energia elétrica").

### 4.6 Fechamento completo (etapa 7)
1. Resolva ou **Ignore com justificativa** as críticas que houver em agosto.
2. **Fechar competência** › veja "O que fica congelado" (versão 1, resultado,
   extrato) › **Confirmar fechamento**. → Topo: "Fechada em … · versão 1".
3. Na Classificação de agosto: as linhas ficam "no fechamento" e não trocam.
4. Em **Regras**, troque a conta da regra que você criou no 4.5 (ex.: para
   "Aporte de Capital") › salvar. → Na Classificação de agosto a conta
   congelada continua, com "Hoje seria: Aporte de Capital"; no painel, o aviso
   "N diferenças desde o fechamento". Depois volte a regra como era.
5. Ações › **Histórico dos fechamentos**. → Versão 1 "Vale", a diferença
   listada.
6. **Reabrir** (justificativa) e **Fechar** de novo. → Versão 2; o histórico
   compara as duas.
7. Julho: histórico vazio ("fechado antes das versões"). Setembro: fechar é
   recusado (mês em curso).

### 4.7 Relatório mensal e dossiê (etapa 8)
1. Ações › **Relatório mensal** (agosto fechado). → "Fechada · v2"; Resumo com
   receitas, custos e despesas, resultado; contas do banco.
2. Aba **Livro-caixa**: saldo inicial, cada lançamento com débito/crédito,
   saldo, conta do plano, de quem é o dinheiro e vencimento; "Total do dia" e
   "Total do período".
3. Clique num lançamento. → **Dossiê**: no banco, conciliação, classificação,
   arquivos, histórico; **Ver dossiê** leva à conta a pagar; **← Anterior**
   volta.
4. Abas Resultado, Conciliação, Pendências, Documentos.
5. **Salvar PDF** (abre o PDF) e **Salvar planilha (Excel)** (8 abas).
6. Setembro: o relatório sai como **PRÉVIA** (marca em toda folha do PDF).

### 4.8 Pacote (etapa 9)
1. Setembro › **Gerar pacote**. → "Ainda não dá": precisa estar fechada.
2. Agosto (fechado): cada pendência **documental** que ainda estiver viva,
   resolva ou **Ignore com justificativa** (o pacote só sai sem elas). → No
   painel: "Pacote ainda não enviado" (aviso).
3. **Gerar pacote (ZIP)**. → Pergunta onde salvar. Salve em **Downloads**.
4. Abra o ZIP (botão direito › Extrair tudo, numa pasta curta). → Pastas
   01-Relatorio (PDF + planilha), 02-Extrato (OFX), 05-Recebidos,
   06-Comprovantes…, **LEIA-ME.txt** (o que tem e o que falta) e
   **indice.csv** (SHA-256 de cada arquivo).
5. No modal: o pacote novo "Não enviado" › **Para quem** + **Como** ›
   **Marcar como enviado**. → O aviso some; o topo diz "pacote enviado em …".
6. Reabra e feche agosto de novo. → Aviso: "o pacote enviado é da versão 2;
   a competência está na versão 3".
7. Julho: o pacote simulado aparece como enviado.

### 4.9 Permissões
1. Entre com um usuário de um modelo **sem** "Gerar relatório e pacote". → O
   relatório abre, mas "Salvar PDF/planilha" e os itens do pacote somem ou
   ficam desativados.
2. Um usuário só com "Ver o fechamento". → Vê tudo; nenhum botão que grava
   (mas pode escrever nas mensagens: elas vêm com "Ver o fechamento").

### 4.10 Atividade recente e Mensagens e comentários (depois do SQL 8)
1. **Atividade recente**: o cartão rola por dentro; **Ver todas** abre o
   modal grande: a linha do tempo por dia, a foto (ou as iniciais) de quem
   fez, a etiqueta colorida do tipo e a competência; filtros **Buscar**,
   **Tipo** e **Quem fez**.
2. **Mensagens e comentários** (cartão): escreva "Teste" › **Publicar**. →
   Aparece no topo, com a sua foto e a etiqueta **Mensagem**.
3. Escreva **@** e escolha um colega › Publicar. → Ele recebe no sino "Você
   foi mencionado"; clicar no aviso abre a Contabilidade e o modal das
   mensagens já na mensagem.
4. Escreva **'** (apóstrofo) ou clique no botão de **corrente** › apareça a
   lista "Citar um item da Contabilidade": a competência, as pendências da
   tela, documentos, contas… Digite "nf" ou o nome de um fornecedor para
   filtrar; "pix" acha lançamentos do extrato (da competência da tela);
   "servi" acha a conta do plano. Escolha um › Publicar. → Vira uma etiqueta
   **azul clara** com ícone.
5. Clique na etiqueta de cada tipo. → Documento abre a ficha do documento;
   conta a pagar abre a conta; lançamento abre o dossiê; pacote e fechamento
   abrem os modais deles; arquivo abre no programa do computador;
   competência leva a tela para ela; pendência leva a tela até a lista e a
   linha **pisca**; fornecedor abre a ficha em Contatos.
6. **Curtir**, **Comentar**, **Responder** (e responder a resposta),
   **Anexar** um arquivo. → Quem escreveu a mensagem recebe o aviso do
   comentário; quem foi respondido, o da resposta.
7. **Ver tudo** abre as mesmas mensagens no modal grande; lá, clicar numa
   etiqueta abre o objeto **por cima** (fechou, volta às mensagens).
8. Com duas pessoas (dois computadores ou dois usuários), a mensagem de uma
   aparece na outra em até 10 s (ao vivo).

### 4.11 Contatos: o "'" na linha do tempo (depois do SQL 8)
1. CRM › **Contatos** › abra um fornecedor que tenha documento ou conta na
   Contabilidade (ex.: do simulado) › aba **Histórico**.
2. **Curtir** e **Comentar** um registro. → Grava (antes do SQL 8 dava erro:
   o banco não aceitava "contato").
3. Na caixa, **'** › a lista traz as **pessoas** e as **atividades** do
   contato e, para quem vê a Contabilidade, os **documentos**, as **contas a
   pagar** e os **arquivos** dele. Publique com um de cada.
4. Clique na etiqueta: pessoa → aba "Pessoas de contato" com a linha
   piscando; atividade → aba "Atividades" com o cartão destacado; documento
   ou conta → fecha a ficha e abre na Contabilidade.

### 4.12 Integrações (depois do SQL 9)
Siga `docs/contabilidade-integracoes-roteiro.md`: a Parte G é o checklist
visual (Configurações, os quatro cartões, a caixa de entrada, "Buscar no BB"
no Extrato) e as Partes B a E, uma integração por vez.

## 5. Testes automáticos (opcional)

No terminal, na pasta do App-Gestão:

```bat
node --test src/js/__tests__/
```

Esperado: 1236 testes, 1 falha antiga (o logout automático, que já falhava
antes do módulo). Os da Contabilidade no backend, um de cada vez:

```bat
node --test backend/contabilidade/checklist.test.js
node --test backend/contabilidadePacote.test.js
node --test backend/contabilidade/citaveis.test.js
node --test backend/historicoSocial.test.js
node --test backend/contabilidadeIntegracoes.test.js
node --test backend/contabilidade/integracoes/clientes.test.js
node --test backend/contabilidade/integracoes/nucleo.test.js
```

(os outros: `backend/contabilidade*.test.js`, os de
`backend/contabilidade/**` e `backend/contatosController.test.js`).

## 6. Produção

Só depois do "ok" no DEV.

1. **Backup** do banco de produção.
2. Rodar os SQLs **1 a 6, o 8 e o 9** do passo 1 no banco de produção.
   **Nunca** o 7 (simulado) — ele se recusa a rodar se o nome do banco não
   for de DEV.
3. Reiniciar a **API do banco** (passo 2) e conferir o `/status` (+20
   tabelas).
4. Fechar e abrir o App-Gestão; conferir as permissões (passo 3).
5. Configuração inicial com dados reais:
   - **Contas do banco**: "Usar a conta dos boletos" (a do BB da cobrança).
   - **Plano de contas** e **Regras**: revisar os nomes (ou trocar pela lista
     da contabilidade, quando vier).
   - Escolher a **primeira competência** que vai valer (pendência 3) e
     importar o **OFX real** do BB desse mês (Gerenciador Financeiro ›
     extrato › exportar OFX).
6. Fechar o primeiro mês real seguindo 4.2 a 4.8.
7. Ligar as integrações em produção pelo roteiro próprio
   (`docs/contabilidade-integracoes-roteiro.md`, Partes A a E).
8. A pasta `sql/` pode ser limpa depois de rodar (como você faz).

## 7. O que me mandar de volta

- O resultado de cada bloco do passo 4 (ok, ou o print do que não bateu).
- Um **OFX de verdade** do BB (qualquer mês), para conferir o leitor.
- As respostas das pendências abaixo (pode ser "ok" nas que concordar).

## 8. Pendências (decisões suas) — lista única

Juntei aqui tudo o que ficou em aberto nas etapas; a numeração substitui a
dos relatórios de cada etapa.

**Gerais**
1. Pendência documental e aviso podem ser ignorados com justificativa; erro
   crítico nunca; o mês só fecha depois do último dia. Confirmar.
2. A lista de categorias da contabilidade (plano de contas) e se ela usa
   código de conta.
3. A partir de qual competência o módulo vale (a primeira a fechar).

**Documentos e contas a pagar**
4. NFS-e de cada pagamento de comissão/produção é **documental**; quem não
   emite nota se resolve com "Ignorar" + justificativa. Confirmar.
5. Pagamento sem nota/recibo é documental; sem comprovante é só aviso.
   Confirmar.

**Extrato**
6. Extrato incompleto de mês encerrado é **documental**. Confirmar.
7. Desfazer importação com motivo, da mais nova para a mais antiga. Confirmar.
8. Existe caixa físico (dinheiro) que precise de conta própria?
9. API de Extratos do BB (etapa 11): a estrutura está pronta — o passo a
   passo (portal do BB, credenciais, conta de teste) está na Parte C do
   roteiro das integrações.

**Conciliação**
10. Lançamento sem conciliação é **documental**. Confirmar.
11. Automático só com chave exata (CNPJ/CPF ou nº do documento). Aceitar
    sozinho quando valor e dia batem e o nome aparece na descrição?
12. Conciliação com recebimento estornado é **crítico**. Confirmar.
13. O banco desconta a tarifa do crédito de cobrança, ou lança a tarifa à
    parte?

**Classificação**
14. Os nomes das contas criadas pelo app (Receita de vendas, Devoluções e
    reembolsos, Comissões sobre vendas, Produção (colaboradores), Despesas
    bancárias, Transferência entre contas) estão bons?
15. Lançamento sem classificação é **documental**. Confirmar.
16. Um lançamento só cai numa conta. Precisa dividir entre duas?

**Fechamento**
17. Diferença depois do fechamento é só aviso. Confirmar.
18. Reabrir um mês com o seguinte fechado: deve travar?
19. Fechar um mês com o anterior aberto: deve exigir o anterior fechado?
20. Mês fechado antes das versões fica sem foto (reabrir e fechar de novo
    para ter). Está bom?

**Relatório**
21. Formato para a contabilidade: livro-caixa e "Partidas" vão os dois na
    planilha. Qual ela usa? Falta coluna?
22. Ver o relatório pede só "ver"; salvar pede "Gerar relatório e pacote". Ok?
23. Pode salvar a PRÉVIA (mês aberto)? Ou só o de mês fechado?
24. Saldo inicial pelo saldo que o banco informa no OFX. Ok?

**Pacote**
25. O app não manda o e-mail (sua decisão). Quer que mande no futuro?
26. E-mail da contabilidade fixo na Configuração?
27. Guardar uma cópia do ZIP no app?
28. "Pacote ainda não enviado" é aviso (não bloqueia). Confirmar.

**Tela e mensagens (29/09)**
29. As mensagens são **um mural só** para o módulo (não um por competência);
    a competência entra citando-a com "'". Ok?
30. Mensagem nova avisa só quem é mencionado com **@** (comentário avisa quem
    escreveu; resposta, quem foi respondido). Quer que toda mensagem nova
    avise todo mundo que vê a Contabilidade?
31. Quem vê as mensagens e escreve nelas é quem tem "Ver o fechamento". Ok,
    ou quer uma permissão própria para escrever?
32. O cartão das pendências tem a altura do das Ações (a lista rola dentro).
    Prefere uma altura menor (ex.: 8 linhas) e as Ações rolando também?
33. No "'" de Contatos, documentos e contas só aparecem para quem vê a
    Contabilidade, e clicar neles fecha a ficha do contato e abre na
    Contabilidade. Ok?

**Integrações (30/09)** — as pendências **34 a 47** estão no fim de
`docs/contabilidade-integracoes-roteiro.md`.
