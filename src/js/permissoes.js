/**
 * Aplicação das permissões na interface.
 *
 * Regras definidas para o projeto:
 *   - Módulo sem permissão  -> NÃO APARECE no menu e a navegação direta é
 *     bloqueada. O menu nasce escondido (menu.css) e cada módulo só aparece
 *     quando a permissão dele chega: nada de "mostra tudo e depois esconde"
 *     (era o clarão dos módulos proibidos no Ctrl+R, pego pelo dono em
 *     02/10/2026). Sem as permissões na mão — carregando, API fora, falha —
 *     nenhum módulo aparece e nenhum abre.
 *   - Ação sem permissão    -> o botão CONTINUA VISÍVEL, porém desabilitado.
 *   - Coluna sem permissão  -> não é renderizada na tabela.
 *   - O backend também recusa (403) — a interface é conveniência, não segurança.
 *
 * Como marcar os elementos no HTML:
 *   <button data-perm="mp.delete">Excluir</button>          (ação -> desabilita)
 *   <th data-perm-col="col_mp_custo_medio">Custo médio</th>  (coluna -> some)
 *   <div data-perm-hide="prod.view">…</div>                  (bloco -> some)
 *   <td data-perm-col="col_mp_custo_medio">…</td>
 *   <div class="sidebar-item" data-page="materia-prima">     (módulo -> some)
 */
(function (global) {
  const ESTADO = {
    permissoes: null,
    catalogo: null,
    paginas: {},
    carregado: false,
    // Não foi possível carregar as permissões (API fora, erro de rede). Antes
    // isto liberava o menu inteiro "para não travar o app"; agora nenhum
    // módulo aparece até a resposta chegar — a carga é tentada de novo
    // sozinha a cada poucos segundos.
    indisponivel: false,
    supAdmin: false
  };

  const MSG_BLOQUEIO = 'Você não tem permissão para esta ação.';

  // Uma falha passageira não pode esvaziar o menu: a carga insiste antes de
  // desistir e, desistindo, volta a tentar sozinha.
  const TENTATIVAS_DA_CARGA = 3;
  const ESPERA_ENTRE_TENTATIVAS_MS = [400, 1200];
  const NOVA_TENTATIVA_MS = 5000;
  let cargaEmAndamento = null;
  let novaTentativa = null;

  const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

  /** Avisa o menu (menu.js) de que as permissões chegaram — ou não. */
  function avisarDaCarga() {
    try {
      global.dispatchEvent(new CustomEvent('permissoes:carregadas', { detail: { indisponivel: ESTADO.indisponivel } }));
    } catch (_) { /* ambiente sem eventos (testes) */ }
  }

  async function baseUrl() {
    try {
      if (global.apiConfig?.getApiBaseUrl) {
        return (await global.apiConfig.getApiBaseUrl()) || '';
      }
    } catch (err) {
      console.error('[permissoes] não foi possível resolver a URL da API.', err);
    }
    return '';
  }

  async function buscar() {
    const url = `${await baseUrl()}/api/permissoes/efetivas`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dados = await resp.json();
    // O backend sinaliza com { erro: true } que não conseguiu apurar (não
    // identificou o usuário, API fora): vale como falha da carga.
    if (dados?.erro) throw new Error('backend sinalizou falha ao apurar permissões');
    return dados;
  }

  function agendarNovaTentativa() {
    if (novaTentativa) return;
    novaTentativa = setTimeout(async () => {
      novaTentativa = null;
      await carregar(true);
      if (!ESTADO.indisponivel) aplicar(document);
    }, NOVA_TENTATIVA_MS);
  }

  async function carregar(force = false) {
    if (ESTADO.carregado && !ESTADO.indisponivel && !force) return ESTADO.permissoes;
    // Várias telas pedem ao mesmo tempo na abertura: uma carga só.
    if (cargaEmAndamento) return cargaEmAndamento;

    const jaTinha = ESTADO.carregado && !ESTADO.indisponivel;
    cargaEmAndamento = (async () => {
      let ultimoErro = null;
      for (let tentativa = 0; tentativa < TENTATIVAS_DA_CARGA; tentativa += 1) {
        try {
          const dados = await buscar();
          ESTADO.permissoes = dados?.permissoes || {};
          ESTADO.paginas = dados?.paginas || {};
          // O backend já informa se é Sup Admin; a checagem local é redundância.
          ESTADO.supAdmin = Boolean(dados?.supAdmin) || ehSupAdmin(dados?.perfil);
          ESTADO.indisponivel = false;
          ESTADO.carregado = true;
          avisarDaCarga();
          return ESTADO.permissoes;
        } catch (err) {
          ultimoErro = err;
          if (tentativa < TENTATIVAS_DA_CARGA - 1) {
            await esperar(ESPERA_ENTRE_TENTATIVAS_MS[tentativa] || 1200);
          }
        }
      }

      // Quem já tinha as permissões fica com elas (uma recarga que falha não
      // derruba o menu); quem nunca teve fica sem módulo nenhum até chegar.
      if (jaTinha) {
        console.warn('[permissoes] a recarga falhou; valem as permissões já carregadas.', ultimoErro);
        return ESTADO.permissoes;
      }
      console.warn('[permissoes] não foi possível carregar as permissões; nenhum módulo é exibido até a resposta chegar.', ultimoErro);
      ESTADO.permissoes = {};
      ESTADO.supAdmin = false;
      ESTADO.indisponivel = true;
      ESTADO.carregado = true;
      agendarNovaTentativa();
      avisarDaCarga();
      return ESTADO.permissoes;
    })().finally(() => { cargaEmAndamento = null; });
    return cargaEmAndamento;
  }

  /** Sup Admin tem TODAS as permissões, sem exceção. */
  function ehSupAdmin(perfil) {
    const p = String(perfil || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[\s._-]+/g, '')
      .toLowerCase();
    return p === 'supadmin' || p === 'superadmin';
  }

  /**
   * Libera as AÇÕES e as COLUNAS em bloco: Sup Admin, ou permissões ainda
   * não aplicáveis. Não vale para os módulos (ver `moduloAtivo`): sem as
   * permissões nenhum módulo abre, então não há tela onde isto pese — e o
   * backend recusa (403) o que não pode.
   */
  function liberaTudo() {
    return ESTADO.supAdmin || ESTADO.indisponivel || !ESTADO.carregado;
  }

  /** Módulo visível no menu (e abrível)? Sem as permissões na mão, nenhum. */
  function moduloAtivo(codigoOuPagina) {
    if (!ESTADO.carregado || ESTADO.indisponivel) return false;
    if (ESTADO.supAdmin) return true;
    const p = ESTADO.permissoes || {};
    // resolve "orcamentos" -> "orc" pelo mapa enviado pelo backend
    const code = ESTADO.paginas?.[codigoOuPagina] || codigoOuPagina;
    if (p[code]) return Boolean(p[code].ativo);
    // Página que não corresponde a nenhum módulo do catálogo: não esconde.
    return true;
  }

  /** Permissão de ação ou coluna ("mp.view", "col_mp_codigo"). */
  function pode(chave) {
    if (liberaTudo()) return true;
    const p = ESTADO.permissoes || {};
    for (const bloco of Object.values(p)) {
      if (!bloco) continue;
      if (bloco.acoes && Object.prototype.hasOwnProperty.call(bloco.acoes, chave)) {
        return Boolean(bloco.ativo) && Boolean(bloco.acoes[chave]);
      }
      if (bloco.colunas && Object.prototype.hasOwnProperty.call(bloco.colunas, chave)) {
        return Boolean(bloco.ativo) && Boolean(bloco.colunas[chave]);
      }
    }
    // Chave que não existe no catálogo: não bloqueia (evita esconder tela por
    // marcação errada no HTML).
    return true;
  }

  /** Desabilita um elemento de ação mantendo-o visível. */
  // Guarda o que o elemento era ANTES de ser bloqueado, para conseguir desfazer.
  const bloqueados = new WeakMap();

  function desabilitar(el) {
    if (!el || el.dataset.permAplicado === 'negado') return;

    const bloqueia = ev => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (typeof global.showToast === 'function') global.showToast(MSG_BLOQUEIO, 'error');
    };
    bloqueados.set(el, {
      titulo: el.getAttribute('title'),
      opacidade: el.style.opacity,
      cursor: el.style.cursor,
      handler: bloqueia
    });

    el.dataset.permAplicado = 'negado';
    el.classList.add('perm-negado');
    if ('disabled' in el) el.disabled = true;
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('title', MSG_BLOQUEIO);
    el.style.opacity = el.style.opacity || '0.45';
    el.style.cursor = 'not-allowed';
    // Bloqueia o clique mesmo em elementos que não aceitam "disabled" (a, div, i).
    el.addEventListener('click', bloqueia, true);
  }

  /**
   * Desfaz o bloqueio. Necessário porque as permissões podem mudar durante a
   * sessão (o perfil é editado e salvo): sem isto, um botão que foi negado uma
   * vez permanecia morto até reiniciar o app.
   */
  function reabilitar(el) {
    if (!el || el.dataset.permAplicado !== 'negado') return;
    const antes = bloqueados.get(el);
    bloqueados.delete(el);

    delete el.dataset.permAplicado;
    el.classList.remove('perm-negado');
    if ('disabled' in el) el.disabled = false;
    el.removeAttribute('aria-disabled');

    if (antes?.handler) el.removeEventListener('click', antes.handler, true);
    if (antes?.titulo) el.setAttribute('title', antes.titulo);
    else el.removeAttribute('title');
    el.style.opacity = antes?.opacidade || '';
    el.style.cursor = antes?.cursor || '';
  }

  /** Aplica somente ações (desabilita) e colunas (esconde) — sem mexer no menu. */
  function aplicarAcoesEColunas(raiz = document) {
    if (!ESTADO.carregado || !raiz) return;

    // Ações: desabilita mantendo visível — e REABILITA se a permissão voltou.
    raiz.querySelectorAll('[data-perm]').forEach(el => {
      const chave = el.getAttribute('data-perm');
      if (!chave) return;
      if (pode(chave)) reabilitar(el);
      else desabilitar(el);
    });

    // Blocos inteiros: some quando negado, volta quando liberado.
    // Terceiro mecanismo, ao lado de `data-perm` (desabilita a ação, mantendo
    // visível) e `data-perm-col` (esconde a coluna). É o que permissões do tipo
    // "Ver lista" precisam: sem elas a grade não deve nem ser exibida — não faz
    // sentido mostrar a tabela com todos os botões desabilitados.
    raiz.querySelectorAll('[data-perm-hide]').forEach(el => {
      const chave = el.getAttribute('data-perm-hide');
      if (!chave) return;
      if (pode(chave)) {
        if (el.dataset.permOculto === '1') {
          delete el.dataset.permOculto;
          el.classList.remove('hidden');
          el.style.display = '';
        }
      } else {
        el.dataset.permOculto = '1';
        el.classList.add('hidden');
        el.style.display = 'none';
      }
    });

    // Colunas: sai da tabela quando negada, volta quando liberada.
    raiz.querySelectorAll('[data-perm-col]').forEach(el => {
      const chave = el.getAttribute('data-perm-col');
      if (!chave) return;
      if (pode(chave)) {
        if (el.dataset.permOculto === '1') {
          delete el.dataset.permOculto;
          el.classList.remove('hidden');
          el.style.display = '';
        }
      } else {
        el.dataset.permOculto = '1';
        el.classList.add('hidden');
        el.style.display = 'none';
      }
    });
  }

  /** Aplica as permissões em uma raiz (documento ou modal recém-aberto). */
  function aplicar(raiz = document) {
    if (!ESTADO.carregado) return;

    // 1) Menu: o módulo SÓ aparece com a marca `data-perm-liberado`, posta
    // aqui conforme a permissão ATUAL (e tirada quando ela é retirada). Sem a
    // marca o item fica escondido pela folha do menu — é o estado em que ele
    // nasce, então nada proibido chega a ser desenhado.
    raiz.querySelectorAll('.sidebar-item[data-page], .submenu-item[data-page]').forEach(item => {
      const page = item.getAttribute('data-page');
      if (!page) return;
      item.toggleAttribute('data-perm-liberado', moduloAtivo(page));
    });
    // Grupo do menu (CRM, Laminação) sem nenhum módulo liberado some junto.
    raiz.querySelectorAll('.submenu').forEach(submenu => {
      const grupo = submenu.previousElementSibling;
      if (!grupo || !grupo.classList?.contains('sidebar-item')) return;
      grupo.toggleAttribute('data-perm-liberado', Boolean(submenu.querySelector('.submenu-item[data-perm-liberado]')));
    });

    // 2) e 3) ações e colunas
    aplicarAcoesEColunas(raiz);
  }

  /** Bloqueia navegação para um módulo sem permissão. */
  function podeAbrirPagina(page) {
    return moduloAtivo(page);
  }

  // --------------------------------------------------------------------
  // Observador do DOM.
  //
  // As tabelas são preenchidas DEPOIS que os dados chegam da API, então
  // `aplicarAcoesEColunas` — que rodava uma única vez ao abrir o módulo —
  // nunca via as linhas. Os botões de editar/excluir de cada linha nasciam
  // liberados. O observador trata tudo que aparece depois.
  // --------------------------------------------------------------------
  let observador = null;

  function tratarNovosNos(nos) {
    if (!ESTADO.carregado || liberaTudo()) return;
    // UMA PASSADA POR CONJUNTO, não uma por nó.
    //
    // Uma tabela é montada de uma vez, e o observador recebe todas as linhas na
    // MESMA mutação. Tratar nó a nó fazia, para cada linha, uma varredura e a
    // conferência de cada ícone: numa tabela cheia são milhares de idas ao DOM
    // toda vez que o módulo abre — e de novo a cada filtro.
    //
    // Aplicar no PAI comum cobre exatamente os mesmos elementos, de uma vez.
    const alvos = new Set();
    nos.forEach(no => {
      if (!no || no.nodeType !== 1) return;
      // o próprio nó pode ser o alvo
      if (no.hasAttribute?.('data-perm') || no.hasAttribute?.('data-perm-col')
          || no.hasAttribute?.('data-perm-hide')) {
        alvos.add(no.parentElement || document);
        return;
      }
      if (no.querySelector?.('[data-perm], [data-perm-col], [data-perm-hide]')) {
        alvos.add(no);
      }
    });

    if (!alvos.size) return;

    // Irmãos entram juntos: se dois ou mais alvos dividem o mesmo pai, o pai
    // responde por todos.
    const quantosPorPai = new Map();
    alvos.forEach(alvo => {
      const pai = alvo.parentElement;
      if (pai) quantosPorPai.set(pai, (quantosPorPai.get(pai) || 0) + 1);
    });

    const finais = new Set();
    alvos.forEach(alvo => {
      const pai = alvo.parentElement;
      finais.add(pai && quantosPorPai.get(pai) > 1 ? pai : alvo);
    });

    finais.forEach(alvo => aplicarAcoesEColunas(alvo));
  }

  function observarDom() {
    if (observador || typeof MutationObserver !== 'function') return;
    observador = new MutationObserver(mutacoes => {
      for (const m of mutacoes) {
        if (m.addedNodes?.length) tratarNovosNos(Array.from(m.addedNodes));
      }
    });
    observador.observe(document.body, { childList: true, subtree: true });
  }

  async function init(raiz = document) {
    await carregar();
    aplicar(raiz);
    observarDom();
    return ESTADO.permissoes;
  }

  global.Permissoes = {
    init,
    carregar,
    aplicar,
    aplicarAcoesEColunas,
    pode,
    moduloAtivo,
    podeAbrirPagina,
    // Recarrega E reaplica: salvar o perfil sem reaplicar deixava a interface
    // exibindo o estado antigo até reiniciar o app.
    recarregar: async (raiz = document) => {
      await carregar(true);
      aplicar(raiz);
      return ESTADO.permissoes;
    },
    get estado() { return ESTADO.permissoes; },
    // As permissões não chegaram (API fora): o menu fica vazio e o menu.js
    // mostra o aviso de "tentando de novo" em vez de um módulo.
    get indisponivel() { return Boolean(ESTADO.indisponivel); },
    get carregado() { return Boolean(ESTADO.carregado); },
    // Alguns controles não são regidos por permissão de módulo e sim pelo
    // PERFIL — excluir linha do histórico de prospecção, por exemplo. O
    // backend é quem decide (exigirSupAdmin); isto existe só para a interface
    // não oferecer um botão que vai voltar 403.
    get supAdmin() { return Boolean(ESTADO.supAdmin); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})(window);
