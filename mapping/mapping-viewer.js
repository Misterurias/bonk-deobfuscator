// Bonk Deobfuscator Mapping Viewer — Virtual Scrolling Edition
var D = window.BONK_MAP_DATA;
var nameMap    = D.nameMap;
var funcIndex  = D.funcIndex;
var obfLines   = D.obfLines;
var deobfLines = D.deobfLines;

// ── Stats bar ──────────────────────────────────────────────────────────
document.getElementById('gen-date').textContent         = D.generated;
document.getElementById('stat-renamed').textContent     = D.stats.renamed;
document.getElementById('stat-funcs').textContent       = D.stats.functions;
document.getElementById('stat-classes').textContent     = D.stats.classes;
document.getElementById('stat-lines').textContent       = D.stats.maxLines;
document.getElementById('stat-obf-total').textContent   = obfLines.length;
document.getElementById('stat-deobf-total').textContent = deobfLines.length;

// ── Reverse map ────────────────────────────────────────────────────────
var reverseMap = {};
for (var _k in nameMap) reverseMap[nameMap[_k]] = _k;

// ── Keywords ───────────────────────────────────────────────────────────
var KW = {var:1,let:1,const:1,function:1,class:1,return:1,if:1,else:1,for:1,while:1,do:1,switch:1,case:1,break:1,continue:1,new:1,this:1,typeof:1,instanceof:1,import:1,export:1,default:1,try:1,catch:1,finally:1,throw:1,async:1,await:1,of:1,in:1,true:1,false:1,null:1,undefined:1,void:1,delete:1,static:1,extends:1,super:1,yield:1};

// ── HTML escape ────────────────────────────────────────────────────────
function eh(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Syntax highlighter (with per-line cache) ───────────────────────────
var hlCache = [{}, {}];
function hlLine(line, isObf) {
  var cache = hlCache[isObf ? 0 : 1];
  if (cache[line] !== undefined) return cache[line];

  // Preserve leading whitespace as indentation
  var indent = '';
  var si = 0;
  while (si < line.length && line[si] === ' ') { indent += ' '; si++; }

  var out = '', i = si;
  while (i < line.length) {
    if (line[i] === '/' && line[i+1] === '/') {
      out += '<span class="hl-comment">' + eh(line.slice(i)) + '</span>'; break;
    }
    if (line[i] === '"' || line[i] === "'") {
      var q = line[i], j = i+1;
      while (j < line.length && line[j] !== q) { if (line[j] === '\\') j++; j++; }
      out += '<span class="hl-string">' + eh(line.slice(i,j+1)) + '</span>';
      i = j+1; continue;
    }
    if (line[i] === '`') {
      var j = i+1;
      while (j < line.length && line[j] !== '`') { if (line[j] === '\\') j++; j++; }
      out += '<span class="hl-string">' + eh(line.slice(i,j+1)) + '</span>';
      i = j+1; continue;
    }
    if (/[0-9]/.test(line[i]) && (i===si || !/[a-zA-Z_$]/.test(line[i-1]))) {
      var j = i;
      while (j < line.length && /[0-9a-fA-FxX._]/.test(line[j])) j++;
      out += '<span class="hl-number">' + eh(line.slice(i,j)) + '</span>';
      i = j; continue;
    }
    if (/[a-zA-Z_$]/.test(line[i])) {
      var j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      var w = line.slice(i,j);
      if (KW[w]) {
        out += '<span class="hl-keyword">' + w + '</span>';
      } else if (isObf && nameMap[w]) {
        out += '<span class="hl-renamed" data-obf="' + eh(w) + '" data-deobf="' + eh(nameMap[w]) + '">' + eh(w) + '</span>';
      } else if (!isObf && reverseMap[w]) {
        out += '<span class="hl-renamed" data-obf="' + eh(reverseMap[w]) + '" data-deobf="' + eh(w) + '">' + eh(w) + '</span>';
      } else {
        out += eh(w);
      }
      i = j; continue;
    }
    out += eh(line[i]); i++;
  }
  var result = indent + out;
  cache[line] = result;
  return result;
}

// ── Virtual scroller ───────────────────────────────────────────────────
// Only renders rows in the visible viewport ± OVERSCAN rows.
// The spacer div holds the total scrollable height so the scrollbar is correct.
var ROW_H    = 20;
var OVERSCAN = 40;

function VirtualTable(scrollEl, lines, isObf) {
  this.scrollEl       = scrollEl;
  this.lines          = lines;
  this.isObf          = isObf;
  this.rendered       = {};
  this.highlightedRow = null;

  this.spacer = document.createElement('div');
  this.spacer.style.cssText = 'position:relative;width:100%;height:' + (lines.length * ROW_H) + 'px;';
  scrollEl.appendChild(this.spacer);

  var self = this;
  scrollEl.addEventListener('scroll', function() { self.render(); }, { passive: true });
  window.addEventListener('resize',  function() { self.render(); }, { passive: true });
  this.render();
}

VirtualTable.prototype.render = function() {
  var scrollTop = this.scrollEl.scrollTop;
  var viewH     = this.scrollEl.clientHeight;
  var start = Math.max(0,                Math.floor(scrollTop / ROW_H) - OVERSCAN);
  var end   = Math.min(this.lines.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  // Recycle rows that are now far off-screen
  for (var k in this.rendered) {
    var ki = parseInt(k, 10);
    if (ki < start || ki >= end) {
      this.spacer.removeChild(this.rendered[k]);
      delete this.rendered[k];
    }
  }

  // Stamp in rows that just entered the render window
  for (var i = start; i < end; i++) {
    if (this.rendered[i]) continue;
    var row = document.createElement('div');
    row.id        = (this.isObf ? 'obf' : 'deobf') + '-ln-' + (i + 1);
    row.className = 'vrow';
    row.style.top = (i * ROW_H) + 'px';
    row.innerHTML =
      '<span class="ln">' + (i + 1) + '</span>' +
      '<span class="code">' + hlLine(this.lines[i], this.isObf) + '</span>';
    this.spacer.appendChild(row);
    this.rendered[i] = row;
  }
};

VirtualTable.prototype.scrollToLine = function(lineNum, highlight) {
var targetTop = (lineNum - 1) * ROW_H
this.scrollEl.scrollTop = Math.max(0, targetTop - this.scrollEl.clientHeight / 2)
var self = this
requestAnimationFrame(function() {
requestAnimationFrame(function() {
self.render()
var row = document.getElementById(
 (self.isObf ? 'obf' : 'deobf') + '-ln-' + lineNum
)
if (row && highlight) {
if (self.highlightedRow)
self.highlightedRow.classList.remove('highlight-row')
row.classList.add('highlight-row')
self.highlightedRow = row
}
})
})
}

// ── Boot both panels ──────────────────────────────────────────────────
var vtObf   = new VirtualTable(document.getElementById('obfScroll'),   obfLines,   true);
var vtDeobf = new VirtualTable(document.getElementById('deobfScroll'), deobfLines, false);

// ── Sync scrolling ────────────────────────────────────────────────────
var syncScroll   = false;
var syncingObf   = false;
var syncingDeobf = false;
document.getElementById('syncToggle').addEventListener('change', function(e) {
  syncScroll = e.target.checked;
});
 document.getElementById('obfScroll').addEventListener('scroll', function() {
if (!syncScroll || syncingObf) return;
 syncingDeobf = true;
 var obf = this
  var deobf = document.getElementById('deobfScroll')
  var ratio = obf.scrollTop / (obf.scrollHeight - obf.clientHeight)
  deobf.scrollTop = ratio * (deobf.scrollHeight - deobf.clientHeight)
  syncingDeobf = false
}, { passive: true })
document.getElementById('deobfScroll').addEventListener('scroll', function() {
if (!syncScroll || syncingDeobf) return
syncingObf = true
var deobf = this
var obf = document.getElementById('obfScroll')
var ratio = deobf.scrollTop / (deobf.scrollHeight - deobf.clientHeight)
obf.scrollTop = ratio * (obf.scrollHeight - obf.clientHeight)
syncingObf = false
}, { passive: true })
// ── Cross-panel highlight by name ─────────────────────────────────────
function findFirstLine(linesArr, word) {
  var re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  for (var i = 0; i < linesArr.length; i++) {
    if (re.test(linesArr[i])) return i + 1;
  }
  return null;
}

function hlByName(o, d) {
  var deobfLine = findFirstLine(deobfLines, d);
  var obfLine   = findFirstLine(obfLines,   o);
  if (deobfLine) vtDeobf.scrollToLine(deobfLine, true);
  if (obfLine)   vtObf.scrollToLine(obfLine,     true);
}

// ── Function sidebar ──────────────────────────────────────────────────
var KC = { 'function': '#d2a8ff', 'class': '#ffa657', 'arrow/expr': '#79c0ff' };
var FL = document.getElementById('funcList');
funcIndex.forEach(function(f) {
  var div = document.createElement('div'); div.className = 'func-item';
  var nm  = document.createElement('span'); nm.className = 'fname';
  nm.style.color = KC[f.kind] || '#c9d1d9'; nm.textContent = f.name;
  var mt  = document.createElement('span'); mt.className = 'fmeta';
  mt.textContent = f.kind + ' line ' + f.line + (f.args ? ' (' + f.args + ')' : '');
  div.appendChild(nm); div.appendChild(mt);
  div.addEventListener('click', function() {
    vtDeobf.scrollToLine(f.line, true);
var mapped = reverseMap[f.name]
if (mapped) {
var obfLine = findFirstLine(obfLines, mapped)
if (obfLine) vtObf.scrollToLine(obfLine, true)
}
var on = reverseMap[f.name]
if (on) hlByName(on, f.name)
  });
  FL.appendChild(div);
});

// ── Tooltip ───────────────────────────────────────────────────────────
var TT = document.getElementById('tooltip');
document.addEventListener('mousemove', function(e) {
  if (e.target.classList.contains('hl-renamed')) {
    TT.style.display = 'block';
    TT.style.left = (e.clientX + 14) + 'px';
    TT.style.top  = (e.clientY - 8)  + 'px';
    TT.innerHTML =
      '<span class="t-obf">'   + eh(e.target.dataset.obf)   + '</span>' +
      ' <span class="t-arr">&#8594;</span> ' +
      '<span class="t-deobf">' + eh(e.target.dataset.deobf) + '</span>';
  } else {
    TT.style.display = 'none';
  }
}, { passive: true });

document.addEventListener('click', function(e) {
  if (e.target.classList.contains('hl-renamed'))
    hlByName(e.target.dataset.obf, e.target.dataset.deobf);
});

// ── Search ────────────────────────────────────────────────────────────
var SI = document.getElementById('searchInput');
var SB = document.getElementById('searchBtn');
var SR = document.getElementById('searchResults');

function doSearch() {
  var q = SI.value.trim().toLowerCase();
  if (!q) { SR.style.display = 'none'; return; }
  var res = [];

  funcIndex.forEach(function(f) {
    if (f.name.toLowerCase().indexOf(q) !== -1) {
      res.push({ label: f.name, sub: f.kind + ' line ' + f.line,
        action: (function(f) { return function() {
          vtDeobf.scrollToLine(f.line, true);
var obfLine = findFirstLine(obfLines, f.name.split('.').pop())
if (obfLine) vtObf.scrollToLine(obfLine, true)
var on = reverseMap[f.name]
if (on) hlByName(on, f.name)
          SR.style.display = 'none';
        }; })(f) });
    }
  });

  for (var ob in nameMap) {
    if (res.length >= 20) break;
    var db = nameMap[ob];
    if (ob.toLowerCase().indexOf(q) !== -1 || db.toLowerCase().indexOf(q) !== -1) {
      res.push({ label: db, sub: 'obf: ' + ob,
        action: (function(o, d) { return function() {
          hlByName(o, d); SR.style.display = 'none';
        }; })(ob, db) });
    }
  }

  SR.innerHTML = '';
  if (!res.length) {
    SR.innerHTML = '<div class="sr-item" style="color:#8b949e">No results</div>';
  } else {
    res.forEach(function(r) {
      var div = document.createElement('div'); div.className = 'sr-item';
      div.innerHTML = '<b>' + eh(r.label) + '</b> <span>' + eh(r.sub) + '</span>';
      div.addEventListener('click', r.action);
      SR.appendChild(div);
    });
  }
  SR.style.display = 'block';
}

SB.addEventListener('click', doSearch);
SI.addEventListener('keydown', function(e) { if (e.key === 'Enter') doSearch(); });
document.addEventListener('click', function(e) {
  if (!SR.contains(e.target) && e.target !== SI && e.target !== SB)
    SR.style.display = 'none';
});

// ── Jump to line ──────────────────────────────────────────────────────
document.getElementById('jumpBtn').addEventListener('click', function() {
  var n = parseInt(document.getElementById('jumpInput').value, 10);
  if (!isNaN(n) && n > 0) {
    vtObf.scrollToLine(n, true);
    vtDeobf.scrollToLine(n, true);
  }
});
document.getElementById('jumpInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('jumpBtn').click();
});