(function () {
    const MODULE_NAME = 'dashboard';
    const formatterCache = new Map();

    function getFormatter(type, decimals = 0) {
        const key = `${type}:${decimals}`;
        if (formatterCache.has(key)) {
            return formatterCache.get(key);
        }

        let formatter;
        switch (type) {
            case 'currency':
                formatter = new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals,
                });
                break;
            case 'percent':
                formatter = new Intl.NumberFormat('pt-BR', {
                    style: 'percent',
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals,
                });
                break;
            default:
                formatter = new Intl.NumberFormat('pt-BR', {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals,
                });
        }

        formatterCache.set(key, formatter);
        return formatter;
    }

    function formatValue(value, element) {
        const type = element.dataset.metricFormat || 'number';
        const decimals = Number.parseInt(element.dataset.metricDecimals ?? '0', 10);
        const formatter = getFormatter(type, Number.isFinite(decimals) ? decimals : 0);
        return formatter.format(type === 'percent' ? value : Math.round(value * (10 ** decimals)) / (10 ** decimals));
    }

    function animateMetric(element, target, options = {}) {
        const duration = options.duration ?? 1200;
        const startValue = options.start ?? 0;
        const startTime = performance.now();

        function frame(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = startValue + (target - startValue) * eased;
            element.textContent = formatValue(current, element);
            if (progress < 1) {
                requestAnimationFrame(frame);
            }
        }

        requestAnimationFrame(frame);
    }

    function prepareMetrics(module) {
        const metrics = module.querySelectorAll('[data-metric-target]');
        metrics.forEach((metric) => {
            const target = Number.parseFloat(metric.dataset.metricTarget);
            if (!Number.isFinite(target)) {
                return;
            }
            const current = Number.parseFloat(metric.dataset.metricCurrent ?? '0');
            animateMetric(metric, target, { start: Number.isFinite(current) ? current : 0 });
            metric.dataset.metricCurrent = String(target);
        });
    }

    function randomWithinRange(base, variance) {
        const safeVariance = Number.isFinite(variance) ? Math.max(0, variance) : 0.12;
        const min = 1 - safeVariance * 0.4;
        const max = 1 + safeVariance * 0.6;
        const multiplier = min + Math.random() * (max - min);
        return base * multiplier;
    }

    function formatTrend(value, element) {
        const decimals = Number.parseInt(element.dataset.trendDecimals ?? '1', 10);
        const formatter = getFormatter(element.dataset.trendFormat || 'percent', Number.isFinite(decimals) ? decimals : 1);
        return formatter.format(Math.abs(value));
    }

    function updateTrend(element, value) {
        const label = element.dataset.trendLabel ? ` ${element.dataset.trendLabel}` : '';
        const positive = value >= 0;
        element.classList.toggle('positive', positive);
        element.classList.toggle('negative', !positive);
        const formatted = formatTrend(value, element);
        element.textContent = `${positive ? '+' : '−'}${formatted}${label}`;
        element.dataset.trendValue = String(value);
    }

    function refreshTrends(module, randomize = false) {
        module.querySelectorAll('[data-trend-format]').forEach((element) => {
            let value = Number.parseFloat(element.dataset.trendValue);
            if (!Number.isFinite(value) || randomize) {
                const variance = Number.parseFloat(element.dataset.trendVariance ?? '0.18');
                const safeVariance = Number.isFinite(variance) ? Math.max(0.02, variance) : 0.18;
                const min = -safeVariance * 0.5;
                const max = safeVariance * 0.8;
                value = min + Math.random() * (max - min);
            }
            updateTrend(element, value);
        });
    }

    const TIMELINE_SAMPLES = [
        {
            label: 'Produção',
            chipClass: 'chip-positive',
            title: 'Peças finalizadas na marcenaria',
            description: 'Oficina notificou que o lote Aurora está pronto para revisão.',
        },
        {
            label: 'CRM',
            chipClass: '',
            title: 'Novo contato premium',
            description: 'Lead originado por indicação da arquiteta parceira Juliana.',
        },
        {
            label: 'Logística',
            chipClass: 'chip-info',
            title: 'Roteiro de entrega otimizado',
            description: 'Equipe organizou entregas conjuntas para clientes de São Paulo.',
        },
        {
            label: 'Financeiro',
            chipClass: 'chip-warning',
            title: 'Negociação de condições',
            description: 'Cliente solicitou parcelamento especial para projeto corporativo.',
        },
    ];

    function createTimelineItem() {
        const template = document.createElement('li');
        const sample = TIMELINE_SAMPLES[Math.floor(Math.random() * TIMELINE_SAMPLES.length)];
        const time = new Date();
        const timeLabel = time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        template.innerHTML = `
            <span class="dashboard-timeline-time">${timeLabel}</span>
            <div>
                <p class="font-medium">${sample.title}</p>
                <p class="text-xs" style="color: var(--neutral-100)">${sample.description}</p>
            </div>
            <span class="dashboard-chip ${sample.chipClass}">${sample.label}</span>
        `;
        return template;
    }

    function updateTimeline(module) {
        const timeline = module.querySelector('[data-dashboard-timeline]');
        if (!timeline) {
            return;
        }
        const newItem = createTimelineItem();
        timeline.insertBefore(newItem, timeline.firstElementChild || null);
        const maxItems = 4;
        while (timeline.children.length > maxItems) {
            timeline.removeChild(timeline.lastElementChild);
        }
    }

    const ORDER_STATUS_CLASSES = [
        'dashboard-status--success',
        'dashboard-status--info',
        'dashboard-status--warning',
        'dashboard-status--neutral',
    ];

    const ORDER_STATUS_LABELS = [
        'Produção concluída',
        'Em produção',
        'Aguardando aprovação',
        'Separação de estoque',
        'Entrega agendada',
    ];

    function shuffleOrders(module) {
        const rows = module.querySelectorAll('[data-dashboard-orders] tr');
        rows.forEach((row, index) => {
            const statusCell = row.querySelector('.dashboard-status');
            if (!statusCell) return;
            const baseClass = ORDER_STATUS_CLASSES[index % ORDER_STATUS_CLASSES.length];
            ORDER_STATUS_CLASSES.forEach((cls) => statusCell.classList.remove(cls));
            const newClass = ORDER_STATUS_CLASSES[Math.floor(Math.random() * ORDER_STATUS_CLASSES.length)];
            statusCell.classList.add(newClass || baseClass);
            statusCell.textContent = ORDER_STATUS_LABELS[Math.floor(Math.random() * ORDER_STATUS_LABELS.length)];
        });
    }

    function updateLastSync(module) {
        const element = module.querySelector('[data-dashboard-last-sync]');
        if (!element) {
            return;
        }
        const now = new Date();
        element.innerHTML = `<i class="fas fa-clock text-xs"></i> Atualizado às ${now.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
        })}`;
    }

    function simulateUpdate(module) {
        module.querySelectorAll('[data-metric-target]').forEach((metric) => {
            const current = Number.parseFloat(metric.dataset.metricCurrent ?? metric.dataset.metricTarget ?? '0');
            const variance = Number.parseFloat(metric.dataset.metricVariance ?? '0.15');
            const nextValue = randomWithinRange(Math.max(current, 0.01), variance);
            metric.dataset.metricTarget = String(nextValue);
            animateMetric(metric, nextValue, { start: Number.isFinite(current) ? current : 0, duration: 900 });
            metric.dataset.metricCurrent = String(nextValue);
        });

        refreshTrends(module, true);
        updateTimeline(module);
        shuffleOrders(module);
        updateLastSync(module);
    }

    function attachRefresh(module) {
        const button = module.querySelector('[data-dashboard-action="refresh"]');
        if (!button) {
            return;
        }
        if (button.dataset.bound === 'true') {
            return;
        }
        button.dataset.bound = 'true';
        button.addEventListener('click', () => {
            button.disabled = true;
            button.classList.add('opacity-60');
            simulateUpdate(module);
            setTimeout(() => {
                button.disabled = false;
                button.classList.remove('opacity-60');
            }, 750);
        });
    }

    function initialiseDashboard() {
        const module = document.querySelector('#content .dashboard-module');
        if (!module) {
            return;
        }
        prepareMetrics(module);
        refreshTrends(module, false);
        attachRefresh(module);
        updateLastSync(module);
    }

    document.addEventListener('module-change', (event) => {
        if (event?.detail?.page !== MODULE_NAME) {
            return;
        }
        requestAnimationFrame(initialiseDashboard);
    });

    if (document.body.dataset.currentModule === MODULE_NAME) {
        requestAnimationFrame(initialiseDashboard);
    }
})();
