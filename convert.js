/**
 * TXT → JSON Konverter für Fayed Search Engine
 * Erstellt eine saubere, validierte JSON-Struktur
 */

const fs = require('fs');
const path = require('path');

// Konfiguration
const DATA_DIR = "C:\\Users\\salaheddine.bouzerda\\Downloads\\OK_END\\data";
const OUTPUT_FILE = "C:\\Users\\salaheddine.bouzerda\\dev\\mousailima\\data.json";

// Statistiken
const stats = {
    total: 0,
    success: 0,
    errors: [],
    warnings: []
};

/**
 * Timestamp zu Sekunden konvertieren
 */
function timestampToSeconds(ts) {
    const parts = ts.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
}

/**
 * Titel bereinigen (entferne "الدكتور محمد فائد ||" etc.)
 */
function cleanTitle(title) {
    return title
        .replace(/^الدكتور محمد فائد\s*\|\|\s*/i, '')
        .replace(/^الدكتور محمد فائد\s*⧸⧸\s*/i, '')
        .replace(/^الدكتور محمد فائد\s*-\s*/i, '')
        .trim();
}

/**
 * Eine TXT-Datei parsen
 */
function parseTxtFile(filePath, filename) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Metadaten aus Header extrahieren
    let title = '';
    let date = '';
    let url = '';
    let headerEnd = -1;
    
    for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('العنوان:')) {
            title = cleanTitle(line.replace('العنوان:', '').trim());
        } else if (line.startsWith('التاريخ:')) {
            date = line.replace('التاريخ:', '').trim();
        } else if (line.startsWith('الرابط:')) {
            url = line.replace('الرابط:', '').trim();
        } else if (line.startsWith('====')) {
            headerEnd = i;
            break;
        }
    }
    
    // ID aus Dateinamen extrahieren
    const idMatch = filename.match(/^(\d+)\s*-/);
    const id = idMatch ? parseInt(idMatch[1]) : 0;
    
    // Fallback: Metadaten aus Dateinamen
    if (!title) {
        const titleMatch = filename.match(/الدكتور محمد فائد\s*-\s*(.+)\.txt$/);
        if (titleMatch) {
            title = titleMatch[1].trim();
        } else {
            title = filename.replace('.txt', '');
        }
    }
    
    if (!date) {
        const dateMatch = filename.match(/(\d{2}-\d{2}-\d{4})/);
        if (dateMatch) {
            date = dateMatch[1];
        }
    }
    
    // Segmente extrahieren
    const segments = [];
    let currentTimestamp = null;
    let currentSeconds = 0;
    let currentText = [];
    
    // Starte nach dem Header
    const startLine = headerEnd >= 0 ? headerEnd + 1 : 0;
    
    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Prüfe auf Timestamp: [00:00:00] oder ‏[00:00:00]
        // U+200F ist Right-to-Left Mark
        const tsMatch = line.match(/^[\u200F\s]*\[(\d{2}:\d{2}:\d{2})\](.*)$/);
        
        if (tsMatch) {
            // Speichere vorheriges Segment
            if (currentTimestamp !== null && currentText.length > 0) {
                segments.push({
                    ts: currentTimestamp,
                    sec: currentSeconds,
                    txt: currentText.join(' ').trim()
                });
            }
            
            // Neues Segment starten
            currentTimestamp = tsMatch[1];
            currentSeconds = timestampToSeconds(tsMatch[1]);
            const remaining = tsMatch[2].trim();
            currentText = remaining ? [remaining] : [];
        } else if (line && currentTimestamp !== null) {
            // Text zum aktuellen Segment hinzufügen
            currentText.push(line);
        }
    }
    
    // Letztes Segment speichern
    if (currentTimestamp !== null && currentText.length > 0) {
        segments.push({
            ts: currentTimestamp,
            sec: currentSeconds,
            txt: currentText.join(' ').trim()
        });
    }
    
    return {
        id,
        title,
        date,
        url,
        segments
    };
}

/**
 * Episode validieren
 */
function validateEpisode(ep, filename) {
    const issues = [];
    
    if (!ep.id || ep.id <= 0) {
        issues.push('Keine gültige ID');
    }
    if (!ep.title) {
        issues.push('Kein Titel');
    }
    if (!ep.date) {
        issues.push('Kein Datum');
    }
    if (!ep.url) {
        issues.push('Keine URL');
    }
    if (!ep.segments || ep.segments.length === 0) {
        issues.push('Keine Segmente');
    }
    
    // URL-Format prüfen
    if (ep.url && !ep.url.includes('youtube.com') && !ep.url.includes('youtu.be')) {
        issues.push('Ungültige YouTube-URL');
    }
    
    if (issues.length > 0) {
        stats.warnings.push({
            file: filename,
            id: ep.id,
            issues
        });
    }
    
    return issues.length === 0;
}

/**
 * Hauptfunktion
 */
function main() {
    console.log('═'.repeat(60));
    console.log('  TXT → JSON Konverter für Fayed Search Engine');
    console.log('═'.repeat(60));
    console.log('');
    
    // Prüfe Datenverzeichnis
    if (!fs.existsSync(DATA_DIR)) {
        console.error(`FEHLER: Verzeichnis nicht gefunden: ${DATA_DIR}`);
        process.exit(1);
    }
    
    // Alle TXT-Dateien lesen
    const files = fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith('.txt'))
        .sort((a, b) => {
            const idA = parseInt(a.match(/^(\d+)/)?.[1] || '0');
            const idB = parseInt(b.match(/^(\d+)/)?.[1] || '0');
            return idA - idB;
        });
    
    stats.total = files.length;
    console.log(`📁 Gefundene Dateien: ${files.length}`);
    console.log('');
    
    const episodes = [];
    
    for (const filename of files) {
        try {
            const filePath = path.join(DATA_DIR, filename);
            const episode = parseTxtFile(filePath, filename);
            
            validateEpisode(episode, filename);
            episodes.push(episode);
            stats.success++;
            
            if (stats.success % 500 === 0) {
                console.log(`   ✓ ${stats.success} Episoden verarbeitet...`);
            }
        } catch (err) {
            stats.errors.push({
                file: filename,
                error: err.message
            });
        }
    }
    
    // Nach ID sortieren
    episodes.sort((a, b) => a.id - b.id);
    
    // JSON speichern (kompakt für kleinere Dateigröße)
    console.log('');
    console.log(`💾 Speichere JSON: ${OUTPUT_FILE}`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(episodes), 'utf-8');
    
    const fileSize = fs.statSync(OUTPUT_FILE).size;
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
    
    // Statistiken ausgeben
    console.log('');
    console.log('═'.repeat(60));
    console.log('  ERGEBNIS');
    console.log('═'.repeat(60));
    console.log(`  ✅ Erfolgreich: ${stats.success} Episoden`);
    console.log(`  📊 Segmente: ${episodes.reduce((sum, e) => sum + e.segments.length, 0)}`);
    console.log(`  📦 Dateigröße: ${fileSizeMB} MB`);
    
    if (stats.errors.length > 0) {
        console.log(`  ❌ Fehler: ${stats.errors.length}`);
        stats.errors.slice(0, 5).forEach(e => {
            console.log(`     - ${e.file}: ${e.error}`);
        });
    }
    
    if (stats.warnings.length > 0) {
        console.log(`  ⚠️  Warnungen: ${stats.warnings.length}`);
        stats.warnings.slice(0, 5).forEach(w => {
            console.log(`     - ID ${w.id}: ${w.issues.join(', ')}`);
        });
    }
    
    console.log('');
    console.log('✅ Konvertierung abgeschlossen!');
    
    // Validierungs-Report speichern
    if (stats.errors.length > 0 || stats.warnings.length > 0) {
        const report = {
            timestamp: new Date().toISOString(),
            stats: {
                total: stats.total,
                success: stats.success,
                errors: stats.errors.length,
                warnings: stats.warnings.length
            },
            errors: stats.errors,
            warnings: stats.warnings
        };
        const reportPath = OUTPUT_FILE.replace('.json', '_report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
        console.log(`📋 Validierungs-Report: ${reportPath}`);
    }
}

main();
