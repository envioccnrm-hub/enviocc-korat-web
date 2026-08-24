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
 * แยกคนละโฟลเดอร์ตามสายงาน ใส่ ID ของโฟลเดอร์ที่ต้องการไว้ตรงนี้
 * (ID คือข้อความยาว ๆ ท้าย URL: drive.google.com/drive/folders/<ID>)
 * ถ้าเว้น ID ว่างไว้ ระบบจะหา/สร้างโฟลเดอร์ตามชื่อด้านล่างให้เองอัตโนมัติ
 * ภายในแต่ละโฟลเดอร์จะแยกเป็นโฟลเดอร์ย่อยตามชื่อหน่วยงานอีกชั้น
 *
 * สำคัญ: บัญชีที่เป็นเจ้าของ Apps Script ต้องมีสิทธิ์แก้ไขโฟลเดอร์นี้
 *        ไม่งั้นจะอัปโหลดไม่ได้ */
const UPLOAD_FOLDER_GREEN_ID   = "1n3A4TMzsG5aL5FRzX3HN0E0V4TnjWqtU";
const UPLOAD_FOLDER_GREEN_NAME = "รวมไฟล์ PDF งานแก้ไข Green & Clean";

const UPLOAD_FOLDER_OCC_ID     = "1vd3CTraIlZrZN01ONsXc54MYZ1uHuCVa";
const UPLOAD_FOLDER_OCC_NAME   = "รวมไฟล์ PDF งานแก้ไข อาชีวอนามัยฯ";

const MAX_UPLOAD_MB            = 15;   /* ต่อไฟล์ ต้องตรงกับ MAX_FILE_MB ใน assets/hospital.js */

/* ---------- สถานะงาน (ต้องตรงกับ assets/config.js) ---------- */
const STATUS_PENDING  = "รอตรวจสอบ";
const STATUS_CHECKING = "ดำเนินการตรวจสอบแล้ว";
const STATUS_REVISE   = "ต้องแก้ไขเพิ่มเติม";
const STATUS_APPROVED = "รับรองผลเรียบร้อยแล้ว";

/* ---------- อายุของ token หลังล็อกอิน (ชั่วโมง) ---------- */
const TOKEN_TTL_HOURS = 12;

/* เลขรุ่นของโค้ด — เรียก ?action=ping เพื่อดูว่าที่ deploy อยู่เป็นรุ่นไหน */
const CODE_VERSION = '2026-08-24d';

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
 *  ตรวจสิทธิ์ — หัวใจของการกั้นข้อมูล
 *
 *  เดิมทุก action เชื่อค่าที่หน้าเว็บส่งมาล้วน ๆ ใครรู้ URL /exec
 *  ก็เรียกดูข้อมูลทุกโรงพยาบาลได้ ตอนนี้ทุก action (ยกเว้นหน้าล็อกอิน)
 *  ต้องแนบ token ที่ออกให้ตอนล็อกอิน และ "ขอบเขตข้อมูล" ถูกบังคับจาก
 *  token ไม่ใช่จากพารามิเตอร์ที่ส่งมา
 *
 *  token เป็นแบบมีลายเซ็น (HMAC) จึงไม่ต้องเก็บฝั่งเซิร์ฟเวอร์
 *  แก้ไขเนื้อในไม่ได้เพราะลายเซ็นจะไม่ตรง และหมดอายุเองตาม TOKEN_TTL_HOURS
 * ========================================================== */

/** กุญแจสำหรับเซ็น token — สร้างครั้งเดียวแล้วเก็บไว้ใน Script Properties */
function tokenSecret_() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('TOKEN_SECRET');
  if (!k) {
    k = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', k);
  }
  return k;
}

function sign_(data) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(data, tokenSecret_()));
}

/** ออก token ให้หลังล็อกอินสำเร็จ */
function issueToken_(sess) {
  /* ต้องระบุ UTF-8 ให้ชัด ไม่งั้นชื่อหน่วยงานภาษาไทยจะกลายเป็น ???????? */
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({
    r: sess.role,
    h: sess.hospital,
    e: Date.now() + TOKEN_TTL_HOURS * 3600 * 1000
  }), Utilities.Charset.UTF_8);
  return body + '.' + sign_(body);
}

/** อ่าน token คืน null ถ้าปลอม/แก้ไข/หมดอายุ */
function readToken_(token) {
  var t = String(token || '');
  var dot = t.indexOf('.');
  if (dot < 1) return null;

  var body = t.slice(0, dot), sig = t.slice(dot + 1);
  if (sign_(body) !== sig) return null;          /* ลายเซ็นไม่ตรง = ถูกแก้หรือปลอม */

  var rec;
  try {
    /* อ่านกลับเป็น UTF-8 ให้ตรงกับตอนเข้ารหัส */
    rec = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(body)).getDataAsString('UTF-8'));
  } catch (err) { return null; }

  if (!rec || !rec.e || rec.e < Date.now()) return null;   /* หมดอายุ */

  /* token รุ่นเก่าเข้ารหัสโดยไม่ระบุ UTF-8 ชื่อหน่วยงานภาษาไทยจึงกลายเป็น ????
     ถ้าเจอแบบนั้นให้ถือว่าใช้ไม่ได้ ผู้ใช้จะถูกพาไปล็อกอินใหม่แล้วได้ token ที่ถูกต้อง
     ดีกว่าปล่อยผ่านแล้วไปกรองข้อมูลผิดหรือเขียนชื่อขยะลงชีต */
  var h = String(rec.h || '');
  if (/\?{3,}/.test(h)) return null;

  return { role: rec.r, hospital: h };
}

/** ต้องล็อกอินก่อน */
function requireAuth_(p) {
  var sess = readToken_(p && p.token);
  if (!sess) throw new Error('AUTH_REQUIRED');
  return sess;
}

/** เฉพาะ สสจ. เท่านั้น */
function requireAdmin_(p) {
  var sess = requireAuth_(p);
  if (sess.role !== 'admin') throw new Error('FORBIDDEN');
  return sess;
}

/**
 * สร้างพารามิเตอร์การกรองที่ "เชื่อถือได้"
 * ถ้าไม่ใช่ สสจ. จะบังคับ hospital เป็นของตัวเองเสมอ
 * ต่อให้หน้าเว็บส่งชื่อโรงพยาบาลอื่นมาก็ไม่มีผล
 */
function scoped_(p) {
  var sess = requireAuth_(p);
  var out = {};
  ['workType', 'hospital', 'district', 'year', 'status'].forEach(function (k) {
    if (p[k]) out[k] = p[k];
  });
  if (sess.role !== 'admin') out.hospital = sess.hospital;
  return out;
}

/**
 * ขอบเขตของสถิติรวม
 * หน้าโรงพยาบาลต้องใช้ค่าเฉลี่ยทั้งจังหวัดมาเทียบกับตัวเอง จึงไม่บังคับ
 * ให้เหลือแต่ของตัวเอง แต่ก็ไม่ยอมให้เจาะดูสถิติของโรงพยาบาลอื่นเป็นราย ๆ
 * (ผลลัพธ์เป็นตัวเลขรวมล้วน ไม่มีชื่อผู้ส่ง เบอร์โทร หรือลิงก์หลักฐาน)
 */
function statsScope_(p) {
  var sess = requireAuth_(p);
  if (sess.role === 'admin') return p;
  var out = {};
  if (p.workType) out.workType = p.workType;
  return out;
}

/* ============================================================
 *  ตัวตรวจระบบ — รันเองจากหน้า Apps Script ได้เลย
 *
 *  วิธีใช้: เลือกฟังก์ชัน "ตรวจระบบ" ที่แถบด้านบน แล้วกด Run
 *          ผลลัพธ์ดูได้ที่ Execution log (Ctrl/Cmd + Enter)
 *
 *  ถ้ายังไม่เคยอนุญาตสิทธิ์ Google Drive การกด Run จะขึ้นหน้าต่างขออนุญาต
 *  ให้กดอนุญาตให้ครบ — นี่คือวิธีที่แน่นอนที่สุดในการเปิดสิทธิ์ Drive
 *  เพราะการกด Deploy เฉย ๆ บางครั้งไม่ขอสิทธิ์ใหม่ให้
 * ========================================================== */

function ตรวจระบบ() {
  var out = [];
  var ok = 0, fail = 0;

  var check = function (label, fn) {
    try {
      var msg = fn();
      out.push('[ผ่าน] ' + label + (msg ? ' — ' + msg : ''));
      ok++;
    } catch (err) {
      out.push('[ไม่ผ่าน] ' + label + ' — ' + (err && err.message ? err.message : err));
      fail++;
    }
  };

  /* 1) โฟลเดอร์ Drive — ต้องเปิดได้และสร้างไฟล์ได้จริง */
  [['งาน Green & Clean', UPLOAD_FOLDER_GREEN_ID],
   ['งานอาชีวอนามัยฯ',  UPLOAD_FOLDER_OCC_ID]].forEach(function (pair) {
    check('โฟลเดอร์ ' + pair[0], function () {
      var f = DriveApp.getFolderById(pair[1]);
      /* ทดสอบเขียนจริง แล้วลบทิ้ง — เปิดได้อย่างเดียวไม่พอ ต้องเขียนได้ด้วย */
      var probe = f.createFile(Utilities.newBlob('test', 'text/plain', '__ทดสอบสิทธิ์__.txt'));
      probe.setTrashed(true);
      return 'ชื่อ "' + f.getName() + '" เขียนไฟล์ได้';
    });
  });

  /* 2) ชีตและหัวคอลัมน์ที่ระบบต้องใช้ */
  [SHEET_FOLLOW_GREEN, SHEET_FOLLOW_OCC].forEach(function (name) {
    check('ชีต ' + name, function () {
      var d = readSheet_(name);
      if (!d.sheet) throw new Error('ไม่พบชีตนี้');
      var m = followMap_(d.headers);
      var missing = [];
      if (m.hospital < 0) missing.push('ชื่อโรงพยาบาล');
      if (m.status   < 0) missing.push('สถานะ');
      if (m.link     < 0) missing.push('ลิงก์/หลักฐาน');
      if (m.level    < 0) missing.push('ระดับผลการประเมิน');
      if (missing.length) {
        throw new Error('ไม่พบคอลัมน์: ' + missing.join(', ') +
                        ' | หัวคอลัมน์ที่มี: ' + d.headers.filter(String).join(' | '));
      }
      return 'คอลัมน์ครบ (' + d.rows.length + ' แถว)';
    });
  });

  check('ชีต ' + SHEET_LOGIN, function () {
    var d = readSheet_(SHEET_LOGIN);
    if (!d.sheet) throw new Error('ไม่พบชีตนี้');
    return d.rows.length + ' บัญชี';
  });

  /* 3) การเข้ารหัสภาษาไทยใน token */
  check('เข้ารหัสชื่อภาษาไทยใน token', function () {
    var t = issueToken_({ role: 'user', hospital: 'โรงพยาบาลทดสอบภาษาไทย' });
    var back = readToken_(t);
    if (!back) throw new Error('อ่าน token กลับไม่ได้');
    if (back.hospital !== 'โรงพยาบาลทดสอบภาษาไทย') {
      throw new Error('ชื่อเพี้ยนเป็น "' + back.hospital + '" — โค้ดที่ deploy ยังเป็นเวอร์ชันเก่า');
    }
    return 'ภาษาไทยไม่เพี้ยน';
  });

  var report = '===== ผลตรวจระบบ =====\n' + out.join('\n') +
               '\n\nผ่าน ' + ok + ' รายการ / ไม่ผ่าน ' + fail + ' รายการ';
  Logger.log(report);
  return report;
}

/* ============================================================
 *  ROUTER
 * ========================================================== */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    switch (p.action || '') {
      /* --- เปิดสาธารณะ: หน้าล็อกอินต้องใช้ก่อนจะมี token --- */
      case 'getDropdowns':   return json(getDropdowns());

      /* --- ต้องล็อกอิน --- */
      case 'getMasterData':  requireAuth_(p); return json(getMasterData());
      case 'getSettings':    requireAuth_(p); return json(getSettings());
      case 'getDocuments':   requireAuth_(p); return json(getDocuments());
      case 'getSubmissions': return json(getSubmissions(scoped_(p)));
      case 'getRegistry':    return json(getRegistry(scoped_(p)));
      case 'getStats':       return json(getStats(statsScope_(p)));

      /* --- เฉพาะ สสจ. --- */
      case 'getUsers':       requireAdmin_(p); return json(getUsers());
      case 'ping':           return json({ status: 'success', message: 'API ทำงานปกติ', version: CODE_VERSION, time: new Date() });
      default:               return json({ status: 'success', message: 'API ทำงานปกติ', version: '2.0' });
    }
  } catch (err) {
    return json(errorPayload_(err));
  }
}

function doPost(e) {
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) payload = JSON.parse(e.postData.contents);
    var action = payload.action || (e && e.parameter && e.parameter.action) || '';

    switch (action) {
      /* --- เปิดสาธารณะ --- */
      case 'login':        return json(doLogin(payload));

      /* --- ต้องล็อกอิน --- */
      case 'submitReport': return json(submitReport(payload));

      /* --- เฉพาะ สสจ. --- */
      case 'updateStatus': requireAdmin_(payload); return json(updateStatus(payload));
      case 'saveUser':     requireAdmin_(payload); return json(saveUser(payload));
      case 'saveSettings': requireAdmin_(payload); return json(saveSettings(payload));
      case 'deleteUser':   requireAdmin_(payload); return json(deleteUser(payload));
      default:             return json({ status: 'error', message: 'ไม่รู้จักคำสั่ง: ' + action });
    }
  } catch (err) {
    return json(errorPayload_(err));
  }
}

/** แปลง error ให้หน้าเว็บรู้ว่าเป็นเรื่องสิทธิ์ จะได้เด้งไปล็อกอินใหม่ได้ถูก */
function errorPayload_(err) {
  var msg = String(err && err.message || err);
  if (msg.indexOf('AUTH_REQUIRED') !== -1) {
    return { status: 'error', code: 'AUTH_REQUIRED',
             message: 'เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่' };
  }
  if (msg.indexOf('FORBIDDEN') !== -1) {
    return { status: 'error', code: 'FORBIDDEN',
             message: 'บัญชีนี้ไม่มีสิทธิ์ใช้คำสั่งนี้' };
  }
  return { status: 'error', message: msg };
}

/* ============================================================
 *  ค่าตั้งค่าระบบ — ตอนนี้ใช้เก็บเป้าหมาย KPI ของทั้งสองสายงาน
 *  เก็บใน Script Properties เพื่อให้ทุกคนเห็นค่าเดียวกัน
 *  (ถ้าเก็บในเบราว์เซอร์ ต่างคนจะตั้งคนละค่า ตัวเลขในแดชบอร์ดจะไม่ตรงกัน)
 * ========================================================== */

const SETTINGS_KEY = 'APP_SETTINGS';

function getSettings() {
  var raw = PropertiesService.getScriptProperties().getProperty(SETTINGS_KEY);
  var val = {};
  if (raw) { try { val = JSON.parse(raw); } catch (e) { val = {}; } }
  return { status: 'success', data: val };
}

function saveSettings(payload) {
  var incoming = payload && payload.settings;
  if (!incoming || typeof incoming !== 'object') {
    return { status: 'error', message: 'ไม่มีค่าที่จะบันทึก' };
  }
  PropertiesService.getScriptProperties()
    .setProperty(SETTINGS_KEY, JSON.stringify(incoming));
  return { status: 'success', message: 'บันทึกเป้าหมาย KPI เรียบร้อยแล้ว', data: incoming };
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
/** ลองหลายรูปแบบตามลำดับ ใช้ตัวแรกที่เจอ */
function findColAny_(headers, list) {
  for (var i = 0; i < list.length; i++) {
    var idx = findCol_(headers, list[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

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
    /* ชีตแต่ละแท็บอาจตั้งชื่อไม่เหมือนกัน ลองจากเจาะจงไปกว้าง
       กันกรณีหัวคอลัมน์เขียนว่า "ระดับการรับรอง" หรือ "ระดับที่ได้รับ" */
    level:    findColAny_(headers, [/ระดับผล/, /ระดับการรับรอง/, /ระดับที่ได้/, /ระดับ/])
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

    var role = isAdmin ? 'admin' : 'user';

    return {
      status: 'success',
      role: role,
      /* token นี้คือสิ่งที่ใช้ยืนยันตัวตนกับทุกคำสั่งหลังจากนี้ */
      token: issueToken_({ role: role, hospital: name }),
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
function uploadFolder_(workType) {
  var green = String(workType || '').indexOf('Green') !== -1;
  var id    = green ? UPLOAD_FOLDER_GREEN_ID   : UPLOAD_FOLDER_OCC_ID;
  var name  = green ? UPLOAD_FOLDER_GREEN_NAME : UPLOAD_FOLDER_OCC_NAME;

  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      /* บอกให้ชัดว่าติดที่โฟลเดอร์ไหน จะได้ไม่ต้องไล่เดา */
      throw new Error('เปิดโฟลเดอร์ Drive ของ' + (green ? 'งาน Green & Clean' : 'งานอาชีวอนามัยฯ') +
                      ' ไม่ได้ (ID: ' + id + ') — ตรวจว่าบัญชีเจ้าของ Apps Script ' +
                      'มีสิทธิ์แก้ไขโฟลเดอร์นี้หรือยัง');
    }
  }
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

/** โฟลเดอร์ย่อยรายหน่วยงาน เพื่อไม่ให้ไฟล์ทุกแห่งกองรวมกัน */
/** หาโฟลเดอร์ย่อยตามชื่อ ถ้ายังไม่มีก็สร้างให้ */
function subFolder_(parent, name) {
  var n = String(name || '').trim().replace(/[\/\\]/g, '-') || 'ไม่ระบุ';
  var it = parent.getFoldersByName(n);
  return it.hasNext() ? it.next() : parent.createFolder(n);
}

/** ชื่อสายงานแบบเต็ม ใช้เป็นทั้งชื่อโฟลเดอร์และส่วนหนึ่งของชื่อไฟล์ */
function workFolderName_(workType) {
  return String(workType || '').indexOf('Green') !== -1
    ? 'งาน Green & Clean'
    : 'งานอาชีวอนามัยและเวชกรรมสิ่งแวดล้อม';
}

/** ตัดอักขระที่ใช้ตั้งชื่อไฟล์ไม่ได้ออก และกันชื่อยาวเกิน */
function safeName_(name) {
  var n = String(name || 'หลักฐาน').replace(/[\/\\:*?"<>|]/g, '-').trim();
  return n.length > 120 ? n.slice(0, 120) : n;
}

/**
 * เขียนไฟล์ที่ส่งมาเป็น base64 ลง Drive แล้วคืนลิงก์ของแต่ละไฟล์
 * ถ้ามีไฟล์ใดบันทึกไม่สำเร็จจะ throw เพื่อให้ทั้งรายการไม่ถูกบันทึกลงชีต
 * (ผู้ใช้จะได้กดส่งใหม่ ไม่เกิดแถวที่ไม่มีหลักฐานแนบ)
 */
function saveFiles_(files, payload) {
  if (!files || !files.length) return [];

  /* โครงโฟลเดอร์:  <โฟลเดอร์ของสายงาน> / <ชื่อหน่วยงาน> / ไฟล์
     ตัวโฟลเดอร์หลักแยกตามสายงานอยู่แล้ว จึงเหลือแค่แยกรายหน่วยงานข้างใน */
  var work   = workFolderName_(payload.workType);
  var folder = subFolder_(uploadFolder_(payload.workType), payload.hospital);

  var stamp  = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmm');
  var limit  = MAX_UPLOAD_MB * 1024 * 1024;
  var many   = files.length > 1;

  /* ชื่อไฟล์: [ชื่อโรงพยาบาล]_[ประเภทงาน]_[ปีที่ประเมิน]_[วันเวลาที่ส่ง].pdf
     ตั้งให้ค้นหาง่ายว่าไฟล์ไหนของหน่วยงานใด เมื่อมีหลายแห่งส่งเข้ามา */
  var base = [
    String(payload.hospital || 'ไม่ระบุหน่วยงาน').trim(),
    work,
    String(payload.year || 'ไม่ระบุปี').trim(),
    stamp
  ].join('_');

  return files.map(function (f, i) {
    if (!f || !f.data) throw new Error('ไฟล์ลำดับที่ ' + (i + 1) + ' ไม่มีข้อมูล');

    var bytes = Utilities.base64Decode(f.data);
    if (bytes.length > limit) {
      throw new Error('ไฟล์ ' + f.name + ' ใหญ่เกิน ' + MAX_UPLOAD_MB + ' MB');
    }

    /* แนบหลายไฟล์ในครั้งเดียว ต่อท้ายลำดับกันชื่อซ้ำ */
    var fileName = safeName_(base + (many ? '_' + (i + 1) : '')) + '.pdf';

    var blob = Utilities.newBlob(bytes, f.mimeType || 'application/pdf', fileName);
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
  /* ต้องล็อกอิน และถ้าไม่ใช่ สสจ. จะส่งในนามหน่วยงานอื่นไม่ได้ */
  var sess = requireAuth_(payload);
  if (sess.role !== 'admin') payload.hospital = sess.hospital;

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

  /* ถ้าไม่มีคอลัมน์หลักฐาน ลิงก์จะหายไปเงียบ ๆ ทั้งที่ระบบขึ้นว่าบันทึกสำเร็จ
     จึงต้องหยุดและบอกให้ชัด ก่อนที่ผู้ใช้จะเข้าใจผิดว่าแนบหลักฐานไปแล้ว */
  if (m.link < 0) {
    return {
      status: 'error',
      message: 'ไม่พบคอลัมน์สำหรับเก็บลิงก์หลักฐานในชีต "' + name + '" — ' +
               'กรุณาตั้งชื่อหัวคอลัมน์ให้มีคำว่า "ลิงก์" หรือ "หลักฐาน" ' +
               '(หัวคอลัมน์ที่มีอยู่: ' + d.headers.filter(String).join(' | ') + ')'
    };
  }

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
    links: allLinks,
    linkColumn: String(d.headers[m.link] || '')
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

  var cols = headers.filter(String).join(' | ');

  /* ตรวจให้ครบก่อน แล้วค่อยเขียน จะได้ไม่เขียนไปครึ่งเดียวแล้วค่อยแจ้ง error */
  if (m.status < 0) {
    return { status: 'error',
             message: 'ไม่พบคอลัมน์ "สถานะ" ในชีต "' + name + '" จึงบันทึกผลไม่ได้ ' +
                      '(หัวคอลัมน์ที่มีอยู่: ' + cols + ')' };
  }
  if (payload.level && m.level < 0) {
    return { status: 'error',
             message: 'ไม่พบคอลัมน์สำหรับเก็บระดับผลการประเมินในชีต "' + name + '" — ' +
                      'กรุณาตั้งชื่อหัวคอลัมน์ให้มีคำว่า "ระดับผล" หรือ "ระดับการรับรอง" ' +
                      '(หัวคอลัมน์ที่มีอยู่: ' + cols + ')' };
  }

  sh.getRange(rowNo, m.status + 1).setValue(payload.status || STATUS_CHECKING);

  /* ระดับการรับรอง — เขียนเฉพาะตอนที่ส่งค่ามา เพื่อไม่ไปลบระดับเดิมตอนแค่เปลี่ยนสถานะ */
  if (payload.level) sh.getRange(rowNo, m.level + 1).setValue(payload.level);

  if (m.comment >= 0) {
    // ต่อท้ายชื่อผู้ตรวจกับวันที่ไว้ในช่องหมายเหตุ เพราะชีตไม่มีคอลัมน์แยก
    var note = String(payload.comment || '').trim();
    var who  = String(payload.reviewer || '').trim();
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    sh.getRange(rowNo, m.comment + 1).setValue(note ? note + '\n— ' + who + ' (' + stamp + ')' : '');
  }

  return {
    status: 'success',
    message: 'บันทึกผลการตรวจเรียบร้อยแล้ว',
    row: rowNo,
    savedStatus: payload.status || STATUS_CHECKING,
    savedLevel: payload.level || '',
    levelColumn: m.level >= 0 ? String(headers[m.level] || '') : ''
  };
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
      /* ไม่ส่งรหัสผ่านกลับออกไปเด็ดขาด — หน้าเว็บไม่มีอะไรต้องใช้ค่านี้
         การแก้ไขผู้ใช้โดยเว้นช่องรหัสผ่านว่าง จัดการที่ saveUser ให้แล้ว */
      hasPassword: !!String(r[3] || '').trim(),
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
  var rowNo = parseInt(payload.row, 10);
  var pass = String(payload.password || '').trim();

  /* แก้ไขผู้ใช้เดิมแล้วเว้นช่องรหัสผ่านว่าง = คงรหัสเดิมไว้
     (อ่านจากชีตตรงนี้ ไม่ต้องให้หน้าเว็บส่งรหัสเดิมกลับมา) */
  if (!pass && rowNo && rowNo >= 2 && rowNo <= sh.getLastRow()) {
    pass = String(sh.getRange(rowNo, 4).getValue() || '').trim();
  }
  if (!pass) return { status: 'error', message: 'กรุณาตั้งรหัสผ่าน' };

  var values = [
    String(payload.district || '').trim(),
    String(payload.type || '').trim(),
    hospital,
    pass,
    roleText,
    String(payload.contactName || '').trim()
  ];

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
