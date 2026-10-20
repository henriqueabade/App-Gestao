/**
 * Excluir em Lote (20/10/2026, pedido do dono) — Prospecções › Ações Rápidas,
 * só o Sup Admin.
 *
 * Tabela simples com caixa de seleção na primeira coluna e filtros simples
 * (buscar, etapa, responsável). "Excluir" pede o motivo (obrigatório, como na
 * lixeira da linha) e confirma na caixa de diálogo padrão digitando EXCLUIR.
 * O servidor (POST /api/prospeccoes/excluir-lote) confere tudo de novo e
 * aplica a cada uma as regras da lixeira: a que virou cliente ou tem orçamento
 * fica, e volta com o motivo — as outras são apagadas.
 */
(async () => {
  const overlayId = 'excluirLoteProspeccoes';
  const overlay = document.getElementById(`${overlayId}Overlay`);
  if (!overlay) return;

  const PALAVRA = 'EXCLUIR';
  const el = id => document.getElementById(id);
  const elementos = {
    tabela: el('excluirLoteProspeccoesTabela'),
    wrapper: el('excluirLoteProspeccoesTabelaWrapper'),
    carregando: el('excluirLoteProspeccoesCarregando'),
    vazio: el('excluirLoteProspeccoesVazio'),
    busca: el('buscaExcluirLoteProspeccoes'),
    etapa: el('etapaExcluirLoteProspeccoes'),
    responsavel: el('responsavelExcluirLoteProspeccoes'),
    todas: el('selecionarTodasExcluirLoteProspeccoes'),
    resumo: el('resumoExcluirLoteProspeccoes'),
    motivo: el('motivoExcluirLoteProspeccoes'),
    excluir: el('confirmarExcluirLoteProspeccoes'),
    voltar: el('voltarExcluirLoteProspeccoes'),
    cancelar: el('cancelarExcluirLoteProspeccoes')
  };

  async function fetchApi(path, options) {
    const aud = window.AuditoriaAcao?.vincular();
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return (aud?.fetch || fetch)(`${baseUrl}${path}`, options);
  }

  // Enquanto o lote é excluído o modal não fecha (Esc, Voltar): o véu cobre a
  // tela, mas o teclado ainda alcança os botões.
  let excluindo = false;
  const close = () => { if (!excluindo) Modal.close(overlayId); };
  /** Quantas vão em cada pedido ao servidor — o andamento do véu anda de parte em parte. */
  const PARTE = 10;
  /** O texto do véu (BotaoAcao.comCarregamento) muda a cada parte. */
  const avisarAndamento = texto => {
    const alvo = document.querySelector('#botaoAcaoVeu .botaoAcaoVeu-texto');
    if (alvo) alvo.textContent = texto;
  };
  // Fechar: só por botão ou Esc. Clicar fora NÃO fecha (docs/padroes-de-interface.md).
  elementos.voltar?.addEventListener('click', close);
  elementos.cancelar?.addEventListener('click', close);
  function aoTeclar(evento) {
    if (evento.key !== 'Escape' || excluindo || document.querySelector('dialog[data-dialog-padrao][open]')) return;
    document.removeEventListener('keydown', aoTeclar);
    close();
  }
  document.addEventListener('keydown', aoTeclar);

  const normalizar = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const digitos = v => String(v ?? '').replace(/\D/g, '');
  const slugEtapa = e => normalizar(e).replace(/[^a-z]/g, '');
  const nomeDe = p => p?.nome_fantasia || p?.razao_social || `Prospecção #${p?.id}`;
  const dia = iso => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR') : '—';
  };

  let todas = [];                  // a lista inteira (ativas e arquivadas)
  const selecionadas = new Set();  // ids marcados (texto)

  /** Convertida em cliente não se apaga (a mesma regra da lixeira da linha). */
  const podeExcluir = p => !p?.cliente_id;

  function filtradas() {
    const termo = normalizar(elementos.busca?.value);
    const termoDigitos = digitos(elementos.busca?.value);
    const etapa = elementos.etapa?.value || '';
    const responsavel = elementos.responsavel?.value || '';
    return todas.filter(p => {
      if (etapa && p.etapa !== etapa) return false;
      if (responsavel && String(p.responsavel_id ?? '') !== responsavel) return false;
      if (!termo) return true;
      return normalizar(p.nome_fantasia).includes(termo) || normalizar(p.razao_social).includes(termo)
        || (termoDigitos.length >= 3 && digitos(p.cnpj).includes(termoDigitos));
    });
  }

  function atualizarResumo() {
    const n = selecionadas.size;
    if (elementos.resumo) {
      elementos.resumo.textContent = n === 0 ? 'Nenhuma selecionada' : `${n} selecionada${n > 1 ? 's' : ''}`;
      elementos.resumo.className = `${n ? 'badge-danger' : 'badge-info'} px-3 py-1 rounded-full text-xs font-medium`;
    }
    const visiveis = filtradas().filter(podeExcluir);
    const marcadas = visiveis.filter(p => selecionadas.has(String(p.id))).length;
    if (elementos.todas) {
      elementos.todas.checked = visiveis.length > 0 && marcadas === visiveis.length;
      elementos.todas.indeterminate = marcadas > 0 && marcadas < visiveis.length;
      elementos.todas.disabled = visiveis.length === 0;
    }
  }

  function celula(texto, classe = 'py-3 px-4 text-white') {
    const td = document.createElement('td');
    td.className = classe;
    td.textContent = texto;
    return td;
  }

  /** Tudo por textContent: nome, CNPJ e responsável são texto livre do banco. */
  function pintar() {
    const lista = filtradas();
    elementos.tabela.replaceChildren(...lista.map(p => {
      const tr = document.createElement('tr');
      const id = String(p.id);
      const livre = podeExcluir(p);
      const tdCaixa = document.createElement('td');
      tdCaixa.className = 'py-3 px-4';
      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.style.accentColor = 'var(--color-primary)';
      caixa.style.width = '1rem';
      caixa.style.height = '1rem';
      caixa.value = id;
      caixa.checked = livre && selecionadas.has(id);
      caixa.disabled = !livre;
      caixa.setAttribute('aria-label', `Selecionar ${nomeDe(p)}`);
      if (!livre) {
        caixa.title = 'Virou cliente: não pode ser excluída';
        caixa.style.opacity = '0.35';
        caixa.style.cursor = 'not-allowed';
      }
      caixa.addEventListener('change', () => {
        if (caixa.checked) selecionadas.add(id); else selecionadas.delete(id);
        atualizarResumo();
      });
      tdCaixa.appendChild(caixa);

      const tdEmpresa = document.createElement('td');
      tdEmpresa.className = 'py-3 px-4 text-white';
      const nome = document.createElement('div');
      nome.className = 'font-medium';
      nome.textContent = nomeDe(p);
      tdEmpresa.appendChild(nome);
      if (p.razao_social && p.razao_social !== p.nome_fantasia) {
        const razao = document.createElement('div');
        razao.className = 'text-xs text-gray-400';
        razao.textContent = p.razao_social;
        tdEmpresa.appendChild(razao);
      }
      if (!livre) {
        const tag = document.createElement('span');
        tag.className = 'badge-success px-2 py-0.5 rounded-full text-xs font-medium mt-1 inline-block';
        tag.textContent = 'Virou cliente';
        tdEmpresa.appendChild(tag);
      }

      const tdEtapa = document.createElement('td');
      tdEtapa.className = 'py-3 px-4';
      const etapa = document.createElement('span');
      etapa.className = `badge-etapa badge-etapa--${slugEtapa(p.etapa)} px-3 py-1 rounded-full text-xs font-medium`;
      etapa.textContent = p.etapa || '—';
      tdEtapa.appendChild(etapa);

      tr.append(tdCaixa, tdEmpresa, celula(p.cnpj || '—', 'py-3 px-4 text-gray-300 whitespace-nowrap'), tdEtapa,
        celula(p.responsavel || '—', 'py-3 px-4 text-gray-300'), celula(dia(p.atualizado_em), 'py-3 px-4 text-gray-300 whitespace-nowrap'));
      return tr;
    }));
    elementos.wrapper?.classList.toggle('hidden', !lista.length);
    elementos.vazio?.classList.toggle('hidden', lista.length > 0);
    atualizarResumo();
  }

  /** Os selects dos filtros, com o que existe na lista (a etapa na ordem do funil). */
  function montarFiltros(etapasDoFunil) {
    const presentes = new Set(todas.map(p => p.etapa).filter(Boolean));
    const etapas = [...(etapasDoFunil || []).filter(e => presentes.has(e)), ...[...presentes].filter(e => !(etapasDoFunil || []).includes(e))];
    elementos.etapa?.replaceChildren(new Option('Todas', ''), ...etapas.map(e => new Option(e, e)));
    const responsaveis = new Map();
    for (const p of todas) if (p.responsavel_id != null) responsaveis.set(String(p.responsavel_id), p.responsavel || `Usuário #${p.responsavel_id}`);
    const ordenados = [...responsaveis.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
    elementos.responsavel?.replaceChildren(new Option('Todos', ''), ...ordenados.map(([id, nome]) => new Option(nome, id)));
  }

  async function carregar() {
    // Arquivadas também (Perdido e convertidas): o Sup Admin limpa o que quiser;
    // a convertida aparece travada.
    const resp = await fetchApi('/api/prospeccoes/lista?incluirArquivadas=1');
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(corpo?.error || 'Não foi possível ler as prospecções.');
    todas = Array.isArray(corpo?.itens) ? corpo.itens : [];
    for (const id of [...selecionadas]) if (!todas.some(p => String(p.id) === id && podeExcluir(p))) selecionadas.delete(id);
    montarFiltros(Array.isArray(corpo?.etapas) ? corpo.etapas : window.PROSPECCOES_ETAPAS);
    pintar();
  }

  elementos.busca?.addEventListener('input', pintar);
  elementos.etapa?.addEventListener('change', pintar);
  elementos.responsavel?.addEventListener('change', pintar);
  elementos.todas?.addEventListener('change', () => {
    for (const p of filtradas().filter(podeExcluir)) {
      if (elementos.todas.checked) selecionadas.add(String(p.id)); else selecionadas.delete(String(p.id));
    }
    pintar();
  });

  /** As que vão ser apagadas, para a caixa de confirmação (até 8 nomes). */
  function itensDaConfirmacao(ids) {
    const nomes = ids.map(id => todas.find(p => String(p.id) === id)).filter(Boolean).map(p => ({ rotulo: nomeDe(p), valor: p.etapa || '' }));
    const extras = nomes.length > 8 ? [{ rotulo: `+ ${nomes.length - 8} prospecç${nomes.length - 8 > 1 ? 'ões' : 'ão'}`, valor: '' }] : [];
    return [...nomes.slice(0, 8), ...extras];
  }

  async function excluir() {
    const ids = [...selecionadas];
    if (!ids.length) {
      showToast('Marque ao menos uma prospecção.', 'error');
      return;
    }
    const motivo = (elementos.motivo?.value || '').trim();
    if (!motivo) {
      showToast('Escreva o motivo da exclusão.', 'error');
      elementos.motivo?.focus();
      return;
    }
    const n = ids.length;
    const confirmado = await window.DialogPadrao?.confirm({
      title: `Excluir ${n} prospecç${n > 1 ? 'ões' : 'ão'}?`,
      tom: 'erro',
      icone: 'fa-trash-can',
      secoes: [{ titulo: n > 1 ? 'Serão excluídas' : 'Será excluída', icone: 'fa-briefcase', itens: itensDaConfirmacao(ids) }],
      alerta: 'Contatos, interações, notas, campanhas e o histórico do funil de cada uma são removidos junto. Esta ação não pode ser desfeita.',
      nota: `Motivo: ${motivo} — vai no aviso do responsável e de quem criou cada uma.`,
      confirmVariant: 'danger',
      confirmText: 'Confirmar',
      cancelText: 'Voltar',
      exigirTexto: PALAVRA
    });
    if (!confirmado) return;

    // Véu na tela inteira enquanto exclui (20/10/2026, pedido do dono): nada de
    // sair do modal, trocar de módulo ou clicar em outra coisa no meio. Vai em
    // partes de PARTE, com o andamento no texto; o Esc e os Voltar não fecham.
    const resultados = [];
    let falha = null;
    const tarefa = async () => {
      for (let i = 0; i < ids.length; i += PARTE) {
        avisarAndamento(`Excluindo prospecções… ${Math.min(i, ids.length)} de ${ids.length}`);
        const parte = ids.slice(i, i + PARTE);
        try {
          const resp = await fetchApi('/api/prospeccoes/excluir-lote', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: parte.map(Number), motivo, confirmacao: PALAVRA })
          });
          const corpo = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(corpo?.error || 'Erro ao excluir as prospecções.');
          resultados.push(...(Array.isArray(corpo.resultados) ? corpo.resultados : []));
        } catch (err) {
          // Para aqui: as das partes anteriores já foram; as que faltam, não.
          falha = err;
          for (const id of ids.slice(i)) resultados.push({ id: Number(id), excluida: false, erro: `Não tentada: ${err.message || 'erro ao excluir'}` });
          break;
        }
      }
      avisarAndamento('Atualizando a lista…');
      // A grade da tela atrás também perde as apagadas.
      const recarregar = window.ProspeccoesModulo?.carregar;
      if (recarregar) await recarregar(true).catch(() => null);
      else window.dispatchEvent(new Event('prospeccaoEditada'));
    };
    excluindo = true;
    try {
      if (window.BotaoAcao?.comCarregamento) await window.BotaoAcao.comCarregamento(tarefa, `Excluindo prospecções… 0 de ${ids.length}`);
      else await tarefa();
    } finally {
      excluindo = false;
    }

    const excluidas = resultados.filter(r => r.excluida).length;
    const recusadas = resultados.filter(r => !r.excluida);
    for (const r of resultados) if (r.excluida) selecionadas.delete(String(r.id));
    if (falha && !excluidas) showToast(falha.message || 'Erro ao excluir as prospecções.', 'error');

    if (!recusadas.length) {
      showToast(`${excluidas} prospecç${excluidas > 1 ? 'ões excluídas' : 'ão excluída'} com sucesso!`, 'success');
      close();
      return;
    }
    const corpo = { excluidas };
    // Algumas ficaram (virou cliente, tem orçamento…): diz quais e por quê, e a
    // tabela continua aberta com elas.
    await window.DialogPadrao?.info({
      tom: 'aviso',
      title: corpo.excluidas ? `${corpo.excluidas} excluída${corpo.excluidas > 1 ? 's' : ''}, ${recusadas.length} não` : 'Nenhuma foi excluída',
      secoes: [{
        titulo: 'Não excluídas', icone: 'fa-circle-exclamation',
        itens: recusadas.map(r => ({ rotulo: nomeDe(todas.find(p => String(p.id) === String(r.id)) || { id: r.id }), detalhe: r.erro }))
      }],
      okText: 'Entendi'
    });
    try { await carregar(); } catch (_) { /* a mensagem de erro já apareceu na carga */ }
  }

  if (window.BotaoAcao?.bind) window.BotaoAcao.bind(elementos.excluir, excluir);
  else elementos.excluir?.addEventListener('click', excluir);

  try {
    await carregar();
  } catch (err) {
    elementos.vazio?.classList.remove('hidden');
    const p = elementos.vazio?.querySelector('p');
    if (p) p.textContent = err.message || 'Não foi possível ler as prospecções.';
  } finally {
    elementos.carregando?.classList.add('hidden');
    // Revela o modal (Modal.openModuleModal espera este aviso com o overlayId).
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));
  }
})();
