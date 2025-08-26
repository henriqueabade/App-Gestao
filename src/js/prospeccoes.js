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

function initProspeccoes() {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    carregarProspeccoes();

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
                const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                window.prospectDetails = {
                    initials,
                    name,
                    company: '',
                    ownerName,
                    email,
                    phone: '',
                    status
                };
            }
            Modal.open('modals/prospeccoes/detalhes.html', '../js/modals/prospeccao-detalhes.js', 'detalhesProspeccao');
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProspeccoes);
} else {
    initProspeccoes();
}
