/**
 * Converter Orçamento — seleção em lote, a partir do módulo de Pedidos.
 *
 * Lista os orçamentos que PODEM virar pedido, deixa marcar vários e converte
 * todos de uma vez. Cada conversão é o mesmo caminho já usado pelo ícone de
 * converter em Orçamentos: `PATCH /api/orcamentos/:id/status` com
 * `situacao: 'Aprovado'`, que aprova o orçamento e cria o pedido em Produção.
 * Não existe uma segunda regra de conversão aqui de propósito.
 */
(async () => {
  const overlayId = 'converterOrcamentos';
  const overlay = document.getElementById('converterOrcamentosOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  // ------------------------------------------------------------------
  // Quem pode ser convertido
  //
  // Rascunho ainda não é um orçamento fechado; Cancelado, Expirado e Rejeitado
  // morreram; Aprovado já virou pedido. Sobra o que está em aberto — hoje,
  // "Pendente". A lista é por EXCLUSÃO para que um status novo apareça aqui em
  // vez de sumir sem ninguém perceber.
  // ------------------------------------------------------------------
  const SITUACOES_BLOQUEADAS = new Set([
    'rascunho',
    'cancelado',
    'expirado',
    'rejeitado',
    'aprovado'
  ]);

  function normalizar(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function podeConverter(orcamento) {
    return !SITUACOES_BLOQUEADAS.has(normalizar(orcamento?.situacao));
  }

  function escaparHtml(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatarData(iso) {
    if (!iso) return '—';
    const data = new Date(iso);
    if (Number.isNaN(data.getTime())) return '—';
    return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  }

  function formatarValor(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  const elementos = {
    tabela: document.getElementById('converterOrcamentosTabela'),
    wrapper: document.getElementById('converterOrcamentosTabelaWrapper'),
    vazio: document.getElementById('converterOrcamentosVazio'),
    busca: document.getElementById('buscaConverterOrcamentos'),
    todos: document.getElementById('selecionarTodosConverterOrcamentos'),
    resumo: document.getElementById('resumoConverterOrcamentos'),
    converter: document.getElementById('confirmarConverterOrcamentos'),
    voltar: document.getElementById('voltarConverterOrcamentos'),
    cancelar: document.getElementById('cancelarConverterOrcamentos')
  };

  let disponiveis = [];               // orçamentos que podem ser convertidos
  const selecionados = new Set();     // ids marcados (como string)

  const close = () => Modal.close(overlayId);

  // Fechar: só por botão ou Esc. Clicar fora NÃO fecha — ver
  // docs/padroes-de-interface.md.
  elementos.voltar?.addEventListener('click', close);
  elementos.cancelar?.addEventListener('click', close);
  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    document.removeEventListener('keydown', aoTeclar);
    close();
  }
  document.addEventListener('keydown', aoTeclar);

  function nomeCliente(orcamento) {
    return orcamento.__cliente || '—';
  }

  function textoDoOrcamento(orcamento) {
    return `${orcamento.numero || orcamento.id} — ${nomeCliente(orcamento)} — ${formatarValor(orcamento.valor_final)}`;
  }

  function filtrados() {
    const termo = normalizar(elementos.busca?.value);
    if (!termo) return disponiveis;
    return disponiveis.filter(o =>
      normalizar(o.numero).includes(termo) || normalizar(nomeCliente(o)).includes(termo)
    );
  }

  function atualizarResumo() {
    const total = selecionados.size;
    if (elementos.resumo) {
      elementos.resumo.textContent = total === 0
        ? 'Nenhum orçamento selecionado'
        : `${total} orçamento${total > 1 ? 's' : ''} selecionado${total > 1 ? 's' : ''}`;
    }

    // O botão continua clicável sem seleção: avisar o motivo é melhor que um
    // botão morto que não explica nada.
    const visiveis = filtrados();
    if (elementos.todos) {
      const marcadosVisiveis = visiveis.filter(o => selecionados.has(String(o.id))).length;
      elementos.todos.checked = visiveis.length > 0 && marcadosVisiveis === visiveis.length;
      elementos.todos.indeterminate = marcadosVisiveis > 0 && marcadosVisiveis < visiveis.length;
      elementos.todos.disabled = visiveis.length === 0;
    }
  }

  function renderizar() {
    const linhas = filtrados();
    if (!elementos.tabela) return;
    elementos.tabela.innerHTML = '';

    const temAlgum = disponiveis.length > 0;
    elementos.wrapper?.classList.toggle('hidden', !temAlgum);
    elementos.vazio?.classList.toggle('hidden', temAlgum);

    if (!temAlgum) {
      atualizarResumo();
      return;
    }

    if (!linhas.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="5" class="py-10 px-4 text-center text-gray-400">
          Nenhum orçamento encontrado para a busca.
        </td>`;
      elementos.tabela.appendChild(tr);
      atualizarResumo();
      return;
    }

    linhas.forEach(orcamento => {
      const id = String(orcamento.id);
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/5 transition-colors duration-150 hover:bg-white/5';
      tr.dataset.id = id;
      tr.innerHTML = `
        <td class="py-3 px-4">
          <input type="checkbox" class="component-toggle" data-selecionar="${escaparHtml(id)}"
                 ${selecionados.has(id) ? 'checked' : ''}
                 aria-label="Selecionar orçamento ${escaparHtml(orcamento.numero || id)}" />
        </td>
        <td class="py-3 px-4 text-sm font-medium text-white whitespace-nowrap">${escaparHtml(orcamento.numero || id)}</td>
        <td class="py-3 px-4 text-sm text-white">${escaparHtml(nomeCliente(orcamento))}</td>
        <td class="py-3 px-4 text-sm whitespace-nowrap" style="color: var(--color-violet)">${escaparHtml(formatarData(orcamento.data_emissao))}</td>
        <td class="py-3 px-4 text-sm text-white whitespace-nowrap">${escaparHtml(formatarValor(orcamento.valor_final))}</td>`;

      const caixa = tr.querySelector('input[type="checkbox"]');
      const alternar = marcado => {
        if (marcado) selecionados.add(id);
        else selecionados.delete(id);
        atualizarResumo();
      };
      caixa?.addEventListener('change', evento => alternar(evento.target.checked));
      // Clicar na linha também marca — só não pode brigar com o clique na caixa.
      tr.addEventListener('click', evento => {
        if (evento.target === caixa) return;
        caixa.checked = !caixa.checked;
        alternar(caixa.checked);
      });

      elementos.tabela.appendChild(tr);
    });

    atualizarResumo();
  }

  elementos.busca?.addEventListener('input', renderizar);

  elementos.todos?.addEventListener('change', evento => {
    const marcar = evento.target.checked;
    filtrados().forEach(o => {
      if (marcar) selecionados.add(String(o.id));
      else selecionados.delete(String(o.id));
    });
    renderizar();
  });

  // ------------------------------------------------------------------
  // Carga
  // ------------------------------------------------------------------
  async function carregarClientes() {
    const porId = new Map();
    try {
      const resp = await fetchApi('/api/clientes/lista');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const clientes = await resp.json();
      (Array.isArray(clientes) ? clientes : []).forEach(c => {
        porId.set(String(c.id), c.nome_fantasia || c.razao_social || c.nome || 'Sem nome');
      });
    } catch (err) {
      console.error('Erro ao carregar clientes para conversão de orçamentos', err);
    }
    return porId;
  }

  async function carregar() {
    try {
      const [resp, clientes] = await Promise.all([
        fetchApi('/api/orcamentos'),
        carregarClientes()
      ]);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const dados = await resp.json();

      disponiveis = (Array.isArray(dados) ? dados : [])
        .filter(podeConverter)
        .map(o => ({ ...o, __cliente: clientes.get(String(o.cliente_id)) || '—' }))
        .sort((a, b) => String(a.numero || '').localeCompare(String(b.numero || ''), 'pt-BR', { numeric: true }));
    } catch (err) {
      console.error('Erro ao carregar orçamentos para conversão', err);
      disponiveis = [];
      window.showToast?.('Não foi possível carregar os orçamentos.', 'error');
    }
    renderizar();
  }

  // ------------------------------------------------------------------
  // Conversão
  // ------------------------------------------------------------------
  function orcamentosSelecionados() {
    return disponiveis.filter(o => selecionados.has(String(o.id)));
  }

  // ------------------------------------------------------------------
  // Revisão de estoque, orçamento a orçamento
  //
  // Converter sem passar por aqui grava "produzir tudo do zero" em silêncio:
  // peças prontas ficam paradas no estoque e o insumo é gasto de novo. Por isso
  // o lote não converte direto — ele enfileira a MESMA revisão que o ícone de
  // converter em Orçamentos abre (editar + converter, com
  // `autoOpenQuoteConversion`), e espera a decisão de cada um.
  // ------------------------------------------------------------------
  const ID_OVERLAY_EDITAR = 'editarOrcamentoOverlay';
  const ID_OVERLAY_REVISAO = 'converterOrcamentoOverlay';

  const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Máscara de "trabalhando" no estilo do app.
   *
   * A conversão mexe em estoque e leva alguns segundos. Antes o modal fechava
   * na hora e o usuário ficava sem saber se deu certo, se deu erro ou se ainda
   * estava rodando. Agora a tela diz o que está acontecendo, e só depois vem a
   * mensagem de resultado.
   */
  function abrirEspera(mensagem) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4';
    overlay.style.zIndex = 'var(--z-dialog)';
    overlay.setAttribute('role', 'alert');
    // `data-sem-top-layer`: é máscara de espera, não caixa de diálogo — não
    // pode entrar na top layer e travar o resto do documento.
    overlay.setAttribute('data-sem-top-layer', 'true');
    overlay.innerHTML = `
      <div class="app-loading-indicator app-loading-indicator--compact" aria-hidden="true">
        <span class="module-loading-orbit"></span>
        <span class="module-loading-core"><img src="../assets/Logo.ico" alt=""></span>
      </div>
      <p class="text-sm text-white font-medium" data-role="mensagem">${escaparHtml(mensagem)}</p>`;
    document.body.appendChild(overlay);
    return {
      atualizar: texto => {
        const alvo = overlay.querySelector('[data-role="mensagem"]');
        if (alvo) alvo.textContent = texto;
      },
      fechar: () => { if (overlay.isConnected) overlay.remove(); }
    };
  }

  function revisaoNaTela() {
    return Boolean(
      document.getElementById(ID_OVERLAY_EDITAR) || document.getElementById(ID_OVERLAY_REVISAO)
    );
  }

  /** Espera a revisão aparecer e, depois, sumir — os dois desfechos fecham. */
  async function esperarFimDaRevisao(limiteAberturaMs = 20000) {
    const ateAbrir = Date.now() + limiteAberturaMs;
    while (!revisaoNaTela() && Date.now() < ateAbrir) await esperar(150);
    if (!revisaoNaTela()) throw new Error('A revisão de estoque não abriu.');

    // Sem limite aqui de propósito: quem decide o tempo é o usuário, olhando
    // peça a peça. Impor um teto abortaria uma revisão legítima e demorada.
    while (revisaoNaTela()) await esperar(250);
    // Deixa o fechamento assentar antes de abrir o próximo.
    await esperar(400);
  }

  /**
   * @returns {Promise<'convertido'|'ignorado'>} — a fonte da verdade é o banco:
   * se o orçamento ficou "Aprovado", a conversão aconteceu.
   */
  async function revisarEConverter(orcamento) {
    window.autoOpenQuoteConversion = { id: orcamento.id, skipInnerSpinner: true, deferReveal: false };
    window.selectedQuoteId = orcamento.id;

    await Modal.open(
      'modals/orcamentos/editar.html',
      '../js/modals/orcamento-editar.js',
      'editarOrcamento',
      true
    );

    await esperarFimDaRevisao();
    window.autoOpenQuoteConversion = null;

    // A revisão fechou, mas a conversão pode ainda estar rodando no servidor
    // (criar pedido, gravar faltantes, abater estoque). Enquanto isso a tela
    // mostra a espera em vez de ficar muda.
    const espera = abrirEspera(
      `Convertendo ${orcamento.numero || orcamento.id} e aplicando o estoque...`
    );
    try {
      return await confirmarConversao(orcamento);
    } finally {
      espera.fechar();
    }
  }

  /**
   * Espera o orçamento aparecer como "Aprovado".
   *
   * A fonte da verdade é o banco: a revisão pode ter sido cancelada (nunca
   * aprova) ou a conversão pode demorar. Perguntamos algumas vezes antes de
   * concluir que o usuário desistiu — concluir cedo demais marcaria como
   * "não convertido" algo que converteu.
   */
  async function confirmarConversao(orcamento, tentativas = 12, intervaloMs = 1000) {
    for (let i = 0; i < tentativas; i += 1) {
      const resp = await fetchApi(`/api/orcamentos/${orcamento.id}`);
      if (!resp.ok) throw new Error(`Não foi possível confirmar a conversão (HTTP ${resp.status})`);
      const atual = await resp.json();
      if (normalizar(atual?.situacao) === 'aprovado') return 'convertido';
      // A primeira leitura já basta quando a revisão foi cancelada: nesse caso
      // nenhuma conversão foi disparada e o status não vai mudar. Ainda assim
      // damos alguns ciclos, porque a gravação pode estar em andamento.
      await esperar(intervaloMs);
    }
    return 'ignorado';
  }

  async function converter() {
    const escolhidos = orcamentosSelecionados();
    if (!escolhidos.length) {
      await window.DialogPadrao?.info?.({
        title: 'Nenhum orçamento selecionado',
        message: 'Selecione pelo menos um orçamento para converter em pedido.'
      });
      return;
    }

    const lista = escolhidos.map(o => `• ${textoDoOrcamento(o)}`).join('\n');
    const confirmado = await window.DialogPadrao?.confirm?.({
      title: 'Converter em pedido?',
      message:
        `Tem certeza que deseja converter ${escolhidos.length === 1 ? 'este orçamento' : `estes ${escolhidos.length} orçamentos`}?\n\n` +
        `${lista}\n\n` +
        (escolhidos.length === 1
          ? 'A revisão de estoque será aberta para você escolher o que usar pronto e o que produzir.'
          : 'A revisão de estoque será aberta para cada um, em sequência, para você escolher o que usar pronto e o que produzir.'),
      confirmText: 'Sim, converter',
      cancelText: 'Não'
    });
    if (!confirmado) return;

    // Fecha a seleção antes da primeira revisão: os dois modais disputariam a
    // tela, e a revisão precisa dela inteira.
    close();

    const convertidos = [];
    const ignorados = [];
    const falhas = [];

    // Um a um, de propósito: cada conversão mexe em estoque e a falha (ou a
    // desistência) de uma não pode impedir as outras.
    for (const orcamento of escolhidos) {
      try {
        const situacao = await revisarEConverter(orcamento);
        if (situacao === 'convertido') convertidos.push(orcamento);
        else ignorados.push(orcamento);
      } catch (err) {
        console.error(`Erro ao converter orçamento ${orcamento.numero || orcamento.id}`, err);
        falhas.push({ orcamento, motivo: err?.message || 'Erro inesperado' });
      }
    }

    if (convertidos.length) {
      window.showToast?.(
        convertidos.length === 1
          ? 'Orçamento convertido em pedido.'
          : `${convertidos.length} orçamentos convertidos em pedidos.`,
        'success'
      );
    }

    const linhasResumo = [];
    if (ignorados.length) {
      linhasResumo.push(
        `Não convertidos (revisão cancelada):\n` +
        ignorados.map(o => `• ${o.numero || o.id}`).join('\n')
      );
    }
    if (falhas.length) {
      linhasResumo.push(
        `Com erro:\n` +
        falhas.map(f => `• ${f.orcamento.numero || f.orcamento.id}: ${f.motivo}`).join('\n')
      );
    }
    if (linhasResumo.length) {
      await window.DialogPadrao?.info?.({
        title: convertidos.length ? 'Conversão parcial' : 'Nenhum orçamento convertido',
        message: linhasResumo.join('\n\n')
      });
    }

    // A seleção já foi fechada antes da primeira revisão; aqui só resta
    // atualizar a lista, onde os pedidos recém-criados aparecem.
    if (typeof window.carregarPedidos === 'function') {
      try {
        await window.carregarPedidos();
      } catch (err) {
        console.error('Erro ao recarregar pedidos após conversão', err);
      }
    }
  }

  // `BotaoAcao.bind` dá a trava de duplo clique e o carregando enquanto as
  // conversões acontecem.
  if (window.BotaoAcao?.bind) {
    window.BotaoAcao.bind(elementos.converter, converter);
  } else {
    elementos.converter?.addEventListener('click', converter);
  }

  await carregar();

  // ------------------------------------------------------------------
  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md)
  //
  // A seleção não é campo de formulário que a varredura genérica enxergue: as
  // caixas são recriadas a cada `renderizar()`, então o estado real vive no
  // `Set` acima.
  // ------------------------------------------------------------------
  window.EstadoTrabalho?.registrarConteudo?.(overlayId, {
    capturar: () => ({
      selecionados: Array.from(selecionados),
      busca: elementos.busca?.value || ''
    }),
    restaurar: (dados) => {
      if (!dados) return;
      selecionados.clear();
      (Array.isArray(dados.selecionados) ? dados.selecionados : []).forEach(id => {
        selecionados.add(String(id));
      });
      if (elementos.busca) elementos.busca.value = dados.busca || '';
      renderizar();
    }
  });

  if (typeof Modal?.signalReady === 'function') {
    Modal.signalReady(overlayId);
  }
  window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
})();
