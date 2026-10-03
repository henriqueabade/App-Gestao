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
mensais do BB**, conferidos ao centavo com o extrato. Feito na **Fase C**
(Parte N). O cartão continua nas Configurações com a etiqueta **"Fora de
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

## Parte J — Fase B (02/10/2026): o plano de contas da AEA

**O que mudou**
- O **Plano de contas** passa a ser o plano **inteiro da AEA** (Mastermaq,
  2.718 contas), com o código reduzido (00528), a classificação
  (4.01.01.01.002) e a natureza (D/C). **Em uso** ficam 38 (as do balancete de
  04/2022 + as suas respostas). Só as contas **em uso e analíticas** aparecem
  nas listas de escolha: classificação, regras, lote e categoria das contas a
  pagar.
- A tela do Plano de contas: **Mostrar** (Em uso / Plano inteiro da AEA /
  Desativadas), **Buscar** por código ou nome, a árvore na ordem da
  classificação (contas-título em negrito). Ações:
  - **Usar / Tirar de uso** — não tira de uso a conta que tem regra ativa
    (desative a regra antes);
  - **O comprovante basta / Pedir nota** — resposta 1 a (abaixo);
  - **Desdobrar** — só nas que se desdobram: 00223 Fornecedores, 00028
    Clientes, 00020 Aplicações. Cria a subconta com final de 3 dígitos
    (00223.001, 00223.002 … até .999); para a AEA vale o código da genérica;
  - **Editar** — só os desdobramentos (nome) e as contas criadas à mão. A conta
    da AEA não muda nome, código nem tipo.
- **Aplicações (resposta 5):** tudo na 00020, já desdobrada em **00020.001
  Rende Fácil** e **00020.002 CDB**; o rendimento não vira receita (como no
  balancete). Regras novas: "RENDE FACIL" → 00020.001, "CDB" → 00020.002,
  "IOF" (débito) → 00761.
- **As 10 contas que vieram com o app viram as da AEA** e ficam desativadas
  com "Substituída por …" (as regras, as classificações à mão e a categoria
  das contas a pagar acompanham):

  | Antiga | Agora |
  |---|---|
  | Receita de vendas | 00528 · Industrialização de Mercadorias |
  | Devoluções e reembolsos | 00537 · Devolução de Vendas |
  | Aquisição de Bens | 00340 · Compra de Mercadorias |
  | Impostos e Taxas | 00780 · Simples Nacional |
  | Transferência entre contas | 00020.001 · Rende Fácil |
  | Comissões sobre vendas | 00445 · Comissões sobre Vendas |
  | Despesas bancárias | 00491 · Despesas Bancárias |
  | Produção (colaboradores) e Serviços de Terceiros | 00476 · Serv de Terc. PJ |
  | Aporte de Capital | 00754 · Emprestimos a Socios |

- A **categoria da conta a pagar** guarda o código ("00383 · Energia
  Eletrica"): o plano da AEA repete nomes ("Banco do Brasil" é a 00008 e a
  00020; "Energia" está no custo e na despesa).
- **Resposta 1 a — "o comprovante basta":** marcadas Simples (00780), impostos
  e taxas (00502 a 00508), energia (00383 e 00457), água (00439), telefone
  (00478/00479), internet (00462), despesas bancárias e de cobrança
  (00491/00492) e IOF (00761). Nessas, a conta paga **com o comprovante do
  banco anexado** não pede nota/recibo no painel.
- **Contas do banco:** campo novo **"Conta no plano da AEA"** (BB — conta
  corrente = **00008**, já ligada pelo SQL). O relatório e as partidas mostram
  o lado do banco como "00008 · Banco do Brasil [BB — conta corrente]".
- O livro, o resultado e a planilha mostram o **código** junto do nome.
- A **classificação continua pelo caixa** (o que entrou e saiu do banco), agora
  nas contas da AEA. Os lançamentos por competência como no balancete (nota →
  fornecedor/cliente desdobrado) são a **B2** — esperam o seu ok (pendência 48).

**O que fazer**
1. Rodar `sql/contabilidade_fase_b.sql` (DEV e produção), **depois** do
   `sql/contabilidade_fase_a.sql`, e **reiniciar a API** (DEV: fechar e abrir o
   app). No fim ele mostra a conferência: AEA 2.718 contas / 38 em uso / 17
   "o comprovante basta"; desdobrado 2; padrão 10 desativadas; BB → 00008.
2. Abrir **Contabilidade › Plano de contas** e conferir a lista "Em uso". Se
   faltar alguma conta que a Santíssimo usa: Mostrar › Plano inteiro, buscar
   pelo código ou nome e clicar **Usar**.
3. Desdobrar os fornecedores e clientes que quiser já separados (00223 /
   00028 › **Desdobrar** › nome).
4. Se você tinha criado contas à mão no plano antigo, elas continuam ativas:
   veja se cada uma tem a equivalente na AEA; se tiver, troque nas regras e
   desative a sua.

**Checklist visual**
1. Plano de contas sem o SQL: a faixa amarela "O plano da AEA ainda não está no
   banco: rode sql/contabilidade_fase_b.sql e reinicie a API" e as categorias
   antigas.
2. Com o SQL: subtítulo "Plano da AEA (Mastermaq) · só as em uso entram nas
   listas", o rótulo "**40 contas em uso**" (38 + os 2 desdobramentos), 00008 ·
   Banco do Brasil "Em uso" e "O comprovante basta"; 00020 com "2
   desdobramentos" e, logo abaixo, **00020.001 · Rende Fácil** e **00020.002 ·
   CDB** (etiqueta "Desdobramento", com Editar).
3. Mostrar › **Plano inteiro**: "Mostrando 300 de 2.7xx contas: busque…"; a
   árvore recuada (1 ATIVO › 1.01 CIRCULANTE › …), contas-título em negrito
   com "Conta-título" e sem botões; as outras com **Usar**.
4. Buscar `00440`, clicar **Usar** → vira "Em uso" e passa a aparecer nas
   listas da Classificação e das Regras; **Tirar de uso** → sai.
5. Buscar `00223`, **Desdobrar** → pede o nome → aparece **00223.001 · (nome)**
   embaixo da 00223.
6. Mostrar › **Desativadas**: as 10 antigas com "Substituída por 00528 · …".
7. Contas do banco › BB — conta corrente › Editar: **"Conta no plano da AEA" =
   00008 · Banco do Brasil**; na lista, "Plano: 00008 · Banco do Brasil".
8. Classificação de setembro: a lista de contas agrupada por tipo, cada uma
   com o código ("00476 · Serv de Terc. PJ"); um lançamento cuja conta saiu de
   uso mostra "(fora de uso)" em vez do campo em branco.
9. Contas a pagar › Nova conta › **Categoria**: as contas em uso com o código.
10. Painel de setembro: uma conta de energia/Simples paga **com o comprovante
    anexado** não aparece mais como "pagamento sem nota".

## Parte K — Fase H (02/10/2026): os boletos contra a empresa (DDA do BB)

**O que mudou**
- **Cartão novo nas Configurações: "Boletos contra a empresa (DDA do BB)"
  (Fase H).** Ele usa a mesma aplicação do Portal Developers que o Extrato
  pela API: client_id, app key, client_secret e certificado vêm do cartão do
  Extrato. O cartão tem:
  - a caixa "Usar a mesma aplicação do Extrato" (desmarcada, pede credenciais
    próprias);
  - "Buscar sozinha" e **quantas vezes por dia** (padrão 2);
  - vencimentos de **quantos dias para trás** (60) e **para frente** (180),
    somados até 365 (o BB aceita até 1 ano por consulta);
  - os **estados** buscados: a pagar, agendados e liquidados;
  - no avançado, o código de teste da homologação (só se o BB indicar uma
    massa de teste).
- **A busca guarda só os dados.** O BB não dá o PDF nem a 2ª via. De cada
  boleto ficam:
  - beneficiário e beneficiário final, "seu número";
  - código de barras e a linha digitável **calculada** dele;
  - registro, vencimento, valor e o estado no BB, com o histórico
    (a pagar → liquidado);
  - o JSON original;
  - um **ID interno** do app, que nunca é apresentado como identificador do BB.

  O boleto que some do DDA (baixado ou trocado pelo beneficiário) fica marcado.
- **Liga sozinho à conta a pagar** só quando o par é único:
  - **mesma linha digitável**; ou
  - **mesmo CNPJ do beneficiário + mesmo valor + vencimento a até 3 dias**.

  Ao ligar, completa a linha digitável da parcela que estava sem. O resto vira
  sugestão, inclusive a **nota registrada sem conta** do mesmo CNPJ.
- **Boleto "a pagar" sem conta nunca vira conta sozinho.** Estar no DDA não
  prova que a dívida é devida. No painel ele é **aviso**: "N boletos do DDA sem
  conta a pagar".
- **Boleto pago (liquidado) ou agendado sem conta** entra na **conciliação**,
  como a nota sem conta da Fase A. O débito do extrato que casa com ele
  **lança a conta do boleto e a paga** (fornecedor pelo CNPJ, linha digitável,
  seu número). Isso é automático com o mesmo valor, o par único e a até 5 dias
  do vencimento. Desfazer a conciliação cancela a conta e solta o boleto.
- **A parcela ligada a um boleto liquidado** concilia sozinha com o débito do
  mesmo valor, a até 5 dias. O DDA confirma o pagamento.
- **Tela nova "Boletos do DDA (BB)"** (Ações da Contabilidade, ou "Ver os
  boletos" no cartão):
  - Filtros: mostrar (sem conta, ligados, contestados e ignorados, todos),
    vencimento, estado no banco e busca.
  - Em cada linha:
    - **Ligar à sugerida** e **Ligar…** (escolher a conta);
    - **Lançar conta**: abre o formulário já preenchido, com a nota sugerida;
      ao salvar, o boleto fica ligado;
    - **Contestar** e **Ignorar**, os dois com motivo, e **Restaurar**;
    - **Desligar** (com motivo) e **Abrir conta**;
    - **Espelho**: o PDF "Espelho DDA".
  - No rodapé: **Ligar sozinho** e **Buscar no DDA**.
- **Espelho DDA**: uma página A4 só com os dados do BB, as barras desenhadas do
  código e a linha digitável marcada como calculada. O rodapé é o que o BB
  orientou: "…Não constitui segunda via ou representação gráfica oficial do
  boleto." Na Fase I ele vai no pacote, na pasta de cada pagamento.
- **Painel (fonte Contas a pagar):**
  - boleto do mês sem conta: **aviso**;
  - boleto liquidado com a conta em aberto: **aviso**;
  - **pagamento por boleto sem o boleto**: **documental** (segura o pacote).
    Só aparece com o DDA ligado. Resolve com o boleto do DDA ligado à conta ou
    com o PDF do boleto do fornecedor anexado (tipo "Boleto"). Ver a
    pendência 51.

**O que fazer**
1. Rodar `sql/contabilidade_fase_h.sql` (DEV e produção), **depois** do
   `contabilidade_fase_b.sql`, e **reiniciar a API**. No fim ele mostra a
   tabela nova (0 boletos) e a linha `bb_dda` desligada, em homologação, a cada
   720 min.
2. Configurações › **Boletos contra a empresa (DDA do BB)**:
   - deixar marcado "Usar a mesma aplicação do Extrato";
   - **Testar conexão**.

   Sem massa de teste na homologação, mude para **Produção** (digite PRODUCAO):
   a API só consulta.
3. Marcar **Ligada** e **Buscar sozinha** (2 vezes por dia) e **Salvar**.
   Depois, **Buscar agora**.
4. Ações › **Boletos do DDA (BB)**: para cada boleto sem conta, decidir entre
   ligar, lançar ou contestar.

**Checklist visual**
1. Sem o SQL, o cartão do DDA mostra "Falta rodar
   sql/contabilidade_fase_h.sql…". A tela dos boletos mostra o aviso amarelo
   com o arquivo.
2. Com o SQL, o cartão mostra "Fase H", "Quantas vezes por dia" = 2, 60 e 180
   dias e os 3 estados marcados. Em "Credenciais do BB": "Do cartão do Extrato
   pela API (…): client_id ok, app key ok, client_secret guardado".
3. **Testar conexão**: "Token e DDA ok (escopos: dda-info; com o certificado da
   empresa). N boletos a pagar com vencimento de … a …. Pagador no BB:
   11.444.777/0001-61. Nada foi gravado." Se o pagador não for o CNPJ da
   empresa, o teste avisa.
4. **Buscar agora**: "N boletos no DDA com vencimento de … a … (x a pagar, y
   liquidados) · N novos · K ligados sozinhos às contas…".
5. Tela dos boletos, em "Sem conta":
   - etiquetas "A pagar" (amarela) e "Liquidado" (verde);
   - "Sugestão" com a conta ou a nota;
   - o liquidado sem sugestão diz "Pago no banco: ao conciliar o débito do
     extrato, a conta do boleto é lançada e paga".
6. **Ligar…**: a caixa com as contas candidatas, a melhor primeiro, com os
   motivos ("mesmo CNPJ do beneficiário · mesmo valor · mesmo vencimento").
7. **Lançar conta**: o formulário "Conta do boleto do DDA" vem preenchido
   (fornecedor, descrição, nº do documento, valor, a parcela com a linha
   digitável, a nota sugerida). Se o beneficiário não está em Contatos, a
   faixa pede o fornecedor. Salvar: "Conta lançada e ligada ao boleto do DDA".
8. **Contestar** pede o motivo e o boleto vai para "Contestados e ignorados".
   **Restaurar** volta.
9. **Espelho**: salva o PDF, uma folha, com "DOCUMENTO INTERNO — NÃO É BOLETO"
   e o rodapé do BB.
10. Conciliação: o débito "PAGAMENTO DE BOLETO …" de um boleto liquidado sem
    conta aparece como "Boleto do DDA sem conta". O lote diz "1 boleto do DDA
    lançado e pago".
11. Painel de setembro, com o DDA ligado: "1 pagamento por boleto sem o
    boleto" (documental), se houver pagamento por boleto sem ele.

## Parte L — Fase D (02/10/2026): os comprovantes do BB (o ZIP)

**O que mudou**
- **Tela nova "Comprovantes do BB"** (Ações da Contabilidade). O botão
  **Anexar ZIP ou PDFs** aceita o ZIP com os comprovantes baixados do site do
  BB, ou os PDFs soltos, vários de uma vez.
- **O app lê e guarda só os dados**, nunca o arquivo, quando consegue refazer o
  comprovante idêntico. De cada comprovante ficam:
  - o texto linha a linha e o layout da página;
  - os campos: tipo (Pix, boleto, convênio/guia, crédito em conta), data,
    valor, tarifa, autenticação, DOCUMENTO, nº de controle, favorecido e
    CPF/CNPJ, pagador, código de barras ou ID do Pix, agência e conta;
  - o SHA-256 do arquivo original.

  Com o ZIP de setembro (35 comprovantes) o app refez **os 35 idênticos**:
  nenhum arquivo foi guardado.
- **Quando a cópia não sai idêntica** (um formato que o BB mude, por exemplo),
  o original fica guardado **só até o pacote do mês ser salvo**. Depois sai do
  servidor e ficam os dados e o SHA-256.
- **O PDF refeito** (botão **PDF**, Documentos da competência e pacote) é igual
  ao do banco, com um pé pequeno: "Reproduzido pelo App-Gestão a partir do
  comprovante original do BB … SHA-256 …". Nos Documentos da competência ele
  aparece como **"Reproduzido (idêntico ao original do BB)"**, com o total
  novo "Reproduzidos".
- **Liga sozinho ao débito do extrato:** mesmo valor, até 5 dias, mesma conta.
  - **Chave forte:** o DOCUMENTO do comprovante igual ao do extrato, o nº de
    controle, o ID do Pix ou o CPF/CNPJ completo do favorecido. Liga sozinho
    se só um débito tiver chave forte.
  - **Sem chave forte:** liga sozinho só se houver um único débito, e ele for
    do mesmo dia (ou tiver o nome do favorecido na descrição, a até 3 dias).
  - O resto vira **sugestão** ("Ligar à sugerida").
- **Ao ligar, o comprovante completa o CPF/CNPJ** do lançamento do extrato
  (se estava vazio e o mês está aberto), e a **conciliação roda sozinha**.
  Exemplo: o boleto da Vidros Norte pago pelo BB vira "conta paga" sem
  ninguém clicar.
- **O extrato que chega depois do ZIP também liga.** A ordem não importa:
  ao importar o OFX ou buscar pela API, os comprovantes que esperavam o débito
  se ligam, e a conciliação roda em seguida. Na tela, o botão **Ligar sozinho**
  faz o mesmo.
- **Em cada linha:**
  - **Ligar à sugerida** e **Ligar…** (os débitos de até 10 dias, os de mesmo
    valor primeiro);
  - **Desligar** e **Ignorar**, os dois com motivo, e **Restaurar**;
  - **Dossiê** do lançamento ligado;
  - **PDF**.

  O comprovante ignorado sai do aviso e do pacote.
- **Avisos na linha:**
  - **"O pagador do boleto é ARTDECO …, não a empresa"** (reembolso a
    receber?, a Fase F trata);
  - **o valor do lançamento difere** do comprovante;
  - **o original fica guardado** até o pacote.
- **Painel:**
  - o **pagamento sem comprovante** (C3) deixa de ser cobrado quando o
    pagamento está conciliado com um débito que tem comprovante ligado;
  - **"N comprovantes sem lançamento do extrato"** é aviso.
- **Pacote:** depois de **salvar** o ZIP, o app avisa o servidor, e os
  originais guardados do mês saem dali ("1 original de comprovante saiu do
  servidor"). Se precisar do pacote de novo, os refeitos saem iguais. O
  original que já saiu aparece como **"Falta"**: anexe o PDF de novo.

**O que fazer**
1. Rodar `sql/contabilidade_fase_d.sql` (DEV e produção), **depois** do
   `contabilidade_fase_h.sql`, e **reiniciar a API**. No fim ele mostra a
   tabela nova `contabil_comprovantes` com 0 linhas.
2. Ações › **Comprovantes do BB** › **Anexar ZIP ou PDFs** e escolher o ZIP de
   setembro.
3. Conferir os que ficaram "Sem lançamento": ligar à sugerida, escolher o
   débito ou ignorar (com motivo). Se o extrato do mês ainda não foi
   importado, importe e use **Ligar sozinho**.

**Checklist visual**
1. Sem o SQL, a tela mostra o aviso amarelo "Os comprovantes do BB ainda não
   estão ativados: rode sql/contabilidade_fase_d.sql…".
2. Anexar o ZIP de setembro. O aviso deve dizer: "35 comprovantes lidos · 35
   novos · 35 refeitos idênticos (o arquivo não foi guardado) · N ligados ao
   extrato…".
3. Os quatro totais: Comprovantes, Ligados, Sem lançamento (com o valor) e
   Originais guardados (0 com o ZIP de setembro).
4. Em cada linha: tipo, "refeito idêntico ao do BB", favorecido com CPF/CNPJ.
   Na coluna do extrato: "Ligado ao extrato" com o lançamento e o critério,
   ou "Sem lançamento" com a sugestão.
5. **PDF** abre o comprovante igual ao do BB, com o pé "Reproduzido pelo
   App-Gestão…" no fim da página.
6. **Ligar…** abre a caixa com os débitos ("mesmo valor · 1 dia de diferença").
7. Anexar o mesmo ZIP de novo: "35 comprovantes lidos · 35 já estavam no app".
8. Documentos da competência de setembro: o total "Reproduzidos" e os
   comprovantes com a etiqueta verde "Reproduzido (idêntico ao original do
   BB)". Abrir e Salvar funcionam.
9. Painel de setembro: o "pagamento sem comprovante" some dos pagamentos
   conciliados com débito que tem comprovante; aparece o aviso "N comprovantes
   sem lançamento do extrato", se houver.
10. Atividade: o grupo "Comprovantes do BB" no filtro, com "Comprovantes do BB
    anexados: …".

## Parte M — Fase I (02/10/2026): o pacote por pagamento, tudo gerado na hora

**O que mudou**
- **Pastas novas no pacote:**

  | Pasta | O que vai nela |
  | --- | --- |
  | `02-Extrato/` | O OFX original e o **extrato do mês em PDF**, gerado: o livro-caixa de cada conta |
  | `03-NF-e-de-saida/` e `04-Devolucoes/` | O XML e o **DANFE em PDF**, feito do XML na hora |
  | `05-Recebidos/` | A NF-e de entrada com o **DANFE** (sem a nossa logo, porque a nota é do fornecedor), as NFS-e, os recibos e as guias |
  | `06-Pagamentos/` | **Uma pasta por pagamento do mês** (detalhe abaixo) e `Comprovantes sem pagamento/`, para os comprovantes que não são de um pagamento registrado |
  | `07-Boletos-emitidos/` | Os boletos de cobrança emitidos no mês, só os de produção, gerados como no Financeiro |
  | `08-Outros/` | Contratos e o resto anexado ao mês |

- **A pasta de cada pagamento:**
  - Vale para conta a pagar, comissão/produção e reembolso. O nome é curto
    (o Windows limita o caminho): `003 20-08 Vidros Norte 2.000,00`.
  - O que vai nela:
    - **`Dossie do pagamento.pdf`**, gerado na hora: o pagamento, a conta e a
      parcela, a nota e **onde ela está**, o boleto, o lançamento do extrato,
      o comprovante, a lista dos arquivos da pasta com o SHA-256 de cada um, e
      **o que falta**;
    - o **comprovante do banco** (refeito dos dados, Fase D, ou o anexado);
    - o **Espelho DDA**, gerado, quando a parcela tem boleto no DDA;
    - o **boleto do fornecedor** e os outros anexos do pagamento e da conta.
- **A nota vai no mês fiscal dela** e não se repete. O dossiê diz onde ela
  está:
  - neste pacote, com o caminho (`05-Recebidos/…`);
  - no pacote em que foi enviada. O app acha pelo SHA-256 do arquivo:
    "Enviada no pacote Contabilidade-2026-07-v1.zip (julho/2026, versão 1),
    arquivo 05-Recebidos/…, em 06/08/2026 para …";
  - "é de julho: vai no pacote daquele mês", se ainda não foi em pacote;
  - ou que foi registrada sem o arquivo.
- **Tudo gerado na hora, nada guardado.** Dossiês, espelhos, DANFE, extrato
  em PDF e boletos emitidos são feitos ao gerar o ZIP, pela mesma impressão
  em PDF do DANFE. Os PDFs que entram no ZIP foram feitos na hora; o índice
  mostra a origem "Interno". Se o pacote for gerado fora do aplicativo, eles
  vão em HTML, e o LEIA-ME e o aviso dizem isso. O relatório em PDF também
  sai daqui se a tela não mandar.
- **Tela do pacote:** seção nova **"Pagamentos do mês"**. Em cada pasta, o
  que vai nela (etiquetas verdes), o que falta (vermelhas) e onde está a nota
  ("neste pacote", "já enviada", "de outro mês", "sem o arquivo"). Gerar
  avisa que os PDFs são feitos na hora e pode levar um minuto.
- **O que não mudou:** nada sai do servidor nesta fase além do que a Fase D
  já fazia (o original do comprovante do BB não refeito). Ver as pendências
  59 e 60.

**O que fazer**
1. Nada de SQL nesta fase. Basta abrir o aplicativo atualizado (o `main.js`
   mudou, então **feche e abra o app**, não só a API).
2. Gere de novo o pacote de um mês fechado e abra o ZIP.

**Checklist visual**
1. Pacote (modal): a seção "Pagamentos do mês" lista as pastas, com
   "Dossiê do pagamento", "Comprovante", "Espelho DDA" e "Boleto do
   fornecedor" quando houver, e as faltas em vermelho.
2. A nota de um pagamento cuja NF-e é do mês anterior mostra "já enviada" e o
   nome do pacote em que foi.
3. No ZIP: `06-Pagamentos/001 …/Dossie do pagamento.pdf` abre em A4 retrato,
   com "DOCUMENTO INTERNO" e as seções O pagamento, A conta a pagar, A nota,
   O boleto, No banco (extrato), O comprovante do banco, Arquivos desta pasta.
4. Na mesma pasta: o comprovante do BB e, se a parcela tem boleto no DDA, o
   `Espelho DDA ….pdf`.
5. `03-NF-e-de-saida/<chave>-DANFE.pdf` ao lado do XML; o da NF-e de entrada
   sem a nossa logo.
6. `02-Extrato/Extrato BB — conta corrente AAAA-MM.pdf`, em paisagem, com
   "GERADO PELO APP".
7. `07-Boletos-emitidos/Boleto-….pdf` para cada boleto de produção emitido no
   mês.
8. LEIA-ME: "Pagamentos do mês: N pastas em 06-Pagamentos…", e o
   `indice.csv` com a origem "Interno" nos documentos gerados.
9. Tempo: é estimativa (não medi com o app aberto, só a impressão de cada
   documento à parte). Com uns 40 pagamentos, deve levar perto de um
   minuto. Me diga quanto demorou aí.

## Parte N — Fase C (02/10/2026): as aplicações do BB (Rende Fácil e CDB DI)

**O que mudou**
- **Tela nova "Aplicações (Rende Fácil, CDB)"** (Ações da Contabilidade). O
  botão **Importar PDFs** recebe os PDFs mensais que o site do BB dá, os mesmos
  que você já baixa. Pode mandar os dois juntos.
- **O app lê e confere cada PDF ao centavo.**
  - Rende Fácil:
    - saldo inicial + aplicações − resgates − IR − IOF + rendimentos = saldo
      final;
    - a soma do histórico = o resumo;
    - o rendimento do mês = o dos resgates − o que vinha do mês anterior + o
      que ficou no saldo.
  - CDB:
    - capital anterior − resgatado + aplicado = capital final;
    - cada resgate: capital + juros − IR = líquido;
    - o capital final = a tabela dos últimos meses = a soma dos depósitos em
      ser.
- **Cada linha do extrato liga sozinha ao PDF** (mesmo dia, valor exato):
  - no Rende Fácil, a linha "BB RENDE FÁCIL" é a soma do dia: uma linha para
    as aplicações, outra para os resgates;
  - no CDB, cada resgate vem em duas linhas, o capital e o rendimento líquido.

  A linha fica **conciliada** ("Conferido com o PDF da aplicação") e a
  classificação vai para a conta da aplicação (00020.001/.002), pelas regras
  da fase B. **O rendimento não vira receita**: fica na 00020, como no
  balancete. Se o extrato chegar depois do PDF, a conciliação automática liga
  na hora; o botão **Conferir de novo** faz o mesmo.
- **Com o seu OFX e os seus dois PDFs de setembro**, num banco de teste: os dois
  PDFs fecharam (todas as conferências ok) e as **23 linhas** das aplicações
  no extrato (17 do Rende Fácil e 6 do CDB) ligaram sozinhas.
- **Guarda só os dados.** O PDF original não dá para refazer igual, então fica
  guardado **só até o pacote do mês ser salvo**. Ele vai no pacote, na pasta
  `02-Extrato`, e depois sai do servidor. Um PDF mais novo do mesmo mês
  substitui o anterior, solta o que o anterior tinha ligado no extrato e liga
  de novo.
- **Painel (fonte Extrato), com o mês encerrado** (no mês em curso, só aviso
  ou nada):
  - o extrato tem o Rende Fácil ou o CDB e o **PDF do mês não foi
    importado**: crítico;
  - o **PDF não fecha**: crítico;
  - o **extrato não bate com o PDF**: crítico.
- **Relatório:** seção nova "Aplicações financeiras", com saldo inicial,
  aplicado, resgatado, rendimento do mês, IR, IOF, saldo final e a
  conferência.
- **Leitor de PDF:** passou a entender as fontes que o navegador usa ao
  imprimir (Type0 com mapa de caracteres). Nenhuma biblioteca nova.

**O que fazer**
1. Rodar `sql/contabilidade_fase_c.sql` (DEV e produção), **depois** do
   `contabilidade_fase_d.sql`, e **reiniciar a API**. Ele termina mostrando
   "aplicacoes 0 | lancamentos 0".
2. Ações › **Aplicações (Rende Fácil, CDB)** › **Importar PDFs** e escolher os
   dois PDFs de setembro.
3. Conferir que os dois cartões dizem **"Confere com o extrato"**.

**Checklist visual**
1. Sem o SQL: o aviso amarelo "As aplicações ainda não estão ativadas: rode
   sql/contabilidade_fase_c.sql…".
2. Importar os dois PDFs de setembro: "2 PDFs lidos · 2 importados · 23
   linhas do extrato conferidas com o PDF".
3. Cartão do Rende Fácil: os 8 números, "Conferências 7 de 7", a lista com
   os ✓, e a tabela com cada dia ("Conferido").
4. Cartão do CDB: "Conferências 6 de 6", e cada resgate em duas linhas
   (capital e rendimento líquido), todas "Conferido".
5. Conciliação de setembro: as linhas "BB RENDE FÁCIL" e "RESGATE BB CDB DI"
   conciliadas, com "Conferido com o PDF da aplicação".
6. **PDF** (no cartão) abre o original do BB.
7. Importar o mesmo PDF de novo: "1 já estava no app".
8. Relatório de setembro (PDF): a seção "Aplicações financeiras".
9. Painel de setembro: nenhuma pendência das aplicações.

## Parte O — Fase F (02/10/2026): pago em nome de terceiros (a Artdeco)

**O que mudou** (a sua resposta: o boleto em que o pagador é a Artdeco e que
a Santíssimo pagou é **a receber da Artdeco**, não despesa; o Pix que ela
manda abate)
- **O item a receber nasce sozinho.** O comprovante do BB (Fase D) cujo
  **pagador** é outra empresa (CPF/CNPJ inteiro, diferente do CNPJ da
  Configuração fiscal) vira um item "a receber" dela, assim que o comprovante
  liga ao débito do extrato. O débito fica **conciliado** com o item
  ("De terceiro (a receber)"). Vale para o ZIP, o "Ligar sozinho", o ligar à
  mão e a conciliação automática.
- **A devolução liga sozinha.** O crédito do extrato que traz o CNPJ do
  terceiro (no lançamento ou na descrição do Pix) ou o nome dele (a palavra
  "ARTDECO") liga ao item **de mesmo valor** (se houver um só), ou a **todos
  os em aberto** quando a soma bate. Valor diferente (devolução parcial, várias
  juntas que não fecham): à mão, na Conciliação, escolhendo "Devolução de
  terceiro".
- **Tela nova "Pago em nome de terceiros"** (Ações). Um bloco por terceiro,
  com cada item (o que foi pago, o débito, o comprovante, o que voltou, o que
  falta) e o saldo. Visões: a receber (de qualquer mês), pagos na competência
  e todos.
  - **Lançar à mão:** o débito do extrato sem comprovante do BB que foi pago
    por outra empresa ou pessoa (nome, CPF/CNPJ opcional, o que foi pago).
  - **Cancelar:** o item lançado por engano sai e o débito volta a ficar a
    conciliar. Com devolução ligada, não cancela (desfaça a devolução antes).
- **O pagamento não vira despesa.** A classificação usa a regra de origem
  nova **"Pago em nome de terceiro / devolução (a receber)"**. A conta do
  plano é da AEA (pendência 68): até criar a regra, esses lançamentos ficam
  sem conta.
- **Painel (fonte Contas a pagar), avisos:**
  - "ARTDECO MOVEIS LTDA deve R$ … à empresa", com o saldo de todos os meses
    até o fim da competência;
  - "N pagamentos de terceiros sem o débito do extrato conciliado", quando o
    débito já estava ligado a outra coisa.
- **Pacote:** o pagamento ganha pasta própria (o débito e o comprovante), sem
  pedir nota da empresa: o documento é da Artdeco. O dossiê diz "Pago em nome
  de terceiro (a receber)".
- **Relatório:** seção "Pago em nome de terceiros" (pago no mês e o saldo de
  cada um).
- **Com o seu OFX e o seu ZIP de setembro**, num banco de teste: os **4
  boletos** com a Artdeco de pagadora viraram itens, os 4 débitos ficaram
  conciliados com eles, o **Pix da Artdeco** ligou sozinho a um deles (mesmo
  valor) e **3 ficaram a receber** (o painel mostra o aviso com o saldo).

**O que fazer**
1. Rodar `sql/contabilidade_fase_f.sql` (DEV e produção), **depois** do
   `contabilidade_fase_c.sql`, e **reiniciar a API**. Ele termina mostrando
   "itens_de_terceiros 0".
2. Conciliação de setembro › **Conciliar automático** (ou, se o ZIP já foi
   anexado: Ações › Pago em nome de terceiros › **Conferir de novo**).
3. Quando a AEA disser a conta, criar em Regras a regra de **origem "Pago em
   nome de terceiro / devolução (a receber)"** com a conta dela.

**Checklist visual**
1. Sem o SQL: o aviso amarelo "Os pagamentos em nome de terceiros ainda não
   estão ativados: rode sql/contabilidade_fase_f.sql…".
2. Depois do "Conferir de novo": o bloco **ARTDECO MOVEIS LTDA** com os 4
   itens, cada um "pelo comprovante", o débito "conciliado com o item" e o
   botão **Comprovante**.
3. O item que a Artdeco já devolveu: "Recebido", com a data e o valor do Pix.
4. Os outros: "A receber" e "falta R$ …"; o cartão **A receber** com o
   saldo.
5. Conciliação de setembro: os 4 débitos "De terceiro (a receber)" e o Pix
   da Artdeco "Devolução de terceiro".
6. Painel de setembro: o aviso "ARTDECO MOVEIS LTDA deve R$ … à empresa"
   (botão **Ver** abre a tela).
7. Lançar à mão um débito qualquer (de teste) e **Cancelar**: o débito volta
   a ficar a conciliar.
8. Relatório de setembro: a seção "Pago em nome de terceiros".

## Parte P — Fase G (02/10/2026): o cartão de crédito do BB pela fatura em XLSX

**O que mudou** (as suas regras: a fatura vem sempre em XLSX; "fatura do
cartão a importar" segura o fechamento; a nota casa com a compra pelo valor,
entendendo o parcelado; na dúvida você escolhe; a compra pequena não precisa
de nota)
- **Tela nova "Cartão de crédito"** (Ações). O botão **Importar fatura
  (XLSX)** recebe o arquivo que o site do BB dá (aba "Extrato").
- **O app guarda só os dados**: o cabeçalho, as linhas e as conferências. O
  cartão fica só com os **4 últimos dígitos**; o número inteiro não é
  guardado.
- **Confere as contas da fatura**:
  - saldo anterior + pagamentos e créditos + compras e encargos = valor
    total;
  - cada SubTotal = a soma das linhas dele;
  - a linha "Total" = o valor total do cabeçalho;
  - lançamento em dólar avisa.
- **Lê cada lançamento**: compra, crédito (estorno), pagamento da fatura e
  encargo do banco (IOF, juros, anuidade). Na parcelada ("PARC 06/10"), a
  data é a da compra e a compra inteira é parcela × nº de parcelas. O ano de
  cada data sai do vencimento.
- **O pagamento da fatura liga sozinho no extrato**: o débito do valor total,
  até 10 dias antes ou 6 depois do vencimento, se for um só. A conciliação
  mostra "Pela fatura do cartão importada" e a classificação vai para a
  **00744 Cartão de Crédito** (regra nova do SQL). Pagamento parcial: à mão,
  na Conciliação, escolhendo "Fatura do cartão".
- **A nota de cada compra**:
  - **sozinha**, quando há uma única nota de mesmo valor (na parcelada, o
    valor da compra inteira, com o arredondamento das parcelas) emitida de
    5 dias antes a 10 depois da compra, e ela não serve para outra compra;
  - **na dúvida** (duas notas de 150,00, por exemplo), a tela mostra
    "**Escolher a nota…**" com as possíveis, a de nome parecido primeiro;
  - a **parcela seguinte** (a 04/10 da mesma compra, na fatura do mês
    seguinte) herda a nota (ou o "sem nota") da anterior;
  - **Recibo**: anexa o PDF ou a foto do recibo à compra;
  - **Sem nota**: com o motivo (vale para todas as parcelas);
  - **Desfazer** solta a nota ou o "sem nota".

  A nota ligada à compra **sai de "documento sem conta a pagar"**: foi paga
  pela fatura. Ela também deixa de ser procurada como conta no extrato.
- **Limite da compra sem nota** (Configurações › Geral, Sup Admin): R$ 50,00.
  Vale a compra inteira (a parcelada de 12 × 50,00 pede nota). No mesmo lugar,
  "Cartão de crédito em uso" (Sim/Não).
- **Painel (fonte Contas a pagar)**:
  - **sem a fatura do mês** (vencimento no mês): aviso no mês em curso,
    **crítico** depois que o mês acaba;
  - **a fatura não fecha**: crítico;
  - **compra acima do limite sem nota**: crítico ("1 tem nota sugerida:
    escolha");
  - **compra de antes do início** sem nota (as parcelas antigas, as compras
    de agosto na fatura de setembro): aviso;
  - **fatura sem o pagamento conciliado**, depois do mês: aviso.
- **Pacote**: o pagamento da fatura ganha pasta. O dossiê traz a fatura e a
  tabela das compras, com a nota (ou o motivo) de cada uma; as notas vão no
  mês fiscal delas.
- **Relatório**: seção "Cartão de crédito" (total, pago no extrato, compras,
  com nota, abaixo do limite, faltam).
- **Com o seu OFX e a sua fatura de setembro**, num banco de teste:
  - a fatura **fecha** (as 4 conferências);
  - 32 lançamentos: 1 pagamento e 31 compras, 4 delas parceladas;
  - o **pagamento de 14/09 (2.744,82) ligou sozinho** e foi para a 00744;
  - 24 compras abaixo de R$ 50,00;
  - as outras 7 são de antes de setembro (aviso).

**O que fazer**
1. Rodar `sql/contabilidade_fase_g.sql` (DEV e produção), **depois** do
   `contabilidade_fase_f.sql`, e **reiniciar a API**. Ele termina mostrando
   "faturas 0 | compras 0 | regra_cartao 1".
2. Ações › **Cartão de crédito** › competência **setembro/2026** ›
   **Importar fatura (XLSX)** e escolher a fatura de venc. 12/09.
3. Quando a fatura de **12/10** sair, importar também (as compras de
   setembro estão nela; elas pedem nota).

**Checklist visual**
1. Sem o SQL: o aviso amarelo "O cartão de crédito ainda não está ativado:
   rode sql/contabilidade_fase_g.sql…".
2. Importar a fatura de setembro: "1 fatura lida · 1 importada · 1 pagamento
   conciliado no extrato".
3. O bloco "Fatura de venc. 12/09/2026 · cartão final …", com "As contas
   fecham" e os 4 números: Fatura 2.744,82, Pago no extrato 2.744,82 (14/09),
   Compras 31 e Faltam notas 0.
4. A tabela: as compras pequenas "Abaixo do limite"; as de agosto e as
   parcelas antigas "Compra de antes do início", com Recibo e Sem nota; o
   pagamento "Pagamento da fatura".
5. Conciliação de setembro: o débito de 14/09 "Pela fatura do cartão
   importada".
6. Configurações › Geral: "Cartão de crédito em uso" e "Compra no cartão sem
   nota até (R$) 50,00".
7. Painel de setembro: o aviso das compras de antes do início. Painel de
   outubro: "Fatura do cartão de outubro/2026 a importar".
8. Relatório de setembro: a seção "Cartão de crédito".

## Parte Q — Fase E (02/10/2026): quem recebe comissão e produção, e a nota de cada um

**O que mudou** (as suas respostas: 5.1 a, 5.2 a, 5.3 b)
- **Tela nova "Quem recebe (comissão e produção)"** (Ações). Ela lista os
  nomes que recebem no Financeiro e de onde cada um vem:
  - os fechamentos de comissão (CMS e Royalty);
  - as regras de comissão;
  - o dono do cliente;
  - o desenhista da peça;
  - os colaboradores da produção.

  Ao lado de cada nome, o cadastro em Contatos e as partes em aberto: CMS de
  setembro, Royalty de setembro, com a situação de cada uma (aguardando a
  nota, nota recebida: pronta para pagar, paga e com nota, paga sem a nota).
- **Ligar ao contato (5.1 a)**: cada nome é ligado ao cadastro dele em
  Contatos, que precisa ter o **CPF/CNPJ completo**. É por ele que a nota da
  pessoa é reconhecida. Quem recebe sem o cadastro gera um aviso no painel
  ("2 pessoas que recebem sem o CPF/CNPJ").
- **A nota que chega** (do ADN ou registrada à mão), quando o CPF/CNPJ do
  emitente é de alguém que recebe:
  - procura a parte dela nos fechamentos de até 6 meses antes;
  - **CMS e Royalty juntos (5.2 a)**: se o valor bate com o total da pessoa
    no fechamento, a nota é **repartida** sozinha entre os dois; o valor
    líquido (com ISS ou retenção) também vale;
  - **não vira conta a pagar**, não pede conta ("documento sem conta a
    pagar") e não é procurada como conta no extrato: quem paga é o
    Financeiro;
  - **já pago**: a nota só documenta o pagamento, e o "fechamento sem NFS-e"
    do painel some;
  - **ainda não pago (5.3 b)**: fica **pronta para pagar** e nasce **uma**
    tarefa de pagar para quem fechou a competência, no dia marcado ("pagar
    até"). A regra nova está em Tarefas › Automáticas, "Nota de
    comissão/produção recebida → pagar". Quando o pagamento é confirmado no
    Financeiro, a tarefa conclui sozinha e a nota passa a documentar o
    pagamento.
  - **não bateu** (valor diferente, ou o mesmo valor em dois meses): a nota
    fica em "Notas a conferir", com o aviso no painel, e você escolhe a
    parte ("Escolher a parte…").
- **A produção** (paga de uma vez): a nota de quem não recebe comissão (o
  Bruno, MEI) liga sozinha quando o valor é o da produção inteira do mês.
- **Conferir as notas**: faz o mesmo com as notas registradas antes (ou
  antes de o nome ser ligado ao contato).

**O que fazer**
1. Rodar `sql/contabilidade_fase_e.sql` (DEV e produção), **depois** do
   `contabilidade_fase_g.sql`, e **reiniciar a API**. Ele termina mostrando
   "pessoas 0 | notas_de_fechamento 0".
2. Em **Contatos**, ter o cadastro de cada pessoa que recebe, com o CPF/CNPJ
   (a Márcia, a Barral & Lamounier, o Bruno…).
3. Ações › **Quem recebe (comissão e produção)** › em cada nome, **Ligar ao
   contato…**.
4. **Conferir as notas**: as NFS-e que já estavam registradas se ligam aos
   fechamentos.

**Checklist visual**
1. Sem o SQL: o aviso amarelo "O cadastro de quem recebe ainda não está
   ativado: rode sql/contabilidade_fase_e.sql…".
2. A lista dos nomes, com "Sem cadastro" e o botão **Ligar ao contato…**,
   que abre os contatos com CPF/CNPJ.
3. Depois de ligar: "Ligado", com o nome e o CPF/CNPJ do contato; a etiqueta
   do topo diminui.
4. Registrar à mão a NFS-e de quem recebe CMS e Royalty, com o valor da soma
   dos dois: a nota fica ligada às duas partes, nenhuma conta a pagar é
   lançada, e a tarefa de pagar aparece em Tarefas.
5. Uma nota de valor diferente: aparece em "Notas a conferir" e
   **Escolher a parte…** mostra as partes em aberto.
6. Confirmar o pagamento no Financeiro: a tarefa de pagar fica concluída.
7. Painel: o aviso "pessoas que recebem sem o CPF/CNPJ" some quando todos
   estão ligados.

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
45. ~~Comprovantes anexados à mão~~ — **feito na Fase D (02/10/2026):** o ZIP
    do site do BB entra de uma vez, o app guarda só os dados, refaz o PDF
    idêntico e liga cada um ao débito do extrato (Parte L).
46. **Pagamentos em lote** pelo BB (API de Pagamentos) fica para uma fase
    futura, se quiser.

**NFS-e (ADN)**
47. Confirmar, na primeira busca em produção, que as NFS-e de **Contagem** e
    de **Belo Horizonte** aparecem (o formato da resposta do ADN também se
    confirma aí).

**Plano da AEA (Fase B)**
48. **B2 — lançamentos por competência como no balancete:** a venda faturada
    vira D 00028.xxx (cliente desdobrado) / C 00528 no mês da nota; a compra,
    D 00340 / C 00223.xxx (fornecedor desdobrado); o pagamento, D 00223.xxx /
    C 00008; o recebimento, D 00008 / C 00028.xxx; o sinal antes da nota,
    00270 Adiantamento Clientes; o Simples apurado, D 00780 / C 00608. Isso
    muda o resultado do mês (passa a ser pela nota, não pelo caixa).
    Aguardando o seu ok.
49. Layout de importação do Mastermaq (a AEA não respondeu).
50. Conferir com a AEA a lista das 38 contas em uso (principalmente energia e
    aluguel no custo, 3.01.02.04).

**DDA (Fase H)**
51. **Pagamento por boleto sem o boleto = documental** (segura o pacote),
    seguindo a sua regra de mandar o boleto junto do comprovante. Só cobra com
    o DDA ligado; resolve com o boleto do DDA ligado à conta ou com o PDF do
    boleto anexado. Ok, ou prefere **aviso**?
52. **Boleto liquidado no DDA sem conta**: o débito do extrato de mesmo valor, a
    até 5 dias do vencimento, **lança a conta do boleto e a paga sozinho**
    (como a nota sem conta da Fase A). A conta nasce sem nota, então o painel
    continua pedindo a nota (crítico). Ok?
53. Pedir ao BB a **massa de teste da homologação do DDA**. Sem ela, o teste é
    em produção (só consulta).
54. **Vários boletos pagos num débito só** (pagamento em lote): a Fase D liga
    **um comprovante por débito**. O débito que é a soma de vários
    comprovantes ainda não se liga sozinho: fica "Sem lançamento" para
    decidir à mão. Fica para depois, se aparecer no extrato.

**Comprovantes do BB (Fase D)**
55. O **pagamento sem comprovante** (C3) é resolvido pelo débito do extrato:
    o pagamento conciliado com o débito que tem o comprovante ligado não pede
    mais o PDF. Ok?
56. O original guardado (só quando o app não refaz idêntico) sai do servidor
    quando o pacote é **salvo**, e não só gerado, para não perder o arquivo se
    você cancelar o "Salvar". Ok?
57. As regras de **ligar sozinho** (Parte L): chave forte única, ou um único
    débito do mesmo dia (ou com o nome, a até 3 dias). O resto é sugestão.
    Ok?
58. **Comprovante sem lançamento do extrato** é **aviso** (não segura o
    pacote). Ok, ou prefere documental?

**Pacote por pagamento (Fase I)**
59. **Tirar do servidor os outros anexos depois do pacote salvo** (a sua
    resposta 1: boleto do fornecedor, recibos, guias e outros PDFs) **ainda
    não foi feito**. Há duas dúvidas antes:
    - **(a)** O recibo e a guia são o *documento* do pagamento. Depois de
      tirados, o painel dos meses seguintes precisa contar "enviado no pacote
      X (SHA-256 …)" como documento presente; isso exige mexer no painel.
    - **(b)** Uma NFS-e que só existe em PDF (sem XML) também sai? O XML fica,
      pela lei.

    Sugestão: tirar só o boleto do fornecedor e o comprovante anexado à mão;
    manter recibo, guia, nota em PDF e contrato. Qual prefere?
60. **OFX refeito dos lançamentos** (conferido com o original, que depois
    sai do servidor) **ainda não foi feito**. O OFX original continua no
    pacote. Faço numa fase seguinte?
61. **Boletos emitidos no mês** entram no pacote (`07-Boletos-emitidos`), só
    os de produção, com a marca PAGO/BAIXADO quando for o caso. Ok?
62. **Comissão/produção e reembolso** também ganham pasta (não só as contas
    a pagar). Ok?
63. O **boleto e o recibo anexados à conta** (não ao pagamento) vão na pasta
    de **todo** pagamento daquela conta. Numa conta em 3 parcelas pagas em
    3 meses, eles aparecem nos 3 pacotes. Ok?

**Aplicações (Fase C)**
64. O **rendimento** do Rende Fácil e do CDB aparece no relatório, mas **não
    entra no resultado**: fica na 00020, como no balancete (a sua resposta).
    O IR e o IOF retidos também ficam na 00020. Confirmar com a AEA se ela
    quer o IR como imposto a compensar.
65. No CDB, o saldo do relatório é o **capital em ser**. Os juros acumulados
    (e o IR projetado) da tabela do BB aparecem só como informação. Ok?
66. O extrato do mês em curso com o Rende Fácil e **sem o PDF**: só aviso.
    Depois do fim do mês: **crítico** (segura o fechamento). Ok?
67. Ainda não vi uma **aplicação nova no CDB** num PDF de verdade (em
    setembro só houve resgates). O app espera "dd/mm Aplicação - nº do
    depósito" com "valor capital". Se o primeiro PDF com aplicação não
    fechar, me mande o PDF.

**Pago em nome de terceiros (Fase F)**
68. **A conta do plano** para o que a Artdeco deve é da AEA. Candidatas no
    plano dela: **1.01.02.03 Outros valores a receber** (com uma subconta
    para a Artdeco), ou **1.02.01.03 Empréstimos a empresas ligadas**, se a
    Artdeco for ligada à Santíssimo. Até a regra existir, os lançamentos de
    terceiros ficam sem conta.
69. O item nasce de **todo** comprovante com o pagador de fora ligado ao
    extrato, mesmo quando a conciliação já ligou o débito a uma conta da
    própria empresa. Nesse caso aparece "Débito não ligado" e o aviso no
    painel, para você conferir (e cancelar o item, se a conta era mesmo da
    empresa). Ok?
70. A devolução liga sozinha **só** com o valor exato de um item, ou com a
    soma exata de todos os em aberto. O resto é à mão, na Conciliação. Ok?
71. O saldo a receber é **aviso** (não segura o fechamento). Ok, ou prefere
    que vire documental depois de algum prazo (ex.: 60 dias)?

**Cartão de crédito (Fase G)**
72. A competência da fatura é o **mês do vencimento** (quando ela é paga no
    extrato). As compras de setembro vêm na fatura de 12/10 e são cobradas no
    fechamento de outubro. Ok?
73. A compra (ou parcela) **de antes do início** do app (as de agosto na
    fatura de setembro, as parcelas de compras antigas) sem nota é **aviso**,
    não segura setembro. Ok?
74. A compra **acima do limite sem nota** é **crítica** (como o pagamento sem
    nota). Resolve com a nota, o recibo anexado ou "Sem nota" com o motivo.
    Ok?
75. Quando a nota de uma compra no cartão foi registrada **com a conta a
    pagar junto** (o cartão da SEFAZ com "Lançar a conta a pagar junto"), ela
    só aparece como opção para escolher à mão, e a tela avisa para cancelar a
    conta (foi paga no cartão). Quer que o app **cancele a conta sozinho** ao
    ligar a nota à compra?
76. A **conta do resultado** de cada compra no cartão (material, consumo,
    combustível…) ainda não é classificada: o pagamento da fatura vai inteiro
    para a 00744. Desdobrar por compra entra junto com a B2 (pendência 48).

**Quem recebe (Fase E)**
77. **Produção com o rateio entre vários colaboradores**: o app ainda não
    reparte a produção por colaborador. A nota de quem faz a produção só liga
    sozinha quando o valor é o da produção inteira do mês; no rateio, cada
    nota fica para escolher à mão. Quer que use o rateio (a parte de cada
    colaborador)?
78. "Pronta para pagar" aparece na Contabilidade (Quem recebe) e na tarefa.
    No Financeiro › Próximo pagamento ainda **não** aparece a marca "nota
    recebida". Quer a marca lá também?
79. A tarefa de pagar vai para **quem fechou a competência** (se pode
    "Confirmar pagamento" e não desligou a regra), no dia do "pagar até".
    Ok?
80. A nota procura os fechamentos de até **6 meses** antes da emissão. Ok?
81. A nota que bate com **duas partes** (o mesmo valor em dois meses) não
    liga sozinha: fica em "Notas a conferir" (aviso) para você escolher. Ok?
