function initCalendar() {
// toggle side panel
const toggleSidePanel = document.getElementById('toggleSidePanel');
const sidePanel = document.querySelector('.side-panel');
const mainContent = document.querySelector('.main-content');
if (toggleSidePanel) {
  toggleSidePanel.addEventListener('click', () => {
    sidePanel.classList.toggle('collapsed');
    mainContent.classList.toggle('expanded');
  });
}

// switch calendar view
const viewButtons = document.querySelectorAll('.view-button');
const calendarViews = document.querySelectorAll('.calendar-view');
viewButtons.forEach(btn => btn.addEventListener('click', () => {
  const view = btn.dataset.view;
  viewButtons.forEach(b => {
    b.classList.remove('bg-white','text-gray-800','shadow-sm');
    b.classList.add('text-gray-600');
  });
  btn.classList.add('bg-white','text-gray-800','shadow-sm');
  calendarViews.forEach(v => v.classList.add('hidden'));
  document.getElementById(`${view}-view`).classList.remove('hidden');
  updateDateFormat(view);
}));

// date navigation
let currentDate = new Date(), currentView = 'month';
const prevBtn = document.getElementById('prevBtn'),
      nextBtn = document.getElementById('nextBtn'),
      todayBtn = document.getElementById('todayBtn'),
      currentDateEl = document.getElementById('currentDate');
function updateDateFormat(view) {
  currentView = view;
  if (view==='month') {
    let s = currentDate.toLocaleDateString('pt-BR',{ month:'long', year:'numeric' });
    currentDateEl.textContent = s.charAt(0).toUpperCase()+s.slice(1);
  } else if (view==='week') {
    let ws = new Date(currentDate), we = new Date(ws);
    ws.setDate(currentDate.getDate()-currentDate.getDay());
    we.setDate(ws.getDate()+6);
    let s = `${ws.getDate()} – ${we.getDate()} de ${ws.toLocaleDateString('pt-BR',{ month:'long'})} ${ws.getFullYear()}`;
    currentDateEl.textContent = s;
  } else {
    let s = currentDate.toLocaleDateString('pt-BR',{ weekday:'long', day:'numeric', month:'long', year:'numeric' });
    currentDateEl.textContent = s.charAt(0).toUpperCase()+s.slice(1);
  }
}
prevBtn.onclick = () => {
  if(currentView==='month') currentDate.setMonth(currentDate.getMonth()-1);
  else if(currentView==='week') currentDate.setDate(currentDate.getDate()-7);
  else currentDate.setDate(currentDate.getDate()-1);
  updateDateFormat(currentView);
};
nextBtn.onclick = () => {
  if(currentView==='month') currentDate.setMonth(currentDate.getMonth()+1);
  else if(currentView==='week') currentDate.setDate(currentDate.getDate()+7);
  else currentDate.setDate(currentDate.getDate()+1);
  updateDateFormat(currentView);
};
todayBtn.onclick = () => { currentDate=new Date(); updateDateFormat(currentView); };

// create menu & modal
const createButton = document.getElementById('createButton'),
      createMenu = document.getElementById('createMenu'),
      eventModal = document.getElementById('eventModal'),
      createEvent = document.getElementById('createEvent'),
      closeEventModal = document.getElementById('closeEventModal');
createButton.onclick = () => createMenu.classList.toggle('active');
document.addEventListener('click', e => {
  if(!createButton.contains(e.target)&&!createMenu.contains(e.target))
    createMenu.classList.remove('active');
});
createEvent.onclick = () => { eventModal.classList.add('active'); createMenu.classList.remove('active'); };
closeEventModal.onclick = () => eventModal.classList.remove('active');
eventModal.addEventListener('click', e => { if(e.target===eventModal) eventModal.classList.remove('active'); });

// initialize view
updateDateFormat('month');

// drag & drop events
const events = document.querySelectorAll('.event');
events.forEach(evt => {
  evt.setAttribute('draggable', 'true');
  evt.addEventListener('dragstart', () => {
    evt.classList.add('dragging');
  });
  evt.addEventListener('dragend', () => {
    evt.classList.remove('dragging');
  });

  // tooltips on hover
  evt.addEventListener('mouseenter', () => {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.textContent = evt.textContent.trim();
    evt.appendChild(tip);
    evt._tooltip = tip;
  });
  evt.addEventListener('mouseleave', () => {
    if (evt._tooltip) {
      evt._tooltip.remove();
      evt._tooltip = null;
    }
  });
});

// day cell handlers
const dayCells = document.querySelectorAll(
  '.calendar-grid > div, .grid.grid-cols-7 > div, .week-grid > div, .day-grid > div'
);
dayCells.forEach(cell => {
  cell.addEventListener('dragover', e => {
    e.preventDefault();
    cell.classList.add('drop-target');
  });
  cell.addEventListener('dragleave', () => {
    cell.classList.remove('drop-target');
  });
  cell.addEventListener('drop', e => {
    e.preventDefault();
    const dragging = document.querySelector('.event.dragging');
    if (dragging) {
      cell.appendChild(dragging);
      console.log(`Dropped "${dragging.textContent.trim()}"`);
    }
    cell.classList.remove('drop-target');
  });
});

  if (window.feather) window.feather.replace();
}

window.initCalendar = initCalendar;
