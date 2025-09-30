/*
// js/scroll-handler.js

// Distância de scroll ao clicar nas setas
const SCROLL_STEP = 40;

// Referência à instância atual da scrollbar
let currentScrollbar = null;

// Mantém referência para um frame de validação pendente
let pendingRefreshFrame = null;

// Diferença mínima entre scrollHeight e clientHeight para considerar que há overflow
const MIN_SCROLL_DIFF = 8;
const OVERFLOW_STABLE_DELAY = 600;

let pendingStabilityTimeout = null;
let pendingStabilityCandidate = null;
let stabilityObserver = null;

function clearPendingStability() {
  if (pendingStabilityTimeout !== null) {
    clearTimeout(pendingStabilityTimeout);
    pendingStabilityTimeout = null;
  }
  if (stabilityObserver) {
    stabilityObserver.disconnect();
    stabilityObserver = null;
  }
  pendingStabilityCandidate = null;
}

function createOverflowStabilityMonitor(candidate, scheduleFinalization, useResizeObserver) {
  let resizeObserver = null;
  let rafId = null;
  let lastScrollHeight = candidate.scrollHeight;
  let lastClientWidth = candidate.clientWidth;
  let lastClientHeight = candidate.clientHeight;

  const updateMetricsIfChanged = () => {
    const currentScrollHeight = candidate.scrollHeight;
    const currentClientWidth = candidate.clientWidth;
    const currentClientHeight = candidate.clientHeight;

    if (
      currentScrollHeight !== lastScrollHeight ||
      currentClientWidth !== lastClientWidth ||
      currentClientHeight !== lastClientHeight
    ) {
      lastScrollHeight = currentScrollHeight;
      lastClientWidth = currentClientWidth;
      lastClientHeight = currentClientHeight;
      scheduleFinalization();
    }
  };

  const loop = () => {
    if (pendingStabilityCandidate !== candidate) {
      rafId = null;
      return;
    }

    if (!candidate.isConnected) {
      rafId = null;
      removeScrollbar();
      return;
    }

    updateMetricsIfChanged();
    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);

  if (useResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (pendingStabilityCandidate !== candidate || !candidate.isConnected) {
        return;
      }
      updateMetricsIfChanged();
    });
    resizeObserver.observe(candidate);
  }

  return {
    disconnect() {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
  };
}

// Remove a scrollbar custom atual (se houver)
function removeScrollbar() {
  clearPendingStability();
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
  document.body.appendChild(sb);
  currentScrollbar = sb;

  const up    = sb.querySelector('.arrow.up');
  const down  = sb.querySelector('.arrow.down');
  const track = sb.querySelector('.track');
  const thumb = sb.querySelector('.thumb');

  // Posiciona verticalmente junto ao módulo
  function positionBar() {
    const r = module.getBoundingClientRect();
    sb.style.top    = `${r.top}px`;
    sb.style.height = `${r.height}px`;
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
  if (pendingRefreshFrame !== null) {
    cancelAnimationFrame(pendingRefreshFrame);
    pendingRefreshFrame = null;
  }

  // Busca todos os módulos e tabelas com scroll
  const modules = Array.from(document.querySelectorAll('.modulo-container, .table-scroll'));
  // Filtra pelos que realmente estão visíveis e precisam de scroll
  const visible = modules.filter(m => {
    const rect = m.getBoundingClientRect();
    if (rect.height <= 0) return false;

    const diff = m.scrollHeight - m.clientHeight;
    return diff > MIN_SCROLL_DIFF;
  });

  if (visible.length === 0) {
    clearPendingStability();
    removeScrollbar();
    return;
  }

  const candidate = visible[0];

  pendingRefreshFrame = requestAnimationFrame(() => {
    pendingRefreshFrame = null;

    if (!candidate.isConnected) {
      removeScrollbar();
      clearPendingStability();
      return;
    }

    const diff = candidate.scrollHeight - candidate.clientHeight;
    if (diff <= MIN_SCROLL_DIFF) {
      removeScrollbar();
      clearPendingStability();
      return;
    }

    waitForStableOverflow(candidate);
  });
}

function waitForStableOverflow(candidate) {
  clearPendingStability();
  pendingStabilityCandidate = candidate;

  const finalize = () => {
    requestAnimationFrame(() => {
      const stableCandidate = pendingStabilityCandidate;
      if (!stableCandidate) {
        clearPendingStability();
        return;
      }

      if (!stableCandidate.isConnected) {
        removeScrollbar();
        clearPendingStability();
        return;
      }

      const stableDiff = stableCandidate.scrollHeight - stableCandidate.clientHeight;
      if (stableDiff > MIN_SCROLL_DIFF) {
        createScrollbar(stableCandidate);
      } else {
        removeScrollbar();
      }
      clearPendingStability();
    });
  };

  const scheduleFinalization = () => {
    if (pendingStabilityTimeout !== null) {
      clearTimeout(pendingStabilityTimeout);
    }
    pendingStabilityTimeout = setTimeout(finalize, OVERFLOW_STABLE_DELAY);
  };

  scheduleFinalization();

  const hasResizeObserver = typeof ResizeObserver !== 'undefined';
  stabilityObserver = createOverflowStabilityMonitor(
    candidate,
    scheduleFinalization,
    hasResizeObserver
  );
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
