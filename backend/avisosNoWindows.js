/**
 * Os avisos do sino no Windows, com o programa em segundo plano (01/10/2026,
 * pedido do dono).
 *
 * Desde o login, este aparelho fica "do último usuário que entrou": mesmo
 * depois de sair do programa ou de a sessão vencer (12h), ele continua
 * perguntando pelos avisos dessa pessoa e o main.js os mostra no canto da
 * tela (backend/janelaDeAviso.js) — só quando o programa NÃO está na frente.
 *
 * Como pergunta:
 *   1. pelo token DO APARELHO (só dos avisos, 90 dias, renovado sozinho —
 *      Santissimo-db-API/avisos/dispositivo.js; em DEV, a cópia
 *      backend/avisosDoDispositivo.js contra o banco local). Guardado
 *      cifrado pelo Windows (safeStorage) em userData/avisos-windows.json;
 *   2. sem ele (API ainda sem as rotas novas, ou o token recusado), pela
 *      sessão do programa enquanto ela vale — o mesmo /api/notificacoes do
 *      sino.
 * Os lembretes e atrasos das tarefas nascem quando alguém pergunta (antes,
 * só o sino perguntava): o aparelho pergunta também.
 *
 * O que já apareceu não aparece de novo: `vistos` guarda, por usuário, o
 * maior aviso já visto. Na primeira vez de cada usuário só marca (não despeja
 * o histórico inteiro na tela). Nada aqui depende do Electron (testável).
 */

const crypto = require('crypto');
const R = require('./tarefasRegras');
const { partesDaMensagem } = require('./avisosEnvolvidos');

const INTERVALO_MS = 20 * 1000;
const VOLTAS_PARA_LEMBRETES = 3;
const TENTAR_DE_NOVO_MS = 30 * 60 * 1000;

const lista = r => (Array.isArray(r) ? r : []);

/** Um aviso da API (linha crua) ou do sino (já separado) → o mesmo formato. Pura. */
function normalizarAviso(n) {
  if (!n || n.id === undefined || n.id === null) return null;
  const separado = Array.isArray(n.notas) || Array.isArray(n.mudancas);
  const partes = separado
    ? { mensagem: n.mensagem || '', mudancas: lista(n.mudancas), notas: lista(n.notas) }
    : partesDaMensagem(n.mensagem);
  return {
    id: Number(n.id), tipo: n.tipo || 'aviso', titulo: n.titulo || 'Aviso', ...partes,
    origem: n.origem || null, registro_id: n.registro_id ?? null, item_id: n.item_id ?? null,
    comentario_id: n.comentario_id ?? null, autor: n.autor || null,
    lida: n.lida !== undefined ? Boolean(n.lida) : Boolean(n.lida_em), criado_em: n.criado_em || null
  };
}

/** Os que vão para a janela: não lidos e mais novos que o último já visto, do mais antigo ao mais novo. Pura. */
function novosParaMostrar(avisos = [], ultimoVisto = 0) {
  return lista(avisos).filter(a => a && !a.lida && a.id > Number(ultimoVisto || 0)).sort((a, b) => a.id - b.id);
}

/** DEV: um assinador que vale só nesta execução (como o login local). */
function criarAssinadorLocal() {
  const segredo = crypto.randomBytes(32);
  const assinar = (dados, segundos) => {
    const corpo = Buffer.from(JSON.stringify({ ...dados, exp: Math.floor(Date.now() / 1000) + segundos })).toString('base64url');
    return `${corpo}.${crypto.createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
  };
  const verificar = token => {
    const [corpo, assinatura] = String(token || '').split('.');
    const esperado = crypto.createHmac('sha256', segredo).update(String(corpo)).digest();
    const recebido = Buffer.from(String(assinatura || ''), 'base64url');
    if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) throw new Error('assinatura inválida');
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    if (dados.exp <= Date.now() / 1000) throw new Error('vencido');
    return dados;
  };
  return { assinar, verificar };
}

/**
 * @param {object} o
 * @param {string} o.arquivo           userData/avisos-windows.json
 * @param {{cifrar, decifrar}} [o.cofre] safeStorage (sem ele, o token fica só na memória)
 * @param {string} o.apiBase           a API remota (PROD)
 * @param {boolean} [o.emDev]          BANCO=DEV: `local` faz o papel da API
 * @param {{modulo, verificarSessao}} [o.local]
 * @param {Function} [o.fetch]
 * @param {() => ({token, valido, usuarioId})} [o.sessao]   o token da sessão do programa
 * @param {() => string|null} [o.enderecoLocal]             o servidor interno (http://127.0.0.1:porta)
 */
/** Qual computador é este, para a lista que o Sup Admin vê em Usuários. */
function esteComputador(os = require('os')) {
  let usuarioWindows = null;
  try { usuarioWindows = os.userInfo().username || null; } catch (_) { /* sem usuário do sistema */ }
  return { computador: os.hostname() || null, usuario_windows: usuarioWindows };
}

function criarAvisosNoWindows({
  arquivo, fs = require('fs'), cofre = null, apiBase = '', emDev = false, local = null,
  fetch = globalThis.fetch, sessao = () => null, enderecoLocal = () => null, agora = () => new Date(),
  aparelho = esteComputador()
} = {}) {
  let estado = lerEstado();
  let tokenEmMemoria = null;
  let semRotaNaApi = false;
  let ultimaTentativa = 0;
  let volta = 0;

  // `cancelado`: o Sup Admin cancelou este computador (Usuários › Computadores).
  // Ele fica quieto até a pessoa ENTRAR de novo no programa — não se registra
  // sozinho de novo pela sessão aberta.
  function lerEstado() {
    try {
      const e = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
      return {
        usuario: e.usuario || null, token: e.token || null, cancelado: Boolean(e.cancelado),
        vistos: e.vistos && typeof e.vistos === 'object' ? e.vistos : {}
      };
    } catch (_) {
      return { usuario: null, token: null, cancelado: false, vistos: {} };
    }
  }

  function gravarEstado() {
    try {
      fs.mkdirSync(require('path').dirname(arquivo), { recursive: true });
      fs.writeFileSync(arquivo, JSON.stringify(estado), 'utf8');
    } catch (err) {
      console.warn('[avisos-windows] estado não gravado:', err?.message || err);
    }
  }

  function tokenDoAparelho() {
    if (tokenEmMemoria) return tokenEmMemoria;
    if (!estado.token || !cofre) return null;
    try { return cofre.decifrar(estado.token); } catch (_) { return null; }
  }

  function guardarToken(token) {
    tokenEmMemoria = null;
    estado.token = null;
    if (token) {
      try {
        if (!cofre) throw new Error('sem cofre');
        estado.token = cofre.cifrar(token);
      } catch (_) {
        tokenEmMemoria = token; // sem cifrar, só na memória: nunca em texto no disco
      }
    }
    gravarEstado();
  }

  async function naApi(metodo, caminho, token, corpo) {
    const resposta = await fetch(`${apiBase}${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    return { status: resposta.status, corpo: await resposta.json().catch(() => null) };
  }

  async function noAparelho(acao, token, corpo) {
    if (emDev) {
      if (acao === 'listar') return local.modulo.listar(token);
      if (acao === 'tarefas') return local.modulo.tarefas(token);
      return local.modulo.lembretes(token, corpo);
    }
    const rota = { listar: ['GET', '/avisos/meus'], tarefas: ['GET', '/avisos/tarefas'], lembretes: ['POST', '/avisos/lembretes'] }[acao];
    return naApi(rota[0], rota[1], token, corpo);
  }

  /** Pede o token do aparelho com o token da sessão. Devolve true se ficou com ele. */
  async function emitir(tokenDaSessao) {
    ultimaTentativa = agora().getTime();
    if (!tokenDaSessao) return false;
    try {
      const r = emDev
        ? await local.modulo.emitir(local.verificarSessao(tokenDaSessao), aparelho)
        : await naApi('POST', '/avisos/dispositivo', tokenDaSessao, aparelho);
      if (r.status === 404) { semRotaNaApi = true; return false; }
      if (r.status === 200 && r.corpo?.token) {
        semRotaNaApi = false;
        guardarToken(r.corpo.token);
        return true;
      }
    } catch (err) {
      console.warn('[avisos-windows] token do aparelho não emitido:', err?.message || err);
    }
    return false;
  }

  /**
   * Depois do login: o aparelho passa a ser desta pessoa (outra pessoa que
   * entra troca o dono e o token) e pede o token do aparelho.
   */
  async function lembrarUsuario(usuario, tokenDaSessao) {
    if (!usuario?.id) return false;
    const trocou = !estado.usuario || String(estado.usuario.id) !== String(usuario.id);
    estado.usuario = { id: Number(usuario.id), nome: usuario.nome || null };
    // Entrar de novo é o que religa um computador cancelado.
    estado.cancelado = false;
    if (trocou) guardarToken(null); else gravarEstado();
    return emitir(tokenDaSessao);
  }

  /** Desligar os avisos do Windows: o aparelho esquece o usuário e o token. */
  function esquecer() {
    estado = { usuario: null, token: null, cancelado: false, vistos: estado.vistos };
    tokenEmMemoria = null;
    gravarEstado();
  }

  function sessaoDoDono() {
    const s = sessao() || {};
    const base = enderecoLocal();
    return s.valido && s.token && base && estado.usuario && String(s.usuarioId) === String(estado.usuario.id) ? { ...s, base } : null;
  }

  /** O Sup Admin cancelou este computador: sem token e quieto até um login novo. */
  function marcarCancelado() {
    estado.cancelado = true;
    guardarToken(null);
  }

  /** Os avisos do dono deste aparelho, ou null quando não há como perguntar. */
  async function buscar() {
    if (!estado.usuario?.id || estado.cancelado) return null;
    const token = tokenDoAparelho();
    if (token && !semRotaNaApi) {
      try {
        const r = await noAparelho('listar', token);
        if (r.status === 200) {
          if (r.corpo?.token_novo) guardarToken(r.corpo.token_novo);
          return lista(r.corpo?.itens).map(normalizarAviso).filter(Boolean);
        }
        if (r.corpo?.cancelado) { marcarCancelado(); return null; }
        if (r.status === 401 || r.status === 403) guardarToken(null);
        if (r.status === 404) semRotaNaApi = true;
      } catch (err) {
        console.warn('[avisos-windows] sem resposta da API:', err?.message || err);
        return null;
      }
    }
    // Sem o token do aparelho: pela sessão do programa, se ainda vale e é do dono.
    const s = sessaoDoDono();
    if (!s) return null;
    // A sessão vale e o aparelho está sem token: de tempo em tempo, tenta de
    // novo (a API pode ter sido atualizada depois do login).
    if (!token && agora().getTime() - ultimaTentativa > TENTAR_DE_NOVO_MS) await emitir(s.token);
    try {
      const resposta = await fetch(`${s.base}/api/notificacoes`, { headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/json' } });
      if (!resposta.ok) return null;
      const dados = await resposta.json();
      return lista(dados?.itens).map(normalizarAviso).filter(Boolean);
    } catch (_) {
      return null;
    }
  }

  /** Lembretes e atrasos das tarefas do dono. Devolve quantos nasceram. */
  async function gerarLembretes() {
    if (!estado.usuario?.id || estado.cancelado) return 0;
    const token = tokenDoAparelho();
    try {
      if (token && !semRotaNaApi) {
        const t = await noAparelho('tarefas', token);
        if (t.corpo?.cancelado) { marcarCancelado(); return 0; }
        if (t.status !== 200) return 0;
        const devidos = R.avisosDevidos(lista(t.corpo?.tarefas), { usuarioId: estado.usuario.id, agora: agora() });
        if (!devidos.length) return 0;
        const r = await noAparelho('lembretes', token, { avisos: devidos });
        return Number(r.corpo?.gravados) || 0;
      }
      const s = sessaoDoDono();
      if (!s) return 0;
      const resposta = await fetch(`${s.base}/api/tarefas/avisos`, {
        method: 'POST', headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}'
      });
      const dados = await resposta.json().catch(() => null);
      return lista(dados?.novos).length;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Uma volta (a cada 20 s): os lembretes (a cada 3 voltas), os avisos e o
   * que é novo. `emFoco`: o programa está na frente — aí quem avisa é o sino
   * (com o som), e a janela do canto fica quieta.
   */
  async function ciclo({ emFoco = false } = {}) {
    volta += 1;
    if (volta % VOLTAS_PARA_LEMBRETES === 1) await gerarLembretes();
    const avisos = await buscar();
    if (!avisos || !estado.usuario) return { novos: [], naoLidos: null };
    const chave = String(estado.usuario.id);
    const ultimo = estado.vistos[chave];
    const maior = avisos.reduce((m, a) => Math.max(m, a.id), 0);
    const novos = ultimo === undefined ? [] : novosParaMostrar(avisos, ultimo);
    if (ultimo === undefined || maior > Number(ultimo)) {
      estado.vistos[chave] = Math.max(maior, Number(ultimo || 0));
      gravarEstado();
    }
    return { novos: emFoco ? [] : novos, naoLidos: avisos.filter(a => !a.lida).length };
  }

  return {
    lembrarUsuario, esquecer, buscar, gerarLembretes, ciclo, emitir,
    usuario: () => estado.usuario,
    temTokenDoAparelho: () => Boolean(tokenDoAparelho()),
    cancelado: () => Boolean(estado.cancelado)
  };
}

module.exports = { INTERVALO_MS, VOLTAS_PARA_LEMBRETES, normalizarAviso, novosParaMostrar, criarAssinadorLocal, esteComputador, criarAvisosNoWindows };
