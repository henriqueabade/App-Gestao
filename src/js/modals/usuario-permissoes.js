(function () {
  const overlayId = 'usuariosPermissoes';
  const overlay = document.getElementById(`${overlayId}Overlay`);
  if (!overlay) return;

  let usuarioAtualCache = null;

  function carregarUsuarioAtual() {
    if (usuarioAtualCache) {
      return usuarioAtualCache;
    }
    try {
      const sessionStore = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
      const localStore = typeof localStorage !== 'undefined' ? localStorage : null;
      const stored = sessionStore?.getItem('currentUser') || localStore?.getItem('user');
      usuarioAtualCache = stored ? JSON.parse(stored) : null;
    } catch (err) {
      console.error('Falha ao recuperar usuário autenticado:', err);
      usuarioAtualCache = null;
    }
    return usuarioAtualCache;
  }

  async function fetchApi(path, options = {}) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    const finalOptions = { ...options };
    const headers = new Headers(options?.headers || {});

    const usuarioAtual = carregarUsuarioAtual();
    const email = typeof usuarioAtual?.email === 'string' ? usuarioAtual.email.trim() : '';
    const usuarioId = (() => {
      if (typeof usuarioAtual?.id === 'number') {
        return usuarioAtual.id;
      }
      const parsed = Number(usuarioAtual?.id);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    })();

    if (email && !headers.has('x-usuario-email')) {
      headers.set('x-usuario-email', email);
    }
    if (usuarioId && !headers.has('x-usuario-id')) {
      headers.set('x-usuario-id', String(usuarioId));
    }
    if (usuarioId && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${usuarioId}`);
    }

    finalOptions.headers = headers;
    return fetch(`${baseUrl}${path}`, finalOptions);
  }

  const context = window.usuariosPermissoesContext || {};
  delete window.usuariosPermissoesContext;

  const applicationContext = {
    usuarioId: context.usuarioId ?? context.usuario?.id ?? null,
    modeloPermissoesId: context.modeloPermissoesId ?? context.modeloId ?? context.modelo?.id ?? null
  };

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

  const columnInputsMetadata = initializeColumnMetadata();
  const columnFieldLookup = buildColumnFieldLookup(columnInputsMetadata);
  const MODULE_ACTIVATION_ACTIONS = new Set(['permissoes', 'acesso']);

  const state = {
    currentProfile: null,
    profileLoaded: false,
    searchTerm: '',
    profilesPromise: null
  };

  const profiles = new Map();
  let applyInProgress = false;

  function getErrorMessageForStatus(status, fallbackMessage) {
    if (status === 409) {
      return 'Já existe um modelo com este nome.';
    }
    if (status === 400) {
      return 'Os dados enviados são inválidos. Verifique as informações e tente novamente.';
    }
    if (status >= 500) {
      return 'Ocorreu um erro no servidor. Tente novamente mais tarde.';
    }
    return fallbackMessage;
  }

  async function extractResponseMessage(resp) {
    if (!resp) return null;
    const contentType = resp.headers?.get('content-type') || '';
    try {
      if (contentType.includes('application/json')) {
        const data = await resp.json();
        return (
          data?.mensagem ||
          data?.menssage ||
          data?.message ||
          data?.erro ||
          data?.error ||
          null
        );
      }
      const text = await resp.text();
      return text?.trim() || null;
    } catch (err) {
      console.error('Falha ao extrair mensagem da resposta da API:', err);
      return null;
    }
  }

  function booleanFromValue(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return false;
      return ['1', 'true', 'yes', 'y', 'sim', 'on', 'permitido', 'habilitado', 'enabled', 'ativo', 'active'].includes(normalized);
    }
    if (value instanceof Date) {
      return !Number.isNaN(value.getTime());
    }
    return Boolean(value);
  }

  function normalizePermissionsPayload(raw) {
    if (raw === undefined || raw === null) return {};
    let input = raw;
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) return {};
      try {
        input = JSON.parse(trimmed);
      } catch (err) {
        console.error('Falha ao interpretar permissões do modelo:', err);
        return {};
      }
    }

    if (Array.isArray(input)) {
      const payload = {};
      input.forEach(item => {
        if (!item) return;
        if (typeof item === 'string') {
          payload[item] = true;
          return;
        }
        if (typeof item === 'object') {
          const key = item.name || item.nome || item.chave || item.key || item.id;
          if (!key) return;
          const value = item.value ?? item.valor ?? item.permitido ?? item.enabled ?? item.allow ?? item.allowed ?? item.checked ??
            item.active ?? item.ativo;
          payload[key] = value === undefined ? true : booleanFromValue(value);
        }
      });
      return payload;
    }

    if (typeof input === 'object') {
      if (looksLikeStructuredPermissions(input)) {
        const flattened = flattenPermissionsStructure(input);
        if (Object.keys(flattened).length) {
          return flattened;
        }
      }
      const payload = {};
      Object.entries(input).forEach(([key, value]) => {
        if (value === null || value === undefined) {
          return;
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
          if (
            Object.prototype.hasOwnProperty.call(value, 'permitido') ||
            Object.prototype.hasOwnProperty.call(value, 'enabled') ||
            Object.prototype.hasOwnProperty.call(value, 'allow') ||
            Object.prototype.hasOwnProperty.call(value, 'allowed') ||
            Object.prototype.hasOwnProperty.call(value, 'value') ||
            Object.prototype.hasOwnProperty.call(value, 'valor') ||
            Object.prototype.hasOwnProperty.call(value, 'checked') ||
            Object.prototype.hasOwnProperty.call(value, 'active') ||
            Object.prototype.hasOwnProperty.call(value, 'ativo')
          ) {
            const indicator = value.permitido ?? value.enabled ?? value.allow ?? value.allowed ?? value.value ?? value.valor ??
              value.checked ?? value.active ?? value.ativo;
            payload[key] = booleanFromValue(indicator);
            return;
          }
        }
        payload[key] = booleanFromValue(value);
      });
      return payload;
    }

    return {};
  }

  function normalizePermissionKey(value) {
    if (value === undefined || value === null) return '';
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function deriveFieldNameFromColumn(name) {
    if (!name || typeof name !== 'string') return '';
    const trimmed = name.trim();
    if (!trimmed.startsWith('col_')) {
      return normalizePermissionKey(trimmed);
    }
    const raw = trimmed.slice(4);
    if (!raw) return '';
    const [, ...fieldParts] = raw.split('_');
    const fieldName = fieldParts.length ? fieldParts.join('_') : raw;
    return normalizePermissionKey(fieldName);
  }

  function initializeColumnMetadata() {
    const map = new Map();
    overlay
      .querySelectorAll('input[type="checkbox"][data-role="item"][data-item-type="column"]')
      .forEach(input => {
        const name = input.name || input.value;
        if (!name) return;
        const parentModule = input.closest('[data-module]');
        const moduleKey = parentModule?.dataset.module || null;
        const normalizedModule = normalizePermissionKey(moduleKey);
        if (!normalizedModule) return;
        const actionRaw = input.dataset.columnAction || input.dataset.fieldAction || 'editar';
        const actionSegments = String(actionRaw)
          .split('.')
          .map(segment => normalizePermissionKey(segment))
          .filter(Boolean);
        if (!actionSegments.length) {
          actionSegments.push('editar');
        }
        const scopeAttr = input.dataset.columnScope || input.dataset.fieldScope;
        const scopes = scopeAttr ? scopeAttr.split(',').map(scope => scope.trim()).filter(Boolean) : ['editar'];
        const fieldKey =
          input.dataset.columnField || input.dataset.fieldName || deriveFieldNameFromColumn(name);
        const normalizedField = normalizePermissionKey(fieldKey);
        if (!normalizedField) return;
        map.set(name, {
          module: moduleKey,
          normalizedModule,
          action: actionRaw,
          actionSegments,
          scopes,
          fieldKey: normalizedField
        });
      });
    return map;
  }

  function buildColumnFieldLookup(metadataMap) {
    const lookup = new Map();
    metadataMap.forEach((metadata, name) => {
      if (!metadata?.normalizedModule || !metadata?.fieldKey || !metadata?.actionSegments?.length) {
        return;
      }
      const key = `${metadata.normalizedModule}:${metadata.actionSegments.join('.')}:${metadata.fieldKey}`;
      lookup.set(key, name);
    });
    return lookup;
  }

  function findColumnNameForField(moduleKey, actionSegments, fieldName) {
    const normalizedModule = normalizePermissionKey(moduleKey);
    const normalizedField = normalizePermissionKey(fieldName);
    const normalizedAction = (actionSegments || [])
      .map(segment => normalizePermissionKey(segment))
      .filter(Boolean)
      .join('.');
    if (!normalizedModule || !normalizedField || !normalizedAction) {
      return null;
    }
    const key = `${normalizedModule}:${normalizedAction}:${normalizedField}`;
    return columnFieldLookup.get(key) || null;
  }

  function looksLikeStructuredPermissions(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
    return Object.values(input).some(moduleValue => {
      if (!moduleValue || typeof moduleValue !== 'object' || Array.isArray(moduleValue)) return false;
      return Object.values(moduleValue).some(actionValue => actionValue && typeof actionValue === 'object' && !Array.isArray(actionValue));
    });
  }

  function flattenPermissionsStructure(structure) {
    const flattened = {};
    Object.entries(structure || {}).forEach(([moduleName, moduleValue]) => {
      const normalizedModule = normalizePermissionKey(moduleName);
      if (!normalizedModule || !moduleValue || typeof moduleValue !== 'object' || Array.isArray(moduleValue)) {
        return;
      }
      Object.entries(moduleValue).forEach(([actionKey, actionValue]) => {
        if (!actionValue || typeof actionValue !== 'object' || Array.isArray(actionValue)) {
          return;
        }
        const normalizedAction = normalizePermissionKey(actionKey);
        if (!normalizedAction) return;
        traverseActionTree(normalizedModule, [normalizedAction], actionValue, flattened);
      });
    });
    return flattened;
  }

  function traverseActionTree(moduleKey, path, node, acc) {
    if (!moduleKey || !path || !path.length || !node || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }
    const normalizedPath = path.map(segment => normalizePermissionKey(segment)).filter(Boolean);
    if (!normalizedPath.length) {
      return;
    }
    const firstSegment = normalizedPath[0];
    if (Object.prototype.hasOwnProperty.call(node, 'permitido')) {
      const allowed = booleanFromValue(node.permitido);
      if (allowed) {
        if (normalizedPath.length === 1 && MODULE_ACTIVATION_ACTIONS.has(firstSegment)) {
          acc[`module_${moduleKey}`] = true;
        } else {
          acc[[moduleKey, ...normalizedPath].join('.')] = true;
        }
      }
    }
    if (node.campos && typeof node.campos === 'object' && !Array.isArray(node.campos)) {
      Object.entries(node.campos).forEach(([fieldName, fieldValue]) => {
        if (fieldValue === null || fieldValue === undefined) return;
        let allowed = false;
        if (typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
          allowed = Object.values(fieldValue).some(Boolean);
        } else {
          allowed = booleanFromValue(fieldValue);
        }
        if (!allowed) return;
        const columnName = findColumnNameForField(moduleKey, normalizedPath, fieldName);
        if (columnName) {
          acc[columnName] = true;
        }
      });
    }
    Object.entries(node).forEach(([childKey, childValue]) => {
      if (['permitido', 'escopos', 'campos'].includes(childKey)) return;
      if (!childValue || typeof childValue !== 'object' || Array.isArray(childValue)) return;
      const childSegment = normalizePermissionKey(childKey);
      if (!childSegment) return;
      traverseActionTree(moduleKey, [...normalizedPath, childSegment], childValue, acc);
    });
  }

  function buildPayloadFromSelections(selections) {
    const payload = {};
    if (!selections) return payload;

    const ensureModuleEntry = moduleKey => {
      const normalizedModule = normalizePermissionKey(moduleKey);
      if (!normalizedModule) return null;
      if (!payload[normalizedModule] || typeof payload[normalizedModule] !== 'object') {
        payload[normalizedModule] = {};
      }
      return payload[normalizedModule];
    };

    const ensureActionEntry = (moduleKey, actionSegments) => {
      if (!moduleKey || !actionSegments || !actionSegments.length) return null;
      const moduleEntry = ensureModuleEntry(moduleKey);
      if (!moduleEntry) return null;
      let current = moduleEntry;
      for (const segment of actionSegments) {
        const key = normalizePermissionKey(segment);
        if (!key) continue;
        if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
          current[key] = {};
        }
        current = current[key];
      }
      return current;
    };

    const markActionAllowed = (moduleKey, actionSegments) => {
      const actionEntry = ensureActionEntry(moduleKey, actionSegments);
      if (!actionEntry) return;
      actionEntry.permitido = true;
    };

    const assignFieldPermission = (moduleKey, actionSegments, fieldName, scopes) => {
      const actionEntry = ensureActionEntry(moduleKey, actionSegments);
      if (!actionEntry) return;
      const normalizedField = normalizePermissionKey(fieldName);
      if (!normalizedField) return;
      if (!actionEntry.campos || typeof actionEntry.campos !== 'object') {
        actionEntry.campos = {};
      }
      const fieldEntry =
        actionEntry.campos[normalizedField] && typeof actionEntry.campos[normalizedField] === 'object'
          ? actionEntry.campos[normalizedField]
          : {};
      scopes.forEach(scope => {
        const scopeKey = normalizePermissionKey(scope);
        if (!scopeKey) return;
        fieldEntry[scopeKey] = true;
      });
      actionEntry.campos[normalizedField] = fieldEntry;
    };

    (selections.modules || []).forEach(name => {
      if (!name) return;
      const moduleKey = normalizePermissionKey(name.replace(/^module_/, ''));
      if (!moduleKey) return;
      markActionAllowed(moduleKey, ['permissoes']);
    });

    (selections.permissions || []).forEach(name => {
      if (!name) return;
      const parts = String(name)
        .split('.')
        .map(part => normalizePermissionKey(part))
        .filter(Boolean);
      if (!parts.length) return;
      const [moduleKey, ...actionSegments] = parts;
      if (!moduleKey || !actionSegments.length) return;
      markActionAllowed(moduleKey, actionSegments);
    });

    (selections.columns || []).forEach(name => {
      if (!name) return;
      const metadata = columnInputsMetadata.get(name);
      const moduleKey = metadata?.normalizedModule || '';
      const scopes = Array.isArray(metadata?.scopes) && metadata.scopes.length ? metadata.scopes : ['editar'];
      const fieldKey = metadata?.fieldKey || deriveFieldNameFromColumn(name);
      if (!moduleKey || !fieldKey) {
        return;
      }
      const actionSegments = metadata?.actionSegments?.length
        ? metadata.actionSegments
        : ['editar'];
      assignFieldPermission(moduleKey, actionSegments, fieldKey, scopes);
    });

    return payload;
  }

  function findProfileKeyByModelId(modelId) {
    if (modelId === undefined || modelId === null) {
      return null;
    }
    const target = String(modelId);
    for (const [key, profile] of profiles.entries()) {
      if (profile?.id !== undefined && profile?.id !== null && String(profile.id) === target) {
        return key;
      }
    }
    return null;
  }

  function applyNormalizedPayload(payload = {}) {
    clearAllCheckboxes();
    const moduleKeys = elements.moduleToggles.map(toggle => `module_${toggle.dataset.moduleToggle}`);
    const enabledModules = moduleKeys.filter(moduleName => payload[moduleName]);
    applyModuleSelection(enabledModules);
    overlay
      .querySelectorAll('input[type="checkbox"][data-role="item"]')
      .forEach(cb => {
        const name = cb.name || cb.value;
        if (!name) return;
        cb.checked = !cb.disabled && Boolean(payload[name]);
      });
    updateAllMasterCheckboxes();
    updateSummary();
  }

  function populateFromRawPermissions(rawPayload) {
    const normalized = normalizePermissionsPayload(rawPayload);
    applyNormalizedPayload(normalized);
    return normalized;
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
    const hasSelection = Boolean(selected) && profiles.has(selected);
    if (elements.load) elements.load.disabled = !hasSelection;
    if (elements.duplicate) elements.duplicate.disabled = !hasSelection;
    if (elements.remove) elements.remove.disabled = !hasSelection;
    if (elements.save) {
      elements.save.disabled = !hasSelection || selected !== state.currentProfile;
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

    applyNormalizedPayload(profile.payload || {});
    markProfileLoaded(profileKey);
  }

  function syncProfileSelectionFromContext({ loadProfileIfNoUser = false } = {}) {
    if (!applicationContext.modeloPermissoesId) {
      return;
    }
    const key = findProfileKeyByModelId(applicationContext.modeloPermissoesId);
    if (!key) {
      return;
    }
    if (loadProfileIfNoUser && !applicationContext.usuarioId) {
      loadProfile(key);
      return;
    }
    if (elements.profileSelect) {
      elements.profileSelect.value = key;
    }
    updateProfileButtons();
  }

  async function loadUserPermissions(usuarioId) {
    if (!usuarioId) return;
    try {
      const resp = await fetchApi(`/api/usuarios/${encodeURIComponent(usuarioId)}`);
      if (!resp.ok) {
        const messageFromResponse = await extractResponseMessage(resp);
        const errorMessage = messageFromResponse || 'Não foi possível carregar as permissões do usuário.';
        if (typeof window.showToast === 'function') {
          window.showToast(errorMessage, 'error');
        }
        return;
      }
      const data = await resp.json();
      const usuario = data?.usuario ?? data;
      const permissoes = data?.permissoes ?? usuario?.permissoes ?? usuario?.permissions ?? {};
      populateFromRawPermissions(permissoes);
      state.currentProfile = null;
      state.profileLoaded = false;
      if (elements.profileSelect) {
        elements.profileSelect.value = '';
      }
      resetAllOptionLabels();
      updateProfileButtons();
      const modeloId =
        usuario?.modeloPermissoesId ??
        usuario?.modelo_permissoes_id ??
        data?.modeloPermissoesId ??
        data?.modelo_permissoes_id ??
        null;
      if (modeloId !== null && modeloId !== undefined) {
        applicationContext.modeloPermissoesId = modeloId;
      }
      syncProfileSelectionFromContext();
    } catch (err) {
      console.error('Erro ao carregar permissões do usuário:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Erro ao carregar permissões do usuário.', 'error');
      }
    }
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

  async function applyChanges() {
    const usuarioId = applicationContext.usuarioId;
    if (!usuarioId) {
      if (typeof window.showToast === 'function') {
        window.showToast('Selecione um usuário para aplicar as permissões.', 'warning');
      }
      return;
    }
    if (applyInProgress) return;
    const button = elements.apply;
    applyInProgress = true;
    if (button) {
      button.disabled = true;
      button.classList.add('btn-loading');
    }
    try {
      const selectedProfileKey = elements.profileSelect?.value || '';
      const profile = selectedProfileKey && profiles.has(selectedProfileKey)
        ? profiles.get(selectedProfileKey)
        : null;
      const canApplyProfileDirectly = Boolean(
        profile &&
        selectedProfileKey === state.currentProfile &&
        state.profileLoaded
      );
      let resp;
      if (canApplyProfileDirectly && profile?.id !== undefined && profile?.id !== null) {
        resp = await fetchApi(`/api/usuarios/${encodeURIComponent(usuarioId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modeloPermissoesId: profile.id,
            aplicarPermissoesDoModelo: true
          })
        });
      } else {
        const payload = canApplyProfileDirectly && profile
          ? profile.rawPayload ?? profile.payload ?? {}
          : buildPayloadFromSelections(collectSelections());
        resp = await fetchApi(`/api/usuarios/${encodeURIComponent(usuarioId)}/permissoes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissoes: payload })
        });
      }

      if (!resp.ok) {
        const messageFromResponse = await extractResponseMessage(resp);
        const errorMessage = messageFromResponse || 'Não foi possível aplicar as permissões.';
        if (typeof window.showToast === 'function') {
          window.showToast(errorMessage, 'error');
        }
        return;
      }

      try {
        await resp.json();
      } catch (err) {
        // Respostas 204 não possuem corpo
      }

      if (typeof window.showToast === 'function') {
        window.showToast('Permissões aplicadas com sucesso.', 'success');
      }

      window.dispatchEvent(new Event('usuarios:atualizado'));
      window.dispatchEvent(new CustomEvent('usuarioAtualizado', { detail: { id: usuarioId } }));
      closeModal();
    } catch (err) {
      console.error('Erro ao aplicar permissões do usuário:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Erro ao aplicar as permissões do usuário.', 'error');
      }
    } finally {
      applyInProgress = false;
      if (button) {
        button.disabled = false;
        button.classList.remove('btn-loading');
      }
    }
  }

  async function handleSaveExisting(event) {
    const key = elements.profileSelect?.value;
    if (!key || !profiles.has(key) || key !== state.currentProfile) return;
    const profile = profiles.get(key);
    if (!profile?.id) {
      if (typeof window.showToast === 'function') {
        window.showToast('Não é possível atualizar um perfil que ainda não foi salvo.', 'warning');
      }
      return;
    }
    const button = event?.currentTarget || elements.save;
    if (button) button.disabled = true;
    const selections = collectSelections();
    const payload = {
      nome: profile.name,
      descricao: profile.description || '',
      permissoes: buildPayloadFromSelections(selections)
    };
    try {
      const resp = await fetchApi(`/api/usuarios/modelos-permissoes/${encodeURIComponent(profile.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const messageFromResponse = await extractResponseMessage(resp);
        const errorMessage = getErrorMessageForStatus(
          resp.status,
          messageFromResponse || 'Não foi possível atualizar o modelo de permissões.'
        );
        if (typeof window.showToast === 'function') {
          window.showToast(errorMessage, 'error');
        }
        return;
      }
      const data = await resp.json();
      const modelo = data?.modelo ?? data;
      const normalizedProfile = convertModelToProfile(modelo);
      const finalKey = normalizedProfile.key;
      if (finalKey !== key) {
        profiles.delete(key);
      }
      profiles.set(finalKey, normalizedProfile);
      adicionarOuAtualizarOpcao(finalKey, normalizedProfile.name, normalizedProfile.id);
      if (elements.profileSelect) {
        elements.profileSelect.value = finalKey;
      }
      markProfileLoaded(finalKey);
      if (typeof window.showToast === 'function') {
        window.showToast('Perfil atualizado com sucesso.', 'success');
      }
    } catch (err) {
      console.error('Erro ao atualizar modelo de permissões:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Erro ao atualizar o modelo de permissões.', 'error');
      }
    } finally {
      if (button) button.disabled = false;
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

  function adicionarOuAtualizarOpcao(key, label, id = null) {
    if (!elements.profileSelect) return;
    let option = elements.profileSelect.querySelector(`option[value="${key}"]`);
    if (!option) {
      option = document.createElement('option');
      option.value = key;
      elements.profileSelect.appendChild(option);
    }
    option.textContent = label;
    option.dataset.originalLabel = label;
    if (id !== null && id !== undefined) {
      option.dataset.profileId = String(id);
    } else {
      delete option.dataset.profileId;
    }
  }

  async function salvarNovoPerfil(nome, descricao) {
    const finalName = normalizarNome(nome);
    if (!finalName) return;
    const button = saveConfirmBtn;
    if (button) button.disabled = true;
    const selections = collectSelections();
    const payload = {
      nome: finalName,
      descricao: descricao || '',
      permissoes: buildPayloadFromSelections(selections)
    };
    try {
      const resp = await fetchApi('/api/usuarios/modelos-permissoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const messageFromResponse = await extractResponseMessage(resp);
        const errorMessage = getErrorMessageForStatus(
          resp.status,
          messageFromResponse || 'Não foi possível criar o modelo de permissões.'
        );
        if (typeof window.showToast === 'function') {
          window.showToast(errorMessage, 'error');
        }
        return;
      }
      const data = await resp.json();
      const modelo = data?.modelo ?? data;
      const profile = convertModelToProfile(modelo);
      profiles.set(profile.key, profile);
      adicionarOuAtualizarOpcao(profile.key, profile.name, profile.id);
      if (elements.profileSelect) {
        elements.profileSelect.value = profile.key;
      }
      markProfileLoaded(profile.key);
      fecharModalSalvar();
      if (typeof window.showToast === 'function') {
        window.showToast('Novo perfil salvo com sucesso.', 'success');
      }
    } catch (err) {
      console.error('Erro ao criar modelo de permissões:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Erro ao criar o modelo de permissões.', 'error');
      }
    } finally {
      if (button) button.disabled = false;
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
    if (!selected || !profiles.has(selected)) return;
    const profile = profiles.get(selected);
    const defaultName = profile?.name ? `${profile.name} Cópia` : 'Perfil Cópia';
    abrirModalSalvar({ name: defaultName, description: profile?.description || '' });
  }

  async function handleDelete() {
    const selected = elements.profileSelect?.value;
    if (!selected || !profiles.has(selected)) return;
    const profile = profiles.get(selected);
    const nome = profile?.name || selected;
    const confirmar = window.confirm
      ? window.confirm(`Deseja realmente excluir o perfil "${nome}"?`)
      : true;
    if (!confirmar) return;
    if (!profile?.id) {
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
        window.showToast('Perfil local removido.', 'info');
      }
      return;
    }
    const button = elements.remove;
    if (button) button.disabled = true;
    try {
      const resp = await fetchApi(`/api/usuarios/modelos-permissoes/${encodeURIComponent(profile.id)}`, {
        method: 'DELETE'
      });
      if (!resp.ok) {
        const messageFromResponse = await extractResponseMessage(resp);
        const errorMessage = getErrorMessageForStatus(
          resp.status,
          messageFromResponse || 'Não foi possível excluir o modelo de permissões.'
        );
        if (typeof window.showToast === 'function') {
          window.showToast(errorMessage, 'error');
        }
        return;
      }
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
        window.showToast('Perfil excluído com sucesso.', 'success');
      }
    } catch (err) {
      console.error('Erro ao excluir modelo de permissões:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Erro ao excluir o modelo de permissões.', 'error');
      }
    } finally {
      if (button) button.disabled = false;
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
    if (!selected || !profiles.has(selected)) return;
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
    if (!elements.profileSelect) return;
    Array.from(elements.profileSelect.options).forEach(option => {
      if (!option.value) {
        option.dataset.originalLabel = option.textContent || option.value || 'Selecionar Perfil';
      } else {
        option.remove();
      }
    });
  }

  function convertModelToProfile(modelo) {
    const nome = normalizarNome(modelo?.nome) || 'Perfil';
    const key = modelo?.id !== undefined && modelo?.id !== null ? String(modelo.id) : gerarChaveUnica(nome);
    const rawPayload = modelo?.permissoes ?? {};
    return {
      id: modelo?.id ?? null,
      key,
      name: nome,
      description: modelo?.descricao ?? modelo?.description ?? '',
      payload: normalizePermissionsPayload(rawPayload),
      rawPayload
    };
  }

  function populateProfilesFromApi(modelos = []) {
    profiles.clear();
    if (elements.profileSelect) {
      Array.from(elements.profileSelect.options).forEach(option => {
        if (option.value) option.remove();
      });
    }
    modelos.forEach(modelo => {
      const profile = convertModelToProfile(modelo);
      profiles.set(profile.key, profile);
      adicionarOuAtualizarOpcao(profile.key, profile.name, profile.id);
    });
    state.currentProfile = null;
    state.profileLoaded = false;
    if (elements.profileSelect) {
      elements.profileSelect.value = '';
    }
    resetAllOptionLabels();
    updateProfileButtons();
  }

  async function loadProfilesFromApi() {
    if (state.profilesPromise) return state.profilesPromise;
    if (!window.apiConfig?.getApiBaseUrl) return null;
    const promise = (async () => {
      try {
        const resp = await fetchApi('/api/usuarios/modelos-permissoes');
        if (!resp.ok) {
          const texto = await resp.text();
          throw new Error(texto || 'Não foi possível carregar os modelos de permissões.');
        }
        const data = await resp.json();
        const modelos = Array.isArray(data?.modelos) ? data.modelos : [];
        populateProfilesFromApi(modelos);
      } catch (err) {
        console.error('Erro ao carregar modelos de permissões:', err);
        if (typeof window.showToast === 'function') {
          window.showToast('Não foi possível carregar os modelos de permissões.', 'error');
        }
      } finally {
        state.profilesPromise = null;
        updateProfileButtons();
      }
    })();
    state.profilesPromise = promise;
    return promise;
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

  initTabs();
  initAccordions();
  initCheckboxes();
  initProfileOptions();
  initEvents();
  setAllModulesState(true);
  updateProfileButtons();
  applySearch('');
  const profilesLoadingPromise = loadProfilesFromApi();
  if (profilesLoadingPromise && typeof profilesLoadingPromise.then === 'function') {
    profilesLoadingPromise
      .then(() => {
        syncProfileSelectionFromContext({ loadProfileIfNoUser: !applicationContext.usuarioId });
      })
      .catch(err => {
        console.error('Erro ao sincronizar modelos de permissões:', err);
      });
  } else {
    syncProfileSelectionFromContext({ loadProfileIfNoUser: !applicationContext.usuarioId });
  }

  if (applicationContext.usuarioId) {
    loadUserPermissions(applicationContext.usuarioId);
  }

  if (typeof Modal?.signalReady === 'function') {
    Modal.signalReady(overlayId);
  }
  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));
})();
