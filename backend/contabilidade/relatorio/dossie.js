/**
 * O dossiê (etapa 8): tudo o que está ligado a um lançamento do banco, a uma
 * conta a pagar ou a um documento recebido, numa tela só — é uma leitura
 * (plano, A.13: "o dossiê pode ser uma visão, sem tabela").
 *
 *   movimento   o dado do banco (e de que OFX veio), a conciliação (o que ele
 *               paga ou recebe, inclusive o que foi desfeito), a conta do
 *               plano (a que vale, a congelada no fechamento e as escolhas à
 *               mão) e os arquivos de tudo o que está ligado
 *   titulo      a conta, as parcelas e os pagamentos, o lançamento do banco
 *               de cada pagamento e o documento (nota, recibo, guia)
 *   documento   o documento, as contas a pagar que ele gerou (ou o pagamento
 *               de comissão/produção que ele prova) e os lançamentos do banco
 *
 * Cada item ligado vira uma "ligação" que a tela abre no próprio dossiê
 * (documento → conta → pagamento → banco e o caminho de volta). O histórico
 * são os eventos do módulo sobre aquele item.
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const arquivos = require('../arquivos');
const titulos = require('../titulos');
const documentos = require('../documentosRecebidos');
const extratoMod = require('../extrato/extrato');
const liquidacoes = require('../conciliacao/liquidacoes');
const classificacao = require('../classificacao/classificacao');
const versoes = require('../versoes');

const TIPOS = { movimento: 'Lançamento do banco', titulo: 'Conta a pagar', documento: 'Documento recebido' };
const ESTADOS = { pendente: 'A conciliar', conciliado: 'Conciliado', ignorado: 'Ignorado' };
const CRITERIOS_VINCULO = {
  automatico: 'automático', sugestao: 'sugestão aceita', composicao: 'soma aceita', manual: 'escolhido à mão', conta_criada: 'conta lançada do extrato'
};
const ORIGENS_TITULO = { manual: 'Lançada à mão', nfe: 'NF-e de entrada', nfse: 'NFS-e', outro: 'Recibo ou guia' };

const quando = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(iso || ''));
  if (!m) return null;
  return m[4] ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
};
const semVazios = linhas => linhas.filter(([, v]) => v !== null && v !== undefined && v !== '');
const rotuloDoMovimento = m => `Lançamento de ${c.impressa(c.dia(m.data))} · ${c.reais(m.valor)}`;

/** Sem repetir arquivo (o mesmo arquivo pode provar a conta e o pagamento). Pura. */
function unicos(lista) {
  const vistos = new Set();
  return c.lista(lista).filter(a => a && (vistos.has(String(a.id)) ? false : vistos.add(String(a.id))));
}

// ------------------------------------------------------------------ montagem (puras)

/**
 * O dossiê de um lançamento a partir do que foi lido: `m` (a linha do banco),
 * `conta` (a conta financeira), `importacao` (+ `importadoPor`), `vinculos`
 * (todos, valendo e desfeitos), `liqsPorChave`, `tituloDoPagamento` (Map
 * id do pagamento -> título), `notasDoPedido` (Map pedido_id -> notas),
 * `cls` (a classificação que vale), `congelada` ({ versao, conta } quando o
 * mês está fechado), `atual` (a de hoje, se outra), `manuais` (as escolhas à
 * mão, com nomes). Pura.
 */
function dossieDoMovimento({ m, conta = null, importacao = null, importadoPor = null, vinculos = [], liqsPorChave = new Map(), tituloDoPagamento = new Map(), notasDoPedido = new Map(), cls = null, congelada = null, atual = null, manuais = [], nomes = new Map(), arquivosLista = [], historico = [], comprovante = null }) {
  const estado = ESTADOS[m.estado_conciliacao] ? m.estado_conciliacao : 'pendente';
  const valendo = c.lista(vinculos).filter(v => !v.desfeito_em);
  const desfeitos = c.lista(vinculos).filter(v => v.desfeito_em);
  const ligacoes = [];
  const linhasConc = [['Situação', ESTADOS[estado]]];
  if (estado === 'conciliado') linhasConc.push(['Conciliado em', [quando(m.conciliado_em), nomes.get(String(m.conciliado_por))].filter(Boolean).join(' por ') || null]);
  if (m.conciliacao_diferenca !== null && m.conciliacao_diferenca !== undefined && Number(m.conciliacao_diferenca) !== 0) linhasConc.push(['Diferença aceita', c.reais(m.conciliacao_diferenca)]);
  if (m.conciliacao_observacao) linhasConc.push([estado === 'ignorado' ? 'Por que foi ignorado' : 'Justificativa', m.conciliacao_observacao]);
  for (const v of valendo) {
    const l = liqsPorChave.get(liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id)) || null;
    const tipoRotulo = liquidacoes.TIPOS[v.alvo_tipo]?.rotulo || v.alvo_tipo;
    const detalhe = [tipoRotulo, l?.data ? c.impressa(l.data) : null, c.reais(v.valor), l?.forma, CRITERIOS_VINCULO[v.criterio] || v.criterio, l?.estornado ? 'ESTORNADO' : null].filter(Boolean).join(' · ');
    const rotulo = l ? [l.rotulo, l.nome].filter(Boolean).join(' — ') : `${tipoRotulo} ${v.alvo_id}`;
    if (v.alvo_tipo === 'titulo_pagamento' && tituloDoPagamento.get(String(v.alvo_id))) {
      ligacoes.push({ tipo: 'titulo', id: tituloDoPagamento.get(String(v.alvo_id)).id, rotulo, detalhe });
    } else {
      ligacoes.push({ tipo: null, id: null, rotulo, detalhe });
    }
    if (v.alvo_tipo === 'recebimento' && l) {
      const pedidoId = l.pedido_id ?? null;
      for (const n of c.lista(notasDoPedido.get(String(pedidoId)))) {
        ligacoes.push({ tipo: null, id: null, rotulo: `NF-e ${n.serie}/${n.numero} do pedido`, detalhe: [n.status_fiscal, n.data_emissao ? c.impressa(n.data_emissao) : null, n.valor_total ? c.reais(n.valor_total) : null].filter(Boolean).join(' · ') });
      }
    }
  }
  for (const v of desfeitos) {
    linhasConc.push([`Desfeito em ${quando(v.desfeito_em) || '—'}`, `${liquidacoes.TIPOS[v.alvo_tipo]?.rotulo || v.alvo_tipo} ${c.reais(v.valor)}${v.motivo_desfazer ? ` — ${v.motivo_desfazer}` : ''}`]);
  }
  const linhasCls = [];
  if (congelada) {
    linhasCls.push(['Conta do plano', congelada.conta || 'Sem classificação'], ['Como', `Congelada no fechamento (versão ${congelada.versao})`]);
    if (atual && String(atual.conta_id ?? '') !== String(congelada.conta_id ?? '')) linhasCls.push(['Hoje seria', atual.conta || 'Sem classificação']);
  } else if (cls) {
    linhasCls.push(['Conta do plano', cls.conta || 'Sem classificação'], ['Como', [cls.criterio_rotulo, cls.detalhe].filter(Boolean).join(' — ') || null]);
  } else {
    linhasCls.push(['Conta do plano', 'Classificação não disponível (falta o SQL da etapa 6)']);
  }
  for (const x of c.lista(manuais)) {
    linhasCls.push([
      x.substituida_em ? 'À mão (substituída)' : 'À mão',
      [x.conta, x.observacao ? `"${x.observacao}"` : null, [quando(x.criado_em), x.criado_por].filter(Boolean).join(' por '), x.substituida_em ? `até ${quando(x.substituida_em)}` : null].filter(Boolean).join(' · ')
    ]);
  }
  return {
    tipo: 'movimento', tipo_rotulo: TIPOS.movimento, id: m.id, competencia: m.competencia || null,
    titulo: rotuloDoMovimento(m), subtitulo: [conta?.nome, m.descricao].filter(Boolean).join(' · ') || null,
    secoes: [
      {
        chave: 'banco', titulo: 'No banco', icone: 'fa-university',
        linhas: semVazios([
          ['Conta', conta?.nome || null], ['Data', c.impressa(c.dia(m.data))], ['Valor', c.reais(m.valor)], ['Descrição do banco', m.descricao || null],
          ['Número do documento', m.documento || null], ['Identificador do banco', m.identificador || null],
          ['CNPJ/CPF da contrapartida', b.documentoFormatado(m.contrapartida_documento)],
          ['Veio de', importacao ? [`${extratoMod.ORIGENS[importacao.origem] || importacao.origem}${importacao.nome_arquivo ? ` ${importacao.nome_arquivo}` : ''}`, quando(importacao.criado_em), importadoPor].filter(Boolean).join(' · ') : null]
        ])
      },
      // Fase D: o comprovante do BB ligado a este lançamento (os dados; o PDF é refeito na hora).
      ...(comprovante ? [{
        chave: 'comprovante', titulo: 'Comprovante do banco', icone: 'fa-receipt',
        linhas: semVazios([
          ['Tipo', comprovante.tipo_rotulo || null], ['Favorecido', [comprovante.favorecido_nome, comprovante.favorecido_documento].filter(Boolean).join(' · ') || null],
          ['Data do pagamento', comprovante.data ? c.impressa(comprovante.data) : null], ['Valor', comprovante.valor !== null && comprovante.valor !== undefined ? c.reais(comprovante.valor) : null],
          ['Autenticação', comprovante.autenticacao || null], ['Documento', comprovante.documento || null], ['ID do Pix', comprovante.e2e || null],
          ['Arquivo do BB', comprovante.nome_arquivo || null],
          ['Original', comprovante.confere ? 'Refeito idêntico dos dados (o arquivo não foi guardado)' : (comprovante.original_guardado ? 'Guardado até o pacote do mês' : 'Já saiu no pacote (ficam os dados e o SHA-256)')]
        ])
      }] : []),
      { chave: 'conciliacao', titulo: 'Conciliação', icone: 'fa-check-double', linhas: linhasConc, ligacoes, vazio: ligacoes.length ? null : 'Não casa com nada registrado no app.' },
      { chave: 'classificacao', titulo: 'Classificação', icone: 'fa-tags', linhas: linhasCls }
    ],
    arquivos: unicos(arquivosLista),
    historico: c.lista(historico)
  };
}

/**
 * O dossiê de uma conta a pagar (`detalhe` = titulos.detalhe) com o
 * lançamento do banco de cada pagamento (`movimentosDoPagamento`: Map id do
 * pagamento -> [movimentos]). Pura.
 */
function dossieDaConta({ detalhe, movimentosDoPagamento = new Map(), contasBanco = new Map() }) {
  const t = detalhe.titulo;
  const linhasParcelas = [];
  const ligacoesBanco = [];
  for (const p of t.parcelas) {
    const rotulo = `Parcela ${p.numero}/${p.de} · venc. ${c.impressa(p.vencimento)} · ${c.reais(p.valor)}`;
    const pg = p.pagamento;
    linhasParcelas.push([rotulo, pg ? `Paga em ${c.impressa(pg.data)} · ${c.reais(pg.valor_pago)}${pg.forma ? ` · ${pg.forma}` : ''}` : p.situacao_rotulo]);
    for (const e of p.estornos) linhasParcelas.push([`${rotulo} (estornado)`, `pago em ${c.impressa(e.data)} · ${c.reais(e.valor_pago)} — ${e.motivo_estorno || 'estornado'}`]);
    if (pg) {
      const movs = c.lista(movimentosDoPagamento.get(String(pg.id)));
      if (!movs.length) linhasParcelas.push([`Banco (parcela ${p.numero})`, 'Sem lançamento do extrato ligado (a conciliar)']);
      for (const m of movs) ligacoesBanco.push({ tipo: 'movimento', id: m.id, rotulo: rotuloDoMovimento(m), detalhe: [contasBanco.get(String(m.conta_id)), m.descricao, ESTADOS[m.estado_conciliacao] || null].filter(Boolean).join(' · ') });
    }
  }
  const doc = detalhe.documento;
  return {
    tipo: 'titulo', tipo_rotulo: TIPOS.titulo, id: t.id, competencia: t.competencia || null,
    titulo: t.descricao, subtitulo: [t.fornecedor, t.situacao_rotulo, c.reais(t.valor_total)].filter(Boolean).join(' · '),
    secoes: [
      {
        chave: 'conta', titulo: 'A conta', icone: 'fa-file-invoice-dollar',
        linhas: semVazios([
          ['Fornecedor', [t.fornecedor, t.fornecedor_documento].filter(Boolean).join(' · ') || null], ['Descrição', t.descricao],
          ['Categoria (conta do plano)', t.categoria || 'Sem categoria'], ['Número do documento', t.numero_documento], ['Emissão', t.data_emissao ? c.impressa(t.data_emissao) : null],
          ['Competência', c.rotuloCompetencia(t.competencia)], ['Valor total', c.reais(t.valor_total)], ['Situação', t.situacao_rotulo],
          ['Origem', ORIGENS_TITULO[t.origem] || t.origem], ['Observação', t.observacao],
          ['Cancelada', t.cancelado_em ? `${quando(t.cancelado_em)}${t.motivo_cancelamento ? ` — ${t.motivo_cancelamento}` : ''}` : null]
        ])
      },
      { chave: 'parcelas', titulo: 'Parcelas e pagamentos', icone: 'fa-list-ol', linhas: linhasParcelas, vazio: linhasParcelas.length ? null : 'Sem parcelas.' },
      { chave: 'banco', titulo: 'No banco', icone: 'fa-university', linhas: [], ligacoes: ligacoesBanco, vazio: ligacoesBanco.length ? null : 'Nenhum pagamento ligado a um lançamento do extrato.' },
      {
        chave: 'documento', titulo: 'Documento', icone: 'fa-file-alt', linhas: [],
        ligacoes: doc ? [{ tipo: 'documento', id: doc.id, rotulo: `${documentos.TIPOS[doc.tipo] || 'Documento'} ${doc.serie ? `${doc.serie}/` : ''}${doc.numero || ''}`.trim(), detalhe: [doc.emitente, doc.data_emissao ? c.impressa(doc.data_emissao) : null, c.reais(doc.valor_total)].filter(Boolean).join(' · ') }] : [],
        vazio: doc ? null : 'Sem documento registrado (nota, recibo ou guia).'
      }
    ],
    arquivos: unicos(detalhe.arquivos),
    historico: c.lista(detalhe.historico)
  };
}

/**
 * O dossiê de um documento recebido (`detalhe` = documentosRecebidos.detalhe)
 * com as contas a pagar que ele gerou e os lançamentos do banco. Pura.
 */
function dossieDoDocumento({ detalhe, contas = [], movimentos = [], contasBanco = new Map() }) {
  const d = detalhe.documento;
  const ligacoesContas = c.lista(contas).map(t => ({
    tipo: 'titulo', id: t.id, rotulo: t.descricao, detalhe: [t.status === 'cancelado' ? 'cancelada' : null, c.reais(t.valor_total), t.categoria].filter(Boolean).join(' · ')
  }));
  let vazioContas = null;
  if (!ligacoesContas.length) {
    if (d.financeiro_pagamento) vazioContas = `Prova o pagamento ${d.financeiro_pagamento.rotulo} (${c.reais(d.financeiro_pagamento.valor)} em ${c.impressa(d.financeiro_pagamento.data)}).`;
    else if (d.sem_pagamento) vazioContas = 'Marcado como sem pagamento.';
    else vazioContas = 'Nenhuma conta a pagar lançada para este documento.';
  }
  const ligacoesBanco = c.lista(movimentos).map(m => ({
    tipo: 'movimento', id: m.id, rotulo: rotuloDoMovimento(m), detalhe: [contasBanco.get(String(m.conta_id)), m.descricao, ESTADOS[m.estado_conciliacao] || null].filter(Boolean).join(' · ')
  }));
  const itens = c.lista(d.itens);
  return {
    tipo: 'documento', tipo_rotulo: TIPOS.documento, id: d.id, competencia: d.competencia || null,
    titulo: d.rotulo, subtitulo: [d.emitente, c.impressa(d.data_emissao), c.reais(d.valor_total)].filter(Boolean).join(' · '),
    secoes: [
      {
        chave: 'documento', titulo: 'O documento', icone: 'fa-file-alt',
        linhas: semVazios([
          ['Tipo', d.tipo_rotulo], ['Número', [d.serie, d.numero].filter(Boolean).join('/') || null], ['Chave de acesso', d.chave_acesso],
          ['Emitente', [d.emitente, d.emitente_documento].filter(Boolean).join(' · ') || null], ['Emissão', d.data_emissao ? c.impressa(d.data_emissao) : null],
          ['Competência', c.rotuloCompetencia(d.competencia)], ['Valor total', c.reais(d.valor_total)],
          ['ISS', d.valor_iss !== null && d.valor_iss !== undefined ? `${c.reais(d.valor_iss)}${d.iss_retido ? ' (retido)' : ''}` : null],
          ['Retenções', d.valor_retencoes !== null && d.valor_retencoes !== undefined ? c.reais(d.valor_retencoes) : null],
          ['CFOP', d.cfops], ['Município', d.municipio], ['Protocolo', d.protocolo], ['Registrado por', d.origem_rotulo],
          ['Itens', itens.length ? c.plural(itens.length, 'item', 'itens') : null], ['Descrição', d.descricao], ['Observação', d.observacao],
          ['Falta', d.falta_xml ? 'o XML da NF-e' : (d.falta_arquivo ? 'o arquivo do documento' : null)]
        ])
      },
      { chave: 'contas', titulo: 'Contas a pagar', icone: 'fa-file-invoice-dollar', linhas: [], ligacoes: ligacoesContas, vazio: vazioContas },
      { chave: 'banco', titulo: 'No banco', icone: 'fa-university', linhas: [], ligacoes: ligacoesBanco, vazio: ligacoesBanco.length ? null : 'Nenhum lançamento do extrato ligado aos pagamentos.' }
    ],
    arquivos: unicos(detalhe.arquivos),
    historico: c.lista(detalhe.historico)
  };
}

// ------------------------------------------------------------------ leitura

const lerSePuder = (api, caminho, query) => api.get(caminho, query ? { query } : undefined).then(c.lista).catch(() => []);

async function nomesDasContas(api) {
  const { contas } = await extratoMod.listarContas(api).catch(() => ({ contas: [] }));
  return new Map(contas.map(x => [String(x.id), x.nome]));
}

/** Os lançamentos ligados (valendo) a liquidações: Map 'tipo:id' -> [movimentos]. */
async function movimentosDasLiquidacoes(api, chaves) {
  const vinculos = ((await b.lerOpcional(api, 'conciliacao_vinculos')) || []).filter(v => !v.desfeito_em && chaves.includes(liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id)));
  if (!vinculos.length) return new Map();
  const movs = (await b.lerOpcional(api, 'movimentos_bancarios')) || [];
  const porId = new Map(movs.map(m => [String(m.id), m]));
  const mapa = new Map();
  for (const v of vinculos) {
    const k = liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id);
    const m = porId.get(String(v.movimento_id));
    if (!m) continue;
    if (!mapa.has(k)) mapa.set(k, []);
    if (!mapa.get(k).some(x => String(x.id) === String(m.id))) mapa.get(k).push(m);
  }
  return mapa;
}

async function doMovimento(api, id) {
  const m = (await b.ler(api, 'movimentos_bancarios', { id: Number(id) }))[0] || null;
  if (!m) throw c.erro('Lançamento do extrato não encontrado.', 404);
  const [contas, importacao, vinculos] = await Promise.all([
    extratoMod.listarContas(api).then(r => r.contas).catch(() => []),
    m.importacao_id ? b.lerOpcional(api, 'extrato_importacoes', { id: Number(m.importacao_id) }).then(r => (r || [])[0] || null) : null,
    b.lerOpcional(api, 'conciliacao_vinculos', { movimento_id: Number(m.id) }).then(r => r || [])
  ]);
  const liqs = vinculos.length ? await liquidacoes.carregar(api, { incluir: vinculos.map(v => liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id)) }) : [];
  const liqsPorChave = new Map(liqs.map(l => [l.chave, l]));

  // Pagamento de conta -> a conta; recebimento -> o pedido e as NF-e dele.
  const tituloDoPagamento = new Map();
  const idsPagamento = vinculos.filter(v => v.alvo_tipo === 'titulo_pagamento').map(v => String(v.alvo_id));
  if (idsPagamento.length) {
    const pags = (await b.lerOpcional(api, 'titulo_pagar_pagamentos')) || [];
    for (const p of pags.filter(x => idsPagamento.includes(String(x.id)))) tituloDoPagamento.set(String(p.id), { id: p.titulo_id });
  }
  const notasDoPedido = new Map();
  const idsRecebimento = vinculos.filter(v => !v.desfeito_em && v.alvo_tipo === 'recebimento').map(v => String(v.alvo_id));
  if (idsRecebimento.length) {
    const recs = (await lerSePuder(api, '/api/recebimentos')).filter(r => r && idsRecebimento.includes(String(r.id)));
    for (const r of recs) {
      const l = liqsPorChave.get(liquidacoes.chaveDe('recebimento', r.id));
      if (l) l.pedido_id = r.pedido_id;
      if (!notasDoPedido.has(String(r.pedido_id))) {
        const notas = (await lerSePuder(api, '/api/notas_fiscais', { pedido_id: r.pedido_id })).filter(n => n && String(n.pedido_id) === String(r.pedido_id));
        notasDoPedido.set(String(r.pedido_id), notas.map(n => ({ serie: n.serie, numero: n.numero, status_fiscal: n.status_fiscal, data_emissao: c.dia(n.data_emissao), valor_total: n.valor_total })));
      }
    }
  }

  // A conta do plano: a congelada (mês fechado com versão) e a de hoje.
  const versao = await classificacao.versaoFechada(api, m.competencia).catch(() => null);
  const deHoje = ((await classificacao.doMes(api, [m]).catch(() => null)) || [])[0]?.classificacao || null;
  const congeladaLinha = versao ? versoes.congeladoDe(versao).get(String(m.id)) || null : null;
  const congelada = congeladaLinha ? { versao: Number(versao.versao), conta_id: congeladaLinha.conta_id ?? null, conta: congeladaLinha.conta ?? null } : null;
  const planoLido = (await b.lerOpcional(api, 'plano_contas')) || [];
  const plano = new Map(planoLido.map(p => [String(p.id), p.nome]));
  const manuaisLidas = ((await b.lerOpcional(api, 'classificacoes', { movimento_id: Number(m.id) })) || [])
    .sort((x, y) => String(y.criado_em).localeCompare(String(x.criado_em)) || Number(y.id) - Number(x.id));
  const nomes = await b.nomesDeUsuarios(api, [m.conciliado_por, importacao?.criado_por, ...manuaisLidas.map(x => x.criado_por)]);
  const manuais = manuaisLidas.map(x => ({ ...x, conta: plano.get(String(x.conta_id)) || `conta ${x.conta_id}`, criado_por: nomes.get(String(x.criado_por)) || null }));

  // Arquivos: o OFX de origem e os de tudo o que o lançamento paga ou recebe.
  const listas = await Promise.all([
    importacao?.arquivo_id ? b.lerOpcional(api, 'contabil_arquivos', { id: Number(importacao.arquivo_id) }).then(r => (r || []).filter(a => !a.excluido_em).map(a => arquivos.publico(a))) : [],
    ...vinculos.filter(v => !v.desfeito_em).flatMap(v => {
      const alvos = [];
      if (v.alvo_tipo === 'titulo_pagamento') {
        alvos.push(['pagamento', v.alvo_id]);
        if (tituloDoPagamento.get(String(v.alvo_id))) alvos.push(['titulo', tituloDoPagamento.get(String(v.alvo_id)).id]);
      } else if (arquivos.ALVOS[v.alvo_tipo]) alvos.push([v.alvo_tipo, v.alvo_id]);
      return alvos.map(([tipo, alvoId]) => arquivos.listar(api, { alvoTipo: tipo, alvoId }).catch(() => []));
    })
  ]);
  const historico = (await eventos.atividade({ api, competencia: m.competencia, limite: 500 }).catch(() => []))
    .filter(e => String(e.dados?.movimento_id ?? '') === String(m.id)
      || c.lista(e.dados?.movimentos).map(String).includes(String(m.id))
      || (m.importacao_id && String(e.dados?.importacao_id ?? '') === String(m.importacao_id)));
  // Fase D: o comprovante do BB ligado a este lançamento.
  const comprovantesMod = require('../comprovantes/comprovantes');
  const cpLido = ((await b.lerOpcional(api, 'contabil_comprovantes', { movimento_id: Number(m.id) }).catch(() => null)) || []).find(x => x && x.situacao === 'ligado') || null;
  const comprovante = cpLido ? comprovantesMod.linhaPublica(comprovantesMod.normalizar(cpLido)) : null;
  return dossieDoMovimento({
    m, conta: contas.find(x => String(x.id) === String(m.conta_id)) || null, importacao, importadoPor: nomes.get(String(importacao?.criado_por)) || null,
    vinculos, liqsPorChave, tituloDoPagamento, notasDoPedido, cls: deHoje, congelada, atual: congelada ? deHoje : null, manuais, nomes,
    arquivosLista: listas.flat(), historico, comprovante
  });
}

async function daConta(api, id, { hoje }) {
  const detalhe = await titulos.detalhe(api, id, { hoje });
  const pagamentos = detalhe.titulo.parcelas.map(p => p.pagamento).filter(Boolean);
  const [mapa, contasBanco] = await Promise.all([
    movimentosDasLiquidacoes(api, pagamentos.map(p => liquidacoes.chaveDe('titulo_pagamento', p.id))),
    nomesDasContas(api)
  ]);
  const movimentosDoPagamento = new Map(pagamentos.map(p => [String(p.id), mapa.get(liquidacoes.chaveDe('titulo_pagamento', p.id)) || []]));
  return dossieDaConta({ detalhe, movimentosDoPagamento, contasBanco });
}

async function doDocumento(api, id) {
  const detalhe = await documentos.detalhe(api, id);
  const contas = ((await b.lerOpcional(api, 'titulos_pagar')) || []).filter(t => String(t.documento_recebido_id) === String(id))
    .sort((x, y) => Number(x.id) - Number(y.id));
  const pagamentos = contas.length
    ? ((await b.lerOpcional(api, 'titulo_pagar_pagamentos')) || []).filter(p => !p.estornado_em && contas.some(t => String(t.id) === String(p.titulo_id)))
    : [];
  const chaves = pagamentos.map(p => liquidacoes.chaveDe('titulo_pagamento', p.id));
  const fin = detalhe.documento.financeiro_pagamento;
  if (fin) chaves.push(liquidacoes.chaveDe('financeiro_pagamento', fin.id));
  const [mapa, contasBanco] = await Promise.all([movimentosDasLiquidacoes(api, chaves), nomesDasContas(api)]);
  const movimentos = [];
  for (const lista of mapa.values()) for (const m of lista) if (!movimentos.some(x => String(x.id) === String(m.id))) movimentos.push(m);
  movimentos.sort((x, y) => String(c.dia(x.data)).localeCompare(String(c.dia(y.data))) || Number(x.id) - Number(y.id));
  return dossieDoDocumento({ detalhe, contas, movimentos, contasBanco });
}

/** O dossiê de um lançamento (`movimento`), conta a pagar (`titulo`) ou documento recebido (`documento`). */
async function carregar(api, { tipo, id, hoje }) {
  if (!TIPOS[tipo]) throw c.erro('Diga o que abrir: lançamento, conta a pagar ou documento.');
  if (!/^\d{1,12}$/.test(String(id ?? ''))) throw c.erro('Informe qual.');
  if (tipo === 'movimento') return doMovimento(api, id);
  if (tipo === 'titulo') return daConta(api, id, { hoje });
  return doDocumento(api, id);
}

module.exports = { TIPOS, unicos, dossieDoMovimento, dossieDaConta, dossieDoDocumento, carregar };
