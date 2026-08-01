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
    avisos
  };

  const pecas = (Array.isArray(itens) ? itens : []).filter(i => Number.isFinite(Number(i?.produto_id)));
  if (!pecas.length) return resumo;

  const produtoIds = Array.from(new Set(pecas.map(i => Number(i.produto_id))));
  const { rotaPorProduto, ultimoInsumoPorProduto } = await carregarRotas(api, produtoIds);
  const estoquePorInsumo = await carregarEstoqueInsumos(api, rotaPorProduto);

  const plano = planejarConsumo({ itens: pecas, rotaPorProduto, estoquePorInsumo });

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

    // Peça inteira procura lote no FIM da rota; peça parcial procura o lote que
    // parou exatamente no insumo informado pela revisão.
    const alvo = peca.parcial
      ? peca.ultimo_insumo_id
      : ultimoInsumoPorProduto.get(peca.produto_id);

    const { consumos, restante } = escolherLotes(lotes, peca.quantidade, alvo);

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

      // Registro de qual ponto da rota saiu — é o que permite o estorno.
      try {
        if (proximoExtId === null) proximoExtId = (await getMaxId(api, TABELA_EXT)) + 1;
        const usado = await inserirLinhaComId(api, TABELA_EXT, {
          pedido_item_id: peca.pedido_item_id,
          ultimo_insumo_id: consumo.ultimo_insumo_id,
          etapa_id: consumo.etapa_id,
          quantidade: consumo.quantidade
        }, proximoExtId);
        proximoExtId = usado + 1;
        resumo.pecasDeEstoqueGravadas += 1;
      } catch (err) {
        avisos.push(`Falha ao registrar a peça retirada do estoque: ${err?.message || err}`);
      }
    }
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
    } catch (err) {
      avisos.push(`Falha ao abater "${consumo.insumo_nome}": ${err?.message || err}`);
    }
  }

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
