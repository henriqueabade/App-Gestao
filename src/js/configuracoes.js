const NotificationPreferences = (() => {
    const STORAGE_KEY = 'menu.notifications';
    const EVENT_NAME = 'menu-notification-preferences-changed';

    const DEFAULT_STATE = {
        enabled: true,
        categories: {
            system: true,
            tasks: true,
            sales: true,
            finance: true
        }
    };

    const clone = (value) => {
        if (typeof structuredClone === 'function') {
            return structuredClone(value);
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            console.warn('Não foi possível clonar preferências', error);
            return value;
        }
    };

    function parseStoredState(raw) {
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            const enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_STATE.enabled;
            const categories = normalizeCategories(parsed.categories);
            return { enabled, categories };
        } catch (err) {
            console.warn('Não foi possível ler preferências do menu.notifications', err);
            return null;
        }
    }

    function normalizeCategories(source) {
        const normalized = { ...DEFAULT_STATE.categories };
        if (Array.isArray(source)) {
            Object.keys(normalized).forEach(key => {
                normalized[key] = source.includes(key);
            });
            source.forEach(key => {
                if (!(key in normalized)) {
                    normalized[key] = true;
                }
            });
            return normalized;
        }

        if (source && typeof source === 'object') {
            Object.entries(source).forEach(([key, value]) => {
                normalized[key] = Boolean(value);
            });
            return normalized;
        }

        return normalized;
    }

    function load() {
        const stored = parseStoredState(localStorage.getItem(STORAGE_KEY));
        return stored ? stored : clone(DEFAULT_STATE);
    }

    function save(state) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (err) {
            console.warn('Não foi possível salvar preferências de notificações', err);
        }
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { preferences: clone(state) } }));
    }

    return {
        getDefault: () => clone(DEFAULT_STATE),
        load,
        save,
        normalizeCategories,
        clone
    };
})();

const MenuQuickActionsPreferences = (() => {
    const STORAGE_KEY = 'menu.quickActions';
    const EVENT_NAME = 'menu-quick-actions-changed';

    const DEFAULT_STATE = {
        actions: {
            logout: true,
            minimize: true,
            reload: true,
            'select-display': true,
            close: true
        },
        showAvatar: true,
        showName: true
    };

    const clone = (value) => {
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (error) {
                // ignore structured clone failures and fallback to JSON
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            console.warn('Não foi possível clonar preferências do menu.quickActions', error);
            return value;
        }
    };

    function normalize(raw) {
        const normalized = {
            actions: { ...DEFAULT_STATE.actions },
            showAvatar: DEFAULT_STATE.showAvatar,
            showName: DEFAULT_STATE.showName
        };

        if (!raw || typeof raw !== 'object') {
            return normalized;
        }

        if (raw.actions && typeof raw.actions === 'object') {
            Object.entries(raw.actions).forEach(([key, enabled]) => {
                if (key in normalized.actions) {
                    normalized.actions[key] = Boolean(enabled);
                }
            });
        }

        if (Array.isArray(raw.actions)) {
            Object.keys(normalized.actions).forEach(key => {
                normalized.actions[key] = raw.actions.includes(key);
            });
        }

        if (typeof raw.showAvatar === 'boolean') {
            normalized.showAvatar = raw.showAvatar;
        }
        if (typeof raw.showName === 'boolean') {
            normalized.showName = raw.showName;
        }

        return normalized;
    }

    function load() {
        if (typeof localStorage === 'undefined') {
            return clone(DEFAULT_STATE);
        }
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            const parsed = stored ? JSON.parse(stored) : null;
            return clone(normalize(parsed));
        } catch (error) {
            console.warn('Não foi possível ler preferências do menu.quickActions', error);
            return clone(DEFAULT_STATE);
        }
    }

    function save(state) {
        const normalized = normalize(state);
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
            } catch (error) {
                console.warn('Não foi possível salvar preferências do menu.quickActions', error);
            }
        }
        if (state && typeof state === 'object') {
            Object.assign(state, normalized);
        }
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { preferences: clone(normalized) } }));
        return normalized;
    }

    return {
        EVENT_NAME,
        clone,
        normalize,
        load,
        save,
        getDefault: () => clone(DEFAULT_STATE)
    };
})();

const MenuThemePreferences = (() => {
    const STORAGE_KEY = 'menu.theme';
    const DEFAULT_THEME = 'dark';
    const VALID_THEMES = new Set(['light', 'dark']);

    function normalize(theme) {
        if (!theme || typeof theme !== 'string') {
            return DEFAULT_THEME;
        }
        const normalized = theme.toLowerCase();
        return VALID_THEMES.has(normalized) ? normalized : DEFAULT_THEME;
    }

    function readFromStorage() {
        if (typeof localStorage === 'undefined') {
            return null;
        }
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? normalize(stored) : null;
        } catch (error) {
            console.warn('Não foi possível ler o tema do menu do localStorage', error);
            return null;
        }
    }

    function saveToStorage(theme) {
        if (typeof localStorage === 'undefined') {
            return;
        }
        try {
            localStorage.setItem(STORAGE_KEY, normalize(theme));
        } catch (error) {
            console.warn('Não foi possível salvar o tema do menu do localStorage', error);
        }
    }

    function dispatchThemeChange(theme) {
        window.dispatchEvent(new CustomEvent('menu-theme-change', { detail: { theme } }));
    }

    function apply(theme) {
        const normalizedTheme = normalize(theme);
        if (window.MenuTheme && typeof window.MenuTheme.setTheme === 'function') {
            window.MenuTheme.setTheme(normalizedTheme);
        } else {
            document.documentElement.dataset.menuTheme = normalizedTheme;
            saveToStorage(normalizedTheme);
            dispatchThemeChange(normalizedTheme);
        }
        return normalizedTheme;
    }

    function getCurrent() {
        if (window.MenuTheme && typeof window.MenuTheme.getTheme === 'function') {
            return normalize(window.MenuTheme.getTheme());
        }
        const datasetTheme = document.documentElement?.dataset?.menuTheme;
        const stored = readFromStorage();
        return normalize(stored || datasetTheme || DEFAULT_THEME);
    }

    return {
        STORAGE_KEY,
        DEFAULT_THEME,
        normalize,
        apply,
        getCurrent
    };
})();

const MenuStartupPreferences = (() => {
    const STORAGE_KEYS = {
        defaultPage: 'menu.defaultPage',
        crmExpanded: 'menu.crmExpanded',
        lastPage: 'menu.lastPage'
    };

    const DEFAULT_STATE = {
        defaultPage: 'dashboard',
        crmExpanded: false
    };

    const PAGE_LABELS = {
        dashboard: 'Dashboard',
        'materia-prima': 'Matéria Prima',
        produtos: 'Produtos',
        orcamentos: 'Orçamentos',
        pedidos: 'Pedidos',
        clientes: 'Clientes',
        prospeccoes: 'Prospecções',
        contatos: 'Contatos',
        calendario: 'Calendário',
        tarefas: 'Tarefas',
        ia: 'IA',
        usuarios: 'Usuários',
        financeiro: 'Financeiro',
        relatorios: 'Relatórios',
        configuracoes: 'Configurações'
    };

    const VALID_PAGES = new Set(Object.keys(PAGE_LABELS));

    function normalizeDefaultPage(value) {
        if (!value || typeof value !== 'string') {
            return DEFAULT_STATE.defaultPage;
        }
        const normalized = value.toLowerCase();
        if (normalized === 'last') {
            return 'last';
        }
        return VALID_PAGES.has(normalized) ? normalized : DEFAULT_STATE.defaultPage;
    }

    function readDefaultPage() {
        if (typeof localStorage === 'undefined') {
            return DEFAULT_STATE.defaultPage;
        }
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.defaultPage);
            return normalizeDefaultPage(stored);
        } catch (error) {
            console.warn('Não foi possível ler a página padrão do menu', error);
            return DEFAULT_STATE.defaultPage;
        }
    }

    function readCrmExpanded() {
        if (typeof localStorage === 'undefined') {
            return DEFAULT_STATE.crmExpanded;
        }
        try {
            return localStorage.getItem(STORAGE_KEYS.crmExpanded) === '1';
        } catch (error) {
            console.warn('Não foi possível ler a preferência de expansão do CRM', error);
            return DEFAULT_STATE.crmExpanded;
        }
    }

    function readLastVisitedPage() {
        if (typeof localStorage === 'undefined') {
            return null;
        }
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.lastPage);
            const normalized = normalizeDefaultPage(stored);
            return normalized === 'last' ? null : normalized;
        } catch (error) {
            console.warn('Não foi possível ler o último módulo visitado', error);
            return null;
        }
    }

    function saveDefaultPage(page) {
        if (typeof localStorage === 'undefined') {
            return;
        }
        try {
            localStorage.setItem(STORAGE_KEYS.defaultPage, normalizeDefaultPage(page));
        } catch (error) {
            console.warn('Não foi possível salvar a página padrão do menu', error);
        }
    }

    function saveCrmExpanded(expanded) {
        if (typeof localStorage === 'undefined') {
            return;
        }
        try {
            localStorage.setItem(STORAGE_KEYS.crmExpanded, expanded ? '1' : '0');
        } catch (error) {
            console.warn('Não foi possível salvar a preferência de expansão do CRM', error);
        }
    }

    function getPageLabel(page) {
        return PAGE_LABELS[page] || page;
    }

    function load() {
        return {
            defaultPage: readDefaultPage(),
            crmExpanded: readCrmExpanded()
        };
    }

    return {
        STORAGE_KEYS,
        DEFAULT_STATE,
        normalizeDefaultPage,
        getPageLabel,
        load,
        saveDefaultPage,
        saveCrmExpanded,
        readLastVisitedPage
    };
})();

(function initialiseConfigurationsPage() {
    const PAGE_ID = 'configuracoes';
    const MODULE_SELECTOR = `.modulo-container[data-page="${PAGE_ID}"]`;
    const PERSONAL_DATA_FOCUS_STORAGE_KEY = 'configuracoesFocus';
    const PERSONAL_DATA_FOCUS_TARGET = 'personal-data';

    let currentState = NotificationPreferences.load();
    let currentTheme = MenuThemePreferences.getCurrent();
    let startupPreferences = MenuStartupPreferences.load();
    let moduleElement = null;
    let quickActionsPreferences = MenuQuickActionsPreferences.load();

    const dom = {
        toggle: null,
        status: null,
        categoryInputs: [],
        summary: null,
        menuThemeToggle: null,
        menuThemeStatus: null,
        defaultPageSelect: null,
        defaultPageStatus: null,
        crmExpandedToggle: null,
        crmExpandedStatus: null,
        quickActionInputs: [],
        quickActionsStatus: null,
        quickActionShowAvatar: null,
        quickActionShowName: null,
        quickIdentityStatus: null,
        profile: {
            section: null,
            form: null,
            name: null,
            email: null,
            phone: null,
            password: null,
            confirmPassword: null,
            feedback: null,
            submit: null,
            reset: null,
            avatarInput: null,
            avatarPreview: null,
            avatarInitials: null,
            fields: {},
            errors: {}
        }
    };

    const PERSONAL_DATA_FOCUSABLE_SELECTOR = [
        'input:not([disabled]):not([tabindex="-1"])',
        'select:not([disabled]):not([tabindex="-1"])',
        'textarea:not([disabled]):not([tabindex="-1"])',
        'button:not([disabled]):not([tabindex="-1"])'
    ].join(', ');

    function hasPendingPersonalDataFocus() {
        if (typeof sessionStorage === 'undefined') {
            return false;
        }
        try {
            return sessionStorage.getItem(PERSONAL_DATA_FOCUS_STORAGE_KEY) === PERSONAL_DATA_FOCUS_TARGET;
        } catch (error) {
            console.warn('Não foi possível verificar indicador de foco das configurações', error);
            return false;
        }
    }

    function clearPendingPersonalDataFocus() {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        try {
            sessionStorage.removeItem(PERSONAL_DATA_FOCUS_STORAGE_KEY);
        } catch (error) {
            console.warn('Não foi possível limpar indicador de foco das configurações', error);
        }
    }

    function ensurePersonalDataDom() {
        if (!moduleElement) {
            moduleElement = document.querySelector(MODULE_SELECTOR) || document.querySelector('[data-module="configuracoes"]');
        }
        if (!moduleElement) {
            return false;
        }

        if (!dom.profile.section) {
            dom.profile.section = moduleElement.querySelector('#personalDataSettings');
        }
        if (!dom.profile.form) {
            dom.profile.form = moduleElement.querySelector('#personalDataForm');
        }
        if (!dom.profile.name) {
            dom.profile.name = moduleElement.querySelector('#personalDataName');
        }
        if (!dom.profile.email) {
            dom.profile.email = moduleElement.querySelector('#personalDataEmail');
        }
        if (!dom.profile.phone) {
            dom.profile.phone = moduleElement.querySelector('#personalDataPhone');
        }
        if (!dom.profile.password) {
            dom.profile.password = moduleElement.querySelector('#personalDataPassword');
        }
        if (!dom.profile.confirmPassword) {
            dom.profile.confirmPassword = moduleElement.querySelector('#personalDataPasswordConfirm');
        }

        return Boolean(dom.profile.section);
    }

    function focusPersonalDataSettings(options = {}) {
        const { scrollBehavior = 'smooth', preserveFlag = false } = options || {};
        if (!ensurePersonalDataDom()) {
            if (!preserveFlag) {
                clearPendingPersonalDataFocus();
            }
            return false;
        }

        const section = dom.profile.section;
        const form = dom.profile.form;

        if (section && typeof section.scrollIntoView === 'function') {
            try {
                section.scrollIntoView({ behavior: scrollBehavior, block: 'start', inline: 'nearest' });
            } catch (error) {
                section.scrollIntoView({ behavior: scrollBehavior });
            }
        }

        let focusTarget = null;
        if (form) {
            focusTarget = form.querySelector(PERSONAL_DATA_FOCUSABLE_SELECTOR);
        }

        if (!focusTarget) {
            focusTarget = section;
        }

        const applyFocus = element => {
            if (!element) {
                return false;
            }

            if (element === section && !element.hasAttribute('tabindex')) {
                element.setAttribute('tabindex', '-1');
                element.addEventListener('blur', () => {
                    element.removeAttribute('tabindex');
                }, { once: true });
            }

            try {
                element.focus({ preventScroll: true });
            } catch (error) {
                element.focus();
            }

            return true;
        };

        const focused = applyFocus(focusTarget);

        if (!preserveFlag) {
            clearPendingPersonalDataFocus();
        }

        return focused;
    }

    function handlePendingPersonalDataFocus() {
        if (!hasPendingPersonalDataFocus()) {
            return;
        }

        requestAnimationFrame(() => {
            focusPersonalDataSettings({ scrollBehavior: 'smooth' });
        });
    }

    const USER_PROFILE_EVENT = 'user-profile-updated';
    const API_PROFILE_ENDPOINT = '/api/usuarios/me';
    const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
    const PROFILE_FIELD_KEYS = ['nome', 'email', 'telefone', 'senha', 'confirmacao'];

    const profileState = {
        loading: false,
        saving: false,
        data: null,
        initialData: null,
        avatarDataUrl: null,
        avatarObjectUrl: null,
        avatarChanged: false
    };

    async function fetchApi(path, options = {}) {
        if (!window.apiConfig || typeof window.apiConfig.getApiBaseUrl !== 'function') {
            throw new Error('Configuração da API não disponível.');
        }
        const baseUrl = await window.apiConfig.getApiBaseUrl();
        return fetch(`${baseUrl}${path}`, options);
    }

    function normalizeUserProfile(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const nome = source.nome ?? source.name ?? '';
        const email = source.email ?? source.mail ?? '';
        const telefoneFonte =
            source.telefone ??
            source.phone ??
            source.celular ??
            source.telefoneContato ??
            source.telefone_contato ??
            '';
        const telefone = telefoneFonte ? String(telefoneFonte).trim() : '';
        const perfil = source.perfil ?? source.role ?? source.tipo ?? '';
        const avatar =
            source.avatarUrl ??
            source.fotoUrl ??
            source.foto ??
            source.avatar ??
            source.imagem ??
            source.image ??
            null;

        return {
            ...source,
            nome: nome ? String(nome).trim() : '',
            email: email ? String(email).trim() : '',
            telefone,
            perfil: perfil ? String(perfil).trim() : '',
            avatarUrl: avatar ? String(avatar).trim() : null
        };
    }

    function getInitialsFromName(name) {
        if (!name) return '';
        return String(name)
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0])
            .join('')
            .toUpperCase();
    }

    function updateAvatarPreview(sourceUrl, fallbackName) {
        const previewEl = dom.profile.avatarPreview;
        const initialsEl = dom.profile.avatarInitials;
        if (!previewEl) return;

        const sanitizedUrl = sourceUrl ? `url("${String(sourceUrl).replace(/"/g, '\\"')}")` : 'none';
        previewEl.style.setProperty('--avatar-preview-image', sanitizedUrl);
        const hasImage = Boolean(sourceUrl);
        previewEl.classList.toggle('has-image', hasImage);
        previewEl.dataset.hasImage = hasImage ? 'true' : 'false';

        if (initialsEl) {
            initialsEl.textContent = getInitialsFromName(fallbackName);
        }
    }

    function setProfileFeedback(message, type = 'info') {
        const feedbackEl = dom.profile.feedback;
        if (!feedbackEl) return;
        feedbackEl.textContent = message || '';
        feedbackEl.classList.remove('personal-feedback--error', 'personal-feedback--success');
        if (type === 'error') {
            feedbackEl.classList.add('personal-feedback--error');
        } else if (type === 'success') {
            feedbackEl.classList.add('personal-feedback--success');
        }
    }

    function clearSingleProfileError(key) {
        const fieldWrapper = dom.profile.fields?.[key];
        const errorEl = dom.profile.errors?.[key];
        if (fieldWrapper) {
            fieldWrapper.classList.remove('has-error');
        }
        if (errorEl) {
            errorEl.textContent = '';
        }
    }

    function clearProfileErrors() {
        PROFILE_FIELD_KEYS.forEach(clearSingleProfileError);
    }

    function applyProfileErrors(errors) {
        if (!errors) return;
        Object.entries(errors).forEach(([key, message]) => {
            const fieldWrapper = dom.profile.fields?.[key];
            const errorEl = dom.profile.errors?.[key];
            if (fieldWrapper) {
                fieldWrapper.classList.add('has-error');
            }
            if (errorEl) {
                errorEl.textContent = message;
            }
        });
    }

    function collectProfileFormValues() {
        return {
            nome: dom.profile.name ? dom.profile.name.value.trim() : '',
            email: dom.profile.email ? dom.profile.email.value.trim() : '',
            telefone: dom.profile.phone ? dom.profile.phone.value.trim() : '',
            senha: dom.profile.password ? dom.profile.password.value : '',
            confirmacao: dom.profile.confirmPassword ? dom.profile.confirmPassword.value : ''
        };
    }

    function isValidEmail(value) {
        if (!value) return false;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(value);
    }

    function isValidPhone(value) {
        if (!value) return true;
        const digits = value.replace(/\D/g, '');
        return digits.length >= 10 && digits.length <= 15;
    }

    function validateProfileForm(values) {
        const errors = {};
        if (!values.nome) {
            errors.nome = 'Informe o nome completo.';
        }
        if (!values.email) {
            errors.email = 'Informe um e-mail válido.';
        } else if (!isValidEmail(values.email)) {
            errors.email = 'O e-mail informado não é válido.';
        }
        if (values.telefone && !isValidPhone(values.telefone)) {
            errors.telefone = 'Informe um telefone válido (DDD + número).';
        }
        if (values.senha && values.senha.length < 6) {
            errors.senha = 'A nova senha deve ter pelo menos 6 caracteres.';
        }
        if (values.confirmacao) {
            if (!values.senha) {
                errors.confirmacao = 'Preencha a nova senha para confirmar.';
            } else if (values.confirmacao !== values.senha) {
                errors.confirmacao = 'As senhas informadas não coincidem.';
            }
        }
        return errors;
    }

    function setFormDisabled(disabled) {
        if (!dom.profile.form) return;
        const elements = dom.profile.form.querySelectorAll('input, button');
        elements.forEach(el => {
            el.disabled = disabled;
        });
    }

    function setProfileLoading(isLoading) {
        profileState.loading = isLoading;
        if (dom.profile.section) {
            dom.profile.section.classList.toggle('is-loading', isLoading);
        }
        if (dom.profile.form) {
            dom.profile.form.classList.toggle('is-loading', isLoading);
        }
        setFormDisabled(isLoading || profileState.saving);
    }

    function setProfileSaving(isSaving) {
        profileState.saving = isSaving;
        if (dom.profile.submit) {
            dom.profile.submit.classList.toggle('is-loading', isSaving);
        }
        setFormDisabled(isSaving || profileState.loading);
    }

    function renderProfileData() {
        if (!dom.profile.form) return;
        const data = profileState.data || {};
        if (dom.profile.name) {
            dom.profile.name.value = data.nome || '';
        }
        if (dom.profile.email) {
            dom.profile.email.value = data.email || '';
        }
        if (dom.profile.phone) {
            dom.profile.phone.value = data.telefone || '';
        }
        if (dom.profile.password) {
            dom.profile.password.value = '';
        }
        if (dom.profile.confirmPassword) {
            dom.profile.confirmPassword.value = '';
        }
        if (dom.profile.avatarInput) {
            dom.profile.avatarInput.value = '';
        }
        updateAvatarPreview(profileState.avatarObjectUrl || data.avatarUrl, data.nome || '');
    }

    function readStoredUser() {
        try {
            const stored = sessionStorage.getItem('currentUser') || localStorage.getItem('user');
            return stored ? JSON.parse(stored) : null;
        } catch (error) {
            return null;
        }
    }

    function prefillProfileFromStorage() {
        const stored = readStoredUser();
        if (!stored) return;
        const normalized = normalizeUserProfile(stored);
        profileState.data = { ...normalized };
        profileState.initialData = { ...normalized };
        profileState.avatarChanged = false;
        profileState.avatarDataUrl = null;
        revokeAvatarObjectUrl();
        renderProfileData();
        clearProfileErrors();
    }

    function revokeAvatarObjectUrl() {
        if (profileState.avatarObjectUrl) {
            URL.revokeObjectURL(profileState.avatarObjectUrl);
            profileState.avatarObjectUrl = null;
        }
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
            reader.readAsDataURL(file);
        });
    }

    async function handleAvatarInputChange(event) {
        const file = event?.target?.files?.[0];
        if (!file) {
            profileState.avatarChanged = false;
            profileState.avatarDataUrl = null;
            revokeAvatarObjectUrl();
            updateAvatarPreview(profileState.data?.avatarUrl || null, collectProfileFormValues().nome || profileState.data?.nome || '');
            return;
        }

        if (file.size > MAX_AVATAR_SIZE) {
            setProfileFeedback('A imagem selecionada excede o limite de 2 MB. Escolha um arquivo menor.', 'error');
            event.target.value = '';
            return;
        }

        const mimeType = (file.type || '').toLowerCase();
        if (mimeType && !mimeType.startsWith('image/')) {
            setProfileFeedback('Escolha um arquivo de imagem nos formatos JPG ou PNG.', 'error');
            event.target.value = '';
            return;
        }

        revokeAvatarObjectUrl();
        profileState.avatarObjectUrl = URL.createObjectURL(file);
        profileState.avatarChanged = true;
        updateAvatarPreview(profileState.avatarObjectUrl, collectProfileFormValues().nome || profileState.data?.nome || '');
        setProfileFeedback('Pré-visualização atualizada. Salve para confirmar a nova foto.', 'info');

        try {
            const dataUrl = await readFileAsDataUrl(file);
            profileState.avatarDataUrl = dataUrl;
        } catch (error) {
            console.error('Erro ao ler imagem selecionada:', error);
            setProfileFeedback('Não foi possível carregar a imagem selecionada.', 'error');
        }
    }

    function persistUserToStorage(user) {
        if (!user || typeof user !== 'object') {
            return;
        }
        const payload = { ...user };
        if (payload.avatarUrl) {
            payload.fotoUrl = payload.fotoUrl || payload.avatarUrl;
            payload.foto = payload.foto || payload.avatarUrl;
        }
        try {
            sessionStorage.setItem('currentUser', JSON.stringify(payload));
        } catch (error) {
            console.warn('Não foi possível atualizar o usuário na sessão', error);
        }
        try {
            if (localStorage.getItem('rememberUser') === '1') {
                localStorage.setItem('user', JSON.stringify(payload));
            }
        } catch (error) {
            console.warn('Não foi possível atualizar o usuário salvo localmente', error);
        }
    }

    function dispatchUserProfileUpdated(user) {
        window.dispatchEvent(new CustomEvent(USER_PROFILE_EVENT, { detail: { user } }));
    }

    async function loadProfileData() {
        if (!dom.profile.section || profileState.loading) {
            return;
        }
        setProfileFeedback('Carregando suas informações...', 'info');
        setProfileLoading(true);
        try {
            const response = await fetchApi(API_PROFILE_ENDPOINT, { credentials: 'include' });
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                const message = errorData?.error || errorData?.message || 'Não foi possível carregar seus dados.';
                throw new Error(message);
            }
            const payload = await response.json();
            const normalized = normalizeUserProfile(payload);
            profileState.data = { ...normalized };
            profileState.initialData = { ...normalized };
            profileState.avatarChanged = false;
            profileState.avatarDataUrl = null;
            revokeAvatarObjectUrl();
            renderProfileData();
            clearProfileErrors();
            setProfileFeedback('', 'info');
        } catch (error) {
            console.error('Falha ao carregar perfil do usuário:', error);
            setProfileFeedback(error.message || 'Não foi possível carregar seus dados no momento.', 'error');
        } finally {
            setProfileLoading(false);
        }
    }

    function handleProfileReset() {
        if (!dom.profile.form) return;
        if (profileState.initialData) {
            profileState.data = { ...profileState.initialData };
        }
        profileState.avatarChanged = false;
        profileState.avatarDataUrl = null;
        revokeAvatarObjectUrl();
        renderProfileData();
        clearProfileErrors();
        setProfileFeedback('Alterações descartadas.', 'info');
    }

    async function handleProfileSubmit(event) {
        if (event) {
            event.preventDefault();
        }
        if (!dom.profile.form || profileState.saving) {
            return;
        }

        clearProfileErrors();
        const values = collectProfileFormValues();
        const errors = validateProfileForm(values);
        if (Object.keys(errors).length > 0) {
            applyProfileErrors(errors);
            setProfileFeedback('Revise os campos destacados antes de continuar.', 'error');
            return;
        }

        const payload = {
            nome: values.nome,
            email: values.email,
            telefone: values.telefone || null
        };
        if (values.senha) {
            payload.senha = values.senha;
        }
        if (profileState.avatarChanged && profileState.avatarDataUrl) {
            payload.avatar = profileState.avatarDataUrl;
        }

        setProfileSaving(true);
        setProfileFeedback('Salvando alterações...', 'info');

        try {
            const response = await fetchApi(API_PROFILE_ENDPOINT, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                credentials: 'include'
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                const message = errorData?.error || errorData?.message || 'Não foi possível salvar as alterações.';
                throw new Error(message);
            }
            const result = await response.json();
            const normalized = normalizeUserProfile({ ...profileState.data, ...result });
            profileState.data = { ...normalized };
            profileState.initialData = { ...normalized };
            profileState.avatarChanged = false;
            profileState.avatarDataUrl = null;
            revokeAvatarObjectUrl();
            renderProfileData();
            setProfileFeedback('Dados atualizados com sucesso!', 'success');
            persistUserToStorage(profileState.data);
            dispatchUserProfileUpdated(profileState.data);
        } catch (error) {
            console.error('Falha ao salvar dados pessoais:', error);
            setProfileFeedback(error.message || 'Não foi possível salvar as alterações.', 'error');
        } finally {
            setProfileSaving(false);
        }
    }

    function bindProfileFieldListeners() {
        if (!dom.profile.form) {
            return;
        }
        const nameInput = dom.profile.name;
        if (nameInput) {
            nameInput.addEventListener('input', () => clearSingleProfileError('nome'));
        }
        if (dom.profile.email) {
            dom.profile.email.addEventListener('input', () => clearSingleProfileError('email'));
        }
        if (dom.profile.phone) {
            dom.profile.phone.addEventListener('input', () => clearSingleProfileError('telefone'));
        }
        if (dom.profile.password) {
            dom.profile.password.addEventListener('input', () => clearSingleProfileError('senha'));
        }
        if (dom.profile.confirmPassword) {
            dom.profile.confirmPassword.addEventListener('input', () => clearSingleProfileError('confirmacao'));
        }
    }

    function initProfileSection() {
        if (!dom.profile.section) return;
        prefillProfileFromStorage();
        loadProfileData();
    }


    function formatStatus(enabled) {
        return enabled
            ? 'As notificações do menu estão ativas. Novos alertas serão exibidos no sino superior.'
            : 'As notificações do menu estão desativadas. Você pode reativá-las quando desejar.';
    }

    function formatThemeStatus(theme) {
        return theme === 'dark'
            ? 'Tema escuro ativo. O menu utiliza tons escuros com alto contraste.'
            : 'Tema claro ativo. O menu utiliza tons claros e textos em destaque.';
    }

    function formatSummary(state) {
        const activeEntries = Object.entries(state.categories).filter(([, value]) => value);
        if (!state.enabled) {
            return 'Ative as notificações para selecionar categorias relevantes.';
        }
        if (activeEntries.length === 0) {
            return 'Nenhuma categoria selecionada no momento. Escolha as mais importantes para o seu dia a dia.';
        }

        const labels = activeEntries.map(([key]) => getCategoryLabel(key));
        return `Categorias selecionadas: ${labels.join(', ')}.`;
    }

    function getCategoryLabel(key) {
        switch (key) {
            case 'system':
                return 'Atualizações do sistema';
            case 'tasks':
                return 'Tarefas e lembretes';
            case 'sales':
                return 'Vendas e pedidos';
            case 'finance':
                return 'Financeiro';
            default:
                return key;
        }
    }

    function applyStateToUI() {
        if (!moduleElement) return;
        if (dom.toggle) {
            dom.toggle.checked = !!currentState.enabled;
        }
        if (dom.status) {
            dom.status.textContent = formatStatus(currentState.enabled);
        }
        dom.categoryInputs.forEach(input => {
            const key = input.value;
            input.checked = Boolean(currentState.categories[key]);
            input.disabled = !currentState.enabled;
        });
        if (dom.summary) {
            dom.summary.textContent = formatSummary(currentState);
        }
        applyThemeToUI(currentTheme);
        applyStartupPreferencesToUI();
        applyQuickActionsToUI();
    }

    function handleToggleChange(event) {
        currentState.enabled = event.target.checked;
        applyStateToUI();
        NotificationPreferences.save(currentState);
    }

    function applyThemeToUI(theme) {
        if (!moduleElement) return;
        const normalizedTheme = MenuThemePreferences.normalize(theme);
        currentTheme = normalizedTheme;
        if (dom.menuThemeToggle) {
            dom.menuThemeToggle.checked = normalizedTheme === 'dark';
        }
        if (dom.menuThemeStatus) {
            dom.menuThemeStatus.textContent = formatThemeStatus(normalizedTheme);
        }
    }

    function applyStartupPreferencesToUI() {
        if (!moduleElement) return;
        if (dom.defaultPageSelect) {
            dom.defaultPageSelect.value = startupPreferences.defaultPage;
        }
        if (dom.defaultPageStatus) {
            dom.defaultPageStatus.textContent = formatDefaultPageStatus(startupPreferences.defaultPage);
        }
        if (dom.crmExpandedToggle) {
            dom.crmExpandedToggle.checked = !!startupPreferences.crmExpanded;
        }
        if (dom.crmExpandedStatus) {
            dom.crmExpandedStatus.textContent = formatCrmExpandedStatus(startupPreferences.crmExpanded);
        }
    }

    function handleDefaultPageChange(event) {
        const normalized = MenuStartupPreferences.normalizeDefaultPage(event.target.value);
        startupPreferences.defaultPage = normalized;
        MenuStartupPreferences.saveDefaultPage(normalized);
        applyStartupPreferencesToUI();
    }

    function applyQuickActionsToUI() {
        if (!moduleElement) return;
        dom.quickActionInputs.forEach(input => {
            const key = input.dataset.quickAction;
            if (!key) return;
            input.checked = Boolean(quickActionsPreferences.actions[key]);
        });
        if (dom.quickActionsStatus) {
            dom.quickActionsStatus.textContent = formatQuickActionsStatus(quickActionsPreferences);
        }
        if (dom.quickActionShowAvatar) {
            dom.quickActionShowAvatar.checked = !!quickActionsPreferences.showAvatar;
        }
        if (dom.quickActionShowName) {
            dom.quickActionShowName.checked = !!quickActionsPreferences.showName;
        }
        if (dom.quickIdentityStatus) {
            dom.quickIdentityStatus.textContent = formatQuickIdentityStatus(quickActionsPreferences);
        }
    }

    function handleCrmExpandedChange(event) {
        const expanded = event.target.checked;
        startupPreferences.crmExpanded = expanded;
        MenuStartupPreferences.saveCrmExpanded(expanded);
        applyStartupPreferencesToUI();
    }

    function handleQuickActionChange(event) {
        const key = event.target.dataset.quickAction;
        if (!key) return;
        quickActionsPreferences.actions[key] = event.target.checked;
        applyQuickActionsToUI();
        MenuQuickActionsPreferences.save(quickActionsPreferences);
    }

    function handleQuickIdentityChange(event) {
        const targetId = event.target.id;
        if (targetId === 'quickAction-showAvatar') {
            quickActionsPreferences.showAvatar = event.target.checked;
        } else if (targetId === 'quickAction-showName') {
            quickActionsPreferences.showName = event.target.checked;
        }
        applyQuickActionsToUI();
        MenuQuickActionsPreferences.save(quickActionsPreferences);
    }

    function formatDefaultPageStatus(page) {
        if (page === 'last') {
            const lastVisited = MenuStartupPreferences.readLastVisitedPage();
            if (lastVisited) {
                const label = MenuStartupPreferences.getPageLabel(lastVisited);
                return `O sistema abrirá a última tela visitada (${label}).`;
            }
            return 'O sistema tentará retomar a última tela visitada. Caso não haja histórico, o Dashboard será exibido.';
        }

        const label = MenuStartupPreferences.getPageLabel(page);
        return `O sistema abrirá o módulo ${label} ao iniciar.`;
    }

    function formatCrmExpandedStatus(expanded) {
        return expanded
            ? 'O submenu do CRM permanecerá expandido ao abrir o menu.'
            : 'O submenu do CRM será exibido recolhido por padrão.';
    }

    function formatQuickActionsStatus(state) {
        const enabledActions = Object.entries(state.actions)
            .filter(([, enabled]) => enabled)
            .map(([key]) => getQuickActionLabel(key));

        if (enabledActions.length === 0) {
            return 'Nenhuma ação rápida está visível no momento. O menu exibirá apenas o ícone sem opções.';
        }

        if (enabledActions.length === Object.keys(state.actions).length) {
            return 'Todas as ações rápidas estão disponíveis no menu do usuário.';
        }

        return `Ações exibidas: ${enabledActions.join(', ')}.`;
    }

    function formatQuickIdentityStatus(state) {
        if (state.showAvatar && state.showName) {
            return 'Avatar, nome e perfil do usuário serão apresentados no topo do menu.';
        }
        if (state.showAvatar && !state.showName) {
            return 'Apenas o avatar será apresentado; nome e perfil ficarão ocultos.';
        }
        if (!state.showAvatar && state.showName) {
            return 'Somente o nome e o perfil serão exibidos; o avatar permanecerá oculto.';
        }
        return 'As informações do usuário ficarão ocultas. Apenas o ícone de ações rápidas será exibido.';
    }

    function getQuickActionLabel(key) {
        switch (key) {
            case 'logout':
                return 'Sair do sistema';
            case 'minimize':
                return 'Minimizar janela';
            case 'reload':
                return 'Recarregar aplicação';
            case 'select-display':
                return 'Escolher tela';
            case 'close':
                return 'Fechar aplicação';
            default:
                return key;
        }
    }

    function handleCategoryChange(event) {
        const key = event.target.value;
        currentState.categories[key] = event.target.checked;
        applyStateToUI();
        NotificationPreferences.save(currentState);
    }

    function handleMenuThemeToggleChange(event) {
        const selectedTheme = event.target.checked ? 'dark' : 'light';
        currentTheme = MenuThemePreferences.apply(selectedTheme);
        applyThemeToUI(currentTheme);
    }

    function bindDom() {
        moduleElement = document.querySelector(MODULE_SELECTOR) || document.querySelector('[data-module="configuracoes"]');
        if (!moduleElement || moduleElement.dataset.initialized === 'true') {
            return false;
        }
        moduleElement.dataset.initialized = 'true';

        dom.toggle = moduleElement.querySelector('#notificationToggle');
        dom.status = moduleElement.querySelector('#notificationStatus');
        dom.summary = moduleElement.querySelector('#categorySummary');
        dom.categoryInputs = Array.from(moduleElement.querySelectorAll('.category-input'));
        dom.menuThemeToggle = moduleElement.querySelector('#menu-theme-toggle');
        dom.menuThemeStatus = moduleElement.querySelector('#menuThemeStatus');
        dom.defaultPageSelect = moduleElement.querySelector('#defaultModuleSelect');
        dom.defaultPageStatus = moduleElement.querySelector('#defaultModuleStatus');
        dom.crmExpandedToggle = moduleElement.querySelector('#crmExpandedToggle');
        dom.crmExpandedStatus = moduleElement.querySelector('#crmExpandedStatus');
        dom.quickActionInputs = Array.from(moduleElement.querySelectorAll('[data-quick-action]'));
        dom.quickActionsStatus = moduleElement.querySelector('#quickActionsStatus');
        dom.quickActionShowAvatar = moduleElement.querySelector('#quickAction-showAvatar');
        dom.quickActionShowName = moduleElement.querySelector('#quickAction-showName');
        dom.quickIdentityStatus = moduleElement.querySelector('#quickIdentityStatus');
        dom.profile.section = moduleElement.querySelector('#personalDataSettings');
        dom.profile.form = moduleElement.querySelector('#personalDataForm');
        dom.profile.name = moduleElement.querySelector('#personalDataName');
        dom.profile.email = moduleElement.querySelector('#personalDataEmail');
        dom.profile.phone = moduleElement.querySelector('#personalDataPhone');
        dom.profile.password = moduleElement.querySelector('#personalDataPassword');
        dom.profile.confirmPassword = moduleElement.querySelector('#personalDataPasswordConfirm');
        dom.profile.feedback = moduleElement.querySelector('#personalDataFeedback');
        dom.profile.submit = moduleElement.querySelector('#personalDataSubmit');
        dom.profile.reset = moduleElement.querySelector('#personalDataReset');
        dom.profile.avatarInput = moduleElement.querySelector('#personalAvatarInput');
        dom.profile.avatarPreview = moduleElement.querySelector('#personalAvatarPreview');
        dom.profile.avatarInitials = moduleElement.querySelector('#personalAvatarInitials');
        dom.profile.fields = {
            nome: moduleElement.querySelector('[data-field="nome"]'),
            email: moduleElement.querySelector('[data-field="email"]'),
            telefone: moduleElement.querySelector('[data-field="telefone"]'),
            senha: moduleElement.querySelector('[data-field="senha"]'),
            confirmacao: moduleElement.querySelector('[data-field="confirmacao"]')
        };
        dom.profile.errors = {
            nome: moduleElement.querySelector('#personalDataNameError'),
            email: moduleElement.querySelector('#personalDataEmailError'),
            telefone: moduleElement.querySelector('#personalDataPhoneError'),
            senha: moduleElement.querySelector('#personalDataPasswordError'),
            confirmacao: moduleElement.querySelector('#personalDataPasswordConfirmError')
        };

        if (dom.toggle) {
            dom.toggle.addEventListener('change', handleToggleChange);
        }
        dom.categoryInputs.forEach(input => {
            input.addEventListener('change', handleCategoryChange);
        });
        if (dom.menuThemeToggle) {
            dom.menuThemeToggle.addEventListener('change', handleMenuThemeToggleChange);
        }
        if (dom.defaultPageSelect) {
            dom.defaultPageSelect.addEventListener('change', handleDefaultPageChange);
        }
        if (dom.crmExpandedToggle) {
            dom.crmExpandedToggle.addEventListener('change', handleCrmExpandedChange);
        }
        dom.quickActionInputs.forEach(input => {
            input.addEventListener('change', handleQuickActionChange);
        });
        if (dom.quickActionShowAvatar) {
            dom.quickActionShowAvatar.addEventListener('change', handleQuickIdentityChange);
        }
        if (dom.quickActionShowName) {
            dom.quickActionShowName.addEventListener('change', handleQuickIdentityChange);
        }
        if (dom.profile.form) {
            dom.profile.form.addEventListener('submit', handleProfileSubmit);
        }
        if (dom.profile.reset) {
            dom.profile.reset.addEventListener('click', handleProfileReset);
        }
        if (dom.profile.avatarInput) {
            dom.profile.avatarInput.addEventListener('change', handleAvatarInputChange);
        }

        bindProfileFieldListeners();

        return true;
    }

    function init() {
        currentState = NotificationPreferences.load();
        currentTheme = MenuThemePreferences.getCurrent();
        startupPreferences = MenuStartupPreferences.load();
        quickActionsPreferences = MenuQuickActionsPreferences.load();
        bindDom();
        initProfileSection();
        applyStateToUI();
        handlePendingPersonalDataFocus();
    }

    init();

    document.addEventListener('module-change', (event) => {
        if (event?.detail?.page === PAGE_ID) {
            init();
        }
    });

    window.addEventListener('menu-theme-change', (event) => {
        const theme = MenuThemePreferences.normalize(event?.detail?.theme);
        applyThemeToUI(theme);
    });

    window.setMenuNotifications = function setMenuNotifications(update = {}) {
        const nextState = NotificationPreferences.clone(NotificationPreferences.load());

        if (typeof update.enabled === 'boolean') {
            nextState.enabled = update.enabled;
        }

        if (update.categories !== undefined) {
            nextState.categories = NotificationPreferences.normalizeCategories(update.categories);
        }

        currentState = nextState;
        applyStateToUI();
        NotificationPreferences.save(currentState);
        return NotificationPreferences.clone(currentState);
    };

    window.focusPersonalDataSettings = focusPersonalDataSettings;
})();
