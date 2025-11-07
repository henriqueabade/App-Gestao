(async () => {
  const overlayId = 'detalhesModeloPermissao';
  const overlay = document.getElementById('detalhesModeloPermissaoOverlay');
  if (!overlay) return;

  const context = window.usuarioModeloPermissaoDetalheContext || {};
  delete window.usuarioModeloPermissaoDetalheContext;

  if (!context || !context.modelo) {
    Modal.close(overlayId);
    return;
  }

  const elements = {
    voltar: document.getElementById('detalhesModeloPermissaoVoltar'),
    titulo: document.getElementById('detalhesModeloPermissaoTitulo'),
    atualizado: document.getElementById('detalhesModeloPermissaoAtualizado'),
    nome: document.getElementById('detalhesModeloPermissaoNome'),
    descricao: document.getElementById('detalhesModeloPermissaoDescricao'),
    resumoModulos: document.getElementById('detalhesModeloPermissaoResumoModulos'),
    resumoAcoes: document.getElementById('detalhesModeloPermissaoResumoAcoes'),
    resumoCampos: document.getElementById('detalhesModeloPermissaoResumoCampos'),
    tabModulos: overlay.querySelector('[data-tab="modulos"]'),
    tabPermissoes: overlay.querySelector('[data-tab="permissoes"]'),
    painelModulos: document.getElementById('detalhesModeloPermissaoModulos'),
    painelPermissoes: document.getElementById('detalhesModeloPermissaoPermissoes'),
    listaModulos: document.getElementById('detalhesModeloPermissaoModulosLista'),
    listaModulosVazio: document.getElementById('detalhesModeloPermissaoModulosVazio'),
    listaAcordeoes: document.getElementById('detalhesModeloPermissaoAcordeoes'),
    listaAcordeoesVazio: document.getElementById('detalhesModeloPermissaoPermissoesVazio'),
  };

  const templates = {
    modulo: document.getElementById('detalhesModeloPermissaoModuloTemplate'),
    accordion: document.getElementById('detalhesModeloPermissaoAccordionTemplate'),
    checkbox: document.getElementById('detalhesModeloPermissaoCheckboxTemplate'),
  };

  const close = () => {
    document.removeEventListener('keydown', onEsc);
    overlay.removeEventListener('click', onOverlayClick);
    Modal.close(overlayId);
  };

  const onEsc = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const onOverlayClick = (event) => {
    if (event.target === overlay) {
      close();
    }
  };

  const formatarData = (valor) => {
    if (!valor) return 'Nunca atualizado';
    const data = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(data.getTime())) return 'Nunca atualizado';
    return data.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
  };

  const normalizarTexto = (texto, fallback = '') => {
    if (!texto) return fallback;
    return String(texto).trim();
  };

  const prepararModulos = (estrutura) => {
    if (!Array.isArray(estrutura)) return [];
    return estrutura.map((modulo) => {
      const actions = [];
      const fieldsMap = new Map();
      if (Array.isArray(modulo?.campos)) {
        modulo.campos.forEach((campo) => {
          if (!campo) return;
          if (campo.tipo === 'acao') {
            actions.push({
              chave: campo.acaoChave || campo.chave || campo.acao,
              titulo: normalizarTexto(campo.titulo, normalizarTexto(campo.acao, 'Ação')),
              descricao: normalizarTexto(campo.descricao, ''),
              permitido: Boolean(campo.permitido),
            });
          } else if (campo.tipo === 'coluna') {
            const chave = campo.chave || `${campo.acaoChave || campo.acao || 'campo'}_${campo.colunaChave || campo.coluna}`;
            const existente = fieldsMap.get(chave) || {
              chave,
              titulo: normalizarTexto(campo.titulo, normalizarTexto(campo.coluna, 'Campo')), 
              descricao: normalizarTexto(campo.descricao, ''),
              permitido: false,
            };
            existente.permitido = existente.permitido || Boolean(campo.permitido);
            fieldsMap.set(chave, existente);
          }
        });
      }
      const fields = Array.from(fieldsMap.values());
      const enabled = actions.some((acao) => acao.permitido) || fields.some((campo) => campo.permitido);
      return {
        chave: modulo.chave || modulo.identificador || modulo.modulo,
        titulo: normalizarTexto(modulo.titulo, normalizarTexto(modulo.modulo, 'Módulo')),
        descricao: normalizarTexto(modulo.descricao, ''),
        enabled,
        actions,
        fields,
      };
    });
  };

  const modulosPreparados = prepararModulos(context.estrutura);
  const resumo = context.resumo || (() => {
    const resultado = { modulosAtivos: 0, acoesAtivas: 0, camposAtivos: 0 };
    modulosPreparados.forEach((modulo) => {
      if (modulo.enabled) resultado.modulosAtivos += 1;
      resultado.acoesAtivas += modulo.actions.filter((acao) => acao.permitido).length;
      resultado.camposAtivos += modulo.fields.filter((campo) => campo.permitido).length;
    });
    return resultado;
  })();

  const renderModulos = () => {
    if (!elements.listaModulos) return;
    elements.listaModulos.innerHTML = '';
    if (!modulosPreparados.length) {
      elements.listaModulos.classList.add('hidden');
      elements.listaModulosVazio?.classList.remove('hidden');
      return;
    }
    elements.listaModulos.classList.remove('hidden');
    elements.listaModulosVazio?.classList.add('hidden');
    modulosPreparados.forEach((modulo) => {
      if (!templates.modulo?.content?.firstElementChild) return;
      const card = templates.modulo.content.firstElementChild.cloneNode(true);
      card.dataset.modulo = modulo.chave || '';
      const titulo = card.querySelector('.modelo-detalhe-modulo-card__titulo');
      if (titulo) titulo.textContent = modulo.titulo;
      const descricao = card.querySelector('.modelo-detalhe-modulo-card__descricao');
      if (descricao) {
        if (modulo.descricao) {
          descricao.textContent = modulo.descricao;
          descricao.classList.remove('hidden');
        } else {
          descricao.textContent = '';
          descricao.classList.add('hidden');
        }
      }
      const status = card.querySelector('input[type="checkbox"]');
      if (status) status.checked = modulo.enabled;
      if (!modulo.enabled) {
        card.classList.add('is-desativado');
      }
      elements.listaModulos.appendChild(card);
    });
  };

  const renderPermissoes = () => {
    if (!elements.listaAcordeoes) return;
    elements.listaAcordeoes.innerHTML = '';
    if (!modulosPreparados.length) {
      elements.listaAcordeoes.classList.add('hidden');
      elements.listaAcordeoesVazio?.classList.remove('hidden');
      return;
    }
    let possuiItens = false;
    modulosPreparados.forEach((modulo, indice) => {
      if (!templates.accordion?.content?.firstElementChild) return;
      const accordion = templates.accordion.content.firstElementChild.cloneNode(true);
      accordion.dataset.modulo = modulo.chave || '';
      if (!modulo.enabled) {
        accordion.classList.add('is-desativado');
      }
      const tituloEl = accordion.querySelector('.modelo-detalhe-accordion__titulo');
      if (tituloEl) tituloEl.textContent = modulo.titulo;
      const content = accordion.querySelector('.modelo-detalhe-accordion__content');
      const toggle = accordion.querySelector('.modelo-detalhe-accordion__toggle');
      const regionId = `detalhes-modulo-${indice}`;
      if (content) {
        content.id = regionId;
        content.style.maxHeight = '0px';
      }
      if (toggle) {
        toggle.setAttribute('aria-controls', regionId);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', () => {
          const aberto = accordion.classList.toggle('is-open');
          if (content) {
            content.style.maxHeight = aberto ? `${content.scrollHeight}px` : '0px';
          }
          toggle.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        });
      }
      const areaAcoes = accordion.querySelector('[data-area="acoes"]');
      const areaCampos = accordion.querySelector('[data-area="campos"]');
      if (Array.isArray(modulo.actions) && modulo.actions.length) {
        possuiItens = true;
        modulo.actions.forEach((acao) => {
          if (!templates.checkbox?.content?.firstElementChild || !areaAcoes) return;
          const checkbox = templates.checkbox.content.firstElementChild.cloneNode(true);
          const input = checkbox.querySelector('input[type="checkbox"]');
          const titulo = checkbox.querySelector('.modelo-detalhe-checkbox__titulo');
          const descricao = checkbox.querySelector('.modelo-detalhe-checkbox__descricao');
          if (input) input.checked = acao.permitido;
          if (titulo) titulo.textContent = acao.titulo;
          if (descricao) {
            if (acao.descricao) {
              descricao.textContent = acao.descricao;
              descricao.classList.remove('hidden');
            } else {
              descricao.textContent = '';
              descricao.classList.add('hidden');
            }
          }
          areaAcoes.appendChild(checkbox);
        });
      } else if (areaAcoes) {
        areaAcoes.innerHTML = '<p class="modelo-detalhe-accordion__mensagem">Nenhuma ação liberada.</p>';
      }
      if (Array.isArray(modulo.fields) && modulo.fields.length) {
        possuiItens = true;
        modulo.fields.forEach((campo) => {
          if (!templates.checkbox?.content?.firstElementChild || !areaCampos) return;
          const checkbox = templates.checkbox.content.firstElementChild.cloneNode(true);
          const input = checkbox.querySelector('input[type="checkbox"]');
          const titulo = checkbox.querySelector('.modelo-detalhe-checkbox__titulo');
          const descricao = checkbox.querySelector('.modelo-detalhe-checkbox__descricao');
          if (input) input.checked = campo.permitido;
          if (titulo) titulo.textContent = campo.titulo;
          if (descricao) {
            if (campo.descricao) {
              descricao.textContent = campo.descricao;
              descricao.classList.remove('hidden');
            } else {
              descricao.textContent = '';
              descricao.classList.add('hidden');
            }
          }
          areaCampos.appendChild(checkbox);
        });
      } else if (areaCampos) {
        areaCampos.innerHTML = '<p class="modelo-detalhe-accordion__mensagem">Nenhum campo liberado.</p>';
      }
      elements.listaAcordeoes.appendChild(accordion);
    });
    if (!possuiItens) {
      elements.listaAcordeoes.classList.add('hidden');
      elements.listaAcordeoesVazio?.classList.remove('hidden');
    } else {
      elements.listaAcordeoes.classList.remove('hidden');
      elements.listaAcordeoesVazio?.classList.add('hidden');
    }
  };

  const ativarTab = (tab) => {
    const tabs = [elements.tabModulos, elements.tabPermissoes];
    const paineis = {
      modulos: elements.painelModulos,
      permissoes: elements.painelPermissoes,
    };
    tabs.forEach((botao) => {
      const ativo = botao?.dataset?.tab === tab;
      botao?.classList.toggle('modelo-detalhe-tab--active', ativo);
      botao?.setAttribute('aria-selected', ativo ? 'true' : 'false');
    });
    Object.entries(paineis).forEach(([chave, painel]) => {
      if (!painel) return;
      if (chave === tab) {
        painel.classList.remove('hidden');
      } else {
        painel.classList.add('hidden');
      }
    });
  };

  if (elements.tabModulos) {
    elements.tabModulos.addEventListener('click', () => ativarTab('modulos'));
  }
  if (elements.tabPermissoes) {
    elements.tabPermissoes.addEventListener('click', () => ativarTab('permissoes'));
  }

  renderModulos();
  renderPermissoes();
  ativarTab('modulos');

  elements.titulo.textContent = context.modelo?.nome || 'Modelo de Permissões';
  elements.nome.textContent = context.modelo?.nome || 'Modelo sem nome';
  if (elements.descricao) {
    if (context.modelo?.descricao) {
      elements.descricao.textContent = context.modelo.descricao;
      elements.descricao.classList.remove('hidden');
    } else {
      elements.descricao.textContent = 'Resumo das permissões aplicadas neste modelo.';
      elements.descricao.classList.remove('hidden');
    }
  }
  if (elements.atualizado) {
    const atualizadoEm = context.modelo?.atualizadoEm || context.modelo?.criadoEm;
    elements.atualizado.textContent = atualizadoEm ? `Atualizado em ${formatarData(atualizadoEm)}` : '';
  }
  if (elements.resumoModulos) elements.resumoModulos.textContent = resumo.modulosAtivos ?? 0;
  if (elements.resumoAcoes) elements.resumoAcoes.textContent = resumo.acoesAtivas ?? 0;
  if (elements.resumoCampos) elements.resumoCampos.textContent = resumo.camposAtivos ?? 0;

  overlay.classList.remove('hidden');
  overlay.removeAttribute('aria-hidden');

  overlay.addEventListener('click', onOverlayClick);
  document.addEventListener('keydown', onEsc);
  elements.voltar?.addEventListener('click', close);

  if (typeof Modal?.signalReady === 'function') {
    Modal.signalReady(overlayId);
  }
})();
