# Contabilidade — integrações automáticas (etapas 10 a 13): o que fazer e o que fornecer

Data: 30/09/2026. A estrutura está pronta: as quatro integrações têm tela,
backend, agenda automática, registro de cada busca e testes. **Falta só você
ligar, preencher e testar** — este roteiro diz tudo, na ordem.

| Etapa | Integração | Onde fala | O que precisa de novo |
|---|---|---|---|
| 10 | **NF-e de entrada** (notas emitidas contra o CNPJ) | SEFAZ — Distribuição de DF-e e manifestação (Ambiente Nacional) | nada: usa o certificado A1 e a Configuração fiscal que já existem |
| 11 | **Extrato da conta** | BB — API de Extratos **v2** | aplicação própria no Portal Developers, com o certificado nos dois ambientes (feito em 02/10/2026) |
| 13 | **NFS-e tomadas** (serviços que a empresa contrata) | ADN — Ambiente de Dados Nacional da NFS-e | nada, em princípio: usa o certificado A1 |
| 12 | **Aplicações — CDB** | BB — API ainda a definir | o BB dizer qual API consulta o CDB da empresa |

Na tela: **Contabilidade › Ações › Configurações** (os cartões das quatro) e
**Contabilidade › Ações › NF-e e NFS-e da SEFAZ/ADN** (a caixa de entrada do
que as buscas acham). O plano técnico está em
`docs/contabilidade-fechamento-plano.md` (seção AA).

> **Segurança.** Nenhum segredo passa pelo chat nem fica no código: o
> client_secret do BB é colado **só na tela** (é cifrado e nunca volta), a
> senha do certificado continua onde está (Configuração fiscal). O
> "certificado público (.cer)" que a tela baixa **não tem a chave privada**:
> pode ser enviado ao portal do BB sem risco.

---

## Parte A — uma vez só (banco, reinício, permissões, travas)

### A1. Commit
Esta rodada **não está no git**. Faça o commit como nas outras ("Fase 11",
por exemplo) antes de rodar os SQLs.

### A2. O SQL novo (9)
Arquivo: `sql/contabilidade_integracoes.sql`. Cria 3 tabelas:

| Tabela | Para quê |
|---|---|
| `contabil_integracoes` | a configuração de cada integração (ligada, ambiente, busca automática, parâmetros, NSU, último erro) — já vem com as 4, **desligadas e em homologação** |
| `contabil_integracao_execucoes` | o registro de cada busca/teste (e a trava para duas máquinas não buscarem ao mesmo tempo) |
| `contabil_dfe_recebidos` | a caixa de entrada: cada NF-e e NFS-e encontrada, com o XML e os eventos |

Rode **primeiro no DEV** (pgAdmin › Query Tool › abrir o arquivo › F5, ou
pelo psql como no roteiro de homologação). Pode rodar de novo sem estragar
nada. Conferir:

```sql
-- Tem de dar 4 linhas, todas ativa = false e ambiente = homologacao:
SELECT chave, ativa, ambiente, automatica, intervalo_min FROM contabil_integracoes ORDER BY id;
-- Tem de dar 3:
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
 AND table_name IN ('contabil_integracoes','contabil_integracao_execucoes','contabil_dfe_recebidos');
```

### A3. Reiniciar
- **DEV:** feche o App-Gestão por inteiro e abra de novo.
- **Produção:** rode o mesmo SQL no banco de produção, **reinicie a API do
  banco** (Santissimo-db-API) e confira o `/status`: `tabelas_carregadas`
  tem de subir **3**. Depois feche e abra o App-Gestão.

Sem o SQL, a tela de Configurações avisa "rode
sql/contabilidade_integracoes.sql" — nada quebra.

### A4. Permissões (Usuários › Modelos de Permissão › Contabilidade)
Não há permissão nova; as integrações usam as que já existem:

| O quê | Permissão |
|---|---|
| Abrir Configurações, ver o que falta, **Testar conexão** | Ver configuração |
| **Mudar** a configuração, guardar/remover o client_secret, ligar a produção, baixar o .cer | só o **Sup Admin** |
| Buscar NF-e na SEFAZ, buscar NFS-e no ADN, e na caixa de entrada: ciência, manifestar, baixar XML, registrar, ignorar, restaurar | Registrar documentos e anexar arquivos |
| Buscar o extrato no BB | Importar extrato |
| Ver a caixa de entrada | Ver o fechamento |

### A5. As travas do `.env` (por máquina)
Três variáveis prendem **a máquina** em homologação, mesmo que a tela diga
"Produção" (o cartão mostra a etiqueta **"Máquina presa em homologação"**):

| Variável | Prende | Observação |
|---|---|---|
| `NFE_AMBIENTE=homologacao` | SEFAZ e ADN | é a **mesma** da emissão de NF-e: se estiver no `.env`, a emissão também fica em homologação |
| `BB_AMBIENTE=sandbox` (ou `homologacao`) | Extrato e CDB | é a **mesma** da cobrança |
| `CONTABILIDADE_INTEGRACOES_AMBIENTE=homologacao` | as quatro | **nova**, só das integrações: use no computador de testes para nunca buscar em produção sem mexer na NF-e nem na cobrança |

Para usar produção numa máquina, ela não pode ter nenhuma dessas travas
valendo para a integração. Depois de mexer no `.env`, feche e abra o app.

### A6. Onde o client_secret fica guardado
Na hora de guardar, a tela pergunta:
- **No banco (todas as máquinas)** — cifrado com a `SEGREDOS_CHAVE_MESTRA`
  do `.env` (a mesma que já guarda os segredos da cobrança). Cada máquina
  que for buscar precisa ter essa mesma chave no `.env`.
- **Só neste computador** — no cofre do Windows desta máquina.

Se a cobrança já funciona com o secret "no banco", a chave-mestra já está
certa.

---

## Parte B — NF-e de entrada pela SEFAZ (etapa 10)

**Você fornece:** nada de novo. Confira só que o certificado A1 aparece no
alto das Configurações (titular, CNPJ, validade) e que a Configuração fiscal
tem CNPJ e UF (a mesma da emissão).

**Antes de ligar, decida** (pendências 34, 35 e 38): ciência automática
(padrão **sim**), registro automático (padrão **sim**), lançar a conta a
pagar junto (padrão **não**).

1. Configurações › cartão **NF-e de entrada (SEFAZ)** › marque **Ligada**,
   ambiente **Homologação** › **Salvar**.
2. **Testar conexão**. → Esperado: "SEFAZ 137 — Nenhum documento localizado"
   (a homologação não tem notas de verdade) ou 138 com documentos de teste.
   Erro de certificado aparece aqui (vencido, senha, CNPJ errado).
3. **Produção:** ambiente **Produção** › **Salvar** › digite **PRODUCAO** na
   caixa de confirmação. → A etiqueta muda para "Produção".
4. **Buscar agora**. → A SEFAZ manda o que ainda guarda (**cerca de 90
   dias**), mas só entra na caixa o que importa para começar (decisão do dono
   em 02/10/2026). O campo **"A Contabilidade começa em"** (setembro/2026)
   define:
   - Nota **de antes do mês anterior** (julho e antes): **não entra**. O
     resumo diz "N notas de antes de agosto/2026 ficaram de fora".
   - Nota **do mês anterior** (agosto): entra na caixa, ganha a ciência, mas
     **não é registrada sozinha**. Aparece com a etiqueta **"Decidir"** e os
     botões **Registrar** ou **Guardar como histórico**. "Histórico" é da
     empresa, mas não entra na Contabilidade. Sai das pendências e volta por
     **Restaurar**.
   - Nota **do início em diante** (setembro): o fluxo de sempre, abaixo.
   - Veio só o **resumo**: a ciência é dada sozinha e o XML completo chega
     na próxima busca (ou pelo botão **Baixar XML** na caixa de entrada).
   - Veio **completa**: é registrada sozinha em "Documentos recebidos"
     (origem "SEFAZ (automático)", com o XML oficial anexado).
   - **Cancelada** pelo emitente: aparece marcada e não se registra; se já
     estava registrada, o painel avisa.
   - Nota de **mês fechado**: fica na caixa com o motivo ("competência
     fechada"). Para registrar: reabrir o mês e clicar **Registrar** na
     linha — ou **Ignorar** com motivo.
5. Marque **Buscar sozinha** (a cada 60 min) › **Salvar**.

**Regras da SEFAZ que o app já respeita:** depois de uma consulta sem nota
nova, só se pode consultar de novo **1 hora** depois (o botão avisa o
horário); consultar demais dá bloqueio por "consumo indevido" (656) — o app
espera sozinho.

**Manifestação** (na caixa de entrada, **Manifestar…**): **Confirmação**
(a compra aconteceu), **Desconhecimento** (a empresa não comprou) ou
**Operação não realizada** (com justificativa). É uma declaração à SEFAZ,
registrada lá; as duas últimas tiram a nota das pendências (fica "Ignorada").

## Parte C — Extrato pela API do BB (etapa 11) — **versão 2**

**A v1 sai do ar em 20/11/2026** (aviso do BB na documentação, lido em
02/10/2026): ela não aceita o CNPJ alfanumérico. A v2 muda três coisas que
importam aqui:

- exige uma **aplicação nova** no portal (não entra na aplicação dos
  boletos);
- pede o **certificado da empresa na conexão (mTLS) também nos testes**;
- nos testes, só aceita as **contas de teste do BB** (1505 / 1348,
  551 / 5087 ou 452 / 123873), cada uma com um código que vai num cabeçalho
  próprio (o app põe sozinho).

Outros detalhes que o app já trata: até 31 dias por consulta (períodos
maiores viram várias), 120 lançamentos por página, a app key sempre como
`gw-dev-app-key` (com a chave do ambiente), saldos/limites/lançamentos
futuros fora do extrato, e o identificador único do BB (que só nasce no dia
seguinte) não duplica a linha.

**No Portal Developers do BB (feito pelo dono em 02/10/2026):**

1. **Criar Nova Aplicação** só com **Extratos (v2)**.
2. **Credenciais** › ambiente de teste › **Gerar credenciais** › baixar e
   guardar (o portal não mostra de novo).
3. **Certificados** › **Enviar certificado** › "Importar certificados
   individualmente": raiz (Autoridade Certificadora Raiz Brasileira v5),
   intermediários (AC Secretaria da Receita Federal do Brasil v4 e AC
   SAFEWEB RFB v5) e empresa, cada um exportado do Windows em
   **"X.509 codificado na base 64 (*.cer)"** (aba Caminho de Certificação ›
   Exibir Certificado › Detalhes › Copiar para Arquivo). Esperar o ✓ verde.
4. **Enviar para produção** (CNPJ › contatos › termo de adesão › Assinar).
5. **Credenciais** › ambiente de produção › **Gerar credenciais**.
6. **Certificados** › o mesmo envio do passo 3 em **produção**.

> **Nunca gere credenciais de novo na aplicação dos boletos**: o BB
> desativa as antigas na hora e os boletos param. Quando o certificado A1
> for renovado (vence em 14/11/2026), envie a cadeia nova nos dois
> ambientes **antes** de remover a antiga.

**No app:**

1. Contabilidade › Extrato bancário › **Contas do banco**: tenha a conta do
   BB cadastrada ("Usar a conta dos boletos" traz a da cobrança).
2. Configurações › cartão **Extrato da conta (API do BB)**:
   - **Usar a mesma aplicação da cobrança**: **desmarcado** (é o padrão da
     v2) › preencha **client_id** e **app key** de homologação e de
     produção (os da aplicação nova) e **Guarde** o client_secret de cada
     ambiente no bloco "Credenciais do BB".
   - **Conta do Extrato bancário** que recebe os lançamentos.
   - **Agência e conta sem o dígito** (1614 e 16773; se digitar "1614-4", o
     app guarda "1614").
   - Certificado na conexão (mTLS): **Sempre** (a v2 exige).
   - **Avançado › Agência/Conta de teste**: já vem 1505 / 1348; o código
     do cabeçalho fica vazio (o app usa o da documentação).
   - **Ligada** › **Salvar**.
3. **Testar conexão** (homologação). → "Token e extrato ok (…; com o
   certificado da empresa). Conta de teste do BB 1505 / 1348, dos últimos 30
   dias: N lançamentos … Nada foi gravado." Se a conta de teste não tiver
   movimento no período, aparece "o BB respondeu que não há lançamentos no
   período" — também prova que token e certificado funcionaram.
   - 401 no token: client_id/secret errados ou a API não está na aplicação.
   - 403: a cadeia do certificado não foi enviada NESTE ambiente, a API não
     está na aplicação ou (na homologação) a conta não é de teste.
   - Erro de certificado/conexão recusada: o certificado não foi aceito.
4. **Produção:** ambiente **Produção** › Salvar › PRODUCAO › **Testar
   conexão** de novo. → A conta real 1614 / 16773, dos últimos 30 dias, sem
   gravar nada.
5. Contabilidade › **Extrato bancário** › escolha o mês › **Buscar no BB**. →
   Os lançamentos do mês entram como uma importação "API" (sem repetir o que
   o OFX já trouxe; buscar de novo diz "já importados"). A resposta do banco
   fica guardada como evidência do mês.
6. Marque **Buscar sozinha** (1 vez por dia; relê os últimos 5 dias, por
   causa dos lançamentos que o banco lança atrasado) › Salvar.

Com a API funcionando, o **OFX vira opcional** (os dois convivem sem
duplicar).

## Parte D — NFS-e tomadas pelo ADN (etapa 13)

**Você fornece:** nada de novo, em princípio: o ADN reconhece a empresa pelo
**certificado A1** do CNPJ.

1. Configurações › cartão **NFS-e tomadas (ADN nacional)** › **Ligada**,
   **Homologação** (é a "produção restrita" do ADN, sem notas de verdade) ›
   Salvar › **Testar conexão**. → "ADN respondeu …" e os **campos da
   resposta**.
2. **Produção** › Salvar › PRODUCAO › **Testar conexão** › **Buscar agora**.
   → Cada NFS-e em que a empresa é **tomadora** entra (a que a empresa
   prestou fica de fora) e é registrada em "Documentos recebidos" (origem
   "ADN (automático)", com o XML, ISS retido quando houver). Vale a mesma
   janela da SEFAZ ("A Contabilidade começa em"): as de antes do mês
   anterior não entram; as do mês anterior esperam **Registrar** ou
   **Guardar como histórico**.
3. **Buscar sozinha** (a cada 3 horas) › Salvar.
4. ~~Mande-me um print~~ **Feito em 02/10/2026:** o teste em homologação
   respondeu "NENHUM_DOCUMENTO_LOCALIZADO (E2220)" e o de produção
   "DOCUMENTOS_LOCALIZADOS: 50 documentos no lote", com os campos
   StatusProcessamento, LoteDFe, Alertas, Erros, TipoAmbiente,
   VersaoAplicativo e DataHoraProcessamento. O formato confere com o que o
   app lê.

Se o ADN responder **401/403**: o certificado não está sendo aceito para o
CNPJ — confira no Emissor Nacional (nfse.gov.br) se a empresa está
habilitada com esse certificado e me mande a mensagem.

**Confirme** (pendência 47): as NFS-e dos prestadores de **Contagem** e de
**Belo Horizonte** aparecem no ADN (a primeira busca em produção mostra).

## Parte E — Aplicações / CDB (etapa 12) — **fora de uso desde 02/10/2026**

**Decisão do dono (02/10/2026):** o Rende Fácil e o CDB entram pelos **PDFs
mensais do BB**, conferidos ao centavo com o extrato. Isso será a fase das
aplicações. O cartão continua nas Configurações com a etiqueta **"Fora de
uso"**: não liga, não testa e não cobra pendência. O texto abaixo fica só
para o caso de o BB lançar uma API de CDB.

O catálogo público do BB tem a API de **Fundos de Investimento**, não uma de
CDB. Por isso esta integração ficou só com **credenciais + teste de
sondagem**: não busca sozinha e não grava nada.

**Você pergunta ao BB (gerente PJ ou suporte do Portal Developers):**
1. Qual API do portal consulta a **posição do CDB** (renda fixa) de uma
   **empresa**?
2. Qual o **escopo** (scope) e o **caminho** da consulta?
3. Se essa API vai na mesma aplicação da cobrança.

**Depois, no app:** cartão **Aplicações — CDB (BB)** › escopo › caminho da
consulta (com `{agencia}` e `{conta}` onde entram os números) › agência e
conta › Salvar › **Testar conexão**. → Aparece uma **amostra** da resposta
num quadro: copie e mande para mim. Com ela eu faço o mapeamento (quanto
tem, quanto rendeu no mês, IR) numa próxima rodada.

## Parte F — Como funciona no dia a dia

- **A agenda** roda **dentro do App-Gestão aberto** (a cada ~5 minutos
  verifica o que está na hora) e **só com alguém logado**. SEFAZ a cada 60
  min, ADN a cada 3 h, extrato 1 vez por dia (trocáveis no cartão). Com
  vários computadores abertos, **só um** faz cada busca (a trava fica no
  banco).
- **Caixa de entrada** (Ações › NF-e e NFS-e da SEFAZ/ADN): filtros por
  origem e situação; em cada linha, o que dá para fazer. "Pendentes" são as
  que ainda não viraram documento (a cancelada que nunca foi registrada não
  conta).
- **No painel do mês:**
  - NF-e/NFS-e do mês ainda fora dos documentos → **pendência documental**
    (abre a caixa de entrada).
  - Nota registrada que o emitente cancelou → **aviso** (abre o documento).
  - A última busca de uma integração deu erro → **aviso** (abre as
    Configurações).
  - Nota que não entrou por um motivo dela (ex.: mês fechado) fica na caixa
    com o motivo e **não** marca a integração como "com erro".
- **Atividade recente**: "Integração configurada", "NF-e manifestada na
  SEFAZ", "Documento da SEFAZ/ADN ignorado".
- **Segurança da homologação:** em homologação, busca e teste **só gravam no
  banco DEV**. Num banco de produção, a homologação só conta ("nada foi
  gravado"), para nota de teste nunca misturar com a de verdade.
- Cada cartão mostra as **últimas execuções** (automática, manual, teste)
  com o resumo ou o erro.

## Parte G — Checklist visual (faça e me diga "ok" ou mande o print)

**No DEV, depois do SQL 9 e de reabrir o app:**
1. Ações tem **"NF-e e NFS-e da SEFAZ/ADN"** e **"Configurações"** abre o
   modal novo (não mais o aviso "em implementação").
2. Configurações: no alto, o **certificado** (titular, CNPJ, validade,
   "No banco" ou "Neste computador") e o botão **Baixar certificado público
   (.cer)** (só para o Sup Admin); à direita do título, **"Sup Admin: pode
   mudar"** (ou "Só leitura" para os outros).
3. Quatro cartões com a faixa colorida à esquerda (verde = pronta; vermelha =
   falta algo ou deu erro; cinza = desligada), as etiquetas **Ligada/
   Desligada, Homologação/Produção, Pronta/N pendências**, "O que falta",
   "O que você fornece" e o formulário à direita.
4. No cartão do BB: com **"Usar a mesma aplicação da cobrança"** marcado,
   os campos de client_id/app key **somem**; desmarcado, aparecem. No
   cartão do **Extrato** ela já vem **desmarcada** (a v2 é outra aplicação).
5. **Mostrar o avançado** abre endereços, NSU inicial / conta de teste.
6. Trocar para **Produção** e **Salvar** pede a palavra **PRODUCAO**
   (Voltar desiste; nada muda).
7. Com um usuário que **não** é Sup Admin: tudo visível, campos travados,
   sem "Salvar"; **Testar conexão** funciona.
8. Caixa de entrada: tabela com Emissão, Documento, Emitente, Valor,
   Situação, Ações; rodapé com **Fechar** (vermelho), **Configurações**,
   **Buscar NFS-e no ADN** (azul claro) e **Buscar NF-e na SEFAZ**
   (dourado).
9. Extrato bancário › **Buscar no BB**: sem configurar, diz o que falta
   ("Antes de buscar no BB: … (Contabilidade › Configurações)").
10. SEFAZ em homologação: **Testar conexão** responde (137/138 ou o erro do
    certificado).
11. (02/10/2026) Cada cartão tem a **setinha** à direita das etiquetas:
    contrai (fica só o título e as etiquetas) e expande. O programa lembra
    como você deixou; da primeira vez, só fica aberto o cartão com pendência
    ou erro. O do CDB mostra **"Fora de uso"** e o motivo.
12. (02/10/2026) SEFAZ e ADN têm o campo **"A Contabilidade começa em"**
    (setembro de 2026). Na caixa de entrada, a nota de agosto aparece com
    **"Decidir"** e o botão **Guardar como histórico**.
13. (02/10/2026) Na tela da Contabilidade, clicar num cartão do **Checklist
    por fonte** leva até o cartão de **Pendências**, já filtrado por aquela
    fonte (o chip com a fonte tem o "×" para tirar o filtro).

**Em produção (depois do "ok" no DEV), na ordem:** Parte A (SQL, reiniciar
a API, permissões, travas) → B → C → D → E.

## Parte H — O que me mandar de volta

1. O resultado da Parte G (ok ou print).
2. Print do **Testar conexão** de cada integração em produção (principalmente
   o do **ADN** e o do **BB**: confirmam o formato das respostas).
3. A resposta do BB sobre o **CDB** (Parte E) e a **amostra** do teste.
4. Um **extrato real** pela API (qualquer mês) conferido contra o OFX do
   mesmo mês — se algum lançamento vier diferente (descrição, sinal, data),
   me mande o print dos dois.
5. As respostas das pendências 34 a 47 (pode ser "ok" nas que concordar).

## Parte I — Fase A (02/10/2026): conciliação nota × extrato, níveis do dono, início e saldo de abertura

**O que mudou**
- **Níveis das pendências (as respostas C1–C10):** pagamento sem nota/recibo
  (C2), sem comprovante (C3), OFX que falta (C4), lançamento a conciliar (C5)
  e sem classificação (C7) são **erro crítico** — seguram o fechamento.
  Tarifa do banco não pede nota nem comprovante (o extrato prova). Diferença
  depois do fechamento é **documental** (C8). NFS-e que falta de comissão é
  **aviso** (C1).
- **OFX obrigatório (20b)** mesmo com a API (ver pendência 43).
- **Recusada na SEFAZ (22b)** continua pendente até ignorar à mão (ver 37).
- **Mensagem nova (28b)** no mural da Contabilidade avisa **todos que veem a
  Contabilidade** (usuários com acesso liberado).
- **Conciliação nota × extrato (o caso da NFS-e 17 do Bruno):** o débito do
  banco agora casa também com a **nota registrada sem conta** e com a
  **parcela em aberto**. Sozinho, só quando o par é único, o valor é o mesmo
  e o **CPF/CNPJ** bate (até 30 dias) ou o **nome** está na descrição do
  banco (até 5 dias). Ao conciliar, o app **lança a conta da nota e paga**
  (ou paga a parcela) com o dia e o valor do banco; desfazer **estorna** (e
  cancela a conta lançada). Dúvida = sugestão com as opções, você escolhe.
- **16b:** recebimento/pagamento já registrado com o **mesmo valor, nome na
  descrição e até 3 dias** concilia sozinho.
- **Roda sozinha** depois de importar o OFX, buscar o extrato pela API,
  registrar nota (à mão, pela caixa de entrada ou pela busca da SEFAZ/ADN) e
  lançar conta a pagar.
- **5.4 — sem duplicar:** a nota que chega para uma conta que já existe
  (mesmo fornecedor/CNPJ, valor e data perto — inclusive a conta lançada do
  extrato) **liga nela**; a NFS-e de comissão/produção acha o pagamento pelo
  nome. Duas possíveis = **nada é lançado** e o aviso diz quais.
- **Início da Contabilidade:** Configurações › **Geral** (setembro/2026, só o
  Sup Admin muda). O mês de antes aparece "Antes do início": nada é cobrado
  nem fechado.
- **Saldo de abertura (19b):** Contas do banco › Editar › **Saldo de
  abertura / No fim do dia**. O livro-caixa começa por ele e é conferido com
  o saldo do banco (aviso "Saldo … não confere com o banco").

**O que fazer**
1. Rodar `sql/contabilidade_fase_a.sql` (DEV e produção) e **reiniciar a
   API** (DEV: fechar e abrir o app). Ele cria `contabil_parametros` com o
   início em **2026-09**.
2. Contas do banco › **BB — conta corrente** › Editar: **Saldo de abertura** =
   o saldo do fim de **31/08/2026** (no extrato do BB) e **No fim do dia** =
   31/08/2026. Salvar.
3. Cartões da **SEFAZ** e do **ADN** (Configurações): marcar **"Lançar a conta
   a pagar junto"** e Salvar (7b; sem risco de duplicar).
4. Conciliação de **setembro**: clicar **Conciliar automaticamente** — o Pix de
   08/09 do Bruno deve casar com a **NFS-e 17** (a conta é lançada e paga).

**Checklist visual**
1. Configurações: no alto, o cartão **Geral** com "Início da Contabilidade =
   setembro de 2026" e **Salvar** (sem o SQL: o aviso de qual arquivo rodar).
2. Painel de **agosto/2026**: faixa "Este mês é de antes do início…", cartões
   das fontes com **"Antes do início"** (apagados) e zero pendências.
3. Painel de setembro: o OFX que falta é **erro crítico**; tarifa sem nota
   **não** aparece como "pagamento sem nota".
4. Conciliação de setembro: o Pix do Bruno com **Automático** e "Nota sem
   conta a pagar · NFS-e 17"; abrir o lançamento mostra a nota marcada e o
   rodapé "ao conciliar, a conta é paga (a nota vira conta)…".
5. Depois de conciliar: em Contas a pagar, a conta **"NFS-e 17 — …"** paga em
   08/09 (Pix). Desfazer a conciliação: o pagamento é estornado e a conta,
   cancelada.
6. Caixa de entrada: manifestar **Desconhecimento** numa NF-e → ela continua
   na lista com **"Recusada na SEFAZ"**; só sai com **Ignorar**.
7. Registrar uma NFS-e de um fornecedor que já tem a conta lançada (mesmo
   valor) → mensagem **"ligado à conta a pagar que já existia"** e nenhuma
   conta nova.
8. Relatório › Livro-caixa: "Saldo inicial … (pelo saldo de abertura
   digitado)" e "confere/não confere com o banco em …".
9. Mensagens da Contabilidade: escrever uma mensagem → quem vê a
   Contabilidade recebe "Nova mensagem" no sino.

## Pendências novas (continuam a lista 1–33 do roteiro de homologação)

**NF-e de entrada (SEFAZ)**
34. **Ciência automática** para toda NF-e nova (é o que libera o XML; não
    confirma a compra). Ok?
35. ~~Registro automático sem a conta~~ — **respondido (7b, 02/10/2026):** a
    nota completa registra **e** lança a conta pelas duplicatas (marque
    "Lançar a conta a pagar junto" nos cartões da SEFAZ e do ADN). Desde a
    Fase A, se a conta já existir, a nota **liga nela** em vez de duplicar.
36. NF-e/NFS-e do mês ainda na caixa de entrada é **documental** (segura o
    pacote). Confirmar.
37. ~~Desconhecimento tira a nota das pendências~~ — **respondido (22b,
    02/10/2026; feito na Fase A):** a nota manifestada como desconhecimento ou
    operação não realizada **continua pendente** (etiqueta "Recusada na
    SEFAZ") até alguém **Ignorar** à mão, com o motivo.
38. A primeira busca traz ~90 dias: as notas de **meses já fechados** ficam
    na caixa com o motivo. Prefere que o app as **ignore sozinho** (com o
    motivo "mês já fechado"), ou decide uma a uma?

**Agenda e segurança**
39. A busca automática roda **só com o App-Gestão aberto e alguém logado**.
    Serve, ou quer que rode no servidor da API (sempre ligado)?
40. Quem busca: NF-e/NFS-e pedem "Registrar documentos"; extrato pede
    "Importar extrato"; mudar a configuração só o Sup Admin. Ok?
41. Homologação num banco de produção **só conta, não grava**. Confirmar.

**Extrato (BB)**
42. A resposta do BB é guardada como evidência **só na busca do mês** (botão
    no Extrato), não na automática diária. Ok?
43. ~~A API vale como o extrato do mês~~ — **respondido (20b, 02/10/2026;
    feito na Fase A):** o **OFX é obrigatório** mesmo com a API (erro crítico
    "OFX de … não importado/incompleto"); a API adianta a conciliação e
    completa a linha do OFX com o CPF/CNPJ de quem recebeu/pagou.

**CDB, comprovantes e pagamentos**
44. CDB: só credenciais e teste até o BB dizer a API (Parte E). Ok.
45. **Comprovantes** de pagamento: o BB não tem API pública para buscá-los;
    continuam anexados à mão (PDF). Ok?
46. **Pagamentos em lote** pelo BB (API de Pagamentos) fica para uma fase
    futura, se quiser.

**NFS-e (ADN)**
47. Confirmar, na primeira busca em produção, que as NFS-e de **Contagem** e
    de **Belo Horizonte** aparecem (o formato da resposta do ADN também se
    confirma aí).
