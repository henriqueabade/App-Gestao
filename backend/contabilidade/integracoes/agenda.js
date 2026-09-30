/**
 * A busca automática das integrações da Contabilidade (etapas 10 a 13).
 *
 * Roda no processo principal do app (server.js a liga só dentro do
 * Electron), no molde da conciliação automática da cobrança: cada máquina
 * verifica a cada ~5 minutos; cada integração LIGADA e com a busca
 * automática marcada roda uma vez por faixa do intervalo dela (SEFAZ: 60
 * min; extrato: 1 vez por dia; ADN: 3 horas — trocável na tela). A primeira
 * máquina que grava a execução da faixa (chave UNIQUE em
 * contabil_integracao_execucoes) roda; as outras desistem. Sem sessão
 * aberta, sem o SQL ou com a integração incompleta, não faz nada. O timer
 * não segura o app aberto.
 */
const os = require('os');
const catalogo = require('./catalogo');
const configuracao = require('./configuracao');
const execucoes = require('./execucoes');

const VERIFICAR_A_CADA_MS = 5 * 60 * 1000;
const PRIMEIRA_EM_MS = 3 * 60 * 1000;
const FOLGA_ALEATORIA_MS = 30 * 1000;

/**
 * @param {object} p
 *   criarApi()                         cliente da API com a sessão aberta (lança sem sessão)
 *   sincronizar(api, chave, opcoes)    servico.sincronizar
 *   usuarioDoToken()                   id de quem está logado (só para o registro)
 */
function criar({
  criarApi, sincronizar, usuarioDoToken = () => null,
  agora = () => Date.now(), definirTimer = setTimeout, limparTimer = clearTimeout,
  maquina = os.hostname(), log = console, sorteio = Math.random,
  verificarACadaMs = VERIFICAR_A_CADA_MS, primeiraEmMs = PRIMEIRA_EM_MS
}) {
  let ativa = false;
  let rodando = false;
  let timer = null;
  const ultimaFaixa = new Map();

  /** Uma verificação: roda o que está na hora. Devolve o que aconteceu com cada integração. */
  async function verificar() {
    if (rodando) return { situacao: 'ocupada' };
    rodando = true;
    const saida = {};
    try {
      let api;
      try {
        api = criarApi();
      } catch (_) {
        return { situacao: 'sem_sessao' };
      }
      const linhas = await configuracao.carregar(api).catch(() => null);
      if (!linhas) return { situacao: 'sql_pendente' };
      for (const chave of catalogo.CHAVES) {
        const def = catalogo.definicao(chave);
        const linha = linhas.get(chave);
        if (!def.automatica || !linha?.ativa || !linha?.automatica) { saida[chave] = 'desligada'; continue; }
        const intervalo = Math.min(def.intervalo.max, Math.max(def.intervalo.min, Number(linha.intervalo_min) || def.intervalo.padrao));
        const faixa = execucoes.faixaDe(agora(), intervalo);
        if (ultimaFaixa.get(chave) === faixa) { saida[chave] = 'ja_tentada'; continue; }
        ultimaFaixa.set(chave, faixa);
        try {
          const r = await sincronizar(api, chave, { tipo: 'automatica', chaveExecucao: `${chave}:auto:${intervalo}:${faixa}`, usuarioId: usuarioDoToken() });
          saida[chave] = r?.situacao === 'outra_maquina' ? 'outra_maquina' : (r?.situacao || 'rodou');
        } catch (e) {
          // Incompleta (409 com pendências) ou falha do serviço: fica no registro e no "último erro"; tenta na próxima faixa.
          saida[chave] = e?.extra?.pendencias ? 'incompleta' : 'erro';
          log?.warn?.(`[contabilidade] busca automática ${chave} não rodou:`, e?.message || e);
        }
      }
      // Arrumação: o registro guarda só os últimos 30 dias.
      try {
        const r = await execucoes.recentes(api, { limite: 0 });
        await execucoes.limparAntigas(api, r.todas, agora());
      } catch (_) { /* fica para a próxima */ }
      return { situacao: 'verificou', integracoes: saida };
    } finally {
      rodando = false;
    }
  }

  function agendar(atrasoMs) {
    if (!ativa) return;
    timer = definirTimer(async () => {
      timer = null;
      await verificar().catch(e => log?.warn?.('[contabilidade] agenda das integrações:', e?.message || e));
      agendar(verificarACadaMs + Math.floor(sorteio() * FOLGA_ALEATORIA_MS));
    }, atrasoMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return {
    iniciar() {
      if (ativa) return false;
      ativa = true;
      agendar(primeiraEmMs + Math.floor(sorteio() * FOLGA_ALEATORIA_MS));
      return true;
    },
    parar() {
      ativa = false;
      if (timer) limparTimer(timer);
      timer = null;
    },
    verificar,
    get ativa() { return ativa; },
    maquina
  };
}

let instancia = null;

/** Liga a agenda com as peças reais do app (uma vez só). */
function iniciarNoApp() {
  if (instancia) return instancia;
  const { createApiClient } = require('../../apiHttpClient');
  const { getToken } = require('../../tokenStore');
  const servico = require('./servico').criar();
  const usuarioDoToken = () => {
    try {
      const parte = String(getToken() || '').split('.')[1];
      if (!parte) return null;
      const p = JSON.parse(Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      return p.id ?? p.userId ?? p.sub ?? null;
    } catch (_) {
      return null;
    }
  };
  instancia = criar({
    criarApi: () => {
      if (!getToken()) throw new Error('sem sessão');
      return createApiClient();
    },
    sincronizar: (api, chave, opcoes) => servico.sincronizar(api, chave, opcoes),
    usuarioDoToken
  });
  instancia.iniciar();
  return instancia;
}

module.exports = { VERIFICAR_A_CADA_MS, PRIMEIRA_EM_MS, criar, iniciarNoApp };
