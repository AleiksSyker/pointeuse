import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Play, Pause, Square, Flame, BarChart3, Printer } from 'lucide-react';

const POLES = [
  {
    id: 'coordination',
    label: 'Pôle coordination',
    color: '#5B6770',
    categories: [
      { id: 'mails', label: 'Gestion mails', color: '#5B6770' },
      { id: 'matrices', label: 'Matrices & tableaux Edantes / Hachette / boutique', color: '#A6803C' },
      { id: 'edito', label: 'Édito', color: '#B4432D' },
      { id: 'coord-gen', label: 'Coordination', color: '#3B5D42' },
      { id: 'retroplannings', label: 'Rétroplannings', color: '#4A5D8A' },
      { id: 'collectors', label: 'Gestion collectors & beaux-livres', color: '#7A4B6B' },
      { id: 'administratif', label: 'Administratif', color: '#6B6560' },
      { id: 'cycles', label: 'Préparation des cycles', color: '#9C5B3C' },
      { id: 'reunions-ext', label: 'Réunions externes', color: '#3A7D7A' },
      { id: 'reunions-int', label: 'Réunions & appels internes', color: '#8A3B4A' },
    ],
  },
  {
    id: 'production',
    label: 'Pôle production',
    color: '#B4432D',
    categories: [
      { id: 'maquette', label: 'Maquette', color: '#3A362F' },
      { id: 'epubs', label: 'Epubs', color: '#556B4E' },
      { id: 'couverture', label: 'Couverture', color: '#B0713C' },
      { id: 'graph', label: 'Graph', color: '#4A4A78' },
      { id: 'correction', label: 'Correction / BAT', color: '#8B6F47' },
    ],
  },
];

const ALL_CATEGORIES = POLES.flatMap(p => p.categories.map(c => ({ ...c, poleId: p.id, poleLabel: p.label })));

const DAILY_GOAL = 120;

function todayStr(d = new Date()) { return d.toISOString().slice(0, 10); }
function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtHM(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
function catInfo(id) { return ALL_CATEGORIES.find(c => c.id === id) || ALL_CATEGORIES[0]; }
function poleInfo(id) { return POLES.find(p => p.id === id) || POLES[0]; }

function computeStreak(dates) {
  const uniq = Array.from(new Set(dates)).sort().reverse();
  if (uniq.length === 0) return 0;
  const today = todayStr();
  const yesterday = todayStr(new Date(Date.now() - 86400000));
  if (uniq[0] !== today && uniq[0] !== yesterday) return 0;
  let streak = 1;
  let expected = new Date(uniq[0] + 'T00:00:00');
  for (let i = 1; i < uniq.length; i++) {
    expected.setDate(expected.getDate() - 1);
    if (uniq[i] === todayStr(expected)) streak++;
    else break;
  }
  return streak;
}

function buildReportData(sessions) {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = todayStr(d);
    const label = d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
    const entry = { date: key, label };
    ALL_CATEGORIES.forEach(c => { entry[c.id] = 0; });
    sessions.filter(s => s.date === key).forEach(s => {
      entry[s.category] = (entry[s.category] || 0) + s.minutes;
    });
    days.push(entry);
  }
  return days;
}

const StampSVG = ({ color, label, minutes }) => (
  <svg viewBox="0 0 200 200" width={190} height={190} style={{ transform: 'rotate(-9deg)' }}>
    <circle cx="100" cy="100" r="88" fill="none" stroke={color} strokeWidth={3} strokeDasharray="3 3" opacity="0.9" />
    <circle cx="100" cy="100" r="74" fill="none" stroke={color} strokeWidth={2} opacity="0.9" />
    <defs>
      <path id="curve" d="M 100,100 m -62,0 a 62,62 0 1,1 124,0 a 62,62 0 1,1 -124,0" />
    </defs>
    <text fill={color} fontSize="15" fontFamily="'IBM Plex Mono', monospace" letterSpacing="2" fontWeight="600">
      <textPath href="#curve" startOffset="50%" textAnchor="middle">TRAVAIL FINI</textPath>
    </text>
    <text x="100" y="102" textAnchor="middle" fill={color} fontSize="12" fontFamily="'Fraunces', serif" fontWeight="600">{label}</text>
    <text x="100" y="122" textAnchor="middle" fill={color} fontSize="11" fontFamily="'IBM Plex Mono', monospace">{minutes} min</text>
  </svg>
);

export default function EditionsBookmark() {
  const [sessions, setSessions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('focus');
  const [pole, setPole] = useState(POLES[0].id);
  const [category, setCategory] = useState(POLES[0].categories[0].id);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [entryTime, setEntryTime] = useState(null);
  const [showStamp, setShowStamp] = useState(false);
  const [lastStamped, setLastStamped] = useState(null);
  const [tooShort, setTooShort] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [exportPeriod, setExportPeriod] = useState('week');
  const intervalRef = useRef(null);

  const STORAGE_KEY = 'eb-sessions';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSessions(JSON.parse(raw));
    } catch (e) { /* rien d'enregistré pour l'instant */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (running && !paused) {
      intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, paused]);

  function persist(next) {
    setSessions(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) { console.error(e); }
  }

  function finalizeSession(minutes, entry, exit) {
    const now = new Date();
    const session = { id: Date.now(), date: todayStr(now), category, minutes, entryTime: entry, exitTime: exit };
    persist([...sessions, session]);
    setLastStamped(session);
    setShowStamp(true);
    setTimeout(() => setShowStamp(false), 1700);
  }

  function choosePole(p) {
    setPole(p.id);
    setCategory(p.categories[0].id);
  }

  function pointerEntree() {
    setElapsed(0);
    setEntryTime(new Date().toTimeString().slice(0, 5));
    setRunning(true);
    setPaused(false);
  }

  function pointerSortie() {
    const secs = elapsed;
    const minutes = Math.max(1, Math.round(secs / 60));
    const exit = new Date().toTimeString().slice(0, 5);
    clearInterval(intervalRef.current);
    setRunning(false); setPaused(false);
    if (secs >= 10) {
      finalizeSession(minutes, entryTime, exit);
    } else {
      setTooShort(true);
      setTimeout(() => setTooShort(false), 2500);
    }
    setElapsed(0);
  }

  function resetAll() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* déjà vide */ }
    setSessions([]);
    setResetConfirm(false);
  }

  const streak = useMemo(() => computeStreak(sessions.map(s => s.date)), [sessions]);
  const todayMinutes = useMemo(() => sessions.filter(s => s.date === todayStr()).reduce((a, s) => a + s.minutes, 0), [sessions]);
  const weekMinutes = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6);
    return sessions.filter(s => new Date(s.date) >= new Date(todayStr(cutoff))).reduce((a, s) => a + s.minutes, 0);
  }, [sessions]);
  const reportData = useMemo(() => buildReportData(sessions), [sessions]);
  const recentLog = useMemo(() => [...sessions].sort((a, b) => b.id - a.id).slice(0, 8), [sessions]);
  const dominantCategory = useMemo(() => {
    const totals = {};
    sessions.forEach(s => { totals[s.category] = (totals[s.category] || 0) + s.minutes; });
    const entries = Object.entries(totals);
    if (!entries.length) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return catInfo(entries[0][0]);
  }, [sessions]);

  const periodSessions = useMemo(() => {
    let cutoff;
    if (exportPeriod === 'week') {
      const d = new Date(); d.setDate(d.getDate() - 6);
      cutoff = todayStr(d);
    } else {
      const d = new Date();
      cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }
    return sessions.filter(s => s.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  }, [sessions, exportPeriod]);

  const periodStats = useMemo(() => {
    const totalMinutes = periodSessions.reduce((a, s) => a + s.minutes, 0);
    const count = periodSessions.length;
    const avg = count ? Math.round(totalMinutes / count) : 0;
    const byPole = POLES.map(p => {
      const cats = p.categories.map(c => {
        const catSessions = periodSessions.filter(s => s.category === c.id);
        const minutes = catSessions.reduce((a, s) => a + s.minutes, 0);
        return { ...c, minutes, count: catSessions.length, pct: totalMinutes ? Math.round((minutes / totalMinutes) * 100) : 0 };
      }).filter(c => c.minutes > 0).sort((a, b) => b.minutes - a.minutes);
      const total = cats.reduce((a, c) => a + c.minutes, 0);
      return { ...p, categories: cats, total };
    }).filter(p => p.categories.length > 0);
    return { totalMinutes, count, avg, byPole };
  }, [periodSessions]);

  const periodLabel = exportPeriod === 'week'
    ? '7 derniers jours'
    : new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const cat = catInfo(category);
  const currentPole = poleInfo(pole);
  const goalPct = Math.min(100, Math.round((todayMinutes / DAILY_GOAL) * 100));

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
        :root{
          --paper:#EDE7D9; --paper-deep:#E2D9C4; --ink:#211E1A; --ink-soft:#5B564D;
          --rule:rgba(33,30,26,0.16); --card:#F5F0E4;
        }
        .app{ font-family:'Inter',sans-serif; background:var(--paper); color:var(--ink); min-height:600px;
          padding:28px 20px 60px; position:relative; overflow-x:hidden; }
        .app::before{ content:''; position:absolute; inset:0; opacity:0.05; pointer-events:none;
          background-image: radial-gradient(circle at 20% 30%, var(--ink) 0.5px, transparent 0.5px),
                             radial-gradient(circle at 70% 65%, var(--ink) 0.5px, transparent 0.5px);
          background-size: 3px 3px, 4px 4px; }
        .wrap{ max-width:780px; margin:0 auto; position:relative; }
        .masthead{ display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:22px;
          border-bottom:2px solid var(--ink); padding-bottom:12px; flex-wrap:wrap; gap:10px; }
        .masthead h1{ font-family:'Fraunces',serif; font-size:30px; font-weight:600; margin:0; letter-spacing:-0.5px; }
        .masthead .kicker{ font-family:'IBM Plex Mono',monospace; font-size:11px; text-transform:uppercase;
          letter-spacing:1.5px; color:var(--ink-soft); }
        .tabs{ display:flex; gap:4px; }
        .tab{ font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:0.5px; padding:8px 14px;
          border:1px solid var(--ink); background:transparent; cursor:pointer; color:var(--ink);
          display:flex; align-items:center; gap:6px; }
        .tab.active{ background:var(--ink); color:var(--paper); }
        .status-bar{ display:flex; gap:14px; flex-wrap:wrap; margin-bottom:22px; }
        .stat-chip{ background:var(--card); border:1px solid var(--rule); padding:10px 14px; flex:1; min-width:140px; }
        .stat-chip .label{ font-family:'IBM Plex Mono',monospace; font-size:10px; text-transform:uppercase;
          color:var(--ink-soft); letter-spacing:1px; }
        .stat-chip .value{ font-family:'Fraunces',serif; font-size:20px; font-weight:600; margin-top:2px;
          display:flex; align-items:center; gap:6px; }
        .goal-bar{ height:5px; background:var(--rule); margin-top:6px; }
        .goal-fill{ height:100%; background:var(--ink); transition:width 0.4s; }
        .card{ background:var(--card); border:1px solid var(--rule); padding:26px; margin-bottom:20px; }
        .pole-row{ display:flex; gap:8px; margin-bottom:18px; }
        .pole-btn{ font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:0.5px; padding:9px 16px;
          border:1.5px solid var(--rule); background:transparent; cursor:pointer; flex:1; text-align:center; }
        .pole-btn.active{ border-color:var(--ink); background:var(--ink); color:var(--paper); font-weight:600; }
        .cat-row{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
        .cat-btn{ font-family:'Inter',sans-serif; font-size:13px; padding:8px 13px; border:1.5px solid var(--rule);
          background:transparent; cursor:pointer; display:flex; align-items:center; gap:7px; color:var(--ink); }
        .cat-btn .dot{ width:9px; height:9px; border-radius:50%; flex-shrink:0; }
        .cat-btn.active{ border-color:var(--ink); font-weight:600; }
        .legend{ display:flex; flex-wrap:wrap; gap:10px 16px; margin-top:14px; }
        .legend-item{ display:flex; align-items:center; gap:6px; font-size:11px; color:var(--ink-soft); }
        .legend-item .dot{ width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .timer-zone{ text-align:center; padding:20px 0 8px; }
        .clock-card{ border:1.5px dashed var(--ink-soft); padding:14px 20px; display:inline-block; margin-top:14px; }
        .clock-card .cc-label{ font-family:'IBM Plex Mono',monospace; font-size:10px; text-transform:uppercase;
          letter-spacing:1px; color:var(--ink-soft); }
        .clock-card .cc-value{ font-family:'IBM Plex Mono',monospace; font-size:15px; font-weight:600; }
        .too-short{ font-family:'IBM Plex Mono',monospace; font-size:12px; color:#B4432D; margin-top:12px; }
        .timer-digits{ font-family:'IBM Plex Mono',monospace; font-size:76px; font-weight:600; font-variant-numeric:tabular-nums;
          letter-spacing:2px; line-height:1; }
        .timer-cat{ font-family:'Fraunces',serif; font-size:16px; margin-top:6px; color:var(--ink-soft); }
        .controls{ display:flex; justify-content:center; gap:12px; margin-top:22px; }
        .btn{ font-family:'IBM Plex Mono',monospace; font-size:13px; letter-spacing:0.5px; padding:12px 24px;
          border:1.5px solid var(--ink); background:var(--ink); color:var(--paper); cursor:pointer;
          display:flex; align-items:center; gap:8px; }
        .btn.secondary{ background:transparent; color:var(--ink); }
        .pulse-dot{ width:8px; height:8px; border-radius:50%; background:var(--ink); animation:pulse 1.4s infinite; }
        @keyframes pulse{ 0%,100%{opacity:1;} 50%{opacity:0.25;} }
        .stamp-overlay{ position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
          pointer-events:none; z-index:50; }
        .stamp-pop{ animation: stampIn 1.7s ease-out forwards; }
        @keyframes stampIn{ 0%{ transform:scale(2.4); opacity:0; } 18%{ transform:scale(1); opacity:1; }
          75%{ transform:scale(1); opacity:1; } 100%{ transform:scale(1); opacity:0; } }
        .section-title{ font-family:'IBM Plex Mono',monospace; font-size:11px; text-transform:uppercase;
          letter-spacing:1.5px; color:var(--ink-soft); margin-bottom:12px; }
        .log-row{ display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid var(--rule);
          font-size:13px; }
        .log-dot{ width:10px; height:10px; border-radius:50%; flex-shrink:0; }
        .log-cat{ flex:1; }
        .log-meta{ font-family:'IBM Plex Mono',monospace; color:var(--ink-soft); font-size:12px; white-space:nowrap; }
        .empty{ color:var(--ink-soft); font-size:13px; padding:16px 0; }
        .reset-link{ font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--ink-soft);
          background:none; border:none; cursor:pointer; text-decoration:underline; margin-top:14px; display:block; }
        .pole-block{ margin-bottom:18px; }
        .pole-block:last-child{ margin-bottom:0; }
        .pole-block-title{ font-family:'Fraunces',serif; font-size:14px; font-weight:600; margin-bottom:6px;
          display:flex; justify-content:space-between; }
        .mini-log-row{ display:flex; align-items:center; gap:8px; font-size:12px; padding:5px 0; border-bottom:1px solid var(--rule); }
        @media (max-width:520px){ .timer-digits{ font-size:56px; } .masthead h1{ font-size:24px; } }
        .print-report{ display:none; }
        .pr-title{ font-family:'Fraunces',serif; font-size:22px; margin:0 0 4px; }
        .pr-meta{ font-family:'IBM Plex Mono',monospace; font-size:11px; color:#333; margin-bottom:18px; }
        .pr-summary{ display:flex; gap:26px; margin-bottom:20px; font-family:'Inter',sans-serif; font-size:13px; }
        .pr-summary strong{ font-family:'Fraunces',serif; font-size:16px; display:block; }
        .pr-pole-title{ font-family:'Fraunces',serif; font-size:15px; margin:18px 0 6px; }
        .pr-table{ width:100%; border-collapse:collapse; margin-bottom:14px; font-family:'Inter',sans-serif; font-size:12px; }
        .pr-table th, .pr-table td{ border:1px solid #999; padding:5px 8px; text-align:left; }
        .pr-table th{ background:#eee; }
        @media print{
          .no-print{ display:none !important; }
          .print-report{ display:block; }
          body, .app{ background:#fff !important; padding:0 !important; }
          .app::before{ display:none !important; }
          @page{ margin:16mm; }
        }
      `}</style>

      <div className="wrap no-print">
        <div className="masthead">
          <div>
            <div className="kicker">Suivi d'activité</div>
            <h1>Editions Bookmark</h1>
          </div>
          <div className="tabs">
            <button className={`tab ${view === 'focus' ? 'active' : ''}`} onClick={() => setView('focus')}>
              <Printer size={13} /> Activité
            </button>
            <button className={`tab ${view === 'rapport' ? 'active' : ''}`} onClick={() => setView('rapport')}>
              <BarChart3 size={13} /> Rapport
            </button>
          </div>
        </div>

        <div className="status-bar">
          <div className="stat-chip">
            <div className="label">Série</div>
            <div className="value"><Flame size={16} /> {streak} {streak > 1 ? 'jours' : 'jour'}</div>
          </div>
          <div className="stat-chip">
            <div className="label">Aujourd'hui</div>
            <div className="value">{fmtHM(todayMinutes)}</div>
            <div className="goal-bar"><div className="goal-fill" style={{ width: `${goalPct}%` }} /></div>
          </div>
        </div>

        {view === 'focus' && (
          <div className="card">
            {!running ? (
              <>
                <div className="section-title">Pôle</div>
                <div className="pole-row">
                  {POLES.map(p => (
                    <button key={p.id} className={`pole-btn ${pole === p.id ? 'active' : ''}`} onClick={() => choosePole(p)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="section-title">Type de travail</div>
                <div className="cat-row">
                  {currentPole.categories.map(c => (
                    <button key={c.id} className={`cat-btn ${category === c.id ? 'active' : ''}`} onClick={() => setCategory(c.id)}>
                      <span className="dot" style={{ background: c.color }} />{c.label}
                    </button>
                  ))}
                </div>
                <div className="controls">
                  <button className="btn" onClick={pointerEntree}><Play size={15} /> Pointer l'entrée</button>
                </div>
                {tooShort && <div className="too-short">Session trop courte (moins de 10 secondes) — non enregistrée.</div>}
              </>
            ) : (
              <div className="timer-zone">
                <div className="timer-cat" style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
                  {!paused && <span className="pulse-dot" style={{ background: cat.color }} />}
                  {cat.label} {paused && '· en pause'}
                </div>
                <div className="timer-digits">{fmtClock(elapsed)}</div>
                <div className="clock-card">
                  <div className="cc-label">Entrée pointée</div>
                  <div className="cc-value">{entryTime}</div>
                </div>
                <div className="controls">
                  <button className="btn secondary" onClick={() => setPaused(p => !p)}>
                    {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Reprendre' : 'Pause'}
                  </button>
                  <button className="btn secondary" onClick={pointerSortie}><Square size={15} /> Pointer la sortie</button>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'focus' && (
          <div className="card">
            <div className="section-title">Carnet de suivi</div>
            {recentLog.length === 0 && <div className="empty">Aucun tirage enregistré pour l'instant. Lancez votre première session ci-dessus.</div>}
            {recentLog.map(s => {
              const c = catInfo(s.category);
              return (
                <div className="log-row" key={s.id}>
                  <span className="log-dot" style={{ background: c.color }} />
                  <span className="log-cat">{c.poleLabel} · {c.label}</span>
                  <span className="log-meta">{fmtHM(s.minutes)} · {s.entryTime}–{s.exitTime} · {s.date}</span>
                </div>
              );
            })}
          </div>
        )}

        {view === 'rapport' && (
          <>
            <div className="card">
              <div className="section-title">Cadence des 14 derniers jours</div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={reportData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--rule)" />
                  <XAxis dataKey="label" tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: 'var(--ink-soft)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontFamily: 'IBM Plex Mono', fontSize: 10, fill: 'var(--ink-soft)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontFamily: 'Inter', fontSize: 12, border: '1px solid #21201a' }}
                    formatter={(value, name) => [fmtHM(value), name]} />
                  {ALL_CATEGORIES.map(c => (
                    <Bar key={c.id} dataKey={c.id} stackId="a" fill={c.color} name={c.label} radius={0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <div className="legend">
                {ALL_CATEGORIES.map(c => (
                  <div className="legend-item" key={c.id}>
                    <span className="dot" style={{ background: c.color }} />{c.label}
                  </div>
                ))}
              </div>
            </div>

            <div className="status-bar">
              <div className="stat-chip"><div className="label">Cette semaine</div><div className="value">{fmtHM(weekMinutes)}</div></div>
              <div className="stat-chip"><div className="label">Sessions totales</div><div className="value">{sessions.length}</div></div>
              <div className="stat-chip"><div className="label">Catégorie dominante</div>
                <div className="value">{dominantCategory ? dominantCategory.label : '—'}</div></div>
            </div>

            <div className="card">
              <div className="section-title">Exporter</div>
              <div className="cat-row">
                <button className={`cat-btn ${exportPeriod === 'week' ? 'active' : ''}`} onClick={() => setExportPeriod('week')}>7 derniers jours</button>
                <button className={`cat-btn ${exportPeriod === 'month' ? 'active' : ''}`} onClick={() => setExportPeriod('month')}>Ce mois-ci</button>
              </div>
              <div className="controls" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
                <button className="btn secondary" onClick={() => window.print()}><Printer size={15} /> Exporter en PDF</button>
              </div>
              {sessions.length > 0 && (
                resetConfirm ? (
                  <button className="reset-link" onClick={resetAll}>Confirmer la réinitialisation de l'historique ?</button>
                ) : (
                  <button className="reset-link" onClick={() => { setResetConfirm(true); setTimeout(() => setResetConfirm(false), 3000); }}>
                    Réinitialiser l'historique
                  </button>
                )
              )}
            </div>
          </>
        )}
      </div>

      <div className="print-report">
        <h1 className="pr-title">Editions Bookmark — Rapport</h1>
        <div className="pr-meta">Période : {periodLabel} · Généré le {new Date().toLocaleDateString('fr-FR')}</div>
        <div className="pr-summary">
          <div><strong>{fmtHM(periodStats.totalMinutes)}</strong>au total</div>
          <div><strong>{periodStats.count}</strong>sessions</div>
          <div><strong>{fmtHM(periodStats.avg)}</strong>en moyenne par session</div>
        </div>
        {periodStats.byPole.map(p => (
          <div key={p.id}>
            <div className="pr-pole-title">{p.label} — {fmtHM(p.total)}</div>
            <table className="pr-table">
              <thead><tr><th>Catégorie</th><th>Temps</th><th>Sessions</th><th>Part</th></tr></thead>
              <tbody>
                {p.categories.map(c => (
                  <tr key={c.id}><td>{c.label}</td><td>{fmtHM(c.minutes)}</td><td>{c.count}</td><td>{c.pct}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {periodStats.byPole.length === 0 && <p>Aucune session sur cette période.</p>}
      </div>

      {showStamp && lastStamped && (
        <div className="stamp-overlay no-print">
          <div className="stamp-pop">
            <StampSVG color={catInfo(lastStamped.category).color} label={catInfo(lastStamped.category).label} minutes={lastStamped.minutes} />
          </div>
        </div>
      )}
    </div>
  );
}
