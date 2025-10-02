// Lógica de interação para o módulo de Relatórios
function initRelatoriosModule() {
    const container = document.querySelector('.relatorios-module');
    if (!container) return;

    // Garante que o body esteja liberado caso algum modal anterior tenha alterado o overflow
    document.body.style.overflow = '';

    applyEntranceAnimations(container);

    const loadTableForTab = setupReportTables(container);

    setupCategoryTabs(container, {
        onTabChange: tab => {
            if (loadTableForTab) {
                loadTableForTab(tab);
            }
        }
    });
    setupResultTabs(container);
    setupDropdowns(container);
    setupModals(container);
    setupShare(container);
    setupGeoFilters(container);
    setupDateRangeFilters(container);

    const initialTab = container.querySelector('[data-relatorios-tab].tab-active');
    if (initialTab && loadTableForTab) {
        loadTableForTab(initialTab.dataset.relatoriosTab);
    }
}

function setupCategoryTabs(root, options = {}) {
    const { onTabChange } = options;
    const tabButtons = Array.from(root.querySelectorAll('[data-relatorios-tab]'));
    if (!tabButtons.length) return;

    const filterSections = Array.from(root.querySelectorAll('[data-relatorios-tab-content]'));
    const kpiSections = Array.from(root.querySelectorAll('[data-relatorios-kpi]'));

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const target = button.dataset.relatoriosTab;
            if (!target || button.classList.contains('tab-active')) return;

            tabButtons.forEach(btn => {
                btn.classList.remove('tab-active');
                btn.classList.add('tab-inactive');
                btn.setAttribute('aria-selected', 'false');
            });

            button.classList.add('tab-active');
            button.classList.remove('tab-inactive');
            button.setAttribute('aria-selected', 'true');

            filterSections.forEach(section => {
                section.classList.toggle('hidden', section.dataset.relatoriosTabContent !== target);
            });

            kpiSections.forEach(section => {
                section.classList.toggle('hidden', section.dataset.relatoriosKpi !== target);
            });

            if (typeof onTabChange === 'function') {
                onTabChange(target, button);
            }
        });
    });
}

function setupReportTables(root) {
    const container = root.querySelector('#relatoriosTableContainer');
    if (!container) return null;

    const templates = new Map();
    root.querySelectorAll('template[data-relatorios-template]').forEach(template => {
        const key = template.dataset.relatoriosTemplate;
        if (key) {
            templates.set(key, template);
        }
    });

    const fallback = root.querySelector('#relatoriosTableFallback');

    const loadTable = key => {
        if (!key || container.dataset.currentTab === key) return;

        container.dataset.currentTab = key;
        container.innerHTML = '';

        const template = templates.get(key);

        if (template) {
            const fragment = template.content.cloneNode(true);
            container.appendChild(fragment);
            requestAnimationFrame(() => {
                const wrapper = container.querySelector('.relatorios-table-wrapper');
                if (wrapper) {
                    wrapper.classList.add('relatorios-table-enter');
                    wrapper.addEventListener('animationend', () => {
                        wrapper.classList.remove('relatorios-table-enter');
                    }, { once: true });
                }
            });
        } else if (fallback) {
            container.appendChild(fallback.content.cloneNode(true));
        } else {
            container.innerHTML = '<p class="text-sm text-white/70">Tabela não disponível para esta categoria.</p>';
        }
    };

    return loadTable;
}

function setupResultTabs(root) {
    const tabButtons = Array.from(root.querySelectorAll('[data-relatorios-result]'));
    if (!tabButtons.length) return;

    const views = {
        table: root.querySelector('#relatoriosTableView'),
        charts: root.querySelector('#relatoriosChartsView'),
        detail: root.querySelector('#relatoriosDetailView')
    };

    const activateView = target => {
        Object.entries(views).forEach(([key, view]) => {
            if (!view) return;
            const isTarget = key === target;
            view.classList.toggle('hidden', !isTarget);
            if (isTarget) {
                animateResultView(view);
            }
        });
    };

    activateView('table');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const target = button.dataset.relatoriosResult;
            if (!target || !views[target] || button.classList.contains('tab-active')) return;

            tabButtons.forEach(btn => {
                btn.classList.remove('tab-active');
                btn.classList.add('tab-inactive');
            });

            button.classList.add('tab-active');
            button.classList.remove('tab-inactive');

            activateView(target);
        });
    });
}

function setupDropdowns(root) {
    const configs = [
        {
            button: root.querySelector('#relatoriosLoadTemplateBtn'),
            dropdown: root.querySelector('#relatoriosTemplateDropdown')
        },
        {
            button: root.querySelector('#relatoriosExportBtn'),
            dropdown: root.querySelector('#relatoriosExportDropdown')
        }
    ].filter(({ button, dropdown }) => button && dropdown);

    const closeDropdowns = () => {
        configs.forEach(({ dropdown }) => dropdown.classList.remove('visible'));
    };

    configs.forEach(({ button, dropdown }) => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const isOpen = dropdown.classList.contains('visible');
            closeDropdowns();
            if (!isOpen) {
                dropdown.classList.add('visible');
            }
        });

        dropdown.addEventListener('click', event => {
            event.stopPropagation();
        });
    });

    if (window.__relatoriosDropdownHandler) {
        document.removeEventListener('click', window.__relatoriosDropdownHandler);
    }

    const handleDocumentClick = () => closeDropdowns();
    document.addEventListener('click', handleDocumentClick);
    window.__relatoriosDropdownHandler = handleDocumentClick;
}

function setupModals(root) {
    const modals = [
        {
            openButton: root.querySelector('#relatoriosSaveTemplateBtn'),
            modal: root.querySelector('#relatoriosSaveTemplateModal'),
            closeButton: root.querySelector('#relatoriosCancelSaveTemplate')
        },
        {
            openButton: root.querySelector('#relatoriosScheduleBtn'),
            modal: root.querySelector('#relatoriosScheduleModal'),
            closeButton: root.querySelector('#relatoriosCancelSchedule')
        }
    ];

    const openModal = modal => {
        if (!modal) return;
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    };

    const closeModal = modal => {
        if (!modal) return;
        modal.classList.add('hidden');
        const anyOpen = root.querySelector('.relatorios-modal:not(.hidden)');
        if (!anyOpen) {
            document.body.style.overflow = '';
        }
    };

    modals.forEach(({ openButton, modal, closeButton }) => {
        if (!openButton || !modal || !closeButton) return;

        openButton.addEventListener('click', () => openModal(modal));
        closeButton.addEventListener('click', () => closeModal(modal));

        modal.addEventListener('click', event => {
            if (event.target && event.target.classList.contains('relatorios-modal-backdrop')) {
                closeModal(modal);
            }
        });
    });
}

function setupShare(root) {
    const shareBtn = root.querySelector('#relatoriosShareBtn');
    if (!shareBtn || !navigator.clipboard) return;

    shareBtn.addEventListener('click', async () => {
        const label = shareBtn.querySelector('.relatorios-share-label');
        const originalText = label ? label.textContent.trim() : shareBtn.textContent.trim();
        try {
            await navigator.clipboard.writeText(window.location.href);
            if (label) {
                label.textContent = 'Link copiado!';
            } else {
                shareBtn.textContent = 'Link copiado!';
            }
            shareBtn.classList.add('btn-success');
            setTimeout(() => {
                if (label) {
                    label.textContent = originalText;
                } else {
                    shareBtn.textContent = originalText;
                }
                shareBtn.classList.remove('btn-success');
            }, 2000);
        } catch (error) {
            console.error('Falha ao copiar link de compartilhamento', error);
        }
    });
}

function applyEntranceAnimations(root) {
    const animatedElements = Array.from(root.querySelectorAll('.animate-fade-in-up'));
    animatedElements.forEach((element, index) => {
        element.style.animationDelay = `${index * 80}ms`;
    });
}

function animateResultView(view) {
    if (!view) return;
    view.style.animation = 'none';
    view.style.opacity = '0';
    view.style.transform = 'translateY(24px)';
    void view.offsetWidth;
    view.style.animation = 'relatoriosFloatIn 0.6s ease-out forwards';
}

function loadScriptOnce(src) {
    const registry = window.__moduleScriptPromises = window.__moduleScriptPromises || new Map();
    if (registry.has(src)) {
        return registry.get(src);
    }

    const promise = new Promise((resolve, reject) => {
        const existing = Array.from(document.querySelectorAll('script')).find(script => {
            const current = script.getAttribute('src') || '';
            if (!current) return false;
            if (current === src) return true;
            return current.endsWith(src.replace('../', '')) || current.includes(src.replace('../', ''));
        });

        if (existing) {
            if (existing.dataset.loaded === 'true' || existing.readyState === 'complete') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => {
                existing.dataset.loaded = 'true';
                resolve();
            }, { once: true });
            existing.addEventListener('error', reject, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => {
            script.remove();
            reject(new Error(`Falha ao carregar script: ${src}`));
        };
        document.head.appendChild(script);
    });

    promise.catch(() => registry.delete(src));
    registry.set(src, promise);
    return promise;
}

async function setupGeoFilters(root) {
    if (!root) return;
    try {
        await loadScriptOnce('../js/utils/geo-multiselect.js');
        if (window.GeoMultiSelect?.initInContainer) {
            window.GeoMultiSelect.initInContainer(root, {
                module: 'relatorios',
                onChange: detail => {
                    document.dispatchEvent(new CustomEvent('relatorios:geo-filter-change', {
                        detail
                    }));
                }
            });
        }
    } catch (error) {
        console.error('Falha ao carregar seleção geográfica', error);
    }
}

function setupDateRangeFilters(root) {
    if (!root || !window.DateRangeFilter?.initDateRangeFilter) return;

    const configs = [
        { selector: '#relatoriosOrcamentosPeriod', storageKey: 'relatorios-orcamentos' },
        { selector: '#relatoriosPedidosPeriod', storageKey: 'relatorios-pedidos' }
    ];

    window.__relatoriosDateRanges = window.__relatoriosDateRanges || {};

    configs.forEach(({ selector, storageKey }) => {
        const select = root.querySelector(selector);
        if (!select) return;
        if (select.dataset.dateRangeInitialized === 'true') return;
        const controller = window.DateRangeFilter.initDateRangeFilter({
            selectElement: select,
            moduleKey: storageKey,
            getRange: () => window.__relatoriosDateRanges[storageKey] || null,
            setRange: range => {
                window.__relatoriosDateRanges[storageKey] = range;
            },
            onApply: () => {
                document.dispatchEvent(new CustomEvent('relatorios:periodo-personalizado', {
                    detail: {
                        key: storageKey,
                        range: window.__relatoriosDateRanges[storageKey] || null
                    }
                }));
            }
        });
        if (controller) {
            select.dataset.dateRangeInitialized = 'true';
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRelatoriosModule);
} else {
    initRelatoriosModule();
}
