/**
 * Emissão da NF-e a partir do pedido — a orquestração da etapa 3.
 *
 *   1. lê pedido, itens, parcelas, cliente, peças, notas e configuração;
 *   2. avalia a prontidão (prontidao.js) e resolve o código IBGE que faltar;
 *   3. reserva o número (UNIQUE ambiente/série/número no banco decide quem
 *      ganha a corrida; quem perde pega o próximo) ou reaproveita a nota
 *      rejeitada anterior do pedido (rejeição não consome numeração);
 *   4. monta (xmlNfe.js) e assina (assinatura.js) o XML;
 *   5. grava a nota como "enviando" ANTES de sair para a SEFAZ — se a luz
 *      cair no meio, a consulta pela chave resolve depois (sincronizar);
 *   6. envia, interpreta o protocolo e grava o resultado com os eventos.
 *
 * Tudo que fala com o banco passa pelo `api` genérico (sem transação); por
 * isso a ordem acima importa e cada passo deixa rastro em notas_fiscais_eventos.
 * `transporte`, relógio e aleatório são injetáveis para os testes.
 */
const configuracao = require('./configuracaoFiscal');
const municipios = require('./municipios');
const prontidao = require('./prontidao');
const xmlNfe = require('./xmlNfe');
const assinatura = require('./assinatura');
const sefaz = require('./sefazCliente');

const STATUS_REUTILIZAVEIS = new Set(['rascunho', 'rejeitada', 'erro_tecnico']);
const TENTATIVAS_NUMERO = 30;

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const digitos = v => String(v ?? '').replace(/\D/g, '');
const primeiroId = criado => criado?.id ?? criado?.data?.id ?? criado?.[0]?.id ?? null;

function erro(mensagem, status = 400, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** A nota sem os XMLs (que pesam) — o que as listas e respostas devolvem. */
function semXml(nota) {
  if (!nota) return null;
  const { xml_envio, xml_autorizado, xml_cancelamento, ...resto } = nota;
  return { ...resto, tem_xml_envio: Boolean(xml_envio), tem_xml_autorizado: Boolean(xml_autorizado), tem_xml_cancelamento: Boolean(xml_cancelamento) };
}

// -------------------------------------------------------------- leitura

/** Tudo que a prontidão e a emissão precisam, em leituras paralelas. */
async function lerPedidoFiscal(api, pedidoId) {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) throw erro('Pedido inválido.');
  const [pedidos, itens, parcelas, notas, cfg] = await Promise.all([
    api.get('/api/pedidos', { query: { id } }).then(lista),
    api.get('/api/pedidos_itens', { query: { pedido_id: id } }).then(lista).catch(() => []),
    api.get('/api/pedido_parcelas', { query: { pedido_id: id } }).then(lista).catch(() => []),
    // Sem a tabela (SQL não rodou) a avaliação segue: as outras pendências já dizem o que falta.
    api.get('/api/notas_fiscais', { query: { pedido_id: id } }).then(lista).catch(() => []),
    configuracao.carregar(api)
  ]);
  const pedido = pedidos.find(p => Number(p?.id) === id) || null;
  if (!pedido) throw erro('Pedido não encontrado.', 404);

  const cliente = pedido.cliente_id
    ? await api.get('/api/clientes', { query: { id: pedido.cliente_id } }).then(r => lista(r)[0] || null).catch(() => null)
    : null;
  const idsProdutos = [...new Set(itens.map(i => i?.produto_id).filter(v => v !== null && v !== undefined))];
  const produtos = await Promise.all(idsProdutos.map(pid =>
    api.get('/api/produtos', { query: { id: pid } }).then(r => lista(r)[0] || null).catch(() => null)));

  return {
    pedido, itens, parcelas, cliente, produtos, configuracao: cfg,
    notas: notas.filter(n => Number(n?.pedido_id) === id).sort((a, b) => Number(b.id) - Number(a.id))
  };
}

async function lerNota(api, notaId) {
  const id = Number(notaId);
  if (!Number.isInteger(id) || id <= 0) throw erro('Nota inválida.');
  const nota = await api.get('/api/notas_fiscais', { query: { id } }).then(r => lista(r).find(n => Number(n?.id) === id) || null);
  if (!nota) throw erro('Nota fiscal não encontrada.', 404);
  return nota;
}

/**
 * Cartas de correção registradas por nota, a partir dos eventos 'cce' (uma
 * leitura só para a lista inteira): quantas há e a sequência da última — a
 * que vale, porque cada carta substitui as anteriores. Pura.
 */
function cartasPorNota(eventos) {
  const porNota = {};
  for (const e of Array.isArray(eventos) ? eventos : []) {
    if (!e || e.tipo !== 'cce' || !['135', '136'].includes(String(e.codigo_sefaz))) continue;
    let det = e.detalhe;
    if (typeof det === 'string') { try { det = JSON.parse(det || '{}'); } catch (_) { det = {}; } }
    const seq = Number(det?.nSeqEvento) || 1;
    const chave = String(e.nota_fiscal_id);
    const atual = porNota[chave] || { cartas_correcao: 0, ultima_carta_seq: 0 };
    porNota[chave] = { cartas_correcao: atual.cartas_correcao + 1, ultima_carta_seq: Math.max(atual.ultima_carta_seq, seq) };
  }
  return porNota;
}

/** As notas sem XML, com a contagem de cartas de correção (`cartas_correcao`, `ultima_carta_seq`). */
async function listarNotas(api, { pedido_id } = {}) {
  const query = pedido_id ? { pedido_id: Number(pedido_id) } : {};
  const [notas, eventosCce] = await Promise.all([
    api.get('/api/notas_fiscais', { query }).then(lista).catch(() => []),
    api.get('/api/notas_fiscais_eventos', { query: { tipo: 'cce' } }).then(lista).catch(() => [])
  ]);
  const cartas = cartasPorNota(eventosCce);
  return notas.map(semXml)
    .map(n => ({ ...n, ...(cartas[String(n.id)] || { cartas_correcao: 0, ultima_carta_seq: null }) }))
    .sort((a, b) => Number(b.id) - Number(a.id));
}

// -------------------------------------------------------------- gravação

async function atualizarNota(api, nota, dados) {
  const payload = { ...dados, atualizado_em: new Date().toISOString() };
  await api.put(`/api/notas_fiscais/${nota.id}`, payload);
  return { ...nota, ...payload };
}

/** Auditoria: nunca derruba a emissão — o que falhar aqui vai só para o log. */
async function registrarEvento(api, notaId, { tipo, status_anterior = null, status_novo = null, codigo_sefaz = null, mensagem = null, detalhe = null, usuario_id = null }) {
  try {
    await api.post('/api/notas_fiscais_eventos', {
      nota_fiscal_id: notaId, tipo, status_anterior, status_novo, codigo_sefaz,
      mensagem: mensagem ? String(mensagem).slice(0, 2000) : null, detalhe, usuario_id, criado_em: new Date().toISOString()
    });
  } catch (e) {
    console.error(`Evento fiscal não gravado (nota ${notaId}, ${tipo}):`, e.message);
  }
}

async function apagarItens(api, notaId) {
  const itens = await api.get('/api/notas_fiscais_itens', { query: { nota_fiscal_id: notaId } }).then(lista).catch(() => []);
  for (const item of itens) {
    if (item?.id) await api.delete(`/api/notas_fiscais_itens/${item.id}`);
  }
}

async function gravarItens(api, notaId, itens) {
  for (const item of itens) await api.post('/api/notas_fiscais_itens', { ...item, nota_fiscal_id: notaId });
}

/** O banco disse que o número (ou a chave de idempotência) já existe. */
function ehNumeroDuplicado(err) {
  const partes = [err?.body?.detalhe, err?.body?.detail, err?.body?.message, err?.body?.error, err?.message]
    .filter(Boolean).join(' ').toLowerCase();
  return partes.includes('notas_fiscais_numero_unico') || partes.includes('chave_idempotencia')
    || partes.includes('duplicate key') || partes.includes('23505') || err?.status === 409;
}

/**
 * Cria a nota com o próximo número e avança a numeração. A corrida entre duas
 * máquinas é decidida pelo UNIQUE do banco: perdeu, tenta o número seguinte.
 */
async function reservarNumero({ api, cfg, ambiente, base, usuarioId }) {
  const { serie, proximoNumero } = configuracao.numeracao(cfg, ambiente);
  const campoProximo = ambiente === configuracao.PRODUCAO ? 'proximo_numero_producao' : 'proximo_numero_homologacao';
  for (let i = 0; i < TENTATIVAS_NUMERO; i++) {
    const numero = proximoNumero + i;
    const linha = { ...base, serie, numero, chave_idempotencia: `${ambiente}:${serie}:${numero}:pedido-${base.pedido_id}` };
    let criada;
    try {
      criada = await api.post('/api/notas_fiscais', linha);
    } catch (e) {
      if (ehNumeroDuplicado(e)) continue;
      throw e;
    }
    const id = primeiroId(criada);
    if (!id) throw erro('A API não devolveu o id da nota criada.', 502);
    await configuracao.gravar(api, { [campoProximo]: numero + 1 }, usuarioId);
    return { ...linha, ...(criada && typeof criada === 'object' && !Array.isArray(criada) ? criada : {}), id, serie, numero };
  }
  throw erro(`Não foi possível reservar um número de NF-e (${TENTATIVAS_NUMERO} tentativas).`, 409);
}

const CAMPOS_TRANSPORTE_PEDIDO = {
  modalidade_frete: v => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  volumes_quantidade: v => (v === '' || v === null || v === undefined ? null : Number(v)),
  volumes_especie: v => (v === null || v === undefined ? null : String(v).trim().slice(0, 60) || null),
  peso_bruto: v => (v === '' || v === null || v === undefined ? null : Number(v)),
  peso_liquido: v => (v === '' || v === null || v === undefined ? null : Number(v)),
  transportadora_nome: v => (v === null || v === undefined ? undefined : String(v).trim().slice(0, 60) || undefined)
};

/**
 * Só as chaves que vieram; `transportadora_nome` grava em `pedidos.transportadora`.
 * Volumes detalhados (uma linha por volume) viram o resumo: quantidade total,
 * espécies distintas e pesos somados.
 */
function camposTransporteDoPedido(transporte) {
  const saida = {};
  const entrada = { ...(transporte || {}) };
  const detalhados = (Array.isArray(entrada.volumes) ? entrada.volumes : []).filter(v => v && typeof v === 'object');
  if (detalhados.length) {
    const soma = chave => detalhados.reduce((s, v) => s + (Number(v[chave]) || 0), 0);
    entrada.volumes_quantidade = detalhados.reduce((s, v) => s + Math.max(Number(v.quantidade) || 1, 1), 0);
    entrada.volumes_especie = [...new Set(detalhados.map(v => String(v.especie ?? '').trim()).filter(Boolean))].join(', ') || entrada.volumes_especie;
    entrada.peso_bruto = Math.round(soma('peso_bruto') * 1000) / 1000;
    entrada.peso_liquido = Math.round(soma('peso_liquido') * 1000) / 1000;
  }
  for (const [chave, limpar] of Object.entries(CAMPOS_TRANSPORTE_PEDIDO)) {
    if (!(chave in entrada)) continue;
    const valor = limpar(entrada[chave]);
    if (valor === undefined || Number.isNaN(valor)) continue;
    saida[chave === 'transportadora_nome' ? 'transportadora' : chave] = valor;
  }
  return saida;
}

async function gravarTransporteNoPedido(api, pedido, transporte) {
  const campos = camposTransporteDoPedido(transporte);
  if (!Object.keys(campos).length) return;
  try {
    await api.put(`/api/pedidos/${pedido.id}`, campos);
  } catch (e) {
    console.error(`Transporte não gravado no pedido ${pedido.id}:`, e.message);
  }
}

/** Nota do pedido que não chegou a existir para a SEFAZ: rejeitada, rascunho ou erro técnico. */
function notaReutilizavel(notas, ambiente, serie) {
  return (notas || [])
    .filter(n => n && n.ambiente === ambiente && Number(n.serie) === Number(serie) && STATUS_REUTILIZAVEIS.has(String(n.status_fiscal)))
    .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
}

// ------------------------------------------------------------- resultado

/**
 * Aplica o protocolo à nota: autorizada guarda o nfeProc; denegada e
 * rejeitada guardam o motivo. Rejeição e denegação viram erro 422 para a tela.
 */
async function concluirComProtocolo({ api, nota, protocolo, xmlAssinado, usuarioId, avisos = [] }) {
  const p = protocolo;
  const anterior = nota.status_fiscal;
  const sefazInfo = { cStat: p.cStat, xMotivo: p.xMotivo, protocolo: p.nProt, chave: p.chNFe || nota.chave_acesso, recibo: nota.recibo || null };

  if (p.situacao === 'autorizada') {
    if (anterior === 'autorizada' && nota.protocolo === p.nProt) {
      return { nota: semXml(nota), sefaz: sefazInfo, autorizada: true, avisos };
    }
    const xml = xmlAssinado || nota.xml_envio;
    const nfeProc = xml ? sefaz.montarNfeProc(xml, p.xml) : null;
    const atual = await atualizarNota(api, nota, {
      status_fiscal: 'autorizada', protocolo: p.nProt, data_autorizacao: p.dhRecbto, codigo_status_sefaz: p.cStat,
      motivo_sefaz: p.xMotivo, ...(nfeProc ? { xml_autorizado: nfeProc } : {})
    });
    await registrarEvento(api, nota.id, { tipo: 'autorizada', status_anterior: anterior, status_novo: 'autorizada', codigo_sefaz: p.cStat, mensagem: `${p.xMotivo} — protocolo ${p.nProt}`, detalhe: { avisos }, usuario_id: usuarioId });
    // Um pedido marcado "enviado sem NF-e" que ganha a nota depois perde a marca.
    // Sem a coluna (SQL não rodou) o PUT falha e é só isso.
    await api.put(`/api/pedidos/${nota.pedido_id}`, { nfe_dispensada: false }).catch(() => {});
    return { nota: semXml(atual), sefaz: sefazInfo, autorizada: true, avisos };
  }

  if (p.situacao === 'cancelada') {
    const atual = await atualizarNota(api, nota, { status_fiscal: 'cancelada', codigo_status_sefaz: p.cStat, motivo_sefaz: p.xMotivo, cancelada_em: nota.cancelada_em || p.dhRecbto });
    await registrarEvento(api, nota.id, { tipo: 'consulta', status_anterior: anterior, status_novo: 'cancelada', codigo_sefaz: p.cStat, mensagem: p.xMotivo, usuario_id: usuarioId });
    return { nota: semXml(atual), sefaz: sefazInfo, autorizada: false, avisos };
  }

  const status = p.situacao === 'denegada' ? 'denegada' : 'rejeitada';
  const atual = await atualizarNota(api, nota, { status_fiscal: status, codigo_status_sefaz: p.cStat, motivo_sefaz: p.xMotivo, ...(p.nProt ? { protocolo: p.nProt } : {}) });
  await registrarEvento(api, nota.id, { tipo: status, status_anterior: anterior, status_novo: status, codigo_sefaz: p.cStat, mensagem: p.xMotivo, usuario_id: usuarioId });
  throw erro(`SEFAZ ${p.cStat}: ${p.xMotivo}`, 422, { nota: semXml(atual), sefaz: sefazInfo, avisos });
}

/** Lote sem protocolo: recibo (assíncrono), rejeição do lote ou serviço parado. */
async function aplicarRetornoDoEnvio({ api, nota, retorno, xmlAssinado, usuarioId, uf, ambiente, transporte, esperar, avisos }) {
  if (retorno.protocolo) return concluirComProtocolo({ api, nota, protocolo: retorno.protocolo, xmlAssinado, usuarioId, avisos });
  const { cStat, xMotivo } = retorno;

  if ((cStat === '103' || cStat === '105') && retorno.recibo) {
    let atual = await atualizarNota(api, nota, { status_fiscal: 'processando', recibo: retorno.recibo, codigo_status_sefaz: cStat, motivo_sefaz: xMotivo });
    await registrarEvento(api, nota.id, { tipo: 'recibo', status_anterior: 'enviando', status_novo: 'processando', codigo_sefaz: cStat, mensagem: `${xMotivo} — recibo ${retorno.recibo}`, usuario_id: usuarioId });
    // Uma consulta depois do tempo médio informado; se ainda estiver processando, fica para o "Consultar".
    await esperar(Math.min(Math.max(Number(retorno.tempoMedioSegundos) || 1, 1), 5) * 1000);
    try {
      const r = await sefaz.consultarRecibo({ uf, ambiente, transporte, recibo: retorno.recibo });
      if (r.protocolo) return concluirComProtocolo({ api, nota: atual, protocolo: r.protocolo, xmlAssinado, usuarioId, avisos });
      if (!r.emProcessamento) {
        atual = await atualizarNota(api, atual, { status_fiscal: 'rejeitada', codigo_status_sefaz: r.cStat, motivo_sefaz: r.xMotivo });
        await registrarEvento(api, nota.id, { tipo: 'rejeitada', status_anterior: 'processando', status_novo: 'rejeitada', codigo_sefaz: r.cStat, mensagem: r.xMotivo, usuario_id: usuarioId });
        throw erro(`SEFAZ ${r.cStat}: ${r.xMotivo}`, 422, { nota: semXml(atual), sefaz: { cStat: r.cStat, xMotivo: r.xMotivo } });
      }
    } catch (e) {
      if (e.status === 422) throw e;
    }
    return { nota: semXml(atual), sefaz: { cStat, xMotivo, recibo: retorno.recibo, chave: nota.chave_acesso }, autorizada: false, processando: true, avisos };
  }

  // 204 = duplicidade: a SEFAZ já tem esta chave (um envio anterior chegou). A consulta diz o que aconteceu.
  if (cStat === '204' && nota.chave_acesso) {
    const r = await sefaz.consultarNfe({ uf, ambiente, transporte, chave: nota.chave_acesso }).catch(() => null);
    if (r?.protocolo) return concluirComProtocolo({ api, nota, protocolo: r.protocolo, xmlAssinado, usuarioId, avisos });
  }

  const status = ['108', '109'].includes(String(cStat)) ? 'erro_tecnico' : 'rejeitada';
  const atual = await atualizarNota(api, nota, { status_fiscal: status, codigo_status_sefaz: cStat, motivo_sefaz: xMotivo });
  await registrarEvento(api, nota.id, { tipo: status === 'rejeitada' ? 'rejeitada' : 'erro', status_anterior: 'enviando', status_novo: status, codigo_sefaz: cStat, mensagem: xMotivo, usuario_id: usuarioId });
  throw erro(`SEFAZ ${cStat}: ${xMotivo}`, 422, { nota: semXml(atual), sefaz: { cStat, xMotivo }, avisos });
}

// --------------------------------------------------------------- emissão

const travas = new Map();

/** Uma emissão por pedido de cada vez neste processo (o clique duplo é comum). */
async function comTrava(chave, fn) {
  const anterior = travas.get(chave) || Promise.resolve();
  let soltar;
  const minha = new Promise(r => { soltar = r; });
  travas.set(chave, anterior.then(() => minha));
  await anterior;
  try {
    return await fn();
  } finally {
    soltar();
    if (travas.get(chave) === minha) travas.delete(chave);
  }
}

/**
 * Emite a NF-e do pedido.
 *
 * @param {object} p
 * @param {object} p.api              cliente da API (createApiClient)
 * @param {number} p.pedidoId
 * @param {object} p.entrada          { ambiente?, transporte?, pagamento?, informacoes_complementares? }
 * @param {object} p.certificado      { chavePrivadaPem, certificadoPem } (do certificado.js)
 * @param {object} p.resumoCertificado resumo para a prontidão (configurado, vencido, confereComEmitente)
 * @param {function} p.transporte     função (url, corpo, cabeçalhos) -> {status, corpo}
 */
async function emitir({
  api, pedidoId, entrada = {}, certificado, resumoCertificado, transporte, env = process.env, usuarioId = null,
  agora = () => new Date(), aleatorio = Math.random, opcoesMunicipios, verProc, esperar = ms => new Promise(r => setTimeout(r, ms))
}) {
  return comTrava(`pedido:${pedidoId}`, async () => {
    const dados = await lerPedidoFiscal(api, pedidoId);
    const { pedido, cliente, itens, produtos, parcelas, configuracao: cfg } = dados;

    const avaliacao = prontidao.avaliar({ ...dados, certificado: resumoCertificado });
    if (!avaliacao.pronto) {
      throw erro('O pedido ainda não pode ser faturado. Veja as pendências.', 422, { pendencias: avaliacao.pendencias, resumo: avaliacao.resumo });
    }

    const efetivo = configuracao.ambienteEfetivo(cfg, env);
    const pedidoAmbiente = String(entrada.ambiente || efetivo).toLowerCase();
    const ambiente = pedidoAmbiente === configuracao.PRODUCAO && efetivo === configuracao.PRODUCAO ? configuracao.PRODUCAO : configuracao.HOMOLOGACAO;

    // Código IBGE do cliente: resolve pelo nome e guarda no cadastro para a próxima.
    let codigoMunicipio = digitos(cliente.reg_codigo_municipio);
    if (codigoMunicipio.length !== 7) {
      const uf = municipios.siglaDaUf(cliente.reg_uf);
      const r = await municipios.buscar(uf, cliente.reg_cidade, opcoesMunicipios);
      const achado = r.exato || (r.candidatos.length === 1 ? r.candidatos[0] : null);
      if (!achado) {
        throw erro(`Código IBGE de ${cliente.reg_cidade}/${uf} não encontrado pelo nome. Informe-o no cadastro do cliente (aba Endereços).`, 422, { candidatos: r.candidatos });
      }
      codigoMunicipio = achado.codigo;
      await api.put(`/api/clientes/${cliente.id}`, { reg_codigo_municipio: codigoMunicipio }).catch(() => {});
    }

    const { serie } = configuracao.numeracao(cfg, ambiente);
    const instante = agora();
    const base = {
      pedido_id: Number(pedido.id), ambiente, modelo: '55', status_fiscal: 'rascunho',
      natureza_operacao: xmlNfe.limparTexto(cfg.natureza_operacao, 60), data_emissao: instante.toISOString(), criado_por: usuarioId
    };
    let nota = notaReutilizavel(dados.notas, ambiente, serie);
    const reutilizada = Boolean(nota);
    if (nota) {
      await apagarItens(api, nota.id);
    } else {
      nota = await reservarNumero({ api, cfg, ambiente, base, usuarioId });
      await registrarEvento(api, nota.id, { tipo: 'criada', status_novo: 'rascunho', mensagem: `Número ${serie}/${nota.numero} reservado (${ambiente}).`, usuario_id: usuarioId });
    }

    let montada;
    try {
      montada = xmlNfe.montarNfe({
        configuracao: cfg, ambiente, serie, numero: nota.numero, dhEmi: instante,
        pedido, cliente, itens, produtos, parcelas, codigoMunicipioDestino: codigoMunicipio,
        transporte: {
          modalidade_frete: entrada.transporte?.modalidade_frete ?? pedido.modalidade_frete,
          volumes_quantidade: entrada.transporte?.volumes_quantidade ?? pedido.volumes_quantidade,
          volumes_especie: entrada.transporte?.volumes_especie ?? pedido.volumes_especie,
          peso_bruto: entrada.transporte?.peso_bruto ?? pedido.peso_bruto,
          peso_liquido: entrada.transporte?.peso_liquido ?? pedido.peso_liquido,
          transportadora_nome: entrada.transporte?.transportadora_nome ?? pedido.transportadora,
          valor_frete: entrada.transporte?.valor_frete,
          volumes: entrada.transporte?.volumes,
          volumes_marca: entrada.transporte?.volumes_marca
        },
        pagamento: entrada.pagamento || {},
        informacoesComplementares: entrada.informacoes_complementares,
        verProc, aleatorio
      });
    } catch (e) {
      const atual = await atualizarNota(api, nota, { status_fiscal: 'erro_tecnico', motivo_sefaz: e.message });
      await registrarEvento(api, nota.id, { tipo: 'erro', status_anterior: nota.status_fiscal, status_novo: 'erro_tecnico', mensagem: e.message, usuario_id: usuarioId });
      throw erro(e.message, e.status || 422, { nota: semXml(atual) });
    }
    const xmlAssinado = assinatura.assinarNfe(montada.xml, certificado);

    // O que foi informado no embarque fica no pedido (o DANFE e a próxima nota
    // partem dele). Não trava a emissão: a nota é o que importa aqui.
    await gravarTransporteNoPedido(api, pedido, entrada.transporte);

    nota = await atualizarNota(api, nota, {
      status_fiscal: 'enviando', codigo_numerico: montada.cNF, chave_acesso: montada.chave,
      natureza_operacao: base.natureza_operacao, data_emissao: instante.toISOString(),
      valor_produtos: montada.totais.valor_produtos, valor_desconto: montada.totais.valor_desconto,
      valor_frete: montada.totais.valor_frete, valor_total: montada.totais.valor_total,
      destinatario: montada.destinatario, xml_envio: xmlAssinado, xml_autorizado: null,
      protocolo: null, recibo: null, codigo_status_sefaz: null, motivo_sefaz: null, data_autorizacao: null
    });
    await gravarItens(api, nota.id, montada.itens);
    await registrarEvento(api, nota.id, {
      tipo: 'enviada', status_anterior: reutilizada ? 'rejeitada' : 'rascunho', status_novo: 'enviando',
      mensagem: `Enviada à SEFAZ-${configuracao.HOMOLOGACAO === ambiente ? 'MG (homologação)' : 'MG (produção)'}: chave ${montada.chave}.`,
      detalhe: { avisos: montada.avisos, reutilizada, tPag: montada.tPag, aPrazo: montada.aPrazo }, usuario_id: usuarioId
    });

    let retorno;
    try {
      retorno = await sefaz.autorizar({ uf: cfg.uf, ambiente, transporte, xmlNfe: xmlAssinado, idLote: String(nota.id) });
    } catch (e) {
      // Estourou o tempo: a nota PODE ter entrado. Fica "processando" e a consulta pela chave decide.
      const chegou = e.status === 504;
      const status = chegou ? 'processando' : 'erro_tecnico';
      const atual = await atualizarNota(api, nota, { status_fiscal: status, motivo_sefaz: e.message });
      await registrarEvento(api, nota.id, { tipo: 'erro', status_anterior: 'enviando', status_novo: status, mensagem: e.message, usuario_id: usuarioId });
      throw erro(chegou ? `${e.message} A nota ficou "processando": use "Consultar na SEFAZ" para saber se foi autorizada.` : e.message, e.status || 502, { nota: semXml(atual) });
    }
    return aplicarRetornoDoEnvio({ api, nota, retorno, xmlAssinado, usuarioId, uf: cfg.uf, ambiente, transporte, esperar, avisos: montada.avisos });
  });
}

/**
 * Pergunta à SEFAZ o que aconteceu com uma nota (processando, enviando sem
 * resposta, ou conferência de uma autorizada): pelo recibo ou pela chave.
 */
async function sincronizar({ api, notaId, transporte, usuarioId = null }) {
  const nota = await lerNota(api, notaId);
  const cfg = await configuracao.carregar(api);
  const uf = cfg?.uf || 'MG';
  const ambiente = nota.ambiente === configuracao.PRODUCAO ? configuracao.PRODUCAO : configuracao.HOMOLOGACAO;

  if (nota.recibo && nota.status_fiscal === 'processando') {
    const r = await sefaz.consultarRecibo({ uf, ambiente, transporte, recibo: nota.recibo });
    if (r.protocolo) return concluirComProtocolo({ api, nota, protocolo: r.protocolo, usuarioId });
    if (r.emProcessamento) return { nota: semXml(nota), sefaz: { cStat: r.cStat, xMotivo: r.xMotivo, recibo: nota.recibo }, autorizada: false, processando: true };
    const atual = await atualizarNota(api, nota, { status_fiscal: 'rejeitada', codigo_status_sefaz: r.cStat, motivo_sefaz: r.xMotivo });
    await registrarEvento(api, nota.id, { tipo: 'rejeitada', status_anterior: 'processando', status_novo: 'rejeitada', codigo_sefaz: r.cStat, mensagem: r.xMotivo, usuario_id: usuarioId });
    throw erro(`SEFAZ ${r.cStat}: ${r.xMotivo}`, 422, { nota: semXml(atual), sefaz: { cStat: r.cStat, xMotivo: r.xMotivo } });
  }

  if (!nota.chave_acesso) throw erro('A nota não tem chave de acesso nem recibo para consultar.', 409);
  const r = await sefaz.consultarNfe({ uf, ambiente, transporte, chave: nota.chave_acesso });
  if (r.naoConsta) {
    // Nunca chegou: o número volta a ser reaproveitável pelo pedido.
    const atual = await atualizarNota(api, nota, { status_fiscal: 'erro_tecnico', codigo_status_sefaz: r.cStat, motivo_sefaz: r.xMotivo });
    await registrarEvento(api, nota.id, { tipo: 'consulta', status_anterior: nota.status_fiscal, status_novo: 'erro_tecnico', codigo_sefaz: r.cStat, mensagem: r.xMotivo, usuario_id: usuarioId });
    return { nota: semXml(atual), sefaz: { cStat: r.cStat, xMotivo: r.xMotivo, chave: nota.chave_acesso }, autorizada: false, naoConsta: true };
  }
  if (r.protocolo) return concluirComProtocolo({ api, nota, protocolo: r.protocolo, usuarioId });
  const atual = await atualizarNota(api, nota, { status_fiscal: r.situacao === 'autorizada' ? nota.status_fiscal : 'rejeitada', codigo_status_sefaz: r.cStat, motivo_sefaz: r.xMotivo });
  await registrarEvento(api, nota.id, { tipo: 'consulta', status_anterior: nota.status_fiscal, status_novo: atual.status_fiscal, codigo_sefaz: r.cStat, mensagem: r.xMotivo, usuario_id: usuarioId });
  return { nota: semXml(atual), sefaz: { cStat: r.cStat, xMotivo: r.xMotivo, chave: nota.chave_acesso }, autorizada: atual.status_fiscal === 'autorizada' };
}

module.exports = {
  STATUS_REUTILIZAVEIS, TENTATIVAS_NUMERO,
  semXml, lerPedidoFiscal, lerNota, listarNotas, cartasPorNota, ehNumeroDuplicado, reservarNumero, notaReutilizavel,
  camposTransporteDoPedido, emitir, sincronizar
};
