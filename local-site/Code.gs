/*************************************************************
 * ระบบติดตามการปรับปรุงแก้ไขหลังการประเมินมาตรฐานโรงพยาบาล
 * สำนักงานสาธารณสุขจังหวัดนครราชสีมา
 *
 * เวอร์ชันนี้เขียนให้ตรงกับ "โครงสร้างชีตจริง" ทุกแท็บ
 * ไม่มีการเพิ่ม/ย้ายคอลัมน์ในชีตของพี่ — อ่านและเขียนตามหัวคอลัมน์เดิม
 *
 * วิธีติดตั้ง: Apps Script → ลบโค้ดเดิมทั้งหมด → วางไฟล์นี้ทับ → Deploy ใหม่
 *************************************************************/

/* ---------- ชื่อแท็บในสเปรดชีต ---------- */
const SHEET_LOGIN        = "Login รายชื่อผู้ใช้งาน";
const SHEET_GREEN        = "Master_Data_Green";
const SHEET_OCC          = "Master_Data_Occ";
const SHEET_FOLLOW_GREEN = "ติดตามงาน Green & Clean Hospital";
const SHEET_FOLLOW_OCC   = "ติดตามงาน อาชีวอนามัยและเวชกรรมสิ่งแวดล้อม";
const SHEET_REGISTRY     = "ทะเบียนรายชื่อโรงพยาบาล";

/* ---------- โฟลเดอร์ Drive สำหรับเก็บไฟล์หลักฐานที่อัปโหลดจากหน้าเว็บ ----------
 * ถ้าอยากใช้โฟลเดอร์ที่มีอยู่แล้ว ให้ใส่ ID ของโฟลเดอร์นั้นลงใน UPLOAD_FOLDER_ID
 * (ID คือข้อความยาว ๆ ท้าย URL: drive.google.com/drive/folders/<ID>)
 * ถ้าเว้นว่างไว้ ระบบจะหา/สร้างโฟลเดอร์ชื่อ UPLOAD_FOLDER_NAME ให้เองอัตโนมัติ
 * ไฟล์จะถูกแยกเก็บเป็นโฟลเดอร์ย่อยตามชื่อหน่วยงาน */
const UPLOAD_FOLDER_ID   = "";
const UPLOAD_FOLDER_NAME = "หลักฐานการแก้ไข (อัปโหลดจากเว็บ)";
const MAX_UPLOAD_MB      = 15;   /* ต่อไฟล์ ต้องตรงกับ MAX_FILE_MB ใน assets/hospital.js */

/* ---------- สถานะงาน (ต้องตรงกับ assets/config.js) ---------- */
const STATUS_PENDING  = "รอตรวจสอบ";
const STATUS_CHECKING = "ดำเนินการตรวจสอบแล้ว";
const STATUS_REVISE   = "ต้องแก้ไขเพิ่มเติม";
const STATUS_APPROVED = "รับรองผลเรียบร้อยแล้ว";

/**
 * ตารางเทียบ "ประเภทหน่วยงาน" ให้เป็นรหัสกลาง
 * เพราะแต่ละชีตเขียนคนละแบบ เช่น
 *   ชีต Login  : "รพ.สต."
 *   ชีต Master : "รพ.ศูนย์/ รพ.ทั่วไป/ รพ.ชุมชน/ รพ.นอก สป.สธ."
 * ทุกอย่างจะถูกแปลงเป็นรหัสเดียวกันก่อนเทียบ จึงไม่พลาดเพราะพิมพ์ต่างกัน
 */
const TYPE_LABEL = {
  CEN: 'รพ.ศูนย์',
  GEN: 'รพ.ทั่วไป',
  COM: 'รพ.ชุมชน',
  SUB: 'รพ.สต.',
  OUT: 'รพ.นอก สป.สธ.',
  LOC: 'อปท.',
  PHO: 'สสจ.'
};

/** แปลงข้อความประเภทหน่วยงาน (อาจมีหลายค่าคั่นด้วย / , |) เป็นรายการรหัส */
function typeCodes_(text) {
  var out = [];
  String(text || '').split(/[,/|]/).forEach(function (part) {
    var p = String(part).replace(/[\s.]/g, '');
    if (!p) return;
    var code =
      /ส่งเสริมสุขภาพ|สต$|สต[^ร]/.test(p) ? 'SUB' :
      /ชุมชน|^รพช$/.test(p)                ? 'COM' :
      /ทั่วไป|^รพท$/.test(p)               ? 'GEN' :
      /ศูนย์|^รพศ$/.test(p)                ? 'CEN' :
      /นอกสป|นอกสธ|เอกชน/.test(p)          ? 'OUT' :
      /อปท|ท้องถิ่น/.test(p)                ? 'LOC' :
      /สสจ|สาธารณสุขจังหวัด/.test(p)        ? 'PHO' : '';
    if (code && out.indexOf(code) === -1) out.push(code);
  });
  return out;
}

/* ============================================================
 *  ROUTER
 * ========================================================== */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    switch (p.action || '') {
      case 'getDropdowns':   return json(getDropdowns());
      case 'getMasterData':  return json(getMasterData());
      case 'getSubmissions': return json(getSubmissions(p));
      case 'getStats':       return json(getStats(p));
      case 'getUsers':       return json(getUsers());
      case 'getRegistry':    return json(getRegistry(p));
      case 'getDocuments':   return json(getDocuments());
      case 'ping':           return json({ status: 'success', message: 'API ทำงานปกติ', version: '2.0', time: new Date() });
      default:               return json({ status: 'success', message: 'API ทำงานปกติ', version: '2.0' });
    }
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) payload = JSON.parse(e.postData.contents);
    var action = payload.action || (e && e.parameter && e.parameter.action) || '';

    switch (action) {
      case 'login':        return json(doLogin(payload));
      case 'submitReport': return json(submitReport(payload));
      case 'updateStatus': return json(updateStatus(payload));
      case 'saveUser':     return json(saveUser(payload));
      case 'deleteUser':   return json(deleteUser(payload));
      default:             return json({ status: 'error', message: 'ไม่รู้จักคำสั่ง: ' + action });
    }
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
 *  ตัวช่วยอ่านชีตด้วย "ชื่อหัวคอลัมน์" (ไม่ยึดลำดับ)
 * ========================================================== */

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

/** อ่านทั้งแท็บออกมาเป็น {headers:[], rows:[[]]} */
function readSheet_(name) {
  var sh = sheet_(name);
  if (!sh || sh.getLastRow() < 1) return { sheet: sh, headers: [], rows: [] };
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  return {
    sheet: sh,
    headers: values[0].map(function (h) { return String(h).trim(); }),
    rows: values.slice(1)
  };
}

/** หาเลขคอลัมน์ (0-based) จาก regex ของชื่อหัวคอลัมน์ — ไม่เจอคืน -1 */
function findCol_(headers, re) {
  for (var i = 0; i < headers.length; i++) {
    if (re.test(headers[i])) return i;
  }
  return -1;
}

/**
 * ผังคอลัมน์ของชีตติดตามงาน (รองรับทั้งแท็บ Green และแท็บอาชีวฯ
 * ที่หัวคอลัมน์ต่างกันเล็กน้อย เช่น "หมวด..." กับ "องค์ประกอบ...")
 */
function followMap_(headers) {
  return {
    date:     findCol_(headers, /วันที่ส่ง/),
    code:     findCol_(headers, /รหัสโรงพยาบาล/),
    hospital: findCol_(headers, /ชื่อโรงพยาบาล/),
    hospType: findCol_(headers, /ประเภทโรงพยาบาล/),
    year:     findCol_(headers, /ปีที่ประเมิน/),
    sender:   findCol_(headers, /ผู้ส่งงาน|นามสกุล/),
    phone:    findCol_(headers, /เบอร์/),
    category: findCol_(headers, /หมวดที่ต้องการ|องค์ประกอบที่ต้องการ/),
    item:     findCol_(headers, /ข้อที่ต้องการ/),
    detail:   findCol_(headers, /รายละเอียด/),
    link:     findCol_(headers, /ลิงก์|ลิ้งก์|หลักฐาน/),
    status:   findCol_(headers, /สถานะ/),
    comment:  findCol_(headers, /หมายเหตุ|ข้อเสนอแนะ/),
    level:    findCol_(headers, /ระดับผล/)
  };
}

/* ============================================================
 *  1) LOGIN
 *     ชีต Login: A อำเภอ | B ประเภทหน่วยงาน | C ชื่อโรงพยาบาล
 *                D รหัสผ่าน/รหัสโรงพยาบาล | E สิทธิ์ | F ชื่อผู้บันทึก
 * ========================================================== */

function doLogin(payload) {
  var hospital = String(payload.hospital || payload.username || '').trim();
  var password = String(payload.password || '').trim();

  var d = readSheet_(SHEET_LOGIN);
  if (!d.sheet) return { status: 'error', message: 'ไม่พบชีต ' + SHEET_LOGIN };

  for (var i = 0; i < d.rows.length; i++) {
    var r = d.rows[i];
    var name = String(r[2] || '').trim();
    var pass = String(r[3] || '').trim();
    if (name !== hospital || pass !== password) continue;

    var rawRole = String(r[4] || '').trim();
    var codes = typeCodes_(r[1]);
    // สสจ. หรือช่องสิทธิ์เขียนว่า Admin = ผู้ดูแลระบบ
    var isAdmin = /^admin$/i.test(rawRole) || codes.indexOf('PHO') !== -1;

    return {
      status: 'success',
      role: isAdmin ? 'admin' : 'user',
      hospital: name,
      hospitalCode: pass,                        // รหัสโรงพยาบาล = รหัสผ่านในชีตนี้
      district: String(r[0] || '').trim(),
      hospitalType: String(r[1] || '').trim(),   // ข้อความตามชีต เช่น "รพ.สต."
      typeCode: codes[0] || '',                  // รหัสกลาง เช่น "SUB"
      typeLabel: TYPE_LABEL[codes[0]] || String(r[1] || '').trim(),
      contactName: String(r[5] || '').trim()
    };
  }
  return { status: 'error', message: 'โรงพยาบาลหรือรหัสผ่านไม่ถูกต้อง' };
}

/* ============================================================
 *  2) รายชื่อหน่วยงาน (dropdown หน้า Login)
 * ========================================================== */

function getDropdowns() {
  var d = readSheet_(SHEET_LOGIN);
  if (!d.sheet) return { districts: [], types: [], hospitals: [], fullData: [] };

  var districts = [], types = [], hospitals = [], fullData = [];
  d.rows.forEach(function (r) {
    var district = String(r[0] || '').trim();
    var type     = String(r[1] || '').trim();
    var hospital = String(r[2] || '').trim();
    if (!hospital) return;

    if (district && districts.indexOf(district) === -1) districts.push(district);
    if (type && types.indexOf(type) === -1) types.push(type);
    if (hospitals.indexOf(hospital) === -1) hospitals.push(hospital);

    fullData.push({
      district: district,
      type: type,
      hospital: hospital,
      typeCode: typeCodes_(type)[0] || ''
    });
  });
  return { districts: districts, types: types, hospitals: hospitals, fullData: fullData };
}

/* ============================================================
 *  3) เกณฑ์ประเมิน (Master Data)
 *     A หมวด/องค์ประกอบ | B ข้อ | C ประเภทโรงพยาบาล
 *     คอลัมน์ A เว้นว่างได้ (เซลล์ผสาน) จะยึดหมวดล่าสุด
 * ========================================================== */

function getMasterData() {
  return {
    status: 'success',
    green: readMasterSheet_(SHEET_GREEN),
    occ:   readMasterSheet_(SHEET_OCC)
  };
}

function readMasterSheet_(name) {
  var d = readSheet_(name);
  if (!d.sheet) return [];

  var result = [];
  var currentCategory = '';

  d.rows.forEach(function (r) {
    var category = String(r[0] || '').trim();
    var item     = String(r[1] || '').trim();
    var hospType = String(r[2] || '').trim();

    if (category) currentCategory = category;
    if (!currentCategory || !item) return;

    result.push({
      category: currentCategory,
      item: item,
      hospType: hospType,
      types: typeCodes_(hospType)   // เช่น ["CEN","GEN","COM","OUT"]
    });
  });
  return result;
}

/* ============================================================
 *  4) บันทึกการส่งงาน — เขียนลงคอลัมน์เดิม A–N ของชีตติดตามงาน
 * ========================================================== */

function followSheetName_(workType) {
  return String(workType || '').indexOf('Green') !== -1 ? SHEET_FOLLOW_GREEN : SHEET_FOLLOW_OCC;
}

/* ============================================================
 *  4.5) รับไฟล์หลักฐาน (base64) แล้วเก็บลง Google Drive
 * ========================================================== */

/** โฟลเดอร์หลักที่ใช้เก็บหลักฐาน — ใช้ตาม ID ที่ตั้งไว้ ถ้าไม่ได้ตั้งก็สร้างให้ */
function uploadFolder_() {
  if (UPLOAD_FOLDER_ID) return DriveApp.getFolderById(UPLOAD_FOLDER_ID);
  var it = DriveApp.getFoldersByName(UPLOAD_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(UPLOAD_FOLDER_NAME);
}

/** โฟลเดอร์ย่อยรายหน่วยงาน เพื่อไม่ให้ไฟล์ทุกแห่งกองรวมกัน */
function hospitalFolder_(parent, hospital) {
  var name = String(hospital || '').trim() || 'ไม่ระบุหน่วยงาน';
  name = name.replace(/[\/\\]/g, '-');
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** ตัดอักขระที่ใช้ตั้งชื่อไฟล์ไม่ได้ออก และกันชื่อยาวเกิน */
function safeName_(name) {
  var n = String(name || 'หลักฐาน.pdf').replace(/[\/\\:*?"<>|]/g, '-').trim();
  return n.length > 120 ? n.slice(0, 110) + '.pdf' : n;
}

/**
 * เขียนไฟล์ที่ส่งมาเป็น base64 ลง Drive แล้วคืนลิงก์ของแต่ละไฟล์
 * ถ้ามีไฟล์ใดบันทึกไม่สำเร็จจะ throw เพื่อให้ทั้งรายการไม่ถูกบันทึกลงชีต
 * (ผู้ใช้จะได้กดส่งใหม่ ไม่เกิดแถวที่ไม่มีหลักฐานแนบ)
 */
function saveFiles_(files, payload) {
  if (!files || !files.length) return [];

  var folder = hospitalFolder_(uploadFolder_(), payload.hospital);
  var stamp  = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss');
  var limit  = MAX_UPLOAD_MB * 1024 * 1024;

  return files.map(function (f, i) {
    if (!f || !f.data) throw new Error('ไฟล์ลำดับที่ ' + (i + 1) + ' ไม่มีข้อมูล');

    var bytes = Utilities.base64Decode(f.data);
    if (bytes.length > limit) {
      throw new Error('ไฟล์ ' + f.name + ' ใหญ่เกิน ' + MAX_UPLOAD_MB + ' MB');
    }

    var blob = Utilities.newBlob(bytes, f.mimeType || 'application/pdf',
                                 stamp + '_' + (i + 1) + '_' + safeName_(f.name));
    var file = folder.createFile(blob);

    /* ให้ สสจ. เปิดดูได้จากลิงก์ในชีตโดยไม่ต้องขอสิทธิ์ทีละไฟล์ */
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      /* บางองค์กรปิดการแชร์แบบสาธารณะไว้ — ไฟล์ยังอยู่ครบ เพียงต้องขอสิทธิ์เอง */
    }
    return file.getUrl();
  });
}

function submitReport(payload) {
  var name = followSheetName_(payload.workType);
  var d = readSheet_(name);
  if (!d.sheet) return { status: 'error', message: 'ไม่พบชีต ' + name };

  /* อัปโหลดไฟล์ก่อนเขียนชีต — ถ้าอัปโหลดพลาดจะไม่มีแถวค้างที่ไม่มีหลักฐาน */
  var uploadedLinks = saveFiles_(payload.files, payload);

  var allLinks = uploadedLinks.slice();
  if (payload.driveLink) allLinks.push(payload.driveLink);
  if (!allLinks.length) {
    return { status: 'error', message: 'ต้องแนบไฟล์หลักฐาน หรือใส่ลิงก์ Google Drive อย่างน้อยหนึ่งอย่าง' };
  }

  var m = followMap_(d.headers);
  var row = new Array(d.headers.length).fill('');
  var put = function (idx, val) { if (idx >= 0) row[idx] = val; };

  put(m.date,     new Date());
  put(m.code,     payload.hospitalCode || '');
  put(m.hospital, payload.hospital || '');
  put(m.hospType, payload.hospType || '');
  put(m.year,     payload.year || '');
  put(m.sender,   payload.senderName || '');
  put(m.phone,    payload.phone || '');
  put(m.category, (payload.categories || []).join('\n'));
  put(m.item,     (payload.items || []).join('\n'));
  put(m.detail,   payload.detail || '');
  put(m.link,     allLinks.join('\n'));
  put(m.status,   STATUS_PENDING);
  put(m.comment,  '');
  put(m.level,    payload.level || '');

  d.sheet.appendRow(row);

  return {
    status: 'success',
    message: 'บันทึกข้อมูลเรียบร้อยแล้ว',
    sheet: name,
    row: d.sheet.getLastRow(),
    uploaded: uploadedLinks.length,
    links: allLinks
  };
}

/* ============================================================
 *  5) อ่านรายการส่งงาน (หน้า Admin + ประวัติของโรงพยาบาล)
 *     ชีตติดตามงานไม่มีคอลัมน์ "อำเภอ" จึงไป join จากชีต Login ให้
 * ========================================================== */

function districtMap_() {
  var d = readSheet_(SHEET_LOGIN);
  var map = {};
  if (!d.sheet) return map;
  d.rows.forEach(function (r) {
    var hospital = String(r[2] || '').trim();
    if (!hospital) return;
    map[hospital] = {
      district: String(r[0] || '').trim(),
      hospitalType: String(r[1] || '').trim(),
      code: String(r[3] || '').trim()
    };
  });
  return map;
}

function getSubmissions(params) {
  params = params || {};
  var want = String(params.workType || 'all');
  var names = want === 'green' ? [SHEET_FOLLOW_GREEN]
            : want === 'occ'   ? [SHEET_FOLLOW_OCC]
            : [SHEET_FOLLOW_GREEN, SHEET_FOLLOW_OCC];

  var dmap = districtMap_();
  var out = [];

  names.forEach(function (name) {
    var d = readSheet_(name);
    if (!d.sheet || !d.rows.length) return;
    var m = followMap_(d.headers);
    var workType = name === SHEET_FOLLOW_GREEN ? 'งาน Green & Clean' : 'งานอาชีวอนามัยฯ';

    d.rows.forEach(function (r, idx) {
      var get = function (i) { return i >= 0 ? r[i] : ''; };
      var hospital = String(get(m.hospital) || '').trim();
      var when = get(m.date);
      if (!hospital && !when && !get(m.sender)) return;   // ข้ามแถวว่าง

      var extra = dmap[hospital] || {};
      out.push({
        sheet:        name,
        row:          idx + 2,
        workType:     workType,
        submittedAt:  when ? new Date(when).toISOString() : '',
        hospitalCode: String(get(m.code) || extra.code || ''),
        hospital:     hospital,
        district:     extra.district || '',
        hospType:     String(get(m.hospType) || extra.hospitalType || ''),
        year:         String(get(m.year) || ''),
        senderName:   String(get(m.sender) || ''),
        phone:        String(get(m.phone) || ''),
        categories:   String(get(m.category) || ''),
        items:        String(get(m.item) || ''),
        detail:       String(get(m.detail) || ''),
        driveLink:    String(get(m.link) || ''),
        status:       String(get(m.status) || '').trim() || STATUS_PENDING,
        comment:      String(get(m.comment) || ''),
        level:        String(get(m.level) || '')
      });
    });
  });

  ['hospital', 'district', 'year', 'status'].forEach(function (key) {
    var val = params[key];
    if (!val) return;
    out = out.filter(function (o) { return String(o[key]).trim() === String(val).trim(); });
  });

  out.sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
  return { status: 'success', count: out.length, data: out };
}

function getStats(params) {
  var rows = getSubmissions(params || {}).data;
  var n = function (s) { return rows.filter(function (r) { return r.status === s; }).length; };
  return {
    status: 'success',
    total: rows.length,
    pending: n(STATUS_PENDING),
    checking: n(STATUS_CHECKING),
    revise: n(STATUS_REVISE),
    approved: n(STATUS_APPROVED)
  };
}

/** หน้า Admin กด "บันทึกผลการตรวจ" → เขียนคอลัมน์ สถานะ + หมายเหตุ */
function updateStatus(payload) {
  var name = payload.sheet;
  var rowNo = parseInt(payload.row, 10);
  if (!name || !rowNo || rowNo < 2) return { status: 'error', message: 'ข้อมูลอ้างอิงแถวไม่ถูกต้อง' };

  var sh = sheet_(name);
  if (!sh) return { status: 'error', message: 'ไม่พบชีต ' + name };
  if (rowNo > sh.getLastRow()) return { status: 'error', message: 'ไม่พบแถวที่ระบุ' };

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                  .map(function (h) { return String(h).trim(); });
  var m = followMap_(headers);

  if (m.status >= 0) sh.getRange(rowNo, m.status + 1).setValue(payload.status || STATUS_CHECKING);

  if (m.comment >= 0) {
    // ต่อท้ายชื่อผู้ตรวจกับวันที่ไว้ในช่องหมายเหตุ เพราะชีตไม่มีคอลัมน์แยก
    var note = String(payload.comment || '').trim();
    var who  = String(payload.reviewer || '').trim();
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    sh.getRange(rowNo, m.comment + 1).setValue(note ? note + '\n— ' + who + ' (' + stamp + ')' : '');
  }

  return { status: 'success', message: 'บันทึกผลการตรวจเรียบร้อยแล้ว' };
}

/* ============================================================
 *  6) ทะเบียนรายชื่อโรงพยาบาล — ผลการรับรองล่าสุดของแต่ละแห่ง
 * ========================================================== */

function getRegistry(params) {
  var d = readSheet_(SHEET_REGISTRY);
  if (!d.sheet) return { status: 'success', data: [] };

  var h = d.headers;
  var col = {
    code:        findCol_(h, /รหัสโรงพยาบาล/),
    hospital:    findCol_(h, /ชื่อโรงพยาบาล/),
    hospType:    findCol_(h, /ประเภทโรงพยาบาล/),
    district:    findCol_(h, /อำเภอ/),
    greenYear:   findCol_(h, /ปีที่ประเมิน Green/),
    greenExpire: findCol_(h, /Green หมดอายุ/),
    greenLevel:  findCol_(h, /ระดับผลการประเมิน Green/),
    greenStatus: findCol_(h, /สถานะการรับรอง Green/),
    occYear:     findCol_(h, /ปีที่ประเมินอาชีว/),
    occExpire:   findCol_(h, /อาชีวฯ หมดอายุ/),
    occLevel:    findCol_(h, /ระดับผลการประเมิน อาชีว/),
    occStatus:   findCol_(h, /สถานะการรับรอง อาชีว/)
  };

  var out = [];
  d.rows.forEach(function (r) {
    var get = function (i) { return i >= 0 ? String(r[i] || '').trim() : ''; };
    var hospital = get(col.hospital);
    if (!hospital) return;
    out.push({
      hospitalCode: get(col.code),
      hospital: hospital,
      hospType: get(col.hospType),
      district: get(col.district),
      green: { year: get(col.greenYear), expire: get(col.greenExpire), level: get(col.greenLevel), status: get(col.greenStatus) },
      occ:   { year: get(col.occYear),   expire: get(col.occExpire),   level: get(col.occLevel),   status: get(col.occStatus) }
    });
  });

  if (params && params.hospital) {
    out = out.filter(function (o) { return o.hospital === String(params.hospital).trim(); });
  }
  return { status: 'success', count: out.length, data: out };
}

/* ============================================================
 *  7) คลังคู่มือ/เอกสาร
 *     หาแท็บอัตโนมัติจากหัวคอลัมน์ FileUrl (ไม่ต้องรู้ชื่อแท็บ)
 * ========================================================== */

function getDocuments() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    if (sh.getLastRow() < 1) continue;
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                    .map(function (x) { return String(x).trim(); });
    if (findCol_(headers, /FileUrl/i) === -1) continue;

    var col = {
      workType: findCol_(headers, /WorkType/i),
      title:    findCol_(headers, /DocumentTitle|ชื่อเอกสาร/i),
      target:   findCol_(headers, /TargetGroup|กลุ่มเป้าหมาย/i),
      url:      findCol_(headers, /FileUrl/i)
    };

    var data = [];
    if (sh.getLastRow() >= 2) {
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function (r) {
        var get = function (idx) { return idx >= 0 ? String(r[idx] || '').trim() : ''; };
        if (!get(col.url)) return;
        data.push({
          workType: get(col.workType),
          title: get(col.title),
          target: get(col.target),
          url: get(col.url)
        });
      });
    }
    return { status: 'success', sheet: sh.getName(), count: data.length, data: data };
  }
  return { status: 'success', count: 0, data: [] };
}

/* ============================================================
 *  8) จัดการผู้ใช้งาน
 * ========================================================== */

function getUsers() {
  var d = readSheet_(SHEET_LOGIN);
  if (!d.sheet) return { status: 'success', data: [] };

  var out = [];
  d.rows.forEach(function (r, idx) {
    var hospital = String(r[2] || '').trim();
    if (!hospital) return;
    var rawRole = String(r[4] || '').trim();
    out.push({
      row: idx + 2,
      district: String(r[0] || '').trim(),
      type: String(r[1] || '').trim(),
      hospital: hospital,
      password: String(r[3] || '').trim(),
      rawRole: rawRole,
      role: /^admin$/i.test(rawRole) ? 'admin' : 'user',
      contactName: String(r[5] || '').trim()
    });
  });
  return { status: 'success', count: out.length, data: out };
}

function saveUser(payload) {
  var sh = sheet_(SHEET_LOGIN);
  if (!sh) return { status: 'error', message: 'ไม่พบชีต ' + SHEET_LOGIN };

  var hospital = String(payload.hospital || '').trim();
  if (!hospital) return { status: 'error', message: 'กรุณาระบุชื่อโรงพยาบาล/หน่วยงาน' };

  // เก็บคำเดิมในชีต (Hospital / Admin) ไม่เปลี่ยนรูปแบบที่พี่ใช้อยู่
  var roleText = payload.role === 'admin' ? 'Admin' : 'Hospital';
  var values = [
    String(payload.district || '').trim(),
    String(payload.type || '').trim(),
    hospital,
    String(payload.password || '').trim(),
    roleText,
    String(payload.contactName || '').trim()
  ];

  var rowNo = parseInt(payload.row, 10);
  if (rowNo && rowNo >= 2 && rowNo <= sh.getLastRow()) {
    sh.getRange(rowNo, 1, 1, 6).setValues([values]);
    return { status: 'success', message: 'แก้ไขผู้ใช้งานเรียบร้อยแล้ว', row: rowNo };
  }

  if (sh.getLastRow() >= 2) {
    var existing = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).trim() === hospital) {
        return { status: 'error', message: 'มีผู้ใช้งานชื่อนี้อยู่แล้ว' };
      }
    }
  }

  sh.appendRow(values);
  return { status: 'success', message: 'เพิ่มผู้ใช้งานเรียบร้อยแล้ว', row: sh.getLastRow() };
}

function deleteUser(payload) {
  var sh = sheet_(SHEET_LOGIN);
  if (!sh) return { status: 'error', message: 'ไม่พบชีต ' + SHEET_LOGIN };

  var rowNo = parseInt(payload.row, 10);
  if (!rowNo || rowNo < 2 || rowNo > sh.getLastRow()) {
    return { status: 'error', message: 'ไม่พบผู้ใช้งานที่ต้องการลบ' };
  }
  sh.deleteRow(rowNo);
  return { status: 'success', message: 'ลบผู้ใช้งานเรียบร้อยแล้ว' };
}
