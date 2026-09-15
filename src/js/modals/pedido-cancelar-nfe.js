/**
 * Modal "Cancelar NF-e".
 *
 * Pede a justificativa (a SEFAZ exige de 15 a 255 caracteres) e chama
 * POST /api/fiscal/notas/:id/cancelar. Com o evento registrado a nota passa a
 * "cancelada"; o pedido não muda de situação — quem decide o que fazer com o
 * pedido é o usuário. Recusa da SEFAZ fica na tela com o motivo.
 *
 * Contexto: `window.cancelarNfeContext = { notaId, serie, numero, chave, pedidoId, pedidoNumero }`.
 */
(() => {
  const overlayId = 'cancelarNfe';
  const overlay = document.getElementById('cancelarNfeOverlay');
  if (!overlay) return;

  // ------------------------------------------------------ funções puras
  const MINIMO = 15;
  const MAXIMO = 255;

  /** A justificativa como vai para a SEFAZ (espaços colapsados) e o que falta nela. */
  function avaliarJustificativa(texto) {
    const limpa = String(texto ?? '').replace(/\s+/g, ' ').trim();
    if (limpa.length < MINIMO) return { limpa, erro: `A justificativa precisa ter pelo menos ${MINIMO} caracteres (faltam ${MINIMO - limpa.length}).` };
    if (limpa.length > MAXIMO) return { limpa, erro: `A justificativa passa de ${MAXIMO} caracteres.` };
    return { limpa, erro: null };
  }

  function textoDoContador(texto) {
    const n = String(texto ?? '').replace(/\s+/g, ' ').trim().length;
    return n < MINIMO ? `${n} / ${MAXIMO} — mínimo de ${MINIMO} caracteres` : `${n} / ${MAXIMO}`;
  }

  function mensagemDeErro(status, corpo) {
    if (status === 403) return 'Você não tem permissão para cancelar NF-e.';
    if (status === 404) return 'Nota fiscal não encontrada.';
    if (status === 409) return corpo?.error || 'Esta nota não pode ser cancelada.';
    if (status === 422 && corpo?.sefaz?.cStat) return `A SEFAZ recusou o cancelamento (${corpo.sefaz.cStat}): ${corpo.sefaz.xMotivo || corpo.error}`;
    return corpo?.error || 'Não foi possível cancelar a NF-e.';
  }
  // ------------------------------------------------- fim das funções puras

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const bruto = window.cancelarNfeContext;
  const ctx = {
    notaId: bruto?.notaId ?? null, serie: bruto?.serie ?? '', numero: bruto?.numero ?? '', chave: bruto?.chave ?? '',
    pedidoId: bruto?.pedidoId ?? null, pedidoNumero: bruto?.pedidoNumero ?? ''
  };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ cancelarNfeContext: ctx }));

  const el = id => overlay.querySelector(`#${id}`);
  const justificativaEl = el('cancelarNfeJustificativa');
  const contadorEl = el('cancelarNfeContador');
  const mensagemEl = el('cancelarNfeMensagem');
  const confirmarBtn = el('confirmarCancelarNfe');
  let emAndamento = false;
  let fechado = false;

  function fechar() {
    if (fechado) return;
    fechado = true;
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
    if (window.cancelarNfeContext === bruto) window.cancelarNfeContext = null;
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
  el('voltarCancelarNfe')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('desistirCancelarNfe')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  function exibirMensagem(tipo, texto) {
    mensagemEl.textContent = texto;
    mensagemEl.style.color = tipo === 'erro' ? 'var(--color-red)' : 'var(--color-green)';
    mensagemEl.classList.remove('hidden');
  }

  async function confirmar() {
    if (emAndamento || fechado) return;
    const { limpa, erro } = avaliarJustificativa(justificativaEl.value);
    if (erro) { exibirMensagem('erro', erro); justificativaEl.focus(); return; }
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Cancelar a NF-e na SEFAZ?',
      message: `NF-e série ${ctx.serie} nº ${ctx.numero} do pedido ${ctx.pedidoNumero} será cancelada. Isso não pode ser desfeito.`,
      confirmText: 'Cancelar NF-e'
    });
    if (!ok) return;
    emAndamento = true;
    mensagemEl.classList.add('hidden');
    try {
      let resp;
      try {
        resp = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(ctx.notaId)}/cancelar`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ justificativa: limpa })
        });
      } catch (err) {
        exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      window.showToast?.(`NF-e nº ${ctx.numero} cancelada na SEFAZ (${corpo?.sefaz?.cStat || ''}).`, 'success');
      window.dispatchEvent(new CustomEvent('nfe:cancelada', { detail: { notaId: ctx.notaId, pedidoId: ctx.pedidoId, nota: corpo?.nota || null } }));
      window.carregarPedidos?.();
      fechar();
    } finally {
      emAndamento = false;
    }
  }

  justificativaEl.addEventListener('input', () => {
    contadorEl.textContent = textoDoContador(justificativaEl.value);
    mensagemEl.classList.add('hidden');
  });
  if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(confirmarBtn, confirmar);
  else confirmarBtn.addEventListener('click', confirmar);

  el('cancelarNfeSubtitulo').textContent = [`NF-e série ${ctx.serie} nº ${ctx.numero}`, ctx.pedidoNumero ? `Pedido ${ctx.pedidoNumero}` : ''].filter(Boolean).join(' · ');
  contadorEl.textContent = textoDoContador('');
  overlay.classList.remove('hidden');
  overlay.removeAttribute('aria-hidden');
  window.Modal?.signalReady?.(overlayId);
  try { justificativaEl.focus(); } catch (_) { /* sem foco, sem problema */ }
})();
