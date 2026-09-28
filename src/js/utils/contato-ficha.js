/**
 * A ficha do contato (fornecedor/prestador) nos três modais — novo, editar e
 * detalhes (src/js/modals/contato-*.js): as abas, o campo Tipo com + e −
 * (utils/contato-tipos.js), CNPJ ou CPF, o endereço (país/estado em cascata e
 * CEP), a tabela de pessoas de contato, o preenchimento e a coleta com a
 * validação. Um utilitário só porque os três modais têm os mesmos campos com
 * os mesmos ids. Carregado pelo próprio modal (carregarUtil), não pelo menu.
 */
(() => {
  if (window.ContatoFicha) return;

  const $ = id => document.getElementById(id);
  const digitos = v => String(v ?? '').replace(/\D/g, '');

  // ------------------------------------------------------------ máscaras
  function mascararCnpj(v) {
    const d = digitos(v).slice(0, 14);
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  }
  function mascararCpf(v) {
    const d = digitos(v).slice(0, 11);
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  const iniciais = nome => String(nome || '').split(' ').filter(Boolean).map(n => n[0]).join('').substring(0, 2).toUpperCase();
  const escaparHtml = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** Carrega um utilitário de src/js/utils uma vez só (o mesmo de produto-novo.js). */
  function carregarUtil(arquivo, global) {
    if (window[global]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `../js/utils/${arquivo}`;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Não foi possível carregar ${arquivo}.`));
      document.head.appendChild(s);
    });
  }

  async function garantirGeo() {
    if (window.geoService) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../js/geo-service.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ---------------------------------------------------------------- abas
  function ligarAbas(overlay) {
    const tablist = overlay.querySelector('[role="tablist"]');
    const tabs = Array.from(overlay.querySelectorAll('[role="tab"]'));
    const panels = Array.from(overlay.querySelectorAll('[role="tabpanel"]'));
    function activateTab(targetTab, { setFocus = true } = {}) {
      if (!targetTab) return;
      tabs.forEach(tab => {
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
        tab.classList.remove('tab-active', 'hover:text-white');
        tab.classList.add('text-gray-400', 'border-transparent');
      });
      panels.forEach(panel => panel.classList.add('hidden'));
      targetTab.setAttribute('aria-selected', 'true');
      targetTab.setAttribute('tabindex', '0');
      targetTab.classList.add('tab-active', 'hover:text-white');
      targetTab.classList.remove('text-gray-400', 'border-transparent');
      overlay.querySelector('#' + targetTab.getAttribute('aria-controls'))?.classList.remove('hidden');
      if (setFocus) targetTab.focus();
    }
    tabs.forEach(tab => tab.addEventListener('click', e => { e.preventDefault(); activateTab(tab); }));
    tablist?.addEventListener('keydown', e => {
      const atual = tabs.findIndex(t => t === document.activeElement);
      const ir = i => { e.preventDefault(); activateTab(tabs[i]); };
      if (e.key === 'ArrowRight') ir(atual < tabs.length - 1 ? atual + 1 : 0);
      else if (e.key === 'ArrowLeft') ir(atual > 0 ? atual - 1 : tabs.length - 1);
      else if (e.key === 'Home') ir(0);
      else if (e.key === 'End') ir(tabs.length - 1);
      else if ((e.key === 'Enter' || e.key === ' ') && atual >= 0) ir(atual);
    });
    activateTab(tabs[0], { setFocus: false });
    return { tabs, panels, activateTab, abaAtiva: () => tabs.find(t => t.getAttribute('aria-selected') === 'true')?.id || null };
  }

  // ------------------------------------------------------ CNPJ ou CPF
  function alternarTipoPessoa() {
    const pf = String($('contatoTipoPessoa')?.value || 'PJ').toUpperCase() === 'PF';
    $('contatoCnpjBloco')?.classList.toggle('hidden', pf);
    $('contatoCpfBloco')?.classList.toggle('hidden', !pf);
  }
  function ligarTipoPessoa() {
    $('contatoTipoPessoa')?.addEventListener('change', alternarTipoPessoa);
    $('contatoCnpj')?.addEventListener('input', e => { e.target.value = mascararCnpj(e.target.value); });
    $('contatoCpf')?.addEventListener('input', e => { e.target.value = mascararCpf(e.target.value); });
    alternarTipoPessoa();
  }

  // ------------------------------------------------------ Tipo (+ e −)
  /**
   * O <select> do Tipo com a lista do servidor e os botões + e − (abrem os
   * modais tipo-novo / tipo-excluir por cima). Devolve { recarregar, destruir }.
   */
  async function ligarTipos({ select, botaoMais, botaoMenos } = {}) {
    if (!select) return { recarregar: async () => {}, destruir: () => {} };
    await carregarUtil('contato-tipos.js', 'ContatoTipos');
    let nomeAntigo = '';
    async function recarregar(selecionadoId, nome = '') {
      if (nome) nomeAntigo = nome;
      try {
        const lista = await window.ContatoTipos.listar();
        window.ContatoTipos.preencher(select, lista, selecionadoId ?? select.value, nomeAntigo);
      } catch (err) {
        console.error('Erro ao carregar os tipos de contato:', err);
        window.showToast?.(err?.corpo?.sql_pendente ? err.message : 'Não foi possível carregar os tipos de contato.', 'error');
      }
    }
    const aoAtualizar = event => {
      const d = event?.detail || {};
      let selecionado = d.selecionado ?? select.value;
      if (d.removido !== undefined && String(select.value) === String(d.removido)) selecionado = '';
      recarregar(selecionado);
    };
    window.addEventListener(window.ContatoTipos.EVENTO, aoAtualizar);
    botaoMais?.addEventListener('click', () => {
      Modal.open('modals/contatos/tipo-novo.html', '../js/modals/contato-tipo-novo.js', 'novoTipoContato', true);
    });
    botaoMenos?.addEventListener('click', () => {
      Modal.open('modals/contatos/tipo-excluir.html', '../js/modals/contato-tipo-excluir.js', 'excluirTipoContato', true);
    });
    await recarregar('');
    return { recarregar, destruir: () => window.removeEventListener(window.ContatoTipos.EVENTO, aoAtualizar) };
  }

  // ------------------------------------------------------------ endereço
  /** País e estado em cascata (geo-service) e o CEP (utils/cep.js). `dados` preenche. */
  async function ligarEndereco(dados = null) {
    await garantirGeo();
    const paisSel = $('endPais');
    const estadoSel = $('endEstado');
    if (paisSel && estadoSel && paisSel.tagName === 'SELECT') {
      const countries = await window.geoService.getCountries();
      paisSel.innerHTML = '<option value="">Selecione</option>' + countries.map(c => `<option value="${escaparHtml(c.name)}" data-code="${escaparHtml(c.code)}">${escaparHtml(c.name)}</option>`).join('');
      const carregarEstados = async (code, escolhido = '') => {
        if (!code) {
          estadoSel.disabled = true;
          estadoSel.innerHTML = '<option value="">Selecione o país</option>';
          return;
        }
        const states = await window.geoService.getStatesByCountry(code);
        estadoSel.disabled = false;
        estadoSel.innerHTML = '<option value="">Selecione</option>' + states.map(s => `<option value="${escaparHtml(s.name)}">${escaparHtml(s.name)}</option>`).join('');
        estadoSel.value = escolhido || '';
      };
      if (dados?.pais) {
        paisSel.value = dados.pais;
        await carregarEstados(countries.find(c => c.name === dados.pais)?.code, dados.estado);
      } else {
        await carregarEstados(null);
      }
      paisSel.addEventListener('change', () => carregarEstados(paisSel.selectedOptions[0]?.dataset.code));
      estadoSel.addEventListener('mousedown', e => {
        if (!paisSel.value) {
          e.preventDefault();
          window.DialogPadrao?.info({ title: 'Escolha o país primeiro', tom: 'aviso', icone: 'fa-earth-americas', message: 'A lista de estados depende do país: escolha o país e depois o estado.' });
        }
      });
    } else if (dados) {
      if (paisSel) paisSel.value = dados.pais || '';
      if (estadoSel) estadoSel.value = dados.estado || '';
    }
    if (dados) {
      for (const [campo, id] of [['rua', 'endRua'], ['numero', 'endNumero'], ['complemento', 'endComplemento'], ['bairro', 'endBairro'], ['cidade', 'endCidade'], ['cep', 'endCep'], ['codigo_municipio', 'endCodigoMunicipio']]) {
        const el = $(id);
        if (el) el.value = dados[campo] || '';
      }
    }
    window.CepBusca?.ligar('end');
  }

  const lerEndereco = () => {
    const v = id => ($(id)?.value || '').trim();
    return {
      rua: v('endRua'), numero: v('endNumero'), complemento: v('endComplemento'), bairro: v('endBairro'),
      cidade: v('endCidade'), pais: v('endPais'), estado: v('endEstado'), cep: v('endCep'), codigo_municipio: digitos(v('endCodigoMunicipio'))
    };
  };

  // -------------------------------------------------------------- pessoas
  /**
   * A tabela de pessoas de contato. `acoes` = { editar(idx), excluir(idx) } (nada
   * na ficha, que é só leitura: aí a coluna de ações não existe).
   */
  function renderPessoas(tbody, pessoas, acoes = null) {
    if (!tbody) return;
    const lista = Array.isArray(pessoas) ? pessoas : [];
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="${acoes ? 6 : 5}" class="py-12 text-left text-gray-400">Nenhuma pessoa cadastrada</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    lista.forEach((p, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="py-4 px-4 text-white">${escaparHtml(p.nome || '')}</td>
        <td class="py-4 px-4 text-white">${escaparHtml(p.cargo || '')}</td>
        <td class="py-4 px-4 text-white">${escaparHtml(p.email || '')}</td>
        <td class="py-4 px-4 text-white">${escaparHtml(p.telefone_celular || '')}</td>
        <td class="py-4 px-4 text-white">${escaparHtml(p.telefone_fixo || '')}</td>
        ${acoes ? `<td class="py-4 px-4 text-left text-white">
          <div class="flex items-center justify-start gap-2">
            <i data-perm="ctt.person.edit" class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 edit-pessoa" style="color: var(--color-primary)" title="Editar"></i>
            <i data-perm="ctt.person.remove" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10 hover:text-white delete-pessoa" style="color: var(--color-red)" title="Excluir"></i>
          </div>
        </td>` : ''}`;
      if (acoes) {
        tr.querySelector('.edit-pessoa')?.addEventListener('click', () => acoes.editar(idx));
        tr.querySelector('.delete-pessoa')?.addEventListener('click', () => acoes.excluir(idx));
      }
      tbody.appendChild(tr);
    });
    window.Permissoes?.aplicar?.(tbody);
  }

  // --------------------------------------------------- preencher / coletar
  /** Põe a ficha nos campos (novo/editar: selects; detalhes: textos). */
  function preencherDados(c = {}) {
    const por = { contatoNome: 'nome', contatoRazaoSocial: 'razao_social', contatoInscricaoEstadual: 'inscricao_estadual', contatoInscricaoMunicipal: 'inscricao_municipal', contatoEmail: 'email', contatoSite: 'site', contatoCelular: 'telefone_celular', contatoTelefone: 'telefone_fixo' };
    for (const [id, campo] of Object.entries(por)) {
      const el = $(id);
      if (el) el.value = c[campo] || '';
    }
    const tipoPessoa = $('contatoTipoPessoa');
    if (tipoPessoa) tipoPessoa.value = c.tipo_pessoa === 'PF' ? 'PF' : 'PJ';
    if ($('contatoCnpj')) $('contatoCnpj').value = c.cnpj ? mascararCnpj(c.cnpj) : '';
    if ($('contatoCpf')) $('contatoCpf').value = c.cpf ? mascararCpf(c.cpf) : '';
    if ($('contatoStatus')) $('contatoStatus').value = c.status || 'Ativo';
    if ($('contatoTipoTexto')) $('contatoTipoTexto').value = c.tipo || '';
    if ($('contatoTipoEtiqueta')) $('contatoTipoEtiqueta').textContent = c.tipo || 'Sem tipo';
    if ($('contatoNotas')) $('contatoNotas').value = c.anotacoes || '';
    const avatar = $('contatoAvatar');
    if (avatar) avatar.textContent = iniciais(c.nome || c.razao_social || '');
    alternarTipoPessoa();
  }

  /**
   * Lê o formulário e confere o que o cadastro exige: nome, tipo da lista e
   * CNPJ (PJ) ou CPF (PF). Devolve o corpo do POST/PUT, ou null depois de
   * apontar o campo que falta (aba, destaque e aviso).
   */
  function coletarDados({ activateTab } = {}) {
    const v = id => ($(id)?.value || '').trim();
    const pf = v('contatoTipoPessoa') === 'PF';
    const cnpj = digitos(v('contatoCnpj'));
    const cpf = digitos(v('contatoCpf'));
    const faltas = [];
    if (v('contatoNome').length < 2) faltas.push({ field: 'contatoNome', name: 'o nome' });
    const tipoSel = $('contatoTipo');
    const tipoValido = window.ContatoTipos?.escolhaValida ? window.ContatoTipos.escolhaValida(tipoSel) : Boolean(tipoSel?.value);
    if (!tipoValido) faltas.push({ field: 'contatoTipo', name: 'o tipo' });
    if (pf && cpf.length !== 11) faltas.push({ field: 'contatoCpf', name: 'o CPF' });
    if (!pf && cnpj.length !== 14) faltas.push({ field: 'contatoCnpj', name: 'o CNPJ' });
    if (faltas.length) {
      const primeira = faltas[0];
      activateTab?.($('tab-dados'));
      const el = $(primeira.field);
      if (el) {
        el.classList.add('border-red-500');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        setTimeout(() => el.classList.remove('border-red-500'), 2000);
      }
      window.showToast?.(`Preencha ${primeira.name}`, 'error');
      return null;
    }
    return {
      nome: v('contatoNome'),
      razao_social: v('contatoRazaoSocial'),
      tipo_id: Number(tipoSel.value),
      tipo_pessoa: pf ? 'PF' : 'PJ',
      cnpj: pf ? '' : cnpj,
      cpf: pf ? cpf : '',
      inscricao_estadual: v('contatoInscricaoEstadual'),
      inscricao_municipal: v('contatoInscricaoMunicipal'),
      email: v('contatoEmail'),
      site: v('contatoSite'),
      telefone_celular: v('contatoCelular'),
      telefone_fixo: v('contatoTelefone'),
      status: v('contatoStatus') || 'Ativo',
      endereco: lerEndereco(),
      anotacoes: $('contatoNotas')?.value || ''
    };
  }

  /** O modal "pessoa" por cima; `editando` = { ...pessoa, indice } para editar. */
  function abrirPessoa(editando = null) {
    if (editando) window.contatoPessoaEditar = editando;
    else delete window.contatoPessoaEditar;
    Modal.open('modals/contatos/pessoa.html', '../js/modals/contato-pessoa.js', 'pessoaContato', true);
  }

  window.ContatoFicha = {
    carregarUtil, ligarAbas, ligarTipoPessoa, alternarTipoPessoa, ligarTipos, ligarEndereco, lerEndereco,
    renderPessoas, preencherDados, coletarDados, abrirPessoa, mascararCnpj, mascararCpf, iniciais, escaparHtml
  };
})();
