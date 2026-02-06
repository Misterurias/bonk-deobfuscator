const hashes = (require("./hashTable.json")).functions
const duplicateList = []
for (let i = 0; i < hashes.length; i++){
    for (let j = 0; j < hashes.length; j++){
        if (i === j) continue
        if (hashes[i].hash === hashes[j].hash){
            console.log("duplicate found: ", hashes[i].name, hashes[j].name)
            if (!duplicateList.includes(hashes[i].name)) duplicateList.push(hashes[i].name)
            if (!duplicateList.includes(hashes[j].name)) duplicateList.push(hashes[j].name)
        }
    }
}
console.log(duplicateList)
console.log(duplicateList.length, "out of", hashes.length)