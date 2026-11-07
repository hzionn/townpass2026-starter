import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CareIllustration, Icon } from './components/Icon.tsx';
import { DISTRICTS, EMPTY_ANSWERS, type Answers, type Plan, type Provider, type TaskStatus } from './domain/models.ts';
import { canShowProviders, createPlan, evaluateGuidance, filterProviders, GUIDANCE, hasServiceNotice, isDistrict, needsProviderConfirmation, OFFICIAL_GUIDE, RULE_VERSION } from './domain/guidance.ts';
import { clearPlan, restorePlan, savePlan, type Restore } from './adapters/storage.ts';
import { callPhone, isDialablePhone, openOfficial } from './adapters/bridge.ts';
import snapshot from './data/providers.json';
import './styles.css';

const providers = snapshot.providers as Provider[];
const source = snapshot.source;
const formatDate = (value: string) => value.slice(0, 10).replaceAll('-', '/');
const getRoute = () => window.location.hash.slice(1) || 'home';
const go = (route: string) => { window.location.hash = route; };
function readInitial(): Restore {
  try { return restorePlan(window.localStorage); } catch { return { plan: null, issue: 'unavailable' }; }
}
function OfficialLink({ url = OFFICIAL_GUIDE, children }: { url?: string; children: React.ReactNode }) {
  return <a className="text-link" href={url} target="_blank" rel="noopener noreferrer" onClick={e => openOfficial(e, url)}>{children}<Icon name="external" size={16} /></a>;
}
function SourceNote() {
  return <div className="source-note"><Icon name="info" size={18} /><div>名錄提供聯絡資訊，實際服務範圍、時段與安排請向正式窗口確認。<a href="#sources">查看資料來源</a></div></div>;
}

function App() {
  const [initial] = useState(readInitial);
  const [route, setRoute] = useState(getRoute);
  const [answers, setAnswers] = useState<Answers>(initial.plan?.answers ?? { ...EMPTY_ANSWERS });
  const [plan, setPlan] = useState<Plan | null>(initial.plan);
  const [unsaved, setUnsaved] = useState(false);
  const [notice, setNotice] = useState(initial.issue === 'invalid' ? '舊清單無法讀取，請重新建立；原始紀錄尚未被覆寫。' : initial.issue === 'unavailable' ? '此環境目前無法使用本機儲存，仍可整理及複製清單。' : '');
  const [districtFilter, setDistrictFilter] = useState(isDistrict(answers.district) ? answers.district : '');
  const [showPending, setShowPending] = useState(false);
  const [modal, setModal] = useState<{ title: string; description: string; confirm: string; action: () => void } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const syncHeader = () => { document.documentElement.dataset.embedded = String(!!window.flutterObject); };
    syncHeader();
    window.addEventListener('flutterInAppWebViewPlatformReady', syncHeader);
    return () => window.removeEventListener('flutterInAppWebViewPlatformReady', syncHeader);
  }, []);
  useEffect(() => { const onHash = () => setRoute(getRoute()); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  useEffect(() => { window.scrollTo(0, 0); mainRef.current?.focus({ preventScroll: true }); }, [route]);
  useEffect(() => { if (modal) dialogRef.current?.showModal(); }, [modal]);

  const update = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setAnswers(old => ({ ...old, [key]: value, ...(key === 'hasCare' ? { hasManager: '' } : {}) }));
    setNotice('');
  };
  const persist = (next: Plan) => {
    let saved = false;
    try { saved = savePlan(window.localStorage, next); } catch { /* Storage can be disabled. */ }
    setPlan(next); setUnsaved(!saved);
    setNotice(saved ? '行動清單已保存在這台裝置。' : '尚未保存：此環境無法寫入本機儲存，請先複製聯絡摘要。');
  };
  const makePlan = (provider: Provider | null = null) => {
    let next: Plan;
    try { next = createPlan(answers, source.version, provider); } catch { setNotice('請先完成需求引導，再建立行動清單。'); go('guide/1'); return; }
    const apply = () => { persist(next); go('plan'); };
    if (plan || initial.issue === 'invalid') setModal({ title: '更新你的行動清單？', description: '目前只保留一份清單。更新後，原本的聯絡摘要與待辦進度會被取代。', confirm: '更新清單', action: apply });
    else apply();
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice('已複製聯絡摘要。'); }
    catch { setNotice('這個環境無法直接複製。請長按下方聯絡摘要，選取文字後複製。'); }
  };
  const phone = async (number: string) => {
    if (!isDialablePhone(number)) { setNotice('來源電話格式待確認，請查看官方資料或向 1966 諮詢。系統不會自動補齊號碼。'); return; }
    const launched = await callPhone(number);
    setNotice(launched ? '已交由裝置開啟撥號。聯絡完成後，請自行更新待辦進度。' : `無法開啟撥號，請手動撥打 ${number}。`);
  };
  const guidance = (() => { try { return evaluateGuidance(answers); } catch { return null; } })();
  const selected = route.startsWith('provider/') ? providers.find(p => p.id === route.split('/')[1]) : null;
  const step = route.startsWith('guide/') ? Math.min(4, Math.max(1, Number(route.split('/')[1]) || 1)) : 1;
  const matched = filterProviders(providers, districtFilter);
  const pending = providers.filter(needsProviderConfirmation);
  const begin = () => { setNotice(''); go('guide/1'); };
  const navActive = route === 'home' ? 'home' : route === 'plan' ? 'plan' : route.startsWith('provider') ? 'providers' : '';

  const providerCard = (provider: Provider) => <a className="provider-card" href={`#provider/${provider.id}`} key={provider.id}>
    <div className="provider-icon"><Icon name="home" /></div><div className="provider-info"><span className={`badge ${needsProviderConfirmation(provider) ? 'badge-warm' : ''}`}>{hasServiceNotice(provider) ? '服務狀態待確認' : provider.scopeStatus === 'explicit' ? '居家喘息' : '服務範圍待確認'}</span><h2>{provider.name}</h2><p><Icon name="pin" size={16} />{provider.serviceAreaRaw}</p></div><Icon name="chevron" size={18} />
  </a>;

  return <>
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); mainRef.current?.focus(); }}>跳至主要內容</a>
    <header className="site-header"><div className="header-inner"><a href="#home" className="brand" aria-label="照護通 CarePass 首頁"><span className="brand-mark"><Icon name="heart" size={24} /></span><span>照護通 <small>CarePass</small></span></a><a href="#sources" className="header-help"><Icon name="info" size={18} /><span>關於服務</span></a></div></header>
    <main id="main" ref={mainRef} tabIndex={-1}>
      {notice && <div className={`notice ${unsaved ? 'notice-warm' : ''}`} role="status"><Icon name="info" size={20} /><span>{notice}</span><button className="notice-close" aria-label="關閉提示" onClick={() => setNotice('')}>×</button></div>}

      {route === 'home' && <>
        <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="status-dot" />家庭照顧者的資源導航</div><h1>照顧家人的你，<br />也值得<span>喘口氣。</span></h1><p className="hero-description">不知道該找誰、從哪裡開始？<br />讓我們陪你整理需求，找到下一步。</p><button className="button primary hero-cta" onClick={begin}>幫我找到下一步<Icon name="arrow" /></button><p className="micro-copy"><Icon name="clock" size={16} />約 3 分鐘・不用登入・隨時可以返回</p></div><CareIllustration /></section>
        {plan && <a className="resume-card" href="#plan"><span className="icon-tile"><Icon name="list" /></span><div><strong>接著完成你的行動清單</strong><p>{plan.tasks.filter(t => t.status === 'done').length} / {plan.tasks.length} 項已完成，慢慢來就好。</p></div><Icon name="arrow" /></a>}
        <section className="section"><div className="section-heading"><div><p className="eyebrow">一步一步，讓照顧輕一點</p><h2>我們可以陪你做這些事</h2></div></div><div className="feature-grid">{[
          { icon: 'spark' as const, number: '01', title: '釐清現在的需要', text: '幾個簡單的問題，找到適合你的聯絡路徑。' },
          { icon: 'home' as const, number: '02', title: '認識可詢問的資源', text: '依家人需要服務的地區，查看官方居家喘息名錄。' },
          { icon: 'list' as const, number: '03', title: '把下一步帶著走', text: '整理聯絡摘要與待辦，保存後隨時回來繼續。' },
        ].map(item => <article className="feature-card" key={item.number}><div className="feature-top"><span className="icon-tile"><Icon name={item.icon} /></span><span className="feature-number">{item.number}</span></div><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></section>
        <section className="help-banner"><div className="help-icon"><Icon name="phone" size={28} /></div><div><h2>想先和人聊聊？</h2><p>1966 長照專線，協助你了解申請與服務。<br /><small>週一至週五 08:30–12:00、13:30–17:30</small></p></div><button className="button secondary" onClick={() => void phone('1966')}>撥打 1966<Icon name="phone" size={18} /></button></section>
        <SourceNote />
      </>}

      {route.startsWith('guide') && <section className="narrow wizard"><a className="back-link" href={step === 1 ? '#home' : `#guide/${step - 1}`}><Icon name="back" size={18} />{step === 1 ? '返回首頁' : '上一題'}</a><div className="wizard-progress"><span>需求引導</span><span>步驟 {step} / 4</span></div><div className="progress-track"><span style={{ width: `${step * 25}%` }} /></div>
        <form onSubmit={e => { e.preventDefault(); const valid = step === 1 ? !!answers.district : step === 2 ? !!answers.need : step === 3 ? !!answers.hasCare && (answers.hasCare !== 'yes' || !!answers.hasManager) : true; if (!valid) { setNotice('請選擇一個選項；不確定時可以選「不清楚」。'); return; } setNotice(''); if (step < 4) go(`guide/${step + 1}`); else go('result'); }}>
          {step === 1 && <><span className="step-icon"><Icon name="pin" size={30} /></span><h1>家人在哪裡需要服務？</h1><p className="page-description">請選擇被照顧者實際需要到府服務的地區。</p><label className="field-label" htmlFor="district">服務行政區</label><select id="district" value={answers.district} onChange={e => update('district', e.target.value as Answers['district'])}><option value="" disabled>請選擇行政區</option>{DISTRICTS.map(d => <option key={d}>{d}</option>)}<option value="other">臺北市以外地區</option><option value="unknown">不清楚，想先諮詢</option></select><div className="soft-note"><Icon name="info" size={20} /><span>不用提供詳細地址，也不需要開啟手機定位。</span></div></>}
          {step === 2 && <><span className="step-icon"><Icon name="heart" size={30} /></span><h1>你希望獲得什麼協助？</h1><p className="page-description">先選最接近的情況，不確定也沒關係。</p><fieldset className="options"><legend className="sr-only">照顧需求</legend>{[{ value: 'home', title: '希望有人到家中協助', text: '我需要暫時離開，想了解居家喘息服務。' }, { value: 'other', title: '想了解其他照顧方式', text: '例如日間照顧、住宿式喘息等選項。' }, { value: 'unknown', title: '還不清楚，想先了解', text: '我知道自己需要休息，但不知道怎麼開始。' }].map(o => <label className={`option ${answers.need === o.value ? 'selected' : ''}`} key={o.value}><input type="radio" name="need" value={o.value} checked={answers.need === o.value} onChange={() => update('need', o.value as Answers['need'])} /><span><strong>{o.title}</strong><small>{o.text}</small></span></label>)}</fieldset></>}
          {step === 3 && <><span className="step-icon"><Icon name="list" size={30} /></span><h1>目前有使用長照服務嗎？</h1><p className="page-description">例如曾由政府安排居家服務、交通接送等。</p><fieldset className="options"><legend className="sr-only">是否使用長照</legend>{[{ value: 'yes', title: '有，目前已使用長照服務' }, { value: 'no', title: '還沒有，這是第一次了解' }, { value: 'unknown', title: '不清楚目前的狀態' }].map(o => <label className={`option ${answers.hasCare === o.value ? 'selected' : ''}`} key={o.value}><input type="radio" name="hasCare" checked={answers.hasCare === o.value} onChange={() => update('hasCare', o.value as Answers['hasCare'])} /><strong>{o.title}</strong></label>)}</fieldset>{answers.hasCare === 'yes' && <fieldset className="options manager-options"><legend>知道個管員的聯絡方式嗎？</legend><p>個管員是協助討論照顧計畫、連結服務的人。</p>{[{ value: 'yes', title: '知道，可以聯絡他' }, { value: 'no', title: '不知道聯絡方式' }, { value: 'unknown', title: '不清楚誰是個管員' }].map(o => <label className={`option ${answers.hasManager === o.value ? 'selected' : ''}`} key={o.value}><input type="radio" name="hasManager" checked={answers.hasManager === o.value} onChange={() => update('hasManager', o.value as Answers['hasManager'])} /><strong>{o.title}</strong></label>)}</fieldset>}</>}
          {step === 4 && <><span className="step-icon"><Icon name="clock" size={30} /></span><h1>有希望協助的時段嗎？</h1><p className="page-description">選填，先把想法記下來，聯絡時就不用重新整理。</p><label className="field-label" htmlFor="preferredTime">希望使用服務的時段 <span className="muted">（選填）</span></label><input id="preferredTime" maxLength={120} value={answers.preferredTime} placeholder="例如：下週三下午，大約三小時" onChange={e => update('preferredTime', e.target.value)} /><div className="soft-note"><Icon name="info" size={20} /><span>時段只會放進聯絡摘要。是否能安排服務，需要由正式窗口確認。</span></div></>}
          <button className="button primary full-width wizard-next" type="submit">{step === 4 ? '查看我的下一步' : '下一步'}<Icon name="arrow" /></button><p className="privacy-note">答案僅用於整理建議；建立清單後才會保存在本機。</p>
        </form>
      </section>}

      {route === 'result' && (guidance ? <section className="narrow"><a className="back-link" href="#guide/4"><Icon name="back" size={18} />修改回答</a><div className="page-heading"><span className="badge">{guidance.label}</span><h1>你的下一步，整理好了</h1><p className="page-description">先做一件事就好，我們陪你慢慢來。</p></div><article className="guidance-card"><span className="step-icon"><Icon name={guidance.id === 'R2' ? 'heart' : 'phone'} size={28} /></span><h2>{guidance.title}</h2><p>{guidance.description}</p><div className="divider" /><span className="field-label">優先聯絡</span><strong className="contact-name">{guidance.contact}</strong>{guidance.id !== 'R2' && <button className="button secondary full-width" onClick={() => void phone('1966')}><Icon name="phone" size={18} />撥打 1966</button>}<OfficialLink>查看官方申請流程</OfficialLink></article><button className="button primary full-width" onClick={() => makePlan()}>建立我的行動清單<Icon name="arrow" /></button>{canShowProviders(answers) && <button className="button ghost full-width" onClick={() => { setDistrictFilter(answers.district); go('providers'); }}>先看看可詢問的居家單位<Icon name="chevron" size={18} /></button>}<SourceNote /></section> : <Empty title="先讓我們了解你的需求" text="完成幾個簡單問題，就能整理出適合你的聯絡路徑。" action="開始需求引導" onClick={begin} />)}

      {route === 'providers' && <section><div className="page-heading"><p className="eyebrow">官方開放資料・居家喘息</p><h1>認識可詢問的照顧資源</h1><p className="page-description">先了解有哪些單位，再由正式窗口確認服務安排。</p></div><div className="directory-layout"><aside className="directory-filter panel"><label htmlFor="filter-district" className="field-label">家人需要服務的行政區</label><select id="filter-district" value={districtFilter} onChange={e => { setDistrictFilter(e.target.value); setShowPending(false); }}><option value="">請選擇服務行政區</option>{DISTRICTS.map(d => <option key={d}>{d}</option>)}</select><p className="small muted">依名錄記載的服務範圍篩選，與機構地址所在區不同。</p><div className="divider" /><p className="small">來源更新<br /><strong>{formatDate(source.sourceUpdatedAt)}</strong></p><a href="#sources" className="text-link">資料來源與說明<Icon name="chevron" size={16} /></a></aside><div className="directory-results">{!districtFilter ? <Empty title="先選擇服務行政區" text="我們會列出服務範圍明確包含該區的居家喘息單位。" /> : <><div className="results-heading"><strong>{districtFilter}</strong><span>{matched.length} 個單位的服務範圍明列此區</span></div><div className="inline-note"><Icon name="info" size={18} /><p>名錄不代表即時空位。首次接觸長照，建議先向 1966 了解申請流程。</p></div>{matched.length ? <div className="provider-list">{matched.map(providerCard)}</div> : <Empty title="目前沒有範圍明確符合的資料" text="名錄可能尚待補充，仍可向 1966 詢問此區資源。" action="撥打 1966" onClick={() => void phone('1966')} />}<button className="pending-toggle" aria-expanded={showPending} onClick={() => setShowPending(!showPending)}><Icon name="info" size={18} /><span>另有 {pending.length} 筆範圍或服務狀態待確認的單位</span><span>{showPending ? '收合' : '查看'}</span></button>{showPending && <><p className="small muted">以下資料含「全區」、尚無法解析的範圍，或停業／暫停派案註記，請先向官方確認目前服務狀態與範圍。</p><div className="provider-list">{pending.map(providerCard)}</div></>}</>}</div></div><SourceNote /></section>}

      {route.startsWith('provider/') && (selected ? <section className="narrow"><a className="back-link" href="#providers"><Icon name="back" size={18} />返回單位清單</a><article className="panel provider-detail"><span className={`badge ${needsProviderConfirmation(selected) ? 'badge-warm' : ''}`}>{hasServiceNotice(selected) ? '服務狀態待確認' : selected.scopeStatus === 'explicit' ? '居家喘息特約單位' : '服務範圍待確認'}</span><h1>{selected.name}</h1>{hasServiceNotice(selected) && <div className="inline-note"><Icon name="info" /><p>來源有停業或暫停派案註記，請先向官方確認目前服務狀態。</p></div>}<dl><div><dt><Icon name="pin" size={19} />服務區別</dt><dd>{selected.serviceAreaRaw}{selected.scopeStatus !== 'explicit' && <small className="block warm-text">範圍尚待確認，請先向單位詢問。</small>}</dd></div><div><dt><Icon name="home" size={19} />機構地址</dt><dd>{selected.address || '來源未提供'}</dd></div><div><dt><Icon name="phone" size={19} />聯絡電話</dt><dd>{selected.phone || '來源未提供'}{selected.phone && !isDialablePhone(selected.phone) && <small className="block warm-text">來源電話格式待確認，請先向官方查詢。</small>}{selected.extension && <span> 分機 {selected.extension}</span>}</dd></div></dl>{isDialablePhone(selected.phone) && <button className="button primary full-width" onClick={() => void phone(selected.phone)}><Icon name="phone" />開啟撥號</button>}<p className="small muted">如有分機，請在電話接通後自行輸入。</p><div className="divider" /><h2>聯絡時可以先問</h2><ul className="question-list"><li>是否服務家人所在的行政區？</li><li>希望的日期與時段，應如何確認安排？</li><li>是否需要先聯絡個管員或完成其他步驟？</li></ul>{guidance && canShowProviders(answers) ? <button className="button secondary full-width" onClick={() => makePlan(selected)}>加入我的聯絡清單<Icon name="list" size={18} /></button> : <button className="button secondary full-width" onClick={begin}>先整理我的照顧需求<Icon name="arrow" size={18} /></button>}</article><SourceNote /></section> : <Empty title="找不到這筆單位資料" text="資料版本可能已更新，請返回清單重新查詢。" action="返回單位清單" onClick={() => go('providers')} />)}

      {route === 'plan' && (plan ? <section className="narrow"><div className="page-heading"><p className="eyebrow">留一點心力，給自己</p><h1>我的喘息行動清單</h1><p className="page-description">一次完成一小步，不需要全部自己記住。</p></div><div className={`save-status ${unsaved ? 'warm-text' : ''}`}><Icon name={unsaved ? 'info' : 'check'} size={18} /><span>{unsaved ? '尚未保存，請先複製摘要' : '已保存在這台裝置'}・{formatDate(plan.updatedAt)}</span></div>{plan.ruleVersion !== RULE_VERSION && <div className="inline-note"><Icon name="info" /><p>這份清單使用較早的引導版本，建議重新整理需求。</p></div>}{plan.dataVersion !== source.version && <div className="inline-note"><Icon name="info" /><p>名錄已有更新，保存的單位資訊可能變動，請重新查詢確認。</p></div>}<article className="panel"><div className="card-heading"><h2>聯絡時，這樣說就好</h2><button className="icon-button" aria-label="複製聯絡摘要" onClick={() => void copy(plan.summary)}><Icon name="copy" /></button></div><p className="summary-text">{plan.summary}</p><div className="summary-contact"><Icon name="phone" size={20} /><div><small>建議先聯絡</small><strong>{GUIDANCE[plan.ruleId].contact}</strong></div>{plan.ruleId !== 'R2' && <button className="button compact secondary" onClick={() => void phone('1966')}>撥打</button>}</div>{plan.provider && <div className="saved-provider"><span className="badge">已記下的單位</span><h3>{plan.provider.name}</h3><p>{plan.provider.phone}{plan.provider.extension && ` 分機 ${plan.provider.extension}`}</p><p className="small muted">供後續詢問，實際安排仍需正式窗口確認。</p>{isDialablePhone(plan.provider.phone) && <button className="button ghost" onClick={() => void phone(plan.provider!.phone)}>聯絡這個單位<Icon name="phone" size={18} /></button>}</div>}</article><article className="panel"><div className="card-heading"><h2>接下來的小步驟</h2><span className="badge">{plan.tasks.filter(t => t.status === 'done').length} / {plan.tasks.length}</span></div><p className="small muted">這是你的個人紀錄，開啟撥號不會自動標記完成。</p><div className="task-list">{plan.tasks.map((task, index) => <div className={`task-row ${task.status === 'done' ? 'task-done' : ''}`} key={task.id}><span className="task-number">{task.status === 'done' ? <Icon name="check" size={16} /> : String(index + 1).padStart(2, '0')}</span><label htmlFor={task.id}>{task.title}</label><select id={task.id} value={task.status} onChange={e => persist({ ...plan, tasks: plan.tasks.map(t => t.id === task.id ? { ...t, status: e.target.value as TaskStatus } : t), updatedAt: new Date().toISOString() })}><option value="todo">待處理</option><option value="waiting">待回覆</option><option value="done">已完成</option></select></div>)}</div></article><div className="plan-actions"><button className="button ghost" onClick={() => { setAnswers(plan.answers); go('guide/1'); }}>重新整理需求<Icon name="arrow" size={18} /></button><button className="button danger-text ghost" onClick={() => setModal({ title: '清除這份行動清單？', description: '本機保存的聯絡摘要與待辦進度都會清除。之後仍可重新建立。', confirm: '清除清單', action: () => { let cleared = false; try { cleared = clearPlan(window.localStorage); } catch { /* Keep current plan visible. */ } if (!cleared) { setNotice('無法清除本機資料，請稍後再試。'); return; } setPlan(null); setAnswers({ ...EMPTY_ANSWERS }); setUnsaved(false); setNotice('已清除這台裝置上的行動清單。'); go('home'); } })}><Icon name="trash" size={18} />清除清單</button></div><p className="privacy-note">清單只保存在這台裝置。清除 App 資料、換裝置或變更網址後，可能無法恢復。</p><SourceNote /></section> : <Empty title="下一步，從了解你的需求開始" text="還沒有保存的行動清單。花幾分鐘整理需求，就能把聯絡摘要與待辦帶著走。" action="建立我的行動清單" onClick={begin} />)}

      {route === 'sources' && <section className="narrow"><a className="back-link" href="#home"><Icon name="back" size={18} />返回首頁</a><div className="page-heading"><p className="eyebrow">透明、清楚，讓你安心</p><h1>關於照護通</h1><p className="page-description">陪你理解資源、整理需求，走向可執行的下一步。</p></div><article className="panel"><h2>資料從哪裡來？</h2><p>{source.name}</p><dl className="source-details"><div><dt>提供機關</dt><dd>{source.publisher}</dd></div><div><dt>來源更新</dt><dd>{formatDate(source.sourceUpdatedAt)}</dd></div><div><dt>取得日期</dt><dd>{formatDate(source.fetchedAt)}</dd></div><div><dt>收錄資料</dt><dd>{source.outputCount} 筆居家式特約單位</dd></div></dl><OfficialLink url={source.datasetUrl}>查看官方資料集</OfficialLink><p className="small muted">資料不定期更新，取得日期不代表內容在當日更新。「全區」與其他待確認範圍另列，不作為已確認涵蓋指定行政區的結果。</p></article><article className="panel"><h2>申請與服務安排</h2><p>引導內容依衛福部官方資訊整理。服務資格、評估、照顧計畫及實際可安排時段，由正式窗口確認。</p><OfficialLink>衛福部長照申請流程</OfficialLink><p className="small muted">1966 服務時間：週一至週五 08:30–12:00、13:30–17:30。非服務時段可以先保存摘要，再於服務時間聯絡。</p></article><article className="panel"><h2>你的資料怎麼保存？</h2><p>不需要登入，也不收集姓名、身分證或病歷。問卷用來整理聯絡路徑；建立清單後，答案及個人待辦保存在這台裝置，可隨時清除。</p><p className="small muted">目前為 POC 試作，尚待完成照顧者使用測試與長照流程專業複核。</p></article></section>}

      {!['home', 'result', 'providers', 'plan', 'sources'].includes(route) && !route.startsWith('guide') && !route.startsWith('provider/') && <Empty title="這個頁面不存在" text="回到首頁，重新整理下一步。" action="返回首頁" onClick={() => go('home')} />}
      <footer className="page-footer"><span>CarePass 照護通</span><span>照顧別人的你，也需要被照顧。</span></footer>
    </main>
    <nav className="bottom-nav" aria-label="主要導覽"><div>{[{ route: 'home', name: '首頁', icon: 'home' as const }, { route: 'providers', name: '照顧資源', icon: 'heart' as const }, { route: 'plan', name: '我的清單', icon: 'list' as const }].map(item => <a key={item.route} href={`#${item.route}`} className={navActive === item.route ? 'active' : ''} aria-current={navActive === item.route ? 'page' : undefined}><Icon name={item.icon} size={22} /><span>{item.name}</span>{item.route === 'plan' && plan && <span className="nav-dot" />}</a>)}</div></nav>
    {modal && <dialog ref={dialogRef} onCancel={e => { e.preventDefault(); setModal(null); }} aria-labelledby="dialog-title"><h2 id="dialog-title">{modal.title}</h2><p>{modal.description}</p><div className="dialog-actions"><button className="button secondary" autoFocus onClick={() => setModal(null)}>先保留</button><button className="button primary" onClick={() => { modal.action(); setModal(null); }}>{modal.confirm}</button></div></dialog>}
  </>;
}

function Empty({ title, text, action, onClick }: { title: string; text: string; action?: string; onClick?: () => void }) {
  return <div className="empty-state"><span className="step-icon"><Icon name="heart" size={30} /></span><h1>{title}</h1><p>{text}</p>{action && <button className="button primary" onClick={onClick}>{action}<Icon name="arrow" size={18} /></button>}</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
