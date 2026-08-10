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
              <button type="button" data-acao="cancelar" class="btn-danger px-4 py-2 rounded-lg text-white font-medium">Cancelar</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      // TRAVA NO PRIMEIRO CLIQUE.
      //
      // Entre responder e a gravação terminar existe uma ida à API que leva
      // segundos: são vários insumos, cada um com saldo e duas auditorias. Sem
      // travar aqui, um segundo clique dispararia a operação inteira de novo —
      // peça duplicada no estoque e matéria-prima baixada em dobro.
      let respondido = false;
      const encerrar = valor => {
        if (respondido) return;
        respondido = true;
        overlay.querySelectorAll('button').forEach(b => { b.disabled = true; });
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

  const formatarNumero = valor => Number(valor || 0)
    .toLocaleString('pt-BR', { maximumFractionDigits: 4 });

  /**
   * Aprovação do saldo negativo, com justificativa obrigatória.
   *
   * Abater às cegas e descobrir depois é o que transforma um erro de digitação
   * em inventário furado. Negativo pode acontecer — material que chegou e não
   * foi lançado, ficha técnica desatualizada —, mas é DECISÃO: quem aprova
   * escreve o porquê, e isso fica no movimento daquele insumo.
   *
   * Mesmo padrão da conversão de orçamento: a linha negativa em vermelho, o
   * campo de justificativa obrigatório e o botão travado enquanto ele estiver
   * vazio.
   *
   * @returns {Promise<string|null>} a justificativa, ou `null` se desistiu.
   */
  function aprovarNegativos({ negativos = [], peca = '', ponto = '' } = {}) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
      overlay.style.zIndex = 'var(--z-dialog)';
      overlay.innerHTML = `
        <div class="max-w-lg w-full glass-surface backdrop-blur-xl rounded-2xl border border-red-500/20 ring-1 ring-red-500/30 shadow-2xl/40 animate-modalFade">
          <div class="p-6 space-y-4">
            <div>
              <h3 class="text-lg font-semibold text-red-400">Saldo negativo na matéria-prima</h3>
              <p class="text-sm text-gray-300 mt-1">
                ${negativos.length === 1 ? 'Um insumo ficará' : `${negativos.length} insumos ficarão`}
                com saldo abaixo de zero se você continuar.
              </p>
            </div>

            ${peca ? `
            <div class="bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-gray-200">
              <p class="text-white font-medium">${peca}</p>
              ${ponto ? `<p>${ponto}</p>` : ''}
            </div>` : ''}

            <div class="max-h-56 overflow-y-auto rounded-lg border border-white/10">
              <table class="w-full text-xs">
                <thead class="bg-white/5 text-gray-300">
                  <tr>
                    <th class="text-left px-3 py-2">Insumo</th>
                    <th class="text-right px-3 py-2">Em estoque</th>
                    <th class="text-right px-3 py-2">Consumo</th>
                    <th class="text-right px-3 py-2">Fica com</th>
                  </tr>
                </thead>
                <tbody>
                  ${negativos.map(i => `
                    <tr class="border-t border-white/5">
                      <td class="px-3 py-2 text-gray-200">${i.nome}</td>
                      <td class="px-3 py-2 text-right text-gray-300">${formatarNumero(i.saldo_atual)} ${i.unidade || ''}</td>
                      <td class="px-3 py-2 text-right text-gray-300">${formatarNumero(i.quantidade)}</td>
                      <td class="px-3 py-2 text-right font-semibold status-alert">${formatarNumero(i.saldo_previsto)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>

            <div class="space-y-1">
              <label class="text-xs uppercase tracking-wide text-gray-400">
                Justificativa <span class="text-red-400">*</span>
              </label>
              <textarea data-justificativa rows="2"
                class="w-full bg-input border border-inputBorder rounded-lg px-3 py-2 text-white text-sm"
                placeholder="Por que o saldo pode ficar negativo? (ex.: material recebido e ainda não lançado)"></textarea>
              <p class="text-[11px] text-gray-400">
                Fica gravada no movimento de cada insumo que ficou negativo, com o seu nome.
              </p>
            </div>

            <div class="flex justify-end gap-3 pt-1">
              <button type="button" data-acao="cancelar" class="btn-danger px-4 py-2 rounded-lg text-white font-medium">Cancelar</button>
              <button type="button" data-acao="aprovar" class="btn-warning px-4 py-2 rounded-lg text-white font-medium opacity-50 cursor-not-allowed" disabled>
                Aprovar e continuar
              </button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const campo = overlay.querySelector('[data-justificativa]');
      const btnAprovar = overlay.querySelector('[data-acao="aprovar"]');

      // Sem justificativa não há aprovação: o botão só destrava quando o campo
      // tem conteúdo de verdade.
      const revalidar = () => {
        const preenchido = Boolean(campo.value.trim());
        btnAprovar.disabled = !preenchido;
        btnAprovar.classList.toggle('opacity-50', !preenchido);
        btnAprovar.classList.toggle('cursor-not-allowed', !preenchido);
      };
      campo.addEventListener('input', revalidar);

      let respondido = false;
      const encerrar = valor => {
        if (respondido) return;
        respondido = true;
        overlay.querySelectorAll('button').forEach(b => { b.disabled = true; });
        document.removeEventListener('keydown', aoTeclar);
        overlay.remove();
        resolve(valor);
      };
      function aoTeclar(e) { if (e.key === 'Escape') encerrar(null); }

      btnAprovar.addEventListener('click', () => {
        const texto = campo.value.trim();
        if (!texto) { campo.focus(); return; }
        encerrar(texto);
      });
      overlay.querySelector('[data-acao="cancelar"]')?.addEventListener('click', () => encerrar(null));
      overlay.addEventListener('click', e => { if (e.target === overlay) encerrar(null); });
      document.addEventListener('keydown', aoTeclar);
      campo.focus();
    });
  }

  /**
   * A pergunta completa: abater ou não e, se abater e algum insumo ficar
   * negativo, a aprovação com justificativa.
   *
   * @returns {Promise<{mexer: boolean, justificativa: string|null}|null>}
   *   `null` = desistiu, e nada deve ser gravado.
   */
  async function decidir({ direcao = 'saida', unidades = 0, peca = '', ponto = '', previsao = null } = {}) {
    const mexer = await perguntar({ direcao, unidades, peca, ponto });
    if (mexer === null || mexer === undefined) return null;
    if (!mexer) return { mexer: false, justificativa: null };

    // Devolver nunca deixa saldo negativo: só a saída precisa da conferência.
    //
    // A consulta vai ao banco e leva um instante. SOB O VÉU: sem ele a tela
    // ficava parada entre o "Sim" e o modal de aprovação, sem nada indicando
    // que algo estava acontecendo — e é justamente aí que se clica de novo.
    let negativos = [];
    if (direcao === 'saida' && typeof previsao === 'function') {
      const consulta = async () => (await previsao().catch(() => null))?.negativos || [];
      negativos = window.BotaoAcao?.comCarregamento
        ? await window.BotaoAcao.comCarregamento(consulta, 'Conferindo o estoque de matéria-prima...')
        : await consulta();
    }
    if (!negativos.length) return { mexer: true, justificativa: null };

    const justificativa = await aprovarNegativos({ negativos, peca, ponto });
    if (justificativa === null) return null;
    return { mexer: true, justificativa };
  }

  /** Aviso curto do que aconteceu com a matéria-prima, para o toast. */
  function resumo(resultado, escolheuMexer) {
    if (!escolheuMexer) return '';
    const total = Number(resultado?.insumosMovimentados) || 0;
    return total > 0 ? ` ${total} insumo(s) movimentado(s).` : '';
  }

  /**
   * Roda a gravação sob o véu de carregamento e devolve o resultado.
   *
   * O véu fica de pé até TUDO terminar: a peça, cada insumo e as auditorias dos
   * dois. Sem ele, a tela voltava a parecer disponível enquanto o backend ainda
   * estava gravando — e quem clicasse de novo duplicava a operação.
   *
   * Falha parcial é FALHA: se algum insumo não se moveu, isto lança. Quem chamou
   * não fecha o modal nem mostra sucesso, e o motivo fica no erro.
   */
  async function comCarregamento(fn, escolheuMexer) {
    const executar = async () => {
      const resultado = await fn();
      const falhas = Array.isArray(resultado?.falhasInsumos) ? resultado.falhasInsumos : [];
      if (escolheuMexer && falhas.length) {
        console.error('Falhas ao movimentar a matéria-prima da peça:', falhas);
        const erro = new Error(
          `A peça foi gravada, mas ${falhas.length} insumo(s) não foram movimentados. `
          + 'Confira o estoque de matéria-prima antes de seguir.'
        );
        erro.falhasInsumos = falhas;
        erro.parcial = true;
        throw erro;
      }
      return resultado;
    };

    if (window.BotaoAcao?.comCarregamento) {
      return window.BotaoAcao.comCarregamento(
        executar,
        escolheuMexer ? 'Atualizando estoque e matéria-prima...' : 'Atualizando estoque...'
      );
    }
    return executar();
  }

  window.InsumosDaPeca = { perguntar, aprovarNegativos, decidir, resumo, comCarregamento };
})();
