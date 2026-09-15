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
  const COLUNAS_DATE = new Set(['data_aprovacao', 'embarcar_real', 'embarcar_previsao', 'inicio_faturamento']);

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

  const close = () => {
    Modal.close(overlayId);
    document.removeEventListener('keydown', esc);
  };
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
    const statusInfo = statusConfig[data.situacao] || { badge: 'badge-neutral', dateKey: null };
    if (statusTag) {
      statusTag.textContent = data.situacao || 'Sem status';
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
        <td data-perm-col="col_ped_it_qtd" class="text-left text-white">${fmtNumber(qtd)}</td>
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
    overlay.querySelector('#totalPedido').textContent = fmtCurrency(total);
    const footerTotal = overlay.querySelector('#totalPedidoFooter');
    if (footerTotal) footerTotal.textContent = fmtCurrency(total);

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
      }
    }

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
