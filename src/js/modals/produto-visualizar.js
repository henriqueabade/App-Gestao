(function () {
  function init() {
    const overlay = document.getElementById('visualizarProdutoOverlay');
    if (!overlay) return;

    const selected = window.produtoVisualizar;

    // Sem devolver `window.produtoVisualizar`, o modal reabre em branco
    // (ver docs/restauracao-de-trabalho.md). A tela é só leitura.
    window.EstadoTrabalho?.registrarContexto?.('visualizarProduto',
      () => ({ produtoVisualizar: selected }));
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

    function currency(value) {
      return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    // Quantidades aceitam até 4 casas decimais (ver src/utils/numericInput.js).
    function number(value) {
      const parsed = Number(value) || 0;
      return parsed.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
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
      renderTotalBadges();
    }
    function groupItemsByProcess() {
      return itens.reduce((groups, item) => {
        const process = String(item.processo || '—').trim() || '—';
        let group = groups.find(entry => entry.process === process);
        if (!group) {
          group = { process, items: [], total: 0 };
          groups.push(group);
        }
        group.items.push(item);
        group.total += (Number(item.quantidade) || 0) * (Number(item.preco_unitario) || 0);
        return groups;
      }, []);
    }
    function renderTotalBadges() {
      const container = byId('totalInsumosTitulo');
      if (!container) return;
      const processBadges = groupItemsByProcess().map(group =>
        `<span class="badge-process px-3 py-1 rounded-full text-xs font-medium">${safe(group.process)}: ${currency(group.total)}</span>`
      );
      processBadges.push(`<span class="badge-success px-3 py-1 rounded-full text-xs font-medium">Valor Total: ${currency(somas.totalInsumos)}</span>`);
      container.innerHTML = processBadges.join(' ');
    }
    function renderItems() {
      if (!tbody) return;
      if (!itens.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-left text-gray-400">Nenhum item encontrado</td></tr>';
        return;
      }
      tbody.innerHTML = groupItemsByProcess().map(group => `
      <tr class="process-row">
        <td colspan="5" class="px-6 py-2 bg-gray-50 border-t border-gray-200 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">${safe(group.process)}</td>
      </tr>
      ${group.items.map(item => `<tr class="border-b border-white/5">
        <td class="px-6 py-3 text-white">${safe(item.nome)}</td>
        <td class="px-6 py-3 text-left">${number(item.quantidade)}</td>
        <td class="px-6 py-3 text-left">${safe(item.unidade)}</td>
        <td class="px-6 py-3 text-left text-white">${currency(item.preco_unitario)}</td>
        <td class="px-6 py-3 text-left text-white">${currency((Number(item.quantidade) || 0) * (Number(item.preco_unitario) || 0))}</td>
      </tr>`).join('')}`).join('');
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
        const processGroups = groupItemsByProcess();
        y += 10; addPageIfNeeded(50); doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.text('ITENS', margin, y); y += 18;
        doc.setFontSize(8);
        let badgeX = margin;
        [...processGroups, { process: 'Valor Total', total: somas.totalInsumos, isTotal: true }].forEach(group => {
          const label = `${group.process}: ${currency(group.total)}`;
          const badgeWidth = Math.min(doc.getTextWidth(label) + 14, width);
          if (badgeX > margin && badgeX + badgeWidth > margin + width) {
            badgeX = margin;
            y += 22;
          }
          if (y + 12 > bottom) { doc.addPage('a4', 'portrait'); y = 45; badgeX = margin; }
          doc.setFillColor(...(group.isTotal ? [220, 242, 224] : [225, 235, 244]));
          doc.roundedRect(badgeX, y - 10, badgeWidth, 16, 7, 7, 'F');
          doc.setTextColor(...(group.isTotal ? [25, 110, 55] : [30, 83, 120]));
          doc.setFont('helvetica', 'bold'); doc.text(label, badgeX + 7, y);
          badgeX += badgeWidth + 6;
        });
        y += 22;
        doc.setTextColor(0, 0, 0);
        const cols = [margin, 245, 320, 375, 455];
        const header = ['Item','Qtd.','Un.','Unitário','Total'];
        const drawHeader = fontSize => { doc.setFillColor(235,235,235); doc.rect(margin, y - 12, width, 20, 'F'); doc.setFontSize(fontSize); doc.setFont('helvetica','bold'); header.forEach((text,index) => doc.text(text, cols[index], y)); y += 14; };
        processGroups.forEach(group => {
          const availableOnPage = bottom - y;
          const regularHeight = 38 + group.items.length * 16;
          // O cabeçalho e todos os itens formam um bloco indivisível. Só inicia
          // outra página quando o processo realmente não cabe no espaço restante.
          if (regularHeight > availableOnPage) { doc.addPage('a4','portrait'); y = 45; }
          const availableHeight = bottom - y - 36;
          const rowHeight = Math.min(16, Math.max(7, availableHeight / Math.max(group.items.length, 1)));
          const fontSize = Math.min(8, Math.max(5, rowHeight - 2));
          doc.setFillColor(215, 222, 229); doc.rect(margin, y - 12, width, 20, 'F');
          doc.setTextColor(55, 65, 81); doc.setFontSize(9); doc.setFont('helvetica','bold');
          doc.text(String(group.process).toUpperCase(), margin + width / 2, y, { align: 'center' }); y += 14;
          drawHeader(fontSize); doc.setTextColor(0, 0, 0); doc.setFont('helvetica','normal'); doc.setFontSize(fontSize);
          group.items.forEach(item => {
            const name = doc.splitTextToSize(String(item.nome || '—'), 185)[0];
            [name, number(item.quantidade), item.unidade || '—', currency(item.preco_unitario), currency((Number(item.quantidade)||0)*(Number(item.preco_unitario)||0))].forEach((text,index) => doc.text(String(text), cols[index], y));
            y += rowHeight;
          });
        });
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
