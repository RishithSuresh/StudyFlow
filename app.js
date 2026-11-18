import { createWorker } from 'tesseract.js';
import * as XLSX from 'xlsx';
import { savePaperFile, getPaperFile, deletePaperFile, generateImageThumbnail, formatFileSize } from './paper-storage.js';

const KEY='studyflow-v1';
const API_BASE=window.STUDYFLOW_API_URL
  || (window.location.hostname==='localhost'?'http://localhost:3000/api':'/api');
const todayISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const uid=()=>Math.random().toString(36).slice(2,10);
const starter=()=>({subjects:[],tasks:[],events:[],mistakes:[],mockTests:[],skills:[],notes:[],focus:{minutes:{},sessions:0}});
let storageKey=KEY;
try{
  const cachedUserStr=localStorage.getItem('studyflow_user');
  if(cachedUserStr){
    const cu=JSON.parse(cachedUserStr);
    if(cu&&cu.id)storageKey=`${KEY}:${cu.id}`;
  }
}catch{}

let db;
try{
  const raw=localStorage.getItem(storageKey)||localStorage.getItem(KEY)||'{}';
  db={...starter(),...JSON.parse(raw)};
}catch{
  db=starter();
}
db.mockTests = db.mockTests || [];
db.mistakes = db.mistakes || [];
db.notes = db.notes || [];
const save=()=>{
  workspaceDirty=true;
  try{
    localStorage.setItem(storageKey,JSON.stringify(db));
    if(storageKey!==KEY){
      localStorage.setItem(KEY,JSON.stringify(db));
    }
  }catch(e){
    console.error('LocalStorage save error:',e);
  }
  render();
  window.dispatchEvent(new CustomEvent('studyflow:data-updated',{detail:{db}}));
  queueWorkspaceSync();
};
let workspaceSyncTimer=null;
let workspaceSyncInFlight=false;
let workspaceSyncPending=false;
let workspaceDirty=false;
let workspaceSyncErrorShown=false;
function queueWorkspaceSync(){
  workspaceSyncPending=true;
  clearTimeout(workspaceSyncTimer);
  workspaceSyncTimer=setTimeout(syncWorkspace,300);
}
async function syncWorkspace(){
  if(!workspaceSyncPending||workspaceSyncInFlight)return;
  workspaceSyncPending=false;
  workspaceSyncInFlight=true;
  try{
    const cleanDb = {
      ...db,
      mockTests: (db.mockTests || []).map(t => {
        if (t && t.thumbnail && t.thumbnail.length > 2000) {
          const { thumbnail, ...rest } = t;
          return { ...rest, thumbnail: null };
        }
        return t;
      })
    };
    const response=await fetch(`${API_BASE}/workspace`,{
      method:'PUT',
      credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({state:cleanDb})
    });
    if(!response.ok){
      const payload=await response.json().catch(()=>({}));
      throw new Error(payload.error||'Workspace sync failed.');
    }
    workspaceDirty=false;
    workspaceSyncErrorShown=false;
  }catch(error){
    console.error('Workspace sync error:',error);
    workspaceSyncPending=true;
    if(!workspaceSyncErrorShown&&typeof toast==='function'){
      workspaceSyncErrorShown=true;
      toast('Saved locally. Database sync failed; please check your connection.');
    }
  }finally{
    workspaceSyncInFlight=false;
    if(workspaceSyncPending){
      clearTimeout(workspaceSyncTimer);
      workspaceSyncTimer=setTimeout(syncWorkspace,3000);
    }
  }
}
window.getStudyFlowDb = () => db;
window.getStudyFlowTasks = () => (db && db.tasks) ? db.tasks : [];
window.addStudyFlowTask = (task) => { if(db){ db.tasks = db.tasks || []; db.tasks.push(task); save(); } };
window.updateStudyFlowTask = (id, updates) => { if(db && db.tasks){ const t = db.tasks.find(x => x.id === id); if(t){ Object.assign(t, updates); save(); } } };
window.deleteStudyFlowTask = (id) => { if(db && db.tasks){ db.tasks = db.tasks.filter(x => x.id !== id); save(); } };

function computeLocalStreak(targetDb) {
  const currentDb = targetDb || db;
  const activeDates = new Set();

  if (currentDb?.focus?.minutes) {
    for (const [d, mins] of Object.entries(currentDb.focus.minutes)) {
      if (Number(mins) > 0) activeDates.add(String(d).slice(0, 10));
    }
  }
  if (Array.isArray(currentDb?.tasks)) {
    for (const t of currentDb.tasks) {
      if (t && (t.done || t.completed)) {
        const d = t.completedAt || t.due || t.date;
        if (d) activeDates.add(String(d).slice(0, 10));
      }
    }
  }
  if (Array.isArray(currentDb?.mockTests)) {
    for (const t of currentDb.mockTests) {
      if (t) {
        const d = t.date || t.testedAt || t.createdAt;
        if (d) activeDates.add(String(d).slice(0, 10));
      }
    }
  }
  try {
    const rawSessions = localStorage.getItem('deeptick_sessions_v1');
    if (rawSessions) {
      const sessList = JSON.parse(rawSessions);
      if (Array.isArray(sessList)) {
        for (const s of sessList) {
          if (s.completed && s.startedAt) activeDates.add(String(s.startedAt).slice(0, 10));
        }
      }
    }
  } catch {}

  const toIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const todayStr = toIso(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toIso(yesterday);

  let streak = 0;
  let cursor = null;
  if (activeDates.has(todayStr)) {
    cursor = new Date(now);
  } else if (activeDates.has(yesterdayStr)) {
    cursor = new Date(yesterday);
  }

  if (cursor) {
    while (activeDates.has(toIso(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }
  return { streak, activeDates: Array.from(activeDates) };
}

let cachedStreakVal = null;

function updateStreakUI(explicitStreak) {
  let streak = explicitStreak;
  if (typeof streak !== 'number') {
    const computed = computeLocalStreak(db);
    streak = computed.streak;
  }
  cachedStreakVal = streak;

  const headerStreak = document.getElementById('header-streak-count');
  if (headerStreak) {
    headerStreak.textContent = `${streak}d Streak`;
  }
  const analyticsStreak = document.getElementById('analytics-streak-val');
  if (analyticsStreak) {
    analyticsStreak.textContent = `${streak}d`;
  }

  try {
    const streakRecord = JSON.parse(localStorage.getItem('deeptick_streak_v1') || '{}');
    streakRecord.currentStreak = streak;
    streakRecord.lastActiveDate = todayISO();
    localStorage.setItem('deeptick_streak_v1', JSON.stringify(streakRecord));
  } catch {}

  window.dispatchEvent(new CustomEvent('studyflow:streak-updated', { detail: { streak } }));
}

async function refreshStreakFromServer() {
  try {
    const res = await fetch(`${API_BASE}/statistics`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.streak === 'number') {
        updateStreakUI(data.streak);
        return;
      }
    }
  } catch {}
  updateStreakUI();
}

window.recordStudyFlowFocus = (minutes, date) => {
  if (!db) return;
  db.focus = db.focus || { minutes: {}, sessions: 0 };
  db.focus.minutes = db.focus.minutes || {};
  const d = date || todayISO();
  db.focus.minutes[d] = (db.focus.minutes[d] || 0) + Number(minutes);
  db.focus.sessions = (db.focus.sessions || 0) + 1;
  save();
  updateStreakUI();
  window.dispatchEvent(new CustomEvent('studyflow:activity-logged', { detail: { date: d } }));
};

window.logStudyFlowActivity = (dateStr) => {
  const d = dateStr || todayISO();
  updateStreakUI();
  window.dispatchEvent(new CustomEvent('studyflow:activity-logged', { detail: { date: d } }));
};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>{
  if(!d)return '';
  const str=String(d).trim();
  const dateObj=str.includes('T')?new Date(str):new Date(str+'T12:00:00');
  return isNaN(dateObj.getTime())?str:dateObj.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
};
const toast=m=>{let t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)};
let currentView='overview',taskFilter='all',currentTaskScope='daily',taskSearchQuery='',reviewFilter='all',calDate=new Date(),selectedDate=todayISO(),calFilter='all',modalAction=null;
let activeMockTestId=null,testTab='tests',testSearchQuery='',testMistakeFilter='all',selectedPaperFile=null;
async function loadWorkspaceForUser(userId){
  if(!userId)return;
  storageKey=`${KEY}:${userId}`;
  let localWorkspace;
  workspaceDirty=false;
  try{
    const userRaw=localStorage.getItem(storageKey);
    const globalRaw=localStorage.getItem(KEY);
    const userObj=userRaw?JSON.parse(userRaw):null;
    const globalObj=globalRaw?JSON.parse(globalRaw):null;

    localWorkspace={
      ...starter(),
      ...(globalObj||{}),
      ...(userObj||{})
    };
    localWorkspace.mockTests=userObj?.mockTests||globalObj?.mockTests||[];
    localWorkspace.mistakes=userObj?.mistakes||globalObj?.mistakes||[];
  }catch(err){
    console.error('Error loading user workspace:',err);
    localWorkspace=db||starter();
  }

  db=localWorkspace;
  let loadedFromServer=false;
  let needsServerSync=false;
  try{
    const response=await fetch(`${API_BASE}/workspace`,{credentials:'include'});
    if(!response.ok)throw new Error(`Workspace request failed with status ${response.status}.`);
    const payload=await response.json();
    const serverState=(payload.state&&typeof payload.state==='object'&&!Array.isArray(payload.state))?payload.state:{};
    if (Array.isArray(payload.mockTests)&&payload.mockTests.length&&(!serverState.mockTests||!serverState.mockTests.length)){
      serverState.mockTests=payload.mockTests.map(r=>({
        id:String(r.client_id||r.id),
        name:r.name||'Mock Test',
        marks:Number(r.score)||0,
        totalMarks:100,
        date:r.tested_at?String(r.tested_at).slice(0,10):null,
        description:r.notes||'',
        pointers:r.notes||'',
        hasPaper:Boolean(r.has_paper),
        fileName:r.file_name||'',
        fileType:r.file_type||'',
        fileSize:Number(r.file_size)||0,
        createdAt:r.created_at?String(r.created_at):todayISO()
      }));
    } else if (Array.isArray(payload.mockTests) && Array.isArray(serverState.mockTests)) {
      payload.mockTests.forEach(r => {
        const testId = String(r.client_id || r.id);
        const t = serverState.mockTests.find(x => x && String(x.id) === testId);
        if (t && r.has_paper) {
          t.hasPaper = true;
          t.fileName = t.fileName || r.file_name || '';
          t.fileType = t.fileType || r.file_type || '';
          t.fileSize = t.fileSize || Number(r.file_size) || 0;
        }
      });
    }
    if (Array.isArray(payload.mistakes)&&payload.mistakes.length&&(!serverState.mistakes||!serverState.mistakes.length)){
      serverState.mistakes=payload.mistakes.map(r=>({
        id:String(r.client_id||r.id),
        mockTestId:r.mock_test_client_id||(r.mock_test_id?String(r.mock_test_id):null),
        test:r.test_name||'',
        subject:r.subject||'',
        questionNo:r.question_no||'',
        userAnswer:r.user_answer||'',
        correctAnswer:r.correct_answer||r.status||'',
        status:r.status||r.correct_answer||'',
        topic:r.topic||'General',
        whyCorrection:r.why_correction||r.error||'',
        revisionAction:r.revision_action||r.correction||'',
        error:r.why_correction||r.error||'',
        correction:r.revision_action||r.correction||'',
        pointers:r.pointers||r.revision_action||'',
        marks:Number(r.marks)||Number(r.marks_lost)||0,
        marksLost:Number(r.marks_lost)||Number(r.marks)||0,
        isBlank:Boolean(r.is_blank),
        mistakeType:r.mistake_type||'Conceptual misunderstanding',
        resolved:Boolean(r.resolved),
        source:r.source||'excel_import',
        date:r.created_at?String(r.created_at).slice(0,10):todayISO()
      }));
    }

    if(!workspaceDirty&&serverState&&typeof serverState==='object'){
      const mergedState={...starter(),...serverState};
      // For mockTests and mistakes, serverState is authoritative (prevents resurrecting deleted tests/mistakes)
      mergedState.mockTests=Array.isArray(serverState.mockTests)?serverState.mockTests:[];
      mergedState.mistakes=Array.isArray(serverState.mistakes)?serverState.mistakes:[];

      if (Array.isArray(localWorkspace.mockTests)) {
        mergedState.mockTests.forEach(t => {
          const localTest = localWorkspace.mockTests.find(lt => lt && String(lt.id) === String(t.id));
          if (localTest) {
            if (!t.hasPaper && localTest.hasPaper) {
              t.hasPaper = true;
              t.fileName = t.fileName || localTest.fileName || '';
              t.fileType = t.fileType || localTest.fileType || '';
              t.fileSize = t.fileSize || localTest.fileSize || 0;
            }
            if (!t.thumbnail && localTest.thumbnail) {
              t.thumbnail = localTest.thumbnail;
            }
          }
        });
      }

      ['subjects','tasks','events','skills','notes'].forEach(collection=>{
        const serverItems=Array.isArray(serverState[collection])?serverState[collection]:[];
        const localItems=Array.isArray(localWorkspace[collection])?localWorkspace[collection]:[];
        const serverIds=new Set(serverItems.map(item=>item&&item.id).filter(Boolean));
        if(localItems.some(item=>item&&item.id&&!serverIds.has(item.id)))needsServerSync=true;
        mergedState[collection]=[
          ...serverItems,
          ...localItems.filter(item=>item&&item.id&&!serverIds.has(item.id))
        ];
      });
      mergedState.focus={...(localWorkspace.focus||{}),...(serverState.focus||{})};
      db=mergedState;
      loadedFromServer=true;
    }
  }catch(err){
    console.error('Error loading server workspace:',err);
  }

  if((!loadedFromServer||needsServerSync)&&localWorkspace){
    queueWorkspaceSync();
  }
  try{
    localStorage.setItem(storageKey,JSON.stringify(db));
    localStorage.setItem(KEY,JSON.stringify(db));
  }catch(err){
    console.error('Error caching workspace:',err);
  }
  db.mockTests=db.mockTests||[];
  db.mistakes=db.mistakes||[];
  db.notes=db.notes||[];
  render();
  refreshStreakFromServer();
  window.dispatchEvent(new CustomEvent('studyflow:data-updated',{detail:{db}}));
}
window.addEventListener('studyflow:authenticated',event=>loadWorkspaceForUser(event.detail.user.id));
function go(v){
  currentView=v;
  document.body.classList.toggle('focus-mode',v==='focus');
  document.body.classList.toggle('overview-view',v==='overview');
  $$('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${v}`));
  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
  let titles={overview:"Good morning. Let's make progress.",subjects:'Your subjects, your progress.',calendar:'Make time for what matters.',tasks:'Everything you need to get done.',reviews:'Turn mistakes into marks with test analysis.',focus:'A little focus goes a long way.',skills:'Build skills beyond the syllabus.',notes:'Sticky board for thoughts, pointers & reminders.',profile:'Performance analytics & scholar profile.'};
  $('#page-title').textContent=titles[v]||'StudyFlow — Study command centre';
  if(v!=='focus')document.title='StudyFlow — Study command centre';
  render();
  if(v==='profile'&&typeof window.loadStudyFlowProfile==='function'){
    window.loadStudyFlowProfile();
  }
}
document.addEventListener('click',e=>{let b=e.target.closest('[data-view]');if(b)go(b.dataset.view)});
document.addEventListener('click',e=>{let b=e.target.closest('[data-go]');if(b)go(b.dataset.go)});
function progress(){let all=db.subjects.flatMap(s=>s.topics||[]),done=all.filter(t=>t.done).length;return {all:all.length,done,pct:all.length?Math.round(done/all.length*100):0}}
function rolloverDailyTasks(){
  const today=todayISO();
  let changed=false;
  (db.tasks||[]).forEach(t=>{
    if(!t.scope){
      t.scope=(t.due&&t.due!==today)?'overall':'daily';
    }
    const isDaily=t.scope==='daily';
    if(isDaily&&!t.done&&t.due&&t.due<today){
      if(!t.originalDate)t.originalDate=t.due;
      t.isCarriedForward=true;
      t.carryForwardDate=today;
      t.carryForwardRemark=`Missed on ${fmt(t.originalDate)} (Not completed) — Carried forward to today`;
      t.due=today;
      changed=true;
    }
  });
  if(changed){
    localStorage.setItem(storageKey,JSON.stringify(db));
  }
}
function taskMeta(t){
  const parts=[t.scope==='daily'?'Daily Task':'Overall Task'];
  if(t.type)parts.push(t.type);
  if(t.subject)parts.push(t.subject);
  if(t.due)parts.push('Due '+fmt(t.due));
  return parts.join(' · ');
}
function taskRow(t){
  const isOverdue=t.due&&t.due<todayISO()&&!t.done;
  const isMissedCarried=t.isCarriedForward&&!t.done;
  const isMissedResolved=t.isCarriedForward&&t.done;
  return `<div class="task-row ${t.done?'done':''} ${isMissedCarried?'carried-forward-row':''}"><input class="check" type="checkbox" data-task-check="${t.id}" ${t.done?'checked':''}><div class="task-main"><div class="task-title-line"><span class="scope-pill ${t.scope==='daily'?'daily':'overall'}">${t.scope==='daily'?'☀️ Daily':'📋 Overall'}</span><b>${esc(t.title)}</b></div><small>${esc(taskMeta(t))}</small>${isMissedCarried?`<div class="task-missed-remark"><span class="missed-tag">⚠️ Missed & Carried Forward</span><span class="missed-text">${esc(t.carryForwardRemark||`Missed on ${fmt(t.originalDate)}`)}</span></div>`:''}${isMissedResolved?`<div class="task-missed-remark"><span class="resolved-missed-tag">✓ Completed (Was missed on ${fmt(t.originalDate)})</span></div>`:''}${t.note?`<div class="task-note-snippet">${esc(t.note)}</div>`:''}</div><div class="row-actions">${t.due?`<span class="tag ${isOverdue?'urgent':''}">${isOverdue?'Overdue':fmt(t.due)}</span>`:''}<button class="tiny-btn" data-edit-task="${t.id}">Edit</button><button class="tiny-btn" data-delete-task="${t.id}">×</button></div></div>`;
}
function renderOverview(){
  let p=progress();
  $('#overall-percent').textContent=p.pct+'% complete';
  $('#overall-bar').style.width=p.pct+'%';
  $('#topic-count').textContent=`${p.done} of ${p.all} topics completed`;
  let open=db.tasks.filter(t=>!t.done);
  $('#task-open').textContent=open.length;
  let week=new Date();week.setDate(week.getDate()+7);
  $('#task-due').textContent=open.filter(t=>t.due&&t.due>=todayISO()&&t.due<=week.toISOString().slice(0,10)).length;
  $('#focus-today').textContent=db.focus.minutes[todayISO()]||0;
  let next=open.filter(t=>!t.due||t.due>=todayISO()).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')).slice(0,5);
  $('#today-tasks').className='task-list'+(next.length?'':' empty-state');
  $('#today-tasks').innerHTML=next.length?next.map(taskRow).join(''):'No open tasks. Enjoy the breathing room.';

  // Upcoming deadlines must be of ONLY overall tasks and calendar events (excluding daily tasks)
  const isOverallTask=t=>(t.scope==='overall'||(!t.scope&&t.due&&t.due!==todayISO()));
  let upcoming=[
    ...db.tasks.filter(t=>isOverallTask(t)&&t.due&&!t.done).map(t=>({title:t.title,date:t.due,kind:t.type||'Overall Task'})),
    ...db.events.map(e=>({title:e.title,date:e.date,kind:'Event'}))
  ].filter(x=>x.date>=todayISO()).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);

  $('#upcoming-list').className='upcoming-list'+(upcoming.length?'':' empty-state');
  $('#upcoming-list').innerHTML=upcoming.length?upcoming.map(x=>`<div class="upcoming-item"><div class="date-tile"><b>${new Date(x.date+'T12:00:00').getDate()}</b><small>${new Date(x.date+'T12:00:00').toLocaleDateString('en',{month:'short'}).toUpperCase()}</small></div><div><b>${esc(x.title)}</b><small>${esc(x.kind)} · ${fmt(x.date)}</small></div></div>`).join(''):'No upcoming overall deadlines scheduled.';
  $('#subject-overview').innerHTML=db.subjects.length?db.subjects.slice(0,6).map(subjectCard).join(''):'<div class="panel empty-state">Add your course subjects to see syllabus progress here.</div>'
}
function subjectCard(s){let total=s.topics?.length||0,done=s.topics?.filter(t=>t.done).length||0,p=total?Math.round(done/total*100):0;return `<div class="subject-card"><h3>${esc(s.name)}</h3><p>${esc(s.code||'Course subject')}</p><div class="progress-track"><span style="width:${p}%"></span></div><div class="progress-foot"><span>${done}/${total} topics</span><b>${p}%</b></div></div>`}
function renderSubjects(){$('#subjects-list').innerHTML=db.subjects.length?db.subjects.map(s=>`<div class="panel subject-detail"><div class="subject-detail-head"><div><h3>${esc(s.name)}</h3><div class="muted">${esc(s.code||'')} ${s.term?'· '+esc(s.term):''}</div></div><div><button class="text-btn" data-edit-subject="${s.id}">Edit</button><button class="text-btn" data-delete-subject="${s.id}">Delete</button></div></div><div class="progress-track" style="margin-top:15px"><span style="width:${s.topics?.length?Math.round(s.topics.filter(t=>t.done).length/s.topics.length*100):0}%"></span></div><div class="topic-list">${(s.topics||[]).map((t,i)=>`<label class="topic"><input type="checkbox" data-topic="${s.id}:${i}" ${t.done?'checked':''}>${esc(t.name)}</label>`).join('')||'<span class="muted">No topics yet. Edit this subject to add syllabus topics.</span>'}</div></div>`).join(''):'<div class="panel empty-state">No subjects yet. Add your first subject and list its syllabus topics.</div>'}
function renderTasks(){
  rolloverDailyTasks();
  const allTasks=db.tasks||[];
  const today=todayISO();

  const dailyTasks=allTasks.filter(t=>t.scope==='daily'||(!t.scope&&(!t.due||t.due===today)));
  const overallTasks=allTasks.filter(t=>t.scope==='overall'||(!t.scope&&t.due&&t.due!==today));
  const carriedForwardTasks=allTasks.filter(t=>t.isCarriedForward&&!t.done);

  const badgeDaily=$('#badge-count-daily');
  const badgeOverall=$('#badge-count-overall');
  const badgeAll=$('#badge-count-all');
  if(badgeDaily)badgeDaily.textContent=dailyTasks.length;
  if(badgeOverall)badgeOverall.textContent=overallTasks.length;
  if(badgeAll)badgeAll.textContent=allTasks.length;

  let list=allTasks;
  if(currentTaskScope==='daily')list=dailyTasks;
  else if(currentTaskScope==='overall')list=overallTasks;

  if(taskFilter==='open')list=list.filter(t=>!t.done);
  else if(taskFilter==='done')list=list.filter(t=>t.done);
  else if(taskFilter==='missed')list=list.filter(t=>t.isCarriedForward);

  if(taskSearchQuery){
    const q=taskSearchQuery.toLowerCase();
    list=list.filter(t=>(t.title&&t.title.toLowerCase().includes(q))||(t.subject&&t.subject.toLowerCase().includes(q)));
  }

  list=[...list].sort((a,b)=>{
    if(a.done!==b.done)return a.done?1:-1;
    if(a.isCarriedForward!==b.isCarriedForward)return a.isCarriedForward?-1:1;
    return (a.due||'9999').localeCompare(b.due||'9999');
  });

  const banner=$('#tasks-rollover-banner');
  if(banner){
    if(carriedForwardTasks.length>0){
      banner.hidden=false;
      const countText=`${carriedForwardTasks.length} missed daily task${carriedForwardTasks.length>1?'s':''}`;
      const titleEl=$('#rollover-alert-title');
      const descEl=$('#rollover-alert-desc');
      if(titleEl)titleEl.textContent=`${countText} carried forward to today`;
      if(descEl)descEl.textContent=`Uncompleted daily tasks from past days have rolled over into today's schedule with a missed remark.`;
    }else{
      banner.hidden=true;
    }
  }

  const progressEl=$('#tasks-quick-progress');
  if(progressEl){
    if(currentTaskScope==='daily'){
      const doneDaily=dailyTasks.filter(t=>t.done).length;
      const totalDaily=dailyTasks.length;
      const pct=totalDaily?Math.round(doneDaily/totalDaily*100):0;
      progressEl.innerHTML=`<span>Today's Daily Progress: <b>${doneDaily}/${totalDaily} done (${pct}%)</b></span>`;
    }else if(currentTaskScope==='overall'){
      const doneOverall=overallTasks.filter(t=>t.done).length;
      const totalOverall=overallTasks.length;
      progressEl.innerHTML=`<span>Master Backlog: <b>${doneOverall}/${totalOverall} done</b></span>`;
    }else{
      const doneAll=allTasks.filter(t=>t.done).length;
      progressEl.innerHTML=`<span>All Tasks: <b>${doneAll}/${allTasks.length} done</b></span>`;
    }
  }

  const container=$('#tasks-list');
  if(container){
    container.className='task-list'+(list.length?'':' empty-state');
    if(!list.length){
      let emptyMsg='No tasks in this view.';
      if(currentTaskScope==='daily')emptyMsg='No daily tasks scheduled for today. Click "＋ Add daily task" to plan your day.';
      else if(currentTaskScope==='overall')emptyMsg='No overall tasks logged. Click "＋ Add overall task" to track project milestones.';
      else if(taskFilter==='missed')emptyMsg='No carried-over tasks! All past daily tasks were completed.';
      container.innerHTML=emptyMsg;
    }else{
      container.innerHTML=list.map(taskRow).join('');
    }
  }
}
function renderCalendar(){
  let y=calDate.getFullYear(), m=calDate.getMonth();
  $('#month-label').textContent=calDate.toLocaleDateString('en',{month:'long',year:'numeric'});

  // 1. Month Highlights Stats
  const monthPrefix=`${y}-${String(m+1).padStart(2,'0')}`;
  const monthEvents=(db.events||[]).filter(e=>e.date&&e.date.startsWith(monthPrefix));
  const isOverall=t=>(t.scope==='overall'||(!t.scope&&t.due&&t.due!==todayISO()));
  const monthDeadlines=(db.tasks||[]).filter(t=>isOverall(t)&&t.due&&t.due.startsWith(monthPrefix)&&!t.done);
  const monthDaily=(db.tasks||[]).filter(t=>!isOverall(t)&&t.due&&t.due.startsWith(monthPrefix)&&!t.done);

  const elStatEv=$('#cal-stat-events');
  if(elStatEv) elStatEv.textContent=monthEvents.length;
  const elStatDl=$('#cal-stat-deadlines');
  if(elStatDl) elStatDl.textContent=monthDeadlines.length;
  const elStatDy=$('#cal-stat-daily');
  if(elStatDy) elStatDy.textContent=monthDaily.length;

  // 2. Calendar Grid Construction
  let first=new Date(y,m,1), start=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate(), prev=new Date(y,m,0).getDate(), cells=[];
  for(let i=0;i<42;i++){
    let day=i-start+1, d, other=false;
    if(day<1){
      d=new Date(y,m-1,prev+day);
      other=true;
    }else if(day>days){
      d=new Date(y,m+1,day-days);
      other=true;
    }else{
      d=new Date(y,m,day);
    }
    let iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const isSunday = d.getDay() === 0;
    
    // Day items
    let dayEvents=(db.events||[]).filter(e=>e.date===iso);
    let dayDeadlines=(db.tasks||[]).filter(t=>isOverall(t)&&t.due===iso);
    let dayDaily=(db.tasks||[]).filter(t=>!isOverall(t)&&t.due===iso);

    let filteredItems=[];
    if(calFilter==='events'){
      filteredItems=dayEvents.map(e=>({type:'event',title:e.title,done:false}));
    }else if(calFilter==='deadlines'){
      filteredItems=[
        ...dayDeadlines.map(t=>({type:'deadline',title:t.title,done:t.done})),
        ...dayDaily.map(t=>({type:'daily',title:t.title,done:t.done}))
      ];
    }else{
      filteredItems=[
        ...dayEvents.map(e=>({type:'event',title:e.title,done:false})),
        ...dayDeadlines.map(t=>({type:'deadline',title:t.title,done:t.done})),
        ...dayDaily.map(t=>({type:'daily',title:t.title,done:t.done}))
      ];
    }

    let badgesHtml='';
    if(filteredItems.length>0){
      const visible=filteredItems.slice(0,2);
      const extra=filteredItems.length-2;
      badgesHtml=`<div class="day-cell-badges">`+
        visible.map(item=>{
          if(item.type==='event') return `<span class="cell-mini-pill pill-event" title="${esc(item.title)}">📅 ${esc(item.title)}</span>`;
          if(item.type==='deadline') return `<span class="cell-mini-pill pill-deadline ${item.done?'pill-done':''}" title="${esc(item.title)}">🟠 ${esc(item.title)}</span>`;
          return `<span class="cell-mini-pill pill-daily ${item.done?'pill-done':''}" title="${esc(item.title)}">☀️ ${esc(item.title)}</span>`;
        }).join('')+
        (extra>0?`<span class="cell-mini-more">+${extra} more</span>`:'')+
      `</div>`;
    }

    cells.push(`
      <button type="button" class="day-cell ${isSunday?'sunday':''} ${other?'other':''} ${iso===todayISO()?'today':''} ${iso===selectedDate?'selected':''}" data-day="${iso}">
        <div class="day-cell-top">
          <b class="day-cell-num">${d.getDate()}</b>
          ${iso===todayISO()?'<span class="day-today-tag">TODAY</span>':(isSunday?'<span class="day-sun-tag">SUN</span>':'')}
        </div>
        ${badgesHtml}
      </button>
    `);
  }
  $('#calendar-grid').innerHTML=cells.join('');

  // 3. Selected Day Agenda
  $('#selected-date-label').textContent=fmt(selectedDate);
  const dayEvs=(db.events||[]).filter(e=>e.date===selectedDate);
  const dayOverall=(db.tasks||[]).filter(t=>isOverall(t)&&t.due===selectedDate);
  const dayDailyTasks=(db.tasks||[]).filter(t=>!isOverall(t)&&t.due===selectedDate);

  const container=$('#day-events');
  if(!container) return;

  if(dayEvs.length===0 && dayOverall.length===0 && dayDailyTasks.length===0){
    container.className='day-events-container';
    container.innerHTML=`
      <div class="calendar-day-empty">
        <div class="cal-empty-icon">🗓️</div>
        <h4>No events or deadlines</h4>
        <p>Your schedule is clear for ${fmt(selectedDate)}.</p>
        <div class="cal-empty-actions">
          <button class="btn btn-secondary btn-sm" id="empty-add-event">＋ Add Event</button>
          <button class="btn btn-secondary btn-sm" id="empty-add-task">＋ Add Deadline</button>
        </div>
      </div>
    `;
    const btnE=$('#empty-add-event');
    if(btnE) btnE.onclick=()=>eventModal(null,selectedDate);
    const btnT=$('#empty-add-task');
    if(btnT) btnT.onclick=()=>taskModal(null,'overall',selectedDate);
    return;
  }

  let html='';

  // Events Section
  if(dayEvs.length>0){
    html+=`
      <div class="agenda-section">
        <div class="agenda-section-title">
          <span>📅 Events &amp; Sessions (${dayEvs.length})</span>
        </div>
        <div class="agenda-cards-list">
          ${dayEvs.map(e=>`
            <div class="day-event-card">
              <div class="agenda-card-indicator event-ind"></div>
              <div class="agenda-card-main">
                <div class="agenda-card-title-row">
                  <b>${esc(e.title)}</b>
                  ${e.time?`<span class="agenda-time-badge">⏰ ${esc(e.time)}</span>`:''}
                </div>
                ${e.note?`<p class="agenda-note">${esc(e.note)}</p>`:''}
              </div>
              <div class="agenda-card-actions">
                <button class="tiny-btn" data-edit-event="${e.id}" title="Edit event">Edit</button>
                <button class="tiny-btn" data-delete-event="${e.id}" title="Delete event">×</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Tasks & Deadlines Section
  const combinedTasks=[...dayOverall, ...dayDailyTasks];
  if(combinedTasks.length>0){
    html+=`
      <div class="agenda-section">
        <div class="agenda-section-title">
          <span>🎯 Tasks &amp; Deadlines Due (${combinedTasks.length})</span>
        </div>
        <div class="agenda-cards-list">
          ${combinedTasks.map(t=>{
            const isDaily = t.scope==='daily';
            return `
              <div class="day-task-card ${t.done?'is-done':''}">
                <label class="agenda-check-wrap">
                  <input type="checkbox" class="check cal-task-check" data-task-check="${t.id}" ${t.done?'checked':''}>
                </label>
                <div class="agenda-card-main">
                  <div class="agenda-card-title-row">
                    <span class="scope-pill ${isDaily?'daily':'overall'}">${isDaily?'☀️ Daily':'📋 Overall'}</span>
                    <b class="agenda-task-title ${t.done?'line-through':''}">${esc(t.title)}</b>
                  </div>
                  <div class="agenda-task-meta">
                    ${t.subject?`<span class="meta-item">📚 ${esc(t.subject)}</span>`:''}
                    ${t.reminder?`<span class="meta-item">⏰ ${esc(t.reminder)}</span>`:''}
                    ${t.type?`<span class="meta-item">🏷️ ${esc(t.type)}</span>`:''}
                  </div>
                  ${t.note?`<p class="agenda-note">${esc(t.note)}</p>`:''}
                </div>
                <div class="agenda-card-actions">
                  <button class="tiny-btn" data-edit-task="${t.id}" title="Edit task">Edit</button>
                  <button class="tiny-btn" data-delete-task="${t.id}" title="Delete task">×</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  container.className='day-events-container';
  container.innerHTML=html;
}
function renderSkills(){
  const skills=db.skills||[];
  const totalMilestones=skills.reduce((n,s)=>n+(s.milestones||[]).length,0);
  const completedSkills=skills.filter(s=>s.status==='Completed').length;
  
  const summaryEl=$('#skill-summary');
  if(summaryEl){
    summaryEl.innerHTML=`
      <div class="review-stat">
        <strong>${skills.length}</strong>
        <small>Skills being learned</small>
      </div>
      <div class="review-stat">
        <strong>${totalMilestones}</strong>
        <small>Milestones logged</small>
      </div>
      <div class="review-stat">
        <strong>${completedSkills}</strong>
        <small>Skills completed</small>
      </div>
    `;
  }
  
  const listEl=$('#skills-list');
  if(!listEl)return;
  
  if(!skills.length){
    listEl.innerHTML=`<div class="panel empty-state">No extra skills added yet. Add a skill you want to learn — like Python, Machine Learning, System Design, Cloud, SQL, or Cybersecurity — attach your courses/resources, and log milestones as you learn!</div>`;
    return;
  }
  
  listEl.innerHTML=skills.map(s=>{
    const ms=s.milestones||[];
    const resources=s.resources||[];
    const isCompleted=s.status==='Completed';
    
    return `
      <article class="skill-card ${isCompleted?'is-completed':''}">
        <div class="skill-card-head">
          <div>
            <span class="skill-category">${esc(s.category||'General')}</span>
            <h3>${esc(s.name)}</h3>
          </div>
          <span class="tag ${isCompleted?'tag-completed':'skill-status'}">${esc(s.status||'Not started')}</span>
        </div>

        <div class="skill-meta-bar">
          <span class="skill-meta-badge"><strong>Level:</strong> ${esc(s.level||'Beginner')}</span>
          ${s.target?`<span class="skill-meta-badge"><strong>Target:</strong> ${fmt(s.target)}</span>`:''}
          <span class="skill-meta-badge milestone-count-badge">🎯 <strong>${ms.length}</strong> milestone${ms.length===1?'':'s'} logged</span>
        </div>

        <!-- Resources Section -->
        <div class="skill-section-block">
          <div class="skill-block-title">
            <span>📚 Learning Resources</span>
            <span class="res-count-badge">${resources.length}</span>
          </div>
          ${resources.length?`
            <div class="skill-resources-grid">
              ${resources.map(r=>{
                const title=r.title||r.url||'Resource';
                if(r.url){
                  const isYT=/youtube\.com|youtu\.be/i.test(r.url);
                  const isDoc=/docs|documentation|github\.com|dev\./i.test(r.url);
                  const icon=isYT?'▶':(isDoc?'📖':'🔗');
                  return `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" class="resource-chip resource-link" title="${esc(r.url)}">
                    <span class="res-icon">${icon}</span>
                    <span class="res-title">${esc(title)}</span>
                    <span class="res-arrow">↗</span>
                  </a>`;
                }
                return `<span class="resource-chip resource-text" title="${esc(title)}">
                  <span class="res-icon">📖</span>
                  <span class="res-title">${esc(title)}</span>
                </span>`;
              }).join('')}
            </div>
          `:`<p class="skill-empty-text">No learning resources linked yet. Click "Edit learning plan" to add courses, documentation, or books.</p>`}
        </div>

        <!-- Milestones Log Section -->
        <div class="skill-section-block milestone-log-block">
          <div class="skill-block-head">
            <div class="skill-block-title">
              <span>✨ Learning Milestone Log</span>
              <span class="res-count-badge">${ms.length}</span>
            </div>
            <button type="button" class="btn-sm-pill btn-log-milestone" data-log-milestone="${s.id}" title="Log what you learned">
              ＋ Log milestone
            </button>
          </div>

          ${ms.length?`
            <div class="milestone-log-feed">
              ${ms.map((m,idx)=>{
                const milestoneName=m.name||m.title||'Logged Milestone';
                const dateStr=m.date?fmt(m.date):'';
                return `
                  <div class="milestone-feed-item">
                    <div class="milestone-item-left">
                      <span class="milestone-dot">✦</span>
                      <div class="milestone-content">
                        <div class="milestone-item-header">
                          <strong class="milestone-name">${esc(milestoneName)}</strong>
                          ${dateStr?`<span class="milestone-date">${esc(dateStr)}</span>`:''}
                        </div>
                        ${m.takeaway?`<div class="milestone-takeaway">💡 ${esc(m.takeaway)}</div>`:''}
                        ${m.note?`<div class="milestone-note-text">${esc(m.note)}</div>`:''}
                      </div>
                    </div>
                    <button type="button" class="milestone-delete-btn" data-delete-milestone="${s.id}:${m.id||idx}" title="Delete milestone">✕</button>
                  </div>
                `;
              }).join('')}
            </div>
          `:`
            <div class="milestone-empty-box">
              <p>No milestones logged yet. When you understand a core concept, build a project, or complete a tutorial chapter, log it here!</p>
              <button type="button" class="btn-sm-pill btn-log-milestone" data-log-milestone="${s.id}">
                ✨ Log your first milestone
              </button>
            </div>
          `}
        </div>

        ${s.notes?`<div class="skill-notes"><span class="notes-tag">📝 Notes:</span> ${esc(s.notes)}</div>`:''}

        <div class="skill-actions">
          <button class="text-btn" data-edit-skill="${s.id}">Edit learning plan</button>
          <button class="text-btn danger-hover" data-delete-skill="${s.id}">Delete</button>
        </div>
      </article>
    `;
  }).join('');
}
function calculateTopicAnalytics(mistakes){
  if(!mistakes||!mistakes.length)return null;
  const topicCounts={},topicMarksLost={},topicTypeMap={};
  mistakes.forEach(m=>{
    const raw=(m.topic||'General').trim();
    if(!raw)return;
    const topic=raw.split(/\s+/).map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
    topicCounts[topic]=(topicCounts[topic]||0)+1;
    const lost=parseFloat(m.marksLost)||0;
    topicMarksLost[topic]=(topicMarksLost[topic]||0)+lost;
    if(!topicTypeMap[topic])topicTypeMap[topic]={};
    const type=m.mistakeType||'Other';
    topicTypeMap[topic][type]=(topicTypeMap[topic][type]||0)+1;
  });
  const sortedTopics=Object.entries(topicCounts).sort((a,b)=>b[1]-a[1]);
  if(!sortedTopics.length)return null;
  const totalMistakes=mistakes.length;
  const maxMistakes=sortedTopics[0][1];
  const topTopics=sortedTopics.filter(([_,count])=>count===maxMistakes);
  const primaryTopicName=topTopics.map(([t])=>t).join(', ');
  const topTopicPercent=Math.round((maxMistakes/totalMistakes)*100);
  const topTopic=sortedTopics[0][0];
  const typesInTopTopic=Object.entries(topicTypeMap[topTopic]||{}).sort((a,b)=>b[1]-a[1]);
  const dominantType=typesInTopTopic[0]?.[0]||'General';
  let advice='';
  if(dominantType.includes('Conceptual')){
    advice=`Most errors in ${topTopic} were conceptual misunderstandings. Revisit foundational theory, definitions, and step-by-step derivations before solving more questions.`;
  }else if(dominantType.includes('Calculation')||dominantType.includes('Silly')){
    advice=`Errors in ${topTopic} were predominantly calculation or numerical slips. Work with scratchpad steps clearly and verify intermediate substitutions.`;
  }else if(dominantType.includes('Formula')){
    advice=`Formulas were forgotten or misapplied in ${topTopic}. Keep a dedicated formula summary sheet for this topic and revise it before your next test.`;
  }else if(dominantType.includes('Question misread')){
    advice=`Questions were misread or constraints were missed in ${topTopic}. Underline key constraints (e.g. 'not', 'minimum', 'integers only') when reading questions.`;
  }else if(dominantType.includes('Time pressure')){
    advice=`You were rushed under time pressure in ${topTopic}. Practice timed problem sets (e.g. 10 questions in 20 minutes) to build speed and accuracy.`;
  }else if(dominantType.includes('Unattempted')||dominantType.includes('blank')){
    advice=`Questions in ${topTopic} were left blank or unattempted. Review foundational problem types and practice direct numericals in this topic to capture easy marks.`;
  }else{
    advice=`Targeted revision recommended for ${topTopic}. Focus on logging practice problems and reviewing core takeaways.`;
  }
  return {
    primaryTopicName,
    topTopics,
    maxMistakes,
    topTopicPercent,
    topTopicMarksLost:topicMarksLost[topTopic]||0,
    dominantType,
    advice,
    sortedList:sortedTopics.map(([topic,count])=>({
      topic,
      count,
      percent:Math.round((count/totalMistakes)*100),
      marksLost:topicMarksLost[topic]||0,
      unresolved:mistakes.filter(m=>(m.topic||'').trim().toLowerCase()===topic.toLowerCase()&&!m.resolved).length
    }))
  };
}

function renderReviews(){
  db.mockTests=db.mockTests||[];
  db.mistakes=db.mistakes||[];
  db.notes=db.notes||[];
  const totalTests=db.mockTests.length;
  let totalScorePct=0;
  if(totalTests){
    const sumPcts=db.mockTests.reduce((acc,t)=>{
      const m=Number(t.marks)||0, tot=Number(t.totalMarks)||100;
      return acc+(tot?Math.round((m/tot)*100):0);
    },0);
    totalScorePct=Math.round(sumPcts/totalTests);
  }
  const overallAnalytics=calculateTopicAnalytics(db.mistakes);
  const weakestTopicDisplay=overallAnalytics?`${overallAnalytics.primaryTopicName} (${overallAnalytics.maxMistakes})`:'—';
  const unresolvedMistakes=db.mistakes.filter(m=>!m.resolved).length;
  const statsBox=$('#mock-test-stats');
  if(statsBox){
    statsBox.innerHTML=`
      <div class="review-stat"><strong>${totalTests}</strong><small>Tests attempted</small></div>
      <div class="review-stat"><strong>${totalScorePct}%</strong><small>Average marks</small></div>
      <div class="review-stat"><strong title="${esc(weakestTopicDisplay)}">${esc(weakestTopicDisplay)}</strong><small>Overall weakest topic</small></div>
      <div class="review-stat"><strong>${db.mistakes.length}</strong><small>${unresolvedMistakes} need review</small></div>
    `;
  }
  if($('#test-tab-count'))$('#test-tab-count').textContent=totalTests;
  if($('#mistake-tab-count'))$('#mistake-tab-count').textContent=db.mistakes.length;

  const testContainer=$('#mock-tests-container');
  const mistakesContainer=$('#all-mistakes-container');
  if(testTab==='tests'){
    if(testContainer)testContainer.style.display='block';
    if(mistakesContainer)mistakesContainer.style.display='none';
  }else{
    if(testContainer)testContainer.style.display='none';
    if(mistakesContainer)mistakesContainer.style.display='block';
  }

  // Render mock tests grid
  let tests=[...db.mockTests].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(testSearchQuery){
    const q=testSearchQuery.toLowerCase();
    tests=tests.filter(t=>(t.name||'').toLowerCase().includes(q)||(t.subject||'').toLowerCase().includes(q)||(t.description||'').toLowerCase().includes(q));
  }
  const grid=$('#mock-tests-grid');
  if(grid){
    if(!tests.length){
      grid.innerHTML=`
        <div class="panel empty-state" style="grid-column: 1 / -1; padding: 40px 20px; text-align: center;">
          <div style="font-size: 38px; margin-bottom: 10px;">📄</div>
          <h3 style="margin: 0 0 8px; font-size: 18px; color: var(--sf-navy);">${testSearchQuery?'No test papers found matching search.':'No mock test papers uploaded yet.'}</h3>
          <p class="muted" style="max-width: 440px; margin: 0 auto 18px;">
            ${testSearchQuery?'Try searching with different keywords.':'Upload your written paper as an image or PDF. It will generate a review card where you can track marks, log mistakes, and calculate your weakest topics automatically.'}
          </p>
          <button class="primary-btn" id="empty-upload-btn">＋ Upload test paper</button>
        </div>
      `;
      const emptyBtn=$('#empty-upload-btn');
      if(emptyBtn)emptyBtn.onclick=()=>openMockTestModal();
    }else{
      grid.innerHTML=tests.map(t=>{
        const testMistakes=db.mistakes.filter(m=>m.mockTestId===t.id||(m.test&&m.test===t.name)||(db.mockTests.length===1&&(!m.mockTestId||!m.mockTestId.length)));
        const analytics=calculateTopicAnalytics(testMistakes);
        const marks=Number(t.marks)||0;
        const totalMarks=Number(t.totalMarks)||100;
        const pct=totalMarks?Math.round((marks/totalMarks)*100):0;
        const pctClass=pct>=70?'high':(pct>=50?'medium':'low');
        const weakestPill=analytics?
          `<div class="test-card-weakest"><span>🎯</span> Weakest topic: <b>${esc(analytics.primaryTopicName)}</b> (${analytics.maxMistakes} errors)</div>`:
          `<div class="test-card-weakest empty"><span>📝</span> Click to log mistakes & analyze topics</div>`;

        let paperStrip='';
        if(t.hasPaper){
          if(t.fileType?.startsWith('image/')&&t.thumbnail){
            paperStrip=`<div class="test-paper-strip" data-view-paper="${t.id}" title="Click to view full paper"><img src="${t.thumbnail}" class="test-paper-thumb" alt="Paper thumbnail"><div class="test-paper-info"><b>${esc(t.fileName||'Paper Image')}</b><small>${formatFileSize(t.fileSize)} · Image attached · Click to view</small></div><button type="button" class="tiny-btn" data-view-paper="${t.id}" style="margin-left:auto;">👁 View</button></div>`;
          }else{
            paperStrip=`<div class="test-paper-strip" data-view-paper="${t.id}" title="Click to view question paper PDF"><div class="test-paper-icon">📄</div><div class="test-paper-info"><b>${esc(t.fileName||'Question_Paper.pdf')}</b><small>${formatFileSize(t.fileSize)} · PDF Question Paper · Click to view</small></div><button type="button" class="tiny-btn" data-view-paper="${t.id}" style="margin-left:auto;">👁 Preview</button></div>`;
          }
        }else{
          paperStrip=`<div class="test-paper-strip"><div class="test-paper-icon">📝</div><div class="test-paper-info"><b>Question Paper</b><small>No PDF attached</small></div><button type="button" class="tiny-btn" data-attach-paper="${t.id}" style="margin-left:auto;">📎 Attach PDF</button></div>`;
        }

        return `
          <article class="mock-test-card" data-open-test="${t.id}">
            <div class="test-card-head">
              <h3>${esc(t.name)}</h3>
              <span class="tag">${fmt(t.date||t.createdAt||todayISO())}</span>
            </div>
            <div class="test-score-row">
              <span class="test-marks-badge">${marks} <small>/ ${totalMarks}</small></span>
              <span class="test-pct-badge ${pctClass}">${pct}%</span>
              ${t.subject?`<span class="tag">${esc(t.subject)}</span>`:''}
            </div>
            ${paperStrip}
            ${t.description?`<p class="test-card-desc">${esc(t.description)}</p>`:''}
            ${weakestPill}
            <div class="test-card-footer">
              <span>${testMistakes.length} mistakes logged</span>
              <div class="test-card-actions">
                <button class="tiny-btn" data-import-excel="${t.id}" title="Import mistakes from Excel/CSV">📊 Excel</button>
                <button class="tiny-btn" data-edit-mock-test="${t.id}" title="Edit test info">Edit</button>
                <button class="tiny-btn" data-delete-mock-test="${t.id}" title="Delete test">Delete</button>
              </div>
            </div>
          </article>
        `;
      }).join('');
    }
  }

  // Render all mistakes list for legacy / global view
  const mList=$('#mistakes-list');
  if(mList){
    const list=db.mistakes.filter(m=>reviewFilter==='all'||(reviewFilter==='resolved'?m.resolved:!m.resolved));
    mList.className='mistake-list'+(list.length?'':' empty-state');
    mList.innerHTML=list.length?list.map(m=>`
      <div class="mistake-card">
        <div class="mistake-head">
          <b>${m.questionNo?`<span class="qno-badge">${esc(m.questionNo)}</span> `:''}${esc(m.topic)} <span class="tag">${esc(m.subject||'General')}</span></b>
          <span class="tag ${m.resolved?'':'urgent'}">${m.resolved?'Resolved':'Needs review'}</span>
        </div>
        ${m.isBlank ? `<span class="tag" style="background:#f1f5f9;color:#475569;margin:2px 0 6px;display:inline-block;">⚪ Blank / Unattempted</span>` : (m.mistakeType ? `<span class="tag" style="margin:2px 0 6px;display:inline-block;">${esc(m.mistakeType)}</span>` : '')}
        ${(m.userAnswer || m.correctAnswer) ? `
          <div style="font-size:12px; margin: 4px 0;">
            ${m.userAnswer ? `<span>Your Ans: <b style="color:${m.isBlank ? '#64748b' : '#b91c1c'};">${esc(m.userAnswer)}</b></span>` : ''}
            ${m.correctAnswer ? `<span> · Correct / Status: <b style="color:#15803d;">${esc(m.correctAnswer)}</b></span>` : ''}
          </div>
        ` : ''}
        <div style="margin:6px 0; font-size:13px; line-height:1.5;">
          <b>Why correction needed:</b> ${esc(m.whyCorrection || m.error)}<br>
          <b>Revision action:</b> ${esc(m.revisionAction || m.correction || 'Not added yet')}
        </div>
        <div class="mistake-meta">${esc(m.test||(db.mockTests.find(x=>x.id===m.mockTestId)?.name)||'Mock test')} · ${m.date?fmt(m.date):''}${m.marksLost?` · <b style="color:#9b3323">-${m.marksLost} marks</b>`:''}${m.source==='excel_import'?' · via Excel':''}</div>
        <div class="row-actions" style="margin-top:8px">
          <button class="text-btn" data-toggle-mistake="${m.id}">${m.resolved?'Reopen':'Mark resolved'}</button>
          <button class="text-btn" data-edit-mistake="${m.id}">Edit</button>
          <button class="text-btn" data-delete-mistake="${m.id}">Delete</button>
        </div>
      </div>
    `).join(''):'No mistakes in this view.';
  }
}

function openMockTestModal(id=null){
  const dialog=$('#modal-upload-test');
  if(!dialog)return;
  const form=$('#form-upload-test');
  form.reset();
  selectedPaperFile=null;
  const idInput=$('#input-test-id');
  const titleEl=$('#test-modal-title');
  const eyebrowEl=$('#test-modal-eyebrow');
  const dropPrompt=$('#dropzone-prompt');
  const dropPreview=$('#dropzone-preview');
  const imgWrap=$('#preview-img-wrap');
  const thumbImg=$('#preview-thumb-img');
  const filenameEl=$('#preview-filename');
  const filesizeEl=$('#preview-filesize');
  const previewIcon=$('#preview-icon');

  // Populate subject datalist
  const datalist=$('#subject-datalist');
  if(datalist){
    datalist.innerHTML=(db.subjects||[]).map(s=>`<option value="${esc(s.name)}">`).join('');
  }

  if(id){
    const t=db.mockTests.find(x=>x.id===id);
    if(!t)return;
    idInput.value=t.id;
    titleEl.textContent='Edit mock test paper';
    eyebrowEl.textContent='EDIT TEST PAPER';
    $('#test-title').value=t.name||'';
    $('#test-marks').value=t.marks??'';
    $('#test-total-marks').value=t.totalMarks||100;
    $('#test-subject').value=t.subject||'';
    $('#test-date').value=t.date||todayISO();
    $('#test-description').value=t.description||'';
    $('#test-pointers').value=t.pointers||'';

    if(t.hasPaper){
      dropPrompt.hidden=true;
      dropPreview.hidden=false;
      filenameEl.textContent=t.fileName||'Attached paper';
      filesizeEl.textContent=formatFileSize(t.fileSize);
      if(t.fileType?.startsWith('image/')&&t.thumbnail){
        previewIcon.textContent='🖼️';
        imgWrap.hidden=false;
        thumbImg.src=t.thumbnail;
      }else{
        previewIcon.textContent='📄';
        imgWrap.hidden=true;
      }
    }else{
      dropPrompt.hidden=false;
      dropPreview.hidden=true;
      imgWrap.hidden=true;
    }
  }else{
    idInput.value='';
    titleEl.textContent='Upload mock test paper';
    eyebrowEl.textContent='NEW TEST PAPER';
    $('#test-total-marks').value=100;
    $('#test-date').value=todayISO();
    dropPrompt.hidden=false;
    dropPreview.hidden=true;
    imgWrap.hidden=true;
  }
  if(!dialog.open)dialog.showModal();
}

function handlePaperFileSelected(file){
  if(!file)return;
  selectedPaperFile=file;
  const dropPrompt=$('#dropzone-prompt');
  const dropPreview=$('#dropzone-preview');
  const imgWrap=$('#preview-img-wrap');
  const thumbImg=$('#preview-thumb-img');
  const filenameEl=$('#preview-filename');
  const filesizeEl=$('#preview-filesize');
  const previewIcon=$('#preview-icon');

  dropPrompt.hidden=true;
  dropPreview.hidden=false;
  filenameEl.textContent=file.name;
  filesizeEl.textContent=formatFileSize(file.size);

  const isPdf=(file.type&&file.type.toLowerCase().includes('pdf'))||(file.name&&file.name.toLowerCase().endsWith('.pdf'));
  if(file.type?.startsWith('image/')&&!isPdf){
    previewIcon.textContent='🖼️';
    imgWrap.hidden=false;
    thumbImg.src=URL.createObjectURL(file);
  }else{
    previewIcon.textContent='📄';
    imgWrap.hidden=true;
  }
}

async function openMockTestDetail(testId){
  const t=db.mockTests.find(x=>x.id===testId);
  if(!t)return;
  activeMockTestId=testId;
  const dialog=$('#modal-test-detail');
  if(!dialog)return;

  $('#detail-test-title').textContent=t.name;
  const marks=Number(t.marks)||0;
  const totalMarks=Number(t.totalMarks)||100;
  const pct=totalMarks?Math.round((marks/totalMarks)*100):0;
  const pctClass=pct>=70?'high':(pct>=50?'medium':'low');

  const badgesRow=$('#detail-badges-row');
  badgesRow.innerHTML=`
    <span class="test-marks-badge">${marks} <small>/ ${totalMarks}</small></span>
    <span class="test-pct-badge ${pctClass}">${pct}%</span>
    ${t.subject?`<span class="tag">${esc(t.subject)}</span>`:''}
    <span class="tag">${fmt(t.date||t.createdAt||todayISO())}</span>
  `;

  $('#detail-test-desc').textContent=t.description||'No description provided for this test attempt.';
  const pointersInput=$('#detail-test-pointers-input');
  if(pointersInput)pointersInput.value=t.pointers||'';

  // Paper container in detail view
  const paperContainer=$('#detail-paper-container');
  if(t.hasPaper){
    let thumbHtml=t.thumbnail?
      `<img src="${t.thumbnail}" class="paper-card-thumb" data-view-paper="${t.id}" alt="View paper">`:
      `<div class="paper-card-icon" data-view-paper="${t.id}">📄</div>`;
    paperContainer.innerHTML=`
      <div class="paper-attached-card">
        ${thumbHtml}
        <div class="paper-card-meta">
          <b>${esc(t.fileName||'Question_Paper.pdf')}</b>
          <small>${formatFileSize(t.fileSize)} · ${t.fileType?.includes('pdf')?'PDF Question Paper':'Image Paper'}</small>
        </div>
      </div>
      <div class="paper-btn-group" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
        <button type="button" class="btn btn-primary btn-sm" data-view-paper="${t.id}">🔍 View Paper Preview</button>
        <a href="${API_BASE}/papers/${encodeURIComponent(t.id)}?raw=1" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" data-direct-paper-link="${t.id}">↗ Open in new tab</a>
        <button type="button" class="btn btn-secondary btn-sm" data-download-paper="${t.id}">⬇ Download PDF</button>
        <button type="button" class="btn btn-secondary btn-sm" data-attach-paper="${t.id}">📎 Replace</button>
        <button type="button" class="btn btn-secondary btn-sm" data-remove-paper="${t.id}" style="color:#b91c1c;">🗑 Remove</button>
      </div>
    `;
  }else{
    paperContainer.innerHTML=`
      <div class="paper-attached-card">
        <div class="paper-card-icon">📄</div>
        <div class="paper-card-meta">
          <b>No Question Paper attached</b>
          <small>Upload your question paper PDF to view it alongside your mistakes.</small>
        </div>
      </div>
      <div class="paper-btn-group" style="margin-top:8px;">
        <button type="button" class="btn btn-primary btn-sm" data-attach-paper="${t.id}">📎 Attach Question Paper PDF</button>
      </div>
    `;
  }

  // AUTOMATIC WEAKEST TOPIC SECTION (Key Requirement)
  const testMistakes=db.mistakes.filter(m=>m.mockTestId===t.id||(m.test&&m.test===t.name)||(db.mockTests.length===1&&(!m.mockTestId||!m.mockTestId.length)));
  const analytics=calculateTopicAnalytics(testMistakes);
  const analyticsSection=$('#detail-analytics-section');

  if(!analytics){
    analyticsSection.innerHTML=`
      <div class="weakest-topic-spotlight" style="background: var(--sf-sand); border-color: var(--sf-border);">
        <div class="spotlight-head">
          <div>
            <div class="eyebrow">AUTOMATIC TOPIC ANALYSIS</div>
            <h3 style="color: var(--sf-navy); font-size: 19px;">No mistakes logged yet</h3>
          </div>
        </div>
        <p style="margin: 6px 0 0; font-size: 12px; color: var(--sf-navy-soft);">
          Click <b>"＋ Log mistake"</b> below to record each question you got wrong. StudyFlow will automatically analyze which topic you struggled with most and calculate where you lost marks.
        </p>
      </div>
    `;
  }else{
    analyticsSection.innerHTML=`
      <div class="weakest-topic-spotlight">
        <div class="spotlight-head">
          <div>
            <div class="eyebrow" style="color: #9b3323;">AUTOMATIC TOPIC ANALYSIS · HIGHEST ERROR AREA</div>
            <h3>🎯 Most Missed Topic: ${esc(analytics.primaryTopicName)}</h3>
          </div>
          <span class="tag urgent" style="font-size: 11px;">Weakest Area</span>
        </div>
        <div class="spotlight-stats">
          <span><b>${analytics.maxMistakes}</b> mistake${analytics.maxMistakes>1?'s':''} (${analytics.topTopicPercent}% of errors in this test)</span>
          ${analytics.topTopicMarksLost>0?`<span>· Marks lost: <b>-${analytics.topTopicMarksLost}</b></span>`:''}
          <span>· Dominant reason: <b>${esc(analytics.dominantType)}</b></span>
        </div>
        <div class="spotlight-tip">
          <b>💡 Key Takeaway:</b> ${esc(analytics.advice)}
        </div>
      </div>

      <div class="topic-breakdown-panel">
        <div class="topic-breakdown-head">
          <h4>Topic-by-topic mistake distribution</h4>
          <small class="muted">${analytics.sortedList.length} topic${analytics.sortedList.length>1?'s':''} affected</small>
        </div>
        <div class="topic-breakdown-list">
          ${analytics.sortedList.map((item,idx)=>`
            <div class="topic-breakdown-row">
              <div class="topic-row-info">
                <span class="topic-row-name">${idx===0?'⚠️ ':''}${esc(item.topic)}</span>
                <div class="topic-row-counts">
                  <span>${item.count} mistake${item.count>1?'s':''} (${item.percent}%)</span>
                  ${item.marksLost>0?`<span>· -${item.marksLost}m</span>`:''}
                  ${item.unresolved>0?`<span style="color: #9b3323;">· ${item.unresolved} need review</span>`:'<span style="color: #24582c;">· Resolved</span>'}
                </div>
              </div>
              <div class="topic-bar-bg">
                <div class="topic-bar-fill ${idx===0?'highlight':''}" style="width: ${item.percent}%;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Render mistakes list for this test
  if($('#detail-filter-all-count'))$('#detail-filter-all-count').textContent=testMistakes.length;
  if($('#detail-filter-unresolved-count'))$('#detail-filter-unresolved-count').textContent=testMistakes.filter(m=>!m.resolved).length;
  if($('#detail-filter-resolved-count'))$('#detail-filter-resolved-count').textContent=testMistakes.filter(m=>m.resolved).length;

  const filteredMistakes=testMistakes.filter(m=>testMistakeFilter==='all'||(testMistakeFilter==='resolved'?m.resolved:!m.resolved));
  const mistakesListEl=$('#detail-mistakes-list');
  if(!filteredMistakes.length){
    mistakesListEl.className='test-mistakes-container empty-state';
    mistakesListEl.textContent=testMistakes.length?
      'No mistakes match the selected filter.':
      'No mistakes logged for this test yet. Click "＋ Log mistake" above to add your first question review.';
  }else{
    mistakesListEl.className='test-mistakes-container';
    mistakesListEl.innerHTML=filteredMistakes.map(m=>`
      <div class="test-mistake-card ${m.resolved?'resolved':''}">
        <div class="mistake-card-top">
          <div class="mistake-tags-row">
            ${m.questionNo?`<span class="qno-badge">${esc(m.questionNo)}</span>`:''}
            <span class="tag"><b>${esc(m.topic)}</b></span>
            ${m.isBlank?`<span class="tag" style="background:#f1f5f9;color:#475569;border-color:#cbd5e1;">⚪ Blank / Unattempted</span>`:(m.mistakeType?`<span class="tag">${esc(m.mistakeType)}</span>`:'')}
            ${m.marksLost?`<span class="tag urgent">-${m.marksLost} marks</span>`:''}
          </div>
          <span class="tag ${m.resolved?'':'urgent'}">${m.resolved?'Resolved':'Needs review'}</span>
        </div>
        ${(m.userAnswer || m.correctAnswer) ? `
          <div class="mistake-answers-row">
            ${m.userAnswer ? `<span>Your Answer: <b style="color:${m.isBlank ? '#64748b' : '#b91c1c'};">${esc(m.userAnswer)}</b></span>` : ''}
            ${m.correctAnswer ? `<span>Correct Answer / Status: <b style="color:#15803d;">${esc(m.correctAnswer)}</b></span>` : ''}
          </div>
        ` : ''}
        <div class="mistake-body-grid">
          <div class="mistake-body-col">
            <b>${m.isBlank ? 'Reason unattempted / why correction needed:' : 'Why your response needs correction:'}</b>
            <span>${esc(m.whyCorrection || m.error)}</span>
          </div>
          <div class="mistake-body-col">
            <b>Revision action:</b>
            <span>${esc(m.revisionAction || m.correction || 'Not specified')}</span>
          </div>
        </div>
        ${m.pointers&&m.pointers!==m.correction?`<div style="font-size:11px; color:var(--sf-navy-soft); background:#fff; padding:6px 10px; border-radius:6px; border:1px solid var(--sf-border);"><b>Pointer:</b> ${esc(m.pointers)}</div>`:''}
        <div class="mistake-card-foot">
          <span>Logged on ${fmt(m.date||t.date||todayISO())}${m.source==='excel_import'?' · via Excel':''}</span>
          <div class="row-actions">
            <button class="tiny-btn" data-toggle-test-mistake="${m.id}">${m.resolved?'Reopen':'Mark resolved'}</button>
            <button class="tiny-btn" data-edit-test-mistake="${m.id}">Edit</button>
            <button class="tiny-btn" data-delete-test-mistake="${m.id}">Delete</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  if(!dialog.open)dialog.showModal();
}

function openMistakeModal(mistakeId=null,testId=null){
  const dialog=$('#modal-log-mistake');
  if(!dialog)return;
  const form=$('#form-log-mistake');
  form.reset();
  const idInput=$('#input-mistake-id');
  const testIdInput=$('#input-mistake-testid');
  const targetSelect=$('#mistake-target-test-select');
  const titleEl=$('#mistake-modal-title');
  const eyebrowEl=$('#mistake-modal-eyebrow');

  // Populate mock tests select
  if(targetSelect){
    if(!db.mockTests || !db.mockTests.length){
      targetSelect.innerHTML='<option value="">General / Unassigned (No test paper created yet)</option>';
    } else {
      let opts = db.mockTests.map(t=>`<option value="${t.id}">${esc(t.name)} (${esc(t.subject||'Mock Test')})</option>`).join('');
      opts += '<option value="">General / Unassigned</option>';
      targetSelect.innerHTML=opts;
    }
  }

  // Populate topics datalist
  const topicDatalist=$('#mistake-topics-datalist');
  if(topicDatalist){
    const syllabusTopics=(db.subjects||[]).flatMap(s=>s.topics||[]).map(t=>t.name);
    const existingTopics=db.mistakes.map(m=>m.topic);
    const uniqueTopics=[...new Set([...syllabusTopics,...existingTopics].filter(Boolean))];
    topicDatalist.innerHTML=uniqueTopics.map(top=>`<option value="${esc(top)}">`).join('');
  }

  if(mistakeId){
    const m=db.mistakes.find(x=>x.id===mistakeId);
    if(!m)return;
    if(idInput)idInput.value=m.id;
    const assignedTestId=m.mockTestId||testId||'';
    if(testIdInput)testIdInput.value=assignedTestId;
    if(targetSelect)targetSelect.value=assignedTestId;
    titleEl.textContent='Edit question mistake';
    eyebrowEl.textContent='EDIT MISTAKE';
    if($('#mistake-qno'))$('#mistake-qno').value=m.questionNo||'';
    if($('#mistake-topic'))$('#mistake-topic').value=m.topic||'';
    if($('#mistake-user-answer'))$('#mistake-user-answer').value=m.userAnswer||'';
    if($('#mistake-correct-answer'))$('#mistake-correct-answer').value=m.correctAnswer||m.status||'';
    if($('#mistake-marks'))$('#mistake-marks').value=m.marks??m.marksLost??'';
    if($('#mistake-type'))$('#mistake-type').value=m.mistakeType||(m.isBlank?'Unattempted / Left blank':'Conceptual misunderstanding');
    if($('#mistake-why'))$('#mistake-why').value=m.whyCorrection||m.error||'';
    if($('#mistake-action'))$('#mistake-action').value=m.revisionAction||m.correction||'';
    if($('#mistake-resolved'))$('#mistake-resolved').checked=!!m.resolved;
  }else{
    if(idInput)idInput.value='';
    const defaultTestId=testId||activeMockTestId||(db.mockTests?.length===1?db.mockTests[0].id:'');
    if(testIdInput)testIdInput.value=defaultTestId;
    if(targetSelect)targetSelect.value=defaultTestId;
    titleEl.textContent='Log question mistake';
    eyebrowEl.textContent='MOCK TEST MISTAKE';
    if($('#mistake-qno'))$('#mistake-qno').value='';
    if($('#mistake-topic'))$('#mistake-topic').value='';
    if($('#mistake-user-answer'))$('#mistake-user-answer').value='';
    if($('#mistake-correct-answer'))$('#mistake-correct-answer').value='';
    if($('#mistake-marks'))$('#mistake-marks').value='';
    if($('#mistake-type'))$('#mistake-type').value='Conceptual misunderstanding';
    if($('#mistake-why'))$('#mistake-why').value='';
    if($('#mistake-action'))$('#mistake-action').value='';
    if($('#mistake-resolved'))$('#mistake-resolved').checked=false;
  }
  dialog.showModal();
}

async function viewPaperFull(testId){
  const t=db.mockTests.find(x=>x.id===testId);
  const dialog=$('#modal-paper-viewer');
  const contentEl=$('#viewer-content');
  const titleEl=$('#viewer-paper-title');
  const downloadLink=$('#viewer-download-link');
  const openTabBtn=$('#viewer-open-tab-btn');

  titleEl.textContent=t?.name?`${t.name} — Question Paper`:'Question Paper Preview';
  contentEl.innerHTML=`
    <div class="viewer-empty-state">
      <span style="font-size:36px;">⏳</span>
      <h4 style="margin:12px 0 6px; color:var(--sf-navy);">Loading Question Paper...</h4>
      <p style="margin:0; font-size:12px; color:var(--sf-navy-soft);">Fetching paper from storage...</p>
    </div>
  `;
  dialog.showModal();

  const record=await getPaperFile(testId);
  if(!record||(!record.blob && !record.dataUrl)){
    contentEl.innerHTML=`
      <div class="viewer-empty-state">
        <span style="font-size:36px;">📄</span>
        <h4 style="margin:12px 0 6px; color:var(--sf-navy);">No paper file attached</h4>
        <p style="margin:0; font-size:12px; color:var(--sf-navy-soft);">This mock test was saved without an attached question paper file.</p>
        <button type="button" class="btn btn-primary btn-sm" style="margin-top:14px;" data-attach-paper="${testId}">📎 Attach Question Paper PDF Now</button>
      </div>
    `;
    downloadLink.hidden=true;
    if(openTabBtn)openTabBtn.hidden=true;
    return;
  }

  const isPdf=(record.type&&record.type.toLowerCase().includes('pdf'))||(record.name&&record.name.toLowerCase().endsWith('.pdf'));
  let displayBlob=record.blob;
  if(!displayBlob && record.dataUrl){
    try{
      let base64 = record.dataUrl;
      if(base64.includes(',')) base64 = base64.split(',')[1];
      const byteChars = atob(base64);
      const byteNums = new Array(byteChars.length);
      for(let i=0; i<byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
      displayBlob = new Blob([new Uint8Array(byteNums)], { type: record.type || 'application/pdf' });
    }catch(e){
      console.warn('Could not decode base64 dataUrl into blob:', e);
    }
  }

  const blobUrl = displayBlob ? URL.createObjectURL(displayBlob) : '';
  const serverViewUrl = `${API_BASE}/papers/${encodeURIComponent(testId)}?raw=1`;
  const viewUrl = blobUrl || serverViewUrl;

  downloadLink.hidden=false;
  downloadLink.href=viewUrl;
  downloadLink.download=record.name||'question-paper.pdf';

  if(openTabBtn){
    openTabBtn.hidden=false;
    openTabBtn.href=serverViewUrl;
  }

  if(record.type?.startsWith('image/')&&!isPdf){
    contentEl.innerHTML=`<img src="${viewUrl}" class="viewer-img" alt="Question paper preview">`;
  }else{
    contentEl.innerHTML=`
      <div class="pdf-viewer-wrap">
        <iframe src="${viewUrl}" class="viewer-pdf-frame" title="PDF Question Paper Viewer" frameborder="0"></iframe>
        <div class="pdf-fallback-bar">
          <span>📄 <b>${esc(record.name||'question-paper.pdf')}</b> (${formatFileSize(record.size||displayBlob?.size)})</span>
          <div style="display:flex;gap:8px;align-items:center;">
            <a href="${serverViewUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">↗ Open in new tab</a>
            <a href="${viewUrl}" download="${esc(record.name||'question-paper.pdf')}" class="btn btn-secondary btn-sm">⬇ Download PDF</a>
          </div>
        </div>
      </div>
    `;
  }
}

async function downloadPaperFile(testId){
  const record=await getPaperFile(testId);
  if(!record||(!record.blob && !record.dataUrl)){
    window.open(`${API_BASE}/papers/${encodeURIComponent(testId)}?download=1`, '_blank');
    return;
  }
  const isPdf=(record.type&&record.type.toLowerCase().includes('pdf'))||(record.name&&record.name.toLowerCase().endsWith('.pdf'));
  let displayBlob=record.blob;
  if(!displayBlob && record.dataUrl){
    try{
      let base64 = record.dataUrl;
      if(base64.includes(',')) base64 = base64.split(',')[1];
      const byteChars = atob(base64);
      const byteNums = new Array(byteChars.length);
      for(let i=0; i<byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
      displayBlob = new Blob([new Uint8Array(byteNums)], { type: record.type || 'application/pdf' });
    }catch(e){
      console.warn('Could not decode base64 dataUrl for download:', e);
    }
  }
  if(displayBlob){
    const url=URL.createObjectURL(displayBlob);
    const a=document.createElement('a');
    a.href=url;
    a.download=record.name||(isPdf?'question-paper.pdf':'paper-file');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  } else {
    window.open(`${API_BASE}/papers/${encodeURIComponent(testId)}?download=1`, '_blank');
  }
}

// =========================================================================
// Instant & Automatic Excel Mistake Logger
// Supported Columns:
// 1. Q No.
// 2. Your Answer
// 3. Correct Answer / Status
// 4. Topic
// 5. Why your response needs correction
// 6. Revision action
// 7. Marks
// =========================================================================

let activeExcelImportTestId=null;

function downloadSampleExcelTemplate(){
  const sampleHeaders=[
    {
      'Q No.':'Q1',
      'Your Answer':'B',
      'Correct Answer / Status':'C',
      'Topic':'Dynamic Programming',
      'Why your response needs correction':'Miscalculated recurrence base condition for n=0',
      'Revision action':'Revise 0/1 knapsack base case derivations in notes',
      'Marks':2
    },
    {
      'Q No.':'Q2',
      'Your Answer':'Unattempted',
      'Correct Answer / Status':'Blank',
      'Topic':'Graph Theory',
      'Why your response needs correction':'Ran out of time to read Dijkstra variation with negative edges',
      'Revision action':'Practice 5 Bellman-Ford & Dijkstra problem sets under timer',
      'Marks':1
    },
    {
      'Q No.':'Q3',
      'Your Answer':'42.5',
      'Correct Answer / Status':'Incorrect',
      'Topic':'Computer Networks',
      'Why your response needs correction':'Applied round-trip time instead of transmission delay in throughput formula',
      'Revision action':'Memorize sliding window throughput vs efficiency formulas',
      'Marks':2
    },
    {
      'Q No.':'Q4',
      'Your Answer':'Left Blank',
      'Correct Answer / Status':'Blank',
      'Topic':'Operating Systems',
      'Why your response needs correction':'Skipped question due to confusion in Banker\'s algorithm safe sequence',
      'Revision action':'Re-solve 3 deadlock avoidance matrix problems',
      'Marks':2
    }
  ];
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(sampleHeaders);
  ws['!cols']=[
    {wch:10},
    {wch:16},
    {wch:24},
    {wch:26},
    {wch:45},
    {wch:45},
    {wch:10}
  ];
  XLSX.utils.book_append_sheet(wb,ws,'Mistakes_Analysis');
  XLSX.writeFile(wb,'StudyFlow_Mistakes_Template.xlsx');
  toast('Downloaded StudyFlow_Mistakes_Template.xlsx');
}

function normalizeExcelHeader(str){
  return String(str||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
}

function mapExcelColumns(headers){
  const map={};
  headers.forEach(h=>{
    const k=normalizeExcelHeader(h);
    if(!map.qNo&&(k.startsWith('qno')||k.startsWith('qnum')||k==='q'||k.startsWith('question')||k==='no'||k.startsWith('sno')||k.startsWith('srno')||k.startsWith('slno')||k==='item')){
      map.qNo=h;
    }else if(!map.yourAnswer&&(k.includes('your')||k.includes('my')||k.includes('student')||k.includes('marked')||k.includes('user')||k==='response'||k.includes('youranswer')||k.includes('given')||k.includes('attempted')||k.includes('selected'))){
      map.yourAnswer=h;
    }else if(!map.correctAnswer&&(k.includes('correct')||k.includes('key')||k.includes('official')||k.includes('status')||k.includes('actual')||k.includes('right')||k.includes('expected')||k.includes('answerkey'))){
      map.correctAnswer=h;
    }else if(!map.topic&&(k.includes('topic')||k.includes('concept')||k.includes('chapter')||k.includes('subject')||k.includes('module')||k.includes('unit')||k.includes('subtopic')||k.includes('category')||k.includes('tag'))){
      map.topic=h;
    }else if(!map.why&&(k.includes('why')||k.includes('reason')||k.includes('error')||k.includes('cause')||k.includes('mistake')||k.includes('correctionneeds')||k.includes('explanation')||k.includes('remark')||k.includes('analysis')||k.includes('whatwentwrong'))){
      map.why=h;
    }else if(!map.action&&(k.includes('action')||k.includes('revision')||k.includes('pointer')||k.includes('fix')||k.includes('remedy')||k.includes('solution')||k.includes('takeaway')||k.includes('solutionpointer')||k.includes('howtosolve'))){
      map.action=h;
    }else if(!map.marks&&(k.includes('mark')||k.includes('score')||k.includes('point')||k.includes('loss')||k.includes('weight')||k.includes('negative')||k.includes('markslost')||k.includes('penalty'))){
      map.marks=h;
    }
  });
  return map;
}

function isRowBlankOrUnattempted(yourAns,correctStatus,whyText){
  const y=String(yourAns||'').trim().toLowerCase();
  const c=String(correctStatus||'').trim().toLowerCase();
  const w=String(whyText||'').trim().toLowerCase();
  const blankKeywords=['blank','unattempted','skipped','left blank','not attempted','na','n/a','-','--','none'];
  if(!y||blankKeywords.includes(y))return true;
  if(c.includes('blank')||c.includes('unattempted')||c.includes('skipped'))return true;
  if(w.includes('unattempted')||w.includes('left blank')||w.includes('skipped')||w.includes('could not attempt')||w.includes('ran out of time'))return true;
  return false;
}

function inferMistakeType(whyText,isBlank){
  if(isBlank)return 'Unattempted / Left blank';
  const w=String(whyText||'').toLowerCase();
  if(w.includes('calc')||w.includes('arithmetic')||w.includes('numerical')||w.includes('algebra')||w.includes('sign error')||w.includes('addition')||w.includes('multiplication')){
    return 'Calculation / Numerical error';
  }
  if(w.includes('formula')||w.includes('identity')||w.includes('equation')||w.includes('theorem')){
    return 'Formula forgotten / wrongly applied';
  }
  if(w.includes('misread')||w.includes('condition')||w.includes('wording')||w.includes('not read')||w.includes('missed')){
    return 'Question misread / missed condition';
  }
  if(w.includes('time')||w.includes('rush')||w.includes('hurry')||w.includes('panic')||w.includes('speed')){
    return 'Time pressure / rushed attempt';
  }
  if(w.includes('bubbl')||w.includes('silly')||w.includes('slip')||w.includes('typo')||w.includes('marked wrong')){
    return 'Silly slip / bubbling error';
  }
  return 'Conceptual misunderstanding';
}

function openExcelImportModal(testId){
  activeExcelImportTestId=testId||activeMockTestId;
  const selectEl=$('#excel-target-test-select');
  if(selectEl){
    const tests=db.mockTests||[];
    let opts=tests.map(t=>`<option value="${t.id}" ${(t.id===activeExcelImportTestId)?'selected':''}>${esc(t.name)} ${t.subject?`(${esc(t.subject)})`:''}</option>`).join('');
    opts+=`<option value="__new__" ${(!activeExcelImportTestId||!tests.length)?'selected':''}>＋ Create new mock test from this sheet</option>`;
    selectEl.innerHTML=opts;
    activeExcelImportTestId=selectEl.value;
    selectEl.onchange=()=>{
      activeExcelImportTestId=selectEl.value;
    };
  }
  const banner=$('#excel-import-test-banner');
  if(banner){
    const test=db.mockTests.find(x=>x.id===activeExcelImportTestId);
    banner.innerHTML=test?`Target Mock Test: <b>${esc(test.name)}</b>`:'Automatic Question Import';
  }
  selectedExcelPaperFile=null;
  const paperFileInput=$('#excel-modal-paper-input');
  if(paperFileInput)paperFileInput.value='';
  if($('#excel-paper-file-label'))$('#excel-paper-file-label').textContent='Attach Question Paper PDF (Optional)';
  if($('#excel-paper-file-sub'))$('#excel-paper-file-sub').textContent='Store the question paper PDF alongside your mistake log';
  if($('#excel-paper-icon'))$('#excel-paper-icon').textContent='📄';
  if($('#excel-paper-attach-box')){
    $('#excel-paper-attach-box').style.borderColor='var(--sf-border)';
    $('#excel-paper-attach-box').style.background='white';
  }
  const fileInput=$('#excel-file-input');
  if(fileInput)fileInput.value='';
  if($('#excel-file-selected-bar'))$('#excel-file-selected-bar').hidden=true;
  if($('#excel-dropzone-prompt'))$('#excel-dropzone-prompt').hidden=false;
  $('#modal-import-excel-mistakes').showModal();
}

async function handleAutoExcelUpload(file,customTargetTestId=null){
  if(!file)return;
  toast(`📊 Reading "${file.name}" & automatically logging mistakes...`);

  try{
    const arrayBuffer=await file.arrayBuffer();
    const wb=XLSX.read(arrayBuffer,{type:'array'});
    const firstSheetName=wb.SheetNames[0];
    const ws=wb.Sheets[firstSheetName];

    // Read full sheet array of rows to reliably identify header row
    const sheetData=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
    if(!sheetData||!sheetData.length){
      toast('The uploaded spreadsheet contains no data rows.');
      return;
    }

    // Scan top 10 rows to find header row matching the 7 columns
    let headerRowIdx=-1;
    let colMap=null;
    for(let r=0;r<Math.min(10,sheetData.length);r++){
      const row=sheetData[r];
      if(Array.isArray(row)&&row.some(c=>String(c).trim().length>0)){
        const testMap=mapExcelColumns(row.map(c=>String(c).trim()));
        if(Object.keys(testMap).length>=2){
          headerRowIdx=r;
          colMap=testMap;
          break;
        }
      }
    }

    let rawRows=[];
    if(headerRowIdx!==-1&&colMap){
      const headerNames=sheetData[headerRowIdx].map(c=>String(c).trim());
      for(let r=headerRowIdx+1;r<sheetData.length;r++){
        const row=sheetData[r];
        if(!row||!row.some(c=>String(c).trim().length>0))continue;
        const rowObj={};
        headerNames.forEach((name,i)=>{
          rowObj[name]=row[i]!==undefined?row[i]:'';
        });
        rawRows.push(rowObj);
      }
    }else{
      rawRows=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(rawRows.length){
        colMap=mapExcelColumns(Object.keys(rawRows[0]));
      }
    }

    if(!rawRows||!rawRows.length){
      toast('No question rows detected in spreadsheet.');
      return;
    }

    // Process all rows into 7 columns:
    // Q No. | Your Answer | Correct Answer / Status | Topic | Why your response needs correction | Revision action | Marks
    const parsedRows=rawRows.map((r,idx)=>{
      let qRaw=String(r[colMap?.qNo]??(idx+1)).trim();
      let qNo=qRaw;
      if(qRaw&&/^\d+$/.test(qRaw)){
        qNo=`Q${qRaw}`;
      }else if(!qNo){
        qNo=`Q${idx+1}`;
      }

      const yourAnswer=String(r[colMap?.yourAnswer]??'').trim();
      const correctAnswer=String(r[colMap?.correctAnswer]??'').trim();
      const topic=String(r[colMap?.topic]??'General').trim()||'General';
      const whyCorrection=String(r[colMap?.why]??'').trim();
      const revisionAction=String(r[colMap?.action]??'').trim();
      let marksRaw=parseFloat(r[colMap?.marks]);
      if(isNaN(marksRaw))marksRaw=0;
      const marksLost=Math.abs(marksRaw);

      const isBlank=isRowBlankOrUnattempted(yourAnswer,correctAnswer,whyCorrection);
      const mistakeType=inferMistakeType(whyCorrection,isBlank);

      return{
        qNo,
        yourAnswer:isBlank&&!yourAnswer?'Left blank':yourAnswer,
        correctAnswer:correctAnswer||(isBlank?'Blank':''),
        status:isBlank?'Blank':(correctAnswer||'Incorrect'),
        topic,
        whyCorrection:whyCorrection||(isBlank?'Question left unattempted in exam':'Needs review'),
        revisionAction:revisionAction||'Review concepts and re-attempt problem',
        marksLost,
        isBlank,
        mistakeType
      };
    });

    // Identify or create target mock test
    const selectVal=$('#excel-target-test-select')?.value;
    let targetTestId=customTargetTestId||selectVal||activeExcelImportTestId||activeMockTestId;
    let targetTest=db.mockTests.find(x=>x.id===targetTestId);

    const fileName=file.name||'Mock Test Review';
    const cleanName=fileName.replace(/\.[^/.]+$/,'')||'Mock Test Review';
    const totalMarksLost=parsedRows.reduce((sum,r)=>sum+r.marksLost,0);
    const calculatedScore=Math.max(0,Math.round((100-totalMarksLost)*100)/100);

    if(!targetTest||targetTestId==='__new__'){
      targetTestId=uid();
      targetTest={
        id:targetTestId,
        name:cleanName,
        marks:calculatedScore,
        totalMarks:100,
        subject:parsedRows[0]?.topic||'General',
        date:todayISO(),
        description:`Imported from spreadsheet (${parsedRows.length} questions analysed)`,
        pointers:'',
        hasPaper:false,
        fileName:'',
        fileType:'',
        fileSize:0,
        thumbnail:null,
        createdAt:new Date().toISOString()
      };
      db.mockTests.unshift(targetTest);
    }else{
      targetTest.marks=calculatedScore;
      targetTest.description=`Updated with ${parsedRows.length} questions from ${cleanName}`;
    }

    if(selectedExcelPaperFile){
      const isPdf=(selectedExcelPaperFile.type&&selectedExcelPaperFile.type.toLowerCase().includes('pdf'))||
                  (selectedExcelPaperFile.name&&selectedExcelPaperFile.name.toLowerCase().endsWith('.pdf'));
      targetTest.hasPaper=true;
      targetTest.fileName=selectedExcelPaperFile.name;
      targetTest.fileType=isPdf?'application/pdf':(selectedExcelPaperFile.type||'image/jpeg');
      targetTest.fileSize=selectedExcelPaperFile.size;
      try{
        await savePaperFile(targetTestId,selectedExcelPaperFile);
      }catch(paperErr){
        console.warn('Could not save attached question paper file:',paperErr);
      }
      selectedExcelPaperFile=null;
    }

    // Construct new mistake records with all 7 columns
    const newMistakes=parsedRows.map(r=>({
      id:uid(),
      mockTestId:targetTestId,
      test:targetTest.name||cleanName,
      subject:targetTest.subject||'',
      questionNo:r.qNo,
      userAnswer:r.yourAnswer,
      correctAnswer:r.correctAnswer,
      status:r.status,
      topic:r.topic,
      whyCorrection:r.whyCorrection,
      revisionAction:r.revisionAction,
      error:r.whyCorrection,
      correction:r.revisionAction,
      pointers:r.revisionAction,
      marks:r.marksLost,
      marksLost:r.marksLost,
      isBlank:r.isBlank,
      mistakeType:r.mistakeType,
      resolved:false,
      date:targetTest.date||todayISO(),
      source:'excel_import'
    }));

    // Update local database state: replace existing mistakes for this test or append
    db.mistakes=[
      ...db.mistakes.filter(m=>m.mockTestId!==targetTestId),
      ...newMistakes
    ];

    // AUTOMATIC DATABASE SAVE: Post directly to dedicated backend upload endpoint
    fetch(`${API_BASE}/mistakes/upload`,{
      method:'POST',
      credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        testId:targetTestId,
        testName:targetTest.name,
        testDate:targetTest.date||todayISO(),
        totalMarks:100,
        mistakes:newMistakes
      })
    }).catch(err=>{
      console.warn('Dedicated upload endpoint warning:',err);
    });

    // Also persist local state & trigger background workspace sync
    save();

    // Close modal if open
    const importDialog=$('#modal-import-excel-mistakes');
    if(importDialog&&importDialog.open)importDialog.close();

    // Immediately display the results
    activeMockTestId=targetTestId;
    go('reviews');
    renderReviews();
    openMockTestDetail(targetTestId);

    const blankCount=parsedRows.filter(r=>r.isBlank).length;
    const mistakeCount=parsedRows.length-blankCount;
    toast(`🎉 Successfully logged ${parsedRows.length} questions (${mistakeCount} mistakes, ${blankCount} blanks) from "${file.name}"! Saved to database.`);
  }catch(err){
    console.error('Error auto-logging Excel sheet:',err);
    toast('Failed to read spreadsheet. Please ensure it is a valid .xlsx or .csv file with question columns.');
  }
}
function render(){renderOverview();renderSubjects();renderSkills();renderNotes();renderTasks();renderCalendar();renderReviews();updateStreakUI()}
function field(label,name,type='text',value='',extra=''){return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`}
function selectField(label,name,options,value=''){return `<div class="field"><label>${label}</label><select name="${name}">${options.map(o=>`<option ${o[0]===value?'selected':''} value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select></div>`}
function area(label,name,value=''){return `<div class="field"><label>${label}</label><textarea name="${name}">${esc(value)}</textarea></div>`}
function openManualTab(tabKey){
  const dialog=$('#modal-feature-manual');
  if(!dialog) return;
  const targetKey=tabKey||currentView||'overview';
  const targetBtn=$(`[data-manual-tab="${targetKey}"]`);
  $$('.manual-tab-btn').forEach(btn=>btn.classList.toggle('active',btn===targetBtn));
  $$('.manual-panel-view').forEach(panel=>panel.classList.toggle('active',panel.id===`manual-tab-content-${targetKey}`));
  if(!dialog.open) dialog.showModal();
}
window.openManualTab=openManualTab;

function openModal(title,fields,handler){$('#modal-title').textContent=title;$('#modal-fields').innerHTML=fields;modalAction=handler;$('#item-dialog').showModal()}
$('#item-form').addEventListener('submit',e=>{
  if(e.submitter?.value==='cancel'){
    $('#item-dialog').close();
    return;
  }
  e.preventDefault();
  if(!modalAction)return;
  let data=Object.fromEntries(new FormData(e.currentTarget).entries());
  modalAction(data);
  $('#item-dialog').close();
  save();
});
document.addEventListener('click',e=>{
  const closeBtn=e.target.closest('[data-close-modal],[data-close-item-dialog],button[value="cancel"],.modal-head .icon-btn');
  if(closeBtn){
    const dialog=closeBtn.closest('dialog');
    if(dialog){
      e.preventDefault();
      dialog.close();
    }
  }
});
function taskModal(id,defaultScope=(currentTaskScope==='overall'?'overall':'daily'),initialDate=null){
  let t=db.tasks.find(x=>x.id===id)||{};
  const initialScope=t.scope||defaultScope;
  openModal(
    id?'Edit task':'Add task',
    `<div class="field-grid">${selectField('Task Category','scope',[['daily','☀️ Daily Task (For today / specific day)'],['overall','📋 Overall Task (Master backlog / Milestone)']],initialScope)}${selectField('Type','type',['Study','Assignment','Project','Revision','Exam','Practice','Other'].map(x=>[x,x]),t.type||'Study')}</div>`+
    field('Task name','title','text',t.title||'','required')+
    `<div class="field-grid">${selectField('Subject','subject',[['','No subject'],...db.subjects.map(s=>[s.name,s.name])],t.subject||'')}${field('Date / Deadline','due','date',t.due||initialDate||(initialScope==='daily'?todayISO():''))}</div>`+
    `<div class="field-grid">${field('Reminder time (optional)','reminder','time',t.reminder||'')}</div>`+
    (t.isCarriedForward?`<div class="field-callout-missed"><strong>⚠️ Carry-Forward Note:</strong><p>${esc(t.carryForwardRemark||`Missed on ${fmt(t.originalDate)}`)}</p></div>`:'')+
    area('Notes / checklist','note',t.note||''),
    d=>{
      if(id){
        Object.assign(t,d);
      }else{
        db.tasks.push({id:uid(),...d,done:false,isCarriedForward:false});
      }
      toast(id?'Task updated':(d.scope==='daily'?'Daily task planned for today':'Overall task added'));
    }
  );
}
function cleanExtractedTopics(text){return text.split(/\r?\n/).map(line=>line.replace(/^[\s•●▪*-]*(?:\d+[\s.)-]*)?/,'').replace(/\s+/g,' ').trim()).filter(line=>line.length>2)}
async function extractSyllabusTopics(file,preview,status,topicsField){preview.src=URL.createObjectURL(file);preview.hidden=false;status.textContent='Reading syllabus image…';try{const worker=await createWorker('eng');const result=await worker.recognize(file);await worker.terminate();const topics=cleanExtractedTopics(result.data.text);topicsField.value=topics.join('\n');status.textContent=topics.length?`Found ${topics.length} lines. Edit them before saving.`:'No readable topic lines found. Enter them manually.'}catch(error){console.error('Syllabus OCR failed.',error);status.textContent='Could not read the image. Enter the topics manually.'}}
function subjectModal(id){let s=db.subjects.find(x=>x.id===id)||{};openModal(id?'Edit subject':'Add subject',field('Subject name','name','text',s.name||'','required')+`<div class="field-grid">${field('Subject code','code','text',s.code||'')}${field('Semester / term','term','text',s.term||'')}</div><div class="field"><label for="syllabus-image">Import syllabus image</label><input id="syllabus-image" type="file" accept="image/*"><img id="syllabus-preview" class="syllabus-preview" alt="Syllabus preview" hidden><small id="syllabus-status" class="syllabus-status">Upload a clear syllabus image to extract topic lines.</small></div>${area('Syllabus topics (one per line)','topics',(s.topics||[]).map(t=>t.name).join('\n'))}`,d=>{let topics=d.topics.split('\n').map(x=>x.trim()).filter(Boolean).map(name=>({name,done:(s.topics||[]).some(t=>t.name===name&&t.done)}));if(id)Object.assign(s,{...d,topics});else db.subjects.push({id:uid(),...d,topics});toast(id?'Subject updated':'Subject added')});let imageInput=$('#syllabus-image'),preview=$('#syllabus-preview'),status=$('#syllabus-status'),topicsField=document.querySelector('[name="topics"]');imageInput?.addEventListener('change',()=>{let file=imageInput.files?.[0];if(file)extractSyllabusTopics(file,preview,status,topicsField)})}
function skillModal(id){
  let s=(db.skills||[]).find(x=>x.id===id)||{};
  let resourcesStr='';
  if(Array.isArray(s.resources)){
    resourcesStr=s.resources.map(r=>r.url?`${r.title} | ${r.url}`:r.title).join('\n');
  } else if(typeof s.resources==='string'){
    resourcesStr=s.resources;
  }
  
  openModal(
    id?'Edit skill':'Add a skill',
    field('Skill name','name','text',s.name||'','required placeholder="e.g. Python for Data Science, System Design, SQL"')+
    `<div class="field-grid">
      ${selectField('Category','category',['Technical','AI / Data Science','Programming','Cybersecurity','Development','Professional','Other'].map(x=>[x,x]),s.category||'Technical')}
      ${selectField('Current level','level',['Beginner','Basic','Intermediate','Advanced'].map(x=>[x,x]),s.level||'Beginner')}
    </div>
    <div class="field-grid">
      ${selectField('Status','status',['Not started','Learning','Practising','Completed'].map(x=>[x,x]),s.status||'Not started')}
      ${field('Target completion date','target','date',s.target||'')}
    </div>
    <div class="field">
      <label>📚 Learning Resources (where you will learn this skill from)</label>
      <textarea name="resources" rows="4" placeholder="Enter one resource per line&#10;e.g. Official Documentation | https://docs.python.org&#10;freeCodeCamp Tutorial | https://youtube.com/watch?v=...&#10;Designing Data-Intensive Applications (Book)&#10;Coursera Deep Learning Specialization | https://coursera.org">${esc(resourcesStr)}</textarea>
      <small style="display:block;margin-top:5px;font-size:11px;color:var(--muted);line-height:1.4;">
        Add courses, video playlists, documentation, articles or books. Format: <code>Title | Link</code> (or just paste the URL/Title).
      </small>
    </div>
    ${area('Notes / what you want to achieve / practise','notes',s.notes||'')}`,
    d=>{
      let resources=(d.resources||'').split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{
        if(line.includes('|')){
          let [title,...rest]=line.split('|');
          return {title:title.trim(),url:rest.join('|').trim()};
        }
        if(/^https?:\/\//i.test(line)){
          try{
            let host=new URL(line).hostname.replace(/^www\./,'');
            return {title:host,url:line};
          }catch{
            return {title:line,url:line};
          }
        }
        return {title:line,url:''};
      });

      if(id){
        Object.assign(s,{
          name:d.name,
          category:d.category,
          level:d.level,
          status:d.status,
          target:d.target,
          resources,
          notes:d.notes
        });
      }else{
        (db.skills||(db.skills=[])).push({
          id:uid(),
          name:d.name,
          category:d.category,
          level:d.level,
          status:d.status,
          target:d.target,
          resources,
          milestones:[],
          notes:d.notes
        });
      }
      toast(id?'Skill updated':'Skill added');
    }
  );
}

function logMilestoneModal(skillId){
  const s=(db.skills||[]).find(x=>x.id===skillId);
  if(!s)return;
  
  openModal(
    `Log learning milestone`,
    `<div class="field-callout" style="margin-bottom:14px;padding:12px;background:var(--sf-sand);border-radius:10px;font-size:12px;color:var(--sf-navy);line-height:1.5;">
      <strong>✨ Skill: ${esc(s.name)}</strong><br>
      Record what you learned as an achieved milestone! Every breakthrough or key takeaway tracks your learning journey.
    </div>`+
    field('What did you learn or accomplish? *','name','text','','required placeholder="e.g. Mastered PyTorch Autograd & backpropagation from scratch"')+
    `<div class="field-grid">
      ${field('Date learned','date','date',todayISO(),'required')}
      ${field('Key takeaway / summary (optional)','takeaway','text','','placeholder="e.g. Gradient accumulation saves memory on big batches"')}
    </div>`+
    area('Detailed reflection / notes / code takeaway (optional)','note',''),
    d=>{
      if(!d.name||!d.name.trim())return;
      s.milestones=s.milestones||[];
      s.milestones.unshift({
        id:uid(),
        name:d.name.trim(),
        date:d.date||todayISO(),
        takeaway:(d.takeaway||'').trim(),
        note:(d.note||'').trim()
      });
      if(s.status==='Not started'){
        s.status='Learning';
      }
      toast(`Milestone logged for ${s.name}!`);
    }
  );
}
function eventModal(id,date=selectedDate){let ev=db.events.find(x=>x.id===id)||{};openModal(id?'Edit event':'Add calendar event',field('Event title','title','text',ev.title||'','required')+`<div class="field-grid">${field('Date','date','date',ev.date||date,'required')}${field('Time','time','time',ev.time||'')}</div>${area('Notes','note',ev.note||'')}`,d=>{if(id)Object.assign(ev,d);else db.events.push({id:uid(),...d});toast(id?'Event updated':'Event added')})}
function mistakeModal(id){openMistakeModal(id,null)}
$('#add-skill').onclick=()=>skillModal();
const addDailyBtn=$('#add-daily-task');if(addDailyBtn)addDailyBtn.onclick=()=>taskModal(null,'daily');
const addOverallBtn=$('#add-overall-task');if(addOverallBtn)addOverallBtn.onclick=()=>taskModal(null,'overall');
const quickAddBtn=$('#quick-add');if(quickAddBtn)quickAddBtn.onclick=()=>taskModal(null,currentTaskScope==='overall'?'overall':'daily');
const addTaskBtn=$('#add-task');if(addTaskBtn)addTaskBtn.onclick=()=>taskModal(null,currentTaskScope==='overall'?'overall':'daily');
$('#add-subject').onclick=()=>subjectModal();
$('#calendar-add').onclick=$('#selected-add').onclick=()=>eventModal(null,selectedDate);
const calAddTaskBtn=$('#calendar-add-task');if(calAddTaskBtn)calAddTaskBtn.onclick=()=>taskModal(null,'overall',selectedDate);
const selAddTaskBtn=$('#selected-add-task');if(selAddTaskBtn)selAddTaskBtn.onclick=()=>taskModal(null,'overall',selectedDate);
$('#add-mistake').onclick=()=>openMistakeModal(null,activeMockTestId);
const uploadBtn=$('#upload-test-btn');
if(uploadBtn)uploadBtn.onclick=()=>openMockTestModal();

// Paper dropzone setup
const dropzone=$('#paper-dropzone');
const fileInput=$('#paper-file-input');
if(dropzone&&fileInput){
  dropzone.onclick=e=>{
    if(e.target===fileInput||e.target.closest('#btn-remove-paper'))return;
    fileInput.click();
  };
  dropzone.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fileInput.click()}};
  fileInput.onchange=()=>{
    const file=fileInput.files?.[0];
    if(file)handlePaperFileSelected(file);
  };
  $('#btn-remove-paper').onclick=e=>{
    e.stopPropagation();
    selectedPaperFile=null;
    fileInput.value='';
    $('#dropzone-preview').hidden=true;
    $('#dropzone-prompt').hidden=false;
    $('#preview-img-wrap').hidden=true;
  };
  ['dragenter','dragover'].forEach(evt=>{
    dropzone.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();dropzone.classList.add('dragover')});
  });
  ['dragleave','drop'].forEach(evt=>{
    dropzone.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();dropzone.classList.remove('dragover')});
  });
  dropzone.addEventListener('drop',e=>{
    const dt=e.dataTransfer;
    const file=dt?.files?.[0];
    if(file)handlePaperFileSelected(file);
  });
}

// Test Upload Form submit
const testForm=$('#form-upload-test');
if(testForm){
  testForm.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(testForm);
    const existingId=fd.get('testId');
    const id=existingId||uid();
    let existingTest=existingId?db.mockTests.find(x=>x.id===existingId):null;

    let hasPaper=existingTest?.hasPaper||false;
    let fileName=existingTest?.fileName||'';
    let fileType=existingTest?.fileType||'';
    let fileSize=existingTest?.fileSize||0;
    let thumbnail=existingTest?.thumbnail||null;

    if(selectedPaperFile){
      const isPdf=(selectedPaperFile.type&&selectedPaperFile.type.toLowerCase().includes('pdf'))||
                  (selectedPaperFile.name&&selectedPaperFile.name.toLowerCase().endsWith('.pdf'));
      hasPaper=true;
      fileName=selectedPaperFile.name;
      fileType=isPdf?'application/pdf':(selectedPaperFile.type||'image/jpeg');
      fileSize=selectedPaperFile.size;
      try{
        await savePaperFile(id,selectedPaperFile);
      }catch(error){
        console.error('Could not save mock test paper:',error);
        toast('The paper could not be saved. Please try the upload again.');
        return;
      }
      if(fileType.startsWith('image/')&&!isPdf){
        thumbnail=await generateImageThumbnail(selectedPaperFile);
      }else{
        thumbnail=null;
      }
      selectedPaperFile=null;
    }

    const testData={
      id,
      name:String(fd.get('name')||'Mock Test').trim(),
      marks:parseFloat(fd.get('marks'))||0,
      totalMarks:parseFloat(fd.get('totalMarks'))||100,
      subject:String(fd.get('subject')||'').trim(),
      date:fd.get('date')||todayISO(),
      description:String(fd.get('description')||'').trim(),
      pointers:String(fd.get('pointers')||'').trim(),
      hasPaper,
      fileName,
      fileType,
      fileSize,
      thumbnail,
      createdAt:existingTest?.createdAt||new Date().toISOString()
    };

    if(existingTest){
      Object.assign(existingTest,testData);
    }else{
      db.mockTests.push(testData);
    }
    $('#modal-upload-test').close();
    save();
    toast(existingTest?'Mock test updated!':'Mock test paper uploaded & card created!');
    activeMockTestId=id;
    openMockTestDetail(id);
  };
}

// Mistake Form submit
const mistakeForm=$('#form-log-mistake');
if(mistakeForm){
  mistakeForm.onsubmit=e=>{
    e.preventDefault();
    const fd=new FormData(mistakeForm);
    const mId=fd.get('mistakeId');
    let targetTestId=fd.get('mockTestId')||activeMockTestId||null;
    if(!targetTestId&&db.mockTests&&db.mockTests.length===1){
      targetTestId=db.mockTests[0].id;
    }
    const testObj=targetTestId?db.mockTests.find(x=>x.id===targetTestId):null;

    const whyCorrection=String(fd.get('whyCorrection')||fd.get('error')||'').trim();
    const revisionAction=String(fd.get('revisionAction')||fd.get('correction')||'').trim();
    const markVal=parseFloat(fd.get('marks')||fd.get('marksLost'))||0;
    const userAnswer=String(fd.get('userAnswer')||'').trim();
    const isBlank=fd.get('mistakeType')==='Unattempted / Left blank'||!userAnswer;

    const mistakeData={
      id:mId||uid(),
      mockTestId:targetTestId,
      test:testObj?testObj.name:(fd.get('test')||''),
      questionNo:String(fd.get('questionNo')||'').trim(),
      userAnswer,
      correctAnswer:String(fd.get('correctAnswer')||'').trim(),
      status:String(fd.get('correctAnswer')||(isBlank?'Blank':'Incorrect')).trim(),
      topic:String(fd.get('topic')||'General').trim(),
      whyCorrection,
      revisionAction,
      error:whyCorrection,
      correction:revisionAction,
      pointers:revisionAction,
      subject:testObj?.subject||(fd.get('subject')||''),
      mistakeType:String(fd.get('mistakeType')||(isBlank?'Unattempted / Left blank':'Conceptual misunderstanding')),
      marks:markVal,
      marksLost:markVal,
      isBlank,
      resolved:fd.get('resolved')==='on',
      date:testObj?.date||todayISO(),
      source:'manual'
    };

    if(mId){
      const existing=db.mistakes.find(x=>x.id===mId);
      if(existing)Object.assign(existing,mistakeData);
    }else{
      db.mistakes.push(mistakeData);
    }
    $('#modal-log-mistake').close();
    save();
    toast('Mistake saved & topic analytics recalculated!');
    if(targetTestId){
      activeMockTestId=targetTestId;
      openMockTestDetail(targetTestId);
    }
  };
}

// Detail dialog actions
$('#btn-edit-test-details')?.addEventListener('click',()=>{
  if(activeMockTestId){
    $('#modal-test-detail').close();
    openMockTestModal(activeMockTestId);
  }
});
$('#btn-log-mistake-for-test')?.addEventListener('click',()=>{
  openMistakeModal(null,activeMockTestId);
});
$('#btn-import-excel-for-test')?.addEventListener('click',()=>{
  openExcelImportModal(activeMockTestId);
});
$('#btn-download-excel-template')?.addEventListener('click',downloadSampleExcelTemplate);

// Modal Excel Dropzone setup
const excelDropzone=$('#excel-dropzone');
const excelFileInput=$('#excel-file-input');
const browseExcelBtn=$('#btn-browse-excel-file');
if(browseExcelBtn&&excelFileInput){
  browseExcelBtn.onclick=()=>excelFileInput.click();
}
if(excelDropzone&&excelFileInput){
  excelDropzone.onclick=()=>excelFileInput.click();
  excelDropzone.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();excelFileInput.click()}};
  excelFileInput.onchange=()=>{
    const file=excelFileInput.files?.[0];
    if(file){
      handleAutoExcelUpload(file,activeExcelImportTestId);
      excelFileInput.value='';
    }
  };
  ['dragenter','dragover'].forEach(evt=>{
    excelDropzone.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();excelDropzone.classList.add('dragover')});
  });
  ['dragleave','drop'].forEach(evt=>{
    excelDropzone.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();excelDropzone.classList.remove('dragover')});
  });
  excelDropzone.addEventListener('drop',e=>{
    const file=e.dataTransfer?.files?.[0];
    if(file)handleAutoExcelUpload(file,activeExcelImportTestId);
  });
}

// Modal Excel Question Paper Attachment
let selectedExcelPaperFile=null;
const excelPaperBox=$('#excel-paper-attach-box');
const excelPaperInput=$('#excel-modal-paper-input');
if(excelPaperBox&&excelPaperInput){
  excelPaperBox.onclick=()=>excelPaperInput.click();
  excelPaperInput.onchange=()=>{
    const file=excelPaperInput.files?.[0];
    if(file){
      selectedExcelPaperFile=file;
      const label=$('#excel-paper-file-label');
      const sub=$('#excel-paper-file-sub');
      const icon=$('#excel-paper-icon');
      if(label)label.textContent=file.name;
      if(sub)sub.textContent=`${formatFileSize(file.size)} · Ready to attach to test`;
      if(icon)icon.textContent='✅';
      excelPaperBox.style.borderColor='#0f766e';
      excelPaperBox.style.background='#f0fdfa';
    }
  };
}
$('#btn-save-detail-pointers')?.addEventListener('click',()=>{
  if(!activeMockTestId)return;
  const t=db.mockTests.find(x=>x.id===activeMockTestId);
  if(t){
    t.pointers=$('#detail-test-pointers-input')?.value||'';
    save();
    toast('Test strategy pointers saved!');
  }
});
$('#btn-delete-current-test')?.addEventListener('click',async()=>{
  if(!activeMockTestId)return;
  if(confirm('Are you sure you want to delete this mock test paper and all its logged mistakes?')){
    const tid=activeMockTestId;
    const testObj=db.mockTests.find(x=>x.id===tid);
    const testName=testObj?.name;
    db.mockTests=db.mockTests.filter(x=>x.id!==tid);
    db.mistakes=db.mistakes.filter(m=>m.mockTestId!==tid&&(!testName||m.test!==testName));
    await deletePaperFile(tid);
    $('#modal-test-detail').close();
    activeMockTestId=null;
    save();
    renderReviews();
    fetch(`${API_BASE}/mistakes/test/${tid}`,{
      method:'DELETE',
      credentials:'include'
    }).catch(e=>console.warn(e));
    toast('Mock test paper and all its questions deleted.');
  }
});

$('#btn-clear-all-mistakes')?.addEventListener('click',async()=>{
  if(!db.mistakes||!db.mistakes.length){
    toast('No logged mistakes to delete.');
    return;
  }
  if(confirm(`Are you sure you want to delete all ${db.mistakes.length} logged mistakes from your account? This action cannot be undone.`)){
    db.mistakes=[];
    save();
    renderReviews();
    fetch(`${API_BASE}/mistakes/all`,{
      method:'DELETE',
      credentials:'include'
    }).catch(e=>console.warn(e));
    toast('All logged mistakes deleted.');
  }
});
$$('[data-close-test-modal]').forEach(b=>b.onclick=()=>$('#modal-upload-test').close());
$$('[data-close-detail-modal]').forEach(b=>b.onclick=()=>{$('#modal-test-detail').close();activeMockTestId=null;renderReviews();});
$$('[data-close-mistake-modal]').forEach(b=>b.onclick=()=>$('#modal-log-mistake').close());
$$('[data-close-viewer-modal]').forEach(b=>b.onclick=()=>$('#modal-paper-viewer').close());
$$('[data-close-excel-modal]').forEach(b=>b.onclick=()=>$('#modal-import-excel-mistakes').close());
['#modal-upload-test','#modal-test-detail','#modal-log-mistake','#modal-paper-viewer','#modal-import-excel-mistakes','#item-dialog','#modal-feature-manual'].forEach(sel=>{
  const d=$(sel);
  if(d)d.addEventListener('click',e=>{if(e.target===d)d.close()});
});

// Test search input
$('#test-search-input')?.addEventListener('input',e=>{
  testSearchQuery=e.target.value.trim();
  renderReviews();
});

// Test tabs
$$('[data-test-tab]').forEach(b=>b.onclick=()=>{
  testTab=b.dataset.testTab;
  $$('[data-test-tab]').forEach(x=>x.classList.toggle('active',x===b));
  renderReviews();
});

// Detail view mistake filters
$$('[data-test-mistake-filter]').forEach(b=>b.onclick=()=>{
  testMistakeFilter=b.dataset.testMistakeFilter;
  $$('[data-test-mistake-filter]').forEach(x=>x.classList.toggle('active',x===b));
  if(activeMockTestId)openMockTestDetail(activeMockTestId);
});

document.addEventListener('click',e=>{
  let b=e.target.closest('button')||e.target.closest('[data-open-test]');
  if(!b)return;

  // Clicking a test card opens detail
  if(b.dataset.openTest&&!e.target.closest('.test-card-actions')){
    openMockTestDetail(b.dataset.openTest);
    return;
  }
  if(b.dataset.importExcel){
    e.stopPropagation();
    openExcelImportModal(b.dataset.importExcel);
    return;
  }
  if(b.dataset.editMockTest){
    e.stopPropagation();
    openMockTestModal(b.dataset.editMockTest);
  }
  if(b.dataset.deleteMockTest){
    e.stopPropagation();
    if(confirm('Delete this mock test paper and all its logged mistakes?')){
      const id=b.dataset.deleteMockTest;
      const testObj=db.mockTests.find(x=>x.id===id);
      const testName=testObj?.name;
      db.mockTests=db.mockTests.filter(t=>t.id!==id);
      db.mistakes=db.mistakes.filter(m=>m.mockTestId!==id&&(!testName||m.test!==testName));
      deletePaperFile(id);
      save();
      renderReviews();
      fetch(`${API_BASE}/mistakes/test/${id}`,{
        method:'DELETE',
        credentials:'include'
      }).catch(e=>console.warn(e));
      toast('Mock test paper and all its questions deleted.');
    }
  }
  if(b.dataset.viewPaper){
    e.stopPropagation();
    viewPaperFull(b.dataset.viewPaper);
    return;
  }
  if(b.dataset.downloadPaper){
    e.stopPropagation();
    downloadPaperFile(b.dataset.downloadPaper);
    return;
  }
  if(b.dataset.attachPaper || b.dataset.replacePaper){
    e.stopPropagation();
    const testId = b.dataset.attachPaper || b.dataset.replacePaper;
    const directInput = $('#direct-paper-file-input');
    if(directInput){
      directInput.value = '';
      directInput.onchange = async () => {
        const file = directInput.files?.[0];
        if(!file) return;
        const isPdf = (file.type && file.type.toLowerCase().includes('pdf')) ||
                      (file.name && file.name.toLowerCase().endsWith('.pdf'));
        const mimeType = isPdf ? 'application/pdf' : (file.type || 'image/jpeg');
        toast('Saving question paper file...');
        try {
          await savePaperFile(testId, file);
          const t = db.mockTests.find(x => x && String(x.id) === String(testId));
          if(t){
            t.hasPaper = true;
            t.fileName = file.name;
            t.fileType = mimeType;
            t.fileSize = file.size;
            if(mimeType.startsWith('image/') && !isPdf){
              t.thumbnail = await generateImageThumbnail(file);
            }
          }
          save();
          renderReviews();
          if(activeMockTestId && String(activeMockTestId) === String(testId)){
            openMockTestDetail(testId);
          }
          toast('Question paper PDF attached & saved successfully!');
        } catch(err) {
          console.error('Error attaching paper:', err);
          toast('Could not attach paper. Please try again.');
        }
      };
      directInput.click();
    }
    return;
  }
  if(b.dataset.removePaper){
    e.stopPropagation();
    const testId = b.dataset.removePaper;
    if(confirm('Remove attached question paper file from this test?')){
      deletePaperFile(testId);
      const t = db.mockTests.find(x => x && String(x.id) === String(testId));
      if(t){
        t.hasPaper = false;
        t.fileName = '';
        t.fileType = '';
        t.fileSize = 0;
        t.thumbnail = null;
      }
      save();
      renderReviews();
      if(activeMockTestId && String(activeMockTestId) === String(testId)){
        openMockTestDetail(testId);
      }
      toast('Question paper removed.');
    }
    return;
  }
  if(b.dataset.editTestMistake){
    openMistakeModal(b.dataset.editTestMistake,activeMockTestId);
  }
  if(b.dataset.deleteTestMistake){
    if(confirm('Delete this mistake record?')){
      const id=b.dataset.deleteTestMistake;
      db.mistakes=db.mistakes.filter(m=>m.id!==id);
      save();
      renderReviews();
      fetch(`${API_BASE}/mistakes/${id}`,{
        method:'DELETE',
        credentials:'include'
      }).catch(e=>console.warn(e));
      if(activeMockTestId)openMockTestDetail(activeMockTestId);
      toast('Mistake deleted & topic analytics updated.');
    }
  }
  if(b.dataset.toggleTestMistake){
    const m=db.mistakes.find(x=>x.id===b.dataset.toggleTestMistake);
    if(m){
      m.resolved=!m.resolved;
      save();
      if(activeMockTestId)openMockTestDetail(activeMockTestId);
      toast(m.resolved?'Marked as resolved!':'Marked as needs review.');
    }
  }

  // Manual & Page Guide handler
  const guideBtn = b.dataset.openGuide ? b : b.closest('[data-open-guide]');
  if(guideBtn){
    e.stopPropagation();
    openManualTab(guideBtn.dataset.openGuide);
    return;
  }

  // Global manual modal buttons
  if(b.id === 'btn-open-manual' || b.id === 'sidebar-manual-btn' || b.closest('#btn-open-manual') || b.closest('#sidebar-manual-btn') || b.dataset.openManual){
    e.stopPropagation();
    openManualTab(currentView);
    return;
  }
  if(b.dataset.closeManualModal || b.closest('[data-close-manual-modal]')){
    $('#modal-feature-manual')?.close();
    return;
  }
  const manualTabBtn = b.dataset.manualTab ? b : b.closest('[data-manual-tab]');
  if(manualTabBtn){
    const tabName = manualTabBtn.dataset.manualTab;
    $$('.manual-tab-btn').forEach(btn => btn.classList.toggle('active', btn === manualTabBtn));
    $$('.manual-panel-view').forEach(panel => panel.classList.toggle('active', panel.id === `manual-tab-content-${tabName}`));
    return;
  }

  // Previous general handlers
  if(b.dataset.editTask)taskModal(b.dataset.editTask);
  if(b.dataset.deleteTask){db.tasks=db.tasks.filter(t=>t.id!==b.dataset.deleteTask);save();toast('Task deleted')}
  if(b.dataset.editSubject)subjectModal(b.dataset.editSubject);
  if(b.dataset.editSkill)skillModal(b.dataset.editSkill);
  if(b.dataset.deleteSkill){if(confirm('Delete this skill and its learning progress?')){db.skills=db.skills.filter(x=>x.id!==b.dataset.deleteSkill);save();toast('Skill deleted')}}
  const logMilestoneBtn=b.dataset.logMilestone?b:b.closest('[data-log-milestone]');
  if(logMilestoneBtn){
    logMilestoneModal(logMilestoneBtn.dataset.logMilestone);
    return;
  }
  const deleteMilestoneBtn=b.dataset.deleteMilestone?b:b.closest('[data-delete-milestone]');
  if(deleteMilestoneBtn){
    let [sid,mid]=deleteMilestoneBtn.dataset.deleteMilestone.split(':');
    let skill=(db.skills||[]).find(x=>x.id===sid);
    if(skill&&skill.milestones){
      if(confirm('Remove this logged milestone?')){
        skill.milestones=skill.milestones.filter((m,idx)=>(m.id?m.id!==mid:String(idx)!==mid));
        save();
        toast('Milestone removed.');
      }
    }
    return;
  }
  if(b.dataset.deleteSubject){if(confirm('Delete this subject and its syllabus topics?')){db.subjects=db.subjects.filter(s=>s.id!==b.dataset.deleteSubject);save()}}
  if(b.dataset.editEvent)eventModal(b.dataset.editEvent);
  if(b.dataset.deleteEvent){
    if(confirm('Delete this calendar event?')){
      db.events=(db.events||[]).filter(e=>e.id!==b.dataset.deleteEvent);
      save();
      toast('Event deleted.');
    }
  }
  const calFilterChip=b.dataset.calFilter?b:b.closest('[data-cal-filter]');
  if(calFilterChip){
    calFilter=calFilterChip.dataset.calFilter;
    $$('[data-cal-filter]').forEach(x=>x.classList.toggle('active',x===calFilterChip));
    renderCalendar();
  }
  if(b.dataset.editMistake)openMistakeModal(b.dataset.editMistake);
  if(b.dataset.deleteMistake){
    const id=b.dataset.deleteMistake;
    db.mistakes=db.mistakes.filter(m=>m.id!==id);
    save();
    renderReviews();
    fetch(`${API_BASE}/mistakes/${id}`,{
      method:'DELETE',
      credentials:'include'
    }).catch(e=>console.warn(e));
    toast('Mistake deleted.');
  }
  if(b.dataset.toggleMistake){let m=db.mistakes.find(x=>x.id===b.dataset.toggleMistake);if(m){m.resolved=!m.resolved;save()}}
  if(b.dataset.day){selectedDate=b.dataset.day;renderCalendar()}
  const scopeTab=b.dataset.taskScope?b:b.closest('[data-task-scope]');
  if(scopeTab){
    currentTaskScope=scopeTab.dataset.taskScope;
    $$('[data-task-scope]').forEach(x=>x.classList.toggle('active',x===scopeTab));
    renderTasks();
  }
  if(b.id==='btn-filter-carried-over'||b.closest('#btn-filter-carried-over')){
    taskFilter='missed';
    $$('[data-filter]').forEach(x=>x.classList.toggle('active',x.dataset.filter==='missed'));
    renderTasks();
  }
});
document.addEventListener('change',e=>{
  let el=e.target;
  if(el.dataset.taskCheck){
    let t=db.tasks.find(x=>x.id===el.dataset.taskCheck);
    if(t){
      t.done=el.checked;
      if(el.checked){
        t.completedAt=new Date().toISOString();
        window.logStudyFlowActivity(todayISO());
      }
      save();
    }
  }
  if(el.dataset.topic){
    let [sid,i]=el.dataset.topic.split(':');
    let sub=db.subjects.find(s=>s.id===sid);
    if(sub&&sub.topics&&sub.topics[+i]){
      sub.topics[+i].done=el.checked;
      if(el.checked) window.logStudyFlowActivity(todayISO());
      save();
    }
  }
  if(el.dataset.skillMilestone){
    let [sid,i]=el.dataset.skillMilestone.split(':');
    let skill=db.skills.find(s=>s.id===sid);
    if(skill&&skill.milestones&&skill.milestones[+i]){
      skill.milestones[+i].done=el.checked;
      if(skill.milestones.length&&skill.milestones.every(m=>m.done))skill.status='Completed';
      else if(el.checked&&skill.status==='Not started')skill.status='Learning';
      if(el.checked) window.logStudyFlowActivity(todayISO());
      save();
    }
  }
});
$$('[data-filter]').forEach(b=>b.onclick=()=>{taskFilter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTasks()});
$$('[data-review-filter]').forEach(b=>b.onclick=()=>{reviewFilter=b.dataset.reviewFilter;$$('[data-review-filter]').forEach(x=>x.classList.toggle('active',x===b));renderReviews()});
$('#prev-month').onclick=()=>{calDate.setMonth(calDate.getMonth()-1);renderCalendar()};$('#next-month').onclick=()=>{calDate.setMonth(calDate.getMonth()+1);renderCalendar()};$('#today-btn').onclick=()=>{calDate=new Date();selectedDate=todayISO();renderCalendar()};
$('#notify-btn').onclick=async()=>{if(!('Notification'in window)){toast('Browser notifications are not supported here.');return}let p=await Notification.requestPermission();toast(p==='granted'?'Browser notifications enabled. Keep this tab open for reminders.':'Notification permission was not granted.')};
function checkReminders(){if(!('Notification'in window)||Notification.permission!=='granted')return;let now=new Date(),date=todayISO(),hm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;db.tasks.filter(t=>t.due===date&&t.reminder===hm&&!t.done).forEach(t=>new Notification('StudyFlow deadline reminder',{body:t.title}))}
setInterval(checkReminders,30000);
$('#today-date').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'});$('#today-label').textContent=new Date().getHours()<12?'GOOD MORNING':'YOUR STUDY SPACE';

/* ==========================================================================
   NOTES & POINTERS / TACTILE STICKY BOARD LOGIC
   ========================================================================== */

let notesFilter = 'all'; // 'all', 'pinned', 'pointers', 'notes', or 'tag:xyz'
let notesSearchQuery = '';
let quickJotColor = 'yellow';
let quickJotType = 'pointers';
let stickyModalFormat = 'pointers';
let stickyModalColor = 'yellow';
let boardTheme = localStorage.getItem('studyflow_notes_theme') || 'cork';
let boardLayout = localStorage.getItem('studyflow_notes_layout') || 'scatter';
let lastDeletedSticky = null;

function fmtStickyDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return 'Today, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getStickyTilt(n) {
  if (typeof n.rotation === 'number') return n.rotation;
  let hash = 0;
  for (let i = 0; i < (n.id || '').length; i++) {
    hash = ((hash << 5) - hash) + n.id.charCodeAt(i);
  }
  const tilt = ((Math.abs(hash) % 52) - 26) / 10; // -2.6 to +2.6 deg
  n.rotation = tilt;
  return tilt;
}

function seedDefaultNotesIfEmpty() {
  if (Array.isArray(db.notes) && db.notes.length > 0) return;
  db.notes = [
    {
      id: uid(),
      title: 'Sticky Board & Pointers 📌',
      type: 'pointers',
      pointers: [
        { id: uid(), text: 'Click "+ New Sticky Note" or drop a thought in the Quick Jot bar', done: false },
        { id: uid(), text: 'Check off pointers right on the card as you revise', done: false },
        { id: uid(), text: 'Pin critical formulas or traps to lock them in the VIP rack', done: true },
        { id: uid(), text: 'Switch board atmospheres (Corkboard, Midnight, Craft, Whiteboard)', done: false }
      ],
      color: 'yellow',
      pinStyle: 'pushpin',
      paperStyle: 'lined',
      tag: 'QuickTip',
      pinned: true,
      rotation: -1.8,
      createdAt: new Date().toISOString()
    },
    {
      id: uid(),
      title: 'GATE CS / Exam Traps ⚡',
      type: 'pointers',
      pointers: [
        { id: uid(), text: 'Dijkstra fails on negative edge weights (use Bellman-Ford)', done: false },
        { id: uid(), text: 'LRU vs FIFO page replacement: Belady anomaly only happens in FIFO', done: false },
        { id: uid(), text: 'Watch for null pointers & 1-based indexing in array questions', done: true },
        { id: uid(), text: 'Eigenvalues of upper/lower triangular matrix = diagonal entries', done: false }
      ],
      color: 'mint',
      pinStyle: 'tape',
      paperStyle: 'lined',
      tag: 'GATE',
      pinned: true,
      rotation: 1.5,
      createdAt: new Date().toISOString()
    },
    {
      id: uid(),
      title: 'Calculus & Linear Algebra Sparks 📐',
      type: 'note',
      content: 'det(A·B) = det(A)·det(B)\nMatrix A is invertible iff det(A) ≠ 0.\nRank + Nullity = Number of columns (Dimension Theorem).\nFor orthogonal matrices: A^T · A = I.',
      pointers: [],
      color: 'peach',
      pinStyle: 'pushpin',
      paperStyle: 'grid',
      tag: 'Formula',
      pinned: false,
      rotation: -2.2,
      createdAt: new Date().toISOString()
    },
    {
      id: uid(),
      title: 'Daily Study Mindset 🎯',
      type: 'note',
      content: 'Small consistent steps add up.\nTwo deep focus sessions today beat 10 frantic hours before the exam.\nPlan less. Execute more. Turn mistakes into marks!',
      pointers: [],
      color: 'lavender',
      pinStyle: 'tape',
      paperStyle: 'blank',
      tag: 'Motivation',
      pinned: false,
      rotation: 2.0,
      createdAt: new Date().toISOString()
    }
  ];
  save();
}

function stickyCardHtml(n) {
  const tilt = getStickyTilt(n);
  const color = n.color || 'yellow';
  const paper = n.paperStyle || 'lined';
  const pinStyle = n.pinStyle || 'pushpin';
  const isPinned = Boolean(n.pinned);
  const dateStr = fmtStickyDate(n.createdAt);

  const attachmentHtml = `<div class="sticky-attachment pin-${esc(pinStyle)}"></div>`;

  let bodyHtml = '';
  if (n.type === 'pointers') {
    const pointers = Array.isArray(n.pointers) ? n.pointers : [];
    const doneCount = pointers.filter(p => p.done).length;
    const totalCount = pointers.length;
    const allDone = totalCount > 0 && doneCount === totalCount;

    const itemsHtml = pointers.map(p => `
      <li class="sticky-pointer-item ${p.done ? 'checked' : ''}" data-pointer-row="${esc(n.id)}:${esc(p.id)}">
        <input type="checkbox" class="sticky-pointer-check" data-toggle-pointer="${esc(n.id)}:${esc(p.id)}" ${p.done ? 'checked' : ''} aria-label="Mark pointer done" />
        <span class="sticky-pointer-text">${esc(p.text)}</span>
        <button type="button" class="tiny-btn" data-delete-pointer="${esc(n.id)}:${esc(p.id)}" title="Delete pointer line" style="opacity:0.35;padding:0 2px;line-height:1;">×</button>
      </li>
    `).join('');

    bodyHtml = `
      <ul class="sticky-pointers-list">${itemsHtml}</ul>
      <div class="sticky-pointer-progress">
        <span>${doneCount} of ${totalCount} completed</span>
        ${allDone ? '<span style="color:#16a34a;">🎉 All Mastered!</span>' : ''}
      </div>
      <div class="sticky-inline-add">
        <input type="text" class="sticky-inline-input" placeholder="＋ Add pointer..." data-inline-add-input="${esc(n.id)}" maxlength="140" autocomplete="off" />
        <button type="button" class="sticky-inline-add-btn" data-inline-add-btn="${esc(n.id)}">Add</button>
      </div>
    `;
  } else {
    bodyHtml = `<div class="sticky-note-text">${esc(n.content || '')}</div>`;
  }

  const tagHtml = n.tag ? `<button type="button" class="sticky-tag-pill" data-notes-tag="${esc(n.tag)}" title="Filter by #${esc(n.tag)}">#${esc(n.tag)}</button>` : '';

  return `
    <article class="sticky-card color-${esc(color)} texture-${esc(paper)} ${isPinned ? 'pinned' : ''}" style="--sticky-tilt: ${tilt}deg;" data-note-card-id="${esc(n.id)}">
      ${attachmentHtml}
      <div class="sticky-card-header">
        <h3 class="sticky-card-title">${esc(n.title || 'Untitled Sticky')}</h3>
        <div class="sticky-card-actions">
          <button type="button" class="sticky-action-btn btn-pin ${isPinned ? 'is-pinned' : ''}" data-pin-note="${esc(n.id)}" title="${isPinned ? 'Unpin from VIP shelf' : 'Pin to VIP shelf'}">📌</button>
          <button type="button" class="sticky-action-btn" data-color-popover-trigger="${esc(n.id)}" title="Change color">🎨</button>
          <button type="button" class="sticky-action-btn" data-copy-note="${esc(n.id)}" title="Copy text to clipboard">📋</button>
          <button type="button" class="sticky-action-btn" data-edit-note="${esc(n.id)}" title="Edit sticky note">✏️</button>
          <button type="button" class="sticky-action-btn" data-delete-note="${esc(n.id)}" title="Delete sticky note">🗑️</button>
        </div>
      </div>
      <div class="sticky-card-body">${bodyHtml}</div>
      <div class="sticky-card-footer">
        ${tagHtml}
        <span class="sticky-date">${esc(dateStr)}</span>
      </div>
    </article>
  `;
}

function renderNotes() {
  const canvas = $('#sticky-board-canvas');
  if (!canvas) return;

  seedDefaultNotesIfEmpty();
  const allNotes = Array.isArray(db.notes) ? db.notes : [];

  // Update counts
  const countAll = allNotes.length;
  const countPinned = allNotes.filter(n => n.pinned).length;
  const countPointers = allNotes.filter(n => n.type === 'pointers').length;
  const countFreeform = allNotes.filter(n => n.type === 'note').length;

  if ($('#count-all')) $('#count-all').textContent = countAll;
  if ($('#count-pinned')) $('#count-pinned').textContent = countPinned;
  if ($('#count-pointers')) $('#count-pointers').textContent = countPointers;
  if ($('#count-notes')) $('#count-notes').textContent = countFreeform;

  // Render tag filter chips
  const tagsContainer = $('#notes-tag-filters');
  if (tagsContainer) {
    const uniqueTags = [...new Set(allNotes.map(n => n.tag).filter(Boolean))].sort();
    tagsContainer.innerHTML = uniqueTags.map(tag => {
      const isActive = notesFilter === `tag:${tag.toLowerCase()}`;
      return `<button type="button" class="filter ${isActive ? 'active' : ''}" data-notes-tag="${esc(tag)}">#${esc(tag)}</button>`;
    }).join('');
  }

  // Update filter buttons active state
  $$('[data-notes-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.notesFilter === notesFilter);
  });

  // Apply search & filter
  const q = (notesSearchQuery || '').trim().toLowerCase();
  const filteredNotes = allNotes.filter(n => {
    // Filter check
    if (notesFilter === 'pinned' && !n.pinned) return false;
    if (notesFilter === 'pointers' && n.type !== 'pointers') return false;
    if (notesFilter === 'notes' && n.type !== 'note') return false;
    if (notesFilter.startsWith('tag:')) {
      const targetTag = notesFilter.slice(4);
      if (!n.tag || n.tag.toLowerCase() !== targetTag) return false;
    }

    // Search check
    if (q) {
      const titleMatch = (n.title || '').toLowerCase().includes(q);
      const contentMatch = (n.content || '').toLowerCase().includes(q);
      const tagMatch = (n.tag || '').toLowerCase().includes(q);
      const pointersMatch = Array.isArray(n.pointers) && n.pointers.some(p => (p.text || '').toLowerCase().includes(q));
      if (!titleMatch && !contentMatch && !tagMatch && !pointersMatch) return false;
    }

    return true;
  });

  // Apply theme & layout classes to canvas
  canvas.className = `sticky-board-canvas theme-${boardTheme} layout-${boardLayout}`;

  // Update theme & layout pills active states
  $$('[data-board-theme]').forEach(btn => btn.classList.toggle('active', btn.dataset.boardTheme === boardTheme));
  $$('[data-board-layout]').forEach(btn => btn.classList.toggle('active', btn.dataset.boardLayout === boardLayout));

  const pinnedRack = $('#pinned-notes-rack');
  const pinnedGrid = $('#pinned-notes-grid');
  const boardGrid = $('#notes-board-grid');
  const emptyState = $('#notes-empty-state');
  const statusText = $('#board-status-text');

  const isSpecificFilter = notesFilter !== 'all' || q.length > 0;

  let pinnedList = [];
  let unpinnedList = [];

  if (isSpecificFilter) {
    unpinnedList = filteredNotes;
    if (pinnedRack) pinnedRack.style.display = 'none';
  } else {
    pinnedList = filteredNotes.filter(n => n.pinned);
    unpinnedList = filteredNotes.filter(n => !n.pinned);

    if (pinnedList.length > 0 && pinnedRack && pinnedGrid) {
      pinnedRack.style.display = 'block';
      pinnedGrid.innerHTML = pinnedList.map(n => stickyCardHtml(n)).join('');
      if ($('#pinned-count-badge')) $('#pinned-count-badge').textContent = `${pinnedList.length} Pinned`;
    } else if (pinnedRack) {
      pinnedRack.style.display = 'none';
    }
  }

  if (boardGrid) {
    boardGrid.innerHTML = unpinnedList.map(n => stickyCardHtml(n)).join('');
  }

  const totalShown = isSpecificFilter ? unpinnedList.length : (pinnedList.length + unpinnedList.length);
  if (totalShown === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    if (boardGrid) boardGrid.style.display = 'none';
  } else {
    if (emptyState) emptyState.style.display = 'none';
    if (boardGrid) boardGrid.style.display = 'grid';
  }

  if (statusText) {
    if (q) {
      statusText.textContent = `Found ${totalShown} result${totalShown === 1 ? '' : 's'} for "${notesSearchQuery}"`;
    } else if (notesFilter.startsWith('tag:')) {
      statusText.textContent = `Stickies tagged #${notesFilter.slice(4)} (${totalShown})`;
    } else if (notesFilter === 'pinned') {
      statusText.textContent = `VIP Pinned Stickies (${totalShown})`;
    } else if (notesFilter === 'pointers') {
      statusText.textContent = `Checkable Revision Pointers (${totalShown})`;
    } else if (notesFilter === 'notes') {
      statusText.textContent = `Freeform Study Notes (${totalShown})`;
    } else {
      statusText.textContent = pinnedList.length > 0 ? `Unpinned Stream (${unpinnedList.length})` : `All Sticky Notes & Pointers (${totalShown})`;
    }
  }
}

// Quick Jot Bar Submission
function submitQuickJot() {
  const input = $('#quick-jot-input');
  const tagSelect = $('#quick-jot-tag');
  const text = input ? input.value.trim() : '';
  if (!text) {
    if (input) input.focus();
    return;
  }

  const tag = tagSelect ? tagSelect.value : 'QuickTip';
  const newSticky = {
    id: uid(),
    title: text.length > 60 ? text.slice(0, 58) + '...' : text,
    type: quickJotType,
    pointers: quickJotType === 'pointers' ? [{ id: uid(), text, done: false }] : [],
    content: quickJotType === 'note' ? text : '',
    color: quickJotColor,
    pinStyle: 'pushpin',
    paperStyle: 'lined',
    tag,
    pinned: false,
    rotation: ((Math.random() * 4.6) - 2.3),
    createdAt: new Date().toISOString()
  };

  db.notes = db.notes || [];
  db.notes.unshift(newSticky);
  input.value = '';
  save();
  toast('📌 Sticky note placed on board!');
}

// Open Sticky Note Creator / Editor Modal
function openStickyModal(editId = null) {
  const dialog = $('#modal-sticky-note');
  if (!dialog) return;

  const idInput = $('#sticky-edit-id');
  const titleInput = $('#sticky-input-title');
  const tagInput = $('#sticky-input-tag');
  const pinCheckbox = $('#sticky-is-pinned');
  const pinStyleSelect = $('#sticky-pin-style');
  const paperStyleSelect = $('#sticky-paper-style');
  const contentInput = $('#sticky-input-content');
  const modalTitle = $('#sticky-modal-title');
  const pointersList = $('#sticky-pointers-list');

  let currentNote = null;
  if (editId) {
    currentNote = (db.notes || []).find(n => n.id === editId);
  }

  if (currentNote) {
    idInput.value = currentNote.id;
    modalTitle.textContent = 'Edit Sticky Note';
    titleInput.value = currentNote.title || '';
    tagInput.value = currentNote.tag || '';
    pinCheckbox.checked = Boolean(currentNote.pinned);
    pinStyleSelect.value = currentNote.pinStyle || 'pushpin';
    paperStyleSelect.value = currentNote.paperStyle || 'lined';
    stickyModalColor = currentNote.color || 'yellow';
    stickyModalFormat = currentNote.type || 'pointers';
    contentInput.value = currentNote.content || '';

    // Populate pointers list
    pointersList.innerHTML = '';
    const pointers = Array.isArray(currentNote.pointers) ? currentNote.pointers : [];
    if (pointers.length === 0) {
      addModalPointerRow('');
    } else {
      pointers.forEach(p => addModalPointerRow(p.text, p.done));
    }
  } else {
    idInput.value = '';
    modalTitle.textContent = 'Create Sticky Note';
    titleInput.value = '';
    tagInput.value = 'QuickTip';
    pinCheckbox.checked = false;
    pinStyleSelect.value = 'pushpin';
    paperStyleSelect.value = 'lined';
    stickyModalColor = 'yellow';
    stickyModalFormat = 'pointers';
    contentInput.value = '';

    pointersList.innerHTML = '';
    addModalPointerRow('');
    addModalPointerRow('');
    addModalPointerRow('');
  }

  // Update swatches active state
  $$('#modal-color-palette .palette-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === stickyModalColor);
  });

  // Update format pills
  updateModalFormatUI();
  updateModalPointersHint();

  dialog.showModal();
}

function updateModalFormatUI() {
  const isPointers = stickyModalFormat === 'pointers';
  $('#btn-format-pointers')?.classList.toggle('active', isPointers);
  $('#btn-format-note')?.classList.toggle('active', !isPointers);

  const pointersPane = $('#sticky-pointers-editor-section');
  const notePane = $('#sticky-note-editor-section');
  if (pointersPane) pointersPane.style.display = isPointers ? 'block' : 'none';
  if (notePane) notePane.style.display = isPointers ? 'none' : 'block';
}

function updateModalPointersHint() {
  const hint = $('#modal-pointers-count-hint');
  const list = $('#sticky-pointers-list');
  if (hint && list) {
    const count = list.querySelectorAll('.pointer-edit-row').length;
    hint.textContent = `${count} pointer${count === 1 ? '' : 's'}`;
  }
}

function addModalPointerRow(text = '', done = false) {
  const list = $('#sticky-pointers-list');
  if (!list) return;

  const row = document.createElement('div');
  row.className = 'pointer-edit-row';
  row.dataset.rowDone = done ? 'true' : 'false';
  row.innerHTML = `
    <span class="pointer-bullet-icon">⚡</span>
    <input type="text" class="pointer-edit-input" placeholder="Type pointer line..." value="${esc(text)}" maxlength="160" autocomplete="off" />
    <button type="button" class="btn-remove-pointer-row" title="Remove line">&times;</button>
  `;
  list.appendChild(row);

  const input = row.querySelector('.pointer-edit-input');
  if (!text && input) input.focus();

  updateModalPointersHint();
}

// Export Notes to Markdown
function openExportNotesModal() {
  const dialog = $('#modal-export-notes');
  const textarea = $('#export-notes-markdown');
  if (!dialog || !textarea) return;

  const notes = Array.isArray(db.notes) ? db.notes : [];
  if (notes.length === 0) {
    toast('No notes or pointers on board to export yet.');
    return;
  }

  const lines = [
    '# StudyFlow — Notes & Pointers Cheat-Sheet',
    `*Generated on ${new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}*`,
    '',
    '---',
    ''
  ];

  const pinned = notes.filter(n => n.pinned);
  const unpinned = notes.filter(n => !n.pinned);

  if (pinned.length > 0) {
    lines.push('## 📌 VIP Pinned Pointers & Formulas');
    lines.push('');
    pinned.forEach(n => {
      lines.push(`### ${n.title || 'Untitled'} ${n.tag ? `[#${n.tag}]` : ''}`);
      if (n.type === 'pointers') {
        (n.pointers || []).forEach(p => {
          lines.push(`- [${p.done ? 'x' : ' '}] ${p.text}`);
        });
      } else {
        lines.push(n.content || '');
      }
      lines.push('');
    });
    lines.push('---');
    lines.push('');
  }

  if (unpinned.length > 0) {
    lines.push('## 📝 Study Notes & General Pointers');
    lines.push('');
    unpinned.forEach(n => {
      lines.push(`### ${n.title || 'Untitled'} ${n.tag ? `[#${n.tag}]` : ''}`);
      if (n.type === 'pointers') {
        (n.pointers || []).forEach(p => {
          lines.push(`- [${p.done ? 'x' : ' '}] ${p.text}`);
        });
      } else {
        lines.push(n.content || '');
      }
      lines.push('');
    });
  }

  textarea.value = lines.join('\n');
  dialog.showModal();
}

// Color Swatch Popover on Sticky Card
function showColorPopover(noteId, triggerBtn) {
  // Remove existing popovers
  $$('.sticky-color-popover').forEach(p => p.remove());

  const card = triggerBtn.closest('.sticky-card');
  if (!card) return;

  const popover = document.createElement('div');
  popover.className = 'sticky-color-popover';
  const colors = [
    { key: 'yellow', hex: '#FFF59D', name: 'Yellow' },
    { key: 'mint', hex: '#C8E6C9', name: 'Mint' },
    { key: 'peach', hex: '#FFCCBC', name: 'Peach' },
    { key: 'lavender', hex: '#E1BEE7', name: 'Lavender' },
    { key: 'rose', hex: '#F8BBD0', name: 'Rose' },
    { key: 'sky', hex: '#B3E5FC', name: 'Sky' },
    { key: 'dark', hex: '#1E2530', name: 'Dark' }
  ];

  popover.innerHTML = colors.map(c => `
    <button type="button" class="color-pop-dot" data-set-color="${noteId}:${c.key}" style="--pop-color: ${c.hex};" title="${c.name}"></button>
  `).join('');

  card.appendChild(popover);

  const closeHandler = e => {
    if (!popover.contains(e.target) && e.target !== triggerBtn) {
      popover.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

// Attach all Notes & Pointers Event Listeners
function setupNotesEventListeners() {
  // 1. Quick Jot Bar
  const quickBar = $('#quick-jot-bar');
  if (quickBar) {
    quickBar.addEventListener('click', e => {
      const typeBtn = e.target.closest('[data-quick-type]');
      if (typeBtn) {
        quickJotType = typeBtn.dataset.quickType;
        $$('[data-quick-type]').forEach(b => b.classList.toggle('active', b === typeBtn));
        return;
      }

      const colorDot = e.target.closest('#quick-jot-colors .color-dot');
      if (colorDot) {
        quickJotColor = colorDot.dataset.color;
        $$('#quick-jot-colors .color-dot').forEach(b => b.classList.toggle('active', b === colorDot));
        return;
      }

      if (e.target.id === 'quick-jot-submit' || e.target.closest('#quick-jot-submit')) {
        submitQuickJot();
      }
    });

    const quickInput = $('#quick-jot-input');
    if (quickInput) {
      quickInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitQuickJot();
        }
      });
    }
  }

  // 2. Toolbar: Search
  const searchInput = $('#notes-search-input');
  const searchClear = $('#notes-search-clear');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      notesSearchQuery = searchInput.value;
      if (searchClear) searchClear.style.display = notesSearchQuery ? 'inline-block' : 'none';
      renderNotes();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      notesSearchQuery = '';
      if (searchInput) searchInput.value = '';
      searchClear.style.display = 'none';
      renderNotes();
    });
  }

  // 3. Toolbar: Filters & Tags
  document.addEventListener('click', e => {
    const filterBtn = e.target.closest('[data-notes-filter]');
    if (filterBtn) {
      notesFilter = filterBtn.dataset.notesFilter;
      renderNotes();
      return;
    }

    const tagBtn = e.target.closest('[data-notes-tag]');
    if (tagBtn) {
      const tag = tagBtn.dataset.notesTag.toLowerCase();
      notesFilter = notesFilter === `tag:${tag}` ? 'all' : `tag:${tag}`;
      renderNotes();
      return;
    }

    // Themes
    const themeBtn = e.target.closest('[data-board-theme]');
    if (themeBtn) {
      boardTheme = themeBtn.dataset.boardTheme;
      localStorage.setItem('studyflow_notes_theme', boardTheme);
      renderNotes();
      return;
    }

    // Layout
    const layoutBtn = e.target.closest('[data-board-layout]');
    if (layoutBtn) {
      boardLayout = layoutBtn.dataset.boardLayout;
      localStorage.setItem('studyflow_notes_layout', boardLayout);
      renderNotes();
      return;
    }

    // Shuffle angles
    if (e.target.id === 'btn-shuffle-angles' || e.target.closest('#btn-shuffle-angles')) {
      (db.notes || []).forEach(n => {
        n.rotation = Number(((Math.random() * 5.2) - 2.6).toFixed(1));
      });
      save();
      toast('🔀 Shuffled sticky note tilts!');
      return;
    }

    // Open Modal button
    if (e.target.id === 'btn-add-sticky-note' || e.target.closest('#btn-add-sticky-note')) {
      openStickyModal();
      return;
    }

    // Export button
    if (e.target.id === 'btn-export-notes' || e.target.closest('#btn-export-notes')) {
      openExportNotesModal();
      return;
    }
  });

  // 4. Sticky Canvas Delegated Actions
  const canvas = $('#sticky-board-canvas');
  if (canvas) {
    canvas.addEventListener('click', e => {
      // Toggle pointer line
      const checkEl = e.target.closest('[data-toggle-pointer]');
      if (checkEl) {
        const [noteId, pointerId] = checkEl.dataset.togglePointer.split(':');
        const note = (db.notes || []).find(n => n.id === noteId);
        if (note && Array.isArray(note.pointers)) {
          const p = note.pointers.find(item => item.id === pointerId);
          if (p) {
            p.done = checkEl.checked;
            save();
            const allDone = note.pointers.length > 0 && note.pointers.every(item => item.done);
            if (allDone && p.done) {
              toast(`🎉 Mastered all pointers in "${note.title}"!`);
            }
          }
        }
        return;
      }

      // Delete pointer line
      const delPointerBtn = e.target.closest('[data-delete-pointer]');
      if (delPointerBtn) {
        e.stopPropagation();
        const [noteId, pointerId] = delPointerBtn.dataset.deletePointer.split(':');
        const note = (db.notes || []).find(n => n.id === noteId);
        if (note && Array.isArray(note.pointers)) {
          note.pointers = note.pointers.filter(p => p.id !== pointerId);
          save();
        }
        return;
      }

      // Inline add pointer button
      const inlineAddBtn = e.target.closest('[data-inline-add-btn]');
      if (inlineAddBtn) {
        const noteId = inlineAddBtn.dataset.inlineAddBtn;
        const input = canvas.querySelector(`[data-inline-add-input="${noteId}"]`);
        if (input && input.value.trim()) {
          const note = (db.notes || []).find(n => n.id === noteId);
          if (note) {
            note.pointers = note.pointers || [];
            note.pointers.push({ id: uid(), text: input.value.trim(), done: false });
            input.value = '';
            save();
          }
        }
        return;
      }

      // Pin / Unpin note
      const pinBtn = e.target.closest('[data-pin-note]');
      if (pinBtn) {
        const noteId = pinBtn.dataset.pinNote;
        const note = (db.notes || []).find(n => n.id === noteId);
        if (note) {
          note.pinned = !note.pinned;
          save();
          toast(note.pinned ? '📌 Pinned to VIP shelf!' : 'Unpinned sticky.');
        }
        return;
      }

      // Color popover trigger
      const colorTrigger = e.target.closest('[data-color-popover-trigger]');
      if (colorTrigger) {
        e.stopPropagation();
        const noteId = colorTrigger.dataset.colorPopoverTrigger;
        showColorPopover(noteId, colorTrigger);
        return;
      }

      // Set color from popover
      const setColorBtn = e.target.closest('[data-set-color]');
      if (setColorBtn) {
        const [noteId, color] = setColorBtn.dataset.setColor.split(':');
        const note = (db.notes || []).find(n => n.id === noteId);
        if (note) {
          note.color = color;
          $$('.sticky-color-popover').forEach(p => p.remove());
          save();
        }
        return;
      }

      // Copy note text
      const copyBtn = e.target.closest('[data-copy-note]');
      if (copyBtn) {
        const noteId = copyBtn.dataset.copyNote;
        const note = (db.notes || []).find(n => n.id === noteId);
        if (note) {
          let text = `${note.title || 'Untitled'}\n`;
          if (note.type === 'pointers') {
            text += (note.pointers || []).map(p => `• ${p.text} ${p.done ? '(Done)' : ''}`).join('\n');
          } else {
            text += note.content || '';
          }
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
              toast('📋 Note copied to clipboard!');
            }).catch(() => toast('Failed to copy.'));
          }
        }
        return;
      }

      // Edit note
      const editBtn = e.target.closest('[data-edit-note]');
      if (editBtn) {
        const noteId = editBtn.dataset.editNote;
        openStickyModal(noteId);
        return;
      }

      // Delete note
      const deleteBtn = e.target.closest('[data-delete-note]');
      if (deleteBtn) {
        const noteId = deleteBtn.dataset.deleteNote;
        const idx = (db.notes || []).findIndex(n => n.id === noteId);
        if (idx !== -1) {
          lastDeletedSticky = { ...db.notes[idx], index: idx };
          db.notes.splice(idx, 1);
          save();
          toast('🗑️ Sticky note removed.');
        }
        return;
      }
    });

    // Inline add pointer on Enter key
    canvas.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const input = e.target.closest('[data-inline-add-input]');
        if (input && input.value.trim()) {
          e.preventDefault();
          const noteId = input.dataset.inlineAddInput;
          const note = (db.notes || []).find(n => n.id === noteId);
          if (note) {
            note.pointers = note.pointers || [];
            note.pointers.push({ id: uid(), text: input.value.trim(), done: false });
            input.value = '';
            save();
          }
        }
      }
    });
  }

  // 5. Sticky Note Modal Form Handlers
  const modalForm = $('#sticky-note-form');
  if (modalForm) {
    // Format switcher buttons
    $('#btn-format-pointers')?.addEventListener('click', () => {
      stickyModalFormat = 'pointers';
      updateModalFormatUI();
    });
    $('#btn-format-note')?.addEventListener('click', () => {
      stickyModalFormat = 'note';
      updateModalFormatUI();
    });

    // Color Swatches
    const palette = $('#modal-color-palette');
    if (palette) {
      palette.addEventListener('click', e => {
        const swatch = e.target.closest('.palette-swatch');
        if (swatch) {
          stickyModalColor = swatch.dataset.color;
          $$('#modal-color-palette .palette-swatch').forEach(s => s.classList.toggle('active', s === swatch));
        }
      });
    }

    // Add pointer row button
    $('#btn-add-pointer-row')?.addEventListener('click', () => {
      addModalPointerRow('');
    });

    // Remove pointer row button
    $('#sticky-pointers-list')?.addEventListener('click', e => {
      const removeBtn = e.target.closest('.btn-remove-pointer-row');
      if (removeBtn) {
        const row = removeBtn.closest('.pointer-edit-row');
        if (row) {
          row.remove();
          updateModalPointersHint();
        }
      }
    });

    // Form submit
    modalForm.addEventListener('submit', e => {
      e.preventDefault();
      const editId = $('#sticky-edit-id')?.value;
      const title = $('#sticky-input-title')?.value.trim() || 'Untitled Note';
      const tag = $('#sticky-input-tag')?.value.trim() || 'QuickTip';
      const pinned = Boolean($('#sticky-is-pinned')?.checked);
      const pinStyle = $('#sticky-pin-style')?.value || 'pushpin';
      const paperStyle = $('#sticky-paper-style')?.value || 'lined';
      const content = $('#sticky-input-content')?.value.trim() || '';

      // Collect pointers
      const pointerRows = $$('#sticky-pointers-list .pointer-edit-row');
      const pointers = [];
      pointerRows.forEach(row => {
        const input = row.querySelector('.pointer-edit-input');
        const text = input ? input.value.trim() : '';
        const wasDone = row.dataset.rowDone === 'true';
        if (text) {
          pointers.push({ id: uid(), text, done: wasDone });
        }
      });

      db.notes = db.notes || [];

      if (editId) {
        const note = db.notes.find(n => n.id === editId);
        if (note) {
          note.title = title;
          note.tag = tag;
          note.pinned = pinned;
          note.pinStyle = pinStyle;
          note.paperStyle = paperStyle;
          note.color = stickyModalColor;
          note.type = stickyModalFormat;
          note.content = content;
          note.pointers = pointers;
          note.updatedAt = new Date().toISOString();
        }
      } else {
        const newSticky = {
          id: uid(),
          title,
          type: stickyModalFormat,
          pointers,
          content,
          color: stickyModalColor,
          pinStyle,
          paperStyle,
          tag,
          pinned,
          rotation: Number(((Math.random() * 4.6) - 2.3).toFixed(1)),
          createdAt: new Date().toISOString()
        };
        db.notes.unshift(newSticky);
      }

      save();
      $('#modal-sticky-note')?.close();
      toast(editId ? '✓ Sticky note updated!' : '📌 New sticky placed on board!');
    });
  }

  // 6. Export Modal Handlers
  $('#btn-copy-export-md')?.addEventListener('click', () => {
    const textarea = $('#export-notes-markdown');
    if (textarea && textarea.value) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(textarea.value).then(() => {
          toast('📋 Markdown copied to clipboard!');
        });
      }
    }
  });

  $('#btn-download-export-md')?.addEventListener('click', () => {
    const textarea = $('#export-notes-markdown');
    if (textarea && textarea.value) {
      const blob = new Blob([textarea.value], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `StudyFlow_Notes_Pointers_${todayISO()}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast('⬇️ Downloaded notes cheat-sheet!');
    }
  });
}

setupNotesEventListeners();

render();
refreshStreakFromServer();