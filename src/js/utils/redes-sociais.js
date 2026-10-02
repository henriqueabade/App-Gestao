/**
 * Redes sociais, uma por linha (01/10/2026: Clientes, no molde de
 * Prospecções): a caixa da rede, o perfil ou endereço, o − (aparece quando há
 * mais de uma linha) e o + no fim, que abre outra linha igual.
 *
 *   const redes = window.RedesSociais.montar(container, { somenteLeitura });
 *   redes.definir([{ rede, valor }]);  redes.ler()  → [{ rede, valor }] (só as preenchidas)
 *   redes.linhaSemRede()               → índice da linha com endereço e sem rede (-1 se nenhuma)
 *   redes.focarRede(i)
 *
 * A lista de redes é a mesma do backend (backend/prospeccaoListas.js, REDES).
 * Tudo por textContent/value: os textos vêm do banco.
 */
(function () {
  if (typeof window === 'undefined' || window.RedesSociais) return;

  const REDES = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'X (Twitter)', 'Pinterest', 'WhatsApp', 'Outra'];
  const CLASSE_CAMPO = 'ctl-campo bg-input border border-inputBorder text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition';

  function botao(classe, icone, titulo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${classe} btn-neutral ctl-botao ctl-botao--icone text-white`;
    b.title = titulo;
    b.setAttribute('aria-label', titulo);
    const i = document.createElement('i');
    i.className = `fas ${icone}`;
    i.setAttribute('aria-hidden', 'true');
    b.appendChild(i);
    return b;
  }

  function montar(container, { somenteLeitura = false } = {}) {
    if (!container) return null;
    container.classList.add('redes-sociais');

    function refletir() {
      const linhas = Array.from(container.children);
      linhas.forEach(l => l.querySelector('.redes-sociais__menos')?.classList.toggle('hidden', somenteLeitura || linhas.length < 2));
      linhas.forEach(l => l.querySelector('.redes-sociais__mais')?.classList.toggle('hidden', somenteLeitura));
    }

    function linha({ rede = '', valor = '' } = {}) {
      const el = document.createElement('div');
      el.className = 'redes-sociais__linha';
      const sel = document.createElement('select');
      sel.className = `redes-sociais__rede ${CLASSE_CAMPO} select-arrow appearance-none`;
      sel.setAttribute('aria-label', 'Rede social');
      const opcoes = [new Option('Rede', '')];
      REDES.forEach(r => opcoes.push(new Option(r, r)));
      if (rede && !REDES.includes(rede)) opcoes.push(new Option(rede, rede));
      sel.replaceChildren(...opcoes);
      sel.value = rede || '';
      sel.disabled = somenteLeitura;
      const campo = document.createElement('input');
      campo.type = 'text';
      campo.maxLength = 200;
      campo.className = `redes-sociais__valor ${CLASSE_CAMPO}`;
      campo.placeholder = somenteLeitura ? '' : '@perfil ou endereço da página';
      campo.setAttribute('aria-label', 'Perfil ou endereço na rede');
      campo.value = valor || '';
      campo.readOnly = somenteLeitura;
      const menos = botao('redes-sociais__menos', 'fa-minus', 'Tirar esta rede');
      const mais = botao('redes-sociais__mais', 'fa-plus', 'Mais uma rede');
      mais.addEventListener('click', () => {
        const nova = linha();
        el.after(nova);
        refletir();
        nova.querySelector('select')?.focus();
      });
      menos.addEventListener('click', () => {
        el.remove();
        if (!container.children.length) container.appendChild(linha());
        refletir();
      });
      el.append(sel, campo, menos, mais);
      return el;
    }

    function definir(lista) {
      const itens = (Array.isArray(lista) ? lista : []).filter(r => r && (r.valor || r.rede));
      container.replaceChildren(...(itens.length ? itens : [{}]).map(linha));
      refletir();
    }

    function todas() {
      return Array.from(container.querySelectorAll('.redes-sociais__linha')).map(l => ({
        rede: l.querySelector('.redes-sociais__rede')?.value || '',
        valor: (l.querySelector('.redes-sociais__valor')?.value || '').trim()
      }));
    }

    definir([]);
    return {
      definir,
      /** Só as linhas com rede e endereço. */
      ler: () => todas().filter(r => r.rede && r.valor),
      /** A linha com endereço e sem rede (a tela avisa antes de salvar), ou -1. */
      linhaSemRede: () => todas().findIndex(r => r.valor && !r.rede),
      focarRede: i => container.querySelectorAll('.redes-sociais__rede')[i]?.focus()
    };
  }

  window.RedesSociais = { REDES, montar };
})();
