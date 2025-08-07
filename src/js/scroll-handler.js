// js/scroll-handler.js

// Distância de scroll ao clicar nas setas
const SCROLL_STEP = 40;

// Conjunto das barras de rolagem ativas
let currentScrollbars = [];

// Remove todas as barras atuais
function removeScrollbars() {
  currentScrollbars.forEach(sb => sb.remove());
  currentScrollbars = [];
}

// Cria a scrollbar custom para um determinado módulo
function createScrollbar(module) {
  const sb = document.createElement('div');
  sb.className = 'scrollbar-container';
  sb.innerHTML = `
    <div class="arrow up">▲</div>
    <div class="track"><div class="thumb"></div></div>
    <div class="arrow down">▼</div>
  `;
  module.appendChild(sb);
  currentScrollbars.push(sb);

  const up    = sb.querySelector('.arrow.up');
  const down  = sb.querySelector('.arrow.down');
  const track = sb.querySelector('.track');
  const thumb = sb.querySelector('.thumb');

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
  window.addEventListener('resize', updateThumb);

  // Primeira invocação
  updateThumb();
}

// Cria barras de rolagem para todos os módulos/tabelas visíveis que precisem de scroll
function refreshScrollbars() {
  removeScrollbars();

  const modules = Array.from(document.querySelectorAll('.modulo-container, .table-scroll'));

  modules.forEach(module => {
    const rect = module.getBoundingClientRect();
    if (rect.height > 0 && module.scrollHeight > module.clientHeight) {
      createScrollbar(module);
    }
  });
}

// Observa carregamento dinâmico de novos módulos
function observeModules() {
  const main = document.getElementById('mainContent');
  if (!main) return;
  new MutationObserver(muts => {
    muts.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1 && (
          node.matches('.modulo-container, .table-scroll') ||
          node.querySelector('.modulo-container, .table-scroll')
        )) {
          refreshScrollbars();
        }
      });
    });
  }).observe(main, { childList: true, subtree: true });
}

// Inicialização
window.addEventListener('DOMContentLoaded', () => {
  refreshScrollbars();
  observeModules();
});
window.addEventListener('load', refreshScrollbars);
window.addEventListener('resize', refreshScrollbars);
document.addEventListener('module-change', refreshScrollbars);
