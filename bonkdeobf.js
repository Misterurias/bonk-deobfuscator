process.on("uncaughtException", (e) => {
	console.log("\n")
	console.error(e)
	process.exit(1)
})
const js_beautify = require('js-beautify/js').js
const fs = require("fs")
const minify = require("uglify-js").minify
const esprima = require("esprima")
const escodegen = require("escodegen")
const estraverse = require("estraverse")
const ini = require("ini")
let consoleText
function log(text) {
	process.stdout.write(`\n${text}`)
	consoleText = text
}
function changeStatus(status){
	process.stdout.write(`\r${consoleText}: ${status}`)
}
const codeStringList = []
function noStrings(code){
	const tokens = esprima.tokenize(code)
	code = ""
	for (const a of tokens){
		if (a.type === "Keyword") code += " "
		if (a.type === "String") {
			code += "''"
			codeStringList.push(a.value)
			continue
		}
		code += a.value
		if (a.type === "Keyword" || a.value === "static") code += " "
	}
	return js_beautify(code, {e4x: true, indent_with_tabs: true})
}
function replaceDecsWithExpr(decCode){
	const ast = esprima.parseScript(decCode)
	const expr = []
	const decs = []
	for (let i = 0; i < ast.body[0].declarations.length; i++) {
		const declaration = ast.body[0].declarations[i]
		decs.push(declaration.id.name)
		if (declaration.init) expr.push(declaration.init)
	}
	ast.body = expr
	return {code: escodegen.generate(ast), decs: decs}
}
function replaceVars(code, oldNames, newNames){
	const tokens = esprima.tokenize(code)
	code = ""
	let isPrevTokenDot = false
	for (const a of tokens){
		if (a.type === "Keyword")  code += " "
		if (a.type === "Identifier"){
			const oldNameIndex = oldNames.indexOf(a.value)
			if (!isPrevTokenDot && oldNameIndex !== -1){
				code += newNames[oldNameIndex]
				continue
			}
		}
		code += a.value
		if (a.type === "Keyword" || a.value === "static") code += " "
		isPrevTokenDot = a.type === "Punctuator" && a.value === "."
	}
	return js_beautify(code, {e4x: true, indent_with_tabs: true})
}
function replaceVarsObj(code, replacements){
	const tokens = esprima.tokenize(code)
	code = ""
	let isPrevTokenDot = false
	for (const a of tokens){
		if (a.type === "Keyword")  code += " "
		if (a.type === "Identifier"){
			if (!isPrevTokenDot && typeof replacements[a.value] === "string"){
				code += replacements[a.value]
				continue
			}
		}
		code += a.value
		if (a.type === "Keyword" || a.value === "static") code += " "
		isPrevTokenDot = a.type === "Punctuator" && a.value === "."
	}
	return js_beautify(code, {e4x: true, indent_with_tabs: true})
}
function returnStrings(code){
	for (let i = 0; i < codeStringList.length; i++){
		code = code.replace("''", codeStringList[i])
	}
	return code
}
function writeToFile(filename, contents){
	const dirname = filename.split("/")[0]
	if (!fs.existsSync(dirname)) fs.mkdirSync(dirname)
	fs.writeFileSync(filename, contents)
}
function test(code){
	writeToFile("test/alpha2s.js", code)
	process.exit(0)
}
let strCount = 0
function generateRandomString(letter){
	let str = letter + (strCount.toString(36)).padStart(3, "0")
	strCount++
	return str
}
function setVarNames(thisOnly, code){
	if (thisOnly) {
		process.stdout.write("-- [Bonk Deobfuscator] --")
		code = fs.readFileSync("deobfuscated/alpha2s.js", {encoding: "utf8"})
	}
	log("Setting variable names")
	const data = ini.decode(fs.readFileSync("variableNames.ini", {encoding: "ascii"}))
	const replacements = {}
	for (const fName of Object.keys(data.f)){
		const funcr = data.f[fName]
		replacements[fName] = funcr.name
		delete funcr.name
		if (funcr.args){
			const args = funcr.args.split(",")
			for (let i = 0; i < args.length; i++){
				replacements[fName + "a" + i] = args[i]
			}
		}
		delete funcr.args
		for (const n of Object.keys(funcr)){
			replacements[fName + "v" + n] = funcr[n]
		}
	}
	return replaceVarsObj(code, replacements)
}
function finalCleanup(code){
	log("Final cleanup")
	code = js_beautify(code, {e4x: true, indent_with_tabs: true})
	const tmp = code.split("\n")
	for (const i in tmp){
		if (tmp[i].startsWith("\t")) tmp[i] = tmp[i].slice(1)
		if (tmp[i].trim()) tmp[i] += "\n"
	}
	code = tmp.join("")
	return code
}
const eo = {
	type: "VariableDeclarator",
	id: {
		type: "Identifier",
		name: "ZZZ"
	}
}
if (process.argv[process.argv.length-1] === "namesonly"){
	let code = finalCleanup(setVarNames(true))
	const filename = "deobfuscated/alpha2s.js"
	log("Saving deobfuscated code to " + filename)
	writeToFile(filename, code)
	process.exit(0)
}
const path = "alpha2s.js"
process.stdout.write("-- [Bonk Deobfuscator] --")
log("Reading " + path)
if (!fs.existsSync(path)){
	log(path + " Does not exist. Please provide it in the same directory the deobfuscator is located in")
	process.exit(1)
}
const response = fs.readFileSync(path, {encoding: "utf8"})
log("Deobfuscation started")
function noDuplicate(array) {
	return [...new Set(array)]
}
function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
log("Unminifing the code")
let tmp = js_beautify(response, { e4x: true, unescape_strings: true, indent_with_tabs: true })
const splitedText = tmp.split("requirejs")
log("Setting up main variables")
const MAINFUNCTION = splitedText[0].match(/[^\[]+/)[0]
const MAINARRAY = splitedText[0].match(/^var ([^=^\s]+);/m)[1]
log(`eval ${MAINFUNCTION} function`)
eval(`var ${MAINFUNCTION};${response.split("requirejs")[0]}`)
let returncode = `requirejs${splitedText[1]}`
log(`Replacing "var a = ${MAINFUNCTION}; a.bcd(123)" to "${MAINFUNCTION}.bcd(123)"`)
tmp = returncode.match(new RegExp(`var (\\S+) = ${escapeRegExp(MAINFUNCTION)};`, ""))[1]
returncode = returncode.replaceAll(`${tmp}.`, `${MAINFUNCTION}.`)
log(`Replacing all duplicate functions`)
tmp = [...splitedText[0].matchAll(new RegExp(`(?<v>${escapeRegExp(MAINFUNCTION)}\\.[\\S]+) = (?<f>function\\(\\) \\{.+?};)`, "gs"))]
changeStatus(tmp.length)
let VARIABLES = tmp.map((m) => m.groups.v)
let FUNCTIONS = tmp.map((m) => m.groups.f)
let indices = {}
for (let i = 0; i < FUNCTIONS.length; i++) {
	if (!indices[FUNCTIONS[i]]) {
		indices[FUNCTIONS[i]] = []
	}
	indices[FUNCTIONS[i]].push(i)
}
for (const key in indices) {
	const element = indices[key]
	for (let i = 0; i < element.length; i++) {
		splitedText[0] = splitedText[0].replaceAll(VARIABLES[element[i]], VARIABLES[element[0]])
		returncode = returncode.replaceAll(VARIABLES[element[i]], VARIABLES[element[0]])
	}
}
log(`Replacing math operation`)
const OPERATIONEQUALVARIABLE = /case 0:\n\s+(\S+) = .+\n.+break;/gm.exec(splitedText[0])[1]
tmp = new RegExp(
	`return {\\s+(\\S+): function\\(\\) {\\s+var ${escapeRegExp(OPERATIONEQUALVARIABLE)}, (.+) = arguments;\\s+switch \\((.+)\\)`,
	"gm"
).exec(splitedText[0])
const OPERATIONFUNCTION = new RegExp(`(${escapeRegExp(MAINFUNCTION)}\\....) = function\\(\\) {\\s+return.+${tmp[1]}`, "gm").exec(splitedText[0])[1]
const OPERATIONFUNCTIONSETTER = new RegExp(
	`(${escapeRegExp(MAINFUNCTION)}\\....) = function\\(\\) {\\s+return.+${escapeRegExp(
		new RegExp(`,\\s+(\\S+): function.+\\s+${escapeRegExp(tmp[3])} =`, "gm").exec(splitedText[0])[1]
	)}`,
	"gm"
).exec(splitedText[0])[1]
const OPERATIONARGUMENTVARIABLE = escapeRegExp(tmp[2])
tmp = returncode.match(
	new RegExp(
		`${escapeRegExp(OPERATIONFUNCTION)}\\((?:[^)(]|\\((?:[^)(]|\\((?:[^)(]|\\([^)(]*\\))*\\))*\\))*\\)|${escapeRegExp(
			OPERATIONFUNCTIONSETTER
		)}\\(\\d+\\)`,
		"g"
	)
)
// FUNCTION\((?:[^)(]|\((?:[^)(]|\((?:[^)(]|\([^)(]*\))*\))*\))*\)
var OPERATIONFUNCTIONSETTERVALUE = 0
for (let i = 0; i < tmp.length; i++) {
	changeStatus((i+1) + "/" + tmp.length)
	const element = tmp[i]
	if (element.includes(OPERATIONFUNCTION)) {
		const args = element.replace(`${OPERATIONFUNCTION}(`, "").replace(/.$/, "").replace(/\s/g, "").split(",")
		if (args[args.length - 1].includes(OPERATIONFUNCTIONSETTER)) {
			OPERATIONFUNCTIONSETTERVALUE = parseInt(new RegExp(`${escapeRegExp(OPERATIONFUNCTIONSETTER)}\\((\\d+)\\)`).exec(args[args.length - 1])[1])
			args.pop()
		}
		var value = new RegExp(`case ${OPERATIONFUNCTIONSETTERVALUE}:\\n\\s+${escapeRegExp(OPERATIONEQUALVARIABLE)} = (.+);\\n.+break;`, "gm").exec(
			splitedText[0]
		)[1]
		for (let j = 0; j < args.length; j++) {
			value = value.replaceAll(`${OPERATIONARGUMENTVARIABLE}[${j}]`, args[j])
		}
		try {
			value = eval(value)
		} catch (error) {
		} finally {
			returncode = returncode.replace(element, value)
		}
	} else {
		OPERATIONFUNCTIONSETTERVALUE = parseInt(new RegExp(`${escapeRegExp(OPERATIONFUNCTIONSETTER)}\\((\\d+)\\)`).exec(element)[1])
	}
}
log(`Replacing "var a = ${MAINARRAY}; a[123]" to "${MAINARRAY}[123]"`)
tmp = [...returncode.matchAll(new RegExp(`\\s+(?<v>\\S+) = ${escapeRegExp(MAINARRAY)}.*$`, "gm"))].map((m) => m.groups.v)
for (let i = 0; i < tmp.length; i++) {
	changeStatus((i+1) + "/" + tmp.length)
	returncode = returncode.replaceAll(tmp[i], MAINARRAY)
}
const ARRAYFUNCTION = new RegExp(`${escapeRegExp(MAINARRAY)} = .+?(${escapeRegExp(MAINFUNCTION)}\\....)`, "").exec(splitedText[0])[1]
log(`Replacing "${ARRAYFUNCTION}(123)" to "real data"`)
tmp = noDuplicate(returncode.match(new RegExp(`${escapeRegExp(ARRAYFUNCTION)}\\((?:[^)(]|\\((?:[^)(]|\\((?:[^)(]|\\([^)(]*\\))*\\))*\\))*\\)`, "g")))
for (let i = 0; i < tmp.length; i++) {
	changeStatus((i+1) + "/" + tmp.length)
	const element = tmp[i]
	try {
		returncode = returncode.replaceAll(element, `"${eval(element).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/"/g, '\\"')}"`)
	} catch (error) {
		const args = element.replace(`${ARRAYFUNCTION}(`, "").replace(/.$/, "")
		const value = parseInt(new RegExp(`${escapeRegExp(args)} = (\\d+)`).exec(returncode)[1])
		returncode = returncode.replaceAll(
			element,
			`"${eval(`${ARRAYFUNCTION}(${value})`).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/"/g, '\\"')}"`
		)
	}
}
log(`Replacing "${MAINARRAY}[123]" to "real data"`)
tmp = noDuplicate(
	returncode.match(new RegExp(`${escapeRegExp(MAINARRAY)}\\[(?:[^\\]\\[]|\\[(?:[^\\]\\[]|\\[(?:[^\\]\\[]|\\[[^\\]\\[]*\\])*\\])*\\])*\\]`, "g"))
)
// ARRAY\[(?:[^\]\[]|\[(?:[^\]\[]|\[(?:[^\]\[]|\[[^\]\[]*\])*\])*\])*\]
for (let i = 0; i < tmp.length; i++) {
	changeStatus((i+1) + "/" + tmp.length)
	const element = tmp[i]
	try {
		returncode = returncode.replaceAll(element, `"${eval(element).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/"/g, '\\"')}"`)
	} catch (e) {
		var args = element.replace(`${MAINARRAY}[`, "").replace(/.$/, "")
		try{
			var value = parseInt(new RegExp(`${escapeRegExp(args)} = (\\d+)`).exec(returncode)[1])
		}
		catch(e) {
			returncode = returncode.replaceAll(element, '"undefined"')
		}
		returncode = returncode.replaceAll(new RegExp("([^0-9a-zA-Z_])" + escapeRegExp(element), "g"), `$1"${eval(`${MAINARRAY}[${value}]`).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/"/g, '\\"')}"`)
	}
}
tmp = []
log(`Removing ${MAINARRAY}`);
returncode = returncode.replaceAll(new RegExp(`\\n\\s*${escapeRegExp(MAINARRAY)} = ${escapeRegExp(MAINARRAY)};`, 'g'), "")
returncode = returncode.replaceAll(new RegExp(`\\n\\s*var ${escapeRegExp(MAINARRAY)};`, 'g'), "")
returncode = returncode.replaceAll(MAINARRAY + ", ", "")
returncode = returncode.replaceAll(", " + MAINARRAY, "")
returncode = returncode.replaceAll(new RegExp(`${escapeRegExp(MAINARRAY)} = \\[.+?\\];\\n`, 'g'), "")
log(`Removing ${MAINFUNCTION}.abc(); and var abc = ${MAINFUNCTION};`);
returncode = returncode.replaceAll(new RegExp(`\\n\\s+${escapeRegExp(MAINFUNCTION)}\.[a-zA-Z0-9_\$]{3}\(.*?\);`, 'g'), "")
returncode = returncode.replaceAll(new RegExp(`\\n\\s+var [a-zA-Z0-9_\$]{3} = ${escapeRegExp(MAINFUNCTION)};`, 'g'), "")
log("Removing empty if statements")
returncode = returncode.replaceAll(/if \(.+?\) \{\s*\}(?! else)/gm, "")
log("Replacing all array indexing with dot indexing")
returncode = returncode.replaceAll(/\["([a-zA-Z_$][a-zA-Z0-9_\$]*?)"\]/g, ".$1")
log("Cleanup")
returncode = js_beautify(returncode, {e4x: true, indent_with_tabs: true})
log("Removing nonsensical if-statements")
while(true){
	const l = [...returncode.matchAll(/((\t+)[a-zA-Z0-9_\$]{3}\[\d+\] = -?\d+;\n){6}\2if \(.+\) \{([\s\S]+?)\n\2\}/gm)]
	if (l.length === 0) break
	returncode = returncode.replaceAll(/((\t+)[a-zA-Z0-9_\$]{3}\[\d+\] = -?\d+;\n){6}\2if \(.+\) \{([\s\S]+?)\n\2\}/gm, "$3")
}
log("Removing nonsensical for-loops followed by nonsensical if-statements")
for (const vars of returncode.matchAll(new RegExp(`^(\\t+)[a-zA-Z0-9_\\$\\[\\]]+ = (-?\\d+);\\n\\1[a-zA-Z0-9_\\$\\[\\]]+ = (-?\\d+);\\n\\1[a-zA-Z0-9_\\$\\[\\]]+ = (-?\\d+);\\n\\1for \\((var )?[a-zA-Z0-9_\\$\\[\\]]+ = (\\d+);.*(${MAINFUNCTION}\\.[a-zA-Z0-9_\\$]+).+?(\\d+)\\).+\\) \\{\\n((\\1\\t.*?\\n)+)(\\1\\t[a-zA-Z0-9_\\$\\[\\]]+ \\+= 2;\\n)?\\1\\}\\n\\1if \\(.*\\7.+?(\\d+)\\).+\\) \\{([\\s\\S]+?)\\n\\1\\}`, "gm"))){
	let x = +vars[2]
	let y = +vars[3]
	let z = +vars[4]
	let w = +vars[6]
	let func = eval(vars[7])
	let mn1 = +vars[8]
	let mn2 = +vars[12]
	let a = false
	for (let i = w; func(i.toString(), i.toString().length, mn1) !== x; i++){
		z += 2;
		a = true
	}
	const b = func(z.toString(), z.toString().length, mn2) !== y
	let str = ""
	if (vars[10] === vars[9]) vars[10] = "#"
	if (a) str += vars[9].replace(vars[10], "")
	if (b) str += vars[13]
	returncode = returncode.replace(vars[0], str)
}
log("Removing useless for-loops")
returncode = returncode.replaceAll(new RegExp(`^((\\t+)[a-zA-Z0-9_\\$\\[\\]]+ = -?\\d+;\\n){2}\\2for \\(.*${MAINFUNCTION}.*\\n.*\\n\\2\\}`, "gm"), "")
{
	log("Removing dead code")
	const entries = [...returncode.matchAll(/^(\t*)function [a-zA-Z0-9_\$]+\([a-zA-Z0-9_\$, ]*\) \{\n/gm)]
	let deadCode = []
	for (const a of entries){
		const length = a[1].length + 1
		const split = ((returncode.match(new RegExp(`${escapeRegExp(a[0])}([\\S\\s]+?)\\n${a[1]}\\}`)))[1]).split("\n")
		for (let i = 0; i < split.length; i++){
			const line = split[i]
			const trimmedLine = line.slice(length)
			if (trimmedLine.startsWith("return;") && i < split.length - 1){
				deadCode.push(split.slice(i).join("\n"))
			}
		}
	}
	for (const a of deadCode){
		returncode = returncode.replace(a, "")
	}
	changeStatus(deadCode.length + " sections found")
}
{
	log("Removing unused functions")
	const funcDecs = /function ([a-zA-Z0-9_\$]+)\(.*\) \{/gm
	const funcList = []
	for (const a of returncode.matchAll(funcDecs)){
		funcList.push(a[1])
	}
	log("Total functions: " + funcList.length)
	let filteredCode = returncode.replaceAll(funcDecs, "")
	filteredCode = noStrings(filteredCode)
	const unusedVars = []
	for (const a of funcList){
		if (!filteredCode.includes(a)) unusedVars.push(a)
	}
	log("Unused functions: " + unusedVars.length)
	for (const a of unusedVars){
		const regex = new RegExp(`^(\\t*)function ${escapeRegExp(a)}\\(.*\\) \\{[\\s\\S]+?\\n\\1\\}`, "m")
		returncode = returncode.replace(regex, "")
	}
}
try{
	log('Deobfuscating packets')
	const varName = (returncode.match(/[a-zA-Z0-9_\$\[\]]+ = \(1, [a-zA-Z0-9_\$\[\]]+\)\([a-zA-Z0-9_\$\[\]]+, \{\s+reconnection/)[0]).split(" = ")[0]
	for (const a of returncode.matchAll(new RegExp(escapeRegExp(varName) + "\\.(on|emit)\\(([a-zA-Z0-9_\\$\\[\\]]+)", "g"))){
		const match = returncode.match(new RegExp(`${escapeRegExp(a[2])} = .+;`))
		if (!match) continue
		const varValue = match[0].split(" = ")[1].replace(";", "")
		returncode = returncode.replace(`${a[2]} = ${varValue};`, "")
		returncode = returncode.replace(a[2], varValue)
	}
}catch(e){changeStatus("Not found")}
log("Cleanup")
returncode = js_beautify(returncode, {e4x: true, indent_with_tabs: true})
{
	log("Unpacking arrays")
	function makeSafe(code){
		const tokens = esprima.tokenize(code)
		code = ""
		let isPrevTokenDot = false
		for (const a of tokens){
			if (a.type === "Keyword") code += " "
			if (a.type === "Identifier" && !isPrevTokenDot){
				if (a.value.startsWith("f") && !isNaN(parseInt(a.value.slice(1)))) {
					code += "_" + a.value
					continue
				}
			}
			code += a.value
			if (a.type === "Keyword" || a.value === "static") code += " "
			isPrevTokenDot = a.type === "Punctuator" && a.value === "."
		}
		return code
	}
	returncode = makeSafe(returncode)
	const ast = esprima.parseScript(returncode)
	let newScopeCounter = 0
	const oldNames = []
	const newNames = []
	estraverse.traverse(ast, {enter(node){
	    if (!node.type.endsWith("FunctionExpression") && node.type !== "FunctionDeclaration") return
	    if (!node.body) return
	    let blockNode = node.body
	    if (!blockNode.body[0]) return
	    let scopeDecIndex = 0
	    let scopeDec = blockNode.body[0]
	    if (scopeDec.type === "ExpressionStatement") {
	        scopeDec = blockNode.body[1]
	        scopeDecIndex = 1
	    }
	    if (!(scopeDec && scopeDec.declarations && scopeDec.declarations.length === 1)) {
			if (!node.id) return
			oldNames.push(node.id.name)
			node.id.name = "f" + newScopeCounter
			newNames.push(node.id.name)
			newScopeCounter++
			return
		}
	    const dec = scopeDec.declarations[0]
	    if (!(dec.init && dec.init.type === "ArrayExpression" && dec.init.elements.length === 1 && dec.init.elements[0].name === "arguments")) return
	    if (node.id && node.id.name){
			oldNames.push(node.id.name)
	    	node.id.name = "f" + newScopeCounter
			newNames.push(node.id.name)
	    }
	    const oldScopeName = dec.id.name
	    const indexTable = []
	    for (const i in node.params){
			const a = node.params[i]
			a.name = `f${newScopeCounter}a${i}`
	    }
	    estraverse.traverse(blockNode, {enter(node, parent){
	        if (node.type !== "MemberExpression") return
	        if (!node.computed) return
	        if (!node.object.type === "Identifier") return
	        if (node.object.name !== oldScopeName) return
	        const index = node.property.value
	        if (index === 0 && parent.type === "MemberExpression") {
	            const val = parent.property.value
	            for (const a of Object.keys(parent)){
	                delete parent[a]
	            }
	            parent.type = "Identifier"
	            parent.name = `f${newScopeCounter}a${val}`
	            return
	        }
	        if (!indexTable.includes(index)) indexTable.push(index)
	        for (const a of Object.keys(node)){
	            delete node[a]
	        }
	        node.type = "Identifier"
			const newName = `f${newScopeCounter}v${indexTable.indexOf(index)}`
	        node.name = newName
	    }})
	    for (let i = 0; i < blockNode.body.length; i++){
	        const n = blockNode.body[i]
	        if (n.type === "AssignmentExpression"){
	            const index = indexTable.indexOf(n.left.name)
	            if (index !== -1) {
	                blockNode.body[i] = {
	                    type: "VariableDeclaration",
	                    declarations: [
	                        {
	                            type: "VariableDeclarator",
	                            id: {
	                                type: "Identifier",
	                                name: n.left.name
	                            },
	                            init: n.right
	                        }
	                    ]
	                }
	                indexTable.splice(index, 1)
	            }
	        }
	    }
	    if (indexTable.length === 0) {
	        blockNode.body.splice(scopeDecIndex, 1)
	    }
	    for (let i = 0; i < indexTable.length; i++){
	        scopeDec.declarations[i] = {
	            type: "VariableDeclarator",
	            id: {
	                type: "Identifier",
	                name: "f" + newScopeCounter + "v" + i
	            }
	        }
	    }
	    newScopeCounter++
	}})
	returncode = escodegen.generate(ast, {format: {indent: {style: "\t"}}})
	returncode = replaceVars(returncode, oldNames, newNames)
}
{
	log("Removing unnecessary variable initializations")
	const inits = [...returncode.matchAll(/^(\t+)var ([a-zA-Z0-9_\$, ]+);$/gm)]
	let counter = 1
	for (const a of inits) {
		const difficultInits = []
		changeStatus(counter + "/" + inits.length)
		for (let b of a[2].split(",")){
			b = b.trim()
			const init = returncode.match(new RegExp(`^${a[1]}${escapeRegExp(b)} =`, "m"))
			if (!init) {
				difficultInits.push(b)
				continue
			}
			returncode = returncode.replace("\n" + init[0], `\n${a[1]}var ${b} =`)
		}
		returncode = returncode.replace(a[2] + ";", difficultInits.join(", ") + ";")
		counter++
	}
	returncode = returncode.replaceAll("var ;", "")
}
log('Replacing "var abc = anime({" with "anime({"')
returncode = returncode.replaceAll(/^(\t+)(var )?[a-zA-Z0-9_\$]+ = anime\(\{/gm, "$1anime({")
{
	log("Removing unused arguments")
	const regex = [
		/\(([a-zA-Z0-9_\$, ]+)\) =>/g,
		/function [a-zA-Z0-9_\$]+\(([a-zA-Z0-9_\$, ]+)\)/g,
		/[a-zA-Z0-9_\$]+\(([a-zA-Z0-9_\$, ]+)\) \{/g
	]
	const argList = []
	const unusedArgs = []
	const argStrings = []
	for (const a of regex){
		for (const b of returncode.matchAll(a)){
			const args = b[1].split(", ")
			argList.push(...args)
			argStrings.push(args)
		}
	}
	log("Total args: " + argList.length)
	let filteredCode = noStrings(returncode)
	for (const a of regex){
		filteredCode = filteredCode.replace(a, "")
	}
	for (const a of argList){
		if (!filteredCode.includes(a)) unusedArgs.push(a)
	}
	log("Unused args: " + unusedArgs.length)
	for (const a of argStrings){
		const origArgs = a.join(", ")
		let loop = true
		let n = 1
		for (let i = a.length-1; i >= 0; i--){
			if (unusedArgs.includes(a[i])){
				if (loop) a.length = i
				else {
					a[i] = "".padStart(n, "_")
					n++
				}
			}
			else{
				loop = false
			}
		}
		returncode = returncode.replace(origArgs, a.join(", "))
	}
}
{
	function getUnusedVars(code, v){
		const refCount = getRefCount(code, v)
		const unusedVars = []
		for (let i = 0; i < v.length; i++){
			if (refCount[i] === 0) unusedVars.push(v[i])
		}
		return unusedVars
	}
	log("Removing unused variables")
	const varDecs = /^(\t+)(var .+;)/gm
	let varList = []
	let filteredCode = returncode.replaceAll(/^(\t+)(var )?[a-zA-Z0-9_\$]+ = (-?\d+);/gm, "$1$3")
	filteredCode = filteredCode.replaceAll(/^(\t+)(var )?[a-zA-Z0-9_\$]+ = ([^\)\n]+;)/gm, "$1$3")
	filteredCode = filteredCode.replaceAll(/^(\t+)(var )?[a-zA-Z0-9_\$]+ = ((document\.getElementById|Date|localStorage\.getItem).+?;)/gm, "") // safe func calls
	//filteredCode = filteredCode.replaceAll(/^(\t+)(var )?[a-zA-Z0-9_\$]+ = (.+?;)/gm, "$1$3")
	for (const a of returncode.matchAll(varDecs)){
		const {code, decs} = replaceDecsWithExpr(a[2])
		varList.push(...decs)
		changeStatus(varList.length + " Found")
		filteredCode = filteredCode.replace(a[2], code)
	}
	varList = noDuplicate(varList)
	log("Total vars: " + varList.length)
	const unusedVars = getUnusedVars(filteredCode, varList)
	log("Unused vars: " + unusedVars.length)
	const ast = esprima.parseScript(returncode)
	estraverse.traverse(ast, {enter(node){
		if (node.type === "AssignmentExpression" && unusedVars.includes(node.left.name)){
			Object.assign(node, eo)
		}
		if (node.type !== "VariableDeclaration") return
		for (let i = 0; i < node.declarations.length; i++) {
			const dec = node.declarations[i]
			let x = false
			if (dec.init){
				estraverse.traverse(dec.init, {enter(node){
					if (node.type === "NewExpression" || node.type === "CallExpression") {
						x = true
						this.break()
					}
				}})
			}
			if (!unusedVars.includes(dec.id.name) || x) continue
			node.declarations.splice(i, 1)
			i--
		}
		if (node.declarations.length === 0) node.declarations[0] = eo
	}})
	returncode = (escodegen.generate(ast, {format: {indent: {style: "\t"}}})).replaceAll(/\t+(var )?ZZZ;\n/g, "")
}
if (!process.argv.includes("noflags")){
	log("Removing useless nation check")
	const varName = ((returncode.match(/^\t+[a-zA-Z0-9_\$]+\.europeanunion = true;/gm)[0]).split(".")[0]).trim()
	returncode = returncode.replace(`var ${varName} = {}`, "")
	returncode = returncode.replaceAll(new RegExp(`${escapeRegExp(varName)}\\..+`, "g"), "")
	returncode = returncode.replace(new RegExp(`if \\(${escapeRegExp(varName)}.+`), "if (true) {")
}
{
	log('Replacing "abc.colors.push(0x3F057D)" with "abc.colors = [0x3F057D]"')
	const colors = []
	let varName
	const pushMatch = /^\t+([a-zA-Z0-9_\$]+)\.colors\.push\((.+)\);/gm
	for (const a of returncode.matchAll(pushMatch)){
		if (!varName) varName = a[1]
		colors.push(a[2])
	}
	returncode = returncode.replaceAll(pushMatch, "")
	returncode = returncode.replace(`${varName}.colors = [];`, `${varName}.colors = [${colors.join(", ")}];`)
}
log("Cleanup")
returncode = js_beautify(returncode, {e4x: true, indent_with_tabs: true})
{
	log('Replacing "abc.push({})" with "abc = [{}]"')
	const news = []
	let varName
	const pushMatch = /^\t+([a-zA-Z0-9_\$]+)\.push\((\{\n\t+date.+\n\t+news.+\n\t+\})\);/gm
	for (const a of returncode.matchAll(pushMatch)){
		if (!varName) varName = a[1]
		news.push(a[2])
	}
	returncode = returncode.replaceAll(pushMatch, "")
	returncode = returncode.replace(`${varName} = [];`, `${varName} = [${news.join(", ")}];`)
}
try{
	log('Replacing "abc[1] = "Alien 1"" with "abc = ["", "Alien 1"]"')
	const varName = ((returncode.match(/([a-zA-Z0-9_\$]+)\[1\] = 'Alien 1';/g)[0]).split("[")[0]).trim()
	const list = [""]
	const arrMatch = new RegExp(`^\\t+${escapeRegExp(varName)}\\[(\\d+)\\] = ('.+');`, "gm")
	for (const a of returncode.matchAll(arrMatch)){
		list[a[1]] = a[2]
	}
	returncode = returncode.replaceAll(arrMatch, "")
	returncode = returncode.replace(`var ${varName} = [];`, `var ${varName} = [${list.join(", ")}];`)
} catch(e){changeStatus("Not found")}
{
	log("Removing functions that do nothing")
	returncode = returncode.replaceAll(/\.(fail|done)\(function\(.*\) \{\s*\}\)/g, "")
	returncode = returncode.replaceAll(/\.(fail|done)\(\(.*\) => \{\s*\}\)/g, "")
	returncode = returncode.replaceAll(/\.fail\(function\(.+\) \{\s*throw new Error.+\s*\}\)/g, "")
}
{
	log('Replacing "if (abc) {} else {doSomething()}" with "if (!abc) {doSomething()}"')
	returncode = returncode.replaceAll(/if \(.+\) {\s*}\s*else {\s*}/g, "")
	returncode = returncode.replaceAll(/if \((.+)\) {\s*}\s*else {(.+)}/g, "if (!($1)) {$2}")
}
{
	log("Removing useless code") // could become problematic in the future
	returncode = returncode.replace(/[a-zA-Z0-9_\$]+\.keyUpFunctions[\s\S]+\};\s+moment/, "moment")
}
{
	log("Replacing \"var abc = class def\" with \"class abc\"")
	const matches = [...returncode.matchAll(/var ([a-zA-Z0-9_\$\[\]]+) = class ([a-zA-Z0-9_\$]+)/g)]
	returncode = returncode.replaceAll(/var ([a-zA-Z0-9_\$\[\]]+) = class [a-zA-Z0-9_\$]+/g, "class $1")
	const o = []
	const n = []
	for (const a of matches){
		o.push(a[2])
		n.push(a[1])
	}
	returncode = replaceVars(returncode, o, n)
}
{
	log('Replacing "abc" with "element" in "var abc = document.getElementById("element")"') // 80 characters damn, i barely managed to make it fit
	const regex = /^(\t+)var ([a-zA-Z0-9_\$]+) = document\.getElementById\((['"])(.+?)\3\)/gm 
	const varNames = []
	const newNames = []
	for (const a of returncode.matchAll(regex)){
		varNames.push(a[2])
		newNames.push(a[4].replaceAll("-", "minus")) // for some reason there is an element with "-" in its id
	}
	returncode = replaceVars(returncode, varNames, newNames)
}
function getRefCount(code, v){
	const result = []
	for (let i = 0; i < v.length; i++){
		result[i] = 0
	}
	const tokens = esprima.tokenize(code)
	let isPrevTokenDot = false
	for (const a of tokens){
		if (a.type === "Identifier"){
			const index = v.indexOf(a.value)
			if (!isPrevTokenDot && index !== -1){
				result[index]++
				continue
			}
		}
		isPrevTokenDot = a.type === "Punctuator" && a.value === "."
	}
	return result
}
{
	log("Removing duplicate constants")
	const knownConstants = ["730","500","365","1000","30"]
	const ast = esprima.parseScript(returncode)
	const v = []
	const r = []
	estraverse.traverse(ast, {enter(node, parent){
		if (node.type !== "VariableDeclaration") return
		for (let i = 0; i < node.declarations.length; i++){
			const d = node.declarations[i]
			if (d.init && d.init.type === "Literal"){
				const index = knownConstants.indexOf(d.init.raw)
				if (index === -1) continue
				v.push(d.id.name)
				r.push(d.init.raw)
				node.declarations.splice(i,1)
				i--
			}
		}
		if (node.declarations.length === 0) node.declarations[0] = eo
	}})
	const rc = getRefCount(returncode, v)
	const nv = []
	const nr = []
	for (let i = 0; i < rc.length; i++){
		if (rc[i] === 2){
			nv.push(v[i])
			nr.push(r[i])
		}
	}
	returncode = (escodegen.generate(ast, {format: {indent: {style: "\t"}}}))
	returncode = replaceVars(returncode, nv, nr).replaceAll(/^(\t+)('.*?'|-?\d+) = (.+)/gm, "$1$3").replaceAll(/\t+var (\S+) = \1;\n/g, "").replaceAll(/\t+var ZZZ;\n/g, "")
	// const fnl = returncode.indexOf("\n") + 1
	// returncode = returncode.slice(0, fnl) + "const worldWidth = 730;\nconst worldHeight = 500;\nconst aspectRatio = 1.46;\n" + returncode.slice(fnl)
	// const ast = esprima.parseScript(returncode)
	// const v = []
	// const r = []
	// estraverse.traverse(ast, {enter(node, parent){
	// 	if (node.type !== "BlockStatement") return
	// }})
	// const rc = getRefCount(returncode, v)
	// const nv = []
	// const nr = []
	// for (let i = 0; i < rc.length; i++){
	// 	if (rc[i] === 2){
	// 		nv.push(v[i])
	// 		nr.push(r[i])
	// 	}
	// }
	// returncode = (escodegen.generate(ast, {format: {indent: {style: "\t"}}}))
	// console.log("[" + nv.join() + "]")
	// console.log("[" + nr.join() + "]")
	// returncode = replaceVars(returncode, nv, nr).replaceAll(/(-?\d)+\+\+/g, "$1").replaceAll(/^(\t+)('.*?'|-?\d+) = (.+)/gm, "$1$3").replaceAll(/\t+var (\S+) = \1;\n/g, "")
}
function generateHash(string){
	return (+string).toString(16)
}
if (false){
	log("Generating hash table for functions and classes")
	const matches = [
		/^(\t+)()function ([a-zA-Z0-9_\$]+)\(([a-zA-Z0-9_\$, ]+)\) \{[\s\S]+?\n\1\}/gm,
		/^(\t+)()function ([a-zA-Z0-9_\$]+)\(()\) \{[\s\S]+?\n\1\}/gm,
		/^(\t+)(var )?([a-zA-Z0-9_\$]+) = \(([a-zA-Z0-9_\$, ]+)\) => \{[\s\S]+?\n\1\}/gm,
		/^(\t+)(var )?([a-zA-Z0-9_\$]+) = \(()\) => \{[\s\S]+?\n\1\}/gm,
	]
	const funcs = []
	const classes = [...returncode.matchAll(/^(\t+)class [a-zA-Z0-9_\\$]+\{[\s\S]+?\n\1\}/gm)]
	const hashes = []
	const funcsToCheck = []
	for (const a of matches){
		for (const b of returncode.matchAll(a)){
		funcs.push({code: b[0], args: b[4], deepness: (b[1]).length, name: b[3]})
		funcsToCheck.push(b[3])
		}
	}
	const refCounts = getRefCount(returncode, funcsToCheck)
	for (let i = 0; i < refCounts.length; i++){
		funcs[i].refCount = refCounts[i]
	}
	let counter = 0
	const l = funcs.length + classes.length
	for (const a of funcs){
		counter++
		changeStatus(counter + "/" + l)
		const tokens = [...esprima.tokenize(a.code)]
		const ast = (esprima.parseScript(a.code)).body[0]
		let astLength
		if (!ast.body) astLength = 0
		else astLength = (ast.body.body).length
		const args = a.args.split(",")
		if (!args[0]) args.length = 0
		console.log(tokens.length,astLength,args.length,a.deepness,a.refCount)
		hashes.push({
			hash: generateHash([tokens.length,astLength,args.length,a.deepness,a.refCount].join("")),
			name: a.name
		})
	}
	writeToFile("hashTable.json", JSON.stringify(hashes, null, 1))

}
returncode = setVarNames(false, returncode)
returncode = finalCleanup(returncode)
{
	log("Validating the code")
	try{
		new Function(returncode)
	}
	catch(e){
		const filename = "invalid/alpha2s.js"
		console.log()
		console.log(e)
		log("Code is invalid. dumping the code to " + filename)
		writeToFile(filename, returncode)
		process.exit(1)
	}
}
{
	const filename = "deobfuscated/alpha2s.js"
	log("Saving deobfuscated code to " + filename)
	writeToFile(filename, returncode)
}
if (!process.argv.includes("nominify")){
    log("Minifying")
    returncode = (minify(returncode, {mangle: {toplevel: true}})).code
	const filename = "deobfuscated/alpha2s.min.js"
	log("Saving minified code to " + filename)
	writeToFile(filename, returncode)
}