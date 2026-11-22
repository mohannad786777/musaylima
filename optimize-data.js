/**
 * Script zum Optimieren der data.json
 * Führe aus mit: node optimize-data.js
 */

const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'data.json');
const outputFile = path.join(__dirname, 'data.min.json');

console.log('Lese data.json...');
const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

console.log(`Gefunden: ${data.length} Episoden`);

// Statistiken
let totalSegments = 0;
let totalTextLength = 0;

data.forEach(ep => {
  totalSegments += ep.segments.length;
  ep.segments.forEach(seg => {
    totalTextLength += seg.txt.length;
  });
});

console.log(`Total Segmente: ${totalSegments}`);
console.log(`Total Textlänge: ${(totalTextLength / 1024 / 1024).toFixed(2)} MB`);

// Option 1: Nur komprimieren (Whitespace entfernen)
console.log('\nSchreibe komprimierte Version...');
const minified = JSON.stringify(data);
fs.writeFileSync(outputFile, minified);

const originalSize = fs.statSync(inputFile).size;
const minifiedSize = fs.statSync(outputFile).size;

console.log(`\nErgebnis:`);
console.log(`Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Komprimiert: ${(minifiedSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Ersparnis: ${((1 - minifiedSize / originalSize) * 100).toFixed(1)}%`);

// Optional: Erstelle Index für schnellere Suche
console.log('\nErstelle Such-Index...');
const searchIndex = data.map(ep => ({
  id: ep.id,
  title: ep.title,
  date: ep.date,
  segCount: ep.segments.length
}));

fs.writeFileSync(
  path.join(__dirname, 'index.json'),
  JSON.stringify(searchIndex)
);
console.log('index.json erstellt (nur Metadaten für schnelle Übersicht)');

console.log('\n✅ Fertig! Benenne data.min.json in data.json um, um sie zu verwenden.');
