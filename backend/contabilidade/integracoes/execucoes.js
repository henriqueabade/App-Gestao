/**
 * O registro de cada busca das integrações (contabil_integracao_execucoes):
 * automática, pelo botão ou teste, com o resumo do que fez. Na automática a
 * `chave` é a faixa de horário ('sefaz_nfe:auto:60:<faixa>') e o UNIQUE do
 * banco é a trava entre máquinas: quem gravar primeiro roda, as outras
 * desistem (o mesmo padrão da conciliação automática da cobrança). Guarda-se
 * 30 dias.
 */
const os = require('os');
const c = require('../../financeiro/comum');
const b = require('../base');

const TABELA = 'contabil_integracao_execucoes';
const RETENCAO_DIAS = 30;
const TIPOS = { automatica: 'automática', manual: 'pelo botão', teste: 'teste de conexão' };

/** A faixa de horário de um instante (muda a cada `intervaloMin`). Pura. */
function faixaDe(instanteMs, intervaloMin) {
  const passo = Math.max(1, Number(intervaloMin) || 60) * 60 * 1000;
  return Math.floor(Number(instanteMs) / passo);
}

/** Uma chave única para a execução pelo botão ou teste. */
const chaveAvulsa = (integracao, tipo) => `${integracao}:${tipo}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`.slice(0, 80);

/**
 * Grava o início. `{ id }`, `{ ocupada: true }` (outra máquina pegou a faixa)
 * ou `{ sem_tabela: true }`.
 */
async function iniciar(api, { integracao, tipo, chave = null, usuarioId = null, maquina = os.hostname() }) {
  try {
    const linha = await b.inserir(api, TABELA, {
      integracao, tipo, chave: String(chave || chaveAvulsa(integracao, tipo)).slice(0, 80), maquina: String(maquina || '').slice(0, 80) || null,
      usuario_id: usuarioId, iniciado_em: c.agora()
    });
    return linha?.id ? { id: linha.id } : { id: null };
  } catch (e) {
    if (e?.extra?.sql_pendente) return { sem_tabela: true };
    if (c.ehDuplicado(e)) return { ocupada: true };
    throw e;
  }
}

async function concluir(api, execucao, { resumo = null, resultado = null, erro = null } = {}) {
  if (!execucao?.id) return;
  try {
    await b.atualizar(api, TABELA, execucao.id, {
      concluido_em: c.agora(),
      resumo: erro ? `Falhou: ${String(erro).slice(0, 480)}` : String(resumo || 'Concluída.').slice(0, 500),
      resultado: resultado ? JSON.stringify(resultado) : null,
      erro: erro ? String(erro).slice(0, 4000) : null
    });
  } catch (e) {
    console.warn('[contabilidade/integracoes] execução não concluída no registro:', e?.message || e);
  }
}

/** As mais novas primeiro (de uma integração ou de todas). */
async function recentes(api, { integracao = null, limite = 10 } = {}) {
  const linhas = await b.lerOpcional(api, TABELA, integracao ? { integracao } : {});
  if (linhas === null) return { sem_tabela: true, linhas: [], todas: [] };
  const ordenadas = linhas.filter(Boolean).sort((x, y) => String(y.iniciado_em).localeCompare(String(x.iniciado_em)) || Number(y.id) - Number(x.id));
  return {
    sem_tabela: false,
    todas: ordenadas,
    linhas: ordenadas.slice(0, limite).map(l => ({
      id: l.id, integracao: l.integracao, tipo: l.tipo, tipo_rotulo: TIPOS[l.tipo] || l.tipo, maquina: l.maquina || null,
      iniciado_em: b.instanteBR(l.iniciado_em), concluido_em: b.instanteBR(l.concluido_em), resumo: l.resumo || null, erro: l.erro ? String(l.erro).slice(0, 500) : null
    }))
  };
}

/** Apaga o que passou de 30 dias. Falha aqui não importa. */
async function limparAntigas(api, todas, agoraMs = Date.now()) {
  const limite = agoraMs - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  let apagadas = 0;
  for (const l of (todas || []).filter(x => x?.iniciado_em && new Date(x.iniciado_em).getTime() < limite)) {
    try { await b.excluir(api, TABELA, l.id); apagadas++; } catch (_) { /* fica para a próxima */ }
  }
  return apagadas;
}

module.exports = { TABELA, RETENCAO_DIAS, TIPOS, faixaDe, chaveAvulsa, iniciar, concluir, recentes, limparAntigas };
