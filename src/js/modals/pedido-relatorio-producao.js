/**
 * Relatório de produção de um pedido.
 *
 * Monta a folha e manda para impressão. Duas regras de papel, que são o motivo
 * de a folha ser gerada aqui e não reaproveitar a tela:
 *
 *  - **Paisagem**, via `@page { size: A4 landscape }`.
 *  - **Um processo por folha, nunca dois na mesma.** Cada processo é um bloco
 *    com `break-after: page`. Se um processo não couber, ele continua na folha
 *    seguinte — o que não pode é o processo B começar no que sobrou da folha do
 *    processo A.
 *
 * Os dados vêm da FOTO congelada na conversão (`pedidos_itens_faltantes`), não
 * de um recálculo: o papel que vai para a produção precisa dizer o que foi
 * decidido quando o pedido nasceu.
 */
(async () => {
  const overlayId = 'relatorioProducao';
  const overlay = document.getElementById('relatorioProducaoOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const contexto = window.relatorioProducaoContext || {};
  delete window.relatorioProducaoContext;
  const pedidoId = contexto.pedidoId ?? contexto.id ?? window.selectedOrderId;

  const close = () => Modal.close(overlayId);
  document.getElementById('voltarRelatorioProducao')?.addEventListener('click', close);
  document.getElementById('fecharRelatorioProducao')?.addEventListener('click', close);
  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    document.removeEventListener('keydown', aoTeclar);
    close();
  }
  document.addEventListener('keydown', aoTeclar);

  const corpo = document.getElementById('relatorioProducaoCorpo');
  const subtitulo = document.getElementById('relatorioProducaoSubtitulo');
  const btnImprimir = document.getElementById('imprimirRelatorioProducao');

  function escapar(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Até 4 casas, sem zeros à direita — o padrão numérico do app. */
  function formatarQuantidade(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }

  function formatarData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  }

  function linhasDaPeca(peca) {
    return peca.itens.map(item => `
      <tr>
        <td class="rp-item">${escapar(item.insumo_nome)}</td>
        <td class="rp-qtd">${escapar(formatarQuantidade(item.quantidade))}</td>
        <td class="rp-un">${escapar(item.unidade || '')}</td>
      </tr>`).join('');
  }

  function folhaDoProcesso(grupo, pedido) {
    const pecas = grupo.pecas.map(peca => `
      <tr class="rp-faixa-peca"><td colspan="3">${escapar(peca.peca)}</td></tr>
      ${linhasDaPeca(peca)}
    `).join('');

    const linhas = lista => (lista || []).map(t => `
      <tr>
        <td class="rp-item">${escapar(t.insumo_nome)}</td>
        <td class="rp-qtd">${escapar(formatarQuantidade(t.quantidade))}</td>
        <td class="rp-un">${escapar(t.unidade || '')}</td>
      </tr>`).join('');

    const totais = linhas(grupo.totais);
    // Sem faltantes o processo está coberto pelo estoque — dizer isso é melhor
    // que uma tabela vazia, que se lê como "não calculado".
    const faltantes = grupo.faltantes?.length
      ? linhas(grupo.faltantes)
      : '<tr><td colspan="3" class="rp-vazio">Nenhum item em falta: o estoque cobria este processo.</td></tr>';

    return `
      <section class="rp-folha">
        <header class="rp-cabecalho">
          <div>
            <h2>Pedido ${escapar(pedido.numero || pedido.id)}</h2>
            <p>${escapar(contexto.cliente || '')} &middot; emitido em ${escapar(formatarData(pedido.data_emissao))}</p>
          </div>
          <div class="rp-processo-nome">${escapar(grupo.processo)}</div>
        </header>

        <table class="rp-tabela">
          <thead><tr class="rp-faixa-processo"><th colspan="3">Processo ${escapar(grupo.processo)}</th></tr></thead>
          <tbody>${pecas}</tbody>
        </table>

        <table class="rp-tabela rp-tabela-total">
          <thead><tr class="rp-faixa-total"><th colspan="3">Total Processo ${escapar(grupo.processo)}</th></tr></thead>
          <tbody>${totais}</tbody>
        </table>

        <table class="rp-tabela rp-tabela-falta">
          <thead><tr class="rp-faixa-falta"><th colspan="3">Itens Fora do Estoque — Processo ${escapar(grupo.processo)}</th></tr></thead>
          <tbody>${faltantes}</tbody>
        </table>
      </section>`;
  }

  function renderizarVazio(mensagem) {
    corpo.innerHTML = `
      <div class="py-16 text-center">
        <i class="fas fa-clipboard-list text-4xl text-gray-500 mb-4"></i>
        <p class="text-gray-300 font-medium">${escapar(mensagem)}</p>
      </div>`;
    if (btnImprimir) btnImprimir.disabled = true;
  }

  async function carregar() {
    if (!pedidoId) {
      renderizarVazio('Pedido não identificado.');
      return;
    }
    try {
      const resp = await fetchApi(`/api/pedidos/${pedidoId}/relatorio-producao`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const dados = await resp.json();

      if (subtitulo) {
        subtitulo.textContent = `Pedido ${dados.pedido?.numero || pedidoId}`;
      }

      if (!Array.isArray(dados.processos) || !dados.processos.length) {
        renderizarVazio(
          'Este pedido não tem registro de produção. Só pedidos convertidos depois desta versão têm a foto do que faltava.'
        );
        return;
      }

      corpo.innerHTML = dados.processos.map(g => folhaDoProcesso(g, dados.pedido || {})).join('');
      if (btnImprimir) btnImprimir.disabled = false;
    } catch (err) {
      console.error('Erro ao carregar o relatório de produção', err);
      renderizarVazio('Não foi possível carregar o relatório de produção.');
    }
  }

  btnImprimir?.addEventListener('click', () => {
    // `print()` da própria janela: o CSS de impressão esconde tudo menos a
    // folha, então o que sai no papel é só o relatório.
    document.body.classList.add('imprimindo-relatorio-producao');
    const limpar = () => {
      document.body.classList.remove('imprimindo-relatorio-producao');
      window.removeEventListener('afterprint', limpar);
    };
    window.addEventListener('afterprint', limpar);
    window.print();
    // Alguns ambientes não disparam `afterprint`; a limpeza tardia evita a tela
    // ficar presa no modo de impressão.
    setTimeout(limpar, 3000);
  });

  await carregar();

  if (typeof Modal?.signalReady === 'function') Modal.signalReady(overlayId);
  window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
})();
