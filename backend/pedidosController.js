const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, exigirSupAdmin } = require('./permissionsController');
const { excluirPedidoEmCascata } = require('./exclusaoEmCascata');
const descontos = require('./descontos');
const { getMaxId, inserirLinhaComId } = require('./idsSequenciais');
const { estornarCancelamento, opcoesDeEstorno } = require('./cancelamentoEstorno');
const { registrarEntrada, registrarSaida } = require('./materiaPrima');
const {
  alteracoesRecebidas,
  reconstruirSelecaoOriginal,
  destinacoesDoCancelamento
} = require('./relatorioPecas');
const {
  RESERVA,
  EVENTO,
  registrarEventoDoPedido,
  atualizarStatusDasReservas
} = require('./estoqueLedger');

/** Id do usuário da requisição, lido do JWT (mesmo critério de orcamentosController). */
function idDoUsuarioDaRequisicao(req) {
  try {
    const bruto = String(req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const parte = bruto.split('.')[1];
    if (!parte) return null;
    const json = Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const id = JSON.parse(json).id ?? null;
    return Number.isFinite(Number(id)) ? Number(id) : null;
  } catch (_) {
    return null;
  }
}

const router = express.Router();

// Lista pedidos com filtro opcional por cliente
router.get('/', exigirPermissao('ped.view'), async (req, res) => {
  const { clienteId } = req.query;
  try {
    const api = createApiClient(req);
    const pedidos = await api.get('/api/pedidos', {
      query: clienteId ? { cliente_id: clienteId, order: 'id.desc' } : { order: 'id.desc' }
    });

    res.json(Array.isArray(pedidos) ? pedidos : []);
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar pedidos' });
  }
});

// Atualiza o status de um pedido
// A permissão depende do destino: Enviado -> despachar, Entregue -> entregue,
// qualquer outro -> confirmar.
function permissaoDeStatus(req) {
  const destino = String(req.body?.status || '').trim().toLowerCase();
  // O CANCELAMENTO tambem chega por aqui (o modal envia status: 'Cancelado').
  // Sem esta linha, quem tinha apenas "confirmar pedido" conseguiria cancelar e
  // disparar a realocacao de estoque.
  if (destino === 'cancelado') return 'ped.cancel';
  if (destino === 'enviado') return 'ped.status.ship';
  if (destino === 'entregue') return 'ped.status.deliver';
  return 'ped.status.confirm';
}

/**
 * Cada status tem a SUA coluna de data. O cancelamento estava de fora: o pedido
 * virava "Cancelado" e `data_cancelamento` continuava nula, então o balão que
 * aparece ao passar o mouse sobre o status só sabia dizer quando a produção
 * tinha começado — nunca quando o pedido foi cancelado.
 */
function payloadDeStatus(status, agora = new Date()) {
  const payload = { situacao: status };
  const quando = agora.toISOString();
  if (status === 'Enviado') {
    payload.data_envio = quando;
  } else if (status === 'Entregue') {
    payload.data_entrega = quando;
  } else if (status === 'Cancelado') {
    payload.data_cancelamento = quando;
  }
  return payload;
}

router.put('/:id/status', exigirPermissao(permissaoDeStatus), async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  try {
    const api = createApiClient(req);

    // Cancelar um pedido JÁ cancelado devolveria o estoque uma segunda vez:
    // as peças entrariam nos lotes de novo e os insumos voltariam em dobro,
    // criando material que não existe. A trava é aqui, no backend, porque
    // esconder o botão não impede uma segunda aba nem um duplo envio.
    if (status === 'Cancelado') {
      const atual = await api.get(`/api/pedidos/${id}`).catch(() => null);
      if (String(atual?.situacao || '').trim().toLowerCase() === 'cancelado') {
        return res.status(409).json({
          error: 'Este pedido já está cancelado.',
          code: 'JA_CANCELADO'
        });
      }
    }

    const avisos = [];
    let estorno = null;

    // ------------------------------------------------------------------
    // O ESTORNO VEM ANTES DE MARCAR O PEDIDO COMO CANCELADO.
    //
    // Não existe transação: cada linha do estorno é uma requisição própria ao
    // CRUD da API, e não há BEGIN/COMMIT cobrindo o conjunto. Marcar o pedido
    // primeiro significava que uma recusa (decisão que não fecha com o que o
    // pedido tem) deixava o pedido cancelado e o estoque intacto.
    //
    // Invertida a ordem, o caso previsível fica coberto: `estornarCancelamento`
    // confere tudo ANTES de escrever e recusa sem gravar nada — e o pedido
    // continua ativo, do jeito que estava.
    //
    // O que continua sem solução daqui é a falha NO MEIO da gravação: sem
    // transação não há ROLLBACK. O que se faz nesse caso é registrar (as falhas
    // ficam em `cancelamento_destinacoes.falha` e nos avisos) e nunca dizer que
    // deu certo.
    // ------------------------------------------------------------------
    if (status === 'Cancelado') {
      try {
        const resultado = await estornarCancelamento(api, {
          pedidoId: id,
          acoes: req.body?.acoes,
          usuarioId: idDoUsuarioDaRequisicao(req),
          registrarEntradaInsumo: registrarEntrada,
          // A realocação pode AUMENTAR a necessidade do destino: peça menos
          // adiantada no lugar de uma mais adiantada. Esse material sai do
          // estoque, e sem isto o saldo ficava alto no sistema e baixo na
          // prateleira.
          registrarSaidaInsumo: registrarSaida
        });
        estorno = resultado.resumo;
        avisos.push(...resultado.avisos);
      } catch (err) {
        console.error('Falha ao estornar o cancelamento:', err);
        // Decisão que não fecha com o pedido: nada foi gravado e o pedido NÃO é
        // cancelado. É erro do usuário (ou de uma tela desatualizada), com
        // conserto óbvio — refazer a destinação.
        if (err?.code === 'DECISOES_INVALIDAS') {
          return res.status(422).json({
            error: 'As decisões do cancelamento não fecham com o que o pedido tem.',
            code: err.code,
            problemas: err.problemas || [],
            detalhe: err.message
          });
        }

        // Uma etapa que MOVE PEÇA falhou no meio. Marcar o pedido como
        // cancelado aqui seria declarar concluído um estorno que não terminou —
        // e foi assim que uma peça acabou liberada ao estoque e ainda contada
        // dentro do pedido de destino. O pedido continua ativo, a falha está
        // registrada em `cancelamento_destinacoes` e o que já foi gravado vem
        // na resposta para ser conferido.
        if (err?.code === 'ESTORNO_INCONSISTENTE') {
          return res.status(409).json({
            error: 'O estorno foi interrompido: o pedido NÃO foi cancelado.',
            code: err.code,
            detalhe: err.message,
            avisos: err.avisos || []
          });
        }
        // Qualquer outra falha: o estorno pode ter gravado parte. Não cancelar
        // seria pior — as peças já saíram dos lotes. Cancela, e o aviso diz o
        // que conferir.
        avisos.push(`Falha ao estornar o estoque: ${err?.message || err}`);
      }
    }

    const payload = payloadDeStatus(status);
    await api.put(`/api/pedidos/${id}`, payload);

    // ------------------------------------------------------------------
    // Razão: o status do pedido move as reservas de produção.
    //
    // Enviado/Entregue = as peças reservadas foram produzidas e saíram, então a
    // reserva encerra como "finalizado". Cancelado NÃO é tratado aqui: devolver
    // peça ao estoque é operação própria, com decisão do usuário, e fazê-la de
    // carona numa troca de status esconderia o que aconteceu.
    // ------------------------------------------------------------------
    if (status === 'Enviado' || status === 'Entregue') {
      await atualizarStatusDasReservas(api, id, RESERVA.FINALIZADO, avisos);
    }
    const eventoPorStatus = {
      Enviado: EVENTO.ABATIMENTO,
      Entregue: EVENTO.EDICAO,
      Cancelado: EVENTO.CANCELAMENTO
    };
    if (eventoPorStatus[status]) {
      await registrarEventoDoPedido(api, {
        pedidoId: id,
        tipoEvento: eventoPorStatus[status],
        // No cancelamento o evento diz o que voltou: sem isso o histórico
        // registra "Cancelado" e não explica o que aconteceu com o estoque.
        // Cada destino contado à parte, e `?? 0` em todos: um campo renomeado
        // fazia o histórico gravar "undefined descartada(s)" — texto que não
        // dá para auditar nem corrigir depois.
        descricao: estorno
          ? 'Pedido cancelado. '
            + `${estorno.pecasAoEstoque ?? 0} peça(s) retornaram ao estoque, `
            + `${estorno.pecasRestauradasNoLote ?? 0} descartada(s) com restauração do lote de origem, `
            + `${estorno.pecasNaoDevolvidas ?? 0} não retornaram como produto, `
            + `${estorno.pecasRealocadas ?? 0} realocada(s) para outro pedido, `
            // Tipos DISTINTOS e movimentos são coisas diferentes: o mesmo
            // insumo pode voltar duas vezes (pelo pedido e pelo destino da
            // realocação), e chamar 30 movimentos de "30 tipos" era falso.
            + `${estorno.tiposDeInsumo ?? 0} tipo(s) de insumo movimentado(s) `
            + `em ${estorno.insumosDevolvidos ?? 0} devolução(ões)`
            // A realocação também pode CONSUMIR: peça menos adiantada no lugar
            // de uma mais adiantada faz o destino ter de terminar o resto.
            + ((estorno.insumosConsumidos ?? 0) > 0
              ? ` e ${estorno.insumosConsumidos} consumo(s) no pedido de destino.`
              : '.')
            // E o que foi feito com CADA peça. O parágrafo acima diz os totais;
            // sem o detalhe, o histórico não permite conferir de onde eles
            // vieram — que é justamente o que uma auditoria precisa.
            + ((estorno.detalhes || []).length
              ? `\nDestinação de cada peça:\n- ${estorno.detalhes.join('\n- ')}`
              : '')
          : `Pedido marcado como ${status}.`,
        usuarioId: idDoUsuarioDaRequisicao(req)
      }, avisos);
    }

    res.json({ success: true, avisos, estorno });
  } catch (err) {
    console.error('Erro ao atualizar status do pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar status do pedido' });
  }
}); // <--- Faltava este '});' para fechar a rota e a função async

// Obtém um pedido específico com itens e parcelas
/**
 * PUT /pedidos/:id/pagamento — repactua a condição de pagamento do pedido.
 *
 * Escopo estreito de propósito: mexe na CONDIÇÃO (à vista / a prazo), na forma
 * de pagamento, nos prazos e no que decorre disso — os descontos e o total.
 * Não toca em peças, quantidades nem preços unitários.
 *
 * Duas coisas que o código precisa preservar e que não são evidentes:
 *
 * 1. `pedidos_itens` é ATUALIZADO no lugar, nunca apagado e recriado. Os ids
 *    dessas linhas são referenciados por movimentos de estoque, reservas e
 *    lotes; recriá-las (como o PUT de orçamento faz, onde nada aponta para
 *    elas) romperia a produção já em andamento.
 *
 * 2. Só pedidos em "Produção". Depois de enviado ou entregue o combinado com
 *    o cliente virou fato; e um pedido cancelado teve o estoque estornado com
 *    base nos números que ele tinha.
 */
router.put('/:id/pagamento', exigirPermissao('ped.payment.edit'), async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  const condicao = body.condicao === 'prazo' ? 'prazo' : 'vista';
  const formaPagamento = String(body.forma_pagamento || '').trim();
  const parcelasDetalhes = Array.isArray(body.parcelas_detalhes) ? body.parcelas_detalhes : [];
  const prazo = String(body.prazo || '').trim();

  if (!formaPagamento) {
    return res.status(400).json({ error: 'Forma de pagamento é obrigatória.' });
  }
  if (!prazo) {
    return res.status(400).json({ error: 'Informe o prazo de pagamento.' });
  }
  if (!parcelasDetalhes.length) {
    return res.status(400).json({ error: 'Informe ao menos uma parcela.' });
  }

  try {
    const api = createApiClient(req);

    const pedido = await api.get(`/api/pedidos/${id}`).catch(() => null);
    if (!pedido || pedido.error === 'Not found') {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    // A trava real. Esconder o ícone na tabela é conveniência de interface;
    // o que impede uma segunda aba ou um envio repetido é esta checagem.
    if (String(pedido.situacao || '').trim() !== 'Produção') {
      return res.status(409).json({
        error: 'Só é possível alterar o pagamento de pedidos em produção.',
        code: 'SITUACAO_NAO_PERMITE'
      });
    }

    const itens = await api.get('/api/pedidos_itens', { query: { pedido_id: id } }).catch(() => []);
    const listaItens = Array.isArray(itens) ? itens : [];
    if (!listaItens.length) {
      return res.status(409).json({ error: 'Pedido sem itens: nada a recalcular.' });
    }

    // A condição anterior é deduzida das parcelas gravadas — é o mesmo
    // critério que a tabela usa para exibir "À vista" ou "3x".
    const condicaoAnterior = Number(pedido.parcelas) > 1 ? 'prazo' : 'vista';

    // O desconto ESPECIAL de cada linha sobrevive à troca; o de pagamento é
    // recalculado pela nova condição. Ver backend/descontos.js.
    const linhas = listaItens.map(item => {
      const totalPrc = descontos.descontoAoTrocarCondicao(item, condicaoAnterior, condicao);
      const { pagamento, especial } = descontos.repartirDesconto(totalPrc, item.quantidade, condicao);
      return {
        id: item.id,
        quantidade: Number(item.quantidade) || 0,
        ...descontos.calcularItem({
          valorUnitario: item.valor_unitario,
          quantidade: item.quantidade,
          pctPagamento: pagamento,
          pctEspecial: especial
        })
      };
    });

    const totais = descontos.totaisDoDocumento(linhas);

    // As parcelas chegam da tela com o total antigo se o desconto mudou a
    // conta. Recusar é melhor que gravar um parcelamento que não soma o
    // pedido: o financeiro cobraria a diferença de ninguém.
    const somaParcelas = parcelasDetalhes.reduce((s, p) => s + (Number(p?.valor) || 0), 0);
    if (Math.abs(somaParcelas - totais.valor_final) > 0.02) {
      return res.status(422).json({
        error: 'A soma das parcelas não fecha com o total do pedido.',
        code: 'PARCELAS_NAO_FECHAM',
        detalhe: { soma_parcelas: somaParcelas, valor_final: totais.valor_final }
      });
    }

    await api.put(`/api/pedidos/${id}`, {
      parcelas: condicao === 'prazo' ? parcelasDetalhes.length : 1,
      tipo_parcela: condicao === 'prazo' ? (body.tipo_parcela || 'igual') : 'a vista',
      forma_pagamento: formaPagamento,
      prazo,
      desconto_pagamento: totais.desconto_pagamento,
      desconto_especial: totais.desconto_especial,
      desconto_total: totais.desconto_total,
      valor_final: totais.valor_final
    });

    // Atualização no lugar — ver o comentário 1 no cabeçalho da rota.
    for (const linha of linhas) {
      const { id: itemId, quantidade: _q, ...valores } = linha;
      await api.put(`/api/pedidos_itens/${itemId}`, valores);
    }

    // Parcelas, ao contrário dos itens, não são referenciadas por nada: podem
    // ser trocadas em bloco, que é o único jeito de refletir "de 3x para à
    // vista" sem sobrar linha antiga.
    const parcelasExistentes = await api
      .get('/api/pedido_parcelas', { query: { pedido_id: id } })
      .catch(() => []);
    for (const parcela of Array.isArray(parcelasExistentes) ? parcelasExistentes : []) {
      if (parcela?.id) await api.delete(`/api/pedido_parcelas/${parcela.id}`);
    }

    let proximoId = (await getMaxId(api, 'pedido_parcelas')) + 1;
    for (let i = 0; i < parcelasDetalhes.length; i++) {
      const { id: _pid, pedido_id: _ppid, ...resto } = parcelasDetalhes[i] || {};
      const usado = await inserirLinhaComId(
        api,
        'pedido_parcelas',
        { ...resto, pedido_id: Number(id), numero_parcela: resto.numero_parcela || i + 1 },
        proximoId
      );
      proximoId = usado + 1;
    }

    res.json({
      ok: true,
      valor_final: totais.valor_final,
      desconto_total: totais.desconto_total,
      parcelas: condicao === 'prazo' ? parcelasDetalhes.length : 1
    });
  } catch (err) {
    console.error('Erro ao alterar pagamento do pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao alterar o pagamento do pedido' });
  }
});

router.get('/:id', exigirPermissao('ped.view.details'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const pedido = await api.get(`/api/pedidos/${id}`);
    if (!pedido || pedido.error === 'Not found') {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    const [itens, parcelas] = await Promise.all([
      api.get('/api/pedidos_itens', { query: { pedido_id: id } }),
      api.get('/api/pedido_parcelas', { query: { pedido_id: id, order: 'numero_parcela' } })
    ]);
    pedido.itens = itens || [];
    pedido.parcelas_detalhes = parcelas || [];
    res.json(pedido);
  } catch (err) {
    console.error('Erro ao buscar pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar pedido' });
  }
});
/**
 * DELETE /pedidos/:id  — exclusão restrita ao Sup Admin.
 *
 * A versão anterior apagava só itens e parcelas, e batia em
 * `estoque_movimentos_pedido_id_fkey`: um pedido convertido espalha linhas por
 * oito tabelas. Agora a limpeza é feita por `exclusaoEmCascata`, que sabe a
 * ordem e — mais importante — tem uma lista branca do que pode apagar.
 *
 * Duas travas, não uma: a permissão `ped.delete` (que só o modelo do Sup Admin
 * recebe) E a checagem do perfil. Numa operação irreversível, depender só da
 * configuração de um modelo de permissões é frágil demais.
 */
router.delete('/:id', exigirPermissao('ped.delete'), exigirSupAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const { removidos, avisos } = await excluirPedidoEmCascata(api, id);
    res.json({ success: true, removidos, avisos });
  } catch (err) {
    console.error('Erro ao excluir pedido:', err);
    res.status(err.status || 500).json({
      error: 'Erro ao excluir pedido',
      // O motivo real do banco vai junto: sem ele, restava "500" na tela e a
      // causa (qual chave estrangeira prendeu) ficava só no log.
      detalhe: err?.body?.detalhe || err?.message || null
    });
  }
});

/**
 * GET /pedidos/:id/relatorio-producao
 *
 * Devolve a FOTO congelada na conversão, agrupada por processo — uma folha por
 * processo no relatório. Nada é recalculado aqui de propósito: o papel que vai
 * para a produção tem de dizer o que foi decidido quando o pedido foi criado,
 * não o que o estoque parece agora.
 */
/**
 * Toda a matéria-prima, indexada por id, numa requisição só.
 *
 * A tabela tem algumas centenas de linhas; buscar uma por vez (`/materia_prima/:id`
 * dentro de um laço) custava dezenas de idas à API por relatório e era a causa
 * principal da lentidão. Uma leitura e um índice em memória resolvem.
 */
async function carregarMateriaPrima(api) {
  const lista = await api.get('/api/materia_prima').catch(() => []);
  const porId = new Map();
  for (const materia of (Array.isArray(lista) ? lista : [])) {
    if (materia?.id !== undefined && materia?.id !== null) porId.set(Number(materia.id), materia);
  }
  return porId;
}

router.get('/:id/relatorio-producao', exigirPermissao('ped.report'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);

    const [pedido, itens, faltantes] = await Promise.all([
      api.get(`/api/pedidos/${id}`),
      api.get('/api/pedidos_itens', { query: { pedido_id: id } }).catch(() => []),
      api.get('/api/pedidos_itens_faltantes', { query: { pedido_id: id } }).catch(() => [])
    ]);

    // De qual ponto da rota cada peça saiu do estoque. É isto que diferencia
    // uma peça que precisa ser feita do zero de uma que já está meio pronta —
    // e, portanto, o que o relatório deve pedir de material.
    //
    // UMA consulta para o pedido inteiro, agrupada aqui. Antes era uma por
    // peça: um pedido com dez itens fazia dez idas à API só para isto, e o
    // relatório demorava por causa disso.
    const extPorItem = new Map();
    const extDoPedido = await api
      .get('/api/pedido_itens_ext', { query: { id_pedido: id } })
      .catch(() => []);
    for (const registro of (Array.isArray(extDoPedido) ? extDoPedido : [])) {
      const chave = Number(registro.pedido_item_id);
      if (!extPorItem.has(chave)) extPorItem.set(chave, []);
      extPorItem.get(chave).push(registro);
    }

    if (!pedido || pedido.error === 'Not found') {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const listaItens = Array.isArray(itens) ? itens : [];
    const listaFaltantes = Array.isArray(faltantes) ? faltantes : [];

    // Nome da peça por id, para o relatório mostrar "Peça x" com o nome real.
    const nomePorItem = new Map(listaItens.map(i => [Number(i.id), i.nome || i.codigo || `Item ${i.id}`]));

    // ------------------------------------------------------------------
    // O QUE CADA PEÇA CONSOME (a tabela de cima do relatório).
    //
    // Vem da rota do produto × `qtd_a_produzir` — e `qtd_a_produzir` está
    // congelado em pedidos_itens desde a conversão, então a quantidade não muda
    // depois. Só as peças PRODUZIDAS entram: peça tirada pronta do estoque não
    // vai ser fabricada, e listá-la mandaria a produção refazer o que já existe.
    // ------------------------------------------------------------------
    // Toda a matéria-prima de uma vez. Buscar insumo a insumo (`/materia_prima/:id`
    // dentro do laço da rota) fazia uma requisição por passo de cada produto —
    // 15 passos × 3 produtos = 45 idas à API para montar uma folha.
    const materiaPorId = await carregarMateriaPrima(api);

    const rotaCache = new Map();
    async function rotaDoProduto(produtoId) {
      const chave = Number(produtoId);
      if (rotaCache.has(chave)) return rotaCache.get(chave);
      const bruta = await api.get('/api/produtos_insumos', { query: { produto_id: chave } }).catch(() => []);
      const lista = Array.isArray(bruta) ? bruta : [];
      const rota = [];
      for (const passo of lista) {
        const materia = materiaPorId.get(Number(passo.insumo_id)) || null;
        rota.push({
          insumo_id: Number(passo.insumo_id),
          // Id da LINHA da rota — é ele que `pedido_itens_ext.ultimo_insumo_id`
          // guarda (a coluna tem FK para produtos_insumos, não para
          // materia_prima). Sem ele não dá para saber onde a peça parou.
          passo_id: Number(passo.id),
          por_unidade: Number(passo.quantidade) || 0,
          ordem_insumo: passo.ordem_insumo,
          insumo_nome: materia?.nome || `Insumo ${passo.insumo_id}`,
          unidade: materia?.unidade || '',
          processo: materia?.processo || 'Sem processo'
        });
      }
      rota.sort((a, b) => Number(a.ordem_insumo || 0) - Number(b.ordem_insumo || 0));
      rotaCache.set(chave, rota);
      return rota;
    }

    // processo -> peça -> insumos
    const processos = new Map();

    const registrar = (processo, pecaId, dados) => {
      const nome = processo || 'Sem processo';
      if (!processos.has(nome)) processos.set(nome, new Map());
      const pecas = processos.get(nome);
      if (!pecas.has(pecaId)) {
        pecas.set(pecaId, {
          pedido_item_id: pecaId,
          peca: nomePorItem.get(pecaId) || `Peça ${pecaId}`,
          itens: []
        });
      }
      pecas.get(pecaId).itens.push(dados);
    };

    for (const peca of listaItens) {
      const aProduzir = Number(peca.qtd_a_produzir) || 0;
      if (!(aProduzir > 0)) continue;
      const rota = await rotaDoProduto(peca.produto_id);
      if (!rota.length) continue;

      // O ponto de parada é lido pelo id da LINHA da rota, não pelo id do
      // insumo: é assim que a coluna é gravada (FK para produtos_insumos).
      // Comparar com id de insumo não encontra nada, a ordem cai para 0 e a
      // peça meio pronta passa a ser cobrada como se fosse do zero — material a
      // mais no papel que vai para a produção.
      const passoFinal = rota[rota.length - 1].passo_id;
      const ordemPorPasso = new Map(rota.map(p => [Number(p.passo_id), Number(p.ordem_insumo) || 0]));

      // Peças aproveitadas pela METADE: já passaram por parte da rota. Cobrar a
      // rota inteira delas no relatório mandaria a produção separar material
      // para processos que essas peças já tinham passado.
      const parciais = (extPorItem.get(Number(peca.id)) || [])
        .filter(r => Number(r.ultimo_insumo_id) !== Number(passoFinal))
        .map(r => ({
          quantidade: Number(r.quantidade) || 0,
          ordem: ordemPorPasso.get(Number(r.ultimo_insumo_id)) ?? 0
        }))
        .filter(p => p.quantidade > 0);

      const totalParcial = parciais.reduce((acc, p) => acc + p.quantidade, 0);
      const doZero = Math.max(0, aProduzir - totalParcial);

      for (const passo of rota) {
        const ordemDoPasso = Number(passo.ordem_insumo) || 0;
        const unidades = doZero
          + parciais.reduce((acc, p) => acc + (ordemDoPasso > p.ordem ? p.quantidade : 0), 0);
        const quantidade = Math.round((passo.por_unidade * unidades + Number.EPSILON) * 10000) / 10000;
        if (!(quantidade > 0)) continue;
        registrar(passo.processo, Number(peca.id), {
          insumo_nome: passo.insumo_nome,
          unidade: passo.unidade,
          quantidade,
          ordem_insumo: passo.ordem_insumo
        });
      }
    }

    // ------------------------------------------------------------------
    // O QUE FALTOU (a tabela de baixo). Sai da foto congelada na conversão —
    // recalcular contra o estoque de hoje daria um número diferente do que foi
    // decidido, e é o decidido que a produção precisa ver.
    // ------------------------------------------------------------------
    const faltaPorProcesso = new Map();
    for (const f of listaFaltantes) {
      const processo = f.processo || 'Sem processo';
      if (!faltaPorProcesso.has(processo)) faltaPorProcesso.set(processo, new Map());
      const mapa = faltaPorProcesso.get(processo);
      const chave = `${f.insumo_nome}__${f.unidade}`;
      const atual = mapa.get(chave)
        || { insumo_nome: f.insumo_nome, unidade: f.unidade, quantidade: 0 };
      atual.quantidade = Math.round((atual.quantidade + (Number(f.quantidade) || 0) + Number.EPSILON) * 10000) / 10000;
      mapa.set(chave, atual);
      // Um processo que só aparece nos faltantes ainda precisa de folha.
      if (!processos.has(processo)) processos.set(processo, new Map());
    }

    const relatorio = Array.from(processos.entries())
      .map(([processo, pecas]) => {
        const listaPecas = Array.from(pecas.values()).map(p => ({
          ...p,
          itens: p.itens.slice().sort(
            (a, b) => Number(a.ordem_insumo || 0) - Number(b.ordem_insumo || 0)
              || String(a.insumo_nome).localeCompare(String(b.insumo_nome), 'pt-BR')
          )
        }));

        // Total do processo: o mesmo insumo somado entre todas as peças.
        const totais = new Map();
        for (const peca of listaPecas) {
          for (const item of peca.itens) {
            const chave = `${item.insumo_nome}__${item.unidade}`;
            const atual = totais.get(chave)
              || { insumo_nome: item.insumo_nome, unidade: item.unidade, quantidade: 0 };
            atual.quantidade = Math.round((atual.quantidade + item.quantidade + Number.EPSILON) * 10000) / 10000;
            totais.set(chave, atual);
          }
        }

        const porNome = (a, b) => String(a.insumo_nome).localeCompare(String(b.insumo_nome), 'pt-BR');
        return {
          processo,
          pecas: listaPecas,
          // Soma de tudo que o processo consome, entre as peças.
          totais: Array.from(totais.values()).sort(porNome),
          // Só o que não havia em estoque — vem da foto da conversão.
          faltantes: Array.from((faltaPorProcesso.get(processo) || new Map()).values()).sort(porNome)
        };
      })
      .sort((a, b) => String(a.processo).localeCompare(String(b.processo), 'pt-BR'));

    // Não há o que produzir: todas as peças saíram prontas do estoque. É
    // diferente de "pedido sem registro" (convertido antes desta versão), e a
    // tela precisa dizer qual dos dois é — senão parece defeito.
    const temItens = listaItens.length > 0;
    const somentePecasProntas = temItens
      && listaItens.every(i => !(Number(i.qtd_a_produzir) > 0))
      && listaItens.some(i => Number(i.qtd_usar_pronta) > 0);

    res.json({
      somentePecasProntas,
      temItens,
      pedido: {
        id: pedido.id,
        numero: pedido.numero,
        cliente_id: pedido.cliente_id,
        data_emissao: pedido.data_emissao,
        situacao: pedido.situacao,
        dono: pedido.dono,
        decisao_estoque_note: pedido.decisao_estoque_note,
        pode_saldo_negativo: pedido.pode_saldo_negativo
      },
      processos: relatorio
    });
  } catch (err) {
    console.error('Erro ao montar o relatório de produção:', err);
    res.status(err.status || 500).json({ error: 'Erro ao montar o relatório de produção' });
  }
});

/**
 * Peças escolhidas na conversão, uma linha por origem.
 *
 * Responde três perguntas que o relatório de produção não responde, porque ele
 * é organizado por PROCESSO e não por peça:
 *
 *   - de onde veio cada peça (pronta do estoque, pela metade, ou do zero);
 *   - em que ponto da rota ela está parada — etapa e item;
 *   - quantos itens da rota ainda faltam para ela ficar pronta.
 *
 * Sai do registro congelado na conversão, não de recálculo: `pedido_itens_ext`
 * para o que veio do estoque e `reservas_estoque` para o que será produzido.
 */
router.get('/:id/pecas-selecionadas', exigirPermissao('ped.report'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);

    const [pedido, itens] = await Promise.all([
      api.get(`/api/pedidos/${id}`),
      api.get('/api/pedidos_itens', { query: { pedido_id: id } }).catch(() => [])
    ]);

    if (!pedido || pedido.error === 'Not found') {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const listaItens = Array.isArray(itens) ? itens : [];

    // Tudo o que o pedido inteiro precisa, em paralelo e de uma vez só. A
    // primeira versão buscava por item e por insumo dentro dos laços, e num
    // pedido com vários produtos isso virava dezenas de requisições em série.
    const [reservas, extDoPedido, materiaPorId] = await Promise.all([
      api.get('/api/reservas_estoque', { query: { pedido_id: id } }).catch(() => []),
      api.get('/api/pedido_itens_ext', { query: { id_pedido: id } }).catch(() => []),
      carregarMateriaPrima(api)
    ]);

    const extPorItem = new Map();
    for (const registro of (Array.isArray(extDoPedido) ? extDoPedido : [])) {
      const chave = Number(registro.pedido_item_id);
      if (!extPorItem.has(chave)) extPorItem.set(chave, []);
      extPorItem.get(chave).push(registro);
    }

    // Rota por produto, com o id da LINHA (produtos_insumos.id) — é ele que
    // `pedido_itens_ext.ultimo_insumo_id` guarda.
    const rotaCache = new Map();
    async function rotaDoProduto(produtoId) {
      const chave = Number(produtoId);
      if (rotaCache.has(chave)) return rotaCache.get(chave);
      const bruta = await api
        .get('/api/produtos_insumos', { query: { produto_id: chave } })
        .catch(() => []);
      const lista = Array.isArray(bruta) ? bruta : [];
      const rota = lista.map(passo => {
        const materia = materiaPorId.get(Number(passo.insumo_id)) || null;
        return {
          passo_id: Number(passo.id),
          insumo_id: Number(passo.insumo_id),
          ordem_insumo: Number(passo.ordem_insumo) || 0,
          insumo_nome: materia?.nome || `Insumo ${passo.insumo_id}`,
          processo: materia?.processo || 'Sem processo'
        };
      });
      rota.sort((a, b) => a.ordem_insumo - b.ordem_insumo);
      rotaCache.set(chave, rota);
      return rota;
    }

    const linhas = [];

    for (const item of listaItens) {
      const pecaNome = item.nome || item.codigo || `Item ${item.id}`;
      const rota = await rotaDoProduto(item.produto_id);
      const totalDaRota = rota.length;
      const doEstoque = extPorItem.get(Number(item.id)) || [];

      let parciaisDoEstoque = 0;

      for (const reg of doEstoque) {
        const passo = rota.find(p => Number(p.passo_id) === Number(reg.ultimo_insumo_id)) || null;
        const ordem = passo ? passo.ordem_insumo : totalDaRota;
        // O último passo da rota é a peça acabada: nada falta.
        const faltam = Math.max(0, totalDaRota - ordem);
        if (faltam > 0) parciaisDoEstoque += Number(reg.quantidade) || 0;
        linhas.push({
          peca: pecaNome,
          codigo: item.codigo || '',
          origem: faltam === 0 ? 'Pronta do estoque' : 'Parcial do estoque',
          quantidade: Number(reg.quantidade) || 0,
          etapa: passo?.processo || (faltam === 0 ? 'Finalizada' : '—'),
          item_parada: passo?.insumo_nome || '—',
          lote_id: reg.etapa_id ?? null,
          itens_faltantes: faltam,
          itens_da_rota: totalDaRota
        });
      }

      // ----------------------------------------------------------------
      // Peças produzidas DO ZERO
      //
      // A conta é `qtd_a_produzir` menos o que foi aproveitado pela metade — a
      // MESMA que a conversão fez ao abater os insumos. Antes esta linha saía
      // de `reservas_estoque`, e um pedido cuja reserva não tivesse sido
      // gravada aparecia no relatório sem NENHUMA peça do zero, mesmo tendo
      // consumido a rota inteira de todas elas.
      //
      // A reserva serve para dizer o STATUS (em produção, finalizada,
      // retornada) — não para dizer quantas são.
      // ----------------------------------------------------------------
      const aProduzir = Number(item.qtd_a_produzir) || 0;
      const doZero = Math.max(0, aProduzir - parciaisDoEstoque);
      if (doZero > 0) {
        const reserva = (Array.isArray(reservas) ? reservas : [])
          .find(r => String(r.pedido_item_id) === String(item.id)) || null;
        linhas.push({
          peca: pecaNome,
          codigo: item.codigo || '',
          origem: 'Produzir do zero',
          quantidade: doZero,
          // Do zero é o começo da rota: nada foi feito ainda.
          etapa: rota.length ? rota[0].processo : '—',
          item_parada: '—',
          lote_id: null,
          itens_faltantes: totalDaRota,
          itens_da_rota: totalDaRota,
          reserva_status: reserva?.status || null
        });
      }
    }

    // ------------------------------------------------------------------
    // O que MUDOU depois da conversão
    //
    // As linhas acima são a composição ATUAL. Sozinha, ela não conta que o
    // pedido recebeu peças de um pedido cancelado, nem o que elas substituíram
    // — e é exatamente essa parte que alguém precisa conferir depois. As duas
    // seções abaixo são independentes: um pedido pode ter recebido peças
    // (`alteracoes`) e/ou ter sido cancelado (`destinacoes`).
    // ------------------------------------------------------------------
    const [recebidas, destinacoes] = await Promise.all([
      api.get('/api/realocacoes', { query: { pedido_id_destino: id } }).catch(() => []),
      destinacoesDoCancelamento(api, id, rotaDoProduto, listaItens)
    ]);
    const alteracoes = await alteracoesRecebidas(api, recebidas, rotaDoProduto, listaItens);
    // A seleção ORIGINAL só faz sentido quando houve alteração — sem ela seria
    // uma segunda tabela idêntica à composição atual.
    const selecaoOriginal = alteracoes.length
      ? await reconstruirSelecaoOriginal(linhas, recebidas, rotaDoProduto, listaItens)
      : [];

    res.json({
      pedido: { id: pedido.id, numero: pedido.numero, data_emissao: pedido.data_emissao },
      temItens: listaItens.length > 0,
      pecas: linhas,
      selecaoOriginal,
      alteracoes,
      destinacoes
    });
  } catch (err) {
    console.error('Erro ao listar as peças selecionadas:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar as peças selecionadas' });
  }
});

/**
 * GET /pedidos/:id/estorno-opcoes
 *
 * O que a tela de cancelamento precisa para deixar o usuário escolher EM QUE
 * PONTO DA ROTA cada peça volta: a rota completa (o teto da escolha) e, por
 * peça, de onde cada unidade veio (o piso — ninguém desmonta uma peça).
 */
router.get('/:id/estorno-opcoes', exigirPermissao('ped.cancel'), async (req, res) => {
  try {
    const api = createApiClient(req);
    res.json(await opcoesDeEstorno(api, req.params.id));
  } catch (err) {
    console.error('Erro ao montar as opções de estorno:', err);
    res.status(err.status || 500).json({ error: 'Erro ao montar as opções de estorno' });
  }
});

module.exports = router;
// Exposto para teste: a regra "cada status grava a sua data" precisa de guarda
// própria, sem depender de subir banco.
module.exports.payloadDeStatus = payloadDeStatus;
