(function(){window.__sfContentInjected||(window.__sfContentInjected=!0);let o=null,r=null,u=!1,m=0,p=0,g=null;chrome.runtime.onMessage.addListener((e,i,a)=>{if(e.action==="startAreaSelect")return g=e.dataUrl,x(),a({success:!0}),!0});function x(){if(o)return;o=document.createElement("div"),o.id="sf-ql-overlay",o.style.cssText=`
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    z-index: 2147483646;
    cursor: crosshair;
  `,r=document.createElement("div"),r.id="sf-ql-selection",r.style.cssText=`
    position: fixed;
    border: 2px solid #00A1E0;
    background: rgba(0, 161, 224, 0.1);
    pointer-events: none;
    z-index: 2147483647;
    display: none;
    box-sizing: border-box;
  `;const e=document.createElement("div");e.id="sf-ql-tip",e.textContent="拖拽选择二维码区域，按 ESC 取消",e.style.cssText=`
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.75);
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: none;
  `,o.appendChild(r),o.appendChild(e),document.body.appendChild(o),u=!1,o.addEventListener("mousedown",v),o.addEventListener("mousemove",M),o.addEventListener("mouseup",k),document.addEventListener("keydown",w)}function v(e){e.button===0&&(e.preventDefault(),u=!0,m=e.clientX,p=e.clientY,r.style.display="block",r.style.left=m+"px",r.style.top=p+"px",r.style.width="0px",r.style.height="0px")}function M(e){if(!u)return;e.preventDefault();const i=Math.max(0,Math.min(window.innerWidth,e.clientX)),a=Math.max(0,Math.min(window.innerHeight,e.clientY)),t=Math.min(m,i),n=Math.min(p,a),c=Math.abs(i-m),s=Math.abs(a-p);r.style.left=t+"px",r.style.top=n+"px",r.style.width=c+"px",r.style.height=s+"px"}async function k(e){if(!u)return;e.preventDefault(),u=!1;const i=r.getBoundingClientRect(),a=i.left,t=i.top,n=i.width,c=i.height;if(y(),n<10||c<10){chrome.runtime.sendMessage({action:"areaCancelled",reason:"too small"});return}try{const s=await C(g,a,t,n,c);chrome.runtime.sendMessage({action:"areaSelected",dataUrl:s})}catch(s){chrome.runtime.sendMessage({action:"areaCancelled",reason:s.message})}}function w(e){e.key==="Escape"&&(y(),chrome.runtime.sendMessage({action:"areaCancelled",reason:"user cancelled"}))}function y(){u=!1,o&&o.parentNode&&o.parentNode.removeChild(o),o=null,r=null,document.removeEventListener("keydown",w)}function C(e,i,a,t,n){return new Promise((c,s)=>{const d=new Image;d.onload=()=>{const f=d.width/window.innerWidth,h=d.height/window.innerHeight,l=document.createElement("canvas");l.width=t*f,l.height=n*h,l.getContext("2d").drawImage(d,i*f,a*h,t*f,n*h,0,0,l.width,l.height),c(l.toDataURL("image/png"))},d.onerror=()=>s(new Error("图片加载失败")),d.src=e})}(function(){if(window.__sfPasskeyBridgeInjected)return;window.__sfPasskeyBridgeInjected=!0;const e="[CT]";function i(){try{const t=document.createElement("script");t.src=chrome.runtime.getURL("page-world.js"),t.onload=function(){this.remove()},t.onerror=function(n){console.error(`${e} page-world.js 加载失败!`,n)},(document.head||document.documentElement).appendChild(t)}catch(t){console.error(`${e} injectPageWorldScript 异常:`,t.message)}}function a(t,n){window.postMessage({source:"sf-extension",requestId:t,data:n},"*")}window.addEventListener("message",async t=>{if(!t.data||t.data.source!=="sf-page-world")return;const n=t.data.action,c=t.data.requestId;if(n==="sessionGet"){try{const s=await chrome.runtime.sendMessage({action:"__sf_sessionGet",keys:t.data.data.keys||t.data.keys});a(c,s||{})}catch(s){console.error(`${e} [sessionGet] 失败:`,s.message),a(c,{})}return}if(n==="sf:passkeyGet"||n==="sf:passkeyCreate"){try{chrome.runtime.sendMessage({action:n,requestId:c,data:t.data.data}).catch(s=>{console.error(`${e} [${n}] sendMessage 失败:`,s.message),a(c,{success:!1,error:s.message})})}catch(s){console.error(`${e} [${n}] 失败:`,s.message,s.stack),a(c,{success:!1,error:s.message})}return}console.error(`${e} [message] 未处理的消息: ${n}`)}),chrome.runtime.onMessage.addListener((t,n)=>{t.action==="sf:passkeyResult"&&a(t.requestId,t.data)}),i(),console.log(`${e} ========== 桥接模块初始化完成 (v4) ==========`)})();
})()
