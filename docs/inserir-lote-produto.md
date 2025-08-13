# inserirLoteProduto

## Resumo
O canal IPC `inserir-lote-produto` permite registrar um novo lote de um produto. O handler correspondente é definido em `main.js` com `ipcMain.handle('inserir-lote-produto', ...)` e exposto ao renderer pelo `preload.js` através de `window.electronAPI.inserirLoteProduto`.

Esta função grava um registro na tabela `produtos_em_cada_ponto` contendo o produto, a etapa e o último insumo utilizados, além da quantidade e da data/hora atual. O `package.json` aponta `main.js` como entrypoint, garantindo que o handler seja carregado antes das chamadas.

## Parâmetros
- `produtoId` – identificador do produto.
- `etapaId` – nome da etapa do processo onde o lote foi adicionado.
- `ultimoInsumoId` – último insumo utilizado na produção.
- `quantidade` – quantidade produzida neste lote.

## Exemplo de uso
```js
await window.electronAPI.inserirLoteProduto({
  produtoId: 7,
  etapaId: 'Corte',
  ultimoInsumoId: 12,
  quantidade: 50
});
```
