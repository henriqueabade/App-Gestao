/**
 * Execuções da conciliação — fase F.
 *
 * Cada conciliação (automática ou pelo botão) vira uma linha em
 * `cobranca_execucoes` com o resumo do que fez. Na automática a `chave` é a
 * faixa de horário ('auto:<faixa>') e o UNIQUE do banco é a trava entre
 * máquinas: quem gravar primeiro roda, as outras desistem — o mesmo padrão do
 * nosso número. Linhas com mais de 30 dias são apagadas por aqui.
 *
 * Sem a tabela (SQL da fase não rodou) nada quebra: iniciar devolve null e a
 * conciliação automática não roda.
 */
const RETENCAO_DIAS = 30;
const TIPOS = { conciliacao_automatica: 'automática', conciliacao_manual: 'pelo botão' };

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const agoraIso = () => new Date().toISOString();

function tabelaAusente(err) {
  const texto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  return /42P01/.test(texto) || /cobranca_execucoes.{0,20}(does not exist|não encontrada|não existe)/i.test(texto)
    || (err?.status === 404 && /cobranca_execucoes/i.test(texto) && /tabela|não encontrada|não há/i.test(texto));
}

function ehDuplicada(err) {
  const texto = `${err?.message || ''} ${err?.body?.detalhe || ''} ${err?.body?.error || ''}`.toLowerCase();
  return texto.includes('duplicate key') || texto.includes('cobranca_execucoes_chave') || texto.includes('23505') || err?.status === 409;
}

/** A faixa de horário de um instante: inteiro que muda a cada `intervaloMin`. */
function faixaDe(instanteMs, intervaloMin) {
  const passo = Math.max(1, Number(intervaloMin) || 60) * 60 * 1000;
  return Math.floor(Number(instanteMs) / passo);
}

/** Uma linha para a tela a partir do resultado de conciliacao.conciliar. */
function resumoDoResultado(r) {
  if (!r) return 'Sem resultado.';
  if (r.sql_pendente) return 'Recebimentos ainda não ativados (falta o SQL da fase E).';
  const f = r.fila || {};
  const c = r.consultas || {};
  const partes = [];
  partes.push(`${Number(f.lidos) || 0} aviso(s) do BB`);
  if (Number(f.pagos)) partes.push(`${f.pagos} pagamento(s)`);
  if (Number(f.cancelados)) partes.push(`${f.cancelados} cancelamento(s)`);
  if (Number(f.alertas)) partes.push(`${f.alertas} alerta(s)`);
  if (c.consultados !== undefined) partes.push(`${Number(c.consultados) || 0} boleto(s) consultado(s)`);
  if (Number(c.mudaram)) partes.push(`${c.mudaram} mudaram`);
  if (Number(r.acerto?.lancados)) partes.push(`${r.acerto.lancados} recebimento(s) lançado(s)`);
  const erros = (Number(f.erros) || 0) + (Number(c.erros) || 0) + (Number(r.acerto?.erros) || 0);
  if (erros) partes.push(`${erros} erro(s)`);
  return partes.join(' · ');
}

/** O que guardar do resultado (sem mensagens longas). */
function resultadoEnxuto(r) {
  if (!r) return null;
  const tirar = ({ mensagens, ...resto } = {}) => ({ ...resto, mensagens: (mensagens || []).slice(0, 10) });
  return { fila: tirar(r.fila), consultas: tirar(r.consultas), acerto: tirar(r.acerto), sql_pendente: Boolean(r.sql_pendente) };
}

/**
 * Grava o início. Devolve a linha, ou null quando outra máquina já pegou a
 * faixa (chave repetida) ou a tabela não existe (`motivo` diz qual).
 */
async function iniciar(api, { tipo, chave, maquina = null, usuarioId = null }) {
  try {
    const criada = await api.post('/api/cobranca_execucoes', {
      tipo, chave: String(chave).slice(0, 80), maquina: maquina ? String(maquina).slice(0, 80) : null,
      usuario_id: usuarioId, iniciado_em: agoraIso()
    });
    const id = criada?.id ?? criada?.[0]?.id ?? null;
    return id ? { ...criada, id } : null;
  } catch (e) {
    if (ehDuplicada(e)) return { ocupada: true };
    if (tabelaAusente(e)) return { sem_tabela: true };
    throw e;
  }
}

async function concluir(api, execucao, { resultado = null, erro = null } = {}) {
  if (!execucao?.id) return;
  await api.put(`/api/cobranca_execucoes/${execucao.id}`, {
    concluido_em: agoraIso(),
    resumo: erro ? `Falhou: ${String(erro).slice(0, 200)}` : resumoDoResultado(resultado).slice(0, 500),
    resultado: resultadoEnxuto(resultado),
    erro: erro ? String(erro).slice(0, 2000) : null
  });
}

/** As execuções mais novas primeiro (até `limite`); sem a tabela, lista vazia e `sem_tabela`. */
async function recentes(api, limite = 10) {
  try {
    const linhas = lista(await api.get('/api/cobranca_execucoes'));
    return {
      sem_tabela: false,
      linhas: linhas.filter(Boolean)
        .sort((a, b) => String(b.iniciado_em).localeCompare(String(a.iniciado_em)) || Number(b.id) - Number(a.id))
        .slice(0, limite)
        .map(l => ({
          id: l.id, tipo: l.tipo, tipo_rotulo: TIPOS[l.tipo] || l.tipo, maquina: l.maquina || null, usuario_id: l.usuario_id ?? null,
          iniciado_em: l.iniciado_em, concluido_em: l.concluido_em || null, resumo: l.resumo || null, erro: l.erro || null
        })),
      todas: linhas
    };
  } catch (e) {
    if (tabelaAusente(e)) return { sem_tabela: true, linhas: [], todas: [] };
    throw e;
  }
}

/** Apaga as execuções com mais de 30 dias (o registro é só nosso). Falha aqui não importa. */
async function limparAntigas(api, todas, agoraMs = Date.now()) {
  const limite = agoraMs - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  const velhas = lista(todas).filter(l => l && l.iniciado_em && new Date(l.iniciado_em).getTime() < limite);
  let apagadas = 0;
  for (const l of velhas) {
    try {
      await api.delete(`/api/cobranca_execucoes/${l.id}`);
      apagadas += 1;
    } catch (_) { /* fica para a próxima */ }
  }
  return apagadas;
}

module.exports = {
  RETENCAO_DIAS, TIPOS,
  tabelaAusente, ehDuplicada, faixaDe, resumoDoResultado, resultadoEnxuto, iniciar, concluir, recentes, limparAntigas
};
