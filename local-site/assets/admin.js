/*  หน้าผู้ดูแลระบบ (admin.html) — สิทธิ์ 'admin' เท่านั้น
 *  ดึงรายการส่งงานจาก Google Sheet → กรอง → ตรวจงาน → เขียนสถานะกลับเข้าชีต
 */
(function () {
  'use strict';

  var S = window.APP_CONFIG.STATUS;
  var user = null;
  var allRows = [];       // ข้อมูลดิบทั้งหมดจากชีต
  var view = 'all';       // all | green | occ | users
  var pane = 'table';     // table | dashboard
  var registryRows = [];  // ทะเบียนหน่วยงานทั้งจังหวัด (ใช้คำนวณความครอบคลุม)
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

    $('btn-logout').addEventListener('click', function (e) { e.preventDefault(); Auth.logout(); });
    $('btn-sync').addEventListener('click', function () { load(true); });

    load(false);
    loadRegistry();
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
        $('pane-table').classList.toggle('hidden', pane !== 'table');
        $('pane-dashboard').classList.toggle('hidden', pane !== 'dashboard');
        render();
      });
    });
  }

  /* =========================================================
   *  ทะเบียนหน่วยงานทั้งจังหวัด — ใช้เป็นตัวหารของ "ความครอบคลุม"
   *  ถ้าไม่มีชีตทะเบียน จะถอยไปใช้รายชื่อในชีต Login แทน
   * ======================================================= */
  function loadRegistry() {
    API.get('getRegistry', {})
      .then(function (res) {
        registryRows = (res && res.data) || [];
        if (!registryRows.length) return loadRegistryFromUsers();
        renderDashboard();
      })
      .catch(loadRegistryFromUsers);
  }

  function loadRegistryFromUsers() {
    return API.getOrDemo('getUsers', {}, window.DEMO.users)
      .then(function (res) {
        registryRows = ((res && res.data) || [])
          .filter(function (u) { return u.role !== 'admin'; })
          .map(function (u) {
            return { hospital: u.hospital, district: u.district, hospType: u.type };
          });
        renderDashboard();
      })
      .catch(function () { /* ไม่มีทะเบียนก็ยังใช้แดชบอร์ดได้ แค่ไม่มีตัวหาร */ });
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

        var isUsers = view === 'users';
        $('view-submissions').classList.toggle('hidden', isUsers);
        $('view-users').classList.toggle('hidden', !isUsers);

        $('page-title').textContent =
          view === 'green' ? 'ติดตามงาน Green & Clean Hospital' :
          view === 'occ'   ? 'ติดตามงานอาชีวอนามัยและเวชกรรมสิ่งแวดล้อม' :
                             'ภาพรวมการติดตามทั้งหมด';

        if (isUsers) loadUsers(); else render();
      });
    });
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
        $('f-status').value = st;
        setActiveCard(st);
        page = 1;
        render();
      });
    });
  }

  function setActiveCard(status) {
    document.querySelectorAll('.stat-card').forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-status') === status);
    });
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

    renderDashboard();

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

    var rows = filtered({ ignoreStatus: true });
    var st = Stats.status(rows);

    $('dash-scope').textContent = scopeText() + ' • ' + rows.length + ' รายการ';

    renderKPI(rows, st);

    $('dash-cat').innerHTML = Viz.hbars(Stats.freqMulti(rows, 'categories', 5), {
      unit: 'ครั้ง', maxLen: 58,
      emptyText: 'ยังไม่มีรายการส่งแก้ไขในขอบเขตนี้'
    });

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

  /** ตัวหารของความครอบคลุม: หน่วยงานในทะเบียนที่เข้าเงื่อนไขตัวกรองเดียวกัน */
  function registryDenominator() {
    var d = $('f-district').value, t = $('f-hosptype').value;
    return registryRows.filter(function (r) {
      if (d && String(r.district || '').trim() !== d) return false;
      if (t && String(r.hospType || '').trim() !== t) return false;
      return true;
    }).length;
  }

  function renderKPI(rows, st) {
    var submitted = Stats.uniqueCount(rows, 'hospital');
    var denom = registryDenominator();
    var coverage = denom ? submitted * 100 / denom : 0;

    $('dash-kpi').innerHTML = [
      Viz.kpi({
        label: 'รายการส่งงานทั้งหมด', icon: 'inbox', color: '#0A2540',
        value: st.total.toLocaleString('th-TH'),
        sub: 'จาก ' + submitted + ' หน่วยงานที่ส่งเข้ามา'
      }),
      Viz.kpi({
        label: 'อัตราการรับรองผล', icon: 'workspace_premium', color: '#16A34A',
        value: st.approvedPct.toFixed(1) + '%',
        sub: 'รับรองแล้ว ' + st.approved + ' จาก ' + st.total + ' รายการ',
        bar: st.approvedPct, target: 100
      }),
      Viz.kpi({
        label: 'ค้างดำเนินการ', icon: 'pending_actions', color: '#EAB308',
        value: st.outstanding.toLocaleString('th-TH'),
        sub: 'รอตรวจ ' + st.pending + ' • ตรวจแล้ว ' + st.checking + ' • ต้องแก้ไข ' + st.revise
      }),
      denom
        ? Viz.kpi({
            label: 'ความครอบคลุมของหน่วยงาน', icon: 'domain', color: '#0072CE',
            value: coverage.toFixed(1) + '%',
            sub: 'ส่งรายงานแล้ว ' + submitted + ' จาก ' + denom + ' แห่งในทะเบียน',
            bar: coverage, target: 100
          })
        : Viz.kpi({
            label: 'หน่วยงานที่ส่งรายงาน', icon: 'domain', color: '#0072CE',
            value: submitted.toLocaleString('th-TH'),
            sub: 'ยังไม่มีทะเบียนหน่วยงานให้เทียบเป็นเปอร์เซ็นต์'
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

  function openReview(r) {
    var opt = function (v) {
      return '<option value="' + esc(v) + '"' + (r.status === v ? ' selected' : '') + '>' + esc(v) + '</option>';
    };
    var info = function (label, value) {
      return '<div><dt class="text-text-muted">' + label + '</dt>' +
             '<dd class="font-semibold text-text-main">' + esc(value || '-') + '</dd></div>';
    };

    Swal.fire({
      title: 'ตรวจงาน: ' + r.hospital,
      width: 720,
      confirmButtonText: 'บันทึกผลการตรวจ',
      confirmButtonColor: '#0072CE',
      showCancelButton: true,
      cancelButtonText: 'ปิด',
      html:
        '<div class="text-left text-sm" style="font-family:Sarabun,sans-serif">' +
          '<dl class="grid grid-cols-2 gap-3 mb-4">' +
            info('อำเภอ', r.district) +
            info('รหัสโรงพยาบาล', r.hospitalCode) +
            info('ประเภทโรงพยาบาล', r.hospType) +
            info('ประเภทงาน', r.workType) +
            info('ปีที่ประเมิน', r.year) +
            info('ผู้ส่ง', r.senderName) +
            info('เบอร์โทรศัพท์', r.phone) +
            info('ระดับที่ขอรับรอง', r.level) +
            info('วันที่ส่ง', UI.thaiDate(r.submittedAt)) +
          '</dl>' +
          '<div class="mb-3"><div class="text-text-muted">หมวดที่แก้ไข</div>' +
            '<div class="font-semibold">' + esc(r.categories || '-') + '</div></div>' +
          '<div class="mb-3"><div class="text-text-muted">ข้อที่แก้ไข</div>' +
            '<div class="font-semibold">' + esc(r.items || '-') + '</div></div>' +
          '<div class="mb-3"><div class="text-text-muted">รายละเอียดการปรับปรุงแก้ไข</div>' +
            '<div class="font-semibold" style="white-space:pre-line">' + esc(r.detail || '-') + '</div></div>' +
          '<div class="mb-4"><div class="text-text-muted">หลักฐานประกอบ</div>' +
            (r.driveLink
              ? '<a href="' + esc(r.driveLink) + '" target="_blank" rel="noopener" style="color:#0072CE;text-decoration:underline">เปิดลิงก์ Google Drive</a>'
              : '<span>ไม่ได้แนบลิงก์</span>') + '</div>' +
          '<hr class="my-4">' +
          '<label class="block font-semibold mb-1">ผลการตรวจ</label>' +
          '<select id="sw-status" class="swal2-select" style="display:block;width:100%;margin:0 0 12px">' +
            opt(S.PENDING) + opt(S.CHECKING) + opt(S.REVISE) + opt(S.APPROVED) +
          '</select>' +
          '<label class="block font-semibold mb-1">ความเห็น / ข้อแนะนำถึงโรงพยาบาล</label>' +
          '<textarea id="sw-comment" class="swal2-textarea" style="display:block;width:100%;margin:0" rows="3" ' +
            'placeholder="เช่น กรุณาแนบผลตรวจคุณภาพน้ำทิ้งย้อนหลัง 3 เดือน">' + esc(stripSignature(r.comment)) + '</textarea>' +
        '</div>',
      preConfirm: function () {
        return {
          status: document.getElementById('sw-status').value,
          comment: document.getElementById('sw-comment').value.trim()
        };
      }
    }).then(function (result) {
      if (!result.isConfirmed) return;

      if (API.demoMode) {
        UI.toast('info', 'โหมดตัวอย่าง', 'ยังต่อ Google Sheet ไม่ได้ จึงบันทึกลงชีตจริงไม่ได้');
        return;
      }

      UI.loading('กำลังบันทึกผลการตรวจ...');
      API.post({
        action: 'updateStatus',
        sheet: r.sheet,
        row: r.row,
        status: result.value.status,
        comment: result.value.comment,
        reviewer: user.username || user.hospital
      })
        .then(function (res) {
          UI.close();
          if (res.status !== 'success') {
            UI.toast('error', 'บันทึกไม่สำเร็จ', res.message || '');
            return;
          }
          UI.toast('success', 'บันทึกเรียบร้อย', 'อัปเดตสถานะใน Google Sheet แล้ว');
          load(false);
        })
        .catch(function (err) {
          UI.close();
          UI.toast('error', 'เกิดข้อผิดพลาด', err.message);
        });
    });
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
