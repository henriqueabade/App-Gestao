/**
 * Documentos da NF-e no renderer: DANFE em PDF e XML salvo em arquivo.
 *
 * Um lugar só porque a mesma ação sai de mais de uma tela (a tag "DANFE" na
 * lista de pedidos e os botões do Visualizar pedido). O HTML do DANFE vem do
 * backend (GET /api/fiscal/notas/:id/danfe) e vira PDF pelo Electron, em
 * retrato; o XML vai para um .xml escolhido pelo usuário.
 */
(function () {
  async function fetchApi(caminho, opcoes) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`, opcoes);
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
      e.status = resposta.status;
      e.corpo = corpo;
      throw e;
    }
    return corpo;
  }

  const avisar = (texto, tipo) => window.showToast?.(texto, tipo || 'info');

  /** Gera e abre o DANFE da nota. Devolve true quando o PDF foi salvo. */
  async function gerarDanfe(notaId) {
    if (!notaId) return false;
    try {
      const corpo = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(notaId)}/danfe`);
      const r = await window.electronAPI?.salvarHtmlComoPdf?.({ html: corpo.html, nomeSugerido: corpo.nome, titulo: 'Salvar DANFE em PDF', retrato: true });
      if (!r) { avisar('Geração de PDF indisponível nesta janela.', 'error'); return false; }
      if (r.success) { avisar(r.opened ? 'DANFE salvo e aberto.' : (r.message || 'DANFE salvo.'), 'success'); return true; }
      if (!r.canceled) avisar(r.message || 'Não foi possível gerar o DANFE.', 'error');
      return false;
    } catch (e) {
      avisar(e.message || 'Não foi possível montar o DANFE.', 'error');
      return false;
    }
  }

  /** Salva o XML de distribuição e, se houver, o do cancelamento. */
  async function salvarXml(notaId) {
    if (!notaId) return false;
    try {
      const corpo = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(notaId)}/xml`);
      const salvar = (conteudo, nome, titulo) => window.electronAPI?.salvarTextoComoArquivo?.({ conteudo, nomeSugerido: nome, extensao: 'xml', titulo, descricao: 'XML da NF-e' });
      const r = await salvar(corpo.xml, corpo.nome, 'Salvar XML da NF-e');
      if (!r) { avisar('Salvar arquivo indisponível nesta janela.', 'error'); return false; }
      if (!r.success) { if (!r.canceled) avisar(r.message || 'Não foi possível salvar o XML.', 'error'); return false; }
      avisar('XML da NF-e salvo.', 'success');
      if (corpo.xml_cancelamento) {
        const rc = await salvar(corpo.xml_cancelamento, corpo.nome_cancelamento, 'Salvar XML do cancelamento');
        if (rc?.success) avisar('XML do cancelamento salvo.', 'success');
      }
      return true;
    } catch (e) {
      avisar(e.message || 'Não foi possível ler o XML.', 'error');
      return false;
    }
  }

  window.NfeDocumentos = { gerarDanfe, salvarXml };
})();
