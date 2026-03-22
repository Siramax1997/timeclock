import { useState, useEffect } from "react";

const API_URL = "https://script.google.com/macros/s/AKfycbyk5pFcfXtuZm0wUFqswrQxzvgOOkMb9jTViCbktmH7KzIUGr6zhE6pzKMUsS2vUK7x/exec";

const api = async (action, params = {}) => {
  try {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`${API_URL}?${qs}`, { redirect: "follow" });
    return JSON.parse(await res.text());
  } catch (e) { return { success: false, message: e.toString() }; }
};

// ─── Utils ────────────────────────────────────────────────────────────────────
const haversine = (la1,lo1,la2,lo2) => {
  const R=6371000,dL=((la2-la1)*Math.PI)/180,dO=((lo2-lo1)*Math.PI)/180;
  const a=Math.sin(dL/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dO/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
};
const today = () => new Date().toISOString().slice(0,10);
const ft = (iso) => { if(!iso) return "—"; try{return new Date(iso).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}catch{return iso} };
const fd = (s) => { if(!s) return "—"; try{const d=String(s).length===10?new Date(s+"T00:00:00"):new Date(s);return isNaN(d)?"—":d.toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"2-digit"})}catch{return s} };
const dm = (a,b) => { if(!a||!b) return null; const d=Math.round((new Date(b)-new Date(a))/60000); return d<0?null:d; };
const hm = (m) => { if(m==null||m<0) return "—"; return `${Math.floor(m/60)}:${String(m%60).padStart(2,"0")}`; };
const addMins = (time,mins) => { const [h,m]=time.split(":").map(Number),t=h*60+m+mins; return `${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`; };

const STATUS = (rec, sch) => {
  const S = sch || {};
  const start = S.startTime||"08:30", end = S.endTime||"17:30", grace = +(S.graceMins||15);
  if (!rec) return {label:"ขาดงาน",color:"#f87171",dot:"#ef4444",bg:"#2d0a0a"};
  if (rec.leaveType) return {label:{sick:"ลาป่วย",personal:"ลากิจ",vacation:"ลาพักร้อน"}[rec.leaveType]||"ลา",color:"#c4b5fd",dot:"#8b5cf6",bg:"#1e1040"};
  if (!rec.checkIn) return {label:"ขาดงาน",color:"#f87171",dot:"#ef4444",bg:"#2d0a0a"};
  if (!rec.checkOut) return {label:"กำลังทำงาน",color:"#34d399",dot:"#10b981",bg:"#052e16"};
  const cin=new Date(rec.checkIn), cout=new Date(rec.checkOut);
  const cinM=cin.getHours()*60+cin.getMinutes(), coutM=cout.getHours()*60+cout.getMinutes();
  const [sh,sm]=start.split(":").map(Number), [eh,em]=end.split(":").map(Number);
  const late=cinM>sh*60+sm+grace, early=coutM<eh*60+em-10;
  if(late&&early) return {label:"สาย+ออกก่อน",color:"#fb923c",dot:"#f97316",bg:"#2c1000"};
  if(late) return {label:"มาสาย "+(cinM-(sh*60+sm))+"น.",color:"#fbbf24",dot:"#f59e0b",bg:"#292100"};
  if(early) return {label:"ออกก่อนเวลา",color:"#fb923c",dot:"#f97316",bg:"#2c1000"};
  return {label:"ปกติ ✓",color:"#34d399",dot:"#10b981",bg:"#052e16"};
};

// ─── Global CSS ───────────────────────────────────────────────────────────────
const G = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0e14;--s1:#13161f;--s2:#1a1e2a;--s3:#222736;
  --br:#252a38;--br2:#2e3449;
  --tx:#e8eaf0;--t2:#9aa0b8;--t3:#5a6180;
  --blue:#4f8ef7;--cyan:#22d3ee;--green:#4ade80;
  --yellow:#fbbf24;--red:#f87171;--purple:#a78bfa;--orange:#fb923c;
}
body{background:var(--bg);color:var(--tx);font-family:'IBM Plex Sans Thai',sans-serif;font-size:14px;line-height:1.5}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--br2);border-radius:2px}
input,select,textarea{background:var(--s2);border:1.5px solid var(--br);color:var(--tx);padding:9px 13px;border-radius:8px;font-family:'IBM Plex Sans Thai',sans-serif;font-size:14px;width:100%;outline:none;transition:border 0.15s}
input:focus,select:focus,textarea:focus{border-color:var(--blue)}
button{cursor:pointer;font-family:'IBM Plex Sans Thai',sans-serif;border:none;border-radius:8px;transition:all 0.15s;font-size:14px;font-weight:500}
button:hover{opacity:0.88}
button:active{transform:scale(0.97)}
.card{background:var(--s1);border:1.5px solid var(--br);border-radius:12px}
.fade{animation:fade 0.2s ease}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.spin{animation:spin 0.9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
table{border-collapse:collapse;width:100%}
th{padding:9px 14px;text-align:left;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--t2);background:var(--s2);border-bottom:1.5px solid var(--br);font-weight:600}
td{padding:9px 14px;font-size:13px;border-bottom:1px solid var(--br);color:var(--tx)}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,0.02)}
.pill{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:500;letter-spacing:0.3px}
@keyframes shake{0%,100%{transform:translateX(0)}30%,70%{transform:translateX(-5px)}50%{transform:translateX(5px)}}
`;

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [employees,setEmployees] = useState([]);
  const [records,setRecords]     = useState({});
  const [location,setLocation]   = useState(null);
  const [schedule,setSchedule]   = useState(null);
  const [user,setUser]           = useState(null);
  const [view,setView]           = useState("login");
  const [loading,setLoading]     = useState(true);
  const [loadErr,setLoadErr]     = useState("");

  const loadAll = async () => {
    setLoading(true); setLoadErr("");
    const [er,rr,cr] = await Promise.all([api("getEmployees"),api("getRecords"),api("getConfig")]);
    if(!er.success||!rr.success||!cr.success){
      setLoadErr("เชื่อมต่อ Google Sheet ไม่สำเร็จ — กรุณารีเฟรช");
    }
    setEmployees(er.data||[]);
    setRecords(rr.data||{});
    // config has separate keys: location, schedule
    const cfg = cr.data||{};
    setLocation(cfg.location||null);
    setSchedule(cfg.schedule||null);
    setLoading(false);
  };
  useEffect(()=>{ loadAll(); },[]);

  const reloadRec = async () => { const r=await api("getRecords"); if(r.success) setRecords(r.data||{}); };
  const login  = u => { setUser(u); setView(u.role==="admin"?"admin":"dash"); };
  const logout = () => { setUser(null); setView("login"); };

  if(loading) return <Loader/>;

  return (
    <>
      <style>{G}</style>
      {view==="login" && <Login employees={employees} err={loadErr} onLogin={login} onRetry={loadAll}/>}
      {view==="dash"  && <Dash  user={user} records={records} location={location} schedule={schedule} onReload={reloadRec} onLogout={logout}/>}
      {view==="admin" && <Admin user={user} employees={employees} records={records} location={location} schedule={schedule} onReloadAll={loadAll} onLogout={logout}/>}
    </>
  );
}

function Loader() {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0c0e14",gap:16}}>
      <style>{G}</style>
      <div style={{width:36,height:36,border:"3px solid #252a38",borderTopColor:"#4f8ef7",borderRadius:"50%"}} className="spin"/>
      <div style={{color:"#5a6180",fontSize:13,letterSpacing:2}}>กำลังโหลด...</div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({ employees, err, onLogin, onRetry }) {
  const [id,setId]=useState(""); const [pin,setPin]=useState("");
  const [error,setError]=useState(""); const [shake,setShake]=useState(false);
  const [now,setNow]=useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);

  const go = () => {
    const u=employees.find(e=>e.id===id.trim().toUpperCase()&&String(e.pin)===String(pin));
    if(u){ onLogin(u); }
    else{ setError("รหัสพนักงานหรือ PIN ไม่ถูกต้อง"); setShake(true); setTimeout(()=>setShake(false),500); }
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:"var(--bg)"}}>
      <div style={{width:"100%",maxWidth:380}}>
        {/* Logo + time */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:56,height:56,background:"var(--s2)",border:"2px solid var(--br2)",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:24}}>⏱</div>
          <div style={{fontSize:28,fontWeight:700,letterSpacing:1,color:"var(--tx)"}}>TimeClock</div>
          <div style={{color:"var(--t3)",fontSize:12,marginTop:4,letterSpacing:2}}>ATTENDANCE SYSTEM</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:36,fontWeight:500,color:"var(--blue)",marginTop:16,letterSpacing:3}}>
            {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
          </div>
          <div style={{color:"var(--t2)",fontSize:13,marginTop:4}}>
            {now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
          </div>
        </div>

        <div className="card" style={{padding:28,animation:shake?"shake 0.4s":""}}>
          {err && (
            <div style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"var(--red)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span>⚠ {err}</span>
              <button onClick={onRetry} style={{background:"none",color:"var(--blue)",fontSize:12,padding:"2px 8px",border:"1px solid var(--blue)",borderRadius:6}}>รีเฟรช</button>
            </div>
          )}
          <div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7,fontWeight:500}}>รหัสพนักงาน</label>
            <input placeholder="MAX" value={id} onChange={e=>setId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} style={{textTransform:"uppercase"}}/>
          </div>
          <div style={{marginBottom:20}}>
            <label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7,fontWeight:500}}>รหัส PIN</label>
            <input type="password" placeholder="••••" value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/>
          </div>
          {error && <div style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.25)",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13,color:"var(--red)"}}>✗ {error}</div>}
          <button onClick={go} style={{width:"100%",padding:12,background:"var(--blue)",color:"#fff",fontWeight:600,fontSize:15,borderRadius:8}}>เข้าสู่ระบบ</button>
          {employees.length===0&&<div style={{marginTop:12,fontSize:11,color:"var(--t3)",textAlign:"center"}}>⚠ ไม่พบข้อมูลพนักงาน — เช็ค Google Sheet แท็บ employees</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dash({ user, records, location, schedule, onReload, onLogout }) {
  const [tab,setTab]   = useState("checkin");
  const [gps,setGps]   = useState("idle");
  const [gd,setGd]     = useState(null);
  const [gMsg,setGMsg] = useState("");
  const [msg,setMsg]   = useState(null);
  const [busy,setBusy] = useState(false);
  const [lf,setLf]     = useState({type:"sick",start:today(),end:today(),reason:""});
  const [now,setNow]   = useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);

  const todRec = records[today()]?.[user.id];
  const st = STATUS(todRec, schedule);
  const myRecs = Object.entries(records).flatMap(([d,r])=>r[user.id]?[{date:d,...r[user.id]}]:[]).sort((a,b)=>b.date.localeCompare(a.date));

  const mo = today().slice(0,7);
  const moRecs = myRecs.filter(r=>r.date.startsWith(mo));
  const leaveUsed = myRecs.filter(r=>r.leaveType&&r.date.startsWith(today().slice(0,4))).length;
  const leaveMax  = schedule?.maxLeaveDays||10;
  const leaveLeft = Math.max(0,leaveMax-leaveUsed);

  const showMsg = (ok,txt) => { setMsg({ok,txt}); setTimeout(()=>setMsg(null),4000); };

  const checkGPS = () => {
    setGps("checking"); setGMsg("");
    if(!navigator.geolocation){ setGps("err"); setGMsg("เบราว์เซอร์ไม่รองรับ GPS"); return; }
    navigator.geolocation.getCurrentPosition(pos=>{
      const {latitude:lat,longitude:lng,accuracy:acc}=pos.coords;
      // if no location config → allow anyway
      if(!location||!location.lat||!location.lng){
        setGps("ok"); setGd({lat,lng,acc,dist:0}); setGMsg("✓ รับพิกัดสำเร็จ"); return;
      }
      const dist=haversine(lat,lng,+location.lat,+location.lng);
      setGd({lat,lng,acc,dist});
      if(dist<=(+location.radius||200)){ setGps("ok"); setGMsg(`✓ อยู่ในพื้นที่ (ห่าง ${Math.round(dist)} ม.)`); }
      else { setGps("far"); setGMsg(`✗ นอกพื้นที่ (ห่าง ${Math.round(dist)} ม. | ขอบเขต ${location.radius||200} ม.)`); }
    },()=>{ setGps("err"); setGMsg("ไม่สามารถรับพิกัดได้ — กรุณาอนุญาต GPS"); },{enableHighAccuracy:true,timeout:14000});
  };

  const doIn = async () => {
    if(gps!=="ok"||busy) return; setBusy(true);
    const r=await api("checkIn",{date:today(),empId:user.id,time:new Date().toISOString(),lat:gd.lat,lng:gd.lng});
    if(r.success){ await onReload(); showMsg(true,"เช็คอินสำเร็จ "+ft(new Date().toISOString())); }
    else showMsg(false,r.message||"เกิดข้อผิดพลาด");
    setBusy(false);
  };
  const doOut = async () => {
    if(gps!=="ok"||busy) return; setBusy(true);
    const r=await api("checkOut",{date:today(),empId:user.id,time:new Date().toISOString(),lat:gd.lat,lng:gd.lng});
    if(r.success){ await onReload(); showMsg(true,"เช็คเอาท์สำเร็จ "+ft(new Date().toISOString())); }
    else showMsg(false,r.message||"เกิดข้อผิดพลาด");
    setBusy(false);
  };
  const doLeave = async () => {
    if(!lf.reason.trim()){ showMsg(false,"กรุณาระบุเหตุผล"); return; }
    setBusy(true);
    const r=await api("submitLeave",{empId:user.id,startDate:lf.start,endDate:lf.end,leaveType:lf.type,reason:lf.reason});
    if(r.success){ await onReload(); showMsg(true,`ส่งคำขอลาสำเร็จ (${r.days} วัน)`); }
    else showMsg(false,r.message||"ผิดพลาด");
    setBusy(false);
  };
  const exportCSV = () => {
    const rows=[["วันที่","เข้างาน","ออกงาน","รวม","สถานะ"]];
    myRecs.forEach(r=>{ const s=STATUS(r,schedule); rows.push([r.date,ft(r.checkIn),ft(r.checkOut),hm(dm(r.checkIn,r.checkOut)),s.label]); });
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(r=>r.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));
    a.download=`attendance_${user.id}_${today()}.csv`; a.click();
  };

  const gCol = {idle:"var(--t3)",checking:"var(--yellow)",ok:"var(--green)",err:"var(--red)",far:"var(--red)"}[gps];
  const canIn  = gps==="ok"&&!todRec?.checkIn&&!todRec?.leaveType&&!busy;
  const canOut = gps==="ok"&&!!todRec?.checkIn&&!todRec?.checkOut&&!busy;

  return (
    <div style={{maxWidth:520,margin:"0 auto",padding:"16px 14px 40px",minHeight:"100vh"}}>
      {/* Topbar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:"var(--tx)"}}>⏱ TimeClock</div>
          <div style={{fontSize:12,color:"var(--t3)"}}>สวัสดี, {user.name}</div>
        </div>
        <button onClick={onLogout} style={{background:"var(--s2)",color:"var(--t2)",border:"1.5px solid var(--br)",padding:"7px 14px",fontSize:13}}>ออกจากระบบ</button>
      </div>

      {/* Clock card */}
      <div className="card" style={{padding:"20px 20px 16px",marginBottom:12,background:"var(--s1)",borderColor:"var(--br2)"}}>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:46,fontWeight:500,color:"var(--blue)",letterSpacing:4,lineHeight:1,textAlign:"center"}}>
          {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
        </div>
        <div style={{textAlign:"center",color:"var(--t2)",fontSize:13,marginTop:6}}>
          {now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
        </div>
        {/* status row */}
        <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginTop:12}}>
          <span className="pill" style={{background:st.bg,color:st.color,border:`1px solid ${st.color}50`}}>{st.label}</span>
          {todRec?.checkIn&&<span className="pill" style={{background:"rgba(74,222,128,0.1)",color:"var(--green)",border:"1px solid rgba(74,222,128,0.3)"}}>เข้า {ft(todRec.checkIn)}</span>}
          {todRec?.checkOut&&<span className="pill" style={{background:"rgba(248,113,113,0.1)",color:"var(--red)",border:"1px solid rgba(248,113,113,0.3)"}}>ออก {ft(todRec.checkOut)}</span>}
        </div>
        {/* schedule info */}
        {schedule&&(
          <div style={{marginTop:12,background:"var(--s2)",borderRadius:8,padding:"10px 14px",display:"flex",flexWrap:"wrap",gap:12,justifyContent:"center"}}>
            <span style={{fontSize:12,color:"var(--t2)"}}>🕐 {schedule.startTime}–{schedule.endTime}</span>
            <span style={{fontSize:12,color:"var(--t2)"}}>⚡ ผ่อนผัน {schedule.graceMins||15} น.</span>
            {location?.name&&<span style={{fontSize:12,color:"var(--t2)"}}>📍 {location.name}</span>}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
        {[
          ["เข้างาน",moRecs.filter(r=>r.checkIn&&!r.leaveType).length,"var(--green)"],
          ["มาสาย",moRecs.filter(r=>STATUS(r,schedule).label.startsWith("มาสาย")).length,"var(--yellow)"],
          ["ใช้ลาแล้ว",leaveUsed,"var(--purple)"],
          ["ลาคงเหลือ",leaveLeft,"var(--cyan)"],
        ].map(([l,v,c])=>(
          <div key={l} className="card" style={{padding:"12px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:24,fontWeight:600,color:c,lineHeight:1}}>{v}</div>
            <div style={{fontSize:10,color:"var(--t3)",marginTop:5,lineHeight:1.3}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["checkin","เช็คอิน/เอาท์"],["history","ประวัติ"],["leave","ใบลา"]].map(([k,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"9px",background:tab===k?"var(--blue)":"var(--s1)",color:tab===k?"#fff":"var(--t2)",border:`1.5px solid ${tab===k?"var(--blue)":"var(--br)"}`,borderRadius:9,fontSize:13}}>
            {lb}
          </button>
        ))}
      </div>

      {/* ── TAB: checkin ── */}
      {tab==="checkin"&&(
        <div className="fade">
          {/* GPS box */}
          <div className="card" style={{padding:16,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:gMsg?10:0}}>
              <span style={{fontSize:13,color:"var(--t2)"}}>📡 ตรวจสอบพิกัด {location?.name?`· ${location.name}`:""}</span>
              <span style={{fontSize:12,color:gCol,fontWeight:500}}>
                {{idle:"รอ",checking:"รับสัญญาณ...",ok:"✓ ในพื้นที่",err:"✗ ผิดพลาด",far:"✗ นอกพื้นที่"}[gps]}
              </span>
            </div>
            {gMsg&&<div style={{fontSize:12,color:gCol,background:`${gCol}18`,border:`1px solid ${gCol}30`,borderRadius:7,padding:"8px 12px",marginBottom:10}}>{gMsg}</div>}
            <button onClick={checkGPS} disabled={gps==="checking"} style={{width:"100%",padding:10,background:"var(--s2)",color:gps==="checking"?"var(--yellow)":"var(--tx)",border:"1.5px solid var(--br)",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontSize:13}}>
              <span className={gps==="checking"?"spin":""}>📍</span>
              {gps==="checking"?"กำลังรับสัญญาณ GPS...":"ตรวจสอบพิกัดของฉัน"}
            </button>
          </div>

          {/* Alert */}
          {msg&&<div style={{background:msg.ok?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)",border:`1px solid ${msg.ok?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"}`,borderRadius:9,padding:"11px 14px",marginBottom:10,fontSize:13,color:msg.ok?"var(--green)":"var(--red)"}}>
            {msg.ok?"✓":"✗"} {msg.txt}
          </div>}

          {/* Check in/out */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            {[
              {label:"เช็คอิน",icon:"→",can:canIn,done:!!todRec?.checkIn,time:todRec?.checkIn,col:"#4ade80",bg:"rgba(74,222,128,0.12)",border:"rgba(74,222,128,0.3)",fn:doIn},
              {label:"เช็คเอาท์",icon:"←",can:canOut,done:!!todRec?.checkOut,time:todRec?.checkOut,col:"#f87171",bg:"rgba(248,113,113,0.12)",border:"rgba(248,113,113,0.3)",fn:doOut},
            ].map(b=>(
              <button key={b.label} onClick={b.fn} disabled={!b.can} style={{padding:"22px 12px",borderRadius:11,textAlign:"center",background:b.can?b.bg:"var(--s1)",color:b.can?b.col:"var(--t3)",border:`1.5px solid ${b.can?b.border:"var(--br)"}`,opacity:b.done&&!b.can?0.55:1}}>
                <div style={{fontSize:28,marginBottom:6}}>{b.icon}</div>
                <div style={{fontWeight:600,fontSize:15}}>{b.label}</div>
                {b.done&&<div style={{fontSize:11,marginTop:5,opacity:0.7}}>{ft(b.time)}</div>}
                {busy&&<div style={{fontSize:11,marginTop:4,color:"var(--t3)"}}>กำลังบันทึก...</div>}
              </button>
            ))}
          </div>

          <button onClick={()=>setTab("leave")} style={{width:"100%",padding:10,background:"rgba(167,139,250,0.1)",color:"var(--purple)",border:"1.5px solid rgba(167,139,250,0.3)",fontSize:13}}>
            📋 ส่งคำขอลา ({leaveLeft} วันคงเหลือ)
          </button>
          {gps==="idle"&&<div style={{textAlign:"center",fontSize:12,color:"var(--t3)",marginTop:12}}>กดตรวจสอบพิกัดก่อน จึงเช็คอิน/เอาท์ได้</div>}
        </div>
      )}

      {/* ── TAB: history ── */}
      {tab==="history"&&(
        <div className="fade">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:13,color:"var(--t2)"}}>{myRecs.length} รายการ</div>
            <button onClick={exportCSV} style={{background:"var(--blue)",color:"#fff",padding:"7px 14px",fontSize:13,display:"flex",alignItems:"center",gap:6}}>⬇ ดาวน์โหลด CSV</button>
          </div>
          {myRecs.length===0?<div style={{textAlign:"center",padding:60,color:"var(--t3)"}}>ยังไม่มีประวัติ</div>
          :<div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>วันที่</th><th>เข้า</th><th>ออก</th><th>รวม</th><th>สถานะ</th></tr></thead>
              <tbody>
                {myRecs.map(r=>{ const s=STATUS(r,schedule); return(
                  <tr key={r.date}>
                    <td style={{color:"var(--t2)",fontSize:12}}>{fd(r.date)}</td>
                    <td style={{color:"var(--green)",fontFamily:"'IBM Plex Mono',monospace"}}>{ft(r.checkIn)}</td>
                    <td style={{color:r.checkOut?"var(--red)":"var(--t3)",fontFamily:"'IBM Plex Mono',monospace"}}>{ft(r.checkOut)}</td>
                    <td style={{color:"var(--blue)",fontFamily:"'IBM Plex Mono',monospace"}}>{hm(dm(r.checkIn,r.checkOut))}</td>
                    <td><span className="pill" style={{background:s.bg,color:s.color,border:`1px solid ${s.color}40`,fontSize:10}}>{s.label}</span></td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>}
        </div>
      )}

      {/* ── TAB: leave ── */}
      {tab==="leave"&&(
        <div className="fade">
          <div className="card" style={{padding:18,marginBottom:14}}>
            <div style={{fontWeight:600,marginBottom:16,color:"var(--tx)"}}>📋 ส่งคำขอลา</div>
            <div style={{display:"grid",gap:12}}>
              <div>
                <label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>ประเภทการลา</label>
                <select value={lf.type} onChange={e=>setLf({...lf,type:e.target.value})}>
                  <option value="sick">🤒 ลาป่วย</option>
                  <option value="personal">📝 ลากิจ</option>
                  <option value="vacation">🌴 ลาพักร้อน</option>
                </select>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>วันเริ่มลา</label><input type="date" value={lf.start} onChange={e=>setLf({...lf,start:e.target.value})}/></div>
                <div><label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>วันสุดท้าย</label><input type="date" value={lf.end} onChange={e=>setLf({...lf,end:e.target.value})}/></div>
              </div>
              <div>
                <label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>เหตุผล</label>
                <textarea rows={3} value={lf.reason} onChange={e=>setLf({...lf,reason:e.target.value})} placeholder="ระบุเหตุผล..." style={{resize:"vertical"}}/>
              </div>
            </div>
            {msg&&<div style={{background:msg.ok?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)",border:`1px solid ${msg.ok?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"}`,borderRadius:8,padding:"10px 12px",marginTop:12,fontSize:13,color:msg.ok?"var(--green)":"var(--red)"}}>{msg.ok?"✓":"✗"} {msg.txt}</div>}
            <button onClick={doLeave} disabled={busy} style={{marginTop:14,width:"100%",padding:11,background:"var(--purple)",color:"#fff",fontWeight:600,fontSize:14}}>
              {busy?"กำลังส่ง...":"ส่งคำขอลา"}
            </button>
          </div>
          <div style={{fontSize:12,color:"var(--t2)",marginBottom:10}}>ประวัติการลา {leaveUsed}/{leaveMax} วัน/ปีนี้</div>
          <div className="card" style={{overflow:"hidden"}}>
            {myRecs.filter(r=>r.leaveType).length===0
              ?<div style={{padding:30,textAlign:"center",color:"var(--t3)",fontSize:13}}>ยังไม่มีประวัติการลา</div>
              :<table>
                <thead><tr><th>วันที่</th><th>ประเภท</th><th>เหตุผล</th></tr></thead>
                <tbody>
                  {myRecs.filter(r=>r.leaveType).map(r=>{
                    const s=STATUS(r,schedule);
                    return <tr key={r.date}><td style={{fontSize:12}}>{fd(r.date)}</td><td><span className="pill" style={{background:s.bg,color:s.color,border:`1px solid ${s.color}40`,fontSize:10}}>{s.label}</span></td><td style={{color:"var(--t2)",fontSize:12}}>{r.leaveReason||"—"}</td></tr>;
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
function Admin({ user, employees, records, location, schedule, onReloadAll, onLogout }) {
  const [tab,setTab] = useState("overview");
  const [date,setDate] = useState(today());
  const [newEmp,setNewEmp] = useState({id:"",name:"",pin:""});
  const [lf,setLf] = useState({name:location?.name||"",lat:location?.lat||"",lng:location?.lng||"",radius:location?.radius||200});
  const [sf,setSf] = useState({startTime:schedule?.startTime||"08:30",endTime:schedule?.endTime||"17:30",graceMins:schedule?.graceMins||15,workDays:schedule?.workDays||"1,2,3,4,5",maxLeaveDays:schedule?.maxLeaveDays||10});
  const [msg,setMsg] = useState(null);
  const [busy,setBusy] = useState(false);
  const [search,setSearch] = useState("");

  // sync when props change
  useEffect(()=>{ if(location) setLf({name:location.name||"",lat:location.lat||"",lng:location.lng||"",radius:location.radius||200}); },[location]);
  useEffect(()=>{ if(schedule) setSf({startTime:schedule.startTime||"08:30",endTime:schedule.endTime||"17:30",graceMins:schedule.graceMins||15,workDays:schedule.workDays||"1,2,3,4,5",maxLeaveDays:schedule.maxLeaveDays||10}); },[schedule]);

  const showMsg=(ok,txt)=>{ setMsg({ok,txt}); setTimeout(()=>setMsg(null),3500); };

  const addEmp = async () => {
    if(!newEmp.id||!newEmp.name||!newEmp.pin) return showMsg(false,"กรอกข้อมูลให้ครบ");
    if(employees.find(e=>e.id===newEmp.id.toUpperCase())) return showMsg(false,"รหัสนี้มีอยู่แล้ว");
    setBusy(true);
    const r=await api("addEmployee",{id:newEmp.id.toUpperCase(),name:newEmp.name,pin:newEmp.pin,role:"employee"});
    if(r.success){ await onReloadAll(); setNewEmp({id:"",name:"",pin:""}); showMsg(true,`เพิ่ม ${newEmp.name} สำเร็จ`); }
    else showMsg(false,r.message);
    setBusy(false);
  };
  const delEmp = async id => {
    if(id===user.id||!window.confirm(`ลบ ${id}?`)) return;
    setBusy(true);
    const r=await api("deleteEmployee",{id});
    if(r.success){ await onReloadAll(); showMsg(true,"ลบสำเร็จ"); }
    else showMsg(false,r.message);
    setBusy(false);
  };
  const saveLoc = async () => {
    if(!lf.lat||!lf.lng) return showMsg(false,"กรุณากรอกพิกัด Lat/Lng");
    setBusy(true);
    const r=await api("saveConfig",{configKey:"location",data:JSON.stringify({name:lf.name,lat:+lf.lat,lng:+lf.lng,radius:+lf.radius})});
    if(r.success){ await onReloadAll(); showMsg(true,"บันทึกพิกัดสำเร็จ"); }
    else showMsg(false,r.message);
    setBusy(false);
  };
  const saveSch = async () => {
    setBusy(true);
    const r=await api("saveConfig",{configKey:"schedule",data:JSON.stringify({startTime:sf.startTime,endTime:sf.endTime,graceMins:+sf.graceMins,workDays:sf.workDays,maxLeaveDays:+sf.maxLeaveDays})});
    if(r.success){ await onReloadAll(); showMsg(true,"บันทึกตารางงานสำเร็จ"); }
    else showMsg(false,r.message);
    setBusy(false);
  };
  const exportAll = () => {
    const rows=[["วันที่","รหัส","ชื่อ","เข้างาน","ออกงาน","รวม","สถานะ"]];
    Object.entries(records).sort((a,b)=>b[0].localeCompare(a[0])).forEach(([d,day])=>{
      Object.entries(day).forEach(([eid,r])=>{
        const e=employees.find(x=>x.id===eid); const s=STATUS(r,schedule);
        rows.push([d,eid,e?.name||"—",ft(r.checkIn),ft(r.checkOut),hm(dm(r.checkIn,r.checkOut)),s.label]);
      });
    });
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(r=>r.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));
    a.download=`attendance_all_${today()}.csv`; a.click();
  };

  const staff = employees.filter(e=>e.role!=="admin");
  const dayRecs = records[date]||{};
  const filtered = staff.filter(e=>!search||e.name.includes(search)||e.id.includes(search.toUpperCase()));

  const mo=today().slice(0,7);
  const moAll=Object.entries(records).filter(([d])=>d.startsWith(mo)).flatMap(([,d])=>Object.values(d));
  const statIn=moAll.filter(r=>r.checkIn&&!r.leaveType).length;
  const statLate=moAll.filter(r=>STATUS(r,schedule).label.startsWith("มาสาย")).length;
  const statLeave=moAll.filter(r=>r.leaveType).length;
  const statHrs=moAll.reduce((s,r)=>s+(dm(r.checkIn,r.checkOut)||0),0);

  // config status display
  const locOk = location?.lat&&location?.lng;
  const schOk = schedule?.startTime;

  return (
    <div style={{maxWidth:900,margin:"0 auto",padding:"16px 14px 40px",minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:"var(--tx)"}}>⚙ Admin Panel</div>
          <div style={{fontSize:12,color:"var(--t3)"}}>TimeClock · {user.name}</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={onReloadAll} style={{background:"var(--s2)",color:"var(--t2)",border:"1.5px solid var(--br)",padding:"7px 14px",fontSize:13}}>🔄 รีเฟรช</button>
          <button onClick={exportAll}   style={{background:"var(--blue)",color:"#fff",padding:"7px 14px",fontSize:13,fontWeight:600}}>⬇ CSV ทั้งหมด</button>
          <button onClick={onLogout}    style={{background:"var(--s2)",color:"var(--t2)",border:"1.5px solid var(--br)",padding:"7px 14px",fontSize:13}}>ออก</button>
        </div>
      </div>

      {/* Config status banners */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {[
          {ok:locOk,label:"พิกัดสำนักงาน",detail:locOk?`${location.name||"ไม่มีชื่อ"} · ${location.lat?.toFixed(4)},${location.lng?.toFixed(4)} r=${location.radius}ม.`:"⚠ ยังไม่ได้ตั้งค่า — ไปที่แท็บ 'พิกัด'",tab:"location"},
          {ok:schOk,label:"ตารางงาน",detail:schOk?`${schedule.startTime}–${schedule.endTime} ผ่อนผัน ${schedule.graceMins}น. ลา ${schedule.maxLeaveDays}วัน/ปี`:"⚠ ยังไม่ได้ตั้งค่า — ไปที่แท็บ 'ตารางงาน'",tab:"schedule"},
        ].map(b=>(
          <div key={b.tab} onClick={()=>setTab(b.tab)} className="card" style={{padding:"12px 14px",cursor:"pointer",borderColor:b.ok?"var(--br)":"rgba(251,191,36,0.4)",background:b.ok?"var(--s1)":"rgba(251,191,36,0.05)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:b.ok?"var(--green)":"var(--yellow)",display:"inline-block",flexShrink:0}}/>
              <span style={{fontSize:12,fontWeight:600,color:"var(--tx)"}}>{b.label}</span>
            </div>
            <div style={{fontSize:11,color:"var(--t2)",lineHeight:1.5}}>{b.detail}</div>
          </div>
        ))}
      </div>

      {msg&&<div style={{background:msg.ok?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)",border:`1px solid ${msg.ok?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"}`,borderRadius:10,padding:"11px 16px",marginBottom:14,fontSize:13,color:msg.ok?"var(--green)":"var(--red)"}}>
        {msg.ok?"✓":"✗"} {msg.txt}
      </div>}

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
        {[["พนักงาน",staff.length,"var(--blue)"],["เข้า/เดือน",statIn,"var(--green)"],["สาย/เดือน",statLate,"var(--yellow)"],["ลา/เดือน",statLeave,"var(--purple)"]].map(([l,v,c])=>(
          <div key={l} className="card" style={{padding:"14px 10px",textAlign:"center"}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:28,fontWeight:600,color:c,lineHeight:1}}>{v}</div>
            <div style={{fontSize:10,color:"var(--t3)",marginTop:5}}>{l}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{padding:"11px 16px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:13,color:"var(--t2)"}}>⏱ ชั่วโมงรวมทีมเดือนนี้</span>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:20,fontWeight:600,color:"var(--cyan)"}}>{hm(statHrs)}</span>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[["overview","ภาพรวม"],["employees","พนักงาน"],["location","พิกัด"],["schedule","ตารางงาน"]].map(([k,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{padding:"9px 18px",background:tab===k?"var(--blue)":"var(--s1)",color:tab===k?"#fff":"var(--t2)",border:`1.5px solid ${tab===k?"var(--blue)":"var(--br)"}`,borderRadius:9,fontSize:13,fontWeight:tab===k?600:400}}>
            {lb}
          </button>
        ))}
      </div>

      {/* ─── Overview ─── */}
      {tab==="overview"&&(
        <div className="fade">
          <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:170}}/>
            <input placeholder="ค้นหาพนักงาน..." value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:140}}/>
            <span style={{fontSize:12,color:"var(--t2)",whiteSpace:"nowrap"}}>{Object.keys(dayRecs).length}/{staff.length} คน</span>
          </div>
          <div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>พนักงาน</th><th>เข้างาน</th><th>ออกงาน</th><th>รวม</th><th>สถานะ</th></tr></thead>
              <tbody>
                {filtered.map(e=>{ const r=dayRecs[e.id]; const s=STATUS(r,schedule); return(
                  <tr key={e.id}>
                    <td><div style={{fontWeight:500}}>{e.name}</div><div style={{fontSize:11,color:"var(--t3)"}}>{e.id}</div></td>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:r?.checkIn?"var(--green)":"var(--t3)"}}>{ft(r?.checkIn)}</td>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:r?.checkOut?"var(--red)":"var(--t3)"}}>{ft(r?.checkOut)}</td>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:"var(--blue)"}}>{r?hm(dm(r.checkIn,r.checkOut)):"—"}</td>
                    <td><span className="pill" style={{background:s.bg,color:s.color,border:`1px solid ${s.color}40`,fontSize:10}}>{s.label}</span></td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Employees ─── */}
      {tab==="employees"&&(
        <div className="fade">
          <div className="card" style={{padding:18,marginBottom:14}}>
            <div style={{fontWeight:600,marginBottom:14}}>เพิ่มพนักงานใหม่</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr",gap:10,marginBottom:12}}>
              <input placeholder="รหัส (EMP003)" value={newEmp.id} onChange={e=>setNewEmp({...newEmp,id:e.target.value.toUpperCase()})}/>
              <input placeholder="ชื่อ-นามสกุล" value={newEmp.name} onChange={e=>setNewEmp({...newEmp,name:e.target.value})}/>
              <input placeholder="PIN" type="password" value={newEmp.pin} onChange={e=>setNewEmp({...newEmp,pin:e.target.value})}/>
            </div>
            <button onClick={addEmp} disabled={busy} style={{background:"var(--blue)",color:"#fff",padding:"10px 20px",fontWeight:600}}>+ เพิ่มพนักงาน</button>
          </div>
          <div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>รหัส</th><th>ชื่อ</th><th>บทบาท</th><th>ลาคงเหลือ</th><th></th></tr></thead>
              <tbody>
                {employees.map(e=>{ const used=Object.values(records).flatMap(d=>Object.entries(d)).filter(([id,r])=>id===e.id&&r.leaveType).length; const left=Math.max(0,(schedule?.maxLeaveDays||10)-used); return(
                  <tr key={e.id}>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:"var(--blue)",fontWeight:500}}>{e.id}</td>
                    <td>{e.name}</td>
                    <td><span className="pill" style={{background:e.role==="admin"?"rgba(251,191,36,0.15)":"rgba(79,142,247,0.15)",color:e.role==="admin"?"var(--yellow)":"var(--blue)",border:`1px solid ${e.role==="admin"?"rgba(251,191,36,0.3)":"rgba(79,142,247,0.3)"}`}}>{e.role==="admin"?"ผู้ดูแล":"พนักงาน"}</span></td>
                    <td style={{color:"var(--purple)",fontFamily:"'IBM Plex Mono',monospace"}}>{left}/{schedule?.maxLeaveDays||10}</td>
                    <td>{e.id!==user.id&&<button onClick={()=>delEmp(e.id)} disabled={busy} style={{background:"rgba(248,113,113,0.15)",color:"var(--red)",border:"1px solid rgba(248,113,113,0.3)",padding:"4px 10px",fontSize:12}}>ลบ</button>}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Location ─── */}
      {tab==="location"&&(
        <div className="fade">
          {/* current status */}
          <div className="card" style={{padding:"14px 16px",marginBottom:14,background:locOk?"rgba(74,222,128,0.05)":"rgba(251,191,36,0.05)",borderColor:locOk?"rgba(74,222,128,0.3)":"rgba(251,191,36,0.4)"}}>
            <div style={{fontSize:12,fontWeight:600,color:locOk?"var(--green)":"var(--yellow)",marginBottom:6}}>{locOk?"✓ ตั้งค่าแล้ว":"⚠ ยังไม่ได้ตั้งค่าพิกัด"}</div>
            {locOk?<div style={{fontSize:12,color:"var(--t2)",lineHeight:1.8}}>
              <div>📍 {location.name}</div>
              <div>Lat: {location.lat} · Lng: {location.lng}</div>
              <div>รัศมี: {location.radius} เมตร</div>
            </div>:<div style={{fontSize:12,color:"var(--t3)"}}>พนักงานจะไม่สามารถเช็คอินได้จนกว่าจะตั้งค่าพิกัด</div>}
          </div>

          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,marginBottom:16}}>แก้ไขพิกัดสำนักงาน</div>
            <div style={{display:"grid",gap:13}}>
              <div><label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>ชื่อสถานที่</label><input value={lf.name} onChange={e=>setLf({...lf,name:e.target.value})} placeholder="ออฟฟิศบางแก้ว"/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>Latitude</label><input type="number" step="0.00001" value={lf.lat} onChange={e=>setLf({...lf,lat:e.target.value})}/></div>
                <div><label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>Longitude</label><input type="number" step="0.00001" value={lf.lng} onChange={e=>setLf({...lf,lng:e.target.value})}/></div>
              </div>
              <div>
                <label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>รัศมีที่อนุญาต: <strong style={{color:"var(--tx)"}}>{lf.radius} เมตร</strong></label>
                <input type="range" min="50" max="1000" step="25" value={lf.radius} onChange={e=>setLf({...lf,radius:e.target.value})} style={{width:"100%",accentColor:"var(--blue)",background:"transparent",border:"none"}}/>
              </div>
            </div>
            <button onClick={saveLoc} disabled={busy} style={{marginTop:16,background:"var(--blue)",color:"#fff",padding:"11px 24px",fontWeight:600}}>บันทึกพิกัด</button>
            <div style={{marginTop:14,background:"var(--s2)",borderRadius:8,padding:"12px 14px",fontSize:12,color:"var(--t2)",lineHeight:2}}>
              <div style={{fontWeight:600,marginBottom:4}}>📍 วิธีหาพิกัด:</div>
              <div>1. เปิด Google Maps → ค้นหา Q5WC+5PW นครชัยศรี</div>
              <div>2. กดค้างที่ตำแหน่ง → พิกัดจะขึ้นด้านล่าง เช่น 13.795, 100.161</div>
              <div>3. ใส่ในช่อง Lat/Lng แล้วกดบันทึก</div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Schedule ─── */}
      {tab==="schedule"&&(
        <div className="fade">
          {/* current status */}
          <div className="card" style={{padding:"14px 16px",marginBottom:14,background:schOk?"rgba(74,222,128,0.05)":"rgba(251,191,36,0.05)",borderColor:schOk?"rgba(74,222,128,0.3)":"rgba(251,191,36,0.4)"}}>
            <div style={{fontSize:12,fontWeight:600,color:schOk?"var(--green)":"var(--yellow)",marginBottom:6}}>{schOk?"✓ ตั้งค่าแล้ว":"⚠ ยังไม่ได้ตั้งค่า"}</div>
            {schOk?<div style={{fontSize:12,color:"var(--t2)",lineHeight:1.8}}>
              <div>🕐 เวลางาน: {schedule.startTime} – {schedule.endTime}</div>
              <div>⚡ ผ่อนผันมาสาย: {schedule.graceMins} นาที (นับสายหลัง {addMins(schedule.startTime,+schedule.graceMins)})</div>
              <div>📋 วันลาสูงสุด: {schedule.maxLeaveDays} วัน/ปี/คน</div>
            </div>:<div style={{fontSize:12,color:"var(--t3)"}}>ระบบจะใช้ค่า default: 08:30–17:30 ผ่อนผัน 15 น.</div>}
          </div>

          <div className="card" style={{padding:20}}>
            <div style={{fontWeight:600,marginBottom:16}}>แก้ไขตารางงาน</div>
            <div style={{display:"grid",gap:14}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>เวลาเข้างาน</label><input type="time" value={sf.startTime} onChange={e=>setSf({...sf,startTime:e.target.value})}/></div>
                <div><label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>เวลาออกงาน</label><input type="time" value={sf.endTime} onChange={e=>setSf({...sf,endTime:e.target.value})}/></div>
              </div>
              <div>
                <label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>ระยะผ่อนผันมาสาย: <strong style={{color:"var(--tx)"}}>{sf.graceMins} นาที</strong></label>
                <input type="range" min="0" max="60" step="5" value={sf.graceMins} onChange={e=>setSf({...sf,graceMins:e.target.value})} style={{width:"100%",accentColor:"var(--yellow)",background:"transparent",border:"none"}}/>
              </div>
              <div>
                <label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:7}}>วันลาสูงสุดต่อปี (ต่อคน): <strong style={{color:"var(--tx)"}}>{sf.maxLeaveDays} วัน</strong></label>
                <input type="range" min="1" max="30" step="1" value={sf.maxLeaveDays} onChange={e=>setSf({...sf,maxLeaveDays:e.target.value})} style={{width:"100%",accentColor:"var(--purple)",background:"transparent",border:"none"}}/>
              </div>
              <div>
                <label style={{fontSize:12,color:"var(--t2)",display:"block",marginBottom:10}}>วันทำงาน</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["อา","จ","อ","พ","พฤ","ศ","ส"].map((d,i)=>{
                    const days=sf.workDays.split(",").filter(Boolean).map(Number);
                    const on=days.includes(i);
                    return <button key={i} onClick={()=>{ const n=on?days.filter(x=>x!==i):[...days,i].sort(); setSf({...sf,workDays:n.join(",")}); }} style={{width:44,height:44,borderRadius:9,background:on?"var(--blue)":"var(--s2)",color:on?"#fff":"var(--t3)",border:`1.5px solid ${on?"var(--blue)":"var(--br)"}`,fontWeight:on?600:400}}>{d}</button>;
                  })}
                </div>
              </div>
            </div>

            {/* Preview */}
            <div style={{marginTop:16,background:"var(--s2)",borderRadius:10,padding:"14px 16px",fontSize:13,color:"var(--t2)",lineHeight:2,borderLeft:"3px solid var(--blue)"}}>
              <div style={{fontWeight:600,color:"var(--tx)",marginBottom:4}}>ตัวอย่างผล</div>
              <div>มาถึง {sf.startTime} → <span style={{color:"var(--green)"}}>ตรงเวลา ✓</span></div>
              <div>มาถึง {addMins(sf.startTime,+sf.graceMins+1)} → <span style={{color:"var(--yellow)"}}>มาสาย {+sf.graceMins+1} นาที ⚡</span></div>
              <div>ออก {sf.endTime} → <span style={{color:"var(--green)"}}>ครบเวลา ✓</span></div>
            </div>

            <button onClick={saveSch} disabled={busy} style={{marginTop:16,background:"var(--blue)",color:"#fff",padding:"11px 24px",fontWeight:600}}>บันทึกตารางงาน</button>
          </div>
        </div>
      )}
    </div>
  );
}