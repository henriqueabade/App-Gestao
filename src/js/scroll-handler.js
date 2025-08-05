// quantos pixels rola cada clique de seta
const SCROLL_STEP = 40;

// cria/atualiza a scrollbar custom para o módulo atual
function syncScrollbar(module) {
  // remove barras antigas
  document.querySelectorAll('.scrollbar-container').forEach(el => el.remove());

  // só cria se precisar de scroll vertical
  if (module.scrollHeight <= module.clientHeight) return;

  // monta a barra
  const sb = document.createElement('div');
  sb.className = 'scrollbar-container';
  sb.innerHTML = `
    <div class="arrow up">▲</div>
    <div class="track"><div class="thumb"></div></div>
    <div class="arrow down">▼</div>
  `;
  document.body.appendChild(sb);

  const up    = sb.querySelector('.arrow.up');
  const down  = sb.querySelector('.arrow.down');
  const track = sb.querySelector('.track');
  const thumb = sb.querySelector('.thumb');

  // posiciona verticalmente junto ao módulo
  function positionBar() {
    const r = module.getBoundingClientRect();
    sb.style.top    = `${r.top}px`;
    sb.style.height = `${r.height}px`;
  }

  // ajusta tamanho e posição do thumb
  function updateThumb() {
    const ratio = module.clientHeight / module.scrollHeight;
    const h     = Math.max(track.clientHeight * ratio, 20);
    thumb.style.height = `${h}px`;
    const maxTop = track.clientHeight - h;
    thumb.style.top = `${(module.scrollTop / (module.scrollHeight - module.clientHeight)) * maxTop}px`;
  }

  // drag do thumb
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

  // setas clicáveis
  up.addEventListener('click',   () => module.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' }));
  down.addEventListener('click', () => module.scrollBy({ top:  SCROLL_STEP, behavior: 'smooth' }));

  // roda do mouse dentro do módulo
  module.addEventListener('wheel', e => {
    e.preventDefault();
    module.scrollTop += e.deltaY;
  }, { passive: false });

  // sincroniza ao scroll e resize
  module.addEventListener('scroll', updateThumb);
  window.addEventListener('resize', () => {
    positionBar();
    updateThumb();
  });

  // inicializa
  positionBar();
  updateThumb();
}

// inicializa na carga e em mudanças de módulo
function init() {
  const module = document.querySelector('.modulo-container');
  if (module) syncScrollbar(module);
  // observe mutações se módulos trocam dinamicamente...
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', init);
document.addEventListener('module-change', init);
