// Lógica de interação do menu principal

// Elementos da página
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('mainContent');
const menuToggle = document.getElementById('menuToggle');
const crmToggle = document.getElementById('crmToggle');
const crmSubmenu = document.getElementById('crmSubmenu');
const chevron = crmToggle.querySelector('.chevron');

let sidebarExpanded = false;
let crmExpanded = false;

// Expande a sidebar quando necessário
function expandSidebar() {
    if (!sidebarExpanded) {
        sidebar.classList.remove('sidebar-collapsed');
        sidebar.classList.add('sidebar-expanded');
        mainContent.style.marginLeft = window.innerWidth >= 1024 ? '240px' : '200px';
        sidebarExpanded = true;
    }
}

function collapseSidebar() {
    if (sidebarExpanded && !crmExpanded) {
        sidebar.classList.remove('sidebar-expanded');
        sidebar.classList.add('sidebar-collapsed');
        mainContent.style.marginLeft = '64px';
        sidebarExpanded = false;
    }
}

// Comportamento desktop: expande ao passar o mouse
if (window.innerWidth >= 1024) {
    sidebar.addEventListener('mouseenter', expandSidebar);
    sidebar.addEventListener('mouseleave', () => {
        if (!crmExpanded) collapseSidebar();
    });
}

// Alterna sidebar no mobile
menuToggle?.addEventListener('click', () => {
    if (sidebarExpanded) {
        collapseSidebar();
        if (crmExpanded) toggleCrmSubmenu();
    } else {
        expandSidebar();
    }
});

// Mostra ou esconde submenu do CRM
function toggleCrmSubmenu() {
    crmExpanded = !crmExpanded;
    if (crmExpanded) {
        crmSubmenu.classList.add('open');
        chevron.classList.add('rotated');
        if (!sidebarExpanded) expandSidebar();
    } else {
        crmSubmenu.classList.remove('open');
        chevron.classList.remove('rotated');
        if (window.innerWidth >= 1024) setTimeout(collapseSidebar, 100);
    }
}
crmToggle.addEventListener('click', toggleCrmSubmenu);

// Atualiza título conforme item clicado
const pageNames = {
    dashboard: 'Dashboard',
    materiaprima: 'Matéria-Prima',
    produtos: 'Produtos',
    orcamentos: 'Orçamentos',
    pedidos: 'Pedidos',
    clientes: 'CRM - Clientes',
    prospectos: 'CRM - Prospectos',
    contatos: 'CRM - Contatos',
    calendario: 'CRM - Calendário',
    tarefas: 'CRM - Tarefas',
    ia: 'Inteligência Artificial',
    usuarios: 'Usuários',
    relatorios: 'Relatórios',
    configuracoes: 'Configurações'
};

// Navegação interna
document.querySelectorAll('.sidebar-item[data-page], .submenu-item[data-page]').forEach(item => {
    item.addEventListener('click', function (e) {
        e.stopPropagation();
        document.querySelectorAll('.sidebar-item, .submenu-item').forEach(i => i.classList.remove('active'));
        this.classList.add('active');
        const page = this.dataset.page;
        document.querySelector('h1').textContent = pageNames[page] || 'Dashboard';
        // Se o item clicado for Matéria-Prima, navega para a nova tela
        if (page === 'materiaprima') {
            window.location.href = 'materia-prima.html';
        }
    });
});

// Animação inicial dos cards
window.addEventListener('load', () => {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
});

// Ajustes responsivos ao redimensionar
window.addEventListener('resize', () => {
    if (window.innerWidth < 1024) {
        sidebar.removeEventListener('mouseenter', expandSidebar);
        sidebar.removeEventListener('mouseleave', collapseSidebar);
    } else {
        sidebar.addEventListener('mouseenter', expandSidebar);
        sidebar.addEventListener('mouseleave', () => {
            if (!crmExpanded) collapseSidebar();
        });
    }
    if (sidebarExpanded) {
        mainContent.style.marginLeft = window.innerWidth >= 1024 ? '240px' : '200px';
    }
});
