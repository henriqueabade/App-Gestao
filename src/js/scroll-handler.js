// Detecta overflow em cada modulo-container e ativa scroll se necessario
function ajustarScroll() {
  document.querySelectorAll('.modulo-container').forEach((wrapper) => {
    wrapper.classList.remove('has-scroll');
    if (wrapper.scrollHeight > wrapper.clientHeight) {
      wrapper.classList.add('has-scroll');
    }
  });
}

// Executa ao carregar a pagina e quando modulos sao trocados
window.addEventListener('DOMContentLoaded', ajustarScroll);
document.addEventListener('module-change', ajustarScroll);

