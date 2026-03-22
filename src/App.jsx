import { useState, useEffect } from 'react';

const API_URL =
  'https://script.google.com/macros/s/AKfycbyk5pFcfXtuZm0wUFqswrQxzvgOOkMb9jTViCbktmH7KzIUGr6zhE6pzKMUsS2vUK7x/exec';

// ─── API helpers ──────────────────────────────────────────────────────────────
const api = async (action, params = {}) => {
  try {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`${API_URL}?${qs}`, { redirect: 'follow' });
    const text = await res.text();
    return JSON.parse(text);
  } catch (e) {
    return { success: false, message: e.toString() };
  }
};

// ─── Utilities ─────────────────────────────────────────────────────────────
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const s = String(dateStr).trim();
    const d = s.length === 10 ? new Date(s + 'T00:00:00') : new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return String(dateStr);
  }
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const calcDuration = (inTime, outTime) => {
  if (!inTime || !outTime) return '—';
  try {
    const diff = new Date(outTime) - new Date(inTime);
    if (diff < 0) return '—';
    return `${Math.floor(diff / 3600000)}ชม. ${Math.floor(
      (diff % 3600000) / 60000
    )}น.`;
  } catch {
    return '—';
  }
};

// ─── Icons ────────────────────────────────────────────────────────────────────
const Ic = {
  clock: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 18, height: 18 }}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  pin: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 18, height: 18 }}
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  user: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 18, height: 18 }}
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  download: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 15, height: 15 }}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  logout: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 16, height: 16 }}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  check: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 16, height: 16 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  x: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 16, height: 16 }}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  history: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 18, height: 18 }}
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
    </svg>
  ),
  refresh: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 15, height: 15 }}
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
};

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState({});
  const [locationCfg, setLocationCfg] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState('login');
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    const [empRes, recRes, cfgRes] = await Promise.all([
      api('getEmployees'),
      api('getRecords'),
      api('getConfig'),
    ]);
    if (empRes.success) setEmployees(empRes.data || []);
    if (recRes.success) setRecords(recRes.data || {});
    if (cfgRes.success) setLocationCfg(cfgRes.data);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const login = (user) => {
    setCurrentUser(user);
    setView(user.role === 'admin' ? 'admin' : 'dashboard');
  };
  const logout = () => {
    setCurrentUser(null);
    setView('login');
  };
  const reloadRecords = async () => {
    const res = await api('getRecords');
    if (res.success) setRecords(res.data || {});
  };

  if (loading)
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#0a0a0f',
          color: '#e8e0d4',
          fontFamily: "'DM Mono','Courier New',monospace",
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 48 }}>⏱</div>
        <div style={{ fontSize: 11, letterSpacing: 3, color: '#f5a623' }}>
          กำลังเชื่อมต่อ Google Sheet...
        </div>
        <div
          style={{
            width: 200,
            height: 2,
            background: '#1a1a2a',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              background: '#f5a623',
              animation: 'ld 1.4s ease-in-out infinite',
            }}
          />
        </div>
        <style>{`@keyframes ld{0%{width:0%;margin-left:0}50%{width:70%;margin-left:15%}100%{width:0%;margin-left:100%}}`}</style>
      </div>
    );

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0f',
        fontFamily: "'DM Mono','Courier New',monospace",
        color: '#e8e0d4',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#111}::-webkit-scrollbar-thumb{background:#f5a623;border-radius:2px}
        input,select{background:#111318;border:1px solid #2a2a3a;color:#e8e0d4;padding:10px 14px;border-radius:6px;font-family:'DM Mono',monospace;font-size:14px;width:100%;outline:none;transition:border-color 0.2s}
        input:focus,select:focus{border-color:#f5a623}
        button{cursor:pointer;font-family:'DM Mono',monospace;border:none;border-radius:6px;transition:all 0.15s}
        button:hover{filter:brightness(1.15)}
        .slide-in{animation:slideIn 0.3s ease}
        @keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .spin{animation:spin 1s linear infinite}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        table{border-collapse:collapse;width:100%}
        th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #1e1e2e;font-size:12px}
        th{color:#f5a623;font-size:10px;letter-spacing:2px;text-transform:uppercase;background:#0d0d18}
        tr:hover td{background:#0d0d18}
      `}</style>
      {view === 'login' && <LoginView employees={employees} onLogin={login} />}
      {view === 'dashboard' && (
        <DashboardView
          user={currentUser}
          records={records}
          locationCfg={locationCfg}
          onReload={reloadRecords}
          onLogout={logout}
        />
      )}
      {view === 'admin' && (
        <AdminView
          user={currentUser}
          employees={employees}
          records={records}
          locationCfg={locationCfg}
          onReloadAll={loadAll}
          onLogout={logout}
        />
      )}
    </div>
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────
function LoginView({ employees, onLogin }) {
  const [empId, setEmpId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  const handleLogin = () => {
    const user = employees.find(
      (e) =>
        e.id === empId.trim().toUpperCase() && String(e.pin) === String(pin)
    );
    if (user) {
      onLogin(user);
    } else {
      setError('รหัสพนักงานหรือ PIN ไม่ถูกต้อง');
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at 60% 20%, #1a0f2e 0%, #0a0a0f 60%)',
        }}
      />
      <div
        className="slide-in"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 400,
          background: '#0f0f1a',
          border: '1px solid #1e1e2e',
          borderRadius: 16,
          padding: '48px 40px',
          animation: shake ? 'shake 0.3s' : undefined,
        }}
      >
        <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div
            style={{
              width: 60,
              height: 60,
              background: '#f5a623',
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: 28,
            }}
          >
            ⏱
          </div>
          <h1
            style={{
              fontFamily: "'Bebas Neue',sans-serif",
              fontSize: 32,
              letterSpacing: 4,
              color: '#f5f0e8',
            }}
          >
            TIMECLOCK
          </h1>
          <p
            style={{
              fontSize: 11,
              color: '#555',
              letterSpacing: 2,
              marginTop: 4,
            }}
          >
            ATTENDANCE SYSTEM
          </p>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              fontSize: 10,
              letterSpacing: 2,
              color: '#888',
              display: 'block',
              marginBottom: 8,
            }}
          >
            รหัสพนักงาน
          </label>
          <input
            placeholder="EMP001"
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            style={{ textTransform: 'uppercase' }}
          />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              fontSize: 10,
              letterSpacing: 2,
              color: '#888',
              display: 'block',
              marginBottom: 8,
            }}
          >
            รหัส PIN
          </label>
          <input
            type="password"
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
        </div>
        {error && (
          <div
            style={{
              background: '#2d0f0f',
              border: '1px solid #5a1a1a',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 12,
              color: '#ff6b6b',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            {Ic.x} {error}
          </div>
        )}
        <button
          onClick={handleLogin}
          style={{
            width: '100%',
            padding: 13,
            background: '#f5a623',
            color: '#0a0a0f',
            fontWeight: 500,
            fontSize: 13,
            letterSpacing: 2,
            borderRadius: 8,
          }}
        >
          เข้าสู่ระบบ →
        </button>
        {employees.length === 0 && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#2d1a0a',
              borderRadius: 8,
              fontSize: 11,
              color: '#f5a623',
            }}
          >
            ⚠ ยังไม่มีข้อมูลพนักงาน — กรุณาเพิ่มข้อมูลใน Google Sheet แท็บ
            employees ก่อน
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
function DashboardView({ user, records, locationCfg, onReload, onLogout }) {
  const [tab, setTab] = useState('checkin');
  const [gpsStatus, setGpsStatus] = useState('idle');
  const [gpsData, setGpsData] = useState(null);
  const [gpsMsg, setGpsMsg] = useState('');
  const [actionMsg, setActionMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const todayRec = records[todayKey()]?.[user.id];
  const allMyRecords = Object.entries(records)
    .flatMap(([date, dayRecs]) =>
      dayRecs[user.id] ? [{ date, ...dayRecs[user.id] }] : []
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  const checkGPS = () => {
    setGpsStatus('checking');
    setGpsMsg('');
    if (!navigator.geolocation) {
      setGpsStatus('error');
      setGpsMsg('เบราว์เซอร์ไม่รองรับ GPS');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (!locationCfg?.lat) {
          setGpsStatus('ok');
          setGpsData({ lat: latitude, lng: longitude, accuracy, dist: 0 });
          setGpsMsg('✓ รับพิกัดสำเร็จ');
          return;
        }
        const dist = haversineDistance(
          latitude,
          longitude,
          locationCfg.lat,
          locationCfg.lng
        );
        setGpsData({ lat: latitude, lng: longitude, accuracy, dist });
        if (dist <= locationCfg.radius) {
          setGpsStatus('ok');
          setGpsMsg(`✓ อยู่ในพื้นที่ (ห่าง ${Math.round(dist)} ม.)`);
        } else {
          setGpsStatus('outrange');
          setGpsMsg(
            `✗ นอกพื้นที่ (ห่าง ${Math.round(dist)} ม. | ขอบเขต ${
              locationCfg.radius
            } ม.)`
          );
        }
      },
      () => {
        setGpsStatus('error');
        setGpsMsg('ไม่สามารถรับพิกัด กรุณาอนุญาต GPS');
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const showMsg = (type, text) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  };

  const doCheckIn = async () => {
    if (gpsStatus !== 'ok' || submitting) return;
    setSubmitting(true);
    const res = await api('checkIn', {
      date: todayKey(),
      empId: user.id,
      time: new Date().toISOString(),
      lat: gpsData.lat,
      lng: gpsData.lng,
    });
    if (res.success) {
      await onReload();
      showMsg(
        'success',
        `เช็คอินสำเร็จ ${formatTime(new Date().toISOString())}`
      );
    } else showMsg('error', res.message || 'เกิดข้อผิดพลาด');
    setSubmitting(false);
  };

  const doCheckOut = async () => {
    if (gpsStatus !== 'ok' || submitting) return;
    setSubmitting(true);
    const res = await api('checkOut', {
      date: todayKey(),
      empId: user.id,
      time: new Date().toISOString(),
      lat: gpsData.lat,
      lng: gpsData.lng,
    });
    if (res.success) {
      await onReload();
      showMsg(
        'success',
        `เช็คเอาท์สำเร็จ ${formatTime(new Date().toISOString())}`
      );
    } else showMsg('error', res.message || 'เกิดข้อผิดพลาด');
    setSubmitting(false);
  };

  const exportCSV = () => {
    const rows = [
      ['วันที่', 'เช็คอิน', 'เช็คเอาท์', 'ชั่วโมงทำงาน', 'พิกัดเช็คอิน'],
    ];
    allMyRecords.forEach((r) =>
      rows.push([
        r.date,
        formatTime(r.checkIn),
        formatTime(r.checkOut),
        calcDuration(r.checkIn, r.checkOut),
        r.checkInLat ? `${r.checkInLat},${r.checkInLng}` : '—',
      ])
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob(['\uFEFF' + rows.map((r) => r.join(',')).join('\n')], {
        type: 'text/csv;charset=utf-8;',
      })
    );
    a.download = `attendance_${user.id}_${todayKey()}.csv`;
    a.click();
  };

  const gpsColor = {
    idle: '#555',
    checking: '#f5a623',
    ok: '#4ade80',
    error: '#ff6b6b',
    outrange: '#ff6b6b',
  }[gpsStatus];
  const canCheckIn = gpsStatus === 'ok' && !todayRec?.checkIn && !submitting;
  const canCheckOut =
    gpsStatus === 'ok' &&
    !!todayRec?.checkIn &&
    !todayRec?.checkOut &&
    !submitting;

  return (
    <div style={{ maxWidth: 660, margin: '0 auto', padding: '24px 16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "'Bebas Neue',sans-serif",
              fontSize: 26,
              letterSpacing: 3,
              color: '#f5f0e8',
            }}
          >
            TIMECLOCK
          </h1>
          <div style={{ fontSize: 11, color: '#888' }}>
            👋 {user.name} · {user.id}
          </div>
        </div>
        <button
          onClick={onLogout}
          style={{
            background: '#1a1a2a',
            color: '#888',
            padding: '8px 14px',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {Ic.logout} ออก
        </button>
      </div>

      <div
        style={{
          background: '#0f0f1a',
          border: '1px solid #1e1e2e',
          borderRadius: 16,
          padding: '28px',
          textAlign: 'center',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontFamily: "'Bebas Neue',sans-serif",
            fontSize: 60,
            letterSpacing: 6,
            color: '#f5a623',
            lineHeight: 1,
          }}
        >
          {now.toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
          {now.toLocaleDateString('th-TH', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginTop: 12,
            fontSize: 11,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: todayRec?.checkIn ? '#4ade80' : '#555',
              display: 'inline-block',
            }}
          />
          <span style={{ color: todayRec?.checkIn ? '#4ade80' : '#555' }}>
            {todayRec?.checkIn
              ? `เช็คอิน ${formatTime(todayRec.checkIn)}`
              : 'ยังไม่ได้เช็คอิน'}
          </span>
          {todayRec?.checkOut && (
            <span style={{ color: '#f87171' }}>
              {' '}
              · เช็คเอาท์ {formatTime(todayRec.checkOut)}
            </span>
          )}
        </div>
        {locationCfg?.name && (
          <div style={{ fontSize: 10, color: '#444', marginTop: 6 }}>
            📍 {locationCfg.name}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          ['checkin', Ic.clock, 'เช็คอิน/เอาท์'],
          ['history', Ic.history, 'ประวัติ'],
        ].map(([key, icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1,
              padding: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              background: tab === key ? '#f5a623' : '#0f0f1a',
              color: tab === key ? '#0a0a0f' : '#666',
              border: `1px solid ${tab === key ? '#f5a623' : '#1e1e2e'}`,
              fontSize: 13,
              borderRadius: 10,
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'checkin' && (
        <div className="slide-in">
          <div
            style={{
              background: '#0f0f1a',
              border: '1px solid #1e1e2e',
              borderRadius: 12,
              padding: 20,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 12,
                  color: '#888',
                }}
              >
                {Ic.pin} ตรวจสอบพิกัด
              </div>
              <span style={{ fontSize: 11, color: gpsColor }}>
                {
                  {
                    idle: 'รอตรวจสอบ',
                    checking: 'รับสัญญาณ...',
                    ok: '✓ พร้อมใช้งาน',
                    error: '✗ ข้อผิดพลาด',
                    outrange: '✗ นอกพื้นที่',
                  }[gpsStatus]
                }
              </span>
            </div>
            {gpsMsg && (
              <div
                style={{
                  fontSize: 12,
                  color: gpsColor,
                  background: `${gpsColor}15`,
                  border: `1px solid ${gpsColor}30`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  marginBottom: 12,
                }}
              >
                {gpsMsg}
              </div>
            )}
            <button
              onClick={checkGPS}
              disabled={gpsStatus === 'checking'}
              style={{
                width: '100%',
                padding: 11,
                background: '#1a1a2a',
                color: gpsStatus === 'checking' ? '#f5a623' : '#e8e0d4',
                border: '1px solid #2a2a3a',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                borderRadius: 8,
              }}
            >
              <span className={gpsStatus === 'checking' ? 'spin' : ''}>
                {Ic.pin}
              </span>
              {gpsStatus === 'checking'
                ? 'กำลังรับสัญญาณ GPS...'
                : 'ตรวจสอบพิกัดของฉัน'}
            </button>
          </div>

          {actionMsg && (
            <div
              style={{
                background: actionMsg.type === 'error' ? '#2d0f0f' : '#0f2a1a',
                border: `1px solid ${
                  actionMsg.type === 'error' ? '#5a1a1a' : '#1a5a2a'
                }`,
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: 14,
                fontSize: 13,
                color: actionMsg.type === 'error' ? '#ff6b6b' : '#4ade80',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {actionMsg.type === 'error' ? Ic.x : Ic.check} {actionMsg.text}
            </div>
          )}

          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            <button
              onClick={doCheckIn}
              disabled={!canCheckIn}
              style={{
                padding: '22px 16px',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 500,
                background: canCheckIn ? '#4ade80' : '#0f1a0f',
                color: canCheckIn ? '#0a0a0f' : '#1a3a1a',
                border: '1px solid #1a3a1a',
                opacity: todayRec?.checkIn ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 26, marginBottom: 6 }}>→</div>
              <div>เช็คอิน</div>
              {todayRec?.checkIn && (
                <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>
                  {formatTime(todayRec.checkIn)}
                </div>
              )}
              {submitting && (
                <div style={{ fontSize: 10, marginTop: 4 }}>บันทึก...</div>
              )}
            </button>
            <button
              onClick={doCheckOut}
              disabled={!canCheckOut}
              style={{
                padding: '22px 16px',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 500,
                background: canCheckOut ? '#f87171' : '#1a0f0f',
                color: canCheckOut ? '#0a0a0f' : '#3a1a1a',
                border: '1px solid #3a1a1a',
                opacity: !todayRec?.checkIn || todayRec?.checkOut ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 26, marginBottom: 6 }}>←</div>
              <div>เช็คเอาท์</div>
              {todayRec?.checkOut && (
                <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>
                  {formatTime(todayRec.checkOut)}
                </div>
              )}
              {submitting && (
                <div style={{ fontSize: 10, marginTop: 4 }}>บันทึก...</div>
              )}
            </button>
          </div>
          {gpsStatus === 'idle' && (
            <div
              style={{
                textAlign: 'center',
                fontSize: 11,
                color: '#444',
                marginTop: 14,
              }}
            >
              กดตรวจสอบพิกัดก่อน แล้วจึงเช็คอิน/เอาท์ได้
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="slide-in">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 12, color: '#666' }}>
              {allMyRecords.length} รายการ
            </div>
            <button
              onClick={exportCSV}
              style={{
                background: '#f5a623',
                color: '#0a0a0f',
                padding: '8px 14px',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 8,
              }}
            >
              {Ic.download} ส่งออก CSV
            </button>
          </div>
          {allMyRecords.length === 0 ? (
            <div
              style={{ textAlign: 'center', color: '#444', padding: '60px 0' }}
            >
              ยังไม่มีประวัติ
            </div>
          ) : (
            <div
              style={{
                background: '#0f0f1a',
                border: '1px solid #1e1e2e',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <table>
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>เช็คอิน</th>
                    <th>เช็คเอาท์</th>
                    <th>รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {allMyRecords.map((r) => (
                    <tr key={r.date}>
                      <td style={{ color: '#e8e0d4' }}>{formatDate(r.date)}</td>
                      <td style={{ color: '#4ade80' }}>
                        {formatTime(r.checkIn)}
                      </td>
                      <td style={{ color: r.checkOut ? '#f87171' : '#555' }}>
                        {formatTime(r.checkOut)}
                      </td>
                      <td style={{ color: '#f5a623' }}>
                        {calcDuration(r.checkIn, r.checkOut)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Admin ────────────────────────────────────────────────────────────────────
function AdminView({
  user,
  employees,
  records,
  locationCfg,
  onReloadAll,
  onLogout,
}) {
  const [tab, setTab] = useState('overview');
  const [filterDate, setFilterDate] = useState(todayKey());
  const [newEmp, setNewEmp] = useState({ id: '', name: '', pin: '' });
  const [locForm, setLocForm] = useState({
    name: locationCfg?.name || '',
    lat: locationCfg?.lat || '',
    lng: locationCfg?.lng || '',
    radius: locationCfg?.radius || 200,
  });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (locationCfg)
      setLocForm({
        name: locationCfg.name || '',
        lat: locationCfg.lat || '',
        lng: locationCfg.lng || '',
        radius: locationCfg.radius || 200,
      });
  }, [locationCfg]);

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3500);
  };

  const addEmployee = async () => {
    if (!newEmp.id || !newEmp.name || !newEmp.pin)
      return showMsg('กรอกข้อมูลให้ครบ', 'error');
    if (employees.find((e) => e.id === newEmp.id.toUpperCase()))
      return showMsg('รหัสพนักงานนี้มีอยู่แล้ว', 'error');
    setBusy(true);
    const res = await api('addEmployee', {
      id: newEmp.id.toUpperCase(),
      name: newEmp.name,
      pin: newEmp.pin,
      role: 'employee',
    });
    if (res.success) {
      await onReloadAll();
      setNewEmp({ id: '', name: '', pin: '' });
      showMsg(`เพิ่ม ${newEmp.name} สำเร็จ ✓`);
    } else showMsg(res.message || 'เกิดข้อผิดพลาด', 'error');
    setBusy(false);
  };

  const removeEmployee = async (id) => {
    if (id === user.id || !window.confirm(`ลบพนักงาน ${id} ?`)) return;
    setBusy(true);
    const res = await api('deleteEmployee', { id });
    if (res.success) {
      await onReloadAll();
      showMsg('ลบพนักงานแล้ว');
    } else showMsg(res.message || 'เกิดข้อผิดพลาด', 'error');
    setBusy(false);
  };

  const saveLocation = async () => {
    if (!locForm.lat || !locForm.lng)
      return showMsg('กรอกพิกัดให้ครบ', 'error');
    setBusy(true);
    const res = await api('saveConfig', {
      data: JSON.stringify({
        name: locForm.name,
        lat: parseFloat(locForm.lat),
        lng: parseFloat(locForm.lng),
        radius: parseInt(locForm.radius),
      }),
    });
    if (res.success) {
      await onReloadAll();
      showMsg('บันทึกพิกัดสำเร็จ ✓');
    } else showMsg(res.message || 'เกิดข้อผิดพลาด', 'error');
    setBusy(false);
  };

  const exportAllCSV = () => {
    const rows = [
      [
        'วันที่',
        'รหัสพนักงาน',
        'ชื่อ',
        'เช็คอิน',
        'เช็คเอาท์',
        'ชั่วโมงทำงาน',
        'พิกัดเช็คอิน',
      ],
    ];
    Object.entries(records)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .forEach(([date, dayRecs]) => {
        Object.entries(dayRecs).forEach(([empId, rec]) => {
          const emp = employees.find((e) => e.id === empId);
          rows.push([
            date,
            empId,
            emp?.name || '—',
            formatTime(rec.checkIn),
            formatTime(rec.checkOut),
            calcDuration(rec.checkIn, rec.checkOut),
            rec.checkInLat ? `${rec.checkInLat},${rec.checkInLng}` : '—',
          ]);
        });
      });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob(['\uFEFF' + rows.map((r) => r.join(',')).join('\n')], {
        type: 'text/csv;charset=utf-8;',
      })
    );
    a.download = `attendance_all_${todayKey()}.csv`;
    a.click();
  };

  const dayRecords = records[filterDate] || {};
  const staffEmployees = employees.filter((e) => e.role !== 'admin');

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "'Bebas Neue',sans-serif",
              fontSize: 26,
              letterSpacing: 3,
              color: '#f5f0e8',
            }}
          >
            ADMIN PANEL
          </h1>
          <div style={{ fontSize: 11, color: '#888' }}>
            TIMECLOCK · {user.name}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={onReloadAll}
            style={{
              background: '#1a1a2a',
              color: '#888',
              padding: '8px 12px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              borderRadius: 8,
            }}
          >
            {Ic.refresh} รีเฟรช
          </button>
          <button
            onClick={exportAllCSV}
            style={{
              background: '#f5a623',
              color: '#0a0a0f',
              padding: '8px 14px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              borderRadius: 8,
            }}
          >
            {Ic.download} CSV ทั้งหมด
          </button>
          <button
            onClick={onLogout}
            style={{
              background: '#1a1a2a',
              color: '#888',
              padding: '8px 12px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              borderRadius: 8,
            }}
          >
            {Ic.logout} ออก
          </button>
        </div>
      </div>

      {msg && (
        <div
          style={{
            background: msg.type === 'error' ? '#2d0f0f' : '#0f2a1a',
            border: `1px solid ${msg.type === 'error' ? '#5a1a1a' : '#1a5a2a'}`,
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
            color: msg.type === 'error' ? '#ff6b6b' : '#4ade80',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {msg.type === 'error' ? Ic.x : Ic.check} {msg.text}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3,1fr)',
          gap: 10,
          marginBottom: 20,
        }}
      >
        {[
          ['พนักงานทั้งหมด', staffEmployees.length, '#f5a623'],
          [
            'เข้างานวันนี้',
            Object.keys(records[todayKey()] || {}).length,
            '#4ade80',
          ],
          [
            'รายการทั้งหมด',
            Object.values(records).reduce(
              (s, d) => s + Object.keys(d).length,
              0
            ),
            '#60a5fa',
          ],
        ].map(([label, val, color]) => (
          <div
            key={label}
            style={{
              background: '#0f0f1a',
              border: '1px solid #1e1e2e',
              borderRadius: 12,
              padding: '16px 20px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: "'Bebas Neue',sans-serif",
                fontSize: 36,
                color,
                lineHeight: 1,
              }}
            >
              {val}
            </div>
            <div
              style={{
                fontSize: 10,
                color: '#555',
                marginTop: 6,
                letterSpacing: 1,
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[
          ['overview', Ic.clock, 'ภาพรวม'],
          ['employees', Ic.user, 'พนักงาน'],
          ['location', Ic.pin, 'พิกัด'],
        ].map(([key, icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '9px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: tab === key ? '#f5a623' : '#0f0f1a',
              color: tab === key ? '#0a0a0f' : '#666',
              border: `1px solid ${tab === key ? '#f5a623' : '#1e1e2e'}`,
              fontSize: 13,
              borderRadius: 10,
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="slide-in">
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginBottom: 16,
              alignItems: 'center',
            }}
          >
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              style={{ maxWidth: 200 }}
            />
            <span style={{ fontSize: 12, color: '#666' }}>
              {Object.keys(dayRecords).length}/{staffEmployees.length} คนเข้างาน
            </span>
          </div>
          <div
            style={{
              background: '#0f0f1a',
              border: '1px solid #1e1e2e',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <table>
              <thead>
                <tr>
                  <th>พนักงาน</th>
                  <th>เช็คอิน</th>
                  <th>เช็คเอาท์</th>
                  <th>รวม</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {staffEmployees.map((emp) => {
                  const rec = dayRecords[emp.id];
                  return (
                    <tr key={emp.id}>
                      <td>
                        <div style={{ color: '#e8e0d4' }}>{emp.name}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>
                          {emp.id}
                        </div>
                      </td>
                      <td style={{ color: rec?.checkIn ? '#4ade80' : '#333' }}>
                        {formatTime(rec?.checkIn)}
                      </td>
                      <td style={{ color: rec?.checkOut ? '#f87171' : '#333' }}>
                        {formatTime(rec?.checkOut)}
                      </td>
                      <td style={{ color: '#f5a623' }}>
                        {rec ? calcDuration(rec.checkIn, rec.checkOut) : '—'}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: 10,
                            padding: '3px 8px',
                            borderRadius: 20,
                            background: !rec
                              ? '#1a1a0a'
                              : rec.checkOut
                              ? '#0f2a0f'
                              : '#0f1a2a',
                            color: !rec
                              ? '#666'
                              : rec.checkOut
                              ? '#4ade80'
                              : '#60a5fa',
                            border: `1px solid ${
                              !rec
                                ? '#2a2a1a'
                                : rec.checkOut
                                ? '#1a5a1a'
                                : '#1a3a5a'
                            }`,
                          }}
                        >
                          {!rec ? 'ขาด' : rec.checkOut ? 'ครบ' : 'ทำงาน'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'employees' && (
        <div className="slide-in">
          <div
            style={{
              background: '#0f0f1a',
              border: '1px solid #1e1e2e',
              borderRadius: 12,
              padding: 20,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#f5a623',
                letterSpacing: 2,
                marginBottom: 16,
              }}
            >
              เพิ่มพนักงานใหม่
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 2fr 1fr',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <input
                placeholder="รหัส (EMP003)"
                value={newEmp.id}
                onChange={(e) =>
                  setNewEmp({ ...newEmp, id: e.target.value.toUpperCase() })
                }
              />
              <input
                placeholder="ชื่อ-นามสกุล"
                value={newEmp.name}
                onChange={(e) => setNewEmp({ ...newEmp, name: e.target.value })}
              />
              <input
                placeholder="PIN"
                type="password"
                value={newEmp.pin}
                onChange={(e) => setNewEmp({ ...newEmp, pin: e.target.value })}
              />
            </div>
            <button
              onClick={addEmployee}
              disabled={busy}
              style={{
                background: busy ? '#555' : '#f5a623',
                color: '#0a0a0f',
                padding: '10px 20px',
                fontSize: 13,
                borderRadius: 8,
              }}
            >
              {busy ? 'กำลังบันทึก...' : '+ เพิ่มพนักงาน'}
            </button>
          </div>
          <div
            style={{
              background: '#0f0f1a',
              border: '1px solid #1e1e2e',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <table>
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อ</th>
                  <th>บทบาท</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td style={{ color: '#f5a623' }}>{emp.id}</td>
                    <td style={{ color: '#e8e0d4' }}>{emp.name}</td>
                    <td>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 20,
                          background:
                            emp.role === 'admin' ? '#2a1a0a' : '#0a1a2a',
                          color: emp.role === 'admin' ? '#f5a623' : '#60a5fa',
                          border: `1px solid ${
                            emp.role === 'admin' ? '#5a3a1a' : '#1a3a5a'
                          }`,
                        }}
                      >
                        {emp.role === 'admin' ? 'ผู้ดูแล' : 'พนักงาน'}
                      </span>
                    </td>
                    <td>
                      {emp.id !== user.id && (
                        <button
                          onClick={() => removeEmployee(emp.id)}
                          disabled={busy}
                          style={{
                            background: '#2d0f0f',
                            color: '#ff6b6b',
                            padding: '4px 10px',
                            fontSize: 11,
                            borderRadius: 6,
                          }}
                        >
                          ลบ
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'location' && (
        <div className="slide-in">
          <div
            style={{
              background: '#0f0f1a',
              border: '1px solid #1e1e2e',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#f5a623',
                letterSpacing: 2,
                marginBottom: 20,
              }}
            >
              ตั้งค่าพิกัดสำนักงาน
            </div>
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <label
                  style={{
                    fontSize: 10,
                    color: '#666',
                    letterSpacing: 2,
                    display: 'block',
                    marginBottom: 8,
                  }}
                >
                  ชื่อสถานที่
                </label>
                <input
                  value={locForm.name}
                  onChange={(e) =>
                    setLocForm({ ...locForm, name: e.target.value })
                  }
                  placeholder="ออฟฟิศบางแก้ว"
                />
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: 10,
                      color: '#666',
                      letterSpacing: 2,
                      display: 'block',
                      marginBottom: 8,
                    }}
                  >
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="0.00001"
                    value={locForm.lat}
                    onChange={(e) =>
                      setLocForm({ ...locForm, lat: e.target.value })
                    }
                    placeholder="13.80000"
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: 10,
                      color: '#666',
                      letterSpacing: 2,
                      display: 'block',
                      marginBottom: 8,
                    }}
                  >
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="0.00001"
                    value={locForm.lng}
                    onChange={(e) =>
                      setLocForm({ ...locForm, lng: e.target.value })
                    }
                    placeholder="100.18000"
                  />
                </div>
              </div>
              <div>
                <label
                  style={{
                    fontSize: 10,
                    color: '#666',
                    letterSpacing: 2,
                    display: 'block',
                    marginBottom: 8,
                  }}
                >
                  รัศมีที่อนุญาต: {locForm.radius} เมตร
                </label>
                <input
                  type="range"
                  min="50"
                  max="1000"
                  step="50"
                  value={locForm.radius}
                  onChange={(e) =>
                    setLocForm({ ...locForm, radius: e.target.value })
                  }
                  style={{
                    width: '100%',
                    accentColor: '#f5a623',
                    background: 'transparent',
                    border: 'none',
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    color: '#444',
                    marginTop: 4,
                  }}
                >
                  <span>50ม.</span>
                  <span>1,000ม.</span>
                </div>
              </div>
            </div>
            <button
              onClick={saveLocation}
              disabled={busy}
              style={{
                marginTop: 20,
                background: busy ? '#555' : '#f5a623',
                color: '#0a0a0f',
                padding: '11px 24px',
                fontSize: 13,
                borderRadius: 8,
              }}
            >
              {busy ? 'กำลังบันทึก...' : 'บันทึกพิกัด →'}
            </button>
            <div
              style={{
                marginTop: 20,
                background: '#0a0a0f',
                borderRadius: 10,
                padding: 16,
                fontSize: 12,
                color: '#555',
                lineHeight: 2.2,
              }}
            >
              <div style={{ color: '#888', marginBottom: 4 }}>
                📍 วิธีหาพิกัดออฟฟิศ:
              </div>
              <div>
                1. เปิด Google Maps → ค้นหา{' '}
                <span style={{ color: '#f5a623' }}>Q5WC+5PW นครชัยศรี</span>
              </div>
              <div>
                2. กดค้างที่ pin → พิกัดแสดงด้านล่าง เช่น 13.8012, 100.1845
              </div>
              <div>3. กรอกค่า Lat / Lng แล้วกดบันทึก</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
