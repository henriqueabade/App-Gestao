/**
 * Preço de venda da peça — o número que vai para o cliente.
 *
 * A peça carrega dois preços e eles respondem a coisas diferentes:
 *
 *   preco_venda  → CALCULADO. Se move sozinho sempre que um insumo muda de
 *                  custo. Serve para apurar custo, não para vender.
 *   preco_tabela → PRATICADO. Vem de `tabela_fixa` e só muda quando alguém
 *                  marca "Atualizar Tabela Fixa" ao salvar o produto.
 *
 * Orçamento vende pelo PRATICADO. Se vendesse pelo calculado, encarecer um
 * parafuso remarcaria sozinho toda proposta em aberto — e o cliente receberia
 * um número diferente do que foi combinado.
 *
 * Peça sem linha na tabela fixa não tem preço praticado e por isso NÃO PODE
 * ser vendida: devolvemos null, e quem chama recusa o item. Cair para o preço
 * calculado seria pior que barrar — venderia por um número que ninguém
 * aprovou, silenciosamente.
 */
(function (global) {
  'use strict';

  function numeroOuNulo(valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
  }

  /**
   * Preço praticado da peça, ou null quando ela não está na tabela fixa.
   * @param {object} produto produto vindo de `listarProdutos()`
   */
  function precoDeVenda(produto) {
    return numeroOuNulo(produto?.preco_tabela);
  }

  /** A peça pode ser vendida? (tem preço praticado cadastrado) */
  function temPrecoDeVenda(produto) {
    return precoDeVenda(produto) !== null;
  }

  /**
   * Mesma mensagem em todo lugar que recusa a peça, para o usuário reconhecer
   * o problema — e a saída — sem precisar decorar variações do texto.
   */
  function motivoSemPreco(produto) {
    const nome = produto?.nome || produto?.codigo || 'A peça selecionada';
    return `${nome} não tem preço na tabela fixa e não pode ser orçada. `
         + 'Abra o produto, marque "Atualizar Tabela Fixa" e salve.';
  }

  global.PrecoTabela = { precoDeVenda, temPrecoDeVenda, motivoSemPreco };
})(window);
