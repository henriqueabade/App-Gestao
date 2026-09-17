/**
 * Boletos por parcela — a orquestração da fase B.
 *
 *   1. lê pedido, parcelas, cliente, a NF-e viva e os boletos que já existem;
 *   2. para cada parcela pedida que ainda não tem boleto vivo: reaproveita a
 *      linha com erro (mesmo nosso número) ou RESERVA um nosso número novo —
 *      o UNIQUE (ambiente, nosso_numero) do banco decide a corrida, quem
 *      perde pega o próximo sequencial — e avança o sequencial na configuração;
 *   3. registra no BB (POST /boletos) e grava linha digitável, código de
 *      barras e Pix; se o BB recusar, a linha fica "erro" com o motivo e o
 *      número volta a ser reaproveitado na próxima tentativa.
 *
 * Tudo fala com o banco pelo `api` genérico (sem transação); cada passo
 * deixa rastro em boletos_eventos.
 */
const configuracao = require('./configuracaoCobranca');
const bbBoleto = require('./bbBoleto');
const calculo = require('./boletoCalculo');

const STATUS_VIVOS = new Set(['registrado', 'pago', 'vencido', 'protestado']);
/** Os que ainda se pagam: entram no PDF "todos os boletos do pedido". */
const STATUS_A_PAGAR = new Set(['registrado', 'vencido', 'protestado']);
const STATUS_REUTILIZAVEIS = new Set(['reservado', 'erro']);
/**
 * Baixa que resolve a parcela (fase D): quitada por fora ou cobrança
 * cancelada. A parcela não ganha boleto novo sozinha; a baixa para
 * reemissão (ou a do próprio banco, por prazo) deixa gerar outro.
 */
const MOTIVOS_QUE_ENCERRAM = new Set(['quitado_por_fora', 'cancelado']);
const TENTATIVAS_NUMERO = 30;
/** Quantas vezes o registro troca de nosso número quando o BB diz que ele já existe. */
const TENTATIVAS_NO_BB = 5;

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
/**
 * Lista vai como texto JSON: pela API remota o `pg` transformaria o array em
 * array do Postgres ("{a,b}"), que a coluna JSONB (instrucoes) recusa. O
 * cliente local (DEV) já fazia isso; assim os dois caminhos gravam igual.
 */
const paraGravar = campos => Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : v]));
const primeiroId = criado => criado?.id ?? criado?.data?.id ?? criado?.[0]?.id ?? null;

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** A linha sem os campos pesados (payloads guardados). */
function enxuto(boleto) {
  if (!boleto) return null;
  const { requisicao, resposta, pix_emv, ...resto } = boleto;
  return { ...resto, tem_pix: Boolean(pix_emv) };
}

function ehNumeroDuplicado(err) {
  const partes = [err?.body?.detalhe, err?.body?.detail, err?.body?.message, err?.body?.error, err?.message]
    .filter(Boolean).join(' ').toLowerCase();
  return partes.includes('boletos_nosso_numero_unico') || partes.includes('chave_idempotencia')
    || partes.includes('duplicate key') || partes.includes('23505') || err?.status === 409;
}

async function registrarEvento(api, boletoId, { origem = 'app', tipo, nosso_numero = null, mensagem = null, payload = null, usuario_id = null }) {
  try {
    await api.post('/api/boletos_eventos', {
      boleto_id: boletoId, origem, tipo, nosso_numero,
      mensagem: mensagem ? String(mensagem).slice(0, 2000) : null,
      payload, processado_em: new Date().toISOString(), usuario_id, criado_em: new Date().toISOString()
    });
  } catch (e) {
    console.error(`Evento de boleto não gravado (boleto ${boletoId}, ${tipo}):`, e.message);
  }
}

// -------------------------------------------------------------- leitura

/** Pedido, parcelas (por número), cliente, NF-e viva e boletos do pedido, em paralelo. */
async function lerPedidoCobranca(api, pedidoId) {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) throw erro('Pedido inválido.');
  const [pedidos, parcelas, notas, boletos, cfg] = await Promise.all([
    api.get('/api/pedidos', { query: { id } }).then(lista),
    api.get('/api/pedido_parcelas', { query: { pedido_id: id } }).then(lista).catch(() => []),
    api.get('/api/notas_fiscais', { query: { pedido_id: id } }).then(lista).catch(() => []),
    api.get('/api/boletos', { query: { pedido_id: id } }).then(lista).catch(() => []),
    configuracao.carregar(api)
  ]);
  const pedido = pedidos.find(p => Number(p?.id) === id) || null;
  if (!pedido) throw erro('Pedido não encontrado.', 404);
  const cliente = pedido.cliente_id
    ? await api.get('/api/clientes', { query: { id: pedido.cliente_id } }).then(r => lista(r)[0] || null).catch(() => null)
    : null;
  const notaViva = notas
    .filter(n => n && ['autorizada'].includes(String(n.status_fiscal)))
    .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  return {
    pedido, cliente, configuracao: cfg, notaViva,
    parcelas: parcelas.filter(p => Number(p?.pedido_id) === id).sort((a, b) => (Number(a.numero_parcela) || 0) - (Number(b.numero_parcela) || 0)),
    boletos: boletos.filter(b => Number(b?.pedido_id) === id).sort((a, b) => Number(b.id) - Number(a.id))
  };
}

/** O boleto ocupa a parcela: vivo, ou baixado por quitação por fora / cancelamento. */
function ocupaParcela(b) {
  if (!b) return false;
  if (STATUS_VIVOS.has(String(b.status))) return true;
  return String(b.status) === 'baixado' && MOTIVOS_QUE_ENCERRAM.has(String(b.motivo_baixa || ''));
}

function boletosDaParcela(boletos, parcela) {
  return (boletos || []).filter(b => b && (Number(b.parcela_id) === Number(parcela?.id)
    || (b.parcela_id === null && Number(b.numero_parcela) === Number(parcela?.numero_parcela))));
}

/** O boleto que vale para a parcela (vivo mais novo); senão o reaproveitável mais novo; senão null. */
function boletoDaParcela(boletos, parcela) {
  const daParcela = boletosDaParcela(boletos, parcela);
  return daParcela.find(b => STATUS_VIVOS.has(String(b.status)))
    || daParcela.find(ocupaParcela)
    || daParcela.find(b => STATUS_REUTILIZAVEIS.has(String(b.status)))
    || null;
}

/**
 * As parcelas com o boleto de cada uma — o que a tela do pedido mostra.
 * Sem boleto que valha, aparece o último (baixado), para a tela mostrar o
 * histórico; a parcela continua livre para gerar outro.
 */
function parcelasComBoletos({ parcelas, boletos }) {
  return (parcelas || []).map(p => {
    const b = boletoDaParcela(boletos, p)
      || boletosDaParcela(boletos, p).sort((x, y) => Number(y.id) - Number(x.id))[0]
      || null;
    return { parcela: p, boleto: enxuto(b), tem_boleto_vivo: ocupaParcela(b) };
  });
}

function resumo(boletos) {
  const vivos = (boletos || []).filter(b => STATUS_VIVOS.has(String(b.status)));
  return {
    total: (boletos || []).length,
    registrados: vivos.length,
    pagos: vivos.filter(b => b.status === 'pago').length,
    com_erro: (boletos || []).filter(b => b.status === 'erro').length,
    valor_registrado: Math.round(vivos.reduce((s, b) => s + Number(b.valor || 0), 0) * 100) / 100
  };
}

// -------------------------------------------------------------- registro

/** Reserva um nosso número novo: linha "reservado" com o UNIQUE; avança o sequencial. */
async function reservarBoleto({ api, cfg, ambiente, base, usuarioId }) {
  const campo = ambiente === configuracao.PRODUCAO ? 'proximo_sequencial_producao' : 'proximo_sequencial_sandbox';
  const inicio = configuracao.proximoSequencial(cfg, ambiente);
  for (let i = 0; i < TENTATIVAS_NUMERO; i++) {
    const sequencial = inicio + i;
    const nn = calculo.nossoNumero(configuracao.dadosDaConta(cfg, ambiente).convenio, sequencial);
    const linha = {
      ...base, sequencial, nosso_numero: nn.numeroTituloCliente, nosso_numero_dv: nn.dv,
      chave_idempotencia: `${ambiente}:${nn.numeroTituloCliente}`
    };
    let criada;
    try {
      criada = await api.post('/api/boletos', paraGravar(linha));
    } catch (e) {
      if (ehNumeroDuplicado(e)) continue;
      throw e;
    }
    const id = primeiroId(criada);
    if (!id) throw erro('A API não devolveu o id do boleto criado.', 502);
    await configuracao.gravar(api, { [campo]: sequencial + 1 }, usuarioId);
    const reservado = { ...linha, ...(criada && typeof criada === 'object' && !Array.isArray(criada) ? criada : {}), id };
    await registrarEvento(api, id, { tipo: 'reservado', nosso_numero: nn.numeroTituloCliente, mensagem: `Nosso número ${nn.formatado} reservado (${ambiente}).`, usuario_id: usuarioId });
    return reservado;
  }
  throw erro(`Não foi possível reservar um nosso número (${TENTATIVAS_NUMERO} tentativas).`, 409);
}

/** O BB recusou porque o nosso número já existe lá (código 4874915). */
function ehNossoNumeroJaIncluido(err) {
  const texto = `${err?.message || ''} ${JSON.stringify(err?.extra?.bb || '')}`;
  return /4874915/.test(texto) || /nosso n[uú]mero j[aá] inclu/i.test(texto);
}

/**
 * Troca o nosso número de um boleto ainda não registrado pelo próximo livre
 * (UNIQUE do banco + sequencial da configuração) e deixa rastro.
 */
async function renumerar({ api, boleto, ambiente, usuarioId, motivo }) {
  const cfg = await configuracao.carregar(api, { forcar: true });
  const campo = ambiente === configuracao.PRODUCAO ? 'proximo_sequencial_producao' : 'proximo_sequencial_sandbox';
  const convenio = configuracao.dadosDaConta(cfg, ambiente).convenio;
  const inicio = Math.max(configuracao.proximoSequencial(cfg, ambiente), Number(boleto.sequencial) + 1);
  for (let i = 0; i < TENTATIVAS_NUMERO; i++) {
    const sequencial = inicio + i;
    const nn = calculo.nossoNumero(convenio, sequencial);
    let atualizado;
    try {
      atualizado = await atualizarBoleto(api, boleto, {
        sequencial, nosso_numero: nn.numeroTituloCliente, nosso_numero_dv: nn.dv, chave_idempotencia: `${ambiente}:${nn.numeroTituloCliente}`
      });
    } catch (e) {
      if (ehNumeroDuplicado(e)) continue;
      throw e;
    }
    await configuracao.gravar(api, { [campo]: sequencial + 1 }, usuarioId);
    await registrarEvento(api, boleto.id, {
      tipo: 'renumerado', nosso_numero: nn.numeroTituloCliente,
      mensagem: `Nosso número ${boleto.nosso_numero} já existia no BB; trocado por ${nn.formatado}. (${String(motivo || '').slice(0, 300)})`, usuario_id: usuarioId
    });
    return atualizado;
  }
  throw erro(`Não foi possível achar um nosso número livre (${TENTATIVAS_NUMERO} tentativas).`, 409);
}

async function atualizarBoleto(api, boleto, campos) {
  const payload = { ...campos, atualizado_em: new Date().toISOString() };
  const r = await api.put(`/api/boletos/${boleto.id}`, paraGravar(payload));
  return { ...boleto, ...payload, ...(r && typeof r === 'object' && !Array.isArray(r) ? r : {}) };
}

/**
 * Registra os boletos das parcelas pedidas (todas as sem boleto vivo quando
 * `parcelaIds` vem vazio). Nunca para no primeiro erro: devolve o resultado
 * parcela a parcela, para a tela dizer o que saiu e o que não.
 *
 * Reemissão (fase D): `vencimentos` ({ [parcelaId]: 'YYYY-MM-DD' }) troca o
 * vencimento do boleto novo sem mexer na parcela, e `substituiBoletoId`
 * liga o novo ao baixado. Uma reemissão que falhou guarda a data: tentar de
 * novo pelo pedido usa a mesma.
 *
 * @param {object} p { api, pedidoId, parcelaIds, notaFiscalId, cliente (do BB: chamar/credenciais), ambiente, cfg, usuarioId, hoje, vencimentos, substituiBoletoId }
 */
async function registrar({ api, pedidoId, parcelaIds = [], notaFiscalId = null, bb, credenciais, appKey, ambiente, cfg, usuarioId = null, hoje, vencimentos = {}, substituiBoletoId = null }) {
  const dados = await lerPedidoCobranca(api, pedidoId);
  const cfgCobranca = cfg || dados.configuracao;
  if (!cfgCobranca) throw erro('Configuração de cobrança ainda não cadastrada (rode sql/cobranca_base.sql).', 409);
  if (String(dados.pedido.situacao || '').toLowerCase() === 'cancelado') throw erro('Pedido cancelado não gera boleto.', 409);
  if (!dados.parcelas.length) throw erro('O pedido não tem parcelas: cadastre o pagamento antes de gerar boletos.', 409);

  const pedidas = new Set((parcelaIds || []).map(Number).filter(Number.isFinite));
  const alvo = dados.parcelas.filter(p => (pedidas.size ? pedidas.has(Number(p.id)) : true));
  if (!alvo.length) throw erro('Nenhuma parcela encontrada para gerar boleto.', 404);

  const notaId = notaFiscalId ?? dados.notaViva?.id ?? null;
  const notaNumero = dados.notaViva ? `${dados.notaViva.numero} SERIE ${dados.notaViva.serie}` : null;
  const resultados = [];

  for (const parcela of alvo) {
    const existente = boletoDaParcela(dados.boletos, parcela);
    if (ocupaParcela(existente)) {
      resultados.push({ parcela_id: parcela.id, numero_parcela: parcela.numero_parcela, ok: true, ja_existia: true, boleto: enxuto(existente) });
      continue;
    }
    const substitui = substituiBoletoId ?? existente?.substitui_boleto_id ?? null;
    const vencimentoNovo = vencimentos?.[parcela.id]
      || (existente?.substitui_boleto_id ? String(existente.data_vencimento || '').slice(0, 10) : null);
    const parcelaDoBoleto = vencimentoNovo ? { ...parcela, data_vencimento: vencimentoNovo } : parcela;

    let montado;
    try {
      const sequencial = existente ? Number(existente.sequencial) : configuracao.proximoSequencial(cfgCobranca, ambiente);
      montado = bbBoleto.montarRegistro({ cfg: cfgCobranca, ambiente, sequencial, pedido: dados.pedido, parcela: parcelaDoBoleto, cliente: dados.cliente, hoje, notaNumero });
    } catch (e) {
      resultados.push({ parcela_id: parcela.id, numero_parcela: parcela.numero_parcela, ok: false, erro: e.message, pendencias: e.extra?.pendencias || [] });
      continue;
    }

    const base = {
      pedido_id: dados.pedido.id, parcela_id: parcela.id, numero_parcela: parcela.numero_parcela, nota_fiscal_id: notaId,
      ambiente, convenio: String(montado.conta.convenio), carteira: Number(montado.conta.carteira), variacao: Number(montado.conta.variacao),
      numero_documento: montado.numeroDocumento, valor: montado.valor, data_emissao: montado.emissao, data_vencimento: montado.vencimento,
      juros_valor_dia: montado.encargos.juros?.valorDia ?? null, juros_percentual_mes: montado.encargos.juros?.percentualMes ?? montado.encargos.juros?.percentual ?? null,
      multa_percentual: montado.encargos.multa?.percentual ?? null, protesto_dias: montado.encargos.protesto?.dias ?? null,
      dias_limite_recebimento: montado.encargos.diasLimiteRecebimento, pagador: montado.pagador, instrucoes: montado.encargos.instrucoes,
      status: 'reservado', erro: null, requisicao: montado.payload, resposta: null, criado_por: usuarioId,
      ...(substitui ? { substitui_boleto_id: Number(substitui) } : {})
    };

    let boleto;
    try {
      if (existente) {
        boleto = await atualizarBoleto(api, existente, { ...base, status: 'reservado' });
        await registrarEvento(api, boleto.id, { tipo: 'reservado', nosso_numero: boleto.nosso_numero, mensagem: `Nosso número reaproveitado (estava "${existente.status}").`, usuario_id: usuarioId });
      } else {
        boleto = await reservarBoleto({ api, cfg: cfgCobranca, ambiente, base, usuarioId });
      }
    } catch (e) {
      resultados.push({ parcela_id: parcela.id, numero_parcela: parcela.numero_parcela, ok: false, erro: e.message });
      continue;
    }
    // O payload vai com o nosso número que foi reservado de fato (pode ter pulado por corrida).
    let payload = { ...montado.payload, numeroTituloCliente: boleto.nosso_numero };

    try {
      let resposta;
      for (let tentativa = 1; ; tentativa++) {
        try {
          resposta = await bb.chamar({ ambiente, appKey, credenciais, metodo: 'POST', caminho: '/boletos', corpo: payload });
          break;
        } catch (e) {
          // O BB já tem esse nosso número (na homologação o convênio de teste é
          // de todos os desenvolvedores): pula para o próximo livre e tenta de novo.
          if (!ehNossoNumeroJaIncluido(e) || tentativa >= TENTATIVAS_NO_BB) throw e;
          boleto = await renumerar({ api, boleto, ambiente, usuarioId, motivo: e.message });
          payload = { ...payload, numeroTituloCliente: boleto.nosso_numero };
        }
      }
      const lido = bbBoleto.lerRetornoRegistro(resposta);
      boleto = await atualizarBoleto(api, boleto, { ...lido, status: 'registrado', codigo_estado_bb: '01', situacao_bb: 'Normal', erro: null, requisicao: payload, resposta });
      await registrarEvento(api, boleto.id, { tipo: 'registrado', nosso_numero: boleto.nosso_numero, mensagem: `Registrado no BB (${ambiente}): ${lido.linha_digitavel || lido.numero_bb || 'sem linha digitável'}`, payload: lido, usuario_id: usuarioId });
      dados.boletos.unshift(boleto);
      resultados.push({ parcela_id: parcela.id, numero_parcela: parcela.numero_parcela, ok: true, boleto: enxuto(boleto) });
    } catch (e) {
      const detalhe = e?.extra?.bb ? { bb: e.extra.bb, http: e.extra.http } : null;
      boleto = await atualizarBoleto(api, boleto, { status: 'erro', erro: String(e.message || e).slice(0, 2000), requisicao: payload, resposta: detalhe?.bb || null }).catch(() => boleto);
      await registrarEvento(api, boleto.id, { tipo: 'erro', nosso_numero: boleto.nosso_numero, mensagem: e.message, payload: detalhe, usuario_id: usuarioId });
      dados.boletos.unshift(boleto);
      resultados.push({ parcela_id: parcela.id, numero_parcela: parcela.numero_parcela, ok: false, erro: e.message, boleto: enxuto(boleto) });
    }
  }

  return {
    pedido: { id: dados.pedido.id, numero: dados.pedido.numero },
    ambiente,
    resultados,
    registrados: resultados.filter(r => r.ok && !r.ja_existia).length,
    erros: resultados.filter(r => !r.ok).length,
    resumo: resumo(dados.boletos)
  };
}

async function listar(api, { pedido_id } = {}) {
  const query = pedido_id ? { pedido_id: Number(pedido_id) } : {};
  const boletos = await api.get('/api/boletos', { query }).then(lista).catch(() => []);
  return boletos.map(enxuto).sort((a, b) => Number(b.id) - Number(a.id));
}

async function ler(api, boletoId) {
  const id = Number(boletoId);
  if (!Number.isInteger(id) || id <= 0) throw erro('Boleto inválido.');
  const b = await api.get('/api/boletos', { query: { id } }).then(r => lista(r).find(x => Number(x?.id) === id) || null);
  if (!b) throw erro('Boleto não encontrado.', 404);
  return b;
}

module.exports = {
  STATUS_VIVOS, STATUS_A_PAGAR, STATUS_REUTILIZAVEIS, MOTIVOS_QUE_ENCERRAM, TENTATIVAS_NUMERO, TENTATIVAS_NO_BB,
  enxuto, ehNumeroDuplicado, ehNossoNumeroJaIncluido, renumerar, registrarEvento, lerPedidoCobranca, ocupaParcela, boletoDaParcela, parcelasComBoletos, resumo,
  reservarBoleto, atualizarBoleto, registrar, listar, ler
};
