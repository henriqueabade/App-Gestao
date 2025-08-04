// Detecta overflow em cada modulo-container e ativa scroll se necessario
function ajustarScroll() {
  document.querySelectorAll('.modulo-container').forEach((wrapper) => {
    wrapper.classList.remove('has-scroll');
    if (wrapper.scrollHeight > wrapper.clientHeight) {
      wrapper.classList.add('has-scroll');
    }
  });
}

// Executa em eventos que podem alterar a altura
window.addEventListener('DOMContentLoaded', ajustarScroll);
window.addEventListener('load', ajustarScroll);
window.addEventListener('resize', ajustarScroll);
document.addEventListener('module-change', ajustarScroll);

