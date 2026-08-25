// Grava no módulo de destino o que sobreviveu à revisão.
//
// ---------------------------------------------------------------------------
// A GRAVAÇÃO PASSA PELO MÓDULO DE DESTINO, NÃO PELA API DIRETO
//
// Dar entrada em estoque não é um UPDATE em `materia_prima.quantidade`: é isso
// MAIS uma linha em `materia_prima_movimentacoes`, com saldo anterior e saldo
// posterior, e o arredondamento em 4 casas que impede a soma binária de comer
// centésimos a cada movimento. Tudo isso já existe em backend/materiaPrima.js.
//
// Reimplementar aqui criaria um segundo caminho para mexer no estoque — e o
// dia em que os dois divergissem, o razão pararia de fechar com o saldo sem
// que nada acusasse. Por isso este arquivo ORQUESTRA e delega.
//
// ---------------------------------------------------------------------------
// APLICAÇÃO É PARCIAL POR DESENHO
//
// Cada item é gravado por conta própria e guarda o próprio resultado. Um item
// que falha não desfaz os anteriores: não há transação entre chamadas HTTP à
// API remota (ver DEV-ONBOARDING.md), então "tudo ou nada" seria uma promessa
// que não dá para cumprir. Melhor gravar 18 de 20 e dizer quais 2 faltaram do
// que fingir atomicidade e deixar o usuário sem saber o que entrou.

const db = require('./db');
const materiaPrima = require('./materiaPrima');
const { obterEsquema } = require('./iaEsquemas');
const { normalizar } = require('./iaReconciliacao');

function erro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

// ---------------------------------------------------------------------------
// Taxonomia (categoria e unidade)
// ---------------------------------------------------------------------------

/**
 * Encaixa o valor lido na opção que já existe, ou devolve o valor como veio.
 *
 * "chapas", "CHAPAS" e "Chapas" são a mesma categoria. Sem este encaixe, cada
 * fornecedor com uma grafia diferente criaria uma entrada nova na lista, e o
 * filtro do módulo de Matéria-prima viraria uma lista de variações da mesma
 * palavra.
 */
function encaixar(valor, opcoes) {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return null;
  const alvo = normalizar(bruto);
  const achado = (opcoes || []).find(o => normalizar(o) === alvo);
  return achado || bruto;
}

/**
 * Garante que categoria e unidade existam nas listas do módulo.
 *
 * Um insumo com categoria que não está na tabela `categoria` fica invisível no
 * filtro por categoria da tela de Matéria-prima — cadastrado, mas fora do
 * alcance de quem for procurá-lo por ali. Registrar a opção nova é o que
 * mantém o insumo alcançável; o encaixe acima é o que impede isso de virar
 * poluição.
 */
async function garantirTaxonomia({ categoria, unidade }, cache) {
  const notas = [];

  if (categoria && !cache.categorias.some(c => normalizar(c) === normalizar(categoria))) {
    try {
      await materiaPrima.adicionarCategoria(categoria);
      cache.categorias.push(categoria);
      notas.push(`categoria "${categoria}" cadastrada`);
    } catch (_) {
      // Falhar aqui não pode impedir o insumo de entrar: a categoria é
      // classificação, o saldo é o dado.
      notas.push(`não foi possível cadastrar a categoria "${categoria}"`);
    }
  }

  if (unidade && !cache.unidades.some(u => normalizar(u) === normalizar(unidade))) {
    try {
      await materiaPrima.adicionarUnidade(unidade);
      cache.unidades.push(unidade);
      notas.push(`unidade "${unidade}" cadastrada`);
    } catch (_) {
      notas.push(`não foi possível cadastrar a unidade "${unidade}"`);
    }
  }

  return notas;
}

// ---------------------------------------------------------------------------
// Matéria-prima
// ---------------------------------------------------------------------------

async function aplicarMateriaPrima(item, contexto) {
  const { cache, usuarioId, nota } = contexto;
  const dados = item.dados || {};

  const nome = String(dados.nome || '').trim();
  if (!nome) throw erro(400, 'Sem nome de insumo');

  // Ausência é checada ANTES da conversão: `Number(null)` e `Number('')` dão
  // ZERO, e uma quantidade que ninguém preencheu viraria uma entrada de zero
  // gravada em silêncio — com movimentação no razão e tudo.
  const quantidadeBruta = dados.quantidade;
  if (quantidadeBruta === null || quantidadeBruta === undefined || quantidadeBruta === '') {
    throw erro(400, 'Sem quantidade');
  }
  const quantidade = Number(quantidadeBruta);
  if (!Number.isFinite(quantidade) || quantidade < 0) throw erro(400, 'Quantidade inválida');

  const categoria = encaixar(dados.categoria, cache.categorias);
  const unidade = encaixar(dados.unidade, cache.unidades);
  const preco = dados.preco_unitario === null || dados.preco_unitario === undefined
    ? null : Number(dados.preco_unitario);

  const notas = await garantirTaxonomia({ categoria, unidade }, cache);

  // ---- cadastrar -----------------------------------------------------------
  if (item.acao === 'criar') {
    try {
      const criada = await materiaPrima.adicionarMateria({
        nome,
        quantidade,
        preco_unitario: preco ?? 0,
        categoria,
        unidade,
        infinito: false,
        processo: null,
        descricao: dados.descricao || null
      }, usuarioId);

      return {
        alvo_id: criada?.id ?? null,
        mensagem: ['Insumo cadastrado', ...notas].join(' · ')
      };
    } catch (e) {
      // A trava de duplicado do próprio módulo. Ela existe justamente para o
      // caso em que a reconciliação disse "novo" e o insumo já estava lá com o
      // nome escrito de outro jeito.
      if (e?.code === 'DUPLICADO') {
        throw erro(409, `Já existe um insumo chamado "${nome}". Mude a ação para "Dar entrada" e escolha o insumo existente.`);
      }
      throw e;
    }
  }

  // ---- dar entrada no que já existe ---------------------------------------
  if (item.acao === 'atualizar') {
    const alvo = Number(item.alvo_id);
    if (!Number.isFinite(alvo)) throw erro(400, 'Sem insumo de destino para dar entrada');

    // A ENTRADA é o passo irreversível: depois dela o saldo já mudou e não há
    // como desfazer por aqui. Se ela falhar, nada entrou e o item é erro de
    // verdade — pode ser reaplicado à vontade.
    await materiaPrima.registrarEntrada(alvo, quantidade, usuarioId, {
      origem: 'manual',
      nota
    });

    const feitos = [`Entrada de ${quantidade}`];
    const avisos = [];

    /**
     * Daqui para baixo, falha vira AVISO e não erro.
     *
     * O saldo já subiu. Marcar o item como "erro" convidaria o usuário a
     * corrigir e aplicar de novo — e a segunda aplicação somaria a quantidade
     * outra vez, dobrando o estoque por causa de um preço que não atualizou.
     * O que falta aqui é corrigível na tela de Matéria-prima; estoque em dobro
     * não é.
     */
    const tentar = async (o_que, fn) => {
      try { await fn(); return true; }
      catch (e) { avisos.push(`${o_que} não foi possível: ${String(e?.message || e).slice(0, 120)}`); return false; }
    };

    // Preço tem razão própria (`atualizarPreco` grava a movimentação de
    // preço e repassa o custo aos produtos que usam o insumo). Zero é preço
    // válido só na teoria: numa lista de compra é campo em branco lido como
    // número, e sobrescreveria o preço bom que já estava no cadastro.
    if (preco !== null && Number.isFinite(preco) && preco > 0) {
      const ok = await tentar('atualizar o preço',
        () => materiaPrima.atualizarPreco(alvo, preco, usuarioId));
      if (ok) feitos.push(`preço atualizado para ${preco}`);
    }

    // Unidade, categoria e observação são descritivas: não movimentam saldo e
    // por isso não passam pelo razão. Vão num PUT direto, com SÓ os campos que
    // vieram — mandar o payload inteiro sobrescreveria a quantidade que a
    // entrada acabou de somar.
    const descritivos = {};
    if (unidade) descritivos.unidade = unidade;
    if (categoria) descritivos.categoria = categoria;
    if (dados.descricao) descritivos.descricao = dados.descricao;
    if (Object.keys(descritivos).length) {
      const ok = await tentar('atualizar os dados do cadastro',
        () => db.put(`/materia_prima/${alvo}`, descritivos));
      if (ok) feitos.push('dados do cadastro atualizados');
    }

    return {
      alvo_id: alvo,
      mensagem: [feitos.join(', '), ...avisos, ...notas].join(' · ')
    };
  }

  throw erro(400, `Ação desconhecida: ${item.acao}`);
}

const APLICADORES = { materia_prima: aplicarMateriaPrima };

/** Destinos que já sabem gravar. Os demais chegam nas próximas etapas. */
const DESTINOS_APLICAVEIS = Object.keys(APLICADORES);

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

/**
 * Aplica os itens de uma leitura e devolve o resultado de cada um.
 *
 * Roda dentro de `db.runWithToken` para que as gravações saiam com o token de
 * QUEM PEDIU, e não com o token de serviço do aplicativo — senão o histórico
 * de estoque registraria "o sistema" onde deveria registrar a pessoa.
 *
 * Em série de propósito: dar entrada em dois itens ao mesmo tempo é onde
 * apareceriam as corridas de saldo, e o ganho de tempo não vale o risco numa
 * operação que mexe em estoque.
 */
async function aplicar({ destino, itens, usuarioId, token, extracaoId, titulo }) {
  const esquema = obterEsquema(destino);
  const aplicador = APLICADORES[destino];
  if (!esquema || !aplicador) {
    throw erro(400, `Ainda não é possível aplicar em "${destino}".`);
  }

  const executar = async () => {
    // As listas de categoria e unidade são lidas UMA vez e mantidas em memória
    // durante o lote: relê-las a cada item seriam 2N requisições para uma
    // resposta que quase nunca muda no meio da aplicação.
    const cache = { categorias: [], unidades: [] };
    if (destino === 'materia_prima') {
      const [categorias, unidades] = await Promise.all([
        materiaPrima.listarCategorias().catch(() => []),
        materiaPrima.listarUnidades().catch(() => [])
      ]);
      cache.categorias = categorias;
      cache.unidades = unidades;
    }

    const nota = `Leitura de IA #${extracaoId}${titulo ? ` — ${titulo}` : ''}`.slice(0, 200);
    const resultados = [];

    for (const item of itens) {
      if (item.acao === 'ignorar') {
        resultados.push({ id: item.id, status: 'ignorado', alvo_id: null, mensagem: 'Descartado na revisão' });
        continue;
      }
      // Reaplicar o que já entrou duplicaria estoque. A guarda fica aqui e
      // não só na rota porque é aqui que a gravação acontece.
      if (item.status === 'aplicado') {
        resultados.push({ id: item.id, status: 'aplicado', alvo_id: item.alvo_id ?? null, mensagem: item.mensagem || 'Já estava aplicado' });
        continue;
      }

      try {
        const r = await aplicador(item, { cache, usuarioId, nota });
        resultados.push({ id: item.id, status: 'aplicado', alvo_id: r.alvo_id, mensagem: r.mensagem });
      } catch (e) {
        resultados.push({
          id: item.id,
          status: 'erro',
          alvo_id: item.alvo_id ?? null,
          mensagem: String(e?.message || 'Falha ao gravar').slice(0, 500)
        });
      }
    }

    return resultados;
  };

  return token ? db.runWithToken(token, executar) : executar();
}

module.exports = {
  APLICADORES,
  DESTINOS_APLICAVEIS,
  encaixar,
  garantirTaxonomia,
  aplicarMateriaPrima,
  aplicar
};
