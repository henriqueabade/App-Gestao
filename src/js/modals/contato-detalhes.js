// Detalhes do Contato: a ficha só leitura, as pessoas, o endereço, as
// atividades (o que foi feito com o contato) e a linha do tempo "de rede
// social" (origem 'contato'). O desenho é o do Detalhes do Cliente.
(async function(){
  const overlay = document.getElementById('detalhesContatoOverlay');
  if(!overlay) return;
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const close = () => Modal.close('detalhesContato');
  document.getElementById('voltarDetalhesContato')?.addEventListener('click', close);
  // Com um diálogo por cima (confirmação, editor), o Esc é dele.
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape' && !document.querySelector('dialog[open]')){ close(); document.removeEventListener('keydown', esc); }});

  const contato = window.contatoDetalhes;
  let nomeDoContato = contato?.nome || '';
  let pessoasDoContato = [];

  // Só leitura, mas o modal precisa saber QUAL contato mostrar depois de uma queda.
  window.EstadoTrabalho?.registrarConteudo?.('detalhesContato', {
    capturar: () => ({ __contexto: { contatoDetalhes: contato } }),
    restaurar: () => {}
  });

  const carregarUtil = (arquivo, global) => (window[global] ? Promise.resolve() : new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `../js/utils/${arquivo}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Não foi possível carregar ${arquivo}.`));
    document.head.appendChild(s);
  }));
  const pronto = () => window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesContato' }));
  try {
    await carregarUtil('contato-ficha.js', 'ContatoFicha');
  } catch (err) {
    console.error(err);
    pronto();
    showToast('Não foi possível abrir o contato.', 'error');
    return;
  }
  const F = window.ContatoFicha;
  const { activateTab } = F.ligarAbas(overlay);

  if (contato?.id) {
    const titulo = document.getElementById('contatoDetalhesTitulo');
    if (titulo) titulo.textContent = `Detalhes – ${contato.nome || ''}`;
    try {
      const res = await fetchApi(`/api/contatos/${contato.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
      // Aberta pelo sino, a ficha chega só com o id: o nome vem daqui.
      nomeDoContato = data.contato?.nome || nomeDoContato;
      if (titulo) titulo.textContent = `Detalhes – ${nomeDoContato}`;
      F.preencherDados(data.contato);
      await F.ligarEndereco(data.contato?.endereco || null);
      pessoasDoContato = data.pessoas || [];
      F.renderPessoas(document.getElementById('pessoasTabela'), pessoasDoContato, null);
    } catch (err) {
      console.error('Erro ao carregar detalhes do contato', err);
      showToast(err.message || 'Erro ao carregar o contato', 'error');
    } finally {
      pronto();
    }
  } else {
    pronto();
  }

  // Só leitura: a linha do tempo e as atividades são os lugares em que se escreve.
  const warn = e => {
    if(e.target.closest?.('[data-historico-social], [data-editavel-na-ficha]')) return;
    if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){
      e.preventDefault();
      e.target.blur();
      showToast('Não é possível editar aqui. Use o botão Editar.', 'error');
    }
  };
  overlay.addEventListener('mousedown', warn, true);
  overlay.addEventListener('focusin', warn);
  overlay.querySelectorAll('input, textarea').forEach(el => { el.readOnly = true; });
  addCopyButtons();
  document.getElementById('copyEndEndereco')?.addEventListener('click', async () => {
    const v = id => document.getElementById(id)?.value.trim() || '';
    const texto = `${v('endRua')} ${v('endNumero')}${v('endComplemento') ? ', ' + v('endComplemento') : ''}, ${v('endBairro')}, ${v('endCidade')}/${v('endEstado')}, ${v('endPais')} - ${v('endCep')}`;
    try { await navigator.clipboard.writeText(texto); showToast('Endereço copiado!', 'success'); } catch { showToast('Erro ao copiar', 'error'); }
  });

  function addCopyButtons(){
    overlay.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea').forEach(field => {
      const wrapper = document.createElement('div');
      wrapper.className = 'relative';
      field.parentNode.insertBefore(wrapper, field);
      wrapper.appendChild(field);
      field.classList.add('pr-10');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-white';
      btn.innerHTML = '<i class="fas fa-copy"></i>';
      btn.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        try { await navigator.clipboard.writeText(field.value || ''); showToast('Dado copiado!', 'success'); } catch { showToast('Erro ao copiar', 'error'); }
      });
      wrapper.appendChild(btn);
    });
  }

  // ------------------------------------------------------------------
  // Linha do tempo (src/js/utils/historico-social.js), origem 'contato'.
  // ------------------------------------------------------------------
  const EVENTO_CONTATO = {
    criacao: { rotulo: 'Cadastro', tom: 'sucesso' },
    campo: { rotulo: 'Edição', tom: 'neutro' },
    pessoa: { rotulo: 'Pessoa', tom: 'info' },
    interacao: { rotulo: 'Atividade', tom: 'info' }
  };
  const ACAO_CONTATO = { criou: 'Criou', alterou: 'Alterou', excluiu: 'Excluiu' };
  const cru = v => (v === null || v === undefined || String(v).trim() === '' ? null : String(v));
  const lerDetalhe = bruto => {
    if (!bruto) return null;
    if (typeof bruto === 'object') return bruto;
    try { return JSON.parse(bruto); } catch (_) { return null; }
  };
  function descreverEventoContato(h) {
    const meta = EVENTO_CONTATO[h.tipo] || { rotulo: h.tipo, tom: 'neutro' };
    const detalhe = lerDetalhe(h.detalhe);
    const rotuloCampo = detalhe?.rotulo || null;
    return {
      etiqueta: meta.rotulo, tom: meta.tom,
      acao: ACAO_CONTATO[h.acao] || h.acao,
      titulo: cru(h.entidade),
      campo: rotuloCampo && rotuloCampo !== h.entidade ? rotuloCampo : null,
      antes: cru(h.valor_anterior), depois: cru(h.valor_novo), riscado: h.acao === 'excluiu',
      retrato: Array.isArray(detalhe?.campos) ? detalhe.campos : [],
      pendencias: Array.isArray(detalhe?.pendencias) ? detalhe.pendencias : [],
      nota: cru(h.observacao)
    };
  }
  // "'" cita o que é ligado ao contato (GET /api/contatos/:id/citaveis): as
  // pessoas e as atividades abrem aqui mesmo, na aba delas; documentos,
  // contas e arquivos abrem na Contabilidade.
  async function objetosDoContato(busca) {
    const res = await fetchApi(`/api/contatos/${contato.id}/citaveis?busca=${encodeURIComponent(busca || '')}`);
    const json = await res.json().catch(() => ({}));
    return res.ok && Array.isArray(json.itens) ? json.itens : [];
  }
  // O item citado pisca: linha de tabela ganha fundo dourado nas células (o
  // contorno numa <tr> quase não aparece); o cartão da atividade, contorno.
  const piscar = el => {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const alvos = el.tagName === 'TR' ? [...el.children] : [el];
    for (const a of alvos) {
      if (el.tagName === 'TR') a.style.background = 'rgba(182, 160, 62, 0.22)';
      else { a.style.outline = '2px solid var(--color-primary)'; a.style.outlineOffset = '2px'; }
    }
    setTimeout(() => alvos.forEach(a => { a.style.background = ''; a.style.outline = ''; a.style.outlineOffset = ''; }), 2600);
  };
  async function abrirObjetoDoContato(objeto) {
    if (objeto.tipo === 'pessoa') {
      activateTab(document.getElementById('tab-pessoas'), { setFocus: false });
      const i = pessoasDoContato.findIndex(p => String(p.id) === String(objeto.id));
      if (i < 0) { showToast('Esta pessoa não está mais no contato.', 'info'); return; }
      piscar(document.getElementById('pessoasTabela')?.children[i]);
      return;
    }
    if (objeto.tipo === 'interacao') {
      activateTab(document.getElementById('tab-atividades'), { setFocus: false });
      await montarAtividades();
      const item = document.querySelector(`#contatoAtividades [data-atividade-id="${CSS.escape(String(objeto.id))}"]`);
      if (!item) { showToast('Esta atividade não existe mais.', 'info'); return; }
      piscar(item);
      return;
    }
    // Documento, conta, arquivo…: moram na Contabilidade (é lá que abrem).
    close();
    await window.loadPage?.('contabilidade');
    if (document.getElementById('content')?.dataset.activePage !== 'contabilidade' || typeof window.ContabilidadeAbrirObjeto !== 'function') {
      showToast('Você não tem acesso à Contabilidade.', 'error');
      return;
    }
    window.ContabilidadeAbrirObjeto(objeto);
  }

  let linhaDoTempo = null;
  function montarHistorico(foco = null) {
    const alvo = document.getElementById('contatoHistorico');
    if (!alvo || !contato?.id || !window.HistoricoSocial) return;
    if (linhaDoTempo) { if (foco) linhaDoTempo.focar(foco); return; }
    linhaDoTempo = window.HistoricoSocial.montar(alvo, {
      origem: 'contato', registroId: contato.id, descrever: descreverEventoContato, foco,
      objetos: objetosDoContato, aoAbrirObjeto: abrirObjetoDoContato,
      textos: {
        placeholder: "Escreva uma observação para todos que acompanham este contato… (@ menciona alguém · ' cita uma pessoa, atividade, documento ou conta dele · Ctrl+Enter publica)",
        citarObjetos: 'Citar algo ligado a este contato — abre ao clicar'
      }
    });
  }
  const abaHistorico = document.getElementById('tab-historico');
  abaHistorico?.addEventListener('click', () => montarHistorico());

  // ------------------------------------------------------------------
  // Atividades: o que foi FEITO com o contato (contato_interacoes), com o
  // mesmo formulário de Clientes (src/js/utils/tarefas-ui.js desenha).
  // ------------------------------------------------------------------
  const TIPOS_ATIVIDADE = [
    ['Ligação', 'fa-phone', '#7dd3fc'], ['WhatsApp', 'fa-comment-dots', '#86efac'], ['E-mail', 'fa-envelope', '#c4a7ff'],
    ['Reunião', 'fa-users', '#fdba74'], ['Visita', 'fa-location-dot', '#f9a8d4'], ['Proposta', 'fa-file-signature', '#d4c169'],
    ['Nota', 'fa-note-sticky', '#cbd5e1'], ['Atividade realizada', 'fa-circle-check', '#4ade80']
  ];
  const corDoTipo = tipo => (TIPOS_ATIVIDADE.find(t => t[0] === tipo) || [])[2] || '#cbd5e1';
  const iconeDoTipo = tipo => (TIPOS_ATIVIDADE.find(t => t[0] === tipo) || [])[1] || 'fa-circle-check';
  const podeRegistrar = () => window.Permissoes?.pode?.('ctt.interaction.add') !== false;
  let atividadesMontadas = false;
  const paraCampoLocal = iso => {
    const d = iso ? new Date(iso) : new Date();
    const dois = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
  };
  const quandoLegivel = iso => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  async function pintarAtividades(editando = null) {
    const alvo = document.getElementById('contatoAtividades');
    const T = window.TarefasUI;
    if (!alvo || !T || !contato?.id) return;
    const { h, icone } = T;
    let dados;
    try {
      const res = await fetchApi(`/api/contatos/${contato.id}/interacoes`);
      dados = await res.json();
      if (!res.ok) throw new Error(dados.error || `Erro ${res.status}`);
    } catch (err) {
      alvo.replaceChildren(h('p', { class: 'tui-dica tui-dica--aviso', text: `Não foi possível carregar as atividades: ${err.message}` }));
      return;
    }
    if (dados.sql_pendente) {
      alvo.replaceChildren(h('div', { class: 'tui-aviso-sql' }, icone('fa-database'), h('span', { text: 'As atividades aparecem aqui depois que sql/contatos_fornecedores.sql for executado.' })));
      return;
    }
    const atividades = dados.atividades || [];
    let formularioAberto = Boolean(editando);

    const topo = h('div', { class: 'tui-ficha__topo' },
      h('div', { class: 'tui-ficha__titulo' }, icone('fa-clock-rotate-left'), h('strong', { text: 'Atividades realizadas' }),
        atividades.length ? T.chip(String(atividades.length), { classe: 'tui-chip--info' }) : null),
      podeRegistrar() ? h('button', { type: 'button', class: 'btn-secondary tui-botao cat__registrar', on: { click: () => { formularioAberto = !formularioAberto; formulario.hidden = !formularioAberto; if (formularioAberto) resumo.focus(); } } }, icone('fa-plus'), ' Registrar atividade') : null);

    let tipo = editando?.tipo || 'Ligação';
    const chips = h('div', { class: 'cat__tipos', attrs: { role: 'radiogroup', 'aria-label': 'Tipo' } });
    const pintarTipos = () => chips.replaceChildren(...TIPOS_ATIVIDADE.filter(([t]) => t !== 'Atividade realizada' || tipo === t).map(([t, ic, cor]) => {
      const b = h('button', { type: 'button', class: 'cat__tipo', attrs: { role: 'radio', 'aria-checked': String(tipo === t) }, on: { click: () => { tipo = t; pintarTipos(); } } }, icone(ic), h('span', { text: t }));
      b.style.setProperty('--cat-cor', cor);
      return b;
    }));
    pintarTipos();
    const quando = h('input', { class: 'tui-campo', type: 'datetime-local', value: paraCampoLocal(editando?.data), max: paraCampoLocal() });
    const pessoa = h('select', { class: 'tui-campo' }, h('option', { value: '', text: 'Com quem? (opcional)' }),
      pessoasDoContato.map(p => h('option', { value: p.id, text: [p.nome, p.cargo].filter(Boolean).join(' — '), selected: Number(editando?.pessoa_id) === Number(p.id) })));
    const resumo = h('input', { class: 'tui-campo', type: 'text', maxLength: 300, value: editando?.resumo || '', placeholder: 'Resumo em uma linha — ex.: Pedi orçamento do MDF' });
    const detalhe = h('textarea', { class: 'tui-campo', rows: 3, maxLength: 5000, value: editando?.detalhe || '', placeholder: 'Detalhes (opcional)' });
    const duracao = h('input', { class: 'tui-campo tui-campo--curto', type: 'number', min: 0, max: 1440, value: editando?.duracao_min ?? '', placeholder: 'min' });
    const salvar = h('button', { type: 'button', class: 'btn-primary tui-botao' }, icone('fa-check'), editando ? ' Salvar' : ' Registrar');
    const cancelar = h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Cancelar', on: { click: () => pintarAtividades() } });
    salvar.addEventListener('click', async () => {
      if (!resumo.value.trim()) { resumo.focus(); window.showToast?.('Descreva a atividade em uma linha.', 'error'); return; }
      if (quando.value && new Date(quando.value).getTime() > Date.now() + 60000) {
        quando.focus();
        window.showToast?.('A atividade registra o que já aconteceu: escolha uma data e hora até agora.', 'error');
        return;
      }
      const corpo = {
        tipo, resumo: resumo.value.trim(), detalhe: detalhe.value.trim() || null,
        pessoa_id: pessoa.value ? Number(pessoa.value) : null,
        duracao_min: duracao.value === '' ? null : Number(duracao.value),
        data: quando.value ? new Date(quando.value).toISOString() : new Date().toISOString()
      };
      try {
        const res = await fetchApi(editando ? `/api/contatos/${contato.id}/interacoes/${editando.id}` : `/api/contatos/${contato.id}/interacoes`, {
          method: editando ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Erro ${res.status}`);
        window.showToast?.(editando ? 'Atividade salva.' : 'Atividade registrada.', 'success');
        linhaDoTempo?.recarregar?.();
        await pintarAtividades();
      } catch (err) {
        window.showToast?.(err.message, 'error');
      }
    });
    const formulario = h('div', { class: 'cat__formulario', hidden: !formularioAberto },
      h('p', { class: 'cat__explica' }, icone('fa-circle-check'), h('span', {},
        'Registre o que ', h('strong', { text: 'já aconteceu' }), ' — a ligação feita, a visita, o e-mail enviado. A atividade entra como ',
        h('strong', { text: 'concluída' }), ', com data e hora até agora.')),
      chips,
      h('div', { class: 'cat__linha' }, h('label', { class: 'cat__campo' }, h('span', { class: 'tui-rotulo', text: 'Quando aconteceu' }), quando), h('label', { class: 'cat__campo' }, h('span', { class: 'tui-rotulo', text: 'Com quem' }), pessoa), h('label', { class: 'cat__campo cat__campo--curto' }, h('span', { class: 'tui-rotulo', text: 'Duração' }), duracao)),
      resumo, detalhe,
      h('div', { class: 'cat__rodape' }, h('span'), h('div', { class: 'tui-rodape__lado' }, cancelar, salvar)));

    const lista = h('div', { class: 'cat__lista' });
    if (!atividades.length) lista.append(h('p', { class: 'tui-dica', text: 'Nenhuma atividade registrada. Registre ligações, visitas, reuniões e orçamentos pedidos a este contato.' }));
    for (const a of atividades) {
      const acoes = podeRegistrar() ? h('div', { class: 'cat__acoes' },
        h('button', { type: 'button', class: 'tui-icone-botao', title: 'Editar', on: { click: () => pintarAtividades(a) } }, icone('fa-pen')),
        h('button', { type: 'button', class: 'tui-icone-botao', title: 'Excluir', on: { click: async () => {
          const ok = await window.DialogPadrao?.confirm({ title: 'Excluir esta atividade?', tom: 'erro', message: `"${a.resumo}" sai da lista de atividades.`, nota: 'A linha do tempo guarda o que era.', confirmText: 'Excluir', confirmVariant: 'danger' });
          if (!ok) return;
          try {
            const res = await fetchApi(`/api/contatos/${contato.id}/interacoes/${a.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
            window.showToast?.('Atividade excluída.', 'success');
            linhaDoTempo?.recarregar?.();
            pintarAtividades();
          } catch (err) { window.showToast?.(err.message, 'error'); }
        } } }, icone('fa-trash-can'))) : null;
      const item = h('article', { class: 'cat__item', attrs: { 'data-atividade-id': String(a.id) } },
        h('span', { class: 'cat__icone' }, icone(iconeDoTipo(a.tipo))),
        h('div', { class: 'cat__conteudo' },
          h('div', { class: 'cat__meta' }, h('strong', { text: a.tipo }), T.chip('Concluída', { icone: 'fa-circle-check', classe: 'tui-chip--sucesso' }), h('span', { text: quandoLegivel(a.data) }), a.usuario ? h('span', { text: a.usuario }) : null),
          h('p', { class: 'cat__resumo', text: a.resumo }),
          a.detalhe ? h('p', { class: 'cat__detalhe', text: a.detalhe }) : null,
          h('div', { class: 'cat__chips' },
            a.pessoa ? T.chip(a.pessoa, { icone: 'fa-user' }) : null,
            a.duracao_min ? T.chip(`${a.duracao_min} min`, { icone: 'fa-hourglass-half' }) : null)),
        acoes);
      item.style.setProperty('--cat-cor', corDoTipo(a.tipo));
      lista.append(item);
    }
    alvo.replaceChildren(h('div', { class: 'tui-ficha tui-escopo' }, topo, formulario, lista));
    if (editando) resumo.focus();
  }

  // Devolve a promessa da pintura (o "'" espera a lista para destacar a atividade citada).
  let pinturaDasAtividades = Promise.resolve();
  function montarAtividades() {
    if (atividadesMontadas || !contato?.id || !window.TarefasUI) return pinturaDasAtividades;
    atividadesMontadas = true;
    pinturaDasAtividades = pintarAtividades();
    return pinturaDasAtividades;
  }
  document.getElementById('tab-atividades')?.addEventListener('click', montarAtividades);
  const pedidoDeFoco = window.historicoSocialFoco;
  if (abaHistorico && pedidoDeFoco?.origem === 'contato' && String(pedidoDeFoco.registroId) === String(contato?.id)) {
    window.historicoSocialFoco = null;
    activateTab(abaHistorico, { setFocus: false });
    montarHistorico(pedidoDeFoco);
  }

  document.getElementById('editarDetalhesContato')?.addEventListener('click', () => {
    if (!contato) return;
    Modal.close('detalhesContato');
    setTimeout(() => { window.abrirEditarContato?.({ ...contato, nome: nomeDoContato }); }, 0);
  });
})();
