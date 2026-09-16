/**
 * Painel fiscal do módulo Financeiro — o que a tela "Comissões e Produção"
 * mostra de NF-e: pedidos enviados sem nota, as notas da competência, as
 * pendências fiscais que exigem ação e a atividade recente na SEFAZ.
 *
 * As contas ficam em funções puras sobre listas já lidas (testáveis sem
 * rede); só `carregar` fala com a API. Datas são cortadas como texto
 * ('YYYY-MM-DD'): passar por new Date volta um dia em São Paulo.
 *
 * "Aguardando NF-e" = pedido Enviado/Entregue, não marcado como enviado sem
 * nota, sem nota viva (autorizada ou a caminho) e enviado a partir do 1º dia
 * da competência escolhida — antes do sistema fiscal existir as notas saíam
 * por fora, e contar esses pedidos velhos só faria ruído.
 */
const STATUS_VIVOS = new Set(['autorizada', 'processando', 'enviando', 'cancelamento_pendente']);
const STATUS_A_CAMINHO = new Set(['processando', 'enviando']);
const STATUS_RECUSADA = new Set(['rejeitada', 'denegada', 'erro_tecnico']);
const SITUACOES_ENVIADAS = new Set(['enviado', 'entregue']);
const LIMITE_ATIVIDADE = 8;

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const numero = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const centavos = v => Math.round(Number(v || 0) * 100) / 100;
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** 'YYYY-MM-DD…' (ou Date) → 'YYYY-MM-DD' por corte do texto; null quando não há. */
function dia(valor) {
  const texto = valor instanceof Date ? valor.toISOString() : String(valor ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 'YYYY-MM' válido, senão a competência de `hoje`. */
function competenciaValida(texto, hoje) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(texto || ''));
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}`;
  return String(dia(hoje) || '').slice(0, 7);
}

/** Dias inteiros de `b` até `a` (positivo quando `a` é depois). */
function diasEntre(a, b) {
  const pa = dia(a);
  const pb = dia(b);
  if (!pa || !pb) return null;
  const [ya, ma, da] = pa.split('-').map(Number);
  const [yb, mb, db] = pb.split('-').map(Number);
  return Math.round((Date.UTC(ya, ma - 1, da) - Date.UTC(yb, mb - 1, db)) / 86400000);
}

/** O dia em que o pedido saiu: embarque real, senão entrega, aprovação, emissão. */
function dataDeEnvio(pedido) {
  return dia(pedido?.embarcar_real) || dia(pedido?.data_entrega) || dia(pedido?.data_aprovacao) || dia(pedido?.data_emissao) || null;
}

const dispensado = p => p?.nfe_dispensada === true || p?.nfe_dispensada === 'true';
const enviado = p => SITUACOES_ENVIADAS.has(String(p?.situacao || '').trim().toLowerCase());
const nomeDoCliente = c => (c ? (c.nome_fantasia || c.razao_social || c.nome || null) : null);

/** A nota sem os XMLs: o painel nunca carrega o que pesa. */
function enxuta(nota) {
  if (!nota) return null;
  const { xml_envio, xml_autorizado, xml_cancelamento, ...resto } = nota;
  return resto;
}

/** Notas agrupadas por pedido, da mais nova para a mais velha. */
function notasPorPedido(notas) {
  const mapa = new Map();
  for (const n of lista(notas)) {
    if (!n || n.pedido_id === null || n.pedido_id === undefined) continue;
    const chave = String(n.pedido_id);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(n);
  }
  for (const grupo of mapa.values()) grupo.sort((a, b) => Number(b.id) - Number(a.id));
  return mapa;
}

const notaViva = grupo => (grupo || []).find(n => STATUS_VIVOS.has(String(n.status_fiscal))) || null;

/**
 * Pedidos enviados sem NF-e a partir de `desde`. Os marcados "enviado sem
 * nota" entram com `dispensada: true` (a tela decide se mostra), mas não
 * contam no total.
 */
function pedidosAguardandoNfe({ pedidos, notas, clientes = [], desde, hoje }) {
  const grupos = notasPorPedido(notas);
  const nomes = new Map(lista(clientes).filter(Boolean).map(c => [String(c.id), nomeDoCliente(c)]));
  const linhas = [];
  for (const p of lista(pedidos)) {
    if (!p || !enviado(p)) continue;
    const enviadoEm = dataDeEnvio(p);
    if (!enviadoEm || (desde && enviadoEm < desde)) continue;
    const grupo = grupos.get(String(p.id)) || [];
    if (notaViva(grupo)) continue;
    const ultima = grupo[0] || null;
    linhas.push({
      pedido_id: p.id,
      numero: p.numero ?? String(p.id),
      cliente_id: p.cliente_id ?? null,
      cliente: nomes.get(String(p.cliente_id)) || null,
      situacao: p.situacao || null,
      enviado_em: enviadoEm,
      dias_sem_nfe: Math.max(0, diasEntre(hoje, enviadoEm) ?? 0),
      valor: centavos(numero(p.valor_final)),
      parcelas: numero(p.parcelas) || null,
      forma_pagamento: p.forma_pagamento || null,
      dispensada: dispensado(p),
      ultima_nota: ultima ? { id: ultima.id, serie: ultima.serie, numero: ultima.numero, status_fiscal: ultima.status_fiscal, motivo_sefaz: ultima.motivo_sefaz || null } : null
    });
  }
  linhas.sort((a, b) => b.dias_sem_nfe - a.dias_sem_nfe || String(a.numero).localeCompare(String(b.numero), 'pt-BR'));
  const contadas = linhas.filter(l => !l.dispensada);
  return {
    quantidade: contadas.length,
    total: centavos(contadas.reduce((s, l) => s + l.valor, 0)),
    dispensados: linhas.length - contadas.length,
    pedidos: linhas
  };
}

/** As notas emitidas na competência, contadas por situação. */
function resumoDasNotas(notas, competencia) {
  const doMes = lista(notas).filter(n => n && String(dia(n.data_emissao) || '').startsWith(competencia) && n.status_fiscal !== 'rascunho');
  const conta = f => doMes.filter(f).length;
  return {
    competencia,
    emitidas: doMes.length,
    autorizadas: conta(n => n.status_fiscal === 'autorizada'),
    canceladas: conta(n => n.status_fiscal === 'cancelada'),
    processando: conta(n => STATUS_A_CAMINHO.has(String(n.status_fiscal))),
    rejeitadas: conta(n => STATUS_RECUSADA.has(String(n.status_fiscal))),
    valor_autorizado: centavos(doMes.filter(n => n.status_fiscal === 'autorizada').reduce((s, n) => s + numero(n.valor_total), 0))
  };
}

/**
 * O que exige ação, na ordem em que importa: nota parada na SEFAZ, nota
 * recusada sem outra no lugar, pedidos sem nota, certificado e configuração.
 * Cada item diz aonde a tela leva (`destino`, com `filtro` quando é a lista
 * de notas).
 */
function pendenciasFiscais({ aguardando, notas, certificado, pendenciasConfiguracao = [], hoje }) {
  const p = [];
  const todas = lista(notas);
  const grupos = notasPorPedido(todas);
  const maisRecente = ns => ns.map(n => dia(n.atualizado_em || n.criado_em)).filter(Boolean).sort().at(-1) || dia(hoje);

  const paradas = todas.filter(n => STATUS_A_CAMINHO.has(String(n.status_fiscal)));
  if (paradas.length) {
    p.push({
      nivel: 'critico', chave: 'processando', titulo: `${plural(paradas.length, 'nota aguardando', 'notas aguardando')} resposta da SEFAZ`,
      descricao: paradas.length === 1 ? `NF-e ${paradas[0].serie}/${paradas[0].numero} — consulte para concluir a autorização` : 'Consulte na SEFAZ para concluir as autorizações',
      data: maisRecente(paradas), acao: 'Consultar', destino: 'notas-fiscais', filtro: { status: 'processando' }
    });
  }

  const recusadas = todas.filter(n => STATUS_RECUSADA.has(String(n.status_fiscal)) && !notaViva(grupos.get(String(n.pedido_id))));
  if (recusadas.length) {
    const motivo = recusadas[0].motivo_sefaz ? `${recusadas[0].codigo_status_sefaz ? `${recusadas[0].codigo_status_sefaz} — ` : ''}${recusadas[0].motivo_sefaz}` : 'Corrija o cadastro e emita de novo: o número é reaproveitado';
    p.push({
      nivel: 'critico', chave: 'rejeitadas', titulo: `${plural(recusadas.length, 'nota recusada', 'notas recusadas')} pela SEFAZ sem nova emissão`,
      descricao: motivo, data: maisRecente(recusadas), acao: 'Ver', destino: 'notas-fiscais', filtro: { status: 'rejeitada' }
    });
  }

  if (aguardando?.quantidade) {
    const maisAntigo = aguardando.pedidos.filter(l => !l.dispensada).map(l => l.enviado_em).sort()[0];
    p.push({
      nivel: 'normal', chave: 'aguardando_nf', titulo: `${plural(aguardando.quantidade, 'pedido enviado', 'pedidos enviados')} sem NF-e`,
      descricao: `Total: ${moeda.format(aguardando.total)}`, data: maisAntigo || dia(hoje), acao: 'Emitir', destino: 'aguardando-nf'
    });
  }

  const c = certificado || {};
  if (!c.configurado) {
    p.push({ nivel: 'critico', chave: 'certificado', titulo: 'Certificado digital não configurado', descricao: c.erro || 'Sem o certificado A1 não há emissão de NF-e', data: dia(hoje), acao: 'Configurar', destino: 'configuracao-fiscal' });
  } else if (c.vencido) {
    p.push({ nivel: 'critico', chave: 'certificado', titulo: 'Certificado digital vencido', descricao: `Venceu em ${formatarDia(c.validoAte)} — a SEFAZ recusa a conexão`, data: dia(c.validoAte) || dia(hoje), acao: 'Configurar', destino: 'configuracao-fiscal' });
  } else if (c.venceEmBreve) {
    p.push({ nivel: 'normal', chave: 'certificado', titulo: `Certificado digital vence em ${plural(numero(c.diasRestantes), 'dia', 'dias')}`, descricao: `Válido até ${formatarDia(c.validoAte)} — renove antes`, data: dia(c.validoAte) || dia(hoje), acao: 'Ver', destino: 'configuracao-fiscal' });
  } else if (c.confereComEmitente === false) {
    p.push({ nivel: 'critico', chave: 'certificado', titulo: 'Certificado digital de outro CNPJ', descricao: 'A SEFAZ vai rejeitar a nota: guarde o certificado do emitente', data: dia(hoje), acao: 'Configurar', destino: 'configuracao-fiscal' });
  }

  const faltas = lista(pendenciasConfiguracao).filter(Boolean);
  if (faltas.length) {
    p.push({ nivel: 'critico', chave: 'configuracao', titulo: 'Configuração fiscal incompleta', descricao: faltas.join(' • '), data: dia(hoje), acao: 'Configurar', destino: 'configuracao-fiscal' });
  }
  return p;
}

function formatarDia(valor) {
  const d = dia(valor);
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
}

/** Os últimos movimentos na SEFAZ: autorizações, cancelamentos, recusas, envios e cartas de correção. */
function atividadeRecente({ notas, eventosCce = [], pedidos = [], limite = LIMITE_ATIVIDADE }) {
  const numeros = new Map(lista(pedidos).filter(Boolean).map(p => [String(p.id), p.numero ?? String(p.id)]));
  const porId = new Map(lista(notas).filter(Boolean).map(n => [String(n.id), n]));
  const rotulo = n => `NF-e ${n.serie}/${n.numero}`;
  const pedidoDe = n => `Pedido ${numeros.get(String(n.pedido_id)) || n.pedido_id}`;
  const itens = [];
  for (const n of porId.values()) {
    const base = { nota_id: n.id, pedido_id: n.pedido_id, ambiente: n.ambiente };
    if (n.data_autorizacao) itens.push({ ...base, quando: n.data_autorizacao, tipo: 'autorizada', titulo: `${rotulo(n)} autorizada`, detalhe: `${pedidoDe(n)} • ${moeda.format(numero(n.valor_total))}` });
    if (n.status_fiscal === 'cancelada') itens.push({ ...base, quando: n.cancelada_em || n.atualizado_em || n.criado_em, tipo: 'cancelada', titulo: `${rotulo(n)} cancelada`, detalhe: `${pedidoDe(n)}${n.justificativa_cancelamento ? ` • ${n.justificativa_cancelamento}` : ''}` });
    if (STATUS_RECUSADA.has(String(n.status_fiscal))) itens.push({ ...base, quando: n.atualizado_em || n.criado_em, tipo: 'rejeitada', titulo: `${rotulo(n)} recusada pela SEFAZ`, detalhe: `${pedidoDe(n)}${n.motivo_sefaz ? ` • ${n.codigo_status_sefaz ? `${n.codigo_status_sefaz} — ` : ''}${n.motivo_sefaz}` : ''}` });
    if (STATUS_A_CAMINHO.has(String(n.status_fiscal))) itens.push({ ...base, quando: n.atualizado_em || n.criado_em, tipo: 'processando', titulo: `${rotulo(n)} enviada à SEFAZ`, detalhe: `${pedidoDe(n)} • aguardando resposta` });
  }
  for (const e of lista(eventosCce)) {
    if (!e || e.tipo !== 'cce' || !['135', '136'].includes(String(e.codigo_sefaz))) continue;
    const n = porId.get(String(e.nota_fiscal_id));
    if (!n) continue;
    let det = e.detalhe;
    if (typeof det === 'string') { try { det = JSON.parse(det || '{}'); } catch (_) { det = {}; } }
    const correcao = String(det?.correcao || '').trim();
    itens.push({
      nota_id: n.id, pedido_id: n.pedido_id, ambiente: n.ambiente, quando: e.criado_em, tipo: 'cce',
      titulo: `Carta de correção ${Number(det?.nSeqEvento) || 1} da ${rotulo(n)}`,
      detalhe: `${pedidoDe(n)}${correcao ? ` • ${correcao.length > 80 ? `${correcao.slice(0, 77)}…` : correcao}` : ''}`
    });
  }
  return itens
    .filter(i => i.quando)
    .sort((a, b) => String(b.quando).localeCompare(String(a.quando)) || Number(b.nota_id) - Number(a.nota_id))
    .slice(0, limite);
}

/** O painel inteiro a partir das listas lidas. Pura. */
function montar({ pedidos = [], notas = [], eventosCce = [], clientes = [], competencia, hoje = new Date(), certificado = null, pendenciasConfiguracao = [], ambiente = null }) {
  const comp = competenciaValida(competencia, hoje);
  const desde = `${comp}-01`;
  const semXml = lista(notas).map(enxuta);
  const aguardando = pedidosAguardandoNfe({ pedidos, notas: semXml, clientes, desde, hoje });
  const cert = certificado ? { configurado: Boolean(certificado.configurado), vencido: Boolean(certificado.vencido), venceEmBreve: Boolean(certificado.venceEmBreve), diasRestantes: certificado.diasRestantes ?? null, validoAte: certificado.validoAte || null } : { configurado: false };
  return {
    competencia: comp,
    desde,
    ambiente,
    certificado: cert,
    aguardando_nf: aguardando,
    notas: resumoDasNotas(semXml, comp),
    pendencias: pendenciasFiscais({ aguardando, notas: semXml, certificado, pendenciasConfiguracao, hoje }),
    atividade: atividadeRecente({ notas: semXml, eventosCce, pedidos })
  };
}

/** Lê o que o painel precisa (pedidos, notas, cartas, e só os clientes dos pedidos sem nota) e monta. */
async function carregar({ api, competencia, hoje = new Date(), certificado = null, pendenciasConfiguracao = [], ambiente = null }) {
  const [pedidos, notas, eventosCce] = await Promise.all([
    api.get('/api/pedidos').then(lista).catch(() => []),
    api.get('/api/notas_fiscais').then(lista).catch(() => []),
    api.get('/api/notas_fiscais_eventos', { query: { tipo: 'cce' } }).then(lista).catch(() => [])
  ]);
  const comp = competenciaValida(competencia, hoje);
  const previa = pedidosAguardandoNfe({ pedidos, notas: notas.map(enxuta), desde: `${comp}-01`, hoje });
  const ids = [...new Set(previa.pedidos.map(l => l.cliente_id).filter(v => v !== null && v !== undefined))];
  const clientes = await Promise.all(ids.map(id => api.get('/api/clientes', { query: { id } }).then(r => lista(r)[0] || null).catch(() => null)));
  return montar({ pedidos, notas, eventosCce, clientes: clientes.filter(Boolean), competencia: comp, hoje, certificado, pendenciasConfiguracao, ambiente });
}

module.exports = {
  STATUS_VIVOS, LIMITE_ATIVIDADE,
  dia, competenciaValida, diasEntre, dataDeEnvio, notasPorPedido, pedidosAguardandoNfe, resumoDasNotas,
  pendenciasFiscais, atividadeRecente, montar, carregar
};
