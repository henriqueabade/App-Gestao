/**
 * Modal "Gerar boletos".
 *
 * Lê GET /api/cobranca/pedidos/:id/boletos (parcelas com o boleto de cada
 * uma e o que impede gerar), deixa marcar as parcelas sem boleto vivo e
 * registra no Banco do Brasil por POST /api/cobranca/pedidos/:id/boletos.
 * O resultado sai parcela a parcela: uma recusa do BB não impede as outras.
 * Nada vai para o cliente.
 *
 * Contexto: `window.gerarBoletosContext = { pedidoId, numero, cliente }`.
 */
(() => {
  const overlayId = 'gerarBoletos';
  const overlay = document.getElementById('gerarBoletosOverlay');
  if (!overlay) return;

  // ------------------------------------------------------ funções puras
  const ROTULO_STATUS = {
    registrado: ['badge-success', 'Registrado'], pago: ['badge-success', 'Pago'], baixado: ['badge-neutral', 'Baixado'], vencido: ['badge-warning', 'Vencido'],
    protestado: ['badge-danger', 'Protestado'], erro: ['badge-danger', 'Erro no BB'], reservado: ['badge-warning', 'Reservado']
  };

  /** Como a parcela aparece: se pode ser marcada, e a tag do boleto que ela tem. */
  function linhaDaParcela(l) {
    const b = l?.boleto || null;
    const [classe, rotulo] = b ? (ROTULO_STATUS[b.status] || ['badge-neutral', String(b.status || '')]) : ['badge-neutral', 'Sem boleto'];
    return {
      id: l?.parcela?.id ?? null,
      numero: l?.parcela?.numero_parcela ?? null,
      vencimento: String(l?.parcela?.data_vencimento || '').slice(0, 10),
      valor: Number(l?.parcela?.valor) || 0,
      podeGerar: !l?.tem_boleto_vivo,
      classe, rotulo,
      detalhe: b ? (b.status === 'erro' ? (b.erro || '') : [b.nosso_numero ? `${b.nosso_numero}${b.nosso_numero_dv ? `-${b.nosso_numero_dv}` : ''}` : '', b.linha_digitavel || ''].filter(Boolean).join(' · ')) : ''
    };
  }

  /** O aviso depois de gerar: quantos saíram, quantos já existiam, quantos deram erro. */
  function resumoDosResultados(corpo) {
    const registrados = Number(corpo?.registrados) || 0;
    const erros = Number(corpo?.erros) || 0;
    const jaExistiam = (corpo?.resultados || []).filter(r => r?.ja_existia).length;
    const partes = [];
    if (registrados) partes.push(registrados === 1 ? '1 boleto registrado no BB' : `${registrados} boletos registrados no BB`);
    if (jaExistiam) partes.push(jaExistiam === 1 ? '1 já existia' : `${jaExistiam} já existiam`);
    if (erros) partes.push(erros === 1 ? '1 com erro' : `${erros} com erro`);
    if (!partes.length) partes.push('Nenhum boleto para gerar');
    return { texto: `${partes.join(' · ')}.`, tipo: erros ? 'error' : (registrados ? 'success' : 'info') };
  }

  function mensagemDeErro(status, corpo) {
    if (status === 403) return 'Você não tem permissão para gerar boletos.';
    if (status === 404) return 'Pedido não encontrado.';
    if (status === 409 && Array.isArray(corpo?.pendencias) && corpo.pendencias.length) return `${corpo.error || 'A cobrança não está pronta.'}`;
    return corpo?.error || 'Não foi possível gerar os boletos.';
  }
  // ------------------------------------------------- fim das funções puras

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const formatarMoeda = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatarDia = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'; };

  const bruto = window.gerarBoletosContext;
  const ctx = { pedidoId: bruto?.pedidoId ?? window.selectedOrderId ?? null, numero: bruto?.numero ? String(bruto.numero) : '', cliente: bruto?.cliente ? String(bruto.cliente) : '' };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ gerarBoletosContext: ctx, selectedOrderId: ctx.pedidoId }));

  const el = id => overlay.querySelector(`#${id}`);
  const linhasEl = el('gerarBoletosLinhas');
  const mensagemEl = el('gerarBoletosMensagem');
  const resultadoEl = el('gerarBoletosResultado');
  const confirmarBtn = el('confirmarGerarBoletos');
  let estado = null;
  let emAndamento = false;
  let fechado = false;

  function desligarOuvintes() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
  }
  function fechar() {
    if (fechado) return;
    fechado = true;
    desligarOuvintes();
    if (window.gerarBoletosContext === bruto) window.gerarBoletosContext = null;
    Modal.close(overlayId);
  }
  function aoEsc(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (!emAndamento) fechar();
  }
  function aoFecharModal(evento) {
    if (evento?.detail === overlayId) desligarOuvintes();
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharModal);
  el('voltarGerarBoletos')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('desistirGerarBoletos')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  function exibirMensagem(tipo, texto) {
    mensagemEl.textContent = texto;
    mensagemEl.style.color = tipo === 'erro' ? 'var(--color-red)' : (tipo === 'ok' ? 'var(--color-green)' : 'var(--color-primary-light)');
    mensagemEl.classList.remove('hidden');
  }

  function marcadas() {
    return Array.from(linhasEl.querySelectorAll('input[type="checkbox"]:checked')).map(c => Number(c.value)).filter(Number.isFinite);
  }

  function pintar() {
    const ambiente = el('gerarBoletosAmbiente');
    const producao = estado?.ambiente === 'producao';
    ambiente.className = `${producao ? 'badge-success' : 'badge-warning'} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    ambiente.textContent = producao ? 'Produção' : 'Homologação (teste, sem valor)';
    el('gerarBoletosSubtitulo').textContent = [ctx.numero ? `Pedido ${ctx.numero}` : '', estado?.pedido?.cliente || ctx.cliente, estado?.nota_fiscal ? `NF-e ${estado.nota_fiscal.serie}/${estado.nota_fiscal.numero}` : ''].filter(Boolean).join(' · ');

    const pend = el('gerarBoletosPendencias');
    const lista = Array.isArray(estado?.pendencias) ? estado.pendencias : [];
    pend.querySelector('span').textContent = lista.join(' ');
    pend.style.display = lista.length ? 'flex' : 'none';
    pend.classList.toggle('hidden', !lista.length);

    linhasEl.replaceChildren();
    for (const l of (estado?.parcelas || []).map(linhaDaParcela)) {
      const tr = document.createElement('tr');
      const tdCaixa = document.createElement('td');
      tdCaixa.className = 'px-4 py-3';
      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.value = String(l.id ?? '');
      caixa.checked = l.podeGerar && Boolean(estado?.pode_gerar);
      caixa.disabled = !l.podeGerar || !estado?.pode_gerar;
      caixa.style.accentColor = 'var(--color-primary)';
      caixa.addEventListener('change', atualizarBotao);
      tdCaixa.appendChild(caixa);
      const celula = (texto, classe = 'px-4 py-3 text-white') => { const td = document.createElement('td'); td.className = classe; td.textContent = texto; return td; };
      const tdBoleto = document.createElement('td');
      tdBoleto.className = 'px-4 py-3';
      const tag = document.createElement('span');
      tag.className = `${l.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
      tag.textContent = l.rotulo;
      tdBoleto.appendChild(tag);
      if (l.detalhe) {
        const det = document.createElement('p');
        det.className = 'mt-1 text-xs text-gray-400 break-all';
        det.textContent = l.detalhe;
        tdBoleto.appendChild(det);
      }
      tr.append(tdCaixa, celula(l.numero ? `${l.numero}ª` : '—'), celula(formatarDia(l.vencimento)), celula(formatarMoeda(l.valor), 'px-4 py-3 text-right text-white'), tdBoleto);
      linhasEl.appendChild(tr);
    }
    el('gerarBoletosTabela').classList.toggle('hidden', !(estado?.parcelas || []).length);
    atualizarBotao();
  }

  function atualizarBotao() {
    const n = marcadas().length;
    confirmarBtn.disabled = !estado?.pode_gerar || n === 0;
    confirmarBtn.textContent = n ? `Gerar ${n === 1 ? '1 boleto' : `${n} boletos`}` : 'Gerar boletos';
  }

  async function carregar() {
    try {
      const resp = await fetchApi(`/api/cobranca/pedidos/${encodeURIComponent(ctx.pedidoId)}/boletos`);
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(mensagemDeErro(resp.status, corpo));
      estado = corpo;
      pintar();
    } catch (err) {
      exibirMensagem('erro', err?.message || 'Não foi possível ler as parcelas.');
      confirmarBtn.disabled = true;
    } finally {
      el('gerarBoletosCarregando').classList.add('hidden');
    }
  }

  async function confirmar() {
    if (emAndamento || fechado) return;
    const ids = marcadas();
    if (!ids.length) { exibirMensagem('erro', 'Marque ao menos uma parcela.'); return; }
    const producao = estado?.ambiente === 'producao';
    const ok = await window.DialogPadrao?.confirm?.({
      title: producao ? 'Registrar boletos reais?' : 'Registrar boletos na homologação?',
      message: `${ids.length === 1 ? '1 boleto será registrado' : `${ids.length} boletos serão registrados`} no Banco do Brasil (${producao ? 'PRODUÇÃO — com valor' : 'homologação, conta de teste, sem valor'}) para o pedido ${ctx.numero}. Nada é enviado ao cliente.`,
      confirmText: 'Gerar boletos'
    });
    if (!ok) return;
    emAndamento = true;
    mensagemEl.classList.add('hidden');
    resultadoEl.classList.add('hidden');
    try {
      let resp;
      try {
        resp = await fetchApi(`/api/cobranca/pedidos/${encodeURIComponent(ctx.pedidoId)}/boletos`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parcelas: ids, nota_fiscal_id: estado?.nota_fiscal?.id ?? null })
        });
      } catch (err) {
        exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      const r = resumoDosResultados(corpo);
      exibirMensagem(r.tipo === 'error' ? 'erro' : (r.tipo === 'success' ? 'ok' : 'info'), r.texto);
      resultadoEl.replaceChildren();
      for (const item of corpo?.resultados || []) {
        const li = document.createElement('li');
        li.style.color = item.ok ? 'var(--color-green)' : 'var(--color-red)';
        li.textContent = item.ok
          ? `Parcela ${item.numero_parcela}: ${item.ja_existia ? 'já tinha boleto' : 'registrado'} ${item.boleto?.nosso_numero ? `· ${item.boleto.nosso_numero}` : ''}${item.boleto?.linha_digitavel ? ` · ${item.boleto.linha_digitavel}` : ''}`
          : `Parcela ${item.numero_parcela}: ${item.erro}`;
        resultadoEl.appendChild(li);
      }
      resultadoEl.classList.remove('hidden');
      window.showToast?.(r.texto, r.tipo);
      window.dispatchEvent(new CustomEvent('boletos:gerados', { detail: { pedidoId: ctx.pedidoId, resultado: corpo } }));
      window.carregarPedidos?.();
      await carregar();
    } finally {
      emAndamento = false;
    }
  }

  if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(confirmarBtn, confirmar);
  else confirmarBtn.addEventListener('click', confirmar);

  overlay.classList.remove('hidden');
  overlay.removeAttribute('aria-hidden');
  window.Modal?.signalReady?.(overlayId);
  carregar();
})();
