/**
 * Bonk Deobfuscator — Mapping Addon
 *
 * DROP THIS FILE into your deobfuscator folder alongside bonkdeobf.js.
 * Then add one line to bonkdeobf.js right before finalCleanup():
 *
 *   require("./mapping-addon").generateMapping(returncode, response);
 *
 * Outputs:
 *   mapping/mapping.json       — machine-readable name map
 *   mapping/mapping.html       — browser viewer (open this)
 *   mapping/mapping-data.js    — data file loaded by the viewer
 *   mapping/mapping-viewer.js  — viewer logic loaded by the viewer
 */

const fs = require("fs")
const esprima = require("esprima")
const estraverse = require("estraverse")

// ── Minified code splitter + indenter ─────────────────────────────────────────
// Turns a single giant minified line into indented, readable lines.
// Handles strings, template literals, regex literals, block/line comments,
// and all bracket types. Each logical statement or block boundary gets its
// own line with 2-space indentation per depth level.
function splitMinified(code) {
    var INDENT = "  "
    var lines  = []
    var buf    = ""
    var depth  = 0

    // lexer state
    var inLineComment  = false
    var inBlockComment = false
    var inStr          = false
    var strChar        = ""
    var inTemplate     = false
    var inRegex        = false

    function pushLine() {
        var t = buf.trim()
        if (t.length > 0) {
            lines.push(INDENT.repeat(Math.max(0, depth)) + t)
        }
        buf = ""
    }

    var i = 0
    var len = code.length

    while (i < len) {
        var c  = code[i]
        var c2 = code[i + 1]

        // ── line comment ──────────────────────────────────────────────────────
        if (inLineComment) {
            if (c === "\n") {
                inLineComment = false
                pushLine()
            } else {
                buf += c
            }
            i++; continue
        }

        // ── block comment ─────────────────────────────────────────────────────
        if (inBlockComment) {
            if (c === "*" && c2 === "/") {
                buf += "*/"; i += 2
                inBlockComment = false
            } else {
                buf += c; i++
            }
            continue
        }

        // ── template literal ──────────────────────────────────────────────────
        if (inTemplate) {
            buf += c
            if (c === "\\") { buf += code[i + 1]; i += 2; continue }
            if (c === "`")  { inTemplate = false }
            i++; continue
        }

        // ── regular string ────────────────────────────────────────────────────
        if (inStr) {
            buf += c
            if (c === "\\") { buf += code[i + 1]; i += 2; continue }
            if (c === strChar) { inStr = false }
            i++; continue
        }

        // ── regex ─────────────────────────────────────────────────────────────
        if (inRegex) {
            buf += c
            if (c === "\\") { buf += code[i + 1]; i += 2; continue }
            if (c === "/")  { inRegex = false }
            i++; continue
        }

        // ── enter comment / string / template / regex ─────────────────────────
        if (c === "/" && c2 === "/") { buf += "//"; i += 2; inLineComment = true; continue }
        if (c === "/" && c2 === "*") { buf += "/*"; i += 2; inBlockComment = true; continue }

        if (c === '"' || c === "'") { inStr = true; strChar = c; buf += c; i++; continue }
        if (c === "`") { inTemplate = true; buf += c; i++; continue }

        // Heuristic: treat / as regex start after operator/punctuation chars
        if (c === "/") {
            var last = buf.trimEnd().slice(-1)
            if ("=(:,[!&|?{;".indexOf(last) !== -1 || buf.trim().length === 0) {
                inRegex = true; buf += c; i++; continue
            }
        }

        // ── structural characters ─────────────────────────────────────────────
        if (c === "{") {
            buf += " {"
            pushLine()
            depth++
            i++; continue
        }

        if (c === "}") {
            pushLine()
            depth = Math.max(0, depth - 1)
            buf = "}"
            // if followed by ; or , absorb it onto the same closing line
            var next = code[i + 1]
            if (next === ";" || next === ",") {
                buf += next; i += 2
            } else {
                i++
            }
            pushLine()
            continue
        }

        if (c === ";") {
            buf += ";"
            pushLine()
            i++; continue
        }

        // Collapse raw newlines/CR from any already-split source into spaces
        if (c === "\n" || c === "\r") {
            if (buf.trim().length > 0) buf += " "
            i++; continue
        }

        buf += c
        i++
    }

    // flush remainder
    if (buf.trim().length > 0) pushLine()

    return lines
}

// ── Token map ─────────────────────────────────────────────────────────────────
function buildTokenMap(obfCode, deobfCode) {
    var obfTokens, deobfTokens
    try {
        obfTokens   = esprima.tokenize(obfCode,   { range: true })
        deobfTokens = esprima.tokenize(deobfCode, { range: true })
    } catch(e) {
        console.error("[Mapping] tokenize failed:", e.message)
        return []
    }

    var map  = []
    var seen = {}
    var oi = 0, di = 0

    while (oi < obfTokens.length && di < deobfTokens.length) {
        var ot = obfTokens[oi]
        var dt = deobfTokens[di]

        if (ot.type === "Identifier" && dt.type === "Identifier") {
            if (ot.value !== dt.value && !seen[ot.value]) {
                seen[ot.value] = true
                map.push({ obfuscated: ot.value, deobfuscated: dt.value })
            }
        }

        if (ot.type !== "Identifier" && dt.type !== "Identifier") {
            if (ot.value !== dt.value) {
                if (oi < di) oi++
                else di++
                continue
            }
        }

        oi++; di++
    }

    return map
}

// ── Function index ────────────────────────────────────────────────────────────
// ── Function index ────────────────────────────────────────────────────────────
function buildFunctionIndex(deobfCode) {
    var ast
    try {
        ast = esprima.parseScript(deobfCode, { range: true, tolerant: true })
    } catch(e) {
        return []
    }

    function lineFromRange(rangeStart) {
        return deobfCode.substring(0, rangeStart).split("\n").length
    }

    var funcs = []

    estraverse.traverse(ast, {
        enter: function(node) {

            // ── function declarations ─────────────────────────────
            if (node.type === "FunctionDeclaration" && node.id) {
                funcs.push({
                    kind: "function",
                    name: node.id.name,
                    args: node.params.map(p => p.name || "?").join(", "),
                    line: lineFromRange(node.range[0])
                })
            }

            // ── class declarations ────────────────────────────────
            if (node.type === "ClassDeclaration" && node.id) {
                funcs.push({
                    kind: "class",
                    name: node.id.name,
                    args: "",
                    line: lineFromRange(node.range[0])
                })
            }

            // ── arrow / function expressions ──────────────────────
            if (
                node.type === "VariableDeclarator" &&
                node.init &&
                (node.init.type === "FunctionExpression" ||
                 node.init.type === "ArrowFunctionExpression")
            ) {
                funcs.push({
                    kind: "arrow/expr",
                    name: node.id.name,
                    args: node.init.params.map(p => p.name || "?").join(", "),
                    line: lineFromRange(node.range[0])
                })
            }

            // ── prototype methods (CRITICAL FIX) ──────────────────
            if (
                node.type === "AssignmentExpression" &&
                node.left &&
                node.left.type === "MemberExpression" &&
                node.right &&
                node.right.type === "FunctionExpression"
            ) {

                let obj = ""
                let prop = ""

                if (node.left.object.type === "MemberExpression") {
                    obj =
                        (node.left.object.object.name || "?") +
                        "." +
                        (node.left.object.property.name || "?")
                } else {
                    obj = node.left.object.name || "?"
                }

                prop = node.left.property.name || "?"

                funcs.push({
                    kind: "method",
                    name: obj + "." + prop,
                    args: node.right.params.map(p => p.name || "?").join(", "),
                    line: lineFromRange(node.range[0])
                })
            }
        }
    })

    return funcs
}

// ── String table ──────────────────────────────────────────────────────────────
function buildStringTable(obfCode) {
    var arrayMatch = obfCode.match(/var\s+(\w+)\s*=\s*\[(?:"[^"]*"|'[^']*')(?:\s*,\s*(?:"[^"]*"|'[^']*'))+\s*\]/)
    if (!arrayMatch) return { varName: null, strings: [] }

    var varName = arrayMatch[1]
    var arr
    try {
        arr = JSON.parse(arrayMatch[0].replace("var " + varName + " = ", ""))
    } catch(e) {
        arr = arrayMatch[0]
            .replace("var " + varName + " = [", "")
            .replace(/\]$/, "")
            .split(",")
            .map(function(s) { return s.trim().replace(/^['"]|['"]$/g, "") })
    }

    return { varName: varName, strings: arr }
}

// ── Write mapping.json ────────────────────────────────────────────────────────
function writeJSON(tokenMap, funcIndex, stringTable) {
    var output = {
        generated: new Date().toISOString(),
        summary: {
            renamedIdentifiers: tokenMap.length,
            functions: funcIndex.filter(function(f) { return f.kind === "function" }).length,
            classes:   funcIndex.filter(function(f) { return f.kind === "class"    }).length,
            stringTableSize: stringTable.strings.length
        },
        stringTable: {
            arrayVar: stringTable.varName,
            entries: stringTable.strings.map(function(s, i) { return { index: i, value: s } })
        },
        identifierMap: tokenMap,
        functions: funcIndex
    }
    fs.writeFileSync("mapping/mapping.json", JSON.stringify(output, null, 2))
    console.log("[Mapping] mapping/mapping.json written")
}

// ── Write mapping-data.js ─────────────────────────────────────────────────────
function writeDataFile(obfCode, deobfCode, tokenMap, funcIndex, MAX_LINES) {
    var nameMap = {}
    for (var i = 0; i < tokenMap.length; i++) {
        nameMap[tokenMap[i].obfuscated] = tokenMap[i].deobfuscated
    }

    // Split + indent the minified obfuscated code before sending to browser
    console.log("[Mapping] Splitting & indenting minified obfuscated code...")
    var obfSplit = splitMinified(obfCode).slice(0, MAX_LINES)
    console.log("[Mapping] Obfuscated lines after split:", obfSplit.length)

    var data = {
        nameMap:    nameMap,
        funcIndex:  funcIndex,
        obfLines:   obfSplit,
        deobfLines: deobfCode.split("\n").slice(0, MAX_LINES),
        generated:  new Date().toLocaleString(),
        stats: {
            renamed:   tokenMap.length,
            functions: funcIndex.filter(function(f) { return f.kind === "function" }).length,
            classes:   funcIndex.filter(function(f) { return f.kind === "class"    }).length,
            maxLines:  MAX_LINES
        }
    }

    fs.writeFileSync(
        "mapping/mapping-data.js",
        "window.BONK_MAP_DATA = " + JSON.stringify(data) + ";"
    )
    console.log("[Mapping] mapping/mapping-data.js written")
}

// ── Write mapping-viewer.js ───────────────────────────────────────────────────
function writeViewerJs() {
    var lines = [
        "// Bonk Deobfuscator Mapping Viewer — Virtual Scrolling Edition",
        "var D = window.BONK_MAP_DATA;",
        "var nameMap    = D.nameMap;",
        "var funcIndex  = D.funcIndex;",
        "var obfLines   = D.obfLines;",
        "var deobfLines = D.deobfLines;",
        "",
        "// ── Stats bar ──────────────────────────────────────────────────────────",
        "document.getElementById('gen-date').textContent         = D.generated;",
        "document.getElementById('stat-renamed').textContent     = D.stats.renamed;",
        "document.getElementById('stat-funcs').textContent       = D.stats.functions;",
        "document.getElementById('stat-classes').textContent     = D.stats.classes;",
        "document.getElementById('stat-lines').textContent       = D.stats.maxLines;",
        "document.getElementById('stat-obf-total').textContent   = obfLines.length;",
        "document.getElementById('stat-deobf-total').textContent = deobfLines.length;",
        "",
        "// ── Reverse map ────────────────────────────────────────────────────────",
        "var reverseMap = {};",
        "for (var _k in nameMap) reverseMap[nameMap[_k]] = _k;",
        "",
        "// ── Keywords ───────────────────────────────────────────────────────────",
        "var KW = {var:1,let:1,const:1,function:1,class:1,return:1,if:1,else:1,for:1,while:1,do:1,switch:1,case:1,break:1,continue:1,new:1,this:1,typeof:1,instanceof:1,import:1,export:1,default:1,try:1,catch:1,finally:1,throw:1,async:1,await:1,of:1,in:1,true:1,false:1,null:1,undefined:1,void:1,delete:1,static:1,extends:1,super:1,yield:1};",
        "",
        "// ── HTML escape ────────────────────────────────────────────────────────",
        "function eh(s) {",
        "  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');",
        "}",
        "",
        "// ── Syntax highlighter (with per-line cache) ───────────────────────────",
        "var hlCache = [{}, {}];",
        "function hlLine(line, isObf) {",
        "  var cache = hlCache[isObf ? 0 : 1];",
        "  if (cache[line] !== undefined) return cache[line];",
        "",
        "  // Preserve leading whitespace as indentation",
        "  var indent = '';",
        "  var si = 0;",
        "  while (si < line.length && line[si] === ' ') { indent += ' '; si++; }",
        "",
        "  var out = '', i = si;",
        "  while (i < line.length) {",
        "    if (line[i] === '/' && line[i+1] === '/') {",
        "      out += '<span class=\"hl-comment\">' + eh(line.slice(i)) + '</span>'; break;",
        "    }",
        "    if (line[i] === '\"' || line[i] === \"'\") {",
        "      var q = line[i], j = i+1;",
        "      while (j < line.length && line[j] !== q) { if (line[j] === '\\\\') j++; j++; }",
        "      out += '<span class=\"hl-string\">' + eh(line.slice(i,j+1)) + '</span>';",
        "      i = j+1; continue;",
        "    }",
        "    if (line[i] === '`') {",
        "      var j = i+1;",
        "      while (j < line.length && line[j] !== '`') { if (line[j] === '\\\\') j++; j++; }",
        "      out += '<span class=\"hl-string\">' + eh(line.slice(i,j+1)) + '</span>';",
        "      i = j+1; continue;",
        "    }",
        "    if (/[0-9]/.test(line[i]) && (i===si || !/[a-zA-Z_$]/.test(line[i-1]))) {",
        "      var j = i;",
        "      while (j < line.length && /[0-9a-fA-FxX._]/.test(line[j])) j++;",
        "      out += '<span class=\"hl-number\">' + eh(line.slice(i,j)) + '</span>';",
        "      i = j; continue;",
        "    }",
        "    if (/[a-zA-Z_$]/.test(line[i])) {",
        "      var j = i;",
        "      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;",
        "      var w = line.slice(i,j);",
        "      if (KW[w]) {",
        "        out += '<span class=\"hl-keyword\">' + w + '</span>';",
        "      } else if (isObf && nameMap[w]) {",
        "        out += '<span class=\"hl-renamed\" data-obf=\"' + eh(w) + '\" data-deobf=\"' + eh(nameMap[w]) + '\">' + eh(w) + '</span>';",
        "      } else if (!isObf && reverseMap[w]) {",
        "        out += '<span class=\"hl-renamed\" data-obf=\"' + eh(reverseMap[w]) + '\" data-deobf=\"' + eh(w) + '\">' + eh(w) + '</span>';",
        "      } else {",
        "        out += eh(w);",
        "      }",
        "      i = j; continue;",
        "    }",
        "    out += eh(line[i]); i++;",
        "  }",
        "  var result = indent + out;",
        "  cache[line] = result;",
        "  return result;",
        "}",
        "",
        "// ── Virtual scroller ───────────────────────────────────────────────────",
        "// Only renders rows in the visible viewport ± OVERSCAN rows.",
        "// The spacer div holds the total scrollable height so the scrollbar is correct.",
        "var ROW_H    = 20;",
        "var OVERSCAN = 40;",
        "",
        "function VirtualTable(scrollEl, lines, isObf) {",
        "  this.scrollEl       = scrollEl;",
        "  this.lines          = lines;",
        "  this.isObf          = isObf;",
        "  this.rendered       = {};",
        "  this.highlightedRow = null;",
        "",
        "  this.spacer = document.createElement('div');",
        "  this.spacer.style.cssText = 'position:relative;width:100%;height:' + (lines.length * ROW_H) + 'px;';",
        "  scrollEl.appendChild(this.spacer);",
        "",
        "  var self = this;",
        "  scrollEl.addEventListener('scroll', function() { self.render(); }, { passive: true });",
        "  window.addEventListener('resize',  function() { self.render(); }, { passive: true });",
        "  this.render();",
        "}",
        "",
        "VirtualTable.prototype.render = function() {",
        "  var scrollTop = this.scrollEl.scrollTop;",
        "  var viewH     = this.scrollEl.clientHeight;",
        "  var start = Math.max(0,                Math.floor(scrollTop / ROW_H) - OVERSCAN);",
        "  var end   = Math.min(this.lines.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);",
        "",
        "  // Recycle rows that are now far off-screen",
        "  for (var k in this.rendered) {",
        "    var ki = parseInt(k, 10);",
        "    if (ki < start || ki >= end) {",
        "      this.spacer.removeChild(this.rendered[k]);",
        "      delete this.rendered[k];",
        "    }",
        "  }",
        "",
        "  // Stamp in rows that just entered the render window",
        "  for (var i = start; i < end; i++) {",
        "    if (this.rendered[i]) continue;",
        "    var row = document.createElement('div');",
        "    row.id        = (this.isObf ? 'obf' : 'deobf') + '-ln-' + (i + 1);",
        "    row.className = 'vrow';",
        "    row.style.top = (i * ROW_H) + 'px';",
        "    row.innerHTML =",
        "      '<span class=\"ln\">' + (i + 1) + '</span>' +",
        "      '<span class=\"code\">' + hlLine(this.lines[i], this.isObf) + '</span>';",
        "    this.spacer.appendChild(row);",
        "    this.rendered[i] = row;",
        "  }",
        "};",
        "",
        "VirtualTable.prototype.scrollToLine = function(lineNum, highlight) {",
        "var targetTop = (lineNum - 1) * ROW_H",
        "this.scrollEl.scrollTop = Math.max(0, targetTop - this.scrollEl.clientHeight / 2)",
        "var self = this",
        "requestAnimationFrame(function() {",
            "requestAnimationFrame(function() {",
            "self.render()",
            "var row = document.getElementById(",
               " (self.isObf ? 'obf' : 'deobf') + '-ln-' + lineNum",
            ")",
            "if (row && highlight) {",
                "if (self.highlightedRow)",
                "self.highlightedRow.classList.remove('highlight-row')",
                "row.classList.add('highlight-row')",
                "self.highlightedRow = row",
            "}",
            "})",
        "})",
        "}",
        "",
        "// ── Boot both panels ──────────────────────────────────────────────────",
        "var vtObf   = new VirtualTable(document.getElementById('obfScroll'),   obfLines,   true);",
        "var vtDeobf = new VirtualTable(document.getElementById('deobfScroll'), deobfLines, false);",
        "",
        "// ── Sync scrolling ────────────────────────────────────────────────────",
        "var syncScroll   = false;",
        "var syncingObf   = false;",
        "var syncingDeobf = false;",
        "document.getElementById('syncToggle').addEventListener('change', function(e) {",
        "  syncScroll = e.target.checked;",
        "});",
       " document.getElementById('obfScroll').addEventListener('scroll', function() {",
        "if (!syncScroll || syncingObf) return;",
        " syncingDeobf = true;",
        " var obf = this",
        "  var deobf = document.getElementById('deobfScroll')",
        "  var ratio = obf.scrollTop / (obf.scrollHeight - obf.clientHeight)",
        "  deobf.scrollTop = ratio * (deobf.scrollHeight - deobf.clientHeight)",
        "  syncingDeobf = false",
        "}, { passive: true })",
"document.getElementById('deobfScroll').addEventListener('scroll', function() {",
        "if (!syncScroll || syncingDeobf) return",
        "syncingObf = true",
        "var deobf = this",
        "var obf = document.getElementById('obfScroll')",
        "var ratio = deobf.scrollTop / (deobf.scrollHeight - deobf.clientHeight)",
        "obf.scrollTop = ratio * (obf.scrollHeight - obf.clientHeight)",
        "syncingObf = false",
        "}, { passive: true })",
        "// ── Cross-panel highlight by name ─────────────────────────────────────",
        "function findFirstLine(linesArr, word) {",
        "  var re = new RegExp('\\\\b' + word.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\b');",
        "  for (var i = 0; i < linesArr.length; i++) {",
        "    if (re.test(linesArr[i])) return i + 1;",
        "  }",
        "  return null;",
        "}",
        "",
        "function hlByName(o, d) {",
        "  var deobfLine = findFirstLine(deobfLines, d);",
        "  var obfLine   = findFirstLine(obfLines,   o);",
        "  if (deobfLine) vtDeobf.scrollToLine(deobfLine, true);",
        "  if (obfLine)   vtObf.scrollToLine(obfLine,     true);",
        "}",
        "",
        "// ── Function sidebar ──────────────────────────────────────────────────",
        "var KC = { 'function': '#d2a8ff', 'class': '#ffa657', 'arrow/expr': '#79c0ff' };",
        "var FL = document.getElementById('funcList');",
        "funcIndex.forEach(function(f) {",
        "  var div = document.createElement('div'); div.className = 'func-item';",
        "  var nm  = document.createElement('span'); nm.className = 'fname';",
        "  nm.style.color = KC[f.kind] || '#c9d1d9'; nm.textContent = f.name;",
        "  var mt  = document.createElement('span'); mt.className = 'fmeta';",
        "  mt.textContent = f.kind + ' line ' + f.line + (f.args ? ' (' + f.args + ')' : '');",
        "  div.appendChild(nm); div.appendChild(mt);",
        "  div.addEventListener('click', function() {",
        "    vtDeobf.scrollToLine(f.line, true);",
        "var mapped = reverseMap[f.name]",
        "if (mapped) {",
        "var obfLine = findFirstLine(obfLines, mapped)",
        "if (obfLine) vtObf.scrollToLine(obfLine, true)",
        "}",
        "var on = reverseMap[f.name]",
        "if (on) hlByName(on, f.name)",
        "  });",
        "  FL.appendChild(div);",
        "});",
        "",
        "// ── Tooltip ───────────────────────────────────────────────────────────",
        "var TT = document.getElementById('tooltip');",
        "document.addEventListener('mousemove', function(e) {",
        "  if (e.target.classList.contains('hl-renamed')) {",
        "    TT.style.display = 'block';",
        "    TT.style.left = (e.clientX + 14) + 'px';",
        "    TT.style.top  = (e.clientY - 8)  + 'px';",
        "    TT.innerHTML =",
        "      '<span class=\"t-obf\">'   + eh(e.target.dataset.obf)   + '</span>' +",
        "      ' <span class=\"t-arr\">&#8594;</span> ' +",
        "      '<span class=\"t-deobf\">' + eh(e.target.dataset.deobf) + '</span>';",
        "  } else {",
        "    TT.style.display = 'none';",
        "  }",
        "}, { passive: true });",
        "",
        "document.addEventListener('click', function(e) {",
        "  if (e.target.classList.contains('hl-renamed'))",
        "    hlByName(e.target.dataset.obf, e.target.dataset.deobf);",
        "});",
        "",
        "// ── Search ────────────────────────────────────────────────────────────",
        "var SI = document.getElementById('searchInput');",
        "var SB = document.getElementById('searchBtn');",
        "var SR = document.getElementById('searchResults');",
        "",
        "function doSearch() {",
        "  var q = SI.value.trim().toLowerCase();",
        "  if (!q) { SR.style.display = 'none'; return; }",
        "  var res = [];",
        "",
        "  funcIndex.forEach(function(f) {",
        "    if (f.name.toLowerCase().indexOf(q) !== -1) {",
        "      res.push({ label: f.name, sub: f.kind + ' line ' + f.line,",
        "        action: (function(f) { return function() {",
        "          vtDeobf.scrollToLine(f.line, true);",
        "var obfLine = findFirstLine(obfLines, f.name.split('.').pop())",
        "if (obfLine) vtObf.scrollToLine(obfLine, true)",
        "var on = reverseMap[f.name]",
        "if (on) hlByName(on, f.name)",
        "          SR.style.display = 'none';",
        "        }; })(f) });",
        "    }",
        "  });",
        "",
        "  for (var ob in nameMap) {",
        "    if (res.length >= 20) break;",
        "    var db = nameMap[ob];",
        "    if (ob.toLowerCase().indexOf(q) !== -1 || db.toLowerCase().indexOf(q) !== -1) {",
        "      res.push({ label: db, sub: 'obf: ' + ob,",
        "        action: (function(o, d) { return function() {",
        "          hlByName(o, d); SR.style.display = 'none';",
        "        }; })(ob, db) });",
        "    }",
        "  }",
        "",
        "  SR.innerHTML = '';",
        "  if (!res.length) {",
        "    SR.innerHTML = '<div class=\"sr-item\" style=\"color:#8b949e\">No results</div>';",
        "  } else {",
        "    res.forEach(function(r) {",
        "      var div = document.createElement('div'); div.className = 'sr-item';",
        "      div.innerHTML = '<b>' + eh(r.label) + '</b> <span>' + eh(r.sub) + '</span>';",
        "      div.addEventListener('click', r.action);",
        "      SR.appendChild(div);",
        "    });",
        "  }",
        "  SR.style.display = 'block';",
        "}",
        "",
        "SB.addEventListener('click', doSearch);",
        "SI.addEventListener('keydown', function(e) { if (e.key === 'Enter') doSearch(); });",
        "document.addEventListener('click', function(e) {",
        "  if (!SR.contains(e.target) && e.target !== SI && e.target !== SB)",
        "    SR.style.display = 'none';",
        "});",
        "",
        "// ── Jump to line ──────────────────────────────────────────────────────",
        "document.getElementById('jumpBtn').addEventListener('click', function() {",
        "  var n = parseInt(document.getElementById('jumpInput').value, 10);",
        "  if (!isNaN(n) && n > 0) {",
        "    vtObf.scrollToLine(n, true);",
        "    vtDeobf.scrollToLine(n, true);",
        "  }",
        "});",
        "document.getElementById('jumpInput').addEventListener('keydown', function(e) {",
        "  if (e.key === 'Enter') document.getElementById('jumpBtn').click();",
        "});"
    ]

    fs.writeFileSync("mapping/mapping-viewer.js", lines.join("\n"))
    console.log("[Mapping] mapping/mapping-viewer.js written")
}

// ── Write mapping.html ────────────────────────────────────────────────────────
function writeHTML() {
    var css = [
        "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }",
        "body { background: #0d1117; color: #c9d1d9; font-family: Consolas, 'Cascadia Code', 'Fira Code', monospace; font-size: 12px; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }",

        "header { background: #161b22; border-bottom: 1px solid #30363d; padding: 10px 16px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; }",
        "header h1 { font-size: 13px; color: #e6edf3; font-weight: 600; white-space: nowrap; }",
        "header .pill { background: #21262d; border: 1px solid #30363d; border-radius: 20px; padding: 2px 10px; font-size: 10px; color: #8b949e; white-space: nowrap; }",
        "#searchBar { margin-left: auto; display: flex; gap: 6px; align-items: center; }",
        "#searchInput { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 4px 10px; font-size: 12px; width: 200px; outline: none; font-family: inherit; }",
        "#searchInput:focus { border-color: #58a6ff; }",
        "#searchBtn { background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 4px 10px; cursor: pointer; font-size: 12px; }",
        "#searchBtn:hover { background: #30363d; }",
        ".jump-group { display: flex; gap: 4px; align-items: center; }",
        "#jumpInput { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 4px 8px; font-size: 12px; width: 72px; outline: none; font-family: inherit; }",
        "#jumpInput:focus { border-color: #58a6ff; }",
        "#jumpBtn { background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; padding: 4px 8px; cursor: pointer; font-size: 12px; }",
        "#jumpBtn:hover { background: #30363d; color: #c9d1d9; }",
        ".sync-group { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #8b949e; white-space: nowrap; }",
        ".sync-group input { cursor: pointer; accent-color: #58a6ff; }",

        "#stats { background: #0d1117; border-bottom: 1px solid #21262d; padding: 4px 16px; display: flex; gap: 20px; font-size: 10px; color: #8b949e; flex-shrink: 0; flex-wrap: wrap; }",
        "#stats b { color: #58a6ff; }",

        ".main { display: flex; flex: 1; min-height: 0; }",
        ".panels { display: flex; flex: 1; min-width: 0; }",
        ".panel { flex: 1; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid #30363d; }",
        ".panel-header { background: #161b22; border-bottom: 1px solid #30363d; padding: 5px 12px; font-size: 10px; color: #8b949e; flex-shrink: 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; display: flex; align-items: center; gap: 8px; }",
        ".panel-header .badge { background: #21262d; border: 1px solid #30363d; border-radius: 3px; padding: 1px 6px; font-size: 9px; color: #58a6ff; }",

        ".vscroll { flex: 1; overflow-y: auto; overflow-x: auto; position: relative; }",
        ".vscroll::-webkit-scrollbar { width: 8px; height: 8px; }",
        ".vscroll::-webkit-scrollbar-track { background: #0d1117; }",
        ".vscroll::-webkit-scrollbar-thumb { background: #30363d; border-radius: 4px; }",
        ".vscroll::-webkit-scrollbar-thumb:hover { background: #3d444d; }",

        ".vrow { position: absolute; left: 0; right: 0; display: flex; height: 20px; align-items: center; }",
        ".vrow:hover { background: rgba(255,255,255,0.03); }",
        ".ln { width: 52px; min-width: 52px; padding: 0 8px 0 0; text-align: right; color: #3d444d; user-select: none; border-right: 1px solid #21262d; line-height: 20px; flex-shrink: 0; font-size: 11px; }",
        ".code { padding: 0 12px; white-space: pre; line-height: 20px; flex: 1; }",

        ".hl-keyword { color: #ff7b72; }",
        ".hl-string  { color: #a5d6ff; }",
        ".hl-number  { color: #79c0ff; }",
        ".hl-comment { color: #8b949e; font-style: italic; }",
        ".hl-renamed { color: #7ee787; cursor: pointer; border-bottom: 1px dotted rgba(126,231,135,0.5); }",
        ".hl-renamed:hover { background: rgba(126,231,135,0.12); border-radius: 2px; }",
        ".highlight-row { background: rgba(88,166,255,0.1) !important; }",
        ".highlight-row .ln { color: #58a6ff; }",

        "#funcPanel { width: 210px; min-width: 210px; border-left: 1px solid #30363d; display: flex; flex-direction: column; background: #0d1117; }",
        "#funcList { flex: 1; overflow-y: auto; }",
        "#funcList::-webkit-scrollbar { width: 6px; }",
        "#funcList::-webkit-scrollbar-track { background: #0d1117; }",
        "#funcList::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }",
        ".func-item { padding: 5px 10px; cursor: pointer; border-bottom: 1px solid rgba(48,54,61,0.5); display: flex; flex-direction: column; gap: 1px; }",
        ".func-item:hover { background: #161b22; }",
        ".func-item .fname { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
        ".func-item .fmeta { color: #8b949e; font-size: 9px; }",

        "#tooltip { position: fixed; background: #1c2128; border: 1px solid #30363d; border-radius: 6px; padding: 6px 10px; font-size: 11px; color: #e6edf3; pointer-events: none; display: none; z-index: 9999; max-width: 340px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }",
        ".t-obf   { color: #ff7b72; }",
        ".t-arr   { color: #8b949e; margin: 0 5px; }",
        ".t-deobf { color: #7ee787; }",

        "#searchResults { position: fixed; top: 44px; right: 16px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 6px 0; display: none; z-index: 500; min-width: 260px; max-height: 280px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.6); }",
        ".sr-item { padding: 6px 12px; cursor: pointer; font-size: 11px; display: flex; align-items: baseline; gap: 6px; }",
        ".sr-item:hover { background: #21262d; }",
        ".sr-item b { color: #d2a8ff; }",
        ".sr-item span { color: #8b949e; font-size: 10px; }"
    ].join("\n")

    var html = [
        "<!DOCTYPE html>",
        "<html lang=\"en\">",
        "<head>",
        "<meta charset=\"UTF-8\">",
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">",
        "<title>Bonk alpha2s.js Deobfuscation Map</title>",
        "<style>" + css + "</style>",
        "</head>",
        "<body>",
        "<header>",
        "  <h1>&#128293; Bonk Deobfuscation Map</h1>",
        "  <span class=\"pill\" id=\"gen-date\"></span>",
        "  <div id=\"searchBar\">",
        "    <input id=\"searchInput\" placeholder=\"Search function or identifier&hellip;\" autocomplete=\"off\" />",
        "    <button id=\"searchBtn\">Search</button>",
        "  </div>",
        "  <div class=\"jump-group\">",
        "    <input id=\"jumpInput\" placeholder=\"Line #\" type=\"number\" min=\"1\" />",
        "    <button id=\"jumpBtn\">Go</button>",
        "  </div>",
        "  <div class=\"sync-group\">",
        "    <input type=\"checkbox\" id=\"syncToggle\" />",
        "    <label for=\"syncToggle\">Sync scroll</label>",
        "  </div>",
        "</header>",
        "<div id=\"stats\">",
        "  <span>Renamed: <b id=\"stat-renamed\"></b></span>",
        "  <span>Functions: <b id=\"stat-funcs\"></b></span>",
        "  <span>Classes: <b id=\"stat-classes\"></b></span>",
        "  <span>Obf lines: <b id=\"stat-obf-total\"></b></span>",
        "  <span>Deobf lines: <b id=\"stat-deobf-total\"></b></span>",
        "  <span>Max: <b id=\"stat-lines\"></b></span>",
        "</div>",
        "<div class=\"main\">",
        "  <div class=\"panels\">",
        "    <div class=\"panel\">",
        "      <div class=\"panel-header\">",
        "        <span>Obfuscated</span>",
        "        <span class=\"badge\">alpha2s.js &mdash; split + indented</span>",
        "      </div>",
        "      <div class=\"vscroll\" id=\"obfScroll\"></div>",
        "    </div>",
        "    <div class=\"panel\">",
        "      <div class=\"panel-header\">",
        "        <span>Deobfuscated</span>",
        "        <span class=\"badge\">readable</span>",
        "      </div>",
        "      <div class=\"vscroll\" id=\"deobfScroll\"></div>",
        "    </div>",
        "  </div>",
        "  <div id=\"funcPanel\">",
        "    <div class=\"panel-header\">Functions &amp; Classes</div>",
        "    <div id=\"funcList\"></div>",
        "  </div>",
        "</div>",
        "<div id=\"tooltip\"></div>",
        "<div id=\"searchResults\"></div>",
        "<script src=\"mapping-data.js\"><" + "/script>",
        "<script src=\"mapping-viewer.js\"><" + "/script>",
        "</body>",
        "</html>"
    ].join("\n")

    fs.writeFileSync("mapping/mapping.html", html)
    console.log("[Mapping] mapping/mapping.html written")
}

// ── Entry point ───────────────────────────────────────────────────────────────
function generateMapping(deobfCode, obfCode) {
    console.log("\n[Mapping] Building deobfuscation map...")

    if (!fs.existsSync("mapping")) fs.mkdirSync("mapping")

    var tokenMap    = buildTokenMap(obfCode, deobfCode)
    console.log("[Mapping] Identifier renames found:", tokenMap.length)

    var funcIndex   = buildFunctionIndex(deobfCode)
    console.log("[Mapping] Functions indexed:", funcIndex.length)

    var stringTable = buildStringTable(obfCode)
    console.log("[Mapping] String table entries:", stringTable.strings.length)

    var MAX_LINES = 50000  // Safe — virtual scrolling only renders visible rows

    writeJSON(tokenMap, funcIndex, stringTable)
    writeDataFile(obfCode, deobfCode, tokenMap, funcIndex, MAX_LINES)
    writeViewerJs()
    writeHTML()

    console.log("[Mapping] Done. Open mapping/mapping.html in your browser.")
}

module.exports = { generateMapping }