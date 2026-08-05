/**
 * Estorno de um pedido cancelado.
 *
 * A REGRA, EM UMA FRASE
 * ---------------------
 *   Devolve-se a peça no ESTÁGIO escolhido, e volta para a matéria-prima tudo o
 *   que ESTA conversão consumiu DEPOIS daquele estágio.
 *
 * Parece simples porque é — e cobre todos os casos que pareciam diferentes:
 *
 *   | situação                                   | estágio | peça       | insumos     |
 *   |--------------------------------------------|---------|------------|-------------|
 *   | peça do zero, devolvida em 12/15           | 12      | lote em 12 | 13,14,15    |
 *   | peça do zero, revertida (excluir)          | 0       | nenhuma    | todos os 15 |
 *   | peça que entrou pela metade em 5/15,       |         |            |             |
 *   |   revertida (excluir ou realocar)          | 5       | lote em 5  | 6..15       |
 *   | peça pronta (15/15), devolvida             | 15      | lote em 15 | nenhum      |
 *
 * O ESTÁGIO TEM PISO E TETO
 * -------------------------
 *  - PISO: a origem da unidade, o ponto em que ela ENTROU no pedido. Uma peça
 *    que chegou pronta não pode voltar pela metade — ninguém a desmontou.
 *  - TETO: o fim da rota. Não existe estágio além do último insumo cadastrado.
 *
 * Peça produzida do zero tem piso 0, e estágio 0 quer dizer "nenhuma peça":
 * ela nunca existiu, então só há material a devolver.
 *
 * POR QUE SÓ O QUE ESTA CONVERSÃO CONSUMIU
 * ----------------------------------------
 * Uma peça que entrou pela metade já tinha os passos até ali pagos por outro
 * pedido, num outro momento. Devolvê-los aqui criaria material do nada. O que
 * este pedido tirou do estoque foi apenas o trecho da rota que faltava — e é
 * exatamente esse trecho, menos o que foi de fato produzido, que volta.
 */

const {
  MOV,
  ITEM,
  RESERVA,
  registrarMovimento,
  atualizarStatusDasReservas
} = require('./estoqueLedger');

const TABELA_LOTES = '/api/produtos_em_cada_ponto';

function paraNumero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function arredondar(valor) {
  return Math.round((paraNumero(valor) + Number.EPSILON) * 10000) / 10000;
}

/** Toda a matéria-prima indexada por id, numa leitura só. */
async function carregarInsumos(api) {
  const lista = await api.get('/api/materia_prima').catch(() => []);
  const porId = new Map();
  for (const m of (Array.isArray(lista) ? lista : [])) {
    if (m?.id !== undefined && m?.id !== null) porId.set(Number(m.id), m);
  }
  return porId;
}

/**
 * Rota do produto, ordenada. `passo_id` é o id da linha em produtos_insumos.
 *
 * O NOME e o PROCESSO de cada passo vêm da matéria-prima e viajam junto: é com
 * eles que o lote criado no estorno nasce completo. Sem o processo, o lote
 * entrava no estoque com a coluna "Processo atual" vazia — uma peça sem etapa,
 * que a tela de Detalhe de Estoque mostra como "—" e ninguém sabe o que é.
 */
async function carregarRota(api, produtoId, cache, insumos) {
  const chave = Number(produtoId);
  if (cache.has(chave)) return cache.get(chave);

  const bruta = await api
    .get('/api/produtos_insumos', { query: { produto_id: chave } })
    .catch(() => []);
  const rota = (Array.isArray(bruta) ? bruta : [])
    .map(p => {
      const materia = insumos?.get(Number(p.insumo_id)) || null;
      return {
        passo_id: Number(p.id),
        insumo_id: Number(p.insumo_id),
        insumo_nome: materia?.nome || `Insumo ${p.insumo_id}`,
        processo: materia?.processo || '',
        por_unidade: paraNumero(p.quantidade),
        ordem: paraNumero(p.ordem_insumo)
      };
    })
    .filter(p => Number.isFinite(p.insumo_id))
    .sort((a, b) => a.ordem - b.ordem);

  cache.set(chave, rota);
  return rota;
}

/**
 * De onde cada unidade do item veio, com o estágio (ordem na rota) em que
 * entrou no pedido.
 *
 * É o PISO de cada grupo: a unidade não pode ser devolvida num ponto anterior
 * ao que ela já estava quando foi escolhida.
 */
function montarGrupos({ extDoItem, reserva, rota, item }) {
  const grupos = [];
  const ordemFinal = rota.length ? rota[rota.length - 1].ordem : 0;
  let parciaisDoEstoque = 0;

  for (const reg of extDoItem) {
    const passo = rota.find(p => Number(p.passo_id) === Number(reg.ultimo_insumo_id)) || null;
    const ordemOrigem = passo ? passo.ordem : ordemFinal;
    const quantidade = paraNumero(reg.quantidade);
    // Peça PELA METADE é a que não estava no fim da rota. É dela que sai a
    // conta de quantas unidades sobraram para produzir do zero.
    if (ordemOrigem < ordemFinal) parciaisDoEstoque += quantidade;

    grupos.push({
      origem: 'estoque',
      ordem_origem: ordemOrigem,
      lote_id: reg.etapa_id ?? null,
      quantidade,
      restante: quantidade
    });
  }

  // ------------------------------------------------------------------
  // Quantas seriam produzidas do zero
  //
  // A conta vem de `pedidos_itens.qtd_a_produzir` menos o que foi aproveitado
  // pela metade — a MESMA conta que a conversão fez ao abater os insumos.
  //
  // Antes esta quantidade era lida de `reservas_estoque`, e isso quebrava
  // exatamente onde mais dói: se a reserva não tivesse sido gravada (falha de
  // rede na conversão, pedido convertido antes de as reservas existirem), o
  // grupo "do zero" simplesmente não aparecia. O cancelamento então marcava o
  // pedido como cancelado e não devolvia NADA — nem as peças, nem os insumos
  // que já tinham sido abatidos. Foi o que aconteceu com o PED18.
  //
  // A reserva continua servindo de reforço: se `qtd_a_produzir` não vier, ela
  // responde.
  // ------------------------------------------------------------------
  const aProduzir = paraNumero(item?.qtd_a_produzir);
  const doZero = aProduzir > 0
    ? arredondar(Math.max(0, aProduzir - parciaisDoEstoque))
    : paraNumero(reserva?.quantidade);

  if (doZero > 0) {
    grupos.push({
      origem: 'producao',
      ordem_origem: 0,
      lote_id: null,
      quantidade: doZero,
      restante: doZero
    });
  }

  // Do mais adiantado para o menos: quem devolve "uma peça no estágio 12" quer
  // a que estava mais perto disso, não a que teria de ser produzida do zero.
  grupos.sort((a, b) => b.ordem_origem - a.ordem_origem);
  return grupos;
}

/**
 * Lote do produto naquele ponto da rota — o existente, ou um novo.
 *
 * O estoque de peças é organizado por PONTO DA ROTA, não por peça solta. Se o
 * usuário devolve uma peça num estágio que ainda não tem lote, o lote é criado:
 * sem isso a peça não teria onde entrar e o estorno simplesmente a perderia.
 */
async function lotePara(api, { produtoId, passo, lotePreferido }, cacheLotes, avisos) {
  if (lotePreferido !== null && lotePreferido !== undefined) {
    const lote = await api.get(`${TABELA_LOTES}/${lotePreferido}`).catch(() => null);
    if (lote && !lote.error && Number(lote.ultimo_insumo_id) === Number(passo?.insumo_id)) {
      return lote;
    }
  }

  const chave = `${produtoId}:${passo?.insumo_id}`;
  if (cacheLotes.has(chave)) return cacheLotes.get(chave);

  const existentes = await api
    .get(TABELA_LOTES, { query: { produto_id: produtoId } })
    .catch(() => []);
  const achado = (Array.isArray(existentes) ? existentes : [])
    .find(l => Number(l.ultimo_insumo_id) === Number(passo?.insumo_id));

  if (achado) {
    cacheLotes.set(chave, achado);
    return achado;
  }

  const criado = await api.post(TABELA_LOTES, {
    produto_id: produtoId,
    etapa_id: passo?.processo ?? null,
    ultimo_insumo_id: passo?.insumo_id ?? null,
    quantidade: 0,
    data_hora_completa: new Date().toISOString()
  }).catch(err => {
    avisos.push(`Falha ao criar o lote do produto ${produtoId} no ponto ${passo?.insumo_id}: ${err?.message || err}`);
    return null;
  });

  if (criado) cacheLotes.set(chave, { ...criado, quantidade: 0 });
  return cacheLotes.get(chave) || null;
}

/** Decisões do modal, agrupadas por peça do pedido. */
function agruparAcoes(acoes = []) {
  const porItem = new Map();

  for (const acao of (Array.isArray(acoes) ? acoes : [])) {
    const itemId = acao?.item?.id ?? acao?.item ?? null;
    const quantidade = paraNumero(acao?.quantity ?? acao?.quantidade);
    if (itemId === null || itemId === undefined || !(quantidade > 0)) continue;

    const chave = String(itemId);
    if (!porItem.has(chave)) porItem.set(chave, []);
    porItem.get(chave).push({
      acao: acao.action || acao.acao || 'stock',
      quantidade,
      // De qual conjunto de unidades esta decisão é. A tela manda uma linha por
      // grupo (uma pronta, quatro na Montagem, duas no Acabamento), e cada uma
      // devolve um trecho diferente da rota. Sem esta referência a decisão
      // cairia no grupo mais adiantado disponível — certo por acaso, errado na
      // maioria das vezes.
      grupo: acao.grupo || null,
      // `null` = "voltar como estava": o estágio de destino é o de origem.
      // É o que "excluir" e "realocar" fazem, e o padrão quando a tela antiga
      // (sem escolha de estágio) manda a decisão.
      ordemDestino: acao.ordem === undefined || acao.ordem === null
        ? null
        : paraNumero(acao.ordem),
      pedidoDestino: acao.orderId ?? acao.pedidoDestino ?? null
    });
  }

  return porItem;
}

/**
 * @param {object} api
 * @param {object} entrada
 * @param {number} entrada.pedidoId
 * @param {Array}  entrada.acoes  `{ item, action, quantity, ordem, orderId }`
 * @param {number|null} entrada.usuarioId
 * @param {Function} entrada.registrarEntradaInsumo  `registrarEntrada` da
 *   matéria-prima, injetada para o teste não precisar de rede.
 */
async function estornarCancelamento(api, {
  pedidoId,
  acoes = [],
  usuarioId = null,
  registrarEntradaInsumo = null
} = {}) {
  const avisos = [];
  const resumo = {
    pecasDevolvidas: 0,
    pecasNaoDevolvidas: 0,
    pecasRealocadas: 0,
    insumosDevolvidos: 0,
    reservasRetornadas: 0
  };

  const porItem = agruparAcoes(acoes);

  const [itens, doEstoque, reservas, insumos] = await Promise.all([
    api.get('/api/pedidos_itens', { query: { pedido_id: pedidoId } }).catch(() => []),
    api.get('/api/pedido_itens_ext', { query: { id_pedido: pedidoId } }).catch(() => []),
    api.get('/api/reservas_estoque', { query: { pedido_id: pedidoId } }).catch(() => []),
    // Nome e processo de cada insumo: é com eles que o lote criado no estorno
    // nasce completo, em vez de entrar no estoque sem etapa.
    carregarInsumos(api)
  ]);

  const listaItens = (Array.isArray(itens) ? itens : [])
    .filter(i => String(i?.pedido_id) === String(pedidoId));

  const extPorItem = new Map();
  for (const reg of (Array.isArray(doEstoque) ? doEstoque : [])) {
    const chave = String(reg.pedido_item_id);
    if (!extPorItem.has(chave)) extPorItem.set(chave, []);
    extPorItem.get(chave).push(reg);
  }
  const reservaPorItem = new Map();
  for (const r of (Array.isArray(reservas) ? reservas : [])) {
    if (String(r?.pedido_id) !== String(pedidoId)) continue;
    reservaPorItem.set(String(r.pedido_item_id), r);
  }

  const cacheRotas = new Map();
  const cacheLotes = new Map();
  /** insumo -> quantidade a devolver, somada e gravada uma vez só no fim. */
  const insumosAVoltar = new Map();

  for (const item of listaItens) {
    const chave = String(item.id);
    const decisoes = porItem.get(chave);
    // Sem decisão para esta peça, nada é mexido. Cancelar não pode devolver
    // estoque "por padrão": é a escolha que o modal existe para capturar.
    if (!decisoes || !decisoes.length) continue;

    const produtoId = Number(item.produto_id);
    const rota = await carregarRota(api, produtoId, cacheRotas, insumos);
    const ordemFinal = rota.length ? rota[rota.length - 1].ordem : 0;

    const grupos = montarGrupos({
      extDoItem: extPorItem.get(chave) || [],
      reserva: reservaPorItem.get(chave),
      rota,
      item
    });

    for (const decisao of decisoes) {
      let aTratar = decisao.quantidade;

      while (aTratar > 0) {
        // A tela diz de qual grupo é a decisão. Quando não diz (payload antigo),
        // cai no mais adiantado disponível — `montarGrupos` já ordenou assim.
        const grupo = decisao.grupo
          ? grupos.find(g =>
            g.restante > 0
            && String(g.origem) === String(decisao.grupo.origem)
            && Number(g.ordem_origem) === Number(decisao.grupo.ordem_origem)
            && String(g.lote_id ?? '') === String(decisao.grupo.lote_id ?? ''))
          : grupos.find(g => g.restante > 0);

        if (!grupo) {
          avisos.push(
            `A peça ${item.id} recebeu decisão para ${arredondar(aTratar)} unidade(s) `
            + 'além do que o pedido tinha. O excedente foi ignorado.'
          );
          break;
        }

        const unidades = Math.min(grupo.restante, aTratar);
        grupo.restante = arredondar(grupo.restante - unidades);
        aTratar = arredondar(aTratar - unidades);

        // O destino não pode ser ANTES da origem: ninguém desmonta uma peça.
        // Sem estágio escolhido, volta como estava — é o que "excluir" e
        // "realocar" significam.
        const pedido = decisao.ordemDestino === null ? grupo.ordem_origem : decisao.ordemDestino;
        const ordemDestino = Math.min(Math.max(pedido, grupo.ordem_origem), ordemFinal);
        if (decisao.ordemDestino !== null && decisao.ordemDestino < grupo.ordem_origem) {
          avisos.push(
            `A peça ${item.id} entrou no pedido no ponto ${grupo.ordem_origem} da rota e `
            + `não pode voltar no ponto ${decisao.ordemDestino}: foi devolvida no ponto de origem.`
          );
        }

        // --------------------------------------------------------------
        // A PEÇA
        //
        // Estágio 0 é o único caso sem peça: ela seria produzida do zero e o
        // usuário a está revertendo, então nunca existiu.
        // --------------------------------------------------------------
        if (ordemDestino > 0) {
          const passoDestino = rota.find(p => p.ordem === ordemDestino)
            || rota[rota.length - 1]
            || null;
          const lote = await lotePara(api, {
            produtoId,
            passo: passoDestino,
            lotePreferido: ordemDestino === grupo.ordem_origem ? grupo.lote_id : null
          }, cacheLotes, avisos);

          if (lote) {
            const nova = arredondar(paraNumero(lote.quantidade) + unidades);
            await api.put(`${TABELA_LOTES}/${lote.id}`, {
              quantidade: nova,
              data_hora_completa: new Date().toISOString()
            }).catch(err => avisos.push(`Falha ao devolver ao lote ${lote.id}: ${err?.message || err}`));
            lote.quantidade = nova;

            await registrarMovimento(api, {
              tipoMovimento: MOV.RETORNO,
              tipoItem: ITEM.PECA,
              itemId: produtoId,
              quantidade: unidades,
              pedidoId,
              pedidoItemId: item.id,
              loteId: lote.id,
              ultimoInsumoId: passoDestino?.insumo_id ?? null,
              nota: decisao.acao === 'reallocate'
                ? `Realocada para o pedido ${decisao.pedidoDestino}: voltou ao estoque no ponto ${ordemDestino} da rota`
                : `Cancelamento: devolvida ao estoque no ponto ${ordemDestino} da rota`,
              usuarioId
            }, avisos);

            resumo.pecasDevolvidas = arredondar(resumo.pecasDevolvidas + unidades);
          }
        } else {
          resumo.pecasNaoDevolvidas = arredondar(resumo.pecasNaoDevolvidas + unidades);
        }

        // --------------------------------------------------------------
        // A MATÉRIA-PRIMA
        //
        // Volta o trecho da rota que ESTA conversão pagou e que a peça não
        // percorreu: depois do destino, até o fim. Os passos anteriores à
        // origem foram pagos por outro pedido — devolvê-los criaria material
        // do nada.
        // --------------------------------------------------------------
        for (const passo of rota) {
          if (!(passo.ordem > ordemDestino)) continue;
          if (!(passo.ordem > grupo.ordem_origem)) continue;
          const quantidade = arredondar(passo.por_unidade * unidades);
          if (!(quantidade > 0)) continue;
          insumosAVoltar.set(
            passo.insumo_id,
            arredondar((insumosAVoltar.get(passo.insumo_id) || 0) + quantidade)
          );
        }

        // --------------------------------------------------------------
        // A REALOCAÇÃO
        //
        // Não muda o estoque — quem mudou foi o bloco acima. O que ela
        // acrescenta é o vínculo: para qual pedido esta peça foi.
        // --------------------------------------------------------------
        if (decisao.acao === 'reallocate') {
          const movimentoId = await registrarMovimento(api, {
            tipoMovimento: MOV.TRANSFERENCIA,
            tipoItem: ITEM.PECA,
            itemId: produtoId,
            quantidade: unidades,
            pedidoId,
            pedidoItemId: item.id,
            nota: `Realocada para o pedido ${decisao.pedidoDestino} no cancelamento`,
            usuarioId
          }, avisos);

          await api.post('/api/realocacoes', {
            movimento_id_origem: movimentoId,
            pedido_id_destino: decisao.pedidoDestino,
            created_at: new Date().toISOString(),
            created_by: usuarioId
          }).catch(err => avisos.push(
            `Falha ao registrar a realocação para o pedido ${decisao.pedidoDestino}: ${err?.message || err}`
          ));

          resumo.pecasRealocadas = arredondar(resumo.pecasRealocadas + unidades);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // A matéria-prima volta somada por insumo.
  //
  // Uma entrada por insumo, não uma por peça: o histórico da matéria-prima
  // registra ALTERAÇÕES DE SALDO, e cinco linhas de "voltou 2" para o mesmo
  // insumo no mesmo instante contam a mesma história pior.
  // ------------------------------------------------------------------
  for (const [insumoId, quantidade] of insumosAVoltar.entries()) {
    if (!(quantidade > 0)) continue;
    try {
      if (typeof registrarEntradaInsumo === 'function') {
        await registrarEntradaInsumo(insumoId, quantidade, usuarioId, {
          origem: 'pedido',
          pedidoId,
          nota: 'Devolvido no cancelamento do pedido'
        });
      }
      await registrarMovimento(api, {
        tipoMovimento: MOV.RETORNO_INSUMO,
        tipoItem: ITEM.INSUMO,
        itemId: insumoId,
        quantidade,
        pedidoId,
        nota: 'Devolvido no cancelamento do pedido',
        usuarioId
      }, avisos);
      resumo.insumosDevolvidos += 1;
    } catch (err) {
      avisos.push(`Falha ao devolver o insumo ${insumoId}: ${err?.message || err}`);
    }
  }

  // As reservas encerram como "retornada": a promessa de peça deste pedido não
  // vale mais, qualquer que tenha sido o destino escolhido.
  resumo.reservasRetornadas = await atualizarStatusDasReservas(
    api, pedidoId, RESERVA.RETORNADA, avisos
  );

  return { resumo, avisos };
}

/**
 * O que a tela de cancelamento precisa para montar as escolhas: por peça, de
 * onde cada unidade veio (o PISO do estágio) e a rota inteira (o TETO).
 */
async function opcoesDeEstorno(api, pedidoId) {
  const [itens, doEstoque, reservas, insumos] = await Promise.all([
    api.get('/api/pedidos_itens', { query: { pedido_id: pedidoId } }).catch(() => []),
    api.get('/api/pedido_itens_ext', { query: { id_pedido: pedidoId } }).catch(() => []),
    api.get('/api/reservas_estoque', { query: { pedido_id: pedidoId } }).catch(() => []),
    carregarInsumos(api)
  ]);

  const extPorItem = new Map();
  for (const reg of (Array.isArray(doEstoque) ? doEstoque : [])) {
    const chave = String(reg.pedido_item_id);
    if (!extPorItem.has(chave)) extPorItem.set(chave, []);
    extPorItem.get(chave).push(reg);
  }
  const reservaPorItem = new Map();
  for (const r of (Array.isArray(reservas) ? reservas : [])) {
    reservaPorItem.set(String(r.pedido_item_id), r);
  }

  const cacheRotas = new Map();
  const saida = [];

  for (const item of (Array.isArray(itens) ? itens : [])) {
    const chave = String(item.id);
    const rota = await carregarRota(api, item.produto_id, cacheRotas, insumos);
    const grupos = montarGrupos({
      extDoItem: extPorItem.get(chave) || [],
      reserva: reservaPorItem.get(chave),
      rota,
      item
    });

    saida.push({
      pedido_item_id: item.id,
      produto_id: item.produto_id,
      nome: item.nome || item.codigo || `Item ${item.id}`,
      codigo: item.codigo || '',
      quantidade: paraNumero(item.quantidade),
      rota: rota.map(p => ({
        ordem: p.ordem,
        insumo_id: p.insumo_id,
        // A rota já vem com nome e processo resolvidos — ver `carregarRota`.
        insumo_nome: p.insumo_nome,
        processo: p.processo
      })),
      grupos: grupos.map(g => ({
        origem: g.origem,
        ordem_origem: g.ordem_origem,
        lote_id: g.lote_id,
        quantidade: g.quantidade
      }))
    });
  }

  return { pedido_id: pedidoId, itens: saida };
}

module.exports = { estornarCancelamento, opcoesDeEstorno, agruparAcoes, montarGrupos };
