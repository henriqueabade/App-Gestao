/**
 * Boletos em PDF no renderer: um boleto (pela linha da parcela) ou todos os
 * boletos a pagar do pedido. O HTML vem do backend
 * (GET /api/cobranca/boletos/:id/documento e
 * GET /api/cobranca/pedidos/:id/boletos/documento), vira PDF pelo Electron,
 * em retrato, como o DANFE, e abre no "Visualizar documento" (Visualizador
 * de PDF, Fase 2): de lá se imprime ou se salva. Nada é enviado ao cliente.
 */
(function () {
  async function fetchApi(caminho) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`);
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
      e.status = resposta.status;
      throw e;
    }
    return corpo;
  }

  const avisar = (texto, tipo) => window.showToast?.(texto, tipo || 'info');

  /**
   * O boleto no "Visualizar documento" (Visualizador de PDF, Fase 2; antes
   * salvava): o mesmo HTML do backend impresso pelo Electron, em retrato. O
   * erro ao buscar aparece no próprio modal, com "Tentar de novo".
   */
  function abrirNoVisualizador(caminho, titulo, tituloSalvar) {
    if (!window.VisualizadorPdf) { avisar('Visualizador de documentos indisponível nesta janela.', 'error'); return Promise.resolve(false); }
    window.VisualizadorPdf.abrir({
      titulo,
      tituloSalvar,
      gerar: async () => {
        let corpo;
        try {
          corpo = await fetchApi(caminho);
        } catch (e) {
          throw new Error(e.status === 403 ? 'Você não tem permissão para ver boletos.' : (e.message || 'Não foi possível montar o boleto.'));
        }
        const pdf = await window.VisualizadorPdf.deHtml(corpo.html, { retrato: true })();
        return { ...pdf, nomeArquivo: corpo.nome, subtitulo: corpo.nome };
      }
    });
    return Promise.resolve(true);
  }

  /** Um boleto (a parcela). */
  function gerarBoletoPdf(boletoId) {
    if (!boletoId) return Promise.resolve(false);
    return abrirNoVisualizador(`/api/cobranca/boletos/${encodeURIComponent(boletoId)}/documento`, 'Boleto', 'Salvar boleto em PDF');
  }

  /** Todos os boletos a pagar do pedido, uma página por parcela. */
  function gerarBoletosDoPedidoPdf(pedidoId) {
    if (!pedidoId) return Promise.resolve(false);
    return abrirNoVisualizador(`/api/cobranca/pedidos/${encodeURIComponent(pedidoId)}/boletos/documento`, 'Boletos do pedido', 'Salvar boletos em PDF');
  }

  window.BoletoDocumentos = { gerarBoletoPdf, gerarBoletosDoPedidoPdf };
})();
