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

    /**
     * ยิง fetch พร้อมกำหนดเวลารอสูงสุด
     * ถ้าเกินเวลาจะโยน error ที่บอกสาเหตุชัด ๆ แทนที่จะค้างรอไปเรื่อย ๆ
     */
    fetchWithTimeout: function (url, opts, ms) {
      var limit = ms || CFG.TIMEOUT_MS || 45000;

      /* เบราว์เซอร์เก่าที่ไม่มี AbortController ก็ยังใช้งานได้ เพียงไม่มี timeout */
      if (typeof AbortController === 'undefined') return fetch(url, opts);

      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, limit);
      opts = opts || {};
      opts.signal = ctrl.signal;

      return fetch(url, opts)
        .then(function (r) { clearTimeout(timer); return r; })
        .catch(function (err) {
          clearTimeout(timer);
          if (err && err.name === 'AbortError') {
            throw new Error('เซิร์ฟเวอร์ไม่ตอบกลับภายใน ' + Math.round(limit / 1000) + ' วินาที');
          }
          throw err;
        });
    },

    get: function (action, params) {
      return API.fetchWithTimeout(API.url(action, params), { method: 'GET', redirect: 'follow' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(API.guard);
    },

    /**
     * error ระดับเครือข่าย: fetch โยน TypeError โดยข้อความต่างกันไปตามเบราว์เซอร์
     * Safari = "Load failed" / Chrome = "Failed to fetch" / Firefox = "NetworkError..."
     * แปลว่าคำขอไปไม่ถึงเซิร์ฟเวอร์ ไม่ใช่เซิร์ฟเวอร์ตอบว่าผิด
     */
    isNetworkError: function (err) {
      var m = String((err && err.message) || err);
      return /Load failed|Failed to fetch|NetworkError|network error/i.test(m);
    },

    /** opts.timeout = กำหนดเวลารอเองได้ (ใช้ตอนแนบไฟล์ซึ่งนานกว่าปกติ) */
    post: function (payload, opts) {
      var body = {};
      Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
      var tk = API.token();
      if (tk) body.token = tk;

      var send = function () {
        return API.fetchWithTimeout(CFG.API_URL, {
          method: 'POST',
          redirect: 'follow',
          body: JSON.stringify(body)   // ตั้งใจไม่ใส่ headers — ดูหมายเหตุด้านบน
        }, opts && opts.timeout).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
      };

      /* ทางสำรอง: ส่งคำสั่งเดิมผ่าน GET
         POST ของ Apps Script ถูก redirect ข้ามโดเมนก่อนถึงปลายทาง บางเบราว์เซอร์
         (Safari เป็นหลัก) บล็อกจังหวะนั้นแล้วขึ้น "Load failed" ทั้งที่ GET ใช้ได้ปกติ
         ใช้ได้เฉพาะคำขอที่สั้นพอ — แนบไฟล์ base64 จะยาวเกินความยาว URL ที่รับได้ */
      var viaGet = function () {
        var json = JSON.stringify(body);
        if (json.length > 6000) throw new Error('ข้อมูลยาวเกินกว่าจะส่งด้วยวิธีสำรองได้');
        return API.fetchWithTimeout(
          CFG.API_URL + '?action=' + encodeURIComponent(body.action || '') +
          '&payload=' + encodeURIComponent(json),
          { method: 'GET', redirect: 'follow' },
          opts && opts.timeout
        ).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
      };

      return send()
        .catch(function (err) {
          /* ลองซ้ำหนึ่งครั้งก่อน เผื่อเป็นแค่เน็ตสะดุดชั่วคราว */
          if (!API.isNetworkError(err)) throw err;
          console.warn('[API] POST ล้มระดับเครือข่าย กำลังลองใหม่:', err.message);
          return new Promise(function (ok) { setTimeout(ok, 1000); }).then(send);
        })
        .catch(function (err) {
          /* ยังไม่ผ่านอีก แปลว่าไม่ใช่เน็ตสะดุด แต่เป็นที่ตัว POST เอง → เปลี่ยนไปใช้ GET */
          if (!API.isNetworkError(err)) throw err;
          console.warn('[API] เปลี่ยนไปส่งด้วย GET แทน');
          return viaGet();
        })
        .catch(function (err) {
          if (!API.isNetworkError(err)) throw err;
          var e = new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (' + ((err && err.message) || err) + ')');
          e.networkError = true;
          throw e;
        })
        .then(API.guard);
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

    /** แปลงข้อความสถานะในชีต เป็นคีย์ของ STATUS_COLORS */
    statusKey: function (status) {
      var S = CFG.STATUS;
      if (status === S.APPROVED) return 'APPROVED';
      if (status === S.CHECKING) return 'CHECKING';
      if (status === S.REVISE)   return 'REVISE';
      if (status === S.PENDING)  return 'PENDING';
      return status ? 'PENDING' : 'NONE';
    },

    /**
     * สี + ไอคอนของสถานะ — อ่านจาก APP_CONFIG.STATUS_COLORS แหล่งเดียว
     * รับได้ทั้งข้อความสถานะจากชีต และคีย์ตรง ๆ เช่น 'ALL' / 'NONE'
     */
    statusColor: function (statusOrKey) {
      var map = CFG.STATUS_COLORS || {};
      return map[statusOrKey] || map[UI.statusKey(statusOrKey)] || map.PENDING;
    },

    /** เผื่อโค้ดเดิมที่ยังเรียก statusStyle อยู่ */
    statusStyle: function (status) {
      var c = UI.statusColor(status);
      return { cls: c.badge, icon: c.icon, hex: c.hex };
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

    loading: function (title, text) {
      if (window.Swal) Swal.fire({
        title: title || 'กำลังโหลด...',
        text: text || '',
        allowOutsideClick: false,
        didOpen: function () { Swal.showLoading(); }
      });
    },

    /** เปลี่ยนข้อความในกล่องโหลดที่เปิดค้างอยู่ ให้ผู้ใช้เห็นว่าคืบหน้าถึงไหน */
    loadingText: function (title, text) {
      if (!window.Swal || !Swal.isVisible()) return;
      var t = Swal.getTitle(), c = Swal.getHtmlContainer();
      if (t && title) t.textContent = title;
      if (c) c.textContent = text || '';
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
