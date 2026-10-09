# Visualizar documento (todo PDF do programa)

Pedido do dono em 09/10/2026. Em todo lugar que gera PDF, o documento abre
num modal padrão, **"Visualizar documento"**, para ver, imprimir ou salvar.
Antes era preciso salvar o arquivo para vê-lo.

## Como funciona

`src/js/utils/visualizador-pdf.js` + `src/styles/visualizador-pdf.css`,
carregados pelo `menu.html`.

```js
window.VisualizadorPdf.abrir({
  titulo: 'Pedido PED115',
  subtitulo: 'Jackie',                 // o nº de folhas entra sozinho
  nomeArquivo: 'pedido-PED115',        // a sugestão do "Salvar PDF"
  tituloSalvar: 'Salvar Pedido em PDF',
  gerar: async () => ({ base64 })      // ou ArrayBuffer / Uint8Array
});
```

Os geradores prontos:

- `VisualizadorPdf.deHtml(html, { retrato })`: um HTML impresso pelo
  Electron. É o mesmo caminho do antigo "Salvar": A4, sem margem, FOLHA x/y.
- `VisualizadorPdf.doDocumento(id, 'pedido' | 'orcamento')`: o PDF do pedido
  ou do orçamento, a página `/pdf` em paisagem. É o `open-pdf` do `main.js`
  com `somenteBytes`, com a mesma conferência da permissão de exportar.

**O espelho é 100%.** O PDF é gerado uma vez, pelo gerador de antes. Mostrar,
"Salvar PDF" (IPC `salvar-pdf`) e "Imprimir" usam os mesmos bytes.

- **Imprimir:** a janela de impressão do Windows, pelo próprio quadro do PDF.
  Se falhar, o processo principal imprime os mesmos bytes (IPC
  `imprimir-pdf`). Nunca imprime em silêncio.
- **Teclas:** Esc sai, também com o foco dentro do PDF; Ctrl+P imprime.
- **Erro ao montar:** aparece no próprio modal, com "Tentar de novo".
- **Camada:** o modal fica à frente de qualquer outro (`app-message-overlay`),
  e o modal de baixo continua aberto.

## Onde já abre (por fase)

| Fase | Lugar | Gerador |
| --- | --- | --- |
| 1 | Pedidos › etiqueta verde DANFE | `NfeDocumentos.verDanfe` (deHtml, retrato) |
| 2 | Pedidos e Orçamentos › ícone de PDF da linha ("Ver PDF") | `doDocumento` (paisagem) |
| 2 | DANFE da nota de fora (lista, Visualizar pedido, NF-e de fora, Financeiro › Notas) | `NfeDocumentos.gerarDanfeExterna` |
| 2 | DANFE do Visualizar pedido e do Financeiro › Notas | `NfeDocumentos.gerarDanfe` → `verDanfe` |
| 2 | Cartas de correção (as daqui e as de fora) | `gerarCartaCorrecaoPdf`, `gerarCartaExternaPdf` |
| 2 | Boletos: um (Detalhes do boleto, Gerar boletos, a tag da parcela) e todos do pedido ("Boletos (PDF)") | `BoletoDocumentos` |
| 2 | Visualizar pedido › Etiquetas (caixas) | deHtml (paisagem, com as páginas nomeadas do CSS) |
| 2 | Relatório de produção / Peças do pedido › Imprimir | deHtml (paisagem) |
| 3 | Financeiro › Relatórios (Gerar em PDF e o PDF do relatório aberto) | deHtml (paisagem); a planilha CSV continua indo para a janela de salvar |
| 3 | Produtos › Visualizar › Gerar PDF (ficha) | jsPDF → `output('arraybuffer')` |
| 3 | Produtos › Movimentações › Imprimir | deHtml (paisagem) |
| 3 | Matéria-prima › Auditoria do insumo › Imprimir | deHtml (paisagem) |

Ficam para as próximas fases:

- **Fase 4:** Relatórios (o PDF da tabela e o Master-Detail com jsPDF, Imprimir
  e Agrupamento).
- **Fase 5:** Contabilidade (relatório mensal, Espelho DDA, comprovantes e
  aplicações).
- **Fase 6:** anexos em PDF (histórico social, arquivos da Contabilidade).

O que **não** muda: a planilha de etiquetas de produto (Excel), os XML e o
DANFE anexado ao e-mail, que é gerado sem mostrar.

## Testes

- `src/js/__tests__/visualizadorPdf.test.js`: o modal, o espelho, o processo
  principal e cada fase.
- Os testes dos módulos (`nfeDocumentos`, `pedidoGerarBoletos`,
  `etiquetasPedido`, `pedidoDadosExternos`) conferem que nada vai mais direto
  para a janela de salvar.
- **Nunca imprimir num teste:** a impressora padrão do computador é real. Na
  conferência no Electron, o `print` do quadro é trocado.
