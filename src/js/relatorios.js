// Lógica de interação para o módulo de Relatórios
function initRelatoriosModule() {
    const container = document.querySelector('.relatorios-module');
    if (!container) return;

    // Garante que o body esteja liberado caso algum modal anterior tenha alterado o overflow
    document.body.style.overflow = '';

    setupCategoryTabs(container);
    setupResultTabs(container);
    setupDropdowns(container);
    setupModals(container);
    setupShare(container);
}

function setupCategoryTabs(root) {
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
        });
    });
}

function setupResultTabs(root) {
    const tabButtons = Array.from(root.querySelectorAll('[data-relatorios-result]'));
    if (!tabButtons.length) return;

    const views = {
        table: root.querySelector('#relatoriosTableView'),
        charts: root.querySelector('#relatoriosChartsView'),
        detail: root.querySelector('#relatoriosDetailView')
    };

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

            Object.entries(views).forEach(([key, view]) => {
                if (!view) return;
                view.classList.toggle('hidden', key !== target);
            });
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRelatoriosModule);
} else {
    initRelatoriosModule();
}
