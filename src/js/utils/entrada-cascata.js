/**
 * Entrada em cascata dos módulos (06/10/2026, pedido do dono: "o mesmo efeito
 * do Financeiro e da Contabilidade nos outros módulos").
 *
 * A animação é a de sempre (`animate-fade-in-up` + `fadeInUp`): cada bloco
 * sobe e aparece, um depois do outro. O que faltava nos outros módulos:
 *
 *  1. o JavaScript de cada um punha opacity 1 nos blocos durante a carga, e o
 *     `fadeInUp` (que só tem o `to`) partia de 1 — a animação existia, mas não
 *     se via. Esse trecho saiu dos módulos;
 *  2. o atraso de cada bloco vinha da POSIÇÃO entre os irmãos (nth-child 1–4):
 *     um aviso escondido antes da tabela empurrava o atraso, e o 5º irmão
 *     ficava sem atraso nenhum — em Prospecções e na IA a tabela subia ANTES
 *     dos filtros. `ordenar` dá o atraso pela ORDEM: 0,2 s, 0,3 s, 0,4 s…;
 *  3. sem o JavaScript antigo, um bloco que some e volta (lista vazia ao
 *     filtrar, depois com resultado) refaria a subida a cada vez. `concluir`
 *     deixa o bloco parado depois da entrada (`.entrada-feita`, menu.css).
 *
 * Financeiro, Contabilidade e Dashboard já têm a cascata deles e ficam como
 * estão; Relatórios distribui os próprios atrasos.
 */
(() => {
  if (window.EntradaCascata) return;

  const COM_CASCATA_PROPRIA = new Set(['financeiro', 'contabilidade', 'dashboard', 'relatorios']);
  const PRIMEIRO_ATRASO_S = 0.2;
  const PASSO_S = 0.1;
  const ULTIMO_ATRASO_S = 0.6;
  /** Maior atraso (0,6 s) + a subida (0,6 s), com folga. */
  const FIM_DA_ENTRADA_MS = 1600;

  const blocosDe = modulo => Array.from(modulo?.querySelectorAll?.('.animate-fade-in-up') || []);

  /** O atraso de cada bloco pela ordem em que aparece (o cabeçalho fica de fora: ele não anima). */
  function ordenar(modulo, pagina) {
    if (!modulo || COM_CASCATA_PROPRIA.has(pagina)) return [];
    const blocos = blocosDe(modulo).filter(b => !b.classList.contains('module-introduction-row'));
    blocos.forEach((bloco, i) => {
      const atraso = Math.min(ULTIMO_ATRASO_S, PRIMEIRO_ATRASO_S + PASSO_S * i);
      bloco.style.animationDelay = `${atraso.toFixed(1)}s`;
    });
    return blocos;
  }

  /**
   * Depois da entrada, os blocos ficam parados: mostrar de novo não refaz a
   * subida. Os módulos com cascata própria ficam como sempre foram — o
   * Dashboard, por exemplo, monta o painel depois de aparecer, e a subida dele
   * acontece nessa hora.
   */
  function concluir(modulo, pagina, esperaMs = FIM_DA_ENTRADA_MS) {
    if (!modulo || COM_CASCATA_PROPRIA.has(pagina)) return null;
    return setTimeout(() => {
      blocosDe(modulo).forEach(bloco => bloco.classList.add('entrada-feita'));
    }, esperaMs);
  }

  window.EntradaCascata = { ordenar, concluir, COM_CASCATA_PROPRIA, FIM_DA_ENTRADA_MS };
})();
