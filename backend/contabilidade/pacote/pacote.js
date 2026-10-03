/**
 * O pacote da competência para a contabilidade (etapa 9): um ZIP que o
 * usuário salva e envia (decisão do dono: "zipar tudo e o usuário salvar e
 * enviar ele mesmo").
 *
 *   Contabilidade-2026-08-v1/
 *     LEIA-ME.txt                 o que tem, a versão, o resultado, o que falta
 *     indice.csv                  cada arquivo com a pasta, a origem e o SHA-256
 *     01-Relatorio/               o relatório mensal (PDF e planilha — internos)
 *     02-Extrato/                 o OFX original de cada importação do mês
 *     03-NF-e-de-saida/           os XML das NF-e emitidas (e as de fora)
 *     04-Devolucoes/              os XML das notas de devolução dos clientes
 *     05-Recebidos/               NF-e de entrada, NFS-e, recibos, guias
 *     06-Comprovantes/            os comprovantes de pagamento
 *     07-Outros/                  contratos, boletos e o resto anexado ao mês
 *
 * Os arquivos são os ORIGINAIS guardados no app (Documentos da competência,
 * evidencias.js); o relatório é documento interno. Só sai com a competência
 * fechada e sem pendência documental viva (as três severidades do dono: a
 * documental bloqueia o pacote). Cada pacote gerado fica registrado
 * (contabil_pacotes: o SHA-256 do ZIP e de cada arquivo) e o usuário marca
 * quando enviou, para quem e como. O ZIP não fica no banco.
 *
 * O PDF do relatório é feito pela tela (o Electron imprime o HTML de
 * relatorio/documento.js) e chega aqui em base64; sem ele, o pacote sai só
 * com a planilha, avisando.
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
const zip = require('./zip');

const PASTAS = {
  relatorio: { pasta: '01-Relatorio', rotulo: 'Relatório mensal (PDF e planilha)' },
  extrato: { pasta: '02-Extrato', rotulo: 'Extrato bancário (o OFX original)' },
  saida: { pasta: '03-NF-e-de-saida', rotulo: 'NF-e de saída (XML)' },
  devolucao: { pasta: '04-Devolucoes', rotulo: 'NF-e de devolução dos clientes (XML)' },
  // Nome curto: o XML leva a chave de 44 dígitos no nome e o Windows limita o caminho a 260 caracteres.
  recebidos: { pasta: '05-Recebidos', rotulo: 'Documentos recebidos (NF-e de entrada, NFS-e, recibos, guias)' },
  pagamentos: { pasta: '06-Comprovantes', rotulo: 'Comprovantes de pagamento' },
  outros: { pasta: '07-Outros', rotulo: 'Outros (contratos, boletos, extratos em PDF)' }
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
function leiaMe({ empresa, rotulo, versao = null, fechadaEm = null, fechadaPor = null, geradoEm, geradoPor = null, pastas = [], faltando = [], ignoradas = [], resultado = null, semPdf = false }) {
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

/** O que a tela mostra antes de gerar: se pode, o que vai em cada pasta, o que falta e os pacotes já gerados. */
async function previa(api, { competencia, hoje, desde = null }) {
  if (!c.competenciaValida(competencia)) throw c.erro('Informe a competência (AAAA-MM).');
  const comp = String(competencia);
  const painel = await checklist.carregar({ api, competencia: comp, hoje, desde });
  if (painel.sql_pendente) throw c.erro(b.SQL_FALTANDO, 409, { sql_pendente: true });
  const [evid, lidos] = await Promise.all([
    evidencias.carregar(api, { competencia: comp, hoje }).catch(() => null),
    b.lerOpcional(api, 'contabil_pacotes', { competencia: comp })
  ]);
  const { aLer, faltando } = planoDoPacote(evid?.itens || []);
  const pastas = Object.entries(PASTAS).map(([chave, p]) => ({
    chave, pasta: p.pasta, rotulo: p.rotulo,
    itens: chave === 'relatorio'
      ? [{ titulo: 'Relatório mensal (PDF)', detalhe: 'Gerado na hora, com a foto do fechamento', origem_rotulo: ORIGENS.interno }, { titulo: 'Relatório mensal (planilha)', detalhe: 'As 8 abas do relatório', origem_rotulo: ORIGENS.interno }]
      : aLer.filter(x => x.chave === chave).map(x => ({ titulo: x.item.titulo, detalhe: x.item.detalhe || null, origem_rotulo: x.item.origem_rotulo || null, data: x.item.data || null }))
  })).map(p => ({ ...p, quantidade: p.itens.length }));
  const pacotes = (lidos || []).sort((x, y) => String(y.gerado_em).localeCompare(String(x.gerado_em)) || Number(y.id) - Number(x.id));
  const nomes = await b.nomesDeUsuarios(api, pacotes.flatMap(p => [p.gerado_por, p.enviado_por]));
  const ultimoEnviado = pacotes.find(p => p.enviado_em) || null;
  return {
    competencia: comp, rotulo: c.rotuloCompetencia(comp), status: painel.situacao.status, versao: painel.situacao.versao,
    fechada_em: painel.situacao.fechada_em, pode: Boolean(painel.pode.pacote), bloqueios: painel.bloqueios.pacote,
    nome: nomeDoPacote(comp, painel.situacao.versao), pastas, faltando,
    documentos_sql_pendente: !evid || Boolean(evid.sql_pendente),
    pacotes: pacotes.map(p => pacotePublico(p, nomes)), sql_pacotes: lidos !== null,
    meios: MEIOS, ultimo_destinatario: ultimoEnviado?.enviado_para || null, ultimo_meio: ultimoEnviado?.envio_meio || null
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

/**
 * Gera o pacote: confere se pode (fechada, sem documental viva), monta o
 * relatório (a planilha aqui; o PDF vem da tela), lê cada original, zipa,
 * registra e devolve o ZIP em base64 para a tela salvar.
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
  const evid = await evidencias.carregar(api, { competencia: comp, hoje });
  const { aLer, faltando } = planoDoPacote(evid.itens);

  const usados = new Map(Object.keys(PASTAS).map(k => [k, new Set()]));
  const conteudo = [];
  const noIndice = [];
  const adicionar = (chave, nome, dados, meta = {}) => {
    const final = nomeUnico(nome, usados.get(chave));
    const caminho = `${PASTAS[chave].pasta}/${final}`;
    conteudo.push({ nome: `${raiz}/${caminho}`, dados });
    noIndice.push({ pasta: PASTAS[chave].pasta, nome: final, tamanho: dados.length, sha256: sha256(dados), ...meta });
  };
  const nomeRel = `Relatorio-${comp}${numeroVersao ? `-v${numeroVersao}` : ''}`;
  if (pdf) adicionar('relatorio', `${nomeRel}.pdf`, pdf, { tipo: 'Relatório mensal (PDF)', origem_rotulo: ORIGENS.interno });
  adicionar('relatorio', `${nomeRel}.xlsx`, xlsx, { tipo: 'Relatório mensal (planilha)', origem_rotulo: ORIGENS.interno });
  let total = pdf ? pdf.length + xlsx.length : xlsx.length;
  for (const { chave, item } of aLer) {
    try {
      const lido = await lerItem(api, item);
      total += lido.dados.length;
      if (total > LIMITE_BYTES) throw c.erro(`O pacote passa de ${tamanhoImpresso(LIMITE_BYTES)}: fale com o suporte.`, 413);
      adicionar(chave, lido.nome, lido.dados, {
        tipo: item.categoria || null, origem_rotulo: item.origem_rotulo || null, documento: [item.titulo, item.detalhe].filter(Boolean).join(' — '), data: item.data || null, valor: item.valor ?? null
      });
    } catch (e) {
      if (e?.status === 413) throw e;
      faltando.push({ titulo: item.titulo, detalhe: item.detalhe || null, motivo: `não foi possível ler (${e?.message || 'erro'})` });
    }
  }

  // Na ordem das pastas (01, 02…), mantendo a ordem de cada uma.
  const ordem = Object.values(PASTAS).map(x => x.pasta);
  const porPasta = (x, y) => ordem.indexOf(x.pasta) - ordem.indexOf(y.pasta);
  noIndice.forEach((x, i) => { conteudo[i].pasta = x.pasta; });
  conteudo.sort(porPasta);
  noIndice.sort(porPasta);

  const agora = c.agora();
  const geradoEm = b.instanteBR(agora);
  const nomes = await b.nomesDeUsuarios(api, [usuarioId, versao?.fechada_por]);
  const pastas = Object.entries(PASTAS).map(([chave, p]) => ({ chave, pasta: p.pasta, rotulo: p.rotulo, quantidade: noIndice.filter(x => x.pasta === p.pasta).length }));
  const leia = leiaMe({
    empresa: rel.empresa, rotulo: rel.rotulo, versao: numeroVersao, fechadaEm: versao ? b.instanteBR(versao.fechada_em) : painel.situacao.fechada_em,
    fechadaPor: versao ? nomes.get(String(versao.fechada_por)) || null : painel.situacao.fechada_por, geradoEm, geradoPor: nomes.get(String(usuarioId)) || null,
    pastas, faltando, ignoradas: ignoradasDe(painel), resultado: rel.resultado, semPdf: !pdf
  });
  const bytes = zip.zipar([
    { nome: `${raiz}/LEIA-ME.txt`, dados: leia },
    { nome: `${raiz}/indice.csv`, dados: indiceCsv(noIndice) },
    ...conteudo.map(({ nome, dados }) => ({ nome, dados }))
  ], { quando: geradoEm });
  const hash = sha256(bytes);
  const nomeArquivo = `${raiz}.zip`;

  let registro = null;
  let aviso = pdf ? null : 'O relatório em PDF não veio (só dentro do aplicativo): o pacote saiu só com a planilha.';
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
    arquivos: noIndice.length, faltando, aviso
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
  return { id: p.id, competencia: p.competencia, originais_descartados: r.descartados };
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
  PASTAS, MEIOS, LIMITE_BYTES, pastaDoItem, planoDoPacote, nomeSeguro, nomeUnico, indiceCsv, leiaMe, nomeDoPacote, pacotePublico, validarEnvio,
  previa, gerar, marcarEnviado, marcarSalvo
};
