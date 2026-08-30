/**
 * Agrupamento de pedidos para relatório.
 *
 * Junta vários pedidos num documento só e responde a pergunta que a produção
 * faz: "no total, quantas peças de cada modelo eu preciso — e quantas dessas
 * já estão prontas?". Sem isso, quem produz precisa somar à mão as peças
 * repetidas espalhadas por cinco ou seis pedidos.
 *
 * DUAS VISÕES DO MESMO CONJUNTO, e elas não se confundem:
 *
 *   pecas    → consolidado. Uma linha por modelo de peça, com as quantidades
 *              somadas de todos os pedidos. É o que a produção usa.
 *   pedidos  → detalhamento. Uma seção por pedido, com o cliente no cabeçalho.
 *              É o que a expedição usa para separar o que é de quem.
 *
 * O agrupamento é por `produto_id`. Código e nome são apenas rótulos: dois
 * pedidos podem ter gravado o nome com grafias diferentes, e agrupar por texto
 * partiria a mesma peça em duas linhas.
 */

/** Soma tolerante a null/string — os números chegam do banco como texto. */
function num(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function texto(valor) {
  return valor == null ? '' : String(valor).trim();
}

/**
 * Chave de agrupamento da peça.
 *
 * `produto_id` é a identidade real. O código entra só como último recurso,
 * para itens antigos gravados antes de o vínculo com produtos existir — sem
 * ele, esses itens cairiam todos num mesmo balde vazio.
 */
function chaveDaPeca(item) {
  const id = item?.produto_id;
  if (id !== undefined && id !== null && String(id).trim() !== '') {
    return `id:${id}`;
  }
  const codigo = texto(item?.codigo);
  return codigo ? `cod:${codigo.toUpperCase()}` : null;
}

/**
 * Consolida as peças de vários pedidos numa linha por modelo.
 *
 * `pronta` e `a_fazer` vêm da decisão de estoque tomada na conversão do
 * orçamento (`qtd_usar_pronta` / `qtd_a_produzir`), que é NOT NULL desde lá.
 * Quando as duas vêm zeradas — item anterior a essa decisão —, tratamos tudo
 * como "a fazer": prometer peça pronta que ninguém confirmou é o erro caro.
 */
function agruparPecas(pedidos = []) {
  const mapa = new Map();

  for (const pedido of Array.isArray(pedidos) ? pedidos : []) {
    for (const item of Array.isArray(pedido?.itens) ? pedido.itens : []) {
      const chave = chaveDaPeca(item);
      if (!chave) continue;

      const quantidade = num(item?.quantidade);
      const pronta = num(item?.qtd_usar_pronta);
      const aProduzir = num(item?.qtd_a_produzir);
      // Item sem decisão de estoque gravada: assume produção integral.
      const semDecisao = pronta === 0 && aProduzir === 0 && quantidade > 0;

      const atual = mapa.get(chave) || {
        produto_id: item?.produto_id ?? null,
        codigo: texto(item?.codigo),
        nome: texto(item?.nome),
        quantidade: 0,
        pronta: 0,
        a_fazer: 0,
        valor_total: 0,
        pedidos: new Set()
      };

      // O rótulo mais completo vence: um pedido antigo pode ter gravado o item
      // sem código, e a linha consolidada não deveria herdar essa lacuna.
      if (!atual.codigo && texto(item?.codigo)) atual.codigo = texto(item.codigo);
      if (!atual.nome && texto(item?.nome)) atual.nome = texto(item.nome);

      atual.quantidade += quantidade;
      atual.pronta += pronta;
      atual.a_fazer += semDecisao ? quantidade : aProduzir;
      atual.valor_total += num(item?.valor_total);
      if (pedido?.id != null) atual.pedidos.add(String(pedido.id));

      mapa.set(chave, atual);
    }
  }

  return [...mapa.values()]
    .map(linha => ({
      produto_id: linha.produto_id,
      codigo: linha.codigo,
      nome: linha.nome,
      quantidade: linha.quantidade,
      pronta: linha.pronta,
      a_fazer: linha.a_fazer,
      // Média do que foi efetivamente cobrado por unidade. Não dá para usar
      // `valor_unitario` de um dos itens: a mesma peça sai com descontos
      // diferentes em pedidos diferentes, e o total da linha não fecharia com
      // unitário × quantidade.
      valor_unitario: linha.quantidade > 0 ? linha.valor_total / linha.quantidade : 0,
      valor_total: linha.valor_total,
      em_pedidos: linha.pedidos.size
    }))
    .sort((a, b) =>
      a.codigo.localeCompare(b.codigo, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR')
    );
}

/**
 * Detalhamento por pedido: o que a expedição usa para separar o que é de quem.
 * Mantém as peças na ordem em que estão no pedido, sem consolidar.
 */
function detalharPedidos(pedidos = []) {
  return (Array.isArray(pedidos) ? pedidos : []).map(pedido => {
    const itens = (Array.isArray(pedido?.itens) ? pedido.itens : []).map(item => ({
      produto_id: item?.produto_id ?? null,
      codigo: texto(item?.codigo),
      nome: texto(item?.nome),
      quantidade: num(item?.quantidade),
      pronta: num(item?.qtd_usar_pronta),
      a_fazer: num(item?.qtd_a_produzir),
      valor_unitario: num(item?.valor_unitario_desc) || num(item?.valor_unitario),
      valor_total: num(item?.valor_total)
    }));

    return {
      id: pedido?.id ?? null,
      numero: texto(pedido?.numero),
      // O cliente é o CABEÇALHO da seção: é por ele que quem separa encontra
      // o pedido na bancada, não pelo número.
      cliente: texto(pedido?.cliente_nome) || texto(pedido?.cliente),
      situacao: texto(pedido?.situacao),
      data_emissao: pedido?.data_emissao ?? null,
      valor_final: num(pedido?.valor_final),
      itens
    };
  });
}

/** Totais do consolidado, para o rodapé do documento. */
function totaisDoAgrupamento(pecas = []) {
  return (Array.isArray(pecas) ? pecas : []).reduce(
    (acc, p) => ({
      linhas: acc.linhas + 1,
      quantidade: acc.quantidade + num(p.quantidade),
      pronta: acc.pronta + num(p.pronta),
      a_fazer: acc.a_fazer + num(p.a_fazer),
      valor_total: acc.valor_total + num(p.valor_total)
    }),
    { linhas: 0, quantidade: 0, pronta: 0, a_fazer: 0, valor_total: 0 }
  );
}

/** Monta o documento completo a partir dos pedidos já carregados com itens. */
function montarAgrupamento(pedidos = []) {
  const pecas = agruparPecas(pedidos);
  return {
    pecas,
    pedidos: detalharPedidos(pedidos),
    totais: totaisDoAgrupamento(pecas)
  };
}

module.exports = {
  chaveDaPeca,
  agruparPecas,
  detalharPedidos,
  totaisDoAgrupamento,
  montarAgrupamento
};
