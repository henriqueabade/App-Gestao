# Etiquetas das caixas e "FOLHA 1/x" do DANFE

Entrega de 24/09/2026, pelos três modelos em PDF que o dono mandou.

## O botão

**Pedidos › Visualizar › "Etiquetas"** — botão **bordô** no rodapé do pedido
que saiu (Enviado ou Entregue). Gera **um PDF só** e abre o "Salvar como".

## As duas etiquetas (uma de cada por volume)

### 1. Etiqueta de transporte — A4 paisagem

| Campo | De onde vem |
|---|---|
| Marca + empresa | `src/assets/Marca.png` (a logo do modelo) + "SANTÍSSIMO DECOR LTDA. · (31) 3357-4894 · www.santissimodecor.com.br" |
| Cliente | **razão social em negrito acima da linha**; o nome fantasia abaixo |
| NFe nº | a NF-e autorizada daqui; senão a nota de fora; sem nota, em branco |
| Volume nº | `363_01/02` (nota_volume/total, dois dígitos); sem nota, o número do pedido (`PED104_01/02`) |
| Peso aprox. (kg) | **sempre o peso bruto** do volume, com três casas (`11,000`) |
| Dimensão (mm) | as três medidas informadas no envio (`440 x 665 x 270`); sem elas, em branco |
| Transportadora | a do pedido ("Não definida" não conta); senão a do XML da nota |

Mais as faixas **FRÁGIL**, **ATENÇÃO** e a seta **"mantenha esse lado para
cima"**. **Duas por folha**; com número ímpar de caixas, a última fica
**sozinha, centralizada** na folha.

### 2. Etiqueta "ATENÇÃO — MANTENHA ESSE LADO PARA CIMA" — A4 retrato

Marca, "SANTÍSSIMO DECOR LTDA.", **ATENÇÃO** grande e a frase. **Duas por
folha**; a que sobra fica na metade de cima.

As duas orientações saem no mesmo PDF pelas páginas nomeadas do CSS
(`@page paisagem` / `@page retrato`), que o Chromium do Electron 28 respeita
(conferido: o PDF sai com as folhas em paisagem e em retrato).

## Os volumes: dimensões na emissão

No modal **"Emitir NF-e e enviar"** a tabela de volumes aparece **desde 1
volume** (antes, só com 2 ou mais) e ganhou a coluna **"Dimensões (mm) C × L ×
A"**: comprimento, largura e altura da caixa, em milímetros. São opcionais —
sem elas, a etiqueta sai com o campo em branco —, mas se vierem precisam ser
maiores que zero.

A **espécie vem sempre "Caixa"** (o padrão da empresa); o usuário apaga e
escreve outra se quiser.

As caixas ficam no pedido em `pedidos.volumes_detalhe` (texto JSON): pela
emissão da NF-e e — novidade — também pelo **"Enviar sem NF-e"**, que antes
não gravava transporte nenhum (`PUT /api/fiscal/pedidos/:id/transporte`).

De onde a etiqueta tira os volumes, nesta ordem:

1. `pedidos.volumes_detalhe` (o que foi informado no envio, com as dimensões);
2. o XML da NF-e (o peso bruto de cada `<vol>`) — pedidos enviados antes desta
   entrega;
3. o resumo do pedido (quantidade; o peso só quando é uma caixa).

Pedido sem volume nenhum responde 409 com a explicação.

## SQL

`sql/pedido_volumes_etiquetas.sql` — rode e **reinicie a API**:

```sql
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS volumes_detalhe text;
```

Sem ele, a API ignora a coluna em silêncio: as etiquetas saem, mas sem as
dimensões (os pesos vêm do XML da nota).

## "FOLHA 1/x" do DANFE (corrigido)

O campo era fixo em "FOLHA 1/1", mesmo com o DANFE de 2 ou 3 folhas. O total
só se sabe depois de imprimir (a janela do PDF roda sem JavaScript, e o
Chromium 120 não tem `counter(pages)` nas margens da página). Agora o HTML leva
a marca `{{TOTAL_DE_FOLHAS}}` e o `main.js` imprime duas vezes: a primeira
conta as páginas do PDF, a segunda sai com o número. Vale para o DANFE salvo,
o DANFE da nota de fora e o anexado ao e-mail. Conferido: 110 itens → 3 folhas
→ "FOLHA 1/3".

## Código e testes

| Onde | O quê |
|---|---|
| `backend/fiscal/etiquetas.js` | contas puras e o HTML das etiquetas; `etiquetasDoPedido` |
| `backend/fiscal/folhas.js` | a marca do total e a contagem de páginas do PDF |
| `backend/fiscal/emissao.js` | `volumesDetalhados` → `pedidos.volumes_detalhe` |
| `backend/fiscalController.js` | `GET /pedidos/:id/etiquetas` (`ped.view`), `PUT /pedidos/:id/transporte` (`ped.status.ship`) |
| `main.js` | `imprimirHtmlEmPdf` (duas impressões quando o HTML pede o total) |
| `src/js/modals/pedido-emitir-nfe.js` + `emitir-nfe.html` | dimensões, "Caixa", envio sem nota gravando as caixas |
| `src/js/modals/pedido-visualizar.js` + `visualizar.html` + `.btn-etiquetas` (menu.css) | o botão |

Testes: `etiquetas.test.js`, `folhas.test.js`, `emissao.test.js`,
`fiscalController.test.js` e, na tela, `pedidoEmitirNfe.test.js` e
`etiquetasPedido.test.js`.
