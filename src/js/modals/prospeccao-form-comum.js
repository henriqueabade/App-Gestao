/**
 * Lógica compartilhada pelos modais "Nova Prospecção" e "Editar Prospecção".
 *
 * Os dois têm as mesmas cinco abas, a mesma tabela de contatos, os mesmos
 * selects em cascata de país/estado e a mesma regra de probabilidade por etapa.
 * Duplicar isso em dois arquivos (como acontece hoje entre cliente-novo.js e
 * cliente-editar.js) significaria corrigir todo bug duas vezes — e esquecer de
 * um lado. Aqui a diferença entre os dois modais é só `modo`.
 *
 * Exposto como `window.ProspeccaoForm`.
 */
(function () {
  if (window.ProspeccaoForm) return;

  /** Espelha PROBABILIDADE_PADRAO de backend/prospeccoesController.js. */
  const PROBABILIDADE_POR_ETAPA = {
    'Novo': 10,
    'Contactado': 25,
    'Qualificado': 50,
    'Proposta': 65,
    'Negociação': 80,
    'Ganho': 100,
    'Perdido': 0
  };

  const ETAPAS_PADRAO = [
    'Novo', 'Contactado', 'Qualificado', 'Proposta', 'Negociação', 'Ganho', 'Perdido'
  ];

  const get = id => document.getElementById(id);
  const valor = id => (get(id)?.value || '').trim();

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function carregarScript(src) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function criar(overlay, opcoes = {}) {
    const modo = opcoes.modo === 'editar' ? 'editar' : 'novo';

    // Popover (i) dos contatos — arquivo compartilhado com o modal de detalhe.
    if (!window.ProspeccaoContatoPopup) carregarScript('../js/modals/prospeccao-contato-popup.js');

    // -----------------------------------------------------------------
    // Abas
    // -----------------------------------------------------------------
    const tablist = overlay.querySelector('[role="tablist"]');
    const tabs = Array.from(overlay.querySelectorAll('[role="tab"]'));
    const panels = Array.from(overlay.querySelectorAll('[role="tabpanel"]'));

    function activateTab(alvo, { setFocus = true } = {}) {
      if (!alvo) return;
      tabs.forEach(tab => {
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
        tab.classList.remove('tab-active', 'hover:text-white');
        tab.classList.add('text-gray-400', 'border-transparent');
      });
      panels.forEach(p => p.classList.add('hidden'));
      alvo.setAttribute('aria-selected', 'true');
      alvo.setAttribute('tabindex', '0');
      alvo.classList.add('tab-active', 'hover:text-white');
      alvo.classList.remove('text-gray-400', 'border-transparent');
      overlay.querySelector('#' + alvo.getAttribute('aria-controls'))?.classList.remove('hidden');
      if (setFocus) alvo.focus();
    }

    tabs.forEach(tab => tab.addEventListener('click', e => {
      e.preventDefault();
      activateTab(tab);
    }));

    tablist?.addEventListener('keydown', e => {
      const atual = tabs.findIndex(t => t === document.activeElement);
      let alvo;
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); alvo = atual < tabs.length - 1 ? atual + 1 : 0; break;
        case 'ArrowLeft': e.preventDefault(); alvo = atual > 0 ? atual - 1 : tabs.length - 1; break;
        case 'Home': e.preventDefault(); alvo = 0; break;
        case 'End': e.preventDefault(); alvo = tabs.length - 1; break;
        default: return;
      }
      activateTab(tabs[alvo]);
    });

    activateTab(tabs[0], { setFocus: false });

    // -----------------------------------------------------------------
    // Contatos
    // -----------------------------------------------------------------
    let contatos = [];
    const contatosExcluidos = [];

    /**
     * Só um contato pode ser principal — o banco tem índice único parcial e
     * recusaria o segundo com um erro cru. Marcar aqui desmarca os outros.
     */
    function garantirPrincipalUnico(indiceEscolhido) {
      contatos.forEach((c, i) => {
        if (i === indiceEscolhido) return;
        if (!c.principal) return;
        c.principal = false;
        if (c.status === 'unchanged') c.status = 'updated';
      });
    }

    function renderContatos() {
      const tbody = get('prospeccaoContatosTabela');
      if (!tbody) return;

      if (!contatos.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="py-12 text-center text-gray-400">Nenhum contato cadastrado</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      contatos.forEach((c, indice) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-white/5';
        // Cargo e papel saíram das colunas e foram para o popover (i): sem
        // eles sobra largura para os telefones caberem inteiros, sem quebrar
        // "(61) 98211-" numa linha e "3344" na outra.
        tr.innerHTML = `
          <td class="py-3 px-4 text-white">
            <div class="flex items-center gap-2">
              <span>${esc(c.nome)}</span>
              <i class="info-icon" data-info-contato></i>
            </div>
          </td>
          <td class="py-3 px-4 text-white/80">${esc(c.email || '—')}</td>
          <td class="py-3 px-4 text-white/80 celula-sem-quebra">${esc(c.telefone_celular || '—')}</td>
          <td class="py-3 px-4 text-white/80 celula-sem-quebra">${esc(c.telefone_fixo || '—')}</td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-2">
              <i data-perm="pros.contact.edit" class="fas fa-edit acao-tabela acao-tabela--editar acao-editar-contato" title="Editar contato"></i>
              <i data-perm="pros.contact.remove" class="fas fa-trash acao-tabela acao-tabela--excluir acao-remover-contato" title="Remover contato"></i>
            </div>
          </td>`;

        window.ProspeccaoContatoPopup?.ligar(tr.querySelector('[data-info-contato]'), c);

        tr.querySelector('.acao-editar-contato')?.addEventListener('click', () => {
          window.prospeccaoContatoEditar = { ...c, indice };
          Modal.open('modals/prospeccoes/contato.html', '../js/modals/prospeccao-contato.js', 'contatoProspeccao', true);
        });

        tr.querySelector('.acao-remover-contato')?.addEventListener('click', async () => {
          const removido = contatos[indice];
          // Contato que já existe no banco some de verdade ao salvar — pergunta
          // antes. O que foi digitado agora e ainda não saiu daqui não precisa
          // de cerimônia: nada foi gravado.
          const jaGravado = Boolean(removido?.id) && removido.status !== 'new';
          if (jaGravado) {
            const ok = await window.DialogPadrao?.confirm({
              title: 'Remover este contato?',
              message: `${removido.nome || 'O contato'} será excluído da prospecção ao salvar. O histórico guarda os dados dele.`,
              confirmText: 'Remover'
            });
            if (!ok) return;
            contatosExcluidos.push(removido.id);
          }
          contatos.splice(indice, 1);
          renderContatos();
        });

        tbody.appendChild(tr);
      });

      window.Permissoes?.aplicarAcoesEColunas?.(tbody);
    }

    function aoSalvarContato(evento) {
      const dados = evento.detail || {};
      const { indice, ...campos } = dados;

      if (indice === undefined || indice === null || !contatos[indice]) {
        contatos.push({ ...campos, status: 'new' });
        if (campos.principal) garantirPrincipalUnico(contatos.length - 1);
      } else {
        const anterior = contatos[indice];
        contatos[indice] = {
          ...anterior,
          ...campos,
          // Contato que ainda não existe no banco continua 'new' depois de
          // editado; marcar 'updated' faria o backend tentar um PUT num id
          // que não existe.
          status: anterior.status === 'new' ? 'new' : 'updated'
        };
        if (campos.principal) garantirPrincipalUnico(indice);
      }
      renderContatos();
    }

    window.addEventListener('prospeccaoContatoSalvo', aoSalvarContato);

    get('addContatoProspeccaoBtn')?.addEventListener('click', () => {
      delete window.prospeccaoContatoEditar;
      Modal.open('modals/prospeccoes/contato.html', '../js/modals/prospeccao-contato.js', 'contatoProspeccao', true);
    });

    // -----------------------------------------------------------------
    // Etapa e probabilidade
    // -----------------------------------------------------------------
    function popularEtapas() {
      const sel = get('prosEtapa');
      if (!sel) return;
      const etapas = Array.isArray(window.PROSPECCOES_ETAPAS) && window.PROSPECCOES_ETAPAS.length
        ? window.PROSPECCOES_ETAPAS
        : ETAPAS_PADRAO;
      sel.innerHTML = etapas.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
    }

    /**
     * Ao trocar a etapa, sugere a probabilidade correspondente — a mesma que o
     * backend aplicaria. Só sobrescreve enquanto o usuário não tiver digitado
     * um valor próprio, para não apagar a leitura dele do negócio.
     */
    function ligarSincroniaProbabilidade() {
      const etapaSel = get('prosEtapa');
      const probInput = get('prosProbabilidade');
      if (!etapaSel || !probInput) return;

      probInput.addEventListener('input', () => { probInput.dataset.editadoManualmente = '1'; });

      etapaSel.addEventListener('change', () => {
        if (probInput.dataset.editadoManualmente === '1') return;
        const sugerida = PROBABILIDADE_POR_ETAPA[etapaSel.value];
        if (sugerida !== undefined) probInput.value = String(sugerida);
      });
    }

    // -----------------------------------------------------------------
    // Responsáveis e geografia
    // -----------------------------------------------------------------
    async function carregarResponsaveis(selecionadoId) {
      const sel = get('prosResponsavel');
      if (!sel) return;
      try {
        const baseUrl = await window.apiConfig.getApiBaseUrl();
        const resp = await fetch(`${baseUrl}/api/usuarios/lista`);
        const usuarios = await resp.json();
        sel.innerHTML = '<option value="">Selecione o responsável</option>' +
          (Array.isArray(usuarios) ? usuarios : [])
            .map(u => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`)
            .join('');
        if (selecionadoId !== undefined && selecionadoId !== null) {
          sel.value = String(selecionadoId);
        }
      } catch (err) {
        console.error('Erro ao carregar responsáveis', err);
      }
    }

    async function configurarGeografia(paisAtual, estadoAtual) {
      const paisSel = get('endPais');
      const estadoSel = get('endEstado');
      if (!paisSel || !estadoSel) return;

      if (!window.geoService) {
        try {
          await carregarScript('../js/geo-service.js');
        } catch (err) {
          console.error('Erro ao carregar geo-service', err);
          return;
        }
      }

      const paises = await window.geoService.getCountries();
      paisSel.innerHTML = '<option value="">Selecione</option>' +
        paises.map(c => `<option value="${esc(c.name)}" data-code="${esc(c.code)}">${esc(c.name)}</option>`).join('');

      async function carregarEstados(codigo, selecionar) {
        if (!codigo) {
          estadoSel.disabled = true;
          estadoSel.innerHTML = '<option value="">Selecione o país</option>';
          return;
        }
        const estados = await window.geoService.getStatesByCountry(codigo);
        estadoSel.disabled = false;
        estadoSel.innerHTML = '<option value="">Selecione</option>' +
          estados.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
        if (selecionar) estadoSel.value = selecionar;
      }

      paisSel.addEventListener('change', () => {
        carregarEstados(paisSel.selectedOptions[0]?.dataset.code);
      });

      estadoSel.addEventListener('mousedown', e => {
        if (!paisSel.value) {
          e.preventDefault();
          showToast('Selecione o país primeiro', 'info');
        }
      });

      // Repõe o que já estava salvo: o estado só existe depois que o país carrega.
      if (paisAtual) {
        paisSel.value = paisAtual;
        await carregarEstados(paisSel.selectedOptions[0]?.dataset.code, estadoAtual);
      } else {
        await carregarEstados(null);
      }
    }

    // -----------------------------------------------------------------
    // Preenchimento e coleta
    // -----------------------------------------------------------------
    function preencherCampos(p = {}) {
      const set = (id, v) => { const el = get(id); if (el) el.value = v ?? ''; };

      set('prosNomeFantasia', p.nome_fantasia);
      set('prosRazaoSocial', p.razao_social);
      set('prosSegmento', p.segmento);
      set('prosCnpj', p.cnpj);
      set('prosInscricaoEstadual', p.inscricao_estadual);
      set('prosSite', p.site);
      set('prosOrigem', p.origem);
      set('prosValorEstimado', p.valor_estimado ?? '');
      set('prosProbabilidade', p.probabilidade ?? '');
      set('prosProximoPasso', p.proximo_passo);
      // <input type="date"> só aceita AAAA-MM-DD; a API devolve ISO completo.
      set('prosProximoPassoData', p.proximo_passo_data ? String(p.proximo_passo_data).slice(0, 10) : '');
      set('prosAnotacoes', p.anotacoes);

      const endereco = p.endereco || {};
      set('endRua', endereco.rua ?? p.end_logradouro);
      set('endNumero', endereco.numero ?? p.end_numero);
      set('endComplemento', endereco.complemento ?? p.end_complemento);
      set('endBairro', endereco.bairro ?? p.end_bairro);
      set('endCidade', endereco.cidade ?? p.end_cidade);
      set('endCep', endereco.cep ?? p.end_cep);

      const etapaSel = get('prosEtapa');
      if (etapaSel && p.etapa) etapaSel.value = p.etapa;

      // Probabilidade veio do banco: não deixar a sincronia por etapa sobrescrever.
      const prob = get('prosProbabilidade');
      if (prob && p.probabilidade !== undefined && p.probabilidade !== null) {
        prob.dataset.editadoManualmente = '1';
      }

      const avatar = get('prospeccaoAvatar');
      if (avatar) {
        const nome = p.nome_fantasia || '';
        avatar.textContent = nome.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
      }
    }

    /**
     * Lê um campo numérico devolvendo um resultado ESTRUTURADO:
     *   { vazio: true }     -> em branco; quem chama decide o padrão
     *   { valor: n }        -> número válido
     *   { invalido: true }  -> texto que não vira número
     *
     * Distinguir "vazio" de "inválido" não é preciosismo: a versão anterior
     * colapsava os dois em `null` e o chamador trocava por 0. Digitar
     * "85.000,50" num ambiente sem o NumericInput gravava um negócio de
     * R$ 0,00 — sem erro, sem aviso, com o número certo ainda na tela.
     *
     * A conversão espelha backend/numeros.js: aceita "," ou "." como decimal e
     * o outro como separador de milhar.
     */
    function numero(id) {
      const bruto = valor(id);
      if (!bruto) return { vazio: true };

      if (window.NumericInput?.parse) {
        const n = window.NumericInput.parse(bruto);
        return Number.isFinite(n) ? { valor: n } : { invalido: true };
      }

      let texto = bruto.replace(/[^\d.,-]/g, '');
      if (!texto) return { invalido: true };
      const negativo = /^-/.test(texto);
      texto = texto.replace(/-/g, '');

      const ultimaVirgula = texto.lastIndexOf(',');
      const ultimoPonto = texto.lastIndexOf('.');
      if (ultimaVirgula !== -1 && ultimoPonto !== -1) {
        // Os dois presentes: o que vem por último é o decimal ("1.234,56").
        const decimal = ultimaVirgula > ultimoPonto ? ',' : '.';
        const milhar = decimal === ',' ? '.' : ',';
        texto = texto.split(milhar).join('').replace(decimal, '.');
      } else if (ultimaVirgula !== -1) {
        texto = texto.replace(/,/g, '.');
      }
      // Sobrou mais de um ponto: só o último vale como decimal.
      const partes = texto.split('.');
      if (partes.length > 2) {
        texto = `${partes.slice(0, -1).join('')}.${partes[partes.length - 1]}`;
      }

      const n = Number(negativo ? `-${texto}` : texto);
      return Number.isFinite(n) ? { valor: n } : { invalido: true };
    }

    /** Leva o usuário até o campo problemático e avisa. */
    function reprovar(aba, campoId, mensagem) {
      activateTab(get(aba));
      const campo = get(campoId);
      campo?.classList.add('border-red-500');
      campo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      campo?.focus();
      setTimeout(() => campo?.classList.remove('border-red-500'), 2000);
      showToast(mensagem, 'error');
      return null;
    }

    /**
     * Valida e monta o payload. Devolve `null` quando algo falta, já tendo
     * levado o usuário até o campo — validar em silêncio numa aba escondida
     * deixa o botão "Registrar" parecendo quebrado.
     */
    function coletarDados() {
      const nomeFantasia = valor('prosNomeFantasia');
      if (!nomeFantasia) {
        return reprovar('tab-pros-empresa', 'prosNomeFantasia', 'Informe o nome da empresa');
      }

      const prob = numero('prosProbabilidade');
      if (prob.invalido) {
        return reprovar('tab-pros-oportunidade', 'prosProbabilidade', 'Probabilidade inválida');
      }
      if (!prob.vazio && (prob.valor < 0 || prob.valor > 100)) {
        return reprovar('tab-pros-oportunidade', 'prosProbabilidade', 'Probabilidade deve ficar entre 0 e 100');
      }

      const val = numero('prosValorEstimado');
      if (val.invalido) {
        return reprovar('tab-pros-oportunidade', 'prosValorEstimado', 'Valor estimado inválido');
      }
      if (!val.vazio && val.valor < 0) {
        return reprovar('tab-pros-oportunidade', 'prosValorEstimado', 'Valor estimado não pode ser negativo');
      }

      const probabilidade = prob.vazio ? null : prob.valor;
      const valorEstimado = val.vazio ? null : val.valor;

      const responsavelBruto = valor('prosResponsavel');

      const dados = {
        nome_fantasia: nomeFantasia,
        razao_social: valor('prosRazaoSocial') || null,
        segmento: valor('prosSegmento') || null,
        cnpj: valor('prosCnpj') || null,
        inscricao_estadual: valor('prosInscricaoEstadual') || null,
        site: valor('prosSite') || null,
        origem: valor('prosOrigem') || null,
        etapa: valor('prosEtapa') || 'Novo',
        valor_estimado: valorEstimado ?? 0,
        responsavel_id: responsavelBruto ? Number(responsavelBruto) : null,
        proximo_passo: valor('prosProximoPasso') || null,
        proximo_passo_data: valor('prosProximoPassoData') || null,
        anotacoes: valor('prosAnotacoes') || null,
        endereco: {
          rua: valor('endRua') || null,
          numero: valor('endNumero') || null,
          complemento: valor('endComplemento') || null,
          bairro: valor('endBairro') || null,
          cidade: valor('endCidade') || null,
          pais: valor('endPais') || null,
          estado: valor('endEstado') || null,
          cep: valor('endCep') || null
        }
      };

      // Só envia probabilidade quando há valor: assim o backend aplica o padrão
      // da etapa em vez de gravar zero por engano.
      if (probabilidade !== null) dados.probabilidade = probabilidade;

      if (modo === 'novo') {
        dados.contatos = contatos.map(({ status, indice, id, ...resto }) => resto);
      } else {
        dados.contatosNovos = contatos
          .filter(c => c.status === 'new')
          .map(({ status, indice, id, ...resto }) => resto);
        dados.contatosAtualizados = contatos
          .filter(c => c.status === 'updated' && c.id)
          .map(({ status, indice, ...resto }) => resto);
        dados.contatosExcluidos = contatosExcluidos.slice();
      }

      return dados;
    }

    // -----------------------------------------------------------------
    // API do controlador
    // -----------------------------------------------------------------
    popularEtapas();
    ligarSincroniaProbabilidade();
    renderContatos();

    return {
      modo,
      activateTab,
      tabs,
      coletarDados,
      preencherCampos,
      carregarResponsaveis,
      configurarGeografia,
      renderContatos,
      abaAtiva: () => tabs.find(t => t.getAttribute('aria-selected') === 'true')?.id || null,
      getContatos: () => contatos.map(c => ({ ...c })),
      setContatos: lista => {
        contatos = (Array.isArray(lista) ? lista : []).map(c => ({ ...c }));
        renderContatos();
      },
      getExcluidos: () => contatosExcluidos.slice(),
      setExcluidos: lista => {
        contatosExcluidos.length = 0;
        (Array.isArray(lista) ? lista : []).forEach(id => contatosExcluidos.push(id));
      },
      // Chamado ao fechar: sem isto o ouvinte sobrevive ao modal e um segundo
      // cadastro receberia os contatos do primeiro.
      destruir: () => window.removeEventListener('prospeccaoContatoSalvo', aoSalvarContato)
    };
  }

  window.ProspeccaoForm = { criar, PROBABILIDADE_POR_ETAPA, ETAPAS_PADRAO };
})();
