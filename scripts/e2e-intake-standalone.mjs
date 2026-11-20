/**
 * Tests the real standalone kiosk from file://, with NO HTTP server or network.
 * The main and mirrored visitor windows must share one in-memory flow.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, webkit } from "playwright";
import { parse } from "acorn";
import { chromiumLaunchOptions } from "./browser.mjs";

const path=resolve("apps/visitor-intake/index.html");
const html=readFileSync(path,"utf8");
const sourceCode=Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),m=>m[1]);
if(sourceCode.length!==2)throw Error("Offline single-file HTML must contain exactly two inline scripts");
for(const s of sourceCode)parse(s,{ecmaVersion:5});
if(!html.includes("data:image/png;base64,") || !html.includes("window.ASAD_OFFLINE_DATA="))throw Error("Translation and branding must be embedded");
if(/<script[^>]+src=|<link[^>]+rel=["']stylesheet|<img[^>]+src=["']https?:/i.test(html))throw Error("External dependency in offline HTML");
if(/fetch\s*\(|XMLHttpRequest\s*\(|WebSocket\s*\(/.test(sourceCode[1]))throw Error("Offline version must not access network");

for(const [name,engine] of [["chromium",chromium],["webkit",webkit]]){
  const browser=await engine.launch(name==="chromium"?chromiumLaunchOptions():{});
  const context=await browser.newContext({viewport:{width:1200,height:950}});
  const staff=await context.newPage();
  const errors=[],network=[];
  context.on("request",r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  context.on("page",page=>page.on("pageerror",err=>errors.push(err.message)));
  try{
    await staff.goto(pathToFileURL(path).toString());
    await staff.getByRole("heading",{name:"언어를 선택하세요"}).waitFor();
    if(await staff.locator(".langGrid .tile").count()!==12)throw Error("Must show 12 languages on one page");

    await staff.getByRole("button",{name:"English"}).click();
    if(await staff.locator(".grid .tile").count()!==10)throw Error("First service page must have 10 services");
    await staff.getByRole("button",{name:/Extend my period of stay/}).click();
    await staff.getByRole("heading",{name:"Have you booked a visit on HiKorea?"}).waitFor();
    await staff.getByRole("button",{name:"Booked for today"}).click();
    await staff.getByRole("button",{name:/직원에게 보여주기/}).click();
    await staff.getByRole("heading",{name:"Please show this screen to staff"}).waitFor();
    await staff.getByRole("button",{name:"BACK TO START"}).click();

    const nextPage=context.waitForEvent("page");
    await staff.getByRole("button",{name:"보조 모니터 열기"}).click();
    const visitor=await nextPage;
    await visitor.locator("#display-app").getByRole("heading",{name:"언어를 선택하세요"}).waitFor();
    if(await visitor.locator("#display-app .langGrid .tile").count()!==12)throw Error("Visitor window did not mirror language list");

    await visitor.getByRole("button",{name:"English"}).click();
    await staff.getByRole("heading",{name:"How can we help you today?"}).waitFor();
    await staff.getByRole("button",{name:/More services/}).click();
    await visitor.getByRole("button",{name:/Report a change of phone number/}).click();
    await staff.getByRole("heading",{name:"Report a change of phone number"}).waitFor();
    await visitor.getByRole("button",{name:"Not booked"}).click();
    if((await staff.locator("#app .choiceGrid button[aria-pressed=true]").innerText()).trim()!=="Not booked")throw Error("Visitor booking selection not mirrored to staff");
    await staff.getByRole("button",{name:/직원에게 보여주기/}).click();
    await visitor.getByRole("heading",{name:"Please show this screen to staff"}).waitFor();
    await visitor.getByText(/No phone number change is submitted here/).waitFor();
    await staff.getByText("안내 전용입니다. 실제 신고, 예약 확인 및 번호표 발급은 이루어지지 않았습니다.").waitFor();

    await visitor.getByRole("button",{name:"BACK TO START"}).click();
    await visitor.getByRole("button",{name:"English"}).click();
    await visitor.getByRole("button",{name:/Extend my period of stay/}).click();
    await visitor.getByRole("button",{name:"Booked for another date"}).click();
    const tap=async (page,digits)=>{
      for(const digit of digits)await page.locator(".keypad").getByRole("button",{name:digit,exact:true}).click();
    };
    await tap(visitor,"20280431");
    const show=staff.getByRole("button",{name:/직원에게 보여주기/});
    await show.click();
    await visitor.getByText("Enter a valid booking date using eight digits.").waitFor();
    await staff.getByRole("button",{name:"Clear",exact:true}).click();
    await tap(staff,"20280430");
    if(await visitor.locator("#reservation-date").inputValue()!=="2028-04-30")throw Error("Date was not mirrored to the visitor");
    await visitor.locator("#reservation-number").click();
    await tap(visitor,"109");
    await show.click();
    await staff.getByText("Enter a booking number from 1 to 108.").waitFor();
    await visitor.getByRole("button",{name:"Delete last digit"}).click();
    await tap(visitor,"8");
    await show.click();
    await staff.getByText("예약 날짜 2028-04-30").waitFor();
    await visitor.getByText("Booking number 108",{exact:true}).waitFor();

    // A new session resets BOTH displays without sending a network request.
    await staff.getByRole("button",{name:"처음부터"}).click();
    await visitor.getByRole("heading",{name:"언어를 선택하세요"}).waitFor();
    if(network.length)throw Error("Unexpected network requests: "+network.join(", "));
    if(errors.length)throw Error("Browser errors: "+errors.join(" / "));
    console.log("PASS "+name+": fully offline file://, bilingual service, popup sync, phone-change disclaimer, other-date keypad and reset");
  } finally {
    await context.close();
    await browser.close();
  }
}
