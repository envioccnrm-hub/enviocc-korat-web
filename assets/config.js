/*  ตั้งค่าระบบ — แก้ที่ไฟล์นี้ไฟล์เดียว ทุกหน้าใช้ค่าเดียวกันหมด
 *  ---------------------------------------------------------------
 *  วิธีเอา URL:  Apps Script → Deploy → New deployment → Web app
 *                Execute as: Me  /  Who has access: Anyone
 *                คัดลอกลิงก์ที่ลงท้ายด้วย /exec มาวางข้างล่างนี้
 */
window.APP_CONFIG = {
  // ⚠️ ในไฟล์เดิมของพี่มี URL อยู่ 2 อันที่ไม่ตรงกัน (ตัว I l กับ O 0 สลับกัน)
  //    ผมเลือกอันที่ใช้ในหน้า Login มาเป็นค่าตั้งต้น
  //    ถ้า Deploy Code.gs ตัวใหม่แล้ว จะได้ URL ใหม่ ให้เอามาวางทับตรงนี้
  API_URL: 'https://script.google.com/macros/s/AKfycby9t6vY3B6lTx8BIGdI1riw0GhTlMnGWVuqQQQDRG7xMo8smqrLOniahIC0QQloI-Ms/exec',

  // true = ถ้าต่อ API ไม่ได้ ให้ใช้ข้อมูลตัวอย่างเพื่อดูหน้าตาเว็บก่อน
  //        (จะมีแถบสีส้มขึ้นเตือนว่ากำลังอยู่ในโหมดตัวอย่าง)
  // false = ต่อไม่ได้ให้ขึ้น error อย่างเดียว (ใช้ตอนขึ้นระบบจริง)
  ALLOW_DEMO_FALLBACK: true,

  ORG_NAME: 'สำนักงานสาธารณสุขจังหวัดนครราชสีมา',

  // สถานะงาน — ต้องตรงกับใน Code.gs
  STATUS: {
    PENDING:  'รอตรวจสอบ',
    CHECKING: 'ดำเนินการตรวจสอบแล้ว',
    REVISE:   'ต้องแก้ไขเพิ่มเติม',
    APPROVED: 'รับรองผลเรียบร้อยแล้ว'
  }
};
