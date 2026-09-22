/* VISION Universal Live Proof — EquipmentEngine + load evidence authority.
   This module never invents equipment from pose landmarks. It consumes either
   tracked object detections or a fresh server-verified setup scan, binds all
   evidence to one Live session, and keeps load claims separate from rep claims. */
(function (root, factory) {
  var api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.VISION = root.VISION || {};
    root.VISION.equipmentEngineV3 = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var EQUIPMENT = [
    'dumbbell','barbell','kettlebell','resistance_band','cable_handle','cable_machine',
    'selectorised_machine','plate_loaded_machine','bench','box_or_step','pull_up_bar'
  ];
  var LOAD_MODES = [
    'NONE','USER_CONFIRMED_UNVERIFIED','LABEL_OCR','PLATE_CONFIGURATION',
    'STACK_PIN_OCR','CONNECTED_EQUIPMENT','HYBRID_SCAN'
  ];
  var VERIFIED_LOAD_MODES = {
    LABEL_OCR: true,
    PLATE_CONFIGURATION: true,
    STACK_PIN_OCR: true,
    CONNECTED_EQUIPMENT: true,
    HYBRID_SCAN: true
  };
  var ALIASES = {
    dumbbells:'dumbbell',db:'dumbbell',bar:'barbell',barbells:'barbell',
    kettlebells:'kettlebell',kb:'kettlebell',band:'resistance_band',bands:'resistance_band',
    cable:'cable_handle',rope:'cable_handle',machine:'selectorised_machine',
    step:'box_or_step',box:'box_or_step',pullup_bar:'pull_up_bar',chinup_bar:'pull_up_bar'
  };

  function nowMs() { return Date.now(); }
  function clamp01(v) { v = Number(v); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  function normaliseClass(value) {
    var key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g,'_');
    return ALIASES[key] || key;
  }
  function point(value) {
    if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null;
    return { x:Number(value.x), y:Number(value.y), score:clamp01(value.score == null ? 1 : value.score) };
  }
  function centre(box) {
    box = box || {};
    return { x:Number(box.x || 0)+Number(box.w || 0)/2, y:Number(box.y || 0)+Number(box.h || 0)/2 };
  }
  function distance(a,b) { return a && b ? Math.hypot(a.x-b.x,a.y-b.y) : Infinity; }
  function vector(a,b) { return a && b ? { x:b.x-a.x,y:b.y-a.y } : null; }
  function magnitude(v) { return v ? Math.hypot(v.x,v.y) : 0; }
  function cosine(a,b) {
    var ma=magnitude(a),mb=magnitude(b);
    return ma&&mb ? (a.x*b.x+a.y*b.y)/(ma*mb) : 0;
  }
  function serialiseEvidence(evidence) {
    return {
      evidenceId:evidence.evidenceId,
      sessionId:evidence.sessionId,
      source:evidence.source,
      capturedAt:evidence.capturedAt,
      expiresAt:evidence.expiresAt,
      equipmentClass:evidence.equipmentClass || null,
      confidence:evidence.confidence,
      load:evidence.load || null
    };
  }

  function EquipmentEngine(options) {
    options=options||{};
    this.minConfidence=clamp01(options.minConfidence == null ? 0.60 : options.minConfidence);
    this.associationDistance=Math.max(20,Number(options.associationDistance)||110);
    this.motionThreshold=Math.max(0.5,Number(options.motionThreshold)||4);
    this.userMotionThreshold=Math.max(0.5,Number(options.userMotionThreshold)||6);
    this.maxLostMs=Math.max(250,Number(options.maxLostMs)||1200);
    this.scanTtlMs=Math.max(1000,Number(options.scanTtlMs)||120000);
    this.reset();
  }
  EquipmentEngine.prototype.reset=function(){
    this.sessionId=null;
    this.expected=[];
    this.required=false;
    this.state='unbound';
    this.lastSeenAt=0;
    this.lastAssociatedAt=0;
    this.previousWrist=null;
    this.previousObject=null;
    this.trackId=null;
    this.motionSamples=0;
    this.correlatedSamples=0;
    this.staticMismatchSamples=0;
    this.currentConfidence=0;
    this.setupEvidence=null;
    this.loadEvidence=null;
    this.seenEvidence=Object.create(null);
    this.lossCount=0;
    this.rejectionReason=null;
  };
  EquipmentEngine.prototype.bindSession=function(sessionId, expected, required){
    if (!sessionId || String(sessionId).length<8) throw new Error('invalid_equipment_session');
    var list=Array.isArray(expected)?expected:[expected];
    list=list.filter(Boolean).map(normaliseClass);
    for (var i=0;i<list.length;i++) if (EQUIPMENT.indexOf(list[i])<0) throw new Error('unsupported_equipment_'+list[i]);
    this.reset();
    this.sessionId=String(sessionId);
    this.expected=list;
    this.required=required!==false && list.length>0;
    this.state=this.required?'awaiting_setup':'not_required';
    return this.snapshot();
  };
  EquipmentEngine.prototype._assertSession=function(sessionId){
    if (!this.sessionId || String(sessionId||'')!==this.sessionId) throw new Error('equipment_session_mismatch');
  };
  EquipmentEngine.prototype.bindSetupEvidence=function(evidence){
    evidence=evidence||{};
    this._assertSession(evidence.sessionId);
    if (!evidence.evidenceId || String(evidence.evidenceId).length<8) throw new Error('equipment_evidence_id_required');
    if (this.seenEvidence[evidence.evidenceId]) return {status:'duplicate',evidence:serialiseEvidence(this.setupEvidence||evidence)};
    var cls=normaliseClass(evidence.equipmentClass);
    if (this.expected.length && this.expected.indexOf(cls)<0) throw new Error('wrong_equipment_class');
    var captured=Number(evidence.capturedAt||0), expires=Number(evidence.expiresAt||0);
    var now=nowMs();
    if (!captured || captured>now+30000) throw new Error('invalid_equipment_capture_time');
    if (!expires) expires=captured+this.scanTtlMs;
    if (expires<=now || expires>captured+this.scanTtlMs+1000) throw new Error('equipment_evidence_expired');
    var confidence=clamp01(evidence.confidence);
    if (confidence<this.minConfidence || evidence.verified!==true) throw new Error('equipment_evidence_unverified');
    var source=String(evidence.source||'').toLowerCase();
    if (['server_image_classification','connected_equipment','validated_object_model'].indexOf(source)<0) throw new Error('unsupported_equipment_evidence_source');
    this.setupEvidence={evidenceId:String(evidence.evidenceId),sessionId:this.sessionId,source:source,capturedAt:captured,expiresAt:expires,equipmentClass:cls,confidence:confidence,load:null};
    this.seenEvidence[evidence.evidenceId]=true;
    this.currentConfidence=Math.max(this.currentConfidence,confidence);
    this.state='setup_verified';
    this.rejectionReason=null;
    return {status:'verified',evidence:serialiseEvidence(this.setupEvidence)};
  };
  EquipmentEngine.prototype.bindLoadEvidence=function(evidence){
    evidence=evidence||{};
    this._assertSession(evidence.sessionId);
    var mode=String(evidence.mode||'NONE').toUpperCase();
    if (LOAD_MODES.indexOf(mode)<0) throw new Error('invalid_load_verification_mode');
    if (mode==='NONE') { this.loadEvidence={mode:mode,verified:false,value:null,unit:null}; return this.loadSnapshot(); }
    if (!evidence.evidenceId || String(evidence.evidenceId).length<8) throw new Error('load_evidence_id_required');
    if (this.seenEvidence[evidence.evidenceId]) return Object.assign({status:'duplicate'},this.loadSnapshot());
    var value=Number(evidence.value),unit=String(evidence.unit||'kg').toLowerCase();
    if (!Number.isFinite(value)||value<0||value>1000) throw new Error('invalid_load_value');
    if (['kg','lb','level','plate_configuration'].indexOf(unit)<0) throw new Error('invalid_load_unit');
    var captured=Number(evidence.capturedAt||0),expires=Number(evidence.expiresAt||0),now=nowMs();
    if (!captured||captured>now+30000) throw new Error('invalid_load_capture_time');
    if (!expires) expires=captured+this.scanTtlMs;
    if (expires<=now||expires>captured+this.scanTtlMs+1000) throw new Error('load_evidence_expired');
    var confidence=clamp01(evidence.confidence);
    var verified=!!(VERIFIED_LOAD_MODES[mode]&&evidence.verified===true&&confidence>=this.minConfidence);
    if (mode==='USER_CONFIRMED_UNVERIFIED') verified=false;
    if (VERIFIED_LOAD_MODES[mode]&&evidence.verified!==true) throw new Error('load_evidence_unverified');
    this.loadEvidence={
      mode:mode,verified:verified,value:value,unit:unit,confidence:confidence,
      evidenceId:String(evidence.evidenceId),capturedAt:captured,expiresAt:expires,
      provider:evidence.provider?String(evidence.provider).slice(0,120):null,
      sessionId:this.sessionId
    };
    this.seenEvidence[evidence.evidenceId]=true;
    return this.loadSnapshot();
  };
  EquipmentEngine.prototype.ingest=function(frame){
    frame=frame||{};
    var timestamp=Number(frame.timestamp||nowMs());
    var wrists=(frame.wrists||[]).map(point).filter(Boolean);
    var objects=Array.isArray(frame.objects)?frame.objects:[];
    var candidates=[];
    for (var i=0;i<objects.length;i++) {
      var object=objects[i]||{},cls=normaliseClass(object.class);
      if (this.expected.length&&this.expected.indexOf(cls)<0) continue;
      var c=centre(object.box),bestWrist=null,bestDistance=Infinity;
      for (var w=0;w<wrists.length;w++) {
        var d=distance(c,wrists[w]);
        if (d<bestDistance){bestDistance=d;bestWrist=wrists[w];}
      }
      candidates.push({object:object,centre:c,wrist:bestWrist,distance:bestDistance,confidence:clamp01(object.score),equipmentClass:cls});
    }
    candidates.sort(function(a,b){return (b.confidence-a.confidence)||(a.distance-b.distance);});
    var best=candidates[0]||null;
    if (!best||best.confidence<this.minConfidence) {
      if (this.lastSeenAt&&timestamp-this.lastSeenAt>this.maxLostMs) {
        if (this.state==='motion_verified'||this.state==='associated'||this.state==='setup_verified') this.lossCount++;
        this.state=this.required?'equipment_lost':'not_required';
        this.trackId=null;
        this.rejectionReason=this.required?'equipment_not_visible':null;
      }
      return this.snapshot();
    }
    this.lastSeenAt=timestamp;
    this.currentConfidence=best.confidence;
    var reach=Math.max(this.associationDistance,Math.max(Number(best.object.box&&best.object.box.w||0),Number(best.object.box&&best.object.box.h||0))*1.5+30);
    var associated=!!best.wrist&&best.distance<=reach;
    if (!associated) {
      this.state='visible_unassociated';
      this.rejectionReason='equipment_not_in_working_hand';
      this.previousObject=best.centre;
      this.previousWrist=best.wrist;
      return this.snapshot();
    }
    this.lastAssociatedAt=timestamp;
    var objectMove=vector(this.previousObject,best.centre),wristMove=vector(this.previousWrist,best.wrist);
    var objectDistance=magnitude(objectMove),wristDistance=magnitude(wristMove);
    var correlated=false;
    if (objectDistance>=this.motionThreshold||wristDistance>=this.userMotionThreshold) {
      this.motionSamples++;
      var direction=cosine(objectMove,wristMove);
      var ratio=wristDistance?objectDistance/wristDistance:0;
      correlated=objectDistance>=this.motionThreshold&&wristDistance>=this.userMotionThreshold&&direction>=0.55&&ratio>=0.25&&ratio<=2.5;
      if (correlated) this.correlatedSamples++; else if (wristDistance>=this.userMotionThreshold&&objectDistance<this.motionThreshold) this.staticMismatchSamples++;
    }
    this.previousObject=best.centre;
    this.previousWrist=best.wrist;
    this.trackId=best.object.trackId==null?null:best.object.trackId;
    if (this.staticMismatchSamples>=3&&this.correlatedSamples===0) {
      this.state='static_equipment_rejected';
      this.rejectionReason='equipment_static_while_user_moves';
    } else if (this.correlatedSamples>=2) {
      this.state='motion_verified';
      this.rejectionReason=null;
    } else {
      this.state='associated';
      this.rejectionReason=null;
    }
    return Object.assign(this.snapshot(),{correlatedThisFrame:correlated});
  };
  EquipmentEngine.prototype.isEquipmentVerified=function(at){
    at=Number(at||nowMs());
    var scanFresh=!!(this.setupEvidence&&this.setupEvidence.expiresAt>at);
    return this.state==='motion_verified'||(scanFresh&&(this.state==='setup_verified'||this.state==='associated'||this.state==='motion_verified'));
  };
  EquipmentEngine.prototype.loadSnapshot=function(){
    var e=this.loadEvidence||{mode:'NONE',verified:false,value:null,unit:null};
    return {mode:e.mode,verified:!!e.verified,value:e.value==null?null:e.value,unit:e.unit||null,confidence:e.confidence||0,evidenceId:e.evidenceId||null,provider:e.provider||null};
  };
  EquipmentEngine.prototype.completionClaim=function(){
    var equipmentVerified=this.isEquipmentVerified();
    var load=this.loadSnapshot();
    return {
      equipmentVerified:equipmentVerified,
      loadVerified:load.verified,
      allowedClaim:equipmentVerified?(load.verified?'Live movement and equipment use were verified; the recorded load was separately verified.':'Live movement and equipment use were verified; the selected load was not verified.'):'Movement may be evaluated, but required equipment use was not verified.',
      forbiddenClaims:load.verified?['perfect_form','safe_maximum_load']:['verified_load','exact_weight','perfect_form','safe_maximum_load']
    };
  };
  EquipmentEngine.prototype.snapshot=function(){
    return {
      sessionId:this.sessionId,expected:this.expected.slice(),required:this.required,state:this.state,
      equipmentVerified:this.isEquipmentVerified(),currentConfidence:this.currentConfidence,trackId:this.trackId,
      motionSamples:this.motionSamples,correlatedSamples:this.correlatedSamples,staticMismatchSamples:this.staticMismatchSamples,
      lossCount:this.lossCount,rejectionReason:this.rejectionReason,
      setupEvidence:this.setupEvidence?serialiseEvidence(this.setupEvidence):null,
      load:this.loadSnapshot()
    };
  };

  return {
    version:'equipment-engine-v3-1',
    EQUIPMENT:EQUIPMENT.slice(),
    LOAD_MODES:LOAD_MODES.slice(),
    normaliseClass:normaliseClass,
    EquipmentEngine:EquipmentEngine,
    create:function(options){return new EquipmentEngine(options||{});}
  };
});
