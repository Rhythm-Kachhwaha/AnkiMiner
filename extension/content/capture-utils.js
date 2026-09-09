(function(global){
  const JAPANESE=/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
  function selectedText(selection){return !selection||selection.rangeCount===0?"":selection.toString().trim().replace(/\s+/g," ");}
  function containsJapanese(text){return typeof text==="string"&&JAPANESE.test(text);}
  function captureMessage(text){return {type:"JAPANESE_TEXT_CAPTURED",text};}
  global.AnkiMinerCapture={selectedText,containsJapanese,captureMessage};
})(typeof globalThis==="undefined"?window:globalThis);
