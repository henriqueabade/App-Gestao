/**
 * Peças AVULSAS (pedido do dono, 09/10/2026).
 *
 * No cancelamento do pedido, a peça pode "Continuar produzindo": ela fica
 * onde está, no ponto escolhido, e segue sendo produzida fora de pedido. O
 * resto da pendência do pedido some (financeiro/mudancasUnidades.js zera a
 * fila e põe só as avulsas); a produção paga o trecho que ela andou até o
 * cancelamento e continua no Fechar competência, num card próprio.
 *
 * O fim da avulsa:
 *   pronta     terminou todos os processos → entra no estoque como peça pronta,
 *              sozinha (conferirProntas, depois de cada confirmação);
 *   estoque    "Devolver ao estoque" no ponto em que está (ou noutro que o
 *              usuário escolher, nunca antes de onde ela entrou): vai para o
 *              lote daquele ponto e o resto da rota volta à matéria-prima;
 *   descarte   "Cancelar a produção": a peça deixa de existir no ponto em que
 *              está; o resto da rota volta à matéria-prima;
 *   trocada    substitui a peça de um pedido (backend/trocasPecas.js) — a peça
 *              de lá vira a avulsa, no estado dela.
 *
 * Uma linha de `pecas_avulsas` por unidade. O que muda nela é só o fim
 * (status, quando, quem, como); a história fica também no pedido e no
 * Financeiro.
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { obterPermissoesEfetivas } = require('./permissionsController');
const permissoesRepo = require('./permissionsRepository');
const c = require('./financeiro/comum');
const regras = require('./financeiro/regras');
const unidades = require('./financeiro/producaoUnidades');
const mudancas = require('./financeiro/mudancasUnidades');
const auditoria = require('./financeiro/auditoria');
const { MOV, ITEM, EVENTO, registrarMovimento, registrarEventoDoPedido } = require('./estoqueLedger');
const estorno = require('./cancelamentoEstorno');

const MINIMO_MOTIVO = 10;
const plural = (n, um, varios) => `${n} ${Number(n) === 1 ? um : varios}`;
const nomeDaPeca = item => [item?.codigo, item?.nome].filter(Boolean).join(' — ') || `peça ${item?.id}`;

/** O que falta em cada processo pago, numa unidade parada em `ordem` da rota. Pura. */
function restanteNoPonto(rota, etapas, ordem) {
  const restante = {};
  for (const e of etapas) {
    const f = unidades.fracao(rota, e.nome, ordem);
    if (f !== null) restante[String(e.id)] = Math.round(f * 10000) / 10000;
  }
  return restante;
}

async function etapasAtivas(api) {
  const tudo = await regras.lerTudo(api);
  return tudo.etapas.filter(e => e.producao_ativa);
}

/** As tabelas existem? (o cancelamento confere ANTES de gravar qualquer coisa). */
async function tabelaPronta(api) {
  return (await mudancas.lerTabela(api, mudancas.TABELA_AVULSAS, { id: 0 }).catch(() => null)) !== null;
}

/**
 * Grava as avulsas de um cancelamento — DEPOIS de apurar a produção dele: a
 * hora da avulsa é a hora em que a fila do pedido passa a ser só ela, e o
 * pagamento do trecho que ela andou tem de ficar antes.
 * `avulsas`: o que estornarCancelamento devolveu.
 */
async function criarDoCancelamento(api, { pedidoId, avulsas = [], usuarioId = null }) {
  const lista = (avulsas || []).filter(a => a && Number(a.quantidade) > 0);
  if (!lista.length) return { criadas: [], avisos: [] };
  const avisos = [];
  const [etapas, itens, insumos] = await Promise.all([
    etapasAtivas(api),
    c.ler(api, 'pedidos_itens', { pedido_id: pedidoId }),
    estorno.carregarInsumos(api)
  ]);
  const cacheRotas = new Map();
  const lote = `cancelamento:${pedidoId}:${c.agora()}`;
  const criadas = [];
  for (const a of lista) {
    const item = itens.find(i => String(i.id) === String(a.pedidoItemId)) || { id: a.pedidoItemId };
    const rota = await estorno.carregarRota(api, Number(a.produtoId ?? item.produto_id), cacheRotas, insumos).catch(() => []);
    const estado = {
      ordem_origem: Number(a.ordemOrigem) || 0, ordem: Number(a.ordemDestino) || 0, passo_id: a.passoId ?? null,
      rotulo: estorno.rotuloDoEstagio(rota, Number(a.ordemDestino) || 0), restante: restanteNoPonto(rota, etapas, Number(a.ordemDestino) || 0)
    };
    for (let k = 0; k < Math.trunc(Number(a.quantidade)); k += 1) {
      const linha = await api.post(`/api/${mudancas.TABELA_AVULSAS}`, {
        pedido_id: pedidoId, pedido_item_id: a.pedidoItemId, produto_id: a.produtoId ?? item.produto_id ?? null, quantidade: 1,
        lote, origem: 'cancelamento', estado_inicio: JSON.stringify(estado), status: 'em_producao',
        criado_por: usuarioId, criado_em: c.agora()
      });
      criadas.push({ id: linha?.id ?? linha?.[0]?.id ?? null, pedido_item_id: a.pedidoItemId, peca: nomeDaPeca(item), estado: estado.rotulo });
    }
  }
  const texto = criadas.length
    ? `${plural(criadas.length, 'peça segue', 'peças seguem')} em produção como avulsa: ${[...new Set(criadas.map(x => `${x.peca} (${x.estado})`))].join('; ')}.`
    : '';
  if (criadas.length) {
    await registrarEventoDoPedido(api, { pedidoId, tipoEvento: EVENTO.CANCELAMENTO, descricao: `Peças avulsas: ${texto}`, usuarioId }, avisos);
    await auditoria.registrar(api, { tipo: 'peca_avulsa', pedidoId, usuarioId, descricao: `Cancelamento: ${texto}`, dados: { avulsas: criadas.map(x => x.id) } });
  }
  return { criadas, avisos };
}

/** As avulsas em produção (com o pedido e a peça), para as telas. */
async function vivas(api) {
  const linhas = await mudancas.lerTabela(api, mudancas.TABELA_AVULSAS, { status: 'em_producao' });
  if (linhas === null) return { sql_pendente: true, avulsas: [] };
  return { sql_pendente: false, avulsas: linhas.map(a => ({ ...a, estado_inicio: mudancas.estadoDe(a.estado_inicio) })) };
}

/**
 * Passa para o estoque, pronta, a avulsa que terminou todos os processos.
 * `pendentesDoItem(itemId)` → quanto ainda falta (soma dos processos) nas
 * unidades do item; quem chama já tem as filas montadas. Silenciosa: falha
 * vira aviso.
 */
async function conferirProntas(api, { pendentesDoItem, usuarioId = null }) {
  const { avulsas } = await vivas(api).catch(() => ({ avulsas: [] }));
  const avisos = [];
  const prontas = [];
  const porItem = new Map();
  for (const a of avulsas) {
    if (!porItem.has(String(a.pedido_item_id))) porItem.set(String(a.pedido_item_id), []);
    porItem.get(String(a.pedido_item_id)).push(a);
  }
  if (!porItem.size) return { prontas, avisos };
  const insumos = await estorno.carregarInsumos(api);
  const cacheRotas = new Map();
  const cacheLotes = new Map();
  for (const [itemId, lista] of porItem) {
    const falta = await pendentesDoItem(itemId);
    if (falta === null || falta === undefined || falta > 0.0001) continue;
    for (const a of lista) {
      try {
        const rota = await estorno.carregarRota(api, Number(a.produto_id), cacheRotas, insumos);
        const final = rota.length ? rota[rota.length - 1] : null;
        const lote = final ? await estorno.lotePara(api, { produtoId: Number(a.produto_id), passo: final, lotePreferido: null }, cacheLotes, avisos) : null;
        let movimentoId = null;
        if (lote) {
          const nova = Math.round((Number(lote.quantidade) + Number(a.quantidade)) * 10000) / 10000;
          await api.put(`${estorno.TABELA_LOTES}/${lote.id}`, { quantidade: nova, data_hora_completa: c.agora() });
          lote.quantidade = nova;
          movimentoId = await registrarMovimento(api, {
            tipoMovimento: MOV.RETORNO, tipoItem: ITEM.PECA, itemId: Number(a.produto_id), quantidade: Number(a.quantidade),
            pedidoId: a.pedido_id, pedidoItemId: a.pedido_item_id, loteId: lote.id, ultimoInsumoId: final?.insumo_id ?? null,
            nota: 'Peça avulsa pronta: entrou no estoque', usuarioId
          }, avisos);
        }
        const restante = Object.fromEntries(Object.keys(a.estado_inicio?.restante || {}).map(k => [k, 0]));
        await c.atualizar(api, mudancas.TABELA_AVULSAS, a.id, {
          status: 'no_estoque', encerrada_em: c.agora(), encerrada_por: usuarioId,
          encerramento: JSON.stringify({ tipo: 'pronta', ordem: final ? final.ordem : 0, lote_id: lote?.id ?? null, movimento_id: movimentoId, restante })
        });
        prontas.push(a.id);
        await registrarEventoDoPedido(api, { pedidoId: a.pedido_id, tipoEvento: EVENTO.CANCELAMENTO, descricao: `Peça avulsa ${a.id} terminou a produção e entrou no estoque, pronta.`, usuarioId }, avisos);
      } catch (e) {
        avisos.push(`A peça avulsa ${a.id} ficou pronta, mas não entrou no estoque: ${e?.message || e}`);
      }
    }
  }
  if (prontas.length) {
    await auditoria.registrar(api, { tipo: 'peca_avulsa', usuarioId, descricao: `${plural(prontas.length, 'peça avulsa ficou pronta e entrou', 'peças avulsas ficaram prontas e entraram')} no estoque.`, dados: { avulsas: prontas } });
  }
  return { prontas, avisos };
}

/**
 * "Devolver ao estoque" (no ponto escolhido) ou "Cancelar a produção" de uma
 * avulsa. O que foi feito nela é pago pelo Fechar competência (confirme lá
 * antes); aqui a peça sai da produção, o resto da rota volta à
 * matéria-prima e, no estoque, ela entra no lote do ponto em que está.
 */
async function encerrar({ api, avulsaId, entrada, usuarioId = null, registrarEntradaInsumo = null }) {
  const tipo = String(entrada?.tipo || '');
  if (!['estoque', 'descarte'].includes(tipo)) throw c.erro('Escolha: devolver ao estoque ou cancelar a produção.', 422);
  const motivo = c.texto(entrada?.motivo, 500);
  if (motivo.replace(/[^\p{L}]/gu, '').length < MINIMO_MOTIVO) throw c.erro(`Diga o motivo (ao menos ${MINIMO_MOTIVO} letras).`, 422);
  const linhas = await mudancas.lerTabela(api, mudancas.TABELA_AVULSAS, { id: Number(avulsaId) });
  if (linhas === null) throw c.erro(mudancas.SQL_FALTANDO, 409, { sql_pendente: true });
  const a = linhas[0];
  if (!a) throw c.erro('Peça avulsa não encontrada.', 404);
  if (a.status !== 'em_producao') throw c.erro('Esta peça avulsa já saiu da produção.', 409);
  const inicio = mudancas.estadoDe(a.estado_inicio) || {};
  const [etapas, insumos] = await Promise.all([etapasAtivas(api), estorno.carregarInsumos(api)]);
  const rota = await estorno.carregarRota(api, Number(a.produto_id), new Map(), insumos);
  const ordemFinal = rota.length ? rota[rota.length - 1].ordem : 0;
  const piso = Number(inicio.ordem_origem) || 0;
  const ordem = Math.min(Math.max(Number(entrada?.ordem ?? inicio.ordem) || 0, piso), ordemFinal);
  const avisos = [];

  let lote = null;
  let movimentoId = null;
  if (tipo === 'estoque' && ordem > 0) {
    const passo = rota.find(p => p.ordem === ordem) || rota[rota.length - 1] || null;
    lote = await estorno.lotePara(api, { produtoId: Number(a.produto_id), passo, lotePreferido: null }, new Map(), avisos);
    if (!lote) throw c.erro('Não foi possível achar nem criar o lote desse ponto da rota.', 409);
    const nova = Math.round((Number(lote.quantidade) + Number(a.quantidade)) * 10000) / 10000;
    await api.put(`${estorno.TABELA_LOTES}/${lote.id}`, { quantidade: nova, data_hora_completa: c.agora() });
    movimentoId = await registrarMovimento(api, {
      tipoMovimento: MOV.RETORNO, tipoItem: ITEM.PECA, itemId: Number(a.produto_id), quantidade: Number(a.quantidade),
      pedidoId: a.pedido_id, pedidoItemId: a.pedido_item_id, loteId: lote.id, ultimoInsumoId: passo?.insumo_id ?? null,
      nota: `Peça avulsa devolvida ao estoque no ponto ${ordem} da rota: ${motivo}`, usuarioId
    }, avisos);
  }
  // O resto da rota (depois do ponto e depois de onde ela entrou) volta à matéria-prima.
  const porInsumo = new Map();
  for (const passo of rota) {
    if (!(passo.ordem > ordem) || !(passo.ordem > piso)) continue;
    const q = Math.round(passo.por_unidade * Number(a.quantidade) * 10000) / 10000;
    if (q > 0) porInsumo.set(passo.insumo_id, Math.round(((porInsumo.get(passo.insumo_id) || 0) + q) * 10000) / 10000);
  }
  await estorno.devolverInsumos(api, {
    porInsumo, pedidoId: a.pedido_id, nota: tipo === 'estoque' ? 'Devolvido: peça avulsa voltou ao estoque' : 'Devolvido: produção da peça avulsa cancelada',
    usuarioId, registrarEntradaInsumo, resumo: { insumosDevolvidos: 0 }, tiposQueVoltaram: new Set()
  }, avisos);

  const rotulo = estorno.rotuloDoEstagio(rota, ordem);
  await c.atualizar(api, mudancas.TABELA_AVULSAS, a.id, {
    status: tipo === 'estoque' ? 'no_estoque' : 'descartada', encerrada_em: c.agora(), encerrada_por: usuarioId,
    encerramento: JSON.stringify({ tipo, ordem, lote_id: lote?.id ?? null, movimento_id: movimentoId, restante: restanteNoPonto(rota, etapas, ordem), motivo })
  });
  const frase = tipo === 'estoque'
    ? `Peça avulsa ${a.id} devolvida ao estoque em ${rotulo}. Motivo: ${motivo}`
    : `Produção da peça avulsa ${a.id} cancelada em ${rotulo}. Motivo: ${motivo}`;
  await registrarEventoDoPedido(api, { pedidoId: a.pedido_id, tipoEvento: EVENTO.CANCELAMENTO, descricao: frase, usuarioId }, avisos);
  await auditoria.registrar(api, { tipo: 'peca_avulsa', pedidoId: a.pedido_id, referenciaId: a.id, usuarioId, descricao: frase, dados: { tipo, ordem, lote_id: lote?.id ?? null } });
  return { avulsa: { id: a.id, status: tipo === 'estoque' ? 'no_estoque' : 'descartada', ordem, rotulo }, insumos_devolvidos: porInsumo.size, avisos };
}

/**
 * Para o diálogo de encerrar: os pontos em que a avulsa pode ir ao estoque
 * (do ponto em que ela entrou no pedido até o fim da rota) e onde ela está
 * agora — a unidade mais adiantada da peça, pelo que a produção já confirmou.
 */
async function opcoesDeEncerrar(api, avulsaId) {
  const linhas = await mudancas.lerTabela(api, mudancas.TABELA_AVULSAS, { id: Number(avulsaId) });
  if (linhas === null) throw c.erro(mudancas.SQL_FALTANDO, 409, { sql_pendente: true });
  const a = linhas[0];
  if (!a) throw c.erro('Peça avulsa não encontrada.', 404);
  const inicio = mudancas.estadoDe(a.estado_inicio) || {};
  const insumos = await estorno.carregarInsumos(api);
  const rota = await estorno.carregarRota(api, Number(a.produto_id), new Map(), insumos);
  const piso = Number(inicio.ordem_origem) || 0;
  const vivas = (await mudancas.lerTabela(api, mudancas.TABELA_AVULSAS, { pedido_item_id: a.pedido_item_id }) || []).filter(x => x.status === 'em_producao');
  const item = (await c.ler(api, 'pedidos_itens', { id: a.pedido_item_id }))[0];
  let atual = Number(inicio.ordem) || 0;
  if (item) {
    const estados = await require('./trocasPecas').estadosDosItens(api, [{ ...item, quantidade: vivas.length || 1 }]).catch(() => new Map());
    const grupos = estados.get(String(item.id)) || [];
    if (grupos.length) atual = Math.max(piso, Number(grupos[0].ordem) || 0);
  }
  const total = rota.length;
  return {
    avulsa: { id: a.id, status: a.status, pedido_id: a.pedido_id, pedido_item_id: a.pedido_item_id },
    piso, atual, minimo_motivo: MINIMO_MOTIVO,
    etapas: [
      ...(piso === 0 ? [{ ordem: 0, rotulo: 'Por começar — nada feito ainda' }] : []),
      ...rota.filter(p => p.ordem >= piso).map(p => ({ ordem: p.ordem, rotulo: `${p.ordem}/${total} — ${p.insumo_nome}${p.processo ? ` (${p.processo})` : ''}` }))
    ]
  };
}

// ------------------------------------------------------------------- rotas

/** Quem cuida da avulsa: quem pode trocar peças OU quem pode cancelar pedido. */
function exigirUmaDas(chaves) {
  return async (req, res, next) => {
    try {
      const permissoes = await obterPermissoesEfetivas(req);
      if (chaves.some(k => permissoesRepo.can(permissoes, k))) return next();
    } catch (_) { /* nega abaixo */ }
    return res.status(403).json({ error: 'Permissão negada', code: 'FORBIDDEN', permissao: chaves[0] });
  };
}

const router = express.Router();
const usuarioDe = req => require('./cobrancaController').usuarioDaRequisicao(req);
const responder = (rotulo, fn) => async (req, res) => {
  try {
    res.json(await fn(createApiClient(req), req));
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error(`[pecas-avulsas] ${rotulo}:`, err);
    res.status(status).json({ error: err?.message || 'Não foi possível concluir.', ...(err?.extra || {}) });
  }
};

router.get('/:id/opcoes', exigirUmaDas(['ped.trocar_pecas', 'ped.cancel']), responder('opcoes', (api, req) => opcoesDeEncerrar(api, req.params.id)));
router.post('/:id/encerrar', exigirUmaDas(['ped.trocar_pecas', 'ped.cancel']), responder('encerrar', (api, req) => encerrar({
  api, avulsaId: req.params.id, entrada: req.body, usuarioId: usuarioDe(req),
  registrarEntradaInsumo: require('./materiaPrima').registrarEntrada
})));

module.exports = router;
Object.assign(module.exports, { MINIMO_MOTIVO, restanteNoPonto, tabelaPronta, criarDoCancelamento, vivas, conferirProntas, encerrar, opcoesDeEncerrar, exigirUmaDas });
