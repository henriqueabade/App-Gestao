# DialogPadrao

O componente `DialogPadrao` reutiliza o visual padrão de aviso/confirmação (`warning-overlay`, `warning-modal`, botões e ícones) já usado no menu. Para usar em qualquer tela, inclua o script e chame `window.DialogPadrao.open`.

## Como importar

Inclua o script na página (ex.: `src/html/menu.html`):

```html
<script src="../components/dialogPadrao.js"></script>
```

## API

`window.DialogPadrao.open(options)` aceita:

- `title`: título do diálogo.
- `message`: mensagem principal.
- `variant`: `info` (padrão), `confirm` ou `erro`.
- `onConfirm`: callback ao confirmar.
- `onCancel`: callback ao cancelar/fechar (apenas `confirm` usa Cancelar).
- `confirmText`: texto do botão Confirmar (apenas `confirm`, padrão: `Confirmar`).
- `cancelText`: texto do botão Cancelar (apenas `confirm`, padrão: `Cancelar`).
- `okText`: texto do botão OK (apenas `info` e `erro`, padrão: `OK`).

## Exemplos

### Informação (apenas OK)

```js
window.DialogPadrao.open({
  title: 'Atualização',
  message: 'Processo concluído com sucesso.',
  variant: 'info',
  onConfirm: () => {
    console.log('OK clicado');
  }
});
```

### Confirmação (Cancelar/Confirmar)

```js
window.DialogPadrao.open({
  title: 'Confirmação',
  message: 'Deseja realmente excluir este registro?',
  variant: 'confirm',
  onConfirm: () => {
    console.log('Confirmado');
  },
  onCancel: () => {
    console.log('Cancelado');
  }
});
```
