
let onBodyClick, onKeyDown;
function initTasks(){
// Checkbox toggle
document.querySelectorAll('.task-checkbox').forEach(box=>{
  box.addEventListener('click',()=> {
    box.classList.toggle('checked');
    const row = box.closest('.task-row');
    const title = row.querySelector('div > div:nth-child(2) > div:first-child');
    if (box.classList.contains('checked')) {
      title.classList.add('line-through','text-gray-400');
      title.classList.remove('text-gray-800');
      row.classList.add('bg-gray-50');
    } else {
      title.classList.remove('line-through','text-gray-400');
      title.classList.add('text-gray-800');
      row.classList.remove('bg-gray-50');
    }
  });
});

// Subtasks expand/collapse
document.querySelectorAll('.subtask-toggle').forEach(toggle=>{
  toggle.addEventListener('click',()=>{
    const id = toggle.dataset.taskId;
    const sub = document.querySelector(`.subtasks[data-parent-id="${id}"]`);
    sub.classList.toggle('expanded');
    const icon = toggle.querySelector('i');
    icon.classList.toggle('fa-chevron-down');
    icon.classList.toggle('fa-chevron-up');
  });
});

// Drawer open/close
const rows = document.querySelectorAll('.task-row'),
      drawer = document.getElementById('taskDrawer'),
      overlay = document.getElementById('overlay'),
      closeBtn = document.getElementById('closeDrawer');

rows.forEach(r=> r.addEventListener('click',e=>{
  if (e.target.closest('.task-checkbox')||e.target.closest('.task-menu-btn')) return;
  const title = r.querySelector('div > div:nth-child(2) > div:first-child').textContent;
  document.getElementById('taskTitle').textContent = title;
  drawer.classList.add('open'); overlay.classList.add('active');
}));
closeBtn.addEventListener('click',()=>{ 
  drawer.classList.remove('open'); 
  overlay.classList.remove('active'); 
  if (window.closeAllModals) window.closeAllModals();
});
overlay.addEventListener('click',()=>{ 
  drawer.classList.remove('open'); 
  overlay.classList.remove('active'); 
  hideContextMenu(); 
  if (window.closeAllModals) window.closeAllModals();
});

// Context menu show/hide
const ctx = document.getElementById('taskContextMenu');
function hideContextMenu(){ ctx.classList.remove('active'); document.removeEventListener('click', onBodyClick); }
onBodyClick = function(e){ if (!ctx.contains(e.target)) hideContextMenu(); };

onKeyDown = function(e){
  if (e.key==='Escape') {
    hideContextMenu();
    drawer.classList.remove('open');
    overlay.classList.remove('active');
    if (window.closeAllModals) window.closeAllModals();
  }
}

document.querySelectorAll('.task-menu-btn').forEach(btn=>{
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    ctx.style.top=`${rect.bottom+5}px`;
    ctx.style.left=`${rect.left-ctx.offsetWidth+20}px`;
    ctx.classList.add('active');
    document.addEventListener('click', onBodyClick);
  });
});

// Right-click
rows.forEach(r=>{
  r.addEventListener('contextmenu',e=>{
    e.preventDefault();
    ctx.style.top=`${e.clientY}px`;
    ctx.style.left=`${e.clientX}px`;
    ctx.classList.add('active');
    document.addEventListener('click', onBodyClick);
  });
});

// Escape to close
document.addEventListener('keydown', onKeyDown);

// Drag & drop ordering
let dragSrc = null;
rows.forEach(r=>{
  r.addEventListener('dragstart',()=>r.classList.add('dragging'));
  r.addEventListener('dragend',()=>r.classList.remove('dragging'));
});
const container = document.querySelector('.space-y-2');
container.addEventListener('dragover',e=>{
  e.preventDefault();
  const after = [...container.querySelectorAll('.task-row:not(.dragging)')]
    .reduce((closest,child)=>{
      const box=child.getBoundingClientRect(),
            offset=e.clientY-box.top-box.height/2;
      return offset<0 && offset>closest.offset
        ? {offset,element:child}
        : closest;
    },{offset: Number.NEGATIVE_INFINITY}).element;
  const dragging = document.querySelector('.dragging');
  after ? container.insertBefore(dragging,after) : container.appendChild(dragging);
});

  if (window.feather) window.feather.replace();
}

function crmTasksCleanup() {
  document.removeEventListener('click', onBodyClick);
  document.removeEventListener('keydown', onKeyDown);
  onBodyClick = null;
  onKeyDown = null;
}

window.crmTasksCleanup = crmTasksCleanup;
window.initTasks = initTasks;

