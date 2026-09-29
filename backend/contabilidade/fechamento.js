/**
 * Fechar e reabrir a competência contábil, ignorar/restaurar pendências e o
 * histórico do módulo (etapa 1; o fechamento completo é da etapa 7).
 *
 * Fechar exige: mês terminado, nenhum erro crítico vivo (o checklist é
 * recalculado na hora, nunca se confia no que a tela mandou) e a
 * competência ainda não fechada. Fica gravada a FOTO do mês (etapa 7, em
 * competencia_fechamentos, uma versão por fechamento): o resultado por conta
 * do plano, o extrato de cada conta com o saldo do banco, a conciliação, os
 * números das fontes e cada lançamento com a conta do plano que valia — a
 * classificação do mês fechado passa a ser essa. Reabrir exige justificativa
 * e marca a versão; fechar de novo cria a próxima. Ignorar só vale para
 * documental e aviso. Cada ação vira um evento em contabil_eventos —
 * registrar é o último passo e não desfaz a ação se falhar.
 */
const c = require('../financeiro/comum');
const b = require('./base');
const checklist = require('./checklist');
const eventos = require('./eventos');
const versoes = require('./versoes');
const classificacao = require('./classificacao/classificacao');
const extratoMod = require('./extrato/extrato');

const { TIPOS, registrar } = eventos;

const JUSTIFICATIVA_MINIMA = 10;

function exigirCompetencia(competencia) {
  if (!c.competenciaValida(competencia)) throw c.erro('Informe a competência (AAAA-MM).');
  return String(competencia);
}

function exigirJustificativa(texto, oQue) {
  const j = c.texto(texto, 1000);
  if (j.length < JUSTIFICATIVA_MINIMA) throw c.erro(`Escreva a justificativa ${oQue} (pelo menos ${JUSTIFICATIVA_MINIMA} caracteres).`);
  return j;
}

/** A foto do painel que fica gravada no fechamento (números, não a tela inteira). */
function fotoDoPainel(painel) {
  return {
    fontes: painel.fontes.map(f => ({ chave: f.chave, estado: f.estado, numeros: f.numeros })),
    contagem: painel.contagem,
    progresso: painel.progresso
  };
}

/**
 * A foto completa do mês (etapa 7), a partir do painel já calculado: os
 * lançamentos do extrato com a conta do plano que vale agora, o resultado
 * por conta do plano, o extrato de cada conta (com o saldo que o banco
 * informou) e a conciliação. Sem o SQL do extrato ou da classificação, a
 * parte dele fica vazia.
 */
async function carregarFoto(api, { painel, competencia, hoje }) {
  const movs = ((await b.lerOpcional(api, 'movimentos_bancarios', { competencia })) || [])
    .filter(m => m && m.competencia === competencia)
    .sort((x, y) => String(c.dia(x.data)).localeCompare(String(c.dia(y.data))) || Number(x.id) - Number(y.id));
  const classificados = movs.length ? await classificacao.doMes(api, movs) : [];
  const clsPorId = new Map((classificados || []).map(x => [String(x.movimento.id), x.classificacao]));
  const lancamentos = movs.map(m => versoes.lancamentoDaFoto(m, clsPorId.get(String(m.id)) || null));
  const resultado = classificados
    ? versoes.resultadoDe(classificacao.porConta(lancamentos.map(l => ({ valor: l.valor, classificacao: { conta_id: l.conta_id, conta: l.conta, conta_tipo: l.conta_tipo } }))))
    : null;
  const [contas, importacoes] = await Promise.all([
    extratoMod.listarContas(api).then(r => r.contas).catch(() => []),
    b.lerOpcional(api, 'extrato_importacoes').then(x => x || [])
  ]);
  const extrato = contas
    .filter(conta => conta.ativa || lancamentos.some(l => String(l.conta_financeira_id) === String(conta.id)))
    .map(conta => {
      const daConta = lancamentos.filter(l => String(l.conta_financeira_id) === String(conta.id));
      const tot = extratoMod.totaisDe(daConta);
      const imps = importacoes.filter(i => String(i.conta_id) === String(conta.id));
      return {
        conta_id: conta.id, conta: conta.nome, tipo: conta.tipo, lancamentos: tot.quantidade,
        entradas: tot.entradas.total, saidas: tot.saidas.total, resultado: tot.resultado,
        saldo_banco: extratoMod.saldoDoBanco(imps, competencia),
        completo: conta.tipo === 'corrente' ? extratoMod.cobertura(imps, competencia, { hoje }).completa : null
      };
    });
  const conciliacao = (painel.fontes || []).find(f => f.chave === 'conciliacao')?.numeros || null;
  return { foto: { ...fotoDoPainel(painel), gerada_em: c.agora(), resultado, extrato, conciliacao }, lancamentos };
}

const proximaVersao = lidas => (c.lista(lidas).length ? Math.max(...lidas.map(v => Number(v.versao) || 0)) : 0) + 1;

async function fechar({ api, competencia, hoje, desde = null, usuarioId = null }) {
  const comp = exigirCompetencia(competencia);
  const painel = await checklist.carregar({ api, competencia: comp, hoje, desde });
  if (painel.sql_pendente) throw c.erro(b.SQL_FALTANDO, 409, { sql_pendente: true });
  if (!painel.pode.fechar) throw c.erro('Não dá para fechar esta competência.', 409, { bloqueios: painel.bloqueios.fechar });

  const agora = c.agora();
  const sobraram = painel.pendencias.filter(p => !p.ignorada).map(p => ({ nivel: p.nivel, chave: p.chave, titulo: p.titulo }));
  const ignoradas = painel.pendencias.filter(p => p.ignorada).map(p => ({ nivel: p.nivel, chave: p.chave, titulo: p.titulo, ignorada: true, justificativa: p.justificativa || null }));
  const { foto, lancamentos } = await carregarFoto(api, { painel, competencia: comp, hoje });

  // A versão (etapa 7) primeiro: se a competência não gravar, ela sai.
  const lidas = await versoes.lerVersoes(api, comp);
  let versao = null;
  let aviso = null;
  if (lidas) {
    const numero = proximaVersao(lidas);
    try {
      versao = await b.inserir(api, 'competencia_fechamentos', {
        competencia: comp, versao: numero, fechada_em: agora, fechada_por: usuarioId,
        foto: JSON.stringify(foto), lancamentos: JSON.stringify(lancamentos), pendencias: JSON.stringify([...sobraram, ...ignoradas]), hash: versoes.hashDe(lancamentos)
      });
      versao = { ...versao, versao: numero };
    } catch (e) {
      if (c.ehDuplicado(e) && !e.extra?.sql_pendente) throw c.erro('Esta competência acabou de ser fechada por outro usuário.', 409);
      throw e;
    }
  } else {
    aviso = `${b.SQL_FALTANDO_FECHAMENTO} Sem ele, a foto completa (o resultado e a conta de cada lançamento) não fica guardada.`;
  }

  const campos = {
    status: 'fechada', fechada_em: agora, fechada_por: usuarioId, reaberta_em: null, reaberta_por: null, justificativa_reabertura: null,
    totais: JSON.stringify(foto), pendencias_no_fechamento: JSON.stringify(sobraram), atualizado_em: agora
  };
  const existente = painel.situacao_bruta;
  let linha;
  try {
    linha = existente
      ? { ...existente, ...campos, ...(await b.atualizar(api, 'competencia_contabil', existente.id, campos), {}) }
      : await b.inserir(api, 'competencia_contabil', { competencia: comp, ...campos, criado_em: agora });
  } catch (e) {
    if (versao?.id) await api.delete(`/api/competencia_fechamentos/${versao.id}`).catch(() => null);
    // Duas máquinas fechando ao mesmo tempo: a segunda cai no UNIQUE da competência.
    if (c.ehDuplicado(e)) throw c.erro('Esta competência acabou de ser fechada por outro usuário.', 409);
    throw e;
  }
  const { contagem } = painel;
  const resultado = foto.resultado ? foto.resultado.resultado : null;
  await registrar(api, {
    tipo: 'competencia_fechada', competencia: comp, usuarioId,
    descricao: `Competência ${painel.rotulo} fechada${versao ? ` (versão ${versao.versao})` : ''} com ${c.plural(contagem.documental, 'pendência documental', 'pendências documentais')}, ${c.plural(contagem.aviso, 'aviso', 'avisos')} e ${c.plural(contagem.ignoradas, 'ignorada', 'ignoradas')}`
      + `${resultado !== null ? ` · resultado do mês ${c.reais(resultado)}` : ''}`,
    dados: { contagem, progresso: painel.progresso, versao: versao?.versao ?? null }
  });
  return {
    id: linha.id, competencia: comp, status: 'fechada', fechada_em: b.instanteBR(agora), contagem, pendencias_no_fechamento: sobraram,
    versao: versao?.versao ?? null, resultado, lancamentos: lancamentos.length, aviso
  };
}

async function reabrir({ api, competencia, justificativa, usuarioId = null }) {
  const comp = exigirCompetencia(competencia);
  const j = exigirJustificativa(justificativa, 'da reabertura');
  const linha = (await b.ler(api, 'competencia_contabil', { competencia: comp }))[0] || null;
  if (!linha || linha.status !== 'fechada') throw c.erro('Esta competência não está fechada.', 409);
  const agora = c.agora();
  const campos = { status: 'reaberta', reaberta_em: agora, reaberta_por: usuarioId, justificativa_reabertura: j, atualizado_em: agora };
  await b.atualizar(api, 'competencia_contabil', linha.id, campos);
  // A versão que estava valendo fica marcada (a foto dela não muda).
  const ultimaVersao = versoes.ultima((await versoes.lerVersoes(api, comp)) || []);
  if (ultimaVersao && !ultimaVersao.reaberta_em) {
    await b.atualizar(api, 'competencia_fechamentos', ultimaVersao.id, { reaberta_em: agora, reaberta_por: usuarioId, justificativa_reabertura: j });
  }
  await registrar(api, {
    tipo: 'competencia_reaberta', competencia: comp, usuarioId,
    descricao: `Competência ${c.rotuloCompetencia(comp)} reaberta${ultimaVersao ? ` (a versão ${ultimaVersao.versao} fica guardada)` : ''}: ${j}`,
    dados: { fechada_em: linha.fechada_em, fechada_por: linha.fechada_por, versao: ultimaVersao?.versao ?? null }
  });
  return { id: linha.id, competencia: comp, status: 'reaberta', reaberta_em: b.instanteBR(agora), versao: ultimaVersao?.versao ?? null };
}

/**
 * O que o fechamento vai congelar (nada é gravado): o resultado, o extrato
 * de cada conta, os lançamentos sem conta e, quando já houve versão, o que
 * mudou desde a última.
 */
async function previa({ api, competencia, hoje, desde = null }) {
  const comp = exigirCompetencia(competencia);
  const painel = await checklist.carregar({ api, competencia: comp, hoje, desde });
  const { foto, lancamentos } = await carregarFoto(api, { painel, competencia: comp, hoje });
  const lidas = await versoes.lerVersoes(api, comp);
  const numero = lidas ? proximaVersao(lidas) : null;
  const anterior = lidas ? versoes.ultima(lidas) : null;
  return {
    competencia: comp, rotulo: painel.rotulo, versao: numero, sql_versoes: Boolean(lidas),
    resultado: foto.resultado, extrato: foto.extrato, conciliacao: foto.conciliacao,
    lancamentos: lancamentos.length, sem_classificacao: lancamentos.filter(l => !l.conta_id).length,
    comparacao: anterior ? versoes.compararVersoes(anterior, { versao: numero, foto, lancamentos, hash: versoes.hashDe(lancamentos) }) : null
  };
}

/**
 * O histórico dos fechamentos de uma competência: as versões (da mais nova
 * para a mais antiga), o que mudou de uma para a outra e, se ela está
 * fechada, as diferenças entre a foto e o que o sistema diz hoje.
 */
async function historico({ api, competencia, hoje, desde = null }) {
  const comp = exigirCompetencia(competencia);
  const lidas = await versoes.lerVersoes(api, comp);
  if (!lidas) throw c.erro(b.SQL_FALTANDO_FECHAMENTO, 409, { sql_pendente: true });
  const situacao = ((await b.lerOpcional(api, 'competencia_contabil', { competencia: comp })) || [])[0] || null;
  const nomes = await b.nomesDeUsuarios(api, lidas.flatMap(v => [v.fechada_por, v.reaberta_por]));
  const fechada = situacao?.status === 'fechada';
  const painel = fechada && lidas.length ? await checklist.carregar({ api, competencia: comp, hoje, desde }) : null;
  return {
    competencia: comp, rotulo: c.rotuloCompetencia(comp), status: situacao?.status || 'aberta',
    versoes: lidas.map(v => versoes.publica(v, nomes)).reverse(),
    comparacoes: lidas.slice(1).map((v, i) => versoes.compararVersoes(lidas[i], v)).reverse(),
    diferencas: painel?.situacao?.diferencas_lista || [],
    criticos_depois: painel ? painel.contagem.critico : 0
  };
}

async function ignorarPendencia({ api, competencia, chave, justificativa, hoje, desde = null, usuarioId = null }) {
  const comp = exigirCompetencia(competencia);
  const chaveLimpa = c.texto(chave, 120);
  if (!chaveLimpa) throw c.erro('Informe a pendência.');
  const j = exigirJustificativa(justificativa, 'para ignorar a pendência');
  const painel = await checklist.carregar({ api, competencia: comp, hoje, desde });
  if (painel.sql_pendente) throw c.erro(b.SQL_FALTANDO, 409, { sql_pendente: true });
  const p = painel.pendencias.find(x => x.chave === chaveLimpa) || null;
  if (!p) throw c.erro('Esta pendência não existe mais nesta competência.', 404);
  if (!p.ignoravel) throw c.erro('Erro crítico não se ignora: resolva-o para fechar a competência.', 409);
  if (p.ignorada) throw c.erro('Esta pendência já foi ignorada.', 409);
  let linha;
  try {
    linha = await b.inserir(api, 'contabil_pendencias_resolucoes', {
      competencia: comp, chave: chaveLimpa, nivel: p.nivel, titulo: c.texto(p.titulo, 200), justificativa: j, usuario_id: usuarioId, criado_em: c.agora()
    });
  } catch (e) {
    if (c.ehDuplicado(e)) throw c.erro('Esta pendência já foi ignorada.', 409);
    throw e;
  }
  await registrar(api, {
    tipo: 'pendencia_ignorada', competencia: comp, usuarioId,
    descricao: `"${p.titulo}" (${b.NIVEIS[p.nivel].rotulo.toLowerCase()}) ignorada: ${j}`,
    dados: { chave: chaveLimpa, nivel: p.nivel, fonte: p.fonte }
  });
  return { id: linha.id, competencia: comp, chave: chaveLimpa, nivel: p.nivel, ignorada: true };
}

async function restaurarPendencia({ api, competencia, chave, usuarioId = null }) {
  const comp = exigirCompetencia(competencia);
  const chaveLimpa = c.texto(chave, 120);
  const linhas = await b.ler(api, 'contabil_pendencias_resolucoes', { competencia: comp, chave: chaveLimpa });
  if (!linhas.length) throw c.erro('Esta pendência não estava ignorada.', 404);
  for (const l of linhas) await b.excluir(api, 'contabil_pendencias_resolucoes', l.id);
  await registrar(api, {
    tipo: 'pendencia_restaurada', competencia: comp, usuarioId,
    descricao: `"${linhas[0].titulo || chaveLimpa}" volta a contar como pendência`,
    dados: { chave: chaveLimpa, nivel: linhas[0].nivel }
  });
  return { competencia: comp, chave: chaveLimpa, ignorada: false };
}

/** Os eventos mais recentes da competência (ou de tudo), com quem fez. */
function atividade({ api, competencia = null, limite = 50 }) {
  return eventos.atividade({ api, competencia, limite });
}

/** As competências que já têm linha (fechadas, reabertas), da mais recente para a mais antiga. */
async function listarCompetencias({ api }) {
  const linhas = await b.ler(api, 'competencia_contabil');
  const nomes = await b.nomesDeUsuarios(api, linhas.flatMap(l => [l.fechada_por, l.reaberta_por]));
  return linhas
    .sort((x, y) => String(y.competencia).localeCompare(String(x.competencia)))
    .map(l => ({
      id: l.id, competencia: l.competencia, rotulo: c.rotuloCompetencia(l.competencia), status: l.status,
      fechada_em: b.instanteBR(l.fechada_em), fechada_por: nomes.get(String(l.fechada_por)) || null,
      reaberta_em: b.instanteBR(l.reaberta_em), reaberta_por: nomes.get(String(l.reaberta_por)) || null,
      justificativa_reabertura: l.justificativa_reabertura || null,
      totais: c.jsonDe(l.totais), pendencias_no_fechamento: c.jsonDe(l.pendencias_no_fechamento, [])
    }));
}

module.exports = {
  TIPOS, JUSTIFICATIVA_MINIMA, registrar, fotoDoPainel, carregarFoto, fechar, reabrir, previa, historico,
  ignorarPendencia, restaurarPendencia, atividade, listarCompetencias
};
