(function() {
  function visibleRows(tbody) {
    return Array.from(tbody.querySelectorAll('tr')).filter(tr => {
      return tr.offsetParent !== null && !tr.classList.contains('hidden');
    });
  }

  function updateTableEmptyState(table) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const rows = visibleRows(tbody);
    let emptyRow = tbody.querySelector('.empty-state-row');
    if (rows.length === 0) {
      if (!emptyRow) {
        emptyRow = document.createElement('tr');
        emptyRow.className = 'empty-state-row';
        const td = document.createElement('td');
        td.colSpan = table.tHead ? table.tHead.rows[0].cells.length : 1;
        td.innerHTML = `
          <div class="py-12 flex flex-col items-center justify-center text-center text-white/70">
            <i class="fas fa-box-open text-[var(--color-primary)]" style="font-size:4rem;"></i>
            <p class="mt-2">Nenhum registro encontrado</p>
          </div>
        `;
        emptyRow.appendChild(td);
        tbody.appendChild(emptyRow);
      }
    } else if (emptyRow) {
      emptyRow.remove();
    }
  }

  function observeTable(table) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const observer = new MutationObserver(() => updateTableEmptyState(table));
    observer.observe(tbody, { childList: true });
    updateTableEmptyState(table);
  }

  function scan(node) {
    if (!node.querySelectorAll) return;
    node.querySelectorAll('table').forEach(table => {
      if (!table._emptyStateObserved) {
        table._emptyStateObserved = true;
        observeTable(table);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    scan(document);
    const bodyObserver = new MutationObserver(mutations => {
      mutations.forEach(m => m.addedNodes.forEach(scan));
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  });
})();
