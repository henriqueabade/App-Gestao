// Script principal do módulo Clientes (CRM)
// Carrega lista de empresas e aplica interações básicas da tela

async function carregarClientes() {
    try {
        const resp = await fetch('http://localhost:3000/api/clientes/lista');
        const clientes = await resp.json();
        console.log('Clientes carregados', clientes);
        // TODO: popular tabela dinamicamente
    } catch (err) {
        console.error('Erro ao carregar clientes', err);
    }
}

function initClientes() {
    // animação de entrada
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    carregarClientes();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initClientes);
} else {
    initClientes();
}
