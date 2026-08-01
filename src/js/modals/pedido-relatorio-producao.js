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

  function renderizarVazio(mensagem, icone = 'fa-clipboard-list') {
    corpo.innerHTML = `
      <div class="py-16 px-6 text-center max-w-2xl mx-auto">
        <i class="fas ${escapar(icone)} text-4xl text-gray-500 mb-4"></i>
        <p class="text-gray-300 font-medium" style="white-space: pre-line">${escapar(mensagem)}</p>
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
        // Três motivos diferentes para não haver folha. Dizer qual é evita que
        // o usuário leia ausência de relatório como defeito.
        if (dados.somentePecasProntas) {
          renderizarVazio(
            'Não há relatório de produção para este pedido.\n\n'
            + 'Todas as peças foram atendidas com produtos prontos do estoque — '
            + 'nada precisa ser fabricado e nenhum insumo foi consumido.',
            'fa-box-open'
          );
        } else if (!dados.temItens) {
          renderizarVazio('Este pedido não tem itens.');
        } else {
          renderizarVazio(
            'Este pedido não tem registro de produção.\n\n'
            + 'A foto do que faltava passou a ser gravada na conversão a partir desta versão; '
            + 'pedidos convertidos antes disso não têm esse registro.'
          );
        }
        return;
      }

      corpo.innerHTML = dados.processos.map(g => folhaDoProcesso(g, dados.pedido || {})).join('');
      if (btnImprimir) btnImprimir.disabled = false;
    } catch (err) {
      console.error('Erro ao carregar o relatório de produção', err);
      renderizarVazio('Não foi possível carregar o relatório de produção.');
    }
  }

  // ------------------------------------------------------------------
  // Gerar o PDF
  //
  // A folha é enviada pronta para o processo principal, que a renderiza numa
  // janela oculta e chama `printToPDF` — o mesmo caminho do PDF de pedido, já
  // provado. O CSS vai por link para o `pedidos.css` real: duplicar os estilos
  // aqui garantiria que o papel e a tela divergissem com o tempo.
  //
  // Gerar leva alguns segundos. Sem dizer isso na tela, o usuário acha que
  // travou — por isso o botão vira "Gerando PDF..." e o aviso aparece.
  // ------------------------------------------------------------------
  function montarDocumentoParaPdf(pedidoNumero) {
    const cssPedidos = new URL('../css/pedidos.css', document.baseURI).href;
    const cssTailwind = new URL('../styles/tailwind-offline.css', document.baseURI).href;
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Relatório de Produção — ${escapar(pedidoNumero)}</title>
<link rel="stylesheet" href="${cssTailwind}" />
<link rel="stylesheet" href="${cssPedidos}" />
<style>
  /* A janela do PDF não tem o tema do app: fundo branco e as folhas soltas. */
  body { background: #fff; margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .rp-folha { box-shadow: none; border-radius: 0; margin: 0; padding: 0; }
</style>
</head>
<body>${corpo.innerHTML}</body>
</html>`;
  }

  function mostrarProgresso(ligado, texto) {
    if (!btnImprimir) return;
    btnImprimir.innerHTML = ligado
      ? `<i class="fas fa-circle-notch fa-spin"></i> ${escapar(texto || 'Gerando PDF...')}`
      : '<i class="fas fa-print"></i> Imprimir';
    const aviso = document.getElementById('relatorioProducaoAviso');
    if (aviso) {
      aviso.textContent = ligado ? (texto || 'Gerando o PDF do relatório...') : '';
      aviso.classList.toggle('hidden', !ligado);
    }
  }

  async function gerarPdf() {
    if (!corpo?.innerHTML?.trim()) return;

    mostrarProgresso(true, 'Gerando o PDF do relatório...');
    try {
      if (!window.electronAPI?.salvarHtmlComoPdf) {
        throw new Error('Geração de PDF indisponível neste ambiente.');
      }
      const numero = subtitulo?.textContent?.replace(/^Pedido\s*/i, '').trim() || pedidoId;
      const resultado = await window.electronAPI.salvarHtmlComoPdf({
        html: montarDocumentoParaPdf(numero),
        nomeSugerido: `relatorio-producao-${numero}`,
        titulo: 'Salvar Relatório de Produção em PDF'
      });

      if (resultado?.canceled) {
        window.showToast?.('Geração cancelada.', 'info');
      } else if (resultado?.success) {
        window.showToast?.(resultado.message || 'Relatório salvo em PDF.', 'success');
      } else {
        throw new Error(resultado?.message || 'Não foi possível gerar o PDF.');
      }
    } catch (err) {
      console.error('Erro ao gerar o PDF do relatório de produção', err);
      window.showToast?.(err?.message || 'Erro ao gerar o PDF.', 'error');
    } finally {
      mostrarProgresso(false);
    }
  }

  // `BotaoAcao.bind` dá a trava de duplo clique; o texto de progresso é nosso,
  // porque o spinner padrão esconderia o rótulo e não diria o que está havendo.
  if (window.BotaoAcao?.bind) {
    window.BotaoAcao.bind(btnImprimir, gerarPdf, { visual: false });
  } else {
    let gerando = false;
    btnImprimir?.addEventListener('click', async () => {
      if (gerando) return;
      gerando = true;
      try { await gerarPdf(); } finally { gerando = false; }
    });
  }

  await carregar();

  if (typeof Modal?.signalReady === 'function') Modal.signalReady(overlayId);
  window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
})();
