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
    carregado: false
  };

  const MSG_BLOQUEIO = 'Você não tem permissão para esta ação.';

  function baseUrl() {
    if (global.apiConfig?.getApiBaseUrlSync) return global.apiConfig.getApiBaseUrlSync();
    return '';
  }

  async function carregar(force = false) {
    if (ESTADO.carregado && !force) return ESTADO.permissoes;
    try {
      const resp = await fetch(`${baseUrl()}/api/permissoes/efetivas`);
      const dados = await resp.json();
      ESTADO.permissoes = dados?.permissoes || {};
      ESTADO.carregado = true;
    } catch (err) {
      console.error('[permissoes] falha ao carregar; aplicando modo restrito.', err);
      ESTADO.permissoes = {}; // fail-safe: nada liberado
      ESTADO.carregado = true;
    }
    return ESTADO.permissoes;
  }

  /** Módulo visível no menu? */
  function moduloAtivo(codigoOuPagina) {
    const p = ESTADO.permissoes || {};
    if (p[codigoOuPagina]) return Boolean(p[codigoOuPagina].ativo);
    // procura por "page" (ex.: "materia-prima" -> mp)
    for (const bloco of Object.values(p)) {
      if (bloco && bloco.page === codigoOuPagina) return Boolean(bloco.ativo);
    }
    return false;
  }

  /** Permissão de ação ou coluna ("mp.view", "col_mp_codigo"). */
  function pode(chave) {
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
    return false;
  }

  /** Desabilita um elemento de ação mantendo-o visível. */
  function desabilitar(el) {
    if (!el || el.dataset.permAplicado === 'negado') return;
    el.dataset.permAplicado = 'negado';
    el.classList.add('perm-negado');
    if ('disabled' in el) el.disabled = true;
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('title', MSG_BLOQUEIO);
    el.style.opacity = el.style.opacity || '0.45';
    el.style.cursor = 'not-allowed';
    // Bloqueia o clique mesmo em elementos que não aceitam "disabled" (a, div, i).
    el.addEventListener(
      'click',
      ev => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (typeof global.showToast === 'function') global.showToast(MSG_BLOQUEIO, 'error');
      },
      true
    );
  }

  /** Aplica somente ações (desabilita) e colunas (esconde) — sem mexer no menu. */
  function aplicarAcoesEColunas(raiz = document) {
    if (!ESTADO.carregado || !raiz) return;

    // Ações: desabilita, mantendo visível
    raiz.querySelectorAll('[data-perm]').forEach(el => {
      const chave = el.getAttribute('data-perm');
      if (chave && !pode(chave)) desabilitar(el);
    });

    // Colunas: remove da tabela (cabeçalho e células)
    raiz.querySelectorAll('[data-perm-col]').forEach(el => {
      const chave = el.getAttribute('data-perm-col');
      if (chave && !pode(chave)) {
        el.classList.add('hidden');
        el.style.display = 'none';
      }
    });
  }

  /** Aplica as permissões em uma raiz (documento ou modal recém-aberto). */
  function aplicar(raiz = document) {
    if (!ESTADO.carregado) return;

    // 1) Menu: esconde módulos sem permissão (só itens de navegação da sidebar)
    raiz.querySelectorAll('.sidebar-item[data-page], .submenu-item[data-page]').forEach(item => {
      const page = item.getAttribute('data-page');
      if (!page) return;
      if (!moduloAtivo(page)) {
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
    recarregar: () => carregar(true),
    get estado() { return ESTADO.permissoes; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})(window);
