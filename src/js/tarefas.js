// Script principal do módulo Tarefas (CRM)
// Responsável por carregar, adicionar e filtrar tarefas

function showFunctionUnavailableDialog(message) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    overlay.innerHTML = `<div class="max-w-sm w-full glass-surface backdrop-blur-xl rounded-2xl border border-yellow-500/20 ring-1 ring-yellow-500/30 shadow-2xl/40 animate-modalFade">
        <div class="p-6 text-center">
            <h3 class="text-lg font-semibold mb-4 text-yellow-400">Função Indisponível</h3>
            <p class="text-sm text-gray-300 mb-6">${message}</p>
            <div class="flex justify-center">
                <button id="funcUnavailableOk" class="btn-neutral px-4 py-2 rounded-lg text-white font-medium">OK</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#funcUnavailableOk').addEventListener('click', () => overlay.remove());
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
