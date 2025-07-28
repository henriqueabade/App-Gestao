function initContacts() {
// Toast notification handlers
const exportCsvToast = document.getElementById('exportCsvToast');
const newContactToast = document.getElementById('newContactToast');
const saveContactToast = document.getElementById('saveContactToast');
const toastCloseButtons = document.querySelectorAll('.toast-close');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const newContactBtn = document.getElementById('newContactBtn');
function showToast(toast) {
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 5000);
}
if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => showToast(exportCsvToast));
if (newContactBtn) newContactBtn.addEventListener('click', () => showToast(newContactToast));
toastCloseButtons.forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.toast').classList.remove('show'));
});
// Modal functionality
const contactModalOverlay = document.getElementById('contactModalOverlay');
const backBtn = document.getElementById('backBtn');
const contactModalCloseBtn = document.getElementById('contactModalCloseBtn');
const contactModalSaveBtn = document.getElementById('contactModalSaveBtn');
const contactModalSaveSpinner = document.getElementById('contactModalSaveSpinner');
const contactLinks = document.querySelectorAll('.contact-link');
const contactModal = contactModalOverlay?.querySelector('.contact-modal');

function openModal() {
    contactModalOverlay.classList.add('active');
    contactModal?.classList.add('active');
}

function closeModal() {
    contactModalOverlay.classList.remove('active');
    contactModal?.classList.remove('active');
}
contactLinks.forEach(link => link.addEventListener('click', e => { e.preventDefault(); openModal(); }));
document.addEventListener('click', e => {
    const btn = e.target.closest('.edit-contact');
    if (btn) {
        e.preventDefault();
        openModal();
    }
});
if (backBtn) backBtn.addEventListener('click', closeModal);
if (contactModalCloseBtn) contactModalCloseBtn.addEventListener('click', closeModal);

// Tab navigation
const tabItems = document.querySelectorAll('.tab-item');
const tabContents = document.querySelectorAll('.tab-content');
const mobileTabSelect = document.getElementById('mobileTabSelect');

function setActiveTab(tabId) {
    tabItems.forEach(item => item.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    document.querySelector(`.tab-item[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
    mobileTabSelect.value = tabId;
}

tabItems.forEach(item => item.addEventListener('click', () => setActiveTab(item.dataset.tab)));
if (mobileTabSelect) mobileTabSelect.addEventListener('change', () => setActiveTab(mobileTabSelect.value));

// Form validation
const requiredInputs = document.querySelectorAll('input[required], select[required]');
requiredInputs.forEach(input => input.addEventListener('blur', () => validateInput(input)));

function validateInput(input) {
    const errorClass = 'error';
    const errorMessageClass = 'form-error';
    const errorMessage = 'Este campo é obrigatório';

    const existingError = input.parentNode.querySelector(`.${errorMessageClass}`);
    if (existingError) existingError.remove();

    if (!input.value.trim()) {
        input.classList.add(errorClass);
        const errorElement = document.createElement('div');
        errorElement.className = errorMessageClass;
        errorElement.textContent = errorMessage;
        input.parentNode.appendChild(errorElement);
        return false;
    } else {
        input.classList.remove(errorClass);
        return true;
    }
}

contactModalSaveBtn.addEventListener('click', () => {
    let isValid = true;
    requiredInputs.forEach(input => { if (!validateInput(input)) isValid = false; });
    if (isValid) {
        contactModalSaveSpinner.style.display = 'block';
        contactModalSaveBtn.disabled = true;
        setTimeout(() => {
            contactModalSaveSpinner.style.display = 'none';
            contactModalSaveBtn.disabled = false;
            showToast(saveContactToast);
            closeModal();
        }, 1000);
    }
});

// Filter checkboxes
document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', function(){ console.log(`Filtering by ${this.id}: ${this.checked}`); });
});
// Search inputs
document.querySelectorAll('.search-input input').forEach(inp => {
    inp.addEventListener('input', function(){ console.log(`Searching for: ${this.value}`); });
});
// Pagination items
document.querySelectorAll('.pagination-item').forEach(item => {
    item.addEventListener('click', function(){
        if (this.classList.contains('active')) return;
        document.querySelector('.pagination-item.active')?.classList.remove('active');
        this.classList.add('active');
        console.log(`Navigating to page: ${this.textContent.trim()}`);
    });
});
// Other buttons
const importCsvBtn = document.getElementById('importCsvBtn');
const generateReportBtn = document.getElementById('generateReportBtn');
const bulkEmailBtn = document.getElementById('bulkEmailBtn');
if (backBtn) backBtn.addEventListener('click', () => console.log('Back button clicked'));
if (contactModalCloseBtn) contactModalCloseBtn.addEventListener('click', () => console.log('Close button clicked'));
if (importCsvBtn) importCsvBtn.addEventListener('click', () => console.log('Import CSV button clicked'));
if (generateReportBtn) generateReportBtn.addEventListener('click', () => console.log('Generate Report button clicked'));
if (bulkEmailBtn) bulkEmailBtn.addEventListener('click', () => console.log('Bulk Email button clicked'));

if (window.feather) window.feather.replace();
}

window.initContacts = initContacts;
