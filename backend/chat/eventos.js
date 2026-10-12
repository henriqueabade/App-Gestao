// chat/eventos.js — o "ao vivo" do chat (12/10/2026): cada programa aberto
// mantém uma conexão (Server-Sent Events) e recebe na hora a mensagem nova,
// a edição, a reação, o "digitando", quem leu e a presença.
//
// Texto puro no formato do EventSource:
//   event: mensagem
//   data: {"conversa_id":3,"mensagem":{…}}
// A cada 25 s vai um comentário (": ping") para os proxies não derrubarem a
// conexão parada. Um processo só (na memória). Se a conexão não ficar de pé
// (proxy que segura a resposta), o programa cai sozinho para perguntar de
// tempos em tempos — nada se perde, só demora uns segundos.
// ------------------------------------------------------------------

function criarEventos({ intervaloMs = 25 * 1000 } = {}) {
  const clientes = new Map(); // id da conexão -> { usuarioId, res }
  let sequencia = 0;

  function escrever(res, evento, dados) {
    try {
      res.write(`event: ${evento}\ndata: ${JSON.stringify(dados ?? {})}\n\n`);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Pendura a resposta (já com os cabeçalhos de SSE). Devolve o id da conexão. */
  function adicionar(usuarioId, res) {
    sequencia += 1;
    clientes.set(sequencia, { usuarioId: String(usuarioId), res });
    return sequencia;
  }

  function remover(id) {
    clientes.delete(id);
  }

  /** Manda para as pessoas (ids). */
  function enviar(usuarioIds, evento, dados) {
    const alvo = new Set((usuarioIds || []).map(String));
    let enviados = 0;
    for (const [id, c] of clientes) {
      if (!alvo.has(c.usuarioId)) continue;
      if (escrever(c.res, evento, dados)) enviados += 1;
      else clientes.delete(id);
    }
    return enviados;
  }

  /** Manda para todo mundo conectado (a presença). */
  function enviarTodos(evento, dados) {
    let enviados = 0;
    for (const [id, c] of clientes) {
      if (escrever(c.res, evento, dados)) enviados += 1;
      else clientes.delete(id);
    }
    return enviados;
  }

  const conectados = () => new Set([...clientes.values()].map(c => c.usuarioId));

  const relogio = intervaloMs > 0 ? setInterval(() => {
    for (const [id, c] of clientes) {
      try { c.res.write(": ping\n\n"); } catch (_) { clientes.delete(id); }
    }
  }, intervaloMs) : null;
  if (relogio && relogio.unref) relogio.unref();

  return { adicionar, remover, enviar, enviarTodos, escrever, conectados, total: () => clientes.size, parar: () => relogio && clearInterval(relogio) };
}

module.exports = { criarEventos };
