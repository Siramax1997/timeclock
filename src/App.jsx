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
const fd     = s   => { if(!s) return "—"; try{const d=String(s).length===10?new Date(s+"T00:00:00"):new Date(s);return isNaN(d)?"—":d.toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"2-digit"})}catch{return s}};
const dm     = (a,b)=>{ if(!a||!b) return null; const v=Math.round((new Date(b)-new Date(a))/60000); return v<0?null:v; };
const hm     = m   => { if(m==null||m<0) return "—"; return `${Math.floor(m/60)}:${String(m%60).padStart(2,"0")}`; };
const addMin = (t,n)=>{ const[h,m]=t.split(":").map(Number),x=h*60+m+n; return`${String(Math.floor(x/60)).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`; };
const sch = (emp, g) => ({
  startTime:    emp?.workStart    || g?.startTime    || "08:30",
  endTime:      emp?.workEnd      || g?.endTime      || "17:30",
  graceMins:    emp?.graceMins   != null ? +emp.graceMins    : (g?.graceMins    ?? 15),
  workDays:     emp?.workDays     || g?.workDays     || "1,2,3,4,5",
  maxLeaveDays: emp?.maxLeaveDays != null ? +emp.maxLeaveDays : (g?.maxLeaveDays ?? 10),
});
const STATUS = (rec, s) => {
  if(!rec)          return {l:"ขาดงาน",      c:"var(--red)",  bg:"var(--redBg)"};
  if(rec.leaveType) return {l:{sick:"ลาป่วย",personal:"ลากิจ",vacation:"ลาพักร้อน"}[rec.leaveType]||"ลา",c:"var(--purple)",bg:"var(--purpleBg)"};
  if(!rec.checkIn)  return {l:"ขาดงาน",      c:"var(--red)",  bg:"var(--redBg)"};
  if(!rec.checkOut) return {l:"กำลังทำงาน",  c:"var(--acc)",  bg:"var(--accBg)"};
  const cin=new Date(rec.checkIn),cout=new Date(rec.checkOut);
  const cM=cin.getHours()*60+cin.getMinutes(),oM=cout.getHours()*60+cout.getMinutes();
  const[sh,sm]=s.startTime.split(":").map(Number),[eh,em]=s.endTime.split(":").map(Number);
  const late=cM>sh*60+sm+s.graceMins, early=oM<eh*60+em-10;
  if(late&&early) return {l:"สาย+ออกก่อน",c:"var(--orange)",bg:"var(--orangeBg)"};
  if(late)        return {l:`มาสาย ${cM-(sh*60+sm)}น.`,c:"var(--yellow)",bg:"var(--yellowBg)"};
  if(early)       return {l:"ออกก่อนเวลา",c:"var(--orange)",bg:"var(--orangeBg)"};
  return             {l:"ปกติ ✓",c:"var(--acc)",bg:"var(--accBg)"};
};

// ─── Themes ───────────────────────────────────────────────────────────────────
const THEMES = [
  { id:"light", name:"ใส", emoji:"🌿", dark:false,
    bg:"#edfdf6", bgB:"#e0f9ef", bgC:"#f0fffe",
    card:"rgba(255,255,255,.82)", card2:"rgba(255,255,255,.62)",
    br:"rgba(0,0,0,.09)", br2:"rgba(0,0,0,.14)",
    tx:"rgba(0,0,0,.84)", tx2:"rgba(0,0,0,.5)", tx3:"rgba(0,0,0,.28)",
    acc:"#059669", acc2:"#0d9488",
    accBg:"rgba(5,150,105,.12)", redBg:"rgba(220,38,38,.1)",
    yellowBg:"rgba(202,138,4,.12)", purpleBg:"rgba(124,58,237,.12)", orangeBg:"rgba(234,88,12,.12)",
    red:"#dc2626", yellow:"#ca8a04", purple:"#7c3aed", orange:"#ea580c",
  },
  { id:"forest", name:"ป่า", emoji:"🌲", dark:true,
    bg:"#071a12", bgB:"#0a2318", bgC:"#071510",
    card:"rgba(255,255,255,.07)", card2:"rgba(255,255,255,.1)",
    br:"rgba(255,255,255,.1)", br2:"rgba(255,255,255,.16)",
    tx:"rgba(255,255,255,.94)", tx2:"rgba(255,255,255,.5)", tx3:"rgba(255,255,255,.25)",
    acc:"#34d399", acc2:"#2dd4bf",
    accBg:"rgba(52,211,153,.14)", redBg:"rgba(248,113,113,.13)",
    yellowBg:"rgba(251,191,36,.13)", purpleBg:"rgba(192,132,252,.13)", orangeBg:"rgba(251,146,60,.13)",
    red:"#f87171", yellow:"#fbbf24", purple:"#c084fc", orange:"#fb923c",
  },
  { id:"ocean", name:"ทะเล", emoji:"🌊", dark:true,
    bg:"#060f1f", bgB:"#0c1a35", bgC:"#08122a",
    card:"rgba(255,255,255,.07)", card2:"rgba(255,255,255,.1)",
    br:"rgba(96,165,250,.15)", br2:"rgba(96,165,250,.25)",
    tx:"rgba(255,255,255,.94)", tx2:"rgba(255,255,255,.5)", tx3:"rgba(255,255,255,.25)",
    acc:"#38bdf8", acc2:"#67e8f9",
    accBg:"rgba(56,189,248,.14)", redBg:"rgba(248,113,113,.13)",
    yellowBg:"rgba(251,191,36,.13)", purpleBg:"rgba(192,132,252,.13)", orangeBg:"rgba(251,146,60,.13)",
    red:"#f87171", yellow:"#fbbf24", purple:"#c084fc", orange:"#fb923c",
  },
  { id:"sakura", name:"ซากุระ", emoji:"🌸", dark:false,
    bg:"#fef2f8", bgB:"#fdf4ff", bgC:"#fff1f5",
    card:"rgba(255,255,255,.82)", card2:"rgba(255,255,255,.62)",
    br:"rgba(0,0,0,.08)", br2:"rgba(0,0,0,.13)",
    tx:"rgba(0,0,0,.82)", tx2:"rgba(0,0,0,.48)", tx3:"rgba(0,0,0,.27)",
    acc:"#db2777", acc2:"#9333ea",
    accBg:"rgba(219,39,119,.11)", redBg:"rgba(220,38,38,.09)",
    yellowBg:"rgba(202,138,4,.1)", purpleBg:"rgba(124,58,237,.1)", orangeBg:"rgba(234,88,12,.1)",
    red:"#dc2626", yellow:"#ca8a04", purple:"#7c3aed", orange:"#ea580c",
  },
  { id:"sunset", name:"พระอาทิตย์", emoji:"🌅", dark:false,
    bg:"#fff8f0", bgB:"#fff3e0", bgC:"#fef9f0",
    card:"rgba(255,255,255,.82)", card2:"rgba(255,255,255,.62)",
    br:"rgba(0,0,0,.08)", br2:"rgba(0,0,0,.13)",
    tx:"rgba(0,0,0,.82)", tx2:"rgba(0,0,0,.48)", tx3:"rgba(0,0,0,.27)",
    acc:"#ea580c", acc2:"#d97706",
    accBg:"rgba(234,88,12,.11)", redBg:"rgba(220,38,38,.09)",
    yellowBg:"rgba(202,138,4,.1)", purpleBg:"rgba(124,58,237,.1)", orangeBg:"rgba(234,88,12,.1)",
    red:"#dc2626", yellow:"#ca8a04", purple:"#7c3aed", orange:"#ea580c",
  },
];

// CSS vars from theme object
const themeVars = (t) => ({
  "--bg": t.bg, "--bgB": t.bgB, "--bgC": t.bgC,
  "--card": t.card, "--card2": t.card2,
  "--br": t.br, "--br2": t.br2,
  "--tx": t.tx, "--tx2": t.tx2, "--tx3": t.tx3,
  "--acc": t.acc, "--acc2": t.acc2,
  "--accBg": t.accBg, "--redBg": t.redBg,
  "--yellowBg": t.yellowBg, "--purpleBg": t.purpleBg, "--orangeBg": t.orangeBg,
  "--red": t.red, "--yellow": t.yellow, "--purple": t.purple, "--orange": t.orange,
});

// ─── Emoji Picker ─────────────────────────────────────────────────────────────
const EA=["🐶","🐱","🦁","🐯","🐼","🐨","🐸","🦊","🐰","🐹","🦮","🐩","🐈","🦄","🐮","🦛","🦒","🦓","🐺","🦝","🐒","🦔","🐿️","🦦","🦥","🦜","🦋","🐢","🐊","🦎","🐬","🐋","🦈","🦅","🦉"];
const EM=["🩺","💉","🩸","🧬","🔬","🧪","💊","🩻","🩹","🏥","🚑","🌡️","🦷","🦴","🫀","🫁","🧠","⚕️","🌿","🌱","🍃","☘️","🌾","💚","❤️‍🩹","🐾","✦","⭐","🌟","💫"];
function EmojiPicker({ value, onChange, onClose }) {
  const [cat,setCat]=useState("animals");
  const list=cat==="animals"?EA:EM;
  return (
    <div style={{position:"fixed",inset:0,zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16,background:"rgba(0,0,0,.55)",backdropFilter:"blur(8px)"}} onClick={onClose}>
      <div style={{background:"var(--bg)",border:"1px solid var(--br2)",borderRadius:20,padding:18,width:"100%",maxWidth:320,boxShadow:"0 24px 60px rgba(0,0,0,.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <span style={{fontSize:14,fontWeight:700,color:"var(--tx)"}}>เลือก Avatar</span>
          <button onClick={onClose} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"3px 10px",fontSize:12,borderRadius:8}}>✕</button>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:12}}>
          {[["animals","🐾 สัตว์"],["medical","🩺 การแพทย์"]].map(([k,l])=>(
            <button key={k} onClick={()=>setCat(k)} style={{flex:1,padding:8,background:cat===k?"var(--accBg)":"var(--card2)",color:cat===k?"var(--acc)":"var(--tx2)",border:`1px solid ${cat===k?"var(--acc)":"var(--br)"}`,borderRadius:10,fontSize:12,fontWeight:600}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,maxHeight:200,overflowY:"auto"}}>
          {list.map((em,i)=>(
            <button key={i} onClick={()=>{onChange(em);onClose();}} style={{aspectRatio:"1",background:value===em?"var(--accBg)":"transparent",border:`1.5px solid ${value===em?"var(--acc)":"transparent"}`,borderRadius:10,fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
              {em}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Theme Switcher ───────────────────────────────────────────────────────────
function ThemeSwitcher({ current, onChange }) {
  const [open,setOpen]=useState(false);
  const t=THEMES.find(x=>x.id===current)||THEMES[0];
  return (
    <div style={{position:"fixed",bottom:20,right:16,zIndex:400}}>
      {open&&(
        <div style={{position:"absolute",bottom:52,right:0,background:"var(--bg)",border:"1px solid var(--br2)",borderRadius:16,padding:12,display:"flex",flexDirection:"column",gap:6,width:160,boxShadow:"0 8px 32px rgba(0,0,0,.2)",backdropFilter:"blur(16px)"}} onClick={e=>e.stopPropagation()}>
          <div style={{fontSize:10,letterSpacing:2,color:"var(--tx2)",textTransform:"uppercase",marginBottom:4,paddingLeft:4}}>ธีมสี</div>
          {THEMES.map(th=>(
            <button key={th.id} onClick={()=>{onChange(th.id);setOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:th.id===current?"var(--accBg)":"transparent",border:`1px solid ${th.id===current?"var(--acc)":"transparent"}`,borderRadius:10,color:"var(--tx)",fontSize:13,fontWeight:th.id===current?700:400,textAlign:"left"}}>
              <span style={{fontSize:18}}>{th.emoji}</span>
              <div>
                <div style={{lineHeight:1.2}}>{th.name}</div>
                <div style={{display:"flex",gap:3,marginTop:4}}>
                  {[th.bg,th.acc,th.acc2,th.red].map((c,i)=>(
                    <span key={i} style={{width:8,height:8,borderRadius:"50%",background:c,border:"1px solid rgba(0,0,0,.1)",display:"inline-block"}}/>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <button onClick={()=>setOpen(!open)} style={{width:44,height:44,borderRadius:"50%",background:"var(--card)",border:"1px solid var(--br2)",backdropFilter:"blur(16px)",fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(0,0,0,.15)",color:"var(--tx)",transition:"all .2s"}}>
        🎨
      </button>
    </div>
  );
}

// ─── Animated BG ─────────────────────────────────────────────────────────────
function AnimBG({ themeId }) {
  const cvs = useRef(null);
  const themeRef = useRef(themeId);
  useEffect(()=>{ themeRef.current=themeId; },[themeId]);

  useEffect(() => {
    const c = cvs.current; if(!c) return;
    const ctx = c.getContext("2d");
    let W, H, items=[], raf;
    const EMOJIS=["🐶","🐱","🦁","🐯","🐼","🦊","🐰","🦮","🐈","🦄","🐮","🐺","🩺","💉","🩻","🩹","💊","🧬","🌿","🌱","🍃","🐾","🐾","🐾","🐾"];
    const resize = () => { W=c.width=window.innerWidth; H=c.height=window.innerHeight; };
    resize(); window.addEventListener("resize",resize);
    for(let i=0;i<38;i++) items.push({
      x:Math.random()*window.innerWidth, y:Math.random()*window.innerHeight,
      vx:(Math.random()-.5)*.45, vy:(Math.random()-.5)*.38,
      a:Math.random()*Math.PI*2, va:(Math.random()-.5)*.01,
      s:20+Math.random()*26, op:0.06+Math.random()*.13,
      ch:EMOJIS[Math.floor(Math.random()*EMOJIS.length)],
      bo:Math.random()*Math.PI*2, bs:0.018+Math.random()*.025,
    });
    const draw = () => {
      ctx.clearRect(0,0,W,H);
      const th=THEMES.find(x=>x.id===themeRef.current)||THEMES[0];
      // BG gradient
      const g=ctx.createLinearGradient(0,0,W,H);
      g.addColorStop(0,th.bg); g.addColorStop(.5,th.bgB); g.addColorStop(1,th.bgC);
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
      // Subtle orbs
      const orbs=[{x:W*.2,y:H*.3,r:W*.35},{x:W*.78,y:H*.7,r:W*.3}];
      orbs.forEach(o=>{
        const gr=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);
        const alpha=th.dark?"0.04":"0.05";
        gr.addColorStop(0,th.acc.replace("#","rgba(").replace(/^rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i,(_,r,g2,b)=>`rgba(${parseInt(r,16)},${parseInt(g2,16)},${parseInt(b,16)},${alpha})`)||`rgba(52,211,153,${alpha})`);
        gr.addColorStop(1,"transparent");
        ctx.fillStyle=gr; ctx.fillRect(0,0,W,H);
      });
      // Particles
      items.forEach(p=>{
        p.x+=p.vx; p.y+=p.vy+Math.sin(p.bo)*.25; p.a+=p.va; p.bo+=p.bs;
        if(p.x<-70) p.x=W+50; if(p.x>W+70) p.x=-50;
        if(p.y<-70) p.y=H+50; if(p.y>H+70) p.y=-50;
        const baseOp = th.dark ? p.op : p.op * 0.7;
        ctx.save(); ctx.globalAlpha=baseOp; ctx.translate(p.x,p.y); ctx.rotate(p.a);
        ctx.font=`${p.s}px serif`; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(p.ch,0,0); ctx.restore();
      });
      raf=requestAnimationFrame(draw);
    };
    draw();
    return()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",resize); };
  },[]);
  return <canvas ref={cvs} style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none"}}/>;
}

// ─── Global CSS ───────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:'Noto Sans Thai',sans-serif;font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
::selection{background:rgba(52,211,153,.25)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(128,128,128,.2);border-radius:4px}
.card{background:var(--card);border:1px solid var(--br);border-radius:16px;backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}
.card2{background:var(--card2);border:1px solid var(--br2);border-radius:12px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
input,select,textarea{background:var(--card2);border:1px solid var(--br);color:var(--tx);padding:10px 14px;border-radius:10px;font-family:'Noto Sans Thai',sans-serif;font-size:14px;width:100%;outline:none;transition:border .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--accBg)}
input::placeholder,textarea::placeholder{color:var(--tx3)}
select option{background:var(--bg)}
button{cursor:pointer;font-family:'Noto Sans Thai',sans-serif;border:none;border-radius:10px;transition:all .15s;font-size:14px;font-weight:500}
button:hover{filter:brightness(1.06);transform:translateY(-1px)}
button:active{transform:scale(.97) translateY(0)}
.pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.fade{animation:fd .22s ease}
@keyframes fd{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.spin{animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes shake{0%,100%{transform:translateX(0)}30%,70%{transform:translateX(-5px)}50%{transform:translateX(5px)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes pop{0%{transform:scale(.85);opacity:0}100%{transform:scale(1);opacity:1}}
table{border-collapse:collapse;width:100%}
th{padding:9px 14px;text-align:left;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--acc);background:var(--card2);border-bottom:1px solid var(--br);font-weight:700}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid var(--br);color:var(--tx)}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--card2)}
input[type=range]{accent-color:var(--acc);background:transparent;border:none;padding:6px 0;cursor:pointer;width:100%}
.lbl{font-size:11px;color:var(--tx2);display:block;margin-bottom:6px;font-weight:500}
.sec{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--acc);font-weight:700;margin-bottom:14px}
.mono{font-family:'JetBrains Mono',monospace}
`;

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({msg}){
  if(!msg) return null;
  return (
    <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",zIndex:9999,
      background:msg.ok?"var(--acc)":"var(--red)",backdropFilter:"blur(14px)",
      color:"#fff",padding:"11px 22px",borderRadius:50,fontSize:13,fontWeight:600,
      boxShadow:"0 8px 32px rgba(0,0,0,.2)",animation:"pop .2s ease",
      whiteSpace:"nowrap",maxWidth:"88vw",textAlign:"center",display:"flex",alignItems:"center",gap:8}}>
      {msg.ok?"✓":"✗"} {msg.txt}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function Stat({label,value,color,icon}){
  return (
    <div className="card2" style={{padding:"13px 8px",textAlign:"center"}}>
      {icon&&<div style={{fontSize:16,marginBottom:4}}>{icon}</div>}
      <div className="mono" style={{fontSize:22,fontWeight:700,color,lineHeight:1}}>{value}</div>
      <div style={{fontSize:9,color:"var(--tx2)",marginTop:5,lineHeight:1.3}}>{label}</div>
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
  const [themeId,  setTheme] = useState("light");

  const th = THEMES.find(x=>x.id===themeId)||THEMES[0];
  const showToast = (ok,txt) => { setToast({ok,txt}); setTimeout(()=>setToast(null),3500); };

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

  const wrapStyle = { ...themeVars(th), minHeight:"100vh", position:"relative" };

  if(loading) return (
    <div style={{...wrapStyle,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:14}}>
      <style>{CSS}</style><AnimBG themeId={themeId}/>
      <div style={{width:46,height:46,border:`3px solid var(--br2)`,borderTopColor:"var(--acc)",borderRadius:"50%"}} className="spin"/>
      <div style={{color:"var(--tx2)",fontSize:12,letterSpacing:3,textTransform:"uppercase"}}>กำลังโหลด...</div>
    </div>
  );

  return (
    <div style={wrapStyle}>
      <style>{CSS}</style>
      <AnimBG themeId={themeId}/>
      <Toast msg={toast}/>
      <ThemeSwitcher current={themeId} onChange={setTheme}/>
      <div style={{position:"relative",zIndex:1}}>
        {view==="login" && <Login employees={employees} err={err} clinic={clinic} onLogin={login} onRetry={loadAll}/>}
        {view==="dash"  && <Dash user={user} empList={employees} records={records} location={location} gSch={gSch} clinic={clinic} onReloadRec={reloadRec} onReloadEmp={reloadEmp} onLogout={logout} showToast={showToast}/>}
        {view==="admin" && <AdminPanel user={user} employees={employees} records={records} location={location} gSch={gSch} clinic={clinic} onReloadAll={loadAll} onLogout={logout} showToast={showToast}/>}
      </div>
    </div>
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
      <div style={{width:"100%",maxWidth:360,animation:shake?"shake .4s":""}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:80,height:80,background:"var(--accBg)",border:"2px solid var(--acc)",borderRadius:24,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:40,boxShadow:"0 0 40px var(--accBg)"}}>🐾</div>
          <div style={{fontSize:22,fontWeight:800,color:"var(--tx)"}}>{clinic?.name||"คลินิคท่านาสัตวแพทย์"}</div>
          <div style={{color:"var(--tx2)",fontSize:11,marginTop:3,letterSpacing:3,textTransform:"uppercase"}}>Staff Portal</div>
          <div className="mono" style={{fontSize:52,fontWeight:600,color:"var(--acc)",marginTop:16,letterSpacing:4,lineHeight:1}}>
            {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
          </div>
          <div style={{color:"var(--tx2)",fontSize:12,marginTop:6}}>{now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
        </div>
        <div className="card" style={{padding:"26px 26px 22px"}}>
          {err&&<div style={{background:"var(--redBg)",border:"1px solid var(--red)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12,color:"var(--red)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <span>⚠ {err}</span>
            <button onClick={onRetry} style={{background:"none",color:"var(--acc)",border:`1px solid var(--acc)`,padding:"3px 10px",fontSize:11,borderRadius:7,flexShrink:0}}>ลองใหม่</button>
          </div>}
          <div style={{marginBottom:12}}>
            <label className="lbl">รหัสพนักงาน</label>
            <input placeholder="เช่น MAX01" value={id} onChange={e=>setId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} style={{textTransform:"uppercase",fontSize:15,letterSpacing:1}}/>
          </div>
          <div style={{marginBottom:18}}>
            <label className="lbl">รหัส PIN</label>
            <input type="password" placeholder="• • • •" value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} style={{fontSize:20,letterSpacing:6}}/>
          </div>
          {error&&<div style={{background:"var(--redBg)",border:"1px solid var(--red)",borderRadius:9,padding:"10px 14px",marginBottom:14,fontSize:13,color:"var(--red)"}}>✗ {error}</div>}
          <button onClick={go} style={{width:"100%",padding:13,background:`linear-gradient(135deg,var(--acc),var(--acc2))`,color:"#fff",fontWeight:700,fontSize:15,borderRadius:12,boxShadow:"0 4px 20px var(--accBg)",letterSpacing:.5}}>
            เข้าสู่ระบบ →
          </button>
          {employees.length===0&&<div style={{marginTop:10,textAlign:"center",fontSize:11,color:"var(--tx3)"}}>⚠ ไม่พบข้อมูลพนักงาน — เช็ค Google Sheet</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Dash ─────────────────────────────────────────────────────────────────────
function Dash({ user, empList, records, location, gSch, clinic, onReloadRec, onReloadEmp, onLogout, showToast }) {
  const [tab,setTab]=useState("checkin");
  const [gps,setGps]=useState("idle"); const [gd,setGd]=useState(null); const [gMsg,setGMsg]=useState("");
  const [busy,setBusy]=useState(false);
  const [lf,setLf]=useState({type:"sick",start:today(),end:today(),reason:""});
  const [now,setNow]=useState(new Date());
  const [pf,setPf]=useState({});
  const [showEmoji,setShowEmoji]=useState(false);
  const [newPin,setNewPin]=useState(""); const [cfPin,setCfPin]=useState(""); const [showPin,setShowPin]=useState(false);
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);

  const me = empList.find(e=>e.id===user.id)||user;
  useEffect(()=>{ setPf({email:me.email||"",phone:me.phone||"",note:me.note||"",avatar:me.avatar||"🐾"}); },[me.id]);

  const s       = sch(me, gSch);
  const todRec  = records[today()]?.[user.id];
  const st      = STATUS(todRec, s);
  const myRecs  = Object.entries(records).flatMap(([d,r])=>r[user.id]?[{date:d,...r[user.id]}]:[]).sort((a,b)=>b.date.localeCompare(a.date));
  const mo=today().slice(0,7), yr=today().slice(0,4);
  const moRecs     = myRecs.filter(r=>r.date.startsWith(mo));
  const leaveUsed  = myRecs.filter(r=>r.leaveType&&r.date.startsWith(yr)).length;
  const leaveLeft  = Math.max(0,s.maxLeaveDays-leaveUsed);
  const moHrs      = moRecs.reduce((x,r)=>x+(dm(r.checkIn,r.checkOut)||0),0);
  const DAYS_TH    = ["อา","จ","อ","พ","พฤ","ศ","ส"];
  const myWorkDays = s.workDays.split(",").filter(Boolean).map(Number);

  const checkGPS = () => {
    setGps("checking"); setGMsg("");
    if(!navigator.geolocation){ setGps("err"); setGMsg("เบราว์เซอร์ไม่รองรับ GPS"); return; }
    navigator.geolocation.getCurrentPosition(pos=>{
      const{latitude:lat,longitude:lng,accuracy:acc}=pos.coords;
      if(!location?.lat||!location?.lng){ setGps("ok"); setGd({lat,lng,acc,dist:0}); setGMsg("✓ รับพิกัดสำเร็จ"); return; }
      const dist=haversine(lat,lng,+location.lat,+location.lng);
      setGd({lat,lng,acc,dist});
      dist<=(+location.radius||200)?(setGps("ok"),setGMsg(`✓ อยู่ในพื้นที่ — ห่าง ${Math.round(dist)} ม.`)):(setGps("far"),setGMsg(`✗ นอกพื้นที่ — ห่าง ${Math.round(dist)} ม.`));
    },()=>{ setGps("err"); setGMsg("ไม่ได้รับสัญญาณ GPS — อนุญาต Location ก่อน"); },{enableHighAccuracy:true,timeout:14000});
  };

  const doIn  = async () => { if(gps!=="ok"||busy) return; setBusy(true); const r=await call("checkIn",{date:today(),empId:user.id,time:new Date().toISOString(),lat:gd.lat,lng:gd.lng}); r.success?(await onReloadRec(),showToast(true,"เช็คอินสำเร็จ "+ft(new Date().toISOString()))):showToast(false,r.message); setBusy(false); };
  const doOut = async () => { if(gps!=="ok"||busy) return; setBusy(true); const r=await call("checkOut",{date:today(),empId:user.id,time:new Date().toISOString(),lat:gd.lat,lng:gd.lng}); r.success?(await onReloadRec(),showToast(true,"เช็คเอาท์สำเร็จ "+ft(new Date().toISOString()))):showToast(false,r.message); setBusy(false); };
  const doLeave = async () => { if(!lf.reason.trim()){ showToast(false,"กรุณาระบุเหตุผล"); return; } setBusy(true); const r=await call("submitLeave",{empId:user.id,startDate:lf.start,endDate:lf.end,leaveType:lf.type,reason:lf.reason}); r.success?(await onReloadRec(),showToast(true,`ส่งคำขอลาสำเร็จ (${r.days} วัน)`)):showToast(false,r.message); setBusy(false); };
  const saveProfile = async () => { setBusy(true); const r=await call("updateEmployee",{id:user.id,...pf}); r.success?(await onReloadEmp(),showToast(true,"บันทึกโปรไฟล์สำเร็จ")):showToast(false,r.message); setBusy(false); };
  const changePIN = async () => { if(newPin.length<4){ showToast(false,"PIN ต้องมีอย่างน้อย 4 ตัว"); return; } if(newPin!==cfPin){ showToast(false,"PIN ทั้งสองไม่ตรงกัน"); return; } setBusy(true); const r=await call("updateEmployee",{id:user.id,pin:newPin}); r.success?(await onReloadEmp(),showToast(true,"เปลี่ยน PIN สำเร็จ"),setNewPin(""),setCfPin(""),setShowPin(false)):showToast(false,r.message); setBusy(false); };
  const exportCSV = () => {
    const rows=[["วันที่","เข้างาน","ออกงาน","รวม","สถานะ"]];
    myRecs.forEach(r=>{ const st2=STATUS(r,s); rows.push([r.date,ft(r.checkIn),ft(r.checkOut),hm(dm(r.checkIn,r.checkOut)),st2.l]); });
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(x=>x.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"})); a.download=`attendance_${user.id}_${today()}.csv`; a.click();
  };

  const gCol={idle:"var(--tx3)",checking:"var(--yellow)",ok:"var(--acc)",err:"var(--red)",far:"var(--red)"}[gps];
  const canIn  = gps==="ok"&&!todRec?.checkIn&&!todRec?.leaveType&&!busy;
  const canOut = gps==="ok"&&!!todRec?.checkIn&&!todRec?.checkOut&&!busy;

  return (
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

      {/* Clock */}
      <div className="card" style={{padding:"20px",marginBottom:10,textAlign:"center",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,transparent,var(--acc),var(--acc2),transparent)`}}/>
        <div className="mono" style={{fontSize:54,fontWeight:600,color:"var(--acc)",letterSpacing:4,lineHeight:1}}>
          {now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
        </div>
        <div style={{color:"var(--tx2)",fontSize:12,marginTop:5}}>{now.toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginTop:12}}>
          <span className="pill" style={{background:st.bg,color:st.c,border:`1px solid ${st.c}40`}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:st.c,animation:"pulse 2s infinite",display:"inline-block"}}/>
            {st.l}
          </span>
          {todRec?.checkIn&&<span className="pill" style={{background:"var(--accBg)",color:"var(--acc)",border:"1px solid var(--acc)40"}}>▶ {ft(todRec.checkIn)}</span>}
          {todRec?.checkOut&&<span className="pill" style={{background:"var(--redBg)",color:"var(--red)",border:"1px solid var(--red)40"}}>■ {ft(todRec.checkOut)}</span>}
        </div>
        <div style={{marginTop:12,padding:"8px 14px",background:"var(--card2)",borderRadius:10,display:"flex",flexWrap:"wrap",gap:12,justifyContent:"center",fontSize:11,color:"var(--tx2)"}}>
          <span>🕐 {s.startTime}–{s.endTime}</span>
          <span>⏱ ผ่อนผัน {s.graceMins}น.</span>
          {location?.name&&<span>📍 {location.name}</span>}
          <span style={{color:"var(--tx3)"}}>{myWorkDays.map(d=>DAYS_TH[d]).join(" · ")}</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:7}}>
        <Stat label="เข้างาน/เดือน" value={moRecs.filter(r=>r.checkIn&&!r.leaveType).length} color="var(--acc)"/>
        <Stat label="มาสาย" value={moRecs.filter(r=>STATUS(r,s).l.startsWith("มาสาย")).length} color="var(--yellow)"/>
        <Stat label="ลาแล้ว" value={leaveUsed} color="var(--purple)"/>
        <Stat label="วันลาคงเหลือ" value={leaveLeft} color="var(--acc2)"/>
      </div>
      <div className="card2" style={{padding:"9px 16px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:12,color:"var(--tx2)"}}>⏱ ชั่วโมงรวมเดือนนี้</span>
        <span className="mono" style={{fontSize:20,fontWeight:700,color:"var(--acc)"}}>{hm(moHrs)}</span>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:5,marginBottom:12}}>
        {[["checkin","🕐","เช็คอิน"],["history","📋","ประวัติ"],["leave","🌿","ใบลา"],["profile","👤","โปรไฟล์"]].map(([k,ic,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"9px 4px",background:tab===k?"var(--accBg)":"var(--card2)",color:tab===k?"var(--acc)":"var(--tx2)",border:`1px solid ${tab===k?"var(--acc)":"var(--br)"}`,borderRadius:10,fontSize:12,fontWeight:tab===k?700:400}}>
            <span style={{display:"block",fontSize:16,marginBottom:2}}>{ic}</span>{lb}
          </button>
        ))}
      </div>

      {/* CHECKIN */}
      {tab==="checkin"&&(
        <div className="fade">
          <div className="card2" style={{padding:"14px 16px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:gMsg?10:0}}>
              <span style={{fontSize:13,fontWeight:600,color:"var(--tx)"}}>📡 ตรวจสอบพิกัด{location?.name?` · ${location.name}`:""}</span>
              <span style={{fontSize:11,color:gCol,fontWeight:600}}>{{idle:"รอ",checking:"กำลังรับ...",ok:"✓ พร้อม",err:"✗ Error",far:"✗ นอก"}[gps]}</span>
            </div>
            {gMsg&&<div style={{fontSize:12,color:gCol,background:gps==="ok"?"var(--accBg)":"var(--redBg)",border:`1px solid ${gCol}`,borderRadius:8,padding:"8px 12px",marginBottom:10}}>{gMsg}</div>}
            <button onClick={checkGPS} disabled={gps==="checking"} style={{width:"100%",padding:10,background:gps==="ok"?"var(--accBg)":"var(--card)",color:gps==="checking"?"var(--yellow)":gps==="ok"?"var(--acc)":"var(--tx)",border:`1px solid ${gps==="ok"?"var(--acc)":"var(--br)"}`,display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontSize:13,borderRadius:10}}>
              <span className={gps==="checking"?"spin":""} style={{fontSize:16}}>📍</span>
              {gps==="checking"?"กำลังรับสัญญาณ...":"ตรวจสอบพิกัดของฉัน"}
            </button>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            {[
              {lb:"เช็คอิน",icon:"▶ เข้างาน",can:canIn,done:!!todRec?.checkIn,time:todRec?.checkIn,col:"var(--acc)",bg:"var(--accBg)",fn:doIn},
              {lb:"เช็คเอาท์",icon:"■ ออกงาน",can:canOut,done:!!todRec?.checkOut,time:todRec?.checkOut,col:"var(--red)",bg:"var(--redBg)",fn:doOut},
            ].map(b=>(
              <button key={b.lb} onClick={b.fn} disabled={!b.can} style={{padding:"24px 12px",borderRadius:16,textAlign:"center",background:b.can?b.bg:"var(--card2)",color:b.can?b.col:"var(--tx3)",border:`1.5px solid ${b.can?b.col:"var(--br)"}`,opacity:b.done&&!b.can?.5:1,boxShadow:b.can?`0 4px 24px ${b.bg}`:"none",transition:"all .2s"}}>
                <div style={{fontSize:13,fontWeight:600,letterSpacing:.5,marginBottom:6,opacity:.7}}>{b.icon}</div>
                <div style={{fontWeight:800,fontSize:16}}>{b.lb}</div>
                {b.done&&<div className="mono" style={{fontSize:12,marginTop:6,opacity:.75}}>{ft(b.time)}</div>}
              </button>
            ))}
          </div>

          <button onClick={()=>setTab("leave")} style={{width:"100%",padding:11,background:"var(--purpleBg)",color:"var(--purple)",border:"1px solid var(--purple)40",fontSize:13,fontWeight:600,borderRadius:12}}>
            🌿 ส่งคำขอลา — คงเหลือ {leaveLeft} วัน
          </button>
          {gps==="idle"&&<div style={{textAlign:"center",fontSize:12,color:"var(--tx3)",marginTop:14}}>กดตรวจสอบพิกัดก่อนเช็คอิน / เช็คเอาท์</div>}
        </div>
      )}

      {/* HISTORY */}
      {tab==="history"&&(
        <div className="fade">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:12,color:"var(--tx2)"}}>{myRecs.length} รายการ · เดือนนี้ {hm(moHrs)}</span>
            <button onClick={exportCSV} style={{background:"var(--accBg)",color:"var(--acc)",border:"1px solid var(--acc)50",padding:"7px 14px",fontSize:12,fontWeight:700}}>⬇ ดาวน์โหลด CSV</button>
          </div>
          {myRecs.length===0?<div className="card2" style={{padding:50,textAlign:"center",color:"var(--tx3)",fontSize:14}}>📋 ยังไม่มีประวัติ</div>
          :<div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>วันที่</th><th>เข้า</th><th>ออก</th><th>รวม</th><th>สถานะ</th></tr></thead>
              <tbody>{myRecs.map(r=>{ const st2=STATUS(r,s); return(
                <tr key={r.date}>
                  <td style={{fontSize:11,color:"var(--tx2)"}}>{fd(r.date)}</td>
                  <td className="mono" style={{color:"var(--acc)",fontSize:12}}>{ft(r.checkIn)}</td>
                  <td className="mono" style={{color:r.checkOut?"var(--red)":"var(--tx3)",fontSize:12}}>{ft(r.checkOut)}</td>
                  <td className="mono" style={{color:"var(--acc2)",fontSize:12}}>{hm(dm(r.checkIn,r.checkOut))}</td>
                  <td><span className="pill" style={{background:st2.bg,color:st2.c,fontSize:9}}>{st2.l}</span></td>
                </tr>
              ); })}</tbody>
            </table>
          </div>}
        </div>
      )}

      {/* LEAVE */}
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
            <button onClick={doLeave} disabled={busy} style={{marginTop:14,width:"100%",padding:12,background:`linear-gradient(135deg,#5b21b6,#7c3aed)`,color:"#fff",fontWeight:700,borderRadius:12}}>
              {busy?"กำลังส่ง...":"ส่งคำขอลา →"}
            </button>
          </div>
          <div style={{fontSize:12,color:"var(--tx2)",marginBottom:10,paddingLeft:4}}>ใช้ลา {leaveUsed}/{s.maxLeaveDays} วัน ปีนี้</div>
          <div className="card" style={{overflow:"hidden"}}>
            {myRecs.filter(r=>r.leaveType).length===0?<div style={{padding:30,textAlign:"center",color:"var(--tx3)",fontSize:13}}>🌿 ยังไม่มีประวัติการลา</div>
            :<table><thead><tr><th>วันที่</th><th>ประเภท</th><th>เหตุผล</th></tr></thead><tbody>
              {myRecs.filter(r=>r.leaveType).map(r=>{ const st2=STATUS(r,s); return(
                <tr key={r.date}><td style={{fontSize:11}}>{fd(r.date)}</td><td><span className="pill" style={{background:st2.bg,color:st2.c,fontSize:9}}>{st2.l}</span></td><td style={{color:"var(--tx2)",fontSize:12}}>{r.leaveReason||"—"}</td></tr>
              ); })}</tbody></table>}
          </div>
        </div>
      )}

      {/* PROFILE */}
      {tab==="profile"&&(
        <div className="fade">
          <div className="card" style={{padding:20,marginBottom:12}}>
            <div className="sec">ข้อมูลส่วนตัว</div>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:18,paddingBottom:18,borderBottom:"1px solid var(--br)"}}>
              <button onClick={()=>setShowEmoji(true)} style={{width:68,height:68,background:"var(--accBg)",border:`2px dashed var(--acc)`,borderRadius:18,fontSize:36,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,position:"relative"}} title="เปลี่ยน Avatar">
                {pf.avatar||"🐾"}
                <span style={{position:"absolute",bottom:-5,right:-5,background:"var(--acc)",borderRadius:"50%",width:18,height:18,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",border:"2px solid var(--bg)"}}>✏</span>
              </button>
              <div style={{flex:1}}>
                <div style={{fontSize:17,fontWeight:800,color:"var(--tx)",marginBottom:3}}>{me.name}</div>
                <div style={{fontSize:12,color:"var(--tx2)",lineHeight:1.9}}>
                  <div>🪪 {me.id} · {me.role==="admin"?"ผู้ดูแลระบบ":"พนักงาน"}</div>
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
            <button onClick={saveProfile} disabled={busy} style={{marginTop:14,background:`linear-gradient(135deg,var(--acc),var(--acc2))`,color:"#fff",padding:"10px 22px",fontWeight:700,borderRadius:10}}>
              {busy?"กำลังบันทึก...":"บันทึกโปรไฟล์"}
            </button>
          </div>

          <div className="card" style={{padding:20,marginBottom:12}}>
            <div className="sec">ตารางงานของฉัน</div>
            {[["🕐 เวลาทำงาน",`${s.startTime} – ${s.endTime}`,"var(--tx)","mono"],["⏱ ผ่อนผันมาสาย",`${s.graceMins} นาที`,"var(--yellow)","mono"],["📋 วันลาสูงสุด/ปี",`${s.maxLeaveDays} วัน`,"var(--purple)","mono"]].map(([l,v,c,cls])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid var(--br)"}}>
                <span style={{color:"var(--tx2)",fontSize:13}}>{l}</span>
                <span className={cls} style={{color:c,fontWeight:600,fontSize:13}}>{v}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:9}}>
              <span style={{color:"var(--tx2)",fontSize:13}}>📅 วันทำงาน</span>
              <div style={{display:"flex",gap:4}}>
                {["อา","จ","อ","พ","พฤ","ศ","ส"].map((d,i)=>{ const on=s.workDays.split(",").filter(Boolean).map(Number).includes(i); return(
                  <span key={i} style={{width:26,height:26,borderRadius:7,background:on?"var(--accBg)":"var(--card2)",color:on?"var(--acc)":"var(--tx3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:on?700:400,border:`1px solid ${on?"var(--acc)":"var(--br)"}`}}>{d}</span>
                ); })}
              </div>
            </div>
            {me.salary&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:9}}>
              <span style={{color:"var(--tx2)",fontSize:13}}>💰 เงินเดือน</span>
              <span className="mono" style={{color:"var(--acc)",fontWeight:700,fontSize:15}}>{Number(me.salary).toLocaleString("th-TH")} ฿</span>
            </div>}
            <div style={{marginTop:12,fontSize:11,color:"var(--tx3)"}}>* ติดต่อ Admin เพื่อแก้ไขตารางงาน</div>
          </div>

          <div className="card" style={{padding:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showPin?16:0}}>
              <div className="sec" style={{marginBottom:0}}>🔑 เปลี่ยนรหัส PIN</div>
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
function AdminPanel({ user, employees, records, location, gSch, clinic, onReloadAll, onLogout, showToast }) {
  const [tab,setTab]   = useState("overview");
  const [date,setDate] = useState(today());
  const [search,setSearch] = useState("");
  const [selEmp,setSelEmp] = useState(null);
  const [busy,setBusy] = useState(false);

  const [newEmp,setNewEmp] = useState({id:"",name:"",pin:"",position:"",department:"",salary:"",email:"",phone:"",startDate:"",role:"employee"});
  const [lf,setLf] = useState({name:"",lat:"",lng:"",radius:200});
  const [sf,setSf] = useState({startTime:"08:30",endTime:"17:30",graceMins:15,workDays:"1,2,3,4,5",maxLeaveDays:10});
  const [cf,setCf] = useState({name:"คลินิคท่านาสัตวแพทย์",address:"",phone:""});

  useEffect(()=>{ if(location) setLf({name:location.name||"",lat:location.lat||"",lng:location.lng||"",radius:location.radius||200}); },[location]);
  useEffect(()=>{ if(gSch) setSf({startTime:gSch.startTime||"08:30",endTime:gSch.endTime||"17:30",graceMins:gSch.graceMins??15,workDays:gSch.workDays||"1,2,3,4,5",maxLeaveDays:gSch.maxLeaveDays??10}); },[gSch]);
  useEffect(()=>{ if(clinic) setCf({name:clinic.name||"",address:clinic.address||"",phone:clinic.phone||""}); },[clinic]);

  const save = async(key,data) => { setBusy(true); const r=await call("saveConfig",{configKey:key,data:JSON.stringify(data)}); r.success?(await onReloadAll(),showToast(true,"บันทึกสำเร็จ")):showToast(false,r.message); setBusy(false); };
  const addEmp = async () => {
    if(!newEmp.id||!newEmp.name||!newEmp.pin) return showToast(false,"กรอก รหัส / ชื่อ / PIN ให้ครบ");
    if(employees.find(e=>e.id===newEmp.id.toUpperCase())) return showToast(false,"รหัสนี้มีอยู่แล้ว");
    setBusy(true);
    const r=await call("addEmployee",{...newEmp,id:newEmp.id.toUpperCase()});
    r.success?(await onReloadAll(),showToast(true,`เพิ่ม ${newEmp.name} สำเร็จ`),setNewEmp({id:"",name:"",pin:"",position:"",department:"",salary:"",email:"",phone:"",startDate:"",role:"employee"})):showToast(false,r.message);
    setBusy(false);
  };
  const updateEmp = async (fields) => { setBusy(true); const r=await call("updateEmployee",fields); r.success?(await onReloadAll(),showToast(true,"อัปเดตสำเร็จ"),setSelEmp(null)):showToast(false,r.message); setBusy(false); };
  const delEmp = async id => {
    if(id===user.id||!window.confirm(`ลบพนักงาน ${id}?`)) return;
    setBusy(true); const r=await call("deleteEmployee",{id}); r.success?(await onReloadAll(),showToast(true,"ลบแล้ว")):showToast(false,r.message); setBusy(false);
  };
  const exportAll = () => {
    const rows=[["วันที่","รหัส","ชื่อ","ตำแหน่ง","เข้างาน","ออกงาน","รวม","สถานะ"]];
    Object.entries(records).sort((a,b)=>b[0].localeCompare(a[0])).forEach(([d,day])=>{
      Object.entries(day).forEach(([eid,r])=>{ const e=employees.find(x=>x.id===eid),s2=sch(e,gSch),st=STATUS(r,s2); rows.push([d,eid,e?.name||"—",e?.position||"",ft(r.checkIn),ft(r.checkOut),hm(dm(r.checkIn,r.checkOut)),st.l]); });
    });
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(r=>r.join(",")).join("\n")],{type:"text/csv;charset=utf-8;"})); a.download=`attendance_all_${today()}.csv`; a.click();
  };

  const staff   = employees.filter(e=>e.role!=="admin");
  const dayRecs = records[date]||{};
  const filtered = staff.filter(e=>!search||e.name.includes(search)||e.id.includes(search.toUpperCase())||e.department?.includes(search)||e.position?.includes(search));
  const mo=today().slice(0,7);
  const moAll=Object.entries(records).filter(([d])=>d.startsWith(mo)).flatMap(([,d])=>Object.values(d));
  const statHrs=moAll.reduce((s,r)=>s+(dm(r.checkIn,r.checkOut)||0),0);
  const DAYS_TH=["อา","จ","อ","พ","พฤ","ศ","ส"];

  return (
    <div style={{maxWidth:960,margin:"0 auto",padding:"12px 12px 80px"}}>
      {/* Header */}
      <div className="card2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:17,fontWeight:800,color:"var(--tx)"}}>⚙ Admin Panel</div>
          <div style={{fontSize:11,color:"var(--tx2)"}}>{clinic?.name||"คลินิคท่านาสัตวแพทย์"} · {user.name}</div>
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          <button onClick={onReloadAll} style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"7px 14px",fontSize:12}}>🔄</button>
          <button onClick={exportAll}   style={{background:"var(--accBg)",color:"var(--acc)",border:"1px solid var(--acc)50",padding:"7px 14px",fontSize:12,fontWeight:700}}>⬇ CSV ทั้งหมด</button>
          <button onClick={onLogout}    style={{background:"var(--card2)",color:"var(--tx2)",border:"1px solid var(--br)",padding:"7px 14px",fontSize:12}}>ออก</button>
        </div>
      </div>

      {/* Config chips */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
        {[
          {ok:!!(location?.lat&&location?.lng),lb:"📍 พิกัด",detail:location?.lat?`${location.name||""} r=${location.radius}ม.`:"ยังไม่ได้ตั้งค่า",go:"location"},
          {ok:!!gSch?.startTime,lb:"🕐 ตารางงาน",detail:gSch?.startTime?`${gSch.startTime}–${gSch.endTime}`:"ใช้ค่า default",go:"schedule"},
          {ok:!!clinic?.name,lb:"🐾 คลินิค",detail:clinic?.name||"ยังไม่ได้ตั้งค่า",go:"clinicinfo"},
        ].map(b=>(
          <div key={b.go} onClick={()=>setTab(b.go)} className="card2" style={{padding:"10px 12px",cursor:"pointer",borderColor:b.ok?"var(--br2)":"var(--yellow)60",background:b.ok?"var(--card2)":"var(--yellowBg)"}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:b.ok?"var(--acc)":"var(--yellow)",display:"inline-block"}}/>
              <span style={{fontSize:12,fontWeight:700,color:"var(--tx)"}}>{b.lb}</span>
            </div>
            <div style={{fontSize:10,color:"var(--tx2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.detail}</div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>
        <Stat label="พนักงาน" value={staff.length} color="var(--acc2)"/>
        <Stat label="เข้า/เดือน" value={moAll.filter(r=>r.checkIn&&!r.leaveType).length} color="var(--acc)"/>
        <Stat label="ลา/เดือน" value={moAll.filter(r=>r.leaveType).length} color="var(--purple)"/>
        <Stat label="ชม.รวมทีม" value={hm(statHrs)} color="var(--yellow)"/>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:5,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
        {[["overview","📊","ภาพรวม"],["employees","👥","พนักงาน"],["location","📍","พิกัด"],["schedule","🕐","ตารางงาน"],["clinicinfo","🐾","คลินิค"]].map(([k,ic,lb])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:"0 0 auto",padding:"8px 14px",background:tab===k?"var(--accBg)":"var(--card2)",color:tab===k?"var(--acc)":"var(--tx2)",border:`1px solid ${tab===k?"var(--acc)":"var(--br)"}`,borderRadius:10,fontSize:12,fontWeight:tab===k?700:400}}>
            {ic} {lb}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab==="overview"&&(
        <div className="fade">
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:160}}/>
            <input placeholder="ค้นหา..." value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:100}}/>
            <span style={{fontSize:12,color:"var(--tx2)",whiteSpace:"nowrap"}}>{Object.keys(dayRecs).length}/{staff.length} คน</span>
          </div>
          <div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>พนักงาน</th><th>ตำแหน่ง</th><th>เข้า</th><th>ออก</th><th>รวม</th><th>สถานะ</th></tr></thead>
              <tbody>{filtered.map(e=>{ const r=dayRecs[e.id],s2=sch(e,gSch),st=STATUS(r,s2); return(
                <tr key={e.id} onClick={()=>setSelEmp(e)} style={{cursor:"pointer"}}>
                  <td><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:18}}>{e.avatar||"🐾"}</span><div><div style={{fontWeight:600,fontSize:13,color:"var(--tx)"}}>{e.name}</div><div style={{fontSize:10,color:"var(--tx3)"}}>{e.id}</div></div></div></td>
                  <td style={{fontSize:11,color:"var(--tx2)"}}>{e.position||"—"}</td>
                  <td className="mono" style={{color:r?.checkIn?"var(--acc)":"var(--tx3)",fontSize:12}}>{ft(r?.checkIn)}</td>
                  <td className="mono" style={{color:r?.checkOut?"var(--red)":"var(--tx3)",fontSize:12}}>{ft(r?.checkOut)}</td>
                  <td className="mono" style={{color:"var(--acc2)",fontSize:12}}>{r?hm(dm(r.checkIn,r.checkOut)):"—"}</td>
                  <td><span className="pill" style={{background:st.bg,color:st.c,fontSize:9}}>{st.l}</span></td>
                </tr>
              ); })}</tbody>
            </table>
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
            <button onClick={addEmp} disabled={busy} style={{marginTop:14,background:`linear-gradient(135deg,var(--acc),var(--acc2))`,color:"#fff",padding:"10px 22px",fontWeight:700,borderRadius:10}}>
              {busy?"กำลังบันทึก...":"+ เพิ่มพนักงาน"}
            </button>
          </div>
          <div style={{marginBottom:10}}><input placeholder="ค้นหา..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <div className="card" style={{overflow:"hidden"}}>
            <table>
              <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>เวลางาน</th><th>วันลา</th><th></th></tr></thead>
              <tbody>{filtered.map(e=>{ const s2=sch(e,gSch); const used=Object.values(records).flatMap(d=>Object.entries(d)).filter(([eid,r])=>eid===e.id&&r.leaveType&&r.date?.startsWith(today().slice(0,4))).length; const left=Math.max(0,s2.maxLeaveDays-used); const hasCustom=!!(e.workStart||e.workEnd||e.graceMins!=null||e.workDays); return(
                <tr key={e.id} onClick={()=>setSelEmp(e)} style={{cursor:"pointer"}}>
                  <td className="mono" style={{color:"var(--acc)",fontWeight:600,fontSize:12}}>{e.id}</td>
                  <td><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:18}}>{e.avatar||"🐾"}</span><div><div style={{fontWeight:600,fontSize:13,color:"var(--tx)"}}>{e.name}</div><span style={{fontSize:9,padding:"1px 7px",borderRadius:20,background:e.role==="admin"?"var(--yellowBg)":"var(--accBg)",color:e.role==="admin"?"var(--yellow)":"var(--acc)"}}>{e.role==="admin"?"ผู้ดูแล":"พนักงาน"}</span></div></div></td>
                  <td style={{fontSize:11,color:"var(--tx2)"}}>{e.position||"—"}{e.department?`/${e.department}`:""}</td>
                  <td className="mono" style={{fontSize:11}}><span style={{color:hasCustom?"var(--yellow)":"var(--tx2)"}}>{s2.startTime}–{s2.endTime}</span>{hasCustom&&<div style={{fontSize:9,color:"var(--yellow)"}}>⚡ส่วนตัว</div>}</td>
                  <td className="mono" style={{color:"var(--purple)",fontWeight:600}}>{left}/{s2.maxLeaveDays}</td>
                  <td onClick={ev=>{ev.stopPropagation();delEmp(e.id);}}>{e.id!==user.id&&<button style={{background:"var(--redBg)",color:"var(--red)",border:"1px solid var(--red)40",padding:"4px 10px",fontSize:11,borderRadius:7}}>ลบ</button>}</td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* LOCATION */}
      {tab==="location"&&(
        <div className="fade">
          <div className="card2" style={{padding:"12px 16px",marginBottom:14,borderColor:lf.lat&&lf.lng?"var(--acc)50":"var(--yellow)60",background:lf.lat&&lf.lng?"var(--accBg)":"var(--yellowBg)"}}>
            <div style={{fontSize:13,fontWeight:700,color:lf.lat&&lf.lng?"var(--acc)":"var(--yellow)",marginBottom:4}}>{lf.lat&&lf.lng?"✓ ตั้งค่าพิกัดแล้ว":"⚠ ยังไม่ได้ตั้งค่า"}</div>
            {lf.lat&&lf.lng?<div style={{fontSize:12,color:"var(--tx2)",lineHeight:1.8}}><div>📍 {lf.name}</div><div className="mono">Lat {lf.lat} · Lng {lf.lng} · รัศมี {lf.radius}ม.</div></div>:<div style={{fontSize:12,color:"var(--tx3)"}}>พนักงานจะเช็คอินได้แม้อยู่นอกพื้นที่</div>}
          </div>
          <div className="card" style={{padding:20}}>
            <div className="sec">แก้ไขพิกัดสำนักงาน</div>
            <div style={{display:"grid",gap:13}}>
              <div><label className="lbl">ชื่อสถานที่</label><input value={lf.name} onChange={e=>setLf({...lf,name:e.target.value})}/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">Latitude</label><input type="number" step="0.00001" value={lf.lat} onChange={e=>setLf({...lf,lat:e.target.value})}/></div>
                <div><label className="lbl">Longitude</label><input type="number" step="0.00001" value={lf.lng} onChange={e=>setLf({...lf,lng:e.target.value})}/></div>
              </div>
              <div><label className="lbl">รัศมีที่อนุญาต: <strong style={{color:"var(--tx)"}}>{lf.radius} เมตร</strong></label><input type="range" min="50" max="1000" step="25" value={lf.radius} onChange={e=>setLf({...lf,radius:e.target.value})}/></div>
            </div>
            <button onClick={()=>save("location",{name:lf.name,lat:+lf.lat,lng:+lf.lng,radius:+lf.radius})} disabled={busy} style={{marginTop:16,background:`linear-gradient(135deg,var(--acc),var(--acc2))`,color:"#fff",padding:"11px 24px",fontWeight:700,borderRadius:10}}>
              {busy?"กำลังบันทึก...":"บันทึกพิกัด"}
            </button>
          </div>
        </div>
      )}

      {/* SCHEDULE */}
      {tab==="schedule"&&(
        <div className="fade">
          <div className="card2" style={{padding:"11px 16px",marginBottom:14,fontSize:12,color:"var(--tx2)",lineHeight:1.8,borderColor:"var(--yellow)40",background:"var(--yellowBg)"}}>
            <b style={{color:"var(--yellow)"}}>⚡ ตารางงานทั่วไป</b> — ใช้สำหรับพนักงานที่ไม่ได้ตั้งค่าส่วนตัว<br/>
            <span style={{color:"var(--tx3)"}}>ตั้งค่าเฉพาะบุคคล → กดที่ชื่อพนักงาน → แท็บ "ตารางงาน"</span>
          </div>
          <div className="card" style={{padding:20}}>
            <div className="sec">ตารางงาน Default</div>
            <div style={{display:"grid",gap:14}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">เวลาเข้างาน</label><input type="time" value={sf.startTime} onChange={e=>setSf({...sf,startTime:e.target.value})}/></div>
                <div><label className="lbl">เวลาออกงาน</label><input type="time" value={sf.endTime} onChange={e=>setSf({...sf,endTime:e.target.value})}/></div>
              </div>
              <div><label className="lbl">ผ่อนผันมาสาย: <strong>{sf.graceMins} นาที</strong></label><input type="range" min="0" max="60" step="5" value={sf.graceMins} onChange={e=>setSf({...sf,graceMins:+e.target.value})}/></div>
              <div><label className="lbl">วันลาสูงสุด/ปี: <strong>{sf.maxLeaveDays} วัน</strong></label><input type="range" min="1" max="30" step="1" value={sf.maxLeaveDays} onChange={e=>setSf({...sf,maxLeaveDays:+e.target.value})}/></div>
              <div>
                <label className="lbl">วันทำงาน</label>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {DAYS_TH.map((d,i)=>{ const on=sf.workDays.split(",").filter(Boolean).map(Number).includes(i); return(
                    <button key={i} onClick={()=>{ const cur=sf.workDays.split(",").filter(Boolean).map(Number); const nxt=on?cur.filter(x=>x!==i):[...cur,i].sort(); setSf({...sf,workDays:nxt.join(",")}); }} style={{width:44,height:44,borderRadius:10,background:on?"var(--accBg)":"var(--card2)",color:on?"var(--acc)":"var(--tx3)",border:`1px solid ${on?"var(--acc)":"var(--br)"}`,fontWeight:on?700:400,fontSize:13}}>{d}</button>
                  ); })}
                </div>
              </div>
            </div>
            <div style={{marginTop:16,background:"var(--accBg)",border:"1px solid var(--acc)40",borderRadius:10,padding:"12px 16px",fontSize:12,color:"var(--tx2)",lineHeight:2.2}}>
              <div style={{color:"var(--acc)",fontWeight:700,marginBottom:4,fontSize:10,letterSpacing:2}}>PREVIEW</div>
              <div>มาถึง {sf.startTime} → <span style={{color:"var(--acc)",fontWeight:600}}>ตรงเวลา ✓</span></div>
              <div>มาถึง {addMin(sf.startTime,+sf.graceMins+1)} → <span style={{color:"var(--yellow)",fontWeight:600}}>มาสาย {+sf.graceMins+1} นาที</span></div>
              <div>ออก {sf.endTime} → <span style={{color:"var(--acc)",fontWeight:600}}>ครบเวลา ✓</span></div>
            </div>
            <button onClick={()=>save("schedule",{startTime:sf.startTime,endTime:sf.endTime,graceMins:sf.graceMins,workDays:sf.workDays,maxLeaveDays:sf.maxLeaveDays})} disabled={busy} style={{marginTop:16,background:`linear-gradient(135deg,var(--acc),var(--acc2))`,color:"#fff",padding:"11px 24px",fontWeight:700,borderRadius:10}}>
              {busy?"กำลังบันทึก...":"บันทึกตารางงาน"}
            </button>
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
            <button onClick={()=>save("clinic",cf)} disabled={busy} style={{marginTop:16,background:`linear-gradient(135deg,var(--acc),var(--acc2))`,color:"#fff",padding:"11px 24px",fontWeight:700,borderRadius:10}}>
              {busy?"กำลังบันทึก...":"บันทึก"}
            </button>
          </div>
        </div>
      )}

      {selEmp&&<EmpModal emp={selEmp} gSch={gSch} records={records} busy={busy} onSave={updateEmp} onClose={()=>setSelEmp(null)} showToast={showToast}/>}
    </div>
  );
}

// ─── Employee Modal ───────────────────────────────────────────────────────────
function EmpModal({ emp, gSch, records, busy, onSave, onClose, showToast }) {
  const [tab,setTab]=useState("info");
  const [f,setF]=useState({name:emp.name||"",email:emp.email||"",phone:emp.phone||"",position:emp.position||"",department:emp.department||"",salary:emp.salary||"",startDate:emp.startDate||"",workStart:emp.workStart||"",workEnd:emp.workEnd||"",graceMins:emp.graceMins!=null?String(emp.graceMins):"",workDays:emp.workDays||"",maxLeaveDays:emp.maxLeaveDays!=null?String(emp.maxLeaveDays):"",note:emp.note||"",avatar:emp.avatar||"🐾",role:emp.role||"employee"});
  const [newPin,setNewPin]=useState(""); const [cfPin,setCfPin]=useState("");
  const [showEmoji,setShowEmoji]=useState(false);
  const s2=sch(emp,gSch);
  const myRecs=Object.entries(records).flatMap(([d,r])=>r[emp.id]?[{date:d,...r[emp.id]}]:[]).sort((a,b)=>b.date.localeCompare(a.date));
  const leaveUsed=myRecs.filter(r=>r.leaveType&&r.date.startsWith(today().slice(0,4))).length;
  const moHrs=myRecs.filter(r=>r.date.startsWith(today().slice(0,7))).reduce((x,r)=>x+(dm(r.checkIn,r.checkOut)||0),0);
  const DAYS_TH=["อา","จ","อ","พ","พฤ","ศ","ส"];

  const saveInfo=()=>onSave({id:emp.id,name:f.name,email:f.email,phone:f.phone,position:f.position,department:f.department,salary:f.salary,startDate:f.startDate,note:f.note,avatar:f.avatar,role:f.role});
  const saveSch=()=>onSave({id:emp.id,workStart:f.workStart,workEnd:f.workEnd,graceMins:f.graceMins,workDays:f.workDays,maxLeaveDays:f.maxLeaveDays});
  const savePin=()=>{ if(newPin.length<4){showToast(false,"PIN ต้องมีอย่างน้อย 4 ตัว");return;} if(newPin!==cfPin){showToast(false,"PIN ไม่ตรงกัน");return;} onSave({id:emp.id,pin:newPin}); };

  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:14,background:"rgba(0,0,0,.6)",backdropFilter:"blur(8px)"}} onClick={onClose}>
      {showEmoji&&<EmojiPicker value={f.avatar} onChange={av=>setF({...f,avatar:av})} onClose={()=>setShowEmoji(false)}/>}
      <div className="card" style={{width:"100%",maxWidth:500,maxHeight:"90vh",overflow:"auto",padding:0}} onClick={e=>e.stopPropagation()}>
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
          {[["เดือนนี้",hm(moHrs),"var(--acc2)"],["ลาแล้ว/ปี",`${leaveUsed}/${s2.maxLeaveDays}`,"var(--purple)"],["รายการ",`${myRecs.length} วัน`,"var(--tx2)"]].map(([l,v,c])=>(
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
              <button onClick={saveInfo} disabled={busy} style={{background:`linear-gradient(135deg,var(--acc),var(--acc2))`,color:"#fff",padding:10,fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"บันทึกข้อมูล"}</button>
            </div>
          )}
          {tab==="work"&&(
            <div style={{display:"grid",gap:13}}>
              <div style={{background:"var(--yellowBg)",border:"1px solid var(--yellow)50",borderRadius:9,padding:"10px 14px",fontSize:12,color:"var(--yellow)"}}>
                ⚡ ตั้งค่าเฉพาะบุคคล — ปล่อยว่าง = ใช้ Default ({gSch?.startTime||"08:30"}–{gSch?.endTime||"17:30"})
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">เวลาเข้างาน</label><input type="time" value={f.workStart} onChange={e=>setF({...f,workStart:e.target.value})}/></div>
                <div><label className="lbl">เวลาออกงาน</label><input type="time" value={f.workEnd} onChange={e=>setF({...f,workEnd:e.target.value})}/></div>
              </div>
              <div><label className="lbl">ผ่อนผันมาสาย (นาที)</label><input type="number" min="0" max="120" value={f.graceMins} onChange={e=>setF({...f,graceMins:e.target.value})} placeholder={`Default: ${gSch?.graceMins??15}`}/></div>
              <div><label className="lbl">วันลาสูงสุด/ปี</label><input type="number" min="0" max="30" value={f.maxLeaveDays} onChange={e=>setF({...f,maxLeaveDays:e.target.value})} placeholder={`Default: ${gSch?.maxLeaveDays??10}`}/></div>
              <div>
                <label className="lbl">วันทำงาน (ปล่อยว่าง = Default)</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {DAYS_TH.map((d,i)=>{ const cur=f.workDays?f.workDays.split(",").filter(Boolean).map(Number):[]; const on=cur.includes(i); return(
                    <button key={i} onClick={()=>{ const nxt=on?cur.filter(x=>x!==i):[...cur,i].sort(); setF({...f,workDays:nxt.join(",")}); }} style={{width:40,height:40,borderRadius:9,background:on?"var(--accBg)":"var(--card2)",color:on?"var(--acc)":"var(--tx3)",border:`1px solid ${on?"var(--acc)":"var(--br)"}`,fontSize:12,fontWeight:on?700:400}}>{d}</button>
                  ); })}
                  {f.workDays&&<button onClick={()=>setF({...f,workDays:""})} style={{padding:"0 10px",height:40,background:"var(--redBg)",color:"var(--red)",border:"1px solid var(--red)40",fontSize:11,borderRadius:9}}>รีเซ็ต</button>}
                </div>
              </div>
              <button onClick={saveSch} disabled={busy} style={{background:"linear-gradient(135deg,#5b21b6,#7c3aed)",color:"#fff",padding:10,fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"บันทึกตารางงาน"}</button>
            </div>
          )}
          {tab==="pin"&&(
            <div style={{display:"grid",gap:11}}>
              <div style={{background:"var(--redBg)",border:"1px solid var(--red)50",borderRadius:9,padding:"10px 14px",fontSize:12,color:"var(--red)"}}>⚠ การเปลี่ยน PIN จะมีผลทันที</div>
              <div><label className="lbl">PIN ใหม่</label><input type="password" placeholder="••••" value={newPin} onChange={e=>setNewPin(e.target.value)}/></div>
              <div><label className="lbl">ยืนยัน PIN ใหม่</label><input type="password" placeholder="••••" value={cfPin} onChange={e=>setCfPin(e.target.value)}/></div>
              <button onClick={savePin} disabled={busy} style={{background:"linear-gradient(135deg,#b91c1c,#dc2626)",color:"#fff",padding:10,fontWeight:700,borderRadius:10}}>{busy?"กำลังบันทึก...":"ตั้ง PIN ใหม่"}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}