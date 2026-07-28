(function () {
  function init() {
    const overlay = document.getElementById('visualizarProdutoOverlay');
    if (!overlay) return;

    const selected = window.produtoVisualizar;
    const byId = id => document.getElementById(id);
    const fields = {
      nome: byId('nomeInput'), codigo: byId('codigoInput'), ncm: byId('ncmInput'),
      categoria: byId('colecaoInput'), status: byId('statusProduto'),
      fabricacao: byId('fabricacaoInput'), acabamento: byId('acabamentoInput'),
      montagem: byId('montagemInput'), embalagem: byId('embalagemInput'),
      markup: byId('markupInput'), comissao: byId('commissionInput'), imposto: byId('taxInput')
    };
    const tbody = overlay.querySelector('#itensTabela tbody');
    let produto = null;
    let itens = [];
    let somas = {};

    const close = () => Modal.close('visualizarProduto');
    byId('voltarVisualizarProduto')?.addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });

    function currency(value) {
      return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    function number(value) {
      const parsed = Number(value) || 0;
      return parsed.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    }
    function safe(value) {
      const node = document.createElement('span');
      node.textContent = value == null || value === '' ? '—' : String(value);
      return node.innerHTML;
    }
    function calculate() {
      const totalInsumos = itens.reduce((sum, item) => sum + (Number(item.quantidade) || 0) * (Number(item.preco_unitario) || 0), 0);
      const laborPct = ['fabricacao', 'acabamento', 'montagem', 'embalagem'].reduce((sum, key) => sum + (Number(fields[key]?.value) || 0), 0);
      const totalMaoObra = totalInsumos * laborPct / 100;
      const subTotal = totalInsumos + totalMaoObra;
      const markupValor = totalInsumos * (Number(fields.markup?.value) || 0) / 100;
      const custoTotal = subTotal + markupValor;
      const commissionPct = Number(fields.comissao?.value) || 0;
      const taxPct = Number(fields.imposto?.value) || 0;
      const denominator = 1 - (commissionPct + taxPct) / 100;
      const comissaoValor = denominator ? commissionPct / 100 * (custoTotal / denominator) : 0;
      const impostoValor = denominator ? taxPct / 100 * (custoTotal / denominator) : 0;
      const valorVenda = custoTotal + comissaoValor + impostoValor;
      somas = { totalInsumos, totalMaoObra, subTotal, markupValor, custoTotal, comissaoValor, impostoValor, valorVenda };
      const ids = { totalInsumos: 'totalInsumos', totalMaoObra: 'totalMaoObra', subTotal: 'subTotal', markupValor: 'markupValor', custoTotal: 'custoTotal', comissaoValor: 'comissaoValor', impostoValor: 'impostoValor', valorVenda: 'valorVenda' };
      Object.entries(ids).forEach(([key, id]) => { if (byId(id)) byId(id).textContent = currency(somas[key]); });
    }
    function renderItems() {
      if (!tbody) return;
      if (!itens.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-left text-gray-400">Nenhum item encontrado</td></tr>';
        return;
      }
      tbody.innerHTML = itens.map(item => `<tr class="border-b border-white/5">
        <td class="px-6 py-3 text-white">${safe(item.nome)}</td>
        <td class="px-6 py-3 text-left">${number(item.quantidade)}</td>
        <td class="px-6 py-3 text-left">${safe(item.unidade)}</td>
        <td class="px-6 py-3 text-left text-white">${currency(item.preco_unitario)}</td>
        <td class="px-6 py-3 text-left text-white">${currency((Number(item.quantidade) || 0) * (Number(item.preco_unitario) || 0))}</td>
      </tr>`).join('');
    }
    function populate(data) {
      produto = data;
      fields.nome.value = data.nome || '';
      fields.codigo.value = data.codigo || '';
      fields.ncm.value = data.ncm == null ? '' : data.ncm;
      fields.categoria.value = data.categoria || '';
      fields.status.textContent = data.status || '—';
      const percentages = { fabricacao: 'pct_fabricacao', acabamento: 'pct_acabamento', montagem: 'pct_montagem', embalagem: 'pct_embalagem', markup: 'pct_markup', comissao: 'pct_comissao', imposto: 'pct_imposto' };
      Object.entries(percentages).forEach(([field, prop]) => { fields[field].value = data[prop] ?? 0; });
      const salePrice = currency(data.preco_venda);
      byId('precoVenda').textContent = salePrice;
      byId('precoVendaTag').textContent = salePrice;
      const modified = data.data || data.ultima_modificacao || data.updated_at;
      if (modified) {
        const date = new Date(modified);
        byId('ultimaModificacaoData').textContent = date.toLocaleDateString('pt-BR');
        byId('ultimaModificacaoHora').textContent = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      }
    }
    function loadJsPdf() {
      if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '../js/vendor/jspdf.umd.min.js';
        script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('Biblioteca PDF indisponível'));
        script.onerror = () => reject(new Error('Não foi possível carregar a biblioteca PDF'));
        document.head.appendChild(script);
      });
    }
    async function generatePdf() {
      const button = byId('gerarPdfProduto');
      try {
        button.disabled = true;
        button.textContent = 'Gerando...';
        const JsPDF = await loadJsPdf();
        const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
        const margin = 42, width = 511, bottom = 800;
        let y = 45;
        const addPageIfNeeded = height => { if (y + height > bottom) { doc.addPage('a4', 'portrait'); y = 45; } };
        const line = (label, value, bold = false) => { addPageIfNeeded(18); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.text(`${label}: ${value}`, margin, y); y += 18; };
        doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Ficha de Cadastro do Produto', margin, y); y += 28;
        doc.setFontSize(10); line('Nome', produto.nome || '—'); line('Código', produto.codigo || '—'); line('NCM', produto.ncm || '—'); line('Coleção', produto.categoria || '—'); line('Status', produto.status || '—'); line('Preço de venda cadastrado', currency(produto.preco_venda), true);
        y += 8; doc.setFontSize(13); line('PERCENTAGENS', '', true); doc.setFontSize(10);
        [['Marcenaria','fabricacao'],['Acabamento','acabamento'],['Montagem','montagem'],['Embalagem','embalagem'],['Markup','markup'],['Comissão','comissao'],['Imposto','imposto']].forEach(([label,key]) => line(label, `${number(fields[key].value)}%`));
        y += 8; doc.setFontSize(13); line('SOMAS E VALORES', '', true); doc.setFontSize(10);
        [['Total insumos','totalInsumos'],['Total mão-de-obra','totalMaoObra'],['Subtotal','subTotal'],['Markup','markupValor'],['Custo total','custoTotal'],['Comissão','comissaoValor'],['Imposto','impostoValor'],['Valor de venda da peça','valorVenda']].forEach(([label,key]) => line(label, currency(somas[key]), key === 'valorVenda'));
        y += 10; addPageIfNeeded(50); doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.text('ITENS', margin, y); y += 18;
        const cols = [margin, 245, 320, 375, 455];
        const header = ['Item','Qtd.','Un.','Unitário','Total'];
        const drawHeader = () => { doc.setFillColor(235,235,235); doc.rect(margin, y - 12, width, 20, 'F'); doc.setFontSize(8); doc.setFont('helvetica','bold'); header.forEach((text,index) => doc.text(text, cols[index], y)); y += 14; };
        drawHeader(); doc.setFont('helvetica','normal');
        itens.forEach(item => { if (y + 20 > bottom) { doc.addPage('a4','portrait'); y = 45; drawHeader(); } const name = doc.splitTextToSize(String(item.nome || '—'), 185)[0]; [name, number(item.quantidade), item.unidade || '—', currency(item.preco_unitario), currency((Number(item.quantidade)||0)*(Number(item.preco_unitario)||0))].forEach((text,index) => doc.text(String(text), cols[index], y)); y += 16; });
        const filename = `produto-${String(produto.codigo || produto.id).replace(/[^a-z0-9_-]/gi, '_')}.pdf`;
        doc.save(filename);
        if (typeof showToast === 'function') showToast('PDF gerado com sucesso', 'success');
      } catch (error) {
        console.error('Erro ao gerar PDF do produto', error);
        if (typeof showToast === 'function') showToast('Erro ao gerar PDF', 'error');
      } finally { button.disabled = false; button.textContent = 'Gerar PDF'; }
    }
    byId('gerarPdfProduto')?.addEventListener('click', generatePdf);

    (async () => {
      try {
        if (!selected?.id) throw new Error('Produto inválido ou sem ID');
        const result = await window.electronAPI.listarDetalhesProduto({ produtoId: selected.id });
        populate(result.produto || selected);
        itens = Array.isArray(result.itens) ? result.itens : [];
        renderItems(); calculate();
      } catch (error) {
        console.error('Erro ao visualizar produto', error);
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-red-400">${safe(error.message || 'Erro ao carregar dados')}</td></tr>`;
      } finally { window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'visualizarProduto' })); }
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
