// js/scroll-handler.js

// Distância de scroll ao clicar nas setas
const SCROLL_STEP = 40;

// Referência à instância atual da scrollbar
let currentScrollbar = null;

// Remove a scrollbar custom atual (se houver)
function removeScrollbar() {
  if (currentScrollbar) {
    currentScrollbar.remove();
    currentScrollbar = null;
  }
}

// Cria a scrollbar custom para um determinado módulo
function createScrollbar(module) {
  removeScrollbar();  // garante que não haja duplicatas

  // Monta o container
  const sb = document.createElement('div');
  sb.className = 'scrollbar-container';
  sb.innerHTML = `
    <div class="arrow up">▲</div>
    <div class="track"><div class="thumb"></div></div>
    <div class="arrow down">▼</div>
  `;
  module.appendChild(sb);
  currentScrollbar = sb;

  const up    = sb.querySelector('.arrow.up');
  const down  = sb.querySelector('.arrow.down');
  const track = sb.querySelector('.track');
  const thumb = sb.querySelector('.thumb');

  // Posiciona verticalmente junto ao módulo
  function positionBar() {
    sb.style.height = `${module.clientHeight}px`;
  }

  // Atualiza thumb (tamanho e posição)
  function updateThumb() {
    const ratio = module.clientHeight / module.scrollHeight;
    const h     = Math.max(track.clientHeight * ratio, 20);
    thumb.style.height = `${h}px`;
    const maxTop = track.clientHeight - h;
    thumb.style.top = `${(module.scrollTop / (module.scrollHeight - module.clientHeight)) * maxTop}px`;
  }

  // Drag do thumb
  let dragging = false, startY = 0, startTop = 0;
  thumb.addEventListener('mousedown', e => {
    dragging = true;
    startY   = e.clientY;
    startTop = parseFloat(thumb.style.top) || 0;
    document.body.classList.add('no-select');
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const delta = e.clientY - startY;
    const maxTop = track.clientHeight - thumb.clientHeight;
    const newTop = Math.min(Math.max(startTop + delta, 0), maxTop);
    thumb.style.top = `${newTop}px`;
    module.scrollTop = (newTop / maxTop) * (module.scrollHeight - module.clientHeight);
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.classList.remove('no-select');
  });

  // Clique nas setas
  up.addEventListener('click',   () => module.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' }));
  down.addEventListener('click', () => module.scrollBy({ top:  SCROLL_STEP, behavior: 'smooth' }));

  // Sincroniza thumb ao scroll e resize
  module.addEventListener('scroll', updateThumb);
  window.addEventListener('resize', () => {
    positionBar();
    updateThumb();
  });

  // Primeira invocação
  positionBar();
  updateThumb();
}

// Encontra o primeiro módulo “visível” que necessite de scroll e cria/remova scrollbar
function refreshScrollbar() {
  // Remove barra antiga
  removeScrollbar();

  // Busca todos os módulos e tabelas com scroll
  const modules = Array.from(document.querySelectorAll('.modulo-container, .table-scroll'));
  // Filtra pelos que realmente estão visíveis e precisam de scroll
  const visible = modules.filter(m => {
    const rect = m.getBoundingClientRect();
    return rect.height > 0 && m.scrollHeight > m.clientHeight;
  });

  if (visible.length > 0) {
    createScrollbar(visible[0]);
  }
}

// Observa carregamento dinâmico de novos módulos
function observeModules() {
  const main = document.getElementById('mainContent');
  if (!main) return;
  new MutationObserver(muts => {
    muts.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1 && (
          node.matches('.modulo-container') ||
          node.querySelector('.modulo-container')
        )) {
          refreshScrollbar();
        }
      });
    });
  }).observe(main, { childList: true, subtree: true });
}

// Inicialização
window.addEventListener('DOMContentLoaded', () => {
  refreshScrollbar();
  observeModules();
});
window.addEventListener('load', refreshScrollbar);
window.addEventListener('resize', refreshScrollbar);
document.addEventListener('module-change', refreshScrollbar);
