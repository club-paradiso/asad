/**
 * Multi-desk / dual-monitor browser regression.
 * Uses synthetic staff sessions; never submits real visitor information.
 * Verifies safe popup separation, each counter's isolation, and resume after reload.
 */
import { chromium, webkit } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";

const base=process.argv[2] || "http://localhost:3000";

for(const [engineName, engine] of [["chromium",chromium],["webkit",webkit]]){
  const browser=await engine.launch(engineName==="chromium"?chromiumLaunchOptions():{});
  const context=await browser.newContext({viewport:{width:1360,height:900}});
  const staffOne=await context.newPage();
  const staffTwo=await context.newPage();
  const errors=[];
  const created=[];
  const samples=[
    {code:"ABCD234567",token:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    {code:"WXYZ234567",token:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
  ];
  for(const page of [staffOne,staffTwo]){
    page.on("pageerror",error=>errors.push(error.message));
  }

  await context.route("**/api/intake/session*",async route=>{
    const req=route.request();
    const url=new URL(req.url());
    if(req.method()==="POST"){
      const next=samples[created.length];
      if(!next)throw Error("Unexpected third staff session");
      const session={...next,expiresAt:Date.now()+3600000,entries:[],station:req.postDataJSON().station};
      created.push(session);
      await route.fulfill({status:201,contentType:"application/json",
        body:JSON.stringify({code:session.code,staffToken:session.token,expiresAt:session.expiresAt,station:session.station})});
      return;
    }
    const found=created.find(s=>s.code===url.searchParams.get("code"));
    if(!found){
      await route.fulfill({status:404,contentType:"application/json",body:'{"error":"missing"}'});return;
    }
    if(req.headers()["x-asad-intake-staff-token"]!==found.token){
      await route.fulfill({status:403,contentType:"application/json",body:'{"error":"forbidden"}'});return;
    }
    await route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({code:found.code,expiresAt:found.expiresAt,entries:found.entries,live:found.live||null,station:found.station})});
  });
  await context.route("**/api/intake/live",async route=>{
    const body=route.request().postDataJSON();
    const found=created.find(s=>s.code===body.code);
    if(found){const {code:_c,...rest}=body;found.live={...rest,updatedAt:Date.now()};}
    await route.fulfill({status:found?200:404,contentType:"application/json",body:'{"ok":true}'});
  });
  await context.route("**/api/intake/submission",async route=>{
    const body=route.request().postDataJSON();
    const found=created.find(s=>s.code===body.code);
    if(!found || body.serviceIndex<0 || body.serviceIndex>19 || !body.language || !body.booking){
      await route.fulfill({status:400,contentType:"application/json",body:'{"error":"bad request"}'});return;
    }
    found.entries.push({
      seq:found.entries.length+1,language:body.language,serviceIndex:body.serviceIndex,
      booking:body.booking,receivedAt:Date.now(),verification:"unchecked",ticket:"pending",station:found.station
    });
    await route.fulfill({status:201,contentType:"application/json",
      body:JSON.stringify({accepted:true,seq:found.entries.length})});
  });

  try{
    await Promise.all([staffOne.goto(base+"/secret"),staffTwo.goto(base+"/secret")]);
    await staffOne.locator("#staff-station").selectOption("1");
    await staffOne.getByRole("button",{name:"시작",exact:true}).click();
    await staffOne.getByText("ABCD234567",{exact:true}).waitFor();
    await staffTwo.locator("#staff-station").selectOption("2");
    await staffTwo.getByRole("button",{name:"시작",exact:true}).click();
    await staffTwo.getByText("WXYZ234567",{exact:true}).waitFor();
    if(created[0].station!==1 || created[1].station!==2)throw Error("Counter number was not sent when opening the desk");
    await staffOne.getByRole("heading",{name:"1번 창구",exact:true}).waitFor();
    await staffTwo.getByRole("heading",{name:"2번 창구",exact:true}).waitFor();

    const link=staffOne.getByRole("link",{name:"민원인 전용 화면을 새 창에서 열기"});
    const target=await link.getAttribute("target");
    const rel=await link.getAttribute("rel");
    const href=await link.getAttribute("href");
    if(target!=="_blank" || !rel.includes("noopener") || !rel.includes("noreferrer")){
      throw Error("Visitor window must be a safe standalone context");
    }
    if(!href.includes("desk=ABCD234567") || !href.includes("station=1") || !href.includes("display=1") ||
       href.includes("aaaaaaaa")){
      throw Error("Public kiosk URL or station label invalid");
    }

    const popupPromise=context.waitForEvent("page");
    await link.click();
    const visitor=await popupPromise;
    visitor.on("pageerror",err=>errors.push(err.message));
    await visitor.waitForLoadState("domcontentloaded");
    await visitor.getByText("1번 창구").waitFor();
    const leaked=await visitor.evaluate(()=>({
      token:sessionStorage.getItem("asad:intake:staff:v1"),
      opener:window.opener!==null
    }));
    if(leaked.token!==null || leaked.opener)throw Error("Visitor page inherited staff capability");
    await visitor.getByRole("button",{name:"English"}).click();
    await visitor.getByRole("button",{name:/Extend my period of stay/}).click();
    await visitor.getByRole("button",{name:"Yes, booked"}).click();
    await visitor.getByRole("button",{name:/SEND FOR STAFF REVIEW/}).click();
    await visitor.getByText(/Request no\. #1/).waitFor();
    await staffOne.getByText("받은 요청 1건").waitFor({timeout:9000});
    await staffOne.locator(".mirror").getByText("요청 받음 #1").waitFor({timeout:9000});
    // A desk with no visitor screen yet shows only how to connect one.
    await staffTwo.getByRole("heading",{name:"민원인 화면 연결"}).waitFor();
    if(await staffTwo.locator(".mirror").count())throw Error("Unconnected desk must not show an empty mirror");

    // A different staff member launches their own public-facing kiosk window.
    const secondPopupPromise=context.waitForEvent("page");
    await staffTwo.getByRole("link",{name:"민원인 전용 화면을 새 창에서 열기"}).click();
    const visitorTwo=await secondPopupPromise;
    visitorTwo.on("pageerror",err=>errors.push(err.message));
    await visitorTwo.getByText("2번 창구").waitFor();
    const secondToken=await visitorTwo.evaluate(()=>sessionStorage.getItem("asad:intake:staff:v1"));
    if(secondToken!==null)throw Error("Second visitor window inherited staff token");
    await visitorTwo.getByRole("button",{name:"English"}).click();
    await visitorTwo.getByRole("button",{name:/More services \(11–20\)/}).click();
    await visitorTwo.getByRole("button",{name:/Report a change of phone number/}).click();
    await visitorTwo.getByRole("button",{name:"Yes, booked"}).click();
    await visitorTwo.getByRole("button",{name:/SEND FOR STAFF REVIEW/}).click();
    await visitorTwo.getByText(/Request no\. #1/).waitFor();
    await staffTwo.getByText("받은 요청 1건").waitFor({timeout:9000});
    await staffTwo.locator(".reqList").getByText("전화번호(연락처) 변경 신고").waitFor({timeout:9000});
    await staffOne.getByText("받은 요청 1건").waitFor();
    // Each desk's requests carry that desk's counter, never the other one's.
    await staffOne.locator(".reqList").getByText("1번 창구").waitFor();
    await staffTwo.locator(".reqList").getByText("2번 창구").waitFor();
    if(await staffOne.locator(".reqList").getByText("2번 창구").count())throw Error("Counter 2 request leaked into counter 1");
    if(await staffTwo.locator(".reqList").getByText("1번 창구").count())throw Error("Counter 1 request leaked into counter 2");

    // A refreshed staff desk resumes only its own scoped session and display label.
    await staffOne.reload();
    await staffOne.getByRole("heading",{name:"1번 창구",exact:true}).waitFor();
    await staffOne.getByText("받은 요청 1건").waitFor({timeout:9000});
    if(errors.length)throw Error("Browser errors: "+errors.join("; "));
    console.log("PASS "+engineName+" two independent desks, no staff token in visitor window, dual-monitor launch and reload");
  }finally{
    await context.close();
    await browser.close();
  }
}
