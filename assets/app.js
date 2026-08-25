/*  แกนกลางของระบบ: คุยกับ Google Apps Script + จัดการสิทธิ์ผู้ใช้
 *  ทุกหน้า (index / hospital / admin) เรียกใช้ไฟล์นี้ร่วมกัน
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};

  /* บอกรุ่นของไฟล์หน้าเว็บทุกครั้งที่เปิดหน้า
     ถ้าแก้โค้ดแล้วแต่เลขยังเป็นของเดิม แปลว่าเบราว์เซอร์ยังใช้ cache เก่าอยู่
     ให้กดรีเฟรชแบบล้าง cache (Safari: Cmd+Option+R / Chrome: Cmd+Shift+R) */
  console.log('%c[ระบบติดตามมาตรฐานโรงพยาบาล] หน้าเว็บรุ่น ' + (CFG.WEB_VERSION || 'ไม่ระบุ'),
              'color:#0072CE;font-weight:bold');


  /* ---------------------------------------------------------
   *  SHA-256 — ใช้แปลงรหัสหน่วยงานก่อนส่งขึ้นเซิร์ฟเวอร์
   *
   *  ทำไมต้องมี: เดิมส่งรหัสเป็นตัวหนังสือเปล่าไปกับ URL ซึ่งระบบตรวจจับ
   *  ของ Google อ่านแล้วเข้าใจว่าเป็นเว็บขโมยรหัส จึงระงับ Apps Script ไป
   *  เขียนเองแทนที่จะใช้ crypto.subtle เพราะตัวนั้นใช้ไม่ได้ตอนเปิดไฟล์
   *  จากเครื่องตรง ๆ (file://) และเป็นแบบ async ทำให้โค้ดล็อกอินยุ่งขึ้น
   *
   *  ผลลัพธ์ต้องตรงกับ sha256Hex_() ใน Code.gs เป๊ะ ๆ ไม่งั้นล็อกอินไม่ผ่าน
   * ------------------------------------------------------- */
  var Hash = (function () {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    /** แปลงข้อความเป็นไบต์แบบ UTF-8 (ต้องตรงกับฝั่ง Apps Script ที่ระบุ UTF_8) */
    function utf8(str) {
      var out = [], i, c, c2;
      for (i = 0; i < str.length; i++) {
        c = str.charCodeAt(i);
        if (c < 0x80) {
          out.push(c);
        } else if (c < 0x800) {
          out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
          c2 = str.charCodeAt(i + 1);
          c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          i++;
          out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        } else {
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
      }
      return out;
    }

    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

    function sha256(str) {
      var b = utf8(str), bitLen = b.length * 8, i, t;

      b.push(0x80);
      while (b.length % 64 !== 56) b.push(0);
      /* ความยาวเป็นบิตแบบ 64 บิต — 4 ไบต์แรกเป็นศูนย์เสมอ เพราะข้อความที่ใช้สั้นมาก */
      b.push(0, 0, 0, 0,
             (bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);

      var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
               0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
      var w = new Array(64);

      for (i = 0; i < b.length; i += 64) {
        for (t = 0; t < 16; t++) {
          w[t] = (b[i + t * 4] << 24) | (b[i + t * 4 + 1] << 16) |
                 (b[i + t * 4 + 2] << 8) | b[i + t * 4 + 3];
        }
        for (t = 16; t < 64; t++) {
          var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
          var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
          w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
        }

        var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (t = 0; t < 64; t++) {
          var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
          var ch = (e & f) ^ (~e & g);
          var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
          var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
          var maj = (a & bb) ^ (a & c) ^ (bb & c);
          var t2 = (S0 + maj) | 0;
          h = g; g = f; f = e; e = (d + t1) | 0;
          d = c; c = bb; bb = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0;  H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0;  H[5] = (H[5] + f) | 0;  H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
      }

      var hex = '';
      for (i = 0; i < 8; i++) hex += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
      return hex;
    }

    return {
      sha256: sha256,

      /** ค่าที่ส่งขึ้นเซิร์ฟเวอร์แทนรหัสหน่วยงาน */
      code: function (raw) {
        return sha256((CFG.AUTH_SALT || '') + ':' + String(raw == null ? '' : raw).trim());
      }
    };
  })();

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

    /**
     * ส่งคำสั่งที่เขียนข้อมูล
     *
     * ใช้ GET เป็นหลักสำหรับคำขอสั้น ๆ แทน POST เพราะ POST ของ Apps Script
     * ถูก redirect ข้ามโดเมนไป script.googleusercontent.com ก่อนถึงปลายทาง
     * ซึ่งบางเบราว์เซอร์ (Safari) บล็อกแล้วขึ้น "Load failed" ส่วน GET ใช้ได้ปกติ
     * — สังเกตได้จากการอ่านข้อมูลทุกอย่างซึ่งใช้ GET ไม่เคยมีปัญหาเลย
     *
     * การแนบไฟล์ base64 ยาวเกินความยาว URL ที่รับได้ จึงยังต้องใช้ POST
     * และถ้า GET พลาด ก็ถอยไปใช้ POST ให้อัตโนมัติ
     *
     * opts.timeout = กำหนดเวลารอเองได้ (ใช้ตอนแนบไฟล์ซึ่งนานกว่าปกติ)
     */
    post: function (payload, opts) {
      var body = {};
      Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
      var tk = API.token();
      if (tk) body.token = tk;

      var raw = JSON.stringify(body);
      var timeout = opts && opts.timeout;

      var readJson = function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      };

      var viaPost = function () {
        return API.fetchWithTimeout(CFG.API_URL, {
          method: 'POST',
          redirect: 'follow',
          body: raw          // ตั้งใจไม่ใส่ headers — ดูหมายเหตุด้านบน
        }, timeout).then(readJson);
      };

      var viaGet = function () {
        return API.fetchWithTimeout(
          CFG.API_URL + '?action=' + encodeURIComponent(body.action || '') +
          '&payload=' + encodeURIComponent(raw) +
          '&_=' + Date.now(),   /* กัน cache ของเบราว์เซอร์ คำสั่งเขียนต้องถึงเซิร์ฟเวอร์เสมอ */
          { method: 'GET', redirect: 'follow' }, timeout
        ).then(readJson);
      };

      /* คำขอสั้นพอ → ใช้ GET ก่อน แล้วถอยไป POST
         คำขอยาว (แนบไฟล์) → ใช้ POST อย่างเดียว */
      var chain = raw.length <= 6000
        ? viaGet().catch(function (err) {
            if (!API.isNetworkError(err)) throw err;
            console.warn('[API] GET ไม่ผ่าน ลองใหม่ด้วย POST:', err.message);
            return viaPost();
          })
        : viaPost().catch(function (err) {
            if (!API.isNetworkError(err)) throw err;
            console.warn('[API] POST ล้มระดับเครือข่าย กำลังลองใหม่:', err.message);
            return new Promise(function (ok) { setTimeout(ok, 1000); }).then(viaPost);
          });

      return chain
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
   *  สิทธิ์ผู้ใช้ — เก็บใน sessionStorage หลังเข้าสู่ระบบสำเร็จ
   *  index.html = ไม่ต้องล็อกอิน
   *  hospital.html = ต้องเป็น role 'user'
   *  admin.html = ต้องเป็น role 'admin' เท่านั้น
   *
   *  ทำไมถึงเป็น sessionStorage ไม่ใช่ localStorage:
   *  เครื่องที่โรงพยาบาลมักใช้ร่วมกันหลายคน ปิดเบราว์เซอร์แล้วต้องหลุดออก
   *  ไม่ใช่ค้างให้คนถัดไปเปิดเจอข้อมูลหน่วยงานตัวเอง
   *  ข้อแลกเปลี่ยนที่ต้องรู้: เปิดแท็บใหม่ขึ้นมาเองจะนับเป็นคนละเซสชัน
   *  ต้องล็อกอินใหม่ในแท็บนั้น (กดลิงก์ในระบบหรือก๊อปแท็บเดิมยังใช้ของเดิมอยู่)
   * ------------------------------------------------------- */
  var Auth = {
    KEY: 'currentUser',

    get: function () {
      try { return JSON.parse(sessionStorage.getItem(Auth.KEY)); }
      catch (e) { return null; }
    },

    set: function (user) {
      sessionStorage.setItem(Auth.KEY, JSON.stringify(user));
    },

    clear: function () {
      try { sessionStorage.removeItem(Auth.KEY); } catch (e) {}
      /* ของเก่าสมัยที่ยังเก็บใน localStorage — ล้างทิ้งด้วยกันให้จบ */
      try { localStorage.removeItem(Auth.KEY); } catch (e) {}
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

  /* ผู้ใช้ที่เคยล็อกอินไว้ก่อนเปลี่ยนมาใช้ sessionStorage จะมี token เก่านอนค้าง
     อยู่ใน localStorage ตลอดไป ล้างทิ้งตั้งแต่เปิดหน้าแรก ไม่ต้องรอให้กดออก */
  try { localStorage.removeItem(Auth.KEY); } catch (e) {}

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
  window.Hash = Hash;
})();
