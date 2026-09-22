/* VISION Live V1 deterministic verifier state machines. No network, storage, or XP writes. */
(function (root) {
  'use strict';
  var SUPPORTED = {
    'live-pushup-v1': 'pushup',
    'live-squat-v1': 'squat',
    'live-plank-v1': 'plank',
    'live-lunge-v1': 'lunge',
    'live-jumping-jack-v1': 'jumping_jack',
    'live-burpee-v1': 'burpee',
    'live-situp-v1': 'situp',
    'live-pullup-v1': 'pullup',
    'live-mountain-climber-v1': 'mountain_climber',
    'live-soccer-drill-v1': 'soccer_drill',
    'live-shadowboxing-v1': 'shadowboxing',
    'live-generic-movement-v1': 'generic_movement'
  };
  var SCORE = 0.3, CORE_LOSS_MS = 350, LOWER_LOSS_MS = 650, MIN_REP_MS = 450, MAX_REP_MS = 12000;

  function keypoint(pose, name) {
    var a = pose && pose.keypoints || [];
    for (var i = 0; i < a.length; i++) if (a[i].name === name && Number(a[i].score || 0) >= SCORE) return a[i];
    return null;
  }
  function angle(a, b, c) {
    if (!a || !b || !c) return null;
    var x1 = a.x - b.x, y1 = a.y - b.y, x2 = c.x - b.x, y2 = c.y - b.y;
    var m1 = Math.hypot(x1, y1), m2 = Math.hypot(x2, y2); if (!m1 || !m2) return null;
    return Math.acos(Math.max(-1, Math.min(1, (x1 * x2 + y1 * y2) / (m1 * m2)))) * 180 / Math.PI;
  }
  function chain(pose, side, names) {
    var out = [], score = 0;
    for (var i = 0; i < names.length; i++) { var p = keypoint(pose, side + '_' + names[i]); if (!p) return null; out.push(p); score += p.score; }
    return { points: out, score: score / names.length };
  }
  function selectSide(pose, names) {
    var l = chain(pose, 'left', names), r = chain(pose, 'right', names);
    if (!l && !r) return 'none'; return l && (!r || l.score >= r.score) ? 'left' : 'right';
  }
  function result(v, extra) {
    return Object.assign({ verifierId: v.id, state: v.state, selectedSide: v.side, phase: v.phase,
      clientCountedReps: v.reps, clientRejectedReps: v.rejected, clientClaimedHoldMs: v.holdMs,
      clientClaimedDurationMs: v.durationMs,
      trackingStable: v.state === 'ready', setupRequired: v.state !== 'ready', repCompleted: false,
      repRejected: false, rejectionReason: null, cue: '' }, extra || {});
  }
  function reject(v, why, now) { v.rejected++; v.reasons.push(why); v.partial = false; v.phase = 'setup'; v.cycleStarted = 0; v.lastChange = now; return result(v, { repRejected: true, rejectionReason: why }); }
  function resetForGap(v, now, why) {
    var hadPartial = v.partial; v.partial = false; v.phase = 'setup'; v.cycleStarted = 0; v.lastChange = now;
    if (hadPartial) { v.rejected++; v.reasons.push(why || 'tracking_gap'); }
  }
  function Base(id, kind, target) {
    this.id = id; this.kind = kind; this.target = Number(target || 0); this.state = 'setup'; this.side = 'none'; this.phase = 'setup';
    this.reps = 0; this.rejected = 0; this.reasons = []; this.holdMs = 0; this.durationMs = 0; this.partial = false; this.cycleStarted = 0;
    this.lastFrame = 0; this.lastValid = 0; this.lossStarted = 0; this.setupSince = 0; this.lastChange = 0;
  }
  Base.prototype.reset = function () { var id = this.id, kind = this.kind, target = this.target; Base.call(this, id, kind, target); };
  Base.prototype.tracking = function (pose, now, names, lowerBody) {
    var chosen = this.side === 'none' ? selectSide(pose, names) : this.side;
    var valid = chosen !== 'none' && !!chain(pose, chosen, names);
    if (!valid) {
      if (!this.lossStarted) this.lossStarted = now;
      var grace = lowerBody ? LOWER_LOSS_MS : CORE_LOSS_MS;
      if (now - this.lossStarted >= grace) { resetForGap(this, now, 'tracking_gap'); this.state = 'setup'; this.side = 'none'; this.setupSince = 0; }
      else if (this.state === 'ready') this.state = 'tracking_unstable';
      return false;
    }
    this.lossStarted = 0; this.lastValid = now;
    if (this.state !== 'ready') {
      if (!this.setupSince || chosen !== this.side) this.setupSince = now;
      this.side = chosen;
      if (now - this.setupSince >= 400) { this.state = 'ready'; this.phase = 'top'; this.lastChange = now; }
    }
    return this.state === 'ready';
  };

  function PhaseVerifier(id, kind, target, names, metric, thresholds, lowerBody) { Base.call(this, id, kind, target); this.names = names; this.metric = metric; this.t = thresholds; this.lowerBody = lowerBody; }
  PhaseVerifier.prototype = Object.create(Base.prototype); PhaseVerifier.prototype.constructor = PhaseVerifier;
  PhaseVerifier.prototype.update = function (frame) {
    var now = Number(frame.timestamp || 0), pose = frame.pose, gap = this.lastFrame ? now - this.lastFrame : 0; this.lastFrame = now;
    if (gap > 1000) { resetForGap(this, now, 'frame_gap'); this.state = 'setup'; this.side = 'none'; }
    if (!this.tracking(pose, now, this.names, this.lowerBody)) return result(this, { cue: this.state === 'tracking_unstable' ? 'Tracking unstable' : 'Return to the starting position' });
    var m = this.metric(pose, this.side); if (m == null) return result(this, { cue: 'Keep your full body in frame' });
    var desired = this.phase;
    if (this.phase === 'top' && m <= this.t.descend) desired = 'descending';
    if ((this.phase === 'descending' || this.phase === 'top') && m <= this.t.bottom) desired = 'bottom';
    if (this.phase === 'bottom' && m > this.t.bottom + this.t.hysteresis) desired = 'ascending';
    if ((this.phase === 'ascending' || this.phase === 'bottom') && m >= this.t.top) desired = 'top';
    if (desired !== this.phase) {
      var prev = this.phase; this.phase = desired; this.lastChange = now;
      if (desired === 'descending' || (desired === 'bottom' && prev === 'top')) { this.partial = true; this.cycleStarted = now; }
      if (desired === 'top' && (prev === 'ascending' || prev === 'bottom') && this.partial) {
        var elapsed = now - this.cycleStarted; this.partial = false; this.cycleStarted = 0;
        if (elapsed < MIN_REP_MS) return reject(this, 'implausibly_fast', now);
        if (elapsed > MAX_REP_MS) return reject(this, 'stale_cycle', now);
        this.reps++; return result(this, { repCompleted: true, cue: 'Rep counted on device' });
      }
    }
    return result(this);
  };
  function jointMetric(joints) { return function (pose, side) { var c = chain(pose, side, joints); return c ? angle(c.points[0], c.points[1], c.points[2]) : null; }; }

  function Plank(target) { Base.call(this, 'live-plank-v1', 'plank', target); this.lastHoldFrame = 0; }
  Plank.prototype = Object.create(Base.prototype); Plank.prototype.constructor = Plank;
  Plank.prototype.update = function (frame) {
    var now = Number(frame.timestamp || 0), pose = frame.pose, gap = this.lastFrame ? now - this.lastFrame : 0; this.lastFrame = now;
    if (!this.tracking(pose, now, ['shoulder', 'hip', 'ankle'], false)) { this.lastHoldFrame = 0; return result(this, { cue: 'Hold time paused' }); }
    var c = chain(pose, this.side, ['shoulder', 'hip', 'ankle']), body = c && angle(c.points[0], c.points[1], c.points[2]);
    var good = body != null && body >= 155 && body <= 195 && gap <= 500;
    if (good && this.lastHoldFrame) this.holdMs += Math.max(0, Math.min(250, now - this.lastHoldFrame));
    this.lastHoldFrame = good ? now : 0;
    return result(this, { phase: good ? 'holding' : 'form_paused', cue: good ? 'Hold steady' : 'Straighten your body line' });
  };

  function Jack(target) { Base.call(this, 'live-jumping-jack-v1', 'jumping_jack', target); this.phase = 'setup'; }
  Jack.prototype = Object.create(Base.prototype); Jack.prototype.constructor = Jack;
  Jack.prototype.update = function (frame) {
    var now = Number(frame.timestamp || 0), pose = frame.pose, gap = this.lastFrame ? now - this.lastFrame : 0; this.lastFrame = now;
    var names = ['shoulder', 'hip', 'ankle'];
    var all = ['left_shoulder','right_shoulder','left_wrist','right_wrist','left_hip','right_hip','left_ankle','right_ankle'];
    var valid = pose && all.every(function (n) { return !!keypoint(pose, n); });
    if (!valid || gap > 1000) { if (!this.lossStarted) this.lossStarted = now; if (gap > 1000 || now - this.lossStarted >= CORE_LOSS_MS) { resetForGap(this, now, 'tracking_gap'); this.state = 'setup'; } return result(this, { cue: 'Show your full body' }); }
    this.lossStarted = 0; if (this.state !== 'ready') { if (!this.setupSince) this.setupSince = now; if (now - this.setupSince >= 400) { this.state = 'ready'; this.phase = 'closed'; } }
    var ls=keypoint(pose,'left_shoulder'),rs=keypoint(pose,'right_shoulder'),lw=keypoint(pose,'left_wrist'),rw=keypoint(pose,'right_wrist'),lh=keypoint(pose,'left_hip'),rh=keypoint(pose,'right_hip'),la=keypoint(pose,'left_ankle'),ra=keypoint(pose,'right_ankle');
    var hips=Math.abs(lh.x-rh.x)||1, openArms=lw.y<ls.y&&rw.y<rs.y, openFeet=Math.abs(la.x-ra.x)>hips*1.5;
    var closedArms=lw.y>ls.y&&rw.y>rs.y, closedFeet=Math.abs(la.x-ra.x)<hips*1.25;
    if (this.phase === 'closed' && (openArms || openFeet)) { this.phase='opening'; this.partial=true; this.cycleStarted=now; }
    if (this.phase === 'opening' && openArms && openFeet) this.phase='open';
    if (this.phase === 'open' && closedArms && closedFeet) { var elapsed=now-this.cycleStarted; this.phase='closed'; this.partial=false; if(elapsed<MIN_REP_MS)return reject(this,'implausibly_fast',now); this.reps++; return result(this,{repCompleted:true,cue:'Rep counted on device'}); }
    return result(this);
  };

  function MountainClimber(target) { Base.call(this, 'live-mountain-climber-v1', 'mountain_climber', target); this.lastDrive = 'none'; this.lastRep = 0; }
  MountainClimber.prototype = Object.create(Base.prototype); MountainClimber.prototype.constructor = MountainClimber;
  MountainClimber.prototype.update = function (frame) {
    var now=Number(frame.timestamp||0),pose=frame.pose,gap=this.lastFrame?now-this.lastFrame:0;this.lastFrame=now;
    if(gap>1000){resetForGap(this,now,'frame_gap');this.state='setup';this.side='none';this.lastDrive='none';}
    var required=['left_shoulder','right_shoulder','left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle'];
    if(!pose||!required.every(function(n){return !!keypoint(pose,n);})){if(!this.lossStarted)this.lossStarted=now;if(now-this.lossStarted>=LOWER_LOSS_MS){resetForGap(this,now,'tracking_gap');this.state='setup';this.lastDrive='none';}return result(this,{cue:'Show shoulders, hips, knees, and ankles'});}
    this.lossStarted=0;this.state='ready';
    var lh=keypoint(pose,'left_hip'),rh=keypoint(pose,'right_hip'),lk=keypoint(pose,'left_knee'),rk=keypoint(pose,'right_knee');
    var torso=Math.max(1,Math.abs(((lh.y+rh.y)/2)-((keypoint(pose,'left_shoulder').y+keypoint(pose,'right_shoulder').y)/2)));
    var leftDrive=Math.hypot(lk.x-lh.x,lk.y-lh.y)<torso*.72,rightDrive=Math.hypot(rk.x-rh.x,rk.y-rh.y)<torso*.72;
    var drive=leftDrive&&!rightDrive?'left':rightDrive&&!leftDrive?'right':'none';
    if(drive!=='none'&&drive!==this.lastDrive){if(this.lastDrive!=='none'){if(this.lastRep&&now-this.lastRep<MIN_REP_MS)return reject(this,'implausibly_fast',now);this.reps++;this.lastRep=now;}this.lastDrive=drive;return result(this,{repCompleted:this.reps>0,cue:'Alternate each knee toward your chest'});}
    return result(this,{phase:drive==='none'?'plank':drive+'_drive',cue:'Keep your hips steady'});
  };

  function Burpee(target) { Base.call(this, 'live-burpee-v1', 'burpee', target); this.phase='standing'; this.lastRep=0; }
  Burpee.prototype = Object.create(Base.prototype); Burpee.prototype.constructor = Burpee;
  Burpee.prototype.update = function(frame){
    var now=Number(frame.timestamp||0),pose=frame.pose,gap=this.lastFrame?now-this.lastFrame:0;this.lastFrame=now;
    var sh=keypoint(pose,'left_shoulder')||keypoint(pose,'right_shoulder'),hip=keypoint(pose,'left_hip')||keypoint(pose,'right_hip'),ank=keypoint(pose,'left_ankle')||keypoint(pose,'right_ankle'),w=keypoint(pose,'left_wrist')||keypoint(pose,'right_wrist');
    if(!sh||!hip||!ank||!w||gap>1000){if(this.partial)resetForGap(this,now,'tracking_gap');this.state='setup';return result(this,{cue:'Show your full body, including hands and feet'});}
    this.state='ready';var vertical=Math.abs(ank.y-sh.y),horizontal=Math.abs(ank.x-sh.x),body=Math.max(1,Math.hypot(ank.x-sh.x,ank.y-sh.y));
    var low=horizontal>vertical*1.2&&angle(sh,hip,ank)>145,crouch=w.y>hip.y&&w.y<ank.y,standing=vertical>horizontal*1.5&&vertical>body*.78;
    if(this.phase==='standing'&&crouch){this.phase='crouch';this.partial=true;this.cycleStarted=now;}
    else if(this.phase==='crouch'&&low)this.phase='floor';
    else if(this.phase==='floor'&&crouch)this.phase='rising';
    else if(this.phase==='rising'&&standing){var elapsed=now-this.cycleStarted;this.phase='standing';this.partial=false;if(elapsed<1200)return reject(this,'implausibly_fast',now);if(elapsed>MAX_REP_MS*2)return reject(this,'stale_cycle',now);this.reps++;this.lastRep=now;return result(this,{repCompleted:true,cue:'Burpee counted — reset under control'});}
    return result(this,{phase:this.phase,cue:this.phase==='floor'?'Return your feet under you':'Keep the sequence controlled'});
  };

  function DurationMovement(id,kind,target,joints,minTravel){Base.call(this,id,kind,target);this.joints=joints;this.minTravel=minTravel||.08;this.previous=null;this.lastAt=0;this.stillMs=0;}
  DurationMovement.prototype=Object.create(Base.prototype);DurationMovement.prototype.constructor=DurationMovement;
  DurationMovement.prototype.update=function(frame){
    var now=Number(frame.timestamp||0),pose=frame.pose,points=[],self=this;
    for(var i=0;i<this.joints.length;i++){var p=keypoint(pose,this.joints[i]);if(p)points.push(p);}
    var shoulders=[keypoint(pose,'left_shoulder'),keypoint(pose,'right_shoulder')].filter(Boolean),hips=[keypoint(pose,'left_hip'),keypoint(pose,'right_hip')].filter(Boolean);
    if(points.length<Math.ceil(this.joints.length*.65)||!shoulders.length||!hips.length){this.state=this.lastAt&&now-this.lastAt<650?'tracking_unstable':'setup';this.previous=null;return result(this,{cue:'Return to frame so your movement can be evaluated'});}
    var sx=shoulders.reduce(function(a,p){return a+p.x;},0)/shoulders.length,sy=shoulders.reduce(function(a,p){return a+p.y;},0)/shoulders.length,hx=hips.reduce(function(a,p){return a+p.x;},0)/hips.length,hy=hips.reduce(function(a,p){return a+p.y;},0)/hips.length,scale=Math.max(1,Math.hypot(sx-hx,sy-hy));
    var centre={x:points.reduce(function(a,p){return a+p.x;},0)/points.length,y:points.reduce(function(a,p){return a+p.y;},0)/points.length};
    var travel=this.previous?Math.hypot(centre.x-this.previous.x,centre.y-this.previous.y)/scale:0,dt=this.lastAt?Math.min(500,Math.max(0,now-this.lastAt)):0;
    this.previous=centre;this.lastAt=now;this.state='ready';
    if(travel>=this.minTravel){this.durationMs+=dt;this.stillMs=0;}else this.stillMs+=dt;
    return result(this,{phase:travel>=this.minTravel?'moving':'paused',cue:travel>=this.minTravel?'Movement tracked':'Keep moving with control'});
  };

  function create(contract) {
    var c = contract || {}, id = c.verifier_id || c.verifierId, target = c.target_value || c.targetValue || 0;
    if (id === 'live-pushup-v1') return new PhaseVerifier(id, 'pushup', target, ['shoulder','elbow','wrist'], jointMetric(['shoulder','elbow','wrist']), { top: 155, descend: 145, bottom: 105, hysteresis: 8 }, false);
    if (id === 'live-squat-v1') return new PhaseVerifier(id, 'squat', target, ['hip','knee','ankle'], jointMetric(['hip','knee','ankle']), { top: 155, descend: 145, bottom: 105, hysteresis: 8 }, true);
    if (id === 'live-plank-v1') return new Plank(target);
    if (id === 'live-lunge-v1') return new PhaseVerifier(id, 'lunge', target, ['hip','knee','ankle'], jointMetric(['hip','knee','ankle']), { top: 155, descend: 140, bottom: 105, hysteresis: 8 }, true);
    if (id === 'live-jumping-jack-v1') return new Jack(target);
    if (id === 'live-burpee-v1') return new Burpee(target);
    if (id === 'live-situp-v1') return new PhaseVerifier(id, 'situp', target, ['shoulder','hip','knee'], jointMetric(['shoulder','hip','knee']), { top: 125, descend: 115, bottom: 78, hysteresis: 8 }, false);
    if (id === 'live-pullup-v1') return new PhaseVerifier(id, 'pullup', target, ['shoulder','elbow','wrist'], jointMetric(['shoulder','elbow','wrist']), { top: 150, descend: 135, bottom: 75, hysteresis: 8 }, false);
    if (id === 'live-mountain-climber-v1') return new MountainClimber(target);
    if (id === 'live-soccer-drill-v1') return new DurationMovement(id,'soccer_drill',target,['left_ankle','right_ankle','left_knee','right_knee'],.07);
    if (id === 'live-shadowboxing-v1') return new DurationMovement(id,'shadowboxing',target,['left_wrist','right_wrist','left_elbow','right_elbow'],.08);
    if (id === 'live-generic-movement-v1') return new DurationMovement(id,'generic_movement',target,['left_wrist','right_wrist','left_ankle','right_ankle'],.06);
    return null;
  }
  var api = { SUPPORTED: SUPPORTED, create: create, keypoint: keypoint, angle: angle };
  root.VISION = root.VISION || {}; root.VISION.liveVerifiers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
