/**
 * Browser-level legacy intake regression:
 * - /intake and /secret must be framework-free static pages
 * - iPad viewport -> real staff session start -> language/service/booking
 * - client submission -> staff queue -> verification -> manual issuance
 * - both Chromium and WebKit run the same scenario (no real visitor data)
 */
import { chromium, webkit } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";
import { readFileSync } from "node:fs";
import { parse } from "acorn";

const base=process.argv[2] || "http://localhost:3000";

// Old iPads need JS syntax no newer than ES5; no polyfill download required.
for (const file of ["public/compat/common.js","public/compat/kiosk.js","public/compat/desk.js"]) {
  parse(readFileSync(file,"utf8"), { ecmaVersion: 5, allowHashBang: false });
  console.log("PASS ES5 syntax:",file);
}
for (const [name,engine] of [["chromium",chromium],["webkit",webkit]]) {
  const browser=await engine.launch(name==="chromium"?chromiumLaunchOptions():{});
  const desktop=await browser.newContext({viewport:{width:1200,height:900}});
  const ipad=await browser.newContext({
    viewport:{width:768,height:1024},deviceScaleFactor:2,isMobile:name==="webkit",
    hasTouch:true,locale:"en-US",
  });
  const staff=await desktop.newPage();
  const visitor=await ipad.newPage();
  const errors=[],entries=[];
  let live=null,sessionStarted=false,liveFailuresLeft=2,liveRev=0,liveEpoch="";
  for (const page of [staff,visitor]) page.on("pageerror",err=>errors.push(err.message));
  const code="ABCD234567";
  const token="abcdefghijklmnopqrstuvwxyzABCDE1234567";
  const startRoute=async route=>{
    const req=route.request();
    if(req.method()==="POST") {
      sessionStarted=true;
      await route.fulfill({status:201,contentType:"application/json",
        body:JSON.stringify({code,staffToken:token,expiresAt:Date.now()+3600000})});return;
    }
    if(req.method()==="GET") {
      await route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify({code,expiresAt:Date.now()+3600000,entries,live})});return;
    }
    if(req.method()==="PATCH") {
      const body=req.postDataJSON();
      const found=entries.find(x=>x.seq===body.seq);
      if(found){Object.assign(found,body);delete found.code;delete found.seq;found.seq=body.seq;}
      await route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify({ok:true,entries})});return;
    }
    await route.fulfill({status:200,contentType:"application/json",body:'{"ok":true}'});
  };
  await staff.route("**/api/intake/session?*",startRoute);
  await staff.route("**/api/intake/session",startRoute);
  await visitor.route("**/api/intake/live",async route=>{
    const body=route.request().postDataJSON();
    if(body.code!==code || !body.step || "note" in body)throw Error("Invalid live payload");
    // Every response is slow, and the first two after the desk opens fail: the kiosk must
    // retry by itself and must never let an older state overwrite a newer one.
    await new Promise(r=>setTimeout(r,350));
    if(sessionStarted && liveFailuresLeft>0){
      liveFailuresLeft--;
      await route.fulfill({status:503,contentType:"application/json",body:'{"error":"temporarily unavailable"}'});return;
    }
    if(sessionStarted && !(body.epoch===liveEpoch && body.rev<=liveRev)){
      const {code:_c,...rest}=body;live={...rest,updatedAt:Date.now()};liveRev=body.rev;liveEpoch=body.epoch;
    }
    await route.fulfill({status:200,contentType:"application/json",body:'{"ok":true}'});
  });
  await visitor.route("**/api/intake/submission",async route=>{
    const body=route.request().postDataJSON();
    if(body.serviceIndex<0||body.serviceIndex>19||!body.booking||!body.language)throw Error("Invalid visitor payload");
    if(body.reservationNo!==undefined && (body.booking!=="yes" || !/^(?:[1-9]|[1-9][0-9]|10[0-8])$/.test(body.reservationNo)))throw Error("Bad reservation number payload");
    if(body.reservationDate!==undefined && (body.booking!=="yes" || !body.reservationNo || !/^20\d{2}-\d{2}-\d{2}$/.test(body.reservationDate)))throw Error("Bad appointment date payload");
    entries.push({
      seq:entries.length+1,language:body.language,serviceIndex:body.serviceIndex,
      booking:body.booking,receivedAt:Date.now(),verification:"unchecked",ticket:"pending",station:3,
      ...(body.reservationNo?{reservationNo:body.reservationNo}:{}),
      ...(body.reservationDate?{reservationDate:body.reservationDate}:{})
    });
    await route.fulfill({status:201,contentType:"application/json",
      body:JSON.stringify({accepted:true,seq:entries.length})});
  });

  try {
    const staffResponse=await staff.goto(base+"/secret",{waitUntil:"domcontentloaded"});
    const guestResponse=await visitor.goto(base+"/intake?desk="+code,{waitUntil:"domcontentloaded"});
    if(staffResponse.headers()["content-type"].indexOf("text/html")<0 ||
       guestResponse.headers()["content-type"].indexOf("text/html")<0)throw Error("Compatibility HTML not served");
    console.log("DEBUG STAFF", JSON.stringify({
      url:staff.url(),status:staffResponse.status(),
      text:(await staff.locator("body").innerText()).slice(0,900),
      html:(await staff.locator("body").innerHTML()).slice(0,700)
    }));
    await staff.locator("#staff-station").selectOption("3");
    await staff.getByRole("button",{name:"시작",exact:true}).click({timeout:4000});
    await staff.getByRole("heading",{name:"3번 창구",exact:true}).waitFor({timeout:6000});
    await staff.getByText(code,{exact:true}).waitFor({timeout:6000});
    const qr=staff.getByRole("img",{name:"iPad 연결 QR코드"});
    await qr.waitFor({state:"visible"});
    const qrUrl=await qr.getAttribute("src");
    if(qrUrl.indexOf("station=3")<0)throw Error("QR pairing must carry the counter number");
    const qrResponse=await staff.request.get(base+qrUrl);
    if(!qrResponse.ok()||!((await qrResponse.text()).indexOf("<svg")>=0))throw Error("QR not generated");
    // The staff desk mirrors each visitor tap without any staff action.
    // All 12 languages must be visible on one screen, without scrolling.
    await visitor.locator(".langGrid .tile").first().waitFor();
    const fit=await visitor.locator(".langGrid .tile").evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}).length);
    if(fit!==12)throw Error("Only "+fit+" of 12 languages fit on the first screen");
    const mirror=staff.locator(".mirror");
    await visitor.getByRole("button",{name:"English"}).click();
    await mirror.getByText("업무 고르는 중").waitFor({timeout:12000});
    if(liveFailuresLeft!==0)throw Error("Expected the kiosk to retry failed mirror updates");
    await mirror.getByText("영어").waitFor();
    await visitor.getByRole("button",{name:/Extend my period of stay/}).click();
    await mirror.getByText("예약 여부 고르는 중").waitFor({timeout:6000});
    await mirror.getByText("체류기간 연장").waitFor();
    await visitor.getByRole("button",{name:"Yes, booked"}).click();
    await mirror.getByText("보내기 직전").waitFor({timeout:6000});
    await mirror.getByText("예약함").waitFor();
    // Out-of-range 109 is blocked; upper bound 108 reaches the staff mirror.
    for(const key of ["1","0","9"])await visitor.locator(".resvBox .keypad").getByRole("button",{name:key,exact:true}).click();
    await visitor.getByRole("button",{name:/SEND FOR STAFF REVIEW/}).click();
    await visitor.getByText("Enter a reservation number from 1 to 108.").waitFor();
    await visitor.locator(".resvBox .keypad").getByRole("button",{name:"Delete"}).click();
    await visitor.locator(".resvBox .keypad").getByRole("button",{name:"8",exact:true}).click();
    await mirror.getByText("108번").waitFor({timeout:6000});
    await visitor.getByRole("button",{name:/SEND FOR STAFF REVIEW/}).click();
    await visitor.getByText(/Request no\. #1/).waitFor({timeout:6000});
    await mirror.getByText("요청 받음 #1").waitFor({timeout:6000});
    await staff.getByText("받은 요청 1건").waitFor({timeout:6000});
    await staff.locator(".reqList").getByText("영어 · 예약함 · 108번").waitFor();
    await staff.locator(".reqList").getByText("3번 창구").waitFor();
    if(await visitor.getByText(/Staff use this number/).count())throw Error("Visitor still sees the request-number explanation");
    // Fixed phrase cards (incl. "번호표"/"예약 확인") live in .noticePanel; requests themselves need no clicks.
    if(await staff.locator(".reqList, .mirror").getByRole("button").count())throw Error("Staff desk must not require manual steps");
    // The 20th service must render on legacy iPad and reach the live staff queue.
    await visitor.getByRole("button",{name:/BACK TO START/}).click();
    await visitor.getByRole("button",{name:"English"}).click();
    await visitor.getByRole("button",{name:/More services \(11–20\)/}).click();
    await visitor.getByRole("button",{name:/Report a change of phone number/}).click();
    await visitor.getByText(/This screen only sends your reason for visiting to staff/).waitFor();
    await visitor.getByRole("button",{name:"Yes, booked"}).click();
    await visitor.getByRole("button",{name:"Appointment for another date"}).click();
    for(const key of ["1","2"])await visitor.locator(".resvBox .keypad").getByRole("button",{name:key,exact:true}).click();
    for(const key of ["2","0","2","6","0","2","3","0"])await visitor.locator(".dateEntry .keypad").getByRole("button",{name:key,exact:true}).click();
    await visitor.getByRole("button",{name:/SEND FOR STAFF REVIEW/}).click();
    await visitor.getByText("Enter a valid 8-digit appointment date.").waitFor();
    for(const key of ["Delete","Delete"])await visitor.locator(".dateEntry .keypad").getByRole("button",{name:key}).click();
    for(const key of ["2","8"])await visitor.locator(".dateEntry .keypad").getByRole("button",{name:key,exact:true}).click();
    await mirror.getByText("2026-02-28").waitFor({timeout:6000});
    await visitor.getByRole("button",{name:/SEND FOR STAFF REVIEW/}).click();
    await visitor.getByText(/Request no\. #2/).waitFor({timeout:6000});
    await staff.getByText("받은 요청 2건").waitFor({timeout:8500});
    // Fast taps with slow responses: the mirror must settle on the newest screen.
    await staff.locator(".mirror").getByText("요청 받음 #2").waitFor({timeout:8000});
    await staff.locator(".reqList").getByText("전화번호(연락처) 변경 신고").waitFor({timeout:8500});
    await staff.locator(".reqList").getByText("영어 · 예약함 · 12번 · 다른 날짜 2026-02-28").waitFor({timeout:8500});
    if(errors.length)throw Error("Browser errors: "+errors.join(" | "));
    console.log("PASS "+name+" complete: /secret → QR → iPad mini → number range 1-108 → alternate-date keypad → live mirror and queue");
  } finally {
    await desktop.close();await ipad.close();await browser.close();
  }
}
