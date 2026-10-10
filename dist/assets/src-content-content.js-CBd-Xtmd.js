(function(){console.log(`[Handsfree] Content script loaded.`),chrome.runtime.onMessage.addListener((e,t,n)=>{console.log(`[Handsfree] Received message:`,e.type),n({ok:!0})});})()
