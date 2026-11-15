import { createWorker } from 'tesseract.js';
import * as XLSX from 'xlsx';
import { savePaperFile, getPaperFile, deletePaperFile, generateImageThumbnail, formatFileSize } from './paper-storage.js';

const KEY='studyflow-v1';
const todayISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const uid=()=>Math.random().toString(36).slice(2,10);
const starter=()=>({subjects:[],tasks:[],events:[],mistakes:[],mockTests:[],skills:[],focus:{minutes:{},sessions:0}});
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
const save=()=>{
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
};
window.getStudyFlowDb = () => db;
window.getStudyFlowTasks = () => (db && db.tasks) ? db.tasks : [];
window.addStudyFlowTask = (task) => { if(db){ db.tasks = db.tasks || []; db.tasks.push(task); save(); } };
window.updateStudyFlowTask = (id, updates) => { if(db && db.tasks){ const t = db.tasks.find(x => x.id === id); if(t){ Object.assign(t, updates); save(); } } };
window.deleteStudyFlowTask = (id) => { if(db && db.tasks){ db.tasks = db.tasks.filter(x => x.id !== id); save(); } };
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>new Date(d+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
const toast=m=>{let t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)};
let currentView='overview',taskFilter='all',currentTaskScope='daily',taskSearchQuery='',reviewFilter='all',calDate=new Date(),selectedDate=todayISO(),calFilter='all',modalAction=null;
let activeMockTestId=null,testTab='tests',testSearchQuery='',testMistakeFilter='all',selectedPaperFile=null;
function loadWorkspaceForUser(userId){
  if(!userId)return;
  storageKey=`${KEY}:${userId}`;
  try{
    const userRaw=localStorage.getItem(storageKey);
    const globalRaw=localStorage.getItem(KEY);
    const userObj=userRaw?JSON.parse(userRaw):null;
    const globalObj=globalRaw?JSON.parse(globalRaw):null;

    const candidateObjs = [];
    if(userObj)candidateObjs.push(userObj);
    if(globalObj)candidateObjs.push(globalObj);
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&k.startsWith('studyflow-v1')&&k!==storageKey&&k!==KEY){
        try{
          const parsed=JSON.parse(localStorage.getItem(k));
          if(parsed&&typeof parsed==='object')candidateObjs.push(parsed);
        }catch{}
      }
    }

    const allTests=candidateObjs.flatMap(o=>o.mockTests||[]).filter((t,i,arr)=>t&&t.id&&arr.findIndex(x=>x.id===t.id)===i);
    const allMistakes=candidateObjs.flatMap(o=>o.mistakes||[]).filter((m,i,arr)=>m&&m.id&&arr.findIndex(x=>x.id===m.id)===i);
    const allSubjects=(userObj?.subjects?.length?userObj.subjects:globalObj?.subjects)||[];
    const allTasks=candidateObjs.flatMap(o=>o.tasks||[]).filter((t,i,arr)=>t&&t.id&&arr.findIndex(x=>x.id===t.id)===i);
    const allSkills=candidateObjs.flatMap(o=>o.skills||[]).filter((s,i,arr)=>s&&s.id&&arr.findIndex(x=>x.id===s.id)===i);

    db={
      ...starter(),
      ...(globalObj||{}),
      ...(userObj||{}),
      subjects:allSubjects,
      tasks:allTasks,
      skills:allSkills,
      mockTests:allTests,
      mistakes:allMistakes
    };
    localStorage.setItem(storageKey,JSON.stringify(db));
    localStorage.setItem(KEY,JSON.stringify(db));
  }catch(err){
    console.error('Error loading user workspace:',err);
    db=db||starter();
  }
  db.mockTests=db.mockTests||[];
  db.mistakes=db.mistakes||[];
  render();
  window.dispatchEvent(new CustomEvent('studyflow:data-updated',{detail:{db}}));
}
window.addEventListener('studyflow:authenticated',event=>loadWorkspaceForUser(event.detail.user.id));
function go(v){
  currentView=v;
  document.body.classList.toggle('focus-mode',v==='focus');
  document.body.classList.toggle('overview-view',v==='overview');
  $$('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${v}`));
  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
  let titles={overview:"Good morning. Let's make progress.",subjects:'Your subjects, your progress.',calendar:'Make time for what matters.',tasks:'Everything you need to get done.',reviews:'Turn mistakes into marks with test analysis.',focus:'A little focus goes a long way.',skills:'Build skills beyond the syllabus.',profile:'Performance analytics & scholar profile.'};
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
            paperStrip=`<div class="test-paper-strip"><img src="${t.thumbnail}" class="test-paper-thumb" alt="Paper thumbnail"><div class="test-paper-info"><b>${esc(t.fileName||'Paper Image')}</b><small>${formatFileSize(t.fileSize)} · Image attached</small></div></div>`;
          }else{
            paperStrip=`<div class="test-paper-strip"><div class="test-paper-icon">📄</div><div class="test-paper-info"><b>${esc(t.fileName||'Test_Paper.pdf')}</b><small>${formatFileSize(t.fileSize)} · PDF attached</small></div></div>`;
          }
        }else{
          paperStrip=`<div class="test-paper-strip"><div class="test-paper-icon">📝</div><div class="test-paper-info"><b>Test record</b><small>No paper file attached</small></div></div>`;
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
          <b>${m.questionNo?`[${esc(m.questionNo)}] `:''}${esc(m.topic)} <span class="tag">${esc(m.subject||'General')}</span></b>
          <span class="tag ${m.resolved?'':'urgent'}">${m.resolved?'Resolved':'Needs review'}</span>
        </div>
        <p><b>What went wrong:</b> ${esc(m.error)}<br><b>Correct concept / pointer:</b> ${esc(m.correction||'Not added yet')}</p>
        <div class="mistake-meta">${esc(m.test||(db.mockTests.find(x=>x.id===m.mockTestId)?.name)||'Mock test')} · ${m.date?fmt(m.date):''} ${m.marksLost?` · <b style="color:#9b3323">-${m.marksLost} marks</b>`:''}</div>
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
  dialog.showModal();
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
          <b>${esc(t.fileName||'Test_Paper')}</b>
          <small>${formatFileSize(t.fileSize)} · ${t.fileType?.includes('pdf')?'PDF Document':'Image Paper'}</small>
        </div>
      </div>
      <div class="paper-btn-group">
        <button type="button" class="btn btn-secondary btn-sm" data-view-paper="${t.id}">🔍 View full paper</button>
        <button type="button" class="btn btn-secondary btn-sm" data-download-paper="${t.id}">⬇ Download</button>
      </div>
    `;
  }else{
    paperContainer.innerHTML=`
      <div class="paper-attached-card">
        <div class="paper-card-icon">📝</div>
        <div class="paper-card-meta">
          <b>No paper attached</b>
          <small>Upload the paper image or PDF to view it alongside your review.</small>
        </div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-edit-mock-test="${t.id}">＋ Upload paper file</button>
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
            ${m.correctAnswer ? `<span>Correct / Status: <b style="color:#15803d;">${esc(m.correctAnswer)}</b></span>` : ''}
          </div>
        ` : ''}
        <div class="mistake-body-grid">
          <div class="mistake-body-col">
            <b>${m.isBlank ? 'Reason unattempted / what went wrong:' : 'What went wrong:'}</b>
            <span>${esc(m.error)}</span>
          </div>
          <div class="mistake-body-col">
            <b>${m.isBlank ? 'Revision action / Takeaway:' : 'Correct concept / Solution pointer:'}</b>
            <span>${esc(m.correction||'Not specified')}</span>
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

  dialog.showModal();
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
    $('#mistake-qno').value=m.questionNo||'';
    $('#mistake-topic').value=m.topic||'';
    $('#mistake-type').value=m.mistakeType||'Conceptual misunderstanding';
    $('#mistake-marks-lost').value=m.marksLost??'';
    $('#mistake-error').value=m.error||'';
    $('#mistake-correction').value=m.correction||'';
    $('#mistake-pointers').value=m.pointers||'';
    $('#mistake-resolved').checked=!!m.resolved;
  }else{
    if(idInput)idInput.value='';
    const defaultTestId=testId||activeMockTestId||(db.mockTests?.length===1?db.mockTests[0].id:'');
    if(testIdInput)testIdInput.value=defaultTestId;
    if(targetSelect)targetSelect.value=defaultTestId;
    titleEl.textContent='Log question mistake';
    eyebrowEl.textContent='MOCK TEST MISTAKE';
    $('#mistake-type').value='Conceptual misunderstanding';
    $('#mistake-resolved').checked=false;
  }
  dialog.showModal();
}

async function viewPaperFull(testId){
  const record=await getPaperFile(testId);
  const t=db.mockTests.find(x=>x.id===testId);
  const dialog=$('#modal-paper-viewer');
  const contentEl=$('#viewer-content');
  const titleEl=$('#viewer-paper-title');
  const downloadLink=$('#viewer-download-link');
  const openTabBtn=$('#viewer-open-tab-btn');

  titleEl.textContent=t?.name?`${t.name} — Paper Preview`:'Paper Preview';
  if(!record||!record.blob){
    contentEl.innerHTML=`
      <div class="viewer-empty-state">
        <span style="font-size:36px;">📄</span>
        <h4 style="margin:12px 0 6px; color:var(--sf-navy);">No paper file attached</h4>
        <p style="margin:0; font-size:12px; color:var(--sf-navy-soft);">This mock test was saved without an uploaded PDF or image file.</p>
      </div>
    `;
    downloadLink.hidden=true;
    if(openTabBtn)openTabBtn.hidden=true;
    dialog.showModal();
    return;
  }

  const isPdf=(record.type&&record.type.includes('pdf'))||(record.name&&record.name.toLowerCase().endsWith('.pdf'));
  let displayBlob=record.blob;
  if(isPdf&&(!displayBlob.type||displayBlob.type!=='application/pdf')){
    displayBlob=new Blob([record.blob],{type:'application/pdf'});
  }

  const url=URL.createObjectURL(displayBlob);
  downloadLink.hidden=false;
  downloadLink.href=url;
  downloadLink.download=record.name||'test-paper';

  if(openTabBtn){
    openTabBtn.hidden=false;
    openTabBtn.href=url;
  }

  if(record.type?.startsWith('image/')&&!isPdf){
    contentEl.innerHTML=`<img src="${url}" class="viewer-img" alt="Test paper preview">`;
  }else{
    contentEl.innerHTML=`
      <div class="pdf-viewer-wrap">
        <iframe src="${url}" class="viewer-pdf-frame" title="PDF preview"></iframe>
        <div class="pdf-fallback-bar">
          <span>📄 <b>${esc(record.name||'test-paper.pdf')}</b> (${formatFileSize(record.size||displayBlob.size)})</span>
          <div style="display:flex;gap:8px;align-items:center;">
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">↗ Open in new tab</a>
            <a href="${url}" download="${esc(record.name||'paper.pdf')}" class="btn btn-secondary btn-sm">⬇ Download PDF</a>
          </div>
        </div>
      </div>
    `;
  }
  dialog.showModal();
}

async function downloadPaperFile(testId){
  const record=await getPaperFile(testId);
  if(!record||!record.blob){
    toast('Paper file not available for download.');
    return;
  }
  const isPdf=(record.type&&record.type.includes('pdf'))||(record.name&&record.name.toLowerCase().endsWith('.pdf'));
  let displayBlob=record.blob;
  if(isPdf&&(!displayBlob.type||displayBlob.type!=='application/pdf')){
    displayBlob=new Blob([record.blob],{type:'application/pdf'});
  }
  const url=URL.createObjectURL(displayBlob);
  const a=document.createElement('a');
  a.href=url;
  a.download=record.name||'test-paper';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

// Bulk Excel / CSV Mistake & Blank Import
let activeExcelImportTestId=null;
let parsedExcelRows=[];

function downloadSampleExcelTemplate(){
  const sampleHeaders=[
    {
      'Q No.':'1',
      'Your Answer':'B',
      'Correct Answer / Status':'C',
      'Topic':'Dynamic Programming',
      'Why your response needs correction':'Miscalculated recurrence base condition for n=0',
      'Revision action':'Revise 0/1 knapsack base case derivations in notes',
      'Marks':2
    },
    {
      'Q No.':'2',
      'Your Answer':'Unattempted',
      'Correct Answer / Status':'Blank',
      'Topic':'Graph Theory',
      'Why your response needs correction':'Ran out of time to read Dijkstra variation with negative edges',
      'Revision action':'Practice 5 Bellman-Ford & Dijkstra problem sets under timer',
      'Marks':1
    },
    {
      'Q No.':'3',
      'Your Answer':'42.5',
      'Correct Answer / Status':'Incorrect',
      'Topic':'Computer Networks',
      'Why your response needs correction':'Applied round-trip time instead of transmission delay in throughput formula',
      'Revision action':'Memorize sliding window throughput vs efficiency formulas',
      'Marks':2
    },
    {
      'Q No.':'4',
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
    {wch:8},
    {wch:14},
    {wch:24},
    {wch:24},
    {wch:45},
    {wch:45},
    {wch:10}
  ];
  XLSX.utils.book_append_sheet(wb,ws,'Mistakes_and_Blanks');
  XLSX.writeFile(wb,'StudyFlow_Mistake_Template.xlsx');
  toast('Downloaded StudyFlow_Mistake_Template.xlsx');
}

function normalizeExcelHeader(str){
  return String(str||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
}

function mapExcelColumns(headers){
  const map={};
  headers.forEach(h=>{
    const k=normalizeExcelHeader(h);
    if(!map.qNo&&(k.startsWith('qno')||k.startsWith('qnum')||k==='q'||k.startsWith('question')||k==='no')){
      map.qNo=h;
    }else if(!map.yourAnswer&&(k.includes('your')||k.includes('my')||k.includes('student')||k.includes('marked')||k.includes('user')||k==='response'||k.includes('youranswer'))){
      map.yourAnswer=h;
    }else if(!map.correctAnswer&&(k.includes('correct')||k.includes('key')||k.includes('official')||k.includes('status')||k.includes('actual'))){
      map.correctAnswer=h;
    }else if(!map.topic&&(k.includes('topic')||k.includes('concept')||k.includes('chapter')||k.includes('subject')||k.includes('module'))){
      map.topic=h;
    }else if(!map.why&&(k.includes('why')||k.includes('reason')||k.includes('error')||k.includes('cause')||k.includes('mistake')||k.includes('correctionneeds')||k.includes('explanation'))){
      map.why=h;
    }else if(!map.action&&(k.includes('action')||k.includes('revision')||k.includes('pointer')||k.includes('fix')||k.includes('remedy')||k.includes('solution')||k.includes('takeaway'))){
      map.action=h;
    }else if(!map.marks&&(k.includes('mark')||k.includes('score')||k.includes('point')||k.includes('loss')||k.includes('weight')||k.includes('negative'))){
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
  if(w.includes('unattempted')||w.includes('left blank')||w.includes('skipped')||w.includes('could not attempt')||w.includes('ran out of time to read'))return true;
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
    banner.innerHTML=test?`Selected: <b>${esc(test.name)}</b>`:'Bulk Question Import';
  }
  parsedExcelRows=[];
  const fileInput=$('#excel-file-input');
  if(fileInput)fileInput.value='';
  $('#excel-file-selected-bar').hidden=true;
  $('#excel-dropzone-prompt').hidden=false;
  $('#excel-preview-section').hidden=true;
  const confirmBtn=$('#btn-confirm-excel-import');
  if(confirmBtn){
    confirmBtn.disabled=true;
    confirmBtn.textContent='Import questions';
  }
  $('#modal-import-excel-mistakes').showModal();
}

async function handleExcelFileSelected(file){
  if(!file)return;
  $('#excel-selected-filename').textContent=file.name;
  $('#excel-selected-filesize').textContent=formatFileSize(file.size);
  $('#excel-dropzone-prompt').hidden=true;
  $('#excel-file-selected-bar').hidden=false;

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

    // Scan top 8 rows to find the row that has key headers
    let headerRowIdx=-1;
    let colMap=null;
    for(let r=0;r<Math.min(8,sheetData.length);r++){
      const row=sheetData[r];
      if(Array.isArray(row)&&row.some(c=>String(c).trim().length>0)){
        const testMap=mapExcelColumns(row.map(c=>String(c).trim()));
        const matchedCols=Object.keys(testMap).length;
        if(matchedCols>=2){
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

    parsedExcelRows=rawRows.map((r,idx)=>{
      const qNo=String(r[colMap?.qNo]??(idx+1)).trim();
      const yourAnswer=String(r[colMap?.yourAnswer]??'').trim();
      const correctAnswer=String(r[colMap?.correctAnswer]??'').trim();
      const topic=String(r[colMap?.topic]??'General').trim()||'General';
      const why=String(r[colMap?.why]??'').trim();
      const action=String(r[colMap?.action]??'').trim();
      let marksRaw=parseFloat(r[colMap?.marks]);
      if(isNaN(marksRaw))marksRaw=0;
      const marksLost=Math.abs(marksRaw);

      const isBlank=isRowBlankOrUnattempted(yourAnswer,correctAnswer,why);
      const mistakeType=inferMistakeType(why,isBlank);

      return{
        qNo:qNo?(qNo.toLowerCase().startsWith('q')?qNo:`Q${qNo}`):`Q${idx+1}`,
        yourAnswer:isBlank&&!yourAnswer?'Left blank':yourAnswer,
        correctAnswer,
        topic,
        why:why||(isBlank?'Question left unattempted in exam':'Needs review'),
        action:action||'Review concepts and re-attempt problem',
        marksLost,
        isBlank,
        mistakeType
      };
    });

    renderExcelPreview();
  }catch(err){
    console.error('Error reading Excel/CSV file:',err);
    toast('Failed to parse spreadsheet. Please ensure it is a valid .xlsx or .csv file.');
  }
}

function renderExcelPreview(){
  const previewSection=$('#excel-preview-section');
  const tbody=$('#excel-preview-tbody');
  const statsEl=$('#excel-preview-stats');
  const confirmBtn=$('#btn-confirm-excel-import');

  if(!parsedExcelRows.length){
    previewSection.hidden=true;
    if(confirmBtn)confirmBtn.disabled=true;
    return;
  }

  const totalCount=parsedExcelRows.length;
  const blankCount=parsedExcelRows.filter(r=>r.isBlank).length;
  const mistakeCount=totalCount-blankCount;

  statsEl.innerHTML=`
    <span class="excel-stat-badge total">Total: ${totalCount} Questions</span>
    <span class="excel-stat-badge mistakes">🔴 ${mistakeCount} Mistake${mistakeCount!==1?'s':''}</span>
    <span class="excel-stat-badge blanks">⚪ ${blankCount} Blank / Unattempted</span>
  `;

  tbody.innerHTML=parsedExcelRows.map(r=>`
    <tr class="${r.isBlank?'row-blank':''}">
      <td><b>${esc(r.qNo)}</b></td>
      <td><span style="color:${r.isBlank?'#64748b':'#b91c1c'};font-weight:600;">${esc(r.yourAnswer||'-')}</span></td>
      <td><span style="color:#15803d;font-weight:600;">${esc(r.correctAnswer||'-')}</span></td>
      <td><b>${esc(r.topic)}</b></td>
      <td style="max-width:220px;" title="${esc(r.why)}">${esc(r.why)}</td>
      <td style="max-width:220px;" title="${esc(r.action)}">${esc(r.action)}</td>
      <td>${r.marksLost>0?`-${r.marksLost}`:'0'}</td>
      <td>
        <span class="preview-status-pill ${r.isBlank?'blank':'mistake'}">
          ${r.isBlank?'⚪ Blank':'🔴 Mistake'}
        </span>
      </td>
    </tr>
  `).join('');

  previewSection.hidden=false;
  if(confirmBtn){
    confirmBtn.disabled=false;
    confirmBtn.textContent=`Import ${totalCount} Question${totalCount>1?'s':''}`;
  }
}

function executeExcelImport(){
  if(!parsedExcelRows.length){
    toast('No parsed questions to import.');
    return;
  }

  const selectVal=$('#excel-target-test-select')?.value;
  let targetTestId=selectVal||activeExcelImportTestId||activeMockTestId;
  let targetTest=db.mockTests.find(x=>x.id===targetTestId);

  // If user selected __new__ or test doesn't exist, create it automatically!
  if(!targetTest||targetTestId==='__new__'){
    targetTestId=uid();
    const fileName=$('#excel-selected-filename')?.textContent||'Mock Test';
    const cleanName=fileName.replace(/\.[^/.]+$/,'')||'Mock Test Review';
    targetTest={
      id:targetTestId,
      name:cleanName,
      marks:0,
      totalMarks:100,
      subject:parsedExcelRows[0]?.topic||'General',
      date:todayISO(),
      description:'Created automatically via Excel question import',
      pointers:'',
      hasPaper:false,
      createdAt:new Date().toISOString()
    };
    db.mockTests.push(targetTest);
  }

  const mode=document.querySelector('input[name="excel-import-mode"]:checked')?.value||'append';
  if(mode==='replace'){
    db.mistakes=db.mistakes.filter(m=>m.mockTestId!==targetTestId&&(!targetTest||m.test!==targetTest.name));
  }

  const newMistakes=parsedExcelRows.map(r=>({
    id:uid(),
    mockTestId:targetTestId,
    test:targetTest.name||'Mock Test',
    subject:targetTest.subject||'',
    questionNo:r.qNo,
    userAnswer:r.yourAnswer,
    correctAnswer:r.correctAnswer,
    topic:r.topic,
    error:r.why,
    correction:r.action,
    pointers:r.action,
    marksLost:r.marksLost,
    isBlank:r.isBlank,
    mistakeType:r.mistakeType,
    resolved:false,
    date:targetTest.date||todayISO(),
    source:'excel_import'
  }));

  db.mistakes.push(...newMistakes);
  save();

  $('#modal-import-excel-mistakes').close();
  const blankCount=parsedExcelRows.filter(r=>r.isBlank).length;
  const mistakeCount=parsedExcelRows.length-blankCount;
  toast(`🎉 Imported ${parsedExcelRows.length} questions (${mistakeCount} mistakes, ${blankCount} blanks)! Topic analytics updated.`);

  activeMockTestId=targetTestId;
  openMockTestDetail(targetTestId);
}
function render(){renderOverview();renderSubjects();renderSkills();renderTasks();renderCalendar();renderReviews()}
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
      await savePaperFile(id,selectedPaperFile);
      if(fileType.startsWith('image/')&&!isPdf){
        thumbnail=await generateImageThumbnail(selectedPaperFile);
      }else{
        thumbnail=null;
      }
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

    const mistakeData={
      id:mId||uid(),
      mockTestId:targetTestId,
      test:testObj?testObj.name:(fd.get('test')||''),
      questionNo:String(fd.get('questionNo')||'').trim(),
      topic:String(fd.get('topic')||'General').trim(),
      subject:testObj?.subject||(fd.get('subject')||''),
      mistakeType:String(fd.get('mistakeType')||'Conceptual misunderstanding'),
      marksLost:parseFloat(fd.get('marksLost'))||0,
      error:String(fd.get('error')||'').trim(),
      correction:String(fd.get('correction')||'').trim(),
      pointers:String(fd.get('pointers')||'').trim(),
      resolved:fd.get('resolved')==='on',
      date:testObj?.date||todayISO()
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
$('#btn-confirm-excel-import')?.addEventListener('click',executeExcelImport);

// Excel Dropzone setup
const excelDropzone=$('#excel-dropzone');
const excelFileInput=$('#excel-file-input');
if(excelDropzone&&excelFileInput){
  excelDropzone.onclick=e=>{
    if(e.target===excelFileInput||e.target.closest('#btn-change-excel-file'))return;
    excelFileInput.click();
  };
  excelDropzone.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();excelFileInput.click()}};
  excelFileInput.onchange=()=>{
    const file=excelFileInput.files?.[0];
    if(file)handleExcelFileSelected(file);
  };
  $('#btn-change-excel-file')?.addEventListener('click',e=>{
    e.stopPropagation();
    excelFileInput.value='';
    excelFileInput.click();
  });
  ['dragenter','dragover'].forEach(evt=>{
    excelDropzone.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();excelDropzone.classList.add('dragover')});
  });
  ['dragleave','drop'].forEach(evt=>{
    excelDropzone.addEventListener(evt,e=>{e.preventDefault();e.stopPropagation();excelDropzone.classList.remove('dragover')});
  });
  excelDropzone.addEventListener('drop',e=>{
    const dt=e.dataTransfer;
    const file=dt?.files?.[0];
    if(file)handleExcelFileSelected(file);
  });
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
  if(confirm('Are you sure you want to delete this mock test paper and its reviews?')){
    const tid=activeMockTestId;
    db.mockTests=db.mockTests.filter(x=>x.id!==tid);
    await deletePaperFile(tid);
    $('#modal-test-detail').close();
    activeMockTestId=null;
    save();
    toast('Mock test deleted.');
  }
});

// Modal close button listeners
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
    if(confirm('Delete this mock test paper?')){
      const id=b.dataset.deleteMockTest;
      db.mockTests=db.mockTests.filter(t=>t.id!==id);
      deletePaperFile(id);
      save();
      toast('Test deleted.');
    }
  }
  if(b.dataset.viewPaper){
    e.stopPropagation();
    viewPaperFull(b.dataset.viewPaper);
  }
  if(b.dataset.downloadPaper){
    e.stopPropagation();
    downloadPaperFile(b.dataset.downloadPaper);
  }
  if(b.dataset.editTestMistake){
    openMistakeModal(b.dataset.editTestMistake,activeMockTestId);
  }
  if(b.dataset.deleteTestMistake){
    if(confirm('Delete this mistake record?')){
      db.mistakes=db.mistakes.filter(m=>m.id!==b.dataset.deleteTestMistake);
      save();
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
  if(b.dataset.deleteMistake){db.mistakes=db.mistakes.filter(m=>m.id!==b.dataset.deleteMistake);save();toast('Mistake deleted.')}
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
document.addEventListener('change',e=>{let el=e.target;if(el.dataset.taskCheck){let t=db.tasks.find(x=>x.id===el.dataset.taskCheck);t.done=el.checked;save()}if(el.dataset.topic){let [sid,i]=el.dataset.topic.split(':');db.subjects.find(s=>s.id===sid).topics[+i].done=el.checked;save()}if(el.dataset.skillMilestone){let [sid,i]=el.dataset.skillMilestone.split(':');let skill=db.skills.find(s=>s.id===sid);skill.milestones[+i].done=el.checked;if(skill.milestones.length&&skill.milestones.every(m=>m.done))skill.status='Completed';else if(el.checked&&skill.status==='Not started')skill.status='Learning';save()}});
$$('[data-filter]').forEach(b=>b.onclick=()=>{taskFilter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTasks()});
$$('[data-review-filter]').forEach(b=>b.onclick=()=>{reviewFilter=b.dataset.reviewFilter;$$('[data-review-filter]').forEach(x=>x.classList.toggle('active',x===b));renderReviews()});
$('#prev-month').onclick=()=>{calDate.setMonth(calDate.getMonth()-1);renderCalendar()};$('#next-month').onclick=()=>{calDate.setMonth(calDate.getMonth()+1);renderCalendar()};$('#today-btn').onclick=()=>{calDate=new Date();selectedDate=todayISO();renderCalendar()};
$('#notify-btn').onclick=async()=>{if(!('Notification'in window)){toast('Browser notifications are not supported here.');return}let p=await Notification.requestPermission();toast(p==='granted'?'Browser notifications enabled. Keep this tab open for reminders.':'Notification permission was not granted.')};
function checkReminders(){if(!('Notification'in window)||Notification.permission!=='granted')return;let now=new Date(),date=todayISO(),hm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;db.tasks.filter(t=>t.due===date&&t.reminder===hm&&!t.done).forEach(t=>new Notification('StudyFlow deadline reminder',{body:t.title}))}
setInterval(checkReminders,30000);
$('#today-date').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'});$('#today-label').textContent=new Date().getHours()<12?'GOOD MORNING':'YOUR STUDY SPACE';
render();