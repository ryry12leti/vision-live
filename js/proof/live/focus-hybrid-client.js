/* VISION Study/Business Focus + Hybrid Proof browser client.
   The browser reports privacy-safe observations and authoritative evidence IDs.
   Stored task contracts, targets, required components, expiry, pass/fail and the
   reward latch are owned by server RPCs. Screen sharing is explicit opt-in and
   is always stopped on teardown. */
(function(root,factory){
  var api=factory(root||globalThis);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.VISION=root.VISION||{};root.VISION.focusHybridClient=api;}
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';

  function now(){return Date.now();}
  function rpc(client,name,args){
    if(!client||typeof client.rpc!=='function')return Promise.reject(new Error('supabase_client_required'));
    return client.rpc(name,args||{}).then(function(result){
      if(result&&result.error)throw result.error;
      return result&&Object.prototype.hasOwnProperty.call(result,'data')?result.data:result;
    });
  }
  function boundedInt(v,min,max,fallback){
    v=Math.floor(Number(v));
    return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
  }
  function safeObject(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}

  function FocusSessionController(options){
    options=options||{};
    this.client=options.client||((root.VISION||{}).sb)||null;
    this.document=options.document||root.document||null;
    this.window=options.window||root;
    this.mediaDevices=options.mediaDevices||(root.navigator&&root.navigator.mediaDevices)||null;
    this.taskId=null;this.domain='generic';this.sessionId=null;this.targetSeconds=0;this.checkpointCount=0;this.requireMaterial=false;
    this.startedAt=0;this.activeMs=0;this.lastActivityAt=0;this.lastSampleAt=0;this.inactiveMs=0;
    this.materialPresent=false;this.screenStream=null;this.listeners=[];this.state='idle';this.checkpointsMet={};this.activityEvents=0;
    this.inactivityThresholdMs=boundedInt(options.inactivityThresholdMs,3000,300000,30000);
    this.lastServerSampleAt=0;this.serverSampleSeq=0;
    this.serverSampleIntervalMs=boundedInt(options.serverSampleIntervalMs,1000,60000,2000);
  }

  FocusSessionController.prototype.start=async function(config){
    if(this.state!=='idle'&&this.state!=='stopped')throw new Error('focus_session_already_active');
    config=config||{};
    if(!config.taskId)throw new Error('focus_task_required');
    this.taskId=String(config.taskId);
    this.materialPresent=!!config.materialPresent;
    var data=await rpc(this.client,'focus_session_start_v2',{p_task_id:this.taskId,p_device:safeObject(config.device)});
    this.sessionId=String(data.session_id);
    this.domain=String(data.domain||'generic');
    this.targetSeconds=boundedInt(data.target_duration_seconds,60,14400,600);
    this.checkpointCount=boundedInt(data.checkpoint_count,1,6,1);
    this.requireMaterial=!!data.require_material;
    this.startedAt=now();
    this.lastActivityAt=this.startedAt;
    this.lastSampleAt=this.startedAt;
    this.state='active';
    this._bind();
    return this.snapshot();
  };

  FocusSessionController.prototype._bind=function(){
    var self=this;
    function onActivity(){self.markActivity('interaction');}
    function onVisibility(){self.sample();if(!(self.document&&self.document.hidden))self.markActivity('visible');}
    if(this.document&&this.document.addEventListener){
      ['pointerdown','keydown','input','scroll'].forEach(function(type){
        self.document.addEventListener(type,onActivity,{passive:true});
        self.listeners.push([self.document,type,onActivity]);
      });
      this.document.addEventListener('visibilitychange',onVisibility);
      this.listeners.push([self.document,'visibilitychange',onVisibility]);
    }
    if(this.window&&this.window.addEventListener){
      this._pagehide=this.stop.bind(this,'pagehide');
      this.window.addEventListener('pagehide',this._pagehide);
      this.listeners.push([this.window,'pagehide',this._pagehide]);
    }
  };

  FocusSessionController.prototype._unbind=function(){
    this.listeners.forEach(function(item){
      try{item[0].removeEventListener(item[1],item[2]);}catch(_){}
    });
    this.listeners=[];
  };

  FocusSessionController.prototype.markActivity=function(kind){
    if(this.state!=='active')return false;
    this.sample();
    this.lastActivityAt=now();
    this.activityEvents++;
    this.lastActivityKind=String(kind||'interaction').slice(0,40);
    return true;
  };

  FocusSessionController.prototype.sample=function(at){
    if(this.state!=='active')return this.snapshot();
    at=Number(at||now());
    if(!this.lastSampleAt)this.lastSampleAt=at;
    var delta=Math.max(0,Math.min(5000,at-this.lastSampleAt));
    var visible=!(this.document&&this.document.hidden);
    var recent=at-this.lastActivityAt<=this.inactivityThresholdMs;
    if(visible&&recent)this.activeMs+=delta;else this.inactiveMs+=delta;
    this.lastSampleAt=at;
    this._streamSample(at,visible,visible&&recent);
    return this.snapshot();
  };

  // Fire-and-forget: append a server-timestamped evidence sample so the
  // eventual finish() has a real, server-recorded timeline to evaluate
  // instead of only the client-composed active_ms this controller has
  // always sent. Never awaited by callers, never throws, throttled so
  // frequent local sample() calls (every activity/visibility event) don't
  // flood the rate-limited RPC.
  FocusSessionController.prototype._streamSample=function(at,visible,active){
    if(!this.client||!this.sessionId)return;
    if(this.lastServerSampleAt&&at-this.lastServerSampleAt<this.serverSampleIntervalMs)return;
    this.lastServerSampleAt=at;
    var token=this.sessionId+':'+(++this.serverSampleSeq);
    rpc(this.client,'focus_session_sample_append_v1',{
      p_session_id:this.sessionId,
      p_present:true,
      p_active:!!active,
      p_visible:!!visible,
      p_material:this.materialPresent,
      p_client_sample_token:token
    }).catch(function(){});
  };

  FocusSessionController.prototype.setMaterialPresent=function(value){
    this.materialPresent=!!value;
    return this.materialPresent;
  };

  FocusSessionController.prototype.respondCheckpoint=async function(sequence){
    if(this.state!=='active'||!this.sessionId)throw new Error('focus_session_not_active');
    sequence=boundedInt(sequence,1,this.checkpointCount,0);
    if(!sequence)throw new Error('invalid_checkpoint');

    var data=await rpc(this.client,'focus_session_checkpoint_v1',{
      p_session_id:this.sessionId,
      p_sequence:sequence
    });

    // The server intentionally returns {ok:false,error:'too_early',...}
    // instead of throwing. The old client marked the checkpoint met anyway,
    // turning an explicit server rejection into local success. Only mutate
    // local evidence after an affirmative server acknowledgement.
    if(!data||data.ok!==true){
      var code=String((data&&data.error)||'checkpoint_not_verified');
      var error=new Error(code);
      error.code=code;
      error.availableInSeconds=boundedInt(data&&data.available_in_seconds,0,14400,0);
      error.sequence=sequence;
      throw error;
    }

    this.checkpointsMet[sequence]=true;
    this.markActivity('checkpoint');
    return data;
  };

  FocusSessionController.prototype.requestScreenShare=async function(consent){
    if(consent!==true)throw new Error('explicit_screen_share_consent_required');
    if(!this.mediaDevices||typeof this.mediaDevices.getDisplayMedia!=='function')throw new Error('screen_share_unavailable');
    if(this.screenStream)this.stopScreenShare();
    this.screenStream=await this.mediaDevices.getDisplayMedia({video:true,audio:false});
    var self=this,track=this.screenStream.getVideoTracks&&this.screenStream.getVideoTracks()[0];
    if(track&&track.addEventListener)track.addEventListener('ended',function(){
      if(self.screenStream)self.stopScreenShare();
    });
    this.markActivity('screen_share_started');
    return this.screenStream;
  };

  FocusSessionController.prototype.stopScreenShare=function(){
    try{
      (this.screenStream&&this.screenStream.getTracks?this.screenStream.getTracks():[]).forEach(function(t){t.stop();});
    }catch(_){}
    this.screenStream=null;
  };

  FocusSessionController.prototype.finish=async function(extra){
    if(this.state!=='active'||!this.sessionId)throw new Error('focus_session_not_active');
    this.sample();
    this.state='finishing';
    var summary={
      active_ms:Math.floor(this.activeMs),
      material_present:this.materialPresent,
      telemetry:Object.assign({
        activity_events:this.activityEvents,
        inactive_ms:Math.floor(this.inactiveMs),
        screen_share_used:!!this.screenStream,
        client_elapsed_ms:Math.max(0,now()-this.startedAt)
      },safeObject(extra&&extra.telemetry))
    };
    try{
      var data=await rpc(this.client,'focus_session_finish_v1',{
        p_session_id:this.sessionId,
        p_summary:summary
      });
      if(data&&data.ok===false){
        var code=String(data.error||'focus_finish_not_ready');
        var error=new Error(code);
        error.code=code;
        error.remainingSeconds=boundedInt(data.remaining_seconds,0,14400,0);
        throw error;
      }
      this.state='stopped';
      this.stopScreenShare();
      this._unbind();
      this.result=data;
      return data;
    }catch(error){
      this.state='active';
      throw error;
    }
  };

  FocusSessionController.prototype.stop=function(reason){
    if(this.state==='stopped')return;
    this.sample();
    this.stopScreenShare();
    this._unbind();
    this.state='stopped';
    this.stopReason=reason||'stopped';
  };

  FocusSessionController.prototype.snapshot=function(){
    return{
      state:this.state,
      sessionId:this.sessionId,
      taskId:this.taskId,
      domain:this.domain,
      targetSeconds:this.targetSeconds,
      activeMs:Math.floor(this.activeMs),
      inactiveMs:Math.floor(this.inactiveMs),
      activityEvents:this.activityEvents,
      materialPresent:this.materialPresent,
      requireMaterial:this.requireMaterial,
      screenSharing:!!this.screenStream,
      checkpointsMet:Object.keys(this.checkpointsMet).length,
      checkpointCount:this.checkpointCount
    };
  };

  function HybridProofClient(options){
    options=options||{};
    this.client=options.client||((root.VISION||{}).sb)||null;
    this.taskId=options.taskId?String(options.taskId):null;
  }
  HybridProofClient.prototype.bindTask=function(taskId){
    if(!taskId)throw new Error('hybrid_task_required');
    this.taskId=String(taskId);
    return this;
  };
  HybridProofClient.prototype.prepare=function(){
    if(!this.taskId)return Promise.reject(new Error('hybrid_task_required'));
    return rpc(this.client,'hybrid_prepare_v2',{p_task_id:this.taskId});
  };
  HybridProofClient.prototype.attachEvidence=function(componentId,evidenceId){
    if(!this.taskId)return Promise.reject(new Error('hybrid_task_required'));
    if(!componentId||!evidenceId)return Promise.reject(new Error('hybrid_evidence_required'));
    return rpc(this.client,'hybrid_attach_evidence_v2',{
      p_task_id:this.taskId,
      p_component_id:String(componentId).slice(0,60),
      p_evidence_id:String(evidenceId)
    });
  };
  HybridProofClient.prototype.status=function(){
    if(!this.taskId)return Promise.reject(new Error('hybrid_task_required'));
    return rpc(this.client,'hybrid_status_v2',{p_task_id:this.taskId});
  };
  HybridProofClient.prototype.claimLatch=function(){
    if(!this.taskId)return Promise.reject(new Error('hybrid_task_required'));
    return rpc(this.client,'hybrid_claim_reward_v2',{p_task_id:this.taskId});
  };
  HybridProofClient.prototype.completeFocusComponent=async function(focusResult,componentId){
    if(!focusResult||focusResult.evidence_state!=='ready_for_server_review'||!focusResult.session_id){
      throw new Error('focus_component_not_ready');
    }
    return this.attachEvidence(componentId||'focus_session',String(focusResult.session_id));
  };

  function createFocusPanel(controller,container){
    if(!container||!controller)throw new Error('focus_panel_target_required');
    container.innerHTML='';
    var panel=(container.ownerDocument||root.document).createElement('section');
    panel.setAttribute('data-vision-focus-panel','1');
    panel.innerHTML='<div class="focus-proof-state" role="status">Ready to verify focused work.</div><div class="focus-proof-actions"><button type="button" data-focus-activity>Still working</button><button type="button" data-focus-checkpoint>Checkpoint</button><button type="button" data-focus-finish>Finish session</button></div>';
    var status=panel.querySelector('.focus-proof-state');
    panel.querySelector('[data-focus-activity]').onclick=function(){
      controller.markActivity('manual_checkpoint');
      status.textContent='Activity recorded. Keep working.';
    };
    panel.querySelector('[data-focus-checkpoint]').onclick=async function(){
      var next=Object.keys(controller.checkpointsMet).length+1;
      try{
        await controller.respondCheckpoint(next);
        status.textContent='Checkpoint '+next+' verified.';
      }catch(error){
        status.textContent=error&&error.code==='too_early'
          ?'Checkpoint opens in '+String(error.availableInSeconds||1)+' seconds.'
          :'Checkpoint could not be verified.';
      }
    };
    panel.querySelector('[data-focus-finish]').onclick=async function(){
      status.textContent='Finalising with the server…';
      try{
        var result=await controller.finish();
        status.textContent=result.can_submit_for_review
          ?'Focused work process verified.'
          :'Session recorded, but more active work or checkpoints were required.';
      }catch(error){
        status.textContent=error&&error.code==='target_time_not_reached'
          ?'Keep working for '+String(error.remainingSeconds||1)+' more seconds.'
          :'Could not finalise. Check your connection and retry.';
      }
    };
    container.appendChild(panel);
    return panel;
  }

  return{
    version:'focus-hybrid-client-2.1',
    FocusSessionController:FocusSessionController,
    HybridProofClient:HybridProofClient,
    createFocusPanel:createFocusPanel,
    createFocus:function(options){return new FocusSessionController(options||{});},
    createHybrid:function(options){return new HybridProofClient(options||{});}
  };
});
