/*  ตัวช่วยฝั่งจอเล็ก — ใช้คู่กับ assets/responsive.css
 *  ทำสามอย่าง ไม่ยุ่งกับตรรกะเดิมของระบบเลย
 *    1) เมนูข้าง → ลิ้นชักเปิด/ปิดด้วยปุ่มขีดสามขีด
 *    2) คัดลอกชื่อผู้ใช้จากแถบหัวเรื่องมาไว้ในลิ้นชัก (บนมือถือหัวเรื่องซ่อนไว้)
 *    3) เติม data-label ให้ทุกช่องในตาราง เพื่อให้ CSS จับแปลงเป็นการ์ดได้
 *       — อ่านหัวคอลัมน์จาก <thead> สด ๆ ทุกครั้งที่ตารางถูกวาดใหม่
 *         เพิ่ม/ลด/เปลี่ยนชื่อคอลัมน์ในอนาคตจึงไม่ต้องมาแก้ไฟล์นี้ตาม
 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* =========================================================
   *  1) ลิ้นชักเมนู
   * ======================================================= */
  function setupDrawer() {
    var nav = document.getElementById('side-nav');
    var btn = document.getElementById('btn-menu');
    if (!nav || !btn) return;

    var backdrop = document.createElement('div');
    backdrop.id = 'nav-backdrop';
    document.body.appendChild(backdrop);

    function open() {
      nav.classList.add('is-open');
      backdrop.classList.add('is-open');
      document.body.classList.add('nav-open');
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      nav.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      document.body.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    }
    function toggle() {
      if (nav.classList.contains('is-open')) close(); else open();
    }

    btn.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
    backdrop.addEventListener('click', close);

    /* กดเมนูอันไหนก็ปิดลิ้นชักให้เอง จะได้เห็นเนื้อหาที่เพิ่งเลือกทันที
       ใช้ช่วงหลังฟองสัญญาณ (bubble) ตัวจัดการเดิมของหน้าจึงได้ทำงานก่อน */
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    /* หมุนจอเป็นแนวนอนจนกว้างพอจะโชว์เมนูข้างถาวร ต้องล้างสถานะลิ้นชักทิ้ง
       ไม่งั้น body ยังโดนล็อกไม่ให้เลื่อนค้างอยู่ */
    var wide = window.matchMedia('(min-width: 768px)');
    var onWide = function (e) { if (e.matches) close(); };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
    else if (wide.addListener) wide.addListener(onWide);
  }

  /* =========================================================
   *  2) ชื่อผู้ใช้ในลิ้นชัก (ตามค่าจริงบนแถบหัวเรื่องตลอดเวลา)
   * ======================================================= */
  function mirrorText(srcId, dstId) {
    var src = document.getElementById(srcId);
    var dst = document.getElementById(dstId);
    if (!src || !dst) return;

    var copy = function () { dst.textContent = src.textContent; };
    copy();
    new MutationObserver(copy).observe(src, {
      childList: true, characterData: true, subtree: true
    });
  }

  /* =========================================================
   *  3) ตาราง → การ์ด
   * ======================================================= */

  /** อ่านชื่อคอลัมน์จากแถวหัวตาราง (เอาแถวสุดท้ายของ thead เผื่อมีหัวซ้อนชั้น) */
  function headerLabels(table) {
    var rows = table.tHead ? table.tHead.rows : null;
    if (!rows || !rows.length) return null;

    var cells = rows[rows.length - 1].cells;
    var out = [], i;
    for (i = 0; i < cells.length; i++) {
      out.push(cells[i].textContent.replace(/\s+/g, ' ').trim());
    }
    return out;
  }

  /** เติม data-label ให้ทุก td ในตาราง — ข้าม td ที่ตั้ง colspan ไว้ (แถวสถานะ) */
  function stampLabels(table) {
    /* อ่านหัวตารางใหม่ทุกครั้ง ไม่จำค่าไว้ เผื่อวันหน้ามีหน้าไหนสลับหัวคอลัมน์ */
    var labels = headerLabels(table);
    if (!labels || !labels.length) return;

    Array.prototype.forEach.call(table.tBodies, function (tbody) {
      Array.prototype.forEach.call(tbody.rows, function (tr) {
        var col = 0;
        Array.prototype.forEach.call(tr.cells, function (td) {
          var span = parseInt(td.getAttribute('colspan') || '1', 10) || 1;
          if (span === 1 && labels[col] != null) {
            td.setAttribute('data-label', labels[col]);
          }
          col += span;
        });
      });
    });
  }

  function setupTables() {
    Array.prototype.forEach.call(document.querySelectorAll('table'), function (table) {
      if (!headerLabels(table)) return;      /* ไม่มีหัวตาราง = แปลงเป็นการ์ดไม่ได้ */
      table.classList.add('rwd-card');
      stampLabels(table);

      /* ตารางเกือบทุกใบถูกวาดใหม่ด้วย innerHTML หลังโหลดข้อมูลจากชีต
         จึงต้องเฝ้าดู tbody แล้วเติมป้ายกำกับให้แถวชุดใหม่ทุกครั้ง */
      Array.prototype.forEach.call(table.tBodies, function (tbody) {
        new MutationObserver(function () { stampLabels(table); })
          .observe(tbody, { childList: true });
      });
    });
  }

  /* =========================================================
   *  เริ่มทำงาน
   * ======================================================= */
  ready(function () {
    setupDrawer();
    mirrorText('user-display-name', 'nav-user-name');
    mirrorText('user-display-hosp', 'nav-user-hosp');
    setupTables();

    /* ปุ่ม "ซิงค์ข้อมูล" บนหัวเรื่องถูกซ่อนบนจอเล็ก ตัวในลิ้นชักจึงยิงต่อให้ */
    var syncM = document.getElementById('btn-sync-m');
    var sync = document.getElementById('btn-sync');
    if (syncM && sync) {
      syncM.addEventListener('click', function (e) { e.preventDefault(); sync.click(); });
    }
  });
})();
