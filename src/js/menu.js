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
    'materia-prima': 'Matéria Prima',
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

// Carrega um módulo HTML dentro da div#content e importa seu script e estilos
async function loadPage(page) {
    const container = document.getElementById('content');
    if (!container) return;
    document.dispatchEvent(new Event('module-change'));
    // Remove script e estilo anteriores, se existirem
    document.getElementById('page-script')?.remove();
    document.getElementById('page-style')?.remove();
    try {
        const htmlResp = await fetch(`../html/${page}.html`);
        const html = await htmlResp.text();
        container.innerHTML = html;
        const style = document.createElement('link');
        style.id = 'page-style';
        style.rel = 'stylesheet';
        style.href = `../css/${page}.css`;
        document.head.appendChild(style);
        const script = document.createElement('script');
        script.id = 'page-script';
        script.type = 'text/javascript';
        script.src = `../js/${page}.js`;
        container.appendChild(script);
    } catch (err) {
        console.error('Falha ao carregar página', page, err);
    }
}

// Navegação interna
document.querySelectorAll('.sidebar-item[data-page], .submenu-item[data-page]').forEach(item => {
    item.addEventListener('click', function (e) {
        e.stopPropagation();
        document.querySelectorAll('.sidebar-item, .submenu-item').forEach(i => i.classList.remove('active'));
        this.classList.add('active');
        const page = this.dataset.page;
        document.querySelector('h1').textContent = pageNames[page] || 'Dashboard';
        if (page === 'materia-prima') {
            loadPage('materia-prima');
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
