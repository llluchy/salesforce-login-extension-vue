(function(){window.__sfContentInjected||(window.__sfContentInjected=!0);let a=null,r=null,u=!1,g=0,m=0,h=null;chrome.runtime.onMessage.addListener((e,d,i)=>{if(e.action==="startAreaSelect")return h=e.dataUrl,x(),i({success:!0}),!0});function x(){if(a)return;a=document.createElement("div"),a.id="sf-ql-overlay",a.style.cssText=`
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
  `,a.appendChild(r),a.appendChild(e),document.body.appendChild(a),u=!1,a.addEventListener("mousedown",v),a.addEventListener("mousemove",M),a.addEventListener("mouseup",k),document.addEventListener("keydown",w)}function v(e){e.button===0&&(e.preventDefault(),u=!0,g=e.clientX,m=e.clientY,r.style.display="block",r.style.left=g+"px",r.style.top=m+"px",r.style.width="0px",r.style.height="0px")}function M(e){if(!u)return;e.preventDefault();const d=Math.max(0,Math.min(window.innerWidth,e.clientX)),i=Math.max(0,Math.min(window.innerHeight,e.clientY)),t=Math.min(g,d),n=Math.min(m,i),o=Math.abs(d-g),c=Math.abs(i-m);r.style.left=t+"px",r.style.top=n+"px",r.style.width=o+"px",r.style.height=c+"px"}async function k(e){if(!u)return;e.preventDefault(),u=!1;const d=r.getBoundingClientRect(),i=d.left,t=d.top,n=d.width,o=d.height;if(y(),n<10||o<10){chrome.runtime.sendMessage({action:"areaCancelled",reason:"too small"});return}try{const c=await $(h,i,t,n,o);chrome.runtime.sendMessage({action:"areaSelected",dataUrl:c})}catch(c){chrome.runtime.sendMessage({action:"areaCancelled",reason:c.message})}}function w(e){e.key==="Escape"&&(y(),chrome.runtime.sendMessage({action:"areaCancelled",reason:"user cancelled"}))}function y(){u=!1,a&&a.parentNode&&a.parentNode.removeChild(a),a=null,r=null,document.removeEventListener("keydown",w)}function $(e,d,i,t,n){return new Promise((o,c)=>{const s=new Image;s.onload=()=>{const p=s.width/window.innerWidth,f=s.height/window.innerHeight,l=document.createElement("canvas");l.width=t*p,l.height=n*f,l.getContext("2d").drawImage(s,d*p,i*f,t*p,n*f,0,0,l.width,l.height),o(l.toDataURL("image/png"))},s.onerror=()=>c(new Error("图片加载失败")),s.src=e})}(function(){if(window.__sfPasskeyBridgeInjected)return;window.__sfPasskeyBridgeInjected=!0;const e="[CT]";console.log(`${e} ========== Passkey 桥接模块注入 (v4) ==========`),console.log(`${e} location:`,window.location.href);function d(){console.log(`${e} 开始注入 page-world.js...`);try{const t=document.createElement("script");t.src=chrome.runtime.getURL("page-world.js"),t.onload=function(){console.log(`${e} page-world.js 加载完成 ✅`),this.remove()},t.onerror=function(n){console.error(`${e} page-world.js 加载失败!`,n)},(document.head||document.documentElement).appendChild(t)}catch(t){console.error(`${e} injectPageWorldScript 异常:`,t.message)}}function i(t,n){window.postMessage({source:"sf-extension",requestId:t,data:n},"*")}window.addEventListener("message",async t=>{var c;if(!t.data||t.data.source!=="sf-page-world")return;const n=t.data.action,o=t.data.requestId;if(console.log(`${e} [message] 收到 page-world 消息: ${n}`,{requestId:o}),n==="sessionGet"){console.log(`${e} [sessionGet] 转发到 Background, keys:`,(c=t.data.data)==null?void 0:c.keys);try{const s=await chrome.runtime.sendMessage({action:"__sf_sessionGet",keys:t.data.data.keys||t.data.keys});i(o,s||{})}catch(s){console.error(`${e} [sessionGet] 失败:`,s.message),i(o,{})}return}if(n==="sf:passkeyGet"||n==="sf:passkeyCreate"){console.log(`${e} [${n}] 转发到 Side Panel (fire-and-forget)...`);try{chrome.runtime.sendMessage({action:n,requestId:o,data:t.data.data}).catch(s=>{console.error(`${e} [${n}] sendMessage 失败:`,s.message),i(o,{success:!1,error:s.message})})}catch(s){console.error(`${e} [${n}] 失败:`,s.message,s.stack),i(o,{success:!1,error:s.message})}return}console.warn(`${e} [message] 未处理的消息: ${n}`)}),chrome.runtime.onMessage.addListener((t,n)=>{var o,c;t.action==="sf:passkeyResult"&&(console.log(`${e} [passkeyResult] 收到 Side Panel 响应`,{requestId:t.requestId,success:(o=t.data)==null?void 0:o.success,hasCredential:!!((c=t.data)!=null&&c.credential)}),i(t.requestId,t.data))}),console.log(`${e} 开始注入脚本...`),d(),console.log(`${e} ========== 桥接模块初始化完成 (v4) ==========`)})();
})()
