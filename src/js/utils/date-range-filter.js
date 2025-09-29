(function () {
    const STORAGE_PREFIX = 'app-gestao:date-range:';

    function parseDateInput(value) {
        if (!value || typeof value !== 'string' || !value.includes('-')) return null;
        const [year, month, day] = value.split('-').map(Number);
        if (!year || !month || !day) return null;
        const date = new Date(year, month - 1, day);
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function formatDisplayDate(isoDate) {
        if (!isoDate || typeof isoDate !== 'string' || !isoDate.includes('-')) return '';
        const [year, month, day] = isoDate.split('-');
        return `${day}/${month}/${year}`;
    }

    function safeLocalStorageSet(key, value) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (err) {
            console.warn('Não foi possível salvar o intervalo personalizado.', err);
        }
    }

    function safeLocalStorageGet(key) {
        try {
            if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            }
        } catch (err) {
            console.warn('Não foi possível carregar o intervalo personalizado.', err);
        }
        return null;
    }

    function initDateRangeFilter({ selectElement, moduleKey, onApply, getRange, setRange }) {
        if (!selectElement) return null;

        const storageKey = `${STORAGE_PREFIX}${moduleKey || 'default'}`;
        const customOption = selectElement.querySelector('option[value="Personalizado"]');
        const host = document.getElementById('content') || selectElement.closest('.modulo-container') || document.body;
        const hostComputed = window.getComputedStyle(host);
        if (hostComputed.position === 'static') {
            host.style.position = 'relative';
        }

        const savedState = safeLocalStorageGet(storageKey);
        const storedRange = savedState && savedState.start && savedState.end
            ? { start: savedState.start, end: savedState.end }
            : null;

        let lastStoredRange = storedRange;
        let lastAppliedRange = null;
        let isPopoverOpen = false;

        const popover = document.createElement('div');
        popover.className = 'date-range-popover glass-surface backdrop-blur-xl text-white';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-modal', 'false');
        popover.style.position = 'absolute';
        popover.style.zIndex = '1400';
        popover.style.minWidth = '280px';
        popover.style.padding = '16px';
        popover.style.borderRadius = '16px';
        popover.style.boxShadow = '0 18px 48px rgba(8, 6, 20, 0.45)';
        popover.style.background = 'rgba(24, 22, 40, 0.95)';
        popover.style.border = '1px solid rgba(255, 255, 255, 0.08)';
        popover.style.display = 'none';
        popover.style.opacity = '0';

        const fieldsWrapper = document.createElement('div');
        fieldsWrapper.className = 'flex flex-col md:flex-row gap-4';

        const startWrapper = document.createElement('div');
        startWrapper.className = 'flex-1';
        const startLabel = document.createElement('label');
        startLabel.className = 'block text-xs font-semibold tracking-wide uppercase mb-2 text-white/70';
        startLabel.textContent = 'Data inicial';
        const startInput = document.createElement('input');
        startInput.type = 'date';
        startInput.className = 'input-glass w-full text-white rounded-lg px-3 py-2 bg-white/10 focus:outline-none';
        startInput.setAttribute('aria-label', 'Data inicial do período');
        startInput.setAttribute('autocomplete', 'off');
        startWrapper.appendChild(startLabel);
        startWrapper.appendChild(startInput);

        const endWrapper = document.createElement('div');
        endWrapper.className = 'flex-1';
        const endLabel = document.createElement('label');
        endLabel.className = 'block text-xs font-semibold tracking-wide uppercase mb-2 text-white/70';
        endLabel.textContent = 'Data final';
        const endInput = document.createElement('input');
        endInput.type = 'date';
        endInput.className = 'input-glass w-full text-white rounded-lg px-3 py-2 bg-white/10 focus:outline-none';
        endInput.setAttribute('aria-label', 'Data final do período');
        endInput.setAttribute('autocomplete', 'off');
        endWrapper.appendChild(endLabel);
        endWrapper.appendChild(endInput);

        fieldsWrapper.appendChild(startWrapper);
        fieldsWrapper.appendChild(endWrapper);

        const helperText = document.createElement('p');
        helperText.className = 'text-xs text-white/60 mt-3';
        helperText.textContent = 'Selecione o intervalo desejado e confirme para aplicar.';

        const errorMessage = document.createElement('p');
        errorMessage.className = 'text-xs text-[var(--color-warning)] mt-2 hidden';
        errorMessage.setAttribute('role', 'alert');

        const actions = document.createElement('div');
        actions.className = 'flex justify-end gap-2 mt-4';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'btn-neutral text-white px-4 py-2 rounded-lg';
        cancelButton.textContent = 'Cancelar';
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'btn-primary text-white px-4 py-2 rounded-lg';
        confirmButton.textContent = 'Confirmar';
        confirmButton.disabled = true;
        confirmButton.setAttribute('aria-disabled', 'true');
        confirmButton.style.opacity = '0.6';
        confirmButton.style.cursor = 'not-allowed';
        actions.appendChild(cancelButton);
        actions.appendChild(confirmButton);

        popover.appendChild(fieldsWrapper);
        popover.appendChild(helperText);
        popover.appendChild(errorMessage);
        popover.appendChild(actions);
        host.appendChild(popover);

        function highlightInput(input, active) {
            if (active) {
                input.style.boxShadow = '0 0 0 2px rgba(255, 215, 0, 0.55)';
            } else {
                input.style.boxShadow = '';
            }
        }

        function updateCustomOptionLabel(range, isActive) {
            // Formata o rótulo do seletor com o intervalo ativo
            if (!customOption) return;
            if (range?.start && range?.end && isActive) {
                customOption.textContent = `${formatDisplayDate(range.start)} — ${formatDisplayDate(range.end)}`;
            } else {
                customOption.textContent = 'Personalizado';
            }
        }

        function persistState(range, isActive) {
            const payload = {
                start: range?.start && range?.end ? range.start : (lastStoredRange?.start || ''),
                end: range?.start && range?.end ? range.end : (lastStoredRange?.end || ''),
                active: !!isActive
            };
            safeLocalStorageSet(storageKey, payload);
        }

        function evaluateRange() {
            // Realiza a validação básica das datas informadas
            const startValue = startInput.value;
            const endValue = endInput.value;
            if (!startValue || !endValue) {
                return { valid: false, reason: 'missing' };
            }
            const startDate = parseDateInput(startValue);
            const endDate = parseDateInput(endValue);
            if (!startDate || !endDate) {
                return { valid: false, reason: 'missing' };
            }
            if (startDate > endDate) {
                return { valid: false, reason: 'order', start: startValue, end: endValue };
            }
            return { valid: true, start: startValue, end: endValue };
        }

        function clearError() {
            errorMessage.textContent = '';
            errorMessage.classList.add('hidden');
        }

        function showError(message) {
            errorMessage.textContent = message;
            errorMessage.classList.remove('hidden');
        }

        function syncConfirmState(showFeedback = false) {
            const validation = evaluateRange();
            confirmButton.disabled = !validation.valid;
            confirmButton.setAttribute('aria-disabled', validation.valid ? 'false' : 'true');
            confirmButton.style.opacity = validation.valid ? '1' : '0.6';
            confirmButton.style.cursor = validation.valid ? 'pointer' : 'not-allowed';

            if (validation.valid) {
                clearError();
            } else if (showFeedback && validation.reason === 'missing') {
                showError('Informe a data inicial e final.');
            } else if (showFeedback && validation.reason === 'order') {
                showError('A data inicial deve ser menor ou igual à data final.');
            } else if (!showFeedback && validation.reason !== 'order') {
                clearError();
            }
            return validation;
        }

        function positionPopover() {
            if (!isPopoverOpen) return;
            const selectRect = selectElement.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            const relativeTop = selectRect.bottom - hostRect.top + host.scrollTop + 8;
            let relativeLeft = selectRect.left - hostRect.left + host.scrollLeft;
            popover.style.top = `${relativeTop}px`;
            popover.style.left = `${Math.max(relativeLeft, 0)}px`;
            const overflow = relativeLeft + popover.offsetWidth - host.clientWidth;
            if (overflow > 0) {
                relativeLeft = Math.max(relativeLeft - overflow - 16, 0);
                popover.style.left = `${relativeLeft}px`;
            }
        }

        function openPopover(previousValue) {
            // Controla a abertura do popover e prepara os campos com o último intervalo
            if (isPopoverOpen) return;
            isPopoverOpen = true;
            const currentRange = (getRange && getRange()) || lastStoredRange;
            if (currentRange?.start) startInput.value = currentRange.start; else startInput.value = '';
            if (currentRange?.end) endInput.value = currentRange.end; else endInput.value = '';
            clearError();
            syncConfirmState();
            popover.style.display = 'block';
            popover.setAttribute('aria-hidden', 'false');
            requestAnimationFrame(() => {
                popover.style.opacity = '1';
                positionPopover();
                startInput.focus({ preventScroll: true });
            });
            document.addEventListener('mousedown', handleOutsideClick, true);
            window.addEventListener('resize', positionPopover);
            host.addEventListener('scroll', positionPopover, true);
        }

        function closePopover({ restoreSelection = false } = {}) {
            // Controla o fechamento do popover e restaura o seletor se necessário
            if (!isPopoverOpen) return;
            isPopoverOpen = false;
            popover.style.opacity = '0';
            popover.setAttribute('aria-hidden', 'true');
            setTimeout(() => {
                if (!isPopoverOpen) {
                    popover.style.display = 'none';
                }
            }, 150);
            document.removeEventListener('mousedown', handleOutsideClick, true);
            window.removeEventListener('resize', positionPopover);
            host.removeEventListener('scroll', positionPopover, true);
            if (restoreSelection) {
                selectElement.value = selectElement.dataset.currentValue || '';
            }
        }

        function handleOutsideClick(event) {
            if (!popover.contains(event.target) && event.target !== selectElement) {
                closePopover({ restoreSelection: true });
            }
        }

        function applyRange(range) {
            lastAppliedRange = range;
            if (typeof setRange === 'function') {
                setRange(range);
            }
            persistState(range, true);
            selectElement.dataset.customActive = 'true';
            selectElement.dataset.currentValue = 'Personalizado';
            selectElement.dataset.shouldApplyOnLoad = 'true';
            selectElement.value = 'Personalizado';
            updateCustomOptionLabel(range, true);
            // Dispara a recarga/listagem com o novo intervalo confirmado
            if (typeof onApply === 'function') {
                onApply(range);
            }
        }

        function handleConfirm() {
            const validation = syncConfirmState(true);
            if (!validation.valid) return;
            const range = { start: validation.start, end: validation.end };
            lastStoredRange = range;
            applyRange(range);
            closePopover();
        }

        function handleCancel() {
            closePopover({ restoreSelection: true });
        }

        function handleKeyDown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePopover({ restoreSelection: true });
            } else if (event.key === 'Enter' && !confirmButton.disabled) {
                event.preventDefault();
                handleConfirm();
            }
        }

        startInput.addEventListener('focus', () => highlightInput(startInput, true));
        startInput.addEventListener('blur', () => highlightInput(startInput, false));
        endInput.addEventListener('focus', () => highlightInput(endInput, true));
        endInput.addEventListener('blur', () => highlightInput(endInput, false));

        startInput.addEventListener('input', () => syncConfirmState());
        endInput.addEventListener('input', () => syncConfirmState());
        startInput.addEventListener('keydown', handleKeyDown);
        endInput.addEventListener('keydown', handleKeyDown);
        confirmButton.addEventListener('keydown', handleKeyDown);
        cancelButton.addEventListener('keydown', handleKeyDown);

        confirmButton.addEventListener('click', handleConfirm);
        cancelButton.addEventListener('click', handleCancel);

        selectElement.setAttribute('aria-haspopup', 'dialog');
        selectElement.dataset.currentValue = selectElement.value || '';

        selectElement.addEventListener('change', () => {
            const selected = selectElement.value;
            const previous = selectElement.dataset.currentValue || '';
            if (selected === 'Personalizado') {
                openPopover(previous);
                selectElement.value = previous;
            } else {
                selectElement.dataset.currentValue = selected;
                selectElement.dataset.customActive = '';
                selectElement.dataset.shouldApplyOnLoad = '';
                if (typeof setRange === 'function') {
                    setRange(null);
                }
                updateCustomOptionLabel(lastAppliedRange, false);
                persistState(lastStoredRange, false);
                if (typeof onApply === 'function') {
                    onApply(selected);
                }
            }
        });

        selectElement.addEventListener('click', () => {
            if (selectElement.dataset.customActive === 'true') {
                openPopover('Personalizado');
            }
        });

        if (savedState?.active && lastStoredRange) {
            lastAppliedRange = lastStoredRange;
            if (typeof setRange === 'function') {
                setRange(lastStoredRange);
            }
            selectElement.value = 'Personalizado';
            selectElement.dataset.currentValue = 'Personalizado';
            selectElement.dataset.customActive = 'true';
            selectElement.dataset.shouldApplyOnLoad = 'true';
            updateCustomOptionLabel(lastStoredRange, true);
        } else {
            updateCustomOptionLabel(null, false);
            if (typeof setRange === 'function') {
                setRange(null);
            }
        }

        return {
            clear(keepStoredRange = true) {
                selectElement.dataset.customActive = '';
                selectElement.dataset.shouldApplyOnLoad = '';
                selectElement.dataset.currentValue = '';
                selectElement.value = '';
                if (!keepStoredRange) {
                    lastStoredRange = null;
                }
                lastAppliedRange = null;
                if (typeof setRange === 'function') {
                    setRange(null);
                }
                updateCustomOptionLabel(keepStoredRange ? lastStoredRange : null, false);
                persistState(keepStoredRange ? lastStoredRange : null, false);
            },
            refreshLabel() {
                updateCustomOptionLabel(lastAppliedRange, selectElement.dataset.customActive === 'true');
            }
        };
    }

    window.DateRangeFilter = Object.assign({}, window.DateRangeFilter, {
        initDateRangeFilter
    });
})();
