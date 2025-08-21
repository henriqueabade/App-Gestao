(async () => {
  const overlayId = 'visualizarOrcamento';
  const overlay = document.getElementById('visualizarOrcamentoOverlay');
  if (!overlay) return;
  const close = () => Modal.close(overlayId);
  const esc = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', esc);
  document.getElementById('voltarVisualizarOrcamento').addEventListener('click', close);
  document.getElementById('voltarVisualizarOrcamentoFooter').addEventListener('click', close);

  const id = window.selectedQuoteId;
  if (!id) return;
  try {
    const resp = await fetch(`http://localhost:3000/api/orcamentos/${id}`);
    const data = await resp.json();

    document.getElementById('tituloVisualizarOrcamento').textContent = `VISUALIZAR ORÇAMENTO ${data.numero}`;

    const clienteSel = document.getElementById('visualizarCliente');
    const contatoSel = document.getElementById('visualizarContato');
    const condicaoSel = document.getElementById('visualizarCondicao');
    const transportadoraSel = document.getElementById('visualizarTransportadora');
    const formaSel = document.getElementById('visualizarFormaPagamento');
    const validadeInput = document.getElementById('visualizarValidade');
    const donoSel = document.getElementById('visualizarDono');
    const obs = document.getElementById('visualizarObservacoes');
    const itensTbody = document.querySelector('#orcamentoItens tbody');

    // carregar nomes de cliente e contatos
    const clientesResp = await fetch('http://localhost:3000/api/clientes/lista');
    const clientes = await clientesResp.json();
    clienteSel.innerHTML = clientes.map(c => `<option value="${c.id}">${c.nome_fantasia}</option>`).join('');
    clienteSel.value = data.cliente_id;
    clienteSel.setAttribute('data-filled', 'true');

    const contatosResp = await fetch(`http://localhost:3000/api/clientes/${data.cliente_id}`);
    const clienteData = await contatosResp.json();
    const contatos = clienteData.contatos || [];
    contatoSel.innerHTML = contatos.map(ct => `<option value="${ct.id}">${ct.nome}</option>`).join('');
    contatoSel.value = data.contato_id;
    contatoSel.setAttribute('data-filled', 'true');

    const transpResp = await fetch(`http://localhost:3000/api/transportadoras/${data.cliente_id}`);
    const transportadoras = await transpResp.json();
    transportadoraSel.innerHTML = transportadoras.map(tp => `<option value="${tp.id}">${tp.nome}</option>`).join('');
    const tpOpt = Array.from(transportadoraSel.options).find(o => o.textContent === data.transportadora);
    if (tpOpt) {
      transportadoraSel.value = tpOpt.value;
      transportadoraSel.setAttribute('data-filled', 'true');
    }

    formaSel.value = data.forma_pagamento || '';
    if (formaSel.value) formaSel.setAttribute('data-filled', 'true');
    condicaoSel.value = data.parcelas > 1 ? 'prazo' : 'vista';
    condicaoSel.setAttribute('data-filled', 'true');
    validadeInput.value = data.validade ? data.validade.split('T')[0] : '';
    if (validadeInput.value) validadeInput.setAttribute('data-filled', 'true');
    obs.value = data.observacoes || '';
    if (obs.value) obs.setAttribute('data-filled', 'true');
    donoSel.innerHTML = `<option>${data.dono || ''}</option>`;
    donoSel.value = data.dono || '';
    donoSel.setAttribute('data-filled', 'true');

    const statusClasses = {
      'Rascunho': 'badge-info',
      'Pendente': 'badge-warning',
      'Aprovado': 'badge-success',
      'Rejeitado': 'badge-danger',
      'Expirado': 'badge-neutral'
    };
    const tag = document.getElementById('statusTag');
    tag.textContent = data.situacao;
    tag.className = `${statusClasses[data.situacao] || 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium`;
    const dataTag = document.getElementById('dataAprovacaoTag');
    if (['Aprovado', 'Rejeitado', 'Expirado'].includes(data.situacao) && data.data_aprovacao) {
      const dt = new Date(data.data_aprovacao);
      dataTag.textContent = dt.toLocaleDateString('pt-BR');
      dataTag.classList.remove('hidden');
    } else {
      dataTag.textContent = '';
      dataTag.classList.add('hidden');
    }

    let subtotal = 0, descPag = 0, descEsp = 0;
    data.itens.forEach(it => {
      const qtd = Number(it.quantidade) || 0;
      const valorUnit = Number(it.valor_unitario) || 0;
      const valorUnitDesc = Number(it.valor_unitario_desc) || 0;
      const descPagPrc = Number(it.desconto_pagamento_prc) || 0;
      const descEspPrc = Number(it.desconto_especial_prc) || 0;
      const valorTotal = Number(it.valor_total) || 0;
      const descPagUnit = Number(it.desconto_pagamento) || 0;
      const descEspUnit = Number(it.desconto_especial) || 0;

      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      tr.innerHTML = `
        <td class="px-6 py-4 text-sm text-white">${it.nome}</td>
        <td class="px-6 py-4 text-center text-sm text-white">${qtd}</td>
        <td class="px-6 py-4 text-right text-sm text-white">${valorUnit.toFixed(2)}</td>
        <td class="px-6 py-4 text-right text-sm text-white">${valorUnitDesc.toFixed(2)}</td>
        <td class="px-6 py-4 text-center text-sm text-white">${(descPagPrc + descEspPrc).toFixed(2)}</td>
        <td class="px-6 py-4 text-right text-sm text-white">${valorTotal.toFixed(2)}</td>
        <td class="px-6 py-4 text-center">
          <i class="fas fa-edit w-5 h-5 p-1 rounded icon-disabled" style="color: var(--color-primary)"></i>
          <i class="fas fa-trash w-5 h-5 p-1 rounded text-red-400 icon-disabled"></i>
        </td>`;
      itensTbody.appendChild(tr);
      subtotal += valorUnit * qtd;
      descPag += descPagUnit * qtd;
      descEsp += descEspUnit * qtd;
    });
    const desconto = descPag + descEsp;
    const total = subtotal - desconto;
    const fmt = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('subtotalOrcamento').textContent = fmt(subtotal);
    document.getElementById('descontoPagOrcamento').textContent = fmt(descPag);
    document.getElementById('descontoEspOrcamento').textContent = fmt(descEsp);
    document.getElementById('descontoOrcamento').textContent = fmt(desconto);
    document.getElementById('totalOrcamento').textContent = fmt(total);
    const footerTotal = document.getElementById('totalOrcamentoFooter');
    if (footerTotal) footerTotal.textContent = fmt(total);

    if (data.parcelas_detalhes && data.parcelas_detalhes.length) {
      const pgBox = document.getElementById('visualizarPagamento');
      pgBox.classList.remove('hidden');
      const dataEmissao = new Date(data.data_emissao);
      const rows = data.parcelas_detalhes.map(p => {
        const prazo = Math.ceil((new Date(p.data_vencimento) - dataEmissao) / 86400000);
        return `<tr class="border-b border-white/10"><td class="px-6 py-4 text-left text-sm text-white">${p.numero_parcela}ª</td><td class="px-6 py-4 text-left text-sm text-white">${fmt(p.valor)}</td><td class="px-6 py-4 text-left text-sm text-white">${prazo} dias</td></tr>`;
      }).join('');
      pgBox.innerHTML = `
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
    }

  } catch (err) {
    console.error('Erro ao carregar orçamento', err);
  }

  document.getElementById('clonarOrcamento').addEventListener('click', async () => {
    try {
      const resp = await fetch(`http://localhost:3000/api/orcamentos/${id}/clone`, { method: 'POST' });
      if (!resp.ok) throw new Error('Erro');
      const clone = await resp.json();
      if (window.reloadOrcamentos) await window.reloadOrcamentos();
      close();
      window.selectedQuoteId = clone.id;
      showToast(`ORÇAMENTO ${clone.numero} CLONADO, SALVO E ABERTO PARA EDIÇÃO`, 'info');
      Modal.open('modals/orcamentos/editar.html', '../js/modals/orcamento-editar.js', 'editarOrcamento');
    } catch (err) {
      console.error(err);
      showToast('Erro ao clonar orçamento', 'error');
    }
  });
  window.dispatchEvent(new CustomEvent('orcamentoModalLoaded', { detail: overlayId }));
})();

