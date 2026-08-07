/**
 * A pergunta que toda mexida à mão no estoque de peças precisa fazer.
 *
 * Colocar uma peça no estoque é afirmar que ela existe; se existe, alguém a
 * produziu, e produzir consome insumo. Tirar uma peça é o contrário. Mas nem
 * toda entrada é produção — pode ser correção de inventário, devolução de
 * cliente ou peça comprada pronta —, então isto não pode ser automático: é
 * decisão de quem registra, tomada na hora.
 *
 * A pergunta é uma só, em quatro telas (inserir, somar, ajustar, excluir). Fica
 * aqui para as quatro fazerem a MESMA pergunta, com as mesmas palavras: quatro
 * cópias divergiriam na primeira alteração.
 */
(function () {
  const TEXTOS = {
    saida: {
      titulo: 'Abater a matéria-prima?',
      pergunta: 'Estas peças foram produzidas agora?',
      sim: 'Sim, abater do estoque',
      nao: 'Não, apenas lançar a peça',
      explicacaoSim: 'Os insumos da rota até este ponto saem do estoque de matéria-prima.',
      explicacaoNao: 'Só a peça entra no estoque. Use quando ela veio pronta, foi devolvida ou é correção de inventário.'
    },
    entrada: {
      titulo: 'Devolver a matéria-prima?',
      pergunta: 'Estas peças deixaram de existir?',
      sim: 'Sim, devolver ao estoque',
      nao: 'Não, apenas retirar a peça',
      explicacaoSim: 'Os insumos da rota até este ponto voltam ao estoque de matéria-prima.',
      explicacaoNao: 'Só a peça sai do estoque. Use quando ela foi vendida, perdida ou descartada — o material foi junto.'
    }
  };

  /**
   * @param {object} dados
   * @param {'saida'|'entrada'} dados.direcao  `saida` = a peça está entrando no
   *   estoque e o insumo sai; `entrada` = o contrário.
   * @param {number} dados.unidades
   * @param {string} [dados.peca]
   * @param {string} [dados.ponto]  onde a peça parou na rota, por extenso.
   * @returns {Promise<boolean|null>} `null` quando o usuário desiste — e aí a
   *   operação inteira não acontece, porque a pergunta faz parte dela.
   */
  function perguntar({ direcao = 'saida', unidades = 0, peca = '', ponto = '' } = {}) {
    const t = TEXTOS[direcao] || TEXTOS.saida;
    const quantidade = Number(unidades) || 0;
    const rotulo = `${quantidade.toLocaleString('pt-BR')} ${quantidade === 1 ? 'peça' : 'peças'}`;

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
      overlay.style.zIndex = 'var(--z-dialog)';
      overlay.innerHTML = `
        <div class="max-w-md w-full glass-surface backdrop-blur-xl rounded-2xl border border-white/10 ring-1 ring-white/5 shadow-2xl/40 animate-modalFade">
          <div class="p-6 space-y-4">
            <div>
              <h3 class="text-lg font-semibold text-white">${t.titulo}</h3>
              <p class="text-sm text-gray-300 mt-1">${t.pergunta}</p>
            </div>
            <div class="bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-gray-200 space-y-1">
              ${peca ? `<p class="text-white font-medium">${peca}</p>` : ''}
              <p>${rotulo}${ponto ? ` · ${ponto}` : ''}</p>
            </div>
            <div class="space-y-2">
              <button type="button" data-acao="sim" class="w-full btn-primary px-4 py-2 rounded-lg text-white font-medium text-left">
                ${t.sim}
                <span class="block text-[11px] font-normal opacity-80">${t.explicacaoSim}</span>
              </button>
              <button type="button" data-acao="nao" class="w-full btn-neutral px-4 py-2 rounded-lg text-white font-medium text-left">
                ${t.nao}
                <span class="block text-[11px] font-normal opacity-80">${t.explicacaoNao}</span>
              </button>
            </div>
            <div class="flex justify-end pt-1">
              <button type="button" data-acao="cancelar" class="text-xs text-gray-400 hover:text-white transition">Cancelar</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const encerrar = valor => {
        document.removeEventListener('keydown', aoTeclar);
        overlay.remove();
        resolve(valor);
      };
      // Esc e clique fora CANCELAM. Nunca assumem "não": tratar uma desistência
      // como resposta gravaria estoque sem que ninguém tivesse respondido.
      function aoTeclar(e) { if (e.key === 'Escape') encerrar(null); }

      overlay.querySelector('[data-acao="sim"]')?.addEventListener('click', () => encerrar(true));
      overlay.querySelector('[data-acao="nao"]')?.addEventListener('click', () => encerrar(false));
      overlay.querySelector('[data-acao="cancelar"]')?.addEventListener('click', () => encerrar(null));
      overlay.addEventListener('click', e => { if (e.target === overlay) encerrar(null); });
      document.addEventListener('keydown', aoTeclar);
    });
  }

  /** Aviso curto do que aconteceu com a matéria-prima, para o toast. */
  function resumo(resultado, escolheuMexer) {
    if (!escolheuMexer) return '';
    const falhas = Array.isArray(resultado?.falhasInsumos) ? resultado.falhasInsumos : [];
    if (falhas.length) {
      console.error('Falhas ao movimentar a matéria-prima da peça:', falhas);
      return ` ATENÇÃO: ${falhas.length} insumo(s) não foram movimentados — confira o estoque.`;
    }
    const total = Number(resultado?.insumosMovimentados) || 0;
    return total > 0 ? ` ${total} insumo(s) movimentado(s).` : '';
  }

  window.InsumosDaPeca = { perguntar, resumo };
})();
