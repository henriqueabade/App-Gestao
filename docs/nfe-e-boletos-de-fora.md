# NF-e e boletos emitidos fora do sistema

Fase 3 das correções de 21/09/2026. Para o pedido com a nota fiscal e/ou o
boleto feitos em outro lugar — contador, outro sistema, outro banco —, o
usuário informa os dados.

> **Mudou em 24/09/2026:** o XML da nota passou a ser **guardado**. Antes ele
> era lido para conferir e jogado fora, e por isso a nota de fora não tinha
> DANFE nem carta de correção — os dois documentos são desenhados em cima do
> `nfeProc`. Ver "Documentos da nota de fora", no fim.

Quando cada um entra (decisão do dono, 23/09/2026): a **NF-e de fora** só
depois que o pedido **saiu** (Enviado ou Entregue) — a nota acompanha a
mercadoria. O **boleto de fora** não espera o embarque: o cliente que paga
adiantado recebe o boleto antes, e a nota só sai no embarque. Pedido cancelado
ou devolvido por inteiro não recebe nenhum dos dois.

## Decisões do dono

| Pergunta | Escolha |
|---|---|
| Como informar a NF-e | Pelo **XML** (guardado desde 24/09/2026, para o DANFE e as cartas) **ou** pela **chave de acesso + valor** |
| Como informar o boleto | Pela **linha digitável** de cada parcela |
| Onde fica o botão | No **Visualizar pedido** e na lista **"Aguardando NF-e"** do Financeiro |
| Quem pode | Quem pode **emitir NF-e** informa a nota; quem pode **gerar boletos** informa o boleto (nenhuma permissão nova) |

## Banco

`sql/nfe_boletos_externos.sql` — rode no banco e **reinicie a API**. Cria
`notas_fiscais_externas` e `boletos_externos`, tabelas próprias: a emissão na
SEFAZ, a carta de correção, o cancelamento, o DANFE e a cobrança do BB
continuam lendo só `notas_fiscais` e `boletos`, e não mudam. Sem o SQL, as
telas seguem como eram e o modal diz o que fazer (`sql_pendente`).

Remover um lançamento só o desliga (`ativo = false`, com quem e quando).

## O que se lê de cada coisa

- **XML da NF-e** — o mesmo leitor da devolução
  (`backend/devolucoes/xmlDevolucao.js`, que recusa DOCTYPE/ENTITY): chave,
  série, número, data, valor, emitente, destinatário e protocolo.
- **Chave de acesso** (44 números, com o dígito verificador conferido): UF,
  mês de emissão, CNPJ do emitente, modelo, série e número. O valor é
  digitado.
- **Linha digitável** (47 números, os três dígitos de campo e o geral
  conferidos): banco, valor e vencimento. O fator de vencimento tem dois
  ciclos (de 07/10/1997 e, depois de chegar a 9999, de 22/02/2025); vale a
  data mais perto de hoje. Conta de consumo (48 números) e código de barras
  (44) são recusados com a explicação.

## Conferência

A nota **não entra** se for de outro CNPJ emitente (não é da empresa), se não
for modelo 55 ou se for uma nota emitida aqui. **Avisa** (e deixa gravar)
quando o destinatário não é o cliente, quando o XML não traz o protocolo da
SEFAZ, quando o valor difere do pedido e quando veio só pela chave (que não
permite conferir tudo). O boleto avisa quando o valor ou o vencimento diferem
da parcela; parcela com boleto do BB vivo não recebe boleto de fora.

## Onde aparece

- **Visualizar pedido**: botão "NF-e e boletos de fora" (pedido que saiu e
  com algo a informar, ou com dado de fora para ver/tirar); tag
  "NF-e 2/123 · de fora" no lugar do "Sem nota fiscal"; na coluna BOLETO a
  tag azul "de fora · banco · vencimento", que copia a linha digitável; tag
  "Boletos de fora N/M" no rodapé.
- **Lista de Pedidos**: tag azul "NF fora" (a emitida aqui continua vencendo).
- **Financeiro › Aguardando NF-e**: botão "NF-e de fora" na linha; com a nota
  informada, o pedido sai da lista (e do número do cartão).
- **Gerar boletos**: a parcela com boleto de fora aparece como "Boleto de fora"
  e não se marca; o backend também a pula (e a geração automática ao emitir a
  NF-e).

### A tabela dos boletos no modal (24/09/2026)

O modal ficou mais largo (`max-w-6xl`) e a tabela tem a coluna **Ações**. As
colunas têm largura fixa (`table-fixed`); a do boleto fica com o resto e
cresce com o modal, e a linha digitável quebra dentro dela: **sem rolagem de
lado**.

| Parcela com… | Ações |
|---|---|
| boleto de fora | **copiar** a linha · **trocar** por outro · **remover** |
| boleto de fora, no meio da troca | **desistir** da troca |
| boleto do BB | — |
| nada (livre) | — (a linha digitável vai no próprio campo) |

**Trocar** transforma a linha no campo da linha digitável ("Substitui: …"). O
"Gravar boletos" manda a linha nova, e o backend desliga a anterior — informar
de novo a mesma parcela sempre foi uma troca. Trocar e desistir refazem só
aquela linha: o que foi colado nas outras não se perde. Quem só pode ver copia
a linha.

Nota de fora **não se emite e não se cancela** aqui: ela já aconteceu lá fora,
e o app só registra. DANFE, XML e carta de correção, sim — ver abaixo.

## Documentos da nota de fora (24/09/2026)

A DANFE e a carta de correção são desenhadas em cima do `nfeProc` (emitente,
destinatário, itens, impostos, duplicatas, protocolo). **Sem o XML não existe
documento nenhum** — e a SEFAZ não devolve o XML de uma nota que você emitiu
por fora: a consulta por chave traz só a situação e o protocolo.

SQL desta parte: `sql/nfe_externa_xml_cce.sql` (coluna `xml` na nota e a
tabela `notas_fiscais_externas_eventos`). Rode e **reinicie a API**; sem ele a
tela avisa e nada quebra.

| Decisão do dono | Escolha |
|---|---|
| Nota informada só pela chave | **Anexar o XML depois**, na mesma tela — não precisa remover e cadastrar de novo |
| Carta de correção de fora | **Registro e documento**: sequência, texto, protocolo e data guardados; o PDF sai igual ao das notas daqui, quando o XML da nota estiver anexado |
| Subir XML de carta | **Sempre disponível** — tendo a nota cartas registradas ou nenhuma |

**Como funciona**

- **Anexar o XML**: a chave do arquivo tem de ser a mesma da nota gravada
  (senão é outra nota, e trocar o conteúdo por baixo seria pior que recusar).
  O que estava em branco no cadastro (protocolo, nome do emitente, documento
  do destinatário, emissão) é preenchido; o que já estava e diverge vira
  **aviso**, nunca sobrescrita silenciosa.
- **DANFE e XML** aparecem no modal "NF-e e boletos de fora" e, no Visualizar
  pedido, nos **mesmos botões** da nota daqui — ou o pedido tem nota própria,
  ou tem a de fora, nunca as duas.
- **As etiquetas geram os documentos** (pedido do dono, 24/09/2026), como a
  tag verde "DANFE" da lista sempre fez: a azul **"NF fora"** (lista) e a
  **"NF-e …· de fora"** (Visualizar) geram o DANFE; a amarela **"CC-e"** gera
  o PDF da **última** carta. Continuam sendo etiquetas — ganham só
  `role="button"`, cursor e teclado. **Sem o XML da nota anexado elas não
  clicam**, e o título diz o que falta. No Visualizar, a etiqueta da nota
  daqui (autorizada ou cancelada) também passou a gerar o DANFE.
- **Cartas de correção**: uma por sequência (1 a 20, como a SEFAZ). Entram
  pelo **XML do evento** (`procEventoNFe`, que preenche tudo e confere o
  `cStat` 135/136 e a chave) ou **à mão** (sequência, texto de 15 a 1000,
  protocolo e data). Sequência repetida é recusada; remover só desliga, e a
  sequência volta a ficar livre. A tag `CC-e ×N` do Visualizar conta as duas
  origens.

## Código

- `backend/fiscal/externas.js` — leitura (XML, chave, linha digitável),
  conferência e gravação; teste em `externas.test.js`.
- Rotas: `GET/POST/DELETE /api/fiscal/pedidos/:id/nfe-externa` (+ `/previa`),
  `GET /api/fiscal/notas-externas`, `POST /api/cobranca/pedidos/:id/boletos-externos`
  (+ `/previa`) e `DELETE /api/cobranca/boletos-externos/:id`.
- Documentos: `POST/GET /api/fiscal/pedidos/:id/nfe-externa/xml`,
  `GET …/nfe-externa/danfe`, `GET/POST …/nfe-externa/cartas`,
  `GET …/cartas/:seq/documento`, `GET …/cartas/:seq/xml` e
  `DELETE …/cartas/:seq`. O desenho é o mesmo das notas daqui
  (`fiscal/danfe.js` e `fiscal/cartaCorrecaoDoc.js`); no renderer,
  `NfeDocumentos.gerarDanfeExterna / salvarXmlExterna / gerarCartaExternaPdf /
  salvarXmlCartaExterna` recebem o id do **pedido**.
- `backend/fiscal/painel.js` (Aguardando NF-e) e `backend/cobranca/boletos.js`
  (`boleto_externo` em cada parcela; o `tem_boleto_vivo` continua só do BB).
- Tela: `src/html/modals/pedidos/dados-externos.html` +
  `src/js/modals/pedido-dados-externos.js`; teste em
  `src/js/__tests__/pedidoDadosExternos.test.js`.
