/**
 * Registrar interação — POST /api/prospeccoes/:id/interacoes.
 *
 * O mesmo POST aceita o próximo passo, e o formulário aproveita: registrar um
 * contato e esquecer de agendar o retorno é o jeito mais comum de perder um
 * negócio por esquecimento.
 */
(async function () {
  const overlay = document.getElementById('interacaoProspeccaoOverlay');
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
  const fechar = A.ligarFechamento(overlay, 'interacaoProspeccao',
    ['voltarInteracaoProspeccao', 'cancelarInteracaoProspeccao']);

  const prospeccao = A.alvo();
  if (!prospeccao?.id) {
    showToast('Prospecção não encontrada', 'error');
    fechar();
    return;
  }

  // O Tipo é a lista editável com + e − (utils/prospeccao-listas.js). Enquanto
  // ela carrega, valem os tipos de sempre.
  get('interacaoTipo').innerHTML = A.TIPOS_INTERACAO
    .map(t => `<option value="${A.esc(t)}">${A.esc(t)}</option>`).join('');
  if (!window.ProspeccaoListas) {
    await new Promise(resolve => {
      const s = document.createElement('script');
      s.src = '../js/utils/prospeccao-listas.js';
      s.onload = resolve;
      s.onerror = () => { console.error('Erro ao carregar as listas de prospecção'); resolve(); };
      document.head.appendChild(s);
    });
  }

  // Data/hora local no formato do <input type="datetime-local">, que não aceita
  // o ISO com fuso.
  const agora = new Date();
  agora.setMinutes(agora.getMinutes() - agora.getTimezoneOffset());
  get('interacaoData').value = agora.toISOString().slice(0, 16);
  // Atividade é o que JÁ aconteceu: o calendário do campo não passa de agora.
  get('interacaoData').max = agora.toISOString().slice(0, 16);

  // Contatos da prospecção: o backend recusa contato de outra, então a lista
  // só pode conter os desta.
  const contatos = Array.isArray(window.prospeccaoAcaoContatos) ? window.prospeccaoAcaoContatos : [];
  if (contatos.length) {
    get('interacaoContato').innerHTML = '<option value="">Não especificado</option>' +
      contatos.map(c => {
        const rotulo = c.cargo ? `${c.nome} — ${c.cargo}` : c.nome;
        return `<option value="${A.esc(c.id)}">${A.esc(rotulo)}</option>`;
      }).join('');
    const principal = contatos.find(c => c.principal);
    if (principal) get('interacaoContato').value = String(principal.id);
  }

  // Duração só faz sentido para o que tem começo e fim. Os tipos novos da
  // lista (incluídos pelo +) mostram o campo — ele é opcional.
  const SEM_DURACAO = new Set(['E-mail', 'WhatsApp', 'Proposta', 'Nota', 'Atividade realizada']);
  function refletirTipo() {
    const mostrar = !SEM_DURACAO.has(get('interacaoTipo').value);
    get('interacaoDuracaoBloco').classList.toggle('hidden', !mostrar);
    if (!mostrar) get('interacaoDuracao').value = '';
  }
  get('interacaoTipo').addEventListener('change', refletirTipo);

  // Consome o sinal na hora: pendurado, faria a PRÓXIMA "Registrar interação"
  // abrir em modo edição e sobrescrever a atividade anterior.
  const edicao = window.prospeccaoInteracaoEditar || null;
  delete window.prospeccaoInteracaoEditar;

  // A lista do Tipo, com o + e o −. Na edição, o tipo que a atividade já tem
  // continua valendo mesmo fora da lista ("Atividade realizada" é do sistema).
  const tiposDaLista = window.ProspeccaoListas
    ? await window.ProspeccaoListas.ligar({
      lista: 'tipos-interacao',
      select: get('interacaoTipo'),
      botaoMais: get('addTipoInteracao'),
      botaoMenos: get('delTipoInteracao'),
      valor: edicao?.tipo || '',
      aoMudar: refletirTipo
    })
    : null;
  refletirTipo();
  // Ao fechar, o ouvinte da lista sai junto (Modal.close avisa com o id).
  window.addEventListener('modalFechado', function aoFechar(e) {
    if (e?.detail !== 'interacaoProspeccao') return;
    tiposDaLista?.destruir();
    window.removeEventListener('modalFechado', aoFechar);
  });

  if (edicao) {
    get('tituloModalInteracao').textContent = 'Editar Atividade';
    get('salvarInteracaoProspeccao').textContent = 'Salvar';
    get('interacaoResumo').value = edicao.resumo || '';
    get('interacaoDetalhe').value = edicao.detalhe || '';
    get('interacaoDuracao').value = edicao.duracao_min ?? '';
    if (edicao.contato_id) get('interacaoContato').value = String(edicao.contato_id);
    if (edicao.data) {
      // Mesmo caminho de volta da gravação: o instante em UTC vira hora LOCAL
      // para o <input datetime-local>, que não aceita fuso.
      const d = new Date(edicao.data);
      if (!Number.isNaN(d.getTime())) {
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        get('interacaoData').value = d.toISOString().slice(0, 16);
      }
    }
    // Próximo passo fica de fora na edição: ele pertence à prospecção, não a
    // esta linha da timeline. Reaproveitar o campo aqui mudaria o combinado em
    // aberto sem que ninguém tivesse pedido.
    get('interacaoBlocoProximoPasso')?.classList.add('hidden');
    refletirTipo();
    window.EstadoTrabalho?.registrarContexto?.('interacaoProspeccao',
      () => ({ prospeccaoInteracaoEditar: edicao }));
  }

  get('interacaoProspeccaoForm')?.addEventListener('submit', e => e.preventDefault());
  setTimeout(() => get('interacaoResumo')?.focus(), 60);

  A.aoConfirmar(get('salvarInteracaoProspeccao'), async () => {
    const resumo = A.texto(get('interacaoResumo').value);
    if (!resumo) {
      showToast('Informe um resumo da interação', 'error');
      get('interacaoResumo').focus();
      return;
    }

    const duracaoBruta = get('interacaoDuracao').value.trim();
    let duracao = null;
    if (duracaoBruta) {
      const n = window.NumericInput?.parse ? window.NumericInput.parse(duracaoBruta) : Number(duracaoBruta);
      if (!Number.isFinite(n) || n < 0) {
        showToast('Duração inválida', 'error');
        get('interacaoDuracao').focus();
        return;
      }
      duracao = Math.round(n);
    }

    const dataLocal = get('interacaoData').value;
    // Um minuto de folga para o relógio da máquina; o backend confere de novo.
    if (dataLocal && new Date(dataLocal).getTime() > Date.now() + 60000) {
      showToast('A atividade registra o que já aconteceu: escolha uma data e hora até agora. Para algo futuro, preencha o próximo passo.', 'error');
      get('interacaoData').focus();
      return;
    }
    const contatoId = get('interacaoContato').value;
    const proximoPasso = A.texto(get('interacaoProximoPasso').value);
    const proximoPassoData = get('interacaoProximoPassoData').value || null;

    const corpo = {
      tipo: get('interacaoTipo').value,
      resumo,
      detalhe: A.texto(get('interacaoDetalhe').value),
      duracao_min: duracao,
      contato_id: contatoId ? Number(contatoId) : null,
      // O <input> devolve hora local sem fuso; o `new Date` reinterpreta no
      // fuso do usuário e o toISOString entrega o instante correto.
      data: dataLocal ? new Date(dataLocal).toISOString() : new Date().toISOString()
    };

    // Só manda o próximo passo se algo foi preenchido — o backend trata a
    // presença da chave como intenção de alterar, e enviar vazio à toa apagaria
    // o passo que já estava agendado.
    if (!edicao && (proximoPasso || proximoPassoData)) {
      corpo.proximo_passo = proximoPasso;
      corpo.proximo_passo_data = proximoPassoData;
    }

    await A.enviar(edicao
      ? `/api/prospeccoes/${prospeccao.id}/interacoes/${edicao.id}`
      : `/api/prospeccoes/${prospeccao.id}/interacoes`, {
      method: edicao ? 'PUT' : 'POST',
      body: JSON.stringify(corpo)
    }, {
      overlayId: 'interacaoProspeccao',
      sucesso: edicao ? 'Atividade atualizada' : 'Interação registrada'
    });
  });

  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'interacaoProspeccao' }));
})();
