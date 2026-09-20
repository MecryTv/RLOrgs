import{a as _,b as p,c as E,d as f,e as T,f as M,g as y,h as w,i as x,j as A,m as S,n as K}from"./chunks/chunk-OXJEA2FE.js";import"./chunks/chunk-47UUORGG.js";import{a as g,b as H,e as V}from"./chunks/chunk-3BEMOBFA.js";import{c as N,d as Y}from"./chunks/chunk-GIVT6A2M.js";import"./chunks/chunk-WPAJZQ5K.js";import"./chunks/chunk-CZHQ4F6H.js";import{d as k,e as W}from"./chunks/chunk-WC4N6S6D.js";import{a as s,b as L,c as u}from"./chunks/chunk-WRBNFJXV.js";import{a as c,b as z,c as a,d as i,f as h,g as b,j as m}from"./chunks/chunk-HUFDLLFV.js";function R(){return B}async function O(){let e;try{e=await fetch(L("/api/me"),{headers:{Accept:"application/json"}})}catch{return null}return e.status===401?(B=!0,window.location.href=`${s}/login?return=${encodeURIComponent(window.location.pathname)}`,null):e.ok?await e.json():null}var B,C=c(()=>{"use strict";u();B=!1});function $(){document.body.insertAdjacentHTML("beforeend",q+J);let e=i('meta[name="rlnexus-site"]')?.content.trim(),o=i("#footerNav");e&&o&&o.prepend(b("","Webseite",e));let t=i("#cookieBar"),n=i("#cookieOk");if(!t||!n)return;let r=!1;try{r=localStorage.getItem(I)==="1"}catch{r=!1}t.hidden=r,n.addEventListener("click",()=>{t.hidden=!0;try{localStorage.setItem(I,"1")}catch{}})}var q,J,I,P=c(()=>{"use strict";m();u();q=`
<footer class="footer">
  <div class="shell footer__inner">
    <div class="footer__brand">
      <span class="footer__mark"><img src="${s}/assets/images/rl-nexus-n-96.png" alt="" width="26" height="26" decoding="async" loading="lazy"></span>
      <span>
        <b>RL Nexus</b>
        <i>Rang-Tracking und Orga-Verwaltung f\xFCr Rocket League</i>
      </span>
    </div>

    <nav class="footer__nav" id="footerNav" aria-label="Fu\xDFzeile">
      <a href="${s}/docu">Dokumentation</a>
      <a href="${s}/docu#wtsi">WTSI erkl\xE4rt</a>
      <a href="${s}/privacy">Datenschutz</a>
      <a href="https://github.com/MecryTv/RLOrgs/issues" target="_blank" rel="noopener">Fehler melden</a>
    </nav>

    <p class="footer__note">
      Rocket League ist eine Marke von Psyonix LLC. RL Nexus steht nicht mit Psyonix oder Epic Games in Verbindung.
    </p>
  </div>
</footer>`,J=`
<div class="cookiebar" id="cookieBar" role="region" aria-label="Hinweis zu Cookies" hidden>
  <div class="cookiebar__inner">
    <span class="cookiebar__mark"><svg><use href="#i-shield"/></svg></span>
    <p class="cookiebar__text">
      RL Nexus setzt nur Cookies, die f\xFCr die Anmeldung n\xF6tig sind \u2014 kein Tracking, keine Werbung,
      keine Weitergabe. Was gespeichert wird, steht im <a href="${s}/privacy">Datenschutz</a>.
    </p>
    <button class="btn btn--primary" type="button" id="cookieOk">Verstanden</button>
  </div>
</div>`,I="rlnexus.cookies"});function U(e){let o=i("#userbox"),t=i("#profile");if(!o||!t)return;o.insertAdjacentHTML("beforeend",Q),document.body.insertAdjacentHTML("beforeend",X);let n=a("#userMenu"),r=g[e.group]??g.testphase;a("#menuAvatar").replaceChildren(w(e)),a("#menuName").textContent=e.name,a("#menuGroup").replaceChildren(h(r.icon),r.label);let v=i("#adminLink");v&&H.includes(e.group)&&(v.hidden=!1);function l(d){n.hidden=!d,t.setAttribute("aria-expanded",String(d))}t.addEventListener("click",()=>{l(t.getAttribute("aria-expanded")!=="true"),N("primary")}),document.addEventListener("click",d=>{o.contains(d.target)||l(!1)}),document.addEventListener("keydown",d=>{d.key==="Escape"&&l(!1)});let j=a("#notesModal");for(let d of document.querySelectorAll(".modal [data-close]"))d.addEventListener("click",()=>d.closest("dialog")?.close());a("#openNotes").addEventListener("click",()=>{l(!1),f(),j.showModal(),T()}),a("#clearNotes").addEventListener("click",()=>M()),a("#openTracker").href=`${s}/user/${e.id}/tracking`,a("#openSettings").href=`${s}/user/${e.id}/settings`,f(),E(),S()}var Q,X,G=c(()=>{"use strict";m();V();A();y();K();Y();u();Q=`
<span class="profile__dot" id="profileDot" hidden></span>
<div class="menu" id="userMenu" role="menu" hidden>
  <div class="menu__head">
    <span class="avatar avatar--sm" id="menuAvatar" aria-hidden="true"></span>
    <span class="menu__id"><b id="menuName"></b><span id="menuGroup"></span></span>
  </div>
  <a class="menu__item" href="${s}/admins" id="adminLink" role="menuitem" hidden>
    <svg><use href="#i-shield"/></svg><span>Administration</span>
  </a>
  <a class="menu__item" id="openTracker" role="menuitem">
    <svg><use href="#i-stats"/></svg><span>RL Tracker</span>
  </a>
  <button class="menu__item" type="button" id="openNotes" role="menuitem">
    <svg><use href="#i-bell"/></svg><span>Benachrichtigungen</span>
    <span class="menu__badge" id="noteBadge" hidden>0</span>
  </button>
  <a class="menu__item" id="openSettings" role="menuitem">
    <svg><use href="#i-settings"/></svg><span>Einstellungen</span>
  </a>
  <div class="menu__line"></div>
  <a class="menu__item menu__item--warn" href="${s}/logout" role="menuitem">
    <svg><use href="#i-logout"/></svg><span>Abmelden</span>
  </a>
</div>`,X=`
<dialog class="modal" id="notesModal" aria-labelledby="notesTitle">
  <div class="modal__head">
    <div>
      <h2 id="notesTitle">Benachrichtigungen</h2>
      <p>Alles, was dich betrifft. Auf jedem Ger\xE4t dasselbe.</p>
    </div>
    <button class="iconbtn modal__x" type="button" data-close aria-label="Schlie\xDFen"><svg><use href="#i-x"/></svg></button>
  </div>
  <div class="modal__body">
    <div class="notes" id="noteList"></div>
    <button class="linkrow" type="button" id="clearNotes"><svg><use href="#i-x"/></svg>Alle l\xF6schen</button>
  </div>
</dialog>`});function D(){let e=i(".topbar");if(!e)return;let o=i(".controls"),t=()=>{if(e.classList.toggle("is-stuck",window.scrollY>8),o){let n=o.getBoundingClientRect().top<=e.offsetHeight+1;o.classList.toggle("is-stuck",n)}};window.addEventListener("scroll",t,{passive:!0}),t()}var F=c(()=>{"use strict";m()});var te=z(()=>{m();C();W();y();P();A();G();F();function Z(){let e=i("#empty"),o=i("#grid");if(o&&o.replaceChildren(),!e)return;e.classList.add("is-on","empty--error");let t=i("#emptyIcon use");t&&t.setAttribute("href","#i-warn"),a("#emptyTitle").textContent="Serverliste nicht erreichbar",a("#emptyText").textContent="Der Bot antwortet gerade nicht oder Discord hat die Anfrage gebremst. Lade die Seite in einem Moment neu.";let n=i("#emptyReset");n&&(n.textContent="Neu laden",n.addEventListener("click",()=>window.location.reload()));let r=i("#resultline");r&&(r.textContent="Laden fehlgeschlagen")}async function ee(){let e=document.body.dataset.page;if(D(),k(),$(),e==="static"){(await import("./chunks/Docu-VP46AIGI.js")).bindDocNav();return}if(e==="board"){await(await import("./chunks/Board-7F7TDZZS.js")).renderBoard();return}let o=e==="guild"?import("./chunks/Guild-M277JY37.js").then(r=>(r.prefetchGuild(),r)):e==="admin"?import("./chunks/Admin-SUDBAJGE.js"):e==="tracking"?import("./chunks/Tracking-XHOUDAQ5.js"):e==="settings"?import("./chunks/Settings-PEUMQS3V.js"):import("./chunks/Servers-PX6OSCN2.js").then(r=>(e==="servers"&&r.skeletons(6),r)),t=await O();if(!t){R()||Z();return}x(t.user),U(t.user),p(),window.setInterval(()=>{p()},_);let n=await o;"renderGuild"in n?n.renderGuild(t):"renderAdmin"in n?n.renderAdmin():"renderTracking"in n?n.renderTracking():"renderSettings"in n?n.renderSettings(t.user):n.renderServers(t)}ee()});export default te();
