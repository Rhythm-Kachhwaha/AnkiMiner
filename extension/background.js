chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(() => {}));
async function activeTab(){const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});return tab;}
async function ensureContentScript(tabId){try{await chrome.tabs.sendMessage(tabId,{type:"PING_ANKI_MINER"});}catch{await chrome.scripting.executeScript({target:{tabId},files:["content/capture-utils.js","content/content.js"]});}}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="SET_MINING_MODE"){
    activeTab().then(async tab=>{if(!tab?.id)throw new Error("No active tab is available.");await ensureContentScript(tab.id);await chrome.tabs.sendMessage(tab.id,{type:"MINING_MODE_CHANGED",enabled:message.enabled});sendResponse({ok:true,stage:"content-script"});}).catch(error=>sendResponse({ok:false,stage:"content-script",error:`Capture setup failed: ${error.message}`}));return true;
  }
  if(message?.type==="JAPANESE_TEXT_CAPTURED"){
    chrome.runtime.sendMessage({...message,tabId:sender.tab?.id}).then(()=>sendResponse({ok:true,stage:"side-panel"})).catch(error=>sendResponse({ok:false,stage:"side-panel",error:`Side Panel did not receive capture: ${error.message}`}));return true;
  }
});
