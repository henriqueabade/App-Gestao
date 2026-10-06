# Comissão pelo valor real e ajustes por pessoa

Pedido do dono em 06/10/2026:

> "a comissão deve contar no valor real do pedido e dos boletos/pagamentos
> previstos, hoje ela não conta por exemplo acréscimos colocados […] a parte
> de registrar ajuste faz um ajuste na parcela no valor do pedido do cliente,
> sendo que o usuário pode registrar um ajuste na realidade na comissão,
> royalties ou produção escolhendo para quem quer fazer esse ajuste […] se o
> ajuste deixar o valor negativo deve ser levado essa diferença para o próximo
> mês fazendo o abatimento e mostrando como ajuste restante do mês anterior"

## 1. A base da comissão é o valor real

`comissoes.valorRealDaParcela` (usada em `comissoes.apurar`):

| A parcela                         | Base da CMS e do Royalty                                       |
|-----------------------------------|----------------------------------------------------------------|
| recebida                          | o que o recebimento cobriu da parcela (`valor_parcela`)         |
| em aberto com boleto vivo         | o valor em dia do boleto: cheio − desconto até o vencimento    |
| em aberto com ordem de pagamento  | o valor da ordem                                               |
| sem nenhum dos dois               | a parcela do pedido — que já leva o Adicional ou o Desconto    |

Antes, a parcela em aberto valia sempre pelo valor gravado na parcela, mesmo
quando o boleto (importado do BB, por exemplo) ou a ordem cobrava outro valor
— a previsão saía menor do que o que o cliente ia pagar. O abatimento do
boleto continua saindo à parte, e multa e juros pagos depois do vencimento
continuam fora da base (decisão de 25/09/2026; ver a pendência no relatório).

Cada parcela das telas leva `base_origem` (recebimento, boleto, ordem ou
parcela), para dizer de onde veio o valor.

## 2. "Registrar ajuste" virou ajuste POR PESSOA

O modal não escolhe mais parcela do cliente: ajusta o que **uma pessoa**
recebe no mês, sem mexer no pedido.

- **Onde:** CMS (o dono do cliente), Royalty (o desenhista) ou Produção (o
  processo — marcenaria, acabamento… — e, se houver rateio, o colaborador).
- **Tipo:** os que somam (acréscimo, bonificação, correção para mais, outros)
  e os que descontam (desconto, adiantamento já pago, estorno, correção para
  menos, outros). O sinal fica gravado com o ajuste.
- **Valor, data, mês em que entra, referência** (livre: "PED115", "NF 2/345"),
  **motivo** (ao menos 5 letras) e **observação**.
- O quadro mostra o valor da pessoa no mês **antes e depois** do ajuste. Se
  ficar negativo, o aviso diz quanto vai para o mês seguinte.
- Embaixo, os ajustes lançados no mês, com quem lançou (no balão), a situação
  (em aberto, fechado, cancelado) e o **Cancelar** — só enquanto o ajuste não
  entrou num fechamento.
- Mês já fechado (comissões ou produção, conforme a área) não recebe ajuste:
  a tela e o backend pedem um mês aberto.
- Os "Detalhes da parcela" abrem o mesmo modal com a parcela como referência
  e, se a CMS dela é de uma pessoa só, com ela escolhida.

O ajuste na parcela antigo (`ajustes.js`, tabela `ajustes_financeiros`)
continua existindo para a **devolução** (que reduz a base sozinha) e para os
ajustes já lançados — o "Cancelar" deles continua nos Detalhes da parcela.

### Como entra nas contas

- **CMS e Royalty:** cada ajuste vira um item de ajuste do mês, da pessoa
  (`ajustesPessoa.itensDeComissao`, numa entrada própria de `apurar` sem
  pedido nem parcela). Soma no "Quem recebe", no fechamento e no pagamento
  por pessoa.
- **Produção:** vira uma linha `tipo_item: 'ajuste'` do processo
  (`ajustesPessoa.linhasDeProducao`, em `producao.lerBase`). A produção fecha
  e se paga por processo, então o saldo é do processo; o colaborador aparece
  na linha.
- No fechamento, o item guarda `ajuste_pessoa_id` (índice único): um ajuste
  entra em um fechamento só.

### O negativo vai para o mês seguinte

Quem termina o mês negativo não recebe nada nele e a diferença vira, no mês
seguinte, o item **"Ajuste restante do mês anterior (setembro/2026): Fulano
terminou setembro/2026 com − R$ X"**, que abate o que a pessoa tiver lá.

- Mês fechado: o restante vem do fechamento (`saldosAnteriores`, como já era
  com os estornos; o texto mudou de "Saldo negativo" para o novo).
- Mês ainda aberto: o próximo mês já mostra o restante **projetado**
  (`restantesProjetados`, comissões e produção), mês a mês. Quando o mês de
  origem fechar, o projetado vira o do fechamento.
- Os repasses em atraso (`repasses.js`) usam a mesma conta.

## 3. Onde aparece

- **Resumo de Comissões:** "Ajustes por pessoa" (quantos, quanto somou e
  descontou), "Restante do mês anterior" e "Fica para o próximo mês" (com
  quem). O "Ajustes" de antes continua sendo o das parcelas (estornos,
  devolução). No "Quem recebe", quem está negativo aparece em vermelho, com a
  etiqueta.
- **Resumo de Produção:** as mesmas três linhas, por processo.
- **Relatórios:** novos "Ajustes por pessoa (CMS, Royalty e Produção) e
  restante do mês anterior" (aba Comissões) e "Ajustes da produção e restante
  do mês anterior" (aba Produção), por competência ou período. "Comissões do
  mês" e "Ajustes de períodos anteriores" mostram os ajustes por pessoa e o
  restante com essas situações; a produção da competência e os pagamentos por
  processo trazem as linhas de ajuste.
- **Atividade recente / histórico:** "Ajuste registrado" e "Ajuste cancelado"
  com o texto do ajuste. Quem lançou recebe aviso quando outra pessoa cancela.

## Banco

`sql/financeiro_ajustes_pessoa.sql` (rodar e **reiniciar a API**):

- tabela `financeiro_ajustes_pessoa`;
- coluna `financeiro_fechamento_itens.ajuste_pessoa_id` com índice único;
- a trava de `tipo_item` (se houver) passa a aceitar `'ajuste'` também na
  produção.

Sem o SQL nada quebra: os ajustes por pessoa simplesmente não existem e o
modal avisa qual arquivo falta. Conferido num PostgreSQL 17 descartável: roda
duas vezes sem erro e as travas recusam tipo inválido e ajuste repetido no
fechamento.

## Rotas

- `GET /api/financeiro/ajustes-pessoa/opcoes` — quem recebe em cada área, os
  tipos, os processos, os colaboradores e as competências abertas.
- `GET /api/financeiro/ajustes-pessoa?competencia=` — os ajustes do mês e
  quanto cada pessoa (ou processo) tem nele.
- `POST /api/financeiro/ajustes-pessoa` e `POST
  /api/financeiro/ajustes-pessoa/:id/cancelar` (`financeiro.ajuste.registrar`).

## Testes

- `backend/financeiroAjustesPessoa.test.js` (4): a base pelo valor real
  (boleto, ordem, parcela com Adicional, recebimento); o ajuste de CMS no mês,
  o negativo projetado e o do fechamento; o ajuste da produção por processo;
  a validação; e a ponta a ponta (registrar, resumo, relatórios, fechar,
  travar mês fechado, não cancelar o fechado, cancelar o aberto).
- `src/js/__tests__/financeiroModais.test.js`: as contas da tela (valor da
  pessoa no mês, antes e depois), os tipos iguais aos do backend, as chamadas
  novas.
