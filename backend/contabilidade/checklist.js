/**
 * Checklist do fechamento contábil (etapas 1 a 6): o que a tela da
 * Contabilidade mostra de uma competência, calculado SÓ com o que o sistema
 * já controla — NF-e de saída (próprias e de fora), recebimentos e cobrança,
 * fechamentos de comissões e produção, devoluções e reembolsos, e (etapa 3)
 * os documentos recebidos e as contas a pagar, (etapa 4) o extrato bancário,
 * (etapa 5) a conciliação do extrato com o que o app registrou e (etapa 6) a
 * classificação de cada lançamento no plano de contas.
 *
 * As contas ficam em funções puras sobre listas já lidas (`montar`); só
 * `carregar` fala com a API. Cada pendência sai com a severidade do dono
 * (28/09/2026): `critico` bloqueia o fechamento, `documental` bloqueia o
 * pacote/envio, `aviso` não bloqueia. Pendência ignorada com justificativa
 * (contabil_pendencias_resolucoes) continua na lista, marcada, e deixa de
 * contar para os bloqueios — erro crítico não se ignora.
 *
 * Datas são texto 'YYYY-MM-DD' (cortar por new Date volta um dia em São Paulo).
 */
const c = require('../financeiro/comum');
const b = require('./base');
const fiscalPainel = require('../fiscal/painel');
const externasFiscais = require('../fiscal/externas');
const contasReceber = require('../cobranca/contasReceber');
const fechamentos = require('../financeiro/fechamentos');
const baseFinanceiro = require('../financeiro/base');
const reembolsos = require('../devolucoes/reembolsos');
const titulos = require('./titulos');
const documentos = require('./documentosRecebidos');
const arquivos = require('./arquivos');
const extratoMod = require('./extrato/extrato');
const conciliacaoMod = require('./conciliacao/conciliacao');
const liquidacoes = require('./conciliacao/liquidacoes');
const motor = require('./conciliacao/motor');
const classificacaoMod = require('./classificacao/classificacao');
const versoes = require('./versoes');
const parametros = require('./parametros');
const planoMod = require('./classificacao/plano');
const comprovantesMod = require('./comprovantes/comprovantes');
const aplicacoesMod = require('./aplicacoes/aplicacoes');
const terceirosMod = require('./terceiros/terceiros');
const cartaoMod = require('./cartao/cartao');

const STATUS_A_CAMINHO = new Set(['processando', 'enviando']);
const STATUS_RECUSADA = new Set(['rejeitada', 'denegada', 'erro_tecnico']);

/**
 * Os níveis que o dono escolheu em 02/10/2026 (C1 a C10 das pendências):
 *   C1  pagamento de comissão/produção sem NFS-e ...... aviso (quem não emite: Ignorar)
 *   C2  pagamento sem nota, recibo ou guia ............ crítico
 *   C3  pagamento sem comprovante ..................... crítico
 *   C4  extrato incompleto em mês encerrado ........... crítico
 *   C5  lançamento do extrato sem conciliação ......... crítico
 *   C6  conciliação com registro estornado ............ crítico (já era)
 *   C7  lançamento sem classificação .................. crítico
 *   C8  diferença depois do fechamento ................ documental
 *   C9  pacote ainda não enviado ...................... aviso (já era)
 *   C10 NF-e/NFS-e do mês ainda na caixa de entrada ... documental (já era)
 */
const NIVEL = {
  nfse_do_fechamento: 'aviso', pagamento_sem_documento: 'critico', pagamento_sem_comprovante: 'critico',
  extrato_incompleto: 'critico', sem_conciliacao: 'critico', sem_classificacao: 'critico', diferenca_pos_fechamento: 'documental'
};

/**
 * Tarifa e encargo do próprio banco (conta sem fornecedor): o extrato é o
 * documento — não existe nota nem recibo para isso. Pura.
 */
const ehTarifaDoBanco = t => (t.contato_id === null || t.contato_id === undefined)
  && /tarifa|banc[aá]ri|encargo|iof\b|juros banc/i.test(`${t.categoria || ''} ${t.descricao || ''}`);

/** As fontes do checklist, na ordem da tela. `etapa` marca as que ainda não existem. */
const FONTES = [
  { chave: 'nfe_saida', titulo: 'NF-e de saída', icone: 'fa-file-invoice' },
  { chave: 'recebimentos', titulo: 'Recebimentos e cobrança', icone: 'fa-money-bill-wave' },
  { chave: 'fechamentos', titulo: 'Comissões e produção', icone: 'fa-hand-holding-usd' },
  { chave: 'devolucoes', titulo: 'Devoluções e reembolsos', icone: 'fa-undo-alt' },
  { chave: 'documentos_recebidos', titulo: 'NF-e de entrada e NFS-e', icone: 'fa-file-import' },
  { chave: 'contas_pagar', titulo: 'Contas a pagar', icone: 'fa-file-invoice-dollar' },
  { chave: 'extrato', titulo: 'Extrato bancário', icone: 'fa-university' },
  { chave: 'conciliacao', titulo: 'Conciliação e classificação', icone: 'fa-check-double' }
];

const semXml = n => {
  if (!n) return null;
  const { xml_envio, xml_autorizado, xml_cancelamento, ...resto } = n;
  return resto;
};

/** 'YYYY-MM' válido, senão a competência de `hoje`. */
const competenciaValida = (texto, hoje) => (c.competenciaValida(texto) ? String(texto) : c.competenciaDe(hoje));

function pendencia({ nivel, chave, fonte, titulo, descricao, data, acao = 'Ver', destino = null, filtro = null }) {
  return { nivel, chave, fonte, titulo, descricao, data: c.dia(data) || null, acao, destino, filtro, ignoravel: b.NIVEIS[nivel].ignoravel, ignorada: false };
}

// ------------------------------------------------------------- NF-e de saída

function fonteNfe({ notas, externas, aguardando, competencia, hoje }) {
  const doMes = c.lista(notas).filter(n => n && String(c.dia(n.data_emissao) || '').startsWith(competencia) && n.status_fiscal !== 'rascunho');
  const grupos = fiscalPainel.notasPorPedido(c.lista(notas));
  const viva = pedidoId => (grupos.get(String(pedidoId)) || []).some(n => fiscalPainel.STATUS_VIVOS.has(String(n.status_fiscal)));
  const autorizadas = doMes.filter(n => n.status_fiscal === 'autorizada');
  const canceladas = doMes.filter(n => n.status_fiscal === 'cancelada');
  const paradas = doMes.filter(n => STATUS_A_CAMINHO.has(String(n.status_fiscal)));
  const recusadas = doMes.filter(n => STATUS_RECUSADA.has(String(n.status_fiscal)) && !viva(n.pedido_id));
  const deFora = c.lista(externas).filter(n => n && String(c.dia(n.data_emissao) || '').startsWith(competencia));
  // Pedidos enviados NO MÊS sem nota (os dispensados "sem NF-e" não contam).
  const semNota = c.lista(aguardando?.pedidos).filter(l => l && !l.dispensada && String(l.enviado_em || '').startsWith(competencia));
  const maisRecente = ns => ns.map(n => c.dia(n.atualizado_em || n.criado_em)).filter(Boolean).sort().at(-1) || c.dia(hoje);

  const pend = [];
  if (paradas.length) {
    pend.push(pendencia({
      nivel: 'critico', chave: 'nfe_processando', fonte: 'nfe_saida',
      titulo: `${c.plural(paradas.length, 'NF-e aguardando', 'NF-e aguardando')} resposta da SEFAZ`,
      descricao: paradas.length === 1 ? `NF-e ${paradas[0].serie}/${paradas[0].numero} — consulte no Financeiro para concluir a autorização` : 'Consulte no Financeiro para concluir as autorizações',
      data: maisRecente(paradas), acao: 'Financeiro', destino: 'financeiro', filtro: { acao: 'notas-fiscais', status: 'processando' }
    }));
  }
  if (recusadas.length) {
    pend.push(pendencia({
      nivel: 'critico', chave: 'nfe_rejeitadas', fonte: 'nfe_saida',
      titulo: `${c.plural(recusadas.length, 'NF-e recusada', 'NF-e recusadas')} pela SEFAZ sem nova emissão`,
      descricao: recusadas[0].motivo_sefaz ? `${recusadas[0].codigo_status_sefaz ? `${recusadas[0].codigo_status_sefaz} — ` : ''}${recusadas[0].motivo_sefaz}` : 'Corrija e emita de novo pelo Financeiro',
      data: maisRecente(recusadas), acao: 'Financeiro', destino: 'financeiro', filtro: { acao: 'notas-fiscais', status: 'rejeitada' }
    }));
  }
  if (semNota.length) {
    pend.push(pendencia({
      nivel: 'documental', chave: 'nfe_aguardando', fonte: 'nfe_saida',
      titulo: `${c.plural(semNota.length, 'pedido enviado', 'pedidos enviados')} no mês sem NF-e`,
      descricao: `Total: ${c.reais(semNota.reduce((s, l) => s + Number(l.valor || 0), 0))} · a nota entra no pacote da contabilidade`,
      data: semNota.map(l => l.enviado_em).sort()[0], acao: 'Emitir', destino: 'financeiro', filtro: { acao: 'aguardando-nf' }
    }));
  }

  return {
    resumo: [
      { rotulo: 'Autorizadas', valor: `${autorizadas.length} · ${c.reais(autorizadas.reduce((s, n) => s + Number(n.valor_total || 0), 0))}` },
      { rotulo: 'Canceladas', valor: String(canceladas.length) },
      { rotulo: 'Informadas de fora', valor: String(deFora.length) },
      { rotulo: 'Pedidos sem NF-e', valor: String(semNota.length) }
    ],
    numeros: { autorizadas: autorizadas.length, valor_autorizado: c.centavos(autorizadas.reduce((s, n) => s + Number(n.valor_total || 0), 0)), canceladas: canceladas.length, de_fora: deFora.length, sem_nota: semNota.length },
    pendencias: pend
  };
}

// ------------------------------------------------------------- recebimentos

/** A severidade contábil de cada pendência de cobrança (pela chave do contasReceber). */
const NIVEL_DA_COBRANCA = { recebimentos_sql: 'critico', alertas: 'critico', conciliar: 'documental', em_atraso: 'aviso', boletos_erro: 'aviso' };

function fonteRecebimentos({ receber, receberErro }) {
  if (!receber) {
    const motivo = receberErro?.status === 403 ? 'Sem permissão para ver as contas a receber (financeiro.recebimento.view).'
      : (receberErro ? `Não foi possível ler as contas a receber: ${receberErro.message || 'erro'}` : 'Sem dados de cobrança.');
    return { indisponivel: motivo, resumo: [], numeros: null, pendencias: [] };
  }
  const pend = c.lista(receber.pendencias).map(p => pendencia({
    nivel: NIVEL_DA_COBRANCA[p.chave] || 'aviso', chave: `receb_${p.chave}`, fonte: 'recebimentos',
    titulo: p.titulo, descricao: p.descricao, data: p.data, acao: 'Financeiro', destino: 'financeiro', filtro: { acao: p.destino }
  }));
  const r = receber.recebido || {};
  const conc = receber.a_conciliar || {};
  return {
    resumo: [
      { rotulo: 'Recebido no mês', valor: `${Number(r.quantidade) || 0} · ${c.reais(r.total || 0)}` },
      { rotulo: 'A receber', valor: c.reais(receber.a_receber?.total || 0) },
      { rotulo: 'Em atraso', valor: `${Number(receber.em_atraso?.quantidade) || 0} · ${c.reais(receber.em_atraso?.total || 0)}` },
      { rotulo: 'A conciliar', valor: String((Number(conc.fila) || 0) + (Number(conc.lancamentos) || 0)) }
    ],
    numeros: { recebido: c.centavos(r.total || 0), recebidos: Number(r.quantidade) || 0, a_receber: c.centavos(receber.a_receber?.total || 0), em_atraso: c.centavos(receber.em_atraso?.total || 0), a_conciliar: (Number(conc.fila) || 0) + (Number(conc.lancamentos) || 0) },
    pendencias: pend
  };
}

// ------------------------------------------------------------- comissões e produção

const ROTULO_FECH = { comissao: 'comissões', producao: 'produção' };

function fonteFechamentos({ fechamentos: lista, competencia, hoje, encerrada }) {
  if (lista === null) {
    return { indisponivel: 'Falta o SQL do Financeiro (fase G): sem ele não há fechamentos de comissões e produção.', resumo: [], numeros: null, pendencias: [] };
  }
  const pend = [];
  const resumo = [];
  const numeros = {};
  for (const tipo of ['comissao', 'producao']) {
    const f = c.lista(lista).find(x => x.tipo === tipo && x.competencia === competencia) || null;
    const nome = ROTULO_FECH[tipo];
    if (!f) {
      numeros[tipo] = { fechada: false, total: null, falta_pagar: null };
      resumo.push({ rotulo: `Fechamento de ${nome}`, valor: encerrada ? 'Pendente' : 'Mês em curso' });
      if (encerrada) {
        pend.push(pendencia({
          nivel: 'documental', chave: `fech_${tipo}_fechar`, fonte: 'fechamentos',
          titulo: `Fechamento de ${nome} da competência pendente`,
          descricao: `A contabilidade recebe ${nome} pelo fechamento do Financeiro`,
          data: b.ultimoDia(competencia), acao: 'Fechar', destino: 'financeiro', filtro: { acao: tipo === 'comissao' ? 'fechar-competencia' : 'fechar-competencia-producao', tipo, competencia }
        }));
      }
      continue;
    }
    const falta = c.centavos(f.falta_pagar ?? f.total);
    numeros[tipo] = { fechada: true, total: c.centavos(f.total), falta_pagar: falta, pagar_ate: f.pagar_ate || null };
    resumo.push({ rotulo: `Fechamento de ${nome}`, valor: `${c.reais(f.total)}${falta > 0 ? ` · falta ${c.reais(falta)}` : ' · pago'}` });
    if (f.total > 0 && falta > 0) {
      const atrasado = f.pagar_ate && String(c.dia(hoje)) > String(f.pagar_ate);
      pend.push(pendencia({
        nivel: atrasado ? 'documental' : 'aviso', chave: `fech_${tipo}_pagar`, fonte: 'fechamentos',
        titulo: atrasado ? `Pagamento de ${nome} em atraso` : `Pagamento de ${nome} a confirmar`,
        descricao: `${c.reais(falta)} ${atrasado ? 'venceram' : 'a pagar até'} ${c.impressa(f.pagar_ate)} · confirme no Financeiro quando pagar`,
        data: f.pagar_ate || hoje, acao: 'Confirmar', destino: 'financeiro', filtro: { acao: 'confirmar-pagamento', tipo, competencia }
      }));
    }
  }
  return { resumo, numeros, pendencias: pend };
}

// ------------------------------------------------------------- devoluções e reembolsos

function fonteDevolucoes({ reembolsosPendencias, hoje }) {
  const lista = c.lista(reembolsosPendencias);
  const reemb = lista.filter(p => /^reembolso_/.test(String(p.chave)));
  const devs = lista.filter(p => /^devolucao_/.test(String(p.chave)));
  const pend = lista.map(p => pendencia({
    nivel: /^devolucao_/.test(String(p.chave)) ? 'critico' : 'documental', chave: p.chave, fonte: 'devolucoes',
    titulo: p.titulo, descricao: p.descricao, data: p.data || hoje, acao: 'Financeiro', destino: 'financeiro', filtro: { acao: p.destino, ...(p.filtro || {}) }
  }));
  return {
    resumo: [
      { rotulo: 'Reembolsos a pagar', valor: String(reemb.length) },
      { rotulo: 'Devoluções com pendência', valor: String(devs.length) }
    ],
    numeros: { reembolsos: reemb.length, devolucoes: devs.length },
    pendencias: pend
  };
}

// ------------------------------------------------------------- documentos recebidos

const SEM_SQL_PAGAR = `Falta rodar ${b.SQL_ARQUIVO_PAGAR} no banco e reiniciar a API.`;

/** As contas por documento (para saber se a nota já virou conta). */
function contasPorDocumento(lista = []) {
  const mapa = new Map();
  for (const t of lista) {
    if (t.documento_recebido_id === null || t.documento_recebido_id === undefined) continue;
    const k = String(t.documento_recebido_id);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(t);
  }
  return mapa;
}

/**
 * NF-e de entrada, NFS-e e recibos da competência (mês da emissão) e as NFS-e
 * que faltam dos pagamentos de comissão/produção feitos no mês.
 *   - NF-e só pela chave (sem o XML) ............ documental, uma por nota
 *   - NFS-e / recibo sem o arquivo ............... documental, um por documento
 *   - pagamento de fechamento sem NFS-e .......... aviso (C1), um por pagamento
 *   - documento sem conta a pagar ................ aviso (junta todos)
 * `pagar` null = falta o SQL da etapa. Pura.
 */
function fonteDocumentosRecebidos({ pagar, competencia }) {
  if (!pagar) return { indisponivel: SEM_SQL_PAGAR, resumo: [], numeros: null, pendencias: [] };
  const vivos = c.lista(pagar.documentos).filter(d => d && !d.excluido_em);
  const contexto = {
    contatos: pagar.contatos || new Map(), titulosPorDocumento: contasPorDocumento(pagar.titulos),
    arquivosMapa: pagar.arquivosMapa || new Map(), pagamentosFechamento: pagar.pagamentosFechamento || new Map(),
    // Fase G: a nota de compra no cartão foi paga pela fatura (não pede conta a pagar).
    noCartao: cartaoMod.documentosNoCartao(pagar.cartao?.compras)
  };
  const doMes = vivos.filter(d => d.competencia === competencia).map(d => documentos.linhaDoDocumento(d, contexto));
  const pend = [];
  for (const d of doMes) {
    const quem = d.emitente ? ` de ${d.emitente}` : '';
    const filtro = { acao: 'documento-recebido', documento_id: d.id };
    if (d.falta_xml) {
      pend.push(pendencia({
        nivel: 'documental', chave: `docrec_sem_xml_${d.id}`, fonte: 'documentos_recebidos', titulo: `${d.rotulo}${quem} sem o XML`,
        descricao: `${c.reais(d.valor_total)} · registrada pela chave: a contabilidade precisa do XML autorizado`, data: d.data_emissao, acao: 'Abrir', destino: 'contabilidade', filtro
      }));
    } else if (d.falta_arquivo) {
      pend.push(pendencia({
        nivel: 'documental', chave: `docrec_sem_arquivo_${d.id}`, fonte: 'documentos_recebidos', titulo: `${d.rotulo}${quem} sem o arquivo`,
        descricao: `${c.reais(d.valor_total)} · anexe o PDF da nota (ou a foto do recibo/guia)`, data: d.data_emissao, acao: 'Abrir', destino: 'contabilidade', filtro
      }));
    }
  }
  // As NFS-e dos pagamentos de comissão e produção feitos no mês.
  const nfsePorPagamento = new Map();
  for (const d of vivos) {
    if (!d.financeiro_pagamento_id) continue;
    const k = String(d.financeiro_pagamento_id);
    nfsePorPagamento.set(k, c.centavos((nfsePorPagamento.get(k) || 0) + c.centavos(d.valor_total)));
  }
  const pagosNoMes = [...contexto.pagamentosFechamento.values()].filter(p => String(p.data || '').startsWith(competencia) && p.valor > 0);
  const semNfse = pagosNoMes.filter(p => (nfsePorPagamento.get(String(p.id)) || 0) < p.valor - 0.009);
  for (const p of semNfse) {
    const registrado = nfsePorPagamento.get(String(p.id)) || 0;
    pend.push(pendencia({
      nivel: NIVEL.nfse_do_fechamento, chave: `nfse_fech_${p.id}`, fonte: 'documentos_recebidos', titulo: `${p.rotulo} sem NFS-e`,
      descricao: `${c.reais(p.valor)} pagos em ${c.impressa(p.data)}${registrado ? ` · NFS-e registradas: ${c.reais(registrado)}` : ' · registre a nota de serviço de quem recebeu'}`,
      data: p.data, acao: 'Registrar', destino: 'contabilidade', filtro: { acao: 'registrar-documento', tipo: 'nfse', financeiro_pagamento_id: p.id }
    }));
  }
  const semConta = doMes.filter(d => d.sem_conta);
  if (semConta.length) {
    pend.push(pendencia({
      nivel: 'aviso', chave: 'docrec_sem_conta', fonte: 'documentos_recebidos',
      titulo: c.plural(semConta.length, 'documento sem conta a pagar', 'documentos sem conta a pagar'),
      descricao: `Total: ${c.reais(semConta.reduce((s, d) => s + d.valor_total, 0))} · lance a conta ou marque "sem pagamento" (bonificação, remessa)`,
      data: semConta.map(d => d.data_emissao).sort()[0], acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'documentos-recebidos' }
    }));
  }
  const junta = tipo => { const l = doMes.filter(d => d.tipo === tipo); return { quantidade: l.length, total: c.centavos(l.reduce((s, d) => s + d.valor_total, 0)) }; };
  const nfe = junta('nfe');
  const nfse = junta('nfse');
  const outro = junta('outro');
  return {
    resumo: [
      { rotulo: 'NF-e de entrada', valor: `${nfe.quantidade} · ${c.reais(nfe.total)}` },
      { rotulo: 'NFS-e', valor: `${nfse.quantidade} · ${c.reais(nfse.total)}` },
      { rotulo: 'Recibos e guias', valor: `${outro.quantidade} · ${c.reais(outro.total)}` },
      { rotulo: 'Fechamentos sem NFS-e', valor: String(semNfse.length) }
    ],
    numeros: { nfe, nfse, outro, sem_arquivo: doMes.filter(d => d.falta_xml || d.falta_arquivo).length, sem_conta: semConta.length, fechamentos_sem_nfse: semNfse.length },
    pendencias: pend
  };
}

// ------------------------------------------------------------- contas a pagar

/**
 * Os pagamentos do mês (pela data) e as parcelas vencidas.
 *   - pagamento sem nota, recibo ou guia ........ crítico (C2), um por pagamento
 *                                                 (tarifa do banco: o extrato basta)
 *   - pagamento sem comprovante ................. crítico (C3), junta todos
 *   - parcela vencida sem pagamento registrado .. aviso (junta todas)
 * Fase H (DDA do BB, `pagar.dda` = os boletos; null sem o SQL dela):
 *   - boleto do DDA do mês sem conta ............ aviso (lançar, ligar ou
 *                                                 contestar: estar no DDA não
 *                                                 prova que a dívida é devida)
 *   - boleto liquidado, conta em aberto ......... aviso
 *   - pagamento por boleto sem o boleto ......... documental, só com o DDA
 *                                                 ligado (no pacote o boleto vai
 *                                                 junto do comprovante; vale o do
 *                                                 DDA ou o PDF anexado)
 * `pagar` null = falta o SQL da etapa. Pura.
 */
function fonteContasPagar({ pagar, competencia, hoje, ddaAtivo = false, encerrada = false, inicio = null }) {
  if (!pagar) return { indisponivel: SEM_SQL_PAGAR, resumo: [], numeros: null, pendencias: [] };
  const mapa = pagar.arquivosMapa || new Map();
  const docsVivos = new Set(c.lista(pagar.documentos).filter(d => d && !d.excluido_em).map(d => String(d.id)));
  const lista = c.lista(pagar.titulos);
  const pagamentos = lista.flatMap(t => t.parcelas.filter(p => p.pagamento && String(p.pagamento.data).startsWith(competencia)).map(p => ({ t, p })));
  const pend = [];
  const temDocumento = t => (t.documento_recebido_id !== null && t.documento_recebido_id !== undefined && docsVivos.has(String(t.documento_recebido_id)))
    || (mapa.get(`titulo:${t.id}`) || []).some(a => arquivos.CATEGORIAS_DE_DOCUMENTO.has(a.categoria));
  // Resposta 1 a do dono (fase B): imposto, conta de consumo e tarifa se provam com o comprovante do
  // banco — a conta do plano marcada "o comprovante basta".
  const indicePlano = Array.isArray(pagar.plano) ? planoMod.indexar(pagar.plano) : null;
  const comprovanteBasta = t => Boolean(indicePlano) && planoMod.contaDaCategoria(t.categoria, pagar.plano, indicePlano)?.comprovante_basta === true;
  // Fase D: o comprovante do BB (dados) ligado ao lançamento do extrato que paga a conta também vale.
  const comprovados = pagar.comprovados instanceof Set ? pagar.comprovados : new Set();
  const temComprovante = p => (mapa.get(`pagamento:${p.pagamento.id}`) || []).some(a => a.categoria === 'comprovante') || comprovados.has(`titulo_pagamento:${p.pagamento.id}`);
  for (const { t, p } of pagamentos) {
    const basta = comprovanteBasta(t);
    if (temDocumento(t) || ehTarifaDoBanco(t) || (basta && temComprovante(p))) continue;
    pend.push(pendencia({
      nivel: NIVEL.pagamento_sem_documento, chave: `pagar_sem_doc_${p.pagamento.id}`, fonte: 'contas_pagar',
      titulo: `Pagamento sem nota ou recibo — ${t.fornecedor || t.descricao}`,
      descricao: `${c.reais(p.pagamento.valor_pago)} em ${c.impressa(p.pagamento.data)} · ${t.descricao} · `
        + (basta ? 'anexe o comprovante do banco (nesta conta do plano ele basta como documento)' : 'anexe a nota, o recibo ou a guia na conta'),
      data: p.pagamento.data, acao: 'Abrir', destino: 'contabilidade', filtro: { acao: 'conta-pagar', titulo_id: t.id }
    }));
  }
  // Tarifa do banco não tem comprovante (o BB nem manda no ZIP): o extrato é a prova.
  const semComprovante = pagamentos.filter(({ t, p }) => !ehTarifaDoBanco(t) && !temComprovante(p));
  if (semComprovante.length) {
    // Fase D: o caminho é anexar o ZIP do BB (os comprovantes ligam sozinhos ao extrato).
    pend.push(pendencia({
      nivel: NIVEL.pagamento_sem_comprovante, chave: 'pagar_sem_comprovante', fonte: 'contas_pagar',
      titulo: c.plural(semComprovante.length, 'pagamento sem comprovante', 'pagamentos sem comprovante'),
      descricao: `Total: ${c.reais(semComprovante.reduce((s, x) => s + x.p.pagamento.valor_pago, 0))} · anexe o ZIP dos comprovantes do BB (ou o comprovante em cada pagamento); sem ele a competência não fecha`,
      data: semComprovante.map(x => x.p.pagamento.data).sort()[0], acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'comprovantes' }
    }));
  }
  // Fase D: o comprovante anexado que não achou o lançamento do extrato.
  const semLancamento = c.lista(pagar.comprovantes).filter(x => x && x.situacao === 'novo' && String(c.dia(x.data) || '').startsWith(competencia));
  if (semLancamento.length) {
    pend.push(pendencia({
      nivel: 'aviso', chave: 'comprovantes_sem_lancamento', fonte: 'contas_pagar',
      titulo: `${c.plural(semLancamento.length, 'comprovante do BB', 'comprovantes do BB')} sem lançamento do extrato`,
      descricao: `Total: ${c.reais(semLancamento.reduce((s, x) => s + (Number(x.valor) || 0), 0))} · ligue ao débito do extrato (ou importe o extrato do período)`,
      data: semLancamento.map(x => c.dia(x.data)).sort()[0], acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'comprovantes', visao: 'sem_par' }
    }));
  }
  const limite = b.ultimoDia(competencia);
  const diaDeHoje = c.dia(hoje);
  const vencidas = lista.flatMap(t => t.parcelas.filter(p => p.situacao === 'vencida' && p.vencimento <= limite && p.vencimento < diaDeHoje));
  if (vencidas.length) {
    const maisAntiga = vencidas.map(p => p.vencimento).sort()[0];
    pend.push(pendencia({
      nivel: 'aviso', chave: 'pagar_vencidas', fonte: 'contas_pagar',
      titulo: `${c.plural(vencidas.length, 'parcela vencida', 'parcelas vencidas')} sem pagamento registrado`,
      descricao: `Total: ${c.reais(vencidas.reduce((s, p) => s + p.valor, 0))} · a mais antiga venceu em ${c.impressa(maisAntiga)}`,
      data: maisAntiga, acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'contas-pagar', visao: 'vencidas' }
    }));
  }
  const doDda = pendenciasDoDda({ pagar, competencia, pagamentos, ddaAtivo });
  pend.push(...doDda.pendencias);
  // Fase F: o que a empresa pagou em nome de outra (a Artdeco) e ainda não voltou — avisos.
  for (const p of terceirosMod.pendencias({ competencia, dados: pagar.terceiros || null })) {
    pend.push(pendencia({ ...p, fonte: 'contas_pagar', destino: 'contabilidade' }));
  }
  // Fase G: a fatura do cartão do mês, a que não fecha e as compras sem nota.
  for (const p of cartaoMod.pendencias({ competencia, dados: pagar.cartao || null, config: pagar.cartao?.config, inicio, encerrada })) {
    pend.push(pendencia({ ...p, fonte: 'contas_pagar', destino: 'contabilidade' }));
  }
  const totais = titulos.totaisDaCompetencia(lista, { competencia, hoje });
  const pagoNoMes = { quantidade: pagamentos.length, total: c.centavos(pagamentos.reduce((s, x) => s + x.p.pagamento.valor_pago, 0)) };
  return {
    resumo: [
      { rotulo: 'Pago no mês', valor: `${pagoNoMes.quantidade} · ${c.reais(pagoNoMes.total)}` },
      { rotulo: 'Vence no mês (em aberto)', valor: c.reais(totais.vence_no_mes.total) },
      { rotulo: 'Vencidas em aberto', valor: `${vencidas.length} · ${c.reais(vencidas.reduce((s, p) => s + p.valor, 0))}` },
      { rotulo: 'Sem comprovante', valor: String(semComprovante.length) }
    ],
    numeros: {
      pago_no_mes: pagoNoMes, vence_no_mes: totais.vence_no_mes, vencidas: vencidas.length, sem_comprovante: semComprovante.length, sem_documento: pend.filter(x => x.chave.startsWith('pagar_sem_doc_')).length,
      ...doDda.numeros
    },
    pendencias: pend
  };
}

/** As pendências do DDA dentro da fonte das contas a pagar (fase H). Pura. */
function pendenciasDoDda({ pagar, competencia, pagamentos, ddaAtivo }) {
  const boletos = Array.isArray(pagar?.dda) ? pagar.dda.filter(Boolean) : null;
  if (!boletos) return { pendencias: [], numeros: {} };
  const pend = [];
  const doMes = boletos.filter(x => String(c.dia(x.vencimento) || '').startsWith(competencia));
  const semConta = doMes.filter(x => x.situacao === 'novo');
  if (semConta.length) {
    pend.push(pendencia({
      nivel: 'aviso', chave: 'dda_sem_conta', fonte: 'contas_pagar',
      titulo: `${c.plural(semConta.length, 'boleto do DDA', 'boletos do DDA')} sem conta a pagar`,
      descricao: `Total: ${c.reais(semConta.reduce((s, x) => s + (Number(x.valor) || 0), 0))} · lance a conta, ligue a uma conta ou conteste (estar no DDA não prova que a dívida é devida)`,
      data: semConta.map(x => c.dia(x.vencimento)).sort()[0], acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'dda', visao: 'sem_conta' }
    }));
  }
  const parcelas = new Map(c.lista(pagar.titulos).flatMap(t => t.parcelas.map(p => [String(p.id), p])));
  const pagoEmAberto = doMes.filter(x => x.situacao === 'vinculado' && Number(x.estado_bb) === 3 && parcelas.get(String(x.parcela_id)) && !parcelas.get(String(x.parcela_id)).pagamento);
  if (pagoEmAberto.length) {
    pend.push(pendencia({
      nivel: 'aviso', chave: 'dda_pago_em_aberto', fonte: 'contas_pagar',
      titulo: `${c.plural(pagoEmAberto.length, 'boleto liquidado no DDA', 'boletos liquidados no DDA')} com a conta em aberto`,
      descricao: 'O banco diz que foi pago: concilie o débito do extrato (a conta é paga junto) ou registre o pagamento',
      data: pagoEmAberto.map(x => c.dia(x.vencimento)).sort()[0], acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'dda', visao: 'ligados' }
    }));
  }
  // O boleto vai junto do comprovante no pacote (regra do dono): o do DDA ligado à parcela ou o PDF anexado.
  const mapa = pagar.arquivosMapa || new Map();
  const comBoleto = new Set(boletos.filter(x => x.situacao === 'vinculado' && x.parcela_id).map(x => String(x.parcela_id)));
  const temArquivoDeBoleto = ({ t, p }) => [`titulo:${t.id}`, `pagamento:${p.pagamento.id}`].some(k => (mapa.get(k) || []).some(a => a.categoria === 'boleto'));
  const porBoleto = c.lista(pagamentos).filter(({ p }) => p.pagamento.forma === 'Boleto' || b.digitos(p.linha_digitavel));
  const semBoleto = ddaAtivo ? porBoleto.filter(x => !comBoleto.has(String(x.p.id)) && !temArquivoDeBoleto(x)) : [];
  if (semBoleto.length) {
    pend.push(pendencia({
      nivel: 'documental', chave: 'pagar_sem_boleto', fonte: 'contas_pagar',
      titulo: `${c.plural(semBoleto.length, 'pagamento por boleto', 'pagamentos por boleto')} sem o boleto`,
      descricao: `Total: ${c.reais(semBoleto.reduce((s, x) => s + x.p.pagamento.valor_pago, 0))} · ligue o boleto do DDA à conta (ou anexe o PDF do boleto do fornecedor): no pacote o boleto vai junto do comprovante`,
      data: semBoleto.map(x => x.p.pagamento.data).sort()[0], acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'dda', visao: 'sem_conta' }
    }));
  }
  return {
    pendencias: pend,
    numeros: { dda_sem_conta: semConta.length, dda_pago_em_aberto: pagoEmAberto.length, sem_boleto: semBoleto.length }
  };
}

// ------------------------------------------------------------- extrato bancário

const SEM_SQL_EXTRATO = `Falta rodar ${b.SQL_ARQUIVO_EXTRATO} no banco e reiniciar a API.`;

/**
 * O extrato das contas correntes ativas cobre o mês? Mês terminado sem o
 * OFX inteiro = crítico (C4), uma pendência por conta (o que falta, de que
 * dia a que dia). O dono quer o OFX mesmo com a API (02/10/2026): o que a
 * busca da API trouxe não conta para "extrato completo". Sem conta
 * cadastrada = documental. No mês em curso, só o resumo. `extrato` null =
 * falta o SQL da etapa 4. Pura.
 */
function fonteExtrato({ extrato, competencia, hoje, encerrada, inicio = null }) {
  if (!extrato) return { indisponivel: SEM_SQL_EXTRATO, resumo: [], numeros: null, pendencias: [] };
  const correntes = c.lista(extrato.contas).filter(x => x && x.ativa !== false && x.ativa !== 'false' && (x.tipo || 'corrente') === 'corrente');
  const pend = [];
  if (!correntes.length) {
    pend.push(pendencia({
      nivel: 'documental', chave: 'extrato_sem_conta', fonte: 'extrato', titulo: 'Cadastre a conta do banco',
      descricao: 'Sem a conta corrente cadastrada não dá para importar o extrato do mês', data: b.ultimoDia(competencia),
      acao: 'Cadastrar', destino: 'contabilidade', filtro: { acao: 'contas-financeiras' }
    }));
  }
  const doOfx = i => i?.origem !== 'api';
  const coberturas = correntes.map(conta => ({ conta, cob: extratoMod.cobertura(c.lista(extrato.importacoes).filter(i => String(i.conta_id) === String(conta.id) && doOfx(i)), competencia, { hoje }) }));
  if (encerrada) {
    for (const { conta, cob } of coberturas) {
      if (cob.completa) continue;
      const nada = !cob.de;
      pend.push(pendencia({
        nivel: NIVEL.extrato_incompleto, chave: `extrato_${conta.id}`, fonte: 'extrato',
        titulo: `OFX de ${c.rotuloCompetencia(competencia)} — ${conta.nome}${nada ? ' não importado' : ' incompleto'}`,
        descricao: `Falta: ${cob.faltas.map(extratoMod.faixaImpressa).join(', ')} · importe o OFX do mês (Gerenciador Financeiro do BB); a busca pela API não substitui o OFX`,
        data: b.ultimoDia(competencia), acao: 'Importar', destino: 'contabilidade', filtro: { acao: 'importar-extrato', conta_id: conta.id }
      }));
    }
  }
  // 19b (fase A): o saldo de abertura digitado na conta, levado até o dia do saldo do banco, tem de bater.
  const vespera = new Date(Date.UTC(Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  for (const conta of correntes) {
    const digitado = extratoMod.saldoDigitado(conta);
    if (!digitado && inicio && competencia === inicio) {
      pend.push(pendencia({
        nivel: 'aviso', chave: `saldo_abertura_${conta.id}`, fonte: 'extrato', titulo: `Digite o saldo de abertura de ${conta.nome}`,
        descricao: `O saldo no fim de ${c.impressa(vespera)}, o dia antes do início da Contabilidade: o livro-caixa começa por ele e é conferido com o banco`,
        data: `${competencia}-01`, acao: 'Abrir', destino: 'contabilidade', filtro: { acao: 'contas-financeiras' }
      }));
      continue;
    }
    if (!digitado || digitado.data >= b.ultimoDia(competencia)) continue;
    const saldoBanco = extratoMod.saldoDoBanco(c.lista(extrato.importacoes).filter(i => String(i.conta_id) === String(conta.id)), competencia);
    const daConta = c.lista(extrato.porConta?.get(String(conta.id)) || extrato.movimentos).filter(m => m && String(m.conta_id) === String(conta.id));
    const conf = extratoMod.conferirSaldo(conta, daConta, saldoBanco);
    if (conf && Math.abs(conf.diferenca) > 0.009) {
      pend.push(pendencia({
        nivel: 'aviso', chave: `saldo_${conta.id}`, fonte: 'extrato', titulo: `Saldo de ${conta.nome} não confere com o banco`,
        descricao: `Em ${c.impressa(conf.data)}: livro ${c.reais(conf.livro)} (pelo saldo de abertura digitado) × banco ${c.reais(conf.banco)} — o livro tem ${c.reais(Math.abs(conf.diferenca))} a ${conf.diferenca < 0 ? 'menos' : 'mais'} · confira o saldo de abertura e se falta lançamento no extrato`,
        data: conf.data, acao: 'Abrir', destino: 'contabilidade', filtro: { acao: 'contas-financeiras' }
      }));
    }
  }
  // Fase C: o Rende Fácil e o CDB pelos PDFs mensais — falta o PDF, o PDF não fecha, o extrato não bate.
  for (const p of aplicacoesMod.pendencias({ competencia, dados: extrato.aplicacoes || null, encerrada })) {
    pend.push(pendencia({ ...p, fonte: 'extrato', destino: 'contabilidade' }));
  }
  const doMes = c.lista(extrato.movimentos).filter(m => m && m.competencia === competencia);
  const totais = extratoMod.totaisDe(doMes);
  const cobreTudo = coberturas.length && coberturas.every(x => x.cob.completa);
  const faixa = coberturas.length === 1 && coberturas[0].cob.de ? `${c.impressa(coberturas[0].cob.de)} a ${c.impressa(coberturas[0].cob.ate)}` : null;
  return {
    resumo: [
      { rotulo: 'Lançamentos no mês', valor: String(totais.quantidade) },
      { rotulo: 'Entradas', valor: c.reais(totais.entradas.total) },
      { rotulo: 'Saídas', valor: c.reais(totais.saidas.total) },
      { rotulo: 'OFX', valor: !coberturas.length ? 'Sem conta' : (cobreTudo ? (faixa || 'Completo') : (faixa ? `${faixa} (falta)` : 'Não importado')) }
    ],
    numeros: { contas: correntes.length, movimentos: totais.quantidade, entradas: totais.entradas.total, saidas: totais.saidas.total, completo: Boolean(cobreTudo) },
    pendencias: pend
  };
}

// ------------------------------------------------------------- conciliação (etapa 5)

const SEM_EXTRATO_CONCILIACAO = `Depende do extrato: falta rodar ${b.SQL_ARQUIVO_EXTRATO} no banco e reiniciar a API.`;

/**
 * A conciliação do mês (todas as contas):
 *   critico     (C5) lançamentos do extrato sem conciliação (junta todos; cada um
 *               se resolve na Conciliação — conciliando ou ignorando com
 *               justificativa)
 *   critico     conciliação com um pagamento/recebimento que foi estornado ou
 *               mudou de valor (um por lançamento): o banco diz uma coisa e o
 *               app outra — desfaça e concilie de novo
 *   aviso       o que o app registrou pelo banco, num trecho que o extrato
 *               cobre, sem lançamento correspondente
 *   critico     (C7, etapa 6) lançamentos sem conta do plano — nem à mão, nem pela
 *               conciliação, nem por regra (junta todos)
 * `conciliacao` = null quando falta o SQL do extrato; `{ semSql }` quando
 * falta o da conciliação; `classificacao.semSql` quando falta o da etapa 6. Pura.
 */
function fonteConciliacao({ conciliacao, competencia }) {
  if (!conciliacao) return { indisponivel: SEM_EXTRATO_CONCILIACAO, resumo: [], numeros: null, pendencias: [] };
  if (conciliacao.semSql) return { indisponivel: conciliacao.semSql, resumo: [], numeros: null, pendencias: [] };
  const movimentos = c.lista(conciliacao.movimentos);
  const estado = m => (['conciliado', 'ignorado'].includes(m?.estado_conciliacao) ? m.estado_conciliacao : 'pendente');
  const pendentes = movimentos.filter(m => estado(m) === 'pendente');
  const conciliados = movimentos.filter(m => estado(m) === 'conciliado');
  const ignorados = movimentos.filter(m => estado(m) === 'ignorado');
  const somaAbs = l => c.centavos(l.reduce((s, m) => s + Math.abs(Number(m.valor) || 0), 0));
  const sugeridos = Number(conciliacao.sugeridos) || 0;
  const sem = c.lista(conciliacao.semLancamento);
  const pend = [];
  if (pendentes.length) {
    pend.push(pendencia({
      nivel: NIVEL.sem_conciliacao, chave: 'conciliacao_pendente', fonte: 'conciliacao',
      titulo: `${c.plural(pendentes.length, 'lançamento do extrato', 'lançamentos do extrato')} sem conciliação`,
      descricao: `Total ${c.reais(somaAbs(pendentes))}${sugeridos ? ` · ${c.plural(sugeridos, 'com sugestão', 'com sugestão')}` : ''} · concilie ou ignore cada um com justificativa`,
      data: b.ultimoDia(competencia), acao: 'Conciliar', destino: 'contabilidade', filtro: { acao: 'conciliacao', visao: 'pendentes' }
    }));
  }
  for (const x of c.lista(conciliacao.invalidos)) {
    const m = x.movimento || {};
    pend.push(pendencia({
      nivel: 'critico', chave: `conciliacao_invalida_${x.vinculo.movimento_id}`, fonte: 'conciliacao',
      titulo: 'Conciliação com registro que mudou',
      descricao: `Lançamento de ${c.impressa(c.dia(m.data))} (${c.reais(m.valor)}) — ${x.liq?.rotulo || `${x.vinculo.alvo_tipo} ${x.vinculo.alvo_id}`}: ${x.motivo}. Desfaça a conciliação e concilie de novo`,
      data: c.dia(m.data), acao: 'Conciliar', destino: 'contabilidade', filtro: { acao: 'conciliacao', visao: 'conciliados', movimento_id: x.vinculo.movimento_id }
    }));
  }
  if (sem.length) {
    pend.push(pendencia({
      nivel: 'aviso', chave: 'conciliacao_sem_lancamento', fonte: 'conciliacao',
      titulo: `${c.plural(sem.length, 'registro do app sem lançamento no extrato', 'registros do app sem lançamento no extrato')}`,
      descricao: `Total ${c.reais(c.centavos(sem.reduce((s, l) => s + Math.abs(l.valor), 0)))} · confira o dia e o valor registrados (ou se foi mesmo pelo banco)`,
      data: b.ultimoDia(competencia), acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'conciliacao', visao: 'pendentes' }
    }));
  }
  // Etapa 6: lançamento sem conta do plano (nem à mão, nem pela conciliação, nem por regra).
  const cls = conciliacao.classificacao || null;
  if (cls && !cls.semSql && cls.sem > 0) {
    pend.push(pendencia({
      nivel: NIVEL.sem_classificacao, chave: 'classificacao_pendente', fonte: 'conciliacao',
      titulo: `${c.plural(cls.sem, 'lançamento do extrato', 'lançamentos do extrato')} sem classificação`,
      descricao: `Total ${c.reais(cls.sem_valor || 0)} · escolha a conta do plano (ou crie uma regra que valha para os próximos)`,
      data: b.ultimoDia(competencia), acao: 'Classificar', destino: 'contabilidade', filtro: { acao: 'classificacao', visao: 'sem' }
    }));
  }
  const valorClassificacao = !cls ? '—' : (cls.semSql ? 'falta o SQL' : (cls.sem ? `${cls.sem} · ${c.reais(cls.sem_valor || 0)}` : '0'));
  return {
    resumo: [
      { rotulo: 'Conciliados', valor: movimentos.length ? `${conciliados.length} de ${movimentos.length}` : '0' },
      { rotulo: 'A conciliar', valor: pendentes.length ? `${pendentes.length} · ${c.reais(somaAbs(pendentes))}` : '0' },
      { rotulo: 'Sem classificação', valor: valorClassificacao },
      { rotulo: 'Sem lançamento no extrato', valor: String(sem.length) }
    ],
    numeros: {
      movimentos: movimentos.length, conciliados: conciliados.length, pendentes: pendentes.length, ignorados: ignorados.length, sugeridos,
      sem_lancamento: sem.length, invalidos: c.lista(conciliacao.invalidos).length, sem_classificacao: cls && !cls.semSql ? cls.sem : null
    },
    pendencias: pend
  };
}

// ------------------------------------------------------------- montagem

function estadoDaFonte(fonte, pendencias, { encerrada }) {
  if (fonte.etapa) return 'indisponivel';
  if (fonte.indisponivel) return 'indisponivel';
  const vivas = pendencias.filter(p => !p.ignorada);
  if (vivas.some(p => p.nivel === 'critico')) return 'critico';
  if (vivas.some(p => p.nivel === 'documental')) return 'pendente';
  if (vivas.some(p => p.nivel === 'aviso')) return 'aviso';
  return encerrada || !['fechamentos', 'extrato', 'conciliacao'].includes(fonte.chave) ? 'ok' : 'em_curso';
}

/**
 * Monta o painel da competência a partir das listas já lidas. `situacao` é a
 * linha de competencia_contabil (ou null = aberta); `resolucoes` são as
 * pendências ignoradas desta competência; `receber` é o painel de contas a
 * receber (ou null, com `receberErro` dizendo por quê); `fechamentos` é a
 * lista de fechamentos fechados de todas as competências (null = sem o SQL).
 */
/** O nome de cada integração para as pendências (o catálogo completo mora em integracoes/catalogo.js). */
const NOME_INTEGRACAO = { sefaz_nfe: 'NF-e de entrada (SEFAZ)', bb_extrato: 'Extrato pela API do BB', nfse_adn: 'NFS-e tomadas (ADN)', bb_investimentos: 'Aplicações (BB)', bb_dda: 'Boletos do DDA (BB)' };
const FONTE_INTEGRACAO = { sefaz_nfe: 'documentos_recebidos', nfse_adn: 'documentos_recebidos', bb_extrato: 'extrato', bb_investimentos: 'extrato', bb_dda: 'contas_pagar' };

/**
 * Etapas 10 a 13: o que as buscas automáticas acharam e ainda não entrou.
 *   - NF-e / NFS-e do mês na caixa de entrada, fora dos documentos ... documental (junta todas)
 *   - nota registrada que o emitente cancelou ......................... aviso, uma por nota
 *   - integração ligada com erro na última busca ........................ aviso, uma por integração
 * `entradaDfe` / `integracoes` null = falta o SQL das integrações (nada aparece). Pura.
 */
function pendenciasDasIntegracoes({ entradaDfe = null, integracoes = null, competencia }) {
  const pend = [];
  if (Array.isArray(entradaDfe)) {
    const doMes = entradaDfe.filter(l => l && String(c.dia(l.data_emissao) || '').startsWith(competencia));
    const abertas = doMes.filter(l => (l.status === 'nova' || l.status === 'completa') && l.situacao_nota !== 'cancelada');
    if (abertas.length) {
      const nfe = abertas.filter(l => l.tipo === 'nfe').length;
      const nfse = abertas.length - nfe;
      const partes = [nfe ? c.plural(nfe, 'NF-e', 'NF-e') : null, nfse ? c.plural(nfse, 'NFS-e', 'NFS-e') : null].filter(Boolean).join(' e ');
      // 22b: a desconhecida / não realizada na SEFAZ continua aqui até alguém ignorar à mão.
      const recusadas = abertas.filter(l => ['desconhecimento', 'nao_realizada'].includes(l.manifestacao)).length;
      pend.push(pendencia({
        nivel: 'documental', chave: 'entrada_pendente', fonte: 'documentos_recebidos',
        titulo: `${partes} da SEFAZ/ADN ainda fora dos documentos`,
        descricao: `Total: ${c.reais(abertas.reduce((s, l) => s + (Number(l.valor) || 0), 0))} · registre, dê ciência ou ignore com o motivo (não é despesa da empresa)`
          + (recusadas ? ` · ${c.plural(recusadas, 'já manifestada', 'já manifestadas')} como desconhecida/não realizada: falta ignorar à mão` : ''),
        data: abertas.map(l => c.dia(l.data_emissao)).filter(Boolean).sort()[0] || null, acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'entrada-dfe' }
      }));
    }
    for (const l of entradaDfe.filter(x => x && x.status === 'registrada' && x.situacao_nota === 'cancelada' && x.documento_recebido_id)) {
      pend.push(pendencia({
        nivel: 'aviso', chave: `entrada_cancelada_${l.id}`, fonte: 'documentos_recebidos',
        titulo: `${l.tipo === 'nfse' ? 'NFS-e' : 'NF-e'} ${l.numero || ''} de ${l.emitente_nome || 'emitente'} foi cancelada pelo emitente`.replace(/\s+/g, ' '),
        descricao: 'A nota está registrada nos documentos: confira e exclua o documento (e a conta) se a compra não valeu',
        data: c.dia(l.data_emissao), acao: 'Abrir', destino: 'contabilidade', filtro: { acao: 'documento-recebido', documento_id: l.documento_recebido_id }
      }));
    }
  }
  for (const i of c.lista(integracoes).filter(x => x && x.ativa && x.ultimo_erro && NOME_INTEGRACAO[x.chave])) {
    pend.push(pendencia({
      nivel: 'aviso', chave: `integracao_erro_${i.chave}`, fonte: FONTE_INTEGRACAO[i.chave],
      titulo: `${NOME_INTEGRACAO[i.chave]}: a última busca deu erro`,
      descricao: String(i.ultimo_erro).slice(0, 200), data: c.dia(i.ultima_execucao_em), acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'configuracao' }
    }));
  }
  return pend;
}

function montar({
  competencia, hoje, notas = [], externas = [], aguardando = null, receber = null, receberErro = null,
  fechamentos: lista = [], reembolsosPendencias = [], situacao = null, resolucoes = [], nomes = new Map(), sqlPendente = false,
  pagar = null, extrato = null, conciliacao = null, versao = null, pacotes = null, entradaDfe = null, integracoes = null, inicio = null
}) {
  const comp = competenciaValida(competencia, hoje);
  const diaDeHoje = c.dia(hoje);
  const encerrada = comp < c.competenciaDe(diaDeHoje);
  // Fase A: o mês de antes do início da Contabilidade não é cobrado nem fechado.
  const antes = parametros.antesDoInicio(comp, inicio);

  const partes = {
    nfe_saida: fonteNfe({ notas: notas.map(semXml), externas, aguardando, competencia: comp, hoje: diaDeHoje }),
    recebimentos: fonteRecebimentos({ receber, receberErro }),
    fechamentos: fonteFechamentos({ fechamentos: lista, competencia: comp, hoje: diaDeHoje, encerrada }),
    devolucoes: fonteDevolucoes({ reembolsosPendencias, hoje: diaDeHoje }),
    documentos_recebidos: fonteDocumentosRecebidos({ pagar, competencia: comp, hoje: diaDeHoje }),
    contas_pagar: fonteContasPagar({
      pagar, competencia: comp, hoje: diaDeHoje, encerrada, inicio, ddaAtivo: c.lista(integracoes).some(i => i && i.chave === 'bb_dda' && (i.ativa === true || i.ativa === 'true'))
    }),
    extrato: fonteExtrato({ extrato, competencia: comp, hoje: diaDeHoje, encerrada, inicio }),
    conciliacao: fonteConciliacao({ conciliacao, competencia: comp })
  };

  // Etapa 7: fechada com versão — o que o sistema diz hoje × a foto do fechamento (aviso, com a lista).
  const fechadaAgora = situacao?.status === 'fechada';
  const diferencas = fechadaAgora && versao?.versao
    ? versoes.divergencias(versao.versao, { lancamentos: versao.lancamentos, fontes: FONTES.map(f => ({ chave: f.chave, numeros: partes[f.chave]?.numeros || null })) })
    : [];
  const doFechamento = diferencas.length ? [pendencia({
    nivel: NIVEL.diferenca_pos_fechamento, chave: 'fechamento_diferencas', fonte: 'fechamento',
    titulo: `${c.plural(diferencas.length, 'diferença', 'diferenças')} desde o fechamento (versão ${versao.versao.versao})`,
    descricao: `${diferencas.slice(0, 2).map(d => d.titulo).join(' · ')}${diferencas.length > 2 ? ' · …' : ''} — a foto do fechamento não muda; reabra para refazer`,
    data: c.dia(versao.versao.fechada_em), acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'fechamentos' }
  })] : [];

  // Etapa 9: fechada, o pacote precisa ir para a contabilidade — e o enviado tem de ser o da versão que vale.
  const doPacote = [];
  const pacotesDoMes = c.lista(pacotes).slice().sort((x, y) => String(y.gerado_em).localeCompare(String(x.gerado_em)) || Number(y.id) - Number(x.id));
  const ultimoPacote = pacotesDoMes[0] || null;
  const enviado = pacotesDoMes.find(p => p.enviado_em) || null;
  const versaoAtual = versao?.versao ? Number(versao.versao.versao) : null;
  if (fechadaAgora && pacotes !== null) {
    if (!enviado) {
      doPacote.push(pendencia({
        nivel: 'aviso', chave: 'pacote_nao_enviado', fonte: 'fechamento',
        titulo: 'Pacote ainda não enviado à contabilidade',
        descricao: ultimoPacote
          ? `Gerado em ${b.instanteBR(ultimoPacote.gerado_em)?.slice(0, 10).split('-').reverse().join('/')}: depois de mandar, marque como enviado`
          : 'Gere o pacote (ZIP), mande para a contabilidade e marque como enviado',
        data: c.dia(situacao?.fechada_em), acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'pacote' }
      }));
    } else if (versaoAtual && Number(enviado.versao) !== versaoAtual) {
      doPacote.push(pendencia({
        nivel: 'aviso', chave: 'pacote_desatualizado', fonte: 'fechamento',
        titulo: `O pacote enviado é da versão ${enviado.versao || 'sem versão'}; a competência está na versão ${versaoAtual}`,
        descricao: 'A competência foi reaberta e fechada de novo: gere e mande o pacote da versão que vale',
        data: c.dia(situacao?.fechada_em), acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'pacote' }
      }));
    }
  }

  // Etapas 10 a 13: a caixa de entrada e os erros das buscas automáticas.
  const doIntegracoes = pendenciasDasIntegracoes({ entradaDfe, integracoes, competencia: comp });

  // As ignoradas: continuam na lista, marcadas, sem contar para os bloqueios.
  const ignoradas = new Map(c.lista(resolucoes).map(r => [String(r.chave), r]));
  const pendencias = (antes ? [] : [...Object.values(partes).flatMap(p => p.pendencias), ...doFechamento, ...doPacote, ...doIntegracoes]).map(p => {
    const r = ignoradas.get(p.chave);
    if (!r || p.nivel === 'critico') return p;
    return { ...p, ignorada: true, justificativa: r.justificativa || '', ignorada_em: b.instanteBR(r.criado_em), ignorada_por: nomes.get(String(r.usuario_id)) || null, resolucao_id: r.id };
  }).sort((x, y) => Number(x.ignorada) - Number(y.ignorada) || b.NIVEIS[x.nivel].ordem - b.NIVEIS[y.nivel].ordem || String(x.data || '').localeCompare(String(y.data || '')));

  const fontes = FONTES.map(f => {
    const parte = partes[f.chave] || {};
    const minhas = pendencias.filter(p => p.fonte === f.chave);
    const estado = antes && !f.etapa && !parte.indisponivel ? 'fora' : estadoDaFonte({ ...f, indisponivel: parte.indisponivel }, minhas, { encerrada });
    return {
      chave: f.chave, titulo: f.titulo, icone: f.icone, estado,
      nota: f.etapa || parte.indisponivel || (antes ? `Antes do início da Contabilidade (${c.rotuloCompetencia(inicio)}): nada é cobrado.` : null),
      resumo: parte.resumo || [], numeros: parte.numeros || null,
      pendencias: minhas.filter(p => !p.ignorada).length
    };
  });

  const vivas = pendencias.filter(p => !p.ignorada);
  const contagem = {
    critico: vivas.filter(p => p.nivel === 'critico').length,
    documental: vivas.filter(p => p.nivel === 'documental').length,
    aviso: vivas.filter(p => p.nivel === 'aviso').length,
    ignoradas: pendencias.length - vivas.length,
    total: pendencias.length
  };
  const avaliaveis = fontes.filter(f => f.estado !== 'indisponivel');
  const progresso = { ok: avaliaveis.filter(f => f.estado === 'ok').length, total: avaliaveis.length };

  const status = situacao?.status === 'fechada' ? 'fechada' : (situacao?.status === 'reaberta' ? 'reaberta' : 'aberta');
  const bloqueiosFechar = [];
  if (antes) bloqueiosFechar.push(`A Contabilidade começa em ${c.rotuloCompetencia(inicio)}: ${c.rotuloCompetencia(comp)} fica de fora (não é cobrada nem fechada).`);
  if (status === 'fechada') bloqueiosFechar.push('A competência já está fechada.');
  if (!encerrada) bloqueiosFechar.push(`A competência ainda está em curso: termina em ${c.impressa(b.ultimoDia(comp))}.`);
  if (contagem.critico) bloqueiosFechar.push(`${c.plural(contagem.critico, 'erro crítico', 'erros críticos')} a resolver (erro crítico não se ignora).`);
  const bloqueiosPacote = [];
  if (status !== 'fechada') bloqueiosPacote.push('A competência precisa estar fechada.');
  if (contagem.documental) bloqueiosPacote.push(`${c.plural(contagem.documental, 'pendência documental', 'pendências documentais')} a resolver ou ignorar com justificativa.`);

  return {
    competencia: comp,
    rotulo: c.rotuloCompetencia(comp),
    hoje: diaDeHoje,
    encerrada,
    sql_pendente: Boolean(sqlPendente),
    inicio: inicio || null,
    antes_do_inicio: antes ? { inicio, rotulo: c.rotuloCompetencia(inicio) } : null,
    situacao: {
      status,
      fechada_em: b.instanteBR(situacao?.fechada_em), fechada_por: nomes.get(String(situacao?.fechada_por)) || null,
      reaberta_em: b.instanteBR(situacao?.reaberta_em), reaberta_por: nomes.get(String(situacao?.reaberta_por)) || null,
      justificativa_reabertura: situacao?.justificativa_reabertura || null,
      // Fechada com erro crítico novo (algo mudou depois): a tela avisa.
      divergencias: status === 'fechada' ? contagem.critico : 0,
      // Etapa 7: a versão que vale e o que mudou desde ela.
      versao: status === 'fechada' && versao?.versao ? Number(versao.versao.versao) : null,
      diferencas: diferencas.length,
      diferencas_lista: diferencas.slice(0, 100),
      // Etapa 9: o último pacote gerado (e se foi enviado).
      pacote: ultimoPacote ? {
        id: ultimoPacote.id, versao: ultimoPacote.versao === null || ultimoPacote.versao === undefined ? null : Number(ultimoPacote.versao),
        gerado_em: b.instanteBR(ultimoPacote.gerado_em), enviado_em: b.instanteBR(enviado?.enviado_em), enviado_para: enviado?.enviado_para || null
      } : null
    },
    fontes,
    pendencias,
    contagem,
    progresso,
    bloqueios: { fechar: bloqueiosFechar, pacote: bloqueiosPacote },
    pode: { fechar: bloqueiosFechar.length === 0, reabrir: status === 'fechada', pacote: bloqueiosPacote.length === 0 }
  };
}

/**
 * Documentos recebidos, contas a pagar, arquivos e os pagamentos dos
 * fechamentos, para as duas fontes da etapa 3. null = falta o SQL da etapa.
 */
async function lerContasPagar(api, hoje) {
  try {
    const [base, docs, arquivosLista, vinculos, pagamentosFechamento, plano, dda, comprovantes, vinculosConc] = await Promise.all([
      titulos.lerBase(api), b.ler(api, 'documentos_recebidos'), b.ler(api, 'contabil_arquivos'), b.ler(api, 'contabil_arquivo_vinculos'),
      documentos.lerPagamentosDeFechamento(api), b.lerOpcional(api, 'plano_contas').catch(() => null),
      // Fase H: os boletos do DDA (null sem o SQL dela).
      b.lerOpcional(api, 'contabil_dda_boletos').catch(() => null),
      // Fase D: os comprovantes do BB e a conciliação (o comprovante prova o pagamento pelo lançamento).
      b.lerOpcional(api, 'contabil_comprovantes').catch(() => null),
      b.lerOpcional(api, 'conciliacao_vinculos').catch(() => null)
    ]);
    return {
      titulos: titulos.montarTodos(base, hoje), documentos: docs, contatos: base.contatos,
      arquivosMapa: arquivos.porAlvo(arquivosLista, vinculos), pagamentosFechamento, plano, dda,
      comprovantes: comprovantes || [], comprovados: comprovantesMod.pagamentosComComprovante({ comprovantes: comprovantes || [], vinculos: vinculosConc || [] }),
      // Fase F: os itens de terceiros (null sem o SQL dela).
      terceiros: await terceirosMod.lerTudo(api).catch(() => null),
      // Fase G: as faturas do cartão e as compras (null sem o SQL dela).
      cartao: await cartaoMod.lerTudo(api).catch(() => null)
    };
  } catch (e) {
    if (e?.extra?.sql_pendente) return null;
    throw e;
  }
}

/** Contas, importações e os movimentos do mês, para a fonte do extrato. null = falta o SQL da etapa 4. */
async function lerExtrato(api, competencia) {
  try {
    const [contas, importacoes, movimentos] = await Promise.all([
      b.ler(api, 'contas_financeiras'), b.ler(api, 'extrato_importacoes'), b.ler(api, 'movimentos_bancarios', { competencia })
    ]);
    // Fase C: as aplicações do mês (null sem o SQL dela).
    const aplicacoes = await aplicacoesMod.lerDoMes(api, competencia).catch(() => null);
    // 19b: a conta com saldo de abertura de antes do mês precisa dos lançamentos desde ele.
    const porConta = new Map();
    for (const conta of contas) {
      const digitado = extratoMod.saldoDigitado(conta);
      if (digitado && digitado.data < `${competencia}-01`) porConta.set(String(conta.id), await b.ler(api, 'movimentos_bancarios', { conta_id: Number(conta.id) }));
    }
    return { contas, importacoes, movimentos, porConta, aplicacoes };
  } catch (e) {
    if (e?.extra?.sql_pendente) return null;
    throw e;
  }
}

/**
 * O que a fonte da conciliação precisa, a partir do extrato já lido: null sem
 * o SQL do extrato; `{ semSql }` sem o da conciliação. Com a `versao` do
 * fechamento (mês fechado, etapa 7), a classificação é a congelada e
 * `lancamentosAtuais` traz a conta de hoje, para as diferenças.
 */
async function lerConciliacao(api, competencia, extrato, hoje, versao = null) {
  if (!extrato) return null;
  const vinculos = await b.lerOpcional(api, 'conciliacao_vinculos');
  if (!vinculos) return { semSql: b.SQL_FALTANDO_CONCILIACAO, lancamentosAtuais: null };
  const movimentos = c.lista(extrato.movimentos).filter(m => m && m.competencia === competencia);
  const ids = new Set(movimentos.map(m => String(m.id)));
  const ligados = vinculos.filter(v => !v.desfeito_em && ids.has(String(v.movimento_id)));
  const { de, ate } = conciliacaoMod.janelaDoMes(competencia);
  const liqs = conciliacaoMod.comRestante(
    await liquidacoes.carregar(api, { de, ate, incluir: ligados.map(v => liquidacoes.chaveDe(v.alvo_tipo, v.alvo_id)) }), vinculos
  );
  const porChave = new Map(liqs.map(l => [l.chave, l]));
  const pendentes = movimentos.filter(m => !['conciliado', 'ignorado'].includes(m.estado_conciliacao));
  const sugestoes = motor.sugerir(pendentes.map(conciliacaoMod.paraMotor), liqs);
  const correntes = c.lista(extrato.contas).filter(x => x && x.ativa !== false && x.ativa !== 'false' && (x.tipo || 'corrente') === 'corrente');
  const coberturas = correntes.map(conta => extratoMod.cobertura(c.lista(extrato.importacoes).filter(i => String(i.conta_id) === String(conta.id)), competencia, { hoje }));
  const porMovimento = new Map(movimentos.map(m => [String(m.id), m]));
  // Um por lançamento (a chave da pendência é do lançamento).
  const invalidos = [...new Map(conciliacaoMod.vinculosInvalidos(ligados, porChave)
    .map(x => [String(x.vinculo.movimento_id), { ...x, movimento: porMovimento.get(String(x.vinculo.movimento_id)) || null }])).values()];
  // Etapa 6: a conta do plano de cada lançamento do mês (sem o SQL dela, só avisa).
  // Mês fechado (etapa 7): vale a congelada; a de hoje fica para as diferenças.
  const classificados = await classificacaoMod.doMes(api, movimentos, { congelado: versao ? versoes.congeladoDe(versao) : null });
  const semConta = classificados ? classificados.filter(x => !x.classificacao.conta_id) : [];
  const classificacao = classificados
    ? { sem: semConta.length, sem_valor: c.centavos(semConta.reduce((s, x) => s + Math.abs(Number(x.movimento.valor) || 0), 0)), total: classificados.length }
    : { semSql: b.SQL_FALTANDO_CLASSIFICACAO };
  const lancamentosAtuais = classificados
    ? classificados.map(x => versoes.lancamentoDaFoto(x.movimento, x.atual || x.classificacao))
    : movimentos.map(m => versoes.lancamentoDaFoto(m, null));
  return {
    movimentos, sugeridos: sugestoes.size, invalidos, classificacao, lancamentosAtuais,
    semLancamento: conciliacaoMod.semLancamento(liqs, { competencia, coberturas, movimentos: pendentes.map(conciliacaoMod.paraMotor), sugestoes })
  };
}

/** Lê tudo o que o painel precisa e monta. `situacao_bruta` volta junto para quem grava (fechamento.js). */
async function carregar({ api, competencia, hoje, desde = null }) {
  const comp = competenciaValida(competencia, hoje);
  let sqlPendente = false;
  let situacao = null;
  let resolucoes = [];
  const [pedidos, notas, externas, receberLido, fech, reembolsosPendencias] = await Promise.all([
    api.get('/api/pedidos').then(c.lista).catch(() => []),
    api.get('/api/notas_fiscais').then(c.lista).catch(() => []),
    externasFiscais.listarNotas(api).catch(() => []),
    contasReceber.carregarPainel({ api, competencia: comp, hoje, desde }).then(painel => ({ painel, erro: null })).catch(erro => ({ painel: null, erro })),
    baseFinanceiro.lerFechamentos(api).then(dados => [...fechamentos.listarDe(dados, 'comissao'), ...fechamentos.listarDe(dados, 'producao')]).catch(() => null),
    reembolsos.pendenciasDoPainel({ api, hoje }).catch(() => [])
  ]);
  try {
    situacao = (await b.ler(api, 'competencia_contabil', { competencia: comp }))[0] || null;
    resolucoes = await b.ler(api, 'contabil_pendencias_resolucoes', { competencia: comp });
  } catch (e) {
    if (!e?.extra?.sql_pendente) throw e;
    sqlPendente = true;
  }
  // Mês fechado (etapa 7): a versão que vale — a classificação dela e a foto para comparar.
  const versao = situacao?.status === 'fechada' ? versoes.ultima((await versoes.lerVersoes(api, comp)) || []) : null;
  // Etapa 9: os pacotes da competência (null sem o SQL da etapa 9).
  const pacotes = sqlPendente ? null : await b.lerOpcional(api, 'contabil_pacotes', { competencia: comp });
  // Etapas 10 a 13: a caixa de entrada e o estado das integrações (null sem o SQL delas).
  const [entradaDfe, integracoes] = sqlPendente ? [null, null] : await Promise.all([
    b.lerOpcional(api, 'contabil_dfe_recebidos').catch(() => null), b.lerOpcional(api, 'contabil_integracoes').catch(() => null)
  ]);
  const [pagar, extrato, inicio] = await Promise.all([lerContasPagar(api, hoje), lerExtrato(api, comp), parametros.inicio(api)]);
  const conciliacao = await lerConciliacao(api, comp, extrato, c.dia(hoje), versao);
  const aguardando = fiscalPainel.pedidosAguardandoNfe({ pedidos, notas: notas.map(semXml), desde: `${comp}-01`, hoje, externas });
  const nomes = await b.nomesDeUsuarios(api, [situacao?.fechada_por, situacao?.reaberta_por, ...resolucoes.map(r => r.usuario_id)]);
  const painel = montar({
    competencia: comp, hoje, notas, externas, aguardando, receber: receberLido.painel, receberErro: receberLido.erro,
    fechamentos: fech, reembolsosPendencias, situacao, resolucoes, nomes, sqlPendente, pagar, extrato, conciliacao,
    versao: versao ? { versao, lancamentos: conciliacao?.lancamentosAtuais ?? null } : null, pacotes, entradaDfe, integracoes, inicio
  });
  return { ...painel, situacao_bruta: situacao };
}

module.exports = {
  FONTES, NIVEL, NIVEL_DA_COBRANCA, ehTarifaDoBanco, competenciaValida, fonteNfe, fonteRecebimentos, fonteFechamentos, fonteDevolucoes, pendenciasDasIntegracoes,
  fonteDocumentosRecebidos, fonteContasPagar, fonteExtrato, fonteConciliacao, lerContasPagar, lerExtrato, lerConciliacao, montar, carregar
};
