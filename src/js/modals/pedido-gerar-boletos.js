/**
 * Modal "Gerar boletos".
 *
 * Lê GET /api/cobranca/pedidos/:id/boletos (parcelas com o boleto de cada
 * uma e o que impede gerar), deixa marcar as parcelas sem boleto vivo e
 * registra no Banco do Brasil por POST /api/cobranca/pedidos/:id/boletos.
 * O resultado sai parcela a parcela: uma recusa do BB não impede as outras.
 * Nada vai para o cliente. Com as parcelas registradas, o PDF sai por linha
 * ("PDF") ou de todas ("Boletos (PDF)"), e o "Gerar boletos" some.
 * Fase D: "Detalhes" abre o boleto por cima (consultar, prorrogar,
 * abatimento, baixar) e "Consultar no BB" atualiza todos os a pagar; o
 * título vira "Boletos do pedido" quando não há o que gerar.
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

  const MOTIVOS_BAIXA = { quitado_por_fora: 'quitado por fora', cancelado: 'cancelado', reemissao: 'reemissão', banco: 'pelo banco' };
  const diaCurto = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

  /** Como a parcela aparece: se pode ser marcada, e a tag do boleto que ela tem. */
  function linhaDaParcela(l) {
    // Já paga (Pix, cartão…) e sem boleto: não se marca — só depois de
    // estornar o pagamento em "Pagamentos" (decisão do dono, 24/09/2026).
    if (l?.recebimento && !l?.tem_boleto_vivo && !l?.boleto_externo) {
      const r = l.recebimento;
      return {
        id: l?.parcela?.id ?? null, numero: l?.parcela?.numero_parcela ?? null,
        vencimento: String(l?.parcela?.data_vencimento || '').slice(0, 10), valor: Number(l?.parcela?.valor) || 0,
        podeGerar: false, temPdf: false, temDetalhe: false, boletoId: null,
        classe: 'badge-success', rotulo: `Paga${r.forma ? ` · ${r.forma}` : ''}`,
        detalhe: [r.data ? `em ${diaCurto(r.data)}` : '', 'para gerar boleto, estorne o pagamento em "Pagamentos"'].filter(Boolean).join(' · ')
      };
    }
    // Boleto emitido fora e informado: a parcela já está cobrada, não se marca.
    if (l?.boleto_externo && !l?.tem_boleto_vivo) {
      const e = l.boleto_externo;
      return {
        id: l?.parcela?.id ?? null, numero: l?.parcela?.numero_parcela ?? null,
        vencimento: String(l?.parcela?.data_vencimento || '').slice(0, 10), valor: Number(l?.parcela?.valor) || 0,
        podeGerar: false, temPdf: false, temDetalhe: false, boletoId: null,
        classe: 'badge-info', rotulo: `Boleto de fora${e.banco_nome ? ` · ${e.banco_nome}` : ''}`,
        detalhe: [e.vencimento ? `vence ${diaCurto(e.vencimento)}` : '', e.linha_impressa || e.linha_digitavel || ''].filter(Boolean).join(' · ')
      };
    }
    const b = l?.boleto || null;
    const [classe, rotuloBase] = b ? (ROTULO_STATUS[b.status] || ['badge-neutral', String(b.status || '')]) : ['badge-neutral', 'Sem boleto'];
    const rotulo = b?.status === 'baixado' && MOTIVOS_BAIXA[b.motivo_baixa] ? `${rotuloBase} · ${MOTIVOS_BAIXA[b.motivo_baixa]}` : rotuloBase;
    const vencParcela = String(l?.parcela?.data_vencimento || '').slice(0, 10);
    const vencBoleto = String(b?.data_vencimento || '').slice(0, 10);
    const abatimento = Number(b?.valor_abatimento) || 0;
    const extras = [];
    // O boleto que vale pode vencer em outra data (prorrogação, reemissão) e ter abatimento.
    if (l?.tem_boleto_vivo && vencBoleto && vencBoleto !== vencParcela) extras.push(`vence ${diaCurto(vencBoleto)}`);
    if (l?.tem_boleto_vivo && abatimento > 0) extras.push(`abatimento ${abatimento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
    return {
      id: l?.parcela?.id ?? null,
      numero: l?.parcela?.numero_parcela ?? null,
      vencimento: vencParcela,
      valor: Number(l?.parcela?.valor) || 0,
      podeGerar: !l?.tem_boleto_vivo,
      // Tem o que imprimir: registrado, vencido ou em protesto (pago e baixado não se pagam mais).
      temPdf: Boolean(b && ['registrado', 'vencido', 'protestado'].includes(String(b.status))),
      // Tem o que ver: todo boleto que passou pelo BB (reservado ainda não passou).
      temDetalhe: Boolean(b?.id) && String(b?.status) !== 'reservado',
      boletoId: b?.id ?? null,
      classe, rotulo,
      detalhe: b ? (b.status === 'erro' ? (b.erro || '') : [b.nosso_numero ? `${b.nosso_numero}${b.nosso_numero_dv ? `-${b.nosso_numero_dv}` : ''}` : '', b.linha_digitavel || '', ...extras].filter(Boolean).join(' · ')) : ''
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

  /** O rodapé: gerar só quando há parcela sem boleto; PDF e consulta ao BB quando há boleto a pagar. */
  function estadoDoRodape(estado) {
    const linhas = (estado?.parcelas || []).map(linhaDaParcela);
    const faltam = linhas.filter(l => l.podeGerar).length;
    const comPdf = linhas.filter(l => l.temPdf).length;
    const mostrarGerar = Boolean(estado?.pode_gerar) && faltam > 0;
    return {
      mostrarGerar,
      mostrarPdf: comPdf > 0,
      mostrarConsultar: comPdf > 0,
      titulo: faltam > 0 || !linhas.length ? 'Gerar boletos' : 'Boletos do pedido',
      aviso: linhas.length && faltam === 0 ? 'Todas as parcelas já têm boleto registrado.' : ''
    };
  }

  /** O aviso depois de consultar o pedido no BB. */
  function resumoDaConsulta(corpo) {
    const consultados = Number(corpo?.consultados) || 0;
    const mudaram = Number(corpo?.mudaram) || 0;
    const erros = Number(corpo?.erros) || 0;
    if (!consultados && !erros) return { texto: 'Nenhum boleto a pagar para consultar.', tipo: 'info' };
    const partes = [consultados === 1 ? '1 boleto consultado no BB' : `${consultados} boletos consultados no BB`];
    partes.push(mudaram ? (mudaram === 1 ? '1 mudou de situação' : `${mudaram} mudaram de situação`) : 'nenhuma mudança');
    if (erros) partes.push(erros === 1 ? '1 com erro' : `${erros} com erro`);
    return { texto: `${partes.join(' · ')}.`, tipo: erros ? 'error' : 'success' };
  }

  /**
   * O aviso do pedido que ainda não embarcou. Gerar boleto antes do embarque
   * é legítimo (cliente que paga adiantado), mas no pedido "ao embarcar" os
   * vencimentos são refeitos no envio — e o boleto já registrado no banco
   * precisa então ser prorrogado. Pura.
   */
  function avisoDoEmbarque(pedido) {
    const situacao = String(pedido?.situacao || '').trim().toLowerCase();
    if (['enviado', 'entregue', 'cancelado'].includes(situacao)) return '';
    if (String(pedido?.faturamento_regra || '').trim() !== 'ao_embarcar') return '';
    return 'Este pedido fatura "ao embarcar": os vencimentos são refeitos no dia do envio. '
      + 'Boleto gerado agora fica com o vencimento de hoje — depois do envio, confira e prorrogue pelo "Detalhes" do boleto.';
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
  const pdfTodosBtn = el('baixarBoletosPdf');
  const consultarBtn = el('consultarBoletosBB');
  let estado = null;
  let emAndamento = false;
  let fechado = false;

  function desligarOuvintes() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
    window.removeEventListener('boletos:alterados', aoAlterarBoleto);
  }
  /** O modal do boleto (por cima) mudou algo deste pedido: relê a lista. */
  function aoAlterarBoleto(evento) {
    if (fechado || String(evento?.detail?.pedidoId) !== String(ctx.pedidoId)) return;
    carregar();
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
    // Com o boleto aberto por cima, o Esc é dele.
    if (document.getElementById('boletoDetalheOverlay')) return;
    e.preventDefault();
    if (!emAndamento) fechar();
  }
  function aoFecharModal(evento) {
    if (evento?.detail === overlayId) desligarOuvintes();
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharModal);
  window.addEventListener('boletos:alterados', aoAlterarBoleto);
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

    // Pedido que ainda não embarcou e fatura "ao embarcar": o vencimento de
    // hoje pode mudar no envio. Avisa junto do texto fixo do rodapé.
    const rodapeTexto = el('gerarBoletosAviso');
    if (rodapeTexto) {
      const embarque = avisoDoEmbarque(estado?.pedido);
      if (!rodapeTexto.dataset.textoBase) rodapeTexto.dataset.textoBase = rodapeTexto.textContent.trim();
      rodapeTexto.textContent = [rodapeTexto.dataset.textoBase, embarque].filter(Boolean).join(' ');
      rodapeTexto.style.color = embarque ? 'var(--color-primary-light)' : '';
    }

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
      if (l.temDetalhe) {
        const ver = document.createElement('button');
        ver.type = 'button';
        ver.className = 'btn-neutral ml-2 px-2 py-0.5 rounded-md text-xs font-medium text-white';
        ver.dataset.perm = 'financeiro.boleto.view';
        ver.textContent = 'Detalhes';
        ver.title = `Situação no BB, histórico, prorrogar, abatimento e baixa do boleto da parcela ${l.numero}`;
        ver.addEventListener('click', () => abrirDetalhe(l));
        tdBoleto.appendChild(ver);
      }
      if (l.temPdf) {
        const pdf = document.createElement('button');
        pdf.type = 'button';
        pdf.className = 'btn-neutral ml-2 px-2 py-0.5 rounded-md text-xs font-medium text-white';
        pdf.dataset.perm = 'financeiro.boleto.view';
        pdf.textContent = 'PDF';
        pdf.title = `Gerar o PDF do boleto da parcela ${l.numero}`;
        // Sem a marca, a rede automática do BotaoAcao ocupa o botão antes do clique e o run desiste.
        pdf.dataset.acaoGerida = 'true';
        pdf.addEventListener('click', () => (window.BotaoAcao?.run ? window.BotaoAcao.run(pdf, () => gerarPdf(l.boletoId)) : gerarPdf(l.boletoId)));
        tdBoleto.appendChild(pdf);
      }
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
    const rodape = estadoDoRodape(estado);
    // Nada a gerar: o botão sai de cena (o verde desabilitado parecia ativo).
    confirmarBtn.classList.toggle('hidden', !rodape.mostrarGerar);
    confirmarBtn.disabled = !rodape.mostrarGerar || n === 0;
    confirmarBtn.style.opacity = confirmarBtn.disabled ? '0.5' : '';
    confirmarBtn.textContent = n ? `Gerar ${n === 1 ? '1 boleto' : `${n} boletos`}` : 'Gerar boletos';
    pdfTodosBtn?.classList.toggle('hidden', !rodape.mostrarPdf);
    consultarBtn?.classList.toggle('hidden', !rodape.mostrarConsultar);
    const titulo = el('gerarBoletosTituloTexto');
    if (titulo) titulo.textContent = rodape.titulo;
    const aviso = el('gerarBoletosCompleto');
    if (aviso) {
      aviso.textContent = rodape.aviso;
      aviso.classList.toggle('hidden', !rodape.aviso);
    }
  }

  function gerarPdf(boletoId) {
    if (!window.BoletoDocumentos) { exibirMensagem('erro', 'Geração de PDF indisponível nesta janela.'); return null; }
    return window.BoletoDocumentos.gerarBoletoPdf(boletoId);
  }

  function gerarPdfDoPedido() {
    if (!window.BoletoDocumentos) { exibirMensagem('erro', 'Geração de PDF indisponível nesta janela.'); return null; }
    return window.BoletoDocumentos.gerarBoletosDoPedidoPdf(ctx.pedidoId);
  }

  /** O boleto por cima deste modal (este continua aberto e se relê quando ele muda algo). */
  function abrirDetalhe(l) {
    if (!l?.boletoId || document.getElementById('boletoDetalheOverlay')) return;
    window.boletoDetalheContext = { boletoId: l.boletoId, pedidoId: ctx.pedidoId, numero: ctx.numero, parcela: l.numero };
    if (typeof Modal.openWithSpinner === 'function') {
      Modal.openWithSpinner('modals/pedidos/boleto-detalhe.html', '../js/modals/pedido-boleto-detalhe.js', 'boletoDetalhe', { keepExisting: true });
      return;
    }
    Modal.open('modals/pedidos/boleto-detalhe.html', '../js/modals/pedido-boleto-detalhe.js', 'boletoDetalhe', true);
  }

  /** Consulta no BB todos os boletos a pagar do pedido e relê a lista. */
  async function consultarNoBB() {
    if (emAndamento || fechado) return;
    emAndamento = true;
    mensagemEl.classList.add('hidden');
    resultadoEl.classList.add('hidden');
    try {
      let resp;
      try {
        resp = await fetchApi(`/api/cobranca/pedidos/${encodeURIComponent(ctx.pedidoId)}/boletos/sincronizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      } catch (_) {
        exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', resp.status === 403 ? 'Você não tem permissão para consultar boletos.' : (corpo?.error || 'Não foi possível consultar o BB.')); return; }
      const r = resumoDaConsulta(corpo);
      exibirMensagem(r.tipo === 'error' ? 'erro' : 'ok', r.texto);
      resultadoEl.replaceChildren();
      for (const item of (corpo?.resultados || []).filter(x => !x.ok || x.mudou)) {
        const li = document.createElement('li');
        li.style.color = item.ok ? 'var(--color-green)' : 'var(--color-red)';
        li.textContent = item.ok ? `Parcela ${item.numero_parcela}: agora ${item.status} (${item.situacao || 'BB'})` : `Parcela ${item.numero_parcela}: ${item.erro}`;
        resultadoEl.appendChild(li);
      }
      resultadoEl.classList.toggle('hidden', !resultadoEl.children.length);
      window.showToast?.(r.texto, r.tipo);
      if (Number(corpo?.mudaram) > 0) window.carregarPedidos?.();
      await carregar();
    } finally {
      emAndamento = false;
    }
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
      confirmarBtn.classList.add('hidden');
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

  if (typeof window.BotaoAcao?.bind === 'function') {
    window.BotaoAcao.bind(confirmarBtn, confirmar);
    if (pdfTodosBtn) window.BotaoAcao.bind(pdfTodosBtn, gerarPdfDoPedido);
    if (consultarBtn) window.BotaoAcao.bind(consultarBtn, consultarNoBB);
  } else {
    confirmarBtn.addEventListener('click', confirmar);
    pdfTodosBtn?.addEventListener('click', gerarPdfDoPedido);
    consultarBtn?.addEventListener('click', consultarNoBB);
  }

  // Revela só depois da PRIMEIRA leitura, como os modais do Financeiro: até
  // lá fica o spinner de quem abriu (Modal.openWithSpinner). Antes o modal
  // aparecia vazio e os dados caíam nele depois, com cara de travamento.
  const revelar = () => {
    overlay.classList.remove('hidden');
    overlay.removeAttribute('aria-hidden');
    window.Modal?.signalReady?.(overlayId);
  };
  Promise.resolve(carregar())
    .catch(erro => console.error('[pedido] falha ao carregar o modal', overlayId, erro))
    .finally(revelar);
})();
