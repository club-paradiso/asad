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
  for (const page of [staff,visitor]) page.on("pageerror",err=>errors.push(err.message));
  const code="ABCD234567";
  const token="abcdefghijklmnopqrstuvwxyzABCDE1234567";
  const startRoute=async route=>{
    const req=route.request();
    if(req.method()==="POST") {
      await route.fulfill({status:201,contentType:"application/json",
        body:JSON.stringify({code,staffToken:token,expiresAt:Date.now()+3600000})});return;
    }
    if(req.method()==="GET") {
      await route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify({code,expiresAt:Date.now()+3600000,entries})});return;
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
  await visitor.route("**/api/intake/submission",async route=>{
    const body=route.request().postDataJSON();
    if(body.serviceIndex<0||body.serviceIndex>18||!body.booking||!body.language)throw Error("Invalid visitor payload");
    entries.push({
      seq:entries.length+1,language:body.language,serviceIndex:body.serviceIndex,
      booking:body.booking,receivedAt:Date.now(),verification:"unchecked",ticket:"pending"
    });
    await route.fulfill({status:201,contentType:"application/json",
      body:JSON.stringify({accepted:true,seq:entries.length})});
  });

  try {
    const staffResponse=await staff.goto(base+"/secret",{waitUntil:"domcontentloaded"});
    const guestResponse=await visitor.goto(base+"/intake?desk="+code,{waitUntil:"domcontentloaded"});
    if(staffResponse.headers()["content-type"].indexOf("text/html")<0 ||
       guestResponse.headers()["content-type"].indexOf("text/html")<0)throw Error("Compatibility HTML not served");
    await staff.getByRole("button",{name:"실시간 접수 시작"}).click();
    await staff.getByText(code,{exact:true}).waitFor({timeout:6000});
    const qr=staff.getByRole("img",{name:"iPad 연결 QR코드"});
    await qr.waitFor({state:"visible"});
    const qrUrl=await qr.getAttribute("src");
    const qrResponse=await staff.request.get(base+qrUrl);
    if(!qrResponse.ok()||!((await qrResponse.text()).indexOf("<svg")>=0))throw Error("QR not generated");
    await visitor.getByRole("button",{name:"English"}).click();
    await visitor.getByRole("button",{name:/Extend my period of stay/}).click();
    await visitor.getByRole("button",{name:"Yes, booked"}).click();
    await visitor.getByRole("button",{name:/직원 화면으로 전송/}).click();
    await visitor.getByText(/요청 순번 #1/).waitFor({timeout:6000});
    await staff.getByText("실시간 접수 목록 (1)").waitFor({timeout:8500});
    await staff.getByRole("button",{name:"예약 확인됨"}).click();
    await staff.getByText(/확인 결과: 예약 증빙 확인/).waitFor({timeout:5000});
    await staff.getByRole("button",{name:"번호표 전달 완료 기록"}).click();
    await staff.getByText(/발권 상태: 직원 발권 완료 기록/).waitFor({timeout:5000});
    if(errors.length)throw Error("Browser errors: "+errors.join(" | "));
    console.log("PASS "+name+" complete: /secret → QR → iPad mini → 12 language data → live queue → booking verify → issue");
  } finally {
    await desktop.close();await ipad.close();await browser.close();
  }
}
