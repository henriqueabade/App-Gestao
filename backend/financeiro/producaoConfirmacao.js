/**
 * Produção que ENTRA SOZINHA e é CONFIRMADA no fechamento.
 *
 * O pedido que vai para produção já carrega, peça a peça e processo a
 * processo, o que há para produzir (a fila de producaoUnidades.js: a peça que
 * saiu do estoque adiantada só deve o que faltava). Isso fica PENDENTE até
 * alguém dizer o que ficou pronto:
 *
 *   fechamento   a tela "Fechar competência — produção" mostra um card por
 *                pedido; dentro dele, cada peça abre e, em cada processo, o
 *                usuário diz quantas unidades ficaram PRONTAS. O que sobra
 *                segue pendente para o mês seguinte. "Nada pronto" também é
 *                decisão (fica gravada com zero) — sem decidir todas as
 *                unidades, a competência não fecha.
 *   envio        enviar o pedido ao cliente confirma o que ainda estava
 *                pendente (foi tudo produzido), na competência do envio.
 *   cancelamento o que voltou ao estoque paga só o que andou (o estágio de
 *                volta menos o de saída); o resto some.
 *   manual       o "Registrar produção" continua, para acertos no meio do mês.
 *
 * A decisão de cada competência mora em `producao_confirmacoes`
 * (sql/fechamento_producao_e_pagamentos.sql); o VALOR continua saindo do
 * evento de produção (`producao_eventos`), que é o que o fechamento congela.
 */
const c = require('./comum');
const regras = require('./regras');
const producao = require('./producao');
const unidades = require('./producaoUnidades');
const auditoria = require('./auditoria');
const base = require('./base');

const TABELA = 'producao_confirmacoes';
const SQL_CONFIRMACAO = 'Falta rodar sql/fechamento_producao_e_pagamentos.sql no banco e reiniciar a API.';
const ORIGENS = { fechamento: 'no fechamento', envio: 'no envio ao cliente', cancelamento: 'no cancelamento', manual: 'à mão' };

const chave = (itemId, etapaId) => `${itemId}:${etapaId}`;
const inteiro = v => Math.max(0, Math.trunc(Number(v) || 0));
const soma = lista => lista.reduce((s, x) => s + (Number(x) || 0), 0);

/** As decisões de uma competência (409 quando o SQL ainda não rodou). */
async function lerConfirmacoes(api, competencia) {
  try {
    const linhas = c.lista(await api.get(`/api/${TABELA}`, { query: { competencia } }));
    return linhas.filter(l => String(l?.competencia || '').trim() === competencia);
  } catch (e) {
    const texto = `${e?.message || ''} ${e?.body?.error || ''}`;
    if (/42P01/.test(texto) || (new RegExp(TABELA).test(texto) && /não encontrada|does not exist|não existe/i.test(texto))) {
      throw c.erro(SQL_CONFIRMACAO, 409, { sql_pendente: true });
    }
    throw e;
  }
}

/** O último dia da competência (o evento tem de cair no mês que está fechando). */
function diaDaCompetencia(competencia, hoje) {
  const [ano, mes] = String(competencia).split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  return hoje < ultimo ? hoje : ultimo;
}

/**
 * Tudo que a tela do fechamento precisa: um card por pedido com peças,
 * processos, saldo pendente, valor e a decisão já tomada nesta competência.
 */
async function lerPendencias(api, { competencia, hoje, pedidoId = null }) {
  const comp = c.competenciaValida(competencia) ? competencia : c.competenciaDe(hoje);
  const [pedidosTodos, tudo, eventos, confirmacoes, precos] = await Promise.all([
    api.get('/api/pedidos').then(c.lista).catch(() => []),
    regras.lerTudo(api),
    c.ler(api, 'producao_eventos'),
    lerConfirmacoes(api, comp),
    producao.precosDaTabela(api)
  ]);
  // Um pedido só (envio, cancelamento): nem lê a rota dos outros.
  const pedidos = pedidosTodos
    .filter(producao.podeProduzir)
    .filter(p => pedidoId === null || String(p.id) === String(pedidoId));
  const itens = await producao.itensDe(api, pedidos.map(p => p.id));
  const etapasPor = new Map(tudo.etapas.map(e => [String(e.id), e]));
  const { filaDe, gruposPor } = await producao.montarFilas(api, { itens, etapasPor });
  const nomes = await base.nomesDosClientes(api, pedidos.map(p => p.cliente_id));
  const comEtapa = eventos.map(e => ({ ...e, etapa_id: producao.etapaDoEvento(e, { etapas: tudo.etapas, setores: tudo.setores }) }));
  const decisaoPor = new Map(confirmacoes.map(x => [chave(x.pedido_item_id, x.etapa_id), x]));
  const ativas = tudo.etapas.filter(e => e.producao_ativa);

  const cards = pedidos.map(p => {
    const doPedido = itens.filter(i => String(i.pedido_id) === String(p.id));
    const pecas = doPedido.map(i => {
      const preco = precos.get(String(i.produto_id)) ?? null;
      const grupos = gruposPor.get(String(i.id)) || [];
      const processos = ativas.map(e => {
        const fila = filaDe(i.id, e.id);
        if (!fila.length) return null;
        const alocado = unidades.alocar({
          fila,
          eventos: comEtapa.filter(x => String(x.pedido_item_id) === String(i.id) && String(x.etapa_id) === String(e.id))
        });
        const regra = unidades.regraDaPeca(tudo.valores, i.produto_id, e.id);
        const valorPeca = unidades.valorDaPecaInteira(regra, preco);
        const d = decisaoPor.get(chave(i.id, e.id)) || null;
        const saldo = alocado.pendentes.length;
        if (!saldo && !d) return null;
        return {
          etapa_id: e.id, nome: e.nome,
          pedida: fila.length, finalizada: alocado.usadas, saldo,
          proximas: alocado.pendentes.map(f => Math.round(f * 10000) / 10000),
          valor_unitario: valorPeca,
          regra: regra ? unidades.descreverRegra(regra) : null,
          sem_valor: valorPeca === null,
          valor_pendente: valorPeca === null ? null : c.centavos(valorPeca * soma(alocado.pendentes)),
          decidido: d ? {
            prontas: inteiro(d.quantidade_pronta), pendentes: inteiro(d.quantidade_pendente),
            origem: d.origem || 'fechamento', rotulo: ORIGENS[d.origem] || ORIGENS.fechamento,
            // Quando a decisão foi tomada: a tela mostra no hover da etiqueta.
            em: d.criado_em || null
          } : null
        };
      }).filter(Boolean);
      if (!processos.length) return null;
      const datas = processos.map(e => e.decidido?.em).filter(Boolean).sort();
      return {
        pedido_item_id: i.id, produto_id: i.produto_id ?? null, codigo: i.codigo || null, nome: i.nome || null,
        quantidade: Number(i.quantidade) || 0,
        do_estoque: grupos.filter(g => g.origem === 'estoque').reduce((s, g) => s + g.quantidade, 0),
        preco_tabela: preco,
        processos,
        decidida: processos.every(e => !e.saldo || e.decidido),
        decidida_em: datas.length ? datas[datas.length - 1] : null,
        sem_valor: processos.some(e => e.sem_valor && (e.saldo > 0 || (e.decidido?.prontas || 0) > 0))
      };
    }).filter(Boolean);
    if (!pecas.length) return null;
    const todos = pecas.flatMap(x => x.processos);
    return {
      pedido_id: p.id, numero: p.numero ?? String(p.id), situacao: p.situacao,
      cliente: nomes.get(String(p.cliente_id)) || null,
      pecas,
      unidades_pendentes: todos.reduce((s, e) => s + e.saldo, 0),
      valor_pendente: c.centavos(todos.reduce((s, e) => s + (e.valor_pendente || 0), 0)),
      valor_decidido: c.centavos(todos.reduce((s, e) => s + (e.decidido && e.valor_unitario !== null ? e.valor_unitario * somaDasProntas(e) : 0), 0)),
      sem_valor: todos.some(e => e.sem_valor && (e.saldo > 0 || (e.decidido?.prontas || 0) > 0)),
      // Quais peças estão sem regra (a tela lista no hover da etiqueta) e
      // quando o pedido inteiro ficou decidido.
      pecas_sem_valor: pecas.filter(x => x.sem_valor).map(x => x.codigo || x.nome || `peça ${x.pedido_item_id}`),
      confirmado: pecas.every(x => x.decidida),
      confirmado_em: pecas.every(x => x.decidida)
        ? pecas.map(x => x.decidida_em).filter(Boolean).sort().slice(-1)[0] || null
        : null
    };
  }).filter(Boolean);

  return {
    competencia: comp,
    pedidos: cards.sort((a, b) => Number(a.confirmado) - Number(b.confirmado) || String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true })),
    totais: {
      pedidos: cards.length,
      pendentes: cards.filter(x => !x.confirmado).length,
      unidades_pendentes: cards.reduce((s, x) => s + x.unidades_pendentes, 0),
      valor_pendente: c.centavos(cards.reduce((s, x) => s + x.valor_pendente, 0)),
      sem_valor: cards.filter(x => x.sem_valor).map(x => x.numero)
    }
  };
}

/** As primeiras `prontas` frações da fila pendente (o valor do que foi confirmado). */
function somaDasProntas(processo) {
  const quantas = processo?.decidido?.prontas || 0;
  return soma((processo.proximas || []).slice(0, quantas));
}

/** Os pedidos que ainda têm unidade sem decisão nesta competência. */
async function pedidosSemDecisao(api, { competencia, hoje }) {
  const r = await lerPendencias(api, { competencia, hoje });
  return r.pedidos.filter(p => !p.confirmado).map(p => p.numero);
}

async function gravarDecisao({ api, atual, campos, usuarioId }) {
  const quando = c.agora();
  if (atual) {
    await c.atualizar(api, TABELA, atual.id, { ...campos, atualizado_em: quando, atualizado_por: usuarioId });
    return { ...atual, ...campos };
  }
  return c.inserir(api, TABELA, { ...campos, criado_em: quando, criado_por: usuarioId });
}

/**
 * Confirma o que ficou pronto num pedido.
 * `decisoes`: [{ pedido_item_id, etapa_id, prontas }] — `prontas` de 0 ao saldo.
 * Reconfirmar a mesma competência refaz a decisão (enquanto não fechou).
 */
async function confirmar({ api, competencia, pedidoId, decisoes = [], origem = 'fechamento', data = null, usuarioId = null, hoje }) {
  const comp = c.competenciaValida(competencia) ? competencia : c.competenciaDe(hoje);
  if (!ORIGENS[origem]) throw c.erro('Origem da confirmação inválida.');
  const pendencias = await lerPendencias(api, { competencia: comp, hoje, pedidoId });
  const card = pendencias.pedidos.find(p => String(p.pedido_id) === String(pedidoId));
  if (!card) throw c.erro('Este pedido não tem produção pendente nesta competência.', 409);
  const dia = c.dataValida(data) ? data : diaDaCompetencia(comp, hoje);
  const confirmacoes = await lerConfirmacoes(api, comp);
  const decisaoPor = new Map(confirmacoes.map(x => [chave(x.pedido_item_id, x.etapa_id), x]));

  const feitas = [];
  for (const d of decisoes) {
    const peca = card.pecas.find(p => String(p.pedido_item_id) === String(d.pedido_item_id));
    const processo = peca?.processos.find(e => String(e.etapa_id) === String(d.etapa_id));
    if (!processo) throw c.erro('Uma das peças/processos não está mais pendente. Atualize a tela.', 409);
    const prontas = inteiro(d.prontas);
    const disponivel = processo.saldo + (processo.decidido?.prontas || 0);
    if (prontas > disponivel) throw c.erro(`${peca.codigo || peca.nome || 'A peça'} em ${processo.nome}: ${prontas} passa das ${disponivel} unidades que faltam.`, 409);

    const atual = decisaoPor.get(chave(d.pedido_item_id, d.etapa_id)) || null;
    // Mudou de ideia antes de fechar: o registro anterior sai e entra o novo.
    if (atual?.producao_evento_id && inteiro(atual.quantidade_pronta) !== prontas) {
      await producao.estornar({ api, id: atual.producao_evento_id, motivo: 'Decisão do fechamento refeita', usuarioId, hoje }).catch(() => {});
    }
    let evento = null;
    if (prontas > 0 && (!atual?.producao_evento_id || inteiro(atual.quantidade_pronta) !== prontas)) {
      const r = await producao.registrar({
        api, usuarioId, hoje,
        entrada: {
          pedido_id: card.pedido_id, pedido_item_id: d.pedido_item_id, etapa_id: d.etapa_id,
          quantidade: prontas, data_finalizacao: dia,
          observacao: `Confirmado ${ORIGENS[origem]} (${c.rotuloCompetencia(comp)})`
        }
      });
      evento = r.evento;
    }
    const pendentes = Math.max(0, disponivel - prontas);
    await gravarDecisao({
      api, atual, usuarioId,
      campos: {
        competencia: comp, pedido_id: card.pedido_id, pedido_item_id: d.pedido_item_id, etapa_id: d.etapa_id,
        quantidade_pronta: prontas, quantidade_pendente: pendentes, origem,
        producao_evento_id: evento?.id ?? (prontas > 0 ? atual?.producao_evento_id ?? null : null)
      }
    });
    feitas.push({ pedido_item_id: d.pedido_item_id, etapa_id: d.etapa_id, prontas, pendentes, peca: peca.codigo || peca.nome, processo: processo.nome });
  }

  const prontasTotais = feitas.reduce((s, x) => s + x.prontas, 0);
  const pendentesTotais = feitas.reduce((s, x) => s + x.pendentes, 0);
  await auditoria.registrar(api, {
    tipo: 'producao_confirmada', pedidoId: card.pedido_id, usuarioId,
    descricao: `Produção do pedido ${card.numero} confirmada ${ORIGENS[origem]} em ${c.rotuloCompetencia(comp)}: `
      + `${c.plural(prontasTotais, 'unidade pronta', 'unidades prontas')}, ${c.plural(pendentesTotais, 'unidade fica', 'unidades ficam')} para o mês seguinte.`
  });

  const depois = await lerPendencias(api, { competencia: comp, hoje, pedidoId });
  return {
    competencia: comp,
    pedido: depois.pedidos.find(p => String(p.pedido_id) === String(pedidoId)) || null,
    decisoes: feitas
  };
}

/**
 * Confirma TUDO o que está pendente num pedido — o envio ao cliente (foi
 * produzido) e o que voltou pronto num cancelamento. Silencioso: um erro aqui
 * não derruba o envio (devolve o aviso).
 */
async function confirmarTudoDoPedido({ api, pedidoId, origem = 'envio', data = null, usuarioId = null, hoje }) {
  const comp = c.competenciaDe(c.dataValida(data) ? data : hoje);
  const pendencias = await lerPendencias(api, { competencia: comp, hoje, pedidoId });
  const card = pendencias.pedidos.find(p => String(p.pedido_id) === String(pedidoId));
  if (!card) return { confirmado: false, motivo: 'sem produção pendente' };
  const decisoes = card.pecas.flatMap(p => p.processos.filter(e => e.saldo > 0).map(e => ({
    pedido_item_id: p.pedido_item_id, etapa_id: e.etapa_id, prontas: e.saldo + (e.decidido?.prontas || 0)
  })));
  if (!decisoes.length) return { confirmado: false, motivo: 'nada pendente' };
  const r = await confirmar({ api, competencia: comp, pedidoId, decisoes, origem, data, usuarioId, hoje });
  return { confirmado: true, competencia: comp, decisoes: r.decisoes };
}

// ------------------------------------------------------------ cancelamento

/**
 * Quanto de um PROCESSO foi vencido entre dois pontos da rota (0 a 1).
 *
 * A unidade entrou no pedido no ponto `origem` e parou no ponto `destino`:
 * cada passo da rota vale o mesmo dentro do processo, então o que se paga é
 * "passos vencidos ÷ passos do processo". Peça que volta como saiu (8/12 →
 * 8/12) não andou nada; a que volta 9/12 andou um passo; a que volta pronta
 * andou todos os que faltavam.
 */
function avancoNoProcesso(rota, processo, origem, destino) {
  const alvo = unidades.semAcento(processo);
  const passos = (rota || []).filter(p => unidades.semAcento(p.processo) === alvo);
  if (!passos.length) return 0;
  const de = Number(origem) || 0;
  const ate = Number(destino) || 0;
  if (!(ate > de)) return 0;
  return passos.filter(p => Number(p.ordem) > de && Number(p.ordem) <= ate).length / passos.length;
}

/**
 * O que a peça JÁ recebeu naquele processo (em frações de peça inteira),
 * somando os registros ativos. É o que impede pagar duas vezes o mesmo
 * trecho: o cancelamento só lança a diferença.
 */
function fracaoJaPaga({ fila, eventos }) {
  const vivos = eventos.filter(e => e?.status === 'ativo' && !e.estornado_em && !e.estorno_de && Number(e.quantidade) > 0);
  const alocado = unidades.alocar({ fila, eventos: vivos });
  return vivos.reduce((s, e) => {
    const manual = e.fracao_paga === null || e.fracao_paga === undefined ? null : Number(e.fracao_paga);
    return s + (manual !== null ? manual : (alocado.porEvento.get(String(e.id))?.fracao || 0));
  }, 0);
}

/** As destinações gravadas no cancelamento (as que falharam ficam de fora). */
async function lerDestinacoes(api, pedidoId) {
  const linhas = c.lista(await api.get('/api/cancelamento_destinacoes', { query: { pedido_id: pedidoId } }).catch(() => []));
  return linhas.filter(d => d && !d.falha && String(d.pedido_id) === String(pedidoId));
}

/**
 * Cancelamento: paga só o que ANDOU.
 *
 * Cada linha de `cancelamento_destinacoes` diz de onde a unidade saiu
 * (`ordem_origem`) e onde ela parou (`ordem_destino`) — no estoque, no
 * descarte ou dentro de outro pedido. O trecho entre os dois é o que este
 * pedido produziu, e é só isso que entra para pagar; o resto da pendência
 * some com o pedido. O que já tinha sido registrado é abatido.
 *
 * Peça que vai para OUTRO pedido não paga duas vezes: ela entra lá pelo
 * `pedido_itens_ext`, no ponto em que chegou, e a fila do destino já nasce
 * descontada — o destino só deve o que ainda falta.
 *
 * Silencioso como o envio: falha aqui não derruba o cancelamento (vira aviso).
 */
async function confirmarCancelamento({ api, pedidoId, data = null, usuarioId = null, hoje }) {
  const dia = c.dataValida(data) ? data : hoje;
  const comp = c.competenciaDe(dia);
  const avisos = [];
  const destinacoes = await lerDestinacoes(api, pedidoId);
  if (!destinacoes.length) return { confirmado: false, motivo: 'sem destinações do cancelamento', avisos };

  const [tudo, eventos, itens, precos] = await Promise.all([
    regras.lerTudo(api),
    c.ler(api, 'producao_eventos', { pedido_id: pedidoId }),
    producao.itensDe(api, [pedidoId]),
    producao.precosDaTabela(api)
  ]);
  const etapasPor = new Map(tudo.etapas.map(e => [String(e.id), e]));
  const { filaDe, rotaPor } = await producao.montarFilas(api, { itens, etapasPor });
  const comEtapa = eventos.map(e => ({ ...e, etapa_id: producao.etapaDoEvento(e, { etapas: tudo.etapas, setores: tudo.setores }) }));
  const ativas = tudo.etapas.filter(e => e.producao_ativa);
  const lancados = [];

  for (const item of itens) {
    const doItem = destinacoes.filter(d => String(d.pedido_item_id) === String(item.id));
    if (!doItem.length) continue;
    const nomePeca = [item.codigo, item.nome].filter(Boolean).join(' — ') || `item ${item.id}`;
    const rota = rotaPor.get(String(item.id)) || [];
    for (const etapa of ativas) {
      const fila = filaDe(item.id, etapa.id);
      const doProcesso = comEtapa.filter(e => String(e.pedido_item_id) === String(item.id) && String(e.etapa_id) === String(etapa.id));
      if (!fila.length && !doProcesso.length) continue;
      const andou = doItem.reduce((s, d) => s + inteiro(d.quantidade) * avancoNoProcesso(rota, etapa.nome, d.ordem_origem, d.ordem_destino), 0);
      const fracao = Math.round(Math.max(0, andou - fracaoJaPaga({ fila, eventos: doProcesso })) * 10000) / 10000;
      if (!(fracao > 0)) continue;
      const regra = unidades.regraDaPeca(tudo.valores, item.produto_id, etapa.id);
      const valorPeca = unidades.valorDaPecaInteira(regra, precos.get(String(item.produto_id)) ?? null);
      if (valorPeca === null) {
        avisos.push(`${nomePeca} em ${etapa.nome}: sem valor cadastrado — o que foi produzido até o cancelamento não entrou.`);
        continue;
      }
      const quantidade = doItem
        .filter(d => avancoNoProcesso(rota, etapa.nome, d.ordem_origem, d.ordem_destino) > 0)
        .reduce((s, d) => s + inteiro(d.quantidade), 0) || 1;
      const evento = await c.inserir(api, 'producao_eventos', {
        pedido_id: pedidoId, pedido_item_id: item.id, produto_id: item.produto_id ?? null, setor_id: null, etapa_id: etapa.id,
        quantidade, fracao_paga: fracao, data_finalizacao: dia, competencia: comp,
        observacao: `Cancelamento: pago o que andou até aqui (${Math.round(fracao * 100)}% de uma peça em ${etapa.nome})`,
        status: 'ativo', criado_por: usuarioId, criado_em: c.agora()
      });
      // Sem a coluna nova, o evento seria pago pela fila inteira: melhor desfazer
      // e avisar. A conferência relê a linha — a API genérica descarta em
      // silêncio a coluna que a tabela não tem.
      const [gravado] = evento?.id ? await c.ler(api, 'producao_eventos', { id: evento.id }).catch(() => []) : [];
      if (!gravado || gravado.fracao_paga === undefined || gravado.fracao_paga === null) {
        await c.atualizar(api, 'producao_eventos', evento.id, {
          status: 'estornado', estornado_em: c.agora(), estornado_por: usuarioId,
          motivo_estorno: 'Coluna producao_eventos.fracao_paga ausente'
        }).catch(() => {});
        avisos.push(`A produção do cancelamento não foi lançada: ${SQL_CONFIRMACAO}`);
        return { confirmado: false, motivo: 'sql pendente', avisos, lancados };
      }
      const valor = c.centavos(valorPeca * fracao);
      lancados.push({ pedido_item_id: item.id, etapa_id: etapa.id, peca: nomePeca, processo: etapa.nome, fracao, valor, evento_id: evento?.id ?? null });

      // A decisão fica gravada como as outras, para a competência ter a história completa.
      try {
        const atual = (await lerConfirmacoes(api, comp)).find(x => chave(x.pedido_item_id, x.etapa_id) === chave(item.id, etapa.id)) || null;
        await gravarDecisao({
          api, atual, usuarioId,
          campos: {
            competencia: comp, pedido_id: pedidoId, pedido_item_id: item.id, etapa_id: etapa.id,
            quantidade_pronta: quantidade, quantidade_pendente: 0, origem: 'cancelamento',
            producao_evento_id: evento?.id ?? null,
            observacao: `Cancelamento: ${Math.round(fracao * 100)}% de peça em ${etapa.nome}`
          }
        });
      } catch (e) {
        avisos.push(`A produção do cancelamento foi lançada, mas a decisão não ficou registrada: ${e?.message || e}`);
      }
    }
  }

  if (!lancados.length) return { confirmado: false, motivo: 'nada a pagar (nenhuma peça andou)', avisos, lancados };
  const total = c.centavos(lancados.reduce((s, x) => s + x.valor, 0));
  await auditoria.registrar(api, {
    tipo: 'producao_confirmada', pedidoId, usuarioId, valor: total,
    descricao: `Produção do pedido cancelado apurada em ${c.rotuloCompetencia(comp)}: ${c.plural(lancados.length, 'processo pago', 'processos pagos')} pelo que andou, ${c.reais(total)}`
  });
  return { confirmado: true, competencia: comp, total, lancados, avisos };
}

module.exports = {
  TABELA, SQL_CONFIRMACAO, ORIGENS,
  lerConfirmacoes, lerPendencias, pedidosSemDecisao, confirmar, confirmarTudoDoPedido, diaDaCompetencia,
  avancoNoProcesso, fracaoJaPaga, confirmarCancelamento
};
