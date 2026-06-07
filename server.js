const path = require('path');
const express = require('express');
const fs = require('fs');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const INVENTORY_FILE = path.join(__dirname, 'public', 'inventory.json');
const DEFAULT_DEPTS = ['خدمات مسانده', 'مسك برامج', 'it'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';

const CATEGORY_RULES = [
  { name: 'شاشات', keys: ['monitor','screen','display','lcd','led','شاشة','شاشات'] },
  { name: 'أجهزة كمبيوتر', keys: ['laptop','notebook','desktop','computer','pc','cpu','workstation','كمبيوتر','حاسب','لابتوب','جهاز'] },
  { name: 'طابعات وسكانر', keys: ['printer','scanner','plotter','toner','طابعة','طابعات','سكانر','حبر'] },
  { name: 'كيابل وأسلاك', keys: ['cable','wire','hdmi','vga','usb','power cord','adapter','كيبل','كيابل','سلك','أسلاك','شاحن','محول'] },
  { name: 'شبكات', keys: ['switch','router','access point','ap ','firewall','patch panel','network','سويتش','راوتر','شبكة','اكسس بوينت'] },
  { name: 'هواتف', keys: ['phone','telephone','ip phone','هاتف','تلفون','جوال'] },
  { name: 'أثاث', keys: ['chair','table','desk','cabinet','drawer','كرسي','طاولة','مكتب','دولاب','كابينة'] },
  { name: 'اكسسوارات', keys: ['keyboard','mouse','dock','stand','headset','speaker','remote','camera','ماوس','كيبورد','سماعة','ريموت','حامل','كاميرا'] },
];
function categoryOf(item){
  const hay = [item.name,item.serial,item.model,item.notes,item.externalStatus].join(' ').toLowerCase();
  for(const cat of CATEGORY_RULES){
    if(cat.keys.some(k => hay.includes(k.toLowerCase()))) return cat.name;
  }
  return 'متفرقات';
}


app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadStore(){
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if(!Array.isArray(data.departments)) data.departments = DEFAULT_DEPTS;
    if(!Array.isArray(data.requests)) data.requests = [];
    data.departments = DEFAULT_DEPTS;
    data.requests = data.requests.map(r => ({
      ...r,
      status: VALID_STATUSES.includes(r.status) ? r.status : 'pending'
    }));
    return data;
  } catch(e){
    return { departments: DEFAULT_DEPTS, requests: [] };
  }
}
function saveStore(store){
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}
function isDamaged(item){
  const status = String(item.externalStatus || '').trim();
  return status === 'مكسور' || status.includes('تالف');
}
function loadInventory(){
  return JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8')).filter(item => !isDamaged(item));
}
function loadAllInventory(){
  return JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
}
function approvedQty(requests, itemId){
  return requests
    .filter(r => String(r.itemId) === String(itemId) && r.status === 'approved')
    .reduce((s,r) => s + Number(r.qty || 0), 0);
}
function cleanText(v){ return String(v || '').trim().slice(0, 80); }
function publicStore(store){
  return { departments: DEFAULT_DEPTS, requests: store.requests };
}

function requireAdmin(req, res, next){
  const pass = req.headers['x-admin-password'] || req.query.adminPassword;
  if(pass !== ADMIN_PASSWORD){
    return res.status(401).json({ error: 'هذا الخيار للمسؤول فقط. سجل دخول المسؤول أولًا.' });
  }
  next();
}

app.get('/api/state', (req, res) => {
  res.json(publicStore(loadStore()));
});

// إضافة طلب: لا يخصم من المخزون إلا بعد موافقة المسؤول
app.post('/api/requests', (req, res) => {
  const department = cleanText(req.body.department);
  const itemId = cleanText(req.body.itemId);
  const qty = Math.max(1, Number(req.body.qty || 1));
  if(!department || !itemId || !Number.isFinite(qty)) return res.status(400).json({ error: 'بيانات الطلب غير صحيحة' });
  if(!DEFAULT_DEPTS.includes(department)) return res.status(400).json({ error: 'القسم غير مسموح' });

  const inventory = loadInventory();
  const item = inventory.find(i => String(i.id) === String(itemId));
  if(!item) return res.status(404).json({ error: 'الصنف غير موجود' });
  if((item.assignedDepartment || 'it') !== department) return res.status(403).json({ error: 'هذا الصنف تابع لقسم آخر' });

  const store = loadStore();
  if(typeof item.quantity === 'number' && !Number.isNaN(item.quantity)){
    const remainingAfterApproved = item.quantity - approvedQty(store.requests, itemId);
    if(qty > remainingAfterApproved) return res.status(409).json({ error: 'الكمية المطلوبة أكبر من المتوفر بعد الطلبات الموافق عليها' });
  }

  const oldPending = store.requests.find(r => r.department === department && String(r.itemId) === String(itemId) && r.status === 'pending');
  if(oldPending){
    oldPending.qty = Number(oldPending.qty || 0) + qty;
    oldPending.date = new Date().toLocaleString('ar-SA');
  } else {
    store.requests.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      department,
      itemId,
      qty,
      status: 'pending',
      date: new Date().toLocaleString('ar-SA'),
      decisionDate: ''
    });
  }

  saveStore(store);
  res.json(publicStore(store));
});

// موافقة / رفض المسؤول
app.patch('/api/requests/:id/status', requireAdmin, (req, res) => {
  const id = cleanText(req.params.id);
  const status = cleanText(req.body.status);
  if(!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'حالة الطلب غير صحيحة' });

  const store = loadStore();
  const request = store.requests.find(r => String(r.id) === String(id));
  if(!request) return res.status(404).json({ error: 'الطلب غير موجود' });

  const inventory = loadInventory();
  const item = inventory.find(i => String(i.id) === String(request.itemId));
  if(status === 'approved' && item && typeof item.quantity === 'number' && !Number.isNaN(item.quantity)){
    const approvedExceptThis = store.requests
      .filter(r => String(r.itemId) === String(request.itemId) && r.status === 'approved' && String(r.id) !== String(id))
      .reduce((s,r) => s + Number(r.qty || 0), 0);
    const remaining = item.quantity - approvedExceptThis;
    if(Number(request.qty || 0) > remaining) return res.status(409).json({ error: 'لا يمكن الموافقة، الكمية المتبقية لا تكفي' });
  }

  request.status = status;
  request.decisionDate = new Date().toLocaleString('ar-SA');
  saveStore(store);
  res.json(publicStore(store));
});

app.delete('/api/requests/:id', requireAdmin, (req, res) => {
  const id = cleanText(req.params.id);
  const store = loadStore();
  store.requests = store.requests.filter(r => String(r.id) !== String(id));
  saveStore(store);
  res.json(publicStore(store));
});

app.delete('/api/requests', requireAdmin, (req, res) => {
  const store = loadStore();
  store.requests = [];
  saveStore(store);
  res.json(publicStore(store));
});



function statusText(s){
  return ({ pending: 'بانتظار الموافقة', approved: 'موافق عليه', rejected: 'مرفوض' })[s] || s || '-';
}
function safeSheetName(name){
  return String(name || 'Sheet').replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31);
}
function imageExtension(filePath){
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  if(ext === 'png') return 'png';
  return 'jpeg';
}
function styleSheet(ws){
  ws.views = [{ rightToLeft: true }];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  ws.eachRow(row => {
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
}
async function addRequestsSheetWithImages(workbook, sheetName, rows){
  const ws = workbook.addWorksheet(safeSheetName(sheetName));
  ws.columns = [
    { header: 'الصورة', key: 'image', width: 22 },
    { header: 'القسم', key: 'department', width: 18 },
    { header: 'ID', key: 'id', width: 10 },
    { header: 'اسم الصنف', key: 'name', width: 34 },
    { header: 'التصنيف', key: 'category', width: 18 },
    { header: 'الكمية المطلوبة', key: 'qty', width: 16 },
    { header: 'حالة الطلب', key: 'status', width: 18 },
    { header: 'تاريخ الطلب', key: 'date', width: 22 },
    { header: 'تاريخ القرار', key: 'decisionDate', width: 22 },
    { header: 'السيريال', key: 'serial', width: 24 },
    { header: 'الموديل', key: 'model', width: 18 },
    { header: 'الحالة', key: 'externalStatus', width: 15 },
    { header: 'ملاحظات', key: 'notes', width: 34 }
  ];
  rows.forEach((x, idx) => {
    const rowIndex = idx + 2;
    ws.addRow({
      image: '',
      department: x.department,
      id: x.item.id,
      name: x.item.name,
      category: categoryOf(x.item),
      qty: x.qty,
      status: statusText(x.status),
      date: x.date || '',
      decisionDate: x.decisionDate || '',
      serial: x.item.serial || '',
      model: x.item.model || '',
      externalStatus: x.item.externalStatus || '',
      notes: x.item.notes || ''
    });
    ws.getRow(rowIndex).height = 84;
    const imgPath = x.item.image ? path.join(__dirname, 'public', x.item.image) : '';
    if(imgPath && fs.existsSync(imgPath)){
      try{
        const imageId = workbook.addImage({ filename: imgPath, extension: imageExtension(imgPath) });
        ws.addImage(imageId, {
          tl: { col: 0.15, row: rowIndex - 0.85 },
          ext: { width: 120, height: 82 },
          editAs: 'oneCell'
        });
      }catch(e){ /* تجاهل الصورة إذا ما قدرت تنضاف */ }
    }
  });
  styleSheet(ws);
}


app.get('/api/export-damaged', requireAdmin, (req, res) => {
  const filePath = path.join(__dirname, 'damaged_items_with_images.xlsx');
  if(fs.existsSync(filePath)){
    return res.download(filePath, 'damaged_items_with_images.xlsx');
  }
  return res.status(404).json({ error: 'ملف التالف غير موجود' });
});

app.get('/api/export', requireAdmin, async (req, res) => {
  try{
    const inventory = loadInventory();
    const store = loadStore();
    const itemById = new Map(inventory.map(i => [String(i.id), i]));
    const allRequestRows = store.requests
      .map(r => ({ ...r, item: itemById.get(String(r.itemId)) }))
      .filter(r => r.item);
    const approvedRows = allRequestRows.filter(r => r.status === 'approved');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'مستودع مسك';
    workbook.created = new Date();

    await addRequestsSheetWithImages(workbook, 'كل الطلبات مع الصور', allRequestRows);
    await addRequestsSheetWithImages(workbook, 'الموافق عليها مع الصور', approvedRows);

    const summary = workbook.addWorksheet('المخزون المتبقي');
    summary.views = [{ rightToLeft: true }];
    summary.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'اسم الصنف', key: 'name', width: 34 },
      { header: 'التصنيف', key: 'category', width: 18 },
      { header: 'العدد الأصلي', key: 'quantity', width: 14 },
      { header: 'الموافق عليه', key: 'approved', width: 14 },
      { header: 'المتبقي', key: 'remaining', width: 14 },
      { header: 'السيريال', key: 'serial', width: 24 },
      { header: 'الموديل', key: 'model', width: 18 },
      { header: 'الحالة', key: 'externalStatus', width: 15 },
      { header: 'ملاحظات', key: 'notes', width: 34 }
    ];
    inventory.forEach(item => {
      const approved = approvedQty(store.requests, item.id);
      const rem = (typeof item.quantity === 'number' && !Number.isNaN(item.quantity)) ? Math.max(0, item.quantity - approved) : item.quantity;
      summary.addRow({ id:item.id, name:item.name, quantity:item.quantity, approved, remaining:rem, serial:item.serial || '', model:item.model || '', externalStatus:item.externalStatus || '', notes:item.notes || '' });
    });
    styleSheet(summary);

    DEFAULT_DEPTS.forEach(dep => {
      const ws = workbook.addWorksheet(safeSheetName(dep + ' الطلبات'));
      ws.views = [{ rightToLeft: true }];
      ws.columns = [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'اسم الصنف', key: 'name', width: 34 },
        { header: 'الكمية المطلوبة', key: 'qty', width: 16 },
        { header: 'حالة الطلب', key: 'status', width: 18 },
        { header: 'تاريخ الطلب', key: 'date', width: 22 },
        { header: 'تاريخ القرار', key: 'decisionDate', width: 22 }
      ];
      allRequestRows.filter(r => r.department === dep).forEach(r => ws.addRow({ id:r.item.id, name:r.item.name, qty:r.qty, status:statusText(r.status), date:r.date || '', decisionDate:r.decisionDate || '' }));
      styleSheet(ws);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="misk-warehouse-requests.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'تعذر تصدير ملف Excel' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.listen(PORT, () => {
  console.log(`Warehouse site is running: http://localhost:${PORT}`);
});
