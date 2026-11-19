/* eslint-disable @typescript-eslint/no-unused-vars -- ES5 catch bindings cannot be omitted (pre-Safari 15). */
/* ASAD intake compatibility runtime: ES5 syntax, no frameworks or external JS. */
(function (window, document) {
  "use strict";
  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (typeof text !== "undefined" && text !== null) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function btn(label, onclick, cls) {
    var b = el("button", label, cls || "btn");
    b.type = "button";
    b.onclick = onclick;
    return b;
  }
  function actions() {
    var n = el("div", null, "actions");
    for (var i = 0; i < arguments.length; i++) n.appendChild(arguments[i]);
    return n;
  }
  function intro(step, title, desc) {
    return add(el("section", null, "hero"),el("p", step, "step"), el("h1", title), el("p", desc));
  }
  function storageRead(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function storageWrite(key, value) {
    try { window.sessionStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function storageRemove(key) {
    try { window.sessionStorage.removeItem(key); } catch (e) { /* no storage */ }
  }
  function getQuery(name) {
    var q = window.location.search.substring(1).split("&");
    for (var i=0;i<q.length;i++) {
      var pair = q[i].split("=");
      if (decodeURIComponent(pair[0]) === name) {
        try { return decodeURIComponent((pair[1] || "").replace(/\+/g, " ")); }
        catch(e) { return ""; }
      }
    }
    return "";
  }
  function request(method, path, body, headers, callback) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    function done(err, data) {
      if (finished) return;
      finished = true;
      callback(err, data, xhr.status);
    }
    try {
      xhr.open(method, path, true);
      xhr.timeout = 12000;
      xhr.withCredentials = true;
      xhr.setRequestHeader("Accept", "application/json");
      if (body !== null && typeof body !== "undefined") xhr.setRequestHeader("Content-Type", "application/json");
      if (headers) for (var name in headers)
        if (Object.prototype.hasOwnProperty.call(headers, name)) xhr.setRequestHeader(name, headers[name]);
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* malformed response */ }
        if (xhr.status >= 200 && xhr.status < 300 && data) return done(null, data);
        return done((data && data.error) || "서버 응답 오류 (HTTP " + xhr.status + ")", data);
      };
      xhr.onerror = function () { done("네트워크 연결 실패. 와이파이와 주소를 확인해 주세요."); };
      xhr.ontimeout = function () { done("서버 응답이 지연됩니다. 다시 시도해 주세요."); };
      xhr.onabort = function () { done("요청이 중단되었습니다."); };
      xhr.send(body !== null && typeof body !== "undefined" ? JSON.stringify(body) : null);
    } catch (e) { done("이 브라우저에서 요청을 보낼 수 없습니다."); }
    return xhr;
  }
  function uuid() {
    var crypto = window.crypto || window.msCrypto;
    if (!crypto || !crypto.getRandomValues) return "";
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var result = [];
    for (var i=0; i<16; i++) {
      var n = b[i].toString(16);
      result.push(n.length===1 ? "0"+n:n);
    }
    return result.slice(0,4).join("")+"-"+result.slice(4,6).join("")+"-"+result.slice(6,8).join("")+"-"+result.slice(8,10).join("")+"-"+result.slice(10,16).join("");
  }
  function queryCode(s) { return /^[A-HJ-NP-Z2-9]{10}$/.test(s); }
  window.ASADCompat = {
    el:el,add:add,clear:clear,btn:btn,actions:actions,intro:intro,
    request:request,uuid:uuid,getQuery:getQuery,queryCode:queryCode,
    storageRead:storageRead,storageWrite:storageWrite,storageRemove:storageRemove
  };
})(window, document);
