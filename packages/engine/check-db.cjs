const Database = require('better-sqlite3');

const db = new Database('d:/cortex/.cortex/memory-solo-flight-1780777610102.db');

// Check schema
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('TABLES:', tables.map(r => r.name).join(', '));

// Check columns of memories table
const cols = db.prepare("PRAGMA table_info(memories)").all();
console.log('\nmemories columns:', cols.map(c => c.name).join(', '));

// Query Skill memories
const skillMems = db.prepare("SELECT id, kind, semantic_state, summary, weight, created_at FROM memories WHERE kind = 'Skill'").all();
console.log('\nSkill memories count:', skillMems.length);
skillMems.forEach(m => console.log(JSON.stringify(m)));

// Also check total memories and their kinds
const kinds = db.prepare("SELECT kind, COUNT(*) as cnt FROM memories GROUP BY kind").all();
console.log('\nMemories by kind:', JSON.stringify(kinds));

// Check recent memories (last 50)
const recent = db.prepare("SELECT id, kind, summary, created_at FROM memories ORDER BY created_at DESC LIMIT 30").all();
console.log('\nRecent 30 memories:');
recent.forEach(m => console.log(`  [${m.kind}] ${m.summary?.slice(0,80)} (${new Date(m.created_at).toISOString()})`));

db.close();
