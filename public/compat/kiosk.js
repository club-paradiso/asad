/* eslint-disable @typescript-eslint/no-unused-vars -- ES5 catch bindings cannot be omitted (pre-Safari 15). */
/* Visitor kiosk for legacy Safari and all modern browsers. No React hydration. */
(function (window, document, A) {
  "use strict";
  var root = document.getElementById("app");
  var displayMode=A.getQuery("display")==="1";
  var stationValue=A.getQuery("station");
  var displayStation=/^(?:[1-9]|[12][0-9]|30)$/.test(stationValue)?stationValue:"";
  var RESV_OK=/^[A-Z0-9-]{4,30}$/;
  var liveSoonTimer=0;
  // A visitor who walks away mid-flow must not leave their choices for the next person.
  var IDLE_RESET_MS=120000;
  var SENT_RESET_SECONDS=30;
  var idleTimer=null,countdownTimer=null,countdownLeft=0,lastStep="";
  // Live mirror: one request in flight, newest state wins, failed sends retry on their own.
  var liveSent="",liveWanted=null,liveBusy=false,liveTimer=0,liveFailures=0,liveRev=0;
  // Ordering key that does not depend on the device clock: a random id per page load plus a counter.
  var liveEpoch=(A.uuid()||String(Math.random()).slice(2)+String(Math.random()).slice(2)).replace(/[^a-z0-9]/gi,"").slice(0,24);
  if(displayMode)document.body.className+=" display-mode";
  function isFullscreen(){
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function requestKioskFullscreen(){
    var elem=document.documentElement;
    var method=elem.requestFullscreen || elem.webkitRequestFullscreen;
    if(!method){
      error("이 브라우저는 전체화면 버튼을 지원하지 않습니다. 창을 보조 모니터로 옮긴 뒤 F11을 눌러 주세요.");
      return;
    }
    try{
      var outcome=method.call(elem);
      if(outcome && typeof outcome.catch==="function"){
        outcome.catch(function(){
          error("브라우저가 전체화면을 막았습니다. 보조 모니터에서 F11을 눌러 주세요.");
        });
      }
    }catch(e){
      error("전체화면으로 바꾸지 못했습니다. F11을 눌러 주세요.");
    }
  }
  var LANGS = ["KO","EN","ZH-CN","ID","HI","VI","JA","TH","RU","UZ","MN","NE"];
  // Staff -> visitor fixed phrases. The desk sends only a phrase id; the text comes from data.json.
  var NOTICE_POLL_MS=2500,NOTICE_HIDE_MS=30000;
  var notice={shown:null,seq:-1,dismissedSeq:-1,timer:0,hideTimer:0,stopped:false,failures:0,gen:0};
  var state = {
    data:null,code:"",codeDraft:"",locale:"KO",step:"connect",
    servicePage:0,serviceIndex:-1,booking:"",reservationNo:"",resvError:false,
    sending:false,requestId:"",sentSeq:0,error:"",errorDetail:""
  };
  function error(text, detail) {
    state.error = text;
    state.errorDetail = detail || "";
    render();
  }
  function message(text, cls) {
    return A.el("p", text, cls || "muted");
  }
  function htmlLang(code){ return code.toLowerCase().split("-")[0]; }
  function textInput() {
    var field = A.el("input");
    field.type = "text";
    field.id = "kiosk-desk-code";
    field.maxLength = 10;
    field.value = state.codeDraft;
    field.autocomplete = "off";
    field.autocapitalize = "characters";
    field.setAttribute("placeholder", "예: ABCD234567");
    field.oninput = function(){ state.codeDraft = field.value.toUpperCase(); };
    return field;
  }
  function connect() {
    var code = state.codeDraft.replace(/\s/g,"").toUpperCase();
    if (!A.queryCode(code)) return error("직원 화면에 나온 10자리 접수 코드를 다시 확인해 주세요.");
    state.code = code; state.error = ""; state.errorDetail = ""; state.step = "language";
    notice.gen++;notice.stopped=false;notice.seq=-1;render();pollNotice();
  }
  function reset() {
    state.step="language";state.locale="KO";state.servicePage=0;
    state.serviceIndex=-1;state.booking="";state.reservationNo="";state.resvError=false;state.requestId="";state.sentSeq=0;
    state.error="";state.errorDetail="";
    render();
  }
  function chooseLanguage(code){
    state.locale=code;state.serviceIndex=-1;state.booking="";state.reservationNo="";state.resvError=false;
    state.servicePage=0;state.step="services";state.error="";state.errorDetail="";render();
  }
  function stopTimers(){
    if(idleTimer){window.clearTimeout(idleTimer);idleTimer=null;}
    if(countdownTimer){window.clearInterval(countdownTimer);countdownTimer=null;}
  }
  function armIdleTimer(){
    if(idleTimer){window.clearTimeout(idleTimer);idleTimer=null;}
    if(state.step!=="services" && state.step!=="review")return;
    idleTimer=window.setTimeout(function(){
      if(!state.sending)reset();
    },IDLE_RESET_MS);
  }
  function countdownText(){
    return state.data.locales[state.locale].kiosk.autoReset.replace("{s}",String(countdownLeft));
  }
  function startSentCountdown(node){
    countdownLeft=SENT_RESET_SECONDS;
    node.textContent=countdownText();
    countdownTimer=window.setInterval(function(){
      countdownLeft--;
      if(countdownLeft<=0){reset();return;}
      node.textContent=countdownText();
    },1000);
  }
  function submit() {
    if (state.sending || state.serviceIndex<0 || !state.booking) return;
    var k = state.data.locales[state.locale].kiosk;
    var resv = state.booking==="yes" ? state.reservationNo : "";
    if (resv && !RESV_OK.test(resv)) { state.resvError=true; render(); return; }
    if (!A.queryCode(state.code)) return error(k.sendFailed, "접수 코드가 올바르지 않습니다. 직원 화면에서 창구를 다시 연결해 주세요.");
    if (!state.requestId) state.requestId = A.uuid();
    if (!state.requestId) return error(k.sendFailed, "이 브라우저는 보안 난수를 만들 수 없습니다. Safari를 업데이트해 주세요.");
    state.sending=true;state.error="";state.errorDetail="";render();
    A.request("POST", "/api/intake/submission",
      resv ? {code:state.code,requestId:state.requestId,language:state.locale,serviceIndex:state.serviceIndex,booking:state.booking,reservationNo:resv}
           : {code:state.code,requestId:state.requestId,language:state.locale,serviceIndex:state.serviceIndex,booking:state.booking},
      null,function(err,data){
        state.sending=false;
        if(err || !data || !data.accepted || !data.seq) {
          // Visitors get a message in their language; the Korean detail is for the staff member they ask.
          error(k.sendFailed, "직원 확인용: " + (err || "응답에 접수 번호가 없습니다."));
          return;
        }
        state.sentSeq = data.seq;state.step="sent";state.error="";state.errorDetail="";render();
      });
  }
  function displayBar(){
    var bar=A.el("div",null,"displayBar");
    A.add(bar,
      message(displayStation?displayStation+"번 창구":"창구 미지정"),
      A.btn("전체화면",requestKioskFullscreen,"btn"));
    if(isFullscreen())bar.className+=" is-hidden";
    return bar;
  }
  // Mirror the visible screen to the staff desk. Same coded choices as a submission; failures are ignored
  // because the visitor flow must never block on the staff mirror.
  function syncLive(){
    if(!A.queryCode(state.code) || state.step==="connect")return;
    var live={code:state.code,step:state.step};
    if(state.step!=="language")live.language=state.locale;
    if(state.step==="review" || state.step==="sent")live.serviceIndex=state.serviceIndex;
    if((state.step==="review" || state.step==="sent") && state.booking)live.booking=state.booking;
    if((state.step==="review" || state.step==="sent") && state.booking==="yes" && state.reservationNo)live.reservationNo=state.reservationNo;
    if(state.step==="sent" && state.sentSeq)live.seq=state.sentSeq;
    var key=JSON.stringify(live);
    if(key===liveSent && !liveWanted)return;
    if(liveWanted && JSON.stringify(liveWanted.body)===key)return;
    liveRev++;
    live.epoch=liveEpoch;
    live.rev=liveRev;
    liveWanted={key:key,body:live};
    liveFailures=0;
    pumpLive();
  }
  function pumpLive(){
    if(liveBusy || !liveWanted)return;
    if(liveTimer){window.clearTimeout(liveTimer);liveTimer=0;}
    var job=liveWanted;
    liveBusy=true;
    A.request("POST","/api/intake/live",job.body,null,function(err,data,status){
      liveBusy=false;
      var gone=status===400 || status===403 || status===404;
      if(!err || gone){
        // 400/403/404 will not succeed on retry; stop instead of looping.
        if(!err)liveSent=job.key;
        if(liveWanted===job)liveWanted=null;
        liveFailures=0;
        pumpLive();
        return;
      }
      liveFailures++;
      if(liveFailures>5){ if(liveWanted===job)liveWanted=null; liveFailures=0; return; }
      liveTimer=window.setTimeout(pumpLive,Math.min(1000*liveFailures,4000));
    });
  }
  function setReservation(value){
    var clean=String(value).toUpperCase().replace(/[^A-Z0-9-]/g,"").slice(0,30);
    if(clean!==state.reservationNo){state.reservationNo=clean;state.requestId="";}
    if(state.resvError && (!clean || RESV_OK.test(clean)))state.resvError=false;
    return clean;
  }
  // Typing should reach the staff mirror without a request per keystroke.
  function syncLiveSoon(){
    if(liveSoonTimer)window.clearTimeout(liveSoonTimer);
    liveSoonTimer=window.setTimeout(function(){liveSoonTimer=0;syncLive();},400);
  }
  function reservationField(k){
    var box=A.el("section",null,"resvBox");
    var label=A.el("label",k.reservationNoLabel,"resvLabel");
    label.setAttribute("for","kiosk-resv");
    var field=A.el("input");
    field.type="text";field.id="kiosk-resv";field.maxLength=30;
    field.autocomplete="off";field.autocapitalize="characters";field.spellcheck=false;
    field.setAttribute("inputmode","text");
    field.value=state.reservationNo;
    field.disabled=state.sending;
    if(state.resvError)field.setAttribute("aria-invalid","true");
    field.oninput=function(){
      if(state.sending){field.value=state.reservationNo;return;}
      var hadError=state.resvError;
      var clean=setReservation(field.value);
      if(field.value!==clean)field.value=clean;
      if(hadError!==state.resvError)render(); else syncLiveSoon();
    };
    var pad=A.el("div",null,"keypad");
    var keys=["1","2","3","4","5","6","7","8","9","-","0"];
    for(var i=0;i<keys.length;i++){
      (function(ch){
        var b=A.btn(ch,function(){ if(state.sending)return; setReservation(state.reservationNo+ch); render(); },"btn key");
        b.disabled=state.sending;
        pad.appendChild(b);
      })(keys[i]);
    }
    var erase=A.btn("⌫",function(){ if(state.sending)return; setReservation(state.reservationNo.slice(0,-1)); render(); },"btn key");
    erase.setAttribute("aria-label",k.erase);
    erase.disabled=state.sending;
    pad.appendChild(erase);
    A.add(box,label,field,state.resvError?A.el("p",k.reservationNoInvalid,"resvError"):null,pad);
    return box;
  }
  function errorBox(){
    if(!state.error)return null;
    var box=A.el("div",null,"error");
    box.setAttribute("role","alert");
    A.add(box,A.el("p",state.error),state.errorDetail?A.el("p",state.errorDetail,"errorDetail"):null);
    return box;
  }
  function noticeText(code,id,counter){
    var loc=state.data && state.data.locales[code];
    var t=loc && loc.notice && loc.notice.texts[id];
    return t ? t.replace("{n}",String(counter||"")) : "";
  }
  function hideNotice(){
    if(notice.hideTimer){window.clearTimeout(notice.hideTimer);notice.hideTimer=0;}
    notice.shown=null;
    var old=document.getElementById("notice-layer");
    if(old && old.parentNode)old.parentNode.removeChild(old);
  }
  function showNotice(n,seq){
    hideNotice();
    if(!state.data)return;
    // Before a language is chosen, show English; Korean underneath lets the staff member read along.
    var chosen=state.step!=="language" && state.step!=="connect";
    var code=chosen?state.locale:"EN";
    var main=noticeText(code,n.id,n.counter);
    if(!main)return;
    notice.shown=n;
    var layer=A.el("div",null,"noticeLayer");
    layer.id="notice-layer";
    layer.setAttribute("role","alertdialog");
    layer.setAttribute("aria-modal","true");
    var card=A.el("div",null,"noticeCard");
    card.lang=htmlLang(code);
    if(n.id==="counter" && n.counter)card.appendChild(A.el("p",String(n.counter),"noticeNumber"));
    card.appendChild(A.el("p",main,"noticeText"));
    if(code!=="KO")card.appendChild(A.el("p",noticeText("KO",n.id,n.counter),"noticeKo"));
    var ok=A.btn(state.data.locales[code].notice.ok,function(){notice.dismissedSeq=seq;hideNotice();},"btn primary noticeOk");
    card.appendChild(ok);
    layer.appendChild(card);
    document.body.appendChild(layer);
    try{ok.focus();}catch(e){}
    notice.hideTimer=window.setTimeout(function(){notice.dismissedSeq=seq;hideNotice();},NOTICE_HIDE_MS);
  }
  function applyNotice(n,seq){
    if(seq===notice.seq)return;
    notice.seq=seq;
    if(!n){hideNotice();return;}
    if(seq===notice.dismissedSeq)return;
    showNotice(n,seq);
  }
  function pollNotice(){
    if(notice.timer){window.clearTimeout(notice.timer);notice.timer=0;}
    if(notice.stopped)return;
    if(!A.queryCode(state.code) || state.step==="connect" || !state.data){
      notice.timer=window.setTimeout(pollNotice,NOTICE_POLL_MS);return;
    }
    var polling=state.code,gen=notice.gen;
    A.request("GET","/api/intake/notice?code="+polling+"&t="+Date.now(),null,null,function(err,data,status){
      if(gen!==notice.gen)return;
      if(status===400 || status===404){
        // The desk closed; stop instead of polling a dead session.
        notice.stopped=true;hideNotice();return;
      }
      if(!err && data && polling===state.code){notice.failures=0;applyNotice(data.notice||null,Number(data.seq)||0);}
      else notice.failures++;
      notice.timer=window.setTimeout(pollNotice,notice.failures?Math.min(NOTICE_POLL_MS*(1+notice.failures),15000):NOTICE_POLL_MS);
    });
  }
  function render(){
    stopTimers();
    A.clear(root);
    if (!state.data) return root.appendChild(message("화면을 준비하는 중입니다…"));
    if(displayMode)root.appendChild(displayBar());
    var d = state.data.locales[state.locale];
    var k = d.kiosk;
    var uiLang = state.step==="connect" || state.step==="language" ? "KO" : state.locale;
    document.documentElement.lang = htmlLang(uiLang);
    if (state.step==="connect") {
      root.appendChild(A.intro("","직원 창구와 연결","직원 화면의 QR코드를 스캔하거나 10자리 접수 코드를 입력하세요."));
      var p=A.el("section",null,"panel");
      var label=A.el("label","직원 접수 코드");
      label.setAttribute("for","kiosk-desk-code");
      A.add(p,label,textInput(),A.actions(A.btn("연결하기",connect,"btn primary")));
      root.appendChild(p);
    }else if(state.step==="language"){
      var langHero=A.intro("1 / 3","언어를 선택하세요","Choose your language");
      langHero.className+=" compact";
      root.appendChild(langHero);
      var langGrid=A.el("div",null,"grid langGrid");
      for(var i=0;i<LANGS.length;i++){
        (function(code){var b=A.btn(state.data.locales[code].name,function(){chooseLanguage(code);},"tile");
          b.lang=htmlLang(code);langGrid.appendChild(b);})(LANGS[i]);
      }
      root.appendChild(langGrid);
    }else if(state.step==="services"){
      root.appendChild(A.intro("2 / 3",d.heading[state.servicePage] || d.heading[0],""));
      var grid=A.el("div",null,"grid");
      var first=state.servicePage===0?0:10,limit=state.servicePage===0?10:d.services.length;
      for(var n=first;n<limit;n++){
        (function(idx){var b=A.btn("",function(){
            state.serviceIndex=idx;state.booking="";state.reservationNo="";state.resvError=false;state.requestId="";state.step="review";render();
          },"tile");
          var badge=A.el("span",idx<9?"0"+(idx+1):String(idx+1),"num");
          A.add(b,badge,A.el("span",d.services[idx]));
          grid.appendChild(b);
        })(n);
      }
      root.appendChild(grid);
      root.appendChild(A.actions(
        A.btn(state.servicePage===0?k.moreServices:k.firstServices,function(){state.servicePage=1-state.servicePage;render();},"btn primary"),
        A.btn(k.changeLanguage,function(){state.step="language";render();},"btn")));
    }else if(state.step==="review"){
      var t=d.review;
      root.appendChild(A.intro("3 / 3",t.reviewTitle,""));
      var selected=A.el("section",null,"panel");
      selected.appendChild(A.el("h2",d.services[state.serviceIndex]));
      if(state.serviceIndex===19)selected.appendChild(message(t.phoneChangeNote,"note"));
      root.appendChild(selected);
      root.appendChild(A.el("h2",t.reservationTitle,"question"));
      root.appendChild(message(t.reservationHelp));
      var opts=[["yes",t.answerYes],["no",t.answerNo],["unsure",t.answerUnsure]];
      var choiceGrid=A.el("div",null,"choiceGrid");
      for(var c=0;c<opts.length;c++){
        (function(opt){
          var b=A.btn(opt[1],function(){
            if(state.sending)return;
            state.booking=opt[0];state.requestId="";
            if(opt[0]!=="yes"){state.reservationNo="";state.resvError=false;}
            render();
          },"btn");
          b.setAttribute("aria-pressed",String(state.booking===opt[0]));
          choiceGrid.appendChild(b);
        })(opts[c]);
      }
      root.appendChild(choiceGrid);
      if(state.booking==="yes")root.appendChild(reservationField(k));
      // Keep a send failure next to the button the visitor just pressed.
      var sendError=errorBox();
      if(sendError)root.appendChild(sendError);
      var send=A.btn(state.sending?k.sending:t.sendLabel,submit,"btn primary");
      send.disabled = state.sending || !state.booking;
      var back=A.btn(k.changeService,function(){state.step="services";render();},"btn");
      back.disabled=state.sending;
      root.appendChild(A.actions(send,back));
    }else if(state.step==="sent"){
      root.appendChild(A.intro(displayStation?k.counter.replace("{n}",displayStation):"",k.sentTitle,k.sentBody));
      var done=A.el("section",null,"panel");
      A.add(done,
        A.el("p",k.requestNo+" #"+state.sentSeq,"seq"),
        A.el("h2",d.services[state.serviceIndex]),
        state.booking==="yes" && state.reservationNo?A.el("p",k.reservationNoLabel.replace(/\s*[(（].*$/,"")+" "+state.reservationNo,"muted"):null);
      if(state.serviceIndex===19)done.appendChild(message(d.review.phoneChangeNote,"note"));
      root.appendChild(done);
      var countdown=message("","muted countdown");
      countdown.setAttribute("aria-live","off");
      root.appendChild(A.actions(A.btn(d.review.waitingHome,reset,"btn primary")));
      root.appendChild(countdown);
      startSentCountdown(countdown);
    }
    if(state.step!=="review"){
      var box=errorBox();
      if(box)root.appendChild(box);
    }
    armIdleTimer();
    syncLive();
    var view=state.step+":"+state.servicePage;
    if(lastStep!==view){
      lastStep=view;
      try{window.scrollTo(0,0);}catch(e){}
    }
  }
  function onActivity(){ if(state.data)armIdleTimer(); }
  document.addEventListener("pointerdown",onActivity,true);
  document.addEventListener("touchstart",onActivity,true);
  document.addEventListener("keydown",onActivity,true);
  function onFullscreenChange(){
    var bar=root.querySelector(".displayBar");
    if(!bar)return;
    bar.className="displayBar"+(isFullscreen()?" is-hidden":"");
  }
  document.addEventListener("fullscreenchange",onFullscreenChange);
  document.addEventListener("webkitfullscreenchange",onFullscreenChange);
  var qrCode=A.getQuery("desk").replace(/\s/g,"").toUpperCase();
  if(A.queryCode(qrCode)){state.code=qrCode;state.codeDraft=qrCode;state.step="language";}
  A.request("GET","/compat/data.json?v=5",null,null,function(err,data){
    if (err || !data || !data.locales) {
      A.clear(root).appendChild(message("화면 정보를 불러오지 못했습니다. 직원에게 알려 주세요.","error"));
      return;
    }
    for(var i=0;i<LANGS.length;i++){
      var entry=data.locales[LANGS[i]];
      if(!entry || !entry.services || entry.services.length!==20 || !entry.review || !entry.kiosk) {
        A.clear(root).appendChild(message("언어 데이터가 올바르지 않습니다. 직원에게 알려 주세요.","error"));return;
      }
    }
    state.data=data;render();
    pollNotice();
  });
})(window,document,window.ASADCompat);
