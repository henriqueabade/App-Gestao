(function(){
  const overlay = document.getElementById('detalhesProdutoOverlay');
  const close = () => Modal.close('detalhesProduto');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('fecharDetalhesProduto').addEventListener('click', close);
  const voltar = document.getElementById('voltarDetalhesProduto');
  if (voltar) voltar.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });

  const item = window.produtoDetalhes;
  if(item){
    const titulo = document.getElementById('detalheTitulo');
    if(titulo) titulo.textContent = `DETALHE DE ESTOQUE – ${item.nome || ''}`;
    carregarDetalhes(item.id);
  }

  async function carregarDetalhes(id){
    try {
      const dados = await window.electronAPI.listarDetalhesProduto(id);
      const tbody = document.getElementById('detalhesTableBody');
      if(!tbody) return;
      tbody.innerHTML = '';
      let total = 0;
      dados.forEach(d => {
        total += Number(d.quantidade || 0);
        const tr = document.createElement('tr');
        tr.className = 'border-b border-white/5 hover:bg-white/5 transition';
        tr.innerHTML = `
          <td class="py-4 px-4 text-gray-300">${d.etapa_nome || ''}</td>
          <td class="py-4 px-4 text-white font-medium">${d.ultimo_item || ''}</td>
          <td class="py-4 px-4 text-center text-white font-medium">${d.quantidade ?? ''}</td>
          <td class="py-4 px-4 text-gray-300">${formatDateTime(d.data_hora_completa)}</td>
          <td class="py-4 px-4 text-center">
            <div class="flex items-center justify-center space-x-2">
              <i class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
              <i class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Excluir"></i>
            </div>
          </td>
        `;
        const editBtn = tr.querySelector('.fa-edit');
        const delBtn = tr.querySelector('.fa-trash');
        if (editBtn) editBtn.addEventListener('click', () => editarLinha(tr, d));
        if (delBtn) delBtn.addEventListener('click', () => excluirLote(d.id));
        tbody.appendChild(tr);
      });
      const totalEl = document.getElementById('totalEstoque');
      if (totalEl) totalEl.textContent = total;
      const lotesEl = document.getElementById('lotesAtivos');
      if (lotesEl) lotesEl.textContent = dados.length;
      const valorEl = document.getElementById('valorEstimado');
      const preco = Number(item?.preco_venda || 0);
      if (valorEl) valorEl.textContent = (total * preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch(err) {
      console.error('Erro ao carregar detalhes do produto', err);
    }
  }

  function editarLinha(tr, dados) {
    const qtdCell = tr.children[2];
    const actionsCell = tr.children[4];
    const original = dados.quantidade;
    qtdCell.innerHTML = `<input type="number" class="w-20 bg-transparent border-b border-white/20 text-center text-white focus:outline-none" value="${original}">`;
    actionsCell.innerHTML = `
      <div class="flex items-center justify-center space-x-2">
        <i class="fas fa-check w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-green)" title="Confirmar"></i>
        <i class="fas fa-times w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Cancelar"></i>
      </div>`;
    const input = qtdCell.querySelector('input');
    const [confirmBtn, cancelBtn] = actionsCell.querySelectorAll('i');
    confirmBtn.addEventListener('click', async () => {
      const novaQtd = Number(input.value);
      try {
        await window.electronAPI.atualizarLoteProduto({ id: dados.id, quantidade: novaQtd });
        showToast('Quantidade atualizada', 'success');
        carregarDetalhes(item.id);
        carregarProdutos();
      } catch (err) {
        console.error(err);
        showToast('Erro ao atualizar quantidade', 'error');
      }
    });
    cancelBtn.addEventListener('click', () => carregarDetalhes(item.id));
  }

  function excluirLote(id) {
    window.loteExcluir = {
      id,
      reload: () => {
        carregarDetalhes(item.id);
        carregarProdutos();
      }
    };
    Modal.open('modals/produtos/excluir-lote.html', '../js/modals/produto-lote-excluir.js', 'excluirLote', true);
  }

  function formatDateTime(value){
    if(!value) return '';
    return new Date(value).toLocaleString('pt-BR');
  }
})();
