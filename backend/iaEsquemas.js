// O que a IA deve extrair para cada destino, e como a tela de revisão desenha.
//
// Um esquema por destino, em UM lugar só. Ele responde três perguntas de uma
// vez, que sem isso viveriam separadas e sairiam de sincronia:
//
//   1. o que pedir ao modelo (campos e instruções);
//   2. como validar o que ele devolveu (tipo e obrigatoriedade);
//   3. quais colunas a grade de revisão mostra (rótulo e largura).
//
// A grade de revisão é montada a partir daqui, não de HTML escrito à mão. É o
// que permite acrescentar um destino novo sem tocar no front — e o que evita a
// situação clássica de o modelo extrair um campo que a tela não mostra, ou a
// tela pedir um campo que ninguém extraiu.
//
// ---------------------------------------------------------------------------
// TIPOS
//
//   texto    string, cortada no comprimento máximo
//   numero   aceita "1.234,56" e "1,234.56" (ver backend/numeros.js)
//   dinheiro igual a numero; a grade formata com 2 casas
//   data     ISO (aaaa-mm-dd)
//
// Nenhum tipo é confiado ao modelo: tudo passa por coerção em
// backend/iaEstruturacao.js antes de virar item.

const ESQUEMAS = {
  materia_prima: {
    id: 'materia_prima',
    rotulo: 'Matéria-prima (estoque)',
    tabelaAlvo: 'materia_prima',

    /**
     * Campo usado para reconhecer que o item JÁ EXISTE no sistema.
     * Casar por nome é o que a tela de Matéria-prima também faz ao recusar
     * insumo duplicado — usar outro critério aqui criaria dois conceitos de
     * "mesmo insumo" no mesmo programa.
     */
    chaveDeCasamento: 'nome',

    /** Como o item aparece resumido quando não cabe a linha inteira. */
    resumo: item => item.nome,

    instrucoes: [
      'O documento é uma lista de insumos (matéria-prima): chapas, fitas, ferragens, colas, etc.',
      'Extraia UMA entrada por item da lista.',
      '',
      'Atenção:',
      '- Descrição do item vai em "nome", inteira, do jeito que está escrita.',
      '- "quantidade" é quantas unidades entraram, não o saldo em estoque.',
      '- "preco_unitario" é o preço de UMA unidade. Se só houver o total, divida pela quantidade.',
      '- Ignore linhas de subtotal, total geral, frete, imposto e observação.',
      '- Ignore a linha de cabeçalho da tabela.',
      '- Não invente valor que não está no documento: deixe o campo vazio.'
    ].join('\n'),

    campos: [
      {
        chave: 'nome',
        rotulo: 'Insumo',
        tipo: 'texto',
        obrigatorio: true,
        max: 200,
        largura: 'grande',
        descricao: 'Descrição do insumo, como está escrita no documento'
      },
      {
        chave: 'quantidade',
        rotulo: 'Qtde',
        tipo: 'numero',
        obrigatorio: true,
        largura: 'pequena',
        descricao: 'Quantidade que está entrando'
      },
      {
        chave: 'unidade',
        rotulo: 'Un.',
        tipo: 'texto',
        max: 20,
        largura: 'pequena',
        descricao: 'Unidade de medida: CH, M, M2, UN, KG, L'
      },
      {
        chave: 'preco_unitario',
        rotulo: 'Preço un.',
        tipo: 'dinheiro',
        largura: 'pequena',
        descricao: 'Preço de uma unidade'
      },
      {
        chave: 'categoria',
        rotulo: 'Categoria',
        tipo: 'texto',
        max: 60,
        largura: 'media',
        descricao: 'Tipo do insumo: Chapas, Ferragens, Acabamento, Consumível…'
      },
      {
        chave: 'descricao',
        rotulo: 'Observação',
        tipo: 'texto',
        max: 300,
        largura: 'media',
        descricao: 'Cor, medida, código do fornecedor — o que sobrar de detalhe'
      }
    ],

    /**
     * O que "atualizar" faz neste destino, em palavras.
     *
     * A tela mostra este texto no seletor de ação. Sem ele, "atualizar" é
     * ambíguo justamente onde não pode ser: uma lista de compra diz "40
     * chapas", e não dá para saber sozinho se são 40 que ENTRARAM ou 40 que
     * existem. Aqui a regra fica escrita: entra, soma.
     */
    explicacaoAtualizar: 'Dá entrada da quantidade no insumo que já existe (soma ao saldo) e atualiza preço, unidade e categoria.',
    explicacaoCriar: 'Cadastra o insumo e já lança a quantidade como saldo inicial.'
  }
};

/** Destinos que já sabem estruturar e aplicar. Os demais chegam nas próximas etapas. */
const DESTINOS_PRONTOS = Object.keys(ESQUEMAS);

const obterEsquema = destino => ESQUEMAS[destino] || null;

/**
 * Descrição dos campos para o front desenhar a grade de revisão.
 * `descricao` fica de fora: ela é instrução para o modelo, não rótulo de tela.
 */
function camposParaTela(destino) {
  const esquema = obterEsquema(destino);
  if (!esquema) return [];
  return esquema.campos.map(c => ({
    chave: c.chave,
    rotulo: c.rotulo,
    tipo: c.tipo,
    obrigatorio: Boolean(c.obrigatorio),
    largura: c.largura || 'media'
  }));
}

module.exports = { ESQUEMAS, DESTINOS_PRONTOS, obterEsquema, camposParaTela };
