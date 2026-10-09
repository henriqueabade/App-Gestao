/**
 * Nome completo do usuário (pedido do dono, 09/10/2026).
 *
 * O cadastro (tela de login e Usuários › Novo usuário) pede NOME e SOBRENOME,
 * os dois obrigatórios, e grava os dois juntos na coluna única `usuarios.nome`
 * ("Maria" + "Souza Lima" = "Maria Souza Lima"). Com isso dá para ENTRAR pelo
 * nome completo, além do e-mail — e, para o login pelo nome valer, dois
 * usuários não podem ter o mesmo nome.
 *
 * "O mesmo nome" é a mesma CHAVE: sem diferença de maiúsculas, de acentos e
 * de espaços repetidos ("joão  da silva" = "João da Silva"). A API confere
 * com a mesma regra (acesso/nomes.js no Santissimo-db-API) em toda gravação
 * de `usuarios`; a tela confere antes só para avisar mais cedo.
 *
 * Serve ao navegador (window.NomeCompleto) e ao Node
 * (require('../src/js/utils/nome-completo')).
 */
(function (raiz, fabrica) {
  const regra = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = regra;
  else raiz.NomeCompleto = regra;
})(typeof self !== 'undefined' ? self : this, function () {
  const MAXIMO = 200;

  /** O texto sem espaços sobrando ("  Maria   Souza " = "Maria Souza"). */
  function limpar(texto) {
    return typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim() : '';
  }

  /** Nome + sobrenome na coluna única. */
  function juntar(nome, sobrenome) {
    return [limpar(nome), limpar(sobrenome)].filter(Boolean).join(' ').slice(0, MAXIMO);
  }

  /** O nome completo partido no primeiro espaço (para preencher os dois campos). */
  function separar(nomeCompleto) {
    const t = limpar(nomeCompleto);
    const i = t.indexOf(' ');
    return i < 0 ? { nome: t, sobrenome: '' } : { nome: t.slice(0, i), sobrenome: t.slice(i + 1) };
  }

  /** A chave de comparação: sem acento, sem maiúscula, sem espaço repetido. */
  function chave(nome) {
    return limpar(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  const mesmoNome = (a, b) => Boolean(chave(a)) && chave(a) === chave(b);

  /** '' quando vale; senão, o que falta. Nome completo = ao menos duas palavras. */
  function mensagem(nomeCompleto) {
    const t = limpar(nomeCompleto);
    if (!t) return 'Informe o nome e o sobrenome.';
    if (t.length > MAXIMO) return `O nome passa de ${MAXIMO} letras.`;
    if (t.split(' ').length < 2 || t.replace(/[^\p{L}]/gu, '').length < 3) return 'Informe o nome e o sobrenome.';
    return '';
  }

  /** Os dois campos do cadastro: '' quando valem. */
  function mensagemDasPartes(nome, sobrenome) {
    if (!limpar(nome)) return 'Informe o nome.';
    if (!limpar(sobrenome)) return 'Informe o sobrenome.';
    return mensagem(juntar(nome, sobrenome));
  }

  /** O que se digita no "E-mail ou nome completo" do login é e-mail? */
  function ehEmail(texto) {
    return limpar(texto).includes('@');
  }

  /** O recado do nome repetido (a API manda o mesmo). */
  function recadoDeRepetido(nome) {
    return `O nome "${limpar(nome)}" já está cadastrado. Diferencie (por exemplo, com outro sobrenome).`;
  }

  return { MAXIMO, limpar, juntar, separar, chave, mesmoNome, mensagem, mensagemDasPartes, ehEmail, recadoDeRepetido };
});
