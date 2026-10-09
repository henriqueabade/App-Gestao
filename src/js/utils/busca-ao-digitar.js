/**
 * Busca enquanto digita (pedido do dono, 08/10/2026): toda caixa de texto de
 * filtro filtra a cada tecla, sem precisar clicar em "Filtrar". O "Filtrar"
 * continua onde está, para quem prefere; o Enter aplica na hora.
 *
 *   window.BuscaAoDigitar.ligar(campo, aplicar, { espera })
 *
 * `aplicar` roda depois de uma pausa curta na digitação (`espera`, 150 ms):
 * numa lista grande, refazer a grade a cada letra de "jackie" seriam seis
 * desenhos seguidos para mostrar um resultado só. Enter e o "x" do campo de
 * busca não esperam. Ligar duas vezes o mesmo campo não duplica nada.
 */
(() => {
  if (window.BuscaAoDigitar) return;

  function ligar(campo, aplicar, { espera = 150 } = {}) {
    if (!campo || typeof aplicar !== 'function') return campo || null;
    if (campo.dataset.buscaAoDigitar === '1') return campo;
    campo.dataset.buscaAoDigitar = '1';
    let relogio = null;
    const agora = () => {
      clearTimeout(relogio);
      relogio = null;
      aplicar();
    };
    campo.addEventListener('input', () => {
      clearTimeout(relogio);
      relogio = setTimeout(agora, espera);
    });
    campo.addEventListener('keydown', evento => {
      if (evento.key !== 'Enter') return;
      evento.preventDefault();
      agora();
    });
    // O "x" do <input type="search"> limpa sem disparar tecla.
    campo.addEventListener('search', agora);
    return campo;
  }

  /**
   * Os termos de uma busca: sem acento, sem caixa, separados por espaço. Uma
   * linha "casa" quando TODOS os termos aparecem em algum dos textos dela —
   * "jackie pietra" acha o pedido da Jackie que tem a peça Pietra.
   */
  const normalizar = valor => String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
  const termos = busca => normalizar(busca).split(/\s+/).filter(Boolean);
  function casa(listaDeTermos, ...textos) {
    if (!listaDeTermos.length) return true;
    const alvo = normalizar(textos.flat(Infinity).filter(t => t !== null && t !== undefined).join(' '));
    return listaDeTermos.every(t => alvo.includes(t));
  }

  window.BuscaAoDigitar = { ligar, normalizar, termos, casa };
})();
