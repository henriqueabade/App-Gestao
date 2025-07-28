// Lógica principal do módulo de Tarefas
// Carrega lista de tarefas, permite adicionar, editar e concluir
let tarefas = [];

function salvarLocal() {
    localStorage.setItem('tarefas', JSON.stringify(tarefas));
}

function carregarLocal() {
    const data = localStorage.getItem('tarefas');
    if (data) {
        tarefas = JSON.parse(data);
    } else {
        // exemplo inicial
        tarefas = [
            {id: 1, titulo: 'Revisar proposta do Cliente Silva', descricao:'Análise de orçamento e cronograma', prioridade:'alta', responsavel:'Henrique', status:'aberta', vencimento:'2024-05-10', concluida:false},
            {id: 2, titulo: 'Reunião com equipe de design', descricao:'Discussão sobre novos projetos - 14:00', prioridade:'media', responsavel:'João', status:'aberta', vencimento:'2024-05-11', concluida:false},
            {id: 3, titulo: 'Atualizar portfólio online', descricao:'Adicionar projetos recentes', prioridade:'baixa', responsavel:'Maria', status:'aberta', vencimento:'2024-05-20', concluida:false}
        ];
    }
}

function criarElementoTarefa(t) {
    const div = document.createElement('div');
    div.className = 'task-item flex items-start justify-between rounded-md border border-white/10 p-4';
    div.dataset.id = t.id;
    div.innerHTML = `
        <div class="flex items-start">
            <div class="checkbox-circle w-5 h-5 rounded-full mr-4 flex-shrink-0 mt-0.5"></div>
            <div>
                <h3 class="font-medium text-white">${t.titulo}</h3>
                <p class="text-sm text-gray-500 mt-1">${t.descricao}</p>
            </div>
        </div>
        <div class="${prioridadeClasse(t.prioridade)}">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2L3 7v11a2 2 0 002 2h10a2 2 0 002-2V7l-7-5z"/>
            </svg>
        </div>`;

    const check = div.querySelector('.checkbox-circle');
    if (t.concluida) {
        div.classList.add('opacity-50');
    }
    check.addEventListener('click', (e) => {
        e.stopPropagation();
        t.concluida = !t.concluida;
        renderTarefas();
        salvarLocal();
    });
    return div;
}

function prioridadeClasse(p) {
    if (p === 'alta') return 'priority-high';
    if (p === 'media') return 'priority-medium';
    return 'priority-low';
}

function renderTarefas(filtros = {}) {
    const lista = document.getElementById('taskList');
    if (!lista) return;
    lista.innerHTML = '';
    tarefas
        .filter(t => !filtros.status || t.status === filtros.status)
        .filter(t => !filtros.responsavel || t.responsavel === filtros.responsavel)
        .filter(t => !filtros.vencimento || t.vencimento === filtros.vencimento)
        .forEach(t => lista.appendChild(criarElementoTarefa(t)));
}

function novaTarefa(titulo) {
    const id = tarefas.length ? Math.max(...tarefas.map(t => t.id)) + 1 : 1;
    tarefas.push({id, titulo, descricao:'', prioridade:'baixa', responsavel:'', status:'aberta', vencimento:'', concluida:false});
    salvarLocal();
    renderTarefas();
}

function initTarefas() {
    carregarLocal();
    renderTarefas();

    document.getElementById('addBtn')?.addEventListener('click', () => {
        const titulo = prompt('Título da tarefa');
        if (titulo) novaTarefa(titulo);
    });

    document.getElementById('quickAdd')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = e.target.value.trim();
            if (val) {
                novaTarefa(val);
                e.target.value = '';
            }
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTarefas);
} else {
    initTarefas();
}
