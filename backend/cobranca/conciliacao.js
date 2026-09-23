/**
 * Conciliação com o Banco do Brasil — fase E.
 *
 *   1. fila do webhook: cada aviso de BAIXA OPERACIONAL que a API gravou em
 *      boletos_eventos (origem 'webhook', sem processado_em) é casado com o
 *      boleto pelo nosso número (e convênio); pagamento → boleto "pago" e
 *      recebimento lançado; cancelamento da baixa → recebimento estornado e
 *      boleto volta a "registrado"/"vencido";
 *   2. consulta: os boletos a pagar, os mais antigos de consulta primeiro,
 *      passam pelo GET do BB (boletoOperacoes.sincronizar), que também lança
 *      o recebimento quando acha o boleto pago;
 *   3. acerto: boleto pago ou quitado por fora sem recebimento (anterior à
 *      fase E, ou lançamento que falhou) ganha o seu.
 *
 * O aviso do BB (baixa operacional) é o pagamento registrado na câmara,
 * antes do crédito: a data de crédito chega depois, pela consulta.
 * Códigos de estado da baixa: 10 e acima são cancelamento (10 BB, 20 outros
 * bancos); o texto "cancel" também conta, por segurança.
 */
const boletos = require('./boletos');
const operacoes = require('./boletoOperacoes');
const recebimentos = require('./recebimentos');
const calculo = require('./boletoCalculo');

const LIMITE_FILA = 200;
const LIMITE_CONSULTAS = 40;

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const digitos = v => String(v ?? '').replace(/\D/g, '');
const semZeros = v => digitos(v).replace(/^0+/, '');
const dia = recebimentos.dia;
const agora = () => new Date().toISOString();

/** Data em qualquer formato que o BB usa: 'dd.mm.aaaa[ HH:MM:SS]', 'dd/mm/aaaa', 'aaaa-mm-dd…'. */
function dataFlexivel(valor) {
  const texto = String(valor ?? '').trim();
  let m = /^(\d{2})[./-](\d{2})[./-](\d{4})/.exec(texto);
  if (m) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    return recebimentos.dataValida(iso) ? iso : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return recebimentos.dataValida(iso) ? iso : null;
  }
  return null;
}

/** 1012.5, '1012.50', '1.012,50' → 1012.5; o resto → null. */
function numeroFlexivel(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const texto = String(valor ?? '').replace(/R\$|\s/g, '');
  if (!texto) return null;
  const normal = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

const FORMAS_NO_AVISO = { 1: 'espécie', 2: 'débito em conta', 3: 'cartão de crédito', 4: 'cheque' };

/** O aviso gravado pela API, no que a conciliação usa. */
function lerAviso(evento) {
  let p = evento?.payload;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (_) { p = {}; } }
  p = p && typeof p === 'object' ? p : {};
  const codigo = numeroFlexivel(p.codigoEstadoBaixaOperacional);
  const textoEstado = String(p.estadoBaixaOperacional || p.descricaoEstadoBaixaOperacional || '');
  const canalBruto = p.canalLiquidacao ?? p.canalAgendamento ?? null;
  const formaBruta = p.formaPagamento ?? null;
  return {
    nossoNumero: digitos(p.numeroTituloCliente ?? p.id ?? p.numero) || digitos(evento?.nosso_numero) || null,
    convenio: semZeros(p.numeroConvenio) || null,
    codigo,
    cancelamento: (codigo !== null && codigo >= 10) || /cancel/i.test(textoEstado),
    data: dataFlexivel(p.dataLiquidacao ?? p.dataAgendamento ?? p.dataPagamento),
    valor: numeroFlexivel(p.valorPagoSacado),
    canal: canalBruto === null || canalBruto === '' ? null
      : (Number.isFinite(Number(canalBruto)) ? operacoes.canalDePagamento(Number(canalBruto)) : String(canalBruto).slice(0, 60)),
    forma: formaBruta === null || formaBruta === '' ? null
      : (FORMAS_NO_AVISO[Number(formaBruta)] || String(formaBruta).slice(0, 30)),
    instituicao: p.instituicaoLiquidacao ?? p.instituicaoAgendamento ?? null
  };
}

/** O boleto do aviso: mesmo nosso número e (quando o aviso diz) mesmo convênio; o mais novo. */
async function boletoDoAviso(api, aviso) {
  const candidatos = lista(await api.get('/api/boletos', { query: { nosso_numero: aviso.nossoNumero } }))
    .filter(b => b && b.nosso_numero === aviso.nossoNumero && (!aviso.convenio || semZeros(b.convenio) === aviso.convenio));
  return candidatos.sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
}

async function marcarAviso(api, evento, campos) {
  await api.put(`/api/boletos_eventos/${evento.id}`, campos);
}

/** Pagamento avisado pelo BB: boleto pago e recebimento lançado. */
async function confirmarPagamento({ api, boleto, aviso, eventoId, hoje, usuarioId }) {
  // Boleto já baixado aqui (quitado por fora, cancelado) e pago no banco: pode ser pagamento em dobro.
  if (boleto.status === 'baixado') {
    const mensagem = `O BB avisou pagamento${aviso.valor ? ` de R$ ${calculo.valorImpresso(aviso.valor)}` : ''} de um boleto já baixado aqui (${operacoes.MOTIVOS_BAIXA[boleto.motivo_baixa] || boleto.motivo_baixa || 'sem motivo'}): confira, pode ser pagamento em dobro.`;
    await boletos.registrarEvento(api, boleto.id, { origem: 'webhook', tipo: 'alerta', nosso_numero: boleto.nosso_numero, mensagem, payload: aviso, usuario_id: usuarioId });
    return { alerta: mensagem };
  }
  let atual = boleto;
  if (boleto.status !== 'pago') {
    const campos = { status: 'pago', data_pagamento: aviso.data || hoje, situacao_bb: 'BAIXA OPERACIONAL' };
    if (aviso.valor !== null && aviso.valor > 0) campos.valor_pago = Math.round(aviso.valor * 100) / 100;
    if (aviso.canal) campos.canal_pagamento = aviso.canal;
    atual = await boletos.atualizarBoleto(api, boleto, campos);
    await boletos.registrarEvento(api, boleto.id, {
      origem: 'webhook', tipo: 'pago', nosso_numero: boleto.nosso_numero, usuario_id: usuarioId, payload: aviso,
      mensagem: `Pago${aviso.data ? ` em ${calculo.dataImpressa(aviso.data)}` : ''}${aviso.valor ? `: R$ ${calculo.valorImpresso(aviso.valor)}` : ''}${aviso.canal ? ` (${aviso.canal})` : ''} — aviso do BB.`
    });
  }
  // Boleto importado do BB e ainda sem parcela: marca o pagamento e avisa —
  // recebimento sem parcela não existe (decisão do dono, 23/09/2026).
  if (!atual.pedido_id) {
    const mensagem = `O BB avisou o pagamento do boleto ${atual.nosso_numero}, que não tem parcela vinculada: o boleto ficou pago, mas nada foi lançado no Financeiro. Ligue-o a uma parcela em "Importar boletos do BB".`;
    await boletos.registrarEvento(api, atual.id, { origem: 'webhook', tipo: 'alerta', nosso_numero: atual.nosso_numero, mensagem, payload: aviso, usuario_id: usuarioId });
    return { alerta: mensagem };
  }

  const r = await recebimentos.doBoleto({
    api, boleto: atual, origem: 'boleto', usuarioId, hoje,
    dados: { data: aviso.data, valor: aviso.valor, canal: aviso.canal, eventoId }
  });
  return { recebimento: r };
}

/** O BB desfez a baixa operacional: estorna o recebimento e o boleto volta a cobrar. */
async function cancelarPagamento({ api, boleto, aviso, hoje, usuarioId }) {
  const estornados = await recebimentos.estornarDoBoleto({ api, boleto, motivo: 'O Banco do Brasil cancelou a baixa operacional (pagamento desfeito).', usuarioId });
  if (boleto.status === 'pago') {
    const venc = dia(boleto.data_vencimento);
    await boletos.atualizarBoleto(api, boleto, {
      status: venc && venc < hoje ? 'vencido' : 'registrado', data_pagamento: null, valor_pago: null, canal_pagamento: null, situacao_bb: 'BAIXA OPERACIONAL CANCELADA'
    });
  }
  await boletos.registrarEvento(api, boleto.id, {
    origem: 'webhook', tipo: 'pagamento_cancelado', nosso_numero: boleto.nosso_numero, usuario_id: usuarioId, payload: aviso,
    mensagem: `O BB cancelou a baixa operacional${aviso.codigo !== null ? ` (código ${aviso.codigo})` : ''}: ${estornados ? `${estornados} recebimento(s) estornado(s)` : 'não havia recebimento lançado'}.`
  });
  return { estornados };
}

/** Processa os avisos do webhook que ainda estão na fila. Um aviso com erro fica na fila para a próxima vez. */
async function processarFila({ api, hoje, usuarioId = null, limite = LIMITE_FILA }) {
  const fila = lista(await api.get('/api/boletos_eventos', { query: { origem: 'webhook' } }))
    .filter(e => e && e.origem === 'webhook' && !e.processado_em)
    .sort((a, b) => Number(a.id) - Number(b.id))
    .slice(0, limite);
  const resumo = { lidos: fila.length, pagos: 0, cancelados: 0, alertas: 0, ignorados: 0, erros: 0, mensagens: [] };
  for (const evento of fila) {
    try {
      const aviso = lerAviso(evento);
      if (!aviso.nossoNumero) {
        await marcarAviso(api, evento, { processado_em: agora(), erro_processamento: 'Aviso sem nosso número: ignorado.' });
        resumo.ignorados += 1;
        continue;
      }
      const boleto = await boletoDoAviso(api, aviso);
      if (!boleto) {
        await marcarAviso(api, evento, { processado_em: agora(), erro_processamento: `O nosso número ${aviso.nossoNumero} não é de um boleto deste sistema: ignorado.` });
        resumo.ignorados += 1;
        continue;
      }
      if (aviso.cancelamento) {
        await cancelarPagamento({ api, boleto, aviso, hoje, usuarioId });
        resumo.cancelados += 1;
        await marcarAviso(api, evento, { boleto_id: boleto.id, processado_em: agora(), erro_processamento: null });
        continue;
      }
      const r = await confirmarPagamento({ api, boleto, aviso, eventoId: evento.id, hoje, usuarioId });
      if (r.alerta) {
        resumo.alertas += 1;
        resumo.mensagens.push(r.alerta);
        await marcarAviso(api, evento, { boleto_id: boleto.id, processado_em: agora(), erro_processamento: r.alerta.slice(0, 2000) });
      } else {
        resumo.pagos += 1;
        await marcarAviso(api, evento, { boleto_id: boleto.id, processado_em: agora(), erro_processamento: null });
      }
    } catch (e) {
      resumo.erros += 1;
      resumo.mensagens.push(`Aviso ${evento.id}: ${e.message}`);
      await marcarAviso(api, evento, { erro_processamento: String(e.message || e).slice(0, 2000) }).catch(() => {});
    }
  }
  return resumo;
}

/** Boletos pagos ou quitados por fora que ainda não viraram recebimento. */
async function acertarRecebimentos({ api, todos, hoje, usuarioId = null }) {
  const alvo = todos.filter(b => b && (b.status === 'pago' || (b.status === 'baixado' && b.motivo_baixa === 'quitado_por_fora')));
  if (!alvo.length) return { lancados: 0, erros: 0, mensagens: [] };
  const existentes = await recebimentos.lerTodos(api);
  const confirmados = new Set(existentes.filter(r => r.status === 'confirmado').map(r => `${r.pedido_id}:${r.numero_parcela}`));
  const resumo = { lancados: 0, erros: 0, mensagens: [] };
  for (const b of alvo) {
    // Importado do BB e ainda sem parcela: não há a quem lançar o dinheiro.
    if (!b.pedido_id) continue;
    if (confirmados.has(`${b.pedido_id}:${b.numero_parcela}`)) continue;
    // Quitação por fora anterior à fase: a forma estava só no canal ("Fora do boleto · Pix").
    const forma = b.status === 'baixado' ? String(b.canal_pagamento || '').split('·').pop().trim() || null : null;
    try {
      const r = await recebimentos.doBoleto({
        api, boleto: b, origem: b.status === 'pago' ? 'boleto' : 'quitado_por_fora', usuarioId, hoje,
        dados: { data: b.data_pagamento, valor: b.valor_pago, forma, observacao: b.status === 'baixado' ? b.observacao_baixa : null }
      });
      if (!r.ja_existia) resumo.lancados += 1;
      confirmados.add(`${b.pedido_id}:${b.numero_parcela}`);
    } catch (e) {
      resumo.erros += 1;
      resumo.mensagens.push(`Boleto ${b.nosso_numero}: ${e.message}`);
    }
  }
  return resumo;
}

/**
 * A conciliação inteira. `conexao(ambiente)` devolve as credenciais do
 * ambiente do boleto (ou falha, e aquele boleto fica para depois).
 * `soFila` só processa os avisos (sem chamar o BB).
 */
async function conciliar({ api, bb, conexao, cfg = null, hoje, usuarioId = null, soFila = false, limiteConsultas = LIMITE_CONSULTAS }) {
  const fila = await processarFila({ api, hoje, usuarioId });
  const resultado = { fila, consultas: { consultados: 0, mudaram: 0, pagos: 0, erros: 0, mensagens: [] }, acerto: { lancados: 0, erros: 0, mensagens: [] }, sql_pendente: false };
  if (!(await recebimentos.tabelaPronta(api))) {
    resultado.sql_pendente = true;
    return resultado;
  }
  if (soFila) return resultado;

  const todos = lista(await api.get('/api/boletos'));
  const aPagar = todos
    .filter(b => b && boletos.STATUS_A_PAGAR.has(String(b.status)))
    .sort((a, b) => String(a.sincronizado_em || '').localeCompare(String(b.sincronizado_em || '')) || Number(a.id) - Number(b.id))
    .slice(0, limiteConsultas);
  for (const b of aPagar) {
    try {
      operacoes.exigirSql(b);
      const r = await operacoes.sincronizar({ api, bb, conexao: await conexao(b.ambiente), boleto: b, cfg, hoje, usuarioId });
      resultado.consultas.consultados += 1;
      if (r.mudou) resultado.consultas.mudaram += 1;
      if (r.boleto.status === 'pago') resultado.consultas.pagos += 1;
      resultado.consultas.mensagens.push(...r.avisos);
    } catch (e) {
      resultado.consultas.erros += 1;
      resultado.consultas.mensagens.push(`Boleto ${b.nosso_numero}: ${e.message}`);
    }
  }
  const depois = lista(await api.get('/api/boletos'));
  resultado.acerto = await acertarRecebimentos({ api, todos: depois, hoje, usuarioId });
  return resultado;
}

module.exports = {
  LIMITE_FILA, LIMITE_CONSULTAS,
  dataFlexivel, numeroFlexivel, lerAviso, boletoDoAviso, confirmarPagamento, cancelarPagamento, processarFila, acertarRecebimentos, conciliar
};
