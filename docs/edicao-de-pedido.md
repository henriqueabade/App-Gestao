# Editar as peças de um pedido em Produção

Pedido do dono em 14/10/2026. O exemplo foi o PED121, que nasceu com duas
linhas iguais de "Caixa Rio" vindas da IA.

## Quem e quando

- **Quem:** só o dono, pelos dois e-mails dele
  (`henrique.abade@santissimodecor.com.br` e `henrique.vabade@gmail.com`).
  A trava está no servidor (`backend/pedidoEdicao.js`, `EDITORES`). A tela só
  mostra o botão quando o servidor diz que é o dono.
- **Quando:** só com o pedido **em Produção**, e só se ele:
  - não tem NF-e viva (autorizada, processando ou em cancelamento), nem NF-e de fora;
  - não tem parcela travada: boleto do BB registrado ou pago, boleto de fora,
    pagamento registrado ou ordem de pagamento. Boleto registrado ainda não
    pago também trava; cancela-se a cobrança antes.
- **Onde:** Pedidos › Visualizar › **Editar peças** (botão bordô, no rodapé).

## O que dá para fazer

- Mudar a quantidade de uma linha (0 tira todas).
- **Juntar** linhas da mesma peça. As unidades da linha de baixo passam para a de
  cima como estão, sem mexer no estoque nem na matéria-prima. A linha de baixo
  fica com quantidade zero.
- Pôr peça nova. Se o pedido já tem a peça, a linha dela aumenta (uma linha por
  peça).
- O motivo é obrigatório (ao menos 10 letras).

**Revisar** mostra, antes de gravar:
- o que sai e para onde vai;
- de onde saem as peças novas;
- o que volta e o que sai da matéria-prima;
- o total e as parcelas, de antes e de depois.

**Salvar edição** pede confirmação e grava. Se o pedido mudou entre a revisão e
a confirmação (um registro de produção, um valor), nada é gravado e a tela relê.

## As unidades que saem (decisões do dono)

1. **Ordem de retirada:**
   - primeiro as produzidas do zero, as menos adiantadas antes;
   - depois as que vieram pela metade do estoque;
   - as prontas do estoque por último.
2. **A peça:** cada unidade volta ao estoque **no ponto em que está**, nunca
   antes do ponto em que entrou no pedido. A do zero que nem começou não vira
   peça.
3. **A matéria-prima:** volta o material da rota **depois** desse ponto (e
   depois de onde ela entrou). É a mesma regra do cancelamento
   (`cancelamentoEstorno.js`).
4. **Insumo infinito** não volta, porque a conversão não o abate.
5. **O trabalho já registrado na produção continua pago.**

## As unidades que entram

Usam o **mesmo modal da conversão do orçamento**, em modo edição, só com as
peças novas. A escolha é a mesma: pronta do estoque, pela metade ou do zero. O
título passa a ser "De onde saem as peças novas", sem "Substituir" e sem as
datas do pedido.

A gravação é a mesma da conversão (`conversaoAplicar.aplicarConversaoNoEstoque`):
- baixa do lote;
- reserva de produção;
- matéria-prima abatida (pode ficar negativa com justificativa);
- o que faltava.

## Os valores

- **Linha alterada ou nova:** preço da **tabela fixa**. O desconto de
  pagamento segue a regra de sempre (5% por mais de uma peça, 5% à vista), e o
  desconto especial da linha é mantido. A prévia avisa quando o preço da
  tabela mudou desde o pedido.
- **Linha que não mudou:** fica como está.
- **Ajuste do pagamento:** o Adicional ou Desconto (`ajuste_valor`) é mantido.
- **Parcelas:** a mesma quantidade e os mesmos vencimentos. O total novo é
  dividido em partes iguais, com o centavo que sobra nas primeiras, como no
  orçamento. A parcela mínima da Configuração de cobrança também vale aqui.
- **Comissões:** CMS, Royalty e desenhista saem das parcelas e das linhas, então
  se refazem sozinhos.

## A produção

A quantidade da linha muda, mas o valor do que já foi registrado não pode
mudar. A edição é, para a produção, uma **mudança de unidades**, igual às
trocas de peças (`financeiro/mudancasUnidades.js`):

- a fila base de cada processo da linha passa a ser a de **antes da primeira
  edição** (`fila_antes`);
- cada edição diz o que faltava em cada unidade que saiu ou entrou.

Assim, um registro de "Marcenaria: 3 peças" feito antes continua valendo as 3,
e daí para frente a linha deve só o que as unidades atuais pedem.

**Linha com troca entre pedidos ou peça avulsa não é editada** (as outras sim):
as duas mudanças juntas não têm volta segura.

## A linha zerada

A linha que ficou com zero (tirada ou juntada) continua no banco pela história:
produção, estoque e registros apontam para ela. Ela **não aparece e não conta**
em nenhum destes lugares:
- NF-e;
- Visualizar;
- etiquetas;
- relatório agrupado e peças selecionadas;
- devolução;
- filtro "que peça está em que documento";
- divisão do desenhista;
- cancelamento;
- troca de peças.

## O registro (auditoria)

| Onde | O quê |
| --- | --- |
| `pedido_edicoes` (`sql/pedido_edicoes.sql`) | Uma linha por edição, que **nunca muda nem se apaga**: motivo, antes, depois, as unidades para a produção, o que voltou e o que saiu, valores. No fim, só o resultado (avisos) é preenchido, uma vez. |
| Histórico do pedido | Evento "edição" com cada linha e cada unidade que voltou. |
| `estoque_movimentos` | Retorno da peça ao estoque, com a nota "Edição do PEDx". Consumo das peças novas. |
| Histórico de cada insumo | Entrada ou saída de matéria-prima, com a nota da edição. |
| Financeiro | Evento `edicao_pedido` com o total de antes e de depois. |

## Linhas repetidas (a origem do PED121)

- **IA:** a mesma peça duas vezes no documento vira uma linha só, com as
  quantidades somadas (`iaPreenchimento.somarLinhasIguais`, nas duas rotas).
- **Conversão:**
  - a decisão de estoque, que é por peça, é **repartida** entre as linhas da
    mesma peça (`orcamentosController.repartirDecisao`). Antes ela valia
    inteira em cada linha e o estoque podia sair em dobro;
  - os lotes pela metade são descontados entre as linhas
    (`conversaoAplicar`), para duas linhas não disputarem as mesmas unidades;
  - o modal da conversão mostra uma linha por peça.

## Segurança: o mapa da API

As rotas da edição usam a guarda `exigirDonoSupAdmin`. O nome conta para o mapa
de permissões da API (`scripts/mapa-permissoes-api.js`): são rotas de nível Sup
Admin, e nenhuma tabela vira "de todos".

A tabela nova entrou no mapa:
- leitura: quem já lida com produção e pedidos, porque o motor da produção a lê;
- gravação: Sup Admin.

O arquivo gerado fica na API (`acesso/politica-tabelas.json`) e precisa ser
publicado com ela.

## Para ligar

1. Rodar `sql/pedido_edicoes.sql` e reiniciar a API.
2. Publicar a API com o `acesso/politica-tabelas.json` novo.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `backend/pedidoEdicao.js` | Travas, unidades, plano, prévia, gravação e rotas (`/api/pedido-edicao`). |
| `backend/financeiro/mudancasUnidades.js`, `financeiro/producao.js` | A produção lendo as edições. |
| `backend/conversaoAplicar.js` | `evento: false` para a edição; lotes descontados entre linhas. |
| `backend/orcamentosController.js` | `repartirDecisao`. |
| `backend/iaPreenchimento.js`, `backend/iaAplicacao.js` | Soma das linhas iguais. |
| Filtros da linha zerada | `fiscal/emissao.js`, `pedidosController.js`, `devolucoes/base.js`, `vinculosDasPecas.js`, `financeiro/base.js`, `cancelamentoEstorno.js`, `trocasPecas.js` |
| `src/html/modals/pedidos/editar-pecas.html`, `src/js/modals/pedido-editar-pecas.js`, `src/styles/editar-pecas.css` | O modal. |
| `src/js/modals/orcamento-converter.js` | Modo edição e uma linha por peça. |
| `src/js/modals/pedido-visualizar.js`, `visualizar.html` | O botão. |

## Testes

| Teste | O que trava |
| --- | --- |
| `backend/pedidoEdicao.test.js` | O caso do PED121, tirar a peça com Marcenaria feita, peça nova, assinatura, SQL pendente, travas. |
| `backend/linhasRepetidas.test.js` | A soma na IA e a decisão repartida. |
| `backend/conversaoAplicar.test.js` | Duas linhas da mesma peça e os lotes pela metade. |
| `src/js/__tests__/pedidoEditarPecas.test.js` | As contas da tela, a anatomia, o botão e o modo edição da conversão. |
