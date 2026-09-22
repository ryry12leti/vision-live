/* VISION Live Proof V3 — free-weight engineering pack.
   Adds engineering-ready, production-gated movement contracts for dumbbell,
   barbell, kettlebell and resistance-band tasks. Required equipment remains a
   hard evidence dependency; load claims remain separate from rep claims. */
(function (root) {
  'use strict';
  var attempts=0,installed=false;
  function install(){
    if(installed)return true;
    var V=root.VISION||{},live=V.liveV3,classifier=V.exerciseClassifierV3,eq=V.equipmentEngineV3;
    if(!live||!live.registry||typeof live.angle!=='function'||typeof live.kp!=='function'||!classifier||!Array.isArray(classifier.PATTERNS)||!eq)return false;
    function kp(pose,name){return live.kp(pose,name);}
    function angle(a,b,c){return live.angle(a,b,c);}
    function elbow(pose,side){return angle(kp(pose,side+'_shoulder'),kp(pose,side+'_elbow'),kp(pose,side+'_wrist'));}
    function knee(pose,side){return angle(kp(pose,side+'_hip'),kp(pose,side+'_knee'),kp(pose,side+'_ankle'));}
    function hip(pose,side){return angle(kp(pose,side+'_shoulder'),kp(pose,side+'_hip'),kp(pose,side+'_knee'));}
    function shoulderRaise(pose,side){return angle(kp(pose,side+'_hip'),kp(pose,side+'_shoulder'),kp(pose,side+'_wrist'));}
    function span(pose){var l=kp(pose,'left_wrist'),r=kp(pose,'right_wrist'),ls=kp(pose,'left_shoulder'),rs=kp(pose,'right_shoulder');if(!l||!r||!ls||!rs)return null;var sw=Math.max(1,Math.abs(ls.x-rs.x));return 100*Math.abs(l.x-r.x)/sw;}
    function makeMotionSignal(names,min){var prev=null,lastAt=0;return function(pose,now){if(!pose)return false;now=Number(now||0);var pts=names.map(function(n){return kp(pose,n);}).filter(Boolean);if(!pts.length)return false;var x=pts.reduce(function(a,p){return a+p.x;},0)/pts.length,y=pts.reduce(function(a,p){return a+p.y;},0)/pts.length;if(!prev||!lastAt||now-lastAt>2000){prev={x:x,y:y};lastAt=now;return false;}var d=Math.hypot(x-prev.x,y-prev.y);prev={x:x,y:y};lastAt=now;return d>=min;};}
    function rep(id,name,equipment,family,metric,opts){
      live.registry[id]=Object.assign({exerciseId:id,displayName:name,verifierId:'v3-'+id.replace(/_/g,'-'),verifierVersion:'1',mode:'reps',movementFamily:family,
        workingLandmarks:['shoulder','elbow','wrist'],metric:metric,minAmplitude:35,minRepMs:450,maxRepMs:15000,minVisibility:.7,lowerBody:false,
        requiredEquipment:[equipment],loadVerificationModes:eq.LOAD_MODES.slice(),productionEnabled:false,engineeringReady:true,realCameraQualified:false,
        qualificationLevel:'ENGINEERING_READY',formSignals:[],completionClaim:'Live movement and required equipment use may be verified; load is only claimed when separate load evidence succeeds.',
        forbiddenClaims:['perfect_form','safe_maximum_load','verified_load_without_evidence']},opts||{});
    }
    function duration(id,name,equipment,signal){
      live.registry[id]={exerciseId:id,displayName:name,verifierId:'v3-'+id.replace(/_/g,'-'),verifierVersion:'1',mode:'duration',movementFamily:'CARRY_OR_WALK',
        workingLandmarks:['shoulder','hip','wrist','ankle'],movementJoints:['left_wrist','right_wrist','left_ankle','right_ankle'],durationSignal:signal,minTravel:.03,
        requiredEquipment:[equipment],loadVerificationModes:eq.LOAD_MODES.slice(),productionEnabled:false,engineeringReady:true,realCameraQualified:false,
        qualificationLevel:'ENGINEERING_READY',minVisibility:.6,completionClaim:'Continuous loaded movement may be verified; carried load is only claimed when separately verified.',
        forbiddenClaims:['verified_distance','verified_load_without_evidence','perfect_form','safe_maximum_load']};
    }

    rep('concentration_curl','Concentration Curl','dumbbell','ELBOW_FLEXION',elbow,{minAmplitude:45,acceptedViews:['side','front_angle']});
    rep('arnold_press','Arnold Press','dumbbell','VERTICAL_PUSH',elbow,{minAmplitude:45,bilateral:true});
    rep('reverse_fly','Reverse Fly','dumbbell','HORIZONTAL_PULL',shoulderRaise,{minAmplitude:35,bilateral:true});
    rep('floor_press','Dumbbell Floor Press','dumbbell','HORIZONTAL_PUSH',elbow,{minAmplitude:45,bilateral:true,acceptedViews:['side','front_angle']});
    rep('one_arm_row','One-arm Dumbbell Row','dumbbell','HORIZONTAL_PULL',elbow,{minAmplitude:45,acceptedViews:['side','front_angle']});
    rep('dumbbell_squat','Dumbbell Squat','dumbbell','SQUAT_PATTERN',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:45,lowerBody:true});
    rep('weighted_split_squat','Weighted Split Squat','dumbbell','LUNGE_PATTERN',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:40,lowerBody:true});
    rep('triceps_kickback','Dumbbell Triceps Kickback','dumbbell','ELBOW_EXTENSION',elbow,{minAmplitude:40,acceptedViews:['side','front_angle']});
    rep('weighted_calf_raise','Weighted Calf Raise','dumbbell','CALF_RAISE',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:8,lowerBody:true});
    duration('farmer_carry','Farmer Carry','dumbbell',makeMotionSignal(['left_wrist','right_wrist','left_ankle','right_ankle'],3));
    duration('suitcase_carry','Suitcase Carry','dumbbell',makeMotionSignal(['left_wrist','right_wrist','left_ankle','right_ankle'],3));

    rep('kettlebell_deadlift','Kettlebell Deadlift','kettlebell','HINGE_PATTERN',hip,{workingLandmarks:['shoulder','hip','knee'],minAmplitude:35,lowerBody:true});
    rep('kettlebell_goblet_squat','Kettlebell Goblet Squat','kettlebell','SQUAT_PATTERN',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:45,lowerBody:true});
    rep('kettlebell_swing','Kettlebell Swing','kettlebell','WHOLE_BODY_CONDITIONING',hip,{workingLandmarks:['shoulder','hip','knee'],minAmplitude:40,minRepMs:500,maxRepMs:8000,lowerBody:true});

    rep('barbell_squat','Barbell Squat','barbell','SQUAT_PATTERN',knee,{workingLandmarks:['hip','knee','ankle'],minAmplitude:45,lowerBody:true,bilateral:true});
    rep('barbell_bench_press','Barbell Bench Press','barbell','HORIZONTAL_PUSH',elbow,{minAmplitude:45,bilateral:true,acceptedViews:['side','front_angle']});
    rep('barbell_deadlift','Barbell Deadlift','barbell','HINGE_PATTERN',hip,{workingLandmarks:['shoulder','hip','knee'],minAmplitude:35,lowerBody:true,bilateral:true});
    rep('barbell_overhead_press','Barbell Overhead Press','barbell','VERTICAL_PUSH',elbow,{minAmplitude:45,bilateral:true});
    rep('barbell_row','Barbell Row','barbell','HORIZONTAL_PULL',elbow,{minAmplitude:40,bilateral:true,acceptedViews:['side','front_angle']});

    rep('band_curl','Resistance-band Curl','resistance_band','ELBOW_FLEXION',elbow,{minAmplitude:45,bilateral:true});
    rep('band_row','Resistance-band Row','resistance_band','HORIZONTAL_PULL',elbow,{minAmplitude:40,bilateral:true});
    rep('band_press','Resistance-band Press','resistance_band','HORIZONTAL_PUSH',elbow,{minAmplitude:45,bilateral:true});
    rep('band_lateral_raise','Band Lateral Raise','resistance_band','SHOULDER_RAISE',shoulderRaise,{minAmplitude:45,bilateral:true});
    rep('band_pull_apart','Band Pull-apart','resistance_band','HORIZONTAL_PULL',function(pose){return span(pose);},{workingLandmarks:['shoulder','wrist'],minAmplitude:55,bilateral:false});

    var patterns=[
      ['concentration_curl',/concentration\s*curl/],['arnold_press',/arnold\s*press/],['reverse_fly',/reverse\s*fly/],['floor_press',/(dumbbell\s*)?floor\s*press/],
      ['one_arm_row',/(one[ -]?arm|single[ -]?arm)\s*(dumbbell\s*)?row/],['dumbbell_squat',/dumbbell\s*squat/],['weighted_split_squat',/(dumbbell|weighted)\s*split\s*squat/],
      ['triceps_kickback',/(dumbbell\s*)?triceps?\s*kickback/],['weighted_calf_raise',/(dumbbell|weighted)\s*calf\s*raise/],['farmer_carry',/farmer.?s?\s*(carry|walk)/],['suitcase_carry',/suitcase\s*(carry|walk)/],
      ['kettlebell_deadlift',/kettlebell\s*deadlift/],['kettlebell_goblet_squat',/kettlebell\s*(goblet\s*)?squat/],['kettlebell_swing',/kettlebell\s*swing/],
      ['barbell_squat',/barbell\s*(back\s*|front\s*)?squat/],['barbell_bench_press',/barbell\s*bench\s*press/],['barbell_deadlift',/barbell\s*deadlift/],
      ['barbell_overhead_press',/barbell\s*(overhead|shoulder|military)\s*press/],['barbell_row',/barbell\s*(bent[ -]?over\s*)?row/],
      ['band_curl',/(resistance\s*)?band\s*curl/],['band_row',/(resistance\s*)?band\s*row/],['band_press',/(resistance\s*)?band\s*(chest\s*)?press/],
      ['band_lateral_raise',/(resistance\s*)?band\s*lateral\s*raise/],['band_pull_apart',/(resistance\s*)?band\s*pull[ -]?apart/]
    ];
    var existing=Object.create(null);classifier.PATTERNS.forEach(function(p){existing[p.ex]=true;});
    for(var i=patterns.length-1;i>=0;i--){if(!existing[patterns[i][0]])classifier.PATTERNS.unshift({ex:patterns[i][0],re:patterns[i][1]});}
    var check=live.validateRegistry&&live.validateRegistry();
    if(check&&check.ok===false){
      patterns.forEach(function(p){delete live.registry[p[0]];});
      V.freeWeightPackV3={version:'free-weight-pack-v3-1',installed:false,error:'registry_invalid',invalid:Object.keys(check.errors||{})};
      throw new Error('free_weight_registry_invalid');
    }
    V.freeWeightPackV3={version:'free-weight-pack-v3-1',installed:true,exercises:patterns.map(function(p){return p[0];})};installed=true;return true;
  }
  function wait(){if(install())return;attempts++;if(attempts<400)setTimeout(wait,25);else{root.VISION=root.VISION||{};root.VISION.freeWeightPackV3={version:'free-weight-pack-v3-1',installed:false,error:'dependencies_unavailable'};}}
  wait();
})(typeof window!=='undefined'?window:globalThis);
