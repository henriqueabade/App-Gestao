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
  EVENTO,
  registrarMovimento,
  registrarEventoDoPedido,
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

/**
 * O que um pedido AINDA precisa de matéria-prima, pela composição atual.
 *
 * É a mesma conta da conversão: peça do zero paga a rota inteira; peça que
 * entrou pela metade paga só os passos DEPOIS de onde parou; peça pronta não
 * paga nada.
 *
 * Serve para calcular a devolução da realocação por DIFERENÇA — necessidade
 * antes menos necessidade depois. Somar "o material já incorporado nas peças
 * recebidas" parece equivalente e não é: se o pedido recebe mais peças do que
 * ia produzir, o excedente não substitui produção nenhuma, e somar devolveria
 * material que ninguém tinha abatido. Foi o que aconteceu no PED24, que
 * recebeu 7 peças tendo apenas 6 do zero e ganhou uma ficha técnica inteira a
 * mais de volta.
 */
async function necessidadeDoPedido(api, pedidoId, cacheRotas, insumos) {
  const [itens, ext] = await Promise.all([
    api.get('/api/pedidos_itens', { query: { pedido_id: pedidoId } }).catch(() => []),
    api.get('/api/pedido_itens_ext', { query: { id_pedido: pedidoId } }).catch(() => [])
  ]);

  const extPorItem = new Map();
  for (const reg of (Array.isArray(ext) ? ext : [])) {
    const chave = String(reg.pedido_item_id);
    if (!extPorItem.has(chave)) extPorItem.set(chave, []);
    extPorItem.get(chave).push(reg);
  }

  const necessidade = new Map();

  for (const item of (Array.isArray(itens) ? itens : [])) {
    const rota = await carregarRota(api, item.produto_id, cacheRotas, insumos);
    if (!rota.length) continue;
    const ordemFinal = rota[rota.length - 1].ordem;

    const parciais = [];
    let totalParcial = 0;
    for (const reg of (extPorItem.get(String(item.id)) || [])) {
      const passo = rota.find(p => Number(p.passo_id) === Number(reg.ultimo_insumo_id)) || null;
      const ordem = passo ? passo.ordem : ordemFinal;
      const quantidade = paraNumero(reg.quantidade);
      if (ordem < ordemFinal && quantidade > 0) {
        parciais.push({ ordem, quantidade });
        totalParcial += quantidade;
      }
    }

    const doZero = Math.max(0, arredondar(paraNumero(item.qtd_a_produzir) - totalParcial));

    for (const passo of rota) {
      const dosParciais = parciais.reduce(
        (acc, p) => acc + (passo.ordem > p.ordem ? p.quantidade : 0), 0
      );
      const unidades = doZero + dosParciais;
      const quantidade = arredondar(passo.por_unidade * unidades);
      if (!(quantidade > 0)) continue;
      necessidade.set(
        passo.insumo_id,
        arredondar((necessidade.get(passo.insumo_id) || 0) + quantidade)
      );
    }
  }

  return necessidade;
}

/** Cabeçalho do pedido, para usar o NÚMERO em vez do id nas mensagens. */
async function carregarPedidoDestino(api, pedidoId, cache) {
  const chave = String(pedidoId);
  if (cache.has(chave)) return cache.get(chave);
  const pedido = await api.get(`/api/pedidos/${pedidoId}`).catch(() => null);
  const valor = pedido && !pedido.error ? pedido : null;
  cache.set(chave, valor);
  return valor;
}

/**
 * O outro lado da realocação: o pedido de DESTINO recebe a peça.
 *
 * Sem isto a transferência ficava pela metade — o pedido de origem registrava
 * a saída e o destino não sabia de nada. Três coisas acontecem aqui:
 *
 *  1. A peça passa a constar como VINDA DO ESTOQUE no destino
 *     (`pedido_itens_ext`), no ponto da rota em que ela chegou.
 *  2. A composição do destino muda: uma unidade que ele ia produzir do zero
 *     agora chega pronta ou pela metade. É isso que faz o relatório dele
 *     mostrar a nova realidade em vez da antiga.
 *  3. Fica um movimento de entrada, cujo id volta para `realocacoes`.
 *
 * @returns {{
 *   pedidoItemId: number|null, movimentoId: number|null,
 *   tipoDestinoSubstituido: string|null, extIdSubstituido: number|null,
 *   passoIdSubstituido: number|null, loteIdSubstituido: number|null,
 *   movimentoPecaLiberada: number|null, reservaIdSubstituida: number|null
 * }}  tudo o que a auditoria precisa para reconstruir a substituição sem
 *   cruzar tabelas por data e texto.
 */
async function entregarAoPedidoDestino(api, {
  pedidoDestino,
  rotuloDestino,
  produtoId,
  unidades,
  ordemDestino,
  loteOrigem,
  rota,
  pedidoOrigem,
  rotuloOrigem,
  pedidoItemDestino,
  grupoDestino,
  movimentoOrigemId = null,
  cacheLotes,
  usuarioId
}, avisos) {
  const vazio = {
    pedidoItemId: null,
    movimentoId: null,
    tipoDestinoSubstituido: null,
    extIdSubstituido: null,
    passoIdSubstituido: null,
    loteIdSubstituido: null,
    movimentoPecaLiberada: null,
    reservaIdSubstituida: null
  };
  const itensDestino = await api
    .get('/api/pedidos_itens', { query: { pedido_id: pedidoDestino } })
    .catch(() => []);
  const lista = Array.isArray(itensDestino) ? itensDestino : [];
  // A tela diz QUAL peça do destino esta substitui. Sem isso, cai na primeira
  // do mesmo produto — certo quando há uma só, adivinhação quando há várias.
  const alvo = (pedidoItemDestino
    ? lista.find(i => String(i.id) === String(pedidoItemDestino))
    : null)
    || lista.find(i => String(i.produto_id) === String(produtoId));

  if (!alvo) {
    avisos.push(
      `O ${rotuloDestino} não tem a peça ${produtoId}: a realocação foi registrada, `
      + 'mas a composição dele não pôde ser atualizada.'
    );
    return vazio;
  }

  const passo = rota.find(p => p.ordem === ordemDestino) || null;
  const ordemFinal = rota.length ? rota[rota.length - 1].ordem : 0;

  // O QUE foi substituído lá — a pergunta que os dois movimentos de recebimento
  // não distinguem. Uma peça em 9/15 no lugar de uma PRONTA libera a pronta ao
  // estoque; a mesma peça no lugar de uma PRODUÇÃO DO ZERO não libera nada e
  // devolve a rota inteira daquela unidade à matéria-prima.
  const tipoDestinoSubstituido = !grupoDestino
    ? null
    : (String(grupoDestino.origem) === 'producao'
      ? 'producao_zero'
      : (paraNumero(grupoDestino.ordem_origem) >= ordemFinal ? 'pronta' : 'parcial'));

  const auditoria = {
    ...vazio,
    pedidoItemId: alvo.id,
    tipoDestinoSubstituido
  };

  // 1. A peça, no destino, veio do estoque.
  //
  // A tabela tem chave única em (pedido_item_id, ultimo_insumo_id): se o
  // destino já tem peças naquele mesmo ponto da rota, o INSERT falha. O certo
  // é SOMAR ao registro existente — são as mesmas peças, no mesmo estágio, do
  // mesmo item.
  const jaExistentes = await api
    .get('/api/pedido_itens_ext', { query: { pedido_item_id: alvo.id } })
    .catch(() => []);
  const mesmoPonto = (Array.isArray(jaExistentes) ? jaExistentes : [])
    .find(r => Number(r.ultimo_insumo_id) === Number(passo?.passo_id));

  if (mesmoPonto) {
    await api.put(`/api/pedido_itens_ext/${mesmoPonto.id}`, {
      quantidade: arredondar(paraNumero(mesmoPonto.quantidade) + unidades)
    }).catch(err => avisos.push(
      `Falha ao somar a peça recebida no ${rotuloDestino}: ${err?.message || err}`
    ));
  } else {
    await api.post('/api/pedido_itens_ext', {
      pedido_item_id: alvo.id,
      ultimo_insumo_id: passo?.passo_id ?? null,
      etapa_id: loteOrigem ?? null,
      quantidade: unidades,
      id_pedido: pedidoDestino
    }).catch(err => avisos.push(
      `Falha ao registrar a peça recebida no ${rotuloDestino}: ${err?.message || err}`
    ));
  }

  // 1b. A peça que o destino JÁ TINHA e foi substituída volta ao estoque.
  //
  // Quando o lugar ocupado era de uma peça vinda do estoque (e não de uma que
  // seria produzida do zero), essa peça fica livre: o destino não precisa mais
  // dela. Deixá-la presa ao pedido a perderia — ela existe fisicamente e tem
  // de estar disponível para outro uso.
  if (grupoDestino && String(grupoDestino.origem) === 'estoque') {
    const ordemLiberada = paraNumero(grupoDestino.ordem_origem);
    const passoLiberado = rota.find(p => p.ordem === ordemLiberada) || null;

    const doDestino = await api
      .get('/api/pedido_itens_ext', { query: { pedido_item_id: alvo.id } })
      .catch(() => []);
    const linha = (Array.isArray(doDestino) ? doDestino : [])
      .find(r => Number(r.ultimo_insumo_id) === Number(passoLiberado?.passo_id));

    if (linha) {
      // Quantas peças de fato saem do pedido: lido ANTES da atualização, senão
      // se lê o valor já alterado e o resultado é zero — a peça sumiria em vez
      // de voltar ao estoque.
      const liberadas = Math.min(unidades, paraNumero(linha.quantidade));
      const sobra = arredondar(Math.max(0, paraNumero(linha.quantidade) - unidades));

      // O grupo substituído, para a auditoria: qual linha de `pedido_itens_ext`
      // encolheu e em que ponto da rota ela estava.
      auditoria.extIdSubstituido = linha.id ?? null;
      auditoria.passoIdSubstituido = passoLiberado?.passo_id ?? null;

      await api.put(`/api/pedido_itens_ext/${linha.id}`, { quantidade: sobra })
        .catch(err => avisos.push(
          `Falha ao liberar a peça substituída no ${rotuloDestino}: ${err?.message || err}`
        ));

      const lote = await lotePara(api, {
        produtoId,
        passo: passoLiberado,
        lotePreferido: linha.etapa_id ?? null
      }, cacheLotes, avisos);

      if (lote && liberadas > 0) {
        const nova = arredondar(paraNumero(lote.quantidade) + liberadas);
        await api.put(`${TABELA_LOTES}/${lote.id}`, {
          quantidade: nova,
          data_hora_completa: new Date().toISOString()
        }).catch(err => avisos.push(`Falha ao devolver ao lote ${lote.id}: ${err?.message || err}`));
        lote.quantidade = nova;
        auditoria.loteIdSubstituido = lote.id ?? null;

        // O id volta para `realocacoes.movimento_id_peca_liberada`: sem ele, a
        // ligação entre a substituição e a peça que voltou ao estoque só podia
        // ser deduzida por data, pedido e texto.
        auditoria.movimentoPecaLiberada = await registrarMovimento(api, {
          tipoMovimento: MOV.RETORNO,
          tipoItem: ITEM.PECA,
          itemId: produtoId,
          quantidade: liberadas,
          pedidoId: pedidoDestino,
          pedidoItemId: alvo.id,
          loteId: lote.id,
          ultimoInsumoId: passoLiberado?.insumo_id ?? null,
          nota: `Liberada ao estoque: substituída por peça realocada do ${rotuloOrigem}`,
          usuarioId
        }, avisos);
      }
    }
  }

  // 2. A composição muda pela DIFERENÇA entre a peça que chega e a que sai.
  //
  //    Peça pela metade não mexe em `qtd_a_produzir` — o relatório já desconta
  //    as parciais ao calcular quantas sobram para o zero. E substituir uma
  //    peça PRONTA do destino por outra pronta não muda nada: ele continua
  //    usando uma peça pronta, só que outra. Somar sem descontar contava a
  //    mesma unidade duas vezes em `qtd_usar_pronta` e apagava uma unidade de
  //    `qtd_a_produzir` que continuava a ser produzida.
  const chegaPronta = ordemFinal > 0 && ordemDestino >= ordemFinal;
  const saiPronta = ordemFinal > 0
    && Boolean(grupoDestino)
    && String(grupoDestino.origem) === 'estoque'
    && paraNumero(grupoDestino.ordem_origem) >= ordemFinal;
  const deltaPronta = (chegaPronta ? unidades : 0) - (saiPronta ? unidades : 0);

  const aProduzir = paraNumero(alvo.qtd_a_produzir);
  const usarPronta = paraNumero(alvo.qtd_usar_pronta);
  if (deltaPronta !== 0) {
    await api.put(`/api/pedidos_itens/${alvo.id}`, {
      qtd_usar_pronta: arredondar(Math.max(0, usarPronta + deltaPronta)),
      qtd_a_produzir: arredondar(Math.max(0, aProduzir - deltaPronta))
    }).catch(err => avisos.push(
      `Falha ao atualizar a composição do ${rotuloDestino}: ${err?.message || err}`
    ));
  }

  // 3. A reserva do destino passa a refletir a composição NOVA.
  //
  // Subtrair as unidades recebidas da quantidade gravada não funciona: a
  // reserva do PED24 estava com 1 e recebeu 7, o que dava -6 e batia na
  // constraint `quantidade > 0`. O número certo é recalculado da composição —
  // quantas peças ainda serão produzidas do zero depois da chegada.
  const [reservas, extAtual] = await Promise.all([
    api.get('/api/reservas_estoque', { query: { pedido_id: pedidoDestino } }).catch(() => []),
    api.get('/api/pedido_itens_ext', { query: { pedido_item_id: alvo.id } }).catch(() => [])
  ]);
  const reserva = (Array.isArray(reservas) ? reservas : [])
    .find(r => String(r.pedido_item_id) === String(alvo.id));

  if (reserva) {
    // Substituir produção do zero REDUZ esta reserva: é ela que a auditoria
    // aponta como "o que foi substituído" quando não há peça a liberar.
    if (tipoDestinoSubstituido === 'producao_zero') {
      auditoria.reservaIdSubstituida = reserva.id ?? null;
    }

    let parciais = 0;
    for (const reg of (Array.isArray(extAtual) ? extAtual : [])) {
      const p = rota.find(x => Number(x.passo_id) === Number(reg.ultimo_insumo_id)) || null;
      const ordem = p ? p.ordem : ordemFinal;
      if (ordem < ordemFinal) parciais += paraNumero(reg.quantidade);
    }
    // `alvo` foi lido ANTES da atualização de `qtd_a_produzir`; a mesma
    // diferença aplicada acima entra aqui para a conta usar o valor novo.
    const aProduzirNovo = Math.max(0, arredondar(aProduzir - deltaPronta));
    const doZeroNovo = Math.max(0, arredondar(aProduzirNovo - parciais));

    // Zero não é permitido pela constraint — e faz sentido: uma reserva que
    // não vale mais está ENCERRADA, não vazia. O status diz isso; apagar a
    // quantidade apagaria o que chegou a ser prometido.
    //
    // `quantidade_original` guarda o que foi PROMETIDO. Ela é gravada na
    // criação da reserva; aqui só se preenche o que ficou para trás, porque
    // reduzir sem ter o original transforma "cinco peças, restou uma" em
    // "sempre foi uma".
    const payload = doZeroNovo > 0
      ? { quantidade: doZeroNovo }
      : { status: RESERVA.RETORNADA };
    if (reserva.quantidade_original === null || reserva.quantidade_original === undefined) {
      payload.quantidade_original = paraNumero(reserva.quantidade);
    }

    await api.put(`/api/reservas_estoque/${reserva.id}`, payload)
      .catch(err => avisos.push(`Falha ao ajustar a reserva do ${rotuloDestino}: ${err?.message || err}`));
  }

  auditoria.movimentoId = await registrarMovimento(api, {
    tipoMovimento: MOV.TRANSFERENCIA,
    tipoItem: ITEM.PECA,
    itemId: produtoId,
    quantidade: unidades,
    pedidoId: pedidoDestino,
    pedidoItemId: alvo.id,
    loteId: loteOrigem ?? null,
    ultimoInsumoId: passo?.insumo_id ?? null,
    // O par saída/entrada deixa de depender de data e texto para ser
    // reconhecido: a entrada aponta para a saída que a causou.
    movimentoOrigemId: movimentoOrigemId ?? null,
    nota: `Recebida por realocação do ${rotuloOrigem} no ponto ${ordemDestino} da rota`,
    usuarioId
  }, avisos);

  return auditoria;
}

/**
 * Uma linha em `cancelamento_destinacoes`.
 *
 * TODA decisão do cancelamento passa por aqui — inclusive as que falharam, com
 * o motivo em `falha`. É a única fonte que responde "o que foi feito com cada
 * peça deste pedido" sem cruzar movimento, lote e texto livre; e é ela que
 * distingue um descarte de um retorno ao estoque, que no razão de estoque
 * produzem movimentos parecidos.
 *
 * Como todo registro do razão, não derruba a operação: falhar em anotar não
 * pode desfazer o que já foi feito.
 */
async function registrarDestinacao(api, dados, avisos) {
  try {
    const criado = await api.post('/api/cancelamento_destinacoes', {
      pedido_id: dados.pedidoId,
      pedido_item_id: dados.pedidoItemId ?? null,
      produto_id: dados.produtoId ?? null,
      tipo_destino: dados.tipoDestino,
      quantidade: dados.quantidade,
      ordem_origem: dados.ordemOrigem ?? null,
      ultimo_insumo_id: dados.passoOrigemId ?? null,
      lote_id_origem: dados.loteOrigem ?? null,
      ordem_destino: dados.ordemDestino ?? null,
      lote_id_destino: dados.loteDestino ?? null,
      pedido_id_destino: dados.pedidoDestino ?? null,
      realocacao_id: dados.realocacaoId ?? null,
      movimento_id: dados.movimentoId ?? null,
      falha: dados.falha ?? null,
      created_at: new Date().toISOString(),
      created_by: dados.usuarioId ?? null
    });
    return criado?.id ?? criado?.[0]?.id ?? null;
  } catch (err) {
    avisos.push(`Falha ao registrar a destinação do cancelamento: ${err?.message || err}`);
    return null;
  }
}

/**
 * A substituição inteira em `realocacoes`, e o id dela de volta.
 *
 * O id importa: é ele que amarra o estorno de matéria-prima e o movimento da
 * peça liberada a ESTA substituição. Com duas realocações para o mesmo pedido
 * de destino, `pedido_id` sozinho não separa uma da outra.
 */
async function registrarRealocacao(api, dados, avisos) {
  try {
    const criado = await api.post('/api/realocacoes', {
      movimento_id_origem: dados.movimentoOrigem ?? null,
      pedido_id_destino: dados.pedidoDestino,
      pedido_item_id_destino: dados.pedidoItemDestino ?? null,
      movimento_id_destino: dados.movimentoDestino ?? null,
      quantidade: dados.quantidade,
      // De onde saiu.
      pedido_id_origem: dados.pedidoOrigem,
      pedido_item_id_origem: dados.pedidoItemOrigem ?? null,
      // Estágio = a LINHA da rota (`produtos_insumos.id`), não o id do insumo:
      // um insumo pode aparecer duas vezes na rota, o passo não.
      ultimo_insumo_id_origem: dados.passoOrigemId ?? null,
      lote_id_origem: dados.loteOrigem ?? null,
      // O que foi substituído lá.
      tipo_destino_substituido: dados.tipoDestinoSubstituido ?? null,
      pedido_itens_ext_id_substituido: dados.extIdSubstituido ?? null,
      ultimo_insumo_id_substituido: dados.passoIdSubstituido ?? null,
      lote_id_substituido: dados.loteIdSubstituido ?? null,
      movimento_id_peca_liberada: dados.movimentoPecaLiberada ?? null,
      reserva_id_substituida: dados.reservaIdSubstituida ?? null,
      created_at: new Date().toISOString(),
      created_by: dados.usuarioId ?? null
    });
    return criado?.id ?? criado?.[0]?.id ?? null;
  } catch (err) {
    avisos.push(`Falha ao registrar a realocação para o ${dados.rotuloDestino}: ${err?.message || err}`);
    return null;
  }
}

/**
 * O que mudou na necessidade do pedido, NOS DOIS SENTIDOS.
 *
 * A versão anterior só olhava para um lado — "o que deixou de ser necessário" —
 * partindo da ideia de que a realocação nunca aumenta a necessidade do destino.
 * Ela aumenta: quando a peça que chega está MENOS adiantada que a peça que ela
 * substitui, o destino passa a ter de percorrer o trecho que falta. Substituir
 * uma peça pronta 15/15 por uma parada em 10/15 obriga o destino a gastar os
 * cinco passos restantes, e esse material tem de sair do estoque como sairia
 * numa conversão. Sem este lado, o insumo ficava com saldo a mais no sistema e
 * a menos na prateleira.
 *
 * @returns {{devolver: Map, consumir: Map}} sempre com quantidades positivas —
 *   o sentido está em qual das duas listas o insumo caiu.
 */
function variacaoDeNecessidade(antes, depois) {
  const devolver = new Map();
  const consumir = new Map();

  // A união das chaves: um insumo pode aparecer só DEPOIS (o destino não
  // precisava dele e passou a precisar), e varrer apenas `antes` o perderia.
  const insumos = new Set([...antes.keys(), ...depois.keys()]);

  for (const insumoId of insumos) {
    const diferenca = arredondar((antes.get(insumoId) || 0) - (depois.get(insumoId) || 0));
    if (diferenca > 0) devolver.set(insumoId, diferenca);
    else if (diferenca < 0) consumir.set(insumoId, arredondar(-diferenca));
  }

  return { devolver, consumir };
}

/**
 * Devolve insumos ao estoque de matéria-prima e deixa o rastro nos dois lugares.
 *
 * `realocacaoId` amarra a devolução à substituição que a causou: sem ele, duas
 * realocações para o mesmo pedido de destino geram estornos que só podem ser
 * separados por horário.
 */
async function devolverInsumos(api, {
  porInsumo,
  pedidoId,
  realocacaoId = null,
  nota,
  usuarioId,
  registrarEntradaInsumo,
  resumo,
  tiposQueVoltaram
}, avisos) {
  for (const [insumoId, quantidade] of porInsumo.entries()) {
    if (!(quantidade > 0)) continue;
    try {
      if (typeof registrarEntradaInsumo === 'function') {
        await registrarEntradaInsumo(insumoId, quantidade, usuarioId, {
          origem: 'pedido',
          pedidoId,
          realocacaoId,
          nota
        });
      }
      await registrarMovimento(api, {
        tipoMovimento: MOV.RETORNO_INSUMO,
        tipoItem: ITEM.INSUMO,
        itemId: insumoId,
        quantidade,
        pedidoId,
        realocacaoId,
        nota,
        usuarioId
      }, avisos);
      resumo.insumosDevolvidos += 1;
      tiposQueVoltaram.add(Number(insumoId));
    } catch (err) {
      avisos.push(`Falha ao devolver o insumo ${insumoId}: ${err?.message || err}`);
    }
  }
}

/**
 * Tira do estoque o material que o pedido de destino PASSOU a precisar.
 *
 * É o espelho de `devolverInsumos`, para o caso em que a peça recebida está
 * menos adiantada que a que ela substituiu: o destino herda o trecho que falta
 * da rota e vai consumi-lo, exatamente como numa conversão.
 */
async function consumirInsumos(api, {
  porInsumo,
  pedidoId,
  realocacaoId = null,
  nota,
  usuarioId,
  registrarSaidaInsumo,
  resumo,
  tiposQueVoltaram
}, avisos) {
  for (const [insumoId, quantidade] of porInsumo.entries()) {
    if (!(quantidade > 0)) continue;
    try {
      if (typeof registrarSaidaInsumo === 'function') {
        await registrarSaidaInsumo(insumoId, quantidade, usuarioId, {
          origem: 'pedido',
          pedidoId,
          realocacaoId,
          nota
        });
      }
      await registrarMovimento(api, {
        tipoMovimento: MOV.CONSUMO_INSUMO,
        tipoItem: ITEM.INSUMO,
        itemId: insumoId,
        quantidade,
        pedidoId,
        realocacaoId,
        nota,
        usuarioId
      }, avisos);
      resumo.insumosConsumidos += 1;
      tiposQueVoltaram.add(Number(insumoId));
    } catch (err) {
      avisos.push(`Falha ao consumir o insumo ${insumoId}: ${err?.message || err}`);
    }
  }
}

/**
 * Confere as decisões contra o que o pedido REALMENTE tem, sem escrever nada.
 *
 * É a simulação exata do laço que executa: mesmos grupos, mesma ordem, mesmo
 * consumo. Se sobrar decisão sem grupo, o cancelamento é recusado inteiro —
 * antes, o excedente era ignorado com um aviso, e o pedido terminava cancelado
 * com metade do estorno feito. Sem transação, recusar antes de escrever é a
 * única forma de não deixar meio serviço gravado.
 */
function conferirDecisoes(preparados = []) {
  const problemas = [];

  for (const { item, decisoes, grupos } of preparados) {
    const saldos = grupos.map(g => ({ ...g }));
    const nome = item.nome || item.codigo || `peça ${item.id}`;

    for (const decisao of decisoes) {
      if (decisao.acao === 'reallocate'
        && (decisao.pedidoDestino === null || decisao.pedidoDestino === undefined)) {
        problemas.push(`A realocação de ${nome} não diz para qual pedido vai.`);
        continue;
      }

      let aTratar = decisao.quantidade;
      while (aTratar > 0) {
        const grupo = decisao.grupo
          ? saldos.find(g =>
            g.restante > 0
            && String(g.origem) === String(decisao.grupo.origem)
            && Number(g.ordem_origem) === Number(decisao.grupo.ordem_origem)
            && String(g.lote_id ?? '') === String(decisao.grupo.lote_id ?? ''))
          : saldos.find(g => g.restante > 0);

        if (!grupo) {
          problemas.push(
            `${nome}: foram destinadas ${arredondar(aTratar)} unidade(s) a mais do que o `
            + 'pedido tem. Refaça a destinação desta peça.'
          );
          break;
        }

        const unidades = Math.min(grupo.restante, aTratar);
        grupo.restante = arredondar(grupo.restante - unidades);
        aTratar = arredondar(aTratar - unidades);
      }
    }
  }

  return problemas;
}

/** "9/15 — Tag de Papel" ou "produção do zero", para o histórico. */
function rotuloDoEstagio(rota, ordem) {
  const total = rota.length;
  if (!(ordem > 0)) return 'produção do zero';
  const passo = rota.find(p => p.ordem === ordem) || null;
  return `${ordem}/${total} — ${passo?.insumo_nome || 'insumo'}`;
}

/** Como o grupo substituído no destino se chama por extenso. */
const NOME_DO_TIPO_SUBSTITUIDO = {
  pronta: 'uma peça pronta',
  parcial: 'uma peça parcial',
  producao_zero: 'uma produção do zero'
};

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
      // Realocação: qual peça do pedido de DESTINO esta substitui.
      pedidoItemDestino: acao.pedidoItemDestino ?? null,
      grupoDestino: acao.grupoDestino || null,
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
 * @param {Function} entrada.registrarSaidaInsumo  `registrarSaida`, para o caso
 *   em que a substituição faz o destino precisar de MAIS material.
 */
async function estornarCancelamento(api, {
  pedidoId,
  acoes = [],
  usuarioId = null,
  registrarEntradaInsumo = null,
  registrarSaidaInsumo = null
} = {}) {
  const avisos = [];
  // Contagens SEPARADAS por tipo de destino. Um total só não conta a história:
  // "19 devolvidas" numa operação em que 4 foram para outro pedido e 2 nunca
  // existiram é um número que não bate com nada que o usuário possa conferir.
  const resumo = {
    /** Voltaram ao estoque num ponto ESCOLHIDO (ação "retornar ao estoque"). */
    pecasAoEstoque: 0,
    /** Voltaram ao lote de ORIGEM, como estavam (ação "descartar"). */
    pecasRestauradasNoLote: 0,
    /** Seriam produzidas do zero e não viraram peça nenhuma. */
    pecasNaoDevolvidas: 0,
    /** Foram para outro pedido — não passam pelo estoque. */
    pecasRealocadas: 0,
    /** Quantos MOVIMENTOS de devolução de insumo foram gravados. */
    insumosDevolvidos: 0,
    /**
     * Quantos movimentos de CONSUMO de insumo foram gravados.
     *
     * Existe porque a realocação pode aumentar a necessidade do destino: peça
     * menos adiantada no lugar de uma mais adiantada faz o destino ter de
     * percorrer o trecho que falta.
     */
    insumosConsumidos: 0,
    /**
     * Quantos TIPOS distintos de insumo voltaram.
     *
     * O mesmo insumo pode voltar duas vezes — uma pelo pedido cancelado, outra
     * pelo pedido de destino da realocação. Contar movimentos e chamá-los de
     * "tipos" dizia "30 tipos de insumo" onde havia 15.
     */
    tiposDeInsumo: 0,
    reservasRetornadas: 0,
    /** Soma do que fisicamente entrou em lote, para conferência rápida. */
    get pecasDevolvidas() {
      return arredondar(this.pecasAoEstoque + this.pecasRestauradasNoLote);
    }
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
  const cachePedidos = new Map();
  /** insumo -> quantidade a devolver, somada e gravada uma vez só no fim. */
  const insumosAVoltar = new Map();
  /**
   * pedido de destino -> necessidade de matéria-prima AGORA.
   *
   * A devolução do destino é a DIFERENÇA entre esta foto e a necessidade depois
   * de cada substituição — nunca "o material das peças recebidas". Ver
   * `necessidadeDoPedido`. E é gravada no nome DELE, não deste pedido: quem
   * deixou de produzir foi ele.
   *
   * A foto é atualizada a cada substituição para que a devolução de cada uma
   * possa ser gravada apontando para a realocação que a causou.
   */
  const necessidadeAtual = new Map();
  /** Tipos distintos de insumo que voltaram, para o histórico não dizer 30 onde há 15. */
  const tiposQueVoltaram = new Set();
  /** Uma entrada por decisão executada, para o histórico do pedido cancelado. */
  const destinacoesDoResumo = [];
  /** pedido de destino -> o que ele recebeu, linha a linha, para o histórico dele. */
  const linhasPorDestino = new Map();

  // Número do próprio pedido, para as mensagens não citarem o id cru.
  const cabecalho = await carregarPedidoDestino(api, pedidoId, cachePedidos);
  const rotuloDoPedido = cabecalho?.numero || `#${pedidoId}`;

  // ------------------------------------------------------------------
  // LEITURA E CONFERÊNCIA ANTES DE QUALQUER ESCRITA
  //
  // Não existe transação: cada linha é uma requisição HTTP própria, e falhar no
  // meio deixa metade do estorno gravado sem ROLLBACK possível daqui. O que dá
  // para fazer é conferir tudo antes — se a decisão não fecha com o que o
  // pedido tem, nada é escrito e o pedido NÃO é cancelado.
  // ------------------------------------------------------------------
  const preparados = [];
  for (const item of listaItens) {
    const chave = String(item.id);
    const decisoes = porItem.get(chave);
    // Sem decisão para esta peça, nada é mexido. Cancelar não pode devolver
    // estoque "por padrão": é a escolha que o modal existe para capturar.
    if (!decisoes || !decisoes.length) continue;

    const rota = await carregarRota(api, Number(item.produto_id), cacheRotas, insumos);
    preparados.push({
      item,
      decisoes,
      rota,
      produtoId: Number(item.produto_id),
      ordemFinal: rota.length ? rota[rota.length - 1].ordem : 0,
      grupos: montarGrupos({
        extDoItem: extPorItem.get(chave) || [],
        reserva: reservaPorItem.get(chave),
        rota,
        item
      })
    });
  }

  const problemas = conferirDecisoes(preparados);
  if (problemas.length) {
    const erro = new Error(
      'As decisões do cancelamento não fecham com o que o pedido tem: '
      + problemas.join(' ')
    );
    erro.code = 'DECISOES_INVALIDAS';
    erro.problemas = problemas;
    throw erro;
  }

  for (const { item, decisoes, rota, produtoId, ordemFinal, grupos } of preparados) {
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

        // `conferirDecisoes` já rejeitou o excedente antes de qualquer escrita;
        // se chegou aqui sem grupo, é defesa de última hora.
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
        //
        // REALOCAÇÃO NÃO DEVOLVE AO ESTOQUE. A peça troca de dono: vai para o
        // pedido de destino. Devolvê-la ao lote E entregá-la ao outro pedido
        // colocaria a mesma unidade em dois lugares — foi o que inflou o
        // estoque em quatro peças no teste do PED22.
        // --------------------------------------------------------------
        const passoDaOrigem = rota.find(p => p.ordem === grupo.ordem_origem) || null;
        const nomeDaPeca = item.nome || item.codigo || `peça ${item.id}`;
        const destinacaoBase = {
          pedidoId,
          pedidoItemId: item.id,
          produtoId,
          quantidade: unidades,
          ordemOrigem: grupo.ordem_origem,
          passoOrigemId: passoDaOrigem?.passo_id ?? null,
          loteOrigem: grupo.lote_id ?? null,
          usuarioId
        };

        if (ordemDestino > 0 && decisao.acao !== 'reallocate') {
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

            // Descarte tem tipo PRÓPRIO. Retorno e descarte gravavam o mesmo
            // `retorno_cancelamento` e viravam a mesma coisa no razão, mesmo
            // sendo decisões diferentes. `tipoAlternativo` cobre quem ainda não
            // rodou sql/novascolunas5.sql: o valor novo do enum ainda não
            // existe lá, e perder o movimento seria pior que gravá-lo com o
            // tipo antigo.
            const ehDescarte = decisao.acao === 'discard';
            const movimentoId = await registrarMovimento(api, {
              tipoMovimento: ehDescarte ? MOV.DESCARTE : MOV.RETORNO,
              tipoAlternativo: ehDescarte ? MOV.RETORNO : null,
              tipoItem: ITEM.PECA,
              itemId: produtoId,
              quantidade: unidades,
              pedidoId,
              pedidoItemId: item.id,
              loteId: lote.id,
              ultimoInsumoId: passoDestino?.insumo_id ?? null,
              nota: ehDescarte
                ? `Cancelamento: descartada e restaurada no lote de origem (ponto ${ordemDestino} da rota)`
                : `Cancelamento: devolvida ao estoque no ponto ${ordemDestino} da rota`,
              usuarioId
            }, avisos);

            await registrarDestinacao(api, {
              ...destinacaoBase,
              tipoDestino: ehDescarte ? 'descarte_restaura_lote' : 'retorno_estoque',
              ordemDestino,
              loteDestino: lote.id ?? null,
              movimentoId
            }, avisos);

            // "Descartar" devolve ao lote de ORIGEM; "retornar ao estoque"
            // devolve no ponto escolhido. São coisas diferentes no histórico.
            if (ehDescarte) {
              resumo.pecasRestauradasNoLote = arredondar(resumo.pecasRestauradasNoLote + unidades);
              destinacoesDoResumo.push({
                unidades,
                texto: `${nomeDaPeca} descartada(s) e restaurada(s) no lote de origem `
                  + `(${rotuloDoEstagio(rota, ordemDestino)})`
              });
            } else {
              resumo.pecasAoEstoque = arredondar(resumo.pecasAoEstoque + unidades);
              const veioDe = rotuloDoEstagio(rota, grupo.ordem_origem);
              const foiPara = rotuloDoEstagio(rota, ordemDestino);
              destinacoesDoResumo.push({
                unidades,
                texto: `${nomeDaPeca} devolvida(s) ao estoque em ${foiPara}`
                  + (veioDe === foiPara ? '' : ` (estavam em ${veioDe})`)
              });
            }
          } else {
            // Sem lote, a peça não entrou em lugar nenhum. Um estorno que não
            // aconteceu tem de deixar rastro: sem transação, é esta linha que
            // diz depois o que precisa ser conferido à mão.
            const motivo = `Não foi possível achar ou criar o lote do produto ${produtoId} `
              + `no ponto ${ordemDestino} da rota: a peça não voltou ao estoque.`;
            avisos.push(motivo);
            await registrarDestinacao(api, {
              ...destinacaoBase,
              tipoDestino: decisao.acao === 'discard' ? 'descarte_restaura_lote' : 'retorno_estoque',
              ordemDestino,
              falha: motivo
            }, avisos);
          }
        } else if (decisao.acao !== 'reallocate') {
          resumo.pecasNaoDevolvidas = arredondar(resumo.pecasNaoDevolvidas + unidades);
          await registrarDestinacao(api, {
            ...destinacaoBase,
            tipoDestino: 'nao_retorna_produto',
            ordemDestino: 0
          }, avisos);
          destinacoesDoResumo.push({
            unidades,
            texto: `${nomeDaPeca} não retornaram como produto (seriam produzidas do zero); `
              + 'todo o material voltou à matéria-prima'
          });
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
          const destino = await carregarPedidoDestino(api, decisao.pedidoDestino, cachePedidos);
          const rotuloDestino = destino?.numero || `#${decisao.pedidoDestino}`;

          // Necessidade do destino ANTES desta substituição. A devolução dele é
          // a diferença entre esta foto e a de depois — ver `necessidadeDoPedido`.
          //
          // A foto é tirada POR SUBSTITUIÇÃO, não uma vez por pedido: com duas
          // realocações para o mesmo destino, uma única diferença no fim diria
          // o total certo e não diria de qual das duas ele veio. As diferenças
          // se encaixam (o "depois" de uma é o "antes" da seguinte), então o
          // total continua exatamente o mesmo.
          if (!necessidadeAtual.has(decisao.pedidoDestino)) {
            necessidadeAtual.set(
              decisao.pedidoDestino,
              await necessidadeDoPedido(api, decisao.pedidoDestino, cacheRotas, insumos)
            );
          }
          const antes = necessidadeAtual.get(decisao.pedidoDestino);

          const movimentoId = await registrarMovimento(api, {
            tipoMovimento: MOV.TRANSFERENCIA,
            tipoItem: ITEM.PECA,
            itemId: produtoId,
            quantidade: unidades,
            pedidoId,
            pedidoItemId: item.id,
            loteId: grupo.lote_id ?? null,
            ultimoInsumoId: rota.find(p => p.ordem === ordemDestino)?.insumo_id ?? null,
            // Para onde foi, na própria linha do movimento.
            transferParaPedidoId: decisao.pedidoDestino,
            // O NÚMERO do pedido, não o id: "realocada para o pedido 63" não diz
            // nada a quem conhece o pedido como PED17.
            nota: `Realocada para o ${rotuloDestino} no ponto ${ordemDestino} da rota`,
            usuarioId
          }, avisos);

          const recebido = await entregarAoPedidoDestino(api, {
            pedidoDestino: decisao.pedidoDestino,
            rotuloDestino,
            produtoId,
            unidades,
            ordemDestino,
            loteOrigem: grupo.lote_id ?? null,
            rota,
            pedidoOrigem: pedidoId,
            rotuloOrigem: rotuloDoPedido,
            pedidoItemDestino: decisao.pedidoItemDestino,
            grupoDestino: decisao.grupoDestino,
            movimentoOrigemId: movimentoId,
            cacheLotes,
            usuarioId
          }, avisos);

          const realocacaoId = await registrarRealocacao(api, {
            movimentoOrigem: movimentoId,
            pedidoDestino: decisao.pedidoDestino,
            rotuloDestino,
            // Sem estes dois, o vínculo fica pela metade: dá para ver que saiu,
            // não para onde entrou nem em qual peça do outro pedido.
            pedidoItemDestino: recebido?.pedidoItemId ?? null,
            movimentoDestino: recebido?.movimentoId ?? null,
            quantidade: unidades,
            pedidoOrigem: pedidoId,
            pedidoItemOrigem: item.id,
            passoOrigemId: passoDaOrigem?.passo_id ?? null,
            loteOrigem: grupo.lote_id ?? null,
            tipoDestinoSubstituido: recebido?.tipoDestinoSubstituido ?? null,
            extIdSubstituido: recebido?.extIdSubstituido ?? null,
            passoIdSubstituido: recebido?.passoIdSubstituido ?? null,
            loteIdSubstituido: recebido?.loteIdSubstituido ?? null,
            movimentoPecaLiberada: recebido?.movimentoPecaLiberada ?? null,
            reservaIdSubstituida: recebido?.reservaIdSubstituida ?? null,
            usuarioId
          }, avisos);

          await registrarDestinacao(api, {
            ...destinacaoBase,
            tipoDestino: 'realocacao',
            ordemDestino,
            pedidoDestino: decisao.pedidoDestino,
            realocacaoId,
            movimentoId,
            // A peça saiu daqui de qualquer jeito; se o outro lado não pôde ser
            // atualizado, é isto que aponta onde conferir.
            falha: recebido?.pedidoItemId
              ? null
              : `O ${rotuloDestino} não recebeu a peça na composição dele.`
          }, avisos);

          // A matéria-prima que o destino deixou de precisar — ou que passou a
          // precisar — POR CAUSA DESTA substituição, já ligada a ela.
          const depois = await necessidadeDoPedido(api, decisao.pedidoDestino, cacheRotas, insumos);
          const substituido = NOME_DO_TIPO_SUBSTITUIDO[recebido?.tipoDestinoSubstituido] || 'uma peça';
          const variacao = variacaoDeNecessidade(antes, depois);

          await devolverInsumos(api, {
            porInsumo: variacao.devolver,
            pedidoId: decisao.pedidoDestino,
            realocacaoId,
            nota: `Devolvido: substituição de ${substituido} por peça recebida do ${rotuloDoPedido}`,
            usuarioId,
            registrarEntradaInsumo,
            resumo,
            tiposQueVoltaram
          }, avisos);

          // A peça que chegou pode estar MENOS adiantada que a que saiu: aí o
          // destino herda o trecho que falta e tem de gastá-lo.
          await consumirInsumos(api, {
            porInsumo: variacao.consumir,
            pedidoId: decisao.pedidoDestino,
            realocacaoId,
            nota: `Consumido: a peça recebida do ${rotuloDoPedido} está menos adiantada que `
              + `${substituido} e o restante da rota ainda será produzido aqui`,
            usuarioId,
            registrarSaidaInsumo,
            resumo,
            tiposQueVoltaram
          }, avisos);

          necessidadeAtual.set(decisao.pedidoDestino, depois);

          resumo.pecasRealocadas = arredondar(resumo.pecasRealocadas + unidades);

          const estagioEnviado = rotuloDoEstagio(rota, ordemDestino);
          const substituiu = NOME_DO_TIPO_SUBSTITUIDO[recebido?.tipoDestinoSubstituido]
            || 'uma peça do pedido de destino';

          destinacoesDoResumo.push({
            unidades,
            texto: `${nomeDaPeca} em ${estagioEnviado} realocada(s) para o ${rotuloDestino}, `
              + `substituindo ${substituiu}`
          });

          if (!linhasPorDestino.has(decisao.pedidoDestino)) {
            linhasPorDestino.set(decisao.pedidoDestino, { rotulo: rotuloDestino, linhas: [] });
          }
          linhasPorDestino.get(decisao.pedidoDestino).linhas.push({
            unidades,
            pecaNome: nomeDaPeca,
            estagioEnviado,
            substituiu: recebido?.tipoDestinoSubstituido ?? null,
            liberou: Boolean(recebido?.movimentoPecaLiberada)
          });
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
  await devolverInsumos(api, {
    porInsumo: insumosAVoltar,
    pedidoId,
    nota: 'Devolvido no cancelamento do pedido',
    usuarioId,
    registrarEntradaInsumo,
    resumo,
    tiposQueVoltaram
  }, avisos);

  // ------------------------------------------------------------------
  // O histórico de cada pedido de DESTINO
  //
  // "Recebeu peça(s) por realocação do PEDxx" não permite auditar nada: não diz
  // quantas, em que estágio chegaram, o que substituíram, nem se alguma peça de
  // lá foi liberada. Cada substituição vira uma linha.
  //
  // A matéria-prima destes pedidos já foi devolvida acima, uma devolução por
  // substituição, ligada à realocação que a causou.
  // ------------------------------------------------------------------
  for (const [pedidoDestino, { rotulo, linhas }] of linhasPorDestino.entries()) {
    const total = arredondar(linhas.reduce((soma, l) => soma + l.unidades, 0));
    const detalhes = linhas.map(l => {
      const substituiu = NOME_DO_TIPO_SUBSTITUIDO[l.substituiu] || 'uma peça do pedido';
      const liberada = l.liberou ? ', liberada ao lote de origem' : '';
      return `- ${arredondar(l.unidades)} × ${l.pecaNome} em ${l.estagioEnviado} `
        + `substituindo ${substituiu}${liberada};`;
    });

    await registrarEventoDoPedido(api, {
      pedidoId: pedidoDestino,
      tipoEvento: EVENTO.REALOCACAO,
      descricao: `${rotulo} recebeu ${total} peça(s) do ${rotuloDoPedido}:\n`
        + `${detalhes.join('\n')}\n`
        + 'Os insumos que deixaram de ser necessários foram devolvidos à matéria-prima.',
      usuarioId
    }, avisos);
  }

  // As reservas encerram como "retornada": a promessa de peça deste pedido não
  // vale mais, qualquer que tenha sido o destino escolhido.
  resumo.reservasRetornadas = await atualizarStatusDasReservas(
    api, pedidoId, RESERVA.RETORNADA, avisos
  );

  resumo.tiposDeInsumo = tiposQueVoltaram.size;

  // O que aconteceu com cada peça, em português, para o histórico do pedido
  // cancelado. Decisões iguais são somadas numa linha só — quatro peças para o
  // mesmo destino no mesmo estágio são "4 × ...", não quatro linhas iguais.
  const porTexto = new Map();
  for (const destinacao of destinacoesDoResumo) {
    const atual = porTexto.get(destinacao.texto) || 0;
    porTexto.set(destinacao.texto, arredondar(atual + destinacao.unidades));
  }
  resumo.detalhes = Array.from(porTexto.entries())
    .map(([texto, unidades]) => `${unidades} × ${texto}`);

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
