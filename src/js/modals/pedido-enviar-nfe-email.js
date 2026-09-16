/**
 * Modal "Enviar NF-e por e-mail".
 *
 * O DANFE é impresso aqui (Electron: gerar-pdf-de-html, em retrato) e vai em
 * base64 para POST /api/fiscal/notas/:id/email, que anexa o XML e envia pelo
 * SMTP da configuração com a senha guardada neste computador.
 *
 * Contexto: `window.emailNfeContext = { notaId, serie, numero, pedidoNumero, email }`.
 */
(() => {
  const overlayId = 'enviarNfeEmail';
  const overlay = document.getElementById('enviarNfeEmailOverlay');
  if (!overlay) return;

  // ------------------------------------------------------ funções puras
  const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

  /** "a@b.com; c@d.com" -> lista; devolve também os inválidos para apontar. */
  function lerDestinatarios(texto) {
    const lista = [...new Set(String(texto ?? '').split(/[;,\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean))];
    return { lista, invalidos: lista.filter(e => !EMAIL_RE.test(e)) };
  }

  function mensagemDeErro(status, corpo) {
    if (status === 403) return 'Você não tem permissão para enviar NF-e por e-mail.';
    if (status === 409) return corpo?.error || 'O e-mail da NF-e ainda não está configurado (Financeiro → Configuração fiscal).';
    if (status === 502) return corpo?.error || 'O servidor de e-mail recusou o envio.';
    return corpo?.error || 'Não foi possível enviar o e-mail.';
  }
  // ------------------------------------------------- fim das funções puras

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const bruto = window.emailNfeContext;
  const ctx = { notaId: bruto?.notaId ?? null, serie: bruto?.serie ?? '', numero: bruto?.numero ?? '', pedidoNumero: bruto?.pedidoNumero ?? '', email: bruto?.email ?? '' };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ emailNfeContext: ctx }));

  const el = id => overlay.querySelector(`#${id}`);
  const paraEl = el('enviarNfeEmailPara');
  const mensagemEl = el('enviarNfeEmailMensagem');
  const erroEl = el('enviarNfeEmailMensagemErro');
  const confirmarBtn = el('confirmarEnviarNfeEmail');
  let emAndamento = false;
  let fechado = false;

  function fechar() {
    if (fechado) return;
    fechado = true;
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
    if (window.emailNfeContext === bruto) window.emailNfeContext = null;
    Modal.close(overlayId);
  }
  function aoEsc(e) {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (!emAndamento) fechar();
  }
  function aoFecharModal(evento) {
    if (evento?.detail === overlayId) {
      document.removeEventListener('keydown', aoEsc);
      window.removeEventListener('modalFechado', aoFecharModal);
    }
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharModal);
  el('voltarEnviarNfeEmail')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('cancelarEnviarNfeEmail')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  function exibirErro(texto, cor) {
    erroEl.textContent = texto;
    erroEl.style.color = cor || 'var(--color-red)';
    erroEl.classList.remove('hidden');
  }

  async function enviar() {
    if (emAndamento || fechado) return;
    erroEl.classList.add('hidden');
    const { lista, invalidos } = lerDestinatarios(paraEl.value);
    if (!lista.length) { exibirErro('Informe ao menos um destinatário.'); paraEl.focus(); return; }
    if (invalidos.length) { exibirErro(`E-mail inválido: ${invalidos.join(', ')}`); paraEl.focus(); return; }
    const querDanfe = el('enviarNfeEmailDanfe').checked;
    const querXml = el('enviarNfeEmailXml').checked;
    if (!querDanfe && !querXml) { exibirErro('Escolha ao menos um anexo (DANFE ou XML).'); return; }
    emAndamento = true;
    try {
      let pdfBase64 = null;
      if (querDanfe) {
        exibirErro('Gerando o DANFE…', 'var(--color-primary-light)');
        const resp = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(ctx.notaId)}/danfe`);
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirErro(corpo?.error || 'Não foi possível montar o DANFE.'); return; }
        const pdf = await window.electronAPI?.gerarPdfDeHtml?.({ html: corpo.html, retrato: true });
        if (!pdf?.success) { exibirErro(pdf?.message || 'Não foi possível gerar o PDF do DANFE nesta janela.'); return; }
        pdfBase64 = pdf.base64;
      }
      exibirErro('Enviando…', 'var(--color-primary-light)');
      let resp;
      try {
        resp = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(ctx.notaId)}/email`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ para: lista, mensagem: mensagemEl.value.trim(), pdf_base64: pdfBase64, incluir_xml: querXml })
        });
      } catch (err) {
        exibirErro('Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirErro(mensagemDeErro(resp.status, corpo)); return; }
      window.showToast?.(`NF-e nº ${ctx.numero} enviada para ${corpo.para.join(', ')}.`, 'success');
      fechar();
    } finally {
      emAndamento = false;
    }
  }

  if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(confirmarBtn, enviar);
  else confirmarBtn.addEventListener('click', enviar);
  paraEl.addEventListener('input', () => erroEl.classList.add('hidden'));

  el('enviarNfeEmailSubtitulo').textContent = [`NF-e série ${ctx.serie} nº ${ctx.numero}`, ctx.pedidoNumero ? `Pedido ${ctx.pedidoNumero}` : ''].filter(Boolean).join(' · ');
  paraEl.value = ctx.email || '';
  overlay.classList.remove('hidden');
  overlay.removeAttribute('aria-hidden');
  window.Modal?.signalReady?.(overlayId);
  try { (ctx.email ? mensagemEl : paraEl).focus(); } catch (_) { /* sem foco, sem problema */ }
})();
