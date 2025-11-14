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
    panels: Array.from(overlay.querySelectorAll('[data-permission-tab-panel]'))
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
      permissions: [
        'mp_ver_lista',
        'mp_buscar',
        'mp_exportar',
        'mp_criar',
        'mp_editar',
        'mp_excluir',
        'mp_ver_processos',
        'mp_criar_processo',
        'mp_excluir_processo',
        'mp_ver_categorias',
        'mp_criar_categoria',
        'mp_editar_categoria',
        'mp_excluir_categoria',
        'mp_ver_unidades',
        'mp_criar_unidade',
        'mp_editar_unidade',
        'mp_excluir_unidade',
        'mp_ver_estoque',
        'mp_entrada_estoque',
        'mp_saida_estoque',
        'mp_ajustar_estoque',
        'mp_estoque_infinito'
      ],
      columns: [
        'col_mp_codigo',
        'col_mp_nome',
        'col_mp_categoria',
        'col_mp_unidade',
        'col_mp_estoque_atual',
        'col_mp_estoque_minimo',
        'col_mp_custo_medio',
        'col_mp_fornecedor',
        'col_mp_status',
        'col_mp_atualizado_em',
        'col_mov_data',
        'col_mov_tipo',
        'col_mov_quantidade',
        'col_mov_referencia',
        'col_mov_usuario',
        'col_proc_processo',
        'col_proc_duracao',
        'col_proc_custo',
        'col_proc_ordem',
        'col_cat_categoria',
        'col_cat_descricao',
        'col_cat_itens',
        'col_uni_unidade',
        'col_uni_descricao',
        'col_uni_precisao'
      ]
    },
    VENDEDOR: {
      name: 'Vendedor',
      description: 'Acesso a vendas e relacionamento com clientes',
      permissions: ['mp_ver_lista', 'mp_buscar', 'mp_ver_estoque'],
      columns: ['col_mp_nome', 'col_mp_categoria', 'col_mp_estoque_atual', 'col_mp_status']
    },
    ARQUITETO: {
      name: 'Arquiteto',
      description: 'Acesso a produtos e projetos técnicos',
      permissions: [
        'mp_ver_lista',
        'mp_buscar',
        'mp_ver_processos',
        'mp_criar_processo',
        'mp_ver_categorias',
        'mp_ver_unidades',
        'mp_ver_estoque'
      ],
      columns: [
        'col_mp_codigo',
        'col_mp_nome',
        'col_mp_categoria',
        'col_mp_unidade',
        'col_mp_estoque_atual',
        'col_mp_custo_medio',
        'col_proc_processo',
        'col_proc_duracao',
        'col_proc_custo',
        'col_proc_ordem'
      ]
    },
    GERENTE: {
      name: 'Gerente',
      description: 'Acesso gerencial e relatórios avançados',
      permissions: [
        'mp_ver_lista',
        'mp_buscar',
        'mp_exportar',
        'mp_editar',
        'mp_ver_processos',
        'mp_ver_categorias',
        'mp_criar_categoria',
        'mp_editar_categoria',
        'mp_ver_unidades',
        'mp_ver_estoque',
        'mp_ajustar_estoque'
      ],
      columns: ['col_mp_nome', 'col_mp_categoria', 'col_mp_estoque_atual', 'col_mp_custo_medio', 'col_mp_status']
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
      columns: Array.isArray(profile?.columns) ? [...profile.columns] : []
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
    if (elements.summaryActions) elements.summaryActions.textContent = totalActions;
    if (elements.summaryColumns) elements.summaryColumns.textContent = totalColumns;
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

    profile.permissions.forEach(permission => {
      const checkbox = overlay.querySelector(
        `input[type="checkbox"][data-role="item"][name="${permission}"]`
      );
      if (checkbox) checkbox.checked = true;
    });

    profile.columns.forEach(column => {
      const checkbox = overlay.querySelector(
        `input[type="checkbox"][data-role="item"][name="${column}"]`
      );
      if (checkbox) checkbox.checked = true;
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
        if (!cb.checked) return;
        const name = cb.name || cb.value;
        if (!name) return;
        if (cb.dataset.itemType === 'column') {
          columns.push(name);
        } else {
          permissions.push(name);
        }
      });
    return { permissions, columns };
  }

  function applyChanges() {
    const selections = collectSelections();
    const payload = {};
    [...selections.permissions, ...selections.columns].forEach(name => {
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
      columns: selections.columns
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
    if (elements.summaryModules) {
      elements.summaryModules.textContent = String(elements.panels.length);
    }
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
  }

  initTabs();
  initAccordions();
  initCheckboxes();
  initProfileOptions();
  initEvents();
  updateProfileButtons();
  applySearch('');

  if (typeof Modal?.signalReady === 'function') {
    Modal.signalReady(overlayId);
  }
  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));
})();
