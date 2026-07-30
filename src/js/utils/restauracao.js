/**
 * Regra ÚNICA de "posso restaurar este trabalho?".
 *
 * Vive num arquivo próprio porque a decisão é tomada em duas janelas
 * diferentes — a de login (ao repassar o estado) e a do dashboard (ao repô-lo).
 * Quando cada uma tinha a própria versão da regra, elas divergiam e o trabalho
 * voltava em situações que não deviam:
 *
 *  - Sair pelo menu ou fechar o app gravava estado como se fosse queda.
 *  - Um estado sem dono identificado era restaurado para QUALQUER usuário que
 *    logasse depois na mesma máquina.
 *
 * As três condições, agora no mesmo lugar:
 *  1. O fim da sessão foi uma DESCONEXÃO (queda de internet/servidor/banco ou
 *     corte pelo administrador). Saída voluntária e inatividade não contam.
 *  2. Quem está logando agora é o MESMO usuário que estava trabalhando — e isso
 *     precisa ser comprovado dos dois lados; na dúvida, não restaura.
 *  3. Estamos dentro da janela de 30 minutos.
 */
(function (global) {
  /**
   * Motivos que caracterizam desconexão involuntária.
   *  offline        — queda de internet/servidor
   *  offline-db     — banco indisponível
   *  pin            — PIN alterado/invalidado (corte administrativo)
   *  admin-disabled — acesso desativado pelo administrador
   *  admin-pending  — acesso ainda não liberado pelo administrador
   *
   * Fora daqui de propósito:
   *  logout         — o usuário escolheu sair
   *  idle-timeout   — sessão encerrada por inatividade
   *  user-removed   — o usuário deixou de existir; não há para quem restaurar
   */
  const MOTIVOS_RESTAURAVEIS = new Set([
    'offline',
    'offline-db',
    'pin',
    'admin-disabled',
    'admin-pending'
  ]);

  const JANELA_MS = 30 * 60 * 1000;

  /** Aceita objeto de usuário, JSON de usuário ou id solto. */
  function idDoUsuario(bruto) {
    if (bruto === null || bruto === undefined || bruto === '') return null;
    if (typeof bruto === 'number') return String(bruto);
    if (typeof bruto === 'object') {
      return bruto.id === undefined || bruto.id === null ? null : String(bruto.id);
    }
    const texto = String(bruto).trim();
    if (!texto) return null;
    try {
      const parseado = JSON.parse(texto);
      // `JSON.parse('7')` devolve o número 7, não um objeto: nesse caso o
      // próprio valor já é o id. Sem isto, um id solto virava "sem dono".
      if (parseado !== null && typeof parseado === 'object') {
        return parseado.id === undefined || parseado.id === null ? null : String(parseado.id);
      }
      return parseado === null || parseado === undefined ? null : String(parseado);
    } catch (_) {
      return texto;
    }
  }

  /** Dono do trabalho guardado, olhando o carimbo direto e o storage antigo. */
  function donoDoEstado(estado) {
    if (!estado) return null;
    return idDoUsuario(estado.usuarioId) ?? idDoUsuario(estado.storage?.user);
  }

  /**
   * @returns {{ ok: boolean, causa: string }}
   *   causa: 'ok' | 'sem-estado' | 'saida-normal' | 'expirado' | 'sem-dono'
   *          | 'sem-usuario-atual' | 'outro-usuario'
   *
   * A causa importa: 'outro-usuario' significa que o arquivo deve ser
   * PRESERVADO — ele ainda pertence a quem caiu, que pode logar em seguida.
   */
  function podeRestaurar(estado, usuarioAtual) {
    if (!estado) return { ok: false, causa: 'sem-estado' };

    if (!MOTIVOS_RESTAURAVEIS.has(String(estado.motivo || ''))) {
      return { ok: false, causa: 'saida-normal' };
    }

    if (estado.salvoEm && Date.now() - estado.salvoEm > JANELA_MS) {
      return { ok: false, causa: 'expirado' };
    }

    const dono = donoDoEstado(estado);
    if (dono === null) return { ok: false, causa: 'sem-dono' };

    const atual = idDoUsuario(usuarioAtual);
    if (atual === null) return { ok: false, causa: 'sem-usuario-atual' };

    if (dono !== atual) return { ok: false, causa: 'outro-usuario' };

    return { ok: true, causa: 'ok' };
  }

  global.RestauracaoTrabalho = {
    MOTIVOS_RESTAURAVEIS,
    JANELA_MS,
    idDoUsuario,
    donoDoEstado,
    podeRestaurar
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).RestauracaoTrabalho;
}
