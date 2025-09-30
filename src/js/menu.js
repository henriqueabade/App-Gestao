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
        checkBtn: document.getElementById('checkUpdatesBtn'),
        checkIcon: document.getElementById('checkUpdatesIcon'),
        checkLabel: document.getElementById('checkUpdatesLabel'),
        publishBtn: document.getElementById('publishUpdateBtn'),
        publishLabel: document.getElementById('publishUpdateLabel'),
        supAdmin: {
            container: document.getElementById('supAdminUpdateControl'),
            trigger: document.getElementById('supAdminUpdatesTrigger'),
            icon: document.getElementById('supAdminUpdatesIcon'),
            label: document.getElementById('supAdminUpdatesLabel'),
            panel: document.getElementById('supAdminUpdatesPanel'),
            publish: document.getElementById('supAdminPublishAction'),
            publishIcon: document.getElementById('supAdminPublishIcon'),
            publishLabel: document.getElementById('supAdminPublishLabel')
        }
    };

    const state = {
        updateStatus: null,
        publishState: null,
        user: null,
        localVersion: null,
        latestPublishedVersion: null,
        availableVersion: null,
        lastStatus: null,
        actionBusy: false,
        autoCheckInterval: null,
        autoCheckPending: false,
        supAdmin: {
            mode: 'idle',
            panelOpen: false,
            lastError: null,
            successTimer: null
        }
    };

    let publishStartToastShown = false;
    let eventsAttached = false;

    const STATUS_WITH_BADGE = new Set([
        'checking',
        'update-available',
        'downloading',
        'downloaded',
        'installing',
        'up-to-date',
        'disabled',
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
        const checkVisible = elements.checkBtn && !elements.checkBtn.classList.contains('hidden');
        const supAdminVisible = Boolean(
            elements.supAdmin?.container &&
            !elements.supAdmin.container.classList.contains('hidden')
        );
        setElementHidden(elements.container, !(badgeVisible || buttonVisible || checkVisible || supAdminVisible));
    }

    function clearSupAdminSuccessTimer() {
        if (state.supAdmin.successTimer) {
            clearTimeout(state.supAdmin.successTimer);
            state.supAdmin.successTimer = null;
        }
    }

    function computePublishAvailability() {
        const publishState = state.publishState || {};
        const updateStatus = state.updateStatus || {};
        const explicit = publishState.canPublish ?? updateStatus.canPublish;
        if (typeof explicit === 'boolean') {
            return explicit;
        }

        const status = updateStatus.status;
        if (status === 'update-available' || status === 'downloading' || status === 'downloaded') {
            return true;
        }

        const availableVersion = publishState.availableVersion || updateStatus.latestVersion || state.availableVersion;
        const latestPublishedVersion = publishState.latestPublishedVersion || updateStatus.latestPublishedVersion || state.latestPublishedVersion;
        const localVersion = publishState.localVersion || updateStatus.localVersion || state.localVersion;

        if (availableVersion && latestPublishedVersion) {
            return availableVersion !== latestPublishedVersion;
        }
        if (availableVersion && localVersion) {
            return availableVersion !== localVersion;
        }
        return false;
    }

    function setSupAdminIcon(mode) {
        const icon = elements.supAdmin?.icon;
        if (!icon) return;
        icon.classList.add('sup-admin-updates-icon');
        icon.classList.remove('fa-cloud-upload-alt', 'fa-wifi', 'fa-check', 'fa-xmark');
        let iconName = 'fa-cloud-upload-alt';
        switch (mode) {
            case 'publishing':
                iconName = 'fa-wifi';
                break;
            case 'success':
                iconName = 'fa-check';
                break;
            case 'error':
                iconName = 'fa-xmark';
                break;
            default:
                iconName = 'fa-cloud-upload-alt';
                break;
        }
        icon.classList.add(iconName);
    }

    function buildSupAdminPublishLabel() {
        const publishState = state.publishState || {};
        const updateStatus = state.updateStatus || {};
        const availableVersion = publishState.availableVersion || updateStatus.latestVersion || state.availableVersion;
        const latestPublishedVersion = publishState.latestPublishedVersion || updateStatus.latestPublishedVersion || state.latestPublishedVersion;
        const localVersion = publishState.localVersion || updateStatus.localVersion || state.localVersion;

        if (availableVersion && latestPublishedVersion && availableVersion !== latestPublishedVersion) {
            return `Publicar v${availableVersion}`;
        }
        if (availableVersion && localVersion && availableVersion !== localVersion) {
            return `Publicar v${availableVersion}`;
        }
        if (availableVersion) {
            return `Publicar v${availableVersion}`;
        }
        return 'Publicar atualização';
    }

    function applySupAdminState() {
        const sup = elements.supAdmin;
        if (!sup?.container || !sup.trigger || !sup.icon || !sup.label) {
            updateContainerVisibility();
            return;
        }

        const profile = state.user || {};
        const isSupAdmin = profile?.perfil === 'Sup Admin';
        sup.container.classList.toggle('hidden', !isSupAdmin);

        if (!isSupAdmin) {
            state.supAdmin.panelOpen = false;
            clearSupAdminSuccessTimer();
            updateContainerVisibility();
            return;
        }

        const hasPending = computePublishAvailability();
        let mode = state.supAdmin.mode || 'idle';

        if (mode === 'idle' && hasPending) {
            mode = 'available';
            state.supAdmin.mode = mode;
        }
        if (mode === 'available' && !hasPending) {
            mode = 'idle';
            state.supAdmin.mode = mode;
            state.supAdmin.panelOpen = false;
        }
        if (mode === 'error' && !hasPending) {
            mode = 'idle';
            state.supAdmin.mode = mode;
        }
        setSupAdminIcon(mode);

        sup.trigger.setAttribute('data-state', mode);
        sup.trigger.dataset.state = mode;
        const isPublishing = mode === 'publishing';
        sup.trigger.disabled = isPublishing;
        sup.trigger.setAttribute('aria-expanded', state.supAdmin.panelOpen && mode === 'available' ? 'true' : 'false');

        sup.label.textContent = 'Atualizações';

        if (sup.panel) {
            const showPanel = state.supAdmin.panelOpen && mode === 'available';
            sup.panel.classList.toggle('hidden', !showPanel);
            sup.panel.setAttribute('aria-hidden', showPanel ? 'false' : 'true');
        }

        if (sup.publish) {
            sup.publish.disabled = mode !== 'available';
            if (sup.publishLabel) {
                sup.publishLabel.textContent = buildSupAdminPublishLabel();
            }
        }

        updateContainerVisibility();
    }

    function setSupAdminMode(mode, options = {}) {
        const validModes = new Set(['idle', 'available', 'publishing', 'success', 'error']);
        const nextMode = validModes.has(mode) ? mode : 'idle';
        state.supAdmin.mode = nextMode;
        if (options.panelOpen !== undefined) {
            state.supAdmin.panelOpen = Boolean(options.panelOpen);
        }
        if (options.lastError !== undefined) {
            state.supAdmin.lastError = options.lastError;
        } else if (nextMode !== 'error') {
            state.supAdmin.lastError = null;
        }

        if (nextMode === 'success') {
            clearSupAdminSuccessTimer();
            state.supAdmin.successTimer = setTimeout(() => {
                state.supAdmin.successTimer = null;
                if (state.supAdmin.mode === 'success') {
                    const hasPending = computePublishAvailability();
                    setSupAdminMode(hasPending ? 'available' : 'idle', { panelOpen: false });
                }
            }, 2200);
        } else {
            clearSupAdminSuccessTimer();
        }

        applySupAdminState();
    }

    async function runAutomaticCheck({ silent = true } = {}) {
        if (!window.electronAPI?.getUpdateStatus) return null;
        if (state.autoCheckPending) return null;
        state.autoCheckPending = true;
        try {
            const result = await window.electronAPI.getUpdateStatus({ refresh: true });
            if (result && typeof result === 'object') {
                setUpdateStatus(result, { silent });
                if (result.publishState) {
                    setPublishState(result.publishState, { silent: true });
                }
            }
            return result;
        } catch (err) {
            if (!silent && window.showToast) {
                window.showToast(err?.message || 'Não foi possível verificar atualizações.', 'error');
            }
            return null;
        } finally {
            state.autoCheckPending = false;
        }
    }

    function ensureAutoCheckTimer() {
        if (state.autoCheckInterval || !window.electronAPI?.getUpdateStatus) return;
        const intervalMs = 30 * 60 * 1000;
        state.autoCheckInterval = setInterval(() => {
            runAutomaticCheck({ silent: true });
        }, intervalMs);
    }

    function stopAutoCheckTimer() {
        if (state.autoCheckInterval) {
            clearInterval(state.autoCheckInterval);
            state.autoCheckInterval = null;
        }
    }

    async function handleSupAdminTriggerClick() {
        if (state.supAdmin.mode === 'publishing') return;
        await runAutomaticCheck({ silent: true });
        const hasPending = computePublishAvailability();
        if (!hasPending) {
            setSupAdminMode('idle', { panelOpen: false });
            const message = 'Não há atualizações para publicar. Todas já foram publicadas.';
            if (window.showToast) {
                window.showToast(message, 'success');
            } else if (typeof window.alert === 'function') {
                window.alert(message);
            }
            return;
        }

        const nextOpen = !state.supAdmin.panelOpen;
        setSupAdminMode('available', { panelOpen: nextOpen });
    }

    async function handleSupAdminPublish() {
        if (!window.electronAPI?.publishUpdate) return;
        if (state.supAdmin.mode === 'publishing') return;

        setSupAdminMode('publishing', { panelOpen: false });
        try {
            const result = await window.electronAPI.publishUpdate();
            if (result?.success) {
                setPublishState(result, { silent: true });
                setSupAdminMode('success', { panelOpen: false });
                if (window.showToast) {
                    window.showToast('Atualização publicada com sucesso!', 'success');
                }
                await runAutomaticCheck({ silent: true });
            } else {
                const message = result?.message || result?.error || 'Falha ao publicar atualização.';
                if (result?.code === 'in-progress') {
                    if (window.showToast) {
                        window.showToast(message || 'Uma publicação já está em andamento.', 'info');
                    }
                    setSupAdminMode('publishing', { panelOpen: false });
                } else if (result?.code) {
                    setSupAdminMode('error', { panelOpen: false, lastError: message });
                    if (typeof window.alert === 'function') {
                        window.alert(message);
                    } else if (window.showToast) {
                        window.showToast(message, 'error');
                    }
                    setSupAdminMode('available', { panelOpen: false });
                }
            }
        } catch (err) {
            const message = err?.message || 'Falha ao publicar atualização.';
            setSupAdminMode('error', { panelOpen: false, lastError: message });
            if (typeof window.alert === 'function') {
                window.alert(message);
            } else if (window.showToast) {
                window.showToast(message, 'error');
            }
            setSupAdminMode('available', { panelOpen: false });
        }
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
            case 'checking':
                variant = 'progress';
                title = 'Verificando atualizações...';
                subtitle = status.statusMessage || 'Aguarde enquanto buscamos novas versões.';
                if (elements.progress) {
                    setElementHidden(elements.progress, true);
                    elements.progress.setAttribute('aria-hidden', 'true');
                }
                break;
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
            case 'up-to-date':
                variant = 'success';
                title = 'Aplicativo atualizado';
                subtitle = status.statusMessage || 'Você já está na última versão.';
                if (elements.progress) {
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
            case 'disabled':
                variant = 'muted';
                title = 'Atualizações indisponíveis';
                subtitle = status.statusMessage || 'Procure o administrador para habilitar as atualizações.';
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

        const tooltipMessage = [subtitle, tooltip].filter(Boolean).join('\n\n');
        const ariaLabelParts = [title, subtitle, tooltip].filter(Boolean);

        if (tooltipMessage) {
            elements.badge.setAttribute('data-tooltip', tooltipMessage);
        } else {
            elements.badge.removeAttribute('data-tooltip');
        }

        if (ariaLabelParts.length) {
            elements.badge.setAttribute('aria-label', ariaLabelParts.join(' • '));
        } else {
            elements.badge.removeAttribute('aria-label');
        }

        setElementHidden(elements.badge, false);
        updateContainerVisibility();
    }

    function updateCheckButton() {
        const btn = elements.checkBtn;
        const label = elements.checkLabel;
        const icon = elements.checkIcon;
        if (!btn || !label || !icon) {
            updateContainerVisibility();
            return;
        }

        const hasApi = Boolean(
            window.electronAPI?.checkForUpdates ||
            window.electronAPI?.downloadUpdate ||
            window.electronAPI?.installUpdate
        );

        if (!hasApi) {
            setElementHidden(btn, true);
            updateContainerVisibility();
            return;
        }

        setElementHidden(btn, false);

        const status = state.updateStatus || {};
        let action = 'check';
        let text = 'Checar atualização';
        let iconName = 'fa-arrows-rotate';
        let spin = false;
        let disabled = false;
        let title = '';

        const applyIcon = () => {
            const classes = ['fas', iconName, 'app-update-check-icon'];
            if (spin) classes.push('fa-spin');
            icon.className = classes.join(' ');
        };

        if (state.actionBusy) {
            spin = true;
            disabled = true;
            iconName = 'fa-circle-notch';
            text = status.statusMessage || 'Processando atualização...';
        } else if (status.status) {
            switch (status.status) {
                case 'checking':
                    spin = true;
                    disabled = true;
                    iconName = 'fa-circle-notch';
                    text = status.statusMessage || 'Verificando...';
                    break;
                case 'update-available': {
                    const canDownload = Boolean(window.electronAPI?.downloadUpdate);
                    action = canDownload ? 'download' : 'check';
                    iconName = canDownload ? 'fa-cloud-download-alt' : 'fa-arrows-rotate';
                    const versionLabel = state.availableVersion || status.latestVersion;
                    text = canDownload
                        ? (versionLabel ? `Baixar v${versionLabel}` : 'Baixar atualização')
                        : 'Checar atualização';
                    disabled = !canDownload && !window.electronAPI?.checkForUpdates;
                    title = status.statusMessage || '';
                    break;
                }
                case 'downloading': {
                    spin = true;
                    disabled = true;
                    iconName = 'fa-circle-notch';
                    const rawPercent = status.downloadProgress?.percent;
                    if (typeof rawPercent === 'number' && !Number.isNaN(rawPercent)) {
                        const percent = clampPercent(rawPercent);
                        text = `Baixando (${percent}%)`;
                    } else {
                        text = 'Baixando...';
                    }
                    title = status.statusMessage || '';
                    break;
                }
                case 'downloaded': {
                    const canInstall = Boolean(window.electronAPI?.installUpdate);
                    action = canInstall ? 'install' : (window.electronAPI?.checkForUpdates ? 'check' : 'none');
                    iconName = canInstall ? 'fa-arrow-rotate-right' : 'fa-arrows-rotate';
                    text = canInstall ? 'Instalar atualização' : 'Checar atualização';
                    disabled = action === 'none';
                    title = status.statusMessage || '';
                    break;
                }
                case 'installing':
                    spin = true;
                    disabled = true;
                    iconName = 'fa-circle-notch';
                    text = status.statusMessage || 'Instalando...';
                    break;
                case 'up-to-date':
                    iconName = 'fa-check';
                    text = 'Checar novamente';
                    title = status.statusMessage || 'Aplicativo atualizado.';
                    break;
                case 'disabled':
                    iconName = 'fa-ban';
                    action = 'none';
                    text = 'Atualizações indisponíveis';
                    disabled = true;
                    title = status.statusMessage || 'Atualizações automáticas foram desabilitadas.';
                    break;
                case 'error':
                    iconName = 'fa-triangle-exclamation';
                    text = 'Tentar novamente';
                    title = status.statusMessage || status.error?.friendlyMessage || '';
                    break;
                default:
                    break;
            }
        }

        if (!title) {
            title = text;
        }

        btn.dataset.action = action;
        btn.disabled = disabled;
        btn.title = title;
        btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        btn.setAttribute('aria-busy', spin ? 'true' : 'false');
        btn.classList.toggle('is-loading', spin);
        applyIcon();
        label.textContent = text;

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

        if (isSupAdmin) {
            setElementHidden(btn, true);
            applySupAdminState();
            updateContainerVisibility();
            return;
        }

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
            case 'checking':
                window.showToast('Verificando atualizações...', 'info');
                break;
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
            case 'up-to-date':
                window.showToast(current.statusMessage || 'Aplicativo já está atualizado.', 'success');
                break;
            case 'disabled':
                window.showToast(current.statusMessage || 'Atualizações automáticas desabilitadas.', 'warning');
                break;
            default:
                break;
        }
    }

    function setUserProfile(user) {
        state.user = user || {};
        ensureAutoCheckTimer();
        runAutomaticCheck({ silent: true });
        updatePublishButton();
        updateCheckButton();
        applySupAdminState();
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

        updateCheckButton();
        updateBadge();
        updatePublishButton();
        applySupAdminState();
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
        updateCheckButton();
        if (newState.publishing === true) {
            setSupAdminMode('publishing', { panelOpen: false });
        } else if (newState.publishing === false) {
            const hasPending = computePublishAvailability();
            setSupAdminMode(hasPending ? 'available' : 'success', { panelOpen: false });
        } else {
            applySupAdminState();
        }
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
        setSupAdminMode('error', { panelOpen: false, lastError: payload?.message });
        const errorMessage = payload?.message || 'Falha ao publicar atualização.';
        if (typeof window.alert === 'function') {
            window.alert(errorMessage);
        } else if (window.showToast) {
            window.showToast(errorMessage, 'error');
        }
        setSupAdminMode('available', { panelOpen: false });
        persistState();
    }

    async function handleCheckAction() {
        const btn = elements.checkBtn;
        if (!btn || state.actionBusy) return;

        const action = btn.dataset.action || 'check';
        if (action === 'none') return;

        const electronAPI = window.electronAPI || {};
        if (
            action === 'download' && !electronAPI.downloadUpdate ||
            action === 'install' && !electronAPI.installUpdate ||
            action === 'check' && !electronAPI.checkForUpdates && !electronAPI.getUpdateStatus
        ) {
            return;
        }

        state.actionBusy = true;
        updateCheckButton();

        try {
            let result = null;
            if (action === 'download') {
                result = await electronAPI.downloadUpdate();
            } else if (action === 'install') {
                result = await electronAPI.installUpdate();
                if (result?.canInstall === false && window.showToast) {
                    window.showToast(
                        result.statusMessage || 'Nenhuma atualização disponível para instalar.',
                        'warning'
                    );
                }
            } else {
                if (electronAPI.checkForUpdates) {
                    result = await electronAPI.checkForUpdates();
                } else if (electronAPI.getUpdateStatus) {
                    result = await electronAPI.getUpdateStatus({ refresh: true });
                }
            }

            if (result && typeof result === 'object') {
                setUpdateStatus(result);
            }
        } catch (err) {
            if (window.showToast) {
                window.showToast(
                    err?.message || 'Não foi possível verificar atualizações.',
                    'error'
                );
            }
        } finally {
            state.actionBusy = false;
            updateCheckButton();
            persistState();
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

        if (elements.checkBtn) {
            elements.checkBtn.addEventListener('click', handleCheckAction);
        }

        if (elements.publishBtn) {
            elements.publishBtn.addEventListener('click', triggerPublish);
        }

        if (elements.supAdmin?.trigger) {
            elements.supAdmin.trigger.addEventListener('click', handleSupAdminTriggerClick);
        }

        if (elements.supAdmin?.publish) {
            elements.supAdmin.publish.addEventListener('click', handleSupAdminPublish);
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
            updateCheckButton();
        }
        if (restored.publishState) {
            setPublishState(restored.publishState, { silent: true });
        } else {
            updatePublishButton();
        }
        applySupAdminState();
        updateContainerVisibility();
        updateCheckButton();
        attachEvents();
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', stopAutoCheckTimer);
        }
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
