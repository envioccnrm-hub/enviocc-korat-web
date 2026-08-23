/*  ข้อมูลตัวอย่าง — ใช้เฉพาะตอนต่อ Google Sheet ไม่ได้ เพื่อให้ดูหน้าตาเว็บได้ก่อน
 *  คำเรียกประเภทหน่วยงานในไฟล์นี้ใช้แบบเดียวกับในชีตจริง (รพ.ศูนย์ / รพ.สต. ฯลฯ)
 *  พอ deploy Code.gs แล้วใส่ URL ถูกต้อง ระบบจะใช้ข้อมูลจริงทันที ไม่ต้องแก้ไฟล์นี้
 */
window.DEMO = (function () {
  var S = window.APP_CONFIG.STATUS;

  var dropdowns = {
    districts: ['เมืองนครราชสีมา', 'ปากช่อง', 'พิมาย', 'ด่านขุนทด', 'สีคิ้ว', 'บัวใหญ่'],
    types: ['รพ.ศูนย์', 'รพ.ทั่วไป', 'รพ.ชุมชน', 'รพ.สต.', 'สสจ.'],
    hospitals: [],
    fullData: [
      { district: 'เมืองนครราชสีมา', type: 'รพ.ศูนย์',  typeCode: 'CEN', hospital: 'โรงพยาบาลมหาราชนครราชสีมา' },
      { district: 'เมืองนครราชสีมา', type: 'สสจ.',      typeCode: 'PHO', hospital: 'สสจ.นครราชสีมา' },
      { district: 'ปากช่อง',        type: 'รพ.ทั่วไป', typeCode: 'GEN', hospital: 'โรงพยาบาลปากช่องนานา' },
      { district: 'พิมาย',          type: 'รพ.ทั่วไป', typeCode: 'GEN', hospital: 'โรงพยาบาลพิมาย' },
      { district: 'ด่านขุนทด',      type: 'รพ.ชุมชน',  typeCode: 'COM', hospital: 'โรงพยาบาลด่านขุนทด' },
      { district: 'สีคิ้ว',          type: 'รพ.ชุมชน',  typeCode: 'COM', hospital: 'โรงพยาบาลสีคิ้ว' },
      { district: 'บัวใหญ่',        type: 'รพ.สต.',    typeCode: 'SUB', hospital: 'รพ.สต.บ้านดอนตะหนิน' }
    ]
  };
  dropdowns.hospitals = dropdowns.fullData.map(function (r) { return r.hospital; });

  var BIG = 'รพ.ศูนย์/ รพ.ทั่วไป/ รพ.ชุมชน/ รพ.นอก สป.สธ.';
  var SUB = 'รพ.สต.';

  var green = [
    { category: 'หมวด 1 CLEAN : การสร้างกระบวนการพัฒนา', item: '1.1 กำหนดนโยบาย: มีนโยบายด้านสิ่งแวดล้อมเป็นลายลักษณ์อักษร', hospType: BIG, types: ['CEN','GEN','COM','OUT'] },
    { category: 'หมวด 1 CLEAN : การสร้างกระบวนการพัฒนา', item: '1.2 สื่อสารนโยบาย: สื่อสารให้เจ้าหน้าที่ทราบทั่วทั้งองค์กร', hospType: BIG, types: ['CEN','GEN','COM','OUT'] },
    { category: 'หมวด 2 G : Garbage : การจัดการมูลฝอยทุกประเภท', item: '2.1 คัดแยกมูลฝอย: มีจุดคัดแยกครบทุกประเภท', hospType: BIG, types: ['CEN','GEN','COM','OUT'] },
    { category: 'หมวด 3 R : Restroom : การพัฒนาห้องส้วมมาตรฐาน', item: '3.1 ส้วมมาตรฐาน HAS: ผ่านเกณฑ์ทุกข้อ', hospType: BIG, types: ['CEN','GEN','COM','OUT'] },
    { category: 'หมวด 4 E : Energy : การจัดการพลังงานและทรัพยากร', item: '4.1 มาตรการประหยัดพลังงาน: มีแผนและผลการดำเนินงาน', hospType: BIG, types: ['CEN','GEN','COM','OUT'] },

    { category: 'หมวด 1 CLEAN : การสร้างกระบวนการพัฒนา (รพ.สต.)', item: '1.1 กำหนดนโยบาย: มีนโยบายด้านสิ่งแวดล้อมของหน่วยบริการ', hospType: SUB, types: ['SUB'] },
    { category: 'หมวด 2 G : Garbage : การจัดการมูลฝอย (รพ.สต.)', item: '2.1 คัดแยกมูลฝอย: แยกขยะติดเชื้อออกจากขยะทั่วไป', hospType: SUB, types: ['SUB'] },
    { category: 'หมวด 3 R : Restroom : ห้องส้วม (รพ.สต.)', item: '3.1 ส้วมสะอาดได้มาตรฐาน HAS', hospType: SUB, types: ['SUB'] },
    { category: 'หมวด 6 N : Nutrition : น้ำอุปโภคบริโภค (รพ.สต.)', item: '6.1 คุณภาพน้ำดื่ม: ผ่านการตรวจทางห้องปฏิบัติการ', hospType: SUB, types: ['SUB'] }
  ];

  var occ = [
    { category: 'องค์ประกอบที่ 1 การบริหารจัดการ', item: '1. การนำองค์กร: ผู้บริหารกำหนดนโยบายจัดบริการอาชีวอนามัย', hospType: 'รพ.ชุมชน', types: ['COM'] },
    { category: 'องค์ประกอบที่ 2 การจัดบริการแก่บุคลากรในโรงพยาบาล', item: '2. ทะเบียนความเสี่ยงรายแผนก', hospType: 'รพ.ชุมชน', types: ['COM'] },
    { category: 'องค์ประกอบที่ 3 การจัดบริการเชิงรุกแก่ผู้ประกอบอาชีพภายนอก', item: '3. การเฝ้าระวังสุขภาพตามความเสี่ยง', hospType: 'รพ.ชุมชน', types: ['COM'] },
    { category: 'องค์ประกอบที่ 4 การจัดบริการเชิงรับ', item: '4. การวินิจฉัยโรคจากการทำงาน', hospType: 'รพ.ชุมชน', types: ['COM'] },
    { category: 'องค์ประกอบที่ 5 การจัดบริการเวชกรรมสิ่งแวดล้อม', item: '5. การมีส่วนร่วมของเครือข่ายภายนอก', hospType: 'รพ.ชุมชน', types: ['COM'] }
  ];

  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  }

  var GS = 'ติดตามงาน Green & Clean Hospital';
  var OS = 'ติดตามงาน อาชีวอนามัยและเวชกรรมสิ่งแวดล้อม';

  var submissions = [
    { sheet: GS, row: 2, submittedAt: daysAgo(2), workType: 'งาน Green & Clean',
      district: 'เมืองนครราชสีมา', hospital: 'โรงพยาบาลมหาราชนครราชสีมา', hospitalCode: '10666',
      hospType: 'รพ.ศูนย์', year: '2568', senderName: 'นพ. สมชาย รักดี', phone: '081-234-5678',
      level: 'ระดับดีเยี่ยม', categories: 'หมวด 1 CLEAN : การสร้างกระบวนการพัฒนา',
      items: '1.1 กำหนดนโยบาย: มีนโยบายด้านสิ่งแวดล้อมเป็นลายลักษณ์อักษร',
      detail: 'จัดทำประกาศนโยบายสิ่งแวดล้อมฉบับใหม่ ลงนามโดยผู้อำนวยการ และติดประกาศทุกอาคาร',
      driveLink: 'https://drive.google.com/', status: S.PENDING, comment: '' },

    { sheet: GS, row: 3, submittedAt: daysAgo(5), workType: 'งาน Green & Clean',
      district: 'บัวใหญ่', hospital: 'รพ.สต.บ้านดอนตะหนิน', hospitalCode: '05123',
      hospType: 'รพ.สต.', year: '2568', senderName: 'นางสาวมาลี ใจดี', phone: '089-111-2222',
      level: 'ระดับมาตรฐาน', categories: 'หมวด 2 G : Garbage : การจัดการมูลฝอย (รพ.สต.)',
      items: '2.1 คัดแยกมูลฝอย: แยกขยะติดเชื้อออกจากขยะทั่วไป',
      detail: 'จัดหาถังขยะติดเชื้อเพิ่ม 3 จุด พร้อมป้ายกำกับ และอบรมเจ้าหน้าที่',
      driveLink: 'https://drive.google.com/', status: S.REVISE,
      comment: 'กรุณาแนบภาพถ่ายจุดคัดแยกให้ครบทั้ง 3 จุด\n— สสจ.นครราชสีมา (20/08/2568 10:15)' },

    { sheet: GS, row: 4, submittedAt: daysAgo(9), workType: 'งาน Green & Clean',
      district: 'พิมาย', hospital: 'โรงพยาบาลพิมาย', hospitalCode: '10884',
      hospType: 'รพ.ทั่วไป', year: '2567', senderName: 'นายวิชัย มั่นคง', phone: '086-777-8888',
      level: 'ระดับท้าทาย', categories: 'หมวด 4 E : Energy : การจัดการพลังงานและทรัพยากร',
      items: '4.1 มาตรการประหยัดพลังงาน: มีแผนและผลการดำเนินงาน',
      detail: 'เปลี่ยนหลอดไฟเป็น LED ทั้งอาคารผู้ป่วยนอก ลดค่าไฟได้ 18%',
      driveLink: 'https://drive.google.com/', status: S.APPROVED,
      comment: 'เอกสารครบถ้วน ผ่านการรับรอง\n— สสจ.นครราชสีมา (14/08/2568 09:30)' },

    { sheet: OS, row: 2, submittedAt: daysAgo(1), workType: 'งานอาชีวอนามัยฯ',
      district: 'ด่านขุนทด', hospital: 'โรงพยาบาลด่านขุนทด', hospitalCode: '10885',
      hospType: 'รพ.ชุมชน', year: '2568', senderName: 'นางสุดา แสนดี', phone: '082-333-4444',
      level: 'ระดับดีมาก', categories: 'องค์ประกอบที่ 3 การจัดบริการเชิงรุกแก่ผู้ประกอบอาชีพภายนอก',
      items: '3. การเฝ้าระวังสุขภาพตามความเสี่ยง',
      detail: 'ออกหน่วยตรวจสุขภาพกลุ่มเกษตรกร 2 ตำบล รวม 240 ราย',
      driveLink: 'https://drive.google.com/', status: S.PENDING, comment: '' },

    { sheet: OS, row: 3, submittedAt: daysAgo(7), workType: 'งานอาชีวอนามัยฯ',
      district: 'สีคิ้ว', hospital: 'โรงพยาบาลสีคิ้ว', hospitalCode: '10886',
      hospType: 'รพ.ชุมชน', year: '2567', senderName: 'นายอนุชา ตั้งใจ', phone: '084-555-6666',
      level: 'ระดับดี', categories: 'องค์ประกอบที่ 1 การบริหารจัดการ',
      items: '1. การนำองค์กร: ผู้บริหารกำหนดนโยบายจัดบริการอาชีวอนามัย',
      detail: 'แต่งตั้งคณะกรรมการอาชีวอนามัยชุดใหม่ ประชุมแล้ว 2 ครั้ง',
      driveLink: 'https://drive.google.com/', status: S.CHECKING,
      comment: 'อยู่ระหว่างตรวจสอบเอกสาร\n— สสจ.นครราชสีมา (16/08/2568 14:00)' }
  ];

  var users = dropdowns.fullData.map(function (r, i) {
    return {
      row: i + 2, district: r.district, type: r.type, hospital: r.hospital,
      password: '••••••', role: r.typeCode === 'PHO' ? 'admin' : 'user', contactName: ''
    };
  });

  return {
    dropdowns: dropdowns,
    masterData: { green: green, occ: occ },
    submissions: { status: 'success', count: submissions.length, data: submissions },
    users: { status: 'success', count: users.length, data: users }
  };
})();
