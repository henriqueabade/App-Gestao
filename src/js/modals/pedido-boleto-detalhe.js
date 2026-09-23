/**
 * Modal "Boleto" — fase D da cobrança BB.
 *
 * Lê GET /api/cobranca/boletos/:id/historico (o boleto, o histórico e o que
 * dá para fazer com ele) e, conforme a permissão, consulta no BB, prorroga o
 * vencimento, concede abatimento ou baixa (quitado por fora, cancelado,
 * reemissão) pelas rotas POST /api/cobranca/boletos/:id/*. O que muda o
 * boleto no banco pede confirmação na caixa da casa. Depois de cada ação o
 * modal relê o boleto e avisa quem o abriu (evento `boletos:alterados`).
 * Nada vai para o cliente.
 *
 * Contexto: `window.boletoDetalheContext = { boletoId, pedidoId, numero, parcela }`.
 */
(() => {
  const overlayId = 'boletoDetalhe';
  const overlay = document.getElementById('boletoDetalheOverlay');
  if (!overlay) return;

  // ------------------------------------------------------ funções puras
  const ROTULO_STATUS = {
    registrado: ['badge-success', 'Registrado'], pago: ['badge-success', 'Pago'], baixado: ['badge-neutral', 'Baixado'], vencido: ['badge-warning', 'Vencido'],
    protestado: ['badge-danger', 'Protestado'], erro: ['badge-danger', 'Erro no BB'], reservado: ['badge-warning', 'Reservado']
  };
  const MOTIVOS = { quitado_por_fora: 'quitado por fora', cancelado: 'cancelado', reemissao: 'reemissão', banco: 'baixado pelo banco' };
  const EVENTOS = {
    reservado: 'Nosso número reservado', registrado: 'Registrado no BB', erro: 'BB recusou o registro', renumerado: 'Nosso número trocado',
    consulta: 'Consulta ao BB', consulta_erro: 'Consulta ao BB falhou', prorrogado: 'Vencimento prorrogado', multa_atualizada: 'Multa atualizada',
    abatimento: 'Abatimento', baixado: 'Baixado', alteracao_erro: 'BB recusou a alteração', baixa_operacional: 'Aviso de pagamento do BB'
  };

  const moeda = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dia = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const momento = iso => {
    const d = new Date(iso || '');
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const somarDias = (iso, n) => { const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`); if (Number.isNaN(d.getTime())) return ''; d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const nossoNumero = b => (b?.nosso_numero ? `${b.nosso_numero}${b.nosso_numero_dv ? `-${b.nosso_numero_dv}` : ''}` : '');

  /** A tag do boleto; baixado diz o motivo. */
  function rotuloDoStatus(boleto) {
    const [classe, rotulo] = ROTULO_STATUS[boleto?.status] || ['badge-neutral', String(boleto?.status || '—')];
    const motivo = boleto?.status === 'baixado' && MOTIVOS[boleto?.motivo_baixa] ? ` · ${MOTIVOS[boleto.motivo_baixa]}` : '';
    return { classe, texto: `${rotulo}${motivo}` };
  }

  /** As linhas "rótulo → valor" da situação. */
  function linhasDeDados(b) {
    if (!b) return [];
    const linhas = [];
    linhas.push(['Parcela', `${b.numero_parcela ? `${b.numero_parcela}ª` : '—'}${b.numero_documento ? ` · documento ${b.numero_documento}` : ''}`]);
    linhas.push(['Nosso número', nossoNumero(b) || '—']);
    const abatimento = Number(b.valor_abatimento) || 0;
    linhas.push(['Valor', abatimento > 0 ? `${moeda(b.valor)} − abatimento ${moeda(abatimento)} = ${moeda(Number(b.valor) - abatimento)}` : moeda(b.valor)]);
    const original = String(b.vencimento_original || '').slice(0, 10);
    const venc = String(b.data_vencimento || '').slice(0, 10);
    linhas.push(['Vencimento', `${dia(venc) || '—'}${original && original !== venc ? ` (prorrogado; era ${dia(original)})` : ''}`]);
    linhas.push(['Emissão', dia(b.data_emissao) || '—']);
    if (b.linha_digitavel) linhas.push(['Linha digitável', b.linha_digitavel]);
    if (b.data_pagamento || Number(b.valor_pago) > 0) {
      linhas.push(['Pagamento', [dia(b.data_pagamento), Number(b.valor_pago) > 0 ? moeda(b.valor_pago) : '', b.canal_pagamento || ''].filter(Boolean).join(' · ')]);
    }
    if (b.status === 'baixado') {
      linhas.push(['Baixa', [dia(b.data_baixa), MOTIVOS[b.motivo_baixa] || '', b.observacao_baixa || ''].filter(Boolean).join(' · ') || '—']);
    }
    if (b.substitui_boleto_id) linhas.push(['Reemissão', `substitui o boleto nº ${b.substitui_boleto_id}`]);
    if (b.status === 'erro' && b.erro) linhas.push(['Erro', b.erro]);
    linhas.push(['Última consulta ao BB', b.sincronizado_em ? momento(b.sincronizado_em) : 'ainda não consultado']);
    return linhas;
  }

  /** O que aparece: seções de ação só com o SQL da fase, a ação possível e a permissão. */
  function secoesVisiveis(estado, pode) {
    const acoes = estado?.acoes || {};
    const sql = Boolean(estado?.sql_pronto);
    const podeVer = pode('financeiro.boleto.view');
    const podeAlterar = pode('financeiro.boleto.baixa');
    return {
      semSql: Boolean(estado) && !sql,
      sincronizar: sql && Boolean(acoes.sincronizar) && podeVer,
      prorrogar: sql && Boolean(acoes.prorrogar) && podeAlterar,
      abatimento: sql && Boolean(acoes.abatimento) && podeAlterar,
      baixar: sql && Boolean(acoes.baixar) && podeAlterar,
      pdf: Boolean(acoes.pdf) && podeVer
    };
  }

  /** Os campos que o motivo da baixa pede. */
  function camposDoMotivo(motivo) {
    return { quitado: motivo === 'quitado_por_fora', reemissao: motivo === 'reemissao', observacaoObrigatoria: motivo === 'cancelado' };
  }

  /** O corpo do POST /baixar e o que falta preencher ('' quando está completo). */
  function corpoDaBaixa(v) {
    const motivo = String(v?.motivo || '');
    const campos = camposDoMotivo(motivo);
    const observacao = String(v?.observacao || '').trim();
    const corpo = { motivo, observacao };
    let falta = '';
    if (!motivo) falta = 'Escolha o motivo da baixa.';
    else if (campos.quitado) {
      Object.assign(corpo, { data_recebimento: v.dataRecebimento || '', valor_recebido: Number(v.valorRecebido) || 0, forma: v.forma || '' });
      if (!corpo.data_recebimento) falta = 'Informe a data em que o valor foi recebido.';
      else if (!(corpo.valor_recebido > 0)) falta = 'Informe o valor recebido.';
      else if (!corpo.forma) falta = 'Informe como o valor foi recebido.';
    } else if (campos.reemissao) {
      corpo.novo_vencimento = v.novoVencimento || '';
      if (!corpo.novo_vencimento) falta = 'Informe o vencimento do boleto novo.';
    } else if (campos.observacaoObrigatoria && !observacao) {
      falta = 'Diga na observação por que a cobrança foi cancelada.';
    }
    return { corpo, falta };
  }

  /** O texto da confirmação de cada ação. */
  function textoDaConfirmacao(acao, { boleto, producao, novaData, valor, baixa }) {
    const onde = producao ? 'no Banco do Brasil (PRODUÇÃO)' : 'na homologação do BB (teste, sem valor)';
    const parcela = boleto?.numero_parcela ? ` da parcela ${boleto.numero_parcela}` : '';
    if (acao === 'prorrogar') {
      return { title: 'Prorrogar o vencimento?', message: `O boleto${parcela} passa a vencer em ${dia(novaData)} (era ${dia(boleto?.data_vencimento)}) ${onde}. Nada é enviado ao cliente.`, confirmText: 'Prorrogar' };
    }
    if (acao === 'abatimento') {
      return { title: 'Conceder abatimento?', message: `O boleto${parcela} passa a cobrar ${moeda(Number(boleto?.valor) - Number(valor))} (abatimento de ${moeda(valor)}) ${onde}. Nada é enviado ao cliente.`, confirmText: 'Conceder abatimento' };
    }
    const extra = baixa?.motivo === 'reemissao'
      ? ` Em seguida um boleto novo é registrado para a parcela, vencendo em ${dia(baixa.novo_vencimento)}.`
      : (baixa?.motivo === 'quitado_por_fora' ? ` Fica registrado o recebimento de ${moeda(baixa.valor_recebido)} em ${dia(baixa.data_recebimento)} (${baixa.forma}).` : '');
    return {
      title: 'Baixar o boleto?',
      message: `O boleto${parcela} (${MOTIVOS[baixa?.motivo] || '—'}) sai de cobrança ${onde} e não poderá mais ser pago. Não tem volta.${extra}`,
      confirmText: 'Baixar boleto'
    };
  }

  function rotuloDoEvento(e) {
    const origem = e?.origem === 'webhook' ? 'webhook' : (e?.origem === 'consulta' ? 'consulta' : 'app');
    return `${EVENTOS[e?.tipo] || String(e?.tipo || '')}${origem !== 'app' ? ` (${origem})` : ''}`;
  }

  function mensagemDeErro(status, corpo, padrao) {
    if (status === 403) return 'Você não tem permissão para esta ação.';
    if (status === 404) return 'Boleto não encontrado.';
    return corpo?.error || padrao;
  }
  // ------------------------------------------------- fim das funções puras

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const bruto = window.boletoDetalheContext;
  const ctx = { boletoId: bruto?.boletoId ?? null, pedidoId: bruto?.pedidoId ?? null, numero: bruto?.numero ? String(bruto.numero) : '', parcela: bruto?.parcela ?? null };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ boletoDetalheContext: ctx }));

  const el = id => overlay.querySelector(`#${id}`);
  const mensagemEl = el('boletoDetalheMensagem');
  const avisosEl = el('boletoDetalheAvisos');
  const motivoEl = el('boletoDetalheMotivo');
  let estado = null;
  let emAndamento = false;
  let fechado = false;

  const pode = chave => (typeof window.Permissoes?.pode === 'function' ? window.Permissoes.pode(chave) : true);
  const mostrar = (id, sim) => el(id)?.classList.toggle('hidden', !sim);

  function desligarOuvintes() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
  }
  function fechar() {
    if (fechado || emAndamento) return;
    fechado = true;
    desligarOuvintes();
    if (window.boletoDetalheContext === bruto) window.boletoDetalheContext = null;
    Modal.close(overlayId);
  }
  function aoEsc(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('dialog[data-dialog-padrao][open]')) return;
    e.preventDefault();
    fechar();
  }
  function aoFecharModal(evento) {
    if (evento?.detail === overlayId) desligarOuvintes();
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharModal);
  el('voltarBoletoDetalhe')?.addEventListener('click', fechar);
  el('fecharBoletoDetalhe')?.addEventListener('click', fechar);

  function exibirMensagem(tipo, texto) {
    mensagemEl.textContent = texto;
    mensagemEl.style.color = tipo === 'erro' ? 'var(--color-red)' : (tipo === 'ok' ? 'var(--color-green)' : 'var(--color-primary-light)');
    mensagemEl.classList.remove('hidden');
  }

  function exibirAvisos(lista) {
    avisosEl.replaceChildren();
    for (const texto of lista || []) {
      const li = document.createElement('li');
      li.textContent = texto;
      avisosEl.appendChild(li);
    }
    avisosEl.classList.toggle('hidden', !(lista || []).length);
  }

  function pintarDados(b) {
    const dl = el('boletoDetalheDados');
    dl.replaceChildren();
    for (const [rotulo, valor] of linhasDeDados(b)) {
      const bloco = document.createElement('div');
      bloco.className = 'min-w-0';
      const dt = document.createElement('dt');
      dt.className = 'text-xs text-gray-400';
      dt.textContent = rotulo;
      const dd = document.createElement('dd');
      dd.className = 'text-white break-all';
      dd.textContent = valor;
      bloco.append(dt, dd);
      dl.appendChild(bloco);
    }
  }

  function pintarEventos(eventos) {
    const ul = el('boletoDetalheEventos');
    ul.replaceChildren();
    for (const e of eventos || []) {
      const li = document.createElement('li');
      li.className = 'px-4 py-2';
      const topo = document.createElement('p');
      topo.className = 'text-xs text-gray-400';
      topo.textContent = [momento(e.criado_em), rotuloDoEvento(e), e.pendente && e.origem === 'webhook' ? 'na fila' : ''].filter(Boolean).join(' · ');
      li.appendChild(topo);
      if (e.mensagem) {
        const texto = document.createElement('p');
        texto.className = 'text-white break-words';
        texto.textContent = e.mensagem;
        li.appendChild(texto);
      }
      ul.appendChild(li);
    }
    mostrar('boletoDetalheHistorico', (eventos || []).length > 0);
  }

  function preencherFormas(formas) {
    const select = el('boletoDetalheForma');
    if (select.options.length) return;
    const vazio = document.createElement('option');
    vazio.value = '';
    vazio.textContent = 'Escolha…';
    select.appendChild(vazio);
    for (const f of formas || []) {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      select.appendChild(o);
    }
  }

  function atualizarMotivo() {
    const campos = camposDoMotivo(motivoEl.value);
    mostrar('boletoDetalheQuitado', campos.quitado);
    el('boletoDetalheQuitado').style.display = campos.quitado ? '' : 'none';
    mostrar('boletoDetalheReemissao', campos.reemissao);
    mostrar('boletoDetalheObservacaoObrigatoria', campos.observacaoObrigatoria);
  }

  function pintar() {
    const b = estado?.boleto || null;
    const producao = b?.ambiente === 'producao';
    const amb = el('boletoDetalheAmbiente');
    amb.className = `${producao ? 'badge-success' : 'badge-warning'} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    amb.textContent = producao ? 'Produção' : 'Homologação (teste, sem valor)';
    el('boletoDetalheTituloTexto').textContent = b?.numero_parcela ? `Boleto da parcela ${b.numero_parcela}ª` : 'Boleto';
    el('boletoDetalheSubtitulo').textContent = [ctx.numero ? `Pedido ${ctx.numero}` : '', nossoNumero(b)].filter(Boolean).join(' · ');

    const r = rotuloDoStatus(b);
    const tag = el('boletoDetalheStatus');
    tag.className = `${r.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
    tag.textContent = r.texto;
    el('boletoDetalheSituacaoBB').textContent = b?.situacao_bb ? `No BB: ${b.situacao_bb}${b.codigo_estado_bb ? ` (${b.codigo_estado_bb})` : ''}` : '';
    pintarDados(b);
    mostrar('boletoDetalheSituacao', Boolean(b));

    const v = secoesVisiveis(estado, pode);
    const aviso = el('boletoDetalheSemSql');
    aviso.style.display = v.semSql ? 'flex' : 'none';
    aviso.classList.toggle('hidden', !v.semSql);
    mostrar('boletoDetalheProrrogar', v.prorrogar);
    mostrar('boletoDetalheAbatimento', v.abatimento);
    mostrar('boletoDetalheBaixar', v.baixar);
    mostrar('boletoDetalheSincronizar', v.sincronizar);
    mostrar('boletoDetalhePdf', v.pdf);

    const hoje = estado?.hoje || new Date().toISOString().slice(0, 10);
    const venc = String(b?.data_vencimento || '').slice(0, 10);
    const minimo = venc && somarDias(venc, 1) > hoje ? somarDias(venc, 1) : hoje;
    const novaData = el('boletoDetalheNovaData');
    novaData.min = minimo;
    if (!novaData.value || novaData.value < minimo) novaData.value = '';
    const abatido = Number(b?.valor_abatimento) || 0;
    el('boletoDetalheAbatimentoBtn').textContent = abatido > 0 ? 'Alterar' : 'Conceder';
    el('boletoDetalheAbatimentoInfo').textContent = `Reduz o valor a pagar no Banco do Brasil${abatido > 0 ? ` (hoje: ${moeda(abatido)})` : ''}. Juros e multa continuam sobre o valor original.`;
    el('boletoDetalheDataRecebimento').max = hoje;
    el('boletoDetalheNovoVencimento').min = hoje;
    const recebido = el('boletoDetalheValorRecebido');
    if (!recebido.value && b) recebido.value = String(Math.round((Number(b.valor) - abatido) * 100) / 100);
    preencherFormas(estado?.formas_recebimento);
    atualizarMotivo();
    pintarEventos(estado?.eventos);
  }

  async function carregar() {
    try {
      const resp = await fetchApi(`/api/cobranca/boletos/${encodeURIComponent(ctx.boletoId)}/historico`);
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(mensagemDeErro(resp.status, corpo, 'Não foi possível ler o boleto.'));
      estado = corpo;
      pintar();
    } catch (err) {
      exibirMensagem('erro', err?.message || 'Não foi possível ler o boleto.');
    } finally {
      el('boletoDetalheCarregando').classList.add('hidden');
    }
  }

  /** POST numa rota do boleto; o resultado relê o modal e avisa a lista do pedido. */
  async function executar(acao, corpo, sucesso) {
    if (emAndamento || fechado) return;
    emAndamento = true;
    mensagemEl.classList.add('hidden');
    exibirAvisos([]);
    try {
      let resp;
      try {
        resp = await fetchApi(`/api/cobranca/boletos/${encodeURIComponent(ctx.boletoId)}/${acao}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {})
        });
      } catch (_) {
        exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      const resposta = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, resposta, 'O Banco do Brasil não aceitou a operação.')); return; }
      const texto = sucesso(resposta);
      const avisos = Array.isArray(resposta?.avisos) ? resposta.avisos : [];
      exibirMensagem(avisos.length ? 'info' : 'ok', texto);
      exibirAvisos(avisos);
      window.showToast?.(texto, avisos.length ? 'info' : 'success');
      window.dispatchEvent(new CustomEvent('boletos:alterados', { detail: { pedidoId: ctx.pedidoId, boletoId: ctx.boletoId, acao } }));
      window.carregarPedidos?.();
      await carregar();
    } finally {
      emAndamento = false;
    }
  }

  const producao = () => estado?.boleto?.ambiente === 'producao';

  function sincronizar() {
    return executar('sincronizar', {}, r => `Consultado no BB: ${r?.boleto?.situacao_bb || 'sem estado'}${r?.mudou ? ` — agora "${rotuloDoStatus(r.boleto).texto}"` : ''}.`);
  }

  async function prorrogar() {
    const novaData = el('boletoDetalheNovaData').value;
    if (!novaData) { exibirMensagem('erro', 'Escolha a nova data de vencimento.'); return; }
    const ok = await window.DialogPadrao?.confirm?.(textoDaConfirmacao('prorrogar', { boleto: estado?.boleto, producao: producao(), novaData }));
    if (!ok) return;
    await executar('prorrogar', { data_vencimento: novaData }, r => `Vencimento prorrogado para ${dia(r?.boleto?.data_vencimento)}.`);
    el('boletoDetalheNovaData').value = '';
  }

  async function abatimento() {
    const campo = el('boletoDetalheValorAbatimento');
    const valor = typeof window.NumericInput?.parse === 'function' ? window.NumericInput.parse(campo.value) : Number(String(campo.value).replace(',', '.'));
    if (!(valor > 0)) { exibirMensagem('erro', 'Informe o valor do abatimento.'); return; }
    const ok = await window.DialogPadrao?.confirm?.(textoDaConfirmacao('abatimento', { boleto: estado?.boleto, producao: producao(), valor }));
    if (!ok) return;
    await executar('abatimento', { valor }, r => `Abatimento de ${moeda(r?.boleto?.valor_abatimento)} concedido.`);
    campo.value = '';
  }

  async function baixar() {
    const numero = campo => (typeof window.NumericInput?.parse === 'function' ? window.NumericInput.parse(campo.value) : Number(String(campo.value).replace(',', '.')));
    const { corpo, falta } = corpoDaBaixa({
      motivo: motivoEl.value,
      observacao: el('boletoDetalheObservacao').value,
      dataRecebimento: el('boletoDetalheDataRecebimento').value,
      valorRecebido: numero(el('boletoDetalheValorRecebido')),
      forma: el('boletoDetalheForma').value,
      novoVencimento: el('boletoDetalheNovoVencimento').value
    });
    if (falta) { exibirMensagem('erro', falta); return; }
    const ok = await window.DialogPadrao?.confirm?.(textoDaConfirmacao('baixar', { boleto: estado?.boleto, producao: producao(), baixa: corpo }));
    if (!ok) return;
    await executar('baixar', corpo, r => {
      const novo = r?.reemissao?.resultados?.find(x => x.ok && !x.ja_existia)?.boleto;
      return novo
        ? `Boleto baixado. Boleto novo registrado: ${novo.nosso_numero}${novo.linha_digitavel ? ` · ${novo.linha_digitavel}` : ''}.`
        : 'Boleto baixado no Banco do Brasil.';
    });
  }

  function gerarPdf() {
    if (!window.BoletoDocumentos) { exibirMensagem('erro', 'Geração de PDF indisponível nesta janela.'); return null; }
    return window.BoletoDocumentos.gerarBoletoPdf(ctx.boletoId);
  }

  motivoEl.addEventListener('change', atualizarMotivo);
  const ligar = (id, fn) => {
    const botao = el(id);
    if (!botao) return;
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, fn);
    else botao.addEventListener('click', fn);
  };
  ligar('boletoDetalheSincronizar', sincronizar);
  ligar('boletoDetalheProrrogarBtn', prorrogar);
  ligar('boletoDetalheAbatimentoBtn', abatimento);
  ligar('boletoDetalheBaixarBtn', baixar);
  ligar('boletoDetalhePdf', gerarPdf);

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
