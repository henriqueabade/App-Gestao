/**
 * "Filtros avançados" retráteis no card de filtros — o padrão que nasceu em
 * Prospecções e passou a valer em Produtos, Orçamentos e Pedidos (dono,
 * 08/10/2026): um botão com a setinha no fim da barra e um painel que nasce
 * FECHADO e cresce para baixo, dentro do próprio card.
 *
 *   const controle = window.FiltrosAvancados.ligar({ botao, painel, aoAbrir });
 *   controle.abrir(); controle.fechar(); controle.sinalizar(true|false);
 *
 * Casa (HTML):
 *   <button class="btn-neutral ctl-botao botao-filtros-avancados" aria-expanded="false" aria-controls="x">
 *     <i class="fas fa-sliders mr-2"></i>Filtros avançados
 *     <i class="fas fa-chevron-down ml-2 text-xs botao-filtros-avancados__seta"></i>
 *   </button>
 *   <div id="x" class="filtros-avancados" aria-hidden="true"><div>…campos…</div></div>
 *
 * A animação é por max-height medido na hora (o truque de grid 0fr → 1fr não
 * abria neste Chromium — ver src/css/prospeccoes.css). Aberto, o max-height
 * vira `none` para não cortar os campos se a janela encolher.
 *
 * Nos módulos em que só a tabela rola (`#content.no-scroll`, posto pelo
 * menu.js), o painel aberto deixaria o fim da tabela fora da tela: enquanto
 * ele está aberto a página volta a rolar, como em Prospecções.
 */
(() => {
  if (window.FiltrosAvancados) return;

  function ligar({ botao, painel, aoAbrir = null } = {}) {
    if (!botao || !painel) return null;
    if (painel.__filtrosAvancados) return painel.__filtrosAvancados;

    const content = () => document.getElementById('content');

    function alternar(vaiAbrir) {
      painel.classList.toggle('aberto', vaiAbrir);
      painel.setAttribute('aria-hidden', String(!vaiAbrir));
      botao.setAttribute('aria-expanded', String(vaiAbrir));
      if (vaiAbrir) {
        painel.style.maxHeight = `${painel.scrollHeight}px`;
        painel.addEventListener('transitionend', function solta(e) {
          if (e.propertyName !== 'max-height') return;
          if (painel.classList.contains('aberto')) painel.style.maxHeight = 'none';
          painel.removeEventListener('transitionend', solta);
        });
        // A página precisa rolar enquanto o painel está aberto.
        const c = content();
        if (c?.classList.contains('no-scroll')) {
          c.classList.remove('no-scroll');
          painel.dataset.tirouNoScroll = '1';
        }
        if (typeof aoAbrir === 'function') aoAbrir();
      } else {
        // De `none` direto para 0 não anima: parte da altura atual, com o
        // layout forçado na hora (requestAnimationFrame não chega com a
        // janela em segundo plano e o painel ficava aberto).
        painel.style.maxHeight = `${painel.scrollHeight}px`;
        void painel.offsetHeight;
        painel.style.maxHeight = '0px';
        if (painel.dataset.tirouNoScroll === '1') {
          content()?.classList.add('no-scroll');
          delete painel.dataset.tirouNoScroll;
        }
      }
    }

    botao.addEventListener('click', () => alternar(!painel.classList.contains('aberto')));

    const controle = {
      abrir: () => alternar(true),
      fechar: () => alternar(false),
      estaAberto: () => painel.classList.contains('aberto'),
      /** Fechado mas filtrando: um ponto no botão avisa que a lista está filtrada. */
      sinalizar: ativo => {
        if (ativo) botao.dataset.filtrando = '1';
        else delete botao.dataset.filtrando;
        botao.title = ativo ? 'Há um filtro avançado ligado' : '';
      }
    };
    painel.__filtrosAvancados = controle;
    return controle;
  }

  const normalizar = valor => String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  /**
   * Orçamentos e Pedidos: o documento casa com a busca "cliente, peça ou
   * código"? Cada termo tem de aparecer no número, no cliente ou em alguma
   * peça. Devolve também AS PEÇAS que fizeram casar — as que a linha mostra.
   * Busca que casou só pelo cliente/número não lista peça nenhuma.
   *   documentoCasa(['jackie', 'pietra'], { numero, cliente, pecas: [{ codigo, nome, quantidade }] })
   *     → { casa: true, pecas: [a Pietra] }
   */
  function documentoCasa(termos, { numero = '', cliente = '', pecas = [] } = {}) {
    if (!Array.isArray(termos) || !termos.length) return { casa: true, pecas: [] };
    const cabeca = normalizar(`${numero} ${cliente}`);
    const textoDaPeca = p => normalizar(`${p?.codigo || ''} ${p?.nome || ''}`);
    const lista = Array.isArray(pecas) ? pecas : [];
    const precisamDaPeca = [];
    for (const termo of termos) {
      if (cabeca.includes(termo)) continue;
      if (!lista.some(p => textoDaPeca(p).includes(termo))) return { casa: false, pecas: [] };
      precisamDaPeca.push(termo);
    }
    const achadas = precisamDaPeca.length
      ? lista.filter(p => precisamDaPeca.some(t => textoDaPeca(p).includes(t)))
      : [];
    return { casa: true, pecas: achadas };
  }

  const escapar = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** As etiquetas do que o filtro achou ("BBRO 3015 (2)", "+3"), para pôr na linha. */
  function achadosHtml(rotulos = [], { maximo = 3 } = {}) {
    const lista = rotulos.filter(Boolean);
    if (!lista.length) return '';
    const itens = lista.slice(0, maximo).map(r => `<span class="filtro-avancado-achados__item" title="${escapar(r)}">${escapar(r)}</span>`);
    if (lista.length > maximo) {
      itens.push(`<span class="filtro-avancado-achados__item" title="${escapar(lista.slice(maximo).join('\n'))}">+${lista.length - maximo}</span>`);
    }
    return `<div class="filtro-avancado-achados" data-filtro-achados>${itens.join('')}</div>`;
  }

  /** "BBRO 3015 — Banco (2)": a peça como a linha mostra. */
  function rotuloDaPeca(p) {
    const nome = [p?.codigo, p?.nome].filter(Boolean).join(' — ');
    const qtd = Number(p?.quantidade);
    return Number.isFinite(qtd) && qtd > 0 ? `${nome} (${Number.isInteger(qtd) ? qtd : qtd.toLocaleString('pt-BR')})` : nome;
  }

  /** Lê `/api/vinculos-pecas/<tipo>` (as peças de cada documento) uma vez por carga. */
  function leitorDePecas(tipo) {
    let dados = null;
    let lendo = null;
    return {
      limpar() { dados = null; },
      pronto: () => Boolean(dados),
      pecas: id => (dados && dados[String(id)]) || [],
      async ler() {
        if (dados) return dados;
        if (lendo) return lendo;
        lendo = (async () => {
          try {
            const base = await window.apiConfig.getApiBaseUrl();
            const resp = await fetch(`${base}/api/vinculos-pecas/${tipo}`);
            const corpo = await resp.json().catch(() => null);
            if (!resp.ok) throw new Error(corpo?.error || `HTTP ${resp.status}`);
            dados = corpo?.pecas || {};
          } catch (err) {
            console.error(`Erro ao ler as peças (${tipo}) para o filtro avançado`, err);
            window.showToast?.('Não foi possível ler as peças para o filtro avançado.', 'error');
            dados = {};
          } finally {
            lendo = null;
          }
          return dados;
        })();
        return lendo;
      }
    };
  }

  window.FiltrosAvancados = { ligar, documentoCasa, achadosHtml, rotuloDaPeca, leitorDePecas };
})();
