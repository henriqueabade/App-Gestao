/**
 * Conciliação automática — fase F: a rede de segurança do webhook.
 *
 * O aviso do BB (webhook) chega na API e fica na fila; se ele se perder, ou
 * se ninguém abrir o Financeiro, esta agenda processa a fila e consulta os
 * boletos a pagar de tempos em tempos (conciliacao.conciliar).
 *
 * Roda no processo principal do app (server.js a liga só dentro do
 * Electron). Cada máquina verifica a cada ~5 minutos; a conciliação em si
 * acontece uma vez por faixa de horário (`conciliacao_intervalo_min`, padrão
 * 60): a primeira máquina que grava a execução da faixa em
 * `cobranca_execucoes` (chave UNIQUE) roda, as outras desistem. Sem sessão
 * aberta, sem a coluna/tabela da fase F ou com a automática desligada na
 * Configuração de cobrança, não faz nada. O timer não segura o app aberto.
 */
const os = require('os');
const execucoes = require('./execucoes');

const VERIFICAR_A_CADA_MS = 5 * 60 * 1000;
const PRIMEIRA_EM_MS = 2 * 60 * 1000;
const FOLGA_ALEATORIA_MS = 30 * 1000;
const INTERVALO_MIN = 15;
const INTERVALO_MAX = 720;

const intervaloDe = cfg => Math.min(INTERVALO_MAX, Math.max(INTERVALO_MIN, Number(cfg?.conciliacao_intervalo_min) || 60));

/**
 * @param {object} p
 *   criarApi()              cliente da API com a sessão aberta (lança sem sessão)
 *   carregarCfg(api)        a configuração de cobrança (linha 1)
 *   conciliar({ api, cfg, usuarioId })  a conciliação inteira
 *   usuarioDoToken()        id de quem está logado (só para o registro)
 */
function criar({
  criarApi, carregarCfg, conciliar, usuarioDoToken = () => null,
  agora = () => Date.now(), definirTimer = setTimeout, limparTimer = clearTimeout,
  maquina = os.hostname(), log = console, sorteio = Math.random,
  verificarACadaMs = VERIFICAR_A_CADA_MS, primeiraEmMs = PRIMEIRA_EM_MS
}) {
  let ativa = false;
  let rodando = false;
  let timer = null;
  let ultimaFaixa = null;

  /** Uma verificação: decide se esta máquina concilia agora. Devolve o que aconteceu. */
  async function verificar() {
    if (rodando) return { situacao: 'ocupada' };
    rodando = true;
    try {
      let api;
      try {
        api = criarApi();
      } catch (_) {
        return { situacao: 'sem_sessao' };
      }
      const cfg = await Promise.resolve(carregarCfg(api)).catch(() => null);
      if (!cfg) return { situacao: 'sem_configuracao' };
      if (!Object.prototype.hasOwnProperty.call(cfg, 'conciliacao_automatica')) return { situacao: 'sql_pendente' };
      if (cfg.conciliacao_automatica === false) return { situacao: 'desligada' };

      const intervalo = intervaloDe(cfg);
      const faixa = execucoes.faixaDe(agora(), intervalo);
      if (faixa === ultimaFaixa) return { situacao: 'ja_tentada', faixa };
      ultimaFaixa = faixa;

      const usuarioId = usuarioDoToken();
      const execucao = await execucoes.iniciar(api, { tipo: 'conciliacao_automatica', chave: `auto:${intervalo}:${faixa}`, maquina, usuarioId });
      if (!execucao || execucao.sem_tabela) return { situacao: 'sql_pendente' };
      if (execucao.ocupada) return { situacao: 'outra_maquina', faixa };

      let saida;
      try {
        const resultado = await conciliar({ api, cfg, usuarioId });
        await execucoes.concluir(api, execucao, { resultado });
        saida = { situacao: 'rodou', faixa, resultado };
      } catch (e) {
        await execucoes.concluir(api, execucao, { erro: e?.message || String(e) }).catch(() => {});
        saida = { situacao: 'erro', faixa, erro: e?.message || String(e) };
      }
      // Arrumação: o registro das execuções guarda só os últimos 30 dias.
      try {
        const r = await execucoes.recentes(api, 0);
        await execucoes.limparAntigas(api, r.todas, agora());
      } catch (_) { /* fica para a próxima */ }
      return saida;
    } catch (e) {
      log?.warn?.('[cobranca] conciliação automática não rodou:', e?.message || e);
      return { situacao: 'erro', erro: e?.message || String(e) };
    } finally {
      rodando = false;
    }
  }

  function agendar(atrasoMs) {
    if (!ativa) return;
    timer = definirTimer(async () => {
      timer = null;
      await verificar();
      agendar(verificarACadaMs + Math.floor(sorteio() * FOLGA_ALEATORIA_MS));
    }, atrasoMs);
    // Não segura o processo aberto (fechar o app não espera a agenda).
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
    get ativa() { return ativa; }
  };
}

let instancia = null;

/** Liga a agenda com as peças reais do app (uma vez só). */
function iniciarNoApp() {
  if (instancia) return instancia;
  const { createApiClient } = require('../apiHttpClient');
  const { getToken } = require('../tokenStore');
  const configuracao = require('./configuracaoCobranca');
  const controller = require('../cobrancaController');
  instancia = criar({
    criarApi: () => {
      if (!getToken()) throw new Error('sem sessão');
      return createApiClient();
    },
    carregarCfg: api => configuracao.carregar(api, { forcar: true }),
    conciliar: ({ api, cfg, usuarioId }) => controller.conciliarEmSegundoPlano({ api, cfg, usuarioId }),
    usuarioDoToken: () => controller.usuarioDaRequisicao({ headers: { authorization: `Bearer ${getToken() || ''}` } })
  });
  instancia.iniciar();
  return instancia;
}

module.exports = { VERIFICAR_A_CADA_MS, PRIMEIRA_EM_MS, INTERVALO_MIN, INTERVALO_MAX, intervaloDe, criar, iniciarNoApp };
