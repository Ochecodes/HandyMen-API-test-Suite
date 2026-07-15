const XLSX = require('xlsx');

console.log("🧹 Reading corrupted Excel file...");
// SheetJS reads only the real data and ignores ghost XML
const workbook = XLSX.readFile('HandyMan_API_Test_Suite.xlsx');

console.log("✨ Saving a fresh, clean copy...");
// Writing it back out completely wipes the invisible formatting
XLSX.writeFile(workbook, 'HandyMan_API_Test_Suite.xlsx');

console.log("✅ Done! File is clean and ready for the merge script.");