import { useState, useEffect, useRef, useCallback } from "react";

// ─── Supabase Connection ──────────────────────────────────────────────────────
const SB_URL = "https://hcwofnjtqtalvdbuklov.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhjd29mbmp0cXRhbHZkYnVrbG92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MDQ2MjUsImV4cCI6MjA5MjA4MDYyNX0.T2zIU7nV8h0aPXZwo3UzoUaxAYf26HkIgnpPs9Qq51s";
const VAPID_PUBLIC_KEY = "BNX4jGzMGn8XUgPXjnLto8Qu19SkbkvgIhRvWyTwemULPEYpMogjsCRc_cRfRqM4UlCFp-KUc7jyzqU76H_VC8Y";

const sb = async (path, method="GET", body=null, extra={}) => {
  const headers = {"apikey":SB_KEY,"Authorization":`Bearer ${SB_KEY}`,...(body?{"Content-Type":"application/json"}:{}),...extra};
  const r = await fetch(`${SB_URL}/rest/v1/${path}`,{method,headers,body:body?JSON.stringify(body):null});
  if(!r.ok){const e=await r.text().catch(()=>"");throw new Error(`${r.status}: ${e}`);}
  const t=await r.text().catch(()=>"");return t?JSON.parse(t):[];
};

const mapEmp=r=>({id:r.id,name:r.name,role:r.role,email:r.email||"",phone:r.phone||"",position:r.position||"",department:r.department||"",salary:r.salary||"",startDate:r.start_date||"",workStart:r.work_start||"",workEnd:r.work_end||"",graceMins:r.grace_mins,workDays:r.work_days||"",maxLeaveDays:r.max_leave_days,note:r.note||"",avatar:r.avatar||"",weekSchedule:r.week_schedule,birthday:r.birthday||""});

const call = async (action, params = {}) => {
  try {
    if(action==="login"){
      const rows=await sb(`employees?id=eq.${encodeURIComponent(params.id.toUpperCase())}&select=*`);
      if(rows.length&&String(rows[0].pin)===String(params.pin)){const{pin,...s}=rows[0];return{success:true,user:mapEmp(s)};}
      return{success:false,message:"รหัสพนักงานหรือ PIN ไม่ถูกต้อง"};
    }else if(action==="getEmployees"){
      const rows=await sb("employees?select=*&order=id");
      return{success:true,data:rows.map(r=>{const{pin,...s}=r;return mapEmp(s);})};
    }else if(action==="getConfig"){
      const rows=await sb("config?select=*");const cfg={};rows.forEach(r=>{cfg[r.key]=r.value;});
      return{success:true,data:cfg};
    }else if(action==="saveConfig"){
      const val=typeof params.data==="string"?JSON.parse(params.data):params.data;
      await sb("config?on_conflict=key","POST",[{key:params.configKey,value:val}],{"Prefer":"resolution=merge-duplicates,return=minimal"});
      return{success:true};
    }else if(action==="getRecords"){
      const rows=await sb("records?select=*&order=date.desc");const records={};
      rows.forEach(r=>{if(!records[r.date])records[r.date]={};
        records[r.date][r.emp_id]={checkIn:r.check_in,checkOut:r.check_out,checkInLat:r.lat_in,checkInLng:r.lng_in,checkOutLat:r.lat_out,checkOutLng:r.lng_out,leaveType:r.leave_type,leaveReason:r.leave_reason,leaveStatus:r.leave_status,approvedBy:r.approved_by,breakStart:r.break_start,breakEnd:r.break_end};});
      return{success:true,data:records};
    }else if(action==="checkIn"){
      const{date,empId,time,lat,lng}=params;
      const ex=await sb(`records?date=eq.${date}&emp_id=eq.${encodeURIComponent(empId)}&select=check_in`);
      if(ex.length&&ex[0].check_in)return{success:true,alreadyCheckedIn:true,checkIn:ex[0].check_in};
      await sb("records?on_conflict=date,emp_id","POST",[{date,emp_id:empId,check_in:time,lat_in:+lat||0,lng_in:+lng||0}],{"Prefer":"resolution=merge-duplicates,return=minimal"});
      return{success:true};
    }else if(action==="checkOut"){
      const{date,empId,time,lat,lng}=params;
      const ex=await sb(`records?date=eq.${date}&emp_id=eq.${encodeURIComponent(empId)}&select=check_in,check_out`);
      if(!ex.length||!ex[0].check_in)return{success:false,message:"ไม่พบข้อมูลเช็คอิน — กรุณาเช็คอินก่อน"};
      if(ex[0].check_out)return{success:true,alreadyCheckedOut:true,checkOut:ex[0].check_out};
      await sb(`records?date=eq.${date}&emp_id=eq.${encodeURIComponent(empId)}`,"PATCH",{check_out:time,lat_out:+lat||0,lng_out:+lng||0});
      return{success:true};
    }else if(action==="breakStart"){
      const{date,empId,time}=params;
      const ex=await sb(`records?date=eq.${date}&emp_id=eq.${encodeURIComponent(empId)}&select=break_start`);
      if(!ex.length)return{success:false,message:"ไม่พบข้อมูลเช็คอิน"};
      if(ex[0].break_start)return{success:true,alreadyStarted:true,breakStart:ex[0].break_start};
      await sb(`records?date=eq.${date}&emp_id=eq.${encodeURIComponent(empId)}`,"PATCH",{break_start:time});
      return{success:true};
    }else if(action==="breakEnd"){
      const{date,empId,time}=params;
      const ex=await sb(`records?date=eq.${date}&emp_id=eq.${encodeURIComponent(empId)}&select=break_start,break_end`);
      if(!ex.length)return{success:false,message:"ไม่พบข้อมูล"};
      if(ex[0].break_end)return{success:true,alreadyEnded:true,breakEnd:ex[0].break_end};
      if(!ex[0].break_start)return{success:false,message:"ยังไม่ได้เริ่มพัก"};
      await sb(`records?date=eq.${date}&emp_id=eq.${encodeURIComponent(empId)}`,"PATCH",{break_end:time});
      return{success:true};
    }else if(action==="submitLeave"){
      const{empId,startDate,endDate,leaveType,reason}=params;const dates=[];
      let cur=new Date(startDate+"T12:00:00");const end=new Date(endDate+"T12:00:00");
      while(cur<=end){dates.push(cur.toLocaleDateString("en-CA"));cur.setDate(cur.getDate()+1);}
      await sb("records?on_conflict=date,emp_id","POST",dates.map(d=>({date:d,emp_id:empId,leave_type:leaveType,leave_reason:reason,leave_status:"pending"})),{"Prefer":"resolution=merge-duplicates,return=minimal"});
      return{success:true,days:dates.length};
    }else if(action==="approveLeave"||action==="rejectLeave"){
      const status=action==="approveLeave"?"approved":"rejected";
      await sb(`records?date=eq.${params.date}&emp_id=eq.${encodeURIComponent(params.empId)}`,"PATCH",{leave_status:status,approved_by:params.approvedBy});
      return{success:true,status};
    }else if(action==="cancelLeave"){
      await sb(`records?date=eq.${params.date}&emp_id=eq.${encodeURIComponent(params.empId)}`,"PATCH",{leave_type:null,leave_reason:null,leave_status:null,approved_by:null});
      return{success:true};
    }else if(action==="addEmployee"){
      const p=params;await sb("employees","POST",[{id:p.id,name:p.name,pin:p.pin,role:p.role||"employee",email:p.email||"",phone:p.phone||"",position:p.position||"",department:p.department||"",salary:p.salary||"",start_date:p.startDate||"",work_start:p.workStart||"",work_end:p.workEnd||"",grace_mins:p.graceMins!=null&&p.graceMins!==""?Number(p.graceMins):null,work_days:p.workDays||"",max_leave_days:p.maxLeaveDays!=null&&p.maxLeaveDays!==""?Number(p.maxLeaveDays):null,note:p.note||"",avatar:p.avatar||"",week_schedule:p.weekSchedule?(typeof p.weekSchedule==="string"?JSON.parse(p.weekSchedule):p.weekSchedule):null}]);
      return{success:true};
    }else if(action==="updateEmployee"){
      const{id,...fields}=params;const mapped={};
      const MAP={name:"name",pin:"pin",role:"role",email:"email",phone:"phone",position:"position",department:"department",salary:"salary",startDate:"start_date",workStart:"work_start",workEnd:"work_end",graceMins:"grace_mins",workDays:"work_days",maxLeaveDays:"max_leave_days",note:"note",avatar:"avatar",weekSchedule:"week_schedule"};
      Object.entries(fields).forEach(([k,v])=>{if(v!==undefined&&v!=="undefined"&&MAP[k]){if(k==="weekSchedule"&&typeof v==="string"){try{mapped[MAP[k]]=JSON.parse(v);}catch{mapped[MAP[k]]=v;}}else if(k==="graceMins"||k==="maxLeaveDays")mapped[MAP[k]]=v!==""?Number(v):null;else mapped[MAP[k]]=v;}});
      await sb(`employees?id=eq.${encodeURIComponent(id)}`,"PATCH",mapped);
      return{success:true};
    }else if(action==="deleteEmployee"){
      await sb(`employees?id=eq.${encodeURIComponent(params.id)}`,"DELETE");return{success:true};
    }else if(action==="deleteRecord"){
      await sb(`records?date=eq.${params.date}&emp_id=eq.${encodeURIComponent(params.empId)}`,"DELETE");return{success:true,deleted:1};
    }else if(action==="getShifts"){
      const rows=await sb("shifts?select=*&order=date");
      return{success:true,data:rows.map(r=>({week:r.week,empId:r.emp_id,date:r.date,type:r.type,startTime:r.start_time,endTime:r.end_time,note:r.note}))};
    }else if(action==="saveShift"){
      const{empId,date,type,startTime,endTime,note}=params;
      if(type==="default"){await sb(`shifts?date=eq.${date}&emp_id=eq.${encodeURIComponent(empId)}`,"DELETE");}
      else{const d=new Date(date+"T12:00:00");const jan4=new Date(d.getFullYear(),0,4);const wk=Math.ceil(((d-jan4)/86400000+jan4.getDay()+1)/7);const week=`${d.getFullYear()}-W${String(wk).padStart(2,"0")}`;
        await sb("shifts?on_conflict=date,emp_id","POST",[{week,emp_id:empId,date,type,start_time:startTime||"",end_time:endTime||"",note:note||""}],{"Prefer":"resolution=merge-duplicates,return=minimal"});}
      return{success:true};
    }else if(action==="savePushSubscription"){
      const{empId,endpoint,p256dh,auth}=params;
      await sb("push_subscriptions?on_conflict=endpoint","POST",[{emp_id:empId,endpoint,p256dh,auth}],{"Prefer":"resolution=merge-duplicates,return=minimal"});
      return{success:true};
    }else if(action==="deletePushSubscription"){
      await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(params.endpoint)}`,"DELETE");
      return{success:true};
    }else if(action==="deduplicateRecords"){return{success:true,deleted:0};}
    else{return{success:false,message:"unknown action: "+action};}
  } catch(e){return{success:false,message:String(e)};}
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
    const lbl = {sick:"ลาป่วย",personal:"ลากิจ",vacation:"ลาพักร้อน",holiday:"ลานักขัตฤกษ์"}[rec.leaveType]||"ลา";
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

// ─── Photo BG images (base64) ──────────────────────────────────────────────
const DOG_PHOTO_BG = "data:image/jpeg;base64,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";
const SIGN_PHOTO_BG = "data:image/jpeg;base64,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";
const CAFE_PHOTO_BG = "data:image/jpeg;base64,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";
const PUPPY_PHOTO_BG = "data:image/jpeg;base64,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";
const PEACE_PHOTO_BG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAUAAtADASIAAhEBAxEB/8QAHAABAAIDAQEBAAAAAAAAAAAAAAQFAgMGAQcI/8QARhAAAgIBAgMEBQoFAwQCAgEFAAECAwQFERIhMQYTQVEiMmFxchQVIzM0NVOBkbEHQlKhwSRighZDc9ElYybhRBc2k6Lw/8QAGwEBAAIDAQEAAAAAAAAAAAAAAAEFAgQGAwf/xAA1EQEAAQMBBgQGAQQCAgMAAAAAAQIDBBEFMTIzNHEGEiFRExRBUmGBIhUjQpEWYqGxJHLB/9oADAMBAAIRAxEAPwD6AAD5O6IAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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";

// ─── Clinic Photo BG (base64) ──────────────────────────────────────────────
const CLINIC_PHOTO_BG = "data:image/jpeg;base64,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";

// ─── Notification System ───────────────────────────────────────────────────
const NOTIFY_KEY = "tv_notify_enabled";
const getNotifyEnabled = () => { try{ return localStorage.getItem(NOTIFY_KEY)==="1"; }catch{ return false; } };
const setNotifyEnabled = (v) => { try{ localStorage.setItem(NOTIFY_KEY, v?"1":"0"); }catch{} };

// ─── Themes ───────────────────────────────────────────────────────────────────
const THEMES = [
  { id:"light",     name:"ใส",              emoji:"🌿", dark:false, bg:"#edfdf6",bg2:"#e0f9ef",bg3:"#f0fffe", card:"rgba(255,255,255,.86)",card2:"rgba(255,255,255,.66)", br:"rgba(0,0,0,.09)",br2:"rgba(0,0,0,.14)", tx:"rgba(0,0,0,.84)",tx2:"rgba(0,0,0,.5)",tx3:"rgba(0,0,0,.28)", acc:"#059669",acc2:"#0d9488", aB:"rgba(5,150,105,.12)",rB:"rgba(220,38,38,.1)",yB:"rgba(202,138,4,.12)",pB:"rgba(124,58,237,.12)",oB:"rgba(234,88,12,.12)", red:"#dc2626",yellow:"#ca8a04",purple:"#7c3aed",orange:"#ea580c" },
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
  // Cafe Cat: คาเฟ่แมวกลางวัน โทนน้ำตาลอุ่น-ครีม สดใส
  { id:"cafecat", name:"คาเฟ่แมว ☕", emoji:"☕", dark:false, photoBg:true, photoBgSrc:"cafe",
    bg:"#f7f0e6",bg2:"#f0e6d8",bg3:"#e8dcc8",
    card:"rgba(255,255,255,.52)",card2:"rgba(255,255,255,.65)",
    br:"rgba(140,90,40,.2)",br2:"rgba(140,90,40,.35)",
    tx:"rgba(45,28,10,.92)",tx2:"rgba(45,28,10,.58)",tx3:"rgba(45,28,10,.32)",
    acc:"#c47f1a",acc2:"#e8a830",
    aB:"rgba(196,127,26,.14)",rB:"rgba(180,50,40,.1)",yB:"rgba(196,160,20,.14)",pB:"rgba(110,70,150,.1)",oB:"rgba(180,100,30,.12)",
    red:"#b03020",yellow:"#b08010",purple:"#6a3a9a",orange:"#b05818" },

  // Sign Night: ป้ายหมายามค่ำ โทนมืดหรู แสงไฟอบอุ่น
  { id:"signnight", name:"ป้ายยามค่ำ 🪟", emoji:"🪟", dark:true, photoBg:true, photoBgSrc:"sign",
    bg:"#12100e",bg2:"#1a1612",bg3:"#0e0c0a",
    card:"rgba(255,255,255,.08)",card2:"rgba(255,255,255,.12)",
    br:"rgba(255,210,140,.2)",br2:"rgba(255,210,140,.35)",
    tx:"rgba(255,255,255,.95)",tx2:"rgba(255,220,160,.65)",tx3:"rgba(255,200,120,.32)",
    acc:"#f5c97a",acc2:"#f0a83a",
    aB:"rgba(245,201,122,.16)",rB:"rgba(255,90,90,.16)",yB:"rgba(255,210,80,.18)",pB:"rgba(190,140,255,.14)",oB:"rgba(255,160,60,.16)",
    red:"#ff6060",yellow:"#f5c97a",purple:"#c090ff",orange:"#ff9940" },

  // Golden Retriever: โทนครีม-อบอุ่น น้องหมาโกลเด้น
  { id:"goldendog", name:"น้องหมา 🐶", emoji:"🐶", dark:false, photoBg:true, photoBgSrc:"dog",
    bg:"#f5efe6",bg2:"#ede3d4",bg3:"#f0e8d8",
    card:"rgba(255,255,255,.55)",card2:"rgba(255,255,255,.68)",
    br:"rgba(180,140,90,.25)",br2:"rgba(180,140,90,.4)",
    tx:"rgba(50,35,15,.92)",tx2:"rgba(50,35,15,.58)",tx3:"rgba(50,35,15,.32)",
    acc:"#b07d3a",acc2:"#d4a054",
    aB:"rgba(176,125,58,.14)",rB:"rgba(180,50,50,.1)",yB:"rgba(180,140,20,.12)",pB:"rgba(120,80,160,.1)",oB:"rgba(190,110,40,.12)",
    red:"#b03030",yellow:"#a08020",purple:"#7040b0",orange:"#b06020" },

  // Puppy: ลูกหมาโกลเด้นตัวน้อย โทนครีมอบอุ่น
  { id:"puppy", name:"ลูกหมา 🐾", emoji:"🐾", dark:false, photoBg:true, photoBgSrc:"puppy",
    bg:"#f5f0ea",bg2:"#ede5da",bg3:"#e8ddd0",
    card:"rgba(255,255,255,.6)",card2:"rgba(255,255,255,.72)",
    br:"rgba(160,130,90,.2)",br2:"rgba(160,130,90,.35)",
    tx:"rgba(50,35,15,.9)",tx2:"rgba(50,35,15,.55)",tx3:"rgba(50,35,15,.3)",
    acc:"#a0784a",acc2:"#c09060",
    aB:"rgba(160,120,74,.12)",rB:"rgba(170,50,50,.1)",yB:"rgba(170,130,20,.12)",pB:"rgba(100,70,140,.1)",oB:"rgba(170,100,30,.12)",
    red:"#a03030",yellow:"#907020",purple:"#604090",orange:"#a06020" },

  // Peace: พระพุทธรูปสงบ พื้นเหลืองสดใส
  { id:"peace", name:"สงบ 🙏", emoji:"🙏", dark:false, photoBg:true, photoBgSrc:"peace",
    bg:"#f5c518",bg2:"#e8b810",bg3:"#f0c018",
    card:"rgba(255,255,255,.55)",card2:"rgba(255,255,255,.68)",
    br:"rgba(90,70,10,.22)",br2:"rgba(90,70,10,.38)",
    tx:"rgba(35,25,5,.92)",tx2:"rgba(35,25,5,.58)",tx3:"rgba(35,25,5,.32)",
    acc:"#8a6a10",acc2:"#a8842a",
    aB:"rgba(138,106,16,.14)",rB:"rgba(180,50,50,.12)",yB:"rgba(160,120,10,.16)",pB:"rgba(100,70,140,.12)",oB:"rgba(180,100,20,.14)",
    red:"#a03030",yellow:"#7a5c10",purple:"#604090",orange:"#a06020" },

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
function PhotoBG({ src, blur=2, brightness=0.55, overlay="rgba(8,8,10,.3)", overlayGrad=null, position="center" }) {
  const grad = overlayGrad || `linear-gradient(180deg, ${overlay.replace(")",",")} 0%), ${overlay.replace(")",",")} 40%), ${overlay.replace(")",",")} 100%))`.replace(/\),\)/g,")");
  return (
    <div style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none",overflow:"hidden"}}>
      <div style={{
        position:"absolute",inset:"-20px",
        backgroundImage:`url(${src})`,
        backgroundSize:"cover",
        backgroundPosition:position,
        filter:`blur(${blur}px) brightness(${brightness}) saturate(1.05)`,
        transform:"scale(1.05)",
      }}/>
      <div style={{position:"absolute",inset:0,background:overlayGrad||`linear-gradient(180deg, ${overlay} 0%, ${overlay.replace(/[\d.]+\)$/,"0.15)")} 45%, ${overlay} 100%)`}}/>
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
      <style>{CSS}</style>{th.photoBg ? (th.id==="goldendog" ? <PhotoBG src={DOG_PHOTO_BG} blur={1.5} brightness={0.72} overlayGrad="linear-gradient(180deg,rgba(245,235,215,.18) 0%,rgba(245,235,215,.08) 50%,rgba(30,20,10,.38) 100%)"/> : th.id==="signnight" ? <PhotoBG src={SIGN_PHOTO_BG} blur={3} brightness={0.62} overlayGrad="linear-gradient(180deg,rgba(10,8,6,.6) 0%,rgba(10,8,6,.3) 45%,rgba(10,8,6,.65) 100%)"/> : th.id==="cafecat" ? <PhotoBG src={CAFE_PHOTO_BG} blur={1.5} brightness={0.78} overlayGrad="linear-gradient(180deg,rgba(250,240,225,.15) 0%,rgba(250,240,225,.06) 50%,rgba(40,25,10,.42) 100%)"/> : th.id==="puppy" ? <PhotoBG src={PUPPY_PHOTO_BG} blur={1} brightness={0.88} position="center 75%" overlayGrad="linear-gradient(180deg,rgba(245,240,234,.1) 0%,rgba(245,240,234,.05) 50%,rgba(40,30,15,.3) 100%)"/> : th.id==="peace" ? <PhotoBG src={PEACE_PHOTO_BG} blur={1} brightness={0.85} position="center 65%" overlayGrad="linear-gradient(180deg,rgba(245,197,24,.12) 0%,rgba(245,197,24,.04) 45%,rgba(30,22,5,.4) 100%)"/> : <PhotoBG src={CLINIC_PHOTO_BG}/>) : <AnimBG themeId={themeId}/>}
      <div style={{width:46,height:46,border:"3px solid var(--br2)",borderTopColor:"var(--acc)",borderRadius:"50%"}} className="spin"/>
      <div style={{color:"var(--tx2)",fontSize:12,letterSpacing:3,textTransform:"uppercase"}}>กำลังโหลด...</div>
    </div>
  );

  return(
    <div style={ws}>
      <style>{CSS}</style>{th.photoBg ? (th.id==="goldendog" ? <PhotoBG src={DOG_PHOTO_BG} blur={1.5} brightness={0.72} overlayGrad="linear-gradient(180deg,rgba(245,235,215,.18) 0%,rgba(245,235,215,.08) 50%,rgba(30,20,10,.38) 100%)"/> : th.id==="signnight" ? <PhotoBG src={SIGN_PHOTO_BG} blur={3} brightness={0.62} overlayGrad="linear-gradient(180deg,rgba(10,8,6,.6) 0%,rgba(10,8,6,.3) 45%,rgba(10,8,6,.65) 100%)"/> : th.id==="cafecat" ? <PhotoBG src={CAFE_PHOTO_BG} blur={1.5} brightness={0.78} overlayGrad="linear-gradient(180deg,rgba(250,240,225,.15) 0%,rgba(250,240,225,.06) 50%,rgba(40,25,10,.42) 100%)"/> : th.id==="puppy" ? <PhotoBG src={PUPPY_PHOTO_BG} blur={1} brightness={0.88} position="center 75%" overlayGrad="linear-gradient(180deg,rgba(245,240,234,.1) 0%,rgba(245,240,234,.05) 50%,rgba(40,30,15,.3) 100%)"/> : th.id==="peace" ? <PhotoBG src={PEACE_PHOTO_BG} blur={1} brightness={0.85} position="center 65%" overlayGrad="linear-gradient(180deg,rgba(245,197,24,.12) 0%,rgba(245,197,24,.04) 45%,rgba(30,22,5,.4) 100%)"/> : <PhotoBG src={CLINIC_PHOTO_BG}/>) : <AnimBG themeId={themeId}/>}
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
// ─── HolidayCalendar — ปฏิทินลิสต์ "ใครลาวันไหน" ─────────────────────────────
function HolidayCalendar({ records, employees, gSch }) {
  const yr = today().slice(0,7).slice(0,4);
  const [filterMonth, setFilterMonth] = useState(today().slice(0,7));
  const [filterType, setFilterType]   = useState("all");

  // รวม record ทุกคนที่มีการลา
  const allLeaves = Object.entries(records)
    .flatMap(([date, day]) =>
      Object.entries(day)
        .filter(([, r]) => r.leaveType)
        .map(([empId, r]) => ({ date, empId, ...r }))
    )
    .filter(r => r.date.startsWith(filterMonth))
    .filter(r => filterType === "all" || r.leaveType === filterType)
    .sort((a, b) => a.date.localeCompare(b.date));

  // นับรายเดือน แยกประเภท
  const countByType = (type) =>
    allLeaves.filter(r => r.leaveType === type && r.leaveStatus !== "rejected").length;

  const TYPE_LABEL = {
    sick:    { l:"🤒 ลาป่วย",     col:"var(--red)",    bg:"var(--redBg)"    },
    personal:{ l:"📝 ลากิจ",      col:"var(--purple)", bg:"var(--purpleBg)" },
    vacation:{ l:"🌴 ลาพักร้อน",  col:"var(--acc)",    bg:"var(--accBg)"    },
    holiday: { l:"🎌 นักขัตฤกษ์", col:"var(--orange)", bg:"var(--orangeBg)" },
  };
  const STATUS_STYLE = {
    pending:  { l:"⏳ รอ",     col:"var(--yellow)", bg:"var(--yellowBg)" },
    approved: { l:"✓ อนุมัติ", col:"var(--acc)",    bg:"var(--accBg)"    },
    rejected: { l:"✗ ปฏิเสธ",  col:"var(--red)",    bg:"var(--redBg)"    },
  };

  // Holiday stats ของเดือนนี้
  const holidayYear = Object.entries(records)
    .flatMap(([date, day]) =>
      Object.entries(day)
        .filter(([, r]) => r.leaveType === "holiday" && r.date?.startsWith(yr))
        .map(([empId, r]) => ({ date, empId, ...r }))
    );

  return (
    <div>
      {/* Summary pills */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {Object.entries(TYPE_LABEL).map(([k,v])=>(
          <span key={k} className="pill" style={{background:v.bg,color:v.col,border:`1px solid ${v.col}30`,fontSize:12,padding:"5px 12px"}}>
            {v.l} {countByType(k)} วัน
          </span>
        ))}
      </div>

      {/* นักขัตฤกษ์ Summary รายคน */}
      <div className="card" style={{padding:"14px 16px",marginBottom:12}}>
        <div className="sec" style={{marginBottom:10}}>🎌 สรุปลานักขัตฤกษ์ปีนี้ (สูงสุด 13 วัน/คน)</div>
        <div style={{display:"grid",gap:7}}>
          {employees.filter(e=>e.role!=="admin").map(emp=>{
            const used = holidayYear.filter(r=>r.empId===emp.id && r.leaveStatus!=="rejected").length;
            const left = Math.max(0, 13 - used);
            const pct  = Math.min(100, (used/13)*100);
            return(
              <div key={emp.id} style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18,flexShrink:0}}>{emp.avatar||"🐾"}</span>
                <div style={{width:80,fontSize:12,color:"var(--tx)",flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{emp.name}</div>
                <div style={{flex:1,height:14,background:"var(--card2)",borderRadius:7,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:pct>=100?"var(--red)":"var(--orange)",borderRadius:7,transition:"width .4s ease"}}/>
                </div>
                <div style={{fontSize:11,color:pct>=100?"var(--red)":"var(--tx2)",fontWeight:600,minWidth:44,textAlign:"right"}}>{used}/13 วัน</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{width:160}}/>
        <select value={filterType} onChange={e=>setFilterType(e.target.value)} style={{flex:1,minWidth:120}}>
          <option value="all">📋 ทุกประเภท</option>
          <option value="holiday">🎌 นักขัตฤกษ์</option>
          <option value="sick">🤒 ลาป่วย</option>
          <option value="personal">📝 ลากิจ</option>
          <option value="vacation">🌴 ลาพักร้อน</option>
        </select>
      </div>

      {/* รายการลิสต์เรียงวันที่ */}
      <div className="card" style={{overflow:"hidden"}}>
        {allLeaves.length===0
          ? <div style={{padding:40,textAlign:"center",color:"var(--tx3)",fontSize:14}}>📅 ไม่มีการลาในเดือนนี้</div>
          : (()=>{
              // group by date
              const grouped = {};
              allLeaves.forEach(r=>{
                if(!grouped[r.date]) grouped[r.date]=[];
                grouped[r.date].push(r);
              });
              return Object.entries(grouped).map(([date, recs])=>(
                <div key={date}>
                  {/* Date header */}
                  <div style={{padding:"8px 16px",background:"var(--card2)",borderBottom:"1px solid var(--br)",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:13,fontWeight:700,color:"var(--acc)"}}>{fd(date)}</span>
                    <span style={{fontSize:11,color:"var(--tx3)"}}>
                      {new Date(date+"T12:00:00").toLocaleDateString("th-TH",{weekday:"long",timeZone:"Asia/Bangkok"})}
                    </span>
                    <span className="pill" style={{background:"var(--accBg)",color:"var(--acc)",fontSize:10,marginLeft:"auto"}}>{recs.length} คน</span>
                  </div>
                  {/* รายชื่อ */}
                  {recs.map((r,i)=>{
                    const emp = employees.find(e=>e.id===r.empId);
                    const tl  = TYPE_LABEL[r.leaveType]||{l:r.leaveType,col:"var(--tx2)",bg:"var(--card2)"};
                    const sl  = STATUS_STYLE[r.leaveStatus||"pending"];
                    return(
                      <div key={i} style={{padding:"10px 16px",borderBottom:"1px solid var(--br)",display:"flex",alignItems:"center",gap:12}}>
                        <span style={{fontSize:20,flexShrink:0}}>{emp?.avatar||"🐾"}</span>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:600,fontSize:13,color:"var(--tx)"}}>{emp?.name||r.empId}</div>
                          {r.leaveReason&&<div style={{fontSize:11,color:"var(--tx2)",marginTop:2}}>เหตุผล: {r.leaveReason}</div>}
                        </div>
                        <div style={{display:"flex",gap:5,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                          <span className="pill" style={{background:tl.bg,color:tl.col,fontSize:10}}>{tl.l}</span>
                          <span className="pill" style={{background:sl.bg,color:sl.col,fontSize:10}}>{sl.l}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ));
            })()
        }
      </div>
    </div>
  );
}

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

  // ── 🔔 Push Notification — ลงทะเบียนรับ push จาก server (ทำงานแม้ปิดแอป) ──
  const[notifyOn, setNotifyOn] = useState(()=>getNotifyEnabled());

  const urlBase64ToUint8Array = (base64String) => {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
  };

  const subscribeToPush = async () => {
    if(!("serviceWorker" in navigator) || !("PushManager" in window)){
      showToast(false,"เบราว์เซอร์นี้ไม่รองรับ Push Notification"); return false;
    }
    try{
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if(!sub){
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      const j = sub.toJSON();
      await call("savePushSubscription", {
        empId: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
      });
      return true;
    }catch(e){
      showToast(false,"ลงทะเบียนแจ้งเตือนไม่สำเร็จ: "+String(e));
      return false;
    }
  };

  const requestNotifyPermission = async () => {
    if(typeof Notification==="undefined"){ showToast(false,"เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน"); return; }
    if(Notification.permission!=="granted"){
      const perm = await Notification.requestPermission();
      if(perm!=="granted"){ showToast(false,"กรุณาอนุญาตการแจ้งเตือนในเบราว์เซอร์"); return; }
    }
    const ok = await subscribeToPush();
    if(ok){ setNotifyOn(true); setNotifyEnabled(true); showToast(true,"เปิดการแจ้งเตือนแล้ว 🔔 (ทำงานแม้ปิดแอป)"); }
  };
  const disableNotify = async () => {
    setNotifyOn(false); setNotifyEnabled(false);
    try{
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if(sub){ await call("deletePushSubscription",{endpoint:sub.endpoint}); await sub.unsubscribe(); }
    }catch(_){}
    showToast(true,"ปิดการแจ้งเตือนแล้ว");
  };

  // Auto-subscribe อีกครั้งถ้าเคยเปิดไว้แล้ว (กันกรณี subscription หลุด)
  useEffect(()=>{
    if(notifyOn && Notification?.permission==="granted") subscribeToPush();
  },[]);

  const myRecs = Object.entries(records).flatMap(([d,r])=>r[user.id]?[{date:d,...r[user.id]}]:[]).sort((a,b)=>b.date.localeCompare(a.date));
  const mo=today().slice(0,7), yr=today().slice(0,4);
  const moRecs = myRecs.filter(r=>r.date.startsWith(mo));
  const leaveUsed     = myRecs.filter(r=>r.leaveType&&r.leaveType!=="holiday"&&r.date.startsWith(yr)).length;
  const holidayUsed   = myRecs.filter(r=>r.leaveType==="holiday"&&r.date.startsWith(yr)).length;
  const HOLIDAY_MAX   = 13;
  const holidayLeft   = Math.max(0, HOLIDAY_MAX - holidayUsed);
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
    if(lf.type==="holiday" && holidayLeft<=0){ showToast(false,`ใช้วันลานักขัตฤกษ์ครบ ${HOLIDAY_MAX} วันแล้ว`); return; }
    if(lf.type!=="holiday" && leaveLeft<=0){ showToast(false,"วันลาไม่เพียงพอ"); return; }
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
    const rows=[["วันที่","เข้างาน","ออกงาน","เริ่มพัก","กลับจากพัก","พัก(น.)","สถานะพัก","ชม.ปกติ(ตาราง)","ชม.รวม(รวมพัก)","OT(น.)","OT(ชม:น.)","สถานะงาน","ประเภทลา"]];
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
        <Stat label="🎌นักขัตฤกษ์คงเหลือ" value={`${holidayLeft}/${HOLIDAY_MAX}`} color="var(--orange)"/>
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
        {[["checkin","🕐","เช็คอิน"],["history","📋","ประวัติ"],["leave","🌿","ใบลา"],["calendar","📅","ปฏิทิน"],["profile","👤","โปรไฟล์"]].map(([k,ic,lb])=>(
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
          {/* 🔔 Notify suggestion banner — แสดงถ้ายังไม่เคยตั้งค่า และเบราว์เซอร์รองรับ */}
          {!notifyOn && typeof Notification!=="undefined" && Notification.permission!=="denied" && (
            <div style={{padding:"11px 16px",marginBottom:10,borderRadius:12,display:"flex",alignItems:"center",gap:10,background:"var(--accBg)",border:"1px solid var(--acc)40"}}>
              <span style={{fontSize:20}}>🔔</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--acc)"}}>เปิดแจ้งเตือนเวลาเข้า-ออกงาน?</div>
                <div style={{fontSize:11,color:"var(--tx2)"}}>เตือนอัตโนมัติตามกะของคุณ ไม่พลาดเช็คอิน/เอาท์</div>
              </div>
              <button onClick={requestNotifyPermission} style={{background:"var(--acc)",color:"#fff",border:"none",padding:"7px 14px",fontSize:12,fontWeight:700,borderRadius:9,flexShrink:0}}>เปิดเลย</button>
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
            🌿 ส่งคำขอลา — เหลือ {leaveLeft} วัน · 🎌 นักขัต {holidayLeft} วัน
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
                  <option value="holiday">🎌 ลานักขัตฤกษ์</option>
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
          <div style={{fontSize:12,color:"var(--tx2)",marginBottom:10,paddingLeft:4,display:"flex",gap:14,flexWrap:"wrap"}}>
            <span>📋 ใช้ลา {leaveUsed}/{s2.maxLeaveDays} วัน ปีนี้</span>
            <span>🎌 นักขัตฤกษ์ {holidayUsed}/{HOLIDAY_MAX} วัน ปีนี้</span>
          </div>
          <div className="card" style={{overflow:"hidden"}}>
            {myRecs.filter(r=>r.leaveType).length===0?<div style={{padding:30,textAlign:"center",color:"var(--tx3)",fontSize:13}}>🌿 ยังไม่มีประวัติการลา</div>
            :<table>
              <thead><tr><th>วันที่</th><th>ประเภท</th><th>สถานะ</th><th>เหตุผล</th></tr></thead>
              <tbody>{myRecs.filter(r=>r.leaveType).map(r=>{ const ls=r.leaveStatus||"pending"; return(
                <tr key={r.date}>
                  <td style={{fontSize:11}}>{fd(r.date)}</td>
                  <td><span className="pill" style={{background:"var(--purpleBg)",color:"var(--purple)",fontSize:9}}>{{sick:"🤒 ลาป่วย",personal:"📝 ลากิจ",vacation:"🌴 พักร้อน",holiday:"🎌 นักขัตฤกษ์"}[r.leaveType]||r.leaveType}</span></td>
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

      {/* HOLIDAY CALENDAR TAB — ใครลาวันไหน */}
      {tab==="calendar"&&(
        <div className="fade">
          <HolidayCalendar records={records} employees={empList} gSch={gSch}/>
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

          {/* 🔔 Notifications */}
          <div className="card" style={{padding:20,marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div className="sec" style={{marginBottom:0}}>🔔 การแจ้งเตือน</div>
              <div
                onClick={()=>notifyOn?disableNotify():requestNotifyPermission()}
                style={{width:44,height:24,borderRadius:12,background:notifyOn?"var(--acc)":"var(--card2)",border:`1.5px solid ${notifyOn?"var(--acc)":"var(--br)"}`,position:"relative",cursor:"pointer",transition:"all .2s",flexShrink:0}}
              >
                <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:notifyOn?22:2,transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.2)"}}/>
              </div>
            </div>
            <div style={{fontSize:12,color:"var(--tx2)",lineHeight:1.9}}>
              {notifyOn ? (
                <>
                  <div>✅ เปิดแจ้งเตือนแล้ว จะเตือนอัตโนมัติ:</div>
                  <div style={{paddingLeft:14,marginTop:4}}>
                    <div>⏰ ถึงเวลาเข้างาน (ตามกะของคุณ)</div>
                    <div>🍽 พักเที่ยง 12:00 · ☕ พักบ่าย 13:00</div>
                    <div>⚠️ พักเกินเวลา — เตือนกลับเข้างาน</div>
                    <div>🔔 ใกล้เวลาเลิกงาน (ตามกะของคุณ)</div>
                  </div>
                </>
              ) : (
                <div>เปิดเพื่อรับแจ้งเตือนเวลาเข้างาน พักเบรก และเลิกงานอัตโนมัติ (ต้องเปิดแอปค้างไว้)</div>
              )}
            </div>
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
                        <span className="pill" style={{background:"var(--purpleBg)",color:"var(--purple)",fontSize:10,marginRight:6}}>{{sick:"🤒 ลาป่วย",personal:"📝 ลากิจ",vacation:"🌴 พักร้อน",holiday:"🎌 นักขัตฤกษ์"}[lv.leaveType]||lv.leaveType}</span>
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
                      <td><span className="pill" style={{background:"var(--purpleBg)",color:"var(--purple)",fontSize:9}}>{{sick:"🤒ลาป่วย",personal:"📝ลากิจ",vacation:"🌴พักร้อน",holiday:"🎌นักขัต"}[r.leaveType]||r.leaveType}</span></td>
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