(async () => {
  const overlayId = 'visualizarPedido';
  const overlay = document.getElementById('visualizarPedidoOverlay');
  if (!overlay) return;

  const close = () => {
    Modal.close(overlayId);
    document.removeEventListener('keydown', esc);
  };
  const esc = e => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', esc);
  overlay.querySelector('#voltarVisualizarPedido')?.addEventListener('click', close);
  overlay.querySelector('#voltarVisualizarPedidoFooter')?.addEventListener('click', close);

  const id = window.selectedOrderId;
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

  try {
    const resp = await fetch(`http://localhost:3000/api/pedidos/${id}`);
    if (!resp.ok) throw new Error('Falha ao buscar pedido');
    const data = await resp.json();

    overlay.querySelector('#tituloVisualizarPedido').textContent = `VISUALIZAR PEDIDO ${data.numero || ''}`.trim();

    const filled = el => el?.setAttribute('data-filled', 'true');

    try {
      const clientesResp = await fetch('http://localhost:3000/api/clientes/lista');
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
        const respContatos = await fetch(`http://localhost:3000/api/clientes/${data.cliente_id}`);
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
        contatoSel.innerHTML = data.contato_id ? `<option>${data.contato_id}</option>` : '<option></option>';
        filled(contatoSel);
      }
    }

    try {
      if (transportadoraSel) {
        const respTransportadoras = await fetch(`http://localhost:3000/api/transportadoras/${data.cliente_id}`);
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
      'Em Producao': { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      'Producao': { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      'Enviado': { badge: 'badge-info', dateKey: 'data_envio' },
      'Entregue': { badge: 'badge-success', dateKey: 'data_entrega' },
      'Cancelado': { badge: 'badge-danger', dateKey: 'data_cancelamento' },
      'Rascunho': { badge: 'badge-neutral', dateKey: 'data_emissao' }
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
      if (dateValue) {
        const dt = new Date(dateValue);
        dateTag.textContent = `Atualizado em ${dt.toLocaleDateString('pt-BR')}`;
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
        <td class="px-6 py-4 text-sm text-white">${item.nome || ''}</td>
        <td class="px-6 py-4 text-center text-sm text-white">${fmtNumber(qtd)}</td>
        <td class="px-6 py-4 text-right text-sm text-white">${fmtNumber(valorUnit)}</td>
        <td class="px-6 py-4 text-right text-sm text-white">${fmtNumber(valorUnitDesc)}</td>
        <td class="px-6 py-4 text-center text-sm text-white">${fmtNumber(descPagPrc + descEspPrc)}</td>
        <td class="px-6 py-4 text-right text-sm text-white">${fmtCurrency(valorTotal)}</td>
        <td class="px-6 py-4 text-center modal-actions-disabled">
          <div class="flex items-center justify-center gap-2">
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
        const dataEmissao = data.data_emissao ? new Date(data.data_emissao) : null;
        const prazos = (data.prazo || '').split('/').map(p => p.trim()).filter(Boolean);
        const rows = data.parcelas_detalhes.map((p, index) => {
          let prazoDias = '';
          if (prazos[index] !== undefined) {
            prazoDias = `${prazos[index]} dias`;
          } else if (dataEmissao && p.data_vencimento) {
            const diff = Math.ceil((new Date(p.data_vencimento) - dataEmissao) / 86400000);
            prazoDias = `${diff} dias`;
          }
          return `<tr class="border-b border-white/10"><td class="px-6 py-4 text-left text-sm text-white">${p.numero_parcela || ''}?</td><td class="px-6 py-4 text-left text-sm text-white">${fmtCurrency(p.valor)}</td><td class="px-6 py-4 text-left text-sm text-white">${prazoDias}</td></tr>`;
        }).join('');
        pagamentoBox.innerHTML = `
          <h4 class="text-white font-medium mb-4">Parcelas</h4>
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
  } catch (err) {
    console.error('Erro ao carregar pedido', err);
    if (typeof showToast === 'function') showToast('Erro ao carregar pedido', 'error');
  }

  overlay.querySelector('#cancelarVisualizarPedido')?.addEventListener('click', () => {
    if (typeof showToast === 'function') showToast('Funcionalidade em criacao!', 'info');
  });

  window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
})();
