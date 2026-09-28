/**
 * Checklist do fechamento contábil (etapas 1 a 4): o que a tela da
 * Contabilidade mostra de uma competência, calculado SÓ com o que o sistema
 * já controla — NF-e de saída (próprias e de fora), recebimentos e cobrança,
 * fechamentos de comissões e produção, devoluções e reembolsos, e (etapa 3)
 * os documentos recebidos e as contas a pagar, e (etapa 4) o extrato
 * bancário. A conciliação aparece como fonte "ainda não integrada", para a
 * tela já ter o desenho inteiro.
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

const STATUS_A_CAMINHO = new Set(['processando', 'enviando']);
const STATUS_RECUSADA = new Set(['rejeitada', 'denegada', 'erro_tecnico']);

/** As fontes do checklist, na ordem da tela. `etapa` marca as que ainda não existem. */
const FONTES = [
  { chave: 'nfe_saida', titulo: 'NF-e de saída', icone: 'fa-file-invoice' },
  { chave: 'recebimentos', titulo: 'Recebimentos e cobrança', icone: 'fa-money-bill-wave' },
  { chave: 'fechamentos', titulo: 'Comissões e produção', icone: 'fa-hand-holding-usd' },
  { chave: 'devolucoes', titulo: 'Devoluções e reembolsos', icone: 'fa-undo-alt' },
  { chave: 'documentos_recebidos', titulo: 'NF-e de entrada e NFS-e', icone: 'fa-file-import' },
  { chave: 'contas_pagar', titulo: 'Contas a pagar', icone: 'fa-file-invoice-dollar' },
  { chave: 'extrato', titulo: 'Extrato bancário', icone: 'fa-university' },
  { chave: 'conciliacao', titulo: 'Conciliação e classificação', icone: 'fa-check-double', etapa: 'Etapas 5 e 6 — extrato × documentos, plano de contas' }
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
 *   - pagamento de fechamento sem NFS-e .......... documental, um por pagamento
 *   - documento sem conta a pagar ................ aviso (junta todos)
 * `pagar` null = falta o SQL da etapa. Pura.
 */
function fonteDocumentosRecebidos({ pagar, competencia }) {
  if (!pagar) return { indisponivel: SEM_SQL_PAGAR, resumo: [], numeros: null, pendencias: [] };
  const vivos = c.lista(pagar.documentos).filter(d => d && !d.excluido_em);
  const contexto = {
    contatos: pagar.contatos || new Map(), titulosPorDocumento: contasPorDocumento(pagar.titulos),
    arquivosMapa: pagar.arquivosMapa || new Map(), pagamentosFechamento: pagar.pagamentosFechamento || new Map()
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
      nivel: 'documental', chave: `nfse_fech_${p.id}`, fonte: 'documentos_recebidos', titulo: `${p.rotulo} sem NFS-e`,
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
 *   - pagamento sem nota, recibo ou guia ........ documental, um por pagamento
 *   - pagamento sem comprovante ................. aviso (junta todos)
 *   - parcela vencida sem pagamento registrado .. aviso (junta todas)
 * `pagar` null = falta o SQL da etapa. Pura.
 */
function fonteContasPagar({ pagar, competencia, hoje }) {
  if (!pagar) return { indisponivel: SEM_SQL_PAGAR, resumo: [], numeros: null, pendencias: [] };
  const mapa = pagar.arquivosMapa || new Map();
  const docsVivos = new Set(c.lista(pagar.documentos).filter(d => d && !d.excluido_em).map(d => String(d.id)));
  const lista = c.lista(pagar.titulos);
  const pagamentos = lista.flatMap(t => t.parcelas.filter(p => p.pagamento && String(p.pagamento.data).startsWith(competencia)).map(p => ({ t, p })));
  const pend = [];
  const temDocumento = t => (t.documento_recebido_id !== null && t.documento_recebido_id !== undefined && docsVivos.has(String(t.documento_recebido_id)))
    || (mapa.get(`titulo:${t.id}`) || []).some(a => arquivos.CATEGORIAS_DE_DOCUMENTO.has(a.categoria));
  for (const { t, p } of pagamentos) {
    if (temDocumento(t)) continue;
    pend.push(pendencia({
      nivel: 'documental', chave: `pagar_sem_doc_${p.pagamento.id}`, fonte: 'contas_pagar',
      titulo: `Pagamento sem nota ou recibo — ${t.fornecedor || t.descricao}`,
      descricao: `${c.reais(p.pagamento.valor_pago)} em ${c.impressa(p.pagamento.data)} · ${t.descricao} · anexe a nota, o recibo ou a guia na conta`,
      data: p.pagamento.data, acao: 'Abrir', destino: 'contabilidade', filtro: { acao: 'conta-pagar', titulo_id: t.id }
    }));
  }
  const semComprovante = pagamentos.filter(({ p }) => !(mapa.get(`pagamento:${p.pagamento.id}`) || []).some(a => a.categoria === 'comprovante'));
  if (semComprovante.length) {
    pend.push(pendencia({
      nivel: 'aviso', chave: 'pagar_sem_comprovante', fonte: 'contas_pagar',
      titulo: c.plural(semComprovante.length, 'pagamento sem comprovante', 'pagamentos sem comprovante'),
      descricao: `Total: ${c.reais(semComprovante.reduce((s, x) => s + x.p.pagamento.valor_pago, 0))} · o extrato do banco prova, mas o comprovante ajuda a contabilidade`,
      data: semComprovante.map(x => x.p.pagamento.data).sort()[0], acao: 'Ver', destino: 'contabilidade', filtro: { acao: 'contas-pagar', visao: 'pagas' }
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
  const totais = titulos.totaisDaCompetencia(lista, { competencia, hoje });
  const pagoNoMes = { quantidade: pagamentos.length, total: c.centavos(pagamentos.reduce((s, x) => s + x.p.pagamento.valor_pago, 0)) };
  return {
    resumo: [
      { rotulo: 'Pago no mês', valor: `${pagoNoMes.quantidade} · ${c.reais(pagoNoMes.total)}` },
      { rotulo: 'Vence no mês (em aberto)', valor: c.reais(totais.vence_no_mes.total) },
      { rotulo: 'Vencidas em aberto', valor: `${vencidas.length} · ${c.reais(vencidas.reduce((s, p) => s + p.valor, 0))}` },
      { rotulo: 'Sem comprovante', valor: String(semComprovante.length) }
    ],
    numeros: { pago_no_mes: pagoNoMes, vence_no_mes: totais.vence_no_mes, vencidas: vencidas.length, sem_comprovante: semComprovante.length, sem_documento: pend.filter(x => x.nivel === 'documental').length },
    pendencias: pend
  };
}

// ------------------------------------------------------------- extrato bancário

const SEM_SQL_EXTRATO = `Falta rodar ${b.SQL_ARQUIVO_EXTRATO} no banco e reiniciar a API.`;

/**
 * O extrato das contas correntes ativas cobre o mês? Mês terminado sem o
 * extrato inteiro = documental, uma pendência por conta (o que falta, de que
 * dia a que dia). Sem conta cadastrada = documental. No mês em curso, só o
 * resumo. `extrato` null = falta o SQL da etapa 4. Pura.
 */
function fonteExtrato({ extrato, competencia, hoje, encerrada }) {
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
  const coberturas = correntes.map(conta => ({ conta, cob: extratoMod.cobertura(c.lista(extrato.importacoes).filter(i => String(i.conta_id) === String(conta.id)), competencia, { hoje }) }));
  if (encerrada) {
    for (const { conta, cob } of coberturas) {
      if (cob.completa) continue;
      const nada = !cob.de;
      pend.push(pendencia({
        nivel: 'documental', chave: `extrato_${conta.id}`, fonte: 'extrato',
        titulo: `Extrato de ${c.rotuloCompetencia(competencia)} — ${conta.nome}${nada ? ' não importado' : ' incompleto'}`,
        descricao: `Falta: ${cob.faltas.map(extratoMod.faixaImpressa).join(', ')} · importe o OFX do mês (Gerenciador Financeiro do BB)`,
        data: b.ultimoDia(competencia), acao: 'Importar', destino: 'contabilidade', filtro: { acao: 'importar-extrato', conta_id: conta.id }
      }));
    }
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
      { rotulo: 'Extrato', valor: !coberturas.length ? 'Sem conta' : (cobreTudo ? (faixa || 'Completo') : (faixa ? `${faixa} (falta)` : 'Não importado')) }
    ],
    numeros: { contas: correntes.length, movimentos: totais.quantidade, entradas: totais.entradas.total, saidas: totais.saidas.total, completo: Boolean(cobreTudo) },
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
  return encerrada || !['fechamentos', 'extrato'].includes(fonte.chave) ? 'ok' : 'em_curso';
}

/**
 * Monta o painel da competência a partir das listas já lidas. `situacao` é a
 * linha de competencia_contabil (ou null = aberta); `resolucoes` são as
 * pendências ignoradas desta competência; `receber` é o painel de contas a
 * receber (ou null, com `receberErro` dizendo por quê); `fechamentos` é a
 * lista de fechamentos fechados de todas as competências (null = sem o SQL).
 */
function montar({
  competencia, hoje, notas = [], externas = [], aguardando = null, receber = null, receberErro = null,
  fechamentos: lista = [], reembolsosPendencias = [], situacao = null, resolucoes = [], nomes = new Map(), sqlPendente = false,
  pagar = null, extrato = null
}) {
  const comp = competenciaValida(competencia, hoje);
  const diaDeHoje = c.dia(hoje);
  const encerrada = comp < c.competenciaDe(diaDeHoje);

  const partes = {
    nfe_saida: fonteNfe({ notas: notas.map(semXml), externas, aguardando, competencia: comp, hoje: diaDeHoje }),
    recebimentos: fonteRecebimentos({ receber, receberErro }),
    fechamentos: fonteFechamentos({ fechamentos: lista, competencia: comp, hoje: diaDeHoje, encerrada }),
    devolucoes: fonteDevolucoes({ reembolsosPendencias, hoje: diaDeHoje }),
    documentos_recebidos: fonteDocumentosRecebidos({ pagar, competencia: comp, hoje: diaDeHoje }),
    contas_pagar: fonteContasPagar({ pagar, competencia: comp, hoje: diaDeHoje }),
    extrato: fonteExtrato({ extrato, competencia: comp, hoje: diaDeHoje, encerrada })
  };

  // As ignoradas: continuam na lista, marcadas, sem contar para os bloqueios.
  const ignoradas = new Map(c.lista(resolucoes).map(r => [String(r.chave), r]));
  const pendencias = Object.values(partes).flatMap(p => p.pendencias).map(p => {
    const r = ignoradas.get(p.chave);
    if (!r || p.nivel === 'critico') return p;
    return { ...p, ignorada: true, justificativa: r.justificativa || '', ignorada_em: b.instanteBR(r.criado_em), ignorada_por: nomes.get(String(r.usuario_id)) || null, resolucao_id: r.id };
  }).sort((x, y) => Number(x.ignorada) - Number(y.ignorada) || b.NIVEIS[x.nivel].ordem - b.NIVEIS[y.nivel].ordem || String(x.data || '').localeCompare(String(y.data || '')));

  const fontes = FONTES.map(f => {
    const parte = partes[f.chave] || {};
    const minhas = pendencias.filter(p => p.fonte === f.chave);
    const estado = estadoDaFonte({ ...f, indisponivel: parte.indisponivel }, minhas, { encerrada });
    return {
      chave: f.chave, titulo: f.titulo, icone: f.icone, estado,
      nota: f.etapa || parte.indisponivel || null,
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
    situacao: {
      status,
      fechada_em: b.instanteBR(situacao?.fechada_em), fechada_por: nomes.get(String(situacao?.fechada_por)) || null,
      reaberta_em: b.instanteBR(situacao?.reaberta_em), reaberta_por: nomes.get(String(situacao?.reaberta_por)) || null,
      justificativa_reabertura: situacao?.justificativa_reabertura || null,
      // Fechada com erro crítico novo (algo mudou depois): a tela avisa.
      divergencias: status === 'fechada' ? contagem.critico : 0
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
    const [base, docs, arquivosLista, vinculos, pagamentosFechamento] = await Promise.all([
      titulos.lerBase(api), b.ler(api, 'documentos_recebidos'), b.ler(api, 'contabil_arquivos'), b.ler(api, 'contabil_arquivo_vinculos'),
      documentos.lerPagamentosDeFechamento(api)
    ]);
    return {
      titulos: titulos.montarTodos(base, hoje), documentos: docs, contatos: base.contatos,
      arquivosMapa: arquivos.porAlvo(arquivosLista, vinculos), pagamentosFechamento
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
    return { contas, importacoes, movimentos };
  } catch (e) {
    if (e?.extra?.sql_pendente) return null;
    throw e;
  }
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
  const [pagar, extrato] = await Promise.all([lerContasPagar(api, hoje), lerExtrato(api, comp)]);
  try {
    situacao = (await b.ler(api, 'competencia_contabil', { competencia: comp }))[0] || null;
    resolucoes = await b.ler(api, 'contabil_pendencias_resolucoes', { competencia: comp });
  } catch (e) {
    if (!e?.extra?.sql_pendente) throw e;
    sqlPendente = true;
  }
  const aguardando = fiscalPainel.pedidosAguardandoNfe({ pedidos, notas: notas.map(semXml), desde: `${comp}-01`, hoje, externas });
  const nomes = await b.nomesDeUsuarios(api, [situacao?.fechada_por, situacao?.reaberta_por, ...resolucoes.map(r => r.usuario_id)]);
  const painel = montar({
    competencia: comp, hoje, notas, externas, aguardando, receber: receberLido.painel, receberErro: receberLido.erro,
    fechamentos: fech, reembolsosPendencias, situacao, resolucoes, nomes, sqlPendente, pagar, extrato
  });
  return { ...painel, situacao_bruta: situacao };
}

module.exports = {
  FONTES, NIVEL_DA_COBRANCA, competenciaValida, fonteNfe, fonteRecebimentos, fonteFechamentos, fonteDevolucoes,
  fonteDocumentosRecebidos, fonteContasPagar, fonteExtrato, lerContasPagar, lerExtrato, montar, carregar
};
