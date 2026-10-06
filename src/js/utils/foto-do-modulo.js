/**
 * Volta instantânea dos módulos (desempenho, Fase 4 — 06/10/2026).
 *
 * Ao sair de um módulo já carregado, o menu guarda uma FOTO da área dele. Ao
 * voltar, a foto aparece na hora no lugar do spinner, com o selo
 * "Atualizando…", enquanto o módulo de verdade carrega por baixo do jeito de
 * sempre; quando ele fica pronto, a foto sai e o módulo aparece sem animação,
 * na mesma rolagem (menu.js › loadPage).
 *
 * É foto e não o DOM antigo de propósito: o módulo recomeça do zero como
 * sempre — sem dois elementos com o mesmo id, sem ninguém editar dado velho —,
 * só a espera deixa de ser uma tela vazia.
 *
 * A foto só vale se nada mudou no layout: mesma janela, mesma área do módulo,
 * mesmo tema, até 30 minutos. Senão, a máscara de sempre. Ela vive só na
 * memória desta janela (nunca vai para disco) e some ao sair do programa.
 *
 * Quem fotografa é o processo principal (main.js › 'modulo:fotografar'), pela
 * ponte `electronAPI.fotografarArea`.
 */
(() => {
  if (window.FotoDoModulo) return;

  const fotos = new Map();
  const VALIDADE_MS = 30 * 60 * 1000;
  /** Quanto a troca de módulo espera pela foto; passou disso, segue sem ela. */
  const ESPERA_MAXIMA_MS = 150;

  const temaAtual = () => document.documentElement?.dataset?.menuTheme || '';

  /** A parte da área do módulo que está dentro da janela, em pixels inteiros. */
  function areaVisivel(content) {
    const r = content.getBoundingClientRect();
    const x = Math.max(0, Math.round(r.left));
    const y = Math.max(0, Math.round(r.top));
    const direita = Math.min(window.innerWidth, Math.round(r.right));
    const base = Math.min(window.innerHeight, Math.round(r.bottom));
    return { x, y, width: direita - x, height: base - y };
  }

  function mesmaArea(a, b) {
    return Boolean(a && b) && ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) <= 1);
  }

  function descartar(pagina) {
    const foto = fotos.get(pagina);
    if (!foto) return;
    fotos.delete(pagina);
    if (!foto.url) return; // o JPEG ainda não tinha chegado
    try { URL.revokeObjectURL(foto.url); } catch (_) { /* já liberada */ }
  }

  /** Nada por cima da área do módulo (modal, diálogo, aviso): a foto sairia com isso. */
  function areaDescoberta(content, area) {
    if (typeof document.elementFromPoint !== 'function') return false;
    return [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]].every(([fx, fy]) => {
      const alvo = document.elementFromPoint(area.x + area.width * fx, area.y + area.height * fy);
      return !alvo || content.contains(alvo);
    });
  }

  // O módulo de verdade tem `data-page` (menu.js › loadPage). A tela de erro e
  // a de "sem acesso" também usam `.modulo-container`, mas sem ele: dessas,
  // nada de foto.
  const temModuloMontado = (content, pagina) => Array.from(content.children || [])
    .some(el => el.classList?.contains('modulo-container') && el.dataset?.page === pagina);

  /**
   * Fotografa o módulo que está na tela, antes de ele sair.
   *
   * A promessa resolve assim que a tela foi LIDA (é por ela que a troca de
   * módulo espera — nunca mais que `ESPERA_MAXIMA_MS`); o JPEG chega depois,
   * por fora, e só então a foto passa a valer (`queServe`). Nunca derruba a
   * navegação.
   */
  async function fotografar(content) {
    const pagina = content?.dataset?.activePage;
    if (!pagina) return null;
    // A foto antiga deixa de valer de qualquer jeito: o módulo mudou desde ela.
    descartar(pagina);
    const tirar = window.electronAPI?.fotografarArea;
    const ler = window.electronAPI?.lerFotoDaArea;
    if (typeof tirar !== 'function' || typeof ler !== 'function') return null;
    if (content.classList.contains('is-module-loading')) return null; // ainda carregando
    if (!temModuloMontado(content, pagina)) return null;               // tela de erro / sem acesso
    if (document.body.classList.contains('overflow-hidden')) return null; // modal aberto
    const area = areaVisivel(content);
    if (area.width < 200 || area.height < 150) return null;
    if (!areaDescoberta(content, area)) return null;

    const rolagem = content.scrollTop || 0;
    const tema = temaAtual();
    // O pedido sai JÁ (no clique), com a tela ainda intacta.
    let pedido;
    try { pedido = Promise.resolve(tirar(area)).catch(() => null); } catch (_) { pedido = Promise.resolve(null); }
    let teto = null;
    const id = await Promise.race([
      pedido,
      new Promise(resolve => { teto = setTimeout(() => resolve(null), ESPERA_MAXIMA_MS); })
    ]);
    clearTimeout(teto);
    if (!id) return null;
    // O layout mexeu durante a captura (barra lateral deslizando, janela
    // redimensionada): a foto não confere com a área.
    if (!mesmaArea(area, areaVisivel(content))) return null;

    descartar(pagina); // duas saídas seguidas do mesmo módulo: fica a última
    const foto = {
      url: null, area, rolagem, tema,
      janela: { largura: window.innerWidth, altura: window.innerHeight },
      em: Date.now()
    };
    fotos.set(pagina, foto);
    // O JPEG, por fora: a troca de módulo já seguiu.
    foto.pronta = Promise.resolve()
      .then(() => ler(id))
      .then(bytes => {
        if (fotos.get(pagina) !== foto) return null; // já trocada ou descartada
        if (!bytes || !bytes.byteLength) { fotos.delete(pagina); return null; }
        foto.url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        return foto;
      })
      .catch(() => { if (fotos.get(pagina) === foto) fotos.delete(pagina); return null; });
    return foto;
  }

  /** A foto do módulo, se ela ainda confere com a tela de agora. */
  function queServe(pagina, content) {
    const foto = fotos.get(pagina);
    if (!foto || !foto.url) return null; // sem foto, ou o JPEG ainda a caminho
    const confere = Date.now() - foto.em <= VALIDADE_MS
      && foto.tema === temaAtual()
      && foto.janela.largura === window.innerWidth
      && foto.janela.altura === window.innerHeight
      && mesmaArea(foto.area, areaVisivel(content));
    if (!confere) {
      descartar(pagina);
      return null;
    }
    return foto;
  }

  /** O véu com a foto e o selo "Atualizando…", no lugar da máscara. */
  function criarVeu(foto, titulo) {
    const veu = document.createElement('div');
    veu.className = 'module-snapshot';
    veu.setAttribute('role', 'status');
    veu.setAttribute('aria-live', 'polite');
    veu.setAttribute('aria-label', `Atualizando ${titulo || 'o módulo'}`);
    veu.style.width = `${foto.area.width}px`;
    veu.style.height = `${foto.area.height}px`;
    const imagem = document.createElement('img');
    imagem.src = foto.url;
    imagem.alt = '';
    imagem.draggable = false;
    const selo = document.createElement('span');
    selo.className = 'module-snapshot-badge';
    const icone = document.createElement('i');
    icone.className = 'fas fa-sync-alt fa-spin';
    icone.setAttribute('aria-hidden', 'true');
    selo.append(icone, document.createTextNode(' Atualizando…'));
    veu.append(imagem, selo);
    return veu;
  }

  window.FotoDoModulo = { fotografar, queServe, criarVeu, descartar, VALIDADE_MS, ESPERA_MAXIMA_MS };
})();
