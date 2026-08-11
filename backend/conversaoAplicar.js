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

/**
 * A matéria-prima que a conversão vai tocar, indexada por id.
 *
 * UMA leitura da tabela, não uma por insumo. A conversão precisa dos mesmos
 * insumos duas vezes — uma para nome/unidade/processo, outra para o saldo — e
 * as duas liam `/materia_prima/{id}` em fila indiana. Um pedido com quatro
 * peças de quinze passos chega perto de quarenta insumos distintos: eram
 * oitenta idas à API antes de a conversão sequer começar, e o app inteiro
 * ficava atrás delas.
 *
 * A tabela tem algumas centenas de linhas; uma leitura só custa muito menos que
 * quarenta idas de rede — é a mesma decisão já tomada em
 * `pedidosController.carregarMateriaPrima` e em `cancelamentoEstorno`.
 */
async function carregarMateriaPrima(api, insumosIds) {
  const porId = new Map();
  const querFiltro = insumosIds instanceof Set || Array.isArray(insumosIds);
  const desejados = querFiltro ? new Set(Array.from(insumosIds).map(Number)) : null;
  if (desejados && !desejados.size) return porId;

  // Só as colunas usadas aqui: nome/unidade/processo para o relatório e
  // quantidade/infinito para o saldo. A tabela tem descrição, preço e datas que
  // não entram em nada disto — trazer a linha inteira infla a resposta à toa.
  const lista = await api
    .get('/api/materia_prima', {
      query: { select: 'id,nome,unidade,processo,quantidade,infinito' }
    })
    .catch(() => []);
  for (const materia of (Array.isArray(lista) ? lista : [])) {
    const id = Number(materia?.id);
    if (!Number.isFinite(id)) continue;
    if (desejados && !desejados.has(id)) continue;
    porId.set(id, materia);
  }
  return porId;
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
  const materias = await carregarMateriaPrima(api, insumosIds);

  for (const [produtoId, lista] of rotasBrutas.entries()) {
    const rota = lista
      .map(i => {
        const materia = materias.get(Number(i?.insumo_id)) || {};
        return {
          insumo_id: Number(i?.insumo_id),
          // Id da LINHA da rota (produtos_insumos.id), que não é o mesmo que o
          // id do insumo. `pedido_itens_ext.ultimo_insumo_id` tem FK para cá, e
          // não para materia_prima — ver `passoDaRotaPorProduto`.
          passo_id: Number.isFinite(Number(i?.id)) ? Number(i.id) : null,
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

/**
 * Tradução entre dois "ultimo_insumo_id" que têm o mesmo nome e sentidos
 * diferentes — a armadilha que deixou `pedido_itens_ext` vazia.
 *
 *   `produtos_em_cada_ponto.ultimo_insumo_id` -> id da MATÉRIA-PRIMA (ex.: 177)
 *   `pedido_itens_ext.ultimo_insumo_id`       -> id da LINHA DA ROTA, com FK
 *                                                para produtos_insumos (ex.: 4680)
 *
 * Mandar o primeiro onde se espera o segundo viola
 * `pedido_itens_ext_ultimo_insumo_id_fkey`, e a API devolve 500. Como registrar
 * no razão nunca derruba a conversão, o erro virava um aviso e a tabela ficava
 * vazia — o estoque era abatido certo, mas sem o registro que o estorno lê.
 *
 * @returns {Map<number, Map<number, number>>} produto -> (insumo -> linha da rota)
 */
function mapearPassosDaRota(rotaPorProduto) {
  const porProduto = new Map();
  for (const [produtoId, rota] of rotaPorProduto.entries()) {
    const porInsumo = new Map();
    for (const passo of rota) {
      if (Number.isFinite(passo?.insumo_id) && Number.isFinite(passo?.passo_id)) {
        porInsumo.set(passo.insumo_id, passo.passo_id);
      }
    }
    porProduto.set(produtoId, porInsumo);
  }
  return porProduto;
}

/** Saldo atual dos insumos que a conversão vai tocar. */
async function carregarEstoqueInsumos(api, rotaPorProduto) {
  const ids = new Set();
  for (const rota of rotaPorProduto.values()) {
    rota.forEach(passo => {
      if (Number.isFinite(passo.insumo_id)) ids.add(passo.insumo_id);
    });
  }

  // Uma leitura indexada, não uma por insumo — ver `carregarMateriaPrima`.
  //
  // O saldo é lido AGORA, no momento da conversão: `carregarRotas` também leu a
  // tabela, mas para nome e processo, e reaproveitar aquele retorno correria o
  // risco de abater em cima de um saldo velho.
  const materias = await carregarMateriaPrima(api, ids);

  const estoquePorInsumo = new Map();
  for (const id of ids) {
    const materia = materias.get(Number(id)) || null;
    estoquePorInsumo.set(id, {
      quantidade: paraNumero(materia?.quantidade),
      infinito: Boolean(materia?.infinito)
    });
  }
  return estoquePorInsumo;
}

/**
 * Lotes pela metade que dá para aproveitar, do mais adiantado na rota para o
 * menos adiantado (menos trabalho restante primeiro).
 *
 * `disponivel` é mutável de propósito: quem consome vai descontando, para que
 * dois pontos de parada nunca disputem a mesma unidade do mesmo lote.
 */
function prepararCandidatos({ lotes = [], rota = [], ultimoInsumoFinal = null, reservadoNoFinal = 0 }) {
  const ordemPorInsumo = new Map(rota.map(p => [Number(p.insumo_id), paraNumero(p.ordem_insumo)]));

  return lotes
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
}

/** Tira `quantidade` dos candidatos dados, na ordem em que vierem. */
function consumir(candidatos, quantidade, escolhidos) {
  let restante = paraNumero(quantidade);
  // Um item POR LOTE, não por insumo: dois lotes no mesmo ponto da rota são
  // duas linhas de estoque diferentes e cada uma precisa ser baixada na sua.
  for (const candidato of candidatos) {
    if (!(restante > 0)) break;
    const usar = Math.min(candidato.disponivel, restante);
    if (!(usar > 0)) continue;
    candidato.disponivel = arredondar(candidato.disponivel - usar);
    escolhidos.push({
      lote_id: candidato.lote_id,
      ultimo_insumo_id: candidato.ultimo_insumo_id,
      quantidade: arredondar(usar),
      ordem: candidato.ordem
    });
    restante = arredondar(restante - usar);
  }
  return restante;
}

/**
 * Sem revisão informada: aproveita o que houver, do mais adiantado para o
 * menos adiantado, até cobrir o necessário.
 *
 * @returns {Array<{ lote_id: number, ultimo_insumo_id: number, quantidade: number, ordem: number }>}
 */
function derivarParciais({
  lotes = [],
  rota = [],
  ultimoInsumoFinal = null,
  quantidadeNecessaria = 0,
  reservadoNoFinal = 0
} = {}) {
  if (!(paraNumero(quantidadeNecessaria) > 0) || !rota.length) return [];
  const candidatos = prepararCandidatos({ lotes, rota, ultimoInsumoFinal, reservadoNoFinal });
  const escolhidos = [];
  consumir(candidatos, quantidadeNecessaria, escolhidos);
  return escolhidos;
}

/**
 * COM revisão informada: cada ponto de parada leva a quantidade que foi
 * escolhida na tela.
 *
 * A regra anterior era "resolva sempre pelo estoque, do mais adiantado para o
 * menos adiantado", e ela desfazia a decisão do usuário: quem pedia 2 peças
 * paradas na Montagem e 3 paradas no Acabamento recebia as 5 tiradas só da
 * Montagem, porque é o lote mais adiantado e tinha saldo para todas. O estoque
 * fechava, o relatório não: a produção receberia peças em estágio diferente do
 * que a folha manda fazer.
 *
 * O que a revisão manda é a QUANTIDADE por ponto. De qual LINHA do estoque cada
 * uma sai continua sendo resolvido aqui, contra o estoque de verdade — o modal
 * "Substituir Peça" não envia o id do lote, e procurar lote por semelhança era
 * o que fazia os parciais não serem abatidos.
 *
 * O ponto é casado pelo insumo quando ele vem preenchido e, quando não vem
 * (esse mesmo modal manda `ultimo_insumo_id: 0`), pela ordem na rota.
 */
function distribuirParciaisInformados({
  informados = [],
  lotes = [],
  rota = [],
  ultimoInsumoFinal = null,
  quantidadeNecessaria = 0,
  reservadoNoFinal = 0
} = {}) {
  const teto = paraNumero(quantidadeNecessaria);
  if (!(teto > 0) || !rota.length) return { escolhidos: [], naoCasado: 0 };

  const candidatos = prepararCandidatos({ lotes, rota, ultimoInsumoFinal, reservadoNoFinal });
  const escolhidos = [];
  let disponivelParaPedir = teto;
  let naoCasado = 0;

  const pedidos = informados
    .map(info => ({
      insumo: Number(info?.ultimo_insumo_id),
      ordem: paraNumero(info?.ordem),
      quantidade: paraNumero(info?.quantidade)
    }))
    .filter(p => p.quantidade > 0)
    .sort((a, b) => b.ordem - a.ordem);

  for (const pedido of pedidos) {
    if (!(disponivelParaPedir > 0)) break;
    const querido = Math.min(pedido.quantidade, disponivelParaPedir);

    const doPonto = candidatos.filter(c => (
      Number.isFinite(pedido.insumo) && pedido.insumo > 0
        ? Number(c.ultimo_insumo_id) === pedido.insumo
        : c.ordem === pedido.ordem
    ));

    const sobrou = consumir(doPonto, querido, escolhidos);
    disponivelParaPedir = arredondar(disponivelParaPedir - (querido - sobrou));
    // O ponto escolhido não tinha tudo o que foi pedido. O resto não some: cai
    // no aproveitamento geral abaixo, como se a revisão não o tivesse citado.
    naoCasado = arredondar(naoCasado + sobrou);
  }

  if (naoCasado > 0 && disponivelParaPedir > 0) {
    const resto = Math.min(naoCasado, disponivelParaPedir);
    const aindaSobrando = consumir(candidatos.filter(c => c.disponivel > 0), resto, escolhidos);
    naoCasado = arredondar(resto - (resto - aindaSobrando));
  }

  return { escolhidos, naoCasado };
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
  // Autorização e justificativa dadas na revisão da conversão. Chegavam do
  // modal e paravam aqui: os movimentos que zeravam o saldo iam para o razão
  // sem dizer que a negativação tinha sido consentida nem por quê.
  podeSaldoNegativo = false,
  decisaoNote = null,
  inserirLinhaComId,
  getMaxId
} = {}) {
  const avisos = [];
  const resumo = {
    faltantesGravados: 0,
    pecasDeEstoqueGravadas: 0,
    // UNIDADES, ao lado das contagens de registro. As duas coisas são úteis —
    // "quantos lotes toquei" e "quantas peças saíram" —, e confundi-las fez o
    // histórico dizer 6 onde eram 14.
    unidadesDoEstoque: 0,
    unidadesParaProduzir: 0,
    insumosAbatidos: 0,
    reservasCriadas: 0,
    avisos
  };

  const pecas = (Array.isArray(itens) ? itens : []).filter(i => Number.isFinite(Number(i?.produto_id)));
  if (!pecas.length) return resumo;

  const produtoIds = Array.from(new Set(pecas.map(i => Number(i.produto_id))));
  const { rotaPorProduto, ultimoInsumoPorProduto } = await carregarRotas(api, produtoIds);
  const estoquePorInsumo = await carregarEstoqueInsumos(api, rotaPorProduto);
  const passoDaRotaPorProduto = mapearPassosDaRota(rotaPorProduto);

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
    // A lista que a revisão manda diz QUANTAS peças saem de cada ponto da rota,
    // mas não DE QUAL LINHA do estoque elas saem. Sem o id do lote o abatimento
    // volta a procurar — e procurar é o que vinha falhando ("faltaram 2",
    // "faltaram 3", com os lotes ali no banco).
    //
    // Então cada coisa no seu lugar: a quantidade por ponto é a que o usuário
    // escolheu; o "de qual linha" é resolvido aqui, contra o estoque de verdade.
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
    const comum = {
      lotes: lotesPorProduto.get(produtoId) || [],
      rota: rotaPorProduto.get(produtoId) || [],
      ultimoInsumoFinal: ultimoInsumoPorProduto.get(produtoId),
      quantidadeNecessaria: aProduzir,
      // O que a peça pronta já vai levar não pode ser contado de novo.
      reservadoNoFinal: Number(peca?.qtd_usar_pronta) || 0
    };

    const informados = (Array.isArray(peca?.parciais) ? peca.parciais : [])
      .filter(p => paraNumero(p?.quantidade) > 0);

    // Com escolha na tela, ela manda. Sem escolha, aproveita-se o que houver —
    // é o caso da conversão em lote e do payload antigo, onde tratar tudo como
    // "produzir do zero" abateria matéria-prima que não será usada e deixaria o
    // lote parcial no estoque como se estivesse livre.
    let derivados;
    if (informados.length) {
      const { escolhidos, naoCasado } = distribuirParciaisInformados({ ...comum, informados });
      if (naoCasado > 0) {
        avisos.push(
          `O produto ${produtoId} não tinha ${naoCasado} peça(s) no ponto da rota ` +
          'escolhido na revisão. Elas entraram para produção do zero; confira o estoque.'
        );
      }
      derivados = escolhidos;
    } else {
      derivados = derivarParciais(comum);
    }

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
        // A FK de `pedido_itens_ext` exige a linha da rota, não o insumo.
        passoDaRotaId: passoDaRotaPorProduto
          .get(Number(peca.produto_id))?.get(Number(consumo.ultimo_insumo_id)) ?? null,
        quantidade: consumo.quantidade,
        parcial: Boolean(peca.parcial),
        usuarioId
      }, { inserirLinhaComId, getMaxId, proximoId: proximoExtId }, avisos);
      proximoExtId = resultado.proximoId;
      resumo.pecasDeEstoqueGravadas += 1;
      resumo.unidadesDoEstoque = arredondar(resumo.unidadesDoEstoque + paraNumero(consumo.quantidade));
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

  // peça -> reserva que vai produzi-la. O abatimento da matéria-prima logo
  // abaixo usa este mapa para dizer, em cada movimento, para qual reserva
  // aquele insumo está indo.
  const reservaPorItem = new Map();

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
    // As unidades contam mesmo que a reserva falhe: elas foram produzidas do
    // zero de qualquer forma, e o histórico tem de dizer isso.
    resumo.unidadesParaProduzir = arredondar(resumo.unidadesParaProduzir + doZero);
    if (reservaId) {
      resumo.reservasCriadas += 1;
      reservaPorItem.set(String(peca.pedido_item_id), reservaId);
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
      // O saldo é abatido de uma vez só: é UMA alteração no estoque do insumo,
      // e quebrá-la em várias faria o histórico da matéria-prima mostrar cinco
      // saídas onde houve uma.
      await registrarSaida(consumo.insumo_id, consumo.quantidade, usuarioId, {
        origem: 'pedido',
        pedidoId,
        nota: consumo.ficou_negativo ? decisaoNote : null
      });
      resumo.insumosAbatidos += 1;

      // Já o RAZÃO é por peça. `registrarSaida` só grava no histórico do
      // insumo, que não sabe para quem foi; aqui fica registrado qual peça
      // consumiu quanto, e sob qual reserva de produção ela será feita.
      const porPeca = Array.isArray(consumo.porItem) && consumo.porItem.length
        ? consumo.porItem
        : [{ pedido_item_id: null, quantidade: consumo.quantidade }];

      for (const parte of porPeca) {
        if (!(paraNumero(parte.quantidade) > 0)) continue;
        await registrarConsumoDeInsumo(api, {
          pedidoId,
          pedidoItemId: parte.pedido_item_id ?? null,
          // Peça aproveitada pela metade não tem reserva: ela já existia.
          reservaId: reservaPorItem.get(String(parte.pedido_item_id)) ?? null,
          insumoId: consumo.insumo_id,
          quantidade: parte.quantidade,
          // Só marca onde o saldo REALMENTE fechou negativo. Marcar todos
          // esvaziaria o sentido da coluna: ela existe para achar, no meio de
          // centenas de linhas, as que passaram do que havia.
          saldoNegativoAutorizado: consumo.ficou_negativo ? Boolean(podeSaldoNegativo) : null,
          nota: consumo.ficou_negativo ? decisaoNote : null,
          usuarioId
        }, avisos);
      }
    } catch (err) {
      avisos.push(`Falha ao abater "${consumo.insumo_nome}": ${err?.message || err}`);
    }
  }

  // Evento do pedido: o que aconteceu com ELE, não com o estoque.
  await registrarEventoDoPedido(api, {
    pedidoId,
    tipoEvento: EVENTO.CONVERSAO,
    // UNIDADES, não linhas.
    //
    // `pecasDeEstoqueGravadas` e `reservasCriadas` contam REGISTROS: um pedido
    // com 14 peças vindas de seis lotes gravava "6 peça(s) do estoque", e sete
    // peças do zero numa reserva só viravam "1 reserva(s)". O número existia,
    // mas não era o número que alguém procura ao ler o histórico.
    descricao:
      `Convertido do orçamento. ${resumo.unidadesDoEstoque} peça(s) retiradas do estoque, `
      + `${resumo.unidadesParaProduzir} peça(s) para produção do zero, `
      + `${resumo.insumosAbatidos} tipo(s) de insumo movimentado(s).`,
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
