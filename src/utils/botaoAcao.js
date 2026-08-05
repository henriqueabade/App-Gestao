/**
 * Proteção global contra duplo clique + estado de carregamento nos botões.
 *
 * Regras acordadas com o usuário:
 *  - Nenhum botão (módulo, modal ou caixa de diálogo) pode ser acionado duas
 *    vezes enquanto a ação anterior não terminar.
 *  - O botão acionado fica "carregando" até a função dele concluir.
 *
 * Como funciona
 * -------------
 * REDE AUTOMÁTICA: listeners em fase de CAPTURA em `document` para `click` e
 * `submit`. O primeiro acionamento marca o elemento como ocupado; qualquer
 * repetição é engolida (`stopImmediatePropagation`) antes de chegar aos handlers
 * do módulo. Cobrir `submit` é essencial porque formulário também é enviado com
 * Enter, sem clique nenhum.
 *
 * Para saber QUANDO liberar, rastreamos as promessas de `window.electronAPI`
 * criadas durante o acionamento — é por ali que passa todo acesso a dados do
 * app. Enquanto houver chamada pendente, o botão continua carregando. Sem
 * nenhuma chamada (ação instantânea, como abrir um menu), o bloqueio dura só a
 * janela mínima e nenhum spinner aparece.
 *
 * Existe UM rastreador ativo por vez: o clique em um botão de submit dispara o
 * `submit` dentro do mesmo evento, então o formulário é anexado ao rastreador do
 * botão em vez de criar outro — senão o botão seria liberado no meio do salvamento.
 *
 * API EXPLÍCITA: `BotaoAcao.bind`, `BotaoAcao.bindSubmit` e `BotaoAcao.run` para
 * quando o módulo sabe exatamente o que esperar (migração módulo a módulo).
 *
 * Cuidados de implementação
 * -------------------------
 *  - O atributo `disabled` NÃO é usado (ver `marcarOcupado`): o bloqueio vem do
 *    listener em captura, e mexer em `disabled` atropelaria os módulos que
 *    gerenciam esse atributo por conta própria durante a ação.
 *  - O visual de carregando aparece quando a ação vai ao back-end (ou após
 *    `ATRASO_VISUAL_MS`, no caso da API explícita), para não piscar spinner em
 *    botão instantâneo.
 *
 * Opt-out: `data-sem-loading="true"` mantém a proteção contra duplo clique mas
 * nunca aplica o visual. `data-sem-guarda="true"` desliga as duas coisas.
 */
(() => {
  const CLASSE_CARREGANDO = 'acao-carregando';
  const SELETOR_ALVO = [
    'button',
    '[role="button"]',
    'input[type="submit"]',
    'input[type="button"]',
    // Nas tabelas dos módulos e dos modais quem faz o papel de botão é o ícone
    // (editar, excluir, visualizar). O padrão do projeto é `<i class="fas fa-*
    // cursor-pointer">`, então esses também entram na guarda — sem eles metade
    // das ações do app continuaria aceitando duplo clique.
    'i.cursor-pointer',
    '[data-acao="true"]'
  ].join(', ');
  /** Trava de segurança: nenhum botão fica preso para sempre. */
  const LIMITE_MS = 30000;
  /** Janela mínima de bloqueio, cobre o duplo clique acidental em ações sync. */
  const JANELA_MIN_MS = 350;
  /** Só mostra spinner se a ação passar disso. */
  const ATRASO_VISUAL_MS = 120;

  function injetarEstilos() {
    if (document.getElementById('botaoAcaoEstilos')) return;
    const style = document.createElement('style');
    style.id = 'botaoAcaoEstilos';
    style.textContent = `
      .${CLASSE_CARREGANDO} {
        position: relative !important;
        pointer-events: none !important;
        cursor: progress !important;
        color: transparent !important;
        text-shadow: none !important;
      }
      .${CLASSE_CARREGANDO} > * { visibility: hidden !important; }
      .${CLASSE_CARREGANDO}::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 1em;
        height: 1em;
        margin: -0.5em 0 0 -0.5em;
        border-radius: 9999px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: #fff;
        animation: botaoAcaoGirar 0.6s linear infinite;
        pointer-events: none;
      }
      @keyframes botaoAcaoGirar { to { transform: rotate(360deg); } }

      /* Véu de ação em andamento — ver \`comCarregamento\`. */
      #botaoAcaoVeu {
        position: fixed;
        inset: 0;
        z-index: 3000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.9rem;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(2px);
        cursor: progress;
      }
      #botaoAcaoVeu .botaoAcaoVeu-roda {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 9999px;
        border: 3px solid rgba(255, 255, 255, 0.25);
        border-top-color: #fff;
        animation: botaoAcaoGirar 0.7s linear infinite;
      }
      #botaoAcaoVeu .botaoAcaoVeu-texto {
        color: #fff;
        font-size: 0.95rem;
        font-weight: 500;
        text-align: center;
        max-width: 22rem;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const estaOcupado = el => el?.dataset?.acaoOcupada === 'true';

  /**
   * Bloqueia o elemento. Note que o atributo `disabled` NÃO é usado: o bloqueio
   * vem do listener em captura (que engole cliques e ativações por teclado,
   * porque Enter/Espaço também disparam `click`) somado a `pointer-events: none`
   * do visual de carregando. Mexer em `disabled` seria pior: vários módulos
   * gerenciam o próprio `disabled` durante a ação (estado de atualização,
   * carregamento de coleções, permissões) e, ao liberar, restauraríamos um valor
   * velho — reabilitando um botão que o módulo tinha acabado de travar.
   */
  function marcarOcupado(el, { visual = true, imediato = false } = {}) {
    if (!el || estaOcupado(el)) return;
    el.dataset.acaoOcupada = 'true';
    el.setAttribute('aria-busy', 'true');

    if (!visual || el.dataset.semLoading === 'true') return;
    if (imediato) {
      el.classList.add(CLASSE_CARREGANDO);
      return;
    }
    setTimeout(() => {
      if (estaOcupado(el)) el.classList.add(CLASSE_CARREGANDO);
    }, ATRASO_VISUAL_MS);
  }

  function liberar(el) {
    if (!estaOcupado(el)) return;
    delete el.dataset.acaoOcupada;
    el.classList.remove(CLASSE_CARREGANDO);
    el.removeAttribute('aria-busy');
  }

  // ------------------------------------------------------------------
  // Rastreio das promessas de electronAPI criadas durante o acionamento
  // ------------------------------------------------------------------
  let coletor = null;
  /**
   * Rastreador criado pelo clique que está sendo despachado AGORA. O `submit`
   * disparado por um botão acontece dentro do mesmo evento, então ele reaproveita
   * este rastreador. A referência é descartada no microtique seguinte para não
   * vazar para acionamentos posteriores.
   */
  let rastreadorDoCliqueAtual = null;

  /**
   * `electronAPI` vem do contextBridge e é imutável, então não dá para
   * sobrescrever os métodos no próprio objeto (nem via Proxy, que violaria os
   * invariantes de propriedade não-configurável). Publicamos um objeto simples
   * com os mesmos métodos, cada um repassando a promessa ao coletor. Todos os
   * membros expostos no preload são funções, logo nada é perdido na cópia.
   */
  function instrumentarElectronAPI() {
    const api = window.electronAPI;
    if (!api || api.__botaoAcaoInstrumentado) return;

    const envolvido = { __botaoAcaoInstrumentado: true };
    Object.keys(api).forEach(chave => {
      const original = api[chave];
      if (typeof original !== 'function') {
        envolvido[chave] = original;
        return;
      }
      envolvido[chave] = function (...args) {
        const resultado = original.apply(api, args);
        if (coletor && resultado && typeof resultado.then === 'function') {
          coletor(resultado);
        }
        return resultado;
      };
    });

    // A atribuição simples pode falhar EM SILÊNCIO: `contextBridge` publica a
    // ponte como propriedade não-gravável, e fora de modo estrito escrever nela
    // não lança — apenas não faz nada. O `catch` sozinho não percebia isso, e o
    // resultado era o rastreador nunca ver as promessas: o botão era liberado na
    // janela mínima (350 ms) e nenhum carregamento aparecia, em nenhum lugar do
    // app. Por isso a atribuição é CONFERIDA, com `defineProperty` como segunda
    // tentativa.
    try {
      window.electronAPI = envolvido;
    } catch (_) { /* tentativa seguinte */ }

    if (window.electronAPI === envolvido) return;

    try {
      Object.defineProperty(window, 'electronAPI', {
        value: envolvido,
        configurable: true,
        writable: true,
        enumerable: true
      });
    } catch (err) {
      console.error('[botaoAcao] não foi possível instrumentar electronAPI', err);
    }
  }

  /**
   * Alguns módulos (Usuários, Permissões) falam com a API por `fetch` direto,
   * sem passar pelo `electronAPI`. Sem isso o botão seria liberado no meio do
   * salvamento. `Modal.open` também usa `fetch`, então botões que abrem modal
   * ganham o carregando de graça.
   */
  function instrumentarFetch() {
    if (typeof window.fetch !== 'function') return;
    if (window.fetch.__botaoAcaoInstrumentado) return;

    const original = window.fetch.bind(window);
    const envolvido = function (...args) {
      const resultado = original(...args);
      if (coletor && resultado && typeof resultado.then === 'function') {
        coletor(resultado);
      }
      return resultado;
    };
    envolvido.__botaoAcaoInstrumentado = true;
    try {
      window.fetch = envolvido;
    } catch (err) {
      console.error('[botaoAcao] não foi possível instrumentar fetch', err);
    }
  }

  /**
   * Mantém os elementos bloqueados enquanto nascerem/estiverem pendentes
   * chamadas de `electronAPI`. `principal` é quem recebe o spinner.
   */
  function iniciarRastreador(principal) {
    const alvos = new Set();
    const pendentes = new Set();
    const inicio = Date.now();
    let encerrado = false;
    let agendada = false;

    const encerrar = () => {
      if (encerrado) return;
      encerrado = true;
      if (coletor === registrar) coletor = null;
      if (rastreadorDoCliqueAtual === rastreador) rastreadorDoCliqueAtual = null;
      alvos.forEach(liberar);
    };

    const agendar = (ms = 0) => {
      if (agendada || encerrado) return;
      agendada = true;
      setTimeout(() => {
        agendada = false;
        if (encerrado) return;
        const decorrido = Date.now() - inicio;
        if (pendentes.size > 0) {
          if (decorrido >= LIMITE_MS) encerrar();
          else agendar(150);
          return;
        }
        if (decorrido < JANELA_MIN_MS) {
          agendar(JANELA_MIN_MS - decorrido);
          return;
        }
        encerrar();
      }, ms);
    };

    const registrar = promessa => {
      if (encerrado) return;
      // A ação foi para o back-end: agora o spinner faz sentido.
      if (principal && principal.dataset.semLoading !== 'true' && estaOcupado(principal)) {
        principal.classList.add(CLASSE_CARREGANDO);
      }
      pendentes.add(promessa);
      Promise.resolve(promessa)
        .catch(() => {})
        .then(() => {
          pendentes.delete(promessa);
          agendar(0);
        });
    };

    const rastreador = {
      adicionar(el) {
        if (el) alvos.add(el);
      }
    };

    rastreador.adicionar(principal);
    coletor = registrar;
    agendar(JANELA_MIN_MS);
    setTimeout(encerrar, LIMITE_MS + 500);
    return rastreador;
  }

  const SELETOR_CONTAINER = 'button, [role="button"], input[type="submit"], input[type="button"]';

  /**
   * Um `<button>` sem `type` dentro de um form já é botão de envio, por isso o
   * seletor explícito não basta.
   *
   * E o botão NEM SEMPRE está dentro do formulário: vários modais do app põem
   * Cancelar/Salvar num rodapé fora dele e ligam por `form="idDoForm"`, que o
   * HTML permite. Procurando só entre os descendentes, a busca voltava `null` —
   * e sem botão não há onde mostrar o carregando nem o que travar contra o
   * segundo clique. Era o caso dos modais de Matéria-Prima: a ação rodava, mas
   * a tela não dava sinal nenhum de que algo estava acontecendo.
   */
  function localizarBotaoEnvio(form) {
    const dentro = form.querySelector('button[type="submit"], input[type="submit"]');
    if (dentro) return dentro;

    if (form.id) {
      const escapado = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(form.id)
        : form.id;
      const fora = document.querySelector(
        `button[type="submit"][form="${escapado}"], input[type="submit"][form="${escapado}"]`
      );
      if (fora) return fora;
    }

    return form.querySelector('button:not([type="button"]):not([type="reset"])');
  }

  function onClickCaptura(evento) {
    const alvo = evento.target;
    if (!alvo || typeof alvo.closest !== 'function') return;
    const direto = alvo.closest(SELETOR_ALVO);
    if (!direto) return;
    // Ícone dentro de um <button>: guarda o botão, não o ícone. Senão um
    // segundo clique caindo na borda do botão escaparia da trava.
    const botao = direto.closest(SELETOR_CONTAINER) || direto;
    if (botao.dataset.semGuarda === 'true') return;
    // Elemento negado por permissão já tem o próprio bloqueio (permissoes.js) e
    // nunca chega ao back-end: guardá-lo só atrasaria o aviso ao usuário.
    if (botao.dataset.permAplicado === 'negado') return;

    if (estaOcupado(botao)) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      return;
    }

    // Botões geridos pela API explícita cuidam do próprio estado.
    if (botao.dataset.acaoGerida === 'true') return;

    instrumentarElectronAPI();
    // `visual: false` de propósito: na rede automática o spinner é ligado pelo
    // rastreador, no instante em que a ação de fato vai ao back-end. Ligar por
    // tempo faria todo botão instantâneo (abrir menu, marcar filtro) piscar um
    // spinner durante a janela mínima de bloqueio.
    marcarOcupado(botao, { visual: false });
    rastreadorDoCliqueAtual = iniciarRastreador(botao);
    queueMicrotask(() => {
      rastreadorDoCliqueAtual = null;
    });
  }

  function onSubmitCaptura(evento) {
    const form = evento.target;
    if (!form || form.tagName !== 'FORM' || form.dataset.semGuarda === 'true') return;

    if (estaOcupado(form)) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      return;
    }
    if (form.dataset.acaoGerida === 'true') return;

    instrumentarElectronAPI();
    // Formulário não recebe spinner (esconderia os campos); quem mostra é o
    // botão de envio.
    marcarOcupado(form, { visual: false });

    const botao = localizarBotaoEnvio(form);

    // Clique no botão de envio já abriu um rastreador neste mesmo evento:
    // aproveita o mesmo, senão o botão seria liberado no meio do salvamento.
    if (rastreadorDoCliqueAtual) {
      rastreadorDoCliqueAtual.adicionar(form);
      if (botao) rastreadorDoCliqueAtual.adicionar(botao);
      return;
    }

    if (botao && !estaOcupado(botao)) marcarOcupado(botao, { visual: false });
    const rastreador = iniciarRastreador(botao);
    rastreador.adicionar(form);
  }

  // ------------------------------------------------------------------
  // API explícita
  // ------------------------------------------------------------------

  /** Executa `fn` mantendo `el` carregando até a promessa concluir. */
  async function run(el, fn, opcoes = {}) {
    if (typeof fn !== 'function') return undefined;
    if (!el) return fn();
    if (estaOcupado(el)) return undefined;
    marcarOcupado(el, opcoes);
    try {
      return await fn();
    } finally {
      liberar(el);
    }
  }

  /**
   * Véu de "ação em andamento", para quando NÃO existe botão a marcar.
   *
   * É o caso das exclusões confirmadas por caixa de diálogo: o usuário clica na
   * lixeira, o diálogo abre, ele confirma — e só ENTÃO a requisição sai. Nesse
   * ponto o diálogo já fechou e o clique original terminou há muito tempo, então
   * não há nem botão nem rastreador para segurar o carregando. O resultado era
   * um vão de vários segundos com a tela parada e nada indicando que algo estava
   * acontecendo — tempo em que o usuário clica de novo achando que travou.
   *
   * O véu cobre a tela: além de mostrar que está em curso, impede o segundo
   * clique em qualquer lugar, que é o que se quer numa exclusão.
   *
   * @param {Function} fn     ação assíncrona
   * @param {string}   texto  o que está acontecendo, na voz do usuário
   */
  let veuAtivo = 0;

  async function comCarregamento(fn, texto = 'Processando...') {
    if (typeof fn !== 'function') return undefined;

    injetarEstilos();
    veuAtivo += 1;

    let veu = document.getElementById('botaoAcaoVeu');
    if (!veu) {
      veu = document.createElement('div');
      veu.id = 'botaoAcaoVeu';
      veu.setAttribute('role', 'status');
      veu.setAttribute('aria-live', 'polite');
      veu.innerHTML = '<div class="botaoAcaoVeu-roda"></div><p class="botaoAcaoVeu-texto"></p>';
      document.body.appendChild(veu);
    }
    const alvoTexto = veu.querySelector('.botaoAcaoVeu-texto');
    if (alvoTexto) alvoTexto.textContent = texto;

    try {
      return await fn();
    } finally {
      // Contador, não remoção direta: duas ações simultâneas não podem fazer a
      // primeira a terminar tirar o véu da que ainda está rodando.
      veuAtivo = Math.max(0, veuAtivo - 1);
      if (veuAtivo === 0) document.getElementById('botaoAcaoVeu')?.remove();
    }
  }

  /**
   * Registra um handler de clique já protegido. Use no lugar de
   * `el.addEventListener('click', handler)` para ações que fazem I/O.
   */
  function bind(el, handler, opcoes = {}) {
    if (!el || typeof handler !== 'function') return;
    el.dataset.acaoGerida = 'true';
    el.addEventListener('click', evento => {
      if (estaOcupado(el)) {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        return;
      }
      run(el, () => handler(evento), opcoes);
    });
  }

  /**
   * Protege o `submit` de um formulário: o botão de envio fica carregando até a
   * promessa do handler concluir e reenvios são ignorados. Também cobre o envio
   * por Enter, que não passa por nenhum clique.
   */
  function bindSubmit(form, handler, opcoes = {}) {
    if (!form || typeof handler !== 'function') return;
    form.dataset.acaoGerida = 'true';
    const botao = opcoes.botao || localizarBotaoEnvio(form);
    if (botao) botao.dataset.acaoGerida = 'true';
    form.addEventListener('submit', async evento => {
      evento.preventDefault();
      if (estaOcupado(form)) return;
      marcarOcupado(form, { visual: false });
      try {
        await run(botao, () => handler(evento), opcoes);
      } finally {
        liberar(form);
      }
    });
  }

  function iniciar() {
    injetarEstilos();
    instrumentarElectronAPI();
    instrumentarFetch();
    document.addEventListener('click', onClickCaptura, true);
    document.addEventListener('submit', onSubmitCaptura, true);
  }

  // Substitui `electronAPI`/`fetch` já no carregamento do script: os módulos que
  // guardam a referência em constantes precisam pegar a versão instrumentada.
  instrumentarElectronAPI();
  instrumentarFetch();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  window.BotaoAcao = {
    run,
    bind,
    bindSubmit,
    comCarregamento,
    liberar,
    marcarOcupado,
    CLASSE_CARREGANDO
  };
})();
