/**
 * O que a conversão de orçamento em pedido faz com o estoque.
 *
 * Este arquivo tem DUAS partes bem separadas de propósito:
 *
 *  1. `planejarConsumo` — cálculo PURO. Recebe as peças, as rotas e o estoque;
 *     devolve o que consumir, o que falta e por qual peça. Não fala com o banco,
 *     não tem efeito nenhum. É aqui que mora a regra, e é isto que os testes
 *     exercitam.
 *  2. `aplicarPlano` — o efeito. Grava os registros e abate o estoque a partir
 *     de um plano já calculado.
 *
 * A separação não é estética: abater estoque é irreversível na prática, e uma
 * regra de alocação errada só apareceria depois de estragar o saldo. Com o
 * cálculo isolado dá para provar a regra sem risco.
 *
 * REGRA DE ALOCAÇÃO
 * -----------------
 * O estoque de um insumo é global, mas a falta precisa ser atribuída a UMA peça
 * para o relatório de produção fazer sentido ("falta X para a peça Y"). As peças
 * são atendidas na ordem em que aparecem no pedido: cada uma consome do que
 * sobrou e o que não couber é a falta dela. Determinístico e explicável.
 *
 * O QUE É ABATIDO
 * ---------------
 * Da matéria-prima sai TUDO que as peças precisam para serem produzidas — não
 * só a parte que havia em estoque. Quando o necessário passa do disponível, o
 * saldo fica negativo, e é exatamente para isso que existe
 * `pedidos.pode_saldo_negativo` com a justificativa em `decisao_estoque_note`.
 * Insumo marcado como `infinito` nunca falta e nunca é abatido.
 *
 * Peça escolhida como PRONTA não consome insumo nenhum: ela já foi produzida.
 * O que ela consome é o lote em `produtos_em_cada_ponto`.
 */

function paraNumero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/** Arredonda para 4 casas — a precisão das colunas numeric(12,4). */
function arredondar(valor) {
  return Math.round((paraNumero(valor) + Number.EPSILON) * 10000) / 10000;
}

/**
 * @param {object} entrada
 * @param {Array}  entrada.itens         peças do pedido, na ordem do pedido:
 *   `{ pedido_item_id, produto_id, quantidade, qtd_usar_pronta, qtd_a_produzir }`
 * @param {Map}    entrada.rotaPorProduto produto_id -> lista da rota:
 *   `{ insumo_id, quantidade, ordem_insumo, nome, unidade, processo }`
 * @param {Map}    entrada.estoquePorInsumo insumo_id -> `{ quantidade, infinito }`
 *
 * @returns {{
 *   consumoPorInsumo: Array,  // quanto abater de cada insumo
 *   faltantes: Array,         // uma linha por (peça, insumo) que não coube no estoque
 *   pecasDeEstoque: Array,    // peças a retirar prontas do estoque
 *   temFalta: boolean
 * }}
 */
function planejarConsumo({ itens = [], rotaPorProduto = new Map(), estoquePorInsumo = new Map() } = {}) {
  // Saldo que vai sendo comido peça a peça. Cópia: não mexemos na entrada.
  const disponivel = new Map();
  for (const [insumoId, dados] of estoquePorInsumo.entries()) {
    disponivel.set(Number(insumoId), {
      quantidade: paraNumero(dados?.quantidade),
      infinito: Boolean(dados?.infinito)
    });
  }

  const consumoPorInsumo = new Map();
  const faltantes = [];
  const pecasDeEstoque = [];

  for (const item of itens) {
    const pedidoItemId = item?.pedido_item_id ?? null;
    const produtoId = Number(item?.produto_id);
    const quantidade = paraNumero(item?.quantidade);

    // `qtd_usar_pronta` manda; o resto é produzido. Se vier incoerente com a
    // quantidade da peça, a quantidade da peça é a verdade — ela é o que foi
    // vendido.
    const usarPronta = Math.max(0, Math.min(paraNumero(item?.qtd_usar_pronta), quantidade));
    const aProduzir = item?.qtd_a_produzir === undefined || item?.qtd_a_produzir === null
      ? Math.max(0, quantidade - usarPronta)
      : Math.max(0, Math.min(paraNumero(item.qtd_a_produzir), quantidade - usarPronta));

    if (usarPronta > 0) {
      pecasDeEstoque.push({
        pedido_item_id: pedidoItemId,
        produto_id: produtoId,
        quantidade: arredondar(usarPronta),
        // Peça inteira: o lote está no FIM da rota.
        ultimo_insumo_id: null,
        parcial: false
      });
    }

    const rota = rotaPorProduto.get(produtoId) || rotaPorProduto.get(String(produtoId)) || [];
    const ordemPorInsumo = new Map(
      rota.map(passo => [Number(passo?.insumo_id), paraNumero(passo?.ordem_insumo)])
    );

    // ------------------------------------------------------------------
    // Peças aproveitadas PELA METADE
    //
    // Duas coisas, e as duas estavam erradas:
    //
    //  1. O lote SAI do estoque. Ele foi comprometido com este pedido; deixá-lo
    //     lá o oferece de novo para outro pedido.
    //  2. Ela consome SÓ O QUE FALTA. O lote já passou pelos processos até um
    //     ponto da rota, e esses insumos já foram gastos quando ele foi
    //     produzido. Cobrar a rota inteira de novo abate matéria-prima que
    //     ninguém vai usar e imprime um relatório pedindo material a mais —
    //     estoque falso para menos, relatório falso para mais.
    // ------------------------------------------------------------------
    const parciais = (Array.isArray(item?.parciais) ? item.parciais : [])
      .map(parcial => {
        const insumoId = Number.isFinite(Number(parcial?.ultimo_insumo_id))
          ? Number(parcial.ultimo_insumo_id)
          : null;
        // A ordem informada pela revisão manda; se não vier, descobrimos pela
        // rota a partir do insumo em que o lote parou.
        const ordemInformada = parcial?.ordem === undefined || parcial?.ordem === null
          ? null
          : paraNumero(parcial.ordem);
        const ordem = ordemInformada !== null
          ? ordemInformada
          : (ordemPorInsumo.has(insumoId) ? ordemPorInsumo.get(insumoId) : 0);
        return {
          quantidade: paraNumero(parcial?.quantidade),
          ultimo_insumo_id: insumoId,
          ordem
        };
      })
      .filter(parcial => parcial.quantidade > 0);

    for (const parcial of parciais) {
      pecasDeEstoque.push({
        pedido_item_id: pedidoItemId,
        produto_id: produtoId,
        quantidade: arredondar(parcial.quantidade),
        // Aqui o lote NÃO está no fim da rota: é este insumo que identifica em
        // que ponto ele parou.
        ultimo_insumo_id: parcial.ultimo_insumo_id,
        parcial: true
      });
    }

    if (!(aProduzir > 0)) continue;

    // `qtd_a_produzir` = parcial + do zero. Só o "do zero" paga a rota inteira.
    const totalParcial = parciais.reduce((acc, p) => acc + p.quantidade, 0);
    const doZero = Math.max(0, arredondar(aProduzir - totalParcial));

    /** Quantas unidades passam por este passo da rota. */
    const unidadesNoPasso = passo => {
      const ordemDoPasso = paraNumero(passo?.ordem_insumo);
      // As produzidas do zero passam por tudo; as parciais, só pelo que vem
      // DEPOIS do ponto onde pararam.
      const dosParciais = parciais.reduce(
        (acc, p) => acc + (ordemDoPasso > p.ordem ? p.quantidade : 0),
        0
      );
      return doZero + dosParciais;
    };

    for (const passo of rota) {
      const insumoId = Number(passo?.insumo_id);
      const porUnidade = paraNumero(passo?.quantidade);
      const unidades = unidadesNoPasso(passo);
      const necessario = arredondar(porUnidade * unidades);
      if (!(necessario > 0)) continue;

      const estoque = disponivel.get(insumoId) || { quantidade: 0, infinito: false };

      // Sempre abatemos o necessário INTEIRO da matéria-prima. O que o estoque
      // não cobria vira falta registrada — e saldo negativo, que o pedido
      // precisa ter autorizado.
      const atual = consumoPorInsumo.get(insumoId) || {
        insumo_id: insumoId,
        insumo_nome: passo?.nome || '',
        unidade: passo?.unidade || '',
        processo: passo?.processo || '',
        infinito: Boolean(estoque.infinito),
        quantidade: 0
      };
      atual.quantidade = arredondar(atual.quantidade + necessario);
      consumoPorInsumo.set(insumoId, atual);

      if (estoque.infinito) continue;

      const coberto = Math.max(0, Math.min(necessario, estoque.quantidade));
      const falta = arredondar(necessario - coberto);
      estoque.quantidade = arredondar(estoque.quantidade - coberto);
      disponivel.set(insumoId, estoque);

      if (falta > 0) {
        faltantes.push({
          pedido_item_id: pedidoItemId,
          produto_id: produtoId,
          insumo_id: Number.isFinite(insumoId) ? insumoId : null,
          insumo_nome: passo?.nome || '',
          unidade: passo?.unidade || '',
          processo: passo?.processo || '',
          ordem_insumo: passo?.ordem_insumo ?? null,
          quantidade: falta
        });
      }
    }
  }

  return {
    consumoPorInsumo: Array.from(consumoPorInsumo.values()).filter(c => !c.infinito),
    faltantes,
    pecasDeEstoque,
    temFalta: faltantes.length > 0
  };
}

/**
 * Agrupa os faltantes por processo, como o relatório de produção precisa:
 * uma folha por processo, com o total de cada insumo somado entre as peças.
 */
function agruparFaltantesPorProcesso(faltantes = []) {
  const porProcesso = new Map();

  for (const f of faltantes) {
    const processo = f?.processo || 'Sem processo';
    if (!porProcesso.has(processo)) {
      porProcesso.set(processo, { processo, itens: new Map() });
    }
    const grupo = porProcesso.get(processo);
    const chave = `${f?.insumo_nome || ''}__${f?.unidade || ''}`;
    const atual = grupo.itens.get(chave) || {
      insumo_id: f?.insumo_id ?? null,
      insumo_nome: f?.insumo_nome || '',
      unidade: f?.unidade || '',
      quantidade: 0
    };
    atual.quantidade = arredondar(atual.quantidade + paraNumero(f?.quantidade));
    grupo.itens.set(chave, atual);
  }

  return Array.from(porProcesso.values())
    .map(g => ({
      processo: g.processo,
      itens: Array.from(g.itens.values()).sort((a, b) =>
        String(a.insumo_nome).localeCompare(String(b.insumo_nome), 'pt-BR')
      )
    }))
    .sort((a, b) => String(a.processo).localeCompare(String(b.processo), 'pt-BR'));
}

/**
 * Escolhe de quais lotes tirar as peças prontas.
 *
 * Regra: FIFO pela data de conclusão, e só lotes que estão no FIM da rota — um
 * lote parado no meio do processo não é uma peça pronta, é trabalho em
 * andamento. Entregar isso como pronto seria enviar peça inacabada ao cliente.
 *
 * `ultimoInsumoFinal` é o insumo da última posição da rota. Quando a rota é
 * desconhecida (produto sem cadastro de insumos), aceitamos qualquer lote:
 * nesse caso não há como distinguir pronto de parcial, e recusar tudo travaria
 * a conversão de produtos simples.
 *
 * @returns {{ consumos: Array, restante: number }}
 */
function escolherLotes(lotes = [], quantidade = 0, ultimoInsumoFinal = null) {
  let restante = paraNumero(quantidade);
  if (!(restante > 0)) return { consumos: [], restante: 0 };

  const elegiveis = (Array.isArray(lotes) ? lotes : [])
    .filter(l => paraNumero(l?.quantidade) > 0)
    .filter(l => {
      if (ultimoInsumoFinal === null || ultimoInsumoFinal === undefined) return true;
      return Number(l?.ultimo_insumo_id) === Number(ultimoInsumoFinal);
    })
    .sort((a, b) => {
      const da = new Date(a?.data_hora_completa || 0).getTime() || 0;
      const db = new Date(b?.data_hora_completa || 0).getTime() || 0;
      return da - db;
    });

  const consumos = [];
  for (const lote of elegiveis) {
    if (!(restante > 0)) break;
    const disponivelNoLote = paraNumero(lote.quantidade);
    const usar = Math.min(disponivelNoLote, restante);
    if (!(usar > 0)) continue;
    consumos.push({
      lote_id: lote.id,
      ultimo_insumo_id: lote.ultimo_insumo_id ?? null,
      etapa_id: lote.etapa_id ?? null,
      quantidade: arredondar(usar),
      quantidade_restante_no_lote: arredondar(disponivelNoLote - usar)
    });
    restante = arredondar(restante - usar);
  }

  return { consumos, restante: arredondar(restante) };
}

module.exports = {
  planejarConsumo,
  agruparFaltantesPorProcesso,
  escolherLotes,
  arredondar
};
