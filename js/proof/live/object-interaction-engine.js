/* Vision object interaction engine.
   Consumes detector/tracker output; it does not invent detections. With no real
   object tracks it returns insufficient evidence and all proof remains fail-closed. */
(function(root){
'use strict';
function centre(box){return box?{x:Number(box.x||0)+Number(box.w||0)/2,y:Number(box.y||0)+Number(box.h||0)/2}:null;}
function dist(a,b){return a&&b?Math.hypot(a.x-b.x,a.y-b.y):Infinity;}
function inside(p,z){return !!(p&&z&&p.x>=z.x&&p.x<=z.x+z.w&&p.y>=z.y&&p.y<=z.y+z.h);}
function kp(pose,name,min){var a=pose&&pose.keypoints||[];for(var i=0;i<a.length;i++)if(a[i].name===name&&Number(a[i].score||0)>=(min||.3))return a[i];return null;}
function ObjectInteractionEngine(opts){opts=opts||{};this.objectClass=String(opts.objectClass||'').toLowerCase();this.actorPoints=opts.actorPoints||['left_wrist','right_wrist'];this.targetZone=opts.targetZone||null;this.maxAssociationPx=Number(opts.maxAssociationPx||90);this.maxGapMs=Number(opts.maxGapMs||300);this.minTrackFrames=Number(opts.minTrackFrames||3);this.reset();}
ObjectInteractionEngine.prototype.reset=function(){this.tracks={};this.lastAt=0;this.contacts=[];this.outcomes=[];this.lastContactAt=0;this.prevObject=null;};
ObjectInteractionEngine.prototype._objects=function(frame){var cls=this.objectClass;return(frame&&frame.objects||[]).filter(function(o){return String(o.class||'').toLowerCase()===cls&&Number(o.score||0)>=.35&&o.box;});};
ObjectInteractionEngine.prototype.update=function(frame,pose,now){now=Number(now||Date.now());var objects=this._objects(frame);var actor=[];for(var i=0;i<this.actorPoints.length;i++){var p=kp(pose,this.actorPoints[i]);if(p)actor.push({name:this.actorPoints[i],point:p});}
 var best=null,bestD=Infinity,bestActor=null;for(var j=0;j<objects.length;j++){var c=centre(objects[j].box);for(var k=0;k<actor.length;k++){var d=dist(c,actor[k].point);if(d<bestD){bestD=d;best=objects[j];bestActor=actor[k];}}}
 var visible=!!best,associated=visible&&bestD<=this.maxAssociationPx,trackId=visible?(best.trackId==null?'untracked':String(best.trackId)):null;
 if(visible){var t=this.tracks[trackId]||(this.tracks[trackId]={frames:0,firstAt:now,lastAt:now,lastPoint:null,travel:0,enteredTarget:false});var c2=centre(best.box);t.frames++;t.lastAt=now;if(t.lastPoint)t.travel+=dist(c2,t.lastPoint);t.lastPoint=c2;if(this.targetZone&&inside(c2,this.targetZone)&&!t.enteredTarget){t.enteredTarget=true;this.outcomes.push({type:'target_entry',at:now,trackId:trackId,confidence:Number(best.score||0)});} }
 var contact=false;if(associated&&(!this.lastContactAt||now-this.lastContactAt>220)){contact=true;this.lastContactAt=now;this.contacts.push({at:now,trackId:trackId,actorPoint:bestActor&&bestActor.name,distancePx:bestD,confidence:Math.min(Number(best.score||0),Number(bestActor&&bestActor.point.score||0))});}
 this.prevObject=visible?centre(best.box):null;this.lastAt=now;
 return{objectVisible:visible,objectConfidence:visible?Number(best.score||0):0,associated:associated,associationDistancePx:isFinite(bestD)?bestD:null,contactEvent:contact,targetEntered:visible&&this.targetZone?inside(centre(best.box),this.targetZone):false,trackId:trackId,evidenceSufficient:visible&&associated&&trackId!=='untracked'&&this.tracks[trackId].frames>=this.minTrackFrames};};
ObjectInteractionEngine.prototype.summary=function(){var qualified=Object.keys(this.tracks).filter(function(id){return id!=='untracked'&&this.tracks[id].frames>=this.minTrackFrames;},this);return{objectClass:this.objectClass,qualifiedTracks:qualified.length,contacts:this.contacts.slice(),targetOutcomes:this.outcomes.slice(),evidenceSufficient:qualified.length>0&&this.contacts.length>0,targetEvidenceSufficient:qualified.length>0&&this.outcomes.length>0};};
function create(opts){return new ObjectInteractionEngine(opts);}
root.VISION=root.VISION||{};root.VISION.objectInteraction={VERSION:'2026.07.26.1',create:create,inside:inside,centre:centre};
})(typeof window!=='undefined'?window:globalThis);
