/**
 * Seção retrátil dos modais: uma barra com título e setinha que abre e fecha
 * um bloco de campos. Nasce FECHADA.
 *
 * Duas coisas a mais, que é o que faz a seção não esconder problema:
 *
 *   - ao SALVAR, se algum campo obrigatório de dentro está vazio (ou inválido),
 *     a seção abre sozinha, a barra fica em vermelho e o campo recebe o foco —
 *     o navegador não consegue focar um campo escondido, e sem isto o
 *     formulário simplesmente não enviava, sem dizer por quê;
 *   - fechada, a barra resume o que há dentro ("3 de 7 preenchidos"), para
 *     ninguém precisar abrir só para conferir.
 *
 * Casa:
 *   <section class="secao-retratil" data-secao-retratil>
 *     <button type="button" data-secao-barra aria-expanded="false" aria-controls="x">…</button>
 *     <div id="x" data-secao-corpo class="secao-retratil__corpo">…campos…</div>
 *   </section>
 */
(() => {
  if (window.SecaoRetratil) return;

  const corpoDe = secao => secao?.querySelector('[data-secao-corpo]') || null;
  const barraDe = secao => secao?.querySelector('[data-secao-barra]') || null;
  const notaDe = secao => secao?.querySelector('[data-secao-nota]') || null;
  const campos = secao => [...(corpoDe(secao)?.querySelectorAll('input, select, textarea') || [])];

  function estaAberta(secao) {
    return barraDe(secao)?.getAttribute('aria-expanded') === 'true';
  }

  function abrir(secao, { foco = null } = {}) {
    if (!secao) return;
    const corpo = corpoDe(secao);
    const barra = barraDe(secao);
    if (corpo) corpo.hidden = false;
    corpo?.classList.remove('hidden');
    barra?.setAttribute('aria-expanded', 'true');
    secao.classList.add('secao-retratil--aberta');
    if (foco) setTimeout(() => { try { foco.focus(); } catch (_) { /* campo saiu da tela */ } }, 0);
  }

  function fechar(secao) {
    if (!secao) return;
    const corpo = corpoDe(secao);
    if (corpo) corpo.hidden = true;
    barraDe(secao)?.setAttribute('aria-expanded', 'false');
    secao.classList.remove('secao-retratil--aberta');
  }

  const alternar = secao => (estaAberta(secao) ? fechar(secao) : abrir(secao));

  /** Abre a seção que contém este campo (se ele estiver dentro de uma). */
  function abrirDe(elemento, opcoes = {}) {
    const secao = elemento?.closest?.('[data-secao-retratil]') || null;
    if (secao) abrir(secao, opcoes);
    return secao;
  }

  /** O aviso da barra: texto curto e, com `atencao`, a barra em vermelho. */
  function avisar(secao, texto, atencao = false) {
    const nota = notaDe(secao);
    if (nota) nota.textContent = texto || '';
    secao?.classList.toggle('secao-retratil--atencao', Boolean(atencao));
  }

  /** Fechada, a barra diz o que há dentro: "3 de 7 preenchidos". */
  function resumir(secao, { vazio = 'nada preenchido — usa o padrão' } = {}) {
    const lista = campos(secao).filter(c => !c.disabled && c.type !== 'hidden');
    const preenchidos = lista.filter(c => String(c.value ?? '').trim() !== '').length;
    const faltando = lista.filter(c => c.required && String(c.value ?? '').trim() === '');
    if (faltando.length) {
      avisar(secao, `falta ${faltando.length === 1 ? 'preencher 1 campo' : `preencher ${faltando.length} campos`}`, true);
      return { preenchidos, total: lista.length, faltando };
    }
    avisar(secao, preenchidos ? `${preenchidos} de ${lista.length} preenchidos` : vazio, false);
    return { preenchidos, total: lista.length, faltando };
  }

  /**
   * Liga as seções que ainda não estão ligadas. Roda quantas vezes precisar
   * (o modal é remontado a cada abertura).
   */
  function ligar(raiz = document) {
    const secoes = [...(raiz?.querySelectorAll?.('[data-secao-retratil]') || [])];
    for (const secao of secoes) {
      if (secao.dataset.secaoLigada === '1') continue;
      secao.dataset.secaoLigada = '1';
      const barra = barraDe(secao);
      barra?.addEventListener('click', () => alternar(secao));
      // Nasce fechada, a não ser que o HTML peça o contrário.
      if (secao.dataset.secaoAberta === '1') abrir(secao); else fechar(secao);
      resumir(secao);
      for (const campo of campos(secao)) {
        campo.addEventListener('change', () => resumir(secao));
      }
      // O navegador recusa focar campo escondido: a seção abre antes disso.
      const form = secao.closest('form');
      if (form && form.dataset.secaoInvalida !== '1') {
        form.dataset.secaoInvalida = '1';
        form.addEventListener('invalid', evento => {
          const alvo = evento.target;
          const dentro = alvo?.closest?.('[data-secao-retratil]');
          if (!dentro) return;
          abrir(dentro, { foco: alvo });
          avisar(dentro, 'falta preencher aqui', true);
        }, true);
      }
    }
    return secoes;
  }

  window.SecaoRetratil = { ligar, abrir, fechar, alternar, abrirDe, avisar, resumir, estaAberta, campos };
})();
