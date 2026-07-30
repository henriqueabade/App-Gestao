# Padrões de interface: números, diálogos e botões

Três utilitários globais, carregados em `src/html/menu.html` (e os aplicáveis em
`src/login/login.html`), resolvem de uma vez regras que antes eram repetidas — ou
esquecidas — em cada módulo. Todos funcionam por conta própria: **não é preciso
chamar nada em um módulo novo**, basta seguir o padrão de marcação.

| Utilitário | Arquivo | O que resolve |
| --- | --- | --- |
| `NumericInput`  | `src/utils/numericInput.js`  | Todo campo numérico aceita até 4 casas decimais e sempre guarda `.` |
| `DialogTopLayer`| `src/utils/dialogTopLayer.js` | Toda caixa de diálogo fica à frente de qualquer outro elemento |
| `BotaoAcao`     | `src/utils/botaoAcao.js`      | Nenhum botão aceita duplo clique; fica carregando até a ação terminar |

---

## 1. Campos numéricos (`NumericInput`)

**Regra:** todo preenchimento numérico aceita até **4 casas decimais**. Na
digitação, tanto `,` quanto `.` valem como separador decimal, e o campo guarda
sempre **um único `.`**. Vale para quantidades, preços e porcentagens.

### Como marcar o campo

```html
<!-- Já é reconhecido automaticamente -->
<input name="quantidade" type="number" min="0">

<!-- Campo de texto que deve se comportar como numérico -->
<input name="fator" type="text" data-numeric="true">
```

O utilitário troca `type="number"` por `type="text" inputmode="decimal"`. Isso é
proposital: no Chromium um `input[type=number]` **descarta o próprio conteúdo**
quando o usuário digita `,` (o `value` volta vazio), então era impossível
"converter a vírgula em ponto" — o caractere nunca chegava ao JavaScript. Com
texto controlado a conversão acontece a cada tecla, e `parseFloat` continua
funcionando porque o campo só contém dígitos e ponto.

Como `min`/`max` deixam de ser validados pelo navegador, eles são guardados em
`data-numeric-min` / `data-numeric-max` e reaplicados no `blur`.

### Ajustes por campo

| Atributo | Efeito |
| --- | --- |
| `data-numeric="true"`      | Trata um `input[type=text]` como numérico |
| `data-numeric="false"`     | Deixa o campo de fora |
| `data-numeric-decimals="2"`| Muda o limite de casas decimais |
| `data-numeric-negative="true"` | Permite valor negativo |

Campos que parecem numéricos mas não são decimais (hoje só `#ncmInput`) estão na
lista `IGNORED_IDS` do próprio utilitário.

### API

```js
window.NumericInput.sanitize('1,2345');  // '1.2345'
window.NumericInput.parse('1,5');        // 1.5   (NaN se vazio/inválido)
window.NumericInput.format(0.0025);      // '0.0025'  (até 4 casas, sem zeros à direita)
```

Use `NumericInput.format` para exibir quantidades — foi o que substituiu os
`toFixed(2)` que apagavam valores pequenos (`0,0025` virava `0,00`).

### No back-end

`backend/numeros.js` faz a última conversão antes de gravar. O front já manda
com ponto, mas se qualquer outro caminho (importação, API externa, versão antiga
do app) mandar `"1,5"` ou `"1.234,56"`, `paraDecimal` normaliza:

```js
const { paraDecimal, normalizarCamposNumericos } = require('./numeros');
normalizarCamposNumericos(dados, ['quantidade', 'preco_unitario']);
```

Já aplicado em `backend/materiaPrima.js` (quantidade, preço, entradas/saídas) e
`backend/produtos.js` (percentuais, preços, quantidades de itens e lotes).

---

## 2. Caixas de diálogo (`DialogTopLayer`)

**Regra:** uma caixa de diálogo — de aviso, de escolha ou com campo para digitar
— fica **sempre à frente** de qualquer outro elemento.

### Como marcar

Basta a classe semântica `app-message-overlay` (ou `warning-overlay`, que já a
implica pelo CSS de `src/styles/warning.css`):

```js
const overlay = document.createElement('div');
overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
overlay.innerHTML = '...';
document.body.appendChild(overlay);   // promovido automaticamente
```

### Por que não bastava z-index

Os diálogos conviviam em dois mundos: `DialogPadrao` usa
`<dialog>.showModal()`, que entra na **top layer** do navegador; os diálogos
montados à mão eram `<div>` com `z-index: var(--z-dialog)`. Um z-index, por alto
que seja, **nunca** passa por cima da top layer — então qualquer diálogo montado
à mão que abrisse junto de um `DialogPadrao` ficava escondido atrás dele e sem
receber clique, porque `showModal()` deixa o resto do documento inerte.

Agora existe um mecanismo só: cada overlay marcado é embrulhado num `<dialog>`
hospedeiro invisível e promovido para a top layer. A regra fica simples — **o
último diálogo aberto fica na frente** — e nenhum modal, menu ou toast consegue
cobri-lo. O elemento continua sendo o mesmo nó, então `querySelector`,
`getElementById` e `remove()` do código que criou o diálogo seguem valendo;
quando ele sai do DOM, o hospedeiro se fecha e se remove sozinho.

`data-sem-top-layer="true"` deixa um overlay de fora (útil para spinners, que não
levam a classe de diálogo justamente por isso).

---

## 3. Botões (`BotaoAcao`)

**Regra:** nenhum botão pode ser acionado duas vezes enquanto a ação anterior não
terminar, e o botão acionado fica carregando até a função dele concluir.

### Rede automática

Não é preciso fazer nada por módulo. Dois listeners em fase de **captura** em
`document` (`click` e `submit`) cobrem:

- `<button>`, `[role="button"]`, `input[type=submit|button]`, `[data-acao="true"]`;
- os ícones que fazem papel de botão nas tabelas — o padrão do projeto
  `<i class="fas fa-* cursor-pointer">` (editar, excluir, visualizar);
- `submit` de formulário, inclusive por **Enter**, que não passa por clique nenhum.

Para saber quando liberar, as promessas de `window.electronAPI` e de `fetch`
criadas durante o acionamento são rastreadas: enquanto houver chamada pendente o
botão continua carregando. Ação instantânea (abrir menu, marcar filtro) só fica
bloqueada pela janela mínima de 350 ms e **não** mostra spinner — o spinner
aparece apenas quando a ação de fato vai ao back-end.

O atributo `disabled` de propósito **não** é usado: o bloqueio vem do listener em
captura (Enter e Espaço também disparam `click`), e mexer em `disabled`
atropelaria os módulos que gerenciam esse atributo por conta própria durante a
ação. Elementos negados por permissão (`data-perm-aplicado="negado"`) são
ignorados, porque já têm o bloqueio do `permissoes.js`.

### Ajustes por botão

| Atributo | Efeito |
| --- | --- |
| `data-sem-loading="true"` | Mantém a trava de duplo clique, mas nunca aplica o spinner. Use quando o botão tem indicador próprio dentro dele (ex.: barra de progresso da publicação) |
| `data-sem-guarda="true"`  | Desliga a trava e o visual |

### API explícita

Para quando o módulo sabe exatamente o que esperar (I/O que não passa por
`electronAPI` nem `fetch`, ou espera longa):

```js
window.BotaoAcao.bind(botao, async () => { await algo(); });
window.BotaoAcao.bindSubmit(form, async () => { await salvar(); });
await window.BotaoAcao.run(botao, () => tarefa());
```

`bind`/`bindSubmit` marcam o elemento com `data-acao-gerida="true"`, e a rede
automática passa a não mexer nele.
