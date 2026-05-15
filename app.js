(function(){
/*
  Simple WAD extractor: parse header and directory, list lumps,
  allow downloading individual lumps and selected lumps as ZIP.
  No external libs required. ZIP uses a minimal JS implementation.
*/

const fileInput = document.getElementById('file-input');
const dropArea = document.getElementById('drop-area');
const dropHint = document.getElementById('drop-hint');

const infoSection = document.getElementById('info');
const wadTypeEl = document.getElementById('wad-type');
const wadLumpcountEl = document.getElementById('wad-lumpcount');
const lumpList = document.getElementById('lump-list');
const lumpTpl = document.getElementById('lump-row-tpl');
const searchInput = document.getElementById('search');
const downloadAllBtn = document.getElementById('download-all');

const previewModal = document.getElementById('preview-modal');
const previewBody = document.getElementById('preview-body');
const previewClose = document.getElementById('preview-close');

let currentWad = null; // {name, arrayBuffer, lumps: [{name,offset,size,index}]}

function showError(msg){ alert(msg); }

dropArea.addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',ev => {
  if (ev.target.files && ev.target.files[0]) handleFile(ev.target.files[0]);
});

['dragenter','dragover'].forEach(e=>{
  dropArea.addEventListener(e, ev=>{
    ev.preventDefault(); ev.stopPropagation();
    dropArea.classList.add('dragover');
  });
});
['dragleave','drop'].forEach(e=>{
  dropArea.addEventListener(e, ev=>{
    ev.preventDefault(); ev.stopPropagation();
    dropArea.classList.remove('dragover');
  });
});
dropArea.addEventListener('drop', ev=>{
  const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (f) handleFile(f);
});

async function handleFile(file){
  const name = file.name;
  const ab = await file.arrayBuffer();
  try{
    const wad = parseWad(ab);
    wad.name = name;
    currentWad = wad;
    renderWad(wad);
  }catch(err){
    console.error(err);
    showError('Failed to parse WAD: '+err.message);
  }
}

function parseWad(ab){
  const dv = new DataView(ab);
  function readASCII(offset, len){
    let s='';
    for(let i=0;i<len;i++){
      s += String.fromCharCode(dv.getUint8(offset+i));
    }
    return s;
  }
  const id = readASCII(0,4);
  if(!(id==='IWAD' || id==='PWAD')) throw new Error('Not a WAD (missing IWAD/PWAD)');
  const numlumps = dv.getInt32(4, true);
  const dirofs = dv.getInt32(8, true);
  if(dirofs + numlumps*16 > dv.byteLength) throw new Error('Directory out of range');

  const lumps = [];
  for(let i=0;i<numlumps;i++){
    const base = dirofs + i*16;
    const filepos = dv.getInt32(base, true);
    const size = dv.getInt32(base+4, true);
    const name = readASCII(base+8,8).replace(/\0+$/,'');
    lumps.push({index:i, name, offset:filepos, size});
  }
  return {type:id, numlumps, dirofs, lumps, arrayBuffer:ab};
}

function renderWad(wad){
  wadTypeEl.textContent = wad.type;
  wadLumpcountEl.textContent = wad.numlumps;
  lumpList.innerHTML = '';
  infoSection.hidden = false;
  renderLumpRows(wad.lumps);
}

function renderLumpRows(lumps){
  lumpList.innerHTML = '';
  const frag = document.createDocumentFragment();
  for(const lump of lumps){
    const node = lumpTpl.content.cloneNode(true);
    const row = node.querySelector('.lump-row');
    row.dataset.index = lump.index;
    row.querySelector('.index').textContent = lump.index;
    row.querySelector('.name').textContent = lump.name;
    row.querySelector('.size').textContent = lump.size + ' bytes';
    const chk = row.querySelector('.select-lump');
    const downloadBtn = row.querySelector('.btn-download');
    const previewBtn = row.querySelector('.btn-preview');

    downloadBtn.addEventListener('click', ()=>downloadLump(lump));
    previewBtn.addEventListener('click', ()=>previewLump(lump));
    frag.appendChild(node);
  }
  lumpList.appendChild(frag);
}

function getLumpData(lump){
  return currentWad.arrayBuffer.slice(lump.offset, lump.offset + lump.size);
}

function downloadLump(lump){
  const data = getLumpData(lump);
  const blob = new Blob([data], {type:'application/octet-stream'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${padIndex(lump.index)}_${sanitizeName(lump.name)}.lmp`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function padIndex(i){ return String(i).padStart(4,'0'); }
function sanitizeName(n){ return n.replace(/[^\w\-_.]/g,'_') || 'lump'; }

function previewLump(lump){
  previewBody.innerHTML = '';
  const name = lump.name.toUpperCase();
  const data = getLumpData(lump);
  // Try simple previews: TEXT/LUMP with printable ascii, PLAYPAL (palette), PICT (Doom picture), COLORMAP or PNAMES
  if(isProbablyText(data)){
    const txt = new TextDecoder().decode(data);
    const pre = document.createElement('pre');
    pre.textContent = txt;
    previewBody.appendChild(pre);
  } else if(name==='PLAYPAL' || name==='COLORMAP'){
    // show hex + small palette for PLAYPAL
    const view = new Uint8Array(data);
    const info = document.createElement('div');
    info.textContent = `Binary (${view.byteLength} bytes). Showing hex preview:`;
    const hex = document.createElement('pre');
    hex.textContent = toHex(view.slice(0,256));
    previewBody.appendChild(info);
    previewBody.appendChild(hex);
  } else {
    const info = document.createElement('div');
    info.textContent = `Binary lump: ${lump.size} bytes.`;
    previewBody.appendChild(info);
    const hex = document.createElement('pre');
    hex.textContent = toHex(new Uint8Array(data).slice(0,256));
    previewBody.appendChild(hex);
  }
  previewModal.hidden = false;
}

previewClose.addEventListener('click', ()=> previewModal.hidden = true);
previewModal.addEventListener('click', (e)=>{ if(e.target===previewModal) previewModal.hidden=true; });

function isProbablyText(ab){
  const view = new Uint8Array(ab);
  let printable = 0;
  for(let i=0;i<view.length && i<512;i++){
    const b = view[i];
    if(b===9||b===10||b===13) printable++;
    else if(b>=32 && b<127) printable++;
  }
  return printable / Math.min(view.length,512) > 0.9;
}

function toHex(buf){
  let s='';
  const rows = Math.ceil(buf.length/16);
  for(let r=0;r<rows;r++){
    const row = buf.slice(r*16, r*16+16);
    const hex = Array.from(row).map(b=>b.toString(16).padStart(2,'0')).join(' ');
    s += hex + '\n';
  }
  return s;
}

searchInput.addEventListener('input', ()=>{
  const q = searchInput.value.trim().toLowerCase();
  const rows = lumpList.querySelectorAll('.lump-row');
  rows.forEach(row=>{
    const name = row.querySelector('.name').textContent.toLowerCase();
    const idx = row.querySelector('.index').textContent;
    if(!q || name.includes(q) || idx.includes(q)) row.style.display = '';
    else row.style.display = 'none';
  });
});

downloadAllBtn.addEventListener('click', async ()=>{
  const rows = Array.from(lumpList.querySelectorAll('.lump-row')).filter(r=>r.querySelector('.select-lump').checked && r.style.display!=='none');
  if(rows.length===0){ showError('No lumps selected'); return; }
  // Build small zip in JS (no dependencies). We'll produce a simple ZIP with stored files (no compression)
  const files = rows.map(r=>{
    const idx = Number(r.dataset.index);
    const lump = currentWad.lumps[idx];
    return {name: `${padIndex(lump.index)}_${sanitizeName(lump.name)}.lmp`, data: new Uint8Array(getLumpData(lump))};
  });
  const zipBlob = createZip(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zipBlob);
  a.download = sanitizeName(currentWad.name.replace(/\.[^.]+$/, '')) + '_lumps.zip';
  a.click();
  URL.revokeObjectURL(a.href);
});

//
// Minimal ZIP: store files (no compression) with correct local headers and central directory.
// Works for reasonably small sets. Not optimized for streaming large files.
//
function createZip(files){
  const encoder = new TextEncoder();
  const fileEntries = [];
  let offset = 0;
  // local file headers + data
  for(const f of files){
    const nameBuf = encoder.encode(f.name);
    const localHeader = new Uint8Array(30 + nameBuf.length);
    const dv = new DataView(localHeader.buffer);
    dv.setUint32(0, 0x04034b50, true); // local file header signature
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0, true); // flags
    dv.setUint16(8, 0, true); // compression (0 = stored)
    dv.setUint16(10, 0, true); // mod time
    dv.setUint16(12, 0, true); // mod date
    const crc = crc32(f.data);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, nameBuf.length, true);
    dv.setUint16(28, 0, true);
    localHeader.set(nameBuf, 30);
    fileEntries.push({localHeader, data: f.data, nameBuf, offset});
    offset += localHeader.length + f.data.length;
  }
  // central directory
  const centralParts = [];
  let centralSize = 0;
  for(const e of fileEntries){
    const cHeader = new Uint8Array(46 + e.nameBuf.length);
    const dv = new DataView(cHeader.buffer);
    dv.setUint32(0, 0x02014b50, true); // central file header signature
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0, true); // flags
    dv.setUint16(10, 0, true); // compression
    dv.setUint16(12, 0, true); // mod time
    dv.setUint16(14, 0, true); // mod date
    const crc = crc32(e.data);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, e.data.length, true);
    dv.setUint32(24, e.data.length, true);
    dv.setUint16(28, e.nameBuf.length, true);
    dv.setUint16(30, 0, true); // extra
    dv.setUint16(32, 0, true); // comment
    dv.setUint16(34, 0, true); // disk number start
    dv.setUint16(36, 0, true); // internal attrs
    dv.setUint32(38, 0, true); // external attrs
    dv.setUint32(42, e.offset, true); // relative offset of local header
    cHeader.set(e.nameBuf, 46);
    centralParts.push(cHeader);
    centralSize += cHeader.length;
  }
  const endHeader = new Uint8Array(22);
  const dvEnd = new DataView(endHeader.buffer);
  dvEnd.setUint32(0, 0x06054b50, true);
  dvEnd.setUint16(4, 0, true); // disk
  dvEnd.setUint16(6, 0, true); // disk with central
  dvEnd.setUint16(8, fileEntries.length, true); // entries this disk
  dvEnd.setUint16(10, fileEntries.length, true); // total entries
  dvEnd.setUint32(12, centralSize, true);
  dvEnd.setUint32(16, offset, true); // offset of central directory
  dvEnd.setUint16(20, 0, true); // comment length

  // assemble
  const totalSize = offset + centralSize + endHeader.length;
  const out = new Uint8Array(totalSize);
  let ptr = 0;
  for(const e of fileEntries){
    out.set(e.localHeader, ptr); ptr += e.localHeader.length;
    out.set(e.data, ptr); ptr += e.data.length;
  }
  for(const c of centralParts){ out.set(c, ptr); ptr += c.length; }
  out.set(endHeader, ptr); ptr += endHeader.length;
  return new Blob([out], {type:'application/zip'});
}

// CRC32 implementation
function crc32(buf){
  let table = crc32._table;
  if(!table){
    table = crc32._table = new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c = i;
      for(let k=0;k<8;k++){
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
  }
  let crc = 0 ^ (-1);
  for(let i=0;i<buf.length;i++){
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

})(); 