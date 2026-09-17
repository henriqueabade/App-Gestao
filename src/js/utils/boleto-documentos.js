/**
 * Boletos em PDF no renderer: um boleto (pela linha da parcela) ou todos os
 * boletos a pagar do pedido. O HTML vem do backend
 * (GET /api/cobranca/boletos/:id/documento e
 * GET /api/cobranca/pedidos/:id/boletos/documento) e vira PDF pelo Electron,
 * em retrato, como o DANFE. Nada é enviado ao cliente.
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

  async function salvarPdf(caminho, titulo, rotuloOk) {
    try {
      const corpo = await fetchApi(caminho);
      const r = await window.electronAPI?.salvarHtmlComoPdf?.({ html: corpo.html, nomeSugerido: corpo.nome, titulo, retrato: true });
      if (!r) { avisar('Geração de PDF indisponível nesta janela.', 'error'); return false; }
      if (r.success) { avisar(r.opened ? `${rotuloOk} salvo e aberto.` : (r.message || `${rotuloOk} salvo.`), 'success'); return true; }
      if (!r.canceled) avisar(r.message || 'Não foi possível gerar o PDF do boleto.', 'error');
      return false;
    } catch (e) {
      avisar(e.status === 403 ? 'Você não tem permissão para ver boletos.' : (e.message || 'Não foi possível montar o boleto.'), 'error');
      return false;
    }
  }

  /** Um boleto (a parcela). */
  function gerarBoletoPdf(boletoId) {
    if (!boletoId) return Promise.resolve(false);
    return salvarPdf(`/api/cobranca/boletos/${encodeURIComponent(boletoId)}/documento`, 'Salvar boleto em PDF', 'Boleto');
  }

  /** Todos os boletos a pagar do pedido, uma página por parcela. */
  function gerarBoletosDoPedidoPdf(pedidoId) {
    if (!pedidoId) return Promise.resolve(false);
    return salvarPdf(`/api/cobranca/pedidos/${encodeURIComponent(pedidoId)}/boletos/documento`, 'Salvar boletos em PDF', 'Boletos');
  }

  window.BoletoDocumentos = { gerarBoletoPdf, gerarBoletosDoPedidoPdf };
})();
