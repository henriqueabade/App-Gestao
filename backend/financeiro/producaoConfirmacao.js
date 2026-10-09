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
const mudancasUnidades = require('./mudancasUnidades');

const TABELA = 'producao_confirmacoes';
const SQL_CONFIRMACAO = 'Falta rodar sql/fechamento_producao_e_pagamentos.sql no banco e reiniciar a API.';
const ORIGENS = { fechamento: 'no fechamento', envio: 'no envio ao cliente', cancelamento: 'no cancelamento', manual: 'à mão' };

const chave = (itemId, etapaId) => `${itemId}:${etapaId}`;
const inteiro = v => Math.max(0, Math.trunc(Number(v) || 0));
const soma = lista => lista.reduce((s, x) => s + (Number(x) || 0), 0);
/**
 * Unidades da decisão: podem ser QUEBRADAS (07/10/2026, pedido do dono) —
 * "0,5" é metade daquele processo feita no mês; o resto fica para o seguinte.
 */
const quatro = v => Math.round((Number(v) || 0) * 10000) / 10000;
const QUASE_ZERO = 0.0001;
const unidadesDe = v => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? quatro(n) : NaN;
};
/** "1,5" — o número da unidade como se lê (vírgula, sem zeros à direita). */
const lerUnidades = n => String(quatro(n)).replace('.', ',');

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

/**
 * Setembro/2026 é o primeiro mês da produção no sistema. Dele em diante, as
 * peças só são confirmadas no fechamento de um mês depois que o mês ANTERIOR
 * foi fechado (pedido do dono, 08/10/2026: peças de setembro foram
 * confirmadas em outubro por engano, com setembro ainda aberto).
 */
const PRIMEIRA_COMPETENCIA = '2026-09';

async function exigirMesAnteriorFechado(api, competencia) {
  if (competencia === PRIMEIRA_COMPETENCIA) return;
  const rotulo = c.rotuloCompetencia;
  if (competencia < PRIMEIRA_COMPETENCIA) {
    throw c.erro(`A produção começa em ${rotulo(PRIMEIRA_COMPETENCIA)}: não há peças a confirmar em ${rotulo(competencia)}.`, 409);
  }
  const anterior = c.somarMeses(competencia, -1);
  const fechamentos = await c.ler(api, 'financeiro_fechamentos', { tipo: 'producao' });
  const fechado = fechamentos.some(f => String(f.competencia || '').trim() === anterior && f.status === 'fechado');
  if (!fechado) {
    throw c.erro(`Feche antes a produção de ${rotulo(anterior)}: as peças de ${rotulo(competencia)} só são confirmadas depois que ${rotulo(anterior)} estiver fechado.`, 409,
      { codigo: 'MES_ANTERIOR_ABERTO', mes_anterior: anterior });
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
/**
 * Decisão SELADA (09/10/2026): tomada antes de uma troca ou de uma peça
 * avulsa daquela peça naquele processo. Ela continua valendo — o registro
 * dela é trabalho feito (e pago) na unidade que estava lá —, mas não é a
 * decisão da unidade que está lá agora: esta aparece "a decidir" e, quando
 * confirmada, ganha registro próprio, sem estornar o antigo. (A tabela só
 * guarda uma decisão por competência, peça e processo: a linha passa a ser a
 * da unidade nova; a anterior fica na auditoria e no registro dela.)
 */
function decisaoSelada(decisao, mudancas = []) {
  if (!decisao) return false;
  const quando = String(decisao.atualizado_em || decisao.criado_em || '');
  // No empate, a decisão é de antes (a do cancelamento vem logo antes da avulsa).
  return mudancas.some(m => String(m.em ?? '') >= quando);
}

async function lerPendencias(api, { competencia, hoje, pedidoId = null }) {
  const comp = c.competenciaValida(competencia) ? competencia : c.competenciaDe(hoje);
  const [pedidosTodos, tudo, eventos, confirmacoes, precos] = await Promise.all([
    api.get('/api/pedidos').then(c.lista).catch(() => []),
    regras.lerTudo(api),
    c.ler(api, 'producao_eventos'),
    lerConfirmacoes(api, comp),
    producao.precosDaTabela(api)
  ]);
  // O pedido cancelado com peça avulsa em produção também entra (09/10/2026):
  // o card dele é o das "Peças avulsas".
  const avulsasVivas = await mudancasUnidades.lerTabela(api, mudancasUnidades.TABELA_AVULSAS, { status: 'em_producao' }).catch(() => null) || [];
  const comAvulsa = new Set(avulsasVivas.map(a => String(a.pedido_id)));
  // Um pedido só (envio, cancelamento): nem lê a rota dos outros.
  const pedidos = pedidosTodos
    .filter(p => producao.podeProduzir(p) || comAvulsa.has(String(p.id)))
    .filter(p => pedidoId === null || String(p.id) === String(pedidoId));
  const itens = await producao.itensDe(api, pedidos.map(p => p.id));
  const etapasPor = new Map(tudo.etapas.map(e => [String(e.id), e]));
  const { filaDe, gruposPor, mudancasDe } = await producao.montarFilas(api, { itens, etapasPor });
  const nomes = await base.nomesDosClientes(api, pedidos.map(p => p.cliente_id));
  const comEtapa = eventos.map(e => ({ ...e, etapa_id: producao.etapaDoEvento(e, { etapas: tudo.etapas, setores: tudo.setores }) }));
  const decisaoPor = new Map(confirmacoes.map(x => [chave(x.pedido_item_id, x.etapa_id), x]));
  const ativas = tudo.etapas.filter(e => e.producao_ativa);

  const cards = pedidos.map(p => {
    const deAvulsas = !producao.podeProduzir(p) && comAvulsa.has(String(p.id));
    const doPedido = itens.filter(i => String(i.pedido_id) === String(p.id));
    const pecas = doPedido.map(i => {
      const preco = precos.get(String(i.produto_id)) ?? null;
      const grupos = gruposPor.get(String(i.id)) || [];
      const processos = ativas.map(e => {
        const fila = filaDe(i.id, e.id);
        // As trocas e as avulsas do item (09/10/2026) mudam o que ainda se deve.
        const mudancas = mudancasDe(i.id, e.id);
        if (!fila.length && !mudancas.length) return null;
        const doProcesso = comEtapa.filter(x => String(x.pedido_item_id) === String(i.id) && String(x.etapa_id) === String(e.id));
        const alocado = unidades.alocarComMudancas({ fila, eventos: doProcesso, mudancas });
        const regra = unidades.regraDaPeca(tudo.valores, i.produto_id, e.id);
        const valorPeca = unidades.valorDaPecaInteira(regra, preco);
        const registrada = decisaoPor.get(chave(i.id, e.id)) || null;
        const selada = decisaoSelada(registrada, mudancas);
        const d = selada ? null : registrada;
        // A fila como estava ANTES da decisão desta competência: é dela que a
        // decisão (e a reconfirmação, enquanto não fecha) parte.
        const antes = d?.producao_evento_id
          ? unidades.alocarComMudancas({ fila, eventos: doProcesso.filter(x => String(x.id) !== String(d.producao_evento_id)), mudancas })
          : alocado;
        // Em unidades, podendo ser quebradas: 0,5 = metade de uma unidade em aberto.
        const saldo = quatro(soma(alocado.cotas));
        if (!(saldo > QUASE_ZERO) && !d) return null;
        const prontas = d ? quatro(d.quantidade_pronta) : 0;
        const plano = d ? unidades.planoDaDecisao(antes, prontas) : null;
        return {
          etapa_id: e.id, nome: e.nome,
          pedida: alocado.pedida, finalizada: alocado.usadas, saldo,
          // Quanto cabe na decisão desta competência (o saldo mais o que ela já confirmou).
          disponivel: quatro(soma(antes.cotas)),
          // A primeira unidade em aberto já veio com parte feita (decisão quebrada de um mês anterior).
          ja_feito: antes.cotas.length && antes.cotas[0] < 1 - QUASE_ZERO ? quatro(1 - antes.cotas[0]) : 0,
          em_aberto: { pendentes: antes.pendentes, cotas: antes.cotas },
          proximas: alocado.pendentes,
          valor_unitario: valorPeca,
          regra: regra ? unidades.descreverRegra(regra) : null,
          sem_valor: valorPeca === null,
          valor_pendente: valorPeca === null ? null : c.centavos(valorPeca * soma(alocado.pendentes)),
          decidido: d ? {
            prontas, pendentes: quatro(d.quantidade_pendente),
            valor: valorPeca === null ? null : c.centavos(valorPeca * plano.fracao),
            origem: d.origem || 'fechamento', rotulo: ORIGENS[d.origem] || ORIGENS.fechamento,
            // Quando a decisão foi tomada: a tela mostra no hover da etiqueta.
            em: d.criado_em || null
          } : null,
          // Decidido antes da troca/avulsa: a confirmação nova não estorna o registro antigo.
          decisao_selada: selada
        };
      }).filter(Boolean);
      if (!processos.length) return null;
      const datas = processos.map(e => e.decidido?.em).filter(Boolean).sort();
      return {
        pedido_item_id: i.id, produto_id: i.produto_id ?? null, codigo: i.codigo || null, nome: i.nome || null,
        // No card das avulsas, a peça conta só as unidades que seguem em produção.
        quantidade: deAvulsas
          ? avulsasVivas.filter(a => String(a.pedido_item_id) === String(i.id)).reduce((s, a) => s + (Number(a.quantidade) || 0), 0)
          : Number(i.quantidade) || 0,
        do_estoque: grupos.filter(g => g.origem === 'estoque').reduce((s, g) => s + g.quantidade, 0),
        preco_tabela: preco,
        processos,
        decidida: processos.every(e => !(e.saldo > QUASE_ZERO) || e.decidido),
        decidida_em: datas.length ? datas[datas.length - 1] : null,
        sem_valor: processos.some(e => e.sem_valor && (e.saldo > 0 || (e.decidido?.prontas || 0) > 0))
      };
    }).filter(Boolean);
    if (!pecas.length) return null;
    const todos = pecas.flatMap(x => x.processos);
    return {
      pedido_id: p.id, numero: p.numero ?? String(p.id), situacao: p.situacao,
      cliente: nomes.get(String(p.cliente_id)) || null,
      // Pedido cancelado com peça que continua sendo produzida: card de "Peças avulsas".
      avulsa: deAvulsas,
      avulsas: avulsasVivas.filter(a => String(a.pedido_id) === String(p.id)).map(a => ({ id: a.id, pedido_item_id: a.pedido_item_id, estado_inicio: mudancasUnidades.estadoDe(a.estado_inicio)?.rotulo || null })),
      pecas,
      unidades_pendentes: quatro(todos.reduce((s, e) => s + e.saldo, 0)),
      valor_pendente: c.centavos(todos.reduce((s, e) => s + (e.valor_pendente || 0), 0)),
      valor_decidido: c.centavos(todos.reduce((s, e) => s + (e.decidido?.valor || 0), 0)),
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
      unidades_pendentes: quatro(cards.reduce((s, x) => s + x.unidades_pendentes, 0)),
      valor_pendente: c.centavos(cards.reduce((s, x) => s + x.valor_pendente, 0)),
      sem_valor: cards.filter(x => x.sem_valor).map(x => x.numero)
    }
  };
}

/** Os pedidos que ainda têm unidade sem decisão nesta competência. */
async function pedidosSemDecisao(api, { competencia, hoje }) {
  const r = await lerPendencias(api, { competencia, hoje });
  return r.pedidos.filter(p => !p.confirmado).map(p => p.numero);
}

/** Apaga um registro de produção que acabou de entrar (e o histórico dele). Nunca lança. */
async function desfazerRegistro(api, eventoId) {
  try {
    const historico = await c.ler(api, 'financeiro_eventos', { tipo: 'producao_registrada', referencia_id: eventoId }).catch(() => []);
    for (const h of historico) await api.delete(`/api/financeiro_eventos/${h.id}`).catch(() => {});
    await api.delete(`/api/producao_eventos/${eventoId}`);
  } catch (e) {
    console.error(`[financeiro] o registro de produção ${eventoId} ficou sem decisão e não pôde ser apagado:`, e?.message || e);
  }
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
 * `decisoes`: [{ pedido_item_id, etapa_id, prontas }] — `prontas` de 0 ao
 * saldo, podendo ser QUEBRADO (0,5 = metade da unidade; o resto fica para o
 * mês seguinte, 07/10/2026).
 * Reconfirmar a mesma competência refaz a decisão (enquanto não fechou).
 */
async function confirmar({ api, competencia, pedidoId, decisoes = [], origem = 'fechamento', data = null, usuarioId = null, hoje, somentePendentes = false }) {
  const comp = c.competenciaValida(competencia) ? competencia : c.competenciaDe(hoje);
  if (!ORIGENS[origem]) throw c.erro('Origem da confirmação inválida.');
  // A trava vale para a tela do fechamento. O envio ao cliente confirma
  // sozinho, no mês do envio, e não pode falhar por causa dela.
  if (origem === 'fechamento') await exigirMesAnteriorFechado(api, comp);
  const pendencias = await lerPendencias(api, { competencia: comp, hoje, pedidoId });
  const card = pendencias.pedidos.find(p => String(p.pedido_id) === String(pedidoId));
  if (!card) throw c.erro('Este pedido não tem produção pendente nesta competência.', 409);
  const dia = c.dataValida(data) ? data : diaDaCompetencia(comp, hoje);
  const confirmacoes = await lerConfirmacoes(api, comp);
  const decisaoPor = new Map(confirmacoes.map(x => [chave(x.pedido_item_id, x.etapa_id), x]));

  const feitas = [];
  for (const d of decisoes) {
    // "Tudo pronto"/"Nada pronto" do pedido decidem só o que falta: uma
    // decisão já tomada (até numa tela desatualizada, em outra aba) fica.
    const peca = card.pecas.find(p => String(p.pedido_item_id) === String(d.pedido_item_id));
    const processo = peca?.processos.find(e => String(e.etapa_id) === String(d.etapa_id));
    // A decisão selada (antes de uma troca/avulsa) não conta como tomada.
    if (somentePendentes && (processo ? processo.decidido : decisaoPor.has(chave(d.pedido_item_id, d.etapa_id)))) continue;
    if (!processo) throw c.erro('Uma das peças/processos não está mais pendente. Atualize a tela.', 409);
    const nomeDaPeca = peca.codigo || peca.nome || 'A peça';
    const prontas = unidadesDe(d.prontas);
    if (!(prontas >= 0)) throw c.erro(`${nomeDaPeca} em ${processo.nome}: diga quanto ficou pronto (um número, pode ser 0,5).`, 422);
    const disponivel = processo.disponivel;
    if (prontas > disponivel + QUASE_ZERO) throw c.erro(`${nomeDaPeca} em ${processo.nome}: ${lerUnidades(prontas)} passa das ${lerUnidades(disponivel)} unidades que faltam.`, 409);

    const atual = decisaoPor.get(chave(d.pedido_item_id, d.etapa_id)) || null;
    // Selada: o registro dela é de outra unidade (antes da troca/avulsa) e fica.
    const selada = processo.decisao_selada === true;
    const mudou = selada || !atual || Math.abs(quatro(atual.quantidade_pronta) - prontas) > QUASE_ZERO;
    // Mudou de ideia antes de fechar: o registro anterior sai e entra o novo.
    if (atual?.producao_evento_id && mudou && !selada) {
      await producao.estornar({ api, id: atual.producao_evento_id, motivo: 'Decisão do fechamento refeita', usuarioId, hoje }).catch(() => {});
    }
    let evento = null;
    if (prontas > 0 && (!atual?.producao_evento_id || mudou)) {
      // A decisão quebrada para no meio de uma unidade: o registro leva a
      // fração paga (o resto da unidade fica pendente para o mês seguinte).
      const plano = unidades.planoDaDecisao(processo.em_aberto, prontas);
      const r = await producao.registrar({
        api, usuarioId, hoje,
        entrada: {
          pedido_id: card.pedido_id, pedido_item_id: d.pedido_item_id, etapa_id: d.etapa_id,
          quantidade: plano.tocadas, data_finalizacao: dia,
          observacao: `Confirmado ${ORIGENS[origem]} (${c.rotuloCompetencia(comp)})${plano.parcial ? ` — ${lerUnidades(prontas)} un.; o resto fica para o mês seguinte` : ''}`
        },
        fracao: plano.parcial ? plano.fracao : null
      });
      evento = r.evento;
    }
    const pendentes = quatro(Math.max(0, disponivel - prontas));
    try {
      await gravarDecisao({
        api, atual, usuarioId,
        campos: {
          competencia: comp, pedido_id: card.pedido_id, pedido_item_id: d.pedido_item_id, etapa_id: d.etapa_id,
          quantidade_pronta: prontas, quantidade_pendente: pendentes, origem,
          producao_evento_id: evento?.id ?? (prontas > 0 && !selada ? atual?.producao_evento_id ?? null : null)
        }
      });
    } catch (e) {
      // A decisão não entrou (a trava do banco, uma queda): o registro feito
      // logo acima não pode ficar solto — sem decisão, ele contaria no mês e
      // "comeria" o processo da peça (08/10/2026).
      if (evento?.id) await desfazerRegistro(api, evento.id);
      throw e;
    }
    feitas.push({ pedido_item_id: d.pedido_item_id, etapa_id: d.etapa_id, prontas, pendentes, peca: peca.codigo || peca.nome, processo: processo.nome });
  }

  const prontasTotais = quatro(feitas.reduce((s, x) => s + x.prontas, 0));
  const pendentesTotais = quatro(feitas.reduce((s, x) => s + x.pendentes, 0));
  const unidadesNoTexto = (n, uma, varias) => `${lerUnidades(n)} ${n === 1 ? uma : varias}`;
  if (feitas.length) await auditoria.registrar(api, {
    tipo: 'producao_confirmada', pedidoId: card.pedido_id, usuarioId,
    descricao: `Produção do pedido ${card.numero} confirmada ${ORIGENS[origem]} em ${c.rotuloCompetencia(comp)}: `
      + `${unidadesNoTexto(prontasTotais, 'unidade pronta', 'unidades prontas')}, ${unidadesNoTexto(pendentesTotais, 'unidade fica', 'unidades ficam')} para o mês seguinte.`
  });

  let depois = await lerPendencias(api, { competencia: comp, hoje, pedidoId });
  // Peça avulsa que terminou todos os processos vai para o estoque, pronta (09/10/2026).
  let avisos = [];
  if (card.avulsa) {
    const cardDepois = depois.pedidos.find(p => String(p.pedido_id) === String(pedidoId)) || null;
    const faltaNoItem = itemId => {
      const peca = cardDepois?.pecas.find(x => String(x.pedido_item_id) === String(itemId));
      return peca ? peca.processos.reduce((s, e) => s + (Number(e.saldo) || 0), 0) : 0;
    };
    const r = await require('../pecasAvulsas').conferirProntas(api, { pendentesDoItem: async itemId => faltaNoItem(itemId), usuarioId }).catch(e => ({ prontas: [], avisos: [e?.message || String(e)] }));
    avisos = [
      ...(r.prontas?.length ? [`${r.prontas.length === 1 ? 'A peça avulsa ficou pronta e entrou' : `${r.prontas.length} peças avulsas ficaram prontas e entraram`} no estoque.`] : []),
      ...(r.avisos || [])
    ];
    if (r.prontas?.length) depois = await lerPendencias(api, { competencia: comp, hoje, pedidoId });
  }
  return {
    competencia: comp,
    pedido: depois.pedidos.find(p => String(p.pedido_id) === String(pedidoId)) || null,
    decisoes: feitas,
    avisos
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
  const decisoes = card.pecas.flatMap(p => p.processos.filter(e => e.saldo > QUASE_ZERO).map(e => ({
    pedido_item_id: p.pedido_item_id, etapa_id: e.etapa_id, prontas: e.disponivel
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
function fracaoJaPaga({ fila, eventos, mudancas = [] }) {
  const vivos = eventos.filter(e => e?.status === 'ativo' && !e.estornado_em && !e.estorno_de && Number(e.quantidade) > 0);
  // Com troca ou avulsa no item (09/10/2026), conta o que foi feito nas
  // unidades que ESTÃO no pedido: a que saiu por troca levou o dela.
  if ((mudancas || []).length) return unidades.alocarComMudancas({ fila, eventos: vivos, mudancas }).feito;
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
async function confirmarCancelamento({ api, pedidoId, data = null, usuarioId = null, hoje, avulsas = [] }) {
  const dia = c.dataValida(data) ? data : hoje;
  const comp = c.competenciaDe(dia);
  const avisos = [];
  // A peça avulsa ("Continuar produzindo", 09/10/2026) também paga o trecho
  // que andou até aqui; o resto ela paga na produção, depois.
  const destinacoes = [
    ...await lerDestinacoes(api, pedidoId),
    ...(avulsas || []).map(a => ({ pedido_item_id: a.pedidoItemId, quantidade: a.quantidade, ordem_origem: a.ordemOrigem, ordem_destino: a.ordemDestino, avulsa: true }))
  ];
  if (!destinacoes.length) return { confirmado: false, motivo: 'sem destinações do cancelamento', avisos };

  const [tudo, eventos, itens, precos] = await Promise.all([
    regras.lerTudo(api),
    c.ler(api, 'producao_eventos', { pedido_id: pedidoId }),
    producao.itensDe(api, [pedidoId]),
    producao.precosDaTabela(api)
  ]);
  const etapasPor = new Map(tudo.etapas.map(e => [String(e.id), e]));
  const { filaDe, rotaPor, mudancasDe } = await producao.montarFilas(api, { itens, etapasPor });
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
      const fracao = Math.round(Math.max(0, andou - fracaoJaPaga({ fila, eventos: doProcesso, mudancas: mudancasDe(item.id, etapa.id) })) * 10000) / 10000;
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
  TABELA, SQL_CONFIRMACAO, ORIGENS, PRIMEIRA_COMPETENCIA,
  exigirMesAnteriorFechado, lerConfirmacoes, lerPendencias, pedidosSemDecisao, confirmar, confirmarTudoDoPedido, diaDaCompetencia,
  avancoNoProcesso, fracaoJaPaga, confirmarCancelamento
};
