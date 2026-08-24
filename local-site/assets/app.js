/*  แกนกลางของระบบ: คุยกับ Google Apps Script + จัดการสิทธิ์ผู้ใช้
 *  ทุกหน้า (index / hospital / admin) เรียกใช้ไฟล์นี้ร่วมกัน
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};

  /* ---------------------------------------------------------
   *  ชั้นเชื่อมต่อ API
   *  หมายเหตุสำคัญ: POST ต้อง "ไม่" ใส่ header Content-Type
   *  เพราะจะทำให้เบราว์เซอร์ยิง preflight (OPTIONS) ซึ่ง Apps Script
   *  ไม่รองรับ → จะติด CORS. ส่งเป็น body string เฉย ๆ ถึงจะอ่านคำตอบได้
   * ------------------------------------------------------- */
  var API = {
    demoMode: false,

    /** token ที่ได้ตอนล็อกอิน — ทุกคำสั่งต้องแนบไป ไม่งั้น Apps Script ปฏิเสธ */
    token: function () {
      var u = Auth.get();
      return (u && u.token) || '';
    },

    url: function (action, params) {
      var u = CFG.API_URL + '?action=' + encodeURIComponent(action);
      var tk = API.token();
      if (tk) u += '&token=' + encodeURIComponent(tk);
      Object.keys(params || {}).forEach(function (k) {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
          u += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }
      });
      return u;
    },

    /**
     * เซสชันหมดอายุ หรือถูกปฏิเสธสิทธิ์ → ล้างข้อมูลแล้วเด้งไปล็อกอินใหม่
     * ทำที่ชั้นนี้ที่เดียว ทุกหน้าจึงได้พฤติกรรมเดียวกันโดยไม่ต้องเขียนซ้ำ
     */
    guard: function (res) {
      if (res && res.status === 'error' &&
          (res.code === 'AUTH_REQUIRED' || res.code === 'FORBIDDEN')) {
        Auth.clear();
        if (window.Swal) {
          Swal.fire({
            icon: 'warning',
            title: res.code === 'FORBIDDEN' ? 'ไม่มีสิทธิ์ใช้งาน' : 'เซสชันหมดอายุ',
            text: res.message || 'กรุณาเข้าสู่ระบบใหม่',
            confirmButtonColor: '#0072CE'
          }).then(function () { window.location.replace('./index.html'); });
        } else {
          window.location.replace('./index.html');
        }
        var e = new Error(res.message || 'ต้องเข้าสู่ระบบใหม่');
        e.authError = true;
        throw e;
      }
      return res;
    },

    get: function (action, params) {
      return fetch(API.url(action, params), { method: 'GET', redirect: 'follow' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(API.guard);
    },

    post: function (payload) {
      var body = {};
      Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
      var tk = API.token();
      if (tk) body.token = tk;

      return fetch(CFG.API_URL, {
        method: 'POST',
        redirect: 'follow',
        body: JSON.stringify(body)   // ตั้งใจไม่ใส่ headers — ดูหมายเหตุด้านบน
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(API.guard);
    },

    /** GET ที่มีข้อมูลตัวอย่างสำรอง เอาไว้ดูหน้าเว็บตอนยังไม่ได้ deploy */
    getOrDemo: function (action, params, demoValue) {
      return API.get(action, params).catch(function (err) {
        /* ปัญหาเรื่องสิทธิ์ต้องเด้งไปล็อกอิน ห้ามกลบด้วยข้อมูลตัวอย่าง
           ส่วนปัญหาเชื่อมต่อ (ยังไม่ได้ deploy) ยังใช้ข้อมูลตัวอย่างได้เหมือนเดิม
           หน้าล็อกอินเรียก getDropdowns ตอนยังไม่มี token จึงต้องผ่านทางนี้ได้ */
        if (err && err.authError) throw err;
        if (!CFG.ALLOW_DEMO_FALLBACK) throw err;
        console.warn('[demo] ต่อ API ไม่ได้ (' + action + '):', err.message);
        API.demoMode = true;
        UI.showDemoBanner();
        return demoValue;
      });
    }
  };

  /* ---------------------------------------------------------
   *  สิทธิ์ผู้ใช้ — เก็บใน localStorage หลัง login สำเร็จ
   *  index.html = ไม่ต้องล็อกอิน
   *  hospital.html = ต้องเป็น role 'user'
   *  admin.html = ต้องเป็น role 'admin' เท่านั้น
   * ------------------------------------------------------- */
  var Auth = {
    KEY: 'currentUser',

    get: function () {
      try { return JSON.parse(localStorage.getItem(Auth.KEY)); }
      catch (e) { return null; }
    },

    set: function (user) {
      localStorage.setItem(Auth.KEY, JSON.stringify(user));
    },

    clear: function () {
      localStorage.removeItem(Auth.KEY);
    },

    /** กันคนเดินเข้าหน้าตรง ๆ โดยไม่ล็อกอิน / ผิดสิทธิ์ */
    require: function (role) {
      var u = Auth.get();
      if (!u) {
        window.location.replace('./index.html');
        return null;
      }
      if (role && u.role !== role) {
        // ล็อกอินอยู่ แต่ผิดหน้า → เด้งไปหน้าที่ถูกต้องของสิทธิ์ตัวเอง
        window.location.replace(u.role === 'admin' ? './admin.html' : './hospital.html');
        return null;
      }
      return u;
    },

    logout: function () {
      var doLogout = function () {
        Auth.clear();
        window.location.replace('./index.html');
      };
      if (window.Swal) {
        Swal.fire({
          title: 'ยืนยันการออกจากระบบ?',
          text: 'คุณต้องการออกจากระบบใช่หรือไม่',
          icon: 'question',
          showCancelButton: true,
          confirmButtonColor: '#0072CE',
          cancelButtonColor: '#d33',
          confirmButtonText: 'ออกจากระบบ',
          cancelButtonText: 'ยกเลิก'
        }).then(function (r) { if (r.isConfirmed) doLogout(); });
      } else if (confirm('ออกจากระบบ?')) {
        doLogout();
      }
    }
  };

  /* ---------------------------------------------------------
   *  ตัวช่วยหน้าจอ
   * ------------------------------------------------------- */
  var UI = {
    showDemoBanner: function () {
      if (document.getElementById('demo-banner')) return;
      var bar = document.createElement('div');
      bar.id = 'demo-banner';
      bar.style.cssText =
        'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#B45309;color:#fff;' +
        'font-family:Sarabun,sans-serif;font-size:13px;padding:10px 16px;text-align:center;' +
        'box-shadow:0 -2px 10px rgba(0,0,0,.15)';
      bar.innerHTML =
        '⚠️ <strong>โหมดตัวอย่าง</strong> — ยังเชื่อมต่อ Google Sheet ไม่ได้ ข้อมูลที่เห็นเป็นข้อมูลจำลอง ' +
        '(แก้ URL ได้ที่ <code>assets/config.js</code>) ' +
        '<button onclick="this.parentNode.remove()" style="margin-left:10px;text-decoration:underline">ปิด</button>';
      document.body.appendChild(bar);
    },

    /** วันที่แบบไทย เช่น 15 ต.ค. 2567 */
    thaiDate: function (iso) {
      if (!iso) return '-';
      var d = new Date(iso);
      if (isNaN(d)) return String(iso);
      var m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      return d.getDate() + ' ' + m[d.getMonth()] + ' ' + (d.getFullYear() + 543);
    },

    /** กัน XSS เวลาเอาข้อความจากชีตมาใส่ innerHTML */
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },

    /** สี + ไอคอนของแต่ละสถานะ ใช้ร่วมกันทั้ง 2 หน้า */
    statusStyle: function (status) {
      var S = CFG.STATUS;
      switch (status) {
        case S.APPROVED: return { cls: 'bg-green-500/10 text-green-700 border-green-500/30', icon: 'workspace_premium' };
        case S.CHECKING: return { cls: 'bg-blue-500/10 text-blue-700 border-blue-500/30',   icon: 'fact_check' };
        case S.REVISE:   return { cls: 'bg-red-500/10 text-red-600 border-red-500/30',      icon: 'warning' };
        default:         return { cls: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30', icon: 'hourglass_empty' };
      }
    },

    statusBadge: function (status) {
      var st = UI.statusStyle(status);
      return '<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border ' +
             st.cls + '"><span class="material-symbols-outlined text-[14px]">' + st.icon + '</span>' +
             UI.esc(status || CFG.STATUS.PENDING) + '</span>';
    },

    toast: function (icon, title, text) {
      if (window.Swal) Swal.fire({ icon: icon, title: title, text: text, confirmButtonColor: '#0072CE' });
      else alert(title + '\n' + (text || ''));
    },

    loading: function (title) {
      if (window.Swal) Swal.fire({ title: title || 'กำลังโหลด...', allowOutsideClick: false, didOpen: function () { Swal.showLoading(); } });
    },

    close: function () { if (window.Swal) Swal.close(); },

    /** ดาวน์โหลดตารางเป็นไฟล์ CSV (เปิดด้วย Excel ได้ ภาษาไทยไม่เพี้ยน) */
    downloadCSV: function (filename, rows) {
      var csv = rows.map(function (r) {
        return r.map(function (c) {
          var v = String(c == null ? '' : c);
          return '"' + v.replace(/"/g, '""') + '"';
        }).join(',');
      }).join('\r\n');
      var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  window.API = API;
  window.Auth = Auth;
  window.UI = UI;
})();
