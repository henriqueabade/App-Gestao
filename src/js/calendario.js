// Script do módulo Calendário
// Responsável por renderizar eventos e controlar filtros.

/** Botão que ainda não funciona: a caixa da casa, não o alert do sistema. */
function avisarEmDesenvolvimento() {
    window.DialogPadrao?.info({ title: 'Função em desenvolvimento', tom: 'aviso', icone: 'fa-person-digging', message: 'Esta parte do Calendário ainda está sendo construída.' });
}

function menuCalendarioHandler() {
    avisarEmDesenvolvimento();
}

function mesCalendarioHandler() {
    avisarEmDesenvolvimento();
}

function semanaCalendarioHandler() {
    avisarEmDesenvolvimento();
}

function diaCalendarioHandler() {
    avisarEmDesenvolvimento();
}

function anteriorCalendarioHandler() {
    avisarEmDesenvolvimento();
}

function proximoCalendarioHandler() {
    avisarEmDesenvolvimento();
}

function hojeCalendarioHandler() {
    avisarEmDesenvolvimento();
}

function novoEventoCalendarioHandler() {
    avisarEmDesenvolvimento();
}

function initCalendario() {
    // Aplica animação nos elementos da tela
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
    // Eventos de clique
    document.getElementById('btnMenuCalendario')?.addEventListener('click', menuCalendarioHandler);
    document.getElementById('btnMesCalendario')?.addEventListener('click', mesCalendarioHandler);
    document.getElementById('btnSemanaCalendario')?.addEventListener('click', semanaCalendarioHandler);
    document.getElementById('btnDiaCalendario')?.addEventListener('click', diaCalendarioHandler);
    document.getElementById('btnAnteriorCalendario')?.addEventListener('click', anteriorCalendarioHandler);
    document.getElementById('btnProximoCalendario')?.addEventListener('click', proximoCalendarioHandler);
    document.getElementById('btnHojeCalendario')?.addEventListener('click', hojeCalendarioHandler);
    document.getElementById('btnNovoEventoCalendario')?.addEventListener('click', novoEventoCalendarioHandler);
    // TODO: carregar eventos do banco e integrar com clientes
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalendario);
} else {
    initCalendario();
}

