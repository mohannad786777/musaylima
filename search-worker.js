// Search Web Worker - Führt Suche im Hintergrund aus ohne UI zu blockieren

let DB = [];
let searchIndex = []; // Vorab-normalisierter Index für schnellere Suche

// Nachricht vom Haupt-Thread empfangen
self.onmessage = function(e) {
  const { type, data } = e.data;
  
  switch(type) {
    case 'INIT':
      DB = data.episodes;
      buildSearchIndex();
      self.postMessage({ type: 'INIT_COMPLETE', data: { count: DB.length } });
      break;
      
    case 'SEARCH':
      const results = performSearch(data.query, data.smartMode);
      self.postMessage({ type: 'SEARCH_RESULTS', data: results });
      break;
  }
};

// Erstelle vorab-normalisierten Suchindex
function buildSearchIndex() {
  console.log('Building search index...');
  const startTime = performance.now();
  
  searchIndex = DB.map(ep => ({
    id: ep.id,
    title: ep.title,
    titleNorm: normAr(ep.title),
    date: ep.date,
    url: ep.url,
    segments: ep.segments.map(seg => ({
      ts: seg.ts,
      sec: seg.sec,
      txt: seg.txt,
      txtNorm: normAr(seg.txt) // Vorab normalisiert!
    }))
  }));
  
  const endTime = performance.now();
  console.log(`Search index built in ${(endTime - startTime).toFixed(0)}ms`);
}

// Arabische Text-Normalisierung
function normAr(s) {
  if (!s) return '';
  return s
    .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\uFEFF]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
}

// Suche durchführen
function performSearch(query, smartMode) {
  if (!query || query.length < 2) return { results: [], totalHits: 0 };
  
  const startTime = performance.now();
  const results = [];
  const normQ = normAr(query);
  let totalHits = 0;
  
  for (const ep of searchIndex) {
    let hits = 0;
    const snippets = [];
    let firstMatchSec = 0;
    
    for (const seg of ep.segments) {
      let matched = false;
      
      if (smartMode) {
        if (seg.txtNorm.includes(normQ)) {
          matched = true;
          hits += (seg.txtNorm.split(normQ).length - 1);
        }
      } else {
        if (seg.txt.includes(query)) {
          matched = true;
          hits += (seg.txt.split(query).length - 1);
        }
      }
      
      if (matched) {
        if (firstMatchSec === 0) firstMatchSec = seg.sec;
        if (snippets.length < 3) {
          snippets.push({
            ts: seg.ts,
            sec: seg.sec,
            text: seg.txt.substring(0, 200)
          });
        }
      }
    }
    
    // Titel auch durchsuchen
    if (smartMode && ep.titleNorm.includes(normQ)) hits++;
    else if (!smartMode && ep.title.includes(query)) hits++;
    
    if (hits > 0) {
      totalHits += hits;
      results.push({
        id: ep.id,
        title: ep.title,
        date: ep.date,
        url: ep.url,
        hits,
        snippets,
        firstMatchSec
      });
    }
  }
  
  // Nach Treffern sortieren
  results.sort((a, b) => b.hits - a.hits);
  
  const endTime = performance.now();
  console.log(`Search completed in ${(endTime - startTime).toFixed(0)}ms, found ${results.length} episodes`);
  
  return {
    results: results.slice(0, 50), // Max 50 Ergebnisse
    totalHits,
    totalEpisodes: results.length,
    searchTime: endTime - startTime
  };
}
