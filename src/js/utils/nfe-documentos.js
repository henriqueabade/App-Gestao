/**
 * Documentos da NF-e no renderer: DANFE e carta de correção em PDF, XML salvo
 * em arquivo.
 *
 * Um lugar só porque a mesma ação sai de mais de uma tela (a tag "DANFE" na
 * lista de pedidos e os botões do Visualizar pedido). O HTML do DANFE vem do
 * backend (GET /api/fiscal/notas/:id/danfe), vira PDF pelo Electron, em
 * retrato, e abre no "Visualizar documento" (Visualizador de PDF, Fases 1 e
 * 2) — de lá se imprime ou se salva; o XML vai para um .xml escolhido pelo
 * usuário.
 *
 * As notas emitidas FORA do sistema têm os mesmos documentos, pelas rotas
 * `/api/fiscal/pedidos/:id/nfe-externa/*` — desde que o XML da nota esteja
 * anexado (é dele que sai todo o desenho). Por isso as funções `*Externa`
 * recebem o id do PEDIDO, e não o da nota.
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

  /**
   * Abre o documento no "Visualizar documento" (src/js/utils/visualizador-pdf.js,
   * 09/10/2026): o MESMO PDF que o "Salvar" fazia — o HTML do backend impresso
   * pelo Electron, em retrato —, para ver, imprimir ou salvar dali. Erro ao
   * buscar aparece no próprio modal, com "Tentar de novo".
   */
  function paraVisualizador(caminho, { titulo, tituloSalvar }) {
    if (!window.VisualizadorPdf) { avisar('Visualizador de documentos indisponível nesta janela.', 'error'); return false; }
    window.VisualizadorPdf.abrir({
      titulo,
      tituloSalvar,
      gerar: async () => {
        const corpo = await fetchApi(caminho);
        const pdf = await window.VisualizadorPdf.deHtml(corpo.html, { retrato: true })();
        return { ...pdf, nomeArquivo: corpo.nome, subtitulo: corpo.nome };
      }
    });
    return true;
  }

  /** O DANFE da nota no visualizador. */
  function verDanfe(notaId) {
    if (!notaId) return false;
    return paraVisualizador(`/api/fiscal/notas/${encodeURIComponent(notaId)}/danfe`, { titulo: 'DANFE da NF-e', tituloSalvar: 'Salvar DANFE em PDF' });
  }

  /** Salva um texto como .xml pelo diálogo do Electron. */
  async function paraArquivoXml(conteudo, nome, titulo, descricao = 'XML da NF-e') {
    return window.electronAPI?.salvarTextoComoArquivo?.({ conteudo, nomeSugerido: nome, extensao: 'xml', titulo, descricao });
  }

  // ------------------------------------------------------- notas daqui

  /**
   * O DANFE da nota no visualizador (Fase 2; antes salvava). O nome antigo
   * continua: os botões do Visualizar pedido chamam este.
   */
  async function gerarDanfe(notaId) {
    return verDanfe(notaId);
  }

  /** Salva o XML de distribuição e, se houver, o do cancelamento. */
  async function salvarXml(notaId) {
    if (!notaId) return false;
    try {
      const corpo = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(notaId)}/xml`);
      const r = await paraArquivoXml(corpo.xml, corpo.nome, 'Salvar XML da NF-e');
      if (!r) { avisar('Salvar arquivo indisponível nesta janela.', 'error'); return false; }
      if (!r.success) { if (!r.canceled) avisar(r.message || 'Não foi possível salvar o XML.', 'error'); return false; }
      avisar('XML da NF-e salvo.', 'success');
      if (corpo.xml_cancelamento) {
        const rc = await paraArquivoXml(corpo.xml_cancelamento, corpo.nome_cancelamento, 'Salvar XML do cancelamento');
        if (rc?.success) avisar('XML do cancelamento salvo.', 'success');
      }
      return true;
    } catch (e) {
      avisar(e.message || 'Não foi possível ler o XML.', 'error');
      return false;
    }
  }

  /** Segunda via da carta de correção (sequência `seq`), no visualizador. */
  async function gerarCartaCorrecaoPdf(notaId, seq) {
    if (!notaId || !seq) return false;
    return paraVisualizador(`/api/fiscal/notas/${encodeURIComponent(notaId)}/cartas-correcao/${encodeURIComponent(seq)}/documento`,
      { titulo: `Carta de correção ${seq}`, tituloSalvar: 'Salvar carta de correção em PDF' });
  }

  async function salvarXmlCartaCorrecao(notaId, seq) {
    if (!notaId || !seq) return false;
    try {
      const corpo = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(notaId)}/cartas-correcao/${encodeURIComponent(seq)}/xml`);
      const r = await paraArquivoXml(corpo.xml, corpo.nome, 'Salvar XML da carta de correção', 'XML do evento');
      if (!r) { avisar('Salvar arquivo indisponível nesta janela.', 'error'); return false; }
      if (r.success) { avisar('XML da carta de correção salvo.', 'success'); return true; }
      if (!r.canceled) avisar(r.message || 'Não foi possível salvar o XML.', 'error');
      return false;
    } catch (e) {
      avisar(e.message || 'Não foi possível ler o XML da carta.', 'error');
      return false;
    }
  }

  /** As cartas registradas de uma nota (lista sem XML); [] quando não há ou sem permissão. */
  async function listarCartasCorrecao(notaId) {
    if (!notaId) return [];
    try {
      const lista = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(notaId)}/cartas-correcao`);
      return Array.isArray(lista) ? lista : [];
    } catch (_) {
      return [];
    }
  }

  // ------------------------------------------------- notas emitidas fora
  // Recebem o id do PEDIDO: a nota de fora é uma por pedido, e é assim que o
  // backend a encontra. Sem o XML anexado o backend responde 409 com
  // `falta_xml`, e a mensagem já diz o que fazer.

  const externa = pedidoId => `/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/nfe-externa`;

  async function gerarDanfeExterna(pedidoId) {
    if (!pedidoId) return false;
    return paraVisualizador(`${externa(pedidoId)}/danfe`, { titulo: 'DANFE da NF-e', tituloSalvar: 'Salvar DANFE em PDF' });
  }

  async function salvarXmlExterna(pedidoId) {
    if (!pedidoId) return false;
    try {
      const corpo = await fetchApi(`${externa(pedidoId)}/xml`);
      const r = await paraArquivoXml(corpo.xml, corpo.nome, 'Salvar XML da NF-e');
      if (!r) { avisar('Salvar arquivo indisponível nesta janela.', 'error'); return false; }
      if (r.success) { avisar('XML da NF-e salvo.', 'success'); return true; }
      if (!r.canceled) avisar(r.message || 'Não foi possível salvar o XML.', 'error');
      return false;
    } catch (e) {
      avisar(e.message || 'Não foi possível ler o XML.', 'error');
      return false;
    }
  }

  async function gerarCartaExternaPdf(pedidoId, seq) {
    if (!pedidoId || !seq) return false;
    return paraVisualizador(`${externa(pedidoId)}/cartas/${encodeURIComponent(seq)}/documento`,
      { titulo: `Carta de correção ${seq}`, tituloSalvar: 'Salvar carta de correção em PDF' });
  }

  async function salvarXmlCartaExterna(pedidoId, seq) {
    if (!pedidoId || !seq) return false;
    try {
      const corpo = await fetchApi(`${externa(pedidoId)}/cartas/${encodeURIComponent(seq)}/xml`);
      const r = await paraArquivoXml(corpo.xml, corpo.nome, 'Salvar XML da carta de correção', 'XML do evento');
      if (!r) { avisar('Salvar arquivo indisponível nesta janela.', 'error'); return false; }
      if (r.success) { avisar('XML da carta de correção salvo.', 'success'); return true; }
      if (!r.canceled) avisar(r.message || 'Não foi possível salvar o XML.', 'error');
      return false;
    } catch (e) {
      avisar(e.message || 'Não foi possível ler o XML da carta.', 'error');
      return false;
    }
  }

  window.NfeDocumentos = {
    verDanfe,
    gerarDanfe, salvarXml, gerarCartaCorrecaoPdf, salvarXmlCartaCorrecao, listarCartasCorrecao,
    gerarDanfeExterna, salvarXmlExterna, gerarCartaExternaPdf, salvarXmlCartaExterna
  };
})();
