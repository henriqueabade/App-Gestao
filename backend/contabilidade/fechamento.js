/**
 * Fechar e reabrir a competência contábil, ignorar/restaurar pendências e o
 * histórico do módulo (etapa 1).
 *
 * Fechar exige: mês terminado, nenhum erro crítico vivo (o checklist é
 * recalculado na hora, nunca se confia no que a tela mandou) e a
 * competência ainda não fechada. Fica gravada a foto dos números e das
 * pendências que sobraram. Reabrir exige justificativa. Ignorar só vale para
 * documental e aviso. Cada ação vira um evento em contabil_eventos —
 * registrar é o último passo e não desfaz a ação se falhar.
 */
const c = require('../financeiro/comum');
const b = require('./base');
const checklist = require('./checklist');
const eventos = require('./eventos');

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

async function fechar({ api, competencia, hoje, desde = null, usuarioId = null }) {
  const comp = exigirCompetencia(competencia);
  const painel = await checklist.carregar({ api, competencia: comp, hoje, desde });
  if (painel.sql_pendente) throw c.erro(b.SQL_FALTANDO, 409, { sql_pendente: true });
  if (!painel.pode.fechar) throw c.erro('Não dá para fechar esta competência.', 409, { bloqueios: painel.bloqueios.fechar });

  const agora = c.agora();
  const sobraram = painel.pendencias.filter(p => !p.ignorada).map(p => ({ nivel: p.nivel, chave: p.chave, titulo: p.titulo }));
  const campos = {
    status: 'fechada', fechada_em: agora, fechada_por: usuarioId, reaberta_em: null, reaberta_por: null, justificativa_reabertura: null,
    totais: JSON.stringify(fotoDoPainel(painel)), pendencias_no_fechamento: JSON.stringify(sobraram), atualizado_em: agora
  };
  const existente = painel.situacao_bruta;
  let linha;
  try {
    linha = existente
      ? { ...existente, ...campos, ...(await b.atualizar(api, 'competencia_contabil', existente.id, campos), {}) }
      : await b.inserir(api, 'competencia_contabil', { competencia: comp, ...campos, criado_em: agora });
  } catch (e) {
    // Duas máquinas fechando ao mesmo tempo: a segunda cai no UNIQUE da competência.
    if (c.ehDuplicado(e)) throw c.erro('Esta competência acabou de ser fechada por outro usuário.', 409);
    throw e;
  }
  const { contagem } = painel;
  await registrar(api, {
    tipo: 'competencia_fechada', competencia: comp, usuarioId,
    descricao: `Competência ${painel.rotulo} fechada com ${c.plural(contagem.documental, 'pendência documental', 'pendências documentais')}, ${c.plural(contagem.aviso, 'aviso', 'avisos')} e ${c.plural(contagem.ignoradas, 'ignorada', 'ignoradas')}`,
    dados: { contagem, progresso: painel.progresso }
  });
  return { id: linha.id, competencia: comp, status: 'fechada', fechada_em: b.instanteBR(agora), contagem, pendencias_no_fechamento: sobraram };
}

async function reabrir({ api, competencia, justificativa, usuarioId = null }) {
  const comp = exigirCompetencia(competencia);
  const j = exigirJustificativa(justificativa, 'da reabertura');
  const linha = (await b.ler(api, 'competencia_contabil', { competencia: comp }))[0] || null;
  if (!linha || linha.status !== 'fechada') throw c.erro('Esta competência não está fechada.', 409);
  const agora = c.agora();
  const campos = { status: 'reaberta', reaberta_em: agora, reaberta_por: usuarioId, justificativa_reabertura: j, atualizado_em: agora };
  await b.atualizar(api, 'competencia_contabil', linha.id, campos);
  await registrar(api, {
    tipo: 'competencia_reaberta', competencia: comp, usuarioId,
    descricao: `Competência ${c.rotuloCompetencia(comp)} reaberta: ${j}`,
    dados: { fechada_em: linha.fechada_em, fechada_por: linha.fechada_por }
  });
  return { id: linha.id, competencia: comp, status: 'reaberta', reaberta_em: b.instanteBR(agora) };
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

module.exports = { TIPOS, JUSTIFICATIVA_MINIMA, registrar, fotoDoPainel, fechar, reabrir, ignorarPendencia, restaurarPendencia, atividade, listarCompetencias };
