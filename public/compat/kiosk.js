/* eslint-disable @typescript-eslint/no-unused-vars -- ES5 catch bindings cannot be omitted (pre-Safari 15). */
/* Visitor kiosk for legacy Safari and all modern browsers. No React hydration. */
(function (window, document, A) {
  "use strict";
  var root = document.getElementById("app");
  var footer = document.getElementById("kiosk-footer");
  var displayMode=A.getQuery("display")==="1";
  var stationValue=A.getQuery("station");
  var displayStation=/^(?:[1-9]|[12][0-9]|30)$/.test(stationValue)?stationValue:"";
  // A visitor who walks away mid-flow must not leave their choices for the next person.
  var IDLE_RESET_MS=120000;
  var SENT_RESET_SECONDS=30;
  var idleTimer=null,countdownTimer=null,countdownLeft=0,lastStep="";
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
  var state = {
    data:null,code:"",codeDraft:"",locale:"KO",step:"connect",
    servicePage:0,serviceIndex:-1,booking:"",
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
    state.code = code; state.error = ""; state.errorDetail = ""; state.step = "language";render();
  }
  function reset() {
    state.step="language";state.locale="KO";state.servicePage=0;
    state.serviceIndex=-1;state.booking="";state.requestId="";state.sentSeq=0;
    state.error="";state.errorDetail="";
    render();
  }
  function chooseLanguage(code){
    state.locale=code;state.serviceIndex=-1;state.booking="";
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
    if (!A.queryCode(state.code)) return error(k.sendFailed, "접수 코드가 올바르지 않습니다. 직원 화면에서 창구를 다시 연결해 주세요.");
    if (!state.requestId) state.requestId = A.uuid();
    if (!state.requestId) return error(k.sendFailed, "이 브라우저는 보안 난수를 만들 수 없습니다. Safari를 업데이트해 주세요.");
    state.sending=true;state.error="";state.errorDetail="";render();
    A.request("POST", "/api/intake/submission",
      {code:state.code,requestId:state.requestId,language:state.locale,serviceIndex:state.serviceIndex,booking:state.booking},
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
      message((displayStation?displayStation+"번 창구 · ":"")+"민원인 화면"),
      A.btn("전체화면",requestKioskFullscreen,"btn"));
    if(isFullscreen())bar.className+=" is-hidden";
    return bar;
  }
  function errorBox(){
    if(!state.error)return null;
    var box=A.el("div",null,"error");
    box.setAttribute("role","alert");
    A.add(box,A.el("p",state.error),state.errorDetail?A.el("p",state.errorDetail,"errorDetail"):null);
    return box;
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
    if(footer)footer.textContent = state.step==="connect" ? "번호표는 직원이 직접 드립니다." :
      state.step==="language" ? "번호표는 직원이 직접 드립니다. · Queue tickets are given by staff in person." :
      k.footer;
    if (state.step==="connect") {
      root.appendChild(A.intro("","직원 창구와 연결","직원 화면의 QR코드를 스캔하거나 10자리 접수 코드를 입력하세요."));
      var p=A.el("section",null,"panel");
      var label=A.el("label","직원 접수 코드");
      label.setAttribute("for","kiosk-desk-code");
      A.add(p,label,textInput(),A.actions(A.btn("연결하기",connect,"btn primary")));
      root.appendChild(p);
    }else if(state.step==="language"){
      root.appendChild(A.intro("1 / 3","언어를 선택하세요","Choose your language"));
      var langGrid=A.el("div",null,"grid langGrid");
      for(var i=0;i<LANGS.length;i++){
        (function(code){var b=A.btn(state.data.locales[code].name,function(){chooseLanguage(code);},"tile");
          b.lang=htmlLang(code);langGrid.appendChild(b);})(LANGS[i]);
      }
      root.appendChild(langGrid);
    }else if(state.step==="services"){
      root.appendChild(A.intro("2 / 3",d.heading[state.servicePage] || d.heading[0],d.instructions[state.servicePage] || ""));
      var grid=A.el("div",null,"grid");
      var first=state.servicePage===0?0:10,limit=state.servicePage===0?10:d.services.length;
      for(var n=first;n<limit;n++){
        (function(idx){var b=A.btn("",function(){
            state.serviceIndex=idx;state.booking="";state.requestId="";state.step="review";render();
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
      root.appendChild(A.intro("3 / 3",t.reviewTitle,t.reviewHelp));
      var selected=A.el("section",null,"panel");
      A.add(selected,A.el("p",t.serviceLabel,"step"),A.el("h2",d.services[state.serviceIndex]));
      if(state.locale!=="KO"){
        var ko=message(state.data.locales.KO.services[state.serviceIndex]);
        ko.lang="ko";selected.appendChild(ko);
      }
      if(state.serviceIndex===19)selected.appendChild(message(t.phoneChangeNote,"note"));
      root.appendChild(selected);
      root.appendChild(A.el("h2",t.reservationTitle,"question"));
      root.appendChild(message(t.reservationHelp));
      var opts=[["yes",t.answerYes],["no",t.answerNo],["unsure",t.answerUnsure]];
      var choiceGrid=A.el("div",null,"choiceGrid");
      for(var c=0;c<opts.length;c++){
        (function(opt){
          var b=A.btn(opt[1],function(){if(state.sending)return;state.booking=opt[0];state.requestId="";render();},"btn");
          b.setAttribute("aria-pressed",String(state.booking===opt[0]));
          choiceGrid.appendChild(b);
        })(opts[c]);
      }
      root.appendChild(choiceGrid);
      root.appendChild(message(k.noPersonalInfo));
      // Keep a send failure next to the button the visitor just pressed.
      var sendError=errorBox();
      if(sendError)root.appendChild(sendError);
      var send=A.btn(state.sending?k.sending:t.sendLabel,submit,"btn primary");
      send.disabled = state.sending || !state.booking;
      var back=A.btn(k.changeService,function(){state.step="services";render();},"btn");
      back.disabled=state.sending;
      root.appendChild(A.actions(send,back));
    }else if(state.step==="sent"){
      root.appendChild(A.intro("",k.sentTitle,k.sentBody));
      var done=A.el("section",null,"panel");
      A.add(done,
        A.el("p",k.requestNo+" #"+state.sentSeq,"seq"),
        A.el("h2",d.services[state.serviceIndex]),
        message(k.requestNoHelp));
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
  A.request("GET","/compat/data.json?v=4",null,null,function(err,data){
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
  });
})(window,document,window.ASADCompat);
