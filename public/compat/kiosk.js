/* eslint-disable @typescript-eslint/no-unused-vars -- ES5 catch bindings cannot be omitted (pre-Safari 15). */
/* Visitor kiosk for legacy Safari and all modern browsers. No React hydration. */
(function (window, document, A) {
  "use strict";
  var root = document.getElementById("app");
  var LANGS = ["KO","EN","ZH-CN","ID","HI","VI","JA","TH","RU","UZ","MN","NE"];
  var state = {
    data:null,code:"",codeDraft:"",locale:"KO",step:"connect",
    langPage:0,servicePage:0,serviceIndex:-1,booking:"",
    sending:false,requestId:"",sentSeq:0,error:""
  };
  function error(text) {
    state.error = text;
    render();
  }
  function message(text, cls) {
    return A.el("p", text, cls || "muted");
  }
  function textInput() {
    var field = A.el("input");
    field.type = "text";
    field.id = "kiosk-desk-code";
    field.maxLength = 10;
    field.value = state.codeDraft;
    field.autocomplete = "off";
    field.autocapitalize = "characters";
    field.setAttribute("aria-label", "직원 접수 코드");
    field.setAttribute("placeholder", "10자리 접수 코드");
    field.oninput = function(){ state.codeDraft = field.value.toUpperCase(); };
    return field;
  }
  function connect() {
    var code = state.codeDraft.replace(/\s/g,"").toUpperCase();
    if (!A.queryCode(code)) return error("직원 화면에 표시된 10자리 접수 코드를 확인해 주세요.");
    state.code = code; state.error = ""; state.step = "language";render();
  }
  function reset() {
    state.step="language";state.langPage=0;state.servicePage=0;
    state.serviceIndex=-1;state.booking="";state.requestId="";state.sentSeq=0;state.error="";
    render();
  }
  function chooseLanguage(code){
    state.locale=code;state.serviceIndex=-1;state.booking="";
    state.servicePage=0;state.step="services";render();
  }
  function submit() {
    if (state.sending || state.serviceIndex<0 || !state.booking) return;
    if (!A.queryCode(state.code)) return error("접수 코드가 유효하지 않습니다. 직원에게 확인해 주세요.");
    if (!state.requestId) state.requestId = A.uuid();
    if (!state.requestId) return error("이 브라우저는 보안 난수 기능을 지원하지 않습니다. Safari 업데이트가 필요합니다.");
    state.sending=true;state.error="";render();
    A.request("POST", "/api/intake/submission",
      {code:state.code,requestId:state.requestId,language:state.locale,serviceIndex:state.serviceIndex,booking:state.booking},
      null,function(err,data){
        state.sending=false;
        if(err || !data || !data.accepted || !data.seq) {
          state.error = err || "직원 화면으로 전달하지 못했습니다.";
          render();return;
        }
        state.sentSeq = data.seq;state.step="sent";state.error="";render();
      });
  }
  function render(){
    A.clear(root);
    if (!state.data) return root.appendChild(message("언어 데이터를 불러오는 중입니다…"));
    var d = state.data.locales[state.locale];
    document.documentElement.lang = state.step==="connect" || state.step==="language" ? "ko" : state.locale.toLowerCase().split("-")[0];
    if (state.step==="connect") {
      root.appendChild(A.intro("01 / PAIRING","직원 창구와 연결","직원 화면의 QR코드를 스캔하거나 10자리 코드를 입력하세요."));
      var p=A.el("section",null,"panel");
      var label=A.el("label","직원 접수 코드");
      label.setAttribute("for","kiosk-desk-code");
      A.add(p,label,textInput(),A.actions(A.btn("언어 선택 시작 →",connect,"btn primary")));
      root.appendChild(p);
    }else if(state.step==="language"){
      root.appendChild(A.intro("01 / 03 · LANGUAGE","사용할 언어를 선택하세요","Choose your language · 12 languages"));
      var langGrid=A.el("div",null,"grid");
      for(var i=state.langPage*6;i<Math.min((state.langPage+1)*6,12);i++){
        (function(code){var b=A.btn(state.data.locales[code].name,function(){chooseLanguage(code);},"tile");
          b.lang=code.toLowerCase().split("-")[0];langGrid.appendChild(b);})(LANGS[i]);
      }
      root.appendChild(langGrid);
      root.appendChild(A.actions(A.btn(state.langPage===0?"다른 언어 보기 7–12 →":"← 처음 6개 언어",function(){state.langPage=1-state.langPage;render();},"btn primary")));
    }else if(state.step==="services"){
      root.appendChild(A.intro("02 / 03 · SERVICE",d.heading[state.servicePage] || "서비스 선택",d.instructions[state.servicePage] || ""));
      var grid=A.el("div",null,"grid");
      var first=state.servicePage===0?0:10,limit=state.servicePage===0?10:19;
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
        A.btn(state.servicePage===0?"다른 업무 11–19 →":"← 이전 업무 01–10",function(){state.servicePage=1-state.servicePage;render();},"btn primary"),
        A.btn("← 언어 선택",function(){state.step="language";render();},"btn")));
    }else if(state.step==="review"){
      var t=d.review;
      root.appendChild(A.intro("03 / 03 · REVIEW",t.reviewTitle,t.reviewHelp));
      var selected=A.el("section",null,"panel");
      A.add(selected,A.el("p",t.serviceLabel,"step"),A.el("h2",d.services[state.serviceIndex]));
      if(state.locale!=="KO")selected.appendChild(message(state.data.locales.KO.services[state.serviceIndex]));
      root.appendChild(selected);
      root.appendChild(A.el("h2",t.reservationTitle));
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
      root.appendChild(message("민원인 응답은 실제 예약 확인 결과가 아닙니다. 개인정보는 입력하지 않습니다."));
      var send=A.btn(state.sending?"직원에게 전송 중…":"직원 화면으로 전송 →",submit,"btn primary");
      send.disabled = state.sending || !state.booking;
      var back=A.btn("← 이전 업무",function(){state.step="services";render();},"btn");
      back.disabled=state.sending;
      root.appendChild(A.actions(send,back));
    }else if(state.step==="sent"){
      root.appendChild(A.intro("RECEIVED · NOT A TICKET",d.review.waitingTitle || "전달 완료","직원 접수 화면에 요청이 전달됐습니다."));
      var done=A.el("section",null,"panel");
      A.add(done,A.el("p","요청 순번 #"+state.sentSeq,"step"),A.el("h2",d.services[state.serviceIndex]),
        message("이 번호는 번호표 번호가 아닙니다. 실제 번호표는 담당 직원이 발급합니다."));
      root.appendChild(done);
      root.appendChild(A.actions(A.btn("다음 민원인 · 처음으로",reset,"btn primary")));
    }
    if(state.error)root.appendChild(message(state.error,"error"));
    try{window.scrollTo(0,0);}catch(e){}
  }
  var qrCode=A.getQuery("desk").replace(/\s/g,"").toUpperCase();
  if(A.queryCode(qrCode)){state.code=qrCode;state.codeDraft=qrCode;state.step="language";}
  A.request("GET","/compat/data.json?v=2",null,null,function(err,data){
    if (err || !data || !data.locales) {
      A.clear(root).appendChild(message("언어 정보를 불러올 수 없습니다. 직원에게 알려 주세요.","error"));
      return;
    }
    for(var i=0;i<LANGS.length;i++){
      var entry=data.locales[LANGS[i]];
      if(!entry || !entry.services || entry.services.length!==19 || !entry.review) {
        A.clear(root).appendChild(message("언어 데이터가 올바르지 않습니다.","error"));return;
      }
    }
    state.data=data;render();
  });
})(window,document,window.ASADCompat);
