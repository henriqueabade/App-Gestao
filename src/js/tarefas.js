// Script principal do módulo Tarefas (CRM)
// Responsável por carregar, adicionar e filtrar tarefas

function showFunctionUnavailableDialog(message) {
    window.DialogPadrao?.info({ title: 'Função indisponível', tom: 'aviso', icone: 'fa-person-digging', message });
}

function carregarTarefas() {
    // TODO: integrar com API ou base local para listar tarefas
    console.log('Tarefas carregadas');
}

function initTarefas() {
    // Aplica animação de entrada
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    carregarTarefas();

    const btnEstatisticas = document.getElementById('btnEstatisticas');
    if (btnEstatisticas) {
        btnEstatisticas.addEventListener('click', () => {
            showFunctionUnavailableDialog('Função em desenvolvimento');
        });
    }

    const btnNovaTarefa = document.getElementById('btnNovaTarefa');
    if (btnNovaTarefa) {
        btnNovaTarefa.addEventListener('click', () => {
            showFunctionUnavailableDialog('Função em desenvolvimento');
        });
    }

    // TODO: adicionar handlers de criação, edição e conclusão
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTarefas);
} else {
    initTarefas();
}
