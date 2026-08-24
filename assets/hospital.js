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

  var CFG = window.APP_CONFIG;
  var S = CFG.STATUS;
  var user = null;
  var masterData = { green: [], occ: [] };
  var registry = null;
  var myRows = [];          // รายงานทั้งหมดของหน่วยงานนี้ (ดึงจากชีตติดตามงาน)

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
  /**
   * อ่านไฟล์ที่แนบไว้ทั้งหมดเป็น base64 เพื่อส่งขึ้น Apps Script
   * อ่านทีละไฟล์ (ไม่พร้อมกัน) เพื่อรายงานความคืบหน้าได้จริง และไม่กินหน่วยความจำพรวดเดียว
   */
  function readFiles(prefix, onProgress) {
    var list = picked[prefix];

    return list.reduce(function (chain, f, i) {
      return chain.then(function (acc) {
        if (onProgress) onProgress(i + 1, list.length, f.name);
        return new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onload  = function () {
            acc.push({
              name: f.name,
              mimeType: f.type || 'application/pdf',
              data: String(r.result).split(',')[1]   /* ตัดหัว data:...;base64, ทิ้ง */
            });
            resolve(acc);
          };
          r.onerror = function () { reject(new Error('อ่านไฟล์ "' + f.name + '" ไม่สำเร็จ')); };
          r.readAsDataURL(f);
        });
      });
    }, Promise.resolve([]));
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
    var totalMB = (totalBytes(prefix) / 1024 / 1024).toFixed(1);

    UI.loading(nFiles ? 'กำลังเตรียมไฟล์...' : 'กำลังบันทึกข้อมูล...',
               nFiles ? 'แนบ ' + nFiles + ' ไฟล์ รวม ' + totalMB + ' MB' : '');

    readFiles(prefix, function (done, total, name) {
      UI.loadingText('กำลังเตรียมไฟล์ ' + done + '/' + total, name);
    })
      .then(function (files) {
        payload.files = files;
        UI.loadingText(
          nFiles ? 'กำลังอัปโหลดขึ้น Google Drive...' : 'กำลังบันทึกลง Google Sheet...',
          nFiles ? 'ไฟล์ใหญ่อาจใช้เวลาสักครู่ กรุณาอย่าปิดหน้านี้' : '');
        /* แนบไฟล์ใช้เวลานานกว่าปกติ จึงยืดเวลารอให้ยาวขึ้น */
        return API.post(payload, { timeout: nFiles ? CFG.UPLOAD_TIMEOUT_MS : CFG.TIMEOUT_MS });
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
        if (err && err.authError) return;   /* ระบบเด้งไปหน้าล็อกอินให้แล้ว */

        var msg = String((err && err.message) || err);
        var hint;
        if (msg.indexOf('ไม่ตอบกลับภายใน') !== -1) {
          hint = nFiles
            ? 'ไฟล์อาจใหญ่เกินไปหรือเน็ตช้า ลองลดจำนวนไฟล์ หรือใช้วิธีวางลิงก์ Google Drive แทน'
            : 'เซิร์ฟเวอร์ตอบช้าผิดปกติ ลองกดส่งใหม่อีกครั้ง';
        } else if (msg.indexOf('อ่านไฟล์') !== -1) {
          hint = 'ลองเอาไฟล์นั้นออกแล้วแนบใหม่';
        } else {
          hint = 'ตรวจว่า Deploy Apps Script เป็น Anyone และอนุญาตสิทธิ์ Google Drive แล้วหรือยัง';
        }

        Swal.fire({
          icon: 'error',
          title: 'ส่งรายงานไม่สำเร็จ',
          html: '<p style="margin-bottom:10px">' + esc(msg) + '</p>' +
                '<p style="font-size:13px;color:#64748B">' + hint + '</p>' +
                '<p style="font-size:13px;color:#64748B;margin-top:10px">' +
                'ข้อมูลที่กรอกไว้ยังอยู่ครบ กดส่งใหม่ได้เลย</p>',
          confirmButtonColor: '#0072CE'
        });
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
      })
      .catch(function () { /* ไม่มีทะเบียนก็ข้ามไป ไม่กระทบการใช้งาน */ });
  }

  /** เติมปีที่ประเมินให้อัตโนมัติจากทะเบียน (ผู้ใช้แก้เองได้) */
  /**
   * เติมปีที่ประเมินให้อัตโนมัติจากทะเบียน สสจ.
   * เฉพาะงาน Green & Clean เท่านั้น — ฝั่งอาชีวอนามัยฯ ให้ผู้ใช้กรอกเอง
   * (มีแต่ placeholder ไม่ใส่ค่าตั้งต้นให้)
   */
  function prefillYear() {
    if (!registry) return;
    var el = $('gc-year');
    var y = registry.green && registry.green.year;
    if (el && !el.value && y) el.value = y;
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
  /** ชื่อหน่วยงานในชีตอาจมีช่องว่างเกินหรือเว้นวรรคต่างกัน จึงเทียบแบบผ่อนปรน */
  function sameHospital(a, b) {
    var norm = function (x) { return String(x == null ? '' : x).replace(/\s+/g, '').trim(); };
    return norm(a) === norm(b);
  }

  function loadHistory() {
    API.getOrDemo('getSubmissions', { hospital: user.hospital }, window.DEMO.submissions)
      .then(function (res) {
        var all = (res && res.data) || [];

        /* Apps Script กรองให้เป็นของหน่วยงานนี้มาแล้ว (บังคับจาก token)
           การกรองซ้ำตรงนี้เป็นแค่กันพลาด ถ้ากรองแล้วเหลือศูนย์ทั้งที่มีข้อมูล
           แปลว่าชื่อในสองชีตเขียนไม่ตรงกัน — ใช้ของที่เซิร์ฟเวอร์ส่งมาแทน
           ไม่งั้นผู้ใช้จะเห็นตารางว่างทั้งที่ส่งรายงานไปแล้ว */
        var mine = all.filter(function (r) { return sameHospital(r.hospital, user.hospital); });
        if (!mine.length && all.length) {
          console.warn('ชื่อหน่วยงานในชีตติดตามงานไม่ตรงกับชีต Login — ใช้ข้อมูลที่เซิร์ฟเวอร์กรองมาแทน');
          mine = all;
        }
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
      })
      .catch(function (err) {
        if (err && err.authError) return;   /* ระบบพาไปล็อกอินให้แล้ว */
        /* เดิมแค่ console.warn หน้าเว็บจึงเงียบ ผู้ใช้เห็นตารางว่างโดยไม่รู้สาเหตุ */
        console.warn('โหลดประวัติไม่สำเร็จ:', err.message);
        ['gc', 'occ'].forEach(function (p) {
          var body = $(p + '-history-body');
          if (!body) return;
          body.innerHTML = '<tr><td colspan="5" class="py-8 px-6 text-center text-sm">' +
            '<span class="text-red-600 font-semibold">โหลดประวัติไม่สำเร็จ</span><br>' +
            '<span class="text-text-muted text-xs">' + esc(err.message) + '</span><br>' +
            '<span class="text-text-muted text-xs">ลองรีเฟรชหน้า หรือออกจากระบบแล้วเข้าใหม่</span>' +
            '</td></tr>';
        });
      });
  }

  function renderHistory(prefix, rows) {
    var body = $(prefix + '-history-body');
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="py-8 px-6 text-center text-text-muted text-sm">ยังไม่มีประวัติการส่งรายงาน</td></tr>';
      return;
    }

    var isOcc = prefix === 'occ';

    body.innerHTML = rows.map(function (r) {
      return '<tr class="hover:bg-primary-light/30 transition-colors align-top">' +
        '<td class="py-4 px-6 font-medium text-text-main whitespace-nowrap">' + UI.thaiDate(r.submittedAt) + '</td>' +
        '<td class="py-4 px-6 text-text-main">' + esc(r.hospType) + '</td>' +
        '<td class="py-4 px-6 text-text-main">' + listHTML(r.categories, r.items) + '</td>' +
        '<td class="py-4 px-6">' + UI.statusBadge(r.status) + '</td>' +
        (isOcc
          /* อาชีวอนามัยฯ: คอลัมน์สุดท้ายเป็นรายละเอียดที่ผู้ใช้กรอกในแบบฟอร์ม */
          ? '<td class="py-4 px-6 text-sm text-text-main whitespace-pre-line">' +
              (r.detail ? esc(r.detail) : '<span class="text-text-muted text-xs">-</span>') + '</td>'
          : '<td class="py-4 px-6 text-right whitespace-nowrap">' +
              (r.driveLink
                ? '<a href="' + esc(r.driveLink) + '" target="_blank" rel="noopener" class="text-primary hover:underline font-semibold">เปิดหลักฐาน</a>'
                : '<span class="text-text-muted text-xs">-</span>') + '</td>') +
      '</tr>';
    }).join('');
  }

  /**
   * หนึ่งเซลล์เก็บได้หลายหมวด/หลายข้อ (คั่นด้วยขึ้นบรรทัดใหม่ในชีต)
   * แสดงเป็นรายการทีละบรรทัด อ่านง่ายกว่าต่อกันยาวเป็นแถวเดียว
   */
  function splitLines(text) {
    return String(text == null ? '' : text)
      .split(/[\r\n]+|\s*;\s*/)
      .map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length > 0; });
  }

  function listHTML(categories, items) {
    var cats = splitLines(categories), its = splitLines(items);
    if (!cats.length && !its.length) return '<span class="text-text-muted text-xs">-</span>';

    var block = function (arr, cls) {
      return arr.map(function (x) {
        return '<li class="flex gap-1.5 leading-snug"><span class="flex-shrink-0">•</span>' +
               '<span class="' + cls + '">' + esc(x) + '</span></li>';
      }).join('');
    };

    return '<ul class="space-y-1 text-sm">' + block(cats, 'font-medium text-text-main') + '</ul>' +
           (its.length
             ? '<ul class="space-y-0.5 mt-2 pl-3 border-l-2 border-outline-custom">' +
                 block(its, 'text-xs text-text-muted') + '</ul>'
             : '');
  }

  /* แต่ละขั้นผูกกับคีย์สีใน APP_CONFIG.STATUS_COLORS ไม่เขียนสีตายตัวที่นี่ */
  var STEPS = [
    { key: 'NONE'     },
    { key: 'PENDING'  },
    { key: 'REVISE'   },
    { key: 'CHECKING' },
    { key: 'APPROVED', sub: '[มาตรฐาน / ดีเยี่ยม / ท้าทาย]' }
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

    var CO = (window.APP_CONFIG && window.APP_CONFIG.STATUS_COLORS) || {};
    var active = stepIndex(latest && latest.status);

    /* เส้นเชื่อม: ช่วงที่ผ่านมาแล้วใช้สีของขั้นก่อนหน้า ที่เหลือเป็นสีเทา */
    var lines = STEPS.slice(1).map(function (_, i) {
      var c = CO[STEPS[i].key] || {};
      return '<div class="flex-1" style="background:' +
             (i < active ? c.hex : '#E2E8F0') + '"></div>';
    }).join('');

    var nodes = STEPS.map(function (st, i) {
      var c = CO[st.key] || {};
      var reached = i <= active;
      var cur = i === active;

      /* ขั้นที่ยังมาไม่ถึงเป็นสีเทา ขั้นที่ถึงแล้วใช้สีประจำสถานะนั้น */
      var dot = reached
        ? 'style="background:' + c.hex + ';color:#fff' + (cur ? ';box-shadow:0 0 0 4px ' + c.hex + '33' : '') + '"'
        : 'style="background:#E2E8F0;color:#64748B"';
      var txt = reached
        ? 'style="color:' + c.hex + '" class="text-xs text-center leading-tight whitespace-nowrap mt-4 ' + (cur ? 'font-bold' : 'font-semibold') + '"'
        : 'class="text-xs text-center leading-tight whitespace-nowrap mt-4 font-semibold text-text-muted"';

      return '<div class="relative z-10 flex flex-col items-center flex-1">' +
             '<div class="w-10 h-10 rounded-full flex items-center justify-center font-bold border-4 border-surface" ' + dot + '>' +
             '<span class="material-symbols-outlined text-sm">' + c.icon + '</span></div>' +
             '<p ' + txt + '>' + esc(c.label) +
               (st.sub ? '<br><span class="text-[10px] font-normal">' + st.sub + '</span>' : '') +
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
