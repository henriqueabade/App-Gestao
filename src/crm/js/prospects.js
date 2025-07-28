function initProspects() {
// Toggle Filter Panel
const filterPanel = document.getElementById('filterPanel');
const overlayBackdrop = document.getElementById('overlayBackdrop');
const toggleFiltersBtn = document.getElementById('toggleFilters');
const closeFiltersBtn = document.getElementById('closeFilters');
const applyFiltersBtn = document.getElementById('applyFilters');
const resetFiltersBtn = document.getElementById('resetFilters');

function handleEsc(event) {
  if (event.key === 'Escape') {
    closeFilters();
  }
}

function handleClickOutside(event) {
  if (filterPanel && !filterPanel.contains(event.target) && !toggleFiltersBtn.contains(event.target)) {
    closeFilters();
  }
}

function openFilters() {
  filterPanel.classList.remove('hidden');
  overlayBackdrop.classList.remove('hidden');
  toggleFiltersBtn.innerHTML = '<i class="fas fa-filter mr-2"></i>Fechar Filtros';
  document.addEventListener('keydown', handleEsc);
  document.addEventListener('click', handleClickOutside);
}

function closeFilters() {
  filterPanel.classList.add('hidden');
  overlayBackdrop.classList.add('hidden');
  toggleFiltersBtn.innerHTML = '<i class="fas fa-filter mr-2"></i>Filtros';
  document.removeEventListener('keydown', handleEsc);
  document.removeEventListener('click', handleClickOutside);
}

if (toggleFiltersBtn && filterPanel) {
  toggleFiltersBtn.addEventListener('click', () => {
    if (filterPanel.classList.contains('hidden')) {
      openFilters();
    } else {
      closeFilters();
    }
  });
}

if (closeFiltersBtn) {
  closeFiltersBtn.addEventListener('click', closeFilters);
}

if (overlayBackdrop) {
  overlayBackdrop.addEventListener('click', closeFilters);
}

if (applyFiltersBtn) {
  applyFiltersBtn.addEventListener('click', closeFilters);
}

if (resetFiltersBtn) {
  resetFiltersBtn.addEventListener('click', () => {
    filterPanel.querySelectorAll('input').forEach(i => (i.value = ''));
    filterPanel.querySelectorAll('select').forEach(s => (s.selectedIndex = 0));
  });
}

// Toggle Funnel Chart
const funnelSection = document.getElementById('funnelSection');
const toggleFunnelBtn = document.getElementById('toggleFunnel');
function updateFunnelLabel() {
  const hidden = funnelSection.classList.contains('hidden');
  toggleFunnelBtn.innerHTML = `<i class=\"fas fa-chart-funnel mr-2\"></i> ${hidden ? 'Mostrar Gráfico de Funil' : 'Ocultar Gráfico de Funil'}`;
}
if (toggleFunnelBtn && funnelSection) {
  updateFunnelLabel();
  toggleFunnelBtn.addEventListener('click', () => {
    funnelSection.classList.toggle('hidden');
    updateFunnelLabel();
  });
}

// Sortable columns
const sortableHeaders = document.querySelectorAll('th.sortable');
sortableHeaders.forEach(header => {
  header.addEventListener('click', () => {
    sortableHeaders.forEach(h => h.classList.remove('sorted'));
    header.classList.add('sorted');
    const icon = header.querySelector('.sort-icon i');
    const descending = icon.classList.contains('fa-sort-down');
    document.querySelectorAll('.sort-icon i').forEach(i => i.className = 'fas fa-sort');
    icon.className = descending ? 'fas fa-sort-up' : 'fas fa-sort-down';
  });
});

// Detail View Toggle
const prospectList = document.getElementById('prospectList');
const prospectDetail = document.getElementById('prospectDetail');
document.querySelectorAll('.view-prospect').forEach(btn => {
  btn.addEventListener('click', () => {
    if (prospectList && prospectDetail) {
      prospectList.classList.add('hidden');
      prospectDetail.classList.remove('hidden');
    }
  });
});

const backBtn = document.getElementById('backToProspects');
if (backBtn) {
  backBtn.addEventListener('click', () => {
    prospectDetail.classList.add('hidden');
    prospectList.classList.remove('hidden');
  });
}

// Tab Switching
const tabLinks = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');

tabLinks.forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    tabLinks.forEach(t => {
      t.classList.remove('border-[var(--color-primary)]', 'text-[var(--color-primary)]');
      t.classList.add('border-transparent', 'text-gray-500');
    });
    link.classList.add('border-[var(--color-primary)]', 'text-[var(--color-primary)]');
    link.classList.remove('border-transparent', 'text-gray-500');

    tabContents.forEach(c => c.classList.remove('active'));
    const target = document.getElementById(link.dataset.tab + '-tab');
    if (target) target.classList.add('active');
  });
});

// Toggle Related Sections
document.querySelectorAll('.toggle-section').forEach(header => {
  header.addEventListener('click', () => {
    header.closest('.section-card').classList.toggle('collapsed');
  });
});

if (window.feather) window.feather.replace();
}

window.initProspects = initProspects;
