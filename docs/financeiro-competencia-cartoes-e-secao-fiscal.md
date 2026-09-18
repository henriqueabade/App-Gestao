# Competência, cartões, ajustes e a seção fiscal da peça

Correções pedidas depois dos testes da Fase I (17/09/2026). **Nada aqui muda o
banco** — não há SQL novo. O que muda é a tela: o seletor de competência, o que
os cartões do Financeiro mostram, como os ajustes aparecem, o carregamento dos
modais e a parte fiscal do cadastro de peça.

---

## 1. Seletor de competência: mês, ano e a lupa

Antes era uma lista de 16 meses (12 para trás, 3 para frente). Agora são três
controles, na mesma ordem em toda a casa:

| Controle | O que é |
|---|---|
| **Mês** (esquerda) | os doze meses pelo nome |
| **Ano** | 2025 a 2100, com lista de sugestão — **também dá para digitar** |
| **Lupa** (direita) | é ela que "entra" no mês |

- Escolher mês/ano **não recarrega nada**: a leitura só acontece na lupa (ou no
  Enter dentro do ano). Antes, cada troca de mês disparava três leituras.
- Ano fora da faixa volta para dentro dela (1999 → 2025; 3000 → 2100).
- O valor continua sendo `AAAA-MM`, num `<input type="hidden">` com o id de
  sempre (`#finCompetencia`, `#finNotasCompetencia`, …): quem lia `campo.value`
  e ouvia `change` não precisou mudar.
- Onde há filtro por mês com "Todas" (Notas fiscais), o "Todas" é o mês vazio e
  vale na hora, sem lupa.
- Código: `src/js/utils/competencia.js` (carregado por `menu.html`), usado pelo
  módulo (`src/js/financeiro.js`) e por **todos** os modais do Financeiro que
  têm competência: confirmar pagamento, fechar competência (comissões),
  fechar produção, notas fiscais, aguardando NF-e, produção da competência,
  recebimentos e relatórios.

## 2. Cartões "a pagar": falta / total

Os cartões **Comissões a pagar** e **Produção a pagar** mostravam o valor cheio
mesmo depois de pago. Agora o número grande é **o que falta** e, ao lado, de
quanto era a competência:

| Situação | Cartão |
|---|---|
| nada pago | `R$ 5.400,00 / R$ 5.400,00` |
| pago em parte | `R$ 3.000,00 / R$ 5.400,00` — e o rodapé diz "Paga em parte (R$ 2.400,00)" |
| pago tudo | `R$ 0,00 / R$ 5.400,00` — rodapé "Paga em 14/10/2026" |

O backend passou a mandar `valor` (o que falta), `total` e `pago` em
`painel.comissoes` e `painel.producao` (`backend/financeiro/painel.js`).

## 3. Ajuste manual aparece no resumo

Um ajuste à mão numa parcela **ainda não fechada** só reduzia a base: a comissão
saía menor e o card não dizia por quê ("Ajustes" ficava em R$ 0,00).

Agora a linha **Ajustes** do "Resumo de Comissões" soma as duas coisas:

- o estorno do que já estava fechado (o que ela já mostrava), e
- **a comissão que os ajustes à mão tiraram** das parcelas apuradas no mês.

Ao lado do rótulo vai a nota `(2 manuais · R$ 3.000,00)` — quantos ajustes e
quanto saiu da base. A conta fecha: `apuradas + o que o ajuste tirou` é a
comissão que haveria sem ajuste.

Código: `resumirItens` em `backend/financeiro/comissoes.js` (campo
`ajustes_manuais`), exposto em `resumo_comissoes.ajustes_manuais`.

## 4. Modais: tamanho fixo nas abas e carregamento visível

- **Abas não mudam o tamanho do modal**: Detalhes da parcela, Detalhes do
  pedido e Relatórios passaram de `max-h-[90vh]` para `h-[90vh]` — a maior
  dimensão que já tinham. Regras e as listas grandes já eram assim.
- **Carregamento padrão**: enquanto o servidor responde, a tabela mostra
  **linhas de esqueleto** (o brilho de `.fin-esqueleto`, que existia na folha e
  não era usado) e a caixa fica `aria-busy`. Antes, aplicar um filtro parecia
  travar: a lista antiga continuava na tela, sem sinal nenhum.
- **Filtro trocado duas vezes** não embaralha mais: cada leitura tem um número
  e a resposta atrasada é descartada (era possível a resposta do filtro ANTIGO
  chegar por último e apagar a certa).
- **Lista que ficou vazia** volta a aparecer: o esqueleto reabre a tabela que o
  filtro anterior tinha escondido (era o caso que mais parecia travamento).
- Vale em: recebimentos, notas fiscais, aguardando NF-e, comissões atrasadas,
  produção da competência, relatório visualizado, regras, detalhes da parcela e
  detalhes do pedido. Código: `criarCarregamento` em
  `src/js/modals/financeiro-modais.js`.

## 5. Peça: os dados fiscais numa seção retraída

Os sete campos fiscais ficavam soltos no meio do formulário de **Novo produto**
e **Editar produto**. Agora são uma seção com barra própria:

- **Nasce fechada.** A barra tem título ("Dados fiscais (NF-e)"), um resumo do
  que há dentro ("3 de 8 preenchidos") e a setinha que abre.
- O **NCM** (obrigatório) foi para dentro dela, com rótulo — junto com Origem,
  Unidade, CEST, GTIN/EAN, os dois CFOP e o CSOSN.
- **Ao salvar com o NCM vazio a seção abre sozinha**, a barra fica vermelha e o
  campo recebe o foco. Isso não é só conforto: o navegador **não consegue
  focar** um campo obrigatório escondido, e sem isso o formulário simplesmente
  não enviava, sem dizer por quê.
- Fechada, a barra já avisa "falta preencher 1 campo".
- Código: `src/js/utils/secao-retratil.js` e `src/styles/secao-retratil.css`
  (ambos carregados por `menu.html`); os modais chamam
  `SecaoRetratil.ligar(overlay)`.

---

## Depois de puxar o código

Nada de SQL. Basta abrir o sistema: o módulo Financeiro já vem com o seletor
novo, e o cadastro de peça com a seção fiscal fechada.
