/**
 * A regra de senha do app (decisão do dono, 21/09/2026): mínimo de 8
 * caracteres, com uma letra maiúscula, um número e um caractere especial.
 *
 * É a MESMA em todo lugar onde uma senha nasce ou muda:
 *   - cadastro pela tela de login e Usuários › Novo usuário;
 *   - troca de senha em Configurações › Dados pessoais;
 *   - redefinição pelo link do e-mail ("Esqueceu a senha?").
 * A tela confere enquanto se digita (a lista marca cada requisito) e o backend
 * confere de novo antes de gravar — quem grava não confia na tela.
 *
 * Os parâmetros ficam só aqui (MINIMO e REQUISITOS): mudar a regra é mudar
 * este arquivo. Serve ao navegador (window.SenhaForte) e ao Node
 * (require('../src/js/utils/senha-forte')). Senhas já gravadas continuam
 * entrando: a regra vale para a senha nova.
 */
(function (raiz, fabrica) {
  const regra = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = regra;
  else raiz.SenhaForte = regra;
})(typeof self !== 'undefined' ? self : this, function () {
  const MINIMO = 8;

  // Letra acentuada conta como letra, não como especial; espaço não é especial.
  const REQUISITOS = [
    { chave: 'tamanho', texto: `Pelo menos ${MINIMO} caracteres`, confere: s => Array.from(s).length >= MINIMO },
    { chave: 'maiuscula', texto: 'Uma letra maiúscula', confere: s => /\p{Lu}/u.test(s) },
    { chave: 'numero', texto: 'Um número', confere: s => /\p{Nd}/u.test(s) },
    { chave: 'especial', texto: 'Um caractere especial (!@#…)', confere: s => /[^\p{L}\p{N}\s]/u.test(s) }
  ];

  const DESCRICAO = `Mínimo de ${MINIMO} caracteres, com uma letra maiúscula, um número e um caractere especial.`;

  /** Cada requisito, cumprido ou não, e se a senha vale. Pura. */
  function conferir(senha) {
    const s = typeof senha === 'string' ? senha : '';
    const itens = REQUISITOS.map(r => ({ chave: r.chave, texto: r.texto, ok: r.confere(s) }));
    return { valida: itens.every(i => i.ok), itens, faltando: itens.filter(i => !i.ok).map(i => i.texto) };
  }

  /** A frase do que falta ('' quando a senha vale). Pura. */
  function mensagem(senha) {
    const { valida, faltando } = conferir(senha);
    if (valida) return '';
    const partes = faltando.map(t => t.charAt(0).toLowerCase() + t.slice(1).replace(/ \(.*\)$/, ''));
    const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0];
    return `A senha precisa ter ${lista}.`;
  }

  /**
   * Na tela: desenha em `lista` (um <ul class="senha-forte">) um item por
   * requisito e marca os cumpridos enquanto se digita em `campo`. A marca é
   * desenhada pelo CSS (src/styles/senha-forte.css), sem biblioteca de ícones:
   * a tela de login não carrega o Font Awesome. Devolve { atualizar }.
   */
  function ligarLista(campo, lista) {
    if (!campo || !lista || typeof document === 'undefined') return { atualizar() {} };
    lista.innerHTML = '';
    lista.classList.add('senha-forte');
    const itens = REQUISITOS.map(r => {
      const li = document.createElement('li');
      li.dataset.requisito = r.chave;
      li.className = 'senha-forte__item';
      const marca = document.createElement('span');
      marca.className = 'senha-forte__marca';
      marca.setAttribute('aria-hidden', 'true');
      const texto = document.createElement('span');
      texto.textContent = r.texto;
      li.append(marca, texto);
      lista.appendChild(li);
      return { li, requisito: r };
    });
    function atualizar() {
      const s = campo.value || '';
      for (const { li, requisito } of itens) {
        const ok = requisito.confere(s);
        li.classList.toggle('senha-forte__item--ok', ok);
        li.dataset.ok = ok ? 'sim' : 'nao';
      }
    }
    campo.addEventListener('input', atualizar);
    atualizar();
    return { atualizar };
  }

  return {
    MINIMO,
    DESCRICAO,
    REQUISITOS: REQUISITOS.map(({ chave, texto }) => ({ chave, texto })),
    conferir,
    mensagem,
    ligarLista
  };
});
