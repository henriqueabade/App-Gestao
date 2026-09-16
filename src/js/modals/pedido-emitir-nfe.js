/**
 * Modal "Emitir NF-e e enviar".
 *
 * Marcar um pedido como "Enviado" é o momento da nota fiscal: a mercadoria sai
 * com o DANFE. Por isso o ✓ da lista abre este modal no lugar da pergunta
 * "alterar para Enviado?". Ele:
 *
 *   1. confere o pedido (GET /api/fiscal/pedidos/:id/prontidao): destinatário,
 *      itens com NCM/CFOP, valor, parcelas e as pendências — o que bloqueia
 *      (cadastro incompleto) e o que a emissão resolve sozinha (código IBGE);
 *   2. pede o que só se sabe no embarque: frete, transportadora, volumes,
 *      pesos, forma de pagamento da NF-e e informações complementares;
 *   3. emite (POST /api/fiscal/pedidos/:id/emitir) e, SÓ com a nota autorizada,
 *      muda a situação (PUT /api/pedidos/:id/status). Rejeição da SEFAZ fica na
 *      tela com o motivo; o pedido continua em produção.
 *
 * "Enviar sem NF-e" continua existindo (pedido faturado por fora, cortesia):
 * pede confirmação e muda a situação sem nota. Quem já tem nota autorizada
 * (a situação falhou numa tentativa anterior) só marca como enviado.
 *
 * Contexto: `window.emitirNfeContext = { pedidoId, numero, cliente }`.
 */
(async () => {
  const overlayId = 'emitirNfePedido';
  const overlay = document.getElementById('emitirNfePedidoOverlay');
  if (!overlay) return;

  // ==================================================================
  // Funções puras: sem DOM, sem rede. O teste
  // (src/js/__tests__/pedidoEmitirNfe.test.js) recorta o trecho até o
  // marcador "fim das funções puras" e o executa isolado.
  // ==================================================================
  const STATUS_VIVOS = ['autorizada', 'processando', 'enviando', 'cancelamento_pendente'];
  const ROTULO_STATUS = {
    autorizada: 'autorizada', processando: 'em processamento na SEFAZ', enviando: 'enviada, sem resposta da SEFAZ',
    rejeitada: 'rejeitada', denegada: 'denegada', cancelada: 'cancelada', cancelamento_pendente: 'com cancelamento pendente',
    erro_tecnico: 'com erro técnico', rascunho: 'em rascunho'
  };

  /** A nota que ainda conta para o pedido (autorizada ou a caminho), ou null. */
  function notaQueVale(notas) {
    return (Array.isArray(notas) ? notas : [])
      .filter(n => n && STATUS_VIVOS.includes(String(n.status_fiscal)))
      .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  }

  /** A última tentativa do pedido, seja qual for o status (para explicar uma rejeição). */
  function ultimaNota(notas) {
    return (Array.isArray(notas) ? notas : []).filter(Boolean).sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  }

  /** '2026-09-15T15:10:01-03:00' → '15/09/2026' (corte do texto: sem fuso no caminho). */
  function diaDoTexto(valor) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? '').trim());
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  /** "NF-e série 1 nº 2 — autorizada em 15/09/2026 · protocolo … · chave …". */
  function textoDaNota(nota) {
    if (!nota) return '';
    const status = ROTULO_STATUS[nota.status_fiscal] || nota.status_fiscal;
    const partes = [`NF-e série ${nota.serie} nº ${nota.numero} — ${status}`];
    if (nota.status_fiscal === 'autorizada' && nota.data_autorizacao) partes[0] += ` em ${diaDoTexto(nota.data_autorizacao)}`;
    if (nota.ambiente === 'homologacao') partes[0] += ' (homologação, sem valor fiscal)';
    if (nota.protocolo) partes.push(`protocolo ${nota.protocolo}`);
    if (nota.chave_acesso) partes.push(`chave ${nota.chave_acesso}`);
    if (['rejeitada', 'denegada', 'erro_tecnico'].includes(nota.status_fiscal) && nota.motivo_sefaz) {
      partes.push(`motivo: ${nota.codigo_status_sefaz ? `${nota.codigo_status_sefaz} — ` : ''}${nota.motivo_sefaz}`);
    }
    return partes.join(' · ');
  }

  /** Número digitado em pt-BR ("1.234,5") ou com ponto ("12.5"); vazio → null; lixo → NaN. */
  function lerNumero(texto) {
    const t = String(texto ?? '').trim();
    if (!t) return null;
    const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    const n = Number(normalizado);
    return Number.isFinite(n) ? n : NaN;
  }

  /**
   * Mais de um volume: uma linha por volume. Mantém o que já foi digitado nas
   * linhas existentes e completa as novas com a espécie/pesos dos campos gerais.
   */
  function linhasDeVolumes(quantidade, base = {}, existentes = []) {
    const n = lerNumero(quantidade);
    if (!Number.isInteger(n) || n < 2) return [];
    const atuais = Array.isArray(existentes) ? existentes : [];
    return Array.from({ length: n }, (_, i) => (atuais[i]
      ? { ...atuais[i], numero: i + 1 }
      : { numero: i + 1, especie: String(base.especie ?? ''), peso_bruto: String(base.peso_bruto ?? ''), peso_liquido: String(base.peso_liquido ?? '') }));
  }

  /** O que se manda ao POST /emitir a partir dos campos da tela. */
  function corpoDaEmissao(campos = {}) {
    const linhas = Array.isArray(campos.volumes) && campos.volumes.length >= 2 ? campos.volumes : null;
    const transporte = {
      modalidade_frete: Number(campos.modalidade_frete ?? 9),
      transportadora_nome: String(campos.transportadora ?? '').trim(),
      volumes_quantidade: linhas ? linhas.length : lerNumero(campos.volumes_quantidade),
      volumes_especie: String(campos.volumes_especie ?? '').trim(),
      peso_bruto: lerNumero(campos.peso_bruto),
      peso_liquido: lerNumero(campos.peso_liquido)
    };
    if (linhas) {
      transporte.volumes = linhas.map((v, i) => ({
        numeracao: String(v.numero ?? i + 1), especie: String(v.especie ?? '').trim(),
        peso_bruto: lerNumero(v.peso_bruto), peso_liquido: lerNumero(v.peso_liquido)
      }));
    }
    return {
      transporte,
      pagamento: { tPag: String(campos.tPag || '').padStart(2, '0') },
      informacoes_complementares: String(campos.informacoes_complementares ?? '').trim()
    };
  }

  /** O que impede de emitir a partir dos campos (número inválido, volumes sem espécie). */
  function validarCampos(campos = {}) {
    const erros = [];
    for (const [chave, rotulo] of [['volumes_quantidade', 'Volumes'], ['peso_bruto', 'Peso bruto'], ['peso_liquido', 'Peso líquido']]) {
      const n = lerNumero(campos[chave]);
      if (Number.isNaN(n) || (n !== null && n < 0)) erros.push(`${rotulo}: informe um número válido.`);
    }
    const volumes = lerNumero(campos.volumes_quantidade);
    const linhas = Array.isArray(campos.volumes) && campos.volumes.length >= 2 ? campos.volumes : null;
    if (volumes > 0 && !linhas && !String(campos.volumes_especie ?? '').trim()) erros.push('Informe a espécie dos volumes (ex.: Caixa).');
    if (volumes !== null && !Number.isNaN(volumes) && !Number.isInteger(volumes)) erros.push('Volumes: use um número inteiro.');
    if (String(campos.modalidade_frete) === '9' && volumes > 0) erros.push('Sem frete (9) não leva volumes: escolha a modalidade ou zere os volumes.');
    for (const [i, v] of (linhas || []).entries()) {
      if (!String(v.especie ?? '').trim()) erros.push(`Volume ${i + 1}: informe a espécie.`);
      for (const [chave, rotulo] of [['peso_bruto', 'peso bruto'], ['peso_liquido', 'peso líquido']]) {
        const n = lerNumero(v[chave]);
        if (Number.isNaN(n) || (n !== null && n < 0)) erros.push(`Volume ${i + 1}: ${rotulo} inválido.`);
      }
    }
    return erros;
  }

  function classificarPendencias(pendencias) {
    const lista = Array.isArray(pendencias) ? pendencias : [];
    return { bloqueiam: lista.filter(p => !p?.automatico), automaticas: lista.filter(p => p?.automatico) };
  }

  function rotuloAmbiente(ambiente) {
    return ambiente === 'producao'
      ? { texto: 'Produção', classe: 'badge-success' }
      : { texto: 'Homologação (teste, sem valor fiscal)', classe: 'badge-warning' };
  }

  /**
   * Qual é a ação principal: emitir, só marcar como enviado (nota já
   * autorizada) ou esperar (nota a caminho, que se consulta).
   */
  function acaoPrincipal({ pronto, notaViva } = {}) {
    if (notaViva?.status_fiscal === 'autorizada') return { acao: 'marcar', rotulo: 'Marcar como Enviado', consultar: false };
    if (notaViva) return { acao: 'aguardar', rotulo: 'Aguardando a SEFAZ', consultar: true };
    return { acao: 'emitir', rotulo: 'Emitir NF-e e enviar', consultar: false, bloqueada: !pronto };
  }

  /** O que dizer quando a emissão ou a troca de situação é recusada. */
  function mensagemDeErro(status, corpo, contexto = 'emitir') {
    if (status === 403) return contexto === 'enviar' ? 'Você não tem permissão para marcar o pedido como enviado.' : 'Você não tem permissão para emitir NF-e.';
    if (status === 404) return 'Pedido não encontrado. Ele pode ter sido excluído.';
    if (corpo?.code === 'JA_ENVIADO') return 'O pedido já estava enviado (outra aba ou outro usuário).';
    if (status === 422 && corpo?.sefaz?.cStat) return `A SEFAZ rejeitou a nota (${corpo.sefaz.cStat}): ${corpo.sefaz.xMotivo || corpo.error}. Corrija e emita de novo — o número será reaproveitado.`;
    if (status === 504) return corpo?.error || 'A SEFAZ demorou a responder. A nota ficou em processamento: use "Consultar na SEFAZ".';
    return corpo?.error || (contexto === 'enviar' ? 'Não foi possível marcar o pedido como enviado.' : 'Não foi possível emitir a NF-e.');
  }
  // ==================================================================
  // fim das funções puras
  // ==================================================================

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const formatarMoeda = v => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const formatarDocumento = d => {
    const s = String(d || '').replace(/\D/g, '');
    if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return s || '—';
  };

  const bruto = window.emitirNfeContext;
  const pedidoId = bruto?.pedidoId ?? window.selectedOrderId ?? null;
  const ctx = { pedidoId, numero: bruto?.numero ? String(bruto.numero) : '', cliente: bruto?.cliente ? String(bruto.cliente) : '' };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ emitirNfeContext: ctx, selectedOrderId: pedidoId }));

  const el = id => overlay.querySelector(`#${id}`);
  const carregandoEl = el('emitirNfeCarregando');
  const conteudoEl = el('emitirNfeConteudo');
  const mensagemEl = el('emitirNfeMensagem');
  const pendenciasEl = el('emitirNfePendencias');
  const pendenciasTitulo = el('emitirNfePendenciasTitulo');
  const pendenciasLista = el('emitirNfePendenciasLista');
  const notaBloco = el('emitirNfeNotaExistente');
  const notaTexto = el('emitirNfeNotaTexto');
  const consultarBtn = el('emitirNfeConsultar');
  const confirmarBtn = el('emitirNfeConfirmar');
  const semNfeBtn = el('enviarSemNfe');
  const rodapeAviso = el('emitirNfeRodapeAviso');
  const campos = {
    modalidade_frete: el('emitirNfeFrete'), transportadora: el('emitirNfeTransportadora'), volumes_quantidade: el('emitirNfeVolumes'),
    volumes_especie: el('emitirNfeEspecie'), peso_bruto: el('emitirNfePesoBruto'), peso_liquido: el('emitirNfePesoLiquido'),
    tPag: el('emitirNfePagamento'), informacoes_complementares: el('emitirNfeInformacoes')
  };

  let estado = { pronto: false, pendencias: [], resumo: null, ambiente: 'homologacao', notas: [] };
  let emAndamento = false;
  let fechado = false;

  // ------------------------------------------------------------ fechar
  function desligarOuvintes() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
  }
  function fechar() {
    if (fechado) return;
    fechado = true;
    desligarOuvintes();
    if (window.emitirNfeContext === bruto) window.emitirNfeContext = null;
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
  el('voltarEmitirNfe')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('cancelarEmitirNfe')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  // --------------------------------------------------------- mensagens
  function exibirMensagem(tipo, texto) {
    mensagemEl.textContent = texto;
    mensagemEl.style.color = tipo === 'erro' ? 'var(--color-red)' : (tipo === 'ok' ? 'var(--color-green)' : 'var(--color-primary-light)');
    mensagemEl.classList.remove('hidden');
  }
  function limparMensagem() {
    mensagemEl.textContent = '';
    mensagemEl.classList.add('hidden');
  }

  // ------------------------------------------------------------ pintar
  function pintarPendencias(pendencias) {
    const { bloqueiam, automaticas } = classificarPendencias(pendencias);
    pendenciasLista.replaceChildren();
    if (!bloqueiam.length && !automaticas.length) {
      pendenciasEl.classList.add('hidden');
      return;
    }
    const lista = bloqueiam.length ? bloqueiam : automaticas;
    pendenciasTitulo.textContent = bloqueiam.length
      ? `${bloqueiam.length === 1 ? 'Falta corrigir 1 item' : `Faltam corrigir ${bloqueiam.length} itens`} antes de emitir:`
      : 'A emissão resolve sozinha:';
    pendenciasEl.style.borderColor = bloqueiam.length ? 'var(--color-red)' : 'var(--color-primary)';
    pendenciasTitulo.style.color = bloqueiam.length ? 'var(--color-red)' : 'var(--color-primary-light)';
    for (const p of lista) {
      const li = document.createElement('li');
      li.className = 'text-gray-200';
      li.textContent = p.mensagem;
      pendenciasLista.appendChild(li);
    }
    if (bloqueiam.length && automaticas.length) {
      const li = document.createElement('li');
      li.className = 'text-gray-400';
      li.textContent = `${automaticas.length === 1 ? 'Mais 1 item' : `Mais ${automaticas.length} itens`} que a emissão resolve sozinha.`;
      pendenciasLista.appendChild(li);
    }
    pendenciasEl.classList.remove('hidden');
  }

  function pintarItens(itens) {
    const corpo = el('emitirNfeItens');
    corpo.replaceChildren();
    const celula = (texto, classe) => { const td = document.createElement('td'); td.className = classe; td.textContent = texto; return td; };
    for (const it of Array.isArray(itens) ? itens : []) {
      const tr = document.createElement('tr');
      tr.append(
        celula(it.codigo || '—', 'px-4 py-3 text-white whitespace-nowrap'),
        celula(it.descricao || '—', 'px-4 py-3 text-white'),
        celula(it.ncm || '—', 'px-4 py-3 text-gray-300 whitespace-nowrap'),
        celula(it.cfop || '—', 'px-4 py-3 text-gray-300 whitespace-nowrap'),
        celula(it.quantidade === null || it.quantidade === undefined ? '—' : String(it.quantidade), 'px-4 py-3 text-right text-white'),
        celula(formatarMoeda(it.valor_total), 'px-4 py-3 text-right text-white')
      );
      corpo.appendChild(tr);
    }
  }

  function pintarNota() {
    const viva = notaQueVale(estado.notas);
    const ultima = ultimaNota(estado.notas);
    const nota = viva || ultima;
    if (!nota) {
      notaBloco.classList.add('hidden');
      return;
    }
    notaTexto.textContent = textoDaNota(nota);
    notaTexto.style.color = nota.status_fiscal === 'autorizada' ? 'var(--color-green)' : (viva ? 'var(--color-primary-light)' : 'var(--color-red)');
    consultarBtn.classList.toggle('hidden', !(viva && viva.status_fiscal !== 'autorizada'));
    notaBloco.classList.remove('hidden');
  }

  function pintarBotoes() {
    const viva = notaQueVale(estado.notas);
    const acao = acaoPrincipal({ pronto: estado.pronto, notaViva: viva });
    confirmarBtn.replaceChildren();
    const icone = document.createElement('i');
    icone.className = `fas ${acao.acao === 'marcar' ? 'fa-check' : 'fa-paper-plane'} mr-2`;
    icone.setAttribute('aria-hidden', 'true');
    confirmarBtn.append(icone, document.createTextNode(acao.rotulo));
    confirmarBtn.disabled = acao.acao === 'aguardar' || Boolean(acao.bloqueada);
    confirmarBtn.dataset.acao = acao.acao;
    // Com nota viva os campos de transporte já foram usados: some o que não se aplica.
    overlay.querySelectorAll('[data-emitir-nfe-campos]').forEach(sec => sec.classList.toggle('hidden', Boolean(viva)));
    semNfeBtn.classList.toggle('hidden', Boolean(viva));
    rodapeAviso.textContent = acao.acao === 'emitir'
      ? (estado.ambiente === 'producao' ? 'A nota sai com valor fiscal. Confira antes de emitir.' : 'Ambiente de homologação: a nota não tem valor fiscal.')
      : (acao.acao === 'marcar' ? 'A nota já foi autorizada; falta só mudar a situação do pedido.' : 'Consulte a SEFAZ para saber se a nota foi autorizada.');
  }

  function pintar() {
    const r = estado.resumo || {};
    const badge = rotuloAmbiente(estado.ambiente);
    const ambienteEl = el('emitirNfeAmbiente');
    ambienteEl.className = `${badge.classe} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    ambienteEl.textContent = badge.texto;
    el('emitirNfeSubtitulo').textContent = [ctx.numero ? `Pedido ${ctx.numero}` : '', ctx.cliente].filter(Boolean).join(' · ');
    el('emitirNfeCliente').textContent = r.cliente || ctx.cliente || '—';
    el('emitirNfeClienteDetalhe').textContent = [formatarDocumento(r.documentoCliente), [r.cidadeCliente, r.ufDestino].filter(Boolean).join('/')].filter(t => t && t !== '—').join(' · ');
    el('emitirNfeValor').textContent = formatarMoeda(r.valorFinal);
    el('emitirNfeParcelas').textContent = r.parcelas ? `${r.parcelas} · somam ${formatarMoeda(r.somaParcelas)}` : 'nenhuma';
    pintarItens(r.itens);
    pintarPendencias(estado.pendencias);
    pintarNota();
    pintarBotoes();
  }

  function preencherCampos() {
    const r = estado.resumo || {};
    const frete = r.frete || {};
    campos.modalidade_frete.value = String(frete.modalidade ?? 9);
    if (!campos.modalidade_frete.value) campos.modalidade_frete.value = '9';
    campos.transportadora.value = frete.transportadora && !/^n[aã]o definid/i.test(frete.transportadora) ? frete.transportadora : '';
    campos.volumes_quantidade.value = frete.volumes_quantidade ?? '';
    campos.volumes_especie.value = frete.volumes_especie ?? '';
    campos.peso_bruto.value = frete.peso_bruto ?? '';
    campos.peso_liquido.value = frete.peso_liquido ?? '';
    campos.tPag.value = r.tPagSugerido || '99';
    if (!campos.tPag.value) campos.tPag.value = '99';
    el('emitirNfePagamentoOrigem').textContent = r.formaPagamento ? `Sugerida pela forma de pagamento do pedido: "${r.formaPagamento}".` : '';
  }

  // ------------------------------------------------- volumes detalhados
  const volumesBloco = el('emitirNfeVolumesDetalhe');
  const volumesCorpo = el('emitirNfeVolumesLinhas');
  let volumesLinhas = [];

  function lerVolumesDaTela() {
    return Array.from(volumesCorpo?.querySelectorAll('tr') || []).map((tr, i) => ({
      numero: i + 1,
      especie: tr.querySelector('[data-volume="especie"]')?.value ?? '',
      peso_bruto: tr.querySelector('[data-volume="peso_bruto"]')?.value ?? '',
      peso_liquido: tr.querySelector('[data-volume="peso_liquido"]')?.value ?? ''
    }));
  }

  function renderizarVolumes() {
    if (!volumesBloco || !volumesCorpo) return;
    const base = { especie: campos.volumes_especie.value, peso_bruto: campos.peso_bruto.value, peso_liquido: campos.peso_liquido.value };
    volumesLinhas = linhasDeVolumes(campos.volumes_quantidade.value, base, lerVolumesDaTela().length ? lerVolumesDaTela() : volumesLinhas);
    volumesCorpo.replaceChildren();
    for (const linha of volumesLinhas) {
      const tr = document.createElement('tr');
      const numero = document.createElement('td');
      numero.className = 'px-4 py-2 text-white';
      numero.textContent = String(linha.numero);
      tr.appendChild(numero);
      for (const [chave, largura, modo] of [['especie', 'w-full min-w-[10rem]', 'text'], ['peso_bruto', 'w-32', 'decimal'], ['peso_liquido', 'w-32', 'decimal']]) {
        const td = document.createElement('td');
        td.className = 'px-4 py-2';
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = modo;
        input.dataset.volume = chave;
        input.value = linha[chave] ?? '';
        input.placeholder = chave === 'especie' ? 'ex.: Caixa' : '0,000';
        input.className = `${largura} bg-input border border-inputBorder rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition`;
        input.addEventListener('input', limparMensagem);
        td.appendChild(input);
        tr.appendChild(td);
      }
      volumesCorpo.appendChild(tr);
    }
    volumesBloco.classList.toggle('hidden', volumesLinhas.length === 0);
  }

  function valoresDosCampos() {
    const valores = Object.fromEntries(Object.entries(campos).map(([k, input]) => [k, input?.value ?? '']));
    const linhas = lerVolumesDaTela();
    valores.volumes = volumesBloco && !volumesBloco.classList.contains('hidden') && linhas.length >= 2 ? linhas : null;
    return valores;
  }

  // ----------------------------------------------------------- ações
  /** Sinaliza o pedido como enviado sem nota (tag roxa na lista). Não trava o envio. */
  async function dispensarNfe() {
    try {
      const resp = await fetchApi(`/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/dispensar-nfe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!resp.ok) console.warn('Pedido enviado, mas a marca "sem nota" não foi gravada:', resp.status);
    } catch (err) {
      console.warn('Pedido enviado, mas a marca "sem nota" não foi gravada:', err);
    }
  }

  async function marcarEnviado(nota) {
    let resp;
    try {
      resp = await fetchApi(`/api/pedidos/${encodeURIComponent(pedidoId)}/status`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Enviado' })
      });
    } catch (err) {
      console.error('Erro de rede ao marcar o pedido como enviado:', err);
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
      return false;
    }
    const corpo = await resp.json().catch(() => null);
    if (!resp.ok) {
      exibirMensagem('erro', `${mensagemDeErro(resp.status, corpo, 'enviar')}${nota ? ' A NF-e já está autorizada.' : ''}`);
      return false;
    }
    if (!nota) await dispensarNfe();
    const mensagens = typeof window.mensagensDaTrocaDeStatus === 'function' ? window.mensagensDaTrocaDeStatus(true, resp.status, corpo) : [];
    window.showToast?.(nota ? `NF-e nº ${nota.numero} autorizada e pedido ${ctx.numero} enviado.` : `Pedido ${ctx.numero} marcado como enviado sem nota fiscal.`, 'success');
    mensagens.forEach(m => window.showToast?.(m.texto, m.tipo));
    window.dispatchEvent(new CustomEvent('pedido:enviado', { detail: { pedidoId, resposta: corpo, nota: nota || null } }));
    window.carregarPedidos?.();
    fechar();
    return true;
  }

  async function emitir() {
    const valores = valoresDosCampos();
    const erros = validarCampos(valores);
    if (erros.length) {
      exibirMensagem('erro', erros.join(' '));
      return false;
    }
    let resp;
    try {
      resp = await fetchApi(`/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/emitir`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoDaEmissao(valores))
      });
    } catch (err) {
      console.error('Erro de rede ao emitir a NF-e:', err);
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
      return false;
    }
    const corpo = await resp.json().catch(() => null);
    if (!resp.ok) {
      if (Array.isArray(corpo?.pendencias)) {
        estado.pendencias = corpo.pendencias;
        estado.pronto = !corpo.pendencias.some(p => !p?.automatico);
        pintarPendencias(estado.pendencias);
      }
      if (corpo?.nota) {
        estado.notas = [corpo.nota, ...estado.notas.filter(n => Number(n.id) !== Number(corpo.nota.id))];
        pintarNota();
        pintarBotoes();
      }
      exibirMensagem('erro', mensagemDeErro(resp.status, corpo));
      return false;
    }
    if (corpo?.nota) estado.notas = [corpo.nota, ...estado.notas.filter(n => Number(n.id) !== Number(corpo.nota.id))];
    (corpo?.avisos || []).forEach(a => window.showToast?.(a, 'info'));
    if (corpo?.autorizada) return marcarEnviado(corpo.nota);
    pintarNota();
    pintarBotoes();
    exibirMensagem('info', `A SEFAZ ainda está processando a nota (${corpo?.sefaz?.cStat || ''} ${corpo?.sefaz?.xMotivo || ''}). Clique em "Consultar na SEFAZ" em instantes; o pedido continua em produção até a autorização.`);
    return false;
  }

  async function consultar() {
    const viva = notaQueVale(estado.notas);
    if (!viva) return;
    let resp;
    try {
      resp = await fetchApi(`/api/fiscal/notas/${encodeURIComponent(viva.id)}/sincronizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch (err) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
      return;
    }
    const corpo = await resp.json().catch(() => null);
    if (corpo?.nota) estado.notas = [corpo.nota, ...estado.notas.filter(n => Number(n.id) !== Number(corpo.nota.id))];
    pintarNota();
    pintarBotoes();
    if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
    if (corpo?.autorizada) exibirMensagem('ok', 'NF-e autorizada. Agora é só marcar o pedido como enviado.');
    else if (corpo?.naoConsta) exibirMensagem('info', 'A SEFAZ não recebeu a nota. Pode emitir de novo: o número será reaproveitado.');
    else exibirMensagem('info', `SEFAZ ${corpo?.sefaz?.cStat || ''}: ${corpo?.sefaz?.xMotivo || 'ainda em processamento.'}`);
  }

  async function principal() {
    if (emAndamento || fechado) return;
    limparMensagem();
    emAndamento = true;
    try {
      const acao = confirmarBtn.dataset.acao;
      if (acao === 'marcar') await marcarEnviado(notaQueVale(estado.notas));
      else if (acao === 'emitir') await emitir();
    } finally {
      emAndamento = false;
    }
  }

  async function enviarSemNfe() {
    if (emAndamento || fechado) return;
    limparMensagem();
    // A caixa de diálogo da casa (DialogPadrao), nunca o confirm() do navegador.
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Enviar sem NF-e?',
      message: `O pedido ${ctx.numero} será marcado como "Enviado" SEM emitir a nota fiscal e fica sinalizado na lista como "sem nota". Use só quando a nota foi (ou será) emitida por fora.`,
      confirmText: 'Enviar sem NF-e'
    });
    if (!ok) return;
    emAndamento = true;
    try { await marcarEnviado(null); } finally { emAndamento = false; }
  }

  if (typeof window.BotaoAcao?.bind === 'function') {
    window.BotaoAcao.bind(confirmarBtn, principal);
    window.BotaoAcao.bind(consultarBtn, consultar);
  } else {
    confirmarBtn.addEventListener('click', principal);
    consultarBtn.addEventListener('click', consultar);
  }
  semNfeBtn.addEventListener('click', enviarSemNfe);
  Object.values(campos).forEach(input => input?.addEventListener('input', limparMensagem));
  campos.volumes_quantidade.addEventListener('input', renderizarVolumes);
  campos.volumes_quantidade.addEventListener('change', renderizarVolumes);

  // ------------------------------------------------------------ carga
  try {
    if (!pedidoId) throw new Error('Pedido não informado.');
    const resp = await fetchApi(`/api/fiscal/pedidos/${encodeURIComponent(pedidoId)}/prontidao`);
    const corpo = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(mensagemDeErro(resp.status, corpo));
    estado = {
      pronto: Boolean(corpo.pronto), pendencias: corpo.pendencias || [], resumo: corpo.resumo || null,
      ambiente: corpo.ambiente === 'producao' ? 'producao' : 'homologacao', notas: Array.isArray(corpo.notas) ? corpo.notas : []
    };
    preencherCampos();
    renderizarVolumes();
    pintar();
    carregandoEl.classList.add('hidden');
    conteudoEl.classList.remove('hidden');
  } catch (err) {
    console.error('Erro ao conferir o pedido para a NF-e:', err);
    carregandoEl.classList.add('hidden');
    exibirMensagem('erro', err?.message || 'Não foi possível conferir o pedido.');
    confirmarBtn.disabled = true;
  } finally {
    window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
  }
})();
