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
      dados.forEach(d => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-white/5 hover:bg-white/5 transition';
        tr.innerHTML = `
          <td class="py-4 px-4 text-gray-300">${d.etapa_nome || ''}</td>
          <td class="py-4 px-4 text-white font-medium">${d.ultimo_item || ''}</td>
          <td class="py-4 px-4 text-center text-white font-medium">${d.quantidade ?? ''}</td>
          <td class="py-4 px-4 text-gray-300">${formatDateTime(d.data_hora_completa)}</td>
          <td class="py-4 px-4 text-center">
            <div class="flex justify-center gap-2">
              <button class="icon-only bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition">✎</button>
              <button class="icon-only bg-red-600/20 text-red-400 hover:bg-red-600/30 transition">🗑</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch(err) {
      console.error('Erro ao carregar detalhes do produto', err);
    }
  }

  function formatDateTime(value){
    if(!value) return '';
    return new Date(value).toLocaleString('pt-BR');
  }
})();
