import { useState, useEffect, useRef } from "react";

const API = "https://script.google.com/macros/s/AKfycbyk5pFcfXtuZm0wUFqswrQxzvgOOkMb9jTViCbktmH7KzIUGr6zhE6pzKMUsS2vUK7x/exec";

const call = async (action, params = {}) => {
  try {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const r = await fetch(`${API}?${qs}`, { redirect: "follow" });
    return JSON.parse(await r.text());
  } catch (e) { return { success: false, message: String(e) }; }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const haversine = (a,b,c,d) => {
  const R=6371000,dL=((c-a)*Math.PI)/180,dO=((d-b)*Math.PI)/180;
  const x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dO/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
};
const today  = () => new Date().toISOString().slice(0,10);
const ft     = iso => { if(!iso) return "—"; try{return new Date(iso).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}catch{return iso}};
const fd     = s   => { if(!s)  return "—"; try{const d=String(s).length===10?new Date(s+"T00:00:00"):new Date(s);return isNaN(d)?"—":d.toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"2-digit"})}catch{return s}};
const dm     = (a,b)=>{ if(!a||!b) return null; const v=Math.round((new Date(b)-new Date(a))/60000); return v<0?null:v; };
const hm     = m   => { if(m==null||m<0) return "—"; return `${Math.floor(m/60)}:${String(m%60).padStart(2,"0")}`; };
const addMin = (t,n)=>{ const[h,m]=t.split(":").map(Number),x=h*60+m+n; return`${String(Math.floor(x/60)).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`; };

// per-employee schedule fallback to global
const sch = (emp, g) => ({
  startTime:    emp?.workStart    || g?.startTime    || "08:30",
  endTime:      emp?.workEnd      || g?.endTime      || "17:30",
  graceMins:    emp?.graceMins   != null ? +emp.graceMins    : (g?.graceMins    ?? 15),
  workDays:     emp?.workDays     || g?.workDays     || "1,2,3,4,5",
  maxLeaveDays: emp?.maxLeaveDays != null ? +emp.maxLeaveDays : (g?.maxLeaveDays ?? 10),
});

const STATUS = (rec, s) => {
  if(!rec)          return {l:"ขาดงาน",     c:"#fca5a5",bg:"rgba(252,165,165,.15)",dot:"#ef4444"};
  if(rec.leaveType) return {l:{sick:"ลาป่วย",personal:"ลากิจ",vacation:"ลาพักร้อน"}[rec.leaveType]||"ลา",c:"#ddd6fe",bg:"rgba(221,214,254,.15)",dot:"#8b5cf6"};
  if(!rec.checkIn)  return {l:"ขาดงาน",     c:"#fca5a5",bg:"rgba(252,165,165,.15)",dot:"#ef4444"};
  if(!rec.checkOut) return {l:"กำลังทำงาน", c:"#6ee7b7",bg:"rgba(110,231,183,.15)",dot:"#10b981"};
  const cin=new Date(rec.checkIn),cout=new Date(rec.checkOut);
  const cM=cin.getHours()*60+cin.getMinutes(),oM=cout.getHours()*60+cout.getMinutes();
  const[sh,sm]=s.startTime.split(":").map(Number),[eh,em]=s.endTime.split(":").map(Number);
  const late=cM>sh*60+sm+s.graceMins, early=oM<eh*60+em-10;
  if(late&&early) return {l:"สาย+ออกก่อน",c:"#fdba74",bg:"rgba(253,186,116,.15)",dot:"#f97316"};
  if(late)        return {l:`มาสาย ${cM-(sh*60+sm)}น.`,c:"#fde68a",bg:"rgba(253,230,138,.15)",dot:"#f59e0b"};
  if(early)       return {l:"ออกก่อนเวลา",c:"#fdba74",bg:"rgba(253,186,116,.15)",dot:"#f97316"};
  return             {l:"ปกติ ✓",c:"#6ee7b7",bg:"rgba(110,231,183,.15)",dot:"#22c55e"};
};

// ─── Animated BG ──────────────────────────────────────────────────────────────
function AnimBG() {
  const cvs = useRef(null);
  useEffect(() => {
    const c = cvs.current; if(!c) return;
    const ctx = c.getContext("2d");
    let W, H, items=[], raf;
    const CHARS = ["🐾","🐾","🐾","🐕","🐈","💉","🩺","✦","✦","⬡","·"];
    const resize = () => { W=c.width=window.innerWidth; H=c.height=window.innerHeight; };
    resize(); window.addEventListener("resize",resize);
    for(let i=0;i<28;i++) items.push({
      x:Math.random()*window.innerWidth,y:Math.random()*window.innerHeight,
      vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.22,
      a:Math.random()*Math.PI*2,va:(Math.random()-.5)*.007,
      s:8+Math.random()*20,op:0.035+Math.random()*.09,
      ch:CHARS[Math.floor(Math.random()*CHARS.length)]
    });
    const draw = () => {
      ctx.clearRect(0,0,W,H);
      const g=ctx.createRadialGradient(W*.3,H*.2,0,W*.5,H*.5,W*.85);
      g.addColorStop(0,"rgba(5,78,59,.97)"); g.addColorStop(.45,"rgba(3,46,44,.98)"); g.addColorStop(1,"rgba(2,24,36,.99)");
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
      const g2=ctx.createRadialGradient(W*.75,H*.65,0,W*.75,H*.65,W*.35);
      g2.addColorStop(0,"rgba(16,78,50,.45)"); g2.addColorStop(1,"transparent");
      ctx.fillStyle=g2; ctx.fillRect(0,0,W,H);
      items.forEach(p=>{
        p.x+=p.vx; p.y+=p.vy; p.a+=p.va;
        if(p.x<-60) p.x=W+40; if(p.x>W+60) p.x=-40;
        if(p.y<-60) p.y=H+40; if(p.y>H+60) p.y=-40;
        ctx.save(); ctx.globalAlpha=p.op; ctx.translate(p.x,p.y); ctx.rotate(p.a);
        ctx.font=`${p.s}px serif`; ctx.textAlign="center"; ctx.fillText(p.ch,0,0); ctx.restore();
      });
      raf=requestAnimationFrame(draw);
    };
    draw();
    return()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",resize); };
  },[]);
  return <canvas ref={cvs} style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none"}}/>;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --gl:rgba(255,255,255,.07);--gl2:rgba(255,255,255,.11);--glb:rgba(255,255,255,.16);
  --green:#6ee7b7;--teal:#2dd4bf;--cyan:#67e8f9;--mint:#a7f3d0;
  --w:rgba(255,255,255,.92);--m:rgba(255,255,255,.48);--dim:rgba(255,255,255,.2);
  --red:#fca5a5;--yellow:#fde68a;--purple:#ddd6fe;--orange:#fdba74;--acc:#34d399;
}
body{background:#021a26;color:var(--w);font-family:'Noto Sans Thai',sans-serif;font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
::selection{background:rgba(52,211,153,.3)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(52,211,153,.3);border-radius:2px}
.g{background:var(--gl);border:1px solid var(--glb);border-radius:16px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.g2{background:var(--gl2);border:1px solid var(--glb);border-radius:12px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
input,select,textarea{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);color:var(--w);padding:10px 14px;border-radius:10px;font-family:'Noto Sans Thai',sans-serif;font-size:14px;width:100%;outline:none;transition:border .15s,background .15s}
input:focus,select:focus,textarea:focus{border-color:var(--acc);background:rgba(255,255,255,.11)}
input::placeholder,textarea::placeholder{color:var(--dim)}
select option{background:#0f3028;color:var(--w)}
button{cursor:pointer;font-family:'Noto Sans Thai',sans-serif;border:none;border-radius:10px;transition:all .15s;font-size:14px;font-weight:500}
button:hover{filter:brightness(1.1);transform:translateY(-1px)}
button:active{transform:scale(.97) translateY(0)}
.pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:500}
.fade{animation:fd .22s ease}
@keyframes fd{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.spin{animation:sp .9s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes shake{0%,100%{transform:translateX(0)}30%,70%{transform:translateX(-6px)}50%{transform:translateX(6px)}}
table{border-collapse:collapse;width:100%}
th{padding:10px 14px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--teal);background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.1);font-weight:600}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.06);color:var(--w)}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.03)}
input[type=range]{accent-color:var(--acc);background:transparent;border:none;padding:4px 0}
.lbl{font-size:12px;color:var(--m);display:block;margin-bottom:7px;font-weight:500}
.section-title{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--teal);font-weight:600;margin-bottom:14px}
`;

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg }) {
  if(!msg) return null;
  return (
    <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:9999,
      background:msg.ok?"rgba(16,185,129,.9)":"rgba(239,68,68,.9)",
      backdropFilter:"blur(12px)",color:"#fff",padding:"11px 22px",borderRadius:40,
      fontSize:13,fontWeight:500,boxShadow:"0 4px 24px rgba(0,0,0,.4)",
      animation:"fd .2s ease",whiteSpace:"nowrap",maxWidth:"90vw",textAlign:"center"}}>
      {msg.ok ? "✓ " : "✗ "}{msg.txt}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [employees,setEmp]   = useState([]);
  const [records,  setRec]   = useState({});
  const [location, setLoc]   = useState(null);
  const [gSch,     setGSch]  = useState(null);
  const [clinic,   setClinic]= useState(null);
  const [user,     setUser]  = useState(null);
  const [view,     setView]  = useState("login");
  const [loading,  setLoad]  = useState(true);
  const [err,      setErr]   = useState("");
  const [toast,    setToast] = useState(null);

  const showToast = (ok,txt) => { setToast({ok,txt}); setTimeout(()=>setToast(null),4000); };

  const loadAll = async () => {
    setLoad(true); setErr("");
    const [er,rr,cr] = await Promise.all([call("getEmployees"),call("getRecords"),call("getConfig")]);
    if(!er.success){ setErr("เชื่อมต่อ Google Sheet ไม่สำเร็จ"); setLoad(false); return; }
    setEmp(er.data||[]);
    if(rr.success) setRec(rr.data||{});
    if(cr.success){ setLoc(cr.data?.location||null); setGSch(cr.data?.schedule||null); setClinic(cr.data?.clinic||null); }
    setLoad(false);
  };
  useEffect(()=>{ loadAll(); },[]);
  const reloadRec = async () => { const r=await call("getRecords"); if(r.success) setRec(r.data||{}); };
  const reloadEmp = async () => { const r=await call("getEmployees"); if(r.success) setEmp(r.data||[]); };
  const login  = u => { setUser(u); setView(u.role==="admin"?"admin":"dash"); };
  const logout = () => { setUser(null); setView("login"); };

  if(loading) return (
    <><style>{CSS}</style><AnimBG/>
      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:16}}>
        <div style={{width:44,height:44,border:"3px solid rgba(255,255,255,.1)",borderTopColor:"#34d399",borderRadius:"50%"}} className="spin"/>
        <div style={{color:"var(--m)",fontSize:13,letterSpacing:2}}>TANA VET — กำลังโหลด...</div>
      </div>
    </>
  );

  return (
    <><style>{CSS}</style><AnimBG/>
      <Toast msg={toast}/>
      <div style={{position:"relative",zIndex:1}}>
        {view==="login" && <Login employees={employees} err={err} clinic={clinic} onLogin={login} onRetry={loadAll}/>}
        {view==="dash"  && <Dash  user={user} empList={employees} records={records} location={location} gSch={gSch} clinic={clinic} onReloadRec={reloadRec} onReloadEmp={reloadEmp} onLogout={logout} showToast={showToast}/>}
        {view==="admin" && <AdminPanel user={user} employees={employees} records={records} location={location} gSch={gSch} clinic={clinic} onReloadAll={loadAll} onLogout={logout} showToast={showToast}/>}
      </div>
    </>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({ employees, err, clinic, onLogin, onRetry }) {
  const [id,setId]=useState(""); const [pin,setPin]=useState("");
  const [error,setError]=useState(""); const [shake,setShake]=useState(false);
  const [now,setNow]=useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);
  const go = () => {
    const u=employees.find(e=>e.id===id.trim().toUpperCase()&&String(e.pin)===String(pin));
    if(u) onLogin(u);
    else{ setError("รหัสพนักงานหรือ PIN ไม่ถูกต้อง"); setShake(true); setTimeout(()=>setShake(false),500); }
  };
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{width:"100%",maxWidth:380,animation:shake?"shake .4s":""}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:76,height:76,background:"rgba(52,211,153,.15)",border:"2px solid rgba(52,211,153,.45)",borderRadius:22,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:38,boxShadow:"0 0 40px rgba(52,211,153,.25)"}}>🐾</div>
          <div style={{fontSize:22,fontWeight:700,letterSpacing:.5}}>{clinic?.name||"คลินิคท่านาสัตวแพทย์"}</div>
          <div style={{color:"var(--m)",fontSize:11,marginTop:3,letterSpacing:3}}>STAFF PORTAL</div>
          <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:44,fontWeight:500,color:"var(--teal)",marginTop:16,letterSpacing:3,textShadow:"0 0 24px rgba(45,212,191,.4)"}}>
            {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
          </div>
          <div style={{color:"var(--m)",fontSize:12,marginTop:5}}>{now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
        </div>
        <div className="g" style={{padding:"28px 32px"}}>
          {err&&<div style={{background:"rgba(252,165,165,.1)",border:"1px solid rgba(252,165,165,.3)",borderRadius:9,padding:"10px 14px",marginBottom:16,fontSize:12,color:"var(--red)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>⚠ {err}</span>
            <button onClick={onRetry} style={{background:"none",color:"var(--teal)",border:"1px solid rgba(45,212,191,.4)",padding:"3px 10px",fontSize:11,borderRadius:7}}>ลองใหม่</button>
          </div>}
          <div style={{marginBottom:14}}>
            <label className="lbl">รหัสพนักงาน</label>
            <input placeholder="MAX" value={id} onChange={e=>setId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} style={{textTransform:"uppercase"}}/>
          </div>
          <div style={{marginBottom:20}}>
            <label className="lbl">รหัส PIN</label>
            <input type="password" placeholder="••••" value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/>
          </div>
          {error&&<div style={{background:"rgba(252,165,165,.1)",border:"1px solid rgba(252,165,165,.25)",borderRadius:9,padding:"10px 14px",marginBottom:16,fontSize:13,color:"var(--red)"}}>✗ {error}</div>}
          <button onClick={go} style={{width:"100%",padding:13,background:"linear-gradient(135deg,#059669,#0d9488)",color:"#fff",fontWeight:600,fontSize:15,borderRadius:10,boxShadow:"0 4px 20px rgba(5,150,105,.3)"}}>
            เข้าสู่ระบบ
          </button>
          {employees.length===0&&<div style={{marginTop:12,textAlign:"center",fontSize:11,color:"var(--dim)"}}>⚠ ไม่พบข้อมูลพนักงาน — เช็ค Google Sheet</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Dash ─────────────────────────────────────────────────────────────────────
function Dash({ user, empList, records, location, gSch, clinic, onReloadRec, onReloadEmp, onLogout, showToast }) {
  const [tab,setTab]   = useState("checkin");
  const [gps,setGps]   = useState("idle");
  const [gd,setGd]     = useState(null);
  const [gMsg,setGMsg] = useState("");
  const [busy,setBusy] = useState(false);
  const [lf,setLf]     = useState({type:"sick",start:today(),end:today(),reason:""});
  const [now,setNow]   = useState(new Date());
  // profile
  const [pf,setPf]     = useState({});
  const [newPin,setNewPin]   = useState(""); const [cfPin,setCfPin] = useState(""); const [showPin,setShowPin]=useState(false);
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);

  const me = empList.find(e=>e.id===user.id)||user;
  useEffect(()=>{ setPf({email:me.email||"",phone:me.phone||"",note:me.note||"",avatar:me.avatar||""}); },[me.id]);

  const s  = sch(me, gSch);
  const todRec = records[today()]?.[user.id];
  const st     = STATUS(todRec, s);
  const myRecs = Object.entries(records).flatMap(([d,r])=>r[user.id]?[{date:d,...r[user.id]}]:[]).sort((a,b)=>b.date.localeCompare(a.date));
  const mo=today().slice(0,7), yr=today().slice(0,4);
  const moRecs = myRecs.filter(r=>r.date.startsWith(mo));
  const leaveUsed = myRecs.filter(r=>r.leaveType&&r.date.startsWith(yr)).length;
  const leaveLeft = Math.max(0,s.maxLeaveDays-leaveUsed);
  const moHrs = moRecs.reduce((x,r)=>x+(dm(r.checkIn,r.checkOut)||0),0);

  const checkGPS = () => {
    setGps("checking"); setGMsg("");
    if(!navigator.geolocation){ setGps("err"); setGMsg("เบราว์เซอร์ไม่รองรับ GPS"); return; }
    navigator.geolocation.getCurrentPosition(pos=>{
      const{latitude:lat,longitude:lng,accuracy:acc}=pos.coords;
      if(!location?.lat||!location?.lng){ setGps("ok"); setGd({lat,lng,acc,dist:0}); setGMsg("✓ รับพิกัดสำเร็จ"); return; }
      const dist=haversine(lat,lng,+location.lat,+location.lng);
      setGd({lat,lng,acc,dist});
      dist<=(+location.radius||200)?(setGps("ok"),setGMsg(`✓ อยู่ในพื้นที่ (ห่าง ${Math.round(dist)} ม.)`)):(setGps("far"),setGMsg(`✗ นอกพื้นที่ (ห่าง ${Math.round(dist)} ม.)`));
    },()=>{ setGps("err"); setGMsg("ไม่ได้รับสัญญาณ — กรุณาอนุญาต GPS"); },{enableHighAccuracy:true,timeout:14000});
  };

  const doIn  = async () => {
    if(gps!=="ok"||busy) return; setBusy(true);
    const r=await call("checkIn",{date:today(),empId:user.id,time:new Date().toISOString(),lat:gd.lat,lng:gd.lng});
    r.success?(await onReloadRec(),showToast(true,"เช็คอินสำเร็จ ✓ "+ft(new Date().toISOString()))):showToast(false,r.message);
    setBusy(false);
  };
  const doOut = async () => {
    if(gps!=="ok"||busy) return; setBusy(true);
    const r=await call("checkOut",{date:today(),empId:user.id,time:new Date().toISOString(),lat:gd.lat,lng:gd.lng});
    r.success?(await onReloadRec(),showToast(true,"เช็คเอาท์สำเร็จ ✓ "+ft(new Date().toISOString()))):showToast(false,r.message);
    setBusy(false);
  };
  const doLeave = async () => {
    if(!lf.reason.trim()){ showToast(false,"กรุณาระบุเหตุผล"); return; }
    setBusy(true);
    const r=await call("submitLeave",{empId:user.id,startDate:lf.start,endDate:lf.end,leaveType:lf.type,reason:lf.reason});
    r.success?(await onReloadRec(),showToast(true,`ส่งคำขอลาสำเร็จ (${r.days} วัน)`)):showToast(false,r.message);
    setBusy(false);
  };
  const saveProfile = async () => {
    setBusy(true);
    const r=await call("updateEmployee",{id:user.id,...pf});
    r.success?(await onReloadEmp(),showToast(true,"บันทึกโปรไฟล์สำเร็จ")):showToast(false,r.message);
    setBusy(false);
  };
  const changePIN = async () => {
    if(newPin.length<4){ showToast(false,"PIN ต้องมีอย่างน้อย 4 ตัว"); return; }
    if(newPin!==cfPin){  showToast(false,"PIN ทั้งสองไม่ตรงกัน"); return; }
    setBusy(true);
    const r=await call("updateEmployee",{id:user.id,pin:newPin});
    r.success?(await onReloadEmp(),showToast(true,"เปลี่ยน PIN สำเร็จ"),setNewPin(""),setCfPin(""),setShowPin(false)):showToast(false,r.message);
    setBusy(false);
  };
  const exportCSV = () => {
    const rows=[["วันที่","เข้างาน","ออกงาน","รวม (ชม:น.)","สถานะ"]];
    myRecs.forEach(r=>{ const st2=STATUS(r,s); rows.push([r.date,ft(r.checkIn),ft(r.checkOut),hm(dm(r.checkIn,r.checkOut)),st2.l]); });
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(x=>x.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));
    a.download=`attendance_${user.id}_${today()}.csv`; a.click();
  };

  const gCol={idle:"var(--dim)",checking:"var(--yellow)",ok:"var(--green)",err:"var(--red)",far:"var(--red)"}[gps];
  const canIn =gps==="ok"&&!todRec?.checkIn&&!todRec?.leaveType&&!busy;
  const canOut=gps==="ok"&&!!todRec?.checkIn&&!todRec?.checkOut&&!busy;
  const DAYS_TH=["อา","จ","อ","พ","พฤ","ศ","ส"];
  const myWorkDays = s.workDays.split(",").filter(Boolean).map(Number);

  return (
    <div style={{maxWidth:520,margin:"0 auto",padding:"14px 14px 60px"}}>
      {/* Topbar */}
      <div className="g2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:38,height:38,background:"rgba(52,211,153,.18)",border:"1.5px solid rgba(52,211,153,.35)",borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{me.avatar||"🐾"}</div>
          <div>
            <div style={{fontSize:14,fontWeight:600,lineHeight:1.3}}>{me.name}</div>
            <div style={{fontSize:11,color:"var(--m)"}}>{me.position||me.id}{me.department?` · ${me.department}`:""}</div>
          </div>
        </div>
        <button onClick={onLogout} style={{background:"rgba(255,255,255,.08)",color:"var(--m)",border:"1px solid rgba(255,255,255,.15)",padding:"7px 14px",fontSize:12}}>ออก</button>
      </div>

      {/* Clock card */}
      <div className="g" style={{padding:"20px 20px 16px",marginBottom:12,textAlign:"center",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#059669,#0d9488,#059669)"}}/>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:46,fontWeight:500,color:"var(--teal)",letterSpacing:4,lineHeight:1,textShadow:"0 0 28px rgba(45,212,191,.35)"}}>
          {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
        </div>
        <div style={{color:"var(--m)",fontSize:12,marginTop:5}}>{now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginTop:12}}>
          <span className="pill" style={{background:st.bg,color:st.c,border:`1px solid ${st.c}40`}}>{st.l}</span>
          {todRec?.checkIn&&<span className="pill" style={{background:"rgba(110,231,183,.12)",color:"var(--green)",border:"1px solid rgba(110,231,183,.3)"}}>เข้า {ft(todRec.checkIn)}</span>}
          {todRec?.checkOut&&<span className="pill" style={{background:"rgba(252,165,165,.12)",color:"var(--red)",border:"1px solid rgba(252,165,165,.3)"}}>ออก {ft(todRec.checkOut)}</span>}
        </div>
        <div className="g2" style={{margin:"12px 0 0",padding:"8px 14px",display:"flex",flexWrap:"wrap",gap:12,justifyContent:"center",borderRadius:10,fontSize:12,color:"var(--m)"}}>
          <span>🕐 {s.startTime}–{s.endTime}</span>
          <span>⚡ ผ่อนผัน {s.graceMins}น.</span>
          {location?.name&&<span>📍 {location.name}</span>}
          <span style={{color:"var(--dim)"}}>{myWorkDays.map(d=>DAYS_TH[d]).join(" ")}</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
        {[["เข้างาน",moRecs.filter(r=>r.checkIn&&!r.leaveType).length,"var(--green)"],
          ["มาสาย",moRecs.filter(r=>STATUS(r,s).l.startsWith("มาสาย")).length,"var(--yellow)"],
          ["ลาแล้ว",leaveUsed,"var(--purple)"],
          ["ลาคงเหลือ",leaveLeft,"var(--cyan)"]].map(([l,v,c])=>(
          <div key={l} className="g2" style={{padding:"11px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:22,fontWeight:600,color:c,lineHeight:1}}>{v}</div>
            <div style={{fontSize:9,color:"var(--m)",marginTop:5,lineHeight:1.3}}>{l}</div>
          </div>
        ))}
      </div>
      <div className="g2" style={{padding:"10px 16px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:12,color:"var(--m)"}}>⏱ ชั่วโมงรวมเดือนนี้</span>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:18,fontWeight:600,color:"var(--teal)"}}>{hm(moHrs)}</span>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
        {[["checkin","🕐","เช็คอิน"],["history","📋","ประวัติ"],["leave","🌿","ใบลา"],["profile","👤","โปรไฟล์"]].map(([k,ic,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:"0 0 auto",padding:"8px 16px",background:tab===k?"rgba(52,211,153,.25)":"var(--gl)",color:tab===k?"var(--acc)":"var(--m)",border:`1px solid ${tab===k?"rgba(52,211,153,.5)":"var(--glb)"}`,borderRadius:10,fontSize:13,backdropFilter:"blur(10px)"}}>
            {ic} {lb}
          </button>
        ))}
      </div>

      {/* ── CHECKIN ── */}
      {tab==="checkin"&&(
        <div className="fade">
          <div className="g2" style={{padding:16,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:gMsg?10:0}}>
              <span style={{fontSize:13,color:"var(--m)"}}>📡 ตรวจสอบพิกัด{location?.name?` · ${location.name}`:""}</span>
              <span style={{fontSize:11,color:gCol,fontWeight:500}}>{{idle:"รอ",checking:"รับสัญญาณ...",ok:"✓ พร้อม",err:"✗ ผิดพลาด",far:"✗ นอกพื้นที่"}[gps]}</span>
            </div>
            {gMsg&&<div style={{fontSize:12,color:gCol,background:`${gCol}18`,border:`1px solid ${gCol}30`,borderRadius:8,padding:"8px 12px",marginBottom:10}}>{gMsg}</div>}
            <button onClick={checkGPS} disabled={gps==="checking"} style={{width:"100%",padding:10,background:"rgba(255,255,255,.07)",color:gps==="checking"?"var(--yellow)":"var(--w)",border:"1px solid rgba(255,255,255,.18)",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontSize:13}}>
              <span className={gps==="checking"?"spin":""}>📍</span>
              {gps==="checking"?"กำลังรับสัญญาณ...":"ตรวจสอบพิกัดของฉัน"}
            </button>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            {[
              {lb:"เช็คอิน",ic:"→",can:canIn,done:!!todRec?.checkIn,time:todRec?.checkIn,c:"#6ee7b7",bg:"rgba(110,231,183,.15)",br:"rgba(110,231,183,.35)",fn:doIn},
              {lb:"เช็คเอาท์",ic:"←",can:canOut,done:!!todRec?.checkOut,time:todRec?.checkOut,c:"#fca5a5",bg:"rgba(252,165,165,.15)",br:"rgba(252,165,165,.35)",fn:doOut},
            ].map(b=>(
              <button key={b.lb} onClick={b.fn} disabled={!b.can} style={{padding:"22px 12px",borderRadius:14,textAlign:"center",background:b.can?b.bg:"rgba(255,255,255,.04)",color:b.can?b.c:"var(--dim)",border:`1.5px solid ${b.can?b.br:"rgba(255,255,255,.1)"}`,opacity:b.done&&!b.can?.55:1,boxShadow:b.can?`0 0 24px ${b.c}20`:"none"}}>
                <div style={{fontSize:30,marginBottom:8}}>{b.ic}</div>
                <div style={{fontWeight:600,fontSize:15}}>{b.lb}</div>
                {b.done&&<div style={{fontSize:11,marginTop:5,opacity:.7}}>{ft(b.time)}</div>}
                {busy&&<div style={{fontSize:10,marginTop:4,color:"var(--dim)"}}>กำลังบันทึก...</div>}
              </button>
            ))}
          </div>
          <button onClick={()=>setTab("leave")} style={{width:"100%",padding:11,background:"rgba(221,214,254,.1)",color:"var(--purple)",border:"1.5px solid rgba(221,214,254,.3)",fontSize:13}}>
            🌿 ส่งคำขอลา ({leaveLeft} วันคงเหลือ)
          </button>
          {gps==="idle"&&<div style={{textAlign:"center",fontSize:12,color:"var(--dim)",marginTop:12}}>กดตรวจสอบพิกัดก่อนเช็คอิน/เอาท์</div>}
        </div>
      )}

      {/* ── HISTORY ── */}
      {tab==="history"&&(
        <div className="fade">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:12,color:"var(--m)"}}>{myRecs.length} รายการ · เดือนนี้ {hm(moHrs)}</span>
            <button onClick={exportCSV} style={{background:"rgba(52,211,153,.2)",color:"var(--acc)",border:"1px solid rgba(52,211,153,.3)",padding:"7px 14px",fontSize:12,fontWeight:600}}>⬇ CSV</button>
          </div>
          {myRecs.length===0?<div style={{textAlign:"center",padding:60,color:"var(--dim)"}}>ยังไม่มีประวัติ</div>
          :<div className="g" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>วันที่</th><th>เข้า</th><th>ออก</th><th>รวม</th><th>สถานะ</th></tr></thead>
              <tbody>
                {myRecs.map(r=>{ const st2=STATUS(r,s); return(
                  <tr key={r.date}>
                    <td style={{fontSize:11,color:"var(--m)"}}>{fd(r.date)}</td>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:"var(--green)"}}>{ft(r.checkIn)}</td>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:r.checkOut?"var(--red)":"var(--dim)"}}>{ft(r.checkOut)}</td>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:"var(--teal)"}}>{hm(dm(r.checkIn,r.checkOut))}</td>
                    <td><span className="pill" style={{background:st2.bg,color:st2.c,border:`1px solid ${st2.c}40`,fontSize:10}}>{st2.l}</span></td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>}
        </div>
      )}

      {/* ── LEAVE ── */}
      {tab==="leave"&&(
        <div className="fade">
          <div className="g" style={{padding:20,marginBottom:14}}>
            <div className="section-title">ส่งคำขอลา</div>
            <div style={{display:"grid",gap:12}}>
              <div><label className="lbl">ประเภทการลา</label>
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
              <div><label className="lbl">เหตุผล</label>
                <textarea rows={3} value={lf.reason} onChange={e=>setLf({...lf,reason:e.target.value})} placeholder="ระบุเหตุผล..." style={{resize:"vertical"}}/>
              </div>
            </div>
            <button onClick={doLeave} disabled={busy} style={{marginTop:14,width:"100%",padding:12,background:"linear-gradient(135deg,#5b21b6,#7c3aed)",color:"#fff",fontWeight:600}}>
              {busy?"กำลังส่ง...":"ส่งคำขอลา"}
            </button>
          </div>
          <div style={{fontSize:12,color:"var(--m)",marginBottom:10}}>ประวัติการลา {leaveUsed}/{s.maxLeaveDays} วัน/ปีนี้</div>
          <div className="g" style={{overflow:"hidden"}}>
            {myRecs.filter(r=>r.leaveType).length===0
              ?<div style={{padding:30,textAlign:"center",color:"var(--dim)",fontSize:13}}>ยังไม่มีประวัติการลา</div>
              :<table>
                <thead><tr><th>วันที่</th><th>ประเภท</th><th>เหตุผล</th></tr></thead>
                <tbody>
                  {myRecs.filter(r=>r.leaveType).map(r=>{ const st2=STATUS(r,s); return(
                    <tr key={r.date}>
                      <td style={{fontSize:11}}>{fd(r.date)}</td>
                      <td><span className="pill" style={{background:st2.bg,color:st2.c,border:`1px solid ${st2.c}40`,fontSize:10}}>{st2.l}</span></td>
                      <td style={{color:"var(--m)",fontSize:12}}>{r.leaveReason||"—"}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            }
          </div>
        </div>
      )}

      {/* ── PROFILE ── */}
      {tab==="profile"&&(
        <div className="fade">
          {/* info card */}
          <div className="g" style={{padding:20,marginBottom:12}}>
            <div className="section-title">ข้อมูลส่วนตัว</div>
            <div style={{display:"grid",gap:16,gridTemplateColumns:"80px 1fr"}}>
              {/* avatar */}
              <div style={{textAlign:"center"}}>
                <div style={{width:68,height:68,background:"rgba(52,211,153,.15)",border:"2px solid rgba(52,211,153,.35)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 8px"}}>{pf.avatar||"🐾"}</div>
                <input value={pf.avatar} onChange={e=>setPf({...pf,avatar:e.target.value})} placeholder="emoji" style={{textAlign:"center",fontSize:20,padding:"4px 8px"}}/>
              </div>
              <div>
                <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>{me.name}</div>
                <div style={{fontSize:12,color:"var(--m)",lineHeight:2}}>
                  <div>🪪 {me.id} · {me.role==="admin"?"ผู้ดูแล":"พนักงาน"}</div>
                  {me.position&&<div>💼 {me.position}{me.department?` — ${me.department}`:""}</div>}
                  {me.startDate&&<div>📅 เริ่มงาน {fd(me.startDate)}</div>}
                </div>
              </div>
            </div>
            <div style={{marginTop:16,display:"grid",gap:11}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">อีเมล</label><input value={pf.email} onChange={e=>setPf({...pf,email:e.target.value})} placeholder="email@example.com"/></div>
                <div><label className="lbl">เบอร์โทรศัพท์</label><input value={pf.phone} onChange={e=>setPf({...pf,phone:e.target.value})} placeholder="0xx-xxx-xxxx"/></div>
              </div>
              <div><label className="lbl">บันทึกเพิ่มเติม</label>
                <textarea rows={2} value={pf.note} onChange={e=>setPf({...pf,note:e.target.value})} placeholder="หมายเหตุ..." style={{resize:"vertical"}}/>
              </div>
            </div>
            <button onClick={saveProfile} disabled={busy} style={{marginTop:14,background:"linear-gradient(135deg,#059669,#0d9488)",color:"#fff",padding:"10px 22px",fontWeight:600}}>
              {busy?"กำลังบันทึก...":"บันทึกโปรไฟล์"}
            </button>
          </div>

          {/* work schedule (read-only for employee) */}
          <div className="g" style={{padding:20,marginBottom:12}}>
            <div className="section-title">ตารางงานของฉัน</div>
            <div style={{display:"grid",gap:8,fontSize:13,color:"var(--m)",lineHeight:2}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>🕐 เวลาทำงาน</span><span style={{color:"var(--w)",fontFamily:"'IBM Plex Mono',monospace"}}>{s.startTime} – {s.endTime}</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>⚡ ผ่อนผันมาสาย</span><span style={{color:"var(--yellow)",fontFamily:"'IBM Plex Mono',monospace"}}>{s.graceMins} นาที</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>📋 วันลาสูงสุด/ปี</span><span style={{color:"var(--purple)",fontFamily:"'IBM Plex Mono',monospace"}}>{s.maxLeaveDays} วัน</span></div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>📅 วันทำงาน</span>
                <div style={{display:"flex",gap:5}}>
                  {["อา","จ","อ","พ","พฤ","ศ","ส"].map((d,i)=>{
                    const on=s.workDays.split(",").filter(Boolean).map(Number).includes(i);
                    return <span key={i} style={{width:28,height:28,borderRadius:7,background:on?"rgba(52,211,153,.25)":"rgba(255,255,255,.05)",color:on?"var(--acc)":"var(--dim)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,border:`1px solid ${on?"rgba(52,211,153,.4)":"rgba(255,255,255,.1)"}`}}>{d}</span>;
                  })}
                </div>
              </div>
              {me.salary&&<div style={{display:"flex",justifyContent:"space-between"}}><span>💰 เงินเดือน</span><span style={{color:"var(--green)",fontFamily:"'IBM Plex Mono',monospace"}}>{Number(me.salary).toLocaleString("th-TH")} ฿</span></div>}
            </div>
            <div style={{marginTop:10,fontSize:11,color:"var(--dim)"}}>* ติดต่อ Admin เพื่อแก้ไขตารางงาน</div>
          </div>

          {/* change PIN */}
          <div className="g" style={{padding:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showPin?16:0}}>
              <div className="section-title" style={{marginBottom:0}}>เปลี่ยนรหัส PIN</div>
              <button onClick={()=>setShowPin(!showPin)} style={{background:"rgba(255,255,255,.08)",color:"var(--m)",border:"1px solid rgba(255,255,255,.18)",padding:"5px 14px",fontSize:12}}>
                {showPin?"ยกเลิก":"เปลี่ยน PIN"}
              </button>
            </div>
            {showPin&&(
              <div style={{display:"grid",gap:10}}>
                <div><label className="lbl">PIN ใหม่ (อย่างน้อย 4 ตัว)</label><input type="password" placeholder="••••" value={newPin} onChange={e=>setNewPin(e.target.value)}/></div>
                <div><label className="lbl">ยืนยัน PIN ใหม่</label><input type="password" placeholder="••••" value={cfPin} onChange={e=>setCfPin(e.target.value)}/></div>
                <button onClick={changePIN} disabled={busy} style={{background:"linear-gradient(135deg,#5b21b6,#7c3aed)",color:"#fff",padding:"10px",fontWeight:600}}>
                  {busy?"กำลังบันทึก...":"ยืนยันเปลี่ยน PIN"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel({ user, employees, records, location, gSch, clinic, onReloadAll, onLogout, showToast }) {
  const [tab,setTab]   = useState("overview");
  const [date,setDate] = useState(today());
  const [search,setSearch] = useState("");
  const [selEmp,setSelEmp] = useState(null); // employee detail modal
  const [busy,setBusy] = useState(false);

  // forms
  const [newEmp,setNewEmp] = useState({id:"",name:"",pin:"",position:"",department:"",salary:"",email:"",phone:"",startDate:"",role:"employee"});
  const [editEmp,setEditEmp] = useState(null);
  const [lf,setLf]     = useState({name:location?.name||"",lat:location?.lat||"",lng:location?.lng||"",radius:location?.radius||200});
  const [sf,setSf]     = useState({startTime:gSch?.startTime||"08:30",endTime:gSch?.endTime||"17:30",graceMins:gSch?.graceMins??15,workDays:gSch?.workDays||"1,2,3,4,5",maxLeaveDays:gSch?.maxLeaveDays??10});
  const [cf,setCf]     = useState({name:clinic?.name||"คลินิคท่านาสัตวแพทย์",address:clinic?.address||"",phone:clinic?.phone||""});

  useEffect(()=>{ if(location) setLf({name:location.name||"",lat:location.lat||"",lng:location.lng||"",radius:location.radius||200}); },[location]);
  useEffect(()=>{ if(gSch) setSf({startTime:gSch.startTime||"08:30",endTime:gSch.endTime||"17:30",graceMins:gSch.graceMins??15,workDays:gSch.workDays||"1,2,3,4,5",maxLeaveDays:gSch.maxLeaveDays??10}); },[gSch]);
  useEffect(()=>{ if(clinic) setCf({name:clinic.name||"",address:clinic.address||"",phone:clinic.phone||""}); },[clinic]);

  const save = async(key,data) => {
    setBusy(true);
    const r=await call("saveConfig",{configKey:key,data:JSON.stringify(data)});
    r.success?(await onReloadAll(),showToast(true,"บันทึกสำเร็จ")):showToast(false,r.message);
    setBusy(false);
  };

  const addEmp = async () => {
    if(!newEmp.id||!newEmp.name||!newEmp.pin) return showToast(false,"กรอก รหัส / ชื่อ / PIN ให้ครบ");
    if(employees.find(e=>e.id===newEmp.id.toUpperCase())) return showToast(false,"รหัสนี้มีอยู่แล้ว");
    setBusy(true);
    const r=await call("addEmployee",{...newEmp,id:newEmp.id.toUpperCase()});
    r.success?(await onReloadAll(),showToast(true,`เพิ่ม ${newEmp.name} สำเร็จ`),setNewEmp({id:"",name:"",pin:"",position:"",department:"",salary:"",email:"",phone:"",startDate:"",role:"employee"})):showToast(false,r.message);
    setBusy(false);
  };
  const updateEmp = async (fields) => {
    setBusy(true);
    const r=await call("updateEmployee",fields);
    r.success?(await onReloadAll(),showToast(true,"อัปเดตสำเร็จ"),setSelEmp(null)):showToast(false,r.message);
    setBusy(false);
  };
  const delEmp = async id => {
    if(id===user.id||!window.confirm(`ลบพนักงาน ${id}?`)) return;
    setBusy(true);
    const r=await call("deleteEmployee",{id});
    r.success?(await onReloadAll(),showToast(true,"ลบแล้ว")):showToast(false,r.message);
    setBusy(false);
  };
  const exportAll = () => {
    const rows=[["วันที่","รหัส","ชื่อ","ตำแหน่ง","เข้างาน","ออกงาน","รวม","สถานะ"]];
    Object.entries(records).sort((a,b)=>b[0].localeCompare(a[0])).forEach(([d,day])=>{
      Object.entries(day).forEach(([eid,r])=>{
        const e=employees.find(x=>x.id===eid), s2=sch(e,gSch), st=STATUS(r,s2);
        rows.push([d,eid,e?.name||"—",e?.position||"",ft(r.checkIn),ft(r.checkOut),hm(dm(r.checkIn,r.checkOut)),st.l]);
      });
    });
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(r=>r.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"}));
    a.download=`attendance_all_${today()}.csv`; a.click();
  };

  const staff   = employees.filter(e=>e.role!=="admin");
  const dayRecs = records[date]||{};
  const filtered = staff.filter(e=>!search||e.name.includes(search)||e.id.includes(search.toUpperCase())||e.department?.includes(search)||e.position?.includes(search));

  const mo=today().slice(0,7);
  const moAll=Object.entries(records).filter(([d])=>d.startsWith(mo)).flatMap(([,d])=>Object.values(d));
  const statIn=moAll.filter(r=>r.checkIn&&!r.leaveType).length;
  const statLate=moAll.filter(r=>{ const emp=Object.entries(records).flatMap(([,d])=>Object.entries(d)).find(([,rec])=>rec===r); return STATUS(r,gSch).l.startsWith("มาสาย"); }).length;
  const statLeave=moAll.filter(r=>r.leaveType).length;
  const statHrs=moAll.reduce((s,r)=>s+(dm(r.checkIn,r.checkOut)||0),0);

  const DAYS_TH=["อา","จ","อ","พ","พฤ","ศ","ส"];

  return (
    <div style={{maxWidth:920,margin:"0 auto",padding:"14px 14px 60px"}}>
      {/* Header */}
      <div className="g2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:18,fontWeight:700}}>⚙ Admin Panel</div>
          <div style={{fontSize:11,color:"var(--m)"}}>{clinic?.name||"คลินิคท่านาสัตวแพทย์"} · {user.name}</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={onReloadAll} style={{background:"rgba(255,255,255,.08)",color:"var(--m)",border:"1px solid rgba(255,255,255,.18)",padding:"7px 14px",fontSize:12}}>🔄 รีเฟรช</button>
          <button onClick={exportAll}   style={{background:"rgba(52,211,153,.2)",color:"var(--acc)",border:"1px solid rgba(52,211,153,.3)",padding:"7px 14px",fontSize:12,fontWeight:600}}>⬇ CSV ทั้งหมด</button>
          <button onClick={onLogout}    style={{background:"rgba(255,255,255,.08)",color:"var(--m)",border:"1px solid rgba(255,255,255,.18)",padding:"7px 14px",fontSize:12}}>ออก</button>
        </div>
      </div>

      {/* Config status */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
        {[
          {ok:!!(location?.lat&&location?.lng),lb:"พิกัดสำนักงาน",detail:location?.lat?`${location.name||""} r=${location.radius}ม.`:"ยังไม่ได้ตั้งค่า",go:"location"},
          {ok:!!gSch?.startTime,lb:"ตารางงาน (ทั่วไป)",detail:gSch?.startTime?`${gSch.startTime}–${gSch.endTime} ผ่อนผัน ${gSch.graceMins}น.`:"ใช้ค่า default",go:"schedule"},
          {ok:!!clinic?.name,lb:"ข้อมูลคลินิค",detail:clinic?.name||"ยังไม่ได้ตั้งค่า",go:"clinicinfo"},
        ].map(b=>(
          <div key={b.go} onClick={()=>setTab(b.go)} className="g2" style={{padding:"11px 14px",cursor:"pointer",borderColor:b.ok?"var(--glb)":"rgba(253,230,138,.35)",background:b.ok?"var(--gl2)":"rgba(253,230,138,.05)"}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:b.ok?"#22c55e":"#f59e0b",display:"inline-block"}}/>
              <span style={{fontSize:12,fontWeight:600}}>{b.lb}</span>
            </div>
            <div style={{fontSize:11,color:"var(--m)",lineHeight:1.5}}>{b.detail}</div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
        {[["พนักงาน",staff.length,"var(--teal)"],["เข้า/เดือน",statIn,"var(--green)"],["สาย/เดือน",statLate,"var(--yellow)"],["ลา/เดือน",statLeave,"var(--purple)"]].map(([l,v,c])=>(
          <div key={l} className="g2" style={{padding:"13px 10px",textAlign:"center"}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:26,fontWeight:600,color:c,lineHeight:1}}>{v}</div>
            <div style={{fontSize:9,color:"var(--m)",marginTop:5}}>{l}</div>
          </div>
        ))}
      </div>
      <div className="g2" style={{padding:"10px 16px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:12,color:"var(--m)"}}>⏱ ชั่วโมงรวมทีมเดือนนี้</span>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:20,fontWeight:600,color:"var(--teal)"}}>{hm(statHrs)}</span>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,overflowX:"auto",paddingBottom:2}}>
        {[["overview","📊","ภาพรวม"],["employees","👥","พนักงาน"],["location","📍","พิกัด"],["schedule","🕐","ตารางงาน"],["clinicinfo","🐾","คลินิค"]].map(([k,ic,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:"0 0 auto",padding:"8px 16px",background:tab===k?"rgba(52,211,153,.25)":"var(--gl)",color:tab===k?"var(--acc)":"var(--m)",border:`1px solid ${tab===k?"rgba(52,211,153,.5)":"var(--glb)"}`,borderRadius:10,fontSize:13,backdropFilter:"blur(10px)"}}>
            {ic} {lb}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab==="overview"&&(
        <div className="fade">
          <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:170}}/>
            <input placeholder="ค้นหา..." value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:120}}/>
            <span style={{fontSize:12,color:"var(--m)",whiteSpace:"nowrap"}}>{Object.keys(dayRecs).length}/{staff.length}</span>
          </div>
          <div className="g" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>พนักงาน</th><th>ตำแหน่ง</th><th>เข้างาน</th><th>ออกงาน</th><th>รวม</th><th>สถานะ</th></tr></thead>
              <tbody>
                {filtered.map(e=>{ const r=dayRecs[e.id]; const s2=sch(e,gSch); const st=STATUS(r,s2); return(
                  <tr key={e.id} onClick={()=>setSelEmp(e)} style={{cursor:"pointer"}}>
                    <td><div style={{fontWeight:500}}>{e.name}</div><div style={{fontSize:10,color:"var(--dim)"}}>{e.id}</div></td>
                    <td style={{fontSize:11,color:"var(--m)"}}>{e.position||"—"}</td>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:r?.checkIn?"var(--green)":"var(--dim)"}}>{ft(r?.checkIn)}</td>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:r?.checkOut?"var(--red)":"var(--dim)"}}>{ft(r?.checkOut)}</td>
                    <td style={{fontFamily:"'IBM Plex Mono',monospace",color:"var(--teal)"}}>{r?hm(dm(r.checkIn,r.checkOut)):"—"}</td>
                    <td><span className="pill" style={{background:st.bg,color:st.c,border:`1px solid ${st.c}40`,fontSize:10}}>{st.l}</span></td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── EMPLOYEES ── */}
      {tab==="employees"&&(
        <div className="fade">
          {/* add form */}
          <div className="g" style={{padding:20,marginBottom:14}}>
            <div className="section-title">เพิ่มพนักงานใหม่</div>
            <div style={{display:"grid",gap:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr",gap:10}}>
                <div><label className="lbl">รหัส *</label><input placeholder="EMP003" value={newEmp.id} onChange={e=>setNewEmp({...newEmp,id:e.target.value.toUpperCase()})}/></div>
                <div><label className="lbl">ชื่อ-นามสกุล *</label><input placeholder="ชื่อพนักงาน" value={newEmp.name} onChange={e=>setNewEmp({...newEmp,name:e.target.value})}/></div>
                <div><label className="lbl">PIN *</label><input type="password" placeholder="••••" value={newEmp.pin} onChange={e=>setNewEmp({...newEmp,pin:e.target.value})}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                <div><label className="lbl">ตำแหน่ง</label><input placeholder="สัตวแพทย์" value={newEmp.position} onChange={e=>setNewEmp({...newEmp,position:e.target.value})}/></div>
                <div><label className="lbl">แผนก</label><input placeholder="รักษา" value={newEmp.department} onChange={e=>setNewEmp({...newEmp,department:e.target.value})}/></div>
                <div><label className="lbl">วันเริ่มงาน</label><input type="date" value={newEmp.startDate} onChange={e=>setNewEmp({...newEmp,startDate:e.target.value})}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                <div><label className="lbl">เงินเดือน (฿)</label><input type="number" placeholder="25000" value={newEmp.salary} onChange={e=>setNewEmp({...newEmp,salary:e.target.value})}/></div>
                <div><label className="lbl">อีเมล</label><input placeholder="email@" value={newEmp.email} onChange={e=>setNewEmp({...newEmp,email:e.target.value})}/></div>
                <div><label className="lbl">บทบาท</label>
                  <select value={newEmp.role} onChange={e=>setNewEmp({...newEmp,role:e.target.value})}>
                    <option value="employee">พนักงาน</option>
                    <option value="admin">ผู้ดูแล</option>
                  </select>
                </div>
              </div>
            </div>
            <button onClick={addEmp} disabled={busy} style={{marginTop:14,background:"linear-gradient(135deg,#059669,#0d9488)",color:"#fff",padding:"10px 22px",fontWeight:600}}>
              {busy?"กำลังบันทึก...":"+ เพิ่มพนักงาน"}
            </button>
          </div>

          {/* list */}
          <div style={{marginBottom:10}}><input placeholder="ค้นหา..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <div className="g" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง / แผนก</th><th>เวลางาน</th><th>ลาคงเหลือ</th><th></th></tr></thead>
              <tbody>
                {filtered.map(e=>{ 
                  const s2=sch(e,gSch);
                  const used=Object.values(records).flatMap(d=>Object.entries(d)).filter(([eid,r])=>eid===e.id&&r.leaveType&&r.date?.startsWith(today().slice(0,4))).length;
                  const left=Math.max(0,s2.maxLeaveDays-used);
                  const hasCustom=!!(e.workStart||e.workEnd||e.graceMins!=null||e.workDays);
                  return(
                    <tr key={e.id} onClick={()=>setSelEmp(e)} style={{cursor:"pointer"}}>
                      <td style={{fontFamily:"'IBM Plex Mono',monospace",color:"var(--teal)",fontWeight:500}}>{e.id}</td>
                      <td>
                        <div style={{fontWeight:500}}>{e.avatar||"🐾"} {e.name}</div>
                        <span style={{fontSize:10,padding:"2px 7px",borderRadius:20,background:e.role==="admin"?"rgba(253,230,138,.15)":"rgba(45,212,191,.1)",color:e.role==="admin"?"var(--yellow)":"var(--teal)",border:`1px solid ${e.role==="admin"?"rgba(253,230,138,.3)":"rgba(45,212,191,.3)"}`}}>{e.role==="admin"?"ผู้ดูแล":"พนักงาน"}</span>
                      </td>
                      <td style={{fontSize:11,color:"var(--m)"}}>{e.position||"—"}{e.department?` / ${e.department}`:""}</td>
                      <td style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>
                        <span style={{color:hasCustom?"var(--yellow)":"var(--m)"}}>{s2.startTime}–{s2.endTime}</span>
                        {hasCustom&&<div style={{fontSize:9,color:"var(--yellow)"}}>⚡ ตารางส่วนตัว</div>}
                      </td>
                      <td style={{color:"var(--purple)",fontFamily:"'IBM Plex Mono',monospace"}}>{left}/{s2.maxLeaveDays}</td>
                      <td onClick={ev=>{ev.stopPropagation();delEmp(e.id);}}>
                        {e.id!==user.id&&<button style={{background:"rgba(252,165,165,.12)",color:"var(--red)",border:"1px solid rgba(252,165,165,.3)",padding:"4px 10px",fontSize:11}}>ลบ</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── LOCATION ── */}
      {tab==="location"&&(
        <div className="fade">
          <div className="g2" style={{padding:"12px 16px",marginBottom:14,borderColor:lf.lat&&lf.lng?"rgba(110,231,183,.3)":"rgba(253,230,138,.4)",background:lf.lat&&lf.lng?"rgba(110,231,183,.05)":"rgba(253,230,138,.05)"}}>
            <div style={{fontSize:12,fontWeight:600,color:lf.lat&&lf.lng?"var(--green)":"var(--yellow)",marginBottom:4}}>{lf.lat&&lf.lng?"✓ ตั้งค่าแล้ว":"⚠ ยังไม่ได้ตั้งค่า"}</div>
            {lf.lat&&lf.lng?<div style={{fontSize:12,color:"var(--m)",lineHeight:1.8}}><div>📍 {lf.name}</div><div>Lat {lf.lat} · Lng {lf.lng} · รัศมี {lf.radius}ม.</div></div>:<div style={{fontSize:12,color:"var(--dim)"}}>พนักงานจะเช็คอินได้แม้อยู่นอกพื้นที่จนกว่าจะตั้งค่า</div>}
          </div>
          <div className="g" style={{padding:20}}>
            <div className="section-title">แก้ไขพิกัดสำนักงาน</div>
            <div style={{display:"grid",gap:13}}>
              <div><label className="lbl">ชื่อสถานที่</label><input value={lf.name} onChange={e=>setLf({...lf,name:e.target.value})}/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">Latitude</label><input type="number" step="0.00001" value={lf.lat} onChange={e=>setLf({...lf,lat:e.target.value})}/></div>
                <div><label className="lbl">Longitude</label><input type="number" step="0.00001" value={lf.lng} onChange={e=>setLf({...lf,lng:e.target.value})}/></div>
              </div>
              <div><label className="lbl">รัศมีที่อนุญาต: <strong style={{color:"var(--w)"}}>{lf.radius} เมตร</strong></label><input type="range" min="50" max="1000" step="25" value={lf.radius} onChange={e=>setLf({...lf,radius:e.target.value})}/></div>
            </div>
            <button onClick={()=>save("location",{name:lf.name,lat:+lf.lat,lng:+lf.lng,radius:+lf.radius})} disabled={busy} style={{marginTop:16,background:"linear-gradient(135deg,#059669,#0d9488)",color:"#fff",padding:"11px 24px",fontWeight:600}}>
              {busy?"กำลังบันทึก...":"บันทึกพิกัด"}
            </button>
            <div style={{marginTop:14,background:"rgba(255,255,255,.05)",borderRadius:9,padding:"12px 14px",fontSize:12,color:"var(--m)",lineHeight:2}}>
              <b style={{color:"var(--teal)"}}>วิธีหาพิกัด:</b> เปิด Google Maps → ค้นหา Q5WC+5PW นครชัยศรี → กดค้างที่ตำแหน่ง → พิกัดจะขึ้นด้านล่าง เช่น 13.795, 100.161
            </div>
          </div>
        </div>
      )}

      {/* ── SCHEDULE ── */}
      {tab==="schedule"&&(
        <div className="fade">
          <div className="g2" style={{padding:"12px 16px",marginBottom:14,fontSize:12,color:"var(--m)",lineHeight:1.8,borderColor:"rgba(253,230,138,.3)",background:"rgba(253,230,138,.04)"}}>
            <b style={{color:"var(--yellow)"}}>⚡ ตารางงานทั่วไป</b> — ใช้สำหรับพนักงานที่ไม่ได้ตั้งค่าส่วนตัว<br/>
            หากต้องการตั้งเวลาเฉพาะบุคคล กดที่ชื่อพนักงานในแท็บ "พนักงาน" แล้วแก้ไขในนั้น
          </div>
          <div className="g" style={{padding:20}}>
            <div className="section-title">ตารางงานทั่วไป (Default)</div>
            <div style={{display:"grid",gap:14}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">เวลาเข้างาน</label><input type="time" value={sf.startTime} onChange={e=>setSf({...sf,startTime:e.target.value})}/></div>
                <div><label className="lbl">เวลาออกงาน</label><input type="time" value={sf.endTime} onChange={e=>setSf({...sf,endTime:e.target.value})}/></div>
              </div>
              <div><label className="lbl">ผ่อนผันมาสาย: <strong style={{color:"var(--w)"}}>{sf.graceMins} นาที</strong></label><input type="range" min="0" max="60" step="5" value={sf.graceMins} onChange={e=>setSf({...sf,graceMins:+e.target.value})}/></div>
              <div><label className="lbl">วันลาสูงสุด/ปี/คน: <strong style={{color:"var(--w)"}}>{sf.maxLeaveDays} วัน</strong></label><input type="range" min="1" max="30" step="1" value={sf.maxLeaveDays} onChange={e=>setSf({...sf,maxLeaveDays:+e.target.value})}/></div>
              <div>
                <label className="lbl">วันทำงาน</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {DAYS_TH.map((d,i)=>{ const on=sf.workDays.split(",").filter(Boolean).map(Number).includes(i); return(
                    <button key={i} onClick={()=>{ const cur=sf.workDays.split(",").filter(Boolean).map(Number); const nxt=on?cur.filter(x=>x!==i):[...cur,i].sort(); setSf({...sf,workDays:nxt.join(",")}); }} style={{width:44,height:44,borderRadius:9,background:on?"rgba(52,211,153,.25)":"rgba(255,255,255,.06)",color:on?"var(--acc)":"var(--dim)",border:`1px solid ${on?"rgba(52,211,153,.4)":"rgba(255,255,255,.12)"}`,fontWeight:on?600:400}}>{d}</button>
                  ); })}
                </div>
              </div>
            </div>
            {/* Preview */}
            <div style={{marginTop:16,background:"rgba(255,255,255,.05)",borderLeft:"3px solid var(--teal)",borderRadius:"0 8px 8px 0",padding:"12px 16px",fontSize:13,color:"var(--m)",lineHeight:2}}>
              <div style={{color:"var(--teal)",fontWeight:600,marginBottom:4,fontSize:11,letterSpacing:2}}>PREVIEW</div>
              <div>มาถึง {sf.startTime} → <span style={{color:"var(--green)"}}>ตรงเวลา ✓</span></div>
              <div>มาถึง {addMin(sf.startTime,+sf.graceMins+1)} → <span style={{color:"var(--yellow)"}}>มาสาย {+sf.graceMins+1} นาที</span></div>
              <div>ออก {sf.endTime} → <span style={{color:"var(--green)"}}>ครบเวลา ✓</span></div>
            </div>
            <button onClick={()=>save("schedule",{startTime:sf.startTime,endTime:sf.endTime,graceMins:sf.graceMins,workDays:sf.workDays,maxLeaveDays:sf.maxLeaveDays})} disabled={busy} style={{marginTop:16,background:"linear-gradient(135deg,#059669,#0d9488)",color:"#fff",padding:"11px 24px",fontWeight:600}}>
              {busy?"กำลังบันทึก...":"บันทึกตารางงาน"}
            </button>
          </div>
        </div>
      )}

      {/* ── CLINIC INFO ── */}
      {tab==="clinicinfo"&&(
        <div className="fade">
          <div className="g" style={{padding:20}}>
            <div className="section-title">ข้อมูลคลินิค</div>
            <div style={{display:"grid",gap:12}}>
              <div><label className="lbl">ชื่อคลินิค</label><input value={cf.name} onChange={e=>setCf({...cf,name:e.target.value})} placeholder="คลินิคท่านาสัตวแพทย์"/></div>
              <div><label className="lbl">ที่อยู่</label><textarea rows={2} value={cf.address} onChange={e=>setCf({...cf,address:e.target.value})} placeholder="ที่อยู่คลินิค..." style={{resize:"vertical"}}/></div>
              <div><label className="lbl">เบอร์โทรศัพท์</label><input value={cf.phone} onChange={e=>setCf({...cf,phone:e.target.value})} placeholder="0xx-xxx-xxxx"/></div>
            </div>
            <button onClick={()=>save("clinic",cf)} disabled={busy} style={{marginTop:16,background:"linear-gradient(135deg,#059669,#0d9488)",color:"#fff",padding:"11px 24px",fontWeight:600}}>
              {busy?"กำลังบันทึก...":"บันทึกข้อมูลคลินิค"}
            </button>
          </div>
        </div>
      )}

      {/* ── Employee Detail Modal ── */}
      {selEmp&&<EmpModal emp={selEmp} gSch={gSch} records={records} busy={busy} onSave={updateEmp} onClose={()=>setSelEmp(null)} showToast={showToast}/>}
    </div>
  );
}

// ─── Employee Detail Modal ────────────────────────────────────────────────────
function EmpModal({ emp, gSch, records, busy, onSave, onClose, showToast }) {
  const [tab,setTab] = useState("info");
  const [f,setF] = useState({
    name:emp.name||"", email:emp.email||"", phone:emp.phone||"",
    position:emp.position||"", department:emp.department||"",
    salary:emp.salary||"", startDate:emp.startDate||"",
    workStart:emp.workStart||"", workEnd:emp.workEnd||"",
    graceMins:emp.graceMins!=null?String(emp.graceMins):"",
    workDays:emp.workDays||"", maxLeaveDays:emp.maxLeaveDays!=null?String(emp.maxLeaveDays):"",
    note:emp.note||"", avatar:emp.avatar||"", role:emp.role||"employee",
  });
  const [newPin,setNewPin]=useState(""); const [cfPin,setCfPin]=useState("");

  const s2=sch(emp,gSch);
  const myRecs=Object.entries(records).flatMap(([d,r])=>r[emp.id]?[{date:d,...r[emp.id]}]:[]).sort((a,b)=>b.date.localeCompare(a.date));
  const yr=today().slice(0,4);
  const leaveUsed=myRecs.filter(r=>r.leaveType&&r.date.startsWith(yr)).length;
  const moHrs=myRecs.filter(r=>r.date.startsWith(today().slice(0,7))).reduce((x,r)=>x+(dm(r.checkIn,r.checkOut)||0),0);
  const DAYS_TH=["อา","จ","อ","พ","พฤ","ศ","ส"];

  const saveInfo = () => onSave({id:emp.id,name:f.name,email:f.email,phone:f.phone,position:f.position,department:f.department,salary:f.salary,startDate:f.startDate,note:f.note,avatar:f.avatar,role:f.role});
  const saveSch  = () => onSave({id:emp.id,workStart:f.workStart,workEnd:f.workEnd,graceMins:f.graceMins,workDays:f.workDays,maxLeaveDays:f.maxLeaveDays});
  const savePin  = () => {
    if(newPin.length<4){ showToast(false,"PIN ต้องมีอย่างน้อย 4 ตัว"); return; }
    if(newPin!==cfPin){  showToast(false,"PIN ไม่ตรงกัน"); return; }
    onSave({id:emp.id,pin:newPin});
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:14,background:"rgba(0,0,0,.7)",backdropFilter:"blur(6px)"}} onClick={onClose}>
      <div className="g" style={{width:"100%",maxWidth:520,maxHeight:"90vh",overflow:"auto",padding:0}} onClick={e=>e.stopPropagation()}>
        {/* modal header */}
        <div style={{padding:"18px 20px 14px",borderBottom:"1px solid rgba(255,255,255,.1)",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"rgba(5,40,30,.95)",backdropFilter:"blur(20px)",zIndex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:40,height:40,background:"rgba(52,211,153,.15)",border:"1.5px solid rgba(52,211,153,.35)",borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{f.avatar||"🐾"}</div>
            <div><div style={{fontWeight:600}}>{emp.name}</div><div style={{fontSize:11,color:"var(--m)"}}>{emp.id}</div></div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,.08)",color:"var(--m)",border:"1px solid rgba(255,255,255,.15)",padding:"6px 12px",fontSize:12}}>✕ ปิด</button>
        </div>

        {/* quick stats */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,padding:"14px 16px 0"}}>
          {[["เดือนนี้",`${hm(moHrs)}`,"var(--teal)"],["ลาแล้ว/ปี",`${leaveUsed}/${s2.maxLeaveDays}`,"var(--purple)"],["ประวัติ",`${myRecs.length} วัน`,"var(--m)"]].map(([l,v,c])=>(
            <div key={l} className="g2" style={{padding:"9px 10px",textAlign:"center"}}>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:16,fontWeight:600,color:c}}>{v}</div>
              <div style={{fontSize:9,color:"var(--dim)",marginTop:3}}>{l}</div>
            </div>
          ))}
        </div>

        {/* tabs */}
        <div style={{display:"flex",gap:6,padding:"12px 16px 0"}}>
          {[["info","📋","ข้อมูล"],["work","🕐","ตารางงาน"],["pin","🔑","PIN"]].map(([k,ic,lb])=>(
            <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"7px",background:tab===k?"rgba(52,211,153,.2)":"rgba(255,255,255,.06)",color:tab===k?"var(--acc)":"var(--m)",border:`1px solid ${tab===k?"rgba(52,211,153,.4)":"rgba(255,255,255,.1)"}`,fontSize:12,borderRadius:8}}>
              {ic} {lb}
            </button>
          ))}
        </div>

        <div style={{padding:"14px 16px 20px"}}>
          {tab==="info"&&(
            <div style={{display:"grid",gap:11}}>
              <div style={{display:"grid",gridTemplateColumns:"60px 1fr",gap:10,alignItems:"start"}}>
                <div><label className="lbl" style={{fontSize:10}}>Avatar</label><input value={f.avatar} onChange={e=>setF({...f,avatar:e.target.value})} style={{textAlign:"center",fontSize:18,padding:"6px"}}/></div>
                <div><label className="lbl">ชื่อ-นามสกุล</label><input value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></div>
              </div>
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
              <div><label className="lbl">บทบาท</label>
                <select value={f.role} onChange={e=>setF({...f,role:e.target.value})}>
                  <option value="employee">พนักงาน</option>
                  <option value="admin">ผู้ดูแล</option>
                </select>
              </div>
              <div><label className="lbl">หมายเหตุ</label><textarea rows={2} value={f.note} onChange={e=>setF({...f,note:e.target.value})} style={{resize:"vertical"}}/></div>
              <button onClick={saveInfo} disabled={busy} style={{background:"linear-gradient(135deg,#059669,#0d9488)",color:"#fff",padding:"10px",fontWeight:600}}>{busy?"กำลังบันทึก...":"บันทึกข้อมูล"}</button>
            </div>
          )}
          {tab==="work"&&(
            <div style={{display:"grid",gap:14}}>
              <div style={{background:"rgba(253,230,138,.08)",border:"1px solid rgba(253,230,138,.25)",borderRadius:9,padding:"10px 14px",fontSize:12,color:"var(--yellow)"}}>
                ⚡ ตั้งค่าเฉพาะบุคคล — จะ override ตารางงานทั่วไป<br/>
                <span style={{color:"var(--dim)"}}>ปล่อยว่างเพื่อใช้ค่า Default ({gSch?.startTime||"08:30"}–{gSch?.endTime||"17:30"})</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">เวลาเข้างาน (เฉพาะคนนี้)</label><input type="time" value={f.workStart} onChange={e=>setF({...f,workStart:e.target.value})}/></div>
                <div><label className="lbl">เวลาออกงาน (เฉพาะคนนี้)</label><input type="time" value={f.workEnd} onChange={e=>setF({...f,workEnd:e.target.value})}/></div>
              </div>
              <div><label className="lbl">ผ่อนผันมาสาย (นาที) — ปล่อยว่างใช้ Default</label><input type="number" min="0" max="120" value={f.graceMins} onChange={e=>setF({...f,graceMins:e.target.value})} placeholder={`Default: ${gSch?.graceMins??15}`}/></div>
              <div><label className="lbl">วันลาสูงสุด/ปี — ปล่อยว่างใช้ Default</label><input type="number" min="0" max="30" value={f.maxLeaveDays} onChange={e=>setF({...f,maxLeaveDays:e.target.value})} placeholder={`Default: ${gSch?.maxLeaveDays??10}`}/></div>
              <div>
                <label className="lbl">วันทำงาน — ปล่อยว่างใช้ Default</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {DAYS_TH.map((d,i)=>{
                    const cur=f.workDays?f.workDays.split(",").filter(Boolean).map(Number):[];
                    const on=cur.includes(i);
                    return <button key={i} onClick={()=>{ const nxt=on?cur.filter(x=>x!==i):[...cur,i].sort(); setF({...f,workDays:nxt.join(",")}) }} style={{width:40,height:40,borderRadius:8,background:on?"rgba(52,211,153,.25)":"rgba(255,255,255,.06)",color:on?"var(--acc)":"var(--dim)",border:`1px solid ${on?"rgba(52,211,153,.4)":"rgba(255,255,255,.1)"}`,fontSize:11}}>{d}</button>;
                  })}
                  {f.workDays&&<button onClick={()=>setF({...f,workDays:""})} style={{padding:"0 10px",height:40,background:"rgba(252,165,165,.12)",color:"var(--red)",border:"1px solid rgba(252,165,165,.3)",fontSize:11}}>รีเซ็ต</button>}
                </div>
              </div>
              <button onClick={saveSch} disabled={busy} style={{background:"linear-gradient(135deg,#5b21b6,#7c3aed)",color:"#fff",padding:"10px",fontWeight:600}}>{busy?"กำลังบันทึก...":"บันทึกตารางงาน"}</button>
            </div>
          )}
          {tab==="pin"&&(
            <div style={{display:"grid",gap:12}}>
              <div style={{background:"rgba(252,165,165,.08)",border:"1px solid rgba(252,165,165,.25)",borderRadius:9,padding:"10px 14px",fontSize:12,color:"var(--red)"}}>
                ⚠ การเปลี่ยน PIN จะมีผลทันที พนักงานต้องใช้ PIN ใหม่ในการล็อกอินครั้งถัดไป
              </div>
              <div><label className="lbl">PIN ใหม่ (อย่างน้อย 4 ตัว)</label><input type="password" placeholder="••••" value={newPin} onChange={e=>setNewPin(e.target.value)}/></div>
              <div><label className="lbl">ยืนยัน PIN ใหม่</label><input type="password" placeholder="••••" value={cfPin} onChange={e=>setCfPin(e.target.value)}/></div>
              <button onClick={savePin} disabled={busy} style={{background:"linear-gradient(135deg,#b91c1c,#dc2626)",color:"#fff",padding:"10px",fontWeight:600}}>{busy?"กำลังบันทึก...":"ตั้ง PIN ใหม่"}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}