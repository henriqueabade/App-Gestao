// Modal de modelos de permissão
(function () {
  // ----- CONTROLE DO MODAL (overlay/fechar) -----
  const overlay = document.getElementById('permissoesOverlay');
  const close = () => {
    if (typeof Modal !== 'undefined') {
      Modal.close('permissoes');
    } else {
      // fallback caso Modal não exista
      overlay.remove();
    }
  };

  if (overlay) {
    // Clique fora fecha
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  const voltarBtn = document.getElementById('voltarPermissoes');
  if (voltarBtn) {
    voltarBtn.addEventListener('click', () => {
      permissionRenderer.resetForm();
      close();
    });
  }

  const cancelarBtn = document.getElementById('btnCancelar');
  if (cancelarBtn) {
    cancelarBtn.addEventListener('click', () => {
      permissionRenderer.resetForm();
      close();
    });
  }

  // ESC fecha
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      permissionRenderer.resetForm();
      close();
      document.removeEventListener('keydown', esc);
    }
  });

  // ----- RENDERER DE PERMISSÕES (CÓDIGO ORIGINAL ORGANIZADO) -----
  const permissionRenderer = {
    // Estado
    state: {
      currentTemplate: null,
      isNewTemplate: false,
      templates: {},
      moduleAccess: {} // simulação de roles_modules_matrix
    },

    // Mapeamento dos módulos (banco → UI)
    moduleStructure: {
      mp: {
        name: 'Matéria-Prima',
        icon: '📦',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: [
          'mp_codigo',
          'mp_nome',
          'mp_categoria',
          'mp_unidade',
          'mp_estoque_atual',
          'mp_estoque_min',
          'mp_custo_medio',
          'mp_fornecedor',
          'mp_status',
          'mp_atualizado_em',
          'mov_data',
          'mov_tipo',
          'mov_qtd',
          'mov_ref',
          'mov_usuario',
          'proc_nome',
          'proc_duracao',
          'proc_custo',
          'proc_ordem',
          'cat_nome',
          'cat_desc',
          'cat_itens',
          'und_sigla',
          'und_desc',
          'und_precision'
        ]
      },
      prod: {
        name: 'Produtos',
        icon: '🏷️',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: [
          'prod_sku',
          'prod_nome',
          'prod_colecao',
          'prod_categoria',
          'prod_preco_base',
          'prod_custo_total',
          'prod_margem',
          'prod_estoque',
          'prod_etapa_atual',
          'prod_status',
          'prod_atualizado_em',
          'etp_ordem',
          'etp_nome',
          'etp_resp',
          'etp_inicio',
          'etp_fim',
          'etp_tempo_real',
          'ins_mp',
          'ins_qtd',
          'ins_custo_un',
          'ins_custo_total',
          'var_nome',
          'var_estoque',
          'var_reservado',
          'var_disponivel',
          'col_nome',
          'col_periodo',
          'col_status',
          'col_itens'
        ]
      },
      orc: {
        name: 'Orçamentos',
        icon: '💰',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: [
          'orc_num',
          'orc_cliente',
          'orc_vendedor',
          'orc_data',
          'orc_validade',
          'orc_itens',
          'orc_subtotal',
          'orc_desc',
          'orc_frete_outros',
          'orc_total',
          'orc_status',
          'it_nome',
          'it_sku',
          'it_qtd',
          'it_preco',
          'it_desc',
          'it_subtotal',
          'it_obs',
          'cond_pagto',
          'cond_parc',
          'cond_prazo',
          'cond_validade'
        ]
      },
      ped: {
        name: 'Pedidos',
        icon: '📋',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: [
          'ped_num',
          'ped_cliente',
          'ped_vendedor',
          'ped_data',
          'ped_entrega',
          'ped_itens',
          'ped_total',
          'ped_abate_estoque',
          'ped_status',
          'ped_origem',
          'it_nome_ped',
          'it_sku_ped',
          'it_qtd_ped',
          'it_preco_ped',
          'it_desc_ped',
          'it_subtotal_ped',
          'it_situacao',
          'log_transportadora',
          'log_cod_rastreio',
          'log_frete_valor',
          'log_data_envio',
          'log_data_entrega'
        ]
      },
      cli: {
        name: 'Clientes',
        icon: '👥',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: [
          'cli_nome_fantasia',
          'cli_razao_social',
          'cli_cnpj',
          'cli_comprador',
          'cli_tel',
          'cli_email',
          'cli_cidade_uf',
          'cli_transportadora',
          'cli_status',
          'cli_owner',
          'end_tipo',
          'end_logradouro',
          'end_numero',
          'end_complemento',
          'end_bairro',
          'end_cidade',
          'end_uf',
          'end_cep',
          'ctt_nome',
          'ctt_cargo',
          'ctt_tel',
          'ctt_email',
          'ctt_tags',
          'ctt_status',
          'ctt_ult_interacao'
        ]
      },
      pros: {
        name: 'Prospecções',
        icon: '🎯',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: [
          'pros_id',
          'pros_entidade',
          'pros_origem',
          'pros_etapa',
          'pros_valor',
          'pros_prob',
          'pros_owner',
          'pros_proximo_passo',
          'pros_proximo_passo_data',
          'pros_atualizado_em',
          'hist_data',
          'hist_tipo',
          'hist_resumo',
          'hist_resp'
        ]
      },
      ctt: {
        name: 'Contatos',
        icon: '📞',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: [
          'ctt_nome_lista',
          'ctt_cliente',
          'ctt_cargo_lista',
          'ctt_tel_lista',
          'ctt_email_lista',
          'ctt_origem',
          'ctt_tags_lista',
          'ctt_status_lista',
          'ctt_ult_interacao_lista',
          'ctt_owner',
          'log_data_ctt',
          'log_canal',
          'log_assunto',
          'log_detalhes',
          'log_resp_ctt'
        ]
      },
      rel_vendas_periodo: {
        name: 'Rel. Vendas por Período',
        icon: '📊',
        actions: ['pode_listar', 'pode_ver', 'pode_exportar'],
        columns: ['rel_periodo', 'rel_cliente', 'rel_total', 'rel_pedidos', 'rel_ticket_medio']
      },
      rel_estoque: {
        name: 'Rel. Estoque',
        icon: '📈',
        actions: ['pode_listar', 'pode_ver', 'pode_exportar'],
        columns: ['rel_item', 'rel_saldo', 'rel_valor', 'rel_giro']
      },
      rel_prospeccoes: {
        name: 'Rel. Prospecções',
        icon: '📉',
        actions: ['pode_listar', 'pode_ver', 'pode_exportar'],
        columns: ['rel_etapa', 'rel_qtd', 'rel_valor', 'rel_taxa_conv']
      },
      tarefas: {
        name: 'Tarefas',
        icon: '✅',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: ['tsk_titulo', 'tsk_resp', 'tsk_prazo', 'tsk_status', 'tsk_prioridade']
      },
      agenda: {
        name: 'Agenda',
        icon: '📅',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: ['evt_titulo', 'evt_inicio', 'evt_fim', 'evt_local', 'evt_participantes', 'evt_status']
      },
      cfg_roles: {
        name: 'Config. Perfis',
        icon: '🔐',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: ['role_code', 'role_name', 'role_desc', 'role_modulos', 'role_features']
      },
      cfg_integrations: {
        name: 'Config. Integrações',
        icon: '🔗',
        actions: ['pode_listar', 'pode_ver', 'pode_criar', 'pode_editar', 'pode_excluir', 'pode_exportar'],
        columns: ['int_nome', 'int_status', 'int_ult_sync']
      }
    },

    // Init (chamado quando o modal é carregado)
    init() {
      this.simulateModuleAccess();
      this.loadFromStorage();
      this.renderPermissions();
      this.initControls();
      this.loadTemplates();
      this.updateCheckboxStates();
    },

    // Load/save templates em localStorage
    loadFromStorage() {
      const stored = localStorage.getItem('permissionTemplates');
      if (stored) {
        this.state.templates = JSON.parse(stored);
      } else {
        this.state.templates = {
          admin: {
            name: 'Administrador Completo',
            permissions: this.generateFullPermissions()
          },
          vendedor: {
            name: 'Vendedor',
            permissions: {
              'mp.pode_listar': true,
              'mp.pode_ver': true,
              'prod.pode_listar': true,
              'prod.pode_ver': true,
              'orc.pode_listar': true,
              'orc.pode_ver': true,
              'orc.pode_criar': true,
              'cli.pode_listar': true,
              'cli.pode_ver': true
            }
          }
        };
        this.saveToStorage();
      }
    },

    saveToStorage() {
      localStorage.setItem('permissionTemplates', JSON.stringify(this.state.templates));
    },

    // Simulação roles_modules_matrix
    simulateModuleAccess() {
      this.state.moduleAccess = {
        mp: true,
        prod: true,
        orc: true,
        ped: true,
        cli: true,
        pros: false,
        ctt: true,
        rel_vendas_periodo: true,
        rel_estoque: true,
        rel_prospeccoes: false,
        tarefas: true,
        agenda: true,
        cfg_roles: true,
        cfg_integrations: false
      };
    },

    // Gera um template "full access"
    generateFullPermissions() {
      const permissions = {};
      Object.keys(this.moduleStructure).forEach((moduleKey) => {
        const module = this.moduleStructure[moduleKey];

        module.actions.forEach((action) => {
          permissions[`${moduleKey}.${action}`] = true;
        });

        module.columns.forEach((column) => {
          permissions[`${moduleKey}.${column}`] = true;
        });
      });
      return permissions;
    },

    // Controles de seleção de modelo
    initControls() {
      const selectModelo = document.getElementById('selectModelo');
      const btnCarregar = document.getElementById('btnCarregar');
      const btnNovo = document.getElementById('btnNovo');
      const btnSalvar = document.getElementById('btnSalvar');
      const btnExcluir = document.getElementById('btnExcluir');
      const nomeModelo = document.getElementById('nomeModelo');

      if (!selectModelo) return;

      selectModelo.addEventListener('change', (e) => {
        const hasSelection = e.target.value !== '';
        btnCarregar.disabled = !hasSelection;
        btnExcluir.disabled = !hasSelection;

        if (hasSelection) {
          this.state.currentTemplate = e.target.value;
          this.state.isNewTemplate = false;
          document.getElementById('inputNomeModelo').classList.add('hidden');
          btnSalvar.disabled = false;
        } else {
          this.state.currentTemplate = null;
          btnSalvar.disabled = true;
        }
      });

      btnCarregar.addEventListener('click', () => this.applyTemplate());
      btnNovo.addEventListener('click', () => this.newTemplate());
      btnSalvar.addEventListener('click', () => this.saveTemplate());
      btnExcluir.addEventListener('click', () => this.deleteTemplate());

      nomeModelo.addEventListener('input', (e) => {
        btnSalvar.disabled = e.target.value.trim() === '';
      });
    },

    // Carrega lista de modelos no select
    loadTemplates() {
      const select = document.getElementById('selectModelo');
      if (!select) return;

      while (select.children.length > 1) {
        select.removeChild(select.lastChild);
      }

      Object.keys(this.state.templates).forEach((key) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = this.state.templates[key].name;
        select.appendChild(option);
      });
    },

    // Aplica modelo selecionado
    applyTemplate() {
      if (!this.state.currentTemplate || !this.state.templates[this.state.currentTemplate]) return;

      const template = this.state.templates[this.state.currentTemplate];

      document.querySelectorAll('[data-permission]').forEach((cb) => {
        cb.checked = false;
      });

      Object.entries(template.permissions).forEach(([permission, enabled]) => {
        const checkbox = document.querySelector(`[data-permission="${permission}"]`);
        if (checkbox) {
          checkbox.checked = enabled;
        }
      });

      this.updateCheckboxStates();
      this.showToast(`Modelo "${template.name}" carregado`);
    },

    // Cria novo modelo (limpa tudo)
    newTemplate() {
      this.state.isNewTemplate = true;
      this.state.currentTemplate = null;

      document.getElementById('selectModelo').value = '';
      document.getElementById('inputNomeModelo').classList.remove('hidden');
      document.getElementById('nomeModelo').focus();

      document.querySelectorAll('[data-permission]').forEach((cb) => {
        cb.checked = false;
      });

      this.updateCheckboxStates();

      document.getElementById('btnCarregar').disabled = true;
      document.getElementById('btnExcluir').disabled = true;
      document.getElementById('btnSalvar').disabled = false;

      this.showToast('Novo modelo criado - configure as permissões');
    },

    // Salva modelo (novo ou existente)
    async saveTemplate() {
      const btnSalvar = document.getElementById('btnSalvar');
      const spinner = btnSalvar.querySelector('.loading-spinner');
      const btnText = btnSalvar.querySelector('.btn-text');
      const nomeModelo = document.getElementById('nomeModelo');

      spinner.classList.remove('hidden');
      btnText.textContent = 'Salvando...';
      btnSalvar.disabled = true;

      try {
        let templateName, templateKey;

        if (this.state.isNewTemplate) {
          templateName = nomeModelo.value.trim();
          if (!templateName) {
            throw new Error('Nome do modelo é obrigatório');
          }
          templateKey = templateName.toLowerCase().replace(/\s+/g, '_');
        } else {
          templateKey = this.state.currentTemplate;
          templateName = this.state.templates[templateKey].name;
        }

        const payload = this.buildPayload(templateName);

        this.state.templates[templateKey] = {
          name: templateName,
          permissions: payload.permissions
        };

        this.saveToStorage();

        if (this.state.isNewTemplate) {
          const select = document.getElementById('selectModelo');
          const option = document.createElement('option');
          option.value = templateKey;
          option.textContent = templateName;
          select.appendChild(option);
          select.value = templateKey;
          this.state.currentTemplate = templateKey;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        console.log('Template JSON for API:', JSON.stringify(payload, null, 2));

        this.showToast(`Modelo "${templateName}" salvo com sucesso!`);

        if (this.state.isNewTemplate) {
          document.getElementById('inputNomeModelo').classList.add('hidden');
          nomeModelo.value = '';
          this.state.isNewTemplate = false;
          document.getElementById('btnExcluir').disabled = false;
        }
      } catch (error) {
        this.showToast(error.message || 'Erro ao salvar modelo');
      } finally {
        spinner.classList.add('hidden');
        btnText.textContent = 'Salvar';
        btnSalvar.disabled = false;
      }
    },

    // Exclusão de modelo
    deleteTemplate() {
      if (!this.state.currentTemplate) return;

      const btnExcluir = document.getElementById('btnExcluir');
      const originalText = btnExcluir.innerHTML;

      btnExcluir.innerHTML = 'Confirmar Exclusão?';
      btnExcluir.classList.add('bg-red-700');

      const confirmDelete = () => {
        delete this.state.templates[this.state.currentTemplate];
        this.saveToStorage();

        const option = document.querySelector(`option[value="${this.state.currentTemplate}"]`);
        if (option) option.remove();

        this.showToast('Modelo excluído com sucesso');
        this.resetForm();

        btnExcluir.innerHTML = originalText;
        btnExcluir.classList.remove('bg-red-700');
        btnExcluir.removeEventListener('click', confirmDelete);
      };

      const cancelDelete = () => {
        btnExcluir.innerHTML = originalText;
        btnExcluir.classList.remove('bg-red-700');
        btnExcluir.removeEventListener('click', confirmDelete);
      };

      btnExcluir.addEventListener('click', confirmDelete);
      setTimeout(cancelDelete, 3000);
    },

    // Monta payload final (roles_modules_matrix + permissões detalhadas)
    buildPayload(templateName) {
      const permissions = {};

      document.querySelectorAll('[data-permission]').forEach((checkbox) => {
        permissions[checkbox.dataset.permission] = checkbox.checked;
      });

      const payload = {
        name: templateName,
        roles_modules_matrix: {},
        permissions: {}
      };

      Object.keys(this.moduleStructure).forEach((moduleKey) => {
        const module = this.moduleStructure[moduleKey];

        const hasPermissions = [...module.actions, ...module.columns].some(
          (item) => permissions[`${moduleKey}.${item}`]
        );

        payload.roles_modules_matrix[moduleKey] = hasPermissions;

        const modulePermissions = {};

        module.actions.forEach((action) => {
          modulePermissions[action] = permissions[`${moduleKey}.${action}`] || false;
        });

        module.columns.forEach((column) => {
          modulePermissions[column] = permissions[`${moduleKey}.${column}`] || false;
        });

        payload.permissions[`perm_${moduleKey}`] = modulePermissions;
      });

      return payload;
    },

    // Renderização de toda a árvore de permissões
    renderPermissions() {
      const container = document.getElementById('permissionsContainer');
      if (!container) return;

      container.innerHTML = '';

      Object.keys(this.moduleStructure).forEach((moduleKey) => {
        const module = this.moduleStructure[moduleKey];
        const moduleDiv = this.createModuleElement(moduleKey, module);
        container.appendChild(moduleDiv);
      });

      this.initCheckboxBehaviors();
    },

    // Construção de cada bloco de módulo
    createModuleElement(moduleKey, module) {
      const isDisabled = !this.state.moduleAccess[moduleKey];

      const moduleDiv = document.createElement('div');
      moduleDiv.className = `mb-6 ${isDisabled ? 'module-disabled' : ''}`;

      moduleDiv.innerHTML = `
        <div class="bg-white/5 rounded-xl border border-white/10">
          <!-- Cabeçalho do módulo -->
          <div class="p-4 border-b border-white/10 cursor-pointer hover:bg-white/5 transition-colors" data-toggle="${moduleKey}">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <input type="checkbox" class="checkbox-custom module-checkbox" data-module="${moduleKey}" aria-label="Módulo ${module.name}" ${isDisabled ? 'disabled' : ''}>
                <div class="w-8 h-8 bg-blue-500/20 text-blue-400 rounded-lg flex items-center justify-center text-sm">
                  ${module.icon}
                </div>
                <h3 class="text-white font-medium">${module.name}</h3>
                ${
                  isDisabled
                    ? '<span class="warning-badge text-xs px-2 py-1 rounded">Módulo desabilitado</span>'
                    : ''
                }
              </div>
              <div class="flex items-center gap-3">
                ${
                  !isDisabled
                    ? `<button class="text-xs text-[#b6a03e] hover:text-[#d4c169] transition-colors" data-select-all="${moduleKey}">Marcar Tudo</button>`
                    : ''
                }
                <svg class="w-5 h-5 text-gray-400 transform transition-transform toggle-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Conteúdo do módulo -->
          <div class="hidden accordion-content p-4 space-y-6" data-content="${moduleKey}">
            <!-- Ações -->
            <div>
              <div class="flex items-center gap-3 mb-3">
                <input type="checkbox" class="checkbox-custom section-checkbox" data-section="${moduleKey}-actions" aria-label="Todas as ações de ${module.name}" ${isDisabled ? 'disabled' : ''}>
                <h4 class="text-[#b6a03e] font-medium">Ações</h4>
                ${
                  !isDisabled
                    ? `<button class="text-xs text-[#b6a03e] hover:text-[#d4c169] transition-colors ml-auto" data-select-section="${moduleKey}-actions">Marcar Tudo</button>`
                    : ''
                }
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 ml-6" data-group="${moduleKey}-actions">
                ${module.actions
                  .map(
                    (action) => `
                  <label class="flex items-center gap-2 p-2 rounded hover:bg-white/5 cursor-pointer">
                    <input type="checkbox" class="checkbox-custom" data-permission="${moduleKey}.${action}" aria-label="${action}" ${isDisabled ? 'disabled' : ''}>
                    <span class="text-sm text-white">${this.formatPermissionName(action)}</span>
                  </label>
                `
                  )
                  .join('')}
              </div>
            </div>

            <!-- Colunas -->
            <div>
              <div class="flex items-center gap-3 mb-3">
                <input type="checkbox" class="checkbox-custom section-checkbox" data-section="${moduleKey}-columns" aria-label="Todas as colunas de ${module.name}" ${isDisabled ? 'disabled' : ''}>
                <h4 class="text-[#b6a03e] font-medium">Colunas</h4>
                ${
                  !isDisabled
                    ? `<button class="text-xs text-[#b6a03e] hover:text-[#d4c169] transition-colors ml-auto" data-select-section="${moduleKey}-columns">Marcar Tudo</button>`
                    : ''
                }
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 ml-6" data-group="${moduleKey}-columns">
                ${module.columns
                  .map(
                    (column) => `
                  <label class="flex items-center gap-2 p-2 rounded hover:bg-white/5 cursor-pointer">
                    <input type="checkbox" class="checkbox-custom" data-permission="${moduleKey}.${column}" aria-label="${column}" ${isDisabled ? 'disabled' : ''}>
                    <span class="text-sm text-white">${this.formatColumnName(column)}</span>
                  </label>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </div>
      `;

      return moduleDiv;
    },

    formatPermissionName(permission) {
      const names = {
        pode_listar: 'Listar',
        pode_ver: 'Ver',
        pode_criar: 'Criar',
        pode_editar: 'Editar',
        pode_excluir: 'Excluir',
        pode_exportar: 'Exportar'
      };
      return names[permission] || permission;
    },

    formatColumnName(column) {
      return column
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase());
    },

    // Comportamento dos checkboxes
    initCheckboxBehaviors() {
      // Toggle accordion
      document.querySelectorAll('[data-toggle]').forEach((toggle) => {
        toggle.addEventListener('click', (e) => {
          if (e.target.type === 'checkbox' || e.target.tagName === 'BUTTON') return;

          const moduleKey = toggle.dataset.toggle;
          const content = document.querySelector(`[data-content="${moduleKey}"]`);
          const icon = toggle.querySelector('.toggle-icon');

          if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            content.classList.add('open');
            icon.style.transform = 'rotate(180deg)';
          } else {
            content.classList.add('hidden');
            content.classList.remove('open');
            icon.style.transform = 'rotate(0deg)';
          }
        });
      });

      // Checkbox de módulo
      document.querySelectorAll('.module-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const moduleKey = checkbox.dataset.module;
          const isChecked = checkbox.checked;

          const moduleContent = document.querySelector(`[data-content="${moduleKey}"]`);
          if (!moduleContent) return;

          const allCheckboxes = moduleContent.querySelectorAll(
            'input[type="checkbox"]:not(.module-checkbox):not(.section-checkbox)'
          );

          allCheckboxes.forEach((cb) => {
            if (!cb.disabled) cb.checked = isChecked;
          });

          this.updateCheckboxStates();
        });
      });

      // Checkbox de seção (ações/colunas)
      document.querySelectorAll('.section-checkbox').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const section = checkbox.dataset.section;
          const isChecked = checkbox.checked;

          const sectionContent = document.querySelector(`[data-group="${section}"]`);
          if (!sectionContent) return;

          const sectionCheckboxes = sectionContent.querySelectorAll('input[type="checkbox"]');

          sectionCheckboxes.forEach((cb) => {
            if (!cb.disabled) cb.checked = isChecked;
          });

          this.updateCheckboxStates();
        });
      });

      // Checkboxes individuais
      document.querySelectorAll('[data-permission]').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          this.updateCheckboxStates();
        });
      });

      // Botão "Marcar tudo" do módulo
      document.querySelectorAll('[data-select-all]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const moduleKey = btn.dataset.selectAll;
          const moduleContent = document.querySelector(`[data-content="${moduleKey}"]`);
          if (!moduleContent) return;

          const allCheckboxes = moduleContent.querySelectorAll(
            'input[type="checkbox"]:not(.module-checkbox):not(.section-checkbox)'
          );

          allCheckboxes.forEach((cb) => {
            if (!cb.disabled) cb.checked = true;
          });

          this.updateCheckboxStates();
        });
      });

      // Botão "Marcar tudo" da seção
      document.querySelectorAll('[data-select-section]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const section = btn.dataset.selectSection;
          const sectionContent = document.querySelector(`[data-group="${section}"]`);
          if (!sectionContent) return;

          const sectionCheckboxes = sectionContent.querySelectorAll('input[type="checkbox"]');

          sectionCheckboxes.forEach((cb) => {
            if (!cb.disabled) cb.checked = true;
          });

          this.updateCheckboxStates();
        });
      });
    },

    // Atualiza estados de "indeterminado" de seções/módulos
    updateCheckboxStates() {
      // Seções
      document.querySelectorAll('.section-checkbox').forEach((sectionCheckbox) => {
        if (sectionCheckbox.disabled) return;

        const section = sectionCheckbox.dataset.section;
        const sectionContent = document.querySelector(`[data-group="${section}"]`);
        if (!sectionContent) return;

        const sectionCheckboxes = Array.from(
          sectionContent.querySelectorAll('input[type="checkbox"]:not([disabled])')
        );
        const checkedCount = sectionCheckboxes.filter((cb) => cb.checked).length;
        const totalCount = sectionCheckboxes.length;

        if (checkedCount === 0) {
          sectionCheckbox.checked = false;
          sectionCheckbox.indeterminate = false;
        } else if (checkedCount === totalCount) {
          sectionCheckbox.checked = true;
          sectionCheckbox.indeterminate = false;
        } else {
          sectionCheckbox.checked = false;
          sectionCheckbox.indeterminate = true;
        }
      });

      // Módulos
      document.querySelectorAll('.module-checkbox').forEach((moduleCheckbox) => {
        if (moduleCheckbox.disabled) return;

        const module = moduleCheckbox.dataset.module;
        const moduleContent = document.querySelector(`[data-content="${module}"]`);
        if (!moduleContent) return;

        const allCheckboxes = Array.from(
          moduleContent.querySelectorAll(
            'input[type="checkbox"]:not(.section-checkbox):not(.module-checkbox):not([disabled])'
          )
        );
        const checkedCount = allCheckboxes.filter((cb) => cb.checked).length;
        const totalCount = allCheckboxes.length;

        if (checkedCount === 0) {
          moduleCheckbox.checked = false;
          moduleCheckbox.indeterminate = false;
        } else if (checkedCount === totalCount) {
          moduleCheckbox.checked = true;
          moduleCheckbox.indeterminate = false;
        } else {
          moduleCheckbox.checked = false;
          moduleCheckbox.indeterminate = true;
        }
      });
    },

    // Reset geral do form (usado ao fechar/cancelar)
    resetForm() {
      const selectModelo = document.getElementById('selectModelo');
      const inputNomeModelo = document.getElementById('inputNomeModelo');
      const nomeModelo = document.getElementById('nomeModelo');

      if (selectModelo) selectModelo.value = '';
      if (inputNomeModelo) inputNomeModelo.classList.add('hidden');
      if (nomeModelo) nomeModelo.value = '';

      this.state.currentTemplate = null;
      this.state.isNewTemplate = false;

      const btnCarregar = document.getElementById('btnCarregar');
      const btnExcluir = document.getElementById('btnExcluir');
      const btnSalvar = document.getElementById('btnSalvar');

      if (btnCarregar) btnCarregar.disabled = true;
      if (btnExcluir) btnExcluir.disabled = true;
      if (btnSalvar) btnSalvar.disabled = true;

      document.querySelectorAll('[data-permission]').forEach((cb) => {
        cb.checked = false;
      });

      this.updateCheckboxStates();
    },

    // Toast simples
    showToast(message) {
      const toast = document.createElement('div');
      toast.className =
        'toast fixed top-4 right-4 z-[2200] rounded-lg p-4 shadow-lg transform translate-x-0 transition-transform duration-300';

      toast.innerHTML = `
        <div class="flex items-center gap-3">
          <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
          </svg>
          <span class="text-white font-medium text-sm">${message}</span>
        </div>
      `;

      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
          if (document.body.contains(toast)) {
            document.body.removeChild(toast);
          }
        }, 300);
      }, 3000);
    }
  };

  // Inicializa tudo quando o modal é carregado
  permissionRenderer.init();
})();
