// Script principal do módulo Prospecções (CRM)
// Responsável por carregar leads, movimentar no funil e registrar interações

function carregarProspeccoes() {
    // TODO: integrar com API para obter lista de leads
    console.log('Prospecções carregadas');
}

function avancarEtapa(leadId, etapaAtual) {
    // TODO: enviar atualização de etapa ao backend
    console.log(`Avançar lead ${leadId} da etapa ${etapaAtual}`);
}

function agendarContato(leadId) {
    // TODO: criar agendamento de follow-up
    console.log(`Agendar contato para lead ${leadId}`);
}

function registrarHistorico(leadId, observacao) {
    // TODO: salvar observação de contato
    console.log(`Histórico do lead ${leadId}: ${observacao}`);
}

function updateEmptyStateProspeccoes() {
    const wrapper = document.getElementById('prospeccoesTableWrapper');
    const empty = document.getElementById('prospeccoesEmptyState');
    const tbody = wrapper?.querySelector('tbody');
    if (!wrapper || !empty || !tbody) return;
    const hasData = Array.from(tbody.querySelectorAll('tr')).some(r => r.style.display !== 'none');
    if (hasData) {
        wrapper.classList.remove('hidden');
        empty.classList.add('hidden');
    } else {
        wrapper.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

function openModalWithSpinner(htmlPath, scriptPath, overlayId) {
    Modal.closeAll();
    const spinner = document.createElement('div');
    spinner.id = 'modalLoading';
    spinner.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    spinner.style.zIndex = 'var(--z-dialog)';
    spinner.innerHTML = '<div class="w-16 h-16 border-4 border-[#b6a03e] border-t-transparent rounded-full animate-spin"></div>';
    document.body.appendChild(spinner);
    const start = Date.now();
    function handleLoaded(e) {
        if (e.detail !== overlayId) return;
        const overlay = document.getElementById(`${overlayId}Overlay`);
        const elapsed = Date.now() - start;
        const show = () => {
            spinner.remove();
            overlay.classList.remove('hidden');
        };
        if (elapsed < 3000) {
            setTimeout(show, Math.max(0, 2000 - elapsed));
        } else {
            show();
        }
        window.removeEventListener('modalSpinnerLoaded', handleLoaded);
    }
    window.addEventListener('modalSpinnerLoaded', handleLoaded);
    Modal.open(htmlPath, scriptPath, overlayId, true);
}

function initProspeccoes() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    const container = document.querySelector('.modulo-container');
    setupProspeccoesGeoFilters(container);

    carregarProspeccoes();

    document.getElementById('btnNovaProspeccao')?.addEventListener('click', () => {
        console.log('Criar nova prospecção');
    });
    document.getElementById('prospeccoesEmptyNew')?.addEventListener('click', () => {
        document.getElementById('btnNovaProspeccao')?.click();
    });

    document.getElementById('btnImportarLeads')?.addEventListener('click', () => {
        alert('Função em desenvolvimento');
    });
    document.getElementById('btnOcultarGraficoFunil')?.addEventListener('click', () => {
        alert('Função em desenvolvimento');
    });
    document.getElementById('btnFiltrarProspeccoes')?.addEventListener('click', () => {
        alert('Função em desenvolvimento');
    });
    document.getElementById('btnLimparProspeccoes')?.addEventListener('click', () => {
        alert('Função em desenvolvimento');
    });

    // Exemplo de uso das funções
    document.querySelectorAll('.fa-edit').forEach(icon => {
        icon.addEventListener('click', () => avancarEtapa('1', 'novo'));
    });

    document.querySelectorAll('.fa-eye').forEach(icon => {
        icon.addEventListener('click', () => {
            const row = icon.closest('tr');
            if (row) {
                const [nameCell, emailCell, statusCell, ownerCell] = row.querySelectorAll('td');
                const name = nameCell?.textContent.trim() || '';
                const email = emailCell?.textContent.trim() || '';
                const status = statusCell?.textContent.trim() || '';
                const ownerName = ownerCell?.textContent.trim() || '';
                const limit = (str, max) => str && str.length > max ? str.slice(0, max) : str;
                const company = limit(row.dataset.company?.trim() || '', 60);
                const phone = limit(row.dataset.phone?.trim() || '', 20);
                const cell = limit(row.dataset.cell?.trim() || '', 20);
                const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                window.prospectDetails = {
                    initials,
                    name,
                    company,
                    ownerName,
                    email,
                    phone,
                    cell,
                    status
                };
            }
            openModalWithSpinner('modals/prospeccoes/detalhes.html', '../js/modals/prospeccao-detalhes.js', 'detalhesProspeccao');
        });
    });

    document.querySelectorAll('.fa-trash').forEach(icon => {
        icon.addEventListener('click', () => {
            if (confirm('Deletar este prospect?')) {
                console.log('Prospect deletado');
            }
        });
    });

    updateEmptyStateProspeccoes();
}

function loadProspeccoesScriptOnce(src) {
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

async function setupProspeccoesGeoFilters(root) {
    if (!root) return;
    try {
        if (!window.GeoMultiSelect?.initInContainer) {
            await loadProspeccoesScriptOnce('../js/utils/geo-multiselect.js');
        }
        if (window.GeoMultiSelect?.initInContainer) {
            window.GeoMultiSelect.initInContainer(root, {
                module: 'prospeccoes',
                onChange: detail => {
                    document.dispatchEvent(new CustomEvent('prospeccoes:geo-filter-change', {
                        detail
                    }));
                }
            });
        }
    } catch (error) {
        console.error('Falha ao carregar seleção geográfica em Prospecções', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProspeccoes);
} else {
    initProspeccoes();
}
