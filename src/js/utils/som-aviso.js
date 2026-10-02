/**
 * O som dos avisos (01/10/2026, pedido do dono). Toca no sino quando chega
 * aviso com o programa na frente, e na janela do canto da tela quando ele está
 * atrás. Desliga em Configurações › Programa no Windows ("Som dos avisos").
 *
 *   - Com o arquivo do dono em src/assets (som-aviso.mp3, .wav ou .ogg — o
 *     main.js diz qual existe): toca o arquivo, no máximo 5 segundos.
 *   - Sem arquivo (ou se ele não tocar): o "tum-tum" gerado na hora (Web
 *     Audio) — duas batidas curtas e graves, a segunda um tom abaixo.
 *
 * window.SomAviso.tocar({ arquivo }) → true se começou a tocar.
 */
(function () {
  if (typeof window === 'undefined' || window.SomAviso) return;

  // [atraso (s), frequência (Hz)]: "tum" e "tum" um tom abaixo.
  const BATIDAS = [[0, 392], [0.2, 330]];
  const MAX_ARQUIVO_MS = 5000;
  // Só o nome do arquivo de src/assets (nada de caminho vindo de fora).
  const NOME_VALIDO = /^som-aviso\.(mp3|wav|ogg)$/;
  let contexto = null;

  function tumTum() {
    try {
      const Contexto = window.AudioContext || window.webkitAudioContext;
      if (!Contexto) return false;
      contexto = contexto || new Contexto();
      if (contexto.state === 'suspended' && typeof contexto.resume === 'function') contexto.resume();
      const inicio = contexto.currentTime + 0.02;
      for (const [atraso, frequencia] of BATIDAS) {
        const t = inicio + atraso;
        const oscilador = contexto.createOscillator();
        const volume = contexto.createGain();
        oscilador.type = 'sine';
        // O "corpo" da batida: a nota cai um pouco enquanto some.
        oscilador.frequency.setValueAtTime(frequencia, t);
        oscilador.frequency.exponentialRampToValueAtTime(frequencia * 0.62, t + 0.16);
        volume.gain.setValueAtTime(0.0001, t);
        volume.gain.exponentialRampToValueAtTime(0.32, t + 0.012);
        volume.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        oscilador.connect(volume);
        volume.connect(contexto.destination);
        oscilador.start(t);
        oscilador.stop(t + 0.2);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // As páginas que tocam (menu.html e aviso-windows.html) ficam em src/html.
  function arquivoDoDono(arquivo) {
    if (typeof Audio !== 'function' || !NOME_VALIDO.test(String(arquivo || ''))) return false;
    try {
      const audio = new Audio(`../assets/${arquivo}`);
      const parar = window.setTimeout?.(() => { try { audio.pause(); } catch (_) { /* segue */ } }, MAX_ARQUIVO_MS);
      const tocando = audio.play();
      // Arquivo estragado ou formato que não toca: vai o tum-tum.
      if (tocando && typeof tocando.catch === 'function') {
        tocando.catch(() => { window.clearTimeout?.(parar); tumTum(); });
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function tocar({ arquivo = null } = {}) {
    return arquivoDoDono(arquivo) || tumTum();
  }

  window.SomAviso = { tocar, BATIDAS, NOME_VALIDO, MAX_ARQUIVO_MS };
})();
