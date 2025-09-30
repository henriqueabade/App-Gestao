// Lógica de interação do menu principal

// Elementos da página
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('mainContent');
const menuToggle = document.getElementById('menuToggle');
const crmToggle = document.getElementById('crmToggle');
const crmSubmenu = document.getElementById('crmSubmenu');
const chevron = crmToggle.querySelector('.chevron');
const companyName = document.getElementById('companyName');

const AppUpdates = (() => {
    const STATE_KEY = 'menu.app-update-state';
    const elements = {
        container: document.getElementById('appUpdateContainer'),
        badge: document.getElementById('appUpdateBadge'),
        badgeTitle: document.getElementById('appUpdateBadgeTitle'),
        badgeSubtitle: document.getElementById('appUpdateBadgeSubtitle'),
        progress: document.getElementById('appUpdateProgress'),
        progressBar: document.getElementById('appUpdateProgressBar'),
        publishBtn: document.getElementById('publishUpdateBtn'),
        publishLabel: document.getElementById('publishUpdateLabel')
    };

    const state = {
        updateStatus: null,
        publishState: null,
        user: null,
        localVersion: null,
        latestPublishedVersion: null,
        availableVersion: null,
        lastStatus: null
    };

    let publishStartToastShown = false;
    let eventsAttached = false;

    const STATUS_WITH_BADGE = new Set([
        'update-available',
        'downloading',
        'downloaded',
        'installing',
        'error'
    ]);

    function setElementHidden(el, hidden) {
        if (!el) return;
        if (hidden) {
            el.classList.add('hidden');
        } else {
            el.classList.remove('hidden');
        }
    }

    function clampPercent(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) return 0;
        return Math.max(0, Math.min(100, Math.round(value)));
    }

    function persistState() {
        if (typeof sessionStorage === 'undefined') return;
        try {
            const payload = {
                updateStatus: state.updateStatus,
                publishState: state.publishState,
                localVersion: state.localVersion,
                latestPublishedVersion: state.latestPublishedVersion,
                availableVersion: state.availableVersion,
                lastStatus: state.lastStatus
            };
            sessionStorage.setItem(STATE_KEY, JSON.stringify(payload));
        } catch (err) {
            /* ignore storage errors */
        }
    }

    function restoreState() {
        if (typeof sessionStorage === 'undefined') return {};
        try {
            const stored = sessionStorage.getItem(STATE_KEY);
            if (!stored) return {};
            const parsed = JSON.parse(stored);
            if (parsed && typeof parsed === 'object') {
                if (parsed.localVersion) state.localVersion = parsed.localVersion;
                if (parsed.latestPublishedVersion) state.latestPublishedVersion = parsed.latestPublishedVersion;
                if (parsed.availableVersion) state.availableVersion = parsed.availableVersion;
                if (parsed.lastStatus) state.lastStatus = parsed.lastStatus;
                return {
                    updateStatus: parsed.updateStatus,
                    publishState: parsed.publishState
                };
            }
        } catch (err) {
            /* ignore restore errors */
        }
        return {};
    }

    function updateProgress(percent) {
        if (!elements.progress || !elements.progressBar) return;
        const safe = clampPercent(percent);
        elements.progress.setAttribute('aria-valuenow', String(safe));
        elements.progressBar.style.width = `${safe}%`;
    }

    function buildTooltip({ localVersion, availableVersion, latestPublishedVersion }) {
        const parts = [];
        if (localVersion) parts.push(`Versão local: ${localVersion}`);
        if (availableVersion) parts.push(`Disponível: ${availableVersion}`);
        if (
            latestPublishedVersion &&
            latestPublishedVersion !== availableVersion &&
            latestPublishedVersion !== localVersion
        ) {
            parts.push(`Última publicada: ${latestPublishedVersion}`);
        }
        return parts.join('\n');
    }

    function updateContainerVisibility() {
        if (!elements.container) return;
        const badgeVisible = elements.badge && !elements.badge.classList.contains('hidden');
        const buttonVisible = elements.publishBtn && !elements.publishBtn.classList.contains('hidden');
        setElementHidden(elements.container, !(badgeVisible || buttonVisible));
    }

    function setBadgeVariant(variant) {
        if (!elements.badge) return;
        if (variant) {
            elements.badge.setAttribute('data-variant', variant);
        } else {
            elements.badge.removeAttribute('data-variant');
        }
    }

    function updateBadge() {
        if (!elements.badge) return;
        const status = state.updateStatus;
        if (!status || !STATUS_WITH_BADGE.has(status.status)) {
            setElementHidden(elements.badge, true);
            if (elements.progress) {
                updateProgress(0);
                setElementHidden(elements.progress, true);
                elements.progress.setAttribute('aria-hidden', 'true');
            }
            updateContainerVisibility();
            return;
        }

        let title = status.statusMessage || '';
        let subtitle = '';
        let variant = 'info';
        const percent = status.downloadProgress?.percent;
        const tooltip = buildTooltip({
            localVersion: state.localVersion,
            availableVersion: state.availableVersion || status.latestVersion,
            latestPublishedVersion: state.latestPublishedVersion || status.latestPublishedVersion
        });

        switch (status.status) {
            case 'update-available':
                variant = 'info';
                title = state.availableVersion
                    ? `Atualização v${state.availableVersion}`
                    : 'Atualização disponível';
                subtitle = status.statusMessage || 'Nova atualização detectada.';
                if (elements.progress) {
                    setElementHidden(elements.progress, true);
                    elements.progress.setAttribute('aria-hidden', 'true');
                }
                break;
            case 'downloading':
                variant = 'progress';
                title = 'Baixando atualização...';
                subtitle = typeof percent === 'number'
                    ? `${clampPercent(percent)}% concluído`
                    : status.statusMessage || 'Transferindo arquivos.';
                if (elements.progress) {
                    setElementHidden(elements.progress, false);
                    updateProgress(percent ?? 0);
                    elements.progress.setAttribute('aria-hidden', 'false');
                }
                break;
            case 'downloaded':
                variant = 'success';
                title = 'Atualização baixada';
                subtitle = status.statusMessage || 'Pronta para instalação.';
                if (elements.progress) {
                    updateProgress(100);
                    setElementHidden(elements.progress, true);
                    elements.progress.setAttribute('aria-hidden', 'true');
                }
                break;
            case 'installing':
                variant = 'progress';
                title = 'Instalando atualização';
                subtitle = status.statusMessage || 'O aplicativo será reiniciado.';
                if (elements.progress) {
                    setElementHidden(elements.progress, true);
                    elements.progress.setAttribute('aria-hidden', 'true');
                }
                break;
            case 'error':
                variant = 'error';
                title = 'Erro na atualização';
                subtitle = status.statusMessage || status.error?.friendlyMessage || 'Tente novamente mais tarde.';
                if (elements.progress) {
                    setElementHidden(elements.progress, true);
                    elements.progress.setAttribute('aria-hidden', 'true');
                }
                break;
            default:
                setElementHidden(elements.badge, true);
                if (elements.progress) {
                    setElementHidden(elements.progress, true);
                    elements.progress.setAttribute('aria-hidden', 'true');
                }
                updateContainerVisibility();
                return;
        }

        if (elements.badgeTitle) elements.badgeTitle.textContent = title;
        if (elements.badgeSubtitle) elements.badgeSubtitle.textContent = subtitle;
        setBadgeVariant(variant);

        if (tooltip) {
            elements.badge.setAttribute('data-tooltip', tooltip);
            elements.badge.setAttribute('aria-label', tooltip.replace(/\n/g, ' • '));
        } else {
            elements.badge.removeAttribute('data-tooltip');
            elements.badge.removeAttribute('aria-label');
        }

        setElementHidden(elements.badge, false);
        updateContainerVisibility();
    }

    function updatePublishButton() {
        const btn = elements.publishBtn;
        const label = elements.publishLabel;
        if (!btn || !label) {
            updateContainerVisibility();
            return;
        }

        const publishState = state.publishState || {};
        const updateStatus = state.updateStatus || {};
        const profile = state.user || {};
        const isSupAdmin = profile?.perfil === 'Sup Admin';
        const publishing = Boolean(publishState.publishing);

        const localVersion = publishState.localVersion || updateStatus.localVersion || state.localVersion;
        const latestPublishedVersion = publishState.latestPublishedVersion || updateStatus.latestPublishedVersion || state.latestPublishedVersion;
        const availableVersion = updateStatus.latestVersion || publishState.availableVersion || state.availableVersion;

        if (localVersion) state.localVersion = localVersion;
        if (latestPublishedVersion) state.latestPublishedVersion = latestPublishedVersion;
        if (availableVersion) state.availableVersion = availableVersion;

        const fallbackCanPublish = Boolean(
            availableVersion &&
            (!latestPublishedVersion || availableVersion !== latestPublishedVersion)
        );

        const canPublish = publishing || Boolean(
            publishState.canPublish ??
            updateStatus.canPublish ??
            fallbackCanPublish
        );

        const shouldShow = isSupAdmin && (canPublish || publishing);
        setElementHidden(btn, !shouldShow);

        if (!shouldShow) {
            btn.disabled = false;
            btn.classList.remove('is-loading');
            updateContainerVisibility();
            return;
        }

        if (publishing) {
            btn.disabled = true;
            btn.classList.add('is-loading');
            label.textContent = publishState.message || 'Publicando...';
            btn.title = 'Publicação em andamento';
        } else {
            btn.disabled = false;
            btn.classList.remove('is-loading');
            if (localVersion && latestPublishedVersion) {
                label.textContent = `${localVersion} → ${latestPublishedVersion}`;
            } else if (localVersion && availableVersion) {
                label.textContent = `${localVersion} → ${availableVersion}`;
            } else if (availableVersion) {
                label.textContent = `Publicar v${availableVersion}`;
            } else {
                label.textContent = 'Publicar atualização';
            }
            btn.title = 'Publicar atualização para os clientes';
        }

        updateContainerVisibility();
    }

    function handleUpdateToasts(previousState, current) {
        if (!current || !window.showToast) return;
        const status = current.status;
        if (!status) return;
        const previousStatus = previousState?.status;

        if (status === 'error') {
            const previousMessage = previousStatus === 'error' ? previousState?.statusMessage : null;
            if (!previousState || status !== previousStatus || current.statusMessage !== previousMessage) {
                window.showToast(current.statusMessage || 'Falha ao aplicar atualização.', 'error');
            }
            return;
        }

        if (status === previousStatus) return;

        switch (status) {
            case 'update-available':
                window.showToast(
                    current.latestVersion
                        ? `Atualização ${current.latestVersion} disponível para download.`
                        : 'Nova atualização disponível.',
                    'info'
                );
                break;
            case 'downloading':
                window.showToast('Baixando atualização...', 'info');
                break;
            case 'downloaded':
                window.showToast('Atualização baixada. Reinicie para concluir.', 'success');
                break;
            case 'installing':
                window.showToast('Reiniciando para finalizar a atualização.', 'info');
                break;
            default:
                break;
        }
    }

    function setUserProfile(user) {
        state.user = user || {};
        updatePublishButton();
        persistState();
    }

    function setUpdateStatus(newStatus, options = {}) {
        const previousState = state.updateStatus ? { ...state.updateStatus } : null;
        state.updateStatus = newStatus ? { ...newStatus } : null;
        if (newStatus?.localVersion) state.localVersion = newStatus.localVersion;
        if (newStatus?.latestPublishedVersion) state.latestPublishedVersion = newStatus.latestPublishedVersion;
        if (newStatus?.latestVersion) state.availableVersion = newStatus.latestVersion;
        if (newStatus?.canPublish !== undefined) {
            state.publishState = { ...(state.publishState || {}), canPublish: newStatus.canPublish };
        }

        updateBadge();
        updatePublishButton();
        if (!options.silent) {
            handleUpdateToasts(previousState, newStatus);
        }
        state.lastStatus = newStatus?.status || null;
        persistState();
    }

    function setPublishState(newState, options = {}) {
        if (!newState) return;
        state.publishState = { ...(state.publishState || {}), ...newState };
        if (newState.latestPublishedVersion) state.latestPublishedVersion = newState.latestPublishedVersion;
        if (newState.localVersion) state.localVersion = newState.localVersion;
        if (newState.availableVersion) state.availableVersion = newState.availableVersion;
        updatePublishButton();
        if (!options.silent && newState.message && window.showToast) {
            const type = newState.publishing === false ? 'success' : 'info';
            window.showToast(newState.message, type);
        }
        persistState();
    }

    function handlePublishError(payload) {
        publishStartToastShown = false;
        state.publishState = { ...(state.publishState || {}), publishing: false };
        updatePublishButton();
        persistState();
        if (payload?.message && window.showToast) {
            window.showToast(payload.message, 'error');
        }
    }

    async function triggerPublish() {
        if (!window.electronAPI?.publishUpdate) return;
        const btn = elements.publishBtn;
        if (btn) {
            btn.disabled = true;
            btn.classList.add('is-loading');
        }
        try {
            const result = await window.electronAPI.publishUpdate();
            if (result?.success) {
                setPublishState(result, { silent: true });
            } else {
                if (result) setPublishState(result, { silent: true });
                if (window.showToast) {
                    const message = result?.message || result?.error || 'Não foi possível iniciar a publicação.';
                    if (message) {
                        const type = result?.code === 'in-progress' ? 'info' : 'error';
                        window.showToast(message, type);
                    }
                }
            }
        } catch (err) {
            if (window.showToast) {
                window.showToast(err?.message || 'Não foi possível iniciar a publicação.', 'error');
            }
        } finally {
            updatePublishButton();
            persistState();
        }
    }

    function attachEvents() {
        if (eventsAttached) return;

        if (elements.publishBtn) {
            elements.publishBtn.addEventListener('click', triggerPublish);
        }

        if (window.electronAPI?.onUpdateStatus) {
            window.electronAPI.onUpdateStatus(payload => {
                setUpdateStatus(payload, { silent: false });
            });
        }

        if (window.electronAPI?.onPublishStatus) {
            window.electronAPI.onPublishStatus(payload => {
                setPublishState(payload, { silent: true });
                if (payload?.publishing) {
                    if (!publishStartToastShown && window.showToast) {
                        window.showToast(payload.message || 'Publicação iniciada.', 'info');
                        publishStartToastShown = true;
                    }
                } else if (payload?.publishing === false) {
                    publishStartToastShown = false;
                    if (window.showToast) {
                        window.showToast(payload.message || 'Publicação concluída.', 'success');
                    }
                }
            });
        }

        if (window.electronAPI?.onPublishError) {
            window.electronAPI.onPublishError(payload => {
                handlePublishError(payload);
            });
        }

        eventsAttached = true;
    }

    function init() {
        const restored = restoreState();
        if (restored.updateStatus) {
            setUpdateStatus(restored.updateStatus, { silent: true });
        } else {
            updateBadge();
        }
        if (restored.publishState) {
            setPublishState(restored.publishState, { silent: true });
        } else {
            updatePublishButton();
        }
        updateContainerVisibility();
        attachEvents();
    }

    return {
        init,
        setUserProfile,
        setUpdateStatus,
        setPublishState
    };
})();

window.AppUpdates = window.AppUpdates || AppUpdates;
AppUpdates.init();

// Carrega páginas modulares dentro da div#content
// Remove estilos e scripts antigos e executa o novo script em escopo isolado
async function loadPage(page) {
    const content = document.getElementById('content');
    if (!content) return;

    try {
        const resp = await fetch(`../html/${page}.html`);
        const rawHtml = await resp.text();

        const parser = new DOMParser();
        const parsed = parser.parseFromString(rawHtml, 'text/html');
        const parsedModule = parsed.querySelector('.modulo-container');

        let module;
        if (parsedModule) {
            const importedModule = document.importNode(parsedModule, true);
            content.innerHTML = '';
            content.appendChild(importedModule);
            module = content.querySelector('.modulo-container');
        } else {
            content.innerHTML = rawHtml;
            module = content.querySelector('.modulo-container');
        }

        if (module) {
            module.classList.add('module-enter');
            module.addEventListener('animationend', () => {
                module.classList.remove('module-enter');
            }, { once: true });
        }
        document.dispatchEvent(new Event('module-change'));

        document.getElementById('page-style')?.remove();
        document.getElementById('page-script')?.remove();

        const style = document.createElement('link');
        style.id = 'page-style';
        style.rel = 'stylesheet';
        style.href = `../css/${page}.css`;
        document.head.appendChild(style);

        const script = document.createElement('script');
        script.id = 'page-script';
        const jsResp = await fetch(`../js/${page}.js`);
        const jsText = await jsResp.text();
        script.textContent = `(function(){\n${jsText}\n})();`;
        document.body.appendChild(script);
        document.dispatchEvent(new Event('module-change'));
    } catch (err) {
        console.error('Erro ao carregar página', page, err);
    }
}
window.loadPage = loadPage;

let sidebarExpanded = false;
let crmExpanded = false;

// Expande a sidebar quando necessário
function expandSidebar() {
    if (!sidebarExpanded) {
        sidebar.classList.remove('sidebar-collapsed');
        sidebar.classList.add('sidebar-expanded');
        const offset = window.innerWidth >= 1024 ? '240px' : '200px';
        mainContent.style.marginLeft = offset;
        if (companyName) companyName.classList.remove('collapsed');

        // Aguarda a animação de expansão finalizar para exibir o texto
        const showText = () => sidebar.classList.add('sidebar-text-visible');
        sidebar.addEventListener('transitionend', (e) => {
            if (e.propertyName === 'width') {
                showText();
            }
        }, { once: true });
        // Fallback caso o evento transitionend não seja disparado
        setTimeout(showText, 300);

        sidebarExpanded = true;
    }
}

function collapseSidebar() {
    if (sidebarExpanded) {
        sidebar.classList.remove('sidebar-text-visible');
        sidebar.classList.remove('sidebar-expanded');
        sidebar.classList.add('sidebar-collapsed');
        mainContent.style.marginLeft = '64px';
        if (companyName) companyName.classList.add('collapsed');
        sidebarExpanded = false;
    }
    // Submenu CRM permanece aberto; fechamento apenas via clique
}

// Alterna a sidebar através do botão de menu
menuToggle?.addEventListener('click', () => {
    if (sidebarExpanded) {
        collapseSidebar();
    } else {
        expandSidebar();
    }
});

// Recolhe a sidebar apenas quando o usuário entra no conteúdo principal
mainContent?.addEventListener('mouseenter', collapseSidebar);
mainContent?.addEventListener('click', collapseSidebar);

// Mostra ou esconde submenu do CRM
function toggleCrmSubmenu() {
    crmExpanded = !crmExpanded;
    if (crmExpanded) {
        crmSubmenu.classList.add('open');
        chevron.classList.add('rotated');
        // CRM submenu should not trigger sidebar expansion
    } else {
        crmSubmenu.classList.remove('open');
        chevron.classList.remove('rotated');
        // Submenu fecha apenas em ações explícitas
    }
}
crmToggle.addEventListener('click', toggleCrmSubmenu);

// Navegação interna
document.querySelectorAll('.sidebar-item[data-page], .submenu-item[data-page]').forEach(item => {
    item.addEventListener('click', function (e) {
        e.stopPropagation();
        // Remove destaque de todos os itens antes de aplicar ao clicado

        document.querySelectorAll('.sidebar-item, .submenu-item').forEach(i => i.classList.remove('active'));
        // Marca item clicado como ativo para aplicar o estilo de destaque

        this.classList.add('active');

        // Fecha submenu do CRM ao navegar para outros módulos
        const insideCrm = this.closest('#crmSubmenu');
        if (!insideCrm && crmExpanded) {
            crmSubmenu.classList.remove('open');
            chevron.classList.remove('rotated');
            crmExpanded = false;
        }
        // Mantém submenu aberto se o clique for em um item do CRM
        if (insideCrm && !crmExpanded) {
            crmSubmenu.classList.add('open');
            chevron.classList.add('rotated');
            crmExpanded = true;
        }

        const page = this.dataset.page;
        if (page === 'dashboard') {
            window.location.reload();
        } else if (page) {
            loadPage(page);
        }
        collapseSidebar();
    });
});

// Animação inicial dos cards
window.addEventListener('load', () => {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
});

// Ajustes responsivos ao redimensionar
window.addEventListener('resize', () => {
    if (sidebarExpanded) {
        mainContent.style.marginLeft = window.innerWidth >= 1024 ? '240px' : '200px';
    }
});
