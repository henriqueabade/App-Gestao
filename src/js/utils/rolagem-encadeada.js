/**
 * Rolagem encadeada entre a página (o módulo ou o modal) e as tabelas.
 *
 * Padrão do programa, para TODA tabela com rolagem própria:
 *
 *   - mouse EM CIMA da tabela: a roda rola a tabela, como sempre. Quando a
 *     tabela chega no limite (em cima ou embaixo), a roda passa a rolar a
 *     página/modal — antes a rolagem "morria" ali;
 *   - mouse FORA da tabela: a roda rola a página/modal. Quando ela chega no
 *     limite, a roda passa a rolar a tabela que está na tela (a mais próxima
 *     do mouse) — antes não acontecia nada.
 *
 * Vale para o módulo aberto (#content) e para qualquer modal (role="dialog").
 * Um ouvinte só, em `window`, instalado uma vez pelo menu.html: as telas não
 * precisam fazer nada. Ctrl+roda (zoom) e rolagem de lado não são tocadas.
 */
(() => {
  if (window.RolagemEncadeada) return;

  /** O que conta como "tabela com rolagem própria". */
  const SELETOR_TABELA = '.table-scroll, .fin-tabela, .items-table-scroll, [data-rolagem-tabela]';

  const rolaNaVertical = el => {
    if (!(el instanceof Element)) return false;
    const estilo = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(estilo.overflowY) && el.scrollHeight > el.clientHeight + 1;
  };

  const ehTabela = el => el instanceof Element
    && (el.matches(SELETOR_TABELA) || Boolean(el.querySelector(':scope > table')));

  /** Ainda dá para rolar nesse sentido? (1px de folga para o arredondamento.) */
  const podeRolar = (el, dy) => (dy < 0
    ? el.scrollTop > 0
    : Math.ceil(el.scrollTop + el.clientHeight) < el.scrollHeight - 1);

  /** A roda em pixels (a roda "por linha" e "por página" também existem). */
  function normalizarDelta(evento, alturaDaPagina = 800) {
    const dy = Number(evento?.deltaY) || 0;
    if (evento?.deltaMode === 1) return dy * 16;
    if (evento?.deltaMode === 2) return dy * alturaDaPagina;
    return dy;
  }

  /**
   * Entre as tabelas da tela, a que recebe a rolagem: visível, que ainda
   * rola nesse sentido, e a mais perto do mouse na vertical. Pura (recebe as
   * caixas prontas: { el, top, bottom, podeRolar }).
   */
  function escolherTabela(candidatas, yDoMouse) {
    const validas = candidatas.filter(c => c.podeRolar && c.bottom > c.topoDaTela && c.top < c.baseDaTela);
    if (!validas.length) return null;
    const distancia = c => (yDoMouse < c.top ? c.top - yDoMouse : (yDoMouse > c.bottom ? yDoMouse - c.bottom : 0));
    return validas.sort((a, b) => distancia(a) - distancia(b))[0].el;
  }

  /** Os elementos que rolam, do mais de dentro para o mais de fora, até a raiz da área. */
  function roladores(inicio, raiz) {
    const lista = [];
    for (let n = inicio; n; n = n.parentElement) {
      if (rolaNaVertical(n)) lista.push(n);
      if (n === raiz) break;
    }
    return lista;
  }

  function aoRolar(evento) {
    if (evento.defaultPrevented || evento.ctrlKey) return;
    if (Math.abs(evento.deltaX) > Math.abs(evento.deltaY)) return;
    const alvo = evento.target instanceof Element ? evento.target : null;
    if (!alvo) return;
    // A área: o modal de cima, ou o módulo aberto.
    const raiz = alvo.closest('[role="dialog"]') || document.getElementById('content');
    if (!raiz || !raiz.contains(alvo)) return;
    const dy = normalizarDelta(evento, raiz.clientHeight);
    if (!dy) return;

    const cadeia = roladores(alvo, raiz);
    const primeiro = cadeia[0] || null;

    // 1) Mouse em cima de uma tabela.
    if (primeiro && ehTabela(primeiro)) {
      if (podeRolar(primeiro, dy)) return; // rola a tabela (nativo)
      const acima = cadeia.slice(1).find(el => podeRolar(el, dy));
      if (!acima) return;
      evento.preventDefault();
      acima.scrollBy({ top: dy, behavior: 'auto' });
      return;
    }

    // 2) Mouse fora das tabelas: a página rola enquanto puder.
    if (primeiro && podeRolar(primeiro, dy)) return;
    // Ela está no limite: quem rola agora é a tabela da tela (dentro dela).
    const dentro = primeiro || raiz;
    const tabelas = [...dentro.querySelectorAll(SELETOR_TABELA), ...[...dentro.querySelectorAll('table')].map(t => t.parentElement)]
      .filter((el, i, todos) => el && todos.indexOf(el) === i && rolaNaVertical(el));
    if (!tabelas.length) return;
    const caixaDaArea = dentro.getBoundingClientRect();
    const escolhida = escolherTabela(tabelas.map(el => {
      const r = el.getBoundingClientRect();
      return { el, top: r.top, bottom: r.bottom, topoDaTela: caixaDaArea.top, baseDaTela: caixaDaArea.bottom, podeRolar: podeRolar(el, dy) };
    }), evento.clientY);
    if (!escolhida) return;
    evento.preventDefault();
    escolhida.scrollBy({ top: dy, behavior: 'auto' });
  }

  window.addEventListener('wheel', aoRolar, { passive: false, capture: true });

  window.RolagemEncadeada = { SELETOR_TABELA, normalizarDelta, escolherTabela, podeRolar, aoRolar };
})();
