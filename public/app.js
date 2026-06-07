const SITE_NAME = 'مستودع مسك';
const SYSTEM_SUBTITLE = 'نظام إدارة الأصول والمخزون';
const OWNER_NAME = 'محمد وقيان ال ظافر';
const DEFAULT_DEPTS = ['خدمات مسانده', 'مسك برامج', 'it'];
const ADMIN_PASSWORD = '1234';

let items = [];
let currentDept = localStorage.getItem('currentDept') || DEFAULT_DEPTS[0];
let departments = DEFAULT_DEPTS;
let requests = [];
let currentCategory = localStorage.getItem('currentCategory') || 'الكل';
let adminLoggedIn = sessionStorage.getItem('adminLoggedIn') === '1';
const CATEGORY_RULES = [
  // أضفت أكثر من كتابة عربية/إنجليزية عشان التصنيف يمسك الأسماء اللي في الإكسل، مثل: شاشه / شاشة
  { name: 'شاشات', keys: ['monitor','screen','display','lcd','led','شاشة','شاشه','شاشات','شاشات','evoko','benq','samsung','lg'] },
  { name: 'أجهزة كمبيوتر', keys: ['laptop','notebook','desktop','computer','pc','cpu','workstation','chromebox','apple-tv','appl-tv','كمبيوتر','حاسب','لابتوب','جهاز كمبيوتر','جهاز مكتبي'] },
  { name: 'طابعات وسكانر', keys: ['printer','scanner','plotter','toner','xerox','toshiba','brother','طابعة','طابعه','طابعات','سكانر','حبر','فاكس'] },
  { name: 'كيابل وأسلاك', keys: ['cable','wire','hdmi','hmdi','vga','usb','power cord','adapter','كيبل','كيابل','سلك','اسلاك','أسلاك','شاحن','شواحن','محول'] },
  { name: 'شبكات', keys: ['switch','router','access point','firewall','patch panel','network','cisco','linksys','tp-link','mikro tik','سويتش','راوتر','روتر','شبكة','اكسس بوينت','سيرفر انترنت'] },
  { name: 'هواتف', keys: ['phone','telephone','ip phone','هاتف','تلفون','جوال'] },
  { name: 'أثاث', keys: ['chair','table','desk','cabinet','drawer','rack','safe','كرسي','طاولة','طاولات','مكتب','دولاب','كابينة','خزنة','خزانه'] },
  { name: 'اكسسوارات', keys: ['keyboard','mouse','dock','stand','headset','speaker','remote','logitech','كاميرا','ماوس','كيبورد','سماعة','ريموت','حامل','راس'] },
];

function normText(v){
  return String(v ?? '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const $ = id => document.getElementById(id);
const fmt = v => (v === null || v === undefined || v === '') ? '-' : v;
const isNum = v => typeof v === 'number' && !Number.isNaN(v);
const statusText = s => ({ pending:'بانتظار الموافقة', approved:'موافق عليه', rejected:'مرفوض' }[s] || s);
function categoryOf(item){
  const hay = normText([item.name,item.serial,item.model,item.notes,item.externalStatus].join(' '));
  for(const cat of CATEGORY_RULES){
    if(cat.keys.some(k => hay.includes(normText(k)))) return cat.name;
  }
  return 'متفرقات';
}
function itemCountValue(item){
  // رقم التصنيف صار يحسب الكمية إذا كانت رقم، مو عدد الكروت فقط.
  // إذا الكمية مكتوبة نص مثل 4 كرتون، نأخذ أول رقم ونحسبه.
  if(isNum(item.quantity)) return remaining(item);
  const m = String(item.quantity ?? '').match(/\d+/);
  return m ? Number(m[0]) : 1;
}
function visibleBaseItems(){
  return items.filter(item => {
    if((item.assignedDepartment || 'it') !== currentDept) return false;
    if(isNum(item.quantity) && remaining(item) <= 0) return false;
    return true;
  });
}
function renderCategories(){
  const box = $('categories');
  if(!box) return;
  const counts = {};
  visibleBaseItems().forEach(item => {
    const c = categoryOf(item);
    counts[c] = (counts[c] || 0) + itemCountValue(item);
  });
  const cats = ['الكل', ...CATEGORY_RULES.map(c => c.name), 'متفرقات'].filter((v,i,a)=>a.indexOf(v)===i);
  if(currentCategory !== 'الكل' && !cats.includes(currentCategory)) currentCategory = 'الكل';
  box.innerHTML = '';
  cats.forEach(cat => {
    const b = document.createElement('button');
    b.className = 'cat' + (cat === currentCategory ? ' active' : '');
    const count = cat === 'الكل' ? visibleBaseItems().reduce((s,item)=>s+itemCountValue(item),0) : (counts[cat] || 0);
    b.textContent = `${cat} (${count})`;
    b.onclick = () => { currentCategory = cat; localStorage.setItem('currentCategory', currentCategory); render(); };
    box.appendChild(b);
  });
}

async function api(url, options={}){
  const baseHeaders = { 'Content-Type': 'application/json' };
  if(adminLoggedIn) baseHeaders['x-admin-password'] = ADMIN_PASSWORD;
  const res = await fetch(url, { ...options, headers: { ...baseHeaders, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error || 'صار خطأ في الاتصال');
  return data;
}
async function loadState(){
  const state = await api('/api/state');
  departments = state.departments || DEFAULT_DEPTS;
  requests = (state.requests || []).map(r => ({ ...r, status: r.status || 'pending' }));
  if(!departments.includes(currentDept)) currentDept = departments[0] || DEFAULT_DEPTS[0];
}
async function init(){
  document.title = SITE_NAME;
  $('siteTitle').textContent = 'لوحة التحكم';
  items = await fetch('inventory.json').then(r => r.json());
  await loadState();
  renderDepartments();
  render();
}
init().catch(err => alert(err.message));

function saveLocal(){ localStorage.setItem('currentDept', currentDept); }
function sumQty(itemId, status=null, dept=null){
  return requests
    .filter(r => String(r.itemId) === String(itemId))
    .filter(r => !status || r.status === status)
    .filter(r => !dept || r.department === dept)
    .reduce((s,r) => s + Number(r.qty || 0), 0);
}
function approvedQty(itemId){ return sumQty(itemId, 'approved'); }
function pendingQtyForDept(itemId){ return sumQty(itemId, 'pending', currentDept); }
function approvedQtyForDept(itemId){ return sumQty(itemId, 'approved', currentDept); }
function rejectedQtyForDept(itemId){ return sumQty(itemId, 'rejected', currentDept); }
function remaining(item){
  if(!isNum(item.quantity)) return item.quantity;
  return Math.max(0, item.quantity - approvedQty(item.id));
}
function deptHasRequested(itemId){
  return requests.some(r => String(r.itemId) === String(itemId) && r.department === currentDept && r.status !== 'rejected');
}

function renderDepartments(){
  const box = $('departments');
  box.innerHTML = '';
  departments.forEach(dep => {
    const b = document.createElement('button');
    b.className = 'dept' + (dep === currentDept ? ' active' : '');
    b.textContent = dep;
    b.onclick = () => { currentDept = dep; saveLocal(); renderDepartments(); render(); };
    box.appendChild(b);
  });
}

function render(){
  const search = $('search').value.trim().toLowerCase();
  const status = $('statusFilter').value;
  const hideRequested = $('hideRequested').checked;
  renderCategories();
  let filtered = items.filter(item => {
    const hay = normText([item.name,item.serial,item.model,item.notes,item.externalStatus].join(' '));
    if(search && !hay.includes(normText(search))) return false;
    if(currentCategory !== 'الكل' && categoryOf(item) !== currentCategory) return false;
    // كل صنف يظهر فقط تحت القسم المخصص له
    if((item.assignedDepartment || 'it') !== currentDept) return false;
    if(status && !(item.externalStatus || '').includes(status)) return false;
    // إذا الكمية خلصت بعد موافقات المسؤول، يختفي الصنف من الموقع للأقسام
    if(isNum(item.quantity) && remaining(item) <= 0) return false;
    if(hideRequested && deptHasRequested(item.id)) return false;
    return true;
  });

  $('totalItems').textContent = items.length;
  $('pendingItems').textContent = new Set(requests.filter(r => r.department === currentDept && r.status === 'pending').map(r => r.itemId)).size;
  $('approvedItems').textContent = new Set(requests.filter(r => r.department === currentDept && r.status === 'approved').map(r => r.itemId)).size;
  $('remainingItems').textContent = items.filter(i => remaining(i) !== 0).length;
  $('currentDeptLabel').textContent = currentDept;

  renderAdminAccess();
  renderAdminDashboard();
  renderAdminRequests();

  const wrap = $('items');
  wrap.innerHTML = '';
  if(!filtered.length){ wrap.innerHTML = '<div class="empty">مافي نتائج</div>'; return; }
  const tpl = $('itemTemplate');
  filtered.forEach(item => {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector('.card');
    const img = node.querySelector('img');
    img.src = item.image || '';
    img.alt = item.name;
    img.onerror = () => { img.style.display='none'; img.parentElement.textContent='لا توجد صورة'; };
    node.querySelector('h3').textContent = `${item.id} - ${item.name}`;
    node.querySelector('.status-badges').innerHTML = badgesForItem(item.id);
    node.querySelector('.meta').innerHTML = `
      <b>المتوفر بعد الموافقات:</b> ${fmt(remaining(item))} &nbsp; | &nbsp; <b>الأصل:</b> ${fmt(item.quantity)}<br>
      <b>بانتظار موافقة كل الأقسام:</b> ${fmt(sumQty(item.id, 'pending'))}<br>
      <b>التصنيف:</b> ${fmt(categoryOf(item))}<br>
      <b>القسم الحالي:</b> ${fmt(item.assignedDepartment || 'it')}<br>
      <b>القسم في الملف:</b> ${fmt(item.departmentOriginal)}<br>
      <b>السيريال:</b> ${fmt(item.serial)}<br>
      <b>الموديل:</b> ${fmt(item.model)}<br>
      <b>الحالة:</b> ${fmt(item.externalStatus)}
    `;
    node.querySelector('.notes').textContent = item.notes ? `ملاحظات: ${item.notes}` : '';
    const qty = node.querySelector('.qty');
    if(isNum(item.quantity)) qty.max = Math.max(1, remaining(item));
    node.querySelector('.request-btn').onclick = async () => {
      const q = Math.max(1, Number(qty.value || 1));
      if(isNum(item.quantity) && q > remaining(item)){ alert('الكمية المطلوبة أكبر من المتوفر بعد الطلبات الموافق عليها'); return; }
      try{
        const state = await api('/api/requests', { method:'POST', body: JSON.stringify({ department: currentDept, itemId: item.id, qty: q }) });
        departments = state.departments; requests = state.requests; renderDepartments(); render();
        alert('تم إرسال الطلب للمسؤول. الكمية ما تنقص إلا بعد الموافقة.');
      }catch(err){ alert(err.message); }
    };
    if(deptHasRequested(item.id)) card.classList.add('requested');
    wrap.appendChild(node);
  });
}

function badgesForItem(itemId){
  const p = pendingQtyForDept(itemId);
  const a = approvedQtyForDept(itemId);
  const r = rejectedQtyForDept(itemId);
  let out = '';
  if(p) out += `<span class="badge pending">بانتظار: ${p}</span>`;
  if(a) out += `<span class="badge approved">موافق: ${a}</span>`;
  if(r) out += `<span class="badge rejected">مرفوض: ${r}</span>`;
  return out;
}


function renderAdminDashboard(){
  const box = $('adminDashboard');
  if(!box || !adminLoggedIn) return;
  box.innerHTML = '';
  departments.forEach(dep => {
    const depReqs = requests.filter(r => r.department === dep && r.status !== 'rejected');
    const totals = new Map();
    depReqs.forEach(r => {
      const key = String(r.itemId);
      const old = totals.get(key) || { qty: 0, count: 0, itemId: r.itemId };
      old.qty += Number(r.qty || 0);
      old.count += 1;
      totals.set(key, old);
    });
    const top = [...totals.values()].sort((a,b) => b.qty - a.qty || b.count - a.count).slice(0, 5);
    const card = document.createElement('div');
    card.className = 'dash-card';
    card.innerHTML = `<h4>${dep}</h4>` + (top.length ? `
      <table>
        <thead><tr><th>الصنف</th><th>الكمية</th><th>طلبات</th></tr></thead>
        <tbody>${top.map(x => {
          const item = items.find(i => String(i.id) === String(x.itemId));
          const name = item ? `${item.id} - ${item.name}` : x.itemId;
          return `<tr><td>${fmt(name)}</td><td>${fmt(x.qty)}</td><td>${fmt(x.count)}</td></tr>`;
        }).join('')}</tbody>
      </table>` : '<div class="empty small">لا توجد طلبات لهذا القسم</div>');
    box.appendChild(card);
  });
}

function renderAdminAccess(){
  const login = $('adminLogin');
  const content = $('adminContent');
  const subtitle = $('adminSubtitle');
  if(!login || !content) return;
  login.classList.toggle('hidden', adminLoggedIn);
  content.classList.toggle('hidden', !adminLoggedIn);
  if(subtitle) subtitle.classList.toggle('hidden', !adminLoggedIn);
}

function renderAdminRequests(){
  const box = $('adminRequests');
  if(!box || !adminLoggedIn) return;
  const pending = requests.filter(r => r.status === 'pending');
  if(!pending.length){ box.innerHTML = '<div class="empty small">لا توجد طلبات بانتظار الموافقة</div>'; return; }
  box.innerHTML = '';
  pending.forEach(r => {
    const item = items.find(i => String(i.id) === String(r.itemId));
    const div = document.createElement('div');
    div.className = 'admin-row';
    div.innerHTML = `
      <div>
        <b>${fmt(r.department)}</b> طلب <b>${fmt(r.qty)}</b> من: ${item ? `${item.id} - ${item.name}` : r.itemId}
        <small>تاريخ الطلب: ${fmt(r.date)} | المتوفر بعد الموافقات: ${item ? fmt(remaining(item)) : '-'}</small>
      </div>
      <div class="admin-actions">
        <button class="approve">موافقة</button>
        <button class="reject">رفض</button>
        <button class="delete">حذف</button>
      </div>
    `;
    div.querySelector('.approve').onclick = () => setRequestStatus(r.id, 'approved');
    div.querySelector('.reject').onclick = () => setRequestStatus(r.id, 'rejected');
    div.querySelector('.delete').onclick = () => deleteRequest(r.id);
    box.appendChild(div);
  });
}

async function setRequestStatus(id, status){
  try{
    const state = await api(`/api/requests/${encodeURIComponent(id)}/status`, { method:'PATCH', body: JSON.stringify({ status }) });
    departments = state.departments; requests = state.requests; renderDepartments(); render();
  }catch(err){ alert(err.message); }
}
async function deleteRequest(id){
  if(!confirm('متأكد تبي تحذف الطلب؟')) return;
  try{
    const state = await api(`/api/requests/${encodeURIComponent(id)}`, { method:'DELETE' });
    departments = state.departments; requests = state.requests; renderDepartments(); render();
  }catch(err){ alert(err.message); }
}

$('search').addEventListener('input', render);
$('statusFilter').addEventListener('change', render);
$('hideRequested').addEventListener('change', render);
$('refreshBtn').onclick = async () => { await loadState(); renderDepartments(); render(); };
$('adminLoginBtn').onclick = () => {
  if($('adminPass').value === ADMIN_PASSWORD){
    adminLoggedIn = true;
    sessionStorage.setItem('adminLoggedIn', '1');
    $('adminPass').value = '';
    render();
  } else {
    alert('كلمة مرور المسؤول غير صحيحة');
  }
};
$('adminPass').addEventListener('keydown', (e) => { if(e.key === 'Enter') $('adminLoginBtn').click(); });
$('adminLogoutBtn').onclick = () => {
  adminLoggedIn = false;
  sessionStorage.removeItem('adminLoggedIn');
  render();
};
$('clearBtn').onclick = async () => {
  if(!adminLoggedIn){ alert('هذا الخيار للمسؤول فقط'); return; }
  if(confirm('متأكد تبي تصفر كل الطلبات لكل الأقسام؟')){
    const state = await api('/api/requests', { method:'DELETE' });
    departments = state.departments; requests = state.requests; render();
  }
};
async function downloadAdminFile(url, filename){
  if(!adminLoggedIn){ alert('هذا الخيار للمسؤول فقط'); return; }
  try{
    const res = await fetch(url, { headers: { 'x-admin-password': ADMIN_PASSWORD } });
    if(!res.ok){
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'تعذر تحميل الملف');
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }catch(err){ alert(err.message); }
}
$('exportBtn').onclick = () => downloadAdminFile('/api/export', 'misk-warehouse-requests.xlsx');
$('damagedExportBtn').onclick = () => downloadAdminFile('/api/export-damaged', 'damaged_items_with_images.xlsx');

function xmlEscape(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function row(cells){ return '<Row>' + cells.map(c => `<Cell><Data ss:Type="String">${xmlEscape(c)}</Data></Cell>`).join('') + '</Row>'; }
function sheet(name, rows){ return `<Worksheet ss:Name="${xmlEscape(name).slice(0,31)}"><Table>${rows.join('')}</Table></Worksheet>`; }
function itemRow(item, extra=[]){ return [item.id,item.name,categoryOf(item),item.quantity,remaining(item),item.assignedDepartment || 'it',item.departmentOriginal,item.serial,item.model,item.externalStatus,item.notes,...extra]; }
function exportExcel(){
  const workbook = ['<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>', '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'];
  const header = ['ID','اسم الصنف','التصنيف','العدد الأصلي','المتبقي بعد الموافقات','القسم الحالي','القسم الأصلي','السيريال','الموديل','الحالة','ملاحظات'];
  let allReq = [row(['القسم','ID','اسم الصنف','الكمية المطلوبة','حالة الطلب','تاريخ الطلب','تاريخ القرار','السيريال','الموديل','الحالة'])];
  requests.forEach(r => { const it = items.find(i=>String(i.id)===String(r.itemId)); if(it) allReq.push(row([r.department,it.id,it.name,r.qty,statusText(r.status),r.date,r.decisionDate,it.serial,it.model,it.externalStatus])); });
  workbook.push(sheet('All Requests', allReq));
  workbook.push(sheet('Remaining Inventory', [row(header), ...items.map(i => row(itemRow(i)))]));
  departments.forEach(dep => {
    const depItems = items.filter(i => (i.assignedDepartment || 'it') === dep);
    const depReqIds = new Set(requests.filter(r=>r.department===dep && r.status !== 'rejected').map(r=>String(r.itemId)));
    const needed = [row([...header,'الكمية المطلوبة','حالة الطلب','تاريخ الطلب','تاريخ القرار'])];
    requests.filter(r=>r.department===dep).forEach(r => { const it=items.find(i=>String(i.id)===String(r.itemId)); if(it) needed.push(row(itemRow(it,[r.qty,statusText(r.status),r.date,r.decisionDate]))); });
    const notNeeded = [row(header), ...depItems.filter(i=>!depReqIds.has(String(i.id))).map(i=>row(itemRow(i)))];
    workbook.push(sheet(dep + ' Needed', needed));
    workbook.push(sheet(dep + ' Not Needed', notNeeded));
  });
  workbook.push('</Workbook>');
  const blob = new Blob([workbook.join('')], {type:'application/vnd.ms-excel;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'warehouse-requests.xls';
  a.click();
  URL.revokeObjectURL(a.href);
}
function showDepartmentsOnMobile() {
  const old = document.getElementById('mobileDeptBar');
  if (old) old.remove();

  const depts = ['خدمات مسانده', 'مسك برامج', 'it'];

  const bar = document.createElement('div');
  bar.id = 'mobileDeptBar';
  bar.innerHTML = `
    <div class="mobile-dept-title">اختر القسم</div>
    <div class="mobile-dept-buttons">
      ${depts.map(d => `<button data-dept="${d}">${d}</button>`).join('')}
    </div>
  `;

  document.body.prepend(bar);

  bar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.setItem('currentDept', btn.dataset.dept);
      location.reload();
    });
  });
}

window.addEventListener('DOMContentLoaded', showDepartmentsOnMobile);
