/* eslint-disable @typescript-eslint/no-unused-vars -- ES5 catch bindings cannot be omitted (pre-Safari 15). */
/* Staff desk: no React, no ES2018 syntax, no third-party scripts. */
(function (window, document, A) {
  "use strict";
  var root=document.getElementById("app");
  var KEY="asad:intake:staff:v1";
  var state={code:"",token:"",expiresAt:0,entries:[],selected:-1,busy:false,error:"",online:false,pollTimer:0,stopped:false,data:null};
  var verified={unchecked:"직원 확인 전",confirmed:"예약 증빙 확인",unclear:"예약 확인 불가",exempt:"예약 불요 업무 확인"};
  var issued={pending:"발권 판단 대기",held:"발권 보류",issued:"직원 발권 완료 기록"};
  var booking={yes:"예약함",no:"예약 안 함",unsure:"잘 모르겠음"};

  function notice(s,kind){return A.el("p",s,kind||"muted");}
  function panel(){return A.el("section",null,"panel");}
  function setError(s){state.error=s;render();}
  function auth(){return {"x-asad-intake-staff-token":state.token};}
  function resetLocal(){
    state.code="";state.token="";state.expiresAt=0;state.entries=[];state.selected=-1;
    state.online=false;state.busy=false;A.storageRemove(KEY);
  }
  function poll() {
    if(state.pollTimer){window.clearTimeout(state.pollTimer);state.pollTimer=0;}
    if(!state.code || !state.token || state.stopped)return;
    if(state.expiresAt<=Date.now()){
      resetLocal();setError("접수 세션이 만료됐습니다. 새 접수를 시작해 주세요.");return;
    }
    var pollingCode=state.code,pollingToken=state.token;
    A.request("GET","/api/intake/session?code="+pollingCode+"&t="+Date.now(),null,auth(),function(err,data,status){
      // A response from an ended session must never overwrite a new desk.
      if(state.stopped || state.code!==pollingCode || state.token!==pollingToken)return;
      if(status===401 || status===403 || status===404){
        resetLocal();setError("창구 세션이 종료됐습니다. 새 접수를 시작해 주세요.");return;
      }
      if(err || !data || !data.entries){
        var hadOnline=state.online;
        state.online=false;
        if(hadOnline || !state.error){state.error="실시간 연결이 불안정합니다. 자동으로 다시 확인합니다.";render();}
      }else{
        var previous=JSON.stringify(state.entries);
        var now=JSON.stringify(data.entries);
        var changed=previous!==now || !state.online || !!state.error;
        state.entries=data.entries;
        state.online=true;state.error="";
        if(changed)render();
      }
      state.pollTimer=window.setTimeout(poll,2200);
    });
  }
  function start(){
    if(state.busy)return;
    state.busy=true;state.error="";render();
    A.request("POST","/api/intake/session",{},null,function(err,data,status){
      state.busy=false;
      if(err || !data || !data.code || !data.staffToken || !data.expiresAt){
        state.error = status===503 ? "접수 서버에 연결할 수 없습니다. 저장소 설정 또는 서버 상태를 확인해 주세요. (HTTP 503)" :
          (err || "접수 세션 생성에 실패했습니다. 다시 눌러 주세요.");
        render();return;
      }
      state.code=data.code;state.token=data.staffToken;state.expiresAt=data.expiresAt;
      state.entries=[];state.selected=-1;state.online=false;state.error="";
      var saved=A.storageWrite(KEY,JSON.stringify({code:state.code,token:state.token,expiresAt:state.expiresAt}));
      if(!saved)state.error="이 브라우저는 탭 저장을 제한합니다. 새로고침하면 접수 세션을 복원할 수 없습니다.";
      render();poll();
    });
  }
  function end(){
    if(state.busy || !state.code)return;
    if(!window.confirm("접수 세션과 대기열을 서버에서 삭제할까요?"))return;
    state.busy=true;render();
    A.request("DELETE","/api/intake/session?code="+state.code,null,auth(),function(err,data,status){
      state.busy=false;
      if(err && status!==404){setError(err);return;}
      resetLocal();state.error="";render();
    });
  }
  function mark(seq,change){
    if(state.busy)return;
    state.busy=true;state.error="";render();
    var body={code:state.code,seq:seq};
    for(var k in change)if(Object.prototype.hasOwnProperty.call(change,k))body[k]=change[k];
    A.request("PATCH","/api/intake/session",body,auth(),function(err,data){
      state.busy=false;
      if(err || !data || !data.entries){setError(err || "확인 결과를 저장하지 못했습니다.");return;}
      state.entries=data.entries;state.error="";render();
    });
  }
  function copyLink(url,field){
    var ok=false;
    try{field.focus();field.select();ok=document.execCommand("copy");}catch(e){}
    if(ok)setError("iPad 연결 주소를 복사했습니다.");
    else setError("자동 복사가 불가능합니다. 주소 입력칸을 길게 눌러 복사해 주세요.");
  }
  function joinUrl(){
    return window.location.protocol+"//"+window.location.host+"/intake?desk="+encodeURIComponent(state.code);
  }
  function render(){
    A.clear(root);
    var title=A.intro("ASAD / STAFF DESK","실시간 방문 요청 접수",
      state.code?"iPad 연결 · 접수 내역 · 방문예약 직접 확인":"접수 시작 버튼을 누르면 QR과 창구 코드를 발급합니다.");
    root.appendChild(title);
    if(state.error){
      var statusNotice=notice(state.error,state.error.indexOf("복사")!==-1?"success":"alert");
      statusNotice.setAttribute("role",state.error.indexOf("복사")!==-1?"status":"alert");
      root.appendChild(statusNotice);
    }
    if(!state.code){
      var startPanel=panel();
      A.add(startPanel,A.el("h2","새 창구 세션 시작"),notice("고정 접근키 입력 없이 창구별 비밀 세션을 생성합니다. 직원 신원 인증을 대체하지는 않습니다."));
      var b=A.btn(state.busy?"서버 연결 확인 중…":"실시간 접수 시작",start,"btn primary");
      b.disabled=state.busy;
      startPanel.appendChild(b);
      if(state.busy)startPanel.appendChild(notice("서버에 연결하는 중입니다. 잠시 후 결과가 표시됩니다.","muted"));
      root.appendChild(startPanel);return;
    }
    var connected=panel(),row=A.el("div",null,"columns"),details=A.el("div");
    A.add(details,A.el("h2","iPad 연결 코드"),
      A.el("p",state.code,"code"),
      notice("같은 ASAD 주소의 민원인 키오스크에 연결됩니다."));
    var qrbox=A.el("div"),qr=document.createElement("img");
    qr.className="qr";
    qr.alt="iPad 연결 QR코드";
    qr.width=220;qr.height=220;
    qr.src="/api/intake/qr?code="+encodeURIComponent(state.code);
    qr.onerror=function(){qr.style.display="none";};
    qrbox.appendChild(qr);
    A.add(row,details,qrbox);connected.appendChild(row);
    var link=A.el("input");
    link.type="text";link.value=joinUrl();link.readOnly=true;link.setAttribute("aria-label","iPad 연결 주소");
    link.style.maxWidth="100%";link.style.width="100%";connected.appendChild(link);
    var controls=A.actions(
      A.btn("iPad 연결 링크 복사",function(){copyLink(joinUrl(),link);},"btn"),
      A.btn(state.busy?"처리 중…":"접수 종료 · 삭제",end,"btn")
    );connected.appendChild(controls);
    connected.appendChild(notice("연결: "+(state.online?"● 정상 · 약 2초 간격 갱신":"● 재연결 중")+" · 2시간 후 세션 자동 만료"));
    root.appendChild(connected);
    var list=panel();
    list.appendChild(A.el("h2","실시간 접수 목록 ("+state.entries.length+")"));
    if(!state.entries.length)list.appendChild(notice("아직 접수된 요청이 없습니다. iPad에서 내용을 제출하면 여기에 표시됩니다."));
    else{
      var queue=A.el("div",null,"queue");
      for(var i=0;i<state.entries.length;i++){
        (function(item){
          var selected = state.selected===item.seq || (state.selected===-1 && item.seq===state.entries[state.entries.length-1].seq);
          var label = state.data && state.data.locales && state.data.locales.KO ?
            state.data.locales.KO.services[item.serviceIndex] : "업무 #"+(item.serviceIndex+1);
          var b=A.btn("",null,"queueItem");
          b.setAttribute("aria-pressed",String(selected));
          A.add(b,A.el("span","#"+item.seq+" · "+item.language),
            A.el("strong",label),A.el("small",verified[item.verification]+" · "+issued[item.ticket]));
          b.onclick=function(){state.selected=item.seq;render();};
          queue.appendChild(b);
        })(state.entries[i]);
      }
      list.appendChild(queue);
    }
    root.appendChild(list);
    if(state.entries.length){
      var chosen=null;
      for(var j=0;j<state.entries.length;j++)if(state.entries[j].seq===state.selected)chosen=state.entries[j];
      if(!chosen)chosen=state.entries[state.entries.length-1];
      var p=panel(),ko=state.data && state.data.locales && state.data.locales.KO;
      A.add(p,A.el("h2","요청 #"+chosen.seq+" · 직원 확인"),
        A.el("p",ko?ko.services[chosen.serviceIndex]:"업무 "+(chosen.serviceIndex+1),"code"),
        notice("선택한 언어: "+chosen.language+" · 예약 자기신고: "+booking[chosen.booking]),
        notice("예약접수증, 방문관서, 예약 날짜·시간, 방문 목적을 직원이 직접 확인하세요."),
        A.el("p","확인 결과: "+verified[chosen.verification],"success"));
      if(chosen.serviceIndex===19)p.appendChild(notice("전화번호 변경 요청: 이 화면은 방문 목적만 전달하며 실제 번호 변경 신고를 완료하지 않습니다. 신원 및 처리 경로를 담당자가 확인하세요.","alert"));
      var buttons=A.actions(
        A.btn("예약 확인됨",function(){mark(chosen.seq,{verification:"confirmed",ticket:"pending"});},"btn"),
        A.btn("확인 불가 · 보류",function(){mark(chosen.seq,{verification:"unclear",ticket:"held"});},"btn"),
        A.btn("예약 불요 업무",function(){mark(chosen.seq,{verification:"exempt",ticket:"pending"});},"btn")
      );
      p.appendChild(buttons);
      var finish=A.btn("번호표 전달 완료 기록",function(){mark(chosen.seq,{ticket:"issued"});},"btn primary");
      finish.disabled=state.busy || (chosen.verification!=="confirmed" && chosen.verification!=="exempt");
      var hold=A.btn("발권 보류",function(){mark(chosen.seq,{ticket:"held"});},"btn");
      hold.disabled=state.busy;
      p.appendChild(A.actions(finish,hold));
      p.appendChild(notice("발권 상태: "+issued[chosen.ticket]+". 이 버튼은 실제 번호표를 인쇄하지 않습니다."));
      root.appendChild(p);
    }
  }
  // Restore only this tab's scoped staff capability, never a visitor identifier.
  var saved=A.storageRead(KEY);
  if(saved){
    try{
      var s=JSON.parse(saved);
      if(A.queryCode(s.code) && /^[A-Za-z0-9_-]{30,128}$/.test(s.token) && s.expiresAt>Date.now()){
        state.code=s.code;state.token=s.token;state.expiresAt=s.expiresAt;
      }else A.storageRemove(KEY);
    }catch(e){A.storageRemove(KEY);}
  }
  A.request("GET","/compat/data.json?v=3",null,null,function(err,data){
    if(!err && data && data.locales)state.data=data;
    if(err)state.error="번역 목록을 불러오지 못했습니다. 업무 번호로 표시됩니다.";
    render();
    if(state.code)poll();
  });
})(window,document,window.ASADCompat);
