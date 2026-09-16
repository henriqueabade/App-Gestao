/**
 * O que a Configuração de cobrança mostra do webhook e da conciliação
 * automática — fase F. Puro: recebe a configuração, os avisos gravados pela
 * API (boletos_eventos, origem 'webhook') e as execuções, e devolve a URL a
 * cadastrar (sem o token), as contagens, os avisos recentes e a agenda.
 */
const ROTA = '/webhooks/bb/baixa-operacional/';
const LIMITE_AVISOS = 15;

const lista = r => (Array.isArray(r) ? r : []);

/** Instante → 'dd/mm/aaaa hh:mm' em Brasília ('' quando não há). */
function momentoBR(instante) {
  if (!instante) return '';
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d).replace(',', '');
}

/** Origem pública da API (sem /api no fim). */
function origemDaApi(env = process.env) {
  return String(env.API_BASE_URL || env.API_URL || 'https://api.santissimodecor.com.br').trim().replace(/\/+$/, '').replace(/\/api$/, '');
}

/** A situação de um aviso na fila. */
function situacaoDoAviso(e) {
  if (!e?.processado_em) return e?.erro_processamento ? 'na fila (erro)' : 'na fila';
  if (!e.boleto_id) return 'ignorado';
  return e.erro_processamento ? 'alerta' : 'conciliado';
}

function montar({ cfg = null, eventos = [], execucoes = { linhas: [], sem_tabela: false }, env = process.env, agoraMs = Date.now() }) {
  const avisos = lista(eventos).filter(e => e && e.origem === 'webhook');
  const conta = s => avisos.filter(e => situacaoDoAviso(e) === s).length;
  const maisNovos = avisos.slice().sort((a, b) => Number(b.id) - Number(a.id));
  const ultimo = maisNovos[0] || null;

  const temColunas = Boolean(cfg) && Object.prototype.hasOwnProperty.call(cfg, 'conciliacao_automatica');
  const intervalo = Math.min(720, Math.max(15, Number(cfg?.conciliacao_intervalo_min) || 60));
  const linhas = lista(execucoes?.linhas);
  const ultimaAutomatica = linhas.find(l => l.tipo === 'conciliacao_automatica') || null;
  let proxima = null;
  if (temColunas && cfg.conciliacao_automatica !== false) {
    // A agenda roda na primeira verificação de cada faixa: estimativa pelo fim da faixa atual.
    const passo = intervalo * 60 * 1000;
    proxima = momentoBR(new Date((Math.floor(agoraMs / passo) + 1) * passo).toISOString());
  }

  return {
    url_modelo: `${origemDaApi(env)}${ROTA}<token>`,
    avisos: {
      total: avisos.length,
      na_fila: conta('na fila') + conta('na fila (erro)'),
      com_erro: conta('na fila (erro)'),
      conciliados: conta('conciliado'),
      ignorados: conta('ignorado'),
      alertas: conta('alerta'),
      ultimo_em: ultimo ? momentoBR(ultimo.criado_em) : null
    },
    recentes: maisNovos.slice(0, LIMITE_AVISOS).map(e => ({
      id: e.id,
      quando: momentoBR(e.criado_em),
      nosso_numero: e.nosso_numero || null,
      situacao: situacaoDoAviso(e),
      mensagem: e.mensagem || '',
      detalhe: e.erro_processamento || '',
      boleto_id: e.boleto_id ?? null
    })),
    agenda: {
      sql_pronto: temColunas && !execucoes?.sem_tabela,
      ligada: temColunas ? cfg.conciliacao_automatica !== false : null,
      intervalo_min: intervalo,
      ultima_automatica: ultimaAutomatica ? {
        quando: momentoBR(ultimaAutomatica.iniciado_em), maquina: ultimaAutomatica.maquina,
        resumo: ultimaAutomatica.resumo || (ultimaAutomatica.concluido_em ? '' : 'não terminou'), erro: ultimaAutomatica.erro || null
      } : null,
      proxima_por_volta: proxima
    },
    execucoes: linhas.map(l => ({
      id: l.id, tipo: l.tipo, como: l.tipo_rotulo || l.tipo, maquina: l.maquina,
      quando: momentoBR(l.iniciado_em), terminou: Boolean(l.concluido_em), resumo: l.resumo || '', erro: l.erro || ''
    }))
  };
}

module.exports = { ROTA, LIMITE_AVISOS, momentoBR, origemDaApi, situacaoDoAviso, montar };
