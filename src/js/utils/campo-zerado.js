/**
 * Zero que é FORMATO, não resposta.
 *
 * ---------------------------------------------------------------------------
 * O PROBLEMA
 *
 * Campo de valor nasce com `R$ 0,00`; campo de quantidade nasce com `0`. Nenhum
 * dos dois é algo que alguém digitou — é o formato mostrado antes de haver
 * resposta. Só que eles ficam no `value`, e o navegador não faz essa distinção:
 * para escrever, a pessoa tem de apagar primeiro.
 *
 * Quem não apagava terminava com `fgdgR$ 0,00` no campo, que é o que o valor
 * vira quando se digita na frente do formato. E quem apagava fazia isso em cada
 * uma das seis parcelas, em cada peça devolvida, em cada percentual da ficha.
 *
 * ---------------------------------------------------------------------------
 * O QUE ISTO FAZ, E O QUE NÃO FAZ
 *
 * Ao FOCAR, o campo esvazia — mas só se o que estiver lá for o zero de formato.
 * Um valor que a pessoa já escreveu fica: ela clicou para corrigir, não para
 * recomeçar.
 *
 * Ao SAIR sem escrever nada, o zero volta. Isso não é enfeite: o zero costuma
 * ir para o banco, e um campo que ficasse vazio mandaria `null` onde o registro
 * espera `0` — ou seria recusado por um `required` que nada na tela explica.
 *
 * `placeholder` não resolveria: ele só aparece com o campo VAZIO, e aí o valor
 * enviado seria vazio. O que se quer é o zero indo para o banco sem estar no
 * caminho de quem digita.
 */
(function (global) {
  'use strict';

  /** `0`, `0,00`, `0.0000`, `R$ 0,00` — com ou sem espaços. */
  const ZERO_DE_FORMATO = /^\s*(?:R\$\s*)?0(?:[.,]0+)?\s*$/;

  const ehZeroDeFormato = valor => ZERO_DE_FORMATO.test(String(valor ?? ''));

  /**
   * @param {HTMLInputElement} input
   * @param {object} [opcoes]
   * @param {(valor: string) => boolean} [opcoes.ehPadrao] o que conta como
   *        "ainda não respondido". O padrão reconhece as formas de zero acima.
   * @param {(input: HTMLInputElement) => void} [opcoes.repor] como devolver o
   *        formato quando a pessoa sai sem escrever. O padrão repõe o texto
   *        exato que estava lá.
   */
  function ligar(input, opcoes = {}) {
    // Duas ligações no mesmo campo esvaziariam e reporiam duas vezes, e a
    // segunda leria o estado que a primeira acabou de mudar.
    if (!input || input.dataset.zeroVisual === 'true') return;
    input.dataset.zeroVisual = 'true';

    const ehPadrao = opcoes.ehPadrao || ehZeroDeFormato;
    const repor = opcoes.repor
      || (el => { el.value = el.dataset.zeroDeFormato ?? ''; });

    input.addEventListener('focus', () => {
      if (!ehPadrao(input.value)) return;
      // Guardado para poder voltar: o formato do zero varia de campo para
      // campo ("0", "0,0000", "R$ 0,00") e recriá-lo aqui seria adivinhar.
      input.dataset.zeroDeFormato = input.value;
      input.value = '';
    });

    input.addEventListener('blur', () => {
      const escreveu = String(input.value).trim() !== '';
      if (!escreveu && 'zeroDeFormato' in input.dataset) repor(input);
      delete input.dataset.zeroDeFormato;
    });
  }

  /** Liga em tudo o que casar com `seletor` dentro de `raiz`. */
  function ligarTodos(raiz, seletor, opcoes) {
    for (const input of (raiz || document).querySelectorAll(seletor)) {
      ligar(input, opcoes);
    }
  }

  global.CampoZerado = { ligar, ligarTodos, ehZeroDeFormato };
})(window);
