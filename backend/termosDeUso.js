// backend/termosDeUso.js — o aceite dos Termos de Uso e da Política de
// Privacidade (02/10/2026, pedido do dono).
//
// O texto mora em src/js/utils/termos-documentos.js (a tela e o backend leem
// o mesmo arquivo). Aqui ficam as regras:
//   - "Aceito" = a pessoa aceitou a versão VIGENTE dos dois documentos;
//     qualquer outra coisa é "Pendente" (usuário antigo, criado pelo
//     administrador ou versão nova do texto).
//   - A caixa de aceite só aparece para quem está pendente E recebeu o pedido
//     do Sup Admin (botão em Usuários) — termos_solicitados_em.
//   - Cada aceite ou recusa vira duas linhas (uma por documento) em
//     usuarios_termos_aceites, com a versão e a impressão digital (sha256) do
//     texto, e o texto de cada versão fica em termos_versoes. As duas tabelas
//     só recebem linhas novas (sql/usuarios_termos.sql).
//   - Recusar não exclui: desativa o acesso (status 'aguardando_aprovacao').
// ------------------------------------------------------------------

const crypto = require('crypto');
const os = require('os');
const Documentos = require('../src/js/utils/termos-documentos');

const COLUNAS = [
  'termos_versao', 'privacidade_versao', 'termos_aceitos_em',
  'termos_solicitados_em', 'termos_solicitados_por', 'termos_recusados_em'
];
const TABELAS = ['termos_versoes', 'usuarios_termos_aceites'];
const SEM_SQL = 'O aceite dos termos ainda não pode ser registrado: rode sql/usuarios_termos.sql e reinicie a API do banco.';
const STATUS_DESATIVADO = 'aguardando_aprovacao';

function erro(status, mensagem, extra = {}) {
  return Object.assign(new Error(mensagem), { status, ...extra });
}

function sha256(texto) {
  return crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');
}

let vigentesEmCache = null;

/** Os dois documentos vigentes, com o texto corrido e a impressão digital. */
function vigentes() {
  if (!vigentesEmCache) {
    vigentesEmCache = Documentos.ORDEM.map(chave => {
      const doc = Documentos.documento(chave);
      const texto = Documentos.textoPlano(chave);
      return { documento: chave, titulo: doc.titulo, versao: doc.versao, vigencia: doc.vigencia, texto, hash_sha256: sha256(texto) };
    });
  }
  return vigentesEmCache;
}

/** { termos_de_uso: '1.0', politica_de_privacidade: '1.0' } */
function versoesVigentes() {
  return Object.fromEntries(vigentes().map(v => [v.documento, v.versao]));
}

/** A pessoa aceitou a versão vigente dos dois documentos? Pura. */
function aceitou(usuario) {
  const v = versoesVigentes();
  return Boolean(usuario?.termos_aceitos_em)
    && String(usuario.termos_versao || '') === v.termos_de_uso
    && String(usuario.privacidade_versao || '') === v.politica_de_privacidade;
}

/** Pendente e com o pedido do Sup Admin: é quando a caixa de aceite aparece. Pura. */
function precisaAceitar(usuario) {
  return Boolean(usuario) && !aceitou(usuario) && Boolean(usuario.termos_solicitados_em);
}

/** O resumo que a tela de Usuários mostra na coluna Termos. Pura. */
function situacaoDe(usuario) {
  const ok = aceitou(usuario);
  return {
    termos_situacao: ok ? 'aceito' : 'pendente',
    termos_solicitado: !ok && Boolean(usuario?.termos_solicitados_em),
    termos_aceitos_em: ok ? usuario.termos_aceitos_em : null,
    termos_solicitados_em: !ok ? usuario?.termos_solicitados_em || null : null,
    termos_recusados_em: !ok ? usuario?.termos_recusados_em || null : null,
    termos_versao: usuario?.termos_versao || null,
    privacidade_versao: usuario?.privacidade_versao || null
  };
}

/** A tela mandou as versões que mostrou; têm de ser as vigentes. Pura. */
function conferirVersoes(informadas) {
  const v = versoesVigentes();
  const iguais = informadas && typeof informadas === 'object'
    && Object.keys(v).every(chave => String(informadas[chave] || '') === v[chave]);
  if (!iguais) {
    throw erro(409, 'Os documentos foram atualizados. Feche e abra o programa para ler a versão nova.', { code: 'TERMOS_VERSAO' });
  }
}

// ---------------------------------------------------------------------------
// O banco tem as tabelas e colunas? A API remota lê o esquema quando sobe e
// descarta em silêncio o que não conhece: sem o SQL (ou sem reiniciar a API)
// o aceite "gravaria" e não ficaria em lugar nenhum. Confere em /api/tabelas;
// achado, fica achado. Sem /api/tabelas (banco DEV), pergunta as colunas.
// ---------------------------------------------------------------------------
let esquema = { ok: null, em: 0 };

async function temEsquema(api, agora = Date.now()) {
  if (esquema.ok === true) return true;
  if (esquema.ok === false && agora - esquema.em < 60 * 1000) return false;
  let ok = false;
  try {
    if (typeof api.getAvailableColumns === 'function') {
      const colunas = new Set(await api.getAvailableColumns('usuarios'));
      const aceites = await api.getAvailableColumns('usuarios_termos_aceites');
      const versoes = await api.getAvailableColumns('termos_versoes');
      ok = COLUNAS.every(c => colunas.has(c)) && aceites.length > 0 && versoes.length > 0;
    } else {
      const r = await api.get('/api/tabelas');
      const tabelas = new Map((Array.isArray(r?.tabelas) ? r.tabelas : []).map(t => [t?.tabela, t?.colunas || []]));
      ok = TABELAS.every(t => tabelas.has(t)) && COLUNAS.every(c => (tabelas.get('usuarios') || []).includes(c));
    }
  } catch (_) {
    ok = false;
  }
  esquema = { ok, em: agora };
  return ok;
}

async function exigirEsquema(api) {
  if (!(await temEsquema(api))) throw erro(409, SEM_SQL, { code: 'TERMOS_SQL' });
}

/** Guarda o texto de cada versão vigente (uma vez). Versão igual com texto diferente é erro. */
async function garantirVersoes(api) {
  for (const v of vigentes()) {
    const achadas = await api.get('/api/termos_versoes', { query: { documento: v.documento, versao: v.versao } });
    const atual = (Array.isArray(achadas) ? achadas : []).find(l => l?.documento === v.documento && String(l?.versao) === v.versao);
    if (atual) {
      conferirTexto(atual, v);
      continue;
    }
    try {
      await api.post('/api/termos_versoes', {
        documento: v.documento, versao: v.versao, titulo: v.titulo, hash_sha256: v.hash_sha256, texto: v.texto
      });
    } catch (err) {
      // Duas pessoas aceitando na mesma hora: a outra gravou primeiro.
      const depois = await api.get('/api/termos_versoes', { query: { documento: v.documento, versao: v.versao } }).catch(() => []);
      const gravada = (Array.isArray(depois) ? depois : []).find(l => l?.documento === v.documento && String(l?.versao) === v.versao);
      if (!gravada) throw err;
      conferirTexto(gravada, v);
    }
  }
}

let versoesRegistradas = false;

/**
 * Registra as versões vigentes na primeira sessão aberta com esta versão do
 * programa (GET /usuarios/me/termos chama a cada abertura; depois da primeira
 * vez não vai mais ao banco). O cadastro da tela de login é anônimo e, por
 * isso, só aceita versão que JÁ esteja registrada: é este registro que o
 * libera. Falha só vai para o log.
 */
async function registrarVersoesUmaVez(api) {
  if (versoesRegistradas) return true;
  try {
    await garantirVersoes(api);
    versoesRegistradas = true;
  } catch (err) {
    console.warn('[termos] versões dos documentos não registradas agora:', err?.message || err);
  }
  return versoesRegistradas;
}

function conferirTexto(gravada, v) {
  if (String(gravada.hash_sha256 || '').trim() !== v.hash_sha256) {
    throw erro(409, `O texto de "${v.titulo}" mudou sem mudar a versão (${v.versao}). Atualize o programa.`, { code: 'TERMOS_TEXTO' });
  }
}

function computadorAtual() {
  try {
    const usuario = os.userInfo().username;
    return `${os.hostname()}${usuario ? ` (${usuario})` : ''}`.slice(0, 160);
  } catch (_) {
    return null;
  }
}

function versaoDoApp() {
  try {
    return String(require('../package.json').version || '').slice(0, 30) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Grava a decisão (uma linha por documento) e o resumo no usuário.
 * `decisao`: 'aceito' | 'recusado'; `origem`: 'cadastro' | 'solicitacao'.
 * Devolve os campos gravados no usuário.
 */
async function registrar(api, usuario, { decisao, origem = 'solicitacao', agora = new Date() } = {}) {
  if (!usuario?.id) throw erro(400, 'Usuário não identificado.');
  if (!['aceito', 'recusado'].includes(decisao)) throw erro(400, 'Decisão inválida.');
  await exigirEsquema(api);
  await garantirVersoes(api);

  const computador = computadorAtual();
  const versaoApp = versaoDoApp();
  for (const v of vigentes()) {
    await api.post('/api/usuarios_termos_aceites', {
      usuario_id: Number(usuario.id),
      usuario_nome: usuario.nome ? String(usuario.nome).slice(0, 200) : null,
      usuario_email: usuario.email ? String(usuario.email).slice(0, 200) : null,
      documento: v.documento,
      versao: v.versao,
      hash_sha256: v.hash_sha256,
      decisao,
      origem,
      solicitado_por: usuario.termos_solicitados_por ?? null,
      computador,
      versao_app: versaoApp
    });
  }

  const quando = agora.toISOString();
  const v = versoesVigentes();
  const campos = decisao === 'aceito'
    ? {
        termos_versao: v.termos_de_uso,
        privacidade_versao: v.politica_de_privacidade,
        termos_aceitos_em: quando,
        termos_solicitados_em: null,
        termos_recusados_em: null
      }
    // O pedido continua de pé: reativado pelo administrador, a pessoa volta a
    // ver a caixa de aceite ao entrar.
    : { termos_recusados_em: quando, status: STATUS_DESATIVADO };
  await api.put(`/api/usuarios/${usuario.id}`, campos);
  return campos;
}

/** O Sup Admin pede o aceite: a caixa aparece para a pessoa ao entrar. */
async function solicitar(api, usuario, solicitanteId, agora = new Date()) {
  if (!usuario?.id) throw erro(404, 'Usuário não encontrado.');
  await exigirEsquema(api);
  if (aceitou(usuario)) throw erro(409, 'Este usuário já aceitou a versão atual dos termos.');
  const campos = {
    termos_solicitados_em: agora.toISOString(),
    termos_solicitados_por: Number(solicitanteId) || null
  };
  await api.put(`/api/usuarios/${usuario.id}`, campos);
  return campos;
}

// ---------------------------------------------------------------------------
// Trava do backend local: enquanto a pessoa não responde à caixa de aceite,
// as rotas /api respondem 423 (menos as que a própria caixa usa). A marca é
// posta quando a tela pergunta "tenho aceite pendente?" e tirada no aceite —
// assim a trava nunca dispara antes de a caixa estar na tela.
// ---------------------------------------------------------------------------
const aguardandoAceite = new Set();
const LIVRES_DA_TRAVA = [
  /^\/usuarios\/me(\/termos(\/(aceitar|recusar))?)?\/?$/,
  /^\/permissoes\/efetivas\/?$/
];

function marcarAguardando(usuarioId, aguardando) {
  const chave = String(usuarioId ?? '');
  if (!chave) return;
  if (aguardando) aguardandoAceite.add(chave);
  else aguardandoAceite.delete(chave);
}

function estaAguardando(usuarioId) {
  return aguardandoAceite.has(String(usuarioId ?? ''));
}

/** Middleware do /api (server.js). `usuarioDaRequisicao` devolve o id de quem chama. */
function travaDoAceite(usuarioDaRequisicao) {
  return (req, res, next) => {
    if (!aguardandoAceite.size) return next();
    if (LIVRES_DA_TRAVA.some(re => re.test(req.path))) return next();
    if (!estaAguardando(usuarioDaRequisicao(req))) return next();
    return res.status(423).json({
      error: 'Aceite os Termos de Uso e a Política de Privacidade para continuar.',
      code: 'TERMOS_PENDENTES'
    });
  };
}

module.exports = {
  COLUNAS,
  SEM_SQL,
  STATUS_DESATIVADO,
  sha256,
  vigentes,
  versoesVigentes,
  aceitou,
  precisaAceitar,
  situacaoDe,
  conferirVersoes,
  temEsquema,
  exigirEsquema,
  garantirVersoes,
  registrarVersoesUmaVez,
  registrar,
  solicitar,
  marcarAguardando,
  estaAguardando,
  travaDoAceite,
  esquecerEsquema: () => { esquema = { ok: null, em: 0 }; versoesRegistradas = false; },
  esquecerAguardando: () => aguardandoAceite.clear()
};
