/**
 * Converter prospecção em cliente — POST /api/prospeccoes/:id/converter.
 *
 * É aqui que os dados fiscais deixam de ser opcionais. A checagem também é
 * feita no backend (que devolve 422 com a lista); a daqui existe para avisar
 * ANTES de a pessoa clicar em Converter e levar um erro.
 */
(async function () {
  const overlay = document.getElementById('converterProspeccaoOverlay');
  if (!overlay) return;

  if (!window.ProspeccaoAcoes) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/modals/prospeccao-acoes-comum.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const A = window.ProspeccaoAcoes;
  const get = id => document.getElementById(id);
  const fechar = A.ligarFechamento(overlay, 'converterProspeccao',
    ['voltarConverterProspeccao', 'cancelarConverterProspeccao']);

  const p = A.alvo();
  if (!p?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  const empresa = p.nome_fantasia || p.razao_social || '(sem nome)';
  get('converterEmpresa').textContent = empresa;
  get('converterSubtitulo').textContent = [p.razao_social, p.cnpj].filter(Boolean).join(' · ');
  get('converterIniciais').textContent = empresa.split(' ').filter(Boolean)
    .map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const contatos = Array.isArray(window.prospeccaoAcaoContatos) ? window.prospeccaoAcaoContatos : [];
  get('converterQtdContatos').textContent = contatos.length
    ? `${contatos.length} contato${contatos.length > 1 ? 's' : ''}`
    : 'Os contatos';

  // -------------------------------------------------------------------------
  // Já convertida?
  // -------------------------------------------------------------------------
  if (p.cliente_id) {
    get('converterFormulario').innerHTML =
      `<div class="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
         Esta prospecção já foi convertida no cliente <strong class="text-white">#${A.esc(p.cliente_id)}</strong>.
       </div>`;
    get('confirmarConverterProspeccao').disabled = true;
    get('confirmarConverterProspeccao').classList.add('opacity-50', 'cursor-not-allowed');
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'converterProspeccao' }));
    return;
  }

  // -------------------------------------------------------------------------
  // Pendências fiscais
  // -------------------------------------------------------------------------
  function mostrarPendencias(lista) {
    get('converterListaPendencias').innerHTML = lista.map(c => `<li>${A.esc(c)}</li>`).join('');
    get('converterPendencias').classList.remove('hidden');
    get('converterFormulario').classList.add('hidden');
    const botao = get('confirmarConverterProspeccao');
    botao.disabled = true;
    botao.classList.add('opacity-50', 'cursor-not-allowed');
  }

  const falta = [];
  if (!A.texto(p.razao_social)) falta.push('Razão Social');
  if (!A.texto(p.nome_fantasia)) falta.push('Nome Fantasia');
  if (!A.texto(p.cnpj)) falta.push('CNPJ');
  if (falta.length) mostrarPendencias(falta);

  // -------------------------------------------------------------------------
  // Dono do cliente
  // -------------------------------------------------------------------------
  try {
    const resp = await A.fetchApi('/api/usuarios/lista');
    const usuarios = await resp.json();
    const sel = get('converterDono');
    sel.innerHTML = '<option value="">Selecione</option>' +
      (Array.isArray(usuarios) ? usuarios : [])
        .map(u => `<option value="${A.esc(u.nome)}">${A.esc(u.nome)}</option>`).join('');
    // `clientes.dono_cliente` guarda o NOME, não o id — quem já cuidava da
    // prospecção é o padrão natural para cuidar do cliente.
    if (p.responsavel) sel.value = p.responsavel;
  } catch (err) {
    console.error('Erro ao carregar donos', err);
  }

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'converterProspeccao' }));

  // -------------------------------------------------------------------------
  // Converter
  // -------------------------------------------------------------------------
  A.aoConfirmar(get('confirmarConverterProspeccao'), async () => {
    if (get('confirmarConverterProspeccao').disabled) return;

    const resultado = await A.enviar(`/api/prospeccoes/${p.id}/converter`, {
      method: 'POST',
      body: JSON.stringify({
        status_cliente: get('converterStatus').value,
        dono_cliente: A.texto(get('converterDono').value)
      })
    }, {
      overlayId: 'converterProspeccao',
      sucesso: null, // aviso próprio abaixo, com o número do cliente
      aoFalhar: (status, corpo) => {
        if (status === 422 && Array.isArray(corpo.camposFaltantes)) {
          mostrarPendencias(corpo.camposFaltantes);
          showToast(corpo.error, 'error');
          return true;
        }
        if (status === 409) {
          // Já convertida, ou já existe cliente com o mesmo CNPJ.
          showToast(corpo.error || 'Conversão já realizada', 'error');
          return true;
        }
        return false;
      }
    });

    if (resultado?.clienteId) {
      showToast(`Cliente #${resultado.clienteId} criado com sucesso!`, 'success');
    }
  });
})();
