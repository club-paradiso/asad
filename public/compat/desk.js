/* eslint-disable @typescript-eslint/no-unused-vars -- ES5 catch bindings cannot be omitted (pre-Safari 15). */
/* Staff desk: a read-only mirror of the visitor screen. No React, no ES2018 syntax, no third-party scripts. */
(function (window, document, A) {
  "use strict";
  var root=document.getElementById("app");
  var KEY="asad:intake:staff:v1";
  var STATION_KEY="asad:intake:station:v1";
  // Poll fast while the visitor is tapping, slower when the counter is quiet.
  var FAST_MS=1000,SLOW_MS=2500,FAST_WINDOW_MS=60000;
  var state={code:"",token:"",expiresAt:0,entries:[],live:null,busy:false,error:"",notice:"",online:false,
    pollTimer:0,stopped:false,data:null,station:"",setupOpen:false,lastChangeAt:0,
    phrase:null,noticeBusy:false,counterPicker:false,noticeError:"",
    nextChecks:{form:false,stamp:false,atm:false,photo:false},nextFee:""};
  var LANG_KO={"KO":"한국어","EN":"영어","ZH-CN":"중국어(간체)","ID":"인도네시아어","HI":"힌디어","VI":"베트남어",
    "JA":"일본어","TH":"태국어","RU":"러시아어","FIL":"필리핀어","SI":"싱할라어","KM":"크메르어","MY":"미얀마어","MN":"몽골어","NE":"네팔어"};
  var BOOKING={yes:"예약함",no:"예약 안 함",unsure:"모름"};
  var BOOKING_LIST={yes:"예약함",no:"예약 안 함",unsure:"예약 모름"};
  // One fixed color per counter so desks (and their requests) are told apart at a glance.
  var COUNTER_COLORS=["#087d70","#2456c4","#7b3fc1","#b4520e","#b02f6e","#3d7a1d"];
  function counterColor(n){ if(!Number(n))return "#3f5f62"; return COUNTER_COLORS[(Number(n)-1+COUNTER_COLORS.length)%COUNTER_COLORS.length]; }
  function counterChip(n,cls){
    var chip=A.el("span",Number(n)?n+"번 창구":"창구",cls||"counterChip");
    chip.style.backgroundColor=counterColor(n);
    return chip;
  }

  function text(s,cls){return A.el("p",s,cls||"muted");}
  function auth(){return {"x-asad-intake-staff-token":state.token};}
  function serviceName(i){
    var ko=state.data && state.data.locales && state.data.locales.KO;
    return ko ? ko.services[i] : "업무 "+(i+1);
  }
  function langName(code){ return LANG_KO[code] || code; }
  function clock(ms){
    var d=new Date(ms),h=d.getHours(),m=d.getMinutes();
    return (h<10?"0":"")+h+":"+(m<10?"0":"")+m;
  }
  function setError(s){state.error=s;state.notice="";render();}
  function resetLocal(){
    state.code="";state.token="";state.expiresAt=0;state.entries=[];state.live=null;
    state.online=false;state.busy=false;state.setupOpen=false;A.storageRemove(KEY);
  }
  function schedule(){
    var quick=Date.now()-state.lastChangeAt<FAST_WINDOW_MS;
    state.pollTimer=window.setTimeout(poll,quick?FAST_MS:SLOW_MS);
  }
  function poll() {
    if(state.pollTimer){window.clearTimeout(state.pollTimer);state.pollTimer=0;}
    if(!state.code || !state.token || state.stopped)return;
    if(state.expiresAt<=Date.now()){
      resetLocal();setError("창구가 2시간이 지나 자동으로 닫혔습니다. 다시 시작해 주세요.");return;
    }
    var pollingCode=state.code,pollingToken=state.token;
    A.request("GET","/api/intake/session?code="+pollingCode+"&t="+Date.now(),null,auth(),function(err,data,status){
      // A response from an ended session must never overwrite a new desk.
      if(state.stopped || state.code!==pollingCode || state.token!==pollingToken)return;
      if(status===401 || status===403 || status===404){
        resetLocal();setError("창구가 닫혔습니다. 다시 시작해 주세요.");return;
      }
      if(err || !data || !data.entries){
        var wasOnline=state.online;
        state.online=false;
        if(wasOnline || !state.error){state.error="연결이 끊겨 다시 연결하는 중입니다.";render();}
      }else{
        var before=JSON.stringify([state.entries,state.live,state.noticeBusy?null:state.phrase]);
        var after=JSON.stringify([data.entries,data.live||null,state.noticeBusy?null:(data.notice||null)]);
        var changed=before!==after;
        var recovered=!state.online || !!state.error;
        state.entries=data.entries;state.live=data.live||null;
        if(!state.noticeBusy)state.phrase=data.notice||null;
        if(data.station && String(data.station)!==state.station){state.station=String(data.station);changed=true;}
        state.online=true;state.error="";
        if(changed)state.lastChangeAt=Date.now();
        if(changed || recovered)render();
      }
      schedule();
    });
  }
  function start(){
    if(state.busy)return;
    state.busy=true;state.error="";render();
    if(!state.station)return;
    A.request("POST","/api/intake/session",{station:Number(state.station)},null,function(err,data,status){
      state.busy=false;
      if(err || !data || !data.code || !data.staffToken || !data.expiresAt){
        state.error = status===503 ? "접수 서버에 연결하지 못했습니다. 서버 저장소 설정을 확인해 주세요. (HTTP 503)" :
          "창구를 열지 못했습니다. 다시 눌러 주세요."+(err?" ("+err+")":"");
        render();return;
      }
      state.code=data.code;state.token=data.staffToken;state.expiresAt=data.expiresAt;
      if(data.station)state.station=String(data.station);
      state.entries=[];state.live=null;state.online=false;state.error="";state.lastChangeAt=Date.now();
      if(!A.storageWrite(KEY,JSON.stringify({code:state.code,token:state.token,expiresAt:state.expiresAt}))){
        state.notice="이 브라우저는 탭 저장을 막고 있어 새로고침하면 창구가 사라집니다.";
      }
      render();poll();
    });
  }
  function end(){
    if(state.busy || !state.code)return;
    if(!window.confirm("창구를 닫을까요? 받은 요청 목록도 지워집니다."))return;
    state.busy=true;render();
    A.request("DELETE","/api/intake/session?code="+state.code,null,auth(),function(err,data,status){
      state.busy=false;
      if(err && status!==404){setError("창구를 닫지 못했습니다. 다시 눌러 주세요.");return;}
      resetLocal();state.error="";render();
    });
  }
  function joinUrl(){
    return window.location.protocol+"//"+window.location.host+"/intake?desk="+encodeURIComponent(state.code)+
      (state.station?"&station="+encodeURIComponent(state.station):"");
  }
  function displayUrl(){
    return joinUrl()+"&display=1";
  }
  function copyLink(field){
    var ok=false;
    try{field.focus();field.select();ok=document.execCommand("copy");}catch(e){}
    state.notice=ok?"연결 주소를 복사했습니다.":"복사하지 못했습니다. 주소를 길게 눌러 복사해 주세요.";
    render();
  }
  function visitorWindowLink(primary){
    var a=A.el("a","보조 모니터에 민원인 화면 열기",primary?"btn primary":"btn");
    a.href=displayUrl();
    a.target="_blank";
    // A separate browsing context must NOT inherit the staff sessionStorage token.
    a.rel="noopener noreferrer";
    a.setAttribute("aria-label","민원인 전용 화면을 새 창에서 열기");
    return a;
  }
  function stationPicker(){
    var wrap=A.el("div",null,"stationPicker");
    var label=A.el("label","창구 번호");
    label.setAttribute("for","staff-station");
    var select=A.el("select");
    select.id="staff-station";
    var none=A.el("option","창구 선택");
    none.value="";
    none.disabled=true;
    select.appendChild(none);
    for(var i=1;i<=30;i++){
      var option=A.el("option",i+"번 창구");
      option.value=String(i);
      select.appendChild(option);
    }
    select.value=state.station;
    select.onchange=function(){
      state.station=select.value;
      A.storageWrite(STATION_KEY,state.station);
      render();
    };
    A.add(wrap,label,select);
    return wrap;
  }
  function connectBlock(){
    var box=A.el("div",null,"connectBlock");
    var monitor=A.el("div",null,"connectWay");
    A.add(monitor,A.el("h3","보조 모니터"),visitorWindowLink(true));
    var ipad=A.el("div",null,"connectWay");
    var qr=document.createElement("img");
    qr.className="qr";
    qr.alt="iPad 연결 QR코드";
    qr.width=180;qr.height=180;
    qr.src="/api/intake/qr?code="+encodeURIComponent(state.code)+(state.station?"&station="+encodeURIComponent(state.station):"");
    qr.onerror=function(){qr.style.display="none";};
    var field=A.el("input");
    field.type="text";field.value=joinUrl();field.readOnly=true;
    field.setAttribute("aria-label","iPad 연결 주소");
    A.add(ipad,A.el("h3","iPad"),qr,A.el("p",state.code,"code"),field,
      A.btn("연결 주소 복사",function(){copyLink(field);},"btn"));
    A.add(box,monitor,ipad);
    return box;
  }
  function fact(label,value,empty){
    var f=A.el("div",null,"fact"+(empty?" is-empty":""));
    A.add(f,A.el("span",label,"factLabel"),A.el("strong",value,"factValue"));
    return f;
  }
  function noticeLabel(n){
    if(!n)return "";
    if(n.id==="nextSteps")return "다음 단계 "+(n.steps?n.steps.length:0)+"건";
    var cfg=state.data && state.data.notices;
    var label=n.id;
    if(cfg)for(var g=0;g<cfg.groups.length;g++)for(var i=0;i<cfg.groups[g].items.length;i++)
      if(cfg.groups[g].items[i].id===n.id)label=cfg.groups[g].items[i].label;
    return n.id==="counter" && n.counter ? n.counter+"번 "+label : label;
  }
  function sendNotice(id,counter,steps,feeManwon){
    if(state.noticeBusy || !state.code)return;
    var body={code:state.code,id:id};
    if(id==="counter")body.counter=counter;
    if(id==="nextSteps"){
      body.steps=steps;
      if(feeManwon!==null && typeof feeManwon!=="undefined")body.feeManwon=feeManwon;
    }
    state.noticeBusy=true;state.noticeError="";state.counterPicker=false;render();
    A.request("POST","/api/intake/notice",body,auth(),function(err,data,status){
      state.noticeBusy=false;
      if(err || !data || !data.ok){
        state.noticeError=status===403||status===404?"창구가 닫혀 문구를 보내지 못했습니다.":"문구를 보내지 못했습니다. 다시 눌러 주세요.";
      }else state.phrase=data.notice||null;
      state.lastChangeAt=Date.now();
      render();
    });
  }
  function showNextSteps(){
    if(state.noticeBusy)return;
    var choices=["form","stamp","atm","photo"],selected=[];
    for(var i=0;i<choices.length;i++)if(state.nextChecks[choices[i]])selected.push(choices[i]);
    if(!selected.length){state.noticeError="안내할 항목을 한 개 이상 선택해 주세요.";render();return;}
    var fee=null;
    if(state.nextChecks.stamp){
      if(!/^[1-9][0-9]{0,2}$/.test(state.nextFee) || Number(state.nextFee)>999){
        state.noticeError="연장 수수료 금액을 만 원 단위 정수로 입력해 주세요 (1~999).";render();return;
      }
      fee=Number(state.nextFee);
    }
    sendNotice("nextSteps",null,selected,fee);
  }
  function nextStepsPanel(){
    var section=A.el("div",null,"nextStepsPanel");
    section.appendChild(A.el("h3","응대 후 · 다음 단계 안내"));
    section.appendChild(text("민원인에게 안내할 항목을 체크하고, 화면에 보여주세요. 체크는 완료 여부가 아닌 안내 항목 선택입니다.","muted"));
    var names={form:"통합신청서 작성",stamp:"연장 수수료 수입인지 구매",atm:"ATM에서 등록증 발급 비용 납부",photo:"사진 부착"};
    var keys=["form","stamp","atm","photo"];
    var grid=A.el("div",null,"nextStepsChecks");
    for(var i=0;i<keys.length;i++){
      (function(k){
        var label=A.el("label",null,"nextStepsCheck");
        var check=A.el("input");check.type="checkbox";check.checked=!!state.nextChecks[k];
        check.disabled=state.noticeBusy;
        check.onchange=function(){state.nextChecks[k]=check.checked;state.noticeError="";render();};
        label.appendChild(check);label.appendChild(A.el("span",names[k]));
        grid.appendChild(label);
      })(keys[i]);
    }
    section.appendChild(grid);
    if(state.nextChecks.stamp){
      var field=A.el("label",null,"nextFeeField");
      field.appendChild(A.el("span","연장 수수료 (만원 단위)"));
      var input=A.el("input");input.type="number";input.min="1";input.max="999";input.step="1";
      input.inputMode="numeric";input.placeholder="예: 6 → 6만원";input.value=state.nextFee;
      input.disabled=state.noticeBusy;
      input.oninput=function(){state.nextFee=input.value;};
      field.appendChild(input);section.appendChild(field);
    }
    var show=A.btn(state.noticeBusy?"전송 중…":"선택 항목 민원인에게 보여주기",showNextSteps,"btn primary");
    show.disabled=state.noticeBusy;
    section.appendChild(A.actions(show));
    return section;
  }
  function noticePanel(){
    var cfg=state.data && state.data.notices;
    if(!cfg)return null;
    var section=A.el("section",null,"noticePanel");
    var head=A.el("div",null,"noticeHead");
    A.add(head,A.el("h2","안내 문구"),
      state.phrase?A.el("span","표시 중: "+noticeLabel(state.phrase),"chip is-on"):A.el("span","표시 안 함","chip"));
    if(state.phrase){
      var clear=A.btn("화면에서 지우기",function(){sendNotice(null);},"btn");
      clear.disabled=state.noticeBusy;
      head.appendChild(clear);
    }
    section.appendChild(head);
    if(state.noticeError){var e=text(state.noticeError,"alert");e.setAttribute("role","alert");section.appendChild(e);}
    section.appendChild(nextStepsPanel());
    for(var g=0;g<cfg.groups.length;g++){
      var group=cfg.groups[g];
      var row=A.el("div",null,"noticeGroup");
      row.appendChild(A.el("h3",group.label,"noticeGroupLabel"));
      var items=A.el("div",null,"noticeItems");
      for(var i=0;i<group.items.length;i++){
        (function(item){
          var active=state.phrase && state.phrase.id===item.id;
          var b=A.btn(item.label,function(){
            if(item.id==="counter"){state.counterPicker=!state.counterPicker;render();return;}
            sendNotice(item.id);
          },"btn noticeBtn"+(active?" is-active":""));
          b.disabled=state.noticeBusy;
          if(item.id==="counter")b.setAttribute("aria-expanded",String(state.counterPicker));
          b.setAttribute("aria-pressed",String(!!active));
          items.appendChild(b);
        })(group.items[i]);
      }
      row.appendChild(items);
      if(group.items.some(function(it){return it.id==="counter";}) && state.counterPicker){
        var pad=A.el("div",null,"counterPad");
        pad.setAttribute("aria-label","창구 번호 고르기");
        for(var c=0;c<cfg.counters.length;c++){
          (function(no){
            var nb=A.btn(String(no),function(){sendNotice("counter",no);},"btn key");
            nb.setAttribute("aria-label",no+"번 창구");
            nb.disabled=state.noticeBusy;
            pad.appendChild(nb);
          })(cfg.counters[c]);
        }
        row.appendChild(pad);
      }
      section.appendChild(row);
    }
    return section;
  }
  function mirror(){
    var live=state.live;
    var card=A.el("section",null,"mirror");
    card.style.borderColor=counterColor(state.station);
    var status;
    if(!live)status="민원인 화면 연결 전";
    else if(live.step==="language")status="언어 고르는 중";
    else if(live.step==="services")status="업무 고르는 중";
    else if(live.step==="review")status=live.booking?"보내기 직전":"예약 여부 고르는 중";
    else status="요청 받음"+(live.seq?" #"+live.seq:"");
    var head=A.el("div",null,"mirrorHead");
    A.add(head,A.el("span","민원인 화면","mirrorLabel"),
      live?A.el("span",clock(live.updatedAt),"mirrorTime"):null);
    var h=A.el("h2",status,"mirrorStatus"+(live && live.step==="sent"?" is-sent":""));
    var hasLang=!!(live && live.language);
    var hasService=!!(live && typeof live.serviceIndex==="number");
    var hasBooking=!!(live && live.booking);
    var hasResv=!!(live && live.booking==="yes" && live.reservationNo);
    var bookingDate=live && live.booking==="yes" ?
      (live.reservationDate || (live.reservationDateMode==="other"?"날짜 입력 중":
        live.reservationDateMode==="today"?"오늘(민원인 응답)":"—")) : "—";
    var facts=A.el("div",null,"facts");
    A.add(facts,
      fact("언어",hasLang?langName(live.language):"—",!hasLang),
      fact("업무",hasService?serviceName(live.serviceIndex):"—",!hasService),
      fact("하이코리아 예약",hasBooking?BOOKING[live.booking]:"—",!hasBooking),
      fact("예약 번호",hasResv?live.reservationNo+"번":"—",!hasResv),
      fact("예약 날짜",bookingDate,bookingDate==="—"));
    A.add(card,head,h,facts);
    return card;
  }
  function requestList(){
    var section=A.el("section",null,"requests");
    section.appendChild(A.el("h2",(state.station?state.station+"번 창구 ":"")+"받은 요청 "+state.entries.length+"건"));
    if(!state.entries.length){
      return section;
    }
    var list=A.el("ol",null,"reqList");
    for(var i=state.entries.length-1;i>=0;i--){
      var e=state.entries[i];
      var row=A.el("li",null,"reqRow"+(i===state.entries.length-1?" is-latest":""));
      A.add(row,
        counterChip(e.station||state.station,"counterChip small"),
        A.el("span","#"+e.seq,"reqSeq"),
        A.el("span",clock(e.receivedAt),"reqTime"),
        A.el("strong",serviceName(e.serviceIndex),"reqService"),
        A.el("span",langName(e.language)+" · "+BOOKING_LIST[e.booking]+(e.reservationNo?" · "+e.reservationNo+"번":"")+(e.reservationDate?" · 다른 날짜 "+e.reservationDate:""),"reqMeta"));
      list.appendChild(row);
    }
    section.appendChild(list);
    return section;
  }
  function render(){
    A.clear(root);
    if(!state.code){
      root.appendChild(A.intro("","창구 열기",""));
      if(state.error){var startAlert=text(state.error,"alert");startAlert.setAttribute("role","alert");root.appendChild(startAlert);}
      var startPanel=A.el("section",null,"panel");
      var b=A.btn(state.busy?"여는 중…":"시작",start,"btn primary");
      b.disabled=state.busy || !state.station;
      A.add(startPanel,stationPicker(),A.actions(b));
      root.appendChild(startPanel);
      return;
    }
    var bar=A.el("div",null,"deskBar");
    var title=A.el("h1",state.station?state.station+"번 창구":"창구","deskTitle");
    title.style.backgroundColor=counterColor(state.station);
    A.add(bar,title,
      A.el("span",state.online?"실시간 연결됨":"연결 중…","chip"+(state.online?" is-on":"")));
    root.appendChild(bar);
    if(state.error){var alert=text(state.error,"alert");alert.setAttribute("role","alert");root.appendChild(alert);}
    if(state.notice){var ok=text(state.notice,"success");ok.setAttribute("role","status");root.appendChild(ok);}
    var connected=!!state.live || state.entries.length>0;
    if(!connected){
      var setup=A.el("section",null,"panel");
      A.add(setup,A.el("h2","민원인 화면 연결"),connectBlock());
      root.appendChild(setup);
    }
    else{
      root.appendChild(mirror());
      var np=noticePanel();
      if(np)root.appendChild(np);
      root.appendChild(requestList());
    }
    var more=A.el("details",null,"setup");
    if(state.setupOpen)more.open=true;
    more.ontoggle=function(){state.setupOpen=more.open;};
    var sum=A.el("summary","연결 · 창구 닫기");
    more.appendChild(sum);
    if(connected)more.appendChild(connectBlock());
    more.appendChild(A.actions(A.btn(state.busy?"닫는 중…":"창구 닫기",end,"btn")));
    root.appendChild(more);
  }
  // Station label is tab-scoped and not used as authorization or a session key.
  var storedStation=A.storageRead(STATION_KEY);
  if(storedStation && /^(?:[1-9]|[12][0-9]|30)$/.test(storedStation))state.station=storedStation;
  // Restore only this tab's scoped staff capability, never a visitor identifier.
  var saved=A.storageRead(KEY);
  if(saved){
    try{
      var s=JSON.parse(saved);
      if(A.queryCode(s.code) && /^[A-Za-z0-9_-]{30,128}$/.test(s.token) && s.expiresAt>Date.now()){
        state.code=s.code;state.token=s.token;state.expiresAt=s.expiresAt;state.lastChangeAt=Date.now();
      }else A.storageRemove(KEY);
    }catch(e){A.storageRemove(KEY);}
  }
  A.request("GET","/compat/data.json?v=8",null,null,function(err,data){
    if(!err && data && data.locales)state.data=data;
    if(err)state.notice="업무 이름 목록을 불러오지 못해 번호로 표시합니다.";
    render();
    if(state.code)poll();
  });
})(window,document,window.ASADCompat);
