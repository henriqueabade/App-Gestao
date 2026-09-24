/**
 * Recebimentos por parcela — fase E.
 *
 * Um recebimento é o dinheiro de UMA parcela do pedido que entrou:
 *   - `boleto`            o BB avisou (webhook) ou a consulta achou o boleto pago;
 *   - `quitado_por_fora`  o boleto foi baixado porque o cliente pagou de outro jeito;
 *   - `manual`            parcela sem boleto paga por Pix, transferência…
 *
 * Uma parcela tem no máximo um recebimento confirmado (índice único parcial
 * no banco): gravar de novo — aviso repetido do BB, duas máquinas — só
 * devolve o que já existe. O estornado fica guardado, com motivo. A
 * competência é o mês do dia em que o cliente pagou.
 *
 * Fala com o banco pelo `api` genérico; as contas ficam em funções puras.
 */
const boletos = require('./boletos');
const calculo = require('./boletoCalculo');

const ORIGENS = { boleto: 'boleto pago', quitado_por_fora: 'boleto quitado por fora', manual: 'registrado à mão' };
const FORMAS = ['Pix', 'Transferência', 'Depósito', 'Dinheiro', 'Cheque', 'Cartão de crédito', 'Outro'];
const SQL_FALTANDO = 'Falta rodar sql/cobranca_recebimentos.sql no banco e reiniciar a API.';

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const centavos = v => Math.round(Number(v || 0) * 100) / 100;
const reais = v => `R$ ${calculo.valorImpresso(v)}`;
const impressa = iso => calculo.dataImpressa(iso);

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** 'YYYY-MM-DD' de um DATE (texto ou Date), por corte. */
function dia(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = valor instanceof Date ? valor.toISOString() : String(valor).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function dataValida(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

const competenciaDe = iso => String(dia(iso) || '').slice(0, 7);

/** A tabela ainda não existe (SQL da fase não rodou): API remota (404) ou Postgres local (42P01). */
function tabelaAusente(err) {
  const texto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  return /42P01/.test(texto) || /recebimentos.{0,20}(does not exist|não encontrada|não existe)/i.test(texto)
    // 404 de "registro não encontrado" (masculino) não é tabela ausente.
    || (err?.status === 404 && /recebimentos/i.test(texto) && /tabela|não encontrada|não há/i.test(texto));
}

/** A parcela já tem recebimento confirmado (índice único) ou a chave já foi usada. */
function ehDuplicado(err) {
  const texto = `${err?.message || ''} ${err?.body?.detalhe || ''} ${err?.body?.error || ''}`.toLowerCase();
  return texto.includes('recebimentos_parcela_confirmada') || texto.includes('chave_idempotencia')
    || texto.includes('duplicate key') || texto.includes('23505') || err?.status === 409;
}

async function lerTodos(api, query = {}) {
  try {
    const linhas = lista(await api.get('/api/recebimentos', { query }));
    // A API ignora filtro que não conhece e devolveria tudo: confere aqui também.
    return linhas.filter(r => r && Object.entries(query).every(([c, v]) => String(r[c]) === String(v)));
  } catch (e) {
    if (tabelaAusente(e)) throw erro(SQL_FALTANDO, 409, { sql_pendente: true });
    throw e;
  }
}

async function tabelaPronta(api) {
  try {
    await lerTodos(api, { id: 0 });
    return true;
  } catch (e) {
    if (e?.extra?.sql_pendente) return false;
    throw e;
  }
}

const daParcela = (linhas, pedidoId, numeroParcela) => linhas.filter(r => Number(r.pedido_id) === Number(pedidoId) && Number(r.numero_parcela) === Number(numeroParcela));
const confirmadoDe = linhas => linhas.find(r => r.status === 'confirmado') || null;

/** Os valores de um recebimento de boleto: o que era devido (valor − abatimento) e o que entrou. */
function valoresDoBoleto(boleto, dados = {}) {
  const valor = centavos(boleto?.valor);
  const abatimento = centavos(boleto?.valor_abatimento || 0);
  const devido = centavos(valor - abatimento);
  const informado = Number(dados.valor);
  const pago = Number(boleto?.valor_pago);
  const recebido = centavos(Number.isFinite(informado) && informado > 0 ? informado : (Number.isFinite(pago) && pago > 0 ? pago : devido));
  return { valor_parcela: valor, valor_abatimento: abatimento, valor_recebido: recebido, valor_encargos: centavos(recebido - devido) };
}

const agora = () => new Date().toISOString();

/**
 * Grava o recebimento de um boleto pago (banco) ou quitado por fora. A
 * parcela que já tem recebimento confirmado não ganha outro: só completa a
 * data de crédito, quando o banco a informa depois.
 *
 * @param {object} p { api, boleto, origem, dados: { data, valor, canal, forma, dataCredito, observacao, eventoId }, usuarioId, hoje }
 */
async function doBoleto({ api, boleto, origem = 'boleto', dados = {}, usuarioId = null, hoje }) {
  const doPedido = await lerTodos(api, { pedido_id: boleto.pedido_id });
  const daMesma = daParcela(doPedido, boleto.pedido_id, boleto.numero_parcela);
  const confirmado = confirmadoDe(daMesma);
  if (confirmado) {
    const credito = dia(dados.dataCredito);
    if (credito && !dia(confirmado.data_credito) && Number(confirmado.boleto_id) === Number(boleto.id)) {
      await api.put(`/api/recebimentos/${confirmado.id}`, { data_credito: credito, atualizado_em: agora() });
      return { recebimento: { ...confirmado, data_credito: credito }, ja_existia: true, atualizado: true };
    }
    return { recebimento: confirmado, ja_existia: true };
  }

  const data = dia(dados.data) || dia(boleto.data_pagamento) || hoje;
  const doBoletoAntes = doPedido.filter(r => Number(r.boleto_id) === Number(boleto.id)).length;
  const valores = valoresDoBoleto(boleto, dados);
  const linha = {
    pedido_id: boleto.pedido_id, parcela_id: boleto.parcela_id ?? null, numero_parcela: boleto.numero_parcela,
    boleto_id: boleto.id, nota_fiscal_id: boleto.nota_fiscal_id ?? null,
    origem, forma: dados.forma || (origem === 'boleto' ? 'Boleto' : null),
    canal: String(dados.canal || (origem === 'boleto' ? boleto.canal_pagamento : '') || '').slice(0, 60) || null,
    data_recebimento: data, data_credito: dia(dados.dataCredito),
    ...valores,
    competencia: competenciaDe(data), status: 'confirmado',
    observacao: dados.observacao ? String(dados.observacao).slice(0, 500) : null,
    evento_id: dados.eventoId ?? null,
    chave_idempotencia: `boleto:${boleto.id}:${doBoletoAntes + 1}`,
    criado_por: usuarioId, criado_em: agora(), atualizado_em: agora()
  };
  let criado;
  try {
    criado = await api.post('/api/recebimentos', linha);
  } catch (e) {
    if (ehDuplicado(e)) return { recebimento: null, ja_existia: true };
    if (tabelaAusente(e)) throw erro(SQL_FALTANDO, 409, { sql_pendente: true });
    throw e;
  }
  const recebimento = { ...linha, ...(criado && typeof criado === 'object' && !Array.isArray(criado) ? criado : {}) };
  await boletos.registrarEvento(api, boleto.id, {
    origem: 'app', tipo: 'recebimento', nosso_numero: boleto.nosso_numero, usuario_id: usuarioId,
    mensagem: `Recebimento de ${reais(valores.valor_recebido)} em ${impressa(data)} lançado no Financeiro (competência ${competenciaDe(data).split('-').reverse().join('/')}).`
  });
  return { recebimento, ja_existia: false };
}

/** Estorna os recebimentos que vieram do banco para este boleto (o BB desfez a baixa). */
async function estornarDoBoleto({ api, boleto, motivo, usuarioId = null }) {
  const doPedido = await lerTodos(api, { pedido_id: boleto.pedido_id });
  const alvo = doPedido.filter(r => Number(r.boleto_id) === Number(boleto.id) && r.status === 'confirmado' && r.origem === 'boleto');
  for (const r of alvo) {
    await api.put(`/api/recebimentos/${r.id}`, { status: 'estornado', estornado_em: agora(), estornado_por: usuarioId, motivo_estorno: String(motivo || '').slice(0, 500), atualizado_em: agora() });
  }
  return alvo.length;
}

/** Confere o que chega da tela para um recebimento à mão. */
function validarManual(entrada, hoje) {
  const pedidoId = Number(entrada?.pedido_id);
  const numeroParcela = Number(entrada?.numero_parcela);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) throw erro('Escolha o pedido.');
  if (!Number.isInteger(numeroParcela) || numeroParcela <= 0) throw erro('Escolha a parcela.');
  const data = String(entrada?.data_recebimento || '').slice(0, 10);
  if (!dataValida(data)) throw erro('Informe a data em que o valor foi recebido.');
  if (data > hoje) throw erro('A data do recebimento não pode ser futura.');
  const valor = centavos(entrada?.valor_recebido);
  if (!(valor > 0)) throw erro('Informe o valor recebido.');
  const forma = String(entrada?.forma || '');
  if (!FORMAS.includes(forma)) throw erro(`Informe como o valor foi recebido (${FORMAS.join(', ')}).`);
  const observacao = String(entrada?.observacao || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  return { pedidoId, numeroParcela, data, valor, forma, observacao };
}

/**
 * Registra à mão o recebimento de uma parcela. Parcela com boleto em aberto
 * no BB não entra por aqui: o erro 409 traz `boleto_em_aberto`, e quem chama
 * decide baixar o boleto como quitado por fora (que grava o recebimento).
 */
async function registrarManual({ api, entrada, usuarioId = null, hoje }) {
  const v = validarManual(entrada, hoje);
  const dados = await boletos.lerPedidoCobranca(api, v.pedidoId);
  if (String(dados.pedido.situacao || '').toLowerCase() === 'cancelado') throw erro('Pedido cancelado não recebe.', 409);
  const parcela = dados.parcelas.find(p => Number(p.numero_parcela) === v.numeroParcela);
  if (!parcela) throw erro(`O pedido não tem a parcela ${v.numeroParcela}.`, 404);

  const existentes = daParcela(await lerTodos(api, { pedido_id: v.pedidoId }), v.pedidoId, v.numeroParcela);
  const confirmado = confirmadoDe(existentes);
  if (confirmado) throw erro(`A parcela ${v.numeroParcela} já tem recebimento de ${reais(confirmado.valor_recebido)} em ${impressa(dia(confirmado.data_recebimento))}. Estorne-o antes, se foi engano.`, 409);

  const boleto = boletos.boletoDaParcela(dados.boletos, parcela);
  if (boleto && boletos.STATUS_A_PAGAR.has(String(boleto.status))) {
    throw erro(`A parcela ${v.numeroParcela} tem boleto em aberto no BB (${boleto.nosso_numero}). Para registrar o recebimento, o boleto precisa ser baixado como quitado por fora.`, 409, {
      boleto_em_aberto: { id: boleto.id, nosso_numero: boleto.nosso_numero, ambiente: boleto.ambiente, valor: boleto.valor, data_vencimento: dia(boleto.data_vencimento) }
    });
  }
  if (boleto && boleto.status === 'pago') throw erro(`O boleto da parcela ${v.numeroParcela} já foi pago no banco: use "Conciliar com o BB" para lançar o recebimento.`, 409);

  const valorParcela = centavos(parcela.valor);
  const linha = {
    pedido_id: v.pedidoId, parcela_id: parcela.id ?? null, numero_parcela: v.numeroParcela, boleto_id: null,
    nota_fiscal_id: dados.notaViva?.id ?? null, origem: 'manual', forma: v.forma, canal: null,
    data_recebimento: v.data, data_credito: null,
    valor_parcela: valorParcela, valor_abatimento: 0, valor_recebido: v.valor, valor_encargos: centavos(v.valor - valorParcela),
    competencia: competenciaDe(v.data), status: 'confirmado', observacao: v.observacao || null, evento_id: null,
    chave_idempotencia: `manual:${v.pedidoId}:${v.numeroParcela}:${Date.now()}`,
    criado_por: usuarioId, criado_em: agora(), atualizado_em: agora()
  };
  try {
    const criado = await api.post('/api/recebimentos', linha);
    return { ...linha, ...(criado && typeof criado === 'object' && !Array.isArray(criado) ? criado : {}) };
  } catch (e) {
    if (ehDuplicado(e)) throw erro(`A parcela ${v.numeroParcela} já tem recebimento confirmado.`, 409);
    if (tabelaAusente(e)) throw erro(SQL_FALTANDO, 409, { sql_pendente: true });
    throw e;
  }
}

/**
 * A competência de comissão FECHADA que já congelou algum destes
 * recebimentos (ou null): mexer no mês dele depois desmancharia o fechamento.
 * Sem as tabelas do Financeiro, nenhuma.
 */
async function comissaoFechadaCom(api, recs) {
  if (!recs.length) return null;
  const ids = new Set(recs.map(r => String(r.id)));
  const [itens, fechamentos] = await Promise.all([
    Promise.all(recs.map(r => api.get('/api/financeiro_fechamento_itens', { query: { recebimento_id: r.id } }).then(lista).catch(() => []))).then(l => l.flat()),
    api.get('/api/financeiro_fechamentos', { query: { tipo: 'comissao' } }).then(lista).catch(() => [])
  ]);
  const fechados = new Map(fechamentos.filter(f => f && f.tipo === 'comissao' && String(f.status) === 'fechado').map(f => [String(f.id), f]));
  const item = itens.find(i => i && ids.has(String(i.recebimento_id)) && fechados.has(String(i.fechamento_id)));
  return item ? fechados.get(String(item.fechamento_id)) : null;
}

/**
 * Edita o pagamento registrado À MÃO (decisão do dono, 24/09/2026): data,
 * valor, forma e observação — antes só dava para estornar. O que veio do
 * banco (boleto pago, quitação por fora) não se edita aqui. A comissão usa o
 * valor da PARCELA, então mudar o valor recebido não mexe nela; mudar a data
 * para outro mês muda a competência, e isso é recusado se o pagamento já
 * entrou numa comissão fechada (estorne e registre de novo).
 */
async function editarManual({ api, id, entrada, usuarioId = null, hoje }) {
  const numeroId = Number(id);
  if (!Number.isInteger(numeroId) || numeroId <= 0) throw erro('Recebimento inválido.');
  const r = (await lerTodos(api, { id: numeroId }))[0];
  if (!r) throw erro('Recebimento não encontrado.', 404);
  if (r.status !== 'confirmado') throw erro('Este pagamento foi estornado: registre de novo.', 409);
  if (r.origem !== 'manual') throw erro('Só o pagamento registrado à mão se edita aqui: o do boleto vem do banco.', 409);
  const v = validarManual({ ...entrada, pedido_id: r.pedido_id, numero_parcela: r.numero_parcela }, hoje);
  const competencia = competenciaDe(v.data);
  const antes = String(r.competencia || competenciaDe(r.data_recebimento)).trim();
  if (competencia !== antes) {
    const fechada = await comissaoFechadaCom(api, [r]);
    if (fechada) {
      throw erro(`Este pagamento já entrou na comissão de ${String(fechada.competencia).split('-').reverse().join('/')}, que está fechada: não dá para mudá-lo de mês. Estorne e registre de novo.`, 409);
    }
  }
  const campos = {
    data_recebimento: v.data, valor_recebido: v.valor, valor_encargos: centavos(v.valor - centavos(r.valor_parcela)),
    forma: v.forma, observacao: v.observacao || null, competencia, atualizado_em: agora()
  };
  await api.put(`/api/recebimentos/${r.id}`, campos);
  return { ...r, ...campos, editado_por: usuarioId };
}

/**
 * Estorna um recebimento lançado por engano. O que veio do banco não se
 * estorna aqui (só o BB desfaz o pagamento). Estornar uma quitação por fora
 * libera a parcela para um boleto novo: o boleto baixado passa a dizer
 * "quitação estornada".
 */
async function estornar({ api, id, motivo, usuarioId = null }) {
  const texto = String(motivo || '').replace(/\s+/g, ' ').trim();
  if (texto.length < 5) throw erro('Diga o motivo do estorno.');
  const numeroId = Number(id);
  if (!Number.isInteger(numeroId) || numeroId <= 0) throw erro('Recebimento inválido.');
  const r = (await lerTodos(api, { id: numeroId }))[0];
  if (!r) throw erro('Recebimento não encontrado.', 404);
  if (r.status !== 'confirmado') throw erro('Este recebimento já foi estornado.', 409);
  if (r.origem === 'boleto') throw erro('Este recebimento veio do banco (boleto pago): só o Banco do Brasil desfaz o pagamento.', 409);

  const campos = { status: 'estornado', estornado_em: agora(), estornado_por: usuarioId, motivo_estorno: texto.slice(0, 500), atualizado_em: agora() };
  await api.put(`/api/recebimentos/${r.id}`, campos);
  if (r.origem === 'quitado_por_fora' && r.boleto_id) {
    const boleto = await boletos.ler(api, r.boleto_id).catch(() => null);
    if (boleto && boleto.status === 'baixado' && boleto.motivo_baixa === 'quitado_por_fora') {
      await boletos.atualizarBoleto(api, boleto, { motivo_baixa: 'quitacao_estornada', data_pagamento: null, valor_pago: null });
      await boletos.registrarEvento(api, boleto.id, {
        tipo: 'quitacao_estornada', nosso_numero: boleto.nosso_numero, usuario_id: usuarioId,
        mensagem: `Recebimento por fora estornado: ${texto}. A parcela pode ganhar um boleto novo.`
      });
    }
  }
  return { ...r, ...campos };
}

module.exports = {
  ORIGENS, FORMAS, SQL_FALTANDO,
  dia, dataValida, competenciaDe, tabelaAusente, ehDuplicado, lerTodos, tabelaPronta, valoresDoBoleto,
  doBoleto, estornarDoBoleto, validarManual, registrarManual, estornar, comissaoFechadaCom, editarManual
};
