// chat/presenca.js — Online, Ausente, Ocupado ou Offline (12/10/2026).
//
// A mesma régua da tela de Usuários (decisão do dono, 02/10/2026), com o que
// o chat sabe a mais:
//   online   o programa aberto com a sessão (o chat ligado ao vivo) e a
//            pessoa mexendo nele;
//   ausente  o programa aberto, mas parado há 5 minutos (ou a pessoa escolheu
//            "Ausente"); ou o programa rodando só perto do relógio, sem sessão
//            (o sinal de minuto dos avisos do Windows);
//   ocupado  a pessoa escolheu "Ocupado" (não perturbe) e está com o programa aberto;
//   offline  programa fechado — ou a pessoa escolheu "Invisível".
//
// Fica na memória da API (um processo só). Cair a conexão por um instante
// (a tela recarregou) não vira "Offline": espera alguns segundos antes.
// ------------------------------------------------------------------

const ESTADOS = ["online", "ausente", "ocupado", "offline"];

function criarPresenca({ agora = () => Date.now() } = {}) {
  const conexoes = new Map();   // id -> quantas abertas
  const atividade = new Map();  // id -> true (mexendo) / false (parado)
  const vistoEm = new Map();    // id -> ms da última vez com o programa aberto

  const k = id => String(id);

  /** Abriu uma conexão; devolve true se era a primeira (passou a estar conectado). */
  function conectar(id) {
    const n = (conexoes.get(k(id)) || 0) + 1;
    conexoes.set(k(id), n);
    if (n === 1) atividade.set(k(id), true);
    vistoEm.set(k(id), agora());
    return n === 1;
  }

  /** Fechou uma conexão; devolve true se era a última. */
  function desconectar(id) {
    const n = Math.max(0, (conexoes.get(k(id)) || 0) - 1);
    if (n) conexoes.set(k(id), n);
    else conexoes.delete(k(id));
    vistoEm.set(k(id), agora());
    return n === 0;
  }

  const conectado = id => (conexoes.get(k(id)) || 0) > 0;

  /** Mexendo (true) ou parado (false). Devolve true se mudou. */
  function marcarAtividade(id, mexendo) {
    const antes = atividade.get(k(id));
    atividade.set(k(id), Boolean(mexendo));
    if (conectado(id)) vistoEm.set(k(id), agora());
    return antes !== Boolean(mexendo);
  }

  /**
   * O estado que os OUTROS veem. `statusManual`: o que a pessoa escolheu
   * (automatico, ocupado, ausente, invisivel). Pura em relação ao banco.
   */
  function estado(id, { statusManual = "automatico", programaRodando = false } = {}) {
    if (statusManual === "invisivel") return "offline";
    if (conectado(id)) {
      if (statusManual === "ocupado") return "ocupado";
      if (statusManual === "ausente") return "ausente";
      return atividade.get(k(id)) === false ? "ausente" : "online";
    }
    return programaRodando ? "ausente" : "offline";
  }

  /** Quando esteve com o programa aberto pela última vez (ms) — "visto há…". */
  const ultimaVez = id => vistoEm.get(k(id)) || null;

  return { conectar, desconectar, conectado, marcarAtividade, estado, ultimaVez };
}

module.exports = { criarPresenca, ESTADOS };
