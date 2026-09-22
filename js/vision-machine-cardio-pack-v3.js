/* VISION Live Proof V3 — cable/machine/cardio engineering pack.
   Generic movement-family contracts remain brand-neutral and production-gated
   until physical qualification. Machine/load metrics are never inferred from
   body pose alone. */
(function (root) {
  'use strict';
  var attempts=0,installed=false;
  function install(){
    if(installed)return true;
    var V=root.VISION||{},live=V.liveV3,classifier=V.exerciseClassifierV3,eq=V.equipmentEngineV3;
    if(!live||!live.registry||!classifier||!Array.isArray(classifier.PATTERNS)||!eq)return false;
    function kp(pose,name){return live.kp(pose,name);}
    function angle(a,b,c){return live.angle(a,b,c);}
    function elbow(pose,side){return angle(kp(pose,side+'_shoulder'),kp(pose,side+'_elbow'),kp(pose,side+'_wrist'));}
    function knee(pose,side){return angle(kp(pose,side+'_hip'),kp(pose,side+'_knee'),kp(pose,side+'_ankle'));}
    function hip(pose,side){return angle(kp(pose,side+'_shoulder'),kp(pose,side+'_hip'),kp(pose,side+'_knee'));}
    function shoulder(pose,side){return angle(kp(pose,side+'_hip'),kp(pose,side+'_shoulder'),kp(pose,side+'_wrist'));}
    function span(pose){var l=kp(pose,'left_wrist'),r=kp(pose,'right_wrist'),ls=kp(pose,'left_shoulder'),rs=kp(pose,'right_shoulder');if(!l||!r||!ls||!rs)return null;return 100*Math.abs(l.x-r.x)/Math.max(1,Math.abs(ls.x-rs.x));}
    function motionSignal(names,min){var prev=null,lastAt=0;return function(pose,now){if(!pose)return false;var pts=names.map(function(n){var p=kp(pose,n);return p?{name:n,x:p.x,y:p.y}:null;}).filter(Boolean);if(!pts.length)return false;now=Number(now||0);if(!prev||!lastAt||now-lastAt>2000){prev=Object.create(null);pts.forEach(function(p){prev[p.name]={x:p.x,y:p.y};});lastAt=now;return false;}var d=0,matched=0;pts.forEach(function(p){var q=prev[p.name];if(q){d+=Math.hypot(p.x-q.x,p.y-q.y);matched++;}});prev=Object.create(null);pts.forEach(function(p){prev[p.name]={x:p.x,y:p.y};});lastAt=now;return matched>0&&d/matched>=min;};}
    function rep(id,name,equipment,family,metric,opts){live.registry[id]=Object.assign({exerciseId:id,displayName:name,verifierId:'v3-'+id.replace(/_/g,'-'),verifierVersion:'1',mode:'reps',movementFamily:family,workingLandmarks:['shoulder','elbow','wrist'],metric:metric,minAmplitude:35,minRepMs:450,maxRepMs:15000,minVisibility:.68,lowerBody:false,requiredEquipment:[equipment],loadVerificationModes:eq.LOAD_MODES.slice(),productionEnabled:false,engineeringReady:true,realCameraQualified:false,qualificationLevel:'ENGINEERING_READY',formSignals:[],completionClaim:'Live movement and required machine/handle use may be verified; resistance is only claimed from separate evidence.',forbiddenClaims:['perfect_form','verified_resistance_without_evidence','verified_distance','verified_calories']},opts||{});}
    function duration(id,name,equipment,names,min,claim){live.registry[id]={exerciseId:id,displayName:name,verifierId:'v3-'+id.replace(/_/g,'-'),verifierVersion:'1',mode:'duration',movementFamily:'CYCLICAL_CARDIO',workingLandmarks:['shoulder','hip','knee','ankle'],movementJoints:names,durationSignal:motionSignal(names,min||3),minTravel:Math.max(.02,(min||3)/100),requiredEquipment:equipment?[equipment]:[],loadVerificationModes:eq.LOAD_MODES.slice(),productionEnabled:false,engineeringReady:true,realCameraQualified:false,qualificationLevel:'ENGINEERING_READY',minVisibility:.55,completionClaim:claim||'Continuous movement for the required duration may be verified.',forbiddenClaims:['verified_distance_without_display','verified_speed_without_display','verified_calories','perfect_technique']};}

    rep('cable_curl','Cable Curl','cable_handle','ELBOW_FLEXION',elbow,{minAmplitude:45});
    rep('rope_curl','Rope Curl','cable_handle','ELBOW_FLEXION',elbow,{minAmplitude:45,bilateral:true});
    rep('triceps_pushdown','Triceps Pushdown','cable_handle','ELBOW_EXTENSION',elbow,{minAmplitude:40,bilateral:true});
    rep('overhead_cable_extension','Overhead Cable Extension','cable_handle','ELBOW_EXTENSION',elbow,{minAmplitude:40,bilateral:true});
    rep('cable_row','Cable Row','cable_handle','HORIZONTAL_PULL',elbow,{minAmplitude:40,bilateral:true});
    rep('seated_cable_row','Seated Cable Row','cable_machine','HORIZONTAL_PULL',elbow,{minAmplitude:40,bilateral:true});
    rep('lat_pulldown','Lat Pulldown','cable_machine','VERTICAL_PULL',elbow,{minAmplitude:45,bilateral:true});
    rep('straight_arm_pulldown','Straight-arm Pulldown','cable_handle','VERTICAL_PULL',shoulder,{minAmplitude:45,bilateral:true});
    rep('cable_chest_press','Cable Chest Press','cable_handle','HORIZONTAL_PUSH',elbow,{minAmplitude:45,bilateral:true});
    rep('cable_fly','Cable Fly','cable_handle','HORIZONTAL_PUSH',span,{workingLandmarks:['shoulder','wrist'],minAmplitude:45,bilateral:false});
    rep('face_pull','Face Pull','cable_handle','HORIZONTAL_PULL',elbow,{minAmplitude:35,bilateral:true});
    rep('cable_lateral_raise','Cable Lateral Raise','cable_handle','SHOULDER_RAISE',shoulder,{minAmplitude:45});
    rep('cable_front_raise','Cable Front Raise','cable_handle','SHOULDER_RAISE',shoulder,{minAmplitude:45});
    rep('cable_kickback','Cable Kickback','cable_handle','ELBOW_EXTENSION',elbow,{minAmplitude:35});
    rep('cable_woodchop','Cable Woodchop','cable_handle','TRUNK_ROTATION',shoulder,{minAmplitude:40});
    rep('cable_crunch','Cable Crunch','cable_handle','TRUNK_FLEXION',hip,{workingLandmarks:['shoulder','hip','knee'],minAmplitude:30});

    rep('machine_chest_press','Machine Chest Press','selectorised_machine','HORIZONTAL_PUSH',elbow,{minAmplitude:45,bilateral:true});
    rep('machine_shoulder_press','Machine Shoulder Press','selectorised_machine','VERTICAL_PUSH',elbow,{minAmplitude:45,bilateral:true});
    rep('machine_row','Machine Row','selectorised_machine','HORIZONTAL_PULL',elbow,{minAmplitude:40,bilateral:true});
    rep('machine_pulldown','Machine Pulldown','selectorised_machine','VERTICAL_PULL',elbow,{minAmplitude:45,bilateral:true});
    rep('leg_press','Leg Press','selectorised_machine','SQUAT_PATTERN',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:45,lowerBody:true,bilateral:true});
    rep('leg_extension','Leg Extension','selectorised_machine','KNEE_EXTENSION',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:40,lowerBody:true,bilateral:true});
    rep('leg_curl','Leg Curl','selectorised_machine','KNEE_FLEXION',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:40,lowerBody:true,bilateral:true});
    rep('machine_calf_raise','Machine Calf Raise','selectorised_machine','CALF_RAISE',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:8,lowerBody:true});
    rep('assisted_pullup','Assisted Pull-up','selectorised_machine','VERTICAL_PULL',elbow,{minAmplitude:45,bilateral:true});
    rep('smith_squat','Smith-machine Squat','plate_loaded_machine','SQUAT_PATTERN',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:45,lowerBody:true,bilateral:true});
    rep('smith_press','Smith-machine Press','plate_loaded_machine','HORIZONTAL_PUSH',elbow,{minAmplitude:45,bilateral:true});
    rep('smith_lunge','Smith-machine Lunge','plate_loaded_machine','LUNGE_PATTERN',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:40,lowerBody:true});
    rep('smith_rdl','Smith-machine Romanian Deadlift','plate_loaded_machine','HINGE_PATTERN',hip,{workingLandmarks:['shoulder','hip','knee'],minAmplitude:35,lowerBody:true,bilateral:true});

    duration('walking','Walking',null,['left_ankle','right_ankle','left_hip','right_hip'],2.5);
    duration('running','Running',null,['left_ankle','right_ankle','left_knee','right_knee'],4);
    duration('treadmill','Treadmill','selectorised_machine',['left_ankle','right_ankle','left_knee','right_knee'],3.5);
    duration('stationary_bike','Stationary Bike','selectorised_machine',['left_knee','right_knee','left_ankle','right_ankle'],2.5);
    duration('rowing_machine','Rowing Machine','selectorised_machine',['left_wrist','right_wrist','left_hip','right_hip'],3);
    duration('skipping_rope','Skipping Rope','cable_handle',['left_wrist','right_wrist','left_ankle','right_ankle'],3.5);
    duration('stair_stepping','Stair Stepping','selectorised_machine',['left_knee','right_knee','left_ankle','right_ankle'],2.5);
    duration('general_conditioning','General Conditioning',null,['left_wrist','right_wrist','left_ankle','right_ankle'],3);
    duration('shadowboxing_duration','Shadowboxing',null,['left_wrist','right_wrist','left_shoulder','right_shoulder'],4);
    duration('soccer_movement','Soccer Movement Drill',null,['left_ankle','right_ankle','left_knee','right_knee'],3);
    duration('agility_drill','Agility Drill',null,['left_ankle','right_ankle','left_hip','right_hip'],4);
    duration('dance_cardio','Dance/Cardio',null,['left_wrist','right_wrist','left_ankle','right_ankle'],3);

    var patterns=[
      ['cable_curl',/cable\s*curl/],['rope_curl',/rope\s*curl/],['triceps_pushdown',/triceps?\s*push.?down/],['overhead_cable_extension',/overhead\s*cable\s*extension/],['seated_cable_row',/seated\s*cable\s*row/],['cable_row',/(standing\s*)?cable\s*row/],['lat_pulldown',/lat\s*pull.?down/],['straight_arm_pulldown',/straight[ -]?arm\s*pull.?down/],['cable_chest_press',/cable\s*chest\s*press/],['cable_fly',/cable\s*fly/],['face_pull',/face\s*pull/],['cable_lateral_raise',/cable\s*lateral\s*raise/],['cable_front_raise',/cable\s*front\s*raise/],['cable_kickback',/cable\s*kickback/],['cable_woodchop',/cable\s*wood.?chop/],['cable_crunch',/cable\s*crunch/],
      ['machine_chest_press',/machine\s*chest\s*press/],['machine_shoulder_press',/machine\s*shoulder\s*press/],['machine_row',/machine\s*(seated\s*)?row/],['machine_pulldown',/machine\s*(lat\s*)?pull.?down/],['leg_press',/leg\s*press/],['leg_extension',/leg\s*extension/],['leg_curl',/leg\s*curl/],['machine_calf_raise',/machine\s*calf\s*raise/],['assisted_pullup',/assisted\s*pull.?up/],['smith_squat',/smith\s*(machine\s*)?squat/],['smith_press',/smith\s*(machine\s*)?(bench|chest|shoulder)?\s*press/],['smith_lunge',/smith\s*(machine\s*)?lunge/],['smith_rdl',/smith\s*(machine\s*)?(rdl|romanian\s*deadlift)/],
      ['stationary_bike',/(stationary|exercise)\s*bike/],['rowing_machine',/rowing\s*machine|indoor\s*row/],['skipping_rope',/(skipping|jump)\s*rope/],['stair_stepping',/(stair\s*(stepper|climber)|step\s*machine)/],['treadmill',/treadmill/],['running',/\brunning\b|\bjogging\b/],['walking',/\bwalking\b/],['shadowboxing_duration',/shadow\s*box/],['soccer_movement',/soccer\s*(movement|footwork|drill)/],['agility_drill',/agility\s*drill/],['dance_cardio',/(dance|aerobic)\s*(cardio|workout)/],['general_conditioning',/general\s*conditioning|conditioning\s*circuit/]
    ];
    var existing=Object.create(null);classifier.PATTERNS.forEach(function(p){existing[p.ex]=true;});for(var i=patterns.length-1;i>=0;i--)if(!existing[patterns[i][0]])classifier.PATTERNS.unshift({ex:patterns[i][0],re:patterns[i][1]});
    var check=live.validateRegistry&&live.validateRegistry();
    if(check&&check.ok===false){
      patterns.forEach(function(p){delete live.registry[p[0]];});
      V.machineCardioPackV3={version:'machine-cardio-pack-v3-1',installed:false,error:'registry_invalid',invalid:Object.keys(check.errors||{})};
      throw new Error('machine_cardio_registry_invalid');
    }
    V.machineCardioPackV3={version:'machine-cardio-pack-v3-1',installed:true,exercises:patterns.map(function(p){return p[0];})};installed=true;return true;
  }
  function wait(){if(install())return;attempts++;if(attempts<400)setTimeout(wait,25);else{root.VISION=root.VISION||{};root.VISION.machineCardioPackV3={version:'machine-cardio-pack-v3-1',installed:false,error:'dependencies_unavailable'};}}
  wait();
})(typeof window!=='undefined'?window:globalThis);
