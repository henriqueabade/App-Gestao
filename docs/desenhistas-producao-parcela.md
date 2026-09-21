# Desenhistas, produção por processo e parcela mínima

Três mudanças pedidas depois dos testes da fase G (17/09/2026). O banco muda
por `sql/desenhistas_producao_parcela.sql` (pasta ignorada pelo git; o dono
roda e reinicia a API). Sem o SQL, as telas avisam qual arquivo rodar e nada
é gravado pela metade.

## 1. Desenhistas e Royalty

- Cada peça tem **um** desenhista: `produtos.desenhado_por`, escolhido numa
  lista (`desenhistas`) com + e −, como a coleção. É **obrigatório** para
  salvar a peça (Novo, Editar e Clonar); o SQL põe "Barral & Lamounier" nas
  peças que já existem. O desenhista é só um nome, não um usuário do app.
- `+` pede **Incluir desenhista** (`prod.designer.create`); `−` pede
  **Excluir desenhista** (`prod.designer.delete`) e recusa se alguma peça usa
  o nome. Rotas: `GET/POST /api/desenhistas`, `DELETE /api/desenhistas/:id`.
- No Editar, o "Desenhado por" segue o botão "Editar Dados de Registro"; a
  peça sem desenhista pode escolher um mesmo com o botão desligado.
- **Royalty**: a regra diz só o percentual (sem "quem recebe"). Em cada
  pedido, a parcela é repartida entre os desenhistas das peças, na proporção
  do valor vendido de cada um (com o desconto do pedido, sem as peças
  devolvidas). Vale uma regra de Royalty por alcance (todos, cliente, pedido).

## 2. CMS do dono do cliente

- A CMS vai para o **dono do cliente** do pedido (`clientes.dono_cliente`),
  mesmo que ele não seja o dono do pedido. "Quem recebe" é uma lista só com os
  usuários que são donos de algum cliente.
- A regra de um dono só vale nos clientes dele. No alcance "um cliente" ou
  "um pedido", a lista mostra só os clientes (e os pedidos) daquele dono; o
  backend recusa (422) o que não for.

## 3. Produção por processo

- Os "setores" da fase G deram lugar aos **processos** (`etapas_producao`),
  os mesmos da peça e da matéria-prima. Na aba Produção das Regras: lista com
  + e −, **Renomear** (troca o nome também em `materia_prima.processo`, nos
  lotes do estoque e nos itens faltantes) e **Ligar/Desligar pagamento**
  (`producao_ativa`: o processo some do Registrar produção e não paga). O `−`
  recusa se algum insumo usa o processo. "Pintura" (teste da fase G) saiu.
- **Valor** de cada processo: em R$ por peça ou em **% do preço cheio da
  tabela fixa**; o da peça vale mais que o padrão do processo.
- **Regra de todas as peças** (o "padrão do processo"; nas telas, "Todas as
  peças" — regra do dono, 21/09/2026): vale para **toda peça que não tem
  regra própria ativa** naquele processo. A peça que tem a dela, ativa, segue
  a dela; regra própria desligada não conta. A regra própria de um processo
  não mexe nos outros processos da peça. Travado em
  `backend/financeiro/producaoUnidades.test.js` ("regra de todas as peças").
- **Conta**: cada insumo do processo é uma parte igual do valor da peça
  inteira. A peça que sai do estoque paga só os insumos que faltavam (9 de 10
  prontos → 1/10; 10 de 10 → nem aparece no processo) e entra primeiro no
  registro (as mais adiantadas antes). Código: `backend/financeiro/producaoUnidades.js`.
- Base do %: **sempre o valor cheio da tabela fixa**. Royalty e CMS usam o
  valor vendido (com desconto).
- Relatórios: pagamento de marcenaria, acabamento, montagem e embalagem;
  produção por pedido com uma coluna por processo.

### Botão "Regra Produção" no cadastro da peça

- Azul escuro, à direita do "+ Começar", nos modais Novo e Editar (a linha
  tem os mesmos tamanhos nos dois). Abre a regra só desta peça: para cada
  processo que ela usa, "usar o padrão", "R$ por peça" ou "% da tabela fixa",
  com a prévia em reais.
- Exige antes nome, código, NCM, coleção, desenhista e os insumos.
- O que se escolhe fica num rascunho e é gravado **depois** da peça
  (`PUT /api/financeiro/regra-producao/:id`). Como os dados fiscais, é
  condição para salvar: todo processo com insumo e pagamento ligado precisa de
  valor (próprio ou padrão). O **(i)** aparece quando a regra está completa e
  mostra o resumo.
- Quem cadastra peças lê e grava a regra da peça (`prod.create`, `prod.edit`,
  `prod.clone`); incluir/renomear/desligar processos continua sendo
  `financeiro.regras.editar`.

## 4. Parcela mínima

- Nova seção **Parcela** na Configuração de cobrança, acima de "Padrões do
  boleto": `configuracao_cobranca.parcela_minima` (começa em R$ 1.500). Grava
  sozinha, com a permissão **Alterar parcela mínima**
  (`financeiro.parcela.editar`), em `PUT /api/cobranca/configuracao/parcela`.
- Regra: nenhuma parcela abaixo do mínimo, a não ser a **parcela única** ou a
  **1ª com prazo 0** (entrada à vista). Total abaixo do mínimo: uma parcela só.
- **Orçamento e pedido bloqueiam**: a lista de parcelas desabilita as
  quantidades que não cabem, "Iguais" some quando as partes ficariam abaixo, e
  "Diferentes" com parcela abaixo trava o salvar. O backend recusa (422
  `PARCELA_MINIMA`) no salvar/editar do orçamento, ao aprovar (antes de
  converter) e na troca de pagamento do pedido.
- **Só a devolução reajusta**: se o desconto deixa parcela em aberto abaixo do
  mínimo, as abertas são juntadas nas **primeiras**, na ordem (30/60/90 →
  30/60), em partes iguais. A parcela que cresce e tinha boleto ganha baixa e
  reemissão na mesma data (vencido: vence hoje).
- **Abatimento** manual que deixaria o boleto abaixo do mínimo é recusado,
  salvo parcela única ou 1ª à vista.
- Pedidos que já existem ficam como estão; a regra vale nas próximas
  alterações. Código: `backend/cobranca/parcelaMinima.js` e
  `src/js/utils/parcelamento.js`.

## Continuação

O fechamento da produção (confirmação peça a peça) e as comissões por quem
recebe estão em
[fechamento-producao-e-comissoes-por-beneficiario.md](fechamento-producao-e-comissoes-por-beneficiario.md),
com o SQL próprio (`sql/fechamento_producao_e_pagamentos.sql`).

## Permissões novas

| Chave | Rótulo | Coluna |
|---|---|---|
| `prod.designer.create` | Incluir desenhista | `perm_prod.acao_designer_create` |
| `prod.designer.delete` | Excluir desenhista | `perm_prod.acao_designer_delete` |
| `financeiro.parcela.editar` | Alterar parcela mínima | `perm_financeiro.acao_parcela_editar` |
