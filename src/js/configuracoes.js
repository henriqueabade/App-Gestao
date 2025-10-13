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
        quickIdentityStatus: null
    };

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

        applyStateToUI();
        return true;
    }

    function init() {
        currentState = NotificationPreferences.load();
        currentTheme = MenuThemePreferences.getCurrent();
        startupPreferences = MenuStartupPreferences.load();
        quickActionsPreferences = MenuQuickActionsPreferences.load();
        bindDom();
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
})();
