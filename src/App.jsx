import { useState, useEffect, useRef, useCallback } from "react";

const API = "https://script.google.com/macros/s/AKfycbyk5pFcfXtuZm0wUFqswrQxzvgOOkMb9jTViCbktmH7KzIUGr6zhE6pzKMUsS2vUK7x/exec";
const call = async (action, params = {}) => {
  try {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const r = await fetch(`${API}?${qs}`, { redirect: "follow" });
    return JSON.parse(await r.text());
  } catch (e) { return { success: false, message: String(e) }; }
};

// ─── Pending Queue — กันเช็คอินหาย ถ้ามือถือ kill app กลางอากาศ ──────────────
// เก็บ action ที่ยังไม่ถึง server ไว้ใน localStorage
// เปิดแอปครั้งถัดไปจะ retry อัตโนมัติ
const PQ_KEY = "tv_pending_queue";
const pqLoad  = () => { try { return JSON.parse(localStorage.getItem(PQ_KEY)||"[]"); } catch { return []; } };
const pqSave  = (q) => { try { localStorage.setItem(PQ_KEY, JSON.stringify(q)); } catch {} };
const pqAdd   = (item) => { const q = pqLoad(); q.push(item); pqSave(q); };
const pqRemove= (action, empId) => { pqSave(pqLoad().filter(i => !(i.action===action && i.params.empId===empId))); };
const pqFlush = async (onRetried) => {
  const q = pqLoad();
  if (!q.length) return 0;
  const failed = [];
  for (const item of q) {
    try {
      const r = await call(item.action, item.params);
      if (!r.success) failed.push(item);
      else if (onRetried) onRetried(item);
    } catch { failed.push(item); }
  }
  pqSave(failed);
  return q.length - failed.length;
};
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

// ─── Sound notifications ──────────────────────────────────────────────────────
const playSound = (type) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    const sounds = {
      checkin:    { freq:[523,659,784],  dur:0.12, vol:0.35 }, // do-mi-sol ✓
      checkout:   { freq:[784,659,523],  dur:0.12, vol:0.3  }, // sol-mi-do ↓
      breakstart: { freq:[440,440],      dur:0.18, vol:0.25 }, // ding-ding
      breakend:   { freq:[523,784,1047], dur:0.1,  vol:0.3  }, // ding-ding-high ↑
    };
    const s = sounds[type] || sounds.checkin;
    let t = ctx.currentTime;
    s.freq.forEach((f, i) => {
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.connect(g2); g2.connect(ctx.destination);
      o2.frequency.value = f;
      o2.type = "sine";
      g2.gain.setValueAtTime(0, t + i*s.dur);
      g2.gain.linearRampToValueAtTime(s.vol, t + i*s.dur + 0.02);
      g2.gain.linearRampToValueAtTime(0, t + i*s.dur + s.dur);
      o2.start(t + i*s.dur);
      o2.stop(t + i*s.dur + s.dur + 0.05);
    });
    ctx.close.bind(ctx); // cleanup
  } catch(_) {} // ถ้าเบราว์เซอร์ไม่รองรับก็ไม่ error
};

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
// ─── Shifts override ─────────────────────────────────────────────────────────
let _shiftsMap = {};
const setShiftsMap = (data) => {
  _shiftsMap = {};
  (data||[]).forEach(s=>{ _shiftsMap[`${s.date}|${s.empId}`] = s; });
};
const getShiftOverride = (dateStr, empId) => _shiftsMap[`${dateStr}|${empId}`] || null;

const getScheduleForDate = (dateStr, emp, gSch) => {
  if (!dateStr) return null;
  // ✅ Shifts override ก่อนเสมอ
  if (emp?.id) {
    const ov = getShiftOverride(dateStr, emp.id);
    if (ov) {
      const extra = {
        graceMins:      emp?.graceMins      != null ? +emp.graceMins      : (gSch?.graceMins      ?? 15),
        maxLeaveDays:   emp?.maxLeaveDays   != null ? +emp.maxLeaveDays   : (gSch?.maxLeaveDays   ?? 10),
        breakLimitMins: emp?.breakLimitMins != null ? +emp.breakLimitMins : (gSch?.breakLimitMins ?? 60),
      };
      if (ov.type === "off")  return null; // หยุดแทน
      if (ov.type === "work" && ov.startTime && ov.endTime)
        return { startTime:ov.startTime, endTime:ov.endTime, ...extra, isShiftOverride:true };
    }
  }
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

// ─── Clinic Photo BG (base64) ──────────────────────────────────────────────
const CLINIC_PHOTO_BG = "data:image/jpeg;base64,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";

// ─── Themes ───────────────────────────────────────────────────────────────────
const THEMES = [
  { id:"light",     name:"ใส",              emoji:"🌿", dark:false, bg:"#edfdf6",bg2:"#e0f9ef",bg3:"#f0fffe", card:"rgba(255,255,255,.86)",card2:"rgba(255,255,255,.66)", br:"rgba(0,0,0,.09)",br2:"rgba(0,0,0,.14)", tx:"rgba(0,0,0,.84)",tx2:"rgba(0,0,0,.5)",tx3:"rgba(0,0,0,.28)", acc:"#059669",acc2:"#0d9488", aB:"rgba(5,150,105,.12)",rB:"rgba(220,38,38,.1)",yB:"rgba(202,138,4,.12)",pB:"rgba(124,58,237,.12)",oB:"rgba(234,88,12,.12)", red:"#dc2626",yellow:"#ca8a04",purple:"#7c3aed",orange:"#ea580c" },
  { id:"vetclinic", name:"คลินิค 🐾",       emoji:"🐾", dark:false, bg:"#fff8f2",bg2:"#fff3e8",bg3:"#fff9f4", card:"rgba(255,255,255,.88)",card2:"rgba(255,255,255,.7)",  br:"rgba(0,0,0,.08)",br2:"rgba(0,0,0,.13)", tx:"rgba(0,0,0,.84)",tx2:"rgba(0,0,0,.5)",tx3:"rgba(0,0,0,.28)", acc:"#ea580c",acc2:"#d97706", aB:"rgba(234,88,12,.12)",rB:"rgba(220,38,38,.1)",yB:"rgba(202,138,4,.12)",pB:"rgba(124,58,237,.12)",oB:"rgba(234,88,12,.12)", red:"#dc2626",yellow:"#ca8a04",purple:"#7c3aed",orange:"#ea580c" },
  { id:"darkpink",  name:"ดำชมพู 🖤🩷",     emoji:"🖤", dark:true,  bg:"#0f0614",bg2:"#150a1c",bg3:"#0a0110", card:"rgba(255,255,255,.07)",card2:"rgba(255,255,255,.1)",  br:"rgba(244,114,182,.18)",br2:"rgba(244,114,182,.28)", tx:"rgba(255,255,255,.94)",tx2:"rgba(255,255,255,.5)",tx3:"rgba(255,255,255,.25)", acc:"#f472b6",acc2:"#e879f9", aB:"rgba(244,114,182,.18)",rB:"rgba(248,113,113,.15)",yB:"rgba(251,191,36,.15)",pB:"rgba(192,132,252,.18)",oB:"rgba(251,146,60,.13)", red:"#f87171",yellow:"#fbbf24",purple:"#e879f9",orange:"#fb923c" },
  { id:"vetnight",  name:"คลินิคกลางคืน 🌙",emoji:"🌙", dark:true,  bg:"#160a00",bg2:"#1f0e00",bg3:"#120800", card:"rgba(255,255,255,.07)",card2:"rgba(255,255,255,.1)",  br:"rgba(251,146,60,.18)",br2:"rgba(251,146,60,.28)", tx:"rgba(255,255,255,.94)",tx2:"rgba(255,255,255,.5)",tx3:"rgba(255,255,255,.25)", acc:"#fb923c",acc2:"#f59e0b", aB:"rgba(251,146,60,.18)",rB:"rgba(248,113,113,.15)",yB:"rgba(251,191,36,.15)",pB:"rgba(192,132,252,.15)",oB:"rgba(251,146,60,.18)", red:"#f87171",yellow:"#fbbf24",purple:"#c084fc",orange:"#fb923c" },
  { id:"forest",    name:"ป่า 🌲",           emoji:"🌲", dark:true,  bg:"#071a12",bg2:"#0a2318",bg3:"#071510", card:"rgba(255,255,255,.07)",card2:"rgba(255,255,255,.1)",  br:"rgba(255,255,255,.1)",br2:"rgba(255,255,255,.16)", tx:"rgba(255,255,255,.94)",tx2:"rgba(255,255,255,.5)",tx3:"rgba(255,255,255,.25)", acc:"#34d399",acc2:"#2dd4bf", aB:"rgba(52,211,153,.14)",rB:"rgba(248,113,113,.13)",yB:"rgba(251,191,36,.13)",pB:"rgba(192,132,252,.13)",oB:"rgba(251,146,60,.13)", red:"#f87171",yellow:"#fbbf24",purple:"#c084fc",orange:"#fb923c" },
  { id:"ocean",     name:"ทะเล 🌊",          emoji:"🌊", dark:true,  bg:"#060f1f",bg2:"#0c1a35",bg3:"#08122a", card:"rgba(255,255,255,.07)",card2:"rgba(255,255,255,.1)",  br:"rgba(96,165,250,.15)",br2:"rgba(96,165,250,.25)", tx:"rgba(255,255,255,.94)",tx2:"rgba(255,255,255,.5)",tx3:"rgba(255,255,255,.25)", acc:"#38bdf8",acc2:"#67e8f9", aB:"rgba(56,189,248,.14)",rB:"rgba(248,113,113,.13)",yB:"rgba(251,191,36,.13)",pB:"rgba(192,132,252,.13)",oB:"rgba(251,146,60,.13)", red:"#f87171",yellow:"#fbbf24",purple:"#c084fc",orange:"#fb923c" },
  { id:"sakura",    name:"ซากุระ 🌸",        emoji:"🌸", dark:false, bg:"#fef2f8",bg2:"#fdf4ff",bg3:"#fff1f5", card:"rgba(255,255,255,.86)",card2:"rgba(255,255,255,.66)", br:"rgba(0,0,0,.08)",br2:"rgba(0,0,0,.13)", tx:"rgba(0,0,0,.82)",tx2:"rgba(0,0,0,.48)",tx3:"rgba(0,0,0,.27)", acc:"#db2777",acc2:"#9333ea", aB:"rgba(219,39,119,.11)",rB:"rgba(220,38,38,.09)",yB:"rgba(202,138,4,.1)",pB:"rgba(124,58,237,.1)",oB:"rgba(234,88,12,.1)", red:"#dc2626",yellow:"#ca8a04",purple:"#7c3aed",orange:"#ea580c" },
  { id:"cyber",     name:"Cyber ⚡",            emoji:"⚡", dark:true,  bg:"#050505",bg2:"#0a0a0a",bg3:"#030303", card:"rgba(255,255,255,.05)",card2:"rgba(255,255,255,.08)", br:"rgba(0,255,200,.18)",br2:"rgba(0,255,200,.32)", tx:"rgba(255,255,255,.95)",tx2:"rgba(255,255,255,.55)",tx3:"rgba(255,255,255,.25)", acc:"#00ffc8",acc2:"#00e5ff", aB:"rgba(0,255,200,.15)",rB:"rgba(255,50,50,.15)",yB:"rgba(255,220,0,.15)",pB:"rgba(180,0,255,.15)",oB:"rgba(255,140,0,.15)", red:"#ff3232",yellow:"#ffd700",purple:"#b400ff",orange:"#ff8c00" },
  { id:"cyberpunk", name:"Cyberpunk 🌆",         emoji:"🌆", dark:true,  bg:"#0d0015",bg2:"#120020",bg3:"#08000f", card:"rgba(255,255,255,.06)",card2:"rgba(255,255,255,.09)", br:"rgba(255,0,200,.2)",br2:"rgba(255,0,200,.35)",  tx:"rgba(255,255,255,.95)",tx2:"rgba(255,255,255,.55)",tx3:"rgba(255,255,255,.25)", acc:"#ff00cc",acc2:"#ffee00", aB:"rgba(255,0,200,.15)",rB:"rgba(255,50,50,.15)",yB:"rgba(255,220,0,.15)",pB:"rgba(200,0,255,.15)",oB:"rgba(255,140,0,.15)", red:"#ff3232",yellow:"#ffee00",purple:"#cc00ff",orange:"#ff6600" },


  // Firework: พื้นดำสนิท ตัวหนังสือขาว พลุปุ้งๆ
  { id:"firework",  name:"พลุ 🎆",                emoji:"🎆", dark:true,  bg:"#000000",bg2:"#050505",bg3:"#000000", card:"rgba(255,255,255,.07)",card2:"rgba(255,255,255,.1)",  br:"rgba(255,255,255,.12)",br2:"rgba(255,255,255,.22)", tx:"rgba(255,255,255,.96)",tx2:"rgba(255,255,255,.55)",tx3:"rgba(255,255,255,.28)", acc:"#ffffff",acc2:"#ffe066", aB:"rgba(255,255,255,.1)",rB:"rgba(255,80,80,.15)",yB:"rgba(255,220,0,.15)",pB:"rgba(200,100,255,.15)",oB:"rgba(255,140,0,.15)", red:"#ff5050",yellow:"#ffe066",purple:"#cc66ff",orange:"#ff9900" },

  // Sakura Fall: ดอกซากุระร่วง พื้นชมพูอ่อนมาก ตัวหนังสือขาว
  { id:"sakurafall", name:"ซากุระร่วง 🌸",         emoji:"🌸", dark:true,  bg:"#1a0010",bg2:"#240018",bg3:"#12000b", card:"rgba(255,255,255,.07)",card2:"rgba(255,255,255,.1)",  br:"rgba(255,182,213,.18)",br2:"rgba(255,182,213,.3)", tx:"rgba(255,255,255,.96)",tx2:"rgba(255,210,230,.6)",tx3:"rgba(255,182,213,.32)", acc:"#ff90c0",acc2:"#ffb6d9", aB:"rgba(255,144,192,.14)",rB:"rgba(255,80,100,.14)",yB:"rgba(255,210,100,.14)",pB:"rgba(220,100,255,.14)",oB:"rgba(255,140,80,.14)", red:"#ff6080",yellow:"#ffd966",purple:"#e080ff",orange:"#ff9966" },

  // Pastel Sky: ฟ้าพาสเทล ตัวหนังสือขาว
  { id:"pastelsky",  name:"ฟ้าพาสเทล ☁️",          emoji:"☁️", dark:false, bg:"#a8d8f0",bg2:"#b8e0f7",bg3:"#90c8e8", card:"rgba(255,255,255,.45)",card2:"rgba(255,255,255,.6)", br:"rgba(255,255,255,.5)",br2:"rgba(255,255,255,.7)", tx:"rgba(10,40,100,.9)",tx2:"rgba(10,40,100,.6)",tx3:"rgba(10,40,100,.35)", acc:"#1a5cb8",acc2:"#1e7fd4", aB:"rgba(26,92,184,.12)",rB:"rgba(220,38,38,.1)",yB:"rgba(180,120,0,.1)",pB:"rgba(100,60,200,.1)",oB:"rgba(200,80,0,.1)", red:"#c02030",yellow:"#a06000",purple:"#5020c0",orange:"#c05000" },

  // Ivory & Gold: เรียบหรู โทนงาช้าง-ทอง เป็นทางการ
  { id:"ivorygold", name:"งาช้างทอง 🏵", emoji:"🏵", dark:false,
    bg:"#fdfdfb",bg2:"#f6f1e6",bg3:"#efe7d4",
    card:"rgba(255,255,255,.82)",card2:"rgba(255,255,255,.6)",
    br:"rgba(180,140,60,.22)",br2:"rgba(180,140,60,.4)",
    tx:"rgba(40,32,16,.88)",tx2:"rgba(40,32,16,.52)",tx3:"rgba(40,32,16,.28)",
    acc:"#a87c1f",acc2:"#c9a13a",
    aB:"rgba(168,124,31,.12)",rB:"rgba(180,40,40,.1)",yB:"rgba(201,161,58,.16)",pB:"rgba(110,80,150,.1)",oB:"rgba(190,110,40,.1)",
    red:"#a82828",yellow:"#a87c1f",purple:"#6e5096",orange:"#b56e28" },

  // Clinic Photo: ภาพบรรยากาศคลินิกจริง เบลอ+มืดลง ให้อ่านง่าย
  { id:"clinicphoto", name:"คลินิคของเรา 🏥", emoji:"🏥", dark:true, photoBg:true,
    bg:"#0a0a0c",bg2:"#0a0a0c",bg3:"#0a0a0c",
    card:"rgba(255,255,255,.1)",card2:"rgba(255,255,255,.14)",
    br:"rgba(255,255,255,.16)",br2:"rgba(255,255,255,.28)",
    tx:"rgba(255,255,255,.97)",tx2:"rgba(255,255,255,.65)",tx3:"rgba(255,255,255,.35)",
    acc:"#ffb84d",acc2:"#ff8a3d",
    aB:"rgba(255,184,77,.18)",rB:"rgba(255,90,90,.18)",yB:"rgba(255,210,80,.18)",pB:"rgba(190,120,255,.18)",oB:"rgba(255,140,60,.18)",
    red:"#ff5a5a",yellow:"#ffd250",purple:"#be78ff",orange:"#ff8c3c" },
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
    const ctx = c.getContext("2d"); let W, H, items=[], grid=[], raf, frame=0;
    const EM=["🐶","🐱","🦁","🐯","🐼","🦊","🐰","🦮","🐈","🦄","🐮","🐺","🩺","💉","🩻","🩹","💊","🧬","🌿","🌱","🍃","🐾","🐾","🐾"];
    const resize=()=>{
      W=c.width=window.innerWidth;H=c.height=window.innerHeight;
      // Rebuild grid for cyber themes
      grid=[];
      const cols=Math.ceil(W/60)+1, rows=Math.ceil(H/60)+1;
      for(let r=0;r<rows;r++) for(let col=0;col<cols;col++) grid.push({x:col*60,y:r*60,opacity:Math.random()*.15,speed:0.002+Math.random()*.006,phase:Math.random()*Math.PI*2});
    };
    resize(); window.addEventListener("resize",resize);
    for(let i=0;i<36;i++) items.push({x:Math.random()*1200,y:Math.random()*800,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.35,a:Math.random()*Math.PI*2,va:(Math.random()-.5)*.01,s:16+Math.random()*22,op:0.04+Math.random()*.11,ch:EM[Math.floor(Math.random()*EM.length)],bo:Math.random()*Math.PI*2,bs:0.018+Math.random()*.025});
    const draw=()=>{
      frame++;
      ctx.clearRect(0,0,W,H);
      const th=THEMES.find(x=>x.id===tRef.current)||THEMES[0];
      const isCyber    = th.id==="cyber"||th.id==="cyberpunk";

      // Background gradient
      const g=ctx.createLinearGradient(0,0,W,H);
      g.addColorStop(0,th.bg);g.addColorStop(.5,th.bg2);g.addColorStop(1,th.bg3);
      ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

      if(isCyber) {
        // === CYBER BG: scanlines + grid + floating code chars ===
        const accentCol = th.id==="cyberpunk" ? "255,0,200" : "0,255,200";
        const accentCol2 = th.id==="cyberpunk" ? "255,230,0" : "0,200,255";

        // Grid dots
        grid.forEach(p=>{
          p.phase+=p.speed;
          const op = (Math.sin(p.phase)+1)/2 * 0.12;
          ctx.beginPath();
          ctx.arc(p.x,p.y,1.2,0,Math.PI*2);
          ctx.fillStyle = "rgba("+accentCol+","+op+")";
          ctx.fill();
        });

        // Scanlines
        for(let y=0;y<H;y+=4){
          ctx.fillStyle = "rgba(0,0,0,0.06)";
          ctx.fillRect(0,y,W,2);
        }

        // Floating cyber chars (binary/symbols)
        const CYBER_CHARS = ["0","1","⬡","◈","⚡","▸","◼","⬢","//","{}","</>","01","10","⌬","△","▲","◆","║","═","╬"];
        items.forEach(p=>{
          p.x+=p.vx*.6; p.y+=p.vy*.6+Math.sin(p.bo)*.15; p.a+=p.va*.5; p.bo+=p.bs;
          if(p.x<-80)p.x=W+60; if(p.x>W+80)p.x=-60;
          if(p.y<-80)p.y=H+60; if(p.y>H+80)p.y=-60;
          ctx.save();
          ctx.globalAlpha = 0.06+Math.sin(p.bo)*0.04;
          ctx.translate(p.x,p.y); ctx.rotate(p.a);
          ctx.font = `${p.s*0.8}px 'JetBrains Mono',monospace`;
          ctx.textAlign="center"; ctx.textBaseline="middle";
          const useSecond = Math.sin(p.phase||0)>0;
          ctx.fillStyle = useSecond ? "rgba("+accentCol2+",1)" : "rgba("+accentCol+",1)";
          ctx.fillText(CYBER_CHARS[Math.floor(p.s*3)%CYBER_CHARS.length],0,0);
          ctx.restore();
        });

        // Horizontal neon scan line that moves down
        const scanY = (frame*0.8) % (H+100) - 50;
        const scanGrad = ctx.createLinearGradient(0,scanY-30,0,scanY+30);
        scanGrad.addColorStop(0,"rgba("+accentCol+",0)");
        scanGrad.addColorStop(0.5,"rgba("+accentCol+",0.08)");
        scanGrad.addColorStop(1,"rgba("+accentCol+",0)");
        ctx.fillStyle=scanGrad; ctx.fillRect(0,scanY-30,W,60);

        // Corner brackets decoration
        const bSize=40, bOp=0.15;
        ctx.strokeStyle="rgba("+accentCol+","+bOp+")"; ctx.lineWidth=1.5;
        [[20,20],[W-20,20],[20,H-20],[W-20,H-20]].forEach(([cx,cy])=>{
          const sx=cx<W/2?1:-1, sy=cy<H/2?1:-1;
          ctx.beginPath(); ctx.moveTo(cx,cy+sy*bSize); ctx.lineTo(cx,cy); ctx.lineTo(cx+sx*bSize,cy); ctx.stroke();
        });

      } else if(th.id==="firework") {
        // === FIREWORK: พลุระเบิดปุ้งๆ ===
        if(!draw._fw){ draw._fw=[]; draw._fwp=[]; }

        // spawn พลุใหม่ทุกๆ ~90 frame
        if(frame%90===0 || draw._fw.length===0){
          const colors=["255,80,80","255,180,0","80,220,255","200,80,255","80,255,160","255,255,80","255,120,200","100,200,255"];
          const hue = colors[Math.floor(Math.random()*colors.length)];
          const cx=W*0.15+Math.random()*W*0.7, cy=H*0.1+Math.random()*H*0.45;
          const count=60+Math.floor(Math.random()*50);
          for(let i=0;i<count;i++){
            const angle=((Math.PI*2)/count)*i + Math.random()*0.3;
            const spd=1.5+Math.random()*4;
            draw._fw.push({
              x:cx, y:cy,
              vx:Math.cos(angle)*spd, vy:Math.sin(angle)*spd,
              life:1, decay:0.012+Math.random()*0.018,
              r:2+Math.random()*2.5, color:hue,
              trail:[],
            });
          }
          // แฟลชตรงกลาง
          draw._fwp.push({x:cx,y:cy,r:0,maxR:60+Math.random()*60,color:hue,alpha:0.6});
        }

        // วาด flash ring
        draw._fwp = draw._fwp.filter(p=>{
          p.r+=4; p.alpha-=0.04;
          if(p.alpha<=0) return false;
          ctx.beginPath();
          ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
          ctx.strokeStyle=`rgba(${p.color},${p.alpha})`;
          ctx.lineWidth=2;
          ctx.stroke();
          return true;
        });

        // วาดอนุภาคพลุ
        draw._fw = draw._fw.filter(p=>{
          p.trail.push({x:p.x,y:p.y});
          if(p.trail.length>8) p.trail.shift();
          p.x+=p.vx; p.y+=p.vy;
          p.vy+=0.06; // gravity
          p.vx*=0.98; p.vy*=0.98;
          p.life-=p.decay;
          if(p.life<=0) return false;

          // วาด trail
          for(let t=0;t<p.trail.length;t++){
            const ta=(t/p.trail.length)*p.life*0.5;
            ctx.beginPath();
            ctx.arc(p.trail[t].x,p.trail[t].y,p.r*(t/p.trail.length)*0.7,0,Math.PI*2);
            ctx.fillStyle=`rgba(${p.color},${ta})`;
            ctx.fill();
          }
          // วาด head
          ctx.beginPath();
          ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
          ctx.fillStyle=`rgba(${p.color},${p.life})`;
          ctx.fill();
          // sparkle เล็กๆ
          if(Math.random()<0.15){
            ctx.beginPath();
            ctx.arc(p.x+Math.random()*6-3,p.y+Math.random()*6-3,0.8,0,Math.PI*2);
            ctx.fillStyle=`rgba(255,255,255,${p.life*0.6})`;
            ctx.fill();
          }
          return true;
        });

        // ดาวเล็กๆ พื้นหลัง
        if(!draw._stars){
          draw._stars=Array.from({length:120},()=>({
            x:Math.random()*2000, y:Math.random()*1200,
            r:0.4+Math.random()*1.2, alpha:0.1+Math.random()*0.5,
            twinkle:Math.random()*Math.PI*2, speed:0.02+Math.random()*0.04
          }));
        }
        draw._stars.forEach(s=>{
          s.twinkle+=s.speed;
          const a=s.alpha*(0.5+Math.sin(s.twinkle)*0.5);
          ctx.beginPath(); ctx.arc(s.x%W,s.y%H,s.r,0,Math.PI*2);
          ctx.fillStyle=`rgba(255,255,255,${a})`; ctx.fill();
        });

      } else if(th.id==="sakurafall") {
        // === SAKURA FALL: ดอกซากุระร่วงหล่น ===
        if(!draw._sk){
          draw._sk = Array.from({length:90},(_,i)=>({
            x: Math.random()*2000,
            y: Math.random()*1400 - 200,
            size: 5+Math.random()*10,
            rot: Math.random()*Math.PI*2,
            rotSpd: (Math.random()-.5)*0.04,
            spd: 0.6+Math.random()*1.4,
            drift: (Math.random()-.5)*0.5,
            sway: Math.random()*Math.PI*2,
            swaySpd: 0.015+Math.random()*0.02,
            swayAmt: 0.4+Math.random()*0.8,
            alpha: 0.25+Math.random()*0.55,
            hue: 330+Math.floor(Math.random()*30), // ชมพู-แดง
            type: Math.floor(Math.random()*3), // 0=กลีบเล็ก 1=กลีบใหญ่ 2=ดอกเต็ม
          }));
        }

        // วาดกลีบซากุระแต่ละกลีบ
        const drawPetal = (cx,cy,size,rot,type,hue,alpha) => {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(cx,cy);
          ctx.rotate(rot);

          if(type===2) {
            // ดอกเต็ม 5 กลีบ (เล็กกว่า)
            const s = size*0.55;
            for(let i=0;i<5;i++){
              ctx.save();
              ctx.rotate((Math.PI*2/5)*i);
              ctx.beginPath();
              ctx.moveTo(0,0);
              ctx.bezierCurveTo(-s*0.5,-s*0.6, -s*0.2,-s*1.3, 0,-s*1.4);
              ctx.bezierCurveTo( s*0.2,-s*1.3,  s*0.5,-s*0.6, 0,0);
              const g2=ctx.createRadialGradient(0,-s*0.7,0,0,-s*0.7,s);
              g2.addColorStop(0,`hsla(${hue},100%,92%,1)`);
              g2.addColorStop(1,`hsla(${hue-10},90%,75%,1)`);
              ctx.fillStyle=g2; ctx.fill();
              ctx.restore();
            }
            // กลางดอก
            ctx.beginPath(); ctx.arc(0,0,s*0.25,0,Math.PI*2);
            ctx.fillStyle=`hsla(${hue+30},80%,88%,0.9)`; ctx.fill();

          } else {
            // กลีบเดี่ยว รูปหัวใจหัวกลับ
            const s = type===1 ? size : size*0.7;
            ctx.beginPath();
            ctx.moveTo(0, s*0.6);
            ctx.bezierCurveTo(-s*0.9, s*0.2, -s*0.9,-s*0.7,  0,-s*0.4);
            ctx.bezierCurveTo( s*0.9,-s*0.7,  s*0.9, s*0.2,  0, s*0.6);
            const grd=ctx.createRadialGradient(0,0,0,0,0,s);
            grd.addColorStop(0,`hsla(${hue},95%,93%,1)`);
            grd.addColorStop(0.5,`hsla(${hue-5},90%,83%,1)`);
            grd.addColorStop(1,`hsla(${hue-15},85%,72%,0.8)`);
            ctx.fillStyle=grd; ctx.fill();
            // เส้นกลางกลีบ
            ctx.beginPath(); ctx.moveTo(0,s*0.6); ctx.lineTo(0,-s*0.3);
            ctx.strokeStyle=`hsla(${hue-20},70%,70%,0.4)`; ctx.lineWidth=0.7; ctx.stroke();
          }
          ctx.restore();
        };

        draw._sk.forEach(p=>{
          p.sway += p.swaySpd;
          p.x += p.drift + Math.sin(p.sway)*p.swayAmt;
          p.y += p.spd;
          p.rot += p.rotSpd + Math.sin(p.sway)*0.01;

          if(p.y > H+30){ p.y=-20; p.x=Math.random()*W; }
          if(p.x > W+30) p.x=-30;
          if(p.x < -30)  p.x=W+30;

          drawPetal(p.x, p.y, p.size, p.rot, p.type, p.hue, p.alpha);
        });

        // ambient glow พื้นหลัง — ไล่สีชมพูจาง
        const ambG = ctx.createRadialGradient(W*0.5,H*0.3,0,W*0.5,H*0.3,W*0.6);
        ambG.addColorStop(0,"rgba(255,150,200,0.04)");
        ambG.addColorStop(1,"rgba(255,150,200,0)");
        ctx.fillStyle=ambG; ctx.fillRect(0,0,W,H);

      } else if(th.id==="pastelsky") {
        // === PASTEL SKY: เมฆลอย + ฟองสบู่ + นก ===

        // เมฆ
        if(!draw._clouds){
          draw._clouds=Array.from({length:12},(_,i)=>({
            x:Math.random()*W, y:50+Math.random()*H*0.55,
            w:100+Math.random()*220, h:40+Math.random()*70,
            spd:0.18+Math.random()*0.35,
            alpha:0.18+Math.random()*0.28,
            puffs: Array.from({length:4+Math.floor(Math.random()*4)},()=>({
              ox:(Math.random()-.5)*80, oy:(Math.random()-.3)*30,
              r:22+Math.random()*38,
            })),
          }));
        }
        draw._clouds.forEach(c=>{
          c.x+=c.spd;
          if(c.x>W+c.w+100) c.x=-c.w-100;
          ctx.save(); ctx.globalAlpha=c.alpha;
          c.puffs.forEach(p=>{
            ctx.beginPath();
            ctx.arc(c.x+p.ox, c.y+p.oy, p.r, 0, Math.PI*2);
            ctx.fillStyle="rgba(255,255,255,1)"; ctx.fill();
          });
          ctx.restore();
        });

        // ฟองสบู่
        if(!draw._bubbles){
          draw._bubbles=Array.from({length:22},()=>({
            x:Math.random()*W, y:H+Math.random()*200,
            r:8+Math.random()*28, spd:0.4+Math.random()*0.9,
            drift:(Math.random()-.5)*0.4, sway:Math.random()*Math.PI*2,
            swaySpd:0.02+Math.random()*0.03, alpha:0.12+Math.random()*0.22,
          }));
        }
        draw._bubbles.forEach(b=>{
          b.sway+=b.swaySpd; b.x+=b.drift+Math.sin(b.sway)*0.5; b.y-=b.spd;
          if(b.y<-b.r*2){ b.y=H+b.r; b.x=Math.random()*W; }
          ctx.save(); ctx.globalAlpha=b.alpha;
          // ฟอง
          ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
          ctx.strokeStyle="rgba(255,255,255,0.7)"; ctx.lineWidth=1.5; ctx.stroke();
          // highlight
          ctx.beginPath(); ctx.arc(b.x-b.r*0.3, b.y-b.r*0.35, b.r*0.28, 0, Math.PI*2);
          ctx.fillStyle="rgba(255,255,255,0.55)"; ctx.fill();
          ctx.restore();
        });

        // นกเล็กๆ ลอยเป็น V shape
        if(!draw._birds){
          draw._birds=Array.from({length:5},(_,i)=>({
            x:Math.random()*W, y:60+Math.random()*H*0.35,
            spd:0.5+Math.random()*0.8, wing:Math.random()*Math.PI*2,
            wingSpd:0.06+Math.random()*0.06, scale:0.5+Math.random()*0.6,
          }));
        }
        draw._birds.forEach(b=>{
          b.x+=b.spd; b.wing+=b.wingSpd;
          if(b.x>W+60) b.x=-60;
          const wf=Math.sin(b.wing)*8*b.scale;
          ctx.save(); ctx.globalAlpha=0.35; ctx.strokeStyle="rgba(255,255,255,0.9)";
          ctx.lineWidth=1.5*b.scale; ctx.lineCap="round";
          // ปีกซ้าย
          ctx.beginPath(); ctx.moveTo(b.x,b.y); ctx.quadraticCurveTo(b.x-10*b.scale,b.y-wf,b.x-20*b.scale,b.y-2*b.scale); ctx.stroke();
          // ปีกขวา
          ctx.beginPath(); ctx.moveTo(b.x,b.y); ctx.quadraticCurveTo(b.x+10*b.scale,b.y-wf,b.x+20*b.scale,b.y-2*b.scale); ctx.stroke();
          ctx.restore();
        });

        // sun glow มุมซ้ายบน
        const sunG=ctx.createRadialGradient(80,80,0,80,80,200);
        sunG.addColorStop(0,"rgba(255,255,220,0.18)");
        sunG.addColorStop(1,"rgba(255,255,220,0)");
        ctx.fillStyle=sunG; ctx.fillRect(0,0,W,H);

      } else if(th.id==="sakura") {
        // === SAKURA (light): กลีบซากุระร่วงบนพื้นชมพูอ่อน สีเดิม ===

        // พื้นหลัง gradient อ่อนๆ
        const bg2G=ctx.createLinearGradient(0,0,W,H);
        bg2G.addColorStop(0,"#fef2f8"); bg2G.addColorStop(0.5,"#fdf4ff"); bg2G.addColorStop(1,"#fff1f5");
        ctx.fillStyle=bg2G; ctx.fillRect(0,0,W,H);

        if(!draw._sk2){
          draw._sk2=Array.from({length:70},()=>({
            x:Math.random()*W, y:Math.random()*H-100,
            size:4+Math.random()*9,
            rot:Math.random()*Math.PI*2,
            rotSpd:(Math.random()-.5)*0.035,
            spd:0.5+Math.random()*1.2,
            drift:(Math.random()-.5)*0.4,
            sway:Math.random()*Math.PI*2,
            swaySpd:0.012+Math.random()*0.02,
            swayAmt:0.3+Math.random()*0.7,
            alpha:0.2+Math.random()*0.45,
            hue:330+Math.floor(Math.random()*25),
            type:Math.floor(Math.random()*3),
          }));
        }

        const drawPetal2=(cx,cy,size,rot,type,hue,alpha)=>{
          ctx.save();
          ctx.globalAlpha=alpha;
          ctx.translate(cx,cy);
          ctx.rotate(rot);
          if(type===2){
            const s=size*0.55;
            for(let i=0;i<5;i++){
              ctx.save(); ctx.rotate((Math.PI*2/5)*i);
              ctx.beginPath();
              ctx.moveTo(0,0);
              ctx.bezierCurveTo(-s*0.5,-s*0.6,-s*0.2,-s*1.3,0,-s*1.4);
              ctx.bezierCurveTo(s*0.2,-s*1.3,s*0.5,-s*0.6,0,0);
              const g2=ctx.createRadialGradient(0,-s*0.7,0,0,-s*0.7,s);
              g2.addColorStop(0,`hsla(${hue},100%,88%,1)`);
              g2.addColorStop(1,`hsla(${hue-10},85%,72%,1)`);
              ctx.fillStyle=g2; ctx.fill(); ctx.restore();
            }
            ctx.beginPath(); ctx.arc(0,0,s*0.22,0,Math.PI*2);
            ctx.fillStyle=`hsla(${hue+25},80%,85%,0.9)`; ctx.fill();
          } else {
            const s=type===1?size:size*0.68;
            ctx.beginPath();
            ctx.moveTo(0,s*0.6);
            ctx.bezierCurveTo(-s*0.85,s*0.2,-s*0.85,-s*0.65,0,-s*0.4);
            ctx.bezierCurveTo(s*0.85,-s*0.65,s*0.85,s*0.2,0,s*0.6);
            const grd=ctx.createRadialGradient(0,0,0,0,0,s);
            grd.addColorStop(0,`hsla(${hue},95%,90%,1)`);
            grd.addColorStop(0.5,`hsla(${hue-5},88%,80%,1)`);
            grd.addColorStop(1,`hsla(${hue-15},80%,68%,0.7)`);
            ctx.fillStyle=grd; ctx.fill();
            ctx.beginPath(); ctx.moveTo(0,s*0.6); ctx.lineTo(0,-s*0.28);
            ctx.strokeStyle=`hsla(${hue-20},65%,65%,0.35)`; ctx.lineWidth=0.6; ctx.stroke();
          }
          ctx.restore();
        };

        draw._sk2.forEach(p=>{
          p.sway+=p.swaySpd;
          p.x+=p.drift+Math.sin(p.sway)*p.swayAmt;
          p.y+=p.spd;
          p.rot+=p.rotSpd+Math.sin(p.sway)*0.008;
          if(p.y>H+20){ p.y=-18; p.x=Math.random()*W; }
          if(p.x>W+20) p.x=-20;
          if(p.x<-20)  p.x=W+20;
          drawPetal2(p.x,p.y,p.size,p.rot,p.type,p.hue,p.alpha);
        });

        // ambient glow ชมพูจาง
        const amb=ctx.createRadialGradient(W*0.5,H*0.25,0,W*0.5,H*0.25,W*0.55);
        amb.addColorStop(0,"rgba(255,180,220,0.07)");
        amb.addColorStop(1,"rgba(255,180,220,0)");
        ctx.fillStyle=amb; ctx.fillRect(0,0,W,H);

      } else if(th.id==="ivorygold") {
        // === IVORY & GOLD: เรียบหรู ทองคำเปล่งประกาย + ลายเส้นวินเทจ ===

        // พื้นไล่สีงาช้างนุ่มๆ
        const ivoryG=ctx.createLinearGradient(0,0,W,H);
        ivoryG.addColorStop(0,"#fdfdfb"); ivoryG.addColorStop(0.5,"#f8f3e7"); ivoryG.addColorStop(1,"#f0e8d6");
        ctx.fillStyle=ivoryG; ctx.fillRect(0,0,W,H);

        // ── เส้นกรอบลายไทย/วินเทจมุมจอ (delicate corner ornaments) ──
        const drawCorner=(cx,cy,sx,sy,scale)=>{
          ctx.save();
          ctx.translate(cx,cy); ctx.scale(sx*scale,sy*scale);
          ctx.strokeStyle="rgba(180,140,60,0.16)"; ctx.lineWidth=1.2/scale;
          ctx.beginPath();
          ctx.moveTo(0,60); ctx.lineTo(0,18);
          ctx.bezierCurveTo(0,6, 6,0, 18,0);
          ctx.lineTo(60,0);
          ctx.stroke();
          // ใบไม้เล็กตรงมุม
          ctx.beginPath();
          ctx.moveTo(14,14);
          ctx.bezierCurveTo(20,8, 28,8, 32,14);
          ctx.bezierCurveTo(28,20, 20,20, 14,14);
          ctx.fillStyle="rgba(180,140,60,0.10)"; ctx.fill();
          // จุดทอง
          ctx.beginPath(); ctx.arc(23,14,2,0,Math.PI*2);
          ctx.fillStyle="rgba(180,140,60,0.22)"; ctx.fill();
          ctx.restore();
        };
        drawCorner(0,0,1,1,1.4);
        drawCorner(W,0,-1,1,1.4);
        drawCorner(0,H,1,-1,1.4);
        drawCorner(W,H,-1,-1,1.4);

        // ── ฝุ่นทองเปล่งประกายลอยช้าๆ (เบามาก ไม่รก) ──
        if(!draw._gold){
          draw._gold=Array.from({length:38},()=>({
            x:Math.random()*W, y:Math.random()*H,
            r:0.6+Math.random()*1.8,
            spd:0.06+Math.random()*0.14,
            drift:(Math.random()-.5)*0.12,
            tw:Math.random()*Math.PI*2,
            tws:0.012+Math.random()*0.022,
            baseA:0.12+Math.random()*0.3,
          }));
        }
        draw._gold.forEach(g=>{
          g.tw+=g.tws; g.y-=g.spd; g.x+=g.drift;
          if(g.y<-10){ g.y=H+10; g.x=Math.random()*W; }
          if(g.x<-10) g.x=W+10; if(g.x>W+10) g.x=-10;
          const a=g.baseA*((Math.sin(g.tw)+1)/2*0.7+0.3);
          // glow เล็กรอบจุด
          const sparkG=ctx.createRadialGradient(g.x,g.y,0,g.x,g.y,g.r*4);
          sparkG.addColorStop(0,`rgba(201,161,58,${a})`);
          sparkG.addColorStop(1,"rgba(201,161,58,0)");
          ctx.fillStyle=sparkG;
          ctx.beginPath(); ctx.arc(g.x,g.y,g.r*4,0,Math.PI*2); ctx.fill();
          // จุดแกนกลาง
          ctx.beginPath(); ctx.arc(g.x,g.y,g.r,0,Math.PI*2);
          ctx.fillStyle=`rgba(168,124,31,${a+0.15})`; ctx.fill();
        });

        // ── เส้นแบ่งทองบางๆ พาดกลางจอเบาๆ (subtle divider sweep) ──
        const sweepX = (frame*0.25) % (W+300) - 150;
        const sweepG=ctx.createLinearGradient(sweepX-80,0,sweepX+80,0);
        sweepG.addColorStop(0,"rgba(201,161,58,0)");
        sweepG.addColorStop(0.5,"rgba(201,161,58,0.05)");
        sweepG.addColorStop(1,"rgba(201,161,58,0)");
        ctx.fillStyle=sweepG; ctx.fillRect(0,0,W,H);

        // ── วงรี halo จางๆ มุมบนขวา (เหมือนแสงตกกระทบหรู) ──
        const haloG=ctx.createRadialGradient(W*0.85,H*0.08,0,W*0.85,H*0.08,W*0.4);
        haloG.addColorStop(0,"rgba(201,161,58,0.06)");
        haloG.addColorStop(1,"rgba(201,161,58,0)");
        ctx.fillStyle=haloG; ctx.fillRect(0,0,W,H);

      } else {
        // Normal animal emoji float
        items.forEach(p=>{
          p.x+=p.vx;p.y+=p.vy+Math.sin(p.bo)*.2;p.a+=p.va;p.bo+=p.bs;
          if(p.x<-70)p.x=W+50; if(p.x>W+70)p.x=-50;
          if(p.y<-70)p.y=H+50; if(p.y>H+70)p.y=-50;
          ctx.save();ctx.globalAlpha=th.dark?p.op:p.op*.6;
          ctx.translate(p.x,p.y);ctx.rotate(p.a);
          ctx.font=`${p.s}px serif`;ctx.textAlign="center";ctx.textBaseline="middle";
          ctx.fillText(p.ch,0,0);ctx.restore();
        });
      }
      raf=requestAnimationFrame(draw);
    };
    draw();
    return()=>{cancelAnimationFrame(raf);window.removeEventListener("resize",resize);};
  },[]);
  return <canvas ref={cvs} style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none"}}/>;
}

// ─── PhotoBG — พื้นหลังภาพถ่ายจริง เบลอ+มืดลง ให้อ่านง่าย ───────────────────────
function PhotoBG({ src }) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none",overflow:"hidden"}}>
      <div style={{
        position:"absolute",inset:"-20px",
        backgroundImage:`url(${src})`,
        backgroundSize:"cover",
        backgroundPosition:"center",
        filter:"blur(2px) brightness(0.55) saturate(1.05)",
        transform:"scale(1.05)",
      }}/>
      {/* ชั้นมืดเสริมไล่สีจากบนลงล่าง ให้การ์ด/ตัวหนังสือชัดขึ้น */}
      <div style={{
        position:"absolute",inset:0,
        background:"linear-gradient(180deg, rgba(8,8,10,.45) 0%, rgba(8,8,10,.25) 40%, rgba(8,8,10,.5) 100%)",
      }}/>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
// Render avatar: if URL → img, else emoji text
const AvatarImg = ({src, size=40, style={}}) => {
  const isImg = src && src.startsWith("http");
  return isImg
    ? <img src={src} alt="avatar" style={{width:size,height:size,borderRadius:"50%",objectFit:"cover",...style}} loading="lazy"/>
    : <span style={{fontSize:size*0.55,lineHeight:1,...style}}>{src||"🐾"}</span>;
};

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
const AVATAR_CATS = {
  "🐾 สัตว์": ["🐶","🐱","🦊","🐰","🐹","🐼","🐨","🐯","🦁","🐮","🐸","🐺","🦝","🦔","🦋","🐢","🦜","🦮","🐩","🐈","🦄","🐇","🦦","🦥","🐿️","🦌","🦘","🐊","🐬","🦅","🦉"],
  "🩺 การแพทย์": ["🩺","💉","🩸","🧬","🔬","🧪","💊","🩻","🩹","🏥","🚑","🌡️","🦷","🦴","🫀","🫁","🧠","⚕️","🌿","🌱","🍃","☘️","💚","❤️‍🩹","🐾"],
  "😺 ใบหน้า": ["😺","😸","😹","😻","😼","😽","🙀","😿","😾","🐱","🦊","🐶","🐸","🐼","🐨","🐯","🦁","🐮","🐷","🐰","🐭","🐹","🐻","🐻‍❄️","🐧","🐦","🦆","🦉","🦇"],
  "✨ สัญลักษณ์": ["⭐","🌟","💫","✨","🌙","☀️","🌈","🔥","💎","👑","🎯","🏆","💪","🌸","🌺","🌻","🌹","🍀","🌊","⚡","🎪","🎨","🎭","🎬","🎵","🎶"],
};
// Legacy — used in AnimBG
const EA=["🐶","🐱","🦁","🐯","🐼","🦊","🐰","🦮","🐈","🦄","🐮","🐺","🩺","💉","🩻","🩹","💊","🧬","🌿","🌱","🍃","🐾","🐾","🐾"];
const EM=["🩺","💉","🩸","🧬","🔬","🧪","💊","🩻","🩹","🏥","🚑","🌡️","🦷","🦴","🫀","🫁","🧠","⚕️","🌿","🌱","🍃","☘️","💚","❤️‍🩹","🐾","✦","⭐"];
// Photo avatars — cute illustrated style using DiceBear
const AVATAR_STYLES = ["adventurer","avataaars","big-ears","bottts","croodles","fun-emoji","icons","identicon","initials","lorelei","micah","miniavs","open-peeps","personas","pixel-art","rings","shapes","thumbs"];
const AVATAR_SEEDS = ["Felix","Lily","Max","Luna","Charlie","Mia","Oliver","Zoe","Leo","Bella","Jasper","Cleo","Bear","Nova","Ace","Sky","Rio","Kira","Mochi","Coco","Taro","Hana","Sora","Yuki","Nala","Simba","Nemo","Dory","Bambi","Dumbo"];
const getAvatar = (style, seed) => `https://api.dicebear.com/9.x/${style}/svg?seed=${seed}&size=64&backgroundColor=transparent`;
function EmojiPicker({value,onChange,onClose}){
  const[cat,setCat]=useState("a");
  const[avatarStyle,setAvatarStyle]=useState("adventurer");
  const list=cat==="a"?EA:EM;
  const isImgAvatar = value && value.startsWith("http");
  return(
    <div style={{position:"fixed",inset:0,zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16,background:"rgba(0,0,0,.55)",backdropFilter:"blur(8px)"}} onClick={onClose}>
      <div style={{background:"var(--bg)",border:"1px solid var(--br2)",borderRadius:20,padding:18,width:"100%",maxWidth:360,maxHeight:"80vh",overflow:"auto",boxShadow:"0 24px 60px rgba(0,0,0,.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
          <span style={{fontSize:14,fontWeight:700,color:"var(--tx)"}}>เลือก Avatar</span>
          <button onClick={onClose} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"3px 10px",fontSize:12,borderRadius:8}}>✕</button>
        </div>

        {/* Category tabs */}
        <div style={{display:"flex",gap:5,marginBottom:12,overflowX:"auto",paddingBottom:2}}>
          {[["a","🐾 สัตว์"],["m","🩺 การแพทย์"],["p","🖼️ รูปภาพ"]].map(([k,l])=>(
            <button key={k} onClick={()=>setCat(k)} style={{flex:"0 0 auto",padding:"7px 12px",background:cat===k?"var(--accBg)":"var(--card2)",color:cat===k?"var(--acc)":"var(--tx2)",border:`1px solid ${cat===k?"var(--acc)":"var(--br)"}`,borderRadius:10,fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>{l}</button>
          ))}
        </div>

        {/* Emoji grid */}
        {(cat==="a"||cat==="m")&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,maxHeight:220,overflowY:"auto"}}>
            {list.map((em,i)=>(
              <button key={i} onClick={()=>{onChange(em);onClose();}} style={{aspectRatio:"1",background:value===em?"var(--accBg)":"transparent",border:`1.5px solid ${value===em?"var(--acc)":"transparent"}`,borderRadius:10,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>{em}</button>
            ))}
          </div>
        )}

        {/* Photo avatars */}
        {cat==="p"&&(
          <div>
            {/* Style selector */}
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,color:"var(--tx2)",marginBottom:6}}>สไตล์</div>
              <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:4}}>
                {["adventurer","avataaars","big-ears","bottts","croodles","fun-emoji","lorelei","micah","open-peeps","pixel-art"].map(s=>(
                  <button key={s} onClick={()=>setAvatarStyle(s)} style={{flex:"0 0 auto",padding:"4px 10px",background:avatarStyle===s?"var(--accBg)":"var(--card2)",color:avatarStyle===s?"var(--acc)":"var(--tx2)",border:`1px solid ${avatarStyle===s?"var(--acc)":"var(--br)"}`,borderRadius:8,fontSize:10,whiteSpace:"nowrap"}}>{s}</button>
                ))}
              </div>
            </div>
            {/* Avatar grid */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,maxHeight:240,overflowY:"auto"}}>
              {AVATAR_SEEDS.map((seed,i)=>{
                const url = getAvatar(avatarStyle,seed);
                return(
                  <button key={i} onClick={()=>{onChange(url);onClose();}} style={{aspectRatio:"1",background:value===url?"var(--accBg)":"var(--card2)",border:`2px solid ${value===url?"var(--acc)":"transparent"}`,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",padding:4,overflow:"hidden",cursor:"pointer"}}>
                    <img src={url} alt={seed} style={{width:"100%",height:"100%",objectFit:"contain"}} loading="lazy"/>
                  </button>
                );
              })}
            </div>
            <div style={{fontSize:10,color:"var(--tx3)",marginTop:8,textAlign:"center"}}>รูปสร้างโดย DiceBear — ใช้งานฟรี</div>
          </div>
        )}
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
  const [shifts,   setShifts] = useState([]);
  const [records,  setRec]    = useState({});
  const [location, setLoc]    = useState(null);
  const [gSch,     setGSch]   = useState(null);
  const [clinic,   setClinic] = useState(null);
  const [user,     setUser]   = useState(null);
  const [view,     setView]   = useState("board"); // เริ่มที่หน้าสถานะทีมก่อน
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
    const [er,rr,cr,sr] = await Promise.all([call("getEmployees"),call("getRecords"),call("getConfig"),call("getShifts")]);
    if(!er.success){ setErr("เชื่อมต่อไม่สำเร็จ: " + (er.message||"ไม่ทราบสาเหตุ")); setLoad(false); return; }
    setEmp(er.data||[]);
    if(rr.success) setRec(rr.data||{});
    if(cr.success){ setLoc(cr.data?.location||null); setGSch(cr.data?.schedule||null); setClinic(cr.data?.clinic||null); }
    if(sr.success){ setShifts(sr.data||[]); setShiftsMap(sr.data||[]); }
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

  const [showBday, setShowBday] = useState(false);
  const [bdayUser, setBdayUser] = useState(null);

  const login = u => {
    // Check birthday
    if (u.birthday) {
      const todayFull = new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}); // "yyyy-MM-dd"
      const today_md  = todayFull.slice(5);           // "MM-DD"
      const bday_clean = String(u.birthday).trim();   // normalize
      const bday_md   = bday_clean.length >= 7 ? bday_clean.slice(5,10) : ""; // "MM-DD"
      console.log("[Birthday check]", u.name, "bday:", bday_clean, "bday_md:", bday_md, "today_md:", today_md);
      if (bday_md && today_md === bday_md) {
        const birthYear = parseInt(bday_clean.slice(0,4));
        const age = !isNaN(birthYear) && birthYear > 1900 ? new Date().getFullYear() - birthYear : null;
        setBdayUser({...u, _age: age});
        setShowBday(true);
      }
    }
    setUser(u); setView(u.role==="admin"?"admin":"dash");
  };
  const logout = () => { setUser(null); setView("login"); };

  const ws = { ...TV(th), minHeight:"100vh", position:"relative" };

  if(loading) return(
    <div style={{...ws,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:14}}>
      <style>{CSS}</style>{th.photoBg ? <PhotoBG src={CLINIC_PHOTO_BG}/> : <AnimBG themeId={themeId}/>}
      <div style={{width:46,height:46,border:"3px solid var(--br2)",borderTopColor:"var(--acc)",borderRadius:"50%"}} className="spin"/>
      <div style={{color:"var(--tx2)",fontSize:12,letterSpacing:3,textTransform:"uppercase"}}>กำลังโหลด...</div>
    </div>
  );

  return(
    <div style={ws}>
      <style>{CSS}</style>{th.photoBg ? <PhotoBG src={CLINIC_PHOTO_BG}/> : <AnimBG themeId={themeId}/>}
      <Toast msg={toast}/>
      <ThemeSwitcher current={themeId} onChange={changeTheme}/>
      {showBday && bdayUser && (
        <BirthdayPopup name={bdayUser.name} avatar={bdayUser.avatar} age={bdayUser._age}
          onClose={()=>setShowBday(false)}/>
      )}
      <div style={{position:"relative",zIndex:1}}>
        {view==="board" && <PublicBoard employees={employees} records={records} gSch={gSch} clinic={clinic} onLogin={()=>setView("login")}/>}
        {view==="login" && <Login employees={employees} err={err} clinic={clinic} onLogin={login} onRetry={loadAll} onBoard={()=>setView("board")}/>}
        {view==="dash"  && <Dash  user={user} empList={employees} records={records} location={location} gSch={gSch} clinic={clinic} setRec={setRec} onReloadRec={reloadRec} onReloadEmp={reloadEmp} onLogout={logout} showToast={showToast}/>}
        {view==="admin" && <AdminPanel user={user} employees={employees} records={records} shifts={shifts} location={location} gSch={gSch} clinic={clinic} onReloadAll={loadAll} onReloadRec={reloadRec} onLogout={logout} showToast={showToast}/>}
      </div>
    </div>
  );
}

// ─── Public Status Board (ไม่ต้อง login) ────────────────────────────────────────
function PublicBoard({ employees, records, gSch, clinic, onLogin }) {
  const [now, setNow] = useState(new Date());
  useEffect(()=>{
    const t=setInterval(()=>setNow(new Date()),1000);
    return()=>clearInterval(t);
  },[]);
  const staff = employees.filter(e => e.role !== "admin");
  const tod   = today();

  const getStatus = (e) => {
    const r = records[tod]?.[e.id];
    const s = getTodaySchedule(e, gSch);
    if (!r?.checkIn)           return { type:"absent",  label:"ยังไม่เข้างาน", color:"var(--tx3)",    bg:"var(--card2)",     icon:"⬜" };
    if (r?.breakStart && !r?.breakEnd && !r?.checkOut) {
      const mins = dm(r.breakStart, now.toISOString());
      const limit = s?.breakLimitMins ?? 60;
      const over  = mins != null && mins > limit;
      return { type:"break", label:`☕ พักอยู่ ${mins!=null?hm(mins):""}${over?" ⚠":""}`, color: over?"var(--red)":"var(--yellow)", bg:"var(--yellowBg)", icon:"☕" };
    }
    if (r?.checkOut)           return { type:"done",    label:"เลิกงานแล้ว",   color:"var(--tx2)",    bg:"var(--card2)",     icon:"✅" };
    return                          { type:"working", label:"กำลังทำงาน",   color:"var(--acc)",    bg:"var(--accBg)",     icon:"🟢" };
  };

  const groups = {
    working: staff.filter(e=>getStatus(e).type==="working"),
    break:   staff.filter(e=>getStatus(e).type==="break"),
    done:    staff.filter(e=>getStatus(e).type==="done"),
    absent:  staff.filter(e=>getStatus(e).type==="absent"),
  };

  return(
    <div style={{maxWidth:480,margin:"0 auto",padding:"16px 14px 80px",minHeight:"100vh"}}>
      {/* Header */}
      <div style={{textAlign:"center",marginBottom:20}}>
        <div style={{width:60,height:60,background:"var(--accBg)",border:"2px solid var(--acc)",borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10px",fontSize:30}}>🐾</div>
        <div style={{fontSize:18,fontWeight:800,color:"var(--tx)"}}>{clinic?.name||"คลินิคท่านาสัตวแพทย์"}</div>
        <div style={{color:"var(--tx2)",fontSize:11,letterSpacing:3,textTransform:"uppercase",marginTop:2}}>สถานะทีมงาน</div>
        <div className="mono" style={{fontSize:36,fontWeight:700,color:"var(--acc)",marginTop:10,letterSpacing:3}}>
          {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Bangkok"})}
        </div>
        <div style={{color:"var(--tx2)",fontSize:12,marginTop:4}}>
          {now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Bangkok"})}
        </div>
      </div>

      {/* Summary pills */}
      <div style={{display:"flex",gap:7,justifyContent:"center",marginBottom:20,flexWrap:"wrap"}}>
        {[
          {l:`🟢 ทำงาน ${groups.working.length}`,c:"var(--acc)",bg:"var(--accBg)"},
          {l:`☕ พัก ${groups.break.length}`,c:"var(--yellow)",bg:"var(--yellowBg)"},
          {l:`✅ เลิกงาน ${groups.done.length}`,c:"var(--tx2)",bg:"var(--card2)"},
          {l:`⬜ ยังไม่เข้า ${groups.absent.length}`,c:"var(--tx3)",bg:"transparent"},
        ].map((p,i)=>(
          <span key={i} className="pill" style={{background:p.bg,color:p.c,border:`1px solid ${p.c}30`,fontSize:12,padding:"5px 14px"}}>{p.l}</span>
        ))}
      </div>

      {/* Group sections */}
      {[
        {key:"working", title:"🟢 กำลังทำงาน",   col:"var(--acc)"},
        {key:"break",   title:"☕ กำลังพักอยู่",  col:"var(--yellow)"},
        {key:"done",    title:"✅ เลิกงานแล้ว",   col:"var(--tx2)"},
        {key:"absent",  title:"⬜ ยังไม่เข้างาน", col:"var(--tx3)"},
      ].map(({key,title,col})=>{
        const list = groups[key];
        if(list.length===0) return null;
        return(
          <div key={key} style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:col,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8,paddingLeft:4}}>{title}</div>
            <div style={{display:"grid",gap:8}}>
              {list.map(e=>{
                const st  = getStatus(e);
                const r   = records[tod]?.[e.id];
                return(
                  <div key={e.id} className="card2" style={{padding:"11px 14px",display:"flex",alignItems:"center",gap:12,borderColor:st.color+"30",background:st.bg}}>
                    <div style={{flexShrink:0}}><AvatarImg src={e.avatar} size={40}/></div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14,color:"var(--tx)",lineHeight:1.3}}>{e.name}</div>
                      <div style={{fontSize:11,color:"var(--tx2)"}}>{e.position||""}{e.department?` · ${e.department}`:""}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:st.color}}>{st.label}</div>
                      {r?.checkIn&&<div className="mono" style={{fontSize:10,color:"var(--tx3)",marginTop:2}}>▶ {ft(r.checkIn)}{r.checkOut?` ■ ${ft(r.checkOut)}`:""}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Login button */}
      <div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:50}}>
        <button onClick={onLogin} style={{background:"var(--card)",border:"1px solid var(--br2)",color:"var(--tx2)",padding:"10px 24px",borderRadius:50,fontSize:13,backdropFilter:"blur(16px)",boxShadow:"0 4px 20px rgba(0,0,0,.15)"}}>
          🔐 เข้าสู่ระบบ
        </button>
      </div>
    </div>
  );
}



// ─── Birthday Popup ─────────────────────────────────────────────────────────────
function BirthdayPopup({ name, avatar, age, onClose }) {
  useEffect(()=>{ const t=setTimeout(onClose, 12000); return()=>clearTimeout(t); },[]);
  return(
    <div style={{position:"fixed",inset:0,zIndex:800,display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:"rgba(0,0,0,.65)",backdropFilter:"blur(10px)",animation:"fd .3s ease"}}
      onClick={onClose}>
      <div className="card" style={{maxWidth:340,width:"100%",padding:"32px 28px",textAlign:"center",borderColor:"rgba(255,215,0,.4)",boxShadow:"0 0 60px rgba(255,200,0,.25)",animation:"pop .4s ease"}}
        onClick={e=>e.stopPropagation()}>
        {/* Confetti dots */}
        {["🎉","🎊","🎈","✨","🥳","🎁","⭐","🎀"].map((em,i)=>(
          <span key={i} style={{position:"absolute",fontSize:20,
            top:`${10+Math.random()*80}%`,left:`${5+i*12}%`,
            animation:`fd ${0.3+i*0.15}s ease`,opacity:0.8}}>{em}</span>
        ))}
        {/* Avatar */}
        <div style={{fontSize:64,marginBottom:8,animation:"pop .5s ease"}}>{avatar||"🐾"}</div>
        {/* Title */}
        <div style={{fontSize:28,marginBottom:4}}>🎂</div>
        <div style={{fontSize:22,fontWeight:800,color:"var(--tx)",marginBottom:6}}>สุขสันต์วันเกิด!</div>
        <div style={{fontSize:16,color:"var(--acc)",fontWeight:700,marginBottom:4}}>🎉 {name} 🎉</div>
        {age&&<div style={{fontSize:13,color:"var(--tx2)",marginBottom:16}}>ครบรอบ {age} ปี 🎈</div>}
        {!age&&<div style={{marginBottom:16}}/>}
        <div style={{fontSize:13,color:"var(--tx2)",lineHeight:1.8,marginBottom:20}}>
          ขอให้มีความสุขมากๆ<br/>สุขภาพแข็งแรง และทำงานสนุกนะครับ 🐾
        </div>
        <button onClick={onClose}
          style={{background:"linear-gradient(135deg,#f59e0b,#ef4444)",color:"#fff",
            padding:"10px 28px",borderRadius:50,fontWeight:700,fontSize:14,
            boxShadow:"0 4px 20px rgba(245,158,11,.4)"}}>
          ขอบคุณ 🥰
        </button>
        <div style={{marginTop:10,fontSize:10,color:"var(--tx3)"}}>ปิดอัตโนมัติใน 12 วินาที</div>
      </div>
    </div>
  );
}

// ─── Cat System (walking + login peek) ────────────────────────────────────────
const CAT_CSS = `
@keyframes catWalk    { 0%,100%{transform:translateY(0px)} 25%{transform:translateY(-4px)} 75%{transform:translateY(-2px)} }
@keyframes tailSwing  { 0%{transform:rotate(-35deg)} 50%{transform:rotate(30deg)} 100%{transform:rotate(-35deg)} }
@keyframes tailPeek   { 0%{transform:rotate(-12deg)} 50%{transform:rotate(14deg)} 100%{transform:rotate(-12deg)} }
@keyframes legF1      { 0%,100%{transform:rotate(-22deg)} 50%{transform:rotate(30deg)} }
@keyframes legB1      { 0%,100%{transform:rotate(22deg)}  50%{transform:rotate(-28deg)} }
@keyframes legF2      { 0%,100%{transform:rotate(30deg)}  50%{transform:rotate(-22deg)} }
@keyframes legB2      { 0%,100%{transform:rotate(-28deg)} 50%{transform:rotate(22deg)} }
@keyframes blink      { 0%,88%,100%{transform:scaleY(1)} 93%{transform:scaleY(0.06)} }
@keyframes breathe    { 0%,100%{transform:scaleX(1) scaleY(1)} 50%{transform:scaleX(1.03) scaleY(0.97)} }
@keyframes shadowPulse{ 0%,100%{transform:scaleX(1);opacity:.15} 50%{transform:scaleX(.82);opacity:.09} }
@keyframes earTwitch  { 0%,85%,100%{transform:rotate(0deg)} 90%{transform:rotate(-12deg)} 95%{transform:rotate(8deg)} }
.cat-walk  { animation: catWalk 0.35s ease-in-out infinite; }
.cat-tail  { transform-origin: 0px 0px; animation: tailSwing 1.3s ease-in-out infinite; }
.cat-tailp { transform-origin: 50% 100%; animation: tailPeek 1.8s ease-in-out infinite; }
.cat-lf1   { transform-origin: 50% 0%; animation: legF1 0.35s ease-in-out infinite; }
.cat-lb1   { transform-origin: 50% 0%; animation: legB1 0.35s ease-in-out infinite; }
.cat-lf2   { transform-origin: 50% 0%; animation: legF2 0.35s ease-in-out infinite; }
.cat-lb2   { transform-origin: 50% 0%; animation: legB2 0.35s ease-in-out infinite; }
.cat-eye   { transform-origin: 50% 50%; animation: blink 4.5s ease-in-out infinite; }
.cat-body  { transform-origin: 50% 50%; animation: breathe 2.5s ease-in-out infinite; }
.cat-shadow{ transform-origin: 50% 50%; animation: shadowPulse .35s ease-in-out infinite; }
.cat-ear   { transform-origin: 50% 100%; animation: earTwitch 6s ease-in-out infinite; }
`;

// ── Detailed side-view cat SVG (matches gray/white tabby in photo) ─────────────
function CatBodySVG({ size=100, walking=true }) {
  const s = size / 100;
  return (
    <div style={{width:size, height:size*1.25, position:"relative"}}>
      <style>{CAT_CSS}</style>
      <svg viewBox="0 0 100 125" xmlns="http://www.w3.org/2000/svg"
        width={size} height={size*1.25} style={{overflow:"visible"}}>

        {/* Shadow */}
        <ellipse cx="50" cy="120" rx="24" ry="5.5" fill="rgba(0,0,0,.2)"
          className={walking?"cat-shadow":""} style={{transformOrigin:"50px 120px"}}/>

        {/* ── BACK LEGS ── */}
        <g className={walking?"cat-lb1":""} style={{transformOrigin:"64px 88px"}}>
          {/* Thigh */}
          <ellipse cx="65" cy="87" rx="8" ry="10" fill="#b0a898"/>
          {/* Lower leg */}
          <rect x="60" y="92" width="9" height="20" rx="4.5" fill="#b8b0a0"/>
          {/* Paw — white */}
          <ellipse cx="64" cy="113" rx="8" ry="5" fill="#f0ede6"/>
          <ellipse cx="64" cy="111" rx="6" ry="3.5" fill="#f8f5ee"/>
          <line x1="59" y1="113" x2="59" y2="117" stroke="#d8d4cc" strokeWidth="0.9"/>
          <line x1="62" y1="114" x2="62" y2="118" stroke="#d8d4cc" strokeWidth="0.9"/>
          <line x1="65" y1="115" x2="65" y2="119" stroke="#d8d4cc" strokeWidth="0.9"/>
          <line x1="68" y1="114" x2="68" y2="118" stroke="#d8d4cc" strokeWidth="0.9"/>
        </g>
        <g className={walking?"cat-lb2":""} style={{transformOrigin:"36px 88px"}}>
          <ellipse cx="36" cy="87" rx="8" ry="10" fill="#c8c0b0"/>
          <rect x="31" y="92" width="9" height="20" rx="4.5" fill="#d0c8b8"/>
          <ellipse cx="36" cy="113" rx="8" ry="5" fill="#f8f5ee"/>
          <ellipse cx="36" cy="111" rx="6" ry="3.5" fill="#fffcf5"/>
          <line x1="31" y1="113" x2="31" y2="117" stroke="#e0dcd4" strokeWidth="0.9"/>
          <line x1="34" y1="114" x2="34" y2="118" stroke="#e0dcd4" strokeWidth="0.9"/>
          <line x1="37" y1="115" x2="37" y2="119" stroke="#e0dcd4" strokeWidth="0.9"/>
          <line x1="40" y1="114" x2="40" y2="118" stroke="#e0dcd4" strokeWidth="0.9"/>
        </g>

        {/* ── TAIL — dark ringed, very distinctive on Momo ── */}
        <g className={walking?"cat-tail":""} style={{transformOrigin:"76px 90px"}}>
          {/* Base */}
          <path d="M76 90 Q96 78 92 58 Q89 43 80 38"
            stroke="#908880" strokeWidth="11" strokeLinecap="round" fill="none"/>
          {/* Mid color */}
          <path d="M76 90 Q96 78 92 58 Q89 43 80 38"
            stroke="#a09888" strokeWidth="8" strokeLinecap="round" fill="none"/>
          {/* Ring stripes — dark bands like Momo */}
          <path d="M84 82 Q90 77 88 70" stroke="#706860" strokeWidth="4"
            strokeLinecap="round" fill="none" opacity="0.7"/>
          <path d="M88 68 Q92 63 90 56" stroke="#706860" strokeWidth="4"
            strokeLinecap="round" fill="none" opacity="0.7"/>
          <path d="M89 52 Q90 46 85 41" stroke="#706860" strokeWidth="4"
            strokeLinecap="round" fill="none" opacity="0.7"/>
          {/* Tail tip — darker like Momo */}
          <ellipse cx="79" cy="36" rx="6" ry="7" fill="#605850"
            transform="rotate(-15 79 36)"/>
          <ellipse cx="79" cy="36" rx="4" ry="5" fill="#807060"
            transform="rotate(-15 79 36)"/>
        </g>

        {/* ── BODY — chubby British Shorthair ── */}
        <g className={walking?"cat-body":""} style={{transformOrigin:"50px 82px"}}>
          {/* Back/top — gray-lilac */}
          <ellipse cx="50" cy="80" rx="28" ry="24" fill="#b8b0a0"/>
          <ellipse cx="50" cy="74" rx="24" ry="18" fill="#c8c0b0"/>
          {/* Subtle tabby marks on back */}
          <path d="M28 76 Q32 70 36 76" stroke="#a09888" strokeWidth="2.2" fill="none"
            strokeLinecap="round" opacity="0.55"/>
          <path d="M29 84 Q33 78 37 84" stroke="#a09888" strokeWidth="1.8" fill="none"
            strokeLinecap="round" opacity="0.4"/>
          <path d="M64 76 Q68 70 72 76" stroke="#a09888" strokeWidth="2.2" fill="none"
            strokeLinecap="round" opacity="0.55"/>
          <path d="M63 84 Q67 78 71 84" stroke="#a09888" strokeWidth="1.8" fill="none"
            strokeLinecap="round" opacity="0.4"/>
          {/* White belly — large on Momo */}
          <ellipse cx="50" cy="86" rx="18" ry="16" fill="#f8f5ee"/>
          <ellipse cx="50" cy="89" rx="14" ry="12" fill="#fffcf5"/>
        </g>

        {/* ── FRONT LEGS ── */}
        <g className={walking?"cat-lf1":""} style={{transformOrigin:"38px 92px"}}>
          <ellipse cx="37" cy="91" rx="7" ry="9" fill="#c8c0b0"/>
          <rect x="31" y="96" width="10" height="22" rx="5" fill="#d0c8b8"/>
          <ellipse cx="36" cy="118" rx="9" ry="5" fill="#f8f5ee"/>
          <ellipse cx="36" cy="116" rx="7" ry="3.5" fill="#fffcf5"/>
          <line x1="30" y1="117" x2="30" y2="122" stroke="#e0dcd4" strokeWidth="1"/>
          <line x1="33" y1="118" x2="33" y2="123" stroke="#e0dcd4" strokeWidth="1"/>
          <line x1="36" y1="119" x2="36" y2="124" stroke="#e0dcd4" strokeWidth="1"/>
          <line x1="39" y1="118" x2="39" y2="123" stroke="#e0dcd4" strokeWidth="1"/>
          <line x1="42" y1="117" x2="42" y2="122" stroke="#e0dcd4" strokeWidth="1"/>
        </g>
        <g className={walking?"cat-lf2":""} style={{transformOrigin:"62px 92px"}}>
          <ellipse cx="63" cy="91" rx="7" ry="9" fill="#b8b0a0"/>
          <rect x="59" y="96" width="10" height="22" rx="5" fill="#c0b8a8"/>
          <ellipse cx="64" cy="118" rx="9" ry="5" fill="#f0ede6"/>
          <ellipse cx="64" cy="116" rx="7" ry="3.5" fill="#f8f5ee"/>
          <line x1="58" y1="117" x2="58" y2="122" stroke="#d8d4cc" strokeWidth="1"/>
          <line x1="61" y1="118" x2="61" y2="123" stroke="#d8d4cc" strokeWidth="1"/>
          <line x1="64" y1="119" x2="64" y2="124" stroke="#d8d4cc" strokeWidth="1"/>
          <line x1="67" y1="118" x2="67" y2="123" stroke="#d8d4cc" strokeWidth="1"/>
          <line x1="70" y1="117" x2="70" y2="122" stroke="#d8d4cc" strokeWidth="1"/>
        </g>

        {/* ── NECK ── */}
        <ellipse cx="50" cy="63" rx="15" ry="11" fill="#c0b8a8"/>
        <ellipse cx="50" cy="61" rx="12" ry="8" fill="#ccc4b4"/>
        {/* White chest */}
        <ellipse cx="50" cy="65" rx="9" ry="7" fill="#f8f5ee" opacity="0.7"/>

        {/* ── HEAD — round British Shorthair style ── */}
        {/* Head base */}
        <circle cx="50" cy="38" r="26" fill="#bab2a2"/>
        {/* Top of head lighter */}
        <ellipse cx="50" cy="30" rx="20" ry="15" fill="#cac2b2"/>
        {/* Side shading */}
        <ellipse cx="30" cy="40" rx="8" ry="13" fill="#a8a098" opacity="0.35"/>
        <ellipse cx="70" cy="40" rx="8" ry="13" fill="#a8a098" opacity="0.35"/>

        {/* Head tabby spots/dots — no M stripe */}
        <circle cx="42" cy="24" r="3" fill="#a09888" opacity="0.4"/>
        <circle cx="50" cy="21" r="3.5" fill="#a09888" opacity="0.35"/>
        <circle cx="58" cy="24" r="3" fill="#a09888" opacity="0.4"/>

        {/* ── EARS ── */}
        <g className="cat-ear" style={{transformOrigin:"28px 22px"}}>
          <polygon points="20,36 10,8 36,24" fill="#b0a898"/>
          <polygon points="21,34 14,12 33,24" fill="#f5c0c8"/>
          <path d="M12 10 Q16 5 20 10" stroke="#ccc4b4" strokeWidth="1.5" fill="none"/>
        </g>
        <g className="cat-ear" style={{transformOrigin:"72px 22px",animationDelay:"0.35s"}}>
          <polygon points="80,36 90,8 64,24" fill="#b0a898"/>
          <polygon points="79,34 86,12 67,24" fill="#f5c0c8"/>
          <path d="M80 10 Q84 5 88 10" stroke="#ccc4b4" strokeWidth="1.5" fill="none"/>
        </g>

        {/* ── WHITE FACE MASK — large on Momo ── */}
        {/* Cheeks very puffy */}
        <ellipse cx="26" cy="48" rx="11" ry="10" fill="#f5f2eb" opacity="0.7"/>
        <ellipse cx="74" cy="48" rx="11" ry="10" fill="#f5f2eb" opacity="0.7"/>
        {/* Central white mask */}
        <ellipse cx="50" cy="48" rx="22" ry="20" fill="#f5f2eb" opacity="0.85"/>
        {/* Muzzle bump */}
        <ellipse cx="50" cy="55" rx="12" ry="8" fill="#faf8f2"/>

        {/* ── EYES — blue-gray, more almond, serious look ── */}
        {/* Eye bg */}
        <ellipse cx="37" cy="43" rx="9" ry="8" fill="#e8f2f8"/>
        <ellipse cx="63" cy="43" rx="9" ry="8" fill="#e8f2f8"/>
        {/* Iris — blue-gray like Momo */}
        <ellipse cx="37" cy="43" rx="7.5" ry="7" fill="#7898b0"/>
        <ellipse cx="63" cy="43" rx="7.5" ry="7" fill="#7898b0"/>
        {/* Iris inner lighter */}
        <ellipse cx="37" cy="43" rx="5.5" ry="5.5" fill="#88b0c8"/>
        <ellipse cx="63" cy="43" rx="5.5" ry="5.5" fill="#88b0c8"/>
        {/* Pupil */}
        <g className="cat-eye">
          <ellipse cx="37" cy="43" rx="3" ry="4.5" fill="#0a1420"/>
          <ellipse cx="63" cy="43" rx="3" ry="4.5" fill="#0a1420"/>
        </g>
        {/* Eye shine */}
        <circle cx="34" cy="39" r="2"   fill="white" opacity="0.9"/>
        <circle cx="60" cy="39" r="2"   fill="white" opacity="0.9"/>
        <circle cx="39" cy="45" r="1.1" fill="white" opacity="0.45"/>
        <circle cx="65" cy="45" r="1.1" fill="white" opacity="0.45"/>
        {/* Eye outline */}
        <ellipse cx="37" cy="43" rx="7.5" ry="7" stroke="#2a3a50" strokeWidth="0.8" fill="none"/>
        <ellipse cx="63" cy="43" rx="7.5" ry="7" stroke="#2a3a50" strokeWidth="0.8" fill="none"/>

        {/* ── NOSE + MOUTH ── */}
        <path d="M47 54 Q50 51 53 54 Q50 58 47 54Z" fill="#e8a0b0"/>
        <path d="M50 58 L50 61" stroke="#d8909e" strokeWidth="1.2"/>
        <path d="M50 61 Q45 65 42 63" stroke="#c88090" strokeWidth="1.3" fill="none"
          strokeLinecap="round"/>
        <path d="M50 61 Q55 65 58 63" stroke="#c88090" strokeWidth="1.3" fill="none"
          strokeLinecap="round"/>

        {/* ── WHISKERS ── */}
        <line x1="46" y1="55" x2="6"  y2="49" stroke="#a8a4a0" strokeWidth="1"   opacity="0.6"/>
        <line x1="46" y1="58" x2="4"  y2="58" stroke="#a8a4a0" strokeWidth="1"   opacity="0.6"/>
        <line x1="46" y1="61" x2="7"  y2="65" stroke="#a8a4a0" strokeWidth="1"   opacity="0.6"/>
        <line x1="54" y1="55" x2="94" y2="49" stroke="#a8a4a0" strokeWidth="1"   opacity="0.6"/>
        <line x1="54" y1="58" x2="96" y2="58" stroke="#a8a4a0" strokeWidth="1"   opacity="0.6"/>
        <line x1="54" y1="61" x2="93" y2="65" stroke="#a8a4a0" strokeWidth="1"   opacity="0.6"/>

        {/* ── COLLAR — teal/cyan like Momo ── */}
        <rect x="35" y="65" width="30" height="8" rx="4" fill="#1a7a6a"/>
        <rect x="35" y="65" width="30" height="5" rx="3" fill="#28a08a"/>
        {/* Orange bell — Momo's signature */}
        <circle cx="50" cy="70" r="5"   fill="#d06010"/>
        <circle cx="50" cy="69" r="4"   fill="#e87820"/>
        <circle cx="50" cy="68.5" r="2" fill="#f89830" opacity="0.8"/>
        <line x1="50" y1="73" x2="50" y2="75" stroke="#b05010" strokeWidth="1.2"/>
        {/* Small bead decorations on collar */}
        <circle cx="41" cy="68" r="2" fill="#40b898" opacity="0.8"/>
        <circle cx="59" cy="68" r="2" fill="#40b898" opacity="0.8"/>
        <circle cx="36" cy="68" r="1.5" fill="#50c8a8" opacity="0.6"/>
        <circle cx="64" cy="68" r="1.5" fill="#50c8a8" opacity="0.6"/>

      </svg>
    </div>
  );
}


// ── CatPeek — แมวเกาะขอบ login card ──────────────────────────────────────────
function CatPeek({ side = "right" }) {
  const flip = side === "left";
  return (
    <div style={{
      position:"absolute",
      top: -78,
      [flip?"left":"right"]: flip ? 14 : 14,
      width: 88, height: 95,
      zIndex: 10, pointerEvents:"none", userSelect:"none",
      transform: flip ? "scaleX(-1)" : "none",
    }}>
      <style>{CAT_CSS}</style>
      <svg viewBox="0 0 88 95" xmlns="http://www.w3.org/2000/svg" width="88" height="95" style={{overflow:"visible"}}>
        {/* Paws gripping the edge */}
        <ellipse cx="18" cy="88" rx="13" ry="7" fill="#c8c0b0"/>
        <ellipse cx="18" cy="86" rx="11" ry="6" fill="#d8d0c0"/>
        <ellipse cx="18" cy="89" rx="9" ry="5" fill="#f5f2eb"/>
        <line x1="12" y1="90" x2="12" y2="94" stroke="#d0ccbf" strokeWidth="1"/>
        <line x1="15" y1="91" x2="15" y2="95" stroke="#d0ccbf" strokeWidth="1"/>
        <line x1="18" y1="91" x2="18" y2="95" stroke="#d0ccbf" strokeWidth="1"/>
        <line x1="21" y1="91" x2="21" y2="95" stroke="#d0ccbf" strokeWidth="1"/>
        <line x1="24" y1="90" x2="24" y2="94" stroke="#d0ccbf" strokeWidth="1"/>

        <ellipse cx="70" cy="88" rx="13" ry="7" fill="#b8b0a0"/>
        <ellipse cx="70" cy="86" rx="11" ry="6" fill="#c8c0b0"/>
        <ellipse cx="70" cy="89" rx="9" ry="5" fill="#f0ede6"/>
        <line x1="64" y1="90" x2="64" y2="94" stroke="#c8c4bc" strokeWidth="1"/>
        <line x1="67" y1="91" x2="67" y2="95" stroke="#c8c4bc" strokeWidth="1"/>
        <line x1="70" y1="91" x2="70" y2="95" stroke="#c8c4bc" strokeWidth="1"/>
        <line x1="73" y1="91" x2="73" y2="95" stroke="#c8c4bc" strokeWidth="1"/>
        <line x1="76" y1="90" x2="76" y2="94" stroke="#c8c4bc" strokeWidth="1"/>

        {/* Chest/body peeking up */}
        <ellipse cx="44" cy="76" rx="22" ry="14" fill="#c0b8a8"/>
        <ellipse cx="44" cy="74" rx="18" ry="11" fill="#ccc4b4"/>
        <ellipse cx="44" cy="78" rx="13" ry="10" fill="#f5f2eb" opacity="0.65"/>

        {/* HEAD */}
        <circle cx="44" cy="42" r="25" fill="#bab2a2"/>
        <ellipse cx="44" cy="35" rx="20" ry="15" fill="#cac2b2"/>

        {/* Head spots — no M stripe */}
        <circle cx="38" cy="27" r="2.5" fill="#a09888" opacity="0.38"/>
        <circle cx="44" cy="24" r="3"   fill="#a09888" opacity="0.32"/>
        <circle cx="50" cy="27" r="2.5" fill="#a09888" opacity="0.38"/>

        {/* Side shading */}
        <ellipse cx="26" cy="44" rx="7" ry="11" fill="#a8a098" opacity="0.28"/>
        <ellipse cx="62" cy="44" rx="7" ry="11" fill="#a8a098" opacity="0.28"/>

        {/* EARS */}
        <polygon points="15,32 6,10 30,22" fill="#b0a898"/>
        <polygon points="16,30 9,14 27,22" fill="#f5c0c8"/>
        <polygon points="59,32 72,10 52,22" fill="#b0a898"/>
        <polygon points="60,30 69,14 55,22" fill="#f5c0c8"/>

        {/* White face mask + puffy cheeks */}
        <ellipse cx="22" cy="48" rx="10" ry="9" fill="#f5f2eb" opacity="0.65"/>
        <ellipse cx="66" cy="48" rx="10" ry="9" fill="#f5f2eb" opacity="0.65"/>
        <ellipse cx="44" cy="48" rx="20" ry="18" fill="#f5f2eb" opacity="0.82"/>
        <ellipse cx="44" cy="54" rx="11" ry="8" fill="#faf8f2"/>

        {/* EYES — blue-gray, almond */}
        <ellipse cx="33" cy="43" rx="8.5" ry="8" fill="#e4f0f8"/>
        <ellipse cx="55" cy="43" rx="8.5" ry="8" fill="#e4f0f8"/>
        <ellipse cx="33" cy="43" rx="7" ry="6.5" fill="#7898b0"/>
        <ellipse cx="55" cy="43" rx="7" ry="6.5" fill="#7898b0"/>
        <ellipse cx="33" cy="43" rx="5" ry="5.5" fill="#88b0c8"/>
        <ellipse cx="55" cy="43" rx="5" ry="5.5" fill="#88b0c8"/>
        <ellipse cx="33" cy="43" rx="2.8" ry="4.2" fill="#0a1420"/>
        <ellipse cx="55" cy="43" rx="2.8" ry="4.2" fill="#0a1420"/>
        <circle cx="30" cy="39" r="1.9" fill="white" opacity="0.9"/>
        <circle cx="52" cy="39" r="1.9" fill="white" opacity="0.9"/>
        <ellipse cx="33" cy="43" rx="7" ry="6.5" stroke="#2a3a50" strokeWidth="0.8" fill="none"/>
        <ellipse cx="55" cy="43" rx="7" ry="6.5" stroke="#2a3a50" strokeWidth="0.8" fill="none"/>

        {/* NOSE + MOUTH */}
        <path d="M41 53 Q44 50 47 53 Q44 57 41 53Z" fill="#e8a0b0"/>
        <path d="M44 57 L44 60" stroke="#d8909e" strokeWidth="1.2"/>
        <path d="M44 60 Q40 63 37 61" stroke="#c88090" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <path d="M44 60 Q48 63 51 61" stroke="#c88090" strokeWidth="1.2" fill="none" strokeLinecap="round"/>

        {/* WHISKERS */}
        <line x1="40" y1="53" x2="8"  y2="48" stroke="#a8a4a0" strokeWidth="0.9" opacity="0.6"/>
        <line x1="40" y1="56" x2="6"  y2="56" stroke="#a8a4a0" strokeWidth="0.9" opacity="0.6"/>
        <line x1="40" y1="59" x2="8"  y2="63" stroke="#a8a4a0" strokeWidth="0.9" opacity="0.6"/>
        <line x1="48" y1="53" x2="80" y2="48" stroke="#a8a4a0" strokeWidth="0.9" opacity="0.6"/>
        <line x1="48" y1="56" x2="82" y2="56" stroke="#a8a4a0" strokeWidth="0.9" opacity="0.6"/>
        <line x1="48" y1="59" x2="80" y2="63" stroke="#a8a4a0" strokeWidth="0.9" opacity="0.6"/>

        {/* COLLAR — teal + orange bell */}
        <rect x="29" y="65" width="30" height="7" rx="3.5" fill="#1a7a6a"/>
        <rect x="29" y="65" width="30" height="4.5" rx="3" fill="#28a08a"/>
        <circle cx="44" cy="69" r="4.5" fill="#d06010"/>
        <circle cx="44" cy="68" r="3.5" fill="#e87820"/>
        <circle cx="44" cy="67.5" r="1.8" fill="#f89830" opacity="0.8"/>
        <circle cx="35" cy="67" r="1.8" fill="#40b898" opacity="0.7"/>
        <circle cx="53" cy="67" r="1.8" fill="#40b898" opacity="0.7"/>
      </svg>
    </div>
  );
}

// ── Draggable BG walking cat ───────────────────────────────────────────────────
function CatWalker() {
  const [pos,  setPos]  = useState({x:150, y:Math.max(100, window.innerHeight*0.6)});
  const [dir,  setDir]  = useState(1);
  const [drag, setDrag] = useState(false);
  const [size, setSize] = useState(110);
  const posRef  = useRef({x:150, y:window.innerHeight*0.6});
  const dirRef  = useRef(1);
  const dragRef = useRef(null);
  const rafRef  = useRef(null);
  const frameRef= useRef(0);

  useEffect(()=>{
    const step=()=>{
      frameRef.current++;
      if(!dragRef.current){
        const spd=1.4;
        let {x,y}=posRef.current;
        x += dirRef.current * spd;
        const W=window.innerWidth;
        if(x>W-size-20){dirRef.current=-1;setDir(-1);x=W-size-20;}
        if(x<20){dirRef.current=1;setDir(1);x=20;}
        posRef.current={x,y};
        setPos({x,y});
      }
      rafRef.current=requestAnimationFrame(step);
    };
    rafRef.current=requestAnimationFrame(step);
    return()=>{if(rafRef.current)cancelAnimationFrame(rafRef.current);};
  },[]);

  const startDrag=(cx,cy)=>{
    dragRef.current={ox:cx-posRef.current.x,oy:cy-posRef.current.y};
    setDrag(true);
  };
  const moveDrag=(cx,cy,mvx)=>{
    if(!dragRef.current)return;
    const nx=cx-dragRef.current.ox, ny=cy-dragRef.current.oy;
    posRef.current={x:nx,y:ny};
    setPos({x:nx,y:ny});
    if(mvx>0){dirRef.current=1;setDir(1);}
    else if(mvx<0){dirRef.current=-1;setDir(-1);}
  };
  const endDrag=()=>{dragRef.current=null;setDrag(false);};

  const onMouseDown=e=>{
    e.preventDefault();
    startDrag(e.clientX,e.clientY);
    const mm=ev=>{moveDrag(ev.clientX,ev.clientY,ev.movementX);};
    const mu=()=>{endDrag();window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);};
    window.addEventListener("mousemove",mm);window.addEventListener("mouseup",mu);
  };
  const onTouchStart=e=>{
    const t=e.touches[0];startDrag(t.clientX,t.clientY);
    let lastX=t.clientX;
    const tm=ev=>{const t2=ev.touches[0];moveDrag(t2.clientX,t2.clientY,t2.clientX-lastX);lastX=t2.clientX;};
    const te=()=>{endDrag();window.removeEventListener("touchmove",tm);window.removeEventListener("touchend",te);};
    window.addEventListener("touchmove",tm,{passive:true});window.addEventListener("touchend",te);
  };

  return(
    <div onMouseDown={onMouseDown} onTouchStart={onTouchStart} style={{
      position:"fixed", left:pos.x, top:pos.y, zIndex:5,
      cursor:drag?"grabbing":"grab",
      transform:`scaleX(${dir>0?1:-1})`,
      filter:"drop-shadow(0 8px 24px rgba(0,0,0,.22))",
      userSelect:"none", touchAction:"none",
    }}>
      <style>{CAT_CSS}</style>
      <div className={drag?"":"cat-walk"}>
        <CatBodySVG size={size} walking={!drag}/>
      </div>
      <div style={{display:"flex",gap:5,justifyContent:"center",marginTop:2}}>
        <button onClick={e=>{e.stopPropagation();setSize(s=>Math.max(60,s-20));}} style={{width:20,height:20,borderRadius:"50%",background:"rgba(0,0,0,.3)",color:"#fff",border:"none",fontSize:12,cursor:"pointer",lineHeight:"20px",textAlign:"center",backdropFilter:"blur(4px)"}}>−</button>
        <button onClick={e=>{e.stopPropagation();setSize(s=>Math.min(200,s+20));}} style={{width:20,height:20,borderRadius:"50%",background:"rgba(0,0,0,.3)",color:"#fff",border:"none",fontSize:12,cursor:"pointer",lineHeight:"20px",textAlign:"center",backdropFilter:"blur(4px)"}}>+</button>
      </div>
    </div>
  );
}


// ─── Birthday Popup ─────────────────────────────────────────────────────────────

function Login({employees,err,clinic,onLogin,onRetry,onBoard}){
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
  const[busy,setBusy]   = useState(false);
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

  // ✅ ตรวจ PIN ที่ฝั่ง backend แทนการเทียบจาก employees array ในเครื่อง (กัน PIN หลุด)
  const go=async()=>{
    const uid=id.trim().toUpperCase();
    if(!uid||!pin){ setError("กรอกรหัสพนักงานและ PIN ให้ครบ"); return; }
    setBusy(true); setError("");
    const r = await call("login",{id:uid,pin});
    setBusy(false);
    if(r.success && r.user){
      lsSet(SK_ID,uid);
      if(remember){ lsSet(SK_PIN,pin); lsSet(SK_REM,"1"); }
      else { lsDel(SK_PIN); lsSet(SK_REM,"0"); }
      onLogin(r.user);
    } else {
      setError(r.message||"รหัสพนักงานหรือ PIN ไม่ถูกต้อง");
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

        <div className="card" style={{padding:"26px 26px 22px",position:"relative",overflow:"visible",marginTop:24}}>
          <CatPeek/>
          <CatPeek side="right"/>
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

          <button onClick={go} disabled={busy} style={{width:"100%",padding:13,background:"linear-gradient(135deg,var(--acc),var(--acc2))",color:"#fff",fontWeight:700,fontSize:15,borderRadius:12,boxShadow:"0 4px 20px var(--accBg)",letterSpacing:.5}}>
            {busy?"กำลังตรวจสอบ...":"เข้าสู่ระบบ →"}
          </button>
          <button onClick={onBoard} style={{width:"100%",padding:11,background:"transparent",color:"var(--tx2)",border:"1px solid var(--br)",borderRadius:12,fontSize:13,marginTop:8}}>
            👥 ดูสถานะทีมงาน (ไม่ต้อง login)
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
  const[gpsAt,setGpsAt]=useState(null);  // timestamp ที่ตรวจสอบพิกัด
  const GPS_TTL = 3 * 60 * 1000;        // หมดอายุใน 3 นาที
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
  const[retryBanner,setRetryBanner]=useState(null); // null | { count, success }
  useEffect(()=>{
    const t=setInterval(()=>{
      setNow(new Date());
      // ── GPS expiry check ──
      setGpsAt(prev=>{
        if(prev && Date.now()-prev > GPS_TTL){
          setGps("idle");
          setGMsg("⏱ พิกัดหมดอายุ — กรุณาตรวจสอบใหม่");
          return null;
        }
        return prev;
      });
    },1000);
    return()=>clearInterval(t);
  },[]);

  const me = empList.find(e=>e.id===user.id)||user;
  useEffect(()=>{ setPf({email:me.email||"",phone:me.phone||"",note:me.note||"",avatar:me.avatar||"🐾"}); },[me.id]);

  // Sync from server — use ref to track initialization, avoids overwriting optimistic updates
  const syncedFromServer = useRef(false);
  useEffect(()=>{
    syncedFromServer.current = false;
  },[user.id]);

  // ── Auto-retry pending queue ตอนเปิดแอป/กลับมาจาก background ──────────────
  useEffect(()=>{
    const q = pqLoad().filter(i => i.params.empId === user.id);
    if(!q.length) return;
    // มี queue รอ retry → แจ้งเตือน แล้ว flush
    setRetryBanner({ count:q.length, success:null });
    pqFlush((item)=>{
      // sync local state ถ้า retry สำเร็จ
      if(item.action==="checkIn")    setLocalCI(item.params.time);
      if(item.action==="checkOut")   setLocalCO(item.params.time);
      if(item.action==="breakStart") setLocalBS(item.params.time);
      if(item.action==="breakEnd")   setLocalBE(item.params.time);
    }).then(n=>{
      setRetryBanner({ count:q.length, success:n });
      setTimeout(()=>{ setRetryBanner(null); onReloadRec(); }, 4000);
    });
  },[user.id]);

  // ── Visibility change — retry เมื่อกลับมาจาก background ──────────────────
  useEffect(()=>{
    const onVisible = () => {
      if(document.visibilityState !== "visible") return;
      const q = pqLoad().filter(i => i.params.empId === user.id);
      if(!q.length) return;
      pqFlush((item)=>{
        if(item.action==="checkIn")    setLocalCI(item.params.time);
        if(item.action==="checkOut")   setLocalCO(item.params.time);
        if(item.action==="breakStart") setLocalBS(item.params.time);
        if(item.action==="breakEnd")   setLocalBE(item.params.time);
      }).then(n=>{ if(n>0){ showToast(true,`🔄 sync ${n} รายการสำเร็จ`); onReloadRec(); } });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
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
        if(!location?.lat||!location?.lng){ setGps("ok"); setGpsAt(Date.now()); setGd({lat,lng,acc,dist:0}); setGMsg("✓ รับพิกัดสำเร็จ"); return; }
        const dist=haversine(lat,lng,+location.lat,+location.lng);
        setGd({lat,lng,acc,dist});
        dist<=(+location.radius||200)?(setGps("ok"),setGpsAt(Date.now()),setGMsg(`✓ อยู่ในพื้นที่ — ห่าง ${Math.round(dist)} ม.`)):(setGps("far"),setGMsg(`✗ นอกพื้นที่ — ห่าง ${Math.round(dist)} ม.`));
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
    const params = {date:today(),empId:user.id,time,lat:gd.lat,lng:gd.lng};
    setLocalCI(time); // Optimistic update ทันที
    pqAdd({action:"checkIn", params}); // 💾 เก็บไว้ก่อน — กันหาย ถ้าแอปถูก kill
    const r = await call("checkIn", params);
    if(r.success){
      pqRemove("checkIn", user.id); // ✅ ถึง server แล้ว ลบออกจาก queue
      playSound("checkin"); showToast(true, "เช็คอินสำเร็จ ✓ "+ft(time));
      if(r.alreadyCheckedIn && r.checkIn) setLocalCI(r.checkIn);
      setTimeout(()=>onReloadRec(), 4000);
    } else {
      // ไม่ลบออกจาก queue — จะ retry ตอนเปิดแอปครั้งถัดไป
      showToast(false, (r.message||"เช็คอินไม่สำเร็จ") + " (จะลองใหม่อัตโนมัติ)");
      // ไม่ rollback localCI เพราะอาจเป็นแค่เน็ตช้าชั่วคราว
    }
    setBusy(false);
  };

  const doOut = async () => {
    if(gps!=="ok"||busy||localCO||effectiveRec.checkOut) return;
    if(!effectiveRec.checkIn){ showToast(false,"กรุณาเช็คอินก่อน"); return; }
    const _ct = new Date().toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Bangkok"});
    const _msg = "ยืนยันเช็คเอาท์ออกงาน?" + "\n\n" + "⏰ เวลาปัจจุบัน: " + _ct + (onBreak ? "\n\n⚠️ กำลังพักอยู่! กด กลับมาแล้ว ก่อนดีกว่า" : "");
    const confirmed = window.confirm(_msg);
    if(!confirmed) return;
    setBusy(true);
    const time = nowISO();
    const params = {date:today(),empId:user.id,time,lat:gd.lat,lng:gd.lng};
    setLocalCO(time);
    pqAdd({action:"checkOut", params}); // 💾 เก็บไว้ก่อน
    const r = await call("checkOut", params);
    if(r.success){
      pqRemove("checkOut", user.id);
      playSound("checkout"); showToast(true, "เช็คเอาท์สำเร็จ ✓ "+ft(time));
      if(r.alreadyCheckedOut && r.checkOut) setLocalCO(r.checkOut);
      setTimeout(()=>onReloadRec(), 4000);
    } else {
      showToast(false, (r.message||"เช็คเอาท์ไม่สำเร็จ") + " (จะลองใหม่อัตโนมัติ)");
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
    const params = {date:today(),empId:user.id,time,lat:gd.lat,lng:gd.lng};
    setLocalBS(time);
    pqAdd({action:"breakStart", params}); // 💾
    const r = await call("breakStart", params);
    if(r.success){
      pqRemove("breakStart", user.id);
      if(r.alreadyStarted && r.breakStart) setLocalBS(r.breakStart);
      playSound("breakstart"); showToast(true,"เริ่มพักแล้ว ☕ "+ft(time));
      setTimeout(()=>onReloadRec(),4000);
    } else { showToast(false,(r.message||"ผิดพลาด")+" (จะลองใหม่อัตโนมัติ)"); }
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
    const params = {date:today(),empId:user.id,time,lat:gd.lat,lng:gd.lng};
    setLocalBE(time);
    pqAdd({action:"breakEnd", params}); // 💾
    const r = await call("breakEnd", params);
    if(r.success){
      pqRemove("breakEnd", user.id);
      if(r.alreadyEnded && r.breakEnd) setLocalBE(r.breakEnd);
      playSound("breakend"); showToast(true,"กลับมาแล้ว ✓ "+ft(time));
      setTimeout(()=>onReloadRec(),4000);
    } else { showToast(false,(r.message||"ผิดพลาด")+" (จะลองใหม่อัตโนมัติ)"); }
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
          <div style={{width:40,height:40,background:"var(--accBg)",border:"1.5px solid var(--acc)",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0}}><AvatarImg src={me.avatar} size={40}/></div>
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
          {/* 🔄 Retry banner — แสดงเมื่อมี pending action ที่ยังไม่ถึง server */}
          {retryBanner && (
            <div style={{
              padding:"11px 16px",marginBottom:10,borderRadius:12,display:"flex",alignItems:"center",gap:10,
              background: retryBanner.success===null ? "var(--yellowBg)" : retryBanner.success>0 ? "var(--accBg)" : "var(--redBg)",
              border: `1px solid ${retryBanner.success===null ? "var(--yellow)" : retryBanner.success>0 ? "var(--acc)" : "var(--red)"}`,
              animation:"fd .3s ease"
            }}>
              <span style={{fontSize:20,animation:retryBanner.success===null?"spin .8s linear infinite":""}}>{retryBanner.success===null?"🔄":retryBanner.success>0?"✅":"⚠"}</span>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:retryBanner.success===null?"var(--yellow)":retryBanner.success>0?"var(--acc)":"var(--red)"}}>
                  {retryBanner.success===null ? `กำลัง sync ${retryBanner.count} รายการที่ค้างอยู่...` : retryBanner.success>0 ? `✓ sync ${retryBanner.success} รายการสำเร็จแล้ว` : "sync ไม่สำเร็จ — จะลองอีกครั้งเมื่อเปิดแอป"}
                </div>
                <div style={{fontSize:11,color:"var(--tx2)"}}>
                  {retryBanner.success===null ? "พบข้อมูลที่ยังไม่ถึง server จากครั้งที่แล้ว" : retryBanner.success>0 ? "ข้อมูลเช็คอิน/เช็คเอาท์ถูกบันทึกเรียบร้อยแล้ว" : "กรุณาตรวจสอบสัญญาณอินเทอร์เน็ต"}
                </div>
              </div>
            </div>
          )}
          {/* Who's on break — visible to everyone */}
          {(()=>{
            const breakingNow = empList.filter(e=>{
              if(e.id===user.id) return false; // ตัวเองแสดงใน badge หน้านาฬิกาแล้ว
              const r = records[today()]?.[e.id];
              return r?.breakStart && !r?.breakEnd && !r?.checkOut;
            });
            if(breakingNow.length===0) return null;
            return(
              <div className="card2" style={{padding:"11px 14px",marginBottom:10,borderColor:"var(--yellow)50",background:"var(--yellowBg)"}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--yellow)",marginBottom:8,letterSpacing:.5}}>☕ กำลังพักอยู่ตอนนี้</div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {breakingNow.map(e=>{
                    const r = records[today()]?.[e.id];
                    const liveMins = dm(r?.breakStart, new Date().toISOString());
                    const s3 = getScheduleForDate(today(),e,gSch);
                    const limit = s3?.breakLimitMins??60;
                    const over = liveMins!=null && liveMins>limit;
                    return(
                      <div key={e.id} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px",background:over?"var(--redBg)":"rgba(255,255,255,.35)",borderRadius:20,border:`1px solid ${over?"var(--red)40":"var(--yellow)40"}`}}>
                        <span style={{fontSize:16}}>{e.avatar||"🐾"}</span>
                        <div>
                          <div style={{fontSize:12,fontWeight:600,color:over?"var(--red)":"var(--yellow)",lineHeight:1.2}}>{e.name}</div>
                          <div style={{fontSize:10,color:"var(--tx2)"}}>{liveMins!=null?hm(liveMins):"..."}{over?" ⚠ เกิน":""}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {/* GPS Panel */}
          <div className="card2" style={{padding:"14px 16px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:gMsg?10:0}}>
              <span style={{fontSize:13,fontWeight:600,color:"var(--tx)"}}>📡 ตรวจสอบพิกัด{location?.name?` · ${location.name}`:""}</span>
              <span style={{fontSize:11,color:gCol,fontWeight:600}}>{{idle:"รอ",checking:"กำลังรับ...",ok:"✓ พร้อม",err:"✗ Error",far:"✗ นอกพื้นที่"}[gps]}</span>
            </div>
            {gMsg&&<div style={{fontSize:12,color:gCol,background:gps==="ok"?"var(--accBg)":"var(--redBg)",border:`1px solid ${gCol}`,borderRadius:8,padding:"8px 12px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>{gMsg}</span>
                {gps==="ok"&&gpsAt&&(()=>{
                  const remaining = Math.max(0, Math.ceil((GPS_TTL-(Date.now()-gpsAt))/1000));
                  const mins = Math.floor(remaining/60);
                  const secs = remaining%60;
                  return <span style={{fontSize:10,opacity:.7,fontFamily:"monospace"}}>⏱ {mins}:{String(secs).padStart(2,"0")}</span>;
                })()}
              </div>}
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

          {/* 👥 ใครพักอยู่บ้าง — แสดงให้ทุกคนเห็น */}
          {(()=>{
            const todayRecs2 = records[today()]||{};
            const onBreakNow = empList.filter(e=>{
              const r2 = todayRecs2[e.id];
              return r2?.breakStart && !r2?.breakEnd && !r2?.checkOut;
            });
            if(onBreakNow.length===0) return null;
            return(
              <div className="card2" style={{padding:"11px 14px",marginTop:10,borderColor:"var(--yellow)50",background:"var(--yellowBg)"}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--yellow)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                  <span style={{animation:"pulse 2s infinite"}}>☕</span> กำลังพักอยู่ {onBreakNow.length} คน
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {onBreakNow.map(e=>{
                    const r2=todayRecs2[e.id];
                    const mins=dm(r2?.breakStart, new Date().toISOString());
                    const limit=getTodaySchedule(e,gSch)?.breakLimitMins??60;
                    const over=mins!=null&&mins>limit;
                    return(
                      <div key={e.id} className="card" style={{padding:"7px 12px",display:"flex",alignItems:"center",gap:8,borderColor:over?"var(--red)40":"var(--yellow)40"}}>
                        <span style={{fontSize:20}}>{e.avatar||"🐾"}</span>
                        <div>
                          <div style={{fontSize:12,fontWeight:600,color:over?"var(--red)":"var(--tx)"}}>{e.name}</div>
                          <div className="mono" style={{fontSize:11,color:over?"var(--red)":"var(--yellow)"}}>
                            {mins!=null?hm(mins):"..."}{over?" ⚠ เกิน "+(mins-limit)+"น.":""}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
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


// ─── ShiftManager Component ───────────────────────────────────────────────────
function ShiftManager({ employees, gSch, shifts, onReload, showToast }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [swapPending, setSwapPending] = useState(null); // { empId, date, eff, newType, st, et }

  const getWeekDates = (offset=0) => {
    const now = new Date();
    const bkk = new Date(now.toLocaleString("en-US",{timeZone:"Asia/Bangkok"}));
    const dow = bkk.getDay();
    const mon = new Date(bkk); mon.setDate(bkk.getDate() - (dow===0?6:dow-1) + offset*7);
    return Array.from({length:7},(_,i)=>{ const d=new Date(mon); d.setDate(mon.getDate()+i); return d.toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}); });
  };

  const dates = getWeekDates(weekOffset);
  const weekLabel = () => {
    if(weekOffset===0) return "สัปดาห์นี้";
    if(weekOffset===1) return "สัปดาห์หน้า";
    if(weekOffset===-1) return "สัปดาห์ที่แล้ว";
    return `${fd(dates[0])} — ${fd(dates[6])}`;
  };

  const getShift   = (empId,date) => shifts.find(s=>s.empId===empId&&s.date===date)||null;
  const getDefType = (empId,date) => { const emp=employees.find(e=>e.id===empId); const s=getScheduleForDate(date,emp,gSch); return s?"work":"off"; };

  const saveShift = async (empId,date,type,startTime="",endTime="",note="") => {
    setBusy(true);
    const r = await call("saveShift",{empId,date,type,startTime,endTime,note});
    if(r.success){ await onReload(); showToast(true,type==="default"?"รีเซ็ตแล้ว":type==="off"?"🗓 บันทึกวันหยุดแล้ว":"✅ บันทึกวันทำงานแล้ว"); }
    else showToast(false,r.message);
    setBusy(false);
  };

  const saveSwapPair = async (a, b) => {
    setBusy(true);
    const empA = employees.find(e=>e.id===a.empId);
    const empB = employees.find(e=>e.id===b.empId);
    const r1 = await call("saveShift",{empId:a.empId,date:a.date,type:a.newType,startTime:a.st,endTime:a.et,note:b.empId});
    const r2 = await call("saveShift",{empId:b.empId,date:b.date,type:b.newType,startTime:b.st,endTime:b.et,note:a.empId});
    if(r1.success && r2.success){
      await onReload();
      showToast(true,`✅ สลับสำเร็จ! ${empA?.name||a.empId} ↔ ${empB?.name||b.empId}`);
    } else {
      showToast(false,"บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
    setBusy(false);
  };

  const handleCellClick = (emp, date) => {
    if(busy) return;
    const shift   = getShift(emp.id, date);
    const def     = getDefType(emp.id, date);
    const eff     = shift?.type || def;
    const empObj  = employees.find(e=>e.id===emp.id);
    const s2      = getScheduleForDate(date, empObj, gSch);
    const st      = shift?.startTime || s2?.startTime || gSch?.startTime || "08:00";
    const et      = shift?.endTime   || s2?.endTime   || gSch?.endTime   || "20:00";
    const newType = eff==="work" ? "off" : "work";

    if(!swapPending) {
      setSwapPending({ empId:emp.id, date, eff, newType, st, et });
      const empName = employees.find(e=>e.id===emp.id)?.name || emp.id;
      showToast(true, `⏳ เลือก ${empName} วัน ${fd(date)} แล้ว — กดวันของคนที่จะสลับด้วย`);
    } else {
      if(swapPending.empId === emp.id && swapPending.date === date) {
        setSwapPending(null);
        showToast(false,"ยกเลิกการเลือก");
        return;
      }
      const a = swapPending;
      const b = { empId:emp.id, date, eff, newType, st, et };
      setSwapPending(null);
      saveSwapPair(a, b);
    }
  };

  const exportShiftsCSV = () => {
    const rows = [["สัปดาห์","วันที่","วัน","รหัสพนักงาน","ชื่อ","ประเภท","เวลาเข้า","เวลาออก","สลับกับ(รหัส)","สลับกับ(ชื่อ)"]];
    const DAY_TH_FULL = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
    shifts.filter(s=>s.type!=="default").forEach(s=>{
      const emp     = employees.find(e=>e.id===s.empId);
      const swapEmp = s.note ? employees.find(e=>e.id===s.note) : null;
      const d       = new Date(s.date+"T12:00:00");
      rows.push([
        s.week||"", s.date, DAY_TH_FULL[d.getDay()],
        s.empId, emp?.name||"",
        s.type==="off"?"สลับหยุด":"สลับมาทำงาน",
        s.startTime||"", s.endTime||"",
        s.note||"",
        swapEmp?.name||""
      ]);
    });
    const dl = v => String(v).includes(",") ? `"${v}"` : v;
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(r=>r.map(dl).join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));
    a.download=`shifts_export.csv`; a.click();
  };

  const DAY_TH=["จ","อ","พ","พฤ","ศ","ส","อา"];
  const MO=["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  const sd = d=>{ const x=new Date(d+"T12:00:00"); return `${x.getDate()} ${MO[x.getMonth()]}`; };
  const pendingEmpName = swapPending ? (employees.find(e=>e.id===swapPending.empId)?.name||swapPending.empId) : "";

  return(
    <div className="fade">
      <div className="card2" style={{padding:"11px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={()=>setWeekOffset(w=>w-1)} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"7px 14px",borderRadius:10}}>← ก่อนหน้า</button>
        <div style={{textAlign:"center"}}>
          <div style={{fontWeight:700,color:"var(--acc)",fontSize:14}}>{weekLabel()}</div>
          <div style={{fontSize:11,color:"var(--tx2)"}}>{fd(dates[0])} – {fd(dates[6])}</div>
        </div>
        <button onClick={()=>setWeekOffset(w=>w+1)} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"7px 14px",borderRadius:10}}>ถัดไป →</button>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        {[["🟢","ทำงาน","var(--accBg)","var(--acc)"],["⬜","หยุด","var(--card2)","var(--tx3)"],["🔄","สลับมาทำ","var(--yellowBg)","var(--yellow)"],["🔴","สลับหยุด","var(--redBg)","var(--red)"]].map(([ic,lb,bg,col])=>(
          <span key={lb} className="pill" style={{background:bg,color:col,border:`1px solid ${col}30`,fontSize:11}}>{ic} {lb}</span>
        ))}
      </div>

      {swapPending && (
        <div style={{background:"var(--yellowBg)",border:"2px solid var(--yellow)",borderRadius:12,padding:"12px 16px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,animation:"fd .2s ease"}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"var(--yellow)"}}>⏳ รอเลือกวันของอีกฝั่ง</div>
            <div style={{fontSize:12,color:"var(--tx2)",marginTop:2}}>
              เลือก <b style={{color:"var(--tx)"}}>{pendingEmpName}</b> วัน <b style={{color:"var(--tx)"}}>{fd(swapPending.date)}</b> แล้ว — กดวันของคนที่จะสลับด้วยได้เลย
            </div>
          </div>
          <button onClick={()=>setSwapPending(null)} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"6px 12px",fontSize:12,borderRadius:9,flexShrink:0}}>✕ ยกเลิก</button>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
        <button onClick={exportShiftsCSV} style={{background:"var(--accBg)",color:"var(--acc)",border:"1px solid var(--acc)50",padding:"7px 16px",fontSize:12,fontWeight:700,borderRadius:9}}>⬇ Export CSV</button>
      </div>

      <div style={{overflowX:"auto"}} className="card">
        <table style={{minWidth:520}}>
          <thead>
            <tr>
              <th style={{minWidth:110}}>พนักงาน</th>
              {dates.map((d,i)=>(
                <th key={d} style={{textAlign:"center",minWidth:64,background:d===today()?"var(--accBg)":undefined,color:d===today()?"var(--acc)":undefined,padding:"8px 4px"}}>
                  <div style={{fontSize:13}}>{DAY_TH[i]}</div>
                  <div style={{fontWeight:400,fontSize:10}}>{sd(d)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map(emp=>(
              <tr key={emp.id}>
                <td style={{padding:"8px 12px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:16}}>{emp.avatar||"🐾"}</span>
                    <div>
                      <div style={{fontWeight:600,fontSize:12,color:"var(--tx)",lineHeight:1.3}}>{emp.name}</div>
                      <div style={{fontSize:9,color:"var(--tx3)"}}>{emp.id}</div>
                    </div>
                  </div>
                </td>
                {dates.map(date=>{
                  const shift    = getShift(emp.id,date);
                  const def      = getDefType(emp.id,date);
                  const eff      = shift?.type||def;
                  const isOv     = !!shift;
                  const isPending= swapPending?.empId===emp.id && swapPending?.date===date;
                  const isTarget = !!swapPending && !isPending;
                  let bg,col,icon;
                  if(isPending)                            {bg="var(--yellowBg)";col="var(--yellow)";icon="⏳";}
                  else if(eff==="work"&&isOv&&def==="off") {bg="var(--yellowBg)";col="var(--yellow)";icon="🔄";}
                  else if(eff==="work")                    {bg="var(--accBg)";   col="var(--acc)";   icon="🟢";}
                  else if(eff==="off"&&isOv&&def==="work") {bg="var(--redBg)";   col="var(--red)";   icon="🔴";}
                  else                                     {bg="var(--card2)";   col="var(--tx3)";   icon="⬜";}
                  return(
                    <td key={date} style={{textAlign:"center",padding:"6px 4px"}}>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                        <button
                          disabled={busy}
                          onClick={()=>handleCellClick(emp,date)}
                          style={{
                            width:40,height:34,background:bg,color:col,
                            border:`1.5px solid ${isPending?"var(--yellow)":isTarget?"var(--acc)":""+col+"40"}`,
                            borderRadius:9,fontSize:14,cursor:"pointer",
                            position:"relative",transition:"all .15s",
                            boxShadow:isPending?"0 0 0 2px var(--yellow)":isTarget?"0 0 0 2px var(--acc)30":"none",
                          }}>
                          {icon}
                          {isOv&&!isPending&&<span style={{position:"absolute",top:-3,right:-3,width:7,height:7,background:"var(--yellow)",borderRadius:"50%",border:"1px solid var(--bg)"}}/>}
                        </button>
                        {isOv&&(
                          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                            <button onClick={e=>{e.stopPropagation();saveShift(emp.id,date,"default");}} disabled={busy} style={{background:"none",color:"var(--tx3)",border:"none",fontSize:9,cursor:"pointer",lineHeight:1}}>รีเซ็ต</button>
                            {shift?.note&&(
                              <span style={{fontSize:8,color:"var(--yellow)",maxWidth:44,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                                title={`สลับกับ: ${employees.find(e=>e.id===shift.note)?.name||shift.note}`}>
                                ↔{employees.find(e=>e.id===shift.note)?.name||shift.note}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card2" style={{padding:"11px 16px",marginTop:12,fontSize:12,color:"var(--tx2)",lineHeight:2}}>
        <b style={{color:"var(--tx)"}}>วิธีสลับวันหยุด</b><br/>
        1. กดวันของ <b>คนแรก</b> → แถบเหลืองจะขึ้นว่า "รอเลือกอีกฝั่ง"<br/>
        2. กดวันของ <b>คนที่สอง</b> → บันทึกทั้งคู่พร้อมชื่อคู่สลับทันที ✅<br/>
        3. กด <b>⬇ Export CSV</b> — คอลัมน์ "สลับกับ(ชื่อ)" จะมีชื่อครบ<br/>
        <span style={{color:"var(--tx3)"}}>กดซ้ำเซลล์เดิม = ยกเลิก · จุดเหลือง = override · ↔ = คู่สลับ · "รีเซ็ต" = กลับค่าเดิม</span>
      </div>
    </div>
  );
}


// ─── Dashboard Component ──────────────────────────────────────────────────────
function Dashboard({ employees, records, gSch }) {
  const [month, setMonth] = useState(today().slice(0,7));
  const staff = employees.filter(e=>e.role!=="admin");
  const MONTHS_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

  // ─── Compute per-employee stats for selected month ─────────────────────────
  const stats = staff.map(emp => {
    const moRecs = Object.entries(records)
      .filter(([d]) => d.startsWith(month))
      .map(([d, day]) => day[emp.id] ? {date:d, ...day[emp.id]} : null)
      .filter(Boolean);

    const worked   = moRecs.filter(r => r.checkIn && !r.leaveType).length;
    const late     = moRecs.filter(r => {
      if (!r.checkIn) return false;
      const s = getScheduleForDate(r.date, emp, gSch);
      return s && STATUS(r, s).l.startsWith("มาสาย");
    }).length;
    const ot = moRecs.reduce((x,r) => {
      const s = getScheduleForDate(r.date, emp, gSch);
      const res = calcOT(r.checkIn, r.checkOut, r.breakStart, r.breakEnd, s);
      return x + (res?.ot || 0);
    }, 0);
    const leaveUsed = moRecs.filter(r => r.leaveType).length;
    const totalMins = moRecs.reduce((x,r) => x + (dm(r.checkIn,r.checkOut)||0), 0);

    return { emp, worked, late, ot, leaveUsed, totalMins };
  });

  const maxWorked   = Math.max(...stats.map(s=>s.worked), 1);
  const maxOT       = Math.max(...stats.map(s=>s.ot), 1);
  const maxLate     = Math.max(...stats.map(s=>s.late), 1);
  const maxHrs      = Math.max(...stats.map(s=>s.totalMins), 1);

  // ─── Upcoming birthdays ───────────────────────────────────────────────────
  const upcomingBdays = staff
    .filter(e => e.birthday)
    .map(e => {
      const bday = e.birthday.slice(5); // MM-DD
      const thisYear = new Date().getFullYear();
      const todayStr = new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});
      const bdayDate = new Date(`${thisYear}-${bday}T12:00:00`);
      const todayDate = new Date(todayStr+"T12:00:00");
      let diff = Math.round((bdayDate - todayDate)/(1000*60*60*24));
      if (diff < 0) diff += 365; // next year
      return { ...e, diff, bdayDate };
    })
    .sort((a,b) => a.diff - b.diff)
    .slice(0, 5);

  // ─── Bar chart helper ─────────────────────────────────────────────────────
  const BarChart = ({ data, maxVal, color, label, fmt }) => (
    <div className="card" style={{padding:"16px 20px",flex:1,minWidth:280}}>
      <div className="sec" style={{marginBottom:14}}>{label}</div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {data.map(({emp,val},i) => {
          const pct = maxVal > 0 ? (val/maxVal)*100 : 0;
          return (
            <div key={emp.id} style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:16,flexShrink:0}}>{emp.avatar||"🐾"}</span>
              <div style={{fontSize:11,color:"var(--tx2)",width:70,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{emp.name}</div>
              <div style={{flex:1,height:20,background:"var(--card2)",borderRadius:10,overflow:"hidden",position:"relative"}}>
                <div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:10,
                  transition:"width .6s ease",minWidth:pct>0?4:0}}/>
              </div>
              <div style={{fontSize:11,fontWeight:700,color,minWidth:36,textAlign:"right"}}>{fmt(val)}</div>
            </div>
          );
        })}
        {data.length===0&&<div style={{fontSize:13,color:"var(--tx3)",textAlign:"center",padding:20}}>ไม่มีข้อมูล</div>}
      </div>
    </div>
  );

  // ─── Donut chart for today status ──────────────────────────────────────────
  const todayStats = (() => {
    const d = today();
    const working = staff.filter(e=> records[d]?.[e.id]?.checkIn && !records[d]?.[e.id]?.checkOut && !records[d]?.[e.id]?.leaveType).length;
    const done    = staff.filter(e=> records[d]?.[e.id]?.checkOut).length;
    const onBreak = staff.filter(e=> records[d]?.[e.id]?.breakStart && !records[d]?.[e.id]?.breakEnd && !records[d]?.[e.id]?.checkOut).length;
    const absent  = staff.length - working - done - onBreak;
    return { working, done, onBreak, absent };
  })();

  const DonutSlice = ({pct, color, offset}) => {
    const r=36, circ=2*Math.PI*r;
    const dash = pct*circ/100;
    return <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="14"
      strokeDasharray={`${dash} ${circ-dash}`} strokeDashoffset={-offset*circ/100}
      style={{transformOrigin:"50px 50px",transform:"rotate(-90deg)",transition:"all .6s"}}/>;
  };

  const donutData = [
    {v:todayStats.working, col:"var(--acc)",   lbl:"ทำงาน"},
    {v:todayStats.onBreak, col:"var(--yellow)", lbl:"พักอยู่"},
    {v:todayStats.done,    col:"var(--tx3)",    lbl:"เลิกงาน"},
    {v:todayStats.absent,  col:"var(--redBg)",  lbl:"ยังไม่เข้า"},
  ];
  let donutOffset = 0;

  const yr = new Date().getFullYear();
  const moLabel = MONTHS_TH[parseInt(month.slice(5,7))-1] + " " + (yr+543);

  return (
    <div className="fade">
      {/* Month selector */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
          style={{width:160}}/>
        <span style={{fontSize:13,color:"var(--tx2)"}}>📊 รายงานประจำเดือน {moLabel}</span>
      </div>

      {/* Top row: Donut + Birthdays */}
      <div style={{display:"flex",gap:14,marginBottom:14,flexWrap:"wrap"}}>
        {/* Today donut */}
        <div className="card" style={{padding:"16px 20px",minWidth:200}}>
          <div className="sec" style={{marginBottom:12}}>สถานะทีมวันนี้</div>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <svg width="100" height="100" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="36" fill="none" stroke="var(--card2)" strokeWidth="14"/>
              {donutData.map((d,i) => {
                const pct = staff.length > 0 ? d.v/staff.length*100 : 0;
                const el = <DonutSlice key={i} pct={pct} color={d.col} offset={donutOffset}/>;
                donutOffset += pct;
                return el;
              })}
              <text x="50" y="55" textAnchor="middle" fontSize="18" fontWeight="700"
                fill="var(--tx)">{staff.length}</text>
            </svg>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {donutData.map((d,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:7,fontSize:12}}>
                  <span style={{width:10,height:10,borderRadius:"50%",background:d.col,display:"inline-block",flexShrink:0}}/>
                  <span style={{color:"var(--tx2)"}}>{d.lbl}</span>
                  <span style={{fontWeight:700,color:"var(--tx)",marginLeft:"auto",paddingLeft:8}}>{d.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Upcoming birthdays */}
        <div className="card" style={{padding:"16px 20px",flex:1,minWidth:220}}>
          <div className="sec" style={{marginBottom:12}}>🎂 วันเกิดที่กำลังจะมาถึง</div>
          {upcomingBdays.length === 0
            ? <div style={{fontSize:13,color:"var(--tx3)",textAlign:"center",padding:20}}>ยังไม่มีข้อมูลวันเกิด</div>
            : <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {upcomingBdays.map(e=>(
                  <div key={e.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",
                    background:e.diff===0?"var(--accBg)":"var(--card2)",borderRadius:10,
                    border:e.diff===0?"1.5px solid var(--acc)":"1px solid var(--br)"}}>
                    <span style={{fontSize:22}}>{e.avatar||"🐾"}</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--tx)"}}>{e.name}</div>
                      <div style={{fontSize:10,color:"var(--tx2)"}}>
                        🎂 {e.birthday?.slice(5).replace("-","/")} {e.birthday?.slice(0,4)&&`(${new Date().getFullYear()-parseInt(e.birthday.slice(0,4))} ปี)`}
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      {e.diff===0
                        ? <span className="pill" style={{background:"var(--accBg)",color:"var(--acc)"}}>🎉 วันนี้!</span>
                        : <span style={{fontSize:11,color:"var(--tx2)",fontWeight:600}}>อีก {e.diff} วัน</span>
                      }
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      {/* Bar charts grid */}
      <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:14}}>
        <BarChart label="📅 วันที่เข้างาน/เดือน"
          data={stats.map(s=>({emp:s.emp,val:s.worked}))}
          maxVal={maxWorked} color="var(--acc)"
          fmt={v=>`${v} วัน`}/>
        <BarChart label="⏰ OT สะสม/เดือน"
          data={stats.map(s=>({emp:s.emp,val:s.ot}))}
          maxVal={maxOT} color="var(--orange)"
          fmt={v=>v>0?hm(v):"—"}/>
      </div>
      <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:14}}>
        <BarChart label="🐢 มาสาย/เดือน"
          data={stats.map(s=>({emp:s.emp,val:s.late}))}
          maxVal={maxLate} color="var(--yellow)"
          fmt={v=>`${v} ครั้ง`}/>
        <BarChart label="⏱ ชม.รวม/เดือน"
          data={stats.map(s=>({emp:s.emp,val:s.totalMins}))}
          maxVal={maxHrs} color="var(--acc2)"
          fmt={v=>hm(v)}/>
      </div>

      {/* Summary table */}
      <div className="card" style={{overflow:"hidden"}}>
        <table>
          <thead><tr>
            <th>พนักงาน</th>
            <th style={{textAlign:"center"}}>📅 เข้างาน</th>
            <th style={{textAlign:"center"}}>🐢 มาสาย</th>
            <th style={{textAlign:"center"}}>🌿 ลา</th>
            <th style={{textAlign:"center"}}>⏱ ชม.รวม</th>
            <th style={{textAlign:"center"}}>🔥 OT</th>
          </tr></thead>
          <tbody>
            {stats.map(({emp,worked,late,leaveUsed,totalMins,ot})=>(
              <tr key={emp.id}>
                <td><div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:18}}>{emp.avatar||"🐾"}</span>
                  <div>
                    <div style={{fontWeight:600,fontSize:13}}>{emp.name}</div>
                    <div style={{fontSize:10,color:"var(--tx3)"}}>{emp.id}</div>
                  </div>
                </div></td>
                <td style={{textAlign:"center"}}><span className="pill" style={{background:"var(--accBg)",color:"var(--acc)",fontSize:11}}>{worked} วัน</span></td>
                <td style={{textAlign:"center"}}>{late>0?<span className="pill" style={{background:"var(--yellowBg)",color:"var(--yellow)",fontSize:11}}>{late} ครั้ง</span>:<span style={{color:"var(--tx3)",fontSize:12}}>—</span>}</td>
                <td style={{textAlign:"center"}}>{leaveUsed>0?<span className="pill" style={{background:"var(--purpleBg)",color:"var(--purple)",fontSize:11}}>{leaveUsed} วัน</span>:<span style={{color:"var(--tx3)",fontSize:12}}>—</span>}</td>
                <td style={{textAlign:"center"}} className="mono">{hm(totalMins)}</td>
                <td style={{textAlign:"center"}}>{ot>0?<span className="pill" style={{background:"var(--orangeBg)",color:"var(--orange)",fontSize:11}}>🔥 {hm(ot)}</span>:<span style={{color:"var(--tx3)",fontSize:12}}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel({user,employees,records,shifts,location,gSch,clinic,onReloadAll,onReloadRec,onLogout,showToast}){
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
    if(!window.confirm(`ลบใบลาของ ${empName} วันที่ ${date}? (ข้อมูลเช็คอิน/เอาท์จะยังคงอยู่)`)) return;
    setBusy(true);
    const r=await call("cancelLeave",{date,empId});
    r.success?(await onReloadRec(),showToast(true,"ลบใบลาแล้ว")):showToast(false,r.message||"ผิดพลาด");
    setBusy(false);
  };
  const exportAll=()=>{
    const rows=[["วันที่","รหัส","ชื่อ","แผนก/ตำแหน่ง","เข้างาน","ออกงาน","พัก(น.)","รวม(ชม.)","OT(ชม.)","สถานะงาน","ใบลา","สถานะใบลา","ตารางงานวันนั้น","สลับวันหยุด","หมายเหตุสลับ"]];
    Object.entries(records).sort((a,b)=>b[0].localeCompare(a[0])).forEach(([d,day])=>{
      Object.entries(day).forEach(([eid,r])=>{
        const emp=employees.find(x=>x.id===eid);
        const s2=getScheduleForDate(d,emp,gSch);
        const st=STATUS(r,s2);
        const otRes=calcOT(r.checkIn,r.checkOut,r.breakStart,r.breakEnd,s2);
        const bm=dm(r.breakStart,r.breakEnd);
        const shiftOv=shifts.find(s=>s.empId===eid&&s.date===d);
        let shiftLabel="",shiftNote="";
        if(shiftOv){
          const dow=new Date(d+"T12:00:00").getDay();
          const ws=emp?.weekSchedule;
          const isDefWork=ws?ws[String(dow)]!==null&&ws[String(dow)]!==undefined:((gSch?.workDays||"1,2,3,4,5").split(",").map(Number).includes(dow));
          if(shiftOv.type==="off"&&isDefWork){shiftLabel="🔴 สลับหยุด";shiftNote=shiftOv.note||"";}
          else if(shiftOv.type==="work"&&!isDefWork){shiftLabel="🔄 สลับมาทำงาน";shiftNote=shiftOv.note||"";}
        }
        const schedLabel=s2?`${s2.startTime}-${s2.endTime}`:"หยุด";
        rows.push([d,eid,emp?.name||"—",[emp?.position,emp?.department].filter(Boolean).join("/"),ft(r.checkIn),ft(r.checkOut),bm!=null?bm:"",otRes?hm(otRes.gross):"",otRes?.isOT?hm(otRes.ot):"",st.l,r.leaveType||"",r.leaveStatus||"",schedLabel,shiftLabel,shiftNote]);
      });
    });
    const dl=v=>String(v).includes(",")?`"${v}"`:v;
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+rows.map(r=>r.map(dl).join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));a.download=`att_all_${today()}.csv`;a.click();
  };

  const exportShifts=()=>{
    const rows=[["สัปดาห์","วันที่","รหัส","ชื่อ","ตำแหน่ง","ประเภท","ตารางปกติ","เวลาเข้า","เวลาออก","หมายเหตุ"]];
    [...shifts].sort((a,b)=>a.date.localeCompare(b.date)).forEach(s=>{
      const emp=employees.find(e=>e.id===s.empId);
      const typeLabel=s.type==="off"?"🔴 หยุดแทน":s.type==="work"?"🔄 มาทำงาน":"รีเซ็ต";
      const dow=new Date(s.date+"T12:00:00").getDay();
      const ws=emp?.weekSchedule;
      const isDefWork=ws?ws[String(dow)]!==null&&ws[String(dow)]!==undefined:((gSch?.workDays||"1,2,3,4,5").split(",").map(Number).includes(dow));
      const defLabel=isDefWork?"ทำงาน":"หยุด";
      rows.push([s.week,s.date,s.empId,emp?.name||"—",emp?.position||"",typeLabel,defLabel,s.startTime||"",s.endTime||"",s.note||""]);
    });
    const dl=v=>String(v).includes(",")?`"${v}"`:v;
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+rows.map(r=>r.map(dl).join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));a.download=`shifts_${today()}.csv`;a.click();
  };;

  const staff  = employees.filter(e=>e.role!=="admin");
  const dayRecs= records[date]||{};
  const filtered=staff.filter(e=>!search||e.name.includes(search)||e.id.includes(search.toUpperCase())||e.department?.includes(search)||e.position?.includes(search));
  const mo=today().slice(0,7);
  const moAll=Object.entries(records).filter(([d])=>d.startsWith(mo)).flatMap(([,d])=>Object.values(d));
  const statHrs=moAll.reduce((s,r)=>s+(dm(r.checkIn,r.checkOut)||0),0);
  const statOT=Object.entries(records).filter(([d])=>d.startsWith(mo)).flatMap(([,day])=>Object.entries(day)).reduce((acc,[eid,r])=>{ const emp=employees.find(e=>e.id===eid);const s2=getScheduleForDate(Object.keys(records).find(d=>records[d]?.[eid]===r)||today(),emp,gSch);const res=calcOT(r.checkIn,r.checkOut,r.breakStart,r.breakEnd,s2);return acc+(res?.ot||0); },0);
  const onBreakCount = staff.filter(e=>{ const r=records[today()]?.[e.id]; return r?.breakStart&&!r?.breakEnd&&!r?.checkOut; }).length;
  const pendingLeaves=Object.entries(records).flatMap(([date,day])=>Object.entries(day).filter(([,r])=>r.leaveType&&r.leaveStatus==="pending").map(([empId,r])=>({date,empId,emp:employees.find(e=>e.id===empId),...r})));

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:"12px 12px 80px"}}>
      {/* Header */}
      <div className="card2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div><div style={{fontSize:17,fontWeight:800,color:"var(--tx)"}}>⚙ Admin Panel</div><div style={{fontSize:11,color:"var(--tx2)"}}>{clinic?.name||"คลินิคท่านาสัตวแพทย์"} · {user.name}</div></div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          <button onClick={doDedup} disabled={busy} style={{background:"var(--yellowBg)",color:"var(--yellow)",border:"1px solid var(--yellow)50",padding:"7px 12px",fontSize:11}}>🔧 ล้างข้อมูลซ้ำ</button>
          <button onClick={onReloadAll} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"7px 12px",fontSize:12}}>🔄</button>
          <button onClick={exportAll} style={{background:"var(--accBg)",color:"var(--acc)",border:"1px solid var(--acc)50",padding:"7px 14px",fontSize:12,fontWeight:700}}>⬇ CSV ทั้งหมด</button>
          <button onClick={exportShifts} style={{background:"var(--yellowBg)",color:"var(--yellow)",border:"1px solid var(--yellow)50",padding:"7px 14px",fontSize:12,fontWeight:700}}>📅 CSV สลับวันหยุด</button>
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
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:8}}>
        <Stat label="พนักงาน" value={staff.length} color="var(--acc2)"/>
        <Stat label="เข้า/เดือน" value={moAll.filter(r=>r.checkIn&&!r.leaveType).length} color="var(--acc)"/>
        <Stat label="☕ พักอยู่ตอนนี้" value={onBreakCount} color={onBreakCount>0?"var(--yellow)":"var(--tx3)"}/>
        <Stat label="รออนุมัติ" value={pendingLeaves.length} color={pendingLeaves.length>0?"var(--orange)":"var(--tx3)"}/>
        <Stat label="ชม.รวม/เดือน" value={hm(statHrs)} color="var(--yellow)"/>
        <Stat label="🔥 OT รวม/เดือน" value={statOT>0?hm(statOT):"—"} color="var(--orange)"/>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:5,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
        {[["dashboard","📈","Dashboard"],["overview","📊","ภาพรวม"],["leaves","📋","ใบลา"+(pendingLeaves.length>0?" ("+pendingLeaves.length+")":"")],["employees","👥","พนักงาน"],["shifts","📅","สลับวันหยุด"],["location","📍","พิกัด"],["schedule","🕐","ตารางงาน"],["clinicinfo","🐾","คลินิค"]].map(([k,ic,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:"0 0 auto",padding:"8px 12px",background:tab===k?"var(--accBg)":"var(--card2)",color:tab===k?"var(--acc)":"var(--tx2)",border:`1px solid ${tab===k?"var(--acc)":"var(--br)"}`,borderRadius:10,fontSize:12,fontWeight:tab===k?700:400}}>{ic} {lb}</button>
        ))}
      </div>

      {/* DASHBOARD */}
      {tab==="dashboard"&&<Dashboard employees={employees} records={records} gSch={gSch}/>}

      {/* OVERVIEW */}
      {tab==="overview"&&(
        <div className="fade">
          {/* 🔔 On-break alert */}
          {(()=>{
            const onBreakList = staff.filter(e=>{
              const r=dayRecs[e.id];
              return r?.breakStart && !r?.breakEnd && !r?.checkOut;
            });
            if(onBreakList.length===0) return null;
            return(
              <div className="card2" style={{padding:"11px 16px",marginBottom:12,borderColor:"var(--yellow)60",background:"var(--yellowBg)",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <span style={{fontSize:16,animation:"pulse 2s infinite"}}>☕</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--yellow)",marginBottom:4}}>กำลังพักอยู่ {onBreakList.length} คน</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {onBreakList.map(e=>{
                      const r=dayRecs[e.id];
                      const liveMins=dm(r?.breakStart,new Date().toISOString());
                      const limit=getScheduleForDate(date,e,gSch)?.breakLimitMins??60;
                      const over=liveMins!=null&&liveMins>limit;
                      return(
                        <span key={e.id} className="pill" style={{background:over?"var(--redBg)":"rgba(255,255,255,.15)",color:over?"var(--red)":"var(--yellow)",border:`1px solid ${over?"var(--red)":"var(--yellow)"}40`,fontSize:11}}>
                          {e.avatar||"🐾"} {e.name} {liveMins!=null?hm(liveMins):"..."}{over?" ⚠":""}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:160}}/>
            <input placeholder="ค้นหา..." value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:100}}/>
            <span style={{fontSize:12,color:"var(--tx2)",whiteSpace:"nowrap"}}>{Object.keys(dayRecs).length}/{staff.length}</span>
          </div>
          <div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>พนักงาน</th><th>เข้า</th><th>ออก</th><th>พัก</th><th>รวม</th><th>OT</th><th>สถานะ</th><th></th></tr></thead>
              <tbody>{filtered.map(e=>{
                const r=dayRecs[e.id];
                const s2=getScheduleForDate(date,e,gSch);
                const st=STATUS(r,s2);
                const bm=dm(r?.breakStart,r?.breakEnd);
                const otRes2=calcOT(r?.checkIn,r?.checkOut,r?.breakStart,r?.breakEnd,s2);
                const bs=breakStatus(bm,s2?.breakLimitMins);
                const isOnBreak = r?.breakStart && !r?.breakEnd && !r?.checkOut;
                return(
                <tr key={e.id} onClick={()=>setSelEmp(e)} style={{cursor:"pointer",background:isOnBreak?"var(--yellowBg)":"transparent"}}>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:18}}>{e.avatar||"🐾"}</span>
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{fontWeight:600,fontSize:13,color:"var(--tx)"}}>{e.name}</div>
                          {isOnBreak&&<span style={{fontSize:10,background:"var(--yellowBg)",color:"var(--yellow)",border:"1px solid var(--yellow)40",borderRadius:20,padding:"1px 7px",animation:"pulse 2s infinite"}}>☕ พักอยู่</span>}
                        </div>
                        <div style={{fontSize:10,color:"var(--tx3)"}}>{e.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono" style={{color:r?.checkIn?"var(--acc)":"var(--tx3)",fontSize:12}}>{ft(r?.checkIn)}</td>
                  <td className="mono" style={{color:r?.checkOut?"var(--red)":"var(--tx3)",fontSize:12}}>{ft(r?.checkOut)}</td>
                  <td style={{fontSize:11}}>
                    {bs?<span className="pill" style={{background:bs.bg,color:bs.c,fontSize:9}}>☕ {bs.l}</span>:<span style={{color:"var(--tx3)"}}>—</span>}
                  </td>
                  <td className="mono" style={{color:"var(--acc2)",fontSize:12}}>{otRes2?hm(otRes2.gross):"—"}</td>
                  <td>
                    {otRes2?.isOT
                      ?<span className="pill" style={{background:"var(--orangeBg)",color:"var(--orange)",border:"1px solid var(--orange)40",fontSize:9,fontWeight:700}}>🔥 OT {hm(otRes2.ot)}</span>
                      :<span style={{color:"var(--tx3)",fontSize:11}}>—</span>
                    }
                  </td>
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
                <div><label className="lbl">🎂 วันเกิด</label><input type="date" value={newEmp.birthday||""} onChange={e=>setNewEmp({...newEmp,birthday:e.target.value})}/></div>
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

      {/* SHIFTS — สลับวันหยุดรายสัปดาห์ */}
      {tab==="shifts"&&<ShiftManager employees={employees.filter(e=>e.role!=="admin")} gSch={gSch} shifts={shifts} onReload={onReloadAll} showToast={showToast}/>}

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
    birthday: emp.birthday||"",
  });
  const[newPin,setNewPin]=useState("");const[cfPin,setCfPin]=useState("");
  const[showEmoji,setShowEmoji]=useState(false);

  // Sync f state whenever emp prop updates (e.g. after save+reload)
  useEffect(()=>{
    setF(prev=>({
      ...prev,
      name:emp.name||"", email:emp.email||"", phone:emp.phone||"",
      position:emp.position||"", department:emp.department||"",
      salary:emp.salary||"", startDate:emp.startDate||"",
      note:emp.note||"", avatar:emp.avatar||"🐾", role:emp.role||"employee",
      weekSchedule:emp.weekSchedule||null,
      graceMins:emp.graceMins!=null?String(emp.graceMins):"",
      maxLeaveDays:emp.maxLeaveDays!=null?String(emp.maxLeaveDays):"",
      birthday:emp.birthday||"",
    }));
  },[emp.id, emp.birthday, emp.name, emp.avatar]);

  const myRecs=Object.entries(records).flatMap(([d,r])=>r[emp.id]?[{date:d,...r[emp.id]}]:[]).sort((a,b)=>b.date.localeCompare(a.date));
  const leaveUsed=myRecs.filter(r=>r.leaveType&&r.date.startsWith(today().slice(0,4))).length;
  const moHrs=myRecs.filter(r=>r.date.startsWith(today().slice(0,7))).reduce((x,r)=>x+(dm(r.checkIn,r.checkOut)||0),0);
  const maxL=+(f.maxLeaveDays||gSch?.maxLeaveDays||10);

  const saveInfo=()=>onSave({id:emp.id,name:f.name,email:f.email,phone:f.phone,position:f.position,department:f.department,salary:f.salary,startDate:f.startDate,note:f.note,avatar:f.avatar,role:f.role,birthday:f.birthday||''});
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
              <div><label className="lbl">🎂 วันเกิด</label><input type="date" value={f.birthday||""} onChange={e=>setF({...f,birthday:e.target.value})}/></div>
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