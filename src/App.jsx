import { useState, useEffect, useRef, useCallback } from "react";

// ─── Supabase Config ──────────────────────────────────────────────────────────
const SUPA_URL = "https://XXXX.supabase.co";   // ← เปลี่ยนตรงนี้
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.XXXX"; // ← เปลี่ยนตรงนี้

const supa = async (method, path, body = null) => {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      method,
      headers: {
        "apikey": SUPA_KEY,
        "Authorization": `Bearer ${SUPA_KEY}`,
        "Content-Type": "application/json",
        "Prefer": method === "POST" ? "return=representation" : "return=minimal",
      },
      body: body ? JSON.stringify(body) : null,
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, message: err };
    }
    const text = await res.text();
    return { success: true, data: text ? JSON.parse(text) : null };
  } catch (e) { return { success: false, message: String(e) }; }
};

// ─── API Layer (แปลง action → Supabase REST) ──────────────────────────────────
const call = async (action, params = {}) => {
  try {
    // ── GET EMPLOYEES ──
    if (action === "getEmployees") {
      const r = await supa("GET", "employees?select=*&order=id.asc");
      if (!r.success) return r;
      return { success: true, data: (r.data||[]).map(rowToEmp) };
    }

    // ── GET CONFIG ──
    if (action === "getConfig") {
      const r = await supa("GET", "config?select=*");
      if (!r.success) return r;
      const cfg = {};
      (r.data||[]).forEach(row => {
        try { cfg[row.key] = typeof row.value === "string" ? JSON.parse(row.value) : row.value; }
        catch { cfg[row.key] = row.value; }
      });
      return { success: true, data: cfg };
    }

    // ── SAVE CONFIG ──
    if (action === "saveConfig") {
      const val = params.data;
      const r = await supa("POST", "config", { key: params.configKey, value: val });
      if (!r.success) {
        // upsert ถ้ามีอยู่แล้ว
        const r2 = await supa("PATCH", `config?key=eq.${params.configKey}`, { value: val });
        return r2;
      }
      return r;
    }

    // ── GET RECORDS ──
    if (action === "getRecords") {
      const r = await supa("GET", "records?select=*&order=date.asc");
      if (!r.success) return r;
      const records = {};
      (r.data||[]).forEach(row => {
        const date = row.date, empId = row.emp_id;
        if (!date||!empId) return;
        if (!records[date]) records[date] = {};
        records[date][empId] = {
          checkIn:     row.check_in    || null,
          checkOut:    row.check_out   || null,
          checkInLat:  row.lat_in      || null,
          checkInLng:  row.lng_in      || null,
          checkOutLat: row.lat_out     || null,
          checkOutLng: row.lng_out     || null,
          leaveType:   row.leave_type  || null,
          leaveReason: row.leave_reason|| null,
          leaveStatus: row.leave_status|| null,
          approvedBy:  row.approved_by || null,
          breakStart:  row.break_start || null,
          breakEnd:    row.break_end   || null,
        };
      });
      return { success: true, data: records };
    }

    // ── CHECK IN ──
    if (action === "checkIn") {
      const { date, empId, time, lat, lng } = params;
      // Check ว่ามี record วันนี้แล้วหรือยัง
      const existing = await supa("GET", `records?date=eq.${date}&emp_id=eq.${empId}&select=id,check_in`);
      if (existing.success && existing.data?.length > 0) {
        const row = existing.data[0];
        if (row.check_in) return { success: true, alreadyCheckedIn: true, checkIn: row.check_in };
        // มี row แต่ยังไม่มี check_in (เช่น leave row) → update
        await supa("PATCH", `records?date=eq.${date}&emp_id=eq.${empId}`, { check_in: time, lat_in: lat||null, lng_in: lng||null });
        return { success: true };
      }
      // สร้าง row ใหม่
      const r = await supa("POST", "records", { date, emp_id: empId, check_in: time, lat_in: lat||null, lng_in: lng||null });
      if (!r.success) return r;
      return { success: true };
    }

    // ── CHECK OUT ──
    if (action === "checkOut") {
      const { date, empId, time, lat, lng } = params;
      const existing = await supa("GET", `records?date=eq.${date}&emp_id=eq.${empId}&select=id,check_out`);
      if (!existing.success || !existing.data?.length) return { success: false, message: "ไม่พบข้อมูลเช็คอิน" };
      if (existing.data[0].check_out) return { success: true, alreadyCheckedOut: true, checkOut: existing.data[0].check_out };
      await supa("PATCH", `records?date=eq.${date}&emp_id=eq.${empId}`, { check_out: time, lat_out: lat||null, lng_out: lng||null });
      return { success: true };
    }

    // ── BREAK START ──
    if (action === "breakStart") {
      const { date, empId, time } = params;
      const ex = await supa("GET", `records?date=eq.${date}&emp_id=eq.${empId}&select=id,break_start`);
      if (!ex.success || !ex.data?.length) return { success: false, message: "ไม่พบข้อมูลเช็คอิน" };
      if (ex.data[0].break_start) return { success: true, alreadyStarted: true, breakStart: ex.data[0].break_start };
      await supa("PATCH", `records?date=eq.${date}&emp_id=eq.${empId}`, { break_start: time });
      return { success: true };
    }

    // ── BREAK END ──
    if (action === "breakEnd") {
      const { date, empId, time } = params;
      const ex = await supa("GET", `records?date=eq.${date}&emp_id=eq.${empId}&select=id,break_end,break_start`);
      if (!ex.success || !ex.data?.length) return { success: false, message: "ไม่พบข้อมูล" };
      if (ex.data[0].break_end) return { success: true, alreadyEnded: true, breakEnd: ex.data[0].break_end };
      if (!ex.data[0].break_start) return { success: false, message: "ยังไม่ได้เริ่มพัก" };
      await supa("PATCH", `records?date=eq.${date}&emp_id=eq.${empId}`, { break_end: time });
      return { success: true };
    }

    // ── SUBMIT LEAVE ──
    if (action === "submitLeave") {
      const { empId, startDate, endDate, leaveType, reason } = params;
      const dates = [];
      let cur = new Date(startDate + "T12:00:00");
      const end = new Date(endDate + "T12:00:00");
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0,10));
        cur.setDate(cur.getDate()+1);
      }
      for (const date of dates) {
        const ex = await supa("GET", `records?date=eq.${date}&emp_id=eq.${empId}&select=id`);
        if (ex.success && ex.data?.length > 0) {
          await supa("PATCH", `records?date=eq.${date}&emp_id=eq.${empId}`, { leave_type: leaveType, leave_reason: reason, leave_status: "pending" });
        } else {
          await supa("POST", "records", { date, emp_id: empId, leave_type: leaveType, leave_reason: reason, leave_status: "pending" });
        }
      }
      return { success: true, days: dates.length };
    }

    // ── APPROVE / REJECT LEAVE ──
    if (action === "approveLeave" || action === "rejectLeave") {
      const { date, empId, approvedBy } = params;
      const status = action === "approveLeave" ? "approved" : "rejected";
      await supa("PATCH", `records?date=eq.${date}&emp_id=eq.${empId}`, { leave_status: status, approved_by: approvedBy });
      return { success: true, status };
    }

    // ── CANCEL LEAVE ──
    if (action === "cancelLeave") {
      const { date, empId } = params;
      await supa("PATCH", `records?date=eq.${date}&emp_id=eq.${empId}`, { leave_type: null, leave_reason: null, leave_status: null, approved_by: null });
      return { success: true };
    }

    // ── DELETE RECORD ──
    if (action === "deleteRecord") {
      const { date, empId } = params;
      await supa("DELETE", `records?date=eq.${date}&emp_id=eq.${empId}`);
      return { success: true };
    }

    // ── ADD EMPLOYEE ──
    if (action === "addEmployee") {
      const p = params;
      const row = {
        id: p.id, name: p.name, pin: p.pin, role: p.role||"employee",
        email: p.email||"", phone: p.phone||"", position: p.position||"",
        department: p.department||"", salary: p.salary||"", start_date: p.startDate||"",
        work_start: p.workStart||"", work_end: p.workEnd||"",
        grace_mins: p.graceMins?+p.graceMins:null,
        work_days: p.workDays||"",
        max_leave_days: p.maxLeaveDays?+p.maxLeaveDays:null,
        break_limit_mins: p.breakLimitMins?+p.breakLimitMins:60,
        note: p.note||"", avatar: p.avatar||"",
        week_schedule: p.weekSchedule ? (typeof p.weekSchedule==="string" ? JSON.parse(p.weekSchedule) : p.weekSchedule) : null,
      };
      const r = await supa("POST", "employees", row);
      return r;
    }

    // ── UPDATE EMPLOYEE ──
    if (action === "updateEmployee") {
      const p = params;
      const patch = {};
      if (p.name !== undefined)         patch.name = p.name;
      if (p.pin !== undefined)          patch.pin = p.pin;
      if (p.role !== undefined)         patch.role = p.role;
      if (p.email !== undefined)        patch.email = p.email;
      if (p.phone !== undefined)        patch.phone = p.phone;
      if (p.position !== undefined)     patch.position = p.position;
      if (p.department !== undefined)   patch.department = p.department;
      if (p.salary !== undefined)       patch.salary = p.salary;
      if (p.startDate !== undefined)    patch.start_date = p.startDate;
      if (p.workStart !== undefined)    patch.work_start = p.workStart;
      if (p.workEnd !== undefined)      patch.work_end = p.workEnd;
      if (p.graceMins !== undefined)    patch.grace_mins = p.graceMins!==""?+p.graceMins:null;
      if (p.workDays !== undefined)     patch.work_days = p.workDays;
      if (p.maxLeaveDays !== undefined) patch.max_leave_days = p.maxLeaveDays!==""?+p.maxLeaveDays:null;
      if (p.breakLimitMins !== undefined) patch.break_limit_mins = p.breakLimitMins!==""?+p.breakLimitMins:60;
      if (p.note !== undefined)         patch.note = p.note;
      if (p.avatar !== undefined)       patch.avatar = p.avatar;
      if (p.weekSchedule !== undefined) patch.week_schedule = p.weekSchedule ? (typeof p.weekSchedule==="string" ? JSON.parse(p.weekSchedule) : p.weekSchedule) : null;
      const r = await supa("PATCH", `employees?id=eq.${p.id}`, patch);
      return { success: r.success, message: r.message };
    }

    // ── DELETE EMPLOYEE ──
    if (action === "deleteEmployee") {
      const r = await supa("DELETE", `employees?id=eq.${params.id}`);
      return { success: r.success };
    }

    // ── DEDUPLICATE (ไม่จำเป็นแล้ว Supabase มี UNIQUE constraint) ──
    if (action === "deduplicateRecords") {
      return { success: true, deleted: 0 };
    }

    return { success: false, message: "unknown action: " + action };
  } catch (e) { return { success: false, message: String(e) }; }
};

// ── rowToEmp: แปลง Supabase row → format เดิม ──────────────────────────────
const rowToEmp = (r) => ({
  id:           r.id || "",
  name:         r.name || "",
  pin:          r.pin || "",
  role:         r.role || "employee",
  email:        r.email || "",
  phone:        r.phone || "",
  position:     r.position || "",
  department:   r.department || "",
  salary:       r.salary || "",
  startDate:    r.start_date || "",
  workStart:    r.work_start || "",
  workEnd:      r.work_end || "",
  graceMins:    r.grace_mins != null ? +r.grace_mins : null,
  workDays:     r.work_days || "",
  maxLeaveDays: r.max_leave_days != null ? +r.max_leave_days : null,
  breakLimitMins: r.break_limit_mins != null ? +r.break_limit_mins : 60,
  note:         r.note || "",
  avatar:       r.avatar || "",
  weekSchedule: r.week_schedule || null,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const haversine = (a,b,c,d) => {
  const R=6371000,dL=((c-a)*Math.PI)/180,dO=((d-b)*Math.PI)/180;
  const x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dO/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
};

// Bangkok local date — fixes timezone mismatch
const today = () => new Date().toLocaleDateString("en-CA", { timeZone:"Asia/Bangkok" });
const nowISO = () => new Date().toISOString();

const ft = iso => { if(!iso)return"—"; try{return new Date(iso).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Bangkok"})}catch{return iso}};
const fd = s => { if(!s)return"—"; try{const d=String(s).length===10?new Date(s+"T12:00:00"):new Date(s);return isNaN(d)?"—":d.toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"2-digit",timeZone:"Asia/Bangkok"})}catch{return s}};
const dm = (a,b) => { if(!a||!b)return null;const v=Math.round((new Date(b)-new Date(a))/60000);return v<0?null:v; };
const hm = m => { if(m==null||m<0)return"—";return`${Math.floor(m/60)}:${String(m%60).padStart(2,"0")}`; };
const addMin = (t,n) => { const[h,m]=t.split(":").map(Number),x=h*60+m+n;return`${String(Math.floor(x/60)).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`; };
const timeToMins = t => { if(!t)return 0;const[h,m]=t.split(":").map(Number);return h*60+m; };
const DAYS_TH = ["อา","จ","อ","พ","พฤ","ศ","ส"];

// OT calculation: net = gross - break, OT = net - normalMins (if >0)
// normalMins = schedule endTime - startTime (e.g. 08:00-18:00 = 600 min)
// Break deduction logic:
// - ถ้าพัก < limit (เช่น 60น.) → นับเป็น limit เต็ม (ceiling)
// - ถ้าพัก > limit → นับจริง (เกินไปกี่นาที)
// - ถ้ายังไม่กดพักเลย → หักตาม limit อยู่ดี (เพราะรวมในชั่วโมงทำงานปกติอยู่แล้ว)
const effectiveBreak = (bm, limitMins) => {
  const limit = limitMins ?? 60;
  if (bm == null) return limit;        // ยังไม่ได้กดพัก → หัก limit เต็ม
  if (bm <= limit) return limit;       // พักไม่ครบ → ยังหัก limit เต็ม
  return bm;                           // พักเกิน → หักตามจริง
};

// OT calculation:
// gross = checkOut - checkIn (นาที)
// effectiveBm = ceiling break (min = limitMins)
// net = gross - effectiveBm  (ชม.ทำงานสุทธิ)
// normalMins = endTime - startTime (ชม.ปกติทั้งหมด รวมพักแล้ว) = เช่น 600 น. สำหรับ 8:00-18:00
// OT = gross - normalMins  (เกินเวลาออกงาน = ทำงานเกินตาราง)
// Round check-in DOWN to nearest hour for OT calc
// 7:50-7:59 → 08:00, 9:50-9:59 → 10:00
const roundCheckInForOT = (checkIn) => {
  if (!checkIn) return null;
  const d = new Date(checkIn);
  const mins = d.getHours()*60 + d.getMinutes();
  const rounded = Math.ceil(mins / 60) * 60;  // round UP to next hour
  // Then we use the EARLIER of: actual or rounded-UP (which becomes the scheduled hour)
  // e.g. 7:50 → ceil → 8h*60 = 480 = 08:00
  return rounded; // minutes from midnight (rounded hour)
};

const calcOT = (checkIn, checkOut, breakStart, breakEnd, s) => {
  if (!checkIn || !checkOut || !s) return null;
  const gross = dm(checkIn, checkOut);
  if (gross == null) return null;
  const limit  = s.breakLimitMins ?? 60;
  const bmReal = dm(breakStart, breakEnd);
  const bmEff  = effectiveBreak(bmReal, limit);
  const net    = gross - bmEff;
  const normalGross = timeToMins(s.endTime) - timeToMins(s.startTime);

  // OT: use rounded check-in (7:50→8:00) vs actual check-out
  // gross_for_OT = checkOut - roundedCheckIn
  const ciRounded = roundCheckInForOT(checkIn); // mins from midnight
  const coMins = new Date(checkOut).getHours()*60 + new Date(checkOut).getMinutes();
  const grossForOT = coMins - ciRounded; // นาที จาก checkIn ปัดขึ้นถึง checkOut
  const ot = grossForOT - normalGross;  // OT = เกินเวลาปกติ

  return {
    gross,                    // เวลารวมจริง (checkOut - checkIn)
    grossForOT: Math.max(0, grossForOT), // เวลาหลังปัด checkIn
    bmReal,
    bmEff,
    net,
    normal: normalGross,
    ot:   Math.max(0, ot),
    isOT: ot > 0,
    overBreak: bmReal != null ? Math.max(0, bmReal - limit) : 0,
  };
};

// Break status pill
const breakStatus = (bm, limitMins) => {
  if (bm == null) return null;
  const limit = limitMins ?? 60;
  const over  = bm - limit;
  if (over > 0)  return { l:`พักเกิน ${over}น.`, c:"var(--red)",    bg:"var(--redBg)" };
  if (over === 0) return { l:`พักครบ ${hm(bm)}`,  c:"var(--acc)",    bg:"var(--accBg)" };
  return             { l:`พัก ${hm(bm)}/${limit}น.`, c:"var(--yellow)", bg:"var(--yellowBg)" };
};

// ─── Per-day-of-week schedule ────────────────────────────────────────────────
// weekSchedule: { "1":{"s":"08:00","e":"17:00"}, ... } null = off
// Returns null if day off, or {startTime, endTime, graceMins, maxLeaveDays}
const getScheduleForDate = (dateStr, emp, gSch) => {
  if (!dateStr) return null;
  const dow = new Date(dateStr + "T12:00:00").getDay();
  const ws = emp?.weekSchedule;
  const baseExtra = {
    graceMins:      emp?.graceMins      != null ? +emp.graceMins      : (gSch?.graceMins      ?? 15),
    maxLeaveDays:   emp?.maxLeaveDays   != null ? +emp.maxLeaveDays   : (gSch?.maxLeaveDays   ?? 10),
    breakLimitMins: emp?.breakLimitMins != null ? +emp.breakLimitMins : (gSch?.breakLimitMins ?? 60),
  };

  if (ws && typeof ws === "object" && Object.keys(ws).length > 0) {
    const day = ws[String(dow)];
    if (day === null) return null;              // null = ตั้งใจให้เป็นวันหยุด
    if (day && day.s && day.e) {               // มีตารางส่วนตัวสำหรับวันนี้
      return { startTime: day.s, endTime: day.e, ...baseExtra };
    }
    // day === undefined = วันนี้ไม่ได้ set ใน weekSchedule → fall through to global
  }

  // Fallback: global schedule
  const workDays = (emp?.workDays || gSch?.workDays || "1,2,3,4,5").split(",").filter(Boolean).map(Number);
  if (!workDays.includes(dow)) return null;    // ไม่ใช่วันทำงาน
  return {
    startTime:    emp?.workStart || gSch?.startTime || "08:30",
    endTime:      emp?.workEnd   || gSch?.endTime   || "17:30",
    ...baseExtra,
  };
};

// Get schedule for TODAY specifically
const getTodaySchedule = (emp, gSch) => getScheduleForDate(today(), emp, gSch);

const STATUS = (rec, s, now) => {
  if (!s) return { l:"วันหยุด", c:"var(--tx3)", bg:"transparent", isOff:true };
  if (!rec || !rec.checkIn) {
    // Check if work time has passed without check-in
    if (now) {
      const nowMins = now.getHours()*60+now.getMinutes();
      const startMins = timeToMins(s.startTime);
      if (nowMins > startMins + s.graceMins) return { l:"ขาดงาน/ยังไม่เข้า", c:"var(--orange)", bg:"var(--orangeBg)" };
      if (nowMins <= startMins + s.graceMins) return { l:"ยังไม่เข้างาน", c:"var(--tx2)", bg:"transparent" };
    }
    return { l:"ยังไม่เข้างาน", c:"var(--tx2)", bg:"transparent" };
  }
  if (rec.leaveType) {
    const ls = rec.leaveStatus || "pending";
    const lbl = {sick:"ลาป่วย",personal:"ลากิจ",vacation:"ลาพักร้อน"}[rec.leaveType]||"ลา";
    if (ls === "approved") return { l:`✓ ${lbl}`, c:"var(--purple)", bg:"var(--purpleBg)" };
    if (ls === "rejected") return { l:`✗ ${lbl}`, c:"var(--red)",    bg:"var(--redBg)" };
    return { l:`⏳ ${lbl} (รออนุมัติ)`, c:"var(--yellow)", bg:"var(--yellowBg)" };
  }
  if (!rec.checkOut) return { l:"กำลังทำงาน", c:"var(--acc)", bg:"var(--accBg)" };

  const cin  = new Date(rec.checkIn);
  const cout = new Date(rec.checkOut);
  const cM   = cin.getHours()*60+cin.getMinutes();
  const oM   = cout.getHours()*60+cout.getMinutes();
  const startMins = timeToMins(s.startTime);
  const endMins   = timeToMins(s.endTime);
  const late  = cM > startMins + s.graceMins;
  const early = oM < endMins;          // ออกก่อน endTime = ออกก่อนเวลา
  if (late && early) return { l:"สาย+ออกก่อน", c:"var(--orange)", bg:"var(--orangeBg)" };
  if (late)          return { l:`มาสาย ${cM-startMins}น.`, c:"var(--yellow)", bg:"var(--yellowBg)" };
  if (early)         return { l:"ออกก่อนเวลา", c:"var(--orange)", bg:"var(--orangeBg)" };
  return { l:"ปกติ ✓", c:"var(--acc)", bg:"var(--accBg)" };
};

// ─── Themes ───────────────────────────────────────────────────────────────────
const THEMES = [
  { id:"light",   name:"ใส",        emoji:"🌿", dark:false, bg:"#edfdf6",bg2:"#e0f9ef",bg3:"#f0fffe", card:"rgba(255,255,255,.86)",card2:"rgba(255,255,255,.66)", br:"rgba(0,0,0,.09)",br2:"rgba(0,0,0,.14)", tx:"rgba(0,0,0,.84)",tx2:"rgba(0,0,0,.5)",tx3:"rgba(0,0,0,.28)", acc:"#059669",acc2:"#0d9488", aB:"rgba(5,150,105,.12)",rB:"rgba(220,38,38,.1)",yB:"rgba(202,138,4,.12)",pB:"rgba(124,58,237,.12)",oB:"rgba(234,88,12,.12)", red:"#dc2626",yellow:"#ca8a04",purple:"#7c3aed",orange:"#ea580c" },
  { id:"vetclinic",name:"คลินิค🐾", emoji:"🐾", dark:false, bg:"#fff8f2",bg2:"#fff3e8",bg3:"#fff9f4", card:"rgba(255,255,255,.88)",card2:"rgba(255,255,255,.7)",  br:"rgba(0,0,0,.08)",br2:"rgba(0,0,0,.13)", tx:"rgba(0,0,0,.84)",tx2:"rgba(0,0,0,.5)",tx3:"rgba(0,0,0,.28)", acc:"#ea580c",acc2:"#d97706", aB:"rgba(234,88,12,.12)",rB:"rgba(220,38,38,.1)",yB:"rgba(202,138,4,.12)",pB:"rgba(124,58,237,.12)",oB:"rgba(234,88,12,.12)", red:"#dc2626",yellow:"#ca8a04",purple:"#7c3aed",orange:"#ea580c" },
  { id:"vetnight", name:"คลินิคกลางคืน🌙", emoji:"🌙", dark:true,  bg:"#160a00",bg2:"#1f0e00",bg3:"#120800", card:"rgba(255,255,255,.07)",card2:"rgba(255,255,255,.1)",  br:"rgba(251,146,60,.18)",br2:"rgba(251,146,60,.28)", tx:"rgba(255,255,255,.94)",tx2:"rgba(255,255,255,.5)",tx3:"rgba(255,255,255,.25)", acc:"#fb923c",acc2:"#f59e0b", aB:"rgba(251,146,60,.18)",rB:"rgba(248,113,113,.15)",yB:"rgba(251,191,36,.15)",pB:"rgba(192,132,252,.15)",oB:"rgba(251,146,60,.18)", red:"#f87171",yellow:"#fbbf24",purple:"#c084fc",orange:"#fb923c" },
  { id:"forest",   name:"ป่า",       emoji:"🌲", dark:true,  bg:"#071a12",bg2:"#0a2318",bg3:"#071510", card:"rgba(255,255,255,.07)",card2:"rgba(255,255,255,.1)",  br:"rgba(255,255,255,.1)",br2:"rgba(255,255,255,.16)", tx:"rgba(255,255,255,.94)",tx2:"rgba(255,255,255,.5)",tx3:"rgba(255,255,255,.25)", acc:"#34d399",acc2:"#2dd4bf", aB:"rgba(52,211,153,.14)",rB:"rgba(248,113,113,.13)",yB:"rgba(251,191,36,.13)",pB:"rgba(192,132,252,.13)",oB:"rgba(251,146,60,.13)", red:"#f87171",yellow:"#fbbf24",purple:"#c084fc",orange:"#fb923c" },
  { id:"ocean",    name:"ทะเล",      emoji:"🌊", dark:true,  bg:"#060f1f",bg2:"#0c1a35",bg3:"#08122a", card:"rgba(255,255,255,.07)",card2:"rgba(255,255,255,.1)",  br:"rgba(96,165,250,.15)",br2:"rgba(96,165,250,.25)", tx:"rgba(255,255,255,.94)",tx2:"rgba(255,255,255,.5)",tx3:"rgba(255,255,255,.25)", acc:"#38bdf8",acc2:"#67e8f9", aB:"rgba(56,189,248,.14)",rB:"rgba(248,113,113,.13)",yB:"rgba(251,191,36,.13)",pB:"rgba(192,132,252,.13)",oB:"rgba(251,146,60,.13)", red:"#f87171",yellow:"#fbbf24",purple:"#c084fc",orange:"#fb923c" },
  { id:"sakura",   name:"ซากุระ",    emoji:"🌸", dark:false, bg:"#fef2f8",bg2:"#fdf4ff",bg3:"#fff1f5", card:"rgba(255,255,255,.86)",card2:"rgba(255,255,255,.66)", br:"rgba(0,0,0,.08)",br2:"rgba(0,0,0,.13)", tx:"rgba(0,0,0,.82)",tx2:"rgba(0,0,0,.48)",tx3:"rgba(0,0,0,.27)", acc:"#db2777",acc2:"#9333ea", aB:"rgba(219,39,119,.11)",rB:"rgba(220,38,38,.09)",yB:"rgba(202,138,4,.1)",pB:"rgba(124,58,237,.1)",oB:"rgba(234,88,12,.1)", red:"#dc2626",yellow:"#ca8a04",purple:"#7c3aed",orange:"#ea580c" },
];
const TV = t => ({
  "--bg":t.bg,"--bg2":t.bg2,"--bg3":t.bg3,
  "--card":t.card,"--card2":t.card2,"--br":t.br,"--br2":t.br2,
  "--tx":t.tx,"--tx2":t.tx2,"--tx3":t.tx3,
  "--acc":t.acc,"--acc2":t.acc2,
  "--accBg":t.aB,"--redBg":t.rB,"--yellowBg":t.yB,"--purpleBg":t.pB,"--orangeBg":t.oB,
  "--red":t.red,"--yellow":t.yellow,"--purple":t.purple,"--orange":t.orange,
});

// ─── AnimBG ───────────────────────────────────────────────────────────────────
function AnimBG({ themeId }) {
  const cvs = useRef(null); const tRef = useRef(themeId);
  useEffect(() => { tRef.current = themeId; }, [themeId]);
  useEffect(() => {
    const c = cvs.current; if(!c) return;
    const ctx = c.getContext("2d"); let W, H, items=[], raf;
    const EM=["🐶","🐱","🦁","🐯","🐼","🦊","🐰","🦮","🐈","🦄","🐮","🐺","🩺","💉","🩻","🩹","💊","🧬","🌿","🌱","🍃","🐾","🐾","🐾"];
    const resize=()=>{W=c.width=window.innerWidth;H=c.height=window.innerHeight;};
    resize(); window.addEventListener("resize",resize);
    for(let i=0;i<36;i++) items.push({x:Math.random()*1200,y:Math.random()*800,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.35,a:Math.random()*Math.PI*2,va:(Math.random()-.5)*.01,s:16+Math.random()*22,op:0.04+Math.random()*.11,ch:EM[Math.floor(Math.random()*EM.length)],bo:Math.random()*Math.PI*2,bs:0.018+Math.random()*.025});
    const draw=()=>{
      ctx.clearRect(0,0,W,H);
      const th=THEMES.find(x=>x.id===tRef.current)||THEMES[0];
      const g=ctx.createLinearGradient(0,0,W,H);
      g.addColorStop(0,th.bg);g.addColorStop(.5,th.bg2);g.addColorStop(1,th.bg3);
      ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
      items.forEach(p=>{
        p.x+=p.vx;p.y+=p.vy+Math.sin(p.bo)*.2;p.a+=p.va;p.bo+=p.bs;
        if(p.x<-70)p.x=W+50;if(p.x>W+70)p.x=-50;
        if(p.y<-70)p.y=H+50;if(p.y>H+70)p.y=-50;
        ctx.save();ctx.globalAlpha=th.dark?p.op:p.op*.6;
        ctx.translate(p.x,p.y);ctx.rotate(p.a);
        ctx.font=`${p.s}px serif`;ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText(p.ch,0,0);ctx.restore();
      });
      raf=requestAnimationFrame(draw);
    };
    draw();
    return()=>{cancelAnimationFrame(raf);window.removeEventListener("resize",resize);};
  },[]);
  return <canvas ref={cvs} style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none"}}/>;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:'Noto Sans Thai',sans-serif;font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(128,128,128,.2);border-radius:4px}
.card{background:var(--card);border:1px solid var(--br);border-radius:16px;backdrop-filter:blur(22px)}
.card2{background:var(--card2);border:1px solid var(--br2);border-radius:12px;backdrop-filter:blur(16px)}
input,select,textarea{background:var(--card2);border:1px solid var(--br);color:var(--tx);padding:10px 14px;border-radius:10px;font-family:'Noto Sans Thai',sans-serif;font-size:14px;width:100%;outline:none;transition:border .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--accBg)}
input::placeholder,textarea::placeholder{color:var(--tx3)}
select option{background:var(--bg)}
button{cursor:pointer;font-family:'Noto Sans Thai',sans-serif;border:none;border-radius:10px;transition:all .15s;font-size:14px;font-weight:500}
button:hover{filter:brightness(1.07);transform:translateY(-1px)}
button:active{transform:scale(.97) translateY(0)}
button:disabled{opacity:.45;transform:none;cursor:not-allowed;filter:none}
.pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.fade{animation:fd .22s ease}
@keyframes fd{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.spin{animation:sp .8s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
@keyframes shake{0%,100%{transform:translateX(0)}30%,70%{transform:translateX(-5px)}50%{transform:translateX(5px)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes pop{0%{transform:scale(.85) translateX(-50%);opacity:0}100%{transform:scale(1) translateX(-50%);opacity:1}}
table{border-collapse:collapse;width:100%}
th{padding:9px 14px;text-align:left;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--acc);background:var(--card2);border-bottom:1px solid var(--br);font-weight:700}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid var(--br);color:var(--tx)}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--card2)}
input[type=range]{accent-color:var(--acc);background:transparent;border:none;padding:6px 0;cursor:pointer;width:100%}
input[type=time]{font-family:'JetBrains Mono',monospace;font-size:13px}
.lbl{font-size:11px;color:var(--tx2);display:block;margin-bottom:6px;font-weight:500}
.sec{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--acc);font-weight:700;margin-bottom:14px}
.mono{font-family:'JetBrains Mono',monospace}
`;

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({msg}){
  if(!msg)return null;
  return(
    <div style={{position:"fixed",bottom:80,left:"50%",zIndex:9999,background:msg.ok?"var(--acc)":"var(--red)",backdropFilter:"blur(14px)",color:"#fff",padding:"11px 22px",borderRadius:50,fontSize:13,fontWeight:600,boxShadow:"0 8px 32px rgba(0,0,0,.2)",animation:"pop .2s ease",whiteSpace:"nowrap",maxWidth:"88vw",textAlign:"center",display:"flex",alignItems:"center",gap:8}}>
      {msg.ok?"✓":"✗"} {msg.txt}
    </div>
  );
}
function Stat({label,value,color}){return(<div className="card2" style={{padding:"13px 8px",textAlign:"center"}}><div className="mono" style={{fontSize:22,fontWeight:700,color,lineHeight:1}}>{value}</div><div style={{fontSize:9,color:"var(--tx2)",marginTop:5,lineHeight:1.3}}>{label}</div></div>);}

// ─── Emoji Picker ─────────────────────────────────────────────────────────────
const EA=["🐶","🐱","🦁","🐯","🐼","🐨","🐸","🦊","🐰","🐹","🦮","🐩","🐈","🦄","🐮","🦛","🦒","🦓","🐺","🦝","🦔","🦋","🐢","🐬","🦅","🦉"];
const EM=["🩺","💉","🩸","🧬","🔬","🧪","💊","🩻","🩹","🏥","🚑","🌡️","🦷","🦴","🫀","🫁","🧠","⚕️","🌿","🌱","🍃","☘️","💚","❤️‍🩹","🐾","✦","⭐"];
function EmojiPicker({value,onChange,onClose}){
  const[cat,setCat]=useState("a");const list=cat==="a"?EA:EM;
  return(
    <div style={{position:"fixed",inset:0,zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16,background:"rgba(0,0,0,.55)",backdropFilter:"blur(8px)"}} onClick={onClose}>
      <div style={{background:"var(--bg)",border:"1px solid var(--br2)",borderRadius:20,padding:18,width:"100%",maxWidth:320,boxShadow:"0 24px 60px rgba(0,0,0,.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
          <span style={{fontSize:14,fontWeight:700,color:"var(--tx)"}}>เลือก Avatar</span>
          <button onClick={onClose} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"3px 10px",fontSize:12,borderRadius:8}}>✕</button>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:12}}>
          {[["a","🐾 สัตว์"],["m","🩺 การแพทย์"]].map(([k,l])=>(
            <button key={k} onClick={()=>setCat(k)} style={{flex:1,padding:8,background:cat===k?"var(--accBg)":"var(--card2)",color:cat===k?"var(--acc)":"var(--tx2)",border:`1px solid ${cat===k?"var(--acc)":"var(--br)"}`,borderRadius:10,fontSize:12,fontWeight:600}}>{l}</button>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,maxHeight:200,overflowY:"auto"}}>
          {list.map((em,i)=>(
            <button key={i} onClick={()=>{onChange(em);onClose();}} style={{aspectRatio:"1",background:value===em?"var(--accBg)":"transparent",border:`1.5px solid ${value===em?"var(--acc)":"transparent"}`,borderRadius:10,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>{em}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Theme Switcher ───────────────────────────────────────────────────────────
function ThemeSwitcher({current,onChange}){
  const[open,setOpen]=useState(false);
  return(
    <div style={{position:"fixed",bottom:20,right:16,zIndex:400}}>
      {open&&(
        <div style={{position:"absolute",bottom:52,right:0,background:"var(--bg)",border:"1px solid var(--br2)",borderRadius:16,padding:12,display:"flex",flexDirection:"column",gap:6,width:155,boxShadow:"0 8px 32px rgba(0,0,0,.2)",backdropFilter:"blur(16px)"}} onClick={e=>e.stopPropagation()}>
          {THEMES.map(th=>(
            <button key={th.id} onClick={()=>{onChange(th.id);setOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:th.id===current?"var(--accBg)":"transparent",border:`1px solid ${th.id===current?"var(--acc)":"transparent"}`,borderRadius:10,color:"var(--tx)",fontSize:13,fontWeight:th.id===current?700:400,textAlign:"left"}}>
              <span style={{fontSize:18}}>{th.emoji}</span>
              <div><div>{th.name}</div><div style={{display:"flex",gap:3,marginTop:3}}>{[th.bg,th.acc,th.red].map((c,i)=><span key={i} style={{width:8,height:8,borderRadius:"50%",background:c,border:"1px solid rgba(0,0,0,.1)",display:"inline-block"}}/>)}</div></div>
            </button>
          ))}
        </div>
      )}
      <button onClick={()=>setOpen(!open)} style={{width:44,height:44,borderRadius:"50%",background:"var(--card)",border:"1px solid var(--br2)",backdropFilter:"blur(16px)",fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(0,0,0,.15)",color:"var(--tx)"}}>🎨</button>
    </div>
  );
}

// ─── WeekSchedule Editor ──────────────────────────────────────────────────────
function WeekScheduleEditor({ value, onChange, globalSch }) {
  // value = object like {"1":{"s":"08:00","e":"17:00"}} or null
  const ws = value || {};
  const toggle = (dow) => {
    const next = { ...ws };
    if (next[String(dow)] !== undefined) {
      delete next[String(dow)]; // Remove = day off
    } else {
      // Add with default or global times
      next[String(dow)] = {
        s: globalSch?.startTime || "08:30",
        e: globalSch?.endTime   || "17:30",
      };
    }
    onChange(Object.keys(next).length > 0 ? next : null);
  };
  const setTime = (dow, field, val) => {
    const next = { ...ws, [String(dow)]: { ...(ws[String(dow)] || {}), [field]: val } };
    onChange(next);
  };
  const isActive = (dow) => ws[String(dow)] !== undefined;

  return (
    <div>
      <label className="lbl">ตารางงานรายวัน (กดวันเพื่อเปิด/ปิด)</label>
      <div style={{display:"grid",gap:8}}>
        {DAYS_TH.map((d,i) => {
          const on = isActive(i);
          const config = ws[String(i)] || {};
          return (
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:on?"var(--accBg)":"var(--card2)",borderRadius:10,border:`1px solid ${on?"var(--acc)":"var(--br)"}`}}>
              <button onClick={()=>toggle(i)} style={{width:36,height:36,borderRadius:9,background:on?"var(--acc)":"rgba(128,128,128,.2)",color:on?"#fff":"var(--tx3)",border:"none",fontWeight:700,fontSize:12,flexShrink:0}}>
                {d}
              </button>
              {on ? (
                <div style={{display:"flex",gap:8,flex:1,alignItems:"center"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:10,color:"var(--tx3)",marginBottom:3}}>เวลาเข้า</div>
                    <input type="time" value={config.s||"08:30"} onChange={e=>setTime(i,"s",e.target.value)} style={{padding:"6px 10px",fontSize:13}}/>
                  </div>
                  <div style={{color:"var(--tx3)",fontSize:16,paddingTop:18}}>–</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:10,color:"var(--tx3)",marginBottom:3}}>เวลาออก</div>
                    <input type="time" value={config.e||"17:30"} onChange={e=>setTime(i,"e",e.target.value)} style={{padding:"6px 10px",fontSize:13}}/>
                  </div>
                  <div style={{fontSize:11,color:"var(--tx2)",minWidth:50,textAlign:"right",paddingTop:18}}>
                    {config.s&&config.e?hm((timeToMins(config.e)-timeToMins(config.s))):""} ชม.
                  </div>
                </div>
              ) : (
                <span style={{fontSize:12,color:"var(--tx3)"}}>วันหยุด</span>
              )}
            </div>
          );
        })}
      </div>
      {Object.keys(ws).length === 0 && (
        <div style={{marginTop:8,fontSize:11,color:"var(--tx3)"}}>ปล่อยว่าง = ใช้ตารางงาน Default</div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [employees,setEmp]    = useState([]);
  const [records,  setRec]    = useState({});
  const [location, setLoc]    = useState(null);
  const [gSch,     setGSch]   = useState(null);
  const [clinic,   setClinic] = useState(null);
  const [user,     setUser]   = useState(null);
  const [view,     setView]   = useState("login");
  const [loading,  setLoad]   = useState(true);
  const [err,      setErr]    = useState("");
  const [toast,    setToast]  = useState(null);
  const [themeId, setTheme] = useState(()=>{
    try{ return localStorage.getItem("tv_theme")||"vetclinic"; }catch{ return "vetclinic"; }
  });
  const changeTheme = (id)=>{ setTheme(id); try{ localStorage.setItem("tv_theme",id); }catch{} };

  const th = THEMES.find(x=>x.id===themeId)||THEMES[0];
  const showToast = useCallback((ok,txt)=>{ setToast({ok,txt}); setTimeout(()=>setToast(null),4000); },[]);

  const loadAll = useCallback(async()=>{
    setLoad(true); setErr("");
    const [er,rr,cr] = await Promise.all([call("getEmployees"),call("getRecords"),call("getConfig")]);
    if(!er.success){ setErr("เชื่อมต่อไม่สำเร็จ"); setLoad(false); return; }
    setEmp(er.data||[]);
    if(rr.success) setRec(rr.data||{});
    if(cr.success){ setLoc(cr.data?.location||null); setGSch(cr.data?.schedule||null); setClinic(cr.data?.clinic||null); }
    setLoad(false);
  },[]);

  useEffect(()=>{ loadAll(); },[]);

  // Soft reload records only (no full reload)
  const reloadRec = useCallback(async()=>{
    const r = await call("getRecords");
    if(r.success) setRec(r.data||{});
  },[]);
  const reloadEmp = useCallback(async()=>{
    const r = await call("getEmployees");
    if(r.success) setEmp(r.data||[]);
  },[]);

  const login  = u => { setUser(u); setView(u.role==="admin"?"admin":"dash"); };
  const logout = () => { setUser(null); setView("login"); };

  const ws = { ...TV(th), minHeight:"100vh", position:"relative" };

  if(loading) return(
    <div style={{...ws,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:14}}>
      <style>{CSS}</style><AnimBG themeId={themeId}/>
      <div style={{width:46,height:46,border:"3px solid var(--br2)",borderTopColor:"var(--acc)",borderRadius:"50%"}} className="spin"/>
      <div style={{color:"var(--tx2)",fontSize:12,letterSpacing:3,textTransform:"uppercase"}}>กำลังโหลด...</div>
    </div>
  );

  return(
    <div style={ws}>
      <style>{CSS}</style><AnimBG themeId={themeId}/>
      <Toast msg={toast}/>
      <ThemeSwitcher current={themeId} onChange={changeTheme}/>
      <div style={{position:"relative",zIndex:1}}>
        {view==="login" && <Login employees={employees} err={err} clinic={clinic} onLogin={login} onRetry={loadAll}/>}
        {view==="dash"  && <Dash  user={user} empList={employees} records={records} location={location} gSch={gSch} clinic={clinic} setRec={setRec} onReloadRec={reloadRec} onReloadEmp={reloadEmp} onLogout={logout} showToast={showToast}/>}
        {view==="admin" && <AdminPanel user={user} employees={employees} records={records} location={location} gSch={gSch} clinic={clinic} onReloadAll={loadAll} onReloadRec={reloadRec} onLogout={logout} showToast={showToast}/>}
      </div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({employees,err,clinic,onLogin,onRetry}){
  const SK_ID  = "tv_id";
  const SK_PIN = "tv_pin";
  const SK_REM = "tv_remember";
  const ls = (k,d="")=>{ try{ return localStorage.getItem(k)||d; }catch{return d;} };
  const lsSet = (k,v)=>{ try{ localStorage.setItem(k,v); }catch{} };
  const lsDel = (k)=>{ try{ localStorage.removeItem(k); }catch{} };

  const remembered = ls(SK_REM)==="1";
  const[id,setId]       = useState(()=>ls(SK_ID,""));
  const[pin,setPin]     = useState(()=>remembered ? ls(SK_PIN,"") : "");
  const[remember,setRemember] = useState(remembered);
  const[showPin,setShowPin]   = useState(false);
  const[error,setError] = useState("");
  const[shake,setShake] = useState(false);
  const[now,setNow]     = useState(new Date());
  const pinRef = useRef(null);

  useEffect(()=>{
    // Auto-focus PIN if ID already filled
    if(id && pinRef.current) setTimeout(()=>pinRef.current?.focus(),100);
    const t=setInterval(()=>setNow(new Date()),1000);
    return()=>clearInterval(t);
  },[]);

  const handleId=(v)=>{
    const uid=v.toUpperCase();
    setId(uid);
    lsSet(SK_ID,uid);
    // If switching user, clear saved PIN for security
    if(uid!==ls(SK_ID)) { setPin(""); lsDel(SK_PIN); }
  };

  const handleRemember=(checked)=>{
    setRemember(checked);
    lsSet(SK_REM, checked?"1":"0");
    if(!checked){ lsDel(SK_PIN); } // Clear saved PIN immediately when unchecked
  };

  const go=()=>{
    const uid=id.trim().toUpperCase();
    const u=employees.find(e=>e.id===uid&&String(e.pin)===String(pin));
    if(u){
      lsSet(SK_ID,uid);
      if(remember){ lsSet(SK_PIN,pin); lsSet(SK_REM,"1"); }
      else { lsDel(SK_PIN); lsSet(SK_REM,"0"); }
      onLogin(u);
    } else {
      setError("รหัสพนักงานหรือ PIN ไม่ถูกต้อง");
      setPin("");
      if(remember){ lsDel(SK_PIN); } // Clear wrong PIN from storage
      setShake(true); setTimeout(()=>setShake(false),500);
      setTimeout(()=>pinRef.current?.focus(),100);
    }
  };

  return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{width:"100%",maxWidth:360,animation:shake?"shake .4s":""}}>
        {/* Brand */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:80,height:80,background:"var(--accBg)",border:"2px solid var(--acc)",borderRadius:24,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:40,boxShadow:"0 0 40px var(--accBg)"}}>🐾</div>
          <div style={{fontSize:22,fontWeight:800,color:"var(--tx)"}}>{clinic?.name||"คลินิคท่านาสัตวแพทย์"}</div>
          <div style={{color:"var(--tx2)",fontSize:11,marginTop:3,letterSpacing:3,textTransform:"uppercase"}}>Staff Portal</div>
          <div className="mono" style={{fontSize:52,fontWeight:600,color:"var(--acc)",marginTop:16,letterSpacing:4,lineHeight:1}}>
            {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Bangkok"})}
          </div>
          <div style={{color:"var(--tx2)",fontSize:12,marginTop:6}}>{now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Bangkok"})}</div>
        </div>

        <div className="card" style={{padding:"26px 26px 22px"}}>
          {err&&<div style={{background:"var(--redBg)",border:"1px solid var(--red)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12,color:"var(--red)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <span>⚠ {err}</span>
            <button onClick={onRetry} style={{background:"none",color:"var(--acc)",border:"1px solid var(--acc)",padding:"3px 10px",fontSize:11,borderRadius:7,flexShrink:0}}>ลองใหม่</button>
          </div>}

          {/* Employee selector — show avatar+name if found */}
          {(()=>{
            const found = employees.find(e=>e.id===id.trim().toUpperCase());
            return found ? (
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"var(--accBg)",border:"1px solid var(--acc)50",borderRadius:10,marginBottom:12}}>
                <span style={{fontSize:24}}>{found.avatar||"🐾"}</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14,color:"var(--tx)"}}>{found.name}</div>
                  <div style={{fontSize:11,color:"var(--tx2)"}}>{found.position||found.id}{found.department?` · ${found.department}`:""}</div>
                </div>
                <button onClick={()=>{setId("");setPin("");lsDel(SK_PIN);setTimeout(()=>document.getElementById("tv-id-input")?.focus(),50);}} style={{background:"var(--card2)",color:"var(--tx3)",border:"1px solid var(--br)",padding:"4px 10px",fontSize:11,borderRadius:7}}>เปลี่ยน</button>
              </div>
            ) : (
              <div style={{marginBottom:12}}>
                <label className="lbl">รหัสพนักงาน</label>
                <input id="tv-id-input" placeholder="เช่น MAX01" value={id} onChange={e=>handleId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&pinRef.current?.focus()} style={{textTransform:"uppercase",fontSize:15,letterSpacing:1}} autoComplete="username" list="emp-list"/>
                <datalist id="emp-list">
                  {employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                </datalist>
              </div>
            );
          })()}

          {/* PIN field */}
          <div style={{marginBottom:14}}>
            <label className="lbl">รหัส PIN</label>
            <div style={{position:"relative"}}>
              <input
                ref={pinRef}
                type={showPin?"text":"password"}
                placeholder="• • • •"
                value={pin}
                onChange={e=>setPin(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&go()}
                style={{fontSize:20,letterSpacing:showPin?2:6,paddingRight:44}}
                autoComplete={remember?"current-password":"off"}
              />
              <button
                onClick={()=>setShowPin(!showPin)}
                style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",color:"var(--tx3)",fontSize:16,padding:"4px 6px",borderRadius:6}}
                tabIndex={-1}
                title={showPin?"ซ่อน PIN":"แสดง PIN"}
              >
                {showPin?"🙈":"👁"}
              </button>
            </div>
          </div>

          {/* Remember me */}
          <label style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,cursor:"pointer",userSelect:"none"}}>
            <div
              onClick={()=>handleRemember(!remember)}
              style={{width:40,height:22,borderRadius:11,background:remember?"var(--acc)":"var(--card2)",border:`1.5px solid ${remember?"var(--acc)":"var(--br)"}`,position:"relative",transition:"all .2s",flexShrink:0}}
            >
              <div style={{width:16,height:16,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:remember?20:2,transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.2)"}}/>
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:500,color:"var(--tx)"}}>จดจำการเข้าสู่ระบบ</div>
              <div style={{fontSize:10,color:"var(--tx3)"}}>บันทึกรหัสพนักงานและ PIN ไว้ในอุปกรณ์นี้</div>
            </div>
          </label>

          {error&&<div style={{background:"var(--redBg)",border:"1px solid var(--red)50",borderRadius:9,padding:"10px 14px",marginBottom:14,fontSize:13,color:"var(--red)"}}>✗ {error}</div>}

          <button onClick={go} style={{width:"100%",padding:13,background:"linear-gradient(135deg,var(--acc),var(--acc2))",color:"#fff",fontWeight:700,fontSize:15,borderRadius:12,boxShadow:"0 4px 20px var(--accBg)",letterSpacing:.5}}>
            เข้าสู่ระบบ →
          </button>

          {employees.length===0&&<div style={{marginTop:12,textAlign:"center",fontSize:11,color:"var(--tx3)"}}>⚠ ไม่พบข้อมูลพนักงาน</div>}

          {/* Security note */}
          {remember&&<div style={{marginTop:12,fontSize:10,color:"var(--tx3)",textAlign:"center",lineHeight:1.6}}>
            🔒 PIN จะถูกเก็บในอุปกรณ์นี้เท่านั้น — อย่าใช้กับอุปกรณ์สาธารณะ
          </div>}
        </div>
      </div>
    </div>
  );
}

// ─── Dash ─────────────────────────────────────────────────────────────────────
function Dash({user,empList,records,location,gSch,clinic,setRec,onReloadRec,onReloadEmp,onLogout,showToast}){
  const[tab,setTab]=useState("checkin");
  const[gps,setGps]=useState("idle"); // idle|checking|ok|err|far
  const[gd,setGd]=useState(null);
  const[gMsg,setGMsg]=useState("");
  // ✅ Key fix: local session overrides — never lost on server reload
  const[localCI,setLocalCI]=useState(null);   // ISO string of local check-in this session
  const[localCO,setLocalCO]=useState(null);   // ISO string of local check-out
  const[localBS,setLocalBS]=useState(null);   // break start
  const[localBE,setLocalBE]=useState(null);   // break end
  const[busy,setBusy]=useState(false);
  const[lf,setLf]=useState({type:"sick",start:today(),end:today(),reason:""});
  const[now,setNow]=useState(new Date());
  const[pf,setPf]=useState({});
  const[showEmoji,setShowEmoji]=useState(false);
  const[newPin,setNewPin]=useState("");const[cfPin,setCfPin]=useState("");const[showPin,setShowPin]=useState(false);
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);

  const me = empList.find(e=>e.id===user.id)||user;
  useEffect(()=>{ setPf({email:me.email||"",phone:me.phone||"",note:me.note||"",avatar:me.avatar||"🐾"}); },[me.id]);

  // Sync from server — use ref to track initialization, avoids overwriting optimistic updates
  const syncedFromServer = useRef(false);
  useEffect(()=>{
    // Reset sync flag when user changes (re-login)
    syncedFromServer.current = false;
  },[user.id]);

  useEffect(()=>{
    if(syncedFromServer.current) return; // Already initialized this session
    const tr = records[today()]?.[user.id];
    if(!tr) return; // Records not loaded yet — will retry on next update
    // Sync all local state from server (only once per login session)
    syncedFromServer.current = true;
    if(tr.checkIn)    setLocalCI(tr.checkIn);
    if(tr.checkOut)   setLocalCO(tr.checkOut);
    if(tr.breakStart) setLocalBS(tr.breakStart);
    if(tr.breakEnd)   setLocalBE(tr.breakEnd);
  },[records, user.id]);

  const s = getTodaySchedule(me, gSch);
  const todRec = records[today()]?.[user.id];
  // Merge server record with local session state
  const effectiveRec = {
    ...(todRec||{}),
    checkIn:    localCI || todRec?.checkIn    || null,
    checkOut:   localCO || todRec?.checkOut   || null,
    breakStart: localBS || todRec?.breakStart || null,
    breakEnd:   localBE || todRec?.breakEnd   || null,
    leaveType:  todRec?.leaveType  || null,
    leaveStatus:todRec?.leaveStatus|| null,
  };
  const st = STATUS(effectiveRec, s, now);

  const myRecs = Object.entries(records).flatMap(([d,r])=>r[user.id]?[{date:d,...r[user.id]}]:[]).sort((a,b)=>b.date.localeCompare(a.date));
  const mo=today().slice(0,7), yr=today().slice(0,4);
  const moRecs = myRecs.filter(r=>r.date.startsWith(mo));
  const leaveUsed  = myRecs.filter(r=>r.leaveType&&r.date.startsWith(yr)).length;
  const s2 = s || { maxLeaveDays: me?.maxLeaveDays ?? gSch?.maxLeaveDays ?? 10 };
  const leaveLeft  = Math.max(0, s2.maxLeaveDays - leaveUsed);
  const moHrs = moRecs.reduce((x,r)=>x+(dm(r.checkIn,r.checkOut)||0),0); // gross
  // Net hrs (deduct break with ceiling) and OT this month
  const moNet = moRecs.reduce((x,r)=>{ const s3=getScheduleForDate(r.date,me,gSch); const res=calcOT(r.checkIn,r.checkOut,r.breakStart,r.breakEnd,s3); return x+(res?.gross??0); },0); // gross = รวมพักด้วย
  const moOT  = moRecs.reduce((x,r)=>{ const s3=getScheduleForDate(r.date,me,gSch); const res=calcOT(r.checkIn,r.checkOut,r.breakStart,r.breakEnd,s3); return x+(res?.ot??0); },0);
  // Today OT (live)
  const todayOTres = calcOT(effectiveRec.checkIn, effectiveRec.checkOut||new Date().toISOString(), effectiveRec.breakStart, effectiveRec.breakEnd, s);
  const todayNet  = todayOTres?.gross ?? null; // gross รวมพักด้วย
  const todayOT   = todayOTres?.isOT ? todayOTres.ot : 0;

  // ── GPS check ──────────────────────────────────────────────────────────────
  const checkGPS = () => {
    setGps("checking"); setGMsg("");
    if(!navigator.geolocation){ setGps("err"); setGMsg("เบราว์เซอร์ไม่รองรับ GPS"); return; }
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const{latitude:lat,longitude:lng,accuracy:acc}=pos.coords;
        if(!location?.lat||!location?.lng){ setGps("ok"); setGd({lat,lng,acc,dist:0}); setGMsg("✓ รับพิกัดสำเร็จ"); return; }
        const dist=haversine(lat,lng,+location.lat,+location.lng);
        setGd({lat,lng,acc,dist});
        dist<=(+location.radius||200)?(setGps("ok"),setGMsg(`✓ อยู่ในพื้นที่ — ห่าง ${Math.round(dist)} ม.`)):(setGps("far"),setGMsg(`✗ นอกพื้นที่ — ห่าง ${Math.round(dist)} ม.`));
      },
      ()=>{ setGps("err"); setGMsg("ไม่ได้รับสัญญาณ — กรุณาอนุญาต Location"); },
      { enableHighAccuracy:true, timeout:14000 }
    );
  };

  // ✅ Optimistic update + NO immediate reload (prevents state loss)
  const doIn = async () => {
    if(gps!=="ok"||busy||localCI||effectiveRec.checkIn) return;
    setBusy(true);
    const time = nowISO();
    setLocalCI(time); // Immediately update UI
    const r = await call("checkIn",{date:today(),empId:user.id,time,lat:gd.lat,lng:gd.lng});
    if(r.success){
      showToast(true, "เช็คอินสำเร็จ ✓ "+ft(time));
      if(r.alreadyCheckedIn && r.checkIn) setLocalCI(r.checkIn);
      // Reload after 4s to let Sheet propagate
      setTimeout(()=>onReloadRec(), 4000);
    } else {
      setLocalCI(null); // Rollback
      showToast(false, r.message||"เช็คอินไม่สำเร็จ");
    }
    setBusy(false);
  };

  const doOut = async () => {
    if(gps!=="ok"||busy||localCO||effectiveRec.checkOut) return;
    if(!effectiveRec.checkIn){ showToast(false,"กรุณาเช็คอินก่อน"); return; }
    setBusy(true);
    const time = nowISO();
    setLocalCO(time);
    const r = await call("checkOut",{date:today(),empId:user.id,time,lat:gd.lat,lng:gd.lng});
    if(r.success){
      showToast(true, "เช็คเอาท์สำเร็จ ✓ "+ft(time));
      if(r.alreadyCheckedOut && r.checkOut) setLocalCO(r.checkOut);
      setTimeout(()=>onReloadRec(), 4000);
    } else {
      setLocalCO(null);
      showToast(false, r.message||"เช็คเอาท์ไม่สำเร็จ");
    }
    setBusy(false);
  };

  const doBreakStart = async () => {
    // Double-check with server record to prevent multiple breaks
    const serverRec = records[today()]?.[user.id];
    if(gps!=="ok"||busy) return;
    if(serverRec?.breakStart || effectiveRec.breakStart) { 
      // Already has break — sync and show proper state
      if(serverRec?.breakStart) setLocalBS(serverRec.breakStart);
      if(serverRec?.breakEnd)   setLocalBE(serverRec.breakEnd);
      showToast(false,"เริ่มพักแล้ว — ใช้ปุ่ม 'กลับมาแล้ว'"); return;
    }
    if(!effectiveRec.checkIn||effectiveRec.checkOut) return;
    setBusy(true);
    const time = nowISO();
    setLocalBS(time);
    const r = await call("breakStart",{date:today(),empId:user.id,time,lat:gd.lat,lng:gd.lng});
    if(r.success){
      if(r.alreadyStarted && r.breakStart) setLocalBS(r.breakStart);
      showToast(true,"เริ่มพักแล้ว ☕ "+ft(time));
      setTimeout(()=>onReloadRec(),4000);
    } else { setLocalBS(null); showToast(false,r.message||"ผิดพลาด"); }
    setBusy(false);
  };
  const doBreakEnd = async () => {
    const serverRec2 = records[today()]?.[user.id];
    if(gps!=="ok"||busy) return;
    if(serverRec2?.breakEnd || effectiveRec.breakEnd) {
      if(serverRec2?.breakEnd) setLocalBE(serverRec2.breakEnd);
      showToast(false,"กลับจากพักแล้ว"); return;
    }
    // Ensure we have breakStart (from server or local)
    const bs = localBS || serverRec2?.breakStart;
    if(!bs) { showToast(false,"กรุณากดเริ่มพักก่อน"); return; }
    if(!localBS && bs) setLocalBS(bs); // sync if missing
    setBusy(true);
    const time = nowISO();
    setLocalBE(time);
    const r = await call("breakEnd",{date:today(),empId:user.id,time,lat:gd.lat,lng:gd.lng});
    if(r.success){
      if(r.alreadyEnded && r.breakEnd) setLocalBE(r.breakEnd);
      showToast(true,"กลับมาแล้ว ✓ "+ft(time));
      setTimeout(()=>onReloadRec(),4000);
    } else { setLocalBE(null); showToast(false,r.message||"ผิดพลาด"); }
    setBusy(false);
  };
  const doLeave = async () => {
    if(!lf.reason.trim()){ showToast(false,"กรุณาระบุเหตุผล"); return; }
    if(leaveLeft<=0){ showToast(false,"วันลาไม่เพียงพอ"); return; }
    setBusy(true);
    const r=await call("submitLeave",{empId:user.id,startDate:lf.start,endDate:lf.end,leaveType:lf.type,reason:lf.reason});
    r.success?(await onReloadRec(),showToast(true,`ส่งคำขอลาสำเร็จ (${r.days} วัน) — รออนุมัติ`)):showToast(false,r.message);
    setBusy(false);
  };

  const saveProfile=async()=>{ setBusy(true);const r=await call("updateEmployee",{id:user.id,...pf});r.success?(await onReloadEmp(),showToast(true,"บันทึกโปรไฟล์สำเร็จ")):showToast(false,r.message);setBusy(false); };
  const changePIN=async()=>{
    if(newPin.length<4){ showToast(false,"PIN ต้องมีอย่างน้อย 4 ตัว"); return; }
    if(newPin!==cfPin){ showToast(false,"PIN ทั้งสองไม่ตรงกัน"); return; }
    setBusy(true);
    const r=await call("updateEmployee",{id:user.id,pin:newPin});
    r.success?(await onReloadEmp(),showToast(true,"เปลี่ยน PIN สำเร็จ"),setNewPin(""),setCfPin(""),setShowPin(false)):showToast(false,r.message);
    setBusy(false);
  };
  const exportCSV=()=>{
    const rows=[["วันที่","เข้างาน","ออกงาน","เริ่มพัก","กลับจากพัก","พัก(น.)","สถานะพัก","ชม.ปกติ(ตาราง)","ชม.รวม(รวมพัก)","OT(น.)","OT(ชม:น.)","สถานะงาน"]];
    myRecs.forEach(r=>{ const s3=getScheduleForDate(r.date,me,gSch);const st3=STATUS(r,s3);const bm=dm(r.breakStart,r.breakEnd);const total=dm(r.checkIn,r.checkOut);const net=total!=null?total-(bm||0):null;const bs=breakStatus(bm,s3?.breakLimitMins); const otRes3=calcOT(r.checkIn,r.checkOut,r.breakStart,r.breakEnd,s3); rows.push([r.date,ft(r.checkIn),ft(r.checkOut),ft(r.breakStart),ft(r.breakEnd),bm!=null?bm:"",bs?bs.l:"",otRes3?hm(otRes3.normal):"",otRes3?hm(otRes3.gross):"",otRes3?.ot||"",otRes3?.isOT?hm(otRes3.ot):"",st3.l]); });
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(x=>x.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));a.download=`att_${user.id}_${today()}.csv`;a.click();
  };

  const gCol={idle:"var(--tx3)",checking:"var(--yellow)",ok:"var(--acc)",err:"var(--red)",far:"var(--red)"}[gps];
  const hasCI    = !!(localCI || effectiveRec.checkIn);
  const hasCO    = !!(localCO || effectiveRec.checkOut);
  const svrRec   = records[today()]?.[user.id];  // server record for today
  const hasBS    = !!(localBS || effectiveRec.breakStart || svrRec?.breakStart);
  const hasBE    = !!(localBE || effectiveRec.breakEnd   || svrRec?.breakEnd);
  const canIn    = gps==="ok" && !hasCI && !busy; // อนุญาตเช็คอินแม้มีใบลา (override ได้)
  const onBreak  = hasBS && !hasBE;   // กำลังพักอยู่จริงๆ
  const canOut   = gps==="ok" && hasCI && !hasCO && !onBreak && !busy; // ออกได้ถ้าไม่ได้พักอยู่
  const canBreakStart = gps==="ok" && hasCI && !hasCO && !hasBS && !busy;
  const canBreakEnd   = gps==="ok" && onBreak && !busy;
  const breakMins = dm(localBS||effectiveRec.breakStart, localBE||effectiveRec.breakEnd);
  const workMinsNet = (()=>{ const total=dm(effectiveRec.checkIn,effectiveRec.checkOut); if(!total) return null; return total-(breakMins||0); })();
  const wsArr    = s ? Object.entries(typeof me.weekSchedule==="object"?me.weekSchedule||{}:{}) : [];

  return(
    <div style={{maxWidth:500,margin:"0 auto",padding:"12px 12px 80px"}}>
      {showEmoji&&<EmojiPicker value={pf.avatar} onChange={av=>setPf({...pf,avatar:av})} onClose={()=>setShowEmoji(false)}/>}

      {/* Topbar */}
      <div className="card2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:40,height:40,background:"var(--accBg)",border:"1.5px solid var(--acc)",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{me.avatar||"🐾"}</div>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:"var(--tx)",lineHeight:1.3}}>{me.name}</div>
            <div style={{fontSize:11,color:"var(--tx2)"}}>{me.position||me.id}{me.department?` · ${me.department}`:""}</div>
          </div>
        </div>
        <button onClick={onLogout} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"6px 12px",fontSize:12}}>ออก</button>
      </div>

      {/* Clock card */}
      <div className="card" style={{padding:"20px",marginBottom:10,textAlign:"center",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,transparent,var(--acc),var(--acc2),transparent)"}}/>
        <div className="mono" style={{fontSize:54,fontWeight:600,color:"var(--acc)",letterSpacing:4,lineHeight:1}}>
          {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Bangkok"})}
        </div>
        <div style={{color:"var(--tx2)",fontSize:12,marginTop:5}}>{now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Bangkok"})}</div>
        {/* Status badges */}
        <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginTop:12}}>
          {!st.isOff&&<span className="pill" style={{background:st.bg,color:st.c,border:`1px solid ${st.c}40`}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:st.c,animation:"pulse 2s infinite",display:"inline-block"}}/>
            {st.l}
          </span>}
          {hasCI&&<span className="pill" style={{background:"var(--accBg)",color:"var(--acc)",border:"1px solid var(--acc)40"}}>▶ {ft(localCI||effectiveRec.checkIn)}</span>}
          {hasCO&&<span className="pill" style={{background:"var(--redBg)",color:"var(--red)",border:"1px solid var(--red)40"}}>■ {ft(localCO||effectiveRec.checkOut)}</span>}
          {hasBS&&!hasBE&&(()=>{
            const bsTime = localBS||effectiveRec.breakStart||svrRec?.breakStart;
            const liveMins=dm(bsTime,now.toISOString());
            const limit=s?.breakLimitMins??60;
            const over=liveMins!=null&&liveMins>limit;
            // Show "หัก 60น." when under limit
            const deductLabel = !over ? ` (หัก ${limit}น.)` : ` (⚠ เกิน ${liveMins-limit}น.)`;
            return <span className="pill" style={{background:over?"var(--redBg)":"var(--yellowBg)",color:over?"var(--red)":"var(--yellow)",border:`1px solid ${over?"var(--red)":"var(--yellow)"}40`,animation:"pulse 2s infinite"}}>
              {over?"🔴":"☕"} พักอยู่ {liveMins!=null?hm(liveMins):"..."}{deductLabel}
            </span>;
          })()}
          {hasBE&&(()=>{
            const bm2=dm(effectiveRec.breakStart,effectiveRec.breakEnd);
            const limit2=s?.breakLimitMins??60;
            const bmEff2=bm2!=null?(bm2<=limit2?limit2:bm2):limit2;
            const bs2=breakStatus(bm2,limit2);
            const deductLabel = bm2!=null&&bm2<limit2?` (หักเต็ม ${limit2}น.)` : "";
            return bs2?<span className="pill" style={{background:bs2.bg,color:bs2.c}}>☕ {bs2.l}{deductLabel}</span>:null;
          })()}
          {todRec?.leaveStatus&&<span className="pill" style={{background:{pending:"var(--yellowBg)",approved:"var(--accBg)",rejected:"var(--redBg)"}[todRec.leaveStatus],color:{pending:"var(--yellow)",approved:"var(--acc)",rejected:"var(--red)"}[todRec.leaveStatus]}}>{todRec.leaveStatus==="pending"?"⏳ รออนุมัติ":todRec.leaveStatus==="approved"?"✓ อนุมัติ":"✗ ไม่อนุมัติ"}</span>}
        </div>
        {/* Schedule info */}
        {s ? (
          <div style={{marginTop:12,padding:"8px 14px",background:"var(--card2)",borderRadius:10,display:"flex",flexWrap:"wrap",gap:12,justifyContent:"center",fontSize:11,color:"var(--tx2)"}}>
            <span>🕐 {s.startTime}–{s.endTime} ({hm(timeToMins(s.endTime)-timeToMins(s.startTime))}ชม.รวมพัก)</span>
            <span>⏱ ผ่อนผัน {s.graceMins}น.</span>
            <span>☕ พัก {s.breakLimitMins??60}น./วัน (นับเต็ม)</span>
            {location?.name&&<span>📍 {location.name}</span>}
          </div>
        ) : (
          <div style={{marginTop:12,fontSize:11,color:"var(--tx3)"}}>วันหยุด — ไม่มีตารางงานวันนี้</div>
        )}
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:7}}>
        <Stat label="เข้างาน/เดือน" value={moRecs.filter(r=>r.checkIn&&!r.leaveType).length} color="var(--acc)"/>
        <Stat label="มาสาย" value={moRecs.filter(r=>{const s3=getScheduleForDate(r.date,me,gSch);return STATUS(r,s3).l.startsWith("มาสาย");}).length} color="var(--yellow)"/>
        <Stat label="ลาแล้ว" value={leaveUsed} color="var(--purple)"/>
        <Stat label="วันลาคงเหลือ" value={leaveLeft} color="var(--acc2)"/>
      </div>
      {/* Hours summary row */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:12}}>
        <div className="card2" style={{padding:"10px 10px",textAlign:"center"}}>
          <div style={{fontSize:10,color:"var(--tx2)",marginBottom:4}}>⏱ ชม.รวม/เดือน</div>
          <div className="mono" style={{fontSize:18,fontWeight:700,color:"var(--acc)"}}>{hm(moNet)}</div>
        </div>
        <div className="card2" style={{padding:"10px 10px",textAlign:"center",borderColor:moOT>0?"var(--orange)40":"var(--br2)",background:moOT>0?"var(--orangeBg)":"var(--card2)"}}>
          <div style={{fontSize:10,color:moOT>0?"var(--orange)":"var(--tx2)",marginBottom:4}}>🔥 OT เดือนนี้</div>
          <div className="mono" style={{fontSize:18,fontWeight:700,color:moOT>0?"var(--orange)":"var(--tx3)"}}>{moOT>0?hm(moOT):"—"}</div>
        </div>
        <div className="card2" style={{padding:"10px 10px",textAlign:"center",borderColor:todayOT>0?"var(--orange)40":"var(--br2)",background:todayOT>0?"var(--orangeBg)":"var(--card2)"}}>
          <div style={{fontSize:10,color:todayOT>0?"var(--orange)":"var(--tx2)",marginBottom:4}}>{todayOT>0?"🔥 OT วันนี้":"⏱ ทำงานวันนี้"}</div>
          <div className="mono" style={{fontSize:18,fontWeight:700,color:todayOT>0?"var(--orange)":"var(--acc2)"}}>{todayOT>0?hm(todayOT):todayNet!=null?hm(todayNet):"—"}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:5,marginBottom:12}}>
        {[["checkin","🕐","เช็คอิน"],["history","📋","ประวัติ"],["leave","🌿","ใบลา"],["profile","👤","โปรไฟล์"]].map(([k,ic,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"9px 4px",background:tab===k?"var(--accBg)":"var(--card2)",color:tab===k?"var(--acc)":"var(--tx2)",border:`1px solid ${tab===k?"var(--acc)":"var(--br)"}`,borderRadius:10,fontSize:11,fontWeight:tab===k?700:400}}>
            <span style={{display:"block",fontSize:16,marginBottom:2}}>{ic}</span>{lb}
          </button>
        ))}
      </div>

      {/* CHECKIN TAB */}
      {tab==="checkin"&&(
        <div className="fade">
          {/* GPS Panel */}
          <div className="card2" style={{padding:"14px 16px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:gMsg?10:0}}>
              <span style={{fontSize:13,fontWeight:600,color:"var(--tx)"}}>📡 ตรวจสอบพิกัด{location?.name?` · ${location.name}`:""}</span>
              <span style={{fontSize:11,color:gCol,fontWeight:600}}>{{idle:"รอ",checking:"กำลังรับ...",ok:"✓ พร้อม",err:"✗ Error",far:"✗ นอกพื้นที่"}[gps]}</span>
            </div>
            {gMsg&&<div style={{fontSize:12,color:gCol,background:gps==="ok"?"var(--accBg)":"var(--redBg)",border:`1px solid ${gCol}`,borderRadius:8,padding:"8px 12px",marginBottom:10}}>{gMsg}</div>}
            <button onClick={checkGPS} disabled={gps==="checking"} style={{width:"100%",padding:10,background:gps==="ok"?"var(--accBg)":"var(--card)",color:gps==="checking"?"var(--yellow)":gps==="ok"?"var(--acc)":"var(--tx)",border:`1px solid ${gps==="ok"?"var(--acc)":"var(--br)"}`,display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontSize:13,borderRadius:10}}>
              <span className={gps==="checking"?"spin":""} style={{fontSize:16}}>📍</span>
              {gps==="checking"?"กำลังรับสัญญาณ GPS...":"ตรวจสอบพิกัดของฉัน"}
            </button>
          </div>

          {/* Check buttons */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            {[
              {lb:"เช็คอิน",sub:"▶ เข้างาน",can:canIn,done:hasCI,time:localCI||effectiveRec.checkIn,col:"var(--acc)",bg:"var(--accBg)",fn:doIn},
              {lb:"เช็คเอาท์",sub:onBreak?"⏸ กำลังพักอยู่":"■ ออกงาน",can:canOut,done:hasCO,time:localCO||effectiveRec.checkOut,col:"var(--red)",bg:"var(--redBg)",fn:doOut},
            ].map(b=>(
              <button key={b.lb} onClick={b.fn} disabled={!b.can} style={{padding:"24px 12px",borderRadius:16,textAlign:"center",background:b.can?b.bg:"var(--card2)",color:b.can?b.col:"var(--tx3)",border:`1.5px solid ${b.can?b.col:"var(--br)"}`,opacity:b.done&&!b.can?.55:1,boxShadow:b.can?`0 4px 24px ${b.bg}`:"none",transition:"all .2s"}}>
                <div style={{fontSize:12,fontWeight:600,letterSpacing:.5,marginBottom:6,opacity:.75}}>{b.sub}</div>
                <div style={{fontWeight:800,fontSize:16}}>{b.lb}</div>
                {b.done&&<div className="mono" style={{fontSize:12,marginTop:6,opacity:.75}}>{ft(b.time)}</div>}
                {busy&&b.can&&<div style={{fontSize:10,marginTop:4,color:"var(--tx3)"}}>⏳ กำลังบันทึก...</div>}
              </button>
            ))}
          </div>
          {/* Break button */}
          {hasCI&&!hasCO&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <button onClick={doBreakStart} disabled={!canBreakStart} style={{padding:"14px 12px",borderRadius:14,textAlign:"center",background:hasBS?"var(--yellowBg)":canBreakStart?"var(--yellowBg)":"var(--card2)",color:hasBS?"var(--yellow)":canBreakStart?"var(--yellow)":"var(--tx3)",border:`1.5px solid ${hasBS||canBreakStart?"var(--yellow)":"var(--br)"}`,opacity:hasBS&&!canBreakStart?.75:1,transition:"all .2s"}}>
                <div style={{fontSize:18,marginBottom:4}}>{hasBS?"☕":"🍵"}</div>
                <div style={{fontWeight:700,fontSize:13}}>{hasBS?"พักอยู่":"เริ่มพัก"}</div>
                {hasBS&&<div className="mono" style={{fontSize:11,marginTop:3,opacity:.8}}>{ft(localBS||effectiveRec.breakStart||svrRec?.breakStart)}</div>}
              </button>
              <button onClick={doBreakEnd} disabled={!canBreakEnd} style={{padding:"14px 12px",borderRadius:14,textAlign:"center",background:canBreakEnd?"rgba(134,239,172,.15)":hasBE?"var(--accBg)":"var(--card2)",color:canBreakEnd?"#16a34a":hasBE?"var(--acc)":"var(--tx3)",border:`1.5px solid ${canBreakEnd?"#16a34a":hasBE?"var(--acc)":"var(--br)"}`,opacity:hasBE&&!canBreakEnd?.75:1,transition:"all .2s"}}>
                <div style={{fontSize:18,marginBottom:4}}>{hasBE?"✅":"🔙"}</div>
                <div style={{fontWeight:700,fontSize:13}}>{hasBE?"กลับแล้ว":"กลับมาแล้ว"}</div>
                {hasBE&&<div className="mono" style={{fontSize:11,marginTop:3,opacity:.8}}>{ft(localBE||effectiveRec.breakEnd||svrRec?.breakEnd)}</div>}
              </button>
            </div>
          )}

          {!s&&<div style={{background:"var(--yellowBg)",border:"1px solid var(--yellow)50",borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12,color:"var(--yellow)",textAlign:"center"}}>📅 วันนี้ไม่มีตารางงาน — ตรวจสอบกับ Admin</div>}
          {gps==="idle"&&<div style={{textAlign:"center",fontSize:12,color:"var(--tx3)",marginTop:10}}>กดตรวจสอบพิกัดก่อนเช็คอิน/เอาท์</div>}

          <button onClick={()=>setTab("leave")} style={{width:"100%",padding:11,background:"var(--purpleBg)",color:"var(--purple)",border:"1px solid var(--purple)40",fontSize:13,fontWeight:600,borderRadius:12,marginTop:6}}>
            🌿 ส่งคำขอลา — คงเหลือ {leaveLeft} วัน
          </button>
        </div>
      )}

      {/* HISTORY TAB */}
      {tab==="history"&&(
        <div className="fade">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:12,color:"var(--tx2)"}}>{myRecs.length} รายการ · เดือนนี้ {hm(moHrs)}</span>
            <button onClick={exportCSV} style={{background:"var(--accBg)",color:"var(--acc)",border:"1px solid var(--acc)50",padding:"7px 14px",fontSize:12,fontWeight:700}}>⬇ CSV</button>
          </div>
          {myRecs.length===0?<div className="card2" style={{padding:50,textAlign:"center",color:"var(--tx3)",fontSize:14}}>📋 ยังไม่มีประวัติ</div>
          :<div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>วันที่</th><th>เข้า</th><th>ออก</th><th>พัก</th><th>รวม</th><th>OT/สถานะ</th></tr></thead>
              <tbody>{myRecs.map(r=>{ const s3=getScheduleForDate(r.date,me,gSch);const st2=STATUS(r,s3);const bm=dm(r.breakStart,r.breakEnd);const otRes=calcOT(r.checkIn,r.checkOut,r.breakStart,r.breakEnd,s3);const bs=breakStatus(bm,s3?.breakLimitMins); return(
                <tr key={r.date}>
                  <td style={{fontSize:11,color:"var(--tx2)"}}>{fd(r.date)}</td>
                  <td className="mono" style={{color:"var(--acc)",fontSize:12}}>{ft(r.checkIn)}</td>
                  <td className="mono" style={{color:r.checkOut?"var(--red)":"var(--tx3)",fontSize:12}}>{ft(r.checkOut)}</td>
                  <td style={{fontSize:11}}>
                    {bs?<span className="pill" style={{background:bs.bg,color:bs.c,fontSize:9}}>☕ {bs.l}</span>:<span style={{color:"var(--tx3)"}}>—</span>}
                  </td>
                  <td className="mono" style={{color:"var(--acc2)",fontSize:12}}>{otRes?hm(otRes.gross):"—"}</td>
                  <td>
                    {otRes?.isOT
                      ?<span className="pill" style={{background:"var(--orangeBg)",color:"var(--orange)",fontSize:9}}>🔥 OT {hm(otRes.ot)}</span>
                      :<span className="pill" style={{background:st2.bg,color:st2.c,fontSize:9}}>{st2.l}</span>
                    }
                  </td>
                </tr>
              );})}</tbody>
            </table>
          </div>}
        </div>
      )}

      {/* LEAVE TAB */}
      {tab==="leave"&&(
        <div className="fade">
          <div className="card" style={{padding:20,marginBottom:14}}>
            <div className="sec">ส่งคำขอลา</div>
            <div style={{display:"grid",gap:12}}>
              <div><label className="lbl">ประเภท</label>
                <select value={lf.type} onChange={e=>setLf({...lf,type:e.target.value})}>
                  <option value="sick">🤒 ลาป่วย</option>
                  <option value="personal">📝 ลากิจ</option>
                  <option value="vacation">🌴 ลาพักร้อน</option>
                </select>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">วันเริ่มลา</label><input type="date" value={lf.start} onChange={e=>setLf({...lf,start:e.target.value})}/></div>
                <div><label className="lbl">วันสุดท้าย</label><input type="date" value={lf.end} onChange={e=>setLf({...lf,end:e.target.value})}/></div>
              </div>
              <div><label className="lbl">เหตุผล</label><textarea rows={3} value={lf.reason} onChange={e=>setLf({...lf,reason:e.target.value})} placeholder="ระบุเหตุผล..." style={{resize:"vertical"}}/></div>
            </div>
            <button onClick={doLeave} disabled={busy} style={{marginTop:14,width:"100%",padding:12,background:"linear-gradient(135deg,#5b21b6,#7c3aed)",color:"#fff",fontWeight:700,borderRadius:12}}>{busy?"กำลังส่ง...":"ส่งคำขอลา →"}</button>
          </div>
          <div style={{fontSize:12,color:"var(--tx2)",marginBottom:10,paddingLeft:4}}>ใช้ลา {leaveUsed}/{s2.maxLeaveDays} วัน ปีนี้</div>
          <div className="card" style={{overflow:"hidden"}}>
            {myRecs.filter(r=>r.leaveType).length===0?<div style={{padding:30,textAlign:"center",color:"var(--tx3)",fontSize:13}}>🌿 ยังไม่มีประวัติการลา</div>
            :<table>
              <thead><tr><th>วันที่</th><th>ประเภท</th><th>สถานะ</th><th>เหตุผล</th></tr></thead>
              <tbody>{myRecs.filter(r=>r.leaveType).map(r=>{ const ls=r.leaveStatus||"pending"; return(
                <tr key={r.date}>
                  <td style={{fontSize:11}}>{fd(r.date)}</td>
                  <td><span className="pill" style={{background:"var(--purpleBg)",color:"var(--purple)",fontSize:9}}>{{sick:"🤒 ลาป่วย",personal:"📝 ลากิจ",vacation:"🌴 พักร้อน"}[r.leaveType]||r.leaveType}</span></td>
                  <td>
                    <span className="pill" style={{background:{pending:"var(--yellowBg)",approved:"var(--accBg)",rejected:"var(--redBg)"}[ls],color:{pending:"var(--yellow)",approved:"var(--acc)",rejected:"var(--red)"}[ls],fontSize:9}}>{ls==="pending"?"⏳รออนุมัติ":ls==="approved"?"✓อนุมัติ":"✗ปฏิเสธ"}</span>

                  </td>
                  <td style={{color:"var(--tx2)",fontSize:12}}>{r.leaveReason||"—"}</td>
                </tr>
              );})}</tbody>
            </table>}
          </div>
        </div>
      )}

      {/* PROFILE TAB */}
      {tab==="profile"&&(
        <div className="fade">
          <div className="card" style={{padding:20,marginBottom:12}}>
            <div className="sec">ข้อมูลส่วนตัว</div>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:18,paddingBottom:18,borderBottom:"1px solid var(--br)"}}>
              <button onClick={()=>setShowEmoji(true)} style={{width:68,height:68,background:"var(--accBg)",border:"2px dashed var(--acc)",borderRadius:18,fontSize:36,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,position:"relative"}}>
                {pf.avatar||"🐾"}
                <span style={{position:"absolute",bottom:-5,right:-5,background:"var(--acc)",borderRadius:"50%",width:18,height:18,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",border:"2px solid var(--bg)"}}>✏</span>
              </button>
              <div style={{flex:1}}>
                <div style={{fontSize:17,fontWeight:800,color:"var(--tx)",marginBottom:3}}>{me.name}</div>
                <div style={{fontSize:12,color:"var(--tx2)",lineHeight:1.9}}>
                  <div>🪪 {me.id} · {me.role==="admin"?"ผู้ดูแล":"พนักงาน"}</div>
                  {me.position&&<div>💼 {me.position}{me.department?` — ${me.department}`:""}</div>}
                  {me.startDate&&<div>📅 เริ่มงาน {fd(me.startDate)}</div>}
                </div>
              </div>
            </div>
            <div style={{display:"grid",gap:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">อีเมล</label><input value={pf.email} onChange={e=>setPf({...pf,email:e.target.value})} placeholder="email@example.com"/></div>
                <div><label className="lbl">เบอร์โทรศัพท์</label><input value={pf.phone} onChange={e=>setPf({...pf,phone:e.target.value})} placeholder="0xx-xxx-xxxx"/></div>
              </div>
              <div><label className="lbl">หมายเหตุ</label><textarea rows={2} value={pf.note} onChange={e=>setPf({...pf,note:e.target.value})} style={{resize:"vertical"}}/></div>
            </div>
            <button onClick={saveProfile} disabled={busy} style={{marginTop:14,background:"linear-gradient(135deg,var(--acc),var(--acc2))",color:"#fff",padding:"10px 22px",fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"บันทึกโปรไฟล์"}</button>
          </div>

          {/* Schedule display */}
          <div className="card" style={{padding:20,marginBottom:12}}>
            <div className="sec">ตารางงานของฉัน</div>
            {me.weekSchedule&&typeof me.weekSchedule==="object"&&Object.keys(me.weekSchedule).length>0?(
              <div style={{display:"grid",gap:6}}>
                {DAYS_TH.map((d,i)=>{
                  const dc=me.weekSchedule[String(i)];
                  return(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:dc?"var(--accBg)":"var(--card2)",borderRadius:9,border:`1px solid ${dc?"var(--acc)50":"var(--br)"}`}}>
                      <span style={{width:28,height:28,borderRadius:8,background:dc?"var(--acc)":"rgba(128,128,128,.2)",color:dc?"#fff":"var(--tx3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{d}</span>
                      {dc?<span className="mono" style={{fontSize:13,color:"var(--tx)"}}>{dc.s} — {dc.e} <span style={{color:"var(--tx2)",fontSize:11}}>({hm(timeToMins(dc.e)-timeToMins(dc.s))} ชม.)</span></span>:<span style={{fontSize:12,color:"var(--tx3)"}}>วันหยุด</span>}
                    </div>
                  );
                })}
                <div style={{fontSize:11,color:"var(--tx3)",marginTop:4}}>⏱ ผ่อนผัน {me.graceMins??gSch?.graceMins??15} น. · ลา {me.maxLeaveDays??gSch?.maxLeaveDays??10} วัน/ปี</div>
              </div>
            ):(
              <div style={{fontSize:13,color:"var(--tx2)",lineHeight:2}}>
                <div>🕐 {gSch?.startTime||"08:30"}–{gSch?.endTime||"17:30"}</div>
                <div>⏱ ผ่อนผัน {gSch?.graceMins||15} น.</div>
                <div>☕ พักได้ {gSch?.breakLimitMins||60} น./วัน</div>
                <div>📋 วันลา {gSch?.maxLeaveDays||10} วัน/ปี</div>
                <div style={{fontSize:11,color:"var(--tx3)",marginTop:4}}>* ใช้ตารางงาน Default (ติดต่อ Admin เพื่อตั้งค่าส่วนตัว)</div>
              </div>
            )}
            {me.salary&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:12,borderTop:"1px solid var(--br)",marginTop:8}}>
              <span style={{color:"var(--tx2)",fontSize:13}}>💰 เงินเดือน</span>
              <span className="mono" style={{color:"var(--acc)",fontWeight:700,fontSize:15}}>{Number(me.salary).toLocaleString("th-TH")} ฿</span>
            </div>}
          </div>

          {/* Change PIN */}
          <div className="card" style={{padding:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showPin?16:0}}>
              <div className="sec" style={{marginBottom:0}}>🔑 เปลี่ยน PIN</div>
              <button onClick={()=>setShowPin(!showPin)} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"5px 12px",fontSize:12}}>{showPin?"ยกเลิก":"เปลี่ยน PIN"}</button>
            </div>
            {showPin&&<div style={{display:"grid",gap:10}}>
              <div><label className="lbl">PIN ใหม่</label><input type="password" placeholder="••••" value={newPin} onChange={e=>setNewPin(e.target.value)}/></div>
              <div><label className="lbl">ยืนยัน PIN ใหม่</label><input type="password" placeholder="••••" value={cfPin} onChange={e=>setCfPin(e.target.value)}/></div>
              <button onClick={changePIN} disabled={busy} style={{background:"linear-gradient(135deg,#5b21b6,#7c3aed)",color:"#fff",padding:10,fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"ยืนยันเปลี่ยน PIN"}</button>
            </div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel({user,employees,records,location,gSch,clinic,onReloadAll,onReloadRec,onLogout,showToast}){
  const[tab,setTab]=useState("overview");
  const[date,setDate]=useState(today());
  const[search,setSearch]=useState("");
  const[selEmp,setSelEmp]=useState(null);
  const[busy,setBusy]=useState(false);
  const[newEmp,setNewEmp]=useState({id:"",name:"",pin:"",position:"",department:"",salary:"",email:"",phone:"",startDate:"",role:"employee"});
  const[lf,setLf]=useState({name:"",lat:"",lng:"",radius:200});
  const[sf,setSf]=useState({startTime:"08:30",endTime:"17:30",graceMins:15,workDays:"1,2,3,4,5",maxLeaveDays:10,breakLimitMins:60});
  const[cf,setCf]=useState({name:"คลินิคท่านาสัตวแพทย์",address:"",phone:""});

  useEffect(()=>{ if(location)setLf({name:location.name||"",lat:location.lat||"",lng:location.lng||"",radius:location.radius||200}); },[location]);
  useEffect(()=>{ if(gSch)setSf({startTime:gSch.startTime||"08:30",endTime:gSch.endTime||"17:30",graceMins:gSch.graceMins??15,workDays:gSch.workDays||"1,2,3,4,5",maxLeaveDays:gSch.maxLeaveDays??10,breakLimitMins:gSch.breakLimitMins??60}); },[gSch]);
  useEffect(()=>{ if(clinic)setCf({name:clinic.name||"",address:clinic.address||"",phone:clinic.phone||""}); },[clinic]);

  const save=async(key,data)=>{ setBusy(true);const r=await call("saveConfig",{configKey:key,data:JSON.stringify(data)});r.success?(await onReloadAll(),showToast(true,"บันทึกสำเร็จ")):showToast(false,r.message);setBusy(false); };
  const doDeleteRecord=async(date,empId)=>{
    setBusy(true);
    const r=await call("deleteRecord",{date,empId});
    r.success?(await onReloadRec(),showToast(true,"ลบบันทึกแล้ว")):showToast(false,r.message);
    setBusy(false);
  };
  const addEmp=async()=>{
    if(!newEmp.id||!newEmp.name||!newEmp.pin)return showToast(false,"กรอก รหัส/ชื่อ/PIN ให้ครบ");
    if(employees.find(e=>e.id===newEmp.id.toUpperCase()))return showToast(false,"รหัสนี้มีอยู่แล้ว");
    setBusy(true);
    const r=await call("addEmployee",{...newEmp,id:newEmp.id.toUpperCase()});
    r.success?(await onReloadAll(),showToast(true,`เพิ่ม ${newEmp.name} สำเร็จ`),setNewEmp({id:"",name:"",pin:"",position:"",department:"",salary:"",email:"",phone:"",startDate:"",role:"employee"})):showToast(false,r.message);
    setBusy(false);
  };
  const updateEmp=async(fields)=>{ setBusy(true);const r=await call("updateEmployee",fields);r.success?(await onReloadAll(),showToast(true,"อัปเดตสำเร็จ"),setSelEmp(null)):showToast(false,r.message);setBusy(false); };
  const delEmp=async id=>{ if(id===user.id||!window.confirm(`ลบ ${id}?`))return;setBusy(true);const r=await call("deleteEmployee",{id});r.success?(await onReloadAll(),showToast(true,"ลบแล้ว")):showToast(false,r.message);setBusy(false); };
  const doDedup=async()=>{ setBusy(true);const r=await call("deduplicateRecords");r.success?(await onReloadRec(),showToast(true,`ล้างข้อมูลซ้ำ ${r.deleted} แถว`)):showToast(false,r.message);setBusy(false); };
  const doApproveLeave=async(date,empId,action)=>{ setBusy(true);const r=await call(action,{date,empId,approvedBy:user.id});r.success?(await onReloadRec(),showToast(true,action==="approveLeave"?"✓ อนุมัติแล้ว":"✗ ปฏิเสธแล้ว")):showToast(false,r.message);setBusy(false); };
  const doDeleteLeave=async(date,empId,empName)=>{
    if(!window.confirm(`ลบใบลาของ ${empName} วันที่ ${date}?
(ข้อมูลเช็คอิน/เอาท์จะยังคงอยู่)`)) return;
    setBusy(true);
    const r=await call("cancelLeave",{date,empId});
    r.success?(await onReloadRec(),showToast(true,"ลบใบลาแล้ว")):showToast(false,r.message||"ผิดพลาด");
    setBusy(false);
  };
  const exportAll=()=>{
    const rows=[["วันที่","รหัส","ชื่อ","ตำแหน่ง","เข้างาน","ออกงาน","รวม","สถานะ","ใบลา","สถานะใบลา"]];
    Object.entries(records).sort((a,b)=>b[0].localeCompare(a[0])).forEach(([d,day])=>{
      Object.entries(day).forEach(([eid,r])=>{ const e=employees.find(x=>x.id===eid);const s2=getScheduleForDate(d,e,gSch);const st=STATUS(r,s2);rows.push([d,eid,e?.name||"—",e?.position||"",ft(r.checkIn),ft(r.checkOut),hm(dm(r.checkIn,r.checkOut)),st.l,r.leaveType||"",r.leaveStatus||""]); });
    });
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(r=>r.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));a.download=`att_all_${today()}.csv`;a.click();
  };

  const staff  = employees.filter(e=>e.role!=="admin");
  const dayRecs= records[date]||{};
  const filtered=staff.filter(e=>!search||e.name.includes(search)||e.id.includes(search.toUpperCase())||e.department?.includes(search)||e.position?.includes(search));
  const mo=today().slice(0,7);
  const moAll=Object.entries(records).filter(([d])=>d.startsWith(mo)).flatMap(([,d])=>Object.values(d));
  const statHrs=moAll.reduce((s,r)=>s+(dm(r.checkIn,r.checkOut)||0),0);
  const statOT=Object.entries(records).filter(([d])=>d.startsWith(mo)).flatMap(([,day])=>Object.entries(day)).reduce((acc,[eid,r])=>{ const emp=employees.find(e=>e.id===eid);const s2=getScheduleForDate(Object.keys(records).find(d=>records[d]?.[eid]===r)||today(),emp,gSch);const res=calcOT(r.checkIn,r.checkOut,r.breakStart,r.breakEnd,s2);return acc+(res?.ot||0); },0);
  const pendingLeaves=Object.entries(records).flatMap(([date,day])=>Object.entries(day).filter(([,r])=>r.leaveType&&r.leaveStatus==="pending").map(([empId,r])=>({date,empId,emp:employees.find(e=>e.id===empId),...r})));

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:"12px 12px 80px"}}>
      {/* Header */}
      <div className="card2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div><div style={{fontSize:17,fontWeight:800,color:"var(--tx)"}}>⚙ Admin Panel</div><div style={{fontSize:11,color:"var(--tx2)"}}>{clinic?.name||"คลินิคท่านาสัตวแพทย์"} · {user.name}</div></div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          <button onClick={doDedup} disabled={busy} style={{background:"var(--yellowBg)",color:"var(--yellow)",border:"1px solid var(--yellow)50",padding:"7px 12px",fontSize:11}}>🔧 ล้างข้อมูลซ้ำ</button>
          <button onClick={onReloadAll} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"7px 12px",fontSize:12}}>🔄</button>
          <button onClick={exportAll} style={{background:"var(--accBg)",color:"var(--acc)",border:"1px solid var(--acc)50",padding:"7px 14px",fontSize:12,fontWeight:700}}>⬇ CSV</button>
          <button onClick={onLogout} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"7px 12px",fontSize:12}}>ออก</button>
        </div>
      </div>

      {/* Config chips */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
        {[{ok:!!(location?.lat&&location?.lng),lb:"📍 พิกัด",detail:location?.lat?`${location.name||""} r=${location.radius}ม.`:"ยังไม่ได้ตั้งค่า",go:"location"},{ok:!!gSch?.startTime,lb:"🕐 ตารางงาน",detail:gSch?.startTime?`${gSch.startTime}–${gSch.endTime}`:"ใช้ค่า default",go:"schedule"},{ok:!!clinic?.name,lb:"🐾 คลินิค",detail:clinic?.name||"ยังไม่ได้ตั้งค่า",go:"clinicinfo"}].map(b=>(
          <div key={b.go} onClick={()=>setTab(b.go)} className="card2" style={{padding:"10px 12px",cursor:"pointer",borderColor:b.ok?"var(--br2)":"var(--yellow)60",background:b.ok?"var(--card2)":"var(--yellowBg)"}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}><span style={{width:7,height:7,borderRadius:"50%",background:b.ok?"var(--acc)":"var(--yellow)",display:"inline-block"}}/><span style={{fontSize:12,fontWeight:700,color:"var(--tx)"}}>{b.lb}</span></div>
            <div style={{fontSize:10,color:"var(--tx2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.detail}</div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:8}}>
        <Stat label="พนักงาน" value={staff.length} color="var(--acc2)"/>
        <Stat label="เข้า/เดือน" value={moAll.filter(r=>r.checkIn&&!r.leaveType).length} color="var(--acc)"/>
        <Stat label="รออนุมัติ" value={pendingLeaves.length} color={pendingLeaves.length>0?"var(--yellow)":"var(--tx3)"}/>
        <Stat label="ชม.รวม/เดือน" value={hm(statHrs)} color="var(--yellow)"/>
        <Stat label="🔥 OT รวม/เดือน" value={statOT>0?hm(statOT):"—"} color="var(--orange)"/>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:5,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
        {[["overview","📊","ภาพรวม"],["leaves","📋",`ใบลา${pendingLeaves.length>0?` (${pendingLeaves.length})`:""}`],["employees","👥","พนักงาน"],["location","📍","พิกัด"],["schedule","🕐","ตารางงาน"],["clinicinfo","🐾","คลินิค"]].map(([k,ic,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:"0 0 auto",padding:"8px 12px",background:tab===k?"var(--accBg)":"var(--card2)",color:tab===k?"var(--acc)":"var(--tx2)",border:`1px solid ${tab===k?"var(--acc)":"var(--br)"}`,borderRadius:10,fontSize:12,fontWeight:tab===k?700:400}}>{ic} {lb}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab==="overview"&&(
        <div className="fade">
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:160}}/>
            <input placeholder="ค้นหา..." value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:100}}/>
            <span style={{fontSize:12,color:"var(--tx2)",whiteSpace:"nowrap"}}>{Object.keys(dayRecs).length}/{staff.length}</span>
          </div>
          <div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>พนักงาน</th><th>เข้า</th><th>ออก</th><th>พัก</th><th>รวม</th><th>สถานะ</th><th>OT</th><th></th></tr></thead>
              <tbody>{filtered.map(e=>{ const r=dayRecs[e.id];const s2=getScheduleForDate(date,e,gSch);const st=STATUS(r,s2);const bm=dm(r?.breakStart,r?.breakEnd);const otRes2=calcOT(r?.checkIn,r?.checkOut,r?.breakStart,r?.breakEnd,s2);const bs=breakStatus(bm,s2?.breakLimitMins); return(
                <tr key={e.id} onClick={()=>setSelEmp(e)} style={{cursor:"pointer"}}>
                  <td><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:18}}>{e.avatar||"🐾"}</span><div><div style={{fontWeight:600,fontSize:13,color:"var(--tx)"}}>{e.name}</div><div style={{fontSize:10,color:"var(--tx3)"}}>{e.id}</div></div></div></td>
                  <td className="mono" style={{color:r?.checkIn?"var(--acc)":"var(--tx3)",fontSize:12}}>{ft(r?.checkIn)}</td>
                  <td className="mono" style={{color:r?.checkOut?"var(--red)":"var(--tx3)",fontSize:12}}>{ft(r?.checkOut)}</td>
                  <td style={{fontSize:11}}>
                    {bs?<span className="pill" style={{background:bs.bg,color:bs.c,fontSize:9}}>☕ {bs.l}</span>:<span style={{color:"var(--tx3)"}}>—</span>}
                  </td>
                  <td className="mono" style={{color:"var(--acc2)",fontSize:12}}>{otRes2?hm(otRes2.gross):"—"}</td>
                  <td>{otRes2?.isOT&&<span className="pill" style={{background:"var(--orangeBg)",color:"var(--orange)",fontSize:9}}>🔥{hm(otRes2.ot)}</span>}</td>
                  <td>{!st.isOff&&<span className="pill" style={{background:st.bg,color:st.c,fontSize:9}}>{st.l}</span>}{st.isOff&&<span style={{fontSize:10,color:"var(--tx3)"}}>วันหยุด</span>}</td>
                  <td onClick={ev=>{ev.stopPropagation();if(r&&window.confirm(`ลบบันทึกวันที่ ${date} ของ ${e.name}?`)) doDeleteRecord(date,e.id);}} style={{width:40}}>{r&&<button style={{background:"var(--redBg)",color:"var(--red)",border:"none",padding:"3px 8px",fontSize:11,borderRadius:7}}>ลบ</button>}</td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* LEAVE APPROVAL */}
      {tab==="leaves"&&(
        <div className="fade">
          {pendingLeaves.length>0&&(
            <div className="card2" style={{padding:"12px 16px",marginBottom:14,borderColor:"var(--yellow)50",background:"var(--yellowBg)"}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--yellow)",marginBottom:10}}>⏳ รออนุมัติ {pendingLeaves.length} รายการ</div>
              <div style={{display:"grid",gap:10}}>
                {pendingLeaves.map((lv,i)=>(
                  <div key={i} style={{background:"var(--card)",border:"1px solid var(--br)",borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{fontSize:20}}>{lv.emp?.avatar||"🐾"}</span>
                        <div><div style={{fontSize:13,fontWeight:700,color:"var(--tx)"}}>{lv.emp?.name||lv.empId}</div><div style={{fontSize:11,color:"var(--tx2)"}}>{lv.emp?.position||""}</div></div>
                      </div>
                      <div style={{fontSize:12,color:"var(--tx2)"}}>
                        <span className="pill" style={{background:"var(--purpleBg)",color:"var(--purple)",fontSize:10,marginRight:6}}>{{sick:"🤒 ลาป่วย",personal:"📝 ลากิจ",vacation:"🌴 พักร้อน"}[lv.leaveType]||lv.leaveType}</span>
                        📅 {fd(lv.date)}
                      </div>
                      {lv.leaveReason&&<div style={{fontSize:11,color:"var(--tx3)",marginTop:3}}>เหตุผล: {lv.leaveReason}</div>}
                    </div>
                    <div style={{display:"flex",gap:7}}>
                      <button onClick={()=>doApproveLeave(lv.date,lv.empId,"approveLeave")} disabled={busy} style={{background:"var(--accBg)",color:"var(--acc)",border:"1px solid var(--acc)50",padding:"7px 14px",fontSize:12,fontWeight:700,borderRadius:9}}>✓ อนุมัติ</button>
                      <button onClick={()=>doApproveLeave(lv.date,lv.empId,"rejectLeave")} disabled={busy} style={{background:"var(--redBg)",color:"var(--red)",border:"1px solid var(--red)50",padding:"7px 14px",fontSize:12,fontWeight:700,borderRadius:9}}>✗ ปฏิเสธ</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{fontSize:11,color:"var(--tx2)",marginBottom:10,letterSpacing:1,textTransform:"uppercase"}}>ประวัติใบลาทั้งหมด</div>
          <div className="card" style={{overflow:"hidden"}}>
            {Object.entries(records).flatMap(([d,day])=>Object.entries(day).filter(([,r])=>r.leaveType).map(([eid,r])=>({date:d,empId:eid,...r}))).length===0
              ?<div style={{padding:30,textAlign:"center",color:"var(--tx3)"}}>ยังไม่มีใบลา</div>
              :<table>
                <thead><tr><th>วันที่</th><th>พนักงาน</th><th>ประเภท</th><th>เหตุผล</th><th>สถานะ</th></tr></thead>
                <tbody>
                  {Object.entries(records).flatMap(([d,day])=>Object.entries(day).filter(([,r])=>r.leaveType).map(([eid,r])=>({date:d,empId:eid,...r}))).sort((a,b)=>b.date.localeCompare(a.date)).map((r,i)=>{
                    const emp=employees.find(e=>e.id===r.empId);const ls=r.leaveStatus||"pending";
                    return(<tr key={i}>
                      <td style={{fontSize:11,color:"var(--tx2)"}}>{fd(r.date)}</td>
                      <td><div style={{fontSize:13,fontWeight:500,color:"var(--tx)"}}>{emp?.name||r.empId}</div></td>
                      <td><span className="pill" style={{background:"var(--purpleBg)",color:"var(--purple)",fontSize:9}}>{{sick:"🤒ลาป่วย",personal:"📝ลากิจ",vacation:"🌴พักร้อน"}[r.leaveType]||r.leaveType}</span></td>
                      <td style={{fontSize:12,color:"var(--tx2)"}}>{r.leaveReason||"—"}</td>
                      <td>
                        <span className="pill" style={{background:{pending:"var(--yellowBg)",approved:"var(--accBg)",rejected:"var(--redBg)"}[ls],color:{pending:"var(--yellow)",approved:"var(--acc)",rejected:"var(--red)"}[ls],fontSize:9}}>{ls==="pending"?"⏳รอ":ls==="approved"?"✓อนุมัติ":"✗ปฏิเสธ"}</span>
                        <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                          {ls==="pending"&&<>
                            <button onClick={()=>doApproveLeave(r.date,r.empId,"approveLeave")} disabled={busy} style={{background:"var(--accBg)",color:"var(--acc)",border:"none",padding:"2px 8px",fontSize:10,borderRadius:6}}>✓</button>
                            <button onClick={()=>doApproveLeave(r.date,r.empId,"rejectLeave")} disabled={busy} style={{background:"var(--redBg)",color:"var(--red)",border:"none",padding:"2px 8px",fontSize:10,borderRadius:6}}>✗</button>
                          </>}
                          <button onClick={()=>doDeleteLeave(r.date,r.empId,employees.find(e=>e.id===r.empId)?.name||r.empId)} disabled={busy} title="ลบใบลา" style={{background:"var(--card2)",color:"var(--tx3)",border:"1px solid var(--br)",padding:"2px 7px",fontSize:10,borderRadius:6}}>🗑</button>
                        </div>
                      </td>
                    </tr>);
                  })}
                </tbody>
              </table>
            }
          </div>
        </div>
      )}

      {/* EMPLOYEES */}
      {tab==="employees"&&(
        <div className="fade">
          <div className="card" style={{padding:20,marginBottom:14}}>
            <div className="sec">เพิ่มพนักงานใหม่</div>
            <div style={{display:"grid",gap:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr",gap:10}}>
                <div><label className="lbl">รหัส *</label><input placeholder="EMP003" value={newEmp.id} onChange={e=>setNewEmp({...newEmp,id:e.target.value.toUpperCase()})}/></div>
                <div><label className="lbl">ชื่อ-นามสกุล *</label><input placeholder="ชื่อพนักงาน" value={newEmp.name} onChange={e=>setNewEmp({...newEmp,name:e.target.value})}/></div>
                <div><label className="lbl">PIN *</label><input type="password" placeholder="••••" value={newEmp.pin} onChange={e=>setNewEmp({...newEmp,pin:e.target.value})}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                <div><label className="lbl">ตำแหน่ง</label><input placeholder="สัตวแพทย์" value={newEmp.position} onChange={e=>setNewEmp({...newEmp,position:e.target.value})}/></div>
                <div><label className="lbl">แผนก</label><input placeholder="รักษา" value={newEmp.department} onChange={e=>setNewEmp({...newEmp,department:e.target.value})}/></div>
                <div><label className="lbl">บทบาท</label><select value={newEmp.role} onChange={e=>setNewEmp({...newEmp,role:e.target.value})}><option value="employee">พนักงาน</option><option value="admin">ผู้ดูแล</option></select></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                <div><label className="lbl">เงินเดือน (฿)</label><input type="number" placeholder="25000" value={newEmp.salary} onChange={e=>setNewEmp({...newEmp,salary:e.target.value})}/></div>
                <div><label className="lbl">อีเมล</label><input placeholder="email@" value={newEmp.email} onChange={e=>setNewEmp({...newEmp,email:e.target.value})}/></div>
                <div><label className="lbl">วันเริ่มงาน</label><input type="date" value={newEmp.startDate} onChange={e=>setNewEmp({...newEmp,startDate:e.target.value})}/></div>
              </div>
            </div>
            <button onClick={addEmp} disabled={busy} style={{marginTop:14,background:"linear-gradient(135deg,var(--acc),var(--acc2))",color:"#fff",padding:"10px 22px",fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"+ เพิ่มพนักงาน"}</button>
          </div>
          <div style={{marginBottom:10}}><input placeholder="ค้นหา..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>ตารางงาน</th><th>วันลา</th><th></th></tr></thead>
              <tbody>{filtered.map(e=>{ const used=Object.values(records).flatMap(d=>Object.entries(d)).filter(([eid,r])=>eid===e.id&&r.leaveType&&r.date?.startsWith(today().slice(0,4))).length;const maxL=e.maxLeaveDays??gSch?.maxLeaveDays??10;const left=Math.max(0,maxL-used);const hasWS=e.weekSchedule&&Object.keys(e.weekSchedule).length>0; return(
                <tr key={e.id} onClick={()=>setSelEmp(e)} style={{cursor:"pointer"}}>
                  <td className="mono" style={{color:"var(--acc)",fontWeight:600,fontSize:12}}>{e.id}</td>
                  <td><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:18}}>{e.avatar||"🐾"}</span><div><div style={{fontWeight:600,fontSize:13,color:"var(--tx)"}}>{e.name}</div><span style={{fontSize:9,padding:"1px 7px",borderRadius:20,background:e.role==="admin"?"var(--yellowBg)":"var(--accBg)",color:e.role==="admin"?"var(--yellow)":"var(--acc)"}}>{e.role==="admin"?"ผู้ดูแล":"พนักงาน"}</span></div></div></td>
                  <td style={{fontSize:11,color:"var(--tx2)"}}>{e.position||"—"}{e.department?`/${e.department}`:""}</td>
                  <td style={{fontSize:11}}>
                    {hasWS?<span className="pill" style={{background:"var(--yellowBg)",color:"var(--yellow)",fontSize:9}}>⚡ รายวัน</span>:<span style={{color:"var(--tx2)"}}>Default</span>}
                  </td>
                  <td className="mono" style={{color:"var(--purple)",fontWeight:600}}>{left}/{maxL}</td>
                  <td onClick={ev=>{ev.stopPropagation();delEmp(e.id);}}>{e.id!==user.id&&<button style={{background:"var(--redBg)",color:"var(--red)",border:"1px solid var(--red)40",padding:"4px 10px",fontSize:11,borderRadius:7}}>ลบ</button>}</td>
                </tr>
              );})}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* LOCATION */}
      {tab==="location"&&(
        <div className="fade">
          <div className="card2" style={{padding:"12px 16px",marginBottom:14,borderColor:lf.lat&&lf.lng?"var(--acc)50":"var(--yellow)60",background:lf.lat&&lf.lng?"var(--accBg)":"var(--yellowBg)"}}>
            <div style={{fontSize:13,fontWeight:700,color:lf.lat&&lf.lng?"var(--acc)":"var(--yellow)",marginBottom:4}}>{lf.lat&&lf.lng?"✓ ตั้งค่าแล้ว":"⚠ ยังไม่ได้ตั้งค่า"}</div>
            {lf.lat&&lf.lng&&<div className="mono" style={{fontSize:12,color:"var(--tx2)"}}>📍 {lf.name} · {lf.lat}, {lf.lng} · r={lf.radius}ม.</div>}
          </div>
          <div className="card" style={{padding:20}}>
            <div className="sec">แก้ไขพิกัดสำนักงาน</div>
            <div style={{display:"grid",gap:13}}>
              <div><label className="lbl">ชื่อสถานที่</label><input value={lf.name} onChange={e=>setLf({...lf,name:e.target.value})}/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">Latitude</label><input type="number" step="0.00001" value={lf.lat} onChange={e=>setLf({...lf,lat:e.target.value})}/></div>
                <div><label className="lbl">Longitude</label><input type="number" step="0.00001" value={lf.lng} onChange={e=>setLf({...lf,lng:e.target.value})}/></div>
              </div>
              <div><label className="lbl">รัศมี: {lf.radius} ม.</label><input type="range" min="50" max="1000" step="25" value={lf.radius} onChange={e=>setLf({...lf,radius:e.target.value})}/></div>
            </div>
            <button onClick={()=>save("location",{name:lf.name,lat:+lf.lat,lng:+lf.lng,radius:+lf.radius})} disabled={busy} style={{marginTop:16,background:"linear-gradient(135deg,var(--acc),var(--acc2))",color:"#fff",padding:"11px 24px",fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"บันทึกพิกัด"}</button>
          </div>
        </div>
      )}

      {/* SCHEDULE */}
      {tab==="schedule"&&(
        <div className="fade">
          <div className="card2" style={{padding:"11px 16px",marginBottom:14,fontSize:12,color:"var(--tx2)",lineHeight:1.8,borderColor:"var(--yellow)40",background:"var(--yellowBg)"}}>
            <b style={{color:"var(--yellow)"}}>⚡ ตารางงาน Default</b> — ใช้สำหรับพนักงานที่ไม่ได้ตั้งตารางรายวัน<br/>
            <span style={{color:"var(--tx3)"}}>ตั้งรายบุคคล → กดที่ชื่อพนักงาน → แท็บ "ตารางงาน"</span>
          </div>
          <div className="card" style={{padding:20}}>
            <div className="sec">Default Schedule</div>
            <div style={{display:"grid",gap:14}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">เวลาเข้างาน</label><input type="time" value={sf.startTime} onChange={e=>setSf({...sf,startTime:e.target.value})}/></div>
                <div><label className="lbl">เวลาออกงาน</label><input type="time" value={sf.endTime} onChange={e=>setSf({...sf,endTime:e.target.value})}/></div>
              </div>
              <div><label className="lbl">ผ่อนผันมาสาย: <strong>{sf.graceMins} น.</strong></label><input type="range" min="0" max="60" step="5" value={sf.graceMins} onChange={e=>setSf({...sf,graceMins:+e.target.value})}/></div>
              <div><label className="lbl">เวลาพักสูงสุด: <strong style={{color:"var(--yellow)"}}>{sf.breakLimitMins} น.</strong></label><input type="range" min="15" max="120" step="5" value={sf.breakLimitMins} onChange={e=>setSf({...sf,breakLimitMins:+e.target.value})}/></div>
              <div><label className="lbl">วันลาสูงสุด/ปี: <strong>{sf.maxLeaveDays} วัน</strong></label><input type="range" min="1" max="30" step="1" value={sf.maxLeaveDays} onChange={e=>setSf({...sf,maxLeaveDays:+e.target.value})}/></div>
              <div>
                <label className="lbl">วันทำงาน</label>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {DAYS_TH.map((d,i)=>{ const on=sf.workDays.split(",").filter(Boolean).map(Number).includes(i); return(
                    <button key={i} onClick={()=>{ const cur=sf.workDays.split(",").filter(Boolean).map(Number);const nxt=on?cur.filter(x=>x!==i):[...cur,i].sort();setSf({...sf,workDays:nxt.join(",")}); }} style={{width:44,height:44,borderRadius:10,background:on?"var(--accBg)":"var(--card2)",color:on?"var(--acc)":"var(--tx3)",border:`1px solid ${on?"var(--acc)":"var(--br)"}`,fontWeight:on?700:400,fontSize:13}}>{d}</button>
                  );})}
                </div>
              </div>
            </div>
            <div style={{marginTop:16,background:"var(--accBg)",border:"1px solid var(--acc)40",borderRadius:10,padding:"12px 16px",fontSize:12,color:"var(--tx2)",lineHeight:2.2}}>
              <div style={{color:"var(--acc)",fontWeight:700,fontSize:10,letterSpacing:2,marginBottom:4}}>PREVIEW</div>
              <div>มาถึง {sf.startTime} → <b style={{color:"var(--acc)"}}>ตรงเวลา ✓</b></div>
              <div>มาถึง {addMin(sf.startTime,+sf.graceMins+1)} → <b style={{color:"var(--yellow)"}}>มาสาย {+sf.graceMins+1} นาที</b></div>
              <div>พัก {sf.breakLimitMins} น. → <b style={{color:"var(--yellow)"}}>หัก {sf.breakLimitMins} น. ✓</b></div>
              <div>พัก 30 น. → <b style={{color:"var(--yellow)"}}>ยังหัก {sf.breakLimitMins} น. (ceiling)</b></div>
              <div>พัก {+sf.breakLimitMins+5} น. → <b style={{color:"var(--red)"}}>หัก {+sf.breakLimitMins+5} น. (พักเกิน 5 น.) ⚠</b></div>
            </div>
            <button onClick={()=>save("schedule",{startTime:sf.startTime,endTime:sf.endTime,graceMins:sf.graceMins,workDays:sf.workDays,maxLeaveDays:sf.maxLeaveDays,breakLimitMins:sf.breakLimitMins})} disabled={busy} style={{marginTop:16,background:"linear-gradient(135deg,var(--acc),var(--acc2))",color:"#fff",padding:"11px 24px",fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"บันทึกตารางงาน"}</button>
          </div>
        </div>
      )}

      {/* CLINIC */}
      {tab==="clinicinfo"&&(
        <div className="fade">
          <div className="card" style={{padding:20}}>
            <div className="sec">ข้อมูลคลินิค</div>
            <div style={{display:"grid",gap:12}}>
              <div><label className="lbl">ชื่อคลินิค</label><input value={cf.name} onChange={e=>setCf({...cf,name:e.target.value})}/></div>
              <div><label className="lbl">ที่อยู่</label><textarea rows={2} value={cf.address} onChange={e=>setCf({...cf,address:e.target.value})} style={{resize:"vertical"}}/></div>
              <div><label className="lbl">เบอร์โทรศัพท์</label><input value={cf.phone} onChange={e=>setCf({...cf,phone:e.target.value})}/></div>
            </div>
            <button onClick={()=>save("clinic",cf)} disabled={busy} style={{marginTop:16,background:"linear-gradient(135deg,var(--acc),var(--acc2))",color:"#fff",padding:"11px 24px",fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"บันทึก"}</button>
          </div>
        </div>
      )}

      {selEmp&&<EmpModal emp={selEmp} gSch={gSch} records={records} busy={busy} onSave={updateEmp} onClose={()=>setSelEmp(null)} showToast={showToast}/>}
    </div>
  );
}

// ─── Employee Modal ───────────────────────────────────────────────────────────
function EmpModal({emp,gSch,records,busy,onSave,onClose,showToast}){
  const[tab,setTab]=useState("info");
  const[f,setF]=useState({
    name:emp.name||"",email:emp.email||"",phone:emp.phone||"",
    position:emp.position||"",department:emp.department||"",
    salary:emp.salary||"",startDate:emp.startDate||"",
    graceMins:emp.graceMins!=null?String(emp.graceMins):"",
    maxLeaveDays:emp.maxLeaveDays!=null?String(emp.maxLeaveDays):"",
    note:emp.note||"",avatar:emp.avatar||"🐾",role:emp.role||"employee",
    weekSchedule: emp.weekSchedule||null,
  });
  const[newPin,setNewPin]=useState("");const[cfPin,setCfPin]=useState("");
  const[showEmoji,setShowEmoji]=useState(false);

  const myRecs=Object.entries(records).flatMap(([d,r])=>r[emp.id]?[{date:d,...r[emp.id]}]:[]).sort((a,b)=>b.date.localeCompare(a.date));
  const leaveUsed=myRecs.filter(r=>r.leaveType&&r.date.startsWith(today().slice(0,4))).length;
  const moHrs=myRecs.filter(r=>r.date.startsWith(today().slice(0,7))).reduce((x,r)=>x+(dm(r.checkIn,r.checkOut)||0),0);
  const maxL=+(f.maxLeaveDays||gSch?.maxLeaveDays||10);

  const saveInfo=()=>onSave({id:emp.id,name:f.name,email:f.email,phone:f.phone,position:f.position,department:f.department,salary:f.salary,startDate:f.startDate,note:f.note,avatar:f.avatar,role:f.role});
  const saveSch=()=>onSave({id:emp.id,graceMins:f.graceMins,maxLeaveDays:f.maxLeaveDays,weekSchedule:f.weekSchedule?JSON.stringify(f.weekSchedule):""});
  const savePin=()=>{ if(newPin.length<4){showToast(false,"PIN ต้องมีอย่างน้อย 4 ตัว");return;} if(newPin!==cfPin){showToast(false,"PIN ไม่ตรงกัน");return;} onSave({id:emp.id,pin:newPin}); };

  return(
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:14,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}} onClick={onClose}>
      {showEmoji&&<EmojiPicker value={f.avatar} onChange={av=>setF({...f,avatar:av})} onClose={()=>setShowEmoji(false)}/>}
      <div className="card" style={{width:"100%",maxWidth:520,maxHeight:"90vh",overflow:"auto",padding:0}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{padding:"16px 20px 12px",borderBottom:"1px solid var(--br)",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"var(--bg)",backdropFilter:"blur(20px)",zIndex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button onClick={()=>setShowEmoji(true)} style={{width:44,height:44,background:"var(--accBg)",border:"1.5px dashed var(--acc)",borderRadius:12,fontSize:24,display:"flex",alignItems:"center",justifyContent:"center"}}>{f.avatar||"🐾"}</button>
            <div><div style={{fontWeight:700,color:"var(--tx)"}}>{emp.name}</div><div style={{fontSize:11,color:"var(--tx2)"}}>{emp.id}</div></div>
          </div>
          <button onClick={onClose} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"6px 12px",fontSize:12}}>✕ ปิด</button>
        </div>

        {/* Quick stats */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,padding:"12px 16px 0"}}>
          {[["เดือนนี้",hm(moHrs),"var(--acc2)"],["ลาแล้ว/ปี",`${leaveUsed}/${maxL}`,"var(--purple)"],["รายการ",`${myRecs.length} วัน`,"var(--tx2)"]].map(([l,v,c])=>(
            <div key={l} className="card2" style={{padding:"8px",textAlign:"center"}}><div className="mono" style={{fontSize:16,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:9,color:"var(--tx3)",marginTop:2}}>{l}</div></div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:5,padding:"10px 16px 0"}}>
          {[["info","📋","ข้อมูล"],["work","🕐","ตารางงาน"],["pin","🔑","PIN"]].map(([k,ic,lb])=>(
            <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"7px",background:tab===k?"var(--accBg)":"var(--card2)",color:tab===k?"var(--acc)":"var(--tx2)",border:`1px solid ${tab===k?"var(--acc)":"var(--br)"}`,fontSize:12,borderRadius:9,fontWeight:tab===k?700:400}}>{ic} {lb}</button>
          ))}
        </div>

        <div style={{padding:"14px 16px 20px"}}>
          {tab==="info"&&(
            <div style={{display:"grid",gap:11}}>
              <div><label className="lbl">ชื่อ-นามสกุล</label><input value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">ตำแหน่ง</label><input value={f.position} onChange={e=>setF({...f,position:e.target.value})}/></div>
                <div><label className="lbl">แผนก</label><input value={f.department} onChange={e=>setF({...f,department:e.target.value})}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">อีเมล</label><input value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></div>
                <div><label className="lbl">เบอร์โทรศัพท์</label><input value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">เงินเดือน (฿)</label><input type="number" value={f.salary} onChange={e=>setF({...f,salary:e.target.value})}/></div>
                <div><label className="lbl">วันเริ่มงาน</label><input type="date" value={f.startDate} onChange={e=>setF({...f,startDate:e.target.value})}/></div>
              </div>
              <div><label className="lbl">บทบาท</label><select value={f.role} onChange={e=>setF({...f,role:e.target.value})}><option value="employee">พนักงาน</option><option value="admin">ผู้ดูแล</option></select></div>
              <div><label className="lbl">หมายเหตุ</label><textarea rows={2} value={f.note} onChange={e=>setF({...f,note:e.target.value})} style={{resize:"vertical"}}/></div>
              <button onClick={saveInfo} disabled={busy} style={{background:"linear-gradient(135deg,var(--acc),var(--acc2))",color:"#fff",padding:10,fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"บันทึกข้อมูล"}</button>
            </div>
          )}
          {tab==="work"&&(
            <div style={{display:"grid",gap:14}}>
              {/* Per-day schedule editor */}
              <WeekScheduleEditor
                value={f.weekSchedule}
                onChange={ws=>setF({...f,weekSchedule:ws})}
                globalSch={gSch}
              />
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">ผ่อนผันมาสาย (น.)</label><input type="number" min="0" max="120" value={f.graceMins} onChange={e=>setF({...f,graceMins:e.target.value})} placeholder={`Default: ${gSch?.graceMins??15}`}/></div>
                <div><label className="lbl">วันลาสูงสุด/ปี</label><input type="number" min="0" max="60" value={f.maxLeaveDays} onChange={e=>setF({...f,maxLeaveDays:e.target.value})} placeholder={`Default: ${gSch?.maxLeaveDays??10}`}/></div>
              </div>
              <div style={{background:"var(--yellowBg)",border:"1px solid var(--yellow)40",borderRadius:9,padding:"10px 14px",fontSize:12,color:"var(--yellow)"}}>
                ⚡ ตารางรายวัน override ทุกค่า Default — ปล่อยว่างทุกวัน = ใช้ Default Schedule
              </div>
              <button onClick={saveSch} disabled={busy} style={{background:"linear-gradient(135deg,#5b21b6,#7c3aed)",color:"#fff",padding:10,fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"บันทึกตารางงาน"}</button>
            </div>
          )}
          {tab==="pin"&&(
            <div style={{display:"grid",gap:11}}>
              <div style={{background:"var(--redBg)",border:"1px solid var(--red)40",borderRadius:9,padding:"10px 14px",fontSize:12,color:"var(--red)"}}>⚠ การเปลี่ยน PIN จะมีผลทันที</div>
              <div><label className="lbl">PIN ใหม่ (อย่างน้อย 4 ตัว)</label><input type="password" placeholder="••••" value={newPin} onChange={e=>setNewPin(e.target.value)}/></div>
              <div><label className="lbl">ยืนยัน PIN</label><input type="password" placeholder="••••" value={cfPin} onChange={e=>setCfPin(e.target.value)}/></div>
              <button onClick={savePin} disabled={busy} style={{background:"linear-gradient(135deg,#b91c1c,#dc2626)",color:"#fff",padding:10,fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"ตั้ง PIN ใหม่"}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}