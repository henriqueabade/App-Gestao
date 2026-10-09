// Script principal do módulo Contatos (CRM): fornecedores, prestadores de
// serviço e parceiros — o mesmo desenho do módulo Clientes (clientes.js).
// Lista GET /api/contatos/lista; a ficha, o cadastro e a exclusão são modais.

async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
}

let todosContatos = [];
// O que está na tabela agora (com o filtro aplicado): é o que "Exportar CSV" leva.
let contatosNaTela = [];

// ------------------------------------------------------------ funções puras
// Recortadas por src/js/__tests__/contatosModulo.test.js.

/** Busca por nome, razão social, CNPJ/CPF (com ou sem pontuação), cidade ou e-mail; filtros por tipo e status. */
function filtrarContatos(lista, { termo = '', tipo = '', status = '' } = {}) {
    const t = String(termo || '').trim().toLowerCase();
    const digitos = t.replace(/\D/g, '');
    return (Array.isArray(lista) ? lista : []).filter(c => {
        const matchTermo = !t
            || String(c.nome || '').toLowerCase().includes(t)
            || String(c.razao_social || '').toLowerCase().includes(t)
            || (digitos.length >= 3 && String(c.cnpj || c.cpf || '').includes(digitos))
            || String(c.documento || '').toLowerCase().includes(t)
            || String(c.cidade || '').toLowerCase().includes(t)
            || String(c.email || '').toLowerCase().includes(t);
        const matchTipo = !tipo || String(c.tipo || '') === tipo;
        const matchStatus = !status || String(c.status || '') === status;
        return matchTermo && matchTipo && matchStatus;
    });
}

/** Os totais da barra: o total e um por tipo (sem tipo vira "Sem tipo"). */
function totaisPorTipo(lista) {
    const contagem = new Map();
    for (const c of Array.isArray(lista) ? lista : []) {
        const tipo = c.tipo || 'Sem tipo';
        contagem.set(tipo, (contagem.get(tipo) || 0) + 1);
    }
    return { total: (lista || []).length, porTipo: [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')) };
}

function badgeForStatus(status) {
    const map = { 'Ativo': 'badge-success', 'Inativo': 'badge-danger' };
    const classe = map[status] || 'badge-neutral';
    return `<span class="${classe} px-3 py-1 rounded-full text-xs font-medium">${escaparHtml(status || '—')}</span>`;
}

function escaparHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// ------------------------------------------------------- fim das funções puras

async function carregarContatos(preserveFilters = false) {
    try {
        const resp = await fetchApi('/api/contatos/lista');
        const corpo = await resp.json().catch(() => null);
        const aviso = document.getElementById('contatosSqlAviso');
        if (!resp.ok) {
            todosContatos = [];
            if (aviso) {
                aviso.textContent = corpo?.error || `Não foi possível carregar os contatos (HTTP ${resp.status}).`;
                aviso.style.color = 'var(--color-red)';
                aviso.classList.remove('hidden');
            }
            renderContatos([]);
            renderTotais([]);
            return;
        }
        aviso?.classList.add('hidden');
        todosContatos = Array.isArray(corpo) ? corpo : [];
        if (preserveFilters) {
            const buscaVal = document.getElementById('filtroBusca')?.value || '';
            const tipoVal = document.getElementById('filtroTipo')?.value || '';
            const statusVal = document.getElementById('filtroStatus')?.value || '';
            popularFiltros(todosContatos);
            const buscaEl = document.getElementById('filtroBusca');
            const tipoEl = document.getElementById('filtroTipo');
            const statusEl = document.getElementById('filtroStatus');
            if (buscaEl) buscaEl.value = buscaVal;
            if (tipoEl) tipoEl.value = tipoVal;
            if (statusEl) statusEl.value = statusVal;
            aplicarFiltros();
        } else {
            popularFiltros(todosContatos);
            renderContatos(todosContatos);
            renderTotais(todosContatos);
        }
    } catch (err) {
        console.error('Erro ao carregar contatos', err);
    }
}

function updateEmptyStateContatos(hasData) {
    const tableWrapper = document.getElementById('contatosTableWrapper');
    const emptyState = document.getElementById('contatosEmptyState');
    if (!tableWrapper || !emptyState) return;
    if (hasData) {
        tableWrapper.classList.remove('hidden');
        emptyState.classList.add('hidden');
    } else {
        tableWrapper.classList.add('hidden');
        emptyState.classList.remove('hidden');
    }
}

function popularFiltros(contatos) {
    const tipoSel = document.getElementById('filtroTipo');
    const statusSel = document.getElementById('filtroStatus');
    if (tipoSel) {
        const tipos = [...new Set(contatos.map(c => c.tipo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        tipoSel.innerHTML = '<option value="">Todos</option>' + tipos.map(t => `<option value="${escaparHtml(t)}">${escaparHtml(t)}</option>`).join('');
    }
    if (statusSel) {
        const statusList = [...new Set(contatos.map(c => c.status).filter(Boolean))].sort();
        statusSel.innerHTML = '<option value="">Todos</option>' + statusList.map(s => `<option value="${escaparHtml(s)}">${escaparHtml(s)}</option>`).join('');
    }
}

function aplicarFiltros() {
    const filtrados = filtrarContatos(todosContatos, {
        termo: document.getElementById('filtroBusca')?.value || '',
        tipo: document.getElementById('filtroTipo')?.value || '',
        status: document.getElementById('filtroStatus')?.value || ''
    });
    renderContatos(filtrados);
    renderTotais(filtrados);
}

function limparFiltros() {
    for (const id of ['filtroBusca', 'filtroTipo', 'filtroStatus']) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    }
    renderContatos(todosContatos);
    renderTotais(todosContatos);
}

function renderContatos(contatos) {
    contatosNaTela = Array.isArray(contatos) ? contatos : [];
    const tbody = document.getElementById('contatosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    contatosNaTela.forEach((c) => {
        const tr = document.createElement('tr');
        tr.className = 'transition-colors duration-150';
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
            <td data-perm-col="col_ctt_nome" class="px-6 py-4 whitespace-nowrap text-sm text-white">${escaparHtml(c.nome)}</td>
            <td data-perm-col="col_ctt_tipo" class="px-6 py-4 whitespace-nowrap"><span class="badge-info px-3 py-1 rounded-full text-xs font-medium">${escaparHtml(c.tipo || 'Sem tipo')}</span></td>
            <td data-perm-col="col_ctt_cnpj" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${escaparHtml(c.documento || '—')}</td>
            <td data-perm-col="col_ctt_tel" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${escaparHtml(c.telefone_celular || '—')}</td>
            <td data-perm-col="col_ctt_fixo" class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--color-violet)">${escaparHtml(c.telefone_fixo || '—')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-left">
                <div class="flex items-center justify-start space-x-2">
                    <i data-perm="ctt.details.view" class="fas fa-eye w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Visualizar"></i>
                    <i data-perm="ctt.person.add" class="fas fa-user-plus action-new-person w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Nova pessoa de contato"></i>
                    <i data-perm="ctt.edit" class="fas fa-edit w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-primary)" title="Editar"></i>
                    <i data-perm="ctt.delete" class="fas fa-trash w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10" style="color: var(--color-red)" title="Excluir"></i>
                </div>
            </td>`;
        tr.querySelector('.fa-eye')?.addEventListener('click', (e) => { e.stopPropagation(); abrirDetalhesContato(c); });
        tr.querySelector('.fa-edit')?.addEventListener('click', (e) => { e.stopPropagation(); abrirEditarContato(c); });
        tr.querySelector('.action-new-person')?.addEventListener('click', (e) => { e.stopPropagation(); abrirEditarContato(c, { tabId: 'tab-pessoas', abrirNovaPessoa: true }); });
        tr.querySelector('.fa-trash')?.addEventListener('click', (e) => { e.stopPropagation(); abrirExcluirContato(c); });
        tbody.appendChild(tr);
    });
    updateEmptyStateContatos(contatosNaTela.length > 0);
}

function openModalWithSpinner(htmlPath, scriptPath, overlayId) {
    // Um spinner só no programa inteiro (src/utils/modal.js › openModuleModal,
    // desempenho 06/10/2026): fecha os outros modais, revela o overlay quando o
    // modal avisa `modalSpinnerLoaded` (tira o `hidden` — classList.remove('hidden')),
    // com o piso de 1 s de sempre, relógio de segurança e limpeza se fechar
    // antes. Antes eram nove cópias desta função, sem relógio: modal que desse
    // erro deixava a tela escura presa.
    return Modal.openModuleModal(htmlPath, scriptPath, overlayId);
}

function abrirDetalhesContato(contato) {
    window.contatoDetalhes = contato;
    openModalWithSpinner('modals/contatos/detalhes.html', '../js/modals/contato-detalhes.js', 'detalhesContato');
}

function abrirEditarContato(contato, options = {}) {
    window.contatoEditar = contato;
    if (options && Object.keys(options).length) window.contatoEditarPreferencias = { ...options };
    else delete window.contatoEditarPreferencias;
    openModalWithSpinner('modals/contatos/editar.html', '../js/modals/contato-editar.js', 'editarContato');
}

function abrirExcluirContato(contato) {
    window.contatoExcluir = contato;
    Modal.open('modals/contatos/excluir.html', '../js/modals/contato-excluir.js', 'excluirContato');
}

// A ficha reabre o editar; o sino (src/js/notifications.js) abre a ficha a partir de um aviso.
window.abrirEditarContato = abrirEditarContato;
window.ContatosModulo = { abrirDetalhes: abrirDetalhesContato, carregar: carregarContatos };

window.addEventListener('contatoEditado', () => carregarContatos(true));
window.addEventListener('contatoExcluido', () => carregarContatos(true));
window.addEventListener('contatoAdicionado', () => carregarContatos(true));

function renderTotais(contatos) {
    const container = document.getElementById('totaisBadges');
    if (!container) return;
    const { total, porTipo } = totaisPorTipo(contatos);
    const badges = [`<span class="badge-neutral px-3 py-1 rounded-full text-xs font-medium">Total: ${total}</span>`];
    for (const [tipo, count] of porTipo) {
        badges.push(`<span class="badge-info px-3 py-1 rounded-full text-xs font-medium">${escaparHtml(tipo)}: ${count}</span>`);
    }
    container.innerHTML = badges.join('');
}

function initContatos() {
    // A entrada em cascata é só do CSS (`animate-fade-in-up`, um bloco depois do
    // outro, como no Financeiro). Não ponha opacity/transform inline aqui: o
    // fadeInUp parte do valor que o bloco já tem, e com opacity 1 a animação
    // ficava invisível (06/10/2026).

    document.getElementById('btnFiltrar')?.addEventListener('click', aplicarFiltros);
    document.getElementById('btnLimpar')?.addEventListener('click', limparFiltros);
    // A busca filtra enquanto digita (08/10/2026), como em todos os módulos; Enter não espera.
    window.BuscaAoDigitar?.ligar(document.getElementById('filtroBusca'), aplicarFiltros);
    document.getElementById('btnNovoContato')?.addEventListener('click', () => {
        openModalWithSpinner('modals/contatos/novo.html', '../js/modals/contato-novo.js', 'novoContato');
    });

    // Ações Rápidas: planilha (src/js/utils/acoes-csv.js). Relatório e
    // e-mail em massa ainda em construção, como em Clientes.
    window.AcoesCsv?.ligarMenu({
        container: document.getElementById('acoesRapidasContainer'),
        botao: document.getElementById('btnAcoesRapidas'),
        menu: document.getElementById('menuAcoesRapidas')
    });
    const planilha = { modulo: 'contatos', rotulo: 'contatos', singular: 'contato' };
    document.getElementById('btnExportarCSV')?.addEventListener('click', () => {
        window.AcoesCsv?.exportar({ ...planilha, ids: contatosNaTela.map(c => c.id) });
    });
    document.getElementById('btnImportarCSV')?.addEventListener('click', () => {
        window.AcoesCsv?.importar({ ...planilha, aoConcluir: () => carregarContatos(true) });
    });
    document.getElementById('btnModeloCSV')?.addEventListener('click', () => window.AcoesCsv?.salvarModelo(planilha));

    const emDesenvolvimento = () => window.DialogPadrao?.info({ title: 'Função em desenvolvimento', tom: 'aviso', icone: 'fa-person-digging', message: 'Esta ação ainda está sendo construída.' });
    document.getElementById('btnGerarRelatorio')?.addEventListener('click', emDesenvolvimento);
    document.getElementById('btnEnviarEmailMassa')?.addEventListener('click', emDesenvolvimento);

    document.getElementById('contatosEmptyNew')?.addEventListener('click', () => {
        document.getElementById('btnNovoContato')?.click();
    });

    // A primeira carga, publicada para o menu tirar a máscara na hora certa (06/10/2026).
    window.moduloPronto?.(carregarContatos());
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContatos);
} else {
    initContatos();
}
