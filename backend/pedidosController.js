const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');
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
    const avisos = [];
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
        descricao: `Pedido marcado como ${status}.`,
        usuarioId: idDoUsuarioDaRequisicao(req)
      }, avisos);
    }

    res.json({ success: true, avisos });
  } catch (err) {
    console.error('Erro ao atualizar status do pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar status do pedido' });
  }
}); // <--- Faltava este '});' para fechar a rota e a função async

// Obtém um pedido específico com itens e parcelas
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
 * DELETE /pedidos/:id  — exclusão restrita (ação visível só ao Sup Admin).
 * Remove itens e parcelas antes do pedido, para não deixar órfãos.
 */
router.delete('/:id', exigirPermissao('ped.delete'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);

    const [itens, parcelas] = await Promise.all([
      api.get('/api/pedidos_itens', { query: { pedido_id: id } }).catch(() => []),
      api.get('/api/pedido_parcelas', { query: { pedido_id: id } }).catch(() => [])
    ]);
    for (const item of Array.isArray(itens) ? itens : []) {
      if (item?.id) await api.delete(`/api/pedidos_itens/${item.id}`).catch(() => {});
    }
    for (const parc of Array.isArray(parcelas) ? parcelas : []) {
      if (parc?.id) await api.delete(`/api/pedido_parcelas/${parc.id}`).catch(() => {});
    }

    await api.delete(`/api/pedidos/${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao excluir pedido' });
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
    const extPorItem = new Map();
    for (const peca of (Array.isArray(itens) ? itens : [])) {
      const registros = await api
        .get('/api/pedido_itens_ext', { query: { pedido_item_id: peca.id } })
        .catch(() => []);
      extPorItem.set(Number(peca.id), Array.isArray(registros) ? registros : []);
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
    const rotaCache = new Map();
    async function rotaDoProduto(produtoId) {
      const chave = Number(produtoId);
      if (rotaCache.has(chave)) return rotaCache.get(chave);
      const bruta = await api.get('/api/produtos_insumos', { query: { produto_id: chave } }).catch(() => []);
      const lista = Array.isArray(bruta) ? bruta : [];
      const rota = [];
      for (const passo of lista) {
        const materia = await api.get(`/api/materia_prima/${passo.insumo_id}`).catch(() => null);
        rota.push({
          insumo_id: Number(passo.insumo_id),
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

      const insumoFinal = rota[rota.length - 1].insumo_id;
      const ordemPorInsumo = new Map(rota.map(p => [Number(p.insumo_id), Number(p.ordem_insumo) || 0]));

      // Peças aproveitadas pela METADE: já passaram por parte da rota. Cobrar a
      // rota inteira delas no relatório mandaria a produção separar material
      // para processos que essas peças já tinham passado.
      const parciais = (extPorItem.get(Number(peca.id)) || [])
        .filter(r => Number(r.ultimo_insumo_id) !== Number(insumoFinal))
        .map(r => ({
          quantidade: Number(r.quantidade) || 0,
          ordem: ordemPorInsumo.get(Number(r.ultimo_insumo_id)) ?? 0
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

module.exports = router;
// Exposto para teste: a regra "cada status grava a sua data" precisa de guarda
// própria, sem depender de subir banco.
module.exports.payloadDeStatus = payloadDeStatus;
