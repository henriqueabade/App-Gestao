(function () {
    const GLOBAL_REGISTRY = window.__geoMultiselectScripts = window.__geoMultiselectScripts || new Map();

    function findExistingScript(src) {
        const normalized = src.replace(/^[.\/]+/, '');
        return Array.from(document.getElementsByTagName('script')).find(script => {
            const current = script.getAttribute('src') || '';
            if (!current) return false;
            if (current === src) return true;
            if (current.endsWith(normalized)) return true;
            return current.includes(normalized);
        });
    }

    function loadScriptOnce(src) {
        if (GLOBAL_REGISTRY.has(src)) {
            return GLOBAL_REGISTRY.get(src);
        }

        const promise = new Promise((resolve, reject) => {
            const existing = findExistingScript(src);
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

        promise.catch(() => GLOBAL_REGISTRY.delete(src));
        GLOBAL_REGISTRY.set(src, promise);
        return promise;
    }

    async function ensureGeoService() {
        if (window.geoService) return window.geoService;
        await loadScriptOnce('../js/geo-service.js');
        return window.geoService;
    }

    function createHintElement(wrapper) {
        if (!wrapper) return null;
        let hint = wrapper.querySelector('.geo-multiselect-hint');
        if (!hint) {
            hint = document.createElement('p');
            hint.className = 'geo-multiselect-hint';
            wrapper.appendChild(hint);
        }
        return hint;
    }

    function showDependencyHint(trigger, message) {
        const wrapper = trigger.closest('[data-geo-wrapper]') || trigger.parentElement;
        const hint = createHintElement(wrapper);
        if (!hint) return;
        hint.textContent = message;
        hint.classList.add('visible');
        setTimeout(() => {
            if (hint.isConnected) {
                hint.classList.remove('visible');
            }
        }, 2800);
    }

    function formatSummary(labels, placeholder) {
        if (!labels || labels.length === 0) {
            return placeholder || 'Todos';
        }
        if (labels.length === 1) return labels[0];
        if (labels.length === 2) return labels.join(', ');
        return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
    }

    function updateSummary(entry) {
        if (!entry) return;
        const text = formatSummary(entry.labels, entry.placeholder);
        if (entry.summaryEl) {
            entry.summaryEl.textContent = text;
        }
        if (entry.hidden) {
            entry.hidden.value = entry.values.join(',');
        }
    }

    function updateDependentState(trigger, isDisabled) {
        if (!trigger) return;
        trigger.classList.toggle('geo-multiselect-disabled', isDisabled);
        trigger.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    }

    function buildSelectionDialog({ title, items, selectedValues }) {
        return new Promise(resolve => {
            const existingOverlay = document.querySelector('.geo-multiselect-overlay');
            if (existingOverlay && existingOverlay.isConnected) {
                existingOverlay.remove();
            }
            document.body.classList.remove('overflow-hidden');

            const overlay = document.createElement('div');
            overlay.className = 'geo-multiselect-overlay';

            const modal = document.createElement('div');
            modal.className = 'geo-multiselect-modal';
            overlay.appendChild(modal);

            const header = document.createElement('div');
            header.className = 'geo-multiselect-header';
            const heading = document.createElement('h3');
            heading.className = 'geo-multiselect-title';
            heading.textContent = title;
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'geo-multiselect-close';
            closeBtn.setAttribute('aria-label', 'Fechar seleção');
            closeBtn.innerHTML = '&times;';
            header.appendChild(heading);
            header.appendChild(closeBtn);
            modal.appendChild(header);

            const searchWrapper = document.createElement('div');
            searchWrapper.className = 'geo-multiselect-search';
            const searchInput = document.createElement('input');
            searchInput.type = 'search';
            searchInput.placeholder = 'Buscar...';
            searchInput.setAttribute('aria-label', 'Buscar item na lista');
            searchWrapper.appendChild(searchInput);
            modal.appendChild(searchWrapper);

            const selectAllWrapper = document.createElement('div');
            selectAllWrapper.className = 'geo-multiselect-select-all';
            const selectAllLabel = document.createElement('label');
            selectAllLabel.className = 'geo-multiselect-option geo-multiselect-option--inline';
            const selectAllCheckbox = document.createElement('input');
            selectAllCheckbox.type = 'checkbox';
            selectAllCheckbox.className = 'geo-multiselect-select-all-checkbox';
            const selectAllText = document.createElement('span');
            selectAllText.textContent = 'Selecionar todos';
            selectAllLabel.appendChild(selectAllCheckbox);
            selectAllLabel.appendChild(selectAllText);
            selectAllWrapper.appendChild(selectAllLabel);
            modal.appendChild(selectAllWrapper);

            const list = document.createElement('div');
            list.className = 'geo-multiselect-list';
            list.setAttribute('role', 'listbox');
            modal.appendChild(list);

            const emptyState = document.createElement('div');
            emptyState.className = 'geo-multiselect-empty hidden';
            emptyState.textContent = 'Nenhum resultado encontrado';
            modal.appendChild(emptyState);

            const footer = document.createElement('div');
            footer.className = 'geo-multiselect-footer';
            const counter = document.createElement('span');
            counter.className = 'geo-multiselect-counter';
            counter.textContent = 'Nenhuma seleção';
            const actions = document.createElement('div');
            actions.className = 'geo-multiselect-actions';
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'geo-multiselect-btn cancel';
            cancelBtn.textContent = 'Cancelar';
            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className = 'geo-multiselect-btn confirm';
            confirmBtn.textContent = 'Aplicar';
            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);
            footer.appendChild(counter);
            footer.appendChild(actions);
            modal.appendChild(footer);

            const optionEntries = [];
            const groupMap = new Map();

            items.forEach(item => {
                let headerEl = null;
                if (item.group) {
                    if (!groupMap.has(item.group)) {
                        const groupHeader = document.createElement('div');
                        groupHeader.className = 'geo-multiselect-group-label';
                        groupHeader.textContent = item.group;
                        list.appendChild(groupHeader);
                        groupMap.set(item.group, { element: groupHeader, options: [] });
                    }
                    headerEl = groupMap.get(item.group).element;
                }

                const option = document.createElement('label');
                option.className = 'geo-multiselect-option';
                option.setAttribute('role', 'option');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = item.value;
                if (selectedValues.includes(item.value)) {
                    checkbox.checked = true;
                }
                const text = document.createElement('span');
                text.textContent = item.label;
                option.appendChild(checkbox);
                option.appendChild(text);
                list.appendChild(option);

                const entry = {
                    item,
                    option,
                    checkbox,
                    headerEl,
                    search: `${item.label} ${(item.group || '')}`.toLowerCase()
                };
                optionEntries.push(entry);
                if (item.group) {
                    const groupEntry = groupMap.get(item.group);
                    groupEntry.options.push(entry);
                }
            });

            if (!optionEntries.length) {
                emptyState.classList.remove('hidden');
                selectAllWrapper.classList.add('hidden');
                confirmBtn.disabled = false;
            }

            function updateSelectAllState() {
                const visibleOptions = optionEntries.filter(entry => !entry.option.classList.contains('hidden'));
                const visibleCount = visibleOptions.length;
                const selectedVisible = visibleOptions.filter(entry => entry.checkbox.checked).length;
                selectAllCheckbox.disabled = visibleCount === 0;
                selectAllCheckbox.indeterminate = visibleCount > 0 && selectedVisible > 0 && selectedVisible < visibleCount;
                selectAllCheckbox.checked = visibleCount > 0 && selectedVisible === visibleCount;
            }

            function updateGroupsVisibility() {
                groupMap.forEach(({ element, options }) => {
                    const anyVisible = options.some(entry => !entry.option.classList.contains('hidden'));
                    element.classList.toggle('hidden', !anyVisible);
                });
            }

            function updateEmptyState() {
                const anyVisible = optionEntries.some(entry => !entry.option.classList.contains('hidden'));
                emptyState.classList.toggle('hidden', anyVisible);
            }

            function updateCounter() {
                const selectedCount = optionEntries.filter(entry => entry.checkbox.checked).length;
                counter.textContent = selectedCount
                    ? `${selectedCount} selecionado${selectedCount > 1 ? 's' : ''}`
                    : 'Nenhuma seleção';
                confirmBtn.textContent = selectedCount ? `Aplicar (${selectedCount})` : 'Aplicar';
            }

            function applyFilter(term) {
                const query = term.trim().toLowerCase();
                optionEntries.forEach(entry => {
                    const matches = !query || entry.search.includes(query);
                    entry.option.classList.toggle('hidden', !matches);
                });
                updateGroupsVisibility();
                updateSelectAllState();
                updateEmptyState();
            }

            const onCheckboxChange = () => {
                updateCounter();
                updateSelectAllState();
            };

            optionEntries.forEach(entry => {
                entry.checkbox.addEventListener('change', onCheckboxChange);
            });

            searchInput.addEventListener('input', () => {
                applyFilter(searchInput.value);
            });

            selectAllCheckbox.addEventListener('change', () => {
                const { checked } = selectAllCheckbox;
                optionEntries.forEach(entry => {
                    if (!entry.option.classList.contains('hidden')) {
                        entry.checkbox.checked = checked;
                    }
                });
                updateCounter();
                updateSelectAllState();
            });

            const closeDialog = result => {
                document.removeEventListener('keydown', handleKeydown);
                overlay.removeEventListener('click', handleOverlayClick);
                optionEntries.forEach(entry => {
                    entry.checkbox.removeEventListener('change', onCheckboxChange);
                });
                if (overlay.isConnected) {
                    overlay.remove();
                }
                if (!document.querySelector('.geo-multiselect-overlay')) {
                    document.body.classList.remove('overflow-hidden');
                }
                resolve(result);
            };

            const handleOverlayClick = event => {
                if (event.target === overlay) {
                    closeDialog(null);
                }
            };

            const handleKeydown = event => {
                if (event.key === 'Escape') {
                    closeDialog(null);
                }
            };

            cancelBtn.addEventListener('click', () => closeDialog(null));
            closeBtn.addEventListener('click', () => closeDialog(null));
            confirmBtn.addEventListener('click', () => {
                const selectedItems = optionEntries
                    .filter(entry => entry.checkbox.checked)
                    .map(entry => entry.item);
                closeDialog({
                    values: selectedItems.map(item => item.value),
                    items: selectedItems
                });
            });

            overlay.addEventListener('click', handleOverlayClick);
            document.addEventListener('keydown', handleKeydown);

            document.body.appendChild(overlay);
            document.body.classList.add('overflow-hidden');

            applyFilter('');
            updateCounter();
        });
    }

    async function openMultiselect(trigger, entry, dependency, dependencyEntry) {
        const source = trigger.dataset.geoSource || 'countries';
        const title = trigger.dataset.geoTitle || (source === 'states' ? 'Selecionar estados' : 'Selecionar países');
        const dependencyMessage = trigger.dataset.geoDependencyMessage || 'Selecione um valor anterior.';

        if (dependency && (!dependencyEntry || !dependencyEntry.values.length)) {
            showDependencyHint(trigger, dependencyMessage);
            return null;
        }

        let items = [];
        if (source === 'countries') {
            const geo = await ensureGeoService();
            const countries = await geo.getCountries();
            items = countries.map(country => ({
                value: country.code,
                label: country.name
            }));
        } else if (source === 'states') {
            const geo = await ensureGeoService();
            if (!dependencyEntry || !dependencyEntry.values.length) {
                showDependencyHint(trigger, dependencyMessage);
                return null;
            }
            for (const code of dependencyEntry.values) {
                const states = await geo.getStatesByCountry(code);
                const countryName = dependencyEntry.labelMap?.get(code) || code;
                states.forEach(state => {
                    items.push({
                        value: `${code}:${state.code}`,
                        label: state.name,
                        group: countryName
                    });
                });
            }
        } else {
            return null;
        }

        const dialogResult = await buildSelectionDialog({
            title,
            items,
            selectedValues: entry.values.slice()
        });

        if (!dialogResult) return null;

        const labels = dialogResult.items.map(item => {
            if (item.group) {
                return `${item.label} — ${item.group}`;
            }
            return item.label;
        });

        return {
            values: dialogResult.values,
            labels,
            rawItems: dialogResult.items
        };
    }

    function initInContainer(root, options = {}) {
        if (!root) return null;
        const triggers = Array.from(root.querySelectorAll('[data-geo-multiselect]'));
        if (!triggers.length) return null;

        const state = new Map();
        const dependents = new Map();

        const emitChange = entry => {
            if (!entry || typeof options.onChange !== 'function') return;
            const items = Array.isArray(entry.rawItems)
                ? entry.rawItems.map(item => ({ ...item }))
                : [];
            options.onChange({
                key: entry.key,
                values: entry.values.slice(),
                labels: entry.labels.slice(),
                items
            });
        };

        const applyEntrySelection = (entry, { silent = false } = {}) => {
            if (!entry) return;
            updateSummary(entry);
            if (!silent) {
                emitChange(entry);
            }

            const dependentKeys = dependents.get(entry.key) || [];
            dependentKeys.forEach(depKey => {
                const depEntry = state.get(depKey);
                if (!depEntry) return;
                const shouldDisable = entry.values.length === 0;
                updateDependentState(depEntry.trigger, shouldDisable);
                if (depEntry.values.length) {
                    depEntry.values = [];
                    depEntry.labels = [];
                    depEntry.rawItems = [];
                    depEntry.labelMap.clear();
                    applyEntrySelection(depEntry, { silent });
                } else if (shouldDisable) {
                    depEntry.labelMap.clear();
                    applyEntrySelection(depEntry, { silent });
                }
            });
        };

        triggers.forEach(trigger => {
            const key = trigger.dataset.geoMultiselect;
            if (!key || state.has(key)) return;
            const summaryEl = trigger.querySelector('[data-geo-summary]') || trigger;
            const placeholder = trigger.dataset.geoPlaceholder || 'Todos';
            const hidden = root.querySelector(`[data-geo-input="${key}"]`) || (() => {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.setAttribute('data-geo-input', key);
                trigger.insertAdjacentElement('afterend', input);
                return input;
            })();

            const entry = {
                key,
                trigger,
                summaryEl,
                placeholder,
                hidden,
                values: [],
                labels: [],
                rawItems: [],
                labelMap: new Map()
            };
            state.set(key, entry);

            const dependsOn = trigger.dataset.geoDependsOn;
            if (dependsOn) {
                if (!dependents.has(dependsOn)) {
                    dependents.set(dependsOn, []);
                }
                dependents.get(dependsOn).push(key);
                const dependencyEntry = state.get(dependsOn);
                updateDependentState(trigger, !(dependencyEntry && dependencyEntry.values.length));
            } else {
                updateDependentState(trigger, false);
            }

            trigger.addEventListener('click', async () => {
                const dependencyKey = trigger.dataset.geoDependsOn;
                const dependencyEntry = dependencyKey ? state.get(dependencyKey) : null;
                const selection = await openMultiselect(trigger, entry, dependencyKey, dependencyEntry);
                if (!selection) return;

                entry.values = selection.values;
                entry.labels = selection.labels;
                entry.rawItems = selection.rawItems;
                entry.labelMap.clear();
                if (entry.rawItems.length) {
                    entry.rawItems.forEach(item => {
                        entry.labelMap.set(item.value, item.label);
                    });
                }

                applyEntrySelection(entry);
            });

            applyEntrySelection(entry, { silent: true });
        });

        return {
            getSelection(key) {
                const entry = state.get(key);
                if (!entry) return { values: [], labels: [], items: [] };
                return {
                    values: entry.values.slice(),
                    labels: entry.labels.slice(),
                    items: entry.rawItems.map(item => ({ ...item }))
                };
            },
            resetSelection(key) {
                const entry = state.get(key);
                if (!entry) return { values: [], labels: [], items: [] };
                entry.values = [];
                entry.labels = [];
                entry.rawItems = [];
                entry.labelMap.clear();
                applyEntrySelection(entry);
                return { values: [], labels: [], items: [] };
            },
            resetAll() {
                state.forEach(entry => {
                    entry.values = [];
                    entry.labels = [];
                    entry.rawItems = [];
                    entry.labelMap.clear();
                    applyEntrySelection(entry);
                });
            }
        };
    }

    window.GeoMultiSelect = window.GeoMultiSelect || {};
    window.GeoMultiSelect.initInContainer = initInContainer;
    window.GeoMultiSelect.ensureGeoService = ensureGeoService;
    window.GeoMultiSelect._loadScriptOnce = loadScriptOnce;
})();
