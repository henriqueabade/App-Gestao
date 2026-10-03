/**
 * O pacote da competência para a contabilidade (etapa 9): um ZIP que o
 * usuário salva e envia (decisão do dono: "zipar tudo e o usuário salvar e
 * enviar ele mesmo").
 *
 *   Contabilidade-2026-08-v1/
 *     LEIA-ME.txt                 o que tem, a versão, o resultado, o que falta
 *     indice.csv                  cada arquivo com a pasta, a origem e o SHA-256
 *     01-Relatorio/               o relatório mensal (PDF e planilha — internos)
 *     02-Extrato/                 o OFX original e o extrato do mês em PDF (gerado)
 *     03-NF-e-de-saida/           os XML das NF-e emitidas (e as de fora) e o DANFE
 *     04-Devolucoes/              os XML das notas de devolução dos clientes e o DANFE
 *     05-Recebidos/               NF-e de entrada (com o DANFE), NFS-e, recibos, guias
 *     06-Pagamentos/              uma pasta por pagamento do mês (fase I) e os
 *                                 comprovantes que não são de pagamento registrado
 *     07-Boletos-emitidos/        os boletos de cobrança emitidos no mês (gerados)
 *     08-Outros/                  contratos e o resto anexado ao mês
 *
 * Os arquivos são os ORIGINAIS guardados no app (Documentos da competência,
 * evidencias.js); o relatório é documento interno. Só sai com a competência
 * fechada e sem pendência documental viva (as três severidades do dono: a
 * documental bloqueia o pacote). Cada pacote gerado fica registrado
 * (contabil_pacotes: o SHA-256 do ZIP e de cada arquivo) e o usuário marca
 * quando enviou, para quem e como. O ZIP não fica no banco.
 *
 * Fase I (02/10/2026, "tudo gerado na hora"): o dossiê de cada pagamento, o
 * Espelho DDA, o DANFE (do XML guardado), o extrato do mês em PDF e os
 * boletos emitidos são feitos na hora do ZIP pela impressora do backend
 * (../../impressora.js, o Electron) e nunca ficam guardados. Fora do app
 * (sem impressora) eles vão em HTML, avisando. A pasta de cada pagamento é
 * pagamentos.js; o dossiê, dossiePagamento.js.
 *
 * O PDF do relatório vem da tela (o Electron imprime o HTML de
 * relatorio/documento.js); se não vier e houver impressora, é feito aqui;
 * sem os dois, o pacote sai só com a planilha, avisando.
 */
const crypto = require('crypto');
const c = require('../../financeiro/comum');
const b = require('../base');
const checklist = require('../checklist');
const eventos = require('../eventos');
const arquivos = require('../arquivos');
const evidencias = require('../evidencias');
const versoes = require('../versoes');
const relatorio = require('../relatorio/relatorio');
const planilha = require('../relatorio/planilha');
const documentoRel = require('../relatorio/documento');
const impressora = require('../../impressora');
const pagamentosMod = require('./pagamentos');
const dossiePagamento = require('./dossiePagamento');
const zip = require('./zip');

const PASTAS = {
  relatorio: { pasta: '01-Relatorio', rotulo: 'Relatório mensal (PDF e planilha)' },
  extrato: { pasta: '02-Extrato', rotulo: 'Extrato bancário (o OFX original e o extrato do mês em PDF, gerado)' },
  saida: { pasta: '03-NF-e-de-saida', rotulo: 'NF-e de saída (o XML e o DANFE, gerado do XML)' },
  devolucao: { pasta: '04-Devolucoes', rotulo: 'NF-e de devolução dos clientes (o XML e o DANFE)' },
  // Nome curto: o XML leva a chave de 44 dígitos no nome e o Windows limita o caminho a 260 caracteres.
  recebidos: { pasta: '05-Recebidos', rotulo: 'Documentos recebidos (NF-e de entrada com o DANFE, NFS-e, recibos, guias)' },
  // Fase I: uma pasta por pagamento (dossiê, comprovante, boleto); os comprovantes avulsos numa pasta à parte.
  pagamentos: { pasta: '06-Pagamentos', rotulo: 'Uma pasta por pagamento do mês (dossiê, comprovante e boleto)' },
  boletos: { pasta: '07-Boletos-emitidos', rotulo: 'Boletos de cobrança emitidos no mês (gerados)' },
  outros: { pasta: '08-Outros', rotulo: 'Outros (contratos e o resto anexado ao mês)' }
};
/** O que é cada documento gerado na hora (a coluna "O que é" do índice). */
const GERADOS = {
  dossie: 'Dossiê do pagamento (gerado)', espelho: 'Espelho DDA (gerado)', danfe: 'DANFE (gerado do XML)',
  extrato: 'Extrato do mês (gerado dos lançamentos)', boleto: 'Boleto emitido (gerado)', relatorio: 'Relatório mensal (PDF)'
};
const MEIOS = ['E-mail', 'WhatsApp', 'Portal da contabilidade', 'Entregue em mãos (pendrive)', 'Outro'];
const LIMITE_BYTES = 200 * 1024 * 1024;
const ORIGENS = arquivos.ORIGENS;

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const tamanhoImpresso = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// ------------------------------------------------------------------ puras

/** Em que pasta vai um item dos Documentos da competência. Pura. */
function pastaDoItem(item) {
  if (item.grupo === 'outros' && (item.categoria === arquivos.CATEGORIAS.extrato || /\.ofx$/i.test(String(item.titulo || '')))) return 'extrato';
  return PASTAS[item.grupo] ? item.grupo : 'outros';
}

/**
 * O que vai no pacote a partir dos Documentos da competência: os arquivos a
 * ler (com a pasta) e o que falta (documento sem XML, nota de fora sem o
 * arquivo). Pura.
 */
function planoDoPacote(itens) {
  const aLer = [];
  const faltando = [];
  for (const item of c.lista(itens)) {
    if (item.falta || !item.baixar) {
      faltando.push({ titulo: item.titulo, detalhe: item.detalhe || null, motivo: item.falta_rotulo || 'Sem o arquivo' });
      continue;
    }
    aLer.push({ chave: pastaDoItem(item), item });
  }
  return { aLer, faltando };
}

/** Nome que abre em qualquer sistema: sem barra nem os proibidos do Windows. Pura. */
function nomeSeguro(nome) {
  const limpo = String(nome ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (limpo || 'arquivo').slice(0, 150);
}

/** O mesmo nome na mesma pasta ganha " (2)", " (3)"… antes da extensão. Pura (muda `usados`). */
function nomeUnico(nome, usados) {
  const seguro = nomeSeguro(nome);
  if (!usados.has(seguro.toLowerCase())) {
    usados.add(seguro.toLowerCase());
    return seguro;
  }
  const ponto = seguro.lastIndexOf('.');
  const base = ponto > 0 ? seguro.slice(0, ponto) : seguro;
  const ext = ponto > 0 ? seguro.slice(ponto) : '';
  for (let n = 2; ; n++) {
    const candidato = `${base} (${n})${ext}`;
    if (!usados.has(candidato.toLowerCase())) {
      usados.add(candidato.toLowerCase());
      return candidato;
    }
  }
}

const celulaCsv = v => {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** O índice (CSV com ponto e vírgula, que o Excel abre): cada arquivo com o SHA-256. Pura. */
function indiceCsv(linhas) {
  const cab = ['Pasta', 'Arquivo', 'O que é', 'Origem', 'Documento', 'Data', 'Valor', 'Tamanho (bytes)', 'SHA-256'];
  const corpo = c.lista(linhas).map(l => [
    l.pasta, l.nome, l.tipo || '', l.origem_rotulo || '', l.documento || '', l.data ? c.impressa(l.data) : '',
    l.valor === null || l.valor === undefined ? '' : String(c.centavos(l.valor)).replace('.', ','), l.tamanho, l.sha256
  ]);
  return `﻿${[cab, ...corpo].map(l => l.map(celulaCsv).join(';')).join('\r\n')}\r\n`;
}

/** O LEIA-ME do pacote (texto simples, quebra de linha do Windows). Pura. */
function leiaMe({
  empresa, rotulo, versao = null, fechadaEm = null, fechadaPor = null, geradoEm, geradoPor = null, pastas = [], faltando = [], ignoradas = [], resultado = null, semPdf = false,
  pagamentos = 0, semImpressora = false, naoGerados = []
}) {
  const linhas = [
    `Pacote da contabilidade — ${[empresa?.razao_social || empresa?.nome, empresa?.cnpj ? `CNPJ ${empresa.cnpj}` : null].filter(Boolean).join(' · ')}`,
    `Competência: ${rotulo}`,
    versao
      ? `Fechamento: versão ${versao}, fechada em ${relatorio.instanteImpresso(fechadaEm)}${fechadaPor ? ` por ${fechadaPor}` : ''}`
      : 'Fechamento: competência fechada antes das versões do fechamento',
    `Gerado em ${relatorio.instanteImpresso(geradoEm)}${geradoPor ? ` por ${geradoPor}` : ''}`,
    ''
  ];
  if (resultado) linhas.push(`Resultado do mês: ${c.reais(resultado.resultado)} (receitas ${c.reais(resultado.receitas)}, custos ${c.reais(resultado.custos)}, despesas ${c.reais(resultado.despesas)})`, '');
  linhas.push('O que tem aqui:');
  for (const p of pastas.filter(x => x.quantidade)) linhas.push(`  ${p.pasta}/  ${p.rotulo} — ${c.plural(p.quantidade, 'arquivo', 'arquivos')}`);
  if (semPdf) linhas.push('  (o relatório em PDF não veio: só a planilha)');
  linhas.push('');
  if (pagamentos) {
    linhas.push(
      `Pagamentos do mês: ${c.plural(pagamentos, 'pasta', 'pastas')} em 06-Pagamentos, uma por pagamento (data, quem recebeu e valor no nome).`,
      'Em cada uma: o dossiê do pagamento (a conta, a parcela, a nota e onde ela está, o boleto, o lançamento do extrato e o comprovante),',
      'o comprovante do banco, o Espelho DDA e o boleto do fornecedor quando houver. A nota vai no mês fiscal dela (05-Recebidos);',
      'o dossiê diz em que pacote ela foi quando é de outro mês.',
      ''
    );
  }
  if (semImpressora) linhas.push('Os documentos gerados (dossiês, DANFE, espelhos, extrato e boletos) vieram em HTML: o pacote foi gerado fora do aplicativo. Abra no navegador.', '');
  if (naoGerados.length) {
    linhas.push(`Não deu para gerar (${naoGerados.length}):`);
    for (const g of naoGerados) linhas.push(`  - ${g.titulo}: ${g.motivo}`);
    linhas.push('');
  }
  if (faltando.length) {
    linhas.push(`Faltando (${faltando.length}):`);
    for (const f of faltando) linhas.push(`  - ${f.titulo}${f.detalhe ? ` — ${f.detalhe}` : ''}: ${f.motivo}`);
    linhas.push('');
  }
  if (ignoradas.length) {
    linhas.push('Pendências ignoradas com justificativa:');
    for (const p of ignoradas) linhas.push(`  - ${p.titulo}${p.justificativa ? `: ${p.justificativa}` : ''}`);
    linhas.push('');
  }
  linhas.push(
    'Conferência: o indice.csv traz a pasta, a origem e o SHA-256 de cada arquivo.',
    'XML e OFX são os originais guardados no app; o relatório é documento interno gerado pelo App-Gestão.',
    'Com a origem "Interno" (gerados na hora pelo App-Gestão, não guardados): o dossiê de cada pagamento, o Espelho DDA (não é 2ª via do boleto),',
    'o DANFE (feito do XML autorizado, que vai ao lado), o extrato do mês em PDF (o OFX original vai ao lado) e os boletos emitidos.',
    'Comprovantes do BB com a origem "Reproduzido": refeitos pelo App-Gestão a partir do texto do original (conferido idêntico ao anexar);',
    'o pé de cada um traz o nome e o SHA-256 do arquivo do banco, e o código de autenticação continua conferível no BB.'
  );
  return `${linhas.join('\r\n')}\r\n`;
}

/** O nome do pacote (e da pasta dentro do ZIP). Pura. */
const nomeDoPacote = (competencia, versao) => `Contabilidade-${competencia}${versao ? `-v${versao}` : ''}`;

/** O pacote que a tela vê (sem a lista inteira dos arquivos). Pura. */
function pacotePublico(p, nomes = new Map()) {
  const lista = c.jsonDe(p.arquivos, []) || [];
  return {
    id: p.id, competencia: p.competencia, versao: p.versao === null || p.versao === undefined ? null : Number(p.versao),
    nome: p.nome_arquivo, hash: String(p.hash || '').trim(), tamanho: Number(p.tamanho_bytes) || 0, tamanho_rotulo: tamanhoImpresso(Number(p.tamanho_bytes) || 0),
    arquivos: lista.length, faltando: (c.jsonDe(p.faltando, []) || []).length,
    gerado_em: b.instanteBR(p.gerado_em), gerado_por: nomes.get(String(p.gerado_por)) || null,
    enviado_em: b.instanteBR(p.enviado_em), enviado_por: nomes.get(String(p.enviado_por)) || null,
    enviado_para: p.enviado_para || null, envio_meio: p.envio_meio || null, envio_observacao: p.envio_observacao || null
  };
}

/** Confere o "marcar como enviado". Pura. */
function validarEnvio(entrada = {}) {
  const para = c.texto(entrada.para, 200);
  if (para.length < 3) throw c.erro('Diga para quem foi (o e-mail ou o nome da contabilidade).');
  const meio = MEIOS.includes(entrada.meio) ? entrada.meio : null;
  if (!meio) throw c.erro('Diga como foi enviado.');
  return { para, meio, observacao: c.texto(entrada.observacao, 500) || null };
}

// ------------------------------------------------------------------ leitura

/**
 * As pendências ignoradas que o pacote registra: as de hoje — é a
 * justificativa delas (dada antes ou depois de fechar) que liberou o pacote.
 */
function ignoradasDe(painel) {
  return c.lista(painel.pendencias).filter(p => p.ignorada).map(p => ({ titulo: p.titulo, justificativa: p.justificativa || null }));
}

/** O item dos Documentos que ganha o DANFE ao lado (o XML de uma NF-e). Pura. */
function temDanfe(item) {
  if (!item?.baixar) return false;
  if (['saida', 'externa', 'devolucao'].includes(item.baixar.tipo)) return true;
  return item.grupo === 'recebidos' && item.baixar.tipo === 'arquivo' && item.categoria === arquivos.CATEGORIAS.xml_nfe;
}

/** O comprovante ou o anexo que vai na pasta de um pagamento sai das pastas gerais. Pura. */
function vaiNaPastaDoPagamento(item, usados) {
  if (!item || !usados) return false;
  // O comprovante do BB pela chave: refeito, com o original guardado ou já sem ele (a falta vai pela pasta).
  const cp = /^comprovante:(\d+)$/.exec(String(item.chave || ''));
  if (cp) return usados.comprovantes.has(cp[1]);
  if (!item.baixar) return false;
  return item.baixar.tipo === 'arquivo' && item.grupo !== 'recebidos' && usados.arquivos.has(String(item.baixar.id));
}

const SEM_PAGAMENTOS = { pagamentos: [], usados: { comprovantes: new Set(), arquivos: new Set() } };

/** As pastas dos pagamentos; um erro aqui não derruba o pacote (vai sem elas, avisando). */
async function lerPagamentos(api, { competencia, hoje }) {
  try {
    return await pagamentosMod.carregar(api, { competencia, hoje });
  } catch (e) {
    console.warn('[contabilidade/pacote] pastas dos pagamentos:', e?.message || e);
    return { ...SEM_PAGAMENTOS, erro: e?.message || 'erro' };
  }
}

/** Os boletos de cobrança emitidos no mês (produção, com a ficha imprimível). */
async function lerBoletosEmitidos(api, competencia) {
  const { STATUS_IMPRIMIVEIS } = require('../../cobranca/boletoDocumento');
  const lidos = await api.get('/api/boletos').then(c.lista).catch(() => []);
  return lidos.filter(x => x && x.ambiente === 'producao' && STATUS_IMPRIMIVEIS.has(String(x.status)) && String(c.dia(x.data_emissao) || '').startsWith(competencia))
    .sort((x, y) => String(c.dia(x.data_emissao)).localeCompare(String(c.dia(y.data_emissao))) || Number(x.id) - Number(y.id));
}

/** O que a tela mostra antes de gerar: se pode, o que vai em cada pasta, o que falta e os pacotes já gerados. */
async function previa(api, { competencia, hoje, desde = null }) {
  if (!c.competenciaValida(competencia)) throw c.erro('Informe a competência (AAAA-MM).');
  const comp = String(competencia);
  const painel = await checklist.carregar({ api, competencia: comp, hoje, desde });
  if (painel.sql_pendente) throw c.erro(b.SQL_FALTANDO, 409, { sql_pendente: true });
  const [evid, lidos, porPag, boletos, movimentos, contasLidas] = await Promise.all([
    evidencias.carregar(api, { competencia: comp, hoje }).catch(() => null),
    b.lerOpcional(api, 'contabil_pacotes', { competencia: comp }),
    lerPagamentos(api, { competencia: comp, hoje }),
    lerBoletosEmitidos(api, comp),
    b.lerOpcional(api, 'movimentos_bancarios', { competencia: comp }).catch(() => null),
    b.lerOpcional(api, 'contas_financeiras').catch(() => null)
  ]);
  const { aLer, faltando } = planoDoPacote((evid?.itens || []).filter(i => !vaiNaPastaDoPagamento(i, porPag.usados)));
  const gerado = (titulo, detalhe) => ({ titulo, detalhe, origem_rotulo: ORIGENS.interno, gerado: true });
  const nomesContas = new Map(c.lista(contasLidas).map(x => [String(x.id), x.nome]));
  const contasDoMes = [...new Set(c.lista(movimentos).map(m => String(m.conta_id)))];
  const itensDe = chave => {
    if (chave === 'relatorio') {
      return [{ titulo: 'Relatório mensal (PDF)', detalhe: 'Gerado na hora, com a foto do fechamento', origem_rotulo: ORIGENS.interno }, { titulo: 'Relatório mensal (planilha)', detalhe: 'As 8 abas do relatório', origem_rotulo: ORIGENS.interno }];
    }
    if (chave === 'pagamentos') {
      return [
        ...porPag.pagamentos.map(p => gerado(p.pasta, pagamentosMod.pastaPublica(p).itens.join(' · '))),
        ...aLer.filter(x => x.chave === 'pagamentos').map(x => ({ titulo: `${pagamentosMod.PASTA_AVULSOS}/${x.item.titulo}`, detalhe: x.item.detalhe || null, origem_rotulo: x.item.origem_rotulo || null }))
      ];
    }
    if (chave === 'boletos') return boletos.map(x => gerado(`Boleto ${x.numero_documento || x.id}`, `Emitido em ${c.impressa(x.data_emissao)} · vence em ${c.impressa(x.data_vencimento)} · ${c.reais(x.valor)}`));
    const daPasta = aLer.filter(x => x.chave === chave);
    const lista = daPasta.flatMap(x => [
      { titulo: x.item.titulo, detalhe: x.item.detalhe || null, origem_rotulo: x.item.origem_rotulo || null, data: x.item.data || null },
      ...(temDanfe(x.item) ? [gerado(`DANFE — ${x.item.titulo}`, 'Gerado do XML na hora')] : [])
    ]);
    if (chave === 'extrato') lista.push(...contasDoMes.map(id => gerado(`Extrato do mês — ${nomesContas.get(id) || `conta ${id}`}`, 'Gerado dos lançamentos importados')));
    return lista;
  };
  const pastas = Object.entries(PASTAS).map(([chave, p]) => ({ chave, pasta: p.pasta, rotulo: p.rotulo, itens: itensDe(chave) }))
    .map(p => ({ ...p, quantidade: p.itens.length }));
  const pacotes = (lidos || []).sort((x, y) => String(y.gerado_em).localeCompare(String(x.gerado_em)) || Number(y.id) - Number(x.id));
  const nomes = await b.nomesDeUsuarios(api, pacotes.flatMap(p => [p.gerado_por, p.enviado_por]));
  const ultimoEnviado = pacotes.find(p => p.enviado_em) || null;
  return {
    competencia: comp, rotulo: c.rotuloCompetencia(comp), status: painel.situacao.status, versao: painel.situacao.versao,
    fechada_em: painel.situacao.fechada_em, pode: Boolean(painel.pode.pacote), bloqueios: painel.bloqueios.pacote,
    nome: nomeDoPacote(comp, painel.situacao.versao), pastas, faltando,
    documentos_sql_pendente: !evid || Boolean(evid.sql_pendente),
    pacotes: pacotes.map(p => pacotePublico(p, nomes)), sql_pacotes: lidos !== null,
    meios: MEIOS, ultimo_destinatario: ultimoEnviado?.enviado_para || null, ultimo_meio: ultimoEnviado?.envio_meio || null,
    // Fase I: a pasta de cada pagamento (o que vai nela, onde está a nota, o que falta).
    pagamentos: porPag.pagamentos.map(pagamentosMod.pastaPublica), pagamentos_erro: porPag.erro || null,
    impressora: impressora.disponivel()
  };
}

/** Lê um item dos Documentos da competência: `{ nome, dados }` (o arquivo guardado ou o XML da nota). */
async function lerItem(api, item) {
  // Fase D: o comprovante do BB refeito dos dados, com o pé "Reproduzido pelo App-Gestão…".
  if (item.baixar.tipo === 'comprovante') {
    const r = await require('../comprovantes/comprovantes').pdfDoComprovante(api, item.baixar.id, { comRodape: true });
    return { nome: r.nome, dados: Buffer.from(r.base64, 'base64'), sha: null };
  }
  if (item.baixar.tipo === 'arquivo') {
    const { arquivo, base64 } = await arquivos.ler(api, item.baixar.id);
    return { nome: arquivo.nome_arquivo, dados: Buffer.from(base64, 'base64'), sha: arquivo.sha256 || null };
  }
  const r = await evidencias.baixarXml(api, item.baixar);
  return { nome: r.nome, dados: Buffer.from(r.base64, 'base64'), sha: null };
}

/** O nome de um anexo dentro da pasta de um pagamento: até `max` caracteres, com a extensão. Pura. */
function encurtar(nome, max = 80) {
  // A extensão sai antes de limpar (o nomeSeguro corta em 150 e levaria a extensão junto).
  const original = String(nome ?? '').split(/[\\/]/).pop();
  const ext = (/\.[A-Za-z0-9]{1,5}$/.exec(original) || [''])[0];
  const base = nomeSeguro(original.slice(0, original.length - ext.length));
  return `${base.slice(0, max - ext.length).trim()}${ext}`;
}

/**
 * Gera o pacote: confere se pode (fechada, sem documental viva), monta o
 * relatório (a planilha aqui; o PDF vem da tela ou da impressora), lê cada
 * original, gera na hora o DANFE, o extrato em PDF, os boletos emitidos e a
 * pasta de cada pagamento (fase I), zipa, registra e devolve o ZIP em base64
 * para a tela salvar.
 */
async function gerar(api, { competencia, hoje, desde = null, usuarioId = null, pdfBase64 = null }) {
  if (!c.competenciaValida(competencia)) throw c.erro('Informe a competência (AAAA-MM).');
  const comp = String(competencia);
  const painel = await checklist.carregar({ api, competencia: comp, hoje, desde });
  if (painel.sql_pendente) throw c.erro(b.SQL_FALTANDO, 409, { sql_pendente: true });
  if (!painel.pode.pacote) throw c.erro('Ainda não dá para gerar o pacote desta competência.', 409, { bloqueios: painel.bloqueios.pacote });
  let pdf = null;
  if (pdfBase64) {
    pdf = Buffer.from(String(pdfBase64), 'base64');
    if (pdf.slice(0, 5).toString('latin1') !== '%PDF-') throw c.erro('O PDF do relatório chegou estragado: gere o pacote de novo.');
  }

  const versao = painel.situacao.status === 'fechada' ? versoes.ultima((await versoes.lerVersoes(api, comp)) || []) : null;
  const numeroVersao = versao ? Number(versao.versao) : null;
  const raiz = nomeDoPacote(comp, numeroVersao);
  const rel = await relatorio.montar(api, { competencia: comp, hoje, desde });
  const xlsx = await planilha.gerar(rel);
  const [evid, porPag] = await Promise.all([evidencias.carregar(api, { competencia: comp, hoje }), lerPagamentos(api, { competencia: comp, hoje })]);
  // Fase I: o comprovante e o anexo de um pagamento vão na pasta dele, não nas gerais.
  const { aLer, faltando } = planoDoPacote(evid.itens.filter(i => !vaiNaPastaDoPagamento(i, porPag.usados)));
  const agora = c.agora();
  const empresa = rel.empresa ? { razao_social: rel.empresa.razao_social || rel.empresa.nome || null, nome: rel.empresa.nome || null, cnpj: rel.empresa.cnpj || null } : null;

  // Cada arquivo é "preparado" (nome único na pasta, SHA-256, o limite do pacote) e depois "juntado":
  // a pasta de um pagamento junta tudo de uma vez, com o dossiê primeiro.
  const nomesUsados = new Map();
  const conteudo = [];
  const noIndice = [];
  let total = 0;
  const preparar = (chave, nome, dados, meta = {}, sub = null) => {
    const pasta = sub ? `${PASTAS[chave].pasta}/${sub}` : PASTAS[chave].pasta;
    if (!nomesUsados.has(pasta)) nomesUsados.set(pasta, new Set());
    const final = nomeUnico(sub ? encurtar(nome) : nome, nomesUsados.get(pasta));
    total += dados.length;
    if (total > LIMITE_BYTES) throw c.erro(`O pacote passa de ${tamanhoImpresso(LIMITE_BYTES)}: fale com o suporte.`, 413);
    return { arquivo: { nome: `${raiz}/${pasta}/${final}`, dados, topo: PASTAS[chave].pasta }, indice: { pasta, nome: final, tamanho: dados.length, sha256: sha256(dados), ...meta } };
  };
  const juntar = entradas => entradas.map(e => { conteudo.push(e.arquivo); noIndice.push(e.indice); return e.indice; });
  const adicionar = (...args) => juntar([preparar(...args)])[0];

  const naoGerados = [];
  let semImpressora = false;
  const nomeRel = `Relatorio-${comp}${numeroVersao ? `-v${numeroVersao}` : ''}`;
  await impressora.sessao(async imprimir => {
    semImpressora = !imprimir;
    // Gerado na hora: PDF pela impressora do Electron; sem ela, o HTML.
    const gerarDoc = async (html, base, { retrato = true } = {}) => (imprimir
      ? { nome: `${base}.pdf`, dados: await imprimir(html, { retrato }) }
      : { nome: `${base}.html`, dados: Buffer.from(html, 'utf8') });
    const tentar = async (titulo, fn) => {
      try {
        return await fn();
      } catch (e) {
        if (e?.status === 413) throw e;
        naoGerados.push({ titulo, motivo: e?.message || 'erro' });
        return null;
      }
    };

    // 01 — o relatório (o PDF da tela; sem ele, a impressora faz).
    if (!pdf && imprimir) await tentar('Relatório mensal (PDF)', async () => { pdf = await imprimir(documentoRel.html(rel), { retrato: false }); });
    if (pdf) adicionar('relatorio', `${nomeRel}.pdf`, pdf, { tipo: GERADOS.relatorio, origem_rotulo: ORIGENS.interno });
    adicionar('relatorio', `${nomeRel}.xlsx`, xlsx, { tipo: 'Relatório mensal (planilha)', origem_rotulo: ORIGENS.interno });

    // 02 a 05, os comprovantes avulsos e 08 — os originais; o DANFE ao lado de cada XML de NF-e.
    const caminhos = new Map();
    const danfe = require('../../fiscal/danfe');
    for (const { chave, item } of aLer) {
      let lido;
      try {
        lido = await lerItem(api, item);
      } catch (e) {
        faltando.push({ titulo: item.titulo, detalhe: item.detalhe || null, motivo: `não foi possível ler (${e?.message || 'erro'})` });
        continue;
      }
      const meta = { tipo: item.categoria || null, origem_rotulo: item.origem_rotulo || null, documento: [item.titulo, item.detalhe].filter(Boolean).join(' — '), data: item.data || null, valor: item.valor ?? null };
      const linha = adicionar(chave, lido.nome, lido.dados, meta, chave === 'pagamentos' ? pagamentosMod.PASTA_AVULSOS : null);
      if (item.baixar.tipo === 'arquivo') caminhos.set(String(item.baixar.id), `${linha.pasta}/${linha.nome}`);
      if (temDanfe(item)) {
        await tentar(`DANFE — ${item.titulo}`, async () => {
          const html = danfe.montarDanfeHtml(lido.dados.toString('utf8'), { cancelada: /\(cancelada\)/.test(String(item.titulo)), logo: item.baixar.tipo === 'saida' ? undefined : '' });
          const g = await gerarDoc(html, `${String(linha.nome).replace(/(-procNFe)?\.xml$/i, '')}-DANFE`, { retrato: true });
          adicionar(chave, g.nome, g.dados, { ...meta, tipo: GERADOS.danfe, origem_rotulo: ORIGENS.interno });
        });
      }
    }

    // 02 — o extrato do mês de cada conta em PDF (o livro-caixa do relatório).
    for (const livro of c.lista(rel.livro)) {
      await tentar(`Extrato do mês — ${livro.conta}`, async () => {
        const g = await gerarDoc(documentoRel.htmlDoLivro(rel, livro), `Extrato ${livro.conta} ${comp}`, { retrato: false });
        adicionar('extrato', g.nome, g.dados, { tipo: GERADOS.extrato, origem_rotulo: ORIGENS.interno, documento: livro.conta });
      });
    }

    // 07 — os boletos de cobrança emitidos no mês (a mesma ficha do Financeiro).
    const boletos = await lerBoletosEmitidos(api, comp);
    if (boletos.length) {
      const boletoDocumento = require('../../cobranca/boletoDocumento');
      const cfg = await require('../../cobranca/configuracaoCobranca').carregar(api).catch(() => null);
      for (const bol of boletos) {
        await tentar(`Boleto ${bol.numero_documento || bol.id}`, async () => {
          const { html, dados } = await boletoDocumento.gerarBoletosHtml(bol, cfg);
          const g = await gerarDoc(html, dados[0].nomeArquivo, { retrato: true });
          adicionar('boletos', g.nome, g.dados, { tipo: GERADOS.boleto, origem_rotulo: ORIGENS.interno, documento: `Boleto ${bol.numero_documento || bol.id}`, data: c.dia(bol.data_emissao), valor: c.centavos(bol.valor) });
        });
      }
    }

    // 06 — a pasta de cada pagamento: o dossiê, o comprovante, o espelho do DDA e os anexos.
    const comprovantesMod = require('../comprovantes/comprovantes');
    const espelhoMod = require('../dda/espelho');
    for (const pag of porPag.pagamentos) {
      const sub = pag.pasta;
      const entradas = [];
      const nomesDosComprovantes = new Map();
      const meta = (tipo, origemRotulo) => ({ tipo, origem_rotulo: origemRotulo || null, documento: pag.rotulo, data: pag.data, valor: pag.valor });
      for (const cp of pag.comprovantes) {
        try {
          const r = await comprovantesMod.pdfDoComprovante(api, cp.id, { comRodape: true });
          const e = preparar('pagamentos', r.nome, Buffer.from(r.base64, 'base64'), meta('Comprovante do banco', r.origem === 'reproduzido' ? evidencias.ORIGENS_EXTRA.reproduzido : ORIGENS.oficial), sub);
          entradas.push(e);
          nomesDosComprovantes.set(String(cp.id), e.indice.nome);
        } catch (e) {
          if (e?.status === 413) throw e;
          faltando.push({ titulo: `Comprovante — ${pag.rotulo}`, detalhe: cp.nome_arquivo || null, motivo: e?.message || 'não foi possível ler' });
        }
      }
      for (const a of pag.arquivos) {
        try {
          const { base64 } = await arquivos.ler(api, a.id);
          entradas.push(preparar('pagamentos', a.nome, Buffer.from(base64, 'base64'), meta(a.categoria_rotulo, a.origem_rotulo), sub));
        } catch (e) {
          if (e?.status === 413) throw e;
          faltando.push({ titulo: `${a.categoria_rotulo} — ${pag.rotulo}`, detalhe: a.nome, motivo: `não foi possível ler (${e?.message || 'erro'})` });
        }
      }
      let espelho = null;
      if (pag.dda) {
        await tentar(`Espelho DDA — ${pag.rotulo}`, async () => {
          const g = await gerarDoc(espelhoMod.montarHtml(pag.dda, { empresa, geradoEm: agora }), espelhoMod.nomeDoArquivo(pag.dda).replace(/\.pdf$/i, ''), { retrato: true });
          const e = preparar('pagamentos', g.nome, g.dados, meta(GERADOS.espelho, ORIGENS.interno), sub);
          entradas.push(e);
          espelho = e.indice.nome;
        });
      }
      // A nota deste mês: o caminho dela neste pacote (05-Recebidos).
      for (const d of pag.documentos) {
        if (d.onde.situacao !== 'neste') continue;
        const onde = c.lista(d.arquivos).map(a => caminhos.get(String(a.id))).filter(Boolean);
        if (onde.length) d.onde = { situacao: 'neste', texto: `Neste pacote: ${onde.join(' · ')}` };
      }
      await tentar(`Dossiê — ${pag.pasta}`, async () => {
        const html = dossiePagamento.montarHtml(pag, {
          empresa, competencia: comp, geradoEm: agora, espelho, nomesDosComprovantes,
          arquivosDaPasta: entradas.map(e => ({ nome: e.indice.nome, tipo: e.indice.tipo, origem_rotulo: e.indice.origem_rotulo, sha256: e.indice.sha256 }))
        });
        const g = await gerarDoc(html, dossiePagamento.NOME_DO_ARQUIVO, { retrato: true });
        entradas.unshift(preparar('pagamentos', g.nome, g.dados, meta(GERADOS.dossie, ORIGENS.interno), sub));
      });
      juntar(entradas);
    }
  });

  // Na ordem das pastas (01, 02…), mantendo a ordem de cada uma (a pasta de cada pagamento fica junta).
  const ordem = Object.values(PASTAS).map(x => x.pasta);
  conteudo.sort((x, y) => ordem.indexOf(x.topo) - ordem.indexOf(y.topo));
  noIndice.sort((x, y) => ordem.indexOf(x.pasta.split('/')[0]) - ordem.indexOf(y.pasta.split('/')[0]));

  const geradoEm = b.instanteBR(agora);
  const nomes = await b.nomesDeUsuarios(api, [usuarioId, versao?.fechada_por]);
  const pastas = Object.entries(PASTAS).map(([chave, p]) => ({ chave, pasta: p.pasta, rotulo: p.rotulo, quantidade: noIndice.filter(x => x.pasta.split('/')[0] === p.pasta).length }));
  const leia = leiaMe({
    empresa: rel.empresa, rotulo: rel.rotulo, versao: numeroVersao, fechadaEm: versao ? b.instanteBR(versao.fechada_em) : painel.situacao.fechada_em,
    fechadaPor: versao ? nomes.get(String(versao.fechada_por)) || null : painel.situacao.fechada_por, geradoEm, geradoPor: nomes.get(String(usuarioId)) || null,
    pastas, faltando, ignoradas: ignoradasDe(painel), resultado: rel.resultado, semPdf: !pdf,
    pagamentos: porPag.pagamentos.length, semImpressora, naoGerados
  });
  const bytes = zip.zipar([
    { nome: `${raiz}/LEIA-ME.txt`, dados: leia },
    { nome: `${raiz}/indice.csv`, dados: indiceCsv(noIndice) },
    ...conteudo.map(({ nome, dados }) => ({ nome, dados }))
  ], { quando: geradoEm });
  const hash = sha256(bytes);
  const nomeArquivo = `${raiz}.zip`;

  let registro = null;
  const avisos = [
    pdf ? null : 'O relatório em PDF não veio (só dentro do aplicativo): o pacote saiu só com a planilha.',
    semImpressora ? 'Os documentos gerados na hora (dossiês, DANFE, espelhos, extrato) foram em HTML: gere o pacote dentro do aplicativo para tê-los em PDF.' : null,
    naoGerados.length ? `${c.plural(naoGerados.length, 'documento não pôde ser gerado', 'documentos não puderam ser gerados')} (veja o LEIA-ME).` : null,
    porPag.erro ? `As pastas dos pagamentos não foram montadas (${porPag.erro}): os comprovantes foram para 06-Pagamentos/${pagamentosMod.PASTA_AVULSOS}.` : null
  ].filter(Boolean);
  let aviso = avisos.length ? avisos.join(' ') : null;
  const jaHa = await b.lerOpcional(api, 'contabil_pacotes', { competencia: comp });
  if (jaHa) {
    registro = await b.inserir(api, 'contabil_pacotes', {
      competencia: comp, versao: numeroVersao, nome_arquivo: nomeArquivo, hash, tamanho_bytes: bytes.length,
      arquivos: JSON.stringify(noIndice.map(({ pasta, nome, sha256: s, origem_rotulo: o, tamanho }) => ({ pasta, nome, sha256: s, origem: o || null, tamanho }))),
      faltando: JSON.stringify(faltando), gerado_em: agora, gerado_por: usuarioId
    });
  } else {
    aviso = `${b.SQL_FALTANDO_PACOTE} Sem ele, o pacote não fica registrado (não dá para marcar como enviado).${aviso ? ` ${aviso}` : ''}`;
  }
  await eventos.registrar(api, {
    tipo: 'pacote_gerado', competencia: comp, usuarioId,
    descricao: `Pacote de ${c.rotuloCompetencia(comp)}${numeroVersao ? ` (versão ${numeroVersao})` : ''} gerado: ${c.plural(noIndice.length, 'arquivo', 'arquivos')}, ${tamanhoImpresso(bytes.length)}`
      + `${faltando.length ? `, ${faltando.length} faltando` : ''} · SHA-256 ${hash.slice(0, 12)}…`,
    dados: { pacote_id: registro?.id ?? null, hash, versao: numeroVersao, arquivos: noIndice.length, faltando: faltando.length, tamanho: bytes.length }
  });
  return {
    id: registro?.id ?? null, competencia: comp, versao: numeroVersao, nome: nomeArquivo, tipo: 'application/zip',
    base64: bytes.toString('base64'), hash, tamanho: bytes.length, tamanho_rotulo: tamanhoImpresso(bytes.length),
    arquivos: noIndice.length, faltando, aviso,
    pagamentos: porPag.pagamentos.length, gerados: noIndice.filter(x => Object.values(GERADOS).includes(x.tipo)).length, nao_gerados: naoGerados
  };
}

/**
 * Fase D (regra do dono: "guarda só até gerar o pacote; gerado, exclui do
 * servidor"): a tela avisa que o ZIP foi SALVO e os originais dos
 * comprovantes do BB que ficaram guardados (os que o app não refez
 * idênticos) saem do servidor — ficam os dados e o SHA-256, e o pacote leva
 * o original.
 */
async function marcarSalvo(api, id, { usuarioId = null } = {}) {
  if (!/^\d{1,12}$/.test(String(id ?? ''))) throw c.erro('Informe o pacote.');
  const p = (await b.ler(api, 'contabil_pacotes', { id: Number(id) }))[0] || null;
  if (!p) throw c.erro('Pacote não encontrado.', 404);
  const r = await require('../comprovantes/comprovantes').descartarOriginais(api, { competencia: p.competencia, usuarioId, pacoteId: p.id });
  // Fase C: o PDF mensal das aplicações também (ficam os dados e as conferências).
  const a = await require('../aplicacoes/aplicacoes').descartarOriginais(api, { competencia: p.competencia, usuarioId, pacoteId: p.id });
  return { id: p.id, competencia: p.competencia, originais_descartados: r.descartados + a.descartados };
}

/** Marca um pacote como enviado à contabilidade: para quem, como e quando. */
async function marcarEnviado(api, id, { entrada = {}, usuarioId = null }) {
  if (!/^\d{1,12}$/.test(String(id ?? ''))) throw c.erro('Informe o pacote.');
  const e = validarEnvio(entrada);
  const p = (await b.ler(api, 'contabil_pacotes', { id: Number(id) }))[0] || null;
  if (!p) throw c.erro('Pacote não encontrado.', 404);
  const agora = c.agora();
  await b.atualizar(api, 'contabil_pacotes', p.id, { enviado_em: agora, enviado_por: usuarioId, enviado_para: e.para, envio_meio: e.meio, envio_observacao: e.observacao });
  await eventos.registrar(api, {
    tipo: 'pacote_enviado', competencia: p.competencia, usuarioId,
    descricao: `Pacote de ${c.rotuloCompetencia(p.competencia)}${p.versao ? ` (versão ${p.versao})` : ''} enviado para ${e.para} (${e.meio})${e.observacao ? `: ${e.observacao}` : ''} · SHA-256 ${String(p.hash).slice(0, 12)}…`,
    dados: { pacote_id: p.id, hash: String(p.hash).trim(), para: e.para, meio: e.meio }
  });
  return { id: p.id, enviado_em: b.instanteBR(agora), enviado_para: e.para, envio_meio: e.meio };
}

module.exports = {
  PASTAS, GERADOS, MEIOS, LIMITE_BYTES, pastaDoItem, planoDoPacote, nomeSeguro, nomeUnico, encurtar, temDanfe, vaiNaPastaDoPagamento, indiceCsv, leiaMe, nomeDoPacote,
  pacotePublico, validarEnvio, previa, gerar, marcarEnviado, marcarSalvo
};
