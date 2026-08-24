/*  หน้าผู้ดูแลระบบ (admin.html) — สิทธิ์ 'admin' เท่านั้น
 *  ดึงรายการส่งงานจาก Google Sheet → กรอง → ตรวจงาน → เขียนสถานะกลับเข้าชีต
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var S = CFG.STATUS;
  var user = null;
  var allRows = [];       // ข้อมูลดิบทั้งหมดจากชีต
  var view = 'green';     // green | occ | manual | users
  var levelFilter = '';   // กรองเฉพาะระดับผลการรับรอง (ใช้กับกล่องรับรองผล)
  var pane = 'table';     // table | dashboard
  var page = 1;
  var PER_PAGE = 15;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return UI.esc(s); };

  /* =========================================================
   *  เริ่มต้น
   * ======================================================= */
  document.addEventListener('DOMContentLoaded', function () {
    user = Auth.require('admin');
    if (!user) return;

    $('user-display-name').textContent = user.username || user.hospital;
    $('user-display-hosp').textContent = user.hospital + ' (Admin)';

    bindNav();
    bindFilters();
    bindStatCards();
    bindPaneTabs();
    bindUsers();
    bindKpi();

    /* แท็บคู่มือของ สสจ. — ลิงก์และเบอร์ติดต่ออ่านจาก config แก้ที่เดียว */
    var ml = $('admin-manual-link');
    if (ml && CFG.ADMIN_MANUAL_URL) ml.href = CFG.ADMIN_MANUAL_URL;
    var cl = $('admin-contact-line');
    if (cl) cl.textContent = CFG.CONTACT_LINE || '';

    applyView();
    setActiveCard('');

    var lvYear = $('lv-year');
    if (lvYear) {
      lvYear.addEventListener('input', renderLevels);
      lvYear.addEventListener('change', renderLevels);
    }
    var lvAll = $('lv-year-all');
    if (lvAll) lvAll.addEventListener('click', function () {
      if (lvYear) lvYear.value = '';
      renderLevels();
    });

    /* ค่า KPI ต้องมาก่อนวาดแท็บสรุประดับ จึงโหลดเสร็จแล้วค่อยวาดซ้ำ */
    loadSettings().then(function () { renderKpiForms(); renderLevels(); });

    $('btn-logout').addEventListener('click', function (e) { e.preventDefault(); Auth.logout(); });
    $('btn-sync').addEventListener('click', function () { load(true); });

    load(false);
  });

  /* =========================================================
   *  สลับ "รายการส่งงาน" ↔ "แดชบอร์ดวิเคราะห์"
   * ======================================================= */
  function bindPaneTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.pane-tab'), function (btn) {
      btn.addEventListener('click', function () {
        pane = btn.getAttribute('data-pane');
        document.querySelectorAll('.pane-tab').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('bg-white', on);
          b.classList.toggle('text-primary', on);
          b.classList.toggle('shadow-sm', on);
          b.classList.toggle('text-text-muted', !on);
        });
        ['table', 'dashboard', 'levels'].forEach(function (name) {
          var el = $('pane-' + name);
          if (el) el.classList.toggle('hidden', pane !== name);
        });
        /* กล่องสถิติกับแถบตัวกรองใช้เฉพาะแท็บตรวจรับรอง */
        var onTable = pane === 'table';
        if ($('stat-cards')) $('stat-cards').classList.toggle('hidden', !onTable);
        if ($('filter-bar')) $('filter-bar').classList.toggle('hidden', !onTable);
        render();
      });
    });
  }

  /* =========================================================
   *  เมนูซ้าย
   * ======================================================= */
  function bindNav() {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-link'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(function (x) {
          x.classList.remove('bg-white/20', 'font-bold', 'border-l-4', 'border-secondary');
          x.classList.add('hover:bg-white/10');
        });
        a.classList.add('bg-white/20', 'font-bold', 'border-l-4', 'border-secondary');
        a.classList.remove('hover:bg-white/10');

        view = a.getAttribute('data-view');
        page = 1;

        applyView();
        if (view === 'users') loadUsers();
        else if (view !== 'manual') render();
      });
    });
  }

  /**
   * จัดหน้าตามแท็บหลักที่เลือก
   * สลับ section ที่แสดง เปลี่ยนชื่อ/สีหัวข้อ และเปลี่ยนคำว่า หมวด/องค์ประกอบ
   * ให้ตรงกับสายงาน (Green ใช้ "หมวด" / อาชีวอนามัยฯ ใช้ "องค์ประกอบ")
   */
  function applyView() {
    var isUsers  = view === 'users';
    var isManual = view === 'manual';
    var isWork   = !isUsers && !isManual;

    $('view-submissions').classList.toggle('hidden', !isWork);
    $('view-users').classList.toggle('hidden', !isUsers);
    if ($('view-manual')) $('view-manual').classList.toggle('hidden', !isManual);
    if (!isWork) return;

    var green = view === 'green';
    $('page-title').textContent = green
      ? 'ติดตามงาน Green & Clean Hospital'
      : 'ติดตามงานอาชีวอนามัยและเวชกรรมสิ่งแวดล้อม';
    /* สีหัวข้อตามสายงาน: Green เขียว / อาชีวอนามัยฯ ส้ม */
    $('page-title').style.color = green ? '#3d6a00' : '#EA580C';

    if ($('tab-dash-label')) {
      $('tab-dash-label').textContent = green
        ? 'วิเคราะห์หมวดและข้อที่แก้ไขมากที่สุด'
        : 'วิเคราะห์องค์ประกอบและข้อที่แก้ไขมากที่สุด';
    }
  }

  /* =========================================================
   *  โหลดข้อมูลจากชีต
   * ======================================================= */
  function load(showToast) {
    if (showToast) UI.loading('กำลังซิงค์ข้อมูลกับ Google Sheets...');

    API.getOrDemo('getSubmissions', {}, window.DEMO.submissions)
      .then(function (res) {
        allRows = (res && res.data) || [];
        fillFilterOptions();
        fillLevelYears();
        render();
        $('last-sync').textContent = 'อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH');
        if (showToast) {
          UI.close();
          UI.toast('success', 'ซิงค์ข้อมูลสำเร็จ',
            API.demoMode ? 'ขณะนี้เป็นข้อมูลตัวอย่าง (ยังต่อ Google Sheet ไม่ได้)'
                         : 'ดึงข้อมูลล่าสุดจาก Google Sheets แล้ว ' + allRows.length + ' รายการ');
        }
      })
      .catch(function (err) {
        UI.close();
        $('table-body').innerHTML =
          '<tr><td colspan="9" class="py-10 text-center text-red-500">ดึงข้อมูลไม่สำเร็จ: ' + esc(err.message) + '</td></tr>';
      });
  }

  function fillFilterOptions() {
    var fill = function (id, values) {
      var sel = $(id);
      var keep = sel.value;
      sel.innerHTML = '<option value="">ทั้งหมด</option>' +
        values.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('');
      sel.value = keep;
    };
    var uniq = function (key) {
      return allRows.map(function (r) { return r[key]; })
        .filter(function (v, i, a) { return v && a.indexOf(v) === i; }).sort();
    };
    fill('f-district', uniq('district'));
    fill('f-hosptype', uniq('hospType'));
    fill('f-year', uniq('year'));
  }

  /* =========================================================
   *  ตัวกรอง
   * ======================================================= */
  function bindFilters() {
    ['f-district', 'f-hosptype', 'f-year', 'f-status'].forEach(function (id) {
      $(id).addEventListener('change', function () { page = 1; render(); });
    });
    $('f-search').addEventListener('input', function () { page = 1; render(); });
    $('btn-search').addEventListener('click', function () { page = 1; render(); });
    $('btn-clear').addEventListener('click', function () {
      ['f-district', 'f-hosptype', 'f-year', 'f-status'].forEach(function (id) { $(id).value = ''; });
      $('f-search').value = '';
      setActiveCard('');
      page = 1;
      render();
    });
    $('btn-export').addEventListener('click', exportCSV);
    $('btn-prev').addEventListener('click', function () { if (page > 1) { page--; render(); } });
    $('btn-next').addEventListener('click', function () {
      if (page * PER_PAGE < filtered().length) { page++; render(); }
    });
  }

  function bindStatCards() {
    Array.prototype.forEach.call(document.querySelectorAll('.stat-card'), function (card) {
      card.addEventListener('click', function () {
        var st = card.getAttribute('data-status');
        levelFilter = '';                 /* เปลี่ยนกล่อง = เริ่มนับใหม่ */
        $('f-status').value = st;
        setActiveCard(st);
        page = 1;
        render();
      });
    });
  }

  /** คีย์สีของกล่องสถิติแต่ละใบ ('' = รายการทั้งหมด) */
  function cardKey(status) {
    return !status            ? 'ALL'
         : status === S.PENDING  ? 'PENDING'
         : status === S.CHECKING ? 'CHECKING'
         : status === S.REVISE   ? 'REVISE'
         : status === S.APPROVED ? 'APPROVED' : 'ALL';
  }

  function setActiveCard(status) {
    document.querySelectorAll('.stat-card').forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-status') === status);
    });

    /* หัวตารางต้องบอกว่ากำลังดูอะไรอยู่ ทั้งชื่อและสีต้องตรงกับกล่องที่คลิก */
    var c = CFG.STATUS_COLORS[cardKey(status)];
    var h = $('table-title');
    if (h && c) {
      h.style.color = c.hex;
      h.childNodes[0].nodeValue = c.label + ' ';
    }
  }

  function filtered(opts) {
    opts = opts || {};
    var d = $('f-district').value, t = $('f-hosptype').value,
        y = $('f-year').value, st = opts.ignoreStatus ? '' : $('f-status').value,
        q = $('f-search').value.trim().toLowerCase();

    return allRows.filter(function (r) {
      var isGreen = String(r.workType).indexOf('Green') !== -1;
      if (view === 'green' && !isGreen) return false;
      if (view === 'occ' && isGreen) return false;
      if (d && r.district !== d) return false;
      if (t && r.hospType !== t) return false;
      if (y && String(r.year) !== y) return false;
      if (st && r.status !== st) return false;
      if (!opts.ignoreLevel && levelFilter && r.level !== levelFilter) return false;
      if (q) {
        var hay = [r.hospital, r.district, r.categories, r.items, r.senderName, r.level]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /* =========================================================
   *  วาดตาราง + สถิติ
   * ======================================================= */
  function render() {
    var rows = filtered();

    // สถิตินับจากขอบเขตของเมนูที่เลือก (ไม่รวมตัวกรองสถานะ เพื่อให้ตัวเลขนิ่ง)
    var scope = allRows.filter(function (r) {
      var isGreen = String(r.workType).indexOf('Green') !== -1;
      if (view === 'green' && !isGreen) return false;
      if (view === 'occ' && isGreen) return false;
      return true;
    });
    var count = function (s) { return scope.filter(function (r) { return r.status === s; }).length; };
    $('stat-total').textContent    = scope.length;
    $('stat-pending').textContent  = count(S.PENDING);
    $('stat-checking').textContent = count(S.CHECKING);
    $('stat-revise').textContent   = count(S.REVISE);
    $('stat-approved').textContent = count(S.APPROVED);

    $('row-count').textContent = '(' + rows.length + ' รายการ)';

    renderApprovedChart();
    renderDashboard();
    renderLevels();

    var totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    if (page > totalPages) page = totalPages;
    var start = (page - 1) * PER_PAGE;
    var pageRows = rows.slice(start, start + PER_PAGE);

    $('page-info').textContent = rows.length
      ? 'แสดง ' + (start + 1) + ' - ' + (start + pageRows.length) + ' จากทั้งหมด ' + rows.length + ' รายการ (หน้า ' + page + '/' + totalPages + ')'
      : 'ไม่มีรายการ';

    var body = $('table-body');
    if (!pageRows.length) {
      body.innerHTML = '<tr><td colspan="9" class="py-10 text-center text-text-muted">ไม่พบรายการตามเงื่อนไขที่เลือก</td></tr>';
      return;
    }

    body.innerHTML = pageRows.map(function (r, i) {
      return '<tr class="hover:bg-primary-light/30 transition-colors">' +
        '<td class="py-3 px-4 text-text-muted">' + (start + i + 1) + '</td>' +
        '<td class="py-3 px-4 font-medium">' + UI.thaiDate(r.submittedAt) + '</td>' +
        '<td class="py-3 px-4">' + esc(r.district || '-') + '</td>' +
        '<td class="py-3 px-4 font-semibold">' + esc(r.hospital || '-') +
          '<br><span class="text-xs font-normal text-text-muted">' + esc(r.hospType) + '</span></td>' +
        '<td class="py-3 px-4">' + esc(r.workType) + '</td>' +
        '<td class="py-3 px-4 max-w-[260px]"><div class="truncate" title="' + esc(r.categories) + '">' + esc(r.categories || '-') + '</div>' +
          '<div class="text-xs text-text-muted truncate" title="' + esc(r.items) + '">' + esc(r.items || '') + '</div></td>' +
        '<td class="py-3 px-4">' + esc(r.level || '-') + '</td>' +
        '<td class="py-3 px-4">' + UI.statusBadge(r.status) + '</td>' +
        '<td class="py-3 px-4 text-right whitespace-nowrap">' +
          '<button class="btn-review px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-hover" ' +
          'data-key="' + esc(r.sheet + '|' + r.row) + '">ตรวจงาน/แก้ไข</button></td>' +
      '</tr>';
    }).join('');

    Array.prototype.forEach.call(body.querySelectorAll('.btn-review'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key').split('|');
        var row = allRows.filter(function (r) { return r.sheet === key[0] && String(r.row) === key[1]; })[0];
        if (row) openReview(row);
      });
    });
  }

  /* =========================================================
   *  แดชบอร์ดวิเคราะห์ — คำนวณสดจากแถวจริงในชีต
   *  ขอบเขต = เมนูซ้าย (ทั้งหมด/Green/อาชีวฯ) + ตัวกรองอำเภอ/ประเภท/ปี/คำค้น
   *  ไม่รวมตัวกรองสถานะ เพราะกราฟต้องเห็นทุกสถานะจึงจะคำนวณสัดส่วนได้
   * ======================================================= */
  function renderDashboard() {
    if (!$('pane-dashboard')) return;

    var rows = filtered({ ignoreStatus: true, ignoreLevel: true });
    var st = Stats.status(rows);

    $('dash-scope').textContent = scopeText() + ' • ' + rows.length + ' รายการ';

    renderKPI(rows, st);

    /* หมวด (Green) / องค์ประกอบ (อาชีวอนามัยฯ) — คำเรียกต่างกันตามสายงาน */
    var word = view === 'occ' ? 'องค์ประกอบ' : 'หมวด';
    $('dash-cat-title').textContent = 'อันดับ' + word + 'ที่ถูกส่งแก้ไขมากที่สุด';
    $('dash-catpie-title').textContent = 'สัดส่วนการแก้ไขของทุก' + word;
    $('dash-catpie-sub').textContent = 'แต่ละ' + word + 'คิดเป็นกี่ % ของการส่งแก้ไขทั้งหมด';

    /* 5 อันดับแรก */
    $('dash-cat').innerHTML = Viz.hbars(Stats.freqMulti(rows, 'categories', 5), {
      unit: 'ครั้ง', maxLen: 58,
      emptyText: 'ยังไม่มีรายการส่งแก้ไขในขอบเขตนี้'
    });

    /* แผนภูมิวงกลมของทุกหมวด/องค์ประกอบ เห็นภาพรวมว่าหมวดไหนหนักจริง */
    var allCats = Stats.freqMulti(rows, 'categories');
    $('dash-cat-pie').innerHTML = allCats.length
      ? Viz.donut(allCats, { centerLabel: 'ครั้ง', unit: 'ครั้ง' })
      : '<p class="text-sm text-text-muted">ยังไม่มีข้อมูล</p>';

    $('dash-level').innerHTML = Viz.donut(Stats.freq(rows, 'level'), {
      colors: Viz.LEVEL_COLORS, centerLabel: 'รายการ',
      emptyText: 'ยังไม่มีการระบุระดับผลการประเมิน'
    });

    var stItems = [
      { label: S.PENDING,  count: st.pending },
      { label: S.CHECKING, count: st.checking },
      { label: S.REVISE,   count: st.revise },
      { label: S.APPROVED, count: st.approved }
    ].map(function (x) {
      x.pct = st.total ? x.count * 100 / st.total : 0;
      return x;
    });
    $('dash-status').innerHTML = Viz.hbars(stItems, {
      rank: false, unit: 'รายการ',
      colors: statusColors(),
      emptyText: 'ยังไม่มีรายการ'
    });

    var items = Stats.freqMulti(rows, 'items');
    $('dash-item-count').textContent = items.length
      ? 'ถูกส่งแก้ไขทั้งหมด ' + items.length + ' ข้อ'
      : '';

    /* 5 อันดับแรก แยกออกมาให้อ่านง่าย ไม่ต้องไล่หาในกราฟแท่งยาว ๆ */
    $('dash-item-top').innerHTML = Viz.hbars(items.slice(0, 5), {
      unit: 'ครั้ง', maxLen: 58,
      emptyText: 'ยังไม่มีข้อที่ถูกส่งแก้ไข'
    });
    /* ชุดข้อมูลเดียว — ความยาวแท่งบอกจำนวนอยู่แล้ว จึงใช้สีเดียว
       ถ้าไล่สีตามอันดับ ผู้อ่านจะเข้าใจผิดว่าแต่ละแท่งเป็นคนละประเภท */
    $('dash-item').innerHTML = Viz.vbars(items, {
      color: Stats.PALETTE[0], maxLen: 16, barWidth: 62,
      emptyText: 'ยังไม่มีข้อที่ถูกส่งแก้ไข'
    });

    $('dash-month').innerHTML = Viz.vbars(Stats.byMonth(rows, 12), {
      unit: 'รายการ', maxLen: 10, barWidth: 38
    });

    $('dash-type').innerHTML = Viz.hbars(Stats.freq(rows, 'hospType'), {
      unit: 'รายการ', maxLen: 40,
      emptyText: 'ยังไม่มีข้อมูลประเภทหน่วยงาน'
    });

    renderDistrictTable(rows);

    $('dash-hospital').innerHTML = Viz.hbars(Stats.freq(rows, 'hospital', 10), {
      unit: 'ครั้ง', maxLen: 40, color: Stats.PALETTE[0],
      emptyText: 'ยังไม่มีหน่วยงานที่ส่งรายงาน'
    });

    var backlog = rows.filter(function (r) { return r.status !== S.APPROVED; });
    $('dash-backlog').innerHTML = Viz.hbars(Stats.freq(backlog, 'hospital', 10), {
      unit: 'รายการ', maxLen: 40, color: Stats.PALETTE[3],
      emptyText: 'ไม่มีรายการค้างตรวจ 🎉'
    });
  }

  function statusColors() { return Viz.STATUS_COLORS(); }

  function scopeText() {
    var parts = [
      view === 'green' ? 'งาน Green & Clean' :
      view === 'occ'   ? 'งานอาชีวอนามัยฯ'   : 'ทุกประเภทงาน'
    ];
    var d = $('f-district').value, t = $('f-hosptype').value, y = $('f-year').value;
    if (d) parts.push('อ.' + d);
    if (t) parts.push(t);
    if (y) parts.push('ปี ' + y);
    return parts.join(' • ');
  }


  function renderKPI(rows, st) {
    /* ไม่แสดง "รายการส่งงานทั้งหมด" เพราะมีกล่องนี้ในแท็บตรวจรับรองแล้ว
       และไม่แสดง "ความครอบคลุมของหน่วยงาน" เพราะจำนวนหน่วยงานทั้งจังหวัด
       ไม่ได้คงที่ตามทะเบียน จึงคิดเป็นเปอร์เซ็นต์ให้ถูกต้องไม่ได้ */
    $('dash-kpi').innerHTML = [
      Viz.kpi({
        label: 'อัตราการรับรองผล', icon: 'workspace_premium', color: '#7C3AED',
        value: st.approvedPct.toFixed(1) + '%',
        sub: 'รับรองแล้ว ' + st.approved + ' จาก ' + st.total + ' รายการ',
        bar: st.approvedPct, target: 100
      }),
      Viz.kpi({
        label: 'ค้างดำเนินการ', icon: 'pending_actions', color: '#EAB308',
        value: st.outstanding.toLocaleString('th-TH'),
        sub: 'รอตรวจ ' + st.pending + ' • ตรวจแล้ว ' + st.checking + ' • ต้องแก้ไข ' + st.revise
      }),
      Viz.kpi({
        label: 'หน่วยงานที่ส่งรายงาน', icon: 'domain', color: '#0072CE',
        value: Stats.uniqueCount(rows, 'hospital').toLocaleString('th-TH'),
        sub: 'นับจากรายการที่ผ่านตัวกรองด้านบน'
      })
    ].join('');
  }

  function renderDistrictTable(rows) {
    var body = $('dash-district');
    var groups = Stats.group(rows, 'district');

    if (!groups.length) {
      body.innerHTML = '<tr><td colspan="7" class="py-10 text-center text-text-muted">ยังไม่มีข้อมูลให้สรุป</td></tr>';
      return;
    }

    body.innerHTML = groups.map(function (g) {
      return '<tr class="hover:bg-primary-light/30">' +
        '<td class="py-3 px-4 font-semibold">' + esc(g.label) + '</td>' +
        '<td class="py-3 px-4 text-right">' + g.hospitalCount + '</td>' +
        '<td class="py-3 px-4 text-right font-semibold">' + g.total + '</td>' +
        '<td class="py-3 px-4 text-right text-yellow-status">' + g.pending + '</td>' +
        '<td class="py-3 px-4 text-right text-red-500">' + g.revise + '</td>' +
        '<td class="py-3 px-4 text-right text-green-600">' + g.approved + '</td>' +
        '<td class="py-3 px-4">' + Viz.progress(g.approvedPct, { color: '#16A34A' }) +
          '<div class="text-[11px] text-text-muted mt-1">' + g.approvedPct.toFixed(1) + '%</div></td>' +
      '</tr>';
    }).join('');
  }

  /* =========================================================
   *  หน้าต่างตรวจงาน → เขียนสถานะกลับเข้าชีต
   * ======================================================= */
  /** ในชีตช่องหมายเหตุเก็บ "ข้อความ\n— ผู้ตรวจ (วันที่)" ตัดบรรทัดลายเซ็นออกก่อนแก้ */
  function stripSignature(text) {
    return String(text || '').replace(/\n?—\s.*$/, '').trim();
  }

  /* =========================================================
   *  ป็อปอัพตรวจงาน — โครงหน้าตาตามไฟล์ต้นแบบ
   *  ต่อข้อมูลจริงจาก Google Sheets และบังคับลำดับการทำงาน:
   *    ตรวจหลักฐาน > กด "ดำเนินการตรวจสอบแล้ว" > เลือกระดับ > รับรองผล
   *  ก่อนถึงขั้นไหน ปุ่มขั้นถัดไปจะยังกดไม่ได้
   * ======================================================= */

  /** แตกข้อความหลายบรรทัดในเซลล์เดียวเป็นรายการ */
  function lines(text) {
    return String(text == null ? '' : text)
      .split(/[\r\n]+|\s*;\s*/)
      .map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length > 0; });
  }

  /** เลขนำหน้าของหมวด/ข้อ ใช้จับคู่ข้อเข้ากับหมวดของมัน เช่น "ข้อ 1.1" -> "1" */
  function leadNo(text) {
    var m = String(text).match(/(\d+)/);
    return m ? m[1] : '';
  }

  /**
   * ปุ่มเปิดไฟล์หลักฐาน
   * คอลัมน์หลักฐานเก็บได้หลายลิงก์ (คั่นด้วยขึ้นบรรทัดใหม่) จึงทำปุ่มให้ครบทุกอัน
   * และรับเฉพาะที่ขึ้นต้นด้วย http เท่านั้น — ถ้าใส่ค่าที่ไม่ใช่ URL ลงใน href
   * เบราว์เซอร์จะมองเป็นพาธสัมพัทธ์แล้ววิ่งไปหน้าเว็บตัวเองแทน (เช่นลิงก์ github.io)
   */
  function evidenceHTML(raw) {
    var links = String(raw == null ? '' : raw)
      .split(/[\r\n]+|\s+(?=https?:\/\/)/)
      .map(function (x) { return x.trim(); })
      .filter(function (x) { return /^https?:\/\//i.test(x); });

    if (!links.length) {
      var note = String(raw || '').trim();
      return note
        ? '<span class="text-gray-500 text-sm">หลักฐานที่แนบมาไม่ใช่ลิงก์ที่เปิดได้: ' +
          '<span class="font-mono text-xs">' + esc(note.slice(0, 120)) + '</span></span>'
        : '<span class="text-gray-500">โรงพยาบาลยังไม่ได้แนบหลักฐาน</span>';
    }

    return links.map(function (u, i) {
      return '<a href="' + esc(u) + '" target="_blank" rel="noopener" ' +
        'class="inline-flex items-center px-6 py-3 bg-[#0072ce] text-white rounded-lg font-bold hover:bg-[#0059a4] transition-colors shadow-md gap-2">' +
        '<span class="material-symbols-outlined">folder</span>' +
        'คลิกเปิดดูไฟล์หลักฐาน (PDF / Google Drive)' +
        (links.length > 1 ? ' — ไฟล์ที่ ' + (i + 1) : '') + '</a>';
    }).join('');
  }

  function openReview(r) {
    var isGreen   = String(r.workType || '').indexOf('Green') !== -1;
    var levels    = (CFG.LEVELS && (isGreen ? CFG.LEVELS.green : CFG.LEVELS.occ)) || [];
    var groupWord = isGreen ? 'หมวด' : 'องค์ประกอบ';
    var CO        = CFG.STATUS_COLORS;

    /* ---- สถานะภายในป็อปอัพ ---- */
    var state = {
      status:  r.status || S.PENDING,
      level:   r.level || '',
      comment: stripSignature(r.comment)
    };

    /* ---- จัดหมวดกับข้อให้เป็นต้นไม้ ตามเลขนำหน้า ---- */
    var cats  = lines(r.categories);
    var items = lines(r.items);
    var tree  = cats.map(function (c) {
      var no = leadNo(c);
      return { label: c, children: items.filter(function (it) { return leadNo(it) === no; }) };
    });
    var orphan = items.filter(function (it) {
      return !cats.some(function (c) { return leadNo(c) === leadNo(it); });
    });
    if (orphan.length) tree.push({ label: groupWord + 'อื่น ๆ', children: orphan });

    /* ---- แถวติ๊ก: หมวด/องค์ประกอบเป็นตัวหนา ข้อย่อยเยื้องเข้าไป (ตามต้นแบบ) ---- */
    var checkRow = function (label, child, idx) {
      var id = 'rv-chk-' + idx;
      return child
        ? '<div class="flex items-center gap-3 ml-8">' +
            '<input id="' + id + '" type="checkbox" class="w-4 h-4 rounded border-gray-300" style="accent-color:#0059a4">' +
            '<label for="' + id + '" class="text-gray-700 cursor-pointer">' + esc(label) + '</label></div>'
        : '<div class="flex items-start gap-3">' +
            '<input id="' + id + '" type="checkbox" class="mt-1 w-5 h-5 rounded border-gray-300" style="accent-color:#0059a4">' +
            '<label for="' + id + '" class="font-bold text-lg text-gray-800 block cursor-pointer">' + esc(label) + '</label></div>';
    };

    var n = 0, treeHTML = '';
    tree.forEach(function (g) {
      treeHTML += '<div class="space-y-2">' + checkRow(g.label, false, n++) +
                  g.children.map(function (c) { return checkRow(c, true, n++); }).join('') + '</div>';
    });
    if (!treeHTML) treeHTML = '<p class="text-gray-500">ไม่ได้ระบุ' + groupWord + '/ข้อที่แก้ไข</p>';

    var infoCell = function (label, value, strong) {
      return '<div class="space-y-1"><p class="text-sm font-bold text-gray-500 mb-1">' + label + '</p>' +
             '<p class="text-lg ' + (strong ? 'text-[#0059a4] font-bold' : 'text-gray-800') + '">' +
             esc(value || '-') + '</p></div>';
    };

    var badge = isGreen
      ? '<span class="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold bg-[#D1F2DD] text-green-800 border border-green-200">งาน: Green &amp; Clean Hospital</span>'
      : '<span class="mt-2 block w-fit items-center px-2.5 py-0.5 rounded-full text-sm font-bold bg-orange-500 text-white border border-orange-600">งาน: อาชีวอนามัยและเวชกรรมสิ่งแวดล้อม</span>';

    /* ---- ประกอบร่างป็อปอัพ (โครงและคลาสตามไฟล์ต้นแบบ) ---- */
    var wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4';
    wrap.innerHTML =
      '<div class="bg-white w-full max-w-4xl rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]" id="rv-card">' +

        '<div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">' +
          '<h2 class="text-xl md:text-2xl font-bold text-gray-800 leading-tight">' +
            'ตรวจงานและดูรายละเอียด - <span class="text-[#0059a4]">' + esc(r.hospital) + '</span>' + badge +
          '</h2>' +
          '<button type="button" id="rv-x" class="p-2 hover:bg-gray-200 rounded-full transition-colors shrink-0">' +
            '<span class="material-symbols-outlined text-gray-500">close</span></button>' +
        '</div>' +

        '<div class="p-6 overflow-y-auto space-y-6 flex-1">' +
          '<div class="p-4 bg-gray-50 rounded-lg border border-gray-200">' +
            '<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">' +
              infoCell('อำเภอ', r.district) + infoCell('ประเภทโรงพยาบาล', r.hospType) +
              infoCell('ปีที่ประเมิน', r.year) + infoCell('ระดับที่ส่งประเมิน', r.level, true) +
            '</div>' +
            '<div class="space-y-4">' +
              '<h3 class="text-lg font-bold mb-2 text-[#0059a4]' +
                (isGreen ? '' : ' border-b border-gray-200 pb-2') + '">' +
                groupWord + 'และข้อที่ต้องการแก้ไข</h3>' +
              '<p class="text-xs text-gray-500 -mt-2">ติ๊กเพื่อทำเครื่องหมายว่าตรวจรายการนั้นแล้ว (ช่วยกันตรวจตกหล่น ไม่ถูกบันทึกลงชีต)</p>' +
              treeHTML +
            '</div>' +
          '</div>' +

          (r.detail
            ? '<div class="p-4 bg-gray-50 rounded-lg border border-gray-200">' +
                '<h3 class="text-lg font-bold mb-2 text-[#0059a4]">รายละเอียดการปรับปรุงแก้ไข</h3>' +
                '<p class="text-gray-700 whitespace-pre-line">' + esc(r.detail) + '</p></div>'
            : '') +

          '<div class="flex flex-col items-center gap-2">' + evidenceHTML(r.driveLink) + '</div>' +

          '<div class="space-y-4 border-t border-gray-100 pt-4">' +
            '<label class="font-bold text-gray-600 block mb-2">สถานะการตรวจสอบ</label>' +
            '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
              '<button type="button" id="rv-revise" class="w-full px-4 py-3 text-white rounded-lg font-bold shadow-sm transition-all flex items-center justify-center gap-2">ต้องแก้ไขเพิ่มเติม</button>' +
              '<button type="button" id="rv-check" class="w-full px-4 py-3 text-white rounded-lg font-bold shadow-sm transition-all flex items-center justify-center gap-2">ดำเนินการตรวจสอบแล้ว</button>' +
            '</div>' +
            '<p class="text-xs text-gray-500" id="rv-hint"></p>' +
          '</div>' +

          '<div>' +
            '<label class="font-bold text-gray-600 block mb-2">ระดับการรับรอง (Certification Level)</label>' +
            '<div class="flex flex-col md:flex-row gap-3 items-stretch md:items-end">' +
              '<select id="rv-level" class="flex-1 p-3 bg-white border border-gray-300 rounded-md text-lg focus:ring-2 focus:ring-[#0059a4] focus:border-transparent outline-none disabled:opacity-50 disabled:cursor-not-allowed">' +
                '<option value="">เลือกระดับการรับรอง...</option>' +
                levels.map(function (L) {
                  return '<option value="' + esc(L) + '"' + (state.level === L ? ' selected' : '') + '>' + esc(L) + '</option>';
                }).join('') +
              '</select>' +
              '<button type="button" id="rv-approve" class="flex-1 px-6 py-3 text-white rounded-lg font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">รับรองผลเรียบร้อยแล้ว</button>' +
            '</div>' +
          '</div>' +

          '<div>' +
            '<label class="font-bold text-gray-600 block mb-2">หมายเหตุ / ข้อเสนอแนะส่งถึงโรงพยาบาล</label>' +
            '<textarea id="rv-comment" class="w-full p-3 bg-gray-50 border border-gray-300 rounded-md text-lg focus:ring-2 focus:ring-[#0059a4] focus:border-transparent outline-none min-h-[80px] resize-y" ' +
              'placeholder="ระบุรายละเอียด...">' + esc(state.comment) + '</textarea>' +
          '</div>' +
        '</div>' +

        '<div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50 shrink-0">' +
          '<button type="button" id="rv-cancel" class="px-8 py-2 bg-white border border-gray-300 text-gray-700 rounded-md font-bold hover:bg-gray-100 transition-colors">ยกเลิก</button>' +
          '<button type="button" id="rv-save" class="px-8 py-2 text-white rounded-md font-bold transition-colors shadow-sm flex items-center gap-1.5" style="background:' + CO.CHECKING.hex + '">' +
            '<span class="material-symbols-outlined text-lg">save</span>บันทึกผล</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(wrap);
    var $$ = function (id) { return wrap.querySelector('#' + id); };
    var close = function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };

    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    $$('rv-card').addEventListener('click', function (e) { e.stopPropagation(); });
    $$('rv-x').addEventListener('click', close);
    $$('rv-cancel').addEventListener('click', close);

    /* ---- วาดสถานะปุ่มตามลำดับที่บังคับไว้ ---- */
    function paint() {
      var sel = $$('rv-level');
      var passedCheck = state.status === S.CHECKING || state.status === S.APPROVED;

      /* done = ขั้นที่ผ่านมาแล้ว (ติดสีค้างไว้)
         now  = ขั้นที่เป็นสถานะปัจจุบันจริง ๆ (ติดสี + มีวงรอบเน้น)
         พอรับรองผลแล้ว ปุ่ม "ดำเนินการตรวจสอบแล้ว" ต้องยังติดอยู่
         เพราะขั้นนั้นทำไปแล้ว ไม่ใช่ถูกยกเลิก */
      var mark = function (el, done, now, hex) {
        el.style.background = done ? hex : '#94A3B8';
        el.style.boxShadow  = now  ? '0 0 0 4px ' + hex + '33' : 'none';
        el.style.opacity    = done && !now ? '0.85' : '1';
      };
      mark($$('rv-revise'), state.status === S.REVISE, state.status === S.REVISE, CO.REVISE.hex);
      mark($$('rv-check'),  passedCheck, state.status === S.CHECKING, CO.CHECKING.hex);

      /* ขั้นที่ 2: เลือกระดับได้ต่อเมื่อกด "ดำเนินการตรวจสอบแล้ว" ไปแล้ว */
      sel.disabled = !passedCheck;
      sel.style.opacity = passedCheck ? '1' : '0.5';
      sel.style.cursor  = passedCheck ? '' : 'not-allowed';

      /* ขั้นที่ 3: รับรองผลได้ต่อเมื่อเลือกระดับแล้ว */
      var canApprove = passedCheck && !!state.level;
      var approved = state.status === S.APPROVED;
      var ap = $$('rv-approve');
      ap.disabled = !canApprove;
      ap.style.cursor = canApprove ? '' : 'not-allowed';
      mark(ap, approved, approved, CO.APPROVED.hex);
      if (!canApprove) ap.style.opacity = '0.5';

      $$('rv-hint').textContent =
        approved ? 'ตรวจสอบแล้วและรับรองผลระดับ "' + state.level + '" — กด "บันทึกผล" เพื่อส่งกลับ Google Sheets'
        : !passedCheck              ? 'ตรวจหลักฐานก่อน แล้วกด "ดำเนินการตรวจสอบแล้ว" จึงจะเลือกระดับการรับรองได้'
        : !state.level              ? 'เลือกระดับการรับรอง แล้วจึงกด "รับรองผลเรียบร้อยแล้ว" ได้'
        :                             'พร้อมรับรองผล — กดปุ่ม "รับรองผลเรียบร้อยแล้ว"';
    }

    $$('rv-revise').addEventListener('click', function () {
      state.status = S.REVISE; state.level = ''; $$('rv-level').value = ''; paint();
    });
    $$('rv-check').addEventListener('click', function () { state.status = S.CHECKING; paint(); });
    $$('rv-level').addEventListener('change', function () { state.level = this.value; paint(); });
    $$('rv-approve').addEventListener('click', function () {
      if (this.disabled) return;
      state.status = S.APPROVED; paint();
    });

    paint();

    /* ---- บันทึกกลับ Google Sheets ---- */
    $$('rv-save').addEventListener('click', function () {
      state.comment = $$('rv-comment').value.trim();

      if (state.status === S.APPROVED && !state.level) {
        UI.toast('warning', 'ยังเลือกระดับไม่ครบ', 'กรุณาเลือกระดับการรับรองก่อนบันทึก');
        return;
      }
      if (API.demoMode) {
        UI.toast('info', 'โหมดตัวอย่าง', 'ยังต่อ Google Sheet ไม่ได้ จึงบันทึกลงชีตจริงไม่ได้');
        return;
      }

      UI.loading('กำลังบันทึกผลการตรวจ...');
      API.post({
        action: 'updateStatus',
        sheet: r.sheet,
        row: r.row,
        status: state.status,
        level: state.level,          /* เดิมไม่เคยส่งค่านี้ ระดับจึงไม่ถูกบันทึก */
        comment: state.comment,
        reviewer: user.username || user.hospital
      })
        .then(function (res) {
          UI.close();
          if (res.status !== 'success') {
            UI.toast('error', 'บันทึกไม่สำเร็จ', res.message || 'ไม่ทราบสาเหตุ');
            return;
          }
          close();
          UI.toast('success', 'บันทึกเรียบร้อย',
            'อัปเดตเป็น "' + state.status + '"' + (state.level ? ' ระดับ ' + state.level : '') + ' แล้ว');
          load(false);
        })
        .catch(function (err) {
          UI.close();
          if (err && err.authError) return;

          /* ต่อเซิร์ฟเวอร์ไม่ได้ = ยังไม่ได้บันทึก ต้องบอกให้ชัดว่ากดใหม่ได้เลย
             และไม่ปิดป็อปอัพ เพื่อไม่ให้สิ่งที่เลือกไว้หายไป */
          Swal.fire({
            icon: 'error',
            title: err && err.networkError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' : 'บันทึกไม่สำเร็จ',
            html: '<p style="margin-bottom:10px">' + esc(err.message || '') + '</p>' +
                  (err && err.networkError
                    ? '<p style="font-size:13px;color:#64748B">ระบบลองส่งซ้ำให้แล้วแต่ยังไม่สำเร็จ ' +
                      'ตรวจสัญญาณอินเทอร์เน็ตแล้วกด "บันทึกผล" ใหม่อีกครั้ง</p>'
                    : '') +
                  '<p style="font-size:13px;color:#64748B;margin-top:10px">' +
                  'สิ่งที่เลือกไว้ยังอยู่ครบ ยังไม่มีอะไรถูกบันทึกลงชีต</p>',
            confirmButtonColor: '#0072CE'
          });
        });
    });
  }

  /* =========================================================
   *  เป้าหมาย KPI + สรุประดับผลการประเมิน
   *  ค่า KPI เก็บที่ Apps Script (Script Properties) ทุกคนจึงเห็นค่าเดียวกัน
   * ======================================================= */
  var settings = { kpi: { green: {}, occ: {} } };

  var WORK_META = {
    green: { key: 'green', word: 'หมวด',        label: 'งาน Green & Clean',                     color: '#3d6a00' },
    occ:   { key: 'occ',   word: 'องค์ประกอบ',  label: 'งานอาชีวอนามัยและเวชกรรมสิ่งแวดล้อม', color: '#EA580C' }
  };

  function loadSettings() {
    return API.get('getSettings', {})
      .then(function (res) {
        var d = (res && res.data) || {};
        settings.kpi = d.kpi || { green: {}, occ: {} };
      })
      .catch(function () { /* อ่านไม่ได้ก็ใช้ค่าว่าง ไม่ให้หน้าพัง */ });
  }

  /** ฟอร์มกรอกเป้าหมาย สร้างจากรายการระดับใน config จึงไม่มีทางหลุดจากกัน */
  function renderKpiForms() {
    var box = $('kpi-forms');
    if (!box) return;

    box.innerHTML = ['green', 'occ'].map(function (k) {
      var meta = WORK_META[k];
      var levels = CFG.LEVELS[k] || [];
      var saved = settings.kpi[k] || {};
      return '<div class="border border-outline-custom rounded-xl p-4">' +
        '<h4 class="font-bold mb-3" style="color:' + meta.color + '">' + esc(meta.label) + '</h4>' +
        '<div class="grid grid-cols-2 md:grid-cols-' + Math.min(levels.length, 4) + ' gap-3">' +
          levels.map(function (L) {
            return '<div class="space-y-1">' +
              '<label class="text-xs font-bold text-text-muted block text-center">' + esc(L) + '</label>' +
              '<div class="flex items-center gap-1">' +
                '<input type="number" min="0" max="100" step="1" ' +
                  'class="kpi-input w-full border border-outline-custom rounded-lg px-2 py-2 text-sm text-center" ' +
                  'data-work="' + k + '" data-level="' + esc(L) + '" ' +
                  'value="' + (saved[L] != null ? esc(saved[L]) : '') + '" placeholder="-">' +
                '<span class="text-xs text-text-muted">%</span>' +
              '</div></div>';
          }).join('') +
        '</div></div>';
    }).join('');
  }

  function bindKpi() {
    var btn = $('btn-save-kpi');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = { green: {}, occ: {} };
      document.querySelectorAll('.kpi-input').forEach(function (el) {
        var v = String(el.value).trim();
        if (v === '') return;
        var n = Number(v);
        if (isNaN(n) || n < 0 || n > 100) return;
        next[el.getAttribute('data-work')][el.getAttribute('data-level')] = n;
      });

      if (API.demoMode) {
        UI.toast('info', 'โหมดตัวอย่าง', 'ยังต่อ Google Sheet ไม่ได้ จึงบันทึกค่าจริงไม่ได้');
        return;
      }

      UI.loading('กำลังบันทึกเป้าหมาย KPI...');
      API.post({ action: 'saveSettings', settings: { kpi: next } })
        .then(function (res) {
          UI.close();
          if (res.status !== 'success') {
            UI.toast('error', 'บันทึกไม่สำเร็จ', res.message || '');
            return;
          }
          settings.kpi = next;
          UI.toast('success', 'บันทึกเรียบร้อย', 'เป้าหมาย KPI ถูกใช้คำนวณในแท็บสรุประดับผลแล้ว');
        })
        .catch(function (err) {
          UI.close();
          if (err && err.authError) return;
          UI.toast('error', 'เกิดข้อผิดพลาด', err.message);
        });
    });
  }

  /* ---------------------------------------------------------
   *  แท็บย่อย 3: สรุประดับผลการประเมินสะสมทั้งจังหวัด
   *  แผนภูมิที่ 1 = สัดส่วนรวมทุกระดับ
   *  แผนภูมิถัดไป = แต่ละระดับเทียบกับเป้าหมาย KPI
   * ------------------------------------------------------- */
  /** เสนอปีที่มีอยู่จริงเป็นตัวเลือกช่วยพิมพ์ แต่ผู้ใช้พิมพ์ปีอื่นเองได้ */
  function fillLevelYears() {
    var list = $('lv-year-list');
    if (!list) return;
    var years = {};
    allRows.forEach(function (r) { if (r.year) years[String(r.year).trim()] = 1; });
    list.innerHTML = Object.keys(years).sort().reverse().map(function (y) {
      return '<option value="' + esc(y) + '"></option>';
    }).join('');
  }

  function renderLevels() {
    var box = $('lv-charts');
    if (!box || !window.Viz) return;

    var k = view === 'occ' ? 'occ' : 'green';
    var meta = WORK_META[k];
    var levels = CFG.LEVELS[k] || [];
    var year = $('lv-year') ? String($('lv-year').value).trim() : '';

    $('lv-title').textContent = 'สรุประดับผลการประเมินสะสมทั้งจังหวัด — ' + meta.label;
    $('lv-title').style.color = meta.color;

    /* นับเฉพาะรายงานที่ผ่านการรับรองแล้ว 1 โรงพยาบาลนับครั้งเดียวต่อระดับ */
    var seen = {};
    var count = {};
    levels.forEach(function (L) { count[L] = 0; });

    allRows.forEach(function (r) {
      var isGreen = String(r.workType).indexOf('Green') !== -1;
      if ((k === 'green') !== isGreen) return;
      if (r.status !== S.APPROVED) return;
      if (year && String(r.year) !== year) return;
      if (levels.indexOf(r.level) === -1) return;
      var id = r.hospital + '|' + r.level;
      if (seen[id]) return;
      seen[id] = 1;
      count[r.level]++;
    });

    var total = levels.reduce(function (a, L) { return a + count[L]; }, 0);
    /* เดิมหารด้วยจำนวนหน่วยงานในทะเบียน ซึ่งไม่ตรงความจริง (จังหวัดมีมากกว่านั้น
       และแยกประเภทกันอีก) จึงเปลี่ยนมานับจากหน่วยงานที่ผ่านการรับรองจริงในชีต
       เป็นฐาน แล้วบอกให้ชัดว่าเทียบกับอะไร ไม่ไปอ้างตัวเลขทั้งจังหวัดที่ไม่รู้จริง */
    var denom = total || 1;

    /* --- แผนภูมิรวม --- */
    var items = levels.map(function (L) {
      return { label: L, count: count[L], pct: total ? count[L] * 100 / total : 0 };
    });

    var cards = ['<div class="bg-white border border-outline-custom rounded-2xl p-6 shadow-sm md:col-span-2">' +
      '<h4 class="font-bold text-tertiary font-headline mb-1">สัดส่วนระดับผลการประเมินสะสมทั้งจังหวัด</h4>' +
      '<p class="text-xs text-text-muted mb-5">รวมทุกระดับในกราฟเดียว นับจากหน่วยงานที่ผ่านการรับรองแล้ว' +
        (year ? ' ปี ' + esc(year) : '') + ' รวม ' + total + ' แห่ง</p>' +
      (total
        ? Viz.donut(items, { colors: Viz.LEVEL_COLORS, centerLabel: 'แห่ง' })
        : '<p class="text-sm text-text-muted">ยังไม่มีหน่วยงานที่ผ่านการรับรองในขอบเขตนี้</p>') +
      '</div>'];

    /* --- แผนภูมิรายระดับ เทียบเป้าหมาย KPI --- */
    var kpi = (settings.kpi && settings.kpi[k]) || {};
    levels.forEach(function (L) {
      var got = count[L];
      var pct = denom ? got * 100 / denom : 0;
      var target = kpi[L];
      var reach = (target != null && target > 0) ? Math.min(100, pct * 100 / target) : null;

      cards.push('<div class="bg-white border border-outline-custom rounded-2xl p-6 shadow-sm">' +
        '<h4 class="font-bold text-tertiary font-headline mb-1">' + esc(L) + '</h4>' +
        '<p class="text-xs text-text-muted mb-4"><b>' + got + ' แห่ง</b> — คิดเป็น ' + pct.toFixed(1) +
          '% ของหน่วยงานที่ผ่านการรับรองในงานนี้ (' + denom + ' แห่ง)</p>' +
        (target != null
          ? Viz.progress(pct, { color: Viz.LEVEL_COLORS[L] || meta.color, target: target }) +
            '<p class="text-xs mt-2 ' + (pct >= target ? 'text-green-700' : 'text-text-muted') + '">' +
              (pct >= target
                ? '▲ ถึงเป้าหมายแล้ว (เป้า ' + target + '%)'
                : 'ยังไม่ถึงเป้า — ทำได้ ' + reach.toFixed(0) + '% ของเป้าหมาย ' + target + '%') + '</p>'
          : '<p class="text-xs text-text-muted">ยังไม่ได้ตั้งเป้าหมาย KPI สำหรับระดับนี้ ' +
            '<span class="text-primary">(ตั้งได้ที่แท็บจัดการผู้ใช้งาน)</span></p>') +
      '</div>');
    });

    box.innerHTML = cards.join('');
  }


  /**
   * กราฟสัดส่วนระดับผลการรับรอง — ขึ้นเฉพาะตอนเลือกกล่อง "รับรองผลการประเมิน"
   * ข้อความข้างกราฟกดได้ เพื่อกรองตารางด้านล่างให้เหลือเฉพาะระดับนั้น
   */
  function renderApprovedChart() {
    var box = $('approved-chart');
    if (!box || !window.Viz) return;

    var on = $('f-status').value === S.APPROVED;
    box.classList.toggle('hidden', !on);
    if (!on) { levelFilter = ''; return; }

    /* กราฟต้องแสดงครบทุกระดับเสมอ จึงไม่สนตัวกรองระดับที่ผู้ใช้คลิกอยู่ */
    var rows = filtered({ ignoreStatus: true, ignoreLevel: true }).filter(function (r) {
      return r.status === S.APPROVED;
    });

    var k = view === 'occ' ? 'occ' : 'green';
    var levels = CFG.LEVELS[k] || [];

    /* หน่วยงานเดียวกันในระดับเดียวกัน นับครั้งเดียว */
    var seen = {}, count = {};
    levels.forEach(function (L) { count[L] = 0; });
    rows.forEach(function (r) {
      if (levels.indexOf(r.level) === -1) return;
      var id = r.hospital + '|' + r.level;
      if (seen[id]) return;
      seen[id] = 1;
      count[r.level]++;
    });

    var items = levels
      .map(function (L) { return { label: L, count: count[L] }; })
      .filter(function (x) { return x.count > 0; });

    $('approved-donut').innerHTML = items.length
      ? Viz.donut(items, {
          colors: Viz.LEVEL_COLORS, centerLabel: 'แห่ง', unit: 'แห่ง',
          clickable: true, emptyText: 'ยังไม่มีหน่วยงานที่ผ่านการรับรอง'
        })
      : '<p class="text-sm text-text-muted">ยังไม่มีหน่วยงานที่ผ่านการรับรองในขอบเขตนี้</p>';

    /* ผูกคลิกที่ข้อความข้างกราฟ */
    Array.prototype.forEach.call($('approved-donut').querySelectorAll('[data-slice]'), function (el) {
      el.addEventListener('click', function () {
        var L = el.getAttribute('data-slice');
        levelFilter = (levelFilter === L) ? '' : L;   /* คลิกซ้ำ = ยกเลิก */
        page = 1;
        render();
      });
      if (el.getAttribute('data-slice') === levelFilter) {
        el.style.background = '#EDE9FE';
        el.style.fontWeight = '700';
      }
    });

    var clear = $('approved-clear');
    clear.classList.toggle('hidden', !levelFilter);
    clear.onclick = function () { levelFilter = ''; page = 1; render(); };
  }

  /* =========================================================
   *  ส่งออก CSV (ตามตัวกรองปัจจุบัน)
   * ======================================================= */
  function exportCSV() {
    var rows = filtered();
    if (!rows.length) {
      UI.toast('warning', 'ไม่มีข้อมูลให้ส่งออก', '');
      return;
    }
    var head = ['วันที่ส่ง', 'ประเภทงาน', 'อำเภอ', 'รหัสโรงพยาบาล', 'โรงพยาบาล', 'ประเภทโรงพยาบาล',
                'ปีที่ประเมิน', 'ผู้ส่ง', 'เบอร์โทร', 'ระดับผลการประเมิน', 'หมวด/องค์ประกอบที่แก้ไข',
                'ข้อที่แก้ไข', 'รายละเอียดการปรับปรุงแก้ไข', 'ลิงก์หลักฐาน', 'สถานะการตรวจสอบ',
                'หมายเหตุ / ข้อเสนอแนะ'];
    var body = rows.map(function (r) {
      return [UI.thaiDate(r.submittedAt), r.workType, r.district, r.hospitalCode, r.hospital, r.hospType,
              r.year, r.senderName, r.phone, r.level, r.categories, r.items, r.detail, r.driveLink,
              r.status, r.comment];
    });
    UI.downloadCSV('รายการติดตามงาน_' + new Date().toISOString().slice(0, 10) + '.csv', [head].concat(body));
  }

  /* =========================================================
   *  จัดการผู้ใช้งาน
   * ======================================================= */
  function bindUsers() {
    $('btn-add-user').addEventListener('click', function () { openUserForm(null); });
  }

  function loadUsers() {
    var body = $('users-body');
    body.innerHTML = '<tr><td colspan="5" class="py-10 text-center text-text-muted">กำลังโหลด...</td></tr>';

    API.getOrDemo('getUsers', {}, window.DEMO.users)
      .then(function (res) {
        var users = (res && res.data) || [];
        if (!users.length) {
          body.innerHTML = '<tr><td colspan="5" class="py-10 text-center text-text-muted">ยังไม่มีผู้ใช้งาน</td></tr>';
          return;
        }
        body.innerHTML = users.map(function (u) {
          var badge = u.role === 'admin'
            ? '<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-light text-primary border border-primary/30">ผู้ดูแลระบบ</span>'
            : '<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-text-muted border border-outline-custom">โรงพยาบาล</span>';
          return '<tr class="hover:bg-primary-light/30">' +
            '<td class="py-3 px-4">' + esc(u.district || '-') + '</td>' +
            '<td class="py-3 px-4">' + esc(u.type || '-') + '</td>' +
            '<td class="py-3 px-4 font-semibold">' + esc(u.hospital) + '</td>' +
            '<td class="py-3 px-4">' + badge + '</td>' +
            '<td class="py-3 px-4 text-right whitespace-nowrap">' +
              '<button class="btn-edit-user text-primary hover:underline font-semibold text-xs mr-3" data-row="' + u.row + '">แก้ไข</button>' +
              '<button class="btn-del-user text-red-500 hover:underline font-semibold text-xs" data-row="' + u.row + '">ลบ</button>' +
            '</td></tr>';
        }).join('');

        Array.prototype.forEach.call(body.querySelectorAll('.btn-edit-user'), function (b) {
          b.addEventListener('click', function () {
            openUserForm(users.filter(function (u) { return String(u.row) === b.getAttribute('data-row'); })[0]);
          });
        });
        Array.prototype.forEach.call(body.querySelectorAll('.btn-del-user'), function (b) {
          b.addEventListener('click', function () {
            var u = users.filter(function (x) { return String(x.row) === b.getAttribute('data-row'); })[0];
            confirmDeleteUser(u);
          });
        });
      })
      .catch(function (err) {
        body.innerHTML = '<tr><td colspan="5" class="py-10 text-center text-red-500">โหลดไม่สำเร็จ: ' + esc(err.message) + '</td></tr>';
      });
  }

  function openUserForm(u) {
    var v = function (k) { return u && u[k] ? esc(u[k]) : ''; };
    var input = function (id, label, value, type) {
      return '<label class="block font-semibold mb-1 mt-3">' + label + '</label>' +
             '<input id="' + id + '" type="' + (type || 'text') + '" class="swal2-input" style="display:block;width:100%;margin:0" value="' + value + '">';
    };

    Swal.fire({
      title: u ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งานใหม่',
      width: 560,
      confirmButtonText: 'บันทึก',
      confirmButtonColor: '#0072CE',
      showCancelButton: true,
      cancelButtonText: 'ยกเลิก',
      html:
        '<div class="text-left text-sm" style="font-family:Sarabun,sans-serif">' +
          input('u-district', 'อำเภอ', v('district')) +
          input('u-type', 'ประเภทโรงพยาบาล', v('type')) +
          input('u-hospital', 'ชื่อโรงพยาบาล / หน่วยงาน (ใช้เป็นชื่อผู้ใช้)', v('hospital')) +
          input('u-password', 'รหัสผ่าน', u ? '' : '', 'text') +
          '<p class="text-xs" style="color:#64748B;margin-top:4px">' +
            (u ? 'เว้นว่างไว้ = ไม่เปลี่ยนรหัสผ่านเดิม' : 'ตั้งรหัสผ่านสำหรับเข้าสู่ระบบ') + '</p>' +
          '<label class="block font-semibold mb-1 mt-3">สิทธิ์การใช้งาน</label>' +
          '<select id="u-role" class="swal2-select" style="display:block;width:100%;margin:0">' +
            '<option value="user"' + (u && u.role !== 'admin' ? ' selected' : '') + '>โรงพยาบาล (user)</option>' +
            '<option value="admin"' + (u && u.role === 'admin' ? ' selected' : '') + '>ผู้ดูแลระบบ สสจ. (admin)</option>' +
          '</select>' +
        '</div>',
      preConfirm: function () {
        var hospital = document.getElementById('u-hospital').value.trim();
        if (!hospital) {
          Swal.showValidationMessage('กรุณากรอกชื่อโรงพยาบาล/หน่วยงาน');
          return false;
        }
        var pwd = document.getElementById('u-password').value.trim();
        if (!u && !pwd) {
          Swal.showValidationMessage('กรุณาตั้งรหัสผ่าน');
          return false;
        }
        return {
          action: 'saveUser',
          row: u ? u.row : '',
          district: document.getElementById('u-district').value.trim(),
          type: document.getElementById('u-type').value.trim(),
          hospital: hospital,
          /* เว้นว่าง = คงรหัสเดิม ฝั่ง Apps Script อ่านของเดิมจากชีตให้เอง
             หน้าเว็บจึงไม่ต้องรู้รหัสผ่านของใครเลย */
          password: pwd,
          role: document.getElementById('u-role').value
        };
      }
    }).then(function (result) {
      if (!result.isConfirmed) return;
      if (API.demoMode) {
        UI.toast('info', 'โหมดตัวอย่าง', 'ยังต่อ Google Sheet ไม่ได้ จึงบันทึกจริงไม่ได้');
        return;
      }
      UI.loading('กำลังบันทึก...');
      API.post(result.value)
        .then(function (res) {
          UI.close();
          UI.toast(res.status === 'success' ? 'success' : 'error',
                   res.status === 'success' ? 'สำเร็จ' : 'ไม่สำเร็จ', res.message || '');
          if (res.status === 'success') loadUsers();
        })
        .catch(function (err) { UI.close(); UI.toast('error', 'เกิดข้อผิดพลาด', err.message); });
    });
  }

  function confirmDeleteUser(u) {
    if (!u) return;
    Swal.fire({
      icon: 'warning',
      title: 'ลบผู้ใช้งาน?',
      text: 'ต้องการลบ "' + u.hospital + '" ออกจากชีตใช่หรือไม่',
      showCancelButton: true,
      confirmButtonText: 'ลบ',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#d33'
    }).then(function (r) {
      if (!r.isConfirmed) return;
      if (API.demoMode) {
        UI.toast('info', 'โหมดตัวอย่าง', 'ยังต่อ Google Sheet ไม่ได้ จึงลบจริงไม่ได้');
        return;
      }
      UI.loading('กำลังลบ...');
      API.post({ action: 'deleteUser', row: u.row })
        .then(function (res) {
          UI.close();
          UI.toast(res.status === 'success' ? 'success' : 'error', res.message || '', '');
          if (res.status === 'success') loadUsers();
        })
        .catch(function (err) { UI.close(); UI.toast('error', 'เกิดข้อผิดพลาด', err.message); });
    });
  }
})();
