/**
 * Denunciar conteúdo (16/10/2026) — políticas 11.12 (conteúdo dos usuários) e
 * 11.16 (IA generativa) da Microsoft Store.
 *
 * A mensagem do chat e o resultado do Assistente de leitura (módulo IA) podem
 * ser denunciados à empresa. Não há rota da API para isso: a denúncia sai como
 * e-mail para o contato dos Termos de Uso (termos-documentos.js), aberto no
 * programa de e-mail do computador com o assunto e a referência prontos; a
 * pessoa escreve o motivo e envia. Quem apaga mensagem dos outros no chat é o
 * Sup Admin.
 *
 * `montarEmail` é pura e roda também no Node (testes em
 * src/js/__tests__/denunciarConteudo.test.js).
 */
(function (raiz, fabrica) {
  const api = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.DenunciarConteudo = api;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  // O trecho vai dentro do endereço "mailto:"; longo demais, há programa de
  // e-mail que corta ou nem abre.
  const LIMITE_DO_TRECHO = 300;

  function documentos() {
    if (raiz && raiz.TermosDocumentos) return raiz.TermosDocumentos;
    return typeof require === 'function' ? require('./termos-documentos') : null;
  }

  /** O e-mail do suporte: o mesmo contato dos Termos de Uso. */
  function contato() {
    return documentos()?.CONTROLADOR?.contato || '';
  }

  function cortar(texto) {
    const limpo = String(texto ?? '').replace(/\s+/g, ' ').trim();
    return limpo.length > LIMITE_DO_TRECHO ? `${limpo.slice(0, LIMITE_DO_TRECHO - 1)}…` : limpo;
  }

  /** Assunto, corpo e endereço "mailto:" da denúncia. */
  function montarEmail({ assunto, linhas = [], trecho = '' } = {}) {
    const para = contato();
    const corpo = [
      'Motivo: (escreva aqui)',
      '',
      ...linhas.filter(Boolean),
      ...(cortar(trecho) ? ['', `Trecho: "${cortar(trecho)}"`] : []),
      '',
      'Enviado pelo botão de denúncia do Santíssimo Decor.'
    ].join('\r\n');
    const url = `mailto:${para}?subject=${encodeURIComponent(assunto || 'Denúncia')}&body=${encodeURIComponent(corpo)}`;
    return { para, assunto, corpo, url };
  }

  /**
   * Confirma com a pessoa e abre o e-mail.
   * `titulo` e `explicacao` dizem o que vai ser denunciado e para quem.
   */
  async function abrir({ titulo, explicacao, assunto, linhas, trecho } = {}) {
    const email = montarEmail({ assunto, linhas, trecho });
    if (!email.para) return false;
    const ok = await raiz?.DialogPadrao?.confirm?.({
      title: titulo,
      tom: 'pergunta',
      message: `${explicacao}\n\nVai abrir um e-mail para ${email.para} com a referência pronta: escreva o motivo e envie.`,
      nota: `Sem programa de e-mail neste computador? Escreva para ${email.para}.`,
      confirmText: 'Abrir e-mail',
      cancelText: 'Cancelar'
    });
    if (!ok) return false;
    if (raiz?.electronAPI?.openExternal) await raiz.electronAPI.openExternal(email.url);
    else raiz?.open?.(email.url);
    return true;
  }

  return { LIMITE_DO_TRECHO, contato, cortar, montarEmail, abrir };
});
