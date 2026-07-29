/**
 * Aplicação das permissões na interface.
 *
 * Regras definidas para o projeto:
 *   - Módulo sem permissão  -> some do menu e a navegação direta é bloqueada.
 *   - Ação sem permissão    -> o botão CONTINUA VISÍVEL, porém desabilitado.
 *   - Coluna sem permissão  -> não é renderizada na tabela.
 *   - O backend também recusa (403) — a interface é conveniência, não segurança.
 *
 * Como marcar os elementos no HTML:
 *   <button data-perm="mp.delete">Excluir</button>          (ação -> desabilita)
 *   <th data-perm-col="col_mp_custo_medio">Custo médio</th>  (coluna -> some)
 *   <td data-perm-col="col_mp_custo_medio">…</td>
 *   <div class="sidebar-item" data-page="materia-prima">     (módulo -> some)
 */
(function (global) {
  const ESTADO = {
    permissoes: null,
    catalogo: null,
    paginas: {},
    carregado: false,
    // Quando não conseguimos carregar as permissões (API fora, erro de rede),
    // a interface NÃO restringe nada. Bloquear tudo deixaria o app inutilizável
    // por um problema de rede. A segurança real continua no backend, que recusa
    // as requisições sem permissão (403).
    indisponivel: false,
    supAdmin: false
  };

  const MSG_BLOQUEIO = 'Você não tem permissão para esta ação.';

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

  async function carregar(force = false) {
    if (ESTADO.carregado && !force) return ESTADO.permissoes;
    try {
      const url = `${await baseUrl()}/api/permissoes/efetivas`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const dados = await resp.json();

      // O backend sinaliza erro interno com { erro: true }: nesse caso não
      // restringe a interface (o backend segue protegendo as rotas).
      if (dados?.erro) throw new Error('backend sinalizou falha ao apurar permissões');

      ESTADO.permissoes = dados?.permissoes || {};
      ESTADO.paginas = dados?.paginas || {};
      // O backend já informa se é Sup Admin; a checagem local é redundância.
      ESTADO.supAdmin = Boolean(dados?.supAdmin) || ehSupAdmin(dados?.perfil);
      ESTADO.indisponivel = false;
      ESTADO.carregado = true;
    } catch (err) {
      console.warn('[permissoes] não foi possível carregar as permissões; a interface não será restringida (o backend continua validando).', err);
      ESTADO.permissoes = {};
      ESTADO.indisponivel = true;
      ESTADO.carregado = true;
    }
    return ESTADO.permissoes;
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

  /** Libera tudo: Sup Admin, ou permissões indisponíveis (não restringe a UI). */
  function liberaTudo() {
    return ESTADO.supAdmin || ESTADO.indisponivel || !ESTADO.carregado;
  }

  /** Módulo visível no menu? */
  function moduloAtivo(codigoOuPagina) {
    if (liberaTudo()) return true;
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

    // 1) Menu: esconde OU mostra o módulo conforme a permissão ATUAL.
    // Antes isto era mão única (só escondia). Depois de reativar um módulo,
    // o item continuava com display:none até reiniciar o app — era por isso
    // que "nenhum aparecia no menu mesmo estando ativo".
    raiz.querySelectorAll('.sidebar-item[data-page], .submenu-item[data-page]').forEach(item => {
      const page = item.getAttribute('data-page');
      if (!page) return;
      if (moduloAtivo(page)) {
        // só devolvemos o que NÓS escondemos, para não brigar com o menu
        // (submenu do CRM recolhido, por exemplo)
        if (item.dataset.permOculto === '1') {
          delete item.dataset.permOculto;
          item.classList.remove('hidden');
          item.style.display = '';
        }
      } else {
        item.dataset.permOculto = '1';
        item.classList.add('hidden');
        item.style.display = 'none';
      }
    });

    // 2) e 3) ações e colunas
    aplicarAcoesEColunas(raiz);
  }

  /** Bloqueia navegação para um módulo sem permissão. */
  function podeAbrirPagina(page) {
    return moduloAtivo(page);
  }

  async function init(raiz = document) {
    await carregar();
    aplicar(raiz);
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
    get estado() { return ESTADO.permissoes; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})(window);
