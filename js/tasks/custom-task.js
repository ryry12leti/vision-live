/* Package 6 — Custom-task form wiring (extracted byte-exact from tasks-page.js).
   Owns the completed-list + custom-task collapsibles and the custom-task create form
   (VISION.api.createCustomTask → re-render). Loaded before tasks-page.js; SIGNED_IN /
   BACKEND_TASKS / proofTypeLabel / renderTasks / getMissions resolve at call time from the
   shared global scope. Server assigns the proof contract; no XP logic here. */
try {
  if ($('completedToggle')) $('completedToggle').addEventListener('click', function(){
    const list=$('completedList'),open=this.getAttribute('aria-expanded')==='true';
    this.setAttribute('aria-expanded',String(!open));if(list)list.hidden=open;
  });
  if ($('customTaskToggle')) $('customTaskToggle').addEventListener('click', function(){
    const form=$('customTaskForm'),open=this.getAttribute('aria-expanded')==='true';
    this.setAttribute('aria-expanded',String(!open));if(form)form.hidden=open;
  });
  if ($('customTaskForm')) $('customTaskForm').addEventListener('submit', async function(e){
    e.preventDefault();const status=$('customTaskStatus'),btn=$('customTaskSubmit');
    const title=(($('customTaskName')||{}).value||'').trim();
    if(title.length<3){if(status){status.textContent='Add a specific task title.';status.className='custom-task-status err';}return;}
    if(!SIGNED_IN||!VISION.api||!VISION.api.createCustomTask){if(status){status.textContent='Sign in to add a custom task.';status.className='custom-task-status err';}return;}
    if(btn){btn.disabled=true;btn.textContent='Reviewing proof method…';}if(status){status.textContent='Choosing secure proof instructions…';status.className='custom-task-status';}
    let result;try{result=await VISION.api.createCustomTask({title:title,description:(($('customTaskDescription')||{}).value||''),goal:(($('customTaskGoal')||{}).value||''),proofType:(($('customTaskProof')||{}).value||'auto')});}catch(err){result={error:'network'};}
    if(!result||!result.ok){if(btn){btn.disabled=false;btn.innerHTML='Add to today <span class="arr">→</span>';}if(status){status.textContent=result&&/limit/.test(String(result.error||''))?'You’ve reached today’s custom-task limit.':'Could not create that task right now. Check your connection and retry.';status.className='custom-task-status err';}return;}
    this.reset();if(status){status.textContent='Added with '+proofTypeLabel(result.proof_contract&&result.proof_contract.proof_type)+' proof.';status.className='custom-task-status';}
    if(btn){btn.disabled=false;btn.innerHTML='Add to today <span class="arr">→</span>';}
    try{BACKEND_TASKS=await VISION.api.getTasks();renderTasks(getMissions(BACKEND_TASKS));}catch(err){}
  });
} catch(e) {}
