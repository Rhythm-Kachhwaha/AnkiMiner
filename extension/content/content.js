(() => {
  let miningMode=false;
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message?.type==="PING_ANKI_MINER")respond({ok:true});
    if(message?.type==="MINING_MODE_CHANGED"){miningMode=message.enabled;respond({ok:true});}
  });
  function captureSelection(){
    if(!miningMode)return;
    const text=AnkiMinerCapture.selectedText(window.getSelection());
    if(!text)return;
    if(!AnkiMinerCapture.containsJapanese(text)){chrome.runtime.sendMessage({type:"CAPTURE_DIAGNOSTIC",stage:"selection",error:"Selected text contains no Japanese characters."}).catch(()=>{});return;}
    chrome.runtime.sendMessage(AnkiMinerCapture.captureMessage(text)).then(result=>{if(!result?.ok)chrome.runtime.sendMessage({type:"CAPTURE_DIAGNOSTIC",stage:result?.stage||"messaging",error:result?.error||"Capture message failed."}).catch(()=>{});}).catch(error=>chrome.runtime.sendMessage({type:"CAPTURE_DIAGNOSTIC",stage:"messaging",error:error.message}).catch(()=>{}));
  }
  document.addEventListener("mouseup",captureSelection,true);
  document.addEventListener("keyup",event=>{if(event.key==="Shift"||event.key.startsWith("Arrow"))captureSelection();},true);
})();
