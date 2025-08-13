(function(){
  const overlay = document.getElementById('detalhesProdutoOverlay');
  const close = () => Modal.close('detalhesProduto');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  const voltar = document.getElementById('voltarDetalhesProduto');
  if (voltar) voltar.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); } });

  const inserirBtn = document.getElementById('abrirInserirEstoque');
  if (inserirBtn) inserirBtn.addEventListener('click', () => {
    overlay.classList.add('pointer-events-none', 'blur-sm');
    Modal.open('modals/produtos/estoque-inserir.html', '../js/modals/produto-estoque-inserir.js', 'inserirEstoque', true);
  });

  const item = window.produtoDetalhes;
  if(item){
    const titulo = document.getElementById('detalheTitulo');
    if(titulo) titulo.textContent = `DETALHE DE ESTOQUE – ${item.nome || ''}`;
    const codigoEl = document.getElementById('codigoPeca');
    if(codigoEl) codigoEl.textContent = `Código da Peça: ${item.codigo || ''}`; // subtítulo mostra código da peça
    carregarDetalhes(item.codigo, item.id);
  }

  async function carregarDetalhes(codigo, id){
    try {
      // Ajuste: envia produtoCodigo (string) e produtoId (int)
      const { lotes: dados } = await window.electronAPI.listarDetalhesProduto({ produtoCodigo: codigo, produtoId: id });
      const tbody = document.getElementById('detalhesTableBody');
      if(!tbody) return;
      tbody.innerHTML = '';
      const preco = Number(item?.preco_venda || 0);
      let total = 0;
      let totalValor = 0;
      const valoresProcessos = [];
      dados.forEach(d => {
        const qtd = Number(d.quantidade || 0);
        total += qtd;
        const valorProc = qtd * preco;
        totalValor += valorProc;
        valoresProcessos.push({ etapa: d.etapa || '', valor: valorProc });
        const tr = document.createElement('tr');
        tr.className = 'border-b border-white/5 hover:bg-white/5 transition text-sm';
        tr.innerHTML = `
          <td class="py-4 px-4 text-gray-300 text-xs font-medium uppercase tracking-wider">${d.etapa || ''}</td>
          <td class="py-4 px-4 text-white font-medium text-sm">${d.ultimo_item || ''}</td>
          <td class="py-4 px-4 text-center text-white font-medium text-sm">${formatQuantity(qtd)}</td>
          <td class="py-4 px-4 text-gray-300 text-sm">${formatDateTime(d.data_hora_completa)}</td>
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
      if (totalEl) totalEl.textContent = formatQuantity(total);
      const lotesEl = document.getElementById('lotesAtivos');
      if (lotesEl) lotesEl.textContent = dados.length;
      const valorEl = document.getElementById('valorEstimado');
      if (valorEl) valorEl.textContent = formatCurrency(totalValor);
      const valoresEl = document.getElementById('processValues');
      if (valoresEl) {
        valoresEl.innerHTML = '';
        valoresProcessos.forEach(v => {
          const span = document.createElement('span');
          span.className = 'badge-navy px-3 py-1 rounded-full text-xs font-medium';
          span.textContent = `${v.etapa}: ${formatCurrency(v.valor)}`;
          valoresEl.appendChild(span);
        });
        const totalSpan = document.createElement('span');
        totalSpan.className = 'badge-success px-3 py-1 rounded-full text-xs font-medium';
        totalSpan.textContent = `Valor Total: ${formatCurrency(totalValor)}`;
        valoresEl.appendChild(totalSpan);
      }
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
        carregarDetalhes(item.codigo, item.id);
        carregarProdutos();
      } catch (err) {
        console.error(err);
        showToast('Erro ao atualizar quantidade', 'error');
      }
    });
    cancelBtn.addEventListener('click', () => carregarDetalhes(item.codigo, item.id));
  }

  function excluirLote(id) {
    window.loteExcluir = {
      id,
      reload: () => {
        carregarDetalhes(item.codigo, item.id);
        carregarProdutos();
      }
    };
    Modal.open('modals/produtos/excluir-lote.html', '../js/modals/produto-lote-excluir.js', 'excluirLote', true);
  }

  function formatQuantity(qtd){
    const num = Number(qtd);
    if(isNaN(num)) return '';
    if(Number.isInteger(num)) return num.toString();
    return (Math.ceil(num * 100) / 100).toFixed(2);
  }

  function formatCurrency(val){
    const rounded = Math.ceil(Number(val) * 100) / 100;
    return rounded.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatDateTime(value){
    if(!value) return '';
    return new Date(value).toLocaleString('pt-BR');
  }
})();
