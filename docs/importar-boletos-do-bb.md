# Importar boletos que já existem no Banco do Brasil

Pedido do dono em 23/09/2026. Boleto emitido **antes do app** (pelo Gerenciador
Financeiro) não tem linha na tabela `boletos`: não sai em PDF, não sincroniza,
não aparece na parcela e o aviso de pagamento do BB é descartado ("não é de um
boleto deste sistema"). Com a importação eles entram como se o app tivesse
gerado — com a marca `origem = 'importado'`.

## SQL (rodar e reiniciar a API)

`sql/boletos_importados.sql`: coluna `origem` ('app' | 'importado'),
`pedido_id`, `parcela_id` e `numero_parcela` aceitando nulo (boleto importado
pode entrar sem parcela) e um índice em `origem`. Sem o SQL a tela avisa e nada
quebra.

## Decisões do dono

| Pergunta | Escolha |
|---|---|
| A lista traz o quê | **Em aberto** por padrão; um seletor mostra os **pagos e baixados** |
| Faixa de vencimento padrão | **12 meses atrás até 12 meses à frente** (editável; se o BB recusar a janela, o app quebra em pedaços de 90 dias sozinho) |
| Importado já pago cuja parcela já tinha recebimento à mão | **Vincula e mantém o lançamento à mão**; se o valor ou a data do BB diferirem, fica o alerta |
| Casamento certo (valor e vencimento batendo) | **Já vem marcado** na tabela (24/09) — importar continua sendo clique do usuário |

## Duas entradas, um destino

**1. A lista do BB** — botão "Importar boletos do BB" na Configuração de
cobrança e "Importar do BB" no Visualizar pedido (aí os do pedido vêm
primeiro). A tela busca `GET /boletos` por faixa de vencimento e situação,
seguindo as páginas do banco, e mostra: nosso número, seu número, vencimento,
valor, situação no BB, pagador e a **parcela sugerida**.

O casamento tenta, nesta ordem (a primeira que fecha, ganha):

| Regra | Confiança | Na tela |
|---|---|---|
| **Seu número** no padrão do app (`PED120P1` → pedido PED120, parcela 1) | alta | **já vem marcado** |
| **Documento do pagador + valor + vencimento** (o BB só manda o pagador no detalhe; na lista ele vem vazio) | alta | **já vem marcado** |
| **Mesmo valor e mesmo vencimento**, uma parcela só | alta | **já vem marcado** |
| **Mesmo valor e vencimento a até 5 dias** (boleto corrido para o dia útil, ou prorrogado no banco), uma parcela só | média | "confira" — marcar é do usuário |

Só entram parcelas **livres** (sem boleto vivo) e de pedido não cancelado.
**Empate nunca vira sugestão**: com duas parcelas idênticas não há como
escolher, e o palpite errado criaria recebimento no pedido errado.

A marcação automática é só isso — marcação. **Importar continua sendo o
clique do usuário** (decisão do dono, 24/09/2026: "obviamente a decisão final
de salvar e importar é do usuário").

Cada linha pode ir com a sugestão, com outra parcela escolhida na busca, ou
**sem relacionar**. O que já está no app aparece como "já importado" e não se
marca.

**2. A linha digitável** — em "NF-e e boletos de fora", ao colar a linha o app
tira o nosso número do campo livre (`000000` + convênio + sequencial +
carteira). Se o banco é o 001 e o convênio é o seu, ele consulta
`GET /boletos/{nosso número}`:

- **achou**: importa de verdade, ligado à parcela daquela linha, e a tela diz
  "Reconhecido no Banco do Brasil — entra como boleto de verdade, não como
  boleto de fora";
- **não achou, ou é de outro banco**: segue como boleto de fora, como antes;
- **é do seu convênio mas o BB não respondeu**: a linha acusa o erro e nada é
  gravado — na dúvida, não se inventa.

## O que a importação faz

1. grava a linha com `origem = 'importado'`, o vínculo escolhido (ou nenhum) e
   `chave_idempotencia = <ambiente>:<nosso número>`;
2. deixa o evento "importado" em `boletos_eventos`, com quem importou e quando;
3. **sincroniza** logo em seguida (`boletoOperacoes.sincronizar`): estado,
   valores, vencimento, pagamento e linha digitável vêm do próprio BB;
4. empurra `proximo_sequencial_producao` para o maior sequencial importado + 1
   — senão o próximo boleto gerado aqui repetiria um número que já existe lá.

**Nunca duas vezes**: o UNIQUE (ambiente, nosso número) decide; o que já está
na tabela volta como "já estava no app".

**Só em produção valendo.** Na homologação o BB só aceita a conta de teste
dele, que não é a da empresa — a tela recusa com essa explicação.

## Boleto sem parcela

Entra do mesmo jeito e pode ser ligado depois, pela mesma tela (botão de
corrente na coluna Parcela → `POST /api/cobranca/boletos/:id/vincular`).
Enquanto estiver solto:

- o pagamento avisado pelo webhook marca o boleto como **pago** e deixa o
  alerta "não tem parcela vinculada" no histórico — **nunca** um recebimento
  solto no Financeiro;
- a conciliação e a sincronização seguem a mesma regra.

Ligar um boleto a uma parcela que já tem boleto vivo é recusado (não se cobra
duas vezes).

## Permissões

| Ação | Permissão |
|---|---|
| Ver a lista do BB e procurar parcelas | `financeiro.boleto.view` |
| Importar e (des)vincular | `financeiro.boleto.emit` |

## Como a tela abre (corrigido em 23/09/2026)

Ela só aparece depois de falar com o BB: quem abre usa
`Modal.openWithSpinner(..., { keepExisting: true })`, que põe o spinner da
casa e espera o aviso de pronto. Na primeira entrega os dois botões usavam o
`Modal.open` cru e a tela ficava **escondida** — clicar não fazia nada.
Detalhes em `docs/padroes-de-interface.md`, seção 5 ("Modal que abre outro por
cima" e "Carregamento").

## Código e testes

- `backend/cobranca/importacao.js` — busca no BB (páginas e pedaços de 90
  dias), casamento da parcela, importação, vínculo e o caminho da linha
  digitável; `backend/cobranca/importacao.test.js`.
- Rotas em `backend/cobrancaController.js`: `GET /api/cobranca/importacao/boletos`,
  `GET /api/cobranca/importacao/parcelas`, `POST /api/cobranca/importacao/boletos`,
  `POST /api/cobranca/boletos/:id/vincular`. As rotas de boleto de fora passam
  a reconhecer o boleto do BB antes de gravar.
- `backend/fiscal/externas.js` devolve o `campo_livre` da linha digitável.
- `backend/cobranca/boletoOperacoes.js` e `conciliacao.js`: sem pedido, não
  há recebimento — só alerta.
- Tela: `src/html/modals/pedidos/importar-boletos.html` +
  `src/js/modals/pedido-importar-boletos.js`; testes em
  `src/js/__tests__/importarBoletos.test.js` e
  `src/js/__tests__/modaisEmpilhados.test.js` (este último abre o HTML de
  verdade e confere que o modal sai do `hidden`).
