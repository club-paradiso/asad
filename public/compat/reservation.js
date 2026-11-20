/* Shared by the paired kiosk and the single-file offline kiosk. Safari 15 / ES5. */
(function(window){
  "use strict";
  // Other date, field labels, validation messages, clear, today, optional, backspace.
  var copy = {
    KO: ["다른 날짜로 예약했어요","예약 날짜 (YYYYMMDD)","예약번호 (1~108)","실제 예약 날짜를 숫자 8자리로 입력해 주세요.","예약번호는 1부터 108까지 입력해 주세요.","지우기","오늘로 예약했어요","선택","한 자리 지우기"],
    EN: ["Booked for another date","Booking date (YYYYMMDD)","Booking number (1–108)","Enter a valid booking date using eight digits.","Enter a booking number from 1 to 108.","Clear","Booked for today","optional","Delete last digit"],
    "ZH-CN": ["预约了其他日期","预约日期（YYYYMMDD）","预约号码（1–108）","请输入有效的八位数字预约日期。","请输入 1 到 108 之间的预约号码。","清空","预约了今天","选填","删除最后一位"],
    ID: ["Sudah memesan untuk tanggal lain","Tanggal janji temu (YYYYMMDD)","Nomor janji temu (1–108)","Masukkan tanggal janji temu yang valid dengan delapan digit.","Masukkan nomor janji temu dari 1 sampai 108.","Hapus semua","Sudah memesan untuk hari ini","opsional","Hapus digit terakhir"],
    HI: ["किसी और तारीख़ के लिए बुक किया है","बुकिंग की तारीख़ (YYYYMMDD)","बुकिंग नंबर (1–108)","बुकिंग की सही तारीख़ आठ अंकों में दर्ज करें।","1 से 108 तक का बुकिंग नंबर दर्ज करें।","साफ़ करें","आज के लिए बुक किया है","वैकल्पिक","पिछला अंक हटाएँ"],
    VI: ["Đã đặt lịch vào ngày khác","Ngày hẹn (YYYYMMDD)","Số đặt lịch (1–108)","Nhập ngày hẹn hợp lệ bằng 8 chữ số.","Nhập số đặt lịch từ 1 đến 108.","Xóa hết","Đã đặt lịch hôm nay","không bắt buộc","Xóa chữ số cuối"],
    JA: ["別の日に予約しました","予約日（YYYYMMDD）","予約番号（1〜108）","有効な予約日を8桁の数字で入力してください。","1〜108の予約番号を入力してください。","クリア","今日の予約があります","任意","最後の数字を消す"],
    TH: ["จองไว้สำหรับวันอื่น","วันที่จอง (YYYYMMDD)","หมายเลขการจอง (1–108)","กรอกวันที่นัดหมายที่ถูกต้องเป็นตัวเลข 8 หลัก","กรอกหมายเลขการจองตั้งแต่ 1 ถึง 108","ล้าง","จองไว้สำหรับวันนี้","ไม่บังคับ","ลบตัวเลขตัวสุดท้าย"],
    RU: ["Запись на другую дату","Дата записи (ГГГГММДД)","Номер записи (1–108)","Введите действительную дату записи из восьми цифр.","Введите номер записи от 1 до 108.","Очистить","Запись на сегодня","необязательно","Удалить последнюю цифру"],
    UZ: ["Boshqa kunga band qilganman","Bandlov sanasi (YYYYMMDD)","Bandlov raqami (1–108)","Bandlov sanasini sakkizta raqam bilan to‘g‘ri kiriting.","1 dan 108 gacha bandlov raqamini kiriting.","Tozalash","Bugunga band qilganman","ixtiyoriy","Oxirgi raqamni o‘chirish"],
    MN: ["Өөр өдөр цаг авсан","Цаг авсан огноо (YYYYMMDD)","Захиалгын дугаар (1–108)","Цаг авсан огноогоо 8 цифрээр зөв оруулна уу.","1-ээс 108 хүртэлх захиалгын дугаараа оруулна уу.","Арилгах","Өнөөдөр цаг авсан","заавал биш","Сүүлийн цифрийг арилгах"],
    NE: ["अर्को मितिका लागि बुक गरेको छु","बुकिङ मिति (YYYYMMDD)","बुकिङ नम्बर (१–१०८)","बुकिङको सही मिति आठ अङ्कमा लेख्नुहोस्।","१ देखि १०८ सम्मको बुकिङ नम्बर लेख्नुहोस्।","मेटाउनुहोस्","आजका लागि बुक गरेको छु","वैकल्पिक","अन्तिम अङ्क मेटाउनुहोस्"]
  };
  function newDraft(){
    return {date:"",number:"",active:"",error:""};
  }
  function validNumber(value){
    return /^(?:[1-9][0-9]?|10[0-8])$/.test(value);
  }
  function formatDate(value){
    return value.slice(0,4)+"-"+value.slice(4,6)+"-"+value.slice(6,8);
  }
  function validDate(value){
    if(!/^[0-9]{8}$/.test(value))return false;
    var year=Number(value.slice(0,4)), month=Number(value.slice(4,6)), day=Number(value.slice(6,8));
    var leap=year%4===0 && (year%100!==0 || year%400===0);
    var days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    return year>0 && day>0 && day<=days[month-1];
  }
  function validate(booking,draft){
    if(booking==="other" && !validDate(draft.date))return "date";
    if((booking==="other" || (booking==="yes" && draft.number)) && !validNumber(draft.number))return "number";
    return "";
  }
  function details(booking,draft){
    if(booking==="other" && validDate(draft.date) && validNumber(draft.number)){
      return {reservationDate:formatDate(draft.date),reservationNo:draft.number};
    }
    return booking==="yes" && validNumber(draft.number) ? {reservationNo:draft.number} : {};
  }
  function bookingLabel(locale,booking){return copy[locale][booking==="other"?0:6];}

  function keypad(doc,booking,draft,locale,disabled,onEdit){
    var labels=copy[locale], fields={}, active=draft.active || (booking==="other"?"date":"number");
    var box=doc.createElement("section");
    box.className="resvBox";
    var inputs=doc.createElement("div");
    inputs.className="resvFields";
    box.appendChild(inputs);
    var error=doc.createElement("p");
    error.className="resvError";error.id="reservation-error";
    error.setAttribute("role","alert");
    box.appendChild(error);

    function update(){
      Object.keys(fields).forEach(function(key){
        var input=fields[key];
        input.value=key==="date" && validDate(draft.date)?formatDate(draft.date):draft[key];
        input.setAttribute("data-active",String(active===key));
        input.setAttribute("aria-invalid",String(draft.error===key));
      });
      error.textContent=draft.error?labels[draft.error==="date"?3:4]:"";
    }
    function field(key,labelText){
      var label=doc.createElement("label"), input=doc.createElement("input");
      label.className="resvLabel";
      label.textContent=labelText;
      input.type="text";input.id="reservation-"+key;input.readOnly=true;input.disabled=disabled;
      input.setAttribute("inputmode","none");input.setAttribute("aria-describedby",error.id);
      input.onfocus=input.onclick=function(){draft.active=active=key;update();};
      input.onkeydown=function(event){
        if(event.ctrlKey || event.metaKey || event.altKey)return;
        var keyValue=event.key;
        if(/^[0-9]$/.test(keyValue) || keyValue==="Backspace" || keyValue==="Delete"){
          event.preventDefault();
          press(keyValue==="Backspace"?"erase":keyValue==="Delete"?"clear":keyValue);
        }
      };
      label.appendChild(input);
      inputs.appendChild(label);
      fields[key]=input;
    }
    function press(key){
      if(disabled)return;
      var before=draft[active];
      if(key!=="erase" && key!=="clear" && before.length===(active==="date"?8:3))return;
      var after=key==="erase"?before.slice(0,-1):key==="clear"?"":before+key;
      if(before===after)return;
      draft[active]=after;
      if(draft.error===active)draft.error="";
      update();
      onEdit();
    }
    if(booking==="other")field("date",labels[1]);
    field("number",labels[2]+(booking==="yes"?" · "+labels[7]:""));
    var pad=doc.createElement("div");
    pad.className="keypad";
    ["1","2","3","4","5","6","7","8","9","clear","0","erase"].forEach(function(key){
      var button=doc.createElement("button");
      button.type="button";button.className="btn key";button.disabled=disabled;
      button.textContent=key==="erase"?"⌫":key==="clear"?labels[5]:key;
      if(key==="erase")button.setAttribute("aria-label",labels[8]);
      button.onclick=function(){press(key);};
      pad.appendChild(button);
    });
    box.appendChild(pad);
    update();
    return box;
  }
  function summary(doc,booking,draft,locale){
    var values=details(booking,draft), labels=copy[locale];
    if(!values.reservationNo)return null;
    var block=doc.createElement("div");
    function row(label,value){
      var p=doc.createElement("p");
      p.textContent=label+" "+value;
      block.appendChild(p);
    }
    if(values.reservationDate)row(labels[1].split(/ ?[(（]/)[0],values.reservationDate);
    row(labels[2].split(/ ?[(（]/)[0],values.reservationNo);
    return block;
  }
  window.ASADReservation={
    newDraft:newDraft,bookingLabel:bookingLabel,validate:validate,details:details,keypad:keypad,summary:summary
  };
})(window);
