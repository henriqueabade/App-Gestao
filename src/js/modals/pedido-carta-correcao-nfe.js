/**
 * Modal "Carta de correção" (evento 110110).
 *
 * Texto de 15 a 1000 caracteres, confirmação e POST
 * /api/fiscal/notas/:id/carta-correcao. A nota continua autorizada; a SEFAZ
 * numera as cartas e a última é a que vale.
 *
 * Contexto: `window.cartaCorrecaoContext = { notaId, serie, numero, pedidoNumero }`.
 */
(() => {
  const overlayId = 'cartaCorrecaoNfe';
  const overlay = document.getElementById('cartaCorrecaoNfeOverlay');
  if (!overlay) return;

  // ------------------------------------------------------ funções puras
  const MINIMO = 15;
  const MAXIMO = 1000;

  function avaliarCorrecao(texto) {
    const limpa = String(texto ?? '').replace(/\s+/g, ' ').trim();
    if (limpa.length < MINIMO) return { limpa, erro: `A correção precisa ter pelo menos ${MINIMO} caracteres (faltam ${MINIMO - limpa.length}).` };
    if (limpa.length > MAXIMO) return { limpa, erro: `A correção passa de ${MAXIMO} caracteres.` };
    return { limpa, erro: null };
  }

  function textoDoContador(texto) {
    const n = String(texto ?? '').replace(/\s+/g, ' ').trim().length;
    return n < MINIMO ? `${n} / ${MAXIMO} — mínimo de ${MINIMO} caracteres` : `${n} / ${MAXIMO}`;
  }

  function mensagemDeErro(status, corpo) {
    if (status === 403) return 'Você não tem permissão para registrar carta de correção.';
    if (status === 404) return 'Nota fiscal não encontrada.';
    if (status === 409) return corpo?.error || 'Esta nota não aceita carta de correção.';
    if (status === 422 && corpo?.sefaz?.cStat) return `A SEFAZ recusou a carta (${corpo.sefaz.cStat}): ${corpo.sefaz.xMotivo || corpo.error}`;
    return corpo?.error || 'Não foi possível registrar a carta de correção.';
  }
  // ------------------------------------------------- fim das funções puras

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const bruto = window.cartaCorrecaoContext;
  const ctx = { notaId: bruto?.notaId ?? null, serie: bruto?.serie ?? '', numero: bruto?.numero ?? '', pedidoNumero: bruto?.pedidoNumero ?? '' };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ cartaCorrecaoContext: ctx }));

  const el = id => overlay.querySelector(`#${id}`);
  const textoEl = el('cartaCorrecaoNfeTexto');
  const contadorEl = el('cartaCorrecaoNfeContador');
  const mensagemEl = el('cartaCorrecaoNfeMensagem');
  const confirmarBtn = el('confirmarCartaCorrecaoNfe');
  let emAndamento = false;
  let fechado = false;

  function fechar() {
    if (fechado) return;
    fechado = true;
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
    if (window.cartaCorrecaoContext === bruto) window.cartaCorrecaoContext = null;
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
  el('voltarCartaCorrecaoNfe')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('cancelarCartaCorrecaoNfe')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  function exibirMensagem(tipo, texto) {
    mensagemEl.textContent = texto;
    mensagemEl.style.color = tipo === 'erro' ? 'var(--color-red)' : 'var(--color-green)';
    mensagemEl.classList.remove('hidden');
  }

  async function confirmar() {
    if (emAndamento || fechado) return;
    const { limpa, erro } = avaliarCorrecao(textoEl.value);
    if (erro) { exibirMensagem('erro', erro); textoEl.focus(); return; }
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Registrar a carta de correção na SEFAZ?',
      message: `NF-e série ${ctx.serie} nº ${ctx.numero}${ctx.pedidoNumero ? ` (pedido ${ctx.pedidoNumero})` : ''}. A carta fica vinculada à nota e substitui a anterior.`,
      confirmText: 'Registrar'
    });
    if (!ok) return;
    emAndamento = true;
    mensagemEl.classList.add('hidden');
    try {
      let resp;
      try {
        resp = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(ctx.notaId)}/carta-correcao`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correcao: limpa })
        });
      } catch (err) {
        exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      window.showToast?.(`Carta de correção nº ${corpo?.nSeqEvento || 1} registrada na SEFAZ (${corpo?.sefaz?.cStat || ''}).`, 'success');
      window.dispatchEvent(new CustomEvent('nfe:carta-correcao', { detail: { notaId: ctx.notaId, nSeqEvento: corpo?.nSeqEvento || null } }));
      // Fica aberto mostrando a carta registrada, com PDF e XML à mão.
      textoEl.value = '';
      contadorEl.textContent = textoDoContador('');
      exibirMensagem('ok', `Carta ${corpo?.nSeqEvento || 1} registrada. Gere a segunda via em PDF na lista acima.`);
      await pintarRegistradas();
    } finally {
      emAndamento = false;
    }
  }

  textoEl.addEventListener('input', () => {
    contadorEl.textContent = textoDoContador(textoEl.value);
    mensagemEl.classList.add('hidden');
  });
  if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(confirmarBtn, confirmar);
  else confirmarBtn.addEventListener('click', confirmar);

  // ------------------------------------------------ cartas registradas
  const diaDoTexto = valor => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

  async function pintarRegistradas() {
    const bloco = el('cartaCorrecaoNfeRegistradas');
    const lista = el('cartaCorrecaoNfeLista');
    if (!bloco || !lista || !window.NfeDocumentos?.listarCartasCorrecao) return;
    const cartas = await window.NfeDocumentos.listarCartasCorrecao(ctx.notaId);
    lista.replaceChildren();
    for (const carta of cartas) {
      const li = document.createElement('li');
      li.className = 'px-4 py-3 flex flex-wrap items-start gap-3';
      const texto = document.createElement('div');
      texto.className = 'flex-1 min-w-[12rem]';
      const cabecalho = document.createElement('p');
      cabecalho.className = 'text-xs text-gray-400';
      cabecalho.textContent = `Carta ${carta.nSeqEvento}${carta.registradaEm ? ` · ${diaDoTexto(carta.registradaEm)}` : ''}${carta.protocolo ? ` · protocolo ${carta.protocolo}` : ''}`;
      const corpo = document.createElement('p');
      corpo.className = 'text-sm text-white whitespace-pre-wrap';
      corpo.textContent = carta.correcao;
      texto.append(cabecalho, corpo);
      const acoes = document.createElement('div');
      acoes.className = 'flex gap-2';
      for (const [rotulo, fn] of [['PDF', () => window.NfeDocumentos.gerarCartaCorrecaoPdf(ctx.notaId, carta.nSeqEvento)], ['XML', () => window.NfeDocumentos.salvarXmlCartaCorrecao(ctx.notaId, carta.nSeqEvento)]]) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'btn-neutral ctl-botao ctl-botao--pequeno text-white';
        botao.textContent = rotulo;
        if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, fn);
        else botao.addEventListener('click', fn);
        acoes.appendChild(botao);
      }
      li.append(texto, acoes);
      lista.appendChild(li);
    }
    bloco.classList.toggle('hidden', cartas.length === 0);
  }

  el('cartaCorrecaoNfeSubtitulo').textContent = [`NF-e série ${ctx.serie} nº ${ctx.numero}`, ctx.pedidoNumero ? `Pedido ${ctx.pedidoNumero}` : ''].filter(Boolean).join(' · ');
  contadorEl.textContent = textoDoContador('');
  pintarRegistradas();
  overlay.classList.remove('hidden');
  overlay.removeAttribute('aria-hidden');
  window.Modal?.signalReady?.(overlayId);
  try { textoEl.focus(); } catch (_) { /* sem foco, sem problema */ }
})();
