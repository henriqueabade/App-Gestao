// Lógica de interação do menu principal

// Elementos da página
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('mainContent');
const menuToggle = document.getElementById('menuToggle');
const crmToggle = document.getElementById('crmToggle');
const crmSubmenu = document.getElementById('crmSubmenu');
const chevron = crmToggle.querySelector('.chevron');
const companyName = document.getElementById('companyName');

const MODULES_WITHOUT_SCROLL = new Set([
    'materia-prima',
    'produtos',
    'orcamentos',
    'pedidos',
    'calendario',
    'tarefas',
    'usuarios'
]);

function applyModuleScrollBehavior(page) {
    const content = document.getElementById('content');
    if (!content) return;

    document.body.dataset.currentModule = page;

    if (MODULES_WITHOUT_SCROLL.has(page)) {
        content.classList.add('no-scroll');
    } else {
        content.classList.remove('no-scroll');
    }
}

applyModuleScrollBehavior('dashboard');

const AppUpdates = (() => {
    const STATE_KEY = 'menu.app-update-state';
    const elements = {
        container: document.getElementById('appUpdateContainer'),
        badge: document.getElementById('appUpdateBadge'),
        badgeTitle: document.getElementById('appUpdateBadgeTitle'),
        badgeSubtitle: document.getElementById('appUpdateBadgeSubtitle'),
        progress: document.getElementById('appUpdateProgress'),
        progressBar: document.getElementById('appUpdateProgressBar'),
        supAdmin: {
            container: document.getElementById('supAdminUpdateControl'),
            trigger: document.getElementById('supAdminUpdatesTrigger'),
            icon: document.getElementById('supAdminUpdatesIcon'),
            label: document.getElementById('supAdminUpdatesLabel'),
            panel: document.getElementById('supAdminUpdatesPanel'),
            summary: document.getElementById('supAdminUpdatesSummary'),
            publish: document.getElementById('supAdminPublishAction'),
            publishIcon: document.getElementById('supAdminPublishIcon'),
            publishLabel: document.getElementById('supAdminPublishLabel')
        },
        user: {
            container: document.getElementById('userUpdateControl'),
            trigger: document.getElementById('userUpdatesTrigger'),
            icon: document.getElementById('userUpdatesIcon'),
            label: document.getElementById('userUpdatesLabel'),
            panel: document.getElementById('userUpdatesPanel'),
            summary: document.getElementById('userUpdatesSummary'),
            action: document.getElementById('userUpdateAction'),
            actionIcon: document.getElementById('userUpdateActionIcon'),
            actionLabel: document.getElementById('userUpdateActionLabel')
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
        userInitiatedUpdate: false,
        userUpdateInProgress: false,
        supAdmin: {
            mode: 'idle',
            panelOpen: false,
            lastError: null,
            successTimer: null
        },
        userControl: {
            mode: 'idle',
            panelOpen: false,
            pendingAction: false,
            spinner: null,
            spinnerMessage: '',
            lastError: null,
            forceAvailable: false,
            errorAcknowledged: false
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

    const USER_INITIATED_PROGRESS_STATUSES = new Set(['checking', 'downloading', 'installing']);

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
        const supAdminVisible = Boolean(
            elements.supAdmin?.container &&
            !elements.supAdmin.container.classList.contains('hidden')
        );
        const userVisible = Boolean(
            elements.user?.container &&
            !elements.user.container.classList.contains('hidden')
        );
        setElementHidden(elements.container, !(badgeVisible || supAdminVisible || userVisible));
    }

    function markUserInitiatedUpdate({ inProgress = false } = {}) {
        state.userInitiatedUpdate = true;
        if (inProgress) {
            state.userUpdateInProgress = true;
        }
    }

    function clearUserInitiatedUpdate({ force = false } = {}) {
        if (force) {
            state.userInitiatedUpdate = false;
            state.userUpdateInProgress = false;
            return;
        }
        if (!state.userUpdateInProgress) {
            state.userInitiatedUpdate = false;
        }
    }

    function updateUserInitiatedFromStatus(status) {
        if (!state.userInitiatedUpdate) {
            state.userUpdateInProgress = false;
            return;
        }
        if (USER_INITIATED_PROGRESS_STATUSES.has(status)) {
            state.userUpdateInProgress = true;
            return;
        }
        state.userUpdateInProgress = false;
        if (!state.userControl.panelOpen) {
            state.userInitiatedUpdate = false;
        }
    }

    const STATUS_LABELS = {
        checking: 'Verificando atualizações',
        'update-available': 'Atualização disponível',
        downloading: 'Baixando atualização',
        downloaded: 'Atualização baixada',
        installing: 'Instalando atualização',
        'up-to-date': 'Aplicativo atualizado',
        disabled: 'Atualizações desabilitadas',
        error: 'Erro na atualização',
        idle: 'Aguardando verificação'
    };

    const SUP_ADMIN_MODE_LABELS = {
        idle: 'Aguardando publicação',
        available: 'Atualizações pendentes',
        publishing: 'Publicando atualização',
        success: 'Publicação concluída',
        error: 'Erro na publicação'
    };

    const VERSION_INPUT_PATTERN = /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*$/;
    const VERSION_INPUT_PLACEHOLDER = 'Ex.: 1.2.0';

    const USER_MODE_LABELS = {
        idle: 'Aguardando verificação',
        checking: 'Verificando atualizações',
        available: 'Atualização disponível',
        updating: 'Processando atualização',
        error: 'Erro detectado',
        'up-to-date': 'Aplicativo atualizado'
    };

    function translateLabel(dictionary, key, fallback) {
        if (!key) return fallback || null;
        return dictionary[key] || fallback || null;
    }

    function formatDateTime(value) {
        if (!value) return null;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function parseSummaryHighlights(value) {
        if (value === null || value === undefined) return [];
        const text = String(value).replace(/\r\n|\r/g, '\n');
        const lines = text
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
        if (!lines.length) return [];
        if (lines.length === 1 && !/^[-*•]/.test(lines[0])) {
            return [];
        }
        return lines.map(line => line.replace(/^[-*•]+\s*/, '').trim()).filter(Boolean);
    }

    function normalizeReleaseEntries() {
        const rawNotes = state.updateStatus?.releaseNotes;
        const notesArray = Array.isArray(rawNotes) ? rawNotes : rawNotes ? [rawNotes] : [];
        const fallbackTitle =
            state.updateStatus?.releaseName ||
            (state.updateStatus?.latestVersion ? `Versão ${state.updateStatus.latestVersion}` : null);
        const fallbackDate = state.updateStatus?.releaseDate || null;

        return notesArray
            .map((entry, index) => {
                if (!entry && typeof entry !== 'number') return null;
                if (typeof entry === 'string') {
                    const highlights = parseSummaryHighlights(entry);
                    return {
                        id: `release-${index}`,
                        title: fallbackTitle || 'Notas da atualização',
                        version: null,
                        date: fallbackDate,
                        author: null,
                        highlights,
                        summary: !highlights.length ? entry.trim() : ''
                    };
                }

                const summaryText =
                    (typeof entry.summary === 'string' && entry.summary.trim()) ||
                    (typeof entry.note === 'string' && entry.note.trim()) ||
                    (typeof entry.text === 'string' && entry.text.trim()) ||
                    '';

                const highlights = Array.isArray(entry.highlights)
                    ? entry.highlights.filter(Boolean)
                    : parseSummaryHighlights(summaryText || entry.description || '');

                const normalizedHighlights = highlights.length
                    ? highlights
                    : parseSummaryHighlights(summaryText);

                const summary = normalizedHighlights.length ? '' : summaryText;
                const titleCandidate =
                    entry.title ||
                    entry.name ||
                    (entry.version ? `Versão ${entry.version}` : null) ||
                    fallbackTitle ||
                    'Notas da atualização';
                const dateCandidate = entry.date || entry.releaseDate || fallbackDate || null;
                const versionCandidate = entry.version || null;
                const authorCandidate = entry.author || null;

                return {
                    id: entry.id || `release-${index}`,
                    title: titleCandidate,
                    version: versionCandidate,
                    date: dateCandidate,
                    author: authorCandidate,
                    highlights: normalizedHighlights,
                    summary
                };
            })
            .filter(Boolean);
    }

    function extractPendingChangeEntries() {
        const pending = state.publishState?.pendingChanges;
        if (!pending) return [];
        const source = Array.isArray(pending) ? pending : [pending];
        return source
            .map((entry, index) => {
                if (!entry && typeof entry !== 'number') return null;
                if (typeof entry === 'string') {
                    const highlights = parseSummaryHighlights(entry);
                    return {
                        id: `pending-${index}`,
                        title: 'Alteração pendente',
                        version: null,
                        date: null,
                        author: null,
                        highlights,
                        summary: !highlights.length ? entry.trim() : ''
                    };
                }

                const details =
                    (typeof entry.description === 'string' && entry.description.trim()) ||
                    (typeof entry.summary === 'string' && entry.summary.trim()) ||
                    (typeof entry.details === 'string' && entry.details.trim()) ||
                    (typeof entry.text === 'string' && entry.text.trim()) ||
                    '';

                const highlightCandidates = Array.isArray(entry.items)
                    ? entry.items
                          .map(item => (item !== null && item !== undefined ? String(item).trim() : ''))
                          .filter(Boolean)
                    : parseSummaryHighlights(details);

                const summary = highlightCandidates.length ? '' : details;
                const title =
                    entry.title ||
                    entry.name ||
                    entry.group ||
                    (entry.version ? `Versão ${entry.version}` : null) ||
                    'Alteração pendente';
                const date = entry.date || entry.timestamp || entry.updatedAt || null;
                const version = entry.version || entry.tag || null;
                const author = entry.author || entry.user || entry.owner || null;

                return {
                    id: entry.id || entry.key || `pending-${index}`,
                    title,
                    version,
                    date,
                    author,
                    highlights: highlightCandidates,
                    summary
                };
            })
            .filter(Boolean);
    }

    function buildChangeEntries() {
        const releaseEntries = normalizeReleaseEntries();
        const pendingEntries = extractPendingChangeEntries();
        return [...releaseEntries, ...pendingEntries];
    }

    function buildUpdateSummary(audience = 'user') {
        const sections = [];
        const updateStatus = state.updateStatus || {};
        const publishState = state.publishState || {};
        const versionItems = [];
        const localVersion = state.localVersion || publishState.localVersion || updateStatus.localVersion;
        const availableVersion =
            publishState.availableVersion || updateStatus.latestVersion || state.availableVersion;
        const publishedVersion =
            publishState.latestPublishedVersion || updateStatus.latestPublishedVersion || state.latestPublishedVersion;

        const addVersionItem = (label, value) => {
            if (value === null || value === undefined || value === '') return;
            versionItems.push({ label, value });
        };

        addVersionItem('Versão local', localVersion);
        addVersionItem('Versão disponível', availableVersion);
        addVersionItem('Última publicada', publishedVersion);
        addVersionItem('Canal', updateStatus.channel);

        if (versionItems.length) {
            sections.push({ kind: 'definition', title: 'Versões monitoradas', items: versionItems });
        }

        const statusItems = [];
        const statusLabel = translateLabel(STATUS_LABELS, updateStatus.status, null);
        if (statusLabel) {
            statusItems.push({ label: 'Estado', value: statusLabel });
        }
        if (updateStatus.statusMessage && updateStatus.statusMessage !== statusLabel) {
            statusItems.push({ label: 'Mensagem', value: updateStatus.statusMessage });
        }
        const progressPercent = updateStatus.downloadProgress?.percent;
        if (typeof progressPercent === 'number') {
            statusItems.push({ label: 'Download', value: `${clampPercent(progressPercent)}%` });
        }
        const lastCheck = formatDateTime(updateStatus.lastCheckAt);
        if (lastCheck) {
            statusItems.push({ label: 'Última verificação', value: lastCheck });
        }
        if (statusItems.length) {
            sections.push({ kind: 'definition', title: 'Status da atualização', items: statusItems });
        }

        if (audience === 'supAdmin') {
            const publishItems = [];
            const modeLabel = translateLabel(SUP_ADMIN_MODE_LABELS, state.supAdmin.mode, null);
            if (modeLabel) {
                publishItems.push({ label: 'Estado da publicação', value: modeLabel });
            }
            if (publishState.message) {
                publishItems.push({ label: 'Mensagem recente', value: publishState.message });
            }
            if (state.supAdmin.lastError) {
                publishItems.push({ label: 'Último erro', value: state.supAdmin.lastError });
            }
            publishItems.push({
                label: 'Pendências para publicar',
                value: computePublishAvailability() ? 'Sim' : 'Não'
            });
            const filtered = publishItems.filter(item => item.value);
            if (filtered.length) {
                sections.push({ kind: 'definition', title: 'Publicação', items: filtered });
            }
        } else {
            const userItems = [];
            const modeLabel = translateLabel(USER_MODE_LABELS, state.userControl.mode, null);
            if (modeLabel) {
                userItems.push({ label: 'Estado do assistente', value: modeLabel });
            }
            if (state.userControl.spinnerMessage && state.userControl.mode === 'updating') {
                userItems.push({ label: 'Progresso', value: state.userControl.spinnerMessage });
            }
            if (state.userControl.lastError && state.userControl.mode === 'error') {
                userItems.push({ label: 'Último erro', value: state.userControl.lastError });
            }
            if (state.userControl.pendingAction) {
                userItems.push({ label: 'Ação pendente', value: 'Processando atualização' });
            }
            const filtered = userItems.filter(item => item.value);
            if (filtered.length) {
                sections.push({ kind: 'definition', title: 'Assistente de atualização', items: filtered });
            }
        }

        let changeEntries = buildChangeEntries();
        const publishPending = computePublishAvailability();
        const updateHasAvailableStatus =
            updateStatus.status === 'update-available' || updateStatus.status === 'downloaded';

        if (
            !changeEntries.length &&
            ((audience === 'supAdmin' && publishPending) || (audience !== 'supAdmin' && updateHasAvailableStatus))
        ) {
            const placeholderTitle =
                updateStatus.releaseName ||
                (updateStatus.latestVersion ? `Versão ${updateStatus.latestVersion}` : null) ||
                (availableVersion ? `Versão ${availableVersion}` : null) ||
                'Atualização disponível';
            const placeholderSummary =
                updateStatus.statusMessage ||
                publishState.message ||
                'Nenhuma nota de versão disponível para esta atualização.';

            changeEntries = [
                {
                    id: `updates-placeholder-${audience}`,
                    title: placeholderTitle,
                    version: updateStatus.latestVersion || availableVersion || null,
                    date: updateStatus.releaseDate || null,
                    author: null,
                    highlights: [],
                    summary: placeholderSummary
                }
            ];
        }

        if (changeEntries.length) {
            sections.push({ kind: 'changes', title: 'Resumo das alterações', items: changeEntries });
        }

        let emptyMessage;
        if (audience === 'supAdmin') {
            emptyMessage = computePublishAvailability()
                ? 'Resumo em preparação. Aguarde enquanto coletamos as últimas alterações.'
                : 'Nenhuma atualização pendente para publicação.';
        } else if (state.userControl.mode === 'available' || updateStatus.status === 'update-available') {
            emptyMessage = 'Resumo ainda não disponível para esta atualização.';
        } else {
            emptyMessage = 'Nenhuma atualização disponível no momento.';
        }

        return { sections, emptyMessage };
    }

    function renderSummary(container, summary) {
        if (!container || !summary) return;
        container.innerHTML = '';
        const sections = Array.isArray(summary.sections) ? summary.sections : [];
        let appended = false;

        sections.forEach(section => {
            if (!Array.isArray(section.items) || !section.items.length) return;
            const sectionEl = document.createElement('section');
            sectionEl.className = 'updates-summary__section';

            const heading = document.createElement('h3');
            heading.className = 'updates-summary__heading';
            heading.textContent = section.title;
            sectionEl.appendChild(heading);

            let hasContent = false;

            if (section.kind === 'definition') {
                const dl = document.createElement('dl');
                dl.className = 'updates-summary__definition';
                section.items.forEach(item => {
                    if (!item || item.value === undefined || item.value === null || item.value === '') return;
                    const dt = document.createElement('dt');
                    dt.textContent = item.label;
                    const dd = document.createElement('dd');
                    dd.textContent = item.value;
                    dl.appendChild(dt);
                    dl.appendChild(dd);
                });
                if (dl.childElementCount > 0) {
                    sectionEl.appendChild(dl);
                    hasContent = true;
                }
            } else if (section.kind === 'list') {
                const ul = document.createElement('ul');
                ul.className = 'updates-summary__list';
                section.items.forEach(text => {
                    if (!text) return;
                    const li = document.createElement('li');
                    li.textContent = text;
                    ul.appendChild(li);
                });
                if (ul.childElementCount > 0) {
                    sectionEl.appendChild(ul);
                    hasContent = true;
                }
            } else if (section.kind === 'changes') {
                const list = document.createElement('ul');
                list.className = 'updates-summary__changes';
                section.items.forEach(entry => {
                    if (!entry) return;
                    const li = document.createElement('li');
                    li.className = 'updates-summary__change';

                    const header = document.createElement('div');
                    header.className = 'updates-summary__change-header';
                    let headerHasContent = false;

                    if (entry.title) {
                        const titleEl = document.createElement('span');
                        titleEl.className = 'updates-summary__change-title';
                        titleEl.textContent = entry.title;
                        header.appendChild(titleEl);
                        headerHasContent = true;
                    }

                    const metaParts = [];
                    if (entry.version) {
                        metaParts.push(`v${entry.version}`);
                    }
                    const formattedDate = formatDateTime(entry.date);
                    if (formattedDate) {
                        metaParts.push(formattedDate);
                    }
                    if (entry.author) {
                        metaParts.push(entry.author);
                    }
                    if (metaParts.length) {
                        const metaEl = document.createElement('span');
                        metaEl.className = 'updates-summary__change-meta';
                        metaEl.textContent = metaParts.join(' • ');
                        header.appendChild(metaEl);
                        headerHasContent = true;
                    }

                    if (headerHasContent) {
                        li.appendChild(header);
                    }

                    const highlights = Array.isArray(entry.highlights) ? entry.highlights.filter(Boolean) : [];
                    const summaryText = typeof entry.summary === 'string' ? entry.summary.trim() : '';
                    if (highlights.length) {
                        const bulletList = document.createElement('ul');
                        bulletList.className = 'updates-summary__change-points';
                        highlights.forEach(text => {
                            if (!text) return;
                            const bullet = document.createElement('li');
                            bullet.textContent = text;
                            bulletList.appendChild(bullet);
                        });
                        if (bulletList.childElementCount > 0) {
                            li.appendChild(bulletList);
                        }
                    }

                    if (!highlights.length && summaryText) {
                        const note = document.createElement('p');
                        note.className = 'updates-summary__change-note';
                        note.textContent = summaryText;
                        li.appendChild(note);
                    }

                    if (!li.childElementCount && summaryText) {
                        const note = document.createElement('p');
                        note.className = 'updates-summary__change-note';
                        note.textContent = summaryText;
                        li.appendChild(note);
                    }

                    if (!li.childElementCount) {
                        const fallback = document.createElement('p');
                        fallback.className = 'updates-summary__change-note';
                        fallback.textContent = 'Alteração registrada.';
                        li.appendChild(fallback);
                    }

                    list.appendChild(li);
                });
                if (list.childElementCount > 0) {
                    sectionEl.appendChild(list);
                    hasContent = true;
                }
            }

            if (hasContent) {
                container.appendChild(sectionEl);
                appended = true;
            }
        });

        if (!appended) {
            const empty = document.createElement('p');
            empty.className = 'updates-summary__empty';
            empty.textContent = summary.emptyMessage || 'Nenhum resumo disponível no momento.';
            container.appendChild(empty);
        }
    }

    function renderSupAdminSummary() {
        const container = elements.supAdmin?.summary;
        if (!container) return;
        const summary = buildUpdateSummary('supAdmin');
        renderSummary(container, summary);
    }

    function renderUserSummary() {
        const container = elements.user?.summary;
        if (!container) return;
        const summary = buildUpdateSummary('user');
        renderSummary(container, summary);
    }

    function refreshUpdateSummaries() {
        renderSupAdminSummary();
        renderUserSummary();
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
        if (typeof explicit === 'boolean' && explicit === false) {
            return false;
        }

        const pendingChangesCount = Array.isArray(publishState.pendingChanges)
            ? publishState.pendingChanges.filter(Boolean).length
            : 0;
        if (pendingChangesCount > 0) {
            return true;
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

        renderSupAdminSummary();
        updateContainerVisibility();
    }

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text).replace(/[&<>"]+/g, match => {
            switch (match) {
                case '&':
                    return '&amp;';
                case '<':
                    return '&lt;';
                case '>':
                    return '&gt;';
                case '"':
                    return '&quot;';
                default:
                    return match;
            }
        });
    }

    function showUpdateDialog({ title, message, confirmLabel = 'OK', cancelLabel = null, variant = 'info' }) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'warning-overlay';

            const modal = document.createElement('div');
            modal.className = 'warning-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');

            const titleId = `updateDialogTitle-${Date.now()}`;
            modal.setAttribute('aria-labelledby', titleId);

            const iconWrap = document.createElement('div');
            iconWrap.className = 'warning-icon';

            const circle = document.createElement('div');
            circle.className = 'warning-icon-circle';
            const icon = document.createElement('i');
            icon.classList.add('fas');
            if (variant === 'error') {
                icon.classList.add('fa-triangle-exclamation');
            } else if (variant === 'confirm') {
                icon.classList.add('fa-circle-question');
            } else {
                icon.classList.add('fa-circle-info');
            }
            circle.appendChild(icon);
            iconWrap.appendChild(circle);

            const titleEl = document.createElement('h2');
            titleEl.id = titleId;
            titleEl.className = 'warning-title text-lg';
            titleEl.innerHTML = escapeHtml(title || 'Atualizações');

            const messageEl = document.createElement('p');
            messageEl.className = 'warning-text mt-3';
            const safeMessage = escapeHtml(message || '');
            messageEl.innerHTML = safeMessage.replace(/\n/g, '<br>');

            const actions = document.createElement('div');
            actions.className = cancelLabel ? 'mt-6 space-y-3' : 'mt-6';

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className = 'warning-button';
            confirmBtn.textContent = confirmLabel;
            confirmBtn.dataset.action = 'confirm';

            let cancelBtn = null;
            if (cancelLabel) {
                cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.dataset.action = 'cancel';
                cancelBtn.textContent = cancelLabel;
                cancelBtn.className = 'warning-button bg-white/10 text-white border border-white/20';
                actions.appendChild(cancelBtn);
            }

            actions.appendChild(confirmBtn);

            modal.appendChild(iconWrap);
            modal.appendChild(titleEl);
            modal.appendChild(messageEl);
            modal.appendChild(actions);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                modal.classList.add('show');
                confirmBtn.focus();
            });

            const cleanup = result => {
                modal.classList.remove('show');
                setTimeout(() => {
                    if (overlay.isConnected) overlay.remove();
                }, 160);
                resolve(result);
            };

            overlay.addEventListener('click', event => {
                if (event.target === overlay && !cancelLabel) {
                    cleanup(true);
                } else if (event.target === overlay && cancelLabel) {
                    cleanup(false);
                }
            });

            confirmBtn.addEventListener('click', () => cleanup(true));
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => cleanup(false));
            }

            overlay.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    cleanup(Boolean(cancelLabel));
                }
            });
        });
    }

    const publishErrorDialogState = {
        lastMessage: null,
        lastShownAt: 0,
        activePromise: null
    };

    function showStandardDialog({
        title,
        message,
        confirmLabel = 'OK',
        variant = 'info'
    }) {
        if (typeof showUpdateDialog === 'function') {
            return showUpdateDialog({ title, message, confirmLabel, variant });
        }
        if (window.showToast) {
            const toastVariant =
                variant === 'error'
                    ? 'error'
                    : variant === 'warning'
                    ? 'warning'
                    : variant === 'success'
                    ? 'success'
                    : 'info';
            window.showToast(message, toastVariant);
        } else if (typeof window.alert === 'function') {
            window.alert(message);
        }
        return Promise.resolve(true);
    }

    function showPublishErrorDialog(message) {
        const normalized = (message && message.toString().trim()) || 'Falha ao publicar atualização.';
        const now = Date.now();
        if (
            publishErrorDialogState.lastMessage === normalized &&
            now - publishErrorDialogState.lastShownAt < 1000 &&
            publishErrorDialogState.activePromise
        ) {
            return publishErrorDialogState.activePromise;
        }
        publishErrorDialogState.lastMessage = normalized;
        publishErrorDialogState.lastShownAt = now;
        const result = showStandardDialog({
            title: 'Falha na Publicação',
            message: normalized,
            confirmLabel: 'Entendi',
            variant: 'error'
        });
        const trackedPromise = Promise.resolve(result).finally(() => {
            if (publishErrorDialogState.activePromise === trackedPromise) {
                publishErrorDialogState.activePromise = null;
            }
        });
        publishErrorDialogState.activePromise = trackedPromise;
        return trackedPromise;
    }

    function promptForVersionNumber({ currentLocal, latestPublished } = {}) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'warning-overlay';

            const modal = document.createElement('div');
            modal.className = 'warning-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');

            const titleId = `versionPromptTitle-${Date.now()}`;
            modal.setAttribute('aria-labelledby', titleId);

            const iconWrap = document.createElement('div');
            iconWrap.className = 'warning-icon';

            const circle = document.createElement('div');
            circle.className = 'warning-icon-circle';
            const icon = document.createElement('i');
            icon.classList.add('fas', 'fa-circle-question');
            circle.appendChild(icon);
            iconWrap.appendChild(circle);

            const titleEl = document.createElement('h2');
            titleEl.id = titleId;
            titleEl.className = 'warning-title text-lg';
            titleEl.textContent = 'Definir nova versão';

            const messageEl = document.createElement('p');
            messageEl.className = 'warning-text mt-3';
            messageEl.textContent = 'Informe o número da versão que será publicada.';

            const contextEl = document.createElement('p');
            contextEl.className = 'warning-text-small mt-3';
            contextEl.style.textAlign = 'left';
            const safeLocal = currentLocal ? escapeHtml(currentLocal) : '—';
            const safePublished = latestPublished ? escapeHtml(latestPublished) : '—';
            contextEl.innerHTML = `Versão local atual: <strong>${safeLocal}</strong><br>Última publicada: <strong>${safePublished}</strong>`;

            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'decimal';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.maxLength = 32;
            input.className = 'warning-input mt-4';
            input.placeholder = VERSION_INPUT_PLACEHOLDER;
            input.value = latestPublished || currentLocal || '';

            const hintEl = document.createElement('p');
            hintEl.className = 'warning-text-small mt-2';
            hintEl.style.textAlign = 'left';
            hintEl.textContent = 'Use três segmentos numéricos, como 1.2.0 ou 2.0.0-beta.';

            const errorEl = document.createElement('p');
            errorEl.className = 'warning-text-small mt-2 hidden';
            errorEl.style.textAlign = 'left';
            errorEl.style.color = '#fca5a5';
            errorEl.textContent = 'Informe uma versão válida no formato 1.2.3.';

            const actions = document.createElement('div');
            actions.className = 'mt-6 space-y-3';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.dataset.action = 'cancel';
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.className = 'warning-button bg-white/10 text-white border border-white/20';

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.dataset.action = 'confirm';
            confirmBtn.textContent = 'Publicar';
            confirmBtn.className = 'warning-button';
            confirmBtn.disabled = true;

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);

            modal.appendChild(iconWrap);
            modal.appendChild(titleEl);
            modal.appendChild(messageEl);
            modal.appendChild(contextEl);
            modal.appendChild(input);
            modal.appendChild(hintEl);
            modal.appendChild(errorEl);
            modal.appendChild(actions);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const normalize = value => value.trim();

            const validate = () => {
                const value = normalize(input.value);
                const isValid = Boolean(value) && VERSION_INPUT_PATTERN.test(value);
                confirmBtn.disabled = !isValid;
                if (!isValid && value) {
                    errorEl.classList.remove('hidden');
                } else {
                    errorEl.classList.add('hidden');
                }
                return isValid;
            };

            const cleanup = result => {
                modal.classList.remove('show');
                setTimeout(() => {
                    if (overlay.isConnected) overlay.remove();
                }, 160);
                resolve(result);
            };

            cancelBtn.addEventListener('click', () => cleanup(null));
            confirmBtn.addEventListener('click', () => {
                if (confirmBtn.disabled) return;
                cleanup(normalize(input.value));
            });

            overlay.addEventListener('click', event => {
                if (event.target === overlay) {
                    cleanup(null);
                }
            });

            overlay.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    cleanup(null);
                }
            });

            input.addEventListener('input', validate);
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    if (validate()) {
                        cleanup(normalize(input.value));
                    }
                }
            });

            requestAnimationFrame(() => {
                modal.classList.add('show');
                input.focus();
                input.select();
                validate();
            });
        });
    }

    function ensureUserSpinner(message) {
        const control = state.userControl;
        if (control.spinner && control.spinner.isConnected) {
            const label = control.spinner.querySelector('[data-role="message"]');
            if (label) label.textContent = message || 'Processando atualização...';
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4';
        overlay.setAttribute('role', 'alert');
        overlay.innerHTML = `
            <div class="w-16 h-16 border-4 border-[#60a5fa] border-t-transparent rounded-full animate-spin"></div>
            <p class="text-sm text-white font-medium" data-role="message">${escapeHtml(message || 'Processando atualização...')}</p>
        `;
        document.body.appendChild(overlay);
        control.spinner = overlay;
    }

    function hideUserSpinner() {
        const overlay = state.userControl.spinner;
        if (overlay && overlay.isConnected) {
            overlay.remove();
        }
        state.userControl.spinner = null;
        state.userControl.spinnerMessage = '';
    }

    function setUserMode(mode, options = {}) {
        const valid = new Set(['idle', 'checking', 'available', 'updating', 'error', 'up-to-date']);
        const nextMode = valid.has(mode) ? mode : 'idle';
        state.userControl.mode = nextMode;
        if (options.panelOpen !== undefined) {
            state.userControl.panelOpen = Boolean(options.panelOpen);
        }
        if (options.lastError !== undefined) {
            state.userControl.lastError = options.lastError || null;
        } else if (nextMode !== 'error') {
            state.userControl.lastError = null;
        }
        if (options.spinnerMessage !== undefined) {
            state.userControl.spinnerMessage = options.spinnerMessage || '';
        }

        if (nextMode === 'updating') {
            ensureUserSpinner(state.userControl.spinnerMessage || 'Aplicando atualização...');
        } else {
            hideUserSpinner();
        }

        applyUserState();
    }

    function applyUserState() {
        const user = elements.user;
        if (!user?.container || !user.trigger || !user.icon || !user.label) {
            updateContainerVisibility();
            return;
        }

        const profile = state.user || {};
        const isSupAdmin = profile?.perfil === 'Sup Admin';
        user.container.classList.toggle('hidden', isSupAdmin);

        if (isSupAdmin) {
            state.userControl.panelOpen = false;
            hideUserSpinner();
            updateContainerVisibility();
            return;
        }

        const mode = state.userControl.mode || 'idle';
        const trigger = user.trigger;

        let iconClass = 'fa-circle-check';
        let labelText = 'Atualizações indisponíveis';
        let disableTrigger = false;
        let busy = false;

        switch (mode) {
            case 'checking':
                iconClass = 'fa-circle-notch';
                labelText = 'Verificando atualizações...';
                disableTrigger = true;
                busy = true;
                break;
            case 'available':
                iconClass = 'fa-cloud-download-alt';
                labelText = state.updateStatus?.latestVersion
                    ? `Atualização v${state.updateStatus.latestVersion}`
                    : 'Atualização disponível';
                break;
            case 'updating':
                iconClass = 'fa-wifi';
                labelText = 'Aplicando atualização...';
                disableTrigger = true;
                busy = true;
                break;
            case 'error':
                iconClass = 'fa-circle-xmark';
                labelText = state.userControl.lastError || 'Falha na atualização';
                break;
            case 'up-to-date':
                iconClass = 'fa-circle-check';
                labelText = 'Aplicativo atualizado';
                break;
            default:
                break;
        }

        if (state.updateStatus?.status === 'disabled') {
            labelText = state.updateStatus.statusMessage || 'Atualizações indisponíveis';
        }

        user.icon.className = `fas ${iconClass} user-updates-icon`;
        user.label.textContent = 'Atualizações';
        if (labelText && labelText !== 'Atualizações') {
            user.label.dataset.statusLabel = labelText;
        } else {
            delete user.label.dataset.statusLabel;
        }

        trigger.dataset.state = mode;
        trigger.setAttribute('data-state', mode);
        trigger.disabled = disableTrigger;
        trigger.setAttribute('aria-busy', busy ? 'true' : 'false');
        trigger.setAttribute('aria-expanded', state.userControl.panelOpen ? 'true' : 'false');
        trigger.title = labelText || 'Atualizações';
        trigger.setAttribute('aria-label', labelText ? `Atualizações – ${labelText}` : 'Atualizações');

        if (user.panel) {
            const showPanel = Boolean(state.userControl.panelOpen);
            user.panel.classList.toggle('hidden', !showPanel);
            user.panel.setAttribute('aria-hidden', showPanel ? 'false' : 'true');
        }

        if (user.action) {
            user.action.disabled = mode !== 'available';
        }

        renderUserSummary();
        updateContainerVisibility();
    }

    function updateUserControlFromStatus() {
        const profile = state.user || {};
        if (profile?.perfil === 'Sup Admin') {
            applyUserState();
            return;
        }

        const status = state.updateStatus?.status;
        const lastErrorMessage = state.updateStatus?.statusMessage || state.updateStatus?.error?.friendlyMessage || state.updateStatus?.error?.message;

        if (status !== 'error') {
            state.userControl.errorAcknowledged = false;
        }

        switch (status) {
            case 'checking':
                setUserMode('checking');
                break;
            case 'update-available':
            case 'downloaded':
                setUserMode('available', { panelOpen: state.userControl.panelOpen });
                break;
            case 'downloading':
                setUserMode('updating', { spinnerMessage: 'Baixando atualização...' });
                break;
            case 'installing':
                setUserMode('updating', { spinnerMessage: 'Aplicando atualização...' });
                break;
            case 'up-to-date':
                setUserMode('up-to-date');
                break;
            case 'disabled':
                setUserMode('idle');
                break;
            case 'error':
                setUserMode('error', { lastError: lastErrorMessage });
                if (!state.userControl.errorAcknowledged) {
                    state.userControl.errorAcknowledged = true;
                    showUpdateDialog({
                        title: 'Erro na atualização',
                        message: lastErrorMessage || 'Ocorreu um erro durante a atualização.',
                        confirmLabel: 'OK',
                        variant: 'error'
                    }).then(() => {
                        state.userControl.pendingAction = false;
                        if (state.updateStatus?.latestVersion) {
                            runAutomaticCheck({ silent: true });
                        } else {
                            setUserMode('idle');
                        }
                    });
                }
                break;
            default:
                setUserMode('idle');
                break;
        }
    }

    async function handleUserTriggerClick(event) {
        if (event && typeof event.button === 'number' && event.button !== 0) {
            return;
        }
        event.preventDefault();

        const mode = state.userControl.mode;
        if (mode === 'updating') {
            return;
        }

        const willOpen = !state.userControl.panelOpen;
        if (!willOpen) {
            setUserMode(mode, { panelOpen: false });
            clearUserInitiatedUpdate();
            return;
        }

        markUserInitiatedUpdate();
        setUserMode(mode, { panelOpen: true });

        if (mode === 'available' || state.actionBusy) {
            return;
        }

        state.actionBusy = true;
        try {
            setUserMode('checking', { panelOpen: true });
            const result = await runAutomaticCheck({ silent: true, userInitiated: true });
            const status = result?.status || state.updateStatus?.status;
            const message =
                result?.statusMessage ||
                result?.error?.friendlyMessage ||
                result?.error?.message ||
                state.updateStatus?.statusMessage ||
                null;

            if (status === 'update-available' || status === 'downloaded') {
                setUserMode('available', { panelOpen: true });
            } else if (status === 'error') {
                setUserMode('error', { panelOpen: true, lastError: message });
                if (message && window.showToast) {
                    window.showToast(message, 'error');
                }
            } else if (status === 'up-to-date') {
                setUserMode('up-to-date', { panelOpen: true });
            } else {
                setUserMode('idle', { panelOpen: true });
            }
        } catch (err) {
            const message = err?.message || 'Não foi possível verificar atualizações.';
            setUserMode('error', { panelOpen: true, lastError: message });
            if (window.showToast) {
                window.showToast(message, 'error');
            }
        } finally {
            state.actionBusy = false;
            refreshUpdateSummaries();
        }
    }

    async function handleUserUpdateAction(event) {
        event.preventDefault();
        if (state.actionBusy) return;
        if (state.userControl.mode !== 'available') return;

        const latestVersion = state.updateStatus?.latestVersion || state.availableVersion;
        const lines = ['Tem certeza que deseja aplicar a atualização agora?'];
        if (latestVersion) {
            lines.push(`Versão disponível: ${latestVersion}.`);
        }
        lines.push('Ao atualizar, alterações não salvas serão perdidas.');

        const confirmed = await showUpdateDialog({
            title: 'Aplicar atualização',
            message: lines.join('\n'),
            confirmLabel: 'Sim',
            cancelLabel: 'Não',
            variant: 'confirm'
        });

        if (!confirmed) {
            return;
        }

        markUserInitiatedUpdate({ inProgress: true });
        state.actionBusy = true;
        state.userControl.pendingAction = true;
        setUserMode('updating', { panelOpen: false, spinnerMessage: 'Baixando atualização...' });

        try {
            const api = window.electronAPI || {};
            if (!api.downloadUpdate || !api.installUpdate) {
                throw new Error('Atualização automática indisponível neste ambiente.');
            }

            const downloadResult = await api.downloadUpdate();
            if (downloadResult?.status === 'error') {
                throw new Error(downloadResult?.statusMessage || 'Falha ao baixar a atualização.');
            }

            const installResult = await api.installUpdate();
            if (installResult === false) {
                throw new Error('Não foi possível iniciar a instalação da atualização.');
            }
        } catch (err) {
            state.userControl.pendingAction = false;
            state.actionBusy = false;
            clearUserInitiatedUpdate({ force: true });
            hideUserSpinner();
            setUserMode('available', { panelOpen: false });
            await showUpdateDialog({
                title: 'Erro na atualização',
                message: err?.message || 'Não foi possível aplicar a atualização.',
                confirmLabel: 'OK',
                variant: 'error'
            });
            runAutomaticCheck({ silent: true });
        }
    }

    function closeUserPanel() {
        const currentMode = state.userControl.mode || 'idle';
        setUserMode(currentMode, { panelOpen: false });
        clearUserInitiatedUpdate();
    }

    function handleUserPanelDismiss(event) {
        if (!state.userControl.panelOpen) return;
        const container = elements.user?.container;
        if (!container || container.contains(event.target)) return;
        closeUserPanel();
    }

    function handleUserPanelKeydown(event) {
        if (event.key !== 'Escape') return;
        if (!state.userControl.panelOpen) return;
        closeUserPanel();
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

    async function runAutomaticCheck({ silent = true, userInitiated = false } = {}) {
        if (!window.electronAPI?.getUpdateStatus) return null;
        if (state.autoCheckPending) return null;
        state.autoCheckPending = true;
        try {
            const result = await window.electronAPI.getUpdateStatus({ refresh: true });
            if (result && typeof result === 'object') {
                setUpdateStatus(result, { silent, userInitiatedUpdate: userInitiated });
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
        // Executa a verificação automática a cada 10 minutos
        const intervalMs = 10 * 60 * 1000;
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

    async function handleSupAdminTriggerClick(event) {
        if (event && typeof event.button === 'number' && event.button !== 0) {
            return;
        }
        if (state.supAdmin.mode === 'publishing') return;
        await runAutomaticCheck({ silent: true });
        const hasPending = computePublishAvailability();
        if (!hasPending) {
            setSupAdminMode('idle', { panelOpen: false });
            const message = 'Não há atualizações para publicar. Todas já foram publicadas.';
            await showStandardDialog({
                title: 'Atualizações',
                message,
                confirmLabel: 'Entendi',
                variant: 'info'
            });
            return;
        }

        const nextOpen = !state.supAdmin.panelOpen;
        setSupAdminMode('available', { panelOpen: nextOpen });
    }

    async function handleSupAdminPublish() {
        if (!window.electronAPI?.publishUpdate) return;
        if (state.supAdmin.mode === 'publishing') return;

        const currentLocal =
            state.localVersion ||
            state.publishState?.localVersion ||
            state.updateStatus?.localVersion ||
            null;
        const latestPublished =
            state.latestPublishedVersion ||
            state.publishState?.latestPublishedVersion ||
            state.updateStatus?.latestPublishedVersion ||
            null;

        const version = await promptForVersionNumber({ currentLocal, latestPublished });
        if (!version) {
            return;
        }

        setSupAdminMode('publishing', { panelOpen: false });
        try {
            const result = await window.electronAPI.publishUpdate({ version });
            if (result?.success) {
                setPublishState(result, { silent: true });
                setSupAdminMode('success', { panelOpen: false });
                const publishedVersion = result?.latestPublishedVersion || version;
                if (window.showToast) {
                    window.showToast(`Versão ${publishedVersion} publicada com sucesso!`, 'success');
                }
                await runAutomaticCheck({ silent: true });
                return;
            }

            setPublishState(result, { silent: true, skipSupAdminMode: true });

            const message = result?.message || result?.error || 'Falha ao publicar atualização.';
            if (result?.code === 'in-progress') {
                if (window.showToast) {
                    window.showToast(message || 'Uma publicação já está em andamento.', 'info');
                }
                setSupAdminMode('publishing', { panelOpen: false });
                return;
            }

            const hasPending = computePublishAvailability();
            if (result?.code === 'invalid-version' || result?.code === 'version-update-failed') {
                setSupAdminMode(hasPending ? 'available' : 'idle', { panelOpen: false, lastError: message });
            } else {
                setSupAdminMode('error', { panelOpen: false, lastError: message });
                setSupAdminMode(hasPending ? 'available' : 'idle', { panelOpen: false, lastError: message });
            }

            await showPublishErrorDialog(message);

            await runAutomaticCheck({ silent: true });
        } catch (err) {
            const message = err?.message || 'Falha ao publicar atualização.';
            setSupAdminMode('error', { panelOpen: false, lastError: message });
            await showPublishErrorDialog(message);
            const hasPending = computePublishAvailability();
            setSupAdminMode(hasPending ? 'available' : 'idle', { panelOpen: false, lastError: message });
            await runAutomaticCheck({ silent: true });
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

    function handleUpdateToasts(previousState, current, { userInitiated = false } = {}) {
        if (!userInitiated || !current || !window.showToast) return;
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
        applySupAdminState();
        updateUserControlFromStatus();
        applyUserState();
        refreshUpdateSummaries();
        persistState();
    }

    function setUpdateStatus(newStatus, options = {}) {
        const { silent = false, userInitiatedUpdate = false } = options;
        const previousState = state.updateStatus ? { ...state.updateStatus } : null;
        state.updateStatus = newStatus ? { ...newStatus } : null;
        if (newStatus?.localVersion) state.localVersion = newStatus.localVersion;
        if (newStatus?.latestPublishedVersion) state.latestPublishedVersion = newStatus.latestPublishedVersion;
        if (newStatus?.latestVersion) state.availableVersion = newStatus.latestVersion;
        if (newStatus?.canPublish !== undefined) {
            state.publishState = { ...(state.publishState || {}), canPublish: newStatus.canPublish };
        }

        updateBadge();
        applySupAdminState();
        updateUserControlFromStatus();
        if (!silent && userInitiatedUpdate) {
            handleUpdateToasts(previousState, newStatus, { userInitiated: true });
        }
        updateUserInitiatedFromStatus(newStatus?.status || null);
        state.lastStatus = newStatus?.status || null;
        refreshUpdateSummaries();
        persistState();
    }

    function setPublishState(newState, options = {}) {
        if (!newState) return;
        const { publishState: nestedState, ...rest } = newState;
        const mergedState = { ...(state.publishState || {}), ...rest };
        if (nestedState && typeof nestedState === 'object') {
            Object.assign(mergedState, nestedState);
        }
        state.publishState = mergedState;
        if (mergedState.latestPublishedVersion) state.latestPublishedVersion = mergedState.latestPublishedVersion;
        if (mergedState.localVersion) state.localVersion = mergedState.localVersion;
        if (mergedState.availableVersion) state.availableVersion = mergedState.availableVersion;
        applySupAdminState();
        updateUserControlFromStatus();
        if (!options.skipSupAdminMode) {
            const wasPanelOpen = Boolean(state.supAdmin.panelOpen);
            const wasModeAvailable = state.supAdmin.mode === 'available';
            if (mergedState.publishing === true) {
                setSupAdminMode('publishing', { panelOpen: false });
            } else if (mergedState.publishing === false) {
                const hasPending = computePublishAvailability();
                const shouldStayOpen = hasPending && wasModeAvailable && wasPanelOpen;
                setSupAdminMode(hasPending ? 'available' : 'success', {
                    panelOpen: hasPending ? shouldStayOpen : false
                });
            }
        }
        if (!options.silent) {
            const message = rest.message ?? nestedState?.message;
            if (message && window.showToast) {
                const type = mergedState.publishing === false ? 'success' : 'info';
                window.showToast(message, type);
            }
        }
        refreshUpdateSummaries();
        persistState();
    }

    function handlePublishError(payload) {
        publishStartToastShown = false;
        const enriched = { ...(payload || {}), publishing: false };
        setPublishState(enriched, { silent: true, skipSupAdminMode: true });
        setSupAdminMode('error', { panelOpen: false, lastError: payload?.message });
        const errorMessage = payload?.message || 'Falha ao publicar atualização.';
        showPublishErrorDialog(errorMessage);
        const hasPending = computePublishAvailability();
        setSupAdminMode(hasPending ? 'available' : 'idle', { panelOpen: false });
    }

    function attachEvents() {
        if (eventsAttached) return;

        if (elements.user?.trigger) {
            elements.user.trigger.addEventListener('click', handleUserTriggerClick);
        }

        if (elements.user?.action) {
            elements.user.action.addEventListener('click', handleUserUpdateAction);
        }

        document.addEventListener('click', handleUserPanelDismiss);
        document.addEventListener('keydown', handleUserPanelKeydown);

        if (elements.supAdmin?.trigger) {
            elements.supAdmin.trigger.addEventListener('click', handleSupAdminTriggerClick);
        }

        if (elements.supAdmin?.publish) {
            elements.supAdmin.publish.addEventListener('click', handleSupAdminPublish);
        }

        if (window.electronAPI?.onUpdateStatus) {
            window.electronAPI.onUpdateStatus(payload => {
                const userInitiated = Boolean(
                    state.userInitiatedUpdate ||
                    state.userUpdateInProgress ||
                    state.userControl?.panelOpen
                );
                setUpdateStatus(payload, {
                    silent: !userInitiated,
                    userInitiatedUpdate: userInitiated
                });
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
            setUpdateStatus(restored.updateStatus, { silent: true, userInitiatedUpdate: false });
        } else {
            updateBadge();
            updateUserControlFromStatus();
        }
        if (restored.publishState) {
            setPublishState(restored.publishState, { silent: true });
        }
        applySupAdminState();
        applyUserState();
        updateContainerVisibility();
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

        applyModuleScrollBehavior(page);

        if (module) {
            module.dataset.page = page;
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
    if (!sidebarExpanded) {
        return;
    }

    const finalizeCollapse = () => {
        if (!sidebarExpanded) {
            sidebar.classList.remove('sidebar-text-visible');
        }
    };

    sidebar.addEventListener(
        'transitionend',
        (event) => {
            if (event.propertyName === 'width') {
                finalizeCollapse();
            }
        },
        { once: true }
    );

    requestAnimationFrame(() => {
        sidebar.classList.remove('sidebar-expanded');
        sidebar.classList.add('sidebar-collapsed');
    });

    mainContent.style.marginLeft = '64px';
    if (companyName) companyName.classList.add('collapsed');
    sidebarExpanded = false;

    setTimeout(finalizeCollapse, 250);
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
