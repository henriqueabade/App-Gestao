/**
 * Segredos no banco (tabela segredos_app, sql/segredos_app.sql): o certificado
 * A1 com a senha, a senha do SMTP — o que precisa valer em TODAS as máquinas
 * sem ninguém cadastrar de novo. Cifrados com a chave mestra
 * (chaveMestra.js); sem a chave neste computador o banco é ilegível e o app
 * cai no cofre local (segredoLocal.js).
 *
 * O valor é sempre um JSON: `{ pfxBase64, senha, nomeArquivo }` para o
 * certificado, `{ senha }` para o SMTP.
 */
const chaveMestra = require('./chaveMestra');

const TABELA = '/api/segredos_app';
const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

function criar({ env = process.env } = {}) {
  const obterChave = () => chaveMestra.carregar(env);

  async function linhaDe(api, nome) {
    const linhas = await api.get(TABELA, { query: { nome } }).then(lista).catch(() => []);
    return linhas.find(l => l && l.nome === nome) || null;
  }

  /** { valor (objeto), atualizadoEm } | null; `erro` quando existe mas não abre. */
  async function ler(api, nome) {
    const linha = await linhaDe(api, nome);
    if (!linha) return null;
    const chave = obterChave();
    if (!chave) return { valor: null, atualizadoEm: linha.atualizado_em || null, erro: `Há um segredo "${nome}" no banco, mas esta máquina não tem a chave mestra (${chaveMestra.VARIAVEL}).` };
    try {
      const texto = chaveMestra.decifrar(chave, { cifra: linha.cifra, iv: linha.iv, tag: linha.tag, valor: linha.valor });
      return { valor: JSON.parse(texto), atualizadoEm: linha.atualizado_em || null };
    } catch (_) {
      return { valor: null, atualizadoEm: linha.atualizado_em || null, erro: `O segredo "${nome}" do banco não abre com a chave mestra desta máquina (chave diferente?).` };
    }
  }

  async function guardar(api, nome, valor, { descricao = null, usuarioId = null } = {}) {
    const chave = obterChave();
    if (!chave) throw erro(`Guardar no banco exige a chave mestra (${chaveMestra.VARIAVEL}) no .env desta máquina.`, 409);
    const cifrado = chaveMestra.cifrar(chave, JSON.stringify(valor ?? null));
    const payload = { nome, ...cifrado, descricao, atualizado_em: new Date().toISOString(), atualizado_por: usuarioId };
    const existente = await linhaDe(api, nome);
    if (existente?.id) await api.put(`${TABELA}/${existente.id}`, payload);
    else await api.post(TABELA, payload);
    return true;
  }

  async function remover(api, nome) {
    const existente = await linhaDe(api, nome);
    if (existente?.id) await api.delete(`${TABELA}/${existente.id}`);
    return Boolean(existente);
  }

  return {
    get disponivel() { return Boolean(obterChave()); },
    ler, guardar, remover
  };
}

module.exports = { criar, TABELA };
