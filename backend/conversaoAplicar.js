/**
 * Executa, contra o banco, o que `conversaoEstoque.planejarConsumo` decidiu.
 *
 * Separado do cálculo de propósito (ver o comentário em conversaoEstoque.js):
 * aqui só há efeito, nenhuma regra. Se você precisa mudar O QUE é consumido,
 * mexa lá; aqui só se mexe em COMO é gravado.
 *
 * O que acontece, nesta ordem:
 *   1. lê a rota de cada produto e o estoque dos insumos envolvidos;
 *   2. calcula o plano (função pura);
 *   3. grava `pedidos_itens_faltantes` — a foto do que faltava;
 *   4. grava `pedido_itens_ext` — de qual lote saiu cada peça pronta;
 *   5. abate os lotes de `produtos_em_cada_ponto`;
 *   6. abate a matéria-prima, via `registrarSaida` (a mesma função que o
 *      módulo de Matéria-Prima usa, para não existirem duas contabilidades).
 *
 * Nada aqui derruba a conversão. O pedido já foi criado quando esta função
 * roda; estourar aqui faria o usuário achar que a conversão falhou quando ela
 * não falhou. Os problemas voltam em `avisos`, para a interface mostrar.
 */

const { planejarConsumo, escolherLotes, arredondar } = require('./conversaoEstoque');
const { registrarSaida } = require('./materiaPrima');
const { invalidarCacheLotes } = require('./produtos');
const {
  EVENTO,
  registrarPecaDoEstoque,
  registrarReservaDeProducao,
  registrarConsumoDeInsumo,
  registrarEventoDoPedido
} = require('./estoqueLedger');

const TABELA_FALTANTES = 'pedidos_itens_faltantes';
const TABELA_EXT = 'pedido_itens_ext';
const TABELA_LOTES = 'produtos_em_cada_ponto';

function paraNumero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/** Rotas dos produtos envolvidos, indexadas por produto_id. */
async function carregarRotas(api, produtoIds) {
  const rotaPorProduto = new Map();
  const ultimoInsumoPorProduto = new Map();
  if (!produtoIds.length) return { rotaPorProduto, ultimoInsumoPorProduto };

  const insumosIds = new Set();
  const rotasBrutas = new Map();

  // Uma consulta por produto: a API não garante filtro "in" e a conversão tem
  // poucos produtos. Clareza vale mais que uma ida a menos aqui.
  for (const produtoId of produtoIds) {
    const itens = await api
      .get('/api/produtos_insumos', { query: { produto_id: produtoId } })
      .catch(() => []);
    const lista = Array.isArray(itens) ? itens : [];
    rotasBrutas.set(produtoId, lista);
    lista.forEach(i => {
      if (i?.insumo_id !== null && i?.insumo_id !== undefined) insumosIds.add(Number(i.insumo_id));
    });
  }

  // Nome, unidade e processo vêm da matéria-prima — são o que o relatório mostra.
  const materias = new Map();
  for (const insumoId of insumosIds) {
    const materia = await api.get(`/api/materia_prima/${insumoId}`).catch(() => null);
    if (materia && !materia.error) materias.set(Number(insumoId), materia);
  }

  for (const [produtoId, lista] of rotasBrutas.entries()) {
    const rota = lista
      .map(i => {
        const materia = materias.get(Number(i?.insumo_id)) || {};
        return {
          insumo_id: Number(i?.insumo_id),
          quantidade: paraNumero(i?.quantidade),
          ordem_insumo: i?.ordem_insumo ?? null,
          nome: materia?.nome || '',
          unidade: materia?.unidade || '',
          processo: materia?.processo || ''
        };
      })
      .sort((a, b) => paraNumero(a.ordem_insumo) - paraNumero(b.ordem_insumo));

    rotaPorProduto.set(produtoId, rota);
    ultimoInsumoPorProduto.set(produtoId, rota.length ? rota[rota.length - 1].insumo_id : null);
  }

  return { rotaPorProduto, ultimoInsumoPorProduto, materias };
}

/** Saldo atual dos insumos que a conversão vai tocar. */
async function carregarEstoqueInsumos(api, rotaPorProduto) {
  const ids = new Set();
  for (const rota of rotaPorProduto.values()) {
    rota.forEach(passo => {
      if (Number.isFinite(passo.insumo_id)) ids.add(passo.insumo_id);
    });
  }

  const estoquePorInsumo = new Map();
  for (const id of ids) {
    const materia = await api.get(`/api/materia_prima/${id}`).catch(() => null);
    estoquePorInsumo.set(id, {
      quantidade: paraNumero(materia?.quantidade),
      infinito: Boolean(materia?.infinito)
    });
  }
  return estoquePorInsumo;
}

/**
 * Descobre, a partir do estoque, quais lotes pela metade dá para aproveitar.
 *
 * Espelha a regra da revisão: só lotes que NÃO estão no fim da rota, do mais
 * adiantado para o menos adiantado (menos trabalho restante primeiro), até
 * cobrir a quantidade necessária.
 *
 * @returns {Array<{ ultimo_insumo_id: number, quantidade: number, ordem: number }>}
 */
function derivarParciais({
  lotes = [],
  rota = [],
  ultimoInsumoFinal = null,
  quantidadeNecessaria = 0,
  reservadoNoFinal = 0
} = {}) {
  let restante = paraNumero(quantidadeNecessaria);
  if (!(restante > 0) || !rota.length) return [];

  const ordemPorInsumo = new Map(rota.map(p => [Number(p.insumo_id), paraNumero(p.ordem_insumo)]));

  const candidatos = lotes
    .map(lote => ({
      // O ID DO LOTE viaja junto. Antes eu devolvia só o `ultimo_insumo_id` e o
      // abatimento saía PROCURANDO um lote com aquele insumo — a mesma busca
      // que já tinha falhado com os parciais. Com o id não há procura nenhuma.
      lote_id: lote?.id ?? null,
      ultimo_insumo_id: Number(lote?.ultimo_insumo_id),
      // O lote pronto já é consumido pela peça inteira; o que sobra dele não
      // vale como parcial (ele não está "pela metade").
      disponivel: paraNumero(lote?.quantidade)
        - (Number(lote?.ultimo_insumo_id) === Number(ultimoInsumoFinal) ? paraNumero(reservadoNoFinal) : 0),
      ordem: ordemPorInsumo.get(Number(lote?.ultimo_insumo_id)) ?? 0
    }))
    .filter(c => c.disponivel > 0)
    .filter(c => c.lote_id !== null)
    .filter(c => Number(c.ultimo_insumo_id) !== Number(ultimoInsumoFinal))
    .sort((a, b) => b.ordem - a.ordem);

  // Um item POR LOTE, não por insumo: dois lotes no mesmo ponto da rota são
  // duas linhas de estoque diferentes e cada uma precisa ser baixada na sua.
  const escolhidos = [];
  for (const candidato of candidatos) {
    if (!(restante > 0)) break;
    const usar = Math.min(candidato.disponivel, restante);
    if (!(usar > 0)) continue;
    escolhidos.push({
      lote_id: candidato.lote_id,
      ultimo_insumo_id: candidato.ultimo_insumo_id,
      quantidade: arredondar(usar),
      ordem: candidato.ordem
    });
    restante = arredondar(restante - usar);
  }

  return escolhidos;
}

/**
 * @param {object} api            cliente da requisição
 * @param {object} entrada
 * @param {number} entrada.pedidoId
 * @param {Array}  entrada.itens  peças JÁ criadas, com o id de pedidos_itens:
 *   `{ pedido_item_id, produto_id, quantidade, qtd_usar_pronta, qtd_a_produzir }`
 * @param {number|null} entrada.usuarioId  quem decidiu (vai para a movimentação)
 * @param {Function}    entrada.inserirLinhaComId  usado nas tabelas sem auto-incremento
 * @param {Function}    entrada.getMaxId
 */
async function aplicarConversaoNoEstoque(api, {
  pedidoId,
  itens = [],
  usuarioId = null,
  inserirLinhaComId,
  getMaxId
} = {}) {
  const avisos = [];
  const resumo = {
    faltantesGravados: 0,
    pecasDeEstoqueGravadas: 0,
    insumosAbatidos: 0,
    reservasCriadas: 0,
    avisos
  };

  const pecas = (Array.isArray(itens) ? itens : []).filter(i => Number.isFinite(Number(i?.produto_id)));
  if (!pecas.length) return resumo;

  const produtoIds = Array.from(new Set(pecas.map(i => Number(i.produto_id))));
  const { rotaPorProduto, ultimoInsumoPorProduto } = await carregarRotas(api, produtoIds);
  const estoquePorInsumo = await carregarEstoqueInsumos(api, rotaPorProduto);

  // ------------------------------------------------------------------
  // Parciais: confiar, mas não depender.
  //
  // A revisão envia quais lotes pela metade foram escolhidos. Se essa lista não
  // vier — payload antigo, revisão pulada, conversão em lote —, NÃO podemos
  // simplesmente tratar tudo como "produzir do zero": seria abater matéria-prima
  // que não será usada e deixar o lote parcial no estoque como se estivesse
  // livre. Então derivamos do próprio estoque, com a mesma regra da revisão:
  // aproveita-se primeiro o lote MAIS ADIANTADO na rota, que é o que exige
  // menos trabalho restante.
  // ------------------------------------------------------------------
  const lotesPorProduto = new Map();
  for (const produtoId of produtoIds) {
    const dados = await api
      .get(`/api/${TABELA_LOTES}`, { query: { produto_id: produtoId } })
      .catch(() => []);
    lotesPorProduto.set(produtoId, Array.isArray(dados) ? dados : []);
  }

  const pecasComParciais = pecas.map(peca => {
    // A lista que a revisão manda NÃO serve para abater: ela diz em que ponto
    // da rota a peça parou, mas não DE QUAL LINHA do estoque ela sai. Sem o id
    // do lote o abatimento volta a procurar — e procurar é o que vinha
    // falhando ("faltaram 2", "faltaram 3", com os lotes ali no banco).
    //
    // Por isso a resolução dos lotes é SEMPRE feita aqui, contra o estoque de
    // verdade. O que a revisão informou continua valendo como quantidade; o
    // "onde" é resolvido por id.
    const aProduzir = Number(peca?.qtd_a_produzir) || 0;
    if (!(aProduzir > 0)) return peca;

    // ------------------------------------------------------------------
    // Quando derivar
    //
    // A regra antiga era "só derive se não houve revisão". Ela partia de que a
    // revisão SEMPRE informa os parciais — e não informa: o caminho do modal
    // "Substituir Peça" (replacementPlan) monta o plano por outro lugar e a
    // lista chega vazia. O resultado foi 5 peças parciais escolhidas na tela e
    // ZERO abatidas do estoque.
    //
    // Agora a regra é a do estoque, não a do formulário: se vamos produzir e
    // existe lote pela metade disponível, ele é aproveitado. A ÚNICA coisa que
    // impede é o usuário ter dito explicitamente "produzir tudo do zero" —
    // ignorar isso consumiria um lote que ele decidiu não usar.
    // ------------------------------------------------------------------
    if (peca?.forcarProduzirDoZero === true) return peca;

    const produtoId = Number(peca.produto_id);
    const derivados = derivarParciais({
      lotes: lotesPorProduto.get(produtoId) || [],
      rota: rotaPorProduto.get(produtoId) || [],
      ultimoInsumoFinal: ultimoInsumoPorProduto.get(produtoId),
      quantidadeNecessaria: aProduzir,
      // O que a peça pronta já vai levar não pode ser contado de novo.
      reservadoNoFinal: Number(peca?.qtd_usar_pronta) || 0
    });

    // Nenhum lote pela metade disponível: tudo será produzido do zero, e as
    // "parciais" que a revisão informou não têm lastro no estoque.
    if (!derivados.length) return { ...peca, parciais: [] };

    // Os derivados SUBSTITUEM o que veio da revisão de propósito: só eles
    // carregam o id da linha do estoque.
    return { ...peca, parciais: derivados };
  });

  const plano = planejarConsumo({ itens: pecasComParciais, rotaPorProduto, estoquePorInsumo });

  // ------------------------------------------------------------------
  // 3. O que faltava — a foto que o relatório e o estorno vão ler
  // ------------------------------------------------------------------
  for (const falta of plano.faltantes) {
    try {
      await api.post(`/api/${TABELA_FALTANTES}`, {
        pedido_id: pedidoId,
        pedido_item_id: falta.pedido_item_id,
        produto_id: falta.produto_id,
        insumo_id: falta.insumo_id,
        insumo_nome: falta.insumo_nome,
        unidade: falta.unidade,
        processo: falta.processo || 'Sem processo',
        ordem_insumo: falta.ordem_insumo,
        quantidade: falta.quantidade
      });
      resumo.faltantesGravados += 1;
    } catch (err) {
      avisos.push(`Falha ao registrar o faltante "${falta.insumo_nome}": ${err?.message || err}`);
    }
  }

  // ------------------------------------------------------------------
  // 4 e 5. Peças tiradas prontas do estoque
  // ------------------------------------------------------------------
  let proximoExtId = null;
  for (const peca of plano.pecasDeEstoque) {
    let lotes = [];
    try {
      const dados = await api.get(`/api/${TABELA_LOTES}`, { query: { produto_id: peca.produto_id } });
      lotes = Array.isArray(dados) ? dados : [];
    } catch (err) {
      avisos.push(`Não foi possível ler os lotes do produto ${peca.produto_id}: ${err?.message || err}`);
      continue;
    }

    // Caminho principal: a revisão disse EXATAMENTE qual linha do estoque foi
    // escolhida. Sem procura, sem empate, sem lote parecido.
    let consumos;
    let restante;
    if (peca.lote_id !== null && peca.lote_id !== undefined) {
      const lote = lotes.find(l => String(l?.id) === String(peca.lote_id));
      if (!lote) {
        avisos.push(
          `O lote ${peca.lote_id} do produto ${peca.produto_id} não existe mais: ` +
          'alguém pode tê-lo consumido entre a revisão e a confirmação. Confira o estoque.'
        );
        continue;
      }
      const disponivel = paraNumero(lote.quantidade);
      const usar = Math.min(disponivel, peca.quantidade);
      consumos = usar > 0 ? [{
        lote_id: lote.id,
        ultimo_insumo_id: lote.ultimo_insumo_id ?? null,
        etapa_id: lote.etapa_id ?? null,
        quantidade: arredondar(usar),
        quantidade_restante_no_lote: arredondar(disponivel - usar)
      }] : [];
      restante = arredondar(peca.quantidade - usar);
    } else {
      // Sem id (revisão antiga ou plano de substituição): peça inteira procura
      // lote no FIM da rota; parcial procura o que parou no insumo informado.
      const alvo = peca.parcial
        ? peca.ultimo_insumo_id
        : ultimoInsumoPorProduto.get(peca.produto_id);
      ({ consumos, restante } = escolherLotes(lotes, peca.quantidade, alvo));
    }

    if (restante > 0) {
      avisos.push(
        `O produto ${peca.produto_id} não tinha ${peca.quantidade} ` +
        `${peca.parcial ? 'peça(s) parcial(is)' : 'pronta(s)'} em estoque: ` +
        `faltaram ${restante}. O pedido foi criado; confira o estoque.`
      );
    }

    for (const consumo of consumos) {
      // Baixa do lote
      try {
        await api.put(`/api/${TABELA_LOTES}/${consumo.lote_id}`, {
          quantidade: consumo.quantidade_restante_no_lote
        });
      } catch (err) {
        avisos.push(`Falha ao baixar o lote ${consumo.lote_id}: ${err?.message || err}`);
        continue;
      }

      // Razão: a peça veio do estoque. Vai para `pedido_itens_ext` (o que
      // devolver num cancelamento) e para `estoque_movimentos` (o que
      // aconteceu, unitário, com data e autor).
      const resultado = await registrarPecaDoEstoque(api, {
        pedidoId,
        pedidoItemId: peca.pedido_item_id,
        produtoId: peca.produto_id,
        loteId: consumo.lote_id,
        ultimoInsumoId: consumo.ultimo_insumo_id,
        etapaId: consumo.etapa_id,
        quantidade: consumo.quantidade,
        parcial: Boolean(peca.parcial),
        usuarioId
      }, { inserirLinhaComId, getMaxId, proximoId: proximoExtId }, avisos);
      proximoExtId = resultado.proximoId;
      resumo.pecasDeEstoqueGravadas += 1;
    }
  }

  // ------------------------------------------------------------------
  // Peças que serão PRODUZIDAS DO ZERO
  //
  // Não entram em `pedido_itens_ext`: elas nunca estiveram no estoque, e
  // registrá-las lá faria o cancelamento "devolver" algo que nunca saiu de lá.
  // Vão para `reservas_estoque` com status "producao" — uma promessa de peça,
  // que no cancelamento vira peça de verdade no estoque.
  // ------------------------------------------------------------------
  // Só as PARCIAIS descontam do que será produzido. `qtd_a_produzir` já é
  // "parcial + do zero"; as peças prontas estão fora dessa conta desde sempre.
  // A versão anterior subtraía o total vindo do estoque (pronta + parcial) e
  // reservava peça a mais ou a menos conforme o caso — foi o que gerou uma
  // reserva de 1 num pedido cuja peça tinha saído inteira do estoque.
  const parcialPorItem = new Map();
  for (const p of plano.pecasDeEstoque) {
    if (!p.parcial) continue;
    const chave = String(p.pedido_item_id);
    parcialPorItem.set(chave, (parcialPorItem.get(chave) || 0) + paraNumero(p.quantidade));
  }

  for (const peca of pecasComParciais) {
    const aProduzir = Number(peca?.qtd_a_produzir) || 0;
    if (!(aProduzir > 0)) continue;
    const totalParcial = parcialPorItem.get(String(peca.pedido_item_id)) || 0;
    const doZero = arredondar(Math.max(0, aProduzir - totalParcial));
    if (!(doZero > 0)) continue;

    const produtoId = Number(peca.produto_id);
    const rota = rotaPorProduto.get(produtoId) || [];
    const reservaId = await registrarReservaDeProducao(api, {
      pedidoId,
      pedidoItemId: peca.pedido_item_id,
      produtoId,
      // A peça nasce completa: o último insumo da rota é onde ela vai parar.
      ultimoInsumoId: rota.length ? rota[rota.length - 1].insumo_id : null,
      quantidade: doZero,
      usuarioId
    }, avisos);
    if (reservaId) resumo.reservasCriadas += 1;
  }

  // ------------------------------------------------------------------
  // 6. Abate a matéria-prima
  //
  // Por último de propósito: se algo acima falhar, o saldo ainda não foi
  // mexido. `registrarSaida` é a MESMA função do módulo de Matéria-Prima —
  // atualiza o saldo e grava a movimentação, então a baixa aparece no
  // histórico do insumo como qualquer outra.
  // ------------------------------------------------------------------
  for (const consumo of plano.consumoPorInsumo) {
    if (!(consumo.quantidade > 0)) continue;
    if (!Number.isFinite(consumo.insumo_id)) continue;
    try {
      await registrarSaida(consumo.insumo_id, consumo.quantidade, usuarioId);
      resumo.insumosAbatidos += 1;
      // O razão registra o consumo ligado ao PEDIDO — `registrarSaida` só grava
      // no histórico do insumo, que não sabe para quem foi.
      await registrarConsumoDeInsumo(api, {
        pedidoId,
        insumoId: consumo.insumo_id,
        quantidade: consumo.quantidade,
        usuarioId
      }, avisos);
    } catch (err) {
      avisos.push(`Falha ao abater "${consumo.insumo_nome}": ${err?.message || err}`);
    }
  }

  // Evento do pedido: o que aconteceu com ELE, não com o estoque.
  await registrarEventoDoPedido(api, {
    pedidoId,
    tipoEvento: EVENTO.CONVERSAO,
    descricao:
      `Convertido do orçamento. ${resumo.pecasDeEstoqueGravadas} peça(s) do estoque, `
      + `${resumo.reservasCriadas} reserva(s) de produção, `
      + `${resumo.insumosAbatidos} insumo(s) abatido(s).`,
    usuarioId
  }, avisos);

  // Os lotes foram baixados direto pela API da requisição, sem passar pelo
  // `produtos.js` — o cache de 30 s dele ficaria mostrando o estoque de antes
  // da conversão na grade de Produtos.
  if (plano.pecasDeEstoque.length) {
    try { invalidarCacheLotes(); } catch (_) { /* cache é otimização, não regra */ }
  }

  resumo.temFalta = plano.temFalta;
  resumo.totalFaltante = arredondar(
    plano.faltantes.reduce((acc, f) => acc + paraNumero(f.quantidade), 0)
  );
  return resumo;
}

module.exports = { aplicarConversaoNoEstoque, carregarRotas, carregarEstoqueInsumos };
