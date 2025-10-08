// Lógica de interação para o módulo de Relatórios
const RELATORIOS_API_BASE_URL = 'http://localhost:3000';
const BADGE_CLASS_MAP = {
    success: 'badge-success',
    warning: 'badge-warning',
    danger: 'badge-danger',
    info: 'badge-info',
    neutral: 'badge-neutral',
    secondary: 'badge-secondary',
    light: 'badge-light'
};

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numberFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

const AVATAR_COLORS = [
    'var(--color-primary)',
    'var(--color-violet)',
    '#0ea5e9',
    '#f97316',
    '#10b981',
    '#8b5cf6',
    '#ef4444',
    '#f59e0b'
];

const reportDataCache = new Map();
const reportDataPromises = new Map();
const reportTableRenderers = new Map();
const filterDefaults = new Map();
const reportVisibleColumns = new Map();
const COLUMN_VISIBILITY_STORAGE_PREFIX = 'relatorios-visible-columns';
let relatoriosKpiManager = null;
let jsPdfLoaderPromise = null;

function showRelatoriosToast(message, type = 'info') {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(message, type);
        return;
    }
    if (type === 'error') {
        console.error(message);
    } else {
        console.log(message);
    }
}

function getColumnStorageKey(key) {
    return `${COLUMN_VISIBILITY_STORAGE_PREFIX}:${key}`;
}

function loadStoredVisibleColumns(key, config) {
    if (!config?.columns?.length) return [];
    try {
        if (typeof window === 'undefined' || !window.localStorage) return [];
        const raw = window.localStorage.getItem(getColumnStorageKey(key));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const allowed = new Set(config.columns.map(column => column.key));
        return parsed.filter(columnKey => allowed.has(columnKey));
    } catch (error) {
        console.warn('Não foi possível carregar preferências de colunas do relatório.', error);
        return [];
    }
}

function persistVisibleColumns(key) {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        const set = reportVisibleColumns.get(key);
        if (!set) {
            window.localStorage.removeItem(getColumnStorageKey(key));
            return;
        }
        window.localStorage.setItem(getColumnStorageKey(key), JSON.stringify(Array.from(set)));
    } catch (error) {
        console.warn('Não foi possível salvar preferências de colunas do relatório.', error);
    }
}

function clearStoredVisibleColumns(key) {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.removeItem(getColumnStorageKey(key));
    } catch (error) {
        console.warn('Não foi possível limpar preferências de colunas do relatório.', error);
    }
}

function initializeReportColumns(key, config = REPORT_CONFIGS?.[key]) {
    if (!config?.columns?.length || reportVisibleColumns.has(key)) return;
    const defaultKeys = config.columns.map(column => column.key).filter(Boolean);
    if (!defaultKeys.length) return;
    const stored = loadStoredVisibleColumns(key, config);
    const initial = stored.length ? stored : defaultKeys;
    reportVisibleColumns.set(key, new Set(initial));
}

function initializeAllReportColumns() {
    if (!REPORT_CONFIGS) return;
    Object.entries(REPORT_CONFIGS).forEach(([key, config]) => {
        initializeReportColumns(key, config);
    });
}

function getVisibleColumnKeys(key) {
    initializeReportColumns(key);
    const set = reportVisibleColumns.get(key);
    return set ? Array.from(set) : [];
}

function setVisibleColumns(key, columnKeys) {
    const config = REPORT_CONFIGS?.[key];
    if (!config?.columns?.length) return false;
    initializeReportColumns(key, config);
    const allowed = new Set(config.columns.map(column => column.key));
    const filtered = Array.from(new Set(columnKeys)).filter(columnKey => allowed.has(columnKey));
    if (!filtered.length) return false;
    reportVisibleColumns.set(key, new Set(filtered));
    persistVisibleColumns(key);
    return true;
}

function setColumnVisibility(key, columnKey, isVisible) {
    const config = REPORT_CONFIGS?.[key];
    if (!config?.columns?.length) return false;
    initializeReportColumns(key, config);
    const allowed = new Set(config.columns.map(column => column.key));
    if (!allowed.has(columnKey)) return false;
    const current = new Set(reportVisibleColumns.get(key) || []);
    if (!isVisible) {
        if (!current.has(columnKey)) return false;
        if (current.size <= 1) return false;
        current.delete(columnKey);
    } else {
        current.add(columnKey);
    }
    reportVisibleColumns.set(key, current);
    persistVisibleColumns(key);
    return true;
}

function resetReportColumnsToDefault(key) {
    const config = REPORT_CONFIGS?.[key];
    if (!config?.columns?.length) return;
    reportVisibleColumns.delete(key);
    clearStoredVisibleColumns(key);
    initializeReportColumns(key, config);
}

function applyColumnVisibilityToTable(key, root) {
    if (!root) return;
    const config = REPORT_CONFIGS?.[key];
    if (!config?.columns?.length) return;
    initializeReportColumns(key, config);
    const visibleSet = new Set(getVisibleColumnKeys(key));
    if (!visibleSet.size) return;

    const table = root.matches?.('table') ? root : root.querySelector('table');
    if (!table) return;

    const toggleElement = element => {
        if (!element) return;
        const columnKey = element.dataset.columnKey;
        if (!columnKey) return;
        element.classList.toggle('hidden', !visibleSet.has(columnKey));
    };

    table.querySelectorAll('thead [data-column-key]').forEach(toggleElement);
    table.querySelectorAll('tbody [data-column-key]').forEach(toggleElement);
}

if (typeof window !== 'undefined') {
    window.RelatoriosColumnVisibility = {
        getVisibleColumns: getVisibleColumnKeys,
        setVisibleColumns,
        setColumnVisibility
    };
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function formatText(value, fallback = '—') {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text ? escapeHtml(text) : fallback;
}

function formatCurrency(value, { fallback = 'R$ 0,00' } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return currencyFormatter.format(number);
}

function formatNumber(value, { fallback = '—', formatter = numberFormatter } = {}) {
    if (value === Infinity) return '∞';
    if (value === -Infinity) return '-∞';
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return formatter.format(number);
}

function formatPercent(value, { fallback = '—' } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return `${percentFormatter.format(number)}%`;
}

function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function formatDate(value) {
    if (!value) return '—';
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return '—';
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleDateString('pt-BR');
        }
        return trimmed;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('pt-BR');
}

function createBadge(label, variant = 'neutral', options = {}) {
    const { size = 'md', className = '' } = options;
    const baseClass = BADGE_CLASS_MAP[variant] || BADGE_CLASS_MAP.neutral;
    const sizeClass = size === 'sm' ? 'px-2 py-1' : 'px-3 py-1';
    const classes = `${baseClass} ${sizeClass} rounded-full text-xs font-medium${className ? ` ${className}` : ''}`.trim();
    return `<span class="${classes}">${escapeHtml(label)}</span>`;
}

function getColumnCount(table) {
    if (!table) return 1;
    const headers = table.querySelectorAll('thead th');
    return headers.length || 1;
}

function createMessageRow(table, message, options = {}) {
    const { className = 'px-6 py-6 text-center text-sm text-white/70', allowHtml = false } = options;
    const colspan = getColumnCount(table);
    const content = allowHtml ? message : escapeHtml(message);
    return `<tr><td colspan="${colspan}" class="${className}">${content}</td></tr>`;
}

function getExportColumns(key) {
    const config = REPORT_CONFIGS?.[key];
    if (!config?.columns?.length) return [];
    const visibleSet = new Set(getVisibleColumnKeys(key));
    if (!visibleSet.size) return [];
    return config.columns.filter(column => visibleSet.has(column.key));
}

function sanitizeTableCellText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim();
}

function collectTableDataForExport(root, key) {
    if (!root || !key) return null;
    const tableContainer = root.querySelector('#relatoriosTableContainer');
    if (!tableContainer) return null;
    const tableRoot = tableContainer.querySelector('[data-relatorios-table-root]') || tableContainer;
    const table = tableRoot.querySelector('table');
    const tbody = table?.querySelector('tbody');
    if (!table || !tbody) return null;

    const columns = getExportColumns(key);
    if (!columns.length) return null;

    const dataRows = Array.from(tbody.querySelectorAll('tr')).filter(row => row.querySelector('[data-column-key]'));
    const headers = columns.map(column => column.label || column.key || '');
    const rows = dataRows.map(row => columns.map(column => {
        const cell = row.querySelector(`[data-column-key="${column.key}"]`);
        if (!cell || cell.classList.contains('hidden')) return '';
        return sanitizeTableCellText(cell.textContent);
    }));

    return { columns, headers, rows, table, tbody };
}

function createFileSafeSlug(value) {
    const normalized = normalizeText(value)
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/(^-|-$)/g, '');
    return normalized || 'relatorio';
}

function createReportTitle(root, key) {
    if (!root) return 'Relatório';
    const button = root.querySelector(`[data-relatorios-tab="${key}"]`);
    const label = button ? sanitizeTableCellText(button.textContent) : '';
    const title = label ? `Relatório - ${label}` : 'Relatório';
    return title;
}

function createReportFileName(key, title, extension) {
    const base = title || key || 'relatorio';
    const slug = createFileSafeSlug(base);
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 19).replace(/:/g, '-');
    return `${slug}-${date}-${time}.${extension}`;
}

function createCsvContent(headers, rows) {
    const escapeValue = value => {
        const text = value === null || value === undefined ? '' : String(value);
        const escaped = text.replace(/"/g, '""');
        return `"${escaped}"`;
    };
    const headerRow = headers.map(escapeValue).join(';');
    const dataRows = rows.map(row => row.map(escapeValue).join(';'));
    return `\ufeff${[headerRow, ...dataRows].join('\n')}`;
}

function buildHtmlTable(headers, rows) {
    const headerHtml = headers
        .map(header => `<th>${escapeHtml(header ?? '')}</th>`)
        .join('');
    const bodyHtml = rows
        .map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell ?? '')}</td>`).join('')}</tr>`)
        .join('');
    return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

const REPORT_PT_TO_PX = 96 / 72;
const REPORT_MM_TO_PX = 96 / 25.4;

function calculateReportLayout(headers, rows, options = {}) {
    const normalizedHeaders = Array.isArray(headers) ? headers : [];
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const columnCount = normalizedHeaders.length;
    const {
        availableWidth = 0,
        baseFontSize = 11,
        minFontSize = 8,
        maxFontSize = 13,
        minColumnWidth = 64,
        cellPaddingX = 12,
        measureText
    } = options;

    if (!columnCount) {
        return {
            columnWidths: [],
            tableWidth: 0,
            fontSize: baseFontSize,
            cellPaddingX
        };
    }

    const textMeasure = typeof measureText === 'function'
        ? measureText
        : (value, fontSize) => {
            const text = value === null || value === undefined ? '' : String(value);
            if (!text) return 0;
            return text.length * fontSize * 0.6;
        };

    const getWidth = (value, fontSize) => {
        const text = value === null || value === undefined ? '' : String(value);
        if (!text) return 0;
        return textMeasure(text, fontSize);
    };

    let columnWidths = normalizedHeaders.map((header, index) => {
        const headerWidth = getWidth(header, baseFontSize) + cellPaddingX * 2;
        const dataWidth = normalizedRows.reduce((max, row) => {
            const width = getWidth(row?.[index], baseFontSize) + cellPaddingX * 2;
            return Math.max(max, width);
        }, headerWidth);
        return Math.max(minColumnWidth, dataWidth);
    });

    let totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);

    if (availableWidth > 0) {
        if (totalWidth > availableWidth) {
            const scale = availableWidth / totalWidth;
            columnWidths = columnWidths.map(width => Math.max(minColumnWidth, width * scale));
            totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);
        } else if (totalWidth < availableWidth) {
            const extra = availableWidth - totalWidth;
            if (extra > 0) {
                const base = totalWidth || columnWidths.length;
                columnWidths = columnWidths.map(width => {
                    const weight = totalWidth > 0 ? width / base : 1 / columnCount;
                    return width + extra * weight;
                });
                totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);
            }
        }

        if (totalWidth > availableWidth) {
            const overflow = totalWidth - availableWidth;
            const divisor = totalWidth || 1;
            columnWidths = columnWidths.map(width => width - (width / divisor) * overflow);
            totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);
        }
    }

    const rowsForScale = [normalizedHeaders, ...normalizedRows];
    let limitScale = Infinity;

    rowsForScale.forEach(row => {
        normalizedHeaders.forEach((_, index) => {
            const textWidth = getWidth(row?.[index], baseFontSize);
            if (!textWidth) return;
            const allowed = Math.max(columnWidths[index] - cellPaddingX * 2, minColumnWidth * 0.6);
            if (allowed <= 0) return;
            const scale = allowed / textWidth;
            if (scale < limitScale) {
                limitScale = scale;
            }
        });
    });

    if (!Number.isFinite(limitScale) || limitScale <= 0) {
        limitScale = 1;
    }

    const minScale = minFontSize / baseFontSize;
    const maxScale = maxFontSize / baseFontSize;
    let finalScale;

    if (limitScale >= 1) {
        finalScale = Math.min(limitScale, maxScale);
    } else {
        finalScale = Math.max(limitScale, minScale);
    }

    finalScale = Math.max(minScale, Math.min(finalScale, maxScale));
    const fontSize = baseFontSize * finalScale;
    const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);

    return {
        columnWidths,
        tableWidth,
        fontSize,
        cellPaddingX
    };
}

let reportCanvasContext = null;

function getReportCanvasContext() {
    if (typeof document === 'undefined') {
        return null;
    }
    if (!reportCanvasContext) {
        const canvas = document.createElement('canvas');
        reportCanvasContext = canvas.getContext('2d');
    }
    return reportCanvasContext;
}

function measureReportTextWithCanvas(value, fontSizePt) {
    const text = value === null || value === undefined ? '' : String(value);
    if (!text) return 0;
    const context = getReportCanvasContext();
    if (!context) {
        return text.length * fontSizePt * 0.6;
    }
    const fontSizePx = fontSizePt * REPORT_PT_TO_PX;
    context.font = `${fontSizePx}px Arial`;
    const metrics = context.measureText(text);
    return metrics.width;
}

function createReportPrintHtml(title, headers, rows) {
    const normalizedHeaders = Array.isArray(headers) ? headers : [];
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const orientation = normalizedHeaders.length > 5 ? 'landscape' : 'portrait';
    const pageWidthMm = orientation === 'landscape' ? 297 : 210;
    const pageHeightMm = orientation === 'landscape' ? 210 : 297;
    const marginMm = 15;
    const availableWidthPx = (pageWidthMm - marginMm * 2) * REPORT_MM_TO_PX;

    const layout = calculateReportLayout(normalizedHeaders, normalizedRows, {
        availableWidth: availableWidthPx,
        baseFontSize: 11,
        minFontSize: 8,
        maxFontSize: 13,
        minColumnWidth: 64,
        cellPaddingX: 12,
        measureText: measureReportTextWithCanvas
    });

    const safeTitle = escapeHtml(title ?? 'Relatório');
    const columnCount = normalizedHeaders.length;
    const colgroup = columnCount
        ? `<colgroup>${layout.columnWidths
            .map(width => `<col style="width:${((width / layout.tableWidth) * 100).toFixed(4)}%">`)
            .join('')}</colgroup>`
        : '';

    const headerHtml = columnCount
        ? normalizedHeaders.map(header => `<th scope="col">${escapeHtml(header ?? '')}</th>`).join('')
        : '<th scope="col">&nbsp;</th>';

    const hasRows = normalizedRows.length > 0;
    const bodyHtml = hasRows
        ? normalizedRows
            .map(row => {
                const cells = normalizedHeaders.map((_, index) => `<td>${escapeHtml(row?.[index] ?? '')}</td>`);
                return `<tr>${cells.join('')}</tr>`;
            })
            .join('')
        : `<tr><td colspan="${Math.max(1, columnCount)}" style="text-align:center; padding: 16px 0;">Nenhum dado disponível.</td></tr>`;

    const headerFontSize = Math.min(layout.fontSize + 2, 14).toFixed(2);
    const fontSize = layout.fontSize.toFixed(2);
    const paddingXmm = layout.cellPaddingX ? (layout.cellPaddingX / REPORT_MM_TO_PX).toFixed(4) : (12 / REPORT_MM_TO_PX).toFixed(4);

    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${safeTitle}</title><style>
        :root {
            --page-width: ${pageWidthMm}mm;
            --page-height: ${pageHeightMm}mm;
            --page-margin: ${marginMm}mm;
            --font-size: ${fontSize}pt;
            --header-font-size: ${headerFontSize}pt;
            --padding-x: ${paddingXmm}mm;
        }
        @page {
            size: A4 ${orientation};
            margin: var(--page-margin);
        }
        html, body {
            margin: 0;
            padding: 0;
            background: #f8f9fb;
            color: #111;
            font-family: Arial, sans-serif;
        }
        body {
            display: flex;
            justify-content: center;
            align-items: flex-start;
        }
        .print-page {
            width: var(--page-width);
            max-width: 100%;
            background: #fff;
            box-sizing: border-box;
            padding: 0;
        }
        .print-content {
            width: 100%;
        }
        h1 {
            text-align: center;
            font-size: calc(var(--header-font-size) + 4pt);
            margin: 0 0 12px;
        }
        .table-wrapper {
            width: 100%;
            overflow: hidden;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: var(--font-size);
        }
        th, td {
            border: 1px solid #444;
            padding: 6px var(--padding-x);
            white-space: nowrap;
        }
        th {
            background: #f3f4f6;
            font-size: var(--header-font-size);
            text-align: center;
        }
        td {
            text-align: left;
        }
    </style></head><body><div class="print-page"><div class="print-content"><h1>${safeTitle}</h1><div class="table-wrapper"><table>${colgroup}<thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div></div></div><script>
        window.addEventListener('load', function () {
            setTimeout(function () {
                window.focus();
                window.print();
            }, 300);
        });
    <\/script></body></html>`;
}

function downloadBlobFromContent(content, mimeType, filename) {
    if (typeof window === 'undefined') return;
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function loadJsPdfLibrary() {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Ambiente indisponível para gerar PDF.'));
    }

    if (window.jspdf?.jsPDF) {
        return Promise.resolve(window.jspdf.jsPDF);
    }

    if (jsPdfLoaderPromise) {
        return jsPdfLoaderPromise;
    }

    jsPdfLoaderPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '../js/vendor/jspdf.umd.min.js';
        script.async = true;
        script.onload = () => {
            if (window.jspdf?.jsPDF) {
                resolve(window.jspdf.jsPDF);
            } else {
                reject(new Error('Biblioteca jsPDF não disponível.'));
            }
        };
        script.onerror = () => {
            reject(new Error('Não foi possível carregar a biblioteca de PDF.'));
        };
        document.head.appendChild(script);
    }).catch(error => {
        jsPdfLoaderPromise = null;
        throw error;
    });

    return jsPdfLoaderPromise;
}

async function exportReportAsPdf(title, headers, rows, filename) {
    const jsPDFConstructor = await loadJsPdfLibrary();
    const normalizedHeaders = Array.isArray(headers) ? headers : [];
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const orientation = normalizedHeaders.length > 5 ? 'landscape' : 'portrait';
    const doc = new jsPDFConstructor({ orientation, unit: 'pt', format: 'a4' });
    const margin = 36;
    const titleFontSize = 16;
    const baseFontSize = 11;
    const minFontSize = 8;
    const maxFontSize = 13;
    const cellPaddingX = 12;
    const cellPaddingY = 8;

    const measurePdfText = (value, fontSize) => {
        const text = value === null || value === undefined ? '' : String(value);
        if (!text) return 0;
        const previousSize = doc.internal.getFontSize();
        doc.setFontSize(fontSize);
        const width = doc.getTextWidth(text);
        doc.setFontSize(previousSize);
        return width;
    };

    const pageWidthInitial = doc.internal.pageSize.getWidth();
    const availableWidth = pageWidthInitial - margin * 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(baseFontSize);

    const layout = calculateReportLayout(normalizedHeaders, normalizedRows, {
        availableWidth,
        baseFontSize,
        minFontSize,
        maxFontSize,
        minColumnWidth: 64,
        cellPaddingX,
        measureText: measurePdfText
    });

    let pageWidth = doc.internal.pageSize.getWidth();
    let pageHeight = doc.internal.pageSize.getHeight();
    const columnWidths = layout.columnWidths;
    const tableWidth = layout.tableWidth;
    const getTableX = () => (columnWidths.length
        ? Math.max(margin, (pageWidth - tableWidth) / 2)
        : margin);
    const bodyFontSize = layout.fontSize;
    const headerFontSize = Math.min(bodyFontSize + 2, 14);
    const headerRowHeight = headerFontSize * 1.4 + cellPaddingY * 2;
    const bodyRowHeight = bodyFontSize * 1.35 + cellPaddingY * 2;

    const refreshPageMetrics = () => {
        pageWidth = doc.internal.pageSize.getWidth();
        pageHeight = doc.internal.pageSize.getHeight();
    };

    let currentY = margin;

    const writePageHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(titleFontSize);
        doc.text(title, pageWidth / 2, margin, { align: 'center' });
        currentY = margin + titleFontSize + 12;
        doc.setFont('helvetica', 'normal');
    };

    const drawHeaderRow = () => {
        if (!columnWidths.length) {
            return;
        }
        if (currentY + headerRowHeight > pageHeight - margin) {
            doc.addPage();
            refreshPageMetrics();
            writePageHeader();
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(headerFontSize);
        doc.setDrawColor(68, 68, 68);
        doc.setLineWidth(0.6);
        doc.setTextColor(17, 17, 17);
        let cellX = getTableX();
        normalizedHeaders.forEach((header, index) => {
            const cellWidth = columnWidths[index];
            doc.setFillColor(240, 240, 240);
            doc.rect(cellX, currentY, cellWidth, headerRowHeight, 'FD');
            const textX = cellX + cellWidth / 2;
            const textY = currentY + headerRowHeight / 2 + headerFontSize * 0.35;
            doc.text(String(header ?? ''), textX, textY, { align: 'center' });
            cellX += cellWidth;
        });
        currentY += headerRowHeight;
        doc.setFont('helvetica', 'normal');
    };

    const drawBodyRow = row => {
        if (!columnWidths.length) {
            return;
        }
        if (currentY + bodyRowHeight > pageHeight - margin) {
            doc.addPage();
            refreshPageMetrics();
            writePageHeader();
            drawHeaderRow();
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(bodyFontSize);
        doc.setDrawColor(68, 68, 68);
        doc.setLineWidth(0.5);
        doc.setTextColor(17, 17, 17);
        let cellX = getTableX();
        normalizedHeaders.forEach((_, index) => {
            const cellWidth = columnWidths[index];
            const value = row?.[index];
            const text = value === null || value === undefined ? '' : String(value);
            doc.rect(cellX, currentY, cellWidth, bodyRowHeight);
            const textX = cellX + cellPaddingX;
            const textY = currentY + bodyRowHeight / 2 + bodyFontSize * 0.35;
            doc.text(text, textX, textY);
            cellX += cellWidth;
        });
        currentY += bodyRowHeight;
    };

    refreshPageMetrics();
    writePageHeader();
    if (columnWidths.length) {
        drawHeaderRow();
    }

    if (!normalizedRows.length) {
        const emptyHeight = bodyRowHeight;
        const emptyWidth = columnWidths.length ? tableWidth : availableWidth;
        if (currentY + emptyHeight > pageHeight - margin) {
            doc.addPage();
            refreshPageMetrics();
            writePageHeader();
            if (columnWidths.length) {
                drawHeaderRow();
            }
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(bodyFontSize);
        doc.setDrawColor(68, 68, 68);
        doc.setLineWidth(0.5);
        const tableX = getTableX();
        doc.rect(tableX, currentY, emptyWidth, emptyHeight);
        const textY = currentY + emptyHeight / 2 + bodyFontSize * 0.35;
        doc.text('Nenhum dado disponível.', tableX + emptyWidth / 2, textY, { align: 'center' });
        currentY += emptyHeight;
    } else {
        normalizedRows.forEach(row => drawBodyRow(row));
    }

    doc.save(filename);
}

function openReportPrintWindow(title, headers, rows) {
    if (typeof window === 'undefined') return;

    const html = createReportPrintHtml(title, headers, rows);

    const openInExternalBrowser = async () => {
        if (window.electronAPI?.openExternalHtml) {
            try {
                const opened = await window.electronAPI.openExternalHtml(html);
                if (opened) {
                    return true;
                }
            } catch (error) {
                console.error('Falha ao abrir a visualização de impressão externa', error);
            }
        }
        return false;
    };

    openInExternalBrowser()
        .then(openedExternally => {
            if (openedExternally) {
                return;
            }
            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                showRelatoriosToast('Não foi possível abrir a janela de impressão.', 'error');
                return;
            }
            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();
        })
        .catch(error => {
            console.error('openReportPrintWindow error', error);
            showRelatoriosToast('Não foi possível abrir a visualização de impressão.', 'error');
        });
}

function getInitials(name) {
    const value = name && String(name).trim();
    if (!value) return '?';
    const parts = value.split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const initials = parts.slice(0, 2).map(part => part[0]).join('');
    return initials.toUpperCase();
}

function getAvatarColor(name) {
    const normalized = normalizeText(name);
    if (!normalized) return AVATAR_COLORS[0];
    let hash = 0;
    for (let i = 0; i < normalized.length; i += 1) {
        hash = (hash + normalized.charCodeAt(i)) % AVATAR_COLORS.length;
    }
    return AVATAR_COLORS[hash];
}

function formatPhone(value) {
    return formatText(value, '—');
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        const error = new Error(`Request failed with status ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

async function fetchContactsData() {
    const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/clientes/contatos`);
    if (!Array.isArray(data)) return [];

    return data
        .map(contact => ({
            ...contact,
            cliente: contact?.cliente ?? contact?.nome_fantasia ?? '',
            dono: contact?.dono ?? contact?.dono_cliente ?? '',
            status_cliente: contact?.status_cliente ?? ''
        }))
        .sort((a, b) => {
            const byClient = normalizeText(a.cliente).localeCompare(normalizeText(b.cliente));
            if (byClient !== 0) return byClient;
            return normalizeText(a.nome).localeCompare(normalizeText(b.nome));
        });
}

async function loadContactsReportData() {
    if (reportDataCache.has('contatos')) {
        return reportDataCache.get('contatos');
    }

    if (!reportDataPromises.has('contatos')) {
        const promise = (async () => {
            try {
                const result = await fetchContactsData();
                const normalized = Array.isArray(result) ? result : [];
                reportDataCache.set('contatos', normalized);
                return normalized;
            } finally {
                reportDataPromises.delete('contatos');
            }
        })();
        reportDataPromises.set('contatos', promise);
    }

    return reportDataPromises.get('contatos');
}

function getRawMaterialStatus(item) {
    if (item?.infinito) {
        return { label: 'Infinito', variant: 'info' };
    }
    const quantity = Number(item?.quantidade ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { label: 'Sem estoque', variant: 'danger' };
    }
    const minimum = getStockMinimum(item);
    if (Number.isFinite(minimum)) {
        if (quantity > 0 && quantity < minimum) {
            return { label: 'Baixo', variant: 'warning' };
        }
        return { label: 'Disponível', variant: 'success' };
    }
    if (quantity < 10) {
        return { label: 'Baixo', variant: 'warning' };
    }
    return { label: 'Disponível', variant: 'success' };
}

function getProductStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (['ativo', 'em linha'].includes(normalized)) return 'success';
    if (normalized.includes('reposicao') || normalized === 'pendente') return 'warning';
    if (['inativo', 'descontinuado', 'cancelado'].includes(normalized)) return 'danger';
    if (normalized === 'sob demanda') return 'neutral';
    return 'info';
}

function getClientStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (normalized === 'ativo') return 'success';
    if (['inativo', 'inadimplente', 'cancelado'].includes(normalized)) return 'danger';
    if (['negociacao', 'pendente', 'prospeccao'].includes(normalized)) return 'warning';
    if (normalized === 'prospect') return 'info';
    return 'neutral';
}

function getContactTypeVariant(type) {
    const normalized = normalizeText(type);
    if (!normalized) return 'neutral';
    if (normalized === 'fornecedor') return 'info';
    if (['parceiro', 'cliente', 'representante comercial'].includes(normalized)) return 'success';
    if (['arquiteto', 'consultor'].includes(normalized)) return 'warning';
    if (normalized === 'prospect') return 'secondary';
    return 'neutral';
}

function getQuoteStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (['aprovado', 'convertido'].includes(normalized)) return 'success';
    if (['rejeitado', 'cancelado'].includes(normalized)) return 'danger';
    if (['pendente', 'revisao'].includes(normalized)) return 'warning';
    if (normalized === 'rascunho') return 'info';
    if (normalized === 'enviado') return 'info';
    if (normalized === 'expirado') return 'light';
    return 'neutral';
}

function getOrderStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (['entregue', 'concluido'].includes(normalized)) return 'success';
    if (normalized === 'cancelado') return 'danger';
    if (normalized === 'enviado') return 'info';
    if (normalized === 'producao') return 'warning';
    if (normalized === 'rascunho') return 'secondary';
    return 'neutral';
}

function getUserStatusVariant(status) {
    const normalized = normalizeText(status);
    if (!normalized) return 'neutral';
    if (normalized === 'ativo') return 'success';
    if (['inativo', 'suspenso'].includes(normalized)) return 'danger';
    if (['aguardando', 'pendente'].includes(normalized)) return 'warning';
    if (normalized === 'offline') return 'danger';
    return 'neutral';
}

const FILTERED_EMPTY_MESSAGE = 'Nenhum registro encontrado para os filtros aplicados.';

function parseFilterNumber(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

function sanitizeDigits(value) {
    return typeof value === 'string' ? value.replace(/\D+/g, '') : '';
}

function includesNormalized(value, searchTerm) {
    if (!searchTerm) return true;
    return normalizeText(value).includes(searchTerm);
}

function flattenFilterCandidates(values, target = []) {
    if (!Array.isArray(values)) {
        if (values !== undefined && values !== null) {
            target.push(values);
        }
        return target;
    }

    values.forEach(value => {
        if (Array.isArray(value)) {
            flattenFilterCandidates(value, target);
        } else if (value !== undefined && value !== null) {
            target.push(value);
        }
    });

    return target;
}

function matchesSearchTerm(searchTerm, ...values) {
    if (!searchTerm) return true;
    const candidates = flattenFilterCandidates(values);
    return candidates.some(candidate => includesNormalized(candidate, searchTerm));
}

function getStockMinimum(item) {
    const candidates = [
        item?.estoque_minimo,
        item?.quantidade_minima,
        item?.quantidade_min,
        item?.minimo,
        item?.estoqueMinimo
    ];
    for (const candidate of candidates) {
        const number = Number(candidate);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function getPaymentConditionLabels(record) {
    const labels = [];
    const condition = record?.condicao_comercial ?? record?.condicao ?? record?.condicaoPagamento;
    if (condition) {
        labels.push(String(condition).trim());
    }

    const parcelCandidates = [
        record?.parcelas,
        record?.numeroParcelas,
        record?.qtdParcelas,
        record?.parcelamento
    ];

    const parcelas = parcelCandidates
        .map(candidate => {
            const parsed = Number.parseInt(candidate, 10);
            return Number.isFinite(parsed) ? parsed : null;
        })
        .find(Number.isInteger);

    if (Number.isInteger(parcelas)) {
        labels.push(parcelas <= 1 ? 'À vista' : `${parcelas} parcelas`);
        if (parcelas > 1) {
            labels.push('Parcelado');
        }
    }

    return labels;
}

function addOptionCandidate(map, candidate) {
    if (candidate === null || candidate === undefined) return;
    if (typeof candidate === 'object') return;

    let text;
    if (typeof candidate === 'number') {
        if (!Number.isFinite(candidate)) return;
        text = candidate.toString();
    } else if (typeof candidate === 'boolean') {
        text = candidate ? 'Sim' : 'Não';
    } else {
        text = String(candidate).trim();
    }

    if (!text) return;
    const normalized = normalizeText(text);
    if (!normalized) return;
    if (!map.has(normalized)) {
        map.set(normalized, { value: text, label: text });
    }
}

function collectFilterOptions(items, extractor) {
    if (typeof extractor !== 'function') return [];
    const options = new Map();
    const list = Array.isArray(items) ? items : [];

    list.forEach(item => {
        const raw = extractor(item);
        const candidates = flattenFilterCandidates(Array.isArray(raw) ? raw : [raw]);
        candidates.forEach(candidate => addOptionCandidate(options, candidate));
    });

    return Array.from(options.values()).sort((a, b) => normalizeText(a.label).localeCompare(normalizeText(b.label)));
}

function updateSelectOptions(select, options) {
    if (!select || (select.tagName || '').toUpperCase() !== 'SELECT') return;
    const existingPlaceholder = Array.from(select.options).find(option => option.dataset.defaultOption === 'true')
        || select.querySelector('option[value=""]');
    const placeholderLabel = existingPlaceholder?.textContent?.trim() || 'Todos';
    const previousValue = select.value;

    select.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = placeholderLabel;
    defaultOption.dataset.defaultOption = 'true';
    select.appendChild(defaultOption);

    options.forEach(option => {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        select.appendChild(element);
    });

    const normalizedPrevious = normalizeText(previousValue);
    const matched = options.find(option => normalizeText(option.value) === normalizedPrevious);
    select.value = matched ? matched.value : '';
}

const FILTER_OPTION_CONFIGS = {
    'materia-prima': {
        processo: item => item?.processo,
        categoria: item => item?.categoria
    },
    produtos: {
        colecao: item => [item?.colecao, item?.linha],
        status: item => item?.status
    },
    clientes: {
        owner: item => [item?.dono_cliente, item?.dono],
        status: item => item?.status_cliente
    },
    contatos: {
        tipo: item => [item?.tipo, item?.cargo]
    },
    prospeccoes: {
        status: item => item?.status,
        origem: item => item?.origem,
        responsavel: item => item?.responsavel,
        condicao: item => [...getPaymentConditionLabels(item), item?.condicao_pagamento, item?.condicao]
    },
    orcamentos: {
        status: item => item?.situacao,
        dono: item => [item?.dono, item?.responsavel],
        cliente: item => item?.cliente,
        condicao: item => [...getPaymentConditionLabels(item), item?.condicao_pagamento, item?.condicao]
    },
    pedidos: {
        status: item => item?.situacao,
        dono: item => [item?.responsavel, item?.dono],
        cliente: item => item?.cliente,
        condicao: item => getPaymentConditionLabels(item)
    },
    usuarios: {
        perfil: item => item?.perfil,
        statusDetalhado: item => item?.status
    }
};

const filterOptionsState = new Map();

function syncFilterOptions(key, data, root) {
    if (!root) return;
    const config = FILTER_OPTION_CONFIGS[key];
    if (!config) return;

    const list = Array.isArray(data) ? data : [];
    const state = filterOptionsState.get(key) || new Map();

    Object.entries(config).forEach(([filterKey, extractor]) => {
        const options = collectFilterOptions(list, extractor);
        const signature = options.map(option => option.value).join('|');
        if (state.get(filterKey) === signature) {
            return;
        }

        state.set(filterKey, signature);
        const selects = Array.from(root.querySelectorAll(`select[data-relatorios-filter="${key}"][data-filter-key="${filterKey}"]`));
        selects.forEach(select => updateSelectOptions(select, options));
    });

    filterOptionsState.set(key, state);
}

function normalizeGeoFilterDetail(value) {
    if (!value) {
        return { values: [], labels: [], items: [] };
    }

    if (typeof value === 'string') {
        const values = value
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
        return {
            values,
            labels: [],
            items: values.map(itemValue => ({ value: itemValue }))
        };
    }

    if (Array.isArray(value)) {
        const values = value
            .map(item => (item == null ? '' : String(item).trim()))
            .filter(Boolean);
        return {
            values,
            labels: [],
            items: values.map(itemValue => ({ value: itemValue }))
        };
    }

    if (typeof value === 'object') {
        const values = Array.isArray(value.values)
            ? value.values.map(item => (item == null ? '' : String(item))).filter(Boolean)
            : [];
        const labels = Array.isArray(value.labels)
            ? value.labels.map(item => (item == null ? '' : String(item))).filter(Boolean)
            : [];
        const items = Array.isArray(value.items)
            ? value.items
                .map(item => ({
                    value: item?.value ? String(item.value) : '',
                    label: item?.label ? String(item.label) : '',
                    group: item?.group ? String(item.group) : ''
                }))
                .filter(item => item.value || item.label || item.group)
            : [];
        return { values, labels, items };
    }

    return { values: [], labels: [], items: [] };
}

function buildCountrySelectionSets(selection) {
    const detail = normalizeGeoFilterDetail(selection);
    const codes = new Set();
    const names = new Set();

    detail.values.forEach(value => {
        const normalized = normalizeText(value);
        if (normalized) {
            codes.add(normalized);
        }
    });

    detail.labels.forEach(label => {
        const normalized = normalizeText(label);
        if (normalized) {
            names.add(normalized);
        }
    });

    detail.items.forEach(item => {
        const code = normalizeText(item.value);
        if (code) {
            codes.add(code);
        }
        const label = normalizeText(item.label);
        if (label) {
            names.add(label);
        }
    });

    return { codes, names };
}

function buildStateSelectionSets(selection) {
    const detail = normalizeGeoFilterDetail(selection);
    const codes = new Set();
    const names = new Set();
    const pairs = new Set();

    const registerState = (value, label, group) => {
        if (label) {
            const normalizedLabel = normalizeText(label.includes('—') ? label.split('—')[0] : label);
            if (normalizedLabel) {
                names.add(normalizedLabel);
            }
        }
        if (!value) return;
        const [countryPart, statePart] = String(value).split(':');
        if (statePart) {
            const normalizedState = normalizeText(statePart);
            if (normalizedState) {
                codes.add(normalizedState);
                if (countryPart) {
                    const normalizedCountry = normalizeText(countryPart);
                    if (normalizedCountry) {
                        pairs.add(`${normalizedCountry}:${normalizedState}`);
                    }
                }
                if (group) {
                    const normalizedGroup = normalizeText(group);
                    if (normalizedGroup) {
                        pairs.add(`${normalizedGroup}:${normalizedState}`);
                    }
                }
            }
        } else {
            const normalized = normalizeText(value);
            if (normalized) {
                codes.add(normalized);
            }
        }
    };

    detail.values.forEach(value => registerState(value));
    detail.items.forEach(item => registerState(item.value, item.label, item.group));
    detail.labels.forEach(label => registerState('', label));

    return { codes, names, pairs };
}

function buildNormalizedCandidates(values) {
    return values
        .map(value => normalizeText(value))
        .filter(Boolean);
}

const REPORT_FILTERS = {
    'materia-prima': (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const processo = normalizeText(filters.processo);
        const categoria = normalizeText(filters.categoria);
        const quantidadeMin = parseFilterNumber(filters.quantidadeMin);
        const quantidadeMax = parseFilterNumber(filters.quantidadeMax);
        const precoMin = parseFilterNumber(filters.precoMin);
        const precoMax = parseFilterNumber(filters.precoMax);
        const semEstoque = Boolean(filters.semEstoque);
        const baixoEstoque = Boolean(filters.baixoEstoque);

        return list.filter(item => {
            const statusInfo = getRawMaterialStatus(item);
            const searchValues = [
                item?.nome,
                item?.categoria,
                item?.processo,
                item?.unidade,
                item?.descricao,
                item?.codigo,
                item?.codigo_interno,
                item?.fornecedor,
                statusInfo?.label
            ];
            if (item?.infinito) {
                searchValues.push('infinito', '∞');
            }
            searchValues.push(item?.quantidade, item?.preco_unitario ?? item?.precoUnitario);

            if (!matchesSearchTerm(searchTerm, searchValues)) return false;
            if (processo && !includesNormalized(item?.processo, processo)) return false;
            if (categoria && !includesNormalized(item?.categoria, categoria)) return false;

            const quantidade = safeNumber(item?.quantidade);
            if (semEstoque && quantidade > 0) return false;

            if (Number.isFinite(quantidadeMin) && quantidade < quantidadeMin) return false;
            if (Number.isFinite(quantidadeMax) && quantidade > quantidadeMax) return false;

            const minimo = getStockMinimum(item);
            if (baixoEstoque) {
                if (!Number.isFinite(minimo)) return false;
                if (!(quantidade > 0 && quantidade < minimo)) return false;
            }

            const preco = safeNumber(item?.preco_unitario ?? item?.precoUnitario);
            if (Number.isFinite(precoMin) && preco < precoMin) return false;
            if (Number.isFinite(precoMax) && preco > precoMax) return false;

            return true;
        });
    },
    produtos: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const colecao = normalizeText(filters.colecao);
        const status = normalizeText(filters.status);
        const quantidadeMin = parseFilterNumber(filters.quantidadeMin);
        const quantidadeMax = parseFilterNumber(filters.quantidadeMax);
        const precoMin = parseFilterNumber(filters.precoMin);
        const precoMax = parseFilterNumber(filters.precoMax);
        const margemMin = parseFilterNumber(filters.margemMin);
        const semEstoque = Boolean(filters.semEstoque);
        const destaque = Boolean(filters.destaque);

        return list.filter(produto => {
            const searchValues = [
                produto?.codigo,
                produto?.nome,
                produto?.categoria,
                produto?.colecao,
                produto?.linha,
                produto?.status,
                produto?.descricao,
                produto?.referencia,
                produto?.codigo_barras,
                produto?.sku
            ];
            if (produto?.destaque) {
                searchValues.push('destaque');
            }
            searchValues.push(produto?.quantidade_total, produto?.preco_venda);

            if (!matchesSearchTerm(searchTerm, searchValues)) return false;

            if (colecao) {
                const colecaoProduto = normalizeText(produto?.colecao ?? produto?.linha ?? '');
                if (!colecaoProduto.includes(colecao)) return false;
            }

            if (status && !includesNormalized(produto?.status, status)) return false;

            const quantidade = safeNumber(produto?.quantidade_total);
            if (semEstoque && quantidade > 0) return false;
            if (Number.isFinite(quantidadeMin) && quantidade < quantidadeMin) return false;
            if (Number.isFinite(quantidadeMax) && quantidade > quantidadeMax) return false;

            const preco = safeNumber(produto?.preco_venda);
            if (Number.isFinite(precoMin) && preco < precoMin) return false;
            if (Number.isFinite(precoMax) && preco > precoMax) return false;

            if (Number.isFinite(margemMin)) {
                const margem = Number(produto?.pct_markup);
                if (!Number.isFinite(margem) || margem < margemMin) return false;
            }

            if (destaque) {
                const flag = Boolean(produto?.destaque || produto?.is_destaque || produto?.highlight);
                if (!flag) return false;
            }

            return true;
        });
    },
    clientes: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const owner = normalizeText(filters.owner);
        const status = normalizeText(filters.status);
        const countrySelection = buildCountrySelectionSets(filters.paises);
        const stateSelection = buildStateSelectionSets(filters.estados);

        const hasCountryFilter = countrySelection.codes.size > 0 || countrySelection.names.size > 0;
        const hasStateFilter = stateSelection.codes.size > 0 || stateSelection.names.size > 0 || stateSelection.pairs.size > 0;

        return list.filter(cliente => {
            const searchValues = [
                cliente?.nome_fantasia,
                cliente?.razao_social,
                cliente?.cnpj,
                cliente?.cpf,
                cliente?.pais,
                cliente?.estado,
                cliente?.cidade,
                cliente?.segmento,
                cliente?.dono_cliente,
                cliente?.status_cliente,
                cliente?.email
            ];

            if (!matchesSearchTerm(searchTerm, searchValues)) return false;

            if (owner && !includesNormalized(cliente?.dono_cliente ?? cliente?.dono, owner)) return false;
            if (status && !includesNormalized(cliente?.status_cliente, status)) return false;

            const countryCandidates = hasCountryFilter || hasStateFilter
                ? buildNormalizedCandidates([
                    cliente?.pais,
                    cliente?.pais_codigo,
                    cliente?.paisCode,
                    cliente?.pais_sigla,
                    cliente?.country,
                    cliente?.country_code
                ])
                : [];

            if (hasCountryFilter) {
                const matchesCountry = countryCandidates.some(candidate => {
                    return countrySelection.names.has(candidate) || countrySelection.codes.has(candidate);
                });
                if (!matchesCountry) return false;
            }

            if (hasStateFilter) {
                const stateCandidates = buildNormalizedCandidates([
                    cliente?.estado,
                    cliente?.estado_nome,
                    cliente?.estadoDescricao,
                    cliente?.estadoCompleto,
                    cliente?.uf
                ]);

                let matchesState = stateCandidates.some(candidate => {
                    return stateSelection.codes.has(candidate) || stateSelection.names.has(candidate);
                });

                if (!matchesState && stateSelection.pairs.size && stateCandidates.length && countryCandidates.length) {
                    matchesState = countryCandidates.some(countryCandidate => {
                        return stateCandidates.some(stateCandidate => {
                            return stateSelection.pairs.has(`${countryCandidate}:${stateCandidate}`);
                        });
                    });
                }

                if (!matchesState) return false;
            }

            return true;
        });
    },
    contatos: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const tipo = normalizeText(filters.tipo);
        const empresaFiltro = normalizeText(filters.empresa);
        const celularFiltro = sanitizeDigits(filters.celular || '');
        const telefoneFiltro = sanitizeDigits(filters.telefone || '');

        return list.filter(contato => {
            const celularDigits = sanitizeDigits(contato?.telefone_celular ?? contato?.celular ?? '');
            const telefoneDigits = sanitizeDigits(contato?.telefone_fixo ?? contato?.telefone ?? '');
            const searchValues = [
                contato?.nome,
                contato?.cliente,
                contato?.empresa,
                contato?.email,
                contato?.cargo,
                contato?.tipo,
                contato?.status_cliente,
                contato?.dono,
                celularDigits,
                telefoneDigits
            ];

            if (!matchesSearchTerm(searchTerm, searchValues)) return false;

            if (tipo && !matchesSearchTerm(tipo, [contato?.tipo, contato?.cargo])) return false;
            if (empresaFiltro && !includesNormalized(contato?.cliente ?? contato?.empresa, empresaFiltro)) return false;

            if (celularFiltro) {
                const digits = celularDigits;
                if (!digits.includes(celularFiltro)) return false;
            }

            if (telefoneFiltro) {
                const digits = telefoneDigits;
                if (!digits.includes(telefoneFiltro)) return false;
            }

            return true;
        });
    },
    prospeccoes: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const status = normalizeText(filters.status);
        const responsavel = normalizeText(filters.responsavel);
        const origem = normalizeText(filters.origem);
        const cidade = normalizeText(filters.cidade);
        const valorMin = parseFilterNumber(filters.valorMin);
        const valorMax = parseFilterNumber(filters.valorMax);
        const condicaoFiltro = normalizeText(filters.condicao);

        return list.filter(prospeccao => {
            const searchValues = [
                prospeccao?.nome,
                prospeccao?.email,
                prospeccao?.empresa,
                prospeccao?.cliente,
                prospeccao?.status,
                prospeccao?.responsavel,
                prospeccao?.origem,
                prospeccao?.cidade,
                prospeccao?.estado,
                prospeccao?.condicao_pagamento ?? prospeccao?.condicao,
                sanitizeDigits(prospeccao?.telefone ?? prospeccao?.celular ?? ''),
                sanitizeDigits(prospeccao?.whatsapp ?? '')
            ];

            if (!matchesSearchTerm(searchTerm, searchValues)) return false;
            if (status && !includesNormalized(prospeccao?.status, status)) return false;
            if (responsavel && !includesNormalized(prospeccao?.responsavel, responsavel)) return false;
            if (origem && !includesNormalized(prospeccao?.origem, origem)) return false;
            if (cidade && !matchesSearchTerm(cidade, [
                prospeccao?.cidade,
                prospeccao?.municipio,
                prospeccao?.cidade_cliente,
                prospeccao?.localidade
            ])) return false;

            const valor = [
                prospeccao?.valor_estimado,
                prospeccao?.valor,
                prospeccao?.valor_total,
                prospeccao?.valorPotencial,
                prospeccao?.valor_previsto
            ]
                .map(candidate => Number(candidate))
                .find(number => Number.isFinite(number));

            if (Number.isFinite(valorMin) && (!Number.isFinite(valor) || valor < valorMin)) return false;
            if (Number.isFinite(valorMax) && (!Number.isFinite(valor) || valor > valorMax)) return false;

            if (condicaoFiltro && !matchesSearchTerm(condicaoFiltro, getPaymentConditionLabels(prospeccao))) return false;

            return true;
        });
    },
    orcamentos: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const status = normalizeText(filters.status);
        const cliente = normalizeText(filters.cliente);
        const codigo = normalizeText(filters.codigo);
        const valorMin = parseFilterNumber(filters.valorMin);
        const valorMax = parseFilterNumber(filters.valorMax);
        const condicaoFiltro = normalizeText(filters.condicao);

        return list.filter(orcamento => {
            if (status && !includesNormalized(orcamento?.situacao, status)) return false;
            if (cliente && !includesNormalized(orcamento?.cliente, cliente)) return false;
            if (codigo && !includesNormalized(orcamento?.numero, codigo)) return false;

            const valor = safeNumber(orcamento?.valor_final);
            if (Number.isFinite(valorMin) && valor < valorMin) return false;
            if (Number.isFinite(valorMax) && valor > valorMax) return false;

            if (condicaoFiltro && !matchesSearchTerm(condicaoFiltro, getPaymentConditionLabels(orcamento))) return false;

            return true;
        });
    },
    pedidos: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const status = normalizeText(filters.status);
        const cliente = normalizeText(filters.cliente);
        const codigo = normalizeText(filters.codigo);
        const valorMin = parseFilterNumber(filters.valorMin);
        const valorMax = parseFilterNumber(filters.valorMax);
        const condicaoFiltro = normalizeText(filters.condicao);

        return list.filter(pedido => {
            if (status && !includesNormalized(pedido?.situacao, status)) return false;
            if (cliente && !includesNormalized(pedido?.cliente, cliente)) return false;
            if (codigo && !includesNormalized(pedido?.numero, codigo)) return false;

            const valor = safeNumber(pedido?.valor_final);
            if (Number.isFinite(valorMin) && valor < valorMin) return false;
            if (Number.isFinite(valorMax) && valor > valorMax) return false;

            if (condicaoFiltro && !matchesSearchTerm(condicaoFiltro, getPaymentConditionLabels(pedido))) return false;

            return true;
        });
    },
    usuarios: (data, filters = {}) => {
        const list = Array.isArray(data) ? data : [];
        const searchTerm = normalizeText(filters.search);
        const perfil = normalizeText(filters.perfil);
        const situacao = normalizeText(filters.situacao);
        const statusDetalhado = normalizeText(filters.statusDetalhado);
        const legacyStatusFilters = ['ativo', 'inativo', 'aguardando'].filter(flag => Boolean(filters[flag]));
        const statusFilters = statusDetalhado
            ? [statusDetalhado]
            : legacyStatusFilters;

        return list.filter(usuario => {
            const searchValues = [
                usuario?.nome,
                usuario?.email,
                usuario?.perfil,
                usuario?.status,
                usuario?.departamento,
                usuario?.cargo,
                usuario?.apelido
            ];
            searchValues.push(usuario?.online ? 'online' : 'offline');

            if (!matchesSearchTerm(searchTerm, searchValues)) return false;

            if (perfil && !includesNormalized(usuario?.perfil, perfil)) return false;

            if (situacao) {
                if (situacao === 'online' && !usuario?.online) return false;
                if (situacao === 'offline' && usuario?.online) return false;
                if (situacao === 'aguardando') {
                    const status = normalizeText(usuario?.status);
                    if (!status.includes('aguard')) return false;
                }
            }

            if (statusFilters.length) {
                const status = normalizeText(usuario?.status);
                const matchesStatus = statusFilters.some(filter => {
                    if (filter === 'aguardando') {
                        return status.includes('aguard');
                    }
                    return status === filter;
                });
                if (!matchesStatus) return false;
            }

            return true;
        });
    }
};

function getFilterValues(key, root) {
    if (!root) return {};
    const elements = Array.from(root.querySelectorAll(`[data-relatorios-filter="${key}"]`));
    if (!elements.length) return {};

    const geoState = root.__relatoriosGeoState instanceof Map ? root.__relatoriosGeoState : null;

    return elements.reduce((acc, element) => {
        const field = element.dataset.filterKey;
        if (!field) return acc;
        if (element.type === 'checkbox') {
            acc[field] = element.checked;
        } else if (element.type === 'hidden' && element.dataset.geoInput) {
            const geoKey = element.dataset.geoInput;
            if (geoState?.has(geoKey)) {
                const selection = geoState.get(geoKey);
                acc[field] = {
                    key: selection.key,
                    values: Array.isArray(selection.values) ? selection.values.slice() : [],
                    labels: Array.isArray(selection.labels) ? selection.labels.slice() : [],
                    items: Array.isArray(selection.items)
                        ? selection.items.map(item => ({ ...item }))
                        : []
                };
                return acc;
            }
            acc[field] = element.value ?? '';
        } else {
            acc[field] = element.value ?? '';
        }
        return acc;
    }, {});
}

function applyReportFilters(key, data, root) {
    const handler = REPORT_FILTERS[key];
    const source = Array.isArray(data) ? data : [];
    if (!handler || !root) return source;
    try {
        const filters = getFilterValues(key, root);
        const result = handler(source, filters);
        return Array.isArray(result) ? result : source;
    } catch (error) {
        console.error(`Erro ao aplicar filtros para "${key}"`, error);
        return source;
    }
}

function findSliderIndicator(slider) {
    if (!slider) return null;
    const identifier = slider.dataset?.relatoriosSlider;
    if (!identifier) return null;
    const wrapper = slider.closest('.relatorios-slider-wrapper');
    if (!wrapper) return null;
    return wrapper.querySelector(`[data-relatorios-slider-indicator="${identifier}"]`);
}

function positionSliderIndicator(slider, indicator) {
    if (!slider || !indicator) return;

    const min = Number.parseFloat(slider.min ?? '0');
    const max = Number.parseFloat(slider.max ?? '100');
    const rawValue = Number.parseFloat(slider.value ?? String(min));

    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) && max !== safeMin ? max : safeMin + 100;
    const numericValue = Number.isFinite(rawValue) ? rawValue : safeMin;

    const range = safeMax - safeMin;
    const percent = range === 0 ? 0 : (numericValue - safeMin) / range;
    const clampedPercent = Math.min(Math.max(percent, 0), 1);
    const offset = clampedPercent * 100;

    const decimals = Number.isInteger(numericValue) ? 0 : 2;
    const formattedValue = Number.isFinite(numericValue)
        ? numericValue.toLocaleString('pt-BR', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        })
        : '0';

    indicator.textContent = `${formattedValue}%`;
    indicator.style.left = `${offset}%`;
    indicator.classList.remove('is-left', 'is-right');

    if (clampedPercent <= 0.05) {
        indicator.classList.add('is-left');
    } else if (clampedPercent >= 0.95) {
        indicator.classList.add('is-right');
    }
}

function setupSliderIndicator(slider) {
    if (!slider || slider.dataset.sliderIndicatorInitialized === 'true') return;
    const indicator = findSliderIndicator(slider);
    if (!indicator) return;

    const updateIndicator = () => positionSliderIndicator(slider, indicator);
    slider.addEventListener('input', updateIndicator);
    slider.addEventListener('change', updateIndicator);

    slider.dataset.sliderIndicatorInitialized = 'true';
    updateIndicator();
}

function resetFiltersForKey(key, root, { triggerRender = false } = {}) {
    if (!key || !root) return;

    const defaultsForKey = filterDefaults.get(key) || [];
    defaultsForKey.forEach(({ element, value }) => {
        if (!element) return;
        if (element.type === 'checkbox') {
            element.checked = Boolean(value);
        } else {
            element.value = value;
        }

        if (element.type === 'range') {
            element.dispatchEvent(new Event('input'));
        }
    });

    const geoMappings = root.__relatoriosGeoMappings instanceof Map ? root.__relatoriosGeoMappings : null;
    const geoController = root.__relatoriosGeoController;
    const geoState = root.__relatoriosGeoState instanceof Map ? root.__relatoriosGeoState : null;

    if (geoMappings) {
        geoMappings.forEach((mapping, geoKey) => {
            if (!mapping || mapping.filterGroup !== key) return;

            if (geoController?.resetSelection) {
                geoController.resetSelection(geoKey);
            } else if (geoState) {
                geoState.set(geoKey, {
                    key: geoKey,
                    values: [],
                    labels: [],
                    items: []
                });
            }

            if (mapping.input) {
                mapping.input.value = '';
            }
        });
    }

    if (triggerRender) {
        const render = reportTableRenderers.get(key);
        if (typeof render === 'function') {
            render();
        }
    }
}

function setupFilterInteractions(root) {
    if (!root) return;
    const sections = Array.from(root.querySelectorAll('[data-relatorios-tab-content]'));
    sections.forEach(section => {
        const key = section.dataset.relatoriosTabContent;
        if (!key || section.dataset.filtersSetup === 'true') return;
        const inputs = Array.from(section.querySelectorAll(`[data-relatorios-filter="${key}"]`));
        if (!inputs.length) {
            section.dataset.filtersSetup = 'true';
            return;
        }

        const defaults = inputs.map(element => ({
            element,
            value: element.type === 'checkbox' ? element.checked : element.value
        }));
        filterDefaults.set(key, defaults);

        inputs.filter(element => element.type === 'range').forEach(setupSliderIndicator);

        const update = () => {
            const render = reportTableRenderers.get(key);
            if (typeof render === 'function') {
                render();
            }
        };

        const applyBtn = section.querySelector(`[data-relatorios-apply="${key}"]`);
        if (applyBtn) {
            applyBtn.addEventListener('click', event => {
                event.preventDefault();
                update();
            });
        }

        const resetBtn = section.querySelector(`[data-relatorios-reset="${key}"]`);
        if (resetBtn) {
            resetBtn.addEventListener('click', event => {
                event.preventDefault();
                resetFiltersForKey(key, root, { triggerRender: true });
            });
        }

        section.dataset.filtersSetup = 'true';
    });
}

async function getReportData(key, config) {
    if (reportDataCache.has(key)) {
        return reportDataCache.get(key);
    }

    if (reportDataPromises.has(key)) {
        try {
            const pending = await reportDataPromises.get(key);
            return Array.isArray(pending) ? pending : [];
        } catch (error) {
            console.error(`Erro ao reutilizar promessa de relatório "${key}"`, error);
            throw error;
        }
    }

    const fetchPromise = (async () => {
        const result = await config.fetchData();
        const normalized = Array.isArray(result) ? result : [];
        reportDataCache.set(key, normalized);
        return normalized;
    })();

    reportDataPromises.set(key, fetchPromise);

    try {
        const data = await fetchPromise;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        reportDataCache.delete(key);
        throw error;
    } finally {
        reportDataPromises.delete(key);
    }
}

function createKpiItem({ value, label, icon = 'fas fa-chart-line', iconBg = 'bg-white/10', iconColor = 'text-white/80' }) {
    return { value, label, icon, iconBg, iconColor };
}

function renderKpiCards(kpis) {
    if (!Array.isArray(kpis) || !kpis.length) {
        return createKpiPlaceholder('Nenhum indicador disponível.');
    }

    return kpis
        .map(item => {
            const value = item?.value ?? '—';
            const label = item?.label ?? '';
            const icon = item?.icon ?? 'fas fa-chart-line';
            const iconBg = item?.iconBg ?? 'bg-white/10';
            const iconColor = item?.iconColor ?? 'text-white';
            return `
                <article class="relatorios-kpi-card animate-fade-in-up">
                    <div class="flex items-center gap-4">
                        <div class="relatorios-kpi-icon ${iconBg}">
                            <i class="${icon} ${iconColor}"></i>
                        </div>
                        <div>
                            <p class="relatorios-kpi-value">${escapeHtml(String(value))}</p>
                            <p class="relatorios-kpi-label">${escapeHtml(String(label))}</p>
                        </div>
                    </div>
                </article>
            `;
        })
        .join('');
}

function createKpiPlaceholder(message) {
    return `<div class="relatorios-kpi-placeholder text-sm text-white/70">${escapeHtml(String(message))}</div>`;
}

function createKpiLoadingContent() {
    return Array.from({ length: 4 })
        .map(() => `
            <article class="relatorios-kpi-card">
                <div class="flex items-center gap-4 animate-pulse">
                    <div class="relatorios-kpi-icon bg-white/10"></div>
                    <div class="flex-1 space-y-2">
                        <div class="h-4 bg-white/10 rounded w-24"></div>
                        <div class="h-3 bg-white/5 rounded w-32"></div>
                    </div>
                </div>
            </article>
        `)
        .join('');
}

function createKpiManager(root, options = {}) {
    const { initialTab = null } = options;
    const sections = new Map();

    root.querySelectorAll('[data-relatorios-kpi]').forEach(section => {
        const key = section.dataset.relatoriosKpi;
        if (!key) return;
        sections.set(key, section);
        section.innerHTML = '';
    });

    let activeKey = null;

    if (initialTab && sections.has(initialTab)) {
        activeKey = initialTab;
        sections.get(initialTab).innerHTML = createKpiLoadingContent();
    }

    const clearInactiveSections = () => {
        sections.forEach((section, key) => {
            if (key !== activeKey && section.innerHTML) {
                section.innerHTML = '';
            }
        });
    };

    const setContent = (key, html) => {
        const section = sections.get(key);
        if (!section) return;
        if (activeKey !== key) {
            if (section.innerHTML) {
                section.innerHTML = '';
            }
            return;
        }
        section.innerHTML = html;
    };

    return {
        setActiveKey(key) {
            if (!key || !sections.has(key)) {
                activeKey = null;
                sections.forEach(section => {
                    if (section.innerHTML) {
                        section.innerHTML = '';
                    }
                });
                return;
            }
            const previousKey = activeKey;
            activeKey = key;
            if (key !== previousKey) {
                const currentSection = sections.get(key);
                if (currentSection && currentSection.innerHTML) {
                    currentSection.innerHTML = '';
                }
            }
            clearInactiveSections();
        },
        setLoading(key) {
            setContent(key, createKpiLoadingContent());
        },
        setError(key, message) {
            setContent(key, createKpiPlaceholder(message || 'Não foi possível carregar os indicadores.'));
        },
        setUnavailable(key) {
            setContent(key, createKpiPlaceholder('Indicadores não disponíveis para esta categoria.'));
        },
        setData(key, data, config) {
            if (!config?.computeKpis) {
                setContent(key, createKpiPlaceholder('Indicadores não disponíveis para esta categoria.'));
                return;
            }

            if (activeKey !== key) {
                setContent(key, '');
                return;
            }

            try {
                const kpis = config.computeKpis(Array.isArray(data) ? data : []);
                if (!Array.isArray(kpis) || !kpis.length) {
                    setContent(key, createKpiPlaceholder('Nenhum indicador disponível.'));
                    return;
                }
                setContent(key, renderKpiCards(kpis));
            } catch (error) {
                console.error(`Erro ao calcular indicadores para "${key}"`, error);
                setContent(key, createKpiPlaceholder('Não foi possível calcular os indicadores.'));
            }
        }
    };
}

function computeMateriaPrimaKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const finite = list.filter(item => !item?.infinito);
    const critical = finite.filter(item => {
        const qty = safeNumber(item?.quantidade);
        return qty > 0 && qty < 10;
    }).length;
    const outOfStock = finite.filter(item => safeNumber(item?.quantidade) <= 0).length;
    const totalValue = finite.reduce((sum, item) => sum + safeNumber(item?.quantidade) * safeNumber(item?.preco_unitario), 0);

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Materiais cadastrados',
            icon: 'fas fa-boxes-stacked',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatNumber(critical, { fallback: '0' }),
            label: 'Itens em estoque crítico',
            icon: 'fas fa-exclamation-triangle',
            iconBg: 'bg-rose-500/20',
            iconColor: 'text-rose-300'
        }),
        createKpiItem({
            value: formatNumber(outOfStock, { fallback: '0' }),
            label: 'Itens sem estoque',
            icon: 'fas fa-ban',
            iconBg: 'bg-gray-500/20',
            iconColor: 'text-gray-200'
        }),
        createKpiItem({
            value: formatCurrency(totalValue),
            label: 'Valor total em estoque',
            icon: 'fas fa-coins',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        })
    ];
}

function computeProdutosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const activeStatuses = new Set(['em linha', 'ativo', 'disponivel', 'disponível']);
    const active = list.filter(produto => activeStatuses.has(normalizeText(produto?.status))).length;
    const totalStock = list.reduce((sum, produto) => sum + safeNumber(produto?.quantidade_total), 0);
    const totalValue = list.reduce((sum, produto) => sum + safeNumber(produto?.quantidade_total) * safeNumber(produto?.preco_venda), 0);

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Produtos cadastrados',
            icon: 'fas fa-boxes-stacked',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatNumber(active, { fallback: '0' }),
            label: 'Ativos em linha',
            icon: 'fas fa-check-circle',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(totalStock, { fallback: '0' }),
            label: 'Estoque disponível',
            icon: 'fas fa-layer-group',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatCurrency(totalValue),
            label: 'Valor potencial',
            icon: 'fas fa-coins',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        })
    ];
}

function computeClientesKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const active = list.filter(cliente => normalizeText(cliente?.status_cliente) === 'ativo').length;
    const inadimplentes = list.filter(cliente => normalizeText(cliente?.status_cliente).includes('inadimpl')).length;
    const owners = new Set();
    list.forEach(cliente => {
        const owner = (cliente?.dono_cliente || '').trim();
        if (owner) owners.add(owner);
    });

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Clientes cadastrados',
            icon: 'fas fa-address-book',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(active, { fallback: '0' }),
            label: 'Clientes ativos',
            icon: 'fas fa-user-check',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(inadimplentes, { fallback: '0' }),
            label: 'Clientes inadimplentes',
            icon: 'fas fa-exclamation-circle',
            iconBg: 'bg-rose-500/20',
            iconColor: 'text-rose-300'
        }),
        createKpiItem({
            value: formatNumber(owners.size, { fallback: '0' }),
            label: 'Responsáveis únicos',
            icon: 'fas fa-user-tie',
            iconBg: 'bg-purple-500/20',
            iconColor: 'text-purple-300'
        })
    ];
}

function computeContatosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const withEmail = list.filter(contato => Boolean((contato?.email || '').trim())).length;
    const withPhone = list.filter(contato => {
        return Boolean((contato?.telefone_fixo || '').trim()) || Boolean((contato?.telefone_celular || '').trim());
    }).length;
    const companies = new Set();
    list.forEach(contato => {
        const company = (contato?.cliente || '').trim();
        if (company) companies.add(company);
    });

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Contatos cadastrados',
            icon: 'fas fa-id-badge',
            iconBg: 'bg-cyan-500/20',
            iconColor: 'text-cyan-300'
        }),
        createKpiItem({
            value: formatNumber(withEmail, { fallback: '0' }),
            label: 'Contatos com e-mail',
            icon: 'fas fa-envelope',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatNumber(withPhone, { fallback: '0' }),
            label: 'Contatos com telefone',
            icon: 'fas fa-phone',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(companies.size, { fallback: '0' }),
            label: 'Empresas atendidas',
            icon: 'fas fa-building',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        })
    ];
}

function computeProspeccoesKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const withOwner = list.filter(prospeccao => Boolean((prospeccao?.responsavel || '').trim())).length;
    const withContact = list.filter(prospeccao => {
        const email = (prospeccao?.email || '').trim();
        const phone = (prospeccao?.telefone || prospeccao?.celular || '').trim();
        return Boolean(email) || Boolean(phone);
    }).length;
    const statuses = new Set();
    list.forEach(prospeccao => {
        const status = normalizeText(prospeccao?.status);
        if (status) statuses.add(status);
    });

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Leads em aberto',
            icon: 'fas fa-bullseye',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(withOwner, { fallback: '0' }),
            label: 'Leads com responsável',
            icon: 'fas fa-user-tie',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(withContact, { fallback: '0' }),
            label: 'Leads com contato principal',
            icon: 'fas fa-address-card',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatNumber(statuses.size, { fallback: '0' }),
            label: 'Status distintos',
            icon: 'fas fa-chart-pie',
            iconBg: 'bg-purple-500/20',
            iconColor: 'text-purple-300'
        })
    ];
}

function computeOrcamentosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const totalValue = list.reduce((sum, orcamento) => sum + safeNumber(orcamento?.valor_final), 0);
    const approved = list.filter(orcamento => {
        const status = normalizeText(orcamento?.situacao);
        return status.includes('aprov') || status.includes('convert') || status.includes('aceit');
    }).length;
    const approvalRate = total > 0 ? (approved / total) * 100 : 0;

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Orçamentos emitidos',
            icon: 'fas fa-file-invoice',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(approved, { fallback: '0' }),
            label: 'Orçamentos aprovados',
            icon: 'fas fa-file-signature',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatCurrency(totalValue),
            label: 'Valor total orçado',
            icon: 'fas fa-coins',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        }),
        createKpiItem({
            value: formatPercent(approvalRate, { fallback: '0%' }),
            label: 'Taxa de aprovação',
            icon: 'fas fa-percentage',
            iconBg: 'bg-purple-500/20',
            iconColor: 'text-purple-300'
        })
    ];
}

function computePedidosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const totalValue = list.reduce((sum, pedido) => sum + safeNumber(pedido?.valor_final), 0);
    const deliveredStatuses = new Set(['entregue', 'concluido', 'concluído', 'faturado', 'finalizado']);
    const productionStatuses = new Set(['producao', 'produção', 'em producao', 'em produção']);
    const delivered = list.filter(pedido => deliveredStatuses.has(normalizeText(pedido?.situacao))).length;
    const inProduction = list.filter(pedido => productionStatuses.has(normalizeText(pedido?.situacao))).length;

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Pedidos emitidos',
            icon: 'fas fa-receipt',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(delivered, { fallback: '0' }),
            label: 'Pedidos entregues',
            icon: 'fas fa-truck',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(inProduction, { fallback: '0' }),
            label: 'Pedidos em produção',
            icon: 'fas fa-industry',
            iconBg: 'bg-indigo-500/20',
            iconColor: 'text-indigo-300'
        }),
        createKpiItem({
            value: formatCurrency(totalValue),
            label: 'Valor total faturado',
            icon: 'fas fa-coins',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        })
    ];
}

function computeUsuariosKpis(items = []) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const active = list.filter(usuario => normalizeText(usuario?.status) === 'ativo').length;
    const online = list.filter(usuario => Boolean(usuario?.online)).length;
    const profiles = new Set();
    list.forEach(usuario => {
        const perfil = (usuario?.perfil || '').trim();
        if (perfil) profiles.add(perfil);
    });

    return [
        createKpiItem({
            value: formatNumber(total, { fallback: '0' }),
            label: 'Usuários cadastrados',
            icon: 'fas fa-users',
            iconBg: 'bg-blue-500/20',
            iconColor: 'text-blue-300'
        }),
        createKpiItem({
            value: formatNumber(active, { fallback: '0' }),
            label: 'Usuários ativos',
            icon: 'fas fa-user-check',
            iconBg: 'bg-emerald-500/20',
            iconColor: 'text-emerald-300'
        }),
        createKpiItem({
            value: formatNumber(online, { fallback: '0' }),
            label: 'Usuários online',
            icon: 'fas fa-signal',
            iconBg: 'bg-amber-500/20',
            iconColor: 'text-amber-300'
        }),
        createKpiItem({
            value: formatNumber(profiles.size, { fallback: '0' }),
            label: 'Perfis diferentes',
            icon: 'fas fa-user-shield',
            iconBg: 'bg-purple-500/20',
            iconColor: 'text-purple-300'
        })
    ];
}

const REPORT_CONFIGS = {};

REPORT_CONFIGS['materia-prima'] = {
    columns: [
        { key: 'nome', label: 'Nome' },
        { key: 'colecao', label: 'Coleção' },
        { key: 'unidade', label: 'Unidade' },
        { key: 'quantidade', label: 'Quantidade' },
        { key: 'preco', label: 'Preço' },
        { key: 'processo', label: 'Processo' },
        { key: 'status', label: 'Status' }
    ],
    loadingMessage: 'Carregando matérias-primas...',
    emptyMessage: 'Nenhuma matéria-prima encontrada.',
    errorMessage: 'Não foi possível carregar as matérias-primas.',
    computeKpis: computeMateriaPrimaKpis,
    async fetchData() {
        if (!window.electronAPI?.listarMateriaPrima) {
            throw new Error('Integração com matérias-primas indisponível.');
        }
        const data = await window.electronAPI.listarMateriaPrima('');
        return Array.isArray(data) ? data : [];
    },
    renderRow(item) {
        const nome = formatText(item?.nome, '—');
        const categoria = formatText(item?.categoria, '—');
        const unidade = formatText(item?.unidade, '—');
        const quantidade = item?.infinito ? '∞' : formatNumber(item?.quantidade, { fallback: '0' });
        const precoRaw = item?.preco_unitario ?? item?.precoUnitario;
        const preco = formatCurrency(precoRaw, { fallback: '—' });
        const processo = formatText(item?.processo, '—');
        const status = getRawMaterialStatus(item);
        const statusBadge = createBadge(status.label, status.variant, { size: 'sm' });
        return `
            <tr class="transition-colors duration-150">
                <td data-column-key="nome" class="px-6 py-4 whitespace-normal break-words text-left text-sm font-medium text-white">${nome}</td>
                <td data-column-key="categoria" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${categoria}</td>
                <td data-column-key="unidade" class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${unidade}</td>
                <td data-column-key="quantidade" class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${quantidade}</td>
                <td data-column-key="preco" class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${preco}</td>
                <td data-column-key="processo" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${processo}</td>
                <td data-column-key="status" class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.produtos = {
    columns: [
        { key: 'codigo', label: 'Código' },
        { key: 'nome', label: 'Nome' },
        { key: 'colecao', label: 'Coleção' },
        { key: 'precoVenda', label: 'Preço de Venda' },
        { key: 'margem', label: 'Margem (%)' },
        { key: 'quantidade', label: 'Quantidade' },
        { key: 'status', label: 'Status' }
    ],
    loadingMessage: 'Carregando produtos...',
    emptyMessage: 'Nenhum produto encontrado.',
    errorMessage: 'Não foi possível carregar os produtos.',
    computeKpis: computeProdutosKpis,
    async fetchData() {
        try {
            const data = await (window.electronAPI?.listarProdutos?.() ?? []);
            if (!Array.isArray(data)) {
                console.warn('KPI manager (produtos): dados inválidos recebidos, usando lista vazia.', data);
                return [];
            }
            return data;
        } catch (error) {
            console.error('KPI manager (produtos): erro ao carregar produtos.', error);
            return [];
        }
    },
    renderRow(produto) {
        const codigo = formatText(produto?.codigo, '—');
        const nome = formatText(produto?.nome, '—');
        const colecao = formatText(produto?.colecao ?? produto?.categoria ?? produto?.linha, '—');
        const precoVenda = formatCurrency(produto?.preco_venda);
        const margem = Number.isFinite(Number(produto?.pct_markup))
            ? formatPercent(Number(produto.pct_markup))
            : '—';
        const quantidade = formatNumber(produto?.quantidade_total, { fallback: '0' });
        const statusLabel = produto?.status ? produto.status : '—';
        const statusBadge = createBadge(statusLabel, getProductStatusVariant(produto?.status), { size: 'sm' });
        return `
            <tr class="transition-colors duration-150">
                <td data-column-key="codigo" class="px-6 py-4 whitespace-nowrap text-left text-sm font-medium text-white">${codigo}</td>
                <td data-column-key="nome" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-white">${nome}</td>
                <td data-column-key="colecao" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${colecao}</td>
                <td data-column-key="precoVenda" class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${precoVenda}</td>
                <td data-column-key="margem" class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${margem}</td>
                <td data-column-key="quantidade" class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${quantidade}</td>
                <td data-column-key="status" class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.clientes = {
    columns: [
        { key: 'nome', label: 'Nome' },
        { key: 'cnpj', label: 'CNPJ' },
        { key: 'pais', label: 'País' },
        { key: 'estado', label: 'Estado' },
        { key: 'status', label: 'Status' },
        { key: 'dono', label: 'Dono' }
    ],
    loadingMessage: 'Carregando clientes...',
    emptyMessage: 'Nenhum cliente encontrado.',
    errorMessage: 'Não foi possível carregar os clientes.',
    computeKpis: computeClientesKpis,
    async fetchData() {
        const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/clientes/lista`);
        if (!Array.isArray(data)) return [];
        return data.sort((a, b) => normalizeText(a?.nome_fantasia).localeCompare(normalizeText(b?.nome_fantasia)));
    },
    renderRow(cliente) {
        const nome = formatText(cliente?.nome_fantasia, '—');
        const cnpj = formatText(cliente?.cnpj, '—');
        const pais = formatText(cliente?.pais, '—');
        const estado = formatText(cliente?.estado, '—');
        const dono = formatText(cliente?.dono_cliente, '—');
        const statusLabel = cliente?.status_cliente ? cliente.status_cliente : '—';
        const statusBadge = createBadge(statusLabel, getClientStatusVariant(cliente?.status_cliente), { size: 'sm' });

        return `
            <tr class="transition-colors duration-150">
                <td data-column-key="nome" class="px-6 py-4 whitespace-normal break-words text-left text-sm font-medium text-white">${nome}</td>
                <td data-column-key="cnpj" class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${cnpj}</td>
                <td data-column-key="pais" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${pais}</td>
                <td data-column-key="estado" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${estado}</td>
                <td data-column-key="status" class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
                <td data-column-key="dono" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${dono}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.contatos = {
    columns: [
        { key: 'contato', label: 'Contato' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'empresa', label: 'Empresa' },
        { key: 'celular', label: 'Celular' },
        { key: 'telefone', label: 'Telefone' },
        { key: 'email', label: 'E-mail' }
    ],
    loadingMessage: 'Carregando contatos...',
    emptyMessage: 'Nenhum contato encontrado.',
    errorMessage: 'Não foi possível carregar os contatos.',
    computeKpis: computeContatosKpis,
    async fetchData() {
        const data = await loadContactsReportData();
        return Array.isArray(data) ? data : [];
    },
    renderRow(contato) {
        const nome = formatText(contato?.nome, '—');
        const empresa = formatText(contato?.cliente, '—');
        const celular = formatPhone(contato?.telefone_celular);
        const telefone = formatPhone(contato?.telefone_fixo);
        const email = formatText(contato?.email, '—');
        const tipo = formatText(contato?.cargo, '—');
        const initials = getInitials(contato?.nome);
        const avatarColor = getAvatarColor(contato?.nome);
        const tipoBadge = createBadge(tipo !== '—' ? tipo : 'Contato', getContactTypeVariant(tipo), { size: 'sm' });

        return `
            <tr class="transition-colors duration-150">
                <td data-column-key="contato" class="px-6 py-4 text-left">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white" style="background:${avatarColor};">${initials}</div>
                        <div>
                            <p class="text-sm font-medium text-white whitespace-normal break-words">${nome}</p>
                            <p class="text-xs text-white/70 whitespace-normal break-words">${empresa}</p>
                        </div>
                    </div>
                </td>
                <td data-column-key="tipo" class="px-6 py-4 whitespace-nowrap text-left text-sm">${tipoBadge}</td>
                <td data-column-key="empresa" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${empresa}</td>
                <td data-column-key="celular" class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${celular}</td>
                <td data-column-key="telefone" class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${telefone}</td>
                <td data-column-key="email" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${email}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.prospeccoes = {
    columns: [
        { key: 'nome', label: 'Nome do Lead' },
        { key: 'email', label: 'E-mail' },
        { key: 'status', label: 'Status' },
        { key: 'responsavel', label: 'Responsável' }
    ],
    loadingMessage: 'Carregando prospecções...',
    emptyMessage: 'Nenhuma prospecção encontrada.',
    errorMessage: 'Não foi possível carregar as prospecções.',
    computeKpis: computeProspeccoesKpis,
    async fetchData() {
        const contatos = await loadContactsReportData();
        const contactMap = new Map();
        (Array.isArray(contatos) ? contatos : []).forEach(contato => {
            const clientId = contato?.id_cliente || contato?.clienteId;
            if (clientId && !contactMap.has(clientId)) {
                contactMap.set(clientId, contato);
            }
        });

        const leadStatuses = new Set([
            'prospect',
            'prospeccao',
            'prospecção',
            'negociacao',
            'negociação',
            'lead',
            'pendente',
            'contato inicial'
        ]);

        const leads = Array.from(contactMap.values())
            .filter(contato => leadStatuses.has(normalizeText(contato?.status_cliente)))
            .map(contato => {
                const clientId = contato?.id_cliente || contato?.clienteId || contato?.id;
                const nomeFantasia = contato?.cliente || contato?.nome_fantasia || '';
                return {
                    id: clientId,
                    nome: nomeFantasia,
                    email: contato?.email || '',
                    status: contato?.status_cliente || '',
                    responsavel: contato?.dono || contato?.dono_cliente || '',
                    telefone: contato?.telefone_fixo || '',
                    celular: contato?.telefone_celular || '',
                    empresa: nomeFantasia
                };
            })
            .sort((a, b) => normalizeText(a.nome).localeCompare(normalizeText(b.nome)));

        return leads;
    },
    renderRow(prospeccao) {
        const nome = formatText(prospeccao?.nome, '—');
        const email = formatText(prospeccao?.email, '—');
        const responsavel = formatText(prospeccao?.responsavel, '—');
        const statusLabel = prospeccao?.status ? prospeccao.status : '—';
        const statusBadge = createBadge(statusLabel, getClientStatusVariant(prospeccao?.status), { size: 'sm' });

        return `
            <tr class="transition-colors duration-150">
                <td data-column-key="nome" class="px-6 py-4 whitespace-normal break-words text-left text-sm font-medium text-white">${nome}</td>
                <td data-column-key="email" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${email}</td>
                <td data-column-key="status" class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
                <td data-column-key="responsavel" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${responsavel}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.orcamentos = {
    columns: [
        { key: 'codigo', label: 'Código' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'data', label: 'Data' },
        { key: 'valor', label: 'Valor Total' },
        { key: 'condicao', label: 'Condição' },
        { key: 'status', label: 'Status' }
    ],
    loadingMessage: 'Carregando orçamentos...',
    emptyMessage: 'Nenhum orçamento encontrado.',
    errorMessage: 'Não foi possível carregar os orçamentos.',
    computeKpis: computeOrcamentosKpis,
    async fetchData() {
        const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/orcamentos`);
        if (!Array.isArray(data)) return [];
        return data.sort((a, b) => normalizeText(a?.numero).localeCompare(normalizeText(b?.numero)));
    },
    renderRow(orcamento) {
        const codigo = formatText(orcamento?.numero, '—');
        const cliente = formatText(orcamento?.cliente, '—');
        const dataEmissao = formatDate(orcamento?.data_emissao);
        const valor = formatCurrency(orcamento?.valor_final);
        const parcelas = Number.parseInt(orcamento?.parcelas, 10);
        const condicao = Number.isFinite(parcelas) && parcelas > 1 ? `${parcelas}x` : 'À vista';
        const statusLabel = orcamento?.situacao ? orcamento.situacao : '—';
        const statusBadge = createBadge(statusLabel, getQuoteStatusVariant(orcamento?.situacao), { size: 'sm' });
        return `
            <tr class="transition-colors duration-150">
                <td data-column-key="codigo" class="px-6 py-4 whitespace-nowrap text-left text-sm font-medium text-white">${codigo}</td>
                <td data-column-key="cliente" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${cliente}</td>
                <td data-column-key="data" class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${dataEmissao}</td>
                <td data-column-key="valor" class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${valor}</td>
                <td data-column-key="condicao" class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${condicao}</td>
                <td data-column-key="status" class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.pedidos = {
    columns: [
        { key: 'codigo', label: 'Código' },
        { key: 'cliente', label: 'Cliente' },
        { key: 'data', label: 'Data' },
        { key: 'valor', label: 'Valor Total' },
        { key: 'condicao', label: 'Condição' },
        { key: 'status', label: 'Status' }
    ],
    loadingMessage: 'Carregando pedidos...',
    emptyMessage: 'Nenhum pedido encontrado.',
    errorMessage: 'Não foi possível carregar os pedidos.',
    computeKpis: computePedidosKpis,
    async fetchData() {
        const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/pedidos`);
        if (!Array.isArray(data)) return [];
        return data.sort((a, b) => normalizeText(a?.numero).localeCompare(normalizeText(b?.numero)));
    },
    renderRow(pedido) {
        const codigo = formatText(pedido?.numero, '—');
        const cliente = formatText(pedido?.cliente, '—');
        const dataEmissao = formatDate(pedido?.data_emissao);
        const valor = formatCurrency(pedido?.valor_final);
        const parcelas = Number.parseInt(pedido?.parcelas, 10);
        const condicao = Number.isFinite(parcelas) && parcelas > 1 ? `${parcelas}x` : 'À vista';
        const statusLabel = pedido?.situacao ? pedido.situacao : '—';
        const statusBadge = createBadge(statusLabel, getOrderStatusVariant(pedido?.situacao), { size: 'sm' });
        return `
            <tr class="transition-colors duration-150">
                <td data-column-key="codigo" class="px-6 py-4 whitespace-nowrap text-left text-sm font-medium text-white">${codigo}</td>
                <td data-column-key="cliente" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${cliente}</td>
                <td data-column-key="data" class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${dataEmissao}</td>
                <td data-column-key="valor" class="px-6 py-4 whitespace-nowrap text-left text-sm text-white">${valor}</td>
                <td data-column-key="condicao" class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${condicao}</td>
                <td data-column-key="status" class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

REPORT_CONFIGS.usuarios = {
    columns: [
        { key: 'avatar', label: 'Avatar' },
        { key: 'nome', label: 'Nome' },
        { key: 'email', label: 'E-mail' },
        { key: 'perfil', label: 'Perfil' },
        { key: 'situacao', label: 'Situação' },
        { key: 'status', label: 'Status' }
    ],
    loadingMessage: 'Carregando usuários...',
    emptyMessage: 'Nenhum usuário encontrado.',
    errorMessage: 'Não foi possível carregar os usuários.',
    computeKpis: computeUsuariosKpis,
    async fetchData() {
        const data = await fetchJson(`${RELATORIOS_API_BASE_URL}/api/usuarios/lista`);
        if (!Array.isArray(data)) return [];
        return data.sort((a, b) => normalizeText(a?.nome).localeCompare(normalizeText(b?.nome)));
    },
    renderRow(usuario) {
        const nome = formatText(usuario?.nome, '—');
        const email = formatText(usuario?.email, '—');
        const perfil = formatText(usuario?.perfil, '—');
        const statusLabel = usuario?.status ? usuario.status : '—';
        const statusBadge = createBadge(statusLabel, getUserStatusVariant(usuario?.status), { size: 'sm' });
        const onlineBadge = createBadge(usuario?.online ? 'Online' : 'Offline', usuario?.online ? 'success' : 'danger', { size: 'sm' });
        const ultimoLogin = usuario?.ultimoLoginEm
            ? formatDate(usuario.ultimoLoginEm)
            : (usuario?.ultimaAtividadeEm ? formatDate(usuario.ultimaAtividadeEm) : '—');
        const initials = getInitials(usuario?.nome);
        const avatarColor = getAvatarColor(usuario?.nome);

        return `
            <tr class="transition-colors duration-150">
                <td data-column-key="avatar" class="px-6 py-4 text-left">
                    <div class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white" style="background:${avatarColor};">${initials}</div>
                </td>
                <td data-column-key="nome" class="px-6 py-4 whitespace-normal break-words text-left text-sm font-medium text-white">${nome}</td>
                <td data-column-key="email" class="px-6 py-4 whitespace-normal break-words text-left text-sm text-gray-300">${email}</td>
                <td data-column-key="perfil" class="px-6 py-4 whitespace-nowrap text-left text-sm text-gray-300">${perfil}</td>
                <td data-column-key="situacao" class="px-6 py-4 whitespace-nowrap text-left text-sm">
                    <div class="flex flex-col gap-1">
                        <span>${onlineBadge}</span>
                        <span class="text-xs text-white/60">Último login: ${ultimoLogin}</span>
                    </div>
                </td>
                <td data-column-key="status" class="px-6 py-4 whitespace-nowrap text-left text-sm">${statusBadge}</td>
            </tr>
        `;
    }
};

function initRelatoriosModule() {
    const container = document.querySelector('.relatorios-module');
    if (!container) {
        relatoriosKpiManager = null;
        return;
    }

    // Garante que o body esteja liberado caso algum modal anterior tenha alterado o overflow
    document.body.style.overflow = '';

    applyEntranceAnimations(container);

    const initialTabButton = container.querySelector('[data-relatorios-tab].tab-active')
        || container.querySelector('[data-relatorios-tab]');
    const initialTabKey = initialTabButton?.dataset?.relatoriosTab || null;

    relatoriosKpiManager = createKpiManager(container, { initialTab: initialTabKey });
    const loadTableForTab = setupReportTables(container);
    initializeAllReportColumns();
    const columnControl = setupColumnVisibilityControl(container);
    const tabController = setupCategoryTabs(container, {
        onTabChange: (tab, button, previousTab) => {
            if (columnControl && previousTab) {
                columnControl.resetReport(previousTab);
            }
            if (columnControl) {
                columnControl.setActiveReport(tab);
            }
            if (loadTableForTab) {
                loadTableForTab(tab);
            }
        }
    });
    setupResultTabs(container);
    setupDropdowns(container);
    setupExportActions(container, {
        getActiveTab: () => tabController?.getActiveTab?.() || initialTabKey
    });
    setupModals(container);
    setupShare(container);
    setupGeoFilters(container);
    setupFilterInteractions(container);
    setupDateRangeFilters(container);

    const activeTabKey = tabController?.getActiveTab?.() || initialTabKey;
    if (columnControl && activeTabKey) {
        columnControl.setActiveReport(activeTabKey);
    }

    if (initialTabKey && loadTableForTab) {
        loadTableForTab(initialTabKey);
    }
}

function setupCategoryTabs(root, options = {}) {
    const { onTabChange } = options;
    const tabButtons = Array.from(root.querySelectorAll('[data-relatorios-tab]'));
    if (!tabButtons.length) return;

    const filterSections = Array.from(root.querySelectorAll('[data-relatorios-tab-content]'));
    const kpiSections = Array.from(root.querySelectorAll('[data-relatorios-kpi]'));

    let activeTab = null;

    const applyVisibility = target => {
        filterSections.forEach(section => {
            section.classList.toggle('hidden', section.dataset.relatoriosTabContent !== target);
        });

        kpiSections.forEach(section => {
            section.classList.toggle('hidden', section.dataset.relatoriosKpi !== target);
        });
    };

    const updateButtonsState = activeButton => {
        tabButtons.forEach(btn => {
            const isActive = btn === activeButton;
            btn.classList.toggle('tab-active', isActive);
            btn.classList.toggle('tab-inactive', !isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    };

    const activateTab = (button, { emitEvent = true } = {}) => {
        const target = button?.dataset?.relatoriosTab;
        const previous = activeTab;
        if (!target || target === previous) return;

        if (previous) {
            resetFiltersForKey(previous, root);
        }

        activeTab = target;
        updateButtonsState(button);
        applyVisibility(target);
        if (relatoriosKpiManager?.setActiveKey) {
            relatoriosKpiManager.setActiveKey(target);
        }

        if (emitEvent && typeof onTabChange === 'function') {
            onTabChange(target, button, previous);
        }
    };

    const initialButton = tabButtons.find(btn => btn.classList.contains('tab-active')) || tabButtons[0];
    if (initialButton) {
        activeTab = initialButton.dataset?.relatoriosTab || null;
        updateButtonsState(initialButton);
        applyVisibility(activeTab);
        if (relatoriosKpiManager?.setActiveKey && activeTab) {
            relatoriosKpiManager.setActiveKey(activeTab);
        }
    }

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (button.classList.contains('tab-active')) return;
            activateTab(button);
        });
    });

    return {
        getActiveTab: () => activeTab,
        activateTab: (target, options = {}) => {
            const button = tabButtons.find(btn => btn.dataset?.relatoriosTab === target);
            if (button) {
                activateTab(button, options);
            }
        }
    };
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

    const loadTable = async key => {
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
            populateReportTable(key, container).catch(error => {
                console.error(`Erro ao carregar tabela do relatório "${key}"`, error);
            });
        } else if (fallback) {
            container.appendChild(fallback.content.cloneNode(true));
        } else {
            container.innerHTML = '<p class="text-sm text-white/70">Tabela não disponível para esta categoria.</p>';
        }
    };

    return loadTable;
}

async function populateReportTable(key, container) {
    const config = REPORT_CONFIGS[key];
    if (!config) {
        container.innerHTML = '<p class="text-sm text-white/70">Configuração de relatório não encontrada.</p>';
        if (relatoriosKpiManager) {
            relatoriosKpiManager.setUnavailable(key);
        }
        return;
    }

    const tableRoot = container.querySelector('[data-relatorios-table-root]') || container;
    const table = tableRoot.querySelector('table');
    const tbody = tableRoot.querySelector('[data-relatorios-body]');

    if (!table || !tbody) {
        console.warn(`Estrutura de tabela ausente para o relatório "${key}".`);
        if (relatoriosKpiManager) {
            relatoriosKpiManager.setUnavailable(key);
        }
        return;
    }

    initializeReportColumns(key, config);
    const applyColumns = () => applyColumnVisibilityToTable(key, tableRoot);

    const showMessage = message => {
        tbody.innerHTML = createMessageRow(table, message);
        applyColumns();
    };

    showMessage(config.loadingMessage || 'Carregando dados...');
    if (relatoriosKpiManager) {
        relatoriosKpiManager.setLoading(key);
    }

    try {
        const data = await getReportData(key, config);
        if (relatoriosKpiManager) {
            relatoriosKpiManager.setData(key, data, config);
        }
        if (container.dataset.currentTab !== key) {
            return;
        }

        const moduleRoot = container.closest('.relatorios-module');

        syncFilterOptions(key, data, moduleRoot);

        if (!Array.isArray(data) || data.length === 0) {
            const renderEmpty = () => {
                showMessage(config.emptyMessage || 'Nenhum registro encontrado.');
            };
            reportTableRenderers.set(key, renderEmpty);
            renderEmpty();
            return;
        }

        const render = () => {
            const filtered = applyReportFilters(key, data, moduleRoot);
            if (!Array.isArray(filtered) || filtered.length === 0) {
                tbody.innerHTML = createMessageRow(table, config.filteredEmptyMessage || FILTERED_EMPTY_MESSAGE);
                applyColumns();
                return;
            }

            const rows = filtered
                .map(item => {
                    try {
                        return config.renderRow(item);
                    } catch (error) {
                        console.error(`Erro ao renderizar linha do relatório "${key}"`, error, item);
                        return '';
                    }
                })
                .filter(Boolean)
                .join('');

            if (!rows) {
                tbody.innerHTML = createMessageRow(table, config.filteredEmptyMessage || config.emptyMessage || FILTERED_EMPTY_MESSAGE);
                applyColumns();
                return;
            }

            tbody.innerHTML = rows;
            applyColumns();
        };

        render();
        reportTableRenderers.set(key, render);
    } catch (error) {
        console.error(`Erro ao popular relatório "${key}"`, error);
        if (relatoriosKpiManager) {
            relatoriosKpiManager.setError(key, config.errorMessage || 'Não foi possível carregar os dados.');
        }
        if (container.dataset.currentTab !== key) {
            return;
        }
        showMessage(config.errorMessage || 'Não foi possível carregar os dados.');
        reportTableRenderers.delete(key);
    }
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
    const dropdownConfigs = [
        {
            button: root.querySelector('#relatoriosLoadTemplateBtn'),
            dropdown: root.querySelector('#relatoriosTemplateDropdown')
        },
        {
            button: root.querySelector('#relatoriosExportBtn'),
            dropdown: root.querySelector('#relatoriosExportDropdown')
        }
    ];

    const columnButton = root.querySelector('#relatoriosColumnVisibilityBtn');
    const columnDropdown = root.querySelector('#relatoriosColumnDropdown');
    if (columnButton && columnDropdown) {
        dropdownConfigs.push({ button: columnButton, dropdown: columnDropdown });
    }

    const configs = dropdownConfigs.filter(({ button, dropdown }) => button && dropdown);

    const closeDropdowns = () => {
        configs.forEach(({ dropdown }) => dropdown.classList.remove('visible'));
    };

    configs.forEach(({ button, dropdown }) => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            if (button.disabled) {
                closeDropdowns();
                return;
            }
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

async function handleReportExport(root, key, type) {
    const data = collectTableDataForExport(root, key);
    if (!data) {
        showRelatoriosToast('Tabela não disponível para exportação.', 'warning');
        return;
    }

    const { headers, rows, tbody } = data;
    if (!rows.length) {
        const message = sanitizeTableCellText(tbody?.textContent || '');
        if (message && /carregando/i.test(message)) {
            showRelatoriosToast('Aguarde o carregamento dos dados antes de exportar.', 'info');
        } else {
            showRelatoriosToast('Nenhum dado disponível para exportação.', 'info');
        }
        return;
    }

    const title = createReportTitle(root, key);

    if (type === 'csv') {
        const content = createCsvContent(headers, rows);
        downloadBlobFromContent(content, 'text/csv;charset=utf-8;', createReportFileName(key, title, 'csv'));
        showRelatoriosToast('Relatório exportado em CSV.', 'success');
        return;
    }

    if (type === 'excel') {
        const tableHtml = buildHtmlTable(headers, rows);
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${tableHtml}</body></html>`;
        downloadBlobFromContent(`\ufeff${html}`, 'application/vnd.ms-excel', createReportFileName(key, title, 'xls'));
        showRelatoriosToast('Relatório exportado em Excel.', 'success');
        return;
    }

    if (type === 'pdf') {
        await exportReportAsPdf(title, headers, rows, createReportFileName(key, title, 'pdf'));
        showRelatoriosToast('Relatório exportado em PDF.', 'success');
        return;
    }

    if (type === 'print') {
        openReportPrintWindow(title, headers, rows);
        showRelatoriosToast('Preparando visualização para impressão...', 'info');
        return;
    }

    showRelatoriosToast('Formato de exportação não suportado.', 'error');
}

function setupExportActions(root, options = {}) {
    if (!root) return;
    const dropdown = root.querySelector('#relatoriosExportDropdown');
    const button = root.querySelector('#relatoriosExportBtn');
    const tableContainer = root.querySelector('#relatoriosTableContainer');
    if (!dropdown || !button || !tableContainer) return;

    const items = Array.from(dropdown.querySelectorAll('[data-relatorios-export]'));
    if (!items.length) return;

    const { getActiveTab } = options;

    const resolveKey = () => {
        const current = tableContainer.dataset?.currentTab;
        if (current) return current;
        if (typeof getActiveTab === 'function') {
            return getActiveTab();
        }
        return null;
    };

    const closeDropdown = () => {
        dropdown.classList.remove('visible');
    };

    items.forEach(item => {
        item.addEventListener('click', event => {
            event.preventDefault();
            if (button.disabled) {
                closeDropdown();
                return;
            }

            closeDropdown();

            const type = item.dataset.relatoriosExport;
            const key = resolveKey();
            if (!type) return;

            if (!key) {
                showRelatoriosToast('Selecione uma categoria de relatório antes de exportar.', 'info');
                return;
            }

            handleReportExport(root, key, type).catch(error => {
                console.error(`Erro ao exportar relatório (${type})`, error);
                showRelatoriosToast('Não foi possível exportar o relatório.', 'error');
            });
        });
    });
}

function setupColumnVisibilityControl(root) {
    const button = root.querySelector('#relatoriosColumnVisibilityBtn');
    const dropdown = root.querySelector('#relatoriosColumnDropdown');
    const list = root.querySelector('#relatoriosColumnList');
    if (!button || !dropdown || !list) return null;

    const feedback = dropdown.querySelector('[data-column-feedback]');
    const countLabel = button.querySelector('.relatorios-column-count');
    const tableContainer = root.querySelector('#relatoriosTableContainer');
    const defaultMessage = '<p class="px-4 py-2 text-sm text-white/60">Selecione um relatório para personalizar.</p>';
    let activeKey = null;

    const updateFeedback = message => {
        if (!feedback) return;
        if (message) {
            feedback.textContent = message;
            feedback.classList.remove('hidden');
        } else {
            feedback.textContent = '';
            feedback.classList.add('hidden');
        }
    };

    const updateCountLabel = key => {
        if (!countLabel) return;
        if (!key) {
            countLabel.textContent = '';
            return;
        }
        const config = REPORT_CONFIGS?.[key];
        if (!config?.columns?.length) {
            countLabel.textContent = '';
            return;
        }
        const visibleCount = getVisibleColumnKeys(key).length;
        countLabel.textContent = `(${visibleCount}/${config.columns.length})`;
    };

    const disableControl = () => {
        activeKey = null;
        button.disabled = true;
        list.innerHTML = defaultMessage;
        updateCountLabel(null);
        updateFeedback('');
    };

    const renderOptions = key => {
        const config = REPORT_CONFIGS?.[key];
        activeKey = key;
        if (!config?.columns?.length) {
            button.disabled = true;
            list.innerHTML = '<p class="px-4 py-2 text-sm text-white/60">Este relatório não possui colunas personalizáveis.</p>';
            updateCountLabel(null);
            updateFeedback('');
            return;
        }

        initializeReportColumns(key, config);
        const visibleSet = new Set(getVisibleColumnKeys(key));
        button.disabled = false;
        list.innerHTML = '';
        updateFeedback('');

        config.columns.forEach(column => {
            const option = document.createElement('label');
            option.className = 'flex items-center gap-3 px-4 py-2 text-sm text-white/80 hover:bg-white/10 cursor-pointer';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'relatorios-filter-checkbox w-4 h-4 rounded border-white/30 bg-transparent';
            checkbox.checked = visibleSet.has(column.key);
            checkbox.dataset.columnKey = column.key;

            const labelText = document.createElement('span');
            labelText.textContent = column.label || column.key;

            option.appendChild(checkbox);
            option.appendChild(labelText);
            list.appendChild(option);

            checkbox.addEventListener('change', () => {
                const isChecked = checkbox.checked;
                const currentVisible = new Set(getVisibleColumnKeys(key));
                if (!isChecked && currentVisible.size <= 1 && currentVisible.has(column.key)) {
                    checkbox.checked = true;
                    updateFeedback('Pelo menos uma coluna deve permanecer visível.');
                    return;
                }

                const updated = setColumnVisibility(key, column.key, isChecked);
                if (!updated) {
                    checkbox.checked = !isChecked;
                    updateFeedback('Não foi possível atualizar as colunas exibidas.');
                    return;
                }

                updateFeedback('');
                updateCountLabel(key);

                if (tableContainer?.dataset.currentTab === key) {
                    const renderer = reportTableRenderers.get(key);
                    if (typeof renderer === 'function') {
                        renderer();
                    } else if (tableContainer) {
                        const currentTableRoot = tableContainer.querySelector('[data-relatorios-table-root]') || tableContainer;
                        applyColumnVisibilityToTable(key, currentTableRoot);
                    }
                }
            });
        });

        updateCountLabel(key);
    };

    disableControl();

    return {
        setActiveReport: key => {
            if (!key) {
                disableControl();
                return;
            }
            renderOptions(key);
        },
        resetReport: key => {
            if (!key) return;
            resetReportColumnsToDefault(key);
            if (tableContainer?.dataset.currentTab === key) {
                const currentTableRoot = tableContainer.querySelector('[data-relatorios-table-root]') || tableContainer;
                applyColumnVisibilityToTable(key, currentTableRoot);
            }
            if (activeKey === key) {
                renderOptions(key);
            }
        },
        refresh: () => {
            if (activeKey) {
                renderOptions(activeKey);
            }
        }
    };
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
        if (!window.GeoMultiSelect?.initInContainer) {
            return;
        }

        const geoState = new Map();
        const geoMappings = new Map();
        const geoInputs = Array.from(root.querySelectorAll('[data-geo-input]'));

        geoInputs.forEach(input => {
            const geoKey = input.dataset.geoInput;
            if (!geoKey || geoMappings.has(geoKey)) return;
            geoMappings.set(geoKey, {
                input,
                filterGroup: input.dataset.relatoriosFilter || null,
                filterKey: input.dataset.filterKey || null
            });
            geoState.set(geoKey, {
                key: geoKey,
                values: [],
                labels: [],
                items: []
            });
        });

        const controller = window.GeoMultiSelect.initInContainer(root, {
            module: 'relatorios',
            onChange: detail => {
                if (!detail?.key) return;
                const normalizedDetail = {
                    key: detail.key,
                    values: Array.isArray(detail.values) ? detail.values.slice() : [],
                    labels: Array.isArray(detail.labels) ? detail.labels.slice() : [],
                    items: Array.isArray(detail.items)
                        ? detail.items.map(item => ({ ...item }))
                        : []
                };
                geoState.set(detail.key, normalizedDetail);

                const mapping = geoMappings.get(detail.key);
                if (mapping?.input) {
                    mapping.input.value = normalizedDetail.values.join(',');
                }

                document.dispatchEvent(new CustomEvent('relatorios:geo-filter-change', {
                    detail: normalizedDetail
                }));
            }
        });

        if (controller) {
            root.__relatoriosGeoController = controller;
        }
        root.__relatoriosGeoState = geoState;
        root.__relatoriosGeoMappings = geoMappings;
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
