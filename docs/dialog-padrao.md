# DialogPadrao

A caixa de aviso, erro, sucesso e confirmação do programa inteiro. Abre na
*top layer* (`<dialog>.showModal()`), acima de qualquer modal, e fecha só pelo
botão ou pelo Esc.

- Script: `src/components/dialogPadrao.js`
- Visual: `src/styles/dialogo-padrao.css` (global, carregado pelo `menu.html`)
- Testes: `src/js/__tests__/dialogPadrao.test.js`

## Como a caixa é

- **Topo**: o ícone do tom num círculo, o título e um subtítulo opcional.
- **Corpo**: frase curta centralizada, ou o conteúdo organizado em cartões
  de número (`resumo`), quadros com título (`secoes`), quadro vermelho do que
  não tem volta (`alerta`) e quadro azul de observação (`nota`).
- **Rodapé**: OK (dourado) ou Confirmar + Cancelar.

Caixa com conteúdo estruturado ou texto longo fica mais larga (40rem) sozinha.

## Como importar

Já vem no `src/html/menu.html`:

```html
<link rel="stylesheet" href="../styles/dialogo-padrao.css">
<script src="../components/dialogPadrao.js"></script>
```

## API

`window.DialogPadrao.info(opcoes)` e `.confirm(opcoes)` devolvem uma promessa
(`true` = OK/Confirmar, `false` = Cancelar/Esc). `.open(opcoes)` é a forma com
callbacks (`onConfirm`, `onCancel`) e devolve `{ close }`.

| Opção | O que é |
| --- | --- |
| `title`, `subtitle` | Título e subtítulo |
| `message` | Texto. Organizado sozinho (ver abaixo) |
| `tom` | `info`, `sucesso`, `aviso`, `erro` ou `pergunta` (padrão: pelo `variant`) |
| `icone` | Ícone do Font Awesome no lugar do do tom (ex.: `'fa-building-columns'`) |
| `resumo` | `[{ rotulo, valor, tom?, dica? }]` — cartões de número |
| `secoes` | `[{ titulo, icone?, texto?, lista?, itens? }]`; `itens`: `[{ rotulo, valor?, detalhe?, tag?, dica?, tom? }]` |
| `alerta` | Texto no quadro vermelho (o que não tem volta) |
| `nota` | Texto no quadro azul (observação) |
| `variant` | `info` (padrão), `confirm` ou `erro` |
| `confirmText`, `cancelText`, `okText` | Rótulos dos botões |
| `confirmVariant` | Cor do Confirmar: `danger`, `success`, `primary` (padrão: vinho) |
| `largura` | `normal` ou `larga` (padrão: decide pelo conteúdo) |

### O texto organizado sozinho (`message`)

Para as chamadas que só mandam texto:

- linha em branco separa blocos;
- bloco cuja primeira linha termina em `:` vira quadro com título;
- linhas `Rótulo: valor` viram pares alinhados;
- linhas começando com `•` ou `-` viram lista;
- frase com "não tem volta", "não poderá mais", "para sempre"… vai para o
  quadro de alerta;
- uma frase curta fica centralizada.

`DialogPadrao.estruturarTexto(texto)` é a função pura que faz isso.

## Exemplos

### Aviso simples

```js
window.DialogPadrao.info({ title: 'Função indisponível', tom: 'aviso', icone: 'fa-lock', message: 'Orçamentos aprovados não podem ser editados.' });
```

### Resultado com números e detalhe

```js
await window.DialogPadrao.info({
  title: 'Conciliação com o BB', tom: 'sucesso', icone: 'fa-building-columns',
  resumo: [{ rotulo: 'Boletos consultados', valor: '5' }, { rotulo: 'Pagamentos', valor: '2', tom: 'sucesso' }],
  secoes: [{ titulo: 'Consulta ao BB', icone: 'fa-magnifying-glass', itens: [{ rotulo: 'Pagos', valor: '2', tom: 'sucesso' }] }],
  nota: 'A tela já foi atualizada com o que mudou.'
});
```

### Confirmação destrutiva

```js
const ok = await window.DialogPadrao.confirm({
  title: 'Confirmar cancelamento', tom: 'erro', icone: 'fa-ban',
  secoes: [{ titulo: 'Destino das peças', lista: ['2 unidades retornarão ao estoque.'] }],
  alerta: 'Esta ação reverte peças e insumos e não pode ser desfeita.',
  confirmText: 'Confirmar cancelamento', cancelText: 'Voltar', confirmVariant: 'danger'
});
```

## Regras

- Nada de caixa montada à mão só com título e parágrafo, nem `alert()` do
  sistema: o teste confere.
- Clicar fora não fecha (ver `docs/padroes-de-interface.md`, seção 2).
- O texto vai sempre como texto (`textContent`), nunca como HTML.
