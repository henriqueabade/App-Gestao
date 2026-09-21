# NF-e e boletos emitidos fora do sistema

Fase 3 das correções de 21/09/2026. Para o pedido que **saiu** (Enviado ou
Entregue) com a nota fiscal e/ou o boleto feitos em outro lugar — contador,
outro sistema, outro banco —, o usuário informa **só os dados**. Nenhum arquivo
fica guardado (decisão do dono).

## Decisões do dono

| Pergunta | Escolha |
|---|---|
| Como informar a NF-e | Pelo **XML** (lido e descartado) **ou** pela **chave de acesso + valor** |
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

Nota de fora **não** tem DANFE, XML, carta de correção nem cancelamento aqui:
não foi emitida por aqui e o arquivo não fica guardado.

## Código

- `backend/fiscal/externas.js` — leitura (XML, chave, linha digitável),
  conferência e gravação; teste em `externas.test.js`.
- Rotas: `GET/POST/DELETE /api/fiscal/pedidos/:id/nfe-externa` (+ `/previa`),
  `GET /api/fiscal/notas-externas`, `POST /api/cobranca/pedidos/:id/boletos-externos`
  (+ `/previa`) e `DELETE /api/cobranca/boletos-externos/:id`.
- `backend/fiscal/painel.js` (Aguardando NF-e) e `backend/cobranca/boletos.js`
  (`boleto_externo` em cada parcela; o `tem_boleto_vivo` continua só do BB).
- Tela: `src/html/modals/pedidos/dados-externos.html` +
  `src/js/modals/pedido-dados-externos.js`; teste em
  `src/js/__tests__/pedidoDadosExternos.test.js`.
