/**
 * Popover (i) do contato — compartilhado pela tabela de contatos do cadastro/
 * edição (prospeccao-form-comum.js) e pela aba Contatos do detalhe
 * (prospeccao-detalhes.js).
 *
 * Existe como arquivo próprio porque esses dois módulos não se carregam: o
 * detalhe não precisa do formulário inteiro só para desenhar um popover, e
 * duplicar o HTML garantiria que um dos lados ficasse para trás.
 *
 * Cargo, papel e observação saíram das colunas e vieram para cá — a tabela
 * ficou com espaço para nome, e-mail e os dois telefones sem quebrar linha.
 *
 * Exposto como `window.ProspeccaoContatoPopup`.
 */
(function () {
  if (window.ProspeccaoContatoPopup) return;

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const texto = v => (v === null || v === undefined || String(v).trim() === '' ? null : esc(v));

  /** Botão de copiar, no mesmo padrão do popover da grade. */
  const copiar = (valor, rotulo) =>
    `<button type="button" class="popup-copiar" data-copiar="${esc(valor)}"
             data-rotulo="${esc(rotulo)}" title="Copiar ${esc(rotulo.toLowerCase())}"
             aria-label="Copiar ${esc(rotulo.toLowerCase())}">
       <i class="fas fa-copy pointer-events-none"></i>
     </button>`;

  function conteudo(c = {}) {
    const papeis = [];
    if (c.principal) papeis.push('<span class="badge-info px-2 py-1 rounded text-xs">Principal</span>');
    if (c.decisor) papeis.push('<span class="badge-success px-2 py-1 rounded text-xs">Decisor</span>');

    const linha = (icone, valor, rotulo) => valor
      ? `<p class="popup-contato-linha">
           <i class="fas ${icone} text-white/40"></i>
           <span class="popup-contato-texto">${esc(valor)}</span>
           ${rotulo ? copiar(valor, rotulo) : ''}
         </p>`
      : '';

    return `
    <div class="popup-card">
      <div class="popup-header">
        <p class="popup-header-subtitle">Contato</p>
        <h3 class="popup-header-title">${esc(c.nome || '')}</h3>
      </div>
      <div class="popup-body">
        <div class="popup-secao">
          <p class="popup-info-label">Cargo / função</p>
          <p class="popup-info-value">${texto(c.cargo) || '<span class="text-white/40">Não informado</span>'}</p>
        </div>
        <div class="popup-secao">
          <p class="popup-info-label">Papel na negociação</p>
          <div class="mt-1 flex flex-wrap gap-2">
            ${papeis.join('') || '<span class="text-white/40 text-sm">Sem papel definido</span>'}
          </div>
        </div>
        ${(c.email || c.telefone_celular || c.telefone_fixo) ? `
        <div class="popup-secao">
          <p class="popup-info-label">Contato</p>
          ${linha('fa-envelope', c.email, 'E-mail')}
          ${linha('fa-mobile-screen', c.telefone_celular, 'Celular')}
          ${linha('fa-phone', c.telefone_fixo, 'Telefone fixo')}
        </div>` : ''}
        ${texto(c.observacao) ? `
        <div class="popup-secao">
          <p class="popup-info-label">Observação</p>
          <p class="popup-info-value" style="white-space:pre-wrap">${esc(c.observacao)}</p>
        </div>` : ''}
      </div>
    </div>`;
  }

  let popupAtual = null;

  function esconder() {
    if (popupAtual) {
      popupAtual.remove();
      popupAtual = null;
    }
  }

  async function copiarTexto(valor) {
    try {
      await navigator.clipboard.writeText(valor);
      return true;
    } catch (_) {
      try {
        const campo = document.createElement('textarea');
        campo.value = valor;
        campo.style.position = 'fixed';
        campo.style.opacity = '0';
        document.body.appendChild(campo);
        campo.select();
        const ok = document.execCommand('copy');
        campo.remove();
        return ok;
      } catch (err) {
        console.error('Falha ao copiar', err);
        return false;
      }
    }
  }

  function mostrar(icone, contato) {
    esconder();
    const { popup } = window.createPopup(icone, conteudo(contato), { onHide: esconder });
    popupAtual = popup;

    popup.addEventListener('click', async e => {
      const botao = e.target.closest('.popup-copiar');
      if (!botao) return;
      e.preventDefault();
      e.stopPropagation();
      if (!(await copiarTexto(botao.dataset.copiar || ''))) {
        showToast('Não foi possível copiar', 'error');
        return;
      }
      botao.classList.add('copiado');
      botao.querySelector('i')?.classList.replace('fa-copy', 'fa-check');
      showToast(`${botao.dataset.rotulo} copiado!`, 'success');
      setTimeout(() => {
        botao.classList.remove('copiado');
        botao.querySelector('i')?.classList.replace('fa-check', 'fa-copy');
      }, 1500);
    });
  }

  /** Liga o hover no ícone (i) de uma linha da tabela de contatos. */
  function ligar(icone, contato) {
    if (!icone) return;
    icone.addEventListener('mouseenter', () => mostrar(icone, contato));
    icone.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (!popupAtual?.matches(':hover')) esconder();
      }, 100);
    });
    icone.addEventListener('click', e => e.stopPropagation());
  }

  window.ProspeccaoContatoPopup = { conteudo, ligar, esconder };
})();
