(async () => {
  const overlayId = 'visualizarPedido';
  const overlay = document.getElementById('visualizarPedidoOverlay');
  if (!overlay) return;
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const escapeAttr = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');

  // ------------------------------------------------------------------
  // Datas
  //
  // Colunas DATE ('YYYY-MM-DD') são cortadas como texto, nunca passam por
  // `new Date()`: servidas como '2026-09-13T00:00:00.000Z' e convertidas para
  // o fuso local, virariam o dia 12. As demais (emissão, entrega...) são
  // instantes e seguem o fuso de quem olha.
  // ------------------------------------------------------------------
  const COLUNAS_DATE = new Set(['data_aprovacao', 'embarcar_real', 'embarcar_previsao', 'inicio_faturamento', 'data_devolucao']);

  function diaDeColunaDate(valor) {
    if (valor === null || valor === undefined) return null;
    const achado = /^(\d{4}-\d{2}-\d{2})/.exec(String(valor).trim());
    return achado ? achado[1] : null;
  }

  function formatarDia(dia) {
    const [ano, mes, d] = String(dia).split('-');
    return `${d}/${mes}/${ano}`;
  }

  /** Dia (em São Paulo) de um instante; texto que já é só data volta como está. */
  function diaEmSaoPaulo(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const texto = String(valor).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    const instante = new Date(texto);
    if (Number.isNaN(instante.getTime())) return null;
    const partes = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(instante).forEach(p => { partes[p.type] = p.value; });
    return partes.year && partes.month && partes.day ? `${partes.year}-${partes.month}-${partes.day}` : null;
  }

  /** a − b em dias de calendário, em UTC — sem hora local nem horário de verão. */
  function diferencaEmDias(a, b) {
    const utc = dia => {
      const [ano, mes, d] = dia.split('-').map(Number);
      return Date.UTC(ano, mes - 1, d);
    };
    return Math.round((utc(a) - utc(b)) / 86400000);
  }

  /**
   * De onde os vencimentos contam: o início do faturamento; nos pedidos
   * antigos, que não o têm, o dia (em São Paulo) da emissão — a mesma regra
   * do backend.
   */
  function baseDoFaturamento(pedido) {
    return diaDeColunaDate(pedido?.inicio_faturamento) || diaEmSaoPaulo(pedido?.data_emissao);
  }

  function formatarDataDaColuna(coluna, valor) {
    if (COLUNAS_DATE.has(coluna)) {
      const dia = diaDeColunaDate(valor);
      return dia ? formatarDia(dia) : '';
    }
    const instante = new Date(valor);
    return Number.isNaN(instante.getTime()) ? '' : instante.toLocaleDateString('pt-BR');
  }

  // ------------------------------------------------------------------
  // Tags do rodapé: NF-e (ou "sem nota fiscal"), frete, volumes e pesos —
  // o que foi informado no embarque. Pura e autocontida: o teste a recorta.
  // ------------------------------------------------------------------
  function tagsDoEmbarque(pedido, notas, cartas = 0, boletos = null, notasDevolucao = []) {
    const ROTULO_FRETE = { 0: 'CIF (emitente)', 1: 'FOB (destinatário)', 2: 'terceiros', 3: 'próprio (emitente)', 4: 'próprio (destinatário)', 9: 'sem frete' };
    const STATUS_NF = {
      autorizada: ['badge-success', 'autorizada'], processando: ['badge-warning', 'em processamento'], enviando: ['badge-warning', 'enviada'],
      cancelamento_pendente: ['badge-warning', 'cancelamento pendente'], rejeitada: ['badge-danger', 'rejeitada'], denegada: ['badge-danger', 'denegada'],
      cancelada: ['badge-danger', 'cancelada'], erro_tecnico: ['badge-danger', 'erro técnico']
    };
    const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const kg = v => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`;
    const p = pedido || {};
    const tags = [];
    const lista = (Array.isArray(notas) ? notas : []).filter(Boolean).sort((a, b) => Number(b.id) - Number(a.id));
    const nota = lista.find(n => ['autorizada', 'processando', 'enviando', 'cancelamento_pendente'].includes(String(n.status_fiscal))) || lista[0] || null;
    if (nota) {
      const [classe, rotulo] = STATUS_NF[nota.status_fiscal] || ['badge-neutral', String(nota.status_fiscal || '')];
      const valor = Number(nota.valor_total);
      tags.push({
        classe,
        texto: `NF-e ${nota.serie}/${nota.numero} · ${rotulo}${Number.isFinite(valor) && valor > 0 ? ` · ${brl(valor)}` : ''}${nota.ambiente === 'homologacao' ? ' · homologação' : ''}`
      });
    } else if (p.nfe_dispensada === true || p.nfe_dispensada === 'true') {
      tags.push({ classe: 'badge-neutral', texto: 'Sem nota fiscal' });
    }
    const totalCartas = Number(cartas) || 0;
    if (nota && totalCartas > 0) tags.push({ classe: 'badge-info', texto: totalCartas === 1 ? 'CC-e 1' : `CC-e ×${totalCartas}` });
    // Devolução (roxo): o que voltou e a nota que o cliente emitiu.
    const devolvido = Number(p.valor_devolvido);
    if (p.devolucao && devolvido > 0) tags.push({ classe: 'badge-purple', texto: `${p.devolucao === 'total' ? 'Devolvido' : 'Devolução parcial'} · ${brl(devolvido)}` });
    for (const nd of (Array.isArray(notasDevolucao) ? notasDevolucao : []).filter(Boolean)) {
      tags.push({ classe: 'badge-purple', texto: `NF dev. ${nd.serie ?? ''}/${nd.numero ?? ''}` });
    }
    // Boletos das parcelas (cobrança BB): quantas parcelas já têm boleto vivo, e quantos pagos.
    const parcelas = Number(boletos?.parcelas) || 0;
    const registrados = Number(boletos?.registrados) || 0;
    if (parcelas > 0 && registrados > 0) {
      const pagos = Number(boletos?.pagos) || 0;
      tags.push({ classe: registrados === parcelas ? 'badge-success' : 'badge-warning', texto: `Boletos ${registrados}/${parcelas}${pagos ? ` · ${pagos} pago${pagos > 1 ? 's' : ''}` : ''}` });
    }
    const modalidade = p.modalidade_frete;
    if (modalidade !== null && modalidade !== undefined && modalidade !== '' && ROTULO_FRETE[Number(modalidade)]) {
      tags.push({ classe: 'badge-neutral', texto: `Frete: ${ROTULO_FRETE[Number(modalidade)]}` });
    }
    const volumes = Number(p.volumes_quantidade);
    if (volumes > 0) tags.push({ classe: 'badge-info', texto: `Volumes: ${volumes}${p.volumes_especie ? ` ${p.volumes_especie}` : ''}` });
    const pesos = [];
    if (Number(p.peso_bruto) > 0) pesos.push(`${kg(p.peso_bruto)} bruto`);
    if (Number(p.peso_liquido) > 0) pesos.push(`${kg(p.peso_liquido)} líq.`);
    if (pesos.length) tags.push({ classe: 'badge-neutral', texto: `Peso: ${pesos.join(' · ')}` });
    return tags;
  }

  /** O resumo dos boletos para a tag, a partir do estado GET /api/cobranca/pedidos/:id/boletos. Pura. */
  function resumoDeBoletos(estado) {
    const linhas = Array.isArray(estado?.parcelas) ? estado.parcelas : [];
    return {
      parcelas: linhas.length,
      registrados: linhas.filter(l => l?.tem_boleto_vivo).length,
      pagos: linhas.filter(l => l?.boleto?.status === 'pago').length,
      com_erro: linhas.filter(l => l?.boleto?.status === 'erro').length
    };
  }

  /** Como cada boleto aparece na coluna das parcelas: classe da tag e texto. Pura. */
  function rotuloDoBoleto(boleto) {
    if (!boleto) return { classe: 'badge-neutral', texto: 'sem boleto' };
    const ROTULO = { registrado: ['badge-success', 'registrado'], pago: ['badge-success', 'pago'], baixado: ['badge-neutral', 'baixado'], vencido: ['badge-warning', 'vencido'], protestado: ['badge-danger', 'protestado'], erro: ['badge-danger', 'erro'], reservado: ['badge-warning', 'reservado'] };
    const MOTIVO = { quitado_por_fora: 'quitado por fora', cancelado: 'cancelado', reemissao: 'reemissão', banco: 'pelo banco' };
    const [classe, rotuloBase] = ROTULO[boleto.status] || ['badge-neutral', String(boleto.status || '')];
    const rotulo = boleto.status === 'baixado' && MOTIVO[boleto.motivo_baixa] ? `${rotuloBase} (${MOTIVO[boleto.motivo_baixa]})` : rotuloBase;
    const numero = boleto.nosso_numero ? `${boleto.nosso_numero}${boleto.nosso_numero_dv ? `-${boleto.nosso_numero_dv}` : ''}` : '';
    return { classe, texto: `${rotulo}${numero ? ` · ${numero}` : ''}${boleto.ambiente === 'sandbox' ? ' · homologação' : ''}`, detalhe: boleto.status === 'erro' ? (boleto.erro || '') : (boleto.linha_digitavel || '') };
  }

  /**
   * Pedido enviado, entregue ou com NF-e autorizada não se cancela: devolve-se.
   * Cancelada a nota (na SEFAZ), o pedido em produção volta a ser cancelável. Pura.
   */
  function pedidoSeDevolve(pedido, notas) {
    const situacao = String(pedido?.situacao || '').trim().toLowerCase();
    if (situacao === 'cancelado') return false;
    if (situacao === 'enviado' || situacao === 'entregue' || Boolean(pedido?.devolucao)) return true;
    return (Array.isArray(notas) ? notas : []).some(n => n && String(n.status_fiscal) === 'autorizada');
  }

  /** A etiqueta de status: a devolução (roxa) vence o Enviado/Entregue que está por baixo. Pura. */
  function etiquetaDaDevolucao(pedido) {
    if (pedido?.devolucao === 'total') return { rotulo: 'Devolvido', badge: 'badge-purple', dateKey: 'data_devolucao' };
    if (pedido?.devolucao === 'parcial') return { rotulo: 'Parcial', badge: 'badge-purple', dateKey: 'data_devolucao' };
    return null;
  }

  function pintarTags(tags) {
    const caixa = overlay.querySelector('#visualizarPedidoTagsLista') || overlay.querySelector('#visualizarPedidoTags');
    if (!caixa) return;
    caixa.replaceChildren();
    for (const t of tags) {
      const s = document.createElement('span');
      s.className = `${t.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
      s.textContent = t.texto;
      caixa.appendChild(s);
    }
  }

  /** A nota que vale para DANFE/XML/cancelamento: autorizada (ou cancelada, que ainda tem DANFE e XML). */
  function notaParaDocumentos(notas) {
    return (Array.isArray(notas) ? notas : []).filter(n => n && ['autorizada', 'cancelada'].includes(String(n.status_fiscal)))
      .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  }

  function ligarDocumentosDaNota(nota, pedido) {
    const danfeBtn = overlay.querySelector('#visualizarPedidoDanfe');
    const xmlBtn = overlay.querySelector('#visualizarPedidoXml');
    const cancelarBtn = overlay.querySelector('#visualizarPedidoCancelarNfe');
    if (!nota) return;
    const aviso = (texto, tipo) => { if (typeof showToast === 'function') showToast(texto, tipo || 'info'); };

    // DANFE e XML ficam em utils/nfe-documentos.js: a lista de pedidos usa os mesmos.
    const gerarDanfe = () => (window.NfeDocumentos ? window.NfeDocumentos.gerarDanfe(nota.id) : aviso('Documentos da NF-e indisponíveis.', 'error'));
    const salvarXml = () => (window.NfeDocumentos ? window.NfeDocumentos.salvarXml(nota.id) : aviso('Documentos da NF-e indisponíveis.', 'error'));

    const contextoDaNota = () => ({ notaId: nota.id, serie: nota.serie, numero: nota.numero, chave: nota.chave_acesso, pedidoId: id, pedidoNumero: pedido?.numero || '', email: nota.destinatario?.email || '' });
    const cancelarNfe = () => {
      window.cancelarNfeContext = contextoDaNota();
      close();
      Modal.open('modals/pedidos/cancelar-nfe.html', '../js/modals/pedido-cancelar-nfe.js', 'cancelarNfe');
    };
    const emailNfe = () => {
      window.emailNfeContext = contextoDaNota();
      close();
      Modal.open('modals/pedidos/enviar-nfe-email.html', '../js/modals/pedido-enviar-nfe-email.js', 'enviarNfeEmail');
    };
    const cartaNfe = () => {
      window.cartaCorrecaoContext = contextoDaNota();
      close();
      Modal.open('modals/pedidos/carta-correcao-nfe.html', '../js/modals/pedido-carta-correcao-nfe.js', 'cartaCorrecaoNfe');
    };

    const ligar = (botao, fn) => {
      if (!botao) return;
      botao.classList.remove('hidden');
      if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, fn);
      else botao.addEventListener('click', fn);
    };
    ligar(danfeBtn, gerarDanfe);
    ligar(xmlBtn, salvarXml);
    ligar(overlay.querySelector('#visualizarPedidoEmailNfe'), emailNfe);
    if (nota.status_fiscal === 'autorizada') {
      ligar(overlay.querySelector('#visualizarPedidoCartaNfe'), cartaNfe);
      ligar(cancelarBtn, cancelarNfe);
    }
  }

  /**
   * A coluna "BOLETO" na tabela de parcelas, montada por createElement sobre
   * as linhas já desenhadas (uma por parcela, na ordem de `detalhes`).
   */
  function pintarColunaDeBoletos(caixa, detalhes, estado) {
    if (!estado || !Array.isArray(estado.parcelas)) return;
    const tabela = caixa.querySelector('table');
    const cabecalho = tabela?.querySelector('thead tr');
    const linhas = tabela ? Array.from(tabela.querySelectorAll('tbody tr')) : [];
    if (!cabecalho || !linhas.length) return;
    const th = document.createElement('th');
    th.className = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
    th.textContent = 'BOLETO';
    cabecalho.appendChild(th);
    const porParcela = new Map(estado.parcelas.map(l => [String(l?.parcela?.id), l]));
    detalhes.forEach((p, i) => {
      const tr = linhas[i];
      if (!tr) return;
      const td = document.createElement('td');
      td.className = 'px-6 py-4 text-left text-sm';
      const linha = porParcela.get(String(p.id)) || estado.parcelas.find(l => Number(l?.parcela?.numero_parcela) === Number(p.numero_parcela));
      const r = rotuloDoBoleto(linha?.boleto || null);
      const tag = document.createElement('span');
      tag.className = `${r.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
      tag.textContent = r.texto;
      if (r.detalhe) tag.title = r.detalhe;
      // Boleto a pagar: a tag gera o PDF daquela parcela.
      if (linha?.boleto && boletoImprimivel(linha.boleto) && window.BoletoDocumentos) {
        tag.classList.add('cursor-pointer');
        tag.setAttribute('role', 'button');
        tag.dataset.perm = 'financeiro.boleto.view';
        tag.title = `${r.detalhe ? `${r.detalhe} — ` : ''}clique para gerar o PDF do boleto`;
        tag.addEventListener('click', () => window.BoletoDocumentos.gerarBoletoPdf(linha.boleto.id));
      }
      td.appendChild(tag);
      tr.appendChild(td);
    });
  }

  /** Boleto que ainda se paga (registrado, vencido ou em protesto): tem PDF. Pura. */
  function boletoImprimivel(boleto) {
    return ['registrado', 'vencido', 'protestado'].includes(String(boleto?.status || ''));
  }

  /** "Boletos (PDF)" no rodapé: todos os boletos a pagar do pedido. */
  function ligarBoletosPdf(estado) {
    const botao = overlay.querySelector('#visualizarPedidoBoletosPdf');
    if (!botao || !estado || !Array.isArray(estado.parcelas)) return;
    if (!estado.parcelas.some(l => boletoImprimivel(l?.boleto)) || !window.BoletoDocumentos) return;
    const gerar = () => window.BoletoDocumentos.gerarBoletosDoPedidoPdf(id);
    botao.classList.remove('hidden');
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, gerar);
    else botao.addEventListener('click', gerar);
  }

  /**
   * "Gerar boletos" no rodapé: só quando há parcela sem boleto vivo e o pedido
   * não está cancelado. Com tudo gerado, "Boletos" abre o mesmo modal para
   * consultar, prorrogar, conceder abatimento e baixar (fase D).
   */
  function ligarGerarBoletos(estado, pedido) {
    const botao = overlay.querySelector('#visualizarPedidoGerarBoletos');
    const lista = overlay.querySelector('#visualizarPedidoBoletos');
    if (!estado || !Array.isArray(estado.parcelas)) return;
    const falta = estado.parcelas.some(l => !l?.tem_boleto_vivo);
    const cancelado = String(pedido?.situacao || '').toLowerCase() === 'cancelado';
    const abrir = () => {
      window.gerarBoletosContext = { pedidoId: id, numero: pedido?.numero || '', cliente: pedido?.cliente_nome || '' };
      close();
      Modal.open('modals/pedidos/gerar-boletos.html', '../js/modals/pedido-gerar-boletos.js', 'gerarBoletos');
    };
    const ligar = b => {
      b.classList.remove('hidden');
      if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(b, abrir);
      else b.addEventListener('click', abrir);
    };
    const temBoleto = estado.parcelas.some(l => l?.boleto?.id);
    // Quem só vê boletos (ou pedido cancelado, cujos boletos ainda se baixam) entra pela lista.
    const podeGerar = typeof window.Permissoes?.pode === 'function' ? window.Permissoes.pode('financeiro.boleto.emit') : true;
    if (botao && falta && !cancelado && podeGerar) ligar(botao);
    else if (lista && temBoleto) ligar(lista);
  }

  const close = () => {
    Modal.close(overlayId);
    document.removeEventListener('keydown', esc);
  };

  /** O botão roxo "Devolução" toma o lugar do "Cancelar" (a permissão de cada um está escrita no HTML). */
  function ligarDevolucao(pedido, notas) {
    const devolver = overlay.querySelector('#devolucaoVisualizarPedido');
    if (!devolver || !pedidoSeDevolve(pedido, notas)) return;
    overlay.querySelector('#cancelarVisualizarPedido')?.classList.add('hidden');
    devolver.classList.remove('hidden');
    devolver.addEventListener('click', () => {
      window.devolucaoPedidoContext = { pedidoId: window.selectedOrderId, numero: pedido?.numero || '', cliente: pedido?.cliente_nome || '' };
      close();
      Modal.open('modals/pedidos/devolucao.html', '../js/modals/pedido-devolucao.js', 'devolucaoPedido');
    });
  }
  const esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  overlay.querySelector('#voltarVisualizarPedido')?.addEventListener('click', close);
  overlay.querySelector('#voltarVisualizarPedidoFooter')?.addEventListener('click', close);

  const id = window.selectedOrderId;

  // Tela só de leitura, mas sem devolver `window.selectedOrderId` o script sai
  // na linha seguinte e o modal reabre vazio (ver
  // docs/restauracao-de-trabalho.md). É também daqui que sai o contexto do
  // "Cancelar Pedido", então perder isso quebraria o cancelamento inteiro.
  window.EstadoTrabalho?.registrarContexto?.(overlayId,
    () => ({ selectedOrderId: window.selectedOrderId }));

  if (!id) return;

  const clienteSel = overlay.querySelector('#visualizarPedidoCliente');
  const contatoSel = overlay.querySelector('#visualizarPedidoContato');
  const condicaoSel = overlay.querySelector('#visualizarPedidoCondicao');
  const transportadoraSel = overlay.querySelector('#visualizarPedidoTransportadora');
  const formaSel = overlay.querySelector('#visualizarPedidoFormaPagamento');
  const validadeInput = overlay.querySelector('#visualizarPedidoValidade');
  const donoSel = overlay.querySelector('#visualizarPedidoDono');
  const obsInput = overlay.querySelector('#visualizarPedidoObservacoes');
  const itensTbody = overlay.querySelector('#pedidoItens tbody');
  const pagamentoBox = overlay.querySelector('#visualizarPedidoPagamento');

  window.cancelarPedidoContext = null;

  try {
    const resp = await fetchApi(`/api/pedidos/${id}`);
    if (!resp.ok) throw new Error('Falha ao buscar pedido');
    const data = await resp.json();

    overlay.querySelector('#tituloVisualizarPedido').textContent = `VISUALIZAR PEDIDO ${data.numero || ''}`.trim();

    const filled = el => el?.setAttribute('data-filled', 'true');

    try {
      const clientesResp = await fetchApi('/api/clientes/lista');
      if (!clientesResp.ok) throw new Error();
      const clientes = await clientesResp.json();
      if (clienteSel) {
        clienteSel.innerHTML = clientes.map(c => `<option value="${c.id}">${c.nome_fantasia}</option>`).join('');
        if (data.cliente_id) {
          clienteSel.value = String(data.cliente_id);
          filled(clienteSel);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar clientes', err);
      if (clienteSel) {
        const fallback = data.cliente || 'Cliente nao identificado';
        clienteSel.innerHTML = `<option>${fallback}</option>`;
        filled(clienteSel);
      }
    }

    try {
      if (data.cliente_id && contatoSel) {
        const respContatos = await fetchApi(`/api/clientes/${data.cliente_id}`);
        if (!respContatos.ok) throw new Error();
        const clienteData = await respContatos.json();
        const contatos = clienteData.contatos || [];
        contatoSel.innerHTML = contatos.map(ct => `<option value="${ct.id}">${ct.nome}</option>`).join('');
        if (data.contato_id) {
          contatoSel.value = String(data.contato_id);
          filled(contatoSel);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar contatos', err);
      if (contatoSel) {
        const fallback = data.contato || data.contato_id || '';
        contatoSel.innerHTML = fallback ? `<option>${fallback}</option>` : '<option></option>';
        if (fallback) {
          contatoSel.value = fallback;
          filled(contatoSel);
        }
      }
    }

    try {
      if (transportadoraSel) {
        const respTransportadoras = await fetchApi(`/api/transportadoras/${data.cliente_id}`);
        if (respTransportadoras.ok) {
          const transportadoras = await respTransportadoras.json();
          transportadoraSel.innerHTML = transportadoras.map(tp => `<option value="${tp.id}">${tp.nome}</option>`).join('');
          const opt = Array.from(transportadoraSel.options).find(o => o.textContent === data.transportadora);
          if (opt) {
            transportadoraSel.value = opt.value;
            filled(transportadoraSel);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar transportadoras', err);
    } finally {
      if (transportadoraSel && !transportadoraSel.value && data.transportadora) {
        transportadoraSel.innerHTML = `<option>${data.transportadora}</option>`;
        transportadoraSel.value = data.transportadora;
        filled(transportadoraSel);
      }
    }

    if (formaSel) {
      formaSel.value = data.forma_pagamento || '';
      if (formaSel.value) filled(formaSel);
    }

    if (condicaoSel) {
      condicaoSel.value = data.parcelas > 1 ? 'prazo' : 'vista';
      filled(condicaoSel);
    }

    if (validadeInput) {
      validadeInput.value = data.validade ? String(data.validade).split('T')[0] : '';
      if (validadeInput.value) filled(validadeInput);
    }

    if (obsInput) {
      obsInput.value = data.observacoes || '';
      if (obsInput.value) filled(obsInput);
    }

    if (donoSel) {
      const dono = data.dono || '';
      donoSel.innerHTML = `<option>${dono}</option>`;
      donoSel.value = dono;
      if (dono) filled(donoSel);
    }

    const statusConfig = {
      'Produção': { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      'Em Produção': { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      'Em Producao': { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      Producao: { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      Pendente: { badge: 'badge-warning', dateKey: 'data_emissao' },
      Enviado: { badge: 'badge-info', dateKey: 'embarcar_real' },
      Entregue: { badge: 'badge-success', dateKey: 'data_entrega' },
      Cancelado: { badge: 'badge-danger', dateKey: 'data_cancelamento' },
      Rascunho: { badge: 'badge-neutral', dateKey: 'data_emissao' }
    };
    const statusTag = overlay.querySelector('#statusPedidoTag');
    const dateTag = overlay.querySelector('#dataStatusPedidoTag');
    const daDevolucao = etiquetaDaDevolucao(data);
    const statusInfo = daDevolucao || statusConfig[data.situacao] || { badge: 'badge-neutral', dateKey: null };
    if (statusTag) {
      statusTag.textContent = daDevolucao ? daDevolucao.rotulo : (data.situacao || 'Sem status');
      if (daDevolucao) statusTag.title = `Pedido ${String(data.situacao || '').toLowerCase()} com devolução ${data.devolucao === 'total' ? 'total' : 'parcial'}`;
      statusTag.className = `${statusInfo.badge} px-3 py-1 rounded-full text-xs font-medium`;
    }
    if (dateTag) {
      const dateValue = statusInfo.dateKey ? data[statusInfo.dateKey] : null;
      const dataFormatada = dateValue ? formatarDataDaColuna(statusInfo.dateKey, dateValue) : '';
      if (dataFormatada) {
        dateTag.textContent = `Atualizado em ${dataFormatada}`;
        dateTag.classList.remove('hidden');
      } else {
        dateTag.textContent = '';
        dateTag.classList.add('hidden');
      }
    }

    if (itensTbody) itensTbody.innerHTML = '';
    let subtotal = 0;
    let descPag = 0;
    let descEsp = 0;
    const safeNumber = v => Number(v ?? 0);
    const fmtCurrency = v => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtNumber = v => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    (data.itens || []).forEach(item => {
      if (!itensTbody) return;
      const qtd = safeNumber(item.quantidade);
      const valorUnit = safeNumber(item.valor_unitario);
      const valorUnitDesc = safeNumber(item.valor_unitario_desc);
      const descPagPrc = safeNumber(item.desconto_pagamento_prc);
      const descEspPrc = safeNumber(item.desconto_especial_prc);
      const valorTotal = safeNumber(item.valor_total);
      const descPagUnit = safeNumber(item.desconto_pagamento);
      const descEspUnit = safeNumber(item.desconto_especial);

      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      tr.innerHTML = `
        <td data-perm-col="col_ped_it_nome" class="text-left text-white" title="${escapeAttr(item.nome || '')}">${item.nome || ''}</td>
        <td data-perm-col="col_ped_it_qtd" class="text-left text-white">${fmtNumber(qtd)}${Number(item.quantidade_devolvida) > 0 ? ` <span class="badge-purple ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" title="Peças devolvidas pelo cliente">${Number(item.quantidade_devolvida)} dev.</span>` : ''}</td>
        <td data-perm-col="col_ped_it_preco" class="text-left text-white">${fmtNumber(valorUnit)}</td>
        <td data-perm-col="col_ped_it_preco_desc" class="text-left text-white">${fmtNumber(valorUnitDesc)}</td>
        <td data-perm-col="col_ped_it_desc" class="text-left text-white">${fmtNumber(descPagPrc + descEspPrc)}</td>
        <td data-perm-col="col_ped_it_subtotal" class="text-left text-white">${fmtCurrency(valorTotal)}</td>
        <td class="text-left modal-actions-disabled actions-cell">
          <div class="flex items-center justify-start gap-2">
            <i class="fas fa-edit w-5 h-5 p-1 rounded icon-disabled" style="color: var(--color-primary)"></i>
            <i class="fas fa-trash w-5 h-5 p-1 rounded text-red-400 icon-disabled"></i>
          </div>
        </td>`;
      itensTbody.appendChild(tr);
      subtotal += valorUnit * qtd;
      descPag += descPagUnit * qtd;
      descEsp += descEspUnit * qtd;
    });

    const descontoTotal = descPag + descEsp;
    const total = subtotal - descontoTotal;
    overlay.querySelector('#subtotalPedido').textContent = fmtCurrency(subtotal);
    overlay.querySelector('#descontoPagPedido').textContent = fmtCurrency(descPag);
    overlay.querySelector('#descontoEspPedido').textContent = fmtCurrency(descEsp);
    overlay.querySelector('#descontoPedido').textContent = fmtCurrency(descontoTotal);
    // Devolução parcial: as linhas continuam como foram vendidas; o Total mostra o que restou.
    const devolvido = data.devolucao ? safeNumber(data.valor_devolvido) : 0;
    const totalAtual = data.devolucao === 'parcial' ? Math.max(0, total - devolvido) : total;
    const chipDevolvido = overlay.querySelector('#devolvidoPedidoChip');
    if (chipDevolvido) {
      overlay.querySelector('#devolvidoPedido').textContent = fmtCurrency(devolvido);
      chipDevolvido.classList.toggle('hidden', !(devolvido > 0));
    }
    overlay.querySelector('#totalPedido').textContent = fmtCurrency(totalAtual);
    const footerTotal = overlay.querySelector('#totalPedidoFooter');
    if (footerTotal) footerTotal.textContent = fmtCurrency(totalAtual);

    // Tags do rodapé. As notas exigem financeiro.nfe.view; sem ela (ou sem a
    // tabela) ficam só as do embarque.
    let notas = [];
    try {
      const respNotas = await fetchApi(`/api/fiscal/notas?pedido_id=${encodeURIComponent(id)}`);
      if (respNotas.ok) notas = await respNotas.json();
    } catch (_) { /* sem notas, sem tag */ }
    const notaDocs = notaParaDocumentos(notas);
    const cartas = notaDocs && window.NfeDocumentos?.listarCartasCorrecao ? await window.NfeDocumentos.listarCartasCorrecao(notaDocs.id) : [];
    // Boletos das parcelas (cobrança BB): sem permissão (403) ou sem a cobrança configurada, fica tudo como era.
    let boletosEstado = null;
    try {
      const respBoletos = await fetchApi(`/api/cobranca/pedidos/${encodeURIComponent(id)}/boletos`);
      if (respBoletos.ok) boletosEstado = await respBoletos.json();
    } catch (_) { /* sem boletos, sem coluna */ }
    // A nota de devolução do cliente (guardada pela devolução): sem a tabela ou sem permissão, sem tag.
    let notasDevolucao = [];
    if (data.devolucao) {
      try {
        const respDev = await fetchApi(`/api/devolucoes/notas?pedido_id=${encodeURIComponent(id)}`);
        if (respDev.ok) notasDevolucao = await respDev.json();
      } catch (_) { /* sem nota de devolução, sem tag */ }
    }
    pintarTags(tagsDoEmbarque(data, notas, cartas.length, resumoDeBoletos(boletosEstado), notasDevolucao));
    ligarDevolucao(data, notas);
    ligarDocumentosDaNota(notaDocs, data);

    if (pagamentoBox) {
      pagamentoBox.classList.add('hidden');
      pagamentoBox.innerHTML = '';
      if (data.parcelas_detalhes && data.parcelas_detalhes.length) {
        // O prazo de cada parcela é o dia na posição dela em `prazo`. O upstream
        // ignora o `order` do GET, então a ordem vem de `numero_parcela`.
        const detalhes = data.parcelas_detalhes.slice()
          .sort((a, b) => (Number(a?.numero_parcela) || 0) - (Number(b?.numero_parcela) || 0));
        const baseFaturamento = baseDoFaturamento(data);
        const prazos = (data.prazo || '').split('/').map(p => p.trim()).filter(Boolean);
        const rows = detalhes.map((p, index) => {
          let prazoDias = '';
          const vencimento = diaDeColunaDate(p.data_vencimento);
          if (prazos[index] !== undefined) {
            prazoDias = `${prazos[index]} dias`;
          } else if (baseFaturamento && vencimento) {
            // Sem o texto do prazo, deduz pela distância entre o vencimento e
            // o início do faturamento — não mais a emissão, que deixou de ser a
            // base quando o faturamento ganhou início próprio.
            prazoDias = `${diferencaEmDias(vencimento, baseFaturamento)} dias`;
          }
          const numeroParcela = p.numero_parcela ? `${p.numero_parcela}ª` : '';
          return `<tr class="border-b border-white/10"><td class="px-6 py-4 text-left text-sm text-white">${numeroParcela}</td><td class="px-6 py-4 text-left text-sm text-white">${fmtCurrency(p.valor)}</td><td class="px-6 py-4 text-left text-sm text-white">${prazoDias}</td></tr>`;
        }).join('');
        const previsaoEmbarque = formatarDataDaColuna('embarcar_previsao', data.embarcar_previsao);
        const inicioFaturamento = formatarDataDaColuna('inicio_faturamento', data.inicio_faturamento);
        const datasDoFaturamento = [
          previsaoEmbarque ? `<span class="badge-neutral px-3 py-1 rounded-full text-xs font-medium">Previsão de embarque: ${previsaoEmbarque}</span>` : '',
          inicioFaturamento ? `<span class="badge-info px-3 py-1 rounded-full text-xs font-medium">Início do faturamento: ${inicioFaturamento}</span>` : ''
        ].filter(Boolean).join('');
        pagamentoBox.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h4 class="text-white font-medium">Parcelas</h4>
            ${datasDoFaturamento ? `<div class="flex flex-wrap gap-2">${datasDoFaturamento}</div>` : ''}
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 sticky top-0">
                <tr class="border-b border-gray-200">
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PARCELA</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">VALOR</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PRAZO</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
        pagamentoBox.classList.remove('hidden');
        pintarColunaDeBoletos(pagamentoBox, detalhes, boletosEstado);
      }
    }
    ligarGerarBoletos(boletosEstado, data);
    ligarBoletosPdf(boletosEstado);

    const clienteNome = clienteSel?.selectedOptions?.[0]?.textContent?.trim() || data.cliente || '';
    const contatoNome = contatoSel?.selectedOptions?.[0]?.textContent?.trim() || data.contato || '';
    window.cancelarPedidoContext = {
      id,
      pedido: data,
      numero: data.numero || '',
      cliente: clienteNome,
      contato: contatoNome,
      status: data.situacao || '',
      dataEmissao: data.data_emissao || data.dataEmissao || '',
    };
  } catch (err) {
    console.error('Erro ao carregar pedido', err);
    if (typeof showToast === 'function') showToast('Erro ao carregar pedido', 'error');
    window.cancelarPedidoContext = null;
  }

  overlay.querySelector('#cancelarVisualizarPedido')?.addEventListener('click', async () => {
    if (!window.cancelarPedidoContext || !window.cancelarPedidoContext.pedido) {
      if (typeof showToast === 'function') showToast('Não foi possível carregar os dados do pedido.', 'error');
      return;
    }

    // Cancelar duas vezes devolveria o estoque em dobro. O backend recusa de
    // qualquer forma; aqui a recusa vira uma frase em vez de um erro.
    const situacao = String(window.cancelarPedidoContext.status || '').trim().toLowerCase();
    if (situacao === 'cancelado') {
      if (typeof showToast === 'function') {
        showToast('Este pedido já está cancelado.', 'info');
      }
      return;
    }

    close();
    const openCancelModal = async () => {
      await Modal.open('modals/pedidos/cancelar.html', '../js/modals/pedido-cancelar.js', 'cancelarPedido');
      if (typeof Modal?.waitForReady === 'function') {
        await Modal.waitForReady('cancelarPedido');
      }
    };
    if (typeof window.withModalLoading === 'function') {
      await window.withModalLoading(2000, openCancelModal);
    } else {
      await openCancelModal();
    }
  });

  window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
})();
