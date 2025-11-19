(function () {
  const overlayId = 'usuariosPermissoes';
  const overlay = document.getElementById(`${overlayId}Overlay`);
  if (!overlay) return;

  const saveOverlay = document.getElementById('usuariosPermissoesSalvarOverlay');
  const saveForm = document.getElementById('usuariosPermissoesSalvarForm');
  const saveNameInput = document.getElementById('usuariosPermissoesSalvarNome');
  const saveDescriptionInput = document.getElementById('usuariosPermissoesSalvarDescricao');
  const saveCloseBtn = document.getElementById('usuariosPermissoesSalvarFechar');
  const saveCancelBtn = document.getElementById('usuariosPermissoesSalvarCancelar');
  const saveConfirmBtn = document.getElementById('usuariosPermissoesSalvarConfirmar');

  const elements = {
    close: overlay.querySelector('#usuariosPermissoesFechar'),
    cancel: overlay.querySelector('[data-action="cancelar"]'),
    revert: overlay.querySelector('#usuariosPermissoesReverter'),
    apply: overlay.querySelector('#usuariosPermissoesAplicar'),
    profileSelect: overlay.querySelector('#usuariosPermissoesPerfil'),
    load: overlay.querySelector('#usuariosPermissoesCarregar'),
    save: overlay.querySelector('#usuariosPermissoesSalvar'),
    saveNew: overlay.querySelector('#usuariosPermissoesSalvarNovo'),
    duplicate: overlay.querySelector('#usuariosPermissoesDuplicar'),
    remove: overlay.querySelector('#usuariosPermissoesExcluir'),
    search: overlay.querySelector('#usuariosPermissoesBusca'),
    summaryModules: overlay.querySelector('#usuariosPermissoesResumoModulos'),
    summaryActions: overlay.querySelector('#usuariosPermissoesResumoAcoes'),
    summaryColumns: overlay.querySelector('#usuariosPermissoesResumoColunas'),
    tabs: Array.from(overlay.querySelectorAll('[data-permission-tab-trigger]')),
    panels: Array.from(overlay.querySelectorAll('[data-permission-tab-panel]')),
    moduleToggles: Array.from(overlay.querySelectorAll('[data-module-toggle]'))
  };

  const state = {
    currentProfile: null,
    profileLoaded: false,
    searchTerm: ''
  };

  const baseProfiles = {
    ADMIN: {
      name: 'Administrador',
      description: 'Acesso total ao sistema',
      permissions: [],
      columns: [],
      modules: []
    },
    VENDEDOR: {
      name: 'Vendedor',
      description: 'Acesso a vendas e relacionamento com clientes',
      permissions: [
        'mp.view',
        'mp.search',
        'mp.stock.view',
        'prod.view',
        'prod.search',
        'prod.details.view',
        'prod.stock.view',
        'orc.view',
        'orc.search',
        'orc.view.details',
        'orc.create',
        'ped.view',
        'ped.search',
        'ped.view.details',
        'cli.view',
        'cli.search',
        'cli.details.view',
        'pros.view',
        'pros.search',
        'pros.details.view',
        'ctt.view',
        'ctt.search',
        'ctt.details.view',
        'rel.view',
        'rel.search',
        'tarefas.view',
        'tarefas.calendar.view'
      ],
      columns: ['col_mp_nome', 'col_mp_categoria', 'col_mp_estoque_atual', 'col_mp_status', 'col_prod_nome', 'col_prod_status'],
      modules: ['module_mp', 'module_prod', 'module_orc', 'module_ped', 'module_cli', 'module_pros', 'module_ctt', 'module_rel', 'module_tarefas']
    },
    ARQUITETO: {
      name: 'Arquiteto',
      description: 'Acesso a produtos e projetos técnicos',
      permissions: [
        'mp.view',
        'mp.search',
        'mp.process.view',
        'mp.process.create',
        'mp.category.view',
        'mp.unit.view',
        'mp.stock.view',
        'prod.view',
        'prod.search',
        'prod.details.view',
        'prod.stage.view',
        'prod.stage.insert'
      ],
      columns: [
        'col_mp_codigo',
        'col_mp_nome',
        'col_mp_categoria',
        'col_mp_unidade',
        'col_mp_estoque_atual',
        'col_mp_custo_medio',
        'col_proc_nome',
        'col_proc_duracao',
        'col_proc_custo',
        'col_proc_ordem',
        'col_prod_nome',
        'col_prod_etapa_atual'
      ],
      modules: ['module_mp', 'module_prod']
    },
    GERENTE: {
      name: 'Gerente',
      description: 'Acesso gerencial e relatórios avançados',
      permissions: [
        'mp.view',
        'mp.search',
        'mp.export',
        'mp.edit',
        'mp.category.view',
        'mp.category.create',
        'mp.category.edit',
        'mp.unit.view',
        'mp.stock.view',
        'mp.stock.adjust',
        'prod.view',
        'prod.search',
        'prod.export',
        'prod.edit',
        'prod.collection.view',
        'prod.collection.edit',
        'orc.view',
        'orc.search',
        'orc.edit',
        'orc.convert',
        'ped.view',
        'ped.search',
        'ped.status.confirm',
        'ped.status.invoice',
        'ped.status.ship',
        'ped.status.deliver',
        'cli.view',
        'cli.search',
        'cli.details.view',
        'pros.view',
        'pros.search',
        'pros.details.view',
        'ctt.view',
        'ctt.search',
        'rel.view',
        'rel.run',
        'rel.export.csv',
        'rel.export.xlsx',
        'rel.export.pdf',
        'tarefas.view',
        'tarefas.calendar.view',
        'cfg.view',
        'cfg.roles.view'
      ],
      columns: [
        'col_mp_nome',
        'col_mp_categoria',
        'col_mp_estoque_atual',
        'col_mp_custo_medio',
        'col_mp_status',
        'col_prod_nome',
        'col_prod_status',
        'col_orc_total',
        'col_ped_total',
        'col_cli_nome_fantasia',
        'col_rel_total',
        'col_rel_qtd'
      ],
      modules: ['module_mp', 'module_prod', 'module_orc', 'module_ped', 'module_cli', 'module_pros', 'module_ctt', 'module_rel', 'module_tarefas', 'module_cfg']
    }
  };

  const profiles = new Map(
    Object.entries(baseProfiles).map(([key, value]) => [key, cloneProfile(value)])
  );

  function cloneProfile(profile) {
    return {
      name: profile?.name || 'Perfil',
      description: profile?.description || '',
      permissions: Array.isArray(profile?.permissions) ? [...profile.permissions] : [],
      columns: Array.isArray(profile?.columns) ? [...profile.columns] : [],
      modules: Array.isArray(profile?.modules) ? [...profile.modules] : []
    };
  }

  function resetAllOptionLabels() {
    Array.from(elements.profileSelect?.options || []).forEach(option => {
      if (!option.value) return;
      if (!option.dataset.originalLabel) {
        option.dataset.originalLabel = option.textContent || option.value;
      }
      option.textContent = option.dataset.originalLabel;
    });
  }

  function updateProfileButtons() {
    const selected = elements.profileSelect?.value || '';
    const hasSelection = Boolean(selected);
    if (elements.load) elements.load.disabled = !hasSelection;
    if (elements.duplicate) elements.duplicate.disabled = !hasSelection;
    if (elements.remove) elements.remove.disabled = !hasSelection;
    if (elements.save) {
      elements.save.disabled = !selected || selected !== state.currentProfile;
    }
  }

  function getGroupCheckboxes(groupId) {
    return Array.from(
      overlay.querySelectorAll(`input[type="checkbox"][data-role="item"][data-group="${groupId}"]`)
    );
  }

  function updateMasterCheckbox(groupId) {
    const master = overlay.querySelector(`input[type="checkbox"][data-role="master"][data-group="${groupId}"]`);
    const countEl = overlay.querySelector(`[data-group-count="${groupId}"]`);
    if (!master) return;

    const checkboxes = getGroupCheckboxes(groupId);
    const checked = checkboxes.filter(cb => cb.checked);

    if (checked.length === 0) {
      master.checked = false;
      master.indeterminate = false;
    } else if (checked.length === checkboxes.length) {
      master.checked = true;
      master.indeterminate = false;
    } else {
      master.checked = false;
      master.indeterminate = true;
    }

    if (countEl) {
      countEl.textContent = `(${checked.length} selecionadas)`;
    }
  }

  function updateAllMasterCheckboxes() {
    overlay
      .querySelectorAll('input[type="checkbox"][data-role="master"][data-group]')
      .forEach(master => updateMasterCheckbox(master.dataset.group));
  }

  function updateSummary() {
    const totalActions = overlay.querySelectorAll(
      'input[type="checkbox"][data-role="item"][data-item-type="action"]:checked'
    ).length;
    const totalColumns = overlay.querySelectorAll(
      'input[type="checkbox"][data-role="item"][data-item-type="column"]:checked'
    ).length;
    const totalModules = overlay.querySelectorAll('[data-module-toggle] input[type="checkbox"]:checked').length;
    if (elements.summaryActions) elements.summaryActions.textContent = totalActions;
    if (elements.summaryColumns) elements.summaryColumns.textContent = totalColumns;
    if (elements.summaryModules) elements.summaryModules.textContent = totalModules;
  }

  function markProfileLoaded(profileKey) {
    resetAllOptionLabels();
    const option = elements.profileSelect?.querySelector(`option[value="${profileKey}"]`);
    const profile = profiles.get(profileKey);
    if (option && profile) {
      const baseLabel = option.dataset.originalLabel || profile.name || profileKey;
      option.textContent = `${baseLabel} (Perfil carregado)`;
    }
    state.currentProfile = profileKey;
    state.profileLoaded = true;
    updateProfileButtons();
  }

  function markProfileDirty() {
    if (!state.profileLoaded) return;
    state.profileLoaded = false;
    resetAllOptionLabels();
    updateProfileButtons();
  }

  function clearAllCheckboxes() {
    overlay
      .querySelectorAll('input[type="checkbox"][data-role="item"]')
      .forEach(cb => {
        cb.checked = false;
      });
  }

  function loadProfile(profileKey) {
    const profile = profiles.get(profileKey);
    if (!profile) return;

    if (elements.profileSelect) {
      elements.profileSelect.value = profileKey;
    }

    clearAllCheckboxes();
    applyModuleSelection(profile.modules);

    profile.permissions.forEach(permission => {
      const checkbox = overlay.querySelector(
        `input[type="checkbox"][data-role="item"][name="${permission}"]`
      );
      if (checkbox && !checkbox.disabled) checkbox.checked = true;
    });

    profile.columns.forEach(column => {
      const checkbox = overlay.querySelector(
        `input[type="checkbox"][data-role="item"][name="${column}"]`
      );
      if (checkbox && !checkbox.disabled) checkbox.checked = true;
    });

    updateAllMasterCheckboxes();
    updateSummary();
    markProfileLoaded(profileKey);
  }

  function revertChanges() {
    if (state.currentProfile && profiles.has(state.currentProfile)) {
      loadProfile(state.currentProfile);
      return;
    }
    clearAllCheckboxes();
    setAllModulesState();
    updateAllMasterCheckboxes();
    updateSummary();
    resetAllOptionLabels();
    updateProfileButtons();
  }

  function collectSelections() {
    const permissions = [];
    const columns = [];
    overlay
      .querySelectorAll('input[type="checkbox"][data-role="item"]')
      .forEach(cb => {
        if (!cb.checked || cb.disabled) return;
        const name = cb.name || cb.value;
        if (!name) return;
        if (cb.dataset.itemType === 'column') {
          columns.push(name);
        } else {
          permissions.push(name);
        }
      });
    const modules = elements.moduleToggles
      .map(toggle => {
        const id = toggle.dataset.moduleToggle;
        const input = toggle.querySelector('input[type="checkbox"]');
        return input?.checked ? `module_${id}` : null;
      })
      .filter(Boolean);
    return { permissions, columns, modules };
  }

  function applyChanges() {
    const selections = collectSelections();
    const payload = {};
    [...selections.modules, ...selections.permissions, ...selections.columns].forEach(name => {
      payload[name] = true;
    });
    document.dispatchEvent(new CustomEvent('roles:apply', { detail: payload }));
    if (typeof window.showToast === 'function') {
      window.showToast('Permissões aplicadas com sucesso.', 'success');
    }
  }

  function handleSaveExisting() {
    const key = elements.profileSelect?.value;
    if (!key || !profiles.has(key) || key !== state.currentProfile) return;
    const selections = collectSelections();
    const profile = profiles.get(key);
    profile.permissions = selections.permissions;
    profile.columns = selections.columns;
    profile.modules = selections.modules;
    state.profileLoaded = true;
    markProfileLoaded(key);
    if (typeof window.showToast === 'function') {
      window.showToast('Perfil atualizado com sucesso.', 'success');
    }
  }

  function normalizarNome(nome) {
    return (nome || 'Perfil').trim();
  }

  function gerarChavePerfil(nome) {
    const base = normalizarNome(nome)
      .toUpperCase()
      .normalize('NFD')
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return base || `PERFIL_${Date.now()}`;
  }

  function gerarChaveUnica(nome) {
    const base = gerarChavePerfil(nome);
    if (!profiles.has(base)) return base;
    let index = 2;
    while (profiles.has(`${base}_${index}`)) {
      index += 1;
    }
    return `${base}_${index}`;
  }

  function adicionarOuAtualizarOpcao(key, label) {
    if (!elements.profileSelect) return;
    let option = elements.profileSelect.querySelector(`option[value="${key}"]`);
    if (!option) {
      option = document.createElement('option');
      option.value = key;
      elements.profileSelect.appendChild(option);
    }
    option.textContent = label;
    option.dataset.originalLabel = label;
  }

  function salvarNovoPerfil(nome, descricao) {
    const finalName = normalizarNome(nome);
    if (!finalName) return;
    const key = gerarChaveUnica(finalName);
    const selections = collectSelections();
    profiles.set(key, {
      name: finalName,
      description: descricao || '',
      permissions: selections.permissions,
      columns: selections.columns,
      modules: selections.modules
    });
    adicionarOuAtualizarOpcao(key, finalName);
    if (elements.profileSelect) {
      elements.profileSelect.value = key;
    }
    markProfileLoaded(key);
    fecharModalSalvar();
    if (typeof window.showToast === 'function') {
      window.showToast('Novo perfil salvo com sucesso.', 'success');
    }
  }

  function abrirModalSalvar(prefill = {}) {
    if (!saveOverlay) return;
    if (saveForm) saveForm.reset();
    if (prefill.name) saveNameInput.value = prefill.name;
    if (prefill.description) saveDescriptionInput.value = prefill.description;
    saveOverlay.classList.remove('hidden');
    setTimeout(() => {
      saveNameInput?.focus();
    }, 50);
  }

  function fecharModalSalvar() {
    if (!saveOverlay) return;
    saveOverlay.classList.add('hidden');
    saveForm?.reset();
  }

  function handleSaveConfirm(event) {
    event?.preventDefault();
    const nome = saveNameInput?.value?.trim();
    if (!nome) {
      saveNameInput?.focus();
      return;
    }
    salvarNovoPerfil(nome, saveDescriptionInput?.value || '');
  }

  function handleDuplicate() {
    const selected = elements.profileSelect?.value;
    if (!selected) return;
    const profile = profiles.get(selected);
    const defaultName = profile?.name ? `${profile.name} Cópia` : 'Perfil Copia';
    abrirModalSalvar({ name: defaultName, description: profile?.description || '' });
  }

  function handleDelete() {
    const selected = elements.profileSelect?.value;
    if (!selected || !profiles.has(selected)) return;
    const profile = profiles.get(selected);
    const nome = profile?.name || selected;
    const confirmar = window.confirm
      ? window.confirm(`Deseja realmente excluir o perfil "${nome}"?`)
      : true;
    if (!confirmar) return;
    profiles.delete(selected);
    const option = elements.profileSelect?.querySelector(`option[value="${selected}"]`);
    option?.remove();
    if (state.currentProfile === selected) {
      state.currentProfile = null;
      state.profileLoaded = false;
      clearAllCheckboxes();
      setAllModulesState();
      updateAllMasterCheckboxes();
      updateSummary();
    }
    resetAllOptionLabels();
    updateProfileButtons();
    if (typeof window.showToast === 'function') {
      window.showToast('Perfil excluído.', 'info');
    }
  }

  function setTab(tabName) {
    elements.tabs.forEach(tab => {
      const isActive = tab.dataset.permissionTabTrigger === tabName;
      tab.classList.toggle('usuarios-permissoes-tab--active', isActive);
    });
    elements.panels.forEach(panel => {
      const isActive = panel.dataset.permissionTabPanel === tabName;
      panel.classList.toggle('hidden', !isActive);
    });
  }

  function setAccordionState(id, open) {
    const toggle = overlay.querySelector(`[data-accordion-toggle="${id}"]`);
    const content = overlay.querySelector(`[data-accordion-content="${id}"]`);
    if (!content || !toggle) return;
    content.classList.toggle('is-open', open);
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function handleAccordionClick(event) {
    const id = event.currentTarget?.dataset?.accordionToggle;
    if (!id) return;
    const content = overlay.querySelector(`[data-accordion-content="${id}"]`);
    const isOpen = content?.classList.contains('is-open');
    setAccordionState(id, !isOpen);
  }

  function matchesSearch(element, term) {
    if (!term) return true;
    const data = element.dataset.search ? element.dataset.search.toLowerCase() : '';
    const text = element.textContent ? element.textContent.toLowerCase() : '';
    return data.includes(term) || text.includes(term);
  }

  function applySearch(term) {
    const normalized = term.trim().toLowerCase();
    state.searchTerm = normalized;
    const items = overlay.querySelectorAll('.usuarios-permissoes-item, .usuarios-permissoes-checkbox');
    items.forEach(item => {
      const shouldShow = matchesSearch(item, normalized);
      item.classList.toggle('hidden', !shouldShow);
    });
    if (normalized) {
      overlay.querySelectorAll('[data-accordion-content]').forEach(content => {
        const id = content.dataset.accordionContent;
        if (!id) return;
        setAccordionState(id, true);
      });
    }
  }

  function handleMasterChange(event) {
    const master = event.target;
    const group = master.dataset.group;
    const checkboxes = getGroupCheckboxes(group);
    checkboxes.forEach(cb => {
      cb.checked = master.checked;
    });
    updateMasterCheckbox(group);
    updateSummary();
    markProfileDirty();
  }

  function handleItemChange(event) {
    const checkbox = event.target;
    if (!checkbox.dataset.group) return;
    updateMasterCheckbox(checkbox.dataset.group);
    updateSummary();
    markProfileDirty();
  }

  function handleModuleToggle(event) {
    const toggle = event.target;
    const id = toggle.closest('[data-module-toggle]')?.dataset?.moduleToggle;
    if (!id) return;
    setModuleState(id, toggle.checked);
  }

  function handleProfileChange() {
    resetAllOptionLabels();
    updateProfileButtons();
  }

  function handleLoadProfile() {
    const selected = elements.profileSelect?.value;
    if (!selected) return;
    loadProfile(selected);
  }

  function handleSearchInput(event) {
    applySearch(event.target.value || '');
  }

  function handleOverlayClick(event) {
    if (event.target === overlay) {
      closeModal();
    }
  }

  function handleSaveOverlayClick(event) {
    if (event.target === saveOverlay) {
      fecharModalSalvar();
    }
  }

  function handleKeydown(event) {
    if (event.key !== 'Escape') return;
    if (saveOverlay && !saveOverlay.classList.contains('hidden')) {
      event.preventDefault();
      fecharModalSalvar();
      return;
    }
    event.preventDefault();
    closeModal();
  }

  function closeModal() {
    document.removeEventListener('keydown', handleKeydown);
    overlay.removeEventListener('click', handleOverlayClick);
    saveOverlay?.removeEventListener('click', handleSaveOverlayClick);
    if (typeof Modal?.close === 'function') {
      Modal.close(overlayId);
    } else {
      overlay.classList.add('hidden');
    }
  }

  function initTabs() {
    if (!elements.tabs.length) return;
    const defaultTab = elements.tabs[0]?.dataset.permissionTabTrigger || '';
    setTab(defaultTab);
    elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => setTab(tab.dataset.permissionTabTrigger));
    });
    updateSummary();
  }

  function initAccordions() {
    overlay.querySelectorAll('[data-accordion-toggle]').forEach(toggle => {
      toggle.addEventListener('click', handleAccordionClick);
    });
  }

  function initCheckboxes() {
    overlay
      .querySelectorAll('input[type="checkbox"][data-role="master"][data-group]')
      .forEach(master => master.addEventListener('change', handleMasterChange));

    overlay
      .querySelectorAll('input[type="checkbox"][data-role="item"]')
      .forEach(cb => cb.addEventListener('change', handleItemChange));

    updateAllMasterCheckboxes();
    updateSummary();
  }

  function setModuleState(moduleId, enabled, options = {}) {
    const toggleLabel = overlay.querySelector(`[data-module-toggle="${moduleId}"]`);
    const toggle = toggleLabel?.querySelector('input[type="checkbox"]');
    const content = overlay.querySelector(`[data-module-content="${moduleId}"]`);
    const { markDirty = true } = options;
    if (toggle) toggle.checked = enabled;
    if (toggleLabel) {
      toggleLabel.classList.toggle('usuario-permissao-toggle--on', enabled);
      toggleLabel.classList.toggle('usuario-permissao-toggle--disabled', !enabled);
    }
    if (content) {
      content.classList.toggle('usuarios-permissoes-module--disabled', !enabled);
      content.querySelectorAll('input[type="checkbox"][data-role="item"]').forEach(cb => {
        cb.disabled = !enabled;
        if (!enabled) cb.checked = false;
      });
    }
    updateAllMasterCheckboxes();
    updateSummary();
    if (markDirty) markProfileDirty();
  }

  function setAllModulesState(enabled = true) {
    elements.moduleToggles.forEach(toggle => {
      setModuleState(toggle.dataset.moduleToggle, enabled, { markDirty: false });
    });
  }

  function applyModuleSelection(modules = []) {
    const moduleSet = Array.isArray(modules) && modules.length
      ? new Set(modules.map(mod => mod.replace(/^module_/, '')))
      : null;
    elements.moduleToggles.forEach(toggle => {
      const id = toggle.dataset.moduleToggle;
      const shouldEnable = moduleSet ? moduleSet.has(id) : true;
      setModuleState(id, shouldEnable, { markDirty: false });
    });
    updateSummary();
  }

  function initProfileOptions() {
    Array.from(elements.profileSelect?.options || []).forEach(option => {
      if (!option.value) return;
      option.dataset.originalLabel = option.textContent || option.value;
      const profile = baseProfiles[option.value];
      if (profile && !profiles.has(option.value)) {
        profiles.set(option.value, cloneProfile(profile));
      }
    });
  }

  function initEvents() {
    elements.close?.addEventListener('click', closeModal);
    elements.cancel?.addEventListener('click', closeModal);
    elements.revert?.addEventListener('click', revertChanges);
    elements.apply?.addEventListener('click', applyChanges);
    elements.profileSelect?.addEventListener('change', handleProfileChange);
    elements.load?.addEventListener('click', handleLoadProfile);
    elements.save?.addEventListener('click', handleSaveExisting);
    elements.saveNew?.addEventListener('click', () => abrirModalSalvar());
    elements.duplicate?.addEventListener('click', handleDuplicate);
    elements.remove?.addEventListener('click', handleDelete);
    elements.search?.addEventListener('input', handleSearchInput);
    overlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleKeydown);
    if (saveOverlay) {
      saveOverlay.addEventListener('click', handleSaveOverlayClick);
    }
    saveCloseBtn?.addEventListener('click', fecharModalSalvar);
    saveCancelBtn?.addEventListener('click', fecharModalSalvar);
    saveConfirmBtn?.addEventListener('click', handleSaveConfirm);
    saveForm?.addEventListener('submit', handleSaveConfirm);
    elements.moduleToggles.forEach(toggle => {
      const input = toggle.querySelector('input[type="checkbox"]');
      if (input) {
        input.addEventListener('change', handleModuleToggle);
      }
    });
  }

  function getAllAvailableSelections() {
    const permissions = Array.from(
      overlay.querySelectorAll('input[type="checkbox"][data-role="item"][data-item-type="action"]')
    )
      .map(cb => cb.name || cb.value)
      .filter(Boolean);
    const columns = Array.from(
      overlay.querySelectorAll('input[type="checkbox"][data-role="item"][data-item-type="column"]')
    )
      .map(cb => cb.name || cb.value)
      .filter(Boolean);
    const modules = elements.moduleToggles.map(toggle => `module_${toggle.dataset.moduleToggle}`);
    return { permissions, columns, modules };
  }

  function ensureAdminHasAll() {
    if (!profiles.has('ADMIN')) return;
    const admin = profiles.get('ADMIN');
    const available = getAllAvailableSelections();
    if (!admin.permissions.length) admin.permissions = available.permissions;
    if (!admin.columns.length) admin.columns = available.columns;
    if (!admin.modules?.length) admin.modules = available.modules;
  }

  function ensureProfilesHaveModules() {
    const availableModules = getAllAvailableSelections().modules;
    profiles.forEach(profile => {
      if (!Array.isArray(profile.modules) || !profile.modules.length) {
        profile.modules = [...availableModules];
      }
    });
  }

  initTabs();
  initAccordions();
  initCheckboxes();
  initProfileOptions();
  initEvents();
  ensureAdminHasAll();
  ensureProfilesHaveModules();
  setAllModulesState(true);
  updateProfileButtons();
  applySearch('');

  if (typeof Modal?.signalReady === 'function') {
    Modal.signalReady(overlayId);
  }
  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));
})();
