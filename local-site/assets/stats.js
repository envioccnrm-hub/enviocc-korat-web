/*  ตัวคำนวณสถิติ + ตัวช่วยวาดกราฟ — ใช้ร่วมกันทั้งหน้า Admin และหน้าโรงพยาบาล
 *  ------------------------------------------------------------------
 *  ทุกตัวเลขในแดชบอร์ด "คำนวณสด" จากแถวจริงที่ดึงมาจาก Google Sheet
 *  (ผลลัพธ์ของ action=getSubmissions) ไม่มีค่าคงที่ / ไม่มีข้อมูลปลอมฝังไว้
 *  กราฟวาดด้วย div + CSS ล้วน ไม่พึ่งไลบรารีภายนอก จึงใช้งานออฟไลน์ได้
 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var S = CFG.STATUS || {};

  /* สีชุดเดียวใช้ทุกกราฟ ให้หมวดเดียวกันได้สีเดิมเสมอ
   * เรียงลำดับตายตัว 8 สี ห้ามสลับ — ลำดับคือกลไกที่ทำให้คนตาบอดสีแยกออก
   * ยึดสีน้ำเงินแบรนด์ (#0072CE) เป็นสีแรก และเขียวแบรนด์เข้ม (#5E981A) เป็นสีที่ 6
   * ตรวจผ่านเกณฑ์ตาบอดสี protan/deutan แล้ว (คู่ที่ใกล้สุด ΔE 9.1) */
  var PALETTE = ['#0072CE', '#EB6834', '#1BAF7A', '#EDA100',
                 '#E87BA4', '#5E981A', '#4A3AA7', '#E34948'];

  var TH_MONTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

  function esc(s) { return window.UI ? UI.esc(s) : String(s == null ? '' : s); }

  /** เซลล์เดียวในชีตเก็บได้หลายหมวด/หลายข้อ (คั่นด้วยขึ้นบรรทัดใหม่) → แตกเป็นรายการ */
  function lines(text) {
    return String(text == null ? '' : text)
      .split(/[\r\n]+|\s*;\s*/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  /** ตัดข้อความยาวให้พอดีป้ายกราฟ */
  function short(text, n) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    n = n || 42;
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  function sortDesc(a, b) {
    return b.count - a.count || String(a.label).localeCompare(String(b.label), 'th');
  }

  function toList(map, total, limit) {
    var out = Object.keys(map).map(function (k) {
      return { label: k, count: map[k], pct: total ? map[k] * 100 / total : 0 };
    });
    out.sort(sortDesc);
    return limit ? out.slice(0, limit) : out;
  }

  var Stats = {
    lines: lines,
    short: short,
    PALETTE: PALETTE,

    /** ความถี่ของค่าที่เก็บหลายค่าในเซลล์เดียว เช่น categories / items
     *  1 แถว ที่เลือก 3 หมวด = นับให้ทั้ง 3 หมวด */
    freqMulti: function (rows, key, limit) {
      var map = {}, total = 0;
      rows.forEach(function (r) {
        lines(r[key]).forEach(function (v) {
          map[v] = (map[v] || 0) + 1;
          total++;
        });
      });
      return toList(map, total, limit);
    },

    /** ความถี่ของค่าเดี่ยว เช่น district / hospType / level / year */
    freq: function (rows, key, limit) {
      var map = {}, total = 0;
      rows.forEach(function (r) {
        var v = String(r[key] == null ? '' : r[key]).trim();
        if (!v) return;
        map[v] = (map[v] || 0) + 1;
        total++;
      });
      return toList(map, total, limit);
    },

    /** สรุปสถานะ + อัตราการรับรอง (ตัวเลข KPI หลัก) */
    status: function (rows) {
      var n = function (st) {
        return rows.filter(function (r) { return r.status === st; }).length;
      };
      var total = rows.length;
      var approved = n(S.APPROVED);
      return {
        total: total,
        pending: n(S.PENDING),
        checking: n(S.CHECKING),
        revise: n(S.REVISE),
        approved: approved,
        /** ค้างดำเนินการ = ยังไม่ผ่านการรับรอง */
        outstanding: total - approved,
        approvedPct: total ? approved * 100 / total : 0
      };
    },

    /** จำนวนหน่วยงานที่ไม่ซ้ำ (ใช้วัดความครอบคลุมว่ามีกี่แห่งที่ส่งงานแล้ว) */
    uniqueCount: function (rows, key) {
      var seen = {};
      rows.forEach(function (r) {
        var v = String(r[key] || '').trim();
        if (v) seen[v] = 1;
      });
      return Object.keys(seen).length;
    },

    /** จัดกลุ่มตามคอลัมน์ แล้วแยกสถานะในแต่ละกลุ่ม (ตารางรายอำเภอ / รายประเภท) */
    group: function (rows, key) {
      var map = {};
      rows.forEach(function (r) {
        var k = String(r[key] || '').trim() || 'ไม่ระบุ';
        if (!map[k]) map[k] = { label: k, total: 0, pending: 0, checking: 0, revise: 0, approved: 0, hospitals: {} };
        var g = map[k];
        g.total++;
        if (r.status === S.PENDING)  g.pending++;
        else if (r.status === S.CHECKING) g.checking++;
        else if (r.status === S.REVISE)   g.revise++;
        else if (r.status === S.APPROVED) g.approved++;
        if (r.hospital) g.hospitals[r.hospital] = 1;
      });
      return Object.keys(map).map(function (k) {
        var g = map[k];
        g.hospitalCount = Object.keys(g.hospitals).length;
        g.approvedPct = g.total ? g.approved * 100 / g.total : 0;
        g.count = g.total;   // ให้ใช้กับตัวช่วยวาดกราฟชุดเดียวกันได้
        return g;
      }).sort(function (a, b) { return b.total - a.total; });
    },

    /** แนวโน้มการส่งงานย้อนหลัง n เดือน (นับตามวันที่ส่งจริงในชีต) */
    byMonth: function (rows, months) {
      months = months || 12;
      var now = new Date();
      var keys = [], out = [];
      for (var i = months - 1; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var k = d.getFullYear() + '-' + d.getMonth();
        keys.push(k);
        out.push({
          key: k,
          label: TH_MONTH[d.getMonth()] + ' ' + String((d.getFullYear() + 543) % 100),
          count: 0
        });
      }
      rows.forEach(function (r) {
        if (!r.submittedAt) return;
        var d = new Date(r.submittedAt);
        if (isNaN(d)) return;
        var idx = keys.indexOf(d.getFullYear() + '-' + d.getMonth());
        if (idx >= 0) out[idx].count++;
      });
      var total = out.reduce(function (s, x) { return s + x.count; }, 0);
      out.forEach(function (x) { x.pct = total ? x.count * 100 / total : 0; });
      return out;
    }
  };

  /* =========================================================
   *  ตัวช่วยวาดกราฟ (คืนค่าเป็น HTML string)
   * ======================================================= */
  var Viz = {

    /** ไม่มีข้อมูลให้วาด */
    empty: function (msg) {
      return '<div class="py-10 text-center text-text-muted text-sm">' +
             esc(msg || 'ยังไม่มีข้อมูลเพียงพอสำหรับคำนวณ') + '</div>';
    },

    /** กราฟแท่งแนวนอน + อันดับ — ใช้กับ "หมวดที่ถูกส่งแก้ไขมากที่สุด" */
    hbars: function (items, opts) {
      opts = opts || {};
      if (!items || !items.length) return Viz.empty(opts.emptyText);
      var max = Math.max.apply(null, items.map(function (x) { return x.count; })) || 1;
      var unit = opts.unit || 'ครั้ง';
      return '<div class="space-y-4">' + items.map(function (it, i) {
        var color = (opts.colors && opts.colors[it.label]) || opts.color || PALETTE[i % PALETTE.length];
        return '<div>' +
          '<div class="flex items-start justify-between gap-3 mb-1.5">' +
            '<div class="flex items-start gap-2 min-w-0">' +
              (opts.rank === false ? '' :
                '<span class="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full text-[11px] font-bold text-white flex items-center justify-center" ' +
                'style="background:' + color + '">' + (i + 1) + '</span>') +
              '<span class="text-sm text-text-main leading-snug" title="' + esc(it.label) + '">' +
                esc(short(it.label, opts.maxLen || 64)) + '</span>' +
            '</div>' +
            '<span class="text-xs font-semibold text-text-main whitespace-nowrap flex-shrink-0">' +
              it.count + ' ' + esc(unit) + ' (' + it.pct.toFixed(1) + '%)</span>' +
          '</div>' +
          '<div class="h-2.5 rounded-full bg-slate-100 overflow-hidden">' +
            '<div class="h-full rounded-full transition-all" style="width:' +
              Math.max(2, it.count * 100 / max).toFixed(1) + '%;background:' + color + '"></div></div>' +
        '</div>';
      }).join('') + '</div>';
    },

    /** กราฟแท่งแนวตั้ง — ใช้กับ "สถิติรายข้อ" และ "แนวโน้มรายเดือน" */
    vbars: function (items, opts) {
      opts = opts || {};
      if (!items || !items.length) return Viz.empty(opts.emptyText);
      var max = Math.max.apply(null, items.map(function (x) { return x.count; })) || 1;
      var unit = opts.unit || 'ครั้ง';
      var color = opts.color || '#0072CE';
      var w = opts.barWidth || 56;
      return '<div class="overflow-x-auto pb-1"><div class="flex items-end gap-3 h-52 min-w-full" ' +
        'style="min-width:' + (items.length * (w + 12)) + 'px">' +
        items.map(function (it, i) {
          var h = Math.max(2, it.count * 100 / max);
          var c = opts.rainbow ? PALETTE[i % PALETTE.length] : color;
          return '<div class="flex flex-col items-center justify-end h-full flex-1" style="min-width:' + w + 'px">' +
            '<span class="text-[11px] font-semibold text-text-main mb-1">' + it.count + '</span>' +
            '<div class="w-full rounded-t-md transition-all" title="' + esc(it.label) + ': ' + it.count + ' ' + esc(unit) + '" ' +
              'style="height:' + h.toFixed(1) + '%;background:' + c + '"></div>' +
            '<span class="text-[10px] text-text-muted mt-2 text-center leading-tight break-words" ' +
              'title="' + esc(it.label) + '">' + esc(short(it.label, opts.maxLen || 18)) + '</span>' +
          '</div>';
        }).join('') + '</div></div>';
    },

    /** โดนัทสัดส่วน + คำอธิบายสี — ใช้กับ "สัดส่วนระดับผลการประเมิน" */
    donut: function (items, opts) {
      opts = opts || {};
      if (!items || !items.length) return Viz.empty(opts.emptyText);
      var total = items.reduce(function (s, x) { return s + x.count; }, 0);
      if (!total) return Viz.empty(opts.emptyText);

      var acc = 0;
      var stops = items.map(function (it, i) {
        var color = (opts.colors && opts.colors[it.label]) || PALETTE[i % PALETTE.length];
        var from = acc * 100 / total;
        acc += it.count;
        var to = acc * 100 / total;
        return color + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%';
      }).join(',');

      return '<div class="flex flex-col sm:flex-row items-center gap-6">' +
        '<div class="relative flex-shrink-0" style="width:150px;height:150px">' +
          '<div class="w-full h-full rounded-full" style="background:conic-gradient(' + stops + ')"></div>' +
          '<div class="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center shadow-inner">' +
            '<span class="text-2xl font-bold text-tertiary">' + total + '</span>' +
            '<span class="text-[10px] text-text-muted">' + esc(opts.centerLabel || 'รายการ') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="flex-1 w-full space-y-2">' + items.map(function (it, i) {
          var color = (opts.colors && opts.colors[it.label]) || PALETTE[i % PALETTE.length];
          return '<div class="flex items-center gap-2 text-sm">' +
            '<span class="w-3 h-3 rounded-sm flex-shrink-0" style="background:' + color + '"></span>' +
            '<span class="flex-1 truncate text-text-main" title="' + esc(it.label) + '">' + esc(short(it.label, 30)) + '</span>' +
            '<span class="font-semibold text-text-main whitespace-nowrap">' + it.count +
              ' (' + (it.count * 100 / total).toFixed(1) + '%)</span>' +
          '</div>';
        }).join('') + '</div>' +
      '</div>';
    },

    /** แถบความคืบหน้าพร้อมเป้าหมาย (เส้นประ) */
    progress: function (pct, opts) {
      opts = opts || {};
      var p = Math.max(0, Math.min(100, pct || 0));
      var color = opts.color || '#76BC21';
      var target = opts.target;
      return '<div class="relative h-3 rounded-full bg-slate-100 overflow-hidden">' +
          '<div class="h-full rounded-full" style="width:' + p.toFixed(1) + '%;background:' + color + '"></div>' +
        '</div>' +
        (target != null
          ? '<div class="flex justify-between text-[11px] text-text-muted mt-1">' +
              '<span>' + p.toFixed(1) + '%</span><span>เป้าหมาย ' + target + '%</span></div>'
          : '');
    },

    /** การ์ดตัวเลข KPI */
    kpi: function (o) {
      return '<div class="bg-white border border-outline-custom rounded-2xl p-5 shadow-sm">' +
        '<div class="flex items-center gap-2 text-text-muted text-sm">' +
          '<span class="material-symbols-outlined text-[18px]" style="color:' + (o.color || '#0072CE') + '">' +
            esc(o.icon || 'insights') + '</span> ' + esc(o.label) + '</div>' +
        '<p class="text-3xl font-bold mt-2" style="color:' + (o.color || '#0A2540') + '">' + esc(o.value) + '</p>' +
        (o.sub ? '<p class="text-xs text-text-muted mt-1">' + esc(o.sub) + '</p>' : '') +
        (o.bar != null ? '<div class="mt-3">' + Viz.progress(o.bar, { color: o.color, target: o.target }) + '</div>' : '') +
      '</div>';
    }
  };

  /** สีประจำระดับผลการประเมิน — เป็น "ระดับ" ที่เรียงลำดับ จึงใช้ไล่เฉดเขียวแบรนด์
   *  เฉดเดียวจากอ่อนไปเข้ม ยิ่งเข้ม = ยิ่งระดับสูง ผู้อ่านเห็นลำดับได้จากสีทันที
   *  (ห้ามเปลี่ยนเป็นหลายสี — จะกลายเป็นสีรุ้งที่อ่านลำดับไม่ออก) */
  Viz.LEVEL_COLORS = {
    'ระดับพื้นฐาน': '#83B74B',
    'ระดับเริ่มต้นพัฒนา': '#83B74B',
    'ระดับมาตรฐาน': '#71A23B',
    'ระดับดี': '#608E2B',
    'ระดับดีมาก': '#507A1A',
    'ระดับดีเด่น': '#406705',
    'ระดับดีเยี่ยม': '#305400',
    'ระดับท้าทาย': '#224200'
  };

  /** สีประจำ "สถานะ" ของรายงาน — เป็นสีสงวน มีความหมายตายตัว
   *  ห้ามเอาไปใช้เป็นสีลำดับที่ N ของกราฟทั่วไป และต้องมีข้อความกำกับเสมอ
   *  (แหล่งเดียวสำหรับทั้งหน้า สสจ. และหน้าโรงพยาบาล) */
  Viz.STATUS_COLORS = function () {
    var c = {};
    c[S.PENDING]  = '#EAB308';   /* รอตรวจ      — เหลืองเตือน */
    c[S.CHECKING] = '#0072CE';   /* กำลังตรวจ   — น้ำเงินแบรนด์ */
    c[S.REVISE]   = '#EF4444';   /* ส่งกลับแก้ไข — แดง */
    c[S.APPROVED] = '#16A34A';   /* ผ่านการรับรอง — เขียว */
    return c;
  };

  window.Stats = Stats;
  window.Viz = Viz;
})();
