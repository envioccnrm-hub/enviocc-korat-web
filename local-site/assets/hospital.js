/*  หน้าโรงพยาบาล (hospital.html) — สิทธิ์ 'user'
 *
 *  หลักการเชื่อมข้อมูล:
 *    ล็อกอิน → ได้ typeCode ของหน่วยงาน (เช่น SUB = รพ.สต.)
 *            → กรองเกณฑ์ใน Master_Data ด้วย typeCode (ไม่เทียบข้อความ จึงไม่พลาดเพราะพิมพ์ต่างกัน)
 *            → ส่งงาน = เขียนลงชีตติดตามงานคอลัมน์เดิม A–N
 *            → ประวัติ/สถานะ = อ่านกลับจากชีตเดียวกัน
 */
(function () {
  'use strict';

  var S = window.APP_CONFIG.STATUS;
  var user = null;
  var masterData = { green: [], occ: [] };
  var registry = null;
  var myRows = [];          // รายงานทั้งหมดของหน่วยงานนี้ (ดึงจากชีตติดตามงาน)
  var provinceStats = null; // สถิติรวมทั้งจังหวัด ไว้เทียบกับของตัวเอง

  var state = {
    gc:  { dataKey: 'green', workType: 'งาน Green & Clean', cats: [], items: [] },
    occ: { dataKey: 'occ',   workType: 'งานอาชีวอนามัยฯ',    cats: [], items: [] }
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return UI.esc(s); };

  /* =========================================================
   *  เริ่มต้น
   * ======================================================= */
  document.addEventListener('DOMContentLoaded', function () {
    user = Auth.require('user');
    if (!user) return;

    renderUserInfo();
    applyHospitalType();
    bindLogout();
    bindDropdowns();
    bindSubmitButtons();

    loadMasterData();
    loadHistory();
    loadRegistry();
    loadDocuments();
    loadProvinceStats();
  });

  function renderUserInfo() {
    var nameEl = $('user-display-name');
    var hospEl = $('user-display-hosp');
    if (nameEl) nameEl.textContent = user.contactName || user.username || user.hospital;
    if (hospEl) {
      hospEl.textContent = user.hospital +
        (user.district ? ' • อ.' + user.district : '') +
        ' • ' + myTypeLabel();
    }
  }

  /** ใส่ประเภทหน่วยงานลงช่องที่ล็อกไว้ทั้ง 2 แท็บ */
  function applyHospitalType() {
    var label = myTypeLabel();
    ['gc', 'occ'].forEach(function (p) {
      var hidden = $(p + '-hospital-type');
      var text = $(p + '-hospital-type-label');
      if (hidden) hidden.value = user.hospitalType || label;
      if (text) text.textContent = label;
    });
  }

  function bindLogout() {
    var btn = $('btn-logout');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); Auth.logout(); });
  }

  /* =========================================================
   *  เกณฑ์ประเมิน — กรองด้วยรหัสประเภทกลาง
   * ======================================================= */

  /** สำเนาของ typeCodes_ ใน Code.gs ไว้ใช้ตอนอยู่โหมดตัวอย่าง/ข้อมูลเก่าไม่มี types */
  function typeCodes(text) {
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

  /**
   * รหัสประเภทของหน่วยงานที่ล็อกอินอยู่
   *
   * ปกติอ่านจากคอลัมน์ "ประเภทหน่วยงาน" ในชีต Login
   * แต่มี 13 แห่งที่คอลัมน์นั้นเป็น "อปท." หรือเว้นว่าง ทั้งที่ชื่อขึ้นต้นว่า
   * "โรงพยาบาลส่งเสริมสุขภาพตำบล..." (คือ รพ.สต. ที่ถ่ายโอนไป อปท.)
   * ถ้าเจอกรณีนี้จะเดาจากชื่อหน่วยงานแทน เพื่อให้ยังเลือกเกณฑ์ รพ.สต. ได้
   */
  function myTypeCode() {
    var code = user.typeCode || typeCodes(user.hospitalType)[0] || '';
    if (!code || code === 'LOC') {
      var byName = typeCodes(user.hospital)[0];
      if (byName) {
        fallbackUsed = (code === 'LOC');
        return byName;
      }
    }
    return code;
  }

  var fallbackUsed = false;

  /** ป้ายประเภทที่แสดงในฟอร์ม */
  function myTypeLabel() {
    var LABEL = { CEN: 'รพ.ศูนย์', GEN: 'รพ.ทั่วไป', COM: 'รพ.ชุมชน',
                  SUB: 'รพ.สต.', OUT: 'รพ.นอก สป.สธ.', LOC: 'อปท.', PHO: 'สสจ.' };
    var code = myTypeCode();
    var base = LABEL[code] || user.typeLabel || user.hospitalType || 'ไม่ระบุประเภท';
    return fallbackUsed ? base + ' (สังกัด อปท.)' : base;
  }

  function loadMasterData() {
    ['gc', 'occ'].forEach(function (p) {
      var el = $(p + '-category-list');
      if (el) el.innerHTML = '<div class="p-3 text-xs text-text-muted">กำลังดึงเกณฑ์ประเมินจากคลาวด์...</div>';
    });

    API.getOrDemo('getMasterData', {}, window.DEMO.masterData)
      .then(function (data) {
        masterData = { green: (data && data.green) || [], occ: (data && data.occ) || [] };
        applyHospitalType();
        ['gc', 'occ'].forEach(function (p) { renderCategories(p); renderSummary(p); });
        renderDashboard();
      })
      .catch(function (err) {
        ['gc', 'occ'].forEach(function (p) {
          var el = $(p + '-category-list');
          if (el) el.innerHTML = '<div class="p-3 text-xs text-red-500">ดึงเกณฑ์ประเมินไม่สำเร็จ: ' + esc(err.message) + '</div>';
        });
      });
  }

  /** เกณฑ์ที่หน่วยงานนี้ใช้ได้ */
  function rowsFor(prefix) {
    var mine = myTypeCode();
    if (!mine) return [];
    return (masterData[state[prefix].dataKey] || []).filter(function (r) {
      var codes = (r.types && r.types.length) ? r.types : typeCodes(r.hospType);
      if (!codes.length) return true;          // เกณฑ์ที่ไม่ระบุประเภท = ใช้ได้ทุกหน่วยงาน
      return codes.indexOf(mine) !== -1;
    });
  }

  /** ข้อความเมื่อไม่มีเกณฑ์สำหรับหน่วยงานนี้ */
  function noCriteriaHTML(prefix) {
    var label = myTypeLabel();
    var work = prefix === 'gc' ? 'Green & Clean' : 'อาชีวอนามัยและเวชกรรมสิ่งแวดล้อม';
    return '<div class="p-4 text-xs text-text-muted leading-relaxed">' +
           '<p class="font-semibold text-text-main mb-1">ยังไม่มีเกณฑ์ ' + esc(work) + ' สำหรับ ' + esc(label) + '</p>' +
           '<p>กรุณาติดต่อกลุ่มงานอนามัยสิ่งแวดล้อมและอาชีวอนามัย สสจ.นครราชสีมา ' +
           'เพื่อเพิ่มเกณฑ์ในชีต Master Data — เมื่อเพิ่มแล้วรายการจะขึ้นเองทันที</p></div>';
  }

  function renderCategories(prefix) {
    var st = state[prefix];
    var list = $(prefix + '-category-list');
    if (!list) return;

    var rows = rowsFor(prefix);
    var cats = rows.map(function (r) { return r.category; })
                   .filter(function (v, i, a) { return v && a.indexOf(v) === i; });

    if (!cats.length) {
      list.innerHTML = noCriteriaHTML(prefix);
      showNoCriteriaBanner(prefix, true);
      renderCatTags(prefix);
      renderItems(prefix);
      renderItemTags(prefix);
      return;
    }
    showNoCriteriaBanner(prefix, false);

    list.innerHTML = cats.map(function (c) {
      var checked = st.cats.indexOf(c) !== -1 ? 'checked' : '';
      return '<label class="flex items-center gap-3 px-3 py-2 hover:bg-primary-light/50 rounded-md cursor-pointer transition-colors">' +
             '<input type="checkbox" value="' + esc(c) + '" ' + checked +
             ' class="cat-cb w-4 h-4 rounded text-primary border-outline-custom focus:ring-primary shrink-0">' +
             '<span class="text-sm text-text-main">' + esc(c) + '</span></label>';
    }).join('');

    Array.prototype.forEach.call(list.querySelectorAll('.cat-cb'), function (cb) {
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (st.cats.indexOf(cb.value) === -1) st.cats.push(cb.value);
        } else {
          st.cats = st.cats.filter(function (c) { return c !== cb.value; });
          var drop = rows.filter(function (r) { return r.category === cb.value; })
                         .map(function (r) { return r.item; });
          st.items = st.items.filter(function (i) { return drop.indexOf(i) === -1; });
        }
        renderCatTags(prefix);
        renderItems(prefix);
        renderItemTags(prefix);
        renderSummary(prefix);
      });
    });

    renderCatTags(prefix);
    renderItems(prefix);
    renderItemTags(prefix);
  }

  /** แถบเตือนบนหัวแท็บเมื่อไม่มีเกณฑ์ */
  function showNoCriteriaBanner(prefix, show) {
    var id = prefix + '-nocriteria';
    var el = $(id);
    if (!show) { if (el) el.remove(); return; }
    if (el) return;

    var group = $(prefix + '-category-group');
    if (!group || !group.parentNode) return;

    var div = document.createElement('div');
    div.id = id;
    div.className = 'md:col-span-2 mb-2 p-4 rounded-lg border border-yellow-status/40 bg-yellow-status/10 flex gap-3 items-start';
    div.innerHTML =
      '<span class="material-symbols-outlined text-yellow-status">info</span>' +
      '<div class="text-sm text-text-main">' +
      '<p class="font-semibold">ยังไม่มีเกณฑ์ประเมินสำหรับ ' + esc(myTypeLabel()) + '</p>' +
      '<p class="text-xs text-text-muted mt-0.5">จึงยังส่งรายงานในหมวดนี้ไม่ได้ กรุณาติดต่อ สสจ.นครราชสีมา</p></div>';
    group.parentNode.insertBefore(div, group);
  }

  function renderItems(prefix) {
    var st = state[prefix];
    var list = $(prefix + '-item-list');
    if (!list) return;

    if (!st.cats.length) {
      list.innerHTML = '<div class="p-3 text-xs text-text-muted">กรุณาเลือกหมวด/องค์ประกอบก่อน</div>';
      return;
    }

    var items = rowsFor(prefix).filter(function (r) { return st.cats.indexOf(r.category) !== -1; });
    if (!items.length) {
      list.innerHTML = '<div class="p-3 text-xs text-text-muted">ไม่พบข้อย่อยในหมวดที่เลือก</div>';
      return;
    }

    list.innerHTML = items.map(function (r) {
      var checked = st.items.indexOf(r.item) !== -1 ? 'checked' : '';
      var code = r.item.split(':')[0].trim();
      var text = r.item.split(':').slice(1).join(':').trim();
      return '<label class="flex items-start gap-3 px-3 py-2 hover:bg-primary-light/50 rounded-md cursor-pointer transition-colors">' +
             '<input type="checkbox" value="' + esc(r.item) + '" ' + checked +
             ' class="item-cb w-4 h-4 mt-0.5 rounded text-primary border-outline-custom focus:ring-primary shrink-0">' +
             '<span class="text-sm text-text-main"><strong>' + esc(code) + '</strong>' +
             (text ? ': ' + esc(text) : '') + '</span></label>';
    }).join('');

    Array.prototype.forEach.call(list.querySelectorAll('.item-cb'), function (cb) {
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (st.items.indexOf(cb.value) === -1) st.items.push(cb.value);
        } else {
          st.items = st.items.filter(function (i) { return i !== cb.value; });
        }
        renderItemTags(prefix);
        renderSummary(prefix);
      });
    });
  }

  function tagHTML(label, cls, value) {
    return '<span class="inline-flex items-center gap-1.5 ' + cls + ' text-xs font-semibold px-2 py-0.5 rounded-md">' +
           '<span>' + esc(label) + '</span>' +
           '<span class="cursor-pointer font-bold hover:opacity-70" data-remove="' + esc(value) + '">×</span></span>';
  }

  function shortLabel(text) {
    var head = String(text).split(':')[0].trim();
    return head.length > 28 ? head.slice(0, 28) + '…' : head;
  }

  function renderCatTags(prefix) {
    var st = state[prefix];
    var box = $(prefix + '-category-tags');
    if (!box) return;

    if (!st.cats.length) {
      box.innerHTML = '<span class="text-xs text-text-muted">เลือกหมวดที่ต้องการแก้ไข...</span>';
      return;
    }
    box.innerHTML = st.cats.map(function (c) {
      return tagHTML(shortLabel(c), 'bg-[#eaf4ff] text-[#0059a4] border border-[#d1e5f4]', c);
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-remove]'), function (x) {
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        var c = x.getAttribute('data-remove');
        st.cats = st.cats.filter(function (v) { return v !== c; });
        var drop = rowsFor(prefix).filter(function (r) { return r.category === c; }).map(function (r) { return r.item; });
        st.items = st.items.filter(function (i) { return drop.indexOf(i) === -1; });
        renderCategories(prefix);
        renderSummary(prefix);
      });
    });
  }

  function renderItemTags(prefix) {
    var st = state[prefix];
    var box = $(prefix + '-item-tags');
    if (!box) return;

    if (!st.items.length) {
      box.innerHTML = '<span class="text-xs text-text-muted">เลือกข้อที่ต้องการแก้ไข...</span>';
      return;
    }
    box.innerHTML = st.items.map(function (i) {
      return tagHTML(shortLabel(i), 'bg-orange-50 text-orange-700 border border-orange-200', i);
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-remove]'), function (x) {
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        var it = x.getAttribute('data-remove');
        st.items = st.items.filter(function (v) { return v !== it; });
        renderItems(prefix);
        renderItemTags(prefix);
        renderSummary(prefix);
      });
    });
  }

  function renderSummary(prefix) {
    var st = state[prefix];
    var el = $(prefix + '-summary');
    if (!el) return;
    if (!st.cats.length && !st.items.length) {
      el.textContent = 'ยังไม่ได้เลือกหมวดและข้อที่ต้องการแก้ไข';
      return;
    }
    el.textContent = [
      user.hospital,
      myTypeLabel(),
      st.cats.map(shortLabel).join(', '),
      '(' + st.items.length + ' ข้อ)'
    ].filter(Boolean).join(' — ');
  }

  /* =========================================================
   *  Dropdown เปิด/ปิด
   * ======================================================= */
  function bindDropdowns() {
    ['gc-category-group', 'gc-item-group', 'occ-category-group', 'occ-item-group'].forEach(function (id) {
      var group = $(id);
      if (!group) return;
      var menu = group.querySelector('.absolute');
      if (!menu) return;
      menu.classList.remove('hidden', 'group-hover:block');
      menu.classList.add('dropdown-menu-custom');

      group.addEventListener('click', function (e) {
        // คลิกติ๊กในเมนู: ห้ามปิดเมนู และไม่ต้อง toggle
        if (e.target.closest('.dropdown-menu-custom')) { e.stopPropagation(); return; }
        e.stopPropagation();
        document.querySelectorAll('.dropdown-menu-custom').forEach(function (m) {
          if (m !== menu) m.classList.remove('menu-open');
        });
        menu.classList.toggle('menu-open');
      });
    });

    document.addEventListener('click', function () {
      document.querySelectorAll('.dropdown-menu-custom').forEach(function (m) { m.classList.remove('menu-open'); });
    });
  }

  /* =========================================================
   *  แนบไฟล์หลักฐาน PDF
   *  เก็บไฟล์ไว้ในหน่วยความจำก่อน แล้วค่อยแปลงเป็น base64 ตอนกดส่ง
   *  (Apps Script รับได้แต่ JSON จึงส่งไฟล์แนบไปกับ payload เป็น base64)
   * ======================================================= */
  var MAX_FILE_MB  = 15;   /* ต่อไฟล์ (ต้องตรงกับ MAX_UPLOAD_MB ใน Code.gs) */
  var MAX_TOTAL_MB = 25;   /* รวมทุกไฟล์ในหนึ่งรายงาน
                            * base64 ทำให้ข้อมูลบวมขึ้นราว 1.34 เท่า
                            * 25 MB จึงกลายเป็น ~34 MB ตอนส่ง ยังไม่เกินลิมิต
                            * ของ Apps Script ที่รับ POST ได้ 50 MB */

  var picked = { gc: [], occ: [] };

  function fmtSize(bytes) {
    return bytes < 1024 * 1024
      ? (bytes / 1024).toFixed(0) + ' KB'
      : (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function totalBytes(prefix) {
    return picked[prefix].reduce(function (sum, f) { return sum + f.size; }, 0);
  }

  /** รับไฟล์ที่เลือกหรือลากมาวาง คัดเฉพาะ PDF และกันไฟล์ใหญ่เกิน */
  function addFiles(prefix, fileList) {
    var rejected = [];
    Array.prototype.slice.call(fileList).forEach(function (f) {
      if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) {
        rejected.push(f.name + ' (ไม่ใช่ PDF)'); return;
      }
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        rejected.push(f.name + ' (เกิน ' + MAX_FILE_MB + ' MB)'); return;
      }
      var dup = picked[prefix].some(function (g) { return g.name === f.name && g.size === f.size; });
      if (dup) { rejected.push(f.name + ' (แนบไว้แล้ว)'); return; }
      if (totalBytes(prefix) + f.size > MAX_TOTAL_MB * 1024 * 1024) {
        rejected.push(f.name + ' (รวมแล้วเกิน ' + MAX_TOTAL_MB + ' MB)'); return;
      }
      picked[prefix].push(f);
    });
    renderFileList(prefix);
    if (rejected.length) UI.toast('warning', 'มีไฟล์ที่แนบไม่ได้', rejected.join(', '));
  }

  function renderFileList(prefix) {
    var box = $(prefix + '-filelist');
    if (!box) return;
    box.innerHTML = picked[prefix].map(function (f, i) {
      return '<li class="flex items-center gap-2 text-xs bg-primary-light/40 border border-outline-custom rounded-md px-2.5 py-1.5">' +
        '<span class="material-symbols-outlined text-[16px] text-primary flex-shrink-0">picture_as_pdf</span>' +
        '<span class="flex-1 truncate text-text-main" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
        '<span class="text-text-muted flex-shrink-0">' + fmtSize(f.size) + '</span>' +
        '<button type="button" data-rm="' + i + '" aria-label="เอาไฟล์ออก" ' +
          'class="material-symbols-outlined text-[16px] text-text-muted hover:text-red-500 flex-shrink-0">close</button>' +
      '</li>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-rm]'), function (b) {
      b.addEventListener('click', function () {
        picked[prefix].splice(Number(b.getAttribute('data-rm')), 1);
        renderFileList(prefix);
      });
    });
  }

  function setupUpload(prefix) {
    var zone  = $(prefix + '-dropzone');
    var input = $(prefix + '-file');
    if (!zone || !input) return;

    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    /* กันคลิกที่ input วิ่งขึ้นไปหา zone แล้วเปิดหน้าต่างเลือกไฟล์ซ้อนสองรอบ */
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('change', function () {
      addFiles(prefix, input.files);
      input.value = '';   /* ล้างค่า เพื่อให้เลือกไฟล์ชื่อเดิมซ้ำได้ */
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        zone.classList.add('border-primary', 'bg-primary-light/50');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        zone.classList.remove('border-primary', 'bg-primary-light/50');
      });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(prefix, e.dataTransfer.files);
    });
  }

  /** อ่านไฟล์ที่แนบไว้ทั้งหมดเป็น base64 เพื่อส่งขึ้น Apps Script */
  function readFiles(prefix) {
    return Promise.all(picked[prefix].map(function (f) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload  = function () {
          resolve({
            name: f.name,
            mimeType: f.type || 'application/pdf',
            data: String(r.result).split(',')[1]   /* ตัดหัว data:...;base64, ทิ้ง */
          });
        };
        r.onerror = function () { reject(new Error('อ่านไฟล์ ' + f.name + ' ไม่สำเร็จ')); };
        r.readAsDataURL(f);
      });
    }));
  }

  /* =========================================================
   *  ส่งรายงาน
   * ======================================================= */
  function bindSubmitButtons() {
    ['gc', 'occ'].forEach(function (p) {
      setupUpload(p);
      var btn = $(p + '-submit');
      if (btn) btn.addEventListener('click', function () { submit(p); });
      var reset = $(p + '-reset');
      if (reset) reset.addEventListener('click', function () { resetForm(p); });
    });
  }

  function val(id) { var el = $(id); return el ? String(el.value || '').trim() : ''; }

  function submit(prefix) {
    var st = state[prefix];
    var levelInput = document.querySelector('input[name="assessment_level_' + prefix + '"]:checked');
    var levelText = '';
    if (levelInput) {
      var span = levelInput.parentNode.querySelector('span');
      levelText = span ? span.textContent.trim() : levelInput.value;
    }

    var payload = {
      action: 'submitReport',
      workType: st.workType,
      hospital: user.hospital,
      hospitalCode: user.hospitalCode || '',
      district: user.district || '',
      hospType: user.hospitalType || val(prefix + '-hospital-type'),
      year: val(prefix + '-year'),
      senderName: val(prefix + '-sender') || user.contactName || '',
      phone: val(prefix + '-phone'),
      detail: val(prefix + '-detail'),
      driveLink: val(prefix + '-drive'),
      level: levelText,
      categories: st.cats,
      items: st.items
    };

    var missing = [];
    if (!payload.year) missing.push('ปีที่ประเมิน');
    if (!levelText) missing.push('ระดับที่ส่งประเมิน');
    if (!st.cats.length) missing.push('หมวดที่แก้ไข');
    if (!st.items.length) missing.push('ข้อที่แก้ไข');
    if (!payload.detail) missing.push('รายละเอียดการปรับปรุงแก้ไข');
    if (!payload.driveLink && !picked[prefix].length) missing.push('ไฟล์หลักฐาน PDF หรือลิงก์ Google Drive');

    if (missing.length) {
      UI.toast('warning', 'กรอกข้อมูลไม่ครบ', 'กรุณากรอก: ' + missing.join(', '));
      return;
    }

    var nFiles = picked[prefix].length;
    UI.loading(nFiles
      ? 'กำลังอัปโหลดไฟล์ ' + nFiles + ' ไฟล์ และบันทึกข้อมูล...'
      : 'กำลังบันทึกข้อมูลลง Google Sheet...');

    readFiles(prefix)
      .then(function (files) {
        payload.files = files;
        return API.post(payload);
      })
      .then(function (res) {
        UI.close();
        if (res.status !== 'success') {
          UI.toast('error', 'บันทึกไม่สำเร็จ', res.message || 'ไม่ทราบสาเหตุ');
          return;
        }
        Swal.fire({
          icon: 'success',
          title: 'ส่งรายงานเรียบร้อย',
          html: 'บันทึกลงชีต <b>' + esc(res.sheet || '') + '</b> แถวที่ ' + esc(res.row || '') +
                (res.uploaded ? '<br>อัปโหลดไฟล์ขึ้น Google Drive แล้ว <b>' + esc(res.uploaded) + '</b> ไฟล์' : '') +
                '<br>สถานะปัจจุบัน: <b>' + S.PENDING + '</b>',
          confirmButtonColor: '#0072CE'
        });
        resetForm(prefix);
        loadHistory();
      })
      .catch(function (err) {
        UI.close();
        UI.toast('error', 'เกิดข้อผิดพลาด',
          'ส่งข้อมูลไม่สำเร็จ: ' + err.message + ' (ตรวจว่า Deploy Apps Script เป็น Anyone แล้วหรือยัง)');
      });
  }

  function resetForm(prefix) {
    state[prefix].cats = [];
    state[prefix].items = [];
    picked[prefix] = [];
    renderFileList(prefix);
    ['-year', '-sender', '-phone', '-drive', '-detail'].forEach(function (suffix) {
      var el = $(prefix + suffix);
      if (el) el.value = '';
    });
    var checked = document.querySelector('input[name="assessment_level_' + prefix + '"]:checked');
    if (checked) checked.checked = false;
    renderCategories(prefix);
    renderSummary(prefix);
    prefillYear();
  }

  /* =========================================================
   *  ทะเบียนผลการประเมินล่าสุด (ชีต "ทะเบียนรายชื่อโรงพยาบาล")
   * ======================================================= */
  function loadRegistry() {
    API.get('getRegistry', { hospital: user.hospital })
      .then(function (res) {
        registry = (res && res.data && res.data[0]) || null;
        prefillYear();
        renderRegistryCard();
        renderDashboard();
      })
      .catch(function () { /* ไม่มีทะเบียนก็ข้ามไป ไม่กระทบการใช้งาน */ });
  }

  /** เติมปีที่ประเมินให้อัตโนมัติจากทะเบียน (ผู้ใช้แก้เองได้) */
  function prefillYear() {
    if (!registry) return;
    var y = { gc: registry.green && registry.green.year, occ: registry.occ && registry.occ.year };
    ['gc', 'occ'].forEach(function (p) {
      var el = $(p + '-year');
      if (el && !el.value && y[p]) el.value = y[p];
    });
  }

  function renderRegistryCard() {
    if (!registry) return;
    ['gc', 'occ'].forEach(function (p) {
      var info = p === 'gc' ? registry.green : registry.occ;
      if (!info || (!info.year && !info.level && !info.status)) return;

      var host = $(p + '-summary');
      if (!host) return;
      // ต้องแทรกใน <div> ครอบนอก ไม่ใช่ใน <p> (เบราว์เซอร์จะปิด <p> เอง)
      var parent = host.closest('div');
      if (!parent || parent.querySelector('.registry-card')) return;
      var card = document.createElement('div');
      card.className = 'registry-card mt-3 text-xs text-text-muted border-t border-outline-custom pt-3';
      card.innerHTML =
        '<span class="font-semibold text-text-main">ผลการรับรองล่าสุดจากทะเบียน สสจ.:</span> ' +
        'ปีที่ประเมิน ' + esc(info.year || '-') +
        ' • ระดับ ' + esc(info.level || '-') +
        ' • สถานะ ' + esc(info.status || '-') +
        (info.expire ? ' • หมดอายุปี ' + esc(info.expire) : '');
      parent.appendChild(card);
    });
  }

  /* =========================================================
   *  คลังคู่มือ/เอกสาร (ดึงจากชีต ถ้าดึงไม่ได้จะคงการ์ดเดิมไว้)
   * ======================================================= */
  function loadDocuments() {
    var box = $('doc-list');
    if (!box) return;

    API.get('getDocuments')
      .then(function (res) {
        var docs = (res && res.data) || [];
        // เอาเฉพาะเอกสารที่เกี่ยวกับโรงพยาบาล
        docs = docs.filter(function (d) {
          var t = String(d.target || '');
          return !t || /Hospital|ทั้งหมด|All/i.test(t);
        });
        if (!docs.length) return;

        box.innerHTML = docs.map(function (d) {
          return '<div class="bg-surface rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow border border-outline-custom flex flex-col h-full">' +
            '<div class="w-14 h-14 rounded-lg bg-primary-light flex items-center justify-center mb-4 text-primary mx-auto">' +
              '<span class="material-symbols-outlined text-3xl">description</span></div>' +
            '<p class="text-[11px] text-text-muted text-center mb-1">' + esc(d.workType || 'เอกสาร') + '</p>' +
            '<h3 class="text-base font-headline font-semibold text-text-main mb-4 flex-grow text-center">' + esc(d.title) + '</h3>' +
            '<a href="' + esc(d.url) + '" target="_blank" rel="noopener" ' +
              'class="mt-auto w-full py-2.5 px-4 rounded-lg bg-primary-light text-primary font-semibold flex items-center justify-center gap-2 hover:bg-primary hover:text-white transition-colors">' +
              '<span class="material-symbols-outlined text-sm">download</span>เปิดเอกสาร</a>' +
          '</div>';
        }).join('');
      })
      .catch(function () { /* ใช้การ์ดเดิมในหน้า */ });
  }

  /* =========================================================
   *  ประวัติการส่ง + แถบสถานะ
   * ======================================================= */
  function loadHistory() {
    API.getOrDemo('getSubmissions', { hospital: user.hospital }, window.DEMO.submissions)
      .then(function (res) {
        var all = (res && res.data) || [];
        var mine = all.filter(function (r) { return r.hospital === user.hospital; });
        if (API.demoMode && !mine.length) mine = all;
        myRows = mine;

        ['gc', 'occ'].forEach(function (p) {
          var rows = mine.filter(function (r) {
            var isGreen = String(r.workType).indexOf('Green') !== -1;
            return p === 'gc' ? isGreen : !isGreen;
          });
          renderHistory(p, rows);
          renderStepper(p, rows[0]);
          renderAlert(p, rows[0]);
        });
        renderDashboard();
      })
      .catch(function (err) { console.warn('โหลดประวัติไม่สำเร็จ:', err.message); });
  }

  function renderHistory(prefix, rows) {
    var body = $(prefix + '-history-body');
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="py-8 px-6 text-center text-text-muted text-sm">ยังไม่มีประวัติการส่งรายงาน</td></tr>';
      return;
    }

    body.innerHTML = rows.map(function (r) {
      return '<tr class="hover:bg-primary-light/30 transition-colors align-top">' +
        '<td class="py-4 px-6 font-medium text-text-main whitespace-nowrap">' + UI.thaiDate(r.submittedAt) + '</td>' +
        '<td class="py-4 px-6 text-text-main">' + esc(r.hospType) + '</td>' +
        '<td class="py-4 px-6 text-text-main">' + esc(r.categories) +
          '<div class="text-xs text-text-muted mt-1">' + esc(r.items) + '</div></td>' +
        '<td class="py-4 px-6">' + UI.statusBadge(r.status) + '</td>' +
        '<td class="py-4 px-6 text-right whitespace-nowrap">' +
          (r.driveLink
            ? '<a href="' + esc(r.driveLink) + '" target="_blank" rel="noopener" class="text-primary hover:underline font-semibold">เปิดหลักฐาน</a>'
            : '<span class="text-text-muted text-xs">-</span>') +
        '</td></tr>';
    }).join('');
  }

  var STEPS = [
    { label: 'ยังไม่ส่งข้อมูลแก้ไข', icon: 'edit_note' },
    { label: 'รอการตรวจสอบ',        icon: 'hourglass_empty' },
    { label: 'ต้องแก้ไขเพิ่มเติม',     icon: 'warning' },
    { label: 'ดำเนินการตรวจสอบ',     icon: 'fact_check' },
    { label: 'รับรองผลการประเมิน',    icon: 'workspace_premium',
      sub: '[มาตรฐาน / ดีเยี่ยม / ท้าทาย]' }
  ];

  function stepIndex(status) {
    if (!status) return 0;
    if (status === S.PENDING)  return 1;
    if (status === S.REVISE)   return 2;
    if (status === S.CHECKING) return 3;
    if (status === S.APPROVED) return 4;
    return 1;
  }

  function renderStepper(prefix, latest) {
    var box = $(prefix + '-stepper');
    if (!box) return;

    var active = stepIndex(latest && latest.status);
    var isRevise = latest && latest.status === S.REVISE;

    var lines = STEPS.slice(1).map(function (_, i) {
      return '<div class="flex-1 ' + (i < active ? (isRevise ? 'bg-yellow-status' : 'bg-primary') : 'bg-outline-custom') + '"></div>';
    }).join('');

    var nodes = STEPS.map(function (s, i) {
      var done = i < active, cur = i === active;
      var color = cur
        ? (isRevise ? 'bg-red-500 text-white ring-2 ring-red-500/20' : 'bg-primary text-white ring-2 ring-primary/20')
        : (done ? 'bg-tertiary text-white' : 'bg-outline-custom text-text-muted');
      var textColor = cur ? (isRevise ? 'text-red-500 font-bold' : 'text-primary font-bold')
                          : (done ? 'text-text-main font-semibold' : 'text-text-muted font-semibold');
      return '<div class="relative z-10 flex flex-col items-center flex-1">' +
             '<div class="w-10 h-10 rounded-full flex items-center justify-center font-bold border-4 border-surface shadow-sm ' + color + '">' +
             '<span class="material-symbols-outlined text-sm">' + s.icon + '</span></div>' +
             '<p class="text-xs text-center leading-tight whitespace-nowrap mt-4 ' + textColor + '">' + s.label +
               (s.sub ? '<br><span class="text-[10px] font-normal">' + s.sub + '</span>' : '') +
             '</p></div>';
    }).join('');

    box.innerHTML =
      '<div class="absolute top-[36px] left-[10%] right-[10%] z-0 flex h-[2px] -translate-y-1/2">' + lines + '</div>' + nodes;
  }

  function renderAlert(prefix, latest) {
    var box = $(prefix + '-alert');
    if (!box) return;

    if (!latest) { box.className = 'hidden'; box.innerHTML = ''; return; }

    if (latest.status === S.REVISE) {
      box.className = 'mt-8 mb-8 p-6 rounded-2xl border border-red-500/30 bg-red-500/5 flex flex-col gap-2';
      box.innerHTML =
        '<div class="flex items-center gap-2 text-red-600">' +
        '<span class="material-symbols-outlined">warning</span>' +
        '<h3 class="font-bold text-lg font-headline">รายงานของท่านถูกส่งกลับให้แก้ไขเพิ่มเติม</h3></div>' +
        '<p class="text-text-main text-sm whitespace-pre-line"><span class="font-semibold">ข้อแนะนำจาก สสจ.:</span> ' +
        esc(latest.comment || 'กรุณาติดต่อเจ้าหน้าที่ผู้ตรวจ') + '</p>';
      return;
    }

    if (latest.status === S.APPROVED) {
      box.className = 'mt-8 mb-8 p-6 rounded-2xl border border-green-500/30 bg-green-500/5 flex flex-col gap-2';
      box.innerHTML =
        '<div class="flex items-center gap-2 text-green-700">' +
        '<span class="material-symbols-outlined">workspace_premium</span>' +
        '<h3 class="font-bold text-lg font-headline">รับรองผลการประเมินเรียบร้อยแล้ว</h3></div>' +
        '<p class="text-text-main text-sm whitespace-pre-line">' + esc(latest.comment || 'เอกสารครบถ้วน') + '</p>';
      return;
    }

    box.className = 'mt-8 mb-8 p-6 rounded-2xl border border-yellow-status/30 bg-yellow-status/10 flex flex-col gap-2';
    box.innerHTML =
      '<div class="flex items-center gap-2 text-yellow-status">' +
      '<span class="material-symbols-outlined">hourglass_empty</span>' +
      '<h3 class="font-bold text-lg font-headline">รายงานล่าสุดอยู่ระหว่างการตรวจสอบ</h3></div>' +
      '<p class="text-text-main text-sm">ส่งเมื่อ ' + UI.thaiDate(latest.submittedAt) + ' • สถานะ: ' + esc(latest.status) + '</p>';
  }

  /* =========================================================
   *  ค่าเฉลี่ยทั้งจังหวัด (ไว้เทียบกับผลงานของหน่วยงานตัวเอง)
   * ======================================================= */
  function loadProvinceStats() {
    API.get('getStats', {})
      .then(function (res) {
        if (res && res.status === 'success') provinceStats = res;
        renderDashboard();
      })
      .catch(function () {
        // ต่อ API ไม่ได้ → คำนวณจากข้อมูลตัวอย่างแทน เพื่อให้หน้ายังใช้ดูได้
        var demo = (window.DEMO && window.DEMO.submissions && window.DEMO.submissions.data) || [];
        if (!demo.length) return;
        var st = Stats.status(demo);
        provinceStats = { total: st.total, approved: st.approved, pending: st.pending,
                          checking: st.checking, revise: st.revise };
        renderDashboard();
      });
  }

  /* =========================================================
   *  แดชบอร์ด "ภาพรวมของฉัน" — คำนวณสดจากรายงานของหน่วยงานนี้เท่านั้น
   * ======================================================= */
  var WORK = {
    gc:  { title: 'งาน Green & Clean Hospital', icon: 'eco', color: '#76BC21', tab: 'tab-green-clean' },
    occ: { title: 'งานอาชีวอนามัยและเวชกรรมสิ่งแวดล้อม', icon: 'health_and_safety', color: '#0072CE', tab: 'tab-occupational' }
  };

  function rowsOf(prefix) {
    return myRows.filter(function (r) {
      var isGreen = String(r.workType).indexOf('Green') !== -1;
      return prefix === 'gc' ? isGreen : !isGreen;
    });
  }

  /** ข้อทั้งหมดตามเกณฑ์ของประเภทหน่วยงานนี้ (ไม่ซ้ำ) */
  function criteriaItems(prefix) {
    var seen = {};
    rowsFor(prefix).forEach(function (r) { if (r.item) seen[r.item] = 1; });
    return Object.keys(seen);
  }

  /** ข้อที่หน่วยงานนี้ส่งแก้ไขไปแล้ว (ไม่ซ้ำ) */
  function submittedItems(prefix) {
    var seen = {};
    rowsOf(prefix).forEach(function (r) {
      Stats.lines(r.items).forEach(function (i) { seen[i] = 1; });
    });
    return Object.keys(seen);
  }

  function statusColors() { return Viz.STATUS_COLORS(); }

  function renderDashboard() {
    if (!$('hd-kpi') || !window.Stats) return;

    var st = Stats.status(myRows);

    $('hd-subtitle').textContent =
      user.hospital + (user.district ? ' • อ.' + user.district : '') + ' • ' + myTypeLabel() +
      ' — คำนวณจากรายงาน ' + st.total + ' ฉบับที่บันทึกไว้ในระบบ';

    /* --- การ์ด KPI --- */
    var latest = myRows[0];
    $('hd-kpi').innerHTML = [
      Viz.kpi({ label: 'ส่งรายงานแล้ว', icon: 'send', color: '#0A2540',
                value: st.total, sub: latest ? 'ล่าสุด ' + UI.thaiDate(latest.submittedAt) : 'ยังไม่เคยส่งรายงาน' }),
      Viz.kpi({ label: 'รอตรวจสอบ', icon: 'hourglass_empty', color: '#EAB308',
                value: st.pending + st.checking, sub: 'รอตรวจ ' + st.pending + ' • ตรวจแล้ว ' + st.checking }),
      Viz.kpi({ label: 'ต้องแก้ไขเพิ่มเติม', icon: 'warning', color: '#EF4444',
                value: st.revise, sub: st.revise ? 'ดูข้อเสนอแนะด้านล่าง' : 'ไม่มีรายการค้างแก้ไข' }),
      Viz.kpi({ label: 'รับรองผลแล้ว', icon: 'workspace_premium', color: '#16A34A',
                value: st.approved, sub: 'คิดเป็น ' + st.approvedPct.toFixed(1) + '% ของรายงานทั้งหมด',
                bar: st.approvedPct, target: 100 })
    ].join('');

    renderWorkTypeCards();
    renderTodo();

    $('hd-cat').innerHTML = Viz.hbars(Stats.freqMulti(myRows, 'categories', 5), {
      unit: 'ครั้ง', maxLen: 52, emptyText: 'ยังไม่เคยส่งรายงานแก้ไข'
    });

    var stItems = [
      { label: S.PENDING,  count: st.pending },
      { label: S.CHECKING, count: st.checking },
      { label: S.REVISE,   count: st.revise },
      { label: S.APPROVED, count: st.approved }
    ].map(function (x) { x.pct = st.total ? x.count * 100 / st.total : 0; return x; });

    $('hd-status').innerHTML = Viz.donut(stItems.filter(function (x) { return x.count > 0; }), {
      colors: statusColors(), centerLabel: 'รายงาน', emptyText: 'ยังไม่มีรายงานในระบบ'
    });

    renderCompare(st);
    renderRegistryPanel();

    $('hd-month').innerHTML = Viz.vbars(Stats.byMonth(myRows, 12), {
      unit: 'ฉบับ', maxLen: 10, barWidth: 38
    });
  }

  /** การ์ดความครอบคลุมของแต่ละงาน เทียบกับจำนวนข้อตามเกณฑ์ของประเภทหน่วยงาน */
  function renderWorkTypeCards() {
    $('hd-worktype').innerHTML = ['gc', 'occ'].map(function (p) {
      var w = WORK[p];
      var rows = rowsOf(p);
      var st = Stats.status(rows);
      var criteria = criteriaItems(p);
      var total = criteria.length;
      var done = submittedItems(p).filter(function (i) {
        return criteria.indexOf(i) !== -1;
      }).length;
      var pct = total ? done * 100 / total : 0;

      var body = total
        ? '<p class="text-sm text-text-main mb-2">ส่งแก้ไขแล้ว <span class="font-bold text-2xl" style="color:' + w.color + '">' +
            done + '</span> จาก ' + total + ' ข้อตามเกณฑ์ ' + esc(myTypeLabel()) + '</p>' +
          Viz.progress(pct, { color: w.color, target: 100 })
        : '<p class="text-sm text-text-muted">ยังไม่มีเกณฑ์ของประเภท ' + esc(myTypeLabel()) +
            ' ในชีต Master Data — กรุณาติดต่อ สสจ.</p>';

      return '<div class="bg-white border border-outline-custom rounded-2xl p-6 shadow-sm">' +
        '<div class="flex items-center gap-2 mb-3">' +
          '<span class="material-symbols-outlined" style="color:' + w.color + '">' + w.icon + '</span>' +
          '<h3 class="font-bold text-tertiary font-headline text-base">' + esc(w.title) + '</h3></div>' +
        body +
        '<div class="grid grid-cols-4 gap-2 mt-4 text-center">' +
          statBox('ส่งแล้ว', st.total, '#0A2540') +
          statBox('รอตรวจ', st.pending + st.checking, '#EAB308') +
          statBox('ต้องแก้ไข', st.revise, '#EF4444') +
          statBox('รับรองแล้ว', st.approved, '#16A34A') +
        '</div>' +
        '<button type="button" class="mt-4 w-full py-2 rounded-lg text-sm font-semibold text-white" ' +
          'style="background:' + w.color + '" onclick="switchTab(null, \'' + w.tab + '\')">' +
          'ไปที่แบบฟอร์มส่งรายงาน</button>' +
      '</div>';
    }).join('');
  }

  function statBox(label, value, color) {
    return '<div class="rounded-lg bg-slate-50 py-2">' +
      '<p class="text-lg font-bold" style="color:' + color + '">' + value + '</p>' +
      '<p class="text-[11px] text-text-muted">' + esc(label) + '</p></div>';
  }

  /** รายการที่ต้องทำต่อ: ถูกตีกลับก่อน แล้วค่อยรายการที่ยังรอตรวจ */
  function renderTodo() {
    var box = $('hd-todo');
    if (!box) return;

    var revise = myRows.filter(function (r) { return r.status === S.REVISE; });
    var waiting = myRows.filter(function (r) { return r.status === S.PENDING || r.status === S.CHECKING; });
    var list = revise.concat(waiting).slice(0, 6);

    if (!list.length) {
      box.innerHTML = '<div class="bg-green-500/5 border border-green-500/30 rounded-2xl p-6 text-sm text-green-700 flex items-center gap-2">' +
        '<span class="material-symbols-outlined">task_alt</span>' +
        'ไม่มีรายการค้างดำเนินการ — รายงานทุกฉบับผ่านการรับรองแล้ว</div>';
      return;
    }

    box.innerHTML = '<div class="space-y-3">' + list.map(function (r) {
      var isRevise = r.status === S.REVISE;
      var cls = isRevise ? 'border-red-500/30 bg-red-500/5' : 'border-yellow-status/30 bg-yellow-status/5';
      return '<div class="border rounded-2xl p-5 ' + cls + '">' +
        '<div class="flex flex-wrap items-center justify-between gap-2 mb-2">' +
          '<span class="text-sm font-semibold text-text-main">' + esc(r.workType) + ' • ส่งเมื่อ ' + UI.thaiDate(r.submittedAt) + '</span>' +
          UI.statusBadge(r.status) +
        '</div>' +
        '<p class="text-sm text-text-main">' + esc(Stats.short(r.categories, 90)) + '</p>' +
        '<p class="text-xs text-text-muted mt-0.5">' + esc(Stats.short(r.items, 120)) + '</p>' +
        (isRevise && r.comment
          ? '<p class="text-sm mt-3 whitespace-pre-line text-red-700"><span class="font-semibold">ข้อเสนอแนะจาก สสจ.:</span> ' +
              esc(r.comment) + '</p>'
          : '') +
      '</div>';
    }).join('') + '</div>';
  }

  /** เทียบอัตราการรับรองของหน่วยงานกับทั้งจังหวัด */
  function renderCompare(st) {
    var box = $('hd-compare');
    if (!box) return;

    if (!provinceStats || !provinceStats.total) {
      box.innerHTML = '<span class="text-text-muted">ยังไม่มีข้อมูลภาพรวมจังหวัดให้เทียบ</span>';
      return;
    }

    var provPct = provinceStats.approved * 100 / provinceStats.total;
    var diff = st.approvedPct - provPct;
    var bar = function (label, pct, color) {
      return '<div class="mb-3"><div class="flex justify-between text-xs mb-1">' +
        '<span>' + esc(label) + '</span><span class="font-semibold">' + pct.toFixed(1) + '%</span></div>' +
        Viz.progress(pct, { color: color }) + '</div>';
    };

    box.innerHTML =
      bar('อัตราการรับรองของหน่วยงานท่าน', st.approvedPct, '#76BC21') +
      bar('ค่าเฉลี่ยทั้งจังหวัด (' + provinceStats.total + ' รายการ)', provPct, '#94A3B8') +
      '<p class="text-xs ' + (diff >= 0 ? 'text-green-700' : 'text-red-600') + '">' +
        (diff >= 0 ? '▲ สูงกว่า' : '▼ ต่ำกว่า') + 'ค่าเฉลี่ยจังหวัด ' + Math.abs(diff).toFixed(1) + ' จุด</p>';
  }

  /** การ์ดผลการรับรองล่าสุดจากชีตทะเบียน */
  function renderRegistryPanel() {
    var box = $('hd-registry');
    if (!box) return;

    if (!registry) {
      box.innerHTML = '<div class="bg-white border border-outline-custom rounded-2xl p-6 shadow-sm text-sm text-text-muted md:col-span-2">' +
        'ยังไม่พบชื่อหน่วยงานนี้ในชีต “ทะเบียนรายชื่อโรงพยาบาล”</div>';
      return;
    }

    box.innerHTML = ['gc', 'occ'].map(function (p) {
      var w = WORK[p];
      var info = p === 'gc' ? registry.green : registry.occ;
      var line = function (label, value) {
        return '<div class="flex justify-between py-1.5 border-b border-outline-custom last:border-0">' +
          '<span class="text-text-muted">' + esc(label) + '</span>' +
          '<span class="font-semibold text-text-main">' + esc(value || '-') + '</span></div>';
      };
      var has = info && (info.year || info.level || info.status);
      return '<div class="bg-white border border-outline-custom rounded-2xl p-6 shadow-sm">' +
        '<div class="flex items-center gap-2 mb-3">' +
          '<span class="material-symbols-outlined" style="color:' + w.color + '">' + w.icon + '</span>' +
          '<h3 class="font-bold text-tertiary font-headline text-base">' + esc(w.title) + '</h3></div>' +
        (has
          ? '<div class="text-sm">' + line('ปีที่ประเมิน', info.year) + line('ระดับผลการประเมิน', info.level) +
              line('สถานะการรับรอง', info.status) + line('หมดอายุปี', info.expire) + '</div>'
          : '<p class="text-sm text-text-muted">ยังไม่มีผลการรับรองบันทึกไว้ในทะเบียน</p>') +
      '</div>';
    }).join('');
  }

  /* =========================================================
   *  สลับแท็บ (เรียกจาก onclick ใน HTML)
   * ======================================================= */
  window.switchTab = function (evt, tabName) {
    if (evt) evt.preventDefault();
    Array.prototype.forEach.call(document.getElementsByClassName('tab-content'), function (el) {
      el.classList.add('hidden');
    });
    Array.prototype.forEach.call(document.getElementsByClassName('tab-link'), function (el) {
      el.classList.remove('bg-white/20', 'font-bold', 'border-l-4', 'border-secondary');
      el.classList.add('hover:bg-white/10');
    });
    var target = $(tabName);
    if (target) target.classList.remove('hidden');

    // เรียกจากปุ่มในหน้าแดชบอร์ด (ไม่มี event) ก็ให้เมนูซ้ายไฮไลต์ถูกแท็บด้วย
    var link = (evt && evt.currentTarget) ||
               document.querySelector('.tab-link[data-target="' + tabName + '"]');
    if (link) {
      link.classList.add('bg-white/20', 'font-bold', 'border-l-4', 'border-secondary');
      link.classList.remove('hover:bg-white/10');
    }
    if (!evt) window.scrollTo(0, 0);
  };
})();
