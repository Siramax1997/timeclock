import { useState, useEffect, useCallback } from "react";

const API_URL = "https://script.google.com/macros/s/AKfycbyk5pFcfXtuZm0wUFqswrQxzvgOOkMb9jTViCbktmH7KzIUGr6zhE6pzKMUsS2vUK7x/exec";

const api = async (action, params = {}) => {
  try {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`${API_URL}?${qs}`, { redirect: "follow" });
    return JSON.parse(await res.text());
  } catch (e) { return { success: false, message: e.toString() }; }
};

// ─── Utils ────────────────────────────────────────────────────────────────────
const haversine = (lat1,lon1,lat2,lon2) => {
  const R=6371000, dL=((lat2-lat1)*Math.PI)/180, dO=((lon2-lon1)*Math.PI)/180;
  const a=Math.sin(dL/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dO/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
};
const todayKey = () => new Date().toISOString().slice(0,10);
const fmtTime = (iso) => { if(!iso) return "—"; try { return new Date(iso).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}); } catch{return iso;} };
const fmtDate = (s) => { if(!s) return "—"; try { const d=String(s).length===10?new Date(s+"T00:00:00"):new Date(s); return isNaN(d)?"—":d.toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"}); } catch{return s;} };
const diffMins = (a,b) => { if(!a||!b) return null; return Math.round((new Date(b)-new Date(a))/60000); };
const minsToHM = (m) => { if(m==null||m<0) return "—"; return `${Math.floor(m/60)}ชม.${m%60}น.`; };

// ─── Status logic ─────────────────────────────────────────────────────────────
const getStatus = (rec, schedule) => {
  if (!rec) return { label:"ขาดงาน", color:"#ff4d4d", bg:"#2d0a0a", icon:"✗" };
  if (rec.leaveType) {
    const t = { sick:"ลาป่วย", personal:"ลากิจ", vacation:"ลาพักร้อน" }[rec.leaveType] || "ลา";
    return { label:t, color:"#a78bfa", bg:"#1a0d2e", icon:"📋" };
  }
  if (!rec.checkIn) return { label:"ขาดงาน", color:"#ff4d4d", bg:"#2d0a0a", icon:"✗" };

  const workStart = schedule?.startTime || "08:30";
  const workEnd = schedule?.endTime || "17:30";
  const [sh,sm] = workStart.split(":").map(Number);
  const [eh,em] = workEnd.split(":").map(Number);

  const cin = new Date(rec.checkIn);
  const cinMins = cin.getHours()*60+cin.getMinutes();
  const startMins = sh*60+sm;
  const endMins = eh*60+em;
  const graceMins = schedule?.graceMins || 15;

  if (!rec.checkOut) return { label:"กำลังทำงาน", color:"#34d399", bg:"#0a2018", icon:"▶" };

  const cout = new Date(rec.checkOut);
  const coutMins = cout.getHours()*60+cout.getMinutes();
  const late = cinMins > startMins + graceMins;
  const earlyLeave = coutMins < endMins - 10;

  if (late && earlyLeave) return { label:"สาย+ออกก่อน", color:"#fb923c", bg:"#2d1505", icon:"⚠" };
  if (late) return { label:"มาสาย", color:"#fbbf24", bg:"#2d1f05", icon:"⚡" };
  if (earlyLeave) return { label:"ออกก่อนเวลา", color:"#f97316", bg:"#2d1205", icon:"↩" };
  return { label:"ปกติ", color:"#34d399", bg:"#0a2018", icon:"✓" };
};

// ─── Icons ────────────────────────────────────────────────────────────────────
const I = {
  clock:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  pin:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  user:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  dl:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  logout:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:15,height:15}}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  ok:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14}}><polyline points="20 6 9 17 4 12"/></svg>,
  err:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  hist:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>,
  leave:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  refresh:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14}}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  chart:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#070b14;--bg2:#0d1220;--bg3:#111827;--border:#1e2535;--accent:#00e5ff;--accent2:#7c3aed;--green:#10b981;--yellow:#f59e0b;--red:#ef4444;--orange:#f97316;--purple:#a78bfa;--text:#e2e8f0;--muted:#64748b}
body{background:var(--bg);color:var(--text);font-family:'JetBrains Mono',monospace}
::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#0a0a0f}::-webkit-scrollbar-thumb{background:var(--accent);border-radius:2px}
input,select,textarea{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:10px 14px;border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:13px;width:100%;outline:none;transition:border-color 0.2s}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(0,229,255,0.08)}
button{cursor:pointer;font-family:'JetBrains Mono',monospace;border:none;border-radius:8px;transition:all 0.15s;font-size:13px}
button:hover{filter:brightness(1.1)}
button:active{transform:scale(0.97)}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:14px}
.slide{animation:slideUp 0.25s ease}
@keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.spin{animation:spin 0.9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.glow{box-shadow:0 0 20px rgba(0,229,255,0.15)}
table{border-collapse:collapse;width:100%}
th{padding:10px 14px;text-align:left;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);background:var(--bg3);border-bottom:1px solid var(--border);font-family:'Syne',sans-serif}
td{padding:10px 14px;font-size:12px;border-bottom:1px solid var(--border)}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,0.02)}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:10px;letter-spacing:1px;font-weight:500}
@keyframes shake{0%,100%{transform:translateX(0)}25%,75%{transform:translateX(-6px)}50%{transform:translateX(6px)}}
`;

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [employees, setEmployees] = useState([]);
  const [records, setRecords]     = useState({});
  const [location, setLocation]   = useState(null);
  const [schedule, setSchedule]   = useState(null);
  const [user, setUser]           = useState(null);
  const [view, setView]           = useState("login");
  const [loading, setLoading]     = useState(true);

  const loadAll = async () => {
    setLoading(true);
    const [e,r,c] = await Promise.all([api("getEmployees"),api("getRecords"),api("getConfig")]);
    if(e.success) setEmployees(e.data||[]);
    if(r.success) setRecords(r.data||{});
    if(c.success){ setLocation(c.data?.location||null); setSchedule(c.data?.schedule||null); }
    setLoading(false);
  };
  useEffect(()=>{ loadAll(); },[]);

  const reloadRec = async () => { const r=await api("getRecords"); if(r.success) setRecords(r.data||{}); };
  const login  = (u) => { setUser(u); setView(u.role==="admin"?"admin":"dashboard"); };
  const logout = ()  => { setUser(null); setView("login"); };

  if(loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#070b14",flexDirection:"column",gap:20}}>
      <style>{css}</style>
      <div style={{position:"relative",width:60,height:60}}>
        <div style={{position:"absolute",inset:0,border:"2px solid transparent",borderTopColor:"#00e5ff",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
        <div style={{position:"absolute",inset:8,border:"2px solid transparent",borderTopColor:"#7c3aed",borderRadius:"50%",animation:"spin 1.2s linear infinite reverse"}}/>
      </div>
      <div style={{fontFamily:"'Syne',sans-serif",fontSize:11,letterSpacing:4,color:"#00e5ff"}}>LOADING SYSTEM</div>
    </div>
  );

  return (
    <>
      <style>{css}</style>
      {view==="login"     && <LoginView employees={employees} onLogin={login}/>}
      {view==="dashboard" && <DashboardView user={user} records={records} location={location} schedule={schedule} onReload={reloadRec} onLogout={logout}/>}
      {view==="admin"     && <AdminView user={user} employees={employees} records={records} location={location} schedule={schedule} onReloadAll={loadAll} onLogout={logout}/>}
    </>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginView({ employees, onLogin }) {
  const [id,setId] = useState(""); const [pin,setPin] = useState("");
  const [err,setErr] = useState(""); const [shake,setShake] = useState(false);
  const [now,setNow] = useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);

  const login = () => {
    const u = employees.find(e=>e.id===id.trim().toUpperCase()&&String(e.pin)===String(pin));
    if(u){ onLogin(u); }
    else{ setErr("รหัสไม่ถูกต้อง"); setShake(true); setTimeout(()=>setShake(false),500); }
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:"var(--bg)",position:"relative",overflow:"hidden"}}>
      {/* BG grid */}
      <div style={{position:"absolute",inset:0,backgroundImage:"linear-gradient(rgba(0,229,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.03) 1px,transparent 1px)",backgroundSize:"40px 40px"}}/>
      <div style={{position:"absolute",top:"20%",left:"10%",width:300,height:300,background:"radial-gradient(circle,rgba(124,58,237,0.12) 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",bottom:"20%",right:"10%",width:400,height:400,background:"radial-gradient(circle,rgba(0,229,255,0.08) 0%,transparent 70%)",pointerEvents:"none"}}/>

      <div className="slide" style={{position:"relative",width:"100%",maxWidth:420,animation:shake?"shake 0.4s ease":""}}>
        {/* Clock */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:52,fontWeight:800,letterSpacing:2,color:"var(--accent)",lineHeight:1,textShadow:"0 0 30px rgba(0,229,255,0.4)"}}>
            {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
          </div>
          <div style={{fontSize:11,color:"var(--muted)",marginTop:6,letterSpacing:3}}>
            {now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
          </div>
        </div>

        <div className="card" style={{padding:"32px 36px"}}>
          <div style={{textAlign:"center",marginBottom:28}}>
            <div style={{width:48,height:48,background:"linear-gradient(135deg,#00e5ff22,#7c3aed22)",border:"1px solid rgba(0,229,255,0.3)",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",fontSize:22}}>⏱</div>
            <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,letterSpacing:3,color:"var(--text)"}}>TIMECLOCK</h1>
            <div style={{fontSize:10,color:"var(--muted)",letterSpacing:3,marginTop:3}}>ATTENDANCE SYSTEM v2</div>
          </div>

          <div style={{marginBottom:14}}>
            <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>รหัสพนักงาน</label>
            <input placeholder="MAX" value={id} onChange={e=>setId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} style={{textTransform:"uppercase"}}/>
          </div>
          <div style={{marginBottom:20}}>
            <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>รหัส PIN</label>
            <input type="password" placeholder="••••" value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()}/>
          </div>

          {err && <div style={{background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"var(--red)",display:"flex",gap:8,alignItems:"center"}}>{I.err} {err}</div>}

          <button onClick={login} style={{width:"100%",padding:13,background:"linear-gradient(135deg,#00e5ff,#7c3aed)",color:"#fff",fontWeight:600,fontSize:13,letterSpacing:2,borderRadius:8,fontFamily:"'Syne',sans-serif"}}>
            เข้าสู่ระบบ →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardView({ user, records, location, schedule, onReload, onLogout }) {
  const [tab,setTab]   = useState("checkin");
  const [gps,setGps]   = useState("idle"); // idle|checking|ok|err|far
  const [gpsData,setGpsData] = useState(null);
  const [gpsMsg,setGpsMsg]   = useState("");
  const [msg,setMsg]   = useState(null);
  const [busy,setBusy] = useState(false);
  const [showLeave,setShowLeave] = useState(false);
  const [now,setNow]   = useState(new Date());
  const [leaveForm,setLeaveForm] = useState({type:"sick",startDate:todayKey(),endDate:todayKey(),reason:""});

  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);

  const todayRec = records[todayKey()]?.[user.id];
  const workStart = schedule?.startTime||"08:30";
  const workEnd   = schedule?.endTime||"17:30";

  const allRecs = Object.entries(records)
    .flatMap(([date,d])=>d[user.id]?[{date,...d[user.id]}]:[])
    .sort((a,b)=>b.date.localeCompare(a.date));

  // leave balance
  const thisYear = new Date().getFullYear();
  const leaveUsed = allRecs.filter(r => r.leaveType && r.date.startsWith(String(thisYear))).length;
  const leaveMax = schedule?.maxLeaveDays || 10;
  const leaveLeft = Math.max(0, leaveMax - leaveUsed);

  const status = getStatus(todayRec, schedule);

  const checkGPS = () => {
    setGps("checking"); setGpsMsg("");
    if(!navigator.geolocation){ setGps("err"); setGpsMsg("เบราว์เซอร์ไม่รองรับ GPS"); return; }
    navigator.geolocation.getCurrentPosition(pos=>{
      const {latitude:lat,longitude:lng,accuracy} = pos.coords;
      if(!location?.lat){ setGps("ok"); setGpsData({lat,lng,accuracy,dist:0}); setGpsMsg("✓ รับพิกัดสำเร็จ"); return; }
      const dist = haversine(lat,lng,location.lat,location.lng);
      setGpsData({lat,lng,accuracy,dist});
      if(dist<=location.radius){ setGps("ok"); setGpsMsg(`✓ อยู่ในพื้นที่ (ห่าง ${Math.round(dist)} ม.)`); }
      else{ setGps("far"); setGpsMsg(`✗ นอกพื้นที่ (ห่าง ${Math.round(dist)} ม.)`); }
    },()=>{ setGps("err"); setGpsMsg("ไม่สามารถรับพิกัดได้"); },{enableHighAccuracy:true,timeout:12000});
  };

  const showMsg2 = (type,text) => { setMsg({type,text}); setTimeout(()=>setMsg(null),4000); };

  const doCheckIn = async () => {
    if(gps!=="ok"||busy) return; setBusy(true);
    const res = await api("checkIn",{date:todayKey(),empId:user.id,time:new Date().toISOString(),lat:gpsData.lat,lng:gpsData.lng});
    if(res.success){ await onReload(); showMsg2("ok","เช็คอินสำเร็จ! "+fmtTime(new Date().toISOString())); }
    else showMsg2("err",res.message||"เกิดข้อผิดพลาด");
    setBusy(false);
  };

  const doCheckOut = async () => {
    if(gps!=="ok"||busy) return; setBusy(true);
    const res = await api("checkOut",{date:todayKey(),empId:user.id,time:new Date().toISOString(),lat:gpsData.lat,lng:gpsData.lng});
    if(res.success){ await onReload(); showMsg2("ok","เช็คเอาท์สำเร็จ! "+fmtTime(new Date().toISOString())); }
    else showMsg2("err",res.message||"เกิดข้อผิดพลาด");
    setBusy(false);
  };

  const submitLeave = async () => {
    if(!leaveForm.reason.trim()){ showMsg2("err","กรุณาระบุเหตุผล"); return; }
    if(leaveLeft<=0){ showMsg2("err","วันลาไม่เพียงพอ"); return; }
    setBusy(true);
    const res = await api("submitLeave",{empId:user.id,startDate:leaveForm.startDate,endDate:leaveForm.endDate,leaveType:leaveForm.type,reason:leaveForm.reason});
    if(res.success){ await onReload(); setShowLeave(false); showMsg2("ok","ส่งคำขอลาเรียบร้อย"); }
    else showMsg2("err",res.message||"เกิดข้อผิดพลาด");
    setBusy(false);
  };

  const exportCSV = () => {
    const rows=[["วันที่","เช็คอิน","เช็คเอาท์","รวมชั่วโมง","สถานะ"]];
    allRecs.forEach(r=>{ const s=getStatus(r,schedule); rows.push([r.date,fmtTime(r.checkIn),fmtTime(r.checkOut),minsToHM(diffMins(r.checkIn,r.checkOut)),s.label]); });
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(r=>r.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));
    a.download=`attendance_${user.id}_${todayKey()}.csv`; a.click();
  };

  const gpsColor = {idle:"var(--muted)",checking:"var(--yellow)",ok:"var(--green)",err:"var(--red)",far:"var(--red)"}[gps];
  const canIn  = gps==="ok"&&!todayRec?.checkIn&&!todayRec?.leaveType&&!busy;
  const canOut = gps==="ok"&&!!todayRec?.checkIn&&!todayRec?.checkOut&&!busy;

  // Stats for this month
  const thisMonth = new Date().toISOString().slice(0,7);
  const monthRecs = allRecs.filter(r=>r.date.startsWith(thisMonth));
  const presentDays = monthRecs.filter(r=>r.checkIn&&!r.leaveType).length;
  const lateDays    = monthRecs.filter(r=>getStatus(r,schedule).label==="มาสาย").length;
  const leaveDays   = monthRecs.filter(r=>r.leaveType).length;
  const totalMins   = monthRecs.reduce((s,r)=>s+(diffMins(r.checkIn,r.checkOut)||0),0);

  const tabs = [["checkin",I.clock,"เช็คอิน"],["history",I.hist,"ประวัติ"],["leave",I.leave,"ใบลา"]];

  return (
    <div style={{maxWidth:600,margin:"0 auto",padding:"16px 14px",minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,letterSpacing:2,color:"var(--text)"}}>TIMECLOCK</div>
          <div style={{fontSize:11,color:"var(--muted)"}}>👋 {user.name} · {user.id}</div>
        </div>
        <button onClick={onLogout} style={{background:"var(--bg2)",color:"var(--muted)",border:"1px solid var(--border)",padding:"7px 12px",display:"flex",alignItems:"center",gap:6}}>
          {I.logout} ออก
        </button>
      </div>

      {/* Clock Card */}
      <div className="card glow" style={{padding:24,textAlign:"center",marginBottom:14,background:"linear-gradient(135deg,#0d1220,#111827)",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,var(--accent),var(--accent2))"}}/>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:52,fontWeight:800,letterSpacing:3,color:"var(--accent)",lineHeight:1,textShadow:"0 0 40px rgba(0,229,255,0.3)"}}>
          {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
        </div>
        <div style={{fontSize:11,color:"var(--muted)",marginTop:6}}>
          {now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
        </div>
        {/* Today status strip */}
        <div style={{display:"flex",justifyContent:"center",gap:8,marginTop:16,flexWrap:"wrap"}}>
          <span className="badge" style={{background:status.bg,color:status.color,border:`1px solid ${status.color}40`}}>
            {status.icon} {status.label}
          </span>
          {todayRec?.checkIn && <span className="badge" style={{background:"rgba(52,211,153,0.1)",color:"var(--green)",border:"1px solid rgba(52,211,153,0.3)"}}>
            เข้า {fmtTime(todayRec.checkIn)}
          </span>}
          {todayRec?.checkOut && <span className="badge" style={{background:"rgba(239,68,68,0.1)",color:"var(--red)",border:"1px solid rgba(239,68,68,0.3)"}}>
            ออก {fmtTime(todayRec.checkOut)}
          </span>}
        </div>
        {/* Work hours bar */}
        {workStart && <div style={{marginTop:14,fontSize:10,color:"var(--muted)"}}>
          🕐 เวลางาน {workStart} — {workEnd} น.
          {location?.name && <span> · 📍 {location.name}</span>}
        </div>}
      </div>

      {/* Stats row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
        {[["เข้างาน",presentDays,"var(--green)"],["มาสาย",lateDays,"var(--yellow)"],["ใช้ลาไปแล้ว",leaveDays,"var(--purple)"],["วันลาคงเหลือ",leaveLeft,"var(--accent)"]].map(([l,v,c])=>(
          <div key={l} className="card" style={{padding:"12px 10px",textAlign:"center"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:26,fontWeight:800,color:c,lineHeight:1}}>{v}</div>
            <div style={{fontSize:9,color:"var(--muted)",marginTop:4,letterSpacing:1}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {tabs.map(([k,ic,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"9px 8px",display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:tab===k?"var(--accent)":"var(--bg2)",color:tab===k?"#000":"var(--muted)",border:`1px solid ${tab===k?"var(--accent)":"var(--border)"}`,fontFamily:"'JetBrains Mono',monospace",borderRadius:10}}>
            {ic} {lb}
          </button>
        ))}
      </div>

      {/* Tab: Check-in */}
      {tab==="checkin" && (
        <div className="slide">
          {/* GPS */}
          <div className="card" style={{padding:18,marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"var(--muted)"}}>{I.pin} ตรวจสอบพิกัด</div>
              <span style={{fontSize:10,color:gpsColor}}>{{idle:"รอตรวจสอบ",checking:"กำลังรับสัญญาณ...",ok:"✓ ในพื้นที่",err:"✗ ข้อผิดพลาด",far:"✗ นอกพื้นที่"}[gps]}</span>
            </div>
            {gpsMsg && <div style={{fontSize:11,color:gpsColor,background:`${gpsColor}18`,border:`1px solid ${gpsColor}30`,borderRadius:8,padding:"8px 12px",marginBottom:10}}>{gpsMsg}</div>}
            <button onClick={checkGPS} disabled={gps==="checking"} style={{width:"100%",padding:11,background:"var(--bg3)",color:gps==="checking"?"var(--accent)":"var(--text)",border:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              <span className={gps==="checking"?"spin":""}>{I.pin}</span>
              {gps==="checking"?"กำลังรับสัญญาณ...":"ตรวจสอบพิกัด"}
            </button>
          </div>

          {msg && <div style={{background:msg.type==="ok"?"rgba(16,185,129,0.1)":"rgba(239,68,68,0.1)",border:`1px solid ${msg.type==="ok"?"rgba(16,185,129,0.3)":"rgba(239,68,68,0.3)"}`,borderRadius:10,padding:"11px 14px",marginBottom:12,fontSize:12,color:msg.type==="ok"?"var(--green)":"var(--red)",display:"flex",gap:8,alignItems:"center"}}>
            {msg.type==="ok"?I.ok:I.err} {msg.text}
          </div>}

          {/* Check in/out buttons */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <button onClick={doCheckIn} disabled={!canIn} style={{padding:"24px 12px",borderRadius:14,textAlign:"center",background:canIn?"linear-gradient(135deg,#10b981,#059669)":"var(--bg2)",color:canIn?"#fff":"var(--muted)",border:`1px solid ${canIn?"#10b981":"var(--border)"}`,opacity:todayRec?.checkIn?0.5:1,boxShadow:canIn?"0 0 20px rgba(16,185,129,0.2)":"none"}}>
              <div style={{fontSize:32,marginBottom:8}}>→</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,letterSpacing:1}}>เช็คอิน</div>
              {todayRec?.checkIn && <div style={{fontSize:10,marginTop:4,opacity:0.7}}>{fmtTime(todayRec.checkIn)}</div>}
            </button>
            <button onClick={doCheckOut} disabled={!canOut} style={{padding:"24px 12px",borderRadius:14,textAlign:"center",background:canOut?"linear-gradient(135deg,#ef4444,#dc2626)":"var(--bg2)",color:canOut?"#fff":"var(--muted)",border:`1px solid ${canOut?"#ef4444":"var(--border)"}`,opacity:!todayRec?.checkIn||todayRec?.checkOut?0.5:1,boxShadow:canOut?"0 0 20px rgba(239,68,68,0.2)":"none"}}>
              <div style={{fontSize:32,marginBottom:8}}>←</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,letterSpacing:1}}>เช็คเอาท์</div>
              {todayRec?.checkOut && <div style={{fontSize:10,marginTop:4,opacity:0.7}}>{fmtTime(todayRec.checkOut)}</div>}
            </button>
          </div>

          {/* Leave shortcut */}
          <button onClick={()=>setShowLeave(true)} style={{width:"100%",padding:11,background:"rgba(167,139,250,0.1)",color:"var(--purple)",border:"1px solid rgba(167,139,250,0.3)",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {I.leave} ส่งคำขอลา ({leaveLeft} วันคงเหลือ)
          </button>

          {gps==="idle" && <div style={{textAlign:"center",fontSize:11,color:"var(--muted)",marginTop:12}}>กดตรวจสอบพิกัดก่อนเช็คอิน/เอาท์</div>}
        </div>
      )}

      {/* Tab: History */}
      {tab==="history" && (
        <div className="slide">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:11,color:"var(--muted)"}}>{allRecs.length} รายการ · {minsToHM(totalMins)} / เดือนนี้</div>
            <button onClick={exportCSV} style={{background:"var(--accent)",color:"#000",padding:"7px 14px",display:"flex",alignItems:"center",gap:6,fontWeight:600,borderRadius:8}}>
              {I.dl} CSV
            </button>
          </div>
          {allRecs.length===0 ? <div style={{textAlign:"center",color:"var(--muted)",padding:60}}>ยังไม่มีประวัติ</div>
          : <div className="card" style={{overflow:"hidden"}}>
              <table>
                <thead><tr><th>วันที่</th><th>เข้า</th><th>ออก</th><th>รวม</th><th>สถานะ</th></tr></thead>
                <tbody>
                  {allRecs.map(r=>{ const s=getStatus(r,schedule); return (
                    <tr key={r.date}>
                      <td style={{color:"var(--text)",fontSize:11}}>{fmtDate(r.date)}</td>
                      <td style={{color:"var(--green)"}}>{fmtTime(r.checkIn)}</td>
                      <td style={{color:r.checkOut?"var(--red)":"var(--muted)"}}>{fmtTime(r.checkOut)}</td>
                      <td style={{color:"var(--accent)"}}>{minsToHM(diffMins(r.checkIn,r.checkOut))}</td>
                      <td><span className="badge" style={{background:s.bg,color:s.color,border:`1px solid ${s.color}40`,fontSize:9}}>{s.icon} {s.label}</span></td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          }
        </div>
      )}

      {/* Tab: Leave */}
      {tab==="leave" && (
        <div className="slide">
          <div className="card" style={{padding:20,marginBottom:14}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:11,letterSpacing:2,color:"var(--purple)",marginBottom:16}}>ส่งคำขอลา</div>
            <div style={{display:"grid",gap:12}}>
              <div>
                <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>ประเภทการลา</label>
                <select value={leaveForm.type} onChange={e=>setLeaveForm({...leaveForm,type:e.target.value})}>
                  <option value="sick">ลาป่วย</option>
                  <option value="personal">ลากิจ</option>
                  <option value="vacation">ลาพักร้อน</option>
                </select>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>วันเริ่ม</label>
                  <input type="date" value={leaveForm.startDate} onChange={e=>setLeaveForm({...leaveForm,startDate:e.target.value})}/>
                </div>
                <div>
                  <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>วันสุดท้าย</label>
                  <input type="date" value={leaveForm.endDate} onChange={e=>setLeaveForm({...leaveForm,endDate:e.target.value})}/>
                </div>
              </div>
              <div>
                <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>เหตุผล</label>
                <textarea rows={3} value={leaveForm.reason} onChange={e=>setLeaveForm({...leaveForm,reason:e.target.value})} placeholder="ระบุเหตุผลการลา..." style={{resize:"vertical"}}/>
              </div>
            </div>
            {msg && <div style={{background:msg.type==="ok"?"rgba(16,185,129,0.1)":"rgba(239,68,68,0.1)",border:`1px solid ${msg.type==="ok"?"rgba(16,185,129,0.3)":"rgba(239,68,68,0.3)"}`,borderRadius:8,padding:"10px 12px",margin:"12px 0",fontSize:12,color:msg.type==="ok"?"var(--green)":"var(--red)"}}>{msg.text}</div>}
            <button onClick={submitLeave} disabled={busy} style={{marginTop:16,width:"100%",padding:12,background:"linear-gradient(135deg,#7c3aed,#a78bfa)",color:"#fff",fontWeight:600,letterSpacing:1}}>
              {busy?"กำลังส่ง...":"ส่งคำขอลา"}
            </button>
          </div>

          {/* Leave history */}
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>ประวัติการลา ({leaveUsed}/{leaveMax} วัน)</div>
          <div className="card" style={{overflow:"hidden"}}>
            {allRecs.filter(r=>r.leaveType).length===0
              ? <div style={{padding:30,textAlign:"center",color:"var(--muted)",fontSize:12}}>ยังไม่มีประวัติการลา</div>
              : <table>
                  <thead><tr><th>วันที่</th><th>ประเภท</th><th>สถานะ</th></tr></thead>
                  <tbody>
                    {allRecs.filter(r=>r.leaveType).map(r=>{
                      const s=getStatus(r,schedule);
                      return <tr key={r.date}><td style={{color:"var(--text)"}}>{fmtDate(r.date)}</td><td style={{color:"var(--purple)"}}>{r.leaveReason||"—"}</td><td><span className="badge" style={{background:s.bg,color:s.color,border:`1px solid ${s.color}40`,fontSize:9}}>{s.icon} {s.label}</span></td></tr>;
                    })}
                  </tbody>
                </table>
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin ────────────────────────────────────────────────────────────────────
function AdminView({ user, employees, records, location, schedule, onReloadAll, onLogout }) {
  const [tab,setTab]     = useState("overview");
  const [date,setDate]   = useState(todayKey());
  const [newEmp,setNewEmp] = useState({id:"",name:"",pin:""});
  const [locForm,setLocForm] = useState({name:location?.name||"",lat:location?.lat||"",lng:location?.lng||"",radius:location?.radius||200});
  const [schForm,setSchForm] = useState({startTime:schedule?.startTime||"08:30",endTime:schedule?.endTime||"17:30",graceMins:schedule?.graceMins||15,workDays:schedule?.workDays||"1,2,3,4,5",maxLeaveDays:schedule?.maxLeaveDays||10});
  const [msg,setMsg]     = useState(null);
  const [busy,setBusy]   = useState(false);
  const [filterEmp,setFilterEmp] = useState("");

  useEffect(()=>{
    if(location) setLocForm({name:location.name||"",lat:location.lat||"",lng:location.lng||"",radius:location.radius||200});
    if(schedule) setSchForm({startTime:schedule.startTime||"08:30",endTime:schedule.endTime||"17:30",graceMins:schedule.graceMins||15,workDays:schedule.workDays||"1,2,3,4,5",maxLeaveDays:schedule.maxLeaveDays||10});
  },[location,schedule]);

  const showMsg = (text,type="ok") => { setMsg({text,type}); setTimeout(()=>setMsg(null),3500); };

  const addEmployee = async () => {
    if(!newEmp.id||!newEmp.name||!newEmp.pin) return showMsg("กรอกข้อมูลให้ครบ","err");
    if(employees.find(e=>e.id===newEmp.id.toUpperCase())) return showMsg("รหัสนี้มีอยู่แล้ว","err");
    setBusy(true);
    const res = await api("addEmployee",{id:newEmp.id.toUpperCase(),name:newEmp.name,pin:newEmp.pin,role:"employee"});
    if(res.success){ await onReloadAll(); setNewEmp({id:"",name:"",pin:""}); showMsg(`เพิ่ม ${newEmp.name} สำเร็จ`); }
    else showMsg(res.message||"เกิดข้อผิดพลาด","err");
    setBusy(false);
  };

  const removeEmployee = async (id) => {
    if(id===user.id||!window.confirm(`ลบ ${id} ?`)) return;
    setBusy(true);
    const res = await api("deleteEmployee",{id});
    if(res.success){ await onReloadAll(); showMsg("ลบแล้ว"); }
    else showMsg(res.message,"err");
    setBusy(false);
  };

  const saveLocation = async () => {
    if(!locForm.lat||!locForm.lng) return showMsg("กรอกพิกัดให้ครบ","err");
    setBusy(true);
    const res = await api("saveConfig",{configKey:"location",data:JSON.stringify({name:locForm.name,lat:parseFloat(locForm.lat),lng:parseFloat(locForm.lng),radius:parseInt(locForm.radius)})});
    if(res.success){ await onReloadAll(); showMsg("บันทึกพิกัดสำเร็จ"); }
    else showMsg(res.message||"ผิดพลาด","err");
    setBusy(false);
  };

  const saveSchedule = async () => {
    setBusy(true);
    const res = await api("saveConfig",{configKey:"schedule",data:JSON.stringify({startTime:schForm.startTime,endTime:schForm.endTime,graceMins:parseInt(schForm.graceMins),workDays:schForm.workDays,maxLeaveDays:parseInt(schForm.maxLeaveDays)})});
    if(res.success){ await onReloadAll(); showMsg("บันทึกตารางงานสำเร็จ"); }
    else showMsg(res.message||"ผิดพลาด","err");
    setBusy(false);
  };

  const exportAll = () => {
    const rows=[["วันที่","รหัส","ชื่อ","เข้างาน","ออกงาน","รวม","สถานะ"]];
    Object.entries(records).sort((a,b)=>b[0].localeCompare(a[0])).forEach(([d,day])=>{
      Object.entries(day).forEach(([empId,r])=>{
        const emp=employees.find(e=>e.id===empId);
        const s=getStatus(r,schedule);
        rows.push([d,empId,emp?.name||"—",fmtTime(r.checkIn),fmtTime(r.checkOut),minsToHM(diffMins(r.checkIn,r.checkOut)),s.label]);
      });
    });
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(r=>r.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));
    a.download=`attendance_all_${todayKey()}.csv`; a.click();
  };

  const dayRecs  = records[date]||{};
  const staffEmps = employees.filter(e=>e.role!=="admin");
  const filteredEmps = staffEmps.filter(e=>!filterEmp||e.name.includes(filterEmp)||e.id.includes(filterEmp.toUpperCase()));

  // Global stats
  const thisMonth = new Date().toISOString().slice(0,7);
  const allDayRecs = Object.entries(records).filter(([d])=>d.startsWith(thisMonth)).flatMap(([,d])=>Object.values(d));
  const statPresent = allDayRecs.filter(r=>r.checkIn&&!r.leaveType).length;
  const statLate    = allDayRecs.filter(r=>getStatus(r,schedule).label==="มาสาย").length;
  const statLeave   = allDayRecs.filter(r=>r.leaveType).length;
  const statTotal   = allDayRecs.reduce((s,r)=>s+(diffMins(r.checkIn,r.checkOut)||0),0);

  const adminTabs = [["overview",I.chart,"ภาพรวม"],["employees",I.user,"พนักงาน"],["location",I.pin,"พิกัด"],["schedule",I.clock,"ตารางงาน"]];

  return (
    <div style={{maxWidth:900,margin:"0 auto",padding:"16px 14px",minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,letterSpacing:2,color:"var(--text)"}}>ADMIN PANEL</div>
          <div style={{fontSize:11,color:"var(--muted)"}}>TIMECLOCK v2 · {user.name}</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={onReloadAll} style={{background:"var(--bg2)",color:"var(--muted)",border:"1px solid var(--border)",padding:"7px 12px",display:"flex",alignItems:"center",gap:6}}>{I.refresh} รีเฟรช</button>
          <button onClick={exportAll} style={{background:"var(--accent)",color:"#000",padding:"7px 14px",display:"flex",alignItems:"center",gap:6,fontWeight:600}}>{I.dl} CSV ทั้งหมด</button>
          <button onClick={onLogout} style={{background:"var(--bg2)",color:"var(--muted)",border:"1px solid var(--border)",padding:"7px 12px",display:"flex",alignItems:"center",gap:6}}>{I.logout} ออก</button>
        </div>
      </div>

      {msg && <div style={{background:msg.type==="ok"?"rgba(16,185,129,0.1)":"rgba(239,68,68,0.1)",border:`1px solid ${msg.type==="ok"?"rgba(16,185,129,0.3)":"rgba(239,68,68,0.3)"}`,borderRadius:10,padding:"11px 16px",marginBottom:14,fontSize:12,color:msg.type==="ok"?"var(--green)":"var(--red)",display:"flex",gap:8,alignItems:"center"}}>
        {msg.type==="ok"?I.ok:I.err} {msg.text}
      </div>}

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
        {[["พนักงาน",staffEmps.length,"var(--accent)"],["เข้างาน/เดือน",statPresent,"var(--green)"],["มาสาย/เดือน",statLate,"var(--yellow)"],["ลา/เดือน",statLeave,"var(--purple)"]].map(([l,v,c])=>(
          <div key={l} className="card" style={{padding:"16px 12px",textAlign:"center"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:32,fontWeight:800,color:c,lineHeight:1}}>{v}</div>
            <div style={{fontSize:9,color:"var(--muted)",marginTop:5,letterSpacing:1}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Total hours bar */}
      <div className="card" style={{padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:11,color:"var(--muted)"}}>⏱ รวมชั่วโมงทำงานเดือนนี้ (ทีม)</span>
        <span style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:700,color:"var(--accent)"}}>{minsToHM(statTotal)}</span>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {adminTabs.map(([k,ic,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{padding:"9px 16px",display:"flex",alignItems:"center",gap:7,background:tab===k?"var(--accent)":"var(--bg2)",color:tab===k?"#000":"var(--muted)",border:`1px solid ${tab===k?"var(--accent)":"var(--border)"}`,fontFamily:"'JetBrains Mono',monospace",borderRadius:10}}>
            {ic} {lb}
          </button>
        ))}
      </div>

      {/* ─── Overview ─── */}
      {tab==="overview" && (
        <div className="slide">
          <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{maxWidth:180}}/>
            <div style={{fontSize:11,color:"var(--muted)"}}>{Object.keys(dayRecs).length}/{staffEmps.length} คนเข้างาน</div>
            <input placeholder="ค้นหาพนักงาน..." value={filterEmp} onChange={e=>setFilterEmp(e.target.value)} style={{maxWidth:200,flex:1}}/>
          </div>
          <div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>พนักงาน</th><th>เข้างาน</th><th>ออกงาน</th><th>รวม</th><th>สถานะ</th></tr></thead>
              <tbody>
                {filteredEmps.map(emp=>{
                  const r=dayRecs[emp.id];
                  const s=getStatus(r,schedule);
                  return (
                    <tr key={emp.id}>
                      <td><div style={{color:"var(--text)",fontWeight:500}}>{emp.name}</div><div style={{fontSize:10,color:"var(--muted)"}}>{emp.id}</div></td>
                      <td style={{color:r?.checkIn?"var(--green)":"var(--muted)"}}>{fmtTime(r?.checkIn)}</td>
                      <td style={{color:r?.checkOut?"var(--red)":"var(--muted)"}}>{fmtTime(r?.checkOut)}</td>
                      <td style={{color:"var(--accent)"}}>{r?minsToHM(diffMins(r.checkIn,r.checkOut)):"—"}</td>
                      <td><span className="badge" style={{background:s.bg,color:s.color,border:`1px solid ${s.color}40`,fontSize:9}}>{s.icon} {s.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Employees ─── */}
      {tab==="employees" && (
        <div className="slide">
          <div className="card" style={{padding:20,marginBottom:14}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:11,letterSpacing:2,color:"var(--accent)",marginBottom:16}}>เพิ่มพนักงานใหม่</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr",gap:10,marginBottom:12}}>
              <input placeholder="รหัส (EMP003)" value={newEmp.id} onChange={e=>setNewEmp({...newEmp,id:e.target.value.toUpperCase()})}/>
              <input placeholder="ชื่อ-นามสกุล" value={newEmp.name} onChange={e=>setNewEmp({...newEmp,name:e.target.value})}/>
              <input placeholder="PIN" type="password" value={newEmp.pin} onChange={e=>setNewEmp({...newEmp,pin:e.target.value})}/>
            </div>
            <button onClick={addEmployee} disabled={busy} style={{background:busy?"var(--muted)":"linear-gradient(135deg,var(--accent),var(--accent2))",color:"#fff",padding:"10px 20px",fontWeight:600}}>
              {busy?"กำลังบันทึก...":"+ เพิ่มพนักงาน"}
            </button>
          </div>
          <div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>รหัส</th><th>ชื่อ</th><th>บทบาท</th><th>ลาคงเหลือ</th><th></th></tr></thead>
              <tbody>
                {employees.map(emp=>{
                  const used=Object.values(records).flatMap(d=>Object.entries(d)).filter(([eid,r])=>eid===emp.id&&r.leaveType).length;
                  const left=Math.max(0,(schedule?.maxLeaveDays||10)-used);
                  return (
                    <tr key={emp.id}>
                      <td style={{color:"var(--accent)",fontWeight:500}}>{emp.id}</td>
                      <td style={{color:"var(--text)"}}>{emp.name}</td>
                      <td><span className="badge" style={{background:emp.role==="admin"?"rgba(245,158,11,0.15)":"rgba(0,229,255,0.1)",color:emp.role==="admin"?"var(--yellow)":"var(--accent)",border:`1px solid ${emp.role==="admin"?"rgba(245,158,11,0.3)":"rgba(0,229,255,0.3)"}`}}>{emp.role==="admin"?"ผู้ดูแล":"พนักงาน"}</span></td>
                      <td style={{color:"var(--purple)"}}>{left}/{schedule?.maxLeaveDays||10} วัน</td>
                      <td>{emp.id!==user.id&&<button onClick={()=>removeEmployee(emp.id)} disabled={busy} style={{background:"rgba(239,68,68,0.15)",color:"var(--red)",border:"1px solid rgba(239,68,68,0.3)",padding:"4px 10px",fontSize:11}}>ลบ</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Location ─── */}
      {tab==="location" && (
        <div className="slide">
          <div className="card" style={{padding:24}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:11,letterSpacing:2,color:"var(--accent)",marginBottom:20}}>ตั้งค่าพิกัดสำนักงาน</div>
            <div style={{display:"grid",gap:14}}>
              <div>
                <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>ชื่อสถานที่</label>
                <input value={locForm.name} onChange={e=>setLocForm({...locForm,name:e.target.value})} placeholder="ออฟฟิศบางแก้ว"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div><label style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:7}}>Latitude</label><input type="number" step="0.00001" value={locForm.lat} onChange={e=>setLocForm({...locForm,lat:e.target.value})}/></div>
                <div><label style={{fontSize:10,color:"var(--muted)",display:"block",marginBottom:7}}>Longitude</label><input type="number" step="0.00001" value={locForm.lng} onChange={e=>setLocForm({...locForm,lng:e.target.value})}/></div>
              </div>
              <div>
                <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>รัศมี: {locForm.radius} เมตร</label>
                <input type="range" min="50" max="1000" step="25" value={locForm.radius} onChange={e=>setLocForm({...locForm,radius:e.target.value})} style={{width:"100%",accentColor:"var(--accent)",background:"transparent",border:"none"}}/>
              </div>
            </div>
            <button onClick={saveLocation} disabled={busy} style={{marginTop:20,background:"linear-gradient(135deg,var(--accent),var(--accent2))",color:"#fff",padding:"11px 24px",fontWeight:600}}>
              {busy?"กำลังบันทึก...":"บันทึกพิกัด →"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Schedule ─── */}
      {tab==="schedule" && (
        <div className="slide">
          <div className="card" style={{padding:24}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:11,letterSpacing:2,color:"var(--accent)",marginBottom:20}}>ตั้งค่าเวลาทำงาน</div>
            <div style={{display:"grid",gap:14}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>เวลาเข้างาน</label>
                  <input type="time" value={schForm.startTime} onChange={e=>setSchForm({...schForm,startTime:e.target.value})}/>
                </div>
                <div>
                  <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>เวลาออกงาน</label>
                  <input type="time" value={schForm.endTime} onChange={e=>setSchForm({...schForm,endTime:e.target.value})}/>
                </div>
              </div>
              <div>
                <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>ระยะผ่อนผันการมาสาย: {schForm.graceMins} นาที</label>
                <input type="range" min="0" max="60" step="5" value={schForm.graceMins} onChange={e=>setSchForm({...schForm,graceMins:e.target.value})} style={{width:"100%",accentColor:"var(--yellow)",background:"transparent",border:"none"}}/>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--muted)",marginTop:4}}><span>0 น.</span><span>60 น.</span></div>
              </div>
              <div>
                <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:7}}>วันลาสูงสุดต่อปี (ต่อคน): {schForm.maxLeaveDays} วัน</label>
                <input type="range" min="1" max="30" step="1" value={schForm.maxLeaveDays} onChange={e=>setSchForm({...schForm,maxLeaveDays:e.target.value})} style={{width:"100%",accentColor:"var(--purple)",background:"transparent",border:"none"}}/>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--muted)",marginTop:4}}><span>1 วัน</span><span>30 วัน</span></div>
              </div>
              <div>
                <label style={{fontSize:10,color:"var(--muted)",letterSpacing:2,display:"block",marginBottom:10}}>วันทำงาน</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["อา","จ","อ","พ","พฤ","ศ","ส"].map((d,i)=>{
                    const days=schForm.workDays.split(",").map(Number);
                    const on=days.includes(i);
                    return <button key={i} onClick={()=>{
                      const cur=schForm.workDays.split(",").map(Number).filter(Boolean);
                      const nxt=on?cur.filter(x=>x!==i):[...cur,i].sort();
                      setSchForm({...schForm,workDays:nxt.join(",")});
                    }} style={{width:40,height:40,borderRadius:8,background:on?"var(--accent)":"var(--bg3)",color:on?"#000":"var(--muted)",border:`1px solid ${on?"var(--accent)":"var(--border)"}`,fontSize:12,fontWeight:on?600:400}}>{d}</button>;
                  })}
                </div>
              </div>
            </div>

            {/* Preview */}
            <div style={{marginTop:20,background:"var(--bg3)",borderRadius:10,padding:14,fontSize:12,color:"var(--muted)",lineHeight:2}}>
              <div style={{color:"var(--accent)",marginBottom:4,fontSize:10,letterSpacing:2}}>PREVIEW</div>
              <div>🕐 เวลางาน <span style={{color:"var(--text)"}}>{schForm.startTime} — {schForm.endTime} น.</span></div>
              <div>⚡ ผ่อนผันมาสาย <span style={{color:"var(--yellow)"}}>{schForm.graceMins} นาที</span> (นับสายหลัง {
                (() => { const [h,m]=schForm.startTime.split(":").map(Number); const t=h*60+m+parseInt(schForm.graceMins); return `${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`; })()
              } น.)</div>
              <div>📋 วันลาต่อปี <span style={{color:"var(--purple)"}}>{schForm.maxLeaveDays} วัน / คน</span></div>
            </div>

            <button onClick={saveSchedule} disabled={busy} style={{marginTop:20,background:"linear-gradient(135deg,#7c3aed,#a78bfa)",color:"#fff",padding:"11px 24px",fontWeight:600}}>
              {busy?"กำลังบันทึก...":"บันทึกตารางงาน →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}