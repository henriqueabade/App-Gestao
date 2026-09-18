(async function(){
  const overlay = document.getElementById('detalhesClienteOverlay');
  if(!overlay) return;
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const close = () => Modal.close('detalhesCliente');
  const voltar = document.getElementById('voltarDetalhesCliente');
  if(voltar) voltar.addEventListener('click', close);
  // Com um diálogo por cima (editor de tarefa, confirmação), o Esc é dele.
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape' && !document.querySelector('dialog[open]')){ close(); document.removeEventListener('keydown', esc); }});

  const cliente = window.clienteDetalhes;
  let nomeDoCliente = cliente?.nome_fantasia || '';
  let contatosDoCliente = [];

  // Preservação do trabalho (ver docs/restauracao-de-trabalho.md).
  // Aqui não há nada a digitar — a tela é só leitura —, mas o modal precisa
  // saber QUAL cliente mostrar. Sem devolver `window.clienteDetalhes`, ele
  // reabria em branco depois de uma queda.
  window.EstadoTrabalho?.registrarConteudo?.('detalhesCliente', {
    capturar: () => ({ __contexto: { clienteDetalhes: cliente } }),
    restaurar: () => {}
  });

  if(!window.geoService){
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/geo-service.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

async function carregarContatos(idCliente) {
  try {
    if (!idCliente) return [];

    // ✅ Filtra diretamente pela query string permitida (sem operadores proibidos)
    const res = await fetchApi(`/api/contatos_cliente?id_cliente=${idCliente}`);
    if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Erro ao carregar contatos:', err);
    return [];
  }
}

  if(cliente){
    const titulo = document.getElementById('clienteDetalhesTitulo');
    if(titulo) titulo.textContent = `Detalhes – ${cliente.nome_fantasia || ''}`;
    try {
      const res = await fetchApi(`/api/clientes/${cliente.id}`);
      const data = await res.json();
      if(data && data.cliente){
        // Aberta pelo sino, a ficha chega só com o id: o nome vem daqui.
        if(titulo && data.cliente.nome_fantasia) titulo.textContent = `Detalhes – ${data.cliente.nome_fantasia}`;
        nomeDoCliente = data.cliente.nome_fantasia || nomeDoCliente;
        preencherDadosEmpresa(data.cliente);
        await preencherEnderecos(data.cliente);
        const contatos = await carregarContatos(cliente.id);
        contatosDoCliente = contatos;
        renderContatos(contatos);
        renderTransportadoras(await carregarTransportadoras(cliente.id));
        inicializarToggles(data.cliente);
        const notas = document.getElementById('clienteNotas');
        if(notas) notas.value = data.cliente.anotacoes || '';
      }
      await carregarOrdens(cliente.id);
    } catch(err){
      console.error('Erro ao carregar detalhes do cliente', err);
    } finally {
      window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesCliente' }));
    }
  } else {
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesCliente' }));
  }

  const tablist = overlay.querySelector('[role="tablist"]');
  const tabs = Array.from(overlay.querySelectorAll('[role="tab"]'));
  const panels = Array.from(overlay.querySelectorAll('[role="tabpanel"]'));

  function activateTab(targetTab, { setFocus = true } = {}) {
    tabs.forEach(tab => {
      tab.setAttribute('aria-selected', 'false');
      tab.setAttribute('tabindex', '-1');
      tab.classList.remove('tab-active');
      tab.classList.add('text-gray-400', 'border-transparent');
      tab.classList.remove('hover:text-white');
    });
    panels.forEach(panel => panel.classList.add('hidden'));
    targetTab.setAttribute('aria-selected', 'true');
    targetTab.setAttribute('tabindex', '0');
    targetTab.classList.add('tab-active');
    targetTab.classList.remove('text-gray-400', 'border-transparent');
    targetTab.classList.add('hover:text-white');
    const targetPanel = overlay.querySelector('#'+targetTab.getAttribute('aria-controls'));
    if(targetPanel) targetPanel.classList.remove('hidden');
    if(setFocus) targetTab.focus();
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', e => {
      e.preventDefault();
      activateTab(tab);
    });
  });

  if(tablist){
    tablist.addEventListener('keydown', e => {
      const currentIndex = tabs.findIndex(t => t === document.activeElement);
      let targetIndex;
      switch(e.key){
        case 'ArrowRight':
          e.preventDefault();
          targetIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
          activateTab(tabs[targetIndex]);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          targetIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
          activateTab(tabs[targetIndex]);
          break;
        case 'Home':
          e.preventDefault();
          activateTab(tabs[0]);
          break;
        case 'End':
          e.preventDefault();
          activateTab(tabs[tabs.length - 1]);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if(currentIndex >= 0) activateTab(tabs[currentIndex]);
          break;
      }
    });
  }

  activateTab(tabs[0], { setFocus: false });

  const warn = e => {
    // A linha do tempo e as atividades são os lugares da ficha em que se escreve.
    if(e.target.closest?.('[data-historico-social], [data-editavel-na-ficha]')) return;
    if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){
      e.preventDefault();
      e.target.blur();
      showToast('Não é possível editar aqui. Use o botão Editar.', 'error');
    }
  };
  overlay.addEventListener('mousedown', warn, true);
  overlay.addEventListener('focusin', warn);
  overlay.querySelectorAll('input, textarea').forEach(el => el.readOnly = true);
  addCopyButtons();
  setupAddressCopyButtons();

  // ------------------------------------------------------------------
  // Histórico do cliente — linha do tempo "de rede social"
  // (src/js/utils/historico-social.js). Montado na primeira vez que a aba
  // abre, ou já aberto quando o aviso do sino trouxe o usuário até aqui.
  // ------------------------------------------------------------------
  const EVENTO_CLIENTE = {
    criacao: { rotulo: 'Cadastro', tom: 'sucesso' },
    campo: { rotulo: 'Edição', tom: 'neutro' },
    contato: { rotulo: 'Contato', tom: 'info' },
    transportadora: { rotulo: 'Transportadora', tom: 'neutro' },
    conversao: { rotulo: 'Conversão', tom: 'sucesso' },
    tarefa: { rotulo: 'Tarefa', tom: 'aviso' },
    interacao: { rotulo: 'Atividade', tom: 'info' },
    orcamento: { rotulo: 'Orçamento', tom: 'aviso' }
  };
  const ACAO_CLIENTE = { criou: 'Criou', alterou: 'Alterou', excluiu: 'Excluiu', moveu: 'Moveu', converteu: 'Converteu', concluiu: 'Concluiu', reabriu: 'Reabriu', cancelou: 'Cancelou' };
  const cru = v => (v === null || v === undefined || String(v).trim() === '' ? null : String(v));
  const lerDetalhe = bruto => {
    if (!bruto) return null;
    if (typeof bruto === 'object') return bruto;
    try { return JSON.parse(bruto); } catch (_) { return null; }
  };
  function descreverEventoCliente(h) {
    const meta = EVENTO_CLIENTE[h.tipo] || { rotulo: h.tipo, tom: 'neutro' };
    const detalhe = lerDetalhe(h.detalhe);
    const rotuloCampo = detalhe?.rotulo || null;
    return {
      etiqueta: meta.rotulo, tom: meta.tom,
      acao: ACAO_CLIENTE[h.acao] || h.acao,
      titulo: cru(h.entidade),
      campo: rotuloCampo && rotuloCampo !== h.entidade ? rotuloCampo : null,
      antes: cru(h.valor_anterior), depois: cru(h.valor_novo), riscado: h.acao === 'excluiu',
      retrato: Array.isArray(detalhe?.campos) ? detalhe.campos : [],
      pendencias: Array.isArray(detalhe?.pendencias) ? detalhe.pendencias : [],
      nota: cru(h.observacao)
    };
  }
  let linhaDoTempo = null;
  function montarHistorico(foco = null) {
    const alvo = document.getElementById('clienteHistorico');
    if (!alvo || !cliente?.id || !window.HistoricoSocial) return;
    if (linhaDoTempo) { if (foco) linhaDoTempo.focar(foco); return; }
    linhaDoTempo = window.HistoricoSocial.montar(alvo, { origem: 'cliente', registroId: cliente.id, descrever: descreverEventoCliente, foco });
  }
  const abaHistorico = document.getElementById('tab-historico');
  abaHistorico?.addEventListener('click', () => montarHistorico());

  // ------------------------------------------------------------------
  // Atividades do cliente: o que foi FEITO (cliente_interacoes) e as
  // tarefas agendadas para ele (src/js/utils/tarefas-ui.js). Tarefa
  // concluída também vira atividade aqui.
  // ------------------------------------------------------------------
  const TIPOS_ATIVIDADE = [
    ['Ligação', 'fa-phone', '#7dd3fc'], ['WhatsApp', 'fa-comment-dots', '#86efac'], ['E-mail', 'fa-envelope', '#c4a7ff'],
    ['Reunião', 'fa-users', '#fdba74'], ['Visita', 'fa-location-dot', '#f9a8d4'], ['Proposta', 'fa-file-signature', '#d4c169'],
    ['Nota', 'fa-note-sticky', '#cbd5e1'], ['Atividade realizada', 'fa-circle-check', '#4ade80']
  ];
  const corDoTipo = tipo => (TIPOS_ATIVIDADE.find(t => t[0] === tipo) || [])[2] || '#cbd5e1';
  const iconeDoTipo = tipo => (TIPOS_ATIVIDADE.find(t => t[0] === tipo) || [])[1] || 'fa-circle-check';
  const podeRegistrar = () => window.Permissoes?.pode?.('cli.interaction.add') !== false;
  let atividadesMontadas = false;

  /** "2026-09-18T17:00:00Z" → "2026-09-18T14:00" (datetime-local, hora da máquina). */
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
    const alvo = document.getElementById('clienteAtividades');
    const T = window.TarefasUI;
    if (!alvo || !T || !cliente?.id) return;
    const { h, icone } = T;
    let dados;
    try {
      const res = await fetchApi(`/api/clientes/${cliente.id}/interacoes`);
      dados = await res.json();
      if (!res.ok) throw new Error(dados.error || `Erro ${res.status}`);
    } catch (err) {
      alvo.replaceChildren(h('p', { class: 'tui-dica tui-dica--aviso', text: `Não foi possível carregar as atividades: ${err.message}` }));
      return;
    }
    if (dados.sql_pendente) {
      alvo.replaceChildren(h('div', { class: 'tui-aviso-sql' }, icone('fa-database'), h('span', { text: 'As atividades do cliente aparecem aqui depois que o SQL de tarefas (sql/tarefas_calendario.sql) for executado.' })));
      return;
    }
    const atividades = dados.atividades || [];
    let formularioAberto = Boolean(editando);

    const topo = h('div', { class: 'tui-ficha__topo' },
      h('div', { class: 'tui-ficha__titulo' }, icone('fa-clock-rotate-left'), h('strong', { text: 'Atividades realizadas' }),
        atividades.length ? T.chip(String(atividades.length), { classe: 'tui-chip--info' }) : null),
      podeRegistrar() ? h('button', { type: 'button', class: 'btn-secondary tui-botao cat__registrar', on: { click: () => { formularioAberto = !formularioAberto; formulario.hidden = !formularioAberto; if (formularioAberto) resumo.focus(); } } }, icone('fa-plus'), ' Registrar atividade') : null);

    // formulário
    let tipo = editando?.tipo || 'Ligação';
    const chips = h('div', { class: 'cat__tipos', attrs: { role: 'radiogroup', 'aria-label': 'Tipo' } });
    const pintarTipos = () => chips.replaceChildren(...TIPOS_ATIVIDADE.filter(([t]) => t !== 'Atividade realizada' || tipo === t).map(([t, ic, cor]) => {
      const b = h('button', { type: 'button', class: 'cat__tipo', attrs: { role: 'radio', 'aria-checked': String(tipo === t) }, on: { click: () => { tipo = t; pintarTipos(); } } }, icone(ic), h('span', { text: t }));
      b.style.setProperty('--cat-cor', cor);
      return b;
    }));
    pintarTipos();
    // Atividade é o que JÁ aconteceu: o campo não passa de agora (e o backend confere).
    const quando = h('input', { class: 'tui-campo', type: 'datetime-local', value: paraCampoLocal(editando?.data), max: paraCampoLocal() });
    const contato = h('select', { class: 'tui-campo' }, h('option', { value: '', text: 'Com quem? (opcional)' }),
      contatosDoCliente.map(c => h('option', { value: c.id, text: [c.nome, c.cargo].filter(Boolean).join(' — '), selected: Number(editando?.contato_id) === Number(c.id) })));
    const resumo = h('input', { class: 'tui-campo', type: 'text', maxLength: 300, value: editando?.resumo || '', placeholder: 'Resumo em uma linha — ex.: Liguei, pediu catálogo novo' });
    const detalhe = h('textarea', { class: 'tui-campo', rows: 3, maxLength: 5000, value: editando?.detalhe || '', placeholder: 'Detalhes (opcional)' });
    const duracao = h('input', { class: 'tui-campo tui-campo--curto', type: 'number', min: 0, max: 1440, value: editando?.duracao_min ?? '', placeholder: 'min' });
    const agendar = h('input', { type: 'checkbox' });
    const salvar = h('button', { type: 'button', class: 'btn-primary tui-botao' }, icone('fa-check'), editando ? ' Salvar' : ' Registrar');
    const cancelar = h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Cancelar', on: { click: () => pintarAtividades() } });
    salvar.addEventListener('click', async () => {
      if (!resumo.value.trim()) { resumo.focus(); window.showToast?.('Descreva a atividade em uma linha.', 'error'); return; }
      if (quando.value && new Date(quando.value).getTime() > Date.now() + 60000) {
        quando.focus();
        window.showToast?.('A atividade registra o que já aconteceu: escolha uma data e hora até agora. Para algo futuro, use "Agendar tarefa".', 'error');
        return;
      }
      const corpo = {
        tipo, resumo: resumo.value.trim(), detalhe: detalhe.value.trim() || null,
        contato_id: contato.value ? Number(contato.value) : null,
        duracao_min: duracao.value === '' ? null : Number(duracao.value),
        data: quando.value ? new Date(quando.value).toISOString() : new Date().toISOString()
      };
      try {
        const res = await fetchApi(editando ? `/api/clientes/${cliente.id}/interacoes/${editando.id}` : `/api/clientes/${cliente.id}/interacoes`, {
          method: editando ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Erro ${res.status}`);
        window.showToast?.(editando ? 'Atividade salva.' : 'Atividade registrada.', 'success');
        linhaDoTempo?.recarregar?.();
        await pintarAtividades();
        if (agendar.checked) T.abrirEditor({ preset: { vinculos: [{ tipo: 'cliente', id: Number(cliente.id), nome: nomeDoCliente }], titulo: '', data: T.somarDias(T.hoje(), 3), origemTexto: 'Próximo passo depois da atividade' } });
      } catch (err) {
        window.showToast?.(err.message, 'error');
      }
    });
    const formulario = h('div', { class: 'cat__formulario', hidden: !formularioAberto },
      h('p', { class: 'cat__explica' }, icone('fa-circle-check'), h('span', {},
        'Registre o que ', h('strong', { text: 'já aconteceu' }), ' — a ligação feita, a visita realizada, o e-mail enviado. A atividade entra como ',
        h('strong', { text: 'concluída' }), ', com data e hora até agora. Para algo que ainda vai acontecer, use ', h('strong', { text: 'Agendar tarefa' }), '.')),
      chips,
      h('div', { class: 'cat__linha' }, h('label', { class: 'cat__campo' }, h('span', { class: 'tui-rotulo', text: 'Quando aconteceu' }), quando), h('label', { class: 'cat__campo' }, h('span', { class: 'tui-rotulo', text: 'Com quem' }), contato), h('label', { class: 'cat__campo cat__campo--curto' }, h('span', { class: 'tui-rotulo', text: 'Duração' }), duracao)),
      resumo, detalhe,
      h('div', { class: 'cat__rodape' },
        editando ? h('span') : h('label', { class: 'tui-check' }, agendar, ' Agendar o próximo passo em seguida'),
        h('div', { class: 'tui-rodape__lado' }, cancelar, salvar)));

    // linha do tempo
    const lista = h('div', { class: 'cat__lista' });
    if (!atividades.length) lista.append(h('p', { class: 'tui-dica', text: 'Nenhuma atividade registrada. Registre ligações, visitas e reuniões — ou conclua uma tarefa do cliente, que ela vem para cá.' }));
    for (const a of atividades) {
      const cor = corDoTipo(a.tipo);
      const acoes = podeRegistrar() ? h('div', { class: 'cat__acoes' },
        h('button', { type: 'button', class: 'tui-icone-botao', title: 'Editar', on: { click: () => pintarAtividades(a) } }, icone('fa-pen')),
        h('button', { type: 'button', class: 'tui-icone-botao', title: 'Excluir', on: { click: async () => {
          const ok = await window.DialogPadrao?.confirm({ title: 'Excluir esta atividade?', tom: 'erro', message: `"${a.resumo}" sai da lista de atividades.`, nota: 'O histórico do cliente guarda o que era.', confirmText: 'Excluir', confirmVariant: 'danger' });
          if (!ok) return;
          try {
            const res = await fetchApi(`/api/clientes/${cliente.id}/interacoes/${a.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
            window.showToast?.('Atividade excluída.', 'success');
            linhaDoTempo?.recarregar?.();
            pintarAtividades();
          } catch (err) { window.showToast?.(err.message, 'error'); }
        } } }, icone('fa-trash-can'))) : null;
      const item = h('article', { class: 'cat__item' },
        h('span', { class: 'cat__icone' }, icone(iconeDoTipo(a.tipo))),
        h('div', { class: 'cat__conteudo' },
          h('div', { class: 'cat__meta' }, h('strong', { text: a.tipo }), T.chip('Concluída', { icone: 'fa-circle-check', classe: 'tui-chip--sucesso', titulo: 'Atividade é sempre algo já feito' }), h('span', { text: quandoLegivel(a.data) }), a.usuario ? h('span', { text: a.usuario }) : null),
          h('p', { class: 'cat__resumo', text: a.resumo }),
          a.detalhe ? h('p', { class: 'cat__detalhe', text: a.detalhe }) : null,
          h('div', { class: 'cat__chips' },
            a.contato ? T.chip(a.contato, { icone: 'fa-user' }) : null,
            a.duracao_min ? T.chip(`${a.duracao_min} min`, { icone: 'fa-hourglass-half' }) : null,
            a.tarefa_id ? h('button', { type: 'button', class: 'tui-link', on: { click: () => T.abrirEditor({ id: a.tarefa_id }) } }, icone('fa-list-check'), ' Veio de uma tarefa') : null)),
        acoes);
      item.style.setProperty('--cat-cor', cor);
      lista.append(item);
    }
    alvo.replaceChildren(h('div', { class: 'tui-ficha tui-escopo' }, topo, formulario, lista));
    if (editando) resumo.focus();
  }

  function montarAtividades() {
    if (atividadesMontadas || !cliente?.id || !window.TarefasUI) return;
    atividadesMontadas = true;
    window.TarefasUI.montarTarefasDaFicha(document.getElementById('clienteTarefas'), { tipo: 'cliente', id: cliente.id, nome: nomeDoCliente || `Cliente #${cliente.id}` });
    pintarAtividades();
    // Tarefa concluída aqui vira atividade: a lista precisa acompanhar.
    const aoMudar = () => { if (!document.getElementById('clienteAtividades')) { window.removeEventListener('tarefas:mudou', aoMudar); return; } pintarAtividades(); };
    window.addEventListener('tarefas:mudou', aoMudar);
  }
  document.getElementById('tab-atividades')?.addEventListener('click', montarAtividades);
  const pedidoDeFoco = window.historicoSocialFoco;
  if (abaHistorico && pedidoDeFoco?.origem === 'cliente' && String(pedidoDeFoco.registroId) === String(cliente?.id)) {
    window.historicoSocialFoco = null;
    activateTab(abaHistorico, { setFocus: false });
    montarHistorico(pedidoDeFoco);
  }

  const editar = document.getElementById('editarDetalhesCliente');
  if(editar){
    editar.addEventListener('click', () => {
      if(cliente){
        Modal.close('detalhesCliente');
        setTimeout(() => {
          if(window.abrirEditarCliente) window.abrirEditarCliente(cliente);
        }, 0);
      }
    });
  }

  function preencherDadosEmpresa(cli){
    const map = {
      empresaRazaoSocial: 'razao_social',
      empresaNomeFantasia: 'nome_fantasia',
      empresaCnpj: 'cnpj',
      empresaInscricaoEstadual: 'inscricao_estadual',
      empresaSite: 'site',
      empresaDono: 'dono_cliente',
      empresaStatus: 'status_cliente',
      empresaOrigemCaptacao: 'origem_captacao'
    };
    for(const id in map){
      const el = document.getElementById(id);
      if(el) el.value = cli[map[id]] || '';
    }
    window.ClienteFiscal?.preencher(document, cli);
    const avatar = document.getElementById('empresaAvatar');
    if(avatar){
      const name = cli.nome_fantasia || cli.razao_social || '';
      const initials = name.split(' ').filter(Boolean).map(n=>n[0]).join('').substring(0,2).toUpperCase();
      avatar.textContent = initials;
    }
  }

  async function preencherEnderecos(cli){
    const fill = async (prefix, data) => {
      if(!data) return;
      for(const key of ['rua','numero','complemento','bairro','cidade','cep']){
        const el = document.getElementById(`${prefix}${key.charAt(0).toUpperCase()+key.slice(1)}`);
        if(el) el.value = data[key] || '';
      }
      const codigo = document.getElementById(`${prefix}CodigoMunicipio`);
      if(codigo) codigo.value = data.codigo_municipio || '';
      const paisSel = document.getElementById(prefix + 'Pais');
      const estadoSel = document.getElementById(prefix + 'Estado');
      if(paisSel && estadoSel){
        const countries = await geoService.getCountries();
        paisSel.innerHTML = '<option value="">Selecione</option>' +
          countries.map(c => `<option value="${c.name}" data-code="${c.code}">${c.name}</option>`).join('');
        paisSel.value = data.pais || '';
        if(data.pais){
          const code = countries.find(c => c.name === data.pais)?.code;
          if(code){
            const states = await geoService.getStatesByCountry(code);
            estadoSel.innerHTML = '<option value="">Selecione</option>' +
              states.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
            estadoSel.value = data.estado || '';
          } else {
            estadoSel.innerHTML = '<option value="">Selecione o país</option>';
          }
        } else {
          estadoSel.innerHTML = '<option value="">Selecione o país</option>';
        }
      }
    };
    await fill('reg', cli.endereco_registro);
    await fill('cob', cli.endereco_cobranca);
    await fill('ent', cli.endereco_entrega);
  }

  /** Transportadoras do cliente. O backend já devolve {id, nome}. */
  async function carregarTransportadoras(idCliente){
    if(!idCliente) return [];
    try {
      const res = await fetchApi(`/api/transportadoras/${idCliente}`);
      if(!res.ok) throw new Error(`Erro HTTP ${res.status}`);
      const dados = await res.json();
      return Array.isArray(dados) ? dados : [];
    } catch(err){
      console.error('Erro ao carregar transportadoras', err);
      return [];
    }
  }

  function renderTransportadoras(lista){
    const tbody = document.getElementById('transportadorasTabela');
    if(!tbody) return;
    if(!lista.length){
      tbody.innerHTML = '<tr><td class="py-12 text-left text-gray-400">Nenhuma transportadora cadastrada</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map(t => `
      <tr class="border-b border-white/5">
        <td class="py-4 px-4 text-white">${escaparHtml(t.nome || t.transportadora)}</td>
      </tr>`).join('');
  }

  /** Escapa antes do innerHTML — o nome é texto digitado por gente. */
  function escaparHtml(v){
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderContatos(contatos){
    const tbody = document.getElementById('contatosTabela');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!contatos.length){
    tbody.innerHTML = '<tr><td colspan="6" class="py-12 text-left text-gray-400">Nenhum contato cadastrado</td></tr>';
      return;
    }
    contatos.forEach(c => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/5 hover:bg-white/5 transition';
      tr.innerHTML = `
        <td data-perm-col="col_ctt_nome" class="py-4 px-4 text-white">${c.nome || ''}</td>
        <td data-perm-col="col_ctt_cargo" class="py-4 px-4 text-white">${c.cargo || ''}</td>
        <td data-perm-col="col_ctt_email" class="py-4 px-4 text-white">${c.email || ''}</td>
        <td data-perm-col="col_ctt_tel" class="py-4 px-4 text-white">${c.telefone_celular || ''}</td>
        <td data-perm-col="col_ctt_fixo" class="py-4 px-4 text-white">${c.telefone_fixo || ''}</td>
        <td class="py-4 px-4 text-left text-white">
          <div class="flex items-center justify-start gap-2">
            <i data-perm="cli.contact.edit" class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
            <i data-perm="cli.contact.remove" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white" style="color: var(--color-red)" title="Excluir"></i>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  function inicializarToggles(cli){
    const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    const cobToggle = document.getElementById('cobrancaIgual');
    const cobFields = document.getElementById('cobrancaFields');
    const entToggle = document.getElementById('entregaIgual');
    const entFields = document.getElementById('entregaFields');
    if(cobToggle && cobFields){
      if(same(cli.endereco_cobranca, cli.endereco_registro)) cobToggle.checked = true;
      cobFields.classList.toggle('hidden', cobToggle.checked);
      cobToggle.disabled = true;
    }
    if(entToggle && entFields){
      if(same(cli.endereco_entrega, cli.endereco_registro)) entToggle.checked = true;
      entFields.classList.toggle('hidden', entToggle.checked);
      entToggle.disabled = true;
    }
  }

  function addCopyButtons(){
    const fields = overlay.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea');
    fields.forEach(field => {
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
        try{
          await navigator.clipboard.writeText(field.value || '');
          showToast('Dado copiado!', 'success');
        }catch{
          showToast('Erro ao copiar', 'error');
        }
      });
      wrapper.appendChild(btn);
    });
  }

  function setupAddressCopyButtons(){
    const formatAddress = prefix => {
      const rua = document.getElementById(prefix + 'Rua')?.value.trim() || '';
      const numero = document.getElementById(prefix + 'Numero')?.value.trim() || '';
      const complemento = document.getElementById(prefix + 'Complemento')?.value.trim() || '';
      const bairro = document.getElementById(prefix + 'Bairro')?.value.trim() || '';
      const cidade = document.getElementById(prefix + 'Cidade')?.value.trim() || '';
      const estado = document.getElementById(prefix + 'Estado')?.value.trim() || '';
      const pais = document.getElementById(prefix + 'Pais')?.value.trim() || '';
      const cep = document.getElementById(prefix + 'Cep')?.value.trim() || '';
      return `${rua} ${numero}${complemento ? ', ' + complemento : ''}, ${bairro}, ${cidade}/${estado}, ${pais} - ${cep}`;
    };
    const buttons = {
      reg: 'copyRegEndereco',
      cob: 'copyCobEndereco',
      ent: 'copyEntEndereco'
    };
    Object.entries(buttons).forEach(([prefix, id]) => {
      const btn = document.getElementById(id);
      if(btn){
        btn.addEventListener('click', async () => {
          const text = formatAddress(prefix);
          try{
            await navigator.clipboard.writeText(text);
            showToast('Endereço copiado!', 'success');
          }catch{
            showToast('Erro ao copiar', 'error');
          }
        });
      }
    });
  }

  async function carregarOrdens(id){
    try{
      const [pedidosRes, orcamentosRes] = await Promise.all([
        fetchApi(`/api/pedidos?clienteId=${id}`),
        fetchApi(`/api/orcamentos?clienteId=${id}`)
      ]);
      const pedidos = await pedidosRes.json();
      const orcamentos = await orcamentosRes.json();
      const ordens = [
        ...pedidos.map(p => ({
          numero:p.numero,
          tipo:'Pedido',
          inicio:p.data_emissao,
          condicao: p.parcelas > 1 ? `${p.parcelas}x` : 'À vista',
          valor:p.valor_final,
          status:p.situacao
        })),
        ...orcamentos.map(o => ({
          numero:o.numero,
          tipo:'Orçamento',
          inicio:o.data_emissao,
          condicao: o.parcelas > 1 ? `${o.parcelas}x` : 'À vista',
          valor:o.valor_final,
          status:o.situacao
        }))
      ];
      renderOrdens(ordens);
    }catch(err){
      console.error('Erro ao carregar ordens', err);
    }
  }

  function renderOrdens(ordens){
    const tbody = document.getElementById('ordensTabela');
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!ordens.length){
    tbody.innerHTML = '<tr><td colspan="6" class="py-12 text-left text-gray-400">Nenhuma ordem encontrada</td></tr>';
      return;
    }
    const formatCurrency = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
    ordens.forEach(o => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/5 hover:bg-white/5 transition';
      tr.innerHTML = `
        <td data-perm-col="col_ord_numero" class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${o.numero}</td>
        <td data-perm-col="col_ord_tipo" class="px-6 py-4 whitespace-nowrap text-sm text-white">${o.tipo}</td>
        <td data-perm-col="col_ord_inicio" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${o.inicio || ''}</td>
        <td data-perm-col="col_ord_condicao" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${o.condicao || ''}</td>
        <td data-perm-col="col_ord_valor" class="px-6 py-4 whitespace-nowrap text-sm text-left text-white">${formatCurrency(o.valor)}</td>
        <td data-perm-col="col_ord_status" class="px-6 py-4 whitespace-nowrap text-sm text-white">${o.status || ''}</td>`;
      tbody.appendChild(tr);
    });
  }
})();
