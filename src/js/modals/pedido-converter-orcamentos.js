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
        'Eles passam para Aprovado e viram pedidos em Produção.',
      confirmText: 'Sim, converter',
      cancelText: 'Não'
    });
    if (!confirmado) return;

    const convertidos = [];
    const falhas = [];

    // Um a um, de propósito: cada conversão mexe em estoque e a falha de uma
    // não pode impedir as outras. O que falhou é dito com nome e motivo.
    for (const orcamento of escolhidos) {
      try {
        const resp = await fetchApi(`/api/orcamentos/${orcamento.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ situacao: 'Aprovado' })
        });
        const corpo = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(corpo?.error || `Falha ao converter (HTTP ${resp.status})`);
        }
        if (corpo?.convertido === false && corpo?.convertErro) {
          throw new Error(corpo.convertErro);
        }
        convertidos.push(orcamento);
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

    if (falhas.length) {
      await window.DialogPadrao?.info?.({
        title: convertidos.length ? 'Conversão parcial' : 'Não foi possível converter',
        message: falhas
          .map(f => `• ${f.orcamento.numero || f.orcamento.id}: ${f.motivo}`)
          .join('\n')
      });
    }

    // Fecha e devolve o usuário à lista de pedidos já atualizada — é lá que os
    // pedidos recém-criados aparecem.
    close();
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
