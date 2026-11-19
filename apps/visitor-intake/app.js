(() => {
"use strict";
const root=document.getElementById("main");
const codes=["KO","EN","ZH-CN","ID","HI","VI","JA","TH","RU","UZ","MN","NE"];
const state={data:null,locale:null,service:null,booking:null,stage:"language",page:0};
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
function button(text,handler,cls="tile"){const n=node("button",text,cls);n.type="button";n.addEventListener("click",handler);return n}
function add(parent,...children){children.forEach(x=>parent.append(x));return parent}
function intro(step,title,help){return add(node("section",undefined,"intro"),node("p",step,"eyebrow"),node("h1",title),node("p",help))}
function actions(...btns){return add(node("div",undefined,"actions"),...btns)}
function reset(){Object.assign(state,{locale:null,service:null,booking:null,stage:"language",page:0});render()}
function render(){
  const s=state;root.replaceChildren();
  if(!s.data){root.append(node("p","Loading..."));return}
  if(s.stage==="language"){
    document.documentElement.lang="ko";
    root.append(intro("01 / 03 · LANGUAGE","방문 목적 안내","편하신 언어를 선택해 주세요. / Choose your language."));
    const grid=node("div",undefined,"grid");
    codes.slice(s.page*6,s.page*6+6).forEach(code=>{
      const b=button(s.data.locales[code].name,()=>{s.locale=code;s.page=0;s.service=null;s.booking=null;s.stage="services";render()});
      b.lang=code.toLowerCase().split("-")[0];grid.append(b);
    });
    add(root,grid,actions(button(s.page===0?"다른 언어 보기 · More languages →":"← 처음 언어 6개",()=>{s.page=1-s.page;render()},"btn primary")));
  }else{
    const d=s.data.locales[s.locale],r=d.review;
    document.documentElement.lang=s.locale.toLowerCase().split("-")[0];
    if(s.stage==="services"){
      root.append(intro("02 / 03 · SERVICE",d.heading[s.page]||"Select service",d.instructions[s.page]||""));
      const grid=node("div",undefined,"grid"),start=s.page?10:0;
      d.services.slice(start,s.page?d.services.length:10).forEach((val,i)=>{
        const btn=button("",()=>{s.service=start+i;s.booking=null;s.stage="review";render()});
        add(btn,node("span",String(start+i+1).padStart(2,"0"),"num"),node("span",val));grid.append(btn);
      });
      add(root,grid,actions(button(s.page===0?"More services 11–"+d.services.length+" →":"← Services 01–10",()=>{s.page=1-s.page;render()},"btn primary"),button("← Language",reset,"btn")));
      root.append(node("p","음성 인식은 후속 버전에서 제공합니다. 현재는 버튼 선택만 가능합니다.","muted"));
    }else if(s.stage==="review"){
      root.append(intro("03 / 03 · REVIEW",r.reviewTitle||"Review",r.reviewHelp||""));
      const panel=add(node("section",undefined,"panel"),node("div",r.serviceLabel||"Service","eyebrow"),node("h2",s.data.locales.KO.services[s.service]));
      if(s.locale!=="KO")panel.append(node("p",d.services[s.service]));
      add(root,panel,node("h2",r.reservationTitle||"HiKorea reservation?"),node("p",r.reservationHelp||"","muted"));
      if(s.service===19)root.append(node("p",r.phoneChangeNote,"muted"));
      const choices=node("div",undefined,"choices");
      [r.answerYes,r.answerNo,r.answerUnsure].forEach((value,i)=>{const b=button(value||String(i),()=>{s.booking=i;render()});b.setAttribute("aria-pressed",String(s.booking===i));choices.append(b)});
      add(root,choices,node("div",s.booking===null?"응답 없음":[r.answerYes,r.answerNo,r.answerUnsure][s.booking],"notice"),node("p","시연용: 선택 정보는 외부로 전송되거나 저장되지 않습니다.","muted"));
      root.append(actions(button(r.sendLabel||"Continue →",()=>{s.stage="complete";render()},"btn primary"),button("← Back",()=>{s.stage="services";render()},"btn")));
    }else{
      root.append(intro("PREVIEW · NOT SUBMITTED",r.waitingTitle||"Preview",r.waitingHelp||""));
      const panel=add(node("section",undefined,"panel"),node("div",r.serviceLabel||"Service","eyebrow"),node("h2",s.data.locales.KO.services[s.service]));
      if(s.locale!=="KO")panel.append(node("p",d.services[s.service]));
      add(root,panel,node("div",r.waitingTicket||"No ticket issued.","notice warn"),node("p","이 화면은 시연용입니다. 직원 화면으로 전송되지 않으며 실제 예약 확인 또는 발권을 수행하지 않습니다.","muted"));
      if(s.service===19)root.append(node("p",r.phoneChangeNote,"muted"));
      root.append(actions(button(r.waitingHome||"Start again",reset,"btn primary"),button("← Back",()=>{s.stage="review";render()},"btn")));
    }
  }
  root.focus({preventScroll:true});window.scrollTo(0,0);
}
fetch("./data.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("Data unavailable");return r.json()}).then(d=>{if(!d.locales||codes.some(c=>d.locales[c]?.services?.length!==20||d.locales[c].services.some(x=>!x)))throw Error("Invalid locale data");state.data=d;render()}).catch(()=>{root.replaceChildren(node("p","언어 데이터를 불러오지 못했습니다. 화면을 새로고침해 주세요."))});
})();