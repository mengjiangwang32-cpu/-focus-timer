import React, { useEffect, useRef, useState } from 'react';
import { WEEKDAYS, isDue, nextOccurrences, scheduleLabel, validateSchedule } from './core/schedule.js';
import { validateDate, weekday } from './core/calendar.js';
import { Timer, LayoutGrid, ChartColumn, Repeat2, Settings, ChevronLeft, ChevronRight, Plus, Play, Pause, Maximize, Check, ArrowUpRight, GripVertical, X, ArrowUp, ArrowDown, CircleCheck, Clock3, Archive, RotateCcw, Download, Upload, FolderOpen, Volume2, Leaf, ChevronDown, Pencil, Square, ArrowRight, ShieldCheck, CalendarDays, CircleHelp, ListChecks } from 'lucide-react';

const api = window.focusApp;
const priorities = { high: '高优先级', medium: '中优先级', low: '低优先级' };
const actual = (state, id) => state.sessions.reduce((n, s) => n + (s.taskId === id ? s.elapsedMs : 0), 0);
function clock(ms, overtime = false) {
  const seconds = Math.max(0, overtime ? Math.floor(ms / 1000) : Math.ceil(ms / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return `${overtime ? '+' : ''}${h ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function duration(ms) {
  if (!ms) return '0 分钟';
  if (ms < 60000) return `${Math.floor(ms / 1000)} 秒`;
  const minutes = Math.floor(ms / 60000), hours = Math.floor(minutes / 60);
  return hours ? `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}` : `${minutes} 分钟`;
}
const dayShift = (date, offset) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

async function invoke(promise) { const r = await promise; if (!r.ok) throw new Error(r.error); return r.value; }

export default function App() {
  const [view, setView] = useState(null), [fatal, setFatal] = useState(''), [page, setPage] = useState('tasks');
  const [date, setDate] = useState(''), [modal, setModal] = useState(null), [toast, setToast] = useState('');
  const [expanded, setExpanded] = useState(null), [showArchived, setShowArchived] = useState(false), [filter, setFilter] = useState('all');
  const [hintAction, setHintAction] = useState(null);
  const dragging = useRef(null), initialized = useRef(false), toastTimer = useRef(null), lastToday = useRef(null);
  const notify = message => { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 4500); };
  const acceptView = value => {
    setView(value);
    if (!initialized.current) { initialized.current = true; setDate(value.today); }
    else if (lastToday.current !== value.today) { const previous = lastToday.current; setDate(current => current === previous ? value.today : current); }
    lastToday.current = value.today;
  };
  useEffect(() => {
    if (!api) { setFatal('请使用拾光专注桌面应用启动。开发者可运行 npm run dev。'); return; }
    invoke(api.getState()).then(acceptView).catch(e => setFatal(e.message));
    const unsubscribe = api.onUpdate(acceptView);
    return () => { unsubscribe(); clearTimeout(toastTimer.current); };
  }, []);
  const cmd = async command => { const value = await invoke(api.command(command)); acceptView(value); return value; };
  const run = fn => async (...args) => { try { return await fn(...args); } catch (e) { notify(e.message); } };
  const confirm = options => invoke(api.confirm(options));
  const enterFullscreen = async () => { await invoke(api.fullscreen(true)); };
  useEffect(() => {
    if (!view?.fullscreen) return;
    const onKey = event => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      if (event.code === 'Escape') { event.preventDefault(); run(() => invoke(api.fullscreen(false)))(); }
      if (event.code === 'Space' && !event.repeat) { event.preventDefault(); run(() => cmd({ type: view.state.active?.paused ? 'resume' : 'pause' }))(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view]);
  if (fatal) return <div className="fatal"><Timer size={40} /><h1>无法启动拾光专注</h1><p>{fatal}</p></div>;
  if (!view || !date) return <div className="loading"><Timer size={36} /><p>正在拾起今天的时光…</p></div>;
  const { state, today } = view;
  const active = state.active, activeTask = state.tasks.find(t => t.id === active?.taskId);
  const elapsed = activeTask ? actual(state, activeTask.id) : 0;
  const overtime = activeTask && elapsed >= activeTask.budgetMs;
  const countdown = activeTask ? clock(Math.abs(activeTask.budgetMs - elapsed), overtime) : '00:00';
  if (view.fullscreen && activeTask) return <div className={`fullscreen ${active.paused ? 'is-paused' : ''} ${overtime ? 'is-overtime' : ''}`} data-testid="fullscreen"><span>{countdown}</span></div>;

  const tasks = state.tasks.filter(t => t.date === date);
  const visible = tasks.filter(t => showArchived ? t.archived : !t.archived).filter(t => filter === 'all' || (filter === 'open' ? !t.completed : t.completed));
  const stats = tasks.reduce((s, t) => { const a = actual(state, t.id); return { count: s.count + 1, completed: s.completed + +t.completed, budget: s.budget + t.budgetMs, actual: s.actual + a, overtime: s.overtime + Math.max(0, a - t.budgetMs) }; }, { count: 0, completed: 0, budget: 0, actual: 0, overtime: 0 });
  const progress = stats.count ? Math.round(stats.completed / stats.count * 100) : 0;
  const start = async id => {
    let confirmSwitch = false;
    if (active && active.taskId !== id) {
      confirmSwitch = await confirm({ message: '切换到这个任务？', detail: `将保存「${activeTask.title}」的本次用时，原任务保持未完成。`, accept: '保存并切换' });
      if (!confirmSwitch) return;
    }
    const action = async () => { await cmd({ type: 'start', id, confirmSwitch }); await enterFullscreen(); };
    if (!state.settings.fullscreenHintSeen) setHintAction(() => action);
    else await action();
  };
  const complete = async task => {
    let confirmSubtasks = false;
    if (!task.completed && task.subtasks.some(s => !s.done)) {
      confirmSubtasks = await confirm({ message: '仍有未完成的子任务', detail: '仍然将父任务标记为完成？子任务的勾选状态会保留。', accept: '完成任务' });
      if (!confirmSubtasks) return;
    }
    await cmd({ type: 'complete', id: task.id, completed: !task.completed, confirmSubtasks });
    notify(task.completed ? '已取消完成，用时记录已保留' : '任务已完成，辛苦了');
  };
  const archive = async task => {
    if (await confirm({ message: `归档「${task.title}」？`, detail: '任务会从清单隐藏，用时和历史统计继续保留。可在“已归档”中恢复。对应的重复计划不会因此停用。', accept: '归档任务' })) await cmd({ type: 'archive', id: task.id });
  };
  const reorder = async (source, target) => {
    if (!source || source === target) return;
    const ids = tasks.map(t => t.id); ids.splice(ids.indexOf(source), 1); ids.splice(ids.indexOf(target), 0, source);
    await cmd({ type: 'reorder', date, ids });
  };
  const taskRow = task => {
    const a = actual(state, task.id), isActive = active?.taskId === task.id, isExpanded = expanded === task.id;
    const done = task.subtasks.filter(s => s.done).length;
    return <div key={task.id} className={`task-card ${task.completed ? 'completed' : ''} ${isActive ? 'running' : ''}`} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }} onDragLeave={e => e.currentTarget.classList.remove('drag-over')} onDrop={run(async e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); await reorder(dragging.current, task.id); dragging.current = null; })}>
      <div className="task-row">
        <button className="drag-handle icon-button" draggable onDragStart={e => { dragging.current = task.id; e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { dragging.current = null; }} onKeyDown={run(async e => { if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const index = tasks.findIndex(t => t.id === task.id); const target = tasks[index + (e.key === 'ArrowUp' ? -1 : 1)]; if (target) await reorder(task.id, target.id); } })} title="拖动排序；也可按 Alt + 上下方向键" aria-label={`调整${task.title}顺序`}><GripVertical size={17} /></button>
        <button className={`task-check ${task.completed ? 'checked' : ''}`} aria-label={task.completed ? `取消完成${task.title}` : `完成${task.title}`} onClick={run(() => complete(task))}>{task.completed && <Check size={15} strokeWidth={3} />}</button>
        <button className="task-content" aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? null : task.id)}>
          <span className="task-title">{task.title}{task.templateId && <Repeat2 size={13} className="repeat-mark" />}{isActive && <span className="live-label">{active.paused ? '已暂停' : '专注中'}</span>}</span>
          <span className="task-meta"><Clock3 size={12} />{duration(task.budgetMs)}<span className="meta-dot">·</span><span className={`priority ${task.priority}`}><i />{priorities[task.priority]}</span>{task.subtasks.length > 0 && <><span className="meta-dot">·</span><ListChecks size={12} />{done}/{task.subtasks.length}</>}{a > 0 && <><span className="meta-dot">·</span><span className={a > task.budgetMs ? 'text-orange' : ''}>已用 {duration(a)}</span></>}</span>
        </button>
        {task.archived ? <button className="text-button" onClick={run(() => cmd({ type: 'restore', id: task.id }))}><RotateCcw size={14} />恢复</button> : !task.completed && <button className={`task-start ${isActive ? 'active-start' : ''}`} aria-label={`${isActive ? '返回全屏' : '开始'}${task.title}`} onClick={run(() => isActive ? enterFullscreen() : start(task.id))}>{isActive ? <Maximize size={16} /> : <Play size={15} fill="currentColor" />}<span>{isActive ? '返回全屏' : a > 0 ? '继续' : '开始'}</span></button>}
        <button className="icon-button" title="任务详情" aria-label={`${task.title}详情`} onClick={() => setExpanded(isExpanded ? null : task.id)}><ChevronDown className={isExpanded ? 'rotate' : ''} size={17} /></button>
      </div>
      {isExpanded && <div className="task-details">
        {task.notes && <p className="task-notes">{task.notes}</p>}
        {task.subtasks.map(s => <label className="subtask-line" key={s.id}><input type="checkbox" checked={s.done} onChange={run(e => cmd({ type: 'subtask', id: task.id, subtaskId: s.id, done: e.target.checked }))} /><span className={s.done ? 'strike' : ''}>{s.title}</span></label>)}
        {!task.notes && !task.subtasks.length && <p className="muted">还没有备注或子任务，可以编辑添加。</p>}
        <div className="detail-footer"><span>实际 {clock(a, true).slice(1)}{a > task.budgetMs && <span className="text-orange"> · 超时 {clock(a - task.budgetMs, true).slice(1)}</span>}</span><div><button className="text-button" onClick={() => setModal({ kind: 'edit', task })}><Pencil size={13} />编辑</button>{!task.archived && <button className="text-button danger" onClick={run(() => archive(task))}><Archive size={13} />归档</button>}</div></div>
      </div>}
    </div>;
  };
  const switchPage = id => { setPage(id); setShowArchived(false); setFilter('all'); };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Timer size={23} strokeWidth={1.8} /></div><div><strong>拾光专注</strong><span>把时间，留给重要的事</span></div></div>
      <div className="workspace-label">我的工作台</div>
      <nav aria-label="主导航">
        {[['tasks', LayoutGrid, '每日任务'], ['history', ChartColumn, '历史与统计'], ['templates', Repeat2, '重复计划']].map(([id, Icon, label]) => <button key={id} aria-label={label} className={page === id ? 'selected' : ''} onClick={() => switchPage(id)}><Icon size={19} /><span>{label}</span>{id === 'tasks' && <span className="nav-count">{state.tasks.filter(t => t.date === today && !t.completed && !t.archived).length}</span>}</button>)}
      </nav>
      <div className="sidebar-note"><span className="note-leaf"><Leaf size={21} /></span><p>不必填满每一分钟。<br />专注于眼前的一件事。</p><span className="note-line" /></div>
      <div className="sidebar-bottom"><button className={`settings-nav ${page === 'settings' ? 'selected' : ''}`} onClick={() => switchPage('settings')}><Settings size={18} />设置与备份</button><div className="offline-badge"><span />本地保存 · 离线可用<ShieldCheck size={13} /></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">我的工作台<span>/</span><strong>{{ tasks: '每日任务', history: '历史与统计', templates: '重复计划', settings: '设置与备份' }[page]}</strong></div><div className="topbar-right"><span className="today-date">{new Date(`${today}T12:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</span><div className="avatar">我</div></div></header>
      <div className="page-content">
        {view.storageError && <div className="error-banner" role="alert">{view.storageError}</div>}
        {page === 'tasks' && <>
          <div className="page-heading"><div><div className="eyebrow">ONE THING AT A TIME</div><h1>{date === today ? '今天，也专注一点。' : '拾起这一天的时光。'}<span className="heading-dot">✳</span></h1><p>给重要的事一点时间，让每一次专注都有迹可循。</p></div><button className="primary" onClick={() => setModal({ kind: 'create' })}><Plus size={18} />新建任务</button></div>
          <div className="stat-grid">
            <Stat icon={CircleCheck} label="任务进度" value={<>{stats.completed}<small> / {stats.count}</small></>} detail={stats.count ? `已完成 ${progress}% 的任务` : '从一个小任务开始'} color="green"><div className="mini-progress"><i style={{ width: `${progress}%` }} /></div></Stat>
            <Stat icon={CalendarDays} label="预计投入" value={duration(stats.budget)} detail="为这一天留出的时间" color="sand" />
            <Stat icon={Clock3} label="实际专注" value={duration(stats.actual)} detail="每一秒专注都算数" color="blue" />
          </div>
          <div className="work-grid"><section className="task-section">
            <div className="section-heading"><div className="date-control"><button className="icon-button" aria-label="前一天" onClick={() => setDate(dayShift(date, -1))}><ChevronLeft size={17} /></button><label className="date-picker"><CalendarDays size={16} /><span>{dateLabel(date)}</span><input aria-label="选择任务日期" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></label><button className="icon-button" aria-label="后一天" onClick={() => setDate(dayShift(date, 1))}><ChevronRight size={17} /></button>{date !== today && <button className="today-button" onClick={() => setDate(today)}>今天</button>}</div><button title={showArchived ? '返回任务清单' : '查看已归档任务'} className={`icon-button ${showArchived ? 'selected' : ''}`} onClick={() => setShowArchived(!showArchived)} aria-label="切换已归档"><Archive size={17} /></button></div>
            <div className="task-tabs"><div>{[['all', '全部任务'], ['open', '未完成'], ['done', '已完成']].map(([key, label]) => <button className={filter === key ? 'active' : ''} key={key} onClick={() => setFilter(key)}>{label}{key === 'all' && <span>{tasks.filter(t => t.archived === showArchived).length}</span>}</button>)}</div><span>{showArchived ? '已归档 · 统计保留' : '拖动调整顺序'}</span></div>
            <div className="task-list">
              {visible.filter(t => !t.completed).map(taskRow)}
              {visible.some(t => t.completed) && <div className="completed-divider"><span>已完成</span><span>{visible.filter(t => t.completed).length}</span><i /></div>}
              {visible.filter(t => t.completed).map(taskRow)}
              {visible.length === 0 && <div className="empty-state"><span><ListChecks size={30} strokeWidth={1.4} /></span><h3>{showArchived ? '暂无归档任务' : filter === 'done' ? '完成的任务会出现在这里' : filter === 'open' ? '这一刻，清单已清空' : '今天，想把时间留给什么？'}</h3><p>{showArchived ? '归档的任务会保留历史和用时。' : '把大目标拆成小事，从一件开始就很好。'}</p>{!showArchived && <button className="text-button" onClick={() => setModal({ kind: 'create' })}><Plus size={15} />添加一个任务</button>}</div>}
            </div>
            {!showArchived && <button className="add-task-inline" onClick={() => setModal({ kind: 'create' })}><Plus size={17} /><span>添加任务</span><span className="subtle">一件事，一段专注时光</span></button>}
            <div className="list-footnote"><ShieldCheck size={13} />更改自动保存到这台电脑。归档任务仍计入统计。</div>
          </section><aside className="right-column">
            <section className={`focus-panel ${activeTask ? 'has-active' : ''}`}><div className="panel-overline"><span className="status-dot" />{activeTask ? active.paused ? '计时已暂停' : '正在专注' : '留一段时间给自己'}<Timer size={17} /></div>{activeTask ? <><h3>{activeTask.title}</h3><p className="focus-task-date">归属 {activeTask.date} · {overtime ? '已超出预计时间' : '剩余专注时间'}</p><div className={`panel-timer ${overtime ? 'overtime' : ''}`}>{countdown}</div><div className="focus-track"><i style={{ width: `${Math.min(100, elapsed / activeTask.budgetMs * 100)}%` }} /></div><button className="focus-main-button" onClick={run(enterFullscreen)}><Maximize size={16} />返回全屏<ArrowUpRight size={16} /></button><div className="focus-actions"><button onClick={run(() => cmd({ type: active.paused ? 'resume' : 'pause' }))}>{active.paused ? <Play size={14} /> : <Pause size={14} />}{active.paused ? '继续计时' : '暂停'}</button><button onClick={run(() => cmd({ type: 'end' }))}><Square size={12} />结束本次</button></div><button className="finish-button" onClick={run(() => complete(activeTask))}><Check size={15} />完成任务</button></> : <><div className="idle-clock"><Timer size={46} strokeWidth={1} /><span /></div><h3>此刻，只做一件事。</h3><p>在左侧选择任务，点击开始。<br />把注意力交给当下。</p><div className="focus-panel-caption">你的节奏，由你决定</div></>}</section>
            <section className="day-note"><div><Leaf size={17} /><span>专注小贴士</span></div><p>需要查资料？按 <kbd>Esc</kbd> 退出全屏，计时会继续。按 <kbd>空格</kbd> 可暂停或继续。</p><button onClick={() => setModal({ kind: 'help' })}>了解计时规则<ArrowRight size={14} /></button></section>
            <div className="daily-caption"><span />慢慢来，也是在向前。<span /></div>
          </aside></div>
        </>}
        {page === 'history' && <>
          <PageHeading eyebrow="EVERY MOMENT COUNTS" title="每一份专注，都有记录。" subtitle="按任务所属日期汇总，跨午夜的计时仍归属任务原日期。" />
          <div className="history-controls"><label><CalendarDays size={17} />查看日期<input aria-label="选择历史日期" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></label><button className="text-button" onClick={() => setDate(today)}>回到今天</button></div>
          <div className="stat-grid four"><Stat icon={CircleCheck} label="完成任务" value={`${stats.completed} / ${stats.count}`} detail="不包含子任务数量" color="green" /><Stat icon={CalendarDays} label="预计用时" value={duration(stats.budget)} detail="当日所有任务预算" color="sand" /><Stat icon={Clock3} label="实际用时" value={duration(stats.actual)} detail="不包含暂停和离线时间" color="blue" /><Stat icon={Timer} label="超时合计" value={duration(stats.overtime)} detail="包含尚未完成的超时任务" color="orange" /></div>
          <section className="history-table"><div className="table-heading"><h2>{dateLabel(date)}</h2><span>{tasks.length} 项任务 · 含归档</span></div><div className="table-scroll"><table><thead><tr><th>任务</th><th>预计</th><th>实际</th><th>超时</th><th>状态</th><th /></tr></thead><tbody>{tasks.map(t => { const a = actual(state, t.id); return <tr key={t.id}><td><strong>{t.title}</strong><span className={`priority ${t.priority}`}><i />{priorities[t.priority]}{t.archived ? ' · 已归档' : ''}</span></td><td>{clock(t.budgetMs)}</td><td>{clock(a, true).slice(1)}</td><td className={a > t.budgetMs ? 'text-orange' : 'muted'}>{a > t.budgetMs ? clock(a - t.budgetMs, true) : '—'}</td><td><span className={`status-pill ${t.completed ? a > t.budgetMs ? 'late' : 'done' : ''}`}>{t.completed ? a > t.budgetMs ? '超时完成' : '按时完成' : a > t.budgetMs ? '未完成 · 已超时' : '未完成'}</span></td><td><button className="text-button" onClick={() => setModal({ kind: 'record', task: t })}>详情<ChevronRight size={13} /></button></td></tr>; })}</tbody></table></div>{!tasks.length && <div className="empty-state"><CalendarDays size={28} /><h3>这一天还没有任务记录</h3><p>选择其他日期，回看走过的每一小步。</p></div>}</section>
          <div className="recorded-dates"><span>有记录的日期</span>{[...new Set(state.tasks.map(t => t.date))].sort().reverse().slice(0, 30).map(d => <button key={d} className={date === d ? 'selected' : ''} onClick={() => setDate(d)}>{d}</button>)}</div>
        </>}
        {page === 'templates' && <>
          <PageHeading eyebrow="YOUR DAYS, YOUR RHYTHM" title="让重要的事，按你的节奏发生。" subtitle="周一读书，周三运动，或每隔 3 天练习一次。把重复的事，安排得刚刚好。" action={<button className="primary" onClick={() => { setDate(today); setModal({ kind: 'create', repeat: true }); }}><Plus size={17} />新建重复计划</button>} />
          <div className="info-banner"><Repeat2 size={18} /><p>指定星期或间隔天数，任务会在符合规则的当天出现。修改计划不改动已有任务和历史；停用只停止之后的安排。</p></div>
          <section className="week-overview"><div className="week-overview-heading"><h2><CalendarDays size={17} />未来 7 天</h2><span>安排预览 · 当天打开软件时加入任务清单</span></div><div className="week-overview-grid">{Array.from({ length: 7 }, (_, i) => { const day = dayShift(today, i), planned = state.templates.filter(t => isDue(t, day)); return <div key={day} className={`week-day ${i === 0 ? 'today' : ''}`}><div><strong>{i === 0 ? '今天' : WEEKDAYS[weekday(day) - 1]}</strong><span>{day.slice(5).replace('-', '/')}</span></div>{planned.map(t => <button key={t.id} title={`编辑${t.title}的重复安排`} onClick={() => setModal({ kind: 'template', task: t })}>{t.title}</button>)}{!planned.length && <span className="no-plan">自由安排</span>}</div>; })}</div></section>
          <div className="template-grid">{state.templates.map(t => <section className={`template-card ${!t.enabled ? 'disabled-template' : ''}`} key={t.id}><div className="template-top"><span className="template-icon"><Repeat2 size={21} /></span><label className="switch" title={t.enabled ? '停用计划' : '启用计划'}><input type="checkbox" aria-label={`${t.enabled ? '停用' : '启用'}${t.title}`} checked={t.enabled} onChange={run(e => cmd({ type: 'templateEnabled', id: t.id, enabled: e.target.checked }))} /><span /></label></div><h3>{t.title}</h3><div className="schedule-badge">{scheduleLabel(t.schedule)}</div><div className="task-meta"><Clock3 size={13} />{duration(t.budgetMs)}<span className="meta-dot">·</span><span className={`priority ${t.priority}`}><i />{priorities[t.priority]}</span></div><p className="template-notes">{t.notes || '按自己的节奏，把重要的事坚持下去。'}</p><div className="template-dates"><span>开始于 {t.startDate}</span><span>{t.enabled ? `近期：${nextOccurrences(t, today).map(d => d.slice(5).replace('-', '/')).join('、') || '没有后续日期'}` : '已停用，已有任务和历史保留'}</span></div><div className="template-footer"><span>{t.enabled ? '已启用' : '已停用'} · {t.subtasks.length} 个子任务</span><button className="text-button" onClick={() => setModal({ kind: 'template', task: t })}><Pencil size={14} />编辑计划</button></div></section>)}</div>{!state.templates.length && <div className="empty-state large"><Repeat2 size={32} /><h3>想定期做的事，只需安排一次</h3><p>选好星期，或者设定间隔，从一个好习惯开始。</p><button className="primary" onClick={() => { setDate(today); setModal({ kind: 'create', repeat: true }); }}><Plus size={16} />创建重复计划</button></div>}
        </>}
        {page === 'settings' && <>
          <PageHeading eyebrow="YOUR OWN QUIET SPACE" title="安心专注，数据留在身边。" subtitle="无需账号、订阅或网络，所有任务和专注记录只存储在这台电脑。" />
          <section className="settings-section"><h2><Volume2 size={19} />计时偏好</h2><div className="setting-row"><div><strong>到时提示音</strong><p>每个任务预算用完时提醒一次，然后继续显示超时，不自动完成任务。</p></div><label className="switch"><input type="checkbox" aria-label="到时提示音" checked={state.settings.sound} onChange={run(e => cmd({ type: 'settings', sound: e.target.checked }))} /><span /></label></div></section>
          <section className="settings-section"><h2><ShieldCheck size={19} />数据与备份</h2><div className="setting-row"><div><strong>导出完整备份</strong><p>包含任务、历史、每日模板、设置和计时记录。建议定期保存到其他磁盘。</p></div><button className="secondary" onClick={run(async () => { if (await invoke(api.exportBackup())) notify('完整备份已导出'); })}><Download size={16} />导出备份</button></div><div className="setting-row"><div><strong>从备份恢复</strong><p>完整替换当前数据；先校验文件并保留导入前副本，失败时不替换数据。</p></div><button className="secondary" onClick={run(async () => { if (await invoke(api.importBackup())) { setModal(null); notify('备份已恢复，计时处于暂停状态'); } })}><Upload size={16} />导入备份</button></div><div className="setting-row"><div><strong>本地数据目录</strong><p className="data-path">{view.dataPath}</p></div><button className="text-button" onClick={run(() => invoke(api.openDataDirectory()))}><FolderOpen size={16} />打开目录</button></div></section>
          <section className="settings-section"><h2><CircleHelp size={19} />关于拾光专注</h2><div className="setting-row"><div><strong>拾光专注 {view.version}</strong><p>关闭软件或电脑休眠会自动暂停；异常退出最多丢失最近 2 秒的未保存进度。</p></div><button className="text-button" onClick={() => setModal({ kind: 'help' })}>使用说明<ArrowRight size={15} /></button></div><p className="settings-footer">离线 · 免费 · 无广告 · 无数据上传</p></section>
        </>}
      </div>
    </main>
    {modal && ['create', 'edit', 'template'].includes(modal.kind) && <TaskForm key={`${modal.kind}-${modal.task?.id || 'new'}`} modal={modal} date={date} today={today} state={state} onClose={() => setModal(null)} onSave={run(async fields => { await cmd({ type: modal.kind === 'template' ? 'template' : modal.kind === 'edit' ? 'edit' : 'create', id: modal.task?.id, date, fields, repeat: fields.repeat, schedule: fields.schedule, startDate: fields.startDate }); setModal(null); notify(modal.kind === 'template' || fields.repeat ? '重复计划已保存，任务会按规则在对应日期出现' : '任务已保存'); })} />}
    {modal?.kind === 'help' && <Modal title="给专注留一点空间" onClose={() => setModal(null)}><div className="help-content"><p>① 新建任务，填入整项任务的预计时长，点击“开始”进入全屏。</p><p>② 全屏中按 <kbd>Esc</kbd> 返回清单，计时继续；按 <kbd>空格</kbd> 暂停或继续。</p><p>③ 到零只提醒一次，随后继续显示带 + 号的超时。不会自动完成或跳到下一项。</p><p>④ “结束本次”保存用时，任务保持未完成；“完成任务”保存并勾选完成。再次开始接着使用剩余预算。</p><p>⑤ 关闭和休眠会暂停；重开后手动继续。每 2 秒保存进度，异常退出最多丢失最近 2 秒。</p><p>⑥ 重要记录请在“设置与备份”中定期导出。重复模板与每天任务独立，编辑模板不改变历史。</p><p>⑦ 使用右上方日期切换和“历史与统计”查看往日任务。任务的预计时长在第一次开始后固定。</p></div><button className="primary full-width" onClick={() => setModal(null)}>明白了</button></Modal>}
    {modal?.kind === 'record' && <Modal title={modal.task.title} onClose={() => setModal(null)}><p className="muted">归属 {modal.task.date} · {priorities[modal.task.priority]}{modal.task.archived ? ' · 已归档' : ''}</p><p className="record-notes">{modal.task.notes || '无备注'}</p>{modal.task.subtasks.map(s => <div className="subtask-line" key={s.id}>{s.done ? <CircleCheck size={16} /> : <Square size={16} />}<span>{s.title}</span></div>)}<h3 className="record-section-title">计时片段</h3>{state.sessions.filter(s => s.taskId === modal.task.id).map(s => <div className="session-line" key={s.id}><span>{new Date(s.startedAt).toLocaleString('zh-CN')}<small>{s.endedAt ? '已结束' : '当前片段'}</small></span><strong>{clock(s.elapsedMs, true).slice(1)}</strong></div>)}{!state.sessions.some(s => s.taskId === modal.task.id) && <p className="muted">还没有计时记录</p>}<button className="secondary full-width" onClick={() => { setDate(modal.task.date); setPage('tasks'); setShowArchived(modal.task.archived); setExpanded(modal.task.id); setModal(null); }}>前往当天任务</button></Modal>}
    {hintAction && <Modal title="一段安静的专注时间" onClose={() => setHintAction(null)}><div className="shortcut-help"><div><kbd>Esc</kbd><span>退出全屏，计时继续</span></div><div><kbd>空格</kbd><span>暂停或继续计时</span></div></div><p className="muted">全屏只显示计时数字。你可以随时切换应用，回来后从清单返回全屏。</p><button className="primary full-width" onClick={run(async () => { const action = hintAction; await cmd({ type: 'settings', fullscreenHintSeen: true }); setHintAction(null); await action(); })}><Play size={16} />开始专注</button></Modal>}
    {toast && <div className="toast" role="status"><CircleCheck size={17} />{toast}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}

function PageHeading({ eyebrow, title, subtitle, action }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>; }
function Stat({ icon: Icon, label, value, detail, color, children }) { return <section className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${color}`}><Icon size={18} strokeWidth={1.7} /></span></div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div>{children}</section>; }
function Modal({ title, children, onClose }) {
  const panel = useRef(null), previousFocus = useRef(null);
  useEffect(() => {
    previousFocus.current = document.activeElement;
    panel.current?.querySelector('input, button, textarea')?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab') {
        const nodes = [...panel.current.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])')];
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previousFocus.current?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title} ref={panel}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button></div>{children}</section></div>;
}
function TaskForm({ modal, date, today, state, onClose, onSave }) {
  const task = modal.task;
  const [title, setTitle] = useState(task?.title || ''), [minutes, setMinutes] = useState(task ? task.budgetMs / 60000 : 25);
  const [priority, setPriority] = useState(task?.priority || 'medium'), [notes, setNotes] = useState(task?.notes || '');
  const [subtasks, setSubtasks] = useState(task?.subtasks || []), [repeat, setRepeat] = useState(Boolean(modal.repeat)), [saving, setSaving] = useState(false);
  const [kind, setKind] = useState(task?.schedule?.kind || 'daily');
  const [weekdays, setWeekdays] = useState(task?.schedule?.weekdays || [weekday(today)]);
  const [everyDays, setEveryDays] = useState(task?.schedule?.everyDays || 3);
  const [startDate, setStartDate] = useState(task?.startDate || today), [formError, setFormError] = useState('');
  const repeating = modal.kind === 'template' || (modal.kind === 'create' && repeat);
  const schedule = kind === 'weekly' ? { kind, weekdays } : kind === 'interval' ? { kind, everyDays: Number(everyDays) } : { kind };
  let preview = [];
  if (repeating) { try { preview = nextOccurrences({ enabled: true, schedule, startDate }, today); } catch { /* Show validation below the form on submit. */ } }
  const moveSubtask = (index, delta) => {
    const next = [...subtasks]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setSubtasks(next);
  };
  const locked = modal.kind === 'edit' && state.sessions.some(s => s.taskId === task.id);
  return <Modal title={modal.kind === 'template' ? '编辑重复计划' : task ? '编辑任务' : '给重要的事留点时间'} onClose={onClose}>
    <form onSubmit={async e => { e.preventDefault(); if (saving) return; setFormError(''); try { if (repeating) { validateSchedule(schedule); validateDate(startDate); } } catch (error) { setFormError(error.message); return; } setSaving(true); try { await onSave({ title, budgetMs: Math.round(Number(minutes) * 60000), priority, notes, subtasks: subtasks.filter(s => s.title.trim()), repeat, schedule, startDate }); } finally { setSaving(false); } }}>
      <label className="field"><span>任务名称</span><input autoFocus required maxLength={200} placeholder="比如：读完书的一个章节" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <div className="form-columns"><label className="field"><span>预计时长 <small>分钟</small></span><input type="number" required min="1" max="10080" step="1" value={minutes} disabled={locked} onChange={e => setMinutes(e.target.value)} /></label><label className="field"><span>优先级</span><select value={priority} onChange={e => setPriority(e.target.value)}><option value="high">高优先级</option><option value="medium">中优先级</option><option value="low">低优先级</option></select></label></div>
      {locked && <p className="field-tip">已开始的任务固定总预算，多次计时共用剩余时间。</p>}
      <label className="field"><span>备注 <small>选填</small></span><textarea rows={3} maxLength={20000} placeholder="写下想法、资料或需要注意的事…" value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <div className="field"><span>子任务 <small>拆成小步，更容易开始</small></span><div className="subtask-editor">{subtasks.map((s, index) => <div key={s.id}><span className="subtask-number">{index + 1}</span><input aria-label={`子任务${index + 1}`} maxLength={200} placeholder="一个小步骤" value={s.title} onChange={e => setSubtasks(subtasks.map(x => x.id === s.id ? { ...x, title: e.target.value } : x))} /><button type="button" className="icon-button" disabled={index === 0} aria-label={`上移子任务${index + 1}`} onClick={() => moveSubtask(index, -1)}><ArrowUp size={13} /></button><button type="button" className="icon-button" disabled={index === subtasks.length - 1} aria-label={`下移子任务${index + 1}`} onClick={() => moveSubtask(index, 1)}><ArrowDown size={13} /></button><button type="button" className="icon-button" aria-label={`删除子任务${index + 1}`} onClick={() => setSubtasks(subtasks.filter(x => x.id !== s.id))}><X size={15} /></button></div>)}</div><button type="button" className="text-button" disabled={subtasks.length >= 100} onClick={() => setSubtasks([...subtasks, { id: crypto.randomUUID(), title: '', done: false }])}><Plus size={14} />添加子任务</button></div>
      {modal.kind === 'create' && <label className="repeat-option"><input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} /><Repeat2 size={17} /><div><strong>设为重复任务</strong><span>支持每天、指定星期或每隔几天</span></div></label>}
      {repeating && <fieldset className="schedule-editor"><legend>重复安排</legend>
        <div className="form-columns"><label className="field"><span>重复频率</span><select value={kind} onChange={e => { setKind(e.target.value); setFormError(''); }}><option value="daily">每天</option><option value="weekly">每周指定星期</option><option value="interval">每隔几天</option></select></label><label className="field"><span>开始日期</span><input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} /></label></div>
        {kind === 'weekly' && <div className="weekday-field"><span>在哪些星期重复？可多选</span><div className="weekday-buttons" role="group" aria-label="选择星期">{WEEKDAYS.map((label, i) => <button type="button" key={label} aria-pressed={weekdays.includes(i + 1)} onClick={() => { setWeekdays(current => current.includes(i + 1) ? current.filter(d => d !== i + 1) : [...current, i + 1].sort((a, b) => a - b)); setFormError(''); }}>{label}</button>)}</div></div>}
        {kind === 'interval' && <label className="field interval-field"><span>间隔天数</span><div><span>每</span><input type="number" min="1" max="3650" step="1" required aria-label="间隔天数" value={everyDays} onChange={e => setEveryDays(e.target.value)} /><span>天出现一次</span></div><small>以开始日期为准。每 3 天一次，例如 25 日、28 日、31 日。</small></label>}
        <div className="schedule-preview"><CalendarDays size={15} /><div><strong>近期安排</strong><span>{preview.length ? preview.map(d => `${d}（${WEEKDAYS[weekday(d) - 1]}）`).join('、') : '请选择有效规则和开始日期'}</span></div></div>
        <p className="schedule-hint">符合规则的当天打开软件时，任务会自动出现在清单中；不会补造错过的日期。</p>
      </fieldset>}
      {modal.kind === 'template' && <p className="field-tip">修改仅影响之后生成的实例，不改动今天与历史任务。</p>}
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="form-footer"><span>{repeating ? `开始于 ${startDate}` : `任务日期 ${date}`}</span><div><button type="button" className="secondary" onClick={onClose}>取消</button><button type="submit" className="primary" disabled={saving}>{saving ? '保存中…' : task ? '保存修改' : repeating ? '创建计划' : '创建任务'}</button></div></div>
    </form>
  </Modal>;
}
