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

(function initialiseConfigurationsPage() {
    const PAGE_ID = 'configuracoes';
    const MODULE_SELECTOR = `.modulo-container[data-page="${PAGE_ID}"]`;

    let currentState = NotificationPreferences.load();
    let moduleElement = null;

    const dom = {
        toggle: null,
        status: null,
        categoryInputs: [],
        summary: null
    };

    function formatStatus(enabled) {
        return enabled
            ? 'As notificações do menu estão ativas. Novos alertas serão exibidos no sino superior.'
            : 'As notificações do menu estão desativadas. Você pode reativá-las quando desejar.';
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
    }

    function handleToggleChange(event) {
        currentState.enabled = event.target.checked;
        applyStateToUI();
        NotificationPreferences.save(currentState);
    }

    function handleCategoryChange(event) {
        const key = event.target.value;
        currentState.categories[key] = event.target.checked;
        applyStateToUI();
        NotificationPreferences.save(currentState);
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

        if (dom.toggle) {
            dom.toggle.addEventListener('change', handleToggleChange);
        }
        dom.categoryInputs.forEach(input => {
            input.addEventListener('change', handleCategoryChange);
        });

        applyStateToUI();
        return true;
    }

    function init() {
        currentState = NotificationPreferences.load();
        bindDom();
    }

    init();

    document.addEventListener('module-change', (event) => {
        if (event?.detail?.page === PAGE_ID) {
            init();
        }
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
